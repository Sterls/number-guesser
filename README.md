# Vault

A number code-breaking game with **no ads, no tracking and no accounts**.
It's the classic "bulls and cows" game, with friendlier names.

The vault has a secret code of 4 different digits (like `0472`). After each guess
you get feedback: two numbers in labelled columns next to the guess:

- 🟢 **Right spot:** number of correct digits in the correct position
- 🟡 **Wrong spot:** number of correct digits in the wrong position

They're totals for the whole guess and never say *which* digits they mean;
working that out is the puzzle. A line under the guesses also spells the
latest result out in words (tap any earlier guess to see its result again).
They're numbers, not a dot per digit, on purpose: dots next to digits read
as "this dot is about this digit", which is not how the feedback works.

- **Daily code:** the same 4-digit code for everyone each day (one try per
  player). Share your result (one `🟢1 🟡2` line per guess).
- **Practice:** as many games as you like, with 3, 4 or 5 digits (Settings).
- **⚔️ Play a friend:** see below.
- **Notes row:** tap a digit to mark it ✕ (out), again for ✓ (in), again to clear.
- **Give up** (flag button) shows the code. It counts as a loss.
- Progress is saved on the phone. Works offline once opened.

## Playing a friend

1. Tap **⚔️ Play a friend**, choose how to play, pick 3, 4 or 5 digits and
   tap **Create room**. The room owner decides:
   - **🔒 Each sets a code:** you each set a secret code for the other to crack.
   - **🎯 Same code:** you both crack the same random code.
2. Tap **Send invite** and send the link to your friend (or tell them the
   5-letter room code to type under **Join a friend's room**).
3. When they join: in *Each sets a code* rooms you each pick a code and tap
   **Lock in**; in *Same code* rooms you start straight away.
4. You both guess at the same time. **Fewest guesses wins**; if it's
   the same number, whoever made their winning guess faster wins. Giving
   up loses. Tap **Rematch** to play again in the same room (same code
   rooms get a new code each round).

You can switch between **Your guesses** and **their guesses** at your code
while you play. Closing the app doesn't drop you: open it again and it
rejoins the room.

In *Same code* rooms you can't see your friend's guesses until the game
ends (they'd give the code away); you only see how many they've made.

**Fair play (each sets a code):** your code never leaves your phone during the game. Your phone
scores your friend's guesses and sends back only the two numbers. When you
lock in, your phone sends a fingerprint (SHA-256 hash) of your code; at the
end both codes are revealed and checked against the fingerprint and every
bit of feedback, so changing your code or giving wrong feedback shows up
as a warning.

**Same code rooms** work differently: the room owner's phone sends a random
seed and both phones turn it into the same code, so each can check its own
guesses. Neither screen shows the code until the game ends, but someone
determined could dig it out with the browser's developer tools. Fine
between friends; use *Each sets a code* if that matters.

Rooms use [Supabase](https://supabase.com) Realtime: the same free project as
Whoosh Blocks (`js/config.js`), only its live connection, no database tables,
so there's nothing to set up. Nothing is stored on the server; a room
disappears when both players leave. Room names start with `vault-` so they
never mix with Whoosh Blocks races. Clear `js/config.js` to hide the button.

To test two players without Supabase, open the game in two tabs of one
browser with `?localroom=a` and `?localroom=b` in the address (each tab gets
its own save).

## Players and stats

Add everyone who plays on the phone (tap **Playing as …** on the home
screen). Each player's finished games are stored, and the Stats screen
works these out from them, for one code length or all:

- games played, % cracked, times given up
- **average guesses per crack**, fewest guesses, average of the last 10 cracks
- average time per crack
- daily streak and best daily streak
- a chart of guesses-to-crack
- **favourite first guess**, favourite second guess, and favourite
  **first two guesses together** (e.g. `1234 → 5678 ×7`), top 3 of each
- **sharpness**: how often a guess (after the first) could still have been the
  code given the feedback so far
- record against friends (won / lost / drawn)
- recent games, and an **All players** table to compare everyone

Stats are calculated from the stored games (`js/stats.js`), so changing a
formula re-counts every past game.

## Files

- `js/game.js`: the rules (scoring, daily code, possible codes). No screen code.
- `js/stats.js`: player stats from the list of finished games.
- `js/pvp.js`: rules for playing a friend (who wins, fingerprint checks, same-code seeds).
- `js/room-net.js`: the live room connection (Supabase Realtime, or a
  BroadcastChannel with `?localroom`).
- `vendor/supabase.js`: a local copy of the Supabase library (MIT).
- `js/storage.js`: players, games and settings in `localStorage`.
- `js/main.js`: screens and controls.
- `sw.js`: offline copy and the "new version ready" bar.

## Developing

```bash
npm start   # serves the game at http://localhost:8080
npm test    # rules, stats, play-a-friend, syntax and version checks
```

After changing any file listed in `sw.js`, run `npm run stamp` so installed
copies notice the update (`npm test` fails if you forget).

## Installing on an Android phone

Open the game's link in **Chrome**, tap **⋮ → Add to Home screen** (or
**Install app**), then open it from the new icon.

## Hosting (GitHub Pages)

Plain static files, no build step. In the repository on GitHub go to
**Settings → Pages**, set **Source** to *Deploy from a branch*, choose the
branch and `/ (root)`, and save.
