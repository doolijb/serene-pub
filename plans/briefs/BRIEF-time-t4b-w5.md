# BRIEF — `time-t4b` worker 5 — the cast member page, part 2: edit rows per version, one moment sentence, removals

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4b`. The rules section at the end of this file is part of this brief.

## Where things stand

Part 1 is built and its tests pass: on a lorebook with a timeline the cast member's **Member** tab draws the member's cast versions on `time/VersionRail.svelte` (mount in `CastWorkspace.svelte`, search `<VersionRail`), selection in `castSelected` / `draftVersion`, Save through `saveSelected`, **Save as a new version…** through `askNewVersion` / `createCastVersionAt`, the form's new props `onSaveNew`, `onSaveAt`, `saveOff`. The old dated save (**Save as of ‹date›** with its split menu **Change the member**), `onAmend` / `amendMember`, and the `AmendmentList` mount are still there but no longer reachable on a railed page. Read `CastWorkspace.svelte` around the rail (search `railed`, `castRail`, `castSelected`, `saveSelected`, `<VersionRail`, `<AmendmentList`, `<EditHistory`) and `CastMemberForm.svelte` 82–460 and its save row (search `datedPrimary`).

## Files owned

- `src/lib/client/lorebooks/CastWorkspace.svelte`, `src/lib/client/lorebooks/cast/CastMemberForm.svelte`
- `src/lib/client/lorebooks/time/moment.ts`, `time/MomentBar.svelte` (the sentence and the `onCast` prop only), `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (**only** the `onCast={…}` attribute at the `<MomentBar` mount, ~2941)
- `src/lib/client/lorebooks/editHistory/EditHistory.svelte` only if item 1 cannot work without a change (stop and report first if the change is more than a few lines)
- tests: `cast/memberPageRail.dom.test.ts`, `cast/castMemberForm.dom.test.ts`, `cast/castMemberFormLater.dom.test.ts`, `cast/castMemberFormTimelineOff.dom.test.ts`, `cast/castWorkspace.timelineOff.dom.test.ts`, `time/moment.test.ts`, `time/momentBar.ssr.test.ts`, and any other cast test that fails because of these removals (list each)

## Build

