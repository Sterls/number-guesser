// The server calls (Postgres functions in supabase/setup.sql).

import { supabase, currentUser } from './supabase';
import type { Board, BoardRow, DailyRow, Me, RoomState, ServerGame, StoryMap } from '../lib/types';

export class ApiError extends Error {
  offline: boolean;
  constructor(message: string, offline = false) {
    super(message);
    this.offline = offline;
  }
}

export const online = () => Boolean(supabase && currentUser()) && navigator.onLine;

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new ApiError('Online play is switched off.', true);
  if (!navigator.onLine) throw new ApiError("You're offline.", true);
  let result;
  try {
    result = await supabase.rpc(fn, args);
  } catch {
    throw new ApiError("Couldn't reach the server. Check your internet.", true);
  }
  const { data, error } = result;
  if (error) {
    const offline = /fetch|network|load failed/i.test(error.message);
    throw new ApiError(offline ? "Couldn't reach the server. Check your internet." : error.message, offline);
  }
  return data as T;
}

export const api = {
  me: () => rpc<Me>('vault_me'),
  setName: (name: string) => rpc<Me>('vault_set_name', { p_name: name }),
  setBoard: (on: boolean) => rpc<Me>('vault_set_board', { p_on: on }),
  history: () => rpc<ServerGame[]>('vault_history'),
  deleteMe: () => rpc<void>('vault_delete_me'),
  mergeToken: () => rpc<string>('vault_merge_token'),
  merge: (token: string) => rpc<Me>('vault_merge', { p_token: token }),

  start: (mode: 'daily' | 'single', length: number, day?: string) =>
    rpc<ServerGame>('vault_start', { p_mode: mode, p_length: length, p_day: day ?? null }),
  game: (id: string) => rpc<ServerGame | null>('vault_game', { p_game: id }),
  guess: (id: string, guess: string) => rpc<ServerGame>('vault_guess', { p_game: id, p_guess: guess }),
  giveUp: (id: string) => rpc<ServerGame>('vault_give_up', { p_game: id }),
  myStreak: (day: string) => rpc<number>('vault_my_streak', { p_day: day }),
  storyStart: (level?: number) => rpc<ServerGame>('vault_story_start', { p_level: level ?? null }),
  storyMap: () => rpc<StoryMap>('vault_story_map'),

  roomCreate: (length: number) => rpc<RoomState>('vault_room_create', { p_length: length }),
  roomJoin: (code: string) => rpc<RoomState>('vault_room_join', { p_code: code }),
  roomState: (id: string) => rpc<RoomState | null>('vault_room_state', { p_room: id }),
  roomStart: (id: string) => rpc<RoomState>('vault_room_start', { p_room: id }),
  roomEnd: (id: string) => rpc<RoomState>('vault_room_end', { p_room: id }),
  roomLeave: (id: string) => rpc<void>('vault_room_leave', { p_room: id }),

  dailyBoard: (day: string) => rpc<Board<DailyRow> & { day: string; players: number }>('vault_daily_board', { p_day: day }),
  board: (length: number, order: 'avg' | 'best') => rpc<Board<BoardRow>>('vault_board', { p_length: length, p_order: order }),
  report: (name: string) => rpc<void>('vault_report', { p_name: name }),
};
