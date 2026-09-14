# Deploying

Two paths. The GitHub Actions one needs nothing installed locally; the local one is faster
when you are iterating.

## What you need first

| Thing | Where | Note |
|---|---|---|
| A funded test wallet | Any wallet, exported private key | Use a key that has never touched mainnet. It goes into a CI secret |
| Test ETH | [sepoliafaucet.com](https://sepoliafaucet.com), [Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) | About 0.05 ETH covers the full deployment with room to spare |
| An RPC endpoint | Alchemy, Infura, or a public one | A public endpoint is fine for a deploy; it is not fine for an indexer |
| An Etherscan API key | [etherscan.io/apis](https://etherscan.io/apis) | One key now works across their explorers; only needed for verification |

## Path A: from GitHub, nothing installed

Set four repository secrets under **Settings → Secrets and variables → Actions**:

`PRIVATE_KEY`, `SEPOLIA_RPC_URL`, `ETHERSCAN_API_KEY`, and the RPC URL of any other network
you plan to use.

Then **Actions → Deploy to a test network → Run workflow**, pick the network, run it. It:

1. runs the test suite, and stops there if anything is red,
2. deploys the factory, WETH, router and oracle, then seeds mock tokens and four pools,
3. verifies the contracts on the explorer,
4. regenerates `web/generated` so the interface matches what was deployed,
5. commits `deployments/<network>.json` back to the repository,
6. prints the addresses in the job summary.

The deployment record in the repository is what the interface and the indexer read, so after
that run there is no address to copy anywhere by hand.

## Path B: locally

```bash
cp .env.example .env     # fill PRIVATE_KEY and SEPOLIA_RPC_URL
npm ci
npm test

npx hardhat run scripts/deploy.js --network sepolia
npx hardhat run scripts/verify.js --network sepolia
node scripts/export-frontend.js
```

## Running the indexer against it

```bash
NETWORK=sepolia RPC_URL=$SEPOLIA_RPC_URL npm run indexer
```

It reads `deployments/sepolia.json`, backfills from the deployment block and follows the
head. On a public RPC, keep `LOG_RANGE` at or below 2000: most providers cap `eth_getLogs`
spans and answer a wider query with an error rather than a truncated result.

## Pointing the interface at it

The app tries the indexer, then the chain, then its demo snapshot. For a real deployment set:

```
NEXT_PUBLIC_INDEXER_URL=https://your-indexer.example.com
NEXT_PUBLIC_DEFAULT_CHAIN_ID=11155111
NEXT_PUBLIC_DEMO=0
```

On Vercel, either set the project's root directory to `web`, or leave it at the repository
root and let the root `vercel.json` build `web/` for you. Both are configured.

## After deploying

- **The deployer key still controls `feeToSetter`.** It cannot touch user funds or pause
  anything, but on a deployment that matters it belongs behind a multisig.
- **Seeded liquidity is mock tokens.** Anyone can mint them; the pools are for demonstration
  and their prices mean nothing.
- **Nothing here is audited.** The README says so, and a testnet deployment does not change
  it.
