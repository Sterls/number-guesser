// Playing a friend. The server holds the room: it makes or stores the codes,
// checks every guess and decides who won. This phone asks it for the room's
// state every few seconds, and straight away when the other phone pokes it
// over the live connection.

import { show, register, screen, onLeave } from '../app';
import { $, on, ask, toast, esc, plural, busy } from '../ui/dom';
import { feel } from '../ui/feel';
import { confetti } from '../ui/confetti';
import { renderGame, rowsHtml, setController, tilesHtml, controller, type Controller, type Row } from '../ui/board';
import { api, online, ApiError } from '../net/api';
import { joinLive, type Live } from '../net/live';
import { currentUser } from '../net/supabase';
import { data, save, settings } from '../store';
import { DAILY_LENGTH, LENGTHS, explain, remainingFrom } from '../lib/game';
import type { RoomState, RoomStyle } from '../lib/types';
import { addFinished } from '../account';
import { CONFETTI } from './play';

let room: RoomState | null = null;
let live: Live | null = null;
let liveReady = false;
let othersOnline = 0;
let poll: number | undefined;
let tab: 'mine' | 'theirs' = 'mine';
let newStyle: RoomStyle = 'own';
let newLength = DAILY_LENGTH;
let shownResultFor = '';
let lastSeen = { mine: 0, theirs: 0 };

const them = () => esc(room?.them_name || room?.opponent || 'your friend');
const themText = () => room?.them_name || room?.opponent || 'your friend';
const myDone = () => Boolean(room?.mine && (room.mine.cracked || room.mine.gave_up || room.mine.finished));
export const inRoom = () => Boolean(data.room);
export const roomCode = () => data.room?.code || '';

export function styleName(style: RoomStyle) {
  return style === 'same' ? '🎯 Same code' : '🔒 Each sets a code';
}

// ---------- entering and leaving ----------

function enter(state: RoomState) {
  const firstTime = room?.id !== state.id;
  data.room = { id: state.id, code: state.code };
  save();
  if (firstTime) {
    live?.leave();
    liveReady = false;
    live = joinLive(state.code, currentUser()?.id || 'me', () => void fetchRoom(), (n) => { liveReady = true; othersOnline = n; redraw(); });
    tab = 'mine';
    shownResultFor = '';
  }
  update(state);
  clearInterval(poll);
  poll = window.setInterval(() => { if (!document.hidden) void fetchRoom(); }, 3000);
  openRoom();
}

export function openRoom() {
  if (!room) {
    if (data.room) void resumeRoom();
    show('versus');
    return;
  }
  if (room.phase === 'waiting') { show('versus'); return; }
  setController(roomController());
  show('game');
}

