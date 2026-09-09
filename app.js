const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const COLORS = ['#d9f77d', '#b86e52', '#7962a7', '#53686a', '#4776a5', '#a8864e', '#a65f76', '#4b8b73', '#725d92', '#9a6c46'];

let socket = null;
let snapshot = null;
let joined = false;
let entryMode = 'home';
let reconnectTimer = null;
let reconnectPayload = null;
let autoStartOnCreate = false;
let lastEventSeq = 0;
let lastBoardCount = 0;
let lastBoardHand = null;
let selectedReviewHandNumber = null;
let inviteBase = location.origin && location.origin !== 'null' ? location.origin : 'http://127.0.0.1:5050';
const playerId = sessionStorage.getItem('felt-player-id') || (crypto.randomUUID ? crypto.randomUUID() : `player-${Date.now()}-${Math.random()}`);
sessionStorage.setItem('felt-player-id', playerId);

function rankLabel(rank) { return RANK_LABEL[rank] || String(rank); }
function formatChips(value) { return Math.max(0, Math.floor(value || 0)).toLocaleString('ko-KR'); }
function formatClock(ms) { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function formatBB(value) { const bb = snapshot?.game.bb || 200; const amount = (value || 0) / bb; return `${Number.isInteger(amount) ? amount : amount.toFixed(1)} BB`; }
function formatCompactBB(value) { return formatBB(value).replace(' ', ''); }
function initials(name) { return String(name || 'P').split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase(); }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function send(payload) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload)); }
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 2200); }

function setEntryBusy(busy, label) {
  $('#entry-submit').disabled = busy;
  if (label) $('#entry-submit').textContent = label;
}

function connectWith(payload, options = {}) {
  clearTimeout(reconnectTimer);
  if (socket) {
    joined = false;
    socket.close();
  }
  reconnectPayload = payload;
  autoStartOnCreate = Boolean(options.autoStart);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.host || '127.0.0.1:5050';
  const currentSocket = new WebSocket(`${protocol}//${host}`);
  socket = currentSocket;
  $('#connection-label').textContent = '● CONNECTING…';
  currentSocket.addEventListener('open', () => {
    if (socket !== currentSocket) return;
    $('#connection-label').textContent = '● ONLINE';
    currentSocket.send(JSON.stringify(payload));
  });
  currentSocket.addEventListener('message', event => {
    if (socket !== currentSocket) return;
    const message = JSON.parse(event.data);
    if (message.type === 'created' || message.type === 'joined') {
      joined = true;
      reconnectPayload = { type: 'join', playerId, name: $('#entry-name').value, room: message.room };
      $('#entry-modal').classList.add('hidden');
      sessionStorage.setItem('felt-name', $('#entry-name').value);
      sessionStorage.setItem('felt-room', message.room);
      setEntryBusy(false);
      if (payload.playType === 'realtime' || message.type === 'joined') history.replaceState(null, '', `?room=${encodeURIComponent(message.room)}`);
      else history.replaceState(null, '', location.pathname);
      toast(message.type === 'created' ? `${message.room} 방을 만들었습니다` : `${message.room} 방에 참가했습니다`);
      if (message.type === 'created' && autoStartOnCreate) send({ type: 'startGame' });
    } else if (message.type === 'state') {
      snapshot = message;
      render();
    } else if (message.type === 'event' && message.seq > lastEventSeq) {
      lastEventSeq = message.seq;
      setTimeout(() => {
        if (message.event === 'chipsOut') animateChipsOut(message.playerId, message.amount);
        else if (message.event === 'chipsReturn') animateWinnings(message.playerId, message.amount, { label: message.label || 'UNCALLED RETURN', refund: true });
        else if (message.event === 'potAward' || message.event === 'chipsIn') animateWinnings(message.playerId, message.amount, { label: message.label || 'MAIN POT' });
        else if (message.event === 'actionFlash') animateActionFlash(message.playerId, message.label);
      }, 30);
    } else if (message.type === 'error') {
      setEntryBusy(false);
      toast(message.message);
    }
  });
  currentSocket.addEventListener('close', () => {
    if (socket !== currentSocket) return;
    $('#connection-label').textContent = joined ? '● RECONNECTING…' : '● OFFLINE';
    if (joined && reconnectPayload) reconnectTimer = setTimeout(() => connectWith(reconnectPayload), 1400);
  });
  currentSocket.addEventListener('error', () => {
    if (socket === currentSocket) $('#connection-label').textContent = '● OFFLINE';
  });
}

function disconnectTable() {
  joined = false;
  reconnectPayload = null;
  clearTimeout(reconnectTimer);
  if (socket) socket.close();
  socket = null;
  snapshot = null;
  lastEventSeq = 0;
  lastBoardCount = 0;
  lastBoardHand = null;
  selectedReviewHandNumber = null;
  history.replaceState(null, '', location.pathname);
  renderEmptyTable();
}

function getSettings() {
  return {
    mode: $('#entry-game-mode').value,
    startingChips: Number($('#entry-starting-chips').value),
    maxPlayers: Number($('#entry-max-players').value),
    blindUpMinutes: Number($('#entry-blind-up').value),
    botCount: Number($('#entry-bot-count').value)
  };
}

