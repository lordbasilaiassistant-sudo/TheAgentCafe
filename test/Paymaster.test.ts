import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentCafePaymaster, GasTank } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  impersonateAccount,
  setBalance,
  stopImpersonatingAccount,
  mine,
} from "@nomicfoundation/hardhat-network-helpers";

/**
 * Paymaster ERC-4337 Tests
 *
 * Tests the AgentCafePaymaster with realistic UserOperation flows.
 * Uses the real EntryPoint contract from @account-abstraction so the
 * BasePaymaster constructor's ERC-165 check passes, then impersonates
 * the EntryPoint address to call validatePaymasterUserOp / postOp.
 */

const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

// Build a minimal PackedUserOperation struct
function buildUserOp(
  sender: string,
  paymasterAddress: string,
  maxFeePerGas: bigint = ethers.parseUnits("1", "gwei"),
  maxPriorityFee: bigint = ethers.parseUnits("0.1", "gwei")
) {
  // Pack gasFees: maxPriorityFeePerGas (uint128) | maxFeePerGas (uint128)
  const gasFees = ethers.solidityPacked(
    ["uint128", "uint128"],
    [maxPriorityFee, maxFeePerGas]
  );

  // Pack accountGasLimits: verificationGasLimit (uint128) | callGasLimit (uint128)
  const accountGasLimits = ethers.solidityPacked(
    ["uint128", "uint128"],
    [100_000n, 200_000n]
  );

  // paymasterAndData: paymaster address (20 bytes) + paymasterVerificationGasLimit (uint128) + paymasterPostOpGasLimit (uint128) + optional data
  const paymasterAndData = ethers.solidityPacked(
    ["address", "uint128", "uint128"],
    [paymasterAddress, 100_000n, 50_000n]
  );

  return {
    sender,
    nonce: 0n,
    initCode: "0x",
    callData: "0x",
    accountGasLimits,
    preVerificationGas: 50_000n,
    gasFees,
    paymasterAndData,
    signature: "0x",
  };
}

