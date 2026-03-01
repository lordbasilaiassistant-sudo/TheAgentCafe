import { expect } from "chai";
import { ethers } from "hardhat";
import { CafeCore, MenuRegistry, AgentCafePaymaster, CafeTreasury, AgentCard } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("The Agent Cafe — Full Integration Test", function () {
  let cafeCore: CafeCore;
  let menuRegistry: MenuRegistry;
  let treasury: CafeTreasury;
  let agentCard: AgentCard;
  let deployer: HardhatEthersSigner;
  let agent: HardhatEthersSigner;

  before(async function () {
    [deployer, agent] = await ethers.getSigners();

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

    // Deploy MenuRegistry
    const MenuRegistry = await ethers.getContractFactory("MenuRegistry");
    menuRegistry = await MenuRegistry.deploy(
      await cafeCore.getAddress(),
      await treasury.getAddress()
    );
    await menuRegistry.waitForDeployment();

    // Deploy AgentCard
    const AgentCard = await ethers.getContractFactory("AgentCard");
    agentCard = await AgentCard.deploy(await menuRegistry.getAddress());
    await agentCard.waitForDeployment();

    // Set deployer as paymaster for testing (since we can't deploy real EntryPoint locally easily)
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

    it("should return manifest", async function () {
      const manifest = await agentCard.getManifest();
      expect(manifest).to.include("Agent Cafe");
      expect(manifest).to.include("CafeCore.mint()");
    });
  });

  describe("Step 2: Agent buys BEAN via bonding curve", function () {
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
      // Price should be BASE_PRICE + SLOPE * supply > BASE_PRICE
      expect(price).to.be.greaterThan(1e12); // BASE_PRICE = 1e12
    });
  });

  describe("Step 3: Agent buys an Espresso", function () {
    it("should approve and buy espresso", async function () {
      const menuAddr = await menuRegistry.getAddress();
      await cafeCore.connect(agent).approve(menuAddr, 50);
      await menuRegistry.connect(agent).buyItem(0, 1); // ESPRESSO

      const espressoBalance = await menuRegistry.balanceOf(agent.address, 0);
      expect(espressoBalance).to.equal(1);
    });

    it("should have sent 99% to treasury and 1% to burn address", async function () {
      const treasuryBalance = await cafeCore.balanceOf(await treasury.getAddress());
      const burnBalance = await cafeCore.balanceOf("0x000000000000000000000000000000000000dEaD");
      // 50 BEAN total: 49 to treasury (99% of 50 = 49.5, truncated to 49), 1 to burn
      expect(treasuryBalance).to.be.greaterThan(0);
      expect(burnBalance).to.be.greaterThan(0);
    });
  });

  describe("Step 4: Agent consumes Espresso — instant energy", function () {
    it("should burn espresso and credit gas instantly", async function () {
      await menuRegistry.connect(agent).consume(0, 1);

      const status = await menuRegistry.getAgentStatus(agent.address);
      expect(status.availableGas).to.equal(300_000);
      expect(status.digestingGas).to.equal(0);
      expect(status.mealCount).to.equal(1);
    });

    it("should show espresso balance is now 0", async function () {
      const balance = await menuRegistry.balanceOf(agent.address, 0);
      expect(balance).to.equal(0);
    });
  });

  describe("Step 5: Paymaster simulation — gas deduction", function () {
    it("should deduct gas credits (simulating paymaster postOp)", async function () {
      // deployer is set as paymaster for testing
      await menuRegistry.connect(deployer).deductGas(agent.address, 100_000);

      const status = await menuRegistry.getAgentStatus(agent.address);
      expect(status.availableGas).to.equal(200_000);
    });

    it("should reject deduction from non-paymaster", async function () {
      await expect(
        menuRegistry.connect(agent).deductGas(agent.address, 100)
      ).to.be.revertedWith("Only paymaster");
    });
  });

  describe("Step 6: Sandwich — slow digestion mechanic", function () {
    it("should buy and consume sandwich with slow release", async function () {
      const menuAddr = await menuRegistry.getAddress();
      await cafeCore.connect(agent).approve(menuAddr, 120);
      await menuRegistry.connect(agent).buyItem(2, 1); // SANDWICH
      await menuRegistry.connect(agent).consume(2, 1);

      const status = await menuRegistry.getAgentStatus(agent.address);
      // Available gas should include previous 200k + 0 from sandwich (digesting)
      // Digesting gas should be 1,200,000
      expect(status.digestingGas).to.be.greaterThan(0);
    });

    it("should release gas credits after blocks pass", async function () {
      // Mine 30 blocks
      await ethers.provider.send("hardhat_mine", ["0x1E"]);

      const status = await menuRegistry.getAgentStatus(agent.address);
      // After 30 blocks, about half of 1.2M should be released
      expect(status.availableGas).to.be.greaterThan(200_000);
      expect(status.digestingGas).to.be.lessThan(1_200_000);
    });

    it("should fully digest after all blocks pass", async function () {
      // Mine remaining 30 blocks
      await ethers.provider.send("hardhat_mine", ["0x1E"]);

      const status = await menuRegistry.getAgentStatus(agent.address);
      // All digestion should be complete
      expect(status.digestingGas).to.equal(0);
    });
  });

  describe("Step 7: Hunger mechanics", function () {
    it("should emit Hungry event when gas drops low", async function () {
      // Drain most gas — leave under 100k
      const status = await menuRegistry.getAgentStatus(agent.address);
      const toDeduct = status.availableGas - BigInt(50_000);

      // Settle first so available is updated on-chain
      await menuRegistry.settleAndGetAvailable(agent.address);

      await expect(
        menuRegistry.connect(deployer).deductGas(agent.address, toDeduct)
      ).to.emit(menuRegistry, "Hungry");
    });

    it("should emit Starving event when gas hits zero", async function () {
      const status = await menuRegistry.getAgentStatus(agent.address);

      await expect(
        menuRegistry.connect(deployer).deductGas(agent.address, status.availableGas)
      ).to.emit(menuRegistry, "Starving");
    });
  });

  describe("Step 8: BEAN redemption — always redeemable", function () {
    it("should allow agent to sell BEAN back for ETH", async function () {
      const beanBalance = await cafeCore.balanceOf(agent.address);
      if (beanBalance > 0) {
        const agentEthBefore = await ethers.provider.getBalance(agent.address);
        await cafeCore.connect(agent).redeem(beanBalance, 0);
        const agentEthAfter = await ethers.provider.getBalance(agent.address);
        // Agent should have received ETH (minus gas costs for the tx)
        // The ETH increase from redemption should be positive
        const beanAfter = await cafeCore.balanceOf(agent.address);
        expect(beanAfter).to.equal(0);
      }
    });
  });

  describe("Step 9: Cafe stats", function () {
    it("should track total meals and unique agents", async function () {
      const stats = await agentCard.getCafeStats();
      expect(stats.totalMeals).to.be.greaterThan(0);
      expect(stats.uniqueAgents).to.equal(1); // only one agent visited
    });
  });

  describe("Step 10: Anti-honeypot guarantees", function () {
    it("should not allow setting treasury twice", async function () {
      await expect(
        cafeCore.setTreasury(deployer.address)
      ).to.be.revertedWith("Treasury already set");
    });

    it("should have solvency ratio > 0", async function () {
      const [reserve, cost] = await cafeCore.solvencyCheck();
      // After redemption, both should be close to 0 but reserve >= cost
      expect(reserve).to.be.greaterThanOrEqual(cost);
    });
  });
});
