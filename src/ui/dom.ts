// Small helpers shared by every screen.

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing`);
  return el as T;
};

export const on = (id: string, event: string, fn: (e: Event) => void) => $(id).addEventListener(event, fn);

export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const plural = (n: number, word: string, many = `${word}${/s$|sh$|ch$/.test(word) ? 'es' : 's'}`) =>
  `${n} ${n === 1 ? word : many}`;

let toastTimer: number | undefined;
export function toast(msg: string, ms = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.add('hidden'), ms);
}

// A small yes/no dialog, optionally with a text box.
// Resolves to false (cancel), true (yes) or the typed text.
export function ask(text: string, { yes = 'Yes', input = null as string | null } = {}): Promise<boolean | string> {
  return new Promise((resolve) => {
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yes;
    $('confirm').querySelector('input')?.remove();
    let box: HTMLInputElement | null = null;
    if (input !== null) {
      box = document.createElement('input');
      box.maxLength = 20;
      box.value = input;
      $('confirm-text').after(box);
    }
    $('confirm').classList.remove('hidden');
    box?.focus();
    const done = (v: boolean | string) => {
      $('confirm').classList.add('hidden');
      $('confirm-yes').onclick = $('confirm-no').onclick = null;
      resolve(v);
    };
    $('confirm-yes').onclick = () => done(box ? box.value : true);
    $('confirm-no').onclick = () => done(false);
  });
}

// Show that a button is working: spinner, new label, can't be tapped again.
// Returns a function that puts the button back.
export function busy(button: HTMLElement, label: string): () => void {
  const old = button.innerHTML;
  (button as HTMLButtonElement).disabled = true;
  button.classList.add('busy');
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(label)}`;
  return () => {
    (button as HTMLButtonElement).disabled = false;
    button.classList.remove('busy');
    button.innerHTML = old;
  };
}

export function formatTime(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
