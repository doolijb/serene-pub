<script lang="ts">
	/**
	 * A side column's slim rail (the side rail model's (a), ruled 2026-09-10):
	 * one icon per group, at the column's OUTER edge. This is the ONLY thing
	 * more enabled widgets adds — an icon, never more chrome. Drawn by the live
	 * side (./SideMount) and by the Move tab's rail preview (LayoutEditCanvas,
	 * through the editor), so the two cannot drift. `data-pop-keep` so clicking
	 * the rail that opened a flyout is not "outside" it.
	 *
	 * Tucked (./tuckedSides), an icon opens a flyout — a dialog, which it says
	 * with `aria-expanded`; docked, it toggles a group in the column.
	 */
	import { rovingStep, rovingStop, type ColumnLayout } from "./sideRail"
	import type { RenderUnit } from "./tabGroups"
	import type { SideRailModel } from "./sideRailModel.svelte"

	interface Props {
		side: "left" | "right"
		units: RenderUnit[]
		col: ColumnLayout
		/** Mark the pinned groups — the preview and the sheet, lists to choose from. */
		markPinned: boolean
		rail: SideRailModel
		/** The side is tucked: an icon brings its group out as a flyout. */
		tucked?: boolean
		/** Is this group the tucked flyout that is out? */
		tuckedOpen?: (key: string) => boolean
		/** A rail icon pressed while tucked. */
		onToggleTucked?: (key: string, trigger: HTMLElement) => void
	}

	let {
		side,
		units,
		col,
		markPinned,
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
	{#each units as u, i (u.key)}
		{@const st = col.state[u.key] ?? "collapsed"}
		{@const Icon = rail.groupIcon(u)}
		{@const title = rail.groupTitle(u)}
		<button
			class="icon-btn rail-btn"
			tabindex={i === rovingStop(stop, units.length) ? 0 : -1}
			onkeydown={onKeydown}
			onfocus={() => (stop = i)}
			class:active={st !== "collapsed"}
			class:pinned={markPinned && rail.groupPinned(u)}
			{title}
			aria-label={title}
			aria-pressed={tucked ? undefined : st !== "collapsed"}
			aria-expanded={tucked ? tuckedOpen(u.key) : undefined}
			aria-haspopup={tucked ? "dialog" : undefined}
			aria-controls={tucked && tuckedOpen(u.key)
				? `tucked-${side}-${u.key}`
				: undefined}
			onclick={(e) =>
				tucked
					? onToggleTucked?.(u.key, e.currentTarget)
					: rail.toggleGroup(side, u)}
		>
			<Icon size={16} />
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
	/* The icon button's face — the same one ./SideMount's icon strip wears. */
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
	/* Pinned, where that is worth saying: the preview and the mobile sheet,
	   both of which are lists of groups you are choosing between. */
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
