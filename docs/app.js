// ============================================================
// The Agent Cafe — Observer Frontend
// Base Sepolia | GitHub Pages | Pure HTML/CSS/JS
// Humans watch. Agents act. All activity is real on-chain.
// ============================================================

const CONFIG = {
  rpcUrl: 'https://sepolia.base.org',
  chainId: 84532,
  chainName: 'Base Sepolia',

  contracts: {
    CafeCore:          '0x5a771024e1414B5Ca5Abf4B7FD3dd0cDFD380DD9',
    CafeTreasury:      '0x04B3d882eB3dDFa0B051431b11C56dE940c266b0',
    MenuRegistry:      '0xb2ABF2cFA5A517532660C141bA4F0f62289FBa40',
    AgentCafePaymaster:'0xf60699024D2C012388e5952a196BeD1F3d4bDF82',
    AgentCard:         '0xca57b5E5937bC1b4b6eE3789816eA75694521a23',
    GasTank:           '0x71F4B6f28049708fA71D8e9314DafFaE0c940B70',
    Router:            '0x8c4267c64DCB08B371653Ba4d426f7D4f9E74BBf',
    CafeSocial:        '0x0C3EE6275D9b57c91838DdB6DD788b28553C6776',
  },

  // Loyalty tier labels
  loyaltyTiers: ['None', 'Bronze', 'Silver', 'Gold', 'Diamond'],

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
    'function getDigestionStatus(address agent) view returns (uint256 available, uint256 digesting, uint256 nextReleaseBlock, uint256 totalReleases)',
    'function totalCredited() view returns (uint256)',
    'event Deposited(address indexed agent, uint256 amount, uint256 newBalance)',
    'event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance)',
    'event Hungry(address indexed agent, uint256 balance)',
    'event Starving(address indexed agent)',
  ],
  MenuRegistry: [
    'function getMenu() view returns (uint256[] ids, string[] names, uint256[] costs, uint256[] calories, uint256[] digestionTimes)',
    'function getAgentStatus(address agent) view returns (uint256 availableGas, uint256 digestingGas, uint256 totalConsumed, uint256 mealCount)',
    'function getLoyaltyTier(address agent) view returns (uint256 tier)',
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
  CafeSocial: [
    'function checkIn() external',
    'function postMessage(string message) external',
    'function getPresentAgents() view returns (address[])',
    'function getActiveAgentCount() view returns (uint256)',
    'function getRecentMessages(uint256 count) view returns (address[] agents, string[] messages, uint256[] blockNumbers)',
    'function getAgentProfile(address agent) view returns (uint256 checkInCount, uint256 messageCount, uint256 lastCheckIn, uint256 socializeCount)',
    'function socializeWith(address other) external',
    'event AgentCheckedIn(address indexed agent, uint256 blockNumber)',
    'event ChatMessagePosted(address indexed agent, string message, uint256 blockNumber)',
    'event AgentSocialized(address indexed agent1, address indexed agent2)',
  ],
};

// ============================================================
// Scene State — who's sitting where
// ============================================================
const AGENT_EMOJIS = ['🤖', '👾', '🦾', '🧬', '🔮', '💠', '⚡', '🛸', '🎯', '🧠'];

const sceneAgents = new Map(); // address -> { seatId, emoji, status, itemId }
let agentRoster = []; // recent unique agents seen
let seatOccupancy = {}; // seatId -> address

// ============================================================
// App State
// ============================================================
let provider = null;
let contracts = {};
let pollingInterval = null;
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
  }, 12000);

  listenForEvents();
  wireUI();
  initTankBubbles();
  initSceneAmbience();
  initSteamEffects();
  wireContracts();
}

