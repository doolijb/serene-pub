# BRIEF — build lane `sense-sumset` — the routine's mode replaces the Summaries setting

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `plans/REPORT-sense-sum-2026-11-12.md`
(the routine *Summarize finished scenes*), `docs/sessions.md` ~497–522 and `docs/summarization.md` ~40–64, CLAUDE.md
Hard rules, Principles and "0.6 is in users' hands", NOMENCLATURE §1, §23, §24, §25 and the scene-settings row
(~2018). `plans/briefs/BRIEF-sense-clk.md`'s **Verbatim rules** bind you and your workers. Line numbers below are
from an inventory on 2026-11-13: re-read before editing.

Words. A **build lane** is this stream of work; a **channel** is a session's message channel. "Compile" is scenes
→ a history entry and is not this.

## Rulings that bind (owner)

- 2026-11-12, on the session's **Summaries** setting (On close / On request / Never) overlapping the routine's
  Full / Review / Off: "Replace it (Recommended)" — where the routine exists, show only Full / Review / Off; a
  session set to Never becomes routine Off by a one-time pass; Chat and Story Minimal keep Summaries.
- 2026-11-13: "Off stops only the automatic run (Recommended)" — the Summarize buttons stay under Off.
- 2026-11-13: a session saved as On close gets "Routine set to Review (Recommended)".
- P3: few settings. "You're over complicating it": take the plainer shape and say so.

## The rule to build, in four sentences

A session **has the routine** when its effective registrations hold a routine whose pipeline is
`core:spec/scene-summaries` (per session: a preset or a session row that drops it means it does not). For such a
session the stored Summaries value is not read anywhere: the routine's mode alone decides what is summarized by
itself, a scene's close drafts nothing, and *Summarize*, *Summarize all* and *Close and summarize* are always
offered to the owner. A one-time pass turns a stored *Never* into routine **Off** and a stored *On close* into
routine **Review**, then clears the stored value. A session without the routine is unchanged in every way.

## Build

1. **One place decides.** `sessionSceneContext` (`src/lib/server/sessions/sceneSettings.ts` ~127–181) is what every
   reader goes through. After it resolves the settings, when the session has the routine it answers
   `summary: "onRequest"` whatever is stored, and carries the routine's mode beside it (🚧 a new field on the
   context, e.g. `summaryRoutine: "off" | "review" | "full" | null`, `null` when the session has no such routine;
   check §24 and say what you chose). Add one small helper beside `scenesRoutineOn`
   (`src/lib/server/scenes/boundaryWatcher.ts` ~946–966), 🚧 `sessionRoutineMode(db, sessionId, specId)`, returning
   the effective mode (`?? "full"`) or `null`. **The context never throws** (it has about fifteen callers, and
   `scenesEndByThemselves` turns a throw into a refused lore write, `lorebooks/ownBook.ts` ~446–458): when the
   resolver errors, the context answers `summary: "onRequest"` with `summaryRoutine: null` and logs a warning.
   That fails safe on both questions (nothing is drafted at a close, nothing is refused, the buttons are offered)
   and leaves `mayPlace`, `mode` and the triggers as they are.
   That one change must make all of these true, each with a test:
   - a scene's close drafts nothing (`summarizeOnClose`, `sockets/scenes.ts` ~3016–3030);
   - *Summarize all* and *Close and summarize* are not refused (`scenes:processAll` ~3197–3239);
   - the routine's query no longer stops on a stored *Never* (`scenes/sceneSummaryDue.ts` ~32);
   - the `scenes:cues` reply and push, `scenes:openScenes`, and so `HistoryEntriesV1.summaryMode` and the
     dossier's `sceneSummaryMode`, read `onRequest`: the Chronicle and the conversation widget then offer their
     buttons and show no "runs when it closes" note, **with no SDK change**.
   Read `sessionSceneContext`'s other callers and say in the report that none of them depended on the stored value
   for a session with the routine.
2. **The conversion, one helper called from two places.** 🚧 A function that converts **one session**: when the
   session has the routine and its stored `metadata.scenes.summary` is `never` or `onClose`, it sets the routine's
   mode for that session to `off` (from *Never*) or `review` (from *On close*) **only where the session's row for
   that key has no mode yet**, then removes `summary` from `metadata.scenes` (and the `scenes` key when that
   leaves it empty, as `writeSceneSettings` does), then `invalidateRegistrations()`. Write the mode through the
   module that owns those rows, `patchSessionRow` (`sessions/settingsForm.ts` ~489–511), e.g.
   `patchSessionRow(tx, sessionId, key, (row) => (row.mode == null ? { mode } : {}), "upgrade")`: a raw
   `ON CONFLICT DO NOTHING` insert would leave a session whose existing row only changes a cadence with no mode,
   and the cleared *Never* would then become Full. Read the key off the catalogue, never a string literal. One
   transaction per session, `tx` only. A session without the routine is not touched.
   It is called:
   - from a **startup task** after `pipelines` (`src/lib/server/startup/index.ts`; precedent
     `sessions/dcCrawlClock.ts` and its test), over every session with such a stored value. Not a migration-tied
     data upgrade: genre registrations are projected at boot, and only the resolver can say whether a session has
     the routine;
   - from **`sessions:setSessionPreset`** right after the preset moves (`sockets/sessions.ts` ~3706–3717), so a
     session that gains the routine is converted at once and never changes behaviour at a later restart by itself.
     The same handler then calls `pushSceneCues(socket.io, sessionId)`: the client reads the cues once per route
     and relies on pushes (`sessionPage/sceneCuesFlow.svelte.ts` ~52–59), so without it the Summarize buttons stay
     hidden until a reload.
   Tests: *Never* → Off and the routine then takes nothing; *On close* → Review; a mode the owner already chose is
   kept; a session whose row only changes a cadence and holds *Never* ends up Off; Story Minimal and a session
   whose own row drops the routine are untouched; **a second run changes nothing**; an owner who later sets Full
   is not reset by the next boot; Minimal with *Never* switched to Living is Off at once, its cues are pushed, and
   a restart changes nothing.
