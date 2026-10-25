<script lang="ts">
	/**
	 * One PANEL, drawn in the live session (PLAN-session-panels-2026-10-14
	 * §1.3): its tabs, each a widget, and the two controls a person has over
	 * the panel from the session itself — its pin (a side panel: docked, or in
	 * the rail) and the gear that opens the ACTIVE tab's settings.
	 *
	 * - **Two or more tabs** draw a tab strip: a `role="tablist"` with roving
	 *   focus (Left/Right, Home, End move the selection and the focus; only
	 *   the selected tab is in the tab order), the pin and the gear after it.
	 *   Choosing a tab calls `onSelect`, which writes the panel's `open` to
	 *   the session's layout at once — "which tab you have open" is saved.
	 * - **One tab** draws NO strip (owner, Q3): the widget's own chrome, with
	 *   the pin and the gear in a hover overlay at its corner, shown on hover
	 *   or while focus is inside it.
	 *
	 * Every tab stays MOUNTED; the inactive ones are hidden (`.wtab-hidden`,
	 * the no-reload law), so a frame keeps its state across a switch.
	 *
	 * The widget itself is the caller's snippet (`pane`), so every widget
	 * mount stays in the renderer.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { DrawnInstance, DrawnPanel } from "@serene-pub/sdk"

	interface Props {
		panel: DrawnPanel
		/** A tab's name on screen. */
		label: (id: string) => string
		/** A side panel: it can be docked or moved to the rail. Strips never pin. */
		pinnable?: boolean
		/** Draw the pin and the gear (not while the layout editor is open). */
		controls?: boolean
		/** A tab chosen. */
		onSelect: (tab: string) => void
		/** The pin pressed: `true` docks the panel, `false` moves it to the rail. */
		onPin?: (pinned: boolean) => void
		/** The gear pressed, for the active tab. */
		onSettings?: (tab: string, trigger: HTMLElement) => void
		/** One tab's widget; `multi` is whether the panel draws a strip. */
		pane: Snippet<[DrawnInstance, boolean]>
		/**
		 * 🚧 The tabs with news, by instance id (PLAN-dc-after-walk2 Q3-3,
		 * ./tabAttention): a hidden tab here carries a dot, and its name says
		 * "new lines" to a screen reader.
		 */
		dots?: ReadonlySet<string>
	}

	let {
		panel,
		label,
		pinnable = false,
		controls = true,
		onSelect,
		onPin,
		onSettings,
		pane,
		dots
	}: Props = $props()

	const uid = $props.id()
	let multi = $derived(panel.tabs.length > 1)
	let active = $derived(
		panel.tabs.some((t) => t.instanceId === panel.open)
			? panel.open
			: (panel.tabs[0]?.instanceId ?? "")
	)
	let tabRefs: HTMLButtonElement[] = $state([])
	const tabId = (i: number) => `${uid}-tab-${i}`
	const paneId = (i: number) => `${uid}-pane-${i}`

	function select(i: number, focus: boolean) {
		const t = panel.tabs[i]
		if (!t) return
		if (t.instanceId !== active) onSelect(t.instanceId)
		if (focus) tabRefs[i]?.focus()
	}
	function onKeydown(e: KeyboardEvent, i: number) {
		const n = panel.tabs.length
		let next: number
		if (e.key === "ArrowRight") next = (i + 1) % n
		else if (e.key === "ArrowLeft") next = (i - 1 + n) % n
		else if (e.key === "Home") next = 0
		else if (e.key === "End") next = n - 1
		else return
		e.preventDefault()
		select(next, true)
	}
	/** The pin's name says what pressing it does. */
	let pinLabel = $derived(panel.pinned ? "Move to the rail" : "Dock")
	let activeLabel = $derived(label(active))
</script>

