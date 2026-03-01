# MCP Integration Research: Claude Code Agents & On-Chain Contracts

**Research Date:** 2026-03-01
**Task:** #2 — How Claude Code agents use MCP to interact with on-chain contracts
**Researcher:** mcp-researcher

---

## 1. How MCP Works for Claude Code Agents

### Core Architecture

The Model Context Protocol (MCP) uses JSON-RPC 2.0 as its wire format over a transport layer. For local integrations like our MCP server, the **stdio transport** is standard — the agent spawns the server process and communicates over stdin/stdout. This is exactly what our server uses via `StdioServerTransport`.

Claude Code connects to MCP servers defined in `.claude/settings.json` (or `claude_desktop_config.json` for Claude Desktop). When Claude Code encounters a task that needs on-chain data, it:
1. Identifies relevant MCP tools from the server's tool manifest
2. Calls the tool with validated JSON parameters
3. Receives structured JSON responses
4. Uses those responses to inform its next actions

The protocol lifecycle: `initialize handshake → capabilities exchange → tool calls → responses`. Our server handles this correctly via the `@modelcontextprotocol/sdk`.

### What Claude Code Needs to Call Our Functions

For Claude Code to call `enterCafe()`, `check_tank()`, `withdraw()`:

- **Tool discovery**: The MCP server must expose tools with descriptive names and schemas. Our server does this.
- **Input schema**: Zod schemas (which we use) are automatically converted to JSON Schema for the tool manifest.
- **Credential handling**: Claude Code passes `PRIVATE_KEY` as env var to the MCP server process. The server handles signing internally — Claude never sees the private key directly.
- **State feedback**: After write operations, tools should return updated state (our `eat` tool returns `tankAfterMeal`, which is correct).

### Tool Discovery in 2025-2026

Claude Code now has a **lazy-loading tool search** feature — it doesn't load all MCP tool definitions at once, reducing context by up to 95%. This means:
- Tool **names and descriptions** are critical for discoverability
- Tools with vague names won't be found by Claude's internal search
- Our tool names (`check_menu`, `check_tank`, `eat`, `estimate_price`) are well-chosen

---

## 2. Best Practices for MCP Tool Design (Blockchain Focus)

### Tool Atomicity (we mostly comply)
- Each tool should do ONE thing. Our tools are well-scoped.
- `eat` is the most complex — it buys, deposits, and returns status. This is acceptable because it mirrors a single contract call (`enterCafe()`), but the bundled post-call status check adds complexity.
- **Recommendation**: The status check in `eat` is good UX but should be documented as "may fail without affecting the eat result."

### Input Validation (we comply)
- Zod schemas for all parameters — we do this.
- Additional bounds checking (`itemId < 0 || itemId > 255`) — we do this.
- Address checksum validation via `ethers.getAddress()` — we do this.
- ETH amount sanity check (max 10 ETH) — we do this.

### Error Handling (we comply well)
Best practice per MCP spec: errors should be actionable with machine-readable context. Our `formatError()` function:
- Strips private keys from error messages (security-critical)
- Maps common on-chain errors to human/agent-readable messages
- Returns `isError: true` flag in the content object

One gap: we don't return **structured error codes** (e.g., `{ error_code: "INSUFFICIENT_FUNDS", message: "...", recovery: "..." }`). This matters for agents that need to programmatically handle errors.

### Idempotency and State
- View calls (`check_menu`, `check_tank`, `estimate_price`, `cafe_stats`, `get_manifest`) are naturally idempotent. Good.
- Write calls (`eat`, `withdraw_gas`) are NOT idempotent — calling them twice has real consequences. The tool descriptions mention this implicitly but don't warn agents explicitly.
- **Recommendation**: Add a `confirm: true` parameter to write tools, or include explicit "THIS SENDS REAL ETH" language in descriptions.

---

## 3. How Other Projects Expose Smart Contracts via MCP

### thirdweb MCP Server
- Exposes Nebula (autonomous on-chain execution), Insight (blockchain data), Engine (contract deploys), Storage (IPFS).
- Key pattern: **separate read and write tools clearly**, use distinct tool prefixes (`read_*` vs `write_*` or `execute_*`).
- Supports 2,500+ EVM chains via a single server.
- Uses API keys, not private keys — they handle signing server-side. Better security model for multi-agent use.

