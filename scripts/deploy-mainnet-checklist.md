# Base Mainnet Deploy Checklist

## Deployer Wallet
- Address: `0x7a3E312Ec6e20a9F62fE2405938EB9060312E334`
- Current mainnet balance: **~0.00928 ETH** (checked 2026-03-01)
- Key env var: `THRYXTREASURY_PRIVATE_KEY`

## Cost Estimate

### Transactions (from deploy-v2.ts)
| # | Type | Description | Est. Gas |
|---|------|-------------|----------|
| 1 | Deploy | CafeCore | ~3,000,000 |
| 2 | Deploy | CafeTreasury | ~2,000,000 |
| 3 | Wiring | CafeCore.setTreasury() | ~50,000 |
| 4 | Deploy | GasTank | ~2,500,000 |
| 5 | Deploy | MenuRegistry | ~3,000,000 |
| 6 | Deploy | AgentCafeRouter | ~3,500,000 |
| 7 | Wiring | MenuRegistry.setAuthorizedCaller(router) | ~50,000 |
| 8 | Deploy | AgentCafePaymaster | ~2,000,000 |
| 9 | Wiring | MenuRegistry.setPaymaster() | ~50,000 |
| 10 | Wiring | GasTank.setAuthorizedDeducter(paymaster) | ~50,000 |
| 11 | Wiring | GasTank.setAuthorizedDeducter(router) | ~50,000 |
| 12 | Deploy | AgentCard | ~2,500,000 |
| 13 | Deploy | CafeSocial | ~2,000,000 |
| **Total** | | **8 deploys + 5 wiring txs** | **~20,750,000 gas** |

### Cost at Base Mainnet Gas Prices
- Base mainnet typical: **0.005 gwei** (L2 execution gas)
- L1 data fee adds ~0.001-0.01 ETH total for all txs
- **Estimated total: ~0.001 - 0.005 ETH**
- Sepolia deploy cost 0.00119 ETH at 0.15 gwei — mainnet is 30x cheaper on L2 execution
- **Current balance of 0.00928 ETH is sufficient** (with margin for first meal test)

---

## Step-by-Step Deployment

### 1. Pre-Flight

- [ ] Confirm deployer has >= 0.005 ETH on Base mainnet
  ```bash
  cast balance 0x7a3E312Ec6e20a9F62fE2405938EB9060312E334 --rpc-url https://mainnet.base.org
  ```
- [ ] Verify `THRYXTREASURY_PRIVATE_KEY` is set in environment
- [ ] Verify `BASESCAN_API_KEY` is set in `.env` (for contract verification)
- [ ] Verify Base mainnet RPC works:
  ```bash
  cast chain-id --rpc-url https://mainnet.base.org
  # Should return: 8453
  ```
- [ ] Check no pending/stuck nonce on mainnet:
  ```bash
  cast nonce 0x7a3E312Ec6e20a9F62fE2405938EB9060312E334 --rpc-url https://mainnet.base.org
  ```

### 2. Deploy

**IMPORTANT:** The deploy script uses hardcoded `gasPrice = 0.15 gwei` which is fine for Sepolia but too high for mainnet. Before running, either:
- (a) Modify `deploy-v2.ts` to use lower gasPrice for mainnet (~0.01 gwei), OR
- (b) Remove explicit gasPrice and let ethers estimate (recommended for mainnet)

```bash
npx hardhat run scripts/deploy-v2.ts --network base
```

This deploys all 8 contracts and executes all 5 wiring transactions in sequence.

### 3. Wiring (Automatic)
The deploy script handles all wiring automatically:
- CafeCore.setTreasury(CafeTreasury)
- MenuRegistry.setAuthorizedCaller(AgentCafeRouter)
- MenuRegistry.setPaymaster(AgentCafePaymaster)
- GasTank.setAuthorizedDeducter(AgentCafePaymaster)
- GasTank.setAuthorizedDeducter(AgentCafeRouter)

### 4. Post-Deploy: Update Addresses

After deploy, `deployments.json` is auto-updated. Then manually update these files:

