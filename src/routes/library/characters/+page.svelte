<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Switch, Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import { goto } from "$app/navigation"
	import { getContext, onMount } from "svelte"
	import { v4 as uuid } from "uuid"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import LibraryPortraitCard from "$lib/client/components/library/LibraryPortraitCard.svelte"
	import type {
		LibraryCatalogItem,
		CardSourceId,
		CardSourceSort
	} from "$lib/shared/library/types"
	import { imageUrlFor } from "$lib/shared/library/imageUrlFor"
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
	// Tracks any in-flight non-append request, including the "soft" ones
	// (typed search / Enter / NSFW toggle) that deliberately don't set
	// isLoading (which blanks the whole grid) — drives a small, non-blocking
	// spinner so those searches don't silently look like nothing happened.
	let searching = $state(false)
	let loadingMore = $state(false)
	// A "Load More" click made while one is already in flight is remembered
	// instead of silently dropped — the moment the in-flight one settles, it
	// fires immediately rather than requiring the user to notice and re-click.
	let loadMoreQueued = $state(false)
	// Content filtering can make a page come back with zero visible items even
	// though more upstream pages exist (see charaVaultSource.ts's search()) —
	// a single click shouldn't "succeed" into nothing. Bounded so a heavily
	// filtered query can't spin forever / compound rate-limit pressure.
	let loadMoreAutoContinueAttempts = 0
	const MAX_LOAD_MORE_AUTO_CONTINUE = 3
	let stillFiltering = $state(false)
	let hasMoreResults = $state(false)
	// The raw upstream offset for the next "Load More" page, as reported by
	// the server (CardSourceSearchResult.nextOffset). Content filtering can
	// remove items after upstream pagination already accounted for them, so
	// this can differ from libraryCharacters.length — using the filtered
	// count here would re-request an overlapping range from CharaVault.
	let nextOffset = $state(0)
	let downloading = $state(false)
	let selectedCharacter: LibraryCatalogItem | null = $state(null)
	let showDetails = $state(false)
	let loadingDetail = $state(false)
	let unreachable = $state(false)
	let rateLimited = $state(false)
	let retryAfterMs = $state<number | null>(null)
	let retryTimer: ReturnType<typeof setTimeout> | undefined

	let capabilities: Sockets.CardSources.Capabilities.Response | null =
		$state(null)
	let activeSource = $state<CardSourceId>("github-serenepub")
	// Only CharaVault's /api/cards supports ?sort= — this is what "browse
	// with nothing searched" defaults to instead of whatever CharaVault's
	// own unspecified default order is.
	let activeSort = $state<CardSourceSort>("top_rated")
	let hasBookOnly = $state(false)
	let creatorFilter = $state("")
	let sourcesForCharacters = $derived.by(
		() => capabilities?.sources.filter((s) => s.supportsCharacters) ?? []
	)
	let activeSourceInfo = $derived.by(
		() => capabilities?.sources.find((s) => s.id === activeSource) ?? null
	)

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
	// Same staleness-guard idea, for the details-modal detail fetch: opening
	// item A (triggers a detail fetch), closing it, and opening item B
	// before A's response arrives would otherwise let A's response land
	// after B is already open and overwrite B's fields with A's data.
	let latestDetailRequestId = ""

	let searchDebounceTimeoutId: ReturnType<typeof setTimeout> | undefined

	function debouncedFetchLibrary() {
		clearTimeout(searchDebounceTimeoutId)
		searchDebounceTimeoutId = setTimeout(() => fetchLibrary(false), 500)
	}

	function fetchLibrary(
		showLoading: boolean = false,
		append: boolean = false
	) {
		const requestId = uuid()
		latestRequestId = requestId
		pendingIsAppend = append
		if (append) {
			loadingMore = true
		} else {
			if (showLoading) isLoading = true
			searching = true
			unreachable = false
			rateLimited = false
			retryAfterMs = null
			clearTimeout(retryTimer)
		}
		socket.emit("characters:searchLibrary", {
			searchTerm: searchString,
			source: activeSource,
			sort: activeSource === "charavault" ? activeSort : undefined,
			hasBook:
				activeSource === "charavault" && hasBookOnly ? true : undefined,
			creatorFilter:
				activeSource === "charavault" && creatorFilter
					? creatorFilter
					: undefined,
			cursor: {
				limit: PAGE_SIZE,
				offset: append ? nextOffset : 0
			},
			requestId
		})
	}

	function loadMore() {
		if (!hasMoreResults) return
		if (loadingMore || isLoading) {
			loadMoreQueued = true
			return
		}
		loadMoreAutoContinueAttempts = 0
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

		// CharaVault's search results only carry a truncated preview
		// (`description_preview`), not the full description — always fetch
		// the full text on open rather than for every card in the grid.
		// Other sources (eg. GitHub) already return the complete
		// description on search results, so this only fires when it's
		// actually missing for them.
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
		return Array.from(categories.entries()).sort((a, b) =>
			a[0].localeCompare(b[0])
		)
	})

	onMount(() => {
		socket.on(
			"characters:searchLibrary",
			(msg: Sockets.Characters.SearchLibrary.Response) => {
				if (msg.requestId !== latestRequestId) return
				libraryCharacters = pendingIsAppend
					? [...libraryCharacters, ...msg.characters]
					: msg.characters
				hasMoreResults = msg.hasMore
				nextOffset =
					msg.nextOffset ??
					(pendingIsAppend
						? nextOffset + msg.characters.length
						: msg.characters.length)
				isLoading = false
				searching = false
				loadingMore = false

				if (pendingIsAppend) {
					if (
						msg.characters.length === 0 &&
						hasMoreResults &&
						loadMoreAutoContinueAttempts <
							MAX_LOAD_MORE_AUTO_CONTINUE
					) {
						// This page filtered down to nothing but more upstream
						// pages exist — keep going automatically rather than
						// leaving the click looking like it did nothing.
						loadMoreAutoContinueAttempts++
						loadMoreQueued = false
						stillFiltering = true
						fetchLibrary(false, true)
						return
					}
					loadMoreAutoContinueAttempts = 0
					stillFiltering = false
				}
				if (loadMoreQueued) {
					loadMoreQueued = false
					loadMore()
				}
			}
		)
		socket.on(
			"characters:searchLibrary:error",
			(msg: Sockets.SearchLibraryErrorResponse) => {
				if (msg.requestId !== latestRequestId) return
				// Capture now — by the time a retryTimer fires, pendingIsAppend may
				// have already been overwritten by a newer, unrelated request.
				const wasAppend = pendingIsAppend
				const isRateLimited = !!msg.rateLimited
				const errorRetryAfterMs = msg.retryAfterMs ?? null
				isLoading = false
				searching = false
				loadingMore = false

				if (wasAppend) {
					// A failed "Load More" shouldn't blank out the already-loaded
					// cards still on screen — just stop the loading-more spinner. A
					// rate-limited append still auto-retries (resuming the append,
					// not replacing) same as a fresh search would; anything else
					// just toasts and leaves the existing grid alone.
					//
					// Either way, a queued click is already superseded by (or
					// moot alongside) this outcome — clear it rather than
					// letting it fire an extra request once the retry lands.
					loadMoreQueued = false
					if (isRateLimited && errorRetryAfterMs) {
						clearTimeout(retryTimer)
						retryTimer = setTimeout(
							() => fetchLibrary(true, true),
							errorRetryAfterMs
						)
					} else {
						loadMoreAutoContinueAttempts = 0
						stillFiltering = false
						toaster.error({
							title: msg.error || "Failed to load more characters"
						})
					}
					return
				}

				libraryCharacters = []
				unreachable = !!msg.unreachable
				rateLimited = isRateLimited
				retryAfterMs = errorRetryAfterMs
				if (isRateLimited && errorRetryAfterMs) {
					clearTimeout(retryTimer)
					retryTimer = setTimeout(
						() => fetchLibrary(true, false),
						errorRetryAfterMs
					)
				}
				if (!unreachable && !isRateLimited) {
					toaster.error({
						title:
							msg.error ||
							"Failed to search the character library"
					})
				}
			}
		)
		socket.on(
			"characters:importFromLibrary",
			(msg: Sockets.Characters.ImportFromLibrary.Response) => {
				toaster.success({ title: `Downloaded ${msg.character.name}` })
				downloading = false
				showDetails = false
			}
		)
		socket.on(
			"characters:importFromLibrary:error",
			(msg: Sockets.ErrorResponse) => {
				toaster.error({
					title: msg.error || "Failed to download character"
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
				if (selectedCharacter) {
					selectedCharacter = { ...selectedCharacter, ...msg }
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
			clearTimeout(searchDebounceTimeoutId)
			socket.off("characters:searchLibrary")
			socket.off("characters:searchLibrary:error")
			socket.off("characters:importFromLibrary")
			socket.off("characters:importFromLibrary:error")
			socket.off("cardSources:capabilities")
			socket.off("cardSources:cardDetail")
			socket.off("cardSources:cardDetail:error")
		}
	})
</script>

<div
	class="preset-tonal mt-4 min-h-[calc(100%-3rem)] rounded-lg p-6 shadow-md"
>
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
					Browse and download ready-made characters from the Serene
					Pub community library.
				</p>
			</div>
		</div>
	</div>

	{#if sourcesForCharacters.length > 1}
		<div class="mb-4">
			<Tabs value={activeSource} onValueChange={handleTabChange}>
				<Tabs.List class="flex flex-wrap gap-1">
					{#each sourcesForCharacters as source}
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

	<div class="relative mb-1">
		<input
			type="text"
			bind:value={searchString}
			placeholder="Search characters, descriptions, tags…"
			class="input w-full"
			aria-label="Search the character library"
			oninput={debouncedFetchLibrary}
			onkeydown={(e) => {
				if (e.key !== "Enter") return
				clearTimeout(searchDebounceTimeoutId)
				fetchLibrary(false)
			}}
		/>
		{#if searching && !isLoading}
			<Icons.Loader2
				size={16}
				class="text-surface-500 pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 animate-spin"
				aria-hidden="true"
			/>
		{/if}
	</div>

	{#if activeSource === "charavault"}
		<p class="text-surface-700-300 mb-3 text-xs">
			Supports <code>tag:name</code>
			,
			<code>-exclude</code>
			,
			<code>creator:name</code>
			, and
			<code>"exact phrase"</code>
			— combine freely, e.g.
			<code>elf tag:fantasy -romance creator:anon</code>
			.
		</p>

		{#if creatorFilter}
			<div class="mb-3 flex items-center gap-2">
				<span
					class="chip preset-filled-primary-500 inline-flex items-center gap-1.5"
				>
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
				<select
					id="sort-select"
					class="select"
					value={activeSort}
					onchange={(e) =>
						handleSortChange(
							e.currentTarget.value as CardSourceSort
						)}
				>
					{#each SORT_OPTIONS as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>
			<Switch
				name="has-book-only"
				checked={hasBookOnly}
				onCheckedChange={handleHasBookChange}
				class="flex items-center gap-2"
			>
				<Switch.Control
					class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
				>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
				<Switch.Label class="text-sm font-semibold">
					Only cards with a lorebook
				</Switch.Label>
			</Switch>
			{#if capabilities?.unsafeBrowsingEnabled}
				<Switch
					name="include-nsfw"
					checked={userSettingsCtx.settings?.charaVaultIncludeNsfw ??
						false}
					onCheckedChange={onIncludeNsfwChange}
					class="flex items-center gap-2"
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="text-sm font-semibold">
						Include NSFW results
					</Switch.Label>
				</Switch>
			{/if}
		</div>
	{/if}

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
	{:else if libraryCharacters.length === 0}
		<div
			class="text-surface-700-300 flex flex-col items-center gap-2 py-16 text-center"
		>
			<Icons.Search size={40} class="opacity-40" />
			<p>No characters found</p>
		</div>
	{:else if activeSource === "charavault"}
		<!-- CharaVault's "category" (folder) grouping doesn't map to a
			meaningful browsing structure the way the curated GitHub catalog's
			categories do — flat grid instead of sectioned-by-category. -->
		<div
			class="grid grid-cols-[repeat(auto-fill,minmax(16.625rem,1fr))] gap-4"
		>
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
					<h2
						class="text-surface-400 mb-3 text-xs font-semibold tracking-wider uppercase"
					>
						{category}
					</h2>
					<div
						class="grid grid-cols-[repeat(auto-fill,minmax(16.625rem,1fr))] gap-4"
					>
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
					{stillFiltering ? "Filtering…" : "Loading…"}
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
