// ════════════════════════════════════════════════
// ELEMENTS
// ════════════════════════════════════════════════
const video          = document.getElementById("video");
const overlay        = document.getElementById("overlay");
const ctx            = overlay.getContext("2d", { willReadFrequently: true });
const distBadge      = document.getElementById("distBadge");
const videoWrapper   = document.getElementById("videoWrapper");
const camPlaceholder = document.getElementById("camPlaceholder");

const cameraBtn  = document.getElementById("cameraBtn");
const startBtn   = document.getElementById("startBtn");
const stopBtn    = document.getElementById("stopBtn");
const clearBtn   = document.getElementById("clearBtn");
const exportBtn  = document.getElementById("exportBtn");
const statusDot  = document.getElementById("statusDot");

const autoScaleToggle   = document.getElementById("autoScaleToggle");
const regressionToggle  = document.getElementById("regressionToggle");
const signSlopeToggleBtn= document.getElementById("signSlopeToggleBtn");

const settingsOpenBtn  = document.getElementById("settingsOpenBtn");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsPanel    = document.getElementById("settingsPanel");
const panelOverlay     = document.getElementById("panelOverlay");

// Gauges
const distReadout   = document.getElementById("distReadout");
const arrowCanvas   = document.getElementById("arrowCanvas");
const arrowCtx      = arrowCanvas.getContext("2d");
const slopeReadout  = document.getElementById("slopeReadout");
const slopeDirLabel = document.getElementById("slopeDirLabel");

// Countdown
const countdownOverlay = document.getElementById("countdownOverlay");
const countdownNum     = document.getElementById("countdownNum");

// Stats (removed from DOM — kept as no-ops so nothing breaks)
const statsRow   = { style: {} };
const statSlope  = null;
const statDist   = null;
const statR2     = null;
const statReg    = null;
const rmseDisplay= null;
const statRmse   = null;

// Settings
const markerSizeInput          = document.getElementById("markerSize");
const calibrationDistanceInput = document.getElementById("calibrationDistance");
const maxTimeInput             = document.getElementById("maxTime");
const countdownDelayInput      = document.getElementById("countdownDelay");
const xAxisDurationInput       = document.getElementById("xAxisDuration");
const calibrateBtn             = document.getElementById("calibrateBtn");
const calStatus                = document.getElementById("calStatus");

// Function box
const fn1Input       = document.getElementById("fn1Input");
const fn2Input       = document.getElementById("fn2Input");
const fn3Input       = document.getElementById("fn3Input");
const fnGlobalError  = document.getElementById("fnGlobalError");

// Table
const tableModal    = document.getElementById("tableModal");
const valTable      = document.getElementById("valTable");
const tableScore    = document.getElementById("tableScore");
const closeTableBtn = document.getElementById("closeTableBtn");
const tableBtn      = document.getElementById("tableBtn");

// Marker screen
const markerScreenBtn = document.getElementById("markerScreenBtn");
const markerScreen    = document.getElementById("markerScreen");
const markerCanvas    = document.getElementById("markerCanvas");
const markerBackBtn   = document.getElementById("markerBackBtn");
const markerRandomBtn = document.getElementById("markerRandomBtn");
const markerIdLabel   = document.getElementById("markerIdLabel");
const markerSizePx    = document.getElementById("markerSizePx");
const markerSizeCm    = document.getElementById("markerSizeCm");

// Ball tracking
const ballModeBtn      = document.getElementById("ballModeBtn");
const ballPickOverlay  = document.getElementById("ballPickOverlay");
const ballColorSwatch  = document.getElementById("ballColorSwatch");
const ballColorLabel   = document.getElementById("ballColorLabel");
const ballDiameterInput= document.getElementById("ballDiameter");

// Window settings
const xMinInput       = document.getElementById("xMin");
const xMaxInput       = document.getElementById("xMax");
const yMinInput       = document.getElementById("yMin");
const yMaxInput       = document.getElementById("yMax");
const applyWindowBtn  = document.getElementById("applyWindowBtn");

// Challenges
const newChallengeBtn   = document.getElementById("newChallengeBtn");
const judgeChallengeBtn = document.getElementById("judgeChallengeBtn");
const challengeText     = document.getElementById("challengeText");
const challengeScore    = document.getElementById("challengeScore");

const vmBtns = document.querySelectorAll(".vm-btn");

// ════════════════════════════════════════════════
// MULTI-FUNCTION SETUP
// ════════════════════════════════════════════════
const FN_COLORS = ['#ffd740', '#ff4081', '#b39ddb'];
const FN_INPUTS = [fn1Input, fn2Input, fn3Input];
// Compiled functions: null = not set
let fnFunctions = [null, null, null];
// Chart dataset indices: 0=motion, 1=ghost, then 2,3,4 = fn overlays, 5=regression
// We'll manage dynamically — simpler to track by label
const FN_DATASET_LABELS = ['fn1', 'fn2', 'fn3'];

// Wire up plot/clear buttons
document.querySelectorAll('.fn-plot-btn').forEach(btn => {
    btn.onclick = () => plotFnSlot(parseInt(btn.dataset.fn) - 1);
});
document.querySelectorAll('.fn-clear-btn').forEach(btn => {
    btn.onclick = () => clearFnSlot(parseInt(btn.dataset.fn) - 1);
});

// ════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════
// Calibration: at 1m (100cm) with 20cm marker, reading 3.6ft instead of 3.28ft
// Real distance in cm: 3.28ft * 30.48 = 100cm. Reading 3.6ft * 30.48 = 109.7cm
// focalLength needs to be scaled by 100/109.7 = 0.912
// Previous value was 947. New value: 947 * 0.912 = 863
let focalLength         = 863;
let lastKnownPixelWidth = null;
let recording           = false;
let countingDown        = false;
let data                = [];
let startTime           = null;
let lastRecordTime      = 0;
let smoothBuffer        = [];
let detector            = null;
let currentSlope        = 0;
let slopeBuffer         = [];
let currentChallenge    = null;
let signSlopeOn         = false;
let countdownTimer      = null;
let viewMode            = 'full';
let regressionOn        = false;
let arrowAngleDeg       = 0;

// Ball tracking state
let ballModeOn          = false;
let ballPickMode        = false;
let ballColor           = null;  // { r, g, b }
let ballColorTolerance  = 40;    // HSV-ish tolerance in RGB space

// ════════════════════════════════════════════════
// PANELS
// ════════════════════════════════════════════════
const openPanel  = () => { settingsPanel.classList.add("open");  panelOverlay.classList.add("visible"); };
const closePanel = () => { settingsPanel.classList.remove("open"); panelOverlay.classList.remove("visible"); };
settingsOpenBtn.onclick  = openPanel;
settingsCloseBtn.onclick = closePanel;
panelOverlay.onclick     = closePanel;

signSlopeToggleBtn.onclick = () => {
    signSlopeOn = !signSlopeOn;
    signSlopeToggleBtn.classList.toggle("active", signSlopeOn);
    rebuildChart();
};

