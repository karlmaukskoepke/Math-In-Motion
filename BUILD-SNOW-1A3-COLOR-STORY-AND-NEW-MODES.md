# BUILD: Snow Challenge 1A.3 (color-coded story, streak bar) + Match the Story + Draw the Forecast

For Claude Code. Written 11/27/2026 after Karl tried the 1A.2 branch. Builds on `SPEC-SNOW-CHALLENGE-V2.md` and `BUILD-SNOW-1A2-OVERLAY-DAYNIGHT-GRASS.md`. Where this doc and those disagree, this doc wins. Nothing here goes to main until Karl has tried it and says OK. Phase 1B (menu, start screen, polish) still comes after.

## Karl's answers to the plan (11/27), recorded for later sessions

- Match the Forecast choice tiles: a 1×4 row is fine; 2×2 is also fine if that fits better (the page picks whichever gives larger cells). ~14 px per cell accepted.
- Piece colors: Claude's choice, colorblind-resistant (teal / violet / honey instead of green / violet / gold-brown, which merge under protanopia/deuteranopia).
- Draw the Forecast: the student draws in **plain ink (black and white)**, piece by piece; they can click a story piece to redo it. The TRUE graph appears in piece colors only at the reveal.
- Match the Story: the four stories' graphs **end at the same hour**, and usually **start at the same depth**. Durations of the pieces should usually be the same across options, so the student has to work with **slope**; a duration difference may appear as one deviation, but not as the main test every time.
- Medal colors (bronze, silver, gold) all get a metallic look with shine.
- The current-mode header button shows as active with a bold label and underline, not yellow, so it does not clash with a gold medal.

---

## 0. What Karl asked for

1. In the challenges, the story reads above the graphs, in larger text.
2. After a pick, the chosen graph moves over and autoplays after a short beat (about half a second). The slider is for replaying and examining.
3. Most important: each part of the story gets a color, and the story text for that part and the matching graph segment turn that color, so students see how each part of the story shows up on the graph. In Explorer and in the challenges.
4. On a mistake in Match the Forecast, show the difference, especially the slopes.
5. Hover over the graph afterward to see points (the hover/pin from the spec).
6. The streak, score and medals are hard to see. Move them below the graphs, make them big, and have the mode buttons at the top turn bronze, silver or gold as the student earns medals.
7. A new mode: a graph is given; the student picks the story; the chosen story is drawn in color over the given graph.
8. A third mode: a story is given; the student builds the graph piece by piece by clicking.

## 1. Match the Forecast: layout and flow fixes

### 1a. The story above the graphs, bigger
- Move the story out from above the scene and put it above the four choice graphs in the left pane, in larger text than now (start at about 1.4× the current size; it must stay readable at 1366×768).
- Below the choice area, the streak bar (Section 4).
- This is height-tight. Measure and report the cell size you get. If the tiles fall below 16 px per cell, you may go down to 14 px per cell for the four choice tiles only; the overlay on the inset stays at 16 px per inch. Ideas that save height: let the story span the full width of the left pane, let the feedback line live in the streak bar's row or in the space the tiles leave after the pick, and let the three grayed-out tiles shrink or fade after the pick so the verdict panel (Section 3) can use the space.
- Explorer keeps its story where it is (above the scene) unless it turns out simpler to match.

### 1b. Autoplay after the pick
Replaces 1A.2 Section 2, step 2 (no autoplay and the pulsing Play).
- Pick locks in (scored now, shown at the verdict, as built). The other three gray out. The chosen graph slides onto the inset (about 400 ms).
- Then wait about 500 ms (constant `AUTOPLAY_BEAT_MS`) and start playing automatically, at Fast, with the yellow dot tracing as built.
- The slider and Replay stay available. Remove the pulsing Play. Keep Show result as a skip.
- Reduced motion: autoplay still runs; there are just no flakes or birds.

## 2. Color-coded story (Explorer and every challenge)
Each weather piece of a forecast gets a color by its position: piece 1, piece 2, piece 3. The same color is used for the story text, the graph segment, and any piece label.
- Tokens: `--piece-1`, `--piece-2`, `--piece-3`, each with a dark-theme and light-theme value. One place to change them.
- Requirements: each color reaches 4.5:1 against its background for text in both page themes; the three stay distinguishable under a color-blind simulation (deuteranopia and protanopia); none is confusable with the blue/orange steps or the red/green verdict.
- The story: the generated sentence is split by piece, and each piece's sentence is colored (bold weight, not only color). The starting-depth sentence has no color.
- The graph: each straight piece of the line is drawn in its piece color; colors change exactly at the corner.
- During playback, the piece the dot is in gets emphasized; the others soften a little. Scrubbing updates this.
- Explorer: each piece's card carries its piece color (accent bar or tint); story sentence and graph segment use it. Replaces the spec's light-green/yellow/lavender tints.
- Match the Forecast: the story text stays plain until the pick. At the reveal, the story pieces take their colors and the TRUE path draws in the piece colors as the dot traces it, over the student's chosen line (plain ink, dashed if it differs). Replaces the pink true path from 1A.2.

