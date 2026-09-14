const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployCore, addLiquidity, pairOf, deadline, e18 } = require("./helpers");

/// Deterministic PRNG, so a failure is reproducible from the seed printed in the test name.
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const SEEDS = [1, 7, 42, 1337, 90210];

describe("Invariants", () => {
  for (const seed of SEEDS) {
    it(`holds over a random sequence of swaps and liquidity events (seed ${seed})`, async () => {
      const { router, factory, tokenA, tokenB, deployer, alice, bob } = await loadFixture(deployCore);
      await addLiquidity(router, tokenA, tokenB, e18(5000), e18(5000), deployer);

      const pair = await pairOf(factory, tokenA, tokenB);
      const pairAddress = await pair.getAddress();
      const a = await tokenA.getAddress();
      const b = await tokenB.getAddress();
      const random = rng(seed);

      let lastSharePrice = 0n;
      const SCALE = 10n ** 18n;

      for (let i = 0; i < 40; i++) {
        const [r0Before, r1Before] = await pair.getReserves();
        const kBefore = r0Before * r1Before;
        const action = random();
        const user = random() < 0.5 ? alice : bob;
        const size = BigInt(Math.max(1, Math.floor(random() * 200))) * SCALE;

        if (action < 0.6) {
          const path = random() < 0.5 ? [a, b] : [b, a];
          await router.connect(user).swapExactTokensForTokens(size, 0, path, user.address, deadline());

          const [r0, r1] = await pair.getReserves();
          // A swap may only ever grow k, never shrink it.
          expect(r0 * r1).to.be.greaterThanOrEqual(kBefore);
        } else if (action < 0.85) {
          const [r0, r1] = await pair.getReserves();
          const token0 = await pair.token0();
          const ratioSide = (await tokenA.getAddress()) === token0 ? [r0, r1] : [r1, r0];
          const amountB = (size * ratioSide[1]) / ratioSide[0];
          await router
            .connect(user)
            .addLiquidity(a, b, size, amountB, 0, 0, user.address, deadline());
        } else {
          const liquidity = await pair.balanceOf(user.address);
          if (liquidity > 0n) {
            const burn = liquidity / 3n;
            if (burn > 0n) {
              await pair.connect(user).approve(await router.getAddress(), burn);
              await router.connect(user).removeLiquidity(a, b, burn, 0, 0, user.address, deadline());
            }
          }
        }

        const [r0, r1] = await pair.getReserves();
        const totalSupply = await pair.totalSupply();

        // Reserves never exceed the balances actually held: nothing is promised twice.
        expect(await tokenA.balanceOf(pairAddress)).to.be.greaterThanOrEqual(
          (await pair.token0()) === a ? r0 : r1
        );
        expect(await tokenB.balanceOf(pairAddress)).to.be.greaterThanOrEqual(
          (await pair.token0()) === b ? r0 : r1
        );

        // The value backing one LP share is monotonically non-decreasing: fees accrue to
        // holders and no operation may dilute an existing holder's claim.
        const sharePrice = (r0 * r1 * SCALE) / (totalSupply * totalSupply);
        expect(sharePrice).to.be.greaterThanOrEqual((lastSharePrice * 9999n) / 10000n);
        lastSharePrice = sharePrice;

        expect(totalSupply).to.be.greaterThanOrEqual(1000n); // minimum liquidity is never redeemable
      }
    });
  }
});
