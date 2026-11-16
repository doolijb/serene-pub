# BRIEF — worker `time-t4a-w3` — the version rail and the date dialog (components)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4a`. Report: your final message (under ~600
words): changed files, props of each component, tests run with results, every label, sentence and aria name
added, anything you could not do.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Context

In a lorebook that keeps a timeline, the entry form shows an entry as one entry with **versions** over story
time, on a vertical **timeline rail beside the fields, folding to a strip above the fields when narrow** (owner,
2026-11-14: "Lets go with all your recommendations"). Owner rulings you build:

- 2026-11-13: "… Save edits that version, but also need a button to save as a new dated version. It would be
  neat to … navigate the dated versions like a vertical timeline, adding new versions before or after."
- 2026-11-14: "Yes, move the moment bar" — clicking a version sets the reading moment to its date; the rail's
  selected version is always the one in force at the moment. (The entry form does the moving; your rail only
  reports the click.)
- Plan §5.1 (ruled): one version per entry, line and date ("a second write that day updates it"); a version
  cannot be dated before the entry's Beginning.
- A version a line inherits (main's, an ancestor's) shows **read-only** with *from ‹line›* and a way to open
  it on its own line. Changes on lines the reading does not read are listed in an **Elsewhere** group at the
  rail's end (change their date, delete, *Open on ‹line›*). A version has no caption field: caption each with
  the existing "changes ‹fields›" words (`changesWords`). Deleting a version removes its edit history (the
  database cascades): the confirmation says so.

The helpers already exist — read `src/lib/client/lorebooks/time/entryVersions.ts` first (`EntryVersion`,
`entryVersions`, `versionAt`, `boundsAfter`, `bounds`, `versionDateProblem`, `takenVersion`,
`TAKEN_SAVE_SENTENCE`, `TAKEN_REDATE_SENTENCE`, `changesWords`) and `src/lib/client/lorebooks/editor/entrySave.ts`
(`updateEntryAmendment`, `deleteEntryAmendment`). Model the dates and the re-date on
`src/lib/client/lorebooks/time/AmendmentList.svelte` (do not edit it) and the date inputs and calendar hint on
`time/BeginningDecayRow.svelte` (`dateProblem` from `$lib/shared/lorebooks/storyDate`, `openBookTime.calendar`,
`formatDate` from `../sections/historyDates`).

## Build

### 1. New `src/lib/client/lorebooks/time/VersionDateDialog.svelte`

A Skeleton `Dialog` in a `Portal` (copy the shell of `editHistory/ClearEditHistoryDialog.svelte`; read the
`# Dialog` section of `AI-TEMP/skeleton-llms-svelte.txt` with `sed -n` only if you need more), role `dialog`
(it picks a value; it removes nothing), `closeOnInteractOutside={false}`. Header: `Dialog.Title` (`h4`), a muted
14px `Dialog.Description` (one sentence), and an `X` `Dialog.CloseTrigger` (`aria-label="Close"`) top right.

Props: `open`, `title`, `description`, `initial: StoryDate | null` (prefill; applied each time it opens),
`bounds: DateBounds`, `taken: (date: StoryDate) => EntryVersion | null`, `takenMode: "merge" | "refuse"`,
`confirmLabel`, `busy?`, `onConfirm(date: StoryDate)`, `onCancel()`.

Body: three inputs Year / Month (optional) / Day (optional), as `BeginningDecayRow` draws them (labels, `min-h-11`,
a day disabled until a month is typed, titled *A day needs a month: the calendar narrows left to right*); under
them one line: the calendar's reading (*Reads as ‹formatDate with calendar›*) or its problem; then
`versionDateProblem`; then, when `taken(date)` is a version, `TAKEN_SAVE_SENTENCE` (merge: confirm stays on) or
`TAKEN_REDATE_SENTENCE` (refuse: confirm off). Footer: **Cancel** (tonal) and the confirm (filled primary,
`confirmLabel`), off while the year is missing or not a whole number, a problem stands, `busy`, or a refused
taken date. Enter in an input confirms when allowed.

### 2. New `src/lib/client/lorebooks/time/VersionRail.svelte` — one component, two layouts by container width

