# BRIEF lay-A-w3 — rewrite `resolveDrawn.test.ts` and `widgetAliases.test.ts` for panels v2

Worker for lane **lay-A** (supervisor: lay-A). SDK repo `/home/jody/github/serene-pub-sdk`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Context — what changed (already built, in `sdk/src/sessionLayout.ts`; read its JSDoc, don't edit it)
Owner ruling 2026-11-05: "Get rid of pin." · "One type of group, each zone can have groups." · "Split the messages, composer and activity status/turn select into three widgets". So:
- `panels` version 2 (`PanelLayoutV2`): `{ version: 2, left: PanelV2[], middle: PanelV2[], right: PanelV2[], backing?, opacity?, gap? }`; `PanelV2 = { key, tabs, open?, height?, priority?, title? }`. No pin, no primary, no above/below. Version 1 is still read: `panelsV2Of` converts it (flatten middle `[...above, primary, ...below]`, drop `pinned`, and insert a `turn-line` panel then a `composer` panel (both `height: 'fit'`) after every panel whose first composing `messages` copy has `showComposer !== false` — before it when `composerPosition: 'top'`; no turn line when `nextUp: 'hidden'`/`showNudge: false`; nothing when the layout already places a `composer`; ids `conversationSplitIds` (`messages#x` → `composer#x` / `turn-line#x`); new keys continue `p<n>`). The old slots go through `panelsFromSlots` then the same conversion.
- `resolveDrawn(layout, box, opts?: { widgets?: Pick<WidgetDecl,'id'|'panel'>[] })` → `DrawnLayout { left, middle, right: DrawnZone; look: { backing, opacity, gap, gapPx } }`. `middle` has no `above`/`primary`/`below` any more. `DrawnPanel.priority` = stored → open tab's `WidgetDecl.panel.priority` → `'normal'`; `DrawnPanel.height` = stored valid → open tab's `panel.height` → `'fill'`. Every `pinned` is `true`; `rung` and `zoneKey` are never set; `box` is not read. Floor (old slots that place no conversation): the floor's `messages` panel and its inserted pair carry `floor: true` and are left out of `instances` / the id readers. Look: v2's values read defensively (unknown backing → `card`, opacity clamped 0–100 / non-number → 100, unknown gap → `comfortable`, `gapPx` from `PANEL_GAP_PX` 4/12/24); v1 and slots read `DEFAULT_PANEL_LOOK`.
- `composer` is no longer in `RETIRED_WIDGET_IDS` (now just `inventory`); a slot-era `composer` is dropped by the OLD-SLOT path only (`LEGACY_SLOT_DROPPED`).
- ⏳ Deprecated but still exported and working exactly as before: `pinnedOf`, `zoneRungAt`, `ZoneRung`, `DEFAULT_SIDE_RULES`, `DEFAULT_STRIP_RULES`, `DrawnMiddle`, `PanelMiddleV1`.
- `sdk-tests/panelsV2Of.test.ts` (w1's) already covers the converter in detail — don't duplicate it; read it for literals.

## Files owned (edit only these)
- `/home/jody/github/serene-pub-sdk/sdk-tests/resolveDrawn.test.ts`
- `/home/jody/github/serene-pub-sdk/sdk-tests/widgetAliases.test.ts`
Readable: everything. Another worker (w4) is rewriting `sessionLayout.test.ts` and `panelsFromSlots.test.ts` at the same time. Never touch `sdk/src/**`, `core-catalog/**` (lane lay-B is editing it now) or other tests.

## What to do
Rewrite the failing tests to state the NEW behaviour; keep each test's intent where it still exists, delete what no longer exists (the pin per panel, the rung per side, the primary), add what's new. Specifically:
- **`resolveDrawn.test.ts`**:
  - "panels: the whole truth" → a v2 layout: tabs, shown tab, height, priority per panel; v2 stray keys (`pinned`, `above`, `primary`) ignored; a junk height / priority → defaults; the declaration defaults (`opts.widgets` with `panel: { height: 'fit', priority: 'high' }` on the open tab) and a stored value winning over them; the look (defaults, a v2 look, clamping, junk).
  - A v1 layout draws through the conversion: middle flattened, composer + turn line drawn, every `pinned` true, no `rung`.
  - "the old slots, through panelsFromSlots" — keep the membership/order assertions, translated to the flat middle (the conversion inserts `turn-line` + `composer` after the conversation's panel; account for them); drop zone-pin and rung assertions.
  - The floor test: neither panels nor slots → the floor's `messages` (+ its pair) drawn with `floor: true`, not counted by `drawnWidgetIds`.
  - "retired widgets": `inventory` still dropped from every slot; a slot-era `composer` is not drawn from old slots, but a `composer` placed in v2 panels IS drawn.
  - KEEP the ⏳ `pinnedOf` and `zoneRungAt` describe blocks working as they are (they test deprecated-but-exported helpers); retitle them with a leading `⏳`. Drop the "1216px session box: the Lair docks both sides" test (it tests the rung via resolveDrawn, which is gone) — or keep it on `zoneRungAt` directly if it still says something true.
  - **Shipped layouts** ("every shipped genre layout", and the plugin layouts read from sibling repos): lay-B is converting core's shipped layouts (`core-catalog/src/registry/layouts.ts`) to v2 RIGHT NOW. Assert only invariants that hold whether a shipped layout is still v1 or already v2: the conversation is drawn in the middle, a `composer` is drawn somewhere, no empty panel, every id drawn once, every `pinned` true. For exact shapes use the frozen v1 literals in `sdk-tests/fixtures/core-layouts-old-slots.ts` (`V1_STORY_LAYOUT`, `V1_STORY_WORLD_LAYOUT`, `V1_LAIR_LAYOUT`, `V1_LAIR_PARTY_LAYOUT`, `V1_DUNGEON_CRAWLER_LAYOUT`) instead of the catalogue's.
  - "total": any value reads (`null`, numbers, `{ panels: 7 }`, `{ panels: { version: 2, middle: 'x' } }`…).
- **`widgetAliases.test.ts`**: fix "resolveDrawn through the alias" for the flat middle (no `above` / `primary`), and make "core's shipped layouts" tolerant the same way (read the shipped literal's `panels` whichever version — the assertion is that `stats#world` is placed by name, never `world-state`).

## Rules (quoted)
- "Published SDK names are never removed or renamed in this build" — tests of deprecated exports stay (marked ⏳).
- "It is a session, never a chat." (Test titles may keep the genre names `Story`, `Lair`, etc.)
- Do what was asked, at the size asked. If a test exposes what looks like a BUG in `sessionLayout.ts`, don't edit the source and don't bend the test to the bug: write the test for the behaviour this brief states, mark it with `{ todo: 'lay-A: <what>' }` and report it.
- Match the files' existing style (tabs, single quotes, no semicolons). These files are NOT prettier-formatted today: never run `prettier --write` on them.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need `sdk:build` — don't run it.)

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

## Done means
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test resolveDrawn.test.ts widgetAliases.test.ts` green (todo-marked bugs aside). If a failure traces to lay-B's in-progress `core-catalog` edits (an import error, a changed shipped literal), report the test name and the cause; don't fix core-catalog.
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit 2>&1 | grep -E "resolveDrawn\.test|widgetAliases\.test"` empty.
- Report (as your final message): what you rewrote/removed/added (test names), results, any suspected source bugs, Noticed-not-done.
