<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"

	const socket = useTypedSocket()

	type UnlinkedNode = Sockets.BindingCheck.NodeResult.UnlinkedNode
	type PendingBinding = Sockets.BindingCheck.NodeResult.PendingBinding

	interface PendingEntry {
		binding: PendingBinding
		unlinkedNodes: UnlinkedNode[]
	}

	interface Props {
		open: boolean
		lorebookId: number
		pendingBindings: PendingEntry[]
		onOpenChange: (e: { open: boolean }) => void
		onDone?: () => void
	}

	let {
		open = $bindable(),
		lorebookId,
		pendingBindings = [],
		onOpenChange,
		onDone
	}: Props = $props()

	let currentIndex = $state(0)
	let current = $derived(pendingBindings[currentIndex] ?? null)
	let isBusy = $state(false)

	function advance() {
		if (currentIndex < pendingBindings.length - 1) {
			currentIndex++
		} else {
			onOpenChange({ open: false })
			onDone?.()
		}
	}

	function linkNode(bindingId: number, nodeId: number) {
		isBusy = true
		socket.emit("narrativeGraph:linkBindingNode", { bindingId, nodeId })
		isBusy = false
		advance()
	}

	function createNode(bindingId: number) {
		isBusy = true
		socket.emit("narrativeGraph:linkBindingNode", {
			bindingId,
			nodeId: null
		})
		isBusy = false
		advance()
	}

	const NODE_STATE_LABELS: Record<string, string> = {
		active: "Active",
		deceased: "Deceased",
		missing: "Missing",
		departed: "Departed",
		legendary: "Legendary",
		hidden: "Hidden"
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
				class="card bg-surface-100-900 relative max-h-[95dvh] w-[min(95vw,608px)] space-y-5 overflow-hidden p-6 shadow-xl"
			>
				<header class="flex items-center justify-between">
					<h2 class="text-lg font-semibold">
						Link Character to Graph Node
					</h2>
					<button
						class="btn btn-sm preset-tonal"
						onclick={() => onOpenChange({ open: false })}
					>
						<Icons.X size={18} />
					</button>
				</header>

				{#if current}
					<p class="text-surface-600-400 text-sm">
						<strong>{current.binding.entityName}</strong>
						(binding:
						<code class="code">{current.binding.binding}</code>
						) isn't linked to a narrative graph node yet. Select an existing
						node or create a new one.
					</p>

					<div class="space-y-3">
						<p
							class="text-surface-700-300 text-xs font-medium tracking-wide uppercase"
						>
							Existing unlinked nodes
						</p>
						<div class="max-h-52 space-y-1 overflow-y-auto pr-1">
							{#each current.unlinkedNodes as node}
								<button
									class="preset-outlined-surface-300-700 hover:preset-filled-surface-500 btn w-full justify-start gap-3 text-left text-sm"
									disabled={isBusy}
									onclick={() =>
										linkNode(
											current.binding.bindingId,
											node.id
										)}
								>
									<Icons.CircleDot
										size={16}
										class="text-primary-500 shrink-0"
									/>
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-2">
											<span class="font-medium">
												{node.name}
											</span>
											{#if node.score && node.score > 0}
												<span
													class="badge preset-filled-primary-500 text-xs"
												>
													match
												</span>
											{/if}
											<span
												class="text-surface-400 ml-auto text-xs"
											>
												{NODE_STATE_LABELS[
													node.nodeState
												] ?? node.nodeState}
											</span>
										</div>
										{#if node.summary}
											<p
												class="text-surface-700-300 mt-0.5 truncate text-xs"
											>
												{node.summary}
											</p>
										{/if}
									</div>
								</button>
							{/each}
						</div>

						<div class="border-t pt-3">
							<button
								class="preset-outlined-primary-500 btn w-full justify-start gap-3"
								disabled={isBusy}
								onclick={() =>
									createNode(current.binding.bindingId)}
							>
								<Icons.Plus size={18} />
								<span>
									Create new node for <strong>
										{current.binding.entityName}
									</strong>
								</span>
							</button>
						</div>
					</div>

					<div
						class="text-surface-700-300 border-t pt-2 text-right text-xs"
					>
						{currentIndex + 1} of {pendingBindings.length}
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
