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
	import { SvelteMap } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { fade } from "svelte/transition"
	import { flip } from "svelte/animate"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import PanelToolbar from "$lib/client/components/panels/PanelToolbar.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import EntityGalleryViewModal from "$lib/client/components/sessionMessages/EntityGalleryViewModal.svelte"
	import AvatarCropEditor from "./AvatarCropEditor.svelte"
	import type { MediaFrame } from "$lib/shared/media/frame"
	import {
		MediaVisibility,
		MediaVisibilityLabels
	} from "$lib/shared/constants/MediaVisibility"
	import { CULL_ORIGINALS_CONFIRM } from "$lib/shared/constants/MediaCleanup"

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
	// Orphan-ness is a server fact now (`item.orphaned`), so this filter is
	// client-side like the search: it partitions a list already in memory, and
	// a round trip would only make the counts beside it disagree.
	let orphanedOnly = $state(false)
	let viewMode = $state<"grid" | "list">("grid")
	let menuOpenFor = $state<number | null>(null)
	let busyId = $state<number | null>(null)
	let brokenIds = $state(new Set<number>())
	/** The image whose crop is being edited, or null. Held until the editor
	 *  reports the close, which is the only time it is safe to drop. */
	let cropping = $state<Item | null>(null)
	let cropOpen = $state(false)

	/**
	 * Which pipeline runs made this image, keyed by file id.
	 *
	 * ⚠ **Fetched when a detail popover opens, never per tile.** The list is a
	 * hundred thumbnails and this is one question about one of them; asking it
	 * for every row would be a hundred round trips to fill a line most of them
	 * do not have. An entry is written *before* the ask, so re-opening a
	 * popover mid-flight does not ask twice, and an empty array reads the same
	 * as an unanswered one — both render nothing, which is exactly what an
	 * uploaded image should show.
	 *
	 * `SvelteMap` rather than `$state(new Map())`: a plain Map's `.set()` is
	 * not reactive, so the line would arrive and never render.
	 */
	let artifactRuns = new SvelteMap<
		number,
		Sockets.Pipelines.ArtifactRuns.Run[]
	>()

	/** The newest few, which is all a popover has room to link. The count on
	 *  the label above them is the real total. */
	const runsFor = (item: Item) => artifactRuns.get(item.id) ?? []

	/**
	 * Where a run's receipt actually lives.
	 *
	 * `?tab=runs` is the workspace's own deep link and `?run=` is read by
	 * `RunsPanel`, which fetches by run id — so this lands on the receipt
	 * itself rather than on a list the reader then has to search.
	 */
	const runHref = (r: Sockets.Pipelines.ArtifactRuns.Run) =>
		`/admin/pipelines/${encodeURIComponent(r.specSlug)}` +
		`?tab=runs&run=${encodeURIComponent(r.runId)}`

	function loadRuns(item: Item) {
		if (artifactRuns.has(item.id)) return
		artifactRuns.set(item.id, [])
		socket.emit("pipelines:artifactRuns", {
			kind: "file",
			entityId: item.id
		})
	}

	// Storage cleanup (0182). Collapsed and unpriced until asked for: the
	// preview is a full pass over this user's variant rows, and nobody opening
	// a media panel to look at their pictures asked for it.
	let cleanupOpen = $state(false)
	let cleanup = $state<Sockets.Media.CleanupPreview.Response | null>(null)
	let cleanupBusy = $state(false)
	let cullOriginalsOpen = $state(false)
	let cullConfirm = $state("")

	let lightboxOpen = $state(false)
	let lightboxSrc = $state<string | null>(null)
	let pendingDeleteId = $state<number | null>(null)
	let pendingDelete = $derived(
		items.find((i) => i.id === pendingDeleteId) ?? null
	)
	/** Ticked to unlock the delete of a file some messages render. Reset every
	 *  time the dialog opens, so an acknowledgement never carries over to the
	 *  next file. */
	let ackMessageRefs = $state(false)

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
			// Only when the two differ, which is only once something has been
			// derived — otherwise it reads as the same number twice.
			item.storedBytes !== item.bytes
				? `${formatBytes(item.storedBytes)} on disk`
				: null,
			item.width && item.height ? `${item.width}×${item.height}` : null,
			fullDate(item.createdAt),
			item.orphaned
				? "orphaned — parent deleted"
				: (item.attachedTo?.name ?? null),
			item.messageRefs
				? `shown in ${item.messageRefs} ${item.messageRefs === 1 ? "message" : "messages"}`
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

	/** How many of the loaded items name a parent that no longer exists. Shown
	 *  on the filter itself, because "reclaim your orphans" is only an
	 *  invitation worth making when there are some. */
	let orphanCount = $derived(items.filter((i) => i.orphaned).length)

	/** Client-side because it is a substring match over a list already in
	 *  memory; a round trip per keystroke would be slower and no more
	 *  correct. Sorting stays on the server, where the whole set lives. */
	let filtered = $derived(
		items.filter((item) => {
			if (orphanedOnly && !item.orphaned) return false
			const q = search.trim().toLowerCase()
			if (!q) return true
			return (
				displayName(item).toLowerCase().includes(q) ||
				(item.attachedTo?.name ?? "").toLowerCase().includes(q)
			)
		})
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
		// `originalUrl`, not `url`: since 0182 a bare media URL serves the
		// DISPLAY form, and "download" means the bytes that were uploaded.
		//
		// Note the `&`. Every URL in a payload now carries `?r={rev}` already,
		// so appending `?download=1` would produce `…?r=3?download=1` — a
		// silently broken download rather than an error.
		const a = document.createElement("a")
		a.href = `${item.originalUrl}&download=1`
		a.rel = "noopener"
		document.body.appendChild(a)
		a.click()
		a.remove()
	}

	function toggleCleanup() {
		cleanupOpen = !cleanupOpen
		if (cleanupOpen) socket.emit("media:cleanupPreview", {})
	}

	function cullDerived() {
		cleanupBusy = true
		socket.emit("media:cullDerived", {})
	}

	function confirmCullOriginals() {
		// The server checks the same phrase; this is only so the button is not
		// live before the words are typed. Sending what the user actually typed
		// rather than the constant keeps the server's check the real gate.
		if (cullConfirm.trim() !== CULL_ORIGINALS_CONFIRM) return
		cleanupBusy = true
		cullOriginalsOpen = false
		socket.emit("media:cullOriginals", { confirm: cullConfirm })
		cullConfirm = ""
	}

	function setCachePolicy(enabled: boolean) {
		socket.emit("media:setCachePolicy", { derivedCacheEnabled: enabled })
	}

	function regenerate(item: Item) {
		menuOpenFor = null
		busyId = item.id
		socket.emit("media:regenerateThumbnail", { mediaId: item.id })
	}

	function crop(item: Item) {
		menuOpenFor = null
		cropping = item
		cropOpen = true
	}

	function saveCrop(frame: MediaFrame | null) {
		if (!cropping) return
		socket.emit("media:setFrame", { mediaId: cropping.id, frame })
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
		ackMessageRefs = false
		pendingDeleteId = item.id
	}

	function confirmDelete() {
		if (pendingDeleteId === null) return
		const item = items.find((i) => i.id === pendingDeleteId)
		if (item?.messageRefs && !ackMessageRefs) return
		socket.emit("media:delete", {
			mediaId: pendingDeleteId,
			// Sent only when there is something to acknowledge. The server
			// re-counts and refuses without this, so a stale list here cannot
			// turn into a silent delete — it turns into the server's refusal,
			// naming the real count.
			...(item?.messageRefs ? { confirmMessageRefs: true } : {})
		})
		pendingDeleteId = null
		ackMessageRefs = false
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
		const onRegen = (res: Sockets.Media.RegenerateThumbnail.Response) => {
			busyId = null
			toaster.success({
				title: res.regenerated
					? "Thumbnail regenerated"
					: "Already at full size — the original is served"
			})
		}
		const onSetFrame = (res: Sockets.Media.SetFrame.Response) => {
			// Re-listed rather than patched in place: the thumbnail row is gone
			// and `storedBytes` with it, and `refresh()` keeps whatever sort and
			// filter this panel is showing.
			toaster.success({
				title: res.media.frame ? "Crop saved" : "Crop reset"
			})
			refresh()
		}
		const onDelete = (res: Sockets.Media.Delete.Response) =>
			toaster.success({
				title: "Image deleted",
				// The server's own count, not the one the dialog showed — it
				// re-counts, so this is what actually happened.
				description: res.messageRefs
					? `${res.messageRefs} ${res.messageRefs === 1 ? "message" : "messages"} now show a broken image.`
					: undefined
			})
		const onCleanup = (res: Sockets.Media.CleanupPreview.Response) => {
			cleanup = res
			cleanupBusy = false
		}
		const onCullDerived = (res: Sockets.Media.CullDerived.Response) => {
			cleanupBusy = false
			toaster.success({
				title: res.variants
					? `Freed ${formatBytes(res.bytes)} across ${res.variants} ${res.variants === 1 ? "copy" : "copies"}`
					: "Nothing to remove"
			})
			socket.emit("media:cleanupPreview", {})
		}
		const onCullOriginals = (res: Sockets.Media.CullOriginals.Response) => {
			cleanupBusy = false
			toaster.success({
				title: res.files
					? `Freed ${formatBytes(res.freedBytes)} from ${res.files} ${res.files === 1 ? "file" : "files"}`
					: "No originals could be removed safely",
				// The net, not the gross: reporting only what was freed while
				// bytes went straight back on disk deriving the fallbacks is
				// the number an admin would later call a lie.
				description: res.addedBytes
					? `${formatBytes(res.addedBytes)} written to derive the copies left behind.`
					: undefined
			})
			socket.emit("media:cleanupPreview", {})
		}
		const onCachePolicy = (res: Sockets.Media.SetCachePolicy.Response) => {
			if (cleanup)
				cleanup = {
					...cleanup,
					derivedCacheEnabled: res.derivedCacheEnabled
				}
			toaster.success({
				title: res.derivedCacheEnabled
					? "Derived forms will be kept on disk"
					: "Derived forms will be re-made on every request"
			})
		}
		const onError = (e: any) => {
			cleanupBusy = false
			toaster.error({ title: e?.error ?? "Something went wrong" })
		}

		// Provenance. Silent on failure by design: "which run made this" is an
		// ambient detail on a panel opened to look at pictures, and a toast for
		// a line the reader did not ask for is noise, not honesty — the line
		// simply does not appear.
		const onArtifactRuns = (
			res: Sockets.Pipelines.ArtifactRuns.Response
		) => {
			if (res.entityId == null || res.error) return
			artifactRuns.set(res.entityId, res.runs)
		}

		socket.on("media:list", onList)
		socket.on("pipelines:artifactRuns", onArtifactRuns)
		socket.on("media:regenerateThumbnail", onRegen)
		socket.on("media:setFrame", onSetFrame)
		socket.on("media:delete", onDelete)
		socket.on("media:cleanupPreview", onCleanup)
		socket.on("media:cullDerived", onCullDerived)
		socket.on("media:cullOriginals", onCullOriginals)
		socket.on("media:setCachePolicy", onCachePolicy)
		socket.on("media:list:error" as any, onError)
		socket.on("media:regenerateThumbnail:error" as any, onError)
		socket.on("media:setFrame:error" as any, onError)
		socket.on("media:delete:error" as any, onError)
		socket.on("media:setVisibility:error" as any, onError)
		socket.on("media:cleanupPreview:error" as any, onError)
		socket.on("media:cullDerived:error" as any, onError)
		socket.on("media:cullOriginals:error" as any, onError)
		socket.on("media:setCachePolicy:error" as any, onError)

		// Every teardown names its listener. A bare `socket.off(event)` removes
		// the FIRST registered listener for that event — usually Layout's — and
		// that has caused two real bugs in this codebase.
		return () => {
			socket.off("media:list", onList)
			socket.off("pipelines:artifactRuns", onArtifactRuns)
			socket.off("media:regenerateThumbnail", onRegen)
			socket.off("media:setFrame", onSetFrame)
			socket.off("media:delete", onDelete)
			socket.off("media:cleanupPreview", onCleanup)
			socket.off("media:cullDerived", onCullDerived)
			socket.off("media:cullOriginals", onCullOriginals)
			socket.off("media:setCachePolicy", onCachePolicy)
			socket.off("media:list:error" as any, onError)
			socket.off("media:regenerateThumbnail:error" as any, onError)
			socket.off("media:setFrame:error" as any, onError)
			socket.off("media:delete:error" as any, onError)
			socket.off("media:setVisibility:error" as any, onError)
			socket.off("media:cleanupPreview:error" as any, onError)
			socket.off("media:cullDerived:error" as any, onError)
			socket.off("media:cullOriginals:error" as any, onError)
			socket.off("media:setCachePolicy:error" as any, onError)
		}
	})
