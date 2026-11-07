# Vault

A number code-breaking game with **no ads, no tracking and no accounts**.
It's the classic "bulls and cows" game, with friendlier names.

The vault has a secret code of 4 different digits (like `0472`). After each guess
you get pegs:

- 🟢 **Green:** right digit, **right spot**
- 🟡 **Yellow:** right digit, **wrong spot**

The pegs are counts only. They never say *which* digits they mean; working
that out is the puzzle.

- **Daily code:** the same 4-digit code for everyone each day (one try per
  player). Share your result as a grid of 🟢🟡⚪.
- **Practice:** as many games as you like, with 3, 4 or 5 digits (Settings).
- **Notes row:** tap a digit to mark it ✕ (out), again for ✓ (in), again to clear.
- **Give up** (flag button) shows the code. It counts as a loss.
- Progress is saved on the phone. Works offline once opened.

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
  code given the pegs so far
- recent games, and an **All players** table to compare everyone

Stats are calculated from the stored games (`js/stats.js`), so changing a
formula re-counts every past game.

## Files

- `js/game.js`: the rules (scoring, daily code, possible codes). No screen code.
- `js/stats.js`: player stats from the list of finished games.
- `js/storage.js`: players, games and settings in `localStorage`.
- `js/main.js`: screens and controls.
- `sw.js`: offline copy and the "new version ready" bar.

## Developing

```bash
npm start   # serves the game at http://localhost:8080
npm test    # rules, stats, syntax and version checks
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
