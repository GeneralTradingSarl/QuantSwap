const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  deployCore,
  addLiquidity,
  pairOf,
  deadline,
  expectedAmountOut,
  expectedAmountIn,
  e18,
  MaxUint256,
} = require("./helpers");

describe("QuantSwapRouter", () => {
  describe("pricing views", () => {
    it("agrees with an independent implementation of the fee formula", async () => {
      const { router } = await loadFixture(deployCore);
      const cases = [
        [e18(1), e18(1000), e18(4000)],
        [e18(500), e18(1000), e18(4000)],
        [1n, e18(1), e18(1)],
      ];

      for (const [amountIn, reserveIn, reserveOut] of cases) {
        expect(await router.getAmountOut(amountIn, reserveIn, reserveOut)).to.equal(
          expectedAmountOut(amountIn, reserveIn, reserveOut)
        );
      }
    });

    it("rounds the required input up, never down", async () => {
      const { router } = await loadFixture(deployCore);
      const amountOut = e18(1);
      const [reserveIn, reserveOut] = [e18(1000), e18(4000)];

      const amountIn = await router.getAmountIn(amountOut, reserveIn, reserveOut);
      expect(amountIn).to.equal(expectedAmountIn(amountOut, reserveIn, reserveOut));
      // Feeding that input back through getAmountOut must not shortchange the pool.
      expect(await router.getAmountOut(amountIn, reserveIn, reserveOut)).to.be.greaterThanOrEqual(amountOut);
    });

    it("refuses degenerate inputs", async () => {
      const { router } = await loadFixture(deployCore);
      await expect(router.getAmountOut(0, e18(1), e18(1))).to.be.reverted;
      await expect(router.getAmountOut(e18(1), 0, e18(1))).to.be.reverted;
      await expect(router.getAmountIn(e18(1), e18(1), e18(1))).to.be.reverted; // output >= reserve
    });
  });

  describe("liquidity", () => {
    it("creates the pair on first deposit and trims to the pool ratio afterwards", async () => {
      const { router, factory, tokenA, tokenB, deployer } = await loadFixture(deployCore);
      const a = await tokenA.getAddress();
      const b = await tokenB.getAddress();

      expect(await factory.getPair(a, b)).to.equal(ethers.ZeroAddress);
      await addLiquidity(router, tokenA, tokenB, e18(1000), e18(4000), deployer);
      expect(await factory.getPair(a, b)).to.not.equal(ethers.ZeroAddress);

      const balanceBefore = await tokenB.balanceOf(deployer.address);
      await addLiquidity(router, tokenA, tokenB, e18(10), e18(1000), deployer);
      // Only 40 TKB of the 1000 offered is actually taken, at the 1:4 pool ratio.
      expect(balanceBefore - (await tokenB.balanceOf(deployer.address))).to.equal(e18(40));
    });

    it("reverts when the pool ratio moved past the caller's minimum", async () => {
      const { router, tokenA, tokenB, deployer } = await loadFixture(deployCore);
      await addLiquidity(router, tokenA, tokenB, e18(1000), e18(4000), deployer);

      await expect(
        router.addLiquidity(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          e18(10),
          e18(1000),
          0,
          e18(41), // demands at least 41 TKB, pool ratio only allows 40
          deployer.address,
          deadline()
        )
      ).to.be.revertedWithCustomError(router, "InsufficientBAmount");
    });

    it("removes liquidity with an EIP-2612 signature instead of an approval transaction", async () => {
      const { router, factory, tokenA, tokenB, deployer } = await loadFixture(deployCore);
      await addLiquidity(router, tokenA, tokenB, e18(1000), e18(4000), deployer);

      const pair = await pairOf(factory, tokenA, tokenB);
      const liquidity = await pair.balanceOf(deployer.address);
      const expiry = deadline();

      const signature = await deployer.signTypedData(
        {
          name: "QuantSwap LP",
          version: "1",
          chainId: (await ethers.provider.getNetwork()).chainId,
          verifyingContract: await pair.getAddress(),
        },
        {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        {
          owner: deployer.address,
          spender: await router.getAddress(),
          value: liquidity,
          nonce: await pair.nonces(deployer.address),
          deadline: expiry,
        }
      );
      const { v, r, s } = ethers.Signature.from(signature);

      expect(await pair.allowance(deployer.address, await router.getAddress())).to.equal(0n);
      await router.removeLiquidityWithPermit(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        liquidity,
        0,
        0,
        deployer.address,
        expiry,
        false,
        v,
        r,
        s
      );
      expect(await pair.balanceOf(deployer.address)).to.equal(0n);
    });

    it("rejects a permit signed by somebody else", async () => {
      const { router, factory, tokenA, tokenB, deployer, alice } = await loadFixture(deployCore);
      await addLiquidity(router, tokenA, tokenB, e18(1000), e18(4000), deployer);
      const pair = await pairOf(factory, tokenA, tokenB);
      const expiry = deadline();

      const signature = await alice.signTypedData(
        {
          name: "QuantSwap LP",
          version: "1",
          chainId: (await ethers.provider.getNetwork()).chainId,
          verifyingContract: await pair.getAddress(),
        },
        {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        {
          owner: deployer.address, // claims to be the deployer
          spender: await router.getAddress(),
          value: e18(1),
          nonce: await pair.nonces(deployer.address),
          deadline: expiry,
        }
      );
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        pair.permit(deployer.address, await router.getAddress(), e18(1), expiry, v, r, s)
      ).to.be.revertedWithCustomError(pair, "InvalidSignature");
    });
  });

  describe("swaps", () => {
    it("honours the minimum output", async () => {
      const { router, tokenA, tokenB, deployer, alice } = await loadFixture(deployCore);
      await addLiquidity(router, tokenA, tokenB, e18(1000), e18(4000), deployer);

      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      const [expected] = (await router.getAmountsOut(e18(10), path)).slice(-1);

      await expect(
        router.connect(alice).swapExactTokensForTokens(e18(10), expected + 1n, path, alice.address, deadline())
      ).to.be.revertedWithCustomError(router, "InsufficientOutputAmount");

      await expect(
        router.connect(alice).swapExactTokensForTokens(e18(10), expected, path, alice.address, deadline())
      ).to.not.be.reverted;
    });

    it("honours the deadline", async () => {
      const { router, tokenA, tokenB, deployer, alice } = await loadFixture(deployCore);
      await addLiquidity(router, tokenA, tokenB, e18(1000), e18(4000), deployer);
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      const stale = (await time.latest()) - 1;

      await expect(
        router.connect(alice).swapExactTokensForTokens(e18(10), 0, path, alice.address, stale)
      ).to.be.revertedWithCustomError(router, "Expired");
    });

    it("caps the input on an exact-output swap", async () => {
      const { router, tokenA, tokenB, deployer, alice } = await loadFixture(deployCore);
      await addLiquidity(router, tokenA, tokenB, e18(1000), e18(4000), deployer);

      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      const required = (await router.getAmountsIn(e18(40), path))[0];

      await expect(
        router.connect(alice).swapTokensForExactTokens(e18(40), required - 1n, path, alice.address, deadline())
      ).to.be.revertedWithCustomError(router, "ExcessiveInputAmount");

      const before = await tokenA.balanceOf(alice.address);
      await router.connect(alice).swapTokensForExactTokens(e18(40), required, path, alice.address, deadline());
      expect(before - (await tokenA.balanceOf(alice.address))).to.equal(required);
    });

    it("routes a multi-hop path and charges the fee once per hop", async () => {
      const { router, tokenA, tokenB, tokenC, deployer, alice } = await loadFixture(deployCore);
      await addLiquidity(router, tokenA, tokenB, e18(1000), e18(1000), deployer);
      await addLiquidity(router, tokenB, tokenC, e18(1000), e18(1000), deployer);

      const path = [await tokenA.getAddress(), await tokenB.getAddress(), await tokenC.getAddress()];
      const amounts = await router.getAmountsOut(e18(10), path);
      expect(amounts.length).to.equal(3);

      const direct = expectedAmountOut(e18(10), e18(1000), e18(1000));
      expect(amounts[1]).to.equal(direct);
      // Second hop prices against the untouched B/C pool, so the fee is charged again.
      expect(amounts[2]).to.equal(expectedAmountOut(direct, e18(1000), e18(1000)));

      const before = await tokenC.balanceOf(alice.address);
      await router.connect(alice).swapExactTokensForTokens(e18(10), amounts[2], path, alice.address, deadline());
      expect((await tokenC.balanceOf(alice.address)) - before).to.equal(amounts[2]);
    });

    it("swaps ETH in and out through WETH", async () => {
      const { router, weth, tokenA, deployer, alice } = await loadFixture(deployCore);
      await router.addLiquidityETH(
        await tokenA.getAddress(),
        e18(1000),
        0,
        0,
        deployer.address,
        deadline(),
        { value: e18(10) }
      );

      const buyPath = [await weth.getAddress(), await tokenA.getAddress()];
      const before = await tokenA.balanceOf(alice.address);
      await router.connect(alice).swapExactETHForTokens(0, buyPath, alice.address, deadline(), { value: e18(1) });
      const bought = (await tokenA.balanceOf(alice.address)) - before;
      expect(bought).to.be.greaterThan(0n);

      const sellPath = [await tokenA.getAddress(), await weth.getAddress()];
      const ethBefore = await ethers.provider.getBalance(alice.address);
      const tx = await router
        .connect(alice)
        .swapExactTokensForETH(bought, 0, sellPath, alice.address, deadline());
      const receipt = await tx.wait();
      const ethAfter = await ethers.provider.getBalance(alice.address);

      expect(ethAfter + receipt.gasUsed * receipt.gasPrice).to.be.greaterThan(ethBefore);
    });

    it("refunds the unused ETH on an exact-output ETH swap", async () => {
      const { router, weth, tokenA, deployer, alice } = await loadFixture(deployCore);
      await router.addLiquidityETH(
        await tokenA.getAddress(),
        e18(1000),
        0,
        0,
        deployer.address,
        deadline(),
        { value: e18(10) }
      );

      const path = [await weth.getAddress(), await tokenA.getAddress()];
      const required = (await router.getAmountsIn(e18(50), path))[0];
      const overpay = required * 3n;

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await router
        .connect(alice)
        .swapETHForExactTokens(e18(50), path, alice.address, deadline(), { value: overpay });
      const receipt = await tx.wait();
      const spent = before - (await ethers.provider.getBalance(alice.address)) - receipt.gasUsed * receipt.gasPrice;

      expect(spent).to.equal(required);
    });

    it("handles fee-on-transfer tokens on the supporting path and rejects them on the strict path", async () => {
      const { router, factory, tokenA, deployer, alice } = await loadFixture(deployCore);
      const fot = await (await ethers.getContractFactory("FeeOnTransferToken")).deploy(
        "Fee Token",
        "FEE",
        100, // 1% burned on every transfer
        e18(1_000_000)
      );
      await fot.approve(await router.getAddress(), MaxUint256);
      await fot.mint(alice.address, e18(10_000));
      await fot.connect(alice).approve(await router.getAddress(), MaxUint256);

      await router.addLiquidity(
        await fot.getAddress(),
        await tokenA.getAddress(),
        e18(1000),
        e18(1000),
        0,
        0,
        deployer.address,
        deadline()
      );

      const path = [await fot.getAddress(), await tokenA.getAddress()];
      // The strict path computes the output from the amount sent, which never arrives in full.
      const pair = await pairOf(factory, fot, tokenA);
      await expect(
        router.connect(alice).swapExactTokensForTokens(e18(100), 0, path, alice.address, deadline())
      ).to.be.revertedWithCustomError(pair, "K");

      const before = await tokenA.balanceOf(alice.address);
      await router
        .connect(alice)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(e18(100), 0, path, alice.address, deadline());
      expect((await tokenA.balanceOf(alice.address)) - before).to.be.greaterThan(0n);
    });
  });
});
