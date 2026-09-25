<script lang="ts">
	/**
	 * One box on the event map: an event, a pipeline (spec) or a listener. The
	 * kind is a word on the second line and a glyph, never colour alone; the
	 * id is the tooltip, as everywhere a display name stands for an id.
	 */
	import { Handle, Position, type NodeProps } from "@xyflow/svelte"
	import * as Icons from "@lucide/svelte"

	let {
		data,
		sourcePosition = Position.Right,
		targetPosition = Position.Left
	}: NodeProps = $props()

	const node = $derived(data.node as Sockets.Pipelines.EventMap.MapNode)
	const KIND_WORD = { event: "event", spec: "pipeline", listener: "listener" }
	const selected = $derived(!!data.selected)
	/** A core listener has nowhere to go; everything else opens something. */
	const clickable = $derived(!(node.kind === "listener" && node.id.startsWith("core:")))
</script>

<div
	class="flex h-full w-full items-center gap-2 overflow-hidden rounded-md border px-2.5 transition-colors
		{selected
		? 'bg-surface-200-800 border-primary-500'
		: 'bg-surface-50-950 border-surface-300-700'}
		{clickable ? 'hover:border-primary-500/60 cursor-pointer' : 'cursor-default'}"
	style={selected ? "box-shadow: inset 3px 0 0 var(--color-primary-500)" : undefined}
	title={node.id}
>
	<Handle type="target" position={targetPosition} class="!opacity-0" />
	<span class="text-surface-600-400 shrink-0" aria-hidden="true">
		{#if node.kind === "event"}
			<Icons.Zap size={16} />
		{:else if node.kind === "spec"}
			<Icons.Workflow size={16} />
		{:else}
			<Icons.Ear size={16} />
		{/if}
	</span>
	<span class="min-w-0 flex-1">
		<span class="block truncate text-[13px] font-medium">{node.label}</span>
		<span class="text-surface-600-400 flex items-center gap-1.5 text-[11px]">
			<span>{KIND_WORD[node.kind]}</span>
			{#if node.kind === "event" && node.root}
				<span aria-hidden="true">·</span>
				<span title="A root: nothing on this map causes it, so it starts a chain">root</span>
			{/if}
		</span>
	</span>
	<Handle type="source" position={sourcePosition} class="!opacity-0" />
</div>
