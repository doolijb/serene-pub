<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy } from "svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		characterId: number
		currentAvatar: string | null
		onAvatarChange?: (newPath: string) => void
	}

	let { characterId, currentAvatar = $bindable(), onAvatarChange }: Props = $props()

	const socket = useTypedSocket()

	let images = $state<string[]>([])
	let isLoading = $state(true)
	let isUploading = $state(false)
	let fileInputEl: HTMLInputElement

	// Track broken images so we can hide them gracefully
	let brokenPaths = $state(new Set<string>())

	// Delete confirmation
	let pendingDeletePath = $state<string | null>(null)
	let showDeleteModal = $derived(pendingDeletePath !== null)

	function handleImageError(imgPath: string) {
		brokenPaths = new Set([...brokenPaths, imgPath])
	}

	function triggerUpload() {
		fileInputEl?.click()
	}

	async function handleFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return

		if (!file.type.startsWith("image/")) {
			toaster.error({ title: "Please select an image file" })
			return
		}

		isUploading = true
		const buffer = await file.arrayBuffer()
		socket.emit("characters:uploadGalleryImage", {
			characterId,
			imageFile: new Uint8Array(buffer) as any,
			mimeType: file.type
		})

		// Reset input so the same file can be re-selected
		;(e.target as HTMLInputElement).value = ""
	}

	function selectAvatar(imgPath: string) {
		socket.emit("characters:setAvatar", { characterId, path: imgPath })
	}

	function requestDelete(imgPath: string) {
		pendingDeletePath = imgPath
	}

	function confirmDelete() {
		if (!pendingDeletePath) return
		socket.emit("characters:deleteGalleryImage", {
			characterId,
			path: pendingDeletePath
		})
		pendingDeletePath = null
	}

	function cancelDelete() {
		pendingDeletePath = null
	}

	// Visible tiles (filter out broken ones)
	let visibleImages = $derived(images.filter((p) => !brokenPaths.has(p)))

	onMount(() => {
		socket.on("characters:listGallery", (msg) => {
			isLoading = false
			images = msg.images
		})

		socket.on("characters:uploadGalleryImage", (msg) => {
			isUploading = false
			if (msg.success) {
				toaster.success({ title: "Image uploaded" })
			} else {
				toaster.error({ title: "Upload failed" })
			}
		})

		socket.on("characters:uploadGalleryImage:error" as any, () => {
			isUploading = false
			toaster.error({ title: "Upload failed" })
		})

		socket.on("characters:deleteGalleryImage", () => {
			toaster.success({ title: "Image deleted" })
		})

		socket.on("characters:setAvatar", (msg) => {
			toaster.success({ title: "Avatar updated" })
			if (msg.character?.avatar) {
				currentAvatar = msg.character.avatar
				onAvatarChange?.(msg.character.avatar)
			}
		})

		socket.emit("characters:listGallery", { characterId })
	})

	onDestroy(() => {
		socket.off("characters:listGallery")
		socket.off("characters:uploadGalleryImage")
		socket.off("characters:uploadGalleryImage:error" as any)
		socket.off("characters:deleteGalleryImage")
		socket.off("characters:setAvatar")
	})
</script>

<div class="space-y-3">
	<!-- Hidden file input -->
	<input
		bind:this={fileInputEl}
		type="file"
		accept="image/*"
		class="hidden"
		onchange={handleFileChange}
	/>

	<!-- Upload row -->
	<div class="flex items-center justify-between">
		<h4 class="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
			Gallery
		</h4>
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

	{#if isLoading}
		<div class="flex items-center justify-center py-6">
			<Icons.Loader2 class="text-muted-foreground h-6 w-6 animate-spin" />
		</div>
	{:else if visibleImages.length === 0}
		<div
			class="border-surface-300-600 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-6"
		>
			<Icons.ImagePlus class="text-muted-foreground h-8 w-8" />
			<p class="text-muted-foreground text-sm">No images yet</p>
			<button
				type="button"
				class="btn btn-sm preset-tonal-primary"
				onclick={triggerUpload}
				disabled={isUploading}
			>
				Upload an image
			</button>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
			{#each visibleImages as imgPath}
				<div
					class="group relative h-24 overflow-hidden rounded-lg border-2 transition-all
						{currentAvatar === imgPath
						? 'border-primary-500 ring-primary-500 ring-2 ring-offset-1'
						: 'border-surface-300-600 hover:border-surface-400-500'}"
				>
					<button
						type="button"
						class="h-full w-full"
						onclick={() => selectAvatar(imgPath)}
						title="Set as avatar"
					>
						<img
							src={imgPath}
							alt="Gallery thumbnail"
							class="h-full w-full object-cover"
							onerror={() => handleImageError(imgPath)}
						/>
					</button>
					<!-- Delete button -->
					<button
						type="button"
						class="bg-error-500 absolute top-1 right-1 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
						onclick={(e) => {
							e.stopPropagation()
							requestDelete(imgPath)
						}}
						title="Delete this image"
					>
						<Icons.X class="h-3 w-3 text-white" />
					</button>
					{#if currentAvatar === imgPath}
						<div
							class="bg-primary-500 pointer-events-none absolute right-1 bottom-1 rounded-full p-0.5"
						>
							<Icons.Check class="h-3 w-3 text-white" />
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<Modal
	open={showDeleteModal}
	onOpenChange={(e) => { if (!e.open) cancelDelete() }}
	contentBase="card bg-surface-100-900 p-6 space-y-4 shadow-xl max-w-sm"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex items-center gap-3">
			<Icons.Trash2 class="text-error-500 h-5 w-5 shrink-0" />
			<h2 class="text-lg font-bold">Delete Image</h2>
		</header>
		{#if pendingDeletePath}
			<div class="overflow-hidden rounded-lg">
				<img
					src={pendingDeletePath}
					alt="Preview of item to delete"
					class="h-24 w-full object-cover"
				/>
			</div>
		{/if}
		<p class="text-muted-foreground text-sm">
			Are you sure you want to delete this image? This cannot be undone.
		</p>
		<footer class="flex justify-end gap-2">
			<button class="btn preset-filled-surface-400-600" onclick={cancelDelete}>
				Cancel
			</button>
			<button class="btn preset-filled-error-500" onclick={confirmDelete}>
				<Icons.Trash2 class="h-4 w-4" />
				Delete
			</button>
		</footer>
	{/snippet}
</Modal>