// ── Ball Mode Toggle ──
ballModeBtn.onclick = () => {
    ballModeOn = !ballModeOn;
    ballModeBtn.classList.toggle("active", ballModeOn);
    if (ballModeOn) {
        ballPickMode = true;
        ballPickOverlay.classList.add("visible");
        ballModeBtn.title = "Ball Mode ON — click ball to repick";
    } else {
        ballPickMode = false;
        ballColor = null;
        ballPickOverlay.classList.remove("visible");
        ballModeBtn.title = "Ball Tracking Mode";
        ballColorSwatch.style.background = '';
        ballColorLabel.textContent = 'none';
        // Re-init ArUco detector if not already done
        if (!detector && typeof AR !== "undefined") detector = new AR.Detector();
    }
};

// Click on the pick overlay to sample ball color
ballPickOverlay.addEventListener("click", (e) => {
    if (!ballPickMode) return;
    // Get position relative to the videoWrapper (same coordinate space as overlay canvas)
    const rect = videoWrapper.getBoundingClientRect();
    const cx   = (e.clientX - rect.left) / rect.width;
    const cy   = (e.clientY - rect.top)  / rect.height;
    // Sample color from native video frame
    const vw = video.videoWidth, vh = video.videoHeight;
    const dw = videoWrapper.clientWidth, dh = videoWrapper.clientHeight;
    const videoAspect = vw / vh, displayAspect = dw / dh;
    let cropX=0, cropY=0, cropW=vw, cropH=vh;
    if (videoAspect > displayAspect) { cropH=vh; cropW=Math.round(vh*displayAspect); cropX=Math.round((vw-cropW)/2); }
    else { cropW=vw; cropH=Math.round(vw/displayAspect); cropY=Math.round((vh-cropH)/2); }
    const nx = Math.round(cropX + cx * cropW);
    const ny = Math.round(cropY + cy * cropH);
    const tmpC = document.createElement('canvas');
    tmpC.width = vw; tmpC.height = vh;
    const tmpCtx = tmpC.getContext('2d');
    tmpCtx.drawImage(video, 0, 0, vw, vh);
    // Sample a 9x9 patch for a more robust color average
    const patch = tmpCtx.getImageData(Math.max(0,nx-4), Math.max(0,ny-4), 9, 9).data;
    let r=0,g=0,b=0,n=0;
    for (let i=0;i<patch.length;i+=4){r+=patch[i];g+=patch[i+1];b+=patch[i+2];n++;}
    r=Math.round(r/n); g=Math.round(g/n); b=Math.round(b/n);
    ballColor = {r,g,b};
    const hsv = rgbToHsv(r,g,b);
    ballColor.h = hsv.h;
    ballColorSwatch.style.background = `rgb(${r},${g},${b})`;
    ballColorLabel.textContent = `H:${Math.round(hsv.h)}° S:${(hsv.s*100).toFixed(0)}%`;
    if (hsv.s < 0.25) {
        ballColorLabel.textContent += ' ⚠ too grey';
        ballColorLabel.style.color = 'var(--warn)';
    } else {
        ballColorLabel.style.color = '';
    }
    ballPickMode = false;
    ballPickOverlay.classList.remove("visible");
    // Remove old tolerance code — now using HSV hue matching
});

// ── Window Settings ──
applyWindowBtn.onclick = () => {
    const x0 = parseFloat(xMinInput.value);
    const x1 = parseFloat(xMaxInput.value) || 5;
    const y0 = parseFloat(yMinInput.value);
    const y1 = parseFloat(yMaxInput.value) || 12;
    chart.options.scales.x.min = isNaN(x0) ? 0 : x0;
    chart.options.scales.x.max = x1;
    chart.options.scales.y.min = isNaN(y0) ? 0 : y0;
    chart.options.scales.y.max = y1;
    xAxisDurationInput.value = x1;
    // Replot fn overlays for new x range
    fnFunctions.forEach((fn, i) => { if (fn) plotFnOverlay(i); });
    chart.update();
    closePanel();
};

vmBtns.forEach(btn => {
    btn.onclick = () => {
        vmBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        viewMode = btn.dataset.mode;
        rebuildChart();
    };
});

// ════════════════════════════════════════════════
// CHART
// ════════════════════════════════════════════════
const chart = new Chart(document.getElementById("chart"), {
    type: 'line',
    data: {
        datasets: [
            {   // 0 — live motion
                label: 'Motion', data: [],
                borderColor: '#00e5ff', backgroundColor: 'rgba(0,229,255,0.07)',
                borderWidth: 2, pointRadius: 0, pointHoverRadius: 6,
                pointHoverBackgroundColor: '#fff', fill: true, tension: 0.3,
                segment: { borderColor: seg => getSegmentColor(seg) }
            },
            {   // 1 — regression
                label: 'Regression', data: [],
                borderColor: '#7986cb', backgroundColor: 'transparent',
                borderWidth: 2, borderDash: [4,4], pointRadius: 0, fill: false, tension: 0, hidden: true
            },
            // fn1, fn2, fn3 overlays added dynamically at indices 2,3,4
        ]
    },
    options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { labels: { color: '#7986cb', font: { family: 'Space Mono', size: 11 } } },
            tooltip: {
                backgroundColor: 'rgba(10,12,20,0.97)',
                borderColor: '#00e5ff', borderWidth: 1,
                titleColor: '#00e5ff', bodyColor: '#ffffff',
                titleFont: { family: 'Space Mono', size: 14, weight: 'bold' },
                bodyFont:  { family: 'Space Mono', size: 14, weight: 'bold' },
                padding: 14,
                callbacks: {
                    title: items => {
                        // Snap to nearest 0.5s
                        const snapped = Math.round(items[0].parsed.x * 2) / 2;
                        return `t = ${snapped.toFixed(1)} sec`;
                    },
                    label: item => {
                        const snappedT = Math.round(item.parsed.x * 2) / 2;
                        const d = item.parsed.y.toFixed(1);
                        const friendlyLabel =
                            item.dataset.label === 'fn1' ? 'My Function' :
                            item.dataset.label === 'fn2' ? 'Function 2'  :
                            item.dataset.label === 'fn3' ? 'Function 3'  :
                            item.dataset.label;
                        return ` ${friendlyLabel}: (${snappedT.toFixed(1)} sec, ${d} ft)`;
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'linear',
                title: {
                    display: true, text: "Time (s)", color: '#ffffff',
                    font: { family: 'Space Mono', size: 13, weight: 'bold' }
                },
                ticks: {
                    color: '#ffffff',
                    font: { family: 'Space Mono', size: 12, weight: 'bold' },
                    stepSize: 0.5,
                    // Show label only at 0.5s intervals; format as clean integers or single decimal
                    callback: v => {
                        if (Math.round(v * 2) !== v * 2) return null;  // only at 0.5 multiples
                        // Show as integer if whole number, else one decimal
                        return Number.isInteger(v) ? String(v) : v.toFixed(1);
                    }
                },
                grid: {
                    // Gridline at every 0.25s — but label only at 0.5s (handled by callback above)
                    color: c => Number.isInteger(c.tick.value) ? 'rgba(160,180,255,0.55)' : 'rgba(100,120,200,0.35)',
                    lineWidth: c => Number.isInteger(c.tick.value) ? 2 : 1
                },
                min: 0, max: 5
            },
            y: {
                title: {
                    display: true, text: "Distance (ft)", color: '#ffffff',
                    font: { family: 'Space Mono', size: 13, weight: 'bold' }
                },
                ticks: {
                    color: '#ffffff',
                    font: { family: 'Space Mono', size: 12, weight: 'bold' },
                    stepSize: 1,
                    callback: v => Number.isInteger(v) ? String(v) : null
                },
                grid: {
                    color: c => Number.isInteger(c.tick.value) ? 'rgba(160,180,255,0.55)' : 'rgba(100,120,200,0.2)',
                    lineWidth: c => Number.isInteger(c.tick.value) ? 2 : 0.8
                },
                min: 0, max: 12   // y-axis to 12 ft
            }
        }
    }
});

