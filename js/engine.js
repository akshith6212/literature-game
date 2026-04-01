// Literature Card Game Engine - Pure game logic, no external dependencies

const HALF_SUITS = {
  'LS': { id: 'LS', name: 'Low Spades',    suit: 'S', high: false, cards: ['2S','3S','4S','5S','6S','7S'] },
  'HS': { id: 'HS', name: 'High Spades',   suit: 'S', high: true,  cards: ['9S','10S','JS','QS','KS','AS'] },
  'LH': { id: 'LH', name: 'Low Hearts',    suit: 'H', high: false, cards: ['2H','3H','4H','5H','6H','7H'] },
  'HH': { id: 'HH', name: 'High Hearts',   suit: 'H', high: true,  cards: ['9H','10H','JH','QH','KH','AH'] },
  'LD': { id: 'LD', name: 'Low Diamonds',  suit: 'D', high: false, cards: ['2D','3D','4D','5D','6D','7D'] },
  'HD': { id: 'HD', name: 'High Diamonds', suit: 'D', high: true,  cards: ['9D','10D','JD','QD','KD','AD'] },
  'LC': { id: 'LC', name: 'Low Clubs',     suit: 'C', high: false, cards: ['2C','3C','4C','5C','6C','7C'] },
  'HC': { id: 'HC', name: 'High Clubs',    suit: 'C', high: true,  cards: ['9C','10C','JC','QC','KC','AC'] },
};

const CARD_DISPLAY = {
  rank: { '2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','9':'9','10':'10','J':'J','Q':'Q','K':'K','A':'A' },
  suit: { 'S':'♠','H':'♥','D':'♦','C':'♣' },
  suitName: { 'S':'Spades','H':'Hearts','D':'Diamonds','C':'Clubs' },
  color: { 'S':'black','H':'red','D':'red','C':'black' },
};

function getCardSuit(card) {
  return card[card.length - 1];
}

function getCardRank(card) {
  return card.slice(0, -1);
}

function getHalfSuitId(card) {
  for (const [id, hs] of Object.entries(HALF_SUITS)) {
    if (hs.cards.includes(card)) return id;
  }
  return null;
}

function getCardDisplay(card) {
  const suit = getCardSuit(card);
  const rank = getCardRank(card);
  return {
    rank,
    suit,
    suitSymbol: CARD_DISPLAY.suit[suit],
    suitName: CARD_DISPLAY.suitName[suit],
    color: CARD_DISPLAY.color[suit],
    label: `${rank}${CARD_DISPLAY.suit[suit]}`,
    fullName: `${rank} of ${CARD_DISPLAY.suitName[suit]}`,
  };
}

function createDeck() {
  const deck = [];
  for (const hs of Object.values(HALF_SUITS)) {
    deck.push(...hs.cards);
  }
  return deck; // 48 cards
}

function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dealCards(playerIds) {
  const n = playerIds.length;
  if (n !== 6 && n !== 8) throw new Error('Must have 6 or 8 players');
  const deck = shuffleDeck(createDeck());
  const cardsPerPlayer = 48 / n;
  const hands = {};
  playerIds.forEach((id, i) => {
    hands[id] = deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer).sort();
  });
  return hands;
}

// Validate if a player can ask for a specific card
function validateAsk(gameState, askerId, targetId, card) {
  const players = gameState.players;
  const asker = players[askerId];
  const target = players[targetId];

  if (!asker || !target) return { valid: false, reason: 'Player not found' };
  if (gameState.currentTurn !== askerId) return { valid: false, reason: 'Not your turn' };
  if (asker.team === target.team) return { valid: false, reason: 'Cannot ask a teammate' };
  if ((target.hand || []).length === 0) return { valid: false, reason: 'Target has no cards' };
  if ((asker.hand || []).includes(card)) return { valid: false, reason: 'You already have this card' };

  const halfSuitId = getHalfSuitId(card);
  const askerHasHalfSuit = (asker.hand || []).some(c => getHalfSuitId(c) === halfSuitId);
  if (!askerHasHalfSuit) return { valid: false, reason: 'You have no cards in that half-suit' };

  const claimedSets = gameState.claimedSets || {};
  if (claimedSets[halfSuitId] !== undefined) return { valid: false, reason: 'That half-suit is already claimed' };

  return { valid: true };
}

