const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FireSafetyComplianceRegistry", function () {
  const DEFAULT_ADMIN_ROLE = "0x" + "0".repeat(64);
  const INSPECTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("INSPECTOR_ROLE"));
  const FACILITY_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACILITY_MANAGER_ROLE"));
  const ZERO = ethers.ZeroAddress;
  const HASH = "b94d27b9934d3e08a52e52d7da7dabfa";

  async function deployFixture() {
    const [admin, inspector, manager, otherManager, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("FireSafetyComplianceRegistry");
    const registry = await Registry.deploy(admin.address);
    await registry.waitForDeployment();
    return { registry, admin, inspector, manager, otherManager, stranger };
  }

  // Facility 1 registered to `manager`
  async function withFacility() {
    const base = await deployFixture();
    await base.registry.connect(base.admin).registerFacility("City Hospital", "Kigali", base.manager.address);
    return base;
  }

  // Facility 1 + equipment 1 + authorised inspector
  async function withEquipment() {
    const base = await withFacility();
    await base.registry.connect(base.manager).registerEquipment(1, "smoke_detector", "SD-001");
    await base.registry.connect(base.admin).registerInspector(base.inspector.address);
    return base;
  }

  // ============================================================
  describe("Deployment", function () {
    it("grants DEFAULT_ADMIN_ROLE to the specified admin", async function () {
      const { registry, admin } = await deployFixture();
      expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(true);
    });

    it("sets the correct NFT name and symbol for compliance certificates", async function () {
      const { registry } = await deployFixture();
      expect(await registry.name()).to.equal("FireSafetyComplianceCertificate");
      expect(await registry.symbol()).to.equal("FSCC");
    });

    it("reverts if deployed with the zero address as admin", async function () {
      const Registry = await ethers.getContractFactory("FireSafetyComplianceRegistry");
      await expect(Registry.deploy(ZERO)).to.be.revertedWithCustomError(Registry, "ZeroAddress");
    });

    it("exposes the documented validity-period bounds", async function () {
      const { registry } = await deployFixture();
      expect(await registry.MIN_VALIDITY_DAYS()).to.equal(1n);
      expect(await registry.MAX_VALIDITY_DAYS()).to.equal(3650n);
    });

    it("supports the ERC721 and AccessControl interfaces", async function () {
      const { registry } = await deployFixture();
      expect(await registry.supportsInterface("0x80ac58cd")).to.equal(true); // ERC721
      expect(await registry.supportsInterface("0x7965db0b")).to.equal(true); // AccessControl
    });
  });

  // ============================================================
  describe("Inspector management", function () {
    it("lets admin register an inspector", async function () {
      const { registry, admin, inspector } = await deployFixture();
      await registry.connect(admin).registerInspector(inspector.address);
      expect(await registry.hasRole(INSPECTOR_ROLE, inspector.address)).to.equal(true);
    });

    it("reverts if a non-admin tries to register an inspector", async function () {
      const { registry, stranger, inspector } = await deployFixture();
      await expect(registry.connect(stranger).registerInspector(inspector.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(stranger.address, DEFAULT_ADMIN_ROLE);
    });

    it("reverts when registering the zero address as an inspector", async function () {
      const { registry, admin } = await deployFixture();
      await expect(registry.connect(admin).registerInspector(ZERO)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress"
      );
    });

    it("lets admin revoke an inspector", async function () {
      const { registry, admin, inspector } = await deployFixture();
      await registry.connect(admin).registerInspector(inspector.address);
      await registry.connect(admin).revokeInspector(inspector.address);
      expect(await registry.hasRole(INSPECTOR_ROLE, inspector.address)).to.equal(false);
    });

    it("blocks a revoked inspector from submitting further inspections", async function () {
      const { registry, admin, inspector } = await withEquipment();
      await registry.connect(admin).revokeInspector(inspector.address);
      await expect(registry.connect(inspector).submitInspection(1, true, HASH, 365))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(inspector.address, INSPECTOR_ROLE);
    });

    it("preserves inspections already submitted by a revoked inspector", async function () {
      const { registry, admin, inspector } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, true, HASH, 365);
      await registry.connect(admin).revokeInspector(inspector.address);

      const inspection = await registry.inspections(1);
      expect(inspection.inspector).to.equal(inspector.address);
      expect(await registry.isEquipmentCompliant(1)).to.equal(true);
    });
  });

  // ============================================================
  describe("Facility registration", function () {
    it("lets admin register a facility and grants the manager role", async function () {
      const { registry, admin, manager } = await deployFixture();
      await expect(registry.connect(admin).registerFacility("St. Mary's Clinic", "Kigali", manager.address))
        .to.emit(registry, "FacilityRegistered")
        .withArgs(1n, "St. Mary's Clinic", manager.address);

      const facility = await registry.facilities(1);
      expect(facility.name).to.equal("St. Mary's Clinic");
      expect(facility.manager).to.equal(manager.address);
      expect(facility.registered).to.equal(true);
      expect(await registry.hasRole(FACILITY_MANAGER_ROLE, manager.address)).to.equal(true);
    });

    it("reverts if a non-admin tries to register a facility", async function () {
      const { registry, manager, stranger } = await deployFixture();
      await expect(registry.connect(stranger).registerFacility("Fake Clinic", "Nowhere", manager.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(stranger.address, DEFAULT_ADMIN_ROLE);
    });

    it("reverts on a zero-address manager", async function () {
      const { registry, admin } = await deployFixture();
      await expect(registry.connect(admin).registerFacility("Clinic", "Kigali", ZERO)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress"
      );
    });

    it("reverts on an empty facility name", async function () {
      const { registry, admin, manager } = await deployFixture();
      await expect(registry.connect(admin).registerFacility("", "Kigali", manager.address))
        .to.be.revertedWithCustomError(registry, "EmptyString")
        .withArgs("name");
    });

    it("reverts on an empty location", async function () {
      const { registry, admin, manager } = await deployFixture();
      await expect(registry.connect(admin).registerFacility("Clinic", "", manager.address))
        .to.be.revertedWithCustomError(registry, "EmptyString")
        .withArgs("location");
    });

    it("lets admin reassign a facility to a new manager (key-loss recovery)", async function () {
      const { registry, admin, manager, otherManager } = await withFacility();
      await expect(registry.connect(admin).updateFacilityManager(1, otherManager.address))
        .to.emit(registry, "FacilityManagerUpdated")
        .withArgs(1n, manager.address, otherManager.address);

      expect((await registry.facilities(1)).manager).to.equal(otherManager.address);
      await expect(registry.connect(otherManager).registerEquipment(1, "sprinkler", "SP-001")).to.not.be.reverted;
    });

    it("locks out the old manager after reassignment", async function () {
      const { registry, admin, manager, otherManager } = await withFacility();
      await registry.connect(admin).updateFacilityManager(1, otherManager.address);
      await expect(registry.connect(manager).registerEquipment(1, "sprinkler", "SP-001"))
        .to.be.revertedWithCustomError(registry, "NotFacilityManager")
        .withArgs(1n, manager.address);
    });

    it("reverts when reassigning an unregistered facility", async function () {
      const { registry, admin, otherManager } = await withFacility();
      await expect(registry.connect(admin).updateFacilityManager(99, otherManager.address))
        .to.be.revertedWithCustomError(registry, "FacilityNotRegistered")
        .withArgs(99n);
    });
  });

  // ============================================================
  describe("Equipment registration", function () {
    it("lets the facility's manager register equipment", async function () {
      const { registry, manager } = await withFacility();
      await expect(registry.connect(manager).registerEquipment(1, "smoke_detector", "SD-001"))
        .to.emit(registry, "EquipmentRegistered")
        .withArgs(1n, 1n, "smoke_detector");

      const ids = await registry.getFacilityEquipment(1);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);
    });

    it("reverts if called by someone other than that facility's manager", async function () {
      const { registry, otherManager } = await withFacility();
      await expect(registry.connect(otherManager).registerEquipment(1, "smoke_detector", "SD-001"))
        .to.be.revertedWithCustomError(registry, "NotFacilityManager")
        .withArgs(1n, otherManager.address);
    });

    it("reverts for an unregistered facility id", async function () {
      const { registry, manager } = await withFacility();
      await expect(registry.connect(manager).registerEquipment(99, "smoke_detector", "SD-001"))
        .to.be.revertedWithCustomError(registry, "FacilityNotRegistered")
        .withArgs(99n);
    });

    it("reverts on an empty equipment type", async function () {
      const { registry, manager } = await withFacility();
      await expect(registry.connect(manager).registerEquipment(1, "", "SD-001"))
        .to.be.revertedWithCustomError(registry, "EmptyString")
        .withArgs("equipmentType");
    });

    it("reverts on an empty serial number", async function () {
      const { registry, manager } = await withFacility();
      await expect(registry.connect(manager).registerEquipment(1, "smoke_detector", ""))
        .to.be.revertedWithCustomError(registry, "EmptyString")
        .withArgs("serialNumber");
    });
  });

  // ============================================================
  describe("Equipment decommissioning", function () {
    it("lets the facility manager decommission equipment", async function () {
      const { registry, manager } = await withEquipment();
      await expect(registry.connect(manager).decommissionEquipment(1))
        .to.emit(registry, "EquipmentDecommissioned")
        .withArgs(1n, 1n);
      expect((await registry.equipment(1)).active).to.equal(false);
    });

    it("reverts if a non-manager tries to decommission", async function () {
      const { registry, stranger } = await withEquipment();
      await expect(registry.connect(stranger).decommissionEquipment(1))
        .to.be.revertedWithCustomError(registry, "NotFacilityManager")
        .withArgs(1n, stranger.address);
    });

    it("reverts when decommissioning equipment twice", async function () {
      const { registry, manager } = await withEquipment();
      await registry.connect(manager).decommissionEquipment(1);
      await expect(registry.connect(manager).decommissionEquipment(1))
        .to.be.revertedWithCustomError(registry, "EquipmentNotActive")
        .withArgs(1n);
    });

    it("rejects new inspections on decommissioned equipment", async function () {
      const { registry, manager, inspector } = await withEquipment();
      await registry.connect(manager).decommissionEquipment(1);
      await expect(registry.connect(inspector).submitInspection(1, true, HASH, 365))
        .to.be.revertedWithCustomError(registry, "EquipmentNotActive")
        .withArgs(1n);
    });

    it("excludes decommissioned equipment from facility compliance", async function () {
      const { registry, manager, inspector } = await withEquipment();
      await registry.connect(manager).registerEquipment(1, "extinguisher", "EX-001"); // id 2
      await registry.connect(inspector).submitInspection(1, true, HASH, 365);

      // equipment 2 uninspected, so facility is not compliant
      expect(await registry.isFacilityCompliant(1)).to.equal(false);

      // decommission it, and the facility becomes compliant on equipment 1 alone
      await registry.connect(manager).decommissionEquipment(2);
      expect(await registry.isFacilityCompliant(1)).to.equal(true);
    });

    it("preserves the inspection history of decommissioned equipment", async function () {
      const { registry, manager, inspector } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, true, HASH, 365);
      await registry.connect(manager).decommissionEquipment(1);

      const history = await registry.getEquipmentInspectionHistory(1);
      expect(history.length).to.equal(1);
    });
  });

  // ============================================================
  describe("Inspections and compliance", function () {
    it("is not compliant before any inspection", async function () {
      const { registry } = await withEquipment();
      expect(await registry.isEquipmentCompliant(1)).to.equal(false);
    });

    it("becomes compliant after a passing inspection and mints a certificate", async function () {
      const { registry, inspector, manager } = await withEquipment();
      await expect(registry.connect(inspector).submitInspection(1, true, HASH, 365))
        .to.emit(registry, "ComplianceCertificateIssued")
        .withArgs(1n, 1n, 1n);

      expect(await registry.isEquipmentCompliant(1)).to.equal(true);
      expect(await registry.ownerOf(1)).to.equal(manager.address);
      expect(await registry.balanceOf(manager.address)).to.equal(1n);
    });

    it("links the minted certificate back to its originating inspection", async function () {
      const { registry, inspector } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, true, HASH, 365);
      expect(await registry.certificateToInspection(1)).to.equal(1n);
    });

    it("stays non-compliant after a failing inspection and mints no certificate", async function () {
      const { registry, inspector, manager } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, false, "", 0);
      expect(await registry.isEquipmentCompliant(1)).to.equal(false);
      expect(await registry.balanceOf(manager.address)).to.equal(0n);
    });

    it("records a failing inspection permanently rather than omitting it", async function () {
      const { registry, inspector } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, false, "", 0);
      const inspection = await registry.inspections(1);
      expect(inspection.passed).to.equal(false);
      expect(inspection.validUntil).to.equal(0n);
      expect((await registry.getEquipmentInspectionHistory(1)).length).to.equal(1);
    });

    it("reverts if a non-inspector tries to submit an inspection", async function () {
      const { registry, manager } = await withEquipment();
      await expect(registry.connect(manager).submitInspection(1, true, HASH, 365))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(manager.address, INSPECTOR_ROLE);
    });

    it("reverts for equipment that was never registered", async function () {
      const { registry, inspector } = await withEquipment();
      await expect(registry.connect(inspector).submitInspection(99, true, HASH, 365))
        .to.be.revertedWithCustomError(registry, "EquipmentNotActive")
        .withArgs(99n);
    });

    it("reverts on a passing inspection with an empty certificate hash", async function () {
      const { registry, inspector } = await withEquipment();
      await expect(registry.connect(inspector).submitInspection(1, true, "", 365))
        .to.be.revertedWithCustomError(registry, "EmptyString")
        .withArgs("certificateHash");
    });

    it("reverts on a validity period below the minimum", async function () {
      const { registry, inspector } = await withEquipment();
      await expect(registry.connect(inspector).submitInspection(1, true, HASH, 0))
        .to.be.revertedWithCustomError(registry, "InvalidValidityPeriod")
        .withArgs(0n);
    });

    it("reverts on a validity period above the maximum", async function () {
      const { registry, inspector } = await withEquipment();
      await expect(registry.connect(inspector).submitInspection(1, true, HASH, 3651))
        .to.be.revertedWithCustomError(registry, "InvalidValidityPeriod")
        .withArgs(3651n);
    });

    it("becomes non-compliant again once the validity period expires", async function () {
      const { registry, inspector } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, true, HASH, 30);
      expect(await registry.isEquipmentCompliant(1)).to.equal(true);

      await time.increase(31 * 24 * 60 * 60); // 31 days

      expect(await registry.isEquipmentCompliant(1)).to.equal(false);
    });

    it("is restored to compliant by a fresh passing re-inspection after expiry", async function () {
      const { registry, inspector } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, true, HASH, 30);
      await time.increase(31 * 24 * 60 * 60);
      expect(await registry.isEquipmentCompliant(1)).to.equal(false);

      await registry.connect(inspector).submitInspection(1, true, HASH, 365);
      expect(await registry.isEquipmentCompliant(1)).to.equal(true);
    });

    it("tracks latestInspectionOf as the most recent submission", async function () {
      const { registry, inspector } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, false, "", 0);
      await registry.connect(inspector).submitInspection(1, true, HASH, 365);

      expect(await registry.latestInspectionOf(1)).to.equal(2n);
      expect((await registry.getEquipmentInspectionHistory(1)).length).to.equal(2);
    });

    it("treats a later failure as overriding an earlier pass", async function () {
      const { registry, inspector } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, true, HASH, 365);
      expect(await registry.isEquipmentCompliant(1)).to.equal(true);

      await registry.connect(inspector).submitInspection(1, false, "", 0);
      expect(await registry.isEquipmentCompliant(1)).to.equal(false);
    });

    it("facility is compliant only when every piece of equipment is compliant", async function () {
      const { registry, manager, inspector } = await withEquipment();
      await registry.connect(manager).registerEquipment(1, "extinguisher", "EX-001"); // id 2

      expect(await registry.isFacilityCompliant(1)).to.equal(false); // nothing inspected

      await registry.connect(inspector).submitInspection(1, true, HASH, 365);
      expect(await registry.isFacilityCompliant(1)).to.equal(false); // id 2 uninspected

      await registry.connect(inspector).submitInspection(2, true, HASH, 365);
      expect(await registry.isFacilityCompliant(1)).to.equal(true); // both pass

      await registry.connect(inspector).submitInspection(2, false, "", 0);
      expect(await registry.isFacilityCompliant(1)).to.equal(false); // one re-inspection failed
    });

    it("reports false for a facility with no registered equipment", async function () {
      const { registry, admin, otherManager } = await deployFixture();
      await registry.connect(admin).registerFacility("Empty Clinic", "Kigali", otherManager.address);
      expect(await registry.isFacilityCompliant(1)).to.equal(false);
    });

    it("does not let one facility's manager inspect via another's equipment", async function () {
      const { registry, admin, manager, otherManager, inspector } = await withEquipment();
      await registry.connect(admin).registerFacility("Second Clinic", "Huye", otherManager.address);
      await expect(registry.connect(otherManager).registerEquipment(1, "sprinkler", "SP-001"))
        .to.be.revertedWithCustomError(registry, "NotFacilityManager")
        .withArgs(1n, otherManager.address);
    });
  });

  // ============================================================
  describe("Incident reporting", function () {
    it("lets the facility manager report an incident", async function () {
      const { registry, manager } = await withFacility();
      await expect(registry.connect(manager).reportIncident(1, 0, "high", "Smoke detected in ward 3"))
        .to.emit(registry, "IncidentReported")
        .withArgs(1n, 1n, 0n, "high");

      expect((await registry.getFacilityIncidents(1)).length).to.equal(1);
      const incident = await registry.incidents(1);
      expect(incident.description).to.equal("Smoke detected in ward 3");
      expect(incident.reportedBy).to.equal(manager.address);
    });

    it("lets the admin report an incident on behalf of any facility", async function () {
      const { registry, admin } = await withFacility();
      await expect(registry.connect(admin).reportIncident(1, 0, "critical", "Regulator-verified fire event")).to.not.be
        .reverted;
    });

    it("reverts if reported by someone unrelated to the facility", async function () {
      const { registry, stranger } = await withFacility();
      await expect(registry.connect(stranger).reportIncident(1, 0, "high", "Should not go through"))
        .to.be.revertedWithCustomError(registry, "NotFacilityManager")
        .withArgs(1n, stranger.address);
    });

    it("reverts for an unregistered facility", async function () {
      const { registry, manager } = await withFacility();
      await expect(registry.connect(manager).reportIncident(99, 0, "high", "Bad facility id"))
        .to.be.revertedWithCustomError(registry, "FacilityNotRegistered")
        .withArgs(99n);
    });

    it("reverts on an empty severity", async function () {
      const { registry, manager } = await withFacility();
      await expect(registry.connect(manager).reportIncident(1, 0, "", "Something happened"))
        .to.be.revertedWithCustomError(registry, "EmptyString")
        .withArgs("severity");
    });

    it("reverts on an empty description", async function () {
      const { registry, manager } = await withFacility();
      await expect(registry.connect(manager).reportIncident(1, 0, "high", ""))
        .to.be.revertedWithCustomError(registry, "EmptyString")
        .withArgs("description");
    });

    it("accepts equipmentId 0 as 'not attributable to specific equipment'", async function () {
      const { registry, manager } = await withFacility();
      await expect(registry.connect(manager).reportIncident(1, 0, "high", "Smoke, source unknown")).to.not.be.reverted;
    });

    it("accepts equipment that genuinely belongs to the facility", async function () {
      const { registry, manager } = await withEquipment();
      await expect(registry.connect(manager).reportIncident(1, 1, "high", "Detector SD-001 triggered")).to.not.be
        .reverted;
    });

    it("reverts when the incident references another facility's equipment", async function () {
      const { registry, admin, manager, otherManager } = await withEquipment();
      // Facility 2, managed by otherManager, with its own equipment (id 2)
      await registry.connect(admin).registerFacility("Second Clinic", "Huye", otherManager.address);
      await registry.connect(otherManager).registerEquipment(2, "sprinkler", "SP-001");

      // Facility 1's manager tries to pin an incident on facility 2's equipment
      await expect(registry.connect(manager).reportIncident(1, 2, "high", "Not my equipment"))
        .to.be.revertedWithCustomError(registry, "EquipmentNotAtFacility")
        .withArgs(2n, 1n);
    });

    it("reverts when the incident references equipment that does not exist", async function () {
      const { registry, manager } = await withEquipment();
      await expect(registry.connect(manager).reportIncident(1, 999, "high", "Phantom equipment"))
        .to.be.revertedWithCustomError(registry, "EquipmentNotAtFacility")
        .withArgs(999n, 1n);
    });

    it("still allows incidents against decommissioned equipment at the same facility", async function () {
      const { registry, manager } = await withEquipment();
      await registry.connect(manager).decommissionEquipment(1);
      await expect(registry.connect(manager).reportIncident(1, 1, "medium", "Failure found post-removal")).to.not.be
        .reverted;
    });

    it("keeps an append-only incident history", async function () {
      const { registry, manager } = await withFacility();
      await registry.connect(manager).reportIncident(1, 0, "low", "First");
      await registry.connect(manager).reportIncident(1, 0, "high", "Second");

      const ids = await registry.getFacilityIncidents(1);
      expect(ids.map((i) => i.toString())).to.deep.equal(["1", "2"]);
    });
  });

  // ============================================================
  describe("Soulbound compliance certificates", function () {
    async function withCertificate() {
      const base = await withEquipment();
      await base.registry.connect(base.inspector).submitInspection(1, true, HASH, 365);
      return base;
    }

    it("reverts when a certificate holder tries to transfer it", async function () {
      const { registry, manager, stranger } = await withCertificate();
      await expect(
        registry.connect(manager).transferFrom(manager.address, stranger.address, 1)
      ).to.be.revertedWithCustomError(registry, "CertificateNonTransferable");
    });

    it("reverts on safeTransferFrom as well", async function () {
      const { registry, manager, stranger } = await withCertificate();
      await expect(
        registry.connect(manager)["safeTransferFrom(address,address,uint256)"](manager.address, stranger.address, 1)
      ).to.be.revertedWithCustomError(registry, "CertificateNonTransferable");
    });

    it("reverts on a transfer attempted by an approved operator", async function () {
      const { registry, manager, stranger } = await withCertificate();
      await registry.connect(manager).approve(stranger.address, 1);
      await expect(
        registry.connect(stranger).transferFrom(manager.address, stranger.address, 1)
      ).to.be.revertedWithCustomError(registry, "CertificateNonTransferable");
    });

    it("lets admin revoke a fraudulently issued certificate", async function () {
      const { registry, admin, manager } = await withCertificate();
      await expect(registry.connect(admin).revokeCertificate(1))
        .to.emit(registry, "ComplianceCertificateRevoked")
        .withArgs(1n, 1n);
      expect(await registry.balanceOf(manager.address)).to.equal(0n);
    });

    it("leaves the inspection record intact after certificate revocation", async function () {
      const { registry, admin } = await withCertificate();
      await registry.connect(admin).revokeCertificate(1);
      const inspection = await registry.inspections(1);
      expect(inspection.passed).to.equal(true);
      expect(inspection.certificateHash).to.equal(HASH);
    });

    it("reverts if a non-admin tries to revoke a certificate", async function () {
      const { registry, manager } = await withCertificate();
      await expect(registry.connect(manager).revokeCertificate(1))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(manager.address, DEFAULT_ADMIN_ROLE);
    });

    it("reverts when revoking a certificate that does not exist", async function () {
      const { registry, admin } = await withCertificate();
      await expect(registry.connect(admin).revokeCertificate(99))
        .to.be.revertedWithCustomError(registry, "UnknownCertificate")
        .withArgs(99n);
    });

    it("reverts when revoking the same certificate twice", async function () {
      const { registry, admin } = await withCertificate();
      await registry.connect(admin).revokeCertificate(1);
      await expect(registry.connect(admin).revokeCertificate(1))
        .to.be.revertedWithCustomError(registry, "CertificateAlreadyRevoked")
        .withArgs(1n);
    });

    it("resolves tokenURI from the configured base URI and certificate hash", async function () {
      const { registry, admin } = await withCertificate();
      await registry.connect(admin).setCertificateBaseURI("ipfs://");
      expect(await registry.tokenURI(1)).to.equal("ipfs://" + HASH);
    });
  });

  // ============================================================
  describe("Emergency pause", function () {
    it("blocks inspection submission while paused", async function () {
      const { registry, admin, inspector } = await withEquipment();
      await registry.connect(admin).pause();
      await expect(registry.connect(inspector).submitInspection(1, true, HASH, 365)).to.be.revertedWithCustomError(
        registry,
        "EnforcedPause"
      );
    });

    it("blocks equipment registration and incident reporting while paused", async function () {
      const { registry, admin, manager } = await withEquipment();
      await registry.connect(admin).pause();
      await expect(registry.connect(manager).registerEquipment(1, "sprinkler", "SP-001")).to.be.revertedWithCustomError(
        registry,
        "EnforcedPause"
      );
      await expect(registry.connect(manager).reportIncident(1, 0, "high", "blocked")).to.be.revertedWithCustomError(
        registry,
        "EnforcedPause"
      );
    });

    it("keeps read-only compliance queries available while paused", async function () {
      const { registry, admin, inspector } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, true, HASH, 365);
      await registry.connect(admin).pause();

      expect(await registry.isEquipmentCompliant(1)).to.equal(true);
      expect(await registry.isFacilityCompliant(1)).to.equal(true);
    });

    it("resumes normal operation after unpause", async function () {
      const { registry, admin, inspector } = await withEquipment();
      await registry.connect(admin).pause();
      await registry.connect(admin).unpause();
      await expect(registry.connect(inspector).submitInspection(1, true, HASH, 365)).to.not.be.reverted;
    });

    it("reverts if a non-admin tries to pause", async function () {
      const { registry, stranger } = await withEquipment();
      await expect(registry.connect(stranger).pause())
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(stranger.address, DEFAULT_ADMIN_ROLE);
    });
  });

  // ============================================================
  describe("Registry statistics", function () {
    it("reports accurate counts across all record types", async function () {
      const { registry, manager, inspector } = await withEquipment();
      await registry.connect(inspector).submitInspection(1, true, HASH, 365);
      await registry.connect(manager).reportIncident(1, 1, "low", "Routine test");

      const [facilities, equipmentCount, inspectionsCount, incidentsCount] = await registry.getRegistryStats();
      expect(facilities).to.equal(1n);
      expect(equipmentCount).to.equal(1n);
      expect(inspectionsCount).to.equal(1n);
      expect(incidentsCount).to.equal(1n);
    });
  });
});
