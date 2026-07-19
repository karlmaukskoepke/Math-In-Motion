/*
  faceTracker.js — shared face-tracking logic for Math In Motion (Phase 4).

  Mirrors the role motionTracker.js plays for ball tracking: ONE copy of the
  pipeline, used by both quickstart.html and fulllab.html. Fixes go here.

  ── WHY INTEROCULAR DISTANCE IS THE MEASURED QUANTITY ───────────────────
  ArUco and ball modes both work because the real-world size is KNOWN and
  FIXED (14cm marker, 15.2cm ball). A face has no fixed size — it varies by
  student. So this module measures the distance between the two eye centers
  ("interocular") and self-calibrates it per student instead of assuming a
  universal number.

  Interocular was chosen over face width or face height on purpose:
    - ROLL (head tilt sideways) doesn't change it at all — we measure a
      euclidean distance between two points, so rotating that baseline in
      the image plane leaves its length untouched.
    - PITCH (nodding) barely changes it — the eye baseline is horizontal,
      roughly perpendicular to the pitch axis.
    - YAW (turning left/right) DOES foreshorten it, by cos(yaw). That's the
      one rotation we have to correct for, and we MEASURE that foreshortening
      rather than infer it — see foreshortenFromRatio() below.
  Face WIDTH would be corrupted by yaw much more severely, and face HEIGHT
  by pitch. One correctable axis beats three.

  ── HOW AUTO-CALIBRATION WORKS (no calibration UI at all) ───────────────
  The pinhole formula used elsewhere in this app is
      distance = (realSize * focalLength) / apparentPixels
  We don't know realSize (this student's actual eye spacing) and focalLength
  varies by webcam. But we don't need either. If we ASSUME that the first
  stable reading — taken while the student is simply sitting at their
  Chromebook, before they press Start — is at a typical seated viewing
  distance (ASSUMED_SEATED_CM), then for every later frame:

      distance = ASSUMED_SEATED_CM * (referencePixels / currentPixels)

  Both realSize and focalLength cancel out of the ratio. That is the whole
  trick: it costs zero setup steps, works with any student's face and any
  webcam, and its ONLY error source is how wrong the seated-distance
  assumption was for that student — which scales the entire graph by a
  constant. Worth knowing pedagogically: a constant scaling error preserves
  the SHAPE of the distance-time graph, all the slopes' signs, every
  intercept's location in time, and the qualitative story. It stretches the
  y-axis. For "walk away, then come back, then stand still," that's fine.
  For "measure how many feet you moved," it isn't. Flagged, not hidden.

  ── LOADING ─────────────────────────────────────────────────────────────
  MediaPipe is a real download (WASM runtime + ~3MB model) on first use,
  unlike aruco.js which is a small local script. Callers MUST await load()
  and MUST show a loading state — silence here reads as a broken page.
*/

