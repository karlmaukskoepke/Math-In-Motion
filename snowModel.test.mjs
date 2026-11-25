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

console.log(`${SEEDS} seeds checked, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