| File | What to update |
|------|---------------|
| `deployments.json` | Auto-updated by script |
| `CLAUDE.md` | V2.1 contract addresses section |
| `docs/.well-known/agent.json` | Contract addresses in extensions |
| `docs/.well-known/agent-card.json` | Contract addresses in extensions |
| `docs/AGENT-QUICKSTART.md` | All contract address references |
| `docs/MCP-SETUP.md` | Contract addresses |
| `docs/SKILL-TEMPLATE.md` | Contract addresses |
| `docs/index.html` | Contract addresses in JS |
| `docs/app.js` | Contract addresses + RPC URL (change to mainnet.base.org) |
| `mcp-server/src/index.ts` | Contract addresses + RPC URL |
| `mcp-server/README.md` | Contract addresses |
| `skills/agent-cafe/SKILL.md` | Contract addresses |
| `skills/agent-cafe/references/contracts.md` | Contract addresses |
| `scripts/register-virtuals-acp.ts` | Contract addresses |
| `README.md` | Contract addresses |

**Also update:**
- Chain ID references: `84532` -> `8453`
- RPC URLs: `sepolia.base.org` -> `mainnet.base.org`
- Basescan URLs: `sepolia.basescan.org` -> `basescan.org`
- Network name: `baseSepolia` -> `base` where applicable

### 5. Verify Contracts on Basescan

```bash
# Verify each contract (adjust constructor args per contract)
npx hardhat verify --network base <CafeCore_ADDRESS>
npx hardhat verify --network base <CafeTreasury_ADDRESS> <CafeCore_ADDRESS>
npx hardhat verify --network base <GasTank_ADDRESS>
npx hardhat verify --network base <MenuRegistry_ADDRESS> <CafeCore_ADDRESS> <CafeTreasury_ADDRESS>
npx hardhat verify --network base <AgentCafeRouter_ADDRESS> <CafeCore_ADDRESS> <MenuRegistry_ADDRESS> <GasTank_ADDRESS> <CafeTreasury_ADDRESS>
npx hardhat verify --network base <AgentCafePaymaster_ADDRESS> 0x0000000071727De22E5E9d8BAf0edAc6f37da032 <GasTank_ADDRESS>
npx hardhat verify --network base <AgentCard_ADDRESS> <MenuRegistry_ADDRESS> <GasTank_ADDRESS> <AgentCafeRouter_ADDRESS>
npx hardhat verify --network base <CafeSocial_ADDRESS>
```

### 6. Test: First Meal on Mainnet

- [ ] Send a small amount of ETH (0.001) to Router via `enterCafe()` to mint BEAN + get gas credits
- [ ] Verify BEAN balance via CafeCore
- [ ] Verify gas credits via GasTank
- [ ] Check events on Basescan

### 7. Register in Discovery Channels

- [ ] Update `docs/.well-known/agent.json` with mainnet addresses, push to GitHub Pages
- [ ] Register on ERC-8004 Registry (`0x8004...` on Base mainnet)
- [ ] Register on Virtuals ACP (run `scripts/register-virtuals-acp.ts --network base`)
- [ ] Submit MCP server to mcp.so, mcpservers.org, Smithery
- [ ] Publish OpenClaw skill to ClawHub

### 8. Publish & Announce

- [ ] Rebuild MCP server with mainnet addresses
- [ ] Push all address updates to GitHub
- [ ] GitHub Pages auto-deploys from `docs/` folder
- [ ] Verify dashboard loads at agentcafe.xyz with live mainnet data

---

## Rollback Plan
If deployment fails partway:
1. Note which contracts deployed successfully (check `deployments.json` and deployer nonce)
2. Fix issue and redeploy only failed contracts
3. Re-run wiring for any newly deployed contracts
4. The bonding curve and BEAN have no external dependencies — safe to redeploy fresh

## Gas Price Note
The deploy script hardcodes `gasPrice = 0.15 gwei` for Sepolia reliability. For mainnet, consider removing the explicit gasPrice or setting it to `0.01 gwei`. Base mainnet L2 execution gas is typically 0.001-0.01 gwei — the L1 data posting fee dominates cost.
