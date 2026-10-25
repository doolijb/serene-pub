# REPORT — polish lane D (L6 rows + meta line, L7 no voids, L9 Home), 2026-10-24

Built; every touched test passes; svelte-check 0 errors. No browser, no commit.

## Files
- NEW `components/panels/MetaLine.svelte` (+ `metaLine.ssr.test.ts`): the **meta line** — optional 13px truncating lead, then 12px facts joined by " · ", empties dropped, muted `surface-600-400`. Exports `MetaLineItem`, `metaLineItems`.
- NEW `utils/viewMode.test.ts`; `utils/viewMode.svelte.ts`: `defaultMode` may be a function (stored pick still wins).
- `panels/PanelSplit.svelte` (+3 tests): `listFills` reused; new `fillWidth`: `list` 560 · `reading` 1120 (default) · `whole`.
- `SidebarListItem.svelte`: `showIndex` defaults false (Lorebooks gutter numbers gone); 12px content gap.
- `avatar.ts`/`Avatar.svelte`: `md` 40→44px; square radius 10px. `AvatarStack.svelte`: `+n` notch on the last face (no width cost). `avatar.ssr.test.ts` updated (+2).
- `listItems/SessionListItem.svelte`: one anatomy — ≤3 stacked 44px faces + `+n` · name 15/500 · meta line ("Speaker: excerpt" · genre · date) · kebab; "your turn" dot gone; only the ember dot (pulsing) while a reply is written; `layout`/cover prop removed.
- `listItems/CharacterListItem.svelte`: summary = meta-line lead.
- `sidebars/SessionsSidebar.svelte`: `listFills` (560 rows / 1120 cards); `shownId`: at desk with no form open, the session open on the stage shows its detail and its row is marked.
- `sidebars/CharactersSidebar.svelte`: `listFills`; default rows in the dock, cards otherwise. `Users/Tags/Sampling/Help/ConversationsSidebar`: `listFills` 560; Users "@username" = meta line. `ModelsSidebar`: `fillWidth="list"`. `ActivitySidebar`: strip + panels centred at 560 (was 880).
- `library/LibraryView.svelte`: `listFills` `whole`; `LibraryResultRow.svelte`: 44px face · name · meta line.
- `lorebooks/LorebooksWorkspace.svelte`: `fillWidth="list"` (book list 1120→560).
- `src/routes/+page.svelte`: Characters = two-column list (44px face, name, one line, "New or import") with the shelf behind a list/card toggle (`serene-pub:viewMode:home`); continue cards use the meta line; lane B's BetaNotice/pill kept.
- STYLE-GUIDE §4.2, §5.2, §6.4, §12 (2 rows); NOMENCLATURE §25 (**meta line** 🚧) + §26; docs/sessions.md, getting-around.md, characters.md, getting-started.md.

## Skipped and why
Documentation/Document View links → account menu (Layout.svelte, other lane); session header subtitle (Header.svelte); Models row anatomy (`connections/ModelsListView.svelte`, connections/* other lane); Connections untouched (already fills at 1120); Tags is a cloud; `emptyMessage` kept where a view doesn't fill; no animation when the list moves left (same elements re-laid; filter and scroll survive); lorebook rows only lost the gutter.

## Needs the owner's word
1. Meta line colour: plan said `surface-500`; STYLE-GUIDE §6.4 says quiet text fails AA for facts → used muted `surface-600-400`.
2. The name "meta line" kept (free, qualified) — 🚧.
3. Avatar `md` 40→44 applies to ~29 avatars (pickers, TurnPicker, conversations, EditSessionForm).
4. Widths: Activity 880→560, Models 1120→560, Lorebooks book list 1120→560.
5. Sessions shows the open session's detail at any desk width incl. Focus.
6. With the your-turn dot gone, session rows inside a tag's detail no longer say "your turn".
7. Library dock rows: three lines → one meta line.
8. `text-[13px]` (MetaLine) and `text-[11px]` (`+n`) await L13's utilities.

## Tests (verbatim)
characterSummaryLine.dom 3 · sectionList.ssr 18 · panelSplit.ssr 11 · avatar.ssr 14 · metaLine.ssr 6 · viewMode 4 — each "Test Files 1 passed (1)".
svelte-check: COMPLETED 10328 FILES 0 ERRORS 7 WARNINGS (7 untouched files). Needed NODE_OPTIONS=--max-old-space-size=6144 in a 7G scope.

## Visual walk
Sessions dock rows (stacks, +n, meta line, no gold dot, ember while writing) · Focus with nothing open: list centred 560 (cards 1120) · Half @2560 with a session open: detail beside list, row marked; Half @1440 compact · Characters: rows in dock, cards at Half/Focus, toggle persists · Home: two-up list / one-up at 412, toggle, continue card meta line, +n notch · Lorebooks: no gutter, 560 list · Activity Focus 560 column · Users/Tags/Sampling/Help/Messages/Models centred, no "Pick a…" · Library grid fills, round faces · 44px pickers · light-mode meta line contrast + notch.
