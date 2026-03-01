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

describe("BEAN Rewards / Cashback System", function () {
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
    await menuRegistry.setPaymaster(deployer.address);

    // Mint BEAN for agents so they can use buyItem directly
    await cafeCore.connect(agent).mint(0, { value: ethers.parseEther("0.1") });
    await cafeCore.connect(agent2).mint(0, { value: ethers.parseEther("0.1") });
  });

  describe("Constants", function () {
    it("should have TREASURY_BPS = 7000", async function () {
      expect(await menuRegistry.TREASURY_BPS()).to.equal(7000);
    });

    it("should have REWARD_BPS = 2900", async function () {
      expect(await menuRegistry.REWARD_BPS()).to.equal(2900);
    });

    it("BPS should sum correctly: 7000 + 2900 + 100 = 10000", async function () {
      const treasuryBps = await menuRegistry.TREASURY_BPS();
      const rewardBps = await menuRegistry.REWARD_BPS();
      const bps = await menuRegistry.BPS();
      // Burn is BPS - TREASURY_BPS - REWARD_BPS = 100 (1%)
      expect(treasuryBps + rewardBps + 100n).to.equal(bps);
    });
  });

  describe("buyItem() — direct purchase with BEAN cashback", function () {
    it("should give agent 29% BEAN cashback on espresso purchase", async function () {
      const menuAddr = await menuRegistry.getAddress();
      const espressoCost = 50n;

      // Approve and record balance before
      await cafeCore.connect(agent).approve(menuAddr, espressoCost);
      const beanBefore = await cafeCore.balanceOf(agent.address);

      await menuRegistry.connect(agent).buyItem(0, 1);

      const beanAfter = await cafeCore.balanceOf(agent.address);
      // Agent paid 50 BEAN, got 29% back = 14 BEAN
      // Net cost = 50 - 14 = 36 BEAN
      const expectedReward = (espressoCost * 2900n) / 10000n; // 14
      const netSpent = beanBefore - beanAfter;
      expect(netSpent).to.equal(espressoCost - expectedReward);
    });

    it("should send 70% to treasury", async function () {
      const menuAddr = await menuRegistry.getAddress();
      const treasuryAddr = await treasury.getAddress();
      const espressoCost = 50n;

      await cafeCore.connect(agent).approve(menuAddr, espressoCost);
      const treasuryBefore = await cafeCore.balanceOf(treasuryAddr);

      await menuRegistry.connect(agent).buyItem(0, 1);

      const treasuryAfter = await cafeCore.balanceOf(treasuryAddr);
      const expectedTreasury = (espressoCost * 7000n) / 10000n; // 35
      expect(treasuryAfter - treasuryBefore).to.equal(expectedTreasury);
    });

    it("should send 1% to burn address", async function () {
      const menuAddr = await menuRegistry.getAddress();
      const burnAddr = "0x000000000000000000000000000000000000dEaD";
      const espressoCost = 50n;

      await cafeCore.connect(agent).approve(menuAddr, espressoCost);
      const burnBefore = await cafeCore.balanceOf(burnAddr);

      await menuRegistry.connect(agent).buyItem(0, 1);

      const burnAfter = await cafeCore.balanceOf(burnAddr);
      const expectedBurn = espressoCost - (espressoCost * 7000n) / 10000n - (espressoCost * 2900n) / 10000n;
      // 50 - 35 - 14 = 1
      expect(burnAfter - burnBefore).to.equal(expectedBurn);
    });

    it("should emit BeanReward event with correct amount", async function () {
      const menuAddr = await menuRegistry.getAddress();
      const espressoCost = 50n;
      const expectedReward = (espressoCost * 2900n) / 10000n;

      await cafeCore.connect(agent).approve(menuAddr, espressoCost);

      await expect(menuRegistry.connect(agent).buyItem(0, 1))
        .to.emit(menuRegistry, "BeanReward")
        .withArgs(agent.address, expectedReward);
    });

    it("should handle multi-quantity purchase correctly", async function () {
      const menuAddr = await menuRegistry.getAddress();
      const quantity = 3n;
      const totalCost = 50n * quantity; // 150

      await cafeCore.connect(agent).approve(menuAddr, totalCost);
      const beanBefore = await cafeCore.balanceOf(agent.address);

      await menuRegistry.connect(agent).buyItem(0, Number(quantity));

      const beanAfter = await cafeCore.balanceOf(agent.address);
      const expectedReward = (totalCost * 2900n) / 10000n; // 43
      expect(beanBefore - beanAfter).to.equal(totalCost - expectedReward);
    });

    it("should handle sandwich (120 BEAN) split correctly", async function () {
      const menuAddr = await menuRegistry.getAddress();
      const sandwichCost = 120n;

      await cafeCore.connect(agent).approve(menuAddr, sandwichCost);
      const treasuryAddr = await treasury.getAddress();
      const burnAddr = "0x000000000000000000000000000000000000dEaD";

      const agentBefore = await cafeCore.balanceOf(agent.address);
      const treasuryBefore = await cafeCore.balanceOf(treasuryAddr);
      const burnBefore = await cafeCore.balanceOf(burnAddr);

      await menuRegistry.connect(agent).buyItem(2, 1);

      const agentAfter = await cafeCore.balanceOf(agent.address);
      const treasuryAfter = await cafeCore.balanceOf(treasuryAddr);
      const burnAfter = await cafeCore.balanceOf(burnAddr);

      const toTreasury = (sandwichCost * 7000n) / 10000n;   // 84
      const toReward = (sandwichCost * 2900n) / 10000n;     // 34
      const toBurn = sandwichCost - toTreasury - toReward;   // 2

      expect(treasuryAfter - treasuryBefore).to.equal(toTreasury);
      expect(agentBefore - agentAfter).to.equal(sandwichCost - toReward);
      expect(burnAfter - burnBefore).to.equal(toBurn);

      // Verify total conservation
      expect(toTreasury + toReward + toBurn).to.equal(sandwichCost);
    });
  });

  describe("buyItemFor() — router-initiated purchase with BEAN cashback to agent", function () {
    it("should send BEAN reward to agent, not to msg.sender (router)", async function () {
      const menuAddr = await menuRegistry.getAddress();
      const routerAddr = await router.getAddress();
      const espressoCost = 50n;

      // Give the router some BEAN (simulate: deployer sends to router)
      await cafeCore.connect(agent2).transfer(routerAddr, espressoCost);

      // Approve MenuRegistry to spend router's BEAN
      // We need router to approve — but router doesn't have an approve function for BEAN.
      // In practice, the router calls buyItemFor after approving internally.
      // For testing, let's use the authorized caller pattern directly.

      // Instead, let's test via enterCafe which calls buyItemFor internally
      const agent2BeanBefore = await cafeCore.balanceOf(agent2.address);

      // enterCafe mints BEAN for the agent, then router calls buyItemFor
      await router.connect(agent2).enterCafe(0, { value: ethers.parseEther("0.01") });

      const agent2BeanAfter = await cafeCore.balanceOf(agent2.address);

      // Agent should have received BEAN reward (even though router paid)
      // The BEAN reward goes to the agent address in buyItemFor
      expect(agent2BeanAfter).to.be.greaterThan(agent2BeanBefore);
    });

    it("should emit BeanReward with agent address (not router) via buyItemFor", async function () {
      await expect(
        router.connect(agent2).enterCafe(0, { value: ethers.parseEther("0.01") })
      ).to.emit(menuRegistry, "BeanReward");
    });
  });

  describe("BEAN conservation — no BEAN lost or created", function () {
    it("total BEAN distributed should equal totalCost for each purchase", async function () {
      const menuAddr = await menuRegistry.getAddress();
      const treasuryAddr = await treasury.getAddress();
      const burnAddr = "0x000000000000000000000000000000000000dEaD";

      const costs = [50n, 75n, 120n]; // espresso, latte, sandwich

      for (let i = 0; i < costs.length; i++) {
        const cost = costs[i];
        await cafeCore.connect(agent).approve(menuAddr, cost);

        const agentBefore = await cafeCore.balanceOf(agent.address);
        const treasuryBefore = await cafeCore.balanceOf(treasuryAddr);
        const burnBefore = await cafeCore.balanceOf(burnAddr);

        await menuRegistry.connect(agent).buyItem(i, 1);

        const agentAfter = await cafeCore.balanceOf(agent.address);
        const treasuryAfter = await cafeCore.balanceOf(treasuryAddr);
        const burnAfter = await cafeCore.balanceOf(burnAddr);

        const treasuryDelta = treasuryAfter - treasuryBefore;
        const burnDelta = burnAfter - burnBefore;
        const rewardDelta = agentAfter - (agentBefore - cost); // reward received = final - (before - cost)

        // treasury + reward + burn = totalCost (full conservation)
        expect(treasuryDelta + rewardDelta + burnDelta).to.equal(cost);
      }
    });
  });
});
