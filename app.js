const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const COLORS = ['#d9f77d', '#b86e52', '#7962a7', '#53686a', '#4776a5', '#a8864e', '#a65f76', '#4b8b73', '#725d92', '#9a6c46'];
let socket = null;
let snapshot = null;
let joined = false;
let reconnectTimer = null;
let lastEventSeq = 0;
let inviteBase = location.origin && location.origin !== 'null' ? location.origin : 'http://127.0.0.1:5050';
const playerId = sessionStorage.getItem('felt-player-id') || crypto.randomUUID();
sessionStorage.setItem('felt-player-id', playerId);

function rankLabel(rank) { return RANK_LABEL[rank] || String(rank); }
function formatChips(value) { return Math.max(0, Math.floor(value || 0)).toLocaleString('ko-KR'); }
function formatClock(ms) { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function formatBB(value) { const bb = snapshot?.game.bb || 200; const amount = (value || 0) / bb; return `${Number.isInteger(amount) ? amount : amount.toFixed(1)} BB`; }
function initials(name) { return String(name).split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase(); }
function send(payload) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload)); }
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 1900); }

function connect() {
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.host || '127.0.0.1:5050';
  socket = new WebSocket(`${protocol}//${host}`);
  $('#connection-label').textContent = '● CONNECTING…';
  socket.addEventListener('open', () => {
    $('#connection-label').textContent = '● ONLINE';
    send({ type: 'join', playerId, name: $('#join-name').value, room: $('#join-room').value });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type === 'joined') {
      joined = true;
      $('#join-modal').classList.add('hidden');
      history.replaceState(null, '', `?room=${encodeURIComponent(message.room)}`);
      sessionStorage.setItem('felt-name', $('#join-name').value);
      sessionStorage.setItem('felt-room', message.room);
      toast(`${message.room} 방에 참가했습니다`);
    } else if (message.type === 'state') {
      snapshot = message;
      render();
    } else if (message.type === 'event' && message.seq > lastEventSeq) {
      lastEventSeq = message.seq;
      setTimeout(() => message.event === 'chipsIn' ? animateWinnings(message.playerId, message.amount) : animateChipsOut(message.playerId, message.amount), 30);
    } else if (message.type === 'error') toast(message.message);
  });
  socket.addEventListener('close', () => {
    $('#connection-label').textContent = '● RECONNECTING…';
    if (joined) reconnectTimer = setTimeout(connect, 1400);
  });
  socket.addEventListener('error', () => { $('#connection-label').textContent = '● OFFLINE'; });
}

function viewPlayers() {
  if (!snapshot) return [];
  const players = snapshot.game.players;
  const heroIndex = players.findIndex(player => player.id === snapshot.you);
  return heroIndex < 0 ? players : [...players.slice(heroIndex), ...players.slice(0, heroIndex)];
}
function viewIndexFor(playerId) { return viewPlayers().findIndex(player => player.id === playerId); }
function seatPosition(index, total, radiusX = 40, radiusY = 42) {
  const angle = (90 + index * (360 / Math.max(2, total))) * Math.PI / 180;
  return { left: 50 + radiusX * Math.cos(angle), top: 50 + radiusY * Math.sin(angle) };
}
function cardHTML(card, back = false) {
  if (back || !card) return '<span class="card back">♠</span>';
  const red = card.suit === '♥' || card.suit === '♦' ? ' red' : '';
  return `<span class="card${red}"><b>${rankLabel(card.rank)}</b><span class="suit">${card.suit}</span></span>`;
}

