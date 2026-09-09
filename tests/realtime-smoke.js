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
  assert.match(created.room, /^\d{4}$/, '방 번호는 숫자 4자리여야 합니다.');
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
  const heroState = playing.game.players.find(player => player.id === alpha.id);
  assert.equal(heroState.hand.length, 2);
  assert.ok(heroState.handName, '본인에게는 현재 족보가 전달되어야 합니다.');
  assert.equal(playing.game.players.filter(player => player.id !== alpha.id).every(player => player.hand === null && player.handName === null), true, '상대의 비공개 패와 족보가 노출되면 안 됩니다.');

  alpha.send({ type: 'settings', settings: { mode: 'cash', startingChips: 9999, maxPlayers: 10, blindUpMinutes: 1 } });
  const lockError = await alpha.waitFor(message => message.type === 'error' && message.message.includes('변경할 수 없습니다'));
  assert.ok(lockError);
  assert.equal(alpha.state.room.mode, 'tournament');
  assert.equal(alpha.state.room.startingChips, 25000);

  const previousHand = alpha.state.game.handNumber;
  alpha.send({ type: 'endGame' });
  await alpha.waitFor(message => message.type === 'state' && !message.room.started && message.game.phase === 'gameover');
  alpha.send({ type: 'startGame' });
  const restarted = await alpha.waitFor(message => message.type === 'state' && message.room.started && message.game.phase === 'playing' && message.game.handNumber > previousHand);
  assert.equal(restarted.game.players.filter(player => player.connected).length, 10);
  assert.equal(restarted.game.players.every(player => player.stack > 0), true, '재시작하면 모든 접속 플레이어의 스택이 복원되어야 합니다.');

  alpha.close();
  bravo.close();
  extraPlayers.forEach(player => player.close());
  return created.room;
}

async function testRealtimeRoomWithBots() {
  const host = new TestClient(`hybrid-host-${Date.now()}`, 'HYBRID');
  await host.connect({
    type: 'create', playerId: host.id, name: host.name, playType: 'realtime',
    settings: { mode: 'cash', startingChips: 12000, maxPlayers: 4, botCount: 2, blindUpMinutes: 10 }
  });
  const created = await host.waitFor(message => message.type === 'created');
  await host.waitFor(message => message.type === 'state' && message.room.code === created.room && message.game.players.length === 3);
  assert.equal(host.state.room.botCount, 2);
  assert.equal(host.state.game.players.filter(player => player.isBot).length, 2, '실시간 방에도 선택한 수만큼 COM이 생성되어야 합니다.');

  const guest = new TestClient(`hybrid-guest-${Date.now()}`, 'GUEST');
  await guest.connect({ type: 'join', playerId: guest.id, name: guest.name, room: created.room });
  await guest.waitFor(message => message.type === 'joined');
  await host.waitFor(message => message.type === 'state' && message.game.players.filter(player => player.connected).length === 4);

  host.send({ type: 'settings', settings: { mode: 'cash', startingChips: 12000, maxPlayers: 4, botCount: 3, blindUpMinutes: 10 } });
  await host.waitFor(message => message.type === 'error' && message.message.includes('최대 인원'));
  assert.equal(host.state.room.botCount, 2, '참가자와 COM의 합이 최대 좌석을 넘는 설정은 거부해야 합니다.');

  host.send({ type: 'startGame' });
  const playing = await host.waitFor(message => message.type === 'state' && message.room.settingsLocked && message.game.phase === 'playing');
  const guestPlaying = await guest.waitFor(message => message.type === 'state' && message.room.settingsLocked && message.game.phase === 'playing');
  assert.equal(playing.game.players.filter(player => player.isBot && player.inHand).length, 2);
  assert.equal(playing.game.players.filter(player => player.isBot).every(player => player.hand === null), true);
  assert.deepEqual(
    guestPlaying.game.players.map(player => player.id),
    playing.game.players.map(player => player.id),
    '사람과 COM을 섞은 원형 좌석 순서가 모든 접속자에게 동일해야 합니다.'
  );

  host.close();
  guest.close();
  return created.room;
}

