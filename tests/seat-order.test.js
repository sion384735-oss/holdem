const assert = require('assert');
const { shuffleSeatOrder } = require('../seat-order');

const players = [
  { id: 'host', isBot: false },
  { id: 'bot-1', isBot: true },
  { id: 'bot-2', isBot: true },
  { id: 'guest', isBot: false }
];
const picks = [0, 1, 0];
const shuffled = shuffleSeatOrder(players, limit => {
  const picked = picks.shift();
  assert.ok(picked >= 0 && picked < limit);
  return picked;
});

assert.deepEqual(players.map(player => player.id), ['host', 'bot-1', 'bot-2', 'guest'], '원본 참가자 배열을 변경하면 안 됩니다.');
assert.deepEqual(shuffled.map(player => player.id), ['bot-2', 'guest', 'bot-1', 'host'], '사람과 COM이 같은 좌석 순서 안에서 함께 섞여야 합니다.');
assert.deepEqual(new Set(shuffled.map(player => player.id)), new Set(players.map(player => player.id)), '섞은 뒤 참가자가 사라지거나 중복되면 안 됩니다.');

console.log('Random seat order tests passed.');
