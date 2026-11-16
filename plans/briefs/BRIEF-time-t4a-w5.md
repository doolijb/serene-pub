# BRIEF — worker `time-t4a-w5` — the entry form mounts the version rail

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4a`. Report: your final message (under ~700
words): changed files, what each replaced control's job became, tests run with results, every label and
sentence added, anything you could not do.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Context and owner rulings

In a lorebook that keeps a timeline, the entry form shows an entry as one entry with **versions** over story
time, on a rail beside the fields. Rulings:

- 2026-11-13: "For living entries and when making edits to existing perpetual entries, we should show the
  option to change the effective date of that version. Save edits that version, but also need a button to save
  as a new dated version. It would be neat to be able to toggle off undated history edits and then navigate the
  dated versions like a vertical timeline, adding new versions before or after."
- 2026-11-14, "Lets go with all your recommendations": the rail beside the fields, folding to a strip when
  narrow; the form in two zones (the entry; the version); **this replaces Save as of ‹date›, Change the base
  and the *Amendments* list in the entry form**; one version per entry, line and date; a version cannot be
  dated before the entry's Beginning.
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't
  enabled." With the Timeline off: no rail, no strip, no version date; one plain form as today.
- 2026-11-14 (selection): **"Yes, move the moment bar"**. Clicking a version on the rail sets the workspace's
  moment to that version's date (*From the beginning* on a Perpetual entry: the year before its first dated
  version; `momentOfVersion`). The moment bar and the rail are then one selection: the rail's selected version
  is always the one in force at the moment (`versionAt`). With unsaved edits, a change of moment that would
  change the version asks first (keep editing / discard), once, as switching entry does; **the existing rule
  that a dirty draft keeps its moment is replaced by that question** for railed entries. The route's moment
  param changes as the moment bar's does today.
- Lead's rulings: a version the line inherits shows read-only with *from ‹line›* (Save is off for it; **Save
  as a new version…** still works and writes on the line being read). Only the line's own versions and, on the
  line that owns the entry, *From the beginning* are editable in place. Old data's two rows at one date are one
  version; editing it edits the later row (`editRow`). History entries get **no rail** and keep their
  `AmendmentList`, **Save as of** and **Change the base** exactly as today (a history entry is a date; another
  page's compile writes its dated changes).

## What already exists (read these first)

- `src/lib/client/lorebooks/time/entryVersions.ts` — `entryVersions`, `versionAt`, `momentOfVersion`,
  `carriedFields`, `zoneOf`, `splitVersionSave`, `splitNewVersion`, `bounds`, `takenVersion`, `changesWords`.
- `time/VersionRail.svelte` (props: `lorebookId`, `versions`, `elsewhere`, `selectedKey`, `lineBranchId`,
  `readOnly`, `lineName`, `onSelect`, `onAdd(date)`, `onOpenOnLine(branchId, date)`, `onRedated?(v, date)`,
  `onDeleted?(v)`, `children` = the fields, rendered once) and `time/VersionDateDialog.svelte` (props `open`,
  `title`, `description`, `initial`, `bounds`, `taken`, `takenMode`, `confirmLabel`, `busy?`, `onConfirm(date)`,
  `onCancel`). The rail does its own re-date and delete writes.
- `editor/entrySave.ts` — `fileEntryAmendments` (create; matches a merge too), `updateEntryAmendment`,
  `deleteEntryAmendment`.
- `time/versionZones.ts` — `setVersionZones` (another worker after you wires the zones UI; you set the context
  with `railed` and `zoneOf` using an empty promoted set, and `sameEverywhere` returning
  `{ blocked: "" }` for now — the next worker replaces it).
- The route: `loreRoute` (`./loreRoute.svelte`) with `navigate`, `navigateTo`, `set`, `confirmLeave`;
  `reduce` and `momentKey` from `$lib/shared/lorebooks/loreRoute` (`{ type: "setMoment", moment }`,
  `{ type: "setBranch", branch }`). The moment bar sets the moment with
  `loreRoute.set(reduce(route, { type: "setMoment", moment }))` (`LorebooksWorkspace.svelte` ~1735, not
  yours): use the same.
- `openBookTime` (`time/bookTime.svelte.ts`): `lineName(branchId)`, `branches`.

## Build, in `src/lib/client/lorebooks/EntryWorkspace.svelte`

Inventory (line numbers before your edits): props ~122–231 (`amendmentsFor`, `line`); `timelineOn` 267;
`momentDate` 1045; `draftMoment` 1047–1059; `canAmend` 1061–1075; `pendingFields` 1078; `saveAsAmendment`
1169–1215; `fileOffWindow` 1264; `baseSaveWarning` 1305; `save()` 1337–1444; `dirty` ~716; `discardDraft` ~923;
the draft effects ~1505–1545; `editorMenu` 1988–2079 (Pinned/Off toggles, Archive, Off for a while…, Clear edit
history); `amendSave` snippet 2081–2162; the editor header 2164–2247; the fieldset + `Editor` 2278–2293; the
`AmendmentList` + `EditHistory` mounts 2297–2312.

1. **When the rail is drawn** — `railed`: `timelineOn && !isNew && !libraryOpen && activeDoor.store ===
   "entries" && activeDoor.kind !== HISTORY_TYPE_ID && selectedSource != null`. Derive `rail =
   entryVersions({ entry: selectedSource, amendments: amendmentsFor?.(id) ?? [], line })`,
   `shownVersion = versionAt(rail.versions, momentDate)`, `carried = carriedFields(rail.versions)`,
   `promoted = new SvelteSet<ZoneField>()` (cleared in `discardDraft` and when the entry changes),
   `entryEditable = !readOnly && rail.versions[0].own`. Add `promoted.size > 0` to `dirty`.
2. **Mount**: when `railed`, wrap the existing `<fieldset>`+`<Editor>` (and nothing else) as the rail's
   `children`. Pass `selectedKey = shownVersion.key`, `readOnly`, `lineBranchId = line.branchId`,
   `lineName = (id) => openBookTime.lineName(id)`.
3. **The draft's version**: `draftVersionKey` state, following `shownVersion?.key` while the draft is clean
   (as `draftMoment` follows the moment today). Saves use the version with that key.
4. **Selecting a version** (`onSelect`): if it is already shown, nothing; `at = momentOfVersion(...)`, null →
   nothing; if dirty, `if (!(await loreRoute.confirmLeave())) return` then `discardDraft()` (ask first, then
   discard: STYLE-GUIDE §6.14); then `loreRoute.set(reduce(loreRoute.route, { type: "setMoment", moment:
   momentKey(at) }))`. **Open on ‹line›** (`onOpenOnLine`): the same guard, then one `loreRoute.set` of
   `reduce(reduce(route, setBranch), setMoment)` (`branch: branchId ?? undefined`; the date's key or none).
5. **The moment bar moved** (correction 4): an effect on `route.moment` / `shownVersion.key`: when railed,
   dirty, and the shown version's key differs from `draftVersionKey`, ask once with
   `loreRoute.confirmLeave()` (guard against a second ask while one is open); Leave → `discardDraft()`;
   Stay → put the moment back (`loreRoute.set(reduce(loreRoute.route, { type: "setMoment", moment:
   <the last moment whose version was the draft's> }))`). Do the reads inside `untrack` where the effect writes
   (the effect must not loop). `draftMoment` stays for History only.
6. **Save**, railed: extract the `entries:update` half of `save()` (its `awaitReply`, `baseSaveWarning`,
   refusal handling, success toast) into a function both use. Railed save: `diff = changedFields(draft,
   pristine)`; nothing changed and `promoted` empty → *Nothing has changed* as today; `const { entryPatch,
   versionFields } = splitVersionSave({ diff, draft, selected, carried, promoted })`; `versionFields` →
   `await updateEntryAmendment(socket, { lorebookId, id: selected.editRow.id, subject: "entry", fields:
   versionFields })`; `entryPatch` → the extracted entry write. Keep the draft until the server has it, then
   `settleDraft` as the existing saves do, clear `promoted`, `savedThen`. Success toast `${door.label} saved`
   (the existing words). Focus stays where it was (do not move it).
   **Save is off** (disabled, with a `title`) for a dated version that is not `own`, and for the beginning when
   it is not `own`: title 🚧 `` `This is ${lineName}'s version: open it there to change it, or save it as a new version.` ``
7. **Save as a new version…**: a tonal `btn-sm` beside Save, railed and not read-only. It opens one
   `VersionDateDialog`: title *Save as a new version*, description *What you changed starts at this date; the
   version shown stays as it is.*, `initial = momentDate` (null at now), `bounds = bounds(rail.versions)`,
   `taken = (d) => takenVersion(rail.versions, d, line.branchId)`, `takenMode "merge"`, confirm **Save**.
   On confirm call `createVersionAt(date)`: `diff`; `{ entryPatch, fields } = splitNewVersion(...)`; if the date
   is taken and `fields` is empty, write nothing and just move the moment there; otherwise
   `fileEntryAmendments(socket, { lorebookId, entryId, branchId: line.branchId }, [{ ...date, fields }],
   knownAmendmentIds(entryId))`, then the entry write for `entryPatch` when non-null, then settle the draft,
   clear `promoted`, and set the moment to `momentKey(date)` (settle first so the moment effect does not ask).
   Toast 🚧 `` `Saved as a new version at ${formatDate(date)}${line ? ` on ${line}` : ""}` `` (`lineName(reply,
   branchId)` as `saveAsAmendment` does). The rail's `onAdd(date)` calls the same `createVersionAt`.
8. **The rail's own writes**: `onRedated(v, date)` → when `v` is the shown version, set the moment to the new
   date (the selection follows it). `onDeleted(v)` → when `v` was the draft's version, `discardDraft()`.
9. **What goes, for railed entries**: the `amendSave` split button and the `AmendmentList` mount are not drawn
   (`canAmend` and the `AmendmentList` condition become History only: `activeDoor.kind === HISTORY_TYPE_ID`);
   the ⋯ menu keeps Archive, **Off for a while…**, Clear edit history; Pinned and Off stay where they are for
   now (the next worker moves them into the zones). `saveAsAmendment`, `amendSave`, `draftMoment` and
   `AmendmentList` stay for History. Delete nothing History still uses.
10. **Timeline off**: none of this draws (`railed` is false); the form is as today.

## Files owned

`src/lib/client/lorebooks/EntryWorkspace.svelte`; new test `src/lib/client/lorebooks/entryWorkspace.versions.dom.test.svelte.ts`
(and edits to `EntryWorkspaceFixture.svelte` only if the test needs a prop it lacks). Existing tests to keep
green: `entryWorkspace.timeline.dom.test.svelte.ts`, `entryWorkspace.beginning.dom.test.svelte.ts`.
Read-only: everything else.

## Rules (quoted from the canon; follow them)

- `$state(new Set())` / `new Map()` is not reactive on mutation: `SvelteSet` / `SvelteMap`.
- Sockets: views register listeners for local state only, always `socket.off(event, handler)` with the handler
  (a bare `socket.off(event)` removes every listener app-wide), and never call `toaster`. This file's existing
  pattern of `notify.success` / `notify.warning` after an awaited reply of its own stays; a refusal is toasted
  by the shell's `:error` catch-all, so only a timeout is reported here (`reportUnanswered`).
- No `crypto.randomUUID`, no `navigator.clipboard`.
- STYLE-GUIDE §6.1: one filled primary per surface (Save); Save as a new version… is tonal. §6.14: unsaved
  means different from what is saved; ask first, then discard; one question, one dialog. §9: real buttons with
  names; focus visible; focus stays in place after a save.
- Never `kill -9` anything; no dev server.
- Comments state the rule, not the story. No `prettier --write` on a directory or on a file you did not
  otherwise change (this file may already fail `--check`: do not reformat lines you did not change).
- `NOMENCLATURE.md` R3: in code and comments, *entry version*, never a bare *version* where a card or cast
  version could be meant. No new socket event or server change; if one seems needed, stop and report.

## Done means

DOM tests in the new file (mount through `EntryWorkspaceFixture.svelte`; copy the fake socket and book data
from `entryWorkspace.beginning.dom.test.svelte.ts`; record emitted events): a railed entry draws the rail
(`data-version-rail`) with its versions; the version in force at the route's moment is the one with
`aria-current` (and at now the latest); clicking a version sets `loreRoute.route.moment` to its key; Save on
*From the beginning* emits `entries:update` with only the changed fields; Save on an own dated version emits
`amendments:update` with `{ ...row.fields, ...changed }`; with a dated version shown, a change to the Beginning
goes to `entries:update` and a content change to `amendments:update`; Save as a new version opens the dialog and
emits `amendments:create` with the changed fields at the chosen date; an inherited version's Save is disabled; a
History entry at a moment still shows **Save as of** and the `AmendmentList`, no rail; the Timeline off draws no
rail and no **Save as a new version…**; a read-only book draws the rail with no Save. Run (one at a time; first
check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait while one runs; never pipe vitest into
`head`):

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/entryWorkspace.versions.dom.test.svelte.ts src/lib/client/lorebooks/entryWorkspace.timeline.dom.test.svelte.ts src/lib/client/lorebooks/entryWorkspace.beginning.dom.test.svelte.ts src/lib/client/lorebooks/time/versionRail.dom.test.svelte.ts > plans/time-t4a-w5.log 2>&1"
```

All pass; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep "error TS"` shows nothing in
your files (report the count).