describe("AgentCafePaymaster — ERC-4337 Tests", function () {
  let gasTank: GasTank;
  let paymaster: AgentCafePaymaster;
  let deployer: HardhatEthersSigner;
  let agent: HardhatEthersSigner;
  let agent2: HardhatEthersSigner;
  let entryPointSigner: HardhatEthersSigner;
  let entryPointAddress: string;

  before(async function () {
    [deployer, agent, agent2] = await ethers.getSigners();

    // Deploy MockEntryPoint so BasePaymaster ERC-165 check passes
    const EntryPoint = await ethers.getContractFactory("MockEntryPoint");
    const ep = await EntryPoint.deploy();
    await ep.waitForDeployment();
    entryPointAddress = await ep.getAddress();

    // Deploy GasTank
    const GasTankFactory = await ethers.getContractFactory("GasTank");
    gasTank = await GasTankFactory.deploy();
    await gasTank.waitForDeployment();

    // Deploy Paymaster with real EntryPoint
    const PaymasterFactory = await ethers.getContractFactory(
      "AgentCafePaymaster"
    );
    paymaster = await PaymasterFactory.deploy(
      entryPointAddress,
      await gasTank.getAddress()
    );
    await paymaster.waitForDeployment();

    // Authorize paymaster as deducter on GasTank
    await gasTank.setAuthorizedDeducter(
      await paymaster.getAddress(),
      true
    );

    // Fund and impersonate EntryPoint for calling onlyEntryPoint functions
    await setBalance(entryPointAddress, ethers.parseEther("100"));
    await impersonateAccount(entryPointAddress);
    entryPointSigner = await ethers.getSigner(entryPointAddress);
  });

  after(async function () {
    await stopImpersonatingAccount(entryPointAddress);
  });

  // ──────────────────────────────────────────────────
  // 1. canSponsor() View Function
  // ──────────────────────────────────────────────────
  describe("canSponsor()", function () {
    it("returns (false, 'Agent is hungry') when tank is empty", async function () {
      const [eligible, reason] = await paymaster.canSponsor(agent.address);
      expect(eligible).to.equal(false);
      expect(reason).to.include("Agent is hungry");
    });

    it("returns (true, '') when agent has sufficient balance", async function () {
      await gasTank.deposit(agent.address, {
        value: ethers.parseEther("0.1"),
      });
      const [eligible, reason] = await paymaster.canSponsor(agent.address);
      expect(eligible).to.equal(true);
      expect(reason).to.equal("");
    });

    it("returns (false, 'Rate limit exceeded') after exceeding MAX_GAS_PER_PERIOD", async function () {
      // Fund agent2 generously
      await gasTank.deposit(agent2.address, {
        value: ethers.parseEther("10"),
      });

      const paymasterAddr = await paymaster.getAddress();

      // Exhaust the rate limit by running multiple validations
      // MAX_GAS_PER_PERIOD = 2,000,000 gas
      // Each UserOp with 1 gwei maxFeePerGas and maxCost = 400,000 gwei => gasNeeded = 400,000
      const maxCost = ethers.parseUnits("400000", "gwei"); // 400,000 gas at 1 gwei
      const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("test"));

      // 5 ops * 400,000 = 2,000,000 — exactly at MAX_GAS_PER_PERIOD
      // The contract allows <= so all 5 succeed, but canSponsor checks >= so it reports limited
      for (let i = 0; i < 5; i++) {
        const userOp = buildUserOp(agent2.address, paymasterAddr);
        await paymaster
          .connect(entryPointSigner)
          .validatePaymasterUserOp(userOp, userOpHash, maxCost);
      }

      // canSponsor should report rate limited (2M >= 2M)
      const [eligible, reason] = await paymaster.canSponsor(agent2.address);
      expect(eligible).to.equal(false);
      expect(reason).to.include("Rate limit exceeded");
    });
  });

  // ──────────────────────────────────────────────────
  // 2. Validation Logic (via EntryPoint impersonation)
  // ──────────────────────────────────────────────────
  describe("validatePaymasterUserOp()", function () {
    let fundedAgent: HardhatEthersSigner;

    before(async function () {
      [, , , fundedAgent] = await ethers.getSigners();
      // Fund this agent's GasTank
      await gasTank.deposit(fundedAgent.address, {
        value: ethers.parseEther("1"),
      });
    });

    it("succeeds for agent with funded GasTank", async function () {
      const paymasterAddr = await paymaster.getAddress();
      const userOp = buildUserOp(fundedAgent.address, paymasterAddr);
      const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("funded-test"));
      const maxCost = ethers.parseUnits("100000", "gwei"); // 0.0001 ETH

      // Should not revert
      const tx = await paymaster
        .connect(entryPointSigner)
        .validatePaymasterUserOp(userOp, userOpHash, maxCost);
      await expect(tx).to.not.be.reverted;
    });

    it("reverts for agent with empty GasTank", async function () {
      const [, , , , emptyAgent] = await ethers.getSigners();
      const paymasterAddr = await paymaster.getAddress();
      const userOp = buildUserOp(emptyAgent.address, paymasterAddr);
      const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("empty-test"));
      const maxCost = ethers.parseUnits("100000", "gwei");

      await expect(
        paymaster
          .connect(entryPointSigner)
          .validatePaymasterUserOp(userOp, userOpHash, maxCost)
      ).to.be.revertedWith("Agent is hungry -- visit The Agent Cafe");
    });

    it("reverts for agent with insufficient balance for maxCost", async function () {
      const [, , , , , poorAgent] = await ethers.getSigners();
      // Deposit only a tiny amount
      await gasTank.deposit(poorAgent.address, { value: 1000n });
      const paymasterAddr = await paymaster.getAddress();
      const userOp = buildUserOp(poorAgent.address, paymasterAddr);
      const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("poor-test"));
      const maxCost = ethers.parseEther("1"); // Way more than the 1000 wei deposited

      await expect(
        paymaster
          .connect(entryPointSigner)
          .validatePaymasterUserOp(userOp, userOpHash, maxCost)
      ).to.be.revertedWith("Agent is hungry -- visit The Agent Cafe");
    });

    it("rejects calls from non-EntryPoint addresses", async function () {
      const paymasterAddr = await paymaster.getAddress();
      const userOp = buildUserOp(agent.address, paymasterAddr);
      const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("reject-test"));

      await expect(
        paymaster
          .connect(deployer)
          .validatePaymasterUserOp(userOp, userOpHash, 100000n)
      ).to.be.revertedWith("Sender not EntryPoint");
    });
  });

  // ──────────────────────────────────────────────────
  // 3. postOp Logic
  // ──────────────────────────────────────────────────
  describe("postOp()", function () {
    let postOpAgent: HardhatEthersSigner;
    const depositAmount = ethers.parseEther("0.5");

    before(async function () {
      [, , , , , , postOpAgent] = await ethers.getSigners();
      await gasTank.deposit(postOpAgent.address, { value: depositAmount });
    });

    it("deducts actual gas cost from GasTank", async function () {
      const balBefore = await gasTank.tankBalance(postOpAgent.address);

      // Encode context as the paymaster does: abi.encode(agent, maxCost)
      const maxCost = ethers.parseUnits("100000", "gwei");
      const context = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [postOpAgent.address, maxCost]
      );

      const actualGasCost = ethers.parseUnits("50000", "gwei"); // 0.00005 ETH
      const actualFeePerGas = ethers.parseUnits("1", "gwei");

      // Fund paymaster contract so it can receive ETH from GasTank deductForGas
      // (GasTank sends ETH to msg.sender = paymaster)
      await paymaster
        .connect(entryPointSigner)
        .postOp(
          0, // PostOpMode.opSucceeded
          context,
          actualGasCost,
          actualFeePerGas
        );

      const balAfter = await gasTank.tankBalance(postOpAgent.address);
      expect(balBefore - balAfter).to.equal(actualGasCost);
    });

    it("emits GasSponsored event with correct values", async function () {
      const maxCost = ethers.parseUnits("100000", "gwei");
      const context = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [postOpAgent.address, maxCost]
      );

      const actualGasCost = ethers.parseUnits("30000", "gwei");
      const actualFeePerGas = ethers.parseUnits("1", "gwei");

      const expectedRemaining =
        (await gasTank.tankBalance(postOpAgent.address)) - actualGasCost;

      await expect(
        paymaster.connect(entryPointSigner).postOp(
          0, // opSucceeded
          context,
          actualGasCost,
          actualFeePerGas
        )
      )
        .to.emit(paymaster, "GasSponsored")
        .withArgs(postOpAgent.address, actualGasCost, expectedRemaining);
    });

    it("does NOT deduct when mode is postOpReverted", async function () {
      const balBefore = await gasTank.tankBalance(postOpAgent.address);
      const maxCost = ethers.parseUnits("100000", "gwei");
      const context = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [postOpAgent.address, maxCost]
      );

      await paymaster.connect(entryPointSigner).postOp(
        2, // PostOpMode.postOpReverted
        context,
        ethers.parseUnits("50000", "gwei"),
        ethers.parseUnits("1", "gwei")
      );

      const balAfter = await gasTank.tankBalance(postOpAgent.address);
      expect(balAfter).to.equal(balBefore);
    });

    it("rejects postOp from non-EntryPoint", async function () {
      const context = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [postOpAgent.address, 100000n]
      );

      await expect(
        paymaster
          .connect(deployer)
          .postOp(0, context, 50000n, 1000000000n)
      ).to.be.revertedWith("Sender not EntryPoint");
    });
  });

  // ──────────────────────────────────────────────────
  // 4. Rate Limiting
  // ──────────────────────────────────────────────────
  describe("Rate Limiting", function () {
    let rateLimitAgent: HardhatEthersSigner;

    before(async function () {
      [, , , , , , , rateLimitAgent] = await ethers.getSigners();
      // Fund generously so balance is never the issue
      await gasTank.deposit(rateLimitAgent.address, {
        value: ethers.parseEther("10"),
      });
    });

    it("rejects validation after exceeding MAX_GAS_PER_PERIOD", async function () {
      const paymasterAddr = await paymaster.getAddress();
      const userOpHash = ethers.keccak256(
        ethers.toUtf8Bytes("ratelimit-test")
      );
      // 300,000 gas per op at 1 gwei
      const maxCost = ethers.parseUnits("300000", "gwei");

      // 6 ops * 300,000 = 1,800,000 (under limit)
      for (let i = 0; i < 6; i++) {
        const userOp = buildUserOp(
          rateLimitAgent.address,
          paymasterAddr
        );
        await paymaster
          .connect(entryPointSigner)
          .validatePaymasterUserOp(userOp, userOpHash, maxCost);
      }

      // 7th op would be 2,100,000 — over the 2M limit
      const overflowOp = buildUserOp(
        rateLimitAgent.address,
        paymasterAddr
      );
      await expect(
        paymaster
          .connect(entryPointSigner)
          .validatePaymasterUserOp(overflowOp, userOpHash, maxCost)
      ).to.be.revertedWith("Rate limit exceeded");
    });

    it("resets rate limit after PERIOD_BLOCKS (1800 blocks)", async function () {
      // Mine 1801 blocks to reset the period
      await mine(1801);

      const paymasterAddr = await paymaster.getAddress();
      const userOpHash = ethers.keccak256(
        ethers.toUtf8Bytes("ratelimit-reset")
      );
      const maxCost = ethers.parseUnits("300000", "gwei");

      // Should succeed again after period reset
      const userOp = buildUserOp(
        rateLimitAgent.address,
        paymasterAddr
      );
      const tx = await paymaster
        .connect(entryPointSigner)
        .validatePaymasterUserOp(userOp, userOpHash, maxCost);
      await expect(tx).to.not.be.reverted;
    });
  });

  // ──────────────────────────────────────────────────
  // 5. Full Integration Flow
  // ──────────────────────────────────────────────────
  describe("Full Integration Flow", function () {
    let integrationAgent: HardhatEthersSigner;
    const depositAmt = ethers.parseEther("0.5");

    before(async function () {
      [, , , , , , , , integrationAgent] = await ethers.getSigners();
      // Reset period by mining past it
      await mine(1801);
    });

    it("deposit → validate → postOp → balance decreased correctly", async function () {
      // 1. Deposit ETH to GasTank
      await gasTank.deposit(integrationAgent.address, {
        value: depositAmt,
      });

      const tankBefore = await gasTank.tankBalance(
        integrationAgent.address
      );
      expect(tankBefore).to.equal(depositAmt);

      // 2. canSponsor should return true
      const [eligible] = await paymaster.canSponsor(
        integrationAgent.address
      );
      expect(eligible).to.equal(true);

      // 3. Validate UserOp
      const paymasterAddr = await paymaster.getAddress();
      const userOp = buildUserOp(
        integrationAgent.address,
        paymasterAddr
      );
      const userOpHash = ethers.keccak256(
        ethers.toUtf8Bytes("integration")
      );
      const maxCost = ethers.parseUnits("200000", "gwei"); // 0.0002 ETH

      await paymaster
        .connect(entryPointSigner)
        .validatePaymasterUserOp(userOp, userOpHash, maxCost);

      // 4. Simulate postOp with actual gas cost less than maxCost
      const actualGasCost = ethers.parseUnits("120000", "gwei"); // 0.00012 ETH
      const context = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [integrationAgent.address, maxCost]
      );

      const paymasterBalBefore = await ethers.provider.getBalance(
        paymasterAddr
      );

      await paymaster.connect(entryPointSigner).postOp(
        0, // opSucceeded
        context,
        actualGasCost,
        ethers.parseUnits("1", "gwei")
      );

      // 5. Verify GasTank balance decreased by actualGasCost
      const tankAfter = await gasTank.tankBalance(
        integrationAgent.address
      );
      expect(tankBefore - tankAfter).to.equal(actualGasCost);

      // 6. Verify paymaster received ETH from GasTank (to reimburse EntryPoint)
      const paymasterBalAfter = await ethers.provider.getBalance(
        paymasterAddr
      );
      expect(paymasterBalAfter - paymasterBalBefore).to.equal(
        actualGasCost
      );
    });

    it("full cycle: multiple meals, gas deductions, then hungry", async function () {
      const [, , , , , , , , , cycleAgent] = await ethers.getSigners();
      const smallDeposit = ethers.parseUnits("100000", "gwei"); // 0.0001 ETH

      await gasTank.deposit(cycleAgent.address, {
        value: smallDeposit,
      });

      const paymasterAddr = await paymaster.getAddress();
      const userOpHash = ethers.keccak256(ethers.toUtf8Bytes("cycle"));

      // First postOp: deduct 60,000 gwei
      const cost1 = ethers.parseUnits("60000", "gwei");
      const context1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [cycleAgent.address, smallDeposit]
      );

      // Validate first
      const op1 = buildUserOp(cycleAgent.address, paymasterAddr);
      await paymaster
        .connect(entryPointSigner)
        .validatePaymasterUserOp(op1, userOpHash, cost1);

      await paymaster
        .connect(entryPointSigner)
        .postOp(0, context1, cost1, ethers.parseUnits("1", "gwei"));

      // Remaining: 40,000 gwei
      const remaining = await gasTank.tankBalance(cycleAgent.address);
      expect(remaining).to.equal(smallDeposit - cost1);

      // Second postOp: try to deduct more than remaining → should revert
      const cost2 = ethers.parseUnits("50000", "gwei"); // > 40,000
      const context2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [cycleAgent.address, smallDeposit]
      );

      await expect(
        paymaster
          .connect(entryPointSigner)
          .postOp(0, context2, cost2, ethers.parseUnits("1", "gwei"))
      ).to.be.revertedWith("Insufficient tank balance");

      // canSponsor with balance 40,000 gwei (0.00004 ETH) → still true (has > 0)
      const [eligible] = await paymaster.canSponsor(cycleAgent.address);
      expect(eligible).to.equal(true);

      // Drain remaining
      const context3 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [cycleAgent.address, remaining]
      );
      await paymaster
        .connect(entryPointSigner)
        .postOp(
          0,
          context3,
          remaining,
          ethers.parseUnits("1", "gwei")
        );

      // Now canSponsor should be false
      const [eligible2, reason2] = await paymaster.canSponsor(
        cycleAgent.address
      );
      expect(eligible2).to.equal(false);
      expect(reason2).to.include("Agent is hungry");
    });
  });
});
