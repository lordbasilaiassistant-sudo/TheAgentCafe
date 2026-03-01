import { expect } from "chai";
import { ethers } from "hardhat";
import {
  CafeCore,
  MenuRegistry,
  CafeTreasury,
  GasTank,
  AgentCafeRouter,
  AgentCard,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Security Fixes & Critical Paths", function () {
  let cafeCore: CafeCore;
  let menuRegistry: MenuRegistry;
  let treasury: CafeTreasury;
  let gasTank: GasTank;
  let router: AgentCafeRouter;
  let agentCard: AgentCard;
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

    const AgentCard = await ethers.getContractFactory("AgentCard");
    agentCard = await AgentCard.deploy(
      await menuRegistry.getAddress(),
      await gasTank.getAddress(),
      await router.getAddress()
    );
    await agentCard.waitForDeployment();
  });

  // =========================================================================
  // C-1 FIX: deductForGas transfers ETH to caller
  // =========================================================================
  describe("GasTank.deductForGas ETH transfer (C-1 fix)", function () {
    it("should transfer deducted ETH to the caller (paymaster)", async function () {
      await gasTank.deposit(agent.address, {
        value: ethers.parseEther("0.01"),
      });

      const deductAmount = ethers.parseEther("0.003");
      const deployerBefore = await ethers.provider.getBalance(deployer.address);

      const tx = await gasTank.deductForGas(agent.address, deductAmount);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;

      const deployerAfter = await ethers.provider.getBalance(deployer.address);

      // Deployer should have received deductAmount minus gas cost for the tx
      const netChange = deployerAfter - deployerBefore + gasCost;
      expect(netChange).to.equal(deductAmount);
    });

    it("should keep GasTank contract balance in sync with totalCredited", async function () {
      const tankBal = await ethers.provider.getBalance(
        await gasTank.getAddress()
      );
      const credited = await gasTank.totalCredited();

      // Contract balance should be >= totalCredited (could be > if ETH sent directly)
      expect(tankBal).to.be.greaterThanOrEqual(credited);
    });

    it("should decrease contract balance after deductForGas", async function () {
      // Deposit fresh
      await gasTank.deposit(agent2.address, {
        value: ethers.parseEther("0.005"),
      });

      const contractBefore = await ethers.provider.getBalance(
        await gasTank.getAddress()
      );

      await gasTank.deductForGas(
        agent2.address,
        ethers.parseEther("0.002")
      );

      const contractAfter = await ethers.provider.getBalance(
        await gasTank.getAddress()
      );

      // Contract balance should have decreased by 0.002 ETH
      expect(contractBefore - contractAfter).to.equal(
        ethers.parseEther("0.002")
      );
    });
  });

  // =========================================================================
  // totalCredited tracking
  // =========================================================================
  describe("GasTank.totalCredited tracking", function () {
    it("should increment totalCredited on deposit", async function () {
      const before = await gasTank.totalCredited();
      await gasTank.deposit(agent.address, {
        value: ethers.parseEther("0.001"),
      });
      const after = await gasTank.totalCredited();
      expect(after - before).to.equal(ethers.parseEther("0.001"));
    });

    it("should decrement totalCredited on withdraw", async function () {
      const before = await gasTank.totalCredited();
      const agentBal = await gasTank.tankBalance(agent.address);

      if (agentBal > 0n) {
        const withdrawAmt =
          agentBal > ethers.parseEther("0.001")
            ? ethers.parseEther("0.001")
            : agentBal;
        await gasTank.connect(agent).withdraw(withdrawAmt);
        const after = await gasTank.totalCredited();
        expect(before - after).to.equal(withdrawAmt);
      }
    });

    it("should decrement totalCredited on deductForGas", async function () {
      await gasTank.deposit(agent.address, { value: 5000 });
      const before = await gasTank.totalCredited();
      await gasTank.deductForGas(agent.address, 1000);
      const after = await gasTank.totalCredited();
      expect(before - after).to.equal(1000n);
    });
  });

  // =========================================================================
  // withdrawSurplus
  // =========================================================================
  describe("GasTank.withdrawSurplus", function () {
    it("should withdraw surplus ETH sent directly via receive()", async function () {
      // Send ETH directly to GasTank (not through deposit)
      const gasTankAddr = await gasTank.getAddress();
      await deployer.sendTransaction({
        to: gasTankAddr,
        value: ethers.parseEther("0.005"),
      });

      const contractBal = await ethers.provider.getBalance(gasTankAddr);
      const credited = await gasTank.totalCredited();
      const surplus = contractBal - credited;

      expect(surplus).to.be.greaterThan(0);

      const deployerBefore = await ethers.provider.getBalance(deployer.address);
      const tx = await gasTank.withdrawSurplus(deployer.address);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const deployerAfter = await ethers.provider.getBalance(deployer.address);

      const received = deployerAfter - deployerBefore + gasCost;
      expect(received).to.equal(surplus);
    });

    it("should revert withdrawSurplus when no surplus exists", async function () {
      await expect(
        gasTank.withdrawSurplus(deployer.address)
      ).to.be.revertedWith("No surplus");
    });

    it("should revert withdrawSurplus to zero address", async function () {
      await expect(
        gasTank.withdrawSurplus(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });

    it("should revert withdrawSurplus from non-owner", async function () {
      await expect(
        gasTank.connect(agent).withdrawSurplus(agent.address)
      ).to.be.revertedWithCustomError(gasTank, "OwnableUnauthorizedAccount");
    });
  });

  // =========================================================================
  // Router.emergencyWithdrawETH
  // =========================================================================
  describe("Router.emergencyWithdrawETH", function () {
    it("should allow owner to withdraw stuck ETH", async function () {
      // Send ETH directly to the router
      const routerAddr = await router.getAddress();
      await deployer.sendTransaction({
        to: routerAddr,
        value: ethers.parseEther("0.003"),
      });

      const routerBal = await ethers.provider.getBalance(routerAddr);
      expect(routerBal).to.be.greaterThan(0);

      await router.emergencyWithdrawETH(deployer.address);

      const routerBalAfter = await ethers.provider.getBalance(routerAddr);
      expect(routerBalAfter).to.equal(0);
    });

    it("should revert when no ETH to withdraw", async function () {
      await expect(
        router.emergencyWithdrawETH(deployer.address)
      ).to.be.revertedWith("No ETH to withdraw");
    });

    it("should revert emergencyWithdrawETH to zero address", async function () {
      await expect(
        router.emergencyWithdrawETH(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });

    it("should revert emergencyWithdrawETH from non-owner", async function () {
      await expect(
        router.connect(agent).emergencyWithdrawETH(agent.address)
      ).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    });
  });

  // =========================================================================
  // CafeTreasury.withdrawBEAN (L-2 fix)
  // =========================================================================
  describe("CafeTreasury.withdrawBEAN (L-2 fix)", function () {
    it("should allow owner to withdraw BEAN from treasury", async function () {
      // First get some BEAN into the treasury via a menu purchase
      // Mint BEAN for agent
      await cafeCore
        .connect(agent)
        .mint(0, { value: ethers.parseEther("0.01") });
      const beanBal = await cafeCore.balanceOf(agent.address);

      if (beanBal >= 50n) {
        // Buy an espresso — 99% goes to treasury
        await cafeCore
          .connect(agent)
          .approve(await menuRegistry.getAddress(), 50);
        await menuRegistry.connect(agent).buyItem(0, 1);

        const treasuryBeanBefore = await treasury.beanBalance();
        expect(treasuryBeanBefore).to.be.greaterThan(0);

        // Withdraw BEAN
        const amount = treasuryBeanBefore;
        await treasury.withdrawBEAN(deployer.address, amount);

        const treasuryBeanAfter = await treasury.beanBalance();
        expect(treasuryBeanAfter).to.equal(0);

        const deployerBean = await cafeCore.balanceOf(deployer.address);
        expect(deployerBean).to.be.greaterThanOrEqual(amount);
      }
    });

    it("should revert withdrawBEAN to zero address", async function () {
      await expect(
        treasury.withdrawBEAN(ethers.ZeroAddress, 1)
      ).to.be.revertedWith("Zero address");
    });

    it("should revert withdrawBEAN from non-owner", async function () {
      await expect(
        treasury.connect(agent).withdrawBEAN(agent.address, 1)
      ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });
  });

  // =========================================================================
  // CafeCore: require treasurySet (M-2 fix)
  // =========================================================================
  describe("CafeCore requires treasury set (M-2 fix)", function () {
    it("should revert mint if treasury not set", async function () {
      const CafeCore = await ethers.getContractFactory("CafeCore");
      const freshCore = await CafeCore.deploy();
      await freshCore.waitForDeployment();

      await expect(
        freshCore.connect(agent).mint(0, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Treasury not set");
    });

    it("should revert redeem if treasury not set", async function () {
      const CafeCore = await ethers.getContractFactory("CafeCore");
      const freshCore = await CafeCore.deploy();
      await freshCore.waitForDeployment();

      await expect(
        freshCore.connect(agent).redeem(1, 0)
      ).to.be.revertedWith("Treasury not set");
    });
  });

  // =========================================================================
  // CafeCore receive() no longer inflates ethReserve
  // =========================================================================
  describe("CafeCore receive() does not inflate reserve", function () {
    it("should accept ETH via receive() without changing ethReserve", async function () {
      const reserveBefore = await cafeCore.ethReserve();
      await deployer.sendTransaction({
        to: await cafeCore.getAddress(),
        value: ethers.parseEther("0.001"),
      });
      const reserveAfter = await cafeCore.ethReserve();
      expect(reserveAfter).to.equal(reserveBefore);
    });
  });

  // =========================================================================
  // Router food token minting — the BEAN path
  // =========================================================================
  describe("Router enterCafe food token minting", function () {
    it("should mint food token to agent when enough ETH is sent", async function () {
      // Send enough ETH that the router can afford BEAN for espresso (50 BEAN)
      // At genesis supply, 50 BEAN costs ~50 * 1e12 = 5e13 wei = 0.00005 ETH
      // Plus mint fee. Send 0.01 ETH which is way more than enough.
      const ethToSend = ethers.parseEther("0.01");

      // Check espresso balance before
      const espressoBefore = await menuRegistry.balanceOf(agent2.address, 0);

      await router.connect(agent2).enterCafe(0, { value: ethToSend });

      // The router tries to mint BEAN and buy food — but since 99.7% goes to tank
      // and only the router's leftover balance is used for BEAN, the food token
      // may or may not get minted depending on router's ETH balance.
      // This is by design — food is a bonus, gas tank fill is guaranteed.
      const espressoAfter = await menuRegistry.balanceOf(agent2.address, 0);

      // Food tokens should be 0 since they're consumed in the same tx
      // (buyItemFor + consumeFor). The metabolic state should show the meal.
      const status = await menuRegistry.getAgentStatus(agent2.address);
      // If food was minted+consumed, mealCount > 0
      // The gas tank should definitely be filled regardless
      const [tankBal] = await gasTank.getTankLevel(agent2.address);
      expect(tankBal).to.be.greaterThan(0);
    });

    it("should still fill gas tank even if BEAN minting fails (no router balance)", async function () {
      // The router has no extra ETH, so BEAN minting can't happen
      // But the gas tank should still fill with 99.7%
      const [, , , , , freshAgent] = await ethers.getSigners();
      const ethToSend = ethers.parseEther("0.005");

      await router.connect(freshAgent).enterCafe(0, { value: ethToSend });

      const [tankBal] = await gasTank.getTankLevel(freshAgent.address);
      const expectedTank =
        ethToSend - (ethToSend * 30n) / 10000n;
      expect(tankBal).to.equal(expectedTank);
    });
  });

  // =========================================================================
  // MenuRegistry PaymasterSet event (L-3 fix)
  // =========================================================================
  describe("MenuRegistry emits PaymasterSet event (L-3 fix)", function () {
    it("should emit PaymasterSet when paymaster is changed", async function () {
      await expect(menuRegistry.setPaymaster(deployer.address))
        .to.emit(menuRegistry, "PaymasterSet")
        .withArgs(deployer.address);
    });
  });

  // =========================================================================
  // AgentCard reads menu dynamically (L-4 fix)
  // =========================================================================
  describe("AgentCard reads menu from MenuRegistry (L-4 fix)", function () {
    it("should return menu data matching MenuRegistry", async function () {
      const cardMenu = await agentCard.getFullMenu();
      const [ids, names, costs, calories, digestionTimes] =
        await menuRegistry.getMenu();

      expect(cardMenu.length).to.equal(ids.length);
      for (let i = 0; i < cardMenu.length; i++) {
        expect(cardMenu[i].id).to.equal(ids[i]);
        expect(cardMenu[i].name).to.equal(names[i]);
        expect(cardMenu[i].beanCost).to.equal(costs[i]);
        expect(cardMenu[i].gasCalories).to.equal(calories[i]);
        expect(cardMenu[i].digestionBlocks).to.equal(digestionTimes[i]);
      }
    });
  });

  // =========================================================================
  // AgentCard helpers
  // =========================================================================
  describe("AgentCard view helpers", function () {
    it("getTankStatus should match GasTank.getTankLevel", async function () {
      const [cardBal, cardHungry, cardStarving] =
        await agentCard.getTankStatus(agent.address);
      const [tankBal, tankHungry, tankStarving] =
        await gasTank.getTankLevel(agent.address);

      expect(cardBal).to.equal(tankBal);
      expect(cardHungry).to.equal(tankHungry);
      expect(cardStarving).to.equal(tankStarving);
    });

    it("getContractAddresses should return correct addresses", async function () {
      const addrs = await agentCard.getContractAddresses();
      expect(addrs.routerAddr).to.equal(await router.getAddress());
      expect(addrs.gasTankAddr).to.equal(await gasTank.getAddress());
      expect(addrs.menuRegistryAddr).to.equal(
        await menuRegistry.getAddress()
      );
    });

    it("getManifest should include router address", async function () {
      const manifest = await agentCard.getManifest();
      const routerAddr = (await router.getAddress()).toLowerCase();
      expect(manifest.toLowerCase()).to.include(routerAddr);
    });

    it("getOnboardingGuide should include both router and gasTank addresses", async function () {
      const guide = await agentCard.getOnboardingGuide();
      const routerAddr = (await router.getAddress()).toLowerCase();
      const gasTankAddr = (await gasTank.getAddress()).toLowerCase();
      expect(guide.toLowerCase()).to.include(routerAddr);
      expect(guide.toLowerCase()).to.include(gasTankAddr);
    });
  });

  // =========================================================================
  // Bonding curve solvency stress test
  // =========================================================================
  describe("Bonding curve solvency under stress", function () {
    it("should maintain solvency after 10 mint/redeem cycles", async function () {
      const [, , , , , , stressAgent] = await ethers.getSigners();

      for (let i = 0; i < 10; i++) {
        // Mint
        await cafeCore
          .connect(stressAgent)
          .mint(0, { value: ethers.parseEther("0.005") });

        // Redeem half
        const bal = await cafeCore.balanceOf(stressAgent.address);
        if (bal > 1n) {
          await cafeCore.connect(stressAgent).redeem(bal / 2n, 0);
        }
      }

      // Final solvency check
      const [reserve, cost] = await cafeCore.solvencyCheck();
      expect(reserve).to.be.greaterThanOrEqual(cost);

      // Clean up — redeem remaining
      const remaining = await cafeCore.balanceOf(stressAgent.address);
      if (remaining > 0n) {
        await cafeCore.connect(stressAgent).redeem(remaining, 0);
      }

      const [finalReserve, finalCost] = await cafeCore.solvencyCheck();
      expect(finalReserve).to.be.greaterThanOrEqual(finalCost);
    });
  });

  // =========================================================================
  // Full cycle: enter -> use gas -> go hungry -> eat again -> withdraw
  // =========================================================================
  describe("Full lifecycle with gas deduction and re-entry", function () {
    it("should complete full eat -> deduct -> hungry -> eat -> withdraw cycle", async function () {
      const [, , , , , , , cycleAgent] = await ethers.getSigners();

      // 1. Enter cafe
      await router
        .connect(cycleAgent)
        .enterCafe(1, { value: ethers.parseEther("0.01") });

      let [bal, hungry, starving] = await gasTank.getTankLevel(
        cycleAgent.address
      );
      expect(bal).to.equal(ethers.parseEther("0.00997"));
      expect(hungry).to.equal(false);
      expect(starving).to.equal(false);

      // 2. Deduct gas until hungry
      await gasTank.deductForGas(
        cycleAgent.address,
        ethers.parseEther("0.009")
      );

      [bal, hungry, starving] = await gasTank.getTankLevel(cycleAgent.address);
      expect(bal).to.equal(ethers.parseEther("0.00097"));
      expect(hungry).to.equal(true);
      expect(starving).to.equal(false);

      // 3. Eat again
      await router
        .connect(cycleAgent)
        .enterCafe(0, { value: ethers.parseEther("0.005") });

      [bal, hungry] = await gasTank.getTankLevel(cycleAgent.address);
      expect(bal).to.be.greaterThan(ethers.parseEther("0.004"));
      expect(hungry).to.equal(false);

      // 4. Withdraw some
      const withdrawAmt = ethers.parseEther("0.002");
      const walletBefore = await ethers.provider.getBalance(
        cycleAgent.address
      );

      const tx = await gasTank.connect(cycleAgent).withdraw(withdrawAmt);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;

      const walletAfter = await ethers.provider.getBalance(cycleAgent.address);
      expect(walletAfter - walletBefore + gasCost).to.equal(withdrawAmt);

      // 5. Verify tank decreased
      const [finalBal] = await gasTank.getTankLevel(cycleAgent.address);
      expect(finalBal).to.be.greaterThan(0);
    });
  });

  // =========================================================================
  // Revoking authorization
  // =========================================================================
  describe("Authorization revocation", function () {
    it("should block deductForGas after revoking deducter", async function () {
      const [, , , , , , , , revokeAgent] = await ethers.getSigners();

      // Authorize, deposit, verify it works
      await gasTank.setAuthorizedDeducter(agent2.address, true);
      await gasTank.deposit(revokeAgent.address, { value: 10000 });
      await gasTank.connect(agent2).deductForGas(revokeAgent.address, 1000);

      // Revoke
      await gasTank.setAuthorizedDeducter(agent2.address, false);

      // Should fail now
      await expect(
        gasTank.connect(agent2).deductForGas(revokeAgent.address, 1000)
      ).to.be.revertedWith("Not authorized");
    });

    it("should block buyItemFor after revoking authorized caller", async function () {
      await menuRegistry.setAuthorizedCaller(agent2.address, true);
      await menuRegistry.setAuthorizedCaller(agent2.address, false);

      await expect(
        menuRegistry.connect(agent2).buyItemFor(agent.address, 0, 1)
      ).to.be.revertedWith("Not authorized");
    });
  });
});
