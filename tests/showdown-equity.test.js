const assert = require('assert');
const { calculateShowdownEquities } = require('../showdown-equity');

function card(rank, suit) { return { rank, suit }; }
function player(id, hand, overrides = {}) { return { id, hand, inHand: true, folded: false, ...overrides }; }

const lockedBoard = [card(14, '♠'), card(13, '♠'), card(12, '♠'), card(2, '♦'), card(3, '♣')];
const locked = calculateShowdownEquities([
  player('royal', [card(11, '♠'), card(10, '♠')]),
  player('pair', [card(14, '♥'), card(14, '♦')]),
  player('folded', [card(2, '♥'), card(2, '♠')], { folded: true })
], lockedBoard);
assert.equal(locked.length, 2, '폴드한 플레이어는 쇼다운 승률에서 제외해야 합니다.');
assert.deepEqual(locked.map(result => result.equity), [1, 0]);
assert.equal(locked.every(result => result.exact && result.samples === 1), true);

const tieBoard = [card(14, '♠'), card(13, '♠'), card(12, '♠'), card(11, '♠'), card(10, '♠')];
const tied = calculateShowdownEquities([
  player('a', [card(2, '♥'), card(3, '♦')]),
  player('b', [card(4, '♥'), card(5, '♦')])
], tieBoard);
assert.deepEqual(tied.map(result => result.equity), [0.5, 0.5]);
assert.deepEqual(tied.map(result => result.tieProbability), [1, 1]);

const flop = calculateShowdownEquities([
  player('a', [card(14, '♥'), card(14, '♦')]),
  player('b', [card(13, '♥'), card(13, '♦')])
], [card(2, '♠'), card(7, '♣'), card(9, '♥')]);
assert.equal(flop.every(result => result.exact && result.samples === 990), true, '플랍부터 가능한 턴·리버 990개를 정확 계산해야 합니다.');
assert.ok(Math.abs(flop.reduce((sum, result) => sum + result.equity, 0) - 1) < 0.00001);

const preflop = calculateShowdownEquities([
  player('a', [card(14, '♥'), card(14, '♦')]),
  player('b', [card(7, '♥'), card(2, '♦')])
], [], { iterations: 600, random: () => 0.37 });
assert.equal(preflop.every(result => !result.exact && result.samples === 600), true);
assert.ok(Math.abs(preflop.reduce((sum, result) => sum + result.equity, 0) - 1) < 0.00001);

console.log('Showdown equity tests passed: folded=hidden flop=exact runout=live.');
