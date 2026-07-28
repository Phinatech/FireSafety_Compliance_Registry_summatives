// Deploys FireSafetyComplianceRegistry and, for convenience, sets up a small
// demo scenario (one inspector, one facility) so the report/demo video has
// something immediate to show. Safe to skip the demo part by commenting it out.

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  const Registry = await hre.ethers.getContractFactory("FireSafetyComplianceRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("\nFireSafetyComplianceRegistry deployed to:", address);
  console.log("Admin (DEFAULT_ADMIN_ROLE):", deployer.address);

  console.log("\n--- Demo setup (comment out in scripts/deploy.js if not wanted) ---");

  const tx1 = await registry.registerInspector(deployer.address);
  await tx1.wait();
  console.log("Registered deployer as an inspector (demo convenience).");

  const tx2 = await registry.registerFacility("Demo Community Clinic", "Kigali, Rwanda", deployer.address);
  const receipt2 = await tx2.wait();
  console.log("Registered demo facility 'Demo Community Clinic' (facilityId 1).");

  const tx3 = await registry.registerEquipment(1, "smoke_detector", "SD-DEMO-001");
  await tx3.wait();
  console.log("Registered demo equipment (equipmentId 1).");

  console.log("\nNext: verify on Etherscan, then use the deployed address to run");
  console.log("scripts/interact.js or the Hardhat console for the report screenshots.");
  console.log("\nSave this deployed address — you'll need it for verification and the report:");
  console.log(address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
