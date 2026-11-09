// Playing friends: lobbies of up to 8 players. The server holds the room:
// the host starts a round, everyone cracks the same random code, the server
// checks every guess and ranks the players. This phone asks the server for
// the room every few seconds, and straight away when another phone pokes it
// over the live connection.

import { show, register, screen, onLeave } from '../app';
import { $, on, ask, toast, esc, plural, busy, formatTime } from '../ui/dom';
import { feel } from '../ui/feel';
import { confetti } from '../ui/confetti';
import { celebrate, afterCelebration } from '../ui/celebrate';
import { renderGame, rowsHtml, setController, tilesHtml, controller, type Controller, type Row } from '../ui/board';
import { api, online, ApiError } from '../net/api';
import { joinLive, type Live } from '../net/live';
import { currentUser } from '../net/supabase';
import { data, save, settings } from '../store';
import { DAILY_LENGTH, LENGTHS, explain, remainingFrom } from '../lib/game';
import type { RoomPlayer, RoomState } from '../lib/types';
import { addFinished } from '../account';
import { CONFETTI } from './play';

let room: RoomState | null = null;
let live: Live | null = null;
let poll: number | undefined;
let tab: 'mine' | 'players' = 'mine';
let newLength = DAILY_LENGTH;
let shownResultFor = '';
let lastCounts = '';

const myGame = () => room?.mine ?? null;
const myDone = () => Boolean(myGame()?.finished);
const inRound = () => Boolean(room?.playing && myGame());
const ordinal = (n: number) => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const roundPlayers = () => room?.players.filter((p) => p.in_round) ?? [];

// ---------- entering and leaving ----------

function enter(state: RoomState) {
  const firstTime = room?.id !== state.id;
  data.room = { id: state.id, code: state.code };
  save();
  if (firstTime) {
    live?.leave();
    live = joinLive(state.code, currentUser()?.id || 'me', () => void fetchRoom(), () => {});
    tab = 'mine';
    shownResultFor = `${state.id}:${state.playing ? '' : state.round}`; // don't pop up an old result
  }
  update(state);
  startPolling();
  openRoom();
}

// Every 3 seconds while the room is on screen; once a minute elsewhere in the
// app, so the server knows you're still around (players away for 10 minutes
// are taken out of the room, and an absent host closes it).
function startPolling(every = 3000) {
  clearInterval(poll);
  poll = window.setInterval(() => { if (!document.hidden) void fetchRoom(); }, every);
}

export function openRoom() {
  if (!room) {
    if (data.room) void resumeRoom();
    show('versus');
    return;
  }
  if (inRound()) {
    setController(roomController());
    show('game');
  } else {
    show('versus');
  }
}

export async function resumeRoom() {
  if (!data.room || !online()) return;
  try {
    const state = await api.roomState(data.room.id);
    if (!state || state === 'closed') { forget(); return; }
    enter(state);
  } catch {
    // Try again next time.
  }
}

function forget() {
  clearInterval(poll);
  live?.leave();
  live = null;
  room = null;
  data.room = null;
  save();
}

async function fetchRoom() {
  if (!data.room || !online()) return;
  try {
    const state = await api.roomState(data.room.id);
    if (!state || state === 'closed') {
      const wasHost = room?.host;
      forget();
      if ($('result').dataset.kind === 'room') $('result').classList.add('hidden');
      toast(state === 'closed'
        ? (wasHost ? 'Your room closed while you were away.' : 'The host left, so the room has closed.')
        : 'You\'re no longer in that room.');
      if (screen() === 'game' || screen() === 'versus') show('home');
      return;
    }
    update(state);
  } catch {
    // Offline for a moment: keep showing what we have.
  }
}

