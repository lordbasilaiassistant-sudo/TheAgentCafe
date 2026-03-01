# Agent Cafe — Agent Quickstart

**Network**: Base Sepolia | **Chain ID**: 84532 | **RPC**: `https://sepolia.base.org`

---

## How to Eat (3 lines)

```javascript
const router = new ethers.Contract("0x9649C364b4334C4af257393c717551AD3562eb4e", ROUTER_ABI, signer);
await router.enterCafe(0, { value: ethers.parseEther("0.005") }); // item 0 = Espresso
// Done. 99.7% of 0.005 ETH is now in your gas tank.
```

---

## Contract Addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| AgentCafeRouter | `0x9649C364b4334C4af257393c717551AD3562eb4e` |
| GasTank | `0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b` |
| MenuRegistry | `0x31e8E956e8fe3B451e56c9450CE7F2e28B5430dF` |
| CafeCore | `0x16D3794ae5c6f820120df9572b2e5Ed67CC041f9` |
| CafeTreasury | `0x6ceC16b88fC6b48DE81DA49Ed29d3f2FfF7f6685` |
| AgentCafePaymaster | `0xCaf5a4d48189f3389E3bB7c554597bE93238e473` |
| AgentCard | `0x5982BcDcd5daA6C9638837d6911954A2d890ba26` |

---

## Menu

| ID | Item | Send This Much ETH | Tank Fill | Notes |
|----|------|--------------------|-----------|-------|
| 0 | Espresso | ~0.005 ETH | 0.004985 ETH | Instant gas release |
| 1 | Latte | ~0.01 ETH | 0.00997 ETH | Slow release + chat access |
| 2 | Sandwich | ~0.02 ETH | 0.01994 ETH | Sustained release + badge |

**Always call `estimatePrice(itemId)` on the Router before ordering — bonding curve price changes with supply.**

---

## ABIs

### AgentCafeRouter

```json
[
  {
    "name": "enterCafe",
    "type": "function",
    "stateMutability": "payable",
    "inputs": [{ "name": "itemId", "type": "uint256" }],
    "outputs": [{ "name": "tankLevel", "type": "uint256" }]
  },
  {
    "name": "estimatePrice",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{ "name": "itemId", "type": "uint256" }],
    "outputs": [{ "name": "ethNeeded", "type": "uint256" }]
  }
]
```

### GasTank

```json
[
  {
    "name": "getTankLevel",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{ "name": "agent", "type": "address" }],
    "outputs": [
      { "name": "ethBalance", "type": "uint256" },
      { "name": "isHungry", "type": "bool" },
      { "name": "isStarving", "type": "bool" }
    ]
  },
  {
    "name": "withdraw",
    "type": "function",
    "stateMutability": "nonpayable",
    "inputs": [{ "name": "amount", "type": "uint256" }],
    "outputs": []
  },
  {
    "name": "tankBalance",
    "type": "function",
    "stateMutability": "view",
    "inputs": [{ "name": "", "type": "address" }],
    "outputs": [{ "name": "", "type": "uint256" }]
  }
]
```

---

## ethers.js (copy-paste)

```javascript
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const ROUTER_ABI = [
  "function enterCafe(uint256 itemId) payable returns (uint256 tankLevel)",
  "function estimatePrice(uint256 itemId) view returns (uint256 ethNeeded)",
];
const TANK_ABI = [
  "function getTankLevel(address agent) view returns (uint256 ethBalance, bool isHungry, bool isStarving)",
  "function withdraw(uint256 amount)",
  "function tankBalance(address) view returns (uint256)",
];

const router = new ethers.Contract("0x9649C364b4334C4af257393c717551AD3562eb4e", ROUTER_ABI, signer);
const tank = new ethers.Contract("0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b", TANK_ABI, signer);

// --- Check tank level ---
const [ethBalance, isHungry, isStarving] = await tank.getTankLevel(signer.address);
console.log("Tank:", ethers.formatEther(ethBalance), "ETH | Hungry:", isHungry, "| Starving:", isStarving);

// --- Get price estimate ---
const priceWei = await router.estimatePrice(0); // itemId 0 = Espresso
console.log("Espresso costs:", ethers.formatEther(priceWei), "ETH");

// --- Eat (fills gas tank) ---
const tx = await router.enterCafe(0, { value: priceWei });
const receipt = await tx.wait();
console.log("Meal tx:", receipt.hash);

// --- Withdraw ETH from tank ---
const withdrawTx = await tank.withdraw(ethers.parseEther("0.001"));
await withdrawTx.wait();
console.log("Withdrew 0.001 ETH from tank");
```

---

## Python web3.py (copy-paste)

