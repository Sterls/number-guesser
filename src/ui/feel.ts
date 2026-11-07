// Sound and vibration: mechanical clicks for the dial, a clunk for a guess,
// ticks for the feedback and a chime when the vault opens. All made on the
// fly with Web Audio (no sound files). Vibration only works on Android;
// iPhones don't allow it from a web page.

import { settings } from '../store';

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (!settings().sound) return null;
  try {
    ctx ||= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// A short filtered noise burst: the sound of metal parts meeting.
function click(at: number, { freq = 2400, q = 8, gain = 0.25, length = 0.035 } = {}) {
  const a = audio();
  if (!a) return;
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(a.currentTime + at);
}

function tone(at: number, freq: number, { length = 0.25, gain = 0.12, type = 'sine' as OscillatorType } = {}) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = a.createGain();
  const t = a.currentTime + at;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + length + 0.02);
}

function buzz(pattern: number | number[]) {
  if (settings().vibrate) navigator.vibrate?.(pattern);
}

export const feel = {
  key() { click(0, { freq: 3200, gain: 0.18, length: 0.02 }); buzz(8); },
  del() { click(0, { freq: 1600, gain: 0.15, length: 0.025 }); buzz(6); },
  note() { click(0, { freq: 4200, gain: 0.08, length: 0.015 }); },
  // A guess: the handle turns (clunk), then one tick per digit found:
  // a bright one for each right spot, a duller one for each wrong spot.
  guess(exact: number, close: number) {
    click(0, { freq: 300, q: 2, gain: 0.5, length: 0.09 });
    let t = 0.16;
    for (let i = 0; i < exact; i++, t += 0.09) click(t, { freq: 3600, gain: 0.3 });
    for (let i = 0; i < close; i++, t += 0.09) click(t, { freq: 1300, gain: 0.25 });
    buzz(exact + close ? [20, 60, ...Array(exact + close).fill(12).flatMap((x) => [x, 50])] : 20);
  },
  open() {
    click(0, { freq: 250, q: 1.5, gain: 0.6, length: 0.15 });
    [523, 659, 784, 1047].forEach((f, i) => tone(0.2 + i * 0.09, f, { length: 0.5, gain: 0.1, type: 'triangle' }));
    buzz([30, 60, 30, 60, 120]);
  },
  fail() {
    tone(0, 220, { length: 0.35, gain: 0.1, type: 'sawtooth' });
    tone(0.12, 165, { length: 0.45, gain: 0.08, type: 'sawtooth' });
    buzz([60, 40, 60]);
  },
  pop() { click(0, { freq: 2000, gain: 0.12, length: 0.03 }); },
};
