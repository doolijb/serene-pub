# BRIEF — worker `kn-4a2-w2` — the **Knows** tab on a cast member

Repo `/home/jody/github/serene-pub` (app; no SDK change). Supervisor: lane `kn-4a2`. Paths below are under
`src/lib/` unless they start with `src/`, `docs/` or `plans/`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`. Never `git checkout` / `restore`. Never `prettier --write`, nor a scratch-copy
equivalent. No migration. No server change. No full test run, no build.)

## Goal

The owner: "The pool on the character and *Known by* on the entry are the two ends of the same ties", and "a
'pool' view where entries can be dragged in and out"; programme: "**Knows** on the cast member (buttons +
drag)". Owner only. Build a **Knows** tab on a cast member's page, on the existing socket door and the existing
store. Read fully first: `client/lorebooks/knowledge/bookKnowledge.svelte.ts`, `KnownByList.svelte`,
`knownByWords.ts`, `bookKnowledge.dom.test.svelte.ts`, `knownByList.dom.test.svelte.ts`,
`server/sockets/entryKnowledge.ts`, `shared/sockets/types.ts` 18910–19029 (`Sockets.EntryKnowledge`),
`client/lorebooks/editor/rowDrag.ts`, `EntryPool.svelte` 160–180 and ~631 (how a row uses `rowDrag` and the
drop-state class), `client/components/panels/PanelFilterInput.svelte`, `client/components/EmptyState.svelte`,
`client/lorebooks/sections/kinds.ts` (`kindLabel`), `client/lorebooks/bookData.svelte.ts` 36–107, and in
`client/lorebooks/CastWorkspace.svelte`: props 149–222, `readOnly` ~245, `memberTab` ~333, `selectedMember`
~392, `momentDate` ~838, `memberTabs` 869–886, the tab strip and tabpanels 2196–2631. Test models:
`client/lorebooks/cast/castWorkspace.timelineOff.dom.test.ts` (mounting `CastWorkspaceFixture`) and
`client/lorebooks/entryWorkspace.knowledge.dom.test.svelte.ts` (a fake socket that records emits and dispatches
replies).

### The door you use, unchanged

`entryKnowledge:list {lorebookId, castMemberId, branchId, moment}` answers `markedEntryIds` (every marked entry
of the book) and `rows`: one per entry that is **marked** or that the member has **any active tie** to, each
`{castMemberId, name, entryId, known, winner{tieId, kind, relationshipType, hand, date} | null, hand, placeEntry}`
(names and types of entries are **not** in it). `entryKnowledge:setTie {lorebookId, castMemberId, entryId, hand:
"knows" | "kept_from" | null, branchId, moment}` replies with the pair's judged `row`. Owner only; every reply
carries `lorebookId`.

## Build

### 1. The store (`bookKnowledge.svelte.ts`) — one store, one listener

Add a member read beside the entry read, same patterns (untracked methods, a sequence number per read so an
earlier answer is dropped, a fallback sentence on failure): `showMember(castMemberId | null, reading)`, getters
`memberId`, `memberRows`, `memberRowsLoaded`, `memberRowsError`. One `#reading` per store: `showEntry` and
`showMember` both set it, and `setTie` judges at it (as today). After a write or a pushed reply:
`#applyTie` also updates the member's rows (replace by `entryId`, or append) when `res.castMemberId` is the shown
member, re-reading instead when the reply's reading differs; `#applyMarks` re-reads the member's rows when a
member is shown (the marks change which rows come back and their `known`). `open()` resets the member state on a
book change as it does the entry state. No new listener: the existing two `declareInterest` calls serve both.
Update the header comment (the store is provided by the entry workspace **and** the cast workspace, which are
never mounted together, so one listener either way).

### 2. `KnowledgeSwitch.svelte` (new, in `knowledge/`)

The three-way switch extracted from `KnownByList`: a `role="group"` labelled by a given id, buttons **Default** ·
**Knows** · **Kept from** (`aria-pressed`, `preset-pressed` / `preset-tonal-surface`, `btn btn-sm
pointer-coarse:min-h-11`, `data-known-by-option` = `default` / `knows` / `kept_from`), disabled while busy.
`KnownByList` uses it with **identical** output, so `knownByList.dom.test.svelte.ts` passes unchanged.

### 3. `knowsPool.ts` (new, pure) and `KnowsPool.svelte` (new) — the tab body

Presentational like `KnownByList` (props in, `onSet` out; keeps only per-row pending flags and refusals in a
`SvelteSet` / `SvelteMap`; a refusal is a `role="alert"` line in the row, never a toast). Props: `memberName`,
`rows` (the member's rows), `loaded`, `error`, `entries` (`{ id, name, typeId }[]`: the book's entries),
`isMarked(entryId)`, `formatDate`, `onSet(entryId, hand | null) => Promise<unknown>`.

