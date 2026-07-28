// Manual compilation via the solc npm package (bypasses Hardhat's compiler
// binary downloader, which needs network access to binaries.soliditylang.org).
// Produces artifacts in Hardhat's expected format so `npx hardhat test --no-compile`
// and `npx hardhat run scripts/...` work normally afterwards.

const fs = require("fs");
const path = require("path");
const solc = require("solc");

const CONTRACTS_DIR = path.join(__dirname, "contracts");
const ARTIFACTS_DIR = path.join(__dirname, "artifacts");

function findImports(importPath) {
  try {
    let resolvedPath;
    if (importPath.startsWith("@openzeppelin/")) {
      resolvedPath = path.join(__dirname, "node_modules", importPath);
    } else if (importPath.startsWith(".")) {
      resolvedPath = path.join(CONTRACTS_DIR, importPath);
    } else {
      resolvedPath = path.join(CONTRACTS_DIR, importPath);
    }
    return { contents: fs.readFileSync(resolvedPath, "utf8") };
  } catch (e) {
    return { error: "File not found: " + importPath };
  }
}

function compileContract(fileName) {
  const contractPath = path.join(CONTRACTS_DIR, fileName);
  const source = fs.readFileSync(contractPath, "utf8");

  const input = {
    language: "Solidity",
    sources: {
      [fileName]: { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"],
        },
      },
    },
  };

  console.log(`Compiling ${fileName} ...`);
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  let hasError = false;
  if (output.errors) {
    for (const err of output.errors) {
      console.log(`  [${err.severity}] ${err.formattedMessage}`);
      if (err.severity === "error") hasError = true;
    }
  }
  if (hasError) {
    console.log(`FAILED: ${fileName}`);
    return false;
  }

  const contractsInFile = output.contracts[fileName];
  for (const contractName of Object.keys(contractsInFile)) {
    const contract = contractsInFile[contractName];
    const artifact = {
      _format: "hh-sol-artifact-1",
      contractName,
      sourceName: `contracts/${fileName}`,
      abi: contract.abi,
      bytecode: "0x" + contract.evm.bytecode.object,
      deployedBytecode: "0x" + contract.evm.deployedBytecode.object,
      linkReferences: contract.evm.bytecode.linkReferences || {},
      deployedLinkReferences: contract.evm.deployedBytecode.linkReferences || {},
    };

    const outDir = path.join(ARTIFACTS_DIR, "contracts", fileName);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${contractName}.json`), JSON.stringify(artifact, null, 2));
    console.log(`  wrote artifacts/contracts/${fileName}/${contractName}.json`);
  }

  // Minimal build-info + debug file so hardhat tooling that looks for them doesn't choke
  const outDir = path.join(ARTIFACTS_DIR, "contracts", fileName);
  fs.writeFileSync(
    path.join(outDir, `${Object.keys(contractsInFile)[0]}.dbg.json`),
    JSON.stringify({ _format: "hh-sol-dbg-1", buildInfo: "../../../build-info/manual.json" }, null, 2)
  );

  return true;
}

// Compile every .sol file directly under contracts/
const files = fs.readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith(".sol"));
let allOk = true;
for (const file of files) {
  const ok = compileContract(file);
  allOk = allOk && ok;
}

if (!allOk) {
  console.log("\nCompilation finished with errors.");
  process.exit(1);
}
console.log("\nAll contracts compiled successfully.");
