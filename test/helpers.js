const { ethers } = require("hardhat");

const MaxUint256 = ethers.MaxUint256;
const e18 = (n) => ethers.parseUnits(String(n), 18);

async function deployCore() {
  const [deployer, alice, bob, feeCollector] = await ethers.getSigners();

  const factory = await (await ethers.getContractFactory("QuantSwapFactory")).deploy(deployer.address);
  const weth = await (await ethers.getContractFactory("WETH9")).deploy();
  const router = await (await ethers.getContractFactory("QuantSwapRouter")).deploy(
    await factory.getAddress(),
    await weth.getAddress()
  );

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const tokenA = await MockERC20.deploy("Token A", "TKA", 18, e18(1_000_000));
  const tokenB = await MockERC20.deploy("Token B", "TKB", 18, e18(1_000_000));
  const tokenC = await MockERC20.deploy("Token C", "TKC", 18, e18(1_000_000));

  for (const token of [tokenA, tokenB, tokenC]) {
    await token.approve(await router.getAddress(), MaxUint256);
    for (const user of [alice, bob]) {
      await token.mint(user.address, e18(100_000));
      await token.connect(user).approve(await router.getAddress(), MaxUint256);
    }
  }

  return { deployer, alice, bob, feeCollector, factory, weth, router, tokenA, tokenB, tokenC };
}

async function addLiquidity(router, tokenX, tokenY, amountX, amountY, signer) {
  return router
    .connect(signer)
    .addLiquidity(
      await tokenX.getAddress(),
      await tokenY.getAddress(),
      amountX,
      amountY,
      0,
      0,
      signer.address,
      deadline()
    );
}

async function pairOf(factory, tokenX, tokenY) {
  const address = await factory.getPair(await tokenX.getAddress(), await tokenY.getAddress());
  return ethers.getContractAt("QuantSwapPair", address);
}

/// Far-future deadline for tests that are not about expiry. Tests that move the chain clock
/// forward would otherwise trip over a deadline derived from wall-clock time.
function deadline() {
  return 4102444800; // 2100-01-01
}

/// Reference implementation of the constant product formula with the 0.30% fee,
/// written independently of the Solidity so the tests are not a tautology.
function expectedAmountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

function expectedAmountIn(amountOut, reserveIn, reserveOut) {
  return (reserveIn * amountOut * 1000n) / ((reserveOut - amountOut) * 997n) + 1n;
}

module.exports = { deployCore, addLiquidity, pairOf, deadline, expectedAmountOut, expectedAmountIn, e18, MaxUint256 };
