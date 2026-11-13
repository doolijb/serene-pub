# RECON — session widgets (2026-11-05, read-only Plan agent; lead decisions in PLAN §3 override its ★s)

SDK = /home/jody/github/serene-pub-sdk, APP = /home/jody/github/serene-pub

## 1. Messages widget
- Decl SDK core-catalog/src/registry/widgets.ts:63-421 (`role:'primary'`; reads layout/messages/actions/settings/viewer/locale; settings composer, otherTabsComposer, composerPosition, lineWidth, presentation, order, showMessages, showComposer, channel/lane/interleave/rowKinds, Reading, nextUp + showActions 395-419). App core-owned settings APP src/lib/shared/widgets/settings.ts:121-160 (`coreSettingsSchema`: title, lane, `backingMode` on messages / `hostCard` elsewhere; `CORE_SETTING_KEYS` :54).
- Mount: core component `messages` (widgets.ts:1533; entry components/shared/messages/messages.ts) served at /core-ui/messages, run remote in core's one UI worker (components/host/uiWorkers.ts:90); Messages.svelte wraps MessagesWidget.svelte. App: SessionLayoutRender.svelte:288-347 branch `isInstanceOf(id,"messages")` (grant session:full, `model.dossierFor(id)` sessionLayoutModel.svelte.ts:574-582 narrows composer.channels, `backing`, `pageIds`); ComponentMount.svelte:186 special-cases /core-ui/messages (page ids, no paint containment); widgetId on the wire = instance id (ComponentMount.svelte:202).
- Parts in MessagesWidget.svelte: channel head 381-389, channel tabs 390-418, log 427-438, selection bar 439-546 (replaces composer), `messages.compose` 547-595: `<TurnLine nextUp>` 552, read-only banner, rewind note 570-590, `<SessionComposer {composerSkin} showActions>` 591.
- One in-mount model `createConversation(ctx)` (conversation.svelte.ts:67): channel shown = widget-local `$state` (`lane`, 100, 405-418), selection 638-690. Tabs `channelTabsOf(conversation.channels)` (MessagesWidget 291), active `conversation.lane.current`; composer skin per tab 325-329; actions row/preview/palette/persona switcher local to SessionComposer.svelte (271-313); TurnLine reads `useConversation()` (TurnLine 41); typing = host view `session-banners` (213, 259).
- The page doesn't know the shown tab; learns channel only on `send` (requests/send.ts:70-71 → setChannel); `composerChannel` page-global (sessionPageData.svelte.ts:253); one draft per page (sessionPageProjections.ts:809).
- `widgetId:"composer"` in request tests is only a fixture (send.test.ts:126, draft.test.ts:52, switchPersona.test.ts:25, addPersona.test.ts); answerers trust `from.owner === "core"` (send.ts:55, draft.ts:22, askers.ts:45). Leftover of the old composer widget merged 2026-09-16 (NOMENCLATURE:1480).
- Each core component is its own bundle (dist/components/<slug>.js) → no shared module state between Messages and Composer mounts; coordinate through the host.

## 2. Composer growth
Field `field-sizing: content` max 9em (widgets.css:1437-1460); Tall editor min 13.2em (1473-1479); actions row SessionComposer.svelte:690-785; preview max 18em 843-850 / widgets.css:1344-1351; host-view pane 824-842; `/` palette 852-905; attachment tray 937+; run-progress host view 685; rewind note; closed reason. Remote DOM is real page DOM → ResizeObserver on the box's first child works. Fit today pure CSS `flex:0 1 auto; max-block-size:40%` (Render :173-179), `minmax(floor,auto)` (sideRail.ts:153). Composer root must not be block-size:100%.

