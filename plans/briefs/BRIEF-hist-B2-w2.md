# BRIEF — hist-B2-w2: the `core:outlet/note-scene@1` host (writer, binding, commit case)

Supervisor: hist-B2 (plan `plans/PLAN-history-one-per-date-2026-11-10.md`, Build scope item 3). Repo `/home/jody/github/serene-pub`. Use absolute paths. The owner gave the go on 2026-11-10.

Other sessions are editing nearby: `host.ts` carries **unrelated uncommitted seat-cast work**, and `liveScenes.ts` / `bindings.ts` carry other uncommitted work. Run `git diff <file>` before you edit each file, edit with exact-string `Edit` calls only, and never touch a hunk you didn't make. A second worker (hist-B2-w1) is editing `castMember.ts`, `sockets/scenes.ts` and their tests at the same time; don't touch those.

## Rulings this applies (verbatim from the lane brief and plan)

- **★S4:** `note-scene@1` now (owner).
- **Scenes first:** a note never writes history and never adds messages. "A message belongs to one scene" holds (`scenes/liveScenes.ts:412`).
- The write itself is in the **scenes module** (P2: `scenes/liveScenes.ts` owns writes to `scenes`), a new exported function `appendSceneNote`.
- Target the lane's open scene when no `scene` is given.
- **Refused in words** when: the genre has `writes.scenes: false`; the scene is another session's; there's no open scene and no `scene` was given. Copy (provisional 🚧): *"‹node›: this genre keeps no scenes."* · *"‹node›: that scene belongs to another session."* · *"‹node›: no scene is open to note; open one first (propose-scene-cue@1)."*
- P2: a module owns its data and every write to it. Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently).

## What is NOT in this brief (supervisor stopped on these; don't build them)

- **Taking a note back on a retake or Back.** Scenes have no imprint subject, and the retraction paths live outside the lane. Build nothing for it: no retraction function, no imprint, no call in `state/write.ts`, `messages/store.ts`, `sessions/*`.
- **The recompile marker** on an already-compiled scene. Build nothing for it: a note on a compiled scene just appends.
- Summaries and Compile reading the notes (w1 does that), and storing `sources`.

## The contract (SDK, built; read-only)

`/home/jody/github/serene-pub-sdk/contracts/src/outlets.ts` ~800-835: `noteScene` = `core:outlet/note-scene@1`, `effects: 'write'`, `review: { fields: ['text'] }`, in-ports `text: S.text` (required), `scene: S.json` (a scene id; absent → the run's lane's open scene), `sources: S.loreSources` (optional); out `main: S.writeResult`.

The column (supervisor added it; generated migration `drizzle/0150_chief_starjammers.sql`): `schema.scenes.notes`, `jsonb`, typed `Array<{ text: string; runId: string | null; messageId: number | null; at: string }> | null`, oldest first. Read its doc comment in `src/lib/server/db/schema.ts` (search `Scene notes`).

## Goal

### 1. The writer — `src/lib/server/scenes/liveScenes.ts`

Add one exported function (use exactly this name):

```ts
export async function appendSceneNote(
	tx: Db,
	input: {
		sessionId: number
		/** A scene id; absent or null → the open scene on `channel`. */
		sceneId?: unknown
		/** The run's lane, any spelling; absent or blank → `main`. */
		channel?: string | null
		text: string
		runId: string | null
		messageId: number | null
	}
): Promise<{ sceneId: number; notes: NonNullable<SceneRow["notes"]> }>
```

