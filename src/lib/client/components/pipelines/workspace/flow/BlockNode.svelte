<script lang="ts">
	/**
	 * A control-flow construct's frame on the canvas — fan-out, for-each,
	 * loop, or route — sized by ELK around its member nodes, with a header
	 * bar that states what the construct does in its own terms. Clicking the
	 * header selects the block's own configuration step (a block carries
	 * settings like any node — whether its chains run together).
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Handle } from "@xyflow/svelte"
	import {
		MAP_CONTEXT_KEY,
		BLOCK_LABEL,
		BLOCK_ACCENT,
		countsFor,
		type PipelineMapContext
	} from "./context"

	let { data, sourcePosition, targetPosition } = $props()

	const ctx = getContext<PipelineMapContext>(MAP_CONTEXT_KEY)

	type WireBlock = NonNullable<
		NonNullable<Sockets.Pipelines.Detail.Response["spec"]>["graph"]
	>["blocks"][number]

	const block = $derived(data.block as WireBlock)
	const step = $derived(ctx.stepFor(block.stepKey))
	const counts = $derived(countsFor(step))
	const active = $derived(!!block.stepKey && block.stepKey === ctx.activeKey)

	const humanizeBlockName = (id: string) =>
		id
			.split(".")
			.at(-1)!
			.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
			.replace(/^./, (c) => c.toUpperCase())

	/** The counts line: what this construct does, said in its own terms. */
	const meta = $derived.by(() => {
		if (block.kind === "map")
			return [
				block.over ? `over ${block.over}` : null,
				block.max ? `up to ${block.max}×` : null,
				block.mode === "sequential" ? "in order" : null
			]
				.filter(Boolean)
				.join(" · ")
		if (block.kind === "loop")
			return [
				block.repeatWhile ? `while ${block.repeatWhile}` : "repeats",
				block.max ? `up to ${block.max}×` : null,
				block.mode === "sequential" ? "in order" : null
			]
				.filter(Boolean)
				.join(" · ")
		if (block.kind === "route")
			return [
				block.on ? `on ${block.on}` : null,
				"any subset may fire"
			]
				.filter(Boolean)
				.join(" · ")
		return block.mode === "sequential" ? "in order" : "at once"
	})
</script>

<div
	class="bg-surface-200-800/40 h-full w-full rounded-lg border-2 border-dashed {BLOCK_ACCENT[
		block.kind
	] ?? 'border-surface-400-600'}"
>
	<Handle type="target" position={targetPosition} class="!opacity-0" />
	<div
		class="flex items-center gap-1.5 overflow-hidden rounded-t-md px-2.5 py-1.5
			{active ? 'preset-filled-primary-500' : ''} {block.stepKey ? 'cursor-pointer' : ''}"
		aria-current={active ? "step" : undefined}
		title={block.stepKey
			? "This construct has settings of its own"
			: undefined}
	>
		<span
			class="flex shrink-0 items-center gap-1 text-[10px] font-bold tracking-[.15em] uppercase
				{active ? '' : 'text-surface-600-400'}"
		>
			{#if block.kind === "loop"}
				<Icons.Repeat size={11} aria-hidden="true" />
			{:else if block.kind === "map"}
				<Icons.Layers size={11} aria-hidden="true" />
			{:else if block.kind === "route"}
				<Icons.GitBranch size={11} aria-hidden="true" />
			{:else}
				<Icons.GitFork size={11} aria-hidden="true" />
			{/if}
			{BLOCK_LABEL[block.kind] ?? block.kind}
		</span>
		<span class="truncate text-xs font-semibold">
			{humanizeBlockName(block.id)}
		</span>
		<span
			class="min-w-0 truncate text-[11px] {active
				? 'opacity-80'
				: 'text-surface-600-400'}"
		>
			{meta}
		</span>
		{#if counts?.overridden}
			<span
				class="preset-filled-secondary-500 ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
				title="{counts.overridden} set here, not inherited"
			>
				{counts.overridden}
			</span>
		{/if}
	</div>
	{#if block.kind === "loop"}
		<div
			class="text-surface-600-400 pointer-events-none absolute right-2 bottom-1 flex items-center gap-1 text-[10px] tracking-wide uppercase"
		>
			<Icons.CornerLeftUp size={11} aria-hidden="true" />
			repeats
		</div>
	{/if}
	<Handle type="source" position={sourcePosition} class="!opacity-0" />
</div>
