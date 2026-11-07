// Settings.

import { register } from '../app';
import { $, on } from '../ui/dom';
import { LENGTHS } from '../lib/game';
import { save, settings } from '../store';
import { feel } from '../ui/feel';

function renderSettings() {
  const chips = $('length-chips');
  chips.innerHTML = '';
  for (const len of LENGTHS) {
    const b = document.createElement('button');
    b.className = `chip${len === settings().length ? ' on' : ''}`;
    b.textContent = String(len);
    b.setAttribute('aria-label', `${len} digits`);
    b.onclick = () => { settings().length = len; save(); renderSettings(); };
    chips.appendChild(b);
  }
  $<HTMLInputElement>('set-left').checked = settings().showLeft;
  $<HTMLInputElement>('set-sound').checked = settings().sound;
  $<HTMLInputElement>('set-vibrate').checked = settings().vibrate;
}

const toggle = (id: string, key: 'showLeft' | 'sound' | 'vibrate') =>
  on(id, 'change', (e) => {
    settings()[key] = (e.target as HTMLInputElement).checked;
    save();
    if (key === 'sound' && settings().sound) feel.key();
    if (key === 'vibrate' && settings().vibrate) navigator.vibrate?.(30);
  });
toggle('set-left', 'showLeft');
toggle('set-sound', 'sound');
toggle('set-vibrate', 'vibrate');

register('settings', renderSettings);
