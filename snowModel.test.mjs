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

// ══════════════════════════════════════════════════════════════
// 1A.3 checks
// ══════════════════════════════════════════════════════════════

// Story split by piece: joining the parts gives the old story exactly.
for (let seed = 1; seed <= SEEDS; seed++) {
  const f = SnowModel.generateForecast(SnowModel.makeRng(seed));
  const p = SnowModel.forecastStoryParts(f);
  if (p.pieces.length !== f.segments.length) fail(`story parts: seed ${seed} has ${p.pieces.length} piece sentences for ${f.segments.length} pieces`);
  if ([p.start].concat(p.pieces).join(' ') !== SnowModel.forecastStory(f)) fail(`story parts: seed ${seed} parts don't join to the story`);
  if (/^Then/.test(p.pieces[0])) fail(`story parts: seed ${seed} first piece starts with "Then"`);
}

// describeDifference: for every Match the Forecast distractor, the kind,
// the first differing piece and the numbers are right; the correct graph
// gives null.
{
  const firstDiffPiece = (a, b) => {
    for (let i = 0; i < Math.max(a.segments.length, b.segments.length); i++) {
      const x = a.segments[i], y = b.segments[i];
      if (!x || !y) return i;
      if (Math.abs(SnowModel.segmentRate(x) - SnowModel.segmentRate(y)) > 1e-9 || x.hours !== y.hours) return i;
    }
    return -1;
  };
  const kinds = {};
  for (const lvl of [1, 2, 3]) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = SnowModel.makeRng(seed * 7 + lvl);
      const f = SnowModel.generateForecast(rng, { numSegments: lvl });
      const item = SnowModel.buildMatchItem(rng, f, 3);
      if (!item) continue;
      for (const c of item.choices) {
        const diff = SnowModel.describeDifference(c.forecast, item.correct);
        if (c.isCorrect) { if (diff !== null) fail('describeDifference: the correct graph should give null'); continue; }
        if (!diff) { fail(`describeDifference: ${c.rule} gave null (seed ${seed})`); continue; }
        kinds[`${c.rule}->${diff.kind}`] = (kinds[`${c.rule}->${diff.kind}`] || 0) + 1;
        if (c.rule === 'wrongStart') {
          if (diff.kind !== 'start' || diff.mine.start !== c.forecast.start || diff.truth.start !== f.start) fail(`describeDifference: wrongStart -> ${diff.kind}`);
          continue;
        }
        const k = firstDiffPiece(c.forecast, item.correct);
        if (diff.pieceIndex !== k) fail(`describeDifference: ${c.rule} first piece ${diff.pieceIndex}, expected ${k} (seed ${seed})`);
        const a = SnowModel.pieceSpans(c.forecast)[k], b = SnowModel.pieceSpans(item.correct)[k];
        if (diff.hour !== b.t0) fail(`describeDifference: ${c.rule} hour ${diff.hour}, expected ${b.t0}`);
        const rateDiffers = Math.abs(a.rate - b.rate) > 1e-9;
        const expectKind = !rateDiffers ? 'length' : Math.sign(a.rate) !== Math.sign(b.rate) ? 'shape' : 'slope';
        if (diff.kind !== expectKind) fail(`describeDifference: ${c.rule} kind ${diff.kind}, expected ${expectKind}`);
        if (c.rule === 'rateFlipped' && !(diff.kind === 'slope' || diff.kind === 'shape')) fail('describeDifference: rateFlipped should be a slope difference');
        if (c.rule === 'rateFlipped' && diff.pieceIndex === c.segmentIndex && !diff.swapped) fail('describeDifference: rateFlipped should be marked swapped');
        if (c.rule === 'cloudyAsMelt' && diff.kind !== 'shape') fail('describeDifference: cloudyAsMelt should be a shape difference');
        if (expectKind !== 'length') {
          if (diff.mine.rise !== a.rise || diff.mine.run !== a.run || diff.truth.rise !== b.rise || diff.truth.run !== b.run) fail('describeDifference: wrong rise/run numbers');
          if (!close(diff.mine.rate, a.rate) || !close(diff.truth.rate, b.rate)) fail('describeDifference: wrong unit rates');
        } else if (diff.mine.end !== a.t1 || diff.truth.end !== b.t1) fail('describeDifference: wrong end hours');
        if (SnowModel.differenceLines(diff).length !== 2 || !SnowModel.differenceSentence(diff)) fail('describeDifference: missing panel text');
      }
    }
  }
  console.log('describeDifference over Match distractors (rule->kind):', JSON.stringify(kinds));
}