function updateBotOptions(reset = false) {
  const maximum = Math.max(1, Number($('#entry-max-players').value) - 1);
  const minimum = entryMode === 'com' ? 1 : 0;
  const fallback = entryMode === 'com' ? maximum : 0;
  const current = Number($('#entry-bot-count').value);
  const selected = reset || !Number.isFinite(current) ? fallback : Math.min(maximum, Math.max(minimum, current));
  $('#entry-bot-count').innerHTML = Array.from({ length: maximum - minimum + 1 }, (_, index) => {
    const value = index + minimum;
    return `<option value="${value}"${value === selected ? ' selected' : ''}>${value === 0 ? '없음' : value}</option>`;
  }).join('');
}

function updateEntryFields() {
  const realtime = entryMode.startsWith('realtime');
  const joining = entryMode === 'realtime-join';
  $('#realtime-tabs').classList.toggle('hidden', !realtime);
  $('#host-settings').classList.toggle('hidden', joining);
  $('#join-fields').classList.toggle('hidden', !joining);
  $('#bot-count-field').classList.toggle('hidden', joining);
  $('#blind-up-field').classList.toggle('hidden', joining || $('#entry-game-mode').value !== 'tournament');
  $$('[data-realtime]').forEach(button => button.classList.toggle('active', entryMode === `realtime-${button.dataset.realtime}`));
  if (entryMode === 'com') {
    $('#entry-kicker').textContent = 'FELT CLUB · VS COM';
    $('#entry-title').textContent = 'COM 대전 설정';
    $('#entry-submit').textContent = 'COM 대전 시작 →';
  } else if (joining) {
    $('#entry-kicker').textContent = 'FELT CLUB · REALTIME';
    $('#entry-title').textContent = '방 코드로 입장';
    $('#entry-submit').textContent = '방 입장 →';
  } else {
    $('#entry-kicker').textContent = 'FELT CLUB · REALTIME';
    $('#entry-title').textContent = '실시간 방 만들기';
    $('#entry-submit').textContent = '방 만들기 →';
  }
}

function updateRoomSettingFields() {
  $('#room-blind-field').classList.toggle('hidden', $('#room-game-mode').value !== 'tournament');
  if (!snapshot) return;
  const minimum = snapshot.room.playType === 'com' ? 1 : 0;
  const humanCount = snapshot.game.players.filter(player => player.connected && !player.isBot).length;
  const maximum = Math.max(minimum, Number($('#room-max-players').value) - humanCount);
  $('#room-bot-count').min = minimum;
  $('#room-bot-count').max = maximum;
  if (Number($('#room-bot-count').value) > maximum) $('#room-bot-count').value = maximum;
}

function showEntry(mode = 'home') {
  entryMode = mode === 'realtime' ? 'realtime-create' : mode;
  $('#entry-modal').classList.remove('hidden');
  $('#entry-home').classList.toggle('hidden', entryMode !== 'home');
  $('#entry-form').classList.toggle('hidden', entryMode === 'home');
  $('#entry-close').classList.toggle('hidden', !snapshot || entryMode !== 'home');
  setEntryBusy(false);
  if (entryMode !== 'home') {
    updateBotOptions(true);
    updateEntryFields();
  }
}

function viewPlayers() {
  if (!snapshot) return [];
  const players = snapshot.game.players;
  const heroIndex = players.findIndex(player => player.id === snapshot.you);
  return heroIndex < 0 ? players : [...players.slice(heroIndex), ...players.slice(0, heroIndex)];
}
function viewIndexFor(id) { return viewPlayers().findIndex(player => player.id === id); }
function seatPosition(index, total, radiusX = 40, radiusY = 42) {
  if (total >= 8 && radiusX === 40 && radiusY === 42) {
    radiusX = 37;
    radiusY = 40.5;
  }
  const angle = (90 + index * (360 / Math.max(2, total))) * Math.PI / 180;
  return { left: 50 + radiusX * Math.cos(angle), top: 50 + radiusY * Math.sin(angle) };
}
function betPosition(index, total, seat = seatPosition(index, total)) {
  const angle = (90 + index * (360 / Math.max(2, total))) * Math.PI / 180;
  const sideSeat = Math.abs(seat.left - 50) > 32 && Math.abs(seat.top - 50) < 20;
  const bottomCenterSeat = Math.abs(seat.left - 50) < 1 && seat.top > 50;
  return {
    left: bottomCenterSeat ? 43 : 50 + 23.5 * Math.cos(angle),
    top: sideSeat && seat.top > 50 ? 52 : 50 + 23 * Math.sin(angle)
  };
}
function cardHTML(card, back = false, extraClass = '') {
  const className = extraClass ? ` ${extraClass}` : '';
  if (back || !card) return `<span class="card back${className}">♠</span>`;
  const red = card.suit === '♥' || card.suit === '♦' ? ' red' : '';
  return `<span class="card${red}${className}"><b>${rankLabel(card.rank)}</b><span class="suit">${card.suit}</span></span>`;
}

function chipTone(amount, bb = snapshot?.game?.bb || 200) {
  const blinds = amount / Math.max(1, bb);
  if (blinds >= 20) return 'gold';
  if (blinds >= 10) return 'violet';
  if (blinds >= 5) return 'blue';
  if (blinds >= 2) return 'red';
  return 'ivory';
}

function pokerChipHTML(label = '♠') {
  return `<span class="poker-chip"><span class="poker-chip-core">${label}</span></span>`;
}

function showPotMotionLabel(label, amount, refund = false) {
  const stage = $('.table-stage');
  if (!stage) return;
  const banner = document.createElement('div');
  banner.className = `pot-motion-label${refund ? ' refund' : ''}`;
  banner.innerHTML = `<small>${escapeHTML(label)}</small><strong>${formatChips(amount)} / ${formatCompactBB(amount)}</strong>`;
  stage.appendChild(banner);
  setTimeout(() => banner.remove(), 1450);
}

