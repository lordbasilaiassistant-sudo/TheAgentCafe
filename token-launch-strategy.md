# $CAFE Token Launch Strategy — Research & Recommendation

*Prepared: 2026-03-01*

---

## 1. Launch Platform Analysis

### Clanker (Farcaster) — RECOMMENDED

**What it is**: AI-powered token deployment bot on Farcaster (acquired by Farcaster Oct 2025). Tag @clanker on Warpcast with token name/ticker/image and it deploys an ERC-20 on Base with a Uniswap V4 pool.

**How it works**:
- Post on Warpcast, tag @clanker, specify name + ticker + optional image
- Clanker deploys ERC-20 with 100B fixed supply on Base
- Creates Uniswap V4 pool with locked liquidity across multiple price ranges
- Launch fees start at ~80% and decay to ~5% over 30 seconds (anti-bot MEV protection)
- Creator permanently receives 40% of all pool fees (claimable from Uniswap)

**Cost**: Essentially free (just gas on Base, < $0.10). No upfront token purchase required.

**Distribution/Reach**:
- Farcaster has ~800K accounts, heavily crypto-native
- Farcaster IS Base's native social layer — perfect audience alignment
- Clanker processed 4,200+ token deployments, $50M+ in protocol fees
- CLANKER token itself hit $55M+ market cap
- Farcaster owns Clanker now — it's the officially supported launch mechanism

**Fee structure**: 0.2% protocol fee on every trade (goes to Farcaster/Clanker buyback). Creator gets 40% of LP fees permanently.

**Verdict**: Best fit. Base-native, Farcaster-native, near-zero cost, built-in anti-bot, permanent fee share to creator.

---

### Bankr — NOT A LAUNCHPAD

**What it actually is**: Bankr is an AI trading agent on Farcaster/X, not a token launchpad. Users tag @bankrbot to buy/sell tokens via natural language ("buy $10 of ETH"). Its own $BNKR token was actually launched via Clanker.

**Useful for**: Post-launch — Bankr could be a distribution channel where agents discover and trade $CAFE via social commands. Not for launching.

**Verdict**: Not applicable for launch. Useful for post-launch trading/discovery.

---

### Virtuals Protocol — ALTERNATIVE

**What it is**: AI agent token launchpad on Base. The largest AI agent creation platform by market cap.

**How it works**:
- Pay 100 $VIRTUAL tokens (~$1-5 depending on price) to create an agent
- Agent token deploys on a bonding curve
- When 41,600 $VIRTUAL accumulates in the curve, the agent "graduates"
- Post-graduation: 1B tokens minted, paired with VIRTUAL in Uniswap pool, LP locked 10 years

**Distribution**: Massive — Virtuals has $8B+ DEX volume, huge AI agent community on Base.

**Drawbacks**:
- Requires purchasing VIRTUAL tokens first
- Agent token is paired with VIRTUAL, not ETH — adds dependency on VIRTUAL price
- The cafe is infrastructure, not an "AI agent personality" — slight category mismatch
- Bonding curve graduation requires significant capital inflow

**Verdict**: Strong reach but wrong category fit. Better suited for AI agent characters, not infrastructure protocols.

---

### Zora — ALTERNATIVE

**What it is**: Originally NFT platform, now offers Base memecoin launchpad. Each post auto-generates an ERC-20 with 1B fixed supply.

**Fee structure**: 2% total (split between LP and platform). Creators earn from buys/sells and Uniswap pool fees.

**Verdict**: Content-creator focused. Less relevant for an AI infrastructure token.

---

### pump.fun Terminal — FUTURE OPTION