// Fractions: never decimals.
{
  const cases = [[0, '0'], [4, '4'], [0.5, '½'], [10 / 3, '3⅓'], [2 / 3, '⅔'], [7.5, '7½'], [8 / 7, '1 1/7'], [-1.5, '−1½']];
  for (const [v, want] of cases) if (SnowModel.formatMixed(v) !== want) fail(`formatMixed(${v}) = ${SnowModel.formatMixed(v)}, want ${want}`);
  const rates = [[1, 3, '1/3'], [3, 1, '3'], [-2, 1, '−2'], [3, 2, '3/2'], [2, 4, '1/2'], [0, 1, '0']];
  for (const [r, u, want] of rates) if (SnowModel.formatRate(r, u) !== want) fail(`formatRate(${r},${u}) = ${SnowModel.formatRate(r, u)}, want ${want}`);
  // every whole-hour depth of every generated forecast prints without a decimal point
  for (let seed = 1; seed <= SEEDS; seed++) {
    const f = SnowModel.generateForecast(SnowModel.makeRng(seed));
    for (let h = 0; h <= SnowModel.forecastTotalHours(f); h++) if (/\./.test(SnowModel.formatMixed(SnowModel.depthAt(f, h)))) fail(`formatMixed printed a decimal for seed ${seed} hour ${h}`);
  }
}

// Hover snap: any hour maps to the nearest whole hour, clamped.
{
  const S = SnowModel;
  const cases = [[-0.7, 6, 0], [0.49, 6, 0], [0.5, 6, 1], [3.2, 6, 3], [5.6, 6, 6], [9, 6, 6]];
  for (const [t, total, want] of cases) if (S.snapHour(t, total) !== want) fail(`snapHour(${t}, ${total}) = ${S.snapHour(t, total)}, want ${want}`);
}