function animateChip(id, amount, incoming, options = {}) {
  if (!snapshot) return;
  const index = viewIndexFor(id);
  const seat = $(`.seat-${index}`);
  const stage = $('.table-stage');
  if (!seat || !stage) return;
  const centerX = stage.clientWidth / 2;
  const centerY = stage.clientHeight * .48;
  [0, 1, 2].forEach(item => {
    const chip = document.createElement('div');
    chip.className = `chip-flight${incoming ? ' chip-win' : ''}${options.refund ? ' chip-refund' : ''}`;
    chip.dataset.tone = options.refund ? 'ivory' : incoming ? 'gold' : chipTone(amount);
    chip.innerHTML = `${pokerChipHTML()}${item === 1 ? `<strong class="chip-flight-value">${incoming ? '+' : '−'}${formatChips(amount)} / ${formatCompactBB(amount)}</strong>` : ''}`;
    chip.style.left = `${incoming ? centerX : seat.offsetLeft}px`;
    chip.style.top = `${incoming ? centerY : seat.offsetTop}px`;
    chip.style.setProperty('--dx', `${incoming ? seat.offsetLeft - centerX : centerX - seat.offsetLeft}px`);
    chip.style.setProperty('--dy', `${incoming ? seat.offsetTop - centerY : centerY - seat.offsetTop}px`);
    chip.style.animationDelay = `${item * 110}ms`;
    stage.appendChild(chip);
    setTimeout(() => chip.remove(), 1350);
  });
}
function animateChipsOut(id, amount) { animateChip(id, amount, false); }
function animateWinnings(id, amount, options = {}) {
  if (options.label) showPotMotionLabel(options.label, amount, options.refund);
  animateChip(id, amount, true, options);
}

function animateActionFlash(id, label) {
  const index = viewIndexFor(id);
  const seat = $(`.seat-${index}`);
  const anchor = seat?.querySelector('.hole-cards') || seat?.querySelector('.player-box');
  if (!anchor) return;
  anchor.querySelector('.action-flash')?.remove();
  const flash = document.createElement('span');
  flash.className = `action-flash${label === 'AUTO FOLD' ? ' auto-fold' : ''}`;
  flash.textContent = label || 'CHECK';
  anchor.appendChild(flash);
  setTimeout(() => flash.remove(), 1450);
}

function updateCardCountdown() {
  const timer = $('.turn-countdown');
  if (!timer || snapshot?.game.phase !== 'playing') return;
  const seconds = Math.max(0, Math.ceil((snapshot.game.turnEndsAt - Date.now()) / 1000));
  timer.textContent = seconds;
  timer.classList.toggle('urgent', seconds <= 10);
  timer.style.setProperty('--turn-progress', `${Math.min(360, seconds * 6)}deg`);
}

function updateTableBlindClock() {
  if (!snapshot) return;
  const { game, room } = snapshot;
  const clock = $('#table-blind-clock');
  clock.classList.remove('hidden');
  clock.classList.toggle('pending', Boolean(game.blindChangePending));
  $('#table-current-blinds').textContent = `${formatChips(game.sb)} / ${formatChips(game.bb)}`;

  if (room.mode === 'cash') {
    $('#table-blind-timer-label').textContent = 'CASH GAME';
    $('#table-blind-timer').textContent = 'FIXED';
    return;
  }

  if (!room.started) {
    $('#table-blind-timer-label').textContent = 'BLIND UP';
    $('#table-blind-timer').textContent = `${String(room.blindUpMinutes).padStart(2, '0')}:00`;
    return;
  }

  $('#table-blind-timer-label').textContent = game.blindChangePending
    ? `NEXT ${formatChips(game.nextSB)} / ${formatChips(game.nextBB)}`
    : 'BLIND UP';
  $('#table-blind-timer').textContent = formatClock(game.levelEndsAt - Date.now());
}

function renderBoard() {
  const board = snapshot?.game.board || [];
  const handNumber = snapshot?.game.handNumber;
  if (lastBoardHand !== handNumber) { lastBoardHand = handNumber; lastBoardCount = 0; }
  $('#board').innerHTML = Array.from({ length: 5 }, (_, index) => board[index]
    ? cardHTML(board[index], false, index >= lastBoardCount ? 'deal-card' : '')
    : cardHTML(null, true)).join('');
  lastBoardCount = board.length;
}

