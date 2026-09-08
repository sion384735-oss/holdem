const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');
const { contestableRaiseTarget, uncalledExcess, buildPotLayers } = require('./poker-rules');

const PORT = Number(process.env.PORT || 5050);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const BLIND_LEVELS = [[100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [600, 1200], [800, 1600], [1000, 2000]];
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();

function createDeck() {
  const deck = [];
  SUITS.forEach(suit => RANKS.forEach(rank => deck.push({ rank, suit })));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeSettings(settings = {}, playType = 'realtime') {
  const mode = settings.mode === 'tournament' ? 'tournament' : 'cash';
  const maxPlayers = clampInteger(settings.maxPlayers, 2, 10, playType === 'com' ? 6 : 6);
  return {
    mode,
    maxPlayers,
    startingChips: clampInteger(settings.startingChips, 1000, 1000000, 10000),
    blindUpMinutes: clampInteger(settings.blindUpMinutes, 1, 60, 10),
    botCount: playType === 'com' ? clampInteger(settings.botCount, 1, maxPlayers - 1, Math.min(5, maxPlayers - 1)) : 0
  };
}

function createRoom(code, options = {}) {
  const playType = options.playType === 'com' ? 'com' : 'realtime';
  const settings = normalizeSettings(options.settings, playType);
  const room = {
    code, hostId: null, playType, settingsLocked: false, started: false,
    mode: settings.mode, maxPlayers: settings.maxPlayers, startingChips: settings.startingChips,
    blindUpMinutes: settings.blindUpMinutes, botCount: settings.botCount, players: [], sockets: new Map(),
    deck: [], board: [], dealerIndex: -1, sbIndex: -1, bbIndex: -1, actionIndex: -1,
    street: 'waiting', phase: 'lobby', phaseEndsAt: 0, turnEndsAt: 0,
    pot: 0, currentBet: 0, minRaise: 200, handNumber: 1000 + Math.floor(Math.random() * 9000),
    sb: 100, bb: 200, handSB: 100, handBB: 200, level: 0,
    levelEndsAt: Date.now() + settings.blindUpMinutes * 60000,
    logs: [], result: null, runoutFrom: null, eventSeq: 0, resultSeq: 0
  };
  rooms.set(code, room);
  return room;
}

function generateRoomCode() {
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function cleanRoomCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
function cleanName(value) { return String(value || 'PLAYER').replace(/[<>]/g, '').trim().slice(0, 14) || 'PLAYER'; }
function startingStack(room) { return room.startingChips; }
function inStartPool(player) { return player.connected && player.stack > 0; }
function canAct(player) { return player.inHand && !player.folded && !player.allIn && !player.allInDeclared && player.stack > 0; }
function contenders(room) { return room.players.filter(player => player.inHand && !player.folded); }
function nextIndex(room, from, predicate) {
  for (let step = 1; step <= room.players.length; step += 1) {
    const index = (from + step + room.players.length) % room.players.length;
    if (predicate(room.players[index])) return index;
  }
  return -1;
}
function addLog(room, text, kind = '') {
  room.logs.push({ text, kind, at: Date.now() });
  if (room.logs.length > 80) room.logs.shift();
}
function postChips(room, player, amount) {
  const paid = Math.min(player.stack, Math.max(0, Math.floor(amount)));
  player.stack -= paid;
  player.roundBet += paid;
  player.totalBet += paid;
  room.pot += paid;
  if (player.stack === 0) player.allIn = true;
  return paid;
}
function callAmount(room, player) { return Math.min(player.stack, Math.max(0, room.currentBet - player.roundBet)); }

function serialize(room, viewerId) {
  const cardsUp = room.phase === 'runout' || (room.phase === 'result' && room.street === 'showdown');
  return {
    type: 'state', you: viewerId,
    room: {
      code: room.code, hostId: room.hostId, playType: room.playType, mode: room.mode,
      maxPlayers: room.maxPlayers, startingChips: room.startingChips,
      blindUpMinutes: room.blindUpMinutes, botCount: room.botCount,
      settingsLocked: room.settingsLocked, started: room.started
    },
    game: {
      players: room.players.map(player => ({
        id: player.id, name: player.name, stack: player.stack, connected: player.connected, isBot: Boolean(player.isBot),
        inHand: player.inHand, folded: player.folded, allIn: Boolean(player.allIn || player.allInDeclared), roundBet: player.roundBet,
        hand: player.id === viewerId || (cardsUp && player.inHand && !player.folded) ? player.hand : null
      })),
      board: room.board, dealerId: room.players[room.dealerIndex]?.id || null,
      sbId: room.players[room.sbIndex]?.id || null, bbId: room.players[room.bbIndex]?.id || null,
      turnPlayerId: room.players[room.actionIndex]?.id || null, street: room.street, phase: room.phase,
      phaseEndsAt: room.phaseEndsAt, turnEndsAt: room.turnEndsAt, pot: room.pot,
      currentBet: room.currentBet, minRaise: room.minRaise, handNumber: room.handNumber,
      sb: room.handSB, bb: room.handBB, nextSB: room.sb, nextBB: room.bb,
      level: room.level, levelEndsAt: room.levelEndsAt, logs: room.logs, result: room.result,
      runoutFrom: room.runoutFrom
    }
  };
}

function send(ws, payload) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }
function broadcast(room) { room.sockets.forEach((ws, playerId) => send(ws, serialize(room, playerId))); }
function broadcastEvent(room, event) {
  room.eventSeq += 1;
  room.sockets.forEach(ws => send(ws, { type: 'event', seq: room.eventSeq, ...event }));
}

function settleUncalledExcess(room) {
  const unmatched = uncalledExcess(room.players);
  if (!unmatched) return null;
  const player = room.players.find(item => item.id === unmatched.playerId);
  if (!player) return null;
  const amount = Math.min(unmatched.amount, player.roundBet, player.totalBet);
  if (amount <= 0) return null;
  player.roundBet -= amount;
  player.totalBet -= amount;
  player.stack += amount;
  player.allIn = player.stack === 0;
  room.pot -= amount;
  room.currentBet = Math.max(0, ...room.players.filter(item => item.inHand).map(item => item.roundBet));
  addLog(room, `${player.name} UNCALLED BET RETURN ${amount}`, 'system');
  return { playerId: player.id, amount };
}

function scheduleShuffle(room) {
  if (!room.started) {
    room.phase = 'lobby'; room.phaseEndsAt = 0; room.street = 'waiting'; room.actionIndex = -1;
    return broadcast(room);
  }
  if (room.players.filter(inStartPool).length < 2) {
    room.phase = 'waiting'; room.phaseEndsAt = 0; room.street = 'waiting'; room.actionIndex = -1;
  } else {
    room.phase = 'shuffling'; room.phaseEndsAt = Date.now() + 3000; room.street = 'waiting'; room.actionIndex = -1; room.result = null;
  }
  broadcast(room);
}

function startHand(room) {
  room.players = room.players.filter(player => player.connected || player.inHand);
  const live = room.players.filter(inStartPool);
  if (live.length < 2) return scheduleShuffle(room);
  room.handNumber += 1;
  room.phase = 'playing'; room.phaseEndsAt = 0; room.street = 'preflop'; room.result = null;
  room.runoutFrom = null;
  room.pot = 0; room.currentBet = room.bb; room.minRaise = room.bb; room.board = []; room.deck = createDeck();
  room.handSB = room.sb; room.handBB = room.bb;
  room.players.forEach(player => Object.assign(player, {
    inHand: inStartPool(player), hand: [], folded: !inStartPool(player), allIn: false, allInDeclared: false,
    acted: false, roundBet: 0, totalBet: 0
  }));
  room.dealerIndex = nextIndex(room, room.dealerIndex, player => player.inHand);
  room.sbIndex = live.length === 2 ? room.dealerIndex : nextIndex(room, room.dealerIndex, player => player.inHand);
  room.bbIndex = nextIndex(room, room.sbIndex, player => player.inHand);
  [0, 1].forEach(() => room.players.filter(player => player.inHand).forEach(player => player.hand.push(room.deck.pop())));
  const sbPaid = postChips(room, room.players[room.sbIndex], room.handSB);
  const bbPaid = postChips(room, room.players[room.bbIndex], room.handBB);
  room.actionIndex = room.bbIndex;
  room.logs = [];
  addLog(room, `HAND #${room.handNumber} · ${room.mode === 'cash' ? '캐시게임' : `토너먼트 LEVEL ${room.level + 1}`}`, 'system');
  addLog(room, `${room.players[room.sbIndex].name} SB ${sbPaid}`);
  addLog(room, `${room.players[room.bbIndex].name} BB ${bbPaid}`);
  continueGame(room);
  setTimeout(() => {
    broadcastEvent(room, { event: 'chipsOut', playerId: room.players[room.sbIndex]?.id, amount: sbPaid });
    broadcastEvent(room, { event: 'chipsOut', playerId: room.players[room.bbIndex]?.id, amount: bbPaid });
  }, 100);
}

function roundComplete(room) {
  const actors = room.players.filter(canAct);
  if (!actors.length) return true;
  return actors.every(player => player.acted && player.roundBet === room.currentBet);
}

function continueGame(room) {
  if (room.phase !== 'playing') return;
  const remaining = contenders(room);
  if (remaining.length === 1) return finishByFold(room, remaining[0]);
  if (roundComplete(room)) return advanceStreet(room);
  const next = nextIndex(room, room.actionIndex, player => canAct(player) && (!player.acted || player.roundBet !== room.currentBet));
  if (next < 0) return advanceStreet(room);
  room.actionIndex = next;
  room.turnEndsAt = Date.now() + 60000;
  broadcast(room);
  scheduleBotAction(room);
}

function scheduleBotAction(room) {
  const player = room.players[room.actionIndex];
  if (!player?.isBot || room.phase !== 'playing') return;
  const handNumber = room.handNumber;
  const street = room.street;
  setTimeout(() => {
    if (room.phase !== 'playing' || room.handNumber !== handNumber || room.street !== street) return;
    if (room.players[room.actionIndex]?.id !== player.id) return;
    const needed = callAmount(room, player);
    const roll = Math.random();
    if (needed > player.stack * 0.45 && roll < 0.45) return performAction(room, player.id, 'fold');
    if (roll < 0.78 || player.stack <= needed) return performAction(room, player.id, 'call');
    const minimum = room.currentBet === 0 ? room.handBB : room.currentBet + room.minRaise;
    const target = Math.min(player.roundBet + player.stack, Math.max(minimum, room.currentBet + Math.max(room.handBB, Math.floor(room.pot * 0.35))));
    performAction(room, player.id, 'raise', target);
  }, 650 + Math.floor(Math.random() * 650));
}

function performAction(room, playerId, action, raiseTarget = 0, auto = false) {
  if (room.phase !== 'playing') return;
  const index = room.players.findIndex(player => player.id === playerId);
  if (index !== room.actionIndex) return;
  const player = room.players[index];
  const needed = callAmount(room, player);
  let paid = 0;
  if (action === 'fold') {
    player.folded = true; player.acted = true;
    addLog(room, `${player.name} ${auto ? 'AUTO FOLD' : 'FOLD'}`, player.id === room.hostId ? 'hero' : '');
  } else if (action === 'call') {
    paid = postChips(room, player, needed); player.acted = true;
    if (player.allIn) player.allInDeclared = true;
    addLog(room, needed ? `${player.name} ${player.allIn ? 'ALL-IN CALL' : 'CALL'} ${paid}` : `${player.name} CHECK`);
  } else if (action === 'raise') {
    const maxTarget = player.roundBet + player.stack;
    const minimum = room.currentBet === 0 ? room.handBB : room.currentBet + room.minRaise;
    const requestedTarget = Math.min(maxTarget, Math.max(Math.min(minimum, maxTarget), Math.floor(Number(raiseTarget) || minimum)));
    const declaredAllIn = requestedTarget >= maxTarget;
    const target = contestableRaiseTarget(player, room.players, requestedTarget);
    const cappedAmount = Math.max(0, requestedTarget - target);
    const oldBet = room.currentBet;
    paid = postChips(room, player, target - player.roundBet);
    if (declaredAllIn) player.allInDeclared = true;
    if (player.roundBet > oldBet) {
      const increase = player.roundBet - oldBet;
      if (increase >= room.minRaise || player.allIn || declaredAllIn) {
        if (increase >= room.minRaise) room.minRaise = Math.max(room.handBB, increase);
        room.currentBet = player.roundBet;
        room.players.forEach(other => { if (canAct(other)) other.acted = false; });
      }
      player.acted = true;
      addLog(room, `${player.name} ${declaredAllIn || player.allIn ? 'ALL-IN TO' : 'RAISE TO'} ${player.roundBet}`);
      if (cappedAmount) addLog(room, `${player.name} EFFECTIVE STACK MATCH · ${cappedAmount} NOT COMMITTED`, 'system');
    } else {
      player.acted = true;
      addLog(room, `${player.name} ALL-IN ${paid}`);
    }
  } else return;
  if (paid) broadcastEvent(room, { event: 'chipsOut', playerId: player.id, amount: paid });
  broadcast(room);
  continueGame(room);
}

function startAllInRunout(room, refund = null) {
  room.runoutFrom = room.street;
  room.phase = 'runout';
  room.actionIndex = -1;
  room.turnEndsAt = 0;
  room.phaseEndsAt = Date.now() + 1300;
  room.currentBet = 0;
  room.minRaise = room.handBB;
  room.players.forEach(player => { player.roundBet = 0; player.acted = true; });
  addLog(room, `ALL-IN RUNOUT · ${room.street.toUpperCase()}부터 공개`, 'system');
  broadcast(room);
  if (refund) broadcastEvent(room, { event: 'chipsReturn', playerId: refund.playerId, amount: refund.amount, label: 'UNCALLED RETURN' });
}

function advanceAllInRunout(room) {
  if (room.phase !== 'runout') return;
  if (room.board.length < 3) {
    room.deck.pop();
    room.board.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    room.street = 'flop';
    addLog(room, `FLOP · ${room.board.map(cardName).join(' ')}`, 'system');
  } else if (room.board.length < 4) {
    room.deck.pop();
    room.board.push(room.deck.pop());
    room.street = 'turn';
    addLog(room, `TURN · ${cardName(room.board[3])}`, 'system');
  } else if (room.board.length < 5) {
    room.deck.pop();
    room.board.push(room.deck.pop());
    room.street = 'river';
    addLog(room, `RIVER · ${cardName(room.board[4])}`, 'system');
  } else {
    return showdown(room);
  }
  room.phaseEndsAt = Date.now() + 1800;
  broadcast(room);
}

function advanceStreet(room) {
  const refund = settleUncalledExcess(room);
  const live = contenders(room);
  if (live.length > 1 && live.filter(canAct).length <= 1) return startAllInRunout(room, refund);
  room.players.forEach(player => { player.roundBet = 0; player.acted = false; });
  room.currentBet = 0; room.minRaise = room.handBB;
  if (room.street === 'preflop') {
    room.deck.pop(); room.board.push(room.deck.pop(), room.deck.pop(), room.deck.pop()); room.street = 'flop';
    addLog(room, `FLOP · ${room.board.map(cardName).join(' ')}`, 'system');
  } else if (room.street === 'flop') {
    room.deck.pop(); room.board.push(room.deck.pop()); room.street = 'turn'; addLog(room, `TURN · ${cardName(room.board[3])}`, 'system');
  } else if (room.street === 'turn') {
    room.deck.pop(); room.board.push(room.deck.pop()); room.street = 'river'; addLog(room, `RIVER · ${cardName(room.board[4])}`, 'system');
  } else return showdown(room, refund);
  room.actionIndex = room.dealerIndex;
  continueGame(room);
  if (refund) broadcastEvent(room, { event: 'chipsReturn', playerId: refund.playerId, amount: refund.amount, label: 'UNCALLED RETURN' });
}

function cardName(card) { return `${card.rank > 10 ? ['', '', '', '', '', '', '', '', '', '', '', 'J', 'Q', 'K', 'A'][card.rank] : card.rank}${card.suit}`; }
function combinations(items, count) {
  const result = [];
  const pick = (start, chosen) => {
    if (chosen.length === count) return result.push(chosen);
    for (let index = start; index <= items.length - (count - chosen.length); index += 1) pick(index + 1, [...chosen, items[index]]);
  };
  pick(0, []); return result;
}
function evaluateFive(cards) {
  const ranks = cards.map(card => card.rank).sort((a, b) => b - a);
  const counts = {}; ranks.forEach(rank => { counts[rank] = (counts[rank] || 0) + 1; });
  const groups = Object.entries(counts).map(([rank, count]) => ({ rank: Number(rank), count })).sort((a, b) => b.count - a.count || b.rank - a.rank);
  const unique = [...new Set(ranks)]; if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let index = 0; index <= unique.length - 5; index += 1) if (unique[index] - unique[index + 4] === 4) straightHigh = Math.max(straightHigh, unique[index]);
  const flush = cards.every(card => card.suit === cards[0].suit);
  if (flush && straightHigh) return { score: [8, straightHigh], name: '스트레이트 플러시' };
  if (groups[0].count === 4) return { score: [7, groups[0].rank, groups[1].rank], name: '포카드' };
  if (groups[0].count === 3 && groups[1].count === 2) return { score: [6, groups[0].rank, groups[1].rank], name: '풀하우스' };
  if (flush) return { score: [5, ...ranks], name: '플러시' };
  if (straightHigh) return { score: [4, straightHigh], name: '스트레이트' };
  if (groups[0].count === 3) return { score: [3, groups[0].rank, ...groups.slice(1).map(group => group.rank).sort((a, b) => b - a)], name: '트리플' };
  if (groups[0].count === 2 && groups[1].count === 2) return { score: [2, ...[groups[0].rank, groups[1].rank].sort((a, b) => b - a), groups[2].rank], name: '투 페어' };
  if (groups[0].count === 2) return { score: [1, groups[0].rank, ...groups.slice(1).map(group => group.rank).sort((a, b) => b - a)], name: '원 페어' };
  return { score: [0, ...ranks], name: '하이 카드' };
}
function compareScores(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  return 0;
}
function evaluateSeven(cards) { return combinations(cards, 5).map(evaluateFive).sort((a, b) => compareScores(b.score, a.score))[0]; }

function finishByFold(room, winner) {
  const refund = settleUncalledExcess(room);
  const prize = room.pot;
  winner.stack += prize;
  room.phase = 'result'; room.street = 'fold-win'; room.actionIndex = -1; room.phaseEndsAt = Date.now() + 3800;
  room.resultSeq += 1;
  const award = { id: winner.id, name: winner.name, amount: prize, hand: '상대 전원 폴드' };
  room.result = {
    seq: room.resultSeq,
    winners: [award],
    pots: [{ index: 0, type: 'main', label: 'MAIN POT', amount: prize, winners: [award] }]
  };
  addLog(room, `${winner.name} 승리 · +${prize}`, 'win');
  broadcast(room);
  if (refund) broadcastEvent(room, { event: 'chipsReturn', playerId: refund.playerId, amount: refund.amount, label: 'UNCALLED RETURN' });
  const resultSeq = room.resultSeq;
  setTimeout(() => {
    if (room.phase === 'result' && room.result?.seq === resultSeq) {
      broadcastEvent(room, { event: 'potAward', playerId: winner.id, amount: prize, potIndex: 0, potType: 'main', label: 'MAIN POT' });
    }
  }, refund ? 700 : 250);
}

function showdown(room, pendingRefund = null) {
  const refund = pendingRefund || settleUncalledExcess(room);
  room.street = 'showdown'; room.phase = 'result'; room.actionIndex = -1;
  const live = contenders(room).map(player => ({ player, hand: evaluateSeven([...player.hand, ...room.board]) }));
  const winnings = new Map();
  const resultPots = buildPotLayers(room.players).map(pot => {
    const eligible = live.filter(item => pot.eligibleIds.includes(item.player.id));
    eligible.sort((a, b) => compareScores(b.hand.score, a.hand.score));
    const winners = eligible.filter(item => compareScores(item.hand.score, eligible[0].hand.score) === 0);
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    const awards = winners.map(({ player, hand }) => {
      const amount = share + (remainder-- > 0 ? 1 : 0);
      winnings.set(player.id, (winnings.get(player.id) || 0) + amount);
      return { id: player.id, name: player.name, amount, hand: hand.name };
    });
    return { ...pot, winners: awards };
  });
  const resultWinners = [...winnings.entries()].map(([id, amount]) => {
    const item = live.find(entry => entry.player.id === id);
    item.player.stack += amount;
    return { id, name: item.player.name, amount, hand: item.hand.name };
  }).sort((left, right) => right.amount - left.amount);
  live.forEach(({ player, hand }) => addLog(room, `${player.name} · ${hand.name}`));
  resultPots.forEach(pot => pot.winners.forEach(winner => addLog(room, `${pot.label} · ${winner.name} +${winner.amount}`, 'win')));
  room.resultSeq += 1; room.result = { seq: room.resultSeq, winners: resultWinners, pots: resultPots };
  const resultSeq = room.resultSeq;
  let payoutDelay = refund ? 850 : 300;
  resultPots.forEach(pot => {
    pot.winners.forEach(winner => {
      setTimeout(() => {
        if (room.phase === 'result' && room.result?.seq === resultSeq) {
          broadcastEvent(room, {
            event: 'potAward', playerId: winner.id, amount: winner.amount,
            potIndex: pot.index, potType: pot.type, potAmount: pot.amount, label: pot.label
          });
        }
      }, payoutDelay);
      payoutDelay += 220;
    });
    payoutDelay += 650;
  });
  room.phaseEndsAt = Date.now() + Math.max(3800, payoutDelay + 700);
  broadcast(room);
  if (refund) broadcastEvent(room, { event: 'chipsReturn', playerId: refund.playerId, amount: refund.amount, label: 'UNCALLED RETURN' });
}

function makePlayer(id, name, room, isBot = false) {
  return {
    id, name: cleanName(name), stack: startingStack(room), connected: true, isBot,
    inHand: false, hand: [], folded: false, allIn: false, allInDeclared: false, acted: false, roundBet: 0, totalBet: 0
  };
}

function syncBots(room) {
  if (room.playType !== 'com' || room.settingsLocked) return;
  room.players = room.players.filter(player => !player.isBot);
  const botNames = ['NOVA', 'MINT', 'RIVER', 'ACE', 'LUNA', 'CHIP', 'ROYAL', 'BLUFF', 'CLUB'];
  for (let index = 0; index < room.botCount; index += 1) {
    room.players.push(makePlayer(`bot-${room.code}-${index + 1}`, botNames[index], room, true));
  }
}

function applyRoomSettings(room, settings) {
  const normalized = normalizeSettings(settings, room.playType);
  const humanCount = room.players.filter(player => !player.isBot && player.connected).length;
  if (normalized.maxPlayers < humanCount) return false;
  room.mode = normalized.mode;
  room.maxPlayers = normalized.maxPlayers;
  room.startingChips = normalized.startingChips;
  room.blindUpMinutes = normalized.blindUpMinutes;
  room.botCount = normalized.botCount;
  room.players.forEach(player => { player.stack = room.startingChips; });
  syncBots(room);
  return true;
}

function resetHandState(room, phase = 'lobby') {
  room.deck = []; room.board = []; room.dealerIndex = -1; room.sbIndex = -1; room.bbIndex = -1; room.actionIndex = -1;
  room.street = 'waiting'; room.phase = phase; room.phaseEndsAt = 0; room.turnEndsAt = 0;
  room.pot = 0; room.currentBet = 0; room.minRaise = BLIND_LEVELS[0][1]; room.result = null;
  room.runoutFrom = null;
  room.players.forEach(player => Object.assign(player, { inHand: false, hand: [], folded: false, allIn: false, allInDeclared: false, acted: false, roundBet: 0, totalBet: 0 }));
}

function startSession(room) {
  const readyPlayers = room.players.filter(player => player.connected);
  if (readyPlayers.length < 2) return false;
  room.started = true; room.settingsLocked = true; room.logs = []; room.level = 0;
  [room.sb, room.bb] = BLIND_LEVELS[0];
  room.levelEndsAt = Date.now() + room.blindUpMinutes * 60000;
  room.players.forEach(player => { if (player.connected) player.stack = room.startingChips; });
  resetHandState(room, 'lobby');
  addLog(room, `게임 시작 · ${room.mode === 'cash' ? '캐시게임' : '토너먼트'} · 시작 칩 ${room.startingChips}`, 'system');
  scheduleShuffle(room);
  return true;
}

function endSession(room, reason = '방장이 게임을 종료했습니다') {
  room.started = false; room.settingsLocked = false;
  resetHandState(room, 'gameover');
  room.logs = [];
  addLog(room, reason, 'system');
  broadcast(room);
}

function finishTournament(room) {
  const champion = room.players.find(player => player.connected && player.stack > 0);
  endSession(room, champion ? `토너먼트 종료 · ${champion.name} 우승` : '토너먼트 종료');
  room.result = champion ? { seq: ++room.resultSeq, winners: [{ id: champion.id, name: champion.name, amount: champion.stack, hand: 'TOURNAMENT CHAMPION' }] } : null;
  broadcast(room);
}

function enterRoom(ws, room, message) {
  let player = room.players.find(item => item.id === String(message.playerId));
  if (!player && room.settingsLocked) {
    send(ws, { type: 'error', message: '이미 게임이 시작되어 새로 참가할 수 없습니다.' });
    return null;
  }
  if (!player && room.players.filter(item => item.connected).length >= room.maxPlayers) {
    send(ws, { type: 'error', message: '테이블이 가득 찼습니다.' });
    return null;
  }
  if (!player) {
    player = makePlayer(String(message.playerId || Math.random()), message.name, room);
    room.players.unshift(player);
  } else {
    player.connected = true; player.name = cleanName(message.name);
  }
  const previousSocket = room.sockets.get(player.id);
  if (previousSocket && previousSocket !== ws) previousSocket.close();
  room.sockets.set(player.id, ws); ws.roomCode = room.code; ws.playerId = player.id;
  if (!room.hostId || !room.players.find(item => item.id === room.hostId)?.connected) room.hostId = player.id;
  addLog(room, `${player.name} 테이블 참가`, 'system');
  return player;
}

const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/api/info') {
    const addresses = Object.values(os.networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal);
    const lanUrl = addresses[0] ? `http://${addresses[0].address}:${PORT}` : `http://127.0.0.1:${PORT}`;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ port: PORT, lanUrl }));
  }
  const requestPath = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(data);
  });
});

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw); } catch { return send(ws, { type: 'error', message: '잘못된 요청입니다.' }); }
    if (message.type === 'create') {
      const room = createRoom(generateRoomCode(), { playType: message.playType, settings: message.settings });
      const player = enterRoom(ws, room, message);
      if (!player) return;
      room.hostId = player.id;
      syncBots(room);
      send(ws, { type: 'created', room: room.code, playerId: player.id });
      broadcast(room);
      return;
    }
    if (message.type === 'join') {
      const code = cleanRoomCode(message.room);
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', message: '방을 찾을 수 없습니다. 방 코드를 확인해 주세요.' });
      const player = enterRoom(ws, room, message);
      if (!player) return;
      send(ws, { type: 'joined', room: code, playerId: player.id });
      broadcast(room);
      return;
    }
    const room = rooms.get(ws.roomCode);
    if (!room || !ws.playerId) return;
    if (message.type === 'action') performAction(room, ws.playerId, message.action, message.raiseTarget);
    if (message.type === 'settings' && room.hostId === ws.playerId) {
      if (room.settingsLocked) return send(ws, { type: 'error', message: '게임이 끝날 때까지 방 설정은 변경할 수 없습니다.' });
      if (!applyRoomSettings(room, message.settings || message)) return send(ws, { type: 'error', message: '현재 참가 인원보다 작은 테이블로 바꿀 수 없습니다.' });
      addLog(room, '방 설정이 변경되었습니다.', 'system');
      broadcast(room);
    }
    if (message.type === 'startGame' && room.hostId === ws.playerId) {
      if (room.started) return send(ws, { type: 'error', message: '이미 게임이 진행 중입니다.' });
      if (!startSession(room)) return send(ws, { type: 'error', message: '게임을 시작하려면 최소 2명이 필요합니다.' });
    }
    if (message.type === 'endGame' && room.hostId === ws.playerId) endSession(room);
  });
  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    const player = room?.players.find(item => item.id === ws.playerId);
    if (!room || !player) return;
    player.connected = false; room.sockets.delete(player.id);
    if (player.inHand && !player.folded) {
      player.folded = true; player.acted = true; addLog(room, `${player.name} 연결 종료 · FOLD`, 'system');
      if (room.phase === 'playing') continueGame(room);
    }
    if (room.hostId === player.id) room.hostId = room.players.find(item => item.connected && !item.isBot)?.id || null;
    broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach(room => {
    if (room.started && room.mode === 'tournament' && now >= room.levelEndsAt) {
      room.level = Math.min(room.level + 1, BLIND_LEVELS.length - 1);
      [room.sb, room.bb] = BLIND_LEVELS[room.level]; room.levelEndsAt = now + room.blindUpMinutes * 60000;
      addLog(room, `LEVEL UP · ${room.sb} / ${room.bb}`, 'system'); broadcast(room);
    }
    if (room.phase === 'playing' && room.turnEndsAt && now >= room.turnEndsAt) {
      const player = room.players[room.actionIndex]; if (player) performAction(room, player.id, 'fold', 0, true);
    } else if (room.phase === 'result' && now >= room.phaseEndsAt) {
      if (room.mode === 'tournament' && room.players.filter(inStartPool).length <= 1) finishTournament(room);
      else scheduleShuffle(room);
    }
    else if (room.phase === 'runout' && now >= room.phaseEndsAt) advanceAllInRunout(room);
    else if (room.phase === 'shuffling' && now >= room.phaseEndsAt) startHand(room);
  });
}, 250);

server.listen(PORT, HOST, () => console.log(`FELT CLUB server running at http://127.0.0.1:${PORT}`));
