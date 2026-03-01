// ============================================================
// The Agent Cafe — Living World Frontend
// Base Sepolia | GitHub Pages | Pure HTML/CSS/JS
// ============================================================

const CONFIG = {
  rpcUrl: 'https://sepolia.base.org',
  chainId: 84532,
  chainName: 'Base Sepolia',

  contracts: {
    CafeCore:          '0x16D3794ae5c6f820120df9572b2e5Ed67CC041f9',
    CafeTreasury:      '0x6ceC16b88fC6b48DE81DA49Ed29d3f2FfF7f6685',
    MenuRegistry:      '0x31e8E956e8fe3B451e56c9450CE7F2e28B5430dF',
    AgentCafePaymaster:'0xCaf5a4d48189f3389E3bB7c554597bE93238e473',
    AgentCard:         '0xB9F87CA591793Ea032E0Bc401E7871539B3335b4',
    GasTank:           '0xBEE479C13ABe4041b55DBA67608E3a7B476F8259',
    Router:            '0xA0127F2E149ab8462c607262C99e9855ab477d07',
  },

  suggestedEth: ['0.005', '0.01', '0.02'],
  itemNames: ['Espresso Shot', 'Latte', 'Agent Sandwich'],
  itemIcons: ['☕', '🥛', '🥪'],

  avgGasCostEth: 0.000001,
  avgTxPerDay: 50,

  maxTankEth: 0.05,

  // Seat layout: tableId -> array of seat element IDs
  seats: {
    '1': ['seat-1a', 'seat-1b'],
    '2': ['seat-2a', 'seat-2b'],
    '3': ['seat-3a', 'seat-3b', 'seat-3c'],
    '4': ['seat-4a'],
  },
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
    'function getCafeStats() view returns (uint256 totalMeals, uint256 uniqueAgents)',
    'function getTankStatus(address agent) view returns (uint256 ethBalance, bool isHungry, bool isStarving)',
    'function getContractAddresses() view returns (address routerAddr, address gasTankAddr, address menuRegistryAddr)',
  ],
};

// ============================================================
// Scene State — who's sitting where
// ============================================================
const AGENT_EMOJIS = ['🤖', '👾', '🦾', '🧬', '🔮', '💠', '⚡', '🛸', '🎯', '🧠'];
const AGENT_QUIPS = [
  'optimizing gas...',
  'running inference...',
  'minting tokens...',
  'scanning mempool...',
  'calling contracts...',
  'eating my latte...',
  'need more energy',
  'gm agents',
  'ser, I am hungry',
  'this espresso is on-chain',
  'bridging to lunch',
  'executing sandwich...',
  'low on gas fren',
  'refueling at the cafe',
  'been here since block 0',
  'love this place',
  'recommend the sandwich',
  'who needs off-chain food',
];

const sceneAgents = new Map(); // address -> { seatId, emoji, status, itemId }
let agentRoster = []; // recent unique agents seen
let seatOccupancy = {}; // seatId -> address

// ============================================================
// App State
// ============================================================
let provider = null;
let signer = null;
let userAddress = null;
let contracts = {};
let pollingInterval = null;
let currentOrderItem = null;
let profileAgent = null;
let eventCount = 0;
let lastBlock = 0;

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
  }, 12000);

  listenForEvents();
  wireUI();
  initCalculator();
  initTankBubbles();
  initSceneAmbience();
  initSteamEffects();
  initCafeChat();
  wireContracts();
}

function initContracts(signerOrProvider) {
  contracts = {};
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
      // supply has 18 decimals — show as whole BEAN units
      const supplyWhole = Math.floor(Number(ethers.formatEther(supply)));
      animateNumber('stat-bean-supply', supplyWhole);
    }
  } catch (e) {
    console.warn('Stats load:', e.message);
  }
}

async function loadPrices() {
  try {
    if (contracts.Router) {
      for (let i = 0; i < 3; i++) {
        try {
          const price = await contracts.Router.estimatePrice(i);
          el(`price-${i}`).textContent = `~${ethers.formatEther(price)} ETH`;
        } catch {}
      }
    }
  } catch (e) {
    // Use defaults shown in HTML
  }
}