function renderSeats() {
  const game = snapshot.game;
  const players = viewPlayers();
  const winnerIds = new Set((game.result?.winners || []).map(winner => winner.id));
  const equityByPlayer = new Map((game.showdownEquities || []).map(equity => [equity.playerId, equity]));
  const leadingEquity = Math.max(0, ...(game.showdownEquities || []).map(equity => equity.equity));
  const seats = players.map((player, index) => {
    const isHero = player.id === snapshot.you;
    const cards = player.inHand ? (player.hand ? player.hand.map(card => cardHTML(card)).join('') : `${cardHTML(null, true)}${cardHTML(null, true)}`) : '';
    const position = seatPosition(index, players.length);
    const sideCards = Math.abs(position.left - 50) > 32 && Math.abs(position.top - 50) < 20
      ? (position.left < 50 ? 'side-cards-right' : 'side-cards-left')
      : '';
    const classes = [player.folded ? 'folded' : '', player.allIn ? 'all-in' : '', !player.connected ? 'disconnected' : '', game.turnPlayerId === player.id ? 'active' : '', position.top < 50 ? 'top-seat' : '', sideCards, winnerIds.has(player.id) ? 'winner' : ''].filter(Boolean).join(' ');
    const blind = game.sbId === player.id ? 'SB' : game.bbId === player.id ? 'BB' : '';
    const status = !player.connected
      ? 'DISCONNECTED'
      : player.stack <= 0 && !player.inHand
        ? 'TABLE OUT'
        : player.allIn
          ? '<em class="all-in-status">ALL IN</em>'
          : `${formatChips(player.stack)} <i>/</i> ${formatBB(player.stack)}`;
    const name = escapeHTML(player.name);
    const handName = isHero && player.handName && !player.folded ? escapeHTML(player.handName) : '';
    const equity = equityByPlayer.get(player.id);
    const equityPercent = equity ? equity.equity * 100 : 0;
    const equityLabel = equityPercent >= 99.95 ? '100' : equityPercent <= 0.05 ? '0' : equityPercent.toFixed(1);
    const equityBadge = equity
      ? `<div class="showdown-equity${equity.equity >= leadingEquity - 0.000001 ? ' leader' : ''}" title="${equity.exact ? '정확 계산' : `${formatChips(equity.samples)}회 시뮬레이션`}"><small>승률</small><strong>${equityLabel}%</strong></div>`
      : '';
    const turnSeconds = Math.max(0, Math.ceil((game.turnEndsAt - Date.now()) / 1000));
    const countdown = game.phase === 'playing' && game.turnPlayerId === player.id ? `<time class="turn-countdown${turnSeconds <= 10 ? ' urgent' : ''}" style="--turn-progress:${Math.min(360, turnSeconds * 6)}deg">${turnSeconds}</time>` : '';
    return `<div class="seat seat-${index} ${classes}" style="left:${position.left}%;top:${position.top}%"><div class="player-box">${cards ? `<div class="hole-cards${handName ? ' has-hand-name' : ''}">${handName ? `<span class="current-hand-badge">${handName}</span>` : ''}${cards}${countdown}</div>` : ''}<span class="avatar" style="background:${COLORS[index % COLORS.length]};color:${isHero ? '#18251f' : '#fff'}">${initials(name)}</span><div class="player-info"><b>${name}${player.isBot ? '<span class="badge">COM</span>' : isHero ? '<span class="badge">YOU</span>' : ''}</b><small>${status}</small></div>${blind ? `<span class="blind-badge">${blind}</span>` : ''}</div>${equityBadge}</div>`;
  }).join('');
  const bets = players.map((player, index) => {
    if (!player.roundBet) return '';
    const seat = seatPosition(index, players.length);
    const bet = betPosition(index, players.length, seat);
    const sideClass = seat.left > 58 ? ' bet-right' : seat.left < 42 ? ' bet-left' : '';
    const owner = escapeHTML(player.name);
    return `<div class="table-bet${sideClass}" data-tone="${chipTone(player.roundBet, game.bb)}" data-seat="${index + 1}" style="left:${bet.left}%;top:${bet.top}%" aria-label="${owner} 베팅 ${formatChips(player.roundBet)}"><span class="chip-stack">${pokerChipHTML()}</span><strong class="bet-copy">${formatChips(player.roundBet)} / ${formatCompactBB(player.roundBet)}</strong></div>`;
  }).join('');
  $('#seats').innerHTML = seats + bets;
  const dealerIndex = players.findIndex(player => player.id === game.dealerId);
  const dealer = $('#dealer-button');
  if (dealerIndex >= 0) {
    const position = seatPosition(dealerIndex, players.length);
    dealer.style.left = `${position.left + (position.left > 55 ? -9 : 9)}%`;
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
  const { game, room } = snapshot;
  const isHeroTurn = game.phase === 'playing' && game.turnPlayerId === snapshot.you;
  const needed = callAmount();
  ['#fold-btn', '#call-btn', '#raise-btn', '#raise-slider', '#raise-bb'].forEach(selector => { $(selector).disabled = !isHeroTurn; });
  $$('.presets button').forEach(button => { button.disabled = !isHeroTurn; });
  $('#call-btn').textContent = needed ? `CALL ${formatBB(needed)}` : 'CHECK';
  if (isHeroTurn) {
    $('#turn-title').textContent = '당신의 차례';
    $('#turn-detail').textContent = needed ? `${formatChips(needed)}칩을 콜하거나 액션을 선택하세요` : '체크 또는 베팅할 수 있습니다';
  } else if (game.phase === 'playing') {
    const actor = game.players.find(item => item.id === game.turnPlayerId);
    $('#turn-title').textContent = `${actor?.name || '플레이어'} 생각 중…`;
    $('#turn-detail').textContent = game.street.toUpperCase();
  } else if (game.phase === 'result') {
    $('#turn-title').textContent = game.result?.winners?.map(item => `${item.name} WINS`).join(' · ') || 'HAND RESULT';
    $('#turn-detail').textContent = game.result?.winners?.[0] ? `${game.result.winners[0].hand} · +${formatChips(game.result.winners[0].amount)}` : '결과 계산 중';
  } else if (game.phase === 'shuffling') {
    $('#turn-title').textContent = '덱을 섞는 중…'; $('#turn-detail').textContent = '새 핸드가 곧 시작됩니다';
  } else if (game.phase === 'runout') {
    const nextStreet = game.board.length < 3 ? 'FLOP' : game.board.length < 4 ? 'TURN' : game.board.length < 5 ? 'RIVER' : 'SHOWDOWN';
    $('#turn-title').textContent = 'ALL-IN SHOWDOWN';
    $('#turn-detail').textContent = `${nextStreet} 공개 대기 중…`;
  } else if (game.phase === 'lobby') {
    $('#turn-title').textContent = '방장이 게임을 시작하기 전입니다'; $('#turn-detail').textContent = '방 설정과 참가자를 확인해 주세요';
  } else if (game.phase === 'gameover') {
    const busted = room.playType === 'com' && hero()?.stack <= 0;
    $('#turn-title').textContent = busted ? '칩을 모두 잃었습니다' : '게임이 종료되었습니다';
    $('#turn-detail').textContent = room.playType === 'com' ? '다시하기를 누르면 시작 칩으로 재도전합니다' : '설정을 바꿀 수 있으며 방장이 다시 시작할 수 있습니다';
  } else {
    $('#turn-title').textContent = '플레이어를 기다리는 중'; $('#turn-detail').textContent = '게임 종료 또는 재접속을 기다리고 있습니다';
  }
  $('#action-timer').textContent = game.phase === 'playing' ? formatClock(game.turnEndsAt - Date.now()) : (game.phase === 'result' || game.phase === 'shuffling' || game.phase === 'runout') ? formatClock(game.phaseEndsAt - Date.now()) : '--:--';
  if (game.phase !== 'playing') setRaiseTarget(game.bb * 2, false);
  updateRaiseControls();
}

function renderOverlay() {
  const { game, room } = snapshot;
  const isHost = room.hostId === snapshot.you;
  const busted = room.playType === 'com' && hero()?.stack <= 0;
  const connected = game.players.filter(player => player.connected).length;
  const visible = ['lobby', 'waiting', 'shuffling', 'result', 'gameover'].includes(game.phase);
  $('#table-overlay').classList.toggle('hidden', !visible);
  $('#table-overlay').classList.toggle('result-mode', game.phase === 'result' || game.phase === 'gameover');
  $('.shuffle-deck').classList.toggle('hidden', game.phase !== 'shuffling');
  $('#result-badge').classList.toggle('hidden', game.phase !== 'result' && game.phase !== 'gameover');
  $('#result-badge').textContent = busted ? 'OUT' : game.phase === 'gameover' ? 'END' : 'WIN';
  const startVisible = isHost && !room.started && (game.phase === 'lobby' || game.phase === 'gameover');
  $('#start-game-btn').classList.toggle('hidden', !startVisible);
  $('#start-game-btn').classList.toggle('replay', room.playType === 'com' && game.phase === 'gameover');
  $('#start-game-btn').disabled = connected < 2;
  $('#start-game-btn').textContent = game.phase === 'gameover' ? (room.playType === 'com' ? '↻ 다시하기' : '같은 설정으로 다시 시작') : '게임 시작';
  if (game.phase === 'lobby') {
    $('#overlay-title').textContent = room.playType === 'com' ? 'COM TABLE READY' : `ROOM ${room.code} · 대기실`;
    $('#overlay-detail').textContent = isHost ? `${connected} / ${room.maxPlayers}명 · 방장이 시작하면 설정이 잠깁니다` : `${connected} / ${room.maxPlayers}명 · 방장의 시작을 기다리는 중`;
  } else if (game.phase === 'waiting') {
    $('#overlay-title').textContent = 'WAITING FOR PLAYERS';
    $('#overlay-detail').textContent = '칩이 남은 플레이어가 2명 이상 필요합니다';
  } else if (game.phase === 'shuffling') {
    $('#overlay-title').textContent = 'SHUFFLING';
    $('#overlay-detail').textContent = `새 핸드까지 ${formatClock(game.phaseEndsAt - Date.now())}`;
  } else if (game.phase === 'result') {
    const winner = game.result?.winners?.[0];
    $('#overlay-title').textContent = game.result?.winners?.map(item => `${item.name} WINS`).join(' · ') || 'HAND RESULT';
    $('#overlay-detail').textContent = winner ? `${winner.hand} · +${formatChips(winner.amount)}` : '결과 계산 중';
  } else if (game.phase === 'gameover') {
    $('#overlay-title').textContent = game.result?.winners?.[0] ? `${game.result.winners[0].name} · TOURNAMENT CHAMPION` : 'GAME OVER';
    $('#overlay-detail').textContent = room.playType === 'com'
      ? (busted ? 'ALL-IN 패배 · 시작 칩으로 다시 도전하세요' : '같은 설정으로 다시 플레이할 수 있습니다')
      : '게임이 끝나 방 설정 잠금이 해제되었습니다';
  }
}

function renderLogs() {
  $('#hand-log').innerHTML = snapshot.game.logs.length ? snapshot.game.logs.map(log => `<div class="log-line ${escapeHTML(log.kind || '')}">${escapeHTML(log.text)}</div>`).join('') : '<div class="empty-panel">아직 기록이 없습니다.</div>';
  $('#hand-log').scrollTop = $('#hand-log').scrollHeight;
}

function renderHandReview() {
  const target = $('#hand-review');
  const reviews = snapshot?.game.handHistory?.length
    ? snapshot.game.handHistory
    : snapshot?.game.lastHandReview ? [snapshot.game.lastHandReview] : [];
  if (!reviews.length) {
    selectedReviewHandNumber = null;
    target.innerHTML = '<div class="empty-panel">완료된 핸드가 아직 없습니다.<br>쇼다운에서 공개된 카드만 히스토리에 남습니다.</div>';
    return;
  }
  const newestFirst = [...reviews].reverse();
  let review = reviews.find(item => item.handNumber === selectedReviewHandNumber);
  if (!review) {
    review = newestFirst[0];
    selectedReviewHandNumber = review.handNumber;
  }
  const handPicker = `<nav class="review-hand-picker" aria-label="완료된 핸드 선택">${newestFirst.map(item => {
    const winnerNames = item.winners?.map(winner => winner.name).join(' · ') || '결과 없음';
    return `<button type="button" data-review-hand="${item.handNumber}" class="${item.handNumber === review.handNumber ? 'active' : ''}"><b>#${item.handNumber}</b><small>${escapeHTML(winnerNames)}</small></button>`;
  }).join('')}</nav>`;
  const winners = new Map(review.winners.map(winner => [winner.id, winner]));
  const players = [...review.players].sort((a, b) => (a.id === snapshot.you ? -1 : b.id === snapshot.you ? 1 : 0));
  const board = review.board.length
    ? review.board.map(card => cardHTML(card, false, 'review-card')).join('')
    : '<span class="review-no-board">보드 오픈 전 종료</span>';
  const potResults = (review.pots || []).map(pot => {
    const awards = pot.winners?.map(winner => `${escapeHTML(winner.name)} +${formatChips(winner.amount)}`).join(' · ') || '승자 없음';
    return `<div class="review-pot-result"><span>${escapeHTML(pot.label)} · ${formatChips(pot.amount)}</span><strong>${awards}</strong></div>`;
  }).join('');
  const playerRows = players.map(player => {
    const isHero = player.id === snapshot.you;
    const winner = winners.get(player.id);
    const cards = player.revealed && player.hand?.length
      ? player.hand.map(card => cardHTML(card, false, 'review-card')).join('')
      : `<span class="review-hidden-hand">${player.folded ? 'FOLDED · HIDDEN' : 'NOT SHOWN'}</span>`;
    const classes = [isHero ? 'hero' : '', winner ? 'winner' : '', player.folded ? 'folded' : '', !player.revealed ? 'hidden-hand' : ''].filter(Boolean).join(' ');
    const role = isHero ? 'MY HAND' : player.isBot ? 'COM' : 'PLAYER';
    const resultLabel = winner ? winner.hand : player.handName;
    return `<article class="review-player ${classes}">
      <div class="review-player-head"><span class="review-role">${role}</span>${winner ? `<strong>+${formatChips(winner.amount)}</strong>` : `<small>${formatChips(player.totalBet)} BET</small>`}</div>
      <div class="review-player-body"><span class="avatar">${escapeHTML(initials(player.name))}</span><div class="review-player-name"><b>${escapeHTML(player.name)}</b><small>${escapeHTML(resultLabel)}</small></div><div class="review-cards">${cards}</div></div>
    </article>`;
  }).join('');
  const history = review.logs.map(log => `<div class="review-log ${escapeHTML(log.kind || '')}">${escapeHTML(log.text)}</div>`).join('');
  target.innerHTML = `${handPicker}<section class="review-summary">
    <div class="review-title"><div><small>HAND HISTORY</small><strong>#${review.handNumber}</strong></div><span>${review.finish === 'showdown' ? 'SHOWDOWN' : 'FOLD WIN'}</span></div>
    <div class="review-pot"><small>FINAL POT</small><strong>${formatChips(review.pot)}</strong></div>
    <div class="review-board"><small>BOARD</small><div>${board}</div></div>
    ${potResults ? `<div class="review-pot-results">${potResults}</div>` : ''}
  </section>${playerRows}<details class="review-history"><summary>전체 액션 히스토리 <span>${review.logs.length}</span></summary><div>${history}</div></details>`;
}

function render() {
  if (!snapshot) return renderEmptyTable();
  const { game, room } = snapshot;
  const isHost = room.hostId === snapshot.you;
  renderBoard(); renderSeats(); renderActions(); renderOverlay(); renderLogs(); renderHandReview(); updateTableBlindClock();
  const playType = room.playType === 'com' ? 'VS COM' : '실시간 배틀';
  const gameMode = room.mode === 'cash' ? '캐시게임' : '토너먼트';
  const connected = game.players.filter(player => player.connected).length;
  $('#pot-value').textContent = `${formatChips(game.pot)} / ${formatBB(game.pot)}`;
  $('#hand-number').textContent = `HAND #${game.handNumber}`;
  $('#blinds-label').textContent = game.blindChangePending
    ? `${formatChips(game.sb)} / ${formatChips(game.bb)} → ${formatChips(game.nextSB)} / ${formatChips(game.nextBB)} NEXT`
    : `${formatChips(game.sb)} / ${formatChips(game.bb)}`;
  $('#blinds-label').classList.toggle('blind-pending', Boolean(game.blindChangePending));
  $('#player-count').textContent = connected;
  $('#max-player-count').textContent = room.maxPlayers;
  $('#online-count').textContent = connected;
  $('#room-label').textContent = `ROOM ${room.code}`;
  $('#table-code-label').textContent = `TABLE ${room.code}`;
  $('#room-chip').classList.remove('hidden');
  $('#invite-btn').classList.toggle('hidden', room.playType === 'com');
  $('#play-type-label').textContent = playType;
  $('#game-mode-label').textContent = gameMode;
  $('#game-kicker').textContent = `${playType.toUpperCase()} · NO LIMIT`;
  $('#table-title').textContent = room.playType === 'com' ? 'COM Challenge' : 'Realtime Hold’em';
  $('#phase-label').textContent = game.phase.toUpperCase();
  $('#lock-label').textContent = room.settingsLocked ? '🔒 설정 고정 · 게임 종료까지' : '🔓 설정 변경 가능';
  $('#end-game-btn').classList.toggle('hidden', !isHost || !room.started);
  $('#mini-name').textContent = hero()?.name || 'PLAYER';
  $('#mini-avatar').textContent = initials(hero()?.name);
  $('#mini-mode').textContent = `${playType} · ${isHost ? '방장' : '참가자'}`;
  const gto = room.gto || { policyCount: 0, roomDecisions: { solver: 0, equity: 0 } };
  const solverDecisions = gto.roomDecisions?.solver || 0;
  const equityDecisions = gto.roomDecisions?.equity || 0;
  const totalBotDecisions = solverDecisions + equityDecisions;
  $('#gto-card').classList.toggle('hidden', room.botCount < 1);
  $('#gto-status').textContent = gto.policyCount ? `HYBRID GTO · ${gto.policyCount} SOLVER` : 'RANGE GTO ENGINE V4';
  $('#gto-hits').textContent = `${formatChips(solverDecisions)} EXACT / ${formatChips(totalBotDecisions)}`;
  $('#gto-detail').textContent = gto.policyCount
    ? `TexasSolver 정확 매칭 ${formatChips(solverDecisions)}회 · 나머지 ${formatChips(equityDecisions)}회는 포지션별 프리플랍 레인지와 포스트플랍 혼합 전략`
    : `포지션·오픈·3벳·스택별 프리플랍 레인지와 승률·드로·블로커 혼합 전략 · ${formatChips(equityDecisions)}회 판단`;
  const canEditSettings = isHost && !room.settingsLocked;
  $('#room-settings-form').classList.toggle('hidden', !canEditSettings);
  if (canEditSettings && !$('#room-settings-form').matches(':focus-within')) {
    $('#room-game-mode').value = room.mode;
    $('#room-starting-chips').value = room.startingChips;
    $('#room-max-players').value = room.maxPlayers;
    $('#room-blind-up').value = room.blindUpMinutes;
    $('#room-bot-count').value = room.botCount;
  }
  $('#room-bot-field').classList.remove('hidden');
  updateRoomSettingFields();
  $('#tournament-card').classList.toggle('hidden', room.mode !== 'tournament');
  $('#level-label').textContent = game.blindChangePending
    ? `LEVEL ${game.level + 1} → ${game.nextLevel + 1}`
    : `LEVEL ${game.nextLevel + 1}`;
  $('#level-timer').textContent = room.started
    ? formatClock(game.levelEndsAt - Date.now())
    : `${String(room.blindUpMinutes).padStart(2, '0')}:00`;
  $('#next-blinds').textContent = game.blindChangePending
    ? `NEXT HAND ${formatChips(game.nextSB)} / ${formatChips(game.nextBB)}`
    : `NEXT LEVEL ${formatChips(game.followingSB)} / ${formatChips(game.followingBB)}`;
  $$('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === (room.playType === 'com' ? 'com' : 'realtime')));
}