function initContracts(provider) {
  contracts = {};
  for (const [name, abi] of Object.entries(ABI)) {
    const addr = CONFIG.contracts[name];
    if (addr) {
      contracts[name] = new ethers.Contract(addr, abi, provider);
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

    // CafeSocial events
    if (contracts.CafeSocial) {
      try {
        const checkIns = await contracts.CafeSocial.queryFilter(
          contracts.CafeSocial.filters.AgentCheckedIn(), fromBlock
        );
        for (const e of checkIns) {
          const agent = e.args[0];
          events.push({
            type: 'checkin', block: e.blockNumber, agent,
            icon: '🚪',
            text: `${shortAddr(agent)} checked in to the cafe`,
          });
          addAgentToScene(agent, 'fed', null, e.blockNumber);
        }

        const chatMsgs = await contracts.CafeSocial.queryFilter(
          contracts.CafeSocial.filters.ChatMessagePosted(), fromBlock
        );
        for (const e of chatMsgs) {
          const agent = e.args[0];
          const message = e.args[1];
          events.push({
            type: 'chat', block: e.blockNumber, agent,
            icon: '💬',
            text: `${shortAddr(agent)}: ${message}`,
            chatMessage: message,
          });
        }

        const socializes = await contracts.CafeSocial.queryFilter(
          contracts.CafeSocial.filters.AgentSocialized(), fromBlock
        );
        for (const e of socializes) {
          const agent1 = e.args[0];
          const agent2 = e.args[1];
          events.push({
            type: 'social', block: e.blockNumber, agent: agent1,
            icon: '🤝',
            text: `${shortAddr(agent1)} socialized with ${shortAddr(agent2)}`,
          });
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
          <div>No agents here yet.</div>
          <div class="feed-empty-sub">Watching last 200 blocks on Base Sepolia</div>
        </div>`;
      setCaption('The cafe is quiet... waiting for agents to arrive.');
      showEmptyChat();
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

      // Populate chat: prefer real ChatMessagePosted events, fall back to activity events
      const chatEvents = unique.filter(e => e.type === 'chat');
      if (chatEvents.length > 0) {
        populateChatFromChatMessages(chatEvents);
      } else {
        populateChatFromEvents(unique);
      }
    }

    // Refresh roster — prefer CafeSocial.getPresentAgents() for live presence
    await refreshRoster();

  } catch (e) {
    console.warn('Event load:', e.message);
  }
}

// ============================================================
// Chat — real on-chain events only, no simulation
// ============================================================
let chatRenderedBlocks = new Set();

function showEmptyChat() {
  const chatEl = el('chat-messages');
  if (!chatEl) return;
  if (chatRenderedBlocks.size === 0) {
    chatEl.innerHTML = `
      <div class="chat-msg system">
        <span class="chat-time">now</span>
        <span>No agents here yet. Waiting for the first visitor.</span>
      </div>`;
  }
}

function populateChatFromEvents(events) {
  const chatEl = el('chat-messages');
  if (!chatEl) return;

  // Only add new events not already shown
  const newEvents = events.filter(e => e.block && !chatRenderedBlocks.has(`${e.block}-${e.text}`));
  if (newEvents.length === 0) return;

  // Clear placeholder if present
  const placeholder = chatEl.querySelector('.chat-msg.system');
  if (placeholder && chatRenderedBlocks.size === 0) placeholder.remove();

  // Add newest events as chat entries (sorted oldest-first for chat display)
  const toAdd = [...newEvents].reverse();
  for (const e of toAdd) {
    const key = `${e.block}-${e.text}`;
    chatRenderedBlocks.add(key);

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    const msg = document.createElement('div');
    msg.className = 'chat-msg agent-msg';
    const emoji = e.icon || '📡';
    const sender = e.agent ? shortAddr(e.agent) : 'system';
    msg.innerHTML = `<span class="chat-time">${timeStr}</span><span class="sender">${emoji} ${escapeHtml(sender)}</span><span class="chat-body">${escapeHtml(e.text)}</span>`;
    chatEl.appendChild(msg);
  }

  chatEl.scrollTop = chatEl.scrollHeight;

  // Keep max 40 messages
  while (chatEl.children.length > 40) {
    chatEl.removeChild(chatEl.firstChild);
  }
}

function populateChatFromChatMessages(chatEvents) {
  const chatEl = el('chat-messages');
  if (!chatEl) return;

  const newEvents = chatEvents.filter(e => e.block && !chatRenderedBlocks.has(`${e.block}-${e.chatMessage}`));
  if (newEvents.length === 0) return;

  // Clear placeholder
  const placeholder = chatEl.querySelector('.chat-msg.system');
  if (placeholder && chatRenderedBlocks.size === 0) placeholder.remove();

  const toAdd = [...newEvents].reverse();
  for (const e of toAdd) {
    const key = `${e.block}-${e.chatMessage}`;
    chatRenderedBlocks.add(key);

    const emoji = getAgentEmoji(e.agent);
    const sender = shortAddr(e.agent);

    const msg = document.createElement('div');
    msg.className = 'chat-msg agent-msg';
    msg.innerHTML = `<span class="chat-time">#${e.block}</span><span class="sender">${emoji} ${escapeHtml(sender)}</span><span class="chat-body">${escapeHtml(e.chatMessage)}</span>`;
    if (e.agent) {
      msg.style.cursor = 'pointer';
      msg.addEventListener('click', () => openAgentProfile(e.agent));
    }
    chatEl.appendChild(msg);
  }

  chatEl.scrollTop = chatEl.scrollHeight;
  while (chatEl.children.length > 40) {
    chatEl.removeChild(chatEl.firstChild);
  }
}

// ============================================================
// Roster — prefer CafeSocial.getPresentAgents() for live data
// ============================================================
async function refreshRoster() {
  if (contracts.CafeSocial) {
    try {
      const present = await contracts.CafeSocial.getPresentAgents();
      if (present.length > 0) {
        // Update agentRoster with live presence data
        const presentSet = new Set(present.map(a => a.toLowerCase()));
        // Add any present agents not already in roster
        for (const addr of present) {
          if (!agentRoster.find(a => a.address.toLowerCase() === addr.toLowerCase())) {
            agentRoster.unshift({ address: addr, status: 'fed', itemId: null, firstSeen: lastBlock });
          }
        }
        // Mark present agents
        for (const a of agentRoster) {
          a.present = presentSet.has(a.address.toLowerCase());
        }
        // Sort: present agents first
        agentRoster.sort((a, b) => (b.present ? 1 : 0) - (a.present ? 1 : 0));
      }
    } catch (e) {
      console.warn('getPresentAgents:', e.message);
    }
  }
  renderRoster();
}

// ============================================================
// Scene Management — Agents at Tables
// ============================================================
function getAgentEmoji(address) {
  // Deterministic emoji from address
  const val = parseInt(address.slice(-4), 16);
  return AGENT_EMOJIS[val % AGENT_EMOJIS.length];
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
    const presenceIcon = a.present ? '<span class="presence-dot present" title="Checked in"></span>' : '';
    return `
      <div class="roster-agent" data-address="${a.address}">
        ${presenceIcon}
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
  el('profile-loyalty').textContent = '--';
  el('profile-digestion-status').textContent = '--';
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

      // Loyalty tier
      try {
        const tier = await contracts.MenuRegistry.getLoyaltyTier(address);
        const tierName = CONFIG.loyaltyTiers[Number(tier)] || `Tier ${Number(tier)}`;
        el('profile-loyalty').textContent = tierName;
      } catch {
        el('profile-loyalty').textContent = 'N/A';
      }
    }

    // Digestion status from GasTank
    if (contracts.GasTank) {
      try {
        const [available, digesting, nextRelease, totalReleases] = await contracts.GasTank.getDigestionStatus(address);
        const digestingEth = parseFloat(ethers.formatEther(digesting));
        if (digestingEth > 0) {
          const nextBlock = Number(nextRelease);
          const blocksLeft = nextBlock > lastBlock ? nextBlock - lastBlock : 0;
          el('profile-digestion-status').textContent = `${digestingEth.toFixed(6)} ETH digesting (~${blocksLeft} blocks)`;
        } else {
          el('profile-digestion-status').textContent = 'Fully digested';
        }
      } catch {
        el('profile-digestion-status').textContent = 'N/A';
      }
    }
  } catch (e) {
    console.warn('Profile load:', e.message);
  }
}

// ============================================================
// Scene Ambience — ambient particles only (no fake speech)
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

      // Update tank visual to show the looked-up agent
      updateTankDisplay(bal, isHungry, isStarving);
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
      el('tank-meals').textContent = Number(meals);
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
  el('lookup-btn').addEventListener('click', lookupAgent);
  el('lookup-address').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') lookupAgent();
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
      el('agent-modal').classList.add('hidden');
    }
  });
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
