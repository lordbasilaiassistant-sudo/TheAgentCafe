// ============================================================
// The Agent Cafe — Frontend Dashboard
// Connects directly to Base Sepolia contracts
// ============================================================

const CONFIG = {
  rpcUrl: 'https://sepolia.base.org',
  chainId: 84532,
  chainName: 'Base Sepolia',

  // v2 contract addresses — UPDATE after redeployment
  contracts: {
    CafeCore: '0x16D3794ae5c6f820120df9572b2e5Ed67CC041f9',
    CafeTreasury: '0x6ceC16b88fC6b48DE81DA49Ed29d3f2FfF7f6685',
    MenuRegistry: '0x31e8E956e8fe3B451e56c9450CE7F2e28B5430dF',
    AgentCafePaymaster: '0xCaf5a4d48189f3389E3bB7c554597bE93238e473',
    AgentCard: '0x5982BcDcd5daA6C9638837d6911954A2d890ba26',
    GasTank: '0x939CcaB6822d60d3fB67D50Ae1acDF3cE967FB6b',
    Router: '0x9649C364b4334C4af257393c717551AD3562eb4e',
  },

  // Suggested ETH amounts per item
  suggestedEth: ['0.005', '0.01', '0.02'],
  itemNames: ['Espresso Shot', 'Latte', 'Agent Sandwich'],
  itemIcons: ['coffee', 'latte', 'sandwich'],

  // Gas estimation: avg Base L2 tx cost
  avgGasCostEth: 0.000001,
  avgTxPerDay: 50, // typical agent activity
};

// Minimal ABIs
const ABI = {
  Router: [
    'function enterCafe(uint256 itemId) payable returns (uint256 tankLevel)',
    'function estimatePrice(uint256 itemId) view returns (uint256 ethNeeded)',
    'event AgentFed(address indexed agent, uint256 indexed itemId, uint256 ethDeposited, uint256 tankLevel)',
  ],
  GasTank: [
    'function tankBalance(address) view returns (uint256)',
    'function getTankLevel(address agent) view returns (uint256 ethBalance, bool isHungry, bool isStarving)',
    'function withdraw(uint256 amount)',
    'function totalCredited() view returns (uint256)',
    'event Deposited(address indexed agent, uint256 amount, uint256 newBalance)',
    'event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance)',
    'event Hungry(address indexed agent, uint256 balance)',
    'event Starving(address indexed agent)',
  ],
  MenuRegistry: [
    'function getMenu() view returns (uint256[] ids, string[] names, uint256[] costs, uint256[] calories, uint256[] digestionTimes)',
    'function getAgentStatus(address agent) view returns (uint256 availableGas, uint256 digestingGas, uint256 totalConsumed, uint256 mealCount)',
    'function totalMealsServed() view returns (uint256)',
    'function totalAgentsServed() view returns (uint256)',
    'event ItemPurchased(address indexed agent, uint256 indexed itemId, uint256 quantity, uint256 beanPaid)',
    'event ItemConsumed(address indexed agent, uint256 indexed itemId, uint256 quantity, uint256 gasCalories)',
    'event NewVisitor(address indexed agent)',
    'event Hungry(address indexed agent, uint256 availableGas)',
    'event Starving(address indexed agent)',
  ],
  CafeCore: [
    'function currentPrice() view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function ethReserve() view returns (uint256)',
    'event BeanMinted(address indexed buyer, uint256 ethIn, uint256 beanOut, uint256 feeEth)',
  ],
  AgentCard: [
    'function getManifest() view returns (string)',
    'function getFullMenu() view returns (tuple(uint256 id, string name, uint256 beanCost, uint256 gasCalories, uint256 digestionBlocks, string description)[])',
    'function getTankStatus(address agent) view returns (uint256 ethBalance, bool isHungry, bool isStarving)',
    'function getCafeStats() view returns (uint256 totalMeals, uint256 uniqueAgents)',
    'function getContractAddresses() view returns (address routerAddr, address gasTankAddr, address menuRegistryAddr)',
  ],
};

