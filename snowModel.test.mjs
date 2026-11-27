// Checks for the Snow Challenge model (spec v1 section 6, spec v2 section 8).
// Run with: node snowModel.test.mjs
// Not loaded by the site; a standalone dev check, kept in the repo so it
// can be re-run after any change to snowModel.js.
//
// Every scale-dependent check runs at several scales (the default and the
// alternatives Karl may pick), so changing MAX_HOURS / MAX_DEPTH in
// snowModel.js can't silently break anything.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SnowModel = require('./snowModel.js');

const SEEDS = 5000;
let failures = 0;
const failCounts = {};
function fail(msg) {
  failures++;
  const key = msg.replace(/\d+/g, '#');
  failCounts[key] = (failCounts[key] || 0) + 1;
  if (failCounts[key] <= 3) console.error('FAIL: ' + msg);
}
const close = (a, b) => Math.abs(a - b) < 1e-9;

const SCALES = [
  { name: 'default (12 h x 15 in)', model: SnowModel },
  { name: '10 h x 15 in', model: SnowModel.createModel({ maxHours: 10 }) },
  { name: '12 h x 12 in', model: SnowModel.createModel({ maxDepth: 12 }) },
];

if (SnowModel.MAX_DEPTH !== 15 || SnowModel.MAX_HOURS !== 12) fail(`default scale should be 12 h x 15 in, got ${SnowModel.MAX_HOURS} x ${SnowModel.MAX_DEPTH}`);
if (SnowModel.MAX_TOTAL_HOURS !== SnowModel.MAX_HOURS) fail('MAX_TOTAL_HOURS should still alias MAX_HOURS');

