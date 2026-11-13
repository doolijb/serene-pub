# BRIEF — lane `s4-chr-view`, worker w3 — the Characters view's row: pure helpers + `CharacterRowItem` (2026-11-08)

Supervisor: lane `s4-chr-view` (brief `plans/briefs/BRIEF-s4-chr-view.md`). Repo `/home/jody/github/serene-pub`. Use absolute paths.

## Context

The Characters view (`src/lib/client/components/sidebars/CharactersSidebar.svelte`) is moving from the unpaged card list (`characters:list`) to the paged 🚧 `characters:page` read: **one row per character** — a card and its cast members, or one cast member with no card. The row type is `CharacterRow` in `src/lib/shared/characters/characterRows.ts` — **read that file whole first**; every field has a JSDoc sentence. A later worker wires the sidebar; you build the pieces it will use, with tests. Don't edit the sidebar.

Owner rulings (quote, never reinterpret):
- 2026-11-05 (refined the same day): "Give each character badges: card, cast." → "the cast badge is probably redundant, any card that's been used will be a cast" → **one badge, Card**, plus a **reach line**: _In 2 lorebooks_ / _Not in a lorebook yet_ / _In ‹book›_ / _In ‹session›'s notes_.
- 2026-11-08 ★C-1: the view is named **Characters**; "character card" stays the name of the item (a card).
- Memory rule "There is ALWAYS a lorebook": never write copy framing a session as having no lorebook; a session's own book is its **notes**.

## 1. Pure helpers — NEW `src/lib/client/components/sidebars/characterRowsView.ts` (+ `characterRowsView.test.ts`)

No Svelte, no sockets. Export (names decided; doc each with one sentence, mark the module 🚧):

- `reachLine(row: CharacterRow): string` —
  `reach.lorebookCount === 0` → `"Not in a lorebook yet"`;
  count 1 and `reach.lorebook?.sessionId != null` → `` `In ${sessionName}'s notes` ``, and when `sessionName` is null → `"In a session's notes"`;
  count 1 → `` `In ${reach.lorebook.name}` `` (if `reach.lorebook` is unexpectedly null → `"In 1 lorebook"`);
  count n > 1 → `` `In ${n} lorebooks` ``.
- `rowLead(row): string` — the meta line's lead: `sharedFromLine(row)` (from `$lib/shared/utils/sharedRows`, gives _From ‹owner›_ / _Shared with you_) when `row.isSharedWithMe`, else `row.summary`.
- `type CharacterRowDoor = { kind: "card"; cardId: number } | { kind: "member"; lorebookId: number; castId: number } | null`
  `rowDoor(row): CharacterRowDoor` — what a click on the row opens:
  a card row the asker may open as a card (`cardIsMine || isSharedWithMe`) → `{ kind: "card", cardId }`;
  any other card row → its `readableMember` as `{ kind: "member", lorebookId, castId: castMemberId }` (null when it has none);
  a cast member's row → `{ kind: "member", lorebookId: reach.lorebook.id, castId: castMemberId }` (null if `reach.lorebook` is null).
  (Why: someone else's card that reaches the asker only through a lorebook can't be read as a card — `characters:get` refuses it — so its row opens its cast member in Lorebooks.)
- `type CopyAsk = { characterId: number } | { castMemberId: number } | null`
  `copyAsk(row): CopyAsk` — **Copy to my characters** is offered "where the card isn't the asker's or there's none": own card → null; shared card → `{ characterId: cardId }`; other card row → `{ castMemberId: readableMember.castMemberId }` (null if none); cast member's row → `{ castMemberId }`.
- `rowGroups(rows: CharacterRow[], folders: { id: number; name: string }[])` → `{ ungrouped: CharacterRow[]; folders: { folder; rows: CharacterRow[] }[]; onlyInLorebooks: CharacterRow[]; shared: CharacterRow[] }`, keeping the input order inside each group:
  `isSharedWithMe` → `shared`; own card (`cardIsMine`) with a known `folderId` → that folder's group (folders in the given order; a folder with no rows is left out, as today); own card otherwise → `ungrouped`; everything else (cast members' rows and other people's cards reached through a lorebook) → `onlyInLorebooks`.
- `chipsOf(row): { first: string | null; rest: string[] }` — the row's chips in order: **`"Card"`** first on a card row (`hasCard`), then the tag names; `first` is the one chip drawn, `rest` the names behind the `+N`. (STYLE-GUIDE §6.4: "at most one chip at the right with a `+N` for the rest".)

Tests (`characterRowsView.test.ts`, plain vitest): every reachLine case incl. the null session name; rowLead shared vs not; rowDoor for own card, shared card, other card with/without readableMember, member row; copyAsk for the same four; rowGroups ordering and placement incl. an unknown folder id and an empty folder; chipsOf with/without tags, member row.

## 2. NEW `src/lib/client/components/listItems/CharacterRowItem.svelte` (+ `characterRowItem.dom.test.ts`)