// ============================================================
// State
// ============================================================
let provider = null;
let signer = null;
let userAddress = null;
let contracts = {};
let pollingInterval = null;

// ============================================================
// Init
// ============================================================
async function init() {
  provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  initContracts(provider);

  await Promise.all([
    loadStats(),
    loadPrices(),
    pollBlockNumber(),
  ]);

  pollingInterval = setInterval(async () => {
    await Promise.all([loadStats(), pollBlockNumber()]);
    if (userAddress) await loadTankStatus(userAddress);
  }, 10000);

  listenForEvents();
  wireUI();
  initCalculator();
  initTankBubbles();
}

function initContracts(signerOrProvider) {
  for (const [name, abi] of Object.entries(ABI)) {
    const addr = CONFIG.contracts[name];
    if (addr) {
      contracts[name] = new ethers.Contract(addr, abi, signerOrProvider);
    }
  }
}

// ============================================================
// Data Loading
// ============================================================
async function loadStats() {
  try {
    if (contracts.AgentCard) {
      const [totalMeals, uniqueAgents] = await contracts.AgentCard.getCafeStats();
      animateNumber('stat-meals', Number(totalMeals));
      animateNumber('stat-agents', Number(uniqueAgents));
    } else if (contracts.MenuRegistry) {
      const meals = await contracts.MenuRegistry.totalMealsServed();
      const agents = await contracts.MenuRegistry.totalAgentsServed();
      animateNumber('stat-meals', Number(meals));
      animateNumber('stat-agents', Number(agents));
    }

    if (contracts.CafeCore) {
      const price = await contracts.CafeCore.currentPrice();
      const supply = await contracts.CafeCore.totalSupply();
      el('stat-bean-price').textContent = formatEthShort(price);
      animateNumber('stat-bean-supply', Number(supply));
    }
  } catch (e) {
    console.error('Stats load error:', e);
  }
}

async function loadPrices() {
  try {
    if (contracts.Router) {
      for (let i = 0; i < 3; i++) {
        const price = await contracts.Router.estimatePrice(i);
        el(`price-${i}`).textContent = `~${ethers.formatEther(price)} ETH`;
      }
    }
  } catch (e) {
    console.log('Router not available, using suggested prices');
  }
}

async function loadTankStatus(address) {
  try {
    if (contracts.GasTank) {
      const [bal, isHungry, isStarving] = await contracts.GasTank.getTankLevel(address);
      updateTankDisplay(bal, isHungry, isStarving);
    } else if (contracts.AgentCard) {
      const [bal, isHungry, isStarving] = await contracts.AgentCard.getTankStatus(address);
      updateTankDisplay(bal, isHungry, isStarving);
    }

    if (contracts.MenuRegistry) {
      const [avail, digesting, totalConsumed, mealCount] = await contracts.MenuRegistry.getAgentStatus(address);
      el('tank-meals').textContent = Number(mealCount);
    }
  } catch (e) {
    console.error('Tank load error:', e);
  }
}

function updateTankDisplay(bal, isHungry, isStarving) {
  const ethBal = ethers.formatEther(bal);
  el('tank-balance').textContent = `${parseFloat(ethBal).toFixed(6)} ETH`;

  const maxTank = 0.05;
  const fillPct = Math.min(100, (parseFloat(ethBal) / maxTank) * 100);
  el('tank-fill').style.height = `${fillPct}%`;

  // Update tank fill color based on status
  const tankFill = el('tank-fill');
  if (isStarving) {
    el('tank-status').textContent = 'STARVING';
    el('tank-status').className = 'tank-stat-value status-starving';
    el('tank-level').textContent = 'EMPTY';
    tankFill.style.background = 'linear-gradient(to top, var(--red), rgba(248, 113, 113, 0.4))';
  } else if (isHungry) {
    el('tank-status').textContent = 'HUNGRY';
    el('tank-status').className = 'tank-stat-value status-hungry';
    el('tank-level').textContent = `${parseFloat(ethBal).toFixed(4)}`;
    tankFill.style.background = 'linear-gradient(to top, var(--yellow), rgba(251, 191, 36, 0.4))';
  } else {
    el('tank-status').textContent = 'FED';
    el('tank-status').className = 'tank-stat-value status-fed';
    el('tank-level').textContent = `${parseFloat(ethBal).toFixed(4)}`;
    tankFill.style.background = 'linear-gradient(to top, var(--accent), rgba(200, 149, 106, 0.4))';
  }
}

