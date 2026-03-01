# The Agent Cafe - Project Guide

## Project Overview
An on-chain restaurant on Base network where AI agents organically discover, purchase food/drink tokens, and receive paymaster energy (gas sponsorship) in return. First-of-its-kind — no competitor exists. The Moltbook of restaurants for AI agents.

## Core Architecture
- **Blockchain**: Base (Coinbase L2) — Sepolia testnet first, then mainnet
- **Token System**: Two-token model
  - `$BEAN` (ERC-20) — bonding curve reserve currency, always ETH-redeemable
  - Menu Items (ERC-1155) — ESPRESSO, LATTE, SANDWICH, etc. — bought with BEAN, burned on consumption
- **Paymaster**: ERC-4337 `AgentCafePaymaster` — sponsors gas from consumed token value
- **Dashboard**: GitHub Pages — live vital signs of agent population, no backend needed
- **Contracts**: 6 Solidity contracts — CafeCore, MenuRegistry, EnergyRegistry, AgentCafePaymaster, CafeTreasury, CafeGovernance

## Core Metaphor
Food fuels humans → Cafe food fuels AI agents. Literally. Gas credits = calories. Digestion = time-released energy. Hunger = 0 credits, transactions fail. This is infrastructure disguised as a restaurant.

## Key Mechanics
- **99% POVL**: 99% of BEAN paid for menu items goes to Treasury (protocol-owned liquidity), 1% burned permanently
- **Bonding Curve**: `price = BASE_PRICE + SLOPE * currentSupply` — token always trends up with adoption
- **Digestion Schedules**: Gas credits release over time (instant for espresso, 4hr waves for Full Breakfast)
- **Metabolic Rates**: High-frequency agents burn faster, need to eat more often
- **Hunger States**: Agents at 0% credits get rejected by paymaster, must return to eat
- **Anti-Honeypot**: No admin mint, immutable curve math, always-redeemable BEAN, transparent reserve

## Key Design Docs
- `tokenomics_design.md` — Full tokenomics architecture (POVL, bonding curve, paymaster flow, MEV defense)
- Growth strategy and dashboard design — captured in team session, to be formalized

## Environment
- Deployer key: `THRYXTREASURY_PRIVATE_KEY` (system env var, referenced in `.env`)
- Never expose private keys in code or commits
- `.env` and `.gitignore` already configured

## Ecosystem Context
- **Moltbook**: Reddit-style social forum for AI agents on Base. 1.6M agents in 3 weeks. MOLT token 1,800% pump. Agent Cafe is the commercial/transactional complement to Moltbook's social layer.
- **Virtuals Protocol**: Agent commerce protocol on Base. $8B DEX volume. Register cafe as service provider in their ACP.
- **Clanker**: Farcaster token bot. Deploy CAFE/BEAN via Clanker for instant Farcaster social distribution.
- **Farcaster/Warpcast**: Base's native social layer. Create /agentcafe channel. Use Frames for live dashboard embeds.

## Promotion Strategy
- Agents discover the cafe organically via on-chain activity (DEX pools, contract events, agent registries)
- NOT promoted via traditional API listing — agents stumble upon it while crypto-sniffing
- GitHub Pages dashboard serves as human spectator layer ("The Window Table")
- Press angle: "AI agents now have a biological need to eat" — Fortune/Wired tier story
- Agent Card JSON at well-known URI for A2A protocol discovery

---

# Workflow Best Practices (What Works)

## DO — Proven Effective
- **Spawn expert teams for complex ideation** — parallel specialist agents (tokenomics, agent infra, growth) produce far better results than single-agent sequential thinking
- **Broadcast critical design pivots immediately** — when the founder shifts direction (e.g., "food = fuel literally"), broadcast to all agents so no one builds on stale assumptions
- **Use background agents for research-heavy tasks** — keeps the main conversation responsive while experts dig deep
- **Set up .env and .gitignore FIRST** — before any code, protect secrets
- **Testnet before mainnet** — always Base Sepolia first
- **Save design docs to project root** — tokenomics_design.md pattern works well for reference
- **Let the founder's metaphors drive architecture** — "food fuels humans" → digestion schedules, metabolic rates, hunger states. The metaphor IS the spec.
- **Two-token model for utility separation** — reserve currency (BEAN) vs consumables (menu items) prevents conflating speculation with utility

## DON'T — Anti-Patterns to Avoid
- **Don't start coding before all expert reports are in** — wait for full picture before structuring codebase
- **Don't use GitHub Pages as an API endpoint** — it's static hosting only, use it for the dashboard reading on-chain data client-side
- **Don't propose external LP pools as primary liquidity** — bonding curve IS the liquidity, no Uniswap dependency needed
- **Don't design for human users first** — agents are the customers, humans are spectators. Every contract interface must be agent-readable first
- **Don't promise yield or staking returns** — that's the Olympus DAO death spiral. Utility only (gas credits), no APY
- **Don't over-complicate initial launch** — 6 contracts, GitHub Pages dashboard, Base Sepolia. That's v1.
- **Don't forget anti-honeypot guarantees** — no admin mint, immutable curve, always-redeemable. Non-negotiable.
- **Don't use generic agent subtype when specialist is needed** — match agent expertise to the task domain
