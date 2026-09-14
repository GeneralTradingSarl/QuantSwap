require("@nomicfoundation/hardhat-toolbox");
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
  },
  gasReporter: { enabled: process.env.REPORT_GAS === "true" },
  mocha: { timeout: 120000 },
};
