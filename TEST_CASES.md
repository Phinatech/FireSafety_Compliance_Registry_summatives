# Test Cases, FireSafetyComplianceRegistry

All tests run with `npx hardhat test` against Hardhat's local EVM.

**Result: 74 / 74 passing. 0 failing.**

| Metric | Value |
|---|---|
| Total test cases | 74 |
| Passing | 74 |
| Failing | 0 |
| Test groups | 10 |
| Compiler warnings | 0 |

---

## Deployment

Contract initialises correctly and exposes the expected interfaces and constants.

| # | Test case (expected behaviour) | Result |
|---|---|---|
| 1 | grants DEFAULT_ADMIN_ROLE to the specified admin | Pass |
| 2 | sets the correct NFT name and symbol for compliance certificates | Pass |
| 3 | reverts if deployed with the zero address as admin | Pass |
| 4 | exposes the documented validity-period bounds | Pass |
| 5 | supports the ERC721 and AccessControl interfaces | Pass |

## Inspector management

Only the regulator can authorise or withdraw inspector status, and withdrawal is forward-looking and never rewrites history.

| # | Test case (expected behaviour) | Result |
|---|---|---|
| 6 | lets admin register an inspector | Pass |
| 7 | reverts if a non-admin tries to register an inspector | Pass |
| 8 | reverts when registering the zero address as an inspector | Pass |
| 9 | lets admin revoke an inspector | Pass |
| 10 | blocks a revoked inspector from submitting further inspections | Pass |
| 11 | preserves inspections already submitted by a revoked inspector | Pass |

## Facility registration

Facility onboarding validates all inputs, and manager reassignment provides key-loss recovery without weakening scoping.

| # | Test case (expected behaviour) | Result |
|---|---|---|
| 12 | lets admin register a facility and grants the manager role | Pass |
| 13 | reverts if a non-admin tries to register a facility | Pass |
| 14 | reverts on a zero-address manager | Pass |
| 15 | reverts on an empty facility name | Pass |
| 16 | reverts on an empty location | Pass |
| 17 | lets admin reassign a facility to a new manager (key-loss recovery) | Pass |
| 18 | locks out the old manager after reassignment | Pass |
| 19 | reverts when reassigning an unregistered facility | Pass |

## Equipment registration

Equipment can only be registered by the facility that owns it, with all string inputs validated.

| # | Test case (expected behaviour) | Result |
|---|---|---|
| 20 | lets the facility's manager register equipment | Pass |
| 21 | reverts if called by someone other than that facility's manager | Pass |
| 22 | reverts for an unregistered facility id | Pass |
| 23 | reverts on an empty equipment type | Pass |
| 24 | reverts on an empty serial number | Pass |

## Equipment decommissioning

Decommissioning removes equipment from compliance evaluation without destroying its audit trail.

| # | Test case (expected behaviour) | Result |
|---|---|---|
| 25 | lets the facility manager decommission equipment | Pass |
| 26 | reverts if a non-manager tries to decommission | Pass |
| 27 | reverts when decommissioning equipment twice | Pass |
| 28 | rejects new inspections on decommissioned equipment | Pass |
| 29 | excludes decommissioned equipment from facility compliance | Pass |
| 30 | preserves the inspection history of decommissioned equipment | Pass |

## Inspections and compliance

The core logic: who may inspect, what is recorded, and how compliance is derived and expires.

| # | Test case (expected behaviour) | Result |
|---|---|---|
| 31 | is not compliant before any inspection | Pass |
| 32 | becomes compliant after a passing inspection and mints a certificate | Pass |
| 33 | links the minted certificate back to its originating inspection | Pass |
| 34 | stays non-compliant after a failing inspection and mints no certificate | Pass |
| 35 | records a failing inspection permanently rather than omitting it | Pass |
| 36 | reverts if a non-inspector tries to submit an inspection | Pass |
| 37 | reverts for equipment that was never registered | Pass |
| 38 | reverts on a passing inspection with an empty certificate hash | Pass |
| 39 | reverts on a validity period below the minimum | Pass |
| 40 | reverts on a validity period above the maximum | Pass |
| 41 | becomes non-compliant again once the validity period expires | Pass |
| 42 | is restored to compliant by a fresh passing re-inspection after expiry | Pass |
| 43 | tracks latestInspectionOf as the most recent submission | Pass |
| 44 | treats a later failure as overriding an earlier pass | Pass |
| 45 | facility is compliant only when every piece of equipment is compliant | Pass |
| 46 | reports false for a facility with no registered equipment | Pass |
| 47 | does not let one facility's manager inspect via another's equipment | Pass |

