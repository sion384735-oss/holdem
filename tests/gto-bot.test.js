const assert = require('assert');
const { EquityGtoBotEngine, estimateEquity, decisionFromEquity, evaluateSeven, compareScores } = require('../gto-bot');

function seededRandom(initialSeed) {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function card(rank, suit) { return { rank, suit }; }

const royalFlush = evaluateSeven([
  card(14, '♠'), card(13, '♠'), card(12, '♠'), card(11, '♠'), card(10, '♠'), card(2, '♦'), card(3, '♣')
]);
const fourOfAKind = evaluateSeven([
  card(9, '♠'), card(9, '♥'), card(9, '♦'), card(9, '♣'), card(14, '♠'), card(2, '♦'), card(3, '♣')
]);
assert.ok(compareScores(royalFlush, fourOfAKind) > 0, '스트레이트 플러시는 포카드보다 높아야 합니다.');

const acesEquity = estimateEquity({
  hand: [card(14, '♠'), card(14, '♥')], board: [], opponentCount: 1, iterations: 1000
}, seededRandom(1));
const sevenDeuceEquity = estimateEquity({
  hand: [card(7, '♠'), card(2, '♥')], board: [], opponentCount: 1, iterations: 1000
}, seededRandom(2));
assert.ok(acesEquity > 0.8, `AA 헤즈업 equity가 너무 낮습니다: ${acesEquity}`);
assert.ok(sevenDeuceEquity < 0.4, `72o 헤즈업 equity가 너무 높습니다: ${sevenDeuceEquity}`);
assert.ok(acesEquity - sevenDeuceEquity > 0.4);

const allInContext = {
  street: 'preflop', mode: 'cash', board: [], pot: 10400, needed: 9800,
  currentBet: 10000, minRaise: 9800, bb: 200, playerRoundBet: 200,
  playerStack: 9800, opponentCount: 1, inPosition: false, facingAllIn: true
};
const weakAllInDecision = decisionFromEquity(allInContext, 0.34, () => 0.5);
const strongAllInDecision = decisionFromEquity(allInContext, 0.85, () => 0.5);
assert.equal(weakAllInDecision.action, 'fold', '약한 패는 풀스택 올인을 자동 콜하면 안 됩니다.');
assert.equal(strongAllInDecision.action, 'call', '충분한 equity가 있는 패는 올인을 콜해야 합니다.');
assert.equal(weakAllInDecision.reason, 'all-in-pot-odds');

let weakCalls = 0;
let strongCalls = 0;
const weakRandom = seededRandom(31);
const strongRandom = seededRandom(32);
for (let sample = 0; sample < 1000; sample += 1) {
  if (decisionFromEquity(allInContext, 0.34, weakRandom).action === 'call') weakCalls += 1;
  if (decisionFromEquity(allInContext, 0.85, strongRandom).action === 'call') strongCalls += 1;
}
assert.ok(weakCalls < 40, `약한 패의 풀스택 올인 콜 빈도가 너무 높습니다: ${weakCalls}/1000`);
assert.ok(strongCalls > 950, `강한 패의 풀스택 올인 콜 빈도가 너무 낮습니다: ${strongCalls}/1000`);

const checkedToContext = {
  street: 'flop', mode: 'cash', board: [card(14, '♠'), card(8, '♦'), card(2, '♣')],
  pot: 800, needed: 0, currentBet: 0, minRaise: 200, bb: 200,
  playerRoundBet: 0, playerStack: 9600, opponentCount: 1, inPosition: true, facingAllIn: false
};
assert.equal(decisionFromEquity(checkedToContext, 0.86, () => 0).action, 'raise', '강한 패는 체크를 받았을 때 밸류 베팅해야 합니다.');
assert.equal(decisionFromEquity(checkedToContext, 0.51, () => 0.99).action, 'call', '중간 패는 일정 빈도로 체크백해야 합니다.');

const engine = new EquityGtoBotEngine({ iterations: 100 });
const engineDecision = engine.decide({
  ...checkedToContext,
  hand: [card(14, '♥'), card(14, '♦')],
  board: [card(14, '♠'), card(8, '♦'), card(2, '♣'), card(3, '♥'), card(4, '♠')]
}, seededRandom(7));
assert.equal(engineDecision.source, 'equity-gto-v1');
assert.equal(engine.status().decisions, 1);
assert.equal(engine.status()[`${engineDecision.action}s`], 1);

console.log(`PASS equity AA=${acesEquity.toFixed(3)} 72o=${sevenDeuceEquity.toFixed(3)} weak-all-in-calls=${weakCalls}/1000 strong-all-in-calls=${strongCalls}/1000 mixed-strategy=ok`);
