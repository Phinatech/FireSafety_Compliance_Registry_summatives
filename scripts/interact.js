// Demonstrates interacting with an already-deployed contract: submitting a passing
// inspection, checking compliance, reporting an incident, and reading registry stats.
// Usage: CONTRACT_ADDRESS=0x... npx hardhat run scripts/interact.js --network sepolia --no-compile

const hre = require("hardhat");

async function main() {
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) throw new Error("Set CONTRACT_ADDRESS env var to your deployed contract address");

  const [signer] = await hre.ethers.getSigners();
  const registry = await hre.ethers.getContractAt("FireSafetyComplianceRegistry", address, signer);

  console.log("Interacting as:", signer.address);
  console.log("Contract:", address);

  console.log("\n--- Compliance status before inspection ---");
  console.log("Equipment #1 compliant?", await registry.isEquipmentCompliant(1));
  console.log("Facility #1 compliant?", await registry.isFacilityCompliant(1));

  console.log("\n--- Submitting inspection (pass, 365-day validity) ---");
  const tx1 = await registry.submitInspection(1, true, "b94d27b9934d3e08a52e52d7da7dabfa", 365);
  const receipt1 = await tx1.wait();
  console.log("Tx hash:", receipt1.hash);
  console.log("Gas used:", receipt1.gasUsed.toString());

  console.log("\n--- Compliance status after inspection ---");
  console.log("Equipment #1 compliant?", await registry.isEquipmentCompliant(1));
  console.log("Facility #1 compliant?", await registry.isFacilityCompliant(1));
  console.log("Certificate #1 owner:", await registry.ownerOf(1));
  console.log("Certificate #1 -> inspection #:", (await registry.certificateToInspection(1)).toString());

  console.log("\n--- Verifying certificates are soulbound ---");
  try {
    await registry.transferFrom(signer.address, "0x000000000000000000000000000000000000dEaD", 1);
    console.log("ERROR: transfer unexpectedly succeeded");
  } catch (e) {
    console.log("Transfer correctly rejected:", e.shortMessage || "CertificateNonTransferable");
  }

  console.log("\n--- Reporting a test incident ---");
  const tx2 = await registry.reportIncident(1, 1, "low", "Routine smoke test triggered detector SD-DEMO-001");
  const receipt2 = await tx2.wait();
  console.log("Tx hash:", receipt2.hash);
  console.log("Facility #1 incident ids:", (await registry.getFacilityIncidents(1)).map((i) => i.toString()));

  console.log("\n--- Registry statistics ---");
  const [f, e, i, n] = await registry.getRegistryStats();
  console.log(`Facilities: ${f} | Equipment: ${e} | Inspections: ${i} | Incidents: ${n}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
