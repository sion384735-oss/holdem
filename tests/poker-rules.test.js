const assert = require('assert');
const { contestableRaiseTarget, uncalledExcess, buildPotLayers } = require('../poker-rules');

const deep = { id: 'deep', inHand: true, folded: false, stack: 9000, roundBet: 1000, totalBet: 1000 };
const short = { id: 'short', inHand: true, folded: false, stack: 1000, roundBet: 1000, totalBet: 1000 };
assert.equal(contestableRaiseTarget(deep, [deep, short], 10000), 2000);

assert.deepEqual(uncalledExcess([
  { id: 'deep', inHand: true, totalBet: 3000 },
  { id: 'short', inHand: true, totalBet: 2000 }
]), { playerId: 'deep', amount: 1000 });

const pots = buildPotLayers([
  { id: 'short', inHand: true, folded: false, totalBet: 1000 },
  { id: 'medium', inHand: true, folded: false, totalBet: 3000 },
  { id: 'deep', inHand: true, folded: false, totalBet: 3000 }
]);
assert.deepEqual(pots.map(pot => ({ label: pot.label, amount: pot.amount, eligibleIds: pot.eligibleIds })), [
  { label: 'MAIN POT', amount: 3000, eligibleIds: ['short', 'medium', 'deep'] },
  { label: 'SIDE POT 1', amount: 4000, eligibleIds: ['medium', 'deep'] }
]);

console.log('PASS effective-stack-cap=ok uncalled-return=ok main-side-pots=ok');
