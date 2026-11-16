# BRIEF — `time-t4b` worker 2 — the version rail takes any subject's versions, and its writes from the page

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4b`. The rules section at the end of this file is part of this brief.

## Goal

`time/VersionRail.svelte` (built for entries by lane `time-t4a`) is about to draw a cast member's versions too. Give it a **subject-neutral version shape** and take its two writes (change a date, delete) as **callbacks from the page**, with the entry form passing its own. The entry form must behave exactly as it does now, and its tests (`entryWorkspace.versions.dom`, `time/versionRail.dom`, `time/versionDateDialog.dom`, `time/entryVersions.test`) must pass. One rail component, never a second.

## Files owned (edit only these)

- `src/lib/client/lorebooks/time/VersionRail.svelte`
- `src/lib/client/lorebooks/time/VersionDateDialog.svelte`
- `src/lib/client/lorebooks/time/entryVersions.ts` (only the version shape and what fills it)
- `src/lib/client/lorebooks/EntryWorkspace.svelte` — **only** the `<VersionRail …>` mount (~2972–2996) and two new small functions beside `selectVersion` (~1297) that hold the writes the rail does today; nothing else in that file
- tests beside them: `time/versionRail.dom.test.svelte.ts`, `time/versionDateDialog.dom.test.svelte.ts`, `time/entryVersions.test.ts` (and a fixture `.svelte` beside them if a test needs one)

## Read first

`VersionRail.svelte` whole (633 lines), `VersionDateDialog.svelte` whole, `entryVersions.ts` whole, `EntryWorkspace.svelte` 1120–1335 and 2890–3040, and the three test files.

## Build

1. **A neutral version shape** in `entryVersions.ts` (🚧 doc comments):
   ```ts
   /** One version on the rail, whatever it is a version of. */
   export interface RailVersion {
     key: string
     kind: "beginning" | "dated"
     date: StoryDate | null
     branchId: number | null
     own: boolean
     /** The field keys it changes, captioned by the rail's `describe`. */
     changes: string[]
     /** Its date can be changed in place. */
     movable: boolean
     /** The edit-history subjects whose rows sit under it (the rail's `edits` snippet gets these). */
     editIds: readonly (number | null)[]
     /** Shown and selected only: it is changed elsewhere (a session's version). */
     locked?: boolean
     /** Words beside its date, when another version shares the date. */
     chip?: string | null
     /** The one the lorebook reads at its date, when several share it. */
     readHere?: boolean
   }
   /** A version on a line the reading does not read (the rail's Elsewhere group). */
   export interface RailElsewhere {
     id: number
     branchId?: number | null
     year: number
     month?: number | null
     day?: number | null
     fields: Record<string, unknown>
     locked?: boolean
     chip?: string | null
   }
   ```
   `EntryVersion` becomes `interface EntryVersion extends RailVersion { rows: EntryRow[]; editRow: EntryRow | null }`; `entryVersions()` fills `movable` (`rows.length <= 1` for a dated version, `false` for the beginning) and `editIds` (`versionRedlineIds(v)`, which stays exported and unchanged). `EntryRow` already fits `RailElsewhere`. Add a test that `entryVersions` fills both.

2. **The rail is generic over them**: `<script lang="ts" generics="V extends RailVersion, E extends RailElsewhere">`; `versions: V[]`, `elsewhere: E[]`, every callback typed with `V` / `E`. Remove its `socket`, `lorebookId` and the `entrySave` imports. New props:
   - `onRedate: (target: { version: V } | { row: E }, date: StoryDate) => Promise<unknown>` and `onDelete: (target: { version: V } | { row: E }) => Promise<unknown>` (required). The rail keeps what it does around them today: `busy`, the "did not answer in time" line on `isReplyTimeout`, closing the dialog, `onRedated` / `onDeleted` after success, focus to the version before after a delete. A rejection that is not a timeout leaves the dialog/confirm as today (the shell toasts refusals).
   - `describe?: (keys: string[]) => string`, default `changesWords` — every place the rail captions with `changesWords(...)` uses it (versions and Elsewhere rows: `describe(Object.keys(r.fields))`).
   - `deleteSentence?: (when: string, line: string | null) => string` — default the two sentences the rail says today (*Delete the version dated ‹when›? From then on the entry reads as the version before it, and this version's edit history goes with it.*, and the Elsewhere one with *on ‹line›*). `line` is null for a version on the rail, the line's name for an Elsewhere row.
   - `takenAt?: (date: StoryDate, moving: V | null) => V | null` — default the entry rule (`takenVersion(versions, date, lineBranchId)`, ignoring `moving` itself). Used for the add dialog (`moving` null, merge) and the re-date dialog (refuse).
   - `addBlocked?: string | null` — when set, every **+ Add a version here** button (wide and narrow) is `disabled` and carries it as its `title`; the default null changes nothing.
   - Keep `onSelect`, `onAdd`, `onOpenOnLine`, `onRedated`, `onDeleted`, `edits`, `children`, `selectedKey`, `lineBranchId`, `readOnly`, `lineName` as they are. The `edits` snippet is rendered with `v.editIds` (wide) and `[r.id]` (Elsewhere), as today.
3. **Locked versions, chips and *read at this date*.** A `locked` own version shows and selects like any other but its head offers no **Change its date** / **Delete this version**, and an Elsewhere row with `locked` offers no **Change its date** / **Delete** (it keeps **Open on ‹line›**). **Change its date** shows only when `selected.movable`; the existing sentence *Saved more than once at this date, so it can't be moved; delete it and add it again to move it.* shows only when `!selected.movable && !selected.locked` on a dated own version (that is the entry case it was written for). A version's `chip` is drawn under its date on the rail button and in the head (`text-surface-700-300 block text-xs font-normal`), and appended to the strip chip's words as ` · ‹chip›`. A version with `readHere` gets the words 🚧 *read at this date* under its date on the rail button and in the head, same class. With none of these set (every entry version) nothing renders differently.
4. **The date dialog takes any subject**: `taken: (date: StoryDate) => object | null` (it only tests for a value); its header comment says "a version" rather than "an entry version". Nothing else changes.
5. **The entry form passes its own writes**, unchanged in behaviour: two functions beside `selectVersion` in `EntryWorkspace.svelte` holding exactly what the rail does today — re-date: `updateEntryAmendment(socket, { lorebookId, id: target.version ? target.version.editRow!.id : target.row.id, subject: "entry", year, month, day })`; delete: a version's rows sorted by id, each `deleteEntryAmendment(socket, { lorebookId, id, subject: "entry" })`, or the one Elsewhere row. The mount passes `onRedate` / `onDelete` and drops `{lorebookId}` if the rail no longer takes it. Import what is needed from `./editor/entrySave` (already imported there? check).
6. **Tests.** Update `versionRail.dom` so it passes the callbacks (recording calls) instead of mocking `entrySave`, keeping every assertion about what is sent (now: the callback's target and date); add: a `locked` version has no Change its date / Delete; a `chip` and *read at this date* are drawn; `addBlocked` disables the add buttons with its title; a custom `describe` and `deleteSentence` are used. `entryVersions.test` gains the `movable` / `editIds` check. Run `time/versionRail.dom.test.svelte.ts`, `time/versionDateDialog.dom.test.svelte.ts`, `time/entryVersions.test.ts`, `src/lib/client/lorebooks/entryWorkspace.versions.dom.test.svelte.ts` (find its exact path with `ls`), each as the rules say; then `tsc`.

## Out of scope

Anything about cast members (another worker builds the cast page against this rail); the entry form beyond the mount and the two functions; `AmendmentList.svelte`; `EditHistory.svelte`; moment code.

## Stop and report when

the generic component does not type-check in svelte-check/tsc in a way you cannot solve without `any` on the public props; an entry test fails for a reason that is not the callbacks move; keeping a behaviour would need a change in `EntryWorkspace.svelte` beyond the mount and the two functions.

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
