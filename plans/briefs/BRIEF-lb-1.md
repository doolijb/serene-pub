# BRIEF — build lane `lb-1` — deleting a lorebook that sessions are playing on is refused (owner ruling D50)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/REPORT-tl-2a-2026-11-16.md` (the lorebook lock; where D50 was found), `src/lib/server/sessions/bookLock.ts`
and its guard test, `docs/lorebooks.md` (deleting; *fold the lorebook into the session's notes*),
`STYLE-GUIDE.md` (confirm dialogs, refusals in words, read-only in words), `NOMENCLATURE.md` §1, §24.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash / checkout / restore`; `npx prettier --check` only; never commit. **No migration** (if the fix
needs a foreign-key change, stop and report: propose it, do not build it). Inside `db.transaction` only `tx`.
Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/lb-1-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no build. Lanes `fnd-4`
(failing tests under `pipelines/`, some `sockets/*.int.test.ts`), `io-2` (the lorebook file reader / writer)
and `tl-4` (`sockets/import.ts`, `lorebooks/ownBook.ts` inserts, history retrieval) are running: do not edit
their files; re-read any file right before editing.

## Owner (2026-11-16)

"Refuse the delete while a session uses it, naming the sessions". Standing: every session has a lorebook;
"Once the session starts, the lorebook can't be swapped."; one socket listener per event family, views never
toast; sockets: a scoped event carries its scope key.

## Build

1. **Every path that deletes a lorebook** (the socket delete, bulk delete, an administrator's delete of a
   user's data, deleting a user, plugin / starter removal, Back / Forward of a create, anything that removes a
   `lorebooks` row: find them all and list each) is refused while any session plays on that lorebook
   (`sessions.lorebook_id`, and any other column by which a session reads it: find them), in one server
   function the paths share (beside `bookLock.ts`; name by §24, ★). The refusal names the sessions, in words,
   with the ways out the app already has: delete or archive those sessions first, or *fold the lorebook into
   the session's notes*. Sentence ★ (one sentence + the list; cap the list at a readable number, "and ‹n›
   more"). Sessions the asker cannot see (another member's) are counted, not named.
   Exceptions to decide by what exists and report: deleting a **user** (their sessions go with them: order the
   deletes, do not refuse); a session's **own notes** are not deleted through this path at all.
2. **The client** shows the refusal where the delete was asked (the existing error surface for that action;
   no new toast site), and where the UI can know beforehand (the delete confirm), it says so in words instead
   of offering a delete that will be refused, with the sessions listed as links.
3. **Existing damage is not repaired here:** sessions already left without a lorebook by an earlier delete:
   report how the app treats one today (does it play? does `ownBookFor` cover it?) under Noticed.
4. Docs: `docs/lorebooks.md` (deleting), `NOMENCLATURE.md` §25. Extend the lock's guard test if it enumerates
   lorebook-removing paths.

## Tests

Each delete path: refused with the sentence and names while a session uses the lorebook, nothing deleted;
allowed once the sessions are gone or folded; a user delete still works; the reply reaches the asker (scope key
present); DOM: the confirm shows the words and the list. `tsc` 0; `npm run check` 0 errors in lane files.

## Stop and ask when

CLAUDE.md §Decisions applies; a delete path cannot be refused without breaking a ruled flow (name it); a
migration is needed.

## Report

Final message = the report (lead saves `plans/REPORT-lb-1-<date>.md`): the paths found and what each does now;
the function and sentence (★); exceptions; tests; **Noticed, not done**. Under about 450 words.

## Cold review corrections (2026-11-16) — these rule over the text above

1. **The delete also deletes sessions' own notes.** `lorebooks.overlay_of` is `onDelete: "cascade"`
   (`db/schema.ts` ~1469–1471): deleting a lorebook deletes every session's notes that overlay it, with their
   scenes (~4852). So the refusal protects the notes as well as the link; strike "a session's own notes are not
   deleted through this path". No migration is needed: an application check before `purgeLorebook`. Correct
   `docs/lorebooks.md` ~369, which understates the loss. Item 3 (existing damage): such a session has lost its
   notes and `ownBookFor` gives it empty ones (`ownBook.ts:160`): say so under Noticed.
2. **The paths, as found:** `sockets/lorebooks.ts:1253` (the person's delete, owner only): **refused**;
   `library/writes.ts:507` (Back of a lorebook create): refused the same way if a session has since started on
   it; `plugins/providedBooks.ts:1529` and `sockets/starterKits.ts:216` (sessions never read these: verify,
   then leave); `lorebooks/ownBook.ts:619` (a session's own notes, removed with the session: leave);
   **`sockets/sessions.create.ts:1018` (removes the world copy of a create that was refused): exempt**, or the
   rollback breaks; user deletion cascades through `lorebooks.user_id`: leave, ordered as today. Find any other.
3. **Words:** the way out is the button **Merge ‹lorebook› into these notes** (`docs/lorebooks.md:311`); "fold"
   is the code word only and never appears in the sentence. Merge is offered only to the session's owner: for a
   session the asker cannot see ("counted, not named") the sentence says to ask that session's owner (★ wording).
