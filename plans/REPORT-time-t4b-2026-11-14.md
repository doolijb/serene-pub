# REPORT — build lane `time-t4b` — a cast member's versions on the timeline rail (2026-11-14)

Brief: `plans/briefs/BRIEF-time-t4b.md` (its Corrections rule). Worker briefs `-w1` to `-w6`; logs
`plans/time-t4b-*.log`. Saved by the lead from the supervisor's final message. Parts 1 and 2 are built.
**Nothing was looked at in a running app.** No migration, no new socket event, no SDK change, no commit.

## Inventory (line numbers before the edits)

1. The form drew the resolved row (`CastWorkspace` `selectedRow` :371, through `resolveCast` → `castAsOf` over
   `amendmentsOnLine`). **Save** → `saveMember` (:1051) → `lorebooks:updateBinding`, always `onto:"shown"`, the
   version in force at the book's present (`sockets/lorebooks.ts` :2812). **Save as of** → `amendMember` (:1070) →
   `amendments:create` at `memberMoment`. **Change the member** (`CastMemberForm` :1996) = Save. "Change later
   versions too" (:1886–1906) sent `changeLaterVersions`. `AmendmentList` (:1961): re-date, delete (session
   versions too), other lines' versions, the *not yet* count. The Timeline tab lists scenes; it stays.
2. Server: `buildAmendmentsList` (:310) sent non-base versions with no base id, write order or source. Create →
   `writeCastChange` → `authorWrite` (updates in place at the same key: line, date, life point, person;
   `versions.ts` :1771–1810); edit → `rewriteCastChange`; re-date refused at a taken key (:2163–2191); delete →
   `deleteCastVersion` (:2347). One version per key was already enforced: no refusal added.
3. One rail serves both: generic over `RailVersion` / `RailElsewhere`, writes as callbacks; the entry form passes
   its own (behaviour unchanged).
4. Jobs: Save as of → **Save as a new version…** / **+ Add a version here**; Change the member → Save on *From
   the beginning*; re-date → **Change its date**; delete → **Delete this version**; other lines' versions →
   **Elsewhere** / *from ‹line›* + **Open on ‹line›**; the *not yet* count → later versions stay visible;
   deleting a session's version → none (read-only, ★T4B-6).

## Built

