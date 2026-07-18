# TWP (Training With Purpose) — Project Context

## Stack
Single-file `index.html` (vanilla HTML/CSS/JS). localStorage primary storage + GitHub-backed cloud sync via Vercel serverless fn `api/sync.js` (Contents API). `vercel.json` rewrites all non-`/api` to `/index.html`. No build step, no npm packages.

## Deployment
- URL: `twp-beta-three.vercel.app`
- Sync endpoint: relative `/api/sync` (not hardcoded)
- Env vars: `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_PATH`, `GITHUB_BRANCH`

## Working conventions
- User uploads current `index.html`, requests targeted change, gets file back.
- **Prefer minimal chat explanation, code output first.** Keep responses short.
- Batch clarifying questions upfront if needed; avoid mid-build back-and-forth.
- Syntax-check JS before delivering.
- Use `str_replace` for targeted edits when possible instead of full-file rewrites.
- Structural HTML integrity matters: missing closing tag on `#screen-workout` once broke all nav — verify structure after big edits.

## Core data model
`state.workouts[]`, each workout has `exercises[]`, each exercise has `sets[]`.
Set fields: `weight, reps, warmup, rir, rpe, tempo, variations[], restSeconds, prs[]`.
Exercise fields: `exId, name, icon, primary[], secondary[], note, sets, restSeconds, linkGroup` (linkGroup = combo/superset grouping).

`exerciseOverrides` (built-in edits), `customExercises`, `hiddenExerciseIds`, `exerciseRestPresets` (per-exercise rest override), `favoriteExercises`, `recentExerciseIds`, `measurementHistory` (dated snapshots), `profile{}`, `periodization` (macro/meso/microcycle planner).

## Shipped features (do not re-explain, just extend)
- RPE + RIR + tempo per set
- Insights tab: 12-wk training load chart, Push/Pull/Legs balance, muscle volume warnings (target ranges per muscle in `MUSCLE_GROUPS`)
- Plateau detection (last 3 sessions identical top set → ⚠️ tag)
- Bodyweight PR badges (keyword-matched via `BODYWEIGHT_EXERCISE_KEYWORDS`, tracks best reps or best system weight)
- Gamification badges (`BADGE_DEFS`): workout counts, tonnage, streaks
- Per-exercise rest presets (Exercise Manager)
- Anatomical muscle manikin (front/back SVG, 17 muscle groups, activation-based fill via `computeMuscleActivation`)
- Combined Sets (bi-set/superset) via `comboId`/`linkGroup`
- Variations system (multi-select tags: Negatives, Partials, Pyramids, Explosives, Slow, custom)
- Cloud sync w/ content-fingerprint dedup (`workoutFingerprint()`), `lastPushedPayload` cache
- Exercise Manager: edit built-ins via overrides, `(edited)` label, Reset button
- Periodization planner (macro/meso/microcycle, linear/wave models)
- i18n (en/pt) for static chrome only — never auto-translates user data

## Parser notation (training log import, `.txt`/PDF/Excel)
- `c` = kg marker (e.g. `12c10` = 12 reps @ 10kg)
- `x` = unilateral chain, sum reps (e.g. `8x8x4x4`)
- `n` / `negatives` = extra negative reps
- `p` = partial reps chain (e.g. `8p8`)
- `2minR` / `2minRest` = rest time
- `1h08` = duration
- `wp` / `warm-up-set 1-3 3-1` = warmup spec
- `+` joins bi-set/superset exercise names and per-set values
- `^r`/`^e`/`^t` tags = RIR/RPE/tempo round-trip (export/import)
- Export/import round-trip currently **missing**: bodyweight PR data (partially fixed for RPE/tempo/rest via `^`-tags)

## SHIPPED: Bodyweight +/- weight chip
Per-set weight input for bodyweight-capable exercises is a single cycling chip instead of a plain number field.

