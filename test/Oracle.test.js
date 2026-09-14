const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployCore, addLiquidity, deadline, e18 } = require("./helpers");

const WINDOW = 3600; // one hour
const GRANULARITY = 6; // six ten-minute buckets

async function oracleFixture() {
  const ctx = await loadFixture(deployCore);
  await addLiquidity(ctx.router, ctx.tokenA, ctx.tokenB, e18(1000), e18(4000), ctx.deployer);

  const oracle = await (await ethers.getContractFactory("QuantSwapOracle")).deploy(
    await ctx.factory.getAddress(),
    WINDOW,
    GRANULARITY
  );
  return { ...ctx, oracle };
}

async function warmUp(oracle, tokenA, tokenB, periods) {
  const periodSize = WINDOW / GRANULARITY;
  for (let i = 0; i < periods; i++) {
    await time.increase(periodSize + 1);
    await oracle.update(await tokenA.getAddress(), await tokenB.getAddress());
  }
}

describe("QuantSwapOracle", () => {
  it("rejects a granularity the window cannot be divided into", async () => {
    const Oracle = await ethers.getContractFactory("QuantSwapOracle");
    const { factory } = await loadFixture(deployCore);
    const factoryAddress = await factory.getAddress();

    await expect(Oracle.deploy(factoryAddress, WINDOW, 1)).to.be.revertedWithCustomError(
      Oracle,
      "InvalidGranularity"
    );
    await expect(Oracle.deploy(factoryAddress, 3601, GRANULARITY)).to.be.revertedWithCustomError(
      Oracle,
      "WindowNotDivisible"
    );
  });

  it("refuses to answer before the window is populated", async () => {
    const { oracle, tokenA, tokenB } = await loadFixture(oracleFixture);
    await expect(
      oracle.consult(await tokenA.getAddress(), e18(1), await tokenB.getAddress())
    ).to.be.revertedWithCustomError(oracle, "MissingObservation");
  });

  it("reports the average price once the window is populated", async () => {
    const { oracle, tokenA, tokenB } = await loadFixture(oracleFixture);
    await warmUp(oracle, tokenA, tokenB, GRANULARITY + 1);

    // Pool is 1000 TKA : 4000 TKB, so one TKA is worth four TKB.
    const price = await oracle.consult(await tokenA.getAddress(), e18(1), await tokenB.getAddress());
    expect(price).to.be.closeTo(e18(4), e18(0.001));

    const inverse = await oracle.consult(await tokenB.getAddress(), e18(4), await tokenA.getAddress());
    expect(inverse).to.be.closeTo(e18(1), e18(0.001));
  });

  it("does not move materially when the spot price is manipulated inside one block", async () => {
    const { oracle, router, tokenA, tokenB, alice } = await loadFixture(oracleFixture);
    await warmUp(oracle, tokenA, tokenB, GRANULARITY + 1);

    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();
    const twapBefore = await oracle.consult(a, e18(1), b);

    // A whale buys 40% of the TKB side in a single transaction.
    await router.connect(alice).swapExactTokensForTokens(e18(1000), 0, [a, b], alice.address, deadline());

    const spotAfter = (await router.getAmountsOut(e18(1), [a, b]))[1];
    const twapAfter = await oracle.consult(a, e18(1), b);

    // Spot has collapsed by more than half.
    expect(spotAfter).to.be.lessThan(twapBefore / 2n);
    // The TWAP has barely registered it, because the manipulation lasted no time at all.
    const drift = twapBefore > twapAfter ? twapBefore - twapAfter : twapAfter - twapBefore;
    expect(drift * 1000n / twapBefore).to.be.lessThan(5n); // under 0.5%
  });

  it("does converge once the manipulated price is actually held over time", async () => {
    const { oracle, router, tokenA, tokenB, alice } = await loadFixture(oracleFixture);
    await warmUp(oracle, tokenA, tokenB, GRANULARITY + 1);

    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();
    const twapBefore = await oracle.consult(a, e18(1), b);

    await router.connect(alice).swapExactTokensForTokens(e18(1000), 0, [a, b], alice.address, deadline());
    // Holding the skew for a full window is what it costs to move this oracle.
    await warmUp(oracle, tokenA, tokenB, GRANULARITY + 1);

    const twapAfter = await oracle.consult(a, e18(1), b);
    expect(twapAfter).to.be.lessThan(twapBefore / 2n);
  });

  it("goes stale rather than reporting an average over a gap it cannot see", async () => {
    const { oracle, tokenA, tokenB } = await loadFixture(oracleFixture);
    await warmUp(oracle, tokenA, tokenB, GRANULARITY + 1);

    await time.increase(WINDOW * 3);
    await expect(
      oracle.consult(await tokenA.getAddress(), e18(1), await tokenB.getAddress())
    ).to.be.revertedWithCustomError(oracle, "MissingObservation");
  });

  it("ignores a second update inside the same period", async () => {
    const { oracle, tokenA, tokenB } = await loadFixture(oracleFixture);
    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();

    await time.increase(WINDOW / GRANULARITY + 1);
    expect(await oracle.update.staticCall(a, b)).to.equal(true);
    await oracle.update(a, b);
    expect(await oracle.update.staticCall(a, b)).to.equal(false);
  });
});