function animateChip(playerId, amount, incoming) {
  if (!snapshot) return;
  const index = viewIndexFor(playerId);
  const seat = $(`.seat-${index}`);
  const stage = $('.table-stage');
  if (!seat || !stage) return;
  const centerX = stage.clientWidth / 2;
  const centerY = stage.clientHeight * .48;
  const seatX = seat.offsetLeft;
  const seatY = seat.offsetTop;
  [0, 1, 2].forEach(item => {
    const chip = document.createElement('div');
    chip.className = `chip-flight${incoming ? ' chip-win' : ''}`;
    chip.textContent = item === 1 ? `${incoming ? '+' : '−'}${formatChips(amount)}` : '●';
    chip.style.left = `${incoming ? centerX : seatX}px`;
    chip.style.top = `${incoming ? centerY : seatY}px`;
    chip.style.setProperty('--dx', `${(incoming ? seatX - centerX : centerX - seatX)}px`);
    chip.style.setProperty('--dy', `${(incoming ? seatY - centerY : centerY - seatY)}px`);
    chip.style.animationDelay = `${item * 110}ms`;
    stage.appendChild(chip);
    setTimeout(() => chip.remove(), 1350);
  });
}
function animateChipsOut(playerId, amount) { animateChip(playerId, amount, false); }
function animateWinnings(playerId, amount) { animateChip(playerId, amount, true); }

function renderBoard() {
  const board = snapshot?.game.board || [];
  $('#board').innerHTML = Array.from({ length: 5 }, (_, index) => board[index] ? cardHTML(board[index]) : cardHTML(null, true)).join('');
}

function renderSeats() {
  const game = snapshot.game;
  const players = viewPlayers();
  const resultIds = new Set((game.result?.winners || []).map(winner => winner.id));
  const seats = players.map((player, index) => {
    const isHero = player.id === snapshot.you;
    const cards = player.inHand ? (player.hand ? player.hand.map(card => cardHTML(card)).join('') : `${cardHTML(null, true)}${cardHTML(null, true)}`) : '';
    const position = seatPosition(index, players.length);
    const classes = [player.folded ? 'folded' : '', !player.connected ? 'disconnected' : '', game.turnPlayerId === player.id ? 'active' : '', position.top < 50 ? 'top-seat' : '', resultIds.has(player.id) ? 'winner' : ''].filter(Boolean).join(' ');
    const blind = game.sbId === player.id ? 'SB' : game.bbId === player.id ? 'BB' : '';
    const status = player.stack <= 0 ? 'TABLE OUT' : !player.connected ? 'DISCONNECTED' : !player.inHand && game.phase === 'playing' ? `WAITING · ${formatChips(player.stack)} / ${formatBB(player.stack)}` : `${formatChips(player.stack)} <i>/</i> ${formatBB(player.stack)}`;
    return `<div class="seat seat-${index} ${classes}" style="left:${position.left}%;top:${position.top}%"><div class="player-box">${cards ? `<div class="hole-cards">${cards}</div>` : ''}<span class="avatar" style="background:${COLORS[index % COLORS.length]};color:${isHero ? '#18251f' : '#fff'}">${initials(player.name)}</span><div class="player-info"><b>${player.name}${isHero ? '<span class="badge">YOU</span>' : ''}</b><small>${status}</small></div>${blind ? `<span class="blind-badge">${blind}</span>` : ''}</div></div>`;
  }).join('');
  const bets = players.map((player, index) => {
    if (!player.roundBet) return '';
    const seat = seatPosition(index, players.length);
    const left = 50 + (seat.left - 50) * .64;
    const top = 50 + (seat.top - 50) * .64;
    return `<div class="table-bet" style="left:${left}%;top:${top}%">${formatChips(player.roundBet)}</div>`;
  }).join('');
  $('#seats').innerHTML = seats + bets;

  const dealerIndex = players.findIndex(player => player.id === game.dealerId);
  const dealer = $('#dealer-button');
  if (dealerIndex >= 0) {
    const position = seatPosition(dealerIndex, players.length);
    const sideOffset = position.left < 45 ? 9 : position.left > 55 ? -9 : 9;
    $('.table-stage').appendChild(dealer);
    dealer.style.left = `${position.left + sideOffset}%`;
    dealer.style.top = `${position.top}%`;
    dealer.classList.remove('hidden');
  } else dealer.classList.add('hidden');
}

