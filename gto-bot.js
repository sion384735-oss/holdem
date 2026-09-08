const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function cardKey(card) { return `${card.rank}${card.suit}`; }

function makeDeck(excluded = []) {
  const blocked = new Set(excluded.map(cardKey));
  const deck = [];
  SUITS.forEach(suit => RANKS.forEach(rank => {
    const card = { rank, suit };
    if (!blocked.has(cardKey(card))) deck.push(card);
  }));
  return deck;
}

function evaluateFive(cards) {
  const ranks = cards.map(card => card.rank).sort((left, right) => right - left);
  const counts = new Map();
  ranks.forEach(rank => counts.set(rank, (counts.get(rank) || 0) + 1));
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((left, right) => right.count - left.count || right.rank - left.rank);
  const unique = [...new Set(ranks)];
  if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let index = 0; index <= unique.length - 5; index += 1) {
    if (unique[index] - unique[index + 4] === 4) straightHigh = Math.max(straightHigh, unique[index]);
  }
  const flush = cards.every(card => card.suit === cards[0].suit);
  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0].count === 4) return [7, groups[0].rank, groups[1].rank];
  if (groups[0].count === 3 && groups[1].count === 2) return [6, groups[0].rank, groups[1].rank];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0].count === 3) return [3, groups[0].rank, ...groups.slice(1).map(group => group.rank).sort((a, b) => b - a)];
  if (groups[0].count === 2 && groups[1].count === 2) {
    return [2, ...[groups[0].rank, groups[1].rank].sort((a, b) => b - a), groups[2].rank];
  }
  if (groups[0].count === 2) return [1, groups[0].rank, ...groups.slice(1).map(group => group.rank).sort((a, b) => b - a)];
  return [0, ...ranks];
}

function compareScores(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) - (right[index] || 0);
  }
  return 0;
}

function evaluateSeven(cards) {
  let best = null;
  for (let first = 0; first < cards.length - 4; first += 1) {
    for (let second = first + 1; second < cards.length - 3; second += 1) {
      for (let third = second + 1; third < cards.length - 2; third += 1) {
        for (let fourth = third + 1; fourth < cards.length - 1; fourth += 1) {
          for (let fifth = fourth + 1; fifth < cards.length; fifth += 1) {
            const score = evaluateFive([cards[first], cards[second], cards[third], cards[fourth], cards[fifth]]);
            if (!best || compareScores(score, best) > 0) best = score;
          }
        }
      }
    }
  }
  return best;
}

function estimateEquity({ hand, board = [], opponentCount = 1, iterations = 420 }, random = Math.random) {
  if (!Array.isArray(hand) || hand.length !== 2 || !Array.isArray(board) || board.length > 5) return 0;
  const known = [...hand, ...board];
  if (new Set(known.map(cardKey)).size !== known.length) return 0;
  const missingBoard = 5 - board.length;
  const deck = makeDeck(known);
  const opponents = Math.max(1, Math.min(9, Math.floor(opponentCount), Math.floor((deck.length - missingBoard) / 2)));
  const rounds = Math.max(40, Math.floor(iterations));
  const cardsNeeded = missingBoard + opponents * 2;
  let equity = 0;

  for (let round = 0; round < rounds; round += 1) {
    const sample = [...deck];
    for (let index = 0; index < cardsNeeded; index += 1) {
      const swap = index + Math.floor(clamp(random(), 0, 0.999999999) * (sample.length - index));
      [sample[index], sample[swap]] = [sample[swap], sample[index]];
    }
    const runout = [...board, ...sample.slice(0, missingBoard)];
    const heroScore = evaluateSeven([...hand, ...runout]);
    let bestScore = heroScore;
    let heroBest = true;
    let tiedWinners = 1;
    for (let opponent = 0; opponent < opponents; opponent += 1) {
      const offset = missingBoard + opponent * 2;
      const score = evaluateSeven([sample[offset], sample[offset + 1], ...runout]);
      const comparison = compareScores(score, bestScore);
      if (comparison > 0) {
        bestScore = score;
        heroBest = false;
        tiedWinners = 1;
      } else if (comparison === 0) {
        tiedWinners += 1;
      }
    }
    if (heroBest) equity += 1 / tiedWinners;
  }
  return equity / rounds;
}