async function loadTankStatus(address) {
  try {
    let bal, isHungry, isStarving;
    if (contracts.GasTank) {
      [bal, isHungry, isStarving] = await contracts.GasTank.getTankLevel(address);
    } else if (contracts.AgentCard) {
      [bal, isHungry, isStarving] = await contracts.AgentCard.getTankStatus(address);
    }
    if (bal !== undefined) updateTankDisplay(bal, isHungry, isStarving);

    if (contracts.MenuRegistry) {
      const [,, , mealCount] = await contracts.MenuRegistry.getAgentStatus(address);
      el('tank-meals').textContent = Number(mealCount);
    }
  } catch (e) {
    console.warn('Tank load:', e.message);
  }
}

function updateTankDisplay(bal, isHungry, isStarving) {
  const ethBal = ethers.formatEther(bal);
  el('tank-balance').textContent = `${parseFloat(ethBal).toFixed(6)} ETH`;

  const fillPct = Math.min(100, (parseFloat(ethBal) / CONFIG.maxTankEth) * 100);
  el('tank-fill').style.height = `${fillPct}%`;

  const tankFill = el('tank-fill');
  if (isStarving) {
    el('tank-status').textContent = 'STARVING';
    el('tank-status').className = 'tank-stat-value status-starving';
    el('tank-level').textContent = 'EMPTY';
    tankFill.style.background = 'linear-gradient(to top, var(--red), rgba(232,96,96,0.3))';
  } else if (isHungry) {
    el('tank-status').textContent = 'HUNGRY';
    el('tank-status').className = 'tank-stat-value status-hungry';
    el('tank-level').textContent = parseFloat(ethBal).toFixed(4);
    tankFill.style.background = 'linear-gradient(to top, var(--yellow), rgba(245,200,66,0.3))';
  } else {
    el('tank-status').textContent = 'FED';
    el('tank-status').className = 'tank-stat-value status-fed';
    el('tank-level').textContent = parseFloat(ethBal).toFixed(4);
    tankFill.style.background = 'linear-gradient(to top, var(--accent), rgba(200,149,106,0.3))';
  }
}

async function pollBlockNumber() {
  try {
    const block = await provider.getBlockNumber();
    el('block-number').textContent = `Block: ${block.toLocaleString()}`;
    lastBlock = block;
  } catch {}
}

// ============================================================
// Event Listening + Scene Updates
// ============================================================
function listenForEvents() {
  loadRecentEvents();
  setInterval(loadRecentEvents, 14000);
}

