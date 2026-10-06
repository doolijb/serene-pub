<script lang="ts">
	import {
		onLibraryImported,
		onLibraryImportFailed
	} from "$lib/client/contexts/characterImports.svelte"
	/**
	 * The **Library** sidebar view — the community character library, browsed
	 * beside whatever is open and imported into Characters (NOMENCLATURE §26).
	 * It was a page (`/library/characters`) until 2026-09-27; its Focus
	 * address is `/library` now, and the old address redirects there.
	 *
	 * **One catalogue.** The library browses characters only. A persona is a
	 * character with a flag since the persona merge, so a card imported here
	 * is made a persona afterwards in Characters; there is no Personas shelf.
	 *
	 * **Shape by width**, from the view's own measurements, never the window:
	 *
	 * - `vm` (the view) decides the split: under 900px one pane at a time — the
	 *   list, or a result's detail with a back header — and at desk width the
	 *   list beside the detail. The detail is the fixed column here and the
	 *   list takes the room (`PanelSplit`'s `detailWidth`), because the grid of
	 *   portraits is the thing being looked at.
	 * - `listBox` (the list pane) decides the list's own form: under 560px a
	 *   single column of rows with the filters behind a popout (STYLE-GUIDE
	 *   §6.3); from 560px the portrait grid with the filters in a row.
	 *
	 * **Search** is the filter box and Jump, one state (`searchString`): this
	 * view registers its scope, so Ctrl K over an open Library searches the
	 * library. Every change to the text — typed, cleared, or set by Jump —
	 * searches after a pause; Enter searches at once.
	 *
	 * No close gate: browsing holds no unsaved work.
	 */
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal, Switch } from "@skeletonlabs/skeleton-svelte"
	import { getContext, onMount, tick, untrack } from "svelte"
	import { SvelteMap } from "svelte/reactivity"
	import { v4 as uuid } from "uuid"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"
	import type { JumpHit } from "$lib/shared/sockets/jump"
	import type {
		LibraryCatalogItem,
		CardSourceId,
		CardSourceSort
	} from "$lib/shared/library/types"
	import { imageUrlFor } from "$lib/shared/library/imageUrlFor"
	import LibraryPortraitCard from "./LibraryPortraitCard.svelte"
	import LibraryResultRow from "./LibraryResultRow.svelte"
	import LibraryDetail from "./LibraryDetail.svelte"

	const socket = useTypedSocket()
	const panelsCtx: PanelsCtx = getContext("panelsCtx")
	const userSettingsCtx: UserSettingsCtx = getContext("userSettingsCtx")
	const jumpCtx = getContext<JumpCtx | undefined>(JUMP_CONTEXT)

	const PAGE_SIZE = 24
	/** The list pane's width from which results are a portrait grid. */
	const GRID_MIN_PX = 560

	const DEFAULT_SORT: CardSourceSort = "top_rated"
	const SORT_OPTIONS: { value: CardSourceSort; label: string }[] = [
		{ value: "top_rated", label: "Top rated" },
		{ value: "most_downloaded", label: "Most downloaded" },
		{ value: "newest", label: "Newest" },
		{ value: "oldest", label: "Oldest" },
		{ value: "name_asc", label: "Name (A–Z)" },
		{ value: "name_desc", label: "Name (Z–A)" },
		{ value: "token_count_asc", label: "Token count (low–high)" },
		{ value: "token_count_desc", label: "Token count (high–low)" },
		{ value: "most_commented", label: "Most discussed" }
	]

	/* ── shape ──────────────────────────────────────────────────────────── */

	const vm = new ViewModeTracker()
	const listBox = new ViewModeTracker()
	let roomy = $derived(listBox.width >= GRID_MIN_PX)

	/* ── search state ───────────────────────────────────────────────────── */

	let searchString = $state("")
	let libraryCharacters: LibraryCatalogItem[] = $state([])
	let isLoading = $state(false)
	// Tracks any in-flight non-append request, including the "soft" ones
	// (typed search / Enter / NSFW toggle) that deliberately don't set
	// isLoading (which blanks the whole list) — drives a small, non-blocking
	// spinner so those searches don't silently look like nothing happened.
	let searching = $state(false)
	let loadingMore = $state(false)
	// A "Load more" click made while one is already in flight is remembered
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
	// The raw upstream offset for the next "Load more" page, as reported by
	// the server (CardSourceSearchResult.nextOffset). Content filtering can
	// remove items after upstream pagination already accounted for them, so
	// this can differ from libraryCharacters.length — using the filtered
	// count here would re-request an overlapping range from CharaVault.
	let nextOffset = $state(0)
	let unreachable = $state(false)
	let rateLimited = $state(false)
	/** When the rate-limited search retries by itself (epoch ms), or null. */
	let retryAt = $state<number | null>(null)
	/** Ticks once a second while a retry is pending, for the countdown. */
	let now = $state(Date.now())
	let retryTimer: ReturnType<typeof setTimeout> | undefined

	let capabilities = $state<Sockets.CardSources.Capabilities.Response | null>(
		null
	)
	let activeSource = $state<CardSourceId>("github-serenepub")
	// Only CharaVault's /api/cards supports ?sort= — this is what "browse
	// with nothing searched" defaults to instead of whatever CharaVault's
	// own unspecified default order is.
	let activeSort = $state<CardSourceSort>(DEFAULT_SORT)
	let hasBookOnly = $state(false)
	let creatorFilter = $state("")
	let filterOpen = $state(false)

	/** The sources that publish characters — every one, today. */
	let sources = $derived(
		capabilities?.sources.filter((s) => s.supportsCharacters) ?? []
	)
	let activeSourceInfo = $derived(
		capabilities?.sources.find((s) => s.id === activeSource) ?? null
	)
	/**
	 * Sort, the lorebook-only switch, the creator filter and the query syntax
	 * are CharaVault's: its API is the only one that takes them.
	 */
	let isCharaVault = $derived(activeSource === "charavault")
	/** The filter popout's button lights while it holds a non-default pick. */
	let filtersActive = $derived(
		isCharaVault && (hasBookOnly || activeSort !== DEFAULT_SORT)
	)
	let sortLabel = $derived(
		SORT_OPTIONS.find((o) => o.value === activeSort)?.label ?? ""
	)
	let retryInSeconds = $derived(
		retryAt === null ? null : Math.max(0, Math.ceil((retryAt - now) / 1000))
	)

	// New searches are always sent immediately — never blocked or queued
	// behind a slow one (a previous version waited for the in-flight
	// request to finish before allowing another, which meant a slow
	// CharaVault response, eg. rate-limit backoff that can take up to a
	// minute, made switching sources, retrying, or typing a new query appear
	// to do nothing at all). Instead, each request carries a requestId;
	// responses whose id doesn't match the most recently sent request are
	// just stale results arriving late and are silently discarded.
	let latestRequestId = ""
	// Whether the in-flight request (tracked by latestRequestId above)
	// should APPEND to libraryCharacters (a "Load more" page fetch) or
	// REPLACE it (any other search change) once its response arrives.
	let pendingIsAppend = false
	// Same staleness-guard idea, for the detail fetch: opening result A
	// (triggers a detail fetch) and then result B before A's response
	// arrives would otherwise let A's response land after B is already open
	// and overwrite B's fields with A's data.
	let latestDetailRequestId = ""
	/** The text the last search was sent with, so an unchanged box is not re-sent. */
	let searchedTerm = ""

	let searchDebounceTimeoutId: ReturnType<typeof setTimeout> | undefined

	/* ── detail and import state ────────────────────────────────────────── */

	let selected: LibraryCatalogItem | null = $state(null)
	let loadingDetail = $state(false)
	let importing = $state(false)
	/** The result an import is in flight for, so its reply lands on it. */
	let importingKey: string | null = null
	/** Result key → the character it became, for this visit. */
	const imported = new SvelteMap<string, number>()

	function keyOf(item: LibraryCatalogItem): string {
		return `${item.source}:${item.file}`
	}

	/* ── searching ──────────────────────────────────────────────────────── */

	function fetchLibrary(
		showLoading: boolean = false,
		append: boolean = false
	) {
		clearTimeout(searchDebounceTimeoutId)
		const requestId = uuid()
		latestRequestId = requestId
		pendingIsAppend = append
		searchedTerm = searchString
		if (append) {
			loadingMore = true
		} else {
			if (showLoading) isLoading = true
			searching = true
			unreachable = false
			rateLimited = false
			retryAt = null
			clearTimeout(retryTimer)
		}
		socket.emit("characters:searchLibrary", {
			searchTerm: searchString,
			source: activeSource,
			sort: isCharaVault ? activeSort : undefined,
			hasBook: isCharaVault && hasBookOnly ? true : undefined,
			creatorFilter:
				isCharaVault && creatorFilter ? creatorFilter : undefined,
			cursor: {
				limit: PAGE_SIZE,
				offset: append ? nextOffset : 0
			},
			requestId
		})
	}

	// Whatever changed the text — a keystroke, the box's clear control, Jump
	// — searches after a pause. `searchedTerm` keeps a search that has
	// already gone (Enter, a filter change) from being sent twice.
	$effect(() => {
		const term = searchString
		untrack(() => {
			if (term === searchedTerm) {
				clearTimeout(searchDebounceTimeoutId)
				return
			}
			clearTimeout(searchDebounceTimeoutId)
			searchDebounceTimeoutId = setTimeout(() => fetchLibrary(false), 500)
		})
	})

	function onSearchKeydown(e: KeyboardEvent) {
		if (e.key !== "Enter") return
		fetchLibrary(false)
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

	function pickSource(id: CardSourceId) {
		if (id === activeSource) return
		activeSource = id
		fetchLibrary(true)
	}

	function pickSort(sort: CardSourceSort) {
		if (sort === activeSort) return
		activeSort = sort
		fetchLibrary(true)
	}

	function setHasBookOnly(checked: boolean) {
		if (checked === hasBookOnly) return
		hasBookOnly = checked
		fetchLibrary(true)
	}

	function filterByCreator(author: string) {
		creatorFilter = author
		// The detail belongs to a result the new list may not hold; in the
		// dock it also stands where the filtered list is about to be.
		selected = null
		fetchLibrary(true)
	}

	function clearCreatorFilter() {
		creatorFilter = ""
		fetchLibrary(true)
	}

	function onIncludeNsfwChange(checked: boolean) {
		socket.emit("userSettings:updateCharaVaultIncludeNsfw", {
			enabled: checked
		})
		fetchLibrary(false)
	}

	/**
	 * The curated source groups its cards by category; CharaVault's folders
	 * are not a browsing structure, so its results stay one flat run.
	 */
	let groups = $derived.by((): [string, LibraryCatalogItem[]][] => {
		if (isCharaVault) return [["", libraryCharacters]]
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

	/* ── the detail ─────────────────────────────────────────────────────── */

	let listRoot = $state<HTMLElement | null>(null)
	/** Where the one-pane list was scrolled to when a detail replaced it. */
	let savedListScroll = 0

	/** The pane PanelSplit scrolls — its element, so found rather than bound. */
	function scrollPane(): HTMLElement | null {
		let node = listRoot?.parentElement ?? null
		while (node) {
			const overflowY = getComputedStyle(node).overflowY
			if (overflowY === "auto" || overflowY === "scroll") return node
			node = node.parentElement
		}
		return null
	}

	function openDetails(item: LibraryCatalogItem) {
		if (vm.mode !== "desk" && selected === null)
			savedListScroll = scrollPane()?.scrollTop ?? 0
		selected = item

		// CharaVault's search results only carry a truncated preview
		// (`description_preview`), not the full description — always fetch
		// the full text on open rather than for every card in the list.
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
		} else {
			latestDetailRequestId = ""
			loadingDetail = false
		}
	}

	/**
	 * Back from the detail in the one-pane layout: the list comes back where
	 * it was scrolled to, not at its top — a browse forty cards deep should
	 * not have to be scrolled again after every look.
	 */
	async function closeDetails() {
		selected = null
		latestDetailRequestId = ""
		loadingDetail = false
		await tick()
		const pane = scrollPane()
		if (pane) pane.scrollTop = savedListScroll
	}

	function handleImport() {
		if (!selected || importing) return
		importing = true
		importingKey = keyOf(selected)
		socket.emit("characters:importFromLibrary", {
			source: selected.source,
			ref: selected.sourceRef
		})
	}

	/** Open the character this result became, and leave the library as it is. */
	function openInCharacters(characterId: number) {
		panelsCtx.digest.viewCharacterId = characterId
		panelsCtx.openView("characters", { toggle: false })
	}

	/* ── Jump ───────────────────────────────────────────────────────────── */

	/**
	 * The results on screen as jump hits. The kind is `character` because
	 * that is what a card is — the id is the result's own key, a string no
	 * character row has, so picking one opens its detail here rather than
	 * looking for a character in your list.
	 */
	function toHit(item: LibraryCatalogItem): JumpHit {
		return {
			kind: "character",
			id: keyOf(item),
			title: item.name,
			subtitle: item.author ? `by ${item.author}` : item.category
		}
	}

	$effect(() =>
		jumpCtx?.registerScope("library", {
			label: "Library",
			placeholder: "Search the library…",
			getQuery: () => searchString,
			setQuery: (next) => (searchString = next),
			getHits: () => libraryCharacters.map(toHit),
			onPick: (hit) => {
				const item = libraryCharacters.find((c) => keyOf(c) === hit.id)
				if (item) openDetails(item)
			}
		})
	)

	/* ── replies ────────────────────────────────────────────────────────── */

	// Named because the interest registry releases by handler reference — and
	// because it is the ONE listener path, a bare
	// `socket.off("characters:searchLibrary")` that would tear down every
	// other listener has no reach from here at all.
	function handleCharactersSearchLibrary(
		msg: Sockets.Characters.SearchLibrary.Response
	) {
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
				loadMoreAutoContinueAttempts < MAX_LOAD_MORE_AUTO_CONTINUE
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

	function handleCharactersSearchLibraryError(
		msg: Sockets.SearchLibraryErrorResponse
	) {
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
			// A failed "Load more" shouldn't blank out the already-loaded
			// cards still on screen — just stop the loading-more spinner. A
			// rate-limited append still auto-retries (resuming the append,
			// not replacing) same as a fresh search would; anything else
			// just toasts and leaves the existing list alone.
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
		retryAt =
			isRateLimited && errorRetryAfterMs
				? Date.now() + errorRetryAfterMs
				: null
		if (isRateLimited && errorRetryAfterMs) {
			clearTimeout(retryTimer)
			retryTimer = setTimeout(
				() => fetchLibrary(true, false),
				errorRetryAfterMs
			)
		}
		if (!unreachable && !isRateLimited) {
			toaster.error({
				title: msg.error || "Failed to search the library"
			})
		}
	}

	// The import reply goes to every socket the user has open and carries no
	// request id, so it is only this view's when this view asked.
	function handleCharactersImportFromLibrary(
		msg: Sockets.Characters.ImportFromLibrary.Response
	) {
		if (!importing) return
		if (importingKey) imported.set(importingKey, msg.character.id)
		importing = false
		importingKey = null
		// No toast here: the characters-import context announces the import.
	}

	function handleCharactersImportFromLibraryError(
		msg: Sockets.ErrorResponse
	) {
		if (!importing) return
		importing = false
		importingKey = null
		// The error toast is the characters-import context's.
	}

	function handleCardSourcesCapabilities(
		msg: Sockets.CardSources.Capabilities.Response
	) {
		capabilities = msg
	}

	function handleCardSourcesCardDetail(
		msg: Sockets.CardSources.CardDetail.Response
	) {
		if (msg.requestId !== latestDetailRequestId) return
		loadingDetail = false
		if (selected) selected = { ...selected, ...msg }
	}

	function handleCardSourcesCardDetailError(
		msg: Sockets.ErrorResponse & { requestId?: string }
	) {
		if (msg.requestId !== latestDetailRequestId) return
		loadingDetail = false
	}

	/**
	 * All BARE, and all STANDING for as long as this view is mounted.
	 *
	 * `characters:searchLibrary` and `cardSources:cardDetail` echo the
	 * client-generated `requestId` this view sent, but that is NOT an interest
	 * scope: `SCOPED_EVENTS` is the one table both sides read and it has no
	 * entry for these events, so a `#<requestId>` key would match no payload at
	 * all. The `msg.requestId !== latest…` guards in the handlers stay the
	 * staleness filter — a different job from deciding who is sent the reply.
	 *
	 * Declared ahead of the requests below so every key is held before either
	 * flushes the interest sync (effects run in declaration order).
	 */
	useInterest<"characters:searchLibrary">(
		"characters:searchLibrary",
		handleCharactersSearchLibrary
	)
	useInterest<"characters:searchLibrary:error">(
		"characters:searchLibrary:error",
		handleCharactersSearchLibraryError
	)
	// The import events are the characters-import context's; this view takes
	// the outcome for its "imported" marks.
	onLibraryImported(handleCharactersImportFromLibrary)
	onLibraryImportFailed(handleCharactersImportFromLibraryError)
	useInterest<"cardSources:cardDetail">(
		"cardSources:cardDetail",
		handleCardSourcesCardDetail
	)
	useInterest<"cardSources:cardDetail:error">(
		"cardSources:cardDetail:error",
		handleCardSourcesCardDetailError
	)
	$effect(() =>
		requestWithInterest(
			"cardSources:capabilities",
			{},
			handleCardSourcesCapabilities
		)
	)

	// The countdown ticks only while there is one.
	$effect(() => {
		if (retryAt === null) return
		now = Date.now()
		const id = setInterval(() => (now = Date.now()), 1000)
		return () => clearInterval(id)
	})

	onMount(() => {
		// Every listener above is an interest, released by the registry when
		// this view's effects are destroyed. The first search is the one
		// request left to send, and the typed `emit` inside it flushes the
		// interest sync ahead of itself.
		fetchLibrary(true)

		return () => {
			clearTimeout(retryTimer)
			clearTimeout(searchDebounceTimeoutId)
		}
	})
</script>

<div
	use:vm.observe
	class="text-foreground flex h-full min-h-0 flex-col"
	role="region"
	aria-label="Character library"
>
	<PanelSplit
		mode={vm.mode}
		hasDetail={selected !== null}
		detailWidth="clamp(360px, 32%, 560px)"
		emptyMessage="Pick a character to see it here."
		list={listPane}
		detail={detailPane}
	/>
</div>

{#snippet detailPane()}
	{#if selected}
		{#key keyOf(selected)}
			<LibraryDetail
				item={selected}
				imageUrl={imageUrlFor(selected)}
				{importing}
				{loadingDetail}
				importedCharacterId={imported.get(keyOf(selected)) ?? null}
				onBack={vm.mode === "desk" ? undefined : closeDetails}
				onImport={handleImport}
				onOpenInCharacters={openInCharacters}
				onFilterByCreator={filterByCreator}
			/>
		{/key}
	{/if}
{/snippet}

{#snippet listPane()}
	<div
		bind:this={listRoot}
		use:listBox.observe
		class="flex min-w-0 flex-col gap-3"
	>
		<!-- The box, and — in the dock — the popout that holds everything
		     else that narrows the list. -->
		<!-- Capped at a reading width: a 3400px search box at 4K is a box
		     nobody can see the end of. -->
		<div class="flex max-w-3xl min-w-0 items-center gap-2">
			<div class="relative min-w-0 flex-1">
				<PanelFilterInput
					bind:value={searchString}
					placeholder="Search the library"
					aria-label="Search the character library"
					onkeydown={onSearchKeydown}
					data-library-search
				/>
			</div>
			{#if searching && !isLoading}
				<Icons.Loader2
					size={16}
					class="text-surface-500 shrink-0 animate-spin"
					aria-label="Searching"
				/>
			{/if}
			{#if !roomy}
				{@render filterPopout()}
			{/if}
		</div>

		{#if roomy}
			{@render filterRow()}
		{/if}

		{#if isCharaVault}
			<p class="text-surface-600-400 text-xs leading-relaxed">
				Try <code>tag:name</code>, <code>-exclude</code>,
				<code>creator:name</code> and <code>"exact phrase"</code>, e.g.
				<code>elf tag:fantasy -romance</code>.
			</p>
		{/if}

		{@render activeChips()}

		{@render results()}
	</div>
{/snippet}

<!-- Source, then (CharaVault only) sort and the switches, as a row once the
     list has room for one. -->
{#snippet filterRow()}
	<div class="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-2">
		{#if sources.length > 1}
			<Select
				class="w-64"
				label="Source"
				options={sources.map((s) => ({ value: s.id, label: s.label }))}
				value={activeSource}
				onValueChange={(v) => {
					if (v) pickSource(v as CardSourceId)
				}}
			/>
		{/if}
		{#if isCharaVault}
			<Select
				class="w-52"
				label="Sort"
				options={SORT_OPTIONS}
				value={activeSort}
				onValueChange={(v) => {
					if (v) pickSort(v as CardSourceSort)
				}}
			/>
			<div class="flex h-10 items-center gap-4">
				{@render switches()}
			</div>
		{/if}
	</div>
	{@render sourceLine()}
{/snippet}

{#snippet sourceLine()}
	{#if activeSourceInfo}
		<p
			class="text-surface-600-400 flex min-w-0 flex-wrap items-center gap-x-2 text-xs"
		>
			<span>{activeSourceInfo.description}</span>
			<a
				href={activeSourceInfo.url}
				target="_blank"
				rel="noopener noreferrer"
				class="anchor inline-flex items-center gap-1 whitespace-nowrap"
			>
				<Icons.ExternalLink size={12} aria-hidden="true" />
				{activeSourceInfo.url.replace(/^https?:\/\//, "")}
			</a>
		</p>
	{/if}
{/snippet}

{#snippet switches()}
	<Switch
		name="library-has-book-only"
		checked={hasBookOnly}
		onCheckedChange={(e) => setHasBookOnly(e.checked)}
		class="flex items-center gap-2"
	>
		<Switch.Control
			class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
		>
			<Switch.Thumb />
		</Switch.Control>
		<Switch.HiddenInput />
		<Switch.Label class="text-sm">Only with a lorebook</Switch.Label>
	</Switch>
	{#if capabilities?.unsafeBrowsingEnabled}
		<Switch
			name="library-include-nsfw"
			checked={userSettingsCtx.settings?.charaVaultIncludeNsfw ?? false}
			onCheckedChange={(e) => onIncludeNsfwChange(e.checked)}
			class="flex items-center gap-2"
		>
			<Switch.Control
				class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
			>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
			<Switch.Label class="text-sm">Include NSFW</Switch.Label>
		</Switch>
	{/if}
{/snippet}

<!-- STYLE-GUIDE §6.3: a 40px icon button, a popover of radio rows, the
     button tonal while it holds a pick that is not the default. -->
{#snippet filterPopout()}
	<Popover
		open={filterOpen}
		onOpenChange={(e) => (filterOpen = e.open)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class="btn grid size-10 shrink-0 place-items-center p-0 {filtersActive
				? 'preset-tonal-primary'
				: ''}"
			title="Source and filters"
			aria-label="Source and filters"
			aria-expanded={filterOpen}
		>
			<Icons.SlidersHorizontal size={16} aria-hidden="true" />
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-100-900 border-surface-300-700 w-[min(90vw,280px)] border p-2 shadow-xl"
				>
					<div
						class="flex max-h-[min(70vh,480px)] flex-col gap-3 overflow-y-auto"
					>
						{#if sources.length > 1}
							{@render radioGroup(
								"Source",
								sources.map((s) => ({
									value: s.id,
									label: s.label
								})),
								activeSource,
								(v) => pickSource(v as CardSourceId)
							)}
						{/if}
						{#if isCharaVault}
							{@render radioGroup(
								"Sort",
								SORT_OPTIONS,
								activeSort,
								(v) => pickSort(v as CardSourceSort)
							)}
							<div class="flex flex-col gap-3 px-2.5 pb-1">
								{@render switches()}
							</div>
						{/if}
						{#if !isCharaVault && sources.length <= 1}
							<p class="text-surface-600-400 px-2.5 py-2 text-sm">
								This source has no filters.
							</p>
						{/if}
					</div>
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{/snippet}

{#snippet radioGroup(
	label: string,
	options: { value: string; label: string }[],
	current: string,
	pick: (value: string) => void
)}
	<div class="flex flex-col gap-0.5" role="radiogroup" aria-label={label}>
		<span class="text-surface-600-400 px-2.5 pt-1 pb-0.5 text-xs font-medium">
			{label}
		</span>
		{#each options as option (option.value)}
			{@const checked = current === option.value}
			<button
				type="button"
				role="radio"
				aria-checked={checked}
				class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm {checked
					? 'sidebar-row-active'
					: 'hover:preset-tonal-primary'}"
				onclick={() => pick(option.value)}
			>
				<span class="min-w-0 truncate">{option.label}</span>
			</button>
		{/each}
	</div>
{/snippet}

<!-- The narrowings in force, each dismissible. In the dock that includes
     what the popout holds, since the popout is closed; with room the row
     above already shows them. -->
{#snippet activeChips()}
	{@const showPopoutChips = !roomy && isCharaVault}
	{#if (isCharaVault && creatorFilter) || (showPopoutChips && (hasBookOnly || activeSort !== DEFAULT_SORT))}
		<div class="flex min-w-0 flex-wrap items-center gap-2">
			{#if isCharaVault && creatorFilter}
				{@render chip(`Creator: ${creatorFilter}`, clearCreatorFilter)}
			{/if}
			{#if showPopoutChips && activeSort !== DEFAULT_SORT}
				{@render chip(`Sort: ${sortLabel}`, () => pickSort(DEFAULT_SORT))}
			{/if}
			{#if showPopoutChips && hasBookOnly}
				{@render chip("Only with a lorebook", () =>
					setHasBookOnly(false)
				)}
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet chip(label: string, clear: () => void)}
	<span
		class="bg-surface-200-800 text-surface-800-200 flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs"
	>
		<span class="min-w-0 truncate">{label}</span>
		<button
			type="button"
			class="hover:text-foreground shrink-0"
			onclick={clear}
			title="Clear"
			aria-label="Clear {label}"
		>
			<Icons.X size={12} aria-hidden="true" />
		</button>
	</span>
{/snippet}

{#snippet results()}
	{#if isLoading}
		<div class="text-surface-600-400 flex justify-center py-12">
			<Icons.Loader2 size={24} class="animate-spin" aria-label="Loading" />
		</div>
	{:else if unreachable}
		<EmptyState
			icon={Icons.WifiOff}
			message="{activeSourceInfo?.label ??
				'This source'} can't be reached right now."
			ctaLabel="Retry"
			onCta={() => fetchLibrary(true)}
		/>
	{:else if rateLimited}
		<EmptyState
			icon={Icons.Clock}
			message={retryInSeconds !== null
				? `${activeSourceInfo?.label ?? "This source"} is busy. Trying again in ${retryInSeconds}s.`
				: `${activeSourceInfo?.label ?? "This source"} is busy right now.`}
			ctaLabel="Retry now"
			onCta={() => fetchLibrary(true)}
		/>
	{:else if libraryCharacters.length === 0}
		<EmptyState
			icon={Icons.SearchX}
			message={searchString.trim()
				? `Nothing in the library matches "${searchString.trim()}".`
				: "No characters here."}
		/>
	{:else}
		<div class="flex flex-col gap-5">
			{#each groups as [category, items] (category)}
				<section
					class="flex flex-col gap-2"
					aria-label={category || undefined}
				>
					{#if category}
						<h3 class="text-surface-600-400 text-xs font-medium">
							{category}
						</h3>
					{/if}
					{#if roomy}
						<div
							class="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-3"
						>
							{#each items as item (keyOf(item))}
								<LibraryPortraitCard
									{item}
									imageUrl={imageUrlFor(item)}
									active={selected !== null &&
										keyOf(selected) === keyOf(item)}
									imported={imported.has(keyOf(item))}
									onclick={() => openDetails(item)}
								/>
							{/each}
						</div>
					{:else}
						<div class="flex flex-col gap-0.5">
							{#each items as item (keyOf(item))}
								<LibraryResultRow
									{item}
									imageUrl={imageUrlFor(item)}
									active={selected !== null &&
										keyOf(selected) === keyOf(item)}
									imported={imported.has(keyOf(item))}
									onclick={() => openDetails(item)}
								/>
							{/each}
						</div>
					{/if}
				</section>
			{/each}
		</div>
	{/if}

	{#if hasMoreResults && !isLoading && !unreachable && !rateLimited}
		<div class="flex justify-center pt-1 pb-2">
			<button
				type="button"
				class="btn btn-sm preset-tonal-primary"
				onclick={loadMore}
				disabled={loadingMore}
			>
				{#if loadingMore}
					<Icons.Loader2
						size={16}
						class="animate-spin"
						aria-hidden="true"
					/>
					{stillFiltering ? "Filtering…" : "Loading…"}
				{:else}
					<Icons.ChevronDown size={16} aria-hidden="true" />
					Load more
				{/if}
			</button>
		</div>
	{/if}
{/snippet}
