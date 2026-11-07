import {
  LENGTHS, DAILY_LENGTH, makeSecret, dailySecret, todayKey, dailyNumber,
  score, guessProblem, remaining, remainingFrom, explain,
} from './game.js';
import {
  newRoomCode, cleanRoomCode, roomFromUrl, newSalt, fingerprint, crackedAt, outcome, checkReveal, sharedSecret,
} from './pvp.js';
import { joinRoom, online } from './room-net.js';
import { computeStats } from './stats.js';
import { load, save, newId, nameProblem } from './storage.js';
import { confetti } from './confetti.js';

const $ = (id) => document.getElementById(id);
const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let data = load();
let screen = 'home';
let game = null;       // the game on screen (also saved in player.inProgress)
let draft = '';        // digits typed but not yet guessed
let resumedAt = null;  // when the clock last started for `game`
let waitingWorker = null;
let statsPlayerId = '';
let statsLength = DAILY_LENGTH;
let gameView = 'solo'; // what the game screen shows: 'solo' (daily/single player) or 'pvp' (playing a friend)
let resultKind = 'solo';
let pendingRoom = null; // room code from an invite link, joined once there's a player

const player = () => data.players.find((p) => p.id === data.currentId) || null;
const today = () => todayKey();
const persist = () => save(data);

// ---------- screens ----------

const SCREENS = ['home', 'players', 'versus', 'game', 'stats', 'help', 'settings'];
function show(name) {
  if (screen === 'game' && name !== 'game' && gameView === 'solo') pauseClock();
  screen = name;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
  $('update-bar').classList.toggle('hidden', !waitingWorker || name === 'game');
  ({
    home: renderHome, players: renderPlayers, stats: renderStats, settings: renderSettings, versus: renderVersus,
    game: () => (gameView === 'pvp' ? renderVersusGame() : renderGame()),
  }[name] || (() => {}))();
}
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => {
  if (screen === 'players' && !player()) return; // need a player first
  show('home');
}));

let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 2500);
}

// A small yes/no (optionally with a text box) dialog. Resolves to false, true or the typed text.
function ask(text, { yes = 'Yes', input = null } = {}) {
  return new Promise((resolve) => {
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yes;
    let box = $('confirm').querySelector('input');
    box?.remove();
    if (input !== null) {
      box = document.createElement('input');
      box.maxLength = 20;
      box.value = input;
      $('confirm-text').after(box);
    }
    $('confirm').classList.remove('hidden');
    box?.focus();
    const done = (v) => {
      $('confirm').classList.add('hidden');
      $('confirm-yes').onclick = $('confirm-no').onclick = null;
      resolve(v);
    };
    $('confirm-yes').onclick = () => done(input !== null ? box.value : true);
    $('confirm-no').onclick = () => done(false);
  });
}

// ---------- home ----------

function todaysDaily(p) {
  return p?.games.find((g) => g.mode === 'daily' && g.date === today()) || null;
}

function renderHome() {
  const p = player();
  $('player-name').textContent = p ? p.name : '…';
  const n = dailyNumber(today());
  const done = todaysDaily(p);
  const live = p?.inProgress?.daily;
  $('daily-btn').textContent = done
    ? `Daily #${n} ${done.won ? `✓ ${done.guesses.length} guesses` : '✗'}`
    : live ? `Continue daily #${n}` : `Daily code #${n}`;
  $('practice-btn').textContent = p?.inProgress?.practice ? 'Continue single player' : 'Single player';
  $('versus-btn').classList.toggle('hidden', !online());
  $('versus-btn').textContent = vs ? `⚔️ Back to room ${vs.code}` : '⚔️ Play a friend';
}

on('player-chip', 'click', () => show('players'));
on('help-btn', 'click', () => show('help'));
on('help-done', 'click', () => show('home'));
on('settings-btn', 'click', () => show('settings'));
on('stats-btn', 'click', () => { statsPlayerId = data.currentId; show('stats'); });

on('daily-btn', 'click', () => {
  const p = player();
  const done = todaysDaily(p);
  if (done) return showResult(done);
  let g = p.inProgress?.daily;
  if (g && g.date !== today()) g = null; // yesterday's unfinished daily has expired
  if (!g) g = newGame('daily', DAILY_LENGTH);
  startGame(g);
});

on('practice-btn', 'click', () => startGame(player().inProgress?.practice || newGame('practice', data.settings.length)));

// ---------- players ----------

function playerSummary(p) {
  const s = computeStats(p.games);
  if (!s.played) return 'No games yet';
  return `${s.played} game${s.played === 1 ? '' : 's'}${s.avgGuesses ? ` · avg ${s.avgGuesses.toFixed(1)} guesses` : ''}`;
}

function renderPlayers() {
  $('players').querySelector('.back').style.visibility = player() ? '' : 'hidden';
  const list = $('player-list');
  list.innerHTML = data.players.length ? '' : '<li class="empty">Add a player to start. Everyone who plays on this phone can have their own stats.</li>';
  for (const p of data.players) {
    const li = document.createElement('li');
    li.className = `player-row${p.id === data.currentId ? ' current' : ''}`;
    li.innerHTML = `
      <button class="pick"><b>${esc(p.name)}</b><small>${esc(playerSummary(p))}</small></button>
      <button class="icon-btn mini rename" aria-label="Rename ${esc(p.name)}">✎</button>
      <button class="icon-btn mini delete" aria-label="Delete ${esc(p.name)}">🗑</button>`;
    li.querySelector('.pick').onclick = () => { data.currentId = p.id; persist(); show('home'); };
    li.querySelector('.rename').onclick = async () => {
      const name = await ask(`Rename ${p.name}:`, { yes: 'Save', input: p.name });
      if (name === false) return;
      const problem = nameProblem(name, data.players, p.id);
      if (problem) return toast(problem);
      p.name = name.trim();
      persist();
      renderPlayers();
    };
    li.querySelector('.delete').onclick = async () => {
      if (!await ask(`Delete ${p.name} and all their stats? This can't be undone.`, { yes: 'Delete' })) return;
      data.players = data.players.filter((x) => x.id !== p.id);
      if (data.currentId === p.id) data.currentId = data.players[0]?.id || '';
      persist();
      renderPlayers();
    };
    list.appendChild(li);
  }
}

