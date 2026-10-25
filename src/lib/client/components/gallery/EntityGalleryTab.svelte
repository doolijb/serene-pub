<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import { dragHandleZone, dragHandle } from "svelte-dnd-action"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import EntityGalleryViewModal from "$lib/client/components/gallery/EntityGalleryViewModal.svelte"
	import GeneratePortraitDialog from "$lib/client/components/gallery/GeneratePortraitDialog.svelte"
	import { getContext } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { v4 as uuidv4 } from "uuid"
	import { statusText as statusTextOf } from "$lib/client/i18n/state.svelte"
	import type { StatusText } from "@serene-pub/sdk"

	interface Props {
		/**
		 * The gallery is a CHARACTER's. It had a second `entityType` branch for
		 * personas; a persona is a character now, so the branch was a second
		 * socket family for one row and it is gone rather than made optional.
		 */
		entityId: number
		entityName: string
		isOwner: boolean
		/** The media id of the entity's current avatar, so "which tile is the
		 *  avatar" is an id comparison rather than a URL string match — the
		 *  latter broke the moment the two sides built the URL differently
		 *  (thumb vs original). */
		currentAvatarMediaId: number | null
	}

	let { entityId, entityName, isOwner, currentAvatarMediaId }: Props =
		$props()

	const socket = useTypedSocket()

	// Media rows, not paths (28): the id is the identity, so a reorder, a
	// rename or a re-upload of identical bytes can no longer desync this list
	// from what the server has.
	let images = $state<Sockets.Media[]>([])
	let isLoading = $state(true)
	let isUploading = $state(false)
	let fileInputEl = $state<HTMLInputElement>()
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
		socket.emit("characters:uploadGalleryImage", {
			characterId: entityId,
			imageFile: new Uint8Array(buffer) as any,
			mimeType: file.type
		})
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
		socket.emit("characters:setAvatar", {
			characterId: entityId,
			mediaId
		})
	}

	function requestDelete(id: number) {
		menuOpenFor = null
		pendingDeleteId = id
	}

	function confirmDelete() {
		if (pendingDeleteId === null) return
		socket.emit("characters:deleteGalleryImage", {
			characterId: entityId,
			mediaId: pendingDeleteId
		})
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
		socket.emit("characters:reorderGallery", {
			characterId: entityId,
			mediaIds
		})
	}

	// ── Generate portrait (DESIGN-image-generation §6.2; I8) ─────────────
	/**
	 * The card's owner or an admin may draw its portrait (the server checks
	 * again). The pictures land as gallery tiles; *Set as avatar* and *Use as
	 * likeness image* on a tile are the owner's, like every edit of the card.
	 */
	const userCtx = (() => {
		try {
			return getContext<{ user?: { isAdmin?: boolean } } | undefined>("userCtx")
		} catch {
			return undefined
		}
	})()
	let canGenerate = $derived(isOwner || !!userCtx?.user?.isAdmin)

	let portraitOpen = $state(false)
	let portraitPreview = $state<Sockets.Characters.PreviewPortrait.Response | null>(null)
	let portraitPreviewing = $state(false)
	interface PortraitRun {
		runId: string
		count: number
		phase: Sockets.Characters.Portrait.Progress["phase"] | "starting"
		status: string
		percent: number | null
		error: string | null
		offered: number
	}
	let portraitRun = $state<PortraitRun | null>(null)
	let portraitRunning = $derived(
		!!portraitRun && portraitRun.phase !== "done" && portraitRun.phase !== "failed"
	)
	/** The pictures the last portrait run added — marked *New* on their tiles. */
	const newIds = new SvelteSet<number>()

	function requestPortraitPreview(count: number, style: "tags" | "prose") {
		portraitPreviewing = true
		socket.emit("characters:previewPortrait", { characterId: entityId, count, style })
	}
	function handlePortraitPreview(msg: Sockets.Characters.PreviewPortrait.Response) {
		if (!matchesEntity(msg)) return
		portraitPreviewing = false
		portraitPreview = msg
	}
	function handlePortraitPreviewError(msg: { error?: string; characterId?: number }) {
		if (!matchesEntity(msg)) return
		portraitPreviewing = false
		portraitPreview = portraitPreview
			? { ...portraitPreview, refusal: msg.error ?? "Could not prepare the portrait." }
			: null
	}
	function generatePortrait(count: number, style: "tags" | "prose") {
		portraitOpen = false
		const runId = uuidv4()
		newIds.clear()
		portraitRun = {
			runId,
			count,
			phase: "starting",
			status: "",
			percent: null,
			error: null,
			offered: 0
		}
		socket.emit("characters:generatePortrait", {
			characterId: entityId,
			count,
			style,
			runId
		})
	}
	function handlePortraitProgress(msg: Sockets.Characters.Portrait.Progress) {
		if (!matchesEntity(msg) || !portraitRun || msg.runId !== portraitRun.runId) return
		portraitRun.phase = msg.phase
		if (msg.status) portraitRun.status = statusTextOf(msg.status as StatusText)
		else if (msg.phase === "offering") portraitRun.status = "Adding them to the gallery…"
		if (msg.percent != null) portraitRun.percent = msg.percent
		if (msg.phase === "done") {
			for (const o of msg.offered ?? []) newIds.add(o.mediaId)
			portraitRun.offered = msg.offered?.length ?? 0
			portraitRun.percent = null
		}
		if (msg.phase === "failed") {
			portraitRun.error = msg.error ?? "The portrait stopped."
			portraitRun.status = ""
		}
	}
	function handlePortraitError(msg: { error?: string; characterId?: number }) {
		if (!matchesEntity(msg) || !portraitRun) return
		portraitRun.phase = "failed"
		portraitRun.error = msg.error ?? "The portrait did not start."
	}
	function stopPortrait() {
		if (portraitRun) socket.emit("pipelines:cancelRun", { runId: portraitRun.runId })
	}

	function useAsLikeness(mediaId: number) {
		menuOpenFor = null
		socket.emit("characters:setLikenessImage", { characterId: entityId, mediaId })
	}
	function handleLikenessOk(msg: { characterId?: number }) {
		if (!matchesEntity(msg)) return
		toaster.success({ title: "Likeness image updated" })
	}
	function handleLikenessErr(msg: { error?: string; characterId?: number }) {
		if (!matchesEntity(msg)) return
		toaster.error({ title: msg.error ?? "Could not set the likeness image." })
	}

	function matchesEntity(msg: { characterId?: number }) {
		return msg.characterId === entityId
	}

	function handleList(msg: {
		images: Sockets.Media[]
		characterId?: number
	}) {
		if (!matchesEntity(msg)) return
		isLoading = false
		images = msg.images
	}
	function handleUploadOk(msg: { success: boolean; characterId?: number }) {
		if (!matchesEntity(msg)) return
		isUploading = false
		if (msg.success) toaster.success({ title: "Image uploaded" })
		else toaster.error({ title: "Upload failed" })
	}
	function handleUploadErr(msg: { characterId?: number }) {
		if (!matchesEntity(msg)) return
		isUploading = false
		toaster.error({ title: "Upload failed" })
	}
	function handleDeleteOk(msg: { characterId?: number }) {
		if (!matchesEntity(msg)) return
		toaster.success({ title: "Image deleted" })
	}
	function handleSetAvatarOk(msg: { character?: { id: number } }) {
		if (msg.character?.id !== entityId) return
		toaster.success({ title: "Avatar updated" })
	}

	/**
	 * This gallery's five replies, declared and asked for in one effect so a
	 * tab re-pointed at another character releases the old keys as it takes the
	 * new ones — the `useInterest` form reads its key once and would keep the
	 * first id.
	 *
	 * All five are STANDING, not one-shot: `listGallery` is re-sent after an
	 * upload, a delete and a reorder, and `setAvatar` is an `emitToUser` push
	 * another tab's "Set as Avatar" provokes.
	 *
	 * Scoped where the shared `SCOPED_EVENTS` table says the payload carries
	 * the id — `listGallery`, `uploadGalleryImage` and `deleteGalleryImage`
	 * (`characterId`). The `:error` twins and `setAvatar` are NOT in that
	 * table, so they stay BARE: a scoped key for an event the table does not
	 * know would match nothing at all. `matchesEntity` is what filters those,
	 * exactly as before.
	 */
	$effect(() => {
		const id = entityId
		const releases: (() => void)[] = [
			declareInterest<"characters:listGallery">(
				interestKey("characters:listGallery", id),
				handleList
			),
			declareInterest<"characters:uploadGalleryImage">(
				interestKey("characters:uploadGalleryImage", id),
				handleUploadOk
			),
			// `characters:uploadGalleryImage:error` is missing from
			// `SocketEventMap`, hence the `any` — the cast the raw
			// `socket.on` needed, moved onto the registry call.
			declareInterest<any>(
				"characters:uploadGalleryImage:error",
				handleUploadErr
			),
			declareInterest<"characters:deleteGalleryImage">(
				interestKey("characters:deleteGalleryImage", id),
				handleDeleteOk
			),
			declareInterest<"characters:setAvatar">(
				"characters:setAvatar",
				handleSetAvatarOk
			),
			// 🚧 Generate portrait (I8): the preview, the run's pushes and the
			// likeness pick are SCOPED on characterId; the `:error` twins are
			// bare and filtered by `matchesEntity`.
			declareInterest<any>(
				interestKey("characters:previewPortrait", id),
				handlePortraitPreview
			),
			declareInterest<any>(
				interestKey("characters:portrait", id),
				handlePortraitProgress
			),
			declareInterest<any>(
				interestKey("characters:setLikenessImage", id),
				handleLikenessOk
			),
			declareInterest<any>(
				"characters:previewPortrait:error",
				handlePortraitPreviewError
			),
			declareInterest<any>("characters:generatePortrait:error", handlePortraitError),
			declareInterest<any>("characters:setLikenessImage:error", handleLikenessErr)
		]
		socket.emit("characters:listGallery", { characterId: id })
		return () => {
			for (const release of releases) release()
		}
	})
