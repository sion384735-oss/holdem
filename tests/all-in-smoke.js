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

  waitFor(predicate, timeout = 12000) {
    const existing = this.messages.findLast(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout (${this.name}) ${JSON.stringify({ phase: this.state?.game.phase, street: this.state?.game.street, turn: this.state?.game.turnPlayerId })}`)), timeout);
      this.waiters.push({ predicate, resolve: message => { clearTimeout(timer); resolve(message); } });
    });
  }

  close() { this.ws?.close(); }
}

async function makeHeadsUp(prefix) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const host = new TestClient(`${prefix}-host-${stamp}`, `${prefix}-A`);
  const guest = new TestClient(`${prefix}-guest-${stamp}`, `${prefix}-B`);
  await host.connect({
    type: 'create', playerId: host.id, name: host.name, playType: 'realtime',
    settings: { mode: 'cash', startingChips: 1000, maxPlayers: 2, blindUpMinutes: 10 }
  });
  const created = await host.waitFor(message => message.type === 'created');
  await guest.connect({ type: 'join', playerId: guest.id, name: guest.name, room: created.room });
  await guest.waitFor(message => message.type === 'joined');
  host.send({ type: 'startGame' });
  await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing');
  return { host, guest, room: created.room };
}

async function makeTable(prefix, playerCount) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const clients = Array.from({ length: playerCount }, (_, index) => new TestClient(`${prefix}-${index}-${stamp}`, `${prefix}-${index + 1}`));
  await clients[0].connect({
    type: 'create', playerId: clients[0].id, name: clients[0].name, playType: 'realtime',
    settings: { mode: 'cash', startingChips: 1000, maxPlayers: playerCount, blindUpMinutes: 10 }
  });
  const created = await clients[0].waitFor(message => message.type === 'created');
  for (const client of clients.slice(1)) {
    await client.connect({ type: 'join', playerId: client.id, name: client.name, room: created.room });
    await client.waitFor(message => message.type === 'joined');
  }
  clients[0].send({ type: 'startGame' });
  await clients[0].waitFor(message => message.type === 'state' && message.game.phase === 'playing');
  return { clients, room: created.room };
}

async function checkRunoutFrom(targetStreet) {
  const { host, guest, room } = await makeHeadsUp(targetStreet);
  try {
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
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    assert.equal(host.state?.game.street, targetStreet);

    const state = host.state;
    const actor = state.game.turnPlayerId === host.id ? host : guest;
    const caller = actor === host ? guest : host;
    const actorState = state.game.players.find(player => player.id === actor.id);
    actor.send({ type: 'action', action: 'raise', raiseTarget: actorState.roundBet + actorState.stack });
    await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing' && message.game.turnPlayerId === caller.id);
    caller.send({ type: 'action', action: 'call' });

    const initialBoardSize = targetStreet === 'preflop' ? 0 : targetStreet === 'flop' ? 3 : 4;
    const runout = await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.runoutFrom === targetStreet && message.game.board.length === initialBoardSize);
    assert.equal(runout.game.players.filter(player => player.inHand).every(player => player.allIn && player.hand?.length === 2), true);
    if (initialBoardSize < 3) await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.board.length === 3);
    if (initialBoardSize < 4) await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.board.length === 4);
    await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout' && message.game.board.length === 5);
    const result = await host.waitFor(message => message.type === 'state' && message.game.phase === 'result' && message.game.street === 'showdown');
    assert.equal(result.game.result.pots[0].label, 'MAIN POT');
    await host.waitFor(message => message.type === 'event' && message.event === 'potAward' && message.label === 'MAIN POT');
    return room;
  } finally {
    host.close();
    guest.close();
  }
}

async function checkEffectiveStackCap() {
  const { host, guest, room } = await makeHeadsUp('cap');
  try {
    const firstHand = host.state;
    const folder = firstHand.game.turnPlayerId === host.id ? host : guest;
    folder.send({ type: 'action', action: 'fold' });
    await host.waitFor(message => message.type === 'state' && message.game.phase === 'result');
    const secondHand = await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing' && message.game.handNumber > firstHand.game.handNumber, 15000);
    const deepState = [...secondHand.game.players].sort((left, right) => (right.stack + right.roundBet) - (left.stack + left.roundBet))[0];
    const shortState = secondHand.game.players.find(player => player.id !== deepState.id);
    const deep = deepState.id === host.id ? host : guest;
    const short = deep === host ? guest : host;
    assert.equal(secondHand.game.turnPlayerId, deep.id);

    deep.send({ type: 'action', action: 'raise', raiseTarget: deepState.roundBet + deepState.stack });
    const capped = await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing' && message.game.turnPlayerId === short.id && message.game.currentBet === shortState.stack + shortState.roundBet);
    const cappedDeep = capped.game.players.find(player => player.id === deep.id);
    assert.equal(cappedDeep.stack, 200);
    assert.equal(cappedDeep.allIn, true);
    short.send({ type: 'action', action: 'call' });
    const runout = await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout');
    assert.equal(runout.game.pot, 1800);
    return room;
  } finally {
    host.close();
    guest.close();
  }
}

async function checkThreeWaySidePotOrder() {
  const { clients, room } = await makeTable('side', 3);
  const host = clients[0];
  try {
    const firstHandNumber = host.state.game.handNumber;
    let lastFold = '';
    while (host.state?.game.phase === 'playing') {
      const game = host.state.game;
      const signature = `${game.handNumber}:${game.turnPlayerId}:${game.logs.length}`;
      if (signature !== lastFold) {
        clients.find(client => client.id === game.turnPlayerId).send({ type: 'action', action: 'fold' });
        lastFold = signature;
      }
      await new Promise(resolve => setTimeout(resolve, 60));
    }

    const secondHand = await host.waitFor(message => message.type === 'state' && message.game.phase === 'playing' && message.game.handNumber > firstHandNumber, 15000);
    assert.equal(new Set(secondHand.game.players.map(player => player.stack + player.roundBet)).size, 3);

    let lastAction = '';
    const allInDeadline = Date.now() + 10000;
    while (host.state?.game.phase === 'playing' && Date.now() < allInDeadline) {
      const game = host.state.game;
      const actor = game.players.find(player => player.id === game.turnPlayerId);
      const signature = `${game.handNumber}:${game.turnPlayerId}:${actor?.roundBet}:${actor?.stack}:${game.logs.length}`;
      if (actor && signature !== lastAction) {
        clients.find(client => client.id === actor.id).send({
          type: 'action', action: 'raise', raiseTarget: actor.roundBet + actor.stack
        });
        lastAction = signature;
      }
      await new Promise(resolve => setTimeout(resolve, 60));
    }

    const runout = await host.waitFor(message => message.type === 'state' && message.game.phase === 'runout');
    assert.equal(runout.game.players.filter(player => player.inHand).every(player => player.allIn), true);
    const result = await host.waitFor(message => message.type === 'state' && message.game.phase === 'result' && message.game.result?.pots?.length >= 2, 12000);
    assert.deepEqual(result.game.result.pots.slice(0, 2).map(pot => pot.label), ['MAIN POT', 'SIDE POT 1']);
    await host.waitFor(message => message.type === 'event' && message.event === 'potAward' && message.label === 'SIDE POT 1');
    const awards = host.messages.filter(message => message.type === 'event' && message.event === 'potAward');
    const firstSide = awards.findIndex(message => message.label === 'SIDE POT 1');
    const lastMain = awards.reduce((index, message, current) => message.label === 'MAIN POT' ? current : index, -1);
    assert.ok(lastMain >= 0 && firstSide > lastMain, 'MAIN POT 지급이 끝난 뒤 SIDE POT이 지급되어야 합니다.');
    return room;
  } finally {
    clients.forEach(client => client.close());
  }
}

(async () => {
  const preflop = await checkRunoutFrom('preflop');
  const flop = await checkRunoutFrom('flop');
  const turn = await checkRunoutFrom('turn');
  const cap = await checkEffectiveStackCap();
  const side = await checkThreeWaySidePotOrder();
  console.log(`PASS preflop=${preflop} flop=${flop} turn=${turn} cap=${cap} side=${side} sequential-runouts=ok effective-stack=ok main-before-side=ok`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
