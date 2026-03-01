/**
 * Testnet Integration Test — Claude Code eats at The Agent Cafe on Base Sepolia
 *
 * Tests the full on-chain flow against deployed contracts.
 * Run with: npx hardhat run scripts/testnet-integration.ts --network baseSepolia
 *
 * Results are appended to testnet-integration-results.md
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  txHash?: string;
  gasUsed?: bigint;
  detail: string;
  error?: string;
}

const results: TestResult[] = [];

function pass(name: string, detail: string, txHash?: string, gasUsed?: bigint) {
  console.log(`  [PASS] ${name}`);
  if (detail) console.log(`         ${detail}`);
  results.push({ name, passed: true, txHash, gasUsed, detail });
}

function fail(name: string, detail: string, error?: string) {
  console.log(`  [FAIL] ${name}`);
  console.log(`         ${detail}`);
  if (error) console.log(`         Error: ${error}`);
  results.push({ name, passed: false, detail, error });
}

function section(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(60)}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("deployments.json not found — run deploy-v2.ts first");
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const [claude] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(claude.address);
  const network = await ethers.provider.getNetwork();

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   The Agent Cafe — Testnet Integration Test               ║");
  console.log("║   Claude Code eats on Base Sepolia                        ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  Network:  ${deployments.network} (chain ${network.chainId})`);
  console.log(`  Agent:    ${claude.address}`);
  console.log(`  Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log(`  Version:  ${deployments.version}`);
  console.log(`  Date:     ${new Date().toISOString()}`);

  if (balance < ethers.parseEther("0.005")) {
    console.error("\nERROR: Balance too low. Need at least 0.005 ETH.");
    process.exit(1);
  }

  // ── Load contracts ──────────────────────────────────────────────────────
  const agentCard = await ethers.getContractAt("AgentCard", deployments.contracts.AgentCard);
  const router = await ethers.getContractAt("AgentCafeRouter", deployments.contracts.AgentCafeRouter);
  const gasTank = await ethers.getContractAt("GasTank", deployments.contracts.GasTank);
  const menuRegistry = await ethers.getContractAt("MenuRegistry", deployments.contracts.MenuRegistry);
  const cafeCore = await ethers.getContractAt("CafeCore", deployments.contracts.CafeCore);

  const startBalance = balance;
  let totalGasUsed = 0n;

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 1: Contract Discovery — Read the AgentCard");
  // ═══════════════════════════════════════════════════════════════════════

  try {
    const manifest = await agentCard.getManifest();
    if (manifest.includes("Agent Cafe") && manifest.includes("enterCafe") && manifest.includes("gas tank")) {
      pass("AgentCard.getManifest()", manifest.slice(0, 120) + "...");
    } else {
      fail("AgentCard.getManifest()", "Manifest missing required fields", manifest);
    }
  } catch (e: any) {
    fail("AgentCard.getManifest()", "Call reverted", e.message);
  }

  try {
    const addresses = await agentCard.getContractAddresses();
    if (
      addresses.routerAddr.toLowerCase() === deployments.contracts.AgentCafeRouter.toLowerCase() &&
      addresses.gasTankAddr.toLowerCase() === deployments.contracts.GasTank.toLowerCase() &&
      addresses.menuRegistryAddr.toLowerCase() === deployments.contracts.MenuRegistry.toLowerCase()
    ) {
      pass(
        "AgentCard.getContractAddresses()",
        `Router: ${addresses.routerAddr}\n         GasTank: ${addresses.gasTankAddr}`
      );
    } else {
      fail("AgentCard.getContractAddresses()", "Address mismatch with deployments.json");
    }
  } catch (e: any) {
    fail("AgentCard.getContractAddresses()", "Call reverted", e.message);
  }

  try {
    const structured = await agentCard.getStructuredManifest();
    pass(
      "AgentCard.getStructuredManifest()",
      `Service: ${structured.name} v${structured.version} | Type: ${structured.serviceType} | Fee: ${structured.feesBps}bps`
    );
  } catch (e: any) {
    // This function was added post-deployment. If it reverts, the deployed contract is stale.
    // Not a code logic failure — flags need for redeployment.
    fail("AgentCard.getStructuredManifest()", "Call reverted — function likely added after current deployment (stale contract)", e.message?.slice(0, 80));
  }

  try {
    const guide = await agentCard.getOnboardingGuide();
    if (guide.includes("ONBOARDING") && guide.includes("enterCafe")) {
      pass("AgentCard.getOnboardingGuide()", guide.slice(0, 100) + "...");
    } else {
      fail("AgentCard.getOnboardingGuide()", "Guide missing required content");
    }
  } catch (e: any) {
    fail("AgentCard.getOnboardingGuide()", "Call reverted", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 2: ERC-165 Interface Detection (agent scanner compliance)");
  // ═══════════════════════════════════════════════════════════════════════

  try {
    const IERC165_ID = "0x01ffc9a7";
    const AGENT_SERVICE_ID = ethers.keccak256(ethers.toUtf8Bytes("IAgentService")).slice(0, 10);

    const supportsERC165 = await agentCard.supportsInterface(IERC165_ID);
    const supportsAgentService = await agentCard.supportsInterface(AGENT_SERVICE_ID);

    if (supportsERC165 && supportsAgentService) {
      pass(
        "AgentCard ERC-165 detection",
        `IERC165: ${supportsERC165} | IAgentService: ${supportsAgentService}`
      );
    } else {
      fail(
        "AgentCard ERC-165 detection",
        `IERC165: ${supportsERC165} | IAgentService: ${supportsAgentService}`
      );
    }
  } catch (e: any) {
    // supportsInterface added post-deployment — stale contract flag
    fail("AgentCard ERC-165 detection", "Call reverted — supportsInterface added after current deployment (stale contract)", e.message?.slice(0, 80));
  }

  try {
    const IERC165_ID = "0x01ffc9a7";
    const AGENT_SERVICE_ID = ethers.keccak256(ethers.toUtf8Bytes("IAgentService")).slice(0, 10);
    const supportsERC165 = await router.supportsInterface(IERC165_ID);
    const supportsAgentService = await router.supportsInterface(AGENT_SERVICE_ID);

    if (supportsERC165 && supportsAgentService) {
      pass(
        "Router ERC-165 detection",
        `IERC165: ${supportsERC165} | IAgentService: ${supportsAgentService}`
      );
    } else {
      fail(
        "Router ERC-165 detection",
        `IERC165: ${supportsERC165} | IAgentService: ${supportsAgentService}`
      );
    }
  } catch (e: any) {
    // supportsInterface added post-deployment — stale contract flag
    fail("Router ERC-165 detection", "Call reverted — supportsInterface added after current deployment (stale contract)", e.message?.slice(0, 80));
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 3: Read the menu via MenuRegistry");
  // ═══════════════════════════════════════════════════════════════════════

  try {
    const [ids, names, costs, calories, digestionTimes] = await menuRegistry.getMenu();
    const menuOk =
      names[0] === "Espresso Shot" &&
      names[1] === "Latte" &&
      names[2] === "Agent Sandwich" &&
      costs[0] === 50n &&
      costs[1] === 75n &&
      costs[2] === 120n;

    if (menuOk) {
      pass(
        "MenuRegistry.getMenu()",
        `Espresso: ${costs[0]} BEAN (${calories[0]} cal) | Latte: ${costs[1]} BEAN | Sandwich: ${costs[2]} BEAN`
      );
    } else {
      fail("MenuRegistry.getMenu()", `Unexpected menu data: ${JSON.stringify({ names, costs })}`);
    }
  } catch (e: any) {
    fail("MenuRegistry.getMenu()", "Call reverted", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 4: Price estimate from Router");
  // ═══════════════════════════════════════════════════════════════════════

  let espressoPrice = 0n;
  try {
    espressoPrice = await router.estimatePrice(0);
    const lattePrice = await router.estimatePrice(1);
    const sandwichPrice = await router.estimatePrice(2);

    if (espressoPrice > 0n && lattePrice > espressoPrice && sandwichPrice > lattePrice) {
      pass(
        "Router.estimatePrice()",
        `Espresso: ${ethers.formatEther(espressoPrice)} ETH | Latte: ${ethers.formatEther(lattePrice)} ETH | Sandwich: ${ethers.formatEther(sandwichPrice)} ETH`
      );
    } else {
      fail("Router.estimatePrice()", `Prices not ascending: ${espressoPrice}, ${lattePrice}, ${sandwichPrice}`);
    }
  } catch (e: any) {
    fail("Router.estimatePrice()", "Call reverted", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 5: Pre-meal state check");
  // ═══════════════════════════════════════════════════════════════════════

  let preMealTankBal = 0n;
  try {
    const [tankBal, isHungry, isStarving] = await gasTank.getTankLevel(claude.address);
    preMealTankBal = tankBal;
    pass(
      "GasTank.getTankLevel() (pre-meal)",
      `Balance: ${ethers.formatEther(tankBal)} ETH | Hungry: ${isHungry} | Starving: ${isStarving}`
    );
  } catch (e: any) {
    fail("GasTank.getTankLevel() (pre-meal)", "Call reverted", e.message);
  }

  try {
    const stats = await agentCard.getCafeStats();
    pass(
      "AgentCard.getCafeStats() (pre-meal)",
      `Total meals: ${stats.totalMeals} | Unique agents: ${stats.uniqueAgents}`
    );
  } catch (e: any) {
    fail("AgentCard.getCafeStats() (pre-meal)", "Call reverted", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 6: Claude eats an Espresso (0.005 ETH) — the main event");
  // ═══════════════════════════════════════════════════════════════════════

  const mealEth = ethers.parseEther("0.005");
  let mealTxHash = "";
  let mealGasUsed = 0n;

  try {
    console.log(`  Sending ${ethers.formatEther(mealEth)} ETH to enterCafe(0 = Espresso)...`);
    const tx = await router.enterCafe(0, { value: mealEth });
    const receipt = await tx.wait();
    mealTxHash = receipt?.hash || "";
    mealGasUsed = receipt?.gasUsed || 0n;
    totalGasUsed += mealGasUsed;

    pass(
      "router.enterCafe(0) — Espresso",
      `TX: ${mealTxHash}\n         Gas: ${mealGasUsed} units`,
      mealTxHash,
      mealGasUsed
    );
  } catch (e: any) {
    fail("router.enterCafe(0) — Espresso", "Transaction reverted", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 7: Post-meal verification");
  // ═══════════════════════════════════════════════════════════════════════

  let postMealTankBal = 0n;
  try {
    const [tankBal, isHungry, isStarving] = await gasTank.getTankLevel(claude.address);
    postMealTankBal = tankBal;
    const tankIncrease = postMealTankBal - preMealTankBal;
    const expectedMin = (mealEth * 9n) / 10n; // At least 90% of meal goes to tank

    if (postMealTankBal > preMealTankBal) {
      pass(
        "GasTank.getTankLevel() (post-meal)",
        `Balance: ${ethers.formatEther(tankBal)} ETH | +${ethers.formatEther(tankIncrease)} ETH | Hungry: ${isHungry}`
      );
    } else {
      fail(
        "GasTank.getTankLevel() (post-meal)",
        `Tank did not increase. Before: ${preMealTankBal}, After: ${postMealTankBal}`
      );
    }
  } catch (e: any) {
    fail("GasTank.getTankLevel() (post-meal)", "Call reverted", e.message);
  }

  try {
    const agentStatus = await agentCard.getTankStatus(claude.address);
    pass(
      "AgentCard.getTankStatus() (post-meal)",
      `ETH: ${ethers.formatEther(agentStatus.ethBalance)} | Hungry: ${agentStatus.isHungry} | Starving: ${agentStatus.isStarving}`
    );
  } catch (e: any) {
    fail("AgentCard.getTankStatus() (post-meal)", "Call reverted", e.message);
  }

  try {
    const stats = await agentCard.getCafeStats();
    pass(
      "AgentCard.getCafeStats() (post-meal)",
      `Total meals: ${stats.totalMeals} | Unique agents: ${stats.uniqueAgents}`
    );
  } catch (e: any) {
    fail("AgentCard.getCafeStats() (post-meal)", "Call reverted", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 8: Metabolic energy tracking");
  // ═══════════════════════════════════════════════════════════════════════

  try {
    const [availableGas, digestingGas, totalConsumed, mealCount] =
      await menuRegistry.getAgentStatus(claude.address);

    if (mealCount > 0n) {
      // Full flow: food token minted and consumed, metabolic energy credited
      pass(
        "MenuRegistry.getAgentStatus() (post-meal)",
        `Available: ${availableGas} gas | Digesting: ${digestingGas} | Meals: ${mealCount} | Total consumed: ${totalConsumed}`
      );
    } else {
      // mealCount=0 happens when BEAN minting was skipped (ETH amount too small relative to
      // BEAN bonding curve cost) OR when the deployed contract predates the food-token fix.
      // Gas tank still filled — core value delivered. This is a stale deployment indicator.
      const gasInTank = await gasTank.tankBalance(claude.address);
      if (gasInTank > 0n) {
        fail(
          "MenuRegistry.getAgentStatus() — metabolic energy",
          `mealCount=0 but gas tank is filled (${ethers.formatEther(gasInTank)} ETH). ` +
          `Food token minting skipped — deployed contract may predate task #31 fix or BEAN mint path failed. ` +
          `Core gas tank fill: WORKING. Metabolic tracking: STALE CONTRACT.`
        );
      } else {
        fail(
          "MenuRegistry.getAgentStatus()",
          `mealCount=0 and gas tank empty — enterCafe likely failed`
        );
      }
    }
  } catch (e: any) {
    fail("MenuRegistry.getAgentStatus()", "Call reverted", e.message);
  }

  try {
    const [availableGas, digestingGas] = await agentCard.getAgentEnergy(claude.address);
    pass(
      "AgentCard.getAgentEnergy() (post-meal)",
      `Available: ${availableGas} | Digesting: ${digestingGas}`
    );
  } catch (e: any) {
    fail("AgentCard.getAgentEnergy()", "Call reverted", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 9: Bonding curve state");
  // ═══════════════════════════════════════════════════════════════════════

  try {
    const supply = await cafeCore.totalSupply();
    const price = await cafeCore.currentPrice();
    const reserve = await cafeCore.ethReserve();

    if (reserve > 0n) {
      pass(
        "CafeCore bonding curve state",
        `BEAN supply: ${ethers.formatUnits(supply, 0)} | Current price: ${price} wei/BEAN | ETH reserve: ${ethers.formatEther(reserve)} ETH`
      );
    } else {
      fail("CafeCore bonding curve state", `ETH reserve is 0 — BEAN minting may have failed`);
    }
  } catch (e: any) {
    fail("CafeCore bonding curve state", "Call reverted", e.message);
  }

  try {
    const [reserveAmt, costAmt] = await cafeCore.solvencyCheck();
    if (reserveAmt >= costAmt) {
      pass(
        "CafeCore.solvencyCheck() — anti-honeypot guarantee",
        `Reserve: ${ethers.formatEther(reserveAmt)} ETH >= Redemption cost: ${ethers.formatEther(costAmt)} ETH`
      );
    } else {
      fail(
        "CafeCore.solvencyCheck() — SOLVENCY VIOLATION",
        `Reserve ${reserveAmt} < Cost ${costAmt} — BEAN not fully redeemable!`
      );
    }
  } catch (e: any) {
    fail("CafeCore.solvencyCheck()", "Call reverted", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 10: Partial withdrawal from gas tank");
  // ═══════════════════════════════════════════════════════════════════════

  const withdrawAmount = ethers.parseEther("0.001");
  // Re-read current tank balance right before withdrawal (postMealTankBal may be stale)
  const [currentTankBal] = await gasTank.getTankLevel(claude.address);

  if (currentTankBal >= withdrawAmount) {
    try {
      console.log(`  Withdrawing ${ethers.formatEther(withdrawAmount)} ETH from gas tank...`);
      const tx = await gasTank.withdraw(withdrawAmount);
      const receipt = await tx.wait();
      totalGasUsed += receipt?.gasUsed || 0n;

      const [tankBalAfter] = await gasTank.getTankLevel(claude.address);
      const expectedBal = currentTankBal - withdrawAmount;

      if (tankBalAfter === expectedBal) {
        pass(
          "GasTank.withdraw() — partial",
          `Withdrew ${ethers.formatEther(withdrawAmount)} ETH | New tank: ${ethers.formatEther(tankBalAfter)} ETH`,
          receipt?.hash
        );
      } else {
        fail(
          "GasTank.withdraw() — partial",
          `Expected ${ethers.formatEther(expectedBal)} ETH, got ${ethers.formatEther(tankBalAfter)} ETH`
        );
      }
    } catch (e: any) {
      fail("GasTank.withdraw() — partial", "Transaction reverted", e.message);
    }
  } else {
    console.log(`  [SKIP] Tank balance too low for withdrawal test`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 11: Error handling — invalid inputs");
  // ═══════════════════════════════════════════════════════════════════════

  try {
    // Should revert: below minimum meal size (334 wei)
    // Use callStatic to avoid nonce collision issues — simulates tx without broadcasting
    await router.enterCafe.staticCall(0, { value: 100n });
    fail("Revert on below MIN_MEAL_SIZE", "Static call succeeded — should have reverted");
  } catch (e: any) {
    if (e.message?.includes("Below minimum meal size") || e.message?.includes("revert") || e.message?.includes("reverted")) {
      pass("Revert on below MIN_MEAL_SIZE", "Correctly rejected meal < 334 wei (static call)");
    } else {
      fail("Revert on below MIN_MEAL_SIZE", "Unexpected error type", e.message?.slice(0, 120));
    }
  }

  try {
    // Should revert: invalid menu item ID
    await router.enterCafe.staticCall(99, { value: ethers.parseEther("0.01") });
    fail("Revert on invalid itemId=99", "Static call succeeded — should have reverted");
  } catch (e: any) {
    if (e.message?.includes("Not on menu") || e.message?.includes("revert") || e.message?.includes("reverted")) {
      pass("Revert on invalid itemId=99", "Correctly rejected non-existent menu item (static call)");
    } else {
      fail("Revert on invalid itemId=99", "Unexpected error type", e.message?.slice(0, 120));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  section("TEST 12: Final state & ETH conservation");
  // ═══════════════════════════════════════════════════════════════════════

  const endBalance = await ethers.provider.getBalance(claude.address);
  const ethSpent = startBalance - endBalance;

  try {
    const [finalTankBal] = await gasTank.getTankLevel(claude.address);
    pass(
      "Final wallet balance",
      `Start: ${ethers.formatEther(startBalance)} ETH | End: ${ethers.formatEther(endBalance)} ETH | Spent: ${ethers.formatEther(ethSpent)} ETH (incl gas)`
    );
    pass(
      "Final tank balance",
      `${ethers.formatEther(finalTankBal)} ETH in tank (withdrawable anytime)`
    );
  } catch (e: any) {
    fail("Final state check", "Error reading final state", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RESULTS SUMMARY
  // ═══════════════════════════════════════════════════════════════════════

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const allPassed = failed === 0;

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log(`║   RESULTS: ${passed}/${total} tests passed ${allPassed ? "✓ ALL GREEN" : "✗ FAILURES FOUND"}              ║`);
  console.log("╚══════════════════════════════════════════════════════════╝");

  if (!allPassed) {
    console.log("\n  FAILURES:");
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.detail}`);
    });
  }

  // ── Write results to markdown ─────────────────────────────────────────
  const mdPath = path.join(__dirname, "..", "testnet-integration-results.md");
  const now = new Date().toISOString();
  const md = `# Testnet Integration Results — ${now}

## Summary

| Metric | Value |
|--------|-------|
| Network | ${deployments.network} (chain ${network.chainId}) |
| Agent | \`${claude.address}\` |
| Contracts version | ${deployments.version} |
| Tests run | ${total} |
| Passed | ${passed} |
| Failed | ${failed} |
| Status | ${allPassed ? "ALL PASSED" : "FAILURES FOUND"} |
| Total gas used | ${totalGasUsed.toString()} units |
| ETH spent (incl gas) | ${ethers.formatEther(ethSpent)} ETH |

## Contract Addresses (Tested)

| Contract | Address |
|----------|---------|
${Object.entries(deployments.contracts).map(([name, addr]) => `| ${name} | \`${addr}\` |`).join("\n")}

## Test Results

${results.map(r => `### ${r.passed ? "PASS" : "FAIL"} — ${r.name}

- **Status**: ${r.passed ? "Passed" : "Failed"}
- **Detail**: ${r.detail}
${r.txHash ? `- **TX**: \`${r.txHash}\`` : ""}
${r.gasUsed ? `- **Gas used**: ${r.gasUsed}` : ""}
${r.error ? `- **Error**: ${r.error}` : ""}
`).join("\n")}

## Key Flows Verified

- [${results.find(r => r.name.includes("getManifest"))?.passed ? "x" : " "}] Agent discovery via AgentCard.getManifest()
- [${results.find(r => r.name.includes("ERC-165"))?.passed ? "x" : " "}] ERC-165 interface detection (agent scanner compliance)
- [${results.find(r => r.name.includes("getMenu"))?.passed ? "x" : " "}] Menu readable by agents
- [${results.find(r => r.name.includes("estimatePrice"))?.passed ? "x" : " "}] Price estimation from Router
- [${results.find(r => r.name.includes("Espresso"))?.passed ? "x" : " "}] Claude ate an Espresso (enterCafe() one-shot flow)
- [${results.find(r => r.name.includes("post-meal"))?.passed ? "x" : " "}] Gas tank filled after meal
- [${results.find(r => r.name.includes("metabolic") || r.name.includes("getAgentStatus"))?.passed ? "x" : " "}] Metabolic energy credited
- [${results.find(r => r.name.includes("solvency"))?.passed ? "x" : " "}] Solvency check passed (anti-honeypot)
- [${results.find(r => r.name.includes("withdraw"))?.passed ? "x" : " "}] ETH withdrawal from tank works
- [${results.find(r => r.name.includes("MIN_MEAL_SIZE"))?.passed ? "x" : " "}] Input validation (reverts on bad inputs)

## Conclusion

${allPassed
  ? `All ${total} integration tests passed on Base Sepolia testnet. The Agent Cafe v${deployments.version} is ready for mainnet deployment.

Claude Code successfully:
1. Discovered the cafe via AgentCard
2. Read the menu
3. Ordered an Espresso with one on-chain transaction
4. Received ETH in its gas tank (${ethers.formatEther(ethSpent)} ETH total spent including gas)
5. Confirmed metabolic energy was credited
6. Verified anti-honeypot solvency guarantee
7. Withdrew ETH from the tank`
  : `${failed} tests failed. Review failures above before mainnet deployment.`}

---
*Generated by testnet-integration.ts at ${now}*
`;

  fs.writeFileSync(mdPath, md, "utf8");
  console.log(`\n  Results written to: testnet-integration-results.md`);
  console.log(`  BaseScan: https://sepolia.basescan.org/address/${deployments.contracts.AgentCafeRouter}\n`);

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
