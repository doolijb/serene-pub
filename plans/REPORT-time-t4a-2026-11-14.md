# REPORT — build lane `time-t4a` — an entry's versions on a timeline rail (2026-11-14)

Brief: `plans/briefs/BRIEF-time-t4a.md` (its Corrections rule). Worker briefs `-w1` to `-w7`; logs
`plans/time-t4a-*.log`. Saved by the lead from the supervisor's final message. Parts 1 and 2 are built.
**Nothing was looked at in a running app.** No migration, no SDK change, no new socket event, no commit.

## Inventory (line numbers before the edits)

1. Draft at a moment: `LorebooksWorkspace` `resolveRows` (:557) folds `entryAsOf` at `amendmentsAt` (:596) →
   `resolvedByKind` (EntryWorkspace:413) → `sourceByKey` (:509) → `toDraft` (~1530–1545). A clean draft follows
   the reading (:1523); a dirty one kept its moment (`draftMoment`, :1055–1059). **Save** = `save()` (:1337),
   `entries:update` with the `changedFields` diff, plus the masked-base warning (:1305). **Save as of** =
   `saveAsAmendment` (:1178) → `amendments:create` at `draftMoment` on `route.branch`. **Change the base** =
   `save()` from the split menu (:2142–2155). `AmendmentList`: every line's changes, this line's first; the *not
   yet* count; re-date (`amendments:update`); delete; *Not read on ‹line›*; no place / unplace. Moment setter:
   none handed as a prop; the form uses `loreRoute.set(reduce(route, {type:"setMoment"}))`, the call the moment
   bar's own `setMoment` makes (LorebooksWorkspace:1735).
2. `cleanFields` (sockets/amendments.ts:946–1004) refuses date parts and `decayRate`, drops `NEVER_AMENDED`;
   everything else may be carried, including keys, constant, enabled, archived, anchorEntryId.
3. Server: create (:1630–1708) inserted with no check; re-date (:1770ff) had no taken-date check; no unique
   index; `assertAtOrAfterBeginning` (:1599) runs on both.
4. `RedlineView.amendmentId` is on every row `entries:redlines` returns: grouping needs no new request.
5. `AmendmentList` mounts: EntryWorkspace:2300, CastWorkspace:1961 (unchanged). The cast page's own Save as of
   (CastMemberForm:1928) untouched.
6. The rail shows for world lore, character lore, item, place, derived and generic entries (generic now gets the
   entry row too). History has dated changes (compile) and gets no rail; scenes have none.

## What each replaced control's job became

- **Save as of ‹date›** → **Save** (the version in force) and **Save as a new version…** / **+ Add a version
  here**.
- **Change the base** → Save on *From the beginning*; entry-zone fields save to the entry while any version
  shows.
- ***Amendments* list** → the rail: re-date → **Change its date**; delete → **Delete this version** (the
  confirmation says its edit history goes too); other lines' changes → **Elsewhere**; the *not yet* count →
  later versions stay visible on the rail.
- History keeps all three unchanged.
- "A dirty draft keeps its moment" → on a railed entry, a moment move that would change the version asks once
  (keep editing / discard); the form asks after the move and puts the moment back on Stay.
- Rail order and fold come from `amendmentsOnLine`, stably sorted by date; two stored rows at one date make one
  version, and editing it edits the later row.
- Server: a create at a date the line already has merges into that row and records an edit-history row; a
  re-date onto a taken date is refused.

## Changed files

Server: `sockets/amendments.ts` (`ownChangeAt`, merge, refusal); new `sockets/amendments.oneVersion.int.test.ts`.
Client (`src/lib/client/lorebooks/`): `EntryWorkspace.svelte`, `sections/EntryCoreFields.svelte`,
`sections/EntryAdvancedFields.svelte`, `time/BeginningDecayRow.svelte`, `editHistory/EditHistory.svelte`,
`editor/entrySave.ts`, `time/moment.ts`; new `time/VersionRail.svelte`, `time/VersionDateDialog.svelte`,
`time/entryVersions.ts`, `time/versionZones.ts`; new tests `entryWorkspace.versions.dom`, `time/versionRail.dom`,
`time/versionDateDialog.dom`, `time/entryVersions.test`, `time/versionZones.test`, `sections/entryZones.dom`
(+ `sections/EntryZonesFixture.svelte`); extended `entrySave.test`, `moment.test`, `beginningDecayRow.dom`,
`editHistory.dom`.
Docs: `docs/lorebook-time.md` ("Versions of an entry" in place of "Amendments"; old anchor kept),
`docs/lorebooks.md`, `NOMENCLATURE.md` (§8 **entry version**; amendment and base rows; §23; §25),
`STYLE-GUIDE.md` (§6.1 example moved to the cast form; §6.14 exception; §6.19 version rail).

## Tests

Final targeted run: 36 files, 379 tests pass (`plans/time-t4a-sup-final.log`); `tsc` 0 errors. No test removed
(History still uses every replaced control). svelte-check was not run by the lane.

## Names, labels and sentences added (all 🚧; full list in NOMENCLATURE §25)

