<script lang="ts">
	import { onDestroy, onMount } from "svelte"
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

	let {
		open = $bindable(),
		onOpenChange,
		node,
		nodes,
		lorebookId,
		onMerged
	}: Props = $props()

	let search = $state("")
	let selectedTarget = $state<NarrativeNode | null>(null)
	let isMerging = $state(false)
	let mergeError = $state<string | null>(null)

	// A row is "bound" when it has a real character/persona attached. Two
	// bound rows can never be absorbed into each other (they're distinct
	// individuals, enforced server-side too); a bound + unbound pair is
	// allowed, but the server always makes the bound row survive regardless
	// of which one is picked here as the "target" (see the note below).
	function isBound(n: NarrativeNode): boolean {
		return n.characterId != null || n.personaId != null
	}

	let candidates = $derived(
		nodes.filter((n) => n.id !== node.id && !(isBound(node) && isBound(n)))
	)

	let filtered = $derived(
		search.trim()
			? candidates.filter((n) =>
					n.name.toLowerCase().includes(search.trim().toLowerCase())
				)
			: candidates
	)

	// Whichever row is bound survives, auto-swapping regardless of which was
	// picked as the "target" — matches the server's own auto-swap rule.
	let survivor = $derived(
		selectedTarget
			? isBound(node)
				? node
				: selectedTarget
			: null
	)
	let absorbed = $derived(
		selectedTarget
			? isBound(node)
				? selectedTarget
				: node
			: null
	)

	function selectTarget(n: NarrativeNode) {
		selectedTarget = n
	}

	function confirm() {
		if (!selectedTarget || isMerging) return
		mergeError = null
		isMerging = true
		socket.emit("narrativeGraph:mergeNode", {
			nodeId: node.id,
			parentNodeId: selectedTarget.id
		} satisfies Sockets.NarrativeGraph.MergeNode.Params)
		onMerged?.()
	}

	function reset() {
		search = ""
		selectedTarget = null
		isMerging = false
		mergeError = null
	}

	$effect(() => {
		if (!open) reset()
	})

	// A rejected merge (eg. tripping a server-side guard) otherwise left
	// isMerging stuck true forever — nothing was listening for the generic
	// `{event}:error` the shared register() wrapper emits on any thrown
	// error.
	function handleMergeNodeError(msg: { error?: string }) {
		isMerging = false
		mergeError = msg?.error || "Failed to merge — please try again."
	}

	onMount(() => {
		socket.on("narrativeGraph:mergeNode:error", handleMergeNodeError)
	})

	onDestroy(() => {
		socket.off("narrativeGraph:mergeNode:error", handleMergeNodeError)
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
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[90dvh] w-[min(95vw,576px)] flex-col space-y-4 p-6 shadow-xl"
			>
				<header class="flex items-center justify-between">
					<h2 class="text-lg font-semibold">
						Absorb "{node.name}" into…
					</h2>
					<button
						class="btn btn-sm preset-tonal"
						onclick={() => onOpenChange({ open: false })}
					>
						<Icons.X size={18} />
					</button>
				</header>

				{#if !selectedTarget}
					<p class="text-surface-700-300 text-sm">
						Pick the character <strong>{node.name}</strong> is actually
						the same person as. Their relationships, private lore,
						and scene appearances all move over; "{node.name}"
						becomes a recognized alias and this row is deleted.
					</p>

					<input
						class="input text-sm"
						type="text"
						placeholder="Search characters…"
						bind:value={search}
					/>

					<div class="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
						{#if filtered.length === 0}
							<p
								class="text-surface-700-300 py-4 text-center text-sm italic"
							>
								No candidates found.
							</p>
						{/if}
						{#each filtered as candidate}
							<button
								class="preset-outlined-surface-300-700 hover:preset-filled-surface-500 btn w-full justify-start gap-3 text-left text-sm"
								onclick={() => selectTarget(candidate)}
							>
								<Icons.User
									size={16}
									class="text-primary-500 shrink-0"
								/>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="font-medium">
											{candidate.name}
										</span>
										<span
											class="badge {NODE_STATE_COLOR[
												candidate.nodeState
											] ??
												'preset-tonal-surface'} ml-auto text-xs"
										>
											{candidate.nodeState}
										</span>
									</div>
									{#if candidate.summary}
										<p
											class="text-surface-700-300 mt-0.5 truncate text-xs"
										>
											{candidate.summary}
										</p>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{:else if survivor && absorbed}
					<div class="space-y-4">
						<div
							class="bg-surface-200-800 space-y-2 rounded-lg p-4 text-sm"
						>
							<p
								class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
							>
								Absorbing
							</p>
							<div class="flex items-center gap-3">
								<div class="text-center">
									<div class="font-medium">
										"{absorbed.name}"
									</div>
									<div class="text-surface-400 text-xs">
										deleted, becomes an alias
									</div>
								</div>
								<Icons.GitMerge
									size={18}
									class="text-warning-500 shrink-0"
								/>
								<div class="text-center">
									<div class="font-medium">
										"{survivor.name}"
									</div>
									<div class="text-surface-400 text-xs">
										survives
									</div>
								</div>
							</div>
							<p class="text-surface-700-300 text-xs">
								Every relationship, scene appearance, and
								private lore entry currently on "{absorbed.name}"
								moves to "{survivor.name}", whose known aliases
								gain "{absorbed.name}" — so future scene
								summaries recognize it without creating another
								duplicate. "{absorbed.name}" is then deleted.
							</p>
							{#if isBound(node) ? node.id !== selectedTarget.id : false}
								<p class="text-warning-500 text-xs">
									"{node.name}" is a linked character, so it
									survives regardless of which side you
									picked above.
								</p>
							{/if}
							<p class="text-surface-500 text-xs">
								This can be undone from the Recent Merges list
								in the Bindings tab, as long as "{survivor.name}"
								hasn't since been absorbed elsewhere too.
							</p>
						</div>

						{#if mergeError}
							<p class="text-error-500 text-xs" role="alert">
								{mergeError}
							</p>
						{/if}

						<div class="flex justify-end gap-2">
							<button
								class="btn preset-filled-surface-400-600"
								onclick={() => {
									selectedTarget = null
								}}
							>
								<Icons.ArrowLeft size={16} /> Back
							</button>
							<button
								class="btn preset-filled-warning-500"
								disabled={isMerging}
								onclick={confirm}
							>
								<Icons.GitMerge size={16} /> Confirm Absorb
							</button>
						</div>
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
