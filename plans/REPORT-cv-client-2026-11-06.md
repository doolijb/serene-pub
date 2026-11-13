# REPORT cv-client (2026-11-06)

No status question was relayed. The lead's message about cv-fix3 is applied: its two docs lines are in, and the link/unlink-at-a-present check is answered under Blocked, item B2.

**Built:** item 1 (card editor), item 2 (greetings and notes), item 3 (import dialog), the buildable part of item 4 (Change later versions too, the Changes list words, member greetings as one row), and item 6 (docs).

**Blocked on server fields:** item 4's "reads versions" and its **Update ‹member› to card v2** offer, and item 5 (the admin list). The queued wire shapes and the proposed words are below.

**Tests:** one grouped run passed, 67 files and 817/817 tests. `tsc` shows no errors in lane files. Another session's full `npm run check` finished at 07:21, after the last lane edit at 07:11, and lists no error or warning in lane files.

I ran no `sdk:build`, committed nothing and never used `git stash`. My run left no new `/tmp/serene-pub-vitest-*` dirs (I compared listings before and after), and I deleted none.

Two Sonnet workers ran at the same time: w1 on the card side and w2 on the member side. Their briefs are `plans/briefs/BRIEF-cv-client-w1.md` and `plans/briefs/BRIEF-cv-client-w2.md`. I checked both reports against the briefs, read the key hunks (the update handler, `askCharacter`, the import modal) and re-ran every test together.

## Names and signatures
All of these are client-only. No socket field or event is new.

**`src/lib/client/components/characterForms/cardVersionWords.ts`** (new, pure):
- `versionLabelText(label, number)` gives `v1.0`, the label as it is, or `Version 4`.
- `versionOptionText(version, currentId)` adds ` · current` to the current version.
- `highestVersion(versions)`.
- `inPlaceNote(shown, current)` gives _Saving changes v1.0 in place; v1.1 is the current version._
- `stayingGroups(staying, versions)` returns `{lead, members}[]`.
- Types `CardVersionOption` and `StayingCastMember`.

**`src/lib/client/components/characterForms/cardDraft.ts`** (new, pure):
- `greetingsOfColumns(card)` builds the list with `mergeGreetings`.
- `greetingColumnsOf(greetings)` splits it back with `legacyGreetingsOf`.
- `openerIndex` and `withOpenerText`.
- `notesDraftOf(card)` uses `creatorNotesOf`.
- `notesColumnsOf(draft)` is the client twin of the server's `cardNotesColumns`.
- `noteLanguageProblem(draft)`.

**`src/lib/client/components/modals/CardImportConflictModal.svelte`** (new). Props: `open`, `onOpenChange`, `existingName`, `currentVersion`, `suggestedLabel`, `onAddVersion(label|null)`, `onSaveAsNewCard`, `onCancel`.

**`CharacterForm.svelte`:**
- `askCharacter(id, cardVersionId?)` is a one-shot `characters:get` interest, declared again for each ask.
- The draft holds `greetings`, `creatorNotes`, `creatorNotesLang` and `creatorNotesVariants`. They are converted to the wire columns on load and on save.
- `characters:update` sends `cardVersionId` and `saveAsNewVersion: {label}`.

**`src/lib/client/lorebooks/cast/castSave.ts`:**
- `laterVersionCount(rows, save)`, where `save` is `{kind:"base"} | {kind:"amend", branchId, moment}`.
- `laterVersionsLine(count)`.
- `laterVersionsToast(laterVersions)`.
- `PlannedCastAmendment.changeLaterVersions?`.
- `fileCastAmendment` now resolves with `Sockets.Amendments.Create.Response`.

**`src/lib/client/lorebooks/cast/retoldRows.ts`:**
- `RetoldRowField` has `"greetings"` in place of `firstMessage` and `alternateGreetings`.
- New: `GREETINGS_LABEL`, `cardGreetings`, `greetingsOf`, `withGreetings`, `greetingsRetold`.
- `retoldRows` returns 5 rows. The Greetings toggle sets both retold flags.

**`CastMemberForm.svelte`:**
- New prop `laterCounts?: {base, amend}`.
- `onSave` and `onAmend` get a third argument `{changeLaterVersions}`.