- Exercise definitions can carry `isBodyweight: true/false`, editable via a checkbox in Exercise Manager (`ef-is-bodyweight`), stored in `exerciseOverrides`/`customExercises`. `exerciseSupportsBW(exId, name)` checks this flag first, falling back to `isBodyweightExercise(name)` keyword matching for exercises without an explicit flag (imports, older customs).
- Built-in flags set: Pull-Up, Dips, Plank. Others (pushup, ring row, jumps, etc.) get it via keyword fallback or by ticking the checkbox on a custom exercise.
- Chip (`renderBwWrapHTML`, `cycleBwMode`, `updateBwWeight`) cycles ⚖️ BW → ＋ Add → − Assist → BW. A delta input only appears for Add/Assist. A hidden `.w-input` always holds the TOTAL system weight (bodyweight ± delta) — this is what `finishWorkout`, volume, and PR code already read, so no changes were needed there for basic collection.
- `getUserBodyweight()` (reads `state.profile.weight`, falls back to `BODYWEIGHT_KG`) is the single source feeding the chip's math — same value used by the "You" tab profile and workout bodyweight logging, so updating weight in any of those places is reflected the next time a set is logged.
- Sets now also carry `bwMode` ('bw'|'added'|'assisted') and `extWeight` (the delta) so PR detection (`getBodyweightBestFor`, `finishWorkout`, `recomputeImportedPRs`) can tell "pure bodyweight rep PR" from "added-weight system-weight PR" without the old `weight === 0` heuristic. Legacy sets without `bwMode` still fall back to the old heuristic for backward compatibility.
- `openExReplacePicker`/`replaceExercise` now calls `refreshBwCellsForBlock()` to rebuild each row's weight cell (chip vs plain input) when the exercise is swapped mid-log.
- Feed card exercise cells (`renderFeedCard`) now show each exercise's total kg lifted, not just set count.

**Shipped v2 improvements (icon chip, stepper, memory, warning):**
- Chip is a compact pill again (tap-target size increase was undone) with plain text legends: "BW" / "＋ Add" / "− Assist" via `bwChipLabel(mode)` — no icon on the BW state (dumbbell was tried and removed per feedback).
- Total system weight shown as inline text (`.bw-total`, e.g. `92.5kg`) next to the chip, not a hover-only `title` (useless on mobile).
- Delta entry is a `.bw-stepper`: −2.5/+2.5 buttons (`stepBwDelta`) flanking a small manual input, so most adjustments need no typing at all.
- `state.lastBwDelta[exId]` remembers the last-used delta per exercise (persisted, loaded/saved with the rest of state) — cycling into Added/Assisted prefills it instead of starting at 0.
- Assisted mode uses teal (`#14b8a6`) instead of gold, to avoid reading as a "warning" the way plateau/muscle-volume tags do. Added stays `--accent-blue`.
- Warmup rows render a locked, non-interactive BW badge (`renderBwWrapHTML(..., locked=true)`, dimmed, no stepper) since warmups are always assumed bodyweight-only.
- Enter key in the delta input calls `advanceFromBw()` to jump focus straight to the Reps field.
- If `state.profile.weight` is unset, a small inline `.bw-warn` note ("default 80kg — set weight") now appears next to the chip instead of silently using the fallback.
- Feed card exercise cells (`renderFeedCard`) prefix the per-exercise kg total with a small dumbbell emoji to visually separate it from the workout-level bold volume/duration stats.

**Shipped v3 UX refinements (pill-pattern consistency, actionable warning, custom step):**
- Chip now follows the app's existing tag-pill language (same recipe as `.variations-btn`/`.variations-btn.has-tags`): pill radius, `--surface2`/`--text-muted` neutral, `--accent-blue` for Added, teal `#14b8a6` for Assisted — no bespoke styling.
- Mode + total are combined into one pill label (`bwChipLabel(mode, totalVal)`, e.g. `BW · 80kg`, `＋ Add · 92.5kg`) instead of a separate `.bw-total` element — one line, no redundant scanning, mirrors the "·" separator pattern already used elsewhere in the app (e.g. combo-card subtitles).
- The "profile weight unset" notice is now a tappable `.bw-warn` link ("Set weight →") that calls `goSetBodyweight()` — jumps to the You tab and opens the weight field directly via the existing `editProfileField()`, instead of leaving the person to find it themselves.
- The +/- stepper's increment is no longer hardcoded to 2.5kg: `state.exerciseWeightSteps[exId]` (editable via a new "BW chip weight step" field in Exercise Manager, next to the rest preset) lets exercises with different plate/vest increments (5kg, 1.25kg, etc.) step correctly. Defaults to 2.5kg if unset.

## Known gaps
- RPE/tempo/rest-preset/bodyweight-PR data not fully round-tripped through text import/export (partial progress via `^`-tags)
- Weekly snapshot "See more" daily breakdown view: selected but not yet implemented in full per earlier discussion

## Anthropic API note
If asked to build "Claude in Claude" features inside this app, use model string `claude-sonnet-4-6`, no API key needed, standard `/v1/messages` shape.