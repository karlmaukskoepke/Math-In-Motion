// ── SNOW CHALLENGE — forecast model ──
// Pure logic, no DOM: generates/validates weather "forecasts" (a starting
// depth + 1-3 piecewise-linear segments), turns them into plain-English
// stories and (t, depth) point arrays for drawing, builds distractor
// forecasts for Match the Forecast, works out which Explorer choices are
// allowed, maps depth to the scene's stake, and tracks score/streak/medals.
// Loaded as a plain <script> in snow-challenge.html (attaches to
// `window.SnowModel`) and also `require()`-able from Node for the test
// script (see snowModel.test.mjs) — hence the dual export at the bottom.
//
// SCALE: everything that depends on how tall or long a graph is comes from
// DEFAULT_SCALE below (MAX_DEPTH inches, MAX_HOURS hours). Change a number
// there and the generator, distractors, Explorer limits, axes, stake and
// tests all follow. `SnowModel.createModel({ maxHours: 10 })` builds a model
// at another scale without touching the default (the page uses this for
// ?hours= / ?depth= preview links; the tests use it to check other scales).

(function (root) {
  'use strict';

  // ── Scale (Spec v2, Section 2) ──
  const DEFAULT_SCALE = {
    maxDepth: 15,      // MAX_DEPTH: inches at the top of every graph and the stake
    maxHours: 12,      // MAX_HOURS: hours across every graph; 10 is a one-line change
    startDepthMax: 6,  // START_DEPTH_MAX: starting depths run 0..this
  };
  const LABEL_EVERY = 3;          // axis + stake labels every 3 (and always the top line)
  const PEAK_TARGET = 0.4;        // generated rounds should peak at >= 40% of MAX_DEPTH...
  const PEAK_TARGET_SHARE = 0.8;  // ...in about this share of rounds (Levels 2-3, and Level 1 snow)
  // Scene bands as shares of the picture's height (Section 3a/3b). Depth 0
  // sits on the ground line, GROUND_STRIP above the bottom edge; MAX_DEPTH
  // sits at the top of the foreground band.
  // Phase 1A.2 (revised 11/27): the main picture is a landscape in
  // perspective — sky, distant hills, and a grass plane running to the
  // horizon. The precise reading happens in a zoomed MEASURING INSET in
  // the bottom-left corner. (The 20/15/65 "cutaway" bands are retired.)
  const SCENE_BANDS = { sky: 0.30, background: 0.25, foreground: 0.45 };
  // The small stake standing in the grass (main scene).
  const MINI_PX_PER_INCH = 6;     // ~90 px for 15 inches
  const MINI_STAKE_X = 0.66;      // share of scene width (kept right of the inset)
  const MINI_STAKE_ROW = 0.5;     // its base, as a share of the way from horizon to bottom edge
  // The measuring inset (bottom-left). PX_PER_INCH stays 16 so the Match
  // overlay's grid cells are 16 px; it shrinks only if the scene is too
  // short to hold it (INSET_MAX_H_SHARE of the scene height).
  const INSET_PX_PER_INCH = 16;
  const INSET_MARGIN = 8;         // gap from the scene's edges
  const INSET_PAD = { top: 12, left: 30, right: 8, bottom: 22 }; // left = stake numbers; bottom = soil strip + hour labels
  const INSET_STAKE_W = 8;
  const INSET_MAX_H_SHARE = 0.85;
  const GROUND_STRIP = 0.05;      // (unused by the landscape; kept for older callers)
  // Sky changes (sunrise, clouds rolling in) ease over this many hours,
  // centred on the boundary between two pieces.
  const SKY_EASE_H = 1;

  // ── Fixed teaching constants (independent of scale) ──
  // Allowed snowing rates, as exact (rise, run) pairs so every corner
  // lands on a whole hour AND a whole inch (hours are always a multiple of
  // run). Decimals are never stored/compared; only these integer pairs exist.
  const SNOW_RATES = [
    [1, 3], [1, 2], [2, 3], [1, 1], [3, 2], [2, 1], [3, 1],
  ];
  // Melting: whole-number rates only (v1 decision), run always 1.
  const MELT_RATES = [
    [-1, 1], [-2, 1], [-3, 1],
  ];
  const MAX_SEGMENTS = 3;
  const CLOUDY_HOUR_CHOICES = [1, 2, 3, 4];
  const SNOW_MULTIPLIER_CHOICES = [1, 2, 3, 4]; // hours = run * multiplier

  // ── Small RNG helpers (seedable, so tests are reproducible) ──
  // Mulberry32 — tiny, fast, good enough for non-cryptographic variety.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function randInt(rng, min, max) { return min + Math.floor(rng() * (max - min + 1)); }

  // ── Wording (always "a inch(es) every b hour(s)" — never a decimal) ──
  function pluralize(n, word) {
    if (n === 1) return `${n} ${word}`;
    return `${n} ${word}${/(ch|sh|s|x)$/.test(word) ? 'es' : 's'}`; // inch -> inches
  }

  function rateLabel(rise, run, weather) {
    const absRise = Math.abs(rise);
    const verb = weather === 'sun' ? 'melts' : 'snows';
    if (run === 1) return `${verb} ${pluralize(absRise, 'inch')} every hour`;
    return `${verb} ${pluralize(absRise, 'inch')} every ${pluralize(run, 'hour')}`;
  }

  // ── Scale-free forecast helpers ──
  function segmentDelta(seg) {
    if (seg.weather === 'cloudy') return 0;
    return seg.rise * (seg.hours / seg.run);
  }
  function segmentRate(seg) {
    return seg.weather === 'cloudy' ? 0 : seg.rise / seg.run;
  }
  function forecastPoints(forecast) {
    const points = [{ t: 0, d: forecast.start }];
    let t = 0, d = forecast.start;
    for (const seg of forecast.segments) {
      t += seg.hours;
      d += segmentDelta(seg);
      points.push({ t, d });
    }
    return points;
  }
  function forecastTotalHours(forecast) {
    return forecast.segments.reduce((sum, s) => sum + s.hours, 0);
  }
  function peakOf(forecast) {
    return Math.max(...forecastPoints(forecast).map(p => p.d));
  }
  function cloneForecast(f) {
    return { start: f.start, segments: f.segments.map(s => Object.assign({}, s)) };
  }
  function pointsKey(points) {
    return points.map(p => `${p.t}:${p.d}`).join('|');
  }
  function slopeOf(seg) {
    if (seg.weather === 'cloudy') return 0;
    return seg.rise / seg.run;
  }

  // ── Plain-English story, in the style of the v1 spec's example ──
  // forecastStoryParts splits it by piece (1A.3, Section 2): the starting
  // depth sentence, then one sentence per weather piece, so the page can
  // color each piece's sentence with that piece's color.
  function forecastStoryParts(forecast) {
    const start = `There ${forecast.start === 1 ? 'is' : 'are'} ${pluralize(forecast.start, 'inch')} of snow on the ground.`;
    const pieces = forecast.segments.map((seg, i) => {
      let text;
      if (seg.weather === 'cloudy') {
        text = `Then it's cloudy for ${pluralize(seg.hours, 'hour')}.`;
      } else if (seg.weather === 'snow') {
        const every = seg.run === 1 ? 'every hour' : `every ${pluralize(seg.run, 'hour')}`; // never "every 1 hour"
        text = `Then it snows ${pluralize(seg.rise, 'inch')} ${every} for ${pluralize(seg.hours, 'hour')}.`;
      } else {
        text = `Then the sun comes out and the snow melts ${pluralize(Math.abs(seg.rise), 'inch')} every hour for ${pluralize(seg.hours, 'hour')}.`;
      }
      // The first weather line doesn't want a leading "Then".
      if (i === 0) { text = text.replace(/^Then /, ''); text = text.charAt(0).toUpperCase() + text.slice(1); }
      return text;
    });
    return { start, pieces };
  }
  function forecastStory(forecast) {
    const p = forecastStoryParts(forecast);
    return [p.start].concat(p.pieces).join(' ');
  }

  // Which piece is happening at hour t (a boundary hour belongs to the
  // piece that just ended). Returns { seg, index } or null with no pieces.
  function weatherAt(forecast, t) {
    const segs = forecast.segments;
    if (!segs.length) return null;
    let t0 = 0;
    for (let i = 0; i < segs.length; i++) {
      const end = t0 + segs[i].hours;
      if (t <= end || i === segs.length - 1) return { seg: segs[i], index: i };
      t0 = end;
    }
    return null;
  }

  // ── Smooth weather blends for the scene (Phase 1A.2, Section 4) ──
  // valueOf(seg) gives each piece a target in [0, 1]. The blend holds that
  // value in the middle of a piece and eases (smoothstep) to the next
  // piece's value over SKY_EASE_H hours centred on the boundary, so
  // scrubbing, hovering and playing all move the sky the same way.
  function smoothstep(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function blendAt(forecast, t, valueOf) {
    const segs = forecast.segments;
    if (!segs.length) return 0;
    let v = valueOf(segs[0]), b = 0;
    for (let i = 0; i < segs.length - 1; i++) {
      b += segs[i].hours;
      const delta = valueOf(segs[i + 1]) - valueOf(segs[i]);
      if (delta) v += delta * smoothstep((t - (b - SKY_EASE_H / 2)) / SKY_EASE_H);
    }
    return Math.max(0, Math.min(1, v));
  }
  // 0 = no sun, 1 = sun fully out.
  function skyLevel(forecast, t) { return blendAt(forecast, t, s => (s.weather === 'sun' ? 1 : 0)); }
  // 0 = clear, 1 = fully clouded over (snowing or cloudy).
  function cloudLevel(forecast, t) { return blendAt(forecast, t, s => (s.weather === 'sun' ? 0 : 1)); }

  // Day or night for a round, tied to its seed so a replay looks the same.
  function sceneTypeFor(seed) {
    return makeRng((seed >>> 0) ^ 0x5eed5eed)() < 0.5 ? 'night' : 'day';
  }

  // Where two graphs first part ways. Corners are on whole hours, so both
  // are straight between whole hours: they agree on [k, k+1] exactly when
  // they agree at k and k+1. Returns null if they never differ; otherwise
  // { hour } where the split starts and { pieceIndex } of `truth` there.
  function firstSplit(truth, other) {
    const end = Math.max(forecastTotalHours(truth), forecastTotalHours(other));
    const at = (f, t) => (t > forecastTotalHours(f) ? NaN : depthOnLine(f, t));
    const same = t => { const a = at(truth, t), b = at(other, t); return a === b || Math.abs(a - b) < 1e-9; };
    let hour = null;
    if (!same(0)) hour = 0;
    else for (let k = 0; k < end; k++) if (!same(k + 1)) { hour = k; break; }
    if (hour === null) return null;
    const w = weatherAt(truth, Math.min(hour + 0.5, forecastTotalHours(truth)));
    return { hour, pieceIndex: w ? w.index : null };
  }
  // Depth on the forecast's own line (no clamping) — for comparing graphs.
  function depthOnLine(f, t) {
    let d = f.start, t0 = 0;
    for (const seg of f.segments) {
      if (t <= t0 + seg.hours) return d + segmentRate(seg) * (t - t0);
      d += segmentDelta(seg); t0 += seg.hours;
    }
    return d;
  }

  // ── Piece colors (1A.3, Section 2) ──
  // ONE place to change them: the page copies these into --piece-1..3.
  // Chosen for colorblind safety (teal / orchid / honey): the three stay
  // apart under protanopia and deuteranopia, and each reads at 4.5:1 or
  // better as text on its page theme (checked in snowModel.test.mjs).
  // `scene` = on the measuring inset (always a dark-ish backdrop).
  const PIECE_COLORS = {
    dark:  ['#6fe0d0', '#e86ce8', '#d4b04a'],
    light: ['#2d766f', '#5b1f86', '#6b4a08'],
    scene: ['#6fe0d0', '#f07ff0', '#e2bf55'],
  };
  const pieceColorVar = i => `--piece-${(i % PIECE_COLORS.dark.length) + 1}`;

  // ── Fractions (hover pins, rates): never decimals ──
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; }
  function reduceFrac(n, d) { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); return [n / g, d / g]; }
  // value -> [numerator, denominator] with the smallest denominator <= maxDen
  // that represents it exactly (to 1e-6), or null.
  function asFraction(v, maxDen) {
    maxDen = maxDen || 12;
    for (let den = 1; den <= maxDen; den++) {
      const num = Math.round(v * den);
      if (Math.abs(num / den - v) < 1e-6) return reduceFrac(num, den);
    }
    return null;
  }
  const VULGAR = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/5': '⅕', '2/5': '⅖', '3/5': '⅗', '4/5': '⅘',
    '1/6': '⅙', '5/6': '⅚', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞' };
  // 3.333.. -> "3⅓", 0.5 -> "½", 4 -> "4", 1.142857 -> "1 1/7". Mixed numbers,
  // never decimals (spec 4b). Negative values get a true minus sign.
  function formatMixed(v) {
    const f = asFraction(v, 12);
    if (!f) return (Math.round(v * 100) / 100).toString(); // not expected on this grid
    const [n, d] = f;
    const sign = n < 0 ? '−' : '';
    const an = Math.abs(n);
    if (d === 1) return sign + an;
    const whole = Math.floor(an / d), rem = an % d;
    const frac = VULGAR[`${rem}/${d}`] || ` ${rem}/${d}`;
    return sign + (whole ? `${whole}${frac}` : frac.trim());
  }
  // A rate as a slope fraction: "1/3", "3", "−2", "3/2" (improper on purpose).
  function formatRate(rise, run) {
    const [n, d] = reduceFrac(rise, run);
    const sign = n < 0 ? '−' : '';
    return d === 1 ? `${sign}${Math.abs(n)}` : `${sign}${Math.abs(n)}/${d}`;
  }

  // ── Pieces as straight spans (1A.3, Sections 2–3) ──
  // rise/run is the piece's OWN step in lowest terms (cloudy = 0 over 1).
  function pieceSpans(forecast) {
    const out = [];
    let t = 0, d = forecast.start;
    forecast.segments.forEach((seg, index) => {
      const [rise, run] = seg.weather === 'cloudy' ? [0, 1] : reduceFrac(seg.rise, seg.run);
      const d1 = d + segmentDelta(seg);
      out.push({ index, t0: t, t1: t + seg.hours, d0: d, d1, rise, run, rate: rise / run, weather: seg.weather });
      t += seg.hours; d = d1;
    });
    return out;
  }
  // The piece the dot is in at hour t (a boundary belongs to the piece that
  // just ended; hour 0 belongs to piece 0). -1 with no pieces.
  function pieceIndexAt(forecast, t) { const w = weatherAt(forecast, t); return w ? w.index : -1; }

  // ── describeDifference (1A.3, Section 3) ──
  // Where and how `mine` (the student's graph or story) differs from
  // `truth`. Compares the pieces in order; returns null when the two are
  // the same GRAPH. kind:
  //   'start'  — different depth at hour 0
  //   'slope'  — a piece with the same direction but a different rate
  //   'shape'  — a piece going a different direction (cloudy drawn as
  //              melting, melting drawn as snowing, ...); shown as slopes
  //   'length' — same rate, but the piece ends at a different hour
  // pieceIndex/hour = the first piece that differs and the hour it starts.
  // mine/truth carry the numbers to show: { start } for 'start', otherwise
  // that piece's span { t0, t1, d0, d1, rise, run, rate }.
  // swapped = the rise and run are exchanged (a flipped rate).
  function describeDifference(mine, truth) {
    if (!firstSplit(truth, mine)) return null;
    if (Math.abs(mine.start - truth.start) > 1e-9) {
      return { kind: 'start', pieceIndex: null, hour: 0, mine: { start: mine.start }, truth: { start: truth.start } };
    }
    const A = pieceSpans(mine), B = pieceSpans(truth);
    const n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const a = A[i], b = B[i];
      if (!a || !b) {
        // One graph has run out of pieces: it stops early (or runs long).
        const last = a || A[A.length - 1], other = b || B[B.length - 1];
        return { kind: 'length', pieceIndex: Math.min(i, Math.max(A.length, B.length) - 1), hour: (a || b).t0,
          mine: Object.assign({}, a || last, { end: A[A.length - 1].t1 }),
          truth: Object.assign({}, b || other, { end: B[B.length - 1].t1 }), stopsEarly: !a };
      }
      if (Math.abs(a.rate - b.rate) > 1e-9) {
        const kind = Math.sign(a.rate) !== Math.sign(b.rate) ? 'shape' : 'slope';
        const swapped = a.rise !== 0 && b.rise !== 0 && Math.abs(a.rise) === b.run && a.run === Math.abs(b.rise);
        return { kind, pieceIndex: i, hour: b.t0, mine: a, truth: b, swapped };
      }
      if (Math.abs(a.t1 - b.t1) > 1e-9) {
        return { kind: 'length', pieceIndex: i, hour: b.t0, mine: Object.assign({ end: a.t1 }, a), truth: Object.assign({ end: b.t1 }, b), stopsEarly: false };
      }
    }
    return null;
  }
  // "up 3 inches every 1 hour (3 in/hr)" — the step for one piece, in the
  // rise/run words the staircases use.
  function stepWords(p) {
    if (p.rise === 0) return 'flat: no change (0 in/hr)';
    const dir = p.rise > 0 ? 'up' : 'down';
    return `${dir} ${pluralize(Math.abs(p.rise), 'inch')} every ${pluralize(p.run, 'hour')} (${formatRate(p.rise, p.run)} in/hr)`;
  }
  // Two lines for the difference panel. who = { mine: 'Your graph', truth: 'The story' }.
  function differenceLines(diff, who) {
    if (!diff) return [];
    who = who || { mine: 'Your graph', truth: 'The story' };
    if (diff.kind === 'start') return [`${who.mine} starts at ${formatMixed(diff.mine.start)}.`, `${who.truth} starts at ${formatMixed(diff.truth.start)}.`];
    if (diff.kind === 'length') return [`${who.mine}: piece ${diff.pieceIndex + 1} ends at hour ${formatMixed(diff.mine.end)}.`, `${who.truth}: piece ${diff.pieceIndex + 1} ends at hour ${formatMixed(diff.truth.end)}.`];
    return [`${who.mine}: ${stepWords(diff.mine)}.`, `${who.truth}: ${stepWords(diff.truth)}.`];
  }
  // One plain sentence naming the mistake, from the difference itself.
  function differenceSentence(diff) {
    if (!diff) return '';
    if (diff.kind === 'start') return 'Check how much snow was already on the ground at hour 0.';
    if (diff.kind === 'length') return diff.stopsEarly ? 'The graph has to go all the way to the end of the story.' : `Check how long piece ${diff.pieceIndex + 1} lasts.`;
    if (diff.kind === 'shape') return 'Snowing goes up, cloudy stays flat, and melting goes down.';
    if (diff.swapped) return 'The rise and the run are swapped: the inches go up, the hours go across.';
    return 'Same direction, different rate. Compare the inches (rise) with the hours (run).';
  }

  // A drawing (corner points, left to right) as a forecast: weather from
  // the sign of each piece's slope, rate = rise/run in lowest terms.
  function drawingToForecast(points) {
    const segments = [];
    for (let k = 1; k < points.length; k++) {
      const dt = points[k].t - points[k - 1].t, dd = points[k].d - points[k - 1].d;
      if (dd === 0) { segments.push({ weather: 'cloudy', hours: dt }); continue; }
      const [rise, run] = reduceFrac(dd, dt);
      segments.push({ weather: dd > 0 ? 'snow' : 'sun', rise, run, hours: dt });
    }
    return { start: points.length ? points[0].d : 0, segments };
  }

  // ── Scoring / medals (localStorage, device-only, no logins) ──
  // 1A.3, Section 4: each challenge mode has its OWN score, streak, best
  // streak, level and level progress, in one JSON key per mode. The medal
  // is derived from the best streak (3 bronze, 5 silver, 10 gold), so it
  // is never lost. Explorer has no score.
  const SCORE_MODES = ['match', 'story', 'draw'];
  const modeKey = m => `sc_mode_${m}`;
  const lastItemKey = m => `sc_last_item_${m}`;
  // The keys used before 1A.3 (Match the Forecast only). Migrated into
  // mode 'match' once, then removed.
  const LEGACY_KEYS = {
    score: 'sc_score', streak: 'sc_streak', bestMedal: 'sc_best_medal', lastKey: 'sc_last_item',
    level: 'sc_level', levelProgress: 'sc_level_progress',
  };
  const STORAGE_KEYS = LEGACY_KEYS; // old name, kept for older callers
  // Level N = forecasts with N weather pieces. Moving up takes
  // LEVEL_UP_STREAK first-try-correct rounds in a row at the current level.
  // A wrong first pick resets that count but never drops a level.
  const MAX_LEVEL = MAX_SEGMENTS;
  const LEVEL_UP_STREAK = 3;
  const MEDAL_THRESHOLDS = [[10, 'gold'], [5, 'silver'], [3, 'bronze']];
  const MEDAL_RANK = { none: 0, bronze: 1, silver: 2, gold: 3 };
  const MEDAL_STREAK = { none: 0, bronze: 3, silver: 5, gold: 10 };

  function safeGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable — scoring just won't persist */ }
  }
  function safeRemove(key) { try { localStorage.removeItem(key); } catch (e) {} }
  const int = (v, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt; };
  function medalForStreak(streak) {
    for (const [threshold, name] of MEDAL_THRESHOLDS) {
      if (streak >= threshold) return name;
    }
    return 'none';
  }
  // Old single-mode data -> mode 'match'. The old data stored the best
  // MEDAL, not the best streak, so the best streak starts at that medal's
  // threshold (or the current streak, if higher).
  function migrateLegacy() {
    if (safeGet(modeKey('match'), null) !== null) return;
    const had = Object.values(LEGACY_KEYS).some(k => safeGet(k, null) !== null);
    if (!had) return;
    const streak = Math.max(0, int(safeGet(LEGACY_KEYS.streak, '0'), 0));
    const state = {
      score: Math.max(0, int(safeGet(LEGACY_KEYS.score, '0'), 0)),
      streak,
      bestStreak: Math.max(streak, MEDAL_STREAK[safeGet(LEGACY_KEYS.bestMedal, 'none')] || 0),
      level: Math.min(MAX_LEVEL, Math.max(1, int(safeGet(LEGACY_KEYS.level, '1'), 1))),
      levelProgress: Math.max(0, int(safeGet(LEGACY_KEYS.levelProgress, '0'), 0)),
    };
    safeSet(modeKey('match'), JSON.stringify(state));
    const last = safeGet(LEGACY_KEYS.lastKey, null);
    if (last !== null) safeSet(lastItemKey('match'), last);
    Object.values(LEGACY_KEYS).forEach(safeRemove);
  }
  function getScoreState(mode) {
    mode = mode || 'match';
    if (mode === 'match') migrateLegacy();
    let raw = null;
    try { raw = JSON.parse(safeGet(modeKey(mode), 'null')); } catch (e) { raw = null; }
    raw = raw || {};
    const streak = Math.max(0, int(raw.streak, 0));
    const state = {
      score: Math.max(0, int(raw.score, 0)),
      streak,
      bestStreak: Math.max(streak, int(raw.bestStreak, 0)),
      level: Math.min(MAX_LEVEL, Math.max(1, int(raw.level, 1))),
      levelProgress: Math.max(0, int(raw.levelProgress, 0)),
    };
    state.bestMedal = medalForStreak(state.bestStreak);
    return state;
  }
  // Records one round's outcome for that mode; returns the new state plus
  // whether a new medal or level was just reached (so the UI can say so once).
  function recordAttempt(firstTryCorrect, mode) {
    mode = mode || 'match';
    const state = getScoreState(mode);
    const prevMedal = state.bestMedal;
    if (firstTryCorrect) {
      state.score += 1;
      state.streak += 1;
    } else {
      state.score = Math.max(0, state.score - 2);
      state.streak = 0;
    }
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.bestMedal = medalForStreak(state.bestStreak);
    const earnedNewMedal = MEDAL_RANK[state.bestMedal] > MEDAL_RANK[prevMedal];
    const newMedal = state.bestMedal;

    let leveledUp = false;
    if (firstTryCorrect && state.level < MAX_LEVEL) {
      state.levelProgress += 1;
      if (state.levelProgress >= LEVEL_UP_STREAK) { state.level += 1; state.levelProgress = 0; leveledUp = true; }
    } else if (!firstTryCorrect) {
      state.levelProgress = 0;
    }
    const { score, streak, bestStreak, level, levelProgress } = state;
    safeSet(modeKey(mode), JSON.stringify({ score, streak, bestStreak, level, levelProgress }));
    return { state, earnedNewMedal, newMedal, leveledUp };
  }
  // resetProgress() clears every mode (and the old keys); resetProgress('story') clears one.
  function resetProgress(mode) {
    if (mode) { safeRemove(modeKey(mode)); safeRemove(lastItemKey(mode)); return; }
    SCORE_MODES.forEach(m => { safeRemove(modeKey(m)); safeRemove(lastItemKey(m)); });
    Object.values(LEGACY_KEYS).forEach(safeRemove);
  }
  function rememberLastItem(key, mode) { safeSet(lastItemKey(mode || 'match'), key); }
  function wasLastItem(key, mode) { return safeGet(lastItemKey(mode || 'match'), null) === key; }

  // One short feedback line per Match the Forecast rule — names the mistake.
  const RULE_FEEDBACK = {
    rateFlipped: 'That graph has the rate flipped — check which number is the rise (inches) and which is the run (hours).',
    wrongStart: 'That graph starts at the wrong depth — check how much snow was already on the ground at hour 0.',
    cloudyAsMelt: "Cloudy means no new snow, so the depth stays the same — it shouldn't go down.",
    meltSignOrLength: 'Melting means the depth goes down, not up — or check how long that piece really lasts.',
  };

  // ══════════════════════════════════════════════════════════════
  // Everything below depends on the scale.
  // ══════════════════════════════════════════════════════════════
  function createModel(cfg) {
    cfg = cfg || {};
    const posInt = (v, dflt) => (Number.isInteger(v) && v > 0 ? v : dflt);
    const MAX_DEPTH = posInt(cfg.maxDepth, DEFAULT_SCALE.maxDepth);
    const MAX_HOURS = posInt(cfg.maxHours, DEFAULT_SCALE.maxHours);
    const START_DEPTH_MAX = Math.min(MAX_DEPTH, Number.isInteger(cfg.startDepthMax) ? cfg.startDepthMax : DEFAULT_SCALE.startDepthMax);
    const clampDepth = d => Math.max(0, Math.min(MAX_DEPTH, d));

    // Axis / stake labels: every LABEL_EVERY, and always the top line.
    function axisLabels(max) {
      const out = [];
      for (let v = 0; v <= max; v += LABEL_EVERY) out.push(v);
      if (out[out.length - 1] !== max) out.push(max);
      return out;
    }

    // ── depthAt: THE depth at any real hour t (Section 4a) ──
    // Scene, graph cursor, slider and link line all read this so they can
    // never disagree. Depth never goes below 0 (a melt that runs out leaves
    // bare ground, and later snow piles up from 0) or above MAX_DEPTH.
    // t outside [0, total] is clamped to the ends.
    function depthAt(forecast, t) {
      const total = forecastTotalHours(forecast);
      t = Math.max(0, Math.min(total, t));
      let d = clampDepth(forecast.start), t0 = 0;
      for (const seg of forecast.segments) {
        const end = t0 + seg.hours;
        const rate = segmentRate(seg);
        if (t <= end) return clampDepth(d + rate * (t - t0));
        d = clampDepth(d + rate * seg.hours);
        t0 = end;
      }
      return d;
    }

    // ── Scene geometry (Phase 1A.2 revised, Section 1) ──
    // Main bands, the small stake in the grass (MINI_PX_PER_INCH), and the
    // measuring inset (PX_PER_INCH). Each stake has ONE linear scale; the
    // inset's is also the Match overlay's and the link line's.
    // The top-level groundY / pxPerInch / yForDepth are the inset's (the
    // reading stake), so older callers keep working.
    function sceneLayout(width, height) {
      const skyBottom = height * SCENE_BANDS.sky;
      const fgTop = height * (SCENE_BANDS.sky + SCENE_BANDS.background); // the horizon
      // Inset: stake numbers | stake | MAX_HOURS columns of one inch each.
      const natural = INSET_PAD.top + MAX_DEPTH * INSET_PX_PER_INCH + INSET_PAD.bottom;
      const k = Math.min(1, (height * INSET_MAX_H_SHARE) / natural);
      const px = INSET_PX_PER_INCH * k;
      const iw = INSET_PAD.left + INSET_STAKE_W + MAX_HOURS * px + INSET_PAD.right;
      const ih = INSET_PAD.top + MAX_DEPTH * px + INSET_PAD.bottom;
      const ix = INSET_MARGIN, iy = height - ih - INSET_MARGIN;
      const groundY = iy + ih - INSET_PAD.bottom;
      const stakeX = ix + INSET_PAD.left + INSET_STAKE_W / 2;
      const inset = {
        x: ix, y: iy, w: iw, h: ih, pxPerInch: px, groundY, stakeX,
        ovX0: stakeX + INSET_STAKE_W / 2, ovW: MAX_HOURS * px,
        yForDepth: d => groundY - d * px,
      };
      // Small stake in the grass, right of the inset.
      // Plant it lower on short scenes so its top stays below the horizon.
      const miniBaseY = Math.min(height - 6, Math.max(fgTop + (height - fgTop) * MINI_STAKE_ROW, fgTop + MAX_DEPTH * MINI_PX_PER_INCH + 8));
      const miniX = Math.max(width * MINI_STAKE_X, ix + iw + 30);
      const mini = { x: miniX, baseY: miniBaseY, pxPerInch: MINI_PX_PER_INCH, yForDepth: d => miniBaseY - d * MINI_PX_PER_INCH };
      return {
        width, height, skyBottom, fgTop, horizonY: fgTop, inset, mini,
        groundY, pxPerInch: px, yForDepth: inset.yForDepth,
      };
    }

    // ── Hills and trees (Section 4b) ──
    // Each hill is one ridge function; the page draws the hill by sampling
    // it, and every tree's base is placed a little BELOW the ridge at its x
    // (the hill drawn after it covers the bottom of the trunk), so trees
    // always look rooted. Fixed seed: the same trees every time.
    function sceneHills(width, height) {
      const skyBottom = height * SCENE_BANDS.sky;
      const fgTop = height * (SCENE_BANDS.sky + SCENE_BANDS.background);
      const band = fgTop - skyBottom;
      const far = { base: skyBottom + band * 0.42, amp: band * 0.26, phase: 0.6 };
      const near = { base: skyBottom + band * 0.78, amp: band * 0.16, phase: 2.1 };
      const ridgeOf = hl => x => hl.base - hl.amp * (0.6 * Math.sin(hl.phase + (x / width) * 5) + 0.4 * Math.cos(hl.phase * 1.7 + (x / width) * 3));
      const ridgeFar = ridgeOf(far), ridgeNear = ridgeOf(near);
      const rng = makeRng(4242);
      const trees = [];
      const plant = (hill, ridge, count, size) => {
        for (let i = 0; i < count; i++) {
          const x = width * (0.06 + 0.88 * (i + 0.2 + rng() * 0.6) / count);
          const sz = size * (0.8 + rng() * 0.4);
          trees.push({ hill, x, size: sz, baseY: ridge(x) + sz * 0.14, ridgeY: ridge(x) });
        }
      };
      plant('far', ridgeFar, 5, band * 0.26);
      plant('near', ridgeNear, 3, band * 0.4);
      return { skyBottom, fgTop, band, ridgeFar, ridgeNear, trees };
    }

    // ── Generator ──
    // Builds one valid forecast: whole-hour/whole-inch corners, depth always
    // in [0, MAX_DEPTH], melting never generated down to exactly 0, total
    // time <= MAX_HOURS, and no two adjacent pieces with the same slope
    // (which would draw as one straight line with no visible corner).
    function generateForecast(rng, opts) {
      rng = rng || makeRng(Date.now() ^ (Math.random() * 1e9));
      opts = opts || {};
      const numSegments = opts.numSegments || randInt(rng, 1, MAX_SEGMENTS);
      // About PEAK_TARGET_SHARE of rounds must reach the peak target, so
      // graphs use the taller scale. Applies at Levels 2-3, and to a
      // Level 1 round that is a single snowing piece (Karl, 11/26).
      const wantPeak = rng() < PEAK_TARGET_SHARE;
      const target = PEAK_TARGET * MAX_DEPTH;
      let fallback = null;

      for (let attempt = 0; attempt < 400; attempt++) {
        const start = randInt(rng, 0, START_DEPTH_MAX);
        const segments = [];
        let depth = start;
        let hoursLeft = MAX_HOURS;
        let ok = true;
        for (let i = 0; i < numSegments; i++) {
          const seg = buildOneSegment(rng, depth, hoursLeft, segments[i - 1]);
          if (!seg) { ok = false; break; }
          segments.push(seg);
          depth += segmentDelta(seg);
          hoursLeft -= seg.hours;
        }
        if (!ok || segments.length !== numSegments) continue;
        const f = { start, segments };
        const peakApplies = numSegments >= 2 || segments[0].weather === 'snow';
        if (wantPeak && peakApplies && peakOf(f) < target) { fallback = fallback || f; continue; }
        return f;
      }
      if (fallback) return fallback;
      throw new Error('generateForecast: could not build a valid forecast after 400 attempts — constraints may be too tight for numSegments=' + numSegments);
    }

    function buildOneSegment(rng, depth, hoursLeft, prevSeg) {
      const choices = ['snow', 'cloudy', 'sun'].filter(w => w !== 'sun' || depth > 0);
      for (let tries = 0; tries < 30; tries++) {
        const weather = pick(rng, choices);

        if (weather === 'cloudy') {
          const options = CLOUDY_HOUR_CHOICES.filter(h => h <= hoursLeft);
          if (!options.length) continue;
          const seg = { weather: 'cloudy', hours: pick(rng, options) };
          if (prevSeg && slopeOf(prevSeg) === 0) continue; // two flats in a row
          return seg;
        }

        if (weather === 'snow') {
          const [rise, run] = pick(rng, SNOW_RATES);
          const maxK = Math.floor(hoursLeft / run);
          const options = SNOW_MULTIPLIER_CHOICES.filter(k => k <= maxK && (depth + rise * k) <= MAX_DEPTH);
          if (!options.length) continue;
          const seg = { weather: 'snow', rise, run, hours: run * pick(rng, options) };
          if (prevSeg && slopeOf(prevSeg) === slopeOf(seg)) continue;
          return seg;
        }

        // Melting must stay strictly above 0 in generated rounds (v1 rule):
        // the most hours k with depth - |rise| * k > 0.
        const [rise] = pick(rng, MELT_RATES); // run is always 1
        const maxK = Math.min(hoursLeft, Math.ceil(depth / Math.abs(rise)) - 1);
        const options = SNOW_MULTIPLIER_CHOICES.filter(k => k <= maxK);
        if (!options.length) continue;
        const seg = { weather: 'sun', rise, run: 1, hours: pick(rng, options) };
        if (prevSeg && slopeOf(prevSeg) === slopeOf(seg)) continue;
        return seg;
      }
      return null;
    }

    // ── Distractors for Match the Forecast ──
    // Each differs from the correct forecast in exactly one rule (the v1
    // spec's four named mistakes) and is tagged with that rule.
    const DISTRACTOR_RULES = {
      rateFlipped(rng, f) {
        const idxs = f.segments.map((s, i) => i).filter(i => f.segments[i].weather !== 'cloudy');
        if (!idxs.length) return null;
        const i = pick(rng, idxs);
        const out = cloneForecast(f);
        const seg = out.segments[i];
        // "1 inch every 3 hours" drawn as "3 inches every hour".
        const sign = seg.rise < 0 ? -1 : 1;
        out.segments[i] = Object.assign({}, seg, { rise: sign * seg.run, run: Math.abs(seg.rise) });
        return { forecast: out, rule: 'rateFlipped', segmentIndex: i };
      },
      wrongStart(rng, f) {
        const options = [];
        for (let v = 0; v <= START_DEPTH_MAX; v++) if (v !== f.start) options.push(v);
        if (!options.length) return null;
        const out = cloneForecast(f);
        out.start = pick(rng, options);
        return { forecast: out, rule: 'wrongStart', segmentIndex: null };
      },
      cloudyAsMelt(rng, f) {
        const idxs = f.segments.map((s, i) => i).filter(i => f.segments[i].weather === 'cloudy');
        if (!idxs.length) return null;
        const i = pick(rng, idxs);
        let depthBefore = f.start;
        for (let j = 0; j < i; j++) depthBefore += segmentDelta(f.segments[j]);
        const hours = f.segments[i].hours;
        const maxMag = Math.max(1, Math.min(3, Math.floor(depthBefore / Math.max(1, hours))));
        const out = cloneForecast(f);
        out.segments[i] = { weather: 'sun', rise: -maxMag, run: 1, hours };
        return { forecast: out, rule: 'cloudyAsMelt', segmentIndex: i };
      },
      meltSignOrLength(rng, f) {
        const sunIdxs = f.segments.map((s, i) => i).filter(i => f.segments[i].weather === 'sun');
        if (sunIdxs.length && rng() < 0.5) {
          const i = pick(rng, sunIdxs);
          const out = cloneForecast(f);
          out.segments[i] = Object.assign({}, out.segments[i], { rise: Math.abs(out.segments[i].rise) }); // melting drawn going up
          return { forecast: out, rule: 'meltSignOrLength', segmentIndex: i };
        }
        // Fallback: one snow/sun piece one run too long or too short. All
        // four graphs in a round end at the same hour (Phase 1A.2 default),
        // so the difference moves into another piece; a forecast with no
        // piece that can absorb it can't use this mistake.
        const rateIdxs = f.segments.map((s, i) => i).filter(i => f.segments[i].weather !== 'cloudy');
        if (!rateIdxs.length) return null;
        const i = pick(rng, rateIdxs);
        const out = cloneForecast(f);
        const seg = out.segments[i];
        const delta = rng() < 0.5 ? seg.run : -seg.run;
        if (seg.hours + delta <= 0) return null;
        out.segments[i] = Object.assign({}, seg, { hours: seg.hours + delta });
        const absorbers = out.segments.map((s, j) => j).filter(j => {
          if (j === i) return false;
          const s = out.segments[j], h = s.hours - delta;
          return h >= 1 && (s.weather === 'cloudy' || h % s.run === 0);
        });
        if (!absorbers.length) return null;
        const j = pick(rng, absorbers);
        out.segments[j] = Object.assign({}, out.segments[j], { hours: out.segments[j].hours - delta });
        return { forecast: out, rule: 'meltSignOrLength', segmentIndex: i };
      },
    };

    // A wrong answer must obey the same drawing rules as a real forecast,
    // or a student can rule it out on sight without reading the story.
    function isPlausibleGraph(points) {
      return points.every(p => Number.isInteger(p.t) && Number.isInteger(p.d) && p.d >= 0 && p.d <= MAX_DEPTH)
        && points[points.length - 1].t <= MAX_HOURS;
    }

    function buildMatchItem(rng, correct, count) {
      count = count || 3;
      const correctPoints = forecastPoints(correct);
      const seenKeys = new Set([pointsKey(correctPoints)]);
      const distractors = [];
      // Pass 1: one distractor per rule (shuffled). Pass 2: rules that apply
      // may contribute a second, different graph when others don't apply.
      const order = Object.keys(DISTRACTOR_RULES).sort(() => rng() - 0.5);
      for (let pass = 0; pass < 2 && distractors.length < count; pass++) {
        for (const rule of order) {
          if (distractors.length >= count) break;
          for (let tries = 0; tries < 15; tries++) {
            const result = DISTRACTOR_RULES[rule](rng, correct);
            if (!result) break;
            const pts = forecastPoints(result.forecast);
            if (!isPlausibleGraph(pts)) continue;
            if (pts[pts.length - 1].t !== correctPoints[correctPoints.length - 1].t) continue; // all four end together
            const key = pointsKey(pts);
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            distractors.push(Object.assign({ points: pts }, result));
            break;
          }
        }
      }
      if (distractors.length < count) return null; // caller regenerates `correct`

      const choices = [{ forecast: correct, points: correctPoints, isCorrect: true }]
        .concat(distractors.map(d => ({ forecast: d.forecast, points: d.points, rule: d.rule, segmentIndex: d.segmentIndex, isCorrect: false })));
      for (let i = choices.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [choices[i], choices[j]] = [choices[j], choices[i]];
      }
      return { correct, story: forecastStory(correct), choices };
    }

    // ══════════════════════════════════════════════════════════════
    // MATCH THE STORY (1A.3, Section 6; spec 6b)
    // A graph is given; four stories; the student picks the one that
    // matches. Each distractor changes ONE piece (or the start) and is
    // tagged with its teaching intent. Karl (11/27): all four end at the
    // same hour; the start is usually the same; piece lengths are usually
    // the same, so the usual test is the SLOPE. A length change appears at
    // most once per round, and only from Level 2.
    // ══════════════════════════════════════════════════════════════
    const STORY_INTENT_WEIGHTS = {
      1: [['readSlope', 0.5], ['readRatePair', 0.2], ['readShape', 0.15], ['readStart', 0.15]],
      2: [['readSlope', 0.5], ['readRatePair', 0.25], ['readShape', 0.25]],
    };
    const STORY_SIDE_INTENT_CHANCE = 0.35;   // chance the third distractor tests something else
    function pickWeighted(rng, pairs) {
      let r = rng() * pairs.reduce((a, p) => a + p[1], 0);
      for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
      return pairs[pairs.length - 1][0];
    }
    const idxsWhere = (f, test) => f.segments.map((s, i) => i).filter(i => test(f.segments[i]));
    const STORY_MUTATIONS = {
      // A near-miss rate on one snowing or melting piece (same hours).
      readSlope(rng, f) {
        const idxs = idxsWhere(f, s => s.weather !== 'cloudy');
        if (!idxs.length) return null;
        const i = pick(rng, idxs), seg = f.segments[i];
        const pool = (seg.weather === 'snow' ? SNOW_RATES : MELT_RATES)
          .filter(([r, u]) => !(r === seg.rise && u === seg.run) && seg.hours % u === 0)
          .sort((a, b) => Math.abs(a[0] / a[1] - seg.rise / seg.run) - Math.abs(b[0] / b[1] - seg.rise / seg.run));
        if (!pool.length) return null;
        const [rise, run] = pick(rng, pool.slice(0, 3)); // one of the closest rates
        const out = cloneForecast(f); out.segments[i] = Object.assign({}, seg, { rise, run });
        return { forecast: out, intent: 'readSlope', segmentIndex: i };
      },
      // Rise and run swapped on one snowing piece ("1 inch every 3 hours"
      // vs "3 inches every hour").
      readRatePair(rng, f) {
        const idxs = idxsWhere(f, s => s.weather === 'snow' && s.rise !== s.run && s.hours % s.rise === 0);
        if (!idxs.length) return null;
        const i = pick(rng, idxs), seg = f.segments[i];
        const out = cloneForecast(f); out.segments[i] = Object.assign({}, seg, { rise: seg.run, run: seg.rise });
        return { forecast: out, intent: 'readRatePair', segmentIndex: i };
      },
      // Snow vs cloudy vs melt on one piece.
      readShape(rng, f) {
        const i = randInt(rng, 0, f.segments.length - 1), seg = f.segments[i];
        const out = cloneForecast(f);
        if (seg.weather === 'cloudy') {
          out.segments[i] = rng() < 0.5 ? { weather: 'sun', rise: -1, run: 1, hours: seg.hours } : { weather: 'snow', rise: 1, run: 1, hours: seg.hours };
        } else if (seg.weather === 'sun') {
          out.segments[i] = rng() < 0.5 ? Object.assign({}, seg, { weather: 'snow', rise: Math.abs(seg.rise) }) : { weather: 'cloudy', hours: seg.hours };
        } else {
          out.segments[i] = rng() < 0.6 ? { weather: 'cloudy', hours: seg.hours } : { weather: 'sun', rise: -seg.rise, run: 1, hours: seg.hours };
          if (out.segments[i].weather === 'sun' && seg.run !== 1) return null; // melts are whole inches per hour
        }
        return { forecast: out, intent: 'readShape', segmentIndex: i };
      },
      readStart(rng, f) {
        const options = [];
        for (let v = Math.max(0, f.start - 3); v <= Math.min(START_DEPTH_MAX, f.start + 3); v++) if (v !== f.start) options.push(v);
        if (!options.length) return null;
        const out = cloneForecast(f); out.start = pick(rng, options);
        return { forecast: out, intent: 'readStart', segmentIndex: null };
      },
      // One piece a run longer or shorter; another piece absorbs the hours,
      // so the story still ends at the same hour.
      readDuration(rng, f) {
        if (f.segments.length < 2) return null;
        const i = randInt(rng, 0, f.segments.length - 1), seg = f.segments[i];
        const step = seg.weather === 'cloudy' ? 1 : seg.run;
        const delta = rng() < 0.5 ? step : -step;
        if (seg.hours + delta < 1) return null;
        const out = cloneForecast(f);
        out.segments[i] = Object.assign({}, seg, { hours: seg.hours + delta });
        const absorbers = out.segments.map((s, j) => j).filter(j => {
          if (j === i) return false;
          const h = out.segments[j].hours - delta;
          return h >= 1 && (out.segments[j].weather === 'cloudy' || h % out.segments[j].run === 0);
        });
        if (!absorbers.length) return null;
        const j = pick(rng, absorbers);
        out.segments[j] = Object.assign({}, out.segments[j], { hours: out.segments[j].hours - delta });
        return { forecast: out, intent: 'readDuration', segmentIndex: i };
      },
    };
    // Two neighbouring pieces with the same slope draw as ONE line: the
    // story would have a piece the graph can't show. Not allowed.
    function hasMergedPieces(f) {
      for (let i = 1; i < f.segments.length; i++) if (Math.abs(slopeOf(f.segments[i]) - slopeOf(f.segments[i - 1])) < 1e-9) return true;
      return false;
    }
    function buildStoryItem(rng, correct, count) {
      count = count || 3;
      const level = correct.segments.length;
      const correctPoints = forecastPoints(correct);
      const endHour = correctPoints[correctPoints.length - 1].t;
      const seen = new Set([pointsKey(correctPoints)]);
      const main = pickWeighted(rng, STORY_INTENT_WEIGHTS[Math.min(level, 2)]);
      // Slots: a pure start item at Level 1 tests only the start; otherwise
      // two distractors on the main intent and a third that may test
      // something else (at most one start change, at most one length change).
      let slots;
      if (main === 'readStart') slots = ['readStart', 'readStart', 'readStart'];
      else {
        let side = main;
        if (rng() < STORY_SIDE_INTENT_CHANCE) {
          const sides = ['readSlope', 'readRatePair', 'readShape', 'readStart'];
          if (level >= 2) sides.push('readDuration');
          side = pick(rng, sides.filter(x => x !== main));
        }
        slots = [main, main, side];
      }
      const fallbacks = ['readSlope', 'readRatePair', 'readShape'];
      const distractors = [];
      for (const slot of slots) {
        let got = null;
        for (const intent of [slot].concat(fallbacks)) {
          for (let tries = 0; tries < 20 && !got; tries++) {
            const r = STORY_MUTATIONS[intent](rng, correct);
            if (!r) break;
            const pts = forecastPoints(r.forecast);
            if (!isPlausibleGraph(pts) || pts[pts.length - 1].t !== endHour || hasMergedPieces(r.forecast)) continue;
            const key = pointsKey(pts);
            if (seen.has(key)) continue;
            seen.add(key);
            got = Object.assign({ points: pts }, r);
          }
          if (got) break;
        }
        if (!got) return null; // caller regenerates `correct`
        distractors.push(got);
      }
      const choices = [{ forecast: correct, points: correctPoints, isCorrect: true, intent: null, segmentIndex: null }]
        .concat(distractors.map(d => ({ forecast: d.forecast, points: d.points, isCorrect: false, intent: d.intent, segmentIndex: d.segmentIndex })));
      choices.forEach(c => { c.parts = forecastStoryParts(c.forecast); c.story = forecastStory(c.forecast); });
      for (let i = choices.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [choices[i], choices[j]] = [choices[j], choices[i]];
      }
      return { correct, story: forecastStory(correct), choices, mainIntent: main };
    }

    // ══════════════════════════════════════════════════════════════
    // DRAW THE FORECAST (1A.3, Section 7; spec 6d)
    // Compare as FUNCTIONS at every whole hour: corners are on whole hours,
    // so two graphs are the same exactly when they agree at every whole
    // hour from 0 to the end. Extra points along a straight piece never
    // make it wrong; a graph that stops early is wrong.
    // rule: null | 'wrongStart' | 'wrongRate' | 'meltAsSnow' | 'wrongShape'
    //       | 'pieceLength' | 'stopsEarly' | 'tooLong'
    // ══════════════════════════════════════════════════════════════
    function gradeDrawing(points, forecast) {
      if (!points || points.length < 2) return { correct: false, firstHour: 0, rule: 'stopsEarly', diff: null };
      const mine = drawingToForecast(points);
      const total = forecastTotalHours(forecast), myTotal = points[points.length - 1].t;
      let firstHour = null;
      for (let h = 0; h <= total; h++) {
        if (h > myTotal || Math.abs(depthOnLine(mine, h) - depthOnLine(forecast, h)) > 1e-9) { firstHour = h; break; }
      }
      if (firstHour === null && myTotal > total) firstHour = total;
      if (firstHour === null) return { correct: true, firstHour: null, rule: null, diff: null };
      const diff = describeDifference(mine, forecast);
      let rule = 'wrongRate';
      if (myTotal < total && (!diff || diff.kind === 'length') && firstHour > myTotal) rule = 'stopsEarly';
      else if (myTotal > total && firstHour === total) rule = 'tooLong';
      else if (diff && diff.kind === 'start') rule = 'wrongStart';
      else if (diff && diff.kind === 'length') rule = diff.stopsEarly ? 'stopsEarly' : 'pieceLength';
      else if (diff && diff.kind === 'shape') rule = diff.truth.rate < 0 && diff.mine.rate > 0 ? 'meltAsSnow' : 'wrongShape';
      return { correct: false, firstHour, rule, diff };
    }
    // The Draw the Forecast drawing, piece by piece (1A.3, Section 7).
    // state.points: corners in order; piece k runs points[k] -> points[k+1].
    // Pieces are drawn in order: piece 0 needs a start (at hour 0) and an
    // end; every later piece starts where the previous one ended, so only
    // its end is clicked. Redrawing piece k clears it and every piece after
    // it (their starts depend on it). Returns { state, error }.
    //   action: { type: 'click', point } | { type: 'redraw', piece } | { type: 'undo' } | { type: 'clear' }
    const DRAW_ERRORS = {
      start0: 'Start at hour 0.',
      forward: 'Time only moves forward. Click to the right of your start.',
      done: 'Every piece is drawn. Click a piece of the story to redraw it.',
      tooFar: `The graph stops at hour ${MAX_HOURS}.`,
    };
    function drawStep(state, action, pieceCount) {
      const pts = state.points.slice();
      const err = e => ({ state, error: e });
      if (action.type === 'clear') return { state: { points: [] }, error: null };
      if (action.type === 'undo') return { state: { points: pts.length === 2 ? [] : pts.slice(0, -1) }, error: null };
      if (action.type === 'redraw') {
        const k = action.piece;
        return { state: { points: k === 0 ? [] : pts.slice(0, Math.min(pts.length, k + 1)) }, error: null };
      }
      const p = action.point;
      if (p.t > MAX_HOURS) return err('tooFar');
      if (!pts.length) return p.t === 0 ? { state: { points: [p] }, error: null } : err('start0');
      if (pts.length - 1 >= pieceCount) return err('done');
      if (p.t <= pts[pts.length - 1].t) return err('forward');
      return { state: { points: pts.concat([p]) }, error: null };
    }
    // Which piece the next click draws (or pieceCount when all are drawn).
    function activeDrawPiece(state) { return Math.max(0, state.points.length - 1); }

    // Hover snaps to the nearest WHOLE hour, clamped to [0, total] (spec 4b).
    function snapHour(t, total) { return Math.max(0, Math.min(Math.floor(total), Math.round(t))); }

    // ══════════════════════════════════════════════════════════════
    // EXPLORER RULES — which choices the builder may offer.
    // Karl's decisions (11/26): depth stays in [0, MAX_DEPTH] at every
    // corner (melting may reach exactly 0, "All melted"); an hour option is
    // only OFFERED if the piece itself fits; a choice that would break a
    // LATER piece is shown but greyed out with a reason. Later pieces are
    // never changed behind the student's back.
    // ══════════════════════════════════════════════════════════════
    const WEATHERS = ['snow', 'cloudy', 'sun'];
    const ratesFor = w => (w === 'snow' ? SNOW_RATES : w === 'sun' ? MELT_RATES : []);
    const isAllowedRate = (w, r, u) => ratesFor(w).some(([a, b]) => a === r && b === u);

    // First problem in a forecast, or null if it is fine.
    // kind: 'start' | 'shape' | 'time' | 'over' | 'under'
    function checkForecast(f) {
      if (!Number.isInteger(f.start) || f.start < 0 || f.start > START_DEPTH_MAX) return { index: -1, kind: 'start' };
      if (!f.segments.length || f.segments.length > MAX_SEGMENTS) return { index: f.segments.length, kind: 'shape' };
      let t = 0, d = f.start;
      for (let i = 0; i < f.segments.length; i++) {
        const s = f.segments[i];
        if (!WEATHERS.includes(s.weather) || !Number.isInteger(s.hours) || s.hours < 1) return { index: i, kind: 'shape' };
        if (s.weather !== 'cloudy' && (!isAllowedRate(s.weather, s.rise, s.run) || s.hours % s.run)) return { index: i, kind: 'shape' };
        t += s.hours;
        if (t > MAX_HOURS) return { index: i, kind: 'time' };
        d += segmentDelta(s);
        if (d > MAX_DEPTH) return { index: i, kind: 'over' };
        if (d < 0) return { index: i, kind: 'under' };
      }
      return null;
    }

    const laterReason = kind => (kind === 'over'
      ? `That would push a later piece past ${MAX_DEPTH} inches`
      : 'That would make a later piece melt below 0 inches');

    function withPiece(f, i, seg) { const g = cloneForecast(f); g.segments[i] = seg; return g; }
    function hoursLeftFor(f, i) {
      return MAX_HOURS - f.segments.reduce((sum, s, j) => (j === i ? sum : sum + s.hours), 0);
    }
    function makePiece(weather, rise, run, hours) {
      return weather === 'cloudy' ? { weather, hours } : { weather, rise, run, hours };
    }
    // ok: fine. own: breaks itself (not offered). Otherwise breaks a later piece.
    function evalPiece(f, i, seg) {
      const p = checkForecast(withPiece(f, i, seg));
      if (!p) return { ok: true, own: false };
      return { ok: false, own: p.index <= i, kind: p.kind };
    }

    // Hour options for piece i with this weather and rate. Only hours where
    // the piece itself fits are listed; ok:false means a later piece breaks.
    function hourOptions(f, i, weather, rise, run) {
      const step = weather === 'cloudy' ? 1 : run;
      const out = [];
      for (let h = step; h <= hoursLeftFor(f, i); h += step) {
        const e = evalPiece(f, i, makePiece(weather, rise, run, h));
        if (e.own) continue;
        out.push({ value: h, ok: e.ok, reason: e.ok ? '' : laterReason(e.kind) });
      }
      return out;
    }

    function rateOptions(f, i, weather) {
      return ratesFor(weather).map(([r, u]) => {
        const hrs = hourOptions(f, i, weather, r, u);
        if (hrs.some(h => h.ok)) return { rise: r, run: u, ok: true, reason: '' };
        let reason;
        if (u > hoursLeftFor(f, i)) reason = 'Not enough hours left for that rate';
        else if (!hrs.length) reason = weather === 'snow' ? `That would go past ${MAX_DEPTH} inches` : 'That would melt below 0 inches';
        else reason = hrs[0].reason;
        return { rise: r, run: u, ok: false, reason };
      });
    }

    function pickHours(valid, want) {
      if (valid.includes(want)) return want;
      const below = valid.filter(h => h <= want);
      return below.length ? below[below.length - 1] : valid[0];
    }

    // The piece to use when the student picks `weather` (or a rate) for
    // piece i: keeps the preferred rate and hours when they fit, otherwise
    // the closest allowed ones. Changes only piece i. Null if impossible.
    function bestPiece(f, i, weather, prefer) {
      prefer = prefer || {};
      const wantHours = prefer.hours || (weather === 'cloudy' ? 2 : 3);
      if (weather === 'cloudy') {
        const hrs = hourOptions(f, i, 'cloudy').filter(o => o.ok).map(o => o.value);
        return hrs.length ? makePiece('cloudy', 0, 1, pickHours(hrs, wantHours)) : null;
      }
      const order = ratesFor(weather).slice();
      if (isAllowedRate(weather, prefer.rise, prefer.run)) order.unshift([prefer.rise, prefer.run]);
      for (const [r, u] of order) {
        const hrs = hourOptions(f, i, weather, r, u).filter(o => o.ok).map(o => o.value);
        if (hrs.length) return makePiece(weather, r, u, pickHours(hrs, wantHours));
      }
      return null;
    }

    function weatherOptions(f, i) {
      return WEATHERS.map(w => {
        if (bestPiece(f, i, w, f.segments[i])) return { value: w, ok: true, reason: '' };
        // Why not: a later piece, or no room for this piece itself.
        for (const [r, u] of ratesFor(w).length ? ratesFor(w) : [[0, 1]]) {
          const hrs = hourOptions(f, i, w, r, u);
          if (hrs.length) return { value: w, ok: false, reason: hrs[0].reason };
        }
        return { value: w, ok: false, reason: w === 'snow' ? `There's no room left below ${MAX_DEPTH} inches` : 'There is no snow left to melt' };
      });
    }

    function startOptions(f) {
      const out = [];
      for (let v = 0; v <= START_DEPTH_MAX; v++) {
        const p = checkForecast(Object.assign(cloneForecast(f), { start: v }));
        out.push({ value: v, ok: !p, reason: !p ? '' : p.kind === 'over'
          ? `That would push a piece past ${MAX_DEPTH} inches`
          : 'That would make a piece melt below 0 inches' });
      }
      return out;
    }

    function removeCheck(f, i) {
      if (f.segments.length <= 1) return { ok: false, reason: 'A story needs at least one piece' };
      const g = cloneForecast(f); g.segments.splice(i, 1);
      const p = checkForecast(g);
      if (!p) return { ok: true, reason: '' };
      return { ok: false, reason: p.kind === 'over'
        ? `Removing this would push a later piece past ${MAX_DEPTH} inches`
        : 'Removing this would make a later piece melt below 0 inches' };
    }

    // The piece "+ Add" appends, or why it can't.
    function addCheck(f) {
      if (f.segments.length >= MAX_SEGMENTS) return { ok: false, reason: `A story can have up to ${MAX_SEGMENTS} pieces` };
      if (hoursLeftFor(f, -1) < 1) return { ok: false, reason: `All ${MAX_HOURS} hours are used` };
      const g = cloneForecast(f); const n = g.segments.length;
      g.segments.push(makePiece('cloudy', 0, 1, 1));
      const piece = bestPiece(g, n, 'snow', { rise: 1, run: 3, hours: 3 }) || bestPiece(g, n, 'cloudy', { hours: 2 });
      return piece ? { ok: true, reason: '', piece } : { ok: false, reason: 'There is no room for another piece' };
    }

    return {
      // scale
      MAX_DEPTH, MAX_HOURS, MAX_TOTAL_HOURS: MAX_HOURS /* old name */, START_DEPTH_MAX,
      LABEL_EVERY, PEAK_TARGET, PEAK_TARGET_SHARE, SCENE_BANDS, GROUND_STRIP,
      MINI_PX_PER_INCH, INSET_PX_PER_INCH, sceneHills,
      SNOW_RATES, MELT_RATES, MAX_SEGMENTS, MAX_LEVEL, LEVEL_UP_STREAK,
      // forecasts
      makeRng, rateLabel, segmentDelta, segmentRate, forecastPoints, forecastTotalHours, peakOf,
      forecastStory, weatherAt, depthAt, axisLabels, sceneLayout,
      generateForecast, buildMatchItem, isPlausibleGraph, RULE_FEEDBACK, pointsKey, cloneForecast,
      forecastStoryParts, pieceSpans, pieceIndexAt, describeDifference, differenceLines, differenceSentence, stepWords,
      formatMixed, formatRate, asFraction, reduceFrac, drawingToForecast, gradeDrawing, snapHour, drawStep, activeDrawPiece, DRAW_ERRORS,
      buildStoryItem, STORY_INTENT_WEIGHTS, STORY_SIDE_INTENT_CHANCE, PIECE_COLORS, pieceColorVar, depthOnLine,
      // explorer rules
      checkForecast, hourOptions, rateOptions, weatherOptions, startOptions, bestPiece,
      removeCheck, addCheck, hoursLeftFor, evalPiece,
      // scoring
      getScoreState, recordAttempt, medalForStreak, rememberLastItem, wasLastItem, resetProgress,
      SCORE_MODES, MEDAL_THRESHOLDS, MEDAL_STREAK, STORAGE_KEYS, LEGACY_KEYS,
      // scene (Phase 1A.2)
      SKY_EASE_H, blendAt, skyLevel, cloudLevel, sceneTypeFor, firstSplit,
      // other scales
      createModel, DEFAULT_SCALE,
    };
  }

  const SnowModel = createModel();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SnowModel;
  } else {
    root.SnowModel = SnowModel;
  }
})(typeof window !== 'undefined' ? window : globalThis);