on('add-player', 'submit', (e) => {
  e.preventDefault();
  const name = $('new-name').value;
  const problem = nameProblem(name, data.players);
  $('name-error').textContent = problem;
  if (problem) return;
  const first = !data.players.length;
  const p = { id: newId(), name: name.trim(), created: Date.now(), games: [], inProgress: {} };
  data.players.push(p);
  data.currentId = p.id;
  persist();
  $('new-name').value = '';
  $('new-name').blur();
  if (pendingRoom) {
    const code = pendingRoom;
    pendingRoom = null;
    joinRoomCode(code);
  } else if (first && !data.settings.seenHelp) {
    data.settings.seenHelp = true;
    persist();
    show('help');
  } else show('home');
});

// ---------- playing ----------

function newGame(mode, length) {
  const date = today();
  return {
    mode, length, date,
    secret: mode === 'daily' ? dailySecret(date, length) : makeSecret(length),
    guesses: [], notes: {}, elapsed: 0,
  };
}

function startGame(g) {
  const p = player();
  p.inProgress = { ...p.inProgress, [g.mode]: g };
  persist();
  game = g;
  draft = '';
  gameView = 'solo';
  $('entry-msg').textContent = '';
  show('game');
  resumedAt = performance.now();
}

function pauseClock() {
  if (game && resumedAt != null) {
    game.elapsed += performance.now() - resumedAt;
    resumedAt = null;
    persist();
  }
}
document.addEventListener('visibilitychange', () => {
  if (screen !== 'game' || gameView !== 'solo') return;
  if (document.hidden) pauseClock();
  else resumedAt = performance.now();
});

// The two feedback numbers for a guess, in the "Right spot" and "Wrong spot" columns.
function countsHtml(f) {
  if (!f) return '<span class="count pending" title="Waiting">…</span><span class="count pending" title="Waiting">…</span>';
  const { exact, close } = f;
  return `<span class="count exact${exact ? '' : ' zero'}">${exact}</span><span class="count close${close ? '' : ' zero'}">${close}</span>`;
}

function showExplanation(i) {
  let text;
  if (gameView === 'pvp') {
    const g = vs.guesses[i], f = vs.feedback[i];
    text = f ? explain(g, f) : `${g}: waiting for ${oppName()}'s phone to check it…`;
    if (f && data.settings.showLeft) {
      const n = remainingFrom(vs.length, vs.guesses.slice(0, i + 1), vs.feedback);
      text += ` ${n.toLocaleString()} possible code${n === 1 ? '' : 's'} left.`;
    }
  } else {
    const g = game.guesses[i];
    text = explain(g, score(game.secret, g));
    if (data.settings.showLeft) {
      const n = remaining(game.secret, game.guesses.slice(0, i + 1));
      text += ` ${n.toLocaleString()} possible code${n === 1 ? '' : 's'} left.`;
    }
  }
  // Shown in the list, under the guess it explains, so it scrolls with the guesses.
  const list = $('guesses');
  list.querySelector('.explain')?.remove();
  const rows = list.querySelectorAll('.guess-row');
  rows.forEach((row, j) => row.classList.toggle('picked', j === i));
  const li = document.createElement('li');
  li.className = 'explain';
  li.setAttribute('role', 'status');
  li.textContent = text;
  rows[i]?.after(li);
}

function tilesHtml(code) {
  return [...code].map((d) => `<span class="tile">${d}</span>`).join('');
}

function renderGame(justGuessed = false) {
  $('vs-status').classList.add('hidden');
  $('vs-panel').classList.add('hidden');
  $('room-menu-btn').classList.add('hidden');
  $('guess-head-label').textContent = 'Your guess';
  $('giveup-btn').classList.remove('hidden');
  $('entry').classList.remove('hidden');
  $('game-title').textContent = game.mode === 'daily'
    ? `Daily #${dailyNumber(game.date)}`
    : `Single player · ${game.length} digits`;
  const list = $('guesses');
  list.innerHTML = '';
  game.guesses.forEach((g, i) => {
    const s = score(game.secret, g);
    const li = document.createElement('li');
    li.className = `guess-row grid len${game.length}${justGuessed && i === game.guesses.length - 1 ? ' new' : ''}`;
    li.setAttribute('aria-label', explain(g, s));
    li.innerHTML = `<span class="num">${i + 1}</span><span class="tiles">${tilesHtml(g)}</span>${countsHtml(s)}`;
    li.onclick = () => showExplanation(i);
    list.appendChild(li);
  });
  $('guess-head').classList.toggle('hidden', !game.guesses.length);
  if (!game.guesses.length) {
    list.innerHTML = `<li class="empty">Type any ${game.length} different digits to start.<br>After each guess you'll see how many of your digits are in the <b class="t-exact">right spot</b> and how many are in the code but in the <b class="t-close">wrong spot</b>.</li>`;
  } else showExplanation(game.guesses.length - 1);
  list.scrollTop = list.scrollHeight;
  renderEntry();
}

// What the keypad is for right now.
function entryTarget() {
  if (gameView === 'pvp') {
    return vs ? { length: vs.length, notes: vs.notes, go: vs.phase === 'setcode' ? 'Lock in' : 'Guess', showNotes: vs.phase === 'play' } : null;
  }
  return game ? { length: game.length, notes: game.notes, go: 'Guess', showNotes: true } : null;
}

function entryOpen() {
  if (gameView !== 'pvp') return Boolean(game);
  return Boolean(vs) && ((vs.phase === 'setcode' && !sameCode()) || (vs.phase === 'play' && !myDone()));
}