{#snippet panelControls()}
	{#if pinnable && onPin}
		<button
			type="button"
			class="ptab-btn"
			aria-label={pinLabel}
			title={pinLabel}
			aria-pressed={panel.pinned}
			onclick={() => onPin?.(!panel.pinned)}
		>
			{#if panel.pinned}
				<Icons.Pin size={13} aria-hidden="true" />
			{:else}
				<Icons.PinOff size={13} aria-hidden="true" />
			{/if}
		</button>
	{/if}
	{#if onSettings}
		<button
			type="button"
			class="ptab-btn"
			aria-haspopup="dialog"
			aria-label="{activeLabel} settings"
			title="{activeLabel} settings"
			onclick={(e) => onSettings?.(active, e.currentTarget)}
		>
			<Icons.Settings size={13} aria-hidden="true" />
		</button>
	{/if}
{/snippet}

<div class="ptabs" class:multi data-panel-key={panel.key}>
	{#if multi}
		<div class="ptabs-head">
			<div
				class="ptabs-bar"
				role="tablist"
				aria-label={panel.title ?? panel.tabs.map((t) => label(t.instanceId)).join(" · ")}
			>
				{#each panel.tabs as t, i (t.instanceId)}
					{@const selected = t.instanceId === active}
					<button
						type="button"
						class="wtab"
						class:active={selected}
						role="tab"
						id={tabId(i)}
						aria-selected={selected}
						aria-controls={paneId(i)}
						tabindex={selected ? 0 : -1}
						bind:this={tabRefs[i]}
						onclick={() => select(i, false)}
						onkeydown={(e) => onKeydown(e, i)}
					>
						{label(t.instanceId)}
						{#if !selected && dots?.has(t.instanceId)}
							<span class="wtab-dot" aria-hidden="true"></span>
							<span class="sr-only">(new lines)</span>
						{/if}
					</button>
				{/each}
			</div>
			{#if controls}
				<div class="ptabs-tools">
					{@render panelControls()}
				</div>
			{/if}
		</div>
	{/if}
	<div class="ptabs-body">
		{#each panel.tabs as t, i (t.instanceId)}
			<div
				class="wtab-pane"
				class:wtab-hidden={t.instanceId !== active}
				id={multi ? paneId(i) : undefined}
				role={multi ? "tabpanel" : undefined}
				aria-labelledby={multi ? tabId(i) : undefined}
			>
				{@render pane(t, multi)}
			</div>
		{/each}
		{#if !multi && controls && (pinnable || onSettings)}
			<!-- A one-tab panel's controls: no strip, a corner overlay on
			     hover or focus, over the widget's own chrome. -->
			<div class="ptabs-hover" role="group" aria-label="{activeLabel} panel">
				{@render panelControls()}
			</div>
		{/if}
	</div>
</div>

<style>
	.ptabs {
		block-size: 100%;
		min-block-size: 0;
		min-inline-size: 0;
		display: flex;
		flex-direction: column;
	}
	/* The strip: the app's tab idiom (STYLE-GUIDE §6.5) at a panel's size —
	   a 1px rule under the row, the selected tab underlined in primary. Not
	   equal widths: a side panel is narrow, so the row scrolls instead. */
	.ptabs-head {
		flex: none;
		display: flex;
		align-items: stretch;
		gap: 0.25rem;
		border-block-end: 1px solid var(--color-surface-200-800);
	}
	.ptabs-bar {
		flex: 1;
		min-inline-size: 0;
		display: flex;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.wtab {
		flex: none;
		block-size: 2rem;
		padding-inline: 0.6rem;
		font-size: 0.75rem;
		font-weight: 600;
		white-space: nowrap;
		color: var(--color-surface-600-400);
		border-block-end: 2px solid transparent;
		margin-block-end: -1px;
	}
	.wtab:hover {
		color: var(--color-surface-800-200);
	}
	/* 🚧 News on a hidden tab (Q3-3): a small dot after its name. */
	.wtab-dot {
		display: inline-block;
		inline-size: 0.4rem;
		block-size: 0.4rem;
		margin-inline-start: 0.3rem;
		border-radius: 9999px;
		background: var(--color-primary-500);
		vertical-align: middle;
	}
	.wtab.active {
		color: var(--color-primary-500);
		border-block-end-color: var(--color-primary-500);
	}
	.ptabs-tools {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}
	.ptab-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.5rem;
		block-size: 1.5rem;
		border-radius: 0.4rem;
		color: var(--color-surface-600-400);
	}
	.ptab-btn:hover,
	.ptab-btn:focus-visible {
		background: color-mix(in oklab, var(--color-primary-500) 15%, transparent);
		color: var(--color-primary-600);
	}
	.ptabs-body {
		/* The containing block for the hover overlay and for each pane's
		   widget overlay (WidgetHost's wrapper has no box of its own). */
		position: relative;
		flex: 1;
		min-block-size: 0;
		min-inline-size: 0;
		display: flex;
	}
	.wtab-pane {
		/* And again per pane: without it a widget overlay anchors past the
		   strip and covers every tab as if they were one widget. */
		position: relative;
		flex: 1;
		min-block-size: 0;
		min-inline-size: 0;
		display: flex;
		flex-direction: column;
	}
	.wtab-pane.wtab-hidden {
		display: none;
	}
	.wtab-pane > :global(*) {
		flex: 1;
		min-block-size: 0;
	}
	/* One tab: the controls wait in the corner until the panel is pointed at
	   or focus is inside it — never covering the widget otherwise. */
	.ptabs-hover {
		position: absolute;
		inset-block-start: 0.25rem;
		inset-inline-end: 0.25rem;
		z-index: 5;
		display: flex;
		gap: 0.125rem;
		padding: 0.125rem;
		border-radius: 0.5rem;
		background: var(--color-surface-50-950);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--transition-duration-fast) ease;
	}
	.ptabs:hover .ptabs-hover,
	.ptabs-hover:focus-within {
		opacity: 1;
		pointer-events: auto;
	}
	@media (hover: none) {
		/* No hover on touch: a one-tab panel's controls live in the panels
		   menu and the editor instead of a corner nobody can reveal. */
		.ptabs-hover {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ptabs-hover {
			transition: none;
		}
	}
</style>
