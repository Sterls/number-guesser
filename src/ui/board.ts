// The game screen, shared by every kind of game. A "controller" (single
// player, daily, offline, room) says what to show and what a guess does;
// this file draws the guesses, the input boxes, the notes and the keypad.

import { $, esc } from './dom';
import { feel } from './feel';
import type { Feedback } from '../lib/game';
import { guessProblem } from '../lib/game';

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
}

let ctl: Controller | null = null;
let draft = '';
let sending = false;

export const controller = () => ctl;
export function setController(c: Controller | null) {
  ctl = c;
  draft = '';
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
  return rows.map((r, i) => `<li class="guess-row grid len${r.guess.length}${justGuessed && i === rows.length - 1 ? ' new' : ''}${theirs ? ' theirs' : ''}" data-i="${i}">
    <span class="num">${i + 1}</span><span class="tiles">${tilesHtml(r.guess)}</span>${countsHtml(r.feedback)}</li>`).join('');
}

// Shown in the list under the guess it explains, so it scrolls with the guesses.
export function showExplanation(i: number) {
  if (!ctl) return;
  const list = $('guesses');
  list.querySelector('.explain')?.remove();
  const rows = list.querySelectorAll('.guess-row:not(.theirs)');
  rows.forEach((row, j) => row.classList.toggle('picked', j === i));
  const text = ctl.explain(i);
  if (!text || !rows[i]) return;
  const li = document.createElement('li');
  li.className = 'explain';
  li.setAttribute('role', 'status');
  li.textContent = text;
  rows[i].after(li);
}

export function renderGame(justGuessed = false) {
  if (!ctl) return;
  $('game-title').textContent = ctl.title();
  const sub = ctl.sub();
  $('game-sub').innerHTML = sub;
  $('game-sub').classList.toggle('hidden', !sub);
  $('giveup-btn').classList.toggle('hidden', ctl.action !== 'flag');
  $('room-menu-btn').classList.toggle('hidden', ctl.action !== 'gear');

  const list = $('guesses');
  const rows = ctl.list(list, justGuessed);
  list.querySelectorAll<HTMLElement>('.guess-row[data-i]:not(.theirs)').forEach((row) => {
    row.onclick = () => showExplanation(Number(row.dataset.i));
  });
  const head = ctl.head();
  $('guess-head').classList.toggle('hidden', head === null && !rows?.length);
  $('guess-head-label').innerHTML = head ?? 'Your guess';
  ctl.onHead?.($('guess-head-label'));
  if (rows?.length && list.querySelector('.guess-row[data-i]:not(.theirs)')) showExplanation(rows.length - 1);
  list.scrollTop = list.scrollHeight;

  const panel = ctl.panel();
  $('vs-panel').innerHTML = panel;
  $('vs-panel').classList.toggle('hidden', !panel);
  if (panel) ctl.bindPanel?.($('vs-panel'));
  $('entry').classList.toggle('hidden', !ctl.canType());
  renderEntry();
}

export function renderEntry() {
  if (!ctl || !ctl.canType()) return;
  const c = ctl;
  const length = c.length();
  const notes = c.notes();
  const slots = $('slots');
  slots.innerHTML = '';
  for (let i = 0; i < length; i++) {
    const s = document.createElement('span');
    s.className = `tile slot${i === draft.length ? ' next' : ''}${draft[i] ? ' filled' : ''}`;
    s.textContent = draft[i] || '';
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
    b.disabled = sending || (k.length === 1 && (draft.includes(k) || draft.length >= length))
      || (k === 'go' && draft.length !== length) || (k === 'del' && !draft.length);
    b.onclick = () => press(k);
    pad.appendChild(b);
  }
}

export async function press(k: string) {
  if (!ctl || !ctl.canType() || sending || !$('result').classList.contains('hidden')) return;
  const length = ctl.length();
  $('entry-msg').textContent = '';
  if (k === 'del') {
    if (!draft) return;
    draft = draft.slice(0, -1);
    feel.del();
  } else if (k === 'go') {
    const problem = guessProblem(draft, length);
    if (problem) { $('entry-msg').textContent = problem; return; }
    const code = draft;
    sending = true;
    renderEntry();
    let message: string | void;
    try {
      message = await ctl.submit(code);
    } finally {
      sending = false;
    }
    if (message) $('entry-msg').textContent = message;
    else draft = '';
  } else if (draft.length < length && !draft.includes(k)) {
    draft += k;
    feel.key();
  }
  renderEntry();
}

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if ($('game').classList.contains('hidden') || target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  if (/^\d$/.test(e.key)) void press(e.key);
  else if (e.key === 'Backspace') void press('del');
  else if (e.key === 'Enter') { e.preventDefault(); void press('go'); }
});

// The flag (give up) and the gear (room menu) in the title bar.
for (const id of ['giveup-btn', 'room-menu-btn']) {
  document.getElementById(id)?.addEventListener('click', () => ctl?.onAction());
}
