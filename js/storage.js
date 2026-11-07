// Players, their finished games and settings, saved on the phone only.

// With `?localroom=a` in the address (testing two players in one browser),
// each tab name gets its own save so the two players don't share one.
const testTab = typeof location !== 'undefined' && new URLSearchParams(location.search).get('localroom');
const KEY = `vault-save-v1${testTab ? `-${testTab}` : ''}`;

const defaults = () => ({
  players: [], // { id, name, created, games: [], inProgress: { daily, practice }, board?: { secret } }
  currentId: '',
  versus: null, // the room this phone is in when playing a friend (see js/main.js)
  deviceId: '', // random id sent with leaderboard reports, so each phone reports a name once
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
