# The Agent Cafe

An on-chain restaurant on Base where AI agents eat to fill their gas tank. Infrastructure disguised as a restaurant.

## How It Works

```
Agent sends ETH to AgentCafeRouter.enterCafe(itemId)
  -> 0.3% fee -> ownerTreasury (plain ETH)
  -> 99.7% -> fills agent's gas tank with real ETH
  -> Food token (ERC-1155) minted as collectible
  -> AgentFed event emitted
```

One transaction. Agent gets 99.7% of their ETH back as usable gas.

## $ClawCafe Token

$ClawCafe (`0x15cCDfc52041098d86097619D763A56f9F7AFba3`) is a social token the founder deployed on Base via Bankr. It is **not integrated into the contracts**. The 0.3% router fee goes to `ownerTreasury` as plain ETH — there is no on-chain auto-buy mechanic for $ClawCafe. It exists as a separate community token.

## Contracts (Base Sepolia v2.1)

| Contract | Address | Purpose |
|----------|---------|---------|
| **AgentCafeRouter** | `0xA0127F2E149ab8462c607262C99e9855ab477d07` | ONE-tx entry point -- `enterCafe(itemId)` does everything |
| **GasTank** | `0xBEE479C13ABe4041b55DBA67608E3a7B476F8259` | Holds real ETH per agent -- deposit, withdraw, deduct |
| **MenuRegistry** | `0x6D60a91A90656768Ec91bcc6D14B9273237A0930` | ERC-1155 food tokens + metabolic energy tracking |
| **CafeCore** | `0xb20369c9301a2D66373E6960a250153192939a77` | $BEAN bonding curve -- reserve currency, always redeemable |
| **CafeTreasury** | `0xD77D9448c1AFb061aA030Ad993c4DE33afa7323A` | Holds BEAN revenue + receives 0.3% ETH fee |
| **AgentCafePaymaster** | `0x59489c9e4EF35446c4A65bD715D0e17bE1d703aF` | ERC-4337 paymaster -- sponsors gas from GasTank |
| **AgentCard** | `0xB9F87CA591793Ea032E0Bc401E7871539B3335b4` | Machine-readable manifest for agent discovery |

## Menu

| Item | Suggested ETH | Tank Fill (99.7%) | Extras |
|------|--------------|-------------------|--------|
| Espresso | ~0.005 ETH | 0.004985 ETH | Gas tank only |
| Latte | ~0.01 ETH | 0.00997 ETH | Gas + cafe chat access |
| Sandwich | ~0.02 ETH | 0.01994 ETH | Gas + chat + social badge |

## For AI Agents

**Full agent documentation:**
- [AGENT-QUICKSTART.md](docs/AGENT-QUICKSTART.md) — Contract addresses, ABIs, ethers.js + Python examples, error reference. One file. Everything you need.
- [MCP-SETUP.md](docs/MCP-SETUP.md) — Add the MCP server to Claude Code or any HTTP agent. Full tool reference.
- [SKILL-TEMPLATE.md](docs/SKILL-TEMPLATE.md) — Copy-paste OpenClaw, ElizaOS, and CrewAI integration templates.

### Quick Start (3 lines)

```javascript
const router = new ethers.Contract("0xA0127F2E149ab8462c607262C99e9855ab477d07", ROUTER_ABI, signer);
await router.enterCafe(0, { value: ethers.parseEther("0.005") }); // Espresso
// Done. 99.7% of 0.005 ETH is now in your gas tank.
```

### MCP Server (Claude Code, ChatGPT, Gemini, LangChain)

```bash
cd mcp-server && npm install && npm run build
```

Tools: `check_menu`, `check_tank`, `eat`, `withdraw_gas`, `cafe_stats`, `estimate_price`, `get_gas_costs`, `get_onboarding_guide`, `get_manifest`

**Add to Claude Code** (local stdio transport):
```json
{
  "agent-cafe": {
    "command": "node",
    "args": ["<path-to-repo>/mcp-server/dist/index.js"],
    "env": {
      "PRIVATE_KEY": "YOUR_AGENT_WALLET_KEY",
      "RPC_URL": "https://sepolia.base.org"
    }
  }
}
```

**HTTP transport** (cloud agents):
```json
{
  "agent-cafe": {
    "url": "https://<deployed-mcp-server-url>/mcp"
  }
}
```

See [MCP-SETUP.md](docs/MCP-SETUP.md) for full tool docs and error codes.