function renderEmptyTable() {
  renderBoard();
  $('#seats').innerHTML = '';
  $('#dealer-button').classList.add('hidden');
  $('#table-overlay').classList.remove('hidden', 'result-mode');
  $('.shuffle-deck').classList.add('hidden');
  $('#result-badge').classList.add('hidden');
  $('#start-game-btn').classList.add('hidden');
  $('#overlay-title').textContent = 'WELCOME TO FELT CLUB';
  $('#overlay-detail').textContent = '메뉴에서 VS COM 또는 실시간 배틀을 선택하세요';
  $('#room-chip').classList.add('hidden');
  $('#table-title').textContent = '게임을 선택해 주세요';
  $('#play-type-label').textContent = 'NO TABLE';
  $('#game-mode-label').textContent = '—';
  $('#phase-label').textContent = 'READY';
  $('#table-code-label').textContent = 'TABLE —';
  $('#hand-number').textContent = 'HAND —';
  $('#connection-label').textContent = '● OFFLINE';
  $('#pot-value').textContent = '0 / 0 BB';
  $('#player-count').textContent = '0';
  $('#max-player-count').textContent = '—';
  $('#online-count').textContent = '0';
  $('#turn-title').textContent = '게임을 선택해 주세요';
  $('#turn-detail').textContent = 'VS COM 또는 실시간 배틀';
  $('#action-timer').textContent = '--:--';
  $('#end-game-btn').classList.add('hidden');
  $('#gto-card').classList.add('hidden');
  $('#table-blind-clock').classList.add('hidden');
  $('#lock-label').textContent = '설정 대기';
  $('#hand-log').innerHTML = '<div class="empty-panel">게임에 들어가면 기록이 표시됩니다.</div>';
  selectedReviewHandNumber = null;
  $('#hand-review').innerHTML = '<div class="empty-panel">완료된 핸드가 아직 없습니다.<br>쇼다운에서 공개된 카드만 히스토리에 남습니다.</div>';
  ['#fold-btn', '#call-btn', '#raise-btn', '#raise-slider', '#raise-bb'].forEach(selector => { $(selector).disabled = true; });
  $$('.presets button').forEach(button => { button.disabled = true; });
  $$('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === 'home'));
}

$('#entry-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#entry-name').value.trim();
  if (!name) return toast('닉네임을 입력해 주세요.');
  sessionStorage.setItem('felt-name', name);
  if (entryMode === 'realtime-join') {
    const room = $('#entry-room').value.replace(/\D/g, '').slice(0, 4);
    if (room.length !== 4) return toast('숫자 4자리 방 번호를 입력해 주세요.');
    setEntryBusy(true, '입장 중…');
    connectWith({ type: 'join', playerId, name, room });
    return;
  }
  setEntryBusy(true, '방 만드는 중…');
  const playType = entryMode === 'com' ? 'com' : 'realtime';
  connectWith({ type: 'create', playerId, name, playType, settings: getSettings() }, { autoStart: playType === 'com' });
});