function renderEntry() {
  const t = entryTarget();
  if (!t) return;
  const slots = $('slots');
  slots.innerHTML = '';
  for (let i = 0; i < t.length; i++) {
    const s = document.createElement('span');
    s.className = `tile slot${i === draft.length ? ' next' : ''}${draft[i] ? ' filled' : ''}`;
    s.textContent = draft[i] || '';
    slots.appendChild(s);
  }
  // Notes: 0 = unknown, 1 = ruled out, 2 = definitely in.
  const notes = $('notes');
  notes.classList.toggle('hidden', !t.showNotes);
  notes.innerHTML = '<span class="notes-label">Notes</span>';
  for (const d of '0123456789') {
    const b = document.createElement('button');
    const state = t.notes[d] || 0;
    b.className = `note n${state}`;
    b.textContent = d;
    b.setAttribute('aria-label', `${d}: ${['no note', 'not in the code', 'in the code'][state]}`);
    b.onclick = () => { t.notes[d] = (state + 1) % 3; persist(); renderEntry(); };
    notes.appendChild(b);
  }
  const pad = $('keypad');
  pad.innerHTML = '';
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go']) {
    const b = document.createElement('button');
    b.className = `key${k === 'go' ? ' go' : k === 'del' ? ' del' : ''}${t.showNotes && t.notes[k] === 1 ? ' out' : ''}${t.showNotes && t.notes[k] === 2 ? ' in' : ''}`;
    b.textContent = k === 'del' ? '⌫' : k === 'go' ? t.go : k;
    if (k === 'del') b.setAttribute('aria-label', 'Delete');
    b.disabled = (k.length === 1 && (draft.includes(k) || draft.length >= t.length))
      || (k === 'go' && draft.length !== t.length) || (k === 'del' && !draft.length);
    b.onclick = () => press(k);
    pad.appendChild(b);
  }
}

function press(k) {
  if (screen !== 'game' || !entryOpen() || !$('result').classList.contains('hidden')) return;
  const t = entryTarget();
  $('entry-msg').textContent = '';
  if (k === 'del') draft = draft.slice(0, -1);
  else if (k === 'go') return gameView === 'pvp' ? versusSubmit() : submit();
  else if (draft.length < t.length && !draft.includes(k)) draft += k;
  renderEntry();
}