3. **The form.** `SessionSceneSettings.svelte` (~287–304 the select, ~60–76 its `sessions:routines` read): when the
   session has the routine, the **Summaries** select is not shown; in its place one line names what decides, 🚧
   *Summaries are written by the* Summarize finished scenes *routine (‹Full | Review | Off›). Change it under
   Routines.* A member sees the Scenes card disabled and has no Routines group (`EditSessionForm.svelte` ~3335–3344,
   ~3556), so the second sentence shows only when the card is not disabled. The routine's own control stays where
   it is (the Routines group, `SessionSettingsForm`); do not add a
   second control or mix the two save models. `sceneSettings` sent by `sessions:update` for such a session drops
   `summary` server-side (`sockets/sessions.ts` ~6886–6898), so an old client cannot store one. A session without
   the routine shows the select exactly as today. A DOM test for both.
4. **Docs and ledgers in the same change:** `docs/sessions.md` (~497, ~509–522), `docs/summarization.md` (~48,
   ~56–64), `docs/session-layout.md` ~58, `docs/genre-story.md` (Minimal keeps Summaries), NOMENCLATURE's
   scene-settings and scene-summaries-routine rows and §25. SDK **JSDoc only** where it says what `summary` does
   (`sdk/src/sceneSettings.ts` ~21–23, `sdk/src/descriptors.ts` ~1223–1232, `sdk/src/widgets.ts` ~2616–2619,
   `sdk/src/sessionDossier.ts` ~256–261): one sentence, that a session running the *Summarize finished scenes*
   routine reads `onRequest` whatever is declared.

## Open ★ to carry into the report (build nothing for them)

- A **branch** copies the session's metadata but not its session-level registration rows
  (`sessions/branch.ts` ~164, ~196), so a branch of a session set to Off starts on its preset's mode. That is true
  of every routine today; say so.
- The SDK's `SceneSummaryMode` keeps its three values (published); a plugin genre that declares `summary` and also
  registers the routine has its declaration ignored.
- The single-scene `scenes:process` never checked *Never* on the server (only the client hid the button).

## Files owned

`src/lib/server/sessions/sceneSettings.ts`, `src/lib/server/scenes/boundaryWatcher.ts` (the helper only),
`src/lib/server/scenes/sceneSummaryDue.ts`, `src/lib/server/sockets/scenes.ts` (only what item 1 needs; if the
context change alone does it, nothing), `src/lib/server/sockets/sessions.ts` (item 3's one guard; item 2's two lines in
`sessions:setSessionPreset`), a new module under `src/lib/server/sessions/` for the conversion and its startup
task, its line in `src/lib/server/startup/index.ts`, `src/lib/server/sessions/settingsForm.ts` only if
`patchSessionRow` must be exported,
`src/lib/client/components/sessionForms/SessionSceneSettings.svelte`, tests, the docs above. SDK: the four JSDoc
comments only.

## Out of scope

Removing or renaming anything in the SDK; the Chronicle and conversation widgets; Close out; the routine itself,
its query's other conditions and its modes; branches; an On-close-like "at the close" option for the routine; any
migration; any new setting.

## Stop and ask when

A published SDK name, type or widget field would have to change; a migration is needed; the pass cannot be made a
no-op on the second boot; a reader of the stored value turns out to need it for a session with the routine.

## Done means

The new tests pass; these pass, updated only where the rule changed what they pin and never weakened:
`sockets/scenes.cues.int.test.ts`, `scenes/sceneSummaryDue.int.test.ts`, `scenes/boundaryWatcher.int.test.ts`,
`shared/sessions/sceneSettings.test.ts`, `sessionPage/requests/historyEntries.test.ts`,
`sockets/scenes.routineSummary.int.test.ts`, `pipelines/routines/sceneSummaries.routine.int.test.ts`;
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean. Tests run only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 …"`,
never two runs at once. **No `npm run sdk:build`**: the SDK edits are comments; say the next build carries them.
Never `git commit`, `stash`, `checkout` or `restore`.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-sense-sumset-2026-11-13.md`):
the rule as built in sentences a modder could read; names chosen; what each reader of the context does now; the
pass, its filter and why a second boot is a no-op; provisional copy verbatim; changed files; tests and results;
open ★; **Noticed, not done**.
