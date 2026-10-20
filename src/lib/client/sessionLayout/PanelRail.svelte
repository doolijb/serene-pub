<script lang="ts">
	/**
	 * A side column's slim rail (the side rail model's (a), ruled 2026-09-10):
	 * one icon per PANEL (PLAN-session-panels-2026-10-14), at the column's
	 * OUTER edge — its first tab's icon, with a small count when it holds more
	 * than one tab. This is the ONLY thing more enabled widgets adds — an icon,
	 * never more chrome. `data-pop-keep` so clicking the rail that opened a
	 * flyout is not "outside" it.
	 *
	 * Tucked (./tuckedSides, or a rail-only side), an icon opens a flyout — a
	 * dialog, which it says with `aria-expanded`; docked, it toggles a panel in
	 * the column. ONE tab stop, arrow keys move within it (./sideRail
	 * `rovingStep`).
	 */
	import type { DrawnPanel } from "@serene-pub/sdk"
	import { rovingStep, rovingStop, type ColumnLayout } from "./sideRail"
	import type { SideRailModel } from "./sideRailModel.svelte"

	interface Props {
		side: "left" | "right"
		panels: readonly DrawnPanel[]
		col: ColumnLayout
		/** Mark the docked panels — a list to choose from (the editor's preview). */
		markPinned?: boolean
		rail: SideRailModel
		/** The side is tucked: an icon brings its panel out as a flyout. */
		tucked?: boolean
		/** Is this panel the tucked flyout that is out? */
		tuckedOpen?: (key: string) => boolean
		/** A rail icon pressed while tucked. */
		onToggleTucked?: (key: string, trigger: HTMLElement) => void
	}

	let {
		side,
		panels,
		col,
		markPinned = false,
		rail,
		tucked = false,
		tuckedOpen = () => false,
		onToggleTucked
	}: Props = $props()

	/** Which icon holds the rail's one tab stop (./sideRail `rovingStep`). */
	let stop = $state<number | undefined>(undefined)
	function onKeydown(e: KeyboardEvent) {
		const bar = (e.currentTarget as HTMLElement).closest("[data-rail]")
		if (!bar) return
		const btns = [
			...bar.querySelectorAll<HTMLButtonElement>(":scope > button")
		]
		const at = btns.indexOf(e.currentTarget as HTMLButtonElement)
		const next = rovingStep(e.key, at < 0 ? 0 : at, btns.length)
		if (next == null) return
		e.preventDefault()
		stop = next
		btns[next]?.focus()
	}
</script>

<div
	class="side-rail"
	data-pop-keep
	data-rail
	role="toolbar"
	aria-orientation="vertical"
	aria-label="{side === 'left' ? 'Left' : 'Right'} panels"
>
	{#each panels as p, i (p.key)}
		{@const st = col.state[p.key] ?? "collapsed"}
		{@const Icon = rail.groupIcon(p)}
		{@const title = rail.groupTitle(p)}
		<button
			class="icon-btn rail-btn"
			tabindex={i === rovingStop(stop, panels.length) ? 0 : -1}
			onkeydown={onKeydown}
			onfocus={() => (stop = i)}
			class:active={st !== "collapsed"}
			class:pinned={markPinned && rail.groupPinned(p)}
			{title}
			aria-label={title}
			aria-pressed={tucked ? undefined : st !== "collapsed"}
			aria-expanded={tucked ? tuckedOpen(p.key) : undefined}
			aria-haspopup={tucked ? "dialog" : undefined}
			aria-controls={tucked && tuckedOpen(p.key)
				? `tucked-${side}-${p.key}`
				: undefined}
			onclick={(e) =>
				tucked
					? onToggleTucked?.(p.key, e.currentTarget)
					: rail.toggleGroup(side, p)}
		>
			<Icon size={16} />
			{#if p.tabs.length > 1}
				<!-- How many tabs the panel holds: its icon is only the first's. -->
				<span class="rail-count" aria-hidden="true">{p.tabs.length}</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.side-rail {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		inline-size: 2.25rem;
		padding-block: 0.375rem;
	}
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.75rem;
		block-size: 1.75rem;
		border-radius: 0.5rem;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .icon-btn {
		color: var(--color-surface-400);
	}
	.icon-btn:hover,
	.icon-btn.active {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 15%,
			transparent
		);
		color: var(--color-primary-600);
	}
	.rail-btn {
		position: relative;
	}
	/* The tab count: small, in the corner, never covering the icon. */
	.rail-count {
		position: absolute;
		inset-block-end: -0.1rem;
		inset-inline-end: -0.15rem;
		min-inline-size: 0.8rem;
		block-size: 0.8rem;
		padding-inline: 0.15rem;
		border-radius: 0.4rem;
		font-size: 0.55rem;
		font-weight: 700;
		line-height: 0.8rem;
		text-align: center;
		color: var(--color-surface-50);
		background: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .rail-count {
		color: var(--color-surface-950);
		background: var(--color-surface-400);
	}
	/* Docked, where that is worth saying: a list of panels to choose between. */
	.rail-btn.pinned::after {
		content: "";
		position: absolute;
		inset-block-start: 0.15rem;
		inset-inline-end: 0.15rem;
		inline-size: 0.3rem;
		block-size: 0.3rem;
		border-radius: 50%;
		background: var(--color-primary-500);
	}
</style>
