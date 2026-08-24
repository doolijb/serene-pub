<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import { goto } from "$app/navigation"
	import { v4 as uuid } from "uuid"
	import { onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import LibraryPortraitCard from "$lib/client/components/library/LibraryPortraitCard.svelte"
	import type {
		LibraryCatalogItem,
		CardSourceId
	} from "$lib/shared/library/types"
	import { imageUrlFor } from "$lib/shared/library/imageUrlFor"
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

	let capabilities: Sockets.CardSources.Capabilities.Response | null =
		$state(null)
	let activeSource = $state<CardSourceId>("github-serenepub")
	// CharaVault has no persona catalog, so this will only ever have one
	// entry in practice — the tab strip stays hidden when there's nothing
	// to switch between.
	let sourcesForPersonas = $derived.by(
		() => capabilities?.sources.filter((s) => s.supportsPersonas) ?? []
	)
	let activeSourceInfo = $derived.by(
		() => capabilities?.sources.find((s) => s.id === activeSource) ?? null
	)

	// New searches are always sent immediately — never blocked or queued
	// behind a slow one (a previous version waited for the in-flight
	// request to finish before allowing another, which meant a slow
	// response made switching tabs, retrying, or typing a new query appear
	// to do nothing at all). Instead, each request carries a requestId;
	// responses whose id doesn't match the most recently sent request are
	// just stale results arriving late and are silently discarded.
	let latestRequestId = ""
	// Same staleness-guard idea, for the details-modal detail fetch: opening
	// item A (triggers a detail fetch), closing it, and opening item B
	// before A's response arrives would otherwise let A's response land
	// after B is already open and overwrite B's fields with A's data.
	let latestDetailRequestId = ""

	const debouncedFetchLibrary = (() => {
		let timeoutId: ReturnType<typeof setTimeout> | undefined
		return () => {
			clearTimeout(timeoutId)
			timeoutId = setTimeout(() => fetchLibrary(false), 500)
		}
	})()

	function fetchLibrary(showLoading: boolean = false) {
		const requestId = uuid()
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

		// CharaVault's search results only carry a truncated preview, not
		// the full description — always fetch on open for that source.
		// Other sources already return the complete description, so this
		// only fires when it's actually missing for them.
		if (item.source === "charavault" || !item.description) {
			const requestId = uuid()
			latestDetailRequestId = requestId
			loadingDetail = true
			socket.emit("cardSources:cardDetail", {
				source: item.source,
				ref: item.sourceRef,
				requestId
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
		return Array.from(categories.entries()).sort((a, b) =>
			a[0].localeCompare(b[0])
		)
	})

	onMount(() => {
		socket.on(
			"personas:searchLibrary",
			(msg: Sockets.Personas.SearchLibrary.Response) => {
				if (msg.requestId !== latestRequestId) return
				libraryPersonas = msg.personas
				isLoading = false
			}
		)
		socket.on(
			"personas:searchLibrary:error",
			(msg: Sockets.SearchLibraryErrorResponse) => {
				if (msg.requestId !== latestRequestId) return
				libraryPersonas = []
				unreachable = !!msg.unreachable
				rateLimited = !!msg.rateLimited
				retryAfterMs = msg.retryAfterMs ?? null
				isLoading = false
				if (rateLimited && retryAfterMs) {
					clearTimeout(retryTimer)
					retryTimer = setTimeout(
						() => fetchLibrary(true),
						retryAfterMs
					)
				}
				if (!unreachable && !rateLimited) {
					toaster.error({
						title:
							msg.error || "Failed to search the persona library"
					})
				}
			}
		)
		socket.on(
			"personas:importFromLibrary",
			(msg: Sockets.Personas.ImportFromLibrary.Response) => {
				toaster.success({ title: `Downloaded ${msg.persona.name}` })
				downloading = false
				showDetails = false
			}
		)
		socket.on(
			"personas:importFromLibrary:error",
			(msg: Sockets.ErrorResponse) => {
				toaster.error({
					title: msg.error || "Failed to download persona"
				})
				downloading = false
			}
		)
		socket.on(
			"cardSources:capabilities",
			(msg: Sockets.CardSources.Capabilities.Response) => {
				capabilities = msg
			}
		)
		socket.on(
			"cardSources:cardDetail",
			(msg: Sockets.CardSources.CardDetail.Response) => {
				if (msg.requestId !== latestDetailRequestId) return
				loadingDetail = false
				if (selectedPersona) {
					selectedPersona = { ...selectedPersona, ...msg }
				}
			}
		)
		socket.on("cardSources:cardDetail:error", (msg: any) => {
			if (msg.requestId !== latestDetailRequestId) return
			loadingDetail = false
		})

		socket.emit("cardSources:capabilities", {})
		fetchLibrary(true)

		return () => {
			clearTimeout(retryTimer)
			socket.off("personas:searchLibrary")
			socket.off("personas:searchLibrary:error")
			socket.off("personas:importFromLibrary")
			socket.off("personas:importFromLibrary:error")
			socket.off("cardSources:capabilities")
			socket.off("cardSources:cardDetail")
			socket.off("cardSources:cardDetail:error")
		}
	})
</script>

<div class="preset-tonal mt-4 min-h-[calc(100%-3rem)] rounded-lg p-6 shadow-md">
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
					Browse and download ready-made personas from the Serene Pub
					community library.
				</p>
			</div>
		</div>
	</div>

	{#if sourcesForPersonas.length > 1}
		<div class="mb-4">
			<Tabs value={activeSource} onValueChange={handleTabChange}>
				<Tabs.List class="flex flex-wrap gap-1">
					{#each sourcesForPersonas as source}
						<Tabs.Trigger value={source.id}>
							{source.label}
						</Tabs.Trigger>
					{/each}
					<Tabs.Indicator
						class="preset-filled-primary-500 rounded-full"
					/>
				</Tabs.List>
			</Tabs>
		</div>
	{/if}

	{#if activeSourceInfo}
		<p
			class="text-surface-700-300 mb-4 flex flex-wrap items-center gap-x-2 text-sm"
		>
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
			<Icons.Loader2
				size={32}
				class="text-surface-700-300 animate-spin"
			/>
		</div>
	{:else if unreachable}
		<div
			class="text-surface-700-300 flex flex-col items-center gap-3 py-16 text-center"
		>
			<Icons.WifiOff size={40} class="opacity-40" />
			<p>
				{capabilities?.sources.find((s) => s.id === activeSource)
					?.label ?? "This source"} is unreachable right now.
			</p>
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => fetchLibrary(true)}
			>
				<Icons.RotateCw size={16} />
				Retry
			</button>
		</div>
	{:else if rateLimited}
		<div
			class="text-surface-700-300 flex flex-col items-center gap-3 py-16 text-center"
		>
			<Icons.Clock size={40} class="opacity-40" />
			<p>
				This source is busy right now{#if retryAfterMs}
					— retrying in {Math.ceil(retryAfterMs / 1000)}s{/if}.
			</p>
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => fetchLibrary(true)}
			>
				<Icons.RotateCw size={16} />
				Retry
			</button>
		</div>
	{:else if libraryPersonas.length === 0}
		<div
			class="text-surface-700-300 flex flex-col items-center gap-2 py-16 text-center"
		>
			<Icons.Search size={40} class="opacity-40" />
			<p>No personas found</p>
		</div>
	{:else}
		<div class="space-y-8">
			{#each categorizedPersonas as [category, personas]}
				<section>
					<h2
						class="text-surface-400 mb-3 text-xs font-semibold tracking-wider uppercase"
					>
						{category}
					</h2>
					<div
						class="grid grid-cols-[repeat(auto-fill,minmax(16.625rem,1fr))] gap-4"
					>
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
