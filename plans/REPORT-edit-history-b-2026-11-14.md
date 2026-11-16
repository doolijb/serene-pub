# REPORT — build lane `edit-history-b` — edit history for card versions and cast versions (2026-11-14)

Brief: `plans/briefs/BRIEF-edit-history-b.md` (its Corrections rule). Worker briefs `-w1` to `-w3`; logs
`plans/edit-history-b-*.log`. Saved by the lead from the supervisor's final message. **Nothing was looked at in a
running app.** One migration, 0163. No SDK edit, no commit.

## Inventory (file:line as the code now reads)

**Card-version writers**, all through `updateCardVersion` (`characters/versions.ts:556`). A person's, recorded:
editor save (`saveCard`, `sockets/characters.ts:1137`), avatar upload inside a save (:1097),
`characters:setAvatar` (:2869), `characters:setLikenessImage` (`portrait.ts:235`), an applet acting for the
person (`appletLibrary.ts:233`). No author, nothing recorded: `insertCardFromColumns`, `import.ts` ~1033/~1173,
`cardFromMember.ts` ~284, `library/writes.ts` ~274 (★EH-B3), avatar uploads on create, import and share copy.
`newCardVersion` records nothing: a new version starts empty.

**Cast-version writers** funnel into `updateInPlace` (`versions.ts:1480`) from `authorWrite`, a coalesced
`storyWrite` and `editCastVersion` (:2118). A person's, recorded: the member page save
(`sockets/lorebooks.ts:2811`, through `writeMemberEdit` / `writeShownEdit`), its "change later versions" loop
(:2897), `amendments.ts` (`rewriteCastChange` :1471/:1510, `writeToLaterVersions` :1249/:1276, a dated change at
an existing key :1366). A routine's, recorded with its run: `pipelines/runtime/castMember.ts:302`. No author:
create and import paths, `narrativeGraph.ts`, `characterBindingSync.ts`, `providedBooks.ts`, `dcCairns.ts`,
`ties.ts` (node state, not a counted key), `writeCastVersionTagText`, `followCardGreetingsAfterLift`.

**Back / Forward:** Back deletes the turn's version (`state/write.ts:1058` → `retireOrTakeVersions`,
`versions.ts:1574`) and the cascade removes its history; a version a descendant session still reads is retired
and keeps its rows. Forward (`restoreVersions`, :1609) brings the version back with no history (★EH-B2).

**Wholesale deletes:** a card's versions go only with a hard-deleted card (cascade); `deleteCastVersion`, a
purged or overwritten book and removing a member go by cascade; **Share as a lorebook** clears through the
widened lorebook scope; Duplicate, starters and the timeless copy never copy the table.

**Keys recorded:** name, nickname, aliases, summary, description, personality, scenario, greetings,
exampleDialogues, postHistoryInstructions, creatorNotes, likeness, timbre, faceMediaId (no preview); a followed
field is kept as `{follow:true}`. Ignored: strokes, spriteSet, extensions, the version label, nodeState /
nodeVisibility, place columns.

**Scope key:** `characterVersionId` (a card version or a cast version alike), not the card id.

## Changed files

