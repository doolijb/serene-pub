# BRIEF — lane `sense-clk`, worker 2 — the round tick, proven in the app

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

You are a `lane-worker` under the `sense-clk` supervisor. App repo: `/home/jody/github/serene-pub`. SDK repo (read only for
you): `/home/jody/github/serene-pub-sdk`. Use absolute paths in every command. The SDK is already built (`npm run sdk:build`
ran after the change); the app imports `@serene-pub/core-catalog` from that build. **Do not build anything.**

## What exists now (built by worker 1, in the SDK)

- `core:spec/round-tick` (`core-catalog/src/shared/roundTick.ts`, exported `ROUND_TICK_SPEC_ID`, `roundTickSpec`; CORE_SPECS
  name *Each round moves the clock*): an **event** pipeline on `core:event/round-ended@1`. Graph: inlet `event`
  (`core:inlet/session-event@1`) → task `tick` (`core:task/clock-step@1`, exposed to the session, label *Each round advances
  the clock by*, shipped default `by: 5`, unit `minutes`) → junction `clock` on `tick.moves` → query `clock.moves.present`
  (`core:query/cast-presences@1`, its `at` = the story date the session reads at: its own clock, else its line's clock, else
  null) → junction `clock.moves.clocked` on `present.at` → outlet `clock.moves.clocked.at.advance`
  (`core:outlet/advance-story-clock@1`, `cause: 'tick'`, `onRefusal: 'skip'`). No model call.
- Registered in **Story's** and **the Lair's** defaults only (`genres/defaults.ts`):
  `register(coreEvents.roundEnded, roundTickSpec(), { values: { tick: { params: { unit: setting('minutes', { lock: true }) } } } })`.
  Not in Chat, the Guide or the Dungeon Crawler.
