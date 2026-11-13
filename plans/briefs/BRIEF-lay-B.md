# BRIEF lay-B — core widgets + shipped layouts (SDK core-catalog)

Lane-supervisor (fresh, Opus). Read `plans/briefs/BRIEF-lay-common.md` first, then `RECON-layout-widgets.md`, `RECON-layout-sdk.md` §2–§3, and PLAN §1 (R5, R6, R8) + §2 (★4, ★5, ★10–★12) + §3 D3, D5–D9, D13, D15. Read STYLE-GUIDE §6.16 (widget parts) by line range and NOMENCLATURE rows **turn line**, **composer skin**, **channel tabs**, **widget part** (grep).

## Goal
Split the Messages widget into three core widgets (**Messages**, **Turn line**, **Composer**) that coordinate through the host; add Scene Portraits **Who**, Author's note **Scenario**, the Stats **Characters** sheet; rewrite the shipped genre layouts as panels v2 per ★5.

## Build
1. **Split** (core-catalog/components/shared/messages/**, registry/widgets.ts):
   - `messages` keeps log, channel head, channel tabs, selection bar (moved to its own foot). It announces the channel shown via a NEW core-only request `show-channel { channel }` on every lane change (declare it in `sdk/src/widgets.ts` beside `authors-note`, core-only list ~:2727). Messages STOPS declaring `composer`, `otherTabsComposer`, `composerPosition`, `showMessages`, `showComposer`, `nextUp`, `showActions` (PLAN D5 revised: the app converts stored rows before the prune, so nothing is lost). The SDK has no hidden-field flag — do not add one.
   - New `turn-line` widget + component: TurnLine with `nextUp`. New `composer` widget + component: SessionComposer + rewind note + read-only banner; settings `composer` (skin), `otherTabsComposer`, `showActions`. Both read their **target** (channel, channels, writingTo) from the dossier the host passes (lay-C builds the host side; define the dossier fields you read — `composer.target { instance, channel, label }`, `composer.writingTo?: { channel, label }` — and list them in your report). Composer shows *Writing to ‹label›* when `writingTo` is set. Line width: follow the target (a dossier field `lineWidth`).
   - Parts: Composer and Turn line keep emitting `messages.compose*`, `messages.turn-line*`, `messages.next-up*` part tokens ⏳ AND add `composer.*` / `turn-line.*` aliases (D8). Keep the Composer root free of `block-size: 100%` (the host measures it for Fit).
   - `WidgetDecl.panel` defaults (needs lay-A's type — do this step after lay-A lands; the lead will tell you): messages `{fill, low}`, composer `{fit, high}`, turn-line `{fit, normal}`.
   - `CORE_COMPONENTS` entries + `coreWidgets.composer`, `coreWidgets.turnLine` handles.
2. **Scene Portraits** (registry/widgets.ts :453-548; shared/ui/scene-portraits/portraits.ts): setting `whoKind` *Characters* · *Personas* · *Both* (default Both), shown when Show is *Whoever spoke last* or *Everyone in the scene*; filter BEFORE ranking. **Both = exactly today's set** (characters + the viewer's own persona when *Include your persona* is on); **Personas** = every visible persona that spoke, any player's (ignores *Include your persona*); **Characters** = no personas. Add a `scenePortraitMembersOf` test pinning the default = today.
3. **Author's note → Scenario** (components/genres/story/authors-note/**): a *Scenario* field above the note, saved by NEW core-only requests `session-scenario` / `set-session-scenario` (declare in sdk/src/widgets.ts; lay-C's answerer writes through the existing `sessions:update` — no new socket). Owner edits; others read. Show Scenario even where the note isn't offered (the note part then says nothing).
4. **Stats Characters sheet** (stats widget + StatsWidget.svelte): with `arrangement: 'faces'`, draw the chosen character's sheet in **sections by the ruleset's groups** (attributes / skills / inventory etc., whatever group the slots declare) with a **portrait column** (large face, name, one-line role) — the RPG management screen of R5. Empty-slot genres keep today's empty sentence.
5. **Shipped layouts** (registry/layouts.ts, genres.ts layout() calls) as panels v2 (after lay-A lands), per ★5 and PLAN R5:
   - Common default = **Story** default: Left [Cast (`stats` cast, compact list) · Scenario (`authors-note`)], [Last character (`scene-portraits#character`: whoKind characters, who recent, count 1, Stage)]; Middle [Story (`messages`) · Characters (`stats#characters`: owners all, faces)], [Turn line], [Composer]; Right [World (`stats#world`: owners world) · Lore (`lore-entries`)], [Last persona (`scene-portraits#persona`: whoKind personas, recent, 1)].
   - **Guide**: new GUIDE_LAYOUT = Middle [messages], [turn-line], [composer]; no sides.
   - **Lair**: Left [Party (`stats`)], [Last character]; Middle [Story · Sanctum (as today's channel tabs or two Messages, keep today's mechanism)], [turn-line], [composer]; Right [Places · Castellan's notes (`annex#castellan`)], [Last persona]. Party (guest) layout: Right [Places · Party (turn-order + attendance)] instead of the notes; no Sanctum.
   - **Dungeon Crawler**: Middle [Planner (`messages#parley`) · Story (`messages`) · Planning notes (`annex#planning-notes`) · Characters (`stats#characters`)], [turn-line], [composer]; Left [Party (`stats`) · Turn order], [Last character]; Right [Journal (`annex#journal`) · Table talk (`messages#journal`/`#table` with no composer, as today)], [Last persona].
   - **Keep** `STORY_WORLD_LAYOUT` and Story's `world` slug, converted to v2 (D15 revised): its rail panels become open panels, its world strip a Fit panel at the top of the middle, plus Turn line + Composer.
   - Each panel's widget settings carried in the layout's `widgetSettings` as today.
6. **No placeholder text when empty (owner R10, 2026-11-05)**: every core widget EXCEPT Messages draws nothing when it has nothing to show — remove the default empty sentences (Stats incl. the Characters sheet and *tracks no stats*, Places *This book has no places yet*, Backdrop *No backdrop yet…* (keep its owner buttons), Who's here *Nobody else is here.*, Annex *Nothing written yet*, Album, Chronicle, Lore entries, Scene Portraits, Turn order, While you were away, Author's note, Turn line, any other). Keep: Messages' empty line, error/stopped states, a greyed control's reason, loading spinners if any. Existing 🚧 **When empty** settings stay, default empty (show the author's text only when set). List every sentence removed in your report.
7. Queue for lay-A anything you need changed in sdk/src/sessionLayout.ts.

## Files owned
`../serene-pub-sdk/core-catalog/**` and its tests; `../serene-pub-sdk/sdk/src/widgets.ts` (request declarations + the envelope doc lay-A queues); `sdk-tests/{coreCatalog,lair,lairSanctumTab,dungeonCrawler,dungeonCrawlerWalk3,coreConversationComponent,coreScenePortraits}.test.ts` + new component tests.

## Out of scope
sdk/src/sessionLayout.ts, layout.ts, widgetDecls.ts (lay-A); the app (lay-C/E). Don't run sdk:build.

## Stop and ask when
A split widget needs host data the dossier can't carry; a ruleset declares no slot groups (report what you did); any new user-visible word beyond: Composer, Turn line, Who, Characters, Personas, Both, Scenario, Writing to ‹channel›, Last character, Last persona, Story, Characters, World, Lore, Cast, Party, Table talk.

## Done means
core-catalog tsc clean; `npx tsx --test` on your owned sdk-tests green. Report `plans/REPORT-lay-B-2026-11-05.md` with: the dossier fields Composer/Turn line read, the three new requests' shapes, the new widget ids + settings, the shipped layouts' shapes.
