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

function analyzePostflopHand(hand = [], board = []) {
  const unknown = {
    known: false, category: -1, pairTier: null, flushDraw: false, straightDraw: false,
    openEnded: false, overcards: 0, drawQuality: 0, blockerQuality: 0
  };
  if (!Array.isArray(hand) || hand.length !== 2 || !Array.isArray(board) || board.length < 3 || board.length > 5) return unknown;
  const cards = [...hand, ...board];
  if (new Set(cards.map(cardKey)).size !== cards.length) return unknown;
  const score = evaluateSeven(cards);
  const category = score[0];
  const boardRanks = [...new Set(board.map(card => card.rank))].sort((left, right) => right - left);
  let pairTier = null;

  if (category === 1) {
    const pairRank = score[1];
    const holeMatches = hand.filter(card => card.rank === pairRank).length;
    const boardMatches = board.filter(card => card.rank === pairRank).length;
    if (holeMatches === 2 && boardMatches === 0) pairTier = pairRank > boardRanks[0] ? 'overpair' : 'underpair';
    else if (holeMatches && boardMatches) {
      if (pairRank === boardRanks[0]) pairTier = 'top-pair';
      else if (pairRank === boardRanks[boardRanks.length - 1]) pairTier = 'bottom-pair';
      else pairTier = 'middle-pair';
    } else pairTier = 'board-pair';
  }

  const suitCounts = new Map();
  cards.forEach(card => suitCounts.set(card.suit, (suitCounts.get(card.suit) || 0) + 1));
  const flushSuit = [...suitCounts.entries()].sort((left, right) => right[1] - left[1])[0];
  const flushDraw = board.length < 5 && category < 5 && flushSuit?.[1] === 4 && hand.some(card => card.suit === flushSuit[0]);

  const ranks = new Set(cards.map(card => card.rank));
  if (ranks.has(14)) ranks.add(1);
  let fourCardWindows = 0;
  let openEnded = false;
  for (let high = 5; high <= 14; high += 1) {
    const window = Array.from({ length: 5 }, (_, index) => high - index);
    const present = window.filter(rank => ranks.has(rank));
    if (present.length !== 4) continue;
    fourCardWindows += 1;
    const missing = window.find(rank => !ranks.has(rank));
    if (missing !== window[0] && missing !== window[window.length - 1]) continue;
    const held = present.slice().sort((left, right) => left - right);
    if (held[0] > 1 && held[held.length - 1] < 14) openEnded = true;
  }
  const straightDraw = board.length < 5 && category < 4 && fourCardWindows > 0;
  const overcards = category === 0 ? hand.filter(card => card.rank > boardRanks[0]).length : 0;
  const drawQuality = flushDraw
    ? (hand.some(card => card.rank === 14 && card.suit === flushSuit[0]) ? 1 : 0.88)
    : straightDraw ? (openEnded || fourCardWindows > 1 ? 0.78 : 0.56)
      : overcards === 2 ? 0.3 : 0;

  const boardSuitCounts = new Map();
  board.forEach(card => boardSuitCounts.set(card.suit, (boardSuitCounts.get(card.suit) || 0) + 1));
  const blockedSuit = [...boardSuitCounts.entries()].sort((left, right) => right[1] - left[1])[0];
  let blockerQuality = 0;
  if (category < 5 && blockedSuit?.[1] >= 3) {
    const blocker = hand.filter(card => card.suit === blockedSuit[0]).sort((left, right) => right.rank - left.rank)[0];
    if (blocker?.rank === 14) blockerQuality = 1;
    else if (blocker?.rank === 13) blockerQuality = 0.78;
    else if (blocker?.rank === 12) blockerQuality = 0.58;
  }

  return { known: true, category, pairTier, flushDraw, straightDraw, openEnded, overcards, drawQuality, blockerQuality };
}