// Ensure fn overlay datasets exist at startup
function ensureFnDatasets() {
    while (chart.data.datasets.length < 5) {
        const i = chart.data.datasets.length - 2; // 0,1,2 → fn0,fn1,fn2
        chart.data.datasets.push({
            label: FN_DATASET_LABELS[i] || `fn${i}`,
            data: [], borderColor: FN_COLORS[i] || '#fff',
            backgroundColor: 'transparent', borderWidth: 2.5,
            borderDash: [6,3], pointRadius: 0, fill: false, tension: 0, hidden: true
        });
    }
}
ensureFnDatasets();

// ── Recording endpoint marker on x-axis ──
Chart.register({
    id: 'recordingMarker',
    afterDraw(chartInst) {
        const maxT = parseFloat(maxTimeInput.value) || 5;
        const xScale = chartInst.scales.x;
        const yScale = chartInst.scales.y;
        if (!xScale || !yScale) return;
        const xPx = xScale.getPixelForValue(maxT);
        if (xPx < xScale.left || xPx > xScale.right) return;
        const c2 = chartInst.ctx;
        c2.save();
        // Dashed vertical guide line
        c2.strokeStyle = 'rgba(255,215,64,0.5)';
        c2.lineWidth = 2;
        c2.setLineDash([5, 4]);
        c2.beginPath();
        c2.moveTo(xPx, yScale.top);
        c2.lineTo(xPx, yScale.bottom);
        c2.stroke();
        c2.setLineDash([]);
        // Label above
        c2.fillStyle = '#ffd740';
        c2.font = 'bold 11px "Space Mono", monospace';
        c2.textAlign = 'center';
        c2.fillText(`${maxT}s ⏹`, xPx, yScale.top - 5);
        // Bright tick on axis
        c2.strokeStyle = '#ffd740';
        c2.lineWidth = 3;
        c2.beginPath();
        c2.moveTo(xPx, yScale.bottom);
        c2.lineTo(xPx, yScale.bottom + 8);
        c2.stroke();
        c2.restore();
    }
});
function updateRecordingMarker() { chart.update(); }

xAxisDurationInput.addEventListener("change", () => {
    chart.options.scales.x.max = parseFloat(xAxisDurationInput.value) || 5;
    updateRecordingMarker();
    chart.update();
});

// Keep maxTime and xAxisDuration in sync — they're the same thing now
maxTimeInput.addEventListener("change", () => {
    const val = parseFloat(maxTimeInput.value) || 5;
    xAxisDurationInput.value = val;
    chart.options.scales.x.max = val;
    updateRecordingMarker();
    chart.update();
});

function getSegmentColor(seg) {
    if (!signSlopeOn) return '#00e5ff';
    const d = seg.p1.parsed.y - seg.p0.parsed.y;
    if (Math.abs(d) < 0.015) return '#ffd740';
    return d > 0 ? '#69f0ae' : '#ff4081';
}

autoScaleToggle.addEventListener("change", () => {
    chart.options.scales.y.min = autoScaleToggle.checked ? undefined : 0;
    chart.options.scales.y.max = autoScaleToggle.checked ? undefined : 12;
    chart.update();
});

regressionToggle.addEventListener("change", () => {
    regressionOn = regressionToggle.checked;
    rebuildChart();
});

// ════════════════════════════════════════════════
// REBUILD CHART
// ════════════════════════════════════════════════
function rebuildChart() {
    if (!data.length) return;
    let pts = [];
    if (viewMode === 'full') {
        pts = data.map(([t,d]) => ({ x: t, y: d }));
        chart.data.datasets[0].tension    = 0.3;
        chart.data.datasets[0].pointRadius = 0;
        chart.data.datasets[0].showLine   = true;
    } else if (viewMode === 'discrete') {
        pts = sampleAtIntervals(data, 0.5);
        chart.data.datasets[0].tension    = 0;
        chart.data.datasets[0].pointRadius = 6;
        chart.data.datasets[0].showLine   = false;
    } else {
        pts = sampleAtIntervals(data, 0.5);
        chart.data.datasets[0].tension    = 0;
        chart.data.datasets[0].pointRadius = 6;
        chart.data.datasets[0].showLine   = true;
    }
    chart.data.datasets[0].data = pts;
    chart.data.datasets[0].segment = { borderColor: seg => getSegmentColor(seg) };

    if (regressionOn && data.length >= 3) {
        const reg  = linearRegression(data);
        const xMax = chart.options.scales.x.max || 5;
        chart.data.datasets[1].data   = [{ x: 0, y: reg.b }, { x: xMax, y: reg.m * xMax + reg.b }];
        chart.data.datasets[1].hidden = false;
        updateStatsRow(reg);
    } else {
        chart.data.datasets[1].data   = [];
        chart.data.datasets[1].hidden = true;
        if (data.length >= 3) updateStatsRow(null);
    }

    // Replot all active fn overlays
    fnFunctions.forEach((fn, i) => { if (fn) plotFnOverlay(i); });
    chart.update();
}

function sampleAtIntervals(rawData, intervalSec) {
    if (!rawData.length) return [];
    const maxT = rawData[rawData.length - 1][0];
    const pts  = [];
    for (let t = 0; t <= maxT + 0.001; t = parseFloat((t + intervalSec).toFixed(4))) {
        let lo = rawData[0], hi = rawData[rawData.length - 1];
        for (let i = 0; i < rawData.length - 1; i++) {
            if (rawData[i][0] <= t && rawData[i+1][0] >= t) { lo = rawData[i]; hi = rawData[i+1]; break; }
        }
        const dt = hi[0] - lo[0];
        const d  = dt < 0.001 ? lo[1] : lo[1] + (hi[1] - lo[1]) * (t - lo[0]) / dt;
        pts.push({ x: parseFloat(t.toFixed(2)), y: parseFloat(d.toFixed(3)) });
    }
    return pts;
}

// Stats row removed — these are no-ops kept so other code doesn't break
function updateStatsRow(reg) { /* stats row removed */ }
function updateLiveStats(distFt, slope) { /* stats row removed */ }

// ════════════════════════════════════════════════
// REGRESSION + RMSE
// ════════════════════════════════════════════════
function linearRegression(pts) {
    const n = pts.length;
    let sumT=0, sumD=0, sumTD=0, sumT2=0;
    pts.forEach(([t,d]) => { sumT+=t; sumD+=d; sumTD+=t*d; sumT2+=t*t; });
    const m = (n*sumTD - sumT*sumD) / (n*sumT2 - sumT*sumT);
    const b = (sumD - m*sumT) / n;
    const meanD = sumD / n;
    let ssTot=0, ssRes=0;
    pts.forEach(([t,d]) => { ssTot += (d-meanD)**2; ssRes += (d-(m*t+b))**2; });
    return { m, b, r2: 1 - ssRes/ssTot };
}

function calcRmse(pts, fn) {
    return Math.sqrt(pts.map(([t,d]) => (d - fn(t))**2).reduce((a,b) => a+b, 0) / pts.length);
}

