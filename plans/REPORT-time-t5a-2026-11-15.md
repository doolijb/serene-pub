# REPORT — build lane `time-t5a` — what a dated session writes (2026-11-15)

Brief: `plans/briefs/BRIEF-time-t5a.md` (its Corrections rule). Worker briefs `BRIEF-time-t5a-rules.md`, `-w1` to
`-w4`; logs `plans/time-t5a-*.log`. Saved by the lead from the supervisor's final message. **Nothing was looked at
in a running app.** One migration, 0164. No SDK edit, no `sdk:build`, no build, no commit. The lane stopped on
★T5A-1; the lead closed it (see the end).

## Inventory (line numbers before the edits)

1. Today's path: `changeLoreEntry` (`host.ts` ~2501) → `lorebookChangeHeld` (~2415) returned held on `moment !=
   null` (~2427) → `holdLoreEntryChange` (~2348) wrote a held `entry_amendments` row into the notes at the
   session's day (`branchId` null, `sourceMessageId` the turn). The session read it at once (`holderBookId`,
   `state/entriesOnReading.ts` ~123–131). It drained through `applyHeldAutomatically` → `applyOverlayItems`,
   which moved the row with a plain update (`ownBook.ts` ~2410). A second change was a second held row.
2. The subject-kind CHECK lives in the schema (`db/schema.ts` ~10949). Settling is subject-agnostic
   (`settle.ts` ~267–278): unchanged.
3. Every reader takes the new row as an ordinary `base` NULL row; only `overlayItemsOf` and Apply look at held
   rows specially, and a direct version is never listed there.
4. A second change the same day merges into the same version (`writeEntryVersion`); the second turn's record
   holds the first turn's value as its `before`, so Back on turn 2 restores turn 1's text (tested).
5. ★FD-9 site: the move path of `ownBook.ts` ~2068–2092.
Fold guard: `foldInParent` does not re-key version records, so a version record is dropped when its session no
longer has that lorebook (a fold followed by Back never writes the folded lorebook).

## The rule as built

| Full, owner's own lorebook, change to an existing lorebook entry | Result |
|---|---|
| Session reads at a moment, Timeline on, entry on its line, nothing held on it | Written at once as the version at its day on its line (`writeEntryVersion`); recorded as `version` (made, or each field changed); edit history `routine` with `amendment_id` |
| Same day again, from this session or another | Merges into that version |
| Another line, or the line still to be forked | Held, as today |
| Session already holds a change on that entry | Held (a second row), as today |
| Dated before the Beginning | Held (defensive: a session does not read an entry before its Beginning) |
| No moment / Timeline off / Review / Off / another person's book / notes-only | Exactly as today |
| Undo | A made version is deleted; a changed one gets each field's earlier value back; a field the turn added is deleted, never set to null; someone else's later change leaves the record kept; Forward restores |
| Apply of a waiting dated change | Waits with its reason when its date is before the Beginning |
| ★FD-9 | A notes history day the line does not own waits on the move path too |
| A person's create-merge, update, re-date or delete of a version | Marks the turn's record kept |

A dated session no longer gets Apply's settle "through the newest applied anchor" for these writes (★FD-10's
case shrinks). Goal 4 / Build D (defaults for new entries) were not built: lane `time-t5b`.

## Changed files

Schema: `db/schema.ts` (the CHECK), `drizzle/0164_imprint_versions.sql` (generated; CHECK only), meta. New
`src/lib/server/lorebooks/entryVersions.ts` (the one writer: `writeEntryVersion`, `beginningRefusal`,
`ownChangeAt`). Source: `pipelines/runtime/host.ts`, `lorebooks/imprints.ts` (subject kind `version`),
`lorebooks/redlines.ts`, `lorebooks/ownBook.ts`, `sockets/amendments.ts`. New tests: `lorebooks/entryVersions.int`,
`lorebooks/imprints.version.int`, `db/imprintVersions0164.int`, `runtime/host.datedVersion.int` (17),
`lorebooks/heldApply.versionChecks.int`, `sockets/amendments.imprintsKept.int`. Rewritten: `host.fullDirect.int`
(the dated test: now "a dated version"), `host.heldEntryChange.int` ("is dated when…" moved to Review changes),
`autoApply.int` (`change()` writes under Review changes). Docs: `docs/lorebooks.md`, `docs/lorebook-time.md`,
`NOMENCLATURE.md`.

## Tests

Wide regression (`plans/time-t5a-wide-1.log`): `sockets/scenes.*`, `sockets/sessions.*`, `sockets/amendments.*`,
`pipelines/routines`, `state`, `lorebooks`, `runtime/host.*`, 0164: 275 files, 2438 pass, 4 fail (3 in
`autoApply.int` from the fixture move and ★T5A-1, since green; 1 `sessions.forms.int`, known). Workers: w1 61/61;
w2 14 new + 45 old; w3 `host.*` 18 files, 211/211; w4 9 new. `tsc` 0 errors; `npm run check` 0 errors.

## Names and sentences

Subject kind 🚧 `version` (`IMPRINT_SUBJECTS`); `writeEntryVersion`, `EntryVersionWrite`, `beginningRefusal`.

## Open ★

- ★T5A-2 the stored value `version` against R3 (cast and card versions exist; once data holds it, renaming needs
  a migration).
- ★T5A-3 a kept *made* version shows the client line "The reply added this entry. Revert removes it.", but Revert
  removes only the version; the note does not name the version's date (needs a client change or a field on
  `KeptImprint`).
- ★T5A-4 Forward after a version was taken back while someone wrote that date leaves two rows at one date.
- ★T5A-5 the listing judges on a not-yet-forked session's parent line; Apply judges after the fork.

## Queued

`time-t5b`: SDK `contracts/src/outlets.ts` ~1874, ~1910–1913 JSDoc ("…a change to an entry of the lorebook is
written there under **Full** on the owner's own lorebook (as the version at the session's date when it reads at
one), and otherwise kept in the session's own book as a held change until applied."). `foldInParent.ts`: re-key
`version` records.

## Noticed, not done

`lorebooks:settleImprint`'s earmark check covers entry records only; `restoreImprints` needs its caller to revive
dates first; the `amendments:delete` entry branch now runs in a transaction.

## ★T5A-1 closed by the lead (2026-11-15)

The lane stopped because correction 1's new Apply conflict ("the line already has a version at this date") made
a session's own chain wait for good: its first waiting change, once applied, was such a version, so the second
never applied (`autoApply.int` failed). **The conflict is withdrawn** (the smallest safe way: Apply behaves as
before this lane for a taken date, writing its own row beside it; the rail reads rows that share a date as one
version). The Beginning conflict stays. `autoApply.int` and `heldApply.versionChecks.int` pass (2 files, 23
tests); `tsc` 0 errors. **For the owner (not blocking):** should Apply merge into the version at that date
instead, with **Take back** putting the fields back rather than moving a row? That would make "one version per
entry, line and date" hold on the Apply path too.

## Grouped verification (lead, 2026-11-15, third) — `time-t5a` + fix, `time-t10`, `time-t6a`

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings). Full `vitest run` (`plans/lead-full4.log`): 2498 files,
2473 pass, 23 fail; 26,190 tests pass, 28 fail. Of the 23: 19 are the known baseline; 2 are environment
(`audiocpp/packages.v.int`, `net/hfDownload.v`); 1 is `sessionPage/remoteChronicle.dom`, which waits on the held
SDK rebuild (it asserts the reworded note); 1 is a teardown flake (`state/valueStamp.int`: `ENOTEMPTY` removing
its temp dir; the file is from 2026-11-11 and untouched). None is these lanes'. Still held behind the owner's
own server on port 4173: `npm run sdk:build` and `npm run build`.