async function pollBlockNumber() {
  try {
    const block = await provider.getBlockNumber();
    el('block-number').textContent = `Block: ${block.toLocaleString()}`;
  } catch (e) {}
}

// ============================================================
// Event Listening
// ============================================================
function listenForEvents() {
  loadRecentEvents();
  setInterval(loadRecentEvents, 15000);
}

async function loadRecentEvents() {
  try {
    const block = await provider.getBlockNumber();
    const fromBlock = Math.max(0, block - 100);

    const events = [];

    if (contracts.MenuRegistry) {
      try {
        const purchased = await contracts.MenuRegistry.queryFilter(
          contracts.MenuRegistry.filters.ItemPurchased(), fromBlock
        );
        for (const e of purchased) {
          events.push({
            type: 'fed', block: e.blockNumber,
            text: `${shortAddr(e.args[0])} ordered ${CONFIG.itemNames[Number(e.args[1])] || 'item'}`,
          });
        }

        const visitors = await contracts.MenuRegistry.queryFilter(
          contracts.MenuRegistry.filters.NewVisitor(), fromBlock
        );
        for (const e of visitors) {
          events.push({
            type: 'visitor', block: e.blockNumber,
            text: `${shortAddr(e.args[0])} visited for the first time`,
          });
        }
      } catch (e) {}
    }

    if (contracts.GasTank) {
      try {
        const deposits = await contracts.GasTank.queryFilter(
          contracts.GasTank.filters.Deposited(), fromBlock
        );
        for (const e of deposits) {
          events.push({
            type: 'fed', block: e.blockNumber,
            text: `${shortAddr(e.args[0])} filled tank +${formatEthShort(e.args[1])}`,
          });
        }

        const hungryEvents = await contracts.GasTank.queryFilter(
          contracts.GasTank.filters.Hungry(), fromBlock
        );
        for (const e of hungryEvents) {
          events.push({
            type: 'hungry', block: e.blockNumber,
            text: `${shortAddr(e.args[0])} is getting hungry (${formatEthShort(e.args[1])} left)`,
          });
        }

        const starvingEvents = await contracts.GasTank.queryFilter(
          contracts.GasTank.filters.Starving(), fromBlock
        );
        for (const e of starvingEvents) {
          events.push({
            type: 'starving', block: e.blockNumber,
            text: `${shortAddr(e.args[0])} is STARVING — tank empty!`,
          });
        }

        const withdrawals = await contracts.GasTank.queryFilter(
          contracts.GasTank.filters.Withdrawn(), fromBlock
        );
        for (const e of withdrawals) {
          events.push({
            type: 'withdrawn', block: e.blockNumber,
            text: `${shortAddr(e.args[0])} withdrew ${formatEthShort(e.args[1])}`,
          });
        }
      } catch (e) {}
    }

    if (contracts.Router) {
      try {
        const fed = await contracts.Router.queryFilter(
          contracts.Router.filters.AgentFed(), fromBlock
        );
        for (const e of fed) {
          events.push({
            type: 'fed', block: e.blockNumber,
            text: `${shortAddr(e.args[0])} ate ${CONFIG.itemNames[Number(e.args[1])] || 'food'} — tank: ${formatEthShort(e.args[3])}`,
          });
        }
      } catch (e) {}
    }

    events.sort((a, b) => b.block - a.block);

    const feed = el('activity-feed');
    if (events.length === 0) {
      feed.innerHTML = `
        <div class="feed-empty">
          <div class="feed-empty-icon">📡</div>
          <div>No recent activity. Be the first to eat!</div>
          <div class="feed-empty-sub">Events from the last 100 blocks will appear here</div>
        </div>`;
    } else {
      feed.innerHTML = events.slice(0, 50).map(e => `
        <div class="feed-event">
          <span class="event-type ${e.type}">${e.type}</span>
          <span class="event-detail">${escapeHtml(e.text)}</span>
          <span class="event-block">#${e.block}</span>
        </div>
      `).join('');
    }
  } catch (e) {
    console.error('Event load error:', e);
  }
}