// ════════════════════════════════════════════════
// SLOPE ARROW GAUGE — full bidirectional arrow with intensity background
// ════════════════════════════════════════════════
function slopeToColor(slope) {
    // intensity: 0 at slope=0, max at slope=±4
    const abs  = Math.abs(slope);
    const norm = Math.min(abs / 4, 1);   // 0–1
    // Map norm → opacity for the glow/fill: 0.08 (faint) to 0.85 (vivid)
    const alpha = 0.08 + norm * 0.77;
    if (abs < 0.05) return { solid: `rgba(255,215,64,${alpha})`, pure: '#ffd740', name: 'zero' };
    if (slope > 0)  return { solid: `rgba(105,240,174,${alpha})`, pure: '#69f0ae', name: 'pos' };
    return              { solid: `rgba(255,64,129,${alpha})`,  pure: '#ff4081', name: 'neg' };
}

function drawArrow(angleDeg, slope) {
    const w = arrowCanvas.width, h = arrowCanvas.height;
    const cx = w / 2, cy = h / 2;
    const r  = Math.min(w, h) * 0.42;
    arrowCtx.clearRect(0, 0, w, h);

    const col = slopeToColor(slope);

    // ── Background circle with intensity fill ──
    arrowCtx.beginPath();
    arrowCtx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    arrowCtx.fillStyle = col.solid;
    arrowCtx.fill();
    arrowCtx.strokeStyle = col.pure + '88';
    arrowCtx.lineWidth = 2;
    arrowCtx.stroke();

    // ── Tick marks ──
    [-90, -67.5, -45, -22.5, 0, 22.5, 45, 67.5, 90].forEach(deg => {
        const rad = (deg * Math.PI) / 180;
        const isMajor = deg % 45 === 0;
        const inner = r - (isMajor ? 7 : 4);
        const outer = r + 1;
        arrowCtx.beginPath();
        arrowCtx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
        arrowCtx.lineTo(cx + Math.cos(rad) * outer, cy + Math.sin(rad) * outer);
        arrowCtx.strokeStyle = isMajor ? '#4a5280' : '#2e3356';
        arrowCtx.lineWidth = isMajor ? 2 : 1;
        arrowCtx.stroke();
    });

    // ── Full bidirectional arrow ──
    // Arrow points from center toward the "target" direction and
    // also extends THROUGH the center to the opposite side (tail)
    const rad      = (angleDeg * Math.PI) / 180;
    const tipX     = cx + Math.cos(rad) * (r - 8);
    const tipY     = cy + Math.sin(rad) * (r - 8);
    const tailX    = cx - Math.cos(rad) * (r - 18);   // opposite side, slightly shorter
    const tailY    = cy - Math.sin(rad) * (r - 18);

    // Shaft from tail through center to tip
    arrowCtx.beginPath();
    arrowCtx.moveTo(tailX, tailY);
    arrowCtx.lineTo(tipX, tipY);
    arrowCtx.strokeStyle = col.pure;
    arrowCtx.lineWidth = 5;
    arrowCtx.lineCap = 'round';
    arrowCtx.stroke();

    // Arrowhead at tip
    const headLen = 14, headAngle = 0.42;
    arrowCtx.beginPath();
    arrowCtx.moveTo(tipX, tipY);
    arrowCtx.lineTo(tipX - headLen * Math.cos(rad - headAngle), tipY - headLen * Math.sin(rad - headAngle));
    arrowCtx.moveTo(tipX, tipY);
    arrowCtx.lineTo(tipX - headLen * Math.cos(rad + headAngle), tipY - headLen * Math.sin(rad + headAngle));
    arrowCtx.strokeStyle = col.pure;
    arrowCtx.lineWidth = 4;
    arrowCtx.stroke();

    // Small tail circle
    arrowCtx.beginPath();
    arrowCtx.arc(tailX, tailY, 4, 0, Math.PI * 2);
    arrowCtx.fillStyle = col.pure + 'aa';
    arrowCtx.fill();

    // Center pivot dot
    arrowCtx.beginPath();
    arrowCtx.arc(cx, cy, 5, 0, Math.PI * 2);
    arrowCtx.fillStyle = col.pure;
    arrowCtx.fill();
}

function updateGauges(distFt, slope) {
    distReadout.textContent = distFt.toFixed(1);

    // Smooth arrow angle: slope=0 → 0° (right), slope>0 → negative (up), slope<0 → down
    const clampedSlope = Math.max(-4, Math.min(4, slope));
    const targetAngle  = -clampedSlope * 20;   // ±4 ft/s → ±80°
    arrowAngleDeg     += (targetAngle - arrowAngleDeg) * 0.22;
    drawArrow(arrowAngleDeg, slope);

    const sign = slope >= 0 ? '+' : '';
    slopeReadout.textContent = sign + slope.toFixed(1);
    const col = slopeToColor(slope);
    slopeReadout.className   = col.name;
    slopeDirLabel.textContent = Math.abs(slope) < 0.05 ? 'constant' : slope > 0 ? 'moving away' : 'moving closer';

    // Video border
    videoWrapper.classList.remove('slope-pos','slope-neg','slope-zero');
    if (signSlopeOn) videoWrapper.classList.add('slope-' + col.name);
}

// Draw initial arrow
drawArrow(0, 0);

