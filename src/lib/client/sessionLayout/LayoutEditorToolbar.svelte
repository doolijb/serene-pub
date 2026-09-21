<script lang="ts">
	/**
	 * The layout editor's DESKTOP toolbar (tabbed: Presets · Settings · Move),
	 * split out of SessionLayout.
	 *
	 * It survives a previewed phone width — the tier buttons and the grid escape
	 * live in it — so a real narrow window is the only thing that has no toolbar
	 * at all; there the sticky bar at the foot of MobileLayoutEditor is it. The
	 * `{#if editing && !isNarrow}` that decides all of that stays in
	 * SessionLayout, and so does everything the toolbar only ASKS for: the
	 * presets themselves, the palette, the simulator's state. What lives here is
	 * the pane's own UI state — which tab, and the one-at-a-time rename and
	 * delete of a layout you saved.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	// The Move tab's screen-size simulator: the width presets the picker offers.
	import { SIM_OPTIONS, type SimTier } from "./simulator"

	interface Props {
		/** Which pane is showing. Bound: SessionLayout derives `placing` from it. */
		editTab: "presets" | "settings" | "move"
		/**
		 * Where the band starts. The toolbar is taken out of flow, so it cannot
		 * read the session root's box itself: SessionLayout passes 0 while the
		 * Move tab's scrim is covering the nav rail, and the root's measured
		 * offset otherwise — see `.editor`'s rule.
		 */
		insetStart: number
		/**
		 * The band's measured height, bound back out: SessionLayout reserves
		 * exactly that much room above the live view and the simulator's stage.
		 */
		height: number
		/** The layouts this user may pick, and the one in force. */
		presets: Sockets.Sessions.LayoutPreset[]
		activePreset: Sockets.Sessions.LayoutPreset | null
		applyPreset: (presetId: number) => void
		/**
		 * The name box for "save this arrangement as a preset". Bound because
		 * SessionLayout's Done reads it — `finishEditing` calls `savePreset`.
		 */
		presetName: string
		savePreset: () => void
		resetLayout: () => void
		/**
		 * Managing a preset you saved. Only ever asked for a card this user
		 * authored; the page owns the round trips and pushes the refreshed list
		 * back down through `presets`.
		 */
		onRenamePreset?: (presetId: number, name: string) => void
		onDeletePreset?: (presetId: number) => void
		onPresetUsage?: (presetId: number) => void
		/** The answer to the last `onPresetUsage` ask, or null while in flight. */
		presetUsage?: { id: number; sessions: number } | null
		/** A preset's picture — SessionLayout's snippet, drawn by both editors. */
		presetPicture: Snippet<[unknown]>
		/** Every widget on screen; the Settings tab only counts them. */
		styleableWidgets: { id: string; label: string }[]
		/** The Move tab's tray: everything not yet placed. */
		paletteWidgets: PanelInstance[]
		iconOf: (p: PanelInstance) => any
		/** Tap-to-place: the palette chip currently armed. */
		armedId: string | null
		/** The zone currently under a drag (highlight); the tray is `__palette__`. */
		dragOverZone: string | null
		onChipDragStart: (e: DragEvent, id: string) => void
		draggedId: (e: DragEvent) => string | null
		/** The tray's own drop: a card dragged back out of the layout. */
		removeWidget: (widgetId: string) => void
		/** The screen-size simulator, and the two lenses beside it. */
		simTier: SimTier | null
		setSimTier: (tier: SimTier | null) => void
		railPreview: boolean
		simGrid: boolean
		simNarrow: boolean
		/** The two commit controls, SessionLayout's own. */
		onCancel: () => void
		onDone: () => void
	}

	let {
		editTab = $bindable(),
		insetStart,
		height = $bindable(),
		presets,
		activePreset,
		applyPreset,
		presetName = $bindable(),
		savePreset,
		resetLayout,
		onRenamePreset,
		onDeletePreset,
		onPresetUsage,
		presetUsage = null,
		presetPicture,
		styleableWidgets,
		paletteWidgets,
		iconOf,
		armedId = $bindable(),
		dragOverZone = $bindable(),
		onChipDragStart,
		draggedId,
		removeWidget,
		simTier,
		setSimTier,
		railPreview = $bindable(),
		simGrid = $bindable(),
		simNarrow,
		onCancel,
		onDone
	}: Props = $props()

	/* ── managing a layout you saved ────────────────────────────────────
	 * Rename and delete are offered on your OWN cards only; the shipped default
	 * gets no actions. Both are one-at-a-time by construction — a single id of
	 * state each — so the row can never show two open editors or two pending
	 * confirmations, and starting one closes the other. */
	/** The card whose name is being edited inline, if any. */
	let renamingId = $state<number | null>(null)
	let renameValue = $state("")
	let renameField = $state<HTMLInputElement | null>(null)
	/** The card a delete has been asked for, awaiting its "how many?" answer. */
	let deleteAskId = $state<number | null>(null)
	/** That card, or null once it is gone from the pushed list (deleted). */
	let deletingPreset = $derived(
		presets.find((p) => p.id === deleteAskId) ?? null
	)
	/** Its session count, or null while the answer is still in flight. */
	let deleteUsage = $derived(
		presetUsage && presetUsage.id === deleteAskId
			? presetUsage.sessions
			: null
	)

	function startRename(p: Sockets.Sessions.LayoutPreset) {
		deleteAskId = null
		renamingId = p.id
		renameValue = p.name
	}
	/**
	 * Commit the inline rename. Enter and blur both land here, and so does the
	 * blur that Escape causes by unmounting the field — which is why the first
	 * line checks the field is still open for THIS card: by then `cancelRename`
	 * has already cleared it, so the cancel wins the race with its own blur.
	 *
	 * An unchanged or blank name is dropped rather than sent: the server refuses
	 * a blank one anyway, and a refusal toast for pressing Enter on a name you
	 * did not edit would be noise.
	 */
	function commitRename(id: number) {
		if (renamingId !== id) return
		const name = renameValue.trim()
		const was = presets.find((p) => p.id === id)?.name
		renamingId = null
		if (!name || name === was) return
		onRenamePreset?.(id, name)
	}
	function cancelRename() {
		renamingId = null
	}
	// The field only exists while a rename is open, so focus it as it appears
	// and select what is there — the common edit is replacing the name, not
	// appending to it.
	$effect(() => {
		if (renamingId != null && renameField) {
			renameField.focus()
			renameField.select()
		}
	})

	/**
	 * Step one of the delete: ask how many sessions are on it. The confirmation
	 * cannot be answered until that count lands, which is the whole point — the
	 * FK drops every session using this preset back to the genre default, and
	 * that is worth knowing before, not after.
	 */
	function askDelete(p: Sockets.Sessions.LayoutPreset) {
		renamingId = null
		deleteAskId = p.id
		onPresetUsage?.(p.id)
	}
	/** Step two. The refreshed list arrives on the reply and redraws the row. */
	function confirmDelete(id: number) {
		deleteAskId = null
		onDeletePreset?.(id)
	}
	function cancelDelete() {
		deleteAskId = null
	}
