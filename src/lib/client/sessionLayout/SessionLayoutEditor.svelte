<script lang="ts">
	/**
	 * The session LAYOUT EDITOR (PLAN-session-panels-2026-10-14, lane 3): the
	 * desktop toolbar (Layouts · Arrange), the Arrange tab's canvas and its
	 * screen-size simulator, the phone's row editor, Start from / Save as, and
	 * Done / Cancel / Undo.
	 *
	 * Mounted by the composition root only while the editor is open, so every
	 * piece of state here is this edit's and goes when it closes. It holds ONE
	 * working copy — `editPanels`, a `PanelLayoutV1` snapshot taken on open —
	 * and every edit is one of ./arrangeOps' pure ops, which answers a new
	 * value (or the same one for a no-op, or a refusal to say). The working
	 * panels are EMITTED as they change (`onWorking`, the live preview under
	 * the Layouts tab); **Done** writes them (`onLayout({ panels })`) only
	 * when they differ from the snapshot (`samePanels`), so an untouched
	 * layout is never rewritten. Cancel writes nothing. An op's refusal is
	 * said on the Arrange tab's status line (`notice`), never a toast; there
	 * is no lock and no floor on Done (§10 R-B).
	 *
	 * The header's Layout button is the one way in (./layoutEditor); while the
	 * desktop editor is open the shell hands its top band to the toolbar.
	 */
	import { untrack } from "svelte"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import { samePanels, placedIds as placedOf, type ArrangeOutcome } from "./arrangeOps"
	import type { SimTier } from "./simulator"
	import { dropWidgetStylePins } from "$lib/client/stores/widgetStyles.svelte"
	import { dropWidgetSettings } from "$lib/client/stores/widgetSettings.svelte"
	import { CORE_WIDGETS } from "$lib/shared/widgets/types"
	import { type PanelLayoutV1, type SessionLayoutV1, widgetOfInstance } from "@serene-pub/sdk"
	import { closeWidgetSettings, openWidgetSettings } from "./widgetSettingsModal.svelte"
	import MobileLayoutEditor from "./MobileLayoutEditor.svelte"
	import LayoutEditorToolbar from "./LayoutEditorToolbar.svelte"
	import ArrangeCanvas from "./ArrangeCanvas.svelte"
	import PresetPicture from "./PresetPicture.svelte"
	import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"
	import type { WidgetSettingsFlow } from "./widgetSettingsFlow.svelte"
	import { createEditorMembership } from "./editorMembership.svelte"
	import type { StartFromProps } from "./startFrom"

	/** The starting points and their verbs are the page's (./startFrom). */
	interface Props extends StartFromProps {
		model: SessionLayoutModel
		flow: WidgetSettingsFlow
		manager: SurfaceManager
		sessionId: number | null
		/** The working panels, emitted on every change (the live preview). */
		onWorking: (panels: PanelLayoutV1) => void
		/** What Done writes; the composition root persists it. */
		onLayout: (patch: SessionLayoutV1) => void
		/** Ask the live view to put its flyouts away. */
		onPutAway: (zoneId?: string) => void
		/** The editor is done (Done or Cancel): the root closes it. */
		onClose: () => void
	}

	let {
		model,
		flow,
		manager,
		sessionId,
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
		onWorking,
		onLayout,
		onPutAway,
		onClose
	}: Props = $props()

	const widgetLabel = (id: string) => flow.widgetLabel(id)

	/* ── the working copy ─────────────────────────────────────────────────
	 * `opened` is the layout as the editor opened on it (and again after a
	 * copy lands or a save): what Done compares against. `editPanels` is the
	 * edit in progress; `previous` the one step Undo takes back. */
	const snapshot = (): PanelLayoutV1 =>
		$state.snapshot(model.savedPanels) as PanelLayoutV1
	let opened = $state.raw<PanelLayoutV1>(untrack(snapshot))
	let editPanels = $state.raw<PanelLayoutV1>(untrack(() => opened))
	let previous = $state.raw<PanelLayoutV1 | null>(null)
	/** The last refusal, said on the status line until the next kept edit. */
	let notice = $state<string | null>(null)
	$effect(() => onWorking(editPanels))

	/**
	 * Keep an op's answer, or say its refusal. `merge` folds a run of edits
	 * (a divider drag) into one Undo step. Answers whether it was kept.
	 */
	function edit(outcome: ArrangeOutcome, opts: { merge?: boolean } = {}): boolean {
		if (!outcome.layout) {
			notice = outcome.refused
			return false
		}
		if (outcome.layout === editPanels) return false
		notice = null
		if (!opts.merge) previous = editPanels
		editPanels = outcome.layout
		return true
	}
	function undo() {
		if (!previous) return
		editPanels = previous
		previous = null
		notice = null
	}

	/** The primary widget's own title — Start from scratch's question names it. */
	let primaryTitle = $derived(
		CORE_WIDGETS.find((w) => w.id === widgetOfInstance(model.primaryId))?.title ??
			model.inst(model.primaryId)?.title ??
			widgetLabel(model.primaryId)
	)

	// The phone has no tab strip: the row list is its one editor.
	$effect(() => {
		if (model.mobileEdit) model.editTab = "arrange"
	})

	/* ── adding, duplicating, removing (./editorMembership) ────────────── */
	const membership = createEditorMembership({
		get model() {
			return model
		},
		get manager() {
			return manager
		},
		get sessionId() {
			return sessionId
		},
		get panels() {
			return editPanels
		},
		edit: (outcome) => edit(outcome)
	})

	/** A tab's gear: the widget settings flow, the one modal. */
	function openSettings(id: string, trigger: HTMLElement) {
		openWidgetSettings({ widgetId: id, label: widgetLabel(id) }, trigger)
	}

	/* ── seeding ────────────────────────────────────────────────────────── */
	/** Start the edit again from the layout as it is saved now. */
	function seedEditor() {
		const fresh = snapshot()
		opened = fresh
		editPanels = fresh
		previous = null
		notice = null
		membership.takeDuplicated()
	}
	/**
	 * How many copies this editor asked for (Start from, Start again, Reset,
	 * Start from scratch) whose answers have not re-seeded the manager yet.
	 * Only a copy it asked for re-seeds the open editor: a re-seed from
	 * anywhere else never throws away an edit in progress.
	 */
	let copiesPending = 0
	let seenSeeds = untrack(() => manager.seedCount)
	$effect(() => {
		const n = manager.seedCount
		if (n === seenSeeds) return
		seenSeeds = n
		untrack(() => {
			if (copiesPending === 0) return
			copiesPending--
			seedEditor()
			onPutAway()
			membership.armedId = null
		})
	})

	/* ── the simulator ──────────────────────────────────────────────────
	 * A lens, never an edit: panels have no cells to clamp, so a previewed
	 * width changes nothing about the layout. It belongs to the Arrange tab:
	 * leaving the tab drops back to Actual. */
	function setSimTier(tier: SimTier | null) {
		model.simTier = tier
	}
	$effect(() => {
		if (model.placing) return
		untrack(() => (model.simTier = null))
	})

	/* ── Done, Cancel ───────────────────────────────────────────────────── */
	/**
	 * Write the working panels — only when they differ from what the editor
	 * opened on (the byte-identical Done rule, plan §6). An instance taken
	 * out is closed and one put in is opened, so the live view's "active but
	 * unplaced" extras never bring a removed widget back. Nothing refuses
	 * it (§10 R-B: a layout without a conversation draws what is left).
	 */
	function commit(): boolean {
		const now = editPanels
		if (samePanels(opened, now)) return true
		const before = new Set(placedOf(opened))
		const after = new Set(placedOf(now))
		for (const id of before) if (!after.has(id)) manager.close(id)
		for (const id of after) if (!before.has(id)) manager.activate(id)
		onLayout({ panels: now })
		return true
	}
	/** Leave the editor, keeping the edit (Done, and the header's Layout button). */
	export function finishEditing() {
		if (!commit()) return
		closeEditor()
	}
	/** Leave the editor, keeping nothing; this edit's Duplicates' values go too. */
	function cancelEditing() {
		const duplicated = membership.takeDuplicated()
		if (duplicated.length) {
			dropWidgetSettings(duplicated)
			dropWidgetStylePins(duplicated)
		}
		closeEditor()
	}
	function closeEditor() {
		membership.takeDuplicated()
		copiesPending = 0
		membership.armedId = null
		model.simTier = null
		closeWidgetSettings()
		onClose()
	}

	/* ── starting points (the copy model) ───────────────────────────────
	 * Every verb here REPLACES this session's layout with a copy; the page
	 * owns the round trips, and the copy's answer re-seeds the manager, which
	 * the open editor follows. Both editors ask before they call `startFrom`
	 * or `resetLayout`, so nothing here asks again. */
	let startedFrom = $derived(
		presets.find((p) => p.id === startedFromLayoutPresetId) ?? null
	)
	let genreDefaultPreset = $derived(
		presets.find((p) => p.isGenreDefault) ?? null
	)
	let startAgainFrom = $derived(
		startedFrom && !startedFrom.isGenreDefault ? startedFrom : null
	)
	/** Copy a preset in (`null`: Start from scratch). */
	async function startFrom(layoutPresetId: number | null) {
		if (!onStartFrom) return
		copiesPending++
		const asked = onStartFrom(layoutPresetId)
		onPutAway()
		membership.armedId = null
		if (!(await asked) && copiesPending > 0) copiesPending--
	}
	/** **Reset to genre default layout** (or scratch, where the genre ships none). */
	function resetLayout() {
		startFrom(genreDefaultPreset?.id ?? null)
	}
	/**
	 * **Save as new layout**: commit what is arranged (as Done would), then
	 * save it as a new named layout. The editor stays open, re-seeded.
	 */
	function savePreset(name: string, description = ""): boolean {
		const n = name.trim()
		if (!n) return false
		if (!commit()) return false
		onSavePreset?.(n, placedOf(editPanels), description.trim() || undefined)
		seedEditor()
		return true
	}
	/** **Save changes to "*Name*"**: commit, then write it back into that layout. */
	function saveChanges(presetId: number, overwriteUpdated: boolean): boolean {
		if (!commit()) return false
		onSaveChanges?.(presetId, placedOf(editPanels), overwriteUpdated)
		seedEditor()
		return true
	}
