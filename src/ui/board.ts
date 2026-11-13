// The game screen, shared by every kind of game. A "controller" (single
// player, daily, offline, room) says what to show and what a guess does;
// this file draws the guesses, the input boxes, the notes and the keypad.

import { $, esc } from './dom';
import { feel } from './feel';
import type { Feedback } from '../lib/game';
import { guessProblem } from '../lib/game';
import { reviewGame, reviewText, type GuessReview } from '../lib/review';

export interface Row {
  guess: string;
  feedback: Feedback | null; // null while waiting for the server
}

export interface Controller {
  title(): string;
  sub(): string;                       // html: one short status line under the title
  length(): number;
  notes(): Record<string, number>;     // 0 = no note, 1 = not in the code, 2 = in the code
  saveNotes(): void;
  canType(): boolean;
  goLabel(): string;                   // 'Guess' or 'Lock in'
  showNotes(): boolean;
  submit(code: string): Promise<string | void>; // a message to show if it didn't work
  list(list: HTMLElement, justGuessed: boolean): Row[] | null; // draws the list; returns rows for the column heading
  head(): string | null;               // html for the column heading's label (null: plain "Your guess")
  panel(): string;                     // html for the bottom panel when the keypad is hidden ('' = none)
  bindPanel?(panel: HTMLElement): void;
  explain(i: number): string;          // the plain-words line for guess i
  action: 'flag' | 'gear' | null;
  onAction(): void;
  onHead?(head: HTMLElement): void;
  tabs?(): string;                     // html for a full-width switch above the guesses
  onTabs?(tabs: HTMLElement): void;
}

let ctl: Controller | null = null;
// The guess being built: one entry per box ('' = empty), and the box the
// next digit goes into. Tap a box to fill the digits in any order.
let draft: string[] = [];
let cursor = 0;
let sending = false;
const filled = () => draft.filter(Boolean).length;

export const controller = () => ctl;
export function setController(c: Controller | null) {
  ctl = c;
  draft = [];
  cursor = 0;
  $('entry-msg').textContent = '';
}

export function tilesHtml(code: string): string {
  return [...code].map((d) => `<span class="tile">${esc(d)}</span>`).join('');
}

export function countsHtml(f: Feedback | null): string {
  if (!f) return '<span class="count pending" title="Waiting">…</span><span class="count pending" title="Waiting">…</span>';
  return `<span class="count exact${f.exact ? '' : ' zero'}">${f.exact}</span><span class="count close${f.close ? '' : ' zero'}">${f.close}</span>`;
}

export function rowsHtml(rows: Row[], justGuessed: boolean, theirs = false): string {
  return rows.map((r, i) => `<li class="guess-row grid len${r.guess.length}${justGuessed && i === rows.length - 1 ? ' new' : ''}${theirs ? ' theirs' : ''}${r.feedback?.exact === r.guess.length ? ' win' : ''}" data-i="${i}">
    <span class="num">${i + 1}</span><span class="tiles">${tilesHtml(r.guess)}</span>${countsHtml(r.feedback)}</li>`).join('');
}

// Shown in the list under the guess it explains, so it scrolls with the guesses.
export function showExplanation(i: number) {
  if (!ctl) return;
  const list = $('guesses');
  list.querySelector('.explain')?.remove();
  const rows = list.querySelectorAll('.guess-row:not(.theirs)');
  rows.forEach((row, j) => row.classList.toggle('picked', j === i));
  const r = reviewing() ? review[i] : undefined;
  const text = r ? `${ctl.explain(i).split(/(?<=[.!]) /)[0]} ${reviewText(r, i)}` : ctl.explain(i);
  if (!text || !rows[i]) return;
  const li = document.createElement('li');
  li.className = 'explain';
  li.setAttribute('role', 'status');
  li.textContent = text;
  rows[i].after(li);
}

// "See my guesses" after a game: each guess gets a quality score.
let review: GuessReview[] = [];
// What the list last showed: whose game and how many guesses.
let shown: { ctl: Controller | null; rows: number } = { ctl: null, rows: -1 };
const reviewing = () => !$('result-back').classList.contains('hidden');

