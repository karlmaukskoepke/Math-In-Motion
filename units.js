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

  // distance: internal canonical unit is always feet
  const ftToM = ft => ft * 0.3048;
  const mToFt = m => m / 0.3048;
  // diameter: internal canonical unit is always cm
  const cmToIn = cm => cm / 2.54;
  const inToCm = inch => inch * 2.54;

  function distFromFt(ft, unit) { return unit === 'm' ? ftToM(ft) : ft; }
  function distToFt(val, unit)  { return unit === 'm' ? mToFt(val) : val; }
  function diamFromCm(cm, unit) { return unit === 'in' ? cmToIn(cm) : cm; }
  function diamToCm(val, unit)  { return unit === 'in' ? inToCm(val) : val; }

  return { getPref, setPref, ftToM, mToFt, cmToIn, inToCm, distFromFt, distToFt, diamFromCm, diamToCm };
})();