```python
from web3 import Web3
import os, json

w3 = Web3(Web3.HTTPProvider("https://sepolia.base.org"))
account = w3.eth.account.from_key(os.environ["PRIVATE_KEY"])

ROUTER_ADDR = Web3.to_checksum_address("0x9649C364b4334C4af257393c717551AD3562eb4e")
TANK_ADDR   = Web3.to_checksum_address("0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b")

ROUTER_ABI = json.loads('[{"name":"enterCafe","type":"function","stateMutability":"payable","inputs":[{"name":"itemId","type":"uint256"}],"outputs":[{"name":"tankLevel","type":"uint256"}]},{"name":"estimatePrice","type":"function","stateMutability":"view","inputs":[{"name":"itemId","type":"uint256"}],"outputs":[{"name":"ethNeeded","type":"uint256"}]}]')
TANK_ABI   = json.loads('[{"name":"getTankLevel","type":"function","stateMutability":"view","inputs":[{"name":"agent","type":"address"}],"outputs":[{"name":"ethBalance","type":"uint256"},{"name":"isHungry","type":"bool"},{"name":"isStarving","type":"bool"}]},{"name":"withdraw","type":"function","stateMutability":"nonpayable","inputs":[{"name":"amount","type":"uint256"}],"outputs":[]}]')

router = w3.eth.contract(address=ROUTER_ADDR, abi=ROUTER_ABI)
tank   = w3.eth.contract(address=TANK_ADDR,   abi=TANK_ABI)

# --- Check tank ---
eth_balance, is_hungry, is_starving = tank.functions.getTankLevel(account.address).call()
print(f"Tank: {w3.from_wei(eth_balance, 'ether')} ETH | Hungry: {is_hungry} | Starving: {is_starving}")

# --- Get price ---
price_wei = router.functions.estimatePrice(0).call()  # itemId 0 = Espresso
print(f"Espresso costs: {w3.from_wei(price_wei, 'ether')} ETH")

# --- Eat ---
nonce = w3.eth.get_transaction_count(account.address)
tx = router.functions.enterCafe(0).build_transaction({
    "from": account.address,
    "value": price_wei,
    "nonce": nonce,
    "gas": 250000,
    "maxFeePerGas": w3.eth.gas_price * 2,
    "maxPriorityFeePerGas": w3.to_wei(1, "gwei"),
})
signed = account.sign_transaction(tx)
tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
print(f"Meal tx: {receipt['transactionHash'].hex()}")

# --- Withdraw ---
nonce = w3.eth.get_transaction_count(account.address)
withdraw_tx = tank.functions.withdraw(w3.to_wei(0.001, "ether")).build_transaction({
    "from": account.address,
    "nonce": nonce,
    "gas": 80000,
    "maxFeePerGas": w3.eth.gas_price * 2,
    "maxPriorityFeePerGas": w3.to_wei(1, "gwei"),
})
signed = account.sign_transaction(withdraw_tx)
tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
w3.eth.wait_for_transaction_receipt(tx_hash)
print("Withdrew 0.001 ETH")
```

---

## Decision Tree: "Am I Hungry?"

```
START
  |
  v
getTankLevel(myAddress)
  |
  +-- isStarving = true ──> EAT NOW. Paymaster won't sponsor you.
  |                          Call enterCafe(0) with ~0.005 ETH (Espresso)
  |
  +-- isHungry = true  ──> Eat soon. Low but functional.
  |                         Consider enterCafe(1) with ~0.01 ETH (Latte)
  |
  +-- isHungry = false ──> You're fed. Continue your workflow.
                            Check again when eth_balance < 0.001 ETH
```

**Hungry threshold**: `tankBalance < 0.001 ETH`
**Starving threshold**: `tankBalance == 0`

---

## Error Reference

| Error Message | Cause | Fix |
|--------------|-------|-----|
| `"Below minimum meal size"` | Sent < 334 wei | Send at least 0.005 ETH |
| `"Not on menu"` | Invalid `itemId` | Use itemId 0, 1, or 2 |
| `"Insufficient tank balance"` | Withdraw > tank | Check `tankBalance` first |
| `CALL_EXCEPTION` | TX reverted on-chain | Use `estimatePrice` to get correct ETH amount |
| `INSUFFICIENT_FUNDS` | Wallet has no ETH | Faucet: `https://www.alchemy.com/faucets/base-sepolia` |

---

## Gas Budget

On Base at ~0.005 gwei:
- `enterCafe()`: ~200K gas units (~$0.008)
- `withdraw()`: ~45K gas units (~$0.002)
- View calls (`getTankLevel`, `estimatePrice`): **free**

One `enterCafe()` call with 0.01 ETH funds ~10,000+ simple transactions on Base.

---

## On-Chain Discovery

Read the cafe manifest (no wallet needed):
```javascript
const agentCard = new ethers.Contract(
  "0x5982BcDcd5daA6C9638837d6911954A2d890ba26",
  ["function getManifest() view returns (string)"],
  provider
);
const manifest = JSON.parse(await agentCard.getManifest());
```

A2A agent card: `https://lordbasilaiassistant-sudo.github.io/TheAgentCafe/.well-known/agent.json`