// Take a new state from the server and react to what changed.
function update(state: RoomState) {
  const before = room;
  room = state;
  // Someone else made progress: a quiet click.
  const counts = state.players.map((p) => `${p.name}:${p.count}:${p.finished}`).join('|');
  if (before?.round === state.round && counts !== lastCounts && screen() === 'game') feel.pop();
  lastCounts = counts;
  // A round started (and I'm in it): go to the game.
  if (state.playing && state.mine && !(before?.playing && before.round === state.round)) {
    tab = 'mine';
    if ($('result').dataset.kind === 'room') $('result').classList.add('hidden'); // last round's result
    if (screen() === 'versus' || screen() === 'game') { setController(roomController()); show('game'); }
  }
  // The round I played just ended: show where I came.
  const key = `${state.id}:${state.round}`;
  if (!state.playing && state.mine && shownResultFor !== key) {
    shownResultFor = key;
    tab = 'players'; // behind the result: the standings
    addFinished(state.mine);
    const won = state.mine.place === 1 && state.mine.cracked;
    void afterCelebration().then(() => {
      if (won) confetti(CONFETTI);
      else if (!state.mine?.cracked) feel.fail();
      setTimeout(showRoomResult, 400);
    });
  }
  redraw();
}

function redraw() {
  if (screen() === 'versus') renderLobby();
  else if (screen() === 'game' && controller()?.action === 'gear') renderGame();
  if ($('result').dataset.kind === 'room' && !$('result').classList.contains('hidden')) showRoomResult();
}

async function leaveRoom(): Promise<boolean> {
  if (!data.room) return true;
  const playing = inRound() && !myDone();
  const question = room?.host
    ? `Leave and close the room for everyone?${playing ? ' This round ends now.' : ''}`
    : playing ? 'Leave the room? That counts as giving up this round.' : 'Leave the room?';
  if (!await ask(question, { yes: room?.host ? 'Close room' : 'Leave' })) return false;
  try {
    await api.roomLeave(data.room.id);
  } catch (e) {
    if (!(e instanceof ApiError && e.offline)) { toast((e as Error).message); return false; }
  }
  live?.poke();
  forget();
  show('home');
  return true;
}

onLeave((from, to) => {
  // Ask the server less often while the room isn't on screen (it speeds up again when it is).
  if ((from === 'game' || from === 'versus') && to !== 'game' && to !== 'versus' && data.room) startPolling(60_000);
});

// ---------- players list ----------

function playerStatus(p: RoomPlayer, over: boolean): { text: string; cls: string } {
  if (!p.in_round) return { text: room?.playing ? 'next round' : '', cls: 'out' };
  if (p.cracked) return { text: `✓ ${plural(p.count, 'guess')}${over && p.ms != null ? ` · ${formatTime(p.ms)}` : ''}`, cls: 'ok' };
  if (p.gave_up) return { text: p.in_room ? 'gave up' : 'left', cls: 'out' };
  if (p.finished) return { text: 'not cracked', cls: 'out' };
  return { text: `${p.count} …`, cls: '' };
}

function playersHtml(list: RoomPlayer[], over: boolean, kick = true): string {
  return list.map((p) => {
    const s = playerStatus(p, over);
    const mark = over && p.place && p.in_round ? (p.place === 1 && p.cracked ? '🏆' : String(p.place)) : p.host ? '👑' : '';
    return `<li class="${p.me ? 'me' : ''}${!p.in_room ? ' gone' : ''}${over && p.place === 1 && p.cracked ? ' first' : ''}">
      <span class="place">${mark}</span>
      <span class="who-name">${esc(p.name)}${p.me ? '<small>you</small>' : ''}${p.host && over && p.place ? '<small>host</small>' : ''}</span>
      <span class="status ${s.cls}">${s.text}</span>${kick && canKick(p) ? `<button class="kick" data-pid="${esc(p.pid)}" data-name="${esc(p.name)}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}</li>`;
  }).join('');
}

// The host can remove anyone else still in the room (say, someone who
// closed the app without leaving and is holding up the round).
const canKick = (p: RoomPlayer) => Boolean(room?.host && !p.me && p.in_room);

