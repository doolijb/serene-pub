# BRIEF — `edit-history-a` worker 2 — the socket side: the form save and dated-change edit record, list / restore / clear, admin count and clear

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Supervisor: lane `edit-history-a`. Repo: `/home/jody/github/serene-pub` (always absolute paths). Report: return it as
your final message (changed files, tests run with results, every new `:error` event, anything you could not do,
Noticed-not-done).

## Goal

The app now keeps an **Edit history** for lorebook entries: table `lore_redlines` (schema.ts + migration
`drizzle/0161_flowery_bishop.sql`, done; never touch either) and the record module
`src/lib/server/lorebooks/redlines.ts` (written by the supervisor: **read it whole first**; it is the contract:
`recordRedline`, `recordEntryRedline`, `redlineKeysOf`, `entryWireValues`, `clearRedlines`, `countRedlines`,
`redlineSummary`, `clearAllRedlines`, `REDLINE_CAUSES`, `RedlineAuthor`). Worker 1 is wiring the domain modules
(`host.ts`, `ownBook.ts`, `imprints.ts`, `ties.ts`, `tableRegistry.ts`) at the same time: never edit those; it
gives `settleKeptImprint` an optional 4th parameter `by?: { userId: number }` (if it is not there yet when you
reach that step, do everything else first and come back).

Your part: the two socket-side writers (the form save, a dated change's fields), Revert's caller, the requests to
list / restore / clear, the admin count and clear, their wire types, and socket tests.

Rules that bind (owner and the lane's cold review, quoted):

- "every save that changes an entry's name, text or typed fields keeps the previous values, with when and who (a
  person, or *‹routine› in ‹session›*); a list with **Restore**, and a restore is itself recorded; it belongs to
  the lorebook, not to a session … clearing is the lorebook owner's alone."
- "The common form save runs with no transaction (`applyEntryUpdate` on `db` when there is no re-parent and no
  re-date): wrap that branch in one."
- "**A session is named only to a viewer who may open it** (`checkSessionAccess`, as `earmarkNotice` does,
  `sockets/entries.ts` ~421); otherwise the row reads 🚧 *‹routine› in a session*; a deleted session reads 🚧
  *‹routine› in a session that was deleted*." Members never see model plumbing: never a run id, model or connection
  on the wire to the client (do not send `runId`).
- "**Restore is two paths, written for the purpose.** Entry: only the lorebook's owner saves through
  `entries:update` today; Restore follows whoever may edit the entry there, and **refuses in words** when a key it
  would restore is no longer declared by the entry type (🚧 *‹label› is no longer part of this kind of entry.*)
  instead of silently dropping it (`splitUpdate` drops such keys). Dated change: `amendments:update` replaces
  `fields` whole, so Restore sends the stored fields with the row's keys put back, and a key that was absent before
  is removed." Restore goes "through the same save path a person's save takes (so the earmark refusal, the
  declared-field checks and the per-turn record's 'kept' marking all apply), and is recorded as an edit with cause
  restore. Refused in words when the version it names is gone."
- "No row for: `entries:setMarks` … `copyFromLibrary`, `iterateNext`." Create (`entries:create`,
  `amendments:create`) is not an edit; `amendments:update` of `fields` is. A re-date of a dated change is not an
  edit of its fields.
- Sockets (CLAUDE.md Standing rulings, quoted): "one domain context per event family (provided by both shells) is
  the only listener, and the only place that toasts; views register listeners for local state and never call
  `toaster`. An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or
  `emitToUser` silently sends nothing." No pushed event (replies only).
- CLAUDE.md Hard rules: inside `db.transaction(async (tx) => …)` use only `tx`. `socket.off(event)` always with
  its handler. Comments state the rule, not the story. Never reformat a file.

## Files owned (edit only these)

- `src/lib/server/sockets/entries.ts` (2.5k lines: read by range, search by name) — `applyEntryUpdate`,
  `updateEntryHandler` (refactor its body into an exported function both it and Restore call),
  `settleImprintHandler` (one argument), `registerEntryHandlers` (register lines).
- `src/lib/server/sockets/amendments.ts` — `amendmentsUpdateHandler`'s entry branch (record; refactor so Restore
  can call it with cause `restore`).
- New `src/lib/server/sockets/redlines.ts` — the new handlers; registered from `registerEntryHandlers` and from
  `sockets/index.ts` for the admin pair (one import + one register call each, nothing else in `index.ts`).
- `src/lib/shared/sockets/types.ts`, `src/lib/client/sockets/typedSocket.ts`, `src/lib/shared/sockets/interest.ts`,
  `src/lib/shared/sockets/scopedReplies.test.ts` — additive entries only.
