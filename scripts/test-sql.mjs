// Tests supabase/setup.sql against a real Postgres, with a small stand-in for
// Supabase's auth schema. Needs Postgres installed locally:
//
//   PGHOST=/tmp/vaultpg PGPORT=5499 PGUSER=postgres node scripts/test-sql.mjs
//
// It wipes and recreates the public and auth schemas of that database, so
// never point it at a real one. Skips (exit 0) if psql can't connect.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const psql = (sql, { role = null, user = null } = {}) => {
  const pre = [
    user ? `set request.jwt.claim.sub = '${user}';` : "set request.jwt.claim.sub = '';",
    role ? `set role ${role};` : '',
  ].join(' ');
  return execFileSync('psql', ['-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', `${pre} ${sql}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
};
const fails = (fn, pattern) => {
  try { fn(); } catch (e) { assert.match(String(e.stderr), pattern); return; }
  assert.fail(`expected an error matching ${pattern}`);
};

try {
  psql('select 1');
} catch {
  console.log('No Postgres to test against (set PGHOST/PGPORT/PGUSER). Skipping.');
  process.exit(0);
}

// A fresh database shaped like a Supabase project.
psql(`
  drop schema if exists public cascade; create schema public; grant usage on schema public to public;
  drop schema if exists auth cascade; create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to public; grant execute on function auth.uid() to public;
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);
const setup = readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
execFileSync('psql', ['-qX', '-v', 'ON_ERROR_STOP=1'], { input: setup, stdio: ['pipe', 'ignore', 'pipe'] });
execFileSync('psql', ['-qX', '-v', 'ON_ERROR_STOP=1'], { input: setup, stdio: ['pipe', 'ignore', 'pipe'] }); // twice: safe to re-run

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
psql(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}')`);
const as = (user) => (sql) => psql(sql, { role: 'authenticated', user });
const a = as(A), b = as(B), c = as(C);
const j = (s) => (s === '' ? null : JSON.parse(s));
const secretOf = (id) => psql(`select secret from vault_games where id = '${id}'`);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('tables and helpers are private', () => {
  fails(() => a('select * from vault_games'), /permission denied/);
  fails(() => a("insert into vault_daily values (current_date, '1234')"), /permission denied/);
  fails(() => psql('select * from vault_profiles', { role: 'anon' }), /permission denied/);
  fails(() => psql('select * from vault_ranked', { role: 'anon' }), /permission denied/);
  fails(() => a("select vault_score('1234','1234')"), /permission denied/);
  fails(() => psql("select vault_start('single', 4)", { role: 'anon' }), /permission denied/);
  fails(() => psql("select vault_start('single', 4)", { role: 'authenticated' }), /not signed in/);
});

test('single player: code stays on the server until the game is over', () => {
  const g = j(a("select vault_start('single', 4)"));
  assert.equal(g.secret, null);
  assert.equal(g.guesses.length, 0);
  const again = j(a("select vault_start('single', 4)"));
  assert.equal(again.id, g.id, 'carries on with the unfinished game');
  const secret = secretOf(g.id);
  const wrong = secret.split('').reverse().join('');
  let s = j(a(`select vault_guess('${g.id}', '${wrong}')`));
  assert.equal(s.guesses[0].exact + s.guesses[0].close, 4);
  assert.equal(s.secret, null);
  s = j(a(`select vault_guess('${g.id}', '${wrong}')`));
  assert.equal(s.guesses.length, 1, 'a repeated guess is ignored');
  fails(() => a(`select vault_guess('${g.id}', '1123')`), /bad guess/);
  fails(() => a(`select vault_guess('${g.id}', '12345')`), /bad guess/);
  fails(() => b(`select vault_guess('${g.id}', '1234')`), /game not found/);
  s = j(a(`select vault_guess('${g.id}', '${secret}')`));
  assert.equal(s.cracked, true);
  assert.equal(s.finished, true);
  assert.equal(s.secret, secret);
  assert.equal(s.guesses.length, 2);
  const next = j(a("select vault_start('single', 4)"));
  assert.notEqual(next.id, g.id);
  const gaveUp = j(a(`select vault_give_up('${next.id}')`));
  assert.equal(gaveUp.gave_up, true);
  assert.equal(gaveUp.secret.length, 4);
});

test('daily: one per player per day, same code for everyone', () => {
  const day = psql('select current_date');
  const ga = j(a(`select vault_start('daily', 4, '${day}')`));
  const gb = j(b(`select vault_start('daily', 4, '${day}')`));
  assert.equal(secretOf(ga.id), secretOf(gb.id));
  assert.equal(j(a(`select vault_start('daily', 4, '${day}')`)).id, ga.id);
  fails(() => a("select vault_start('daily', 4, current_date - 5)"), /bad day/);
  const secret = secretOf(ga.id);
  a(`select vault_guess('${ga.id}', '${secret.split('').reverse().join('')}')`);
  a(`select vault_guess('${ga.id}', '${secret}')`);
  b(`select vault_guess('${gb.id}', '${secret}')`);
});

test('names, leaderboard opt-in and the daily board', () => {
  fails(() => a("select vault_set_board(true)"), /choose a name/);
  fails(() => a("select vault_set_name('big ass')"), /name not allowed/);
  a("select vault_set_name('Sam')"); a('select vault_set_board(true)');
  b("select vault_set_name('Alex')"); b('select vault_set_board(true)');
  const board = j(psql('select vault_daily_board(current_date)', { role: 'anon' }));
  assert.deepEqual(board.top.map((r) => [r.name, r.guesses]), [['Alex', 1], ['Sam', 2]]);
  assert.equal(board.top[0].streak, 1);
  b('select vault_set_board(false)');
  assert.deepEqual(j(psql('select vault_daily_board(current_date)', { role: 'anon' })).top.map((r) => r.name), ['Sam']);
  b('select vault_set_board(true)');
});

test('streaks count days in a row', () => {
  for (const d of [1, 2, 4]) {
    psql(`insert into vault_games (user_id, mode, length, secret, day, guesses, guess_ms, cracked, finished_at)
          values ('${A}', 'daily', 4, '1234', current_date - ${d}, '{1234}', '{1000}', true, now())`);
  }
  assert.equal(Number(a('select vault_my_streak(current_date)')), 3); // today, -1, -2
  // On a day that isn't cracked (yet), a streak up to the day before still counts.
  assert.equal(Number(a('select vault_my_streak(current_date - 3)')), 1);
  assert.equal(Number(a('select vault_my_streak(current_date - 5)')), 0);
});

test('all-time board: averages, games played, abandoned games count as misses', () => {
  const day = psql('select current_date');
  const board = j(psql("select vault_board(4, 'avg')", { role: 'anon' }));
  const sam = board.top.find((r) => r.name === 'Sam');
  // single cracked (2) + single gave up + daily today (2) + 3 old dailies (1 each)
  assert.equal(sam.played, 6);
  assert.equal(sam.cracked, 5);
  assert.equal(Number(sam.avg), (2 + 2 + 1 + 1 + 1) / 5);
  assert.equal(sam.best, 1);
  // An unfinished game counts once it's 24 hours old.
  const g = j(a("select vault_start('single', 4)"));
  assert.equal(j(psql("select vault_board(4, 'avg')", { role: 'anon' })).top.find((r) => r.name === 'Sam').played, 6);
  psql(`update vault_games set started_at = now() - interval '25 hours' where id = '${g.id}'`);
  assert.equal(j(psql("select vault_board(4, 'avg')", { role: 'anon' })).top.find((r) => r.name === 'Sam').played, 7);
  assert.ok(day);
});

test("'own' room: codes set by players, scored by the server, fewest guesses wins", () => {
  const r = j(a("select vault_room_create('own', 4)"));
  assert.equal(r.phase, 'waiting');
  fails(() => b("select vault_room_join('ZZZZZ')"), /room not found/);
  let rb = j(b(`select vault_room_join('${r.code}')`));
  assert.equal(rb.phase, 'setcode');
  fails(() => c(`select vault_room_join('${r.code}')`), /room full/);
  a(`select vault_room_set_code('${r.id}', '0472')`);
  rb = j(b(`select vault_room_state('${r.id}')`));
  assert.equal(rb.their_code_set, true);
  assert.equal(rb.phase, 'setcode');
  rb = j(b(`select vault_room_set_code('${r.id}', '1593')`));
  assert.equal(rb.phase, 'play');
  assert.equal(rb.mine.secret, null, "B can't see A's code");
  let ra = j(a(`select vault_room_state('${r.id}')`));
  assert.equal(ra.my_code, '0472');
  // A cracks B's code (1593) in 2; B misses twice -> A wins.
  a(`select vault_guess('${ra.mine.id}', '1234')`);
  b(`select vault_guess('${rb.mine.id}', '1234')`);
  ra = j(a(`select vault_room_state('${r.id}')`));
  assert.equal(ra.theirs.game.guesses[0].guess, '1234', "in 'own' rooms you see their guesses at your code");
  assert.equal(ra.result, null);
  a(`select vault_guess('${ra.mine.id}', '1593')`);
  ra = j(a(`select vault_room_state('${r.id}')`));
  assert.equal(ra.result, null, 'B can still tie');
  b(`select vault_guess('${rb.mine.id}', '5678')`);
  ra = j(a(`select vault_room_state('${r.id}')`));
  rb = j(b(`select vault_room_state('${r.id}')`));
  assert.equal(ra.result, 'win');
  assert.equal(rb.result, 'lose');
  assert.equal(rb.phase, 'done');
  assert.equal(rb.mine.secret, '0472', 'codes revealed when the round is over');
  // Rematch: needs both.
  a(`select vault_room_rematch('${r.id}')`);
  assert.equal(j(b(`select vault_room_state('${r.id}')`)).rematch.them, true);
  rb = j(b(`select vault_room_rematch('${r.id}')`));
  assert.equal(rb.round, 2);
  assert.equal(rb.phase, 'setcode');
});

test("'same' room: one random code, their guesses hidden until the end, ties go to the faster", () => {
  const r = j(a("select vault_room_create('same', 3)"));
  let rb = j(b(`select vault_room_join('${r.code}')`));
  assert.equal(rb.phase, 'play');
  let ra = j(a(`select vault_room_state('${r.id}')`));
  const secret = secretOf(ra.mine.id);
  assert.equal(secretOf(rb.mine.id), secret);
  const miss = secret.split('').reverse().join('');
  b(`select vault_guess('${rb.mine.id}', '${miss}')`);
  ra = j(a(`select vault_room_state('${r.id}')`));
  assert.equal(ra.theirs.count, 1);
  assert.equal(ra.theirs.game, null, "same-code rooms hide the other player's guesses");
  a(`select vault_guess('${ra.mine.id}', '${miss}')`);
  // Both crack on guess 2; B's timing is made later.
  a(`select vault_guess('${ra.mine.id}', '${secret}')`);
  b(`select vault_guess('${rb.mine.id}', '${secret}')`);
  psql(`update vault_games set guess_ms[2] = guess_ms[2] + 5000 where id = '${rb.mine.id}'`);
  psql(`update vault_games set result = null where room_id = '${r.id}'`);
  psql(`select vault_room_settle('${r.id}')`);
  ra = j(a(`select vault_room_state('${r.id}')`));
  assert.equal(ra.result, 'win');
  assert.equal(ra.theirs.game.guesses.length, 2, 'shown once the round is over');
});

test('leaving mid-game gives the other player the win', () => {
  const r = j(a("select vault_room_create('same', 4)"));
  j(b(`select vault_room_join('${r.code}')`));
  b(`select vault_room_leave('${r.id}')`);
  const ra = j(a(`select vault_room_state('${r.id}')`));
  assert.equal(ra.result, 'win');
  assert.equal(ra.them_left, true);
  assert.equal(ra.opponent, 'Alex');
  assert.equal(j(b(`select vault_room_state('${r.id}')`)), null);
  // Someone new joins: a fresh round.
  const rc = j(c(`select vault_room_join('${r.code}')`));
  assert.equal(rc.phase, 'play');
  assert.equal(rc.round, 2);
});

test('merging a guest into the account signed in on the same phone', () => {
  const token = c('select vault_merge_token()');
  const before = Number(psql(`select count(*) from vault_games where user_id = '${C}'`));
  a(`select vault_merge('${token}')`);
  assert.equal(Number(psql(`select count(*) from vault_games where user_id = '${C}'`)), 0);
  assert.ok(Number(psql(`select count(*) from vault_games where user_id = '${A}'`)) >= before);
  a(`select vault_merge('${token}')`); // a used token does nothing
});

test('reports: three hide a name', () => {
  a("select vault_report('Alex')");
  c("select vault_report('Alex')");
  assert.ok(j(psql('select vault_daily_board(current_date)', { role: 'anon' })).top.some((r) => r.name === 'Alex'));
  psql(`insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000d')`);
  as('00000000-0000-0000-0000-00000000000d')("select vault_report('Alex')");
  assert.ok(!j(psql('select vault_daily_board(current_date)', { role: 'anon' })).top.some((r) => r.name === 'Alex'));
});

test('deleting my data', () => {
  b('select vault_delete_me()');
  assert.equal(Number(psql(`select count(*) from vault_games where user_id = '${B}'`)), 0);
  assert.equal(j(b('select vault_me()')).name, null);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`not ok - ${name}\n  ${e.stack || e}`); }
}
console.log(failed ? `${failed} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
