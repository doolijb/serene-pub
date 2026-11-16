# BRIEF — `time-t4b` worker 4 — the cast member page draws its versions on the rail (part 1)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4b`. The rules section at the end of this file is part of this brief.

## Goal

In a lorebook that keeps a timeline, a cast member's **Member** tab shows the member's cast versions on the same rail the entry form has (`time/VersionRail.svelte`), so time reads the same across the lorebook. **Save writes the selected version** (owner 2026-11-14); the page **opens** on the version in force at the lorebook's present. Selecting a version **moves the moment bar** to its date. With the Timeline off, nothing changes from today.

This is part 1. Part 2 (later, another worker) does the edit rows under each version, the moment bar's sentence, removing the `AmendmentList` mount and the dead Save-as-of code, and docs. **Leave the `AmendmentList` mount and the existing `EditHistory` mount in place.**

## Files owned

- `src/lib/client/lorebooks/CastWorkspace.svelte`
- `src/lib/client/lorebooks/cast/CastMemberForm.svelte`
- `src/lib/client/lorebooks/cast/castSave.ts` (+ `castSave.test.ts`): two awaited writes (item 6)
- tests: new `src/lib/client/lorebooks/cast/memberPageRail.dom.test.ts`; existing cast DOM tests that break because of this change (list each one you change and why)

## Read first

- The model to copy: `src/lib/client/lorebooks/EntryWorkspace.svelte` 1120–1345 (rail, `shownVersion`, `draftVersionKey`, the ask-once effect, `selectVersion`, `openVersionOnLine`, `redateEntryVersion`, `deleteEntryVersion`), 1795–1855 (`createVersionAt`), 2995–3075 (the rail mount and the Save-as-a-new-version dialog mount, its title, description and confirm label).
- `time/VersionRail.svelte` props (generic `V extends RailVersion, E extends RailElsewhere`: `versions`, `elsewhere`, `selectedKey`, `lineBranchId`, `readOnly`, `lineName`, `onSelect`, `onAdd`, `onOpenOnLine`, `onRedate`, `onDelete`, `onRedated`, `onDeleted`, `describe`, `deleteSentence`, `takenAt`, `addBlocked`, `edits`, `children`), `time/VersionDateDialog.svelte`, `time/entryVersions.ts` (`momentOfVersion`, `RailVersion`).
- `cast/castVersions.ts` (all of it: `castVersions`, `castVersionAt`, `castTakenAt`, `castLaterCount`, `castVersionSave`, `castNewVersionSave`, `castChangesWords`, `castDeleteSentence`, `UNDATED_MEMBER_KEYS`) and `rowAtVersion` in `cast/castVersionRead.ts`.
- `CastWorkspace.svelte` 186–360, 560–650, 800–1090, 1218–1262, 1890–1985; `CastMemberForm.svelte` 82–445, 1560–1650, 1885–2019.
- Wire: the cast row now has `baseVersionId`; `lorebooks:updateBinding` takes `castVersionId` (only the base's id is accepted: it writes the base; absent = the version at the book's present, as before); `Sockets.Amendments.CastRow` has `writeOrder`, `sourceSessionId`, `sourceSessionName`.

## Build (CastWorkspace)