export async function resumeRoom() {
  if (!data.room || !online()) return;
  try {
    const state = await api.roomState(data.room.id);
    if (!state) { forget(); return; }
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
    if (!state) {
      forget();
      if (screen() === 'game' || screen() === 'versus') { toast('The room has closed.'); show('home'); }
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
  const mine = state.mine?.guesses.length ?? 0;
  const theirs = state.theirs?.count ?? 0;
  if (before && before.round === state.round && theirs > lastSeen.theirs && tab === 'mine') feel.pop();
  lastSeen = { mine, theirs };
  if (state.phase !== 'waiting' && screen() === 'versus') { openRoom(); return; }
  if (state.phase === 'done' && state.mine && shownResultFor !== `${state.id}:${state.round}`) {
    shownResultFor = `${state.id}:${state.round}`;
    addFinished(state.mine);
    if (state.result === 'win') confetti(CONFETTI);
    else if (state.result === 'lose') feel.fail();
    setTimeout(showRoomResult, 600);
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
  const playing = room?.phase === 'play' && !myDone();
  if (!await ask(playing ? `Leave the room? That counts as giving up, so ${themText()} wins.` : 'Leave the room?', { yes: 'Leave' })) return false;
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
  // Stop asking the server while the room isn't on screen (it starts again when it is).
  if ((from === 'game' || from === 'versus') && to !== 'game' && to !== 'versus') clearInterval(poll);
});

// ---------- lobby ----------

function renderLobby() {
  $('lobby-start').classList.toggle('hidden', Boolean(data.room));
  $('lobby-room').classList.toggle('hidden', !data.room);
  $('vs-style').querySelectorAll<HTMLElement>('.style-opt').forEach((b) => {
    b.classList.toggle('on', b.dataset.style === newStyle);
    b.setAttribute('aria-checked', String(b.dataset.style === newStyle));
    b.onclick = () => { newStyle = b.dataset.style as RoomStyle; renderLobby(); };
  });
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
  $('room-style').textContent = room ? `${styleName(room.style)} · ${room.length} digits` : '';
  $('room-status').textContent = room ? 'Waiting for your friend to join…' : 'Connecting…';
}

register('versus', () => {
  renderLobby();
  if (data.room) {
    void fetchRoom();
    clearInterval(poll);
    poll = window.setInterval(() => { if (!document.hidden) void fetchRoom(); }, 3000);
  }
});

on('create-room', 'click', async () => {
  if (!online()) return toast('Playing a friend needs internet.');
  const done = busy($('create-room'), 'Creating…');
  try {
    enter(await api.roomCreate(newStyle, newLength));
  } catch (e) {
    toast((e as Error).message);
  } finally {
    done();
  }
});

export async function joinByCode(raw: string, button?: HTMLElement) {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return toast('Room codes are 5 letters and numbers.');
  if (data.room && data.room.code !== code) { toast(`Leave room ${data.room.code} first.`); openRoom(); return; }
  if (!online()) return toast('Playing a friend needs internet.');
  const done = button ? busy(button, 'Joining…') : () => {};
  try {
    enter(await api.roomJoin(code));
    live?.poke();
  } catch (e) {
    const msg = (e as Error).message;
    toast(msg === 'room not found' ? `There's no room ${code}.` : msg === 'room full' ? 'That room already has two players.' : msg);
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

function inviteLink(code: string) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

async function shareInvite() {
  if (!data.room) return;
  const code = data.room.code;
  const url = inviteLink(code);
  const text = room?.style === 'same'
    ? `Play Vault with me! Let's see who cracks the code first. Room ${code}:`
    : `Play Vault with me! Crack my code before I crack yours. Room ${code}:`;
  try {
    if (navigator.share) await navigator.share({ text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Invite link copied. Send it to your friend.'); }
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') toast(`Couldn't share. Tell your friend the room code: ${code}`);
  }
}

// ---------- game screen ----------

function roomController(): Controller {
  return {
    title: () => `vs ${themText()}`,
    sub() {
      if (!room) return '';
      const name = them();
      let sub = '';
      if (room.phase === 'setcode') sub = room.my_code ? `🔒 Locked in · waiting for ${name}…` : 'Set your secret code';
      else if (room.phase === 'done') sub = `<b>${{ win: 'You win! 🏆', lose: `${name} wins`, draw: "It's a draw" }[room.result || 'draw']}</b>`;
      else if (room.mine) {
        const t = room.theirs;
        const mineCracked = room.mine.cracked ? room.mine.guesses.length : 0;
        const me = mineCracked ? `✓ ${mineCracked}` : room.mine.gave_up ? 'gave up' : String(room.mine.guesses.length);
        const other = t?.cracked_at ? `✓ ${t.cracked_at}` : t?.gave_up ? 'gave up' : String(t?.count ?? 0);
        sub = `You ${me} · ${name} ${other} <small>guesses</small>`;
      }
      if (room.them_left && room.phase !== 'done') sub += ` · <span class="warn">${name} left</span>`;
      else if (liveReady && !othersOnline && room.them_name && room.phase !== 'done') sub += ` · <span class="warn">${name} offline</span>`;
      return sub;
    },
    length: () => room?.length ?? 4,
    notes: () => (room?.mine ? (data.notes[room.mine.id] ||= {}) : {}),
    saveNotes: save,
    canType: () => Boolean(room) && ((room!.phase === 'setcode' && room!.style === 'own' && !room!.my_code) || (room!.phase === 'play' && !myDone())),
    goLabel: () => (room?.phase === 'setcode' ? 'Lock in' : 'Guess'),
    showNotes: () => room?.phase === 'play',
    async submit(code) {
      if (!room) return;
      try {
        if (room.phase === 'setcode') {
          update(await api.roomSetCode(room.id, code));
          feel.guess(0, 0);
        } else if (room.mine) {
          if (room.mine.guesses.some((x) => x.guess === code)) return `You already tried ${code}.`;
          const g = await api.guess(room.mine.id, code);
          const lastGuess = g.guesses[g.guesses.length - 1];
          if (g.cracked) feel.open(); else feel.guess(lastGuess.exact, lastGuess.close);
          const state = await api.roomState(room.id);
          if (state) update(state);
          renderGame(true);
        }
        live?.poke();
      } catch (e) {
        return e instanceof ApiError && e.offline ? "No connection, so that wasn't sent. Try again." : (e as Error).message;
      }
    },
    list(list, justGuessed) {
      if (!room) { list.innerHTML = ''; return null; }
      const name = them();
      const codeCard = (label: string, code: string) => `<li class="code-card"><span>${label}</span><span class="tiles">${tilesHtml(code)}</span></li>`;
      if (room.phase === 'setcode' && room.my_code) {
        list.innerHTML = codeCard('Your code 🔒', room.my_code)
          + `<li class="empty">When ${name} has set theirs, you both start guessing. Fewest guesses wins; if it's a tie, the faster player wins.</li>`;
        return null;
      }
      if (room.phase === 'setcode') {
        list.innerHTML = `<li class="empty">Pick ${room.length} different digits for ${name} to crack and tap <b>Lock in</b>.<br>The server keeps it secret until the game ends.</li>`;
        return null;
      }
      if (tab === 'theirs') {
        const t = room.theirs;
        if (!t?.game) {
          list.innerHTML = `<li class="empty">${name} has made ${plural(t?.count ?? 0, 'guess')}.<br>You'll see them when the game ends, so nobody can copy.</li>`;
          return null;
        }
        const rows: Row[] = t.game.guesses.map((x) => ({ guess: x.guess, feedback: { exact: x.exact, close: x.close } }));
        const code = room.style === 'own' ? room.my_code : t.game.secret;
        list.innerHTML = (code ? codeCard(room.style === 'own' ? 'Your code' : 'The code', code) : '')
          + (rows.length ? rowsHtml(rows, false, true) : `<li class="empty">${name} hasn't guessed yet.</li>`);
        return rows;
      }
      const rows: Row[] = (room.mine?.guesses ?? []).map((x) => ({ guess: x.guess, feedback: { exact: x.exact, close: x.close } }));
      list.innerHTML = rows.length ? rowsHtml(rows, justGuessed)
        : `<li class="empty">Go! ${room.style === 'same' ? `Crack the ${room.length}-digit code before ${name} does.` : `Crack ${name}'s ${room.length}-digit code.`}<br>Each guess gets feedback: <b class="t-exact">right spot</b> and <b class="t-close">wrong spot</b>.</li>`;
      return rows;
    },
    head() {
      if (!room || (room.phase !== 'play' && room.phase !== 'done')) return null;
      return `<span class="who-switch" role="tablist"><button class="who${tab === 'mine' ? ' on' : ''}" data-tab="mine" role="tab">You</button><button class="who${tab === 'theirs' ? ' on' : ''}" data-tab="theirs" role="tab">${them()} <small>${room.theirs?.count ?? 0}</small></button></span>`;
    },
    onHead(head) {
      head.querySelectorAll<HTMLElement>('.who').forEach((b) => { b.onclick = () => { tab = b.dataset.tab as 'mine' | 'theirs'; renderGame(); }; });
    },
    panel() {
      if (!room) return '';
      const name = them();
      if (room.phase === 'done') {
        const word = { win: 'You win!', lose: `${name} wins.`, draw: "It's a draw." }[room.result || 'draw'];
        const why = room.them_left ? `${name} left the room.` : resultReason();
        const rematch = room.them_left ? `<p>Send the invite again to play someone new.</p>`
          : room.rematch.me ? `<p>Waiting for ${name} to tap Rematch…</p>`
            : room.rematch.them ? `<p><b>${name} wants a rematch!</b></p>` : '';
        return `<p><b>${word}</b> ${esc(why)}</p>${rematch}<div class="vs-actions">`
          + (room.them_left ? '<button class="btn small" data-act="invite">Send invite</button>' : `<button class="btn small" data-act="rematch"${room.rematch.me ? ' disabled' : ''}>Rematch</button>`)
          + '<button class="btn small secondary" data-act="leave">Leave</button></div>';
      }
      if (room.phase === 'play' && myDone()) {
        return `<p>${room.mine?.cracked ? `You cracked it in ${room.mine.guesses.length}!` : 'You gave up.'} Waiting for ${name} to finish…</p>`;
      }
      return '';
    },
    bindPanel(panel) {
      panel.querySelector('[data-act="rematch"]')?.addEventListener('click', () => void rematch());
      panel.querySelector('[data-act="leave"]')?.addEventListener('click', () => void leaveRoom());
      panel.querySelector('[data-act="invite"]')?.addEventListener('click', () => void shareInvite());
    },
    explain(i) {
      if (!room?.mine || tab !== 'mine') return '';
      const gs = room.mine.guesses;
      const fb = gs.map((x) => ({ exact: x.exact, close: x.close }));
      let text = explain(gs[i].guess, fb[i]);
      if (settings().showLeft) {
        const n = remainingFrom(room.length, gs.slice(0, i + 1).map((x) => x.guess), fb);
        text += ` ${n.toLocaleString()} possible code${n === 1 ? '' : 's'} left.`;
      }
      return text;
    },
    action: 'gear',
    onAction: openRoomMenu,
  };
}

function resultReason(): string {
  if (!room?.mine) return '';
  const mine = room.mine.cracked ? room.mine.guesses.length : null;
  const theirs = room.theirs?.cracked_at ?? null;
  if (room.mine.gave_up && room.theirs?.gave_up) return 'You both gave up.';
  if (room.mine.gave_up) return 'You gave up.';
  if (room.theirs?.gave_up) return 'They gave up.';
  if (mine && theirs && mine === theirs) return room.result === 'draw' ? 'Same guesses, same time!' : `Same number of guesses, but ${room.result === 'win' ? 'you were' : 'they were'} faster.`;
  return room.result === 'win' ? 'Fewer guesses.' : 'They needed fewer guesses.';
}

async function rematch() {
  if (!room) return;
  try {
    update(await api.roomRematch(room.id));
    live?.poke();
    $('result').classList.add('hidden');
    openRoom();
  } catch (e) {
    toast((e as Error).message);
  }
}

function showRoomResult() {
  if (!room || room.phase !== 'done' || !room.mine) return;
  const name = themText();
  const mine = room.mine.cracked ? room.mine.guesses.length : null;
  const theirs = room.theirs?.cracked_at ?? null;
  $('result-title').textContent = { win: 'You win! 🏆', lose: `${name} wins`, draw: "It's a draw" }[room.result || 'draw'];
  const code = room.mine.secret || '';
  $('result-label').textContent = room.style === 'same' ? 'The code' : `${name}'s code`;
  $('result-label').classList.remove('hidden');
  $('result-code').innerHTML = tilesHtml(code || '?'.repeat(room.length));
  const side = (n: number | null, gaveUp: boolean | undefined) => (n ? plural(n, 'guess') : gaveUp ? 'gave up' : 'not cracked');
  $('result-text').textContent = `You: ${side(mine, room.mine.gave_up)} · ${name}: ${side(theirs, room.theirs?.gave_up)}`;
  $('result-extra').textContent = [
    room.them_left ? `${name} left the room.` : resultReason(),
    room.rematch.them && !room.rematch.me ? `${name} wants a rematch!` : '',
  ].filter(Boolean).join(' ');
  $('again-btn').textContent = room.them_left ? 'Send invite' : room.rematch.me ? 'Waiting for rematch…' : 'Rematch';
  $('again-btn').classList.remove('hidden');
  $<HTMLButtonElement>('again-btn').disabled = room.rematch.me && !room.them_left;
  $('share-btn').classList.add('hidden');
  $('result-stats-btn').textContent = 'See the guesses';
  $('result-home-btn').textContent = 'Leave room';
  $('result').dataset.kind = 'room';
  $('result').classList.remove('hidden');
}

const isRoomResult = () => $('result').dataset.kind === 'room';
on('again-btn', 'click', () => {
  if (!isRoomResult()) return;
  if (room?.them_left) { void shareInvite(); return; }
  void rematch();
});
on('result-stats-btn', 'click', () => {
  if (!isRoomResult()) return;
  $('result').classList.add('hidden');
  renderGame();
});
on('result-home-btn', 'click', async () => {
  if (!isRoomResult()) return;
  if (await leaveRoom()) $('result').classList.add('hidden');
});

// ---------- room menu (the gear) ----------

function openRoomMenu() {
  if (!room) return;
  $('room-menu-title').textContent = `Room ${room.code}`;
  $('room-menu-info').textContent = `vs ${themText()} · ${styleName(room.style)} · ${room.length} digits`;
  $('menu-giveup').classList.toggle('hidden', !(room.phase === 'play' && !myDone()));
  $('room-menu').classList.remove('hidden');
}
const closeMenu = () => $('room-menu').classList.add('hidden');
on('menu-close', 'click', closeMenu);
on('room-menu', 'click', (e) => { if (e.target === $('room-menu')) closeMenu(); });
on('menu-invite', 'click', () => { closeMenu(); void shareInvite(); });
on('menu-leave', 'click', () => { closeMenu(); void leaveRoom(); });
on('menu-giveup', 'click', async () => {
  closeMenu();
  if (!room?.mine || myDone()) return;
  if (!await ask(`Give up? ${themText()} wins.`, { yes: 'Give up' })) return;
  try {
    await api.giveUp(room.mine.id);
    live?.poke();
    await fetchRoom();
  } catch (e) {
    toast((e as Error).message);
  }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden && data.room) void fetchRoom(); });
