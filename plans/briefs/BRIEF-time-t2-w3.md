# BRIEF — worker `time-t2-w3` — an entry's Beginning and Decay travel: edit history, duplicate, export/import, timeless copy

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t2` (brief `plans/briefs/BRIEF-time-t2.md`, readable for
context; this brief rules where they differ).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## What is already built (by worker w1; read it, don't change it)

- Column `lorebook_entries.decay_rate` (`real`, NOT NULL, default 0), migration 0162. Wire key `decayRate`.
- `src/lib/server/utils/lorebookEntries.ts`: `takesBeginning(typeId)` (true for every type that does not declare
  `year`/`month`/`day` itself — i.e. not History); `entryInsert` stores a number `year`/`month`/`day` for such a
  type and a clamped `decayRate` (else 0); `splitUpdate` sends those date parts to `fields` (null clears) and
  `decayRate` to its column; `toEntryRow` gives every row `decayRate` and a non-history row `year`/`month`/`day`
  (`number | null`); `beginningProblem(parts)` validates a Beginning's shape.
- `src/lib/shared/lorebooks/amendments.ts`: `clampDecayRate`, `ENTRY_DATE_PARTS`.
- A non-history entry's Beginning = its own `year`/`month`/`day` in `fields` (no date = *Perpetual*). Decay: 0 =
  *Fact*, above 0 up to 1 = *Living*. Nothing reads the rate for recall.

## Owner rulings (quoted)

- 2026-11-13: "Decay: Fact | Living" and "Beginning: Perpetual | Began at date".
- 2026-11-14: *Beginning is the date of the entry's first version; no date = perpetual*; *Decay is one number; 0 is
  a fact*. Both travel with the entry: duplicate, export and import (additive, absent = 0 / no date), starter-kit
  copies. The **timeless copy** clears every kept entry's Beginning and keeps its Decay. The edit history records a
  change to either, and **Restore** puts both back.
- History entries are unchanged by all of this (their date already travels as it does today).

## Files owned (edit only these)

- `src/lib/server/lorebooks/redlines.ts` (only `redlineKeysOf` and `entryWireValues`)
- `src/lib/server/utils/lorebookDuplicate.ts`, `src/lib/server/utils/lorebookExportBuilder.ts`,
  `src/lib/server/utils/lorebookExportMapper.ts`
- the lorebook-file import insert in `src/lib/server/sockets/lorebooks.ts` (~4271, `entryInsert` of a file's entries)
  — only if the mapper alone cannot carry the values
- `src/lib/server/lorebooks/timelessCopy.ts`
- tests beside each: new `src/lib/server/lorebooks/redlines.beginningDecay.int.test.ts`,
  `src/lib/server/sockets/lorebooks.beginningDecay.int.test.ts` (duplicate, export → import round trip, starter-kit
  copy), cases added to `src/lib/server/lorebooks/timelessCopy.int.test.ts` and
  `src/lib/server/utils/lorebookExportMapper.test.ts`

Do **not** edit: `src/lib/server/sockets/redlines.ts`, `sockets/entries.ts`, `sockets/amendments.ts`,
`utils/lorebookEntries.ts`, anything under `src/lib/server/pipelines/**` or `state/declarations.ts` (another
session's), any client or shared file. Leave `timelineOffByPass` / `withoutTimelinePassMark` in `lorebookDuplicate.ts`
and `sockets/lorebooks.ts` exactly as they are. If you need another file, stop and report.

## Build

### 1. Edit history (`lorebooks/redlines.ts`)

`redlineKeysOf` counts `decayRate` for every type, and `year`, `month`, `day` for a type that `takesBeginning`.
`entryWireValues` reads `decayRate` from the row's `decayRate` column (0 when absent) and a date part of such a type
from `fields` as the number or `null` (never `undefined`: a restore to *Perpetual* must send `null` so the save
clears it). Check how `recordEntryRedline` builds `before`/`after` (and `wasAbsent`), and how
`sockets/redlines.ts` Restore turns a row back into a save (`if (before) entryPatch[key] = before.v`): make sure a
change from Perpetual to *Began at Year 5* restores to Perpetual, and 0 → 0.4 restores to 0. If that cannot be made
true without editing `sockets/redlines.ts`, stop and report exactly what it needs.

### 2. Duplicate (`lorebookDuplicate.ts`)

Verify `duplicateLorebookRows` copies `decay_rate` and the date parts (it may already, by copying whole rows); change
only what is missing.

### 3. Export and import (`lorebookExportBuilder.ts`, `lorebookExportMapper.ts`, the import insert)

Find how the native lorebook file carries an entry's own Serene Pub values (declared typed fields, category,
priority…) and how History's date is written (the mapper keys it on `roles.order`, ~436/486/683). For a non-history
entry, write its Beginning (`year`, `month`, `day`) and its `decayRate` in the same place the file carries the
entry's other Serene Pub values, **only when set** (a Beginning present; a rate above 0), so a file of entries with
neither is byte-for-byte what it is today. No format version change. On import, read them back: a rate that is a
finite number is clamped to 0–1, anything else is 0; date parts are kept only when `beginningProblem` accepts them,
else dropped (the entry imports Perpetual). A one-file import of another app's format and the 0.5 upgrade are
unchanged. Starter lorebooks' copies and provided books (`plugins/providedBooks.ts` `valuesOf` uses
`mapImportedEntry`) should then carry both; verify the path a starter lorebook takes into a person's library in a test,
without editing files outside Files owned.

### 4. Timeless copy (`timelessCopy.ts`)

Every kept entry loses its Beginning (`year`/`month`/`day` removed from `fields`) and keeps its `decayRate`.
History entries are already left out of the copy; leave that. Look at ~227 (`entryAt(toEntryRow(row)…)`) and ~534
(`splitUpdate(row.typeId, wire)`): `toEntryRow` now returns the date parts for every non-history row, so make sure
the copy writes them cleared.

## Tests (Done means)

- `redlines.beginningDecay.int.test.ts`: a person's save that sets a rate and a Beginning records one edit-history
  row naming both; Restore of it puts back 0 and Perpetual; a save changing only the rate records the rate. Model it
  on `src/lib/server/lorebooks/redlines.apply.int.test.ts` / `sockets/entries.redlines.int.test.ts`.
- `sockets/lorebooks.beginningDecay.int.test.ts`: duplicate keeps both; export → import keeps both (a world lore
  entry Living 0.4 beginning Year 5 Mo. 2; an undated Fact entry exports with neither key); a file with a rate of 7
  imports at 1, a rate of "x" at 0, a Beginning with a day and no month imports Perpetual; a starter-kit copy keeps
  both. Model on `sockets/lorebooks.duplicate.int.test.ts` and `sockets/lorebooks.import-export.int.test.ts`.
- `timelessCopy.int.test.ts`: a kept entry with a Beginning and rate 0.3 is copied undated with rate 0.3.
- `lorebookExportMapper.test.ts`: the mapper writes and reads the values; absent stays absent.

Run each file (and afterwards, as regressions, `lorebooks/timelessCopy.int.test.ts` whole,
`sockets/lorebooks.duplicate.int.test.ts`, `sockets/lorebooks.import-export.int.test.ts`,
`utils/lorebookExportBuilder.currentVersion.int.test.ts`, `sockets/entries.redlines.int.test.ts`,
`lorebooks/redlines.apply.int.test.ts`) like this, one run at a time, from the repo root:

```
ps -eo pid,args | grep -E "node.*vitest" | grep -v grep   # wait while anything is listed
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t2-w3-<n>.log 2>&1"
```

Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/time-t2-w3-tsc.log 2>&1` and report the error
count and any in your files. Do not run the full suite.

## Hard rules

- Migrations are generated only; you need none. Never touch `drizzle/**` or `schema.ts`.
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- Comments state the rule, not the story: no "no longer", "used to", "now", "previously" narration (a ratchet test
  counts them).
- No `prettier --write` on a directory (per file you own is fine).
- No new name, file key, setting or user-visible word except the file keys the export needs (name them in your
  report; prefer the wire names `decayRate`, `year`, `month`, `day`). If the file format seems to need anything
  else, stop and report.
- No other product's name in any file.

## Report

Your final message: changed files, the export file keys and where they sit, tests run with pass/fail counts and log
paths, tsc error count, anything that needed a file outside Files owned, and **Noticed, not done**. Under 600 words.