async function testAllInRunout() {
  const stamp = Date.now();
  const host = new TestClient(`runout-host-${stamp}`, 'RUNOUT-A');
  const guest = new TestClient(`runout-guest-${stamp}`, 'RUNOUT-B');
  await host.connect({
    type: 'create', playerId: host.id, name: host.name, playType: 'realtime',
    settings: { mode: 'cash', startingChips: 1000, maxPlayers: 2, blindUpMinutes: 10 }
  });
  const created = await host.waitFor(message => message.type === 'created');
  await guest.connect({ type: 'join', playerId: guest.id, name: guest.name, room: created.room });
  await guest.waitFor(message => message.type === 'joined');
  host.send({ type: 'startGame' });
  const playing = await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing');
  const actor = playing.game.turnPlayerId === host.id ? host : guest;
  const caller = actor === host ? guest : host;
  actor.send({ type: 'action', action: 'raise', raiseTarget: 1000 });
  await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing' && message.game.turnPlayerId === caller.id && message.game.currentBet === 1000);
  caller.send({ type: 'action', action: 'call' });

  const preflopRunout = await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.board.length === 0);
  assert.equal(preflopRunout.game.players.filter(player => player.inHand).every(player => player.allIn && player.hand?.length === 2), true);
  await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.street === 'flop' && message.game.board.length === 3);
  await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.street === 'turn' && message.game.board.length === 4);
  await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.street === 'river' && message.game.board.length === 5);
  const result = await host.waitFor(message => message.type === 'state' && message.game.phase === 'result' && message.game.street === 'showdown');
  assert.equal(result.game.result.pots[0].label, 'MAIN POT');
  assert.equal(result.game.handHistory.length, 1);
  assert.equal(result.game.handHistory[0].players.every(player => player.revealed && player.hand?.length === 2), true, '쇼다운 참가자의 공개 카드는 히스토리에 남아야 합니다.');
  await host.waitFor(message => message.type === 'event' && message.event === 'potAward' && message.label === 'MAIN POT');
  host.close();
  guest.close();
  return created.room;
}

async function testPostflopAllInRunout(targetStreet) {
  const stamp = Date.now();
  const host = new TestClient(`${targetStreet}-host-${stamp}`, `${targetStreet}-A`);
  const guest = new TestClient(`${targetStreet}-guest-${stamp}`, `${targetStreet}-B`);
  await host.connect({
    type: 'create', playerId: host.id, name: host.name, playType: 'realtime',
    settings: { mode: 'cash', startingChips: 1000, maxPlayers: 2, blindUpMinutes: 10 }
  });
  const created = await host.waitFor(message => message.type === 'created');
  await guest.connect({ type: 'join', playerId: guest.id, name: guest.name, room: created.room });
  await guest.waitFor(message => message.type === 'joined');
  host.send({ type: 'startGame' });
  await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing');

  let actedState = '';
  const streetDeadline = Date.now() + 15000;
  while (host.state?.game.street !== targetStreet && Date.now() < streetDeadline) {
    const game = host.state?.game;
    if (game?.phase === 'playing' && game.turnPlayerId) {
      const signature = `${game.handNumber}:${game.street}:${game.turnPlayerId}:${game.currentBet}:${game.logs.length}`;
      if (signature !== actedState) {
        (game.turnPlayerId === host.id ? host : guest).send({ type: 'action', action: 'call' });
        actedState = signature;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(host.state?.game.street, targetStreet);
  assert.ok(host.messages.some(message => message.type === 'event' && message.event === 'actionFlash' && message.label === 'CHECK'), 'CHECK 액션 이벤트가 전달되어야 합니다.');
  const streetState = host.state;
  const actor = streetState.game.turnPlayerId === host.id ? host : guest;
  const caller = actor === host ? guest : host;
  const actorState = streetState.game.players.find(player => player.id === actor.id);
  actor.send({ type: 'action', action: 'raise', raiseTarget: actorState.roundBet + actorState.stack });
  await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing' && message.game.street === targetStreet && message.game.turnPlayerId === caller.id && message.game.currentBet > 0);
  caller.send({ type: 'action', action: 'call' });

  const initialBoardSize = targetStreet === 'flop' ? 3 : 4;
  const runout = await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.runoutFrom === targetStreet && message.game.board.length === initialBoardSize);
  assert.equal(runout.game.players.filter(player => player.inHand).every(player => player.allIn), true);
  if (targetStreet === 'flop') await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.board.length === 4);
  await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.board.length === 5);
  await host.waitFor(message => message.type === 'state' && message.game.phase === 'result' && message.game.street === 'showdown');
  host.close();
  guest.close();
  return created.room;
}

