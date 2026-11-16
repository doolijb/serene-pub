# BRIEF — worker `entry-form-layout-w2` — the entry form's layout: Name and Content first, the entry's fields in the row

Repo `/home/jody/github/serene-pub`. Supervisor: lane `entry-form-layout`. Worker w1 already changed
`time/BeginningDecayRow.svelte` (read it first: its new props `open` (bindable), `disabled`, `held`, `parentName`,
`promotable`, `onPromote`; `children` and `lineAction` now draw **inside** the fold) and added `time/entryZoneWords.ts`.
You move the form's layout to use it. You are the only agent editing `EntryWorkspace.svelte` (3,300 lines: read line
ranges, never the whole file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Owner rulings (quote, do not reinterpret)

- 2026-11-14, the zones: "A makes sense" — a field is the entry's until it is made to differ at a date (Keywords,
  Pinned, Off, Part of); **Change from this version…** / **Make it the same everywhere**.
- 2026-11-15, shown the built form (Name and Content below the fold): "Name and Content first, beside the rail. Fold
  the four entry-held fields into the one-line entry row, so it reads 'On main · Perpetual · Fact · no keywords · top
  level' and opens on demand. Show a single 'Change from this version…' link inside that row." — owner: "Your
  recommendation, ok".
- 2026-11-14: "Keep the form quiet. Beginning and Decay sit in one collapsed row that shows its values in words and
  opens on demand; the defaults should make it rare to open."
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled."
- **It changes where things are drawn, never what is saved.** No server, storage, socket or SDK change. Every save
  must send exactly what it sends today.

## Today (line numbers approximate)

`EntryWorkspace.svelte`: `setVersionZones` ~1159; `entryEditable`, `canPromote`, `askingSame` ~1170–1185; the
focus effect for loose ends ~2006–2025 (`focusField`, `[data-lore-editor] [data-lore-field="…"]`); `markToggle`
snippet ~2411; `editorMenu` (⋯) ~2440 — **leave it exactly as it is**; `changeFromVersion` snippet ~2631;
`entryZone` snippet ~2646–2780 (the row with Keywords, Part of, Pinned, Off as `children` drawn under the toggle, four
*Change from this version…* links, the *The entry belongs to ‹line›* line); `versionMark` snippet ~2782; `fields()`
~2885 (the Editor in a `disabled={readOnly || libraryOpen}` fieldset, then railed Pinned/Off `versionMark`s);
the railed branch ~3039 renders `entryZone()` **above** `VersionRail`. Unrailed, `sections/EntryAdvancedFields.svelte`
mounts `BeginningDecayRow` (not for History, not railed) before its advanced fold, and `sections/EntryCoreFields.svelte`
draws Keywords and Part of after Content (railed: only when they differ by version, with **Make it the same
everywhere**). Pinned/Off are in ⋯ unrailed.

## After (build exactly this)

1. **`time/versionZones.ts`**: add to `VersionZones` one member, `readonly entryZoneRow: boolean` — doc: "The form
   draws the entry zone's row, which holds Keywords, Part of, Pinned and Off while they are the entry's." Nothing
   else changes there.
