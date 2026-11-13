# BRIEF — hist-B2-w1: cast state from pipelines; scene notes into Compile and the summarize request; the 0150 migration test

Supervisor: hist-B2 (plan `plans/PLAN-history-one-per-date-2026-11-10.md`, Build scope items 3 and 5). Repo `/home/jody/github/serene-pub`. Use absolute paths. The owner gave the go on 2026-11-10.

Other sessions are editing nearby: `sockets/scenes.ts` and `castMember.int.test.ts` may carry **unrelated uncommitted work**. Run `git diff <file>` before you edit each file, edit with exact-string `Edit` calls only, and never touch a hunk you didn't make. A second worker (hist-B2-w2) is editing `scenes/liveScenes.ts`, `runtime/bindings.ts` and `runtime/host.ts` at the same time; don't touch those.

## Rulings this applies (verbatim from the lane brief)

- **Item 5:** `update-cast-member@1` accepts `nodeState` (checked against `CAST_STATE_WORDS`, SDK `sdk/src/ties.ts:137`) and `nodeVisibility` (`normal|legendary|hidden`). They are dated at the session's story time and tied to the turn like the profile fields, so a retake undoes them. Today's checker refuses both (`src/lib/server/pipelines/runtime/castMember.ts:183-186`), though the writer underneath supports them (`characters/versions.ts:1343-1347`).
- **Notes reach summaries and compile:** the scene-summarize request input (`summarize-request@1`, built in `sockets/scenes.ts` `processScene`) includes the scene's notes; `compileScenesForEntry` includes each scene's notes beside its summary. Labelled plainly, "Noted in this scene:". Keep it minimal.
- **Scenes first:** a note never writes history and never adds messages.
- "0.6 is in users' hands": a change to stored data ships with a test that a second boot changes nothing.

## Goal

### Part 1 — `src/lib/server/pipelines/runtime/castMember.ts` `checkChanges` (~172-205)

The scene column already exists (supervisor added `scenes.notes jsonb` and generated `drizzle/0150_chief_starjammers.sql`). Part 1 is independent of it.

1. Before the `isCharacterProfileField` refusal, handle the two node keys:
   - `nodeState`: the value must be one of `CAST_STATE_WORDS` (import it from `@serene-pub/sdk`; it is exported there). Otherwise refuse with exactly: `` `'${String(value)}' is not a cast state; a cast member's state is one of ${CAST_STATE_WORDS.join(", ")}.` ``
   - `nodeVisibility`: the value must be one of `normal`, `legendary`, `hidden` (type `NodeVisibility` from `$lib/server/db/schema`; a module-level `const` array in this file typed with it is fine). Otherwise refuse with exactly: `` `'${String(value)}' is not a cast visibility; it is one of normal, legendary, hidden.` ``
   - `{ follow: true }` on either key: **supervisor's decision** (hist-C's open point): the writer has no follow for node keys (`applyChanges` in `characters/versions.ts` ~1386-1415 stores the value as given, so a follow object would be stored as the state), so refuse with exactly: `` `'${key}' has no card value to follow; give it a value.` ``
   - Return `[key, value]` for an accepted one. Put a `// 🚧 Provisional copy: the owner has not seen these sentences.` comment above the three refusals.
2. Update `checkChanges`' doc comment and the `"'changes' must be an object of character profile fields."` context only as needed to say the node keys are accepted (don't change that sentence's text). Make sure `writeCastMember`'s "chosen values" checks (`profileOf(...)` over the entries) still work with node keys present; if `profileOf` would choke on them, filter them out of that one call.
3. Nothing else in the file changes.

### Part 1 tests

