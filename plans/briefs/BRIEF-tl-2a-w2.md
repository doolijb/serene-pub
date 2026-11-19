# BRIEF — worker `tl-2a-w2` — the run is told, typed, whether its session's lorebook keeps a timeline

App repo `/home/jody/github/serene-pub`; SDK `/home/jody/github/serene-pub-sdk` (edit the SDK there). Supervisor: lane `tl-2a`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**You do not run `npm run sdk:build` or `npm run sdk:test`**: the supervisor does, after checking for servers and other vitest runs. Never `prettier --write` (nor a scratch-copy equivalent). Never `git checkout / restore / stash` in either repo — most of the SDK is uncommitted.

## Goal

Rule R-F (owner lane brief, 2026-11-16): one typed fact on what the SDK hands a run saying whether its session's lorebook keeps a timeline, filled from `sessionTimelineOf`. The run already receives the **settings document** `SessionSettingsV1` as `$.input.session` (resolved once per run by `resolveSessionSettings` in `src/lib/server/sessions/settings.ts`, also re-read by `core:query/session-settings@1`, and handed to scripts as the read-only extra `session`). The fact goes on that document as `timeline: boolean` (🚧 provisional; the name is the supervisor's proposal to the owner, so keep it exactly `timeline`).

## Files owned (only these)

1. SDK `sdk/src/sessionSettings.ts` — add to `interface SessionSettingsV1`, right after `lorebookId: number | null`, a **required** `timeline: boolean` with this JSDoc (verbatim):

   ```ts
   	/**
   	 * 🚧 Whether the lorebook that governs this session keeps a **timeline**
   	 * (its Timeline switch): the attached lorebook's, else the session's own
   	 * notes'. Resolved once per run, like the rest of the document.
   	 *
   	 * It holds for the session's life (a session keeps the lorebook it
   	 * started with) except when that lorebook's owner flips the switch; the
   	 * next run reads the new value.
   	 *
   	 * `false`: the session's story time does not move and a pipeline writes
   	 * nothing dated to the lorebook (each outlet refuses or writes undated, as
   	 * its contract says).
   	 * `true`: the lorebook keeps time — but the story's present (and so
   	 * `core:var/current-date@1`) may still be absent: a lorebook line with no
   	 * story clock and no dated history entry has none, and a session on it
   	 * writes its optionally dated rows undated.
   	 */
   	timeline: boolean
   ```

2. SDK `sdk-tests/turnOrder.test.ts` — only the `const doc: SessionSettingsV1 = { … }` literal near line 422: add `timeline: true,` after `lorebookId: null,` so it still satisfies the type. Nothing else in that file.

3. App `src/lib/server/sessions/settings.ts` — in `resolveSessionSettings`'s returned object, right after `lorebookId: session.lorebookId ?? null,`, add `timeline: await sessionTimelineOf(db, sessionId),` with a one-line comment (`// 🚧 R-F: the governing lorebook's Timeline switch (lorebooks/timeline.ts, the one reader).`). Import `sessionTimelineOf` statically from `$lib/server/lorebooks/timeline` (a leaf module: schema, drizzle and shared helpers only, so no import cycle). Nothing else in this file; in particular `widgetSessionProjection` stays as it is (the fact is not a widget's). Re-read the file right before editing: another lane may have touched nearby code.

4. NEW app test `src/lib/server/sessions/sessionSettings.timeline.int.test.ts` — header comment saying what is pinned. Cases:
   - a session on an attached lorebook whose `timelineEnabled` is true → `doc.timeline === true`;
   - the same session after the lorebook's `timeline_enabled` is set false (a direct `db.update(schema.lorebooks)` in the test is fine) → `false` on the next `resolveSessionSettings`;
   - a session with no attached lorebook whose own notes have `timelineEnabled: false` → `false`; with true → `true`.
   - `widgetSessionProjection(doc)` has no `timeline` key.
   Use the setup pattern of `src/lib/server/sessions/sessionSettings.int.test.ts` (`createTestDb`, `createTestUser`, `bootstrapPipelines`) and look at `src/lib/server/sockets/storyClock.timeline.int.test.ts` or `src/lib/server/state/timelineQueries.int.test.ts` for how they make a session, a lorebook with `timelineEnabled`, and a session's own notes (`insertOwnBook` / `ownBookFor` in `lorebooks/ownBook.ts`). Inside `db.transaction(async (tx) => …)` use only `tx`. An `it` that opens a database needs a 60 s timeout under load; put DB creation in `beforeAll` with a 60 s timeout.

## Rules quoted for you

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- CLAUDE.md: "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- `lorebooks/timeline.ts` header: "Every reader asks here (`timelineOf`, `timelineOfBook`, `sessionTimelineOf`, `sessionTimelineSql`); no other module reads the column." — so never read `timeline_enabled` yourself in `settings.ts`.
- NOMENCLATURE R3/R6: the field is marked 🚧 provisional (already in the JSDoc above). Introduce no other name.

## Out of scope

Any other file (the supervisor writes the docs, INTEGRATING.md, NOMENCLATURE and the variable JSDoc). Any change to what a write stores or how it is dated. `GenreDecl.timeline` and preset `defaults.timeline` are untouched. Exposing the fact anywhere else (widgets, client, sockets).

## Stop and ask when

`tsc` shows a constructor of `SessionSettingsV1` other than the two above that now fails (report its file:line; do not edit it); anything needs a new name.

## Done means

From the app root, after waiting until no other vitest is up (`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`):

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/sessionSettings.timeline.int.test.ts src/lib/server/sessions/sessionSettings.int.test.ts > plans/tl-2a-w2.log 2>&1"`

Note: the app resolves `@serene-pub/sdk` from its built `dist`, so the new field's **type** only reaches the app after the supervisor's `sdk:build`; the runtime value does not depend on it, so the tests run now. Never pipe vitest into `head`. Then `npx prettier --check` on each file you touched (app files from the app root; SDK files from `/home/jody/github/serene-pub-sdk`, `npx prettier --check sdk/src/sessionSettings.ts sdk-tests/turnOrder.test.ts`). Do not run `tsc` (the supervisor runs it after the SDK build).

## Report (your final message)

Each file changed (one line each); test result lines (file, passed/failed counts); prettier results; anything noticed but not done.
