// Which screen is showing. Screens register how to draw themselves, so they
// don't need to import each other.

import { $ } from './ui/dom';

export type Screen = 'home' | 'name' | 'account' | 'story' | 'versus' | 'game' | 'stats' | 'board' | 'help' | 'settings';
const SCREENS: Screen[] = ['home', 'name', 'account', 'story', 'versus', 'game', 'stats', 'board', 'help', 'settings'];

const renderers: Partial<Record<Screen, () => void>> = {};
const leaving: ((from: Screen, to: Screen) => void)[] = [];
let current: Screen = 'home';

export const screen = () => current;
export const register = (name: Screen, render: () => void) => { renderers[name] = render; };
export const onLeave = (fn: (from: Screen, to: Screen) => void) => leaving.push(fn);

export function show(name: Screen) {
  if (current !== name) for (const fn of leaving) fn(current, name);
  current = name;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
  $('update-bar').classList.toggle('hidden', !updateWaiting || name === 'game');
  renderers[name]?.();
}

// Redraw the current screen (after something changed in the background).
export const refresh = () => renderers[current]?.();

let updateWaiting = false;
export function offerUpdate() {
  updateWaiting = true;
  if (current !== 'game') $('update-bar').classList.remove('hidden');
}