## What was built
**1. Card editor** (`CharacterForm.svelte`)
- **Picker.** It sits in the hero, under the cast line, because the Version field is inside the "show all" metadata, so older versions would be unreachable with show-all off. It appears in edit mode only, when the card has more than one version. It is a `select` named "Card version". While an older version is shown, a muted line says so. A form with unsaved changes asks first, through the existing unsaved-changes modal (STYLE-GUIDE §6.14).
- **Save.** **Save** writes the version shown. The field is relabelled **Version label**, and changing it renames that version on save.
- **Save as new version.** A tonal button beside Save opens a portaled dialog. Its **Version label** field is prefilled with `nextVersionLabel(newest label)`. The dialog sends the version shown, so a new version can be made from an older one.
- **The staying line.** When the reply carries `staying`, the form stays open on the new version and says _3 cast members stay on v1.0: Bianca, Theo, Ada._ It groups by label when they differ, and each name opens that member. Only this form's own save can do this; a save from another tab of the same card still closes it, as today. With no `staying`, the form closes as before.

**2. Greetings and notes**
- **Greetings.** One list, each greeting with **Group sessions only** and a remove button, and **Add a greeting** at the foot. One help sentence goes with it. The simplified form shows only the first greeting, labelled **First greeting**. The wire still uses the three columns, so marked greetings come back after the unmarked ones on the next load.
- **Notes.** The **Creator notes** text, plus **Language**, **Other languages** and **Add a language** behind show-all. A language code used twice is a validation error, and it marks the Notes tab.

**3. Import dialog**
- The card conflict dialog now offers **Add as a new version** (sends `action:"addVersion"` with the label, which is left out when empty), **Save as a new card** (`createNew`) and **Cancel**.
- The client never sends `"overwrite"` for cards any more. The lorebook conflict flow and `ImportConflictModal` are untouched.

**4. Member page** (buildable part)
- **Change later versions too** (★CV-13). When the form has unsaved changes and the save about to happen has later versions, the footer says _2 later versions keep their own words._ It offers a pressed toggle, **Change later versions too**, which sends `changeLaterVersions: true` on `lorebooks:updateBinding` or `amendments:create`.
  - The count comes from the member's Changes rows: every main row for a base save, and rows on the line being read after the moment for **Save as of ‹date›**.
  - The toggle resets after every save and when the member changes. It is not part of the dirty check.
  - The existing save toast gets one more sentence from the reply's `laterVersions`, such as _2 later versions changed too._ or _1 later version keeps its own words._
- **The Changes list** (`AmendmentList`, cast only). It has words for the version columns (description, greetings, example dialogues, face, what is told in their own words, name and nickname in this book, voice). The two greeting columns are shown once. The delete sentence for a member is _Delete the change dated ‹date›? They read as they did without it, from then on._ The heading **Amendments** is unchanged (★CV-20).
- **Greetings, one row.** The member form's First message and Alternate greetings rows are now one **Greetings** row, with one list and one retell toggle that sets both flags. The server already treats them as one field (`memberProfileOf`), and before this a half-retold pair silently became an own list. Empty greetings are kept as typed: `memberPatch` no longer drops blank alternates.

**6. Docs**
- `docs/characters.md`:
  - **First greeting** in the table, **Version label**, the greetings list and notes languages under "show all", and a paragraph on the one greetings list.
  - A new section, **Card versions** (Save as new version, the staying line, the picker, renaming).
  - The import conflict: **Add as a new version** / **Save as a new card**, with "nothing you have is overwritten".
  - The cast line: editing changes members "on the version you edit".
- `docs/lorebook-cast.md`:
  - Greetings are one row in **From the card**.
  - "From the card" reads the version the member is on; a new card version doesn't change them.
  - **Change later versions too**.
  - Link, switch and unlink from the member page apply from the book's present (cv-fix2 and cv-fix3 lines).
  - A dated card change applies from its date up to the next card change (cv-fix and cv-fix3).
  - Moving a change moves the card switch and keeps its history entry. Deleting one puts the later changes back on the earlier card, up to the next card change (cv-fix2).
- `docs/lorebook-time.md`: one line pointing from the amendments list to the cast rules.
- `docs/sessions.md` (Delete a session): Session notes stay, hidden, while a branch still reads them (cv-fix).
- STYLE-GUIDE: no rule moved.

## Changed files (all under /home/jody/github/serene-pub)
**Card side (w1):**
- `src/lib/client/components/characterForms/CharacterForm.svelte`
- new `src/lib/client/components/characterForms/cardVersionWords.ts`, with `.test.ts`
- new `src/lib/client/components/characterForms/cardDraft.ts`, with `.test.ts`
- new `src/lib/client/components/characterForms/cardVersions.dom.test.svelte.ts` (14 tests)
- new `src/lib/client/components/modals/CardImportConflictModal.svelte`, with `CardImportConflictModal.dom.test.svelte.ts` (4 tests)
- `src/lib/client/components/sidebars/CharactersSidebar.svelte` (the character conflict hunk only)
- `src/lib/client/contexts/characterImports.svelte.ts` (a stale comment only)

