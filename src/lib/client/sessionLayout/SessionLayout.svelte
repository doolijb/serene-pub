<script lang="ts">
	/**
	 * The modular session layout (mockup: serene-pub-chat-layout.html, ruled
	 * 2026-08-28) — its COMPOSITION ROOT.
	 * The chat core sits in the middle; every zone around it comes from the
	 * panels in the user's layout blob (PLAN-session-panels-2026-10-14),
	 * resolved against the MEASURED container width.
	 *
	 * This file owns the stored layout's round trip and nothing else:
	 *
	 * - it builds the MODEL (./sessionLayoutModel — the drawn layout over the
	 *   SDK's `resolveDrawn`, the width, the simulator, the sides and their
	 *   rail model) and the per-widget settings flow (./widgetSettingsFlow);
	 * - it measures the root and owns the editor's open state, the working
	 *   arrangement it emits, and the bridge to the header's Layout button;
	 * - it PERSISTS the editor's arrangement: the editor emits the panels it
	 *   commits (`panels`, PLAN-session-panels-2026-10-14), and this writes
	 *   them to the manager (`persist`). A panel's own controls in the live
	 *   view (its tab, its pin) write through the manager themselves;
	 * - it renders the live session (./SessionLayoutRender) once, always, and
	 *   the editor (./SessionLayoutEditor) over it while it is open. The two
	 *   never share state: what crosses between them goes through here.
	 *
	 * The session's venues and the page's dispatch reach every widget mount as
	 * props, through the renderer — never a context.
	 */
	import { getContext, onMount, untrack } from "svelte"
	import type { SessionChannelV1, SessionLayoutV1 } from "@serene-pub/sdk"
	import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { ActionsV1 } from "$lib/shared/widgets/context"
	import type { ActionDispatch } from "$lib/shared/widgets/invokeAction"
	import type { StartFromProps } from "./startFrom"
	// The BASE conversation styling (the zero-styled grid skeleton and the
	// shared message-state treatment), imported as a plain global sheet so it
	// lands outside Tailwind's cascade layers. The looks themselves are widget
	// styles now — see messageLayouts.css.
	import "./messageLayouts.css"
	// The header's "Layout" button is the one way into the editor, and while
	// the desktop editor is open the shell hands its top band to the toolbar.
	// Header and this component are siblings under <main>, so a module
	// singleton is the bridge — see layoutEditor.svelte.ts.
	import { layoutEditor } from "./layoutEditor.svelte"
	import { mobileSidePanels } from "./mobileSidePanels.svelte"
	import {
		createSessionLayoutModel,
		type PanelsCtx
	} from "./sessionLayoutModel.svelte"
	import { createWidgetSettingsFlow } from "./widgetSettingsFlow.svelte"
	import SessionLayoutRender from "./SessionLayoutRender.svelte"
	import SessionLayoutEditor from "./SessionLayoutEditor.svelte"
	// A widget's settings and style open in ONE app-level modal (owner ruling
	// 2026-09-27); every entry point calls `openWidgetSettings`, and this file
	// mounts the modal once.
	import WidgetSettingsModal from "./WidgetSettingsModal.svelte"

	/** The page's contract. The Start from pane's half is ./startFrom's. */
	interface Props extends StartFromProps {
		manager: SurfaceManager
		sessionId: number | null
		session?: unknown
		/**
		 * 🚧 What core's conversation widget is told about the session (C0b):
		 * its `session_full.v1`, granted to that one widget.
		 */
		conversationDossier?: ConversationDossierV1 | null
		/**
		 * 🚧 Who is looking (their user id) and what of the session annex
		 * they may see (R57) — what a Messages copy's `channelLaneFrom`
		 * resolves the viewer's lane from (./channelClaims `laneClaims`).
		 */
		viewerId?: number | null
		annex?: Record<string, Record<string, unknown>>
		/**
		 * This user's per-widget layout settings blob, round-tripped by the
		 * page. Read-only here; the Settings tab writes through
		 * `onLayoutSettings`, which is the page's existing
		 * `sessions:panelLayout:set` round trip.
		 */
		layoutSettings?: Record<string, unknown>
		onLayoutSettings?: (next: Record<string, unknown>) => void
		/**
		 * The session's action venues (`sessions:actions`), as the page holds
		 * them — the one source, threaded from here to EVERY widget mount
		 * below (the messages widget's own `WidgetHost`, every `Panel`, and
		 * the stage) so `actions.v1` is the same table whichever mount reads
		 * it. A prop rather than a Svelte context because the page already
		 * hands the other half of this pair — `onFrameAction` — as one, and
		 * one fact should not arrive by two mechanisms.
		 */
		actions?: ActionsV1
		/** The page's routing for a press — core's verbs and its own fire (W4). */
		actionDispatch?: ActionDispatch
		onFrameAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>,
			action?: string,
			blockId?: string
		) => void
	}

	let {
		manager,
		sessionId,
		session,
		conversationDossier = null,
		viewerId = null,
		annex = {},
		presets = [],
		startedFromLayoutPresetId = null,
		startedFromUpdated = false,
		onStartFrom,
		onSavePreset,
		onRenamePreset,
		onDeletePreset,
		onPresetUsage,
		presetUsage = null,
		onSaveChanges,
		onShareLayout,
		onCloneLayout,
		onSetNewSessionLayout,
		genreName = null,
		isGuest = false,
		isAdmin = false,
		layoutSettings = {},
		onLayoutSettings,
		actions,
		actionDispatch,
		onFrameAction
	}: Props = $props()

	/* ── shell awareness ────────────────────────────────────────────────────
	 * `leftPanel` / `rightPanel` are read for one thing only: a view opening or
	 * closing reflows `<main>`, so the offsets have to be taken again once the
	 * DOM settles (the effect further down). */
	const panelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")

	/* ── the editor's open state, and the arrangement it is working on ──── */
	let editing = $state(false)
	/**
	 * The editor's working arrangement, as it emits it — a `PanelLayoutV1`,
	 * what the live view draws while the editor is open (anything else draws
	 * the saved layout). Seeded with the saved panels as the editor opens, so
	 * the first frame already draws them.
	 */
	let working = $state.raw<unknown>(null)

	const model = createSessionLayoutModel({
		get manager() {
			return manager
		},
		get editing() {
			return editing
		},
		get working() {
			return working ?? null
		},
		get conversationDossier() {
			return conversationDossier
		},
		get viewerId() {
			return viewerId
		},
		get annex() {
			return annex
		},
		// 🚧 The viewer's own lane on each personal channel (the 100-turn walk, B2).
		get channels() {
			const list = (session as { channels?: unknown } | null | undefined)?.channels
			return Array.isArray(list) ? (list as SessionChannelV1[]) : null
		},
		get panelsCtx() {
			return panelsCtx
		},
		widgetLabel: (id) => flow.widgetLabel(id)
	})
	const flow = createWidgetSettingsFlow({
		get manager() {
			return manager
		},
		get model() {
			return model
		},
		get conversationDossier() {
			return conversationDossier
		},
		get layoutSettings() {
			return layoutSettings
		},
		get onLayoutSettings() {
			return onLayoutSettings
		}
	})

	/* ── persistence: the one writer of the editor's arrangement ──────────
	 * The editor EMITS the layout it commits; this writes its `panels`
	 * through the manager's existing round trip. ⏳ The old slots
	 * (`zoneLayout`, `widgetGrid`, `arrangedGrid`) are never written: a patch
	 * that carries only them is the old editor's, and changes nothing. */
	function persist(patch: SessionLayoutV1) {
		if (patch.panels) manager.setPanels(patch.panels)
	}

	let render: ReturnType<typeof SessionLayoutRender> | undefined = $state()
	let editor: ReturnType<typeof SessionLayoutEditor> | undefined = $state()
	/** Open the editor on the layout that is actually saved. */
	function openEditor() {
		working = model.savedPanels
		editing = true
	}
	function closeEditor() {
		editing = false
		working = null
	}
	// The header's Layout button asks; this is the only place that answers.
	// Seeded from the current count so a request made on a previous session
	// page does not fire here on mount. Pressed while editing, it is Done.
	let seenRequests = untrack(() => layoutEditor.requests)
	$effect(() => {
		const n = layoutEditor.requests
		if (n === seenRequests) return
		seenRequests = n
		untrack(() => (editing ? editor?.finishEditing() : openEditor()))
	})
	// What the shell reads: while the DESKTOP editor is up its toolbar owns the
	// header's band, so the session header and the Jump pill step out of it. A
	// narrow window keeps both — the row editor wears a bar of its own instead.
	$effect(() => {
		layoutEditor.open = editing && !model.isNarrow
	})

	/* ── the root's measured width and offsets ──────────────────────────────
	 * `containerW` is the session's own box (never the viewport), written into
	 * the model. `mLeft` / `mRight` / `mTop` are the root's distances from the
	 * viewport's edges, measured off its own rect and re-measured whenever the
	 * shell reflows around it. Two things position against them, both `fixed`
	 * and so unable to read the root's box themselves: a group's flyout, which
	 * flies out at the edge the column is already on (via `bLeft` / `bRight`,
	 * `.layout-body`'s edges), and the editor toolbar, which starts where
	 * `<main>` does on every tab but Move. */
	let rootEl: HTMLDivElement | null = $state(null)
	function updateMargins() {
		if (!rootEl) return
		const r = rootEl.getBoundingClientRect()
		model.vw = window.innerWidth
		model.mLeft = Math.max(0, Math.round(r.left))
		model.mRight = Math.max(0, Math.round(window.innerWidth - r.right))
		model.mTop = Math.max(0, Math.round(r.top))
		const b = model.bodyEl?.getBoundingClientRect() ?? r
		model.bLeft = Math.max(0, Math.round(b.left))
		model.bRight = Math.max(0, Math.round(window.innerWidth - b.right))
	}
	onMount(() => {
		if (!rootEl) return
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width
			if (w) {
				model.containerW = w
				manager.setWidth(w) // keep the manager's tier honest for panels
			}
			updateMargins()
		})
		ro.observe(rootEl)
		model.containerW = rootEl.clientWidth || model.containerW
		manager.setWidth(model.containerW)

		// Same matchMedia as the app's breakpoint, no second source.
		const mq = window.matchMedia("(min-width: 1024px)")
		model.isDesktop = mq.matches
		model.mounted = true
		const onMq = () => (model.isDesktop = mq.matches)
		mq.addEventListener("change", onMq)
		const onWin = () => updateMargins()
		window.addEventListener("resize", onWin)
		window.addEventListener("scroll", onWin, true)
		updateMargins()
		return () => {
			ro.disconnect()
			mq.removeEventListener("change", onMq)
			window.removeEventListener("resize", onWin)
			window.removeEventListener("scroll", onWin, true)
			// The header's panels button is app-wide state; leaving the session
			// has to retract it, or it would follow the user onto every other
			// page — the menu it opens with it.
			mobileSidePanels.setSides(false, 0, 0)
			mobileSidePanels.setGroups([])
			mobileSidePanels.menuOpen = false
			// Same reason: leaving the session while editing has to give the
			// shell its session header and Jump pill back.
			layoutEditor.open = false
		}
	})
	// A sidebar opening/closing reflows main → the measured offsets change;
	// recompute after the DOM settles. (rootEl's ResizeObserver also catches
	// most of it.)
	$effect(() => {
		void panelsCtx?.leftPanel
		void panelsCtx?.rightPanel
		requestAnimationFrame(updateMargins)
	})
	// Opening or closing the editor unmounts the header, which MOVES the root's
	// top without resizing it — a pure offset change the ResizeObserver never
	// sees. Re-measure once the DOM has settled.
	$effect(() => {
		void editing
		requestAnimationFrame(updateMargins)
	})
