# BUILD: Snow Challenge Phase 1A.2 (overlay reveal, snow fill, day and night, grass foreground)

For Claude Code. Written 11/26/2026 after Karl reviewed Phase 1A (fb5f658). Amends `SPEC-SNOW-CHALLENGE-V2.md`; where this doc and the spec disagree, this doc wins. Phase 1B (menu, start screen, scoring, hover/pin, polish) comes AFTER this build.

## Karl's answers (11/26–11/27), recorded for later sessions

- Foreground: ~~Mockup A (cutaway)~~ — **revised 11/27 after Karl tried the branch: a perspective landscape plus a zoomed measuring inset in the bottom-left (bands back to 30/25/45; small stake 6 px/in; inset 16 px/in). The cutaway now lives only inside the inset.** The Play button pulses after a Match pick and the reveal defaults to Fast; trees are placed from the hill silhouette.
- ~~Taller foreground band (20/15/65)~~ — retired 11/27; the inset carries the 16 px/in scale instead.
- All four Match the Forecast graphs in a round end at the same hour.
- Explorer keeps one sky (day or night) per visit; `?scene=` forces it.
- Inside the Match overlay, the snow is the fill under the TRUE line (depth over time); the flat layer stays left and right of the overlay.
- Performance fallback: shed flavor events first, then flakes; cap the flake canvas at ~1.5× pixel density.
- Test on a branch preview first; push to main only after Karl says OK. Phase 1B waits until after the 12/4 class.

## 0. What Karl decided after Phase 1A

- Keep 12 hours × 15 inches, and the 2×2 tiling for Match the Forecast. Keep the bird feeder.
- The scene is much better. He wants it to feel alive: day and night variety, a sunrise, small flavor animations, and a grass foreground with depth.
- The Match the Forecast reveal changes (Section 2): the student drives it, and the chosen graph is laid over the scene so the eye compares in one place.
- A white "snow fill" grows under the graph as the point traces (Section 3).
- A small on-screen hint for the arrow keys (Section 7).

## 1. Foreground: grass receding to the horizon (mockups first)

**Intent.** The foreground should read as grass going off into the distance, growing smaller toward the horizon, so the picture has real depth. We measure snow in the foreground grass right in front of us. As snow accumulates, the grass is progressively hidden.

**Hard constraint.** The graph overlay (Section 2) needs the measuring stake to keep ONE vertical scale: `PX_PER_INCH`, with the ground line at depth 0 and the 15-inch line at the top of the stake. Whatever the grass does, the snow reading at the stake must still equal the graph's y-value through that scale. The flat-topped snow line at the stake stays the reading line.

**Make two static mockups first, then STOP and send them to Karl.**
- **Mockup A: cutaway.** Keep the current flat full-width snow layer as the foreground. Add the grass as depth: several rows of grass tufts receding toward the horizon behind and above the stake zone, shrinking row by row. Snow covers the nearest rows first and the far rows disappear last (or the reverse, whichever looks right), while the flat snow line still rises with depth.
- **Mockup B: perspective plane.** The foreground is a ground plane in perspective, with grass rows shrinking toward the horizon. Snow whitens the plane; the stake stands on it with its snow line still at the true scale.

Show each at depths 0, 3, 8 and 15, in the night scene and the day scene (Section 4). Say which one you recommend and why, in a few lines, including the cost in drawing time.

**Performance rules (Chromebooks).**
- Grass is drawn once as a static image (pre-rendered SVG or offscreen canvas) with a fixed random seed, never per-frame blades or filters.
- Hiding grass as snow rises is done by changing the covering or opacity of a few layers, not by redrawing blades.
- No more than a few hundred drawn elements for the grass. Report the number.
- Measure frame time with the browser's CPU throttled 4× during a heavy-snow round, and report it.

**Grass hiding rule.** Give blades different real heights (about 2 to 8 inches). A blade is hidden once the depth exceeds its height, so the grass thins out gradually as snow builds, and is fully gone by the time depth reaches the tallest blades. When snow melts, grass reappears the same way in reverse.

**Ground texture.** The brown soil strip stays at the very bottom (depth 0 line), as built.

## 2. Match the Forecast: the new reveal

This replaces the current "right pick plays the scene" flow.

