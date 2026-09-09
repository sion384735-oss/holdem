'use strict';

const { randomInt } = require('crypto');

function shuffleSeatOrder(players = [], pickIndex = randomInt) {
  const shuffled = [...players];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const picked = Math.floor(Number(pickIndex(index + 1)));
    const swapIndex = Math.min(index, Math.max(0, Number.isFinite(picked) ? picked : 0));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

module.exports = { shuffleSeatOrder };
