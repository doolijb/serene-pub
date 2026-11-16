# BRIEF — worker `time-t4a-w2` — an entry's versions: the pure helpers and the writes

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4a`. Report: your final message (under ~600
words): changed files, exported names with one line each, tests run with results, every sentence added.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Context (what is being built around you)

In a lorebook that keeps a timeline, the entry form will show an entry as **one entry with versions over
story time**: a vertical rail of versions (*From the beginning* or *Began at ‹date›*, then each dated change
as a version, in story order), selecting one shows that version in the fields. Storage is unchanged: a dated
version is an `entry_amendments` row (internally an *amendment*, a *dated change*) holding only the fields
that differ. Owner rulings this follows:

- 2026-11-13: "For living entries and when making edits to existing perpetual entries, we should show the
  option to change the effective date of that version. Save edits that version, but also need a button to save
  as a new dated version. It would be neat to be able to toggle off undated history edits and then navigate the
  dated versions like a vertical timeline, adding new versions before or after."
- 2026-11-14 (the zones): "A makes sense". One rule: **a field is the entry's until it is made to differ at a
  date.** Always the entry's: line, Beginning (`year`, `month`, `day`), Decay (`decayRate`), archive.
  **Keywords (`keys`), Pinned (`constant`), Off (`enabled`) and Part of (`anchorEntryId`)**, and only these
  four: when no dated change on the line being read carries the field it is the entry's (editing it writes the
  entry's own stored value); once a dated change carries it, it is edited per version. Name, Content and every
  other field are always the version's.
- 2026-11-14 (selection): "Yes, move the moment bar" — clicking a version sets the reading moment to its date;
  the rail's selected version is always the one in force at the moment.
- Plan §5.1 (ruled): one version per entry, line and date; a version cannot be dated before the entry's
  Beginning. Old data may hold two changes at one date on one line: they are drawn as **one** version, folded
  in id order, and editing it edits the later row.

You build the arithmetic other workers' components and the entry form call. Nothing here draws anything.

## Build

### 1. New `src/lib/client/lorebooks/time/entryVersions.ts` (pure; no socket, no Svelte runes)

Types: `type EntryRow = Sockets.Amendments.EntryRow` (global namespace; fields `id`, `entryId`, `branchId`,
`year`, `month`, `day`, `fields`, `historyEntryId`, …). `StoryDate` from `$lib/shared/lorebooks/storyDate`.
Use `compareDates` (`$lib/shared/lorebooks/storyDate` or the re-export in `../sections/historyDates`),
`amendmentsOnLine`, `lineOf`, `rowReadsOnLine`, `type Line` from `$lib/shared/lorebooks/lineReading`. Read
`amendmentsOnLine` (~447–488) first: it returns the changes that apply on a line in APPLY order — main, then
each ancestor outward, then the line's own; inside a step by date then id; a nearer line wins whatever the date.
**Never re-implement that rule**; derive from its result.

- `ZONE_FIELDS = ["keys", "constant", "enabled", "anchorEntryId"] as const`, `type ZoneField`.
- `ENTRY_ONLY_FIELDS: ReadonlySet<string>` = `year`, `month`, `day`, `decayRate`, `archived`.
- `interface EntryVersion { key: string; kind: "beginning" | "dated"; date: StoryDate | null; branchId:
  number | null; rows: EntryRow[]; editRow: EntryRow | null; own: boolean; changes: string[] }`
  - beginning: `key "beginning"`, `date` = the entry's Beginning (`{year, month, day}` when `entry.year` is a
    number, else null = Perpetual), `branchId` = the entry's own line, `rows []`, `editRow null`, `own` = the
    reading line is the entry's own line, `changes []`.
  - dated: `key` = `` `row:${editRow.id}` `` (stable across a re-date), `rows` = every row of this line and
    date in id order, `editRow` = the last of them, `own` = `branchId === line.branchId`, `changes` = the
    union of the rows' field keys, first-seen order.
- `entryVersions({ entry, amendments, line }): { versions: EntryVersion[]; elsewhere: EntryRow[] }`
  `entry: { branchId?: number | null; year?: unknown; month?: unknown; day?: unknown }`. `versions[0]` is the
  beginning. Then `head = amendmentsOnLine(amendments, line)` (no moment = every change the line can read),
  **stably** sorted by `compareDates` (ties keep head order), grouped by (branchId, year, month??null,
  day??null) in first-appearance order. `elsewhere` = the amendments not in `head` (other lines, or an
  ancestor's dated past the fork), sorted by date then id.
- `versionAt(versions, moment: StoryDate | null): EntryVersion` — `null` (now) → the last version; else the
  last dated version with `compareDates(v.date, moment) <= 0`; none → the beginning. This must agree with what
  `applyAmendments(entry, amendments, { line, moment })` folds: test that for several moments the fold at the
  chosen version's date equals the fold at the moment.
- `momentOfVersion(versions, v): StoryDate | null` — dated → its date; beginning with a Beginning → that date;
  Perpetual → the year before the first dated version (`{ year: first.year - 1, month: null, day: null }`);
  Perpetual with no dated version → `null` (the caller leaves the moment alone).
- `carriedFields(versions): Set<string>` — every field key any dated version carries (inherited ones too).
- `zoneOf(field: ZoneField, carried, promoted: ReadonlySet<string>): "entry" | "version"` — `version` when
  carried or promoted.
- `splitVersionSave({ diff, draft, selected, carried, promoted })` →
  `{ entryPatch: Record<string, unknown> | null; versionFields: Record<string, unknown> | null }`.
  Selected beginning → everything in `diff` is the entry's. Selected dated → each key of `diff` goes to the
  entry when it is in `ENTRY_ONLY_FIELDS`, or a `ZoneField` whose zone is `entry`; every other key goes to the
  version. `versionFields` = `{ ...editRow.fields, ...versionPart, ...promoted keys with their draft values }`
  when `versionPart` or `promoted` is non-empty, else null. `entryPatch` null when empty.
- `splitNewVersion({ diff, draft, carried, promoted })` → `{ entryPatch, fields }` — the same split; `fields`
  = `versionPart` plus promoted keys' draft values; `fields` may be `{}` (a new version that changes nothing
  yet is allowed: it is edited next).
- `interface DateBounds { after: StoryDate | null; before: StoryDate | null; beginning: StoryDate | null }`
- `boundsAfter(versions, v): DateBounds` — for *+ Add a version here* under `v`: `after` = `v`'s date (null for
  a Perpetual beginning), `before` = the next dated version's date in rail order (null at the end),
  `beginning` = the beginning's date. `bounds(versions): DateBounds` — Save as a new version / change a date:
  only `beginning`.
- `versionDateProblem(date, b: DateBounds): string | null` — sentences (🚧, exact; dates via `formatDate` from
  `../sections/historyDates`, which reads the open book's calendar):
  - before the Beginning: `` `This entry began at ${b}, so a version can't be dated before it.` ``
  - outside a gap (`after`/`before`, both exclusive): with both `` `Pick a date after ${after} and before ${before}.` ``;
    only after `` `Pick a date after ${after}.` ``; only before `` `Pick a date before ${before}.` ``
