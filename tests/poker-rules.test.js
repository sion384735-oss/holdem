const assert = require('assert');
const { contestableRaiseTarget, uncalledExcess, buildPotLayers } = require('../poker-rules');

const deep = { id: 'deep', inHand: true, folded: false, roundBet: 200, totalBet: 200, stack: 9800 };
const short = { id: 'short', inHand: true, folded: false, roundBet: 200, totalBet: 200, stack: 1800 };
assert.equal(contestableRaiseTarget(deep, [deep, short], 10000), 2000, '딥스택 올인은 상대의 유효 스택까지만 팟에 들어가야 합니다.');

assert.deepEqual(uncalledExcess([
  { id: 'deep', inHand: true, totalBet: 5000 },
  { id: 'short', inHand: true, totalBet: 2000 }
]), { playerId: 'deep', amount: 3000 });

const pots = buildPotLayers([
  { id: 'short', inHand: true, folded: false, totalBet: 1000 },
  { id: 'middle', inHand: true, folded: false, totalBet: 3000 },
  { id: 'deep', inHand: true, folded: false, totalBet: 3000 }
]);
assert.deepEqual(pots.map(pot => ({ label: pot.label, amount: pot.amount, eligibleIds: pot.eligibleIds })), [
  { label: 'MAIN POT', amount: 3000, eligibleIds: ['short', 'middle', 'deep'] },
  { label: 'SIDE POT 1', amount: 4000, eligibleIds: ['middle', 'deep'] }
]);

console.log('PASS effective-stack-cap=ok uncalled-return=ok main-side-pots=ok');