2. **`EntryWorkspace.svelte`**
   - `let entryZoneRow = $derived(!!draft && activeDoor.store === "entries" && activeDoor.kind !== HISTORY_TYPE_ID &&
     draft.typeId !== HISTORY_TYPE_ID)`; `setVersionZones` gains `get entryZoneRow() { return entryZoneRow }`.
     (History, scenes and the cast keep their own forms.)
   - **Open state**, as the person left it for this entry, not remembered across entries:
     `let rowOpenFor = $state<{ key: string | null; open: boolean } | null>(null)`;
     `let entryRowDisabled = $derived(railed ? !entryEditable : readOnly || libraryOpen)`;
     `let entryRowOpen = $derived(rowOpenFor && rowOpenFor.key === draftKey ? rowOpenFor.open : entryRowDisabled)`
     (a form that cannot write the row opens it: a reader, a library piece, an inherited entry on a fork, an entry after
     a move); `function setEntryRowOpen(open: boolean) { rowOpenFor = { key: draftKey, open } }`; pass
     `bind:open={() => entryRowOpen, setEntryRowOpen}` (Svelte 5.57 function binding).
   - **The keywords loose end lands on a visible control**: in the focus effect, once it has decided to honour the
     request and before `tick()`, when `want.field === "keywords"` and the row holds keys (`entryZoneRow` and
     `zoneOf("keys", carried, promoted) === "entry"`, read inside `untrack`), call `setEntryRowOpen(true)`.
   - Replace the `entryZone` snippet with one `entryZoneRow` snippet:
     `<section aria-label="The entry" class="flex flex-col gap-2" data-lore-entry-zone>` holding
     `<BeginningDecayRow bind:draft idPrefix="entryZone" lineWords={railed ? \`On ${…lineName(selectedSource?.branchId ?? null)}\` : undefined} bind:open={…} disabled={entryRowDisabled} held={heldFields} {parentName} {promotable} onPromote={(f) => promoted.add(f)}>`
     - `lineAction`: today's **Move down the tree…** button, its condition unchanged (`entryEditable && …`, so railed
       only; with the Timeline off it stays in ⋯ as lane `time-t8a` put it).
     - `children`: in this order, each only while `zoneOf(field, carried, promoted) === "entry"`: Keywords
       (`<div data-lore-field="keywords"><KeywordChips …/></div>`, as today), `PartOfField` (as today:
       `pool={bookPool}`, `newRowBranchId={route.branch ?? null}`; its *or drag this row onto another* hint moves with
       it), Pinned and Off (`markToggle`, as today). No per-field *Change from this version…* link.
     - after the row, unchanged: `{#if railed && !entryEditable && !readOnly}` the *The entry belongs to ‹line›* line
       with **Open on ‹line›**.
     - `heldFields = ZONE_FIELDS.filter((f) => zoneOf(f, carried, promoted) === "entry")`.
     - `parentName`: `draft.anchorEntryId` null → `null`; else the `bookPool` item with key `entry#${id}` → its name,
       or `#${id}` when the pool lacks it (as `PartOfField` names a stray parent).
     - `promotable`: `canPromote` ? `[{keys,"Keywords"},{anchorEntryId,"Part of"},{constant,"Pinned"},{enabled,"Off"}]`
       filtered to fields in the entry zone, and dropping `anchorEntryId` when the type is never filed
       (`typeof draft.typeId === "string" && !isFileableEntryType(draft.typeId)`: a place has no Part of to move) : `[]`.
       The control is outside the row's disabled fieldset, so on a fork's own version of main's entry it stays live,
       as the four links did.
   - Delete the `changeFromVersion` snippet, the `!entryEditable && canPromote` links block, the `versionMark` snippet,
     the railed Pinned/Off block in `fields()`, and `askingSame` (once nothing uses them).
   - **Placement**: after the `{#if railed && rail && shownVersion} … {:else} {@render fields()} {/if}` block (so after
     `VersionRail` and its dialog, or after the unrailed fields), render `{#if entryZoneRow}{@render entryZoneRow()}{/if}`.
     Name and Content are then first in the version column (after the rail's own version head, which is out of
     scope), and the document order is header → Name → Content → the version's own fields → the entry row.
   - Keep untouched: `editsToken`, `VersionDateDialog` unmounted for a reader, the moment-guard effect that lets a save
     in flight carry the draft (`askingMoment`), the ⋯ menu (its Pinned/Off for unrailed forms and its **Move down the
     tree…** item stay), the `MoveDownTheTreeDialog` mount and its focus return
     (`[data-lore-entry-zone] [data-lore-beginning-decay] > div > button:not(:disabled)` still matches the row's
     toggle, which now stays live).
3. **`sections/EntryCoreFields.svelte`**: Keywords and Part of draw when `!zones?.entryZoneRow ||
   zones.zoneOf(f) === "version"` (History and fixtures with no row keep them here). After Part of, when
   `differs("constant")` / `differs("enabled")`, draw Pinned / Off as a pressed-toggle button copied from the
   workspace's `markToggle` (same classes, `aria-pressed`, `data-lore-mark="pinned"|"off"`, `Icons.Pin`/`Icons.Ghost`,
   labels *Pinned* / *Off*, hints *Always in the prompt* / *Out of every prompt*, the check mark), each followed by
   the existing `sameEverywhere(field)` snippet. So every *differs by version* field sits with the version, under Name
   and Content and above the advanced fields. Update the doc comment (rule, not story).
4. **`sections/EntryAdvancedFields.svelte`**: remove the `BeginningDecayRow` mount and the imports it alone used; fix
   the doc comment's "The entry's state (Pinned, Off, Archive) is the editor header's ⋯" to say Pinned and Off sit in
   the entry zone's row (and in ⋯ without the versions rail), Archive in ⋯. Do **not** change the user-facing
   sentence *Pinned, in the ⋯ menu: always read in, so priority does not apply.* (the supervisor raises it).
5. **`sections/EntryZonesFixture.svelte`** (test fixture): pass the zones through as today; add `entryZoneRow` where
   the tests need it.

## Files owned (edit only these)

