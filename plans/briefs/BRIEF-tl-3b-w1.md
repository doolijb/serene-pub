# BRIEF — worker `tl-3b-w1` (server): `sessions:create` takes the person's story-time choice for new notes

App repo `/home/jody/github/serene-pub`. Supervisor: lane `tl-3b`. Work only in the files below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No SDK build is expected in this task at all; if the SDK must change, stop and report.)

Also: never `git checkout/restore`, never `prettier --write`, no migration, no full test run, no `npm run build`. Never `kill -9` anything. Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.

## Goal

`sessions:create` gains one optional top-level parameter, 🚧 `notesTimeline?: boolean` (already typed by the supervisor in `src/lib/shared/sockets/types.ts`, `Sockets.Sessions.Create.Params` — read its doc comment; do NOT edit types.ts). It is the start form's switch for whether the session's own **new** notes keep a timeline.

## Rules (decided by the supervisor; follow exactly)

1. **Where it is honoured:** only when the session gets its own new notes: no `starterKit` and no lorebook on the row (`row.lorebookId == null`, i.e. `insertOwnBook` is called with `timelineEnabled`). In `src/lib/server/sockets/sessions.create.ts` that is the `insertOwnBook` call ~773–791, which today passes `timelineEnabled: timelineDefaultFor(getGenre(row.genreId), { defaults: presetDefaults })`. With a chosen lorebook, a kit, `new-world`, `next-chapter` (always attaches a lorebook, ~93–128) or `branch` (returns early, ~72–90) the parameter is ignored: no code path there changes.
2. **Precedence:** a genre that does not resolve, or that declares `timeline: 'required'` (the Lair, Dungeon Crawler), is **on whatever the parameter says** (ignored silently — the same way create answers a contradicted How strict with the locked value, ~691–699; not refused). Otherwise a boolean `notesTimeline` wins; absent → `timelineDefaultFor(genre, { defaults: presetDefaults })` exactly as today. Compute this once, before the transaction (the genre is known from `params.session.genreId` after preset resolution; use the same `getGenre(...)` the code uses). Do NOT edit `src/lib/server/lorebooks/timeline.ts` (not owned); do the mandate check inline in create: `!genre || genre.timeline === "required"` (mirrors `timelineDefaultFor`'s first two lines).
3. **A picked date is never written with story time off.** When the session gets its own new notes and their resolved timeline is **false**, any `storyClock*` in `params.session` is ignored: treat it as if no clock were named, both in the `sessionLinePatch` `clock:` argument (~750–761) and in the `requestedClockYear == null` start block (~814–842; with the notes undated, `storyStartOf` answers `undated` and writes nothing). This applies whether or not `notesTimeline` was sent (the form sends a clock only while its switch is on, but the server is the authority). Do not change how a clock is treated with an attached lorebook or a kit. Today `sessionLinePatch` (`sessions.shared.ts` ~1609–1619) checks only the calendar, not the timeline: do NOT edit `sessions.shared.ts`; drop the clock in create.
4. With the notes' timeline resolved **true** and no clock named, create's existing `today` branch starts the session at today's date (no time of day) on the real calendar: no change needed, only test it. With a clock named, it is checked against `OWN_BOOK_CALENDAR` by `sessionLinePatch` and written: honoured.
5. Keep the diff small: the parameter and its use only. A short `// 🚧` comment where you resolve it. Do not touch `state/storyTime.ts`, `pipelines/runtime/host*.ts`, `characters/versions.ts`, `state/write.ts`, `lorebooks/ownBook.ts` (another lane is editing them right now: call them only).

## Callers to verify (read only, list in your report)

Every other caller of `sessions:create` must still send no `notesTimeline` (absent = default, unchanged): the first-run wizard via `buildCreatePayload` (`src/routes/+page.svelte` ~1118–1127), the document-view new-session page (`src/routes/document-view/sessions/new/+page.svelte` ~111–124), next chapter / branch (server-side modes), tests' helpers. The import of sessions does not call create (`sockets/import.ts` calls `insertOwnBook` itself): confirm. Grep `"sessions:create"` and `sessionsCreateHandler` across `src`.

## Tests

New file `src/lib/server/sockets/sessions.createNotesTimeline.int.test.ts`, modelled on `src/lib/server/sockets/sessions.createStoryStart.int.test.ts` (copy its mocks, its `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`, its temp-dir setup with a lane-specific prefix `serene-pub-vitest-create-notes-timeline-`, its fake socket, and its way of making a fixture preset row with `timeline: true` — read how it states Living's preset `timeline: true`). Read each new session's own notes' `timelineEnabled` (own notes: `lorebooks.sessionId = session.id`) and the session's `storyClock*` columns. Cases:

- `notesTimeline` true / false / absent × each shipped Story preset (`core-story-minimal`, `core-story-living`, `core-story-rule-based`; check the seed keys in `../serene-pub-sdk/core-catalog/src/seed/presets.ts` and how the existing test finds a preset id): true → notes on, session clock = today (use fake timers / `vi.setSystemTime` like the existing test, owner time zone set), false → off and clock null, absent → off (the default) and clock null.
- A fixture preset row with `defaults.timeline: true`: absent → on; false → off.
- A required genre (`core-dungeon-crawler-default` and/or the Lair's preset): false → notes still on (ignored, no error).
- A chosen lorebook: `notesTimeline: false` with an attached lorebook that keeps a timeline → no error, the lorebook's switch unchanged, notes copy as today (assert the behaviour is identical to absent).
- A starter kit: `notesTimeline` given → ignored (kit copy keeps the kit's switch; compare with absent). Find how other tests start from a kit (grep `starterKit:` in `src/lib/server/**/*.int.test.ts`).
- Picked date honoured: `notesTimeline: true` + `storyClockYear/Month/Day` (a valid real-calendar date, e.g. 2030-5-17) → the session's clock is that date.
- Picked date with the timeline off: `notesTimeline: false` + a clock → clock columns all null, no error; same with `notesTimeline` absent on a Story preset (default off) + a clock → null.
- A second boot changes nothing: after creating one session with `true` and one with `false`, run the boot pass that touches the switch (`settleTimelineSwitches`; see how `src/lib/server/sockets/sessions.timelineDefault.int.test.ts` runs it, including a "not yet run" state and a second run) twice; both notes keep their value, clocks unchanged.

Then grep existing tests that create a session with a `storyClockYear` and **no** lorebook on a genre/preset whose notes now default off (rule 3 changes them): `grep -rln "storyClockYear" src/lib/server --include=*.int.test.ts`, and read each call. List every one that is affected; run them. If one fails because of rule 3, do NOT re-pin it silently: report the test name, the old and new value; the supervisor decides.

Run tests only like this, one run at a time (another lane runs vitest too):

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-3b-w1-<n>.log 2>&1"
```

Never pipe vitest into `head`. Run at least: the new file, `sessions.createStoryStart.int.test.ts`, `sessions.timelineDefault.int.test.ts`, `sessions.storyUndated.int.test.ts`, `sessions.creationModes.int.test.ts` (its "a following session is followed by a following one" already fails since another lane, expected; do not re-pin it), plus the affected files you found. Typecheck: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (errors in another lane's files — `pipelines/runtime/host*.ts`, `state/storyTime.ts`, `state/reading.ts`, `characters/versions.ts`, `state/write.ts`, `lorebooks/ownBook.ts` — note them and judge only yours). `npx prettier --check` your files.

## Files owned

- `src/lib/server/sockets/sessions.create.ts` (the parameter and its use only)
- `src/lib/server/sockets/sessions.createNotesTimeline.int.test.ts` (new)

## Files readable

Anything. Notably `sessions.shared.ts` (`sessionLinePatch`), `lorebooks/timeline.ts`, `lorebooks/ownBook.ts`, `state/storyTime.ts` (`storyStartOf`, `storyToday`), the tests named above.

## Out of scope

Client code, docs, NOMENCLATURE, types.ts (already done), `lorebooks:storyTime`, any new socket event, any change to other create branches, the creationModes test.

## Stop and ask when

Anything above can't be done without editing a file you don't own; a test outside the new file needs re-pinning; you need a new name beyond `notesTimeline`.

## Done means

The new test file green; the listed existing files green (except the known creationModes case); tsc clean for your files.

## Report (your final message, under 400 words)

Changed files; exactly how and where the choice is resolved (line numbers); the clock-drop rule (lines); callers verified (file:line each); tests run with log paths and counts; any affected existing test; Noticed, not done.
