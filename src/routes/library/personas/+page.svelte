<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import LibraryPortraitCard from "$lib/client/components/library/LibraryPortraitCard.svelte"
	import type { LibraryCatalogItem, CardSourceId } from "$lib/shared/library/types"
	import LibraryDetailsModal from "$lib/client/components/library/LibraryDetailsModal.svelte"

	const socket = useTypedSocket()

	let searchString = $state("")
	let libraryPersonas: LibraryCatalogItem[] = $state([])
	let isLoading = $state(false)
	let downloading = $state(false)
	let selectedPersona: LibraryCatalogItem | null = $state(null)
	let showDetails = $state(false)
	let loadingDetail = $state(false)
	let unreachable = $state(false)
	let rateLimited = $state(false)
	let retryAfterMs = $state<number | null>(null)
	let retryTimer: ReturnType<typeof setTimeout> | undefined

	let capabilities: Sockets.CardSources.Capabilities.Response | null = $state(null)
	let activeSource = $state<CardSourceId>("github-serenepub")
	// CharaVault has no persona catalog, so this will only ever have one
	// entry in practice — the tab strip stays hidden when there's nothing
	// to switch between.
	let sourcesForPersonas = $derived.by(
		() => capabilities?.sources.filter((s) => s.supportsPersonas) ?? []
	)
	let activeSourceInfo = $derived.by(() =>
		capabilities?.sources.find((s) => s.id === activeSource) ?? null
	)

	function imageUrlFor(item: LibraryCatalogItem): string | null {
		if (item.source === "charavault") {
			// Proxied server-side — charavault.net's images are blocked by a
			// Cross-Origin-Resource-Policy header when loaded directly.
			return `/library/cardImage/charavault/${item.file}`
		}
		if (!item.file.endsWith(".png")) return null
		return `https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/${item.file}`
	}

	// New searches are always sent immediately — never blocked or queued
	// behind a slow one (a previous version waited for the in-flight
	// request to finish before allowing another, which meant a slow
	// response made switching tabs, retrying, or typing a new query appear
	// to do nothing at all). Instead, each request carries a requestId;
	// responses whose id doesn't match the most recently sent request are
	// just stale results arriving late and are silently discarded.
	let latestRequestId = ""

	const debouncedFetchLibrary = (() => {
		let timeoutId: ReturnType<typeof setTimeout> | undefined
		return () => {
			clearTimeout(timeoutId)
			timeoutId = setTimeout(() => fetchLibrary(false), 500)
		}
	})()

	function fetchLibrary(showLoading: boolean = false) {
		const requestId = crypto.randomUUID()
		latestRequestId = requestId
		if (showLoading) isLoading = true
		unreachable = false
		rateLimited = false
		retryAfterMs = null
		clearTimeout(retryTimer)
		socket.emit("personas:searchLibrary", {
			searchTerm: searchString,
			source: activeSource,
			requestId
		})
	}

	function handleTabChange(e: ValueChangeDetails) {
		activeSource = e.value as CardSourceId
		fetchLibrary(true)
	}

	function openDetails(item: LibraryCatalogItem) {
		selectedPersona = item
		showDetails = true

		// Some sources don't include a description on search results, only
		// on their single-card detail endpoint — fetch it lazily on open.
		if (!item.description) {
			loadingDetail = true
			socket.emit("cardSources:cardDetail", {
				source: item.source,
				ref: item.sourceRef
			})
		}
	}

	function handleDownload() {
		if (!selectedPersona || downloading) return
		downloading = true
		socket.emit("personas:importFromLibrary", {
			source: selectedPersona.source,
			ref: selectedPersona.sourceRef
		})
	}

	let categorizedPersonas = $derived.by(() => {
		const categories = new Map<string, LibraryCatalogItem[]>()
		for (const persona of libraryPersonas) {
			const category = persona.category || "Uncategorized"
			if (!categories.has(category)) categories.set(category, [])
			categories.get(category)!.push(persona)
		}
		return Array.from(categories.entries()).sort((a, b) => a[0].localeCompare(b[0]))
	})

	socket.on("personas:searchLibrary", (msg: Sockets.Personas.SearchLibrary.Response) => {
		if (msg.requestId !== latestRequestId) return
		libraryPersonas = msg.personas
		isLoading = false
	})
	socket.on("personas:searchLibrary:error", (msg: any) => {
		if (msg.requestId !== latestRequestId) return
		libraryPersonas = []
		unreachable = !!msg.unreachable
		rateLimited = !!msg.rateLimited
		retryAfterMs = msg.retryAfterMs ?? null
		isLoading = false
		if (rateLimited && retryAfterMs) {
			clearTimeout(retryTimer)
			retryTimer = setTimeout(() => fetchLibrary(true), retryAfterMs)
		}
		if (!unreachable && !rateLimited) {
			toaster.error({ title: msg.error || "Failed to search the persona library" })
		}
	})
	socket.on("personas:importFromLibrary", (msg: Sockets.Personas.ImportFromLibrary.Response) => {
		toaster.success({ title: `Downloaded ${msg.persona.name}` })
		downloading = false
		showDetails = false
	})
	socket.on("personas:importFromLibrary:error", (msg: Sockets.ErrorResponse) => {
		toaster.error({ title: msg.error || "Failed to download persona" })
		downloading = false
	})
	socket.on("cardSources:capabilities", (msg: Sockets.CardSources.Capabilities.Response) => {
		capabilities = msg
	})
	socket.on("cardSources:cardDetail", (msg: Sockets.CardSources.CardDetail.Response) => {
		loadingDetail = false
		if (selectedPersona) {
			selectedPersona = { ...selectedPersona, ...msg }
		}
	})
	socket.on("cardSources:cardDetail:error", () => {
		loadingDetail = false
	})

	socket.emit("cardSources:capabilities", {})
	fetchLibrary(true)
