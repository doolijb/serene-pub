# BRIEF — `gs-2c` worker 1 — the server: a guest has no access to the session's notes

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-2c`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This brief needs no `sdk:build`: do not run one.)

Both repos are staged by the lead: run **no git command that changes the index or the working tree** (no add, reset, checkout, restore, stash, commit). `git diff` / `git status` are fine.

## Goal

Owner ruling G2 (2026-11-16): *"A guest neither opens nor edits the notes."* The session's own notes (a `lorebooks` row with `session_id` set) are the **session owner's** lorebook. A guest of the session (a `session_guests` row) gets **no** read and **no** write of them through any lorebook, entry, cast, link, knowledge, time, graph, scene or redline event. What a guest keeps is only what **play shows** on the session page and the session-scoped reads (`sessions:castToTake`, their own seat's sheet via `lorebooks:memberOfSeat`). Pipeline runs are untouched (they write as the session owner).

## Step 0 — list every pin first (before changing any code)

Grep the tests for guests together with the notes: `grep -rln "sessionGuests" src --include=*.test.ts --include=*.test.svelte.ts` and keep the files that also build or read a session's own book (`sessionId` on a lorebook insert, `ownBookOf`, `ensureOwnBook`, "notes", `ownBook`). About 40 files. List every hit (file:line, what it pins) in your report **before** you change code, and mark which ones assert a guest reads or writes the notes. Known: `entries.earmark.int.test.ts:361`, `lorebooks.memberOfSeat.int.test.ts` 231 / 242, `lorebooks/ownBook.int.test.ts:388`, `state/worldScope.int.test.ts:516`, `cast/memberAccess.int.test.ts:95`, `media/access.cardCascade.int.test.ts:172`, `sockets/entryKnowledge.door.int.test.ts:544` (the error becomes "Lorebook not found."), `sockets/entries.redlines.int.test.ts` 255–260, 386, 462, `cast/characterRows.int.test.ts:242`. (`editSessionGuestOwnNotesReading.dom.test.svelte.ts` is lane gs-2b's: do not touch.)

## Build

1. **The one line.** `src/lib/server/lorebooks/ownBook.ts`, `isSessionMember` (~623–642): return `session.userId === userId` (drop the `sessionGuests` read). Update the doc comment of `ownBookAccessFor` (~602–608) to say the session's owner only (a guest of the session has no access: owner ruling G2, 2026-11-16). **Re-read the file right before editing**: lane `kn-6` has just landed in it. Touch only `isSessionMember` and `ownBookAccessFor`'s comment. `lorebookAccessFor` (`utils/ownedBook.ts` 107–109) already turns `false` into `null`; an attached lorebook gets `undefined` there, so its own sharing rules are untouched. Update the comments in `utils/ownedBook.ts` that say "its members" (59–60, 105–106) to the owner; no code change there.
2. **`storyBookSql`** (`src/lib/server/cast/characterRows.ts` 124–138): the own books of the sessions the asker **owns** only (drop the `UNION … sessionGuests`); fix its doc comment. Leave the `sessionId` filter's membership check (309–320) as it is: a guest may still filter by a session they are in, and the reach check (`r.a` readable / `r.s` story) then keeps the attached book by its own rules and drops the notes. Prove it with a test: a guest filtering by the session gets no notes member, and still gets a readable attached book's member.
3. **`entries:setMarks`** (`src/lib/server/sockets/entries.ts` ~1568–1590): today `found.lorebookUserId !== userId && !socket.user?.isAdmin` refuses. Select the book's `sessionId` too; when it is set (the entry is in a session's notes), allow only when `ownBookAccessFor(db, lorebookId, userId)` is true (no administrator exception, `ownBook.ts` 604–607 and G6); otherwise keep today's rule. Same refusal string, `"Entry not found or access denied."`.
4. **`entries:sessionEntries`** (same file, ~1668–1708): the `ownerOnly` answer applies only when `session.lorebookId != null`, so a session on its notes alone sends a guest every notes entry. When the session reads its own book (`session.lorebookId == null`) and `ownBookAccessFor(db, sessionBookId, userId)` is not true, answer `{ ...base, lorebookId: sessionBookId, ownerOnly: true }` (the existing shape). Attached-book behaviour unchanged.
5. **The Sessions panel's "This session only" lists** (`src/lib/server/sockets/sessions.overlay.ts`): `sessions:overlayItems` and `sessions:appliedBatches` check `checkSessionAccess(...).hasAccess` (guests included) and send the notes' items. For a caller who is not the session's owner (`!access.isOwner`), answer the same shape empty: `items: []`, `batches: []`, `mayApply: false`, `appliesItself: false`. `tellApplyMoved` pushes both lists to every session user: send the real lists to the session's owner only and the empty shape to everyone else (read `sessions.userId` once). Do not touch `ownBook.ts`'s `overlayAccessOf`, `applyOverlayItems` or `takeBackApply`.
6. **The orphan question** (`src/lib/server/sockets/sessions.shared.ts`, `runLorebookBindingCheck` ~1488): `bindingCheck:result` sends the caller the book's orphaned bindings (ids and binding names). Add to its condition: skip when `ownBookAccessFor(db, lorebookId, socket.user!.id) === false` (the book is a session's notes and the caller is not its owner). `undefined` (not notes) keeps today's behaviour. The relist at ~1475 already goes through `findOwnedBook` on the caller: confirm by test that a guest's seat change (e.g. `sessions:addPersona` or a `sessions:update` seat add) sends the guest neither `lorebooks:bindingList` nor `bindingCheck:result` for the notes, and the owner still gets them.

Fix nothing else. Any other site you find that bypasses the helpers and sends notes content to a guest: list it under Noticed with file:line, do not fix. These are confirmed **play** reads and stay as they are (do not change; pin only those listed under Tests): `state:get`, `state:ledger`, `sessions:storyClock`, `sessions:places`, `scenes:list` and its pushes, `scenes:openScenes`, `sessions:get` / `sessions:refresh` (seats read as cast members).

## Tests

One new int file `src/lib/server/sockets/sessions.notesGuestAccess.int.test.ts` (copy the fixture pattern of `sessions.guestEditSession.int.test.ts` / `sessions.castToTake.int.test.ts`: a fake socket, captured `emitToUser`), plus edits to the pinned files. Each refusal test asserts on the **serialised reply** (`JSON.stringify` of the returned value and of every captured emit) that nothing of the notes is in it: no notes entry title, no binding name, no notes book name, no notes ids beyond the ids the caller sent. Each refusal test has the **owner** twin showing the owner unchanged. An int test that opens a DB inside an `it` needs a 60 s timeout under load.

- **One read and one write per socket file** of this table, guest refused, owner unchanged: `amendments.ts` (`list` · `create`), `entries.ts` (`counts` or `types` · `create`), `lorebooks.ts` (`get` · `update`), `lorebookStoryTime.ts` (`lines` · `setClock`), `lorebookState.ts` (`get` · `set`), `narrativeGraph*.ts` (`list` · `deleteNode` or a relationship write), `redlines.ts` (`entries:redlines` · `entries:clearRedlines`), `scenes.ts` (`listByLorebook` · `create` on the notes by lorebook), `entryKnowledge.ts` (`list` · `setTie`), `bindingSuggestions.ts` (`list`), `starterKits.ts` (`saveFromBook`), plus `entries:setMarks` (guest **and** an administrator guest refused on the notes; an administrator keeps today's access on an ordinary book), `entries:sessionEntries` (notes-only session: guest gets `ownerOnly`, no rows), `sessions:overlayItems` / `sessions:appliedBatches` (guest empty, owner unchanged), item 6.
- **The Chronicle's underlying reads** (its client asks them only for the owner): a guest calling `entries:list` for the history entry type and `lorebooks:lines` on the notes gets nothing of the notes (the "Lorebook not found." refusal).
- **Play reads kept** (pin, guest allowed): `lorebooks:memberOfSeat` on the guest's own seat (sheet, `opensInBook` false); `canViewMedia` for a **seated** notes member's face (allowed) and an **unseated** notes member's picture (refused); `canReadCastMember` the same pair; `state:set` for the guest's own sheet edit; `sessions:castToTake` still lists the notes' card-less members to a guest.
- **Runs untouched (item 4):** a guest's turn still writes lore to the notes: drive the lore write path (`src/lib/server/runtime/host.loreWrites.ts` ~1048, ~1103, which pass the session owner's id) for a session whose turn's speaker is a guest's persona, and assert the entry lands in the notes; and the scene routine (`scenes.ts` ~3010) still runs on a guest's line. Reuse the nearest existing test of those paths (`grep -rln "loreWrites\|startRoutineSceneSummary" src --include=*.test.ts`); if driving either needs more than a fixture, report what blocks it instead of building a harness.
- **Re-pins:** every hit from Step 0 that asserted a guest's access to the notes: old → new, never weakened (a "guest reads X" assertion becomes "guest is refused X, nothing of the notes in the reply", and keep or add the owner's twin).

Runs, one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-2c-w1-<n>.log 2>&1"`.
Never pipe vitest into `head`. No full run, no `npm run build`, no migration. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` once at the end: 0 errors. `npx prettier --check` on each file you changed.

## Rules your work depends on (CLAUDE.md, quoted)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." (Keep `sessionId` on every overlay payload.)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "Never `git commit` or push." No new names, settings, events, error strings or migrations: reuse "Lorebook not found.", "Entry not found or access denied." and the existing `ownerOnly` shape. If a test needs a new error string, stop and report it.
- It is a **session**, never a *chat*.

## Files owned

`src/lib/server/lorebooks/ownBook.ts` (`isSessionMember`, `ownBookAccessFor`'s comment only), `src/lib/server/utils/ownedBook.ts` (comments), `src/lib/server/cast/characterRows.ts` (`storyBookSql`), `src/lib/server/sockets/entries.ts` (`entries:setMarks`, `entries:sessionEntries` only), `src/lib/server/sockets/sessions.overlay.ts`, `src/lib/server/sockets/sessions.shared.ts` (the orphan question only), the new test file, and the pinned test files from Step 0. **Not yours:** `SessionViewPanel.svelte`, `sockets/sessions.update.ts`, any client file, any doc, `NOMENCLATURE.md`, the SDK.

## Stop and report when

Closing the helper breaks the **owner** anywhere (a test of the owner fails); a play read a guest needs fails; an attached lorebook's own sharing rule changes; a fix needs a new name, string, setting or migration.

## Report

Final message (under ~600 words): Step 0's list; each change with file:line; tests run (log file, pass/fail counts); re-pins old → new; Noticed, not done.