</script>

<!-- The layout editor: a tabbed toolbar over the chat. Presets picks a
     saved layout (and saves the current one); Style picks the message
     packs (live preview); Move places and arranges widgets in the
     zones. -->
<!-- The band stops at the session's own left edge unless the Move tab's
     scrim is covering the nav rail — see `.editor`'s rule. `insetStart` is
     the root's measured offset from the window, and since the one-rail
     shell that offset IS the rail. -->
<div
	class="editor"
	data-pop-keep
	bind:clientHeight={height}
	style:inset-inline-start="{insetStart}px"
>
	<div class="editor-tabs" role="tablist" aria-label="Layout editor">
		<span class="editor-title">
			<Icons.LayoutDashboard size={14} />
			Layout
		</span>
		<div class="editor-tablist">
			<button
				class="editor-tab"
				class:active={editTab === "presets"}
				role="tab"
				aria-selected={editTab === "presets"}
				onclick={() => (editTab = "presets")}
			>
				<Icons.LayoutTemplate size={16} />
				Presets
			</button>
			<button
				class="editor-tab"
				class:active={editTab === "settings"}
				role="tab"
				aria-selected={editTab === "settings"}
				onclick={() => (editTab = "settings")}
			>
				<Icons.SlidersHorizontal size={16} />
				Settings
			</button>
			<button
				class="editor-tab"
				class:active={editTab === "move"}
				role="tab"
				aria-selected={editTab === "move"}
				onclick={() => (editTab = "move")}
			>
				<Icons.Move size={16} />
				Move
			</button>
		</div>
		<span class="flex-1"></span>
		<button
			class="tool-btn"
			onclick={onCancel}
			title="Leave the editor and put back the layout you opened it on"
		>
			<Icons.X size={14} />
			<span>Cancel</span>
		</button>
		<button class="tool-btn primary" onclick={onDone}>
			<Icons.Check size={14} />
			<span>Done</span>
		</button>
	</div>

	<div class="editor-panel">
		{#if editTab === "presets"}
			<div class="presets-row" role="group" aria-label="Layouts">
				{#each presets as p (p.id)}
					<div class="preset-item">
						<button
							class="preset-card"
							class:active={activePreset?.id === p.id}
							aria-pressed={activePreset?.id === p.id}
							onclick={() => applyPreset(p.id)}
							title={p.isDefault
								? "The layout this genre ships with"
								: `Apply "${p.name}"`}
						>
							{@render presetPicture(p.layout)}
							<span class="preset-name">
								{#if p.isDefault}
									<Icons.RotateCcw size={11} />
								{/if}
								{p.name}
							</span>
						</button>
						<!-- Only the layouts THIS user saved can be
						     renamed or deleted, so the shipped default
						     is simply offered nothing — a button that
						     only ever explains why it refuses is worse
						     than no button. -->
						{#if !p.isDefault}
							{#if renamingId === p.id}
								<input
									class="preset-input preset-rename"
									type="text"
									bind:this={renameField}
									bind:value={renameValue}
									maxlength="80"
									aria-label={`New name for "${p.name}"`}
									onkeydown={(e) => {
										if (e.key === "Enter")
											commitRename(p.id)
										else if (e.key === "Escape")
											cancelRename()
									}}
									onblur={() => commitRename(p.id)}
								/>
							{:else}
								<div class="preset-actions">
									<button
										class="preset-action"
										onclick={() => startRename(p)}
										title={`Rename "${p.name}"`}
										aria-label={`Rename "${p.name}"`}
									>
										<Icons.Pencil size={12} />
									</button>
									<button
										class="preset-action"
										class:armed={deleteAskId === p.id}
										onclick={() => askDelete(p)}
										title={`Delete "${p.name}"`}
										aria-label={`Delete "${p.name}"`}
									>
										<Icons.Trash2 size={12} />
									</button>
								</div>
							{/if}
						{/if}
					</div>
				{:else}
					<span class="advanced-note">
						No saved layouts for this session type yet.
					</span>
				{/each}
			</div>
			<!-- The delete confirmation. One at a time, and its own row
			     rather than something crammed into a 6.5rem card: it has
			     a sentence to say, and what it says is what deleting
			     actually does to other sessions. -->
			{#if deletingPreset}
				{@const dp = deletingPreset}
				<div class="presets-row preset-confirm" role="alert">
					<span class="preset-confirm-text">
						{#if deleteUsage === null}
							Checking where “{dp.name}” is used…
						{:else if deleteUsage > 0}
							“{dp.name}” is used by {deleteUsage}
							session{deleteUsage === 1 ? "" : "s"}, which
							will go back to the default layout. Delete
							it?
						{:else}
							Delete “{dp.name}”?
						{/if}
					</span>
					<button
						class="tool-btn preset-danger"
						onclick={() => confirmDelete(dp.id)}
						disabled={deleteUsage === null}
						title={deleteUsage === null
							? "Still counting the sessions on this layout"
							: `Delete "${dp.name}"`}
					>
						<Icons.Trash2 size={14} />
						<span>Delete</span>
					</button>
					<button class="tool-btn" onclick={cancelDelete}>
						<Icons.X size={14} />
						<span>Cancel</span>
					</button>
				</div>
			{/if}
			<div class="presets-row">
				<label class="preset-save">
					<span class="sr-only">Name this layout</span>
					<input
						class="preset-input"
						type="text"
						bind:value={presetName}
						placeholder="Name this layout…"
						maxlength="80"
						onkeydown={(e) => {
							if (e.key === "Enter") savePreset()
						}}
					/>
				</label>
				<button
					class="tool-btn"
					onclick={savePreset}
					disabled={!presetName.trim()}
					title="Save the current arrangement as a new layout"
				>
					<Icons.Save size={14} />
					<span>Save preset</span>
				</button>
				<button
					class="tool-btn"
					onclick={resetLayout}
					title="Drop your own changes and show the selected layout"
				>
					<Icons.RotateCcw size={14} />
					<span>Reset to default</span>
				</button>
				<span class="advanced-note">
					Saving also happens on Done while a name is typed.
				</span>
			</div>
		{:else if editTab === "settings"}
			<!-- One line, because the controls are on the widgets: every
			     widget on screen wears its own settings overlay while
			     this tab is open, with Style as one of its sections. -->
			<p class="pack-hint">
				{#if styleableWidgets.length}
					Hover a widget to change its settings.
				{:else}
					Put a widget in the layout on the Move tab, then
					hover it to change its settings.
				{/if}
			</p>
		{:else if editTab === "move"}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="palette"
				class:drag-over={dragOverZone === "__palette__"}
				ondragover={(e) => {
					e.preventDefault()
					dragOverZone = "__palette__"
					if (e.dataTransfer)
						e.dataTransfer.dropEffect = "move"
				}}
				ondragleave={() => (dragOverZone = null)}
				ondrop={(e) => {
					e.preventDefault()
					dragOverZone = null
					const id = draggedId(e)
					if (id) removeWidget(id)
				}}
			>
				<span class="palette-label">
					<Icons.Plus size={13} />
					Add
				</span>
				<div class="palette-tray">
					{#each paletteWidgets as p (p.id)}
						{@const IconCmp = iconOf(p)}
						<button
							class="widget-card"
							class:armed={armedId === p.id}
							draggable="true"
							ondragstart={(e) =>
								onChipDragStart(e, p.id)}
							onclick={() =>
								(armedId =
									armedId === p.id ? null : p.id)}
							title={armedId === p.id
								? "Tap a zone to place"
								: "Drag to a zone, or tap to arm"}
						>
							<IconCmp size={18} />
							<span class="widget-card-label">
								{p.title}
							</span>
						</button>
					{:else}
						<span class="palette-empty">
							All widgets are placed.
						</span>
					{/each}
				</div>
				{#if armedId}
					<span class="palette-hint">tap a zone to place</span>
				{/if}
				<span class="flex-1"></span>
				<span class="palette-tip">
					Drag onto a zone · drop here to remove
				</span>
			</div>
			<!-- The screen-size simulator (P5, ruled 2026-08-30): a LENS
			     on the one arrangement, never a second one. Picking a
			     tier redraws the three editor zones at that width, so
			     their column counts — and therefore how this same
			     `arrangedGrid` clamps into them — are the device's.
			     Nothing here is persisted; Done and leaving the tab drop
			     back to Actual — and a preview you only LOOKED at is
			     undone with it (see `exitSimulation`), so previewing a
			     phone can never clamp away a desktop arrangement.

			     The last preset, Ultrawide, is the one that is not a
			     container tier: it previews the width where the side
			     rails branch to 2-column in `DEFAULT_SIDE_RULES`, which
			     nothing else here could show. -->
			<div class="move-sim">
				<span class="move-sim-label">
					<Icons.MonitorSmartphone size={13} />
					Screen
				</span>
				<div
					class="move-sim-seg"
					role="group"
					aria-label="Preview width"
				>
					<button
						class="move-sim-btn"
						class:active={simTier === null}
						aria-pressed={simTier === null}
						title="Preview at this window's real width"
						onclick={() => setSimTier(null)}
					>
						Actual
					</button>
					{#each SIM_OPTIONS as o (o.tier)}
						<button
							class="move-sim-btn"
							class:active={simTier === o.tier}
							aria-pressed={simTier === o.tier}
							title={o.hint}
							onclick={() =>
								setSimTier(
									simTier === o.tier ? null : o.tier
								)}
						>
							{o.label}
							<span class="move-sim-px">{o.width}</span>
						</button>
					{/each}
				</div>
				<!-- The rail model (ruled 2026-09-10), on the SAME
				     arrangement: each group in a side column is its own
				     toggling panel, so this draws the sides the way a
				     session draws them — docked, or an icon in the rail,
				     or opened over the chat when the column has no room.
				     A lens like the width presets, and nothing it does is
				     persisted: pin and open live for the page. -->
				<button
					class="move-sim-btn move-sim-rails"
					class:active={railPreview}
					aria-pressed={railPreview}
					title="Draw the side columns as rails — toggle a group, pin one, and watch what does not fit fly out"
					onclick={() => (railPreview = !railPreview)}
				>
					<Icons.PanelLeftClose size={12} />
					Rails
				</button>
				<!-- The MOBILE-EDIT mode (ruled 2026-09-10): a previewed
				     width below the breakpoint draws the row editor that
				     width really gets, so it can be checked without a
				     phone. This is the way back to the grid, and it is
				     offered only here — a real narrow window has no zones
				     to drag in. -->
				{#if simNarrow}
					<button
						class="move-sim-btn move-sim-rails"
						class:active={simGrid}
						aria-pressed={simGrid}
						title="Draw the grid at this width instead of the row editor a screen this narrow gets"
						onclick={() => (simGrid = !simGrid)}
					>
						<Icons.Grid2x2 size={12} />
						Grid
					</button>
				{/if}
			</div>
			<!-- Says out loud what the guard enforces: looking at a tier
			     changes nothing, but ARRANGING at one is an edit to the
			     single layout, not to that tier. (Sibling of .move-sim so
			     the panel's flex-wrap gives it its own line when tight;
			     reuses the editor's existing hint style.) -->
			{#if simTier !== null}
				<span class="palette-hint">
					Changes you make here apply to the layout at every
					size.
				</span>
			{/if}
			{#if railPreview}
				<span class="palette-hint">
					Click a rail icon to open or close a group; the pin
					keeps one open at its own height. Alt+[ expands
					every group that fits, Alt+] sends them all to the
					rail.
				</span>
			{/if}
		{/if}
	</div>
</div>


<style>
	/* ── Layout editor toolbar (tabbed: Presets · Settings · Move) ─────
	   While the editor is open this bar OWNS the header's band: the shell takes
	   the session header and the Jump pill out of it for the duration (see
	   layoutEditor.svelte.ts), so the bar wears the header's own ground and
	   rules off from the page the way the header did — no card, no radius, no
	   margin.

	   On MOVE it spans the whole VIEWPORT, nav rail included, because the
	   editor's three columns are laid out across the viewport rather than
	   across `<main>` — the scrim already covers the rail, and a toolbar
	   stopping short of the columns it commands would read as a second thing.

	   On PRESETS and SETTINGS there is no canvas and no scrim: those tabs are a
	   LIVE preview of the session, and the session starts to the right of the
	   nav rail. A full-bleed band there painted over the rail's first icon, so
	   its start edge is the root's own (`mLeft`, an inline style — the rail can
	   change width). */
	.editor {
		position: fixed;
		inset-block-start: 0;
		inset-inline-end: 0;
		z-index: 25;
		background: var(--color-surface-100);
		border-block-end: 1px solid
			color-mix(in oklab, var(--color-surface-300) 60%, transparent);
		box-shadow: 0 6px 20px -12px rgba(0, 0, 0, 0.4);
		overflow: hidden;
		/* The start edge moves when the tab does (viewport on Move, the root's
		   own edge on the others). Deliberately NOT transitioned: a tab switch
		   also swaps the canvas for the live session (or back), and in Chromium
		   a slide on this property played out only after that mount had
		   settled (the bar sat at its old edge for ~300ms, then jumped), which
		   reads as lag rather than motion. */
	}
	:global([data-mode="dark"]) .editor {
		background: var(--color-surface-900);
		border-block-end-color: color-mix(
			in oklab,
			var(--color-surface-700) 60%,
			transparent
		);
	}
	/* 56px and a 1rem gutter each side: the band this replaces is the header's
	   (STYLE-GUIDE §4.2), so it keeps the header's measure. */
	.editor-tabs {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-block-size: 56px;
		padding-inline: 1rem 1rem;
		border-block-end: 1px solid
			color-mix(in oklab, var(--color-surface-300) 45%, transparent);
	}
	:global([data-mode="dark"]) .editor-tabs {
		border-block-end-color: color-mix(
			in oklab,
			var(--color-surface-700) 45%,
			transparent
		);
	}
	.editor-title {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .editor-title {
		color: var(--color-surface-200);
	}
	/* No pill row (STYLE-GUIDE §6.5): these are PanelTabStrip's tabs — 40px,
	   16px icon and 13px label, the selected one underlined in primary — so a
	   person moving between a panel's tabs and these sees one idiom. Not the
	   component itself: that one owns a tablist and a roving tabindex for a
	   model this toolbar does not have. */
	.editor-tablist {
		display: flex;
		margin-inline-start: 0.4rem;
	}
	.editor-tab {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		block-size: 40px;
		padding-inline: 0.75rem;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-surface-600);
		transition:
			box-shadow 120ms ease,
			color 120ms ease;
	}
	:global([data-mode="dark"]) .editor-tab {
		color: var(--color-surface-400);
	}
	.editor-tab:hover,
	.editor-tab.active {
		color: var(--color-surface-950);
	}
	:global([data-mode="dark"]) .editor-tab:hover,
	:global([data-mode="dark"]) .editor-tab.active {
		color: var(--color-surface-50);
	}
	.editor-tab.active {
		box-shadow: inset 0 -2px 0 var(--color-primary-500);
	}
	/* Same 1rem gutter as the tabs row above, so the palette and the Screen
	   picker start on the Layout title's line rather than 6px inside it. */
	.editor-panel {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.9rem;
		padding-block: 0.5rem;
		padding-inline: 1rem;
	}
	/* Style tab: the whole panel is one line pointing at the widgets themselves,
	   which is where the controls are. The segmented pack pickers that used to
	   sit above it went with the packs (ruled 2026-08-30). */
	.pack-hint {
		inline-size: 100%;
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-surface-500);
	}
	/* Widgets tip + Advanced note + row. */
	.palette-tip,
	.advanced-note {
		font-size: 12px;
		color: var(--color-surface-500);
	}
	.presets-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	/* ── preset cards + their pictures ──────────────────────────────── */
	/* The card and its manage row are one column: the card stays the apply
	   control it always was (a button, which is why the actions cannot live
	   inside it), and rename/delete sit underneath. */
	.preset-item {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.2rem;
		/* The row centres its children, and the built-in card is shorter than a
		   card carrying a manage row — top-align so every picture still lines
		   up with every other. */
		align-self: flex-start;
	}
	.preset-actions {
		display: flex;
		justify-content: center;
		gap: 0.15rem;
	}
	.preset-action {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem 0.3rem;
		border-radius: 0.35rem;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .preset-action {
		color: var(--color-surface-400);
	}
	.preset-action:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 20%,
			transparent
		);
	}
	/* The card whose confirmation is open below, so the sentence and the bin it
	   came from are visibly the same thing. */
	.preset-action.armed {
		background: color-mix(in oklab, var(--color-error-500) 20%, transparent);
		color: var(--color-error-700, var(--color-error-500));
	}
	/* Both classes on purpose: `.preset-input`'s own width is declared further
	   down this sheet, so matching its specificity would lose on source order. */
	.preset-input.preset-rename {
		width: 6.5rem;
	}
	.preset-confirm {
		padding: 0.3rem 0.45rem;
		border-radius: 0.5rem;
		background: color-mix(in oklab, var(--color-error-500) 10%, transparent);
	}
	.preset-confirm-text {
		flex: 1 1 12rem;
		font-size: 13px;
		line-height: 1.4;
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .preset-confirm-text {
		color: var(--color-surface-200);
	}
	/* `.tool-btn:hover` is declared later in this sheet and would otherwise
	   repaint the destructive button in the primary tint on hover, so the hover
	   state is claimed here rather than left to source order. */
	.tool-btn.preset-danger,
	.tool-btn.preset-danger:hover {
		background: var(--color-error-500);
		color: var(--color-error-contrast-500, white);
	}
	.tool-btn.preset-danger:hover:not(:disabled) {
		background: var(--color-error-600, var(--color-error-500));
	}
	.preset-card {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
		padding: 0.3rem;
		border-radius: 0.5rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: color-mix(
			in oklab,
			var(--color-surface-200) 60%,
			transparent
		);
	}
	.preset-card:hover {
		border-color: var(--color-primary-500);
	}
	.preset-card.active {
		border-color: var(--color-primary-500);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 16%,
			transparent
		);
	}
	.preset-name {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-surface-700);
		max-width: 6.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global([data-mode="dark"]) .preset-name {
		color: var(--color-surface-200);
	}

	/* The "name this layout" box. */
	.preset-save {
		display: flex;
	}
	.preset-input {
		padding: 0.28rem 0.5rem;
		border-radius: 0.5rem;
		font-size: 14px;
		width: 10rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: color-mix(
			in oklab,
			var(--color-surface-100) 80%,
			transparent
		);
		color: var(--color-surface-800);
	}
	:global([data-mode="dark"]) .preset-input {
		background: color-mix(
			in oklab,
			var(--color-surface-800) 70%,
			transparent
		);
		color: var(--color-surface-100);
	}
	.tool-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.tool-btn {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.6rem;
		border-radius: 0.5rem;
		font-size: 14px;
		font-weight: 500;
		background: color-mix(
			in oklab,
			var(--color-surface-200) 80%,
			transparent
		);
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .tool-btn {
		background: color-mix(
			in oklab,
			var(--color-surface-800) 80%,
			transparent
		);
		color: var(--color-surface-300);
	}
	.tool-btn:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 20%,
			transparent
		);
	}
	.tool-btn.primary {
		background: var(--color-primary-500);
		color: var(--color-primary-contrast-500, white);
	}

	.palette {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		flex: 1 1 auto;
		padding: 0.35rem 0.45rem;
		border-radius: 0.5rem;
		border: 1px dashed
			color-mix(in oklab, var(--color-primary-500) 40%, transparent);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 5%,
			transparent
		);
	}
	.palette-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 12px;
		font-weight: 400;
		color: var(--color-surface-500);
	}
	.palette.drag-over {
		border-style: solid;
		background: color-mix(
			in oklab,
			var(--color-error-500) 10%,
			transparent
		);
	}
	.palette-tray {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		gap: 0.4rem;
		flex: 1 1 auto;
	}
	/* Toggleable widgets read as square cards, not pills. */
	.widget-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		inline-size: 5.2rem;
		min-block-size: 4rem;
		padding: 0.45rem 0.35rem;
		border-radius: 0.6rem;
		font-size: 13px;
		font-weight: 500;
		text-align: center;
		cursor: grab;
		color: var(--color-surface-700);
		background: var(--color-surface-100);
		border: 1px solid
			color-mix(in oklab, var(--color-surface-300) 70%, transparent);
		transition:
			border-color 120ms ease,
			background 120ms ease,
			transform 120ms ease;
	}
	.widget-card:hover {
		transform: translateY(-1px);
		border-color: color-mix(
			in oklab,
			var(--color-primary-500) 45%,
			transparent
		);
	}
	.widget-card-label {
		inline-size: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		line-height: 1.15;
	}
	:global([data-mode="dark"]) .widget-card {
		color: var(--color-surface-200);
		background: var(--color-surface-900);
		border-color: color-mix(
			in oklab,
			var(--color-surface-700) 70%,
			transparent
		);
	}
	.widget-card.armed {
		border-color: var(--color-primary-500);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 18%,
			transparent
		);
	}
	.palette-empty,
	.palette-hint {
		font-size: 12px;
		color: var(--color-surface-500);
	}
	.palette-hint {
		color: var(--color-primary-600);
		font-weight: 500;
	}

	/* ── Move tab: the screen-size simulator's width picker ──────────────── */
	.move-sim {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex: 0 0 auto;
	}
	.move-sim-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 12px;
		font-weight: 400;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .move-sim-label {
		color: var(--color-surface-300);
	}
	/* Wraps rather than clips: `overflow: hidden` is here for the rounded
	   corners, and with six presets (Actual + five widths) a narrow editor
	   toolbar would otherwise hide the widest one — the one preset you cannot
	   reach any other way. */
	.move-sim-seg {
		display: flex;
		flex-wrap: wrap;
		border-radius: 0.45rem;
		overflow: hidden;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
	}
	.move-sim-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.55rem;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-surface-600);
		background: transparent;
		border: 0;
		border-inline-start: 1px solid
			color-mix(in oklab, var(--color-surface-400) 30%, transparent);
		cursor: pointer;
		white-space: nowrap;
	}
	.move-sim-btn:first-child {
		border-inline-start: 0;
	}
	.move-sim-btn:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 10%,
			transparent
		);
	}
	.move-sim-btn.active {
		color: var(--color-surface-50);
		background: var(--color-primary-500);
	}
	.move-sim-px {
		font-size: 12px;
		font-weight: 400;
		opacity: 0.75;
		font-variant-numeric: tabular-nums;
	}
	:global([data-mode="dark"]) .move-sim-btn {
		color: var(--color-surface-300);
	}
	:global([data-mode="dark"]) .move-sim-btn.active {
		color: var(--color-surface-50);
	}
	/* The Rails toggle sits beside the width presets and is a lens like them,
	   so it wears the same button — with its icon on the leading edge. */
	.move-sim-rails {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-inline-start: 0.35rem;
	}
</style>