**Member side (w2):**
- `src/lib/client/lorebooks/CastWorkspace.svelte` (the save hunks and the form's props)
- `src/lib/client/lorebooks/cast/CastMemberForm.svelte`, `castSave.ts`, `retoldRows.ts`, `memberDraft.ts`
- `src/lib/client/lorebooks/time/AmendmentList.svelte`
- tests updated: `cast/castSave.test.ts`, `cast/retoldRows.test.ts`, `cast/memberDraft.test.ts`, `cast/retoldBlock.dom.test.ts`
- new tests: `cast/castMemberFormLater.dom.test.ts`, `time/amendmentList.dom.test.ts`

**Docs (me):** `docs/characters.md`, `docs/lorebook-cast.md`, `docs/lorebook-time.md`, `docs/sessions.md`.

**Briefs:** `plans/briefs/BRIEF-cv-client-w1.md`, `plans/briefs/BRIEF-cv-client-w2.md`.

## Tests
- `npx vitest run src/lib/client/components/characterForms src/lib/client/components/modals/CardImportConflictModal.dom.test.svelte.ts src/lib/client/contexts/characterImports.dom.test.svelte.ts src/lib/client/lorebooks/cast src/lib/client/lorebooks/time src/lib/client/lorebooks/lineConformance.test.ts src/lib/client/components/sessionForms --maxWorkers=2` passed: **67 files, 817/817**. The log is at `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/cv-client-run1.log`.
- `npx tsc --noEmit -p .` shows no errors in lane files. The 7 errors it does show are cv-sdk's in-flight `castMember` / `CharacterProfileV1` (SDK dist not rebuilt).
- svelte-check: another session's full `npm run check` finished at 07:21, after the last lane edit at 07:11. It reports nothing in lane files, and its 7 errors are the same cv-sdk ones. I didn't start a second check alongside it, to save memory.
- Prettier is clean on the new files. The touched `.svelte` and `.ts` files and the four docs were already not prettier-clean, so only our hunks follow the style.

## Blocked: server fields missing (for the lead; not my files)
- **B1. Update ‹member› to card v2** (owner ruling; on the member page, `CastLine` and the Characters row).
  - `updateMemberToCardVersion` exists in `characters/versions.ts`, but no socket reaches it.
  - The cast line's `lorebooks:bindingsForCharacter` members and the member page's rows carry no card version.
  - Needs ★ a new event, for example `lorebooks:updateMemberToCardVersion {castId}` (owned by the book's writer, under its lock, answering the member), plus per-member `cardVersionId`, `cardVersionLabel` and `behindCard` on both payloads.
  - Proposed words (★): a muted line _On card v1.0; the card is on v1.1._ with the button **Update Bianca to card v1.1**.
  - Consequence until then: no member can move onto a newer card version from the UI, because the member page's card picker leaves out the member's own card.
- **B2. The member page reads versions.** This is the lead's cv-fix3 note and the "test a link and an unlink at a present" request.
  - It can't be fixed or tested from the client. `withBaseColumns` (`sockets/lorebooks.ts` ~1338) projects the **base** with `carded` taken from `lorebook_bindings.character_id`.
  - After a link or unlink at a present, the base keeps its old card standing, so the form shows the followed fields wrong (all retold, or blank).
  - The Changes rows carry only diffs, and no `follows` or parent card, so the client's fold can't correct it.
  - Proposal (★, needs the lead's design):
    - each member row carries the version in force at main's head, with `carded` from that version's parent;
    - each Changes row carries its version's projected columns and `characterId` (the parent's card);
    - the client reads the version in force at the moment and line with the shared `versionInForce`.
  - The open question is what **Save** at now writes, the base or the shown version. Today it is the base.
- **B3. The admin list: _N cast members read differently since the upgrade_** (item 5). No admin socket lists the lift notes (`LiftNoteV1` in `characters/versionsLift.ts`).
  - Needs ★ an admin event returning the count and, per member, `{castMemberId, lorebookId, lorebookName, memberName, note}`, and an Admin index line.
  - Proposed wording (★, for the owner):
    - **Index:** _N cast members read differently since the upgrade_ › opens the list.
    - **Row:** _Bianca in Porto Alto_.
    - **One line per difference:** _On main, from 12 March 1204, reads the description and greetings differently than before the upgrade._
      - With a life point: _…, at life point 34, …_.
      - For `before-first-change`: _Before their first change, reads … differently than before the upgrade._
    - **Mixed greetings:** _Their greetings became their own list, because only some of them were told in their own words before._ with **Follow the card's greetings** (ruled).
- **B4. `amendments:create` doesn't deliver `laterVersions`.**
  - The handler returns `{...res, laterVersions}`, but the socket layer emits no handler return value (`server/sockets/index.ts` ~489), and the `amendments:list` broadcast doesn't carry it.
  - The flag reaches the server and the later versions are written, but the **Save as of ‹date›** toast can't say what happened.
  - Fix: emit it on an `amendments:create` reply, or inside the list broadcast. The client already reads `reply.laterVersions`.
- **B5. Members have no group-only greetings.**
  - `memberColumnsOfVersion` returns no group-only list, and `memberProfileOf` writes member greetings with `[]` group-only.
  - So a member's own list can't hold a **Group sessions only** greeting, and any it holds is dropped on the next member greetings edit.
  - Needs `groupOnlyGreetings` (or the profile list) on the member wire; then the member's Greetings row can carry the mark.

## Open ★ (my calls inside scope, for the owner to confirm)
1. **★cv-client-1, picker text.**
   - Options read `v<label>` when the label starts with a digit, the label as it is otherwise, and `Version N` when there is none. The current one adds ` · current`.
   - The line under the picker: _Saving changes v1.0 in place; v1.1 is the current version._
2. **★cv-client-2, the form after a new version.** The form stays open after **Save as new version** only when members stay, so the ruled line can show.
   - **Save as new version** sits beside Save in the header (the form has no footer), and may wrap on a narrow panel.
   - In a multi-label line, later groups read _2 stay on v1.1: …_.
3. **★cv-client-3, greetings wording and order.**
   - The help sentence: _A new session opens with the first greeting and offers the others as swipes; a group session uses the ones marked for it, when there are any._
   - The simplified form's **First greeting** replaces **First message**.
   - Marked greetings move after the unmarked ones on reload, because the wire is still three columns.
4. **★cv-client-4, the import dialog body:** _You already have "‹name›", from this file or an earlier copy of it, and the file differs from its current version, v1.1._
5. **★cv-client-5, later versions.**
   - The line and toggle sit at the left of the save row.
   - The toast sentences: _N later versions changed too._ / _N later version(s) keep(s) their/its own words._
   - The toggle's tooltip: _Write the same change onto the later versions too. A version a session wrote keeps its words._
   - The menu's "change them outright" shows the base count in its explanation when it differs.
6. **★cv-client-6, the Changes list.** The new field words, and the member delete sentence _Delete the change dated ‹date›? They read as they did without it, from then on._
7. **★cv-client-7, member greetings as one row with one toggle.** This applies the owner's "merge … greeting and additional greetings". A member with only one half retold shows as retold, with its own list; turning the toggle off follows the card's greetings.

## Queued (not my files)
- **NOMENCLATURE §25** (one lane owns it this build). A row for the editor's words:
  - **card version picker** (UI only);
  - **Save as new version**, **Version label**;
  - _N cast members stay on ‹label›_;
  - **Add as a new version** / **Save as a new card** (the overwrite import for cards is retired);
  - **Change later versions too**, _N later versions keep their own words_;
  - **Group sessions only**;
  - **Greetings** as one list (card and member), and **First greeting** in the simplified form.
- **`src/lib/shared/characters/profile.ts`:** `cardNotesColumns` (server `cardIO.ts`) now has a client twin in `cardDraft.ts`. Moving it into the shared module would leave one copy.
- B1–B5 above.

## Noticed, not done
- **A foreign tab's save.** A save of the same card in another tab still closes an open editor and drops its edits (existing behaviour).
- **Case-variant language keys.** A card whose multilingual map holds both `EN` and `en` loads as a duplicate-language error, and that shows only with show-all on.
- **`castBannerWords.ts`** still names `firstMessage` / `alternateGreetings` as separate card parts in the cast line's _(retells …)_ words.
- **The member form after a half-retold lift** shows the draft columns, while the server reads a merge (the card's opener or the card's alternates for the half not retold). The list shown can be shorter than what is read, until B2.
- **A member greeting list of one empty greeting** saves the same as an empty list (opener null).
- **The client's later-versions count** includes versions a session wrote, because `CastRow` carries no source. The reply's `kept` is the real figure.
- **Old toast sites.** The card editor and the cast workspace still toast from the view (they predate the sockets rule); unchanged.
- **"No lorebook" wording.** `docs/sessions.md:54` says "If the old session had no lorebook", which predates this lane and breaks the always-a-lorebook wording.
- **Duplicate CHARX / starter avatar follow-up writes.** These are in cv-fix's noticed list, still open.
