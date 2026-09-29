<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { OllamaModelSearchSource } from "$lib/shared/constants/OllamaModelSource"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import { ollamaChatDefaultModelName } from "$lib/client/components/ollamaManager/defaultModel"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")
	let ollamaSettingsCtx: OllamaSettingsCtx = getContext("ollamaSettingsCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let allowed = $derived(
		!!userCtx.user?.isAdmin &&
			!!ollamaSettingsCtx.settings?.ollamaManagerEnabled
	)

	let baseUrl = $state("")
	let baseUrlSaving = $state(false)
	let baseUrlStatus = $state("")

	let models: any[] = $state([])
	let runningModels: any[] = $state([])
	let loaded = $state(false)
	let error = $state("")
	// Only source for "which installed model is the instance's chat default":
	// a capability default is an (endpoint, model) PAIR, and an endpoint alone
	// names nothing.
	let connectionsList = $state<Sockets.Connections.List.Row[]>([])

	let pullModelName = $state("")
	let downloadingQuants: Record<
		string,
		{
			modelName: string
			status: string
			isDone: boolean
			files: Record<string, { total: number; completed: number }>
		}
	> = $state({})

	function formatSize(bytes?: number): string {
		if (!bytes) return ""
		const gb = bytes / 1024 / 1024 / 1024
		return `${gb.toFixed(1)} GB`
	}

	function refresh() {
		socket.emit("ollama:modelsList", {})
		socket.emit("ollama:listRunningModels", {})
		socket.emit("ollama:getDownloadProgress", {})
		socket.emit("connections:list", {})
	}

	function saveBaseUrl(event: SubmitEvent) {
		event.preventDefault()
		baseUrlSaving = true
		baseUrlStatus = ""
		socket.emit("ollama:setBaseUrl", { baseUrl: baseUrl.trim() })
	}

	function connectModel(modelName: string) {
		socket.emit("ollama:connectModel", { modelName })
	}

	function deleteModel(modelName: string) {
		if (
			!confirm(
				`Delete model "${modelName}" from Ollama? This cannot be undone.`
			)
		)
			return
		socket.emit("ollama:deleteModel", { modelName })
	}

	function pullModel(event: SubmitEvent) {
		event.preventDefault()
		if (!pullModelName.trim()) return
		socket.emit("ollama:pullModel", { modelName: pullModelName.trim() })
	}

	function cancelPull(modelName: string) {
		socket.emit("ollama:cancelPull", { modelName })
	}

	let recommendedModels: Sockets.Ollama.RecommendedModels.Response["recommendedModels"] =
		$state([])
	let recommendedLoaded = $state(false)

	let searchTerm = $state("")
	let searchResults: Sockets.Ollama.SearchAvailableModels.Response["models"] =
		$state([])
	let searching = $state(false)
	let searched = $state(false)

	function searchHuggingFace(event: SubmitEvent) {
		event.preventDefault()
		if (!searchTerm.trim()) return
		searching = true
		searched = false
		socket.emit("ollama:searchAvailableModels", {
			searchTerm: searchTerm.trim(),
			source: OllamaModelSearchSource.HUGGING_FACE
		})
	}

	function downloadPull(pull: string) {
		socket.emit("ollama:pullModel", { modelName: pull })
	}

	let pullStatusText = $derived(
		Object.values(downloadingQuants)
			.filter((d) => !d.isDone)
			.map((d) => `${d.modelName}: ${d.status}`)
			.join(". ")
	)

	// The installed model name the instance's chat capability default
	// currently resolves to, or null if it points elsewhere (another
	// provider, or nothing yet).
	let inUseForChat = $derived(
		ollamaChatDefaultModelName(
			connectionsList,
			systemSettingsCtx.capabilityDefaults
		)
	)

	// ollamaSettingsCtx.settings arrives asynchronously (AccessibleShell's own
	// socket round-trip, kicked off after this page has already mounted) —
	// a one-time read in onMount would often run first and capture an empty
	// string permanently. Only ever auto-fills once, so it doesn't overwrite
	// whatever the admin is actively typing afterward.
	let baseUrlInitialized = $state(false)
	$effect(() => {
		if (!baseUrlInitialized && ollamaSettingsCtx.settings) {
			baseUrl = ollamaSettingsCtx.settings.ollamaManagerBaseUrl || ""
			baseUrlInitialized = true
		}
	})

	function handleModelsList(msg: any) {
		models = msg.models || []
		loaded = true
	}
	function handleListRunningModels(msg: any) {
		runningModels = msg.runningModels || []
	}
	function handleSetBaseUrl() {
		baseUrlSaving = false
		baseUrlStatus = "Base URL saved."
		announce("Ollama server URL saved.")
	}
	function handleSetBaseUrlError(msg: { error?: string }) {
		baseUrlSaving = false
		baseUrlStatus = msg.error || "Failed to save base URL."
		announce(baseUrlStatus)
	}
	function handleConnectModel() {
		// `ollama:connectModel` registers the (endpoint, model) PAIR as the
		// instance's chat capability default — what the button says it does.
		baseUrlStatus = "Now using this model for chat."
		announce(baseUrlStatus)
		// Re-requests `connections:list` so `inUseForChat` picks up the new
		// pair and the marker moves to this model.
		refresh()
	}
	function handleConnectModelError(msg: { error?: string }) {
		error = msg.error || "Failed to use that model for chat."
		announce(error)
	}
	function handleDeleteModel() {
		announce("Model deleted.")
		refresh()
	}
	function handleDeleteModelError(msg: { error?: string }) {
		error = msg.error || "Failed to delete model."
		announce(error)
	}
	function handlePullModel() {
		pullModelName = ""
		announce("Model downloaded.")
		refresh()
	}
	function handlePullModelError(msg: { error?: string }) {
		error = msg.error || "Failed to download model."
		announce(error)
	}
	function handleGetDownloadProgress(msg: any) {
		downloadingQuants = msg.downloadingQuants || {}
	}
	function handlePullProgress(msg: any) {
		downloadingQuants = msg.downloadingQuants || {}
		if (Object.values(downloadingQuants).some((d) => d.isDone)) refresh()
	}
	function handleRecommendedModels(
		msg: Sockets.Ollama.RecommendedModels.Response
	) {
		recommendedModels = msg.recommendedModels || []
		recommendedLoaded = true
		if (msg.error) {
			error = msg.error
			announce(error)
		}
	}
	function handleSearchAvailableModels(
		msg: Sockets.Ollama.SearchAvailableModels.Response
	) {
		searching = false
		searched = true
		searchResults = msg.models || []
		if (msg.error) {
			error = msg.error
			announce(error)
		} else {
			announce(
				`${searchResults.length} model${searchResults.length === 1 ? "" : "s"} found.`
			)
		}
	}
	function handleSearchAvailableModelsError(msg: { error?: string }) {
		searching = false
		searched = true
		error = msg.error || "Search failed."
		announce(error)
	}

	/**
	 * Sixteen standing interests, all BARE — no `ollama:` event carries a
	 * scope, and this page is one screen over the whole manager rather than a
	 * view of one thing.
	 *
	 * Standing rather than one-shot even for the search: this page keeps its
	 * results on screen and re-searches into the same list, so there is no
	 * moment at which it stops wanting the reply. `ollama:pullProgress` is a
	 * push that arrives for the life of a pull. The `:error` halves are never
	 * gated (plan ruling 2) and are declared like any other key.
	 *
	 * Declared ABOVE `onMount`, which is an effect too and emits: the keys
	 * have to be held before the first request leaves, and the typed `emit`
	 * flushes the interest sync ahead of itself (plan ruling 3).
	 *
	 * `ollama:` is restricted interest — every handler behind it is admin-only
	 * — which is the same admin check this page's own body renders on.
	 * `connections:list` below is not restricted, but nothing here reaches a
	 * non-admin either, since `refresh()` that requests it is admin-gated UI.
	 */
	useInterest<"ollama:modelsList">("ollama:modelsList", handleModelsList)
	useInterest<"ollama:listRunningModels">(
		"ollama:listRunningModels",
		handleListRunningModels
	)
	useInterest<"ollama:setBaseUrl">("ollama:setBaseUrl", handleSetBaseUrl)
	useInterest<"ollama:setBaseUrl:error">(
		"ollama:setBaseUrl:error",
		handleSetBaseUrlError
	)
	useInterest<"ollama:connectModel">(
		"ollama:connectModel",
		handleConnectModel
	)
	useInterest<"ollama:connectModel:error">(
		"ollama:connectModel:error",
		handleConnectModelError
	)
	useInterest<"ollama:deleteModel">("ollama:deleteModel", handleDeleteModel)
	useInterest<"ollama:deleteModel:error">(
		"ollama:deleteModel:error",
		handleDeleteModelError
	)
	useInterest<"ollama:pullModel">("ollama:pullModel", handlePullModel)
	useInterest<"ollama:pullModel:error">(
		"ollama:pullModel:error",
		handlePullModelError
	)
	useInterest<"ollama:getDownloadProgress">(
		"ollama:getDownloadProgress",
		handleGetDownloadProgress
	)
	useInterest<"ollama:pullProgress">(
		"ollama:pullProgress",
		handlePullProgress
	)
	useInterest<"ollama:recommendedModels">(
		"ollama:recommendedModels",
		handleRecommendedModels
	)
	useInterest<"ollama:searchAvailableModels">(
		"ollama:searchAvailableModels",
		handleSearchAvailableModels
	)
	useInterest<"ollama:searchAvailableModels:error">(
		"ollama:searchAvailableModels:error",
		handleSearchAvailableModelsError
	)
	useInterest<"connections:list">("connections:list", (msg) => {
		connectionsList = msg.connectionsList ?? []
	})

	onMount(() => {
		refresh()
		socket.emit("ollama:recommendedModels", {})
	})