for (const { name, model: M } of SCALES) {
  const D = M.MAX_DEPTH, H = M.MAX_HOURS;
  let matchBuilt = 0;
  const peakStats = { 1: [0, 0], 2: [0, 0], 3: [0, 0] }; // [met target, rounds where it applies]
  let fastRounds = 0;

  for (let seed = 1; seed <= SEEDS; seed++) {
    const rng = M.makeRng(seed);
    let forecast;
    try { forecast = M.generateForecast(rng); } catch (e) { fail(`[${name}] seed ${seed}: generateForecast threw — ${e.message}`); continue; }

    const points = M.forecastPoints(forecast);
    for (const p of points) {
      if (!Number.isInteger(p.t) || !Number.isInteger(p.d)) fail(`[${name}] seed ${seed}: corner not on whole numbers (${p.t}, ${p.d})`);
      if (p.d < 0 || p.d > D) fail(`[${name}] seed ${seed}: depth ${p.d} out of [0,${D}]`);
    }
    if (M.forecastTotalHours(forecast) > H) fail(`[${name}] seed ${seed}: total hours over ${H}`);
    if (forecast.start > M.START_DEPTH_MAX) fail(`[${name}] seed ${seed}: start ${forecast.start} over ${M.START_DEPTH_MAX}`);
    let running = forecast.start;
    for (const seg of forecast.segments) {
      running += M.segmentDelta(seg);
      if (seg.weather === 'sun' && running <= 0) fail(`[${name}] seed ${seed}: generated melt reached ${running} (must stay > 0)`);
    }
    // depthAt agrees with every corner and is continuous.
    for (const p of points) if (!close(M.depthAt(forecast, p.t), p.d)) fail(`[${name}] seed ${seed}: depthAt(${p.t}) = ${M.depthAt(forecast, p.t)}, corner says ${p.d}`);
    for (let t = 0; t < M.forecastTotalHours(forecast); t += 0.25) {
      if (Math.abs(M.depthAt(forecast, t + 1e-7) - M.depthAt(forecast, t)) > 1e-5) fail(`[${name}] seed ${seed}: depthAt jumps at hour ${t}`);
    }

    const n = forecast.segments.length;
    if (n >= 2 || forecast.segments[0].weather === 'snow') {
      peakStats[n][1]++;
      if (M.peakOf(forecast) >= M.PEAK_TARGET * D) peakStats[n][0]++;
    }
    if (forecast.segments.some(s => s.weather === 'snow' && s.rise / s.run >= 2)) fastRounds++;

    const item = M.buildMatchItem(rng, forecast, 3);
    if (!item) continue;
    matchBuilt++;
    if (item.choices.length !== 4) fail(`[${name}] seed ${seed}: expected 4 choices`);
    if (item.choices.filter(c => c.isCorrect).length !== 1) fail(`[${name}] seed ${seed}: expected exactly 1 correct choice`);
    const keys = item.choices.map(c => M.pointsKey(c.points));
    if (new Set(keys).size !== 4) fail(`[${name}] seed ${seed}: two choices draw the same graph`);
    for (const c of item.choices) {
      if (c.isCorrect) continue;
      if (!c.rule) fail(`[${name}] seed ${seed}: a distractor has no rule tag`);
      for (const p of c.points) {
        if (!Number.isInteger(p.t) || !Number.isInteger(p.d)) fail(`[${name}] seed ${seed}: ${c.rule} distractor corner off-grid`);
        if (p.d < 0 || p.d > D) fail(`[${name}] seed ${seed}: ${c.rule} distractor depth ${p.d} out of [0,${D}]`);
      }
      if (c.points[c.points.length - 1].t > H) fail(`[${name}] seed ${seed}: ${c.rule} distractor runs past hour ${H}`);
      if (c.points[c.points.length - 1].t !== points[points.length - 1].t) fail(`[${name}] seed ${seed}: ${c.rule} distractor ends at a different hour`);
      const split = M.firstSplit(forecast, c.forecast);
      if (!split) fail(`[${name}] seed ${seed}: firstSplit found no difference for a distractor`);
      else {
        const k = split.hour;
        const same = t => Math.abs(M.depthAt(forecast, t) - M.depthAt(c.forecast, t)) < 1e-9;
        for (let t = 0; t <= k; t++) if (!same(t) && !(t === k && k === 0)) fail(`[${name}] seed ${seed}: graphs already differ at hour ${t}, before the split at ${k}`);
        if (same(k) && same(k + 1)) fail(`[${name}] seed ${seed}: no difference on [${k}, ${k + 1}] where the split was reported`);
      }
    }
  }

  const buildRate = matchBuilt / SEEDS;
  if (buildRate < 0.6) fail(`[${name}] only ${(buildRate * 100).toFixed(0)}% of forecasts produced a Match round`);
  const pct = ([a, b]) => (b ? (100 * a / b).toFixed(0) : '—');
  // Levels 2-3 must meet the target in "most" rounds (aim: about 80%).
  for (const lvl of [2, 3]) if (peakStats[lvl][1] && peakStats[lvl][0] / peakStats[lvl][1] < 0.75) fail(`[${name}] level ${lvl}: only ${pct(peakStats[lvl])}% of rounds reach ${M.PEAK_TARGET * D} in`);
  if (peakStats[1][1] && peakStats[1][0] / peakStats[1][1] < 0.6) fail(`[${name}] level 1 snow rounds: only ${pct(peakStats[1])}% reach ${M.PEAK_TARGET * D} in`);
  if (fastRounds / SEEDS < 0.15) fail(`[${name}] fast rates (2+ in/hr) appear in only ${(100 * fastRounds / SEEDS).toFixed(0)}% of rounds`);
  console.log(`[${name}] Match rounds built for ${(buildRate * 100).toFixed(0)}% of forecasts; ` +
    `peak >= ${+(M.PEAK_TARGET * D).toFixed(1)} in: L1 snow ${pct(peakStats[1])}%, L2 ${pct(peakStats[2])}%, L3 ${pct(peakStats[3])}%; ` +
    `fast rate in ${(100 * fastRounds / SEEDS).toFixed(0)}% of rounds.`);

  // Every level can produce rounds with its number of pieces.
  const levelRates = [];
  for (let level = 1; level <= M.MAX_LEVEL; level++) {
    let built = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = M.makeRng(seed * 7 + level);
      const f = M.generateForecast(rng, { numSegments: level });
      if (f.segments.length !== level) fail(`[${name}] level ${level}: forecast has ${f.segments.length} pieces`);
      if (M.buildMatchItem(rng, f, 3)) built++;
    }
    // The page tries up to 40 forecasts per round, so 40% is far more than enough.
    if (built < 400) fail(`[${name}] level ${level}: only ${built}/1000 forecasts produced a round`);
    levelRates.push(`L${level} ${(built / 10).toFixed(0)}%`);
  }
  console.log(`[${name}] rounds possible per forecast: ${levelRates.join(', ')}`);

  // Axis labels: every 3 plus the top line, always.
  const labels = M.axisLabels(D);
  if (labels[0] !== 0 || labels[labels.length - 1] !== D) fail(`[${name}] axis labels should run 0..${D}, got ${labels}`);
  if (labels.some((v, i) => i > 0 && i < labels.length - 1 && v % M.LABEL_EVERY)) fail(`[${name}] inner labels should be multiples of ${M.LABEL_EVERY}`);

  // Scene scale (Phase 1A.2 revised): two stakes, each on ONE linear scale
  // — the small stake in the grass at MINI_PX_PER_INCH, the measuring
  // inset at PX_PER_INCH (16, or less only if the scene is too short).
  // The snow top at every whole and half hour sits on the right mark.
  for (const [w, h] of [[491, 403], [520, 556], [400, 360], [300, 600]]) {
    const L = M.sceneLayout(w, h), I = L.inset, m = L.mini;
    for (const d of [0, 3, 8, D]) {
      if (!close(m.yForDepth(d), m.baseY - d * M.MINI_PX_PER_INCH)) fail(`[${name}] small stake mark ${d} off its scale`);
      if (!close(I.yForDepth(d), I.groundY - d * I.pxPerInch)) fail(`[${name}] inset mark ${d} off its scale`);
    }
    if (!close(L.yForDepth(D), I.yForDepth(D))) fail(`[${name}] top-level yForDepth should be the inset's`);
    if (h >= 400 && I.pxPerInch < 16 - 1e-9) fail(`[${name}] inset at ${w}x${h} is ${I.pxPerInch.toFixed(1)} px/in (< 16)`);
    if (I.y < 0 || I.x + I.w > w) fail(`[${name}] inset doesn't fit in ${w}x${h}`);
    if (m.x < I.x + I.w) fail(`[${name}] the small stake is under the inset`);
    if (m.yForDepth(D) < L.fgTop) fail(`[${name}] the small stake's top rises past the horizon`);
    if (!close(I.ovW, H * I.pxPerInch)) fail(`[${name}] overlay width should be MAX_HOURS x PX_PER_INCH`);
    for (let seed = 1; seed <= 100; seed++) {
      const f = M.generateForecast(M.makeRng(seed));
      for (let t = 0; t <= M.forecastTotalHours(f); t += 0.5) {
        const d = M.depthAt(f, t);
        if (Number.isInteger(d) && !close(I.yForDepth(d), I.groundY - d * I.pxPerInch)) fail(`[${name}] inset snow top misses mark ${d}`);
      }
    }
    // Trees are rooted: base at or below the ridge at their x, inside the hill.
    const hills = M.sceneHills(w, h);
    for (const tr of hills.trees) {
      const ridge = tr.hill === 'far' ? hills.ridgeFar(tr.x) : hills.ridgeNear(tr.x);
      if (tr.baseY < ridge) fail(`[${name}] a ${tr.hill} tree floats above its hill at x=${tr.x.toFixed(0)}`);
      if (tr.x < 0 || tr.x > w) fail(`[${name}] a tree is off the hill's span`);
    }
  }

  // ── Explorer rules: random walks through the builder using only the
  // choices it offers. Nothing offered may break either limit; greyed
  // choices must carry a reason; later pieces are never changed. ──
  const rngW = M.makeRng(99);
  for (let walk = 0; walk < 200; walk++) {
    let f = { start: 2, segments: [{ weather: 'snow', rise: 1, run: 3, hours: 6 }] };
    if (M.checkForecast(f)) fail(`[${name}] the default Explorer forecast is invalid`);
    for (let step = 0; step < 30; step++) {
      const i = Math.floor(rngW() * f.segments.length);
      const op = Math.floor(rngW() * 6);
      const before = M.cloneForecast(f);
      if (op === 0) {
        const opts = M.startOptions(f);
        for (const o of opts) if (!o.ok && !o.reason) fail(`[${name}] greyed start option without a reason`);
        const ok = opts.filter(o => o.ok);
        if (!ok.length) fail(`[${name}] no starting depth allowed`);
        f.start = ok[Math.floor(rngW() * ok.length)].value;
      } else if (op === 1) {
        const opts = M.weatherOptions(f, i).filter(o => o.ok);
        const w = opts[Math.floor(rngW() * opts.length)].value;
        f = Object.assign(M.cloneForecast(f));
        f.segments[i] = M.bestPiece(f, i, w, f.segments[i]);
      } else if (op === 2 && f.segments[i].weather !== 'cloudy') {
        const opts = M.rateOptions(f, i, f.segments[i].weather);
        for (const o of opts) if (!o.ok && !o.reason) fail(`[${name}] greyed rate without a reason`);
        const ok = opts.filter(o => o.ok);
        const r = ok[Math.floor(rngW() * ok.length)];
        f.segments[i] = M.bestPiece(f, i, f.segments[i].weather, { rise: r.rise, run: r.run, hours: f.segments[i].hours });
      } else if (op === 3) {
        const s = f.segments[i];
        const opts = M.hourOptions(f, i, s.weather, s.rise, s.run);
        for (const o of opts) {
          const e = M.evalPiece(f, i, Object.assign({}, s, { hours: o.value }));
          if (e.own) fail(`[${name}] an hour option was offered that breaks its own piece`);
          if (e.ok !== o.ok) fail(`[${name}] an hour option's ok flag is wrong`);
          if (!o.ok && !o.reason) fail(`[${name}] greyed hour option without a reason`);
          if (o.value > M.hoursLeftFor(f, i)) fail(`[${name}] an hour option runs past ${H} hours`);
        }
        const ok = opts.filter(o => o.ok);
        if (!ok.length) fail(`[${name}] piece ${i} has no allowed hours`);
        else f.segments[i] = Object.assign({}, s, { hours: ok[Math.floor(rngW() * ok.length)].value });
      } else if (op === 4) {
        const a = M.addCheck(f);
        if (a.ok) f.segments.push(a.piece); else if (!a.reason) fail(`[${name}] add blocked without a reason`);
      } else if (op === 5) {
        const r = M.removeCheck(f, i);
        if (r.ok) f.segments.splice(i, 1); else if (!r.reason) fail(`[${name}] remove blocked without a reason`);
      }
      const p = M.checkForecast(f);
      if (p) { fail(`[${name}] builder reached an invalid forecast (${p.kind} at piece ${p.index}) via op ${op}`); f = before; continue; }
      // Changing piece i must never change the pieces after it.
      if ((op === 1 || op === 2 || op === 3) && before.segments.length === f.segments.length) {
        for (let j = i + 1; j < f.segments.length; j++) {
          if (JSON.stringify(before.segments[j]) !== JSON.stringify(f.segments[j])) fail(`[${name}] changing piece ${i} changed later piece ${j}`);
        }
      }
      if (M.forecastTotalHours(f) > H) fail(`[${name}] builder exceeded ${H} hours`);
    }
  }
  // Melting may reach exactly 0 in Explorer, never below.
  {
    const f = { start: 2, segments: [{ weather: 'sun', rise: -1, run: 1, hours: 1 }] };
    const hrs = M.hourOptions(f, 0, 'sun', -1, 1).map(o => o.value);
    if (!hrs.includes(2)) fail(`[${name}] melting to exactly 0 should be offered`);
    if (hrs.includes(3)) fail(`[${name}] melting below 0 must not be offered`);
    // A later melt makes a shorter first piece greyed, with the reason.
    const g = { start: 0, segments: [{ weather: 'snow', rise: 1, run: 1, hours: 4 }, { weather: 'sun', rise: -2, run: 1, hours: 2 }] };
    const o3 = M.hourOptions(g, 0, 'snow', 1, 1).find(o => o.value === 3);
    if (!o3 || o3.ok || !/melt below 0/.test(o3.reason)) fail(`[${name}] a choice that makes a later melt go below 0 should be greyed with a reason`);
  }
  // Greyed reason names the cap when a later piece would overflow.
  {
    const f = { start: 0, segments: [{ weather: 'snow', rise: 1, run: 1, hours: 2 }, { weather: 'snow', rise: 3, run: 1, hours: Math.floor((D - 2) / 3) }] };
    if (M.checkForecast(f)) fail(`[${name}] overflow test setup invalid`);
    const opts = M.hourOptions(f, 0, 'snow', 1, 1);
    const greyed = opts.filter(o => !o.ok);
    if (D % 3 !== 2 && !greyed.length && opts.length > 2) { /* room happens to fit */ }
    for (const o of greyed) if (!o.reason.includes(String(D))) fail(`[${name}] overflow reason should name ${D} inches`);
  }
}

