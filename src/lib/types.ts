// What the server sends back (see supabase/setup.sql, vault_game_json and
// vault_room_state).

export interface Guess {
  guess: string;
  exact: number;
  close: number;
  ms: number;
}

export interface ServerGame {
  id: string;
  mode: 'daily' | 'single' | 'room';
  length: number;
  day: string | null;
  round: number | null;
  opponent: string | null;
  result: 'win' | 'lose' | 'draw' | null;
  guesses: Guess[];
  cracked: boolean;
  gave_up: boolean;
  finished: boolean;
  started_at: string;
  finished_at: string | null;
  secret: string | null; // only once the game is over
}

export interface Me {
  name: string | null;
  on_board: boolean;
}

export type RoomStyle = 'own' | 'same';

export interface RoomState {
  id: string;
  code: string;
  style: RoomStyle;
  length: number;
  round: number;
  host: boolean;
  phase: 'waiting' | 'setcode' | 'play' | 'done';
  me_name: string;
  them_name: string | null;
  them_left: boolean;
  opponent: string | null;
  my_code: string | null;
  their_code_set: boolean;
  mine: ServerGame | null;
  theirs: {
    count: number;
    cracked: boolean;
    gave_up: boolean;
    cracked_at: number | null;
    game: ServerGame | null; // their guesses, when you're allowed to see them
  } | null;
  result: 'win' | 'lose' | 'draw' | null;
  rematch: { me: boolean; them: boolean };
}

export interface BoardRow {
  rank: number;
  name: string;
  played: number;
  cracked: number;
  avg: number;
  best: number;
  me: boolean;
}

export interface DailyRow {
  rank: number;
  name: string;
  cracked: boolean;
  guesses: number;
  ms: number | null;
  streak: number;
  me: boolean;
}

export interface Board<Row> {
  top: Row[];
  me: Row | null;
  players?: number;
}
