# BRIEF — sense-st2 worker 4 — prove the one undo rule end to end (tests only)

You are a `lane-worker` for lane `sense-st2`. App repo `/home/jody/github/serene-pub`. Absolute paths. Report in your
final message (files written, each test's name and result, exact vitest totals, any test you could not make pass
and why, Noticed-not-done). No report file. **You write tests only; you change no source file.** If a test shows a
source bug, keep the test, mark it `it.fails` only if the supervisor's rule below says so, and report the bug with
file:line — do not fix it.

## The rule under test (built by worker 1; the SDK is built)

`retractStateAnchoredTo(db, messageId, "replaced" | "leaves")` (`src/lib/server/state/write.ts`):

- **replaced** = swipe (`sessionMessagesSwipeRightHandler`, `src/lib/server/sockets/sessions.ts` ~9962), row
  regenerate (`sessionMessagesRegenerateHandler`, ~9326), a failed run's cleanup (`utils/generationStatus.ts` ~244).
- **leaves** = Back (`rewindTurn`, `src/lib/server/sessions/rewind.ts`), delete (`core:outlet/delete-message` in
  `pipelines/runtime/host.ts` ~9853).
- Both take: values, configurations, proposals, clock moves, **scene boundaries** (`takeSceneBoundariesAt`), scene
  notes, zone snapshots, lore, cast versions, annex deltas, seat benches (`seatBenches` records in the `core` annex).
- Two differences on **replaced** only: (1) a clock move with `cause: 'tick'` (the round's tick) stays — interim
  ★ST2-1; (2) an annex field declared `keepOnRetell: true` keeps its value (the Dungeon Crawler's `core` fields
  `dungeon-crawler-progress`, `dungeon-crawler-planning-notes`, `dungeon-crawler-planning-notes-revealed`,
  `dungeon-crawler-journal`).
- **Forward** (`forwardTurn`) restores what Back took; a **failed swipe** (`runReply` returns `{ ok: false }`, not
  stopped) restores what the swipe took (`restoreRetractedState`).
- **Press anchor**: `writeAnnexDocument` in `host.ts` (~2378): a run of family `action` that opened no row anchors
  its annex delta to the session's newest message; the run of `ANNEX_FIELD_SPEC_ID` (`core:spec/set-annex-field`)
  stays unanchored (records no delta).

## Tests to write

New file `src/lib/server/sessions/oneUndoRule.int.test.ts` (and, if the round-tick case needs real turns, a second
file `src/lib/server/pipelines/routines/roundTick.undo.int.test.ts`). Patterns to copy (read them first):
`src/lib/server/sockets/sessions.retractAnnounce.int.test.ts` (driving swipe and regenerate handlers with
`runReply` mocked), `src/lib/server/sessions/rewind.int.test.ts` (Back/Forward), `src/lib/server/state/clockMoves.int.test.ts`
(clock moves; the delete outlet at ~365), `src/lib/server/pipelines/runtime/setSeatBench.int.test.ts` (benches and
their `seatBenches` record), `src/lib/server/sessions/annexChanges.int.test.ts` and `src/lib/server/sessions/annexFields.int.test.ts`
(annex writes), `src/lib/server/scenes/sceneNotes.int.test.ts` / `src/lib/server/sockets/scenes.cues.int.test.ts` (`openScene`),
`src/lib/server/pipelines/routines/roundTick.int.test.ts` (real Story turns, scripted model, the round tick).
Prefer the real writers (host outlets, `openScene`, `recordClockMove` + the clock step, `setSeatBench` via the
`set-seat-bench` outlet, `writeAnnexDocument` via `set-session-annex`) over hand-inserted rows; hand-insert only where
a writer cannot be reached, and say where.

For a reply R (the newest message, after a person line) that wrote **one of each**: a stat value, a clock move with
`cause: 'keeper'` (or `'action'`) that really moved the session clock, a scene opened at R, an annex write anchored
to R, and a seat bench anchored to R:

1. **Regenerate** takes all five (the value gone, the clock stepped back, the scene removed, the annex document back
   to before, the seat unbenched).
2. **Swipe** takes all five (the annex write too — before this lane a swipe kept it).
3. **Back** takes all five; **Forward** then restores all five.
4. **Delete** (the delete outlet) takes all five, including the scene boundary (before this lane a delete kept it).
5. **A failed swipe** (`runReply` → `{ ok: false }`) puts all five back.
6. **Round tick** (`cause: 'tick'`, applied, anchored to R, really moved the clock): a swipe and a regenerate leave it
   standing (exactly one tick row, clock not stepped back); Back takes it (clock stepped back), Forward puts it back.
   If you can drive real turns (roundTick harness): after Back of the round-closing reply, a new reply that closes
   the round ticks once — net exactly one tick row and the clock 5 minutes on. If driving real turns is too heavy,
   say so and test the parts above only.
7. **Press anchor**: a `set-session-annex` write from a host whose run family is `action` (see `withRunFamily` in
   `src/lib/server/utils/llmQueue.ts`) with no live row records a delta anchored to the newest message; Back past
   that message puts the annex back. The same write under `specId: 'core:spec/set-annex-field'` records no delta, and
   Back leaves the value.
8. **Dungeon Crawler keepOnRetell**: a session of genre `core:genre/dungeon-crawler` whose reply R wrote the `core`
   document's `dungeon-crawler-progress` and `dungeon-crawler-journal` (through the real annex write, so the
   declarations judge it) and benched a seat: a swipe keeps both fields at the turn's values and **takes the seat
   bench** (the lane's A2 choice: seats always go with the turn; the genre's re-telling files them again); Back after
   that takes both fields back to their before-values.

Each test names the verb and the thing. A test that opens a DB inside an `it` needs a 60 s timeout (or set it with
`vi.setConfig` as the patterns do). Clean up only your own temp dirs, by name.

Another worker is editing `src/lib/server/sessions/annexChanges.ts` at the same time (multi-delta narrowing). If a
run fails inside that file with a syntax or type error, wait a minute and re-run once before reporting.

## Files owned

The new test file(s) only. Readable: anything.

## Out of scope

Any source file; any existing test file; the SDK repo.

## Done means

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <your files>"`
green (report totals and each test name). `npx prettier --check <file>` on each new file (you may `npx prettier --write`
your own new files, one path at a time, never a directory). `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`
clean.

## Verbatim rules (from `.claude/guides/multi-agent.md` and `plans/briefs/BRIEF-sense-clk.md`)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not build.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never
  `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`. It is a **session**, never a *chat*.
  Every session has a lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs.
- Run only your targeted test files, in a capped scope (command above). Never pipe vitest into `head`. Do not start
  a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