- Server: `CastRowVersion.baseVersionId`; `UpdateBinding.Params.castVersionId` (only the base's id is accepted
  and writes the base; absent, the save writes the version at the book's present as before);
  `Amendments.CastRow.writeOrder`, `sourceSessionId`, `sourceSessionName` (the name only when the asker may open
  the session, `checkSessionAccess`).
- Rail: order and *read at this date* from `versionInForce`; one node per version even at a shared date;
  selecting moves the moment bar; a pick that is not the version in force at its date stays selected while its
  moment holds; a change of version with unsaved edits asks once; a session's version is locked; inherited
  versions read-only; narrow strip; Timeline off unchanged; a reader selects and saves nothing.
- Save writes the selected version: the base through `updateBinding` with `castVersionId`; a dated version
  through `amendments:update` with its own `fields` plus the diff. Own name, nickname and voice always go
  untargeted (★T4B-2).
- Edit history: rows under the selected version only, one ask; a narrow fold inside the rail; a token refreshes
  rows after a save.
- Moment bar: one `MOMENT_SAVE_SENTENCE` for entries and cast; `ENTRY_MOMENT_SAVE_SENTENCE`,
  `momentSaveSentence` and `onCast` removed.
- Removed: Save as of, Change the member, the split button, `onAmend` / `amendMember`, the cast `AmendmentList`
  mount (`AmendmentList.svelte` stays for History).
- Supervisor's fix: `castTakenAt` returned null for a new version, so the dialog never said a date was taken.

## Changed files

Server: `shared/sockets/types.ts`, `server/sockets/lorebooks.ts`, `server/sockets/amendments.ts`, new
`server/sockets/castVersionRail.int.test.ts`. Client (`src/lib/client/lorebooks/`): `CastWorkspace.svelte`,
`cast/CastMemberForm.svelte`, `castPool.ts`, `cast/castSave.ts`, `cast/castVersionRead.ts`, new
`cast/castVersions.ts`, `time/VersionRail.svelte`, `time/VersionDateDialog.svelte`, `time/entryVersions.ts`,
`time/moment.ts`, `time/MomentBar.svelte`, `EntryWorkspace.svelte` (the rail mount and two write functions),
`LorebooksWorkspace.svelte` (one attribute). Tests: new `cast/castVersions.test.ts`,
`cast/memberPageRail.dom.test.ts`; changed `castSave.test`, `castVersionRead.test`, `memberPageVersions.dom`,
`castMemberForm.dom`, `castMemberFormLater.dom`, `castMemberFormTimelineOff.dom`,
`castWorkspace.timelineOff.dom`, `versionRail.dom`, `entryVersions.test`, `moment.test`. Removed with their
controls: `castMemberForm.dom` "reading a moment: a dirty own name disables the dated save";
`castMemberFormLater.dom` "reading a moment: the line counts Save as of…". Docs: `docs/lorebook-cast.md` (not
named in the brief; where the member page is described), `docs/lorebook-time.md`, `docs/lorebooks.md`,
`NOMENCLATURE.md` (§8, §23, §25), `STYLE-GUIDE.md` (§6.1, §6.14, §6.19).

## Tests

Supervisor's final run: 9 files, 189 pass (`plans/time-t4b-sup-final.log`); workers' runs pass (20 cast and time
files; `lorebooks.castVersions.int` 17, `amendments.castVersions.int` 42, `amendments.oneVersion.int` 5); `tsc`
0 errors; `npm run check` 0 errors.

## Names, labels, sentences (all 🚧; listed in NOMENCLATURE §25)

Chip and label words: *read at this date*; *written in ‹session›* / *written in a session*; *at ‹n› in their
life*; *at every point in their life*; field words *the name in this book*, *the nickname in this book*, *the
voice*. Sentences: *Delete the version dated ‹when›[ on ‹line›]? From then on ‹name› reads as the version before
it, and this version's edit history goes with it.* · *This version is ‹line›'s; open it on ‹line› to change it.*
· *A session wrote this version, so it is changed from that session.* · *Change something first: a version holds
what differs from the one before.* · *The version could not be saved.* · *Saved as a new version at ‹date›[ on
‹line›]* · refusal *That version can't be saved here: only this cast member's first version is saved from the
member page.* Code names: `RailVersion`, `RailElsewhere`, `CastVersion`, `CastElsewhere`, `castVersions`,
`castVersionChip`, `castVersionAt`, `castTakenAt`, `castLaterCount`, `UNDATED_MEMBER_KEYS`, `castVersionSave`,
`castNewVersionSave`, `castChangesWords`, `castDeleteSentence`, `rowAtVersion`, `updateCastAmendment`,
`fileCastVersion`, `deleteCastAmendment`.

## Open ★

- ★T4B-1 Card Change / Unlink: while reading at a moment they are dated from that moment (as before this lane),
  not "from the book's present" as correction 1 said; kept as it was.
- ★T4B-2 Own name, nickname and voice save to the version at the book's present whichever version is selected
  (a dated change cannot carry them); the form shows the present's values for them.
- ★T4B-3 Adding a version needs an edit first (the server refuses a cast version that changes nothing); differs
  from entries (★T4A-4).
- ★T4B-4 On a fork, *From the beginning* is main's and read-only; **Save as a new version…** adds the fork's own.
- ★T4B-5 If the page opens on a session-written version at the present, Save is off (before, Save wrote it and
  the server retired and copied it).
- ★T4B-6 A session's version can no longer be deleted from the member page.
- ★T4B-7 the chip words. ★T4B-8 *From the beginning* moves the moment to the year before the first version.

## Noticed, not done

The workspace's client reader (`castAsOf` over `amendmentsOnLine`, line first) and the server's `versionInForce`
(date first) can disagree on a fork: the rail and form follow the server; the roster, lists and resolver still
use the client fold. The old Save as of silently dropped voice edits. The stored cast row has no `updatedAt`:
the base version's edit rows refresh only after this page's saves. `laterVersionCount`'s `amend` kind is unused.
One worker cleaned its temp dir with a prefix glob unique to its test file.

## Scope review and lead follow-up (2026-11-14)

Scope review: no objection on scope; the new save target is safe (`castVersionId` is checked to be this member's
base in a lorebook the asker owns before any write, and the write uses `onto:"base"`, never the client's id); the
session's name is sent only to an asker who may open it; a dated version saves its own fields plus the diff; the
entry form's rail sends what it sent. Fixed by the lead (56 files, 693 tests pass, `plans/time-t4b-lead-1.log`;
`tsc` and `npm run check` 0 errors after):
1. **★T4B-6 was a regression with no workaround** (nobody could delete a cast version a session wrote): **Delete
   this version** is back on a session-written version, on the rail and under **Elsewhere**; it still cannot be
   edited or re-dated from the page. The lock sentence is now *A session wrote this version: it can be deleted
   here, not edited.* 🚧 Tests updated.
2. **★T4B-2 made visible:** while a version other than the present's is shown, the form says *Name, nickname and
   voice are the same at every date: saving them changes this member as the lorebook reads them now.* 🚧
3. **The moment bar's one sentence** is now true for entries, cast members and history entries: *A save here
   changes what this date shows.* 🚧
4. *From the beginning* on a member with no first version has Save off, with *This cast member has no first
   version to save; save a new version instead.* 🚧
Left: a save that writes a version and then the undated fields can half-land (the toast then says nothing was
saved); ★T4B-5 stands (the page opening on a session-written version has Save off).

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
