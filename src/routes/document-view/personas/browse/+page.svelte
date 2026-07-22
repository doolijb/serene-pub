<script lang="ts">
	import { onMount } from "svelte"
	import { goto } from "$app/navigation"
	import { v4 as uuid } from "uuid"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import type {
		LibraryCatalogItem,
		CardSourceId
	} from "$lib/shared/library/types"

	const socket = useTypedSocket()

	let capabilities: Sockets.CardSources.Capabilities.Response | null =
		$state(null)
	let activeSource: CardSourceId = $state("github-serenepub")
	let searchTerm = $state("")

	let results: LibraryCatalogItem[] = $state([])
	let loading = $state(false)
	let error = $state("")
	let unreachable = $state(false)

	let detailsFor: LibraryCatalogItem | null = $state(null)
	let loadingDetail = $state(false)
	let downloadingKey: string | null = $state(null)
	let status = $state("")

	let latestRequestId = ""
	let latestDetailRequestId = ""

	let sourcesForPersonas = $derived.by(
		() => capabilities?.sources.filter((s) => s.supportsPersonas) ?? []
	)

	function search(event?: SubmitEvent) {
		event?.preventDefault()
		fetchLibrary()
	}

	function fetchLibrary() {
		const requestId = uuid()
		latestRequestId = requestId
		loading = true
		error = ""
		unreachable = false
		socket.emit("personas:searchLibrary", {
			searchTerm,
			source: activeSource,
			requestId
		})
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
		socket.emit("personas:importFromLibrary", {
			source: item.source,
			ref: item.sourceRef
		})
	}

	onMount(() => {
		socket.on("cardSources:capabilities", (msg) => {
			capabilities = msg
		})
		socket.on("personas:searchLibrary", (msg) => {
			if (msg.requestId !== latestRequestId) return
			results = msg.personas
			loading = false
		})
		socket.on("personas:searchLibrary:error", (msg) => {
			if (msg.requestId !== latestRequestId) return
			loading = false
			results = []
			unreachable = !!msg.unreachable
			error =
				msg.error ||
				(msg.rateLimited
					? "This source is busy right now — try again shortly."
					: "Failed to search the persona library.")
			announce(error)
		})
		socket.on("cardSources:cardDetail", (msg) => {
			if (msg.requestId !== latestDetailRequestId) return
			loadingDetail = false
			if (detailsFor) detailsFor = { ...detailsFor, ...msg }
		})
		socket.on("personas:importFromLibrary", (msg) => {
			downloadingKey = null
			if (msg.persona) {
				announce(`Downloaded ${msg.persona.name}.`)
				goto(`/document-view/personas/${msg.persona.id}/edit`)
			}
		})
		socket.on(
			"personas:importFromLibrary:error",
			(msg: { error?: string }) => {
				downloadingKey = null
				status = msg.error || "Failed to download persona."
				announce(status)
			}
		)
		socket.emit("cardSources:capabilities", {})
		fetchLibrary()
		return () => {
			socket.off("cardSources:capabilities")
			socket.off("personas:searchLibrary")
			socket.off("personas:searchLibrary:error")
			socket.off("cardSources:cardDetail")
			socket.off("personas:importFromLibrary")
			socket.off("personas:importFromLibrary:error")
		}
	})
</script>

<svelte:head>
	<title>Browse Persona Library — Document View — Serene Pub</title>
</svelte:head>

<h1>Browse Persona Library</h1>
<p><a href="/document-view/personas">Back to Personas</a></p>
<p class="a11y-hint">
	Browse and download ready-made personas from the Serene Pub community
	library.
</p>

{#if status}
	<div class="a11y-status" role="status">
		<p>{status}</p>
	</div>
{/if}

{#if sourcesForPersonas.length > 1}
	<div class="a11y-field">
		<label for="a11y-persona-browse-source">Source</label>
		<select
			id="a11y-persona-browse-source"
			bind:value={activeSource}
			onchange={() => fetchLibrary()}
		>
			{#each sourcesForPersonas as s}
				<option value={s.id}>{s.label}</option>
			{/each}
		</select>
	</div>
{/if}

<form onsubmit={search}>
	<div class="a11y-field">
		<label for="a11y-persona-browse-search">Search</label>
		<p class="a11y-hint">Searches names, descriptions, and tags.</p>
		<input
			id="a11y-persona-browse-search"
			type="text"
			bind:value={searchTerm}
		/>
	</div>
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
				onclick={() => fetchLibrary()}
			>
				Retry
			</button>
		{/if}
	</div>
{/if}

{#if !loading && results.length === 0 && !error}
	<p>No personas found.</p>
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
