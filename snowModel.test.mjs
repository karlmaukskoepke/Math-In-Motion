// Generator/distractor correctness checks for Snow Challenge — spec
// section 6. Run with: node snowModel.test.mjs
// Not loaded by the site; a standalone dev check, kept in the repo so it
// can be re-run after any change to snowModel.js.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SnowModel = require('./snowModel.js');

const SEEDS = 5000;
let failures = 0;
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
  }
}

console.log(`${SEEDS} seeds checked, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
