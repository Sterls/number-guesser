// The Supabase project behind accounts, ranked games, rooms and leaderboards
// (the same free project as Whoosh Blocks; Vault only uses vault_* tables and
// functions). The publishable key is safe to share. Set both to '' to play
// offline only. VITE_SUPABASE_URL / VITE_SUPABASE_KEY override them at build
// time (the tests point the game at a local stand-in).
export const SUPABASE = {
  url: import.meta.env.VITE_SUPABASE_URL ?? 'https://wsgugxneqffhidqsduzg.supabase.co',
  key: import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_jW6Ok47OeK4iYu86JLQATw_4tK8lLFn',
};