`src/lib/client/lorebooks/EntryWorkspace.svelte` (layout only), `sections/EntryCoreFields.svelte`,
`sections/EntryAdvancedFields.svelte`, `sections/EntryZonesFixture.svelte`, `time/versionZones.ts`, and the tests:
`entryWorkspace.versions.dom.test.svelte.ts`, `entryWorkspace.beginning.dom.test.svelte.ts`,
`entryWorkspace.timeline.dom.test.svelte.ts`, `sections/entryZones.dom.test.svelte.ts`,
`sections/entryAdvancedFields.dom.test.svelte.ts`, `time/versionZones.test.ts`, `time/beginningDecayRow.dom.test.svelte.ts`
(one added test only, below), `time/moveDownTheTreeDialog.dom.test.svelte.ts`, `lenses/readOnlyLenses.dom.test.svelte.ts`,
`lenses/lensMounts.dom.test.svelte.ts`, `lenses/libraryLayer.dom.test.svelte.ts` (all under `src/lib/client/lorebooks/`).
**Never** edit `LorebooksWorkspace.svelte`, `EntryPool.svelte` or any list component (another lane is in them now),
`MoveDownTheTreeDialog.svelte`, `VersionRail.svelte`, any server, shared or SDK file.

## Tests (update only where they pin the old placement; list every change and why)

Add:
- railed and unrailed (Timeline off): Name's input and the Content editor precede `[data-lore-entry-zone]` in
  document order (`compareDocumentPosition`, asserted as booleans);
- the row is closed by default for an editable entry and its closed words include *no keywords* / *top level* (or
  the keyword count / *part of ‹name›*); Keywords' chips are not in the DOM until it opens;
- a `focusField: { entryId, field: "keywords", n: 1 }` on an editable entry opens the row and focuses the keyword
  input (railed; and unrailed if the harness allows);
- the one **Change from this version…** control: offered only with a dated own version selected; lists only fields
  not already differing; choosing *Keywords* moves Keywords out of the row into the version column, marked *differs by
  version*, and the control no longer lists it;
- *differs by version* Pinned / Off draw in the version column above the advanced fold (in EntryCoreFields, before the
  `details` of advanced fields);
- Timeline off: the row exists, closed, holds Keywords / Part of / Pinned / Off and Decay, no Beginning, no line words;
- read-only (reader, library piece): the row is drawn open, every control inside disabled, the toggle live;
- in `beginningDecayRow.dom`: a Beginning the calendar refuses opens the row by itself (set `openBookTime.calendar`
  from `./bookTime.svelte`, reset it after).
Keep green, and do not weaken, every existing save assertion (what `entries:update` / `amendments:*` send).

Run, from the repo root, one command at a time, each time first checking
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and waiting (poll every 30 s) while one runs; never pipe
vitest into `head`:

1. `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/sections/entryZones.dom.test.svelte.ts src/lib/client/lorebooks/sections/entryAdvancedFields.dom.test.svelte.ts src/lib/client/lorebooks/time/versionZones.test.ts src/lib/client/lorebooks/time/beginningDecayRow.dom.test.svelte.ts src/lib/client/lorebooks/time/entryZoneWords.test.ts > plans/entry-form-layout-w2-a.log 2>&1"`
2. `… src/lib/client/lorebooks/entryWorkspace.versions.dom.test.svelte.ts src/lib/client/lorebooks/entryWorkspace.beginning.dom.test.svelte.ts src/lib/client/lorebooks/entryWorkspace.timeline.dom.test.svelte.ts src/lib/client/lorebooks/time/moveDownTheTreeDialog.dom.test.svelte.ts > plans/entry-form-layout-w2-b.log 2>&1`
3. `… src/lib/client/lorebooks/lenses/readOnlyLenses.dom.test.svelte.ts src/lib/client/lorebooks/lenses/lensMounts.dom.test.svelte.ts src/lib/client/lorebooks/lenses/libraryLayer.dom.test.svelte.ts src/lib/client/lorebooks/editHistory/editHistory.dom.test.svelte.ts src/lib/client/lorebooks/entryEarmark.dom.test.ts > plans/entry-form-layout-w2-c.log 2>&1`

All pass. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`: no error in your files (report
others as not yours). Do not run the full suite, `npm run check` or a build.

## Rules (verbatim, apply to everything you write)

- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`.
- Views never call `toaster`. `socket.off(event)` with no handler removes every listener app-wide; always pass the
  handler. No `crypto.randomUUID`, no `navigator.clipboard`.
- Inside an effect, read state you also write only inside `untrack`.
- STYLE-GUIDE §9: real buttons with accessible names; never an interactive inside an interactive; `aria-expanded` on
  anything that opens; opening the row does not move focus; targets 44px.
- STYLE-GUIDE §10: reuse existing words; no new copy beyond what this brief quotes.
- No new names beyond `entryZoneRow` (the zones member and the derived), `rowOpenFor`, `entryRowDisabled`,
  `entryRowOpen`, `setEntryRowOpen`, `heldFields`, `parentName`, `promotable`. Stop and report rather than invent
  one; stop and report if a save would send anything different.
- Comments state the rule, not the story. Never `prettier --write` (on any file); `npx prettier --check <file>` to
  look, and format only the lines you change.

## Report

Return your report as your final message (do not write a report file): what moved where with file:line, changed
files, every test changed and why, tests run with counts and log paths, assumptions, **Noticed, not done**. Under
600 words.
