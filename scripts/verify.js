/**
 * Verifies the deployed contracts on the network's block explorer.
 *
 * Reads the addresses from deployments/<network>.json, so it cannot drift from what was
 * actually deployed, and tolerates a contract that is already verified: re-running this
 * after a partial failure should finish the job rather than abort on the first success.
 *
 *   npx hardhat run scripts/verify.js --network sepolia
 */
const fs = require("node:fs");
const path = require("node:path");
const { network, run } = require("hardhat");

const ONE_HOUR = 3600;
const TWAP_GRANULARITY = 6;

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No deployment for ${network.name}. Run scripts/deploy.js first.`);
  }

  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const { factory, router, weth, oracle } = deployment.contracts;

  const targets = [
    { name: "QuantSwapFactory", address: factory, args: [deployment.deployer ?? (await firstSigner())] },
    { name: "QuantSwapRouter", address: router, args: [factory, weth] },
    { name: "QuantSwapOracle", address: oracle, args: [factory, ONE_HOUR, TWAP_GRANULARITY] },
  ];

  for (const [key, token] of Object.entries(deployment.tokens ?? {})) {
    if (key === "weth") {
      targets.push({ name: "WETH9", address: token.address, args: [] });
      continue;
    }
    targets.push({
      name: "MockERC20",
      address: token.address,
      // The supply argument is not recorded in the deployment file, so a mock that fails to
      // verify is reported and skipped rather than blocking the contracts that matter.
      args: null,
    });
  }

  for (const target of targets) {
    if (!target.address || target.args === null) {
      console.log(`skipping ${target.name}: constructor arguments not recorded`);
      continue;
    }

    try {
      await run("verify:verify", { address: target.address, constructorArguments: target.args });
      console.log(`verified ${target.name} at ${target.address}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already verified/i.test(message)) {
        console.log(`${target.name} was already verified`);
      } else {
        console.error(`could not verify ${target.name}: ${message}`);
      }
    }
  }
}

async function firstSigner() {
  const { ethers } = require("hardhat");
  const [signer] = await ethers.getSigners();
  return signer.address;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