## 3. Backing
messageBacking.ts: `declaredBacking` regex-reads `--sp-backing` from style css/vars (71-89); `resolveBacking` (108-114); call site Render :310-342 with `effectiveWidgetSkin(id)` (stores/widgetStyles.svelte.ts:1125) → `data-sp-backing` (ComponentMount.svelte:99-103, 396) painted widgets.css:207-254 as `::before` on messages.root. hostCard.ts → Panel.svelte:172-198 `HOST_CARD_CLASS`, `data-sp-card`, `withHostCard` (shared/widgets/context.ts:170). Dreamlit Cameo declares `--sp-backing: none` (corePresets.ts:449-469). Page line (`quill`) composer box-less, sits on the messages pane (widgets.css:2273-2335). Skins confined to the mount's skin scope (widgetStyles.svelte.ts:778) → host must lift values like `--sp-backing` today.

## 4. Scene Portraits
`scenePortraitMembersOf` SDK core-catalog/src/shared/ui/scene-portraits/portraits.ts:224-258 (`cast = !isPersona`; `mine` only when `persona`); Recent sorts by `lastSpokeAt`; settings widgets.ts:453-548, read portraits.ts:141-166. Today only the viewer's OWN persona can appear.

## 5. Author's note + scenario
Widget widgets.ts:1463-1470 (no settings); component components/genres/story/authors-note/AuthorsNoteWidget.svelte; requests `authors-note`/`set-authors-note` (SDK sdk/src/widgets.ts:1918-1924, core-only at 2727, answered APP requests/authorsNote.ts). Server sessions/authorsNote.ts:120-137 (members read, owner writes, `offered` only when the genre declares `authorsNote`). Scenario column sessions.scenario (schema.ts:2555), written only via `sessions:update` (sockets/sessions.ts:6060, owner gate 6104, allowlist 6204-6207).

## 6. Stats
`arrangement:'faces'` exists (widgets.ts ~791-812; StatsWidget.svelte:21-26, 133-135, 280-305): faces strip over ONE flat sheet, own seat first, chosen chip per viewer; sheet head face → portrait picker (`stats.face-picker` 470-553); piece rows + popouts + Give to… (10, 34-41); owners cast|world|places|all|pick|mine|seats; `facesOwners` stateView.ts:619. Missing for a Characters tab: sections/headings (attributes/skills/inventory one flat list), large portrait/bio area, empty sheet when genre declares no slots, personas carry no state. `inventory` is a retired widget id.

## Proposed (decided form in PLAN §3 D7–D9, D13)
Three widgets: messages (log, head, tabs, selection bar at its foot), turn-line (TurnLine + nextUp), composer (SessionComposer + rewind/read-only notes; settings composer, otherTabsComposer, showActions). Conversation family branch `messages|composer|turn-line` in Render (same grant, same dossier; pageIds messages only). New core-only request `show-channel {channel}` from Messages on `lane.set`; host keeps `shownChannel[instanceId]`; `dossierFor(composerOrTurnLine)` resolves target + `composer.writingTo = {instance, channel, label, note}`; `conversation.lane.current` in composer/turn-line reads the dossier. Backing vars on `.ptabs` + `declaredWidgetBox(skin)`. Portraits `whoKind`. Scenario requests + `sessions:setScenario`. Stats Characters tab.

## Tests
Target resolver (nearest above; non-Messages tab keeps last; fallback; same-panel tabs); show-channel answerer + askers rows; declaredWidgetBox (replaces messageBacking.test.ts); hostCard.test trimmed; scenePortraitMembersOf × whoKind; scenario request + owner-gate int test; widgets.fill.test.ts (261 messages.compose*/turn-line refs, 8 scoped under messages.root — break when they leave that ancestor); SDK coreConversationComponent.test.ts + new composer/turn-line component tests; retarget `widgetId:"composer"` fixtures.

## Docs
NOMENCLATURE: turn line (now a widget), message backing + backing mode (retired), host card (pop-over only), channel tabs (otherTabsComposer moves), composer-widget retirement row (reversed), `--sp-widget-*`, show-channel, whoKind. STYLE-GUIDE §6.16 parts. docs/session-layout.md.
