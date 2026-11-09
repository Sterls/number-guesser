// Story mode: a map of levels. A winding path climbs up the screen, one
// stop per level; chapters (a new place to crack) every 10 levels. Cracked
// levels show their stars, the current level glows, the next few are locked.

import { show, register, screen } from '../app';
import { $, on, ask, toast, esc, plural } from '../ui/dom';
import { feel } from '../ui/feel';
import { celebrate } from '../ui/celebrate';
import { setController, tilesHtml } from '../ui/board';
import { api, online, ApiError } from '../net/api';
import { data, save } from '../store';
import { chapterOf, par, starText, stars, storyLength } from '../lib/story';
import type { ServerGame } from '../lib/types';
import { onStoryFinished, serverController, startPractice, withSpinner } from './play';

const ROW = 96;          // px between levels
const BANNER = 76;       // px for a chapter banner
const AHEAD = 4;         // locked levels shown above the current one

export const storyLevel = () => data.story.level;

export async function loadStory() {
  if (!online()) return;
  try {
    const m = await api.storyMap();
    data.story = { level: m.level || 1, best: Object.fromEntries(m.best.map((b) => [b.level, b.guesses])) };
    save();
  } catch {
    // Keep the cached map.
  }
}

// ---------- the map ----------

interface Stop { level: number; x: number; y: number }

function layout(width: number, top: number) {
  // Level 1 at the bottom. y grows upwards from the bottom; flipped when drawn.
  const stops: Stop[] = [];
  const banners: { level: number; y: number }[] = [];
  let y = 70;
  for (let level = 1; level <= top; level++) {
    if (chapterOf(level).first === level) { banners.push({ level, y: y + 10 }); y += BANNER; }
    const swing = Math.sin(level * 0.9) * Math.min(width * 0.3, 120);
    stops.push({ level, x: width / 2 + swing, y: y + 30 });
    y += ROW;
  }
  return { stops, banners, height: y + 40 };
}

function renderMap() {
  const current = data.story.level;
  const top = current + AHEAD;
  const scroller = $('story-scroll');
  const map = $('story-map');
  const width = Math.min(scroller.clientWidth || 360, 520);
  const { stops, banners, height } = layout(width, top);
  const flip = (y: number) => height - y;

  // The path: a smooth curve through every stop; walked part in brass.
  const pathThrough = (pts: Stop[]) => pts.map((p, i) => {
    if (!i) return `M ${p.x} ${flip(p.y)}`;
    const prev = pts[i - 1];
    const midY = (flip(prev.y) + flip(p.y)) / 2;
    return `C ${prev.x} ${midY}, ${p.x} ${midY}, ${p.x} ${flip(p.y)}`;
  }).join(' ');
  const walked = stops.filter((s) => s.level <= current);
  const ahead = stops.filter((s) => s.level >= current);

  const nodes = stops.map((s) => {
    const best = data.story.best[s.level];
    const state = s.level < current || (s.level === current && best) ? 'done' : s.level === current ? 'current' : 'locked';
    const isCurrent = s.level === current;
    const st = best ? stars(storyLength(s.level), best) : 0;
    return `<button class="stop ${state}${isCurrent ? ' here' : ''}" data-level="${s.level}" style="left:${s.x}px;top:${flip(s.y)}px"
        aria-label="Level ${s.level}${best ? `, ${st} stars` : state === 'locked' ? ', locked' : ''}">
        <span class="stop-num">${state === 'locked' ? '🔒' : s.level}</span>
        ${best ? `<span class="stop-stars">${starText(st)}</span>` : ''}
        ${isCurrent ? '<span class="stop-play">PLAY</span>' : ''}
      </button>`;
  }).join('');
  const bannerHtml = banners.map((b) => {
    const c = chapterOf(b.level);
    return `<div class="chapter-banner" style="top:${flip(b.y) - 24}px"><span>${c.emoji}</span><b>Chapter ${c.number}</b> ${esc(c.name)}</div>`;
  }).join('');

  map.style.height = `${height}px`;
  map.style.width = `${width}px`;
  map.innerHTML = `<svg class="story-path" width="${width}" height="${height}" aria-hidden="true">
      <path d="${pathThrough(ahead)}" class="path-ahead"/>
      <path d="${pathThrough(walked)}" class="path-walked"/>
    </svg>${bannerHtml}${nodes}`;
  map.querySelectorAll<HTMLElement>('.stop').forEach((b) => {
    b.onclick = () => void tapStop(Number(b.dataset.level));
  });

  // Footer: what's next.
  const c = chapterOf(current);
  $('story-next').innerHTML = `<b>Level ${current}</b> · ${c.emoji} ${esc(c.name)} · ${plural(storyLength(current), 'digit')}`;
  $('story-play').textContent = `Play level ${current}`;
  const isOnline = online();
  $('story-play').classList.toggle('dim', !isOnline);
  $('story-offline').classList.toggle('hidden', isOnline);

  // Bring the current level into view.
  const here = map.querySelector<HTMLElement>('.stop.here');
  if (here) scroller.scrollTop = here.offsetTop - scroller.clientHeight * 0.55;
}

