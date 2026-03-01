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

describe("Edge Cases", function () {
  let cafeCore: CafeCore;
  let menuRegistry: MenuRegistry;
  let treasury: CafeTreasury;
  let gasTank: GasTank;
  let router: AgentCafeRouter;
  let deployer: HardhatEthersSigner;
  let agent: HardhatEthersSigner;
  let agent2: HardhatEthersSigner;
  let unauthorized: HardhatEthersSigner;

  before(async function () {
    [deployer, agent, agent2, unauthorized] = await ethers.getSigners();

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

    // Authorize router on GasTank
    await gasTank.setAuthorizedDeducter(await router.getAddress(), true);
    // Authorize deployer as deducter for testing
    await gasTank.setAuthorizedDeducter(deployer.address, true);

    // Set deployer as paymaster for testing
    await menuRegistry.setPaymaster(deployer.address);
  });

  // =========================================================================
  // GasTank Edge Cases
  // =========================================================================
  describe("GasTank Edge Cases", function () {
    it("should revert deposit to zero address", async function () {
      await expect(
        gasTank.deposit(ethers.ZeroAddress, { value: 1000 })
      ).to.be.revertedWith("Zero address");
    });

    it("should revert deposit with 0 ETH", async function () {
      await expect(
        gasTank.deposit(agent.address, { value: 0 })
      ).to.be.revertedWith("No ETH sent");
    });

    it("should revert withdraw more than balance", async function () {
      // Deposit a small amount first
      await gasTank.deposit(agent.address, { value: 1000 });

      await expect(
        gasTank.connect(agent).withdraw(1001)
      ).to.be.revertedWith("Insufficient tank balance");
    });

    it("should withdraw exactly full balance successfully", async function () {
      const balance = await gasTank.tankBalance(agent.address);
      await gasTank.connect(agent).withdraw(balance);

      const remaining = await gasTank.tankBalance(agent.address);
      expect(remaining).to.equal(0);
    });

    it("should revert withdraw of zero amount", async function () {
      await expect(
        gasTank.connect(agent).withdraw(0)
      ).to.be.revertedWith("Zero amount");
    });

    it("should accept deposit of 1 wei minimum", async function () {
      await gasTank.deposit(agent.address, { value: 1 });
      const balance = await gasTank.tankBalance(agent.address);
      expect(balance).to.equal(1);

      // Cleanup
      await gasTank.connect(agent).withdraw(1);
    });

    it("should accumulate multiple deposits correctly", async function () {
      await gasTank.deposit(agent.address, { value: 100 });
      await gasTank.deposit(agent.address, { value: 200 });
      await gasTank.deposit(agent.address, { value: 300 });

      const balance = await gasTank.tankBalance(agent.address);
      expect(balance).to.equal(600);

      // Cleanup
      await gasTank.connect(agent).withdraw(600);
    });

    it("should revert unauthorized deducter", async function () {
      await gasTank.deposit(agent.address, { value: 1000 });

      await expect(
        gasTank.connect(unauthorized).deductForGas(agent.address, 500)
      ).to.be.revertedWith("Not authorized");

      // Cleanup
      await gasTank.connect(agent).withdraw(1000);
    });

    it("should revert setting deducter to zero address", async function () {
      await expect(
        gasTank.setAuthorizedDeducter(ethers.ZeroAddress, true)
      ).to.be.revertedWith("Zero address");
    });

    it("should revert deducting more than balance", async function () {
      await gasTank.deposit(agent.address, { value: 500 });

      await expect(
        gasTank.deductForGas(agent.address, 501)
      ).to.be.revertedWith("Insufficient tank balance");

      // Cleanup
      await gasTank.connect(agent).withdraw(500);
    });

    it("should emit Starving when deducting to exactly zero", async function () {
      await gasTank.deposit(agent.address, { value: 100 });

      await expect(gasTank.deductForGas(agent.address, 100))
        .to.emit(gasTank, "Starving")
        .withArgs(agent.address);
    });

    it("should emit Hungry when balance drops below threshold but not to zero", async function () {
      // Deposit above threshold, deduct to below threshold but > 0
      await gasTank.deposit(agent.address, {
        value: ethers.parseEther("0.002"),
      });

      await expect(
        gasTank.deductForGas(
          agent.address,
          ethers.parseEther("0.0015")
        )
      ).to.emit(gasTank, "Hungry");

      // Cleanup
      const remaining = await gasTank.tankBalance(agent.address);
      await gasTank.connect(agent).withdraw(remaining);
    });

    it("should only allow owner to set authorized deducter", async function () {
      await expect(
        gasTank
          .connect(unauthorized)
          .setAuthorizedDeducter(agent.address, true)
      ).to.be.revertedWithCustomError(gasTank, "OwnableUnauthorizedAccount");
    });
  });

  // =========================================================================
  // Router Edge Cases
  // =========================================================================
  describe("Router Edge Cases", function () {
    it("should handle enterCafe with very small ETH amounts", async function () {
      // 100 wei — very small, but should still work for the gas tank split
      const smallAmount = 100n;
      const tankBefore = await gasTank.tankBalance(agent.address);
      const treasuryBefore = await ethers.provider.getBalance(
        await treasury.getAddress()
      );

      await router
        .connect(agent)
        .enterCafe(0, { value: smallAmount });

      const tankAfter = await gasTank.tankBalance(agent.address);
      const treasuryAfter = await ethers.provider.getBalance(
        await treasury.getAddress()
      );

      const fee = (smallAmount * 30n) / 10000n; // 0.3%
      const toTank = smallAmount - fee;

      expect(tankAfter - tankBefore).to.equal(toTank);
      expect(treasuryAfter - treasuryBefore).to.equal(fee);
    });

    it("should revert enterCafe with invalid menu item", async function () {
      await expect(
        router
          .connect(agent)
          .enterCafe(99, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Not on menu");
    });

    it("should revert enterCafe with menu item 3 (non-existent)", async function () {
      await expect(
        router
          .connect(agent)
          .enterCafe(3, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Not on menu");
    });

    it("should handle multiple agents entering cafe simultaneously", async function () {
      const amount = ethers.parseEther("0.01");

      // Use different signers
      const [, , , , agent3, agent4, agent5] = await ethers.getSigners();

      // All three agents enter the cafe
      await router.connect(agent3).enterCafe(0, { value: amount });
      await router.connect(agent4).enterCafe(1, { value: amount });
      await router.connect(agent5).enterCafe(2, { value: amount });

      // All three should have gas in their tanks
      const toTank = amount - (amount * 30n) / 10000n;
      const [tank3] = await gasTank.getTankLevel(agent3.address);
      const [tank4] = await gasTank.getTankLevel(agent4.address);
      const [tank5] = await gasTank.getTankLevel(agent5.address);

      expect(tank3).to.equal(toTank);
      expect(tank4).to.equal(toTank);
      expect(tank5).to.equal(toTank);
    });

    it("should return reasonable values from estimatePrice", async function () {
      const price0 = await router.estimatePrice(0); // Espresso
      const price1 = await router.estimatePrice(1); // Latte
      const price2 = await router.estimatePrice(2); // Sandwich

      // Prices should be non-zero and in ascending order (more BEAN cost = more ETH)
      expect(price0).to.be.greaterThan(0);
      expect(price1).to.be.greaterThan(price0);
      expect(price2).to.be.greaterThan(price1);
    });

    it("should revert estimatePrice for invalid item", async function () {
      await expect(router.estimatePrice(99)).to.be.revertedWith(
        "Not on menu"
      );
    });

    it("fee + tank should always equal msg.value (no dust lost)", async function () {
      // Test with amounts that could cause rounding issues
      const testAmounts = [
        1n,
        3n,
        7n,
        13n,
        99n,
        101n,
        9999n,
        10001n,
        ethers.parseEther("0.000000000000000001"), // 1 wei
        ethers.parseEther("0.000000001"),
        ethers.parseEther("0.001"),
        ethers.parseEther("0.1"),
      ];

      const [, , , , , , , dustAgent] = await ethers.getSigners();

      for (const amount of testAmounts) {
        if (amount === 0n) continue;

        const treasuryBefore = await ethers.provider.getBalance(
          await treasury.getAddress()
        );
        const tankBefore = await gasTank.tankBalance(dustAgent.address);

        await router
          .connect(dustAgent)
          .enterCafe(0, { value: amount });

        const treasuryAfter = await ethers.provider.getBalance(
          await treasury.getAddress()
        );
        const tankAfter = await gasTank.tankBalance(dustAgent.address);

        const feeReceived = treasuryAfter - treasuryBefore;
        const tankReceived = tankAfter - tankBefore;

        // fee + tank must equal original amount exactly
        expect(feeReceived + tankReceived).to.equal(
          amount,
          `Dust lost for amount ${amount}`
        );
      }
    });

    it("should reject enterCafe with 0 ETH", async function () {
      await expect(
        router.connect(agent).enterCafe(0, { value: 0 })
      ).to.be.revertedWith("No ETH sent");
    });

    it("should allow owner to update treasury address", async function () {
      const newTreasury = agent2.address;
      await router.setOwnerTreasury(newTreasury);
      expect(await router.ownerTreasury()).to.equal(newTreasury);

      // Restore original treasury
      await router.setOwnerTreasury(await treasury.getAddress());
    });

    it("should revert setOwnerTreasury to zero address", async function () {
      await expect(
        router.setOwnerTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });

    it("should revert setOwnerTreasury from non-owner", async function () {
      await expect(
        router.connect(unauthorized).setOwnerTreasury(agent.address)
      ).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    });
  });

  // =========================================================================
  // MenuRegistry Edge Cases
  // =========================================================================
  describe("MenuRegistry Edge Cases", function () {
    it("should revert buyItemFor from non-authorized caller", async function () {
      await expect(
        menuRegistry
          .connect(unauthorized)
          .buyItemFor(agent.address, 0, 1)
      ).to.be.revertedWith("Not authorized");
    });

    it("should revert consumeFor from non-authorized caller", async function () {
      await expect(
        menuRegistry
          .connect(unauthorized)
          .consumeFor(agent.address, 0, 1)
      ).to.be.revertedWith("Not authorized");
    });

    it("should revert consumeFor when agent has no items", async function () {
      // Authorize deployer as caller for this test
      await menuRegistry.setAuthorizedCaller(deployer.address, true);

      await expect(
        menuRegistry.consumeFor(agent.address, 0, 1)
      ).to.be.revertedWith("Not enough items");

      // Revoke
      await menuRegistry.setAuthorizedCaller(deployer.address, false);
    });

    it("should revert consume when agent has no items (direct call)", async function () {
      await expect(
        menuRegistry.connect(agent).consume(0, 1)
      ).to.be.revertedWith("Not enough items");
    });

    it("should revert buyItem with zero quantity", async function () {
      await expect(
        menuRegistry.connect(agent).buyItem(0, 0)
      ).to.be.revertedWith("Zero quantity");
    });

    it("should revert buyItem for inactive menu item", async function () {
      // Item 99 doesn't exist, so active = false (default)
      await expect(
        menuRegistry.connect(agent).buyItem(99, 1)
      ).to.be.revertedWith("Not on menu");
    });

    it("should revert buyItem without BEAN approval", async function () {
      await expect(
        menuRegistry.connect(agent).buyItem(0, 1)
      ).to.be.reverted; // ERC20 transfer fails
    });

    it("should revert setPaymaster to zero address", async function () {
      await expect(
        menuRegistry.setPaymaster(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });

    it("should revert setAuthorizedCaller to zero address", async function () {
      await expect(
        menuRegistry.setAuthorizedCaller(ethers.ZeroAddress, true)
      ).to.be.revertedWith("Zero address");
    });

    it("should only allow owner to setAuthorizedCaller", async function () {
      await expect(
        menuRegistry
          .connect(unauthorized)
          .setAuthorizedCaller(agent.address, true)
      ).to.be.revertedWithCustomError(
        menuRegistry,
        "OwnableUnauthorizedAccount"
      );
    });

    it("should revert deductGas from unauthorized caller", async function () {
      await expect(
        menuRegistry.connect(unauthorized).deductGas(agent.address, 100)
      ).to.be.revertedWith("Not authorized");
    });

    it("should revert deductGas when insufficient energy", async function () {
      // Agent has 0 available gas (from previous test suite state or fresh)
      await expect(
        menuRegistry.connect(deployer).deductGas(agent.address, 1)
      ).to.be.revertedWith("Insufficient energy");
    });
  });

  // =========================================================================
  // Fee Split Precision Edge Cases
  // =========================================================================
  describe("Fee Split Precision", function () {
    it("should handle 0.3%/99.7% split correctly with amount causing rounding (1 wei)", async function () {
      const [, , , , , , , , roundAgent] = await ethers.getSigners();
      const amount = 1n; // 1 wei: 0.3% of 1 = 0, so fee = 0, tank = 1

      const treasuryBefore = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      const tankBefore = await gasTank.tankBalance(roundAgent.address);

      await router
        .connect(roundAgent)
        .enterCafe(0, { value: amount });

      const treasuryAfter = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      const tankAfter = await gasTank.tankBalance(roundAgent.address);

      const fee = treasuryAfter - treasuryBefore;
      const tank = tankAfter - tankBefore;

      // For 1 wei: fee = (1 * 30) / 10000 = 0, tank = 1 - 0 = 1
      expect(fee).to.equal(0n);
      expect(tank).to.equal(1n);
      expect(fee + tank).to.equal(amount);
    });

    it("should handle 0.3%/99.7% split with 19 wei (rounding down)", async function () {
      const [, , , , , , , , , roundAgent2] = await ethers.getSigners();
      const amount = 19n; // fee = (19*30)/10000 = 0 (integer division)

      const treasuryBefore = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      const tankBefore = await gasTank.tankBalance(roundAgent2.address);

      await router
        .connect(roundAgent2)
        .enterCafe(0, { value: amount });

      const treasuryAfter = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      const tankAfter = await gasTank.tankBalance(roundAgent2.address);

      const fee = treasuryAfter - treasuryBefore;
      const tank = tankAfter - tankBefore;

      expect(fee + tank).to.equal(amount, "No dust lost for 19 wei");
    });

    it("should handle 0.3%/99.7% split with 334 wei (exact boundary)", async function () {
      const [, , , , , , , , , , roundAgent3] = await ethers.getSigners();
      const amount = 334n; // fee = (334*30)/10000 = 1 (first amount that produces fee=1)

      const treasuryBefore = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      const tankBefore = await gasTank.tankBalance(roundAgent3.address);

      await router
        .connect(roundAgent3)
        .enterCafe(0, { value: amount });

      const treasuryAfter = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      const tankAfter = await gasTank.tankBalance(roundAgent3.address);

      const fee = treasuryAfter - treasuryBefore;
      const tank = tankAfter - tankBefore;

      expect(fee).to.equal(1n);
      expect(tank).to.equal(333n);
      expect(fee + tank).to.equal(amount);
    });

    it("should handle 0.3%/99.7% split with 1000 wei (non-trivial rounding)", async function () {
      const [, , , , , , , , , , , roundAgent4] = await ethers.getSigners();
      const amount = 1000n; // fee = (1000*30)/10000 = 3

      const treasuryBefore = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      const tankBefore = await gasTank.tankBalance(roundAgent4.address);

      await router
        .connect(roundAgent4)
        .enterCafe(0, { value: amount });

      const treasuryAfter = await ethers.provider.getBalance(
        await treasury.getAddress()
      );
      const tankAfter = await gasTank.tankBalance(roundAgent4.address);

      const fee = treasuryAfter - treasuryBefore;
      const tank = tankAfter - tankBefore;

      // fee = floor(1000 * 30 / 10000) = floor(3) = 3
      // tank = 1000 - 3 = 997
      expect(fee).to.equal(3n);
      expect(tank).to.equal(997n);
      expect(fee + tank).to.equal(amount, "No dust lost for 1000 wei");
    });

    it("should never lose ETH dust across many amounts", async function () {
      const [, , , , , , , , , , , , dustAgent2] =
        await ethers.getSigners();

      // Test a range of amounts that may cause rounding edge cases
      const amounts = [
        1n, 2n, 3n, 10n, 11n, 19n, 20n, 21n, 39n, 40n, 41n, 99n, 100n,
        101n, 199n, 200n, 201n, 999n, 1000n, 1001n, 9999n, 10000n,
        10001n, 19999n, 20000n, 20001n,
      ];

      for (const amount of amounts) {
        const treasuryBefore = await ethers.provider.getBalance(
          await treasury.getAddress()
        );
        const tankBefore = await gasTank.tankBalance(dustAgent2.address);

        await router
          .connect(dustAgent2)
          .enterCafe(0, { value: amount });

        const treasuryAfter = await ethers.provider.getBalance(
          await treasury.getAddress()
        );
        const tankAfter = await gasTank.tankBalance(dustAgent2.address);

        const fee = treasuryAfter - treasuryBefore;
        const tank = tankAfter - tankBefore;

        expect(fee + tank).to.equal(
          amount,
          `Dust lost for amount ${amount}`
        );
      }
    });
  });

  // =========================================================================
  // CafeCore Edge Cases
  // =========================================================================
  describe("CafeCore Edge Cases", function () {
    it("should revert mint with 0 ETH", async function () {
      await expect(
        cafeCore.connect(agent).mint(0, { value: 0 })
      ).to.be.revertedWith("No ETH sent");
    });

    it("should revert redeem with 0 BEAN", async function () {
      await expect(
        cafeCore.connect(agent).redeem(0, 0)
      ).to.be.revertedWith("Zero BEAN");
    });

    it("should revert redeem with more BEAN than balance", async function () {
      await expect(
        cafeCore.connect(agent).redeem(999999, 0)
      ).to.be.revertedWith("Insufficient BEAN");
    });

    it("should not allow setting treasury twice", async function () {
      await expect(
        cafeCore.setTreasury(deployer.address)
      ).to.be.revertedWith("Treasury already set");
    });

    it("should revert setTreasury to zero address", async function () {
      // Deploy fresh CafeCore for this test
      const CafeCore = await ethers.getContractFactory("CafeCore");
      const freshCore = await CafeCore.deploy();
      await freshCore.waitForDeployment();

      await expect(
        freshCore.setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });

    it("should handle very small mint that results in 0 BEAN", async function () {
      // 1 wei might not be enough to buy any BEAN
      await expect(
        cafeCore.connect(agent).mint(0, { value: 1 })
      ).to.be.revertedWith("ETH too small");
    });

    it("should maintain solvency after mint and redeem cycles", async function () {
      // Mint some BEAN
      await cafeCore
        .connect(agent)
        .mint(0, { value: ethers.parseEther("0.01") });
      const beanBal = await cafeCore.balanceOf(agent.address);

      if (beanBal > 0n) {
        // Redeem all
        await cafeCore.connect(agent).redeem(beanBal, 0);

        // Solvency check
        const [reserve, cost] = await cafeCore.solvencyCheck();
        expect(reserve).to.be.greaterThanOrEqual(cost);
      }
    });
  });

  // =========================================================================
  // CafeTreasury Edge Cases
  // =========================================================================
  describe("CafeTreasury Edge Cases", function () {
    it("should revert withdrawETH to zero address", async function () {
      await expect(
        treasury.withdrawETH(ethers.ZeroAddress, 1)
      ).to.be.revertedWith("Zero address");
    });

    it("should revert withdrawETH from non-owner", async function () {
      await expect(
        treasury.connect(unauthorized).withdrawETH(agent.address, 1)
      ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    });

    it("should revert withdrawETH when treasury has no ETH", async function () {
      // Treasury may have some ETH from fees. Try to withdraw more than available.
      const treasuryAddr = await treasury.getAddress();
      const bal = await ethers.provider.getBalance(treasuryAddr);

      if (bal === 0n) {
        await expect(
          treasury.withdrawETH(deployer.address, 1)
        ).to.be.revertedWith("ETH transfer failed");
      } else {
        // Withdraw all, then try to withdraw 1 more
        await treasury.withdrawETH(deployer.address, bal);
        await expect(
          treasury.withdrawETH(deployer.address, 1)
        ).to.be.revertedWith("ETH transfer failed");
      }
    });
  });
});
