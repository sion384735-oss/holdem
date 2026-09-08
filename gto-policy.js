const fs = require('fs');
const path = require('path');

const SUIT_CODES = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const RANK_CODES = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function cardToSolverCode(card) {
  if (typeof card === 'string') return card;
  if (!card || !SUIT_CODES[card.suit]) return '';
  return `${RANK_CODES[card.rank] || card.rank}${SUIT_CODES[card.suit]}`;
}

function sameCards(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return [...left].sort().join(',') === [...right].sort().join(',');
}

function nearestActionLabel(actions, event, scale) {
  const action = String(event.action || '').toUpperCase();
  if (action === 'CHECK' || action === 'CALL' || action === 'FOLD') return actions.includes(action) ? action : null;
  if (action !== 'BET' && action !== 'RAISE') return null;
  const targetAmount = Number(event.amount) / scale;
  const candidates = actions.map(label => {
    const match = label.match(/^(BET|RAISE)\s+([\d.]+)$/);
    return match && match[1] === action ? { label, amount: Number(match[2]) } : null;
  }).filter(Boolean).sort((a, b) => Math.abs(a.amount - targetAmount) - Math.abs(b.amount - targetAmount));
  if (!candidates.length) return null;
  const distance = Math.abs(candidates[0].amount - targetAmount);
  return distance <= Math.max(0.25, candidates[0].amount * 0.15) ? candidates[0].label : null;
}

function traverseTree(root, history, scale) {
  let node = root;
  for (const event of history || []) {
    if (event.kind === 'deal') {
      if (node?.node_type !== 'chance_node') return null;
      node = node.dealcards?.[cardToSolverCode(event.card)];
    } else {
      if (node?.node_type !== 'action_node') return null;
      const label = nearestActionLabel(node.actions || [], event, scale);
      if (!label) return null;
      node = node.childrens?.[label];
    }
    if (!node) return null;
  }
  return node;
}

function normalizeProbabilities(values) {
  const cleaned = values.map(value => Math.max(0, Number(value) || 0));
  const total = cleaned.reduce((sum, value) => sum + value, 0);
  return total > 0 ? cleaned.map(value => value / total) : null;
}

class GtoPolicyEngine {
  constructor(options = {}) {
    this.policyDir = options.policyDir || path.join(__dirname, 'gto', 'policies');
    this.policies = [];
    this.metrics = { attempts: 0, hits: 0, fallbacks: 0 };
    this.lastError = null;
    this.reload();
  }

  reload() {
    this.policies = [];
    this.lastError = null;
    if (!fs.existsSync(this.policyDir)) return;
    for (const filename of fs.readdirSync(this.policyDir).filter(name => name.endsWith('.json')).sort()) {
      try {
        const policy = JSON.parse(fs.readFileSync(path.join(this.policyDir, filename), 'utf8'));
        if (policy.schemaVersion !== 1 || policy.source?.engine !== 'TexasSolver' || !policy.spot || !policy.tree) throw new Error('지원하지 않는 정책 형식');
        this.policies.push(policy);
      } catch (error) {
        this.lastError = `${filename}: ${error.message}`;
      }
    }
  }

  status() {
    return { policyCount: this.policies.length, ...this.metrics, error: this.lastError };
  }

  decide(context, random = Math.random) {
    this.metrics.attempts += 1;
    if (context.street === 'preflop' || !context.rootPot || !context.rootEffectiveStack || context.playerCount !== 2) {
      this.metrics.fallbacks += 1;
      return null;
    }
    const rootBoard = (context.rootBoard || []).map(cardToSolverCode);
    const pack = this.policies.find(policy => {
      if (policy.spot.street !== 'flop' || !sameCards(policy.spot.board, rootBoard)) return false;
      const scale = context.rootPot / policy.spot.pot;
      const expectedStack = policy.spot.effectiveStack * scale;
      return scale > 0 && Math.abs(expectedStack - context.rootEffectiveStack) <= Math.max(1, expectedStack * 0.05);
    });
    if (!pack) {
      this.metrics.fallbacks += 1;
      return null;
    }
    const scale = context.rootPot / pack.spot.pot;
    const node = traverseTree(pack.tree, context.history, scale);
    const expectedPlayer = context.actorRole === 'ip' ? 0 : 1;
    if (!node?.strategy?.strategy || node.player !== expectedPlayer) {
      this.metrics.fallbacks += 1;
      return null;
    }
    const cards = (context.hand || []).map(cardToSolverCode);
    const combo = `${cards[0] || ''}${cards[1] || ''}`;
    const reverseCombo = `${cards[1] || ''}${cards[0] || ''}`;
    const values = node.strategy.strategy[combo] || node.strategy.strategy[reverseCombo];
    const actions = node.strategy.actions || node.actions || [];
    if (!Array.isArray(values) || values.length !== actions.length) {
      this.metrics.fallbacks += 1;
      return null;
    }
    const probabilities = normalizeProbabilities(values);
    if (!probabilities) {
      this.metrics.fallbacks += 1;
      return null;
    }
    const roll = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
    let cumulative = 0;
    let index = probabilities.length - 1;
    for (let cursor = 0; cursor < probabilities.length; cursor += 1) {
      cumulative += probabilities[cursor];
      if (roll < cumulative) { index = cursor; break; }
    }
    const solverAction = actions[index];
    const match = solverAction.match(/^(BET|RAISE)\s+([\d.]+)$/);
    const decision = match
      ? { action: 'raise', raiseTarget: Math.round((context.playerRoundBet || 0) + Number(match[2]) * scale) }
      : { action: solverAction === 'FOLD' ? 'fold' : 'call' };
    this.metrics.hits += 1;
    return {
      ...decision,
      source: 'texassolver',
      policyId: pack.id,
      solverAction,
      probability: probabilities[index],
      approximate: false
    };
  }
}

module.exports = { GtoPolicyEngine, cardToSolverCode, nearestActionLabel };
