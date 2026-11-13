# BRIEF m2e-D2-w2 — three small server fixes: preset doc truth, one new-attach helper, starter re-send (2026-11-04)

Worker for lane **m2e-D2** (supervisor reads your report). Work from `/home/jody/github/serene-pub`, absolute paths only.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (Your SDK edit is comments only: do NOT run `sdk:build`.)

## Goal
### Item 2 — ★39 doc truth (comments only, SDK)
Owner ruling 2026-11-04 (★39): *"Enabling a plugin makes its session presets available; an admin hides one afterwards if wanted."* `src/lib/server/pipelines/boot/registrySync.ts:~981` already inserts a plugin preset with `enabled: true` and never reads `decl.enabled`.
- `/home/jody/github/serene-pub-sdk/sdk/src/announce.ts:~402–416` (the doc comment on `PresetDecl.enabled`) and `:~573` (the one-line comment on the second `enabled?: boolean`) still say a preset lands disabled until an administrator switches it on. Rewrite both comments to the truth: the instance offers a plugin's presets as soon as the plugin is enabled (an administrator may hide one afterwards, and that choice survives upgrades); this field is ignored ⏳ — kept so existing packages still compile; removing it is the owner's call. Mark it `@deprecated ⏳` in the JSDoc (the file already uses `@deprecated ⏳ Accepted; …` for `callsPerTurn` — follow that pattern). **Change no code, no type, no export** — comments only. Re-read the lines first; never `git checkout`/`restore`/`stash` in the SDK repo.

### Item 3 — one helper for "a new attach, not the book it already reads"
The exception "a NEW attach of a disabled provided book reads as absent; a session already reading it keeps reading it" lives in four places:
- `src/lib/server/sockets/sessions.ts:~223–242` (local `isNewAttachOfDisabledBook(lorebookId, sessionId?)`, used at ~255 and ~804);
- `src/lib/server/library/writes.ts:~309–311` and `~403–405` (inline `isDisabledProvidedBook(...) && !(await sessionReadsBook(db, sessionId, lorebookId))`, helper `sessionReadsBook` at ~318);
- `src/lib/server/sockets/summarize.ts:~559–565` (inline `lorebookId !== session.lorebookId && isDisabledProvidedBook(...)`).
Move ONE exported helper into `src/lib/server/plugins/providedMarks.ts`, beside `isDisabledProvidedBook`:
`export async function isNewAttachOfDisabledBook(db: Db, lorebookId: number, sessionId?: number | null): Promise<boolean>` — the body of today's sessions.ts function, reading through the `db` it is handed (it may be a `tx`): false when the book is missing or not disabled; true when disabled and there is no `sessionId`; otherwise true unless the session's `lorebookId` already is this book. Doc comment: 🚧 (M2e) + the one-sentence rule + "not a permission check".
- sessions.ts: delete the local function and its doc comment; add `isNewAttachOfDisabledBook` to the existing `$lib/server/plugins/providedMarks` import at line 3 (drop `isDisabledProvidedBook` from that import if nothing else in the file uses it — grep); call sites pass `db as unknown as Db` first (the file's existing cast style). **sessions.ts is a shared file that a story-playtest programme is editing right now (a rewind block, a cancel handler): re-read the exact lines immediately before EACH edit, use exact-string replacement only, touch only these hunks, never reformat, never `prettier --write`.**
- writes.ts: replace both inline checks with `await isNewAttachOfDisabledBook(db, lorebookId, sessionId)` (keep the same `throw new LibraryWriteRefusal("Lorebook not found.")`); delete `sessionReadsBook` if it has no other caller; fix the import.
- summarize.ts: replace the inline check with the helper (`book && await isNewAttachOfDisabledBook(<the db handle that code uses>, lorebookId, sessionId)` — use the session id that function already has; same throw). Behaviour must be unchanged everywhere. If any call site sits inside `db.transaction(async (tx) => …)`, pass `tx`.

### Item 5 — starter lorebooks re-send for any starter row
`src/lib/server/sockets/plugins.ts:~702–708` (`providedBookDisabledHandler`): after `setProvidedBookDisabled(...)` it re-sends `starterKits:list` (computed with `includeDisabled: true`) only when `params.pluginId === "core"`, else `plugins:list` (`emitList`). A PLUGIN's primer row is also a starter row (`src/lib/server/lorebooks/starterKits.ts:~384–390` gives it `provided.pluginId` = the plugin), so its switch on the Starter lorebooks page never moves. Change to: the toggled book is a starter row when `params.pluginId === "core"` OR (`lorebookId != null` and that `lorebooks` row's `kind === "starter_kit"` — one small select by id through the module `db`, as the handler uses). When it is a starter row, send `starterKits:list` with `includeDisabled: true` to the asker (the existing block); when `params.pluginId !== "core"`, ALSO keep sending `plugins:list` (`emitList`) as today. The `lorebooks:list` push to the owner stays. Update the handler's doc comment (one sentence). No new event, no new param.

