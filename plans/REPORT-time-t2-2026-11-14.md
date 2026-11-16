# REPORT — build lane `time-t2` — an entry's Beginning and Decay (2026-11-14)

Brief: `plans/briefs/BRIEF-time-t2.md` (its Corrections rule). Worker briefs `BRIEF-time-t2-w1.md` to `-w3.md`;
logs `plans/time-t2-*.log`. Saved by the lead from the supervisor's final message. **Nothing was looked at in a
running app.** One migration, 0162. No SDK edit, no `sdk:build`, no commit.

## Step A (line numbers from before the edits)

1. Only History could hold a date. For any other type the date parts were dropped in `utils/lorebookEntries.ts`
   (`entryInsert` ~375, `splitUpdate` ~708, `toEntryRow` ~279); the date checks sat behind `roles.order`
   (`sockets/entries.ts` ~1033 create, ~1276 update). A pipeline cannot send a date part to a non-history type
   (`typedFieldsOf`, host ~2136, refuses undeclared keys).
2. Readers that already cut any dated row: `entryOnReadingSql` (`state/entriesOnReading.ts:69`, through
   `historyDateColumns`, `state/lineSql.ts:104`; used by prompt lore `ragContext.ts:553`, `supply.ts:99`,
   `entriesAsRead` :241, `host.ts:5309`); the session entry list (`entries.ts` ~1609) and per-type counts
   (~2227); the client's fork cut (`rowDate`, `LorebooksWorkspace.svelte:544/571`). Did not: the workspace
   dimming (`EntryWorkspace.svelte:540`, fixed here); `LorebooksWorkspace.svelte:1120` (the "not yet" count) and
   `:2387` (moment ticks), still History only (not owned).
3. "Has a date" read as "is history": `time/TimeLens.svelte:149` (every dated row is a sibling for History's
   `editBounds`); `sockets/pipelines.ts:4974` (`datedTitle`); `storyTime.ts:117` (date as a fallback label).
   Everything else keys on the History type, `roles.order` or `historyEntryId`.

## Changed files

