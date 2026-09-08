const assert = require('assert');
const { describeCurrentHand } = require('../hand-strength');

const card = (rank, suit) => ({ rank, suit });

assert.equal(describeCurrentHand([card(14, '♠'), card(13, '♦')]), 'A 하이');
assert.equal(describeCurrentHand([card(12, '♠'), card(12, '♦')]), '원 페어');
assert.equal(describeCurrentHand(
  [card(14, '♠'), card(13, '♦')],
  [card(14, '♥'), card(13, '♣'), card(2, '♠')]
), '투 페어');
assert.equal(describeCurrentHand(
  [card(10, '♥'), card(9, '♥')],
  [card(14, '♥'), card(13, '♥'), card(12, '♥'), card(11, '♥'), card(2, '♣')]
), '스트레이트 플러시');
assert.equal(describeCurrentHand([card(14, '♠'), card(14, '♠')]), null, '중복 카드는 잘못된 패로 처리해야 합니다.');

console.log('Current hand strength tests passed.');