## 3. Showing the difference after a wrong pick (Match the Forecast)
`describeDifference(chosenForecast, trueForecast)` in `snowModel.js` returns:
- `kind`: `slope`, `start`, `length`, or `shape` (cloudy drawn as melting, or the reverse; shown as a slope difference).
- the index of the first piece that differs (and the hour it starts).
- both sides' numbers: slope → each piece's rise, run and unit rate; start → both starting depths; length → both end hours.

The verdict panel (left pane, in the space the tiles used):
- Slope: two small rise/run staircases for that piece (student ink, truth piece color), labels like "Your graph: up 3 inches every 1 hour (3 in/hr)" and "The story: up 1 inch every 3 hours (1/3 in/hr)". Blue run, orange rise. The same staircases also appear on the overlay at that piece.
- Start: mark both y-intercepts at hour 0.
- Length: mark where each version's piece ends.
- One plain sentence names the mistake (`RULE_FEEDBACK`).
- Type at least 16 px. First step only if crowded.
If right: a short confirmation and the colored story.

## 4. The streak bar and medals
Under the answer area, full width of the left pane:
- Flame icon + streak number (≥ 32 px). Lit with a streak, gray at 0; one small pulse on increase; no pulses with reduced motion.
- Medal track with markers at 3, 5, 10 (bronze, silver, gold); unearned are outlines; a progress line fills as the streak grows.
- Score and level chips beside it. All text ≥ 16 px.
- Header mode buttons take the color of that mode's best medal (outline → bronze → silver → gold, filled, subtle shine). Never lost.
- Per-mode scoring: own score, streak, level, best medal per mode; one storage key per mode; migrate old Match data into `match`; `?reset=1` clears all; a way to clear one mode. Explorer has none.

## 5. Hover and pin
Follow spec 4b (Full Lab's `hoverPreview` / `pinnedPoints`): snap to the nearest whole hour; soft dot and axis chips; hovering moves the scene and slider, leaving returns; click pins with coordinates (fractions/mixed numbers, never decimals); click again to unpin; pins clear on a new round. Works on Explorer's graph, the Match overlay after the pick, the given graph in Match the Story, the reveal in Draw. Not on the four choice tiles. Before a pick where the scene must not reveal the answer, hover moves the snow depth only. Touch: a tap hovers and pins.

## 6. Mode B: Match the Story
A graph is given (several pieces); four stories; the student picks. Their chosen story is drawn in color over the given graph.
- Before the pick: given graph in plain ink with hover/pin; four story cards, large text; streak bar below. Scene shows the starting depth only; slider and Play locked.
- Options follow spec 6b's distractor design (teaching intents; start held nearly constant from Level 2; four different GRAPHS; near-miss rates) — plus Karl's answers above (same end hour; mostly same start and durations; slope is the usual test).
- After the pick: other cards gray out; chosen story takes piece colors; after the beat, autoplays at Fast; the scene plays the chosen story; the dot traces the chosen story's graph in piece colors over the given graph, with snow fill, link line and slider. If wrong, `describeDifference(chosenStoryForecast, givenForecast)` and the same verdict panel. After the verdict, outline the correct card and color its text.
- Level N = N pieces.

## 7. Mode C: Draw the Forecast
A story is given; the student builds the graph piece by piece by clicking.
- Story above the graph, large, each piece a clickable chip. Empty unit grid (0–12 h, 0–15 in); the starting depth is not marked.
- Click a story piece to make it active; click start (piece 1, at hour 0) then end; later pieces start at the previous end. Snap to whole corners; end must be to the right ("Time only moves forward. Click to the right of your start."). Check mark per drawn piece; redrawing piece k clears pieces after it. Auto-advance; Undo and Clear. Check when every piece has a segment. **Per Karl: drawn in plain ink.**
- Slider and Play locked until Check. `gradeDrawing` compares as functions at every whole hour. Reveal: TRUE graph in piece colors over the student's drawing, autoplays after the beat, scene plays the true forecast; difference panel if they differ. Level N = N pieces. Hover/pin on the reveal. No typed numbers.

## 8. Order of work
- Phase A: piece colors (Explorer first); per-mode scoring, streak bar, medal header buttons; Match the Forecast layout, autoplay, verdict panel; hover and pin.
- Phase B: Match the Story. Phase C: Draw the Forecast.
- Later: Fill in the Forecast, Phase 1B, the follow-up question after a wrong answer.

## 9. Checks
`describeDifference` for every distractor rule; piece-color contrast and colorblind tests; per-mode storage (isolation, migration, reset, medal from best streak); Match the Story generator (four options, one correct, distinct graphs, no equivalent-rate duplicates, start rule at Level 2+); `gradeDrawing` incl. in-order pieces, redraw, extra points; browser checks at 1366×768 dark/light; tile cell size; screenshots; test links per phase; list constants and uncovered decisions.

## 10. Decisions made for Karl (revisit if wrong)
1. Piece colors: teal, violet, honey (colorblind-tested), changed from green/violet/gold-brown after the simulation.
2. Choice tiles may go to 14 px per cell (overlay stays 16).
3. Explorer's story stays above the scene.
4. In Match the Story, the scene plays the student's chosen story.
5. In Draw the Forecast, pieces are drawn in order in plain ink, each later piece starts where the last ended, and no numbers are typed.
6. Fill in the Forecast moves after Draw.
7. Autoplay still runs with reduced motion.