Server: `db/schema.ts` (`loreRedlines`); `drizzle/0163_redline_versions.sql` + meta (generated; plain ALTERs:
`entry_id` nullable, `character_version_id` FK cascade, an index, CHECK `lore_redlines_subject_check`; journal
`when` later than 0162's); `lorebooks/redlines.ts`, `characters/versions.ts`, `sockets/redlines.ts`,
`sockets/characters.ts`, `portrait.ts`, `appletLibrary.ts`, `utils/index.ts`, `sockets/lorebooks.ts`,
`sockets/amendments.ts`, `pipelines/runtime/castMember.ts`, `shared/sockets/types.ts`.
Client: `lorebooks/editHistory/{EditHistory.svelte, editHistoryCopy.ts}`,
`components/characterForms/CharacterForm.svelte` (the `versionLine` snippet), `lorebooks/CastWorkspace.svelte`
(Member tab, after `AmendmentList`), `Layout.svelte` (handled list).
Outside Files owned, additive lines the new events need: `shared/sockets/interest.ts`,
`client/sockets/typedSocket.ts`, `shared/sockets/scopedReplies.test.ts`, `shared/sockets/gatedEvents.test.ts`.
Docs: `docs/characters.md`, `docs/lorebooks.md`, `NOMENCLATURE.md` (`redline` row for three subjects, `lore_`
⚠ provisional, §25).

## Tests

New: `db/redlineVersions0163.int` (a second boot changes nothing), `characters/versions.redlines.int`,
`sockets/characterVersions.redlines.int`, `editHistory/editHistoryVersion.dom`. Supervisor's grouped run: 18
files, 206 tests pass (`plans/edit-history-b-sup-final.log`); worker 3's regressions: 546 pass; `tsc` 0 errors.
Not covered: the retire-and-copy restore's reply fix; a mounted fold inside either screen.

## Names, events, sentences (all 🚧)

Names: `recordVersionRedline`, `versionWireValues`, `VERSION_REDLINE_KEYS`, `moveVersionRedlines`,
`RedlineScope {characterVersionId}`, `VersionRedline`, a `redline` option on `updateCardVersion` /
`writeCastVersion` / `updateCastVersion`, `saveCard`, `restoreCardFace`, `RedlineView.{beforeFollows,
afterFollows, noPreview}`, `Sockets.CharacterVersions`. Events: `characterVersions:redlines`,
`characterVersions:restoreRedline`, `characterVersions:clearRedlines` (+ `:error`, handled). Sentences: *Clear
this version's edit history?* · *Removes its ‹n› edits. The version stays as it is now; what it said before can
no longer be restored.* · *(follows the card)* · *‹label›: changed* · *Save or discard your changes first.* ·
*‹label› is no longer part of a character profile.* · *That picture is no longer kept.*; the book-wide and
pub-wide clear sentences and the Admin card now name entries, cast members and cards. Label: **Clear edit
history…** at the end of a version's open fold.

Supervisor's fix after its own review: a cast Restore that retired and copied the version replied with the
copy's id; it now replies with the id asked about and sends the list for both.

## Open ★

- ★EH-B1 history moves to the copy on retire-and-copy (lead's decision; tested).
- ★EH-B2 Forward brings a version back without its history.
- ★EH-B3 a pipeline's library write to a card records nothing.
- ★EH-B4 the narrative graph build's fill-blank summary on a member's base records nothing.
- ★EH-B5 the version fold's own Clear button and its placement.
- ★EH-B6 Restore is off while the form has unsaved changes.
- Lane A's ★1 (the table's name) now includes the `lore_` prefix. All copy.

## Noticed, not done

`docs/system-settings.md` still says "earlier versions of entries"; `tableRegistry`'s `lore_redlines` spec
counts and purges by entry only (cast rows go by cascade); the coalesced story write's retire-and-copy branch
records nothing and moves nothing; the editor's restore refresh assumes the `characters:update` reply arrives
before the `restoreRedline` reply; one worker's single-file `prettier --write` reformatted 62 unrelated lines of
`layoutHandledErrors.test.ts`.

## Scope review and lead follow-up (2026-11-14)

Scope review: in scope; the migration, the recording, the limit, authorisation on the three events (a guessed
`characterVersionId` is refused), the sockets rules and "never travels" all check out; the four files outside
Files owned hold only the additive `characterVersions:*` lines the registry tests need (accepted). Fixed by the
lead: **a cast Restore now runs the member page's own refusals** (`castRestoreProblem`, `sockets/redlines.ts`):
a provided book keeps its cast's names and faces; a face must be a picture the member may wear; a voice is the
asker's to pick (`validateTimbre` with `canPickVoice`). One test added (a face the member may not wear).
`docs/system-settings.md` corrected. `tsc` 0 errors. Left: ★EH-B7 a cast version's Restore is the lorebook
owner's alone, as for entries, though the member page's save also admits a session's people on its notes; the
two reflowed hunks in `layoutHandledErrors.test.ts`; no test of the retire-and-copy Restore reply.

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
