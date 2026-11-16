# REPORT — build lane `notes-unlisted` — a session's notes are never listed, counted or named as a lorebook (2026-11-13)

Brief: `plans/briefs/BRIEF-notes-unlisted.md` (its "Corrections from the cold review" rule). Worker briefs
`plans/briefs/BRIEF-notes-unlisted-w1.md`, `-w2.md`, `-w3.md`. Owner (2026-11-13): "My main complaint is now we are
listing phantom lorebooks everywhere"; "Phantom lorebooks shouldn't get a name, that are properties of a season
[session] until the user decides to surface it"; all four leaks fixed; Session notes section "Only notes with
something in them, collapsed".

**Nothing was looked at in a running app.**

## The rule as built

Helper: 🚧 `sessionNotesName(sessionName)` (`src/lib/shared/lorebooks/sessionNotes.ts`) → `‹name›'s notes`, else
`Session notes`. Server: 🚧 `bookShownName(db, {name, sessionId})`, 🚧 `bookShownNames(db, books)`
(`src/lib/server/lorebooks/notesShown.ts`): a real book gets its name, a notes book the helper over the session's
name read at the time. The stored `lorebooks.name` is never read for display and never written. No migration.

| Place | Rule built |
| --- | --- |
| `lorebooks:sessionNotes` | Every row still sent, plus 🚧 `notesWritten`. |
| Lorebooks view › **Session notes** | Draws only `notesWritten` rows. The heading is a disclosure button with the drawn count; collapsed on every load (state in the component only). Search matches the session's current name and opens the section. Row title = session's current name, else `Untitled session`. Unwritten rows stay in `knownBooks`, so a route to their id opens them (tested). |
| Opened notes book | Title, header label, Book settings header, Delete line and Duplicate prefill use the helper. No **Name** field for notes. Delete and Duplicate still offered, unchanged. |
| `lorebooks:bindingsForCharacter` | `lorebooks` (the export dialog's list) never holds notes. `members` keeps notes members with 🚧 `ownBookSessionId` and `lorebookName` = *‹session›'s notes*. |
| Card cast line | The lead *In N lorebooks:*, *Represents…*, *retells…*, book links and card-update offers leave notes members out. The editing sentence keeps them (P1). |
| Characters view | Card rows: `lorebookCount` counts real lorebooks; 🚧 `notesCount` counts notes books. Lines: *Not in a lorebook yet* · *In ‹book›* · *In ‹session›'s notes* · 🚧 *In the notes of N sessions* · *In N lorebooks*. Member rows unchanged. |
| Admin › Rulesets *Played by* | Counts lorebooks with `session_id IS NULL` only. `versions.ts` refusal wording: 🚧 *N lorebooks or sessions' notes*. |
| Activity labels and queues | `indexingActivity`, `narrativeGraph` (graph build, cast-tag queue), `scenes.ts` (compile, scene summary), `sweptRelationships`, `castLiftNotes` use the server helper. |
| Importer `findLorebookId`; tags related data | Notes left out. |
| `session-entries` widget `bookName` | **Not done** (`sockets/entries.ts`, held by another lane). |

## "Written notes", exactly (`writtenNotesOf`)

Notes are **written** unless they hold nothing beyond the base versions of members a seat points at. Written: a row
by `lorebook_id` in `lorebook_entries`, `entry_amendments`, `cast_amendments`, `cast_presences`,
`narrative_relationships`, `scenes`, `lore_imprints`, `lore_sources`, `lorebook_branches`, `binding_merge_logs`,
`dismissed_duplicate_pairs`; `annex <> '{}'`; `extra_json.ruleFed`; any `story_clock_*` set; an attribute value or
config of the book or a member; a member with `overlay_of` or that no seat (`session_characters` /
`session_personas` `cast_member_id`) points at; a member's version with `branch_id`, `year`, `personal_position`,
`source_session_id`, `retired_order` or `written_by` set. Bookkeeping, not written: `sessions.lorebook_id`, tags,
shares, `binding_suggestions`, `characters.lorebook_id`. Proved through the real `sessions:create` and seat paths
(`notesShown.realCreate.int.test.ts`).

## Where a notes member is updated from now

Its own page inside the notes (`CastMemberForm.svelte` ~1627 draws the card-update offer), opened from the
session's cast panel, a message's name, or a seat's member link in the edit form. Unwritten notes open through
those paths. The Dungeon Crawler doc line stays right (a crawl's notes hold scenes).

## Copy, verbatim (all 🚧)

`‹name›'s notes` · `Session notes` · `Untitled session` · `Book settings · ‹name›'s notes` · `‹name›'s notes
options` · menu title `Cover, rules, calendar and clock` (was `Name, cover, …`) · `‹name›'s notes cover` · `In the
notes of N sessions` · `In a session's notes` (unchanged) · `Editing this changes ‹member› in ‹session›'s notes …`
· `Version V of 'R' is played by …; publish it as a new version.` with `1 lorebook or session's notes` / `N
lorebooks or sessions' notes`.

## Changed files

Shared: `shared/lorebooks/sessionNotes.ts`; `shared/sockets/types.ts` and `shared/characters/characterRows.ts`
(**outside the owned list**, additive: `notesWritten`, `ownBookSessionId`, optional `notesCount`).
Server: new `lorebooks/notesShown.ts` (+ `notesShown.int.test.ts`, `notesShown.realCreate.int.test.ts`),
`sockets/lorebooks.ts`, new `sockets/lorebooks.notesUnlisted.int.test.ts`, `sockets/import.ts`, `tags.ts`,
`narrativeGraph.ts`, `scenes.ts` (label lines), `embedding/indexingActivity.ts`, `admin/castLiftNotes.ts`,
`sessions/sweptRelationships.ts`, `rulesets/pubRulesets.ts`, `rulesets/versions.ts`, `cast/characterRows.ts`, tests.
Client: `lorebooks/LorebooksWorkspace.svelte`, `components/listItems/LorebookListItem.svelte`,
`lorebooks/BookSettings.svelte`, `components/lorebookForms/EditLorebookForm.svelte` (prop `notesName`),
`characterForms/castBannerWords.ts`, `CastLine.svelte`, `sidebars/characterRowsView.ts`, tests, new
`lorebooks/lorebooksWorkspace.sessionNotes.dom.test.ts`. Docs: `docs/lorebooks.md`, `docs/characters.md`,
`NOMENCLATURE.md` (own-book row; §25 block).

**Formatting noise.** A worker ran `prettier --write` on six owned files (`rulesets/pubRulesets.ts` + test,
`rulesets/versions.ts`, `sessions/sweptRelationships.ts`, `cast/characterRows.ts` + test): their diffs are larger
than the lane's edits but hold nothing else (checked against prettier(HEAD)). Another worker reformatted ten files
outside the lane by a glob; the supervisor restored those to HEAD content (they held no uncommitted work).

## Tests (supervisor)

Lane set 19 files / 176 tests and neighbouring suites 10 files / 51 tests, all pass (`plans/notes-unlisted-sup-1.log`,
`-sup-2.log`). `tsc` clean. `npm run check`: 1 error, `components/icons/DeclaredIconPlaceholder.svelte:24`, not this
lane's.

## Open ★

- ★N1 Every copy string above.
- ★N2 The section's open state is not remembered (collapses on every load). Other option: a per-viewer
  `localStorage` key.
- ★N3 Edges of the written rule: an in-place edit of a seat member's base version that stamps no `written_by`
  reads as unwritten; uploads (`files.lorebook_id`) not counted; an annex of empty keys counts as written.
- ★N4 The new names: `sessionNotesName`, `bookShownName(s)`, `writtenNotesOf`, `notesShown.ts`, `notesWritten`,
  `ownBookSessionId`, `notesCount`, prop `notesName`.
- ★N6 While a search holds the section open, its heading button changes nothing visible.

## Noticed, not done

- `sockets/entries.ts` ~555 `session-entries` `bookName` still the stored name.
- **`lorebooks:delete` has no notes guard**: Book settings offers Delete for notes and it purges them like any
  owned book. Whether the `own-books` boot pass remakes them was not verified.
- Stored name still shown: the Lorebooks view's jump-scope label (~1892), `SharePeopleModal` title (~3272),
  `makeBookFromOpenKit`. Still on the wire, not drawn: `sessionNotes` rows' `name`, the reach `lorebook.name`.
- Not audited: server sentences that interpolate `lorebooks.name` (`SEAT_REFUSALS`, `memberOfSeat`, the pipelines
  host, search results); whether `charactersExportCard` accepts a notes `lorebookId` sent directly.
- STYLE-GUIDE §6.4 does not describe a collapsing group label.

## Lead verification, scope review and follow-up (2026-11-13)

- Lead's wider run (capped scope): `server/lorebooks`, `server/cast`, `server/rulesets`, `client/lorebooks`,
  `characterForms`, `sidebars`, `listItems`, `lorebookForms`, `shared/lorebooks`, `shared/sockets` and the two new
  socket tests: 250 files, 2928 of 2929 tests pass. The one failure was a stale expectation in
  `lorebooks/retold.int.test.ts` (the new member field `ownBookSessionId`). **Fixed.** `tsc` clean.
- Scope review: inside the brief and its corrections; `writtenNotesOf` matches the schema, one grouped query per
  table; a hidden notes book opens by id; no changed label shows the stored name; no handler's access rule
  changed; the two shared files outside the owned list are justified (wire shapes). Findings:
  1. **Fixed.** A person's own edit of a seated notes member (an undated edit merges into the base version and
     stamps nothing the rule read) left the notes reading unwritten, so hidden. The rule now also counts a member
     version with `updated_at > created_at`. Test 5 in `notesShown.realCreate.int.test.ts`; tests 1–3 still prove
     that seating alone does not bump it.
  2. **Not done.** Tests the brief asked for and the lane did not write: the importer skipping a notes book of the
     same name; tags' related data leaving notes out; the label after a rename for the graph build, compile,
     scene summary and swept-ties activity rows (only indexing and the lift notes are tested).
  3. **Recorded.** Undisclosed formatting: `LorebookListItem.svelte`, `BookSettings.svelte` and
     `EditLorebookForm.svelte` carry re-wrapped hunks beyond the lane's edits; `scenes.ts` ~2974 has one reworded
     comment outside "the label lines only".
  4. **Recorded.** `narrativeGraph.ts` ~3566 has a local `shownNameOfBook` (one extra query per call) and
     `scenes.ts` ~1917 an inline sub-select, both second spellings of `bookShownName`; the prop `notesName` is not
     in NOMENCLATURE §25.
  5. **Open ★N7.** `notesWritten` is read when the Lorebooks view mounts: notes first written while the view is
     open stay hidden until it is opened again (they still open by id).
- After the fix: `notesShown.realCreate.int`, `notesShown.int`, `lorebooks.notesUnlisted.int` pass (24 tests);
  `tsc` clean. `npm run check` (supervisor): one error, not this lane's
  (`components/icons/DeclaredIconPlaceholder.svelte:24`).
- ★N8 **Delete on a notes book** (Book settings) purges the session's notes with no guard; older than this lane.