</script>

<!-- The toolbar is taken out of flow (it owns the window's top band), so the
     room it needs is reserved here: the live view under the Presets/Settings
     tabs, and the simulator's stage, start below it. The live session is
     written ONCE (./SessionLayoutRender) and the editor is drawn over it —
     never the other arm of an `{#if}`, which would reload every panel. -->
<div
	bind:this={rootEl}
	class="session-layout"
	class:editing
	data-stage-only={model.stageOnly ? "" : undefined}
	style:padding-block-start="{model.editorTop}px"
>
	{#if editing}
		<SessionLayoutEditor
			bind:this={editor}
			{model}
			{flow}
			{manager}
			{sessionId}
			{presets}
			{startedFromLayoutPresetId}
			{startedFromUpdated}
			{onStartFrom}
			{onSavePreset}
			{onRenamePreset}
			{onDeletePreset}
			{onPresetUsage}
			{presetUsage}
			{onSaveChanges}
			{onShareLayout}
			{onCloneLayout}
			{onSetNewSessionLayout}
			{genreName}
			{isGuest}
			{isAdmin}
			onWorking={(next: unknown) => (working = next)}
			onLayout={persist}
			onPutAway={(zoneId) => render?.putAway(zoneId)}
			onClose={closeEditor}
		/>
	{/if}
	<SessionLayoutRender
		bind:this={render}
		{model}
		{flow}
		{manager}
		{sessionId}
		{session}
		{actions}
		{actionDispatch}
		{onFrameAction}
	/>
</div>

<!-- Portalled to the body: no widget box, zone or flyout can clip it. -->
<WidgetSettingsModal />

<style>
	.session-layout {
		position: relative;
		display: flex;
		flex-direction: column;
		block-size: 100%;
		inline-size: 100%;
		min-block-size: 0;
	}
	/* Stage only (the model's `stageOnly`): marked, never unmounted — the mount
	   stays and an iframe under it keeps running. `!important` because a side's
	   slot and a flyout set their own `display` by class. */
	.session-layout :global([data-stage-hidden]) {
		display: none !important;
	}
</style>
