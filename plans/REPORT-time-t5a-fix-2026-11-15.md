# REPORT — build lane `time-t5a-fix` (2026-11-15)

Brief: `plans/briefs/BRIEF-time-t5a-fix.md`. Saved by the lead from the supervisor's final message. Built; **not
looked at in a running app.** No SDK edit, build, migration or commit. No take-back changes text a person or
another session wrote.

- **Back then Forward keeps a made version's edit history** (`lorebooks/imprints.ts`, `lorebooks/redlines.ts`
  `redlinesOfVersion`, `putBackVersionRedlines`): the rows are read before the delete, ride on the `unmade` entry
  as an optional `redlines` list (optional, so forward stacks already stored still restore), and are re-inserted
  with their ids in the same handle; a row whose entry or version is gone, or whose id is taken, is skipped.
- **The note names the version** (`keptImprintsByEntry` sets `KeptImprint.versionDate`; client
  `sections/keptImprints.ts`): *The reply added the version dated ‹date›. Revert removes that version, with any
  later edits to it; the entry and its other dates stay.* 🚧 · *‹Label›: the reply set ‹value› in the version
  dated ‹date›. …* 🚧
- **The fold guard keeps the record** instead of dropping it (a version that is gone or has moved to another
  lorebook is still dropped); Back still never writes into a lorebook the session no longer reads.
- The withdrawn clause is gone from `heldChangeVerdict`'s comment. A person deleting a version now deletes every
  per-turn record on it in the same transaction (`sockets/amendments.ts`), where lane `time-t5a` marked them kept.

Tests: `lorebooks/imprints*` + `sockets/amendments*` + `client/lorebooks/sections` 28 files, 322 pass;
`runtime/host.*` + `server/state` 78 files, 814 pass; `sockets/sessions.*` 107 files, 822 pass, 1 fail
(`sessions.forms.int`, known); `tsc` 0 errors; `npm run check` 0 errors.

Open ★: the two sentences; "a person's delete removes the records" replaces "marks them kept".
Noticed: Forward does not trim the edit history back to 50 rows per entry (as the existing put-back does not).

## Grouped verification (lead, 2026-11-15, third) — `time-t5a` + fix, `time-t10`, `time-t6a`

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings). Full `vitest run` (`plans/lead-full4.log`): 2498 files,
2473 pass, 23 fail; 26,190 tests pass, 28 fail. Of the 23: 19 are the known baseline; 2 are environment
(`audiocpp/packages.v.int`, `net/hfDownload.v`); 1 is `sessionPage/remoteChronicle.dom`, which waits on the held
SDK rebuild (it asserts the reworded note); 1 is a teardown flake (`state/valueStamp.int`: `ENOTEMPTY` removing
its temp dir; the file is from 2026-11-11 and untouched). None is these lanes'. Still held behind the owner's
own server on port 4173: `npm run sdk:build` and `npm run build`.
