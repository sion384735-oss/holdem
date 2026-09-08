const WebSocket = require('ws');
const assert = require('assert');

const room = `TEST${Date.now().toString().slice(-5)}`;
const clients = [
  { id: 'smoke-a', name: 'ALPHA' },
  { id: 'smoke-b', name: 'BRAVO' }
];

function connect(client) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:5050');
    client.ws = ws;
    client.states = [];
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', playerId: client.id, name: client.name, room })));
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'state') {
        client.state = message;
        client.states.push(message);
        if (message.game.phase === 'playing') resolve();
      }
    });
    ws.on('error', reject);
  });
}

async function run() {
  await Promise.all(clients.map(connect));
  const [alpha, bravo] = clients;
  assert.equal(alpha.state.game.players.filter(player => player.connected).length, 2);
  const alphaView = alpha.state.game.players.find(player => player.id === alpha.id);
  const bravoInAlphaView = alpha.state.game.players.find(player => player.id === bravo.id);
  const bravoView = bravo.state.game.players.find(player => player.id === bravo.id);
  const alphaInBravoView = bravo.state.game.players.find(player => player.id === alpha.id);
  assert.equal(alphaView.hand.length, 2);
  assert.equal(bravoView.hand.length, 2);
  assert.equal(bravoInAlphaView.hand, null);
  assert.equal(alphaInBravoView.hand, null);
  const actorId = alpha.state.game.turnPlayerId;
  const actor = clients.find(client => client.id === actorId);
  actor.ws.send(JSON.stringify({ type: 'action', action: 'call' }));
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.notEqual(alpha.state.game.turnPlayerId, actorId);
  clients.forEach(client => client.ws.close());
  console.log(`PASS room=${room} private-cards=ok synced-action=ok players=2`);
}

const timeout = setTimeout(() => { console.error('FAIL timeout'); process.exit(1); }, 10000);
run().then(() => { clearTimeout(timeout); process.exit(0); }).catch(error => { clearTimeout(timeout); console.error(error); process.exit(1); });
