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
  mode: 'daily' | 'single' | 'room' | 'story';
  length: number;
  day: string | null;
  round: number | null;     // room round, or story level
  opponent: string | null;
  result: 'win' | 'lose' | 'draw' | null;
  place?: number | null;   // room games, once the round is over
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
  story_level?: number;
}

export interface StoryMap {
  level: number;                                  // the level to play next
  best: { level: number; guesses: number }[];     // fewest guesses per cracked level
}

export interface RoomPlayer {
  pid: string;            // id within the room (for the host to remove someone)
  name: string;
  me: boolean;
  host: boolean;
  in_room: boolean;       // false: left during this round
  in_round: boolean;      // false: joined after this round started
  count: number;          // guesses so far
  cracked: boolean;
  gave_up: boolean;
  finished: boolean;
  place: number | null;   // once the round is over (1 = first)
  ms: number | null;      // time of the cracking guess
  guesses: Guess[] | null; // only once the round is over
}

export interface RoomState {
  id: string;
  code: string;
  length: number;
  round: number;           // 0 until the first round starts
  playing: boolean;
  host: boolean;           // am I the host
  host_name: string;
  mine: ServerGame | null; // my game this round
  secret: string | null;   // this round's code, once it's over
  players: RoomPlayer[];
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