- `takenVersion(versions, date, lineBranchId): EntryVersion | null` — the line's **own** dated version at
  exactly that date (year, month??null, day??null equal).
- `TAKEN_SAVE_SENTENCE(date: StoryDate): string` = `` `${formatDate(date)} already has a version on this line. Saving changes that version.` ``
  `TAKEN_REDATE_SENTENCE(date)` = `` `${formatDate(date)} already has a version on this line. Pick another date.` ``
- `sameEverywherePlan(field: ZoneField, versions, value: unknown)` →
  `{ rewrites: { id: number; fields: Record<string, unknown> }[]; versionsChanged: number; entryPatch:
  Record<string, unknown>; blockedBy: EntryVersion | null }` — `rewrites`: each row of every **own** dated
  version that carries `field`, with that key removed (other keys kept, an empty `{}` allowed);
  `versionsChanged` = how many own versions that is; `entryPatch` = `{ [field]: value }`; `blockedBy` = the
  first non-own dated version that carries the field (then nothing should be written; the caller says why).
- `blockedSentence(v: EntryVersion, lineName: string)` = `` `${lineName}'s version of ${formatDate(v.date!)} sets it too, so it differs by version there.` `` (🚧)
- `otherLinesRead(entry: { branchId?: number | null; year?: unknown; month?: unknown; day?: unknown },
  branches: readonly LineBranch[]): boolean` — whether any line other than the entry's own reads it: for each
  branch id ≠ the entry's, `rowReadsOnLine(entry, lineOf(id, branches), beginningOrNull)`. Only branches are tested:
  main never reads a branch's row.