// ════════════════════════════════════════════════
// FUNCTION PARSER
// ════════════════════════════════════════════════
function parseFunction(expr) {
    let e = expr.trim()
        .replace(/^[yY]\s*=\s*/, '')
        .replace(/^f\s*\(\s*x\s*\)\s*=\s*/, '');

    // Absolute value: |expr| → Math.abs(expr)
    e = e.replace(/\|([^|]+)\|/g, 'Math.abs($1)');

    // Handle implicit multiplication: 2x → 2*x, 2( → 2*(, )(  → )*(, )x → )*x, x( → x*(
    e = e.replace(/(\d)(x)/gi,  '$1*x');
    e = e.replace(/(\d)\(/g,    '$1*(');
    e = e.replace(/\)(x)/gi,    ')*x');
    e = e.replace(/\)(\d)/g,    ')*$1');
    e = e.replace(/x\(/gi,      'x*(');
    e = e.replace(/(x)(\d)/gi,  'x*$1');
    // Handle negative coefficient: -(x → -1*(x   (e.g. -(x-3) )
    e = e.replace(/^-\(/,       '-1*(');
    e = e.replace(/([+\-*/,\(])\s*-\(/g, '$1-1*(');

    // Powers: a^b → Math.pow(a,b)
    // Handle cases like (x-3)^2, x^2, 2^x
    e = e.replace(/\(([^()]+)\)\s*\^\s*([0-9.]+)/g, 'Math.pow(($1),$2)');
    e = e.replace(/([a-zA-Z0-9_.]+)\s*\^\s*([a-zA-Z0-9_.]+|\([^)]+\))/g, 'Math.pow($1,$2)');

    // Named constants / functions
    e = e.replace(/\be\b/g,    'Math.E');
    e = e.replace(/\bpi\b/gi,  'Math.PI');
    e = e.replace(/\bsqrt\b/g, 'Math.sqrt');
    e = e.replace(/\babs\b/g,  'Math.abs');
    e = e.replace(/\bsin\b/g,  'Math.sin');
    e = e.replace(/\bcos\b/g,  'Math.cos');
    e = e.replace(/\btan\b/g,  'Math.tan');
    e = e.replace(/\bln\b/g,   'Math.log');
    e = e.replace(/\blog\b/g,  'Math.log10');

    try {
        const fn   = new Function('x', `"use strict"; return (${e});`);
        const test = fn(1);
        if (typeof test !== 'number' || isNaN(test)) throw new Error("Not a number at x=1");
        return fn;
    } catch(err) { throw new Error("Parse error: " + err.message); }
}

function plotFnSlot(i) {
    const input = FN_INPUTS[i];
    const expr  = input.value.trim();
    if (!expr) return;
    input.classList.remove('error');
    fnGlobalError.textContent = '';
    try {
        fnFunctions[i] = parseFunction(expr);
        plotFnOverlay(i);
        chart.update();
        // Update RMSE
        if (i === 0 && data.length) updateStatsRow(null);
    } catch(e) {
        fnGlobalError.textContent = `⚠ y= (${i+1}): ${e.message}`;
        input.classList.add('error');
        fnFunctions[i] = null;
    }
}

function clearFnSlot(i) {
    fnFunctions[i] = null;
    FN_INPUTS[i].value = '';
    FN_INPUTS[i].classList.remove('error');
    fnGlobalError.textContent = '';
    // Clear the dataset
    const ds = chart.data.datasets.find(d => d.label === FN_DATASET_LABELS[i]);
    if (ds) { ds.data = []; ds.hidden = true; }
    chart.update();
}

function plotFnOverlay(i) {
    const fn = fnFunctions[i];
    if (!fn) return;
    const xMax = chart.options.scales.x.max || 5;
    const pts  = [];
    for (let t = 0; t <= xMax + 0.001; t += 0.05) {
        try { const y = fn(t); if (isFinite(y)) pts.push({ x: parseFloat(t.toFixed(3)), y: parseFloat(y.toFixed(4)) }); } catch(e) {}
    }
    // Find or create dataset
    let ds = chart.data.datasets.find(d => d.label === FN_DATASET_LABELS[i]);
    if (!ds) {
        ds = {
            label: FN_DATASET_LABELS[i], data: [],
            borderColor: FN_COLORS[i], backgroundColor: 'transparent',
            borderWidth: 2.5, borderDash: [6,3], pointRadius: 0, fill: false, tension: 0
        };
        chart.data.datasets.push(ds);
    }
    ds.data   = pts;
    ds.hidden = false;
    ds.borderColor = FN_COLORS[i];
}

// ════════════════════════════════════════════════
// CAMERA
// ════════════════════════════════════════════════
cameraBtn.onclick = function () {
    if (!ballModeOn) {
        if (typeof AR === "undefined") { alert("ArUco library failed to load. Refresh."); return; }
        if (!detector) detector = new AR.Detector();
    }
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
        .then(stream => {
            video.srcObject = stream;
            video.style.display = "block";
            camPlaceholder.style.display = "none";
            video.onloadedmetadata = () => {
                video.play();
                statusDot.classList.add("active");
                startBtn.disabled = false;
                startTime = Date.now();
                requestAnimationFrame(processVideo);
            };
            cameraBtn.disabled = true;
            cameraBtn.textContent = "Camera On";
        })
        .catch(err => { alert("Camera access denied: " + err.message); });
};

// ════════════════════════════════════════════════
// SMOOTHING (fixed 15)
// ════════════════════════════════════════════════
const SMOOTH_N = 15;
function smooth(value) {
    smoothBuffer.push(value);
    if (smoothBuffer.length > SMOOTH_N) smoothBuffer.shift();
    return smoothBuffer.reduce((a,b) => a+b) / smoothBuffer.length;
}

// ════════════════════════════════════════════════
// SLOPE
// ════════════════════════════════════════════════
function calcSlope(t, distFt) {
    slopeBuffer.push({ t, d: distFt });
    slopeBuffer = slopeBuffer.filter(p => t - p.t <= 0.5);
    if (slopeBuffer.length < 2) return currentSlope;
    const oldest = slopeBuffer[0], newest = slopeBuffer[slopeBuffer.length - 1];
    const dt = newest.t - oldest.t;
    if (dt < 0.05) return currentSlope;
    currentSlope = (newest.d - oldest.d) / dt;
    return currentSlope;
}

// ════════════════════════════════════════════════
// COLOR HELPERS FOR BALL TRACKING
// ════════════════════════════════════════════════
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
        if      (max === r) h = 60 * (((g - b) / d) % 6);
        else if (max === g) h = 60 * (((b - r) / d) + 2);
        else                h = 60 * (((r - g) / d) + 4);
        if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
}

function rgbToHue(r, g, b) {
    return rgbToHsv(r, g, b).h;
}

// ════════════════════════════════════════════════
// PROCESS VIDEO — Fix for object-fit:cover skew
// Detection runs on native video resolution.
// Drawing is remapped to match what the CSS cover crop shows.
// ════════════════════════════════════════════════
function processVideo() {
    if (!video.videoWidth) { requestAnimationFrame(processVideo); return; }

    const vw = video.videoWidth,  vh = video.videoHeight;
    const dw = videoWrapper.clientWidth,  dh = videoWrapper.clientHeight;

    const videoAspect   = vw / vh;
    const displayAspect = dw / dh;
    let cropX = 0, cropY = 0, cropW = vw, cropH = vh;
    if (videoAspect > displayAspect) {
        cropH = vh; cropW = Math.round(vh * displayAspect); cropX = Math.round((vw - cropW) / 2);
    } else {
        cropW = vw; cropH = Math.round(vw / displayAspect); cropY = Math.round((vh - cropH) / 2);
    }

    // Draw native frame to offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = vw; offscreen.height = vh;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
    offCtx.drawImage(video, 0, 0, vw, vh);

    overlay.width  = dw;
    overlay.height = dh;
    ctx.clearRect(0, 0, dw, dh);

    function toDisplay(nx, ny) {
        return { x: ((nx - cropX) / cropW) * dw, y: ((ny - cropY) / cropH) * dh };
    }

    // ── BALL TRACKING MODE ──
    if (ballModeOn && ballColor) {
        const imageData = offCtx.getImageData(0, 0, vw, vh);
        const pixels    = imageData.data;

        // Convert target color to HSV hue
        const targetHue = rgbToHue(ballColor.r, ballColor.g, ballColor.b);
        const HUE_TOL   = 22;   // ± degrees of hue — robust across lighting changes
        const SAT_MIN   = 0.25; // ignore washed-out / grey pixels
        const VAL_MIN   = 0.08; // ignore near-black pixels

        // ── Step 1: build list of matching pixel centers (sampled every 4px for speed) ──
        const STEP = 4;
        const matchPts = [];  // {x, y}
        for (let py = STEP; py < vh - STEP; py += STEP) {
            for (let px = STEP; px < vw - STEP; px += STEP) {
                const idx = (py * vw + px) * 4;
                const r = pixels[idx], g = pixels[idx+1], b = pixels[idx+2];
                const { h, s, v } = rgbToHsv(r, g, b);
                if (s < SAT_MIN || v < VAL_MIN) continue;
                // Hue is circular — check both directions
                let hueDiff = Math.abs(h - targetHue);
                if (hueDiff > 180) hueDiff = 360 - hueDiff;
                if (hueDiff <= HUE_TOL) matchPts.push({ x: px, y: py });
            }
        }

        // ── Step 2: find the densest cluster using a sliding window ──
        // Divide frame into grid cells, count matches per cell, find hottest region
        const CELL = Math.round(Math.min(vw, vh) * 0.12); // ~12% of frame dimension
        let bestCount = 0, bestCx = 0, bestCy = 0;
        // Build a quick 2D accumulator
        const gw = Math.ceil(vw / CELL), gh = Math.ceil(vh / CELL);
        const grid = new Int16Array(gw * gh);
        for (const pt of matchPts) {
            const gx = Math.floor(pt.x / CELL);
            const gy = Math.floor(pt.y / CELL);
            // Accumulate into a 3x3 neighbourhood for smooth peaks
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = gx + dx, ny = gy + dy;
                    if (nx >= 0 && nx < gw && ny >= 0 && ny < gh) {
                        grid[ny * gw + nx]++;
                    }
                }
            }
        }
        for (let gy = 0; gy < gh; gy++) {
            for (let gx = 0; gx < gw; gx++) {
                const cnt = grid[gy * gw + gx];
                if (cnt > bestCount) {
                    bestCount = cnt;
                    bestCx = (gx + 0.5) * CELL;
                    bestCy = (gy + 0.5) * CELL;
                }
            }
        }

        // ── Step 3: refine — measure the tight bounding box of matches near the best center ──
        const REFINE_R = CELL * 2.5;  // only look at points within 2.5 cells of the peak
        let minX = vw, maxX = 0, minY = vh, maxY = 0, clusterCount = 0;
        for (const pt of matchPts) {
            const dx = pt.x - bestCx, dy = pt.y - bestCy;
            if (dx*dx + dy*dy <= REFINE_R * REFINE_R) {
                if (pt.x < minX) minX = pt.x;
                if (pt.x > maxX) maxX = pt.x;
                if (pt.y < minY) minY = pt.y;
                if (pt.y > maxY) maxY = pt.y;
                clusterCount++;
            }
        }

        // Need a reasonable number of clustered pixels to declare a detection
        const MIN_CLUSTER = Math.max(8, Math.round((REFINE_R / STEP) * 0.15));
        if (clusterCount >= MIN_CLUSTER && (maxX - minX) > 4) {
            const diamPx = ((maxX - minX) + (maxY - minY)) / 2;
            const cxN    = (minX + maxX) / 2;
            const cyN    = (minY + maxY) / 2;
            lastKnownPixelWidth = diamPx;
            const realDiam = parseFloat(ballDiameterInput.value) || 8.0;
            const distCm   = smooth((realDiam * focalLength) / diamPx);
            const distFt   = distCm / 30.48;

            // Draw circle in display coordinates
            const dispC = toDisplay(cxN, cyN);
            const dispR = Math.max(8, (diamPx / cropW) * dw / 2);
            ctx.strokeStyle = "#ffd740";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(dispC.x, dispC.y, dispR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = "rgba(255,215,64,0.12)";
            ctx.fill();
            // Crosshair dot
            ctx.beginPath();
            ctx.arc(dispC.x, dispC.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = "#ffd740";
            ctx.fill();
            // Debug: show match count
            ctx.fillStyle = "rgba(255,215,64,0.8)";
            ctx.font = "bold 10px Space Mono, monospace";
            ctx.fillText(`${clusterCount} pts`, dispC.x + dispR + 4, dispC.y);

            distBadge.innerText = distFt.toFixed(2) + " ft";
            const now   = (Date.now() - startTime) / 1000;
            const slope = calcSlope(now, distFt);
            updateGauges(distFt, slope);

            if (recording) {
                const t = (Date.now() - startTime) / 1000;
                if (t >= parseFloat(maxTimeInput.value)) {
                    stopRecording();
                } else if (t - lastRecordTime >= 0.05) {
                    lastRecordTime = t;
                    data.push([parseFloat(t.toFixed(2)), parseFloat(distFt.toFixed(3))]);
                    chart.data.datasets[0].data.push({ x: parseFloat(t.toFixed(2)), y: parseFloat(distFt.toFixed(3)) });
                    chart.update('none');
                }
            }
        } else {
            distBadge.innerText = "No ball found";
            videoWrapper.classList.remove('slope-pos','slope-neg','slope-zero');
        }
        requestAnimationFrame(processVideo);
        return;
    }

    // ── ARUCO MODE (default) ──
    const imageData = offCtx.getImageData(0, 0, vw, vh);
    const markers   = detector.detect(imageData);

    if (markers.length > 0) {
        const corners = markers[0].corners;
        const dc = corners.map(c => toDisplay(c.x, c.y));

        ctx.strokeStyle = "#00e5ff";
        ctx.lineWidth   = 3;
        ctx.beginPath();
        dc.forEach((c, i) => i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y));
        ctx.closePath(); ctx.stroke();

        ctx.fillStyle = "#ff4081";
        dc.forEach(c => { ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI*2); ctx.fill(); });

        const widthPx = Math.hypot(corners[0].x - corners[1].x, corners[0].y - corners[1].y);
        lastKnownPixelWidth = widthPx;
        const distCm = smooth((parseFloat(markerSizeInput.value) * focalLength) / widthPx);
        const distFt = distCm / 30.48;

        distBadge.innerText = distFt.toFixed(2) + " ft";
        const now   = (Date.now() - startTime) / 1000;
        const slope = calcSlope(now, distFt);
        updateGauges(distFt, slope);
        updateLiveStats(distFt, slope);

        if (recording) {
            const t = (Date.now() - startTime) / 1000;
            if (t >= parseFloat(maxTimeInput.value)) {
                stopRecording();
            } else if (t - lastRecordTime >= 0.05) {
                lastRecordTime = t;
                const tVal = parseFloat(t.toFixed(2));
                const dVal = parseFloat(distFt.toFixed(3));
                data.push([tVal, dVal]);
                chart.data.datasets[0].data.push({ x: tVal, y: dVal });
                chart.update('none');
            }
        }
    } else {
        distBadge.innerText = "No marker";
        lastKnownPixelWidth = null;
        videoWrapper.classList.remove('slope-pos','slope-neg','slope-zero');
    }
    requestAnimationFrame(processVideo);
}

