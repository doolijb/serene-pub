# BRIEF — lane `s4-chr-view`, worker w5 — wire the Characters view onto `characters:page` (2026-11-08)

Supervisor: lane `s4-chr-view` (brief `plans/briefs/BRIEF-s4-chr-view.md`). Repo `/home/jody/github/serene-pub`. Use absolute paths.

## Context — what already exists (read these first, whole)

- `src/lib/shared/characters/characterRows.ts` — `CharacterRow` (every field has a JSDoc sentence), `CharacterRowsFilters`, `CHARACTER_ROWS_DEFAULT_LIMIT` (50), `CHARACTER_ROWS_MAX_LIMIT` (100), 🚧 `CHARACTER_ROWS_STALE_CURSOR`.
- `src/lib/client/contexts/characterRows.svelte.ts` — the ONE listener for `characters:page` / `characters:page:error` (provided by both shells); a view registers with 🚧 `onCharactersPage(listener)` / `onCharactersPageFailed(listener)` during init. It toasts a refused page itself (never on a stale cursor). **The view never toasts a page and never listens to `characters:page*` itself.**
- `src/lib/client/components/sidebars/characterRowsView.ts` — pure helpers: `reachLine`, `rowLead`, `rowDoor` (→ `{kind:"card",cardId}` | `{kind:"member",lorebookId,castId}` | null), `copyAsk` (→ `{characterId}` | `{castMemberId}` | null), `rowGroups(rows, folders)` → `{ ungrouped, folders:[{folder, rows}], onlyInLorebooks, shared }`, `chipsOf`.
- `src/lib/client/components/listItems/CharacterRowItem.svelte` — draws one row; props `row`, `layout: "list"|"cards"`, `active?`, `onclick?(row)`, `onEdit?(cardId)`, `onDelete?(cardId)`, `onExport?(row)`, `onTogglePersona?(row)`, `onSetDefaultPersona?(cardId)`, `onMoveToFolder?(row)`, `onCopy?(row)`, `contentTitle?`.
- `src/lib/client/components/characterForms/openCastMember.ts` — `openCastMember(panelsCtx, { lorebookId, castId })`.
- The copy flow to mirror: `src/lib/client/components/characterForms/CharacterViewPanel.svelte` ~136–165 (`copyPending` + `declareInterest` on `characters:duplicate` / `:error`; a refusal is said by Layout's catch-all).
- `src/lib/client/components/library/LibraryView.svelte` — its **Load more** button (~1043) is the wording and style to reuse.
- `src/lib/client/sockets/interest.svelte.ts` — `useInterest`, `declareInterest`, `requestWithInterest`.

## The file you change: `src/lib/client/components/sidebars/CharactersSidebar.svelte` (1,924 lines)

Read it in ranges. Keep everything that isn't about the list's data (New menu, imports, conflicts, folder dialogs, export, delete, digest effects, edit/view detail, view mode, drag-drop) working as it is. Change:

### 1. Data: `characters:page`, not `characters:list`
- Remove `characterList` and the mount-time `socket.emit("characters:list", {})`; remove the `characters:list:error` interest (nothing asks it any more). **Keep** `useInterest("characters:list", …)` — its handler now only schedules a re-ask (below): chr-read specified "keep listening to `characters:list` pushes as the re-ask trigger". Keep `characterFolders:list` as it is.
- State: `rows: CharacterRow[]` ($state), `nextCursor: string | null`, `isLoading` (true until the first page lands), `loadingMore`, the pending ask's `requestId` and whether it carried a cursor.
- `requestId`: `` `chr-page-${++seq}` `` (a module counter). **No `crypto.randomUUID`** (plain-http LAN, phones).
- `askFirstPage(limit = CHARACTER_ROWS_DEFAULT_LIMIT)`: new requestId; `socket.emit("characters:page", { requestId, limit, filters })`.
- `askNextPage()`: only with a `nextCursor` and nothing pending; same filters plus `cursor`.
- `onCharactersPage(msg)`: ignore unless `msg.requestId` is the pending one; a first-page reply REPLACES `rows`, a next-page reply APPENDS (skip any `rowKey` already present); set `nextCursor`; clear pending/loading flags.
- `onCharactersPageFailed(msg)`: ignore unless it's the pending ask; if `msg.error === CHARACTER_ROWS_STALE_CURSOR` and the ask carried a cursor → silently `askFirstPage()`; otherwise just clear loading flags (the context already toasted). ★chr-read-2 (lead): "silently re-ask from page one on the cursor refusal; the generic error is the context's one toast".
- Re-ask triggers: on mount; when the filters or the search change (search debounced 250 ms; filters at once) → `askFirstPage()`; on a `characters:list` push → coalesce (~150 ms) then `askFirstPage(Math.min(Math.max(rows.length, CHARACTER_ROWS_DEFAULT_LIMIT), CHARACTER_ROWS_MAX_LIMIT))` so the window already loaded stays loaded. (Every own write — delete, persona flip, folder move, Copy, import — makes the server push `characters:list`, so that one trigger covers "after own actions".) Clear timers on destroy.
- Paging: at the end of the list, when `nextCursor` is set, a **Load more** button (LibraryView's wording and button style) that calls `askNextPage()`, plus an `IntersectionObserver` on a sentinel just above it that calls `askNextPage()` when it scrolls into view — guard `typeof IntersectionObserver !== "undefined"`, disconnect on destroy.

### 2. Filters → `CharacterRowsFilters` (★chr-view-filters — built as the supervisor's recommendation)
Replace the single `chipFilter` with independent picks:
- **Show** (the existing first group, kept as is, no visible label): All · Favorites · Personas · ‹tag names from the loaded rows' `tags`› → `favorites: true` / `personas: true` / `tags: [name]`.
- **Card**: All · Has a card · No card → `hasCard: true | false`.
- **Words**: All · Follows its card · Has its own words → `follows: "card" | "own"`.
- **Lorebook**: All · ‹each lorebook from `lorebooks:list`› → `lorebookId`. Ask `lorebooks:list` with `requestWithInterest` when the popout first opens (release on destroy); list rows by `name`, sorted by name.
- **Story** (shown only while In my stories is on): All · ‹each session from `sessions:list`, by `name`› → `sessionId`. Asked the same way.
- **In my stories**: a `role="switch"` row at the foot of the popout under a hairline, label **In my stories**, muted help line _Also list characters kept only in your sessions' notes._ → `inMyStories: true`. Turning it off also clears a Story pick.
- `q` = the trimmed search box text (server-side now: it matches names and tag names).
Popout layout follows STYLE-GUIDE §6.3 (quoted below): each extra group under a hairline with a 12px muted label naming the `radiogroup` (`aria-labelledby`), rows `role="radio"` `h-9`, the checked one `sidebar-row-active`; picking a radio closes the popout; flipping the switch doesn't. Keep the popout scrollable (`max-h` as today). The trigger is lit (`toolbarButtonClass(true)`) while any pick isn't All or In my stories is on. **Chips row:** one dismissible chip per narrowing in force (the existing `Badge` + clear-button markup), its text the option's label (_Favorites_, _Has a card_, _Follows its card_, the book's name, the session's name, _In my stories_), `aria-label` _Clear filter: ‹label›_.

### 3. The list
- Rename the `characterRows` snippet (R1: it now collides with the read's name) to `rowGroup(items: CharacterRow[], label: string)`, drawing `CharacterRowItem` with `layout={viewMode.value}` in today's two wrappers (the `role="list"` column and the auto-fill grid, with the flip/fade animations), keyed by `row.rowKey`.
- Per row, pass only what that row may do:
  - own card (`cardIsMine`): `onclick`, `onEdit`, `onDelete`, `onExport`, `onTogglePersona`, `onSetDefaultPersona`, `onMoveToFolder` (no `onCopy`);
  - shared card (`isSharedWithMe`): `onclick`, `onExport`, `onCopy` (STYLE-GUIDE §6.4: "its `⋯` holding only what a reader may do (open, copy, export)");
  - any other row (someone else's card reached through a lorebook, or a cast member's row): `onclick`, and `onCopy` when `copyAsk(row)` isn't null.
  - `active` = desk mode and `row.cardId != null && selectedCharacterId === row.cardId`.
- Groups via `rowGroups(rows, folders)`, in this order: `ungrouped` (no header, list label _Characters_); each folder under its `CharacterFolderHeader` exactly as today (count = its loaded rows); **_Only in lorebooks_** (`ListGroupLabel`) for `onlyInLorebooks`; **_Shared with you_** (`ListGroupLabel`) last for `shared`. Owner (brief): "card-less rows under _Only in lorebooks_ after folders".
- Row click = `rowDoor(row)`: `card` → `handleViewClick(cardId)` (today's read-only detail); `member` → `openCastMember(panelsCtx, { lorebookId, castId })`; null → nothing.
- **Copy to my characters**: `onCopy(row)` → `copyAsk(row)` → `socket.emit("characters:duplicate", ask)` with a `copyPending` flag and `declareInterest` on `characters:duplicate` / `characters:duplicate:error` exactly as CharacterViewPanel does; on this view's reply open the new card's detail (`viewingId = msg.character.id`). No toast here.
- Rewire every place that read `characterList`/the old row shape: delete dialog name (`rows.find(r => r.cardId === id)?.shownName`), persona flip (`id: row.cardId`, `tags: row.tags.map(t => t.name)` — keep the "⚠ Load-bearing" comment), set default persona, move to folder (`characterId: row.cardId`), export (`handleExportCharacter({ id: row.cardId, name: row.shownName })`), the vectorization handler (update `embeddingModel` on the row whose `cardId === msg.id`), the tag picks (from loaded rows' `tags`, with `colorPreset`).
- Jump registration (~line 528): `label: "Characters"`; `getHits` from `rows` — card rows as `{ kind: "character", id: cardId, title: shownName, subtitle: summary || undefined }`; cast members' rows are left out of Jump hits (there is no cast-member jump kind in `JUMP_KINDS`); `onPick` → the row door for that card.
- `PanelFilterInput`: `count` = `rows.length` only when `nextCursor` is null (else omit it, so it never claims a total it doesn't know); `aria-label` _Filter characters by name or tag_.
- Empty state: keep today's messages for search / Favorites / Personas / a tag; for any other narrowing (Card, Words, Lorebook, Story, In my stories) _No characters match these filters._; `listIsNarrowed` true when the search or any pick is in force.
- The view's own name (★C-1, owner 2026-11-08: "**Characters**" … "character card" stays the item's name): `ViewToolbar label="Characters"`, `ListCardToggle label="Characters"`, the list region's `aria-label` _Characters list and drop zone_. Leave every string that names the item (a card: "Import a card", "Drop to import this card", "New character", "Write a character"…) as it is.

## Files owned (edit only these)

`src/lib/client/components/sidebars/CharactersSidebar.svelte`; NEW `src/lib/client/components/sidebars/charactersSidebar.dom.test.svelte.ts`; at most ONE new stub `.svelte` test helper next to the test if you need to stub a heavy child (name it `charactersSidebar.stub.test.svelte` or follow an existing stub pattern — `grep -rln 'vi.mock(".*\.svelte"' src`). Read anything else; edit nothing else. If you need a change in another file (e.g. `CharacterRowItem.svelte` or `characterRowsView.ts` misses something), stop and say exactly what in your report. Lane s4-fixes edits `state/**`, `sockets/state.ts`, `sockets/lorebooks.ts`, `EditSessionForm.svelte` right now — never touch them.

## Rules you must follow (quoted)

- CLAUDE.md Standing ruling: "**Sockets:** one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." Toasts go through `notify`, and this view adds none for pages or copies.
- CLAUDE.md Hard rules: "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." Memory: never read in a `$effect`-called method the state that method writes (wrap with `untrack`) — the re-ask functions read and write `rows`/pending state, so call them from effects through `untrack`.
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- STYLE-GUIDE §6.3: "When a view has more filters than one box, they live in a popout: a 40px icon button that opens a popover of `role="radio"` rows (single choice) with the checked row in the selected treatment; an active choice shows as one dismissible chip under the toolbar and lights the button tonal." "A popout may carry one second radio group … under a hairline (`border-surface-200-800 my-1 border-t`), a 12px muted label (`text-surface-600-400 px-2.5 pt-1 pb-0.5 text-xs`) naming the radiogroup (`aria-labelledby`), then rows like the narrowing's (`role="radio"`, `h-9`, the checked one `sidebar-row-active`) … picking closes the popout." The chips row holds "every narrowing in force as a dismissible chip".
- STYLE-GUIDE §6.4: "A filter that empties a group hides its header rather than showing an empty one." "A **group label** is `ListGroupLabel` … sentence case." "**Shared rows** … list last, under the group label _Shared with you_".
- Memory rule "There is ALWAYS a lorebook": a session's own book is its **notes**; never copy that frames a session as having no lorebook.
- "It is a **session**, never a *chat*." STYLE-GUIDE §10: sentence case. Copy is ONLY the words given in this brief (or already in the file); if you need another word, stop and ask in your report.
- NOMENCLATURE R1/R3: invent no new exported names.

## Tests (Done means) — NEW `charactersSidebar.dom.test.svelte.ts`

Mount the real sidebar (happy-dom) with the contexts it reads (`panelsCtx`, `systemSettingsCtx`, `userSettingsCtx`, the Jump context) and mocks for `useTypedSocket` (record emits), `$lib/client/sockets/interest.svelte` (record `useInterest`/`declareInterest`/`requestWithInterest` handlers), `$lib/client/contexts/characterRows.svelte` (record the `onCharactersPage`/`onCharactersPageFailed` listeners), `$lib/client/contexts/characterImports.svelte` (no-ops). Look at existing sidebar DOM tests for the pattern (`src/lib/client/components/sidebars/connectionsList.dom.test.svelte.ts`, `samplingFirstOpen.dom.test.svelte.ts`). Cover:
1. mount emits `characters:page` with a `requestId` and `limit` 50 and **no** `characters:list`;
2. a reply renders rows: a card row with the **Card** badge and its reach line; a cast member's row without it;
3. groups: an own row ungrouped, a foldered own row under its folder header, a cast member's row under _Only in lorebooks_, a shared card under _Shared with you_ (in that order);
4. a reply with another `requestId` is ignored;
5. **Load more** emits `characters:page` with the reply's `nextCursor` and appends;
6. a stale-cursor refusal on a cursor ask re-asks the first page (no cursor); a generic refusal re-asks nothing;
7. a `characters:list` push re-asks the first page (use fake timers for the coalescing);
8. filters: picking Has a card / No card, Follows its card / Has its own words, Favorites, a tag, a lorebook, and flipping In my stories each re-ask with the matching `filters` key; each shows its chip; clearing a chip re-asks without it;
9. doors: a cast member's row click sets `panelsCtx.digest.lore` to `{ lorebookId, scope: "cast", castId }` and opens `lorebooks`; someone else's book-only card opens its `readableMember` the same way; an own card's click opens the detail (assert the view's detail section appears, stubbing `CharacterViewPanel` if it's too heavy);
10. Copy to my characters: on a cast member's row emits `characters:duplicate { castMemberId }`, on a shared card `{ characterId }`, and is not offered on an own card;
11. the rename: the toolbar/list labels say "Characters"; the rendered sidebar has no "Character cards" text.

Run, capped and logged:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/client/components/sidebars/charactersSidebar.dom.test.svelte.ts src/lib/client/components/sidebars/characterRowsView.test.ts src/lib/client/components/listItems/characterRowItem.dom.test.ts src/lib/client/contexts/characterRows.dom.test.svelte.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-view-w5-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-view-w5-tests.log'`
⚠ A failing `assert` on a happy-dom element has OOM-killed VS Code before — keep the cap, and assert on strings/attributes, not whole elements. Never pipe vitest into `head`. Then `npx svelte-check --threshold error 2>&1 | grep -i "CharactersSidebar\|charactersSidebar"` (or run `npm run check` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npm run check > <scratch>/s4-chr-view-w5-check.log 2>&1'`) shows no error in your files. `npx prettier --check` your files; only `--write` lines you changed in `CharactersSidebar.svelte` (if it fails on untouched lines, leave them and say so).

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

## Report

Final message: changed files, decisions (name each), every old-list feature you couldn't carry (say what), tests with counts, check result for your files, stop-and-ask items, Noticed-not-done.