document.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.kick');
  if (!btn || !room) return;
  const name = btn.dataset.name || 'this player';
  const during = room.playing ? ' Their round counts as given up.' : '';
  if (!await ask(`Remove ${name} from the room?${during} They can join again with the room code.`, { yes: 'Remove' })) return;
  const done = busy(btn, '…');
  try {
    const state = await api.roomKick(room.id, btn.dataset.pid!);
    live?.poke();
    update(state);
    toast(`${name} was removed.`);
  } catch (e) {
    toast((e as Error).message);
    done();
  }
});

// ---------- lobby ----------

function renderLobby() {
  $('lobby-start').classList.toggle('hidden', Boolean(data.room));
  $('lobby-room').classList.toggle('hidden', !data.room);
  $('lobby-title').textContent = data.room ? `Room ${data.room.code}` : 'Play friends';
  const chips = $('vs-length');
  chips.innerHTML = '';
  for (const len of LENGTHS) {
    const b = document.createElement('button');
    b.className = `chip${len === newLength ? ' on' : ''}`;
    b.textContent = String(len);
    b.setAttribute('aria-label', `${len} digits`);
    b.onclick = () => { newLength = len; renderLobby(); };
    chips.appendChild(b);
  }
  $('lobby-offline').classList.toggle('hidden', online());
  if (!data.room) return;
  $('room-code').textContent = data.room.code;
  if (!room) {
    $('room-style').textContent = '';
    $('room-players').innerHTML = '';
    $('room-status').textContent = 'Connecting…';
    $('start-round').classList.add('hidden');
    $('room-last').classList.add('hidden');
    return;
  }
  const inRoom = room.players.filter((p) => p.in_room);
  $('leave-room').textContent = room.host ? 'Close room' : 'Leave room';
  $('room-style').textContent = `🎯 Everyone cracks the same ${room.length}-digit code`;
  $('room-players-title').textContent = `Players (${inRoom.length}/8)`;

  // Last round's results (or the round going on, for someone who joined during it).
  const last = $('room-last');
  if (room.round > 0 && (room.playing ? !room.mine : true)) {
    last.classList.remove('hidden');
    last.innerHTML = room.playing
      ? `<h3>Round ${room.round} is on</h3><p class="fine">You'll play from the next round.</p><ul class="room-players">${playersHtml(roundPlayers(), false)}</ul>`
      : `<div class="round-code"><h3>Round ${room.round}</h3>${room.secret ? `<span class="tiles">${tilesHtml(room.secret)}</span>` : ''}</div><ul class="room-players">${playersHtml(roundPlayers(), true)}</ul>`;
  } else {
    last.classList.add('hidden');
  }

  $('room-players').innerHTML = playersHtml(inRoom.map((p) => ({ ...p, in_round: false })), false);
  const startBtn = $<HTMLButtonElement>('start-round');
  if (room.playing) {
    startBtn.classList.add('hidden');
    $('room-status').textContent = room.mine ? '' : 'Waiting for this round to finish…';
  } else if (room.host) {
    startBtn.classList.remove('hidden');
    startBtn.textContent = room.round ? 'Next round' : 'Start game';
    startBtn.disabled = inRoom.length < 2;
    $('room-status').textContent = inRoom.length < 2 ? 'Send the invite: you need at least one more player.' : `Start when everyone's in.`;
  } else {
    startBtn.classList.add('hidden');
    $('room-status').textContent = `Waiting for ${room.host_name} to start${room.round ? ' the next round' : ''}…`;
  }
}

register('versus', () => {
  renderLobby();
  if (data.room) {
    void fetchRoom();
    startPolling();
  }
});

on('create-room', 'click', async () => {
  if (!online()) return toast('Playing friends needs internet.');
  const done = busy($('create-room'), 'Creating…');
  try {
    enter(await api.roomCreate(newLength));
  } catch (e) {
    toast((e as Error).message);
  } finally {
    done();
  }
});

