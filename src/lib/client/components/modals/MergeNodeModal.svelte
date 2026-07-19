<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"

	const socket = useTypedSocket()

	type NarrativeNode = Sockets.NarrativeGraph.NarrativeNode

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		node: NarrativeNode
		nodes: NarrativeNode[]
		lorebookId: number
		onMerged?: () => void
	}

	let { open = $bindable(), onOpenChange, node, nodes, lorebookId, onMerged }: Props = $props()

	let search = $state("")
	let selectedParent = $state<NarrativeNode | null>(null)
	let isMerging = $state(false)

	let candidates = $derived(
		nodes.filter(
			(n) =>
				n.id !== node.id &&
				!n.parentNodeId &&
				!(node.lorebookBindingId && n.lorebookBindingId)
		)
	)

	let filtered = $derived(
		search.trim()
			? candidates.filter((n) => n.name.toLowerCase().includes(search.trim().toLowerCase()))
			: candidates
	)

	function selectParent(n: NarrativeNode) {
		selectedParent = n
	}

	function confirm() {
		if (!selectedParent || isMerging) return
		isMerging = true
		socket.emit("narrativeGraph:mergeNode", {
			nodeId: node.id,
			parentNodeId: selectedParent.id
		} satisfies Sockets.NarrativeGraph.MergeNode.Params)
		onMerged?.()
	}

	function reset() {
		search = ""
		selectedParent = null
		isMerging = false
	}

	$effect(() => {
		if (!open) reset()
	})

	const NODE_STATE_COLOR: Record<string, string> = {
		active: "preset-tonal-primary",
		legendary: "preset-tonal-warning",
		deceased: "preset-tonal-error",
		missing: "preset-tonal-surface",
		departed: "preset-tonal-secondary",
		hidden: "preset-tonal-surface"
	}
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 space-y-4 shadow-xl max-h-[90dvh] flex flex-col w-[min(95vw,576px)]">
				<header class="flex items-center justify-between">
			<h2 class="text-lg font-semibold">Merge "{node.name}" into…</h2>
			<button class="btn btn-sm preset-tonal" onclick={() => onOpenChange({ open: false })}>
				<Icons.X size={18} />
			</button>
		</header>

		{#if !selectedParent}
			<p class="text-surface-700-300 text-sm">
				Select the node that <strong>{node.name}</strong> is an alias of. The selected node will become
				the primary entity; "{node.name}" will be hidden and treated as an alternate name.
			</p>

			<input
				class="input text-sm"
				type="text"
				placeholder="Search nodes…"
				bind:value={search}
			/>

			<div class="min-h-0 flex-1 overflow-y-auto space-y-1 pr-1">
				{#if filtered.length === 0}
					<p class="text-surface-700-300 py-4 text-center text-sm italic">No candidates found.</p>
				{/if}
				{#each filtered as candidate}
					<button
						class="preset-outlined-surface-300-700 hover:preset-filled-surface-500 btn w-full justify-start gap-3 text-left text-sm"
						onclick={() => selectParent(candidate)}
					>
						<Icons.User size={16} class="text-primary-500 shrink-0" />
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="font-medium">{candidate.name}</span>
								<span class="badge {NODE_STATE_COLOR[candidate.nodeState] ?? 'preset-tonal-surface'} ml-auto text-xs">
									{candidate.nodeState}
								</span>
							</div>
							{#if candidate.summary}
								<p class="text-surface-700-300 mt-0.5 truncate text-xs">{candidate.summary}</p>
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{:else}
			<div class="space-y-4">
				<div class="bg-surface-200-800 rounded-lg p-4 text-sm space-y-2">
					<p class="text-surface-700-300 text-xs font-semibold uppercase tracking-wide">Merging</p>
					<div class="flex items-center gap-3">
						<div class="text-center">
							<div class="font-medium">"{node.name}"</div>
							<div class="text-surface-400 text-xs">alias (hidden)</div>
						</div>
						<Icons.GitMerge size={18} class="text-warning-500 shrink-0" />
						<div class="text-center">
							<div class="font-medium">"{selectedParent.name}"</div>
							<div class="text-surface-400 text-xs">primary entity</div>
						</div>
					</div>
					<p class="text-surface-700-300 text-xs">
						"{node.name}" will be hidden from the graph and treated as an alternate name for
						"{selectedParent.name}". Its relationships will fall back to "{selectedParent.name}"
						when no direct relationship exists.
					</p>
					{#if node.lorebookBindingId && !selectedParent.lorebookBindingId}
						<p class="text-warning-500 text-xs">
							The character binding from "{node.name}" will transfer to "{selectedParent.name}".
						</p>
					{/if}
				</div>

				<div class="flex gap-2 justify-end">
					<button
						class="btn preset-filled-surface-400-600"
						onclick={() => { selectedParent = null }}
					>
						<Icons.ArrowLeft size={16} /> Back
					</button>
					<button
						class="btn preset-filled-warning-500"
						disabled={isMerging}
						onclick={confirm}
					>
						<Icons.GitMerge size={16} /> Confirm Merge
					</button>
				</div>
			</div>
		{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
