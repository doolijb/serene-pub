<script lang="ts">
	/**
	 * One pipeline step on the canvas — the same card language the list
	 * navigator speaks: kind stripe, settings count, override badge, unsaved
	 * dot. Selection and draft state come through the map context so the
	 * laid-out graph never rebuilds for a click.
	 */
	import { getContext } from "svelte"
	import { Handle } from "@xyflow/svelte"
	import {
		MAP_CONTEXT_KEY,
		KIND_STRIPE,
		countsFor,
		type PipelineMapContext
	} from "./context"

	let { data, sourcePosition, targetPosition } = $props()

	const ctx = getContext<PipelineMapContext>(MAP_CONTEXT_KEY)

	const wire = $derived(data.wire as {
		key: string
		label: string
		kind: string
		stepKey: string | null
		toggleable: boolean
		enabledDefault: boolean
	})
	const step = $derived(ctx.stepFor(wire.stepKey))
	const counts = $derived(countsFor(step))
	const pending = $derived(wire.stepKey ? ctx.pendingFor(wire.stepKey) : 0)
	const active = $derived(!!wire.stepKey && wire.stepKey === ctx.activeKey)
</script>

<div
	class="flex h-full w-full items-stretch overflow-hidden rounded-md border transition-colors
		{active
		? 'preset-filled-primary-500 border-primary-500'
		: `bg-surface-100-900 border-surface-300-700 ${wire.stepKey ? 'hover:border-primary-500/60' : 'opacity-55'}`}
		{wire.stepKey ? 'cursor-pointer' : 'cursor-default'}"
	title={wire.stepKey
		? undefined
		: `${wire.label} declares nothing to configure`}
	aria-current={active ? "step" : undefined}
>
	<Handle type="target" position={targetPosition} class="!opacity-0" />
	<span
		aria-hidden="true"
		class="w-[3px] shrink-0 {KIND_STRIPE[wire.kind] ?? 'bg-surface-400-600'}"
	></span>
	<span class="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2">
		<span class="min-w-0 flex-1">
			<span class="flex min-w-0 items-center gap-1.5">
				<span class="truncate text-[13px] font-medium">{wire.label}</span>
				{#if pending}
					<span
						class="bg-warning-500 size-2 shrink-0 rounded-full"
						title="{pending} unsaved change{pending === 1 ? '' : 's'}"
					></span>
				{/if}
			</span>
			<span class="flex items-center gap-1.5 text-[11px] opacity-70">
				<span class="truncate font-mono">{wire.kind}</span>
				{#if counts}
					<span aria-hidden="true">·</span>
					<span class="truncate">
						{counts.total}
						{counts.total === 1 ? "setting" : "settings"}
					</span>
				{/if}
			</span>
		</span>
		{#if counts?.overridden}
			<span
				class="preset-filled-secondary-500 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
				title="{counts.overridden} set here, not inherited"
			>
				{counts.overridden}
			</span>
		{/if}
		{#if wire.toggleable}
			<span
				class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold
					{wire.enabledDefault ? 'preset-tonal-surface' : 'preset-tonal-error'}"
				title={wire.enabledDefault
					? "Optional — on by default"
					: "Optional — off by default"}
			>
				opt
			</span>
		{/if}
	</span>
	<Handle type="source" position={sourcePosition} class="!opacity-0" />
</div>
