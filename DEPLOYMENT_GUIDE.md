# Deployment Guide — FireSafetyComplianceRegistry

## 1. Prerequisites

- Node.js 18+ and npm
- MetaMask browser extension, with a wallet dedicated to testing (never a wallet holding real funds)
- A free Sepolia RPC endpoint — sign up at [Alchemy](https://www.alchemy.com) or [Infura](https://www.infura.io) and create a Sepolia app to get a URL
- Sepolia test ETH — get some free from a faucet such as [Google Cloud's Sepolia faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [Alchemy's Sepolia faucet](https://www.alchemy.com/faucets/ethereum-sepolia) (send it to your MetaMask address)
- A free [Etherscan](https://etherscan.io/register) account and API key, for contract verification

## 2. Install dependencies

```bash
npm install
```

## 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `SEPOLIA_RPC_URL` — from Alchemy/Infura
- `PRIVATE_KEY` — from MetaMask (Account details → Show private key)
- `ETHERSCAN_API_KEY` — from Etherscan

**`.env` is already in `.gitignore` — never commit it or paste a real private key anywhere public.**

## 4. Compile

Try the normal path first:

```bash
npx hardhat compile
```

If that fails with an error mentioning `binaries.soliditylang.org` or "couldn't download compiler" (a network-egress restriction some sandboxed environments have — this is what happened when I built and tested this project), use the included fallback instead, which compiles via the `solc` npm package directly:

```bash
node compile-manual.js
```

Either path produces the same result: compiled artifacts in `artifacts/contracts/`.

## 5. Run the test suite

```bash
npx hardhat test --no-compile
```

You should see **74 passing** tests across 10 groups, covering access control, facility scoping, compliance logic and expiry, input validation, certificate revocation, soulbinding, emergency pause, and incident reporting. (`--no-compile` skips Hardhat's own compile step since step 4 already produced the artifacts — drop the flag only if `npx hardhat compile` worked normally for you in step 4.)

## 6. Deploy to Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia --no-compile
```

This deploys the contract, prints the deployed address, and registers a small demo scenario (one inspector, one facility, one piece of equipment) so there's immediately something to interact with. **Copy the deployed address that gets printed** — you'll need it for the next steps and for your report.

## 7. Verify on Etherscan

```bash
npx hardhat verify --network sepolia <DEPLOYED_ADDRESS> <YOUR_WALLET_ADDRESS>
```

Replace `<YOUR_WALLET_ADDRESS>` with the same address you deployed from (it's the constructor's `admin` argument). If `hardhat verify` also hits a network-download error, verify manually instead: go to your contract's page on [sepolia.etherscan.io](https://sepolia.etherscan.io), click "Verify and Publish," choose compiler `0.8.24`, optimizer **on** with **200 runs**, EVM version **cancun**, and paste the flattened source (`npx hardhat flatten contracts/FireSafetyComplianceRegistry.sol > flattened.sol` first).

## 8. Interact with the deployed contract

```bash
CONTRACT_ADDRESS=<DEPLOYED_ADDRESS> npx hardhat run scripts/interact.js --network sepolia --no-compile
```

This submits a passing inspection, shows the compliance status flip to `true`, shows the soulbound certificate's owner, and reports a test incident — good source material for terminal-output screenshots.

## 9. What to capture for the report

- [ ] Terminal output of `npx hardhat test` (74 passing)
- [ ] Terminal output of the deploy script showing the deployed address
- [ ] Etherscan page showing the verified contract (green checkmark) on Sepolia
- [ ] Terminal output of `scripts/interact.js`
- [ ] MetaMask (or Etherscan's "Read Contract" tab) showing `isFacilityCompliant` returning `true`
- [ ] Etherscan's NFT/token view showing the compliance certificate minted to the facility manager's address
