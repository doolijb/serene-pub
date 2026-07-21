<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy } from "svelte"
	import { Dialog, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { dragHandleZone, dragHandle } from "svelte-dnd-action"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import AvatarGalleryModal from "$lib/client/components/chatMessages/AvatarGalleryModal.svelte"

	interface Props {
		entityType: "character" | "persona"
		entityId: number
		entityName: string
		isOwner: boolean
		currentAvatar: string | null
	}

	let { entityType, entityId, entityName, isOwner, currentAvatar }: Props = $props()

	const socket = useTypedSocket()

	let images = $state<string[]>([])
	let isLoading = $state(true)
	let isUploading = $state(false)
	let fileInputEl: HTMLInputElement
	let brokenPaths = $state(new Set<string>())

	let pendingDeletePath = $state<string | null>(null)
	let showDeleteModal = $derived(pendingDeletePath !== null)
	let menuOpenFor = $state<string | null>(null)

	let lightboxOpen = $state(false)
	let lightboxPath = $state<string | null>(null)

	// dragHandleZone/dragHandle (svelte-dnd-action) expect to own the array
	// they're given during a drag gesture (id-keyed reconciliation) —
	// re-deriving this fresh from `images` on every `consider` tick would
	// desync its internal drag state, so this local mirror is what the zone
	// actually drives; `images` is only re-derived from it on `finalize`.
	type Tile = { id: string; path: string }
	let tiles = $state<Tile[]>([])
	$effect(() => {
		tiles = images.filter((p) => !brokenPaths.has(p)).map((p) => ({ id: p, path: p }))
	})

	function handleImageError(imgPath: string) {
		brokenPaths = new Set([...brokenPaths, imgPath])
	}

	function triggerUpload() {
		fileInputEl?.click()
	}

	async function handleFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		;(e.target as HTMLInputElement).value = ""
		if (!file) return

		if (!file.type.startsWith("image/")) {
			toaster.error({ title: "Please select an image file" })
			return
		}

		isUploading = true
		const buffer = await file.arrayBuffer()
		if (entityType === "character") {
			socket.emit("characters:uploadGalleryImage", {
				characterId: entityId,
				imageFile: new Uint8Array(buffer) as any,
				mimeType: file.type
			})
		} else {
			socket.emit("personas:uploadGalleryImage", {
				personaId: entityId,
				imageFile: new Uint8Array(buffer) as any,
				mimeType: file.type
			})
		}
	}

	function openLightbox(path: string) {
		lightboxPath = path
		lightboxOpen = true
	}

	function openMenu(path: string) {
		menuOpenFor = path
	}

	function setAsAvatar(path: string) {
		menuOpenFor = null
		if (entityType === "character") {
			socket.emit("characters:setAvatar", { characterId: entityId, path })
		} else {
			socket.emit("personas:setAvatar", { personaId: entityId, path })
		}
	}

	function requestDelete(path: string) {
		menuOpenFor = null
		pendingDeletePath = path
	}

	function confirmDelete() {
		if (!pendingDeletePath) return
		if (entityType === "character") {
			socket.emit("characters:deleteGalleryImage", { characterId: entityId, path: pendingDeletePath })
		} else {
			socket.emit("personas:deleteGalleryImage", { personaId: entityId, path: pendingDeletePath })
		}
		pendingDeletePath = null
	}

	function cancelDelete() {
		pendingDeletePath = null
	}

	function handleConsider(e: CustomEvent<{ items: Tile[] }>) {
		tiles = e.detail.items
	}

	function handleFinalize(e: CustomEvent<{ items: Tile[] }>) {
		tiles = e.detail.items
		const paths = tiles.map((t) => t.path)
		if (entityType === "character") {
			socket.emit("characters:reorderGallery", { characterId: entityId, paths })
		} else {
			socket.emit("personas:reorderGallery", { personaId: entityId, paths })
		}
	}

	onMount(() => {
		const handleList = (msg: { images: string[] }) => {
			isLoading = false
			images = msg.images
		}
		const handleUploadOk = (msg: { success: boolean }) => {
			isUploading = false
			if (msg.success) toaster.success({ title: "Image uploaded" })
			else toaster.error({ title: "Upload failed" })
		}
		const handleUploadErr = () => {
			isUploading = false
			toaster.error({ title: "Upload failed" })
		}
		const handleDeleteOk = () => toaster.success({ title: "Image deleted" })
		const handleSetAvatarOk = () => toaster.success({ title: "Avatar updated" })

		if (entityType === "character") {
			socket.on("characters:listGallery", handleList)
			socket.on("characters:uploadGalleryImage", handleUploadOk)
			socket.on("characters:uploadGalleryImage:error" as any, handleUploadErr)
			socket.on("characters:deleteGalleryImage", handleDeleteOk)
			socket.on("characters:setAvatar", handleSetAvatarOk)
			socket.emit("characters:listGallery", { characterId: entityId })
		} else {
			socket.on("personas:listGallery", handleList)
			socket.on("personas:uploadGalleryImage", handleUploadOk)
			socket.on("personas:uploadGalleryImage:error" as any, handleUploadErr)
			socket.on("personas:deleteGalleryImage", handleDeleteOk)
			socket.on("personas:setAvatar", handleSetAvatarOk)
			socket.emit("personas:listGallery", { personaId: entityId })
		}
	})

	onDestroy(() => {
		socket.off("characters:listGallery")
		socket.off("characters:uploadGalleryImage")
		socket.off("characters:uploadGalleryImage:error" as any)
		socket.off("characters:deleteGalleryImage")
		socket.off("characters:setAvatar")
		socket.off("personas:listGallery")
		socket.off("personas:uploadGalleryImage")
		socket.off("personas:uploadGalleryImage:error" as any)
		socket.off("personas:deleteGalleryImage")
		socket.off("personas:setAvatar")
	})