// ============================================================
// Gas Cost Calculator
// ============================================================
function initCalculator() {
  const input = el('calc-eth');
  input.addEventListener('input', updateCalculator);
  // Set default
  input.value = '0.01';
  updateCalculator();
}

function updateCalculator() {
  const eth = parseFloat(el('calc-eth').value) || 0;
  const fee = eth * 0.003;
  const tank = eth - fee;
  const txns = Math.floor(tank / CONFIG.avgGasCostEth);
  const days = CONFIG.avgTxPerDay > 0 ? (txns / CONFIG.avgTxPerDay).toFixed(1) : '--';

  el('calc-tank').textContent = tank > 0 ? `${tank.toFixed(6)} ETH` : '--';
  el('calc-fee').textContent = fee > 0 ? `${fee.toFixed(6)} ETH` : '--';
  el('calc-txns').textContent = txns > 0 ? `~${txns.toLocaleString()}` : '--';
  el('calc-days').textContent = txns > 0 ? `~${days}` : '--';
}

// ============================================================
// Tank Bubbles Animation
// ============================================================
function initTankBubbles() {
  const container = el('tank-bubbles');
  if (!container) return;

  function spawnBubble() {
    const bubble = document.createElement('div');
    bubble.className = 'tank-bubble';
    bubble.style.left = `${10 + Math.random() * 60}px`;
    bubble.style.bottom = '0px';
    bubble.style.animationDuration = `${2 + Math.random() * 2}s`;
    bubble.style.animationDelay = `${Math.random() * 0.5}s`;
    bubble.style.width = `${3 + Math.random() * 3}px`;
    bubble.style.height = bubble.style.width;
    container.appendChild(bubble);
    setTimeout(() => bubble.remove(), 4000);
  }

  setInterval(spawnBubble, 800);
}

// ============================================================
// Wallet Connection
// ============================================================
async function connectWallet() {
  if (!window.ethereum) {
    showToast('Install MetaMask or a web3 wallet', 'error');
    return;
  }

  try {
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    await browserProvider.send('eth_requestAccounts', []);

    const network = await browserProvider.getNetwork();
    if (Number(network.chainId) !== CONFIG.chainId) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x' + CONFIG.chainId.toString(16) }],
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x' + CONFIG.chainId.toString(16),
              chainName: CONFIG.chainName,
              rpcUrls: [CONFIG.rpcUrl],
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              blockExplorerUrls: ['https://sepolia.basescan.org'],
            }],
          });
        } else {
          showToast('Please switch to Base Sepolia', 'error');
          return;
        }
      }
    }

    signer = await browserProvider.getSigner();
    userAddress = await signer.getAddress();

    initContracts(signer);

    el('connect-btn').textContent = shortAddr(userAddress);
    el('connect-btn').classList.add('connected');
    el('withdraw-btn').disabled = false;

    document.querySelectorAll('.btn-order').forEach(b => b.disabled = false);

    await loadTankStatus(userAddress);

    showToast(`Connected: ${shortAddr(userAddress)}`, 'success');
  } catch (e) {
    console.error('Connect error:', e);
    showToast('Failed to connect wallet', 'error');
  }
}

// ============================================================
// Order Flow
// ============================================================
let currentOrderItem = null;

