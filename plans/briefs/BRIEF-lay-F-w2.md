# BRIEF lay-F-w2 — NOMENCLATURE.md for the simplified session layouts

Worker for lane lay-F (supervisor: lay-F). App: /home/jody/github/serene-pub. SDK (read only): /home/jody/github/serene-pub-sdk.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

(You run no tests or builds.)

## Goal
`NOMENCLATURE.md` records every word the session-layout build (owner GO 2026-11-05, lanes lay-A…E) retired, changed or added, each new row a **charter** (P6: "Everything that exists states its purpose, why it exists, what it owns and what it does not (and who does) — in its NOMENCLATURE row.").

## File owned
`/home/jody/github/serene-pub/NOMENCLATURE.md` — **shared with another programme (cv-*) that is editing it at the same time.**
- Edit ONLY with the Edit tool, one row / one block per call. **Never** Write the whole file, never `sed -i` over it, never prettier/reformat it, never re-pad table columns.
- **Re-read the exact lines (Read with offset/limit, or `grep -n`) immediately before EACH edit**: line numbers drift while you work.
- New rows need not be column-padded (recent rows aren't).

## Files readable
Everything. Sources of truth: SDK `sdk/src/sessionLayout.ts`, `sdk/src/layout.ts`, `sdk/src/widgets.ts` (requests), `sdk/src/sessionDossier.ts` (`ConversationComposerV1.target/writingTo`), `core-catalog/src/registry/{widgets,layouts}.ts`, `core-catalog/src/components/shared/{composer,turn-line}/`, `core-catalog/src/shared/ui/scene-portraits/portraits.ts`; app `src/lib/client/sessionLayout/*` (zoneHeights, sessionZones, ZoneSwitch, panelBacking, conversationTarget, conversationMounts, conversationStyles, ZoneColumn, sideSlot, placementRules, arrangeOps, mobileEdit, ArrangeInspector, LayoutLookSection, widgetSettingsFlow, hostCard), `src/lib/client/components/sessionPage/requests/{showChannel,sessionScenario}.ts`, `src/lib/client/stores/widgetStyles.svelte.ts` (`filterWidgetStyleValue`), `src/lib/server/db/{panelsFromStored,sessionLayoutPanels,widgetSettings}.ts`. Lane reports: `plans/REPORT-lay-{A,B,C,D,E}-2026-11-05.md` (each "Names" / "Names for §25" section and every "lead follow-up" / "-fix outcome" section — they changed names). **Grep each name in code before you record it**; record the name as the code spells it; a name the code doesn't have goes in your report, not the file.

## Rules (quoted)
- §1 R1 "One word, one meaning. Where a word is already load-bearing in one place, the _other_ use renames. Not both." R2 "Prefer distinctive words for new concepts." R3 "Qualify, never abbreviate to the bare noun." R4 "Casual words must not become type names." R6: mark ⏳ transitional (real today, expires on a known event) / 🚧 provisional (built but may still move).
- §24: "1. Pick a distinctive word … 2. Grep for it first … 3. If it collides, either pick another or rename the other use in the same change. Never ship a second meaning. 4. Qualify it if the bare noun could ever stand alone (R3). 5. Say what it is not, in the declaration, if a near-neighbour exists. 6. UI labels are prose and need not match internal names — but must not contradict them."
- Maintaining: "A change that renames a concept updates this file in the same change." "A term drawn on a new screen uses its icon from §22; … a term that has none goes under _needs an icon_."
- CLAUDE.md: "It is a session, never a chat"; there is always a lorebook (never "no lorebook" as a state).
- You record what was built; you do not rule. Owner-open ★s are marked as such in the row ("🚧, owner ★").

## Work, in this order

### 1. §23 (Retired words) — append rows at the END of the §23 table (currently after the **Honour mode** row, ~line 1583). Row shape: `| <retired words> | **Retired 2026-11-05** (session layouts simplified, owner R<n>; lane lay-<x>). <why>. Use instead <…>. |`
Rows (one each; group the code names into the row they belong to):
1. **primary panel** (UI _the main panel_) — `setPrimary`, phone **Make main** / `canMakeMain` / `makeMain`, the Crown, _Make this the main panel_, `withPrimaryFilled`, `MiddlePlaces`, `PanelMiddleV1.primary`; ⏳ `PanelMiddleV1` and `DrawnMiddle` stay exported, `@deprecated`, until 0.7 (owner's call). Owner ★3 (2026-11-05). Use instead: the middle is one stack of panels like the sides; rule kept: the middle is never empty (`MIDDLE_EMPTY`).
2. **strip** (of the middle) — `above` / `below`, the phone sections _Above_ · _Below_, ⏳ `DEFAULT_STRIP_RULES`. ⚠ Stats' **Strip** arrangement and other strips are untouched.
3. **docked** · **in the rail** — `pinned: false`, `PanelRail` (file still on disk: deletion refused by the permission system, queued for the owner), fly-outs (`liveFlyouts`), phone groups _Docked_ · _In the rail_, `SIDE_GROUPS` / `SideGroup`, _Nothing docked._ · _Nothing in the rail._, the session's Alt+[ / Alt+] (the keys go back to the app). Owner R1 "Get rid of pin." + ★1. ⏳ `PanelV1.pinned` and the drawn `pinned` fields stay exported, always true. Use instead: every panel is always open.
4. **rail strip** (editor) — _Drop here to dock_, _Dock here_, _Add to the rail_, `NARROW_SIDE_PX`.
5. **the pin** (live; _Dock_ · _Move to the rail_) — `withPanelPinned`, `setPanelPinned`, `setPinned`, `NOT_A_STACK`.
6. **pin rule** (`pinnedOf`) — ⏳ still exported, deprecated until 0.7.
7. **host card** as the per-widget **Card** setting (`hostCard`) and as the card of a tucked flyout / phone sheet — the pop-over sense stays (`HOST_CARD_CLASS`, §9 row amended). Use instead: the layout's **backing** on the panel.
8. **message backing** · **backing mode** (`backingMode`, _Card_ · _Auto_ · _On_ · _Off_), `MessageBacking`, `resolveBacking`, `declaredBacking`, `data-sp-backing` (`src/lib/shared/widgets/messageBacking.ts` is still on disk, deletion refused — queued for the owner). Owner R7 + ★8. Use instead: **backing** (layout setting) and `--sp-widget-*`.
9. **`--sp-backing`** — a style's backing preference. Use instead `--sp-widget-background` / `--sp-widget-border` (D9).
10. **Session panels** (the header button and its sheet; `PanelsMenu` still on disk, deletion refused; `mobileSidePanels`). Use instead: the **zone switch**.
11. **tucked sides** · _tucks_ — the tuck half of `tuckedSides` (`tuckThresholdPx` stays and feeds the zone switch), `sidesAreTucked`, `tucked`. Use instead: the **zone switch**.
12. **the settings window** (`WidgetSettingsModal`, `openWidgetSettings`, `closeWidgetSettings`, `widgetSettingsModal`, the live session's gear) — owner R4 "No more pop-up widget settings. Settings are accessed through the layout settings." Use instead: the Arrange tab's **inspector**.
13. Messages' **Show composer** · **Show messages** · **Composer position** (`showComposer`, `showMessages`, `composerPosition`, `showNudge`, `data-composer-position`, `data-show-messages`) — ★11: the Composer is its own widget; order is panel order; a zone with Messages but no Composer is a reading pane. `MESSAGES_MOVED_KEYS` lists them for the boot pass.
14. The side **rungs** — ⏳ `ZoneRung`, `DEFAULT_SIDE_RULES`, `zoneRungAt`, `DrawnZone.rung` / `.zoneKey` (exported, deprecated, never set); the ≥2400px two-column side (open owner ★2 of lay-C).
15. The editor's **Rails** preview.
16. The removed widget parts and empty sentences (owner R10 2026-11-05 "don't have most widgets show placeholder text when there's nothing to show. Messages being an obvious exception"): parts `*.empty` of Actions, Album, Attendance, Backdrop, Chronicle, Lore entries, Places, Routine log, Scene Portraits, Turn order; `stats.card-note`, `stats.trail-note`, `places.detail-none` (verify each against the regenerated part list in `../serene-pub-sdk/guides/widgets.md` lines ~43-65). Kept: errors, not-granted lines, owner-only reasons, Messages' empty line, and the restored cause lines (lay-B-fix outcome).

### 2. §23 — amend the existing **composer** (the widget) row (~line 1480) IN PLACE: keep its text, and add at its start **"⚠ Un-retired 2026-11-05 as a widget id."** and at its end the reversal, quoting both with dates: §23 (2026-09-16) "Merged into **messages** 2026-09-16: the log and the field you write into are one thing to arrange" is superseded by owner ruling R8 (2026-11-05) "Split the messages, composer and activity status/turn select into three widgets"; `composer` is off `RETIRED_WIDGET_IDS` (now `{'inventory'}`); a slot-era `composer` in old slots or a stored v1 is still dropped (`LEGACY_SLOT_DROPPED`), so pre-0.6 blobs never revive one. See §9 **Composer**.

### 3. §9 (Session) — amend rows IN PLACE (minimal: change the sentences that are no longer true, add the new facts; keep history clauses):
- **panel** (~:492): now `PanelV2` `{ key, tabs, open?, height?, priority?, title? }` in `PanelLayoutV2` (`version: 2`, `left` · `middle` · `right` all `PanelV2[]`, plus `backing?` · `opacity?` · `gap?`); no pin; every panel always open; a one-tab panel draws just the widget (no pin/gear overlay — PanelTabs.svelte :8); the panel box is the card (the backing). v1 (`PanelV1`, `PanelMiddleV1`, `PanelLayoutV1`) stays readable, ⏳.
- **panel tab** (~:493): no pin, no gear after the tabs.
- **panel height** (~:498): any panel, any zone; `{ share }` written by the divider between two non-Fit panels (check ArrangeCanvas); the floors (Messages 160 `MESSAGES_FLOOR_PX`, Fit min(content, 120) `FIT_FLOOR_PX`); `allocateZone` (zoneHeights.ts) and `ZoneColumn`; the declared default `WidgetDecl.panel.height`; a value equal to the declared default is stored absent (arrangeOps).
- **zone** (~:517): a zone holds a stack of panels (no strips / primary); the **zone switch** shows one at a time.
- **turn line** · header notice (~:516): the turn line is now drawn by the **Turn line** widget (`turn-line`), parts `turn-line.*` with the ⏳ `messages.turn-line*` names kept; `nextUp` is the widget's setting.
- **composer skin** (~:514): chosen by the **Composer** widget's `composer` setting (not Messages').
- **primary floor** · primary widget (~:505): drop the stage/primary-panel sentences that are gone; the phone / full screen open on the **opening zone** (`openingZone`: the zone of the primary log, else the first zone holding a Messages copy, else the middle).
- **session layout** (~:524): its arrangement is `panels` v2 (what is written); v1 and the old slots stay readable ⏳; the one converter `panelsV2Of`; the app's boot pass `convertPanelsToV2`.
- **widget** (~:491): add `WidgetDecl.panel` (`{ height?, priority? }`).
- **drawn layout** (~:525): `DrawnLayout.middle` is a plain `DrawnZone` (⏳ `DrawnMiddle`), `DrawnLayout.look` (`PanelLook & { gapPx }`), `DrawnPanel.priority`, `resolveDrawn(layout, box, { widgets })` (`ResolveDrawnOptions`).
- **host card** (~:552): only the card around a widget opened over the session for a moment (a pop-over), `HOST_CARD_CLASS`; the per-widget setting is retired (§23).
- **message backing** row (~:553): replace with a one-line pointer "Retired 2026-11-05 → §23; see **backing**." OR delete it if §23 now carries it — choose the pointer (keeps old links meaningful).
- primary panel / strip / docked · in the rail / rail strip rows (~:494-497): reduce each to `~~**term**~~ ⏳ | **Retired 2026-11-05** → §23 (…one clause…).` (the pattern rows ~:520-522 already use).

### 4. §9 — ADD rows (insert as a block right after the **panel height** row). Each row: the term + code names + 🚧, then **Built 2026-11-05 (session layouts simplified; lane lay-x)**, then the charter: what it is, why it exists (cite the owner ruling), what it owns, what it does NOT own (and who does), ⚠ near-neighbours.
- **Composer** (the widget, `composer`) 🚧 — settings `composer` (skin), `otherTabsComposer`, `showActions`; `panel: { height: 'fit', priority: 'high' }`; writes to its **target** Messages (`conversationTargetOf`: nearest panel above in its zone whose open tab is a Messages copy, else the nearest Messages panel in its zone, else the layout's first Messages; dossier `composer.target` / `composer.writingTo`, `ConversationComposerV1`); _Writing to ‹label›_ (part `composer.writing-to`, role=status) while the target panel shows another tab; wears its target's style unless pinned its own (`styleSourceOf`); takes the target's Line width and presentation; `coreWidgets.composer`; core trust only (`CORE_VIEW_ONLY_COMPONENTS`); parts `composer.*` aliases beside the ⏳ `messages.compose*` names; id derived from its Messages copy (`conversationSplitIds`). ⚠ Not the **composer venue**, not composer actions, not the **composer draft**.
- **Turn line** (the widget, `turn-line`) 🚧 — setting `nextUp`; `panel: { fit, normal }`; follows the same target; parts `turn-line.root` + `turn-line.*` aliases (StateProposalList included), ⏳ `messages.turn-line*`; `coreWidgets.turnLine`.
- **panel priority** (`PanelPriority`, `PanelV2.priority`, `WidgetDecl.panel.priority`, `DrawnPanel.priority`; UI **Priority** · _High_ · _Normal_ · _Low_, help _When a zone runs out of height, Low gives way first, then Normal. High keeps its height longest._) 🚧 — owner R8 "introduce a fill/fit priority"; default from the open tab's declaration (Composer high, Turn line normal, Messages low, else normal); `setPriority`, `priorityOf`, `declaredPanelOf`, phone `setRowPriority`; `data-priority-high|normal|low`.
- **zone switch** (`ZoneSwitch.svelte`, `sessionZones` / `SessionZones`, `switchOn`, `ZONE_LABELS`; UI **Left** · **Middle** · **Right**; accessible name _Zone shown_ — 🚧, owner ★ on the wording) 🚧 — owner ★2; on below `lg` always (its own row under the header on a phone) and on a desktop when the sides don't fit beside a readable middle (`tuckThresholdPx`); needs ≥2 zones with panels; starts on the **opening zone** (`openingZone`); side slots `inline` · `stowed` · `solo` (`sideSlot`), side widths `sideWidthPx`. ⚠ Not the shell's **rail** (§26).
- **widget gap** (`PanelGap`, `PANEL_GAP_PX` = 4 / 12 / 24, `PanelLayoutV2.gap`; UI **Widget gap** · _Tight_ · _Comfortable_ · _Spacious_; help _The space between panels and around the zones._; CSS `--sp-zone-gap`) 🚧 — owner R9; also the body's outer padding (lay-C open ★1).
- **backing** (the layout setting; `PanelBacking` `card` · `glass` · `none`, `PanelLayoutV2.backing`; with **opacity** `PanelLayoutV2.opacity` 0–100; `PanelLook`, `DEFAULT_PANEL_LOOK` = card · 100 · comfortable; UI **Backing** · _Card_ · _Glass_ · _None_, **Opacity**; help _What every panel sits on. How a card and glass look comes from your theme._ · _Lower lets your background show through._; app `hostWidgetBox`, `backingShown`, `setLook`, `lookOf`, `LookPatch`, `LayoutLookSection`) 🚧 — owner R7; drawn on the **panel**; `layout.v1.chrome.card` = "the panel's backing is not none". ⚠ Not a **backdrop** (the Backdrop widget's picture), not the retired **message backing**, and the value _Card_ is the theme's card surface (STYLE-GUIDE §2.8), never a character **card** (§8).
- **`--sp-widget-*`** (`--sp-widget-margin` · `--sp-widget-background` · `--sp-widget-radius` · `--sp-widget-border`; `WIDGET_BOX_VARS`, `declaredWidgetBox`, `widgetBoxStyle`) 🚧 (names provisional, §24) — the host sets them on each panel from the backing; the SHOWN tab's style may override (variables over CSS, last wins); unsafe values dropped (`filterWidgetStyleValue`, plus `url(`, backslash, `;{}<`). Dreamlit Cameo zeroes background + border.
- **`show-channel`** (widget request, core only) 🚧 — Messages tells the host the channel it shows (on mount and each change); the host's `shownChannels`; refusals _show-channel needs the channel's name as text_ · _A channel's name is at most 200 characters._
- **`session-scenario`** · **`set-session-scenario`** (widget requests, core only) and the Author's note **Scenario** field (parts `authors-note.scenario` · `authors-note.scenario-text`; copy _Scenario_, _Describe the session scenario, setting, or context (optional)_, _Could not read the scenario: {reason}_, _Only the session's owner can change the scenario._) 🚧 — ★4; writes through the existing `sessions:update { session: { id, scenario } }` (no new event); refusals _this page can't read the session's scenario_ · _this page has no session_ · _set-session-scenario takes the scenario as text_ · _A scenario is at most 20000 characters._ · _this page can't save the session's scenario_ (verify each string in `sessionScenario.ts`). Owner-only.
- Scene Portraits **Who** (`whoKind`, `ScenePortraitsWhoKind`; _Characters_ · _Personas_ · _Both_, default both = exactly the old behaviour) 🚧 — add to the existing **Scene Portraits** row (~:434) instead of a new row if that reads better; say which you did.
- Stats' **sheet** (`arrangement: 'faces'` sheet, parts `stats.faces-sheet[data-sheet]`, `stats.sheet-portrait` · `-name` · `-role` · `-sections`, `stats.ties-head` _Ties_) — add to the **Stats** row (~:435).
- **panels v2** words: `PanelLayoutV2`, `PanelV2`, `panelsV2Of` (+ `PanelsV2Options`, `PanelsV2Conversion`, `PanelSettingsMove`), `conversationSplitIds`, `LEGACY_SLOT_DROPPED`, validator warning code `panels-v1`, the warning _'…' is a slot-era composer — the old slots never draw it; place the Composer in panels_ (verify the exact string in sessionLayout.ts).
- **the boot conversion** (app, internal): `convertPanelsToV2`, `PanelsV2Report` (`sessions`, `presets`, `failed`, `pending`), `panelLayoutWriteAsV2`, `SessionLayoutPanelsReport.version2`, `StoredPanelsKind` / `storedPanelsKind`, `LayoutStores` / `LayoutStoresV2`, `storedLayoutAsV2` (option `dropStale`), `presetLayoutAsV2`, `syncWidgetSettings(decls, { spare })`, `MESSAGES_MOVED_KEYS`. Owns the one-time rewrite of stored rows; does not own the converter's rules (the SDK's `panelsV2Of`).
- **the Arrange inspector** (`ArrangeInspector`, `INSPECTOR_PX` 380, `ordinal`, header _‹Widget› · ‹Zone›, ‹nth› panel_, empty-state title **Layout settings**, **For style authors**, phone **Back**; `askSettingsInArrange` / `settingsInArrangeAsk`, `data-chosen`) 🚧 — owner R4; owns where a widget's settings and style are edited; does not own the settings themselves (the widget's declaration).
- The editor ops vocabulary (`StackPlace`, `PanelSlot`, `TabSlot`, `ArrangeOutcome`, `ALREADY_PLACED`, `UNKNOWN_PANEL`, `UNKNOWN_TAB`, `heightOf`, `setHeight`, `PHONE_SECTIONS`, `PhoneRow`, `PhoneSection`) — one row, internal.
- The live runtime vocabulary (`allocateZone`, `ZonePanelIn/Out`, `floorOf`, `cssTrackOf`, `ZoneColumn`, `conversationKindOf`, `CONVERSATION_MOUNTS`, `centerSlot`) — fold into **panel height** / **zone** rows if natural, else one internal row.
- Layout titles shipped by core (Cast, Scenario, Last character, Story, Characters, World, Lore, Last persona, Party, Table talk, Guide; `GUIDE_LAYOUT`) — one row or a clause in **genre default layout** (~:528).

### 5. §22 Needs an icon — add **Composer** and **Turn line** (the widgets): hold no glyph (lay-B open ★7).

### 6. §26 — amend IN PLACE: **Full screen** (now shows the WHOLE **opening zone**, no zone switch; check `placementRules.ts` `fullscreenActive` and whether the app header/rail/bottom bar/sidebar still step aside — they do per getting-around.md; verify) and **furled header** ("the layout's top strips" are gone with the strips: the bar alone rolls up — verify in Header.svelte).

### 7. §25 — add a NEW subsection at the very end of §25, immediately BEFORE the `## 26. Shell` heading (after the paragraph that starts "⚠ **What the layering build left in the interface copy**"), so you never touch the rows the cv programme is appending: 
`### session layouts, simplified — 2026-11-05 (owner GO; PLAN-session-layout-simplify-2026-11-05, lanes lay-A…F)` then a `| Was | Is | Cost |` table, **one row per change** (each retirement in step 1, the composer un-retirement, each amended row in step 3, each added row in step 4, §26's two). "Cost" = what moved (files, data, the boot pass, deprecated exports kept).

## Stop and ask (report, don't decide) when
- a name in this brief isn't in the code, or the code spells it differently (record the code's spelling, list it);
- a new name collides with an existing §9/§23 meaning (R1) — say which;
- a row you'd have to rewrite belongs to the cv programme's current edits (seat/cast/version words).

## Done means
All seven steps done with minimal Edit hunks; every recorded name grepped; report as your final message: each row added/amended/retired with its line number, names you could not find, collisions, open questions, Noticed-not-done.