</script>

<div class="mx-4 mt-4 mb-8 min-h-[calc(100%-3rem)] rounded-lg p-6 shadow-md preset-tonal">
	<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
		<div class="flex items-center gap-3">
			<button
				class="btn btn-sm preset-filled-surface-400-600 p-2"
				onclick={() => goto("/")}
				title="Back"
				aria-label="Back"
			>
				<Icons.ArrowLeft size={16} />
			</button>
			<div>
				<h1 class="h2 flex items-center gap-2">
					<Icons.Library class="text-primary-500" size={26} />
					Persona Library
				</h1>
				<p class="text-surface-700-300 mt-1 text-sm">
					Browse and download ready-made personas from the Serene Pub community library.
				</p>
			</div>
		</div>
	</div>

	{#if sourcesForPersonas.length > 1}
		<div class="mb-4">
			<Tabs value={activeSource} onValueChange={handleTabChange}>
				<Tabs.List class="flex flex-wrap gap-1">
					{#each sourcesForPersonas as source}
						<Tabs.Trigger value={source.id}>{source.label}</Tabs.Trigger>
					{/each}
					<Tabs.Indicator class="rounded-full preset-filled-primary-500" />
				</Tabs.List>
			</Tabs>
		</div>
	{/if}

	{#if activeSourceInfo}
		<p class="text-surface-700-300 mb-4 flex flex-wrap items-center gap-x-2 text-sm">
			<span>{activeSourceInfo.description}</span>
			<a
				href={activeSourceInfo.url}
				target="_blank"
				rel="noopener noreferrer"
				class="anchor inline-flex items-center gap-1 whitespace-nowrap"
			>
				<Icons.ExternalLink size={14} aria-hidden="true" />
				{activeSourceInfo.url.replace(/^https?:\/\//, "")}
			</a>
		</p>
	{/if}

	<div class="mb-6">
		<input
			type="text"
			bind:value={searchString}
			placeholder="Search"
			class="input w-full"
			aria-label="Search the persona library"
			oninput={debouncedFetchLibrary}
			onkeydown={(e) => e.key === "Enter" && fetchLibrary(false)}
		/>
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-16">
			<Icons.Loader2 size={32} class="text-surface-700-300 animate-spin" />
		</div>
	{:else if unreachable}
		<div class="text-surface-700-300 flex flex-col items-center gap-3 py-16 text-center">
			<Icons.WifiOff size={40} class="opacity-40" />
			<p>{capabilities?.sources.find((s) => s.id === activeSource)?.label ?? "This source"} is unreachable right now.</p>
			<button class="btn btn-sm preset-filled-primary-500" onclick={() => fetchLibrary(true)}>
				<Icons.RotateCw size={16} />
				Retry
			</button>
		</div>
	{:else if rateLimited}
		<div class="text-surface-700-300 flex flex-col items-center gap-2 py-16 text-center">
			<Icons.Clock size={40} class="opacity-40" />
			<p>
				This source is busy right now{#if retryAfterMs}
					— retrying in {Math.ceil(retryAfterMs / 1000)}s{/if}.
			</p>
		</div>
	{:else if libraryPersonas.length === 0}
		<div class="text-surface-700-300 flex flex-col items-center gap-2 py-16 text-center">
			<Icons.Search size={40} class="opacity-40" />
			<p>No personas found</p>
		</div>
	{:else}
		<div class="space-y-8">
			{#each categorizedPersonas as [category, personas]}
				<section>
					<h2 class="text-surface-400 mb-3 text-xs font-semibold tracking-wider uppercase">
						{category}
					</h2>
					<div class="grid grid-cols-[repeat(auto-fill,minmax(16.625rem,1fr))] gap-4">
						{#each personas as persona (`${persona.source}:${persona.file}`)}
							<LibraryPortraitCard
								item={persona}
								imageUrl={imageUrlFor(persona)}
								onclick={() => openDetails(persona)}
							/>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</div>

<LibraryDetailsModal
	open={showDetails}
	onOpenChange={(e) => (showDetails = e.open)}
	item={selectedPersona}
	imageUrl={selectedPersona ? imageUrlFor(selectedPersona) : null}
	{downloading}
	{loadingDetail}
	onDownload={handleDownload}
	itemTypeLabel="Persona"
/>