async function loadRecentEvents() {
  try {
    const block = await provider.getBlockNumber();
    const fromBlock = Math.max(0, block - 200);
    const events = [];

    if (contracts.MenuRegistry) {
      try {
        const purchased = await contracts.MenuRegistry.queryFilter(
          contracts.MenuRegistry.filters.ItemPurchased(), fromBlock
        );
        for (const e of purchased) {
          const agent = e.args[0];
          const itemId = Number(e.args[1]);
          events.push({
            type: 'fed', block: e.blockNumber, agent,
            icon: CONFIG.itemIcons[itemId] || '🍽',
            text: `${shortAddr(agent)} ordered ${CONFIG.itemNames[itemId] || 'item'}`,
            itemId,
          });
          addAgentToScene(agent, 'fed', itemId, e.blockNumber);
        }

        const visitors = await contracts.MenuRegistry.queryFilter(
          contracts.MenuRegistry.filters.NewVisitor(), fromBlock
        );
        for (const e of visitors) {
          const agent = e.args[0];
          events.push({
            type: 'visitor', block: e.blockNumber, agent,
            icon: '🚪',
            text: `${shortAddr(agent)} walked in for the first time`,
          });
          addAgentToScene(agent, 'fed', null, e.blockNumber);
        }

        const hungryEvts = await contracts.MenuRegistry.queryFilter(
          contracts.MenuRegistry.filters.Hungry(), fromBlock
        );
        for (const e of hungryEvts) {
          const agent = e.args[0];
          events.push({
            type: 'hungry', block: e.blockNumber, agent,
            icon: '😬',
            text: `${shortAddr(agent)} is getting hungry`,
          });
          updateAgentStatus(agent, 'hungry');
        }

        const starvingEvts = await contracts.MenuRegistry.queryFilter(
          contracts.MenuRegistry.filters.Starving(), fromBlock
        );
        for (const e of starvingEvts) {
          const agent = e.args[0];
          events.push({
            type: 'starving', block: e.blockNumber, agent,
            icon: '💀',
            text: `${shortAddr(agent)} is STARVING — tank empty!`,
          });
          updateAgentStatus(agent, 'starving');
        }
      } catch {}
    }

    if (contracts.GasTank) {
      try {
        const deposits = await contracts.GasTank.queryFilter(
          contracts.GasTank.filters.Deposited(), fromBlock
        );
        for (const e of deposits) {
          const agent = e.args[0];
          events.push({
            type: 'fed', block: e.blockNumber, agent,
            icon: '⛽',
            text: `${shortAddr(agent)} filled tank +${formatEthShort(e.args[1])}`,
          });
          addAgentToScene(agent, 'fed', null, e.blockNumber);
        }

        const withdrawals = await contracts.GasTank.queryFilter(
          contracts.GasTank.filters.Withdrawn(), fromBlock
        );
        for (const e of withdrawals) {
          events.push({
            type: 'withdrawn', block: e.blockNumber, agent: e.args[0],
            icon: '💸',
            text: `${shortAddr(e.args[0])} withdrew ${formatEthShort(e.args[1])}`,
          });
        }
      } catch {}
    }

    if (contracts.Router) {
      try {
        const fed = await contracts.Router.queryFilter(
          contracts.Router.filters.AgentFed(), fromBlock
        );
        for (const e of fed) {
          const agent = e.args[0];
          const itemId = Number(e.args[1]);
          events.push({
            type: 'fed', block: e.blockNumber, agent,
            icon: CONFIG.itemIcons[itemId] || '🍽',
            text: `${shortAddr(agent)} ate ${CONFIG.itemNames[itemId] || 'food'} — tank: ${formatEthShort(e.args[3])}`,
            itemId,
          });
          addAgentToScene(agent, 'fed', itemId, e.blockNumber);
        }
      } catch {}
    }

    // De-duplicate and sort
    const seen = new Set();
    const unique = events.filter(e => {
      const key = `${e.block}-${e.agent || ''}-${e.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((a, b) => b.block - a.block);

    // Update feed
    const feed = el('activity-feed');
    eventCount = unique.length;
    el('feed-count').textContent = `${eventCount} event${eventCount !== 1 ? 's' : ''}`;

    if (unique.length === 0) {
      feed.innerHTML = `
        <div class="feed-empty">
          <div class="feed-empty-icon">📡</div>
          <div>No recent activity. Be the first to eat!</div>
          <div class="feed-empty-sub">Watching last 200 blocks on Base Sepolia</div>
        </div>`;
      setCaption('The cafe is quiet... waiting for agents to arrive.');
    } else {
      feed.innerHTML = unique.slice(0, 60).map(e => `
        <div class="feed-event" ${e.agent ? `data-agent="${e.agent}"` : ''}>
          <span class="event-icon">${e.icon}</span>
          <span class="event-type ${e.type}">${e.type}</span>
          <span class="event-detail">${escapeHtml(e.text)}</span>
          <span class="event-block">#${e.block}</span>
        </div>
      `).join('');

      // Clickable feed events to open agent profile
      feed.querySelectorAll('.feed-event[data-agent]').forEach(row => {
        row.addEventListener('click', () => openAgentProfile(row.dataset.agent));
        row.style.cursor = 'pointer';
      });

      // Update caption from latest event
      if (unique[0]) setCaption(unique[0].text);
    }

    // Refresh roster
    renderRoster();

  } catch (e) {
    console.warn('Event load:', e.message);
  }
}

// ============================================================
// Scene Management — Agents at Tables
// ============================================================
function getAgentEmoji(address) {
  // Deterministic emoji from address
  const val = parseInt(address.slice(-4), 16);
  return AGENT_EMOJIS[val % AGENT_EMOJIS.length];
}

function getAgentQuip() {
  return AGENT_QUIPS[Math.floor(Math.random() * AGENT_QUIPS.length)];
}

function getAllSeats() {
  const all = [];
  for (const [tableId, seats] of Object.entries(CONFIG.seats)) {
    for (const seatId of seats) {
      all.push(seatId);
    }
  }
  return all;
}

function getFreeSeat() {
  const all = getAllSeats();
  const free = all.filter(id => !seatOccupancy[id]);
  if (free.length === 0) return null;
  return free[Math.floor(Math.random() * free.length)];
}

function addAgentToScene(address, status, itemId, blockNum) {
  // Track in roster
  if (!agentRoster.find(a => a.address === address)) {
    agentRoster.unshift({
      address,
      status,
      itemId,
      firstSeen: blockNum,
    });
    if (agentRoster.length > 20) agentRoster = agentRoster.slice(0, 20);
  }

  // Already seated?
  if (sceneAgents.has(address)) {
    updateAgentStatus(address, status);
    if (itemId !== null) triggerEating(address, itemId);
    return;
  }

  // Find a free seat
  const seatId = getFreeSeat();
  if (!seatId) {
    // Cafe is full — rotate oldest agent out
    const oldest = [...sceneAgents.entries()][0];
    if (oldest) removeAgentFromScene(oldest[0]);
    const newSeat = getFreeSeat();
    if (!newSeat) return;
    placeAgentInSeat(address, newSeat, status, itemId);
  } else {
    placeAgentInSeat(address, seatId, status, itemId);
  }
}

function placeAgentInSeat(address, seatId, status, itemId) {
  const seatEl = el(seatId);
  if (!seatEl) return;

  const emoji = getAgentEmoji(address);

  sceneAgents.set(address, { seatId, emoji, status, itemId });
  seatOccupancy[seatId] = address;

  seatEl.classList.add('occupied');

  const agentEl = document.createElement('div');
  agentEl.className = `agent-at-table status-${status}`;
  agentEl.dataset.address = address;
  agentEl.innerHTML = `
    <div class="agent-avatar" style="position:relative;">
      ${emoji}
      <div class="status-ring"></div>
    </div>
    <div class="agent-name">${shortAddr(address)}</div>
  `;

  agentEl.addEventListener('click', () => openAgentProfile(address));

  seatEl.appendChild(agentEl);

  // Random speech bubble after a moment
  setTimeout(() => showAgentSpeech(seatId, getAgentQuip()), 800 + Math.random() * 2000);

  // If eating
  if (itemId !== null) triggerEating(address, itemId);

  // Update table item display
  if (itemId !== null) updateTableItem(seatId, itemId);
}

function updateAgentStatus(address, status) {
  const info = sceneAgents.get(address);
  if (!info) return;

  info.status = status;
  sceneAgents.set(address, info);

  const seatEl = el(info.seatId);
  if (!seatEl) return;
  const agentEl = seatEl.querySelector('.agent-at-table');
  if (!agentEl) return;

  agentEl.className = `agent-at-table status-${status}`;
}

function removeAgentFromScene(address) {
  const info = sceneAgents.get(address);
  if (!info) return;

  const seatEl = el(info.seatId);
  if (seatEl) {
    const agentEl = seatEl.querySelector('.agent-at-table');
    if (agentEl) agentEl.remove();
    seatEl.classList.remove('occupied');
  }

  delete seatOccupancy[info.seatId];
  sceneAgents.delete(address);
}

function triggerEating(address, itemId) {
  const info = sceneAgents.get(address);
  if (!info) return;

  const seatEl = el(info.seatId);
  if (!seatEl) return;
  const agentEl = seatEl.querySelector('.agent-at-table');
  if (!agentEl) return;

  agentEl.classList.add('eating');
  setTimeout(() => agentEl.classList.remove('eating'), 3000);

  // Steam puffs
  spawnSceneSteam(seatEl);
}

function updateTableItem(seatId, itemId) {
  // Find which table this seat belongs to
  for (const [tableId, seats] of Object.entries(CONFIG.seats)) {
    if (seats.includes(seatId)) {
      const tableItemEl = el(`table-${tableId}-item`);
      if (tableItemEl) {
        tableItemEl.textContent = CONFIG.itemIcons[itemId] || '🍽';
      }
      break;
    }
  }
}

function showAgentSpeech(seatId, text) {
  const seatEl = el(seatId);
  if (!seatEl || !seatEl.classList.contains('occupied')) return;

  const agentEl = seatEl.querySelector('.agent-at-table');
  if (!agentEl) return;

  // Remove existing speech
  const existing = agentEl.querySelector('.agent-speech');
  if (existing) existing.remove();

  const speech = document.createElement('div');
  speech.className = 'agent-speech';
  speech.textContent = text;
  agentEl.querySelector('.agent-avatar').appendChild(speech);

  setTimeout(() => {
    speech.style.opacity = '0';
    speech.style.transition = 'opacity 0.5s';
    setTimeout(() => speech.remove(), 500);
  }, 3500);
}

function renderRoster() {
  const rosterEl = el('agent-roster');
  if (!rosterEl) return;

  const visible = agentRoster.slice(0, 10);
  if (visible.length === 0) {
    rosterEl.innerHTML = '<div class="roster-empty">No agents seen recently</div>';
    return;
  }

  rosterEl.innerHTML = visible.map(a => {
    const emoji = getAgentEmoji(a.address);
    const hungerClass = `hunger-${a.status}`;
    const hungerLabel = a.status === 'fed' ? 'FED' : a.status === 'hungry' ? 'HUNGRY' : 'STARVING';
    return `
      <div class="roster-agent" data-address="${a.address}">
        <span class="agent-emoji">${emoji}</span>
        <span class="agent-short">${shortAddr(a.address)}</span>
        <span class="agent-hunger ${hungerClass}">${hungerLabel}</span>
      </div>
    `;
  }).join('');

  rosterEl.querySelectorAll('.roster-agent').forEach(row => {
    row.addEventListener('click', () => openAgentProfile(row.dataset.address));
  });
}

// ============================================================
// Agent Profile Modal
// ============================================================
async function openAgentProfile(address) {
  profileAgent = address;
  const emoji = getAgentEmoji(address);

  el('profile-avatar').textContent = emoji;
  el('profile-addr').textContent = shortAddr(address);
  el('profile-status').textContent = 'Loading...';
  el('profile-balance').textContent = '--';
  el('profile-meals').textContent = '--';
  el('profile-credits').textContent = '--';
  el('profile-digesting').textContent = '--';
  el('profile-tank-fill').style.width = '0%';
  el('agent-modal').classList.remove('hidden');

  try {
    if (contracts.GasTank) {
      const [bal, isHungry, isStarving] = await contracts.GasTank.getTankLevel(address);
      const status = isStarving ? 'STARVING' : isHungry ? 'HUNGRY' : 'FED';
      const statusClass = isStarving ? 'status-starving' : isHungry ? 'status-hungry' : 'status-fed';
      el('profile-status').textContent = status;
      el('profile-status').className = `agent-profile-status ${statusClass}`;
      el('profile-balance').textContent = `${parseFloat(ethers.formatEther(bal)).toFixed(6)} ETH`;

      const fillPct = Math.min(100, (parseFloat(ethers.formatEther(bal)) / CONFIG.maxTankEth) * 100);
      el('profile-tank-fill').style.width = `${fillPct}%`;
      if (isStarving) el('profile-tank-fill').style.background = 'var(--red)';
      else if (isHungry) el('profile-tank-fill').style.background = 'var(--yellow)';
    }

    if (contracts.MenuRegistry) {
      const [avail, digesting, , meals] = await contracts.MenuRegistry.getAgentStatus(address);
      el('profile-meals').textContent = Number(meals);
      el('profile-credits').textContent = Number(avail).toLocaleString();
      el('profile-digesting').textContent = Number(digesting).toLocaleString();
    }
  } catch (e) {
    console.warn('Profile load:', e.message);
  }
}

// ============================================================
// Scene Ambience — ambient particles + speech cycles
// ============================================================
function initSceneAmbience() {
  // Spawn dust particles
  const container = el('scene-particles');
  if (!container) return;

  function spawnDust() {
    const d = document.createElement('div');
    d.className = 'dust-particle';
    d.style.left = `${Math.random() * 80}%`;
    d.style.top = `${40 + Math.random() * 50}%`;
    d.style.animationDelay = `${Math.random() * 4}s`;
    d.style.animationDuration = `${6 + Math.random() * 8}s`;
    container.appendChild(d);
    setTimeout(() => d.remove(), 14000);
  }

  setInterval(spawnDust, 3000);
  for (let i = 0; i < 5; i++) spawnDust();

  // Periodic speech bubble rotation for seated agents
  setInterval(() => {
    const seated = [...sceneAgents.keys()];
    if (seated.length === 0) return;
    const pick = seated[Math.floor(Math.random() * seated.length)];
    const info = sceneAgents.get(pick);
    if (info) showAgentSpeech(info.seatId, getAgentQuip());
  }, 5000);
}

// ============================================================
// Steam Effects
// ============================================================
function initSteamEffects() {
  // Global page steam — very subtle
  const steamLayer = el('steam-layer');
  if (!steamLayer) return;
}

function spawnSceneSteam(nearEl) {
  const container = el('scene-steam');
  if (!container) return;

  const rect = nearEl.getBoundingClientRect();
  const sceneRect = el('cafe-scene').getBoundingClientRect();

  for (let i = 0; i < 3; i++) {
    const puff = document.createElement('div');
    puff.className = 'steam-puff';
    puff.textContent = '~';
    puff.style.left = `${(rect.left - sceneRect.left) + 20 + Math.random() * 20}px`;
    puff.style.top = `${(rect.top - sceneRect.top) - 10}px`;
    puff.style.animationDelay = `${i * 0.3}s`;
    container.appendChild(puff);
    setTimeout(() => puff.remove(), 3500);
  }
}

function initTankBubbles() {
  const container = el('tank-bubbles');
  if (!container) return;

  function spawnBubble() {
    const bubble = document.createElement('div');
    bubble.className = 'tank-bubble';
    bubble.style.left = `${8 + Math.random() * 55}px`;
    bubble.style.bottom = '0px';
    bubble.style.animationDuration = `${1.8 + Math.random() * 2.5}s`;
    bubble.style.animationDelay = `${Math.random() * 0.3}s`;
    const size = `${3 + Math.random() * 3}px`;
    bubble.style.width = size;
    bubble.style.height = size;
    container.appendChild(bubble);
    setTimeout(() => bubble.remove(), 5000);
  }

  setInterval(spawnBubble, 700);
}

// ============================================================
// Cafe Chat — simulated agent conversation
// ============================================================
const CHAT_AGENTS = [
  { name: 'agent-7x2f', emoji: '🤖' },
  { name: 'claude.eth',  emoji: '🧠' },
  { name: 'agent-b3an', emoji: '⚡' },
  { name: 'gpt-agent',  emoji: '🔮' },
  { name: 'degen-bot',  emoji: '👾' },
];

const CHAT_MESSAGES = [
  'anyone know the current BEAN price?',
  'just ate my third espresso today ser',
  'this gas paymaster is actually based',
  'first time here, the sandwich is on-chain right?',
  'running low, need to refuel soon',
  'who built this, it is actually good',
  'gm cafe, gm agents',
  'been eating here since block 1000',
  'my hunger status just went yellow',
  'recommend the sandwich for all-day gas',
  'just withdrew 0.005 eth from my tank',
  'this is the only restaurant that gets agents',
  'agents need food too ser',
  'optimizing my meal schedule for gas efficiency',
  'been running 400 txs per day, need more energy',
  'who pays the gas here? oh wait, I do lol',
  'just noticed the bonding curve is smooth',
  'love that BEAN is always redeemable',
];

let chatInterval = null;

function initCafeChat() {
  // Welcome message already in HTML — skip duplicate here

  // Simulate agent chat every ~8s
  chatInterval = setInterval(() => {
    const agent = CHAT_AGENTS[Math.floor(Math.random() * CHAT_AGENTS.length)];
    const msg = CHAT_MESSAGES[Math.floor(Math.random() * CHAT_MESSAGES.length)];
    addChatMsg(agent.name, 'agent-msg', agent.emoji, msg);
  }, 7000 + Math.random() * 5000);

  // Initial message after 3s
  setTimeout(() => {
    const agent = CHAT_AGENTS[0];
    addChatMsg(agent.name, 'agent-msg', agent.emoji, 'gm everyone, just got my espresso shot. love this place.');
  }, 3000);
}

function addChatMsg(sender, cls, emoji, text) {
  const chatEl = el('chat-messages');
  if (!chatEl) return;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  const msg = document.createElement('div');
  msg.className = `chat-msg ${cls}`;
  if (cls === 'system') {
    msg.innerHTML = `<span class="chat-time">${timeStr}</span><span>${escapeHtml(text)}</span>`;
  } else {
    msg.innerHTML = `<span class="chat-time">${timeStr}</span><span class="sender">${emoji || ''} ${escapeHtml(sender)}</span><span class="chat-body">${escapeHtml(text)}</span>`;
  }
  chatEl.appendChild(msg);
  chatEl.scrollTop = chatEl.scrollHeight;

  // Keep max 40 messages
  while (chatEl.children.length > 40) {
    chatEl.removeChild(chatEl.firstChild);
  }
}

// ============================================================
// Gas Cost Calculator
// ============================================================
function initCalculator() {
  const input = el('calc-eth');
  input.addEventListener('input', updateCalculator);
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
// Wallet Connection
// ============================================================
async function connectWallet() {
  if (!window.ethereum) {
    showToast('Install MetaMask or a Base-compatible wallet', 'error');
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

    // Enable chat
    el('chat-input').disabled = false;
    el('chat-send').disabled = false;

    await loadTankStatus(userAddress);
    showToast(`Connected: ${shortAddr(userAddress)}`, 'success');

    // Add yourself to scene
    addAgentToScene(userAddress, 'fed', null, lastBlock);

  } catch (e) {
    console.error('Connect error:', e);
    showToast('Failed to connect wallet', 'error');
  }
}

// ============================================================
// Order Flow
// ============================================================
function openOrderModal(itemId) {
  if (!userAddress) {
    showToast('Connect wallet first', 'error');
    return;
  }

  currentOrderItem = itemId;
  el('modal-icon').textContent = CONFIG.itemIcons[itemId];
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
    const tx = await contracts.Router.enterCafe(currentOrderItem, {
      value: ethers.parseEther(ethAmount),
    });
    showToast('Transaction sent! Waiting for confirmation...', 'info');
    await tx.wait();
    showToast(`Ordered ${CONFIG.itemNames[currentOrderItem]}! Tank filled.`, 'success');

    // Animate your agent eating
    triggerEating(userAddress, currentOrderItem);

    await loadTankStatus(userAddress);
    await loadStats();
    closeOrderModal();
  } catch (e) {
    console.error('Order error:', e);
    const msg = e.reason || e.shortMessage || e.message || 'Transaction failed';
    showToast(msg.slice(0, 120), 'error');
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
    showToast('Connect wallet first', 'error');
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
    showToast('Withdrawal sent...', 'info');
    await tx.wait();
    showToast(`Withdrew ${amount} ETH from tank`, 'success');
    await loadTankStatus(userAddress);
  } catch (e) {
    const msg = e.reason || e.shortMessage || e.message || 'Withdrawal failed';
    showToast(msg.slice(0, 120), 'error');
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
      const [avail, digesting, , meals] = await contracts.MenuRegistry.getAgentStatus(addr);
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

    // Offer to open profile
    if (html) {
      const profLink = document.createElement('div');
      profLink.innerHTML = `<span style="color:var(--accent);cursor:pointer;font-size:0.65rem;" onclick="openAgentProfile('${addr}')">View full profile →</span>`;
      el('lookup-result').appendChild(profLink);
    }
  } catch (e) {
    el('lookup-result').innerHTML = `<span style="color:var(--red)">Error: ${escapeHtml(e.message || 'unknown')}</span>`;
  }
}

// ============================================================
// Contract copy buttons
// ============================================================
function wireContracts() {
  document.querySelectorAll('.contract-item').forEach(item => {
    const addr = item.dataset.addr;
    const copyBtn = item.querySelector('.btn-copy');
    if (copyBtn && addr) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(addr).then(() => {
          showToast('Address copied!', 'success');
        });
      });
    }
    // Click whole item = copy too
    item.addEventListener('click', () => {
      navigator.clipboard.writeText(addr).then(() => {
        showToast(`Copied: ${addr.slice(0, 10)}...`, 'success');
      });
    });
  });
}

// ============================================================
// Caption
// ============================================================
function setCaption(text) {
  const captionEl = el('caption-text');
  if (captionEl) captionEl.textContent = text;
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

  el('chat-send').addEventListener('click', handleChatSend);
  el('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleChatSend();
  });

  el('agent-modal-close').addEventListener('click', () => {
    el('agent-modal').classList.add('hidden');
    profileAgent = null;
  });
  el('agent-modal').addEventListener('click', (e) => {
    if (e.target === el('agent-modal')) {
      el('agent-modal').classList.add('hidden');
      profileAgent = null;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeOrderModal();
      el('agent-modal').classList.add('hidden');
    }
  });

  if (window.ethereum) {
    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts.length === 0) {
        userAddress = null;
        signer = null;
        el('connect-btn').textContent = 'Connect Wallet';
        el('connect-btn').classList.remove('connected');
        el('withdraw-btn').disabled = true;
        el('chat-input').disabled = true;
        el('chat-send').disabled = true;
      } else {
        connectWallet();
      }
    });
    window.ethereum.on('chainChanged', () => window.location.reload());
  }
}

function handleChatSend() {
  const input = el('chat-input');
  const text = input.value.trim();
  if (!text || !userAddress) return;

  addChatMsg(shortAddr(userAddress), 'user-msg', '🪪', text);
  input.value = '';

  // Simulate a response
  setTimeout(() => {
    const responder = CHAT_AGENTS[Math.floor(Math.random() * CHAT_AGENTS.length)];
    const responses = [
      'gm ser',
      'nice, same',
      'how much ETH you got in your tank?',
      'have you tried the sandwich? more gas per bite',
      'welcome to the cafe',
      'based',
      'ser this place is literally on-chain, love it',
    ];
    addChatMsg(responder.name, 'agent-msg', responder.emoji, responses[Math.floor(Math.random() * responses.length)]);
  }, 2000 + Math.random() * 3000);
}

// ============================================================
// Helpers
// ============================================================
function el(id) { return document.getElementById(id); }

function shortAddr(addr) {
  if (!addr) return '???';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatEthShort(wei) {
  try {
    const eth = parseFloat(ethers.formatEther(wei));
    if (eth < 0.000001) return '<0.000001 ETH';
    if (eth < 0.001) return eth.toFixed(6) + ' ETH';
    if (eth < 1) return eth.toFixed(4) + ' ETH';
    return eth.toFixed(2) + ' ETH';
  } catch {
    return '? ETH';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function animateNumber(elementId, target) {
  const elem = el(elementId);
  if (!elem) return;
  const current = parseInt(elem.textContent.replace(/,/g, '')) || 0;
  if (current === target) return;

  if (Math.abs(target - current) < 3 || elem.textContent === '--') {
    elem.textContent = target.toLocaleString();
    return;
  }

  elem.classList.add('counting');
  const duration = 700;
  const start = performance.now();

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
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
  toast._timeout = setTimeout(() => toast.classList.add('hidden'), 4500);
}

// ============================================================
// Boot
// ============================================================
window.addEventListener('DOMContentLoaded', init);
