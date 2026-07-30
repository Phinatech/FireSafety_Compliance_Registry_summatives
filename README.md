# FireSafetyComplianceRegistry

A tamper-evident Ethereum registry for fire-safety equipment inspections and fire/smoke incidents in **healthcare facilities**.

**Blockchain Development, Individual Assignment | African Leadership University**
Author: Chinemerem Judith Ugbo · Application area: **Healthcare**

---

## The problem

Hospitals, clinics, and nursing homes are legally required to keep fire-safety equipment (smoke detectors, extinguishers, sprinklers, alarm panels) inspected and certified. But those compliance records are held by the very party being regulated: on paper, in spreadsheets, or in facility-controlled software. Records can be lost, back-dated, or quietly amended after an adverse event.

The risk lands on the occupants least able to escape it. ICU patients, patients under anaesthesia, neonates, and mobility-impaired patients cannot self-evacuate; they depend entirely on the building's detection and suppression systems working, and on staff having enough warning for assisted evacuation. When a smoke detector has silently been out of certification for eight months and the paperwork says otherwise, the people bearing that risk are the ones who can least act on it.

## The solution

A Solidity smart contract that makes the compliance record itself tamper-evident. Regulators onboard facilities and authorise inspectors; inspectors submit outcomes; the contract derives compliance status automatically and issues a non-transferable certificate on each pass; facilities log incidents to an append-only history. No participant, including the regulator who deployed it, can alter or delete a submitted record.

### Why blockchain and not a database

A centralised database would be cheaper and faster. What it cannot provide is the guarantee that matters here: that the record was not altered by whoever controls the database. Every stakeholder in this system has both a motive and, in a centralised design, an opportunity to revise history: a facility facing a failed inspection before a regulatory visit, an inspector who certified equipment that later failed, an insurer disputing a claim. A blockchain removes the opportunity.

### What deliberately stays off-chain

Real-time smoke and fire **detection** stays in the IoT hardware and the building's local alarm panel. Ethereum's ~12-second block time and per-transaction gas cost make it unsuitable for continuous sensor telemetry or for triggering an evacuation alarm; an on-chain detection design would be slower and less reliable than the hardware it replaced.

Hardware detects and alarms in real time. The blockchain records verified events after the fact and derives compliance state. **The contract is the trust layer, not the control loop.**

---

## Features

| Feature | Description |
|---|---|
| **Role-based access control** | Three roles (regulator, inspector, facility manager) enforced on every state-changing function |
| **Facility-scoped authority** | Role membership alone is insufficient; the caller must be the manager of record for that specific facility |
| **Immutable inspection history** | Inspections are appended, never overwritten. Failures are recorded permanently, not omitted |
| **Derived compliance with expiry** | Compliance is computed at read time, so a lapsed certification takes effect automatically |
| **Soulbound certificates (ERC-721)** | A pass mints a non-transferable certificate to the facility manager as portable proof |
| **Certificate revocation** | The regulator can burn a fraudulently issued certificate while leaving the inspection record visible |
| **Tamper-proof incident log** | Append-only fire/smoke incident records, cross-referenceable against inspection history |
| **Emergency pause** | Halts submissions if an inspector key is compromised; compliance queries stay readable |
| **Key-loss recovery** | Facilities can be reassigned to a new manager address |

## Security measures

- OpenZeppelin `AccessControl` on every state-changing function
- `ReentrancyGuard` on `submitInspection`, which makes an external call via ERC-721 `_safeMint`
- Checks-Effects-Interactions ordering throughout
- `Pausable` emergency stop
- Input validation: zero addresses, empty strings, bounded validity periods
- Custom errors rather than revert strings (lower deployment and revert gas)
- Timestamps from `block.timestamp` only, submissions cannot be back-dated

---

## Quick start

```bash
npm install
cp .env.example .env        # fill in SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY

npx hardhat compile
npx hardhat test
```