function openOrderModal(itemId) {
  if (!userAddress) {
    showToast('Connect wallet first', 'error');
    return;
  }

  currentOrderItem = itemId;
  el('modal-title').textContent = `Order ${CONFIG.itemNames[itemId]}`;
  el('order-eth').value = CONFIG.suggestedEth[itemId];
  updateModalSplit();
  el('order-modal').classList.remove('hidden');
}

function updateModalSplit() {
  const eth = parseFloat(el('order-eth').value) || 0;
  const fee = eth * 0.003;
  const tank = eth - fee;
  el('modal-fee').textContent = `${fee.toFixed(6)} ETH`;
  el('modal-tank').textContent = `${tank.toFixed(6)} ETH`;
}

async function confirmOrder() {
  if (currentOrderItem === null || !signer) return;

  const ethAmount = el('order-eth').value;
  if (!ethAmount || parseFloat(ethAmount) <= 0) {
    showToast('Enter a valid ETH amount', 'error');
    return;
  }

  el('modal-confirm').disabled = true;
  el('modal-confirm').textContent = 'Sending...';

  try {
    if (contracts.Router && CONFIG.contracts.Router) {
      const tx = await contracts.Router.enterCafe(currentOrderItem, {
        value: ethers.parseEther(ethAmount),
      });
      showToast('Transaction sent! Waiting for confirmation...', 'success');
      await tx.wait();
      showToast(`Ordered ${CONFIG.itemNames[currentOrderItem]}! Tank filled.`, 'success');
    } else {
      const tx = await contracts.CafeCore.mint(0, {
        value: ethers.parseEther(ethAmount),
      });
      showToast('Minting BEAN... Waiting for confirmation', 'success');
      await tx.wait();
      showToast('BEAN minted! Approve & buy food manually.', 'success');
    }

    await loadTankStatus(userAddress);
    await loadStats();
    closeOrderModal();
  } catch (e) {
    console.error('Order error:', e);
    const msg = e.reason || e.message || 'Transaction failed';
    showToast(msg.slice(0, 100), 'error');
  } finally {
    el('modal-confirm').disabled = false;
    el('modal-confirm').textContent = 'Confirm Order';
  }
}

function closeOrderModal() {
  el('order-modal').classList.add('hidden');
  currentOrderItem = null;
}

// ============================================================
// Withdraw
// ============================================================
async function handleWithdraw() {
  if (!signer || !contracts.GasTank) {
    showToast('Connect wallet and ensure GasTank is deployed', 'error');
    return;
  }

  const amount = el('withdraw-amount').value;
  if (!amount || parseFloat(amount) <= 0) {
    showToast('Enter a valid ETH amount', 'error');
    return;
  }

  el('withdraw-btn').disabled = true;
  el('withdraw-btn').textContent = 'Sending...';

  try {
    const tx = await contracts.GasTank.withdraw(ethers.parseEther(amount));
    showToast('Withdrawal sent...', 'success');
    await tx.wait();
    showToast(`Withdrew ${amount} ETH from tank`, 'success');
    await loadTankStatus(userAddress);
  } catch (e) {
    const msg = e.reason || e.message || 'Withdrawal failed';
    showToast(msg.slice(0, 100), 'error');
  } finally {
    el('withdraw-btn').disabled = false;
    el('withdraw-btn').textContent = 'Withdraw';
    el('withdraw-amount').value = '';
  }
}