- The app has no special code for it: boot projects the genre's registrations into the `registrations` table; the event
  dispatch (`pipelines/runtime/sessionEvents.ts`, `settleRest` → `dispatchSessionEvent`) runs it when `round-ended` is
  emitted (`pipelines/routines/moments.ts` `noteLineLanded`, after the reply's own event work). The move is written by the host
  (`runtime/host.ts` ~9898, `state/clockMoves.ts` `recordClockMove`) as a `state_proposals` row of kind `clock`, status
  `applied`, payload `{ kind: 'clock', by, unit, cause: 'tick', from, to }`, anchored (`message_id`) to the session's newest
  message — the reply that closed the round. A delete takes it back (`revertClockMovesAnchoredTo`); a swipe/regenerate keeps a
  `tick` (unchanged rule — do not touch it).

## Files owned (edit only these)

1. NEW `src/lib/server/pipelines/routines/roundTick.int.test.ts`.
2. `src/lib/server/pipelines/boot/specHashes.test.ts` — add ONE pin at the end of `PUBLISHED`, after the weather pin, with a
   comment in the file's form:
   `// NEW 2026-11-11 (sense-clk, PLAN-sensible-engine §2.11): each round moves the story clock — an event pipeline on round-ended, registered by Story and the Lair; no model. 🚧`
   then `"core:spec/round-tick@1.0.0": "<hash the test prints>"`. Get the hash by computing `canonicalHash(roundTickSpec())`
   the way the test's `current()` does (a throwaway run, or read it off a failing run if the test prints unpinned slugs).
3. Any other app test that fails **only** because Story's or the Lair's defaults gained this registration, or a Story/Lair
   session's settings form gained its card: change the expectation minimally, and list each with the reason. Anything else
   failing: report it, do not fix it.

## The new test file (Done means: every case below fails before the change and passes after)

Build it on the harness of `src/lib/server/pipelines/routines/routines.int.test.ts` (read lines 1–200: `vi.mock` of
`$lib/server/db` with `createTestDb`, the embedding mocks, the broadcast mock, the `FakeAdapter` and connection setup,
`bootstrapPipelines`, `sessionsCreateHandler` with the Story **Living** preset, `sessionMessagesSendPersonaMessageHandler`,
`settleSessionEvents`). Leave routines disabled (do not call `setRoutinesEnabled(true)`): the round tick is an event
pipeline, not a routine, so it must run without them. Each `it` that opens or drives the DB gets a 60 s+ timeout
(`vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })` is fine). The data dir: `fs.mkdtemp(path.join(os.tmpdir(),
"serene-pub-vitest-round-tick-"))`, removed in `afterAll` by that exact path.

Cases:

1. **A Story session with a clock moves 5 minutes when a round ends, with a line under the closing message.** Living session,
   one character, a lorebook attached (the harness's `living()`), then set the session's own clock (`storyClockYear: 412,
   storyClockMonth: 3, storyClockDay: 5, storyClockHour: 9, storyClockMinute: 0` on `schema.sessions`). Send one line, settle.
   Expect: the clock reads 09:05 (same day); exactly one `state_proposals` row of kind `clock` for the session, status
   `applied`, payload `cause: 'tick'`, `by: 5`, `unit: 'minutes'`, anchored to the reply (the newest assistant message, the one
   that closed the round); a `pipeline_runs` row with `specSlug === 'core:spec/round-tick'`, `triggerFamily: 'event'`, outcome
   ok. Also read the ledger line the person sees, as `src/lib/server/state/clockMoves.int.test.ts` `linesOf` does
   (`clockLedgerRows` + `ledgerLines`), and expect its text to match `/^Time passes: 5 minutes \(/`.
2. **The same with By 0 does not move.** Another such session; before sending, set the session's own value through the derived
   settings form: `updateSetting(db, sessionId, { userId: ownerId, isAdmin: false }, { kind: "pipeline", registrationKey,
   nodeKey: "tick", slot: "params", path: "by" }, 0)` (`$lib/server/sessions/settingsForm`; find `registrationKey` through
   `effectiveRegistrations(db, sessionId)` → the entry whose `pipeline` is `core:spec/round-tick`). Send, settle. Expect: clock
   unchanged at 09:00, no clock row, the round-tick run still recorded (it ran and moved nothing).
   In the same case, before the write, assert the owner's form (`settingsFormBuild(db, sessionId, { userId: ownerId, isAdmin:
   false })` → `formFields(form)`) has the field `tick · params · by` for this registration with `value === 5`, editable, and
   has **no** `tick · params · unit` field (Unit is locked by the genre, so the owner never sees it). This proves the setting
   renders from the declaration with no hand-built control.
3. **A Story session with no clock does not move, starts no clock and writes no line.** A Living session on a fresh lorebook
   with no calendar, no clock and no history entries, and no session clock. Send, settle. Expect: all five `storyClock*`
   columns still null; no `state_proposals` row of kind `clock` at all for the session; the round-tick run recorded.
4. **Deleting the closing message takes the move back.** In case 1's session (or a fresh one set up the same way), after the
   move, delete the reply as `clockMoves.int.test.ts` ~360 does (`createHost(…, specId "core:spec/builtin-delete")` →
   `commit!({ target: replyId }, { key: "delete", definitionId: "core:outlet/delete-message", definitionVersion: 1 })`), or
   through the app's own delete path if that is simpler and deletion is allowed for the test session. Expect: the clock back at
   09:00 and the clock row gone.
5. **Only Story and the Lair register it.** After boot, `genreRegistrations(db, genreId)`
   (`$lib/server/pipelines/registrations/resolve`) for `core:genre/story` and `core:genre/lair` each include exactly one entry
   with `pipeline: 'core:spec/round-tick'` on `trigger.family === 'event'`, `trigger.event === 'core:event/round-ended@1'`;
   for `core:genre/guide`, `core:genre/chat` and `core:genre/dungeon-crawler`, none names it and none is on `round-ended`.
6. **A second boot changes nothing.** Snapshot the `registrations` rows whose `spec_slug` (or the schema's equivalent column)
   is `core:spec/round-tick` (id, key, scope, values), run `bootstrapPipelines(db)` again, snapshot again: equal.

If a case cannot be made to pass without changing app source, stop and report exactly what you saw (receipt `haltReason`, the
round-tick run's node outputs, whether `round-ended` fired). Do not change app source files.

## Running tests

Capped scope, targeted files only, never piped into `head`:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <files>"
```

Run: the new file; `src/lib/server/pipelines/boot/specHashes.test.ts`; `src/lib/server/pipelines/boot/registryHashes.test.ts`;
`src/lib/server/sessions/settingsForm.int.test.ts`; `src/lib/server/sessions/stepSettings.int.test.ts`;
`src/lib/server/pipelines/registrations/resolve.int.test.ts`; `src/lib/server/pipelines/registrations/door.int.test.ts`;
`src/lib/server/pipelines/routines/routines.int.test.ts`; `src/lib/server/sockets/presetBindings.int.test.ts`;
`src/lib/client/components/sessionForms/sessionSettingsForm.dom.test.ts`; `src/lib/server/state/clockMoves.int.test.ts`.
Then `npx prettier --check <file>` on each file you changed.

## Verbatim rules

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — For this worker: do not run `sdk:build` at all.
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` a dev server; do not start one.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head` (the SIGPIPE leaks PGlite temp dirs).
- It is a **session**, never a *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook" in a test name or comment — say "no story clock".
- No reference to any other project or product in code, comments or tests.
- Another lane (`sense-rin`) is editing the lorebook editor's Read in? tab and the server read behind it. Never touch its files.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.

## Report (your final message)

Changed files; the exact commands and pass/fail counts per file; the new pin's hash; each expectation you changed outside the
two owned files and why; anything that would not pass and what you saw; the `/tmp/serene-pub-vitest-*` dirs you removed;
**Noticed, not done**.