- New test files (suggested `src/lib/server/sockets/entries.redlines.int.test.ts`,
  `src/lib/server/sockets/amendments.redlines.int.test.ts`).

Never touch: `host.ts`, `ownBook.ts`, `imprints.ts`, `ties.ts`, `tableRegistry.ts`, `redlines.ts` (if you find a
bug in it, report it), `db/schema.ts`, `sessions/*`, `state/*`, `Layout.svelte` (if a new `:error` event must join
the shell's handled errors, list it), any client component, any SDK file.

## What to build

1. **Form save** (`applyEntryUpdate`): add a parameter `edit: { cause: "save" | "restore"; userId: number }`.
   Inside, on `dbOrTx`: read the stored row before the update, update, then `recordEntryRedline(dbOrTx, { before,
   after: updated[0], named: [...Object.keys(columns), ...Object.keys(fields).map((k) => "fields." + k)], cause:
   edit.cause, by: { userId: edit.userId } })` (`title` and `fields.x` are mapped to wire keys by the module;
   pass typed fields as `fields.<key>` so a typed field never collides with a column name). Wrap the common
   (unlocked) branch of `updateEntryHandler` in `db.transaction` so the record lands on the write's transaction.
   A save that changes nothing records nothing (the module already says so). Grep for any other caller of
   `applyEntryUpdate`.
2. **Dated change edit** (`amendments:update`, entry subject, when `params.fields` is given): inside the existing
   transaction, read the amendment's stored `fields` with `tx` before the update; after it, `recordRedline(tx, {
   entryId, amendmentId: params.id, before: storedFields, after: patch.fields, keys: union of both objects' keys,
   cause, by: { userId } })`, cause `save` (or `restore` when Restore called it). The cast branch
   (`params.subject !== "entry"`) is out of scope: no row.
3. **Revert** (`settleImprintHandler`): pass `{ userId: socket.user!.id }` as `settleKeptImprint`'s 4th argument.
4. **New requests** (`sockets/redlines.ts`, all `refusable(...)` like the neighbours, scoped on `lorebookId`):
   - `entries:redlines` `{ entryId }` → `{ entryId, lorebookId, canRestore, canClear, redlines: RedlineView[] }`,
     newest first. Who may ask: whoever `findOwnedBook` accepts for the entry's book (as `entries:earmark`).
     `canRestore` = the `entries:update` owner check (`lorebooks.user_id === userId`, and no primer problem);
     `canClear` = the lorebook's owner (`lorebooks.user_id === userId`).
   - `entries:restoreRedline` `{ redlineId }` → `{ redlineId, entryId, lorebookId }`, then re-sends
     `entries:redlines` for that entry. Entry path: refuse when any of the row's keys is not in
     `redlineKeysOf(typeId, keys)` with 🚧 *"‹label› is no longer part of this kind of entry."*; otherwise build
     the payload `{ id, typeId, ...each key's before value }` and call the refactored save with cause `restore`
     (all of `entries:update`'s checks, the earmark refusal and `markImprintsKept` apply; it emits what a save
     emits). Dated-change path: the amendment must still be in the entry's book (else 🚧 *"The dated change that
     edit was made on is gone."*); fields = the stored fields with each key's `before` put back, a key whose
     `before` is null (absent) removed; call the refactored `amendments:update` entry path with cause `restore`.
     A row that is gone: 🚧 *"That edit is no longer kept."*
   - `entries:clearRedlines` `{ entryId } | { lorebookId }` → `{ lorebookId, entryId: number | null, cleared }`;
     the lorebook's owner only (🚧 *"Only the lorebook's owner can clear its edit history."*); re-sends
     `entries:redlines` when an entry was cleared.
   - `entries:redlineCount` `{ entryId } | { lorebookId }` → `{ lorebookId, entryId: number | null, count }`; the
     lorebook's owner only (the two clear confirmations name the count).
   - `admin:redlineSummary` `{}` → `{ count, bytes }` and `admin:clearRedlines` `{}` → `{ cleared }`; admin only
     (`if (!socket.user!.isAdmin) throw new Error("Unauthorized")`, as `sockets/adminLogbook.ts`).
5. **`RedlineView`** (declare it in `shared/sockets/types.ts` beside the new namespaces):
   `{ id; amendmentId: number | null; version: string | null; cause: RedlineCause; who: string; mine: boolean;
   at: string /* ISO */; changes: { key: string; label: string; before: unknown; after: unknown; wasAbsent: boolean;
   nowAbsent: boolean }[] }`. Built server-side:
   - `who` (all 🚧 copy, exactly these words): a person → **"You"** when it is the asker, else the person's
     `display_name`, else `username`, else **"Someone"** (the user is gone). A run (`cause === "routine"`) →
     routine = `shown_as` or **"A routine"**, then **"‹routine› in ‹session name›"** when
     `checkSessionAccess(sessionId, askerId).hasAccess` and the session row exists, **"‹routine› in a session"**
     when it exists but the asker may not open it, **"‹routine› in a session that was deleted"** when no row,
     **"‹routine›"** alone when `session_id` is null. An Apply or take-back with no person → **"By itself, from
     ‹session name›"** / **"By itself, from a session"** / **"By itself, from a session that was deleted"** by the
     same access rule. `mine` = the asker wrote it.
   - `version`: null for the entry itself; for a dated change **"the change from ‹date›"**, the date formatted
     with the book's calendar (`formatDate(dayOnly(date), await bookCalendarOf(db, lorebookId))`, as `host.ts`
     `fileOntoHistoryDay` does), **"a dated change"** when it has no year.
   - `label`: `name` → **"Name"**, `content` → **"Content"**, `keys` → **"Keys"**, `secondaryKeys` →
     **"Secondary keys"**, a typed field → its declared label (`i18nText`, as `imprints.ts` `fieldLabel` does),
     else the key.