async function tapStop(level: number) {
  const current = data.story.level;
  if (level > current) { feel.del(); return toast(`Crack level ${current} first.`); }
  if (level < current) {
    const best = data.story.best[level];
    const st = best ? stars(storyLength(level), best) : 0;
    if (st === 3) { if (!await ask(`Level ${level}: ★★★ in ${plural(best, 'guess')}. Play it again?`, { yes: 'Play again' })) return; }
    else if (!await ask(`Replay level ${level} for more stars? ${par(storyLength(level))} guesses or fewer gets ★★★.`, { yes: 'Play' })) return;
  }
  await playLevel(level);
}

export async function playLevel(level?: number, button?: HTMLElement) {
  if (!online()) return toast('Story levels need internet. Tap "Practise offline" to play a code anyway.');
  try {
    const g = await withSpinner(button, () => api.storyStart(level));
    setController(serverController(g));
    show('game');
  } catch (e) {
    toast(e instanceof ApiError && e.offline ? e.message : (e as Error).message === 'level locked' ? 'That level is still locked.' : (e as Error).message);
  }
}

register('story', () => {
  renderMap();
  void loadStory().then(() => { if (screen() === 'story') renderMap(); });
});
window.addEventListener('resize', () => { if (screen() === 'story') renderMap(); });

on('story-play', 'click', () => void playLevel(undefined, $('story-play')));
on('story-practice', 'click', () => startPractice());

// ---------- finishing a level ----------

let last: ServerGame | null = null;

onStoryFinished((g) => {
  const level = g.round ?? 1;
  const n = g.guesses.length;
  if (g.cracked) {
    const before = data.story.best[level];
    data.story.best[level] = before ? Math.min(before, n) : n;
    if (level === data.story.level) data.story.level = level + 1;
    save();
    const st = stars(g.length, n);
    void celebrate(n === 1 ? 'First try!' : 'Cracked!', `Level ${level} · ${starText(st)} · ${plural(n, 'guess')}`, g.secret || '')
      .then(() => showLevelResult(g));
  } else {
    feel.fail();
    setTimeout(() => showLevelResult(g), 300);
  }
  void loadStory();
});

function showLevelResult(g: ServerGame) {
  last = g;
  const level = g.round ?? 1;
  const n = g.guesses.length;
  const st = g.cracked ? stars(g.length, n) : 0;
  const c = chapterOf(level);
  $('result-title').textContent = g.cracked ? `Level ${level} cracked!` : `Level ${level}: locked out`;
  $('result-label').innerHTML = g.cracked ? `<span class="result-stars">${starText(st)}</span>` : `${c.emoji} ${esc(c.name)}`;
  $('result-label').classList.remove('hidden');
  $('result-code').innerHTML = tilesHtml(g.secret || '');
  $('result-text').textContent = g.cracked ? `${plural(n, 'guess')}.` : `Not cracked. Try again with a new code.`;
  const p = par(g.length);
  const nextChapter = g.cracked && chapterOf(level + 1).number !== c.number ? chapterOf(level + 1) : null;
  $('result-extra').textContent = !g.cracked ? ''
    : nextChapter ? `Chapter ${nextChapter.number} unlocked: ${nextChapter.emoji} ${nextChapter.name}!`
      : st < 3 ? `${p} guesses or fewer gets ★★★.`
        : storyLength(level + 1) > g.length ? `Next: ${storyLength(level + 1)} digits!` : '';
  $('again-btn').textContent = g.cracked ? (level + 1 === data.story.level ? `Level ${level + 1} →` : 'Next level →') : 'Try again';
  $('again-btn').classList.remove('hidden');
  $<HTMLButtonElement>('again-btn').disabled = false;
  $('share-btn').classList.add('hidden');
  $('result-stats-btn').textContent = '🗺️ Map';
  $('result-home-btn').textContent = 'Menu';
  $('result').dataset.kind = 'story';
  $('result').classList.remove('hidden');
}

const isStory = () => $('result').dataset.kind === 'story';
const closeResult = () => $('result').classList.add('hidden');
on('again-btn', 'click', () => {
  if (!isStory() || !last) return;
  closeResult();
  void playLevel(last.cracked ? undefined : last.round ?? undefined);
});
on('result-stats-btn', 'click', () => { if (isStory()) { closeResult(); show('story'); } });
on('result-home-btn', 'click', () => { if (isStory()) { closeResult(); show('home'); } });
