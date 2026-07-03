/*
  motionTracker.js — shared HSV ball-tracking logic for Math In Motion.

  Extracted from quickstart.html so Quick Start and Full Lab (and any future
  page) share ONE copy of this pipeline. Ball tracking is an active, ongoing
  project ("destiny" — Karl's words) — future fixes should only need to
  happen here, not in every page that uses it.

  This is the ORIGINAL, validated formula (fixed REFINE_R = CELL*1.5,
  ~86px @720p). It reliably tracks 2.5-7ft and recovers from occlusion in
  1-3s. It DOES clip the circle at very close range (<2.5ft) — a known,
  deferred cosmetic issue, not a functional one. The adaptive widen
  attempted on 2026-07-01 caused two regressions (distance range collapsed
  to <2ft, off-center circles) and was reverted. Do not reintroduce
  history/position-based prediction — see Math In Motion handoff doc.
*/

const MotionTracker = (() => {

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 0) {
      if      (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * (((b - r) / d) + 2);
      else                h = 60 * (((r - g) / d) + 4);
      if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }

  // ── COLOR PICK (tap on video) ──────────────────────────────────────
  // ctx: 2D context of a canvas already containing the current video frame.
  // nx, ny: tap point in that canvas's pixel coordinates.
  // Returns { r, g, b, h, s, v, satMin, valMin, keptCount }.
  function pickBallColor(ctx, nx, ny, vw, vh) {
    // STAGE 1: tight center patch for the seed hue.
    const centerPatch = ctx.getImageData(Math.max(0, nx - 4), Math.max(0, ny - 4), 9, 9).data;
    let cr = 0, cg = 0, cb = 0, cn = 0;
    for (let i = 0; i < centerPatch.length; i += 4) { cr += centerPatch[i]; cg += centerPatch[i+1]; cb += centerPatch[i+2]; cn++; }
    cr = Math.round(cr / cn); cg = Math.round(cg / cn); cb = Math.round(cb / cn);
    const centerHsv = rgbToHsv(cr, cg, cb);

    // STAGE 2: wide ring sample around the tap to learn the ball's real
    // sat/val range (bright center, darker/desaturated edge).
    const RING_RADIUS = 50, RING_SAMPLES = 24, HUE_GATE = 18;
    const boxSize = RING_RADIUS * 2 + 10;
    const bx0 = Math.max(0, nx - boxSize / 2), by0 = Math.max(0, ny - boxSize / 2);
    const boxW = Math.min(vw - bx0, boxSize), boxH = Math.min(vh - by0, boxSize);
    let ringImg;
    try { ringImg = ctx.getImageData(Math.round(bx0), Math.round(by0), Math.round(boxW), Math.round(boxH)); }
    catch (e) { ringImg = null; }

    let satMin = centerHsv.s, satMax = centerHsv.s, valMin = centerHsv.v, valMax = centerHsv.v;
    let keptCount = 0;

    if (ringImg) {
      const rd = ringImg.data, rw = ringImg.width, rh = ringImg.height;
      for (let i = 0; i < RING_SAMPLES; i++) {
        const ang = (i / RING_SAMPLES) * Math.PI * 2;
        for (const frac of [0.4, 0.7, 1.0]) {
          const sx = Math.round((nx - bx0) + Math.cos(ang) * RING_RADIUS * frac);
          const sy = Math.round((ny - by0) + Math.sin(ang) * RING_RADIUS * frac);
          if (sx < 0 || sx >= rw || sy < 0 || sy >= rh) continue;
          const idx = (sy * rw + sx) * 4;
          const hsv = rgbToHsv(rd[idx], rd[idx+1], rd[idx+2]);
          let hd = Math.abs(hsv.h - centerHsv.h); if (hd > 180) hd = 360 - hd;
          if (hd > HUE_GATE) continue;
          satMin = Math.min(satMin, hsv.s); satMax = Math.max(satMax, hsv.s);
          valMin = Math.min(valMin, hsv.v); valMax = Math.max(valMax, hsv.v);
          keptCount++;
        }
      }
    }

    if (keptCount < 6) {
      satMin = Math.max(0.08, centerHsv.s * 0.5);
      valMin = Math.max(0.05, centerHsv.v * 0.5);
    } else {
      satMin = Math.max(0.05, satMin * 0.55);
      valMin = Math.max(0.04, valMin * 0.45);
    }

    return { r: cr, g: cg, b: cb, h: centerHsv.h, s: centerHsv.s, v: centerHsv.v, satMin, valMin, keptCount };
  }

  // ── CIRCLE FIT ────────────────────────────────────────────────────
  // Scores a point set against a candidate circle using inlier consistency
  // minus outlier penalty. Validated against synthetic ball/face/occlusion
  // test data.
  function fitCircle(pts) {
    if (pts.length < 6) return null;
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    const cx0 = sx / pts.length, cy0 = sy / pts.length;
    const dists = pts.map(p => Math.hypot(p.x - cx0, p.y - cy0)).sort((a, b) => a - b);
    const medianDist = dists[Math.floor(dists.length / 2)];
    if (medianDist < 2) return null;
    let best = null;
    const centerSteps = [-0.3, -0.15, 0, 0.15, 0.3];
    const radiusFactors = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35];
    for (const dxF of centerSteps) {
      for (const dyF of centerSteps) {
        const tcx = cx0 + dxF * medianDist;
        const tcy = cy0 + dyF * medianDist;
        for (const rF of radiusFactors) {
          const r = medianDist * rF;
          if (r < 3) continue;
          let inside = 0, outside = 0;
          for (const p of pts) {
            const d = Math.hypot(p.x - tcx, p.y - tcy);
            if (d <= r) inside++; else outside++;
          }
          const score = (inside / pts.length) - (outside / pts.length) * 1.2;
          if (!best || score > best.score) best = { cx: tcx, cy: tcy, r, score };
        }
      }
    }
    return best;
  }

  // ── BALL DETECTION (per frame) ──────────────────────────────────────
  // pixels: Uint8ClampedArray from getImageData. vw/vh: frame dimensions.
  // ballColor: result of pickBallColor(). No history/position memory —
  // fully re-derived from this frame alone every call.
  // Returns { found, cx, cy, r, fitScore, density, clusterCount }.
  function detectBall(pixels, vw, vh, ballColor) {
    const targetHue = ballColor.h, STEP = 4;
    const pickedSat = ballColor.s ?? 0.5, pickedVal = ballColor.v ?? 0.5;
    const HUE_TOL = pickedSat < 0.35 ? 34 : pickedSat < 0.6 ? 26 : 20;
    const SAT_MIN = ballColor.satMin ?? Math.max(0.08, pickedSat * 0.35);
    const VAL_MIN = ballColor.valMin ?? Math.max(0.05, pickedVal * 0.18);

    const matchPts = [];
    for (let py = STEP; py < vh - STEP; py += STEP) {
      for (let px = STEP; px < vw - STEP; px += STEP) {
        const idx = (py * vw + px) * 4;
        const { h, s, v } = rgbToHsv(pixels[idx], pixels[idx+1], pixels[idx+2]);
        if (s < SAT_MIN || v < VAL_MIN) continue;
        let hd = Math.abs(h - targetHue); if (hd > 180) hd = 360 - hd;
        if (hd <= HUE_TOL) matchPts.push({ x: px, y: py });
      }
    }

    // PASS 1: grid vote to find candidate regions
    const CELL = Math.round(Math.min(vw, vh) * 0.08);
    const gw = Math.ceil(vw / CELL), gh = Math.ceil(vh / CELL);
    const grid = new Int16Array(gw * gh);
    for (const pt of matchPts) {
      const gx = Math.floor(pt.x / CELL), gy = Math.floor(pt.y / CELL);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx >= 0 && nx < gw && ny >= 0 && ny < gh) grid[ny * gw + nx]++;
      }
    }
    const candidates = [];
    const gridCopy = grid.slice();
    for (let i = 0; i < 8; i++) {
      let bestIdx = -1, bestCnt = 0;
      for (let j = 0; j < gridCopy.length; j++) {
        if (gridCopy[j] > bestCnt) { bestCnt = gridCopy[j]; bestIdx = j; }
      }
      if (bestIdx < 0 || bestCnt < 3) break;
      const gx = bestIdx % gw, gy = Math.floor(bestIdx / gw);
      const cx = (gx + 0.5) * CELL, cy = (gy + 0.5) * CELL;
      candidates.push({ cx, cy });
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx >= 0 && nx < gw && ny >= 0 && ny < gh) gridCopy[ny * gw + nx] = 0;
      }
    }

    // PASS 2: fixed-radius gather + density scoring per candidate
    const REFINE_R = CELL * 1.5;
    let bestNearPts = [], bestCoarseFit = null, bestDensity = 0;
    for (const cand of candidates) {
      const near = [];
      for (const pt of matchPts) {
        const dx = pt.x - cand.cx, dy = pt.y - cand.cy;
        if (dx*dx + dy*dy <= REFINE_R*REFINE_R) near.push(pt);
      }
      if (near.length < 6) continue;
      const expectedFull = Math.PI * Math.pow(REFINE_R / STEP, 2);
      const density = near.length / Math.max(expectedFull, 1);
      if (density > bestDensity) {
        bestDensity = density;
        bestNearPts = near;
        bestCoarseFit = fitCircle(near);
      }
    }

    // Prune outliers using the coarse fit, then refit precisely
    let cleanPts = bestNearPts;
    if (bestCoarseFit) {
      const pruneR = bestCoarseFit.r * 1.4;
      cleanPts = bestNearPts.filter(p =>
        Math.hypot(p.x - bestCoarseFit.cx, p.y - bestCoarseFit.cy) <= pruneR
      );
    }
    const fit = fitCircle(cleanPts);
    const clusterCount = cleanPts.length;
    const MIN_CLUSTER = 6;
    const looksRound = fit && fit.score >= 0.55;
    const found = clusterCount >= MIN_CLUSTER && looksRound;

    return {
      found,
      cx: found ? fit.cx : null,
      cy: found ? fit.cy : null,
      r: found ? fit.r : null,
      fitScore: fit ? fit.score : null,
      density: bestDensity,
      clusterCount
    };
  }

  // ── SMOOTHING / SLOPE (stateful — one instance per session) ─────────
  function createSmoother(maxLen = 15) {
    let buf = [];
    return function smooth(val) {
      buf.push(val);
      if (buf.length > maxLen) buf.shift();
      return buf.reduce((a, b) => a + b) / buf.length;
    };
  }

  function createSlopeCalc(windowSec = 0.5) {
    let buf = [], current = 0;
    return function calcSlope(t, val) {
      buf.push({ t, d: val });
      buf = buf.filter(p => t - p.t <= windowSec);
      if (buf.length < 2) return current;
      const oldest = buf[0], newest = buf[buf.length - 1];
      const dt = newest.t - oldest.t;
      if (dt < 0.05) return current;
      current = (newest.d - oldest.d) / dt;
      return current;
    };
  }

  return { rgbToHsv, pickBallColor, fitCircle, detectBall, createSmoother, createSlopeCalc };
})();
