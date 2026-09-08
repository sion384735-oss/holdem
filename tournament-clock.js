'use strict';

function advanceTournamentClock(state, now, blindLevels, minuteMs = 60000) {
  const lastLevel = blindLevels.length - 1;
  const level = Math.min(lastLevel, Math.max(0, Math.floor(Number(state.level) || 0)));
  const levelEndsAt = Number(state.levelEndsAt) || 0;
  const interval = Math.max(1, Math.floor(Number(state.blindUpMinutes) || 1)) * minuteMs;

  if (state.mode !== 'tournament' || !state.started || level >= lastLevel || levelEndsAt <= 0 || now < levelEndsAt) {
    return null;
  }

  const elapsedLevels = 1 + Math.floor((now - levelEndsAt) / interval);
  const nextLevel = Math.min(lastLevel, level + elapsedLevels);
  const [sb, bb] = blindLevels[nextLevel];

  return {
    level: nextLevel,
    sb,
    bb,
    advancedBy: nextLevel - level,
    levelEndsAt: nextLevel >= lastLevel ? 0 : levelEndsAt + elapsedLevels * interval
  };
}

module.exports = { advanceTournamentClock };
