<script lang="ts">
	/**
	 * The everyday navigator (22 §2.5): the pipeline's configurable steps as a
	 * compact list. The map is the "see the whole pipeline" view; this is the
	 * one for going straight to a step you already know.
	 */
	import * as Icons from "@lucide/svelte"

	interface Props {
		steps: Sockets.Pipelines.Step[]
		activeKey: string | null
		/** Unsaved-draft count for a step — the amber dot. */
		pendingFor: (stepKey: string) => number
		onSelect: (stepKey: string) => void
	}

	let { steps, activeKey, pendingFor, onSelect }: Props = $props()

	const countsFor = (step: Sockets.Pipelines.Step) => {
		const all = [...step.options, ...step.advanced]
		return {
			total: all.length,
			overridden: all.filter((o) => o.overriddenHere).length
		}
	}

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
	{#each steps as step, index (step.key)}
		{@const counts = countsFor(step)}
		{@const isActive = step.key === activeKey}
		{@const pend = pendingFor(step.key)}
		<button
			type="button"
			class="group card flex w-full items-center gap-3 p-3 text-left transition-all
				{isActive
				? 'preset-filled-primary-500 shadow-lg'
				: 'preset-tonal hover:preset-tonal-primary'}"
			aria-current={isActive ? "step" : undefined}
			onclick={() => onSelect(step.key)}
		>
			<span
				class="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold
					{isActive ? 'preset-filled-surface-50-950' : 'preset-tonal-surface'}"
				aria-hidden="true"
			>
				{index + 1}
			</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-sm font-medium">
					{step.label}
				</span>
				<span class="flex items-center gap-1.5 text-xs opacity-70">
					{#if step.kind}
						<!-- What the step *is*: "Assemble" and "Generate text"
						     read alike until you know one costs a model call. -->
						<span class="truncate font-mono">{step.kind}</span>
						<span aria-hidden="true">·</span>
					{/if}
					<span class="truncate">
						{counts.total}
						{counts.total === 1 ? "setting" : "settings"}
					</span>
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
					class="preset-filled-secondary-500 rounded-full px-2 py-0.5 text-[10px] font-semibold"
					title="{counts.overridden} set here, not inherited"
				>
					{counts.overridden}
				</span>
			{/if}
		</button>
	{/each}
	{#if !steps.length}
		<p class="text-surface-600-400 p-3 text-sm">
			<Icons.Info size={14} class="mr-1 inline" />
			This pipeline declares nothing to configure.
		</p>
	{/if}
</div>
