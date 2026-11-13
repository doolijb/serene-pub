# BRIEF — hist-B2: `note-scene@1` host, scene notes, and cast state from pipelines (core)

Plan: `plans/PLAN-history-one-per-date-2026-11-10.md`. Read the rulings sections and **§ Build scope items 3 and 5**. Read the reports `plans/REPORT-hist-C-2026-11-10.md` (the SDK contracts it added: `noteScene` = `core:outlet/note-scene@1`, and the `update-cast-member@1` doc for `nodeState`/`nodeVisibility`) and `plans/REPORT-hist-G-2026-11-10.md`. GO 2026-11-10. **The SDK is built** (lead, 2026-11-10), so `@serene-pub/contracts` carries the new outlet. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Other sessions are editing nearby (host.ts carries unrelated seat-cast work; another session works in `src/lib/server/managed/*` and the koboldcpp/audiocpp process files). Check each file's `git diff` before editing.

## Rulings this lane applies

- **★S4:** `note-scene@1` now (owner). **S2 (default):** a note on an already-compiled scene marks its day for recompile. Implement the smallest form: the scene, or its day's entry, gets a flag/marker that the existing Not-yet-compiled / Compile UI already understands. If no such marker exists, **stop and report** the smallest option. Don't invent UI.
- **Scenes first:** a note never writes history and never adds messages. "A message belongs to one scene" holds (`scenes/liveScenes.ts:412`).
- **Item 5:** `update-cast-member@1` accepts `nodeState` (checked against `CAST_STATE_WORDS`, SDK `sdk/src/ties.ts:137`) and `nodeVisibility` (`normal|legendary|hidden`). They are dated at the session's story time and tied to the turn like the profile fields, so a retake undoes them. Today's checker refuses both (`src/lib/server/pipelines/runtime/castMember.ts:183-186`), though the writer underneath supports them (`characters/versions.ts:1343-1347`). On hist-C's open point, `{ follow: true }` for these keys: follow what the writer already does for them, and say which in the report.

## Goal

1. **Storage:** a nullable `scenes.notes` jsonb column `[{ text, runId, messageId, at }]` in `src/lib/server/db/schema.ts`.
   - Then `npm run db:generate`. It must produce exactly one new migration `0150_*` adding that column; the highest today is `0149_familiar_silk_fever`. Stop if it produces anything else.
   - No data pass is needed (nullable, no backfill). Add a migration test only if the repo's pattern requires one for a new nullable column; check `dataUpgrades/runner.int.test.ts` and recent migrations.
2. **Host:**
   - a binding for `core:outlet/note-scene@1` in `src/lib/server/pipelines/runtime/bindings.ts`, following how `propose-scene-cue@1` is bound;
   - a commit case in `src/lib/server/pipelines/runtime/host.ts`;
   - the write itself in the **scenes module** (P2: `scenes/liveScenes.ts` owns writes to `scenes`), a new exported function such as `appendSceneNote(tx, { sessionId, sceneId?, text, runId, messageId })`;
   - target the lane's open scene when no `scene` is given;
   - **refused in words** when: the genre has `writes.scenes: false`; the scene is another session's; there's no open scene and no `scene` was given. Copy (provisional 🚧): *"‹node›: this genre keeps no scenes."* · *"‹node›: that scene belongs to another session."* · *"‹node›: no scene is open to note; open one first (propose-scene-cue@1)."*;
   - imprint it so a retake or Back takes the note back (follow the imprint pattern `changeLoreEntry` uses, or the closest one for scene rows; if scenes have no imprint subject, **stop and report**).
3. **Notes reach summaries and compile:**
   - the scene-summarize request input (`summarize-request@1`, built in `sockets/scenes.ts` `processScene` ~1600 and the scene summarize spec inputs) includes the scene's notes;
   - `compileScenesForEntry` includes each scene's notes beside its summary.

   Find exactly where scene text is assembled for each and add the notes there, labelled plainly, e.g. "Noted in this scene:". Keep it minimal.
4. **Cast state:** widen the `castMember.ts` check (`:172-205`) as above, refusing an unknown word in words. Test that a `deceased` change lands as a dated, turn-tied cast version that Back removes, and that `dead` is refused.
5. **Registry hashes:** update `src/lib/server/pipelines/boot/registryHashes.test.ts` for the new outlet and any moved hash (`create-lore-entry@1`, `current-date@1`), as hist-C queued. Also update any core test asserting that every core outlet has a binding.

## Files owned

- `src/lib/server/db/schema.ts` (the one column), generated `drizzle/0150_*` + meta
- `src/lib/server/pipelines/runtime/bindings.ts` (the one binding), `src/lib/server/pipelines/runtime/host.ts` (the one case), `src/lib/server/pipelines/runtime/castMember.ts`
- `src/lib/server/scenes/liveScenes.ts` (the new note writer only), `src/lib/server/sockets/scenes.ts` (notes into the summarize input and compile only)
- `src/lib/server/pipelines/boot/registryHashes.test.ts`, the outlet-binding coverage test
- new and existing tests for the above

## Out of scope (write down, never build)

- Dungeon Crawler (hist-D, next). Benched seats (a separate plan). The SDK (built; no SDK edits in this lane). Docs and NOMENCLATURE (hist-F): queue names and copy.
- Any UI beyond what already exists for compile.

## Stop and ask when

CLAUDE.md §Decisions applies; `db:generate` produces more than the one column; scenes have no undoable write path; the recompile marker needs new UI; a name beyond the copy above and `appendSceneNote` is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This lane needs no `sdk:build`.)
- Migrations are generated (`db:generate`), and the new index must exceed the highest applied. Never seed a row at a hardcoded id. Inside `db.transaction(async (tx) => …)` use only `tx`.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `hist-B2-`.

## Done means

- **Targeted tests pass:**
  - note-scene appends to the open scene, and a retake removes it;
  - each refusal, in words;
  - notes reach the summarize input and the compile input;
  - a note on a compiled scene sets the recompile marker (or the stop report);
  - cast state: `deceased` lands and Back removes it, `dead` is refused, `nodeVisibility` lands;
  - registry hashes and binding coverage are green;
  - the existing `scenes*`, `liveScenes*`, `castMember*` and `pipelines/runtime/*` tests still green (the Dungeon Crawler cairn reds are expected; list them).
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files (capped, `NODE_OPTIONS=--max-old-space-size=8192`, `MemoryMax=12G`).
- **No full suite.**

## Report

`plans/REPORT-hist-B2-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files, the migration filename, tests and results, names and copy for lane F, open ★, **Noticed, not done**.
