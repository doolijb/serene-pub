# BRIEF lay-A-w4 — rewrite `sessionLayout.test.ts` and `panelsFromSlots.test.ts` for panels v2

Worker for lane **lay-A** (supervisor: lay-A). SDK repo `/home/jody/github/serene-pub-sdk`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Context — what changed (already built, in `sdk/src/sessionLayout.ts`; read its JSDoc, don't edit it)
Owner ruling 2026-11-05: "Get rid of pin." · "One type of group, each zone can have groups." · "Split the messages, composer and activity status/turn select into three widgets". So:
- `panels` version 2 (`PanelLayoutV2`): `{ version: 2, left: PanelV2[], middle: PanelV2[], right: PanelV2[], backing?, opacity?, gap? }`; `PanelV2 = { key, tabs, open?, height?, priority?, title? }`. No pin, no primary, no above/below. Version 1 is still read: `panelsV2Of` converts it (flatten middle `[...above, primary, ...below]`, drop `pinned`, and insert a `turn-line` panel then a `composer` panel (both `height: 'fit'`) after every panel whose first composing `messages` copy has `showComposer !== false` — before it when `composerPosition: 'top'`; no turn line when `nextUp: 'hidden'`/`showNudge: false`; nothing when the layout already places a `composer`; ids `conversationSplitIds` (`messages#x` → `composer#x` / `turn-line#x`); new keys continue `p<n>`). The old slots go through `panelsFromSlots` then the same conversion.
- `resolveDrawn(layout, box, opts?: { widgets?: Pick<WidgetDecl,'id'|'panel'>[] })` → `DrawnLayout { left, middle, right: DrawnZone; look: { backing, opacity, gap, gapPx } }`. `middle` has no `above`/`primary`/`below` any more. `DrawnPanel.priority` = stored → open tab's `WidgetDecl.panel.priority` → `'normal'`; `DrawnPanel.height` = stored valid → open tab's `panel.height` → `'fill'`. Every `pinned` is `true`; `rung` and `zoneKey` are never set; `box` is not read. Floor (old slots that place no conversation): the floor's `messages` panel and its inserted pair carry `floor: true` and are left out of `instances` / the id readers. Look: v2's values read defensively (unknown backing → `card`, opacity clamped 0–100 / non-number → 100, unknown gap → `comfortable`, `gapPx` from `PANEL_GAP_PX` 4/12/24); v1 and slots read `DEFAULT_PANEL_LOOK`.
- `composer` is no longer in `RETIRED_WIDGET_IDS` (now just `inventory`); a slot-era `composer` is dropped by the OLD-SLOT path only (`LEGACY_SLOT_DROPPED`).
- ⏳ Deprecated but still exported and working exactly as before: `pinnedOf`, `zoneRungAt`, `ZoneRung`, `DEFAULT_SIDE_RULES`, `DEFAULT_STRIP_RULES`, `DrawnMiddle`, `PanelMiddleV1`.
- `sdk-tests/panelsV2Of.test.ts` (w1's) already covers the converter in detail — don't duplicate it; read it for literals.

## Also changed (the validator, `validateSessionLayout`)
- v2 errors (exact sentences, see `sdk/src/sessionLayout.ts` ≈ lines 1860–1950): the shape `panels: { version: 2, left: [ … ], middle: [ … ], right: [ … ], backing?, opacity?, gap? }` (and per zone `panels.<zone>: a list of panels, top to bottom`); a v1-style middle object or `above`/`primary`/`below` → `panels.middle: one list of panels, top to bottom — above / primary / below are version 1's`; empty middle → `panels.middle: the middle is never empty — at least one panel`; a panel's `pinned` → `….pinned: there is no pin in version 2 …`; bad `priority` / `backing` / `opacity` / `gap` each with its sentence; the panel key / tabs / open / height / title checks as v1.
- v1 is still accepted, every v1 check as before, PLUS one warning starting `panels-v1:`.
- Conversation-missing warning: no `messages` copy in any zone (v1 or v2).
- `composer` no longer warns as retired. In the old slots, a placed `composer` warns `'<id>' is a slot-era composer — the old slots never draw it; place the Composer in panels`.
- The id readers (`layoutWidgetIds`, `middleWidgetIds`, `drawnWidgetIds`) walk the v2 reading: on a v1 or slot layout they include the derived `turn-line` / `composer` ids (they are drawn); floor panels are left out.
- `panelsFromSlots` is unchanged and still returns `PanelLayoutV1` (except a slot-era `composer` is now dropped via `LEGACY_SLOT_DROPPED` instead of `RETIRED_WIDGET_IDS`). `panelsOf` now returns `PanelLayoutV2` (= `panelsV2Of(layout).panels`): a stored v2 as the same object, anything else converted.

## Files owned (edit only these)
- `/home/jody/github/serene-pub-sdk/sdk-tests/sessionLayout.test.ts`
- `/home/jody/github/serene-pub-sdk/sdk-tests/panelsFromSlots.test.ts`
Readable: everything. Another worker (w3) is rewriting `resolveDrawn.test.ts` and `widgetAliases.test.ts` at the same time. Never touch `sdk/src/**`, `core-catalog/**` (lane lay-B is editing it now), the fixtures, or other tests.

## What to do
Rewrite the failing tests to state the NEW behaviour; keep each test's intent where it still exists, delete what no longer exists, add what's new.
- **`panelsFromSlots.test.ts`**:
  - The goldens compare `panelsFromSlots(OLD_*)` against the FROZEN v1 literals in `sdk-tests/fixtures/core-layouts-old-slots.ts` (`V1_STORY_LAYOUT`, `V1_STORY_WORLD_LAYOUT`, `V1_LAIR_LAYOUT`) — never the catalogue's `STORY_LAYOUT` / `LAIR_LAYOUT` / `lairGenre` (lay-B is rewriting them to v2). Same for the Lair's Sanctum test.
  - `assertValid`: a converted (v1) layout validates with no errors and exactly the one `panels-v1:` warning.
  - A slot-era `composer` (in a list, the grid, an arrangement) is dropped by `panelsFromSlots`.
  - "panelsOf returns stored panels as they are" → a stored v2 is returned as the same object; a stored v1 comes back as v2 (flattened, pair inserted); old slots come back as v2.
  - Keep every pure-`panelsFromSlots` rule test (side rules, middle rules, total/deterministic) — they should mostly pass untouched.
- **`sessionLayout.test.ts`**:
  - The id readers: update expectations for the derived `turn-line` / `composer` on v1 / slot layouts; add a v2 layout case.
  - "validateSessionLayout: panels": keep the v1 checks (now with the `panels-v1:` warning in the verdict), add a v2 block covering each new error sentence and a sound v2 layout that validates with `{ ok: true, errors: [], warnings: [] }` (with `CORE_WIDGETS` + `unknownWidgets: 'warn'`, a v2 layout placing `composer`/`turn-line` will warn they're unknown until lay-B declares them — so either place only widgets CORE_WIDGETS has today, or pass your own `widgets` list).
  - The retired-widget warning test: `inventory` still warns retired; `composer` no longer does; the slot-era composer warning in old slots.
  - "core's genres declare the layouts they have always shipped": the shipped literal may be v1 (until lay-B converts it) or v2 — assert no errors, and warnings empty once the `panels-v1:` one is filtered out. Never assert a specific version.

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
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test sessionLayout.test.ts panelsFromSlots.test.ts` green (todo-marked bugs aside). If a failure traces to lay-B's in-progress `core-catalog` edits (an import error, a changed shipped literal, an unknown widget), report the test name and the cause; don't fix core-catalog.
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit 2>&1 | grep -E "sessionLayout\.test|panelsFromSlots\.test"` empty.
- Report (as your final message): what you rewrote/removed/added (test names), results, any suspected source bugs, Noticed-not-done.
