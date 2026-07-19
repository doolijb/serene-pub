<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onMount } from "svelte"

	interface Entity {
		type: "character" | "persona"
		id: number
		name: string
		avatar: string | null | undefined
	}

	interface Props {
		open: boolean
		onOpenChange: (e: { open: boolean }) => void
		entity: Entity | null
	}

	let { open = $bindable(), onOpenChange, entity }: Props = $props()

	const socket = useTypedSocket()
	let images = $state<string[]>([])
	let selectedSrc = $state<string | null>(null)
	let loading = $state(false)
	let brokenPaths = $state(new Set<string>())
	// Track which entity ID we requested so we can discard stale responses
	let pendingId = $state<number | null>(null)

	// Fetch gallery whenever modal opens or entity changes
	$effect(() => {
		if (open && entity) {
			images = []
			brokenPaths = new Set()
			selectedSrc = entity.avatar ?? null
			loading = true
			pendingId = entity.id
			if (entity.type === "character") {
				socket.emit("characters:listGallery", { characterId: entity.id })
			} else {
				socket.emit("personas:listGallery", { personaId: entity.id })
			}
		}
	})

	onMount(() => {
		const charHandler = (data: Sockets.Characters.ListGallery.Response) => {
			if (!open || entity?.type !== "character" || entity.id !== pendingId) return
			let imgs = data.images
			// Ensure current avatar is in the list
			if (entity.avatar && !imgs.includes(entity.avatar)) {
				imgs = [entity.avatar, ...imgs]
			}
			images = imgs
			loading = false
		}

		const personaHandler = (data: Sockets.Personas.ListGallery.Response) => {
			if (!open || entity?.type !== "persona" || entity.id !== pendingId) return
			let imgs = data.images
			if (entity.avatar && !imgs.includes(entity.avatar)) {
				imgs = [entity.avatar, ...imgs]
			}
			images = imgs
			loading = false
		}

		socket.on("characters:listGallery", charHandler)
		socket.on("personas:listGallery", personaHandler)

		return () => {
			socket.off("characters:listGallery", charHandler)
			socket.off("personas:listGallery", personaHandler)
		}
	})
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-4 space-y-4 shadow-xl w-[min(95vw,560px)] max-h-[90vh] flex flex-col border border-surface-300-700">
				<header class="flex shrink-0 items-center justify-between">
					<h2 class="h2">{entity?.name ?? "Avatar"}</h2>
					<button class="btn btn-sm" onclick={() => onOpenChange({ open: false })}>
						<Icons.X size={20} />
					</button>
				</header>

				<article class="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto">
					<!-- Main image -->
					{#if selectedSrc}
						<img
							src={selectedSrc}
							alt={entity?.name ?? "Avatar"}
							class="border-surface-300-700 max-h-[55vh] max-w-full shrink-0 rounded-lg border object-contain"
						/>
					{:else}
						<div class="text-surface-700-300 py-12 text-sm">No image available.</div>
					{/if}

					<!-- Gallery strip -->
					{#if loading}
						<div class="text-surface-700-300 flex shrink-0 items-center gap-2 text-sm">
							<Icons.Loader size={16} class="animate-spin" />
							Loading gallery…
						</div>
					{:else if images.length > 0}
						<div class="flex w-full shrink-0 flex-wrap gap-2">
							{#each images as imgPath}
								{#if !brokenPaths.has(imgPath)}
									<button
										class="overflow-hidden rounded border-2 transition-colors {selectedSrc === imgPath
											? 'border-primary-500'
											: 'border-surface-300-700 hover:border-surface-500'}"
										onclick={() => (selectedSrc = imgPath)}
										title="Select image"
									>
										<img
											src={imgPath}
											alt=""
											class="h-16 w-16 object-cover"
											onerror={() => {
												brokenPaths = new Set([...brokenPaths, imgPath])
											}}
										/>
									</button>
								{/if}
							{/each}
						</div>
					{/if}
				</article>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