- Refusals throw the existing `SceneBoundaryRefusal` (no new error class) with the sentence **without** the node prefix (the host adds it), in this order:
  1. `text` blank after trim → `"a note needs text."`
  2. `sceneWriteRefusal(tx, sessionId)` (already imported) is non-null → `"this genre keeps no scenes."`
  3. `loreWritesOffRefusal(tx, sessionId)` (already imported) is non-null → that sentence as it is (supervisor's decision: the same gate `openScene` applies through `assertSessionMayWriteScenes`; a scene is filed in the book).
  4. `sceneId` given (not `undefined`/`null`): it must be a positive safe integer (accept a numeric string too, as `Number(...)`), else `` `there is no scene ${String(sceneId)}.` ``; no row with that id → the same sentence; a row whose `sessionId` is not `input.sessionId` → `"that scene belongs to another session."`
  5. `sceneId` not given: the open scene of the session on `canonicalChannel(channel ?? "main")` (`openedAtMessageId IS NOT NULL AND closedAtMessageId IS NULL`, the definition of the `scenes_open_per_session_channel` index; reuse an existing private query in the file if one already answers this); none → `"no scene is open to note; open one first (propose-scene-cue@1)."`
  Put `// 🚧 Provisional copy: the owner has not seen these sentences.` above them.
- The write: one atomic append, never a read-modify-write: `tx.update(schema.scenes).set({ notes: sql\`coalesce(${schema.scenes.notes}, '[]'::jsonb) || ${JSON.stringify([note])}::jsonb\` }).where(eq(schema.scenes.id, id)).returning({ notes: schema.scenes.notes })`, with `note = { text: text.trim(), runId, messageId, at: new Date().toISOString() }`. A named scene that is closed, or already compiled (`historyEntryId` set), still takes the note (nothing else changes on it).
- Doc comment: what it does, that it never writes history or messages, its refusals, and a `⚠` line that a retake or Back does **not** take the note back yet (open in the hist-B2 report).
- Use only `tx`. Nothing else in the file changes.

### 2. The binding — `src/lib/server/pipelines/runtime/bindings.ts`

Next to `"core:outlet/propose-scene-cue@1"` (~8471), add `"core:outlet/note-scene@1": reads<typeof C.noteScene>(…)`. Follow how the neighbouring outlets whose host case **throws** `HostScopeError` for refusals return (e.g. `update-cast-member@1` ~8960: `ok(await ctx.commit(input))`), and make sure what lands on `main` is a valid `writeResult` (look at how `propose-scene-cue@1` shapes `{ status: "committed", ids, … }`, and at the `writeResult` shape in the SDK). Ports: `["text", "scene", "sources"]` unless `bindingCompat.test.ts` says otherwise. A short doc comment like its neighbours (🚧, ★S4, the commit is `appendSceneNote`).

### 3. The commit case — `src/lib/server/pipelines/runtime/host.ts`

Next to `case "core:outlet/propose-scene-cue":` (~9139), add `case "core:outlet/note-scene":`, modelled on `case "core:outlet/update-cast-member":` (~11443) for the session check, the turn message and the refusal wrapping:

- no `scope.sessionId` → `HostScopeError` like its neighbours ("… has no session to note a scene in — the run was started without a session scope");
- `const { turnMessageOf } = await import("$lib/server/pipelines/runtime/runTurnMessage")`; `messageId: turnMessageId ?? turnMessageOf(scope.runId) ?? null`; `runId: scope.runId != null ? String(scope.runId) : null`;
- `channel`: `scope.channel` when it is a non-blank string, else `"main"` (appendSceneNote canonicalises);
- `const out = await db.transaction(async (tx) => appendSceneNote(tx as unknown as Db, { … }))`; a `SceneBoundaryRefusal` → `throw new HostScopeError(\`${node.key}: ${err.message}\`)`; anything else rethrows;
- `record(node, "session", sessionId, "updated")` (there is no `scene` run-artifact kind; don't add one);
- return `{ written: true, sessionId, sceneId: out.sceneId }` (adjust to what the binding needs for `main`);
- a doc comment: ★S4, scenes first, the refusals, never history or messages, and that Back does not take it back yet.

Read `p` the way the neighbouring cases do (`p.text`, `p.scene`). Don't read `p.sources`.

### Tests

- **New** `src/lib/server/scenes/sceneNotes.int.test.ts` (fixture: model on `src/lib/server/scenes/liveScenes.rewind.int.test.ts` or `judgedSceneCue.int.test.ts` — a session with a book, a genre that writes scenes, story lines, `openScene`): 
  - with no `sceneId`, a note appends to the open scene on `main`; a second note appends after it (order, `runId`, `messageId`, `at` is an ISO string); no `session_messages` row and no `lorebook_entries` row is added;
  - a note on another channel's open scene (`channel: "<lane>"`) lands there, not on `main`'s;
  - a named closed scene takes the note; a named compiled scene (set `historyEntryId` on it) takes the note and its `historyEntryId` is unchanged;
  - refusals, each by its sentence: blank text; a genre with `writes: { scenes: false }` (see how `castMember.int.test.ts` registers `REFERENCE_GENRE` in `pipelineDefinitionRegistry` with a `sessionShape`); a scene of another session; no open scene and no `sceneId`; `sceneId: 999999`.
- **New** `src/lib/server/pipelines/runtime/host.noteScene.int.test.ts` (fixture: model on `host.historyWrites.int.test.ts` ~60-90, `createHost(db, { sessionId, userId, runId })` then `host.commit!(p, node)` — see how it builds the node ref for an outlet type): one commit lands on the open scene and answers the scene id; one refusal rejects with a `HostScopeError` whose message starts with the node key and `: no scene is open to note`.
- Run `src/lib/server/pipelines/boot/bindingCompat.test.ts` and `src/lib/server/pipelines/boot/registryHashes.test.ts` (the supervisor already pinned the hash) and keep them green.

## Files owned (edit only these)

- `/home/jody/github/serene-pub/src/lib/server/scenes/liveScenes.ts` — `appendSceneNote` only (plus an import it needs)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/bindings.ts` — the one binding
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/host.ts` — the one case
- `/home/jody/github/serene-pub/src/lib/server/scenes/sceneNotes.int.test.ts` (new)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/host.noteScene.int.test.ts` (new)

## Files readable

Anything. Useful: `src/lib/server/messages/writes.ts:122` (`sceneWriteRefusal`), `:214` (`loreWritesOffRefusal`), `src/lib/server/messages/channels.ts:145` (`canonicalChannel`), `src/lib/server/scenes/liveScenes.ts` `openScene` (~1211) for the session/channel conventions, `src/lib/server/pipelines/runtime/receipts.ts:43` (`RunArtifact`).

## Out of scope (write down, never build)

See "What is NOT in this brief". Also: docs, NOMENCLATURE, UI, any socket push for notes, any other `host.ts` / `bindings.ts` region.

## Stop and ask when

- You would need a name other than `appendSceneNote`, or a sentence other than the ones above.
- `bindingCompat.test.ts` refuses the binding in a way that needs a contract change.
- Anything needs a migration, a setting, or a file outside this list.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You need no `sdk:build`.)
- Migrations are generated (`db:generate`); never write one by hand. Never seed a row at a hardcoded id. Inside `db.transaction(async (tx) => …)` use only `tx`.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Don't run `tsc` or `npm run check`; the supervisor runs the typecheck once for the lane.
- Scratch files start with `hist-B2-w2-`.

## Done means

- Green: `sceneNotes.int.test.ts`, `host.noteScene.int.test.ts`, `bindingCompat.test.ts`, `registryHashes.test.ts`, plus the existing `src/lib/server/scenes/liveScenes.rewind.int.test.ts`, `judgedSceneCue.int.test.ts` and `src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts`.
- `npx prettier --check` on each file you touched; report the result (don't fix with `--write`; for the big shared files, report whether the check result changed from before your edit).

## Report

Write it to `/home/jody/github/serene-pub/plans/briefs/REPORT-hist-B2-w2.md` (if the write is refused, put it in your final message): changed files with what changed, tests run with results, every sentence you added, anything you decided, and **Noticed, not done**.
