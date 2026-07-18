<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { untrack } from "svelte"

	const socket = useTypedSocket()

	type OrphanedBinding = Sockets.BindingCheck.Result.OrphanedBinding
	type UnboundEntity = Sockets.BindingCheck.Result.UnboundEntity

	interface Props {
		open: boolean
		lorebookId: number
		chatId: number
		orphanedBindings: OrphanedBinding[]
		unboundEntities: UnboundEntity[]
		onOpenChange: (e: { open: boolean }) => void
		onDone?: () => void
	}

	let {
		open = $bindable(),
		lorebookId,
		chatId,
		orphanedBindings = [],
		unboundEntities = [],
		onOpenChange,
		onDone
	}: Props = $props()

	type Status = "pending" | "picking" | "done" | "skipped"
	let statuses = $state<Record<number, Status>>(
		untrack(() => Object.fromEntries(orphanedBindings.map((b) => [b.id, "pending" as Status])))
	)

	let currentIndex = $state(0)
	let currentBinding = $derived(orphanedBindings[currentIndex] ?? null)
	let isBusy = $state(false)

	function advance() {
		const nextIdx = orphanedBindings.findIndex(
			(b, i) => i > currentIndex && statuses[b.id] === "pending"
		)
		if (nextIdx !== -1) {
			currentIndex = nextIdx
		} else {
			onOpenChange({ open: false })
			onDone?.()
		}
	}

	async function linkEntity(bindingId: number, entity: UnboundEntity) {
		isBusy = true
		socket.emit("lorebooks:updateBinding", {
			lorebookBinding: {
				id: bindingId,
				...(entity.type === "character"
					? { characterId: entity.id }
					: { personaId: entity.id })
			}
		})
		statuses[bindingId] = "done"
		isBusy = false
		advance()
	}

	function skip(bindingId: number) {
		statuses[bindingId] = "skipped"
		advance()
	}

	let showPicker = $state(false)
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 space-y-5 shadow-xl max-h-[95dvh] relative overflow-hidden w-[min(95vw,576px)]">
				<header class="flex items-center justify-between">
					<h2 class="text-lg font-semibold">Unlinked Lorebook Binding</h2>
					<button class="btn btn-sm preset-tonal" onclick={() => onOpenChange({ open: false })}>
						<Icons.X size={18} />
					</button>
				</header>

				{#if currentBinding}
					<p class="text-surface-600-400 text-sm">
						The binding token <code class="code">{currentBinding.binding}</code> exists in your
						lorebook but isn't linked to any character or persona. How would you like to handle it?
					</p>

					{#if !showPicker}
						<div class="flex flex-col gap-2">
							{#if unboundEntities.length > 0}
								<button
									class="preset-outlined-primary-500 btn w-full justify-start gap-3"
									disabled={isBusy}
									onclick={() => (showPicker = true)}
								>
									<Icons.Link2 size={18} />
									<span>Link to a character or persona from this chat</span>
								</button>
							{/if}

							<button
								class="preset-outlined-surface-400-600 btn w-full justify-start gap-3 opacity-60"
								disabled={isBusy}
								onclick={() => skip(currentBinding.id)}
							>
								<Icons.SkipForward size={18} />
								<span>Skip — leave this binding unlinked for now</span>
							</button>
						</div>
					{:else}
						<div class="space-y-2">
							<p class="text-surface-500 text-xs">Select who <code class="code">{currentBinding.binding}</code> refers to:</p>
							<div class="max-h-48 overflow-y-auto space-y-1 pr-1">
								{#each unboundEntities as entity}
									<button
										class="preset-outlined-surface-300-700 hover:preset-filled-surface-500 btn w-full justify-start gap-2 text-sm"
										disabled={isBusy}
										onclick={() => linkEntity(currentBinding.id, entity)}
									>
										{#if entity.type === "character"}
											<Icons.User size={16} />
										{:else}
											<Icons.UserSquare size={16} />
										{/if}
										<span>{entity.name}</span>
										<span class="text-surface-400 ml-auto text-xs">{entity.type}</span>
									</button>
								{/each}
							</div>
							<button
								class="btn btn-sm text-surface-500"
								onclick={() => (showPicker = false)}
							>
								<Icons.ArrowLeft size={14} />
								Back
							</button>
						</div>
					{/if}

					<div class="text-surface-500 border-t pt-2 text-right text-xs">
						Binding {currentIndex + 1} of {orphanedBindings.length}
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