function hero() { return snapshot?.game.players.find(player => player.id === snapshot.you); }
function callAmount() { const player = hero(); return player ? Math.min(player.stack, Math.max(0, snapshot.game.currentBet - player.roundBet)) : 0; }
function setRaiseTarget(chips, clearSelected = true) {
  if (!snapshot || !hero()) return;
  const game = snapshot.game;
  const player = hero();
  const minTarget = game.currentBet === 0 ? game.bb : game.currentBet + game.minRaise;
  const maxTarget = player.roundBet + player.stack;
  const target = Math.max(Math.min(minTarget, maxTarget), Math.min(maxTarget, Math.round(chips / 10) * 10));
  $('#raise-slider').value = target;
  $('#raise-bb').value = Number((target / game.bb).toFixed(1));
  $('#raise-display').textContent = `${formatBB(target)} · ${formatChips(target)}`;
  $('#raise-button-bb').textContent = formatBB(target);
  if (clearSelected) $$('.presets button').forEach(button => button.classList.remove('selected'));
}
function updateRaiseControls() {
  if (!snapshot || !hero()) return;
  const game = snapshot.game;
  const player = hero();
  const minTarget = game.currentBet === 0 ? game.bb : game.currentBet + game.minRaise;
  const maxTarget = player.roundBet + player.stack;
  $('#raise-slider').min = Math.min(minTarget, maxTarget);
  $('#raise-slider').max = Math.max(minTarget, maxTarget);
  let value = Number($('#raise-slider').value);
  if (!value || value < minTarget || value > maxTarget) value = Math.min(minTarget, maxTarget);
  setRaiseTarget(value, false);
}

function renderActions() {
  const game = snapshot.game;
  const player = hero();
  const heroTurn = game.phase === 'playing' && game.turnPlayerId === snapshot.you;
  const needed = callAmount();
  ['#fold-btn', '#call-btn', '#raise-btn', '#raise-slider', '#raise-bb'].forEach(selector => { $(selector).disabled = !heroTurn; });
  $$('.presets button').forEach(button => { button.disabled = !heroTurn; });
  $('#fold-btn').classList.toggle('hidden', game.phase !== 'playing');
  $('#call-btn').classList.toggle('hidden', game.phase !== 'playing');
  $('#raise-btn').classList.toggle('hidden', game.phase !== 'playing');
  $('#call-btn').textContent = needed ? `CALL ${formatBB(needed)}` : 'CHECK';
  if (game.phase === 'playing' && heroTurn) {
    $('#turn-title').textContent = '당신의 차례';
    $('#turn-detail').textContent = needed ? `${formatChips(needed)}칩을 콜하거나 액션을 선택하세요` : '체크 또는 베팅할 수 있습니다';
    $('#action-timer').textContent = formatClock(game.turnEndsAt - Date.now());
  } else if (game.phase === 'playing') {
    const actor = game.players.find(item => item.id === game.turnPlayerId);
    $('#turn-title').textContent = `${actor?.name || '플레이어'} 생각 중…`;
    $('#turn-detail').textContent = game.street.toUpperCase();
    $('#action-timer').textContent = formatClock(game.turnEndsAt - Date.now());
  } else if (game.phase === 'result') {
    const winner = game.result?.winners?.[0];
    $('#turn-title').textContent = game.result?.winners?.map(item => `${item.name} WINS`).join(' · ') || 'HAND RESULT';
    $('#turn-detail').textContent = winner ? `${winner.hand} · +${formatChips(winner.amount)} / +${formatBB(winner.amount)}` : '결과 계산 중';
    $('#action-timer').textContent = formatClock(game.phaseEndsAt - Date.now());
  } else if (game.phase === 'shuffling') {
    $('#turn-title').textContent = '덱을 섞는 중…'; $('#turn-detail').textContent = '새 핸드가 자동으로 시작됩니다'; $('#action-timer').textContent = formatClock(game.phaseEndsAt - Date.now());
  } else {
    $('#turn-title').textContent = '플레이어를 기다리는 중'; $('#turn-detail').textContent = '같은 방 코드로 한 명 이상 초대하세요'; $('#action-timer').textContent = '--:--';
  }
  updateRaiseControls();
}

