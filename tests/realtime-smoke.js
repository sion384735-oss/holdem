const WebSocket = require('ws');
const assert = require('assert');

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:5050';

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
      if (message.type === 'state') this.state = message;
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
    this.send(payload);
  }

  send(payload) { this.ws.send(JSON.stringify(payload)); }

  waitFor(predicate, timeout = 10000) {
    const existing = this.messages.findLast(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for message (${this.name}) · ${JSON.stringify({ phase: this.state?.game.phase, turn: this.state?.game.turnPlayerId, logs: this.state?.game.logs?.slice(-5) })}`)), timeout);
      this.waiters.push({ predicate, resolve: message => { clearTimeout(timer); resolve(message); } });
    });
  }

  close() { this.ws?.close(); }
}

async function testRealtimeRoom() {
  const alpha = new TestClient(`alpha-${Date.now()}`, 'ALPHA');
  await alpha.connect({
    type: 'create', playerId: alpha.id, name: alpha.name, playType: 'realtime',
    settings: { mode: 'tournament', startingChips: 25000, maxPlayers: 10, blindUpMinutes: 3 }
  });
  const created = await alpha.waitFor(message => message.type === 'created');
  await alpha.waitFor(message => message.type === 'state' && message.room.code === created.room);
  assert.equal(created.room.length, 6);
  assert.equal(alpha.state.room.started, false);
  assert.equal(alpha.state.room.settingsLocked, false);
  assert.equal(alpha.state.room.startingChips, 25000);
  assert.equal(alpha.state.room.blindUpMinutes, 3);

  const bravo = new TestClient(`bravo-${Date.now()}`, 'BRAVO');
  await bravo.connect({ type: 'join', playerId: bravo.id, name: bravo.name, room: created.room });
  await bravo.waitFor(message => message.type === 'joined');
  await alpha.waitFor(message => message.type === 'state' && message.game.players.filter(player => player.connected).length === 2);
  assert.equal(alpha.state.room.started, false, '두 번째 참가자 입장만으로 자동 시작되면 안 됩니다.');

  const extraPlayers = Array.from({ length: 8 }, (_, index) => new TestClient(`guest-${index}-${Date.now()}`, `GUEST${index + 1}`));
  await Promise.all(extraPlayers.map(async player => {
    await player.connect({ type: 'join', playerId: player.id, name: player.name, room: created.room });
    await player.waitFor(message => message.type === 'joined');
  }));
  await alpha.waitFor(message => message.type === 'state' && message.game.players.filter(player => player.connected).length === 10);
  assert.equal(alpha.state.game.players.length, 10, '한 테이블에 10명이 입장할 수 있어야 합니다.');

  const overflow = new TestClient(`overflow-${Date.now()}`, 'OVERFLOW');
  await overflow.connect({ type: 'join', playerId: overflow.id, name: overflow.name, room: created.room });
  await overflow.waitFor(message => message.type === 'error' && message.message.includes('가득 찼습니다'));
  overflow.close();

  alpha.send({ type: 'startGame' });
  const playing = await alpha.waitFor(message => message.type === 'state' && message.room.settingsLocked && message.game.phase === 'playing');
  await Promise.all([bravo, ...extraPlayers].map(player => player.waitFor(message => message.type === 'state' && message.room.settingsLocked && message.game.phase === 'playing')));
  assert.equal(alpha.state.room.mode, 'tournament');
  assert.equal(alpha.state.game.players.every(player => player.stack <= 25000), true);
  assert.equal(playing.game.players.find(player => player.id === alpha.id).hand.length, 2);
  assert.equal(playing.game.players.filter(player => player.id !== alpha.id).every(player => player.hand === null), true);

  alpha.send({ type: 'settings', settings: { mode: 'cash', startingChips: 9999, maxPlayers: 10, blindUpMinutes: 1 } });
  const lockError = await alpha.waitFor(message => message.type === 'error' && message.message.includes('변경할 수 없습니다'));
  assert.ok(lockError);
  assert.equal(alpha.state.room.mode, 'tournament');
  assert.equal(alpha.state.room.startingChips, 25000);

  alpha.close();
  bravo.close();
  extraPlayers.forEach(player => player.close());
  return created.room;
}

async function testComRoom() {
  const hero = new TestClient(`hero-${Date.now()}`, 'HERO');
  await hero.connect({
    type: 'create', playerId: hero.id, name: hero.name, playType: 'com',
    settings: { mode: 'cash', startingChips: 15000, maxPlayers: 3, botCount: 2, blindUpMinutes: 10 }
  });
  const created = await hero.waitFor(message => message.type === 'created');
  await hero.waitFor(message => message.type === 'state' && message.room.code === created.room && message.game.players.length === 3);
  assert.equal(hero.state.game.players.filter(player => player.isBot).length, 2);
  assert.equal(hero.state.room.startingChips, 15000);

  hero.send({ type: 'startGame' });
  const playing = await hero.waitFor(message => message.type === 'state' && message.room.settingsLocked && message.game.phase === 'playing');
  const heroView = playing.game.players.find(player => player.id === hero.id);
  const bots = playing.game.players.filter(player => player.isBot);
  assert.equal(heroView.hand.length, 2);
  assert.equal(bots.every(bot => bot.hand === null), true);
  assert.equal(playing.room.playType, 'com');
  const botActed = () => hero.state?.game.logs.some(log => /^(NOVA|MINT) (CALL|CHECK|FOLD|RAISE|ALL-IN)/.test(log.text));
  const deadline = Date.now() + 10000;
  while (!botActed() && Date.now() < deadline) {
    if (hero.state?.game.turnPlayerId === hero.id) hero.send({ type: 'action', action: 'call' });
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.equal(botActed(), true, 'COM 플레이어가 자동으로 액션해야 합니다.');
  hero.close();
  return created.room;
}

async function run() {
  const realtimeRoom = await testRealtimeRoom();
  const comRoom = await testComRoom();
  console.log(`PASS realtime=${realtimeRoom} room-create=ok code-join=ok settings-lock=ok com=${comRoom} bots=ok`);
}

run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
