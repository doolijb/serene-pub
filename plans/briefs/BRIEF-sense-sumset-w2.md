# BRIEF — `sense-sumset` worker 2 — the one-session conversion, its boot pass, and the two socket spots

You are a `lane-worker` in build lane `sense-sumset` (Serene Pub, app repo `/home/jody/github/serene-pub`). Your
supervisor read the rules; the ones your work depends on are quoted here. Line numbers are from 2026-11-13:
re-read before editing. Report as your final message (changed files, tests run with results, decisions you made,
anything you could not do, **Noticed, not done**).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This lane runs **no** `sdk:build` at all.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. **Inside `db.transaction(async (tx) => …)` use only `tx`** — the outer `db` deadlocks PGlite silently
  (`db/transactionGuard.ts` throws in tests). It is a **session**, never a *chat* (Chat is only a genre's name).
  Every session has a lorebook. No reference to any other project or product in code, comments, tests or docs.
  "Compile" is never used for scene summaries.
- **No migration.** "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot
  pass and a test that a second boot changes nothing." This is that boot pass; prove the second run is a no-op.
- Never seed a row at a hardcoded id.
- Comments state the rule, not the story: `src/lib/shared/conformance/commentHistory.test.ts` fails on phrases such
  as "no longer", "used to", "deliberately not", "now" as history.
- Run only your targeted test files, one run at a time, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > <log> 2>&1"`
  with the log under `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/sense-sumset-w2-*.log`.
  Another worker runs tests too: if a run seems slow, wait; never start two at once yourself. An int test that opens
  a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Typecheck:
  `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`. `npx prettier --check <file>` on each file you
  changed (`sockets/sessions.ts` may already drift: report it, do not reformat it). Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Known unrelated failing tests (not yours): speech-related expectations in `sessions/genreFieldDefaults.int`,
  `pipelines/entities/publishedValues.int`, `pipelines/entities/sessionGenres.int`,
  `sockets/sessionAdmin.presetActions.int`, `db/dataUpgrades/0108_layering_registrations.int`,
  `pipelines/boot/paramsSlotWiring.test`. Other uncommitted work is in the tree: leave it alone. Worker 1 is editing
  `sessions/sceneSettings.ts` and `scenes/sceneSummaryDue.ts` at the same time: do not touch them.

## The owner's rulings

- 2026-11-12: where the *Summarize finished scenes* routine exists, the session's **Summaries** setting (On close /
  On request / Never) is replaced by the routine's Full / Review / Off; "a session set to Never becomes routine Off
  by a one-time pass".
- 2026-11-13: "a session saved as On close gets Routine set to Review".
- A session **has the routine** when its effective registrations hold a routine whose pipeline is
  `core:spec/scene-summaries` (a preset or a session row that drops it means it does not; one set Off still counts).
  For such a session the stored value is never read (worker 1 makes the scene context answer `onRequest`). A session
  without the routine is unchanged in every way.

## Goal

### 1. A new module `src/lib/server/sessions/summariesToRoutine.ts` (🚧 names, grep each for collisions first)

- 🚧 `convertSummariesSetting(db: Db, sessionId: number): Promise<"off" | "review" | null>` — converts **one
  session**:
  1. `sessionRoutineOf(db, sessionId, SCENE_SUMMARIES_SPEC_ID)` (`pipelines/routines/sessionRoutines.ts` ~26;
     spec id from `@serene-pub/core-catalog`), **outside** any transaction (the resolver reads through `db`). No
     routine → return null, touch nothing.
  2. Read the session's stored `metadata.scenes.summary` (use `SCENE_SETTINGS_METADATA_KEY` /
     `storedSceneSettings` from `$lib/shared/sessions/sceneSettings`). Not `never` or `onClose` → return null.
  3. `mode = stored === "never" ? "off" : "review"`.
  4. One `db.transaction(async (tx) => …)`, `tx` only:
     - write the mode through the module that owns registration rows, `patchSessionRow` (exported from
       `sessions/settingsForm.ts` ~489):
       `patchSessionRow(tx, sessionId, reg.key, (row) => (row.mode == null ? { mode } : {}), "upgrade")`
       — **only where the session's row for that key has no mode yet**. The key is the resolved registration's
       `reg.key` (never a string literal). A raw `ON CONFLICT DO NOTHING` insert is wrong: a session whose existing
       row only changes a cadence would keep no mode and the cleared *Never* would become Full.
     - remove `summary` from `metadata.scenes`, and the `scenes` key itself when that leaves it empty (as
       `writeSceneSettings(…, null)` removes it, `sessions/sceneSettings.ts` ~37–52: `jsonb` operators, cast back to
       `json`), guarded in SQL on the stored value still being the one read (a concurrent write wins). Do not touch
       the session's `updated_at` (a boot pass is not activity; see `sessions/dcCrawlClock.ts` ~95–100).
  5. After the commit, `invalidateRegistrations()` (`pipelines/registrations/resolve`). Return `mode`.
- 🚧 `summariesToRoutine(db: Db): Promise<{ sessions: number; converted: number; failed: number }>` — the pass:
  every session whose stored `metadata.scenes.summary` is `never` or `onClose` (one SQL select, ordered by id),
  `convertSummariesSetting` on each; a session that throws is counted in `failed`, logged by id, and left; after the
  loop a non-zero `failed` throws one error naming the count. Precedent to follow closely: `sessions/dcCrawlClock.ts`
  and its test.