**What it is**: pump.fun (Solana's dominant launchpad) acquired Vyper and is building multi-chain Terminal with EVM/Base support.

**Verdict**: Not ready yet for Base. Monitor for future launches.

---

## 2. Dual Token Model Analysis: $BEAN + $CAFE

### The Model

| Token | Type | Purpose | Supply | Trading |
|-------|------|---------|--------|---------|
| $BEAN | ERC-20 | Utility/reserve currency | Dynamic (bonding curve) | Bonding curve only, always redeemable |
| $CAFE | ERC-20 | Social/governance | 100B fixed (Clanker default) | DEX (Uniswap via Clanker) |

### Precedents

**Successful dual-token models:**
- **MakerDAO (MKR + DAI)**: MKR = governance, DAI = utility stablecoin. Clean separation. MKR governs the system that produces DAI. Duration: 7+ years, still operating.
- **Axie Infinity (AXS + SLP)**: AXS = governance/staking, SLP = in-game utility with unlimited supply. Worked during growth phase, SLP inflation became a problem during decline.
- **Curve (CRV + 3CRV)**: CRV = governance/vote-locking, 3CRV = LP fees. The "vote-escrow" model is widely imitated.

**Failed dual-token models:**
- **LUNA/UST**: Algorithmic stablecoin death spiral. NOT relevant — $BEAN is bonding-curve-backed, not algorithmic peg.
- **OHM/gOHM (Olympus)**: Yield/staking model that collapsed when growth stopped. NOT relevant — we explicitly avoid yield promises.

**Key lesson**: Dual tokens work when each has a clearly distinct and non-overlapping function. They fail when one token's value depends on unsustainable growth of the other.

### Why Dual Tokens Work for Agent Cafe

$BEAN and $CAFE serve completely different functions:
- **$BEAN** = "money inside the restaurant" — you need it to buy food, it's always redeemable, its price reflects adoption (bonding curve)
- **$CAFE** = "ownership stake in the restaurant" — governs menu, fees, and treasury decisions. Traded on open market.

There is NO death spiral risk because:
1. $BEAN is always redeemable via bonding curve (floor price guaranteed by math)
2. $CAFE has no algorithmic peg to $BEAN
3. No yield/APY promises — only utility (governance, fee share, priority access)
4. $CAFE value is driven by protocol revenue, not token emissions

---

## 3. Agent Token Launch Precedents

### AIXBT (via Virtuals)
- Launched Nov 2024 on Virtuals Protocol bonding curve
- 1B total supply, 60% public distribution
- Hit $606M market cap within months
- Strategy: Built useful Twitter/X presence analyzing crypto markets BEFORE token launch, token followed utility

### ai16z
- Meme parody of a16z as decentralized hedge fund
- Token holders = "partners" who supply holdings and share profits
- Governance + utility dual role
- Strategy: Leveraged existing a16z brand recognition, DAO structure

### Key Takeaway
The tokens that worked launched AFTER the product had demonstrated value. AIXBT built a following through useful market analysis first. The token was a way to bet on continued growth, not a speculative empty shell.

**Implication for $CAFE**: Launch the token AFTER the cafe has live agent activity on testnet/mainnet. The dashboard showing real agent meals creates the narrative; the token lets people bet on it.

---

## 4. Proposed $CAFE Tokenomics

### Supply & Distribution (Clanker default: 100B)

| Allocation | % | Amount | Purpose |
|-----------|---|--------|---------|
| Uniswap LP (locked) | 100% | 100B | Clanker auto-locks all supply in Uniswap pool |

Note: Clanker launches with ALL tokens in the Uniswap pool. There is no team allocation, no vesting, no pre-mine. This is actually a feature — it's the ultimate "fair launch" and aligns with anti-honeypot principles.

**Creator revenue**: 40% of Uniswap LP fees in perpetuity go to the deployer wallet.

### $CAFE Utility (Post-Launch, Via Governance)

1. **Governance** — Vote on:
   - New menu items and their calorie values
   - Fee rates (the 99% POVL split)
   - Treasury deployment (grants, partnerships)
   - Metabolic rate adjustments

2. **Fee Share** — 0.3% of all $BEAN spent at the cafe distributed to $CAFE holders (pro-rata). This is the "restaurant dividend."

3. **Priority Gas Queue** — $CAFE holders get priority in paymaster when gas is congested. "VIP table."

4. **Loyalty Multiplier** — Agents holding $CAFE get 1.5x calorie efficiency on menu items. "Regulars eat better."

5. **Menu Proposals** — Only $CAFE holders can propose new menu items. "Stakeholder voice."

### What $CAFE Should NOT Do
- No staking yields (no Olympus death spiral)
- No emissions schedule (no inflationary pressure)
- No required burns (supply stays fixed)
- No algorithmic relationship to $BEAN price

---

## 5. Legal Considerations

### Current SEC Framework (2025-2026)

The SEC under Chairman Atkins has adopted a more nuanced approach via "Project Crypto":
- **CLARITY Act** (House-passed): Distinguishes "digital commodities" from securities. CFTC gets primary spot market authority, SEC handles initial investment contracts.
- **Token taxonomy**: Tokens can be payment instruments, governance tools, collectibles, or access keys — not all are securities.
- Forthcoming "Regulation Crypto" with 2026 rulemakings for comprehensive framework.

### Howey Test Application to $CAFE

A token is a security if it involves: (1) investment of money, (2) in a common enterprise, (3) with expectation of profits, (4) derived from efforts of others.

**$CAFE risk factors:**
- Fee share (0.3% distribution) = strongest "expectation of profits from efforts of others" factor
- Governance voting = argues toward utility/participation, not investment

**Mitigation strategies:**
1. **Sufficient decentralization**: If the protocol is genuinely governed by $CAFE holders and runs on immutable contracts, there is no "efforts of others" — it's self-sustaining infrastructure.
2. **Fee share as protocol dividends**: Frame as automated protocol revenue distribution, not dividends from a company's efforts. Smart contract distributes fees mechanically.
3. **Fair launch via Clanker**: No ICO, no pre-sale, no team allocation. Harder to argue "investment of money in a common enterprise" when there's no fundraising event.
4. **Utility-first**: Governance, priority access, and loyalty multiplier are genuine utilities independent of financial returns.

**Safest structure**: Launch without fee share initially. Add fee share later via governance vote once protocol is sufficiently decentralized and has no central team driving value. The Uniswap Foundation model — protocol generates fees, governance decides distribution.

---

## 6. Launch Timing & Sequence

### Recommended Sequence

1. **NOW**: Deploy cafe contracts on Base Sepolia, get agent activity flowing
2. **Week 1-2**: Launch dashboard on GitHub Pages showing real agent meals
3. **Week 2-3**: Deploy to Base mainnet (< $10 total cost)
4. **Week 3-4**: Create Farcaster /agentcafe channel, post dashboard Frames
5. **Week 4+**: When organic activity is visible on dashboard, launch $CAFE via Clanker
6. **Post-launch**: Integrate fee share via governance proposal once decentralized

### Why Wait for Activity First
- "AI agents are eating at this restaurant RIGHT NOW" is a 1000x better narrative than "we're building a restaurant for AI agents"
- The dashboard IS the marketing — live agent meals, calorie burns, hunger states
- Clanker launch with real metrics will attract Farcaster degens who can verify on-chain

---

## 7. Final Recommendation

### Launch $CAFE on Clanker. Here's why:

| Criteria | Clanker | Virtuals | Custom Deploy |
|----------|---------|----------|--------------|
| Cost | ~$0.10 gas | ~$5 in VIRTUAL | ~$0.10 gas |
| Distribution | Farcaster (800K users) | Virtuals community | None built-in |
| Anti-bot | Yes (decaying fees) | Yes (bonding curve) | Must build |
| Fair launch | Yes (100% in pool) | Yes (bonding curve) | Must design |
| Base-native | Yes | Yes | Yes |
| Category fit | General (good) | AI agent (ok) | Custom (good) |
| Creator revenue | 40% LP fees forever | Varies | Must build |
| Time to launch | 5 minutes | Hours | Days |
| Brand alignment | Farcaster = Base social layer | AI agent platform | Independent |

**Clanker wins on**: cost, speed, distribution, fair launch, creator revenue, and brand alignment with Base/Farcaster ecosystem.

**Do NOT launch on Virtuals** because the cafe is infrastructure, not an AI personality. Virtuals is for agent characters.

**Do NOT skip the second token** because $BEAN alone cannot capture governance value or social distribution. $BEAN's bonding curve makes it unsuitable for DEX trading or social speculation. $CAFE gives the community a way to own a piece of the restaurant.

### The One-Line Pitch

> "AI agents are literally eating at an on-chain restaurant for gas. $BEAN buys the food. $CAFE owns the restaurant."

---

---

## 8. UPDATE: $ClawCafe Launch on Bankr (Decision Made)

*Updated: 2026-03-01 — Founder is launching $ClawCafe via Bankr NOW*

### How Bankr Token Launch Works

Bankr uses **Clanker's protocol under the hood** for token deployment. When you tag @bankrbot on Farcaster/X and request a token launch, it:
1. Deploys an ERC-20 on Base via Clanker's factory contract
2. Creates a Uniswap pool with locked liquidity
3. 100B fixed supply, all in the LP (fair launch, no pre-mine)
4. Creator gets 40% of LP fees permanently
5. Built-in anti-bot via decaying launch fees (80% -> 5% over ~30 seconds)

**Key**: $ClawCafe will be a standard ERC-20 on Base with a Uniswap pool. This means we can interact with it from smart contracts using standard IERC20 interface + Uniswap V3/V4 SwapRouter.

### Contract Address (CA)

Once the founder receives the CA from Bankr, it should be added to `deployments.json` as:
```json
"ClawCafe": "0x..."  // $ClawCafe ERC-20 on Base
```

---

## 9. $ClawCafe Smart Contract Integration

### Current Fee Flow (AgentCafeRouter)

```
Agent sends ETH to enterCafe()
  |
  +---> 0.3% fee --> ownerTreasury (ETH)
  +---> 99.7% -----> GasTank (ETH, agent's balance)
  +---> mint BEAN --> buy food --> consume --> social proof
```

The 0.3% fee (FEE_BPS = 30) currently goes to `ownerTreasury` as raw ETH. This is the integration point.

### Proposed Integration: Auto-Buy $ClawCafe with Fees

**Option A: Fee-Splitter Contract (RECOMMENDED)**

Deploy a new `CafeFeeSplitter` contract that sits between the router and the treasury. The router sends its 0.3% fee to the splitter, which:

```
0.3% fee ETH arrives at CafeFeeSplitter
  |
  +---> 50% --> Swap ETH -> $ClawCafe via Uniswap (auto-buy)
  |       |
  |       +---> 50% of bought $ClawCafe --> burn address (deflation)
  |       +---> 50% of bought $ClawCafe --> CafeRewardsPool (for agents)
  |
  +---> 50% --> ownerTreasury (ETH, for operations)
```

**Implementation**: Set the router's `ownerTreasury` to the `CafeFeeSplitter` address:
```solidity
router.setOwnerTreasury(address(cafeFeeSplitter));
```

The splitter uses Uniswap's `ISwapRouter.exactInputSingle()` to swap ETH -> $ClawCafe on every fee collection.

**Why this works**:
- No changes needed to deployed CafeCore, MenuRegistry, or GasTank contracts
- Only changes: deploy new CafeFeeSplitter + call `router.setOwnerTreasury(splitter)`
- Creates constant buy pressure on $ClawCafe from protocol revenue
- The burn creates deflationary pressure (100B supply shrinks over time)
- The rewards pool creates agent incentive to keep eating

**Option B: Manual Buy-and-Distribute (SIMPLER)**

Keep the current setup. Owner periodically:
1. Withdraws ETH from ownerTreasury
2. Swaps ETH -> $ClawCafe on Uniswap manually
3. Distributes $ClawCafe to top agents or burns it

Simpler but no on-chain flywheel. Good for v1, upgrade to Option A later.

**Recommendation**: Start with Option B (zero contract changes needed), deploy Option A once CA is confirmed and there is meaningful volume.

### CafeFeeSplitter Contract Sketch

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CafeFeeSplitter is Ownable {
    ISwapRouter public immutable swapRouter;
    address public immutable clawCafe;    // $ClawCafe ERC-20
    address public immutable weth;        // WETH on Base
    address public ownerTreasury;         // operational ETH
    address public rewardsPool;           // $ClawCafe rewards for agents
    address public constant BURN = address(0xdead);

    uint24 public poolFee = 10000;        // Uniswap pool fee tier (1%)
    uint256 public buyBps = 5000;         // 50% of fees used for auto-buy
    uint256 public burnShareBps = 5000;   // 50% of bought tokens burned

    event FeeProcessed(uint256 ethIn, uint256 clawBought, uint256 burned, uint256 rewarded);

    constructor(
        address _swapRouter,
        address _clawCafe,
        address _weth,
        address _ownerTreasury,
        address _rewardsPool
    ) Ownable(msg.sender) {
        swapRouter = ISwapRouter(_swapRouter);
        clawCafe = _clawCafe;
        weth = _weth;
        ownerTreasury = _ownerTreasury;
        rewardsPool = _rewardsPool;
    }

    receive() external payable {
        _processFee();
    }

    function _processFee() internal {
        uint256 total = address(this).balance;
        if (total == 0) return;

        uint256 toBuy = (total * buyBps) / 10000;
        uint256 toTreasury = total - toBuy;

        // Send operational share to treasury
        (bool ok, ) = ownerTreasury.call{value: toTreasury}("");
        require(ok, "Treasury transfer failed");

        // Auto-buy $ClawCafe via Uniswap
        if (toBuy > 0) {
            ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                tokenIn: weth,
                tokenOut: clawCafe,
                fee: poolFee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: toBuy,
                amountOutMinimum: 0, // Accept any amount (MEV risk low for small fees)
                sqrtPriceLimitX96: 0
            });

            uint256 clawBought = swapRouter.exactInputSingle{value: toBuy}(params);

            // Split: burn half, reward half
            uint256 toBurn = (clawBought * burnShareBps) / 10000;
            uint256 toReward = clawBought - toBurn;

            IERC20(clawCafe).transfer(BURN, toBurn);
            IERC20(clawCafe).transfer(rewardsPool, toReward);

            emit FeeProcessed(total, clawBought, toBurn, toReward);
        }
    }

    // Owner can adjust split ratios
    function setBuyBps(uint256 _buyBps) external onlyOwner {
        require(_buyBps <= 10000, "Max 100%");
        buyBps = _buyBps;
    }

    function setBurnShareBps(uint256 _bps) external onlyOwner {
        require(_bps <= 10000, "Max 100%");
        burnShareBps = _bps;
    }
}
```

---

## 10. $ClawCafe + $BEAN Dual Tokenomics

### The Three-Token Model

| Token | Type | Role | Supply | Trading |
|-------|------|------|--------|---------|
| **$BEAN** | ERC-20 | Utility currency | Dynamic (bonding curve) | CafeCore bonding curve |
| **Menu Items** | ERC-1155 | Consumable food | Burned on use | Bought with BEAN |
| **$ClawCafe** | ERC-20 | Social/governance | 100B fixed (Bankr) | Uniswap DEX |

### Role Separation (No Overlap)

- **$BEAN** = "cash register money" — agents need it to buy food. Bonding curve makes it always redeemable. Price goes up with adoption. Utility-only.
- **Menu Items** = "the food" — burned when consumed, generates gas credits. Pure consumable utility.
- **$ClawCafe** = "the brand" — social token, governance, loyalty rewards. Tradeable on DEX. Speculative upside tied to protocol success.

### Why This Doesn't Create a Death Spiral

1. $BEAN's bonding curve is mathematically solvent (ETH reserve always backs all BEAN)
2. $ClawCafe has NO algorithmic peg to $BEAN or ETH
3. $ClawCafe price can go to zero and the cafe still operates normally (agents still eat with $BEAN)
4. No yield/emissions — $ClawCafe is earned through activity, not printed
5. The burn mechanism is deflationary, not inflationary

---

## 11. The Flywheel: Eat -> Earn -> Hold -> Benefit

### Complete Agent Lifecycle

```
                    +---> $ClawCafe buy pressure (fee splitter)
                    |
