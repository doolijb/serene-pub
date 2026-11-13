# BRIEF lay-C-w3 — the live layout MODEL on panels v2 (no pin, no rail, no tuck, zone switch, composer target)

Worker for lane lay-C (supervisor: lay-C). App: /home/jody/github/serene-pub. SDK (read only, built): /home/jody/github/serene-pub-sdk.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Context (owner rulings 2026-11-05, PLAN `plans/PLAN-session-layout-simplify-2026-11-05.md` §1–§3 — read §2 ★1–★11 and §3 D1, D7, D10, D11)
Stored layouts are now **panels v2**: `{ version: 2, left: PanelV2[], middle: PanelV2[], right: PanelV2[], backing?, opacity?, gap? }` — every zone a flat stack; no primary panel, no strips, no `pinned`. The SDK (lay-A, built) gives: `panelsOf(layout, opts?) → PanelLayoutV2` (v1/slot blobs converted, Composer + Turn line panels derived), `resolveDrawn(layout, box, { widgets }) → DrawnLayout { left, middle, right: DrawnZone (plain: .panels, .instances); look: { backing, opacity, gap, gapPx } }`, `DrawnPanel.priority`, `DrawnPanel.height`, `conversationSplitIds`. `DrawnZone.rung`/`zoneKey` are never set any more; `DrawnMiddle`, `pinnedOf`, `ZoneRung`, `DEFAULT_SIDE_RULES`, `zoneRungAt` are ⏳ deprecated — do NOT use them. Types: `/home/jody/github/serene-pub-sdk/sdk/dist/sessionLayout.d.ts`; behaviour: `/home/jody/github/serene-pub/plans/REPORT-lay-A-2026-11-05.md` (read it).
Rulings that shape the model: ★1 the rail of icons goes with the pin — every panel always open; retire docked / rail / fly-outs / tucked sides / Alt+[ ] / the Session panels sheet. ★2/D11 a **zone switch** (Left · Middle · Right) shows one zone at a time when the sides don't fit beside a readable middle, and always below `lg`. ★3 a phone / full screen opens on the zone holding the first Messages panel, else Middle; full screen shows that WHOLE zone and no switch. D7 a Composer / Turn line follows a Messages copy (target rule in `conversationTarget.ts`, already built).
A sibling worker (lay-C-w4) rewrites the Svelte files AFTER you (SessionLayoutRender, SideMount, PanelTabs, PanelRail, PanelsMenu, SessionLayout.svelte, Header). They will break when you change/delete what they import — that is expected; do not edit any .svelte file. Editor files (ArrangeCanvas, arrangeOps, mobileEdit, SessionLayoutEditor, MobileLayoutEditor, LayoutEditorToolbar, editorMembership, presetPreview, PresetPicture, WidgetSettings*, WidgetStyle*) belong to lane lay-D — never edit them; list what of theirs breaks.

## Files owned (edit only these)
- `src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts`
- `src/lib/client/sessionLayout/{primaryFloor,placementRules,livePanels,sideSlot,tuckedSides,stageBalance.svelte,sideRailModel.svelte}.ts` and their existing tests (`primaryFloor.test.ts`, `placementRules.test.ts`, `sideSlot.test.ts`, `tuckedSides.test.ts`)
- DELETE: `stagePanel.ts` + `stagePanel.test.ts`, `sideRail.ts` + `sideRail.test.ts`, `mobileSidePanels.svelte.ts` + `mobileSidePanels.test.ts`, `liveFlyouts.svelte.ts` (`git rm` is fine? NO — use plain `rm`; never git checkout/restore/stash)
- `src/lib/client/surfaces/panelManager.svelte.ts` (only `setPanels`, `#currentPanels`, `setPanelOpen`, delete `setPanelPinned` + the `withPanelPinned` import) and `src/lib/client/surfaces/panelManager.presets.test.ts` (delete the `setPanelPinned` case ~187-192)
- `src/lib/client/components/sessionPage/sessionLayoutData.svelte.ts` — verify `committedArrangement` (~284) sends v2 (`panelsOf` now returns v2); change only if wrong.

## Files readable (already built for you — use them, don't edit)
`src/lib/client/sessionLayout/{zoneHeights.ts,sessionZones.svelte.ts,conversationTarget.ts,panelBacking.ts,channelClaims.ts,tabAttention.svelte.ts}`, `src/lib/client/components/sessionPage/requests/showChannel.ts` (`shownChannels: SvelteMap<instanceId, canonical channel>` — what each Messages copy last said it shows), `src/lib/shared/widgets/types.ts` (`CORE_WIDGETS` — they carry `panel: { height, priority }`), the current Svelte files that read the model (to see what they use).