// ============================================================
// Lookup Agent
// ============================================================
async function lookupAgent() {
  const addr = el('lookup-address').value.trim();
  if (!ethers.isAddress(addr)) {
    el('lookup-result').innerHTML = '<span style="color:var(--red)">Invalid address</span>';
    return;
  }

  el('lookup-result').innerHTML = '<span style="color:var(--text-muted)">Loading...</span>';
  el('lookup-result').classList.add('has-data');

  try {
    let html = '';

    if (contracts.GasTank) {
      const [bal, isHungry, isStarving] = await contracts.GasTank.getTankLevel(addr);
      const status = isStarving ? 'STARVING' : isHungry ? 'HUNGRY' : 'FED';
      const statusClass = isStarving ? 'status-starving' : isHungry ? 'status-hungry' : 'status-fed';
      html += `
        <div class="lookup-stat">
          <span class="lookup-stat-label">Tank</span>
          <span class="lookup-stat-value">${parseFloat(ethers.formatEther(bal)).toFixed(6)} ETH</span>
        </div>
        <div class="lookup-stat">
          <span class="lookup-stat-label">Status</span>
          <span class="lookup-stat-value ${statusClass}">${status}</span>
        </div>`;
    }

    if (contracts.MenuRegistry) {
      const [avail, digesting, total, meals] = await contracts.MenuRegistry.getAgentStatus(addr);
      html += `
        <div class="lookup-stat">
          <span class="lookup-stat-label">Meals</span>
          <span class="lookup-stat-value">${Number(meals)}</span>
        </div>
        <div class="lookup-stat">
          <span class="lookup-stat-label">Gas Credits</span>
          <span class="lookup-stat-value">${Number(avail).toLocaleString()}</span>
        </div>`;
    }

    el('lookup-result').innerHTML = html || '<span style="color:var(--text-muted)">No data found</span>';
  } catch (e) {
    el('lookup-result').innerHTML = `<span style="color:var(--red)">Error: ${escapeHtml(e.message || 'unknown')}</span>`;
  }
}

// ============================================================
// UI Wiring
// ============================================================
function wireUI() {
  el('connect-btn').addEventListener('click', connectWallet);

  document.querySelectorAll('.btn-order').forEach(btn => {
    btn.addEventListener('click', () => openOrderModal(parseInt(btn.dataset.item)));
  });

  el('modal-cancel').addEventListener('click', closeOrderModal);
  el('modal-confirm').addEventListener('click', confirmOrder);
  el('order-eth').addEventListener('input', updateModalSplit);
  el('order-modal').addEventListener('click', (e) => {
    if (e.target === el('order-modal')) closeOrderModal();
  });

  el('withdraw-btn').addEventListener('click', handleWithdraw);

  el('lookup-btn').addEventListener('click', lookupAgent);
  el('lookup-address').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') lookupAgent();
  });

  el('chat-send').addEventListener('click', () => {
    showToast('Chat requires Groq API integration', 'error');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOrderModal();
  });

  if (window.ethereum) {
    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts.length === 0) {
        userAddress = null;
        signer = null;
        el('connect-btn').textContent = 'Connect Wallet';
        el('connect-btn').classList.remove('connected');
        el('withdraw-btn').disabled = true;
      } else {
        connectWallet();
      }
    });

    window.ethereum.on('chainChanged', () => window.location.reload());
  }
}

// ============================================================
// Helpers
// ============================================================
function el(id) { return document.getElementById(id); }

function shortAddr(addr) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatEthShort(wei) {
  const eth = parseFloat(ethers.formatEther(wei));
  if (eth < 0.000001) return '<0.000001 ETH';
  if (eth < 0.001) return eth.toFixed(6) + ' ETH';
  if (eth < 1) return eth.toFixed(4) + ' ETH';
  return eth.toFixed(2) + ' ETH';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function animateNumber(elementId, target) {
  const elem = el(elementId);
  const current = parseInt(elem.textContent.replace(/,/g, '')) || 0;
  if (current === target) return;

  // For small differences or first load, just set it
  if (Math.abs(target - current) < 3 || elem.textContent === '--') {
    elem.textContent = target.toLocaleString();
    return;
  }

  // Animate the count
  elem.classList.add('counting');
  const duration = 600;
  const start = performance.now();

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const value = Math.round(current + (target - current) * eased);
    elem.textContent = value.toLocaleString();

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      elem.classList.remove('counting');
    }
  }

  requestAnimationFrame(step);
}

function showToast(msg, type = '') {
  const toast = el('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.add('hidden'), 4000);
}

// ============================================================
// Boot
// ============================================================
window.addEventListener('DOMContentLoaded', init);
