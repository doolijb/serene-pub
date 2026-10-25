<script lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * The everyday navigator (22 §2.5): the pipeline's configurable steps as a
	 * compact list, sectioned by the agent (settings group) each belongs to —
	 * the same headings the Pipelines view draws. The map is the "see the
	 * whole pipeline" view; this is the one for going straight to a step you
	 * already know. No step is numbered (owner rulings 2026-09-30).
	 */
	import * as Icons from "@lucide/svelte"
	import type { BuilderStep } from "$lib/client/components/pipelines/settingsGroups"

	interface Props {
		steps: BuilderStep[]
		activeKey: string | null
		/** The agent picked instead of a step, by group key. */
		activeGroup?: string | null
		/** Unsaved-draft count for a step — the amber dot. */
		pendingFor: (stepKey: string) => number
		onSelect: (stepKey: string) => void
		/** Given, an agent's heading is a button that picks the agent. */
		onSelectGroup?: (groupKey: string) => void
	}

	let {
		steps,
		activeKey,
		activeGroup = null,
		pendingFor,
		onSelect,
		onSelectGroup
	}: Props = $props()

	const countsFor = (step: BuilderStep) => ({
		total: step.options.length,
		overridden: step.options.filter((o) => o.overriddenHere).length
	})

	/** The steps under their agent's heading, in order; `agent` absent for the one unheaded group. */
	const sections = $derived.by(() => {
		const out: { group: string; agent?: string; steps: BuilderStep[] }[] = []
		for (const step of steps) {
			const last = out.at(-1)
			if (last && last.group === step.group) last.steps.push(step)
			else out.push({ group: step.group, agent: step.agent, steps: [step] })
		}
		return out
	})

	function onKey(event: KeyboardEvent) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
		event.preventDefault()
		const i = steps.findIndex((s) => s.key === activeKey)
		const next = event.key === "ArrowDown" ? i + 1 : i - 1
		if (next >= 0 && next < steps.length) onSelect(steps[next].key)
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<div
	role="tablist"
	aria-label="Pipeline steps"
	tabindex="-1"
	onkeydown={onKey}
	class="flex flex-col gap-1.5 p-2"
>
	{#each sections as section, i (i)}
		{#if section.agent && onSelectGroup}
			<button
				type="button"
				class="mt-1 rounded-base px-1 pt-1 pb-0.5 text-left text-xs font-medium
					{section.group === activeGroup
					? 'sidebar-row-active'
					: 'text-surface-600-400 hover:text-surface-950-50'}"
				aria-current={section.group === activeGroup ? "step" : undefined}
				onclick={() => onSelectGroup(section.group)}
			>
				{section.agent}
			</button>
		{:else if section.agent}
			<p class="text-surface-600-400 px-1 pt-2 text-xs font-medium">
				{section.agent}
			</p>
		{/if}
		{#each section.steps as step (step.key)}
			{@const counts = countsFor(step)}
			{@const isActive = step.key === activeKey}
			{@const pend = pendingFor(step.key)}
			<button
				type="button"
				class="group flex w-full items-center gap-3 rounded-base p-3 text-left transition-colors
					{isActive
					? 'sidebar-row-active'
					: 'bg-surface-50-950 hover:bg-surface-200-800'}"
				aria-current={isActive ? "step" : undefined}
				onclick={() => onSelect(step.key)}
			>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-sm font-medium">
						{step.heading}
					</span>
					<span class="text-surface-600-400 block truncate text-xs">
						{counts.total}
						{counts.total === 1 ? "setting" : "settings"}
					</span>
				</span>
				{#if pend}
					<span
						class="bg-warning-500 size-2 shrink-0 rounded-full"
						title="{pend} unsaved change{pend === 1 ? '' : 's'} on this step"
					></span>
				{/if}
				{#if counts.overridden}
					<Badge tone="primary" size="sm" class="font-semibold" title="{counts.overridden} set here, not inherited">
						{counts.overridden}
					</Badge>
				{/if}
			</button>
		{/each}
	{/each}
	{#if !steps.length}
		<p class="text-surface-600-400 p-3 text-sm">
			<Icons.Info size={14} class="mr-1 inline" />
			This pipeline declares nothing to configure.
		</p>
	{/if}
</div>
