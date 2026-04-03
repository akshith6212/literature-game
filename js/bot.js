// Literature Card Game — Bot AI
import { HALF_SUITS, getHalfSuitId } from './engine.js';

// Fraction of game events each difficulty level retains in memory
const RETENTION = { easy: 0.3, medium: 0.6, hard: 1.0 };

// ===== KNOWLEDGE TRACKER =====
export class BotKnowledge {
  constructor(level) {
    this.level = level;
    this.retention = RETENTION[level] ?? 1.0;
    this.certain = {};   // card -> playerId  (we know exactly who has it)
    this.notWith = {};   // card -> Set<playerId>  (we know they don't have it)
  }

  _keeps() { return Math.random() < this.retention; }

  learn(card, playerId) {
    if (this._keeps()) this.certain[card] = playerId;
  }

  learnNot(card, playerId) {
    if (!this._keeps()) return;
    if (!this.notWith[card]) this.notWith[card] = new Set();
    this.notWith[card].add(playerId);
  }

  // Process a single ask log entry (needs askerId, targetId, card, hit metadata)
  processAsk({ askerId, targetId, card, hit }) {
    if (!askerId || !targetId || !card) return;
    if (hit) {
      // Asker now holds the card
      this.learn(card, askerId);
    } else {
      // Target confirmed not to have it
      this.learnNot(card, targetId);
    }
  }
}

// ===== DECISION ENGINE =====

// Returns a full declare assignment if bot can account for all 6 cards, else null
function tryBuildAssignment(hsId, state, botId, knowledge, botHand) {
  const hs = HALF_SUITS[hsId];
  const myTeam = state.players[botId].team;
  const teammateIds = Object.entries(state.players)
    .filter(([, p]) => p.team === myTeam)
    .map(([pid]) => pid);

  // If bot holds all 6 itself, trivial declare
  if (hs.cards.every(c => botHand.includes(c))) {
    return Object.fromEntries(hs.cards.map(c => [c, botId]));
  }

  const assignment = {};
  for (const card of hs.cards) {
    if (botHand.includes(card)) {
      assignment[card] = botId;
      continue;
    }
    const holder = knowledge.certain[card];
    if (holder && teammateIds.includes(holder)) {
      assignment[card] = holder;
    } else {
      return null; // Uncertain — don't risk a wrong declare
    }
  }
  return assignment;
}

// Main entry point — returns { type: 'ask'|'declare'|'pass', ...fields }
export function decideBotAction(state, botId, gameHands, knowledge) {
  const botHand = gameHands[botId] || [];
  if (botHand.length === 0) return { type: 'pass' };

  const claimed = state.claimedSets || {};
  const me = state.players[botId];
  const opponents = Object.entries(state.players)
    .filter(([pid, p]) => p.team !== me.team && (p.cardCount ?? 0) > 0)
    .map(([pid]) => pid);

  // Rank half-suits by how many cards the bot holds (prefer to work on richer suits)
  const myHalfSuits = [...new Set(botHand.map(c => getHalfSuitId(c)))]
    .filter(hsId => claimed[hsId] === undefined)
    .sort((a, b) =>
      botHand.filter(c => getHalfSuitId(c) === b).length -
      botHand.filter(c => getHalfSuitId(c) === a).length
    );

  // 1. Declare if we know the full picture for any half-suit
  for (const hsId of myHalfSuits) {
    const assignment = tryBuildAssignment(hsId, state, botId, knowledge, botHand);
    if (assignment) return { type: 'declare', halfSuitId: hsId, assignment };
  }

  if (opponents.length === 0) return { type: 'pass' };

  // 2. Certain ask — we know exactly which opponent has the card
  for (const hsId of myHalfSuits) {
    const hs = HALF_SUITS[hsId];
    for (const card of hs.cards) {
      if (botHand.includes(card)) continue;
      const holder = knowledge.certain[card];
      if (holder && opponents.includes(holder) && (state.players[holder]?.cardCount ?? 0) > 0) {
        return { type: 'ask', targetId: holder, card };
      }
    }
  }

  // 3. Smart ask — avoid opponents we know don't have the card
  for (const hsId of myHalfSuits) {
    const hs = HALF_SUITS[hsId];
    const askable = hs.cards.filter(card => {
      if (botHand.includes(card)) return false;
      return opponents.some(pid => !knowledge.notWith[card]?.has(pid));
    });
    if (askable.length === 0) continue;

    const card = askable[Math.floor(Math.random() * askable.length)];
    const viable = opponents.filter(
      pid => !knowledge.notWith[card]?.has(pid) && (state.players[pid]?.cardCount ?? 0) > 0
    );
    if (viable.length === 0) continue;

    return { type: 'ask', targetId: viable[Math.floor(Math.random() * viable.length)], card };
  }

  // 4. Last resort — fully random valid ask
  const hsId = myHalfSuits[0];
  if (!hsId) return { type: 'pass' };
  const hs = HALF_SUITS[hsId];
  const askable = hs.cards.filter(c => !botHand.includes(c));
  if (!askable.length) return { type: 'pass' };

  return {
    type: 'ask',
    targetId: opponents[Math.floor(Math.random() * opponents.length)],
    card: askable[Math.floor(Math.random() * askable.length)],
  };
}