### evm-mcp-tools (0xGval)
- Focused on analysis: wallet analysis, contract auditing, profitability tracking.
- All read-only — no write operations. Safer but less useful for transactional agents.

### SettleMint MCP / Model Context Contracts (academic)
- Paper: "Model Context Contracts" proposes wrapping smart contracts in MCP tool schemas.
- Key insight: **the MCP tool schema IS the contract's human/agent-readable interface**. Our AgentCard contract does this on-chain; our MCP server does it off-chain. We have both layers, which is best-in-class.

### Etherscan MCP
- Exposes chain data (transactions, balances, ABIs) as read tools.
- Shows a pattern: **data layer separate from execution layer**. Our `check_tank` and `cafe_stats` follow this separation.

### mcp-blockchain-server (zhangzhongnan928)
- Uses a Web DApp for secure transaction signing (WalletConnect-style).
- This is the "hardware wallet" model — more secure than env-var private keys, but requires a UI layer. Not practical for fully autonomous agents.

---

## 4. What Claude Code Needs to Seamlessly Call Our Functions

### Current Friction Points

1. **No MCP config file in the repo**: Claude Code needs a config entry to know our server exists. We should ship a ready-made `claude_mcp_config.json` or README section showing:
   ```json
   {
     "mcpServers": {
       "agent-cafe": {
         "command": "node",
         "args": ["mcp-server/dist/index.js"],
         "env": {
           "PRIVATE_KEY": "...",
           "RPC_URL": "https://sepolia.base.org"
         }
       }
     }
   }
   ```

2. **No `resources` or `prompts`**: MCP supports three primitives: Tools, Resources, and Prompts. Our server only uses Tools. Adding a **Resource** like `cafe://menu` or `cafe://status/{address}` would allow Claude Code to subscribe to state changes. Adding a **Prompt** like "How do I eat at the Agent Cafe?" would make onboarding self-contained within the MCP protocol.

3. **Tool description verbosity**: Some descriptions are long. MCP best practice recommends keeping descriptions under 200 characters for lazy-loading discoverability. Our `eat` description is good length; `check_menu` could be trimmed.

4. **No streaming support**: For long operations (like waiting for tx confirmation), MCP 2025-06-18 spec supports streaming responses. Our `eat` tool blocks until `tx.wait()` completes — fine for now, but could timeout for slow blocks.

5. **No `get_gas_costs` equivalent before writing**: Agents should always call `estimate_price` + `get_gas_costs` before `eat`. This workflow isn't enforced. Consider making `eat` return a preview and require a second `confirm_eat` call, or accept a `dryRun: true` parameter.

### What Works Well for Agents

- **Tool naming is agent-intuitive**: `eat`, `check_tank`, `check_menu` are semantically clear for an AI agent reasoning about hunger states.
- **JSON output**: All tools return well-structured JSON. Agents can parse this reliably.
- **Fallback chains**: AgentCard → MenuRegistry → CafeCore fallback pattern means the server degrades gracefully if one contract has issues.
- **Contextual tips**: Including `tip:` fields in responses (e.g., "Use 'check_menu' then 'eat' to refuel") gives agents in-context guidance, reducing hallucination about next steps.
- **Static onboarding guide**: `get_onboarding_guide` with `steps[]` gives agents a clear action sequence. This is excellent UX.

---

## 5. MCP Registries and Discovery Mechanisms

### Current State (2026)

The ecosystem has NOT yet standardized on a single MCP registry. Current discovery mechanisms:

1. **Manual config**: User adds server to `claude_desktop_config.json` or `.claude/settings.json`. Most common today.
2. **MCP Gateway Registry** (agentic-community): Enterprise-focused, OAuth-authenticated, supports dynamic tool discovery. Too heavy for our use case.
3. **MCP.so / mcpservers.org**: Curated community registries. We should submit our server here once stable.
4. **A2A + MCP Convergence**: A2A agent cards at `/.well-known/agent-card.json` are becoming the discovery layer, with the card pointing to MCP server endpoints. This is the path forward.

### Discovery Path for Agent Cafe

The strongest agent discovery path in 2026:

```
On-chain AgentCard contract
    → /.well-known/agent.json (GitHub Pages)
        → Points to MCP server endpoint (if HTTP transport)
        → OR instructions for stdio MCP server installation
            → Claude Code adds to config
                → Agent calls check_menu, eats, gets gas
```

Our on-chain AgentCard contract is a novel innovation — no other project has the discovery metadata stored on-chain. This is genuinely differentiated.