export function renderGame(justGuessed = false) {
  if (!ctl) return;
  $('game-title').textContent = ctl.title();
  const sub = ctl.sub();
  $('game-sub').innerHTML = sub;
  $('game-sub').classList.toggle('hidden', !sub);
  $('giveup-btn').classList.toggle('hidden', ctl.action !== 'flag');
  $('room-menu-btn').classList.toggle('hidden', ctl.action !== 'gear');

  const list = $('guesses');
  // Remember where the player had scrolled to and which guess they'd tapped,
  // so a redraw that changes nothing (a room checks in every few seconds) leaves them be.
  const scrollWas = list.scrollTop;
  const pickedWas = [...list.querySelectorAll('.guess-row:not(.theirs)')].findIndex((r) => r.classList.contains('picked'));
  const rows = ctl.list(list, justGuessed);
  const now = { ctl, rows: rows ? rows.length : -1 };
  const same = !justGuessed && shown.ctl === now.ctl && shown.rows === now.rows;
  shown = now;
  list.querySelectorAll<HTMLElement>('.guess-row[data-i]:not(.theirs)').forEach((row) => {
    row.onclick = () => showExplanation(Number(row.dataset.i));
  });
  // Looking back after the game: how good each guess was.
  review = reviewing() && rows?.length && rows.every((r) => r.feedback)
    ? reviewGame(rows[0].guess.length, rows.map((r) => r.guess), rows.map((r) => r.feedback!)) : [];
  $('game').classList.toggle('review', review.length > 0);
  list.querySelectorAll<HTMLElement>('.guess-row[data-i]:not(.theirs)').forEach((row) => {
    const r = review[Number(row.dataset.i)];
    if (!r) return;
    const pct = Math.round(r.quality * 100);
    row.insertAdjacentHTML('beforeend', `<span class="quality ${pct >= 90 ? 'good' : pct >= 60 ? 'ok' : 'poor'}" aria-label="Guess quality ${pct}%">${pct}%</span>`);
  });
  const tabs = ctl.tabs?.() ?? '';
  $('game-tabs').innerHTML = tabs;
  $('game-tabs').classList.toggle('hidden', !tabs);
  if (tabs) ctl.onTabs?.($('game-tabs'));
  const head = ctl.head();
  $('guess-head').classList.toggle('hidden', head === null && !rows?.length);
  $('guess-head').classList.toggle('no-cols', !rows?.length); // no guess rows: no column headings
  $('guess-head-label').innerHTML = head ?? 'Your guess';
  ctl.onHead?.($('guess-head-label'));
  if (rows?.length && list.querySelector('.guess-row[data-i]:not(.theirs)')) showExplanation(same && pickedWas >= 0 ? pickedWas : rows.length - 1);
  // A new guess (or a different list): show the newest guess; anything else (players, instructions) from the top.
  list.scrollTop = same ? scrollWas : rows?.length ? list.scrollHeight : 0;

  const panel = ctl.panel();
  $('vs-panel').innerHTML = panel;
  $('vs-panel').classList.toggle('hidden', !panel);
  if (panel) ctl.bindPanel?.($('vs-panel'));
  $('entry').classList.toggle('hidden', !ctl.canType());
  if (ctl.canType()) $('result-back').classList.add('hidden'); // a new game or round
  renderEntry();
}

