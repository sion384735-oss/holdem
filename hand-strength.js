'use strict';

const { evaluateSeven } = require('./gto-bot');

const HAND_NAMES = ['하이 카드', '원 페어', '투 페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
const RANK_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function describeCurrentHand(hand = [], board = []) {
  if (!Array.isArray(hand) || hand.length !== 2 || !Array.isArray(board)) return null;
  const cards = [...hand, ...board];
  if (cards.some(card => !card || !Number.isFinite(card.rank) || !card.suit)) return null;
  if (new Set(cards.map(card => `${card.rank}${card.suit}`)).size !== cards.length) return null;

  if (cards.length >= 5) {
    const score = evaluateSeven(cards);
    return HAND_NAMES[score?.[0]] || null;
  }

  if (hand[0].rank === hand[1].rank) return '원 페어';
  const high = Math.max(hand[0].rank, hand[1].rank);
  return `${RANK_NAMES[high] || high} 하이`;
}

module.exports = { describeCurrentHand };
