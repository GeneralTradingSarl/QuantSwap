require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// This sandbox has no egress to binaries.soliditylang.org, so Hardhat cannot download a
// compiler. The solc npm package ships the same compiler as a wasm build, so point Hardhat
// at that instead. Behaviour is identical; only the download is skipped.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === SOLC_VERSION) {
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: SOLC_LONG_VERSION,
    };
  }
  return runSuper();
});

/**
 * A test network is only declared when both its RPC URL and a key are present, so a missing
 * .env produces a clear "network not configured" instead of a confusing connection error.
 */
function testnet(name, url, chainId) {
  if (!url || !process.env.PRIVATE_KEY) return {};
  return { [name]: { url, chainId, accounts: [process.env.PRIVATE_KEY] } };
}

const SOLC_VERSION = "0.8.28";
const SOLC_LONG_VERSION = require("solc").version();

module.exports = {
  solidity: {
    version: SOLC_VERSION,
    settings: {
      optimizer: { enabled: true, runs: 999999 },
      viaIR: false,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: { allowUnlimitedContractSize: false },
    localhost: { url: "http://127.0.0.1:8545" },
    ...testnet("sepolia", process.env.SEPOLIA_RPC_URL, 11155111),
    ...testnet("baseSepolia", process.env.BASE_SEPOLIA_RPC_URL, 84532),
    ...testnet("arbitrumSepolia", process.env.ARBITRUM_SEPOLIA_RPC_URL, 421614),
  },
  etherscan: {
    // One key covers every explorer on the Etherscan v2 API. A missing key is not an error
    // until `verify` is actually run, so a fresh clone can still compile and test.
    apiKey: process.env.ETHERSCAN_API_KEY ?? "",
  },
  sourcify: { enabled: false },
  gasReporter: { enabled: process.env.REPORT_GAS === "true" },
  mocha: { timeout: 120000 },
};