- Storage: `db/schema.ts` `decayRate` (`real("decay_rate")`, NOT NULL, default 0); `drizzle/0162_entry_decay.sql`
  (generated; journal `when` later than 0161's).
- Shared: `shared/lorebooks/amendments.ts` (`clampDecayRate`, `decayRateProblem`, `amendmentDecayProblem`,
  `EntryTimeWire`; `decayRate` in `NEVER_AMENDED`); `shared/sockets/types.ts` (`Partial<EntryTimeWire>` on the
  entries create and update params; `timelineCounts.beginnings`).
- Server: `utils/lorebookEntries.ts` (`takesBeginning`, `beginningProblem`; date parts and rate through insert,
  update, read); `sockets/entries.ts` (`assertBeginningHolds`: calendar landing and the earliest dated change;
  `assertTimelineForBeginning`; `assertRedateKeepsLines`; History's one-per-date rule not applied to
  Beginnings); `sockets/amendments.ts` (decay refusal in `cleanFields`; `assertAtOrAfterBeginning` on create and
  move); `lorebooks/timeline.ts` (`beginnings` count; `holdsSomethingDated` counts them);
  `lorebooks/redlines.ts` (`redlineKeysOf`, `entryWireValues` count both); `lorebooks/timelessCopy.ts` (drops
  each Beginning, keeps decay); `utils/lorebookExportMapper.ts` (`importedBeginningAndDecay`);
  `sockets/lorebooks.ts` (the import insert). Duplicate and the export builder needed no change.
- Client: new `lorebooks/time/BeginningDecayRow.svelte`, mounted in `sections/EntryAdvancedFields.svelte` for
  every type but History; `EntryWorkspace.svelte` (`dimmedKeys` covers any dated entry);
  `time/TimelineCard.svelte` (the count).
- Docs: `docs/lorebook-time.md` ("Beginning and decay"; lines in "What you won't see", "Setting the switch");
  `docs/lorebooks.md`; `NOMENCLATURE.md` (§8 rows **Beginning**, **Decay** with charters, the R1 collisions and
  qualified forms; the Timeline row's counts; §25).

## Tests

New: `db/entryDecay0162.int` (a second boot changes nothing), `sockets/entries.beginningDecay.int`,
`sockets/amendments.beginning.int`, `state/beginningReading.int`, `lorebooks/redlines.beginningDecay.int`,
`sockets/lorebooks.beginningDecay.int`, `time/beginningDecayRow.dom`, `entryWorkspace.beginning.dom`. Cases
added to `timelessCopy.int`, `lorebookExportMapper.test`, `entryAdvancedFields.dom`, `storyTime.test`,
`timelineCard.dom`. Supervisor's grouped run: 19 files, 280 of 280 pass (`plans/time-t2-sup-1.log`); `tsc` 0
errors. The Time lens draws a dated world lore entry as `kind: "world"`, labelled with its name.

## Names, labels and sentences added (all 🚧)

`decay_rate` / `decayRate`, `beginnings`; file keys `year`, `month`, `day` (non-history) and `decayRate` (only
above 0) in the entry's `extensions.serenepub`; no format version change. Labels **Beginning**, **Perpetual**,
**Began at**, **Decay**, **Fact**, **Living**; aria *Decay rate*, *Beginning and decay: ‹values›*. Collapsed:
*Perpetual · Fact*, *Began at ‹date› · Living · 0.25*; Timeline off: *Decay: Fact*. Help: *The entry is not read
before this date.* · *Stored now; recall does not use it yet.* Card: *‹n› entry/entries with a beginning*.
Refusals: *Decay is a number from 0 to 1.* · *A dated change can't change an entry's decay: the decay is part of
the entry, so changing it means changing the entry itself.* · *A beginning needs a year.* · *A beginning's year,
month and day are whole numbers, and the month and day start at 1.* · *A beginning with a day needs a month
too.* · *This entry has a change dated ‹date›, so it can't begin later, at ‹beginning›. Move or delete that
change first.* · *This entry began at ‹beginning›, so a change can't be dated ‹change date›, before it. Date the
change at or after ‹beginning›.*

## Open ★

- ★T2-1 (lead's decision) with the Timeline off, a line's fork cut still applies to an entry with a Beginning.
- ★T2-2 the help lines drop the "Beginning:" / "Decay:" prefixes (the legend says them).
- ★T2-3 with the Timeline off the server refuses setting a Beginning (*This lorebook has no timeline, so nothing
  dated is written to it.*); clearing one is allowed.
- ★T2-4 a History entry also takes a decay (one number on every entry); the "no change before the Beginning"
  rule is not applied to History.

## Queued for files outside the lane

1. `shared/entries/types.ts` `EntryColumns`: add the `EntryTimeWire` members.
2. `utils/lorebookImportMapper.ts` `mapImportedEntry` should return `importedBeginningAndDecay` (until then
   provided books carry neither value).
3. `sockets/redlines.ts` `labelOf`: the edit history shows raw keys `decayRate`, `year`.
4. `TimeLens.svelte:149`: limit the siblings to History.

## Noticed, not done

`LorebooksWorkspace.svelte` :1120 / :2387 History only; `CastWorkspace.svelte:359` does not fork-cut dated
character lore on the client; `datedTitle` (`pipelines.ts:4974`); `assertRedateKeepsLines`' refusal says
"history entry" when a Beginning moves; a session's writes through the host or `ownBook` are not checked against
a Beginning (lane T5); `GenericEntryEditor` gets no row; several existing files fail `prettier --check`.

## Scope review and lead follow-up (2026-11-14)

Scope review: in scope; the migration is the one column; readers untouched; nothing reads `decayRate`; no SDK
surface, setting or event. Fixed by the lead (17 files, 222 tests pass, `plans/time-t2-lead-1.log`):
1. **A first Beginning now runs the line check** (`assertRedateKeepsLines`, `sockets/entries.ts`): a line forked
   earlier that links to the entry would have lost it. Test added. Its refusal still says "history entry".
2. The row's bare `living` identifiers renamed (`rateAboveZero`); labels unchanged.
3. **Time lens:** a history entry's re-date hint is bounded by history entries only
   (`TimeLens.svelte`, `siblings={dated.filter(isDatable)}`).
4. Queued item 3: the edit history labels the new keys (*Decay*, *Beginning: year / month / day*).
Left: two reflow-only hunks in `lorebookExportMapper.ts`; the row shows for every non-history type while the
server's test is "the type declares no date of its own" (no shipped ruleset type declares one); queued items 1
and 2 (no provided book carries either value today).

## Grouped verification (lead, 2026-11-15) — `time-t2`, `edit-history-b`, `time-t4a`, `time-t4b` together

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings); `npm run build` passes (it compiles the docs: two links
to the renamed heading were repointed to `#versions-of-an-entry` after the other session's build caught them).
Full `vitest run` (`plans/evening-lead-full2.log`): 2467 files, 2440 pass, 26 fail; 25,926 tests pass, 33 fail.
**None of the 26 is these lanes'**: 19 are the known baseline (unchanged since `timeline-b`); four are the other
session's (`sessionForms/editSession{Bench,CastMembers,SaveParity}.dom`, `startSessionCast.dom`: its lazy
character picker; confirmed by it); two are environment (`audiocpp/packages.v.int`, `net/hfDownload.v`: a temp dir
in a scratchpad the reboot cleared); one is flaky under load and passes alone (`media/avatarPicker.dom`). An
earlier, interrupted run had shown one of ours, `lenses/readOnlyLenses.dom` (a closed `VersionDateDialog` drew its
Save button for a reader): fixed, and green in this run. `sdk:test` not rerun: no SDK file changed in these lanes.
