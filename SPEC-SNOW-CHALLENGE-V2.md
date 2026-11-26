# SPEC: Snow Challenge v2 (GraFables)

For Claude Code. Revised 11/26/2026 (second pass) from the design chat with Karl. Builds on `SPEC-SNOW-CHALLENGE-V1.md` and the build report for commit b641fe2. This spec only says what is NEW or CHANGED; everything not mentioned stays as built. Replaces the earlier draft of this file.

## Decisions Karl made on the Phase 1A plan (11/26/2026)

Recorded here so later sessions see them. These override the text below where they differ.

1. Melting is capped at exactly 0. Explorer's hour options offer only durations that keep depth ≥ 0, and "All melted" shows at 0.
2. Explorer never shortens later pieces. Choices that would push a later piece over the cap (or below 0) are greyed out with a short hover/tap reason ("That would push a later piece past 15 inches").
3. The 40%-peak target applies at Levels 2 and 3 only. Level 1 is exempt, but single snowing pieces at Level 1 should still use a good share of the height.
4. Axis and stake labels always include the top line, even when the cap isn't a multiple of 3.
5. The Match slider lock and the starting-depth display (Sections 4a and 6a) are built in Phase 1A.

## Prompt to paste into Claude Code

> Read SPEC-SNOW-CHALLENGE-V2.md. Before writing code, report back: your plan for Phase 1A (files you'll touch, the constants you'll introduce, how you'll rebuild the scene), plus any place where this spec conflicts with what's in the repo. Wait for my OK, then build one phase at a time. End each phase with the review checklist link and a handoff summary, as you did for build 0835919.

## 0. Ground rules

- **Starting point is current `main`** (layout cleanup is already merged in b641fe2: graph left, story and scene right, square unit grids, thin lines). Do not undo it. Section 1 changes the layout again.
- **Do not put an unfinished mode in the live menu.** The 12/4 Algebra 1 class uses whatever is live. A mode appears in the menu only when its phase is complete and checked. Until then, reach it with `?dev=1`. Existing links (`?mode=match`, `?mode=explorer`, `&level=`, `&seed=`, `&reset=1`, etc.) must keep working.
- **Everything is open.** No unlocking. Every built challenge is available from the first visit.
- Keep: levels, localStorage in try/catch, reduced-motion handling, the stake-to-graph link line, colors (run = blue `#1A56DB`, rise = orange `#E07B00`), no new fonts, no dependencies beyond Chart.js.
- Put all pure logic (anything testable without a browser) in `snowModel.js` and extend `snowModel.test.mjs`. UI code stays in the page.
- **Scale constants.** Introduce `MAX_DEPTH` (inches), `MAX_HOURS`, and derive from them everything that currently hard-codes 12: axes, gridlines, stake ticks, scene scale, generator limits, distractor limits, tests. Changing a constant must recalibrate the whole page.

## 1. Screen layout, menu and start screen

### 1a. Three columns

```
| MENU (left) | GRAPH (middle) | STORY + SCENE (right) |
```

- **Left: the challenge menu.** A card for each challenge (icon, name, one-line description, its current level, and its medal: bronze/silver/gold/none from that mode's best streak). Cards are all open. The current challenge is highlighted. **Explorer sits at the bottom**, set apart from the challenges (a divider labeled "Free play" or similar).
- **Middle: the graph** (and, in challenge modes, the answer area; see each mode).
- **Right: the story sentence above the scene, then the slider and playback row** (Section 4a).
- The top bar loses the mode buttons: Back to Home, the SNOW CHALLENGE title, the current mode's stat chips (score, streak, level, medal), and the theme toggle.
- **Collapsing menu.** At 1366×768 there is not room for menu + builder/answer area + graph + scene all at once. On the start screen the menu is full width (about 240px). Once a mode is chosen, the menu collapses to a narrow rail (icon and a medal pip per mode; tap to expand it as an overlay; a clear way back to the full menu). Propose your widths with a screenshot in your plan. No horizontal scroll at 1366×768.
- Mode cards only for finished modes (Section 0).

### 1b. The start screen is a living demo ("Explorer light")

- With no `mode` in the URL, the page opens to the menu plus the graph and scene **playing a random snow story on repeat**: generate a forecast (1 to 3 pieces), play it from hour 0 to the end, hold the finished graph about 2 seconds, generate a new one, repeat. The story sentence shows above the scene as it plays.
- No score. No controls other than the menu, the slider and graph hover/pin (Section 4). If the student touches the slider or pins a point, pause the loop; resume after about 10 seconds with no interaction (constant).
- Pause the loop when the tab is hidden (`visibilitychange`). With reduced motion on, the loop still advances the graph and snow level but there are no falling flakes or birds.

## 2. The new scale

- **`MAX_DEPTH = 15` inches.** Graphs are taller. y-axis labels every 3 (0, 3, 6, 9, 12, 15) and a gridline every inch. The stake is marked every inch to 15 and labeled every 3.
- **`MAX_HOURS = 12`** to start. Karl may want 10 (fewer hours, taller graphs). Build both constants so 10 is a one-line change, and **include screenshots of Explorer and a Match round at both 10 and 12** in the Phase 1A report so Karl can pick.
- **Unit squares stay.** The plot is `MAX_HOURS` units wide and `MAX_DEPTH` units tall, with the same pixel size per unit on both axes. That makes the plot taller than wide (12×15 is 4:5), so the CSS sizing that currently assumes a square plot must use the constants.
- **Minimum cell size:** one inch/hour grid cell must be at least 16 px at 1366×768 in every mode, including the Match choice graphs. Grid lines are thin and low-contrast; labels stay legible. If a layout cannot meet 16 px, say so and propose a trade-off.
- **Match choice graphs:** the four graphs are taller than wide. Karl suggests tiling them left to right. Try both a 2×2 and a 1×4 row, measure the cell size each gives at 1366×768 (with the menu collapsed to the rail), and use whichever gives the larger cells. Show Karl the screenshot of each.
- **Calibrate the generator and the Explorer menus for the new height.** Today a start depth of 6 plus 3 inches an hour for 6 hours runs off the top. Rules:
  - A forecast's depth must stay within `[0, MAX_DEPTH]` at every corner.
  - Durations are limited by the room left (depth cap) as well as by `MAX_HOURS`. Explorer's hour dropdowns offer only hours that fit under both limits.
  - Generated forecasts should use a good share of the height (aim for the peak to reach at least about 40% of `MAX_DEPTH` in most rounds) and sometimes use the fast rates (3 in/hr for a short stretch).
  - Starting depth range: 0 to 6 as now (constant).
  - Update the 5,000-seed tests: depth in `[0, MAX_DEPTH]`, total time at most `MAX_HOURS`.

## 3. The scene, rebuilt

Goal: the scene reads as a view of snow piling up right in front of you, with a distant world behind it. Depth in the picture matches depth on the graph.

### 3a. Three bands, top to bottom

| Band | Share of image height | Contents |
|---|---|---|
| Sky and clouds | top ~30% | night sky, moon or sun glow, clouds (they roll in from the distance), cloud layer sits here |
| Background | middle ~20% | rolling hills, a few small trees, hazy and low-contrast; snow is falling through this band too |
| Foreground | bottom ~50% | the snow-measuring zone: ground at the bottom, snowpack rising from it, the measuring stake, one close object |

Treat the percentages as targets. Falling snow **starts at the very top edge of the image** and falls through all three bands.

### 3b. Depth scale

- **Depth 0 is the ground line near the bottom of the image. Depth `MAX_DEPTH` is the top of the foreground band** (about the middle of the image), where the stake ends. One linear scale, `PX_PER_INCH` derived from the constants. The stake, the snow top, and the link line all use the same scale. Add a test that the stake mark for each whole inch equals the scale.
- The dashed link line from the snow top on the stake to the graph's moving point stays.

### 3c. Ground

- A brown ground strip at the bottom. **More texture**: soil speckle, small stones, a few dry grass tufts along its upper edge, subtle low-contrast variation. Static (no animated filters; this must run smoothly on Chromebooks). Visible when depth is 0 and when snow melts back to near 0.

### 3d. The snow layer (replace the current drift)

- **Remove the curved mound** (the shoulder that curves down, the drift path, and its anchoring code). The snow is a **flat-topped layer at exactly the current depth, spanning the full width of the foreground**, rising from the ground line. Its top edge is a clean horizontal line with a thin bright highlight; a faint sparkle or fine texture on the snow is fine; no bumps or curves.
- Behind the snowpack, the foreground backdrop must contrast with white snow so the top edge reads clearly (a dark, slightly soft night-yard tone, not white and not the hill color).

### 3e. Accumulation: you can see it fall and pile up

- Flakes spawn above the top edge and fall at varied speeds and sizes to suggest depth (small and slow in the background, larger and faster near the foreground). Background flakes fade out at the hills; foreground flakes continue to the snow surface.
- **When a foreground flake reaches the snow surface it lands and melts in:** a short squash/fade (about a quarter second) so it visibly merges into the snow, never lingering as a dot on top.
- The snow top rises continuously with `depthAt(t)`. Higher rates make it visibly climb faster and look denser (flake density tiers stay: light, medium, heavy, set by the rate).
- Melting: no flakes; sun out; the snow top lowers steadily. Cloudy: gray clouds, no flakes, snow top still.
- Reduced motion: no falling flakes or landing effects; the snow top and stake still update.

### 3f. A closer object for depth: bird feeder on a pole

Karl wanted something in the foreground that feels closer than everything in the distance and that does not collect snow. Build a **bird feeder on a tall, thin pole**, planted in the foreground on the right side (away from the stake and the link line). Make it larger than the distant tree. Keep the feeder tray above the `MAX_DEPTH` line so snow never reaches it; the thin pole barely shows accumulation, and snow rises around its base like everything else.

Every 15 to 40 seconds (random) one or two small birds can visit, only when it is not snowing heavily. They should be simple and quiet. No birds with reduced motion. If this turns out to look cluttered at 1366×768, fall back to a plain fence post and tell Karl.

### 3g. Theme

The scene stays a night sky in the light theme, as now.

## 4. Shared features

### 4a. Timeline slider (replaces the "Hour N" bar under the scene)

- **The slider takes the place of the bar under the scene that currently shows the hour.** It runs from hour 0 to the forecast's total hours, with whole-hour tick marks labeled every 3. A small readout of the current hour sits with it.
- **The scene always matches the slider**: snow height, stake, weather, flakes, the link line. While playing, the thumb advances by itself. Dragging pauses playback and the scene follows. Play resumes from the thumb. Replay goes to hour 0.
- Keyboard: Left/Right arrows move 1 hour (Shift = ¼ hour). Focusable, with a visible focus ring.
- The row under the scene is: slider, then Play / Replay / speed (Slow, Normal, Fast), then the weather badge.
- One pure function `depthAt(forecast, t)` in `snowModel.js` for any real `t`. Scene, cursor and hover all use it so they cannot disagree.
- **Leak rule:** in modes where the true forecast is the answer (Match the Forecast before a pick; Draw the Forecast before checking), the slider and Play are disabled and the scene sits at hour 0 showing the story's starting depth. Scrubbing would reveal the answer. In Story Match and Fill in the slider is on (stopping time is the point).

### 4b. Hover and pin on graphs

`fulllab.html` already has this pattern (`hoverPreview`, `pinnedPoints`, the hover plugin, `drawAxisChip`, click again to unpin). Read it and match its look and behavior. Differences here:

- **Hover snaps to the nearest WHOLE HOUR on the line**, never between hours. Show a soft highlighted dot and the value chips on the axes, as in Full Lab.
- **Hovering moves the scene to that hour** and the slider thumb. When the cursor leaves, the scene returns to where it was.
- **Click pins the point.** It stays, with its coordinates beside it, e.g. `(4, 3⅓)`. Click a pinned point to remove it. Several pins allowed. They survive slider moves and Play; they clear on a new round or when the forecast changes.
- **Depths show as whole numbers, fractions or mixed numbers, never decimals** (`3⅓`, not `3.33`).
- Touch and trackpad: a tap hovers and pins in one step.
- Works in the start-screen demo, Explorer, Story Match, Fill in, and the reveal in Draw. Not on the small choice graphs in Match the Forecast. No table feature for now.

### 4c. Separate score, streak, level and medals for each mode

- Each mode has its own score, streak, level and best medal. Streak medals: 3 in a row = bronze, 5 = silver, 10 = gold. Medals are never lost. The menu cards show each mode's medal and level.
- Storage: one key per mode. Migrate the existing Match the Forecast data into mode `match`.
- Scoring as built: first-try correct = +1 and +1 streak; first-try miss = −2 (floor 0), streak to 0; each round counts once; a wrong pick never drops a level; 3 first-try wins in a row = level up. `?reset=1` still clears everything; add a way to clear one mode.
- Explorer and the start screen have no score.

### 4d. Polish to the GraFables standard

Karl's review: Snow Challenge looks low-tech next to the rest of GraFables. Before changing anything, open `index.html` and `fulllab.html` and study how the header, buttons and controls are built. Then bring the Snow page into the same family.

What the rest of the site does that Snow does not yet: a 2px accent line under the header; small-caps group labels above control groups; "stacked" chip buttons (tiny label over a bold value) with hover and active accents; cards on `--surface` / `--surface2` with 7 to 10px radii and 1px `--border`; Space Mono for labels and numbers, DM Sans for body text. Snow uses unstyled checkboxes and native `<select>` dropdowns, and plain text for score.

Specific changes (propose in your Phase plan; Karl reviews screenshots):
1. The menu cards from Section 1 (this is the main one).
2. Stat chips and a medal icon in the top bar, in the Full Lab chip style.
3. Explorer's controls: Section 5.
4. Styled Play (primary) / Replay, speed as a segmented control, the slider from 4a.
5. Consistent radii, borders, hover, focus and pressed states for every button, choice card and feedback line.
6. Light theme works everywhere.

Constraints: no scroll at 1366×768; text at least 16 px (Space Mono small-caps group labels may be smaller if purely decorative); visible keyboard focus; touch works; keep Snow's yellow (`--accent4`) identity.

## 5. Explorer v2

Two ways to make a forecast, chosen with a segmented control at the top of the Explorer panel: **Build the story** and **Draw the graph**. Play, the slider, hover/pin, the story sentence and the rise/run toggle all work in both.

### 5a. Build the story

- **Starting depth** as a sentence at the top: "At hour 0 there are [3 ▾] inches of snow."
- Each weather piece is a **card written as a sentence**, with dropdown-style parts the student fills in:
  - Snowing: "It is [snowing ▾] [2 inches every 3 hours ▾] [for 3 hours ▾]."
  - Cloudy: "It is [cloudy ▾] [for 2 hours ▾]."
  - Sunny: "The sun is out and the snow melts [1 inch every hour ▾] [for 2 hours ▾]."
  Rates stay in "a inches every b hours" form.
- **The time part is itself a choice.** Clicking it offers three phrasings: **"for N hours"**, **"from hour A to hour B"**, **"until hour B"**. Pieces are contiguous, so in "from A to B" the A is fixed to where the previous piece ended (shown but not editable) and only B changes; in "until B" only B changes. Switching phrasing keeps the same forecast and just rewrites the sentence.
- **Each piece gets its own color, and the graph shades that piece's time span in the same color.** First piece light green, second light yellow, third a light lavender (tokens `--piece-1`, `--piece-2`, `--piece-3`). The card's background and the vertical band behind that part of the graph match. Dark and light themes both need legible tints (low-alpha fills on dark). Piece colors must not collide with the blue (run) and orange (rise) used for steps.
- **The button says "+ Add to the story"** (not "Add Segment"). Up to 3 pieces (constant). Disabled when no time or depth room is left. Each card has a remove (×).
- The weather choice uses a three-way segmented control with icons (Snow, Cloudy, Melt) inside the sentence, or a styled dropdown; Karl said he likes dropdowns, so either is fine, but no unstyled native `<select>`.
- Keep: "Show the story" and "Show rise/run steps" as styled toggle switches, the 12-hour (`MAX_HOURS`) and depth limits, "All melted" behavior at 0.

### 5b. Draw the graph

Two drawing methods, with a small switch between them. Both draw on the live graph. Whichever the student uses, the scene and the slider then play what they drew.

**Click points (straight pieces):**
- Click a starting point, then click the next point; each click adds a straight piece from the last point, which becomes the start of the next piece automatically.
- Clicks snap to whole-number grid corners. The first click must be at hour 0 (otherwise a gentle message: "Start at hour 0."). Each next click must be at a later hour than the last point; otherwise show "Time only moves forward. Click to the right of your last point." and ignore the click.
- Buttons: Undo, Clear. Play is available once there are at least 2 points; the forecast ends at the last point (or at `MAX_HOURS`).
- The drawing is converted to a forecast: each piece's weather comes from the sign of its slope (up = snow, flat = cloudy, down = melt), its rate is reduced rise/run, and the story sentence and rise/run steps are generated from it as in Build mode. Pieces get the same colors and shading as Build mode.

**Freehand (drag a line or curve):**
- Press and drag to draw. Sample the stroke about every 0.1 hour; depth clamps to `[0, MAX_DEPTH]`.
- **It must be a function: left to right only.** If the pointer moves back to the left (beyond a small tolerance), stop the stroke, show "Draw only left to right. Try again.", clear the stroke, and let the student redraw. Same message if the first press is not at the left edge (hour 0).
- No story sentence for a freehand curve (there are no neat rates). The scene derives weather from the local slope (rising = snow, with density tiers by steepness; flat = cloudy; falling = melt) and `depthAt(t)` interpolates the sampled points. Show "Your own graph" in place of a story. Hover/pin and the slider still work.
- Works with touch (pointer events), because students use Chromebooks.

Draw mode is for exploring. No scoring.

## 6. The challenges

Each is a menu card, all open, each with its own score, streak, level and medals.

| Mode id | Working name | Student does | Phase |
|---|---|---|---|
| `match` | Match the Forecast (exists) | Reads a story, picks the graph | exists |
| `story` | Match the Story | Watches scene and graph, picks the story | 2 |
| `fill` | Fill in the Forecast | Reads the graph, types each piece's interval and rate | 3 |
| `draw` | Draw the Forecast | Reads the story, draws the graph by clicking | 4 |
| `explorer` | Explorer | Builds or draws a forecast and watches it | 1C |

Mode names are constants in one place ("Match the Story" and "Match the Forecast" are easy to mix up; Karl may rename). V1's "Read the Rate" is replaced by `fill`.

### 6a. Match the Forecast (changes only)

- Scene before a pick: show the story's true **starting depth** at hour 0 (not bare ground), static; slider and Play disabled until a pick (Section 4a leak rule). After a pick, the scene plays the correct forecast and the slider turns on.
- **Open question for Karl (Claude Code found this):** wrong graphs can end at different hours, so a student can spot a "one piece too short" graph by its length without reading the story. Default for v2: **all four graphs in a round end at the same hour.** Where a distractor changes one piece's length, move the difference into another piece so the total stays the same. Karl may reverse this if he wants length to be a test.
- Graph sizing and tiling per Section 2.

### 6b. Match the Story (Phase 2)

**What the student sees:** the scene (right) plays the forecast and the graph (middle) is fully drawn with a moving point and highlighted trace following the scene and the slider. Four story options appear in the answer area. The student picks the story that matches. After a pick: right or wrong feedback, and replay, as in Match the Forecast.

**Layout:** the stories are long, so the graph needs to stay a unit-grid plot at least 16 px per cell AND four readable story cards must fit with no scroll at 1366×768. Propose your layout with a screenshot before building the whole mode. If both cannot fit, tell Karl and propose a trade-off rather than shrinking text below 16 px.

**Options:** each is a full story from `forecastStory`, shown in random order.

**Distractor design is the pedagogy.** Each item has a *teaching intent*. The generator picks an intent, then builds three distractors to test it:

| Intent id | Tests | How the distractors differ |
|---|---|---|
| `readStart` | Reading the y-intercept | Different starting depths; rates and times identical |
| `readSlope` | Reading the slope correctly | Same start, same durations; rates differ (1/3, 1/2, 2/3 etc.) |
| `readRatePair` | Rise vs. run, the key distinction | Examples: "2 inches every hour for 3 hours" vs. "3 inches every 2 hours for 6 hours"; rise and run swapped; same rise, different run |
| `readDuration` | How long each weather lasted | Same rates, different piece lengths |
| `readShape` | Snow vs. cloudy vs. melt | Cloudy as melting, melting as snowing |

Difficulty rules:
- **The y-intercept is held nearly constant as levels go up.** Level 1: starting depth may differ across options (`readStart` allowed). Level 2 and up: all four share the same start, or at most ONE distractor differs, so the start is never the giveaway unless the item tests it.
- Level N = N weather pieces. At Levels 2 and 3, distractors are near misses that agree with the correct story in most pieces and differ in one piece's rate or duration. Include very close rates, not only obvious ones.

**Hard requirements:**
1. Four options, exactly one correct.
2. The four must produce four DIFFERENT GRAPHS. Compare graphs, not text ("1 inch every 2 hours" and "2 inches every 4 hours" are the same graph and must never both appear).
3. Every distractor graph looks like a real forecast (depth `0` to `MAX_DEPTH`, whole-number corners, nothing past `MAX_HOURS`).
4. Every distractor is tagged with its intent/rule so feedback can name it.
5. The scene always plays the CORRECT forecast. (Flake density will help rule out very different rates; that is fine.)

**Feedback after a wrong pick:** one short line naming the difference, plus the pieces highlighted on the graph where the chosen story's graph and the true graph split. Show the chosen story's graph as a dashed overlay on the true one.

### 6c. Fill in the Forecast (Phase 3)

**What the student sees:** the graph is given (with the scene, slider and hover/pin to help). A form has one row per weather piece, plus a starting-depth box. Do NOT shade the pieces before checking: the shading would show where the pieces break, which the student must find. After a check, shade each piece in its Explorer color and tint the matching row.

**Each row:** an interval phrase with typed numbers; a weather choice (it snowed / it was cloudy / the snow melted); "at a rate of ___ inches per hour". Top of the form: "At hour 0 there were ___ inches of snow."

**Interval phrases (mixed by level):**
- **From hour __ to hour __.** (two numbers)
- **For the next __ hours.** (the student works out each piece's start from the previous one)
- **Until hour __.** (the last piece, e.g. "and then, until hour 12"; one number)

Level 1: one piece, "From … to …". Level 2: two pieces, "From … to …" and "For the next …". Level 3: three pieces using all three phrases, ending with "Until …". Rows equal the number of pieces.

**Stretch idea (do NOT build; ask Karl first):** a time-of-day framing ("tracked from 9 AM to 9 PM", "until 3 PM"). The axis would still be hours since the start, so students convert. Hours-only ships first.

**Rate input rules:**
- Accept whole numbers (`2`, `0`, `-1`), fractions (`2/3`, and equivalents like `4/6`), mixed numbers (`1 1/2`), a hyphen or Unicode minus (`−1/2`), spaces around the slash.
- Accept a decimal ONLY if it is a terminating decimal that is exactly right (`0.5`, `1.5`). Reject approximations (`0.67`, `.333`) with "Try writing that as a fraction."
- Reject empty, `x/0`, text and commas. Never crash.
- Cloudy means rate `0`; the student types it. Melting is negative.
- If the weather choice and the rate sign disagree (chose "snowed", typed `-1/2`), say so specifically before marking right or wrong.
- Checked by VALUE (4/6 equals 2/3). After a correct answer show the simplest fraction.
- `parseRate(text)` in `snowModel.js` returns `{ok, value, numerator, denominator, message}`, with unit tests (Section 8).

**Checking:** one Check button for the round. Mark each row right or wrong and say what is wrong (interval, rate, weather, or start). Wrong rows highlight their piece on the graph. The first Check decides the score (first-try correct only if every row and the start are right). After that the student may fix and re-check until all are right, with no more score change.

### 6d. Draw the Forecast (Phase 4)

**What the student sees:** the story in large type above the scene. The graph is an empty unit grid. The student draws with the same click-points method as Explorer (5b), with these differences: **do not mark the starting depth** (the student places their own first point, at hour 0), and clicking an hour that already has a point moves that point; clicking exactly on a placed point removes it. Buttons: Undo, Clear, Check (enabled with at least two points). The slider and Play are disabled until checked (Section 4a).

**Checking:** compare as FUNCTIONS, not point lists. If both graphs have corners only on whole hours, they are equal exactly when they agree at every whole hour from 0 to the end. Extra points along a straight piece do not make it wrong. A graph that stops before the end of the story is wrong. `gradeDrawing(studentPoints, forecast)` in `snowModel.js` returns whether it is correct, the first hour they differ, and a rule tag (wrong start, wrong rate on a piece, piece too long or short, melt drawn as snow, stops early).

**After checking (the reveal):**
- Both graphs on the SAME coordinate plane: the true graph in ink, the student's in `--accent2` (pink).
- The scene plays both. **Default: superimposed.** The true forecast is the solid snow layer; the student's version is a dashed pink outline of the snow top with its own tick on the stake. When the student is right the two coincide. Optional "side by side" toggle if cheap.
- The slider and hover/pin work on the reveal. Shade the true graph's pieces in the Explorer colors.
- One short line naming the first split ("Your graph goes up between hour 2 and hour 5, but it was cloudy.").

Level N = N weather pieces; levels also widen the rates used (integers, then halves, then thirds).

## 7. Order of work

1. **Phase 1A: scale and scene.** `MAX_DEPTH = 15` and the constants (Section 2), generator calibration and tests, the rebuilt scene (Section 3), the slider replacing the hour bar (4a), taller graphs and the 10-vs-12 screenshots. Applies to the existing Explorer and Match the Forecast.
2. **Phase 1B: shell.** Three-column layout, menu with medals, collapsing rail, start-screen demo (Section 1), polish (4d), per-mode scoring (4c), hover/pin (4b), Match the Forecast changes (6a).
3. **Phase 1C: Explorer v2.** Build the story with colored pieces and shaded graph, and Draw the graph (Section 5).
4. **Phase 2:** Match the Story.
5. **Phase 3:** Fill in the Forecast.
6. **Phase 4:** Draw the Forecast.

Reason: the scale and scene change every mode, so they go first. The shell and shared features come before new modes so each new mode inherits them. Draw the Forecast comes last because it reuses Explorer's click-drawing.

## 8. Checks to run and report

Extend `snowModel.test.mjs`. Use 5,000 seeds wherever generators are involved.

- Scale: every generated forecast has depth in `[0, MAX_DEPTH]` at every corner and total time at most `MAX_HOURS`; the Explorer dropdowns never offer an option that breaks either limit; changing the constants to 10 hours or a different depth cap recalibrates tests and page.
- `depthAt(forecast, t)`: matches `forecastPoints` at every corner, is continuous, and equals the stake height at every whole and half hour.
- Hover snap: any x pixel maps to the nearest whole hour, clamped to the forecast's range.
- Match the Forecast: four graphs, one correct, all four distinct; all four end at the same hour (if Karl keeps the default); each distractor tagged.
- Story Match generator: four options, one correct, four distinct GRAPHS; each distractor tagged with an intent; at Level 2+ at most one distractor has a different start; no equivalent-rate duplicates; all depths valid.
- `parseRate`: accepts `2`, `0`, `-3`, `2/3`, `4/6`, `1 1/2`, `0.5`, `1.5`, `−1/2`, ` 3 / 2 `; rejects `0.67`, `.333`, `1/0`, `abc`, empty, `2/`, `1,5`, `--1`.
- `gradeDrawing`: the true polyline passes; the true polyline with extra collinear points passes; wrong start, flipped slope, stops early, one piece too long or short each fail with the right tag.
- Explorer drawing: click-points enforces hour 0 start and left-to-right order; freehand rejects any leftward movement and a late start; a drawn graph converts to a valid forecast (weather by slope sign, reduced rise/run).
- Per-mode storage: one mode's scores never change another's; the old Match data migrates; `?reset=1` clears all.
- Browser, 1366×768, dark and light: no scrolling, no console errors, text at least 16 px, one grid cell at least 16 px, keyboard-only use of the slider and menu works, a touch tap pins a point, the start screen loops cleanly and pauses when the tab is hidden, reduced motion shows no flakes or birds.
- Screenshots at 1366×768 (2×): start screen mid-loop; Explorer Build with three colored pieces and shaded graph; Explorer Draw with a freehand curve and the left-to-right error; the scene with deep snow (flakes landing), at depth 0 (textured ground), and while melting; a hover with the scene jump; a pinned point with coordinates; the menu with medals; each new mode before answering, after a wrong answer, and after a right answer; a Match round at 10 and 12 hours.
- List every constant you created (name, default, file) and every decision this spec doesn't cover.

## 9. Decisions I made for Karl (revisit if wrong)

1. The menu collapses to a narrow rail once a mode is chosen, because four columns do not fit at 1366×768.
2. The start screen is an auto-looping random story; touching it pauses the loop.
3. The scene foreground is a side-on view where the snowpack rises from the ground at the bottom to the stake top at about mid-image; the backdrop behind the pack is dark so the white top edge reads.
4. The foreground object is a bird feeder on a pole, with a plain fence post as the fallback.
5. In Explorer's click-points drawing, snapping is to whole-number corners, the first click must be at hour 0, and the student can play any time after two points (the story ends at the last point). Freehand errors clear the stroke so the student redraws.
6. In Match the Story the full graph is visible from the start; the scene and a moving point play along with it.
7. Hover and pins show depth as fractions or mixed numbers, never decimals.
8. Fill in uses hours since the start; the time-of-day version is a stretch idea only.
9. Draw's reveal is superimposed by default.
10. No table feature; no hover on the four small choice graphs in Match the Forecast; the scene stays a night sky in the light theme.
11. A first-try miss still costs 2 points at every level. Karl has not decided whether Level 1 should be gentler.
12. In Match the Forecast and Draw the Forecast the slider is locked until the answer is in, because scrubbing the scene would give the answer away.

## 10. Not building yet

- Table of values, average rate of change, write-the-forecast, teacher tools, sound, level-up animation, onboarding or a "how to play".
- Time-of-day framing for Fill in.
- Motion Flight and Match the Graph teaser cards on the homepage.
