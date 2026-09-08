const assert = require('assert');
const { advanceTournamentClock } = require('../tournament-clock');

const LEVELS = [[100, 200], [150, 300], [200, 400], [300, 600]];

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

assert.equal(advanceTournamentClock(state(), 59999, LEVELS), null, '종료 전에는 블라인드가 오르면 안 됩니다.');
assert.equal(advanceTournamentClock(state({ mode: 'cash' }), 60000, LEVELS), null, '캐시게임은 블라인드업이 없어야 합니다.');

assert.deepEqual(advanceTournamentClock(state(), 60000, LEVELS), {
  level: 1,
  sb: 150,
  bb: 300,
  advancedBy: 1,
  levelEndsAt: 120000
}, '타이머 종료 즉시 다음 레벨을 예약해야 합니다.');

assert.deepEqual(advanceTournamentClock(state(), 180000, LEVELS), {
  level: 3,
  sb: 300,
  bb: 600,
  advancedBy: 3,
  levelEndsAt: 0
}, '서버가 늦게 깨어나면 빠진 레벨을 따라잡고 마지막 레벨에서 멈춰야 합니다.');

assert.equal(advanceTournamentClock(state({ level: 3, levelEndsAt: 0 }), 999999, LEVELS), null, '마지막 레벨에서 반복 상승하면 안 됩니다.');

console.log('Tournament blind clock tests passed.');
