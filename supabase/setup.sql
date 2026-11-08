-- Vault: accounts, server-checked games, daily code, rooms and leaderboards.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- It is safe to run again after changes. Everything it makes starts with
-- vault_, so it sits next to Whoosh Blocks in the same project.
--
-- How it works
--   * Every phone signs in (a guest account, or Google). auth.uid() is the player.
--   * Secret codes are made and kept here. The phone sends guesses and gets
--     back only the feedback; a code is only sent once its game is over.
--   * Leaderboards only count these server-checked games. A game left
--     unfinished for 24 hours counts as not cracked, so quitting bad games
--     doesn't help.
--   * The public (and players) can only call the vault_* functions below.
--     The tables have row level security on and no policies, so they can't
--     be read or written directly.
--
-- Version 2 replaces the first leaderboard (it only held test data).
drop function if exists public.vault_submit(uuid, text, int, int, int, bigint, int);
drop function if exists public.vault_board(int, text, uuid);
drop function if exists public.vault_report(uuid, text);
drop function if exists public.vault_delete(uuid);
drop table if exists public.vault_scores;
drop table if exists public.vault_reports;

create table if not exists public.vault_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text check (name is null or char_length(name) between 1 and 20),
  on_board boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.vault_daily (
  day date primary key,
  secret text not null
);

-- Version 3 turned two-player rooms into lobbies: drop the old shape.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'vault_rooms' and column_name = 'guest') then
    drop table public.vault_rooms cascade;
  end if;
end;
$$;
drop function if exists public.vault_room_new_round(public.vault_rooms);
drop function if exists public.vault_room_create(text, int);
drop function if exists public.vault_room_set_code(uuid, text);
drop function if exists public.vault_room_rematch(uuid);

create table if not exists public.vault_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host uuid not null references auth.users (id) on delete cascade,
  length int not null check (length between 3 and 5),
  round int not null default 0,                    -- 0 until the first round starts
  playing boolean not null default false,          -- a round is going on
  round_started_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_room_players (
  room_id uuid not null references public.vault_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.vault_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('daily', 'single', 'room')),
  length int not null check (length between 3 and 5),
  secret text not null,
  day date,                                         -- daily games
  room_id uuid references public.vault_rooms (id) on delete set null,
  round int,                                        -- room games
  opponent text,                                    -- room games: the other players' names
  guesses text[] not null default '{}',
  guess_ms int[] not null default '{}',             -- when each guess was made, ms after the start
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cracked boolean not null default false,
  gave_up boolean not null default false,
  result text check (result in ('win', 'lose', 'draw')),  -- room games: 1st (or tied 1st) / not
  place int                                               -- room games: 1 = first
);
alter table public.vault_games add column if not exists place int;
-- (Re)link room games to rooms: rooms are dropped and recreated when their shape changes.
alter table public.vault_games drop constraint if exists vault_games_room_id_fkey;
update public.vault_games set room_id = null
  where room_id is not null and room_id not in (select id from public.vault_rooms);  -- games from removed rooms stay
alter table public.vault_games add constraint vault_games_room_id_fkey
  foreign key (room_id) references public.vault_rooms (id) on delete set null;
create unique index if not exists vault_games_one_daily on public.vault_games (user_id, day) where mode = 'daily';
create index if not exists vault_games_user on public.vault_games (user_id, started_at);
create index if not exists vault_games_room on public.vault_games (room_id, round);

create table if not exists public.vault_reports (
  reporter uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (reporter, name)
);

