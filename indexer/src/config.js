import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");

/**
 * Indexer configuration. Addresses come from the deployment file the deploy script writes,
 * so there is exactly one place where a contract address is recorded.
 */
export function loadConfig(env = process.env) {
  const networkName = env.NETWORK ?? "localhost";
  const deploymentFile = path.join(repoRoot, "deployments", `${networkName}.json`);

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(
      `No deployment for network "${networkName}" at ${deploymentFile}. ` +
        `Run: npx hardhat run scripts/deploy.js --network ${networkName}`
    );
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));

  return {
    networkName,
    deployment,
    rpcUrl: env.RPC_URL ?? "http://127.0.0.1:8545",
    databasePath: env.DATABASE_PATH ?? path.join(here, "..", `${networkName}.db`),
    apiPort: Number(env.API_PORT ?? 4000),
    // How far behind the head we consider a block final enough to stop re-checking.
    confirmations: Number(env.CONFIRMATIONS ?? 5),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 2000),
    // Chunk size for historical log queries. Public RPCs commonly cap this.
    logRange: BigInt(env.LOG_RANGE ?? 2000),
  };
}