1. **The pick locks in.** The score and streak are counted at the pick, with the first-try rules exactly as now. The four cards: the three not chosen gray out (dimmed, no hover, no click); the chosen card shows a neutral "your pick" highlight. **No red or green yet, and the score chip does not update yet** (it updates at the verdict, step 5).
2. **No autoplay.** The slider and Play unlock. A short prompt appears: "Play the story or drag the slider to test your pick."
3. **The chosen graph moves onto the scene.** The chosen card slides (about 400 ms; instant with reduced motion) onto the foreground of the scene as a transparent overlay:
   - Its y-scale equals the scene's scale: one inch on the graph is exactly `PX_PER_INCH` tall, the 0 line sits on the ground line, the 15 line at the top of the stake, and **the graph's y-axis is the measuring stake**. Gridlines every inch, thin and low contrast; hour labels along the bottom; hour gridlines the same pixel size as the inch lines (unit squares).
   - Its width is `MAX_HOURS × PX_PER_INCH`, placed to the right of the stake. If that collides with the bird feeder or leaves the plot hard to read, move the feeder out of the way while the overlay is up, and tell Karl.
   - The chosen graph's line is drawn in full, in ink, as the student's prediction.
4. **The trace is the evidence.** When the student plays or drags, a yellow dot travels along the TRUE forecast's depth over the overlay, connected to the axis by the dashed link line (now a short horizontal line, because the dot and the snow top are at the same height). The snow fill (Section 3) grows under the trace.
   - If the true path stays exactly on the student's line, the dot follows it perfectly.
   - If the true path leaves the student's line, **draw the true graph line (in an accent color) as the dot traces it**, so the gap between the two is visible, and highlight the first piece where they split.
5. **The verdict.** It appears when the trace reaches the end (playing or dragging the slider to the end), or when the student presses **Show result** (available from the start, so a student is never stuck). Then:
   - the red or green feedback and the one-line mistake explanation (from `RULE_FEEDBACK`) show;
   - the stat chips update;
   - the Next button turns on.
6. **Next round:** the card returns to the grid, the grid resets, and the scene goes back to the starting depth with no weather.

Rules that stay: one score per round, from the first pick; Play and the slider are locked until a pick (nothing about the true forecast is revealed before it); the scene before a pick shows only the starting depth.

**Later, not in this build:** a follow-up question after a wrong answer about where it went wrong. Log it.

## 3. Snow fill under the graph

- As a point traces a graph, fill the area under the line from hour 0 to the current hour with snow. The fill always uses the same `depthAt(t)`, so it follows scrubbing, hovering and replay.
- Used wherever the trace plays: Explorer, the Match reveal overlay, and later Story Match and Fill in (and the start-screen demo).
- Colors: tokens `--snow-fill` and `--snow-edge`. On the dark theme, near-white fill with a bright top edge. On the **light theme, a pure white fill disappears**, so use a light ice-blue fill with a slightly darker blue-gray edge. In the overlay (over the scene), use the scene's own snow colors.
- Gridlines must stay visible through the fill (use some transparency, or draw gridlines over it).
- Explorer's graph is about 40 px per inch and the scene is about 16, so the two can't share one scale there. In Explorer keep the dashed link line and add the snow fill; do not try to overlay.

## 4. Day and night scenes, and the sun

**Scene type.** Each forecast gets a scene type, `night` or `day`, chosen randomly but tied to the forecast's seed, so a replay or reload looks the same. `?scene=night|day` forces it. The start-screen loop picks one for each new story.

**The sun and the sky.** Add a pure function `skyLevel(forecast, t)` in `snowModel.js`: 0 when there is no sun, 1 when the sun is fully out, easing between them over about 1 hour (constant `SKY_EASE_H`) at piece boundaries. The scene reads it, so scrubbing, hovering and playing all move the sky together. Add a test for it (continuous, 0 to 1, correct at the middle of each piece).

