# REPORT playtest-W — item 15 steps 1–4 (2026-11-04)

Saved by the lead from the supervisor's hand-back; re-created after a parallel plans clean-up (06:29) deleted it.

**Built:** steps 1–4. No actual render throw found (step 3's live-switch test passes every combination), so the race (iii) is the surviving cause; a pinned custom style (ii) untouched. Live sessions get the boundary only after `sdk:build` (not run).

**Changed files — SDK:** `core-catalog/components/shared/WidgetBoundary.svelte` (new; `<svelte:boundary>` → fatal `ctx.error`, `<p role="alert">` with the existing sentence); the 14 core widget hosts (13 under `components/shared/` + `genres/story/authors-note/AuthorsNote.svelte`) wrap in it; `component-client/src/workerRuntime.ts` listens for worker-global `error`/`unhandledrejection` → non-fatal `{k:'error'}` to every live mount; `sdk-tests/coreConversationComponent.test.ts` (+2), `sdk-tests/componentWorkerErrors.test.ts` (new).
**App:** `host/ComponentMount.svelte` (optional `onReload` → **Reload widget** button), `host/RemoteWidget.svelte` (`reloads` counter + optional `remountKey` folded into the existing `{#key}`), `sessionLayout/SessionLayoutRender.svelte` (`remountKey={Math.max(manager.seedCount,1)}`), `sessionPage/sessionLayoutData.svelte.ts` (widget-settings writes held while a copy this tab asked for is pending; refused copy → send as-is; landed copy → replay only the changed keys via exported `replayHeldWidgetSettings`; `reset()` drops held), tests `host/liveReload.dom.test.svelte.ts` (+3), `sessionPage/sessionLayoutData.dom.test.svelte.ts` (new, 6), `sessionLayoutDataHarness.test.svelte`, `docs/session-layout.md` (*If a widget shows nothing* tip). No server file touched.

**Tests:** app 9 files, 75 passed (`scratchpad/playtest-W-1.log`); SDK `coreConversationComponent.test.ts` 57 passed, `componentWorkerErrors.test.ts` 1 passed; core-catalog svelte-check 0 errors.

**Stopped, needs owner — ★W1:** overlay copy still says *"Reload the page to try it again — the extension's own message is in the browser console."* above the new button. Recommend *"This widget stopped and can't show anything. Reload it to try again — the extension's own message is in the browser console."*

**Canon rows needed (§12):** **Reload widget** (label; mounts that one widget again, keeps settings/style/view state; ⚠ not regenerate, not reset) · **WidgetBoundary** (component; ⚠ not a scene boundary, not R5's vocabulary boundary) · **remountKey** (RemoteWidget prop; ⚠ not `src`/`pageIds`) · **onReload** (ComponentMount prop).

**Noticed, not done:** `persistLayoutSettings` (style pins) has the same race; `remountKey` follows every re-seed (session save, session switch), harmless and now in the docs; `startComponentWorker` adds two global listeners per call; an `error` event with no `error`/`message` reports "undefined"; Chronicle/RoutineLog/LoreEntries run `$effect`s above the boundary; prettier-dirty files left as they were.

**Scope review (2026-11-04): no objection.** Lead applied the two doc notes; `replayHeldWidgetSettings` is a test-reachable helper, not a new abstraction.
**Verification fixes by the lead (2026-11-04):** `liveReload.dom.test.svelte.ts` widget helper typed its `remountKey` extra; SDK `coreConversationComponent.test.ts` boundary test no longer narrows `view.errors` to `[]` and casts `writes: null`.
