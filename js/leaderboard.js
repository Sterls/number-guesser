// Shared leaderboard, stored in the Supabase database (see supabase/setup.sql).
// Players join one at a time; nothing is sent for a player who hasn't joined.

import { ONLINE } from './config.js';

export function isConfigured() {
  return Boolean(ONLINE.url && ONLINE.anonKey);
}

async function rpc(fn, args) {
  const headers = { apikey: ONLINE.anonKey, 'Content-Type': 'application/json' };
  // Older "anon" keys are JWTs and also go in Authorization; newer
  // "publishable" keys must only be sent as apikey.
  if (ONLINE.anonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${ONLINE.anonKey}`;
  const res = await fetch(`${ONLINE.url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(args),
  });
  if (!res.ok) {
    let message = '';
    try { message = (await res.json()).message || ''; } catch { /* not JSON */ }
    const err = new Error(message || `Leaderboard request failed (${res.status})`);
    err.nameRejected = message === 'name not allowed';
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Totals for one code length from a player's finished games, as the database wants them.
export function totalsFor(games, length) {
  const mine = games.filter((g) => g.length === length);
  const cracked = mine.filter((g) => g.won);
  return {
    played: mine.length,
    cracked: cracked.length,
    guesses: cracked.reduce((sum, g) => sum + g.guesses.length, 0),
    best: cracked.length ? Math.min(...cracked.map((g) => g.guesses.length)) : null,
  };
}

// Send a player's totals for each code length they've played (all at once).
export async function submit(secret, name, games, lengths) {
  await Promise.all(lengths.map((length) => {
    const t = totalsFor(games, length);
    if (!t.played) return null;
    return rpc('vault_submit', {
      p_secret: secret, p_name: name, p_length: length,
      p_played: t.played, p_cracked: t.cracked, p_guesses: t.guesses, p_best: t.best,
    });
  }));
}

// { top: [{ rank, name, played, cracked, avg, best, me }], me: row | null }
export async function fetchBoard(length, order, secret) {
  return (await rpc('vault_board', { p_length: length, p_order: order, p_secret: secret || null }))
    || { top: [], me: null };
}

// Flag a nickname as inappropriate. Three reports from different players hide it.
export async function report(reporterSecret, name) {
  await rpc('vault_report', { p_reporter: reporterSecret, p_name: name });
}

// Delete a player's entry (every code length).
export async function remove(secret) {
  await rpc('vault_delete', { p_secret: secret });
}