</script>

<div class="space-y-3">
	{#if isOwner}
		<input
			bind:this={fileInputEl}
			type="file"
			accept="image/*"
			class="hidden"
			onchange={handleFileChange}
		/>
		<div class="flex items-center justify-end">
			<button
				type="button"
				class="btn btn-sm preset-filled-surface-500"
				onclick={triggerUpload}
				disabled={isUploading}
				title="Upload an image"
			>
				{#if isUploading}
					<Icons.Loader2 class="h-3 w-3 animate-spin" />
				{:else}
					<Icons.Upload class="h-3 w-3" />
				{/if}
				Upload
			</button>
		</div>
	{/if}

	{#if isLoading}
		<div class="flex items-center justify-center py-6">
			<Icons.Loader2 class="text-muted-foreground h-6 w-6 animate-spin" />
		</div>
	{:else if tiles.length === 0}
		<div
			class="border-surface-300-600 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-6"
		>
			<Icons.ImagePlus class="text-muted-foreground h-8 w-8" />
			<p class="text-muted-foreground text-sm">No images yet</p>
			{#if isOwner}
				<button
					type="button"
					class="btn btn-sm preset-tonal-primary"
					onclick={triggerUpload}
					disabled={isUploading}
				>
					Upload an image
				</button>
			{/if}
		</div>
	{:else}
		<div
			class="grid grid-cols-2 gap-2 sm:grid-cols-3"
			use:dragHandleZone={{
				items: tiles,
				flipDurationMs: 150,
				dragDisabled: !isOwner || tiles.length <= 1,
				dropFromOthersDisabled: true
			}}
			onconsider={handleConsider}
			onfinalize={handleFinalize}
		>
			{#each tiles as tile (tile.id)}
				<div
					class="group relative aspect-square overflow-hidden rounded-lg border-2 transition-all
						{currentAvatar === tile.path
						? 'border-primary-500 ring-primary-500 ring-2 ring-offset-1'
						: 'border-surface-300-600 hover:border-surface-400-500'}"
				>
					<button
						type="button"
						class="h-full w-full"
						onclick={() => openLightbox(tile.path)}
						title="View image"
					>
						<img
							src={tile.path}
							alt="Gallery thumbnail"
							class="h-full w-full object-cover"
							onerror={() => handleImageError(tile.path)}
						/>
					</button>

					{#if isOwner && tiles.length > 1}
						<span
							use:dragHandle
							class="bg-surface-950/60 absolute top-1 left-1 cursor-grab touch-none rounded-full p-0.5 text-white"
							title="Drag to reorder"
						>
							<Icons.GripVertical class="h-3 w-3" />
						</span>
					{/if}

					{#if isOwner}
						<div class="absolute top-1 right-1" role="none" onclick={(e) => e.stopPropagation()}>
							<Popover
								open={menuOpenFor === tile.path}
								onOpenChange={(e) => (menuOpenFor = e.open ? tile.path : null)}
								positioning={{ placement: "bottom-end" }}
							>
								<Popover.Trigger
									class="bg-surface-950/60 hover:bg-primary-600-400 rounded-full p-0.5 text-white"
									aria-label="Image options"
								>
									<Icons.EllipsisVertical class="h-3 w-3" />
								</Popover.Trigger>
								<Portal>
									<Popover.Positioner class="z-[1000]!">
										<Popover.Content
											class="card bg-primary-200-800 w-[min(90vw,200px)] space-y-3 p-3 shadow-xl"
										>
											<header class="popover-menu-title">
												<Icons.Image size={16} aria-hidden="true" />
												<p>Image Options</p>
											</header>
											<article class="flex flex-col gap-2">
												{#if currentAvatar !== tile.path}
													<button
														type="button"
														class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
														onclick={() => setAsAvatar(tile.path)}
													>
														<Icons.Star size={16} aria-hidden="true" />
														<span>Set as avatar</span>
													</button>
												{/if}
												<button
													type="button"
													class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
													onclick={() => requestDelete(tile.path)}
												>
													<Icons.Trash2 size={16} aria-hidden="true" />
													<span>Delete</span>
												</button>
											</article>
										</Popover.Content>
									</Popover.Positioner>
								</Portal>
							</Popover>
						</div>
					{/if}

					{#if currentAvatar === tile.path}
						<div
							class="bg-primary-500 pointer-events-none absolute right-1 bottom-1 rounded-full p-0.5"
							title="Current avatar"
						>
							<Icons.Check class="h-3 w-3 text-white" />
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<Dialog open={showDeleteModal} onOpenChange={(e) => { if (!e.open) cancelDelete() }}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 max-w-sm space-y-4 p-6 shadow-xl">
				<header class="flex items-center gap-3">
					<Icons.Trash2 class="text-error-500 h-5 w-5 shrink-0" />
					<h2 class="text-lg font-bold">Delete Image</h2>
				</header>
				{#if pendingDeletePath}
					<div class="overflow-hidden rounded-lg">
						<img src={pendingDeletePath} alt="Preview of item to delete" class="h-24 w-full object-cover" />
					</div>
				{/if}
				<p class="text-muted-foreground text-sm">
					Are you sure you want to delete this image? This cannot be undone.
				</p>
				<footer class="flex justify-end gap-2">
					<button class="btn preset-filled-surface-400-600" onclick={cancelDelete}>Cancel</button>
					<button class="btn preset-filled-error-500" onclick={confirmDelete}>
						<Icons.Trash2 class="h-4 w-4" />
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<AvatarGalleryModal
	bind:open={lightboxOpen}
	onOpenChange={(e) => (lightboxOpen = e.open)}
	entity={{ type: entityType, id: entityId, name: entityName, avatar: lightboxPath }}
/>
