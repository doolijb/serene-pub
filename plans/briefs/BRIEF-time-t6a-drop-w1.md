# BRIEF — worker `time-t6a-drop-w1` — remove the per-message seated set's code

Supervisor: lane `time-t6a-drop` (brief `plans/briefs/BRIEF-time-t6a-drop.md`). Repos: app
`/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk` (edit the SDK there).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**You do not run `sdk:build`, `sdk:test`, `tsc` or `npm run check` in this task: the supervisor does.** Never
`git checkout` / `git restore` / `git stash` in either repo (use `git show HEAD:<path>` to read an old version).
Never `prettier --write`. Never `kill -9`. Another session shares this checkout: edit only the files listed below.

## Goal

The owner approved (2026-11-15) removing the per-message seated set that lane `time-t6a` added yesterday: column
`session_messages.firsthand_cast_member_ids` (`firsthandCastMemberIds`) and module
`src/lib/server/messages/firsthand.ts` (`withFirsthandStamp`, `firsthandRedrive`, `repointFirsthand`,
`firsthandOf`, `Firsthand`). The supervisor has already removed the column from `schema.ts` and generated
migration `drizzle/0166_message_firsthand_drop.sql` (`ALTER TABLE "session_messages" DROP COLUMN
"firsthand_cast_member_ids";`). You remove every code reference and write the migration test. Every message row
must read and write exactly as before lane `time-t6a`: the insert, branch copy, Back, Forward, Reassign and
re-drive unchanged. `git show HEAD:<path>` predates lane `time-t6a` (but not other lanes' later edits, so restore
only the time-t6a lines, never a whole file).

**Do not touch** `src/lib/server/sessions/firsthandFilter.ts`, its tests, `bindings.ts`, `declaredReads.test.ts`,
`registryHashes.test.ts`, or anything about the in-ports `firsthandFor` / `firsthandBy`: that is a different
feature (the filter) that shares the word "firsthand" and does not read the column. Before removing any line,
check it names the column or the module above.

## Files owned (exactly these)

Delete (by exact path, `rm <path>`):
- `src/lib/server/messages/firsthand.ts`
- `src/lib/server/messages/firsthand.int.test.ts`
- `src/lib/server/pipelines/runtime/host.firsthand.int.test.ts`
- `src/lib/server/sessions/branch.firsthand.int.test.ts`
- `src/lib/server/sockets/sessions.firsthand.int.test.ts`
- `src/lib/server/db/messageFirsthand0165.int.test.ts` (it asserts the column after migrating to the real
  folder, which now drops it; replaced by the new test below)

Edit (remove only the time-t6a lines):
1. `src/lib/server/messages/store.ts`: the import at ~41 (`import { repointFirsthand, withFirsthandStamp } from
   "./firsthand"`); the `await repointFirsthand(db, sessionId, moves)` line in `repointSpeakerStamps` (~461);
   in `insertLegacy` and `insertLegacyMany` unwrap `withFirsthandStamp(...)` so they read as HEAD:
   `const stamped = await withSpeakerStamp(\n\t\tdb,\n\t\tawait withStoryClockStamp(db, values)\n\t)` and
   `stamped.push(\n\t\t\tawait withSpeakerStamp(\n\t\t\t\tdb,\n\t\t\t\tawait withStoryClockStamp(db, v),\n\t\t\t\tseatMembers,\n\t\t\t\tseatsStamped\n\t\t\t)\n\t\t)`.
2. `src/lib/server/pipelines/runtime/host.ts` ~8770: in the re-drive claim's patch, remove the comment
   `// One set per row: a re-drive rewrites it to the seats present now.` (two lines) and the spread
   `...(await (await import("$lib/server/messages/firsthand")).firsthandRedrive(sessionId)),`. Nothing else
   in host.ts.
3. `src/lib/server/sockets/sessions.ts` Reassign (`sessions:reassignRemovedParticipant`), two places:
   - character branch ~8688–8720: lane time-t6a hoisted the seat lookup into `const newMemberId = ...` and added
     `if (removedCC.castMemberId != null && newMemberId != null) { const { repointFirsthand } = await import(...);
     await repointFirsthand(...) }`. Restore the HEAD form: the `updateLegacyWhere` patch's
     `castMemberId:\n\t(\n\t\tawait seatOf(\n\t\t\ttx as unknown as Db,\n\t\t\tsessionId,\n\t\t\t\`character:${newId}\`\n\t\t)\n\t)?.castMemberId ?? null`
     inline, no `newMemberId`, no `if` block. Compare with `git show HEAD:src/lib/server/sockets/sessions.ts`
     (~8560–8580) and keep the surrounding comment as HEAD has it.
   - player branch ~8818–8830: remove the `if (removedCP.castMemberId != null && playerSeat.castMemberId != null)
     { ... repointFirsthand ... }` block.
