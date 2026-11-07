// What this phone keeps: settings, offline games, a copy of the account's
// history (so stats work offline) and the room it's in. The account itself
// and ranked games live on the server.

import type { PlayedGame } from './lib/stats';

export interface Settings {
  length: number;     // single player code length
  showLeft: boolean;  // show how many codes are still possible
  sound: boolean;
  vibrate: boolean;
  seenHelp: boolean;
}

export interface OfflineGame {
  length: number;
  secret: string;
  guesses: string[];
  notes: Record<string, number>;
  startedAt: number;
  elapsed: number;
}

interface Save {
  settings: Settings;
  name: string;                 // the player's name (also on the server)
  offline: OfflineGame | null;  // an unfinished offline game
  local: PlayedGame[];          // finished offline games (and games from before accounts)
  history: PlayedGame[];        // the account's server games, cached
  historyFor: string;           // which account `history` belongs to
  room: { id: string; code: string } | null;
  notes: Record<string, Record<string, number>>; // notes per server game id
  migrated: boolean;
}

const KEY = 'vault-v2';
const OLD_KEY = 'vault-save-v1';

const defaults = (): Save => ({
  settings: { length: 4, showLeft: false, sound: true, vibrate: true, seenHelp: false },
  name: '',
  offline: null,
  local: [],
  history: [],
  historyFor: '',
  room: null,
  notes: {},
  migrated: false,
});

function read(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return { ...defaults(), ...saved, settings: { ...defaults().settings, ...saved.settings } };
  } catch {
    return defaults();
  }
}

export const data: Save = read();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked: the game still works, it just won't remember.
  }
}

export const settings = () => data.settings;

// Before accounts, several players could share a phone. Keep the player who
// was playing last: their name, settings and games (as unranked history).
// The old save is left as it was.
interface OldGame {
  mode: string; length: number; date: string; at: number; secret: string | null;
  guesses: string[]; won: boolean; ms: number; result?: 'win' | 'lose' | 'draw'; opponent?: string;
}
export function migrate() {
  if (data.migrated) return;
  data.migrated = true;
  try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
    if (old?.players?.length) {
      const p = old.players.find((x: { id: string }) => x.id === old.currentId) || old.players[0];
      data.name ||= p.name || '';
      data.local.push(...(p.games as OldGame[]).map((g): PlayedGame => ({
        mode: g.mode === 'daily' ? 'daily' : g.mode === 'pvp' ? 'room' : 'offline',
        length: g.length, date: g.date, at: g.at, secret: g.secret, guesses: g.guesses,
        won: g.won, ms: g.ms, ranked: false, result: g.result, opponent: g.opponent,
      })));
      if (old.settings) {
        data.settings.length = old.settings.length ?? data.settings.length;
        data.settings.showLeft = old.settings.showLeft ?? data.settings.showLeft;
        data.settings.vibrate = old.settings.vibrate ?? data.settings.vibrate;
        data.settings.seenHelp = old.settings.seenHelp ?? data.settings.seenHelp;
      }
    }
  } catch {
    // Nothing usable in the old save.
  }
  save();
}
