<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Switch, Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import { goto } from "$app/navigation"
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import LibraryPortraitCard from "$lib/client/components/library/LibraryPortraitCard.svelte"
	import type { LibraryCatalogItem, CardSourceId, CardSourceSort } from "$lib/shared/library/types"
	import LibraryDetailsModal from "$lib/client/components/library/LibraryDetailsModal.svelte"

	const socket = useTypedSocket()
	let userSettingsCtx: UserSettingsCtx = $state(getContext("userSettingsCtx"))

	const PAGE_SIZE = 24

	const SORT_OPTIONS: { value: CardSourceSort; label: string }[] = [
		{ value: "top_rated", label: "Top Rated" },
		{ value: "most_downloaded", label: "Most Downloaded" },
		{ value: "newest", label: "Newest" },
		{ value: "oldest", label: "Oldest" },
		{ value: "name_asc", label: "Name (A–Z)" },
		{ value: "name_desc", label: "Name (Z–A)" },
		{ value: "token_count_asc", label: "Token Count (Low–High)" },
		{ value: "token_count_desc", label: "Token Count (High–Low)" },
		{ value: "most_commented", label: "Most Discussed" }
	]

	let searchString = $state("")
	let libraryCharacters: LibraryCatalogItem[] = $state([])
	let isLoading = $state(false)
	let loadingMore = $state(false)
	let hasMoreResults = $state(false)
	let downloading = $state(false)
	let selectedCharacter: LibraryCatalogItem | null = $state(null)
	let showDetails = $state(false)
	let loadingDetail = $state(false)
	let unreachable = $state(false)
	let rateLimited = $state(false)
	let retryAfterMs = $state<number | null>(null)
	let retryTimer: ReturnType<typeof setTimeout> | undefined

	let capabilities: Sockets.CardSources.Capabilities.Response | null = $state(null)
	let activeSource = $state<CardSourceId>("github-serenepub")
	// Only CharaVault's /api/cards supports ?sort= — this is what "browse
	// with nothing searched" defaults to instead of whatever CharaVault's
	// own unspecified default order is.
	let activeSort = $state<CardSourceSort>("top_rated")
	let hasBookOnly = $state(false)
	let creatorFilter = $state("")
	let sourcesForCharacters = $derived.by(() => capabilities?.sources ?? [])
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
	// CharaVault response, eg. rate-limit backoff that can take up to a
	// minute, made switching tabs, retrying, or typing a new query appear
	// to do nothing at all). Instead, each request carries a requestId;
	// responses whose id doesn't match the most recently sent request are
	// just stale results arriving late and are silently discarded.
	let latestRequestId = ""
	// Whether the in-flight request (tracked by latestRequestId above)
	// should APPEND to libraryCharacters (a "Load More" page fetch) or
	// REPLACE it (any other search change) once its response arrives.
	let pendingIsAppend = false

	const debouncedFetchLibrary = (() => {
		let timeoutId: ReturnType<typeof setTimeout> | undefined
		return () => {
			clearTimeout(timeoutId)
			timeoutId = setTimeout(() => fetchLibrary(false), 500)
		}
	})()

	function fetchLibrary(showLoading: boolean = false, append: boolean = false) {
		const requestId = crypto.randomUUID()
		latestRequestId = requestId
		pendingIsAppend = append
		if (append) {
			loadingMore = true
		} else {
			if (showLoading) isLoading = true
			unreachable = false
			rateLimited = false
			retryAfterMs = null
			clearTimeout(retryTimer)
		}
		socket.emit("characters:searchLibrary", {
			searchTerm: searchString,
			source: activeSource,
			sort: activeSource === "charavault" ? activeSort : undefined,
			hasBook: activeSource === "charavault" && hasBookOnly ? true : undefined,
			creatorFilter:
				activeSource === "charavault" && creatorFilter ? creatorFilter : undefined,
			cursor: {
				limit: PAGE_SIZE,
				offset: append ? libraryCharacters.length : 0
			},
			requestId
		})
	}

	function loadMore() {
		if (!hasMoreResults || loadingMore || isLoading) return
		fetchLibrary(false, true)
	}

	function handleSortChange(sort: CardSourceSort) {
		if (sort === activeSort) return
		activeSort = sort
		fetchLibrary(true)
	}

	function handleHasBookChange(event: { checked: boolean }) {
		hasBookOnly = event.checked
		fetchLibrary(true)
	}

	function filterByCreator(author: string) {
		creatorFilter = author
		showDetails = false
		fetchLibrary(true)
	}

	function clearCreatorFilter() {
		creatorFilter = ""
		fetchLibrary(true)
	}

	function handleTabChange(e: ValueChangeDetails) {
		activeSource = e.value as CardSourceId
		fetchLibrary(true)
	}

	function openDetails(item: LibraryCatalogItem) {
		selectedCharacter = item
		showDetails = true

		// Some sources (eg. CharaVault) don't include a description on
		// search results, only on their single-card detail endpoint —
		// fetch it lazily on open rather than for every card in the grid.
		if (!item.description) {
			loadingDetail = true
			socket.emit("cardSources:cardDetail", {
				source: item.source,
				ref: item.sourceRef
			})
		}
	}

	function handleDownload() {
		if (!selectedCharacter || downloading) return
		downloading = true
		socket.emit("characters:importFromLibrary", {
			source: selectedCharacter.source,
			ref: selectedCharacter.sourceRef
		})
	}

	function onIncludeNsfwChange(event: { checked: boolean }) {
		socket.emit("userSettings:updateCharaVaultIncludeNsfw", {
			enabled: event.checked
		})
		fetchLibrary(false)
	}

	let categorizedCharacters = $derived.by(() => {
		const categories = new Map<string, LibraryCatalogItem[]>()
		for (const character of libraryCharacters) {
			const category = character.category || "Uncategorized"
			if (!categories.has(category)) categories.set(category, [])
			categories.get(category)!.push(character)
		}
		return Array.from(categories.entries()).sort((a, b) => a[0].localeCompare(b[0]))
	})

	socket.on("characters:searchLibrary", (msg: Sockets.Characters.SearchLibrary.Response) => {
		if (msg.requestId !== latestRequestId) return
		libraryCharacters = pendingIsAppend
			? [...libraryCharacters, ...msg.characters]
			: msg.characters
		hasMoreResults = msg.hasMore
		isLoading = false
		loadingMore = false
	})
	socket.on("characters:searchLibrary:error", (msg: any) => {
		if (msg.requestId !== latestRequestId) return
		if (!pendingIsAppend) libraryCharacters = []
		unreachable = !!msg.unreachable
		rateLimited = !!msg.rateLimited
		retryAfterMs = msg.retryAfterMs ?? null
		isLoading = false
		loadingMore = false
		if (rateLimited && retryAfterMs) {
			clearTimeout(retryTimer)
			retryTimer = setTimeout(() => fetchLibrary(true), retryAfterMs)
		}
		if (!unreachable && !rateLimited) {
			toaster.error({ title: msg.error || "Failed to search the character library" })
		}
	})
	socket.on("characters:importFromLibrary", (msg: Sockets.Characters.ImportFromLibrary.Response) => {
		toaster.success({ title: `Downloaded ${msg.character.name}` })
		downloading = false
		showDetails = false
	})
	socket.on("characters:importFromLibrary:error", (msg: Sockets.ErrorResponse) => {
		toaster.error({ title: msg.error || "Failed to download character" })
		downloading = false
	})
	socket.on("cardSources:capabilities", (msg: Sockets.CardSources.Capabilities.Response) => {
		capabilities = msg
	})
	socket.on("cardSources:cardDetail", (msg: Sockets.CardSources.CardDetail.Response) => {
		loadingDetail = false
		if (selectedCharacter) {
			selectedCharacter = { ...selectedCharacter, ...msg }
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
					Character Library
				</h1>
				<p class="text-surface-700-300 mt-1 text-sm">
					Browse and download ready-made characters from the Serene Pub community library.
				</p>
			</div>
		</div>
	</div>

	{#if sourcesForCharacters.length > 1}
		<div class="mb-4">
			<Tabs value={activeSource} onValueChange={handleTabChange}>
				<Tabs.List class="flex flex-wrap gap-1">
					{#each sourcesForCharacters as source}
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

	<div class="mb-1">
		<input
			type="text"
			bind:value={searchString}
			placeholder="Search characters, descriptions, tags…"
			class="input w-full"
			aria-label="Search the character library"
			oninput={debouncedFetchLibrary}
			onkeydown={(e) => e.key === "Enter" && fetchLibrary(false)}
		/>
	</div>

	{#if activeSource === "charavault"}
		<p class="text-surface-700-300 mb-3 text-xs">
			Supports <code>tag:name</code>, <code>-exclude</code>,
			<code>creator:name</code>, and <code>"exact phrase"</code> — combine
			freely, e.g. <code>elf tag:fantasy -romance creator:anon</code>.
		</p>

		{#if creatorFilter}
			<div class="mb-3 flex items-center gap-2">
				<span class="chip preset-filled-primary-500 inline-flex items-center gap-1.5">
					Creator: {creatorFilter}
					<button
						type="button"
						onclick={clearCreatorFilter}
						aria-label="Clear creator filter"
						class="inline-flex"
					>
						<Icons.X size={12} aria-hidden="true" />
					</button>
				</span>
			</div>
		{/if}

		<div class="mb-4 flex flex-wrap items-center gap-3">
			<label class="flex items-center gap-2 text-sm" for="sort-select">
				<span class="text-surface-700-300 font-semibold">Sort:</span>
				<select id="sort-select" class="select" value={activeSort} onchange={(e) => handleSortChange(e.currentTarget.value as CardSourceSort)}>
					{#each SORT_OPTIONS as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>
			<div class="flex items-center gap-2">
				<Switch
					name="has-book-only"
					checked={hasBookOnly}
					onCheckedChange={handleHasBookChange}
				>
					<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<label for="has-book-only" class="text-sm font-semibold">Only cards with a lorebook</label>
			</div>
		</div>
	{/if}

	{#if capabilities?.unsafeBrowsingEnabled}
		<div class="mb-6 flex items-center gap-2">
			<Switch
				name="include-nsfw"
				checked={userSettingsCtx.settings?.charaVaultIncludeNsfw ?? false}
				onCheckedChange={onIncludeNsfwChange}
			>
				<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
			<label for="include-nsfw" class="text-sm font-semibold">Include NSFW results</label>
		</div>
	{/if}

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
	{:else if libraryCharacters.length === 0}
		<div class="text-surface-700-300 flex flex-col items-center gap-2 py-16 text-center">
			<Icons.Search size={40} class="opacity-40" />
			<p>No characters found</p>
		</div>
	{:else if activeSource === "charavault"}
		<!-- CharaVault's "category" (folder) grouping doesn't map to a
			meaningful browsing structure the way the curated GitHub catalog's
			categories do — flat grid instead of sectioned-by-category. -->
		<div class="grid grid-cols-[repeat(auto-fill,minmax(16.625rem,1fr))] gap-4">
			{#each libraryCharacters as character (`${character.source}:${character.file}`)}
				<LibraryPortraitCard
					item={character}
					imageUrl={imageUrlFor(character)}
					onclick={() => openDetails(character)}
				/>
			{/each}
		</div>
	{:else}
		<div class="space-y-8">
			{#each categorizedCharacters as [category, characters]}
				<section>
					<h2 class="text-surface-400 mb-3 text-xs font-semibold tracking-wider uppercase">
						{category}
					</h2>
					<div class="grid grid-cols-[repeat(auto-fill,minmax(16.625rem,1fr))] gap-4">
						{#each characters as character (`${character.source}:${character.file}`)}
							<LibraryPortraitCard
								item={character}
								imageUrl={imageUrlFor(character)}
								onclick={() => openDetails(character)}
							/>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}

	{#if hasMoreResults && !isLoading && !unreachable && !rateLimited}
		<div class="mt-6 flex justify-center">
			<button
				type="button"
				class="btn preset-tonal-primary"
				onclick={loadMore}
				disabled={loadingMore}
			>
				{#if loadingMore}
					<Icons.Loader2 size={16} class="animate-spin" />
					Loading…
				{:else}
					<Icons.ChevronDown size={16} />
					Load More
				{/if}
			</button>
		</div>
	{/if}
</div>

<LibraryDetailsModal
	open={showDetails}
	onOpenChange={(e) => (showDetails = e.open)}
	item={selectedCharacter}
	imageUrl={selectedCharacter ? imageUrlFor(selectedCharacter) : null}
	{downloading}
	{loadingDetail}
	onDownload={handleDownload}
	onFilterByCreator={filterByCreator}
	itemTypeLabel="Character"
/>
