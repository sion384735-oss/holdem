'use strict';

const { evaluateSeven, compareScores } = require('./gto-bot');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function cardKey(card) { return `${card?.rank}${card?.suit}`; }

function unseenDeck(knownCards) {
  const known = new Set(knownCards.map(cardKey));
  const deck = [];
  SUITS.forEach(suit => RANKS.forEach(rank => {
    const card = { rank, suit };
    if (!known.has(cardKey(card))) deck.push(card);
  }));
  return deck;
}

function forEachCombination(items, count, callback, start = 0, chosen = []) {
  if (chosen.length === count) return callback(chosen);
  for (let index = start; index <= items.length - (count - chosen.length); index += 1) {
    chosen.push(items[index]);
    forEachCombination(items, count, callback, index + 1, chosen);
    chosen.pop();
  }
}

function calculateShowdownEquities(players, board = [], options = {}) {
  const contenders = (players || []).filter(player => player.inHand && !player.folded && Array.isArray(player.hand) && player.hand.length === 2);
  if (!contenders.length || !Array.isArray(board) || board.length > 5) return [];
  if (contenders.length === 1) {
    return [{ playerId: contenders[0].id, equity: 1, winProbability: 1, tieProbability: 0, samples: 1, exact: true }];
  }

  const knownCards = [...board, ...contenders.flatMap(player => player.hand)];
  if (new Set(knownCards.map(cardKey)).size !== knownCards.length) return [];
  const deck = unseenDeck(knownCards);
  const missingBoard = 5 - board.length;
  if (missingBoard > deck.length) return [];

  const totals = new Map(contenders.map(player => [player.id, { equity: 0, wins: 0, ties: 0 }]));
  let samples = 0;
  const scoreRunout = runout => {
    const finalBoard = [...board, ...runout];
    const scored = contenders.map(player => ({ player, score: evaluateSeven([...player.hand, ...finalBoard]) }));
    let best = scored[0].score;
    let winners = [scored[0]];
    for (const candidate of scored.slice(1)) {
      const comparison = compareScores(candidate.score, best);
      if (comparison > 0) { best = candidate.score; winners = [candidate]; }
      else if (comparison === 0) winners.push(candidate);
    }
    samples += 1;
    winners.forEach(({ player }) => {
      const total = totals.get(player.id);
      total.equity += 1 / winners.length;
      if (winners.length === 1) total.wins += 1;
      else total.ties += 1;
    });
  };

  const exact = missingBoard <= 2;
  if (exact) {
    forEachCombination(deck, missingBoard, scoreRunout);
  } else {
    const iterations = Math.max(500, Math.floor(Number(options.iterations) || 4000));
    const random = options.random || Math.random;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const sample = [...deck];
      for (let index = 0; index < missingBoard; index += 1) {
        const swap = index + Math.floor(Math.min(0.999999999, Math.max(0, Number(random()) || 0)) * (sample.length - index));
        [sample[index], sample[swap]] = [sample[swap], sample[index]];
      }
      scoreRunout(sample.slice(0, missingBoard));
    }
  }

  return contenders.map(player => {
    const total = totals.get(player.id);
    return {
      playerId: player.id,
      equity: Number((total.equity / samples).toFixed(6)),
      winProbability: Number((total.wins / samples).toFixed(6)),
      tieProbability: Number((total.ties / samples).toFixed(6)),
      samples,
      exact
    };
  });
}

module.exports = { calculateShowdownEquities };
