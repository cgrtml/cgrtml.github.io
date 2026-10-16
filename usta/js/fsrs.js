// FSRS-4.5 (Free Spaced Repetition Scheduler), gün çözünürlüğünde.
// Varsayılan ağırlıklar: open-spaced-repetition/fsrs4anki v4.5.
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367,
  1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5;
const FACTOR = 19 / 81;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const initS = (g) => W[g - 1];
const initD = (g) => clamp(W[4] - (g - 3) * W[5], 1, 10);

export function retrievability(elapsedDays, s) {
  return Math.pow(1 + FACTOR * elapsedDays / s, DECAY);
}

function intervalFor(s, retention, maxIv) {
  const iv = (s / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(iv), 1, maxIv);
}

function nextD(d, g) {
  const nd = d - W[6] * (g - 3);
  return clamp(W[7] * initD(4) + (1 - W[7]) * nd, 1, 10);
}

function recallS(d, s, r, g) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
}

function forgetS(d, s, r) {
  return Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
}

export const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);

// card: undefined (yeni) ya da {s,d,due,last,reps,lapses,state}
// g: 1 Again, 2 Hard, 3 Good, 4 Easy. today: 'YYYY-MM-DD'
export function schedule(card, g, today, params = {}) {
  const retention = params.retention || 0.92;
  const maxIv = params.max_interval || 180;
  if (!card || card.state === 'new') {
    const s = initS(g), d = initD(g);
    const due = g === 1 ? today : addDays(today, g === 2 ? 1 : intervalFor(s, retention, maxIv));
    return { s, d, due, last: today, reps: 1, lapses: 0, state: g === 1 ? 'learning' : 'review' };
  }
  const elapsed = Math.max(0, daysBetween(card.last, today));
  const r = retrievability(elapsed, card.s);
  const d = nextD(card.d, g);
  if (g === 1) {
    const s = forgetS(card.d, card.s, r);
    return { s, d, due: today, last: today, reps: card.reps + 1, lapses: card.lapses + 1, state: 'relearning' };
  }
  let s = recallS(card.d, card.s, r, g);
  let iv = intervalFor(s, retention, maxIv);
  if (card.state === 'learning' || card.state === 'relearning') iv = Math.min(iv, g === 2 ? 1 : g === 3 ? 2 : 4);
  return { s, d, due: addDays(today, iv), last: today, reps: card.reps + 1, lapses: card.lapses, state: 'review' };
}

export function previewIntervals(card, today, params) {
  return [1, 2, 3, 4].map((g) => {
    const n = schedule(card, g, today, params);
    return n.due === today ? 'bugün' : `${daysBetween(today, n.due)}g`;
  });
}
