const assert = require('assert');
const {
  EquityGtoBotEngine, estimateEquity, decisionFromEquity, preflopHandProfile,
  analyzePostflopHand, evaluateSeven, compareScores
} = require('../gto-bot');

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

const preflopContext = {
  street: 'preflop', mode: 'cash', board: [], pot: 300, needed: 200,
  currentBet: 200, minRaise: 200, bb: 200, playerRoundBet: 0,
  playerStack: 10000, opponentCount: 5, position: 'UTG', inPosition: false,
  preflopRaiseCount: 0, limperCount: 0, effectiveStackBB: 50, facingAllIn: false
};
assert.equal(preflopHandProfile([card(14, '♠'), card(5, '♠')]).combo, 'A5s');
assert.equal(preflopHandProfile([card(13, '♠'), card(8, '♥')]).combo, 'K8o');
assert.equal(decisionFromEquity({ ...preflopContext, hand: [card(7, '♠'), card(2, '♥')] }, 0.22, () => 0).action, 'fold', 'UTG에서 72o를 사용하면 안 됩니다.');
assert.equal(decisionFromEquity({ ...preflopContext, hand: [card(14, '♠'), card(5, '♠')] }, 0.36, () => 0).action, 'raise', 'UTG의 A5s 혼합 오픈을 지원해야 합니다.');
assert.equal(decisionFromEquity({ ...preflopContext, position: 'BTN', inPosition: true, hand: [card(13, '♠'), card(8, '♥')] }, 0.42, () => 0).action, 'raise', '버튼에서는 K8o까지 오픈 범위를 넓혀야 합니다.');
assert.equal(decisionFromEquity({ ...preflopContext, position: 'BB', needed: 0, playerRoundBet: 200, hand: [card(8, '♠'), card(3, '♥')] }, 0.3, () => 0).action, 'call', '레이즈가 없으면 BB는 약한 패도 체크해야 합니다.');

const facingOpenContext = {
  ...preflopContext, pot: 900, needed: 600, currentBet: 600, position: 'BTN',
  preflopRaiseCount: 1, hand: [card(11, '♠'), card(4, '♥')]
};
assert.equal(decisionFromEquity(facingOpenContext, 0.32, () => 0).action, 'fold', 'J4o로 오픈 레이즈를 방어하면 안 됩니다.');
assert.equal(decisionFromEquity({ ...facingOpenContext, hand: [card(14, '♠'), card(13, '♥')] }, 0.66, () => 0).action, 'raise', 'AK는 오픈 레이즈에 밸류 3벳해야 합니다.');
assert.equal(decisionFromEquity({ ...facingOpenContext, preflopRaiseCount: 2, currentBet: 1800, needed: 1800, hand: [card(7, '♠'), card(6, '♠')] }, 0.38, () => 0).action, 'fold', '76s로 3벳을 따라가면 안 됩니다.');

const rangedAllInContext = {
  ...allInContext, hand: [card(14, '♠'), card(11, '♥')], position: 'BTN',
  preflopRaiseCount: 1, limperCount: 0, effectiveStackBB: 50
};
assert.equal(decisionFromEquity(rangedAllInContext, 0.52, () => 0).action, 'fold', '딥스택 올인을 AJo로 콜하면 안 됩니다.');
assert.equal(decisionFromEquity({ ...rangedAllInContext, hand: [card(13, '♠'), card(13, '♥')] }, 0.82, () => 0.99).action, 'call', 'KK는 딥스택 올인을 콜해야 합니다.');
assert.equal(decisionFromEquity({ ...rangedAllInContext, effectiveStackBB: 10, hand: [card(14, '♠'), card(11, '♠')] }, 0.59, () => 0).action, 'call', '10BB 올인은 AJs로 콜할 수 있어야 합니다.');

const checkedToContext = {
  street: 'flop', mode: 'cash', board: [card(14, '♠'), card(8, '♦'), card(2, '♣')],
  pot: 800, needed: 0, currentBet: 0, minRaise: 200, bb: 200,
  playerRoundBet: 0, playerStack: 9600, opponentCount: 1, inPosition: true, facingAllIn: false
};
assert.equal(decisionFromEquity(checkedToContext, 0.86, () => 0).action, 'raise', '강한 패는 체크를 받았을 때 밸류 베팅해야 합니다.');
assert.equal(decisionFromEquity(checkedToContext, 0.51, () => 0.99).action, 'call', '중간 패는 일정 빈도로 체크백해야 합니다.');

const flopDonkContext = {
  ...checkedToContext,
  inPosition: false,
  hasInitiative: false,
  isDonkOpportunity: true
};
const topPairDonkDecision = decisionFromEquity(flopDonkContext, 0.72, () => 0);
assert.equal(topPairDonkDecision.action, 'call', '정확한 솔버 정책이 없는 플랍에서 탑페어로 자동 동크벳하면 안 됩니다.');
assert.equal(topPairDonkDecision.reason, 'donk-range-check');

