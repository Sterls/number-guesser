// A live line between the two phones in a room. The server holds the game;
// this only says "something changed, look again" (so the other phone
// updates straight away) and who's online. If it can't connect, the room
// still works: the phone asks the server every few seconds anyway.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface Live {
  poke(): void;
  leave(): void;
}

export function joinLive(code: string, myId: string, onPoke: () => void, onPresence: (othersOnline: number) => void): Live {
  if (!supabase) return { poke() {}, leave() {} };
  const client = supabase;
  let channel: RealtimeChannel | null = client.channel(`vault-room-${code}`, {
    config: { broadcast: { self: false }, presence: { key: myId } },
  });
  channel.on('broadcast', { event: 'poke' }, () => onPoke());
  channel.on('presence', { event: 'sync' }, () => {
    const state = channel?.presenceState() ?? {};
    onPresence(Object.keys(state).filter((k) => k !== myId).length);
  });
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') channel?.track({ at: Date.now() });
  });
  return {
    poke: () => { channel?.send({ type: 'broadcast', event: 'poke', payload: {} }); },
    leave: () => {
      if (channel) client.removeChannel(channel);
      channel = null;
    },
  };
}
