# Vault

A number code-breaking game with **no ads and no tracking**.
It's the classic "bulls and cows" game, with friendlier names.

The vault has a secret code of 4 different digits (like `0472`). After each
guess you get feedback: two numbers in labelled columns next to the guess:

- 🟢 **Right spot:** number of correct digits in the correct position
- 🟡 **Wrong spot:** number of correct digits in the wrong position

They're totals for the whole guess and never say *which* digits they mean;
working that out is the puzzle.

## Modes

- **Daily code:** the same 4-digit code for everyone each day, one try. This
  is the main ranked mode: everyone had the same code, so it's the fairest
  comparison. Crack it every day for a 🔥 streak.
- **🗺️ Story:** levels on a map. Level 1 is a 1-digit code, levels 2–3 two
  digits, levels 4–6 three, then 4 digits from level 7 on, with no end. Each
  level earns 1–3 ⭐ (3 for cracking it within par: 3, 5, 6 and 7 guesses for
  1–4 digits); replay earlier levels for more. Every 10 levels is a new
  chapter (🐷 Piggy Bank, 🎒 School Locker, … 🏛️ Federal Reserve). Progress is
  kept with your account. Offline, Story offers a practice code that isn't
  saved.
- **⚔️ Play friends:** lobbies of up to 8 players. Create a room (pick 3, 4
  or 5 digits), send the invite link, and the host starts a round when
  everyone's in. Everyone cracks the same random code, made by the server.
  Players are ranked by fewest guesses, then by who cracked it sooner after
  the start; giving up or leaving puts you below everyone who cracked it.
  Other players' guesses stay hidden until the round ends (only their guess
  counts show), so nobody can copy. The round ends when everyone has
  finished, or when the host ends it; then the host starts the next one.
  Players who join mid-round play from the next round. If the host leaves,
  the room closes for everyone (the round so far still counts). Anyone
  whose app hasn't checked in for 10 minutes (closed the app, lost signal)
  is taken out as if they'd left, so a host who just closes the app closes
  the room too. The host can remove a player (✕ next to
  their name, or ⚙️ → Remove a player), say someone who closed the app
  without leaving; their round counts as given up, and they can rejoin with
  the code.
- **🏆 Leaderboard:** **Today's code** (fewest guesses, then fastest, with
  streaks) and **All time** per code length (average guesses or fewest
  guesses, always showing games played). Joining is optional.
- **📊 Stats:** average guesses, favourite openings, guess distribution,
  sharpness, streaks, record against friends.

## Fair play: the server checks every game

Codes are made and kept on the server (Supabase, Postgres functions in
[`supabase/setup.sql`](supabase/setup.sql)). The phone sends a guess and
gets back only the two numbers; a code is only sent once its game is over.
So a ranked result can't be faked by editing the page, the leaderboard only
counts server-checked games, and a game left unfinished for 24 hours counts
as not cracked (quitting a bad game doesn't help). The remaining way to cheat
is a solver program making the guesses.

## Accounts

One account per phone. The first time the game opens it makes a **guest
account** automatically, so there's nothing to sign up for. **Sign in with
Google** (Account screen) keeps the same games and stats and lets you carry
on on another phone. If that Google account already plays Vault, the phone
switches to it and brings its guest games along.

## Setup (once)

Everything uses the free Supabase project shared with Whoosh Blocks. Vault
only adds `vault_*` tables and functions, so Whoosh Blocks isn't affected.

1. **Database:** Supabase → **SQL Editor → New query**, paste the whole of
   [`supabase/setup.sql`](supabase/setup.sql), **Run**. Safe to run again
   after updates. (This version replaces the first leaderboard's tables,
   which only held test data.)
2. **Guest accounts:** Supabase → **Authentication → Sign In / Providers**
   → turn on **Allow anonymous sign-ins**.
3. **Google sign-in:**
   1. In [Google Cloud Console](https://console.cloud.google.com/) →
      **APIs & Services → Credentials → Create credentials → OAuth client ID**,
      type **Web application**. (If asked, set up the consent screen first:
      External, app name "Vault", your email.)
   2. Under **Authorized redirect URIs** add
      `https://wsgugxneqffhidqsduzg.supabase.co/auth/v1/callback`.
   3. Copy the **Client ID** and **Client secret** into Supabase →
      **Authentication → Sign In / Providers → Google**, and enable it.
   4. Supabase → **Authentication → Sign In / Providers**: turn on
      **Allow manual linking** (so a guest can become a Google account
      without losing games).
   5. Supabase → **Authentication → URL Configuration**: add
      `https://sterls.github.io/number-guesser/` to **Redirect URLs**
      (and `http://localhost:5173/` for testing).
4. **Publishing:** GitHub repo → **Settings → Pages → Source: GitHub
   Actions**. Every push to `main` then tests, builds and publishes the game
   to `https://sterls.github.io/number-guesser/` (see
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

Until steps 1–2 are done the game still works offline (single player, not
ranked). Until step 3 is done, everything works except the Google button.

## Developing

TypeScript, built with Vite. Needs Node 22.

```bash
npm install
npm run dev      # the game at http://localhost:5173, against the real Supabase project
npm test         # type check + unit tests (rules, stats, name filter)
npm run build    # production build in dist/
```

Server tests run `supabase/setup.sql` against a local Postgres with a small
stand-in for Supabase's auth (never point them at a real database: they
wipe it):

```bash
PGHOST=/tmp/vaultpg PGPORT=5499 PGUSER=postgres npm run test:sql
```

`scripts/fake-supabase.mjs` serves guest sign-in and the `vault_*` functions
from that local Postgres, for testing the whole game without Supabase: build
with `VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_KEY=test`.

### Files

- `src/main.ts`: start-up. `src/app.ts`: which screen is showing.
- `src/screens/`: one file per screen (`home`, `play` for daily and single
  player, `room` for playing friends, `board`, `stats`, `account`, `settings`).
- `src/ui/board.ts`: the game screen (guesses, keypad, notes) shared by every
  mode. `src/ui/feel.ts`: sounds (made with Web Audio) and vibration.
- `src/lib/`: rules, stats and the name filter, with no screen code.
- `src/net/`: Supabase: accounts (`supabase.ts`), server calls (`api.ts`),
  the live room line (`live.ts`).
- `src/store.ts`: what the phone keeps (settings, offline games, a copy of
  your history). Games from the version before accounts are kept here as
  unranked history.
- `supabase/setup.sql`: tables and functions; `scripts/test-sql.mjs` tests it.
- `src/sw-template.js`: offline support; the build fills in the file list.
- `public/privacy.html`: privacy policy. `public/delete-account.html`: how to
  delete your account (linked from the Play listing).

## Installing on a phone

Open the game's link in Chrome (Android) or Safari (iPhone), then **Add to
Home screen** / **Install app**. It runs full screen and works offline.