const checkedToTopPairDecision = decisionFromEquity({ ...flopDonkContext, isDonkOpportunity: false }, 0.72, () => 0);
assert.equal(checkedToTopPairDecision.action, 'raise', '이전 공격자가 체크한 뒤의 탑페어 밸류벳은 동크로 잘못 분류하면 안 됩니다.');

assert.equal(analyzePostflopHand(
  [card(8, '♥'), card(13, '♣')], [card(14, '♠'), card(8, '♦'), card(2, '♣')]
).pairTier, 'middle-pair');
assert.equal(analyzePostflopHand(
  [card(2, '♥'), card(13, '♣')], [card(14, '♠'), card(8, '♦'), card(2, '♣')]
).pairTier, 'bottom-pair');
assert.equal(analyzePostflopHand(
  [card(7, '♥'), card(7, '♣')], [card(14, '♠'), card(8, '♦'), card(2, '♣')]
).pairTier, 'underpair');

function actionCount(context, equity, samples, seed, action) {
  const random = seededRandom(seed);
  let count = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    if (decisionFromEquity(context, equity, random).action === action) count += 1;
  }
  return count;
}

const bottomPairFlop = {
  street: 'flop', mode: 'cash', hand: [card(2, '♥'), card(13, '♣')],
  board: [card(14, '♠'), card(8, '♦'), card(2, '♣')], pot: 1500, needed: 600,
  currentBet: 600, minRaise: 600, bb: 200, playerRoundBet: 0, playerStack: 9400,
  opponentCount: 1, inPosition: false, facingAllIn: false, streetAggressionCount: 1, postflopAggressiveStreets: 1
};
const bottomPairRiver = {
  ...bottomPairFlop, street: 'river', board: [...bottomPairFlop.board, card(11, '♠'), card(4, '♥')],
  postflopAggressiveStreets: 3
};
const bottomFlopCalls = actionCount(bottomPairFlop, 0.42, 2000, 90, 'call');
const bottomRiverCalls = actionCount(bottomPairRiver, 0.28, 2000, 91, 'call');
assert.ok(bottomFlopCalls > 400 && bottomFlopCalls < 900, `바텀페어 플랍 방어 빈도가 비정상입니다: ${bottomFlopCalls}/2000`);
assert.ok(bottomRiverCalls < 100, `여러 스트리트 압박을 받은 바텀페어가 리버까지 너무 자주 따라갑니다: ${bottomRiverCalls}/2000`);

const flushDrawContext = {
  ...checkedToContext,
  hand: [card(13, '♥'), card(12, '♥')],
  board: [card(14, '♠'), card(7, '♥'), card(2, '♥')],
  hasInitiative: true,
  isDonkOpportunity: false
};
const flushDrawProfile = analyzePostflopHand(flushDrawContext.hand, flushDrawContext.board);
assert.equal(flushDrawProfile.flushDraw, true);
const semiBluffs = actionCount(flushDrawContext, 0.46, 2000, 92, 'raise');
assert.ok(semiBluffs > 700 && semiBluffs < 1050, `플러시 드로 세미블러프 빈도가 부족하거나 과합니다: ${semiBluffs}/2000`);

const blockerBluffContext = {
  ...flushDrawContext,
  street: 'river',
  hand: [card(13, '♥'), card(12, '♣')],
  board: [card(14, '♠'), card(7, '♥'), card(2, '♥'), card(3, '♦'), card(9, '♥')]
};
const blockerProfile = analyzePostflopHand(blockerBluffContext.hand, blockerBluffContext.board);
assert.ok(blockerProfile.blockerQuality >= 0.75, '리버 플러시 블로커를 인식해야 합니다.');
const blockerBluffs = actionCount(blockerBluffContext, 0.18, 2000, 93, 'raise');
assert.ok(blockerBluffs > 550 && blockerBluffs < 900, `리버 블로커 블러프 빈도가 부족하거나 과합니다: ${blockerBluffs}/2000`);

const engine = new EquityGtoBotEngine({ iterations: 100 });
const engineDecision = engine.decide({
  ...checkedToContext,
  hand: [card(14, '♥'), card(14, '♦')],
  board: [card(14, '♠'), card(8, '♦'), card(2, '♣'), card(3, '♥'), card(4, '♠')]
}, seededRandom(7));
assert.equal(engineDecision.source, 'equity-gto-v4');
assert.equal(engine.status().decisions, 1);
assert.equal(engine.status()[`${engineDecision.action}s`], 1);

console.log(`PASS equity AA=${acesEquity.toFixed(3)} 72o=${sevenDeuceEquity.toFixed(3)} weak-all-in-calls=${weakCalls}/1000 strong-all-in-calls=${strongCalls}/1000 bottom-pair=${bottomFlopCalls}/2000→${bottomRiverCalls}/2000 semi-bluffs=${semiBluffs}/2000 blocker-bluffs=${blockerBluffs}/2000`);
