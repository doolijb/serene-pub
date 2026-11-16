# BRIEF — `edit-history-b` worker 3 — authors at every caller, the version requests, Restore (server)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `edit-history-b`. You cannot spawn agents.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane runs no `sdk:build` at all.)

## Owner rulings you build (quoted)

- 2026-11-13: "Change history that's not a dated change on the timeline (i.e. it's purely an edit and not a timeline evolution) does not persist on copy, export, share, copied from starter, etc. We can add admin and user controls for cleaning up non persistent change history."
- 2026-11-13: "Lets also add card edit history." · "card edit history should be per version".
- 2026-11-14 "Lets go with all your recommendations": one table for all three; **Share as a lorebook** clears it; an overwrite import clears it; machine writes are recorded as the entries lane records them (a routine with its run; Apply, Revert, Take back, Restore as the person who pressed); **start-up upgrades and imports record nothing**.
- Who may see and restore: a card's owner for its versions; for cast versions, whoever may edit that member today (as `findOwnedBook` decides for entries); Restore and Clear for a cast version: the lorebook's owner (as entries: `canRestore` = owner and no `primerRowEditProblem`; `canClear` = owner). Admin › Data's existing **Edit history** row counts and clears all three kinds together (it already does: `redlineSummary` / `clearAllRedlines` are pub-wide).
- **Restore goes through the person's own save path for that subject (so its checks run), recorded as `restore`.** A key that no longer exists is refused.
- Members never see model plumbing; no run id, model or connection in any wire value. It is a session, never a chat.

## Rules for these files (quoted)

- Sockets ruling (CLAUDE.md): "one domain context per event family … is the only listener, and the only place that toasts" … "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." Every reply of the new family carries `characterVersionId`. Handlers use `refusable(...)` (`sockets/refusable.ts`) with an `echo` so the asking fold can claim its refusal.
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently. A recorded write happens on the caller's `tx` where there is one.
- `characters/versions.ts` and `lorebooks/redlines.ts` stay leaves (no static import of `$lib/server/db`). Do not edit them except as stated below.
- Migrations generated only; there is nothing to generate in this task. No new cause, setting or flag.
- Comments state the rule, not the story. No `prettier --write` on a directory (single files only, and only on lines you changed if the file was not clean before).
- Before running tests, check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one is running, wait. Run each test as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/edit-history-b-w3-<name>.log 2>&1"` from the repo root, one run at a time; never pipe vitest into `head`; an int test that opens a DB inside an `it` needs a 60 s timeout.
- Never edit `src/lib/server/pipelines/{boot,config,registrations,entities}/**`, `src/lib/server/state/declarations.ts` or `src/lib/server/state/write.ts`.

## What exists (built by worker 1 — read it)

- `lorebooks/redlines.ts`: `recordRedline` (subject `entryId` or `characterVersionId`), `VERSION_REDLINE_KEYS` (name, nickname, aliases, summary, description, personality, scenario, greetings, exampleDialogues, postHistoryInstructions, creatorNotes, likeness, timbre, faceMediaId), `versionWireValues` (a followed key reads `{ follow: true }`), `recordVersionRedline`, `moveVersionRedlines`, `RedlineScope` with `{ characterVersionId }`, and `{ lorebookId }` now covering a book's cast versions too.
- `characters/versions.ts`: `VersionRedline = { by: RedlineAuthor; cause: RedlineCause }`; `updateCardVersion(tx, id, changes, { label?, redline? })`; `writeCastVersion(tx, { …, redline? })` (records only when it writes in place); `updateCastVersion(tx, id, edit, { redline? })`. **A write given no `redline` records nothing.**
- `shared/sockets/types.ts` (supervisor): `Sockets.RedlineView` change items gain optional `beforeFollows`, `afterFollows`, `noPreview`; `namespace Sockets.CharacterVersions { Redlines, RestoreRedline, ClearRedlines }` — read it; build exactly that contract.
- `sockets/redlines.ts`: the entries handlers (`entries:redlines`, `entries:restoreRedline`, `entries:clearRedlines`, `entries:redlineCount`) and admin ones. `entries:redlineCount` / `entries:clearRedlines` with a `lorebookId` now include cast versions through the scope: nothing to change there but a test.

## Build

### 1. Pass the author at each caller (pass only; change no behaviour)