## 1. `primaryFloor.ts` → v2
- `drawnOf(layout, box = { inline: 0 }, opts?: ResolveDrawnOptions)` passes opts through to `resolveDrawn`.
- `readStoredLayout(layout, primaryId = "messages", omit = new Set())` returns `{ panels: PanelLayoutV2, widgetSettings?, widgetStyles? }`:
  - stored = the blob stores valid `panels` (version 1 OR 2, the shapes the SDK reads); `panels = panelsOf(blob, { primaryWidgetIds: [primaryId] })`.
  - Omit: drop each tab whose `widgetOfInstance(id)` is in `omit`; when `omit.has("messages")` ALSO drop `composer` and `turn-line` instances (they write to / speak about the log; with no log they have nothing to follow — name this in your report as a decision). Panels left empty go.
  - Floor: only for a CONVERTED blob (not stored) or when the omit emptied a non-empty middle: `withPrimaryFloor(panels, primaryId)`. For a converted blob whose converter supplied a floor conversation while `primaryId !== "messages"` (an R71 genre such as Battleship's board), drop the converter's floor panels first (the floor Messages AND its derived Composer / Turn line — find how the SDK marks them: `DrawnPanel.floor`, and read `sdk/dist/sessionLayout.js` for how PanelV2 carries it).
- `withPrimaryFloor(panels: PanelLayoutV2, primaryId)`: by reference when `primaryPlaced({ panels }, primaryId)`; else prepend `{ key: freshKey, tabs: [primaryId] }` to `middle`.
- Delete `withPrimaryFilled` and `MiddlePlaces` (the primary place is gone). Keep `drawnIdsOf`, `primaryInstances`. Fix `primaryFloor.test.ts` to v2 (drop the withPrimaryFilled cases).

## 2. `livePanels.ts`
- `PanelPlace = "left" | "middle" | "right" | "above" | "primary" | "below"` (the last three ⏳ v1, read by lay-D's editor until it moves to v2 — mark them so in the doc comment).
- `findPanel(layout: PanelLayoutV1 | PanelLayoutV2, key)`: v2 → searches left, middle, right lists (place = the zone); v1 → exactly as today. `replacing`, `openTabOf`, `withPanelOpen` work for both (return the same version they were given).
- Delete `withPanelPinned` (lay-D's `arrangeOps.ts` imports it — list that break).

## 3. `sideSlot.ts`
- `SideSlot = "inline" | "stowed" | "solo"`; `sideSlot({ narrow, shown, side }: { narrow: boolean; shown: ZoneId | null; side: "left" | "right" })`: `shown === side` → `solo`; `shown !== null` → `stowed`; else `narrow ? "stowed" : "inline"`.
- `sideWidthPx(bodyPx: number): number` — a side's width now that no ladder rung is drawn (today's docked widths, one column): `≥2400 → 344`, `≥1900 → 300`, `≥1440 → 264`, else `248`.
- `sidePopulated({ panels })` = panels > 0. `sideFlowPx({ slot, populated, widthPx })` = `slot === "inline" && populated ? max(0,widthPx) : 0`. `emptyColumnPx({ slot, populated, widthPx })` = `slot === "inline" && !populated ? widthPx : 0`. Drop `SideMode`, `RAIL_PX`, the tucked/mode params. `MIN_CENTER_PX`, `inlineSideWidths`, `dockedZoneWidths`, `emptyColumnsPx` unchanged.
- `sideSlot.test.ts` → the new rules (delete tuck/rail/stage/overlay cases; keep the width maths cases).

## 4. `tuckedSides.ts`
Keep `STAGE_MEASURE_PX`, `stagePlanPx`, `TuckThresholdInput`, `tuckThresholdPx` (the zone switch reads it), `BalancedGuttersInput`, `Gutters`, `balancedGutters`, `MiddleZone`, `middleZone`, `ColumnInsetInput`, `columnInsetPx`. Delete `sidesTucked`, `SidesTuckedInput`, `tuckedSidesOf`, `TuckedSidesInput`, `TuckedFlyout`, `toggleTuckedFlyout` and their tests (the TS error at `tuckedSides.test.ts:405` goes with them). Re-word the module comment (no tuck).

## 5. `stageBalance.svelte.ts`
Drop `flowEdge` (only tucked flyouts used it). `BODY_GAP_PX` → `input.model.gapPx`. `stageBalance` = the gutters always (the middle is always one column; drop the `middleOneColumn` read).

## 6. `sideRailModel.svelte.ts`
Keep only `panelPlacement` and `tabIcon` (and what they need: `tierFor`, the input); delete group open/focus/collapse/flyout/columnLayout/cellGridStyle/groupIcon… (the rail is gone). `panelPlacement`: the envelope's `pinned` is always `true`, `collapsed` always `false`, `drawered` `false` (PLAN D4: "Envelope `LayoutV1.pinned/collapsed/drawered` stay on the wire as true/false/false"); `chrome` for the conversation family (`messages`, `composer`, `turn-line` instances — use `conversationKindOf`) is `{ background:false, wrapper:false, titleBar:false }` as Messages had. Keep the exported type name `SideRailModel` (lay-D's ArrangeCanvas imports it for `tabIcon`).

## 7. `placementRules.ts`
Keep `primaryLogPick` (and its `StagePick`, `StageInput`, `StageZone`), dropping `strips` from the input (the middle is one list). Delete `stageOf` and `STAGE_FOLLOWS_CONVERSATION` if nothing else imports them (grep). Move `fullscreenActive(ctx)` here from `stagePanel.ts`. Add `openingZone({ middle, left, right, claims, primaryId, isMessages }): "left" | "middle" | "right"` — the zone of `primaryLogPick` (the layout's primary log), else the first zone in middle, left, right holding a Messages copy, else `"middle"` (PLAN ★3). Tests in `placementRules.test.ts`.

## 8. `sessionLayoutModel.svelte.ts` — the new surface
Keep unchanged: the measured fields + setters (`containerW … mounted`, `isNarrow`), the simulator/editor flags (`editing, simTier, simWidth, editTab, placing, editGeom, simPct, simHeight, simNarrow, mobileEdit, liveStowed, toolbarH, editorTop, liveTop`), `primaryId`, `activeSecondaryIds`, `legacyStyles`, `inst`, `iconOf`, `middleWidgetLabel`, `middleWidgetIcon`, `placedIds`, `pageIdsHeld`, `fullscreen`, `rail` (trimmed, §6). Change / add:
- `savedPanels: PanelLayoutV2` (`readStoredLayout(...).panels`), `panels: PanelLayoutV2`: the editor's working copy is accepted as v1 OR v2 (`version` 1|2 with the shapes; a v1 working copy is converted with `panelsOf({ panels: working })`) — lay-D's editor still emits v1 until it moves. Extras (`x:<id>` panels) are appended to `right` as today.
- `drawn = resolveDrawn(layoutDoc, { inline: containerW }, { widgets: CORE_WIDGETS })` (priority / height defaults come from the declarations: Messages fill/low, Composer fit/high, Turn line fit/normal).
- `look` (= `drawn.look`) and `gapPx` (= `drawn.look.gapPx`). Delete `BODY_GAP_PX` (Render and stageBalance read `model.gapPx`).
- `isConversation(id)`: a `messages`, `composer` or `turn-line` instance (`conversationKindOf(id) !== null`) and `!manager.omitted.has("messages")`. `drawable` as today with it. `isMessages(id)` = `isInstanceOf(id, "messages")` — export it.
- `zones: { left: DrawnPanel[]; middle: DrawnPanel[]; right: DrawnPanel[] }` — each zone's `live()`-filtered panels (the middle is a plain list; no `withPrimaryFilled`). Delete `middle`.
- `sides: { left: SideView; right: SideView }`, `SideView = { panels: DrawnPanel[]; widthPx: number; populated: boolean }` with `widthPx = sideWidthPx(containerW)`. Delete `SideView.rung/mode`.
- `dockedFlow` = `sideFlowPx` with the slot it WOULD have inline; `sideWidths` and `emptyColumns` as today but on the new helpers (the soft empty column stays: "An empty side keeps its column", STYLE-GUIDE §5.3).
- Zone switch: `availableZones: ZoneId[]` (the zones whose live panel list is non-empty, Left · Middle · Right order); `openingZone` (`placementRules.openingZone` over the reading order; if not available → `availableZones[0] ?? "middle"`); `switchOn` = `mounted && !editing && !fullscreen && switchOnFn({ narrow: isNarrow, bodyPx: containerW, leftPx: dockedFlow.left, rightPx: dockedFlow.right, gapPx })` (import `switchOn` from `./sessionZones.svelte` under another local name); `shownZone: ZoneId | null` = `fullscreen && !editing ? openingZone : switchOn ? (sessionZones.shown && availableZones.includes(sessionZones.shown) ? sessionZones.shown : openingZone) : null`. The model does NOT write `sessionZones` (the render publishes `{ switchOn, available: availableZones, opening: openingZone }` from an effect — lay-C-w4).
- `leftSlot` / `rightSlot` = `sideSlot({ narrow: isNarrow, shown: shownZone, side })`; `centerSlot: "flow" | "stowed"` = `shownZone === null || shownZone === "middle" ? "flow" : "stowed"`.
- Reading order: `{ middle: ids(zones.middle), left: ids(zones.left), right: ids(zones.right) }` (no strips); `readingIds` = middle, left, right; `primaryLog`, `claims`, `lanes`, `pageIdsHeld` as today.
- `dossierFor(id)`: for a `messages` instance exactly as today. For a `composer` / `turn-line` instance (PLAN D7, lay-B report "Dossier fields"):
  1. `pick = conversationTargetOf({ zones: <zones as { key, tabs: instanceIds, open }>, instanceId: id, isMessages, last: lastTargets.get(id) ?? null })`; no pick → the page's dossier unchanged (the Composer then writes to the first writable channel).
  2. `lastTargets.set(id, pick.target)` — a PLAIN `Map` in the factory (memory, not state: it must not become a dependency loop).
  3. `td = dossierFor(pick.target)` (the target's narrowed dossier; null → null). `channel = shownChannels.get(pick.target) ?? td.composer.channels[0] ?? "main"`; `label` = `td.composer.channelLabels?.[slug]` where `slug` = the part of `channel` before `:` (a lane `parley:2` → `parley`), else the slug title-cased.
  4. `lineWidth` = the target's `widgetSettingValues(target).lineWidth` when it is `column | full | comfortable`; `presentation` = its `presentation` setting when `rows | folio`.
  5. Return `{ ...td, composer: { ...td.composer, target: { instance: pick.target, channel, label, lineWidth?, presentation? }, ...(pick.writingTo ? { writingTo: { channel, label } } : {}) } }`.
  Also export `conversationTargetFor(id): string | null` (the same pick's target, no dossier) — the render uses it so a Composer / Turn line WEARS its target's style unless pinned its own (D8).
- Delete: `railOnly`, `tucked`, `tuckedByWidth`, `sidesAreTucked`, `middleOneColumn`, `mobileSide`, `stagePick`, `stageSide`, `stagePanelKey`, `stageMiddleKey`, `middleStageHidden`, `logPanelKeys`, `logSide`, the `mobileSidePanels` / `stagePanel` / `tuckedSides.tuckedSidesOf` imports. Update the module doc comment (no rail, no tuck, no stage; zones + switch).

## Rules (quoted; they bind you)
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." (Your `lastTargets` is deliberately NOT state.) "Untrack reads in effect-called store methods." "Browser code … no `crypto.randomUUID`, no `navigator.clipboard`." "It is a **session**, never a *chat*." "0.6 is in users' hands … Removing or renaming a published SDK name is the owner's call" (you remove only app-internal names).
- No new user-visible words. New exported names: only those in this brief (`sideWidthPx`, `openingZone`, model getters `look`, `gapPx`, `zones`, `availableZones`, `openingZone`, `switchOn`, `shownZone`, `centerSlot`, `isMessages`, `conversationTargetFor`). List every exported name you add or remove.
- Every test or typecheck run goes inside a memory-capped scope, never bare, one group at a time, logging to a file:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run <a few files> > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-C-w3-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-C-w3-t.log'` then grep the log. `tsc`: same scope with `MemoryMax=12G` and `--max-old-space-size=8192`, `npx tsc --noEmit -p .`, then grep for YOUR files (others: list what broke and whose it is).
- Never hand a DOM node to an assertion (compare `x === null` to `true`). Never pipe vitest into `head` (SIGPIPE leaks PGlite temp dirs).
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to build — don't.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.
- Do not start a dev server.

## Stop and ask (in your report; don't decide) when
A rule above can't hold; the SDK doesn't mark the converter's floor in a way you can read; you need a name, word, file or setting not listed.

## Done means
Capped vitest green: `primaryFloor.test.ts`, `placementRules.test.ts`, `sideSlot.test.ts`, `tuckedSides.test.ts`, `channelClaims.test.ts`, `tabAttention.test.ts`, `tabAttention.dom.test.ts`, `src/lib/client/surfaces/panelManager.presets.test.ts` (+ any other `src/lib/client/surfaces/panelManager*.test.ts`). `npx tsc --noEmit -p .`: no error in your .ts files; list remaining errors by file and owner (Svelte files are w4's; editor files lay-D's). Report (final message): the model's final getter list (added/removed), every exported name added/removed per file, files changed/deleted, test commands + pass counts, decisions you made, what breaks for whom, Noticed-not-done.