</script>

<div class="space-y-3">
	{#if isOwner || canGenerate}
		{#if isOwner}
			<input
				bind:this={fileInputEl}
				type="file"
				accept="image/*"
				class="hidden"
				onchange={handleFileChange}
			/>
		{/if}
		<div class="flex flex-wrap items-center justify-end gap-2">
			{#if canGenerate}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => (portraitOpen = true)}
					disabled={portraitRunning}
					title="Draw a few pictures of this character to choose from"
				>
					<Icons.WandSparkles class="h-3 w-3" aria-hidden="true" />
					Generate portrait
				</button>
			{/if}
			{#if isOwner}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
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
			{/if}
		</div>
	{/if}

	{#if portraitRun}
		<div
			class="bg-surface-200-800 flex items-start gap-2 rounded-lg p-2 text-sm"
			aria-live="polite"
			data-testid="portrait-run"
		>
			{#if portraitRunning}
				<Icons.Loader2 class="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
				<div class="min-w-0 flex-1">
					<p>
						Drawing {portraitRun.count}
						{portraitRun.count === 1 ? "picture" : "pictures"}{portraitRun.percent != null
							? ` · ${Math.round(portraitRun.percent)}%`
							: ""}
					</p>
					{#if portraitRun.status}
						<p class="text-surface-600-400 text-xs">{portraitRun.status}</p>
					{/if}
				</div>
				<button type="button" class="btn btn-sm preset-tonal-surface" onclick={stopPortrait}>
					Stop
				</button>
			{:else if portraitRun.phase === "failed"}
				<Icons.CircleAlert class="text-error-600-400 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
				<p class="text-error-600-400 min-w-0 flex-1" role="alert">{portraitRun.error}</p>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => (portraitRun = null)}
				>
					Dismiss
				</button>
			{:else}
				<Icons.Check class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
				<p class="min-w-0 flex-1">
					{portraitRun.offered}
					{portraitRun.offered === 1 ? "new picture" : "new pictures"} below.
					{#if isOwner}Open a picture's menu to use it as the avatar.{/if}
				</p>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => (portraitRun = null)}
				>
					Dismiss
				</button>
			{/if}
		</div>
	{/if}

	{#if isLoading}
		<div class="flex items-center justify-center py-6">
			<Icons.Loader2 class="text-surface-600-400 h-6 w-6 animate-spin" />
		</div>
	{:else if tiles.length === 0}
		<div
			class="border-surface-300-700 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-6"
		>
			<Icons.ImagePlus class="text-surface-600-400 h-8 w-8" />
			<p class="text-surface-600-400 text-sm">No images yet</p>
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
			class="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2"
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
						: 'border-surface-200-800 hover:border-surface-400-600'}"
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
							<RowMenu
								label="Image"
								triggerLabel="More actions for this image"
								width={200}
								triggerClass="bg-surface-950/60 hover:bg-surface-950/80 rounded-full p-0.5 text-white"
								bind:open={
									() => menuOpenFor === tile.id,
									(v) => (menuOpenFor = v ? tile.id : null)
								}
								items={[
									currentAvatarMediaId !== tile.id && {
										label: "Set as avatar",
										icon: Icons.Star,
										onSelect: () => setAsAvatar(tile.id)
									},
									{
										label: "Use as likeness image",
										icon: Icons.ScanFace,
										onSelect: () => useAsLikeness(tile.id)
									},
									{
										label: "Delete",
										icon: Icons.Trash2,
										destructive: true,
										onSelect: () => requestDelete(tile.id)
									}
								]}
							>
								{#snippet trigger()}
									<Icons.EllipsisVertical
										class="h-3 w-3"
										aria-hidden="true"
									/>
								{/snippet}
							</RowMenu>
						</div>
					{/if}

					{#if newIds.has(tile.id)}
						<span
							class="bg-surface-950/70 pointer-events-none absolute bottom-1 left-1 rounded-full px-1.5 text-meta font-semibold text-white"
							data-testid="gallery-new-badge"
						>
							New
						</span>
					{/if}

					{#if currentAvatarMediaId === tile.id}
						<div
							class="preset-filled-primary-500 pointer-events-none absolute right-1 bottom-1 rounded-full p-0.5"
							title="Current avatar"
						>
							<Icons.Check class="h-3 w-3" aria-hidden="true" />
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
					<Icons.Trash2 class="text-error-600-400 h-5 w-5 shrink-0" />
					<h2 class="text-lg font-bold">Delete image</h2>
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
				<p class="text-surface-600-400 text-sm">
					Are you sure you want to delete this image? This cannot be
					undone.
				</p>
				<footer class="flex justify-end gap-2">
					<button
						class="btn preset-tonal-surface"
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

<GeneratePortraitDialog
	bind:open={portraitOpen}
	characterName={entityName}
	preview={portraitPreview}
	previewing={portraitPreviewing}
	running={portraitRunning}
	onPreview={requestPortraitPreview}
	onGenerate={generatePortrait}
/>

<EntityGalleryViewModal
	bind:open={lightboxOpen}
	onOpenChange={(e) => (lightboxOpen = e.open)}
	entity={{
		type: "character",
		id: entityId,
		name: entityName,
		avatar: lightboxPath
	}}
/>