async function testEffectiveStackCap() {
  const stamp = Date.now();
  const host = new TestClient(`cap-host-${stamp}`, 'CAP-A');
  const guest = new TestClient(`cap-guest-${stamp}`, 'CAP-B');
  await host.connect({
    type: 'create', playerId: host.id, name: host.name, playType: 'realtime',
    settings: { mode: 'cash', startingChips: 1000, maxPlayers: 2, blindUpMinutes: 10 }
  });
  const created = await host.waitFor(message => message.type === 'created');
  await guest.connect({ type: 'join', playerId: guest.id, name: guest.name, room: created.room });
  await guest.waitFor(message => message.type === 'joined');
  host.send({ type: 'startGame' });
  const firstHand = await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing');
  const folder = firstHand.game.turnPlayerId === host.id ? host : guest;
  folder.send({ type: 'action', action: 'fold' });
  const foldedResult = await host.waitFor(message => message.type === 'state' && message.game.phase === 'result');
  assert.equal(foldedResult.game.handHistory.length, 1);
  assert.equal(foldedResult.game.handHistory[0].players.every(player => !player.revealed && player.hand === null), true, '폴드로 끝난 핸드의 홀카드는 누구 것도 저장하면 안 됩니다.');
  const secondHand = await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing' && message.game.handNumber > firstHand.game.handNumber, 15000);
  const deepState = [...secondHand.game.players].sort((left, right) => (right.stack + right.roundBet) - (left.stack + left.roundBet))[0];
  const shortState = secondHand.game.players.find(player => player.id !== deepState.id);
  const deep = deepState.id === host.id ? host : guest;
  const short = deep === host ? guest : host;
  assert.equal(secondHand.game.turnPlayerId, deep.id);
  deep.send({ type: 'action', action: 'raise', raiseTarget: deepState.roundBet + deepState.stack });
  const capped = await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing' && message.game.turnPlayerId === short.id && message.game.currentBet === shortState.stack + shortState.roundBet);
  const cappedDeep = capped.game.players.find(player => player.id === deep.id);
  assert.equal(cappedDeep.stack, 200, '딥스택의 콜되지 않는 200칩은 스택에 남아야 합니다.');
  assert.equal(cappedDeep.allIn, true, '유효 스택으로 조정되어도 ALL IN 선언은 표시되어야 합니다.');
  short.send({ type: 'action', action: 'call' });
  const runout = await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout');
  assert.equal(runout.game.pot, 1800, '두 플레이어의 유효 스택 900칩씩만 팟에 들어가야 합니다.');
  const showdownResult = await host.waitFor(message => message.type === 'state' && message.game.phase === 'result' && message.game.street === 'showdown');
  assert.equal(showdownResult.game.handHistory.length, 2, '완료된 핸드가 시간순으로 누적되어야 합니다.');
  assert.equal(showdownResult.game.handHistory[0].players.every(player => player.hand === null), true);
  assert.equal(showdownResult.game.handHistory[1].players.every(player => player.revealed && player.hand?.length === 2), true);
  host.close();
  guest.close();
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
  assert.ok(hero.state.room.gto.policyCount >= 1, 'TexasSolver 정책이 서버에 로드되어야 합니다.');
  assert.equal(hero.state.room.gto.fallbackEngine.version, 'equity-gto-v3');

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
  assert.ok(hero.state.room.gto.roomDecisions.equity >= 1, '일반 스팟은 equity GTO 엔진으로 판단해야 합니다.');

  const reviewDeadline = Date.now() + 30000;
  while (!hero.state?.game.lastHandReview && Date.now() < reviewDeadline) {
    if (hero.state?.game.turnPlayerId === hero.id) hero.send({ type: 'action', action: 'call' });
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const review = hero.state?.game.lastHandReview;
  assert.ok(review, '완료된 핸드 리뷰가 저장되어야 합니다.');
  assert.equal(review.players.length, 3);
  assert.equal(review.players.every(player => player.revealed ? player.hand?.length === 2 : player.hand === null), true, '공개되지 않은 홀카드는 히스토리에 없어야 합니다.');
  assert.equal(review.players.filter(player => player.folded).every(player => !player.revealed && player.hand === null), true, '폴드한 플레이어의 카드는 항상 비공개여야 합니다.');
  assert.ok(hero.state.game.handHistory.length >= 1);
  assert.ok(review.logs.length > 0);
  hero.close();
  return created.room;
}

async function run() {
  const realtimeRoom = await testRealtimeRoom();
  const hybridRoom = await testRealtimeRoomWithBots();
  const runoutRoom = await testAllInRunout();
  const flopRunoutRoom = await testPostflopAllInRunout('flop');
  const turnRunoutRoom = await testPostflopAllInRunout('turn');
  const cappedRoom = await testEffectiveStackCap();
  const comRoom = await testComRoom();
  console.log(`PASS realtime=${realtimeRoom} hybrid=${hybridRoom} preflop=${runoutRoom} flop=${flopRunoutRoom} turn=${turnRunoutRoom} cap=${cappedRoom} effective-stack=ok sequential-runouts=ok pot-award=ok com=${comRoom}`);
}

run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