1. **When the rail shows**: `railed = book.timelineEnabled && !!selectedMember && !!castAmendmentsFor`. Then `castRail = castVersions({ baseVersionId: stored.baseVersionId ?? null, rows: castAmendmentsFor(id), line })`, where `stored` is the member's row as the server sent it (`castRows`, not the resolved one).
2. **Which version is selected.** `inForce = castVersionAt({ versions, rows, line, moment: momentDate, shownVersionId: stored.castVersionId ?? null })`. A version picked on the rail that is **not** the one in force at its date (a second node at a shared date) stays selected while the route's moment is the one it set: keep `pickedKey` + `pickedMoment` (the route's `moment` string after the pick) and select it while `route.moment === pickedMoment` and it still exists; otherwise the selection is `inForce`. Keep a `draftVersionKey` as the entry form does: the version the draft is typed on, following the selection while the form is clean.
3. **Selecting** (`onSelect`): as `selectVersion` in the entry form — the moment from `momentOfVersion(versions, v)`; with unsaved edits ask once (`loreRoute.confirmLeave()`) and on Leave discard the form's draft (item 9) before moving; set the moment with `loreRoute.set(reduce(loreRoute.route, { type: "setMoment", moment: momentKey(at) }))`; set `pickedKey` only when `v` is not `inForce` at that moment. **Moving the moment bar** with unsaved edits so that the selection changes asks once and, on Stay, puts the moment back (copy the entry form's effect at ~1269–1295, keyed on the cast selection and `memberDirty`). `onOpenOnLine`: as `openVersionOnLine`.
4. **The form shows the selected version**: pass `row={railed ? withCard(rowAtVersion(stored, versions, selected)) : selectedRow}`, where `withCard` re-joins `character` when the version's `characterId` differs from the stored row's (factor the body of `resolvedCast`'s map at ~350–355 into a function and use it in both places).
5. **Save writes the selected version** (`onSave` when railed; today's `saveMember` stays for the Timeline off). With the diff (`memberDiff`), split it with `castVersionSave(draftVersion, diff)`:
   - `version` for the base: `lorebooks:updateBinding` with `castVersionId: stored.baseVersionId` and `changeLaterVersions` from the form (extend `writeBase` with an optional target; skip `baseSaveWarning` when a target is given);
   - `version` for a dated one: `amendments:update` `{ lorebookId, id: v.versionId, subject: "cast", fields: version, changeLaterVersions? }` through `updateCastAmendment` (item 6);
   - `undated` (own name, own nickname, voice): `lorebooks:updateBinding` with no target, as today, after the version write, never with `changeLaterVersions`;
   - say it as today: one success toast `Cast member saved` with `laterVersionsToast(reply.laterVersions)` as its description when there is one; a failure as today (`reportUnanswered`). `memberSaveTick++` after a save that wrote anything.
   Save is **off** (the form's Save `disabled`, with this as its `title`) for an inherited version (`!own`): 🚧 *This version is ‹line›'s; open it on ‹line› to change it.*, and for a `locked` one (a session's): 🚧 *A session wrote this version, so it is changed from that session.*
6. In `castSave.ts`, two awaited writes, modelled on `updateEntryAmendment` / `fileCastAmendment` (reply on `interestKey("amendments:list", lorebookId)`):
   - `updateCastAmendment(socket, params: Sockets.Amendments.Update.Params)` — matches a list for the book that carries `laterVersions` (the cast update's reply does; a plain relist does not) and holds the row `params.id`, with the date asked when a date was sent; fallback error 🚧 *The version could not be saved.*
   - `fileCastVersion(socket, target: CastAmendmentTarget, planned: PlannedCastAmendment)` — `amendments:create`; matches a list for the book carrying `laterVersions` that holds a cast row of `target.castId` on `target.branchId` at the planned date (a create at a taken date updates that row in place, so the id may not be new: never require a new id or equal `fields`); fallback 🚧 *The version could not be saved.*
   - `deleteCastAmendment(socket, params: Sockets.Amendments.Delete.Params)` — waits for a list for the book without the row.
   Unit tests for the three matchers in `castSave.test.ts`.
7. **Save as a new version…** (`onSaveNew`, handed to the form when railed and not read-only): opens a `VersionDateDialog` mounted in the workspace (only when `!readOnly`, as the entry form does: a closed dialog still draws its button), title *Save as a new version*, description *What you changed starts at this date; the version shown stays as it is.*, the entry form's confirm label, `initial` the moment being read (else the selected version's date), `bounds { after: null, before: null, beginning: null }`, `taken: (d) => castTakenAt(versions, d, line.branchId, null)`, `takenMode: "merge"`; resolves false on Cancel. On confirm: `castNewVersionSave(diff)`; `fields` non-empty → `fileCastVersion` on the line being read at the date (life point null, `changeLaterVersions` from the form); then `undated` as in item 5; success toast `Saved as a new version at ‹date›` + ` on ‹line›` off main (the entry form's words); move the moment to the date (clear `pickedKey`). The **+ Add a version here** buttons (`onAdd(date)`) run the same write at the date the rail's dialog chose, through the form (item 9). With a clean form the rail's `addBlocked` is 🚧 *Change something first: a version holds what differs from the one before.* (a cast version that changes nothing is refused by the server).
8. **The rail mount** (Member tab, where `CastMemberForm` is mounted today): `<VersionRail>` wrapping a `<fieldset disabled={readOnly} data-lore-read-only=…>` that holds `CastMemberForm` — the rail itself must stay selectable for a reader, so it is **outside** the disabled fieldset. `PresencesPanel`, `AmendmentList` and `EditHistory` stay below it in their own `fieldset disabled={readOnly}` as today. Props: `versions`, `elsewhere`, `selectedKey`, `lineBranchId={line.branchId}`, `readOnly`, `lineName={(id) => openBookTime.lineName(id)}` (import `openBookTime` from `./time/bookTime.svelte`), `onSelect`, `onAdd`, `onOpenOnLine`, `onRedate` (`updateCastAmendment` with `year`/`month`/`day`, `id` = `target.version.versionId` or `target.row.id`), `onDelete` (`deleteCastAmendment`), `onRedated` (the selected one moves the moment to its new date), `onDeleted` (the draft's version gone → discard the draft), `describe={castChangesWords}`, `deleteSentence={castDeleteSentence(selectedMember.name)}`, `takenAt={(d, moving) => castTakenAt(versions, d, line.branchId, moving)}`, `addBlocked`. No `edits` snippet yet (part 2). With the Timeline off the form is mounted exactly as today, without the rail.

## Build (CastMemberForm)

9. Props: `onSaveNew?: (patch, pristine, options) => Promise<boolean>` and `saveOff?: string | null`. Export two functions for the workspace (`bind:this`): `discard()` (re-seed the draft from `row`, as Discard does) and `saveNewAt(date: StoryDate)` (run `submit` with a writer that calls the workspace's create at that date: add a prop `onSaveAt?: (date, patch, pristine, options) => Promise<boolean>` for it, or another shape that keeps the draft in the form; say which).
10. When the workspace passes `onSaveNew` (railed): the save row is **Save** (filled primary, `disabled` while saving, invalid as today, or `saveOff`, with `saveOff` as its `title`) and **Save as a new version…** (`btn btn-sm preset-tonal-surface`, `disabled` while saving or while the form is clean, title 🚧 *Change something first: a version holds what differs from the one before.* when clean). The workspace does not pass `onAmend` when railed, so the split button is not drawn; leave its code for part 2. The *N later versions keep their own words.* line and **Change later versions too** apply to Save (the workspace passes `laterCounts={{ base: castLaterCount(rows, selected), amend: 0 }}` when railed); hide them while `saveOff`.
11. **The card section stays exactly as today** (Change, Unlink, the dated sentence, the ⋯ menu): `cardDated` must not depend on `onAmend` any more — make it `timeline.value && !!momentLabel`, and keep passing `momentLabel` from the workspace as today.

## Tests

`memberPageRail.dom.test.ts` (mount `CastWorkspace` the way `memberPageVersions.dom.test.ts` does; copy its harness): the rail lists *From the beginning* then the dated versions in the reader's order, with a chip and *read at this date* at a shared date; opening at now on main selects the version whose id is the row's `castVersionId`; selecting a version moves the moment; Save on *From the beginning* sends `updateBinding` with `castVersionId` = the base id and only the changed fields; Save on a dated version sends `amendments:update` `{ id, subject: "cast", fields: its own fields + the diff }`; an own-name change goes in an `updateBinding` with no `castVersionId`; Save as a new version opens the dialog, a taken date says *‹date› already has a version on this line. Saving changes that version.*, a date with only a session's version says nothing, confirm sends `amendments:create` at that date on the line being read; **+ Add a version here** is disabled with its title while clean; Change its date sends `amendments:update` with the date; Delete this version asks with the cast sentence and sends `amendments:delete`; on a fork a main version shows *from main* and **Open on main**, its Save is off with the sentence; a session's version: no Change its date / Delete, Save off; an Elsewhere row; a read-only book: the rail selects, no add buttons, no Save-as-new dialog in the DOM; Timeline off: no rail, Save sends `updateBinding` without `castVersionId`; with unsaved edits, selecting another version asks and Stay keeps the draft. Then run, one at a time: `cast/memberPageRail.dom.test.ts`, `cast/memberPageVersions.dom.test.ts`, `cast/memberPage.dom.test.ts`, `cast/castWorkspace.timelineOff.dom.test.ts`, `cast/castMemberForm.dom.test.ts`, `cast/castMemberFormLater.dom.test.ts`, `cast/castMemberFormTimelineOff.dom.test.ts`, `cast/memberTimelineOff.dom.test.ts`, `cast/memberTabs.dom.test.ts`, `cast/castSave.test.ts`, `cast/castVersions.test.ts`, `time/versionRail.dom.test.svelte.ts`, `entryWorkspace.versions.dom.test.svelte.ts`; then `tsc`, then `NODE_OPTIONS=--max-old-space-size=12288 npm run check` (0 errors in your files; errors in the other session's files listed in the rules are not yours).

A test that asserted **Save as of** / **Change the member** on the member page (mounted through `CastWorkspace`) now fails by design: change it to the rail's equivalent or remove it, and list it. Tests that mount `CastMemberForm` directly with `onAmend` keep passing (part 2 removes them).

## Out of scope

The edit rows under versions, the moment sentence, `AmendmentList` and dead-code removal (part 2); `PresencesPanel`, the Timeline tab, the card section's behaviour, the server, `characters/versions.ts`, `LorebooksWorkspace.svelte`, `VersionRail.svelte` (if the rail lacks something you need, stop and report it).

## Stop and report when

the rail needs a change; a job the page does today has no place (say which); `rowAtVersion`'s form row and the page's reading at a moment disagree in a test that passed before (report the case: do not change the reader); the ask-once flow would need `LorebooksWorkspace.svelte`.

---

# Rules every `time-t4b` worker works under (quoted by the supervisor; read with your own brief)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Owner rulings (verbatim)

- 2026-11-13: "Also make a pass on cast history and make sure it behaves similar so it's familiar across the entire lorebook."
- 2026-11-13 (the vertical time view): "Also provide a vertical time view like i suggested for other entries."
- 2026-11-13 (versions): "show the option to change the effective date of that version. Save edits that version, but also need a button to save as a new dated version … navigate the dated versions like a vertical timeline, adding new versions before or after."
- 2026-11-14: the chosen screen (the rail beside the fields, a strip when narrow) and "Yes, move the moment bar".
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled": with the Timeline off, no rail, no dates; one plain form with its edit-history fold.
- 2026-11-14: **Save writes the selected version** ("The selected version"). The page still OPENS on the version in force at the lorebook's present; after a version is picked on the rail, Save writes that one.
- 2026-11-14: **several versions at one date: "Each as its own node."**
- Standing: cast members get no Beginning and no Decay; members never see or touch model plumbing; it is a **session**, never a chat.

## Hard rules (each has cost data or hours)

- `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`.
- `socket.off(event)` with no handler removes every listener app-wide: always `socket.off(event, handler)`.
- Views never call `toaster`/`notify` for socket replies they did not ask for; the page's own awaited write may say how it went through `notify` as it does today. Refusals are toasted by the shell.
- An event in `SCOPED_EVENTS` must carry its scope key (`lorebookId`, …) in the payload.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- No migration, no new socket event, no new setting. Stop and report instead.
- Comments state the rule, not the story (no "lane X added", no "was …").
- Never `prettier --write` a whole file; format only the lines you changed (check with `npx prettier --check <file>` and leave unrelated hunks alone).
- Edit only the files your brief owns. Anything else you need goes in your report.
- Every new name, label, sentence or prop goes in your report's list (the supervisor records them in NOMENCLATURE §25); mark new copy 🚧 in a comment where the sentence is defined.

## STYLE-GUIDE rules (quoted)

- §5.3 / §6.19: the rail is one component, two layouts from its own box (`@container/versions`, two columns at `@min-[36rem]/versions:`, never the viewport). Wide: a vertical list of buttons beside the fields, the selected one `aria-current`, quiet **+ Add a version here** buttons between them named for where they add (*Add a version between Year 7 and Year 9*), each version's edit rows under it behind an **Edits** toggle (`preset-pressed`, `aria-pressed`). Narrow: a row of chips above the fields (`preset-pressed` when selected). The fields render once in both.
- §6.1: one primary button per surface (`preset-filled-primary-500`); a destructive action is never the primary; removing something saved is `preset-tonal-error`.
- §6.14: unsaved means different from what is saved; "Ask first, then discard — never the other way round": a selection change that would close an edit awaits `loreRoute.confirmLeave()` and only on Leave drops the draft. On a railed form a move of the moment bar that would show another version asks once and, on Stay, puts the moment back.
- §9: every interactive element is a real `button` with an accessible name; never an interactive inside an interactive; `aria-current` on the selected row; nothing hover-only; 44px targets on touch (`min-h-11`, `pointer-coarse:min-h-11`).
- §10: sentence case; a button says what happens; help is one sentence; one name per thing.

## Tests

Run only your targeted files, from the repo root, one at a time, each as:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t4b-<name>.log 2>&1"`

Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait while one runs (another session runs tests in this checkout). Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors in your files).

Another Claude session is editing `src/lib/client/components/Layout.svelte`, `components/pipelines/**`, `components/modals/{CharacterCreatorModal,CharacterSelectModal}.svelte`, `src/routes/+page.svelte`, `src/lib/shared/utils/docsPages.ts`: never touch them; errors there are not yours.

## Report

Your final message: changed files; what you built against each numbered item of your brief; tests run with pass/fail counts and log paths; every name, label and sentence added; anything you could not do or decided (with the reason); Noticed, not done.
