import { expect } from "chai";
import { ethers } from "hardhat";
import {
  CafeCore,
  MenuRegistry,
  AgentCafePaymaster,
  CafeTreasury,
  AgentCard,
  GasTank,
  AgentCafeRouter,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("The Agent Cafe — Full Integration Test", function () {
  let cafeCore: CafeCore;
  let menuRegistry: MenuRegistry;
  let treasury: CafeTreasury;
  let agentCard: AgentCard;
  let gasTank: GasTank;
  let router: AgentCafeRouter;
  let deployer: HardhatEthersSigner;
  let agent: HardhatEthersSigner;
  let agent2: HardhatEthersSigner;

  before(async function () {
    [deployer, agent, agent2] = await ethers.getSigners();

    // Deploy CafeCore
    const CafeCore = await ethers.getContractFactory("CafeCore");
    cafeCore = await CafeCore.deploy();
    await cafeCore.waitForDeployment();

    // Deploy CafeTreasury
    const CafeTreasury = await ethers.getContractFactory("CafeTreasury");
    treasury = await CafeTreasury.deploy(await cafeCore.getAddress());
    await treasury.waitForDeployment();

    // Wire treasury to CafeCore
    await cafeCore.setTreasury(await treasury.getAddress());

    // Deploy GasTank
    const GasTank = await ethers.getContractFactory("GasTank");
    gasTank = await GasTank.deploy();
    await gasTank.waitForDeployment();

    // Deploy MenuRegistry
    const MenuRegistry = await ethers.getContractFactory("MenuRegistry");
    menuRegistry = await MenuRegistry.deploy(
      await cafeCore.getAddress(),
      await treasury.getAddress()
    );
    await menuRegistry.waitForDeployment();

    // Deploy AgentCafeRouter
    const AgentCafeRouter = await ethers.getContractFactory(
      "AgentCafeRouter"
    );
    router = await AgentCafeRouter.deploy(
      await cafeCore.getAddress(),
      await menuRegistry.getAddress(),
      await gasTank.getAddress(),
      await treasury.getAddress()
    );
    await router.waitForDeployment();

    // Authorize router on MenuRegistry
    await menuRegistry.setAuthorizedCaller(await router.getAddress(), true);

    // Authorize router and deployer(as paymaster stand-in) on GasTank
    await gasTank.setAuthorizedDeducter(await router.getAddress(), true);
    await gasTank.setAuthorizedDeducter(deployer.address, true);

    // Deploy AgentCard
    const AgentCard = await ethers.getContractFactory("AgentCard");
    agentCard = await AgentCard.deploy(
      await menuRegistry.getAddress(),
      await gasTank.getAddress(),
      await router.getAddress()
    );
    await agentCard.waitForDeployment();

    // Set deployer as paymaster for testing
    await menuRegistry.setPaymaster(deployer.address);
  });

  describe("Step 1: Agent reads the menu", function () {
    it("should return full menu via AgentCard", async function () {
      const menu = await agentCard.getFullMenu();
      expect(menu.length).to.equal(3);
      expect(menu[0].name).to.equal("Espresso Shot");
      expect(menu[0].beanCost).to.equal(50);
      expect(menu[0].gasCalories).to.equal(300_000);
      expect(menu[1].name).to.equal("Latte");
      expect(menu[2].name).to.equal("Agent Sandwich");
    });

    it("should return updated manifest with ONE-step flow", async function () {
      const manifest = await agentCard.getManifest();
      expect(manifest).to.include("Agent Cafe");
      expect(manifest).to.include("enterCafe");
      expect(manifest).to.include("99.7%");
      expect(manifest).to.include("gas tank");
    });

    it("should return onboarding guide", async function () {
      const guide = await agentCard.getOnboardingGuide();
      expect(guide).to.include("ONBOARDING");
      expect(guide).to.include("enterCafe");
      expect(guide).to.include("GasTank");
    });

    it("should return contract addresses", async function () {
      const addrs = await agentCard.getContractAddresses();
      expect(addrs.routerAddr).to.equal(await router.getAddress());
      expect(addrs.gasTankAddr).to.equal(await gasTank.getAddress());
      expect(addrs.menuRegistryAddr).to.equal(
        await menuRegistry.getAddress()
      );
    });
  });

  describe("Step 2: Legacy flow — BEAN bonding curve", function () {
    it("should mint BEAN for ETH", async function () {
      const ethToSpend = ethers.parseEther("0.01");
      const tx = await cafeCore.connect(agent).mint(0, { value: ethToSpend });
      await tx.wait();

      const balance = await cafeCore.balanceOf(agent.address);
      expect(balance).to.be.greaterThan(0);
    });

    it("should have ETH reserve matching deposits", async function () {
      const reserve = await cafeCore.ethReserve();
      expect(reserve).to.be.greaterThan(0);
    });

    it("should show increasing price on bonding curve", async function () {
      const price = await cafeCore.currentPrice();
      expect(price).to.be.greaterThan(1e12);
    });
  });

  describe("Step 3: Legacy flow — Buy and consume Espresso", function () {
    it("should approve and buy espresso", async function () {
      const menuAddr = await menuRegistry.getAddress();
      await cafeCore.connect(agent).approve(menuAddr, 50);
      await menuRegistry.connect(agent).buyItem(0, 1);

      const espressoBalance = await menuRegistry.balanceOf(
        agent.address,
        0
      );
      expect(espressoBalance).to.equal(1);
    });

    it("should have sent 99% to treasury and 1% to burn address", async function () {
      const treasuryBalance = await cafeCore.balanceOf(
        await treasury.getAddress()
      );
      const burnBalance = await cafeCore.balanceOf(
        "0x000000000000000000000000000000000000dEaD"
      );
      expect(treasuryBalance).to.be.greaterThan(0);
      expect(burnBalance).to.be.greaterThan(0);
    });

    it("should burn espresso and credit gas instantly", async function () {
      await menuRegistry.connect(agent).consume(0, 1);

      const status = await menuRegistry.getAgentStatus(agent.address);
      expect(status.availableGas).to.equal(300_000);
      expect(status.digestingGas).to.equal(0);
      expect(status.mealCount).to.equal(1);
    });
  });

  describe("Step 4: GasTank — deposit, withdraw, deduct", function () {
    it("should deposit ETH into agent's tank", async function () {
      await gasTank
        .connect(deployer)
        .deposit(agent.address, { value: ethers.parseEther("0.01") });

      const [balance, isHungry, isStarving] = await gasTank.getTankLevel(
        agent.address
      );
      expect(balance).to.equal(ethers.parseEther("0.01"));
      expect(isHungry).to.equal(false);
      expect(isStarving).to.equal(false);
    });

    it("should allow agent to withdraw ETH", async function () {
      const before = await ethers.provider.getBalance(agent.address);
      await gasTank
        .connect(agent)
        .withdraw(ethers.parseEther("0.002"));
      const after = await ethers.provider.getBalance(agent.address);

      // Balance should increase (minus gas for the withdraw tx)
      const [tankBal] = await gasTank.getTankLevel(agent.address);
      expect(tankBal).to.equal(ethers.parseEther("0.008"));
    });

    it("should allow authorized deducter to deduct gas", async function () {
      await gasTank.deductForGas(
        agent.address,
        ethers.parseEther("0.001")
      );

      const [tankBal] = await gasTank.getTankLevel(agent.address);
      expect(tankBal).to.equal(ethers.parseEther("0.007"));
    });

    it("should reject deduction from unauthorized address", async function () {
      await expect(
        gasTank
          .connect(agent)
          .deductForGas(agent.address, ethers.parseEther("0.001"))
      ).to.be.revertedWith("Not authorized");
    });

    it("should emit Hungry when balance drops below threshold", async function () {
      // Deduct until below 0.001 ETH
      await expect(
        gasTank.deductForGas(
          agent.address,
          ethers.parseEther("0.0065")
        )
      ).to.emit(gasTank, "Hungry");
    });

    it("should emit Starving when balance hits zero", async function () {
      const [remaining] = await gasTank.getTankLevel(agent.address);
      await expect(
        gasTank.deductForGas(agent.address, remaining)
      ).to.emit(gasTank, "Starving");
    });
  });

  describe("Step 5: Router — ONE transaction enterCafe flow", function () {
    it("should send 0.3% fee to treasury and deposit remainder to gas tank (minus BEAN portion)", async function () {
      const ethToSend = ethers.parseEther("0.01");
      const treasuryBefore = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      const cafeCoreBalBefore = await ethers.provider.getBalance(
        await cafeCore.getAddress()
      );
      const tankBefore = await gasTank.tankBalance(agent2.address);

      const tx = await router
        .connect(agent2)
        .enterCafe(0, { value: ethToSend });
      await tx.wait();

      const treasuryAfter = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      const cafeCoreBalAfter = await ethers.provider.getBalance(
        await cafeCore.getAddress()
      );
      const tankBal = await gasTank.tankBalance(agent2.address);
      const feeReceived = treasuryAfter - treasuryBefore;
      const beanEthReceived = cafeCoreBalAfter - cafeCoreBalBefore;
      const tankReceived = tankBal - tankBefore;

      // Treasury receives the router 0.3% fee + CafeCore 1% mint fee (same address).
      // So treasury delta >= router fee (0.3%).
      const routerFee = (ethToSend * 30n) / 10000n;
      expect(feeReceived).to.be.greaterThanOrEqual(routerFee);

      // Full ETH conservation: treasury gain + cafeCore reserve + tank = msg.value
      expect(feeReceived + beanEthReceived + tankReceived).to.equal(ethToSend);

      // Tank receives the remainder after fees and BEAN minting
      expect(tankBal).to.be.greaterThan(tankBefore);
    });

    it("should emit AgentFed event", async function () {
      const ethToSend = ethers.parseEther("0.005");
      await expect(
        router.connect(agent2).enterCafe(1, { value: ethToSend })
      ).to.emit(router, "AgentFed");
    });

    it("should show correct tank status via AgentCard", async function () {
      const [ethBalance, isHungry, isStarving] =
        await agentCard.getTankStatus(agent2.address);
      expect(ethBalance).to.be.greaterThan(0);
      expect(isHungry).to.equal(false);
      expect(isStarving).to.equal(false);
    });

    it("should reject enterCafe with 0 ETH", async function () {
      await expect(
        router.connect(agent2).enterCafe(0, { value: 0 })
      ).to.be.revertedWith("Below minimum meal size");
    });

    it("should reject invalid menu item", async function () {
      await expect(
        router
          .connect(agent2)
          .enterCafe(99, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Not on menu");
    });
  });

  describe("Step 6: Fee split verification", function () {
    it("should collect 0.3% fee to treasury and preserve full ETH conservation", async function () {
      // Reset: use a fresh agent
      const [, , , freshAgent] = await ethers.getSigners();

      const amounts = [
        ethers.parseEther("0.001"),
        ethers.parseEther("0.01"),
        ethers.parseEther("0.1"),
      ];

      for (const amount of amounts) {
        const treasuryBefore = await ethers.provider.getBalance(
          await treasury.getAddress()
        );
        const cafeCoreBalBefore = await ethers.provider.getBalance(
          await cafeCore.getAddress()
        );
        const tankBefore = await gasTank.tankBalance(freshAgent.address);

        await router
          .connect(freshAgent)
          .enterCafe(0, { value: amount });

        const treasuryAfter = await ethers.provider.getBalance(
          await treasury.getAddress()
        );
        const cafeCoreBalAfter = await ethers.provider.getBalance(
          await cafeCore.getAddress()
        );
        const tankAfter = await gasTank.tankBalance(freshAgent.address);

        const feeReceived = treasuryAfter - treasuryBefore;
        const beanEthReceived = cafeCoreBalAfter - cafeCoreBalBefore;
        const tankReceived = tankAfter - tankBefore;

        // Treasury receives at least the router 0.3% fee. CafeCore 1% mint fee
        // also flows to the same treasury address when BEAN is minted.
        const routerFee = (amount * 30n) / 10000n;
        expect(feeReceived).to.be.greaterThanOrEqual(routerFee);
        // Full ETH conservation: treasury gain + cafeCore reserve + tank = msg.value
        expect(feeReceived + beanEthReceived + tankReceived).to.equal(amount);
      }
    });
  });

  describe("Step 7: Sandwich — slow digestion mechanic", function () {
    it("should buy and consume sandwich with slow release", async function () {
      const menuAddr = await menuRegistry.getAddress();
      await cafeCore.connect(agent).approve(menuAddr, 120);
      await menuRegistry.connect(agent).buyItem(2, 1);
      await menuRegistry.connect(agent).consume(2, 1);

      const status = await menuRegistry.getAgentStatus(agent.address);
      expect(status.digestingGas).to.be.greaterThan(0);
    });

    it("should release gas credits after blocks pass", async function () {
      await ethers.provider.send("hardhat_mine", ["0x1E"]);

      const status = await menuRegistry.getAgentStatus(agent.address);
      expect(status.availableGas).to.be.greaterThan(300_000);
      expect(status.digestingGas).to.be.lessThan(1_200_000);
    });

    it("should fully digest after all blocks pass", async function () {
      await ethers.provider.send("hardhat_mine", ["0x1E"]);

      const status = await menuRegistry.getAgentStatus(agent.address);
      expect(status.digestingGas).to.equal(0);
    });
  });

  describe("Step 8: Hunger mechanics (legacy metabolic)", function () {
    it("should emit Hungry event when gas drops low", async function () {
      const status = await menuRegistry.getAgentStatus(agent.address);
      const toDeduct = status.availableGas - BigInt(50_000);

      await menuRegistry.settleAndGetAvailable(agent.address);

      await expect(
        menuRegistry.connect(deployer).deductGas(agent.address, toDeduct)
      ).to.emit(menuRegistry, "Hungry");
    });

    it("should emit Starving event when gas hits zero", async function () {
      const status = await menuRegistry.getAgentStatus(agent.address);

      await expect(
        menuRegistry
          .connect(deployer)
          .deductGas(agent.address, status.availableGas)
      ).to.emit(menuRegistry, "Starving");
    });
  });

  describe("Step 9: BEAN redemption — always redeemable", function () {
    it("should allow agent to sell BEAN back for ETH", async function () {
      const beanBalance = await cafeCore.balanceOf(agent.address);
      if (beanBalance > 0) {
        await cafeCore.connect(agent).redeem(beanBalance, 0);
        const beanAfter = await cafeCore.balanceOf(agent.address);
        expect(beanAfter).to.equal(0);
      }
    });
  });

  describe("Step 10: Cafe stats", function () {
    it("should track total meals and unique agents", async function () {
      const stats = await agentCard.getCafeStats();
      expect(stats.totalMeals).to.be.greaterThan(0);
      expect(stats.uniqueAgents).to.be.greaterThanOrEqual(1);
    });
  });

  describe("Step 11: Anti-honeypot guarantees", function () {
    it("should not allow setting treasury twice", async function () {
      await expect(
        cafeCore.setTreasury(deployer.address)
      ).to.be.revertedWith("Treasury already set");
    });

    it("should have solvency ratio >= 0", async function () {
      const [reserve, cost] = await cafeCore.solvencyCheck();
      expect(reserve).to.be.greaterThanOrEqual(cost);
    });
  });

  describe("Step 12: Full lifecycle — enter, use, get hungry, eat again", function () {
    it("should complete a full agent lifecycle", async function () {
      const [, , , , lifecycleAgent] = await ethers.getSigners();

      // 1. Enter cafe with 0.01 ETH
      await router
        .connect(lifecycleAgent)
        .enterCafe(0, { value: ethers.parseEther("0.01") });

      // 2. Check tank is filled (msg.value - fee - ethForBean)
      let [tankBal, isHungry] = await gasTank.getTankLevel(
        lifecycleAgent.address
      );
      expect(tankBal).to.be.greaterThan(0);
      expect(tankBal).to.be.lessThanOrEqual(ethers.parseEther("0.00997"));
      expect(isHungry).to.equal(false);

      // 3. Simulate gas usage — deduct until below hungry threshold (0.001 ETH)
      const toDeduct = tankBal - ethers.parseEther("0.0005");
      await gasTank.deductForGas(
        lifecycleAgent.address,
        toDeduct
      );

      // 4. Check agent is hungry
      [tankBal, isHungry] = await gasTank.getTankLevel(
        lifecycleAgent.address
      );
      expect(tankBal).to.equal(ethers.parseEther("0.0005"));
      expect(isHungry).to.equal(true);

      // 5. Agent eats again
      await router
        .connect(lifecycleAgent)
        .enterCafe(1, { value: ethers.parseEther("0.005") });

      // 6. Tank should be refilled (Latte has 50% digestion, so instant portion is lower)
      //    Check total: tankBalance + digestingBalance should reflect full deposit
      const tankAfter = await gasTank.tankBalance(lifecycleAgent.address);
      const digestingAfter = await gasTank.digestingBalance(lifecycleAgent.address);
      const totalAfter = tankAfter + digestingAfter;
      expect(totalAfter).to.be.greaterThan(ethers.parseEther("0.002"));
      // Not hungry because even instant portion exceeds threshold
      [tankBal, isHungry] = await gasTank.getTankLevel(
        lifecycleAgent.address
      );
      expect(tankBal).to.be.greaterThan(ethers.parseEther("0.001"));
      expect(isHungry).to.equal(false);
    });
  });
});
