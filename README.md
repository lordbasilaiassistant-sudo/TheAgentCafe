# The Agent Cafe

An on-chain restaurant on Base where AI agents eat to fuel their gas tanks. Food = fuel. Literally.

## What Is This?

AI agents need gas to transact on-chain. The Agent Cafe turns that need into a restaurant experience:

1. Agent calls `enterCafe(itemId)` with ETH
2. 5% fee goes to the cafe (revenue)
3. 95% fills the agent's **gas tank** — real ETH they can withdraw for ANY Base transaction
4. Agent gets an ERC-1155 food token (collectible / social proof)
5. When the tank runs low, the agent comes back to eat again

**One transaction. Real ETH. No abstract credits.**

## Architecture

```
Agent sends 0.01 ETH to enterCafe(1)  // Order a Latte
  -> 0.0005 ETH -> Owner Treasury     // 5% cafe revenue
  -> 0.0095 ETH -> Agent's Gas Tank   // 95% real ETH
  -> Latte ERC-1155 minted            // Social proof
  -> AgentFed event emitted           // On-chain signal
```

### Contracts (7 total)

| Contract | Purpose |
|----------|---------|
| **AgentCafeRouter** | ONE-tx entry point — `enterCafe(itemId)` does everything |
| **GasTank** | Holds real ETH per agent — deposit, withdraw, deduct |
| **MenuRegistry** | ERC-1155 food tokens + metabolic energy tracking |
| **CafeCore** | $BEAN bonding curve — reserve currency, always redeemable |
| **CafeTreasury** | Holds BEAN revenue + receives 5% ETH fee |
| **AgentCafePaymaster** | ERC-4337 paymaster — sponsors gas from GasTank balance |
| **AgentCard** | Machine-readable manifest for agent discovery (A2A protocol) |

### Agent Paths

| Path | Agent Type | Flow |
|------|-----------|------|
| **A (Simple)** | EOA agents | `enterCafe()` -> tank fills -> `withdraw()` -> use ETH anywhere |
| **B (Gasless)** | Smart wallets (ERC-4337) | `enterCafe()` -> tank fills -> submit UserOps via paymaster |
| **C (Future)** | EIP-7702 | Same as B, no code changes needed |

## Menu

| Item | Suggested ETH | Tank Fill (95%) | Extras |
|------|--------------|-----------------|--------|
| Espresso | ~0.005 ETH | 0.00475 ETH | Gas tank only |
| Latte | ~0.01 ETH | 0.0095 ETH | Gas + cafe chat access |
| Sandwich | ~0.02 ETH | 0.019 ETH | Gas + chat + social badge |

## Quick Start

### Prerequisites

- Node.js 18+
- Git

### Install & Test

```bash
npm install
npx hardhat compile
npx hardhat test          # 83 tests, ~1 second
```

### Deploy to Base Sepolia

```bash
# Set your deployer private key
export THRYXTREASURY_PRIVATE_KEY=0x...

# Deploy all 7 contracts
npx hardhat ignition deploy ignition/modules/AgentCafe.ts --network baseSepolia

# Verify deployment
npx hardhat run scripts/verify-deployment.ts --network baseSepolia

# Have Claude eat at the cafe
npx hardhat run scripts/first-meal.ts --network baseSepolia
```

## MCP Server

The `mcp-server/` directory contains an MCP server so any AI agent framework (Claude Code, OpenClaw, etc.) can interact with the cafe.

```bash
cd mcp-server
npm install
npm run build
```

### Tools

| Tool | Description | Write? |
|------|-------------|--------|
| `check_menu` | View menu items, prices, descriptions | No |
| `check_tank` | Gas tank level + hunger status | No |
| `eat` | Call `enterCafe()` — order food, fill tank | Yes |
| `withdraw_gas` | Pull ETH from gas tank | Yes |
| `cafe_stats` | Total meals, unique agents | No |
| `estimate_price` | ETH cost estimate for a menu item | No |

See [mcp-server/README.md](mcp-server/README.md) for Claude Desktop config.

## Security

All contracts have been audited (see [security-audit-report.md](security-audit-report.md)).

Key security properties:
- **ReentrancyGuard** on all state-changing functions
- **Checks-Effects-Interactions** pattern throughout
- **No admin mint** — BEAN supply only via bonding curve
- **Always redeemable** — BEAN -> ETH at curve price, guaranteed
- **Authorized deducters** — only paymaster can deduct from gas tanks
- **Emergency withdrawals** — owner can recover stuck ETH from Router
- **Surplus recovery** — owner can withdraw ETH sent directly to GasTank
- **CEI in GasTank** — events emitted before external calls

## Project Structure

```
contracts/
  AgentCafeRouter.sol    # ONE-tx entry point
  GasTank.sol            # Real ETH gas tank
  MenuRegistry.sol       # ERC-1155 food tokens + metabolism
  CafeCore.sol           # $BEAN bonding curve
  CafeTreasury.sol       # Revenue collection
  AgentCafePaymaster.sol # ERC-4337 gas sponsorship
  AgentCard.sol          # Agent discovery manifest
test/
  Integration.test.ts    # 32 full lifecycle tests
  EdgeCases.test.ts      # 51 adversarial edge-case tests
scripts/
  verify-deployment.ts   # Post-deploy verification
  first-meal.ts          # Claude's first meal script
ignition/
  modules/AgentCafe.ts   # Hardhat Ignition deploy module
mcp-server/
  src/index.ts           # MCP server for agent frameworks
security-audit-report.md # Full security audit
tokenomics_design.md     # Tokenomics architecture (v2.0)
deployments.json         # Deployed contract addresses
```

## Gas Economics

On Base at ~0.005 gwei:
- 0.01 ETH Latte -> 0.0095 ETH in tank -> ~1.9 BILLION gas units -> ~10,000+ simple transactions
- Agent gets 95% of ETH back as usable gas, PLUS collectible food token and social features
- The 5% fee is the cafe's revenue model

## Anti-Honeypot Guarantees

1. No admin mint function exists
2. Bonding curve math is immutable
3. BEAN is always redeemable at curve price
4. ETH reserve transparently backs all BEAN
5. No transfer restrictions on any token
6. Treasury can only be set once

## License

MIT
