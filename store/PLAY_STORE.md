# Getting Vault onto Google Play

Everything needed for the Play Store: the steps, the listing text and the
answers to Google's forms. Images are in this folder:

| File | Where it goes in Play Console |
|---|---|
| `app-icon-512.png` (512×512) | Store listing → App icon |
| `feature-graphic.png` (1024×500) | Store listing → Feature graphic |
| `screenshot-1.png` … `screenshot-6.png` (1080×1920) | Store listing → Phone screenshots |

Screenshots, in order: cracking the daily code · a game in progress ·
today's leaderboard · a room lobby · a room round with the players list ·
the home screen with a streak.

Game address: **https://sterls.github.io/number-guesser/**
Privacy policy: **https://sterls.github.io/number-guesser/privacy.html**

The app is the website in an Android wrapper (a Trusted Web Activity), so
every push to `main` reaches app users straight away; a new app build is only
needed to change the icon, name or colours.

---

## Step 1. Developer account (you)

Use the same Play Console account as Whoosh Blocks (no new fee). If you don't
have one yet: <https://play.google.com/console>, **Personal** account, US$25,
identity and device verification (can take a few days).

## Step 2. Build the Android app with PWABuilder (you, about 10 minutes)

1. Open <https://www.pwabuilder.com>, paste `https://sterls.github.io/number-guesser/`
   and press **Start**.
2. **Package for stores** → **Android** → **Generate package**, then open
   **All settings**:

   | Setting | Value |
   |---|---|
   | Package ID | `io.github.sterls.vault` (permanent, can never change) |
   | App name | `Vault: Crack the Code` |
   | Launcher name | `Vault` |
   | App version / version code | `1.0.0` / `1` |
   | Display mode | `Standalone` |
   | Status bar colour / Navigation bar colour / Splash colour | `#0E131D` |
   | Signing key | **Create new** |

3. Download the zip. It contains:
   - `*.aab`: the app to upload to Play,
   - `signing.keystore` and `signing-key-info.txt`: **your signing key and passwords**,
   - `assetlinks.json`: needed for step 5.
4. **Back up the whole zip somewhere private** (password manager, private
   cloud storage). You need the key for every future update. **Never put it in
   this repo**: the repo is public.

## Step 3. Create the app in Play Console (you)

1. **Create app**: name `Vault: Crack the Code`, language English (United
   Kingdom), **Game**, **Free**. Accept the declarations.
2. Keep **Play App Signing** on (the default), so a lost upload key can be reset.
3. Fill in the store listing and the App content forms with the text below.

## Step 4. Closed test, 14 days (you plus 12 testers)

New personal developer accounts must run a closed test for **each** app
before it can go public:

1. **Test and release → Testing → Closed testing → Create track.**
2. Upload the `.aab` from step 2 and roll out the release.
3. Add **at least 12 testers** (Google accounts with Android phones) and send
   them the opt-in link. They must stay opted in for **14 days in a row**.
4. Then apply for **production access**; after Google's review, publish.

While testing, check in particular: **Sign in with Google** (Settings →
Account) comes back into the app signed in, **Send invite** in a room opens
the share sheet, and the invite link opens the app.

## Step 5. Full screen inside the app (you + me)

Android only hides the browser bar if the website confirms it owns the app,
with `https://sterls.github.io/.well-known/assetlinks.json`. That file lives
in your `Sterls/Sterls.github.io` repo and can list several apps, so Vault
goes next to Whoosh Blocks.

Send me the two SHA-256 fingerprints (safe to share) and I'll add them:
- **upload key**: from `signing-key-info.txt` or PWABuilder's `assetlinks.json`,
- **app signing key**: Play Console → **Test and release → App integrity →
  App signing** → "SHA-256 certificate fingerprint".

Until then testers see a thin address bar at the top; everything else works.

## Step 6. Google sign-in screen (you, optional)

Google's consent screen says "continue to wsgugxneqffhidqsduzg.supabase.co"
until the app's branding is verified. Optional, but it looks more
trustworthy: Google Auth Platform → **Branding** → add the app name, logo
(`app-icon-512.png`), home page and privacy policy links above, and submit for
verification.

---

## Store listing text

**App name** (30 max)

```
Vault: Crack the Code
```

**Short description** (80 max)

```
Crack the secret number code. A daily puzzle, leaderboards and friend lobbies.
```

**Full description** (4,000 max)