// ════════════════════════════════════════════════
// CALIBRATE
// ════════════════════════════════════════════════
calibrateBtn.onclick = function () {
    if (!lastKnownPixelWidth) { alert("Hold marker in front of camera first."); return; }
    focalLength = (lastKnownPixelWidth * parseFloat(calibrationDistanceInput.value)) / parseFloat(markerSizeInput.value);
    startTime = Date.now();
    calStatus.textContent = "✓ Calibrated at " + calibrationDistanceInput.value + " cm";
    calStatus.classList.add("ok");
    closePanel();
};

// ════════════════════════════════════════════════
// RECORDING
// ════════════════════════════════════════════════
function playChime(isGo) {
    try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ac.createOscillator(), gain = ac.createGain();
        osc.connect(gain); gain.connect(ac.destination);
        osc.frequency.value = isGo ? 880 : 440; osc.type = 'sine';
        gain.gain.setValueAtTime(0.4, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + (isGo ? 0.6 : 0.25));
        osc.start(ac.currentTime); osc.stop(ac.currentTime + (isGo ? 0.6 : 0.25));
    } catch(e) {}
}

startBtn.onclick = function () {
    if (countingDown || recording) return;
    const delay = parseInt(countdownDelayInput.value) || 0;
    if (delay <= 0) { beginRecording(); return; }
    countingDown = true; startBtn.disabled = true;
    let remaining = delay;
    countdownOverlay.classList.add("visible");
    countdownNum.classList.remove('go');
    countdownNum.textContent = remaining;
    playChime(false);
    countdownTimer = setInterval(() => {
        remaining--;
        if (remaining > 0) {
            countdownNum.classList.remove('go');
            countdownNum.textContent = remaining;
            playChime(false);
        } else {
            countdownNum.classList.add('go');
            countdownNum.textContent = 'GO!';
            playChime(true);
            clearInterval(countdownTimer);
            setTimeout(() => {
                countdownOverlay.classList.remove("visible");
                countdownNum.classList.remove('go');
                countingDown = false; startBtn.disabled = false;
                beginRecording();
            }, 800);
        }
    }, 1000);
};