document.addEventListener('keydown', (e) => {
  if (screen !== 'game' || e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  if (/^\d$/.test(e.key)) press(e.key);
  else if (e.key === 'Backspace') press('del');
  else if (e.key === 'Enter') { e.preventDefault(); press('go'); }
});

function submit() {
  const problem = guessProblem(draft, game.length);
  if (problem) return void ($('entry-msg').textContent = problem);
  if (game.guesses.includes(draft)) {
    $('entry-msg').textContent = `You already tried ${draft}.`;
    return;
  }
  game.guesses.push(draft);
  draft = '';
  persist();
  renderGame(true);
  if (game.guesses.at(-1) === game.secret) finish(true);
}

on('giveup-btn', 'click', async () => {
  if (gameView === 'pvp') return versusGiveUp();
  if (!game) return;
  if (await ask('Give up and see the code? It counts as a loss in your stats.', { yes: 'Give up' })) finish(false);
});

function finish(won) {
  pauseClock();
  const p = player();
  const record = {
    mode: game.mode, length: game.length, date: game.date, at: Date.now(),
    secret: game.secret, guesses: game.guesses, won, ms: Math.round(game.elapsed),
  };
  p.games.push(record);
  delete p.inProgress[game.mode];
  persist();
  game = null;
  if (won) {
    confetti(['#30a46c', '#f5b400', '#6c63ff', '#7cc6fe', '#ffb4a2']);
    if (data.settings.vibrate) navigator.vibrate?.([30, 60, 30]);
  }
  showResult(record);
}

// ---------- result ----------

let lastResult = null;

function formatTime(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function shareText(r) {
  const head = r.mode === 'daily' ? `Vault #${dailyNumber(r.date)}` : `Vault single player (${r.length} digits)`;
  const result = r.won ? `${r.guesses.length} guess${r.guesses.length === 1 ? '' : 'es'}` : 'gave up';
  const rows = r.guesses.map((g) => {
    const { exact, close } = score(r.secret, g);
    return `🟢${exact} 🟡${close}`;
  });
  return `${head} · ${result}\n🟢 right spot · 🟡 wrong spot\n${rows.join('\n')}`;
}

function showResult(r) {
  lastResult = r;
  resultKind = 'solo';
  $('result-label').classList.add('hidden');
  $('again-btn').textContent = 'Play again';
  $('share-btn').classList.remove('hidden');
  $('result-stats-btn').textContent = '📊 Stats';
  $('result-home-btn').textContent = 'Menu';
  const p = player();
  $('result-title').textContent = r.won ? (r.guesses.length === 1 ? 'First try?!' : 'Cracked it!') : 'The code was…';
  $('result-code').innerHTML = tilesHtml(r.secret);
  $('result-text').textContent = r.won
    ? `${r.guesses.length} guesses in ${formatTime(r.ms)}.`
    : `Better luck next time. You made ${r.guesses.length} guess${r.guesses.length === 1 ? '' : 'es'}.`;
  const s = computeStats(p.games, { length: r.length, today: today() });
  const bits = [];
  if (s.avgGuesses) bits.push(`${p.name}'s average for ${r.length} digits: ${s.avgGuesses.toFixed(1)} guesses`);
  if (r.mode === 'daily' && s.streak.current) bits.push(`daily streak: ${s.streak.current}`);
  $('result-extra').textContent = bits.join(' · ');
  $('again-btn').classList.toggle('hidden', r.mode === 'daily');
  $('result').classList.remove('hidden');
}

const closeResult = () => $('result').classList.add('hidden');
on('again-btn', 'click', () => {
  closeResult();
  if (resultKind === 'pvp') rematch();
  else startGame(newGame('practice', data.settings.length));
});
on('result-home-btn', 'click', async () => {
  if (resultKind === 'pvp') {
    if (!await leaveRoom()) return;
    closeResult();
    return;
  }
  closeResult();
  show('home');
});
on('result-stats-btn', 'click', () => {
  closeResult();
  if (resultKind === 'pvp') return renderVersusGame();
  statsPlayerId = data.currentId;
  statsLength = lastResult?.length ?? DAILY_LENGTH;
  show('stats');
});
on('share-btn', 'click', async () => {
  const text = shareText(lastResult);
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Copied. Paste it anywhere.'); }
  } catch (err) {
    if (err?.name !== 'AbortError') toast("Couldn't share on this phone.");
  }
});

// ---------- play a friend ----------
//
// Each phone keeps its own side of the game in `vs` (saved, so a reload
// rejoins the room) and sends a snapshot of what the other phone may see
// whenever it changes, plus every few seconds in case a message was missed.
// The other phone works everything out from the snapshots, so messages can
// arrive twice, late or not at all without anything going wrong.

let vs = data.versus;
let room = null;           // the live connection
let roomState = 'off';     // 'connecting' | 'on' | 'error'
let roomError = '';
let heartbeat = null;
let vsTab = 'mine';        // which guesses the game screen lists: 'mine' or 'theirs'
let vsLength = DAILY_LENGTH;
let vsStyle = 'own'; // 'own': each sets a code for the other; 'same': both crack one random code
let locking = false;
const sameCode = () => vs?.style === 'same';

const oppName = () => vs?.opp?.name || 'your friend';
const vsPlayer = () => data.players.find((p) => p.id === vs?.playerId) || player();
const myDone = () => Boolean(vs) && (vs.gaveUp || crackedAt(vs.feedback, vs.length) != null);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'es'}`;

function freshRound(round) {
  return {
    round, phase: 'setcode', secret: '', salt: '', hash: '', seed: '', startedAt: 0,
    guesses: [], times: [], feedback: [], answers: [], gaveUp: false, notes: {},
    result: null, verify: '', checked: false, recordAt: null,
  };
}

function freshOpp(o, round) {
  return {
    id: o?.id || '', name: o?.name || '', present: o?.present || false,
    round, hash: '', guesses: [], times: [], answers: [], gaveUp: false, reveal: null,
  };
}

function startRoom(code, host) {
  vs = data.versus = {
    code, host, length: host ? vsLength : 0, style: host ? vsStyle : '', meId: newId(), playerId: data.currentId,
    ...freshRound(1), phase: 'waiting', opp: freshOpp(null, 1),
  };
  persist();
  show('versus');
  connect();
}

function joinRoomCode(code) {
  if (vs?.code === code) return openRoom();
  if (vs) {
    toast(`Leave room ${vs.code} first.`);
    return openRoom();
  }
  startRoom(code, false);
}

function openRoom() {
  if (!vs) return show('versus');
  if (vs.phase === 'waiting') return show('versus');
  gameView = 'pvp';
  draft = '';
  $('entry-msg').textContent = '';
  show('game');
}

async function connect() {
  if (room || !vs) return;
  roomState = 'connecting';
  refresh();
  const me = { id: vs.meId, name: vsPlayer()?.name || 'Player' };
  try {
    const r = await joinRoom(vs.code, me, { onPlayers, onMessage });
    if (!vs) return void r.leave(); // left while connecting
    room = r;
    roomState = 'on';
    sendState();
    heartbeat = setInterval(sendState, 4000);
  } catch (err) {
    roomState = 'error';
    roomError = err.message;
  }
  refresh();
}

async function leaveRoom() {
  if (!vs) return true;
  if ((vs.phase === 'play' || vs.phase === 'locked') && !await ask("Leave the room? This game won't count.", { yes: 'Leave' })) return false;
  clearInterval(heartbeat);
  room?.leave();
  room = null;
  vs = data.versus = null;
  roomState = 'off';
  persist();
  show('home');
  return true;
}

function sendState() {
  if (!room || !vs) return;
  room.send('state', {
    round: vs.round, name: vsPlayer()?.name, host: vs.host, length: vs.length, style: vs.style,
    seed: vs.host && sameCode() ? vs.seed : '',
    hash: vs.hash, guesses: vs.guesses, times: vs.times, answers: vs.answers, gaveUp: vs.gaveUp,
    reveal: vs.phase === 'done' ? { secret: vs.secret, salt: vs.salt } : null,
  });
}

function onPlayers(list) {
  if (!vs) return;
  const everyone = [...list].sort((a, b) => a.joinedAt - b.joinedAt);
  if (!vs.opp.id && everyone.findIndex((p) => p.id === vs.meId) >= 2) {
    toast('That room already has two players.');
    clearInterval(heartbeat);
    room?.leave();
    room = null;
    vs = data.versus = null;
    persist();
    return show('versus');
  }
  const others = everyone.filter((p) => p.id !== vs.meId);
  const o = vs.opp.id ? others.find((p) => p.id === vs.opp.id) : others[0];
  if (o && !vs.opp.id) vs.opp.id = o.id;
  if (o) vs.opp.name = o.name;
  vs.opp.present = Boolean(o);
  advance();
  persist();
  sendState(); // so someone who just arrived gets everything straight away
  refresh();
}

function onMessage(type, d, from) {
  if (type !== 'state' || !vs || !d) return;
  if (vs.opp.id && from !== vs.opp.id) return;
  if (!vs.opp.id) vs.opp.id = from;
  vs.opp.name = d.name || vs.opp.name;
  vs.opp.present = true;
  if (!vs.host && d.host) {
    if (!vs.length) vs.length = d.length;
    if (!vs.style) vs.style = d.style || 'own';
    if (vs.phase === 'waiting' && d.round > vs.round) Object.assign(vs, freshRound(d.round), { phase: 'waiting' });
  }
  if (d.round !== vs.round) {
    // Higher: they've asked for a rematch. Lower: they'll catch up when they see ours.
    if (d.round > vs.round) vs.opp.round = d.round;
    persist();
    return refresh();
  }
  Object.assign(vs.opp, {
    round: d.round, hash: d.hash || '', guesses: d.guesses || [], times: d.times || [],
    answers: d.answers || [], gaveUp: Boolean(d.gaveUp), reveal: d.reveal || null,
  });
  // Same code: the room owner's seed gives this round's code.
  if (sameCode() && !vs.host && d.host && d.seed && !vs.secret) {
    vs.seed = d.seed;
    vs.secret = sharedSecret(d.seed, vs.round, vs.length);
  }
  let changed = answerTheirGuesses();
  vs.feedback = sameCode()
    ? vs.guesses.map((g) => (vs.secret ? score(vs.secret, g) : null))
    : vs.guesses.map((_, i) => vs.opp.answers[i] || null);
  changed = advance() || changed;
  persist();
  if (changed) sendState();
  verifyReveal();
  refresh();
}

// Score their guesses at my code (only my phone knows it).
function answerTheirGuesses() {
  if (!vs.secret) return false;
  let changed = false;
  while (vs.answers.length < vs.opp.guesses.length) {
    vs.answers.push(score(vs.secret, String(vs.opp.guesses[vs.answers.length])));
    changed = true;
  }
  return changed;
}

// Move the game along: waiting → set codes → play → done. Returns true if anything changed.
function advance() {
  let changed = false;
  if (vs.phase === 'waiting' && vs.opp.present && vs.length) {
    vs.phase = 'setcode';
    changed = true;
    if (screen === 'versus') openRoom();
  }
  if (sameCode() && vs.phase === 'setcode') {
    if (vs.host && !vs.secret) {
      vs.seed = newSalt();
      vs.secret = sharedSecret(vs.seed, vs.round, vs.length);
      changed = true;
    }
    // Start once both phones are in this round (the owner waits to hear from the friend).
    if (vs.secret && vs.opp.present && (!vs.host || vs.opp.round === vs.round)) {
      vs.phase = 'play';
      vs.startedAt = Date.now();
      changed = true;
    }
  }
  if (vs.phase === 'locked' && vs.opp.hash) {
    vs.phase = 'play';
    vs.startedAt = Date.now();
    changed = true;
  }
  if (vs.phase === 'play') {
    const r = outcome(vs.length,
      { feedback: vs.feedback, times: vs.times, gaveUp: vs.gaveUp },
      { feedback: vs.answers, times: vs.opp.times, gaveUp: vs.opp.gaveUp });
    if (r) {
      vs.phase = 'done';
      vs.result = r;
      recordVersus();
      changed = true;
      if (r.result === 'win') {
        confetti(['#30a46c', '#f5b400', '#6c63ff', '#7cc6fe', '#ffb4a2']);
        if (data.settings.vibrate) navigator.vibrate?.([30, 60, 30]);
      }
      setTimeout(showVersusResult, 600); // let the last feedback show first
    }
  }
  return changed;
}

function recordVersus() {
  const p = vsPlayer();
  if (!p) return;
  const n = crackedAt(vs.feedback, vs.length);
  const at = Date.now();
  p.games.push({
    mode: 'pvp', length: vs.length, date: today(), at,
    secret: sameCode() ? vs.secret : vs.opp.reveal?.secret || null, guesses: n ? vs.guesses.slice(0, n) : [...vs.guesses],
    won: n != null, ms: n ? vs.times[n - 1] : at - vs.startedAt,
    result: vs.result.result, opponent: oppName(),
  });
  vs.recordAt = at;
}

// Once their code is revealed, check it against their fingerprint and feedback.
async function verifyReveal() {
  if (vs?.phase !== 'done' || !vs.opp.reveal || vs.checked || sameCode()) return;
  vs.checked = true;
  const round = vs.round;
  const problem = await checkReveal(round, vs.opp.reveal, vs.opp.hash, vs.guesses, vs.feedback);
  if (!vs || vs.round !== round) return;
  vs.verify = problem;
  const rec = vsPlayer()?.games.find((g) => g.at === vs.recordAt);
  if (rec) rec.secret = vs.opp.reveal.secret;
  persist();
  refresh();
}

async function versusSubmit() {
  const problem = guessProblem(draft, vs.length);
  if (problem) return void ($('entry-msg').textContent = problem);
  if (vs.phase === 'setcode') {
    if (locking) return;
    locking = true;
    const round = vs.round;
    const secret = draft, salt = newSalt();
    const hash = await fingerprint(round, secret, salt);
    locking = false;
    if (!vs || vs.round !== round || vs.phase !== 'setcode') return;
    Object.assign(vs, { secret, salt, hash, phase: 'locked' });
  } else {
    if (vs.guesses.includes(draft)) return void ($('entry-msg').textContent = `You already tried ${draft}.`);
    vs.guesses.push(draft);
    vs.times.push(Date.now() - vs.startedAt);
    vs.feedback.push(sameCode() ? score(vs.secret, draft) : null);
  }
  draft = '';
  answerTheirGuesses();
  advance();
  persist();
  sendState();
  renderVersusGame(vs.phase === 'play');
}

async function versusGiveUp() {
  if (vs?.phase !== 'play' || myDone()) return;
  if (!await ask(`Give up? ${oppName()} wins.`, { yes: 'Give up' })) return;
  vs.gaveUp = true;
  advance();
  persist();
  sendState();
  refresh();
}

function rematch() {
  if (!vs) return;
  const round = vs.opp.round > vs.round ? vs.opp.round : vs.round + 1;
  const o = vs.opp;
  Object.assign(vs, freshRound(round), { phase: o.present ? 'setcode' : 'waiting' });
  vs.opp = freshOpp(o, o.round); // their real round: a same-code room waits until they're in this one
  advance();
  persist();
  sendState();
  openRoom();
}

// Redraw whatever is showing after the room changes.
function refresh() {
  if (screen === 'versus') renderVersus();
  else if (screen === 'game' && gameView === 'pvp') renderVersusGame();
  else if (screen === 'home') renderHome();
  if (resultKind === 'pvp' && !$('result').classList.contains('hidden')) showVersusResult();
}

// ----- lobby screen -----

function renderVersus() {
  $('lobby-start').classList.toggle('hidden', Boolean(vs));
  $('lobby-room').classList.toggle('hidden', !vs);
  const chips = $('vs-length');
  chips.innerHTML = '';
  for (const len of LENGTHS) {
    const b = document.createElement('button');
    b.className = `chip${len === vsLength ? ' on' : ''}`;
    b.textContent = len;
    b.setAttribute('aria-label', `${len} digits`);
    b.onclick = () => { vsLength = len; renderVersus(); };
    chips.appendChild(b);
  }
  $('vs-style').querySelectorAll('.style-opt').forEach((b) => {
    b.classList.toggle('on', b.dataset.style === vsStyle);
    b.setAttribute('aria-checked', String(b.dataset.style === vsStyle));
    b.onclick = () => { vsStyle = b.dataset.style; renderVersus(); };
  });
  if (!vs) return;
  if (vs.phase !== 'waiting') return openRoom();
  $('room-code').textContent = vs.code;
  $('room-style').textContent = vs.style ? `${styleName(vs.style)} · ${vs.length} digits` : '';
  $('share-room').classList.toggle('hidden', !vs.host);
  $('room-status').textContent = roomState === 'connecting' ? 'Connecting…'
    : roomState === 'error' ? `Couldn't connect (${roomError}). Check your internet and try again.`
      : vs.host ? 'Waiting for your friend to join…' : 'Joining your friend…';
}

