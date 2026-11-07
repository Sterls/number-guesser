// Players, their finished games and settings, saved on the phone only.

const KEY = 'code-crack-save-v1';

const defaults = () => ({
  players: [], // { id, name, created, games: [], current: null | unfinished game }
  currentId: '',
  settings: { length: 4, showLeft: false, vibrate: true, seenHelp: false },
});

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function load() {
  let data;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : {};
    data = { ...defaults(), ...saved, settings: { ...defaults().settings, ...saved.settings } };
  } catch {
    data = defaults();
  }
  return data;
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: the game still works, it just won't remember.
  }
}

export function nameProblem(raw, players, exceptId = '') {
  const name = raw.trim();
  if (!name) return 'Please type a name.';
  if (name.length > 20) return 'Names can be up to 20 characters.';
  if (players.some((p) => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase())) {
    return 'There is already a player with that name.';
  }
  return '';
}