function boardWetness(board = []) {
  if (board.length < 3) return 0.35;
  const suitCounts = new Map();
  board.forEach(card => suitCounts.set(card.suit, (suitCounts.get(card.suit) || 0) + 1));
  const maxSuit = Math.max(...suitCounts.values());
  const ranks = [...new Set(board.map(card => card.rank))].sort((a, b) => a - b);
  let closePairs = 0;
  for (let index = 1; index < ranks.length; index += 1) if (ranks[index] - ranks[index - 1] <= 2) closePairs += 1;
  return clamp((maxSuit >= 3 ? 0.5 : maxSuit === 2 ? 0.25 : 0) + closePairs * 0.14, 0, 1);
}

function raiseDecision(context, equity, bluff = false) {
  const maximum = context.playerRoundBet + context.playerStack;
  const minimum = context.currentBet === 0 ? context.bb : context.currentBet + context.minRaise;
  if (maximum <= context.currentBet) return { action: 'call' };
  const effectivePot = context.pot + context.needed;
  const wetness = boardWetness(context.board);
  let fraction = bluff ? (wetness > 0.55 ? 0.72 : 0.42) : (equity > 0.78 || wetness > 0.62 ? 0.72 : 0.38);
  if (context.street === 'preflop') {
    const limperChips = Math.max(0, context.pot - context.bb * 1.5);
    const openSize = context.bb * (context.inPosition ? 2.5 : 3) + limperChips * 0.75;
    const preflopTarget = context.currentBet > context.bb
      ? context.currentBet + Math.max(context.minRaise, effectivePot * 0.65)
      : openSize;
    const shortStackJam = context.playerStack <= context.bb * 11 && equity >= 0.62;
    return { action: 'raise', raiseTarget: Math.round(shortStackJam ? maximum : clamp(preflopTarget, minimum, maximum)) };
  }
  if (context.playerStack <= effectivePot * 1.15 && equity >= 0.7) fraction = 1.5;
  const target = context.currentBet === 0
    ? context.playerRoundBet + Math.max(context.bb, effectivePot * fraction)
    : context.currentBet + Math.max(context.minRaise, effectivePot * fraction);
  return { action: 'raise', raiseTarget: Math.round(clamp(target, minimum, maximum)) };
}

function decideUnopenedPreflop(context, equity, random) {
  const fairShare = 1 / (context.opponentCount + 1);
  const entryThreshold = fairShare + (context.inPosition ? 0.02 : 0.055) + Math.max(0, context.opponentCount - 2) * 0.006;
  const strengthEdge = equity - fairShare;
  if (context.needed === 0 && equity < entryThreshold) return { action: 'call' };
  if (equity < entryThreshold - 0.025) return { action: 'fold' };
  const openFrequency = clamp(0.5 + (equity - entryThreshold) * 6 + (context.inPosition ? 0.1 : 0), 0.12, 0.98);
  if (random() < openFrequency || strengthEdge > 0.2) return raiseDecision(context, equity);
  if (context.needed === 0 || (context.opponentCount === 1 && context.inPosition)) return { action: 'call' };
  return { action: 'fold' };
}