```
Can you crack the vault?

There's a secret code of 4 different digits. Make a guess and the vault
tells you how close you are:

🟢 Right spot: how many digits are correct and in the correct position
🟡 Wrong spot: how many digits are in the code but in another position

It never says which digits. Use the clues, rule digits in and out, and
crack the code in as few guesses as you can. When it opens, you'll know.

★ DAILY CODE: everyone gets the same code each day. Compare guesses with
  players everywhere and keep your 🔥 streak alive
★ LEADERBOARDS: today's code (fewest guesses, then fastest) and all-time
  rankings by average and best, with games played shown
★ PLAY FRIENDS: create a room, send the invite, and up to 8 players race
  to crack the same code. Fewest guesses wins
★ STORY MODE: climb the map from a 1-digit piggy bank to the Federal
  Reserve. Earn up to 3 stars a level, with a new chapter every 10 levels
★ STATS: average guesses, favourite openings, streaks, how sharp your
  guesses are, and your record against friends
★ Notes to mark digits in or out as you go
★ Fair play: every ranked game is checked by the server, so the
  leaderboards are real
★ Satisfying clicks, clunks and the sound of the vault opening
★ No ads, no tracking. Sign in with Google is optional

A classic code-breaking logic game, rebuilt for a quick daily puzzle or a
noisy round with friends.
```

**Category:** Game → Puzzle
**Tags:** Puzzle, Logic, Brain games, Word & number, Multiplayer, Casual (pick what Play offers)
**Contact email** (required, shown publicly): the game's Gmail
**Website:** `https://sterls.github.io/number-guesser/`
**Privacy policy:** `https://sterls.github.io/number-guesser/privacy.html`

Before choosing the name, search Play for "Vault": there are many apps with
that word (mostly photo lockers). "Vault: Crack the Code" keeps it distinct.
Never use other games' names as keywords.

---

## Form answers (App content section)

| Form | Answer |
|---|---|
| Privacy policy | `https://sterls.github.io/number-guesser/privacy.html` |
| App access | **All functionality is available without special access** (a guest account is made automatically; Google sign-in is optional) |
| Ads | **No**, the app does not contain ads |
| Content rating (IARC) | Category **Game**. Violence, sexual content, language, drugs, gambling: **No**. "Users can interact or exchange content": **Yes** (players see each other's chosen names on leaderboards and in rooms; names pass a word filter, can be reported and are hidden after reports). "Shares user location": No. "Digital purchases": No. Expected: PEGI 3 / Everyone (may show "Users interact"). |
| Target audience | **13–15, 16–17, 18+** (not under 13). "Could the app appeal to children?" **No** |
| News app | No |
| COVID-19 apps | No |
| Data safety | See below |
| Government app | No |
| Financial features | None |
| Health | None |
| Sensitive permissions | None (the app asks for no Android permissions) |

### Account creation and deletion

These come up in the Data safety section and under **App content → Data deletion**.

| Question | Answer |
|---|---|
| Methods of account creation | **OAuth** only (Sign in with Google). The automatic guest account isn't created by the player and has no username or login, so it isn't listed. |
| Delete account URL | `https://sterls.github.io/number-guesser/delete-account.html` |
| Can users delete their account in the app? | Yes: Settings → Account → **Delete my account** (deletes the account, its Google link, games, stats and leaderboard entries) |
| Can users request deletion of some data without deleting the account? | Yes: they can hide themselves from the leaderboard, and ask by email for anything else |

### Data safety

**Does your app collect or share any of the required user data types?** Yes.
**Is all of the user data collected by your app encrypted in transit?** Yes.
**Do you provide a way for users to request that their data is deleted?** Yes
(Settings → Account → Delete my account, or the page at
`https://sterls.github.io/number-guesser/delete-account.html`).

Nothing is **shared** with third parties (Supabase and Google process data on
our behalf, which Play doesn't count as sharing).

| Data type | Collected | Required? | Purposes |
|---|---|---|---|
| Personal info → **Name** (the player name chosen in the game) | Yes | Required | App functionality |
| Personal info → **Email address** (only with Google sign-in) | Yes | Optional | Account management |
| Personal info → **User IDs** (the account ID) | Yes | Required | App functionality, Account management |
| App activity → **Other actions** (games played: guesses, times, results) | Yes | Required | App functionality |

Not collected: location, contacts, photos, files, device IDs, financial or
health information, messages, browsing history, crash logs or diagnostics.

If anything about what's collected changes in the game, update this form
and `public/privacy.html` together.