function marginalPairDefenseFrequency(context, profile, edge, potOdds) {
  const streetIndex = { flop: 0, turn: 1, river: 2 }[context.street] ?? 0;
  const bases = {
    'middle-pair': [0.58, 0.36, 0.16],
    'bottom-pair': [0.42, 0.23, 0.08],
    underpair: [0.3, 0.14, 0.045],
    'board-pair': [0.24, 0.1, 0.03]
  };
  const base = bases[profile.pairTier]?.[streetIndex];
  if (base === undefined) return null;
  const betToPot = context.needed / Math.max(1, context.pot - context.needed);
  const pressureAdjustment = -clamp((betToPot - 0.33) * 0.28, 0, 0.25);
  const priceAdjustment = clamp((0.25 - potOdds) * 0.7, -0.2, 0.15);
  const repeatedAggression = Math.max(0, Number(context.streetAggressionCount || 0) - 1) * 0.1
    + Math.max(0, Number(context.postflopAggressiveStreets || 0) - 1) * 0.055;
  const drawAdjustment = profile.drawQuality * 0.14;
  const positionAdjustment = context.inPosition ? 0.035 : -0.025;
  const equityAdjustment = clamp(edge * 0.65, -0.16, 0.1);
  return clamp(base + pressureAdjustment + priceAdjustment + drawAdjustment + positionAdjustment + equityAdjustment - repeatedAggression, 0.01, 0.92);
}

function postflopBluffFrequency(context, profile) {
  if (!profile.known || profile.category > 0) return 0;
  let frequency = 0;
  if (context.street === 'river') {
    frequency = profile.blockerQuality >= 0.75 ? 0.2 + profile.blockerQuality * 0.08 : 0.045;
  } else if (profile.drawQuality >= 0.85) frequency = 0.34;
  else if (profile.drawQuality >= 0.55) frequency = 0.25;
  else if (profile.overcards === 2) frequency = 0.13;
  else if (profile.blockerQuality >= 0.75) frequency = 0.1;
  if (context.hasInitiative) frequency += 0.07;
  if (context.inPosition) frequency += 0.045;
  else frequency -= 0.025;
  if (context.opponentCount > 1) frequency *= 0.45;
  return clamp(frequency, 0, 0.52);
}

function bluffRaiseFrequency(context, profile) {
  if (!profile.known || context.facingAllIn || context.opponentCount > 2) return 0;
  const candidateQuality = context.street === 'river' ? profile.blockerQuality : profile.drawQuality;
  if (candidateQuality < 0.55) return 0;
  let frequency = (context.street === 'river' ? 0.12 : 0.095) * candidateQuality;
  if (context.inPosition) frequency += 0.025;
  if (context.opponentCount > 1) frequency *= 0.45;
  frequency -= Math.max(0, Number(context.streetAggressionCount || 0) - 1) * 0.025;
  return clamp(frequency, 0, 0.18);
}