### Deploy to Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
npx hardhat verify --network sepolia <DEPLOYED_ADDRESS> <ADMIN_ADDRESS>
CONTRACT_ADDRESS=<DEPLOYED_ADDRESS> npx hardhat run scripts/interact.js --network sepolia
```

### Live deployment

This contract is deployed and source-verified on the Ethereum Sepolia testnet.

| | |
|---|---|
| **Contract** | [`0x54748826C574c4B6f2Bc2fCB3085291425c601c8`](https://sepolia.etherscan.io/address/0x54748826C574c4B6f2Bc2fCB3085291425c601c8#code) |
| **Admin (regulator)** | `0xcCb3eaE69cE584a60d5d8F39cF7aC9F15efA584B` |
| **Deployment tx** | `0x790bdffba74d4fbbe1d74092e1bc05d0106fc15171da4acbe3ae8a7e0f5eac32` |
| **Verification** | Exact Match |

To reproduce the interaction run against the live contract:

```bash
CONTRACT_ADDRESS=0x54748826C574c4B6f2Bc2fCB3085291425c601c8 \
  npx hardhat run scripts/interact.js --network sepolia
```

Full walkthrough including faucets and manual verification: **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)**

---

## Testing

**74 tests, all passing.** Full case-by-case documentation: **[TEST_CASES.md](TEST_CASES.md)**

| Group | Tests |
|---|---|
| Deployment | 5 |
| Inspector management | 6 |
| Facility registration | 8 |
| Equipment registration | 5 |
| Equipment decommissioning | 6 |
| Inspections and compliance | 17 |
| Incident reporting | 12 |
| Soulbound compliance certificates | 9 |
| Emergency pause | 5 |
| Registry statistics | 1 |

---

## Contract API

### Regulator (`DEFAULT_ADMIN_ROLE`)

| Function | Purpose |
|---|---|
| `registerInspector(address)` | Authorise a licensed inspector |
| `revokeInspector(address)` | Withdraw authorisation (history preserved) |
| `registerFacility(name, location, manager)` | Onboard a healthcare facility |
| `updateFacilityManager(facilityId, newManager)` | Reassign a facility (key-loss recovery) |
| `revokeCertificate(tokenId)` | Burn a fraudulently issued certificate |
| `setCertificateBaseURI(string)` | Configure certificate metadata resolution |
| `pause()` / `unpause()` | Emergency stop |

### Inspector (`INSPECTOR_ROLE`)

| Function | Purpose |
|---|---|
| `submitInspection(equipmentId, passed, certificateHash, validityPeriodDays)` | Record an outcome; mints a certificate on a pass |

### Facility manager

| Function | Purpose |
|---|---|
| `registerEquipment(facilityId, type, serial)` | Register equipment at own facility |
| `decommissionEquipment(equipmentId)` | Retire equipment from compliance evaluation |
| `reportIncident(facilityId, equipmentId, severity, description)` | Log a fire/smoke incident |

### Public views

| Function | Returns |
|---|---|
| `isEquipmentCompliant(equipmentId)` | Latest inspection passed and unexpired |
| `isFacilityCompliant(facilityId)` | Every active piece of equipment is compliant |
| `getEquipmentInspectionHistory(equipmentId)` | All inspection IDs, oldest first |
| `getFacilityEquipment(facilityId)` | All equipment IDs |
| `getFacilityIncidents(facilityId)` | All incident IDs, oldest first |
| `getRegistryStats()` | Facility, equipment, inspection, and incident counts |

---

## Project structure

```
contracts/FireSafetyComplianceRegistry.sol   Main smart contract
scripts/deploy.js                            Deployment + demo setup
scripts/interact.js                          Post-deployment demonstration
test/FireSafetyComplianceRegistry.test.js    74-case test suite
hardhat.config.js                            Network and compiler config
DEPLOYMENT_GUIDE.md                          Step-by-step deployment guide
TEST_CASES.md                                Test case documentation
```

## Tech stack

Solidity 0.8.24 · OpenZeppelin Contracts v5.6.1 · Hardhat 2.28.6 · Mocha + Chai · Ethereum Sepolia

> **EVM version must be `cancun`** OpenZeppelin v5 emits the `MCOPY` opcode. Already set in `hardhat.config.js`.

## Known limitations

- **The oracle problem.** The contract guarantees a recorded inspection cannot be altered afterwards; it cannot guarantee the inspector physically visited the site. Mitigated by regulatory licensing of inspector addresses, revocation powers, and cross-referencing incidents against inspection history.
- **Gas scales with facility size.** `isFacilityCompliant` iterates all equipment, free as an off-chain view call, expensive if called on-chain.
- **Public data.** Facility names, locations, and incident descriptions are readable by anyone. Acceptable (arguably desirable) for fire safety; any extension toward patient data would need a different privacy design.

## License

MIT