create table if not exists public.vault_merge_tokens (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.vault_profiles enable row level security;
alter table public.vault_daily enable row level security;
alter table public.vault_rooms enable row level security;
alter table public.vault_room_players enable row level security;
alter table public.vault_games enable row level security;
alter table public.vault_reports enable row level security;
alter table public.vault_merge_tokens enable row level security;
-- Supabase grants new tables to anon/authenticated by default; take that back
-- too, so the tables really are only reachable through the functions.
revoke all on public.vault_profiles, public.vault_daily, public.vault_rooms, public.vault_room_players, public.vault_games,
  public.vault_reports, public.vault_merge_tokens from anon, authenticated;

-- ---------- rules ----------

-- Nickname filter. Keep these lists the same as src/lib/names.ts (npm test checks).
create or replace function public.vault_name_ok(p_name text)
returns boolean
language plpgsql
immutable
as $$
declare
  n text;
  part text;
begin
  if p_name is null or char_length(trim(p_name)) < 1 or char_length(trim(p_name)) > 20 then
    return false;
  end if;
  if trim(p_name) !~ '^[A-Za-z0-9 _.''!-]+$' then
    return false;
  end if;
  n := lower(p_name);
  if n ~ '(https?|www\.|\.com|\.net|\.org|@)' then
    return false;
  end if;
  n := translate(n, '0134578@$', 'oieastbas');
  -- BLOCKED_PARTS
  foreach part in array array['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'whore', 'slut', 'twat', 'bitch', 'bastard', 'pussy', 'penis', 'vagina', 'porn', 'hitler', 'retard', 'dildo', 'jizz', 'spunk', 'bollock', 'tosser', 'kike', 'tranny', 'rapist'] loop
    if position(part in regexp_replace(n, '[^a-z]', '', 'g')) > 0 then
      return false;
    end if;
  end loop;
  -- BLOCKED_WORDS
  if regexp_split_to_array(n, '[^a-z]+') && array['ass', 'arse', 'asshole', 'arsehole', 'dick', 'cock', 'tit', 'tits', 'sex', 'rape', 'nazi', 'nazis', 'paki', 'chink', 'spic', 'wank', 'wanker', 'nonce', 'fag', 'fags', 'homo', 'cum', 'piss', 'prick', 'dyke', 'gook', 'coon', 'kkk', 'kys'] then
    return false;
  end if;
  return true;
end;
$$;

-- A random code: `len` different digits.
create or replace function public.vault_make_code(len int)
returns text
language sql
volatile
as $$
  select string_agg(d, '' order by r)
  from (select d, random() as r from unnest(string_to_array('0123456789', null)) as d order by r limit len) x;
$$;

create or replace function public.vault_valid_guess(g text, len int)
returns boolean
language sql
immutable
as $$
  select g ~ '^[0-9]+$' and char_length(g) = len
     and (select count(distinct c) from unnest(string_to_array(g, null)) c) = len;
$$;

-- [right spot, wrong spot]
create or replace function public.vault_score(secret text, guess text)
returns int[]
language sql
immutable
as $$
  select array[
    count(*) filter (where substr(secret, i, 1) = substr(guess, i, 1)),
    count(*) filter (where substr(secret, i, 1) <> substr(guess, i, 1) and position(substr(guess, i, 1) in secret) > 0)
  ]::int[]
  from generate_series(1, char_length(guess)) i;
$$;

create or replace function public.vault_me_id()
returns uuid
language plpgsql
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  return auth.uid();
end;
$$;

create or replace function public.vault_name_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select name from vault_profiles where user_id = p_user), 'Player');
$$;