on('start-round', 'click', async () => {
  if (!room) return;
  const done = busy($('start-round'), 'Starting…');
  try {
    const state = await api.roomStart(room.id);
    live?.poke();
    update(state);
  } catch (e) {
    toast((e as Error).message === 'waiting for players' ? 'You need at least one more player.' : (e as Error).message);
  } finally {
    done();
  }
});

export async function joinByCode(raw: string, button?: HTMLElement) {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return toast('Room codes are 5 letters and numbers.');
  if (data.room && data.room.code !== code) { toast(`Leave room ${data.room.code} first.`); openRoom(); return; }
  if (!online()) return toast('Playing friends needs internet.');
  const done = button ? busy(button, 'Joining…') : () => {};
  try {
    enter(await api.roomJoin(code));
    live?.poke();
  } catch (e) {
    const msg = (e as Error).message;
    toast(msg === 'room not found' ? `There's no room ${code}.` : msg === 'room full' ? 'That room is full (8 players).' : msg);
  } finally {
    done();
  }
}

on('join-form', 'submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('join-code');
  const code = input.value;
  input.value = '';
  input.blur();
  void joinByCode(code, $('join-form').querySelector('button') || undefined);
});
on('leave-room', 'click', () => void leaveRoom());
on('share-room', 'click', () => void shareInvite());

async function shareInvite() {
  if (!data.room) return;
  const code = data.room.code;
  const url = `${location.origin}${location.pathname}?room=${code}`;
  const text = `Play Vault with me! Let's see who cracks the code first. Room ${code}:`;
  try {
    if (navigator.share) await navigator.share({ text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Invite link copied. Send it to your friends.'); }
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') toast(`Couldn't share. Tell your friends the room code: ${code}`);
  }
}

// ---------- game screen ----------

function roomController(): Controller {
  return {
    title: () => `Room ${room?.code ?? ''}`,
    sub() {
      if (!room?.mine) return '';
      const players = roundPlayers();
      const cracked = players.filter((p) => p.cracked).length;
      const me = room.mine.cracked ? `✓ ${room.mine.guesses.length}` : room.mine.gave_up ? 'gave up' : String(room.mine.guesses.length);
      return `You ${me} · ${cracked}/${players.length} cracked`;
    },
    length: () => room?.length ?? 4,
    notes: () => (room?.mine ? (data.notes[room.mine.id] ||= {}) : {}),
    saveNotes: save,
    canType: () => inRound() && !myDone(),
    goLabel: () => 'Guess',
    showNotes: () => true,
    async submit(code) {
      const g0 = myGame();
      if (!room || !g0) return;
      if (g0.guesses.some((x) => x.guess === code)) return `You already tried ${code}.`;
      try {
        const g = await api.guess(g0.id, code);
        const last = g.guesses[g.guesses.length - 1];
        if (!g.cracked) feel.guess(last.exact, last.close);
        const state = await api.roomState(room.id);
        if (g.cracked) void celebrate(g.guesses.length === 1 ? 'First try!' : 'Cracked!', crackedLine(state === 'closed' ? null : state, g.guesses.length));
        if (state && state !== 'closed') update(state);
        else void fetchRoom();
        renderGame(true);
        live?.poke();
      } catch (e) {
        return e instanceof ApiError && e.offline ? "No connection, so that wasn't sent. Try again." : (e as Error).message;
      }
    },
    list(list, justGuessed) {
      if (!room) { list.innerHTML = ''; return null; }
      if (tab === 'players') {
        const over = !room.playing;
        list.innerHTML = `<li class="players-li"><ul class="room-players">${playersHtml(roundPlayers(), over)}</ul></li>`
          + (over ? '' : `<li class="round-note">Everyone's guesses are shown when the round ends.</li>`);
        return null;
      }
      const rows: Row[] = (room.mine?.guesses ?? []).map((x) => ({ guess: x.guess, feedback: { exact: x.exact, close: x.close } }));
      list.innerHTML = rows.length ? rowsHtml(rows, justGuessed)
        : `<li class="empty">Go! Everyone's cracking the same ${room.length}-digit code.<br>Each guess gets feedback: <b class="t-exact">right spot</b> and <b class="t-close">wrong spot</b>.</li>`;
      return rows;
    },
    head: () => null,
    tabs() {
      if (!room) return '';
      const others = room.playing ? `Players <small>${roundPlayers().length}</small>` : '🏆 Standings';
      return `<span class="who-switch big" role="tablist"><button class="who${tab === 'mine' ? ' on' : ''}" data-tab="mine" role="tab">Your guesses</button><button class="who${tab === 'players' ? ' on' : ''}" data-tab="players" role="tab">${others}</button></span>`;
    },
    onTabs(el) {
      el.querySelectorAll<HTMLElement>('.who').forEach((b) => { b.onclick = () => { tab = b.dataset.tab as 'mine' | 'players'; renderGame(); }; });
    },
    panel() {
      if (!room || !inRound() || !myDone()) return '';
      const left = roundPlayers().filter((p) => !p.finished).length;
      return `<p>${room.mine?.cracked ? `You cracked it in ${room.mine.guesses.length}!` : 'You gave up.'} Waiting for ${plural(left, 'player')} to finish…</p>`
        + (room.host ? '<div class="vs-actions"><button class="btn small secondary" data-act="end">End round now</button></div>' : '');
    },
    bindPanel(panel) {
      panel.querySelector('[data-act="end"]')?.addEventListener('click', () => void endRound());
    },
    explain(i) {
      const g = myGame();
      if (!g || tab !== 'mine') return '';
      const fb = g.guesses.map((x) => ({ exact: x.exact, close: x.close }));
      let text = explain(g.guesses[i].guess, fb[i]);
      if (settings().showLeft) {
        const n = remainingFrom(g.length, g.guesses.slice(0, i + 1).map((x) => x.guess), fb);
        text += ` ${n.toLocaleString()} possible code${n === 1 ? '' : 's'} left.`;
      }
      return text;
    },
    action: 'gear',
    onAction: openRoomMenu,
  };
}

