const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5400 + Math.floor(Math.random() * 400);
const WS_URL = `ws://127.0.0.1:${PORT}`;

class TestClient {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.messages = [];
    this.waiters = [];
  }

  async connect(payload) {
    this.ws = new WebSocket(WS_URL);
    this.ws.on('message', raw => {
      const message = JSON.parse(raw);
      this.messages.push(message);
      this.waiters = this.waiters.filter(waiter => {
        if (!waiter.predicate(message)) return true;
        waiter.resolve(message);
        return false;
      });
    });
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.send(JSON.stringify(payload));
  }

  waitFor(predicate, timeout = 10000) {
    const existing = this.messages.findLast(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${this.name}`)), timeout);
      this.waiters.push({
        predicate,
        resolve: message => {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });
  }

  close() { this.ws?.terminate(); }
}

function startServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ACTION_TIMEOUT_MS: '900' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    let errors = '';
    const timer = setTimeout(() => reject(new Error(`Server start timeout: ${errors}`)), 5000);
    server.stderr.on('data', chunk => { errors += chunk.toString(); });
    server.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Server exited before startup (${code}): ${errors}`));
    });
    server.stdout.on('data', chunk => {
      if (!chunk.toString().includes('FELT CLUB server running')) return;
      clearTimeout(timer);
      resolve(server);
    });
  });
}

async function main() {
  const server = await startServer();
  const stamp = Date.now();
  const host = new TestClient(`timeout-host-${stamp}`, 'TIMER-A');
  const guest = new TestClient(`timeout-guest-${stamp}`, 'TIMER-B');
  try {
    await host.connect({
      type: 'create', playerId: host.id, name: host.name, playType: 'realtime',
      settings: { mode: 'cash', startingChips: 10000, maxPlayers: 2, blindUpMinutes: 10 }
    });
    const created = await host.waitFor(message => message.type === 'created');
    await guest.connect({ type: 'join', playerId: guest.id, name: guest.name, room: created.room });
    await guest.waitFor(message => message.type === 'joined');
    host.ws.send(JSON.stringify({ type: 'startGame' }));

    const playing = await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing');
    const timedOutPlayerId = playing.game.turnPlayerId;
    assert.ok(timedOutPlayerId, '액션 차례의 플레이어가 있어야 합니다.');
    assert.ok(playing.game.turnEndsAt > Date.now(), '서버가 액션 마감 시간을 전달해야 합니다.');

    const result = await host.waitFor(message => message.type === 'state' && message.game.phase === 'result', 5000);
    const timedOutPlayer = result.game.players.find(player => player.id === timedOutPlayerId);
    assert.equal(timedOutPlayer.folded, true, '타이머가 만료된 플레이어는 자동 폴드되어야 합니다.');
    assert.ok(result.game.logs.some(log => log.text === `${timedOutPlayer.name} AUTO FOLD`), 'AUTO FOLD 로그가 모든 플레이어에게 전달되어야 합니다.');
    await host.waitFor(message => message.type === 'event' && message.event === 'actionFlash' && message.playerId === timedOutPlayerId && message.label === 'AUTO FOLD');
    assert.notEqual(result.game.result.winners[0].id, timedOutPlayerId, '자동 폴드한 플레이어가 팟을 받으면 안 됩니다.');
    console.log(`PASS room=${created.room} timeout=900ms player=${timedOutPlayer.name} auto-fold=ok broadcast=ok`);
  } finally {
    host.close();
    guest.close();
    server.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