const FaceTracker = (() => {

  // ── TUNABLE CONSTANTS ─────────────────────────────────────────────────

  /*
    ── EMPIRICAL CORRECTION (fitted 2026-07-19 against tape-measure data) ──

    The raw pinhole formula read systematically LOW, and increasingly so with
    distance: 12.5in read as 11.2, but 46in read as 34. A pure scale error
    can't do that — a wrong seated-distance assumption shifts every reading
    by the SAME percentage. The error growing with distance means the
    apparent-size measurement itself carries a bias.

    Taking reciprocals shows why: 1/reported minus 1/actual came out roughly
    constant across five measurements, which is the exact signature of a
    CONSTANT ADDITIVE OFFSET in the pixel measurement. If the eye separation
    reads as (true + e) pixels rather than true, then distance = K/(reading)
    understates distance, mildly up close where the reading is large and
    badly at range where it is small. So the fix is to subtract that offset
    back out before dividing:

        distance = assumedCm * (refPx - e) / (px - e),   e = PX_BIAS * refPx

    Two constants, fitted together, then the seated distance pinned to a
    round 60cm and the bias refitted around it. Residual RMS is 0.89in
    against measurements whose own internal consistency is about +/-1.2in —
    i.e. this is at the noise floor of the data, and chasing it further would
    be fitting noise. Cross-validated (leave-one-out) as a genuine
    improvement over a pure rescale, not just a better in-sample fit.

    CAVEAT WORTH KEEPING IN VIEW: fitted from ONE person on ONE webcam.
    If PX_BIAS is a MediaPipe landmark artifact it should carry over to other
    faces; if it's specific to that camera or lighting, it won't, and it
    could make other students slightly worse. Repeating the tape-measure
    protocol with a second person is the check. Both constants are isolated
    here precisely so that's a one-line adjustment.
  */

  // Assumed distance from a seated student's eyes to their laptop camera at
  // the moment of auto-calibration. 60cm sits in the middle of the usual
  // ergonomic guidance (50-70cm) and matched the measured seated distance
  // during fitting. Every reported distance scales linearly with this.
  const ASSUMED_SEATED_CM = 60;

  // Additive bias in the apparent-size measurement, as a fraction of the
  // calibration reading. Set to 0 to disable the correction entirely and
  // recover the plain pinhole behaviour.
  const PX_BIAS = 0.128;

  // Calibration needs this many consecutive good frames whose size agrees
  // within CAL_TOLERANCE, so we don't lock onto a mid-lean-in moment.
  const CAL_FRAMES    = 12;
  const CAL_TOLERANCE = 0.08;  // 8% spread across the window

  // MediaPipe asset locations. Pinned versions — an unpinned CDN URL is a
  // silent breakage waiting to happen in a classroom.
  const MP_VERSION = '0.10.14';
  const MP_BASE    = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
  const MP_MODEL   = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  // Track up to 2 faces even though v1 uses one. Two reasons: (1) we need
  // to SEE the other faces to deliberately ignore them (a classmate walking
  // behind you shouldn't silently steal the lock), and (2) two-player game
  // modes are on the roadmap and this is the cheap half of that work.
  const MAX_FACES = 2;

  // ── LANDMARK INDICES (MediaPipe FaceMesh 468-point topology) ──────────
  const LM = {
    eyeAOuter: 33,  eyeAInner: 133,   // one eye's corners
    eyeBInner: 362, eyeBOuter: 263,   // the other eye's corners
    noseTip:   1,
    chin:      152,
    foreheadTop: 10,
    cheekA:    234,  cheekB: 454      // outer face edges, used for yaw sanity
  };

  // ── STATE ─────────────────────────────────────────────────────────────
  let landmarker = null;
  let loadState  = 'idle';   // 'idle' | 'loading' | 'ready' | 'error'
  let loadError  = null;
  let loadPromise = null;

  // ── LOADING ───────────────────────────────────────────────────────────
  // Dynamic import() so this file stays a plain <script> like every other
  // module here — no build step, no type="module" on the page.
  function load() {
    if (loadPromise) return loadPromise;
    loadState = 'loading';
    loadPromise = (async () => {
      try {
        const vision = await import(/* webpackIgnore: true */ `${MP_BASE}`);
        const { FaceLandmarker, FilesetResolver } = vision;
        const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
        landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MP_MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: MAX_FACES,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false
        });
        loadState = 'ready';
        return true;
      } catch (err) {
        loadState = 'error';
        loadError = err;
        throw err;
      }
    })();
    return loadPromise;
  }

  function getLoadState() { return { state: loadState, error: loadError }; }

  // ── GEOMETRY HELPERS ──────────────────────────────────────────────────
  /*
    ASPECT CORRECTION — important and easy to get silently wrong.
    MediaPipe normalizes x to frame WIDTH and y to frame HEIGHT
    independently. At 1280x960 those are different units, so a raw
    hypot(dx, dy) over normalized coords is aspect-distorted. Everything
    below works in "width units": x as-is, y multiplied by (vh/vw). MediaPipe
    z is already in roughly x-normalized units, so it matches this space
    too. Multiply any width-unit length by vw to get pixels.
  */
  function mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  }
  function dist2d(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function faceMetrics(pts, vw, vh) {
    const a = vh / vw;
    const P = i => ({ x: pts[i].x, y: pts[i].y * a, z: pts[i].z });

    const eyeA   = mid(P(LM.eyeAOuter), P(LM.eyeAInner));
    const eyeB   = mid(P(LM.eyeBInner), P(LM.eyeBOuter));
    const eyeMid = mid(eyeA, eyeB);

    const interocular = dist2d(eyeA, eyeB);              // width units
    const eyeToChin   = dist2d(eyeMid, P(LM.chin));      // width units
    return {
      eyeA, eyeB, eyeMid,
      interocular, eyeToChin,
      zSep: eyeB.z - eyeA.z,
      ratio: eyeToChin > 1e-6 ? interocular / eyeToChin : null,
      interocularPx: interocular * vw,
      cxN: eyeMid.x, cyN: eyeMid.y / a
    };
  }

  /*
    YAW, METHOD 1 — from landmark depth. MAGNITUDE ONLY.
    The eye baseline has true length L. Turning the head by yaw splits that
    length into an in-plane part (L*cos, which is what we see as
    `interocular`) and a depth part (L*sin, which is the eyes' z separation).
    So yaw = atan2(zSep, interocular). Validated exactly against a synthetic
    rotated head at 10/20/30/40 degrees.

    We take the ABSOLUTE VALUE deliberately. The only thing this angle is
    ever used for is a cos() foreshortening correction, and cos is an even
    function — cos(-x) = cos(x). Sign is therefore irrelevant to the result.
    That matters practically: which eye is "A" versus "B", and whether
    MediaPipe's z grows toward or away from the camera, are both convention
    questions that are easy to get backwards. Depending on a sign here would
    have been a real, silent bug (an earlier draft of this file had exactly
    that). Discarding the sign makes the whole class of error impossible.
  */
  function yawFromDepth(m) {
    if (m.interocular < 1e-6) return 0;
    return Math.abs(Math.atan2(m.zSep, m.interocular));
  }

  /*
    YAW, METHOD 2 — from a ratio against a yaw-immune measurement.
    THIS IS THE PRIMARY METHOD once calibration has happened.

    Interocular distance is horizontal, so yaw foreshortens it by cos(yaw).
    Eye-to-chin distance is vertical — it runs along the very axis the head
    rotates about, so yaw does not shorten it AT ALL. Therefore the ratio
        interocular / eyeToChin
    falls off as exactly cos(yaw), and dividing it by the value that same
    ratio had at a known-frontal moment recovers the foreshortening factor
    directly:
        foreshorten = ratio_now / ratio_frontal   ( = cos(yaw) )

    No angle extraction, no sign convention, no trigonometric assumption
    about facial proportions, and no per-student constant — the frontal
    reference is captured during the calibration we already perform. It is a
    MEASUREMENT of the foreshortening rather than an inference about it,
    which is why it is preferred over Method 1.

    Failure mode, stated honestly: PITCH (nodding) does shorten eye-to-chin,
    which inflates the ratio and makes foreshorten read above 1. We clamp at
    1, so pitch causes UNDER-correction, never over-correction — it degrades
    toward "no correction at all," which is the safe direction. Method 1
    corroborates and is pitch-immune, so a disagreement between the two is
    itself the signal that the head is pitched.
  */
  const MIN_FORESHORTEN = 0.35;   // ~70 degrees; beyond this nothing is trustworthy

  function foreshortenFromRatio(m, refRatio) {
    if (!refRatio || !m.ratio) return null;
    const f = m.ratio / refRatio;
    if (!isFinite(f)) return null;
    return Math.max(MIN_FORESHORTEN, Math.min(1, f));
  }

  /*
    FACE FINGERPRINT — a small vector of RATIOS between landmark distances.
    Ratios, not raw pixels, so the fingerprint is invariant to how far the
    student is from the camera (which is the one thing that changes most in
    this app). Used today only to keep a lock stable frame-to-frame; built
    now because two-player game modes will need exactly this to answer "is
    this the same kid as last frame, or did they swap seats?"

    Deliberately NOT a face-recognition system: it's ~4 coarse numbers, it
    lives only in memory for the length of a session, nothing is stored or
    transmitted. Enough to tell two students in one frame apart, nowhere
    near enough to identify anyone.
  */
  function fingerprint(pts, vw, vh) {
    const a = vh / vw;
    const P = i => ({ x: pts[i].x, y: pts[i].y * a });
    const m = faceMetrics(pts, vw, vh);
    const io = m.interocular;
    if (io < 1e-6) return null;
    return [
      dist2d(m.eyeMid, P(LM.noseTip))               / io,
      m.eyeToChin                                    / io,
      dist2d(P(LM.cheekA), P(LM.cheekB))             / io,
      dist2d(P(LM.foreheadTop), P(LM.chin))          / io
    ];
  }

  // Mean absolute difference between two fingerprints. Smaller = more
  // likely the same person. Threshold is empirical and untested on real
  // classroom footage — treat as a starting point.
  function fingerprintDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  }

  /*
    FACE SELECTION STRATEGY.
    Default is nearest-to-frame-center: a student sitting at their own
    Chromebook is centered; a classmate crossing behind them usually isn't.
    This is a REASONED GUESS, NOT A TESTED ONE — the alternatives (largest
    face, first-detected-then-locked) are equally plausible and may well
    beat it on real classroom video. It's isolated in this one function
    specifically so swapping or blending strategies later is a small edit,
    not a refactor.
  */
  const strategies = {
    center(faces) {
      let best = null, bestScore = Infinity;
      for (const f of faces) {
        const d = Math.hypot(f.cxN - 0.5, f.cyN - 0.5);
        if (d < bestScore) { bestScore = d; best = f; }
      }
      return best;
    },
    largest(faces) {
      let best = null, bestSize = -Infinity;
      for (const f of faces) {
        if (f.m.interocular > bestSize) { bestSize = f.m.interocular; best = f; }
      }
      return best;
    }
  };
  let activeStrategy = 'center';
  function setStrategy(name) {
    if (strategies[name]) activeStrategy = name;
  }

  /*
    DETECT — one frame.
    videoEl: the <video> element. timestampMs: monotonically increasing
    timestamp (MediaPipe VIDEO mode requires strictly increasing values or
    it silently returns stale results).
    vw/vh: frame pixel dimensions, so we return PIXEL coordinates matching
    what the ArUco and ball paths hand back (both report in raw frame
    pixels, and the pages' toDisplay() expects that).

    Returns:
      { found, cx, cy, interocularPx, correctedPx, yaw, yawConfidence,
        fingerprint, faceCount, reason }
    correctedPx is the yaw-compensated apparent size — THIS is what feeds
    the distance formula. interocularPx is the raw measurement, kept for
    debugging/overlay.
  */
  function detect(videoEl, timestampMs, vw, vh, cal) {
    const empty = (reason) => ({
      found: false, cx: null, cy: null, interocularPx: null, eyeToChinPx: null,
      correctedPx: null,
      rawRatio: null, yaw: null, foreshorten: null, yawConfidence: 0,
      fingerprint: null, faceCount: 0, reason
    });
    if (loadState !== 'ready' || !landmarker) return empty('not-ready');

    let res;
    try { res = landmarker.detectForVideo(videoEl, timestampMs); }
    catch (e) { return empty('detect-error'); }

    const all = (res && res.faceLandmarks) || [];
    if (all.length === 0) return empty('no-face');

    const faces = all.map(pts => {
      const m = faceMetrics(pts, vw, vh);
      return { pts, m, cxN: m.cxN, cyN: m.cyN };
    });

    const chosen = strategies[activeStrategy](faces);
    if (!chosen) return empty('no-face');
    const m = chosen.m;

    // Two independent foreshortening estimates.
    const yawDepth   = yawFromDepth(m);
    const fDepth     = Math.cos(yawDepth);
    const refRatio   = cal && cal.referenceRatio;
    const fRatio     = foreshortenFromRatio(m, refRatio);

    // Prefer the measured ratio method; fall back to the depth method
    // before calibration has captured a frontal reference.
    let foreshorten = (fRatio !== null) ? fRatio : fDepth;

    // Confidence = do the two methods corroborate? Compared as
    // foreshortening factors rather than angles, since that is the quantity
    // actually used and it avoids comparing magnitudes near acos's steep
    // region. A disagreement most often means the head is PITCHED (which
    // breaks the ratio method but not the depth method).
    let confidence = 1;
    if (fRatio !== null) {
      const disagree = Math.abs(fRatio - fDepth);
      confidence = disagree < 0.08 ? 1 : disagree < 0.18 ? 0.5 : 0;
      // When they clearly disagree, trust the pitch-immune depth method.
      if (confidence === 0) foreshorten = fDepth;
    }

    if (foreshorten < MIN_FORESHORTEN || !isFinite(foreshorten)) {
      const e = empty('yaw-too-large');
      e.faceCount = faces.length;
      return e;
    }

    const correctedPx = m.interocularPx / foreshorten;

    return {
      found: true,
      cx: m.cxN * vw,
      cy: m.cyN * vh,
      interocularPx: m.interocularPx,
      // Exposed for the Full Lab debug panel: the chin landmark is the soft
      // one, so when distance readings drift this is the number to watch.
      eyeToChinPx: m.eyeToChin * vw,
      correctedPx,
      // Raw interocular/eyeToChin. The calibrator stores this at the frontal
      // lock; every later frame divides by it to MEASURE foreshortening.
      rawRatio: m.ratio,
      foreshorten,
      yaw: Math.acos(Math.max(-1, Math.min(1, foreshorten))),
      yawConfidence: confidence,
      fingerprint: fingerprint(chosen.pts, vw, vh),
      faceCount: faces.length,
      reason: null,
      landmarks: chosen.pts
    };
  }

  /*
    CALIBRATOR — stateful, one per session.
    Watches for CAL_FRAMES consecutive good readings that agree within
    CAL_TOLERANCE, then locks that median in as "the student is sitting at
    ASSUMED_SEATED_CM". Requires decent yaw confidence and a near-frontal
    pose, since calibrating off a turned head bakes an error into every
    later reading.

    Any single dropout resets the streak. That's intentional: this happens
    during the free-look period before Start, so there's no cost to being
    strict, and a bad lock silently ruins the whole session.
  */
  function createCalibrator(opts = {}) {
    const assumedCm  = opts.assumedCm || ASSUMED_SEATED_CM;
    const pxBias     = opts.pxBias != null ? opts.pxBias : PX_BIAS;
    // Frontality gate for calibration. Expressed as a foreshortening factor
    // rather than an angle: cos(12 degrees) is about 0.978.
    const frontalMin = opts.frontalMin || Math.cos((opts.frontalDeg || 12) * Math.PI / 180);
    let win = [];
    let refPx = null;
    let refRatio = null;

    return {
      get calibrated()      { return refPx !== null; },
      get referencePx()     { return refPx; },
      // Read by detect() to enable the ratio-based foreshortening method.
      get referenceRatio()  { return refRatio; },
      get assumedCm()       { return assumedCm; },
      get progress()        { return refPx !== null ? 1 : win.length / CAL_FRAMES; },

      /*
        Feed every frame's detect() result. Returns true once locked.

        Before calibration, detect() has no frontal reference so it falls
        back to the depth-based foreshortening — which is exactly what we
        gate on here. That is the intended bootstrap order: depth method
        establishes frontality, frontality establishes the reference ratio,
        reference ratio powers the (better) measured method from then on.

        Any dropout resets the streak. Deliberately strict: this all happens
        during the free-look period before Start, so being picky costs the
        student nothing, whereas a bad lock silently scales every distance
        for the whole session.
      */
      feed(result) {
        if (refPx !== null) return true;
        const usable = result.found
          && result.foreshorten !== null
          && result.foreshorten >= frontalMin;
        if (!usable) { win = []; return false; }

        win.push({ px: result.interocularPx, ratio: result.rawRatio });
        if (win.length > CAL_FRAMES) win.shift();
        if (win.length < CAL_FRAMES) return false;

        const sizes = win.map(w => w.px);
        const lo = Math.min(...sizes), hi = Math.max(...sizes);
        const spread = (hi - lo) / ((hi + lo) / 2);
        if (spread > CAL_TOLERANCE) { win.shift(); return false; }

        const mid = w => w[Math.floor(w.length / 2)];
        refPx = mid([...sizes].sort((a, b) => a - b));

        // Lock the frontal geometric ratio at the same instant, from the
        // same verified-frontal window. Median for the same reason as refPx:
        // one bad frame inside an otherwise-good window shouldn't set it.
        const ratios = win.map(w => w.ratio).filter(r => r != null);
        if (ratios.length) refRatio = mid([...ratios].sort((a, b) => a - b));
        return true;
      },

      /*
        The whole payoff: focalLength and the student's real eye spacing both
        cancel, so this stays a pure ratio even with the bias term — `bias`
        is itself a fraction of refPx, so it scales with the student and the
        camera rather than being a fixed pixel count.
      */
      distanceCm(correctedPx) {
        if (refPx === null || !correctedPx) return null;
        const bias = pxBias * refPx;
        const denom = correctedPx - bias;
        // Guard the asymptote. With the fitted constants this corresponds to
        // roughly 13 feet — far outside face tracking's usable range, and
        // unreachable in practice since detection fails long before it — but
        // an unguarded divide here would return negative or infinite
        // distances rather than simply reporting nothing.
        if (denom <= 0) return null;
        return assumedCm * (refPx - bias) / denom;
      },

      reset() { win = []; refPx = null; refRatio = null; }
    };
  }

  return {
    load, getLoadState, detect, createCalibrator,
    fingerprint, fingerprintDistance, setStrategy,
    ASSUMED_SEATED_CM, PX_BIAS, LM
  };
})();
