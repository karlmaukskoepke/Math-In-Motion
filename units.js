/*
  units.js — shared unit preference + conversion for Math In Motion.
  Persists to sessionStorage so the choice carries across setup/quickstart/
  fulllab within one session, same pattern as mm_tracking.
*/

const Units = (() => {
  const KEY = 'mm_units';
  const DEFAULT = { dist: 'ft', diam: 'cm' }; // matches prior hardcoded behavior

  function getPref() {
    try {
      const p = JSON.parse(sessionStorage.getItem(KEY));
      return p ? { ...DEFAULT, ...p } : { ...DEFAULT };
    } catch (e) { return { ...DEFAULT }; }
  }

  function setPref(partial) {
    const p = { ...getPref(), ...partial };
    try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
    return p;
  }

  /*
    DISTANCE UNITS. Canonical internal unit is still feet — every conversion
    routes through it. Face mode added inches/centimetres: at a Chromebook
    the whole usable range is roughly 10-40 inches, so feet would compress
    every graph into the bottom fifth of the axis and hide exactly the fine
    motion that face tracking is good at.

    Which PAIR a tool offers is a per-mode decision (see UNIT_PAIRS below);
    this table just knows how to convert between any of them.
  */
  const PER_FOOT = { ft: 1, m: 0.3048, in: 12, cm: 30.48 };

  // Tool pages offer one pair at a time. Mixing feet and centimetres in one
  // toggle would be noise; the pair is chosen by tracking mode instead.
  const UNIT_PAIRS = { face: ['in', 'cm'], default: ['ft', 'm'] };

  function pairFor(topMode) {
    return UNIT_PAIRS[topMode] || UNIT_PAIRS.default;
  }

  // Generic conversion between any two supported distance units.
  function convert(val, fromU, toU) {
    if (fromU === toU) return val;
    const f = PER_FOOT[fromU], t = PER_FOOT[toU];
    if (!f || !t) return val;
    return (val / f) * t;
  }

  const LONG_NAME = { ft: 'feet', m: 'meters', in: 'inches', cm: 'centimeters' };
  // Decimal places for DISTANCE readouts, chosen so one step of the last
  // digit is a comparable physical amount in every unit (~a few mm).
  const PLACES = { ft: 1, m: 2, in: 1, cm: 1 };

  /*
    Y-AXIS CONFIG PER UNIT.
    Karl's call: the axis always starts at 0 so the y-intercept stays
    meaningful and slopes read honestly, even though the bottom of the
    inches axis is unreachable in practice.
    `max` carries headroom past the top labeled tick so a point sitting at
    the ceiling isn't jammed against the chart edge. `step` is the GRIDLINE
    spacing; `label` decides which of those gridlines gets a number, so the
    unlabeled ones read as midlines.
  */
  const AXIS = {
    ft: { max: 10.5, step: 0.5, label: v => Number.isInteger(v) ? String(v) : '' },
    m:  { max: 3.2,  step: 0.5, label: v => Number.isInteger(v) ? String(v) : '' },
    // 6-inch gridlines land on half-foot marks, which students already have
    // an intuition for; labels every foot.
    in: { max: 42,   step: 3,   label: v => v % 6 === 0 ? String(v) : '' },
    cm: { max: 105,  step: 5,   label: v => v % 25 === 0 ? String(v) : '' }
  };

  // Fallback speed-axis ceilings, used only before a run exists to scale to.
  const SPEED_MAX = { ft: 8, m: 2.5, in: 40, cm: 100 };

  const ftToM = ft => ft * 0.3048;
  const mToFt = m => m / 0.3048;
  // diameter: internal canonical unit is always cm
  const cmToIn = cm => cm / 2.54;
  const inToCm = inch => inch * 2.54;

  function distFromFt(ft, unit) { return unit === 'm' ? ftToM(ft) : ft; }
  function distToFt(val, unit)  { return unit === 'm' ? mToFt(val) : val; }
  function diamFromCm(cm, unit) { return unit === 'in' ? cmToIn(cm) : cm; }
  function diamToCm(val, unit)  { return unit === 'in' ? inToCm(val) : val; }

  return { getPref, setPref, ftToM, mToFt, cmToIn, inToCm, distFromFt, distToFt,
           diamFromCm, diamToCm,
           convert, pairFor, AXIS, SPEED_MAX, LONG_NAME, PLACES, PER_FOOT };
})();
