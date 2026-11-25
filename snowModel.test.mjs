// Generator/distractor correctness checks for Snow Challenge — spec
// section 6. Run with: node snowModel.test.mjs
// Not loaded by the site; a standalone dev check, kept in the repo so it
// can be re-run after any change to snowModel.js.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SnowModel = require('./snowModel.js');

const SEEDS = 5000;
let failures = 0;
let matchItemsBuilt = 0;
function fail(msg) { failures++; console.error('FAIL: ' + msg); }

for (let seed = 1; seed <= SEEDS; seed++) {
  const rng = SnowModel.makeRng(seed);
  let forecast;
  try {
    forecast = SnowModel.generateForecast(rng);
  } catch (e) {
    fail(`seed ${seed}: generateForecast threw — ${e.message}`);
    continue;
  }

  // Every corner lands on whole numbers (hours and inches).
  const points = SnowModel.forecastPoints(forecast);
  for (const p of points) {
    if (!Number.isInteger(p.t)) fail(`seed ${seed}: non-integer hour at corner (t=${p.t})`);
    if (!Number.isInteger(p.d)) fail(`seed ${seed}: non-integer depth at corner (d=${p.d})`);
  }

  // Depth stays within 0..12 at every corner.
  for (const p of points) {
    if (p.d < 0 || p.d > 12) fail(`seed ${seed}: depth ${p.d} out of [0,12] at t=${p.t}`);
  }

  // No melt segment reaches exactly 0 (generator-level rule — Explorer's
  // own flatten-at-zero behavior is a separate, UI-level safety net).
  let runningDepth = forecast.start;
  for (const seg of forecast.segments) {
    runningDepth += SnowModel.segmentDelta(seg);
    if (seg.weather === 'sun' && runningDepth <= 0) {
      fail(`seed ${seed}: a melt segment reached depth ${runningDepth} (should stay > 0)`);
    }
  }

  // Total time 12 hours or less.
  const total = SnowModel.forecastTotalHours(forecast);
  if (total > 12) fail(`seed ${seed}: total hours ${total} exceeds 12`);

  // Match the Forecast: 4 distinct graphs, exactly one correct, each
  // distractor differs from the correct graph in exactly one rule.
  const item = SnowModel.buildMatchItem(rng, forecast, 3);
  if (!item) continue; // some forecasts legitimately can't support 3 distinct distractors (e.g. 1-segment, no cloudy) — generator tries another seed in practice; not a failure of the rules themselves
  if (item.choices.length !== 4) fail(`seed ${seed}: expected 4 choices, got ${item.choices.length}`);
  const correctCount = item.choices.filter(c => c.isCorrect).length;
  if (correctCount !== 1) fail(`seed ${seed}: expected exactly 1 correct choice, got ${correctCount}`);
  const keys = item.choices.map(c => SnowModel.pointsKey(c.points));
  if (new Set(keys).size !== keys.length) fail(`seed ${seed}: two choices produced identical graphs`);
  for (const c of item.choices) {
    if (c.isCorrect) continue;
    if (!c.rule) fail(`seed ${seed}: a distractor has no rule tag`);
    // Wrong answers must look like real forecasts — no off-grid corners,
    // negative/over-12 depth, or past-12h graphs that give themselves away.
    for (const p of c.points) {
      if (!Number.isInteger(p.t) || !Number.isInteger(p.d)) fail(`seed ${seed}: ${c.rule} distractor has off-grid corner (${p.t}, ${p.d})`);
      if (p.d < 0 || p.d > 12) fail(`seed ${seed}: ${c.rule} distractor depth ${p.d} out of [0,12]`);
    }
    const end = c.points[c.points.length - 1].t;
    if (end > 12) fail(`seed ${seed}: ${c.rule} distractor runs to hour ${end}`);
  }
  matchItemsBuilt++;
}

// Story text: correct plurals and a capital letter starting each sentence.
for (let seed = 1; seed <= 500; seed++) {
  const story = SnowModel.forecastStory(SnowModel.generateForecast(SnowModel.makeRng(seed)));
  if (/\binchs\b|\bevery 1 hour\b/.test(story)) fail(`seed ${seed}: bad plural in story — "${story}"`);
  for (const sentence of story.split(/(?<=\.)\s+/)) {
    if (!/^[A-Z]/.test(sentence)) fail(`seed ${seed}: sentence not capitalized — "${sentence}"`);
  }
}

// The page retries up to 20 forecasts per round; make sure that's plenty.
const buildRate = matchItemsBuilt / SEEDS;
if (buildRate < 0.4) fail(`only ${(buildRate * 100).toFixed(0)}% of forecasts produced a Match item — rounds may fail to build`);
console.log(`Match items built for ${(buildRate * 100).toFixed(0)}% of forecasts.`);

// Every level can actually produce rounds with its number of pieces.
for (let level = 1; level <= SnowModel.MAX_LEVEL; level++) {
  let built = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const rng = SnowModel.makeRng(seed * 7 + level);
    const f = SnowModel.generateForecast(rng, { numSegments: level });
    if (f.segments.length !== level) fail(`level ${level}: forecast has ${f.segments.length} pieces`);
    if (SnowModel.buildMatchItem(rng, f, 3)) built++;
  }
  if (built < 500) fail(`level ${level}: only ${built}/1000 forecasts produced a round`);
  console.log(`Level ${level}: ${(built / 10).toFixed(0)}% of forecasts produce a round.`);
}

// Level-up rules, against an in-memory stand-in for localStorage.
{
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
  } });
  const S = SnowModel;
  const lvl = () => S.getScoreState().level;
  if (lvl() !== 1) fail('levels: should start at level 1');
  S.recordAttempt(true); S.recordAttempt(true);
  S.recordAttempt(false); // resets progress, keeps level
  if (lvl() !== 1) fail('levels: a wrong pick should not change the level');
  S.recordAttempt(true); S.recordAttempt(true);
  if (lvl() !== 1) fail('levels: progress should have reset after the wrong pick');
  const r = S.recordAttempt(true);
  if (lvl() !== 2 || !r.leveledUp) fail('levels: 3 first-try corrects in a row should reach level 2');
  S.recordAttempt(false);
  if (lvl() !== 2) fail('levels: a wrong pick should never drop a level');
  for (let i = 0; i < 20; i++) S.recordAttempt(true);
  if (lvl() !== S.MAX_LEVEL) fail(`levels: should cap at level ${S.MAX_LEVEL}, got ${lvl()}`);
  S.resetProgress();
  if (lvl() !== 1 || S.getScoreState().score !== 0) fail('levels: resetProgress should clear everything');
}

console.log(`${SEEDS} seeds checked, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
