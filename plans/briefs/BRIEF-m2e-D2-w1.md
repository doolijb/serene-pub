# BRIEF m2e-D2-w1 — the frame-origin cause: only while the applet is open (2026-11-04)

Worker for lane **m2e-D2** (supervisor reads your report). Work from `/home/jody/github/serene-pub`, absolute paths only.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Background (read, do not re-derive)
`frameCause` (`src/lib/server/sockets/appletCause.ts`, type `FrameCause { pluginId }`, `frameCauseFor`, `frameOpenFor`) is what opens a plugin's user annex (`ctx.annex('user')`) and per-user storage (`ctx.storage.user`) inside a sandbox call: `SandboxManager.callHook(…, { user, frameCause })` grants them only when `frameCause.pluginId === <the called plugin>`. The owner's ruling (2026-11-04): *"Applet code/pipelines can only run when the applet is open"* — C5 by cause: reach is granted only to a call a mounted applet frame's own request **or a person's press in it** caused; event/lifecycle hooks, the schedule tick and pipeline nodes on routine/cadence/schedule runs get none.

Two defects today:
- **Too wide.** `src/lib/server/plugins/pluginActions.ts:97` sets `frameCause: frameCauseFor(pluginId)` on EVERY `pluginActions:invoke`. That event also carries a plugin WIDGET's `ctx.invoke` on an ordinary session page, the session page's file pick/save, and the plugin page. None of those is the applet being open.
- **Too narrow.** `TurnRequest.frameCause` / `SpecRunRequest.frameCause` (`src/lib/server/pipelines/runtime/runTurn.ts:128–136, 276–277, 852, 932, 1780`) have no producer, so a press in an applet genre's session-view frame starts a run with no cause.

What the server knows: the client today sends `pluginActions:invoke { pluginId, action, input?, requestId? }` only (no mount). Client files are another lane's and you must not edit them; the supervisor queues the client half. The launcher `/apps/<pluginId>` mounts the plugin's `session-view` surface with **no session** (`src/routes/apps/[pluginId]/+page.server.ts`, `appletMount` in `src/lib/server/plugins/appletMount.ts`); a session whose genre has `shape.applet === true && shape.view === <pluginId>` draws that same frame on its session page.

