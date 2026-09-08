const assert = require('assert');
const path = require('path');
const { GtoPolicyEngine, cardToSolverCode, nearestActionLabel } = require('../gto-policy');

const engine = new GtoPolicyEngine({ policyDir: path.join(__dirname, '..', 'gto', 'policies') });
assert.ok(engine.status().policyCount >= 1, '검증용 TexasSolver 정책을 불러와야 합니다.');
assert.equal(cardToSolverCode({ rank: 12, suit: '♠' }), 'Qs');
assert.equal(nearestActionLabel(['CALL', 'RAISE 7.000000', 'FOLD'], { action: 'RAISE', amount: 7 }, 1), 'RAISE 7.000000');

const rootContext = {
  street: 'flop',
  rootBoard: [{ rank: 12, suit: '♠' }, { rank: 8, suit: '♦' }, { rank: 7, suit: '♥' }],
  rootPot: 4,
  rootEffectiveStack: 10,
  playerCount: 2,
  actorRole: 'oop',
  hand: [{ rank: 11, suit: '♣' }, { rank: 10, suit: '♣' }],
  history: [],
  playerRoundBet: 0
};

const check = engine.decide(rootContext, () => 0);
assert.equal(check.source, 'texassolver');
assert.equal(check.solverAction, 'CHECK');
assert.equal(check.action, 'call', '게임 서버에서는 CHECK를 call 액션(필요 콜액 0)으로 표현합니다.');

const bet = engine.decide(rootContext, () => 0.99);
assert.equal(bet.solverAction, 'BET 2.000000');
assert.equal(bet.action, 'raise');
assert.equal(bet.raiseTarget, 2);
assert.ok(bet.probability > 0.84 && bet.probability < 0.86, 'JcTc의 solver BET 빈도는 약 85%여야 합니다.');

const ipAfterCheck = engine.decide({
  ...rootContext,
  actorRole: 'ip',
  hand: [{ rank: 10, suit: '♣' }, { rank: 9, suit: '♣' }],
  history: [{ kind: 'action', action: 'CHECK', amount: 0 }]
}, () => 0.9);
assert.equal(ipAfterCheck.solverAction, 'BET 2.000000');

const scaledBet = engine.decide({
  ...rootContext,
  rootPot: 400,
  rootEffectiveStack: 1000
}, () => 0.99);
assert.equal(scaledBet.raiseTarget, 200, 'solver-chip 단위를 현재 팟 비율에 맞춰 변환해야 합니다.');

const unsupported = engine.decide({ ...rootContext, rootBoard: ['As', 'Kd', '2c'] }, () => 0);
assert.equal(unsupported, null);
assert.equal(engine.status().hits, 4);
assert.equal(engine.status().fallbacks, 1);

console.log('PASS TexasSolver policy load=ok exact-combo=ok mixed-frequency=ok history-traversal=ok fallback=ok');
