/**
 * Deploys the full QuantSwap stack and writes the addresses to deployments/<network>.json,
 * which is the single source of truth consumed by the web app and the indexer.
 *
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network sepolia
 *
 * On a local or test network it also deploys mock tokens and seeds liquidity, so the
 * interface has something to show a minute after `npm run node`.
 */
const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

const TEST_NETWORKS = new Set(["hardhat", "localhost", "sepolia", "baseSepolia", "arbitrumSepolia"]);
const ONE_HOUR = 3600;
const TWAP_GRANULARITY = 6;

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  log(`network ${network.name} (chain ${chainId}), deployer ${deployer.address}`);

  const factory = await deploy("QuantSwapFactory", [deployer.address]);
  const weth = process.env.WETH_ADDRESS
    ? await ethers.getContractAt("WETH9", process.env.WETH_ADDRESS)
    : await deploy("WETH9", []);
  const router = await deploy("QuantSwapRouter", [await factory.getAddress(), await weth.getAddress()]);
  const oracle = await deploy("QuantSwapOracle", [await factory.getAddress(), ONE_HOUR, TWAP_GRANULARITY]);

  const deployment = {
    chainId,
    network: network.name,
    deployedAt: new Date().toISOString(),
    startBlock: await ethers.provider.getBlockNumber(),
    contracts: {
      factory: await factory.getAddress(),
      router: await router.getAddress(),
      weth: await weth.getAddress(),
      oracle: await oracle.getAddress(),
    },
    pairCodeHash: await factory.pairCodeHash(),
    tokens: {},
    pairs: [],
  };

  if (TEST_NETWORKS.has(network.name)) {
    await seedTestEnvironment({ deployment, deployer, factory, router, weth });
  }

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(deployment, null, 2)}\n`);
  log(`wrote ${path.relative(process.cwd(), outFile)}`);
}

async function seedTestEnvironment({ deployment, deployer, factory, router, weth }) {
  const specs = [
    { key: "usdc", name: "QuantSwap USD", symbol: "qUSDC", decimals: 6, supply: "10000000" },
    { key: "wbtc", name: "QuantSwap BTC", symbol: "qWBTC", decimals: 8, supply: "1000" },
    { key: "qst", name: "QuantSphere Token", symbol: "QST", decimals: 18, supply: "5000000" },
  ];

  const tokens = {};
  for (const spec of specs) {
    const token = await deploy("MockERC20", [
      spec.name,
      spec.symbol,
      spec.decimals,
      ethers.parseUnits(spec.supply, spec.decimals),
    ]);
    tokens[spec.key] = { ...spec, address: await token.getAddress(), contract: token };
    deployment.tokens[spec.key] = {
      address: await token.getAddress(),
      symbol: spec.symbol,
      name: spec.name,
      decimals: spec.decimals,
    };
  }
  deployment.tokens.weth = {
    address: await weth.getAddress(),
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
  };

  // Prices chosen to look like a real book: ETH 3,000 USDC, BTC 60,000 USDC, QST 0.50 USDC.
  const pools = [
    { a: "weth", b: "usdc", amountA: "30", amountB: "90000" },
    { a: "wbtc", b: "usdc", amountA: "2", amountB: "120000" },
    { a: "qst", b: "usdc", amountA: "200000", amountB: "100000" },
    { a: "qst", b: "weth", amountA: "60000", amountB: "10" },
  ];

  const routerAddress = await router.getAddress();
  const wethAmount = pools
    .filter((p) => p.a === "weth" || p.b === "weth")
    .reduce((sum, p) => sum + Number(p.a === "weth" ? p.amountA : p.amountB), 0);
  await (await weth.deposit({ value: ethers.parseEther(String(wethAmount)) })).wait();
  await (await weth.approve(routerAddress, ethers.MaxUint256)).wait();
  for (const token of Object.values(tokens)) {
    await (await token.contract.approve(routerAddress, ethers.MaxUint256)).wait();
  }

  const addressOf = (key) => (key === "weth" ? deployment.tokens.weth.address : tokens[key].address);
  const decimalsOf = (key) => (key === "weth" ? 18 : tokens[key].decimals);

  for (const pool of pools) {
    await (
      await router.addLiquidity(
        addressOf(pool.a),
        addressOf(pool.b),
        ethers.parseUnits(pool.amountA, decimalsOf(pool.a)),
        ethers.parseUnits(pool.amountB, decimalsOf(pool.b)),
        0,
        0,
        deployer.address,
        Math.floor(Date.now() / 1000) + 3600
      )
    ).wait();

    const pairAddress = await factory.getPair(addressOf(pool.a), addressOf(pool.b));
    deployment.pairs.push({
      address: pairAddress,
      token0: addressOf(pool.a),
      token1: addressOf(pool.b),
      label: `${symbolOf(deployment, pool.a)}/${symbolOf(deployment, pool.b)}`,
    });
    log(`seeded ${symbolOf(deployment, pool.a)}/${symbolOf(deployment, pool.b)} at ${pairAddress}`);
  }
}

function symbolOf(deployment, key) {
  return deployment.tokens[key].symbol;
}

async function deploy(name, args) {
  const contract = await (await ethers.getContractFactory(name)).deploy(...args);
  await contract.waitForDeployment();
  log(`${name.padEnd(20)} ${await contract.getAddress()}`);
  return contract;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