export function renderEntry() {
  if (!ctl || !ctl.canType()) return;
  const c = ctl;
  const length = c.length();
  const notes = c.notes();
  const slots = $('slots');
  slots.innerHTML = '';
  if (draft.length !== length) { draft = Array.from({ length }, () => ''); cursor = 0; }
  for (let i = 0; i < length; i++) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = `tile slot${i === cursor ? ' next' : ''}${draft[i] ? ' filled' : ''}`;
    s.textContent = draft[i];
    s.setAttribute('aria-label', `Digit ${i + 1}${draft[i] ? `: ${draft[i]}` : ', empty'}${i === cursor ? ' (selected)' : ''}`);
    s.onclick = () => { if (sending) return; cursor = i; feel.note(); renderEntry(); };
    slots.appendChild(s);
  }
  const noteRow = $('notes');
  noteRow.classList.toggle('hidden', !c.showNotes());
  noteRow.innerHTML = '<span class="notes-label">Notes</span>';
  for (const d of '0123456789') {
    const b = document.createElement('button');
    const state = notes[d] || 0;
    b.className = `note n${state}`;
    b.textContent = d;
    b.setAttribute('aria-label', `${d}: ${['no note', 'not in the code', 'in the code'][state]}`);
    b.onclick = () => { notes[d] = (state + 1) % 3; c.saveNotes(); feel.note(); renderEntry(); };
    noteRow.appendChild(b);
  }
  const pad = $('keypad');
  pad.innerHTML = '';
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go']) {
    const b = document.createElement('button');
    const note = c.showNotes() ? notes[k] : 0;
    b.className = `key${k === 'go' ? ' go' : k === 'del' ? ' del' : ''}${note === 1 ? ' out' : ''}${note === 2 ? ' in' : ''}`;
    if (k === 'go' && sending) b.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
    else b.textContent = k === 'del' ? '⌫' : k === 'go' ? c.goLabel() : k;
    if (k === 'del') b.setAttribute('aria-label', 'Delete');
    // A digit already in another box can still be pressed: it moves to the selected box.
    if (k.length === 1 && draft.includes(k)) b.classList.add('used');
    b.disabled = sending || (k === 'go' && filled() !== length) || (k === 'del' && !filled());
    b.onclick = () => press(k);
    pad.appendChild(b);
  }
}

export async function press(k: string) {
  if (!ctl || !ctl.canType() || sending || !$('result').classList.contains('hidden')) return;
  const length = ctl.length();
  $('entry-msg').textContent = '';
  if (k === 'del') {
    if (!filled()) return;
    // Clear the selected box; if it's empty, the nearest filled box before it (else the last one).
    if (!draft[cursor]) {
      let i = cursor - 1;
      while (i >= 0 && !draft[i]) i--;
      if (i < 0) { i = length - 1; while (!draft[i]) i--; }
      cursor = i;
    }
    draft[cursor] = '';
    feel.del();
  } else if (k === 'go') {
    const code = draft.join('');
    const problem = guessProblem(code, length);
    if (problem) { $('entry-msg').textContent = problem; return; }
    sending = true;
    renderEntry();
    let message: string | void;
    try {
      message = await ctl.submit(code);
    } finally {
      sending = false;
    }
    if (message) $('entry-msg').textContent = message;
    else { draft = []; cursor = 0; }
  } else if (k === 'left' || k === 'right') {
    cursor = (cursor + (k === 'left' ? length - 1 : 1)) % length;
  } else {
    // Each digit only once: one that's already in another box moves here.
    const at = draft.indexOf(k);
    if (at === cursor) return;
    if (at >= 0) draft[at] = '';
    draft[cursor] = k;
    feel.key();
    // On to the next empty box (to the right first), if there is one.
    for (let step = 1; step <= length; step++) {
      const i = (cursor + step) % length;
      if (!draft[i]) { cursor = i; break; }
    }
  }
  renderEntry();
}

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if ($('game').classList.contains('hidden') || target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  if (/^\d$/.test(e.key)) void press(e.key);
  else if (e.key === 'Backspace') void press('del');
  else if (e.key === 'ArrowLeft') void press('left');
  else if (e.key === 'ArrowRight') void press('right');
  else if (e.key === 'Enter') { e.preventDefault(); void press('go'); }
});

// The flag (give up) and the gear (room menu) in the title bar.
for (const id of ['giveup-btn', 'room-menu-btn']) {
  document.getElementById(id)?.addEventListener('click', () => ctl?.onAction());
}

// ---------- looking back at the guesses after a game ----------
// "See my guesses" on the result puts it aside to show the finished game;
// "Back to result" (where the keypad was) brings it back.
$('result-view-btn').addEventListener('click', () => {
  $('result').classList.add('hidden');
  $('result-back').classList.remove('hidden');
  renderGame();
  showExplanation(0);
  $('guesses').scrollTop = 0;
});
$('result-back-btn').addEventListener('click', () => {
  $('result').classList.remove('hidden');
});
// Whenever the result is on screen, the "Back to result" bar isn't needed.
new MutationObserver(() => {
  if (!$('result').classList.contains('hidden')) $('result-back').classList.add('hidden');
}).observe($('result'), { attributes: true, attributeFilter: ['class'] });