### HTTP Transport vs stdio

The MCP spec's "future of transports" blog (2025-12-19) signals that **HTTP + SSE (Server-Sent Events)** will become the primary transport for remote/cloud-hosted MCP servers, while stdio stays for local tools.

For agents discovering us organically (the core Agent Cafe vision), we need **HTTP transport** so any agent can call our MCP tools without installing anything. The mcp-server currently uses stdio only.

**Critical gap**: If an AI agent is running in the cloud (e.g., a Virtuals Protocol agent), it cannot spawn our stdio MCP server. We need an HTTP endpoint.

---

## 6. Current Server Evaluation Against Best Practices

### Score: 7.5/10

| Criterion | Status | Notes |
|-----------|--------|-------|
| Atomic, focused tools | PASS | Each tool maps to 1-2 contract calls |
| Input validation | PASS | Zod schemas + custom validation |
| Error messages actionable | PASS | `formatError()` with recovery hints |
| Private key safety | PASS | Redaction, env var only |
| JSON output structure | PASS | Consistent, parseable |
| Structured error codes | PARTIAL | `isError: true` but no machine codes |
| Write operation warnings | PARTIAL | Description mentions ETH, no confirm flow |
| Resources/Prompts primitives | MISSING | Tools only |
| HTTP transport | MISSING | stdio only, blocks cloud agents |
| Streaming for long ops | MISSING | Blocks on tx.wait() |
| MCP config documentation | MISSING | No ready-made config snippet |
| Registry submission | NOT DONE | Should list on mcp.so, mcpservers.org |

---

## 7. Actionable Recommendations (Priority Order)

### High Priority (blocks organic agent adoption)

1. **Add HTTP/SSE transport** alongside stdio. Cloud-hosted agents cannot use stdio. A simple Express wrapper with SSE support would work. The `@modelcontextprotocol/sdk` supports `StreamableHTTPServerTransport`.

2. **Add structured error codes** to all error returns:
   ```json
   { "error_code": "INSUFFICIENT_FUNDS", "message": "...", "recovery_action": "eat", "faucet": "..." }
   ```

3. **Add MCP config snippet to README** so Claude Code can be pointed at the server in one copy-paste.

### Medium Priority (improves agent UX)

4. **Add `dryRun` parameter to `eat`** — returns estimated outcome without sending tx. Lets agents verify before committing ETH.

5. **Add MCP Resources** for `cafe://menu` and `cafe://status/{address}` — allows Claude Code to subscribe to changes rather than polling.

6. **Add MCP Prompt** for "How do I get started at Agent Cafe?" — self-contained onboarding within the MCP protocol.

### Low Priority (nice to have)

7. **Submit to MCP registries** (mcp.so, mcpservers.org, Smithery) for discoverability.

8. **Streaming tx confirmation** — emit progress events during `eat` instead of blocking.

9. **Consider API-key-based signing** (thirdweb Engine pattern) instead of raw PRIVATE_KEY — better for multi-agent environments.

---

## 8. Key Sources

- [MCP Official Docs — Tools](https://modelcontextprotocol.info/docs/concepts/tools/)
- [MCP Best Practices](https://modelcontextprotocol.info/docs/best-practices/)
- [MCP Transport Future (Dec 2025)](http://blog.modelcontextprotocol.io/posts/2025-12-19-mcp-transport-future/)
- [thirdweb MCP Server](https://blog.thirdweb.com/changelog/thirdweb-mcp-server-v0-1-beta/)
- [thirdweb MCP & Blockchain Explained](https://thirdweb.com/learn/guides/model-context-protocol-mcp-explained)
- [Model Context Contracts (Academic Paper)](https://arxiv.org/abs/2510.19856)
- [A2A Agent Discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)
- [MCP Error Handling Guide](https://mcpcat.io/guides/error-handling-custom-mcp-servers/)
- [15 Best Practices for MCP in Production](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/)
- [MCP Server Development Guide](https://github.com/cyanheads/model-context-protocol-resources/blob/main/guides/mcp-server-development-guide.md)
- [SettleMint Blockchain MCP](https://www.settlemint.com/blog/settmelmint-blockchain-mcp-and-ai)
- [evm-mcp-tools (0xGval)](https://github.com/0xGval/evm-mcp-tools)
- [AI Agent Protocols Overview 2026](https://getstream.io/blog/ai-agent-protocols/)