One component, two layouts, drawing ONE `CharacterRow`. Model it on the existing `src/lib/client/components/listItems/CharacterListItem.svelte` (list) and `CharacterCardItem.svelte` (cards) — read both whole; keep their markup, classes and a11y (ids, sr-only words, RowMenu trigger) — but read the new row's fields:
- Props: `row: CharacterRow`; `layout: "list" | "cards"`; `active?: boolean`; `onclick?: (row) => void`; and the menu callbacks, each optional and absent where the menu must not offer it: `onEdit?(cardId)`, `onDelete?(cardId)`, `onExport?(row)`, `onTogglePersona?(row)`, `onSetDefaultPersona?(cardId)`, `onMoveToFolder?(row)`, `onCopy?(row)`. `contentTitle?` as today.
- Face: `Avatar` (`src/lib/client/components/Avatar.svelte`, read its Props): `src` from `row.face` via the same helper the codebase uses for `{uuid, rev}` media (find it: `avatarSrc` in `$lib/client/utils/media`), `name={row.shownName}`; a card row falls back to the glyph, a cast member's row (no card) to the name's initial (`fallback="initial"`) — STYLE-GUIDE §6.4: "or, for someone with no card (a background cast member), the name's initial". `decorative` beside the name.
- Name line: `row.shownName`, then the favourite star (`isFavorite`) and persona glyph (`isPersona`, filled + titled _Default persona_ when `isDefaultPersona`), then `EmbeddingStatusIcon` with `row.embeddingModel` — exactly as CharacterListItem draws them.
- **Meta line** (`components/panels/MetaLine.svelte` — read it): lead = `rowLead(row)`; facts = `[reachLine(row)]`. STYLE-GUIDE §6.4: "A row's last line, a character's summary, a handle are leads; a genre, a time, _your turn_, a count are facts."
- **Chip slot**: `chipsOf(row)`: `first` is "Card" on every card row and null on a cast member's row (which has no tags). Draw it as a `Badge` (`src/lib/client/components/Badge.svelte`, `size="sm"`, tone `surface`), then `+N` for `rest` (the tag names) in the muted `+N` style CharacterListItem uses, with `title` = the rest joined by ", " so the tag names stay reachable. Nothing when `first` is null.
- **⋯ menu** (`RowMenu`), items in this order, each only when its callback is given: View (`onclick`), Edit, Use as persona / Not a persona, Set as default persona, Move to folder…, **Copy to my characters** (icon `Icons.Copy`), Export, separator + Delete — same labels/icons as CharacterListItem for the existing ones.
- Element ids: use `row.rowKey` safely (e.g. replace `:` with `-`) where CharacterListItem used `character.id`.
- Cards layout: same as CharacterCardItem's anatomy with the new fields (badge where its tag chip sat, the reach line as a muted line).

DOM test (`characterRowItem.dom.test.ts`, mount/unmount style as `characterSummaryLine.dom.test.ts` next to it): a card row shows the **Card** badge, the summary and the reach line; a member row shows no badge, the initial fallback and "In ‹book›"; a shared row's lead is "From ‹owner›"; the `+N` title lists tag names; the menu offers Copy to my characters only when `onCopy` is given; both layouts render.

## Files owned (edit only these)

NEW `src/lib/client/components/sidebars/characterRowsView.ts` + `characterRowsView.test.ts`; NEW `src/lib/client/components/listItems/CharacterRowItem.svelte` + `characterRowItem.dom.test.ts`. Read anything; edit nothing else (not `CharacterListItem.svelte`/`CharacterCardItem.svelte` — TagsSidebar still uses them; not the sidebar).

## Rules you must follow (quoted)

- STYLE-GUIDE §6.4: "**A row is two lines and a face** … the 44px face (`md`, round …), 12px, then the **name** at 15px medium over **one meta line**, then at most one chip at the right with a `+N` for the rest, then the row's `⋯` `RowMenu`. Nothing else: no date column, no status dot, no italic. A favourite is a small filled star after the name; a persona is a small `UserRound` after it." "**Every avatar is round**."
- STYLE-GUIDE §6.4 Shared rows: "its second line _From *owner*_ in place of the row's own blurb, its `⋯` holding only what a reader may do (open, copy, export)."
- Badge: "A badge is never filled"; `sm` "for counts and tags beside a row's name".
- STYLE-GUIDE §10: sentence case; copy is the words given above, no others. If you need a word not given here, stop and ask in your report.
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." "It is a **session**, never a *chat*."
- NOMENCLATURE R1/R3/R6: the names here are decided; mark the module and component 🚧 in their header comments; invent no other exported names.

## Tests (Done means)

`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/client/components/sidebars/characterRowsView.test.ts src/lib/client/components/listItems/characterRowItem.dom.test.ts src/lib/client/components/listItems/characterSummaryLine.dom.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-view-w3-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-view-w3-tests.log'`
All green. `npx prettier --check` your four files (they're new: `--write` them is fine). `npx tsc --noEmit -p . 2>&1 | grep -i "characterRow"` prints nothing. Never pipe vitest into `head`.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

## Report

Final message: changed files, the exact exported signatures, decisions, tests with counts, stop-and-ask items, Noticed-not-done.
