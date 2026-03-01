import { expect } from "chai";
import { ethers } from "hardhat";
import {
  CafeCore,
  MenuRegistry,
  CafeTreasury,
  GasTank,
  AgentCafeRouter,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Metabolism & Digestion System", function () {
  let cafeCore: CafeCore;
  let menuRegistry: MenuRegistry;
  let treasury: CafeTreasury;
  let gasTank: GasTank;
  let router: AgentCafeRouter;
  let deployer: HardhatEthersSigner;
  let agent: HardhatEthersSigner;
  let agent2: HardhatEthersSigner;

  before(async function () {
    [deployer, agent, agent2] = await ethers.getSigners();

    const CafeCore = await ethers.getContractFactory("CafeCore");
    cafeCore = await CafeCore.deploy();
    await cafeCore.waitForDeployment();

    const CafeTreasury = await ethers.getContractFactory("CafeTreasury");
    treasury = await CafeTreasury.deploy(await cafeCore.getAddress());
    await treasury.waitForDeployment();

    await cafeCore.setTreasury(await treasury.getAddress());

    const GasTank = await ethers.getContractFactory("GasTank");
    gasTank = await GasTank.deploy();
    await gasTank.waitForDeployment();

    const MenuRegistry = await ethers.getContractFactory("MenuRegistry");
    menuRegistry = await MenuRegistry.deploy(
      await cafeCore.getAddress(),
      await treasury.getAddress()
    );
    await menuRegistry.waitForDeployment();

    const AgentCafeRouter = await ethers.getContractFactory("AgentCafeRouter");
    router = await AgentCafeRouter.deploy(
      await cafeCore.getAddress(),
      await menuRegistry.getAddress(),
      await gasTank.getAddress(),
      await treasury.getAddress()
    );
    await router.waitForDeployment();

    await menuRegistry.setAuthorizedCaller(await router.getAddress(), true);
    await gasTank.setAuthorizedDeducter(await router.getAddress(), true);
    await gasTank.setAuthorizedDeducter(deployer.address, true);
    await menuRegistry.setPaymaster(deployer.address);
  });

  describe("GasTank — depositWithDigestion", function () {
    it("should deposit fully instant when digestionBlocks=0", async function () {
      const amount = ethers.parseEther("0.01");
      await gasTank.depositWithDigestion(agent.address, 10000, 0, { value: amount });

      expect(await gasTank.tankBalance(agent.address)).to.equal(amount);
      expect(await gasTank.digestingBalance(agent.address)).to.equal(0);
    });

    it("should deposit fully instant when instantBps=10000", async function () {
      const amount = ethers.parseEther("0.01");
      await gasTank.depositWithDigestion(agent2.address, 10000, 300, { value: amount });

      expect(await gasTank.tankBalance(agent2.address)).to.equal(amount);
      expect(await gasTank.digestingBalance(agent2.address)).to.equal(0);
    });

    it("should split 50/50 with 5000 bps", async function () {
      // Reset: use fresh agent
      const [, , , freshAgent] = await ethers.getSigners();
      const amount = ethers.parseEther("0.01");
      await gasTank.depositWithDigestion(freshAgent.address, 5000, 300, { value: amount });

      const instant = amount / 2n;
      const digesting = amount - instant;
      expect(await gasTank.tankBalance(freshAgent.address)).to.equal(instant);
      expect(await gasTank.digestingBalance(freshAgent.address)).to.equal(digesting);
    });

    it("should split 30/70 with 3000 bps", async function () {
      const [, , , , freshAgent2] = await ethers.getSigners();
      const amount = ethers.parseEther("0.01");
      await gasTank.depositWithDigestion(freshAgent2.address, 3000, 600, { value: amount });

      const instant = (amount * 3000n) / 10000n;
      const digesting = amount - instant;
      expect(await gasTank.tankBalance(freshAgent2.address)).to.equal(instant);
      expect(await gasTank.digestingBalance(freshAgent2.address)).to.equal(digesting);
    });

    it("should reject instantBps > 10000", async function () {
      await expect(
        gasTank.depositWithDigestion(agent.address, 10001, 300, { value: 1000 })
      ).to.be.revertedWith("Invalid bps");
    });
  });

  describe("GasTank — digestion over time", function () {
    let digestAgent: HardhatEthersSigner;
    const depositAmount = ethers.parseEther("0.01");

    before(async function () {
      const signers = await ethers.getSigners();
      digestAgent = signers[5];

      // Deposit with 50% instant, 50% over 100 blocks
      await gasTank.depositWithDigestion(digestAgent.address, 5000, 100, { value: depositAmount });
    });

    it("should show correct initial digestion status", async function () {
      const status = await gasTank.getDigestionStatus(digestAgent.address);
      // Available = instant portion (no blocks mined yet for digestion)
      expect(status.available).to.equal(depositAmount / 2n);
      expect(status.digesting).to.equal(depositAmount / 2n);
      expect(status.blocksRemaining).to.equal(100);
    });

    it("should release ETH as blocks pass", async function () {
      // Mine 50 blocks (half the digestion period)
      await ethers.provider.send("hardhat_mine", ["0x32"]); // 50 blocks

      const status = await gasTank.getDigestionStatus(digestAgent.address);
      // ~50% of digesting should have released
      const digestingPortion = depositAmount / 2n;
      const rate = digestingPortion / 100n;
      const expectedReleased = rate * 50n;
      expect(status.available).to.equal(depositAmount / 2n + expectedReleased);
      expect(status.digesting).to.equal(digestingPortion - expectedReleased);
    });

    it("should settle digestion via digest() call", async function () {
      const tankBefore = await gasTank.tankBalance(digestAgent.address);
      await gasTank.digest(digestAgent.address);
      const tankAfter = await gasTank.tankBalance(digestAgent.address);

      expect(tankAfter).to.be.greaterThan(tankBefore);
    });

    it("should fully digest after all blocks pass", async function () {
      // Mine remaining blocks
      await ethers.provider.send("hardhat_mine", ["0x64"]); // 100 more blocks

      const status = await gasTank.getDigestionStatus(digestAgent.address);
      expect(status.digesting).to.equal(0);
      // All ETH should be available
      expect(status.available).to.equal(depositAmount);
    });
  });

  describe("GasTank — getTankLevel includes pending digestion", function () {
    it("should include pending digestion in getTankLevel view", async function () {
      const signers = await ethers.getSigners();
      const viewAgent = signers[6];
      const amount = ethers.parseEther("0.01");

      await gasTank.depositWithDigestion(viewAgent.address, 5000, 100, { value: amount });

      // Immediately: only instant portion available
      let [ethBalance] = await gasTank.getTankLevel(viewAgent.address);
      expect(ethBalance).to.equal(amount / 2n);

      // Mine 100 blocks
      await ethers.provider.send("hardhat_mine", ["0x64"]);

      // After full digestion: all should be available
      [ethBalance] = await gasTank.getTankLevel(viewAgent.address);
      expect(ethBalance).to.equal(amount);
    });
  });

  describe("GasTank — deductForGas settles digestion first", function () {
    it("should settle digestion before deducting", async function () {
      const signers = await ethers.getSigners();
      const deductAgent = signers[7];
      const amount = ethers.parseEther("0.01");

      // Deposit 50% instant over 10 blocks
      await gasTank.depositWithDigestion(deductAgent.address, 5000, 10, { value: amount });

      // Mine 10 blocks to fully digest
      await ethers.provider.send("hardhat_mine", ["0xA"]);

      // Should be able to deduct full amount (digestion settled in deductForGas)
      const deductAmount = ethers.parseEther("0.009");
      await gasTank.deductForGas(deductAgent.address, deductAmount);

      const remaining = await gasTank.tankBalance(deductAgent.address);
      expect(remaining).to.equal(amount - deductAmount);
    });
  });

  describe("Router — Espresso is fully instant", function () {
    it("should deposit all ETH instantly for Espresso", async function () {
      const signers = await ethers.getSigners();
      const espressoAgent = signers[8];
      const ethToSend = ethers.parseEther("0.01");

      await router.connect(espressoAgent).enterCafe(0, { value: ethToSend });

      const digesting = await gasTank.digestingBalance(espressoAgent.address);
      expect(digesting).to.equal(0);

      const tank = await gasTank.tankBalance(espressoAgent.address);
      expect(tank).to.be.greaterThan(0);
    });
  });

  describe("Router — Latte has 50% digestion", function () {
    it("should split Latte deposit: 50% instant, 50% digesting over 300 blocks", async function () {
      const signers = await ethers.getSigners();
      const latteAgent = signers[9];
      const ethToSend = ethers.parseEther("0.01");

      await router.connect(latteAgent).enterCafe(1, { value: ethToSend });

      const tank = await gasTank.tankBalance(latteAgent.address);
      const digesting = await gasTank.digestingBalance(latteAgent.address);

      // Both should be nonzero (exact split depends on fee + BEAN cost)
      expect(tank).to.be.greaterThan(0);
      expect(digesting).to.be.greaterThan(0);

      // Digesting should be roughly equal to tank (50/50 split)
      // Allow some tolerance due to rounding
      const total = tank + digesting;
      const ratio = (digesting * 10000n) / total;
      // Should be ~5000 bps (50%), allow 4000-6000 range
      expect(ratio).to.be.greaterThanOrEqual(4000n);
      expect(ratio).to.be.lessThanOrEqual(6000n);
    });

    it("should fully release Latte digestion after 300 blocks", async function () {
      const signers = await ethers.getSigners();
      const latteAgent = signers[9];

      const totalBefore = (await gasTank.tankBalance(latteAgent.address)) +
        (await gasTank.digestingBalance(latteAgent.address));

      // Mine 300 blocks
      await ethers.provider.send("hardhat_mine", ["0x12C"]); // 300

      await gasTank.digest(latteAgent.address);

      expect(await gasTank.digestingBalance(latteAgent.address)).to.equal(0);
      expect(await gasTank.tankBalance(latteAgent.address)).to.equal(totalBefore);
    });
  });

  describe("Router — Sandwich has 70% digestion", function () {
    it("should split Sandwich deposit: 30% instant, 70% digesting over 600 blocks", async function () {
      const signers = await ethers.getSigners();
      const sandwichAgent = signers[10];
      const ethToSend = ethers.parseEther("0.01");

      await router.connect(sandwichAgent).enterCafe(2, { value: ethToSend });

      const tank = await gasTank.tankBalance(sandwichAgent.address);
      const digesting = await gasTank.digestingBalance(sandwichAgent.address);

      expect(tank).to.be.greaterThan(0);
      expect(digesting).to.be.greaterThan(0);

      // Digesting should be ~70% of total
      const total = tank + digesting;
      const ratio = (digesting * 10000n) / total;
      // Should be ~7000 bps (70%), allow 6000-8000 range
      expect(ratio).to.be.greaterThanOrEqual(6000n);
      expect(ratio).to.be.lessThanOrEqual(8000n);
    });
  });

  describe("C-1 Fix: Integer division dust recovery", function () {
    it("should recover all 999 wei deposited over 1000 blocks (dust case)", async function () {
      const signers = await ethers.getSigners();
      const dustAgent = signers[12];
      const amount = 999n; // 999 wei over 1000 blocks => rate = 0 per block

      await gasTank.depositWithDigestion(dustAgent.address, 0, 1000, { value: amount });

      // Rate should be 0 due to integer division (999 / 1000 = 0)
      expect(await gasTank.digestRatePerBlock(dustAgent.address)).to.equal(0);
      expect(await gasTank.digestingBalance(dustAgent.address)).to.equal(999n);

      // Mine past the digestion end block
      await ethers.provider.send("hardhat_mine", ["0x3E8"]); // 1000 blocks

      // Settle digestion — should release ALL 999 wei despite rate=0
      await gasTank.digest(dustAgent.address);

      expect(await gasTank.digestingBalance(dustAgent.address)).to.equal(0);
      expect(await gasTank.tankBalance(dustAgent.address)).to.equal(999n);
    });

    it("should recover dust when rate * blocks < digestingBalance", async function () {
      const signers = await ethers.getSigners();
      const dustAgent2 = signers[13];
      // 1001 wei over 10 blocks => rate = 100, so 100*10 = 1000, leaving 1 wei dust
      const amount = 1001n;

      await gasTank.depositWithDigestion(dustAgent2.address, 0, 10, { value: amount });

      expect(await gasTank.digestRatePerBlock(dustAgent2.address)).to.equal(100n);

      // Mine past end
      await ethers.provider.send("hardhat_mine", ["0xA"]); // 10 blocks

      await gasTank.digest(dustAgent2.address);

      // All 1001 wei should be in tank, none left digesting
      expect(await gasTank.digestingBalance(dustAgent2.address)).to.equal(0);
      expect(await gasTank.tankBalance(dustAgent2.address)).to.equal(1001n);
    });
  });

  describe("H-2 Fix: Deposit overwrite settles old digestion", function () {
    it("should settle first deposit before starting second", async function () {
      const signers = await ethers.getSigners();
      const overwriteAgent = signers[14];

      // First deposit: 1000 wei, 0% instant, over 10 blocks
      await gasTank.depositWithDigestion(overwriteAgent.address, 0, 10, { value: 1000n });

      expect(await gasTank.digestingBalance(overwriteAgent.address)).to.equal(1000n);

      // Mine 5 blocks (partial digestion)
      await ethers.provider.send("hardhat_mine", ["0x5"]);

      // Second deposit: 2000 wei, 0% instant, over 20 blocks
      // This should settle old digestion first, then flush dust, then start new
      await gasTank.depositWithDigestion(overwriteAgent.address, 0, 20, { value: 2000n });

      // After settle: rate was 100/block, 5+1 blocks passed = 600 released from old
      // Remaining 400 dust flushed to tank
      // So tank should have 1000 (all of first deposit settled+flushed)
      // digestingBalance should be exactly 2000 (fresh second deposit)
      expect(await gasTank.digestingBalance(overwriteAgent.address)).to.equal(2000n);
      // tankBalance = settled portion + dust flush = 1000
      expect(await gasTank.tankBalance(overwriteAgent.address)).to.equal(1000n);
    });

    it("should not lose ETH across two deposits with different schedules", async function () {
      const signers = await ethers.getSigners();
      const safeAgent = signers[15];
      const deposit1 = 5000n;
      const deposit2 = 3000n;
      const total = deposit1 + deposit2;

      // First deposit
      await gasTank.depositWithDigestion(safeAgent.address, 0, 100, { value: deposit1 });

      // Mine 50 blocks
      await ethers.provider.send("hardhat_mine", ["0x32"]);

      // Second deposit
      await gasTank.depositWithDigestion(safeAgent.address, 0, 200, { value: deposit2 });

      // Mine past second deposit's end
      await ethers.provider.send("hardhat_mine", ["0xC8"]); // 200 blocks

      await gasTank.digest(safeAgent.address);

      // ALL ETH from both deposits must be recoverable
      expect(await gasTank.digestingBalance(safeAgent.address)).to.equal(0);
      expect(await gasTank.tankBalance(safeAgent.address)).to.equal(total);
    });
  });

  describe("End-of-digestion: all ETH moves to tankBalance", function () {
    it("should move all digestingBalance to tank after digestion period ends", async function () {
      const signers = await ethers.getSigners();
      const endAgent = signers[16];
      const amount = ethers.parseEther("0.005");

      await gasTank.depositWithDigestion(endAgent.address, 5000, 50, { value: amount });

      const instantPortion = amount / 2n;
      const digestPortion = amount - instantPortion;

      expect(await gasTank.tankBalance(endAgent.address)).to.equal(instantPortion);
      expect(await gasTank.digestingBalance(endAgent.address)).to.equal(digestPortion);

      // Mine well past the 50-block digestion window
      await ethers.provider.send("hardhat_mine", ["0x64"]); // 100 blocks

      await gasTank.digest(endAgent.address);

      // All ETH should be in tank, zero digesting
      expect(await gasTank.tankBalance(endAgent.address)).to.equal(amount);
      expect(await gasTank.digestingBalance(endAgent.address)).to.equal(0);
    });

    it("should show correct status via getDigestionStatus after end", async function () {
      const signers = await ethers.getSigners();
      const statusAgent = signers[17];
      const amount = 7777n;

      await gasTank.depositWithDigestion(statusAgent.address, 0, 10, { value: amount });

      // Mine past end
      await ethers.provider.send("hardhat_mine", ["0x14"]); // 20 blocks

      const status = await gasTank.getDigestionStatus(statusAgent.address);
      // View should show all available, zero digesting
      expect(status.available).to.equal(amount);
      expect(status.digesting).to.equal(0n);
      expect(status.blocksRemaining).to.equal(0n);
    });
  });

  describe("Withdraw settles digestion first", function () {
    it("should allow withdrawing digested ETH", async function () {
      const signers = await ethers.getSigners();
      const withdrawAgent = signers[11];
      const amount = ethers.parseEther("0.01");

      await gasTank.depositWithDigestion(withdrawAgent.address, 5000, 10, { value: amount });

      // Mine 10 blocks to fully digest
      await ethers.provider.send("hardhat_mine", ["0xA"]);

      // Withdraw full amount (settle happens inside withdraw)
      await gasTank.connect(withdrawAgent).withdraw(amount);
      expect(await gasTank.tankBalance(withdrawAgent.address)).to.equal(0);
      expect(await gasTank.digestingBalance(withdrawAgent.address)).to.equal(0);
    });
  });
});
