<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy } from "svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		selectedPath: string | null
		opacity: number
		onchange?: (path: string | null, opacity: number) => void
	}

	let { selectedPath = $bindable(), opacity = $bindable(), onchange }: Props =
		$props()

	const socket = skio.get()

	let defaults = $state<string[]>([])
	let uploads = $state<string[]>([])
	let isLoading = $state(true)
	let isUploading = $state(false)
	let fileInputEl: HTMLInputElement

	// Track broken images so we can hide them gracefully
	let brokenPaths = $state(new Set<string>())

	// Delete confirmation
	let pendingDeletePath = $state<string | null>(null)
	let showDeleteModal = $derived(pendingDeletePath !== null)

	function handleImageError(path: string) {
		brokenPaths = new Set([...brokenPaths, path])
		// If the currently selected image is broken, clear it
		if (selectedPath === path) {
			select(null)
		}
	}

	function select(path: string | null) {
		selectedPath = path
		onchange?.(path, opacity)
	}

	function handleOpacityInput(e: Event) {
		opacity = Number((e.target as HTMLInputElement).value)
		onchange?.(selectedPath, opacity)
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
		socket.emit("userSettings:uploadBackground", {
			backgroundFile: new Uint8Array(buffer) as any,
			mimeType: file.type
		})

		// Reset input so the same file can be re-selected
		;(e.target as HTMLInputElement).value = ""
	}

	function deleteUpload(path: string) {
		pendingDeletePath = path
	}

	function confirmDelete() {
		if (!pendingDeletePath) return
		socket.emit("userSettings:deleteBackground", { path: pendingDeletePath })
		if (selectedPath === pendingDeletePath) select(null)
		pendingDeletePath = null
	}

	function cancelDelete() {
		pendingDeletePath = null
	}

	function labelFromPath(path: string): string {
		const filename = path.split("/").pop() ?? path
		const withoutExt = filename.replace(/\.[^.]+$/, "")
		// If filename has a label prefix (e.g. "rustic-pub_photographer-name-abc123")
		// use only the part before the first underscore as the display name
		const labelPart = withoutExt.includes("_")
			? withoutExt.split("_")[0]
			: withoutExt
		return labelPart
			.replace(/-/g, " ")
			.replace(/\b\w/g, (c) => c.toUpperCase())
	}

	onMount(() => {
		socket.on(
			"userSettings:listBackgrounds",
			(msg: Sockets.UserSettings.ListBackgrounds.Response) => {
				isLoading = false
				defaults = msg.defaults
				uploads = msg.uploads
			}
		)

		socket.on(
			"userSettings:uploadBackground",
			(msg: Sockets.UserSettings.UploadBackground.Response) => {
				isUploading = false
				if (msg.success) {
					toaster.success({ title: "Background uploaded" })
					// list refresh is triggered server-side after upload
				} else {
					toaster.error({ title: "Upload failed" })
				}
			}
		)

		socket.on("userSettings:uploadBackground:error", (_msg: any) => {
			isUploading = false
			toaster.error({ title: "Upload failed" })
		})

		socket.emit("userSettings:listBackgrounds", {})
	})

	onDestroy(() => {
		socket.off("userSettings:listBackgrounds")
		socket.off("userSettings:uploadBackground")
		socket.off("userSettings:uploadBackground:error")
	})

	// Visible tiles per section (filter out broken ones)
	let visibleDefaults = $derived(defaults.filter((p) => !brokenPaths.has(p)))
	let visibleUploads = $derived(uploads.filter((p) => !brokenPaths.has(p)))
</script>