function valueBetMultiplier(profile) {
  if (!profile.known) return 1;
  if (profile.category >= 2) return 1;
  return { overpair: 0.9, 'top-pair': 0.7, 'middle-pair': 0.2, 'bottom-pair': 0.08 }[profile.pairTier] || 0;
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
  const profile = context.street === 'preflop' ? analyzePostflopHand() : analyzePostflopHand(context.hand, context.board);
  const pot = Math.max(0, context.pot);
  const needed = Math.max(0, context.needed);
  const potOdds = needed > 0 ? needed / Math.max(1, pot + needed) : 0;
  const allInCall = needed >= context.playerStack || Boolean(context.facingAllIn);
  const betPressure = needed / Math.max(context.bb, pot - needed);
  const preflopPenalty = context.street === 'preflop' && context.currentBet > context.bb
    ? clamp((context.currentBet / context.bb - 1) * 0.018, 0.025, 0.13)
    : 0;
  const postflopPressureScale = { flop: 0.075, turn: 0.1, river: 0.13 }[context.street] || 0;
  const postflopPenalty = context.street !== 'preflop' && needed > 0
    ? clamp(betPressure * postflopPressureScale, 0.02, 0.2)
    : 0;
  const aggressionPenalty = context.street !== 'preflop' && needed > 0
    ? clamp(Math.max(0, Number(context.streetAggressionCount || 0) - 1) * 0.035
      + Math.max(0, Number(context.postflopAggressiveStreets || 0) - 1) * 0.02, 0, 0.11)
    : 0;
  const rangePenalty = preflopPenalty + postflopPenalty + aggressionPenalty + (allInCall ? 0.035 : 0);
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
    const marginalDefense = marginalPairDefenseFrequency(context, profile, edge, potOdds);
    if (marginalDefense !== null) {
      const raiseFrequency = allInCall ? 0 : bluffRaiseFrequency(context, profile);
      const roll = random();
      if (roll < raiseFrequency) {
        return {
          ...raiseDecision(context, equity, true), equity, adjustedEquity, potOdds, requiredEquity, edge,
          reason: 'draw-blocker-raise'
        };
      }
      const action = roll < raiseFrequency + (1 - raiseFrequency) * marginalDefense ? 'call' : 'fold';
      return { action, equity, adjustedEquity, potOdds, requiredEquity, edge, reason: `${profile.pairTier}-defense` };
    }
    if (allInCall) {
      const callFrequency = clamp(0.5 + edge * 8, 0.015, 0.985);
      const action = random() < callFrequency ? 'call' : 'fold';
      return { action, equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'all-in-pot-odds' };
    }
    const canValueRaise = adjustedEquity > Math.max(0.58, requiredEquity + 0.2) && (!profile.known || profile.category >= 1);
    const valueRaiseFrequency = clamp((adjustedEquity - Math.max(0.58, requiredEquity + 0.2)) * 2.8 + 0.2, 0, 0.72);
    if (canValueRaise && random() < valueRaiseFrequency) {
        return { ...raiseDecision(context, equity), equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'value-raise' };
    }
    const candidateBluffRaiseFrequency = bluffRaiseFrequency(context, profile);
    if (random() < candidateBluffRaiseFrequency) {
      return {
        ...raiseDecision(context, equity, true), equity, adjustedEquity, potOdds, requiredEquity, edge,
        reason: context.street === 'river' ? 'blocker-bluff-raise' : 'semi-bluff-raise'
      };
    }
    if (edge <= -0.075) {
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
  const valueBetFrequency = strong
    ? clamp(0.42 + (equity - valueThreshold) * 1.7, 0.42, 0.9) * valueBetMultiplier(profile)
    : 0;
  const bluffFrequency = profile.known
    ? postflopBluffFrequency(context, profile)
    : weak ? (context.opponentCount === 1 ? (context.inPosition ? 0.14 : 0.09) : 0.035) : 0;

  if (context.isDonkOpportunity) {
    const wetness = boardWetness(context.board);
    const laterStreetLeadFrequency = context.street === 'flop'
      ? 0
      : wetness >= 0.62 ? 0.08 : 0.025;
    const polarizedLeadFrequency = strong
      ? laterStreetLeadFrequency * valueBetMultiplier(profile) * (equity >= 0.82 ? 1 : 0.35)
      : Math.max(profile.drawQuality, profile.blockerQuality) >= 0.55 ? laterStreetLeadFrequency * 0.24 : 0;
    if (random() < polarizedLeadFrequency) {
      return {
        ...raiseDecision(context, equity, !strong), equity, adjustedEquity, potOdds, requiredEquity, edge,
        reason: strong ? 'polarized-donk-value' : 'polarized-donk-bluff'
      };
    }
    return { action: 'call', equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'donk-range-check' };
  }

  const betRoll = random();
  if (betRoll < valueBetFrequency) {
    return { ...raiseDecision(context, equity), equity, adjustedEquity, potOdds, requiredEquity, edge, reason: 'value-bet' };
  }
  if (betRoll < valueBetFrequency + (1 - valueBetFrequency) * bluffFrequency) {
    return {
      ...raiseDecision(context, equity, true), equity, adjustedEquity, potOdds, requiredEquity, edge,
      reason: context.street === 'river' ? 'blocker-bluff' : 'semi-bluff'
    };
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
    return { ...decision, source: 'equity-gto-v3', approximate: true };
  }

  status() { return { version: 'equity-gto-v3', iterations: this.iterations, ...this.metrics }; }
}

module.exports = { EquityGtoBotEngine, estimateEquity, decisionFromEquity, analyzePostflopHand, evaluateSeven, compareScores };
