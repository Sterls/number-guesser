import {
  LENGTHS, DAILY_LENGTH, makeSecret, dailySecret, todayKey, dailyNumber,
  score, guessProblem, remaining, explain,
} from './game.js';
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

const player = () => data.players.find((p) => p.id === data.currentId) || null;
const today = () => todayKey();
const persist = () => save(data);

// ---------- screens ----------

const SCREENS = ['home', 'players', 'game', 'stats', 'help', 'settings'];
function show(name) {
  if (screen === 'game' && name !== 'game') pauseClock();
  screen = name;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
  $('update-bar').classList.toggle('hidden', !waitingWorker || name === 'game');
  ({ home: renderHome, players: renderPlayers, stats: renderStats, settings: renderSettings, game: renderGame }[name] || (() => {}))();
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
  $('practice-btn').textContent = p?.inProgress?.practice ? 'Continue practice' : 'Practice';
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
  if (first && !data.settings.seenHelp) {
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
  if (screen !== 'game') return;
  if (document.hidden) pauseClock();
  else resumedAt = performance.now();
});

// The two feedback numbers for a guess, in the "Right spot" and "Wrong spot" columns.
function countsHtml({ exact, close }) {
  return `<span class="count exact${exact ? '' : ' zero'}">${exact}</span><span class="count close${close ? '' : ' zero'}">${close}</span>`;
}

function showExplanation(i) {
  const g = game.guesses[i];
  let text = explain(g, score(game.secret, g));
  if (data.settings.showLeft) {
    const n = remaining(game.secret, game.guesses.slice(0, i + 1));
    text += ` ${n.toLocaleString()} possible code${n === 1 ? '' : 's'} left.`;
  }
  $('feedback-msg').textContent = text;
  document.querySelectorAll('.guess-row').forEach((row, j) => row.classList.toggle('picked', j === i));
}

function tilesHtml(code) {
  return [...code].map((d) => `<span class="tile">${d}</span>`).join('');
}

function renderGame(justGuessed = false) {
  $('game-title').textContent = game.mode === 'daily'
    ? `Daily #${dailyNumber(game.date)}`
    : `Practice · ${game.length} digits`;
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
  $('feedback-msg').textContent = '';
  if (!game.guesses.length) {
    list.innerHTML = `<li class="empty">Type any ${game.length} different digits to start.<br>After each guess you'll see how many of your digits are in the <b class="t-exact">right spot</b> and how many are in the code but in the <b class="t-close">wrong spot</b>.</li>`;
  } else showExplanation(game.guesses.length - 1);
  list.scrollTop = list.scrollHeight;
  renderEntry();
}

function renderEntry() {
  const slots = $('slots');
  slots.innerHTML = '';
  for (let i = 0; i < game.length; i++) {
    const s = document.createElement('span');
    s.className = `tile slot${i === draft.length ? ' next' : ''}${draft[i] ? ' filled' : ''}`;
    s.textContent = draft[i] || '';
    slots.appendChild(s);
  }
  // Notes: 0 = unknown, 1 = ruled out, 2 = definitely in.
  const notes = $('notes');
  notes.innerHTML = '<span class="notes-label">Notes</span>';
  for (const d of '0123456789') {
    const b = document.createElement('button');
    const state = game.notes[d] || 0;
    b.className = `note n${state}`;
    b.textContent = d;
    b.setAttribute('aria-label', `${d}: ${['no note', 'not in the code', 'in the code'][state]}`);
    b.onclick = () => { game.notes[d] = (state + 1) % 3; persist(); renderEntry(); };
    notes.appendChild(b);
  }
  const pad = $('keypad');
  pad.innerHTML = '';
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go']) {
    const b = document.createElement('button');
    b.className = `key${k === 'go' ? ' go' : k === 'del' ? ' del' : ''}${game.notes[k] === 1 ? ' out' : ''}${game.notes[k] === 2 ? ' in' : ''}`;
    b.textContent = k === 'del' ? '⌫' : k === 'go' ? 'Guess' : k;
    if (k === 'del') b.setAttribute('aria-label', 'Delete');
    b.disabled = (k.length === 1 && (draft.includes(k) || draft.length >= game.length))
      || (k === 'go' && draft.length !== game.length) || (k === 'del' && !draft.length);
    b.onclick = () => press(k);
    pad.appendChild(b);
  }
}

function press(k) {
  if (!game || screen !== 'game' || !$('result').classList.contains('hidden')) return;
  $('entry-msg').textContent = '';
  if (k === 'del') draft = draft.slice(0, -1);
  else if (k === 'go') return submit();
  else if (draft.length < game.length && !draft.includes(k)) draft += k;
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
  const head = r.mode === 'daily' ? `Vault #${dailyNumber(r.date)}` : `Vault practice (${r.length} digits)`;
  const result = r.won ? `${r.guesses.length} guess${r.guesses.length === 1 ? '' : 'es'}` : 'gave up';
  const rows = r.guesses.map((g) => {
    const { exact, close } = score(r.secret, g);
    return `🟢${exact} 🟡${close}`;
  });
  return `${head} · ${result}\n🟢 right spot · 🟡 wrong spot\n${rows.join('\n')}`;
}

function showResult(r) {
  lastResult = r;
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
on('again-btn', 'click', () => { closeResult(); startGame(newGame('practice', data.settings.length)); });
on('result-home-btn', 'click', () => { closeResult(); show('home'); });
on('result-stats-btn', 'click', () => {
  closeResult();
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
        <li><span>${g.mode === 'daily' ? `Daily #${dailyNumber(g.date)}` : `Practice · ${g.length}`}</span>
        <span class="tiles small">${tilesHtml(g.secret)}</span>
        <b>${g.won ? `${g.guesses.length} guesses` : 'gave up'}</b></li>`).join('')}
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
  show(player() ? 'home' : 'players');
  window.crackReady = true;
}

init();
