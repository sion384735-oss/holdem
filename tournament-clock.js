'use strict';

const BLIND_PATTERN = [100, 150, 200, 300, 400, 600, 800];

function tournamentBlindLevel(value) {
  const level = Math.max(0, Math.floor(Number(value) || 0));
  const cycle = Math.floor(level / BLIND_PATTERN.length);
  const smallBlind = BLIND_PATTERN[level % BLIND_PATTERN.length] * (10 ** cycle);
  return [smallBlind, smallBlind * 2];
}

function advanceTournamentClock(state, now, getBlindLevel = tournamentBlindLevel, minuteMs = 60000) {
  const level = Math.max(0, Math.floor(Number(state.level) || 0));
  const levelEndsAt = Number(state.levelEndsAt) || 0;
  const interval = Math.max(1, Math.floor(Number(state.blindUpMinutes) || 1)) * minuteMs;

  if (state.mode !== 'tournament' || !state.started || levelEndsAt <= 0 || now < levelEndsAt) {
    return null;
  }

  const elapsedLevels = 1 + Math.floor((now - levelEndsAt) / interval);
  const nextLevel = level + elapsedLevels;
  const [sb, bb] = getBlindLevel(nextLevel);

  return {
    level: nextLevel,
    sb,
    bb,
    advancedBy: elapsedLevels,
    levelEndsAt: levelEndsAt + elapsedLevels * interval
  };
}

module.exports = { advanceTournamentClock, tournamentBlindLevel };