function renderOverlay() {
  const game = snapshot.game;
  const player = hero();
  const tableOut = player && player.stack <= 0 && !player.inHand;
  const waitingSeat = player && !player.inHand && game.phase === 'playing';
  const visible = game.phase !== 'playing' || tableOut || waitingSeat;
  $('#table-overlay').classList.toggle('hidden', !visible);
  $('#table-overlay').classList.toggle('result-mode', game.phase === 'result');
  $('.shuffle-deck').classList.toggle('hidden', game.phase !== 'shuffling');
  $('#result-badge').classList.toggle('hidden', game.phase !== 'result');
  $('#table-out-btn').classList.toggle('hidden', !tableOut);
  if (tableOut) { $('#overlay-title').textContent = 'TABLE OUT'; $('#overlay-detail').textContent = '보유 칩이 모두 소진되었습니다'; }
  else if (waitingSeat) { $('#overlay-title').textContent = 'NEXT HAND WAITING'; $('#overlay-detail').textContent = '현재 핸드가 끝나면 자동으로 참가합니다'; }
  else if (game.phase === 'waiting') { $('#overlay-title').textContent = 'WAITING FOR PLAYERS'; $('#overlay-detail').textContent = `${game.players.filter(item => item.connected).length} / ${snapshot.room.maxPlayers}명 · ROOM ${snapshot.room.code}`; }
  else if (game.phase === 'shuffling') { $('#overlay-title').textContent = 'SHUFFLING'; $('#overlay-detail').textContent = `새 핸드까지 ${formatClock(game.phaseEndsAt - Date.now())}`; }
  else if (game.phase === 'result') {
    const winner = game.result?.winners?.[0];
    $('#overlay-title').textContent = game.result?.winners?.map(item => `${item.name} WINS`).join(' · ') || 'HAND RESULT';
    $('#overlay-detail').textContent = winner ? `${winner.hand} · +${formatChips(winner.amount)} / +${formatBB(winner.amount)}` : '결과 계산 중';
  }
}

function renderLogs() {
  $('#hand-log').innerHTML = snapshot.game.logs.map(log => `<div class="log-line ${log.kind || ''}">${log.text}</div>`).join('');
  $('#hand-log').scrollTop = $('#hand-log').scrollHeight;
}

function render() {
  if (!snapshot) return;
  const game = snapshot.game;
  renderBoard(); renderSeats(); renderActions(); renderOverlay(); renderLogs();
  $('#pot-value').textContent = formatChips(game.pot);
  $('#pot-bb').textContent = formatBB(game.pot);
  $('#hand-number').textContent = `HAND #${game.handNumber}`;
  $('#blinds-label').textContent = `${formatChips(game.sb)} / ${formatChips(game.bb)}`;
  $('#player-count').textContent = game.players.filter(player => player.connected).length;
  $('#online-count').textContent = game.players.filter(player => player.connected).length;
  $('#room-label').textContent = `ROOM ${snapshot.room.code}`;
  $('#cash-mode').classList.toggle('active', snapshot.room.mode === 'cash');
  $('#tourney-mode').classList.toggle('active', snapshot.room.mode === 'tournament');
  $('#game-kicker').textContent = snapshot.room.mode === 'cash' ? 'CASH GAME · NO LIMIT' : 'TOURNAMENT · 10 MIN LEVELS';
  $('#table-size').value = snapshot.room.maxPlayers;
  const isHost = snapshot.room.hostId === snapshot.you;
  $('#cash-mode').disabled = !isHost;
  $('#tourney-mode').disabled = !isHost;
  $('#table-size').disabled = !isHost;
  $('#new-game').disabled = !isHost;
  $('#level-label').textContent = snapshot.room.mode === 'cash' ? 'FIXED BLINDS' : `LEVEL ${game.level + 1}`;
  $('#level-timer').textContent = snapshot.room.mode === 'cash' ? '∞' : formatClock(game.levelEndsAt - Date.now());
  $('#next-blinds').textContent = snapshot.room.mode === 'cash' ? `${game.nextSB} / ${game.nextBB} · NO LEVEL UP` : `NEXT ${game.nextSB} / ${game.nextBB}`;
}

