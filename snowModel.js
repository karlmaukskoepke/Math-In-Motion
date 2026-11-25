// ── SNOW CHALLENGE — forecast model ──
// Pure logic, no DOM: generates/validates weather "forecasts" (a starting
// depth + 1-3 piecewise-linear segments), turns them into plain-English
// stories and (t, depth) point arrays for drawing, builds distractor
// forecasts for Match the Forecast, and tracks score/streak/medals.
// Loaded as a plain <script> in snow-challenge.html (attaches to
// `window.SnowModel`) and also `require()`-able from Node for the
// generator test script (see snowModel.test.mjs) — hence the dual
// export at the bottom instead of ES module syntax.

(function (root) {
  'use strict';

  // ── Constants ──
  // Allowed snowing rates, as exact (rise, run) pairs so every corner
  // lands on a whole hour AND a whole inch (hours must be a multiple of
  // run — see buildSegmentDepth below). Decimals are never stored/compared;
  // only these integer pairs exist.
  const SNOW_RATES = [
    [1, 3], [1, 2], [2, 3], [1, 1], [3, 2], [2, 1], [3, 1],
  ];

  // Melting rates — Karl's call (spec open question #1): whole-number
  // melts only for v1, no 1/2 option. run is always 1 here, which is
  // also why the phrasing below special-cases "melts" to never say
  // "every 1 hour" to a fraction — it's always "every hour".
  const MELT_RATES = [
    [-1, 1], [-2, 1], [-3, 1],
  ];

  const MAX_TOTAL_HOURS = 12;
  const MAX_DEPTH = 12;
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

  // ── Rate labels (always "a inch(es) every b hour(s)" — never a decimal) ──
  function pluralize(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

  function rateLabel(rise, run, weather) {
    const absRise = Math.abs(rise);
    const verb = weather === 'sun' ? 'melts' : 'snows';
    if (run === 1) return `${verb} ${pluralize(absRise, 'inch')} every hour`;
    return `${verb} ${pluralize(absRise, 'inch')} every ${pluralize(run, 'hour')}`;
  }

  // ── One segment's depth delta, guaranteed to land on a whole inch
  //    because hours is always constructed as a multiple of run. ──
  function segmentDelta(seg) {
    if (seg.weather === 'cloudy') return 0;
    return seg.rise * (seg.hours / seg.run);
  }

  // ── Build the (hour, depth) corner points for a whole forecast ──
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

  // ── Plain-English story, in the exact style the spec's example gives ──
  function forecastStory(forecast) {
    const parts = [];
    parts.push(`There ${forecast.start === 1 ? 'is' : 'are'} ${pluralize(forecast.start, 'inch')} of snow on the ground.`);
    for (const seg of forecast.segments) {
      if (seg.weather === 'cloudy') {
        parts.push(`Then it's cloudy for ${pluralize(seg.hours, 'hour')}.`);
      } else if (seg.weather === 'snow') {
        parts.push(`It snows ${pluralize(seg.rise, 'inch')} every ${pluralize(seg.run, 'hour')} for ${pluralize(seg.hours, 'hour')}.`);
      } else {
        parts.push(`Then the sun comes out and the snow melts ${pluralize(Math.abs(seg.rise), 'inch')} every hour for ${pluralize(seg.hours, 'hour')}.`);
      }
    }
    // First snow line doesn't want a leading "Then" — matches the spec example.
    if (parts[1]) parts[1] = parts[1].replace(/^Then /, '');
    return parts.join(' ');
  }

  // ── Generator ──
  // Builds one valid forecast: whole-hour/whole-inch corners, depth always
  // in [0, 12], melting never generated down to exactly 0, total time
  // <=12h, and no two adjacent segments with the same slope (which would
  // draw as one straight line with no visible corner — not a real "piece").
  function slopeOf(seg) {
    if (seg.weather === 'cloudy') return 0;
    return seg.rise / seg.run;
  }

  function generateForecast(rng, opts) {
    rng = rng || makeRng(Date.now() ^ (Math.random() * 1e9));
    opts = opts || {};
    const numSegments = opts.numSegments || randInt(rng, 1, MAX_SEGMENTS);

    for (let attempt = 0; attempt < 200; attempt++) {
      const start = randInt(rng, 0, 6);
      const segments = [];
      let depth = start;
      let hoursLeft = MAX_TOTAL_HOURS;
      let ok = true;

      for (let i = 0; i < numSegments; i++) {
        const seg = buildOneSegment(rng, depth, hoursLeft, segments[i - 1]);
        if (!seg) { ok = false; break; }
        segments.push(seg);
        depth += segmentDelta(seg);
        hoursLeft -= seg.hours;
      }

      if (ok && segments.length === numSegments) {
        return { start, segments };
      }
      // else retry with a fresh draw
    }
    throw new Error('generateForecast: could not build a valid forecast after 200 attempts — constraints may be too tight for numSegments=' + numSegments);
  }

  // Builds one segment given the running depth/hours budget and the
  // previous segment (to avoid a same-slope, corner-less repeat).
  function buildOneSegment(rng, depth, hoursLeft, prevSeg) {
    const choices = ['snow', 'cloudy', 'sun'].filter(w => w !== 'sun' || depth > 0);
    for (let tries = 0; tries < 30; tries++) {
      const weather = pick(rng, choices);

      if (weather === 'cloudy') {
        const maxH = Math.min(hoursLeft, Math.max(...CLOUDY_HOUR_CHOICES));
        const options = CLOUDY_HOUR_CHOICES.filter(h => h <= maxH);
        if (!options.length) continue;
        const seg = { weather: 'cloudy', hours: pick(rng, options) };
        if (prevSeg && slopeOf(prevSeg) === 0) continue; // two flats in a row
        return seg;
      }

      if (weather === 'snow') {
        const [rise, run] = pick(rng, SNOW_RATES);
        const maxK = Math.floor(Math.min(hoursLeft, MAX_TOTAL_HOURS) / run);
        const options = SNOW_MULTIPLIER_CHOICES.filter(k => k <= maxK && (depth + rise * k) <= MAX_DEPTH);
        if (!options.length) continue;
        const hours = run * pick(rng, options);
        const seg = { weather: 'snow', rise, run, hours };
        if (prevSeg && slopeOf(prevSeg) === slopeOf(seg)) continue;
        return seg;
      }

      // sun (melting) — must never reach exactly 0 (spec: generator must
      // not produce a melt-to-zero), so cap hours one multiplier short
      // of fully melting out.
      const [rise, run] = pick(rng, MELT_RATES); // run is always 1
      const maxFullMelt = Math.floor(depth / Math.abs(rise)); // hours that would reach depth 0 or below
      const maxK = Math.min(hoursLeft, maxFullMelt - 1); // stay strictly above 0
      const options = SNOW_MULTIPLIER_CHOICES.filter(k => k >= 1 && k <= maxK);
      if (!options.length) continue;
      const hours = pick(rng, options); // run === 1, so hours === multiplier
      const seg = { weather: 'sun', rise, run, hours };
      if (prevSeg && slopeOf(prevSeg) === slopeOf(seg)) continue;
      return seg;
    }
    return null;
  }

  // ── Distractor generation for Match the Forecast ──
  // Each distractor differs from the correct forecast in exactly one
  // rule, per the spec's four named mistakes. Returns up to `count`
  // distractor forecasts, each tagged with which rule it broke (useful
  // for the post-answer feedback line) — never mutates `correct`.
  function cloneForecast(f) {
    return { start: f.start, segments: f.segments.map(s => Object.assign({}, s)) };
  }

  function pointsKey(points) {
    return points.map(p => `${p.t}:${p.d}`).join('|');
  }

  const DISTRACTOR_RULES = {
    rateFlipped(rng, f) {
      const idxs = f.segments.map((s, i) => i).filter(i => f.segments[i].weather !== 'cloudy');
      if (!idxs.length) return null;
      const i = pick(rng, idxs);
      const out = cloneForecast(f);
      const seg = out.segments[i];
      // "1 inch every 3 hours" drawn as "3 inches every hour" — invert
      // the rise/run pair (sign of rise is preserved for melting).
      const sign = seg.rise < 0 ? -1 : 1;
      const newRise = sign * seg.run;
      const newRun = Math.abs(seg.rise);
      if (newRun === 0) return null;
      out.segments[i] = Object.assign({}, seg, { rise: newRise, run: newRun });
      return { forecast: out, rule: 'rateFlipped', segmentIndex: i };
    },

    wrongStart(rng, f) {
      const options = [0, 1, 2, 3, 4, 5, 6].filter(v => v !== f.start);
      if (!options.length) return null;
      const out = cloneForecast(f);
      out.start = pick(rng, options);
      return { forecast: out, rule: 'wrongStart', segmentIndex: null };
    },

    cloudyAsMelt(rng, f) {
      const idxs = f.segments.map((s, i) => i).filter(i => f.segments[i].weather === 'cloudy');
      if (!idxs.length) return null;
      const i = pick(rng, idxs);
      // Depth just before this segment, so the melt stays within bounds.
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
        const seg = out.segments[i];
        out.segments[i] = Object.assign({}, seg, { rise: Math.abs(seg.rise) }); // melting drawn going up
        return { forecast: out, rule: 'meltSignOrLength', segmentIndex: i };
      }
      // Fallback: shift a snow/sun segment's length by one run — "off by its run".
      const rateIdxs = f.segments.map((s, i) => i).filter(i => f.segments[i].weather !== 'cloudy');
      if (!rateIdxs.length) return null;
      const i = pick(rng, rateIdxs);
      const out = cloneForecast(f);
      const seg = out.segments[i];
      const delta = rng() < 0.5 ? seg.run : -seg.run;
      const newHours = seg.hours + delta;
      if (newHours <= 0) return null;
      out.segments[i] = Object.assign({}, seg, { hours: newHours });
      return { forecast: out, rule: 'meltSignOrLength', segmentIndex: i };
    },
  };

  function buildMatchItem(rng, correct, count) {
    count = count || 3;
    const correctPoints = forecastPoints(correct);
    const seenKeys = new Set([pointsKey(correctPoints)]);
    const ruleNames = Object.keys(DISTRACTOR_RULES);
    const distractors = [];

    // Try each rule (shuffled) until we have `count` distinct distractors.
    const order = ruleNames.slice().sort(() => rng() - 0.5);
    for (const rule of order) {
      if (distractors.length >= count) break;
      for (let tries = 0; tries < 15; tries++) {
        const result = DISTRACTOR_RULES[rule](rng, correct);
        if (!result) break; // this rule doesn't apply to this forecast at all
        const pts = forecastPoints(result.forecast);
        const key = pointsKey(pts);
        if (seenKeys.has(key)) continue; // collides with an existing choice, retry
        seenKeys.add(key);
        distractors.push(Object.assign({ points: pts }, result));
        break;
      }
    }

    if (distractors.length < count) {
      return null; // caller should regenerate `correct` and try again
    }

    const choices = [{ forecast: correct, points: correctPoints, isCorrect: true }]
      .concat(distractors.map(d => ({ forecast: d.forecast, points: d.points, rule: d.rule, segmentIndex: d.segmentIndex, isCorrect: false })));
    // Shuffle so the correct answer isn't always first.
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    return { correct, story: forecastStory(correct), choices };
  }

  // One short feedback line per rule, naming where the split happened —
  // not a generic "wrong answer".
  const RULE_FEEDBACK = {
    rateFlipped: 'That graph has the rate flipped — check which number is the rise (inches) and which is the run (hours).',
    wrongStart: 'That graph starts at the wrong depth — check how much snow was already on the ground at hour 0.',
    cloudyAsMelt: "Cloudy means no new snow, so the depth stays the same — it shouldn't go down.",
    meltSignOrLength: 'Melting means the depth goes down, not up — or check how long that piece really lasts.',
  };

  // ── Scoring / medals (localStorage, device-only, no logins) ──
  const STORAGE_KEYS = { score: 'sc_score', streak: 'sc_streak', bestMedal: 'sc_best_medal', lastKey: 'sc_last_item' };
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
    };
  }

  function medalForStreak(streak) {
    for (const [threshold, name] of MEDAL_THRESHOLDS) {
      if (streak >= threshold) return name;
    }
    return 'none';
  }

  // Records one attempt's outcome; returns the new state plus whether a
  // new medal was just earned (so the UI can celebrate it once).
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

    safeSet(STORAGE_KEYS.score, String(state.score));
    safeSet(STORAGE_KEYS.streak, String(state.streak));
    safeSet(STORAGE_KEYS.bestMedal, state.bestMedal);
    return { state, earnedNewMedal, newMedal };
  }

  function rememberLastItem(key) { safeSet(STORAGE_KEYS.lastKey, key); }
  function wasLastItem(key) { return safeGet(STORAGE_KEYS.lastKey, null) === key; }

  const SnowModel = {
    SNOW_RATES, MELT_RATES, MAX_TOTAL_HOURS, MAX_DEPTH, MAX_SEGMENTS,
    makeRng, rateLabel, segmentDelta, forecastPoints, forecastTotalHours,
    forecastStory, generateForecast, buildMatchItem, RULE_FEEDBACK,
    getScoreState, recordAttempt, medalForStreak, rememberLastItem, wasLastItem,
    pointsKey, cloneForecast,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SnowModel;
  } else {
    root.SnowModel = SnowModel;
  }
})(typeof window !== 'undefined' ? window : globalThis);
