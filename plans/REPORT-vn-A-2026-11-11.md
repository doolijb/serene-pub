# REPORT — vn-A (SDK), 2026-11-11

Saved by the lead from the supervisor's hand-back (the harness refused the subagent's own write). Nothing committed, built or stashed.

Mid-lane the owner ruled "a different widget … not overload the normal widget". The lane stopped its Messages and layout goals, undid by hand every edit touching Messages or the layout, and finished the look fields and Scene Portraits.

## Finished
- **`sdk/src/sessionLayout.ts`** — `behind?: 'background' | 'backdrop'` and `behindDim?: number` on `PanelLayoutV2` and `PanelLook` (optional); `DEFAULT_PANEL_LOOK` gains `behind: 'background', behindDim: 0`; `lookOf` always fills both (`behindDim` clamped 0–100); `DrawnLayout.look` is `Required<PanelLook> & { gapPx }`; validator errors `"panels.behind: 'background' or 'backdrop'"` and `'panels.behindDim: a number from 0 to 100'`.
- **`sdk/src/widgets.ts`** — `'show-line': { params: { messageId: number | null }; result: void }` in `WidgetRequests`, `WIDGET_REQUEST_ASKERS` (`'core'`), `WIDGET_REQUEST_APIS` (`'session'`); **declared, wired into nothing**. `SessionCharactersV1.speakerRef?: string | null`. The `SessionCharacterV1.sprite` comment says it follows the shown line when a widget holds its reader's place.
- **`sdk/src/sessionDossier.ts`** — `SessionDossierV1.ownNewestMessageId?: number | null`; **declared, filled nowhere**.
- **Scene Portraits** — `speakerFocus` (boolean, default false, **Dim whoever isn't speaking**, description "Every face but the one whose line is shown is dimmed.") in `core-catalog/src/registry/widgets.ts`, `portraits.ts` (settings, defaults, reader); `ScenePortrait.speaking: boolean` (required) true only when `characters.speakerRef` equals the member's `ref`; `ScenePortraitsWidget.svelte`: root `data-speaker-focus=""` only when the setting is on and a drawn portrait is speaking; member face `data-speaking=""`. No CSS.
- **Tests** — new `sdk-tests/coreScenePortraitsSpeaker.test.ts` (source alias); new cases in `sessionLayout.test.ts`, `resolveDrawn.test.ts`, `coreScenePortraits.test.ts`. Updated: look `deepEqual`s in `resolveDrawn.test.ts` (2) and `panelsV2Of.test.ts` (3) gain the two keys; the Scene Portraits defaults `deepEqual` gains `speakerFocus`.
- Targeted run after the undo: 187 pass, 0 fail across `sessionLayout`, `resolveDrawn`, `panelsV2Of`, `coreShippedLayouts`, `coreScenePortraits`, `coreScenePortraitsSpeaker`, `coreScenePortraitsComponent`, `widgetSections`, `coreGenreDefaults`. `sdk-tests` `tsc --noEmit` clean.

## Undone by hand (no git)
- The three Messages settings in `registry/widgets.ts`; `STORY_VISUAL_NOVEL_LAYOUT` in `registry/layouts.ts`; the `visual-novel` entry in `registry/genres.ts`; three tests and an import in `sdk-tests/coreShippedLayouts.test.ts` (untracked file, could not be compared with a committed copy; `tsc` clean); the layouts count in `sessionLayout.test.ts`; the golden in `coreCatalog.test.ts` back to `'a45adb233d3e2579'`.
- Messages component files, conversation files and Messages tests were never touched. No `readingPlace.ts`, `lineSpeechPhase` or `readingTimeMs` was ever written.

## Shapes for the next lanes
- **CSS targets:** `[data-widget-part~="scene-portraits.root"][data-speaker-focus]`, `[data-widget-part~="scene-portraits.face"][data-speaking]`.
- **Style pins:** a shipped layout pins by slug only; core style rows are seeded with slug `systemStyleSlug(widgetId, preset)` (e.g. `scene-portraits:open-stage`), so a shipped pin is `{ slug: '<widgetId>:<preset>' }`. The SDK validator never refuses an unknown slug.
- ⚠ **App blocker for pins:** `setWidgetStylePins` (`src/lib/client/stores/widgetStyles.svelte.ts:1004`) drops every pin with no numeric `id`, and `layoutPresets.ts:779` copies shipped pins verbatim, so a slug-only pin never takes effect. No core layout pins a style today; the first one needs the store to accept `{ slug }` pins.
- After `sdk:build` the app **must** answer `show-line` or its typecheck fails (tables typed off `WidgetRequestKind`).

## Known failing, as found
- `sdk-tests/coreCatalog.test.ts` golden: digests the **built** core-catalog dist (built by another session at 13:07 today, holding none of this lane's changes). Actual `dca69d9fcbf8c587`. **Re-pin after the lead's `sdk:build`.**
- Not run: the SDK components `svelte-check` (reads `dist` types; run after `sdk:build`).

## Noticed, not done
- `INTEGRATING.md` §5b says "45 request kinds"; there are 77.
- `SessionCharacterV1.lastSpokeAt`'s comment still says "newest"; it will also follow the shown line.
- `ScenePortrait.speaking` is required: app code or tests building a `ScenePortrait` literal need it. App tests that `toEqual` a drawn look need the two new keys.
- `coreScenePortraitsComponent.test.ts` mounts `dist`, so only the aliased new test covers the new code until a build.
- The harness cache `sdk-tests/node_modules/.cache/serene-pub-harness/harness-worker.mjs` lacks `show-line`; a build refreshes it.