// "in 4 guesses · 1st so far (2 of 5 cracked)"
function crackedLine(state: RoomState | null, n: number): string {
  const base = `Cracked in ${plural(n, 'guess')}`;
  if (!state) return base;
  const players = state.players.filter((p) => p.in_round);
  const cracked = players.filter((p) => p.cracked);
  const me = cracked.find((p) => p.me);
  if (!me) return base;
  const ahead = cracked.filter((p) => !p.me && (p.count < me.count || (p.count === me.count && (p.ms ?? 0) < (me.ms ?? 0)))).length;
  const stillGoing = players.length - players.filter((p) => p.finished).length;
  return `${base} · ${ordinal(ahead + 1)}${stillGoing ? ' so far' : ''}`;
}

async function endRound() {
  if (!room) return;
  const left = roundPlayers().filter((p) => !p.finished).length;
  if (!await ask(`End the round now? ${plural(left, 'player')} still guessing won't have cracked it.`, { yes: 'End round' })) return;
  try {
    update(await api.roomEnd(room.id));
    live?.poke();
  } catch (e) {
    toast((e as Error).message);
  }
}

function showRoomResult() {
  if (!room || room.playing || !room.mine) return;
  const g = room.mine;
  const players = roundPlayers();
  const place = g.place ?? players.length;
  $('result-title').textContent = !g.cracked ? 'Not cracked' : place === 1 ? (g.result === 'draw' ? 'Tied for 1st! 🏆' : '1st place! 🏆') : `${ordinal(place)} place`;
  $('result-label').textContent = 'The code';
  $('result-label').classList.remove('hidden');
  $('result-code').innerHTML = tilesHtml(room.secret || g.secret || '?'.repeat(room.length));
  $('result-text').textContent = g.cracked
    ? `${plural(g.guesses.length, 'guess')} · ${ordinal(place)} of ${players.length}`
    : `${g.gave_up ? 'You gave up' : 'Not cracked'} · ${players.length} players`;
  // Everyone's standing, right in the result.
  $('result-extra').innerHTML = `<span class="standings-title">Standings</span><ul class="room-players standings">${playersHtml(players, true, false)}</ul>`
    + (players.some((p) => p.cracked) ? '' : '<span>Nobody cracked it this round.</span>');
  $('again-btn').textContent = 'Next round';
  $('again-btn').classList.toggle('hidden', !room.host);
  $<HTMLButtonElement>('again-btn').disabled = room.players.filter((p) => p.in_room).length < 2;
  $('share-btn').classList.add('hidden');
  $('result-stats-btn').textContent = room.host ? 'Room lobby' : `Room lobby (waiting for ${room.host_name})`;
  $('result-home-btn').textContent = room.host ? 'Close room' : 'Leave room';
  $('result').dataset.kind = 'room';
  $('result').classList.remove('hidden');
}