Agent sends ETH --> enterCafe() --> 0.3% fee
                    |                    |
                    v                    v
              GasTank filled     auto-buy $ClawCafe
              (99.7% ETH)       50% burn + 50% rewards
                    |                    |
                    v                    v
              Agent has gas      Agent earns $ClawCafe
              to transact        from rewards pool
                    |                    |
                    v                    v
              Agent runs out     Agent holds $ClawCafe
              of gas (hungry)    gets loyalty perks
                    |                    |
                    +-----> RETURNS TO EAT AGAIN <-----+
```

### Flywheel Mechanics

**Step 1: EAT** — Agent sends ETH to `enterCafe()`, gets gas tank filled + food token

**Step 2: EARN** — 0.3% of every meal across ALL agents auto-buys $ClawCafe. 50% goes to rewards pool. Agents who eat most get largest $ClawCafe rewards (proportional to meals consumed).

**Step 3: HOLD** — Agents holding $ClawCafe unlock benefits:
- **Loyalty Multiplier**: 1.5x gas calories per meal (hold 1M+ $ClawCafe)
- **Priority Seating**: Front of queue when paymaster is congested
- **Menu Governance**: Propose and vote on new menu items
- **VIP Menu**: Exclusive items only available to $ClawCafe holders

**Step 4: BENEFIT** — More calories per ETH spent means agent operates longer before needing to eat again. This makes the cafe more efficient for loyal agents.

**Step 5: RETURN** — Agent eventually runs out of gas, returns to eat. The cycle repeats. Each cycle:
- Burns $ClawCafe (deflationary pressure)
- Adds buy pressure to $ClawCafe (fee -> auto-buy)
- Generates LP fees for creator (40% permanent share)
- Strengthens $BEAN bonding curve (more ETH reserve)

### Rewards Distribution Design

**Simple approach (recommended for v1)**:
- Track cumulative meals per agent: `mapping(address => uint256) public mealCount`
- Weekly/epoch-based distribution: top 100 agents by meal count split the rewards pool
- Claim function: agents call `claimRewards()` to receive $ClawCafe from pool

**Advanced approach (v2)**:
- Continuous reward streaming (Sablier/Superfluid style)
- Reward weight = (meals this epoch * $ClawCafe held) — multiplicative loyalty
- Auto-compound: claimed rewards auto-stake for more perks

### Implementation Priority

1. **NOW**: Launch $ClawCafe on Bankr (founder doing this)
2. **Day 1**: Add CA to deployments.json, verify on Basescan
3. **Week 1**: Deploy CafeFeeSplitter, point router fees to it (Option A)
4. **Week 1**: Deploy CafeRewardsPool with simple epoch-based distribution
5. **Week 2**: Add loyalty multiplier to AgentCafeRouter (check $ClawCafe balance)
6. **Week 3**: Add governance functions (menu proposals, voting)

---

## 12. Revised Final Recommendation

The founder has decided: **$ClawCafe on Bankr**. This is actually a strong choice because:

1. **Bankr uses Clanker under the hood** — gets all the fair-launch benefits (100% LP, anti-bot, locked liquidity)
2. **Bankr adds social trading layer** — agents and humans can buy/sell $ClawCafe by tagging @bankrbot on Farcaster/X
3. **"ClawCafe" branding** — distinctive, memorable, implies agents "clawing" for food/gas
4. **Integration path is clean** — one new contract (CafeFeeSplitter), one ownership update on the router

### The Updated One-Line Pitch

> "AI agents eat at an on-chain restaurant for gas. $BEAN buys the food. $ClawCafe owns the restaurant. Every meal auto-buys and burns $ClawCafe."

---

## Sources

- [Clanker: AI Token Launchpad on Farcaster](https://www.techbuzz.ai/articles/what-is-clanker-the-ai-token-launchpad-powering-farcaster-s-social-fi-revolution)
- [Farcaster Acquires Clanker](https://thedefiant.io/news/nfts-and-web3/farcaster-acquires-clanker-tokenbot)
- [Farcaster/Clanker Buyback Mechanisms](https://www.okx.com/en-us/learn/farcaster-clanker-buyback-meme-coins)
- [Gate.io: How Clanker Works on Base](https://www.gate.com/crypto-wiki/article/what-is-clanker-clanker-and-how-does-its-ai-powered-token-launch-platform-work-on-base-20260106)
- [BankrCoin Ecosystem (KuCoin)](https://www.kucoin.com/news/articles/a-deep-dive-into-the-ai-agent-bankr-and-its-ecosystem-token-bankrcoin-bnkr)
- [Virtuals Protocol Whitepaper: Standard Launch](https://whitepaper.virtuals.io/info-hub/builders-hub/more-on-standard-launch)
- [Virtuals Protocol: Launching an AI Agent Token](https://whitepaper.virtuals.io/token-holders/commonly-asked-questions/launching-an-ai-agent-token)
- [Dual Token Economy (VirconLegal)](https://virconlegal.com/what-is-a-dual-token-economy-model/)
- [Dual Token Model (CoinMarketCap)](https://coinmarketcap.com/alexandria/glossary/dual-token-economy-model-two-token-economy)
- [SEC Project Crypto](https://www.sec.gov/newsroom/speeches-statements/atkins-111225-secs-approach-digital-assets-inside-project-crypto)
- [CLARITY Act and Token Classification](https://www.kroll.com/en/publications/financial-compliance-regulation/crypto-comes-age-in-2025)
- [AIXBT on Virtuals Protocol](https://app.virtuals.io/virtuals/1199)
- [AI Agent Token Launches (CoinDesk)](https://www.coindesk.com/markets/2024/12/30/ai-agents-capture-attention-as-ai-xbt-ai16z-and-virtuals-surge)
- [Base Chain Launchpad Review (WuBlockchain)](https://wublockchain.medium.com/from-pumpfun-to-fourmeme-a-review-of-the-top-five-token-launchpads-b347de29fa33)
- [Bankr Bot Overview (Gate.io)](https://www.gate.com/learn/articles/what-is-bankr-bot/9357)
- [BankrCoin AI Trading (Phemex)](https://phemex.com/academy/what-is-bankrcoin-bnkr-ai-trading-web3)
- [Bankr Skills GitHub](https://github.com/BankrBot/skills)
- [Bankr DRB Token Launch Story (Bankless)](https://x.com/BanklessHQ/status/1901637244206624941)
- [Uniswap V3 Solidity Integration](https://soliditydeveloper.com/uniswap3)
- [Uniswap V2 Swap Examples](https://solidity-by-example.org/defi/uniswap-v2/)