function decisionFromEquity(context, rawEquity, random = Math.random) {
  const equity = clamp(rawEquity, 0, 1);
  const pot = Math.max(0, context.pot);
  const needed = Math.max(0, context.needed);
  const potOdds = needed > 0 ? needed / Math.max(1, pot + needed) : 0;
  const allInCall = needed >= context.playerStack || Boolean(context.facingAllIn);
  const betPressure = needed / Math.max(context.bb, pot - needed);
  const preflopPenalty = context.street === 'preflop' && context.currentBet > context.bb
    ? clamp((context.currentBet / context.bb - 1) * 0.018, 0.025, 0.13)
    : 0;
  const postflopPenalty = context.street !== 'preflop' && needed > 0 ? clamp(betPressure * 0.055, 0.015, 0.11) : 0;
  const rangePenalty = preflopPenalty + postflopPenalty + (allInCall ? 0.035 : 0);
  const positionRealization = context.inPosition && !allInCall ? 0.012 : 0;
  const adjustedEquity = clamp(equity - rangePenalty + positionRealization, 0, 1);
  const riskPremium = (context.mode === 'tournament' ? 0.018 : 0.008) + (context.opponentCount > 1 ? 0.008 : 0);
  const requiredEquity = potOdds + riskPremium;
  const edge = adjustedEquity - requiredEquity;

  if (context.street === 'preflop' && context.currentBet <= context.bb) {
    const decision = decideUnopenedPreflop(context, equity, random);
    return { ...decision, equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'preflop-range' };
  }

  if (needed > 0) {
    if (allInCall) {
      const callFrequency = clamp(0.5 + edge * 8, 0.015, 0.985);
      const action = random() < callFrequency ? 'call' : 'fold';
      return { action, equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'all-in-pot-odds' };
    }
    const canValueRaise = adjustedEquity > Math.max(0.58, requiredEquity + 0.2);
    const valueRaiseFrequency = clamp((adjustedEquity - Math.max(0.58, requiredEquity + 0.2)) * 2.8 + 0.2, 0, 0.72);
    if (canValueRaise && random() < valueRaiseFrequency) {
      return { ...raiseDecision(context, equity), equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'value-raise' };
    }
    if (edge <= -0.075) {
      const bluffRaiseFrequency = context.opponentCount === 1 && context.inPosition ? 0.035 : 0.01;
      if (random() < bluffRaiseFrequency) {
        return { ...raiseDecision(context, equity, true), equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'polar-bluff' };
      }
      return { action: 'fold', equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'below-pot-odds' };
    }
    const continueFrequency = clamp(0.5 + edge * 6.5, 0.06, 0.96);
    const action = random() < continueFrequency ? 'call' : 'fold';
    return { action, equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'mixed-defense' };
  }

  const fairShare = 1 / (context.opponentCount + 1);
  const valueThreshold = fairShare + (1 - fairShare) * (context.opponentCount === 1 ? 0.14 : 0.2);
  const strong = equity >= valueThreshold;
  const weak = equity < fairShare * 0.72;
  const valueBetFrequency = strong ? clamp(0.42 + (equity - valueThreshold) * 1.7, 0.42, 0.9) : 0;
  const bluffFrequency = weak ? (context.opponentCount === 1 ? (context.inPosition ? 0.14 : 0.09) : 0.035) : 0;
  if (random() < valueBetFrequency) {
    return { ...raiseDecision(context, equity), equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'value-bet' };
  }
  if (random() < bluffFrequency) {
    return { ...raiseDecision(context, equity, true), equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'polar-bluff' };
  }
  return { action: 'call', equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'range-check' };
}

class EquityGtoBotEngine {
  constructor(options = {}) {
    this.iterations = Math.max(80, Number(options.iterations) || 420);
    this.metrics = { decisions: 0, folds: 0, calls: 0, raises: 0 };
  }

  decide(context, random = Math.random) {
    const equity = estimateEquity({
      hand: context.hand,
      board: context.board,
      opponentCount: context.opponentCount,
      iterations: this.iterations
    }, random);
    const decision = decisionFromEquity(context, equity, random);
    this.metrics.decisions += 1;
    this.metrics[`${decision.action}s`] += 1;
    return { ...decision, source: 'equity-gto-v1', approximate: true };
  }

  status() { return { version: 'equity-gto-v1', iterations: this.iterations, ...this.metrics }; }
}

module.exports = { EquityGtoBotEngine, estimateEquity, decisionFromEquity, evaluateSeven, compareScores };