// Process the result of an ask
function processAsk(gameState, askerId, targetId, card) {
  const players = JSON.parse(JSON.stringify(gameState.players));
  const targetHand = players[targetId].hand || [];
  const hasCard = targetHand.includes(card);

  if (hasCard) {
    // Transfer card
    players[targetId].hand = targetHand.filter(c => c !== card);
    players[askerId].hand = [...(players[askerId].hand || []), card].sort();
    players[targetId].cardCount = players[targetId].hand.length;
    players[askerId].cardCount = players[askerId].hand.length;
  }

  return {
    players,
    currentTurn: hasCard ? askerId : targetId, // hit = keep turn, miss = pass
    hit: hasCard,
    log: {
      type: hasCard ? 'hit' : 'miss',
      text: hasCard
        ? `${players[askerId].name} asked ${players[targetId].name} for ${getCardDisplay(card).label} — Got it!`
        : `${players[askerId].name} asked ${players[targetId].name} for ${getCardDisplay(card).label} — Not there. Turn passes.`,
    },
  };
}

// assignment: { [card]: playerId } for all 6 cards of the half-suit
function validateClaim(gameState, claimerId, halfSuitId, assignment) {
  const hs = HALF_SUITS[halfSuitId];
  if (!hs) return { valid: false, reason: 'Invalid half-suit' };
  if (gameState.currentTurn !== claimerId) return { valid: false, reason: 'Not your turn' };

  const claimedSets = gameState.claimedSets || {};
  if (claimedSets[halfSuitId] !== undefined) return { valid: false, reason: 'Already claimed' };

  const claimer = gameState.players[claimerId];

  // All assigned players must be on the same team as claimer
  for (const [card, pid] of Object.entries(assignment)) {
    if (!hs.cards.includes(card)) return { valid: false, reason: `Card ${card} not in this half-suit` };
    const player = gameState.players[pid];
    if (!player) return { valid: false, reason: `Player ${pid} not found` };
    if (player.team !== claimer.team) return { valid: false, reason: 'Can only assign to teammates' };
  }

  if (Object.keys(assignment).length !== 6) return { valid: false, reason: 'Must assign all 6 cards' };

  return { valid: true };
}

// Process a claim - returns result
function processClaim(gameState, claimerId, halfSuitId, assignment) {
  const hs = HALF_SUITS[halfSuitId];
  const players = JSON.parse(JSON.stringify(gameState.players));
  const claimer = players[claimerId];

  // Check if claim is correct
  let correct = true;
  let opponentHasCard = false;

  for (const [card, assignedPid] of Object.entries(assignment)) {
    const actualHolder = Object.keys(players).find(pid =>
      (players[pid].hand || []).includes(card)
    );

    if (!actualHolder) {
      // Card was already removed somehow - shouldn't happen
      correct = false;
      break;
    }

    const actualPlayer = players[actualHolder];
    if (actualPlayer.team !== claimer.team) {
      opponentHasCard = true;
      correct = false;
      break;
    }

    if (actualHolder !== assignedPid) {
      correct = false;
      // Don't break - check if opponent has any card
    }
  }

  // Double-check for opponent cards
  for (const card of hs.cards) {
    const actualHolder = Object.keys(players).find(pid =>
      (players[pid].hand || []).includes(card)
    );
    if (actualHolder && players[actualHolder].team !== claimer.team) {
      opponentHasCard = true;
      correct = false;
    }
  }

  // Remove cards from all hands
  for (const card of hs.cards) {
    for (const pid of Object.keys(players)) {
      players[pid].hand = (players[pid].hand || []).filter(c => c !== card);
      players[pid].cardCount = players[pid].hand.length;
    }
  }

  // Determine winner team
  let winningTeam;
  let resultText;
  if (opponentHasCard) {
    winningTeam = claimer.team === 0 ? 1 : 0; // opponent wins
    resultText = `${claimer.name} claimed ${hs.name} but opponent had a card — Opponent team scores!`;
  } else if (correct) {
    winningTeam = claimer.team;
    resultText = `${claimer.name} correctly claimed ${hs.name} — Team ${claimer.team + 1} scores!`;
  } else {
    winningTeam = null; // nullified
    resultText = `${claimer.name} claimed ${hs.name} with wrong assignment — Nullified! No one scores.`;
  }

  // Update scores
  const scores = [...(gameState.scores || [0, 0])];
  if (winningTeam !== null) scores[winningTeam]++;

  // Update claimed sets
  // Firebase doesn't store null — use -1 as sentinel for "nullified"
  const claimedSets = { ...(gameState.claimedSets || {}) };
  claimedSets[halfSuitId] = winningTeam === null ? -1 : winningTeam;

  // Determine next turn
  let nextTurn = getNextTurn(gameState, claimerId, players);

  // Check game over
  const gameOver = Object.keys(claimedSets).length === 8;

  return {
    players,
    scores,
    claimedSets,
    currentTurn: gameOver ? null : nextTurn,
    status: gameOver ? 'ended' : 'playing',
    claimResult: { correct, opponentHasCard, winningTeam, halfSuitId },
    log: {
      type: correct ? 'claim-success' : opponentHasCard ? 'claim-opponent' : 'claim-nullified',
      text: resultText,
    },
  };
}

