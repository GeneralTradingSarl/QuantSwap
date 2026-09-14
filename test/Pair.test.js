const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployCore, addLiquidity, pairOf, deadline, expectedAmountOut, e18 } = require("./helpers");

const MINIMUM_LIQUIDITY = 1000n;
const DEAD = "0x000000000000000000000000000000000000dEaD";

async function seeded() {
  const ctx = await loadFixture(deployCore);
  await addLiquidity(ctx.router, ctx.tokenA, ctx.tokenB, e18(1000), e18(4000), ctx.deployer);
  const pair = await pairOf(ctx.factory, ctx.tokenA, ctx.tokenB);
  return { ...ctx, pair };
}

async function reservesFor(pair, token) {
  const [r0, r1] = await pair.getReserves();
  const token0 = await pair.token0();
  return (await token.getAddress()) === token0 ? [r0, r1] : [r1, r0];
}

describe("QuantSwapPair", () => {
  it("mints sqrt(x*y) minus the minimum liquidity on the first deposit", async () => {
    const { pair, deployer } = await seeded();

    const expected = 2000n * 10n ** 18n - MINIMUM_LIQUIDITY; // sqrt(1000e18 * 4000e18)
    expect(await pair.balanceOf(deployer.address)).to.equal(expected);
    expect(await pair.balanceOf(DEAD)).to.equal(MINIMUM_LIQUIDITY);
    expect(await pair.totalSupply()).to.equal(expected + MINIMUM_LIQUIDITY);
  });

  it("mints proportionally to the smaller side on later deposits", async () => {
    const { pair, router, tokenA, tokenB, alice } = await seeded();
    const supplyBefore = await pair.totalSupply();

    // Deliberately unbalanced: 10% of reserve A, 20% of reserve B. The router trims to 10%.
    await router
      .connect(alice)
      .addLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        e18(100),
        e18(800),
        0,
        0,
        alice.address,
        deadline()
      );

    expect(await pair.balanceOf(alice.address)).to.equal(supplyBefore / 10n);
  });

  it("swaps at the constant product price and keeps k non-decreasing", async () => {
    const { pair, router, tokenA, tokenB, alice } = await seeded();
    const [reserveIn, reserveOut] = await reservesFor(pair, tokenA);
    const [r0Before, r1Before] = await pair.getReserves();
    const kBefore = r0Before * r1Before;

    const amountIn = e18(10);
    const expected = expectedAmountOut(amountIn, reserveIn, reserveOut);
    const balanceBefore = await tokenB.balanceOf(alice.address);

    await router
      .connect(alice)
      .swapExactTokensForTokens(
        amountIn,
        expected,
        [await tokenA.getAddress(), await tokenB.getAddress()],
        alice.address,
        deadline()
      );

    expect((await tokenB.balanceOf(alice.address)) - balanceBefore).to.equal(expected);

    const [r0After, r1After] = await pair.getReserves();
    expect(r0After * r1After).to.be.greaterThan(kBefore); // the fee accrues to the pool
  });

  it("rejects a swap that does not pay in", async () => {
    const { pair, alice } = await seeded();
    await expect(pair.connect(alice).swap(e18(1), 0, alice.address, "0x")).to.be.revertedWithCustomError(
      pair,
      "InsufficientInputAmount"
    );
  });

  it("rejects a swap whose output would empty the pool or target a pool token", async () => {
    const { pair, alice, tokenA } = await seeded();
    const [r0] = await pair.getReserves();

    await expect(pair.connect(alice).swap(r0, 0, alice.address, "0x")).to.be.revertedWithCustomError(
      pair,
      "InsufficientLiquidity"
    );
    await expect(
      pair.connect(alice).swap(e18(1), 0, await tokenA.getAddress(), "0x")
    ).to.be.revertedWithCustomError(pair, "InvalidTo");
  });

  it("burns liquidity back into the underlying assets", async () => {
    const { pair, router, tokenA, tokenB, deployer } = await seeded();
    const liquidity = await pair.balanceOf(deployer.address);
    await pair.approve(await router.getAddress(), liquidity);

    const aBefore = await tokenA.balanceOf(deployer.address);
    const bBefore = await tokenB.balanceOf(deployer.address);

    await router.removeLiquidity(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      liquidity,
      0,
      0,
      deployer.address,
      deadline()
    );

    // Everything comes back except the share locked by MINIMUM_LIQUIDITY.
    expect((await tokenA.balanceOf(deployer.address)) - aBefore).to.be.closeTo(e18(1000), e18(0.01));
    expect((await tokenB.balanceOf(deployer.address)) - bBefore).to.be.closeTo(e18(4000), e18(0.01));
    expect(await pair.totalSupply()).to.equal(MINIMUM_LIQUIDITY);
  });

  it("supports flash swaps that repay the fee", async () => {
    const { pair, tokenA, tokenB, deployer } = await seeded();
    const borrower = await (await ethers.getContractFactory("FlashBorrower")).deploy(await pair.getAddress());

    const token0 = await pair.token0();
    const borrowed = e18(50);
    const feeBuffer = e18(1);
    // Fund the borrower so it can pay the 0.30% fee out of its own pocket.
    const feeToken = (await tokenA.getAddress()) === token0 ? tokenA : tokenB;
    await feeToken.transfer(await borrower.getAddress(), feeBuffer);

    await expect(borrower.flash(borrowed, 0)).to.emit(pair, "Swap");
  });

  it("rejects a flash swap that is not repaid at all", async () => {
    const { pair } = await seeded();
    const borrower = await (await ethers.getContractFactory("FlashBorrower")).deploy(await pair.getAddress());
    await borrower.setRepayBps(0);

    await expect(borrower.flash(e18(50), 0)).to.be.revertedWithCustomError(pair, "InsufficientInputAmount");
  });

  it("rejects a flash swap repaid short of the fee", async () => {
    const { pair, tokenA, tokenB } = await seeded();
    const borrower = await (await ethers.getContractFactory("FlashBorrower")).deploy(await pair.getAddress());
    const token0 = await pair.token0();
    const feeToken = (await tokenA.getAddress()) === token0 ? tokenA : tokenB;
    await feeToken.transfer(await borrower.getAddress(), e18(1));

    // 99.9% of what is owed: enough to look like a repayment, not enough to satisfy K.
    await borrower.setRepayBps(9990);
    await expect(borrower.flash(e18(50), 0)).to.be.revertedWithCustomError(pair, "K");
  });

  it("blocks reentrancy from inside the flash-swap callback", async () => {
    const { pair } = await seeded();
    const attacker = await (await ethers.getContractFactory("ReentrancyAttacker")).deploy(await pair.getAddress());

    await expect(attacker.attack(e18(10), 0)).to.be.revertedWithCustomError(pair, "Locked");
  });

  it("skims a donated surplus and syncs reserves to balances", async () => {
    const { pair, tokenA, alice } = await seeded();
    const [reserveABefore] = await reservesFor(pair, tokenA);

    await tokenA.transfer(await pair.getAddress(), e18(5));
    expect((await reservesFor(pair, tokenA))[0]).to.equal(reserveABefore);

    const aliceBefore = await tokenA.balanceOf(alice.address);
    await pair.skim(alice.address);
    expect((await tokenA.balanceOf(alice.address)) - aliceBefore).to.equal(e18(5));

    await tokenA.transfer(await pair.getAddress(), e18(7));
    await pair.sync();
    expect((await reservesFor(pair, tokenA))[0]).to.equal(reserveABefore + e18(7));
  });

  it("mints the protocol fee to feeTo when it is switched on", async () => {
    const { pair, factory, router, tokenA, tokenB, alice, feeCollector, deployer } = await seeded();
    await factory.setFeeTo(feeCollector.address);
    // kLast only starts tracking at the next liquidity event.
    await addLiquidity(router, tokenA, tokenB, e18(10), e18(40), deployer);

    for (let i = 0; i < 5; i++) {
      await router
        .connect(alice)
        .swapExactTokensForTokens(
          e18(20),
          0,
          [await tokenA.getAddress(), await tokenB.getAddress()],
          alice.address,
          deadline()
        );
    }

    expect(await pair.balanceOf(feeCollector.address)).to.equal(0n);
    await addLiquidity(router, tokenA, tokenB, e18(1), e18(4), deployer);
    expect(await pair.balanceOf(feeCollector.address)).to.be.greaterThan(0n);
  });
});