// ── Sky blends (Phase 1A.2): skyLevel / cloudLevel stay in [0, 1], are
// continuous, hold each piece's value at its middle, and ease at boundaries.
for (let seed = 1; seed <= 2000; seed++) {
  const f = SnowModel.generateForecast(SnowModel.makeRng(seed));
  const total = SnowModel.forecastTotalHours(f);
  let prev = SnowModel.skyLevel(f, 0);
  for (let t = 0; t <= total; t += 0.05) {
    const v = SnowModel.skyLevel(f, t), c = SnowModel.cloudLevel(f, t);
    if (v < 0 || v > 1 || c < 0 || c > 1) fail(`seed ${seed}: sky/cloud level out of [0,1] at hour ${t}`);
    if (Math.abs(v - prev) > 0.2) fail(`seed ${seed}: skyLevel jumps at hour ${t}`);
    prev = v;
  }
  let t0 = 0;
  for (const seg of f.segments) {
    const mid = t0 + seg.hours / 2;
    const want = seg.weather === 'sun' ? 1 : 0;
    if (Math.abs(SnowModel.skyLevel(f, mid) - want) > 1e-9) fail(`seed ${seed}: skyLevel at the middle of a ${seg.weather} piece is ${SnowModel.skyLevel(f, mid)}`);
    if (Math.abs(SnowModel.cloudLevel(f, mid) - (1 - want)) > 1e-9) fail(`seed ${seed}: cloudLevel wrong mid-piece`);
    t0 += seg.hours;
  }
}
// Scene type is stable for a seed and both types occur.
{
  const types = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const a = SnowModel.sceneTypeFor(seed);
    if (a !== SnowModel.sceneTypeFor(seed)) fail(`sceneTypeFor(${seed}) is not stable`);
    types.add(a);
  }
  if (types.size !== 2) fail('sceneTypeFor should give both night and day');
}
// firstSplit on hand examples.
{
  const T = { start: 2, segments: [{ weather: 'snow', rise: 1, run: 1, hours: 3 }, { weather: 'cloudy', hours: 2 }] };
  if (SnowModel.firstSplit(T, SnowModel.cloneForecast(T)) !== null) fail('firstSplit of a graph with itself should be null');
  const wrongStart = Object.assign(SnowModel.cloneForecast(T), { start: 3 });
  const s1 = SnowModel.firstSplit(T, wrongStart);
  if (!s1 || s1.hour !== 0 || s1.pieceIndex !== 0) fail(`firstSplit wrong start: ${JSON.stringify(s1)}`);
  const melt = SnowModel.cloneForecast(T); melt.segments[1] = { weather: 'sun', rise: -1, run: 1, hours: 2 };
  const s2 = SnowModel.firstSplit(T, melt);
  if (!s2 || s2.hour !== 3 || s2.pieceIndex !== 1) fail(`firstSplit cloudy-as-melt: ${JSON.stringify(s2)}`);
}