- **Night scene (as now, plus a sunrise).** Dark sky, moon, stars. When a sunny piece arrives the sun **rises** from the horizon, the sky turns **light blue**, the stars and moon fade, and **everything brightens**: hills, trees, ground, grass, snow, the backdrop behind the snow. When the sunny piece ends, the scene eases back toward its dim state, and clouds return if the next piece is snow or cloudy.
- **Day scene.** Baseline is a light daytime sky. Snowing = overcast, light gray-blue sky, sun hidden. Cloudy = overcast with softer clouds. Sunny = the clouds part, the sun is visible, the sky is bright blue. The clouds either cover the sun or they don't.
- **Visibility on bright skies.** White flakes vanish against light blue, so on bright backgrounds give flakes a soft cool-gray shade or outline. The snow's top edge and the backdrop must still contrast clearly in both scene types (mid-tone backdrop, not white). Report the measured contrast of the snow top against the backdrop in both scenes at depths 3, 8 and 15; aim for at least 3:1.
- The page's own light and dark theme stays separate from the scene type.
- With reduced motion, color transitions can still happen (they aren't motion), but the sun's rise is a quick fade rather than a travel.

## 5. Flavor animations

Small things that make the scene feel alive. All are rare, subtle, decorative, and one at a time.

| Flavor | When | Behavior |
|---|---|---|
| Plane | day or night | crosses the background band slowly; blinking lights at night; a faint trail by day |
| Shooting star | night only | one brief streak across the sky |
| Birds crossing | day only | two or three small birds flap across the sky |
| Feeder birds | as built | unchanged |

- Random interval between events: constants `FLAVOR_MIN_S` and `FLAVOR_MAX_S` (default 20 and 60). Never in the first 2 seconds. Never over the overlay or the stake. No flavor events during the Match pre-pick state? (They're fine; they don't reveal anything.)
- None with reduced motion. Pause when the tab is hidden. Use transforms or a canvas layer only.
- `?flavor=soon` triggers one right away so Karl can review each kind (`?flavor=plane|shooting|birds`).

## 6. Anything that conflicts with the spec

- Spec 3a to 3g (scene) are amended by Sections 1, 3 and 4 above.
- Spec 6a (Match the Forecast changes) is replaced by Section 2.
- Spec 3g ("the scene stays night in the light theme") is replaced by Section 4.
- Spec Section 4a's leak rule stays as is.

## 7. Keyboard hint for the slider

Students won't discover the arrow keys. Add:
- A small hint line directly under the slider that appears on hover or when the slider gets keyboard focus and fades after a few seconds: "← → move 1 hour · Shift + ← → move ¼ hour".
- A tooltip on the Play button with the same text.
- Make sure the hint is reachable for keyboard users (not hover-only) and readable at 16 px or larger.

## 8. Checks to run and report

- Model tests (extend `snowModel.test.mjs`): `skyLevel` continuity and range; scene type is seed-stable; scale and generator tests still pass at 12×15.
- Match reveal flow, at 1366×768, dark and light page themes: pick locks in and grays the other three; no verdict before the trace ends or Show result; Next stays off until then; score unchanged until the verdict; a wrong pick draws the true line next to the student's and highlights the first split; a right pick follows the line exactly; the overlay's y-scale is `PX_PER_INCH` (assert in a test: the pixel height of 15 inches on the overlay equals the scene's).
- No scrolling, no console errors, text at least 16 px, keyboard-only use of the slider, hint visible on focus.
- Frame time at 4× CPU throttle, heavy snow, night and day scenes, with all flavor events firing (use the preview params).
- Screenshots at 1366×768 (2×): the two foreground mockups (before building); the chosen card in place over the scene before playing, mid-trace, and at the end (right pick and wrong pick); the snow fill in Explorer in dark and light; a night scene at depth 0, then mid-sunrise, then full sun; a day scene overcast with snow, then sunny; each flavor event; the slider hint.
- List every constant you created and every decision this doc doesn't cover.

## 9. Order of work

1. Foreground mockups. **Stop and send to Karl.**
2. Snow fill (Section 3), since the overlay needs it.
3. Match reveal (Section 2) with the overlay.
4. Day and night scenes and the sunrise (Section 4).
5. Grass foreground, the option Karl picks (Section 1).
6. Flavor animations (Section 5).
7. Keyboard hint (Section 7).
8. Checks, screenshots, the review checklist link, and a handoff summary.

Push to main only when all of it is checked. The 12/4 class must never see half of this.

## 10. Decisions I made for Karl (revisit if wrong)

1. In the Match reveal, the verdict waits for the trace to finish or for "Show result"; the score is counted at the pick but displayed at the verdict.
2. Match uses the overlay; Explorer keeps the link line plus the snow fill.
3. The scene type is random per forecast and tied to the seed.
4. In a night scene, a sunny piece is a sunrise; in a day scene, the clouds part.
5. Flavor events are rare, one at a time, and off with reduced motion.
6. The snow fill is ice-blue with a darker edge on the light theme.

## 11. Not building yet

- The follow-up question after a wrong Match answer ("where did you go wrong?").
- Everything in Phase 1B and later: menu, start screen, per-mode scoring, hover/pin, polish, Explorer v2, Match the Story, Fill in, Draw.
