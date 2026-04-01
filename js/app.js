// Literature Card Game - Main Application
// Uses Firebase Realtime Database for real-time multiplayer

import FIREBASE_CONFIG from '../firebase-config.js';
import {
  HALF_SUITS, getHalfSuitId, getCardDisplay,
  dealCards, validateAsk, processAsk,
  validateClaim, processClaim,
  getAvailableHalfSuitsForClaim, isGameOver, getWinner,
  generateRoomCode, arrangePlayerOrder,
} from './engine.js';

// ===== FIREBASE SETUP =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase, ref, set, get, update, onValue, push, serverTimestamp, off,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import {
  getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const db = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();

// ===== APP STATE =====
let myPlayerId = null;
let myName = '';
let currentRoomCode = null;
let gameStateListener = null;
let handsListener = null;
let gameState = null;
let gameHands = {};

// ===== DOM REFS =====
const screens = {
  auth: document.getElementById('screen-auth'),
  home: document.getElementById('screen-home'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  ended: document.getElementById('screen-ended'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ===== UTILITIES =====
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).then(() => showToast('Room code copied!', 'success'))
    .catch(() => showToast(text, 'info'));
}

function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Merges private hand data into a local copy of gameState for engine functions
function getStateWithHands() {
  const state = JSON.parse(JSON.stringify(gameState));
  for (const [uid, hand] of Object.entries(gameHands)) {
    if (state.players[uid]) state.players[uid].hand = hand;
  }
  return state;
}

// ===== HOME SCREEN =====
document.getElementById('btn-create-game').addEventListener('click', async () => {
  const name = document.getElementById('input-name').value.trim();
  if (!name) return showToast('Please enter your name', 'error');

  const code = generateRoomCode();
  myName = name;

  const roomRef = ref(db, `games/${code}`);
  await set(roomRef, {
    status: 'lobby',
    hostId: myPlayerId,
    createdAt: serverTimestamp(),
    players: {
      [myPlayerId]: { name, team: 0, cardCount: 0, connected: true },
    },
    playerOrder: [],
    currentTurn: null,
    scores: [0, 0],
    claimedSets: {},
    log: [],
  });

  await set(ref(db, `users/${myPlayerId}/activeRoom`), code);
  currentRoomCode = code;
  joinRoom(code);
});

document.getElementById('btn-join-game').addEventListener('click', async () => {
  const name = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-room-code').value.trim().toUpperCase();
  if (!name) return showToast('Please enter your name', 'error');
  if (!code) return showToast('Please enter a room code', 'error');

  myName = name;

  // Check room exists
  const snapshot = await get(ref(db, `games/${code}`));
  if (!snapshot.exists()) return showToast('Room not found', 'error');

  const room = snapshot.val();
  if (room.status !== 'lobby') return showToast('Game already in progress', 'error');

  const players = room.players || {};
  const count = Object.keys(players).length;
  if (count >= 8) return showToast('Room is full', 'error');

  // Join team with fewer players
  const team0 = Object.values(players).filter(p => p.team === 0).length;
  const team1 = Object.values(players).filter(p => p.team === 1).length;
  const team = team0 <= team1 ? 0 : 1;

  await update(ref(db, `games/${code}/players/${myPlayerId}`), {
    name, team, cardCount: 0, connected: true,
  });

  await set(ref(db, `users/${myPlayerId}/activeRoom`), code);
  currentRoomCode = code;
  joinRoom(code);
});

// ===== JOIN ROOM (listen to state) =====
function joinRoom(code) {
  if (gameStateListener) off(ref(db, `games/${code}`), 'value', gameStateListener);
  if (handsListener) off(ref(db, `hands/${code}`), 'value', handsListener);

  gameStateListener = onValue(ref(db, `games/${code}`), snapshot => {
    if (!snapshot.exists()) return;
    gameState = snapshot.val();

    if (gameState.status === 'lobby') renderLobby(gameState);
    else if (gameState.status === 'playing') renderGame(gameState);
    else if (gameState.status === 'ended') renderEnded(gameState);
  });

  handsListener = onValue(ref(db, `hands/${code}`), snapshot => {
    gameHands = snapshot.val() || {};
    if (gameState?.status === 'playing') {
      renderHandPanel();
    }
  });
}

// ===== LOBBY =====
function renderLobby(state) {
  showScreen('lobby');

  document.getElementById('lobby-room-code').textContent = currentRoomCode;
  const isHost = state.hostId === myPlayerId;

  const players = state.players || {};
  const team0Players = Object.entries(players).filter(([, p]) => p.team === 0);
  const team1Players = Object.entries(players).filter(([, p]) => p.team === 1);

  document.getElementById('team0-list').innerHTML = renderPlayerItems(team0Players, players, isHost, 0, state.hostId);
  document.getElementById('team1-list').innerHTML = renderPlayerItems(team1Players, players, isHost, 1, state.hostId);

  const total = Object.keys(players).length;
  const t0 = team0Players.length;
  const t1 = team1Players.length;
  const canStart = isHost && (total === 6 || total === 8) && t0 === t1;

  const statusEl = document.getElementById('lobby-status');
  statusEl.textContent = canStart
    ? 'Ready to start!'
    : `${total}/6 or 8 players needed — teams must be equal`;

  const startBtn = document.getElementById('btn-start-game');
  startBtn.style.display = isHost ? 'block' : 'none';
  startBtn.disabled = !canStart;
}

function renderPlayerItems(entries, allPlayers, isHost, myTeam, hostId) {
  if (entries.length === 0) return '<li class="empty-state">No players yet</li>';
  return entries.map(([pid, p]) => {
    const isMe = pid === myPlayerId;
    const isHostPlayer = pid === hostId;
    const otherTeam = myTeam === 0 ? 1 : 0;
    const switchBtn = isMe
      ? `<button class="switch-team-btn" onclick="switchTeam('${pid}', ${otherTeam})">Switch →</button>`
      : '';
    return `
      <li class="player-item">
        <span class="name">${escapeHtml(p.name)}</span>
        ${isMe ? '<span class="you-badge">You</span>' : ''}
        ${isHostPlayer ? '<span class="host-badge">Host</span>' : ''}
        ${switchBtn}
      </li>`;
  }).join('');
}

window.switchTeam = async (pid, newTeam) => {
  await update(ref(db, `games/${currentRoomCode}/players/${pid}`), { team: newTeam });
};

document.getElementById('btn-copy-code').addEventListener('click', () => {
  copyToClipboard(currentRoomCode);
});

document.getElementById('btn-start-game').addEventListener('click', async () => {
  const players = gameState.players;
  const playerIds = Object.keys(players);

  const order = arrangePlayerOrder(players);
  const hands = dealCards(playerIds);

  const logKey = push(ref(db, `games/${currentRoomCode}/log`)).key;
  const rootUpdates = {
    [`games/${currentRoomCode}/playerOrder`]: order,
    [`games/${currentRoomCode}/currentTurn`]: order[0],
    [`games/${currentRoomCode}/status`]: 'playing',
    [`games/${currentRoomCode}/scores`]: [0, 0],
    [`games/${currentRoomCode}/claimedSets`]: {},
    [`games/${currentRoomCode}/log/${logKey}`]: {
      type: 'system',
      text: 'Game started! ' + Object.values(players).map(p => p.name).join(', ') + ' are playing.',
      time: formatTime(),
    },
  };
  for (const pid of playerIds) {
    rootUpdates[`games/${currentRoomCode}/players/${pid}/cardCount`] = hands[pid].length;
    rootUpdates[`hands/${currentRoomCode}/${pid}`] = hands[pid];
  }

  await update(ref(db, '/'), rootUpdates);
});

// ===== GAME SCREEN =====
function renderGame(state) {
  showScreen('game');

  const me = state.players?.[myPlayerId];
  if (!me) return;

  const isMyTurn = state.currentTurn === myPlayerId;
  const scores = state.scores || [0, 0];

  // Header
  document.getElementById('game-score-0').textContent = scores[0];
  document.getElementById('game-score-1').textContent = scores[1];

  const turnPlayer = state.players?.[state.currentTurn];
  const turnEl = document.getElementById('turn-indicator');
  if (turnPlayer) {
    turnEl.innerHTML = `Turn: <span class="turn-name">${escapeHtml(turnPlayer.name)}</span>${isMyTurn ? ' (You!)' : ''}`;
  }

  // Players panel
  renderPlayersPanel(state);

  // Hand panel
  renderHandPanel();

  // Action bar
  renderActionBar(state, me, isMyTurn);

  // Log
  renderLog(state);

  // Claimed sets in header area
  renderClaimedSets(state);
}

function renderPlayersPanel(state) {
  const players = state.players || {};
  const team0 = Object.entries(players).filter(([, p]) => p.team === 0);
  const team1 = Object.entries(players).filter(([, p]) => p.team === 1);

  const render = (entries) => entries.map(([pid, p]) => {
    const isTurn = state.currentTurn === pid;
    const isMe = pid === myPlayerId;
    return `
      <div class="player-row ${isTurn ? 'is-turn' : ''} ${isMe ? 'is-you' : ''}">
        ${isTurn ? '<span class="turn-arrow">▶</span>' : ''}
        <span class="p-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}</span>
        <span class="p-cards">${p.cardCount ?? 0}🃏</span>
      </div>`;
  }).join('');

  document.getElementById('game-team0-players').innerHTML = render(team0);
  document.getElementById('game-team1-players').innerHTML = render(team1);
}

function renderHandPanel() {
  const hand = gameHands[myPlayerId] || [];
  const container = document.getElementById('hand-container');

  if (hand.length === 0) {
    container.innerHTML = '<div class="empty-state">No cards in hand</div>';
    return;
  }

  // Group by half-suit
  const groups = {};
  for (const card of hand) {
    const hsId = getHalfSuitId(card);
    if (!groups[hsId]) groups[hsId] = [];
    groups[hsId].push(card);
  }

  container.innerHTML = Object.entries(groups).map(([hsId, cards]) => {
    const hs = HALF_SUITS[hsId];
    return `
      <div class="half-suit-group">
        <div class="half-suit-label">${hs.name}</div>
        <div class="cards-row">
          ${cards.map(card => renderCard(card)).join('')}
        </div>
      </div>`;
  }).join('');
}

function renderCard(card, options = {}) {
  const d = getCardDisplay(card);
  const classes = ['card', d.color, options.selectable ? 'selectable' : '', options.selected ? 'selected' : '', options.dimmed ? 'dimmed' : ''].filter(Boolean).join(' ');
  const attrs = options.onClick ? `onclick="${options.onClick}"` : '';
  const dataAttr = `data-card="${card}"`;
  return `
    <div class="${classes}" ${attrs} ${dataAttr} title="${d.fullName}">
      <div class="card-rank">${d.rank}</div>
      <div class="card-suit">${d.suitSymbol}</div>
      <div class="card-center">${d.suitSymbol}</div>
    </div>`;
}

function renderActionBar(state, me, isMyTurn) {
  const bar = document.getElementById('action-bar');
  if (isMyTurn) {
    const availableHS = getAvailableHalfSuitsForClaim(getStateWithHands(), myPlayerId);
    const myHand = gameHands[myPlayerId] || [];
    const hasCards = myHand.length > 0;

    // Check if there are valid opponents with cards to ask
    const hasValidOpponents = Object.values(state.players || {})
      .some(p => p.team !== me.team && p.cardCount > 0);

    const canAsk = hasCards && hasValidOpponents;

    if (!hasCards && availableHS.length === 0) {
      // No cards, nothing to declare — pass turn automatically
      bar.innerHTML = `
        <div class="your-turn-actions">
          <span style="color:var(--text-muted);font-size:0.9rem">You have no cards. Pass turn to continue.</span>
          <button class="btn btn-secondary" onclick="passMyTurn()">Pass Turn</button>
        </div>`;
    } else {
      bar.innerHTML = `
        <div class="your-turn-actions">
          <button class="btn btn-primary" onclick="openAskModal()"
            ${!canAsk ? 'disabled title="No cards to ask with or no opponents with cards"' : ''}>
            🃏 Ask for a Card
          </button>
          <button class="btn btn-secondary"
            onclick="openClaimModal()" ${availableHS.length === 0 ? 'disabled title="Your team has no cards in any half-suit"' : ''}>
            📣 Declare Half-Suit
          </button>
        </div>`;
    }
  } else {
    const turnPlayer = state.players?.[state.currentTurn];
    bar.innerHTML = `<div class="waiting-message">Waiting for ${escapeHtml(turnPlayer?.name || '...')} to play...</div>`;
  }
}

window.passMyTurn = async () => {
  // Find next player with cards
  const players = gameState.players;
  const order = gameState.playerOrder || Object.keys(players);
  const currentIdx = order.indexOf(myPlayerId);
  let nextTurn = null;
  for (let i = 1; i <= order.length; i++) {
    const nextId = order[(currentIdx + i) % order.length];
    if ((gameHands[nextId] || []).length > 0) { nextTurn = nextId; break; }
  }

  const updates = { currentTurn: nextTurn };
  const logRef = push(ref(db, `games/${currentRoomCode}/log`));
  updates[`log/${logRef.key}`] = {
    type: 'system', text: `${escapeHtml(players[myPlayerId].name)} has no cards — turn passes.`, time: formatTime(),
  };
  await update(ref(db, `games/${currentRoomCode}`), updates);
};

function renderLog(state) {
  const log = state.log || {};
  const entries = Array.isArray(log) ? log : Object.values(log);
  const container = document.getElementById('game-log');
  container.innerHTML = entries.slice(-50).reverse().map(entry => `
    <div class="log-entry ${entry.type || ''}">
      ${escapeHtml(entry.text || '')}
      <div class="log-time">${entry.time || ''}</div>
    </div>`).join('');
}

function renderClaimedSets(state) {
  const claimed = state.claimedSets || {};
  const container = document.getElementById('claimed-sets-display');
  const entries = Object.entries(claimed);
  if (entries.length === 0) {
    container.innerHTML = '<span style="font-size:0.75rem;color:var(--text-muted)">No sets claimed yet</span>';
    return;
  }
  container.innerHTML = entries.map(([hsId, team]) => {
    const hs = HALF_SUITS[hsId];
    const cls = team === -1 ? 'nullified' : `team-${team}`;
    const label = team === -1 ? `${hs.name} (✗)` : `${hs.name}`;
    return `<span class="set-chip ${cls}">${label}</span>`;
  }).join('');
}

// ===== ASK MODAL =====
let askState = { targetId: null, halfSuitId: null, card: null };

window.openAskModal = () => {
  askState = { targetId: null, halfSuitId: null, card: null };
  renderAskModal();
  document.getElementById('modal-ask').classList.add('active');
};

window.closeAskModal = () => {
  document.getElementById('modal-ask').classList.remove('active');
};

function renderAskModal() {
  const state = gameState;
  const me = state.players[myPlayerId];
  const myHand = gameHands[myPlayerId] || [];

  // Opponents (different team, has cards)
  const opponents = Object.entries(state.players)
    .filter(([pid, p]) => p.team !== me.team && p.cardCount > 0);

  document.getElementById('ask-opponent-select').innerHTML = `
    <div class="step-label">1. Choose an opponent to ask</div>
    <div class="player-select-grid">
      ${opponents.map(([pid, p]) => `
        <button class="player-select-btn ${askState.targetId === pid ? 'selected' : ''}"
          onclick="selectAskTarget('${pid}')">
          ${escapeHtml(p.name)} (${p.cardCount} cards)
        </button>`).join('')}
    </div>`;

  // Half-suits I have cards in
  const myHalfSuits = [...new Set(myHand.map(c => getHalfSuitId(c)))];
  const claimed = state.claimedSets || {};

  document.getElementById('ask-halfsuit-select').innerHTML = `
    <div class="step-label">2. Choose a half-suit (you must hold at least one card)</div>
    <div class="halfsuit-select-grid">
      ${myHalfSuits.map(hsId => {
        const hs = HALF_SUITS[hsId];
        const isClaimed = claimed[hsId] !== undefined;
        return `
          <button class="halfsuit-btn ${askState.halfSuitId === hsId ? 'selected' : ''}"
            onclick="selectAskHalfSuit('${hsId}')"
            ${isClaimed ? 'disabled' : ''}>
            ${hs.name}
          </button>`;
      }).join('')}
    </div>`;

  // Cards in selected half-suit that I don't have
  if (askState.halfSuitId) {
    const hs = HALF_SUITS[askState.halfSuitId];
    const askableCards = hs.cards.filter(c => !myHand.includes(c));
    document.getElementById('ask-card-select').innerHTML = `
      <div class="step-label">3. Choose the specific card to ask for</div>
      <div class="card-ask-grid">
        ${askableCards.map(card => {
          const d = getCardDisplay(card);
          return `
            <div class="card ${d.color} selectable ${askState.card === card ? 'selected' : ''}"
              onclick="selectAskCard('${card}')" title="${d.fullName}">
              <div class="card-rank">${d.rank}</div>
              <div class="card-suit">${d.suitSymbol}</div>
              <div class="card-center">${d.suitSymbol}</div>
            </div>`;
        }).join('')}
      </div>`;
  } else {
    document.getElementById('ask-card-select').innerHTML = '<div class="step-label">3. Choose a half-suit first</div>';
  }

  document.getElementById('btn-confirm-ask').disabled = !(askState.targetId && askState.halfSuitId && askState.card);
}

window.selectAskTarget = (pid) => { askState.targetId = pid; askState.card = null; renderAskModal(); };
window.selectAskHalfSuit = (hsId) => { askState.halfSuitId = hsId; askState.card = null; renderAskModal(); };
window.selectAskCard = (card) => { askState.card = card; renderAskModal(); };

document.getElementById('btn-confirm-ask').addEventListener('click', async () => {
  const { targetId, card } = askState;
  if (!targetId || !card) return;

  const stateWithHands = getStateWithHands();
  const validation = validateAsk(stateWithHands, myPlayerId, targetId, card);
  if (!validation.valid) return showToast(validation.reason, 'error');

  closeAskModal();

  const result = processAsk(stateWithHands, myPlayerId, targetId, card);

  const logKey = push(ref(db, `games/${currentRoomCode}/log`)).key;
  const rootUpdates = {
    [`games/${currentRoomCode}/currentTurn`]: result.currentTurn,
    [`games/${currentRoomCode}/log/${logKey}`]: { ...result.log, time: formatTime() },
  };
  for (const [pid, p] of Object.entries(result.players)) {
    rootUpdates[`games/${currentRoomCode}/players/${pid}/cardCount`] = p.cardCount;
    rootUpdates[`hands/${currentRoomCode}/${pid}`] = p.hand;
  }

  await update(ref(db, '/'), rootUpdates);

  if (result.hit) showToast(`Got it! You received the ${getCardDisplay(card).label}`, 'success');
  else showToast(`Not there. Turn passes.`, 'info');
});

// ===== CLAIM MODAL =====
let claimState = { halfSuitId: null, assignment: {} };

window.openClaimModal = () => {
  claimState = { halfSuitId: null, assignment: {} };
  renderClaimModal();
  document.getElementById('modal-claim').classList.add('active');
};

window.closeClaimModal = () => {
  document.getElementById('modal-claim').classList.remove('active');
};

function renderClaimModal() {
  const state = gameState;
  const availableHS = getAvailableHalfSuitsForClaim(getStateWithHands(), myPlayerId);
  const claimed = state.claimedSets || {};

  document.getElementById('claim-halfsuit-select').innerHTML = `
    <div class="step-label">1. Choose the half-suit to declare</div>
    <div class="halfsuit-select-grid">
      ${availableHS.map(hsId => {
        const hs = HALF_SUITS[hsId];
        return `
          <button class="halfsuit-btn ${claimState.halfSuitId === hsId ? 'selected' : ''}"
            onclick="selectClaimHalfSuit('${hsId}')">
            ${hs.name}
          </button>`;
      }).join('')}
    </div>`;

  if (claimState.halfSuitId) {
    const hs = HALF_SUITS[claimState.halfSuitId];
    const me = state.players[myPlayerId];
    const teammates = Object.entries(state.players)
      .filter(([, p]) => p.team === me.team);

    document.getElementById('claim-assignment').innerHTML = `
      <div class="step-label">2. Assign each card to the correct teammate</div>
      <div class="claim-assignment">
        ${hs.cards.map(card => {
          const d = getCardDisplay(card);
          const myHand = gameHands[myPlayerId] || [];
          const iHaveIt = myHand.includes(card);
          const selectedPid = claimState.assignment[card] || (iHaveIt ? myPlayerId : '');
          if (!claimState.assignment[card] && iHaveIt) claimState.assignment[card] = myPlayerId;

          return `
            <div class="claim-card-row">
              <span class="card-label" style="color:var(--card-${d.color})">${d.rank}${d.suitSymbol}</span>
              <select onchange="assignClaimCard('${card}', this.value)">
                <option value="">-- who has this? --</option>
                ${teammates.map(([pid, p]) => `
                  <option value="${pid}" ${selectedPid === pid ? 'selected' : ''}>
                    ${p.name}${pid === myPlayerId ? ' (you)' : ''}
                  </option>`).join('')}
              </select>
              ${iHaveIt ? '<span class="card-holder-hint">✓ you have it</span>' : ''}
            </div>`;
        }).join('')}
      </div>`;
  } else {
    document.getElementById('claim-assignment').innerHTML = '<div class="step-label">2. Choose a half-suit first</div>';
  }

  const allAssigned = claimState.halfSuitId &&
    HALF_SUITS[claimState.halfSuitId].cards.every(c => claimState.assignment[c]);
  document.getElementById('btn-confirm-claim').disabled = !allAssigned;
}

window.selectClaimHalfSuit = (hsId) => {
  claimState.halfSuitId = hsId;
  claimState.assignment = {};
  // Pre-fill cards I have
  for (const card of (gameHands[myPlayerId] || [])) {
    if (getHalfSuitId(card) === hsId) claimState.assignment[card] = myPlayerId;
  }
  renderClaimModal();
};

window.assignClaimCard = (card, pid) => {
  claimState.assignment[card] = pid || null;
  const allAssigned = claimState.halfSuitId &&
    HALF_SUITS[claimState.halfSuitId].cards.every(c => claimState.assignment[c]);
  document.getElementById('btn-confirm-claim').disabled = !allAssigned;
};

document.getElementById('btn-confirm-claim').addEventListener('click', async () => {
  const { halfSuitId, assignment } = claimState;

  const stateWithHands = getStateWithHands();
  const validation = validateClaim(stateWithHands, myPlayerId, halfSuitId, assignment);
  if (!validation.valid) return showToast(validation.reason, 'error');

  closeClaimModal();

  const result = processClaim(stateWithHands, myPlayerId, halfSuitId, assignment);

  const logKey = push(ref(db, `games/${currentRoomCode}/log`)).key;
  const rootUpdates = {
    [`games/${currentRoomCode}/scores`]: result.scores,
    [`games/${currentRoomCode}/claimedSets`]: result.claimedSets,
    [`games/${currentRoomCode}/currentTurn`]: result.currentTurn,
    [`games/${currentRoomCode}/status`]: result.status,
    [`games/${currentRoomCode}/log/${logKey}`]: { ...result.log, time: formatTime() },
  };
  for (const [pid, p] of Object.entries(result.players)) {
    rootUpdates[`games/${currentRoomCode}/players/${pid}/cardCount`] = p.cardCount;
    rootUpdates[`hands/${currentRoomCode}/${pid}`] = p.hand;
  }

  await update(ref(db, '/'), rootUpdates);

  const { correct, opponentHasCard } = result.claimResult;
  if (opponentHasCard) showToast('Claim failed — opponent had a card!', 'error');
  else if (correct) showToast('Correct! Your team scores!', 'success');
  else showToast('Wrong assignment — nullified!', 'error');
});

// ===== ENDED SCREEN =====
function renderEnded(state) {
  showScreen('ended');

  const scores = state.scores || [0, 0];
  const winner = getWinner(state);

  document.getElementById('game-score-0').textContent = scores[0];
  document.getElementById('game-score-1').textContent = scores[1];

  const winnerDisplay = document.getElementById('winner-display');
  const finalScore0 = document.getElementById('final-score-0');
  const finalScore1 = document.getElementById('final-score-1');

  finalScore0.textContent = scores[0];
  finalScore1.textContent = scores[1];

  if (winner === null) {
    winnerDisplay.className = 'winner-display tie';
    winnerDisplay.innerHTML = `<div class="trophy">🤝</div><h1>It's a Tie!</h1><p>${scores[0]} – ${scores[1]}</p>`;
  } else {
    const teamName = `Team ${winner + 1}`;
    winnerDisplay.className = `winner-display team-${winner}`;
    winnerDisplay.innerHTML = `<div class="trophy">🏆</div><h1>${teamName} Wins!</h1><p>${scores[winner]} – ${scores[1 - winner]}</p>`;
  }

  // Sets breakdown
  const claimed = state.claimedSets || {};
  const players = state.players || {};
  const breakdown = document.getElementById('sets-breakdown');
  breakdown.innerHTML = Object.entries(claimed).map(([hsId, team]) => {
    const hs = HALF_SUITS[hsId];
    const cls = team === -1 ? 'nullified' : `team-${team}`;
    const label = team === -1 ? 'Nullified' : `Team ${team + 1}`;
    return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.9rem">
      <span>${hs.name}</span>
      <span class="set-chip ${cls}">${label}</span>
    </div>`;
  }).join('');
}

document.getElementById('btn-play-again').addEventListener('click', async () => {
  if (myPlayerId) await set(ref(db, `users/${myPlayerId}/activeRoom`), null);
  showScreen('home');
  currentRoomCode = null;
  gameState = null;
});

// ===== HELPERS =====
function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== AUTH =====
document.getElementById('btn-google-signin').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged handles everything after sign-in
  } catch (e) {
    showToast('Sign in failed. Please try again.', 'error');
  }
});

document.getElementById('btn-sign-out').addEventListener('click', async () => {
  if (myPlayerId) await set(ref(db, `users/${myPlayerId}/activeRoom`), null);
  currentRoomCode = null;
  gameState = null;
  await signOut(auth);
  // onAuthStateChanged will show auth screen
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showScreen('auth');
    return;
  }

  myPlayerId = user.uid;
  myName = user.displayName || '';
  document.getElementById('input-name').value = myName;

  // Check if user has an active game in Firebase
  const activeRoomSnap = await get(ref(db, `users/${user.uid}/activeRoom`));
  const activeRoom = activeRoomSnap.val();

  if (activeRoom) {
    const gameSnap = await get(ref(db, `games/${activeRoom}`));
    if (gameSnap.exists()) {
      const state = gameSnap.val();
      if (state.players?.[user.uid] && state.status !== 'ended') {
        currentRoomCode = activeRoom;
        showToast(`Welcome back, ${myName}! Rejoining game...`, 'info');
        joinRoom(activeRoom);
        return;
      }
    }
    // Stale room — clear it
    await set(ref(db, `users/${user.uid}/activeRoom`), null);
  }

  showScreen('home');
});