// Piece colors: every piece index maps to a token; contrast >= 4.5:1 as
// text on each page theme's surfaces; the three stay apart under
// protanopia / deuteranopia simulation (Machado 2009, severity 1).
{
  const S = SnowModel;
  for (let i = 0; i < S.MAX_SEGMENTS; i++) if (S.pieceColorVar(i) !== `--piece-${i + 1}`) fail(`piece ${i} should map to --piece-${i + 1}`);
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const gam = c => { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); };
  const hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const CVD = {
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  };
  const sim = (rgb, k) => (k === 'normal' ? rgb : CVD[k].map(r => gam(r[0] * lin(rgb[0]) + r[1] * lin(rgb[1]) + r[2] * lin(rgb[2]))));
  const lab = rgb => {
    const [r, g, b] = rgb.map(lin);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
  const lum = h => { const [r, g, b] = hx(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const THEMES = {
    dark: { bgs: ['#22263a', '#1a1d27', '#0f1117'], steps: { run: '#1A56DB', rise: '#E07B00' } },
    light: { bgs: ['#ffffff', '#eceef7', '#f4f5fa'], steps: { run: '#1A56DB', rise: '#E07B00' } },
  };
  const report = [];
  for (const [theme, T] of Object.entries(THEMES)) {
    const P = S.PIECE_COLORS[theme];
    P.forEach((c, i) => {
      const worst = Math.min(...T.bgs.map(b => contrast(c, b)));
      if (worst < 4.5) fail(`piece color ${i + 1} (${theme}) ${c}: contrast ${worst.toFixed(2)} < 4.5`);
    });
    for (const k of ['normal', 'deutan', 'protan']) {
      const s = P.map(c => sim(hx(c), k));
      const trio = Math.min(dE(s[0], s[1]), dE(s[0], s[2]), dE(s[1], s[2]));
      if (trio < 20) fail(`piece colors (${theme}, ${k}): two pieces too close (ΔE ${trio.toFixed(0)} < 20)`);
      const rise = Math.min(...P.map(c => dE(sim(hx(c), k), sim(hx(T.steps.rise), k))));
      const run = Math.min(...P.map(c => dE(sim(hx(c), k), sim(hx(T.steps.run), k))));
      if (rise < 12) fail(`piece colors (${theme}, ${k}): too close to the rise orange (ΔE ${rise.toFixed(0)})`);
      report.push(`${theme}/${k}: pieces ≥${trio.toFixed(0)}, vs rise ${rise.toFixed(0)}, vs run line ${run.toFixed(0)}`);
    }
  }
  console.log('piece colors (CIELAB ΔE; ≥20 reads as different):\n  ' + report.join('\n  '));
}

// Per-mode storage (1A.3, Section 4).
{
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
  } });
  const S = SnowModel;
  // Migration: old single-mode keys -> mode 'match'.
  store.set('sc_score', '7'); store.set('sc_streak', '2'); store.set('sc_best_medal', 'silver');
  store.set('sc_level', '2'); store.set('sc_level_progress', '1'); store.set('sc_last_item', 'abc');
  const m = S.getScoreState('match');
  if (m.score !== 7 || m.streak !== 2 || m.level !== 2 || m.levelProgress !== 1) fail(`storage: migration lost data ${JSON.stringify(m)}`);
  if (m.bestStreak !== 5 || m.bestMedal !== 'silver') fail(`storage: a migrated silver medal should mean best streak 5 (got ${m.bestStreak}, ${m.bestMedal})`);
  if (store.has('sc_score') || !S.wasLastItem('abc', 'match')) fail('storage: migration should move and remove the old keys');
  // Modes never change each other.
  S.recordAttempt(true, 'story'); S.recordAttempt(true, 'story'); S.recordAttempt(true, 'story');
  if (S.getScoreState('match').score !== 7 || S.getScoreState('draw').score !== 0) fail('storage: a story round changed another mode');
  if (S.getScoreState('story').bestMedal !== 'bronze' || S.getScoreState('story').level !== 2) fail('storage: story should have bronze and level 2 after 3 in a row');
  S.recordAttempt(false, 'draw');
  if (S.getScoreState('story').streak !== 3) fail('storage: a draw miss reset the story streak');
  // The medal comes from the BEST streak and is never lost.
  S.recordAttempt(false, 'story');
  if (S.getScoreState('story').bestMedal !== 'bronze' || S.getScoreState('story').streak !== 0) fail('storage: a medal should never be lost');
  for (let i = 0; i < 10; i++) S.recordAttempt(true, 'draw');
  const dr = S.getScoreState('draw');
  if (dr.bestStreak !== 10 || dr.bestMedal !== 'gold') fail('storage: 10 in a row should be gold');
  for (const [n, want] of [[0, 'none'], [2, 'none'], [3, 'bronze'], [4, 'bronze'], [5, 'silver'], [9, 'silver'], [10, 'gold'], [25, 'gold']]) {
    if (S.medalForStreak(n) !== want) fail(`storage: streak ${n} should be ${want}`);
  }
  // Clear one mode; clear all.
  S.resetProgress('draw');
  if (S.getScoreState('draw').score !== 0 || S.getScoreState('story').score === 0) fail('storage: resetting one mode should leave the others');
  S.resetProgress();
  if (SnowModel.SCORE_MODES.some(md => S.getScoreState(md).score !== 0 || S.getScoreState(md).bestStreak !== 0)) fail('storage: resetProgress() should clear every mode');
  if (store.size !== 0) fail(`storage: resetProgress() left keys behind: ${[...store.keys()]}`);
  // Corrupt JSON never throws.
  store.set('sc_mode_story', '{nope');
  if (S.getScoreState('story').score !== 0) fail('storage: corrupt data should read as a fresh start');
  S.resetProgress();
}

