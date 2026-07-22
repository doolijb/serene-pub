<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { goto } from "$app/navigation"
	import { v4 as uuid } from "uuid"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import type {
		LibraryCatalogItem,
		CardSourceId,
		CardSourceSort
	} from "$lib/shared/library/types"

	const PAGE_SIZE = 20

	const SORT_OPTIONS: { value: CardSourceSort; label: string }[] = [
		{ value: "top_rated", label: "Top Rated" },
		{ value: "most_downloaded", label: "Most Downloaded" },
		{ value: "newest", label: "Newest" },
		{ value: "oldest", label: "Oldest" },
		{ value: "name_asc", label: "Name (A–Z)" },
		{ value: "name_desc", label: "Name (Z–A)" }
	]

	const socket = useTypedSocket()
	let userSettingsCtx: UserSettingsCtx = getContext("userSettingsCtx")

	let capabilities: Sockets.CardSources.Capabilities.Response | null =
		$state(null)
	let activeSource: CardSourceId = $state("github-serenepub")
	let activeSort: CardSourceSort = $state("top_rated")
	let hasBookOnly = $state(false)
	let searchTerm = $state("")

	let results: LibraryCatalogItem[] = $state([])
	let loading = $state(false)
	let hasMore = $state(false)
	let error = $state("")
	let unreachable = $state(false)

	let detailsFor: LibraryCatalogItem | null = $state(null)
	let loadingDetail = $state(false)
	let downloadingKey: string | null = $state(null)
	let status = $state("")

	let latestRequestId = ""
	let latestDetailRequestId = ""
	let pendingIsAppend = false

	function search(event?: SubmitEvent) {
		event?.preventDefault()
		fetchLibrary(false)
	}

	function fetchLibrary(append: boolean) {
		const requestId = uuid()
		latestRequestId = requestId
		pendingIsAppend = append
		loading = true
		if (!append) {
			error = ""
			unreachable = false
		}
		socket.emit("characters:searchLibrary", {
			searchTerm,
			source: activeSource,
			sort: activeSource === "charavault" ? activeSort : undefined,
			hasBook:
				activeSource === "charavault" && hasBookOnly ? true : undefined,
			cursor: { limit: PAGE_SIZE, offset: append ? results.length : 0 },
			requestId
		})
	}

	function loadMore() {
		if (!hasMore || loading) return
		fetchLibrary(true)
	}

	function viewDetails(item: LibraryCatalogItem) {
		detailsFor = item
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

	function download(item: LibraryCatalogItem) {
		downloadingKey = `${item.source}:${item.file}`
		socket.emit("characters:importFromLibrary", {
			source: item.source,
			ref: item.sourceRef
		})
	}

	function toggleNsfw(enabled: boolean) {
		socket.emit("userSettings:updateCharaVaultIncludeNsfw", { enabled })
		fetchLibrary(false)
	}

	onMount(() => {
		socket.on("cardSources:capabilities", (msg) => {
			capabilities = msg
		})
		socket.on("characters:searchLibrary", (msg) => {
			if (msg.requestId !== latestRequestId) return
			results = pendingIsAppend
				? [...results, ...msg.characters]
				: msg.characters
			hasMore = msg.hasMore
			loading = false
		})
		socket.on("characters:searchLibrary:error", (msg) => {
			if (msg.requestId !== latestRequestId) return
			loading = false
			if (!pendingIsAppend) results = []
			unreachable = !!msg.unreachable
			error =
				msg.error ||
				(msg.rateLimited
					? "This source is busy right now — try again shortly."
					: "Failed to search the character library.")
			announce(error)
		})
		socket.on("cardSources:cardDetail", (msg) => {
			if (msg.requestId !== latestDetailRequestId) return
			loadingDetail = false
			if (detailsFor) detailsFor = { ...detailsFor, ...msg }
		})
		socket.on("characters:importFromLibrary", (msg) => {
			downloadingKey = null
			if (msg.character) {
				announce(`Downloaded ${msg.character.name}.`)
				goto(`/document-view/characters/${msg.character.id}/edit`)
			}
		})
		socket.on(
			"characters:importFromLibrary:error",
			(msg: { error?: string }) => {
				downloadingKey = null
				status = msg.error || "Failed to download character."
				announce(status)
			}
		)
		socket.emit("cardSources:capabilities", {})
		fetchLibrary(false)
		return () => {
			socket.off("cardSources:capabilities")
			socket.off("characters:searchLibrary")
			socket.off("characters:searchLibrary:error")
			socket.off("cardSources:cardDetail")
			socket.off("characters:importFromLibrary")
			socket.off("characters:importFromLibrary:error")
		}
	})
</script>

<svelte:head>
	<title>Browse Character Library — Document View — Serene Pub</title>
</svelte:head>

<h1>Browse Character Library</h1>
<p><a href="/document-view/characters">Back to Characters</a></p>
<p class="a11y-hint">
	Browse and download ready-made characters from the Serene Pub community
	library.
</p>

{#if status}
	<div class="a11y-status" role="status">
		<p>{status}</p>
	</div>
{/if}

{#if capabilities && capabilities.sources.length > 1}
	<div class="a11y-field">
		<label for="a11y-char-browse-source">Source</label>
		<select
			id="a11y-char-browse-source"
			bind:value={activeSource}
			onchange={() => fetchLibrary(false)}
		>
			{#each capabilities.sources as s}
				<option value={s.id}>{s.label}</option>
			{/each}
		</select>
	</div>
{/if}

<form onsubmit={search}>
	<div class="a11y-field">
		<label for="a11y-char-browse-search">Search</label>
		<p class="a11y-hint">
			Searches names, descriptions, and tags.
			{#if activeSource === "charavault"}Supports tag:name, -exclude,
				creator:name, and "exact phrase".{/if}
		</p>
		<input
			id="a11y-char-browse-search"
			type="text"
			bind:value={searchTerm}
		/>
	</div>
	{#if activeSource === "charavault"}
		<div class="a11y-field">
			<label for="a11y-char-browse-sort">Sort</label>
			<select
				id="a11y-char-browse-sort"
				bind:value={activeSort}
				onchange={() => fetchLibrary(false)}
			>
				{#each SORT_OPTIONS as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>
		<div class="a11y-checkbox-field">
			<input
				id="a11y-char-browse-has-book"
				type="checkbox"
				bind:checked={hasBookOnly}
				onchange={() => fetchLibrary(false)}
			/>
			<label for="a11y-char-browse-has-book">
				Only cards with a lorebook
			</label>
		</div>
		{#if capabilities?.unsafeBrowsingEnabled}
			<div class="a11y-checkbox-field">
				<input
					id="a11y-char-browse-nsfw"
					type="checkbox"
					checked={userSettingsCtx.settings?.charaVaultIncludeNsfw ??
						false}
					onchange={(e) => toggleNsfw(e.currentTarget.checked)}
				/>
				<label for="a11y-char-browse-nsfw">Include NSFW results</label>
			</div>
		{/if}
	{/if}
	<button type="submit" class="a11y-btn a11y-btn-small" disabled={loading}>
		{loading ? "Searching…" : "Search"}
	</button>
</form>

{#if error}
	<div class="a11y-status a11y-status-error" role="alert">
		<p class="a11y-error-text">{error}</p>
		{#if unreachable}
			<button
				type="button"
				class="a11y-btn a11y-btn-small"
				onclick={() => fetchLibrary(false)}
			>
				Retry
			</button>
		{/if}
	</div>
{/if}

{#if !loading && results.length === 0 && !error}
	<p>No characters found.</p>
{/if}

<ul class="a11y-list">
	{#each results as item (`${item.source}:${item.file}`)}
		<li class="a11y-list-item">
			<h2>{item.name}</h2>
			<p class="a11y-hint">
				By {item.author || "Unknown"}{#if item.category}
					· {item.category}{/if}
			</p>
			<p>
				{#if detailsFor === item && item.description}
					{item.description}
				{:else}
					{item.description?.slice(0, 200) || ""}{item.description &&
					item.description.length > 200
						? "…"
						: ""}
				{/if}
			</p>
			{#if item.tags?.length}
				<p class="a11y-hint">Tags: {item.tags.join(", ")}</p>
			{/if}
			<div class="a11y-list-item-actions">
				<button
					type="button"
					class="a11y-btn a11y-btn-small"
					onclick={() => viewDetails(item)}
				>
					{loadingDetail && detailsFor === item
						? "Loading…"
						: "View Full Description"}
				</button>
				<button
					type="button"
					class="a11y-btn a11y-btn-small"
					onclick={() => download(item)}
					disabled={downloadingKey === `${item.source}:${item.file}`}
				>
					{downloadingKey === `${item.source}:${item.file}`
						? "Downloading…"
						: "Download"}
				</button>
			</div>
		</li>
	{/each}
</ul>

{#if hasMore}
	<button
		type="button"
		class="a11y-btn a11y-btn-small"
		onclick={loadMore}
		disabled={loading}
	>
		{loading ? "Loading…" : "Load More"}
	</button>
{/if}