-- What a phone may see of a game. The code only once it's over (or `reveal`).
create or replace function public.vault_game_json(g public.vault_games, reveal boolean default false)
returns json
language sql
stable
as $$
  select json_build_object(
    'id', g.id, 'mode', g.mode, 'length', g.length, 'day', g.day, 'round', g.round,
    'opponent', g.opponent, 'result', g.result, 'place', g.place,
    'guesses', coalesce((
      select json_agg(json_build_object('guess', x.guess, 'exact', s[1], 'close', s[2], 'ms', x.ms) order by x.n)
      from unnest(g.guesses, g.guess_ms) with ordinality as x(guess, ms, n),
           lateral (select vault_score(g.secret, x.guess) as s) sc), '[]'::json),
    'cracked', g.cracked, 'gave_up', g.gave_up,
    'finished', g.finished_at is not null,
    'started_at', g.started_at, 'finished_at', g.finished_at,
    -- The code once the game is over, but in a room only once the whole round
    -- is over (so someone who gives up can't pass it on).
    'secret', case
      when g.room_id is not null and exists (select 1 from vault_rooms r where r.id = g.room_id and r.round = g.round and r.playing) then null
      when g.finished_at is not null or reveal then g.secret end);
$$;

-- ---------- me ----------

create or replace function public.vault_me()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
  p vault_profiles%rowtype;
begin
  insert into vault_profiles (user_id) values (me) on conflict do nothing;
  select * into p from vault_profiles where user_id = me;
  return json_build_object('name', p.name, 'on_board', p.on_board);
end;
$$;

create or replace function public.vault_set_name(p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
begin
  if not vault_name_ok(p_name) then
    raise exception 'name not allowed' using errcode = '22023';
  end if;
  insert into vault_profiles (user_id, name) values (me, trim(p_name))
    on conflict (user_id) do update set name = excluded.name;
  return vault_me();
end;
$$;

create or replace function public.vault_set_board(p_on boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
begin
  perform vault_me();
  if p_on and (select name from vault_profiles where user_id = me) is null then
    raise exception 'choose a name first' using errcode = '22023';
  end if;
  update vault_profiles set on_board = p_on where user_id = me;
  return vault_me();
end;
$$;

-- All my finished games (for the stats screen), newest last.
create or replace function public.vault_history()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(vault_game_json(g) order by g.started_at), '[]'::json)
  from vault_games g
  where g.user_id = vault_me_id() and g.finished_at is not null;
$$;

-- Delete my account and everything about me: games, profile, rooms I host,
-- and the account itself (with its Google email, if signed in with Google).
create or replace function public.vault_delete_me()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
begin
  delete from vault_games where user_id = me;
  delete from vault_room_players where user_id = me;
  delete from vault_rooms r where r.host = me;
  delete from vault_profiles where user_id = me;
  delete from vault_merge_tokens where user_id = me;
  delete from vault_reports where reporter = me;
  delete from auth.users where id = me;  -- the account itself (Supabase removes its Google link with it)
end;
$$;

-- Moving a guest's games to the account the player signs in to on this phone.
-- The guest asks for a token, signs in, and the new account redeems it.
create or replace function public.vault_merge_token()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
begin
  delete from vault_merge_tokens where created_at < now() - interval '1 hour';
  insert into vault_merge_tokens (user_id) values (vault_me_id()) returning token into t;
  return t;
end;
$$;

create or replace function public.vault_merge(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
  old uuid;
begin
  delete from vault_merge_tokens where token = p_token and created_at > now() - interval '1 hour'
    returning user_id into old;
  if old is null or old = me then
    return vault_me();
  end if;
  -- Keep this account's daily game if both played the same day.
  delete from vault_games g where g.user_id = old and g.mode = 'daily'
    and exists (select 1 from vault_games h where h.user_id = me and h.mode = 'daily' and h.day = g.day);
  update vault_games set user_id = me where user_id = old;
  update vault_rooms set host = me where host = old;
  update vault_room_players set user_id = me where user_id = old
    and not exists (select 1 from vault_room_players q where q.room_id = vault_room_players.room_id and q.user_id = me);
  delete from vault_room_players where user_id = old;
  perform vault_me();
  update vault_profiles p set
    name = coalesce(p.name, o.name),
    on_board = p.on_board or o.on_board
  from vault_profiles o where p.user_id = me and o.user_id = old;
  delete from vault_profiles where user_id = old;
  return vault_me();
end;
$$;

-- ---------- single player and daily ----------

-- Start (or carry on with) a game. Daily: one per player per day, 4 digits;
-- `p_day` is the phone's date and must be within a day of the server's.
-- Single player: carries on with an unfinished game of the same length, so
-- starting over doesn't skip a bad code.
create or replace function public.vault_start(p_mode text, p_length int, p_day date default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
  g vault_games%rowtype;
  code text;
begin
  perform vault_me();
  if p_mode = 'daily' then
    if p_day is null or p_day not between current_date - 1 and current_date + 1 then
      raise exception 'bad day' using errcode = '22023';
    end if;
    select * into g from vault_games where user_id = me and mode = 'daily' and day = p_day;
    if found then
      return vault_game_json(g);
    end if;
    insert into vault_daily (day, secret) values (p_day, vault_make_code(4)) on conflict do nothing;
    select secret into code from vault_daily where day = p_day;
    insert into vault_games (user_id, mode, length, secret, day) values (me, 'daily', 4, code, p_day)
      returning * into g;
  elsif p_mode = 'single' then
    if p_length not between 3 and 5 then
      raise exception 'bad length' using errcode = '22023';
    end if;
    select * into g from vault_games
      where user_id = me and mode = 'single' and length = p_length and finished_at is null
      order by started_at desc limit 1;
    if not found then
      insert into vault_games (user_id, mode, length, secret) values (me, 'single', p_length, vault_make_code(p_length))
        returning * into g;
    end if;
  else
    raise exception 'bad mode' using errcode = '22023';
  end if;
  return vault_game_json(g);
end;
$$;

create or replace function public.vault_game(p_game uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select vault_game_json(g) from vault_games g where g.id = p_game and g.user_id = vault_me_id();
$$;

create or replace function public.vault_guess(p_game uuid, p_guess text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
  g vault_games%rowtype;
  s int[];
begin
  select * into g from vault_games where id = p_game and user_id = me for update;
  if not found then
    raise exception 'game not found' using errcode = '22023';
  end if;
  if g.finished_at is not null then
    return vault_game_json(g);
  end if;
  if not vault_valid_guess(p_guess, g.length) then
    raise exception 'bad guess' using errcode = '22023';
  end if;
  if p_guess = any (g.guesses) then
    return vault_game_json(g);  -- sent twice (e.g. a retry): nothing new
  end if;
  if coalesce(array_length(g.guesses, 1), 0) >= 200 then
    raise exception 'too many guesses' using errcode = '22023';
  end if;
  s := vault_score(g.secret, p_guess);
  update vault_games set
    guesses = guesses || p_guess,
    guess_ms = guess_ms || least(floor(extract(epoch from now() - started_at) * 1000), 2000000000)::int,
    cracked = s[1] = g.length,
    finished_at = case when s[1] = g.length then now() end
  where id = g.id
  returning * into g;
  if g.room_id is not null then
    perform vault_room_settle(g.room_id);
    select * into g from vault_games where id = g.id;
  end if;
  return vault_game_json(g);
end;
$$;

create or replace function public.vault_give_up(p_game uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  g vault_games%rowtype;
begin
  update vault_games set gave_up = true, finished_at = now()
    where id = p_game and user_id = vault_me_id() and finished_at is null
    returning * into g;
  if not found then
    select * into g from vault_games where id = p_game and user_id = vault_me_id();
  end if;
  if g.room_id is not null then
    perform vault_room_settle(g.room_id);
    select * into g from vault_games where id = g.id;
  end if;
  return vault_game_json(g);
end;
$$;

-- ---------- rooms ----------
-- Lobbies of up to 8 players. The host starts a round; everyone in the room
-- cracks the same random code. Players are ranked by fewest guesses, then
-- by who made their cracking guess soonest after the start; giving up (or
-- leaving) puts you below everyone who cracked it. The round ends when
-- everyone has finished, or when the host ends it. Players who join during
-- a round play from the next one.

create or replace function public.vault_room_names_except(p_room uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select left(coalesce(string_agg(vault_name_of(user_id), ', ' order by joined_at), ''), 200)
  from vault_room_players where room_id = p_room and user_id <> p_user;
$$;

-- Rank a finished round and open the lobby again (once everyone is done).
create or replace function public.vault_room_settle(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r vault_rooms%rowtype;
  firsts int;
begin
  select * into r from vault_rooms where id = p_room for update;
  if not found or not r.playing then
    return;
  end if;
  if exists (select 1 from vault_games where room_id = r.id and round = r.round and finished_at is null) then
    return;
  end if;
  with ranked as (
    select id, cracked,
           rank() over (order by cracked desc,
                                 case when cracked then array_length(guesses, 1) end asc nulls last,
                                 case when cracked then guess_ms[array_length(guesses, 1)] end asc nulls last) as place
    from vault_games where room_id = r.id and round = r.round
  )
  update vault_games g set place = ranked.place from ranked where g.id = ranked.id;
  select count(*) into firsts from vault_games where room_id = r.id and round = r.round and place = 1 and cracked;
  update vault_games set result = case
      when place = 1 and cracked and firsts > 1 then 'draw'
      when place = 1 and cracked then 'win'
      else 'lose' end
    where room_id = r.id and round = r.round;
  update vault_rooms set playing = false, updated_at = now() where id = r.id;
end;
$$;

-- Everything one player may see about the room right now. Other players'
-- guesses are only shown once the round is over, so nobody can copy.
create or replace function public.vault_room_state(p_room uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
  r vault_rooms%rowtype;
  mine vault_games%rowtype;
begin
  select * into r from vault_rooms where id = p_room;
  if not found or not exists (select 1 from vault_room_players where room_id = r.id and user_id = me) then
    return null;
  end if;
  select * into mine from vault_games where room_id = r.id and round = r.round and user_id = me;
  return json_build_object(
    'id', r.id, 'code', r.code, 'length', r.length, 'round', r.round,
    'playing', r.playing, 'host', r.host = me,
    'host_name', vault_name_of(r.host),
    'mine', case when mine.id is not null then vault_game_json(mine, not r.playing) end,
    'secret', case when not r.playing and r.round > 0 then
        (select secret from vault_games where room_id = r.id and round = r.round limit 1) end,
    -- Everyone in the room, plus anyone who played this round and has since left.
    'players', coalesce((
      select json_agg(x.p order by x.sort1, x.sort2, x.sort3, x.joined)
      from (
        select json_build_object(
                 'name', vault_name_of(u.user_id), 'me', u.user_id = me, 'host', u.user_id = r.host,
                 'in_room', u.in_room, 'in_round', g.id is not null,
                 'count', coalesce(array_length(g.guesses, 1), 0),
                 'cracked', coalesce(g.cracked, false), 'gave_up', coalesce(g.gave_up, false),
                 'finished', g.finished_at is not null,
                 'place', g.place,
                 'ms', case when g.cracked then g.guess_ms[array_length(g.guesses, 1)] end,
                 'guesses', case when g.id is not null and not r.playing then vault_game_json(g, true) -> 'guesses' end) as p,
               coalesce(g.place, 99) as sort1,
               case when g.cracked then array_length(g.guesses, 1) end as sort2,
               case when g.cracked then g.guess_ms[array_length(g.guesses, 1)] end as sort3,
               u.joined
        from (
          select user_id, true as in_room, joined_at as joined from vault_room_players where room_id = r.id
          union all
          select user_id, false, started_at from vault_games
            where room_id = r.id and round = r.round
              and user_id not in (select user_id from vault_room_players where room_id = r.id)
        ) u
        left join vault_games g on g.room_id = r.id and g.round = r.round and g.user_id = u.user_id
      ) x), '[]'::json));
end;
$$;

create or replace function public.vault_room_create(p_length int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
  v_code text;
  rid uuid;
begin
  perform vault_me();
  if p_length not between 3 and 5 then
    raise exception 'bad room' using errcode = '22023';
  end if;
  if (select count(*) from vault_rooms where host = me and updated_at > now() - interval '1 day') >= 30 then
    raise exception 'too many rooms today' using errcode = '22023';
  end if;
  delete from vault_rooms where updated_at < now() - interval '7 days';
  loop
    v_code := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
               from generate_series(1, 5));
    exit when not exists (select 1 from vault_rooms where code = v_code);
  end loop;
  insert into vault_rooms (code, host, length) values (v_code, me, p_length) returning id into rid;
  insert into vault_room_players (room_id, user_id) values (rid, me);
  return vault_room_state(rid);
end;
$$;

create or replace function public.vault_room_join(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
  r vault_rooms%rowtype;
begin
  perform vault_me();
  select * into r from vault_rooms where code = upper(trim(p_code)) for update;
  if not found then
    raise exception 'room not found' using errcode = '22023';
  end if;
  if not exists (select 1 from vault_room_players where room_id = r.id and user_id = me) then
    if (select count(*) from vault_room_players where room_id = r.id) >= 8 then
      raise exception 'room full' using errcode = '22023';
    end if;
    insert into vault_room_players (room_id, user_id) values (r.id, me);
    update vault_rooms set updated_at = now() where id = r.id;
  end if;
  return vault_room_state(r.id);
end;
$$;

-- The host starts a round: a new code for everyone in the room.
create or replace function public.vault_room_start(p_room uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
  r vault_rooms%rowtype;
  code text;
begin
  select * into r from vault_rooms where id = p_room for update;
  if not found or r.host <> me then
    raise exception 'only the host can start' using errcode = '22023';
  end if;
  if r.playing then
    return vault_room_state(r.id);
  end if;
  if (select count(*) from vault_room_players where room_id = r.id) < 2 then
    raise exception 'waiting for players' using errcode = '22023';
  end if;
  code := vault_make_code(r.length);
  update vault_rooms set round = round + 1, playing = true, round_started_at = now(), updated_at = now()
    where id = r.id returning * into r;
  insert into vault_games (user_id, mode, length, secret, room_id, round, opponent, started_at)
    select p.user_id, 'room', r.length, code, r.id, r.round, vault_room_names_except(r.id, p.user_id), now()
    from vault_room_players p where p.room_id = r.id;
  return vault_room_state(r.id);
end;
$$;

-- The host ends the round early: anyone still guessing hasn't cracked it.
create or replace function public.vault_room_end(p_room uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
  r vault_rooms%rowtype;
begin
  select * into r from vault_rooms where id = p_room;
  if not found or r.host <> me then
    raise exception 'only the host can end the round' using errcode = '22023';
  end if;
  update vault_games set finished_at = now()
    where room_id = r.id and round = r.round and finished_at is null;
  perform vault_room_settle(r.id);
  return vault_room_state(r.id);
end;
$$;

-- Leaving mid-round counts as giving up. If the host leaves, the player who
-- joined next becomes the host; the last one out closes the room.
create or replace function public.vault_room_leave(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := vault_me_id();
  r vault_rooms%rowtype;
  next_host uuid;
begin
  select * into r from vault_rooms where id = p_room for update;
  if not found then
    return;
  end if;
  update vault_games set gave_up = true, finished_at = now()
    where room_id = r.id and round = r.round and user_id = me and finished_at is null;
  delete from vault_room_players where room_id = r.id and user_id = me;
  select user_id into next_host from vault_room_players where room_id = r.id order by joined_at limit 1;
  if next_host is null then
    delete from vault_rooms where id = r.id;
    return;
  end if;
  update vault_rooms set host = case when host = me then next_host else host end, updated_at = now() where id = r.id;
  perform vault_room_settle(r.id);
end;
$$;

-- ---------- leaderboards ----------

-- Ranked games: finished, or left unfinished for 24 hours (not cracked).
create or replace view public.vault_ranked as
  select g.user_id, g.mode, g.length, g.day, g.cracked,
         coalesce(array_length(g.guesses, 1), 0) as n,
         case when g.cracked then g.guess_ms[array_length(g.guesses, 1)] end as ms
  from vault_games g
  where g.finished_at is not null or g.started_at < now() - interval '24 hours';
revoke all on public.vault_ranked from anon, authenticated;

-- Days in a row with the daily code cracked, up to `p_day` (or the day
-- before, if today's isn't cracked yet).
create or replace function public.vault_streak(p_user uuid, p_day date)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d date := p_day;
  n int := 0;
begin
  if not exists (select 1 from vault_games where user_id = p_user and mode = 'daily' and day = d and cracked) then
    d := d - 1;
  end if;
  while exists (select 1 from vault_games where user_id = p_user and mode = 'daily' and day = d and cracked) loop
    n := n + 1;
    d := d - 1;
    exit when n >= 3650;
  end loop;
  return n;
end;
$$;

-- One day's daily code: cracked first, then fewest guesses, then fastest.
create or replace function public.vault_daily_board(p_day date)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select g.user_id, p.name, g.cracked, coalesce(array_length(g.guesses, 1), 0) as n,
           case when g.cracked then g.guess_ms[array_length(g.guesses, 1)] end as ms,
           row_number() over (order by g.cracked desc, case when g.cracked then array_length(g.guesses, 1) end asc nulls last,
             case when g.cracked then g.guess_ms[array_length(g.guesses, 1)] end asc nulls last, g.started_at) as rank
    from vault_games g join vault_profiles p on p.user_id = g.user_id
    where g.mode = 'daily' and g.day = p_day and g.finished_at is not null
      and p.on_board and not p.hidden and p.name is not null
  )
  select json_build_object(
    'day', p_day,
    'top', coalesce((select json_agg(json_build_object(
        'rank', rank, 'name', name, 'cracked', cracked, 'guesses', n, 'ms', ms,
        'streak', vault_streak(user_id, p_day), 'me', user_id = auth.uid()) order by rank)
      from ranked where rank <= 100), '[]'::json),
    'me', (select json_build_object('rank', rank, 'name', name, 'cracked', cracked, 'guesses', n, 'ms', ms,
        'streak', vault_streak(user_id, p_day), 'me', true) from ranked where user_id = auth.uid()),
    'players', (select count(*) from ranked));
$$;

-- All-time, per code length: average guesses per cracked code ('avg') or
-- fewest guesses in one game ('best'). Games played is always shown.
create or replace function public.vault_board(p_length int, p_order text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    select r.user_id, count(*) as played, count(*) filter (where r.cracked) as cracked,
           sum(r.n) filter (where r.cracked) as guesses, min(r.n) filter (where r.cracked) as best
    from vault_ranked r
    where r.length = p_length
    group by r.user_id
  ), ranked as (
    select t.*, p.name, round(t.guesses::numeric / t.cracked, 2) as avg,
           row_number() over (order by
             case when p_order = 'best' then t.best end asc,
             t.guesses::numeric / t.cracked asc, t.played desc) as rank
    from totals t join vault_profiles p on p.user_id = t.user_id
    where t.cracked > 0 and p.on_board and not p.hidden and p.name is not null
  )
  select json_build_object(
    'top', coalesce((select json_agg(json_build_object(
        'rank', rank, 'name', name, 'played', played, 'cracked', cracked,
        'avg', avg, 'best', best, 'me', user_id = auth.uid()) order by rank)
      from ranked where rank <= 100), '[]'::json),
    'me', (select json_build_object('rank', rank, 'name', name, 'played', played, 'cracked', cracked,
        'avg', avg, 'best', best, 'me', true) from ranked where user_id = auth.uid()));
$$;

-- My daily streak today (for the home screen).
create or replace function public.vault_my_streak(p_day date)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select vault_streak(vault_me_id(), p_day);
$$;

create or replace function public.vault_report(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into vault_reports (reporter, name) values (vault_me_id(), p_name) on conflict do nothing;
  if (select count(*) from vault_reports where name = p_name) >= 3 then
    update vault_profiles set hidden = true where name = p_name;
  end if;
end;
$$;

-- ---------- who can call what ----------

do $$
declare
  f text;
begin
  -- Helpers: nobody calls these directly.
  foreach f in array array[
    'vault_name_ok(text)', 'vault_make_code(integer)', 'vault_valid_guess(text, integer)',
    'vault_score(text, text)', 'vault_me_id()', 'vault_name_of(uuid)',
    'vault_game_json(public.vault_games, boolean)', 'vault_room_names_except(uuid, uuid)',
    'vault_room_settle(uuid)', 'vault_streak(uuid, date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- Signed-in players (guests included).
  foreach f in array array[
    'vault_me()', 'vault_set_name(text)', 'vault_set_board(boolean)', 'vault_history()',
    'vault_delete_me()', 'vault_merge_token()', 'vault_merge(uuid)',
    'vault_start(text, integer, date)', 'vault_game(uuid)', 'vault_guess(uuid, text)', 'vault_give_up(uuid)',
    'vault_room_state(uuid)', 'vault_room_create(integer)', 'vault_room_join(text)',
    'vault_room_start(uuid)', 'vault_room_end(uuid)', 'vault_room_leave(uuid)',
    'vault_my_streak(date)', 'vault_report(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Anyone can look at the leaderboards.
  foreach f in array array['vault_daily_board(date)', 'vault_board(integer, text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end;
$$;

-- Tell Supabase's API to pick up the new and changed functions straight away.
notify pgrst, 'reload schema';
