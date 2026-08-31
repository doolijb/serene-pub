<!--
	Media management (28) — every blob this user owns, in one place.

	This replaced the Settings sidebar's System tab. System settings are
	instance-wide and belong on /admin/settings, which already rendered the same
	`SystemSettingsTab` component; media is per-user and had nowhere to live at
	all, so the swap gives each one the surface it actually wants.

	Responsive by construction rather than by breakpoint: the grid is
	`auto-fill / minmax`, so the same component fills a 320px sidebar, an
	expanded panel and a mobile sheet without a single media query. See
	PersonasSidebar's matching grid for why the codebase settled on this over
	named container breakpoints — a panel's pixel width does not track the
	viewport's, and a capped column count leaves oversized cards on a 4K
	fullscreen panel.
-->
<script lang="ts">
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { fade } from "svelte/transition"
	import { flip } from "svelte/animate"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import PanelToolbar from "$lib/client/components/panels/PanelToolbar.svelte"
	import EntityGalleryViewModal from "$lib/client/components/sessionMessages/EntityGalleryViewModal.svelte"
	import {
		MediaVisibility,
		MediaVisibilityLabels
	} from "$lib/shared/constants/MediaVisibility"

	const socket = useTypedSocket()

	type Item = Sockets.ManagedMedia

	let items = $state<Item[]>([])
	let totalBytes = $state(0)
	let isLoading = $state(true)
	let search = $state("")
	let kind = $state<"all" | "image" | "document">("all")
	let sort = $state<"newest" | "oldest" | "largest" | "smallest" | "name">(
		"newest"
	)
	let viewMode = $state<"grid" | "list">("grid")
	let menuOpenFor = $state<number | null>(null)
	let busyId = $state<number | null>(null)
	let brokenIds = $state(new Set<number>())

	let lightboxOpen = $state(false)
	let lightboxSrc = $state<string | null>(null)
	let pendingDeleteId = $state<number | null>(null)
	let pendingDelete = $derived(
		items.find((i) => i.id === pendingDeleteId) ?? null
	)

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
		return `${(n / (1024 * 1024)).toFixed(1)} MB`
	}

	/** Compact enough for a 140px tile caption: "30 Aug" within this year,
	 *  "30 Aug 2025" outside it — the year only earns its space when it
	 *  actually disambiguates. */
	function shortDate(iso: string): string {
		const d = new Date(iso)
		if (Number.isNaN(d.getTime())) return ""
		const sameYear = d.getFullYear() === new Date().getFullYear()
		return d.toLocaleDateString(undefined, {
			day: "numeric",
			month: "short",
			...(sameYear ? {} : { year: "numeric" })
		})
	}

	/** The unabbreviated form, for the menu header and hover tooltips. */
	function fullDate(iso: string): string {
		const d = new Date(iso)
		if (Number.isNaN(d.getTime())) return ""
		return d.toLocaleString(undefined, {
			dateStyle: "medium",
			timeStyle: "short"
		})
	}

	/** Everything about an item, for the tile's hover title — the grid caption
	 *  only has room for two lines, so this is where the rest lives. */
	function tooltip(item: Item): string {
		return [
			displayName(item),
			formatBytes(item.bytes),
			item.width && item.height ? `${item.width}×${item.height}` : null,
			fullDate(item.createdAt),
			item.attachedTo
				? (item.attachedTo.name ?? "orphaned — parent deleted")
				: null
		]
			.filter(Boolean)
			.join(" · ")
	}

	function displayName(item: Item): string {
		// The on-disk name is a hash, so a row with no uploader filename has
		// no natural name — fall back to what it is attached to, then the id.
		return (
			item.filename ??
			(item.attachedTo?.name ? `${item.attachedTo.name} image` : null) ??
			`Image #${item.id}`
		)
	}

	/** Client-side because it is a substring match over a list already in
	 *  memory; a round trip per keystroke would be slower and no more
	 *  correct. Sorting stays on the server, where the whole set lives. */
	let filtered = $derived(
		items.filter((item) => {
			const q = search.trim().toLowerCase()
			if (!q) return true
			return (
				displayName(item).toLowerCase().includes(q) ||
				(item.attachedTo?.name ?? "").toLowerCase().includes(q)
			)
		})
	)

	let missingThumbs = $derived(
		items.filter((i) => i.kind === "image" && !i.hasThumbnail).length
	)

	function refresh() {
		socket.emit("media:list", {
			sort,
			kind: kind === "all" ? undefined : kind
		})
	}

	// Re-query the server whenever a server-side control changes. Search is
	// deliberately absent from this list — see `filtered`.
	$effect(() => {
		void sort
		void kind
		refresh()
	})

	function openLightbox(item: Item) {
		// The ORIGINAL, never the thumbnail: this is the "show me the actual
		// image" affordance.
		lightboxSrc = item.url
		lightboxOpen = true
	}

	function download(item: Item) {
		menuOpenFor = null
		// `?download=1` always serves the original and sets an attachment
		// disposition; the anchor is created rather than rendered so the
		// filename attribute cannot fight the server's Content-Disposition.
		const a = document.createElement("a")
		a.href = `${item.url}?download=1`
		a.rel = "noopener"
		document.body.appendChild(a)
		a.click()
		a.remove()
	}

	function regenerate(item: Item) {
		menuOpenFor = null
		busyId = item.id
		socket.emit("media:regenerateThumbnail", { mediaId: item.id })
	}

	function toggleVisibility(item: Item) {
		menuOpenFor = null
		socket.emit("media:setVisibility", {
			mediaId: item.id,
			visibility:
				item.visibility === MediaVisibility.PRIVATE
					? MediaVisibility.SCOPED
					: MediaVisibility.PRIVATE
		})
	}

	function requestDelete(item: Item) {
		menuOpenFor = null
		pendingDeleteId = item.id
	}

	function confirmDelete() {
		if (pendingDeleteId === null) return
		socket.emit("media:delete", { mediaId: pendingDeleteId })
		pendingDeleteId = null
	}

	onMount(() => {
		const onList = (res: Sockets.Media.List.Response) => {
			items = res.media
			totalBytes = res.totalBytes
			isLoading = false
			busyId = null
			// A regenerated thumbnail is a new row behind the same
			// `?v=thumb` URL, so anything previously marked broken deserves
			// another chance.
			brokenIds = new Set()
		}
		const onRegen = (
			res: Sockets.Media.RegenerateThumbnail.Response
		) => {
			busyId = null
			toaster.success({
				title: res.regenerated
					? "Thumbnail regenerated"
					: "Already at full size — the original is served"
			})
		}
		const onDelete = () => toaster.success({ title: "Image deleted" })
		const onError = (e: any) =>
			toaster.error({ title: e?.error ?? "Something went wrong" })

		socket.on("media:list", onList)
		socket.on("media:regenerateThumbnail", onRegen)
		socket.on("media:delete", onDelete)
		socket.on("media:list:error" as any, onError)
		socket.on("media:regenerateThumbnail:error" as any, onError)
		socket.on("media:delete:error" as any, onError)
		socket.on("media:setVisibility:error" as any, onError)

		return () => {
			socket.off("media:list", onList)
			socket.off("media:regenerateThumbnail", onRegen)
			socket.off("media:delete", onDelete)
			socket.off("media:list:error" as any, onError)
			socket.off("media:regenerateThumbnail:error" as any, onError)
			socket.off("media:delete:error" as any, onError)
			socket.off("media:setVisibility:error" as any, onError)
		}
	})
