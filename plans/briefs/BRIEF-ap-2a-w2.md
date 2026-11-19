# BRIEF — worker `ap-2a-w2`: tests for the write rule (int tests)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `ap-2a`. SDK: read-only, never edit or build it.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

The repo is staged by the lead: run **no git command** that changes the index or the working tree. Never `prettier --write`, never pipe prettier's output into a file. **You edit test files only** — if a test shows the code is wrong, stop and report it; never change source.

## The rule under test (owner ruling AP1, 2026-11-17; already built by worker w1)

"The plugins and core catalogues starter lorebooks are not owned by users, but by the source. Admins have limited management and can't mutate or delete them, only disable them or remove the plugin. To mutate, the admin/user clones it first."

- **Every live provided lorebook is read-only to every person, the enabling administrator included** (the administrator is the row's stored `userId`). "Live provided" = the row carries its OWN genuine provided mark (`extra_json.provided` with `plugin`, `slug`, `version` strings and `uuid` equal to the row's uuid) **AND** its owner is present (`"core"` always; a plugin while its `plugins` row exists). Any `kind` (`book` or `starter_kit`), disabled or not.
- A lorebook **kept at uninstall** (mark kept, plugin row gone) is **not** provided: the administrator's ordinary lorebook, writable and deletable.
- **The one sentence** (`primerRowEditRefusal(pluginName)` in `src/lib/shared/lorebooks/primerRow.ts`, re-exported by `plugins/providedMarks.ts`): `This lorebook comes with ${pluginName ?? "the pub"}: make your own copy to change it.` — `pluginName` is the `plugins.name` (else the id); core's is `null` → "the pub". Every lorebook-screen door (entries, cast, scenes, knowledge ties, `lorebooks:update`, import-overwrite…) refuses with it via `primerRowEditProblem`. Apply and Take back refuse a live provided lorebook with it too (`OwnBookRefusal`), for anyone; for an ordinary lorebook they keep `APPLY_OVERLAY_REFUSALS.notOwner`. Delete of a live provided lorebook keeps its own refusal `PROVIDED_BOOK_DELETE_REFUSAL`.
- `canWriteLorebook(userId, { userId, provided })` (`utils/ownedBook.ts`, pure; `provided` required): `userId != null && !provided && book.userId === userId`.
- `loreWriteRoute({ attachedId, bookOwnerId, bookProvided, sessionOwnerId, mode })` → `own-book` for a live provided lorebook; the readers `loreWriteTargetFor`, `loreWriteBookIdOf`, `keepsValuesInOwnBook`, `applyHeldAutomatically` (silent: returns null), `overlayAccessOf` (`mayApply`/`appliesItself` false) and the delete safeguard in `state/durable.ts` (`recordToTimeline` with `reason: "delete"`: records nothing) all get the fact from `liveProvidedBookSql()` (`plugins/providedMarks.ts`), an SQL twin of `markedBook(...) && providedOwnerPresent(...)`.
- **Not changed, must still work:** `setProvidedBookDisabled` (enable/disable), `deleteProvidedBooks` (removal), `syncProvidedBooks` (sync), `lorebooks:duplicate` (the existing copy: a copy has a fresh uuid, so it is the person's own and writable).

Rules: "Inside `db.transaction(async (tx) => …)` use only `tx`." "Comments state the rule, never the history." An int test that opens a DB inside an `it` needs a 60 s timeout. Test names state the rule (no "AP1 (open)", no "flips if…").

## Files owned (edit only these)

1. `src/lib/server/lorebooks/applyWritePredicate.int.test.ts`
   - Predicate table: every `canWriteLorebook` call passes `{ userId, provided }`. Add provided × (the enabling administrator = the stored owner / another administrator / a member) → all false; the owner of an ordinary book → true.
   - The two member tests (~221, ~256): Apply's refusal is now the sentence (`primerRowEditRefusal(<plugin name>)`; the fixture's plugin `name` equals its id), not `notOwner`. Everything else they assert stays.
   - **Flip the AP1 pin** (~306): rename to state the rule, e.g. "the enabling administrator's own session never applies into a provided lorebook". Assert: `sessions:overlayItems` → `mayApply: false, appliesItself: false`; `sessions:applyOverlay` rejects with the sentence; `applyHeldAutomatically` → null; the provided rows byte-identical (`rowsOf`); **Merge** (`foldInParent`) still works for that administrator.
   - **Take back** refused: make a batch while the book is NOT live (insert the marked book before its `plugins` row exists, or delete the plugin row first — a not-live marked book is writable), Apply, then make it live (insert the `plugins` row) and call `sessions:takeBackApply` → `{ refused: <the sentence> }` and nothing changed (`rowsOf` book + notes + `imprintsOf`).
   - **Write routing** for the administrator's session on a live provided lorebook, the administrator's write mode Full: `loreWriteTargetFor(db, sessionId, { fork: false })` → `route: "own-book"`; `keepsValuesInOwnBook` → true; `loreWriteBookIdOf` → the notes' id. The **delete safeguard**: call `recordToTimeline` (`state/durable.ts`) with `reason: "delete"` the way `src/lib/server/state/durable.int.test.ts` does → nothing written to the provided lorebook (its rows/attribute values unchanged; `report.route` not `"book"`). Read that test file to learn the call shape.
   - **Kept at uninstall**: the same kind of book with its plugin row deleted → the administrator's session's Apply succeeds into it, and `loreWriteTargetFor` → `route: "book"`.
   - **SQL twin agrees with the JS decider**: insert rows in each state and compare `db.select({ id, live: liveProvidedBookSql() })` with `markedBook(extraJson, uuid) && providedOwnerPresent(db, mark.plugin)`: core mark; plugin mark, plugin present; plugin mark, plugin row absent; mark whose uuid is another row's; mark missing `version`; `provided` not an object; no `extra_json`; disabled mark (live = true).