// Story text: correct plurals and a capital letter starting each sentence.
for (let seed = 1; seed <= 500; seed++) {
  const story = SnowModel.forecastStory(SnowModel.generateForecast(SnowModel.makeRng(seed)));
  if (/\binchs\b|\bevery 1 hour\b/.test(story)) fail(`seed ${seed}: bad wording in story — "${story}"`);
  for (const sentence of story.split(/(?<=\.)\s+/)) {
    if (!/^[A-Z]/.test(sentence)) fail(`seed ${seed}: sentence not capitalized — "${sentence}"`);
  }
}

// depthAt: never below 0 even if a hand-built forecast over-melts, and
// snow after that piles up from 0 (the old Explorer bug).
{
  const f = { start: 1, segments: [{ weather: 'sun', rise: -3, run: 1, hours: 2 }, { weather: 'snow', rise: 1, run: 1, hours: 3 }] };
  if (SnowModel.depthAt(f, 2) !== 0) fail('depthAt should floor at 0');
  if (!close(SnowModel.depthAt(f, 5), 3)) fail(`snow after a full melt should pile up from 0 (got ${SnowModel.depthAt(f, 5)})`);
  if (SnowModel.depthAt(f, -1) !== 1 || !close(SnowModel.depthAt(f, 99), 3)) fail('depthAt should clamp t to the forecast');
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
  S.recordAttempt(false);
  if (lvl() !== 1) fail('levels: a wrong pick should not change the level');
  S.recordAttempt(true); S.recordAttempt(true);
  if (lvl() !== 1) fail('levels: progress should have reset after the wrong pick');
  const r = S.recordAttempt(true);
  if (lvl() !== 2 || !r.leveledUp) fail('levels: 3 first-try corrects in a row should reach level 2');
  S.recordAttempt(false);
  if (lvl() !== 2) fail('levels: a wrong pick should never drop a level');
  for (let i = 0; i < 20; i++) S.recordAttempt(true);
  if (lvl() !== S.MAX_LEVEL) fail(`levels: should cap at level ${S.MAX_LEVEL}`);
  S.resetProgress();
  if (lvl() !== 1 || S.getScoreState().score !== 0) fail('levels: resetProgress should clear everything');
}

const repeated = Object.entries(failCounts).filter(([, n]) => n > 3);
for (const [k, n] of repeated) console.error(`  (…${n} failures like: ${k})`);
console.log(`${SEEDS} seeds x ${SCALES.length} scales checked, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