- `CHANGE_LABELS` + `changesWords(keys: string[]): string` — "changes ‹fields›": copy `FIELD_LABELS` and
  `saysWhat` from `src/lib/client/lorebooks/time/AmendmentList.svelte` ~108–150 **exactly** (entry keys only is
  fine; keep the same words: `keys` → "triggers", `enabled` → "on or off", `constant` → "always on", …), result
  `` `changes ${named}` `` or `"changes nothing"`. Add `anchorEntryId: "part of"`. Do not edit
  `AmendmentList.svelte` (another page mounts it).

### 2. `src/lib/client/lorebooks/editor/entrySave.ts` (owned)

- `isOurAmendment`: also accept a **merge** (the server now updates the line's own row at a taken date instead
  of inserting): a row already in `knownIds` matches when it is this entry, line and exact date and every key of
  `params.fields` is present with the same value. A new row matches as today. Keep the existing tests passing;
  add tests for the merge case and for "a known row at that date whose fields differ is not ours".
- `updateEntryAmendment(socket, params: Sockets.Amendments.Update.Params, knownRow)` → `Promise<List.Response>`:
  `awaitReply` like `fileEntryAmendments` (`event "amendments:update"`, `replyKey
  interestKey("amendments:list", lorebookId)`, `errorEvent "amendments:update:error"`, `fallbackError "The
  version could not be saved."`), `match`: the list has row `params.id` and, for each part sent, the same value
  (`fields` equal by value when sent; `year`/`month`/`day` equal when sent).
- `deleteEntryAmendment(socket, params: Sockets.Amendments.Delete.Params)` → awaits the list no longer holding
  `params.id` (`errorEvent "amendments:delete:error"`, `fallbackError "The version could not be deleted."`).
- Leave `amendmentDateToast` and its sentence as they are: History keeps **Save as of** and **Change the base**
  (it gets no rail), so the toast stays true there.

### 3. `src/lib/client/lorebooks/time/moment.ts` (owned)

Add, beside `MOMENT_SAVE_SENTENCE` (which stays, unchanged, for the cast page):
`export const ENTRY_MOMENT_SAVE_SENTENCE = "Saving here changes the version this date shows; Save as a new version… adds one."`
(🚧) and `momentSaveSentence(onCast: boolean): string` returning one or the other. Doc comments state the rule.
One test in `moment.test.ts`.

## Files owned

`src/lib/client/lorebooks/time/entryVersions.ts` (new), `time/entryVersions.test.ts` (new),
`editor/entrySave.ts`, `editor/entrySave.test.ts`, `time/moment.ts`, `time/moment.test.ts`.

## Rules

- No `crypto.randomUUID`, no `navigator.clipboard`. No `Set`/`Map` held in `$state` (none here: pure module).
- Comments state the rule, not the story. Sentence case in every sentence.
- No `prettier --write` on a directory or on a file you did not otherwise change; `npx prettier --check` your files.
- `NOMENCLATURE.md` R3: in code and comments say *entry version* or *version of an entry* where the bare word
  could be read as a card or cast version.
- No new socket event or server change. If a helper seems to need one, stop and report.

## Done means

Tests: the rail order (main's and the line's own at one date: own after main; a nearer line's earlier change
still wins in the fold); grouping of two rows at one date into one version (editRow = the later); `elsewhere`
(another branch; an ancestor's change dated after the fork); `versionAt` agreeing with `applyAmendments` at
several moments including now; `momentOfVersion` for each case; zones and both splits (date parts and decay to
the entry with a dated version selected; a carried keyword to the version; promoted fields written);
bounds and each sentence; `takenVersion` ignoring inherited rows; `sameEverywherePlan` with and without an
inherited carrier; `otherLinesRead`; `changesWords`; the entrySave additions with a fake socket (see the
existing `fileEntryAmendments` test). Run (one at a time; first check `ps -eo pid,args | grep -E "node.*vitest" |
grep -v grep` and wait while one runs; never pipe vitest into `head`):

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/time/entryVersions.test.ts src/lib/client/lorebooks/editor/entrySave.test.ts src/lib/client/lorebooks/time/moment.test.ts src/lib/client/lorebooks/time/momentBar.ssr.test.ts > plans/time-t4a-w2.log 2>&1"
```

All pass; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep "error TS"` shows nothing in
your files (report the total count).
