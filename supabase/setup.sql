-- Leaderboard for Vault.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- It is safe to run again after changes. It only adds vault_* tables and
-- functions, so it sits next to Whoosh Blocks in the same project.
--
-- Each player who joins gets a random secret id on their phone. Everything
-- goes through the functions below; the public can only read nicknames and
-- stats, never the ids.
--   * One row per player per code length (3, 4 or 5 digits).
--   * Nicknames are checked against a word filter (same lists as js/names.js).
--   * Games played can only rise at a realistic pace.
--   * Three reports from different players hide a nickname. You can also hide
--     one yourself: Table Editor -> vault_scores -> tick "hidden".
--   * Players can delete their own entry; entries idle for 12 months are deleted.

create table if not exists public.vault_scores (
  secret uuid not null,
  length int not null check (length between 3 and 5),
  name text not null check (char_length(name) between 1 and 20),
  played int not null default 0 check (played >= 0),
  cracked int not null default 0 check (cracked >= 0 and cracked <= played),
  guesses bigint not null default 0 check (guesses >= cracked),  -- total guesses over cracked games
  best int check (best >= 1),                                     -- fewest guesses in one cracked game
  updated_at timestamptz not null default now(),
  hidden boolean not null default false,
  primary key (secret, length)
);

create table if not exists public.vault_reports (
  reporter uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (reporter, name)
);

-- No policies on purpose: the public cannot read or write these tables directly.
alter table public.vault_scores enable row level security;
alter table public.vault_reports enable row level security;

-- Nickname filter. Keep these lists the same as js/names.js (npm test checks).
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

-- Record a player's totals for one code length. The phone sends its full
-- totals each time (it keeps every game), so a missed submission is fixed by
-- the next one. Games played can rise by at most a few, plus one per 15
-- seconds since the last update; anything more is capped, not rejected.
create or replace function public.vault_submit(
  p_secret uuid, p_name text, p_length int,
  p_played int, p_cracked int, p_guesses bigint, p_best int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old vault_scores%rowtype;
  cap int;
  scale double precision;
begin
  if not vault_name_ok(p_name) then
    raise exception 'name not allowed' using errcode = '22023';
  end if;
  if p_length not between 3 and 5
     or p_played < 0 or p_played > 1000000
     or p_cracked < 0 or p_cracked > p_played
     or p_guesses < p_cracked or p_guesses > p_cracked::bigint * 500
     or (p_cracked > 0 and (p_best is null or p_best < 1 or p_best > p_guesses))
     or (p_cracked = 0 and p_best is not null) then
    raise exception 'stats out of range' using errcode = '22023';
  end if;

  select * into old from vault_scores where secret = p_secret and length = p_length;
  if found then
    cap := old.played + 3 + floor(extract(epoch from now() - old.updated_at) / 15)::int;
  else
    cap := 50;
  end if;

  if p_played <= cap then
    insert into vault_scores (secret, length, name, played, cracked, guesses, best)
      values (p_secret, p_length, trim(p_name), p_played, p_cracked, p_guesses, p_best)
    on conflict (secret, length) do update set
      name = excluded.name, played = excluded.played, cracked = excluded.cracked,
      guesses = excluded.guesses, best = excluded.best, updated_at = now();
  elsif found then
    -- Too many new games at once: keep the old totals but take the new name.
    update vault_scores set name = trim(p_name) where secret = p_secret and length = p_length;
  else
    -- A first submission with lots of games: scale it down to the cap, keeping the average.
    scale := cap::double precision / p_played;
    insert into vault_scores (secret, length, name, played, cracked, guesses, best)
      values (p_secret, p_length, trim(p_name), cap,
              greatest(floor(p_cracked * scale)::int, least(p_cracked, 1)),
              greatest(round(p_guesses * scale)::bigint, greatest(floor(p_cracked * scale)::int, least(p_cracked, 1))),
              p_best);
  end if;

  -- The same nickname on every length.
  update vault_scores set name = trim(p_name) where secret = p_secret;
  delete from vault_scores where updated_at < now() - interval '12 months';
end;
$$;

-- The board for one code length, ranked by average guesses ('avg') or by
-- fewest guesses in one game ('best'). Only players who've cracked at least
-- one code. Never includes ids; `me` is this player's own row and rank, even
-- outside the top 100.
create or replace function public.vault_board(p_length int, p_order text, p_secret uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select secret, name, played, cracked, best,
           round(guesses::numeric / cracked, 2) as avg,
           row_number() over (order by
             case when p_order = 'best' then best end asc,
             guesses::numeric / cracked asc,
             played desc,
             updated_at asc) as rank
    from vault_scores
    where length = p_length and cracked > 0 and not hidden
  )
  select json_build_object(
    'top', coalesce((
      select json_agg(json_build_object(
        'rank', rank, 'name', name, 'played', played, 'cracked', cracked,
        'avg', avg, 'best', best, 'me', secret = p_secret) order by rank)
      from ranked where rank <= 100), '[]'::json),
    'me', (
      select json_build_object('rank', rank, 'name', name, 'played', played, 'cracked', cracked, 'avg', avg, 'best', best, 'me', true)
      from ranked where secret = p_secret));
$$;

create or replace function public.vault_report(p_reporter uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into vault_reports (reporter, name) values (p_reporter, p_name) on conflict do nothing;
  if (select count(*) from vault_reports where name = p_name) >= 3 then
    update vault_scores set hidden = true where name = p_name;
  end if;
end;
$$;

create or replace function public.vault_delete(p_secret uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from vault_scores where secret = p_secret;
$$;

revoke all on function public.vault_submit(uuid, text, int, int, int, bigint, int) from public;
revoke all on function public.vault_board(int, text, uuid) from public;
revoke all on function public.vault_report(uuid, text) from public;
revoke all on function public.vault_delete(uuid) from public;
grant execute on function public.vault_submit(uuid, text, int, int, int, bigint, int) to anon;
grant execute on function public.vault_board(int, text, uuid) to anon;
grant execute on function public.vault_report(uuid, text) to anon;
grant execute on function public.vault_delete(uuid) to anon;