$('#join-form').addEventListener('submit', event => { event.preventDefault(); joined = false; if (socket) socket.close(); connect(); });
$('#fold-btn').addEventListener('click', () => send({ type: 'action', action: 'fold' }));
$('#call-btn').addEventListener('click', () => send({ type: 'action', action: 'call' }));
$('#raise-btn').addEventListener('click', () => send({ type: 'action', action: 'raise', raiseTarget: Number($('#raise-slider').value) }));
$('#raise-slider').addEventListener('input', event => setRaiseTarget(Number(event.target.value)));
$('#raise-bb').addEventListener('change', event => setRaiseTarget(Number(event.target.value || 1) * snapshot.game.bb));
$$('[data-pot]').forEach(button => button.addEventListener('click', () => { const game = snapshot.game; const target = game.currentBet ? game.currentBet + game.pot * Number(button.dataset.pot) : game.pot * Number(button.dataset.pot); setRaiseTarget(target); button.classList.add('selected'); }));
$('#all-in').addEventListener('click', () => { const player = hero(); setRaiseTarget(player.roundBet + player.stack); $('#all-in').classList.add('selected'); });
$('#cash-mode').addEventListener('click', () => send({ type: 'settings', mode: 'cash' }));
$('#tourney-mode').addEventListener('click', () => send({ type: 'settings', mode: 'tournament' }));
$('#table-size').addEventListener('change', event => send({ type: 'settings', maxPlayers: Number(event.target.value) }));
$('#new-game').addEventListener('click', () => send({ type: 'newGame' }));
$('#table-out-btn').addEventListener('click', () => send({ type: 'newGame' }));
$('#invite-btn').addEventListener('click', async () => {
  const url = `${inviteBase}/?room=${encodeURIComponent(snapshot?.room.code || $('#join-room').value)}`;
  try { await navigator.clipboard.writeText(url); toast('초대 링크를 복사했습니다'); } catch { prompt('초대 링크를 복사하세요', url); }
});
$$('.tabs button').forEach(button => button.addEventListener('click', () => { $$('.tabs button').forEach(item => item.classList.remove('active')); button.classList.add('active'); $$('.panel-content').forEach(panel => panel.classList.add('hidden')); $(`#${button.dataset.panel}`).classList.remove('hidden'); }));

setInterval(() => {
  if (!snapshot) return;
  const game = snapshot.game;
  if (game.phase === 'playing') $('#action-timer').textContent = formatClock(game.turnEndsAt - Date.now());
  else if (game.phase === 'result' || game.phase === 'shuffling') { renderActions(); renderOverlay(); }
  if (snapshot.room.mode === 'tournament') $('#level-timer').textContent = formatClock(game.levelEndsAt - Date.now());
}, 250);

const queryRoom = new URLSearchParams(location.search).get('room');
$('#join-room').value = (queryRoom || sessionStorage.getItem('felt-room') || 'FELT').toUpperCase();
$('#join-name').value = sessionStorage.getItem('felt-name') || `PLAYER${Math.floor(10 + Math.random() * 90)}`;
fetch('/api/info').then(response => response.json()).then(info => { if (info.lanUrl) inviteBase = info.lanUrl; }).catch(() => {});