2. `src/lib/server/plugins/primerRowReadOnly.int.test.ts`
   - Sentence assertions → the new wording (~374, ~388).
   - "an admin kit with no mark and a plain provided book stay editable" (~421): split. The admin kit (no mark) stays editable. The plain provided book (core, kind `book`) now refuses **every** door in `doors()` with the core sentence and nothing changes (`stateOf` before = after), like the core primer test at ~342.
   - Add a **plugin's provided lorebook of kind `book`** (a second plugin row, e.g. id `acme/world-book`, name `Acme Worlds`, inserted like `PLUGIN_ID` in `beforeAll`; `insertBook({ name, kind: "book" }, thatPluginId)`), asked by the administrator (`socket(adminId, true)`): every `doors()` door refuses with `primerRowEditRefusal("Acme Worlds")` and nothing changes. Add doors for it that `doors()` lacks: a **knowledge tie** (a write handler in `src/lib/server/sockets/entryKnowledge.ts` — its `refusePrimer` guard), **import-overwrite** (`lorebooks:import` with `action: "overwrite"`, `existingId` — `sockets/lorebooks.ts` ~6030; find how a held import is staged in an existing test, e.g. `grep -rln "overwrite" src/lib/server/sockets/*.int.test.ts`), a **cast edit** (`lorebooks:updateBinding` or the existing binding-update handler — find its name), and **delete** (`lorebooksDeleteHandler` → `PROVIDED_BOOK_DELETE_REFUSAL`). If a door's setup is disproportionate, say so in the report instead of faking it.
   - Still works on that plugin lorebook: `lorebooksDuplicateHandler` by the administrator → a copy whose `primerRowEditProblem` is null and which `lorebooks:update` accepts; `setProvidedBookDisabled(db, pluginId, slug, true/false, adminId)` toggles the mark (the slug is `${plugin}:slug` per `insertBook`); `deleteProvidedBooks(db, pluginId)` removes a provided lorebook no session plays on. Then **kept at uninstall**: a marked kind-`book` lorebook whose plugin row is deleted → `primerRowEditProblem` null, `lorebooks:update` accepted, `lorebooks:delete` accepted.
   - The wire field test (~442): rename to state the rule; `readOnly` is `{ pluginName: null }` on the plain core provided book and `{ pluginName: "Acme Worlds" }` on the plugin kind-`book` lorebook, in both `buildLorebooksList(adminId)` and `lorebooksGetHandler` for the administrator; still absent on the admin kit.
   - Mind test order: the existing test at ~380 deletes `PLUGIN_ID`'s row; use your own plugin id so the two never interfere.
3. `src/lib/server/plugins/providedBooks.int.test.ts` — "a person's update cannot mint or move the mark" (~587): the administrator's `lorebooks:update` on the live provided lorebook is now **refused with the sentence**; name and mark unchanged. Keep the "cannot mint or move the mark" half by deleting the plugin row (kept at uninstall), then the update succeeds, the name changes, and the stored mark is unchanged (the sent `extraJson` ignored). Rename to state both.
4. `src/lib/server/lorebooks/castOwnNames.int.test.ts` — the three failing tests in "a provided book keeps its cast's names and faces": on a live provided lorebook the general sentence now comes first (`primerRowEditProblem` runs before the cast-name check at `sockets/lorebooks.ts` ~2644). Re-pin: a change is refused with the general sentence; "a save that sends the stored values" is now **refused too** (every edit of a live provided lorebook is), with nothing changed; the core-marked book refuses with the core sentence. Keep every assertion about clones / uninstalled books accepting. Rename tests so the names state the rule.
5. `src/lib/server/sockets/lorebooks.providedCast.int.test.ts` — the two failing tests ("uploadMemberFace on a provided book", "a dated face change on a provided book"): same re-pin — a live provided lorebook refuses with the general sentence and writes nothing; the clone and the uninstalled plugin's book still accept; "a dated summary is not refused" on a live provided lorebook is now refused (say so in the test name), keep it accepted where it is the clone's.

Read each failing test before changing it; keep its intent wherever the rule still allows. The current failures are in `plans/ap-2a-2.log` (grep `FAIL` and the `AssertionError` lines).

## Out of scope

Any source file. Any other test file. Docs, NOMENCLATURE. Live lanes' files: `scenes/liveScenes.ts`, `utils/sceneCast*.ts`, `sockets/scenes.ts`, `utils/activityStore.ts`, `messages/debugMeta.ts`, `sockets/sessions.messages.ts`, `pipelines/runtime/liveRow.ts`, `utils/runReply.ts`, `utils/generationStatus.ts`.

## Stop and ask (report, then stop) when

A test shows the code disagrees with the rule above; a door can't be reached without a source change; something would need a new name outside a test.

## Done means

One run at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <your five files> > plans/ap-2a-w2-<n>.log 2>&1"` — all green. Never pipe vitest into `head`. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/ap-2a-w2-tsc.log 2>&1` — 0 errors in your files. `npx prettier --check` on each file you changed (report; these files may already fail it).

## Report (final message, under 400 words)

Per file: tests changed (old name → new name) and added; each door covered and how; anything faked or skipped and why; run and tsc results with log paths; **Noticed, not done**.