function beginRecording() {
    data = []; recording = true;
    startTime = Date.now(); lastRecordTime = 0;
    smoothBuffer = []; slopeBuffer = [];
    statusDot.classList.add("recording");
    // x-axis max = recording duration (unless window was manually expanded)
    const recDur = parseFloat(maxTimeInput.value) || 5;
    xAxisDurationInput.value = recDur;
    // Only reset x.max if we haven't manually expanded the window beyond recording duration
    if ((chart.options.scales.x.max || 5) < recDur) {
        chart.options.scales.x.max = recDur;
    }
    // Ghost previous run
    const prev = chart.data.datasets[0];
    if (prev && prev.data && prev.data.length > 0) {
        chart.data.datasets.push({
            label: 'Prev', data: prev.data.slice(),
            borderColor: 'rgba(0,229,255,0.18)', backgroundColor: 'transparent',
            borderWidth: 1, pointRadius: 0, fill: false, tension: 0.3
        });
    }
    // Fresh motion dataset at index 0
    chart.data.datasets[0] = {
        label: 'Motion', data: [],
        borderColor: '#00e5ff', backgroundColor: 'rgba(0,229,255,0.07)',
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 6,
        pointHoverBackgroundColor: '#fff', fill: false, tension: 0.3,
        segment: { borderColor: seg => getSegmentColor(seg) }
    };
    chart.update();
}

function stopRecording() {
    recording = false;
    statusDot.classList.remove("recording");
    statusDot.classList.add("active");
    rebuildChart();
    evaluateChallenge();
}

stopBtn.onclick = function () {
    if (countingDown) { clearInterval(countdownTimer); countdownOverlay.classList.remove("visible"); countingDown = false; startBtn.disabled = false; }
    if (recording) stopRecording();
    smoothBuffer = []; lastRecordTime = 0; slopeBuffer = [];
};

clearBtn.onclick = function () {
    if (countingDown) { clearInterval(countdownTimer); countdownOverlay.classList.remove("visible"); countingDown = false; }
    recording = false; startBtn.disabled = false; data = [];
    // Keep only first 2 core datasets (motion + regression), clear fn overlays
    chart.data.datasets = chart.data.datasets.slice(0, 2);
    chart.data.datasets[0].data = [];
    chart.data.datasets[1].data = []; chart.data.datasets[1].hidden = true;
    // Re-add fn overlay placeholders
    ensureFnDatasets();
    chart.update();
    smoothBuffer = []; lastRecordTime = 0; slopeBuffer = [];
    statusDot.classList.remove("recording");
    challengeScore.textContent = ''; challengeScore.className = '';
};