</script>

{#snippet itemMenu(item: Item)}
	<Popover
		open={menuOpenFor === item.id}
		onOpenChange={(e) => (menuOpenFor = e.open ? item.id : null)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class="bg-surface-950/60 hover:bg-primary-600-400 rounded-full p-1 text-white"
			aria-label="Image options for {displayName(item)}"
		>
			<Icons.EllipsisVertical size={14} aria-hidden="true" />
		</Popover.Trigger>
		<!-- Portalled, and z-[1000] to clear the panel: the tile that owns this
		     trigger sets `overflow-hidden` so the thumbnail can have rounded
		     corners, which clips any popover rendered inside it. Same pattern
		     as EntityGalleryTab and PanelNavHeader. -->
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-100-900 border-surface-300-700 w-[min(90vw,240px)] space-y-2 border p-3 shadow-xl"
				>
					<header class="space-y-1">
						<div class="flex items-center gap-2">
							<Icons.Image size={16} aria-hidden="true" />
							<p class="truncate text-sm font-semibold">
								{displayName(item)}
							</p>
						</div>
						<p class="text-surface-600-400 text-xs">
							{fullDate(item.createdAt)}
							{#if item.width && item.height}
								· {item.width}×{item.height}
							{/if}
						</p>
					</header>
					<article class="flex flex-col gap-1">
						<button
							type="button"
							class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
							onclick={() => download(item)}
						>
							<Icons.Download size={16} aria-hidden="true" />
							<span>Download original</span>
						</button>
						{#if item.kind === "image"}
							<button
								type="button"
								class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
								onclick={() => regenerate(item)}
								disabled={busyId === item.id}
							>
								<Icons.RefreshCw size={16} aria-hidden="true" />
								<span>Regenerate thumbnail</span>
							</button>
						{/if}
						<button
							type="button"
							class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
							onclick={() => toggleVisibility(item)}
						>
							{#if item.visibility === MediaVisibility.PRIVATE}
								<Icons.Users size={16} aria-hidden="true" />
								<span>Make scoped</span>
							{:else}
								<Icons.Lock size={16} aria-hidden="true" />
								<span>Make private</span>
							{/if}
						</button>
						<button
							type="button"
							class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
							onclick={() => requestDelete(item)}
						>
							<Icons.Trash2 size={16} aria-hidden="true" />
							<span>Delete</span>
						</button>
					</article>
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{/snippet}

<div class="flex flex-col gap-3">
	<PanelToolbar label="Media filters">
		<label for="media-search" class="sr-only">Search media</label>
		<input
			id="media-search"
			type="text"
			placeholder="Search"
			class="input min-w-0 flex-1"
			bind:value={search}
			aria-label="Search media by name or what it belongs to"
		/>
		<div class="flex shrink-0 gap-1" role="group" aria-label="View mode">
			<button
				type="button"
				class="btn btn-sm p-2 {viewMode === 'grid'
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				onclick={() => (viewMode = "grid")}
				title="Grid view"
				aria-label="Grid view"
				aria-pressed={viewMode === "grid"}
			>
				<Icons.LayoutGrid size={16} aria-hidden="true" />
			</button>
			<button
				type="button"
				class="btn btn-sm p-2 {viewMode === 'list'
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				onclick={() => (viewMode = "list")}
				title="List view"
				aria-label="List view"
				aria-pressed={viewMode === "list"}
			>
				<Icons.List size={16} aria-hidden="true" />
			</button>
		</div>
	</PanelToolbar>

	<!-- max-w caps only bind once there is room to spare: in a 320px sidebar
	     and on mobile the controls still share the row via flex-1, but in a
	     fullscreen panel they stop stretching to 700px each. -->
	<div class="flex flex-wrap gap-2">
		<label class="sr-only" for="media-sort">Sort media</label>
		<select
			id="media-sort"
			class="select min-w-0 flex-1 basis-36 sm:max-w-[220px]"
			bind:value={sort}
		>
			<option value="newest">Newest first</option>
			<option value="oldest">Oldest first</option>
			<option value="largest">Largest first</option>
			<option value="smallest">Smallest first</option>
			<option value="name">Name (A–Z)</option>
		</select>
		<label class="sr-only" for="media-kind">Filter by type</label>
		<select
			id="media-kind"
			class="select min-w-0 flex-1 basis-32 sm:max-w-[200px]"
			bind:value={kind}
		>
			<option value="all">All types</option>
			<option value="image">Images</option>
			<option value="document">Documents</option>
		</select>
	</div>

	<p class="text-surface-600-400 text-xs">
		{filtered.length} of {items.length}
		{items.length === 1 ? "item" : "items"} · {formatBytes(totalBytes)}
		{#if missingThumbs > 0}
			· <span class="text-warning-600-400">
				{missingThumbs} without a thumbnail
			</span>
		{/if}
	</p>

	{#if isLoading}
		<div class="flex items-center justify-center py-8">
			<Icons.Loader2 class="text-surface-600-400 h-6 w-6 animate-spin" />
		</div>
	{:else if filtered.length === 0}
		<div
			class="border-surface-300-600 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-8"
		>
			<Icons.ImageOff class="text-surface-600-400 h-8 w-8" />
			<p class="text-surface-600-400 text-sm">
				{items.length === 0
					? "No media yet. Images uploaded to characters, personas and sessions appear here."
					: "Nothing matches that search."}
			</p>
		</div>
	{:else if viewMode === "grid"}
		<div
			class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2"
			role="list"
			aria-label="Media"
		>
			{#each filtered as item (item.id)}
				<div
					role="listitem"
					class="group border-surface-300-600 relative overflow-hidden rounded-lg border"
					animate:flip={{ duration: 150 }}
					out:fade={{ duration: 120 }}
				>
					<button
						type="button"
						class="block aspect-square w-full"
						onclick={() => openLightbox(item)}
						title={tooltip(item)}
					>
						{#if item.kind === "image" && !brokenIds.has(item.id)}
							<img
								src={item.thumbUrl}
								alt={displayName(item)}
								class="h-full w-full object-cover"
								loading="lazy"
								onerror={() =>
									(brokenIds = new Set([
										...brokenIds,
										item.id
									]))}
							/>
						{:else}
							<span
								class="bg-surface-200-800 text-surface-600-400 flex h-full w-full items-center justify-center"
							>
								{#if item.kind === "document"}
									<Icons.FileText size={28} />
								{:else}
									<Icons.ImageOff size={28} />
								{/if}
							</span>
						{/if}
					</button>

					<div class="absolute top-1 right-1">
						{@render itemMenu(item)}
					</div>

					{#if busyId === item.id}
						<span
							class="bg-surface-950/60 absolute inset-0 flex items-center justify-center"
						>
							<Icons.Loader2
								class="h-6 w-6 animate-spin text-white"
							/>
						</span>
					{/if}

					{#if item.visibility === MediaVisibility.PRIVATE}
						<span
							class="bg-surface-950/60 absolute top-1 left-1 rounded-full p-1 text-white"
							title="Private — only you can see this"
						>
							<Icons.Lock size={12} aria-hidden="true" />
						</span>
					{/if}

					<div
						class="bg-surface-100-900/90 absolute right-0 bottom-0 left-0 px-1.5 py-1"
					>
						<p class="truncate text-[11px] font-medium">
							{displayName(item)}
						</p>
						<p class="text-surface-600-400 truncate text-[10px]">
							{formatBytes(item.bytes)} · {shortDate(
								item.createdAt
							)}
						</p>
						{#if item.attachedTo}
							<p
								class="text-surface-600-400 truncate text-[10px]"
							>
								{item.attachedTo.name ?? "orphaned"}
							</p>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col gap-1" role="list" aria-label="Media">
			{#each filtered as item (item.id)}
				<div
					role="listitem"
					class="border-surface-300-600 flex items-center gap-2 rounded-lg border p-1.5"
					animate:flip={{ duration: 150 }}
					out:fade={{ duration: 120 }}
				>
					<button
						type="button"
						class="bg-surface-200-800 h-12 w-12 shrink-0 overflow-hidden rounded"
						onclick={() => openLightbox(item)}
						title={tooltip(item)}
					>
						{#if item.kind === "image" && !brokenIds.has(item.id)}
							<img
								src={item.thumbUrl}
								alt={displayName(item)}
								class="h-full w-full object-cover"
								loading="lazy"
								onerror={() =>
									(brokenIds = new Set([
										...brokenIds,
										item.id
									]))}
							/>
						{:else}
							<span
								class="text-surface-600-400 flex h-full w-full items-center justify-center"
							>
								<Icons.FileText size={18} />
							</span>
						{/if}
					</button>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">
							{displayName(item)}
						</p>
						<p class="text-surface-600-400 truncate text-xs">
							{formatBytes(item.bytes)}
							{#if item.width && item.height}
								· {item.width}×{item.height}
							{/if}
							· <span title={fullDate(item.createdAt)}>
								{shortDate(item.createdAt)}
							</span>
							{#if item.attachedTo}
								· {item.attachedTo.name ?? "orphaned"}
							{/if}
							{#if !item.hasThumbnail && item.kind === "image"}
								· <span class="text-warning-600-400">
									no thumbnail
								</span>
							{/if}
						</p>
					</div>
					{#if item.visibility === MediaVisibility.PRIVATE}
						<Icons.Lock
							size={14}
							class="text-surface-600-400 shrink-0"
							aria-label={MediaVisibilityLabels.private}
						/>
					{/if}
					{#if busyId === item.id}
						<Icons.Loader2
							class="text-surface-600-400 h-4 w-4 shrink-0 animate-spin"
						/>
					{/if}
					<div class="shrink-0">{@render itemMenu(item)}</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<EntityGalleryViewModal
	bind:open={lightboxOpen}
	onOpenChange={(e) => (lightboxOpen = e.open)}
	image={lightboxSrc}
/>

<Dialog
	open={pendingDeleteId !== null}
	onOpenChange={(e) => {
		if (!e.open) pendingDeleteId = null
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
					<h2 class="text-lg font-bold">Delete image</h2>
				</header>
				{#if pendingDelete}
					{#if pendingDelete.kind === "image"}
						<div class="overflow-hidden rounded-lg">
							<img
								src={pendingDelete.thumbUrl}
								alt="Preview of the image to delete"
								class="h-24 w-full object-cover"
							/>
						</div>
					{/if}
					<p class="text-surface-700-300 text-sm">
						Delete <strong>{displayName(pendingDelete)}</strong>?
						{#if pendingDelete.attachedTo?.name}
							It belongs to
							<strong>{pendingDelete.attachedTo.name}</strong>.
						{/if}
					</p>
					<p class="text-surface-600-400 text-xs">
						Anything using it — an avatar, a gallery entry, a
						background — will lose it. This cannot be undone.
					</p>
				{/if}
				<footer class="flex justify-end gap-2">
					<button
						class="btn preset-filled-surface-400-600"
						onclick={() => (pendingDeleteId = null)}
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