## Tests (write/adjust, then run only these)
- Item 3: no new test needed unless a path lacks one; run the tests that cover the paths: `src/lib/server/plugins/providedBooks.int.test.ts`, `src/lib/server/sockets/summarize.setLorebookAnnounce.int.test.ts`, `src/lib/server/sockets/appletLibrary.int.test.ts`, `src/lib/server/sockets/appletSessions.int.test.ts`, and any `src/lib/server/library/*.test.ts` (`ls src/lib/server/library/`). Grep the tests for "disabled" to confirm the attach cases ("a session already reading it keeps it", "attach refused") are among them; report which test pins each of the three call sites, and if one has none, add one case to the nearest existing test file for that path.
- Item 5: add a case to `src/lib/server/sockets/plugins.descriptor.int.test.ts` (or the test file that already covers `plugins:disableProvidedBook` — grep `disableProvidedBook` in `src/lib/server/**/*.test.ts`): a plugin's starter row (a `lorebooks` row of `kind: "starter_kit"` with a genuine provided mark naming the plugin) toggled → the asker receives BOTH `starterKits:list` (with the disabled card present, `provided.disabled: true`) and `plugins:list`; a plugin's ordinary provided book (kind `book`) → `plugins:list` only. Follow the existing test's setup for marks (`providedPrimers.int.test.ts` / `providedBooks.int.test.ts` show how a primer row is made).
- Run: `npx vitest run <the files above> src/lib/server/sockets/plugins.int.test.ts src/lib/server/lorebooks/starterKits.int.test.ts src/lib/server/plugins/providedPrimers.int.test.ts` (whichever exist) and `npx tsc --noEmit -p .` with its output written to a file you then grep for your files (never pipe vitest into `head`). Int tests that open a DB inside an `it` need a 60 s timeout.

## Files owned (edit only these)
`src/lib/server/plugins/providedMarks.ts`, `src/lib/server/sockets/sessions.ts` (the hunks named only), `src/lib/server/library/writes.ts`, `src/lib/server/sockets/summarize.ts`, `src/lib/server/sockets/plugins.ts` (the handler only), `/home/jody/github/serene-pub-sdk/sdk/src/announce.ts` (comments only), the test files named above.
Readable: anything. Another worker (w1) edits `sockets/appletCause.ts`, `sockets/pluginActions.ts`, `plugins/pluginActions.ts`, `pipelines/runtime/{runTurn,host,pluginBindings}.ts`, `shared/sockets/types.ts` at the same time — never touch those. Never touch `src/lib/server/auth/actingPerson.ts` or any client file.

## Rules (quoted from CLAUDE.md / NOMENCLATURE — they bind you)
- *"Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report."* *"Propose and wait … on … a new name / setting / flag / abstraction / event / table / migration."* `isNewAttachOfDisabledBook` keeps its existing name (it moves module); any OTHER new name: stop and report.
- *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."*
- NOMENCLATURE R6: *"⏳ **Transitional** — real today, expires on a known event."*
- *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."*
- *"Removing or renaming a published SDK name is the owner's call."* — so `enabled` stays; comments only.
- *"Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted."*
- *"Sockets: … An event in `SCOPED_EVENTS` must carry its scope key … in the payload."* (`starterKits:list` / `plugins:list` are unchanged events; don't add new ones.)
- Never `prettier --write`; never reformat; never `kill -9`; never pipe vitest into `head`.

## Report
Write `plans/briefs/REPORT-m2e-D2-w2.md`: changed files (one line each), the helper signature as landed, which test pins each call site, tests run with pass/fail counts, Noticed-not-done, and the one-line answer to any relayed status question.
