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
  const SCENE_BANDS = { sky: 0.30, background: 0.20, foreground: 0.50 };
  const GROUND_STRIP = 0.06;

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
  function forecastStory(forecast) {
    const parts = [];
    parts.push(`There ${forecast.start === 1 ? 'is' : 'are'} ${pluralize(forecast.start, 'inch')} of snow on the ground.`);
    for (const seg of forecast.segments) {
      if (seg.weather === 'cloudy') {
        parts.push(`Then it's cloudy for ${pluralize(seg.hours, 'hour')}.`);
      } else if (seg.weather === 'snow') {
        const every = seg.run === 1 ? 'every hour' : `every ${pluralize(seg.run, 'hour')}`; // never "every 1 hour"
        parts.push(`Then it snows ${pluralize(seg.rise, 'inch')} ${every} for ${pluralize(seg.hours, 'hour')}.`);
      } else {
        parts.push(`Then the sun comes out and the snow melts ${pluralize(Math.abs(seg.rise), 'inch')} every hour for ${pluralize(seg.hours, 'hour')}.`);
      }
    }
    // First weather line doesn't want a leading "Then", and must start
    // with a capital once "Then " is stripped.
    if (parts[1]) {
      parts[1] = parts[1].replace(/^Then /, '');
      parts[1] = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
    }
    return parts.join(' ');
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

  // ── Scoring / medals (localStorage, device-only, no logins) ──
  const STORAGE_KEYS = {
    score: 'sc_score', streak: 'sc_streak', bestMedal: 'sc_best_medal', lastKey: 'sc_last_item',
    level: 'sc_level', levelProgress: 'sc_level_progress',
  };
  // Level N = forecasts with N weather pieces. Moving up takes
  // LEVEL_UP_STREAK first-try-correct rounds in a row at the current level.
  // A wrong first pick resets that count but never drops a level.
  const MAX_LEVEL = MAX_SEGMENTS;
  const LEVEL_UP_STREAK = 3;
  const MEDAL_THRESHOLDS = [[10, 'gold'], [5, 'silver'], [3, 'bronze']];
  const MEDAL_RANK = { none: 0, bronze: 1, silver: 2, gold: 3 };

  function safeGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable — scoring just won't persist */ }
  }
  function getScoreState() {
    return {
      score: parseInt(safeGet(STORAGE_KEYS.score, '0'), 10) || 0,
      streak: parseInt(safeGet(STORAGE_KEYS.streak, '0'), 10) || 0,
      bestMedal: safeGet(STORAGE_KEYS.bestMedal, 'none'),
      level: Math.min(MAX_LEVEL, Math.max(1, parseInt(safeGet(STORAGE_KEYS.level, '1'), 10) || 1)),
      levelProgress: parseInt(safeGet(STORAGE_KEYS.levelProgress, '0'), 10) || 0,
    };
  }
  function medalForStreak(streak) {
    for (const [threshold, name] of MEDAL_THRESHOLDS) {
      if (streak >= threshold) return name;
    }
    return 'none';
  }
  // Records one round's outcome; returns the new state plus whether a new
  // medal or level was just reached (so the UI can say so once).
  function recordAttempt(firstTryCorrect) {
    const state = getScoreState();
    if (firstTryCorrect) {
      state.score += 1;
      state.streak += 1;
    } else {
      state.score = Math.max(0, state.score - 2);
      state.streak = 0;
    }
    const newMedal = medalForStreak(state.streak);
    const earnedNewMedal = MEDAL_RANK[newMedal] > MEDAL_RANK[state.bestMedal];
    if (earnedNewMedal) state.bestMedal = newMedal;

    let leveledUp = false;
    if (firstTryCorrect && state.level < MAX_LEVEL) {
      state.levelProgress += 1;
      if (state.levelProgress >= LEVEL_UP_STREAK) { state.level += 1; state.levelProgress = 0; leveledUp = true; }
    } else if (!firstTryCorrect) {
      state.levelProgress = 0;
    }

    safeSet(STORAGE_KEYS.score, String(state.score));
    safeSet(STORAGE_KEYS.streak, String(state.streak));
    safeSet(STORAGE_KEYS.bestMedal, state.bestMedal);
    safeSet(STORAGE_KEYS.level, String(state.level));
    safeSet(STORAGE_KEYS.levelProgress, String(state.levelProgress));
    return { state, earnedNewMedal, newMedal, leveledUp };
  }
  function resetProgress() {
    Object.values(STORAGE_KEYS).forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  }
  function rememberLastItem(key) { safeSet(STORAGE_KEYS.lastKey, key); }
  function wasLastItem(key) { return safeGet(STORAGE_KEYS.lastKey, null) === key; }

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

    // ── Scene geometry (Section 3b) ──
    // One linear scale shared by the stake, the snow top and the link line.
    function sceneLayout(width, height) {
      const skyBottom = height * SCENE_BANDS.sky;
      const fgTop = height * (SCENE_BANDS.sky + SCENE_BANDS.background);
      const groundY = height * (1 - GROUND_STRIP);
      const pxPerInch = (groundY - fgTop) / MAX_DEPTH;
      return {
        width, height, skyBottom, fgTop, groundY, pxPerInch,
        yForDepth: d => groundY - d * pxPerInch,
      };
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
        // Fallback: one snow/sun piece one run too long or too short.
        const rateIdxs = f.segments.map((s, i) => i).filter(i => f.segments[i].weather !== 'cloudy');
        if (!rateIdxs.length) return null;
        const i = pick(rng, rateIdxs);
        const out = cloneForecast(f);
        const seg = out.segments[i];
        const newHours = seg.hours + (rng() < 0.5 ? seg.run : -seg.run);
        if (newHours <= 0) return null;
        out.segments[i] = Object.assign({}, seg, { hours: newHours });
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
      SNOW_RATES, MELT_RATES, MAX_SEGMENTS, MAX_LEVEL, LEVEL_UP_STREAK,
      // forecasts
      makeRng, rateLabel, segmentDelta, segmentRate, forecastPoints, forecastTotalHours, peakOf,
      forecastStory, weatherAt, depthAt, axisLabels, sceneLayout,
      generateForecast, buildMatchItem, isPlausibleGraph, RULE_FEEDBACK, pointsKey, cloneForecast,
      // explorer rules
      checkForecast, hourOptions, rateOptions, weatherOptions, startOptions, bestPiece,
      removeCheck, addCheck, hoursLeftFor, evalPiece,
      // scoring
      getScoreState, recordAttempt, medalForStreak, rememberLastItem, wasLastItem, resetProgress,
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