Person = `{ by: { userId }, cause: "save" }`.
- `sockets/characters.ts`: extract the body of the `characters:update` handler into `export async function saveCard(socket, params, emitToUser, cause: "save" | "restore" = "save")`; the handler keeps its try/catch (`characters:update:error` + rethrow) around `saveCard`, so a restore's refusal goes only to the restore's own `:error`. `saveCard` passes `{ redline: { by: { userId }, cause } }` to `updateCardVersion` (not to `newCardVersion`: a new version starts empty). `characters:setAvatar` (~2844): person. `insertCardFromColumns` (~716): none (a card being made). The avatar upload inside the save (~1120, `handleCharacterAvatarUpload` with `cardVersionId`): person — add an optional `redline` to `handleCharacterAvatarUpload` in `utils/index.ts` passed through to `updateCardVersion`; every other caller of it (~810, ~1391, ~2988, `utils/personaCard.ts` ~200) passes none — check each is a create/import path and say so in the report; if one is a person's edit of an existing card, pass the person and say so.
- `sockets/portrait.ts` `characters:setLikenessImage` (~231): person.
- `sockets/appletLibrary.ts` (~232): the person the applet acts for (`door.person.userId`), cause `save`.
- `sockets/import.ts` (~1033, ~1173), `characters/cardFromMember.ts` (~284), `library/writes.ts` (~274): none.
- `sockets/lorebooks.ts`: thread an optional `redline` through `writeMemberEdit` / `writeShownEdit` into their `writeCastVersion` / `updateCastVersion` calls. The member update handler (`onto: "shown"`, ~2797): person. Its "change later versions" loop (~2877 `writeCastVersion`): person. The create paths (~2484, ~2523) and the import (~4659): none.
- `sockets/amendments.ts` (pass only): `rewriteCastChange` (~1460 place-only, ~1494 with changes) and `writeToLaterVersions` (~1270) and the create of a dated cast change at a place (~1358): person (the place-only one records nothing by itself).
- `pipelines/runtime/castMember.ts` `writeCastMember` (~293, an existing call; pass only): `{ by: { run: { sessionId, messageId: input.messageId ?? null, runId: input.runId != null ? String(input.runId) : null, shownAs: routineRunOf(runId)?.shownAs?.name?.trim() || null } }, cause: "routine" }` (`routineRunOf` from `$lib/server/pipelines/routines/runs`, loaded at call time).
- None (leave untouched, list in the report): `sockets/narrativeGraph.ts` (~2801 node state, ~2842 the graph build's fill-blank summary, ~4896 a re-created member), `utils/characterBindingSync.ts` ~231, `plugins/providedBooks.ts` ~1189, `sessions/dcCairns.ts` ~299, `rulesets/ties.ts` ~790 (node state, not counted), `utils/castTags.ts` (`writeCastVersionTagText`), `sockets/adminCastLift.ts` (`followCardGreetingsAfterLift`).

### 2. The version requests (`sockets/redlines.ts`, registered in `registerRedlineHandlers`)

- `characterVersions:redlines` `{ characterVersionId }`: the version row; a card version → the card must be the asker's (`characters.user_id`), `canRestore` = `canClear` = true; a cast version → `findOwnedBook(db, asker, lorebookId)` or refused, `canRestore` = book owner and no `primerRowEditProblem`, `canClear` = book owner. Refusal for both: `Character not found or access denied.` Build the rows as `buildRedlines` does (reuse its who / session wording: factor the shared part, keep the entry reply unchanged). Labels for version keys: Name, Nickname, Aliases, Summary, Description, Personality, Scenario, Greetings, Example dialogues, Post-history instructions, Creator notes, Likeness, Voice (for `timbre`), Face — but first check the character editor's own labels (`client/components/characterForms/CharacterForm.svelte`) and use its words where it has one for the field. View values: a `{ follow: true }` side → value null and `beforeFollows` / `afterFollows` true; `faceMediaId` → values null, `noPreview: true`; `greetings` → the list of their texts; `creatorNotes` → its text; anything else as stored.
- `characterVersions:restoreRedline` `{ redlineId }`: the row (must have `character_version_id`; else `That edit is no longer kept.`); access as above with restore rights. A key not in `VERSION_REDLINE_KEYS` is refused: `‹label› is no longer part of a character profile.` (🚧, the entries lane's sentence with the subject's noun).
  - **Card version**: text keys go through `saveCard(socket, { character: { id: cardId, …the card's columns as the editor sends them, made from the version's profile with each key's *before* laid over }, cardVersionId, likeness? }, emitToUser, "restore")` — see how `characters:get` / `cardAsOfVersion` turn a version into the columns the editor speaks and send the whole card as the editor does. `faceMediaId`: put back through `updateCardVersion(tx, versionId, { faceMediaId }, { redline: { by: { userId }, cause: "restore" } })` inside a transaction, after the same check `characters:setAvatar` makes (the file is this card's own), or null when *before* was null; a file no longer there is refused: `That picture is no longer kept.` (🚧).
  - **Cast version**: in `db.transaction`, `pg_advisory_xact_lock(lorebookId)` (as the cast update handler does), then `updateCastVersion(tx, versionId, { changes }, { redline: { by: { userId }, cause: "restore" } })` where `changes` maps each key to its *before* (`{ follow: true }` stays a follow). `editCastVersion`'s own refusals stand (a retired version). Afterwards send what the cast update handler sends after a save so the Member tab and the amendments list refresh (find it; reuse it).
  - Reply `{ redlineId, characterVersionId }`, then the list again as `characterVersions:redlines` — for the version the row now belongs to.
- `characterVersions:clearRedlines` `{ characterVersionId }`: a card version → its owner; a cast version → the lorebook's owner (else `Only the lorebook's owner can clear its edit history.`). `clearRedlines(db, { characterVersionId })`; reply `{ characterVersionId, cleared }`, then the list again.
- Registration: these handlers need the new names in the event registry and the typed socket map. Add, beside every `entries:redlines` line, the matching additive lines for the three new events in `src/lib/shared/sockets/interest.ts` (the `SCOPED_EVENTS` resolver: `(payload) => payload?.characterVersionId`, and the allow-list beside `entries:redlines`), `src/lib/client/sockets/typedSocket.ts` (the three events and their `:error`s, typed from `Sockets.CharacterVersions`), and `src/lib/shared/sockets/scopedReplies.test.ts` (`["characterVersionId"]`). Additive lines only in those three files; touch nothing else in them.

### 3. Tests (new files; each int test with the db mock and dirs as `src/lib/server/sockets/entries.redlines.int.test.ts` does)

`src/lib/server/sockets/characterVersions.redlines.int.test.ts`:
- a card editor save (`saveCard` / the handler) records one row as the person; a save that changes nothing records none; **Save as new version** gives the new version no rows and leaves the old one's; `characters:setAvatar` records a `faceMediaId` row; an import (`import.ts` path or `createCharacterFromParsedData`) records none.
- a member page save (`lorebooks:updateBinding` on a member's shown base version) records one row as the person; editing a dated cast change from the amendments list records one; a routine's write through `writeCastMember` twice in one turn records `routine` on the second (coalesced) write with no run id in the view; `providedBooks` / boot-style writes record none (call `writeCastVersion` with no `redline` and show nothing is recorded, or drive the provided-books path if cheap).
- the list: owner sees it, another user is refused; the view's follows / face / greetings shapes; Restore of a card row puts the old text back through the save and records `restore`; Restore of a face row; a refused Restore (a key gone, a picture gone) answers `:error` with the sentence and the `redlineId` echo; Restore of a cast row; Clear (card owner; cast: book owner; a non-owner refused).
- never travels: card duplicate (if one exists: find the handler), card export (the file carries no edit history: it never reads the table — assert the exported object has no such key or skip with a note), member → card (`cardFromMember`) and card → member copies start empty; lorebook duplicate and the timeless copy carry no cast-version rows (extend or mirror `sockets/lorebooks.duplicate.int.test.ts`'s fixture with one cast-version row); **Share as a lorebook** clears a cast version's rows; `entries:redlineCount` / `entries:clearRedlines` with a `lorebookId` include them; an overwrite import leaves none; Admin's `admin:redlineSummary` counts entry, card and cast rows together and `admin:clearRedlines` clears all three.

Run: your new file; `src/lib/server/sockets/entries.redlines.int.test.ts`, `src/lib/server/sockets/amendments.redlines.int.test.ts`, `src/lib/server/lorebooks/redlines*.test.ts`, `src/lib/server/characters/versions.redlines.int.test.ts`, `src/lib/server/lorebooks/tableRegistry.test.ts`, `src/lib/server/sockets/lorebooks.duplicate.int.test.ts`, `src/lib/shared/sockets/` (all), and the existing tests of every file you touched in step 1 (find them with `ls`; for `sockets/characters.ts` at least the `characters*.int.test.ts` that drive `characters:update`). Then `src/lib/client/lorebooks/editHistory/editHistoryVersion.dom.test.svelte.ts` and `src/lib/client/components/characterForms/cardVersions.dom.test.svelte.ts` (the client worker's tests wait on your registry lines). `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — report every error in files you or the lane touched.

## Files owned (edit only these)

`src/lib/server/sockets/redlines.ts`, `src/lib/server/sockets/characters.ts`, `src/lib/server/sockets/portrait.ts`, `src/lib/server/sockets/appletLibrary.ts`, `src/lib/server/utils/index.ts` (`handleCharacterAvatarUpload` only), `src/lib/server/sockets/lorebooks.ts` (author threading only), `src/lib/server/sockets/amendments.ts` (author passing only), `src/lib/server/pipelines/runtime/castMember.ts` (the one call), the three registry files named above (additive lines only), and your new test file. You may fix a test of the lane that fails only because of your registration (report it).

## Out of scope

`state/write.ts`; the client components; docs; `NOMENCLATURE.md`; recording a pipeline's library write to a card (★ for the owner); a version count request (nothing asks for one); any SDK name; any new cause.

## Stop and ask (in your report, do not decide) when

Passing an author would change a caller's behaviour; the save path cannot take a restore without a behaviour change; a new sentence beyond the two 🚧 ones above seems needed; a file outside Files owned needs a change.

## Report

Your final message: changed files; every caller and what it passes (file:line); every event and sentence added; tests run with pass/fail counts and log paths; tsc errors; Noticed, not done. Under 600 words.