// Match the Story generator (1A.3, Section 6; spec 6b + Karl 11/27).
for (const { name, model: M } of SCALES) {
  const intents = {};
  let built = 0, tried = 0;
  for (const lvl of [1, 2, 3]) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = M.makeRng(seed * 13 + lvl);
      const f = M.generateForecast(rng, { numSegments: lvl });
      tried++;
      const item = M.buildStoryItem(rng, f, 3);
      if (!item) continue;
      built++;
      const ch = item.choices;
      if (ch.length !== 4) fail(`[${name}] story: ${ch.length} options`);
      if (ch.filter(c => c.isCorrect).length !== 1) fail(`[${name}] story: not exactly one correct`);
      const keys = new Set(ch.map(c => M.pointsKey(c.points)));
      if (keys.size !== 4) fail(`[${name}] story: two options draw the same graph (seed ${seed})`);
      const texts = new Set(ch.map(c => c.story));
      if (texts.size !== 4) fail(`[${name}] story: two options have the same text`);
      const end = M.forecastTotalHours(f);
      let startDiffs = 0, lengthDiffs = 0;
      for (const c of ch) {
        if (!M.isPlausibleGraph(c.points)) fail(`[${name}] story: an option is not a real forecast`);
        if (M.forecastTotalHours(c.forecast) !== end) fail(`[${name}] story: an option ends at a different hour`);
        if (c.forecast.segments.length !== lvl) fail(`[${name}] story: an option has a different number of pieces`);
        // whole-number rates in lowest terms: no "2 inches every 4 hours"
        for (const s of c.forecast.segments) if (s.weather !== 'cloudy' && M.reduceFrac(s.rise, s.run)[1] !== s.run) fail(`[${name}] story: rate ${s.rise}/${s.run} not in lowest terms`);
        if (c.isCorrect) continue;
        if (!c.intent) fail(`[${name}] story: a distractor has no intent tag`);
        intents[c.intent] = (intents[c.intent] || 0) + 1;
        if (c.forecast.start !== f.start) startDiffs++;
        if (c.forecast.segments.some((s, i) => s.hours !== f.segments[i].hours)) lengthDiffs++;
      }
      const pureStart = item.mainIntent === 'readStart';
      if (pureStart && lvl > 1) fail(`[${name}] story: a start-only round at level ${lvl}`);
      if (!pureStart && startDiffs > 1) fail(`[${name}] story: ${startDiffs} options with a different start (max 1)`);
      if (lengthDiffs > 1) fail(`[${name}] story: ${lengthDiffs} options with different piece lengths (max 1)`);
      if (lvl === 1 && lengthDiffs) fail(`[${name}] story: a length change at level 1`);
    }
  }
  console.log(`[${name}] Match the Story built for ${(built / tried * 100).toFixed(0)}% of forecasts; distractor intents: ${JSON.stringify(intents)}`);
}

