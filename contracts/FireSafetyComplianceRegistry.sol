// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title  FireSafetyComplianceRegistry
 * @author Chinmerem (GitHub: Phinatech) — African Leadership University
 * @notice Tamper-evident registry of fire-safety equipment inspections and fire/smoke
 *         incidents for healthcare facilities (hospitals, clinics, nursing homes).
 *
 * @dev PROBLEM THIS SOLVES
 *      Healthcare facilities are legally required to keep fire-safety equipment
 *      inspected and certified, but those compliance records are held by the very
 *      party being regulated — on paper, in spreadsheets, or in facility-controlled
 *      software. Records can therefore be lost, back-dated, or quietly amended after
 *      an adverse event. The risk lands on the occupants least able to escape it:
 *      ICU patients, patients under anaesthesia, neonates, and mobility-impaired
 *      patients who depend entirely on assisted evacuation.
 *
 * @dev WHAT IS ON-CHAIN AND WHAT IS NOT
 *      Real-time smoke/fire DETECTION stays off-chain in IoT hardware and the
 *      building's local alarm panel. Ethereum's ~12s block time and per-transaction
 *      gas cost make it unsuitable for continuous sensor telemetry or for triggering
 *      an evacuation alarm — any on-chain detection design would be slower and less
 *      reliable than the hardware it replaced. This contract is the trust layer, not
 *      the control loop: it records VERIFIED events (a completed inspection, a
 *      confirmed incident) and derives compliance state from them.
 *
 *      Inspection certificates themselves are stored off-chain as PDFs; only the
 *      SHA-256 hash is written on-chain, which is sufficient to prove a presented
 *      document is the one that was certified without paying to store it.
 *
 * @dev SECURITY MEASURES
 *      - Role-based access control (OpenZeppelin AccessControl) on every
 *        state-changing function.
 *      - Facility-scoped authority: role membership alone is insufficient; the caller
 *        must be the manager of record for the specific facility being acted on.
 *      - ReentrancyGuard on submitInspection, which performs an external call via
 *        ERC-721 _safeMint (the recipient's onERC721Received callback).
 *      - Checks-Effects-Interactions ordering: all storage writes complete before
 *        any external call.
 *      - Pausable emergency stop, for use if an inspector key is compromised.
 *      - Input validation on addresses, strings, and validity periods.
 *      - Custom errors rather than revert strings (lower deployment and revert gas).
 *      - Timestamps taken from block.timestamp, never from caller-supplied
 *        parameters, so submissions cannot be back-dated.
 */
contract FireSafetyComplianceRegistry is AccessControl, ERC721, ReentrancyGuard, Pausable {
    // ============================================================
    //                          ERRORS
    // ============================================================

    error ZeroAddress();
    error EmptyString(string field);
    error FacilityNotRegistered(uint256 facilityId);
    error NotFacilityManager(uint256 facilityId, address caller);
    error EquipmentNotActive(uint256 equipmentId);
    error EquipmentNotAtFacility(uint256 equipmentId, uint256 facilityId);
    error InvalidValidityPeriod(uint256 provided);
    error CertificateNonTransferable();
    error UnknownCertificate(uint256 tokenId);
    error CertificateAlreadyRevoked(uint256 tokenId);

    // ============================================================
    //                          ROLES
    // ============================================================

    /// @notice Licensed fire-safety inspectors authorised to submit inspection results.
    bytes32 public constant INSPECTOR_ROLE = keccak256("INSPECTOR_ROLE");

    /// @notice Held by facility managers for off-chain discoverability. Note that on-chain
    ///         authority is NOT granted by this role alone — every facility-scoped function
    ///         additionally checks `facilities[facilityId].manager == msg.sender`, so a
    ///         manager at one hospital cannot act for another.
    bytes32 public constant FACILITY_MANAGER_ROLE = keccak256("FACILITY_MANAGER_ROLE");

    /// @notice Minimum certification validity, in days. Prevents an inspector issuing a
    ///         "pass" that expires instantly.
    uint256 public constant MIN_VALIDITY_DAYS = 1;

    /// @notice Maximum certification validity, in days (10 years). Prevents a pass that
    ///         effectively never expires.
    uint256 public constant MAX_VALIDITY_DAYS = 3650;

    // ============================================================
    //                      DATA STRUCTURES
    // ============================================================

    /// @param name       Human-readable facility name.
    /// @param location   Physical location, for regulator identification.
    /// @param manager    Address authorised to act for this facility.
    /// @param registered Distinguishes a real facility from an unset mapping slot.
    struct Facility {
        string name;
        string location;
        address manager;
        bool registered;
    }

    /// @param facilityId    Facility this equipment belongs to.
    /// @param equipmentType e.g. "smoke_detector", "extinguisher", "sprinkler", "alarm_panel".
    /// @param serialNumber  Manufacturer serial, for physical reconciliation.
    /// @param installedAt   Block timestamp of registration.
    /// @param active        False once decommissioned; inactive equipment is excluded
    ///                      from facility compliance checks and rejects new inspections.
    struct Equipment {
        uint256 facilityId;
        string equipmentType;
        string serialNumber;
        uint256 installedAt;
        bool active;
    }

    /// @param equipmentId     Equipment inspected.
    /// @param inspector       Address that submitted the result.
    /// @param timestamp       Network-assigned submission time (cannot be back-dated).
    /// @param passed          Outcome. Failures are recorded permanently, not omitted.
    /// @param certificateHash SHA-256 of the off-chain PDF certificate.
    /// @param validUntil      Expiry timestamp; 0 when the inspection failed.
    struct Inspection {
        uint256 equipmentId;
        address inspector;
        uint256 timestamp;
        bool passed;
        string certificateHash;
        uint256 validUntil;
    }

    /// @param facilityId  Facility where the incident occurred.
    /// @param equipmentId Equipment involved, or 0 if not attributable to one item.
    /// @param timestamp   Network-assigned time of record.
    /// @param severity    "low", "medium", "high", or "critical".
    /// @param description Free-text account of the incident.
    /// @param reportedBy  Address that filed the report.
    struct Incident {
        uint256 facilityId;
        uint256 equipmentId;
        uint256 timestamp;
        string severity;
        string description;
        address reportedBy;
    }

    // ============================================================
    //                          STORAGE
    // ============================================================

    uint256 private _nextFacilityId = 1;
    uint256 private _nextEquipmentId = 1;
    uint256 private _nextInspectionId = 1;
    uint256 private _nextIncidentId = 1;
    uint256 private _nextCertificateTokenId = 1;

    mapping(uint256 => Facility) public facilities;
    mapping(uint256 => Equipment) public equipment;
    mapping(uint256 => Inspection) public inspections;
    mapping(uint256 => Incident) public incidents;

    /// @dev equipmentId => every inspectionId ever recorded for it, in order.
    mapping(uint256 => uint256[]) private _equipmentInspectionHistory;

    /// @dev facilityId => equipmentIds registered to it (including decommissioned).
    mapping(uint256 => uint256[]) private _facilityEquipmentList;

    /// @dev facilityId => incidentIds logged against it, in order.
    mapping(uint256 => uint256[]) private _facilityIncidentHistory;

    /// @notice equipmentId => most recent inspectionId (0 means never inspected).
    mapping(uint256 => uint256) public latestInspectionOf;

    /// @notice Certificate tokenId => the inspectionId that produced it. Provides the
    ///         on-chain audit link from a held certificate back to its evidence.
    mapping(uint256 => uint256) public certificateToInspection;

    /// @dev Base URI prepended to a certificate's hash to form its tokenURI.
    string private _certificateBaseURI;

    // ============================================================
    //                          EVENTS
    // ============================================================

    event FacilityRegistered(uint256 indexed facilityId, string name, address indexed manager);
    event FacilityManagerUpdated(uint256 indexed facilityId, address indexed oldManager, address indexed newManager);
    event EquipmentRegistered(uint256 indexed equipmentId, uint256 indexed facilityId, string equipmentType);
    event EquipmentDecommissioned(uint256 indexed equipmentId, uint256 indexed facilityId);
    event InspectionSubmitted(
        uint256 indexed inspectionId,
        uint256 indexed equipmentId,
        address indexed inspector,
        bool passed,
        uint256 validUntil
    );
    event IncidentReported(
        uint256 indexed incidentId,
        uint256 indexed facilityId,
        uint256 indexed equipmentId,
        string severity
    );
    event ComplianceCertificateIssued(uint256 indexed tokenId, uint256 indexed facilityId, uint256 indexed inspectionId);
    event ComplianceCertificateRevoked(uint256 indexed tokenId, uint256 indexed inspectionId);
    event CertificateBaseURIUpdated(string newBaseURI);

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    /// @notice Deploys the registry with a single regulator as root administrator.
    /// @param admin Address receiving DEFAULT_ADMIN_ROLE — the regulator or fire authority.
    constructor(address admin) ERC721("FireSafetyComplianceCertificate", "FSCC") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ============================================================
    //                     ADMIN (REGULATOR)
    // ============================================================

    /// @notice Whitelists a licensed fire-safety inspector.
    /// @param inspector Address to authorise.
    function registerInspector(address inspector) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (inspector == address(0)) revert ZeroAddress();
        _grantRole(INSPECTOR_ROLE, inspector);
    }

    /// @notice Withdraws an inspector's authorisation. Inspections they already submitted
    ///         remain on record — history is never rewritten — but they can submit no more.
    /// @param inspector Address to de-authorise.
    function revokeInspector(address inspector) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(INSPECTOR_ROLE, inspector);
    }

    /// @notice Onboards a healthcare facility into the compliance system.
    /// @param name     Facility name.
    /// @param location Physical location.
    /// @param manager  Address that will administer this facility.
    /// @return facilityId Identifier assigned to the new facility.
    function registerFacility(
        string calldata name,
        string calldata location,
        address manager
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 facilityId) {
        if (manager == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyString("name");
        if (bytes(location).length == 0) revert EmptyString("location");

        facilityId = _nextFacilityId++;
        facilities[facilityId] = Facility(name, location, manager, true);
        _grantRole(FACILITY_MANAGER_ROLE, manager);

        emit FacilityRegistered(facilityId, name, manager);
    }

    /// @notice Reassigns a facility to a new manager. Provides key-loss recovery and
    ///         handover on staff change, which would otherwise permanently lock a
    ///         facility out of the registry.
    /// @param facilityId Facility to reassign.
    /// @param newManager Address taking over.
    function updateFacilityManager(uint256 facilityId, address newManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!facilities[facilityId].registered) revert FacilityNotRegistered(facilityId);
        if (newManager == address(0)) revert ZeroAddress();

        address oldManager = facilities[facilityId].manager;
        facilities[facilityId].manager = newManager;
        _grantRole(FACILITY_MANAGER_ROLE, newManager);

        emit FacilityManagerUpdated(facilityId, oldManager, newManager);
    }

    /// @notice Revokes (burns) a compliance certificate — for use when an inspection is
    ///         found to have been issued fraudulently. The underlying inspection record
    ///         is deliberately left intact so the fraud remains visible on-chain.
    /// @param tokenId Certificate to revoke.
    function revokeCertificate(uint256 tokenId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 inspectionId = certificateToInspection[tokenId];
        if (inspectionId == 0) revert UnknownCertificate(tokenId);
        if (_ownerOf(tokenId) == address(0)) revert CertificateAlreadyRevoked(tokenId);

        _burn(tokenId);
        emit ComplianceCertificateRevoked(tokenId, inspectionId);
    }

    /// @notice Sets the base URI used to resolve certificate metadata off-chain.
    /// @param baseURI New base URI (e.g. an IPFS gateway prefix).
    function setCertificateBaseURI(string calldata baseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _certificateBaseURI = baseURI;
        emit CertificateBaseURIUpdated(baseURI);
    }

    /// @notice Emergency stop for all submissions, e.g. on a compromised inspector key.
    ///         Read-only compliance queries remain available while paused.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Lifts the emergency stop.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ============================================================
    //                    FACILITY MANAGER
    // ============================================================

    /// @dev Reverts unless the facility exists and the caller is its manager of record.
    modifier onlyFacilityManager(uint256 facilityId) {
        if (!facilities[facilityId].registered) revert FacilityNotRegistered(facilityId);
        if (facilities[facilityId].manager != msg.sender) revert NotFacilityManager(facilityId, msg.sender);
        _;
    }

    /// @notice Registers a piece of fire-safety equipment at a facility.
    /// @param facilityId    Facility the equipment belongs to.
    /// @param equipmentType Category, e.g. "smoke_detector".
    /// @param serialNumber  Manufacturer serial number.
    /// @return equipmentId Identifier assigned to the new equipment.
    function registerEquipment(
        uint256 facilityId,
        string calldata equipmentType,
        string calldata serialNumber
    ) external whenNotPaused onlyFacilityManager(facilityId) returns (uint256 equipmentId) {
        if (bytes(equipmentType).length == 0) revert EmptyString("equipmentType");
        if (bytes(serialNumber).length == 0) revert EmptyString("serialNumber");

        equipmentId = _nextEquipmentId++;
        equipment[equipmentId] = Equipment(facilityId, equipmentType, serialNumber, block.timestamp, true);
        _facilityEquipmentList[facilityId].push(equipmentId);

        emit EquipmentRegistered(equipmentId, facilityId, equipmentType);
    }

    /// @notice Decommissions equipment that has been physically removed. It is excluded
    ///         from facility compliance from that point on and accepts no further
    ///         inspections, but its inspection history remains permanently readable.
    /// @param equipmentId Equipment to decommission.
    function decommissionEquipment(uint256 equipmentId) external whenNotPaused {
        Equipment storage item = equipment[equipmentId];
        if (!item.active) revert EquipmentNotActive(equipmentId);

        uint256 facilityId = item.facilityId;
        if (facilities[facilityId].manager != msg.sender) revert NotFacilityManager(facilityId, msg.sender);

        item.active = false;
        emit EquipmentDecommissioned(equipmentId, facilityId);
    }

    /// @notice Logs a fire or smoke incident. Detection and alarming happen off-chain in
    ///         IoT hardware; this creates the immutable after-the-fact record used for
    ///         insurance claims, regulatory review, and accountability. Because incidents
    ///         cannot be deleted or back-dated, they can be cross-referenced against
    ///         inspection history to establish whether the equipment involved was
    ///         actually certified at the time.
    /// @param facilityId  Facility where the incident occurred.
    /// @param equipmentId Equipment involved, or 0 if not attributable to one item.
    /// @param severity    "low", "medium", "high", or "critical".
    /// @param description Account of what happened.
    /// @return incidentId Identifier assigned to the new incident.
    function reportIncident(
        uint256 facilityId,
        uint256 equipmentId,
        string calldata severity,
        string calldata description
    ) external whenNotPaused returns (uint256 incidentId) {
        if (!facilities[facilityId].registered) revert FacilityNotRegistered(facilityId);
        if (facilities[facilityId].manager != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotFacilityManager(facilityId, msg.sender);
        }
        if (bytes(severity).length == 0) revert EmptyString("severity");
        if (bytes(description).length == 0) revert EmptyString("description");

        // equipmentId 0 means "not attributable to a specific item". Any other value must
        // name equipment actually belonging to this facility — otherwise an incident could
        // reference another facility's equipment (or a nonexistent id), which would corrupt
        // the cross-referencing of incidents against inspection history.
        if (equipmentId != 0 && equipment[equipmentId].facilityId != facilityId) {
            revert EquipmentNotAtFacility(equipmentId, facilityId);
        }

        incidentId = _nextIncidentId++;
        incidents[incidentId] = Incident(facilityId, equipmentId, block.timestamp, severity, description, msg.sender);
        _facilityIncidentHistory[facilityId].push(incidentId);

        emit IncidentReported(incidentId, facilityId, equipmentId, severity);
    }

    // ============================================================
    //                        INSPECTOR
    // ============================================================

    /// @notice Records an inspection outcome. A pass mints a non-transferable compliance
    ///         certificate to the facility's manager as portable, independently verifiable
    ///         proof. Failures are recorded permanently and mint nothing.
    ///
    /// @dev Follows Checks-Effects-Interactions: validation first, then every storage
    ///      write, and only then _safeMint — which makes an external call into the
    ///      recipient's onERC721Received hook. nonReentrant provides defence in depth.
    ///      The timestamp comes from block.timestamp, never from a parameter, so an
    ///      inspector cannot back-date a submission.
    ///
    /// @param equipmentId        Equipment inspected.
    /// @param passed             Outcome of the inspection.
    /// @param certificateHash    SHA-256 hash of the off-chain PDF certificate.
    /// @param validityPeriodDays Days the certification remains valid; bounded by
    ///                           MIN_VALIDITY_DAYS and MAX_VALIDITY_DAYS. Ignored on failure.
    /// @return inspectionId Identifier assigned to the new inspection record.
    function submitInspection(
        uint256 equipmentId,
        bool passed,
        string calldata certificateHash,
        uint256 validityPeriodDays
    ) external whenNotPaused nonReentrant onlyRole(INSPECTOR_ROLE) returns (uint256 inspectionId) {
        // ---------------- Checks ----------------
        if (!equipment[equipmentId].active) revert EquipmentNotActive(equipmentId);
        if (passed) {
            if (bytes(certificateHash).length == 0) revert EmptyString("certificateHash");
            if (validityPeriodDays < MIN_VALIDITY_DAYS || validityPeriodDays > MAX_VALIDITY_DAYS) {
                revert InvalidValidityPeriod(validityPeriodDays);
            }
        }

        // ---------------- Effects ----------------
        inspectionId = _nextInspectionId++;
        uint256 validUntil = passed ? block.timestamp + (validityPeriodDays * 1 days) : 0;

        inspections[inspectionId] = Inspection(
            equipmentId,
            msg.sender,
            block.timestamp,
            passed,
            certificateHash,
            validUntil
        );
        _equipmentInspectionHistory[equipmentId].push(inspectionId);
        latestInspectionOf[equipmentId] = inspectionId;

        emit InspectionSubmitted(inspectionId, equipmentId, msg.sender, passed, validUntil);

        if (!passed) return inspectionId;

        uint256 facilityId = equipment[equipmentId].facilityId;
        uint256 tokenId = _nextCertificateTokenId++;
        certificateToInspection[tokenId] = inspectionId;
        emit ComplianceCertificateIssued(tokenId, facilityId, inspectionId);

        // ------------- Interactions -------------
        _safeMint(facilities[facilityId].manager, tokenId);
    }

    // ============================================================
    //                      COMPLIANCE VIEWS
    // ============================================================

    /// @notice Equipment is compliant only if its most recent inspection passed and that
    ///         certification has not expired. Evaluated against the current block
    ///         timestamp at read time, so a lapse takes effect automatically with no
    ///         administrative action and no possibility of going unrecorded.
    /// @param equipmentId Equipment to check.
    /// @return True if currently compliant.
    function isEquipmentCompliant(uint256 equipmentId) public view returns (bool) {
        uint256 latestId = latestInspectionOf[equipmentId];
        if (latestId == 0) return false; // never inspected
        Inspection storage latest = inspections[latestId];
        return latest.passed && latest.validUntil >= block.timestamp;
    }

    /// @notice A facility is compliant only if every piece of ACTIVE equipment registered
    ///         to it is individually compliant. Decommissioned equipment is excluded.
    ///
    /// @dev A facility with no active equipment returns false rather than vacuously true,
    ///      closing the gaming route where a facility registers nothing (or decommissions
    ///      everything) in order to appear compliant.
    ///
    /// @param facilityId Facility to check.
    /// @return True if every active piece of equipment is currently compliant.
    function isFacilityCompliant(uint256 facilityId) external view returns (bool) {
        uint256[] storage equipmentIds = _facilityEquipmentList[facilityId];
        uint256 activeCount;

        for (uint256 i = 0; i < equipmentIds.length; i++) {
            uint256 id = equipmentIds[i];
            if (!equipment[id].active) continue;
            activeCount++;
            if (!isEquipmentCompliant(id)) return false;
        }

        return activeCount > 0;
    }

    /// @param equipmentId Equipment to query.
    /// @return Every inspectionId recorded for this equipment, oldest first.
    function getEquipmentInspectionHistory(uint256 equipmentId) external view returns (uint256[] memory) {
        return _equipmentInspectionHistory[equipmentId];
    }

    /// @param facilityId Facility to query.
    /// @return Every equipmentId registered to this facility, including decommissioned.
    function getFacilityEquipment(uint256 facilityId) external view returns (uint256[] memory) {
        return _facilityEquipmentList[facilityId];
    }

    /// @param facilityId Facility to query.
    /// @return Every incidentId logged against this facility, oldest first.
    function getFacilityIncidents(uint256 facilityId) external view returns (uint256[] memory) {
        return _facilityIncidentHistory[facilityId];
    }

    /// @notice Total counts, useful for off-chain indexers paginating the registry.
    /// @return facilityCount   Facilities registered.
    /// @return equipmentCount  Equipment items registered.
    /// @return inspectionCount Inspections recorded.
    /// @return incidentCount   Incidents logged.
    function getRegistryStats()
        external
        view
        returns (uint256 facilityCount, uint256 equipmentCount, uint256 inspectionCount, uint256 incidentCount)
    {
        return (_nextFacilityId - 1, _nextEquipmentId - 1, _nextInspectionId - 1, _nextIncidentId - 1);
    }

    // ============================================================
    //                    CERTIFICATE METADATA
    // ============================================================

    /// @notice Resolves a certificate's metadata by appending the certificate hash
    ///         recorded in its originating inspection to the configured base URI.
    /// @param tokenId Certificate to resolve.
    /// @return URI at which the certificate document can be retrieved.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint256 inspectionId = certificateToInspection[tokenId];
        return string.concat(_certificateBaseURI, inspections[inspectionId].certificateHash);
    }

    // ============================================================
    //              SOULBOUND ENFORCEMENT + OVERRIDES
    // ============================================================

    /// @dev OpenZeppelin v5 routes mint, transfer, and burn through _update. Permitting
    ///      only the cases with no previous owner (mint) or no new owner (burn) blocks
    ///      exactly the set of genuine transfers.
    ///
    ///      Certificates must be soulbound: a transferable proof of compliance could be
    ///      sold or moved to a facility that never earned it, which would actively
    ///      undermine the guarantee this registry exists to provide.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert CertificateNonTransferable();
        return super._update(to, tokenId, auth);
    }

    /// @dev Required because both AccessControl and ERC721 declare supportsInterface.
    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, ERC721) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
