# BRIEF — worker `time-t4a-w6` — the entry form's two zones: the entry area

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4a`. Report: your final message (under ~600
words): changed files, tests run with results, every label and sentence added, anything you could not do.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Context and owner rulings

The entry form (`src/lib/client/lorebooks/EntryWorkspace.svelte`) now mounts the version rail for a stored,
non-History entry while the book keeps a timeline (`railed`, `rail`, `shownVersion`, `draftVersion`,
`carried`, `promoted` (a `SvelteSet<ZoneField>`, counted in `dirty`), `saveVersion`, `createVersionAt`,
`writeEntryFields`, `setVersionZones` at ~1092–1140; the rail mount ~2603–2629; the `fields` snippet ~2581;
the header ~2450–2580; `markToggle` ~2243; `editorMenu` ~2273). The form is in **two zones: the entry; the
version** (owner 2026-11-14, "Lets go with all your recommendations"). The zones rule (owner 2026-11-14: "A
makes sense"):

> One rule: **a field is the entry's until it is made to differ at a date.** Storage is unchanged; this is only
> how the form shows it. Always the entry's, shown in the entry row, never per version: line, Beginning, Decay,
> archive. **Keywords, Pinned, Off and Part of** (and only these four): when no dated change on the line being
> read carries the field, it shows once in "the entry" area and editing it writes the entry's own stored value
> (it changes everywhere; where other lines read the entry the existing whole warning applies). Each of the
> four has a small action **Change from this version…**, offered while a dated version is selected: it moves
> the field into that version's fields, marked *differs by version*, and from then on the field is edited per
> version (the dated change carries it), on every version of the entry on this line. **Make it the same
> everywhere** on such a field removes it from every dated change of this line's own (after a confirmation
> naming how many versions change) and it returns to the entry area with the value of the version shown.
> Inherited versions of other lines are not touched; if one of them carries the field it stays *differs by
> version* and the action says why it is not offered. A field already dated today (an existing **Off for a
> while…**) simply shows as *differs by version*. **Off for a while…** itself stays as it is. Name, Content and
> the type's own fields are always the version's. A field that is the entry's saves to the entry even while a
> dated version is selected (already built in `splitVersionSave`).

And (lead, correction 1): "Only the line's own versions and, on the line that owns the entry, *From the
beginning* are editable in place." The entry area writes the entry's own stored values, so it is editable only
where *From the beginning* is: `rail.versions[0].own && !readOnly`. "Saving *From the beginning* where other
lines read the entry carries today's whole warning ('everywhere, on every line and at every moment')."

Already built for you (read first): `time/versionZones.ts` (`VersionZones`, `DIFFERS_BY_VERSION_LABEL`,
`SAME_EVERYWHERE_LABEL`, `CHANGE_FROM_VERSION_LABEL`, `SAME_EVERYWHERE_CONFIRM`, `sameEverywhereQuestion`);
`sections/EntryCoreFields.svelte` (railed: skips Keywords / Part of in the entry zone; in the version zone draws
them with *differs by version* and **Make it the same everywhere** + inline confirm); `sections/EntryAdvancedFields.svelte`
(railed: no `BeginningDecayRow`); `time/BeginningDecayRow.svelte` (`lineWords`, `children` drawn under the row,
outside its fold); `time/entryVersions.ts` (`zoneOf`, `sameEverywherePlan`, `blockedSentence`,
`otherLinesRead`); `editor/entrySave.ts` (`updateEntryAmendment`). Right now a railed entry draws **no**
Beginning row at all: you put it back, at the top.

## Build

1. **The entry area**, railed only, drawn above the rail (outside the rail's `children`), inside its own
   `<fieldset disabled={!entryEditable}>` (`entryEditable = !readOnly && rail.versions[0].own`), as a
   `<section aria-label="The entry" data-lore-entry-zone>`:
   - `<BeginningDecayRow bind:draft idPrefix="entryZone" lineWords={`On ${openBookTime.lineName(selectedSource.branchId ?? null)}`}>`
     with a `children` snippet holding, for each of the four whose `zoneOf` is `entry`:
     - Keywords: `<div data-lore-field="keywords"><KeywordChips bind:keys={draft.keys} idPrefix="entryZone"
       regex={readsAsRegex(draft)} semantic={vectorizationEnabled} /></div>` (as `EntryCoreFields` draws it);
     - Part of: `<PartOfField bind:draft pool={…} newRowBranchId={…} idPrefix="entryZone" />` (the same pool
       context values this file already provides through `setLorePoolCtx`);
     - Pinned and Off: the existing `markToggle` snippet, same labels and hints.
     - Under each, while `draftVersion` is a dated `own` version and not read-only: a quiet text button
       **Change from this version…** (`CHANGE_FROM_VERSION_LABEL`) with an `aria-label` naming the field
       (*Change Keywords from this version* / *Part of* / *Pinned* / *Off*), which does `promoted.add(field)`.
   - When `entryEditable` is false (another line owns the entry), one muted line under the area:
     🚧 `` `The entry belongs to ${lineName}; open it there to change it.` `` with a quiet **Open on ‹line›**
     button (the same handler the rail's `onOpenOnLine` uses, with no date).
2. **Pinned and Off**: railed, they leave the ⋯ menu (the menu keeps Archive, **Off for a while…**, Clear edit
   history). In the version zone they are drawn under the `Editor` inside the rail's `children` (in the same
   `fieldset` as the fields), each as its `markToggle` with the *differs by version* line and **Make it the
   same everywhere**, the same behaviour `EntryCoreFields` has (copy its inline confirm markup).
3. **`sameEverywhere(field)`** in the `setVersionZones` object (replace the `{ blocked: "" }` stub):
   - dirty with anything other than this field → `{ blocked: "Save or discard your changes first." }`;
   - promoted but not carried → `{ count: 0, run: () => promoted.delete(field) }`;
   - `plan = sameEverywherePlan(field, rail.versions, draft[field])`; `plan.blockedBy` →
     `{ blocked: blockedSentence(plan.blockedBy, openBookTime.lineName(plan.blockedBy.branchId)) }`;
   - `!entryEditable` → `{ blocked: <the entry-belongs sentence above> }`;
   - else `{ count: plan.versionsChanged, run }` where `run` writes each `plan.rewrites` row with
     `updateEntryAmendment(socket, { lorebookId, id, subject: "entry", fields })` in order, then
     `writeEntryFields(plan.entryPatch, …)` (the existing entry write), then `promoted.delete(field)`; a timeout
     reported with `reportUnanswered`; `saving` held meanwhile.
   - In `sections/EntryCoreFields.svelte` (and your Pinned/Off copy): when the answer's `count` is 0, run it at
     once without asking.
4. **The whole warning**: railed, while the pending save would write the entry (`splitVersionSave(...)
   .entryPatch !== null` for the current draft) and `otherLinesRead(selectedSource, openBookTime.branches)`, one
   line under the header in `text-warning-700-300 text-xs` (the style the off-window problem uses):
   🚧 *Saving changes the entry itself: it reads this way everywhere, on every line and at every moment, until a
   later version changes it.*
5. Read-only (a shared book's reader): the entry area draws, disabled; no **Change from this version…**, no
   **Make it the same everywhere** (the fieldset disables them; check).

## Files owned

`src/lib/client/lorebooks/EntryWorkspace.svelte`, `sections/EntryCoreFields.svelte` (the count-0 rule only),
`entryWorkspace.versions.dom.test.svelte.ts` (add tests), `sections/entryZones.dom.test.svelte.ts` (the
count-0 case). Read-only: everything else.

## Rules (quoted from the canon; follow them)

- `$state(new Set())` / `new Map()` is not reactive on mutation: `SvelteSet` / `SvelteMap`.
- Sockets: views register listeners for local state only, always `socket.off(event, handler)`, never call
  `toaster`; this file's existing `notify` after its own awaited reply stays the pattern; refusals are toasted by
  the shell's `:error` catch-all, only a timeout is said here.
- No `crypto.randomUUID`, no `navigator.clipboard`.
- STYLE-GUIDE §6.1: one filled primary per surface; a safe action to read twice is `preset-tonal-warning`;
  quiet actions are text buttons. §6.6: a toggle inside the ⋯ popover is a full-width `btn-sm` row with
  `aria-pressed`; outside it the same `markToggle` is fine. §9: real buttons with names; never an interactive
  inside an interactive; nothing hover-only. §10: sentence case; help is one sentence.
- Comments state the rule, not the story. No `prettier --write` on a directory or on a file you did not
  otherwise change. `NOMENCLATURE.md` R3: *entry version* in code/comments.
- No new socket event or server change; if one seems needed, stop and report.

## Done means

Tests (add to `entryWorkspace.versions.dom.test.svelte.ts`): the entry area draws the row *On main · Perpetual ·
Fact* and, when no dated change carries them, Keywords, Part of, Pinned and Off (and the version's fields do not
draw Keywords or Part of); with a dated own version shown, **Change Keywords from this version** moves keywords
into the version's fields with *differs by version*, the form reads *Unsaved changes*, and Save emits
`amendments:update` carrying `keys`; a carried field (a dated row with `enabled`) shows Off in the version zone
with *differs by version*; **Make it the same everywhere** asks with the count and, on yes, emits
`amendments:update` without the key for each own row, then `entries:update` with the shown value; an inherited
carrier blocks it with the sentence; on a fork reading main's entry the entry area is disabled and says whose it
is; the whole warning shows when a fork reads the entry and the save would write it, and not otherwise; the ⋯ menu
has no Pinned/Off when railed and still has them for a History entry. Run (one at a time; first check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait while one runs; never pipe vitest into
`head`):

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/entryWorkspace.versions.dom.test.svelte.ts src/lib/client/lorebooks/entryWorkspace.timeline.dom.test.svelte.ts src/lib/client/lorebooks/entryWorkspace.beginning.dom.test.svelte.ts src/lib/client/lorebooks/sections/entryZones.dom.test.svelte.ts src/lib/client/lorebooks/sections/entryAdvancedFields.dom.test.svelte.ts > plans/time-t4a-w6.log 2>&1"
```

All pass; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep "error TS"` shows nothing in
your files (report the count).