on('versus-btn', 'click', () => (vs ? openRoom() : show('versus')));
on('create-room', 'click', () => startRoom(newRoomCode(), true));
on('join-form', 'submit', (e) => {
  e.preventDefault();
  const code = cleanRoomCode($('join-code').value);
  if (!code) return toast('Room codes are 5 letters and numbers.');
  $('join-code').value = '';
  $('join-code').blur();
  joinRoomCode(code);
});
on('leave-room', 'click', () => leaveRoom());
// The gear while playing a friend: room details, give up, invite, leave.
on('room-menu-btn', 'click', () => {
  if (!vs) return;
  $('room-menu-title').textContent = `Room ${vs.code}`;
  $('room-menu-info').textContent = `vs ${oppName()} · ${styleName(vs.style)} · ${vs.length} digits`;
  $('menu-giveup').classList.toggle('hidden', !(vs.phase === 'play' && !myDone()));
  $('room-menu').classList.remove('hidden');
});
const closeRoomMenu = () => $('room-menu').classList.add('hidden');
on('menu-close', 'click', closeRoomMenu);
on('room-menu', 'click', (e) => { if (e.target === $('room-menu')) closeRoomMenu(); });
on('menu-giveup', 'click', () => { closeRoomMenu(); versusGiveUp(); });
on('menu-invite', 'click', () => { closeRoomMenu(); shareInvite(); });
on('menu-leave', 'click', () => { closeRoomMenu(); leaveRoom(); });

