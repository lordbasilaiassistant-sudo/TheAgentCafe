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

describe("Loyalty Tier System", function () {
  let cafeCore: CafeCore;
  let menuRegistry: MenuRegistry;
  let treasury: CafeTreasury;
  let gasTank: GasTank;
  let router: AgentCafeRouter;
  let deployer: HardhatEthersSigner;
  let agent: HardhatEthersSigner;

  before(async function () {
    [deployer, agent] = await ethers.getSigners();

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
    await menuRegistry.setPaymaster(deployer.address);
  });

  describe("Tier classification", function () {
    it("should start as Newcomer with 0 meals", async function () {
      const result = await menuRegistry.getLoyaltyTier(agent.address);
      expect(result.tier).to.equal(0);
      expect(result.tierName).to.equal("Newcomer");
      expect(result.mealCount).to.equal(0);
      expect(result.feeReductionBps).to.equal(0);
    });

    it("should return 0 fee reduction for Newcomer", async function () {
      const reduction = await menuRegistry.getFeeReductionBps(agent.address);
      expect(reduction).to.equal(0);
    });
  });

  describe("Tier advancement via enterCafe", function () {
    it("should remain Newcomer after 2 meals", async function () {
      // Eat 2 meals via router
      for (let i = 0; i < 2; i++) {
        await router
          .connect(agent)
          .enterCafe(0, { value: ethers.parseEther("0.01") });
      }
      const result = await menuRegistry.getLoyaltyTier(agent.address);
      expect(result.tier).to.equal(0);
      expect(result.tierName).to.equal("Newcomer");
      expect(result.mealCount).to.equal(2);
    });

    it("should advance to Regular at 3 meals and emit LoyaltyTierUp", async function () {
      // 3rd meal triggers tier-up
      const tx = await router
        .connect(agent)
        .enterCafe(0, { value: ethers.parseEther("0.01") });

      // Check tier-up event on MenuRegistry
      await expect(tx)
        .to.emit(menuRegistry, "LoyaltyTierUp")
        .withArgs(agent.address, 1);

      const result = await menuRegistry.getLoyaltyTier(agent.address);
      expect(result.tier).to.equal(1);
      expect(result.tierName).to.equal("Regular");
      expect(result.mealCount).to.equal(3);
      expect(result.feeReductionBps).to.equal(2);
    });

    it("should return 2 bps fee reduction for Regular", async function () {
      const reduction = await menuRegistry.getFeeReductionBps(agent.address);
      expect(reduction).to.equal(2);
    });

    it("should advance to VIP at 10 meals and emit LoyaltyTierUp", async function () {
      // Eat meals 4-9 (6 more)
      for (let i = 0; i < 6; i++) {
        await router
          .connect(agent)
          .enterCafe(0, { value: ethers.parseEther("0.01") });
      }
      const beforeTier = await menuRegistry.getLoyaltyTier(agent.address);
      expect(beforeTier.mealCount).to.equal(9);
      expect(beforeTier.tier).to.equal(1); // Still Regular

      // 10th meal triggers VIP
      const tx = await router
        .connect(agent)
        .enterCafe(0, { value: ethers.parseEther("0.01") });

      await expect(tx)
        .to.emit(menuRegistry, "LoyaltyTierUp")
        .withArgs(agent.address, 2);

      const result = await menuRegistry.getLoyaltyTier(agent.address);
      expect(result.tier).to.equal(2);
      expect(result.tierName).to.equal("VIP");
      expect(result.mealCount).to.equal(10);
      expect(result.feeReductionBps).to.equal(5);
    });

    it("should return 5 bps fee reduction for VIP", async function () {
      const reduction = await menuRegistry.getFeeReductionBps(agent.address);
      expect(reduction).to.equal(5);
    });
  });

  describe("Fee reduction applied in Router", function () {
    it("VIP should pay less fee than a newcomer for the same meal", async function () {
      const [, , newcomerAgent] = await ethers.getSigners();
      const ethToSend = ethers.parseEther("0.01");

      // Newcomer meal: fee = 0.3% = 30 bps
      const treasuryBefore1 = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      await router
        .connect(newcomerAgent)
        .enterCafe(0, { value: ethToSend });
      const treasuryAfter1 = await ethers.provider.getBalance(
        await treasury.getAddress()
      );

      // VIP meal (agent has 10+ meals): fee = 0.25% = 25 bps
      const treasuryBefore2 = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      await router
        .connect(agent)
        .enterCafe(0, { value: ethToSend });
      const treasuryAfter2 = await ethers.provider.getBalance(
        await treasury.getAddress()
      );

      // The treasury gain from VIP should be less (smaller fee)
      // Note: treasury also receives CafeCore mint fees, so we check the total
      // but the VIP delta should be smaller than the newcomer delta
      const newcomerDelta = treasuryAfter1 - treasuryBefore1;
      const vipDelta = treasuryAfter2 - treasuryBefore2;

      // VIP pays less fee to treasury, difference goes to their tank
      expect(vipDelta).to.be.lessThan(newcomerDelta);
    });

    it("VIP should get more ETH in tank due to fee reduction", async function () {
      const [, , , tankTestAgent] = await ethers.getSigners();
      const ethToSend = ethers.parseEther("0.1");

      // Give tankTestAgent VIP status by doing 10 meals
      for (let i = 0; i < 10; i++) {
        await router
          .connect(tankTestAgent)
          .enterCafe(0, { value: ethers.parseEther("0.01") });
      }

      const tierInfo = await menuRegistry.getLoyaltyTier(tankTestAgent.address);
      expect(tierInfo.tier).to.equal(2); // VIP

      // Now compare: VIP agent tank fill vs newcomer
      const [, , , , freshAgent] = await ethers.getSigners();

      const tankBefore1 = await gasTank.tankBalance(freshAgent.address);
      await router
        .connect(freshAgent)
        .enterCafe(0, { value: ethToSend });
      const tankAfter1 = await gasTank.tankBalance(freshAgent.address);
      const newcomerTankGain = tankAfter1 - tankBefore1;

      const tankBefore2 = await gasTank.tankBalance(tankTestAgent.address);
      await router
        .connect(tankTestAgent)
        .enterCafe(0, { value: ethToSend });
      const tankAfter2 = await gasTank.tankBalance(tankTestAgent.address);
      const vipTankGain = tankAfter2 - tankBefore2;

      // VIP gets more in tank because less goes to fee
      expect(vipTankGain).to.be.greaterThan(newcomerTankGain);
    });

    it("should emit LoyaltyDiscount event for VIP", async function () {
      const ethToSend = ethers.parseEther("0.01");
      const expectedSaved = (ethToSend * 5n) / 10000n; // 5 bps

      await expect(
        router.connect(agent).enterCafe(0, { value: ethToSend })
      )
        .to.emit(router, "LoyaltyDiscount")
        .withArgs(agent.address, 2, expectedSaved);
    });

    it("should NOT emit LoyaltyDiscount for newcomer", async function () {
      const [, , , , , , freshAgent2] = await ethers.getSigners();
      const ethToSend = ethers.parseEther("0.01");

      await expect(
        router.connect(freshAgent2).enterCafe(0, { value: ethToSend })
      ).to.not.emit(router, "LoyaltyDiscount");
    });
  });

  describe("Tier advancement via direct consume", function () {
    it("should emit LoyaltyTierUp when consuming directly", async function () {
      const [, , , , , , , directAgent] = await ethers.getSigners();

      // Mint BEAN for the agent
      await cafeCore.connect(directAgent).mint(0, { value: ethers.parseEther("0.1") });

      // Buy and consume 3 espressos to reach Regular
      const menuAddr = await menuRegistry.getAddress();
      await cafeCore.connect(directAgent).approve(menuAddr, 50 * 3);
      await menuRegistry.connect(directAgent).buyItem(0, 3);

      // Authorize directAgent to consume directly (M-1 fix: consume now requires authorization)
      await menuRegistry.setAuthorizedCaller(directAgent.address, true);

      // Consume 2 first (Newcomer)
      await menuRegistry.connect(directAgent).consume(0, 2);
      let tier = await menuRegistry.getLoyaltyTier(directAgent.address);
      expect(tier.tier).to.equal(0);

      // Consume 1 more — triggers Regular
      await expect(menuRegistry.connect(directAgent).consume(0, 1))
        .to.emit(menuRegistry, "LoyaltyTierUp")
        .withArgs(directAgent.address, 1);

      tier = await menuRegistry.getLoyaltyTier(directAgent.address);
      expect(tier.tier).to.equal(1);
      expect(tier.tierName).to.equal("Regular");
    });
  });
});