function getNextTurn(gameState, currentPlayerId, updatedPlayers) {
  const players = updatedPlayers || gameState.players;
  const order = gameState.playerOrder || Object.keys(players);

  // Find next player with cards
  const currentIdx = order.indexOf(currentPlayerId);
  for (let i = 1; i <= order.length; i++) {
    const nextId = order[(currentIdx + i) % order.length];
    if ((players[nextId]?.hand || []).length > 0) return nextId;
  }
  return null;
}

function getTeamHalfSuits(gameState, team) {
  const claimedSets = gameState.claimedSets || {};
  return Object.entries(claimedSets)
    .filter(([, t]) => t === team) // -1 = nullified, 0 or 1 = team
    .map(([id]) => id);
}

function getAvailableHalfSuitsForClaim(gameState, playerId) {
  const player = gameState.players[playerId];
  if (!player) return [];

  const claimed = gameState.claimedSets || {};
  const myTeamIds = Object.keys(gameState.players)
    .filter(pid => gameState.players[pid].team === player.team);

  // Get all cards held by my team
  const myTeamCards = new Set();
  for (const pid of myTeamIds) {
    for (const card of (gameState.players[pid].hand || [])) {
      myTeamCards.add(card);
    }
  }

  const available = [];
  for (const [hsId, hs] of Object.entries(HALF_SUITS)) {
    if (claimed[hsId] !== undefined) continue;
    // My team must hold at least one card from this half-suit
    const myTeamHasAny = hs.cards.some(c => myTeamCards.has(c));
    if (myTeamHasAny) available.push(hsId);
  }
  return available;
}

function isGameOver(gameState) {
  const claimed = gameState.claimedSets || {};
  return Object.keys(claimed).length === 8;
}

function getWinner(gameState) {
  const [s0, s1] = gameState.scores || [0, 0];
  if (s0 > s1) return 0;
  if (s1 > s0) return 1;
  return null; // tie
}

// Generate a random 6-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Generate a unique player ID
function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
}

// Arrange players in alternating team order for dealing
function arrangePlayerOrder(players) {
  const team0 = Object.keys(players).filter(id => players[id].team === 0);
  const team1 = Object.keys(players).filter(id => players[id].team === 1);
  const order = [];
  const maxLen = Math.max(team0.length, team1.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < team0.length) order.push(team0[i]);
    if (i < team1.length) order.push(team1[i]);
  }
  return order;
}

export {
  HALF_SUITS,
  CARD_DISPLAY,
  getCardSuit,
  getCardRank,
  getHalfSuitId,
  getCardDisplay,
  createDeck,
  shuffleDeck,
  dealCards,
  validateAsk,
  processAsk,
  validateClaim,
  processClaim,
  getNextTurn,
  getTeamHalfSuits,
  getAvailableHalfSuitsForClaim,
  isGameOver,
  getWinner,
  generateRoomCode,
  generatePlayerId,
  arrangePlayerOrder,
};