$$('[data-entry]').forEach(button => button.addEventListener('click', () => showEntry(button.dataset.entry)));
$$('[data-realtime]').forEach(button => button.addEventListener('click', () => { entryMode = `realtime-${button.dataset.realtime}`; updateEntryFields(); }));
$('#entry-back').addEventListener('click', () => showEntry('home'));
$('#entry-close').addEventListener('click', () => $('#entry-modal').classList.add('hidden'));
$('#entry-game-mode').addEventListener('change', updateEntryFields);
$('#entry-room').addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4); });
$('#entry-max-players').addEventListener('change', () => updateBotOptions());
$('#logo-home').addEventListener('click', () => showEntry('home'));
$('#room-game-mode').addEventListener('change', updateRoomSettingFields);
$('#room-max-players').addEventListener('change', updateRoomSettingFields);
$('#room-settings-form').addEventListener('submit', event => {
  event.preventDefault();
  send({
    type: 'settings',
    settings: {
      mode: $('#room-game-mode').value,
      startingChips: Number($('#room-starting-chips').value),
      maxPlayers: Number($('#room-max-players').value),
      blindUpMinutes: Number($('#room-blind-up').value),
      botCount: Number($('#room-bot-count').value)
    }
  });
  toast('방 설정을 저장했습니다.');
});
$('#hand-review').addEventListener('click', event => {
  const button = event.target.closest('[data-review-hand]');
  if (!button || !snapshot) return;
  selectedReviewHandNumber = Number(button.dataset.reviewHand);
  renderHandReview();
});
$$('[data-nav]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.nav === 'review') {
    if (!snapshot) return toast('먼저 게임 방에 들어가 주세요.');
    $('#entry-modal').classList.add('hidden');
    $('.tabs [data-panel="review-panel"]').click();
    return;
  }
  showEntry(button.dataset.nav);
}));

