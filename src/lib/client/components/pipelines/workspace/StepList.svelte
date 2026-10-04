<script lang="ts">
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
		/** Unsaved-draft count for a step — the amber dot. */
		pendingFor: (stepKey: string) => number
		onSelect: (stepKey: string) => void
	}

	let { steps, activeKey, pendingFor, onSelect }: Props = $props()

	const countsFor = (step: BuilderStep) => ({
		total: step.options.length,
		overridden: step.options.filter((o) => o.overriddenHere).length
	})

	/** The steps under their agent's heading, in order; `agent` absent for the one unheaded group. */
	const sections = $derived.by(() => {
		const out: { agent?: string; steps: BuilderStep[] }[] = []
		for (const step of steps) {
			const last = out.at(-1)
			if (last && last.agent === step.agent) last.steps.push(step)
			else out.push({ agent: step.agent, steps: [step] })
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
		{#if section.agent}
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
				class="group flex w-full items-center gap-3 rounded-[10px] p-3 text-left transition-colors
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
					<span
						class="preset-tonal-primary rounded-full px-2 py-0.5 text-[11px] font-semibold"
						title="{counts.overridden} set here, not inherited"
					>
						{counts.overridden}
					</span>
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