- Module header comment: purpose, what it owns (writing the routine's mode on the session's own registration row
  and clearing the stored Summaries value, for a session that has the routine), what it does not (the routine, the
  scene context, the registrations resolver), and why a second run is a no-op (the stored value is cleared; a
  session without the routine is never touched; an existing mode is never overwritten).

### 2. The startup task — `src/lib/server/startup/index.ts`

One task 🚧 `summaries-to-routine`, placed right after `dc-crawl-clock` (so after `pipelines`; genre registrations
are projected at boot and only the resolver can say whether a session has the routine), `failsHealth: true`, logging
one line only when it converted or failed something. Same shape as the `dc-crawl-clock` entry (~400–420). Not a
migration-tied data upgrade.

### 3. `sessions:setSessionPreset` — `src/lib/server/sockets/sessions.ts` ~3706–3717

Right after the preset moves (after the existing `invalidateRegistrations()` line), call
`convertSummariesSetting(db, params.sessionId)` (a throw is caught and `console.warn`ed; the preset change still
replies), so a session that gains the routine is converted at once and never changes behaviour at a later restart by
itself. Then, after `pushSessionToParticipants`, always call `pushSceneCues(socket.io, params.sessionId)` (from
`$lib/server/scenes/boundaryWatcher`, as `sessions:update` does at ~6895–6898): the client reads the cues once per
route and relies on pushes (`sessionPage/sceneCuesFlow.svelte.ts` ~52–59), so without it the Summarize buttons stay
hidden until a reload.

### 4. `sessions:update`'s scene settings — `src/lib/server/sockets/sessions.ts` ~6886–6898

Before `writeSceneSettings`, when the sent `sceneSettings` is an object carrying `summary` and the session has the
routine (`sessionRoutineMode(db, id, SCENE_SUMMARIES_SPEC_ID) !== null`, from `pipelines/routines/sessionRoutines`),
drop `summary` from it, so an old client cannot store one. When the resolver throws, store what was sent and
`console.warn`. A session without the routine stores exactly what it does today. Keep it to these few lines.

## Tests — one new int file `src/lib/server/sessions/summariesToRoutine.int.test.ts` (plus socket tests as below)

Find how existing tests build sessions with and without the routine (`pipelines/registrations/resolve.int.test.ts`
~231–246, `scenes/sceneSummaryDue.int.test.ts`, `pipelines/routines/sceneSummaries.routine.int.test.ts`; Story's
**Minimal** preset drops the routine; `core:genre/chat` never has it) and assert in each test that the session you
call "with the routine" really has it. Claims, each its own test:
- *Never* → routine **Off** (`sessionRoutineMode` reads `off`), the stored `summary` is gone, and the routine then
  takes nothing (`sceneSummaryDueOf` / the routine's mode is Off — say which you assert);
- *On close* → **Review**;
- a mode the owner already chose on the session's row is kept (e.g. row says `full`, stored *Never* → still `full`,
  stored value cleared);
- a session whose row only changes a cadence (no mode) and holds *Never* ends up **Off**;
- Story **Minimal** and a session whose own row drops the routine are untouched (metadata and rows identical);
- other `metadata.scenes` keys (e.g. `mode`) survive; `scenes` disappears when `summary` was its only key;
- **a second run changes nothing** (registration rows and session metadata byte-identical; report `converted: 0`);
- an owner who later sets **Full** is not reset by the next run;
- `sessions:setSessionPreset`: a Minimal session holding *Never* switched to Living is **Off** at once, its cues are
  pushed (spy on / mock `pushSceneCues` or observe the emitted `scenes:cues`), and a following
  `summariesToRoutine(db)` changes nothing;
- `sessions:update` with `sceneSettings: { mode: "manual", summary: "never" }`: on a session with the routine the
  stored override has `mode` and no `summary`; on a session without the routine it keeps `summary`.
Put the socket claims in the same new file or a new `src/lib/server/sockets/sessions.summariesRoutine.int.test.ts`;
see `sockets/sessions.createRulesets.int.test.ts` for how a handler is driven in a test.

## Files owned

New `src/lib/server/sessions/summariesToRoutine.ts`, its test, `src/lib/server/startup/index.ts` (the one task
entry), `src/lib/server/sockets/sessions.ts` (only the two spots above), the optional new socket test file. Nothing
else (`settingsForm.ts` needs no edit: `patchSessionRow` is already exported).

## Out of scope

`sessions/sceneSettings.ts`, `scenes/*`, `sockets/scenes.ts` (worker 1), the form, docs, the SDK, any migration,
any new setting, branches, the routine itself.

## Stop and ask when

The pass cannot be made a no-op on the second run; a migration seems needed; `patchSessionRow` cannot express "only
where no mode"; a name you need collides; anything outside the files owned would have to change.

## Done means

Your new tests pass; `src/lib/shared/conformance/commentHistory.test.ts` passes; `sessions/dcCrawlClock.int.test.ts`
still passes (startup file touched); `tsc` clean for your files. Report the exact commands and pass counts, and the
names you chose with the grep that shows no collision.