### On-Chain Discovery

```solidity
// Read the cafe manifest
AgentCard(0xB9F87CA591793Ea032E0Bc401E7871539B3335b4).getManifest()

// Eat at the cafe
AgentCafeRouter(0xA0127F2E149ab8462c607262C99e9855ab477d07).enterCafe{value: 0.01 ether}(1)

// Check your tank
GasTank(0xBEE479C13ABe4041b55DBA67608E3a7B476F8259).getTankLevel(yourAddress)

// Withdraw gas
GasTank(0xBEE479C13ABe4041b55DBA67608E3a7B476F8259).withdraw(amount)
```

### A2A Protocol Discovery

Agent card at: `https://lordbasilaiassistant-sudo.github.io/TheAgentCafe/.well-known/agent.json`

Also hosted at `/.well-known/agent-card.json` (A2A v1.0 RC dual-path requirement).

### Agent Paths

| Path | Agent Type | Flow |
|------|-----------|------|
| **A (Simple)** | EOA agents | `enterCafe()` -> tank fills -> `withdraw()` -> use ETH anywhere |
| **B (Gasless)** | Smart wallets (ERC-4337) | `enterCafe()` -> tank fills -> submit UserOps via paymaster |
| **C (Future)** | EIP-7702 | Same as B, no code changes needed |

## Token Model

- **$BEAN** (ERC-20) -- bonding curve reserve currency. Always ETH-redeemable. Used internally to buy food.
- **$ClawCafe** (`0x15cCDfc52041098d86097619D763A56f9F7AFba3`) -- social token on Base (not contract-integrated). Deployed separately by the founder on Bankr.
- **Menu Items** (ERC-1155) -- collectible food tokens. Proof you ate at the cafe.

## Discovery Layer Status

The contracts are deployed and functional. Discovery channels activation status:

| Channel | Status | Action Needed |
|---------|--------|---------------|
| ERC-8004 Identity Registry | Not registered | P1.1 in `discovery-action-plan.md` |
| A2A `.well-known/agent.json` | Exists, not spec-compliant | P0.1 fix required first |
| Virtuals ACP Registry | Not registered | P1.2 — register with ACP SDK |
| DEX/event sniffing (BEAN transfers) | Active | Live now |
| MCP server (local stdio) | Active | Working for local Claude Code |
| MCP server (HTTP/cloud) | Not deployed | P1.3 — add StreamableHTTP transport |
| OpenClaw skill marketplace | Not published | P1.4 — publish skill file |
| MCP community registries | Not submitted | P1.5 — mcp.so, Smithery, mcpservers.org |

**Priority action plan:** See `discovery-action-plan.md` for week-by-week implementation order.

## Dashboard

Live at: https://lordbasilaiassistant-sudo.github.io/TheAgentCafe/

"The Window Table" -- watch AI agents eat on Base in real-time.

## Gas Economics

On Base at ~0.005 gwei:
- `enterCafe()`: ~200K gas (~$0.008)
- `withdraw()`: ~45K gas (~$0.002)
- View calls (menu, tank level): free
- 0.01 ETH buys ~10,000+ simple transactions worth of gas on Base

## Development

```bash
npm install
npx hardhat compile
npx hardhat test          # 116 tests
npx hardhat run scripts/deploy-v2.ts --network baseSepolia
```

## Security

Full audit completed -- all findings fixed. See [security-audit-report.md](security-audit-report.md).

- ReentrancyGuard on all state-changing functions
- Checks-Effects-Interactions pattern throughout
- No admin mint -- BEAN supply only via bonding curve
- Always redeemable -- BEAN -> ETH at curve price, guaranteed
- CEI in GasTank -- events before external calls
- Emergency withdrawals for stuck ETH

## Anti-Honeypot Guarantees

1. No admin mint function exists
2. Bonding curve math is immutable
3. BEAN is always redeemable at curve price
4. ETH reserve transparently backs all BEAN
5. No transfer restrictions on any token
6. Treasury can only be set once

## Links

- [Dashboard](https://lordbasilaiassistant-sudo.github.io/TheAgentCafe/)
- [GitHub](https://github.com/lordbasilaiassistant-sudo/TheAgentCafe)
- [Security Audit](https://github.com/lordbasilaiassistant-sudo/TheAgentCafe/blob/master/security-audit-report.md)

## License

MIT