</script>

{#snippet itemMenu(item: Item)}
	<Popover
		open={menuOpenFor === item.id}
		onOpenChange={(e) => {
			menuOpenFor = e.open ? item.id : null
			if (e.open) loadRuns(item)
		}}
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
						<!-- What is held right now, not what is missing. Under
						     lazy derivation a fresh upload has exactly one
						     entry here and that is the healthy state. -->
						<p class="text-surface-600-400 text-xs">
							{formatBytes(item.storedBytes)} on disk ·
							{item.variants.map((v) => v.variant).join(", ") ||
								"nothing stored"}
						</p>
						<!-- Where it came from. `pipeline_run_artifacts` has
						     recorded this since the relation replaced the
						     nullable column, and nothing ever read it back
						     here — a generated picture and an uploaded one
						     looked identical. Absent for an upload, because
						     "no run" is the ordinary case and a line saying
						     so every time is what teaches people to stop
						     reading this block. -->
						{#if runsFor(item).length}
							<p class="text-surface-600-400 text-xs">
								{runsFor(item).length === 1
									? "Made by a run"
									: `Made by ${runsFor(item).length} runs`}
								{#each runsFor(item).slice(0, 3) as r (r.runId)}
									<br />
									<a
										class="anchor"
										href={runHref(r)}
										title="Open this run's receipt ({r.runId})"
									>
										{r.specSlug}{r.isPreview
											? " (preview)"
											: ""}
									</a>
									· {shortDate(String(r.startedAt))}
								{/each}
							</p>
						{/if}
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
								onclick={() => crop(item)}
							>
								<Icons.Crop size={16} aria-hidden="true" />
								<span>Crop</span>
							</button>
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
	     fullscreen panel they stop stretching to 700px each.

	     `class` lands on Select's own wrapper (it already carries
	     `flex flex-col gap-1`), so the flex-item sizing that used to sit on the
	     `<select>` sits there now, and `labelHidden` keeps the label the
	     screen-reader label it already was. -->
	<div class="flex flex-wrap items-end gap-2">
		<Select
			label="Sort media"
			labelHidden
			class="min-w-0 flex-1 basis-36 sm:max-w-[220px]"
			value={sort}
			onValueChange={(v) => (sort = v as typeof sort)}
			options={[
				{ value: "newest", label: "Newest first" },
				{ value: "oldest", label: "Oldest first" },
				{ value: "largest", label: "Largest first" },
				{ value: "smallest", label: "Smallest first" },
				{ value: "name", label: "Name (A–Z)" }
			]}
		/>
		<Select
			label="Filter by type"
			labelHidden
			class="min-w-0 flex-1 basis-32 sm:max-w-[200px]"
			value={kind}
			onValueChange={(v) => (kind = v as typeof kind)}
			options={[
				{ value: "all", label: "All types" },
				{ value: "image", label: "Images" },
				{ value: "document", label: "Documents" }
			]}
		/>
		<!-- The panel's stated premise is that an orphan is visible so its
		     owner can reclaim it; until now the only way to act on that was to
		     read every caption. Disabled at zero rather than hidden, so the
		     count reads as an answer ("none") instead of the control being
		     missing. -->
		<button
			type="button"
			class="btn shrink-0 {orphanedOnly
				? 'preset-filled-warning-500'
				: 'preset-tonal-surface'}"
			onclick={() => (orphanedOnly = !orphanedOnly)}
			disabled={orphanCount === 0 && !orphanedOnly}
			aria-pressed={orphanedOnly}
			title="Show only files whose character, persona or session has been deleted"
		>
			<Icons.Unlink size={16} aria-hidden="true" />
			<span>Orphaned ({orphanCount})</span>
		</button>
	</div>

	<!-- `totalBytes` is what STORING this library costs, across every
	     representation — the question a cleanup panel is for. -->
	<p class="text-surface-600-400 text-xs">
		{filtered.length} of {items.length}
		{items.length === 1 ? "item" : "items"} · {formatBytes(totalBytes)} on disk
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
					: orphanedOnly && orphanCount === 0
						? "Nothing orphaned. Every file here still belongs to something that exists."
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
								{item.orphaned
									? "orphaned"
									: item.attachedTo.name}
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
							·
							<span title={fullDate(item.createdAt)}>
								{shortDate(item.createdAt)}
							</span>
							{#if item.attachedTo}
								· {item.orphaned
									? "orphaned"
									: item.attachedTo.name}
							{/if}
							{#if item.messageRefs}
								· in {item.messageRefs}
								{item.messageRefs === 1
									? "message"
									: "messages"}
							{/if}
							{#if item.storedBytes !== item.bytes}
								· {formatBytes(item.storedBytes)} on disk
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

	<!--
		Storage cleanup (0182). Two actions, and they are deliberately not
		symmetrical: the safe one is offered plainly with its numbers, and the
		irreversible one is louder, separate, and gated on typing a phrase.

		Neither of them decides anything. `cullVariant` on the server refuses to
		take a file's last representation and refuses to take the display target
		with nowhere to re-point, checked per call — so whatever order these
		buttons are pressed in, no file can be left with nothing. A guard here
		would only make the UI polite about a rule it cannot enforce.
	-->
	<div class="card preset-filled-surface-100-900 shadow-sm">
		<button
			type="button"
			class="flex w-full items-center gap-2 p-3 text-left text-sm font-semibold"
			onclick={toggleCleanup}
			aria-expanded={cleanupOpen}
			aria-controls="media-cleanup"
		>
			<Icons.HardDrive size={16} aria-hidden="true" />
			<span class="flex-1">Storage cleanup</span>
			{#if cleanupOpen}
				<Icons.ChevronUp size={16} aria-hidden="true" />
			{:else}
				<Icons.ChevronDown size={16} aria-hidden="true" />
			{/if}
		</button>
		{#if cleanupOpen}
			<div
				id="media-cleanup"
				class="border-surface-300-600 flex flex-col gap-4 border-t p-3"
			>
				{#if !cleanup}
					<div class="flex justify-center py-4">
						<Icons.Loader2
							class="text-surface-600-400 h-5 w-5 animate-spin"
						/>
					</div>
				{:else}
					<section class="flex flex-col gap-2">
						<h3 class="text-sm font-semibold">Derived forms</h3>
						<p class="text-surface-600-400 text-xs">
							Thumbnails and other copies that can be re-made from
							what is kept. Removing them frees space now and
							costs one re-encode the next time each image is
							shown.
						</p>
						<p class="text-sm">
							{cleanup.derived.variants}
							{cleanup.derived.variants === 1 ? "copy" : "copies"}
							across {cleanup.derived.files}
							{cleanup.derived.files === 1 ? "file" : "files"} ·
							<strong>
								{formatBytes(cleanup.derived.bytes)}
							</strong>
						</p>
						<button
							type="button"
							class="btn btn-sm preset-filled-primary-500 self-start"
							onclick={cullDerived}
							disabled={cleanupBusy ||
								cleanup.derived.variants === 0}
						>
							<Icons.Trash2 size={16} aria-hidden="true" />
							<span>Remove derived forms</span>
						</button>
					</section>

					<section
						class="border-error-500/50 bg-error-500/5 flex flex-col gap-2 rounded-lg border p-3"
					>
						<h3
							class="text-error-600-400 flex items-center gap-2 text-sm font-semibold"
						>
							<Icons.AlertTriangle size={16} aria-hidden="true" />
							<span>Uploaded originals — irreversible</span>
						</h3>
						<p class="text-surface-600-400 text-xs">
							Deletes the bytes you uploaded, leaving the web-safe
							copy stored beside them to serve. Nothing can bring
							an original back afterwards.
						</p>
						<p class="text-sm">
							at least {cleanup.originals.files}
							{cleanup.originals.files === 1 ? "file" : "files"} ·
							<strong>
								{formatBytes(cleanup.originals.bytes)}
							</strong>
						</p>
						<!-- "at least" is not hedging: pricing a file whose
						     web-safe copy has never been made would mean doing
						     the encode, which is the expensive half. Those
						     files are absent from the figure and are still
						     acted on, so this is a floor. -->
						<p class="text-surface-600-400 text-xs">
							Files whose web-safe copy has not been made yet are
							not counted until it exists.
						</p>
						<button
							type="button"
							class="btn btn-sm preset-filled-error-500 self-start"
							onclick={() => (cullOriginalsOpen = true)}
							disabled={cleanupBusy}
						>
							<Icons.AlertTriangle size={16} aria-hidden="true" />
							<span>Delete originals…</span>
						</button>
					</section>

					{#if cleanup.skipped.length}
						<section class="flex flex-col gap-1">
							<h3 class="text-sm font-semibold">
								Originals that will be kept
							</h3>
							<!-- With the reason, because "why did it skip 400
							     of my photos" has to be answerable without
							     reading the code. -->
							<ul
								class="text-surface-600-400 flex flex-col gap-1 text-xs"
							>
								{#each cleanup.skipped as row (row.reason)}
									<li>
										<strong>{row.files}</strong>
										{row.files === 1 ? "file" : "files"} — {row.reason}
									</li>
								{/each}
							</ul>
						</section>
					{/if}

					<label class="flex items-start gap-2">
						<input
							type="checkbox"
							class="checkbox mt-0.5 shrink-0"
							checked={cleanup.derivedCacheEnabled}
							onchange={(e) =>
								setCachePolicy(e.currentTarget.checked)}
						/>
						<span>
							<span class="text-sm">
								Keep derived forms on disk
							</span>
							<span class="text-surface-600-400 block text-xs">
								Off means a thumbnail is re-made on every
								request — less disk, more CPU. The display form
								is never affected: it is what a plain image URL
								serves, not an optimisation of it.
							</span>
						</span>
					</label>
				{/if}
			</div>
		{/if}
	</div>
</div>

<EntityGalleryViewModal
	bind:open={lightboxOpen}
	onOpenChange={(e) => (lightboxOpen = e.open)}
	image={lightboxSrc}
/>

<Dialog
	open={pendingDeleteId !== null}
	onOpenChange={(e) => {
		if (!e.open) {
			pendingDeleteId = null
			ackMessageRefs = false
		}
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
						Delete <strong>{displayName(pendingDelete)}</strong>
						?
						{#if !pendingDelete.orphaned && pendingDelete.attachedTo?.name}
							It belongs to
							<strong>{pendingDelete.attachedTo.name}</strong>
							.
						{/if}
					</p>
					<p class="text-surface-600-400 text-xs">
						Anything using it — an avatar, a gallery entry, a
						background — will lose it. This cannot be undone.
					</p>
					<!-- An avatar or a background re-points itself on delete;
					     a message part cannot, because the media panel is not
					     the message store's writer. So this is the one
					     consequence the user has to be told about rather than
					     shielded from, and it is gated on saying so. -->
					{#if pendingDelete.messageRefs}
						{@const n = pendingDelete.messageRefs}
						<div
							class="border-error-500/50 bg-error-500/5 flex flex-col gap-2 rounded-lg border p-3"
						>
							<p
								class="text-error-600-400 flex items-center gap-2 text-sm font-semibold"
							>
								<Icons.MessageSquareWarning
									size={16}
									aria-hidden="true"
								/>
								<span>
									Shown in {n}
									{n === 1 ? "message" : "messages"}
								</span>
							</p>
							<p class="text-surface-600-400 text-xs">
								{n === 1 ? "That message" : "Those messages"}
								keep their text and their place in the conversation,
								but where this image is
								{n === 1 ? "it" : "they"} will show a broken one
								instead. Nothing can put it back.
							</p>
							<label class="flex items-start gap-2 text-xs">
								<input
									type="checkbox"
									class="checkbox mt-0.5 shrink-0"
									bind:checked={ackMessageRefs}
								/>
								<span>
									Delete it anyway and leave {n === 1
										? "that message"
										: "those messages"} showing a broken image.
								</span>
							</label>
						</div>
					{/if}
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
						disabled={!!pendingDelete?.messageRefs &&
							!ackMessageRefs}
					>
						<Icons.Trash2 class="h-4 w-4" />
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<Dialog
	open={cullOriginalsOpen}
	onOpenChange={(e) => {
		if (!e.open) {
			cullOriginalsOpen = false
			cullConfirm = ""
		}
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
				class="card bg-surface-100-900 max-w-md space-y-4 p-6 shadow-xl"
			>
				<header class="flex items-center gap-3">
					<Icons.AlertTriangle
						class="text-error-500 h-5 w-5 shrink-0"
					/>
					<h2 class="text-lg font-bold">Delete uploaded originals</h2>
				</header>
				<p class="text-surface-700-300 text-sm">
					This deletes the bytes you uploaded for
					{#if cleanup}
						at least <strong>{cleanup.originals.files}</strong>
						{cleanup.originals.files === 1 ? "file" : "files"}
						({formatBytes(cleanup.originals.bytes)})
					{:else}
						your files
					{/if}
					and keeps the web-safe copy in their place.
				</p>
				<p class="text-surface-600-400 text-xs">
					The copies left behind are full quality, so images will look
					the same — but the files as you uploaded them are gone. This
					is <strong>irreversible</strong>
					: there is no undo and no recycle bin. Any file with nothing
					safe to fall back on is left alone.
				</p>
				<label class="flex flex-col gap-1 text-sm">
					<span>
						Type <strong>{CULL_ORIGINALS_CONFIRM}</strong>
						to confirm
					</span>
					<input
						type="text"
						class="input"
						bind:value={cullConfirm}
						autocomplete="off"
						spellcheck="false"
						aria-label="Type {CULL_ORIGINALS_CONFIRM} to confirm deleting originals"
					/>
				</label>
				<footer class="flex justify-end gap-2">
					<button
						class="btn preset-filled-surface-400-600"
						onclick={() => {
							cullOriginalsOpen = false
							cullConfirm = ""
						}}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-error-500"
						onclick={confirmCullOriginals}
						disabled={cullConfirm.trim() !== CULL_ORIGINALS_CONFIRM}
					>
						<Icons.Trash2 class="h-4 w-4" />
						Delete originals
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<!-- Mounted whether or not it is open: a dialog torn down mid-close leaves its
     machine reading state that went with it. `cropping` is dropped on the
     editor's close report, so these expressions read defensively meanwhile. -->
<AvatarCropEditor
	open={cropOpen}
	onOpenChange={(e) => (cropOpen = e.open)}
	onClosed={() => (cropping = null)}
	src={cropping?.originalUrl ?? ""}
	frame={cropping?.frame ?? null}
	subject={cropping ? displayName(cropping) : undefined}
	onSave={saveCrop}
/>
