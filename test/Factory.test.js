const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployCore } = require("./helpers");

describe("QuantSwapFactory", () => {
  it("creates a pair and registers it in both directions", async () => {
    const { factory, tokenA, tokenB } = await loadFixture(deployCore);
    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();

    await expect(factory.createPair(a, b)).to.emit(factory, "PairCreated");

    const pair = await factory.getPair(a, b);
    expect(await factory.getPair(b, a)).to.equal(pair);
    expect(await factory.allPairsLength()).to.equal(1n);
    expect(await factory.allPairs(0)).to.equal(pair);
  });

  it("orders the tokens deterministically regardless of argument order", async () => {
    const { factory, tokenA, tokenB } = await loadFixture(deployCore);
    const [a, b] = [await tokenA.getAddress(), await tokenB.getAddress()];
    await factory.createPair(b, a);

    const pair = await ethers.getContractAt("QuantSwapPair", await factory.getPair(a, b));
    const [expected0, expected1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    expect(await pair.token0()).to.equal(expected0);
    expect(await pair.token1()).to.equal(expected1);
  });

  it("deploys at the CREATE2 address derived from the published init code hash", async () => {
    const { factory, tokenA, tokenB } = await loadFixture(deployCore);
    const [a, b] = [await tokenA.getAddress(), await tokenB.getAddress()];
    await factory.createPair(a, b);

    const [token0, token1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    const salt = ethers.solidityPackedKeccak256(["address", "address"], [token0, token1]);
    const predicted = ethers.getCreate2Address(await factory.getAddress(), salt, await factory.pairCodeHash());

    expect(await factory.getPair(a, b)).to.equal(predicted);
  });

  it("rejects identical, zero and duplicate pairs", async () => {
    const { factory, tokenA, tokenB } = await loadFixture(deployCore);
    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();

    await expect(factory.createPair(a, a)).to.be.revertedWithCustomError(factory, "IdenticalAddresses");
    await expect(factory.createPair(a, ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    await factory.createPair(a, b);
    await expect(factory.createPair(a, b)).to.be.revertedWithCustomError(factory, "PairExists");
  });

  it("restricts fee administration to the fee setter", async () => {
    const { factory, alice, feeCollector } = await loadFixture(deployCore);

    await expect(factory.connect(alice).setFeeTo(alice.address)).to.be.revertedWithCustomError(factory, "Forbidden");
    await expect(factory.setFeeTo(feeCollector.address)).to.emit(factory, "FeeToChanged");
    expect(await factory.feeTo()).to.equal(feeCollector.address);

    await expect(factory.setFeeToSetter(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    await factory.setFeeToSetter(alice.address);
    await expect(factory.setFeeTo(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "Forbidden");
  });
});
