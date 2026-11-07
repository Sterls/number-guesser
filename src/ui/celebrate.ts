// The moment the vault opens: a full-screen "Cracked!" with the dial
// spinning open, confetti, the unlock chime and a buzz. Tap to skip.
// Results wait for it (see `afterCelebration`).

import { esc } from './dom';
import { feel } from './feel';
import { confetti } from './confetti';

export const CONFETTI = ['#3ccf7e', '#f2b632', '#d4a24c', '#e8ecf4', '#7aa7ff'];

let running: Promise<void> = Promise.resolve();

// Resolves once any celebration on screen has finished.
export const afterCelebration = () => running;

export function celebrate(title: string, subtitle: string, code = ''): Promise<void> {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  feel.open();
  confetti(CONFETTI, { count: 160, duration: 3200 });
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <div class="celebrate-rays" aria-hidden="true"></div>
    <div class="dial big open" aria-hidden="true"></div>
    <p class="celebrate-title">${esc(title)}</p>
    ${code ? `<p class="tiles big celebrate-code">${[...code].map((d) => `<span class="tile">${esc(d)}</span>`).join('')}</p>` : ''}
    <p class="celebrate-sub">${esc(subtitle)}</p>
    <p class="celebrate-skip">Tap to continue</p>`;
  document.body.appendChild(el);
  running = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.classList.add('leaving');
      setTimeout(() => { el.remove(); resolve(); }, 250);
    };
    el.addEventListener('click', finish);
    setTimeout(finish, reduce ? 1500 : 2300);
  });
  return running;
}
