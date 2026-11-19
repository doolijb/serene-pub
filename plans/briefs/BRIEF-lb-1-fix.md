# BRIEF — worker task `lb-1-fix` — five scope-review fixes to the lorebook-delete refusal (D50)

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-lb-1-2026-11-16.md`, `STYLE-GUIDE.md` §6.21
(toasts: a title and one sentence) and the dialog rules, `NOMENCLATURE.md` §24 and the `lb-1` §25 row.
Re-verify every file:line below before editing.

Owner, 2026-11-16: "Refuse the delete while a session uses it, naming the sessions". Standing: every automatic
action shows its cause (P1); views never toast; a scoped event carries its scope key.

Rules: never `git stash / checkout / restore`; `npx prettier --check` only; never commit; no migration. Inside
`db.transaction` only `tx`. Comments state the rule, not the story. Lanes `tl-4` and `kn-5` are editing
`sockets/import.ts`, three functions in `lorebooks/ownBook.ts`, history retrieval, the knowledge judge, the
Pipelines panel, `sessions/settingsForm.ts`: do not touch those; re-read any file right before editing. Tests
only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/lb-1-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## Fixes

1. **A plugin uninstall never deletes a provided lorebook a session plays on.** `sockets/plugins.ts` 839–842 →
   `plugins/providedBooks.ts` 1526–1531 (`deleteProvidedBooks`) has no session check, and an enabled provided
   book can be a session's lorebook. In the per-book transaction: when `bookDeleteRefusal(tx, book.id, null)`
   refuses, **keep the book** (skip its delete), clear its disabled mark the way `clearDisabledOnKeptBooks`
   does, and collect its name. The uninstall's reply gains the kept names (a new reply field: name by §24, ★)
   and the place that already reports the uninstall's result says, in one sentence, *‹n› provided lorebooks
   stayed because sessions play on them: ‹names›.* (★; use the existing result surface, no new toast site).
   Tests: kept when a session plays on it, deleted otherwise, the reply lists it.
2. **Sessions of deleted accounts do not block a delete.** `sessions/bookLock.ts` 89–99 counts sessions whose
   owner is soft-deleted (`users.is_deleted`; nothing restores an account), so the lorebook could never be
   deleted and "ask their owners" points at nobody. Leave those sessions out of the count (join the session's
   owner and require not deleted). Test.
3. **The refusal a toast can carry is one sentence.** The server refusal reaches Layout's catch-all toast
   (`Layout.svelte` 446–466) whenever the dialog could not know beforehand (other people's sessions, kept
   notes, a stale list). Make the string the delete handler returns **one sentence**: the lead and the names
   (*"X" can't be deleted while these sessions play on it: A, B and 2 more.*), or, when only other people's
   sessions play on it, *"X" can't be deleted while 2 of other people's sessions play on it.* The ways out
   (delete those sessions, **Merge ‹lorebook› into these notes**, ask their owners) stay in the dialog
   (`BookDeleteRefusal.svelte`) and the docs: keep `bookDeleteWords` structured so the dialog still shows them.
   Update the tests that pin the long sentence (old → new in your report).
4. **A session's own notes cannot be deleted through the lorebook delete.** `sockets/lorebooks.ts` 1238–1246
   checks only that the asker owns the book; a session's notes are owned by the session's owner, so a
   hand-made `lorebooks:delete {id: notesId}` deletes live notes and their scenes. When the row is a session's
   notes (`session_id` set), answer exactly as for a lorebook that does not exist ("Lorebook not found." or
   whatever that handler already says). Test.
5. **Back says when it left a lorebook in place.** `library/writes.ts` (`undoLibraryChange`, the catch at
   ~632–638): the refusal is only logged and `changed` stays false, so the person is told nothing. Carry it
   into Back's result the way Back already reports a part it could not undo (find the existing shape; if Back
   has no such notion, add the smallest field to its reply and the one existing place that words Back's
   outcome: ★), in one sentence: *‹lorebook› stayed: a session plays on it.* Test.

Also: `LorebookActions.svelte:735` uses a plain `<h2>`; make it the dialog's title element so the dialog has an
accessible name (one-line change; check the Skeleton Dialog section in `AI-TEMP/skeleton-llms-svelte.txt` with
`grep -n "^# Dialog"` then `sed -n` that section only). Append a "Scope review and fix task" section to
`plans/REPORT-lb-1-2026-11-16.md` and the new names to the `lb-1` §25 row.

## Tests

`sessions/bookDelete.int.test.ts`, `shared/lorebooks/bookDeleteWords.test.ts`, the providedBooks / plugins
uninstall tests, the library writes (Back) tests, `bookDeleteRefusal.dom.test.svelte.ts`, `deleteCopy.test.ts`.
`tsc` 0.

## Report (under 300 words)

Per fix: what changed (file:line), new names and sentences (★), tests and counts with log names, anything not
done, **Noticed, not done**.