`knowsPool.ts` holds the arithmetic, tested without a screen:
- **Tied** zone = rows with a `winner` or a `hand`, sorted by entry name.
- **Other** zone = the entries not in Tied: **marked first** (`isMarked`), then the rest, each group by name;
  narrowed by the filter text (case-insensitive substring of the name) — the filter narrows only this zone.
- **Count** = rows with `known && winner && winner.kind !== "kept_from"` (the same rule as Known by's count).
- An entry a row names that is not in `entries` (another book's) shows as *Untitled* with no type.

`KnowsPool.svelte` draws, top to bottom (stacked at every width; nothing wider than the column):
- One line: *These are this lorebook's ties; a session's notes can hold newer ones, which win in that session.*
  (the existing sentence, verbatim).
- Error → the error in a `role="alert"` line; not loaded → *Reading what ‹name› knows…*.
- **Tied** zone: a `<section aria-labelledby>` with heading *Tied to ‹name›*. Each row: the entry's name, its
  type (`kindLabel(typeId)`, muted), the `KnowledgeSwitch` labelled by the name, and under it in an
  `aria-live="polite"` block the words from `knownByWords(row, isMarked(row.entryId), formatDate)`: `result`,
  then `note` when not null (this is where *Changes nothing until the entry is marked not common knowledge.*
  shows for a common-knowledge entry). Empty: an `EmptyState` (icon `Icons.BookKey`) with *Nothing is tied to
  ‹name› yet. Drag an entry here, or press Knows beside it.*
- **Other** zone: a `<section aria-labelledby>` with heading *Other entries*, a `PanelFilterInput`
  (`placeholder="entries"`, `singular="entry"`, `count` = the zone's size before filtering), then the marked
  group under a small heading *Not common knowledge* and the rest under *Common knowledge* (a group with no rows
  draws no heading). Each row: name, type, and a `role="group"` labelled by the name with two buttons **Knows**
  and **Kept from** (tonal, `btn btn-sm pointer-coarse:min-h-11`), disabled while that row is pending. When
  nothing matches or the book has no other entries, say nothing.
- **Drag** (native `rowDrag`, no new drag helper): each Other row is draggable (key `other:<entryId>`); each
  Tied row **with a hand tie** is draggable (key `tied:<entryId>`; a row tied only by play or an ordinary link
  has no handle: Default would not move it); rows never accept drops (`canDrop: () => false`). Each zone's
  `section` is a target with `rowDrag` (`draggable: false`): Tied accepts `other:` keys and calls `onSet(id,
  "knows")`; Other accepts `tied:` keys and calls `onSet(id, null)`. Drop state is the existing class
  `data-[drop-target]:ring-2 data-[drop-target]:ring-primary-500`. A `dragstart` / `dragend` listener on the
  component root keeps which zone a drag came from; **only while a drag is in flight** the other zone shows its
  hint, a dashed `border-primary-500/70` box with *Drop to set Knows* (on Tied) or *Drop to set Default* (on
  Other). ⚠ `rowDrag`'s row `drop` handler clears its held key before the zone's runs; the zone then reads the
  key from `dataTransfer`, which a browser gives on drop. In tests, dispatch `dragstart` on the row and then
  `dragover` + `drop` **on the zone's section itself**, with a fake `dataTransfer` like
  `sessionLayout/arrangeCanvas.dom.test.svelte.ts` `dragEvent` (58–69).
- Every drag has a button path: Tied's switch (Default returns a row; Knows / Kept from set it), Other's two
  buttons. Every control is a `button`, keyboard reachable, 44px on a coarse pointer.

### 4. `CastWorkspace.svelte`

- Create the store once for this workspace: `const knowledge = new BookKnowledge(socketKnowledgeApi(socket));
  setBookKnowledge(knowledge)`, as `EntryWorkspace.svelte` 1211–1212 does (the two workspaces are never mounted
  together, `lenses/PoolMount.svelte` 77–117, so there is one listener).
- `$effect`: `if (readOnly) return; return knowledge.open(lorebookId)` (a share reader / administrator never
  asks).
- `$effect`: `knowledge.showMember(knowledge.loaded && selectedMember ? selectedMember.id : null, { branchId:
  line.branchId ?? null, moment: momentDate ? { year, month ?? null, day ?? null } : null })`.
- `memberTabs`: after **Lore**, `{ value: "knows", label: "Knows", icon: Icons.BookKey, count }` with `count`
  from `knowsPool.ts` once `memberRowsLoaded` (else undefined), **only when `knowledge.loaded`** (a non-owner,
  including a session member whom the client calls an owner of the notes book but the server refuses, never
  sees it, and sees no refusal). If the remembered `memberTab` is `"knows"` and the tab is not offered, show
  **Member** instead.
- A `role="tabpanel"` `id="cast-member-knows"` `aria-labelledby="cast-member-knows-tab"` after Lore's, mounted
  only while `memberTab === "knows"` (as Sprites is), holding `KnowsPool` with `entries` from `book.rows` (every
  type's rows on the line, not archived: `{ id, name, typeId }` only — never a new read) and `onSet = (entryId,
  hand) => knowledge.setTie(selectedMember.id, entryId, hand)`.

## Files owned (edit only these)

`src/lib/client/lorebooks/knowledge/bookKnowledge.svelte.ts`, `KnownByList.svelte` (switch extraction only), new
files in `src/lib/client/lorebooks/knowledge/` (`KnowledgeSwitch.svelte`, `knowsPool.ts`, `KnowsPool.svelte`,
their tests), `src/lib/client/lorebooks/CastWorkspace.svelte`, `bookKnowledge.dom.test.svelte.ts`, a new test
for the tab in a real `CastWorkspace` (e.g. `src/lib/client/lorebooks/cast/memberKnows.dom.test.ts`).

A second worker is editing, at the same time, `knownByWords.ts` and its test, `EntryWorkspace.svelte`,
`sections/EntryInspector.svelte`, `server/lorebooks/entryKnowledge.ts`, `knownByTab.dom.test.svelte.ts`,
`entryWorkspace.knowledge.dom.test.svelte.ts` and one assertion in `knownByList.dom.test.svelte.ts`. **Do not
touch those.** It changes only `noteOf`'s override note in `knownByWords.ts`; in your tests assert the `result`
words and *Changes nothing until the entry is marked not common knowledge.* (for a hand *Knows* tie that wins on
an unmarked entry), never an override note.

## Out of scope

Any server or wire change; a new read of every entry; changing the judging; play writing ties; cast Memory; a
graph view; any setting; docs and `NOMENCLATURE.md` (the supervisor's).

## Stop and ask when

A file not listed is needed; a sentence other than those above seems needed; the store cannot serve the member
read without a second listener; an existing test outside your list breaks. Put it in your report and stop.

## Rules you work under (quoted)

- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
  "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." "Browser code
  runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." "Sockets: one
  domain context per event family … is the only listener, and the only place that toasts; views register
  listeners for local state and never call `toaster`."
- Memory: untrack reads in effect-called store methods (a method an effect calls must not read state it then
  writes, or the effect loops).
- STYLE-GUIDE §6.7: "A drop target shows its hint only while a file is over it, as an overlay with a dashed
  `primary-500/70` border and a short imperative"; "An empty state is `EmptyState`, everywhere".
- STYLE-GUIDE §9: "Every interactive element is a real `button`… with an accessible name." "Never an interactive
  inside an interactive." "Targets are 44px on touch. A 32px control gets a 44px hit area on coarse pointers."
  "Nothing is hover-only."
- STYLE-GUIDE §10: "No filler: a screen with nothing to say says nothing." "Sentence case everywhere."
- STYLE-GUIDE §6.5: tabs inside a detail are `PanelTabStrip`.
- Comments state the rule, not the story. Mark new names 🚧 in their header comments.
- Tests: no DOM node is ever handed to `expect`.

## Done means

1. Tests, each run as (wait first; one run at a time; never pipe vitest into `head`):
   ```
   until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
   systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-4a2-w2-<n>.log 2>&1"
   ```
   Cover: the store's member read (asks by `castMemberId` at the reading; a stale answer dropped; a `setTie`
   reply and another tab's reply update the member's rows; a marks reply re-reads them; no extra listener);
   `knowsPool.ts` (zones, marked first, filter, count, unknown entry); `KnowsPool` (both zones; the switch calls
   `onSet` with each hand; Other's **Knows** and **Kept from**; a drop on Tied sets Knows; dragging a hand row
   onto Other returns Default; a row with no hand is not draggable; the hints only while dragging; a common
   entry's sentence; a refusal in place; **axe clean**, as `knownByList.dom.test.svelte.ts` runs it); the tab
   in a real `CastWorkspace` (the owner sees **Knows** after the marks read, with its count after the member
   read; a reader of a shared book sends no read and sees no tab; a member whose read is refused sees no tab
   and no alert; pressing a button sends `entryKnowledge:setTie` with the member, entry, hand and reading).
   Then re-run: `knownByList.dom.test.svelte.ts`, `bookKnowledge.dom.test.svelte.ts`, and every
   `src/lib/client/lorebooks/cast/*.dom.test.ts` plus `src/lib/client/lorebooks/lineConformance.screens.dom.test.ts`
   and `src/lib/client/lorebooks/entryEarmark.dom.test.ts` (they mount `CastWorkspace`).
2. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/kn-4a2-w2-tsc.log 2>&1` → 0 errors in
   your files (list others; do not fix them).
3. `npx prettier --check` on every file you changed.

## Report

Your final message: changed files; where the store is provided; each test run (log path, files, counts); tsc;
prettier; every user-visible sentence you put on screen; anything not done and why; **Noticed, not done**. Under
500 words.
