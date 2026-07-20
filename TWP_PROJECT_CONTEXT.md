# TWP (Training With Purpose) — Project Context

## Stack
Single-file `index.html` (vanilla HTML/CSS/JS). localStorage primary storage + GitHub-backed cloud sync via Vercel serverless fn `api/sync.js` (Contents API). `vercel.json` rewrites all non-`/api` to `/index.html`. No build step, no npm packages, no animation library (motion is CSS-only, see below).

## Deployment
- URL: `twp-beta-three.vercel.app`
- Sync endpoint: relative `/api/sync` (not hardcoded)
- Env vars: `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_PATH`, `GITHUB_BRANCH`

## Working conventions
- User uploads current `index.html`, requests targeted change, gets file back.
- **Prefer minimal chat explanation, code output first.** Keep responses short.
- Batch clarifying questions upfront if needed; avoid mid-build back-and-forth.
- Syntax-check JS before delivering (extract the non-CDN inline `<script>` block specifically — naive `<script>`/`</script>` splitting breaks on the CDN `<script src>` tags earlier in `<head>`/before `</body>`).
- Use `str_replace` for targeted edits when possible instead of full-file rewrites.
- Structural HTML integrity matters: missing closing tag on `#screen-workout` once broke all nav — verify `<div>` open/close counts and duplicate-id checks after big edits.
- When merging work from parallel/scratch versions of the file, check for structural conflicts before merging wholesale (e.g. a scratch's tab restructure vs. the current tab layout) — port additive features, flag conflicting redesigns instead of silently dropping or force-merging them.
- When multiple candidate "latest version" files exist (e.g. old project snapshot vs. freshly uploaded parts), diff them before trusting either — the freshest upload isn't always what's labeled "latest" in the request text.

## Core data model
`state.workouts[]`, each workout has `exercises[]`, each exercise has `sets[]`.
Set fields: `weight, reps, warmup, rir, rpe, tempo, variations[], restSeconds, prs[], bwMode, extWeight`.
Exercise fields: `exId, name, icon, primary[], secondary[], note, sets, restSeconds, linkGroup` (linkGroup = combo/superset grouping).

`exerciseOverrides` (built-in edits, incl. `isBodyweight` flag), `customExercises`, `hiddenExerciseIds`, `exerciseRestPresets`, `exerciseWeightSteps` (BW chip stepper increment per exercise), `favoriteExercises`, `recentExerciseIds`, `measurementHistory`, `profile{}` (now incl. `avatarPhoto`, see You-page section below), `periodization`, `lastBwDelta` (per-exercise remembered BW delta), `agent{}` (AI Coach state, see below).

## Shipped features (do not re-explain, just extend)
- RPE + RIR + tempo per set
- Deeper Insights (12-wk training load chart, Push/Pull/Legs balance, muscle volume warnings) — collapsible section inside the Progress **Overview** tab, not its own tab (see "SHIPPED: Insights merged into Overview" below) — **per-muscle target ranges** (each `MUSCLE_GROUPS` entry carries `target: [lo, hi]` weekly sets instead of one flat band)
- Plateau detection (last 3 sessions identical top set → ⚠️ tag)
- Bodyweight PR badges (keyword-matched via `BODYWEIGHT_EXERCISE_KEYWORDS`/`isBodyweight` flag, tracks best reps or best system weight)
- Gamification badges (`BADGE_DEFS`): workout counts, tonnage, streaks — **now with next-badge progress bar**, see You-page section below
- Per-exercise rest presets (Exercise Manager)
- Anatomical muscle manikin (front/back SVG, 17 muscle groups, activation-based fill via `computeMuscleActivation`)
- Combined Sets (bi-set/superset) via `comboId`/`linkGroup`. **Manual free-text "Superset group (optional)" input removed** — `linkGroup` is now only ever set by the combo picker (`toggleComboMode`/`continueCombo`) or preserved from imported/legacy data; `.ex-link-input` renders as a hidden carrier only on combo-created blocks, not as a visible field on standalone exercises (`addExercise()`, `populateExBlock()`).
- Variations system (multi-select tags: Negatives, Partials, Pyramids, Explosives, Slow, custom)
- Cloud sync w/ content-fingerprint dedup (`workoutFingerprint()`), `lastPushedPayload` cache
- Exercise Manager: edit built-ins via overrides, `(edited)` label, Reset button
- Periodization planner (macro/meso/microcycle, linear/wave models)
- i18n (en/pt) for static chrome only — never auto-translates user data
- Weekly snapshot "See more" → full Weekly Detail screen (`openWeeklyDetail`/`renderWeeklyDetail`, day-by-day breakdown, prev/next week nav) — **implemented**, not a gap
- Custom confirm modal (`showConfirmModal`/`closeConfirmModal`) — replaces all native `confirm()` calls (delete exercise, reset plan, clear data, cancel workout, delete workout)
- AI Coach agent (`AICoach`) — see dedicated section below

## SHIPPED: Bodyweight +/- weight chip
Per-set weight input for bodyweight-capable exercises is a single cycling chip instead of a plain number field.

- Exercise definitions can carry `isBodyweight: true/false`, editable via a checkbox in Exercise Manager (`ef-is-bodyweight`), stored in `exerciseOverrides`/`customExercises`. `exerciseSupportsBW(exId, name)` checks this flag first, falling back to `isBodyweightExercise(name)` keyword matching for exercises without an explicit flag (imports, older customs).
- Built-in flags set: Pull-Up, Dips, Plank. Others (pushup, ring row, jumps, etc.) get it via keyword fallback or by ticking the checkbox on a custom exercise.
- Chip (`renderBwWrapHTML`, `cycleBwMode`, `updateBwWeight`) cycles ⚖️ BW → ＋ Add → − Assist → BW. A delta input only appears for Add/Assist. A hidden `.w-input` always holds the TOTAL system weight (bodyweight ± delta) — this is what `finishWorkout`, volume, and PR code already read.
- `getUserBodyweight()` (reads `state.profile.weight`, falls back to `BODYWEIGHT_KG`) is the single source feeding the chip's math — same value used by the "You" tab profile and workout bodyweight logging.
- Sets carry `bwMode` ('bw'|'added'|'assisted') and `extWeight` (the delta) so PR detection (`getBodyweightBestFor`, `finishWorkout`, `recomputeImportedPRs`) can tell "pure bodyweight rep PR" from "added-weight system-weight PR." Legacy sets without `bwMode` fall back to the old heuristic.
- `openExReplacePicker`/`replaceExercise` calls `refreshBwCellsForBlock()` to rebuild each row's weight cell when the exercise is swapped mid-log.
- Chip is a compact pill (tag-pill visual language, same recipe as `.variations-btn`): `--surface2`/`--text-muted` neutral, `--accent-blue` for Added, teal `#14b8a6` for Assisted.
- Mode + total combined into one label (`bwChipLabel(mode, totalVal)`, e.g. `BW · 80kg`, `＋ Add · 92.5kg`).
- `.bw-stepper`: −2.5/+2.5 buttons (`stepBwDelta`) flanking a manual input; increment configurable per exercise via `state.exerciseWeightSteps[exId]` (Exercise Manager field), defaults 2.5kg.
- `state.lastBwDelta[exId]` remembers last-used delta per exercise, persisted; prefills on cycling into Added/Assisted instead of starting at 0.
- Warmup rows render a locked, non-interactive BW badge (no stepper).
- Enter key in delta input (`advanceFromBw()`) jumps focus to Reps field.
- If `state.profile.weight` is unset, a tappable `.bw-warn` link ("Set weight →") calls `goSetBodyweight()` — jumps to You tab and opens the weight field directly.
- Feed card exercise cells (`renderFeedCard`) show each exercise's total kg lifted (dumbbell-emoji prefixed), not just set count.

## SHIPPED: Progress page — UI/UX pass
**Deeper Insights (Training Load / PPL / Muscle Warnings):**
- Per-muscle target ranges (see Core data model / Shipped features above) replace the old flat 10-20 band; warning rows show `n/lo-hi sets`.
- `daysSinceMuscleTrained(name)` flags any muscle idle 7+ days inline in the warnings list.
- PPL balance shows a "target ~30-35%" benchmark next to each bar, plus a pull-lagging-push check.
- Training load chart gets a note (`#training-load-note`) flagging >30% week-over-week volume swings (deload vs. injury-risk framing).
- Lives inside Overview as a collapsible section, not its own tab — see "SHIPPED: Insights merged into Overview" below.

**Overview tab:**
- New "This Week At a Glance" card (`renderWeeklySummary`/`#weekly-summary-card`): workouts vs. goal, volume delta % vs. last week, new PRs this week.
- Chart gained a **ghost previous-period line** (dashed, same-length window immediately prior, aligned by position) via `bucketWorkouts()`/`getFilterCutoff()`/`metricValue()`, plus **★ PR star markers** on chart points containing a PR and **click-to-open-detail** on any point (`onClick` → `openDetail`). `#chart-legend-row` shows/hides to explain the markers.
- "Deeper Insights" collapsible section (see below), plus a warning banner above it when something needs attention.
- **AI Coach widget** (`#ai-coach-widget-container`) sits above the weekly summary card — see dedicated AI Coach section below.

**Exercises tab:**
- Search input (`#exercise-search`) + 3-way sort (`switchExerciseSort`: Recent / Most Trained / Plateaued).
- Trend arrows (`getExerciseTrend`: ▲/▼/●) and "⚠️ Stalled Nx" tag (replacing a plain binary plateau flag) per exercise row.
- Purposeful empty states (`emptyState(icon, text)`) instead of generic muted one-liners — used here and in Muscles tab.

**Muscles tab:**
- Muscle Split list sorted **most-neglected first** (ascending by kg, not fixed `MUSCLE_GROUPS` order).
- 8-week inline sparkline per muscle row (`computeMuscleWeeklySeries(8)` + `sparklineSVG()`), showing trend shape without axes/labels.

**Motion (CSS-only, no library, all <300ms per user preference):**
- `applyCardStagger()` — top-level cards (snapshot/insight/goal cards, muscle-item/day-card rows) fade+slide in with ~35ms stagger on tab open/refresh (`.stagger-in`).
- `switchProgressTab()` crossfades the newly-shown sub-tab panel (`.ptab-fade-in`, ~200ms) instead of a hard `display` cut.
- `animateNumber(el, target, suffix)` — ease-out count-up for chart total and weekly-summary Volume/PRs.
- `animateBarWidth(el, targetPct)` — Muscle Split bars, PPL segments, Plan bars, and the You-tab next-badge progress bar all grow from 0% instead of snapping in.
- `fadeInEl(el)` — front/back muscle-manikin SVGs fade in (~220ms) on rebuild; `.muscle-region` also carries a `fill`/`stroke` CSS transition for future per-node updates.
- `.warn-pill` / `.plateau-tag` get a quick pop-in (scale+opacity, ~200ms) whenever re-rendered.
- **Explicitly declined:** icon-only chip labels (undone per feedback, text labels only).

## SHIPPED: Insights merged into Overview
The standalone Insights progress-tab was folded into a collapsible section at the bottom of Overview (previously reviewed from a scratch/parallel version and initially declined as a structural redesign — since implemented on request).

- Progress tabs are now just `overview / exercises / muscles / plan` — no separate `ptab-insights`; `switchProgressTab()`'s tab list and the `.progress-tab` buttons were updated to match.
- `#ptab-overview` ends with a collapsible "Deeper Insights" card (`toggleInsightsSection()`) wrapping the same three insight-cards (Training Load chart, PPL Balance, Muscle Volume Warnings) that used to live in the separate tab. Collapsed by default; `renderInsights()` runs lazily on first expand (its canvas would size to 0 while hidden) and re-runs every time it's reopened.
- `updateInsightsWarnPill()` computes a single "things to check" count (muscles outside their target range + PPL imbalance) and surfaces it two places: a small pill on the collapsed header (`#insights-warn-pill`, "N to review") and a tappable banner near the top of Overview (`#overview-warn-banner`, "⚠️ N things to check") — both hidden when the count is 0. Called from `refreshProgress()`.
- `jumpToInsights()` — navigates to Progress → Overview, force-expands the section if collapsed, scrolls it into view. Wired to the warning banner and to a "See how this compares in Deeper Insights →" link at the bottom of the Plan tab's weekly card.
- Uses the existing motion system (`applyCardStagger`) on expand rather than introducing new animation.

## SHIPPED: You page — UI/UX pass
- **Profile & Measurements** (`#you-profile-list`) is grouped into two collapsible sections instead of one flat 23-row list: "Personal Info" (DOB, height, sport, activity/training style, injuries, surgeries, PR exercise, notes — starts open) and "Body Measurements" (weight, goal weight, body fat, chest/waist/shoulders/arms/forearms/thighs/calves — starts collapsed). `PROFILE_FIELDS` entries carry a `group` key; `PROFILE_GROUPS` defines the two sections; `profileGroupOpenState` (in-memory, resets each load) tracks open/closed; `toggleProfileGroup(key)` toggles + re-renders. Each section header shows a filled-count badge (e.g. "6/13").
- Each measurement row with history (`MEASUREMENT_KEYS`) shows an inline trend sparkline (`profileFieldSparkline(key)`, reuses `sparklineSVG()`) next to its value — surfaces the trend without opening the History modal.
- **Workout History** (`#you-history-list`) auto-loads instead of using a "Load more" button: `YOU_HISTORY_PAGE_SIZE = 10` renders in batches; a sentinel div with a small spinner sits after the last loaded card, and an `IntersectionObserver` (`youHistoryObserver`, 200px rootMargin) triggers the next batch as it scrolls into view (with a ~250ms delay so the spinner is perceptible). `youHistoryShown` resets to the page size every time `refreshYou()` runs (i.e. each time the You tab is opened).
- **Badges** (`#you-badges`, `renderBadges()`) now show a progress bar toward the next unearned badge below the earned-badge chips, not just a trophy case: each `BADGE_DEFS` entry carries a `progress(n, vol, streak) → {cur, target}` fn; the closest-to-unlocking unearned badge is picked and rendered with `.plan-bar-fill` (animated via `animateBarWidth`).
- **Cloud Sync** got a dedicated status card (snapshot-card style) near the top of the tab — status dot (`#sync-status-dot`, gray/gold/green for never-synced/syncing/synced) + relative-time text (`#sync-status-text-2`) + separate **Pull** and **Sync now** buttons, in addition to (not replacing) the existing Cloud Sync row under Account. `updateSyncStatusDisplay()` drives both the old row and the new card/dot together.
- **Clear All Data** moved out of the Account settings list entirely and now sits as its own full-width, bordered, red-tinted button at the very bottom of the You page (below Workout History), with a trash icon and a one-line "cannot be undone" caption underneath — visually isolated from neutral/reversible actions above it.
- **Profile photo** (avatar) is editable again: tapping the avatar circle (or the "Change Profile Photo" row in Account) opens a hidden file input (`#avatar-file-input`); `handleAvatarUpload()` reads the image, downscales/crops it to a 240×240 JPEG via an offscreen `<canvas>` (quality 0.85) to keep localStorage/sync payload size reasonable, and stores the result as a dataURL in `state.profile.avatarPhoto`. `renderAvatar()` shows the photo as the avatar's `background-image` with a small ✕ badge (`removeAvatarPhoto()`) when a photo is set, falling back to the existing initials-letter behavior otherwise. Rides on the existing `profile{}` save/load/cloud-sync path — no new storage plumbing needed.

## SHIPPED: AI Coach (`AICoach`)
Adaptive strength-coach agent embedded in the app, calling the Anthropic API directly from the browser (`claude-sonnet-4-6`, standard `/v1/messages`, no key wiring needed in this environment per the Anthropic API note below).

- `state.agent = { memory, unlockedConcepts[], interactionHistory[], lastAnalyzedWorkoutId, pendingTip }`, persisted via the normal `loadState`/`saveState` path (defensive-merged on load so pre-existing saved state without `agent` doesn't break). **Not** currently included in the cloud-sync payload (`buildSyncPayload`) — kept local-only so chat history doesn't bloat every GitHub-committed sync.
- `AICoach.compileContext()` — builds a compact payload (last 5 workouts w/ per-exercise top weight + avg RPE, plateaued exercises via the existing `isExercisePlateaued()`, muscles idle 7+ days via `daysSinceMuscleTrained()`, current periodization phase, profile weight/goal, agent memory + already-unlocked concepts) instead of sending raw workout JSON.
- `AICoach.fetchCoachResponse(systemPrompt, userMessage)` — non-blocking fetch to `api.anthropic.com/v1/messages`; any failure (offline, network) is caught and logged as a console warning (`AICoach: unavailable, skipping this cycle.`) rather than surfaced to the user or allowed to block the UI.
- `AICoach.evolveAndAnalyze(workoutId)` — hooked into `finishWorkout()` via a 500ms `setTimeout` after the workout is already saved/synced, so it never delays navigation. Skips if `workoutId` was already analyzed. Expects strict JSON back (`updatedMemory`, `newConceptUnlock: {title, explanation}`, `proactiveTip`); updates `state.agent` fields and calls `triggerConceptUnlockModal()` if a genuinely new concept comes back.
- Concept unlocks and the chat console use **dedicated modals** (`#coach-unlock-modal`, `#coach-console-modal`) rather than the existing `showConfirmModal`, since that one only supports plain text (`textContent`), not chat bubbles/inputs.
- `AICoach.renderWidget()` — compact card in Progress → Overview (`#ai-coach-widget-container`, above `#weekly-summary-card`): shows the current `pendingTip`, unlocked-concept count, latest concept, a "Consult Coach →" button, and a "View memory" link. Wired into both `refreshProgress()` and `switchProgressTab()` (fires when Overview becomes active).
- `AICoach.openInteractiveConsole()` / `handleUserMessage()` — simple chat UI in `#coach-console-modal`; each turn re-sends `compileContext()` + the question, capped at 40 stored turns (`state.agent.interactionHistory`) to bound localStorage growth.
- `AICoach.viewMemory()` — shows the raw evolving memory string via `showConfirmModal` (informational; Cancel/Close both just dismiss, no destructive action).
- **Not verified end-to-end from this environment** (no network access to `api.anthropic.com` here) — confirmed via static analysis only (syntax check, all referenced helper functions exist, no dangling `onclick` refs). Worth a live smoke test after deploy: finish a workout and confirm a tip appears in the Overview widget within a few seconds, or check the console warning if not.

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
- Export/import round-trip still **missing**: bodyweight PR data / `bwMode`/`extWeight` (partially fixed for RPE/tempo/rest via `^`-tags)

## Known gaps
- RPE/tempo/rest-preset round-trip through text import/export is partial (`^`-tags); `bwMode`/`extWeight` still not round-tripped through the parser/exporter.
- `state.agent` (AI Coach memory/chat history) is local-only, not yet part of `buildSyncPayload` — a second device won't see the same coach memory/history until this is added.
- AI Coach live API behavior unverified from within this build environment (no outbound access to `api.anthropic.com` here) — see AI Coach section above.

## SHIPPED: UI consistency pass (confirm modal, icons, colors)
- All native `confirm()` calls replaced with a custom `#confirm-modal` (same dark-sheet style as other popovers): `showConfirmModal(message, onConfirm, {title, confirmLabel, danger})` shows it, `closeConfirmModal(confirmed)` dismisses and only fires `onConfirm` on confirm. Used by `deleteCustomExercise`, `resetPeriodizationPlan`, `clearData`, `cancelWorkout`, `deleteWorkoutFromFeed`.
- `MUSCLE_GROUPS` icons de-duped: Biceps is now 🦾 (was 💪, clashed with Chest), Rear Delts is now 🛡️ (was 🏹, clashed with Hamstrings) — every muscle now has a distinct icon in Muscle Split / manikin legend.
- Deduped a leftover duplicate `@keyframes spin` CSS rule.
- `.warn-pill.high` (muscle volume too high) recolored red → gold, matching the "caution" semantic used elsewhere (red reserved for destructive/delete actions only).
- PR badges: Bodyweight PRs now get their own `.pr-badge.blue` color instead of sharing gold with 1RM PRs.

## SHIPPED: App-wide motion pass
Extends the Progress-only motion system to the whole app. Still CSS-only, no library, all <300ms.

- `.screen.active` crossfades+lifts on every bottom-nav switch (`screenFadeIn`), not just Progress sub-tabs.
- **All modals** slide up + fade in on open (`sheetSlideUp`, keyed off `.modal-overlay.open`) — zero JS needed, covers every modal in the app (including the newer coach-unlock/coach-console/sync-card additions, since they reuse `.modal-overlay`).
- `popIn` extended from `.warn-pill`/`.plateau-tag` to `.pr-badge`, `.badge-chip`, `.medal`, `.today-pill`.
- New `.plan-bar-fill` + `animateBarWidth()` for Plan tab Volume/Intensity bars (also reused by the You-tab next-badge progress bar).
- New `.row-fade-in` (opacity-only — `transform` on `<tr>` is unreliable cross-browser) for newly-added set rows.
- New exercise/combo blocks fade in on creation (`stagger-in`).
- Primary/secondary/finish/goal buttons get `scale(.97)` press feedback on `:active`.
- `applyCardStagger()` selector list expanded: `.feed-card`, `.import-card`, `.detail-stat`, `.you-stat`, `.badge-chip`, `.wc-item`.
- Wired into `refreshHome()`, `refreshYou()`, `openDetail()`, `renderWeeklyDetail()`, `openExerciseManager()`, `renderPeriodizationTab()` (count-up numbers + stagger/bar-fill).

## Anthropic API note
If asked to build "Claude in Claude" features inside this app, use model string `claude-sonnet-4-6`, no API key needed, standard `/v1/messages` shape. This is what `AICoach.fetchCoachResponse()` uses (see AI Coach section above).