</script>

<svelte:head>
	<title>Ollama, managed — Document View — Serene Pub</title>
</svelte:head>

<h1>Ollama, managed</h1>

{#if !userCtx.user?.isAdmin}
	<p>Admin access required.</p>
{:else if !ollamaSettingsCtx.settings?.ollamaManagerEnabled}
	<p>
		Ollama, managed, is turned off. Enable it from System settings first.
	</p>
	<p><a href="/document-view/settings/system">Go to System settings</a></p>
{:else}
	{#if error}
		<div class="a11y-status a11y-status-error" role="alert">
			<p class="a11y-error-text">{error}</p>
		</div>
	{/if}

	<form onsubmit={saveBaseUrl}>
		<div class="a11y-field">
			<label for="a11y-ollama-base-url">Ollama server URL</label>
			<input
				id="a11y-ollama-base-url"
				type="text"
				bind:value={baseUrl}
				disabled={baseUrlSaving}
			/>
		</div>
		<button
			type="submit"
			class="a11y-btn a11y-btn-small"
			disabled={baseUrlSaving}
		>
			{baseUrlSaving ? "Saving…" : "Save URL"}
		</button>
		{#if baseUrlStatus}
			<p role="status">{baseUrlStatus}</p>
		{/if}
	</form>

	<h2>Download a Model</h2>
	<form onsubmit={pullModel}>
		<div class="a11y-field">
			<label for="a11y-ollama-pull-name">Model name</label>
			<p class="a11y-hint">
				E.g. "llama3.1" or "qwen2.5:7b" — see Ollama's model library.
			</p>
			<input
				id="a11y-ollama-pull-name"
				type="text"
				bind:value={pullModelName}
			/>
		</div>
		<button
			type="submit"
			class="a11y-btn a11y-btn-small"
			disabled={!pullModelName.trim()}
		>
			Download
		</button>
	</form>
	<div class="a11y-sr-only" role="status" aria-live="polite">
		{pullStatusText}
	</div>
	{#if pullStatusText}
		<div class="a11y-status">
			<p>{pullStatusText}</p>
			{#each Object.values(downloadingQuants).filter((d) => !d.isDone) as d}
				<button
					type="button"
					class="a11y-btn a11y-btn-danger a11y-btn-small"
					onclick={() => cancelPull(d.modelName)}
				>
					Cancel {d.modelName}
				</button>
			{/each}
		</div>
	{/if}

	<h2>Recommended models</h2>
	{#if !recommendedLoaded}
		<p>Loading…</p>
	{:else if recommendedModels.length === 0}
		<p>No recommendations available right now.</p>
	{:else}
		<ul class="a11y-list">
			{#each recommendedModels as m}
				<li class="a11y-list-item">
					<h3>{m.name}</h3>
					<p>{m.details?.description}</p>
					<p class="a11y-hint">
						{m.details?.parameter_size} · {m.details
							?.quantization_level}
						{#if m.recommended_vram}· Recommended VRAM: {m.recommended_vram}
							GB{/if}
					</p>
					<div class="a11y-list-item-actions">
						<button
							type="button"
							class="a11y-btn a11y-btn-small"
							onclick={() => downloadPull(m.pull)}
						>
							Download
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<h2>Search Hugging Face for Models</h2>
	<form onsubmit={searchHuggingFace}>
		<div class="a11y-field">
			<label for="a11y-ollama-search">Search term</label>
			<input
				id="a11y-ollama-search"
				type="text"
				bind:value={searchTerm}
			/>
		</div>
		<button
			type="submit"
			class="a11y-btn a11y-btn-small"
			disabled={!searchTerm.trim() || searching}
		>
			{searching ? "Searching…" : "Search"}
		</button>
	</form>
	{#if searched}
		{#if searchResults.length === 0}
			<p>No GGUF models found for that search.</p>
		{:else}
			<ul class="a11y-list">
				{#each searchResults as m}
					<li class="a11y-list-item">
						<h3>{m.name}</h3>
						{#if m.description}<p>{m.description}</p>{/if}
						<div class="a11y-list-item-actions">
							{#each m.pullOptions || [] as opt}
								<button
									type="button"
									class="a11y-btn a11y-btn-small"
									onclick={() => downloadPull(opt.pull)}
								>
									Download {opt.label}
								</button>
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}

	<h2>Installed models</h2>
	{#if !loaded}
		<p>Loading…</p>
	{:else if models.length === 0}
		<p>No models installed yet.</p>
	{:else}
		<ul class="a11y-list">
			{#each models as m}
				{@const modelName = m.name || m.model}
				{@const inUse = inUseForChat === modelName}
				<li class="a11y-list-item">
					<h3>{modelName}</h3>
					<p>{formatSize(m.size)}</p>
					<div class="a11y-list-item-actions">
						<button
							type="button"
							class="a11y-btn a11y-btn-small"
							onclick={() => connectModel(modelName)}
							disabled={inUse}
							aria-pressed={inUse}
						>
							{inUse ? "In use for chat" : "Use for chat"}
						</button>
						<button
							type="button"
							class="a11y-btn a11y-btn-danger a11y-btn-small"
							onclick={() => deleteModel(modelName)}
						>
							Delete
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<h2>Currently running</h2>
	{#if runningModels.length === 0}
		<p>No models are currently loaded in memory.</p>
	{:else}
		<ul class="a11y-list">
			{#each runningModels as m}
				<li class="a11y-list-item">{m.name || m.model}</li>
			{/each}
		</ul>
	{/if}
{/if}