4. `src/lib/server/sessions/branch.ts` ~463–466: remove the two comment lines (`// The copy keeps its original's
   set; ...no remap.`) and `firsthandCastMemberIds: (message as any).firsthandCastMemberIds ?? null,`.
5. `src/lib/server/sockets/import.ts` ~1703–1705: remove the comment (`// An imported line was written
   elsewhere: who was there is\n// not recorded.`) and `firsthandCastMemberIds: null`; `storyClockMinute: null`
   becomes the last property again, with **no** trailing comma (as HEAD, ~1701).
6. `src/lib/shared/widgets/messageV1.test.ts` ~102–103: remove `// 🚧 Firsthand (NOMENCLATURE §14): ...` and
   `firsthandCastMemberIds: [3, 7],`.
7. SDK `sdk/src/widgets.ts`: in `MessageV1`'s "Withheld" paragraph (~236–248) remove `, and 🚧
   \`firsthandCastMemberIds\` (which cast members were there for the message: the host's own record)` so the
   sentence ends `...and what Back took is the host's). They are host bookkeeping, listed once in ...`; reflow
   the comment lines to the file's width. In `MESSAGE_HOST_FIELDS` (~371–372) remove the comment line and
   `'firsthandCastMemberIds',`. The SDK's contract test parses the backticked names in that paragraph and
   compares them with the list (`sdk-tests/messageRowContract.test.ts:183`), so both must lose it.
8. SDK `sdk-tests/messageRowContract.test.ts` ~95–96: remove the comment and `firsthandCastMemberIds: [7],`
   from the recorded row (keep `rewindTaken: null,` with its trailing comma as the file's style requires:
   the SDK uses trailing commas, the app does not).

Create: `src/lib/server/db/messageFirsthandDrop0166.int.test.ts` — model it on the deleted
`messageFirsthand0165.int.test.ts` (read it before you delete it, or `git show` will not have it: it is
untracked, so **read it first**). It must show, in one `it` with a `60_000` timeout (or `120_000` if two full
chains migrate in it), using `migrationsFolderThrough` (`$lib/server/utils/testDb`), `rawRows` (`./rawRows`),
`PGlite`, `drizzle-orm/pglite` `migrate`:
- a database migrated through `"0165_message_firsthand"` with two messages, one stamped
  `firsthand_cast_member_ids = '{3,7}'`, one NULL, then migrated with the real `drizzle` folder: the column is
  gone (`information_schema.columns`), both messages keep their ids and content;
- a fresh database migrated straight from the real folder ends with the same schema: compare
  `information_schema.columns` for `table_schema = 'public'` (`table_name, column_name, data_type, udt_name,
  is_nullable, column_default`, ordered by table and column; never `ordinal_position`, a drop leaves a gap) and
  `pg_indexes` (`tablename, indexname, indexdef` for `schemaname = 'public'`), equal between the two;
- a second boot (`migrate` again on the upgraded database) changes nothing: the ledger hashes, the message rows
  and the column list are equal before and after.
Close every PGlite client in `finally`; dispose the temp folder in `afterAll` as the old test did. Header
comment: one short paragraph saying what 0166 does and what the test shows. No other product's name anywhere.

## Run (only this, one run at a time)

First `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if a vitest is running, wait and re-check
(never kill it). Then from the app root:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/db/messageFirsthandDrop0166.int.test.ts > plans/time-t6a-drop-w1.log 2>&1"`

Never pipe vitest into `head`. Then `npx prettier --check` on every file you edited or created (report results;
the existing files may already fail it from earlier lanes: compare with how they were, do not reformat).
Finally `grep -rn --binary-files=text -E "firsthandCastMemberIds|firsthand_cast_member_ids|messages/firsthand|withFirsthandStamp|firsthandRedrive|repointFirsthand|firsthandOf" src ../serene-pub-sdk/sdk ../serene-pub-sdk/sdk-tests`
from the app root: the only hits allowed are in your new test (the column name in SQL). Leave
`../serene-pub-sdk/contracts/src/queries.ts` alone even if it mentions the column (not yours).

## Stop and ask (stop, report, don't choose) when

A file outside the list reads the column or the module; a time-t6a line is tangled with another lane's change so
removing it would change their behaviour; the new test fails for a reason that is not a typo in the test (for
example the two schemas differ).

## Report (your final message, under 250 words)

Files deleted / edited / created with line ranges; the test command and its result (pass/fail counts); prettier
results; the final grep's output; anything you stopped on.