- `src/lib/server/pipelines/runtime/castMember.int.test.ts` (read it whole first): the `refusals` test today asserts `nodeState: "missing"` is refused. Replace that line with refusals for `{ nodeState: "dead" }` (`/'dead' is not a cast state/`), `{ nodeVisibility: "public" }` (`/not a cast visibility/`) and `{ nodeState: { follow: true } }` (`/no card value to follow/`). Add a test: `{ nodeVisibility: "legendary" }` with a `messageId` lands (the version the session reads has `nodeVisibility === "legendary"`; `membersAsRead(...).get(id)` exposes `nodeState` / `nodeVisibility` — check the field names there).
- **New** `src/lib/server/pipelines/runtime/castMember.nodeState.int.test.ts`, modelled on `src/lib/server/state/retractCastVersions.int.test.ts` (read its `world()`, `played()` and the "Back takes a cast version" test, ~60-240, and copy what you need: a session with a story clock, a person's line plus a reply as the turn): write `{ nodeState: "deceased" }` through `writeCastMember` with the reply's `messageId` and a `runId`; assert the new `character_versions` row has `nodeState === "deceased"`, `sourceMessageId` equal to the turn's anchor, and its date (year/month/day columns) equal to the session's story clock day; then `rewindTurn` (`$lib/server/sessions/rewind`) → `{ ok: true }`, the row is gone, and the session reads the member as not deceased again. A `60_000` timeout on every test (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`), a `mkdtemp` dir named `serene-pub-vitest-castmember-state-` removed in `afterAll`.

### Part 2 — scene notes into Compile and the summarize request (`src/lib/server/sockets/scenes.ts`)

The column's type is `Array<{ text: string; runId: string | null; messageId: number | null; at: string }> | null` (`schema.scenes.notes`).

4. **Compile** (~1570, the `compileScenesForEntry({ scenes, … })` call in the compile handler): pass `scenes` mapped so that a scene whose `summary` is non-blank and whose `notes` hold at least one note with non-blank text gets `summary` = `` `${summary.trim()}\n\nNoted in this scene:\n${lines}` `` where `lines` is each note's trimmed text as `- <text>`, joined by `\n`, oldest first. A scene with a blank summary is passed unchanged (supervisor's decision: notes go *beside* a summary; don't make a notes-only scene compile). Do it inline at that call (a small local arrow function inside the handler is fine; **no new exported name**). Every other use of `scenes` in that handler stays as it is.
5. **Summarize request** (`processScene`, ~1966-1990, `input.request`): when the scene has notes with non-blank text, `request.scene` becomes `{ ...(await sceneHeaderOf(db, scene)), notes: [<trimmed text>, …] }`; otherwise it stays exactly as today (no `notes` key). Add a one-line comment: the transcript preamble does not render `scene.notes` yet (`pipelines/runtime/transcript.ts` `sceneOf` keeps name/place/date only); that half is queued.
6. Nothing else in `sockets/scenes.ts` changes.

### Part 2 tests

- **New** `src/lib/server/sockets/scenes.notes.int.test.ts`. Model the fixture on `src/lib/server/sockets/scenes.compileForksRiding.int.test.ts` (read it whole: it mocks `$lib/server/utils/summarizer` `compileScenesForEntry` and records what it was handed, and mocks the connection target). Tests:
  - Compile: a day with two scenes, one with a summary and two notes, one with a summary and none → the mocked `compileScenesForEntry` receives the first's `summary` ending with `"Noted in this scene:\n- <first note>\n- <second note>"` and the second's unchanged.
  - Summarize request: find how `processScene` calls `runSpec` (its import in `sockets/scenes.ts`) and mock that module so the call's `input.request.scene` is recorded and a minimal receipt is returned (look at what `processScene` reads off the receipt: `nodes[].nodeKey === "synth"` with `output.content`). A scene with notes → `request.scene.notes` equals the trimmed texts; a scene without → no `notes` key. If `processScene` needs more than a few mocks to reach `runSpec` (e.g. a model resolution), copy how an existing test reaches it (`grep -ln processScene src/lib/server/**/*.test.ts`); if none does and it needs more than ~4 mocks, stop and report rather than build a large harness.
- **New** `src/lib/server/db/sceneNotes0150.int.test.ts`, a copy of the pattern in `src/lib/server/db/surfacedFrom0148.int.test.ts` (read it whole): migrate through `"0149_familiar_silk_fever"` with `migrationsFolderThrough`, insert a user (the first user row exists), a session, a lorebook and a scene (`INSERT INTO scenes (session_id, lorebook_id) VALUES (…)`), migrate the real folder, assert counted rows unchanged and `notes IS NULL` on the scene, write a note array into it with `UPDATE … SET notes = '[{"text":"x","runId":null,"messageId":null,"at":"2026-11-10T00:00:00.000Z"}]'::jsonb` and read it back, then the second-boot block (ledger hashes and table dumps unchanged; count `users`, `sessions`, `lorebooks`, `scenes`). `60_000` timeout.

## Files owned (edit only these)

- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/castMember.ts` — `checkChanges` and its doc only
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/castMember.int.test.ts`
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/castMember.nodeState.int.test.ts` (new)
- `/home/jody/github/serene-pub/src/lib/server/sockets/scenes.ts` — items 4 and 5 only
- `/home/jody/github/serene-pub/src/lib/server/sockets/scenes.notes.int.test.ts` (new)
- `/home/jody/github/serene-pub/src/lib/server/db/sceneNotes0150.int.test.ts` (new)

## Files readable

Anything. Useful: `src/lib/server/characters/versions.ts` (~1336-1420 `CastVersionChanges`, `applyChanges`; ~1640-1700 `writeCastVersion`), `src/lib/server/cast/memberAsRead.ts`, `src/lib/server/utils/summarizer/index.ts` ~270-380 (`compileScenesForEntry`; note it passes a single draft through verbatim), `src/lib/server/pipelines/runtime/transcript.ts` ~135-152 (`sceneOf`), `src/lib/server/scenes/liveScenes.ts` ~1755 (`sceneHeaderOf`).

## Out of scope (write down, never build)

- `transcript.ts`, the SDK's transcript template, `utils/summarizer/*`, the scenes module, `host.ts`, `bindings.ts`, docs, NOMENCLATURE.
- Any UI. Any new exported name. Any change to how a notes-only scene compiles.

## Stop and ask when

- You would need a name, a sentence or a file not listed here.
- A `castMember.int.test.ts` test other than the `refusals` line goes red because of your change.
- Reaching `runSpec` in a test needs a large harness (see above).
- Anything needs a migration or a setting.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You need no `sdk:build`.)
- Migrations are generated (`db:generate`); never write one by hand. Never seed a row at a hardcoded id. Inside `db.transaction(async (tx) => …)` use only `tx`.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Don't run `tsc` or `npm run check`; the supervisor runs the typecheck once for the lane.
- Scratch files start with `hist-B2-w1-`.

## Done means

- Green: `castMember.int.test.ts`, `castMember.nodeState.int.test.ts`, `castMember.sdkShape.test.ts`, `scenes.notes.int.test.ts`, `sceneNotes0150.int.test.ts`, `scenes.compileForksRiding.int.test.ts`, `scenes.compileLine.int.test.ts`, `scenes.summaryReview.int.test.ts` (all under `src/lib/server/…`).
- `npx prettier --check` on each file you touched; report the result (don't fix with `--write`).

## Report

Write it to `/home/jody/github/serene-pub/plans/briefs/REPORT-hist-B2-w1.md` (if the write is refused, put it in your final message): changed files with what changed, tests run with results, every sentence you added, anything you decided, and **Noticed, not done**.