6. **Wire plumbing**: the namespaces in `shared/sockets/types.ts` (with a 🚧 doc comment each, like
   `entries:earmark`'s ~9253), the event map in `client/sockets/typedSocket.ts`, `interest.ts` (`SCOPED_EVENTS`
   extractors reading `payload?.lorebookId` for the four `entries:*` replies; the reply-name list where
   `entries:earmark` is listed ~964, with a consumer comment naming `client/lorebooks/` components that will listen;
   `admin:` is already a restricted prefix: check what `admin:logbook` needed and do the same), and
   `scopedReplies.test.ts` `SCOPE_PATHS` (`["lorebookId"]` each). List every new `:error` event in your report.

## Tests (Done means)

Through the real handlers (find the harness in `entries.earmark.int.test.ts`, `entries.singleSave.int.test.ts`,
`amendments.int.test.ts`: `fakeSocket`, the emit recorder):

- a form save that changes the content leaves exactly one `save` row (before, after, `user_id`); a save that changes
  nothing leaves none; `entries:setMarks` leaves none; a save naming only `archived` leaves none.
- a dated change's `fields` edit leaves one row with `amendment_id`; a re-date only leaves none; create leaves none.
- a routine's rewrite (insert it with `recordEntryRedline(..., cause: "routine", by: { run: … })` plus the matching
  entry update, or through the host if a harness makes that easy) then the owner's **Restore** brings the text back,
  and the restore is itself listed (cause `restore`).
- Restore of an earmarked entry is refused with the earmark sentence (see how `entries.earmark.int.test.ts`
  earmarks an entry); Restore of a key the type no longer declares is refused with the sentence; Restore of a
  dated-change row puts the keys back and removes a key that was absent before.
- `entries:redlines` names the session to a viewer who may open it, says "in a session" to one who may not, and
  "in a session that was deleted" after the session is deleted (rows survive the session's delete); `who` is "You"
  for the asker's own row.
- a member who is not the book's owner cannot clear (refused with the sentence) and cannot restore.
- `entries:redlineCount` and `entries:clearRedlines` for an entry and for a lorebook; `admin:redlineSummary` and
  `admin:clearRedlines` (admin only; a non-admin is refused).
- Revert through `lorebooks:settleImprint` leaves one `revert` row as that person (only once worker 1's parameter
  exists; otherwise report it as pending).
- Existing suites still pass: `src/lib/server/sockets/entries.*`, `src/lib/server/sockets/amendments.int.test.ts`,
  `src/lib/shared/sockets/` (incl. `scopedReplies.test.ts`), `src/lib/server/sockets/scopedReplies.lorebooks.int.test.ts`
  if it exists.

Run tests **only** like this, from the repo root, one run at a time, with full paths:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/edit-history-a-w2-<n>.log 2>&1"`
Before **every** run: `ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` — if any vitest is running
(worker 1 and two other sessions test on this checkout), wait and check again; never two runs at once; never `pgrep
-f "vitest run"` in a loop. Never pipe vitest into `head`. An int test that opens a DB inside an `it` takes a 60 s
timeout. A failure in a file another lane is editing may be theirs: report it, don't fix it.
Typecheck at the end: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/edit-history-a-w2-tsc.log 2>&1`
(check no other tsc/vitest is running first) and report errors in your files only.

## Stop and ask when (put it in your report and stop that part)

Restore cannot go through the person's save path; a file outside the owned list is needed; a name, copy or
behaviour this brief does not give you (do not invent copy beyond the 🚧 lines above); a write site has no
transaction.

## Verbatim

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This lane runs no `sdk:build` at all.)
- Never `kill -9`.