## Incident reporting

Append-only logging, scoped to authorised parties, with referenced equipment verified to belong to the reporting facility.

| # | Test case (expected behaviour) | Result |
|---|---|---|
| 48 | lets the facility manager report an incident | Pass |
| 49 | lets the admin report an incident on behalf of any facility | Pass |
| 50 | reverts if reported by someone unrelated to the facility | Pass |
| 51 | reverts for an unregistered facility | Pass |
| 52 | reverts on an empty severity | Pass |
| 53 | reverts on an empty description | Pass |
| 54 | accepts equipmentId 0 as 'not attributable to specific equipment' | Pass |
| 55 | accepts equipment that genuinely belongs to the facility | Pass |
| 56 | reverts when the incident references another facility's equipment | Pass |
| 57 | reverts when the incident references equipment that does not exist | Pass |
| 58 | still allows incidents against decommissioned equipment at the same facility | Pass |
| 59 | keeps an append-only incident history | Pass |

## Soulbound compliance certificates

Certificates cannot be transferred by any route, but can be revoked by the regulator for fraud.

| # | Test case (expected behaviour) | Result |
|---|---|---|
| 60 | reverts when a certificate holder tries to transfer it | Pass |
| 61 | reverts on safeTransferFrom as well | Pass |
| 62 | reverts on a transfer attempted by an approved operator | Pass |
| 63 | lets admin revoke a fraudulently issued certificate | Pass |
| 64 | leaves the inspection record intact after certificate revocation | Pass |
| 65 | reverts if a non-admin tries to revoke a certificate | Pass |
| 66 | reverts when revoking a certificate that does not exist | Pass |
| 67 | reverts when revoking the same certificate twice | Pass |
| 68 | resolves tokenURI from the configured base URI and certificate hash | Pass |

## Emergency pause

The emergency stop halts all submissions while leaving compliance queries readable.

| # | Test case (expected behaviour) | Result |
|---|---|---|
| 69 | blocks inspection submission while paused | Pass |
| 70 | blocks equipment registration and incident reporting while paused | Pass |
| 71 | keeps read-only compliance queries available while paused | Pass |
| 72 | resumes normal operation after unpause | Pass |
| 73 | reverts if a non-admin tries to pause | Pass |

## Registry statistics

Aggregate counters report accurately across all record types.

| # | Test case (expected behaviour) | Result |
|---|---|---|
| 74 | reports accurate counts across all record types | Pass |

---

## Coverage notes

- **Access control** every role-gated function is tested from both sides: an authorised caller succeeding and an unauthorised caller reverting with the specific expected error.
- **Facility scoping** tests confirm that holding FACILITY_MANAGER_ROLE is not by itself sufficient; a manager at one facility cannot act on another.
- **Referential integrity** an incident naming equipment is verified against that equipment actually belonging to the reporting facility, covering the cross-facility case and the nonexistent-id case.
- **Time-dependent behaviour** expiry is verified by advancing the chain clock past the validity window, then confirming a fresh inspection restores compliance.
- **Input validation** zero addresses, empty strings, and out-of-bounds validity periods each assert the specific custom error and its arguments.
- **Soulbound property** tested across all three transfer routes (transferFrom, safeTransferFrom, approved operator).
- **State transitions** facility-level compliance is walked through four distinct states rather than asserted at a single point.

## Verified manually rather than by automated test

- Gas costs under real network conditions
- Etherscan source verification
- MetaMask wallet interaction and certificate visibility

See `DEPLOYMENT_GUIDE.md` for the screenshot checklist covering these.