Props: `lorebookId`, `versions: EntryVersion[]`, `elsewhere: Sockets.Amendments.EntryRow[]`, `selectedKey:
string`, `lineBranchId: number | null`, `readOnly: boolean`, `lineName: (branchId: number | null) => string`,
`onSelect(v)`, `onAdd(date: StoryDate)` (after the dialog confirmed), `onOpenOnLine(branchId, date: StoryDate |
null)`, `onRedated?(v, date)`, `onDeleted?(v)`, `children: Snippet` (the selected version's fields).

**Layout** (STYLE-GUIDE §5.3: decide from the component's own measured box with a named container, never the
viewport, never `@sm`): root `@container/versions`. One grid: at `@min-[36rem]/versions:` two columns
(`minmax(10rem,14rem)` and `minmax(0,1fr)`), else one. The rail (`<nav aria-label="Versions"
data-version-rail>`) is `hidden` below the width and shown at it; the strip (`data-version-strip`) is shown below
it and hidden at it. **The fields render once** (`{@render children()}` exactly once, in the right column after
the version head): never twice, since a second mount would duplicate inputs and ids. The rail and the strip may
both be in the DOM; the hidden one is `display: none`.

**The rail**: an `<ol>`. Per version one `<li>` holding a `<button>` that selects it (`aria-current="true"` on
the selected one only; `data-version-key={v.key}`), its words: *From the beginning* (Perpetual) or *Began at
‹date›*, else the date; under it `changesWords(v.changes)` muted (not for the beginning); for a version not
`own`, a muted *from ‹lineName›*; beside the button (never inside it: STYLE-GUIDE §9 "never an interactive
inside an interactive") a quiet text button **Open on ‹line›** for a dated version not `own` and for a
beginning not `own`. Between consecutive versions and after the last, unless `readOnly`, a quiet button
**+ Add a version here** whose `aria-label` says where: *Add a version between ‹a› and ‹b›* / *Add a version
after ‹a›* (‹a›/‹b› = the versions' words: *From the beginning*, *Began at ‹date›*, or the date). It opens the
dialog: title *Add a version*, description *The new version starts as the one before it; change what differs,
then save.*, `initial` = null, `bounds = boundsAfter(versions, v)`, `takenMode "merge"`, confirm **Add**; on
confirm → `onAdd(date)`.

**The strip**: the same versions as chips in one horizontal row (`overflow-x-auto`, buttons, selected
`aria-current`, `preset-pressed` per STYLE-GUIDE §2.4), with a **+** chip after each (unless `readOnly`), the same
`aria-label`s as the rail's add buttons.

**Elsewhere** (only when `elsewhere.length`): at the rail's end a muted heading **Elsewhere** and one row per
change: its date, `changesWords`, where it is (*on ‹line›*, or *on ‹line›, after the fork* when its line is an
ancestor of the reading line — `isOnLine` in `lineReading.ts`; read `whereItIs` in `AmendmentList`), and, unless
`readOnly`, **Change its date** and **Delete**, plus **Open on ‹line›** always. In the narrow layout the same
group sits after the fields, in a `<details>` whose summary is *Elsewhere · ‹n›*. (Drawing the snippet twice is
fine here: it has no inputs.)

**The version head**, above the fields, for the selected version:
- beginning: *From the beginning* or *Began at ‹date›*; not `own`: *from ‹line›* and **Open on ‹line›**.
- dated, `own`: *This version begins ‹date›* · `changesWords`; unless `readOnly`: **Change its date** (tonal
  surface `btn-sm`) and **Delete this version** (`preset-tonal-error` `btn-sm`). With more than one stored row
  (`v.rows.length > 1`) **Change its date** is not drawn; instead a muted line *Saved more than once at this
  date, so it can't be moved; delete it and add it again to move it.* (🚧, the supervisor will put it to the
  owner).
- dated, not `own`: *‹lineName›'s version from ‹date›* · `changesWords` · **Open on ‹line›**.

**Change its date**: the dialog with title *Change its date*, description *The version moves; what it says stays
the same.*, `initial` = its date, `bounds = bounds(versions)`, `takenMode "refuse"`, confirm **Move**. On confirm
`await updateEntryAmendment(socket, { lorebookId, id: v.editRow.id, subject: "entry", year, month, day })`, then
`onRedated?.(v, date)`. Elsewhere rows use the same dialog for their own row (taken = none: another line's
dates are that line's business; the server still refuses a taken one).

**Delete this version**: an inline confirmation in the head (as `AmendmentList` ~271–294 does): *Delete the
version dated ‹date›? From then on the entry reads as the version before it, and this version's edit history
goes with it.* **Delete** (`preset-tonal-error`) · **Cancel**. On yes, `deleteEntryAmendment` for each row of
`v.rows` in id order, then `onDeleted?.(v)`, then focus the rail button of the version before it (STYLE-GUIDE
§6.6: when a yes removes the control it was asked from, focus goes to the nearest control that brings it back).
Elsewhere rows: the same sentence with *on ‹line›*.

A refused write is toasted by the shell's `:error` catch-all already; the rail **never toasts** and does not
repeat it. Only a reply that never came (`isReplyTimeout` from `$lib/client/utils/awaitReply`) is said inline
under the head: *The server did not answer in time.*

`readOnly` (a shared book's reader): every version selects; no add, no change of date, no delete; **Open on
‹line›** stays.

## Files owned

New: `src/lib/client/lorebooks/time/VersionRail.svelte`, `time/VersionDateDialog.svelte`,
`time/versionRail.dom.test.svelte.ts`, `time/versionDateDialog.dom.test.svelte.ts`, and a test-only fixture
component beside them if you need one to pass a `children` snippet (name it `VersionRailFixture.svelte`, doc
comment *Test fixture … never mounted by the app*). Nothing else.

## Rules (quoted from the canon; follow them)

- Svelte 5 runes. `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` /
  `SvelteMap` from `svelte/reactivity`.
- Sockets: use `useTypedSocket()`; views register listeners for local state only, always
  `socket.off(event, handler)` with the handler (never bare `socket.off(event)`: it removes every listener
  app-wide), and **never toast**. The two helpers from `entrySave.ts` already wait for the reply for you.
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`.
- STYLE-GUIDE §6.1: one filled primary per surface (here: the dialog's confirm only); a destructive action is
  never the primary; quiet actions are text buttons. §6.6: dialogs portaled, `z-50`, header Title +
  Description + X. §9: every control a real button with an accessible name; selection announced with
  `aria-current`; nothing hover-only; 44px targets on touch (`min-h-11` on coarse pointers, or the
  `pointer-coarse:` variant). §10: sentence case; a button says what happens; help is one sentence.
- Copy: use the words above exactly; any other user-facing word you need, keep it to the sentence style above
  and list it in your report. `NOMENCLATURE.md` R3: in code/comments say *entry version*, never a bare
  *version* where a card or cast version could be meant.
- Comments state the rule, not the story. No `prettier --write` on a directory or on a file you did not
  otherwise change; `npx prettier --check` yours.

## Done means

DOM tests (happy-dom; look at `time/beginningDecayRow.dom.test.svelte.ts` and
`editHistory/editHistoryVersion.dom.test.svelte.ts` for mounting with a fake socket): the rail's order and
words (beginning, a main version inherited on a fork with *from main* and **Open on main**, the fork's own);
the selected one alone has `aria-current`; a click calls `onSelect` with that version; add buttons' names and
the add dialog's bounds (a date outside the gap shows the sentence and the confirm is off; inside calls
`onAdd`); a taken date in the add dialog shows `TAKEN_SAVE_SENTENCE` and still confirms; **Change its date**
sends `amendments:update` with the date and calls `onRedated`; onto a taken date the dialog shows
`TAKEN_REDATE_SENTENCE` and the confirm is off; a two-row version has no **Change its date** and shows the
sentence; **Delete this version** asks, then sends `amendments:delete` per row; Elsewhere lists another
line's row with *on ‹line›* and its actions; `readOnly` draws no add, change or delete; the strip holds the same
versions; `children` is rendered exactly once. Run (one at a time; first check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait while one runs; never pipe vitest into `head`):

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/time/versionRail.dom.test.svelte.ts src/lib/client/lorebooks/time/versionDateDialog.dom.test.svelte.ts > plans/time-t4a-w3.log 2>&1"
```

All pass; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep "error TS"` shows nothing in
your files; also run `npx svelte-check --threshold error --workspace src/lib/client/lorebooks/time 2>&1 | tail -5`
if it finishes in reasonable time and report its tail.
