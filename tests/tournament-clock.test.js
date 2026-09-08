const assert = require('assert');
const { advanceTournamentClock, tournamentBlindLevel } = require('../tournament-clock');

function state(overrides = {}) {
  return {
    mode: 'tournament',
    started: true,
    level: 0,
    levelEndsAt: 60000,
    blindUpMinutes: 1,
    ...overrides
  };
}

assert.deepEqual(Array.from({ length: 10 }, (_, level) => tournamentBlindLevel(level)), [
  [100, 200], [150, 300], [200, 400], [300, 600], [400, 800],
  [600, 1200], [800, 1600], [1000, 2000], [1500, 3000], [2000, 4000]
], '첫 사이클 이후에도 같은 패턴으로 블라인드가 계속 올라야 합니다.');

assert.equal(advanceTournamentClock(state(), 59999), null, '종료 전에는 블라인드가 오르면 안 됩니다.');
assert.equal(advanceTournamentClock(state({ mode: 'cash' }), 60000), null, '캐시게임은 블라인드업이 없어야 합니다.');

assert.deepEqual(advanceTournamentClock(state(), 60000), {
  level: 1,
  sb: 150,
  bb: 300,
  advancedBy: 1,
  levelEndsAt: 120000
}, '타이머 종료 즉시 다음 레벨을 예약해야 합니다.');

assert.deepEqual(advanceTournamentClock(state(), 180000), {
  level: 3,
  sb: 300,
  bb: 600,
  advancedBy: 3,
  levelEndsAt: 240000
}, '서버가 늦게 깨어나면 빠진 레벨을 모두 따라잡아야 합니다.');

assert.deepEqual(advanceTournamentClock(state({ level: 7, levelEndsAt: 480000 }), 480000), {
  level: 8,
  sb: 1500,
  bb: 3000,
  advancedBy: 1,
  levelEndsAt: 540000
}, '기존 마지막 레벨을 지나서도 다음 레벨로 상승해야 합니다.');

console.log('Tournament blind clock tests passed with unlimited levels.');