</script>

<!-- A preset's PICTURE (./PresetPicture), handed to both editors' cards. -->
{#snippet presetPicture(preset: unknown)}
	<PresetPicture {preset} {widgetLabel} />
{/snippet}

<!-- The Arrange tab's canvas — drawn at the real width or inside the
     simulator's frame. -->
{#snippet canvas()}
	<ArrangeCanvas
		panels={editPanels}
		{edit}
		{membership}
		editGeom={model.editGeom}
		rail={model.rail}
		label={widgetLabel}
		{openSettings}
	/>
{/snippet}

<!-- The phone's row editor (lane 4, ./MobileLayoutEditor): it edits the
     same working panels, bound; Done here is this editor's Done. -->
{#snippet phoneEditor()}
	<MobileLayoutEditor
		bind:editPanels
		openedPanels={opened}
		storedIds={membership.storedIds}
		onMinted={membership.adopt}
		simTier={model.simTier}
		simWidth={model.simWidth}
		inst={model.inst}
		iconOf={model.iconOf}
		middleWidgetIcon={model.middleWidgetIcon}
		{widgetLabel}
		trayWidgets={membership.trayWidgets}
		trayIcon={membership.trayIcon}
		{presets}
		{startedFrom}
		{startedFromUpdated}
		{startAgainFrom}
		{startFrom}
		{savePreset}
		{resetLayout}
		mainWidgetTitle={primaryTitle}
		{onRenamePreset}
		{onDeletePreset}
		{onPresetUsage}
		{presetUsage}
		{saveChanges}
		{genreName}
		{isGuest}
		{isAdmin}
		{onShareLayout}
		{onCloneLayout}
		{onSetNewSessionLayout}
		onCancel={cancelEditing}
		onDone={finishEditing}
		{presetPicture}
	/>
{/snippet}

<!-- The toolbar is the DESKTOP's, and it survives a previewed phone width:
     the tier buttons live in it. A real narrow window has no toolbar at all —
     the sticky bar at the foot of the row editor is it. -->
{#if !model.isNarrow}
	<LayoutEditorToolbar
		bind:editTab={model.editTab}
		insetStart={model.placing ? 0 : model.mLeft}
		bind:height={model.toolbarH}
		{presets}
		{startedFrom}
		{startedFromUpdated}
		{startAgainFrom}
		{startFrom}
		{savePreset}
		{resetLayout}
		mainWidgetTitle={primaryTitle}
		{onRenamePreset}
		{onDeletePreset}
		{onPresetUsage}
		{presetUsage}
		{presetPicture}
		{saveChanges}
		{genreName}
		{isGuest}
		{isAdmin}
		{onShareLayout}
		{onCloneLayout}
		{onSetNewSessionLayout}
		trayWidgets={membership.trayWidgets}
		trayIcon={membership.trayIcon}
		bind:armedId={membership.armedId}
		bind:dragOverZone={membership.dragOverZone}
		onTrayDragStart={membership.onTrayDragStart}
		draggedId={membership.draggedId}
		removeWidget={membership.removeWidget}
		simTier={model.simTier}
		{setSimTier}
		{notice}
		onUndo={undo}
		canUndo={!!previous}
		onCancel={cancelEditing}
		onDone={finishEditing}
	/>
{/if}

<!-- A width below the breakpoint gets the ROW editor instead of the canvas.
     The live session stays mounted underneath either, so nothing reloads. -->
{#if model.placing && !model.mobileEdit}
	<div class="edit-scrim"></div>
	{#if model.simWidth != null}
		<!-- Simulated: the canvas drawn at the tier's width inside a centred,
		     labelled frame; `transform` (always set) is the scale. -->
		<div class="sim-stage">
			<div class="sim-label">
				Previewing at {model.simWidth} px{model.simPct < 100
					? ` · shown at ${model.simPct}%`
					: ""}
			</div>
			<div
				class="sim-frame"
				style="inline-size:{model.simWidth}px; max-block-size:{model.simHeight}px; transform:scale({model
					.editGeom.scale});"
			>
				{@render canvas()}
			</div>
		</div>
	{:else}
		<div class="edit-shell" style="inset-block-start:{model.toolbarH}px;">
			{@render canvas()}
		</div>
	{/if}
{:else if model.placing && model.simWidth != null}
	<!-- A phone width previewed from a desktop: the row editor in the same
	     frame, at that device's width and height. -->
	<div class="edit-scrim"></div>
	<div class="sim-stage">
		<div class="sim-label">
			Previewing at {model.simWidth} px{model.simPct < 100
				? ` · shown at ${model.simPct}%`
				: ""}
		</div>
		<div
			class="sim-frame"
			style="inline-size:{model.simWidth}px; max-block-size:{model.simHeight}px; transform:scale({model
				.editGeom.scale});"
		>
			{@render phoneEditor()}
		</div>
	</div>
{/if}

<!-- The row editor at the REAL width, over the live session. -->
{#if model.mobileEdit && model.simWidth == null}
	{@render phoneEditor()}
{/if}

<style>
	/* ── the Arrange canvas ─────────────────────────────────────────────── */
	/* Dim the live session so the canvas reads as a distinct mode.
	   Fixed layer under the zones (which are z-index 20). */
	.edit-scrim {
		position: fixed;
		inset: 0;
		z-index: 15;
		background: color-mix(
			in oklab,
			var(--color-surface-950) 62%,
			transparent
		);
		backdrop-filter: blur(2px);
	}
	/* Actual: the canvas fills the window below the toolbar, nav rail included
	   — the three columns are a split of the whole VIEWPORT (the scrim already
	   covers the rail), not of `<main>`. The toolbar's measured height is an
	   inline style, so this rule owns only the box. */
	.edit-shell {
		position: fixed;
		inset-inline: 0;
		inset-block-end: 0;
		z-index: 16;
		display: flex;
		flex-direction: column;
		min-block-size: 0;
	}

	/* ── the screen-size simulator's frame ─────────────────────────────────
	   The stage takes the editor body's slot (in flow, below the toolbar, so it
	   can never cover it) and centres one frame drawn at the simulated width.
	   `overflow: hidden` is the belt to the scale's braces: a frame can never
	   push the page sideways. */
	.sim-stage {
		position: relative;
		z-index: 16;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		min-block-size: 0;
		overflow: hidden;
	}
	/* The frame's label sits OUTSIDE the transform, so "shown at 60%" is not
	   itself rendered at 60%. */
	.sim-label {
		flex: none;
		margin-block-end: 0.3rem;
		padding: 0.12rem 0.5rem;
		border-radius: 0 0 0.45rem 0.45rem;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-surface-50);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 78%,
			transparent
		);
	}
	/* The simulated viewport. Its `transform` is always set (scale(1) included)
	   — the scale itself, and what keeps a tier wider than the window inside
	   it. The canvas it holds is a plain grid row now, so nothing depends on
	   this box being a containing block; the mobile row editor's fixed sheets
	   still do, which is the other reason it is never unset. */
	.sim-frame {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-block-size: 0;
		transform-origin: top center;
		border: 1.5px solid
			color-mix(in oklab, var(--color-primary-500) 55%, transparent);
		border-radius: 0.5rem;
		background: color-mix(
			in oklab,
			var(--color-surface-950) 22%,
			transparent
		);
	}
</style>