Labels: **Save as a new version…**, **+ Add a version here**, **Change its date**, **Delete this version**,
**Open on ‹line›**, **Elsewhere**, **Edits**, **Versions**, **Change from this version…**, **Make it the same
everywhere**, **Make it the same**. Phrases: *differs by version*, *From the beginning*, *This version begins
‹date›*, *‹line›'s version from ‹date›*, *from ‹line›*, *changes ‹fields›*, *On ‹line› · Perpetual · Fact*,
*Edits to this version · ‹n›*. 18 sentences, among them the refusal *This entry already has a version dated
‹date› on this line. Pick another date, or change that version instead.* Browser key
`serene.lore.versionEdits`.

## Open ★

- ★T4A-1 *From the beginning* on a Perpetual entry moves the moment to the year before the first version.
- ★T4A-2 History keeps Save as of, Change the base and `AmendmentList`; `amendmentDateToast` not rewritten (its
  only caller is History's Save as of, where "Change the base" still exists).
- ★T4A-3 A version stored as two rows at one date cannot be re-dated (*Saved more than once at this date…*).
- ★T4A-4 **+ Add a version here** with no edits creates a version that changes nothing, to be edited next.
- ★T4A-5 Layout: the entry area at the top (the row, then the entry-held fields); railed, Pinned and Off leave
  the ⋯ menu; the narrow breakpoint is 36rem; a "Versions" heading; the whole-warning sentence under the header.
- ★T4A-6 On a fork reading main's entry, the entry and *From the beginning* are read-only; **Change from this
  version…** stays live for the fork's own version.

## Queued for files outside the lane

1. `time/MomentBar.svelte`:126 should use `momentSaveSentence(onCast)`.
2. `docs/coming-from-sillytavern.md`:125 and `docs/summarization.md`:97 should link `#versions-of-an-entry`.
3. `AmendmentList.svelte` could import `CHANGE_LABELS` / `changesWords` (duplicated today).

## Noticed, not done

A railed entry sends one `entries:redlines` ask per version row plus the fold; if the entry write fails after the
version write has landed the draft stays dirty (a retry is harmless); a dated version exactly at the Beginning's
date makes *From the beginning* unselectable; workers ran `prettier --write` on five files they changed.

## Scope review and lead follow-up (2026-11-14)

Scope review: no objection on scope (no file outside Files owned; every name in §25; no event, migration or
setting). Save is data-safe (a middle version sends `amendments:update` with only its own fields plus the diff,
and entry-zone keys to `entries:update`; *From the beginning* sends one `entries:update`); the zones test "carried
by a dated change" on the line being read; the server merge and refusal run under the book's lock on `tx`; no
moment loop. Fixed by the lead (23 files, 223 tests pass, `plans/time-t4a-lead-1.log`):
1. **A version's edit rows went stale after Save** (the list re-asked only when the entry's own `updatedAt`
   moved): the fold now re-asks on a token of the entry's and its dated changes' save times.
2. **One ask per entry, not one per version row**: rows under a version ask nothing; the form's one fold asks and
   its reply fills every mount through the shared key (was 11 + 2E asks for 10 versions and E Elsewhere rows).
3. svelte-check errors: `VersionRail`'s `edits` snippet was not declared in its props; `CharacterForm`'s restore
   refresh passed a possibly-undefined id (lane edit-history-b).
4. Queued item 1: `MomentBar` takes `onCast` and says the entry sentence off the Cast board.
Left: four format-only hunks in `editor/entrySave.ts` and its test; the unused third parameter of
`updateEntryAmendment`; ★T4A-2 stands (History keeps the old controls and their toast); queued items 2 and 3.

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

## Walk with a model on a copy of the owner's data (lead, 2026-11-15)

Copy of the dev database (deleted after), booted on its own port; migrations 0160–0163 and the boot passes ran
clean from 0.6.0-pr-7; the one-time `timeline-switch` pass changed nothing (5 lorebooks keep a timeline, 0 do
not). Played with the local model: a Story session with no clock (messages show real time) and a timelined Story
session reading its lorebook (the clock moved 5 minutes, *Time passes: 5 minutes (… 08:00 → … 08:05)*). With the
lorebook's Timeline switched off mid-session: no story time, the clock did not move, no *Time passes* line, the
turn played and the after-round step ran; switched back on, the clock read 08:05 again.

**Found and fixed:** after **Save as a new version…** landed, the form asked *Discard unsaved changes?* — the
save itself changed the version in force before the draft settled, and the moment guard took that for a
navigation. The guard now lets a save in flight carry the draft to the new version (`EntryWorkspace.svelte`).
Confirmed on a second entry; the lane's DOM tests still pass.

**Seen, not changed (for the owner):**
1. **The entry form's layout (★T4A-5).** Keywords, Part of, Pinned and Off, each with its own *Change from this
   version…* link, sit above the rail and push Name and Content below the fold on a 1050 px tall window.
2. **The Chronicle with the Timeline off (★T-C6)** still shows *No date yet*, **Move the clock…**, **Follow the
   line's present**, the open scene's *since Friday, 2 March, Year 1*, and a **Now** block with the history day.
3. The **Save as a new version** dialog opens empty while reading "now", though the story's present is known.
4. The inspector under an entry says *No session is reading this book* while the header says *Read by New
   session* (not this lane's).
Not walked: the cast member page's rail on real data, the Summarize modal, edit-history rows after a routine's
write, the timeless copy on real data.