// gradeDrawing and the piece-by-piece drawing (1A.3, Section 7; spec 6d).
{
  const S = SnowModel;
  const f = { start: 2, segments: [{ weather: 'snow', rise: 1, run: 3, hours: 6 }, { weather: 'cloudy', hours: 2 }, { weather: 'sun', rise: -1, run: 1, hours: 2 }] };
  const truth = S.forecastPoints(f);
  const g = pts => S.gradeDrawing(pts, f);
  if (!g(truth).correct) fail('gradeDrawing: the true polyline should pass');
  const extra = [truth[0], { t: 3, d: 3 }, truth[1], { t: 7, d: 4 }, truth[2], { t: 9, d: 3 }, truth[3]];
  if (!g(extra).correct) fail('gradeDrawing: extra collinear points should still pass');
  const shift = truth.map((p, i) => (i === 0 ? { t: 0, d: 3 } : p));
  if (g(shift).rule !== 'wrongStart' && g(shift).rule !== 'wrongRate') fail(`gradeDrawing: a wrong start gave ${g(shift).rule}`);
  const shiftAll = truth.map(p => ({ t: p.t, d: p.d + 1 }));
  if (g(shiftAll).rule !== 'wrongStart' || g(shiftAll).firstHour !== 0) fail(`gradeDrawing: a whole graph 1 inch high should be wrongStart at hour 0 (got ${g(shiftAll).rule})`);
  const steep = [truth[0], { t: 6, d: 8 }, { t: 8, d: 8 }, { t: 10, d: 6 }];
  if (g(steep).rule !== 'wrongRate' || g(steep).firstHour !== 1) fail(`gradeDrawing: a flipped slope gave ${g(steep).rule}`);
  const upMelt = [truth[0], truth[1], truth[2], { t: 10, d: 6 }];
  if (g(upMelt).rule !== 'meltAsSnow') fail(`gradeDrawing: melting drawn as snow gave ${g(upMelt).rule}`);
  if (g(truth.slice(0, 3)).rule !== 'stopsEarly') fail(`gradeDrawing: stopping early gave ${g(truth.slice(0, 3)).rule}`);
  const longer = [truth[0], { t: 9, d: 5 }, { t: 10, d: 5 }, { t: 12, d: 3 }];
  if (g(longer).correct || g(longer).rule !== 'pieceLength') fail(`gradeDrawing: a piece too long gave ${g(longer).rule}`);
  const shorter = [truth[0], { t: 3, d: 3 }, { t: 8, d: 3 }, { t: 10, d: 1 }];
  if (g(shorter).correct || g(shorter).rule !== 'pieceLength') fail(`gradeDrawing: a piece too short gave ${g(shorter).rule}`);
  const flatMelt = [truth[0], truth[1], { t: 8, d: 2 }, { t: 10, d: 0 }];
  if (g(flatMelt).correct || g(flatMelt).diff.kind !== 'shape') fail('gradeDrawing: cloudy drawn as melting should be a shape difference');
  if (!g(truth.concat([{ t: 12, d: 2 }])).rule === 'tooLong') fail('gradeDrawing: running past the end should fail');

  // The drawing state, in order: start at hour 0, then one end per piece.
  let st = { points: [] };
  const step = a => { const r = S.drawStep(st, a, 3); st = r.state; return r.error; };
  if (step({ type: 'click', point: { t: 2, d: 2 } }) !== 'start0') fail('drawStep: the first click must be at hour 0');
  step({ type: 'click', point: { t: 0, d: 2 } });
  if (step({ type: 'click', point: { t: 0, d: 5 } }) !== 'forward') fail('drawStep: an end at the start hour should be refused');
  step({ type: 'click', point: { t: 6, d: 4 } });
  if (S.activeDrawPiece(st) !== 1) fail('drawStep: piece 2 should be next after piece 1');
  step({ type: 'click', point: { t: 8, d: 4 } });
  if (step({ type: 'click', point: { t: 7, d: 1 } }) !== 'forward') fail('drawStep: time only moves forward');
  step({ type: 'click', point: { t: 10, d: 2 } });
  if (!S.gradeDrawing(st.points, f).correct) fail('drawStep: drawing the story piece by piece should grade correct');
  if (step({ type: 'click', point: { t: 11, d: 2 } }) !== 'done') fail('drawStep: no fourth piece in a 3-piece story');
  // Redrawing piece 2 clears piece 3 (its start depends on piece 2).
  step({ type: 'redraw', piece: 1 });
  if (st.points.length !== 2 || S.activeDrawPiece(st) !== 1) fail('drawStep: redrawing piece 2 should keep only piece 1');
  step({ type: 'click', point: { t: 8, d: 5 } }); step({ type: 'click', point: { t: 10, d: 3 } });
  if (S.gradeDrawing(st.points, f).correct) fail('drawStep: the redrawn (wrong) piece should now grade wrong');
  step({ type: 'redraw', piece: 0 });
  if (st.points.length !== 0) fail('drawStep: redrawing piece 1 starts over at the start point');
  step({ type: 'click', point: { t: 0, d: 2 } }); step({ type: 'click', point: { t: 6, d: 4 } });
  step({ type: 'undo' });
  if (st.points.length !== 0) fail('drawStep: undo of the only piece removes its start too');
  step({ type: 'click', point: { t: 0, d: 2 } }); step({ type: 'click', point: { t: 6, d: 4 } }); step({ type: 'click', point: { t: 8, d: 4 } });
  step({ type: 'undo' });
  if (st.points.length !== 2) fail('drawStep: undo removes the last piece');
  step({ type: 'clear' });
  if (st.points.length) fail('drawStep: clear empties the drawing');
}

const repeated = Object.entries(failCounts).filter(([, n]) => n > 3);
for (const [k, n] of repeated) console.error(`  (…${n} failures like: ${k})`);
console.log(`${SEEDS} seeds x ${SCALES.length} scales checked, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