exportBtn.onclick = function () {
    if (!data.length) { alert("No data to export!"); return; }
    let csv = "time_seconds,distance_ft";
    const activeFns = fnFunctions.map((f,i) => f ? i : -1).filter(i => i >= 0);
    activeFns.forEach(i => { csv += `,fn${i+1}_value,fn${i+1}_residual`; });
    csv += "\n";
    data.forEach(([t, d]) => {
        let row = `${t},${d}`;
        activeFns.forEach(i => { const fv = fnFunctions[i](t); row += `,${fv.toFixed(4)},${(d-fv).toFixed(4)}`; });
        csv += row + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "motion_data.csv"; link.click();
};

// ════════════════════════════════════════════════
// VALUES TABLE
// ════════════════════════════════════════════════
tableBtn.onclick = () => { if (!data.length) { alert("No data yet!"); return; } buildTable(); tableModal.classList.add("visible"); };
closeTableBtn.onclick = () => tableModal.classList.remove("visible");

function buildTable() {
    const activeFns = fnFunctions.map((f,i) => f ? i : -1).filter(i => i >= 0);
    const samples   = sampleAtIntervals(data, 0.5);
    const reg       = data.length >= 3 ? linearRegression(data) : null;
    valTable.querySelector('thead').innerHTML = `<tr>
        <th>t (s)</th><th>Distance (ft)</th>
        ${reg ? '<th>Reg. y</th><th>Res.</th>' : ''}
        ${activeFns.map(i => `<th>f${i+1}(x)</th><th>Res.</th>`).join('')}
    </tr>`;
    const tbody = valTable.querySelector('tbody');
    tbody.innerHTML = '';
    samples.forEach(({ x: t, y: d }) => {
        const regY = reg ? reg.m * t + reg.b : null;
        const regR = regY !== null ? d - regY : null;
        const cls  = r => r === null ? '' : Math.abs(r) < 0.1 ? 'good' : Math.abs(r) < 0.3 ? 'ok' : 'miss';
        const fmt  = v => v !== null ? `${v >= 0 ? '+' : ''}${v.toFixed(3)}` : '';
        const fnCells = activeFns.map(i => {
            const fv = fnFunctions[i](t);
            const fr = d - fv;
            return `<td>${fv.toFixed(3)}</td><td class="residual ${cls(fr)}">${fmt(fr)}</td>`;
        }).join('');
        tbody.innerHTML += `<tr>
            <td>${t.toFixed(2)}</td><td>${d.toFixed(3)}</td>
            ${reg ? `<td>${regY.toFixed(3)}</td><td class="residual ${cls(regR)}">${fmt(regR)}</td>` : ''}
            ${fnCells}
        </tr>`;
    });
    let scoreHTML = '';
    if (reg) scoreHTML += `<span style="color:var(--accent)">R²=${reg.r2.toFixed(4)}</span> &nbsp; <span style="color:var(--muted)">y=${reg.m.toFixed(3)}x${reg.b>=0?'+':''}${reg.b.toFixed(3)}</span>`;
    activeFns.forEach(i => {
        const rmse  = calcRmse(data, fnFunctions[i]);
        const score = Math.max(0, Math.round(100 - rmse * 50));
        const emoji = score >= 90 ? '🏅' : score >= 70 ? '👍' : '📈';
        scoreHTML += `&nbsp; &nbsp; <span style="color:${FN_COLORS[i]}">f${i+1}: RMSE=${rmse.toFixed(3)}ft ${emoji}${score}/100</span>`;
    });
    tableScore.innerHTML = scoreHTML;
}

// ════════════════════════════════════════════════
// ARUCO MARKER SCREEN
// ════════════════════════════════════════════════
const DICT_ORIG = [
    [0b10001,0b11011,0b01010,0b00001,0b01011],[0b11100,0b11011,0b01110,0b11100,0b10111],
    [0b01110,0b11011,0b10101,0b01110,0b00100],[0b10110,0b01011,0b11001,0b00110,0b01001],
    [0b01011,0b10110,0b00111,0b11010,0b11100],[0b11010,0b01101,0b10010,0b10001,0b00011],
    [0b00111,0b10100,0b11001,0b01110,0b11010],[0b10000,0b00111,0b01101,0b10110,0b01111],
    [0b01101,0b10010,0b00110,0b01101,0b10010],[0b11001,0b00110,0b10011,0b01100,0b11001],
    [0b00100,0b11011,0b00111,0b11000,0b10110],[0b10011,0b01100,0b11001,0b10011,0b01100],
    [0b01001,0b10110,0b01011,0b10100,0b11010],[0b11010,0b10101,0b01010,0b11010,0b00101],
    [0b00110,0b01101,0b10110,0b01011,0b10100],[0b10101,0b01010,0b10101,0b01010,0b10101],
    [0b11000,0b00111,0b10011,0b00110,0b11001],[0b01111,0b10000,0b01111,0b10000,0b01111],
    [0b10010,0b11001,0b00110,0b01011,0b00100],[0b00001,0b11110,0b10101,0b01110,0b10001],
    [0b11011,0b00100,0b10110,0b01001,0b11101],[0b01010,0b10101,0b01010,0b10101,0b01010],
    [0b10100,0b01011,0b10100,0b01011,0b10100],[0b00011,0b11100,0b01111,0b00001,0b11110],
    [0b11100,0b00011,0b10001,0b11110,0b00001],[0b01000,0b10111,0b00010,0b11101,0b01000],
    [0b10111,0b01000,0b11101,0b00010,0b10111],[0b00101,0b11010,0b01101,0b10010,0b00101],
    [0b11010,0b00101,0b10010,0b01101,0b11010],[0b01100,0b10011,0b01100,0b10011,0b01100],
    [0b10001,0b01110,0b10001,0b01110,0b10001],[0b01110,0b10001,0b01110,0b10001,0b01110],
    [0b11110,0b00001,0b11110,0b00001,0b11110],[0b00001,0b11110,0b00001,0b11110,0b00001],
    [0b10110,0b11001,0b01101,0b00110,0b10011],[0b01001,0b00110,0b10010,0b11001,0b01100],
    [0b11101,0b00010,0b01011,0b10100,0b11101],[0b00010,0b11101,0b10100,0b01011,0b00010],
    [0b10011,0b11100,0b00011,0b11100,0b10011],[0b01100,0b00011,0b11100,0b00011,0b01100],
    [0b10100,0b10100,0b10100,0b10100,0b10100],[0b01011,0b01011,0b01011,0b01011,0b01011],
    [0b11000,0b11000,0b11000,0b11000,0b11000],[0b00111,0b00111,0b00111,0b00111,0b00111],
    [0b10010,0b01001,0b10010,0b01001,0b10010],[0b01101,0b10110,0b01101,0b10110,0b01101],
    [0b11011,0b00100,0b11011,0b00100,0b11011],[0b00100,0b11011,0b00100,0b11011,0b00100],
    [0b10101,0b10101,0b10101,0b10101,0b10101],[0b01010,0b01010,0b01010,0b01010,0b01010],
];

function drawMarker(id) {
    const bits   = DICT_ORIG[id % DICT_ORIG.length];
    const cells  = 7;
    const maxPx  = Math.floor(Math.min(window.innerWidth - 140, window.innerHeight) * 0.88);
    const cellPx = Math.floor(maxPx / cells);
    const size   = cells * cellPx;
    markerCanvas.width = size; markerCanvas.height = size;
    const mc = markerCanvas.getContext("2d");
    mc.fillStyle = '#000'; mc.fillRect(0, 0, size, size);
    for (let row = 0; row < cells; row++) {
        for (let col = 0; col < cells; col++) {
            let black;
            if (row === 0 || row === 6 || col === 0 || col === 6) { black = true; }
            else { const dr = row-1, dc = col-1; black = ((bits[dr] >> (4-dc)) & 1) === 1; }
            mc.fillStyle = black ? '#000' : '#fff';
            mc.fillRect(col * cellPx, row * cellPx, cellPx, cellPx);
        }
    }
    markerIdLabel.textContent = `ID: ${id}`;
    markerSizePx.textContent  = `${size} × ${size} px`;
    markerSizeCm.textContent  = `≈ ${(size * 0.02646).toFixed(1)} cm on screen`;
}

markerScreenBtn.onclick = () => { markerScreen.classList.add("visible"); drawMarker(0); };
markerBackBtn.onclick   = () => markerScreen.classList.remove("visible");
markerRandomBtn.onclick = () => drawMarker(Math.floor(Math.random() * DICT_ORIG.length));

// ════════════════════════════════════════════════
// SLOPE CHALLENGES
// ════════════════════════════════════════════════
const CHALLENGES = [
    { description: "Walk at a <span class='target'>constant</span> speed away — target: <span class='target'>+1.0 ft/sec</span>.", targetSlope:  1.0, tolerance: 0.25 },
    { description: "Hold <span class='target'>perfectly still</span> — target: <span class='target'>0.0 ft/sec</span>.",          targetSlope:  0.0, tolerance: 0.10 },
    { description: "Walk <span class='target'>slowly toward</span> the camera — target: <span class='target'>−0.5 ft/sec</span>.",targetSlope: -0.5, tolerance: 0.20 },
    { description: "Walk <span class='target'>quickly away</span> — target: <span class='target'>+2.0 ft/sec</span>.",             targetSlope:  2.0, tolerance: 0.40 },
    { description: "Walk <span class='target'>slowly away</span> — target: <span class='target'>+0.5 ft/sec</span>.",             targetSlope:  0.5, tolerance: 0.15 },
    { description: "Move <span class='target'>quickly toward</span> — target: <span class='target'>−1.5 ft/sec</span>.",          targetSlope: -1.5, tolerance: 0.40 },
];

newChallengeBtn.onclick = function () {
    currentChallenge = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
    challengeText.innerHTML = currentChallenge.description +
        `<br><br><em style="color:var(--muted);font-size:0.63rem">Record ~5s then press Stop or Judge My Run.</em>`;
    challengeScore.textContent = ''; challengeScore.className = '';
};
judgeChallengeBtn.onclick = evaluateChallenge;

function evaluateChallenge() {
    if (!currentChallenge || data.length < 4) return;
    const reg   = linearRegression(data);
    const error = Math.abs(reg.m - currentChallenge.targetSlope);
    const sign  = reg.m >= 0 ? '+' : '';
    const tgt   = currentChallenge.targetSlope;
    if (error <= currentChallenge.tolerance) {
        challengeScore.textContent = `🏅 Great! Slope: ${sign}${reg.m.toFixed(2)} (target ${tgt>=0?'+':''}${tgt.toFixed(1)})`;
        challengeScore.className = 'great';
    } else if (error <= currentChallenge.tolerance * 2) {
        challengeScore.textContent = `👍 Close! Slope: ${sign}${reg.m.toFixed(2)} (target ${tgt>=0?'+':''}${tgt.toFixed(1)})`;
        challengeScore.className = 'ok';
    } else {
        challengeScore.textContent = `Keep trying! Slope: ${sign}${reg.m.toFixed(2)} (target ${tgt>=0?'+':''}${tgt.toFixed(1)})`;
        challengeScore.className = 'miss';
    }
}
