<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy } from "svelte"
	import { Dialog, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { dragHandleZone, dragHandle } from "svelte-dnd-action"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import EntityGalleryViewModal from "$lib/client/components/sessionMessages/EntityGalleryViewModal.svelte"

	interface Props {
		entityType: "character" | "persona"
		entityId: number
		entityName: string
		isOwner: boolean
		/** The media id of the entity's current avatar, so "which tile is the
		 *  avatar" is an id comparison rather than a URL string match — the
		 *  latter broke the moment the two sides built the URL differently
		 *  (thumb vs original). */
		currentAvatarMediaId: number | null
	}

	let {
		entityType,
		entityId,
		entityName,
		isOwner,
		currentAvatarMediaId
	}: Props =
		$props()

	const socket = useTypedSocket()

	// Media rows, not paths (28): the id is the identity, so a reorder, a
	// rename or a re-upload of identical bytes can no longer desync this list
	// from what the server has.
	let images = $state<Sockets.Media[]>([])
	let isLoading = $state(true)
	let isUploading = $state(false)
	let fileInputEl: HTMLInputElement
	let brokenIds = $state(new Set<number>())

	let pendingDeleteId = $state<number | null>(null)
	let showDeleteModal = $derived(pendingDeleteId !== null)
	let pendingDeleteMedia = $derived(
		images.find((m) => m.id === pendingDeleteId) ?? null
	)
	let menuOpenFor = $state<number | null>(null)

	let lightboxOpen = $state(false)
	let lightboxPath = $state<string | null>(null)

	// dragHandleZone/dragHandle (svelte-dnd-action) expect to own the array
	// they're given during a drag gesture (id-keyed reconciliation) —
	// re-deriving this fresh from `images` on every `consider` tick would
	// desync its internal drag state, so this local mirror is what the zone
	// actually drives; `images` is only re-derived from it on `finalize`.
	type Tile = { id: number; media: Sockets.Media }
	let tiles = $state<Tile[]>([])
	$effect(() => {
		tiles = images
			.filter((m) => !brokenIds.has(m.id))
			.map((m) => ({ id: m.id, media: m }))
	})

	function handleImageError(id: number) {
		brokenIds = new Set([...brokenIds, id])
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

	function openMenu(id: number) {
		menuOpenFor = id
	}

	function setAsAvatar(mediaId: number) {
		menuOpenFor = null
		if (entityType === "character") {
			socket.emit("characters:setAvatar", {
				characterId: entityId,
				mediaId
			})
		} else {
			socket.emit("personas:setAvatar", { personaId: entityId, mediaId })
		}
	}

	function requestDelete(id: number) {
		menuOpenFor = null
		pendingDeleteId = id
	}

	function confirmDelete() {
		if (pendingDeleteId === null) return
		if (entityType === "character") {
			socket.emit("characters:deleteGalleryImage", {
				characterId: entityId,
				mediaId: pendingDeleteId
			})
		} else {
			socket.emit("personas:deleteGalleryImage", {
				personaId: entityId,
				mediaId: pendingDeleteId
			})
		}
		pendingDeleteId = null
	}

	function cancelDelete() {
		pendingDeleteId = null
	}

	function handleConsider(e: CustomEvent<{ items: Tile[] }>) {
		tiles = e.detail.items
	}

	function handleFinalize(e: CustomEvent<{ items: Tile[] }>) {
		tiles = e.detail.items
		const mediaIds = tiles.map((t) => t.id)
		if (entityType === "character") {
			socket.emit("characters:reorderGallery", {
				characterId: entityId,
				mediaIds
			})
		} else {
			socket.emit("personas:reorderGallery", {
				personaId: entityId,
				mediaIds
			})
		}
	}

	function matchesEntity(msg: { characterId?: number; personaId?: number }) {
		return entityType === "character"
			? msg.characterId === entityId
			: msg.personaId === entityId
	}

	function handleList(msg: {
		images: Sockets.Media[]
		characterId?: number
		personaId?: number
	}) {
		if (!matchesEntity(msg)) return
		isLoading = false
		images = msg.images
	}
	function handleUploadOk(msg: {
		success: boolean
		characterId?: number
		personaId?: number
	}) {
		if (!matchesEntity(msg)) return
		isUploading = false
		if (msg.success) toaster.success({ title: "Image uploaded" })
		else toaster.error({ title: "Upload failed" })
	}
	function handleUploadErr(msg: {
		characterId?: number
		personaId?: number
	}) {
		if (!matchesEntity(msg)) return
		isUploading = false
		toaster.error({ title: "Upload failed" })
	}
	function handleDeleteOk(msg: { characterId?: number; personaId?: number }) {
		if (!matchesEntity(msg)) return
		toaster.success({ title: "Image deleted" })
	}
	function handleSetAvatarOk(msg: {
		character?: { id: number }
		persona?: { id: number }
	}) {
		const id =
			entityType === "character" ? msg.character?.id : msg.persona?.id
		if (id !== entityId) return
		toaster.success({ title: "Avatar updated" })
	}

	onMount(() => {
		if (entityType === "character") {
			socket.on("characters:listGallery", handleList)
			socket.on("characters:uploadGalleryImage", handleUploadOk)
			socket.on(
				"characters:uploadGalleryImage:error" as any,
				handleUploadErr
			)
			socket.on("characters:deleteGalleryImage", handleDeleteOk)
			socket.on("characters:setAvatar", handleSetAvatarOk)
			socket.emit("characters:listGallery", { characterId: entityId })
		} else {
			socket.on("personas:listGallery", handleList)
			socket.on("personas:uploadGalleryImage", handleUploadOk)
			socket.on(
				"personas:uploadGalleryImage:error" as any,
				handleUploadErr
			)
			socket.on("personas:deleteGalleryImage", handleDeleteOk)
			socket.on("personas:setAvatar", handleSetAvatarOk)
			socket.emit("personas:listGallery", { personaId: entityId })
		}
	})

	onDestroy(() => {
		socket.off("characters:listGallery", handleList)
		socket.off("characters:uploadGalleryImage", handleUploadOk)
		socket.off(
			"characters:uploadGalleryImage:error" as any,
			handleUploadErr
		)
		socket.off("characters:deleteGalleryImage", handleDeleteOk)
		socket.off("characters:setAvatar", handleSetAvatarOk)
		socket.off("personas:listGallery", handleList)
		socket.off("personas:uploadGalleryImage", handleUploadOk)
		socket.off("personas:uploadGalleryImage:error" as any, handleUploadErr)
		socket.off("personas:deleteGalleryImage", handleDeleteOk)
		socket.off("personas:setAvatar", handleSetAvatarOk)
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
						{currentAvatarMediaId === tile.id
						? 'border-primary-500 ring-primary-500 ring-2 ring-offset-1'
						: 'border-surface-300-600 hover:border-surface-400-500'}"
				>
					<button
						type="button"
						class="h-full w-full"
						onclick={() => openLightbox(tile.media.url)}
						title="View image"
					>
						<img
							src={tile.media.thumbUrl}
							alt="Gallery thumbnail"
							class="h-full w-full object-cover"
							loading="lazy"
							width={tile.media.width ?? undefined}
							height={tile.media.height ?? undefined}
							onerror={() => handleImageError(tile.id)}
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
						<div
							class="absolute top-1 right-1"
							role="none"
							onclick={(e) => e.stopPropagation()}
						>
							<Popover
								open={menuOpenFor === tile.id}
								onOpenChange={(e) =>
									(menuOpenFor = e.open ? tile.id : null)}
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
												<Icons.Image
													size={16}
													aria-hidden="true"
												/>
												<p>Image Options</p>
											</header>
											<article
												class="flex flex-col gap-2"
											>
												{#if currentAvatarMediaId !== tile.id}
													<button
														type="button"
														class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
														onclick={() =>
															setAsAvatar(
																tile.id
															)}
													>
														<Icons.Star
															size={16}
															aria-hidden="true"
														/>
														<span>
															Set as avatar
														</span>
													</button>
												{/if}
												<button
													type="button"
													class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
													onclick={() =>
														requestDelete(
															tile.id
														)}
												>
													<Icons.Trash2
														size={16}
														aria-hidden="true"
													/>
													<span>Delete</span>
												</button>
											</article>
										</Popover.Content>
									</Popover.Positioner>
								</Portal>
							</Popover>
						</div>
					{/if}

					{#if currentAvatarMediaId === tile.id}
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

<Dialog
	open={showDeleteModal}
	onOpenChange={(e) => {
		if (!e.open) cancelDelete()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-w-sm space-y-4 p-6 shadow-xl"
			>
				<header class="flex items-center gap-3">
					<Icons.Trash2 class="text-error-500 h-5 w-5 shrink-0" />
					<h2 class="text-lg font-bold">Delete Image</h2>
				</header>
				{#if pendingDeleteMedia}
					<div class="overflow-hidden rounded-lg">
						<img
							src={pendingDeleteMedia.thumbUrl}
							alt="Preview of item to delete"
							class="h-24 w-full object-cover"
						/>
					</div>
				{/if}
				<p class="text-muted-foreground text-sm">
					Are you sure you want to delete this image? This cannot be
					undone.
				</p>
				<footer class="flex justify-end gap-2">
					<button
						class="btn preset-filled-surface-400-600"
						onclick={cancelDelete}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-error-500"
						onclick={confirmDelete}
					>
						<Icons.Trash2 class="h-4 w-4" />
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<EntityGalleryViewModal
	bind:open={lightboxOpen}
	onOpenChange={(e) => (lightboxOpen = e.open)}
	entity={{
		type: entityType,
		id: entityId,
		name: entityName,
		avatar: lightboxPath
	}}
/>
