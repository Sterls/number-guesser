// Your stats, from every game this account has played (ranked, from the
// server) plus this phone's offline games.

import { register } from '../app';
import { $, esc, formatTime } from '../ui/dom';
import { tilesHtml } from '../ui/board';
import { dailyNumber, todayKey } from '../lib/game';
import { computeStats } from '../lib/stats';
import { allGames, account, refreshHistory } from '../account';
import { DAILY_LENGTH } from '../lib/game';

let statsLength: number | null = DAILY_LENGTH;
export const setStatsLength = (len: number | null) => { statsLength = len; };

const fmt = (x: number | null, digits = 1) => (x == null ? '–' : x.toFixed(digits));
const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);

function renderStats() {
  const games = allGames();
  // Only offer code lengths this player has actually played.
  const played = [...new Set(games.map((g) => g.length))].sort((a, b) => a - b);
  if (statsLength != null && !played.includes(statsLength)) statsLength = null;
  const chips = $('stats-length');
  chips.innerHTML = '';
  chips.classList.toggle('hidden', played.length < 2);
  for (const len of [null, ...played]) {
    const b = document.createElement('button');
    b.className = `chip${len === statsLength ? ' on' : ''}`;
    b.textContent = len == null ? 'All' : `${len} digit${len === 1 ? '' : 's'}`;
    b.onclick = () => { statsLength = len; renderStats(); };
    chips.appendChild(b);
  }

  const s = computeStats(games, { length: statsLength, today: todayKey() });
  const streak = account.streak || s.streak.current;
  const body = $('stats-body');
  if (!s.played) {
    body.innerHTML = `<p class="empty">No ${statsLength ? `${statsLength}-digit ` : ''}games yet.</p>`;
    return;
  }
  const maxBar = Math.max(1, ...s.distribution.map((d) => d.count));
  const top = (list: { value: string; count: number }[], n = 3) => (list.length
    ? `<ol class="top">${list.slice(0, n).map((x) => `<li><b class="mono">${esc(x.value)}</b> <span>×${x.count}</span></li>`).join('')}</ol>`
    : '<p class="fine">Not enough games yet.</p>');
  const recent = games.filter((g) => statsLength == null || g.length === statsLength).sort((a, b) => b.at - a.at).slice(0, 6);
  const label = (g: typeof recent[number]) => (g.mode === 'daily' ? `Daily #${dailyNumber(g.date)}`
    : g.mode === 'room' ? `vs ${esc(g.opponent || 'friend')}${g.result ? ` · ${{ win: 'won', lose: 'lost', draw: 'draw' }[g.result]}` : ''}`
      : g.mode === 'story' ? `Story · level ${g.level ?? '?'}` : g.mode === 'offline' ? `Practice · ${g.length}` : `Single player · ${g.length}`);
  const v = s.versus;
  body.innerHTML = `
    <div class="tiles-grid">
      <div class="stat"><b>${s.played}</b><small>played</small></div>
      <div class="stat"><b>${pct(s.winRate)}</b><small>cracked</small></div>
      <div class="stat"><b>${fmt(s.avgGuesses)}</b><small>avg guesses per crack</small></div>
      <div class="stat"><b>${s.best ?? '–'}</b><small>fewest guesses</small></div>
      <div class="stat"><b>${s.avgSeconds == null ? '–' : formatTime(s.avgSeconds * 1000)}</b><small>avg time</small></div>
      <div class="stat"><b>${streak}<span class="sub">/${Math.max(s.streak.best, streak)}</span></b><small>🔥 daily streak / best</small></div>
    </div>
    <p class="fine center">Last 10 cracks: avg ${fmt(s.recentAvg)} guesses · Not cracked: ${s.gaveUp}</p>
    ${v.win + v.lose + v.draw ? `<p class="fine center">⚔️ Against friends: <b>${v.win}</b> won · <b>${v.lose}</b> lost${v.draw ? ` · <b>${v.draw}</b> drawn` : ''}</p>` : ''}

    <h3>Guesses to crack</h3>
    <div class="dist">${s.distribution.map((d) => `
      <span class="dist-label">${d.label}</span>
      <span class="dist-bar">${d.count ? `<i style="width:${Math.max(8, (d.count / maxBar) * 100)}%">${d.count}</i>` : ''}</span>`).join('')}
    </div>

    <h3>Favourite openings</h3>
    <div class="card openers">
      <div><h4>First guess</h4>${top(s.firsts)}</div>
      <div><h4>Second guess</h4>${top(s.seconds)}</div>
      <div class="wide"><h4>First two guesses together</h4>${top(s.firstTwo)}</div>
    </div>

    <h3>Sharpness <span class="score">${pct(s.sharpness)}</span></h3>
    <p class="fine">How often a guess (after the first) could still have been the code, given the feedback so far. Higher means no wasted guesses.</p>

    <h3>Recent games</h3>
    <ul class="recent">${recent.map((g) => `
      <li><span>${label(g)}</span>
      <span class="tiles small">${tilesHtml(g.secret || '?'.repeat(g.length))}</span>
      <b>${g.won ? `${g.guesses.length} guesses` : 'not cracked'}</b></li>`).join('')}
    </ul>
    ${games.some((g) => !g.ranked) ? '<p class="fine center">Includes offline games, which don\'t count on the leaderboard.</p>' : ''}`;
}

register('stats', () => {
  renderStats();
  void refreshHistory().then(() => { if (!$('stats').classList.contains('hidden')) renderStats(); });
});