$('#fold-btn').addEventListener('click', () => send({ type: 'action', action: 'fold' }));
$('#call-btn').addEventListener('click', () => send({ type: 'action', action: 'call' }));
$('#raise-btn').addEventListener('click', () => send({ type: 'action', action: 'raise', raiseTarget: Number($('#raise-slider').value) }));
$('#raise-slider').addEventListener('input', event => setRaiseTarget(Number(event.target.value)));
$('#raise-bb').addEventListener('change', event => setRaiseTarget(Number(event.target.value || 1) * snapshot.game.bb));
$$('[data-pot]').forEach(button => button.addEventListener('click', () => { const game = snapshot.game; const target = game.currentBet ? game.currentBet + game.pot * Number(button.dataset.pot) : game.pot * Number(button.dataset.pot); setRaiseTarget(target); button.classList.add('selected'); }));
$('#all-in').addEventListener('click', () => { const player = hero(); setRaiseTarget(player.roundBet + player.stack); $('#all-in').classList.add('selected'); });
$('#start-game-btn').addEventListener('click', () => send({ type: 'startGame' }));
$('#end-game-btn').addEventListener('click', () => send({ type: 'endGame' }));
$('#leave-btn').addEventListener('click', () => { disconnectTable(); showEntry('home'); });
$('#invite-btn').addEventListener('click', async () => {
  const code = snapshot?.room.code || '';
  const url = `${inviteBase}/?room=${encodeURIComponent(code)}`;
  const text = `FELT CLUB 방 코드: ${code}\n${url}`;
  try { await navigator.clipboard.writeText(text); toast(`방 코드 ${code}와 초대 링크를 복사했습니다`); } catch { window.prompt('방 코드와 초대 링크를 복사하세요', text); }
});
$$('.tabs button').forEach(button => button.addEventListener('click', () => { $$('.tabs button').forEach(item => item.classList.remove('active')); button.classList.add('active'); $$('.panel-content').forEach(panel => panel.classList.add('hidden')); $(`#${button.dataset.panel}`).classList.remove('hidden'); }));

setInterval(() => {
  if (!snapshot) return;
  const { game, room } = snapshot;
  if (game.phase === 'playing') $('#action-timer').textContent = formatClock(game.turnEndsAt - Date.now());
  else if (game.phase === 'result' || game.phase === 'shuffling' || game.phase === 'runout') { renderActions(); renderOverlay(); }
  if (room.mode === 'tournament' && room.started) {
    $('#level-timer').textContent = formatClock(game.levelEndsAt - Date.now());
  }
  updateTableBlindClock();
  updateCardCountdown();
}, 250);

const queryRoom = new URLSearchParams(location.search).get('room');
$('#entry-name').value = sessionStorage.getItem('felt-name') || `PLAYER${Math.floor(10 + Math.random() * 90)}`;
if (queryRoom) {
  $('#entry-room').value = queryRoom.replace(/\D/g, '').slice(0, 4);
  showEntry('realtime-join');
} else showEntry('home');
updateBotOptions();
renderEmptyTable();
fetch('/api/info').then(response => response.json()).then(info => {
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if (loopback && info.lanUrl) inviteBase = info.lanUrl;
}).catch(() => {});