## Goal
### 1a — the invoke door sets the cause only for the plugin's applet mount
1. Wire (`src/lib/shared/sockets/types.ts`, `Sockets.PluginActions.Invoke.Params`): add
   `fromApplet?: { pluginId: string; sessionId?: number }` with a doc comment: 🚧 (M2e) sent by an applet mount (the launcher, no `sessionId`; an applet genre's session view, its `sessionId`); the server never takes it as the cause — it names which mount to check and the server checks that mount against its own data; absent (a widget, a plugin page, file pick/save): no cause. This reuses the `fromApplet` word with the meaning it has on `sessions:create` / `sessions:delete` (R1: one word, one meaning).
2. Socket (`src/lib/server/sockets/pluginActions.ts`): read `p.fromApplet`; pass it to `invokePluginAction` only when it is a plain object with a string `pluginId` and `sessionId` absent or a positive integer; otherwise pass nothing (no cause; do not refuse the invoke). Update the file's header comment in one line.
3. `src/lib/server/sockets/appletCause.ts`: add
   - `appletOfSession(db: Db, sessionId: number): Promise<string | null>` — the plugin id whose session-view frame draws this session: read the session's `genreId`, then `getSessionGenre(db, genreId)` (`$lib/server/pipelines/entities/sessionGenres`, **dynamic `await import(...)` inside the function** — appletCause.ts is imported by `SandboxManager.ts`, avoid an import cycle); return `shape.view` when `shape.applet === true && typeof shape.view === "string"`, else null (also null for no such session).
   - Update the `FrameCause` doc comment: who builds it now (the invoke door for the applet's own mounts, judged from server data; a run a person's press started on a session that applet draws); remove "today the `pluginActions:invoke` handler" wording.
4. `src/lib/server/plugins/pluginActions.ts`: `invokePluginAction` opts gain `fromApplet?: { pluginId: string; sessionId?: number }`. Compute the cause with an exported helper in the same file, `frameCauseOfInvoke(db, { pluginId, userId, plugin: row, fromApplet }): Promise<FrameCause | undefined>`:
   - no `fromApplet`, or `fromApplet.pluginId !== pluginId` → `undefined`;
   - `sessionId` present → `checkSessionAccess(sessionId, userId, db)` (`$lib/server/utils/sessionAccess`) `.hasAccess` AND `(await appletOfSession(db, sessionId)) === pluginId` → `frameCauseFor(pluginId)`, else `undefined`;
   - no `sessionId` (the launcher) → `appletMount(pluginId, row, await listOfferedGenres(db))` (`$lib/server/plugins/appletMount`, `$lib/server/pipelines/entities/sessionGenres`; same call as the launcher route) is non-null → `frameCauseFor(pluginId)`, else `undefined`.
   Pass the result as `frameCause` to `manager.callHook` (omit the key, or pass undefined, when none). Replace the comment at line ~94 with one that says the cause is set only for the plugin's applet mount, judged from server data.
   - Use the `db` parameter for every read (never the module `db`).

### 1b — a press in an applet session carries the cause on the run
5. `src/lib/server/pipelines/runtime/runTurn.ts`: the request-level `frameCause` fields have no producer; **remove** `frameCause` from `TurnRequest` (128–136) and `SpecRunRequest` (276–277) and the pass-through at ~1780. Instead derive it once inside `runSpecOnce` (line ~669), before the `scope` (~843) and the `pluginNodeBindings` call (~932), with an exported helper in runTurn.ts:
   `frameCauseOfRun(request: Pick<SpecRunRequest, "db" | "sessionId" | "registration" | "triggerFamily" | "preview">): Promise<FrameCause | undefined>` — `undefined` when `request.preview` is true or `triggerFamilyOf(request) !== "action"` (a person's press is the `action` family; `routine` and `event` get none); otherwise `appletOfSession(request.db, request.sessionId)` → `frameCauseFor(id)` when non-null, else `undefined`. Use the result for `scope.frameCause` and the `pluginNodeBindings(... { frameCause })` option. Keep `HostScope.frameCause` (`host.ts:223–227`) and `PluginBindingOptions.frameCause` (`pluginBindings.ts:191–192`) — update their doc comments in one line each to say where the value now comes from (`frameCauseOfRun`). **host.ts is a shared file: additive/comment hunks only, re-read the lines right before editing, never reformat.**
   - If anything else in `src/lib/server` sets `frameCause:` on a `runTurn` / `runSpec` request (grep first), tell the supervisor in your report instead of guessing.

### Item 4 — the refusal sentence
6. `appletCause.ts:55`: `appletClosedRefusal("This person's saved documents")` → `appletClosedRefusal("This person's saved data")` (matches the SDK guide `guides/plugin-permissions.md`: "The person's saved data"). Update the doc comment on `appletClosedRefusal`/`USER_ANNEX_CLOSED` if it quotes the thing. Update the pinned tests: `src/lib/server/plugins/hookCtx.test.ts:82` and `src/lib/server/plugins/userAnnexHook.int.test.ts:237`. Do not touch NOMENCLATURE (another lane) or the SDK.

## Tests (write/adjust, then run only these)
- `src/lib/server/plugins/pluginActions.int.test.ts`: the existing `expect(opts.frameCause).toEqual({ pluginId: ID })` (line ~90) becomes: no `fromApplet` → `frameCause` undefined. Add one `describe("the frame-origin cause at the invoke door")` covering: (a) a widget's invoke on an ordinary session (`fromApplet: { pluginId: ID, sessionId: <ordinary session> }`) → undefined; (b) the launcher's door (`fromApplet: { pluginId: ID }`, the plugin's manifest has a `surfaces: { "session-view": { entry: "ui/session.html" } }` and an offered applet genre with `shape: { applet: true, view: ID }`) → `{ pluginId: ID }`; (c) the session view of the person's own applet session → `{ pluginId: ID }`; (d) the same applet session but another user who has no access → undefined; (e) `fromApplet.pluginId` naming another plugin → undefined; (f) launcher of a plugin with no applet genre → undefined. Mock `$lib/server/pipelines/entities/sessionGenres` with `importOriginal` (pattern: `src/lib/server/sockets/appletSessions.int.test.ts:31–40`) so `listOfferedGenres` / `getSessionGenre` return the applet genre; pass `db` explicitly (`defaultDb()` bypasses `vi.mock`). If changing the manifest constant breaks other cases, use a second plugin row for the applet cases.
- A press test (new `src/lib/server/pipelines/runtime/frameCauseOfRun.int.test.ts`, or inside `pluginBindings.int.test.ts` if its setup fits): a session in an applet genre (`shape.applet: true, view: "acme.tools"`): `frameCauseOfRun({ db, sessionId, triggerFamily: "action" })` → `{ pluginId: "acme.tools" }`; with `registration: { family: "routine", key: "k" }` → undefined; `triggerFamily: "event"` → undefined; `preview: true` → undefined; an ordinary session with `action` → undefined. Then the existing `pluginBindings.int.test.ts` case already proves the cause rides each hook call.
- Run: `npx vitest run src/lib/server/plugins/pluginActions.int.test.ts src/lib/server/plugins/pluginActions.storage.int.test.ts src/lib/server/plugins/hookCtx.test.ts src/lib/server/plugins/userAnnexHook.int.test.ts src/lib/server/plugins/userStorage.int.test.ts src/lib/server/pipelines/runtime/pluginBindings.int.test.ts <your new test>` and `npx tsc --noEmit -p .` filtered to the files you touched (`| grep -E "pluginActions|appletCause|runTurn|host.ts|pluginBindings|types.ts"` — grep the output file, never pipe vitest into `head`). Int tests that open a DB inside an `it` need a 60 s timeout (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })`).

## Files owned (edit only these)
`src/lib/shared/sockets/types.ts` (the `PluginActions.Invoke.Params` hunk only), `src/lib/server/sockets/pluginActions.ts`, `src/lib/server/sockets/appletCause.ts`, `src/lib/server/plugins/pluginActions.ts`, `src/lib/server/pipelines/runtime/runTurn.ts`, `src/lib/server/pipelines/runtime/host.ts` (doc comment on `HostScope.frameCause` only), `src/lib/server/pipelines/runtime/pluginBindings.ts` (doc comment only), the tests named above.
Readable: anything. Another worker (w2) edits `sockets/sessions.ts`, `sockets/summarize.ts`, `library/writes.ts`, `plugins/providedMarks.ts`, `sockets/plugins.ts` at the same time — never touch those.

## Rules (quoted from CLAUDE.md / NOMENCLATURE — they bind you)
- *"Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report."* *"Propose and wait … on anything a user sees or that outlives the change: … a new name / setting / flag / abstraction / event / table / migration … files outside the asked area."* The names in this brief (`fromApplet` on the invoke params, `appletOfSession`, `frameCauseOfInvoke`, `frameCauseOfRun`) are approved; any OTHER new name: stop and report.
- *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."*
- NOMENCLATURE R1 *"One word, one meaning."* R3 *"Qualify, never abbreviate to the bare noun."* §24: grep a name before using it; say what it is not when a neighbour exists (doc comments: `frameCauseOfRun` is not `ActingVia`/`via`).
- *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."*
- *"Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."*
- Browser code: none in your files.
- No migration, no setting, no change to the hook grant table (`HookCtxGrants`, SDK `hookGrants.ts`).
- Shared files (`runtime/host.ts`): re-read the exact lines immediately before each edit; edit with exact-string replacement; never run `prettier --write` on any file; never reformat.
- Never pipe vitest into `head`. Never `kill -9` anything.

## Report
Write `plans/briefs/REPORT-m2e-D2-w1.md`: changed files (with one line each), the helper signatures as landed, tests run with pass/fail counts, any `frameCause:` producer you found that the brief did not name, Noticed-not-done, and the one-line answer to any relayed status question.
