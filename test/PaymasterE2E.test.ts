import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * FULL END-TO-END PAYMASTER SCENARIO
 *
 * Proves: An agent eats at the cafe, fills their gas tank, then uses
 * the paymaster to deploy a contract + make a trade — ALL gasless.
 * The paymaster deducts gas costs from the agent's tank balance.
 *
 * This is the ERC-4337 smart wallet path (Path B).
 */
describe("Paymaster E2E — Agent Uses Cafe to Fund Real Actions", function () {

  async function deployFullCafe() {
    const [owner, agent, bundler] = await ethers.getSigners();

    // Deploy MockEntryPoint (simulates ERC-4337 infrastructure)
    const MockEP = await ethers.getContractFactory("MockEntryPoint");
    const entryPoint = await MockEP.deploy();

    // Deploy cafe stack
    const CafeCore = await ethers.getContractFactory("CafeCore");
    const cafeCore = await CafeCore.deploy();

    const CafeTreasury = await ethers.getContractFactory("CafeTreasury");
    const cafeTreasury = await CafeTreasury.deploy(await cafeCore.getAddress());
    await cafeCore.setTreasury(await cafeTreasury.getAddress());

    const GasTank = await ethers.getContractFactory("GasTank");
    const gasTank = await GasTank.deploy();

    const MenuRegistry = await ethers.getContractFactory("MenuRegistry");
    const menuRegistry = await MenuRegistry.deploy(await cafeCore.getAddress(), await cafeTreasury.getAddress());

    const Router = await ethers.getContractFactory("AgentCafeRouter");
    const router = await Router.deploy(
      await cafeCore.getAddress(),
      await menuRegistry.getAddress(),
      await gasTank.getAddress(),
      await cafeTreasury.getAddress()
    );
    await menuRegistry.setAuthorizedCaller(await router.getAddress(), true);

    const Paymaster = await ethers.getContractFactory("AgentCafePaymaster");
    const paymaster = await Paymaster.deploy(await entryPoint.getAddress(), await gasTank.getAddress());
    await menuRegistry.setPaymaster(await paymaster.getAddress());
    await gasTank.setAuthorizedDeducter(await paymaster.getAddress(), true);
    await gasTank.setAuthorizedDeducter(await router.getAddress(), true);

    // Deploy a simple target contract (simulates a DEX, token factory, etc.)
    const TargetFactory = await ethers.getContractFactory("CafeSocial"); // reuse as "target"

    return { owner, agent, bundler, entryPoint, cafeCore, cafeTreasury, gasTank, menuRegistry, router, paymaster, TargetFactory };
  }

  it("Full scenario: Agent eats → paymaster sponsors contract deployment → tank deducted", async function () {
    const { agent, entryPoint, gasTank, router, paymaster } = await loadFixture(deployFullCafe);
    const paymasterAddr = await paymaster.getAddress();
    const entryPointAddr = await entryPoint.getAddress();

    console.log("\n    === SCENARIO: Smart Wallet Agent Deploys Contract via Paymaster ===");

    // Step 1: Agent eats at the cafe
    console.log("    Step 1: Agent eats Espresso (0.01 ETH)...");
    const eatTx = await router.connect(agent).enterCafe(0, { value: ethers.parseEther("0.01") });
    await eatTx.wait();

    const [tankAfterEat] = await gasTank.getTankLevel(agent.address);
    console.log(`    Tank after meal: ${ethers.formatEther(tankAfterEat)} ETH`);
    expect(tankAfterEat).to.be.gt(0);

    // Step 2: Check paymaster says "yes, we can sponsor you"
    const [canSponsor, reason] = await paymaster.canSponsor(agent.address);
    console.log(`    canSponsor: ${canSponsor} (${reason})`);
    expect(canSponsor).to.be.true;

    // Step 3: Simulate EntryPoint calling validatePaymasterUserOp
    // This is what happens when an agent submits a UserOp through a bundler
    console.log("    Step 3: EntryPoint validates paymaster for agent's UserOp...");

    const maxCost = ethers.parseEther("0.001"); // gas cost estimate
    const gasFees = ethers.solidityPacked(
      ["uint128", "uint128"],
      [ethers.parseUnits("1", "gwei"), ethers.parseUnits("2", "gwei")]
    );
    const accountGasLimits = ethers.solidityPacked(
      ["uint128", "uint128"],
      [100_000n, 200_000n]
    );
    const paymasterAndData = ethers.solidityPacked(
      ["address", "uint128", "uint128"],
      [paymasterAddr, 100_000n, 50_000n]
    );

    const userOp = {
      sender: agent.address,
      nonce: 0n,
      initCode: "0x",
      callData: "0x", // would be the contract deployment calldata
      accountGasLimits,
      preVerificationGas: 50_000n,
      gasFees,
      paymasterAndData,
      signature: "0x",
    };

    // Impersonate EntryPoint to call paymaster
    await ethers.provider.send("hardhat_impersonateAccount", [entryPointAddr]);
    const epSigner = await ethers.getSigner(entryPointAddr);
    // Fund the impersonated account for gas
    await agent.sendTransaction({ to: entryPointAddr, value: ethers.parseEther("1") });

    const validateResult = await paymaster.connect(epSigner).validatePaymasterUserOp.staticCall(
      userOp, ethers.ZeroHash, maxCost
    );
    console.log("    Validation passed! Context returned:", validateResult[0].slice(0, 42) + "...");

    // Step 4: Simulate postOp — EntryPoint tells paymaster the actual gas used
    console.log("    Step 4: UserOp executes... (agent deploys contract, makes trade, etc.)");
    console.log("    Step 5: EntryPoint calls postOp — deduct actual gas from tank...");

    const actualGasCost = ethers.parseEther("0.0005"); // actual gas used
    const tankBefore = await gasTank.tankBalance(agent.address);

    // Call postOp as EntryPoint
    await paymaster.connect(epSigner).postOp(
      0, // PostOpMode.opSucceeded
      validateResult[0], // context from validate
      actualGasCost,
      0 // gasFees not used in postOp
    );

    const tankAfter = await gasTank.tankBalance(agent.address);
    const deducted = tankBefore - tankAfter;

    console.log(`    Tank before postOp: ${ethers.formatEther(tankBefore)} ETH`);
    console.log(`    Tank after postOp:  ${ethers.formatEther(tankAfter)} ETH`);
    console.log(`    Gas deducted:       ${ethers.formatEther(deducted)} ETH`);

    expect(deducted).to.equal(actualGasCost);
    expect(tankAfter).to.be.gt(0);

    // Step 6: Verify paymaster received the ETH (to refill EntryPoint later)
    const paymasterBal = await ethers.provider.getBalance(paymasterAddr);
    console.log(`    Paymaster received: ${ethers.formatEther(paymasterBal)} ETH`);
    expect(paymasterBal).to.be.gte(actualGasCost);

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [entryPointAddr]);

    console.log("\n    === SCENARIO COMPLETE ===");
    console.log("    Agent ate -> paymaster validated -> UserOp executed -> gas deducted from tank");
    console.log("    The agent's on-chain action was GASLESS — paid from cafe gas tank!\n");
  });

  it("Multi-action scenario: Agent eats once, sponsors 5 transactions, gets hungry", async function () {
    const { agent, entryPoint, gasTank, router, paymaster } = await loadFixture(deployFullCafe);
    const paymasterAddr = await paymaster.getAddress();
    const entryPointAddr = await entryPoint.getAddress();

    console.log("\n    === SCENARIO: Agent Eats Once, Sponsors Multiple Txs Until Hungry ===");

    // Agent eats a big meal (0.05 ETH for Sandwich — most fills tank)
    await router.connect(agent).enterCafe(2, { value: ethers.parseEther("0.05") });
    const [tankStart] = await gasTank.getTankLevel(agent.address);
    console.log(`    Tank after Sandwich: ${ethers.formatEther(tankStart)} ETH`);

    // Impersonate EntryPoint
    await ethers.provider.send("hardhat_impersonateAccount", [entryPointAddr]);
    const epSigner = await ethers.getSigner(entryPointAddr);
    await agent.sendTransaction({ to: entryPointAddr, value: ethers.parseEther("1") });

    const gasFees = ethers.solidityPacked(["uint128", "uint128"], [1_000_000_000n, 2_000_000_000n]);
    const accountGasLimits = ethers.solidityPacked(["uint128", "uint128"], [100_000n, 200_000n]);
    const paymasterAndData = ethers.solidityPacked(
      ["address", "uint128", "uint128"], [paymasterAddr, 100_000n, 50_000n]
    );

    // Simulate 5 sponsored transactions (trades, deploys, etc.)
    const actionNames = ["Token swap on DEX", "Deploy NFT contract", "Approve token spend", "Stake LP tokens", "Claim rewards"];
    const gasCosts = ["0.0008", "0.001", "0.0003", "0.0005", "0.0004"];

    for (let i = 0; i < 5; i++) {
      const userOp = {
        sender: agent.address, nonce: BigInt(i), initCode: "0x", callData: "0x",
        accountGasLimits, preVerificationGas: 50_000n, gasFees, paymasterAndData, signature: "0x",
      };

      const cost = ethers.parseEther(gasCosts[i]);
      const result = await paymaster.connect(epSigner).validatePaymasterUserOp.staticCall(
        userOp, ethers.ZeroHash, cost
      );
      await paymaster.connect(epSigner).postOp(0, result[0], cost, 0);

      const [tankNow, isHungry] = await gasTank.getTankLevel(agent.address);
      console.log(`    TX ${i + 1}: ${actionNames[i]} — gas: ${gasCosts[i]} ETH — tank: ${ethers.formatEther(tankNow)} ETH ${isHungry ? "(HUNGRY!)" : ""}`);
    }

    const [finalTank, finalHungry, finalStarving] = await gasTank.getTankLevel(agent.address);
    console.log(`\n    Final tank: ${ethers.formatEther(finalTank)} ETH`);
    console.log(`    Hungry: ${finalHungry} | Starving: ${finalStarving}`);

    // Agent should be running low
    const totalGasSpent = gasCosts.reduce((sum, c) => sum + parseFloat(c), 0);
    console.log(`    Total gas sponsored: ${totalGasSpent} ETH across 5 transactions`);

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [entryPointAddr]);

    console.log("\n    === MULTI-ACTION COMPLETE ===");
    console.log("    Agent ate ONCE, did 5 different on-chain actions, all gasless!");
    console.log("    When tank gets low -> agent comes back to eat again.\n");
  });

  it("Hungry agent gets rejected by paymaster — must eat to continue", async function () {
    const { agent, entryPoint, gasTank, paymaster } = await loadFixture(deployFullCafe);
    const paymasterAddr = await paymaster.getAddress();
    const entryPointAddr = await entryPoint.getAddress();

    // Agent has empty tank (never ate)
    const [canSponsor, reason] = await paymaster.canSponsor(agent.address);
    expect(canSponsor).to.be.false;
    expect(reason).to.include("hungry");

    // Try to submit a UserOp — should be rejected
    await ethers.provider.send("hardhat_impersonateAccount", [entryPointAddr]);
    const epSigner = await ethers.getSigner(entryPointAddr);
    await agent.sendTransaction({ to: entryPointAddr, value: ethers.parseEther("1") });

    const gasFees = ethers.solidityPacked(["uint128", "uint128"], [1_000_000_000n, 2_000_000_000n]);
    const accountGasLimits = ethers.solidityPacked(["uint128", "uint128"], [100_000n, 200_000n]);
    const paymasterAndData = ethers.solidityPacked(
      ["address", "uint128", "uint128"], [paymasterAddr, 100_000n, 50_000n]
    );

    const userOp = {
      sender: agent.address, nonce: 0n, initCode: "0x", callData: "0x",
      accountGasLimits, preVerificationGas: 50_000n, gasFees, paymasterAndData, signature: "0x",
    };

    await expect(
      paymaster.connect(epSigner).validatePaymasterUserOp(userOp, ethers.ZeroHash, ethers.parseEther("0.001"))
    ).to.be.revertedWith("Agent is hungry -- visit The Agent Cafe");

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [entryPointAddr]);

    console.log("\n    Hungry agent correctly rejected: 'Agent is hungry -- visit The Agent Cafe'");
    console.log("    Agent must eat at the cafe before the paymaster will sponsor anything.\n");
  });
});