<div class="space-y-4">
	<!-- Hidden file input -->
	<input
		bind:this={fileInputEl}
		type="file"
		accept="image/*"
		class="hidden"
		onchange={handleFileChange}
	/>

	{#if isLoading}
		<div class="flex items-center justify-center py-8">
			<Icons.Loader2 class="text-muted-foreground h-6 w-6 animate-spin" />
		</div>
	{:else}
		<!-- None + opacity row -->
		<div class="flex flex-wrap items-center gap-3">
			<!-- "None" tile -->
			<button
				type="button"
				class="relative h-16 w-24 overflow-hidden rounded-lg border-2 transition-all
					{selectedPath === null
					? 'border-primary-500 ring-primary-500 ring-2 ring-offset-1'
					: 'border-surface-300-600 hover:border-surface-400-500'}"
				onclick={() => select(null)}
				title="No background"
			>
				<div
					class="bg-surface-200-800 flex h-full w-full items-center justify-center"
				>
					<Icons.Ban class="text-muted-foreground h-6 w-6" />
				</div>
				{#if selectedPath === null}
					<div
						class="bg-primary-500 absolute right-1 bottom-1 rounded-full p-0.5"
					>
						<Icons.Check class="h-3 w-3 text-white" />
					</div>
				{/if}
			</button>

			<!-- Opacity slider — only when something is selected -->
			{#if selectedPath !== null}
				<div class="flex flex-1 flex-col gap-1">
					<div class="flex items-center justify-between text-sm">
						<span class="text-muted-foreground">Opacity</span>
						<span class="font-mono font-medium">{opacity}%</span>
					</div>
					<input
						type="range"
						min="10"
						max="100"
						step="5"
						value={opacity}
						oninput={handleOpacityInput}
						class="w-full"
					/>
				</div>
			{/if}
		</div>

		<!-- Defaults -->
		{#if visibleDefaults.length > 0}
			<div>
				<h4 class="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
					Defaults
				</h4>
				<div class="grid grid-cols-3 gap-2">
					{#each visibleDefaults as path}
						<button
							type="button"
							class="group relative h-16 overflow-hidden rounded-lg border-2 transition-all
								{selectedPath === path
								? 'border-primary-500 ring-primary-500 ring-2 ring-offset-1'
								: 'border-surface-300-600 hover:border-surface-400-500'}"
							onclick={() => select(path)}
							title={labelFromPath(path)}
						>
							<img
								src={path}
								alt={labelFromPath(path)}
								class="h-full w-full object-cover"
								onerror={() => handleImageError(path)}
							/>
							<div
								class="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100"
							>
								<span class="truncate text-xs text-white">
									{labelFromPath(path)}
								</span>
							</div>
							{#if selectedPath === path}
								<div
									class="bg-primary-500 absolute right-1 bottom-1 rounded-full p-0.5"
								>
									<Icons.Check class="h-3 w-3 text-white" />
								</div>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Uploads -->
		<div>
			<div class="mb-2 flex items-center justify-between">
				<h4 class="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
					My Uploads
				</h4>
				<button
					type="button"
					class="btn btn-sm preset-filled-surface-500"
					onclick={triggerUpload}
					disabled={isUploading}
					title="Upload a background image"
				>
					{#if isUploading}
						<Icons.Loader2 class="h-3 w-3 animate-spin" />
					{:else}
						<Icons.Upload class="h-3 w-3" />
					{/if}
					Upload
				</button>
			</div>

			{#if visibleUploads.length === 0}
				<div
					class="border-surface-300-600 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-6"
				>
					<Icons.ImagePlus class="text-muted-foreground h-8 w-8" />
					<p class="text-muted-foreground text-sm">No uploads yet</p>
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
				<div class="grid grid-cols-3 gap-2">
					{#each visibleUploads as path}
						<div
							class="group relative h-16 overflow-hidden rounded-lg border-2 transition-all
								{selectedPath === path
								? 'border-primary-500 ring-primary-500 ring-2 ring-offset-1'
								: 'border-surface-300-600 hover:border-surface-400-500'}"
						>
							<button
								type="button"
								class="h-full w-full"
								onclick={() => select(path)}
								title={labelFromPath(path)}
							>
								<img
									src={path}
									alt={labelFromPath(path)}
									class="h-full w-full object-cover"
									onerror={() => handleImageError(path)}
								/>
							</button>
							<!-- Delete button -->
							<button
								type="button"
								class="bg-error-500 absolute top-1 right-1 rounded-full p-0.5 max-lg:opacity-100 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100"
								onclick={(e) => {
									e.stopPropagation()
									deleteUpload(path)
								}}
								title="Delete this background"
							>
								<Icons.X class="h-3 w-3 text-white" />
							</button>
							{#if selectedPath === path}
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
	{/if}
</div>

<Dialog
	open={showDeleteModal}
	onOpenChange={(e) => { if (!e.open) cancelDelete() }}
>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 space-y-4 shadow-xl max-w-sm">
				<header class="flex items-center gap-3">
					<Icons.Trash2 class="text-error-500 h-5 w-5 shrink-0" />
					<h2 class="text-lg font-bold">Delete Background</h2>
				</header>
				{#if pendingDeletePath}
					<div class="overflow-hidden rounded-lg">
						<img
							src={pendingDeletePath}
							alt="Background to delete"
							class="h-24 w-full object-cover"
						/>
					</div>
				{/if}
				<p class="text-muted-foreground text-sm">
					Are you sure you want to delete this background? This cannot be undone.
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
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