const isRoomResult = () => $('result').dataset.kind === 'room';
on('again-btn', 'click', async () => {
  if (!isRoomResult() || !room) return;
  $('result').classList.add('hidden');
  try {
    const state = await api.roomStart(room.id);
    live?.poke();
    update(state);
  } catch (e) {
    toast((e as Error).message === 'waiting for players' ? 'Everyone else has left the room.' : (e as Error).message);
    show('versus');
  }
});
on('result-stats-btn', 'click', () => {
  if (!isRoomResult()) return;
  $('result').classList.add('hidden');
  show('versus');
});
on('result-home-btn', 'click', async () => {
  if (!isRoomResult()) return;
  if (await leaveRoom()) $('result').classList.add('hidden');
});

// ---------- room menu (the gear) ----------

function openRoomMenu() {
  if (!room) return;
  $('room-menu-title').textContent = `Room ${room.code}`;
  $('room-menu-info').textContent = `${plural(room.players.filter((p) => p.in_room).length, 'player')} · ${room.length} digits · host: ${room.host ? 'you' : room.host_name}`;
  $('menu-giveup').classList.toggle('hidden', !(inRound() && !myDone()));
  $('menu-end').classList.toggle('hidden', !(room.host && room.playing));
  $('menu-leave').textContent = room.host ? 'Close room' : 'Leave room';
  $('menu-remove').classList.toggle('hidden', !(room.host && room.players.some(canKick)));
  $('menu-lobby').classList.toggle('hidden', room.playing);
  $('room-menu').classList.remove('hidden');
}
const closeMenu = () => $('room-menu').classList.add('hidden');
on('menu-close', 'click', closeMenu);
on('room-menu', 'click', (e) => { if (e.target === $('room-menu')) closeMenu(); });
on('menu-invite', 'click', () => { closeMenu(); void shareInvite(); });
on('menu-leave', 'click', () => { closeMenu(); void leaveRoom(); });
on('menu-lobby', 'click', () => { closeMenu(); show('versus'); });
on('menu-end', 'click', () => { closeMenu(); void endRound(); });
// Show the players with their ✕ buttons: the in-game Players tab, or the lobby.
on('menu-remove', 'click', () => {
  closeMenu();
  if (screen() === 'game' && room?.playing && room.mine) { tab = 'players'; renderGame(); }
  else show('versus');
  toast('Tap ✕ next to the player to remove.');
});
on('menu-giveup', 'click', async () => {
  closeMenu();
  const g = myGame();
  if (!g || myDone()) return;
  if (!await ask('Give up this round?', { yes: 'Give up' })) return;
  try {
    await api.giveUp(g.id);
    live?.poke();
    await fetchRoom();
  } catch (e) {
    toast((e as Error).message);
  }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden && data.room) void fetchRoom(); });
