/**
 * Generates trading activity on a local node so the interface and the indexer have a book
 * with real history instead of an empty state.
 *
 *   npx hardhat run scripts/simulate.js --network localhost
 */
const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

const TRADES = Number(process.env.TRADES ?? 120);
const SECONDS_BETWEEN_TRADES = Number(process.env.TRADE_SPACING ?? 90);

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const [deployer, ...traders] = await ethers.getSigners();

  const router = await ethers.getContractAt("QuantSwapRouter", deployment.contracts.router);
  const tokens = deployment.tokens;

  // Traders need both sides of every book, WETH included. A simulation where nobody can
  // sell one leg produces a one-way chart, which is exactly what a demo should not show.
  const weth = await ethers.getContractAt("WETH9", tokens.weth.address);
  for (const trader of (await ethers.getSigners()).slice(1, 7)) {
    await (await weth.connect(trader).deposit({ value: ethers.parseEther("50") })).wait();
    await (await weth.connect(trader).approve(deployment.contracts.router, ethers.MaxUint256)).wait();
  }

  // Fund the traders from the deployer's supply and approve the router once.
  for (const [key, token] of Object.entries(tokens)) {
    if (key === "weth") continue;
    const contract = await ethers.getContractAt("MockERC20", token.address);
    for (const trader of traders.slice(0, 6)) {
      await (await contract.mint(trader.address, ethers.parseUnits("100000", token.decimals))).wait();
      await (await contract.connect(trader).approve(deployment.contracts.router, ethers.MaxUint256)).wait();
    }
    await (await contract.approve(deployment.contracts.router, ethers.MaxUint256)).wait();
  }

  const pairs = deployment.pairs;
  let executed = 0;

  for (let i = 0; i < TRADES; i++) {
    const pair = pairs[i % pairs.length];
    const trader = traders[i % 6];
    const buy = Math.random() < 0.5;
    const path = buy ? [pair.token0, pair.token1] : [pair.token1, pair.token0];

    // Trade sizes are a fraction of the pool, not an absolute number of tokens. A fixed
    // size would be noise in a deep pool and a 90% price move in a shallow one, which is
    // exactly the unrealistic chart this script exists to avoid.
    const reserveIn = await reserveOf(router, path[0], path[1]);
    const fraction = Math.random() < 0.1 ? 0.02 + Math.random() * 0.03 : 0.001 + Math.random() * 0.006;
    const amountIn = (reserveIn * BigInt(Math.round(fraction * 1e6))) / 1_000_000n;
    if (amountIn <= 0n) continue;

    try {
      await (
        await router
          .connect(trader)
          .swapExactTokensForTokens(amountIn, 0, path, trader.address, 4102444800)
      ).wait();
      executed++;
    } catch {
      // A trade that would move the pool too far simply does not happen. Same as production.
      continue;
    }

    await network.provider.send("evm_increaseTime", [SECONDS_BETWEEN_TRADES]);
    await network.provider.send("evm_mine");
  }

  console.log(`executed ${executed} swaps across ${pairs.length} pools`);
}

/** Reserve of `tokenIn` in the pool it shares with `tokenOut`. */
async function reserveOf(router, tokenIn, tokenOut) {
  const pair = await ethers.getContractAt("QuantSwapPair", await router.pairFor(tokenIn, tokenOut));
  const [reserve0, reserve1] = await pair.getReserves();
  return (await pair.token0()).toLowerCase() === tokenIn.toLowerCase() ? reserve0 : reserve1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
