<script lang="ts">
	/**
	 * One PANEL, drawn in the live session (PLAN-session-panels-2026-10-14
	 * §1.3; PLAN 2026-11-05): its tabs, each a widget — and its backing. The
	 * root IS the card: the layout's look reaches it as `--sp-widget-margin /
	 * -background / -radius / -border` (./panelBacking `widgetBoxStyle`, the
	 * shown widget's style on top) in `boxStyle`, and `data-backing` marks a
	 * glass one. There is no pin and no gear: every panel is always open, and a
	 * widget's settings are the layout settings' (R4).
	 *
	 * - **Two or more tabs** draw a tab strip: a `role="tablist"` with roving
	 *   focus (Left/Right, Home, End move the selection and the focus; only
	 *   the selected tab is in the tab order). Choosing a tab calls
	 *   `onSelect`, which writes the panel's `open` to the session's layout
	 *   at once — "which tab you have open" is saved.
	 * - **One tab** draws NO strip and no controls: the widget alone.
	 *
	 * Every tab stays MOUNTED; the inactive ones are hidden (`.wtab-hidden`,
	 * the no-reload law), so a frame keeps its state across a switch.
	 *
	 * The widget itself is the caller's snippet (`pane`), so every widget
	 * mount stays in the renderer.
	 */
	import type { Snippet } from "svelte"
	import type { DrawnInstance, DrawnPanel } from "@serene-pub/sdk"

	interface Props {
		panel: DrawnPanel
		/** A tab's name on screen. */
		label: (id: string) => string
		/** A tab chosen. */
		onSelect: (tab: string) => void
		/** One tab's widget; `multi` is whether the panel draws a strip. */
		pane: Snippet<[DrawnInstance, boolean]>
		/**
		 * 🚧 The tabs with news, by instance id (PLAN-dc-after-walk2 Q3-3,
		 * ./tabAttention): a hidden tab here carries a dot, and its name says
		 * "new lines" to a screen reader.
		 */
		dots?: ReadonlySet<string>
		/** The panel's backing and its box variables, as the render computed them. */
		backing?: "card" | "glass" | "none"
		boxStyle?: string
	}

	let {
		panel,
		label,
		onSelect,
		pane,
		dots,
		backing = "none",
		boxStyle
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
</script>

<div class="ptabs" class:multi data-backing={backing} style={boxStyle}>
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
	</div>
</div>

<style>
	/* The panel's backing: four variables the host sets inline from the
	   layout's look (a widget's style may override them), with the no-backing
	   values as the fallback. A custom widget style can zero any of them. */
	.ptabs {
		block-size: 100%;
		min-block-size: 0;
		min-inline-size: 0;
		display: flex;
		flex-direction: column;
		margin: var(--sp-widget-margin, 0);
		background: var(--sp-widget-background, transparent);
		border-radius: var(--sp-widget-radius, 0);
		border: var(--sp-widget-border, none);
		overflow: hidden;
		box-sizing: border-box;
	}
	/* Glass is the theme's tokens (STYLE-GUIDE §2.8). */
	.ptabs[data-backing="glass"] {
		backdrop-filter: blur(var(--sp-glass-blur));
		box-shadow: 0 0 30px var(--sp-glass-glow) inset;
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
		cursor: pointer;
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
	.ptabs-body {
		/* The containing block for each pane's widget overlay (WidgetHost's
		   wrapper has no box of its own). */
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
</style>