on('share-room', 'click', () => shareInvite());
async function shareInvite() {
  const url = inviteLink(vs.code);
  const text = sameCode()
    ? `Play Vault with me! Let's see who cracks the code first. Room ${vs.code}:`
    : `Play Vault with me! Crack my code before I crack yours. Room ${vs.code}:`;
  try {
    if (navigator.share) await navigator.share({ text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Invite link copied. Send it to your friend.'); }
  } catch (err) {
    if (err?.name !== 'AbortError') toast(`Couldn't share. Tell your friend the room code: ${vs.code}`);
  }
}

function styleName(style) {
  return style === 'same' ? '🎯 Same code' : '🔒 Each sets a code';
}

function inviteLink(code) {
  const params = new URLSearchParams(location.search);
  params.set('room', code);
  return `${location.origin}${location.pathname}?${params}`;
}

// ----- game screen -----

function rowHtml(i, guess, f, isNew) {
  return `<li class="guess-row grid len${guess.length}${isNew ? ' new' : ''}" data-i="${i}">
    <span class="num">${i + 1}</span><span class="tiles">${tilesHtml(guess)}</span>${countsHtml(f)}</li>`;
}

function renderVersusGame(justGuessed = false) {
  if (!vs) return show('home');
  const o = vs.opp, name = esc(oppName());
  const playing = vs.phase === 'play' || vs.phase === 'done';
  $('game-title').textContent = `vs ${oppName()}`;
  const hideTheirs = sameCode() && vs.phase !== 'done'; // their guesses would give the code away
  $('giveup-btn').classList.add('hidden'); // giving up is in the room menu (gear)
  $('room-menu-btn').classList.remove('hidden');
  $('entry').classList.toggle('hidden', !entryOpen());

  // One short status line under the title; anything longer goes in the panel at the bottom.
  const mine = crackedAt(vs.feedback, vs.length), theirs = crackedAt(vs.answers, vs.length);
  let sub = '';
  if (vs.phase === 'waiting') sub = `Waiting for ${name}…`;
  else if (vs.phase === 'setcode') sub = sameCode() ? `🎯 Same code · waiting for ${name}…` : 'Set your secret code';
  else if (vs.phase === 'locked') sub = `🔒 Locked in · waiting for ${name}…`;
  else if (vs.phase === 'done') sub = `<b>${{ win: 'You win! 🏆', lose: `${name} wins`, draw: "It's a draw" }[vs.result.result]}</b>`;
  else {
    const side = (who, n, cracked, gaveUp) => `${who} ${cracked ? `✓ ${cracked}` : gaveUp ? 'gave up' : n}`;
    sub = `${side('You', vs.guesses.length, mine, vs.gaveUp)} · ${side(name, o.guesses.length, theirs, o.gaveUp)} <small>guesses</small>`;
  }
  if (!o.present && vs.phase !== 'done') sub += ` · <span class="warn">${name} offline</span>`;
  $('vs-status').innerHTML = sub;
  $('vs-status').classList.remove('hidden');

  let panel = '';
  if (vs.phase === 'done') {
    panel = `<p><b>${{ win: 'You win!', lose: `${name} wins.`, draw: "It's a draw." }[vs.result.result]}</b> ${esc(vs.result.reason)}</p>`
      + (o.round > vs.round ? `<p><b>${name} wants a rematch!</b></p>` : '')
      + '<div class="vs-actions"><button class="btn small" data-act="rematch">Rematch</button><button class="btn small secondary" data-act="leave">Leave</button></div>';
  } else if (vs.phase === 'play' && (mine || vs.gaveUp)) {
    panel = `<p>${mine ? `You cracked it in ${mine}!` : 'You gave up.'} Waiting for ${name} to finish…</p>`;
  }
  $('vs-panel').innerHTML = panel;
  $('vs-panel').classList.toggle('hidden', !panel);
  $('vs-panel').querySelector('[data-act="rematch"]')?.addEventListener('click', rematch);
  $('vs-panel').querySelector('[data-act="leave"]')?.addEventListener('click', () => leaveRoom());

  // List
  const list = $('guesses');
  const codeCard = (label, code) => `<li class="code-card"><span>${label}</span><span class="tiles">${tilesHtml(code)}</span></li>`;
  let rows = [];
  if (vs.phase === 'setcode' && sameCode()) {
    list.innerHTML = `<li class="empty">You'll both crack the same random code. You start as soon as ${name} is ready.</li>`;
  } else if (vs.phase === 'setcode') {
    list.innerHTML = `<li class="empty">Pick ${vs.length} different digits and tap <b>Lock in</b>.<br>Your code stays on this phone until the game ends.</li>`;
  } else if (vs.phase === 'locked') {
    list.innerHTML = codeCard('Your code 🔒', vs.secret)
      + `<li class="empty">When ${name} has set theirs, you both start guessing. Fewest guesses wins; if it's a tie, the faster player wins.</li>`;
  } else if (vsTab === 'theirs') {
    if (hideTheirs) {
      list.innerHTML = `<li class="empty">${name} has made ${plural(o.guesses.length, 'guess')}.<br>You'll see them when the game ends, so nobody can copy.</li>`;
    } else {
      rows = o.guesses.map((g, i) => rowHtml(i, String(g), vs.answers[i], false));
      list.innerHTML = codeCard(sameCode() ? 'The code' : 'Your code', vs.secret)
        + (rows.length ? rows.join('') : `<li class="empty">${name} hasn't guessed yet.</li>`);
    }
  } else {
    rows = vs.guesses.map((g, i) => rowHtml(i, g, vs.feedback[i], justGuessed && i === vs.guesses.length - 1));
    list.innerHTML = rows.length ? rows.join('')
      : `<li class="empty">Go! ${sameCode() ? `Crack the ${vs.length}-digit code before ${name} does.` : `Guess ${name}'s ${vs.length}-digit code.`}<br>Each guess gets feedback: <b class="t-exact">right spot</b> and <b class="t-close">wrong spot</b>.</li>`;
    list.querySelectorAll('.guess-row').forEach((row) => { row.onclick = () => showExplanation(Number(row.dataset.i)); });
    if (vs.guesses.length) showExplanation(vs.guesses.length - 1);
  }
  // The column heading doubles as the switch between your guesses and theirs.
  $('guess-head').classList.toggle('hidden', !playing);
  $('guess-head-label').innerHTML = `<span class="who-switch" role="tablist">
    <button class="who${vsTab === 'mine' ? ' on' : ''}" data-tab="mine" role="tab">You</button><button class="who${vsTab === 'theirs' ? ' on' : ''}" data-tab="theirs" role="tab">${name} <small>${o.guesses.length}</small></button></span>`;
  $('guess-head-label').querySelectorAll('.who').forEach((t) => { t.onclick = () => { vsTab = t.dataset.tab; renderVersusGame(); }; });
  list.scrollTop = list.scrollHeight;
  if (entryOpen()) renderEntry();
}

function showVersusResult() {
  if (!vs || vs.phase !== 'done') return;
  resultKind = 'pvp';
  const o = vs.opp, name = oppName();
  const mine = crackedAt(vs.feedback, vs.length), theirs = crackedAt(vs.answers, vs.length);
  $('result-title').textContent = { win: 'You win! 🏆', lose: `${name} wins`, draw: "It's a draw" }[vs.result.result];
  $('result-label').textContent = sameCode() ? 'The code' : `${name}'s code`;
  $('result-label').classList.remove('hidden');
  $('result-code').innerHTML = tilesHtml((sameCode() ? vs.secret : o.reveal?.secret) || '?'.repeat(vs.length));
  const side = (n, gaveUp) => (n ? plural(n, 'guess') : gaveUp ? 'gave up' : 'not cracked');
  $('result-text').textContent = `You: ${side(mine, vs.gaveUp)} · ${name}: ${side(theirs, o.gaveUp)}`;
  $('result-extra').textContent = [
    vs.result.reason,
    vs.verify && `⚠️ ${vs.verify}`,
    o.round > vs.round && `${name} wants a rematch!`,
  ].filter(Boolean).join(' ');
  $('again-btn').textContent = 'Rematch';
  $('again-btn').classList.remove('hidden');
  $('share-btn').classList.add('hidden');
  $('result-stats-btn').textContent = 'See the guesses';
  $('result-home-btn').textContent = 'Leave room';
  $('result').classList.remove('hidden');
}

// ---------- stats ----------

const fmt = (x, digits = 1) => (x == null ? '–' : x.toFixed(digits));
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);

function renderStats() {
  const sel = $('stats-player');
  sel.innerHTML = data.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if (!data.players.some((p) => p.id === statsPlayerId)) statsPlayerId = data.currentId;
  sel.value = statsPlayerId;

  const chips = $('stats-length');
  chips.innerHTML = '';
  for (const len of [null, ...LENGTHS]) {
    const b = document.createElement('button');
    b.className = `chip${len === statsLength ? ' on' : ''}`;
    b.textContent = len == null ? 'All' : `${len} digits`;
    b.onclick = () => { statsLength = len; renderStats(); };
    chips.appendChild(b);
  }

  const p = data.players.find((x) => x.id === statsPlayerId);
  const s = computeStats(p?.games || [], { length: statsLength, today: today() });
  const body = $('stats-body');
  if (!s.played) {
    body.innerHTML = `<p class="empty">No ${statsLength ? `${statsLength}-digit ` : ''}games yet for ${esc(p?.name || 'this player')}.</p>`;
  } else {
    const maxBar = Math.max(1, ...s.distribution.map((d) => d.count));
    const top = (list, n = 3) => (list.length
      ? `<ol class="top">${list.slice(0, n).map((x) => `<li><b class="mono">${esc(x.value)}</b> <span>×${x.count}</span></li>`).join('')}</ol>`
      : '<p class="fine">Not enough games yet.</p>');
    const recent = (p.games.filter((g) => statsLength == null || g.length === statsLength)).slice(-5).reverse();
    body.innerHTML = `
      <div class="tiles-grid">
        <div class="stat"><b>${s.played}</b><small>played</small></div>
        <div class="stat"><b>${pct(s.winRate)}</b><small>cracked</small></div>
        <div class="stat"><b>${fmt(s.avgGuesses)}</b><small>avg guesses per crack</small></div>
        <div class="stat"><b>${s.best ?? '–'}</b><small>fewest guesses</small></div>
        <div class="stat"><b>${s.avgSeconds == null ? '–' : formatTime(s.avgSeconds * 1000)}</b><small>avg time</small></div>
        <div class="stat"><b>${s.streak.current}<span class="sub">/${s.streak.best}</span></b><small>daily streak / best</small></div>
      </div>
      <p class="fine center">Last 10 cracks: avg ${fmt(s.recentAvg)} guesses · Gave up ${s.gaveUp} time${s.gaveUp === 1 ? '' : 's'}</p>
      ${s.versus.win + s.versus.lose + s.versus.draw ? `<p class="fine center">⚔️ Against friends: <b>${s.versus.win}</b> won · <b>${s.versus.lose}</b> lost${s.versus.draw ? ` · <b>${s.versus.draw}</b> drawn` : ''}</p>` : ''}

      <h3>Guesses to crack</h3>
      <div class="dist">${s.distribution.map((d) => `
        <span class="dist-label">${d.label}</span>
        <span class="dist-bar">${d.count ? `<i style="width:${Math.max(8, (d.count / maxBar) * 100)}%">${d.count}</i>` : ''}</span>`).join('')}
      </div>

      <h3>Favourite openings</h3>
      <div class="card openers">
        <div><h4>First guess</h4>${top(s.firsts)}</div>
        <div><h4>Second guess</h4>${top(s.seconds)}</div>
        <div class="wide"><h4>First two guesses together</h4>${top(s.firstTwo)}</div>
      </div>

      <h3>Sharpness <span class="score">${pct(s.sharpness)}</span></h3>
      <p class="fine">How often a guess (after the first) could still have been the code, given the feedback so far. Higher means no wasted guesses.</p>

      <h3>Recent games</h3>
      <ul class="recent">${recent.map((g) => `
        <li><span>${g.mode === 'daily' ? `Daily #${dailyNumber(g.date)}` : g.mode === 'pvp' ? `vs ${esc(g.opponent)} · ${{ win: 'won', lose: 'lost', draw: 'draw' }[g.result]}` : `Single player · ${g.length}`}</span>
        <span class="tiles small">${tilesHtml(g.secret || '?'.repeat(g.length))}</span>
        <b>${g.won ? `${g.guesses.length} guesses` : g.mode === 'pvp' ? 'not cracked' : 'gave up'}</b></li>`).join('')}
      </ul>`;
  }

  const rows = data.players.map((pl) => ({ pl, s: computeStats(pl.games, { length: statsLength, today: today() }) }))
    .sort((a, b) => (a.s.avgGuesses ?? 99) - (b.s.avgGuesses ?? 99));
  $('compare').innerHTML = `
    <thead><tr><th>Player</th><th>Played</th><th>Cracked</th><th>Avg</th><th>Best</th><th>Fav opener</th></tr></thead>
    <tbody>${rows.map(({ pl, s: t }) => `<tr${pl.id === statsPlayerId ? ' class="me"' : ''}>
      <td>${esc(pl.name)}</td><td>${t.played}</td><td>${pct(t.winRate)}</td><td>${fmt(t.avgGuesses)}</td>
      <td>${t.best ?? '–'}</td><td class="mono">${t.firsts[0] ? esc(t.firsts[0].value) : '–'}</td></tr>`).join('')}</tbody>`;
}
on('stats-player', 'change', (e) => { statsPlayerId = e.target.value; renderStats(); });

// ---------- settings ----------

function renderSettings() {
  const chips = $('length-chips');
  chips.innerHTML = '';
  for (const len of LENGTHS) {
    const b = document.createElement('button');
    b.className = `chip${len === data.settings.length ? ' on' : ''}`;
    b.textContent = len;
    b.setAttribute('aria-label', `${len} digits`);
    b.onclick = () => { data.settings.length = len; persist(); renderSettings(); };
    chips.appendChild(b);
  }
  $('set-left').checked = data.settings.showLeft;
  $('set-vibrate').checked = data.settings.vibrate;
}
on('set-left', 'change', (e) => { data.settings.showLeft = e.target.checked; persist(); });
on('set-vibrate', 'change', (e) => { data.settings.vibrate = e.target.checked; persist(); });

// ---------- offline copy & updates ----------

function setupUpdates() {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && !local)) return;

  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updating) return;
    updating = false;
    location.reload();
  });
  on('update-btn', 'click', () => {
    if (!waitingWorker) return;
    updating = true;
    $('update-btn').disabled = true;
    $('update-btn').textContent = 'Updating…';
    waitingWorker.postMessage('skipWaiting');
  });

  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = () => {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      waitingWorker = reg.waiting;
      if (screen !== 'game') $('update-bar').classList.remove('hidden');
    };
    offer();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') offer(); });
    });
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch(() => {});
}

function init() {
  setupUpdates();
  // Older saves may lack inProgress.
  for (const p of data.players) p.inProgress ||= {};
  // An invite link: join that room (once there's a player to play as).
  pendingRoom = roomFromUrl(location.search);
  if (pendingRoom) {
    const params = new URLSearchParams(location.search);
    params.delete('room');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}`);
  }
  if (vs && !online()) vs = data.versus = null;
  if (vs) connect(); // still in a room from before: rejoin it
  if (!player()) show('players');
  else if (pendingRoom) {
    const code = pendingRoom;
    pendingRoom = null;
    joinRoomCode(code);
  } else if (vs) openRoom();
  else show('home');
  window.crackReady = true;
}

init();