1. **Edit rows under the selected version** (owner correction: "Edit history: one request, for the selected version"). `characterVersions:redlines` takes one `characterVersionId`.
   - Give the rail an `edits` snippet: for `ids` = `[versionId]`, render `<EditHistory characterVersionId={id} variant="rows" updatedAt={editsToken} restoreBlocked={memberDirty ? RESTORE_BLOCKED_UNSAVED : undefined} />` **only when `id === castSelected.versionId`**; other versions render nothing (no count is known without asking, and asking is per version).
   - The one fold that asks: move the page's existing `EditHistory` fold, on a railed page, **inside** the rail's children after the form's fieldset, wrapped in `<div class="@min-[36rem]/versions:hidden">`, with `characterVersionId={castSelected.versionId}`, `foldLabel={editsToVersionLabel}` (from `time/entryVersions.ts`), the same `updatedAt` and `restoreBlocked`. It is the narrow layout's fold; hidden wide but mounted, so it asks once and its reply fills the rows mount through the shared key (this is how the entry form works: `EntryWorkspace.svelte` ~2911–2925 and ~3000–3012; verify in `EditHistory.svelte` that a `variant="rows"` mount for a `characterVersionId` subject asks nothing and draws from the same list; if it does not, stop and report).
   - `editsToken`: changes after every save of the member (`memberSaveTick`) and whenever the selected version's row changes on the wire (`castSelected.row?.updatedAt`, else the stored row's `updatedAt`), e.g. `` `${memberSaveTick}:${…}` ``.
   - With the Timeline off, the existing fold for the shown version (`shownCastVersionId`) stays exactly as it is.
   - A save from the rail never retires-and-copies a version (only a session's version is copied on edit, and those are read-only on the rail), so there is no id to re-key: say so in a one-line comment where the selection is kept.
2. **One moment sentence.** In `time/moment.ts` keep one constant, `MOMENT_SAVE_SENTENCE`, with the text that is now `ENTRY_MOMENT_SAVE_SENTENCE` (*Saving here changes the version this date shows; Save as a new version… adds one.*), its doc comment saying it holds for an entry's and a cast member's versions alike; remove `ENTRY_MOMENT_SAVE_SENTENCE` and `momentSaveSentence`. `MomentBar.svelte` uses the constant and loses its `onCast` prop; remove the `onCast={…}` attribute at the mount in `LorebooksWorkspace.svelte` (nothing else in that file). Update `time/moment.test.ts` and `time/momentBar.ssr.test.ts`.
3. **Removals** (the rail does their jobs on a railed page; with the Timeline off they were never drawn):
   - `CastMemberForm.svelte`: the `onAmend` prop and `amend()`, `datedPrimary`, the split button with its popover and `saveMenuOpen`, `undated()`, `ownNamesDirty` if nothing else uses it, the **Save as of ‹date›** / **Change the member** copy, and `primaryLater` / `outrightLater` reduced to the one count Save uses. Keep `momentLabel` (the card section's dated Change / Unlink still read it: the card section stays exactly as it is). Update the component's header comment and the `laterCounts` prop doc (no "Save as of").
   - `CastWorkspace.svelte`: `amendMember` and the `onAmend` pass; the `AmendmentList` mount and its import; the `amend` half of `laterCounts` if nothing reads it; `memberMoment` only if `momentLabel` no longer needs it (it does today: keep it if so). Keep `writeAmendment` and `fileCastAmendment` (the card's dated Change / Unlink use them).
   - Do not remove `AmendmentList.svelte` (History uses it) or `laterVersionCount`'s `amend` kind in `castSave.ts` unless nothing at all uses it (then leave it and list it under Noticed).
4. **Tests.** Remove or rewrite every test of a removed control, and list them: at least `castMemberForm.dom` "reading a moment: a dirty own name disables the dated save", `castMemberFormLater.dom` "reading a moment: the line counts Save as of, and the amend carries the flag", `castMemberFormTimelineOff.dom` "on: Save as of, the later-version line and no plain Save" (rewrite: timeline on with `onSaveNew` → **Save** and **Save as a new version…**), `castWorkspace.timelineOff.dom` "on: presences, dated changes, …" (rewrite: on → the rail and presences; off → no rail). Add to `memberPageRail.dom`: the selected version's edit rows are drawn under it (a `characterVersions:redlines` reply for the selected id renders rows in `[data-version-edits]` of that version only), exactly one `characterVersions:redlines` ask for the shown version, a second ask after a Save (the token changed), and no **Save as of** / `AmendmentList` on the page. Then run, one at a time: `cast/memberPageRail.dom.test.ts`, `cast/memberPageVersions.dom.test.ts`, `cast/memberPage.dom.test.ts`, `cast/castWorkspace.timelineOff.dom.test.ts`, `cast/castMemberForm.dom.test.ts`, `cast/castMemberFormLater.dom.test.ts`, `cast/castMemberFormTimelineOff.dom.test.ts`, `cast/memberTimelineOff.dom.test.ts`, `cast/memberTabs.dom.test.ts`, `cast/memberPageCard.dom.test.ts`, `cast/memberOwned.dom.test.ts`, `cast/memberVoice.dom.test.ts`, `cast/memberCopy.dom.test.ts`, `cast/cardlessWords.dom.test.ts`, `editHistory/editHistoryVersion.dom.test.ts` (find exact name with ls), `time/moment.test.ts`, `time/momentBar.ssr.test.ts`, `time/versionRail.dom.test.svelte.ts`, `entryWorkspace.versions.dom.test.svelte.ts`, `time/amendmentList.dom.test.ts`; then `tsc`, then `NODE_OPTIONS=--max-old-space-size=12288 npm run check` (0 errors in your files).

## Out of scope

Docs, NOMENCLATURE, STYLE-GUIDE (another worker); the card section's behaviour; `PresencesPanel`; the Timeline tab; the server; `VersionRail.svelte`, `castVersions.ts`, `castSave.ts`.

## Stop and report when

`EditHistory` needs more than a few lines to serve item 1; a removed piece turns out to do a job nothing else does (name it); a test of the History editor or entry form fails.

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
