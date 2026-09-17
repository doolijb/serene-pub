<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import { isListedUnder } from "$lib/client/components/koboldcppManager/modelKindView"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = getContext(
		"koboldCppSettingsCtx"
	)
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let allowed = $derived(
		!!userCtx.user?.isAdmin &&
			!!koboldCppSettingsCtx.settings?.koboldCppManagerEnabled
	)

	let baseUrl = $state("")
	let modelsDir = $state("")
	let managedMode: "managed" | "external" | "" = $state("")
	let adminPassword = $state("")
	let savingField = $state("")
	let status = $state("")
	let error = $state("")

	let currentModel: string | null = $state(null)
	let availableModels: Sockets.KoboldCPP.ListModels.Response["availableModels"] =
		$state([])
	let modelsDirSet = $state(true)
	let loaded = $state(false)
	// Only source for "which text model is the instance's chat default": a
	// capability default is an (endpoint, model) PAIR, and an endpoint alone
	// names nothing.
	let connectionsList = $state<Sockets.Connections.List.Row[]>([])

	/**
	 * The (endpoint, model) pair the chat capability default names, read the
	 * same way KoboldCppModelsTab does: the endpoint must be THIS manager's
	 * own connection type, not some other KoboldCPP endpoint or a different
	 * provider entirely.
	 */
	function defaultTextModelName(): string | null {
		const pair = systemSettingsCtx.capabilityDefaults?.["text->text"]
		if (!pair?.connectionId || !pair.connectionModelId) return null
		const connection = connectionsList.find(
			(c) =>
				c.id === pair.connectionId &&
				c.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED
		)
		return (
			connection?.models.find((m) => m.id === pair.connectionModelId)
				?.model ?? null
		)
	}
	let inUseForChat = $derived(defaultTextModelName())

	let subprocessStatus:
		| Sockets.KoboldCPP.SubprocessStatus.Response
		| undefined = $state()
	// Announces any status transition (running/stopped/crashed/...), not just
	// ones the admin explicitly triggered here — a crash while unattended is
	// exactly the kind of thing that should still get announced.
	let previousSubprocessStatus: string | undefined = undefined
	$effect(() => {
		const current = subprocessStatus?.status
		if (
			current &&
			previousSubprocessStatus !== undefined &&
			current !== previousSubprocessStatus
		) {
			announce(`KoboldCPP subprocess is now ${current}.`)
		}
		previousSubprocessStatus = current
	})

	function refresh() {
		socket.emit("koboldcpp:listModels", {})
		socket.emit("koboldcpp:getSubprocessStatus", {})
		socket.emit("connections:list", {})
	}

	function saveBaseUrl(event: SubmitEvent) {
		event.preventDefault()
		savingField = "baseUrl"
		socket.emit("koboldcpp:setBaseUrl", { baseUrl: baseUrl.trim() })
	}

	function saveModelsDir(event: SubmitEvent) {
		event.preventDefault()
		savingField = "modelsDir"
		// `kind` is required and deliberately has no default: there are two
		// directory columns now, and a caller that guessed would repoint the
		// wrong one. This page has a single field and it means the text one.
		socket.emit("koboldcpp:setModelsDir", {
			dir: modelsDir.trim(),
			kind: "text"
		})
	}

	function saveManagedMode() {
		socket.emit("koboldcpp:setManagedMode", { mode: managedMode || null })
	}

	function saveAdminPassword(event: SubmitEvent) {
		event.preventDefault()
		savingField = "adminPassword"
		socket.emit("koboldcpp:setManagedAdminPassword", {
			password: adminPassword
		})
	}

	function loadModel(filename: string) {
		socket.emit("koboldcpp:loadModel", { filename })
	}
	function connectModel(modelName: string) {
		socket.emit("koboldcpp:connectModel", { modelName })
	}
	function deleteModel(modelName: string) {
		if (!confirm(`Delete model "${modelName}"? This cannot be undone.`))
			return
		socket.emit("koboldcpp:deleteModel", { modelName })
	}

	function startSubprocess() {
		socket.emit("koboldcpp:startSubprocess", {})
	}
	function stopSubprocess() {
		socket.emit("koboldcpp:stopSubprocess", {})
	}

	let searchTerm = $state("")
	let searchResults: Sockets.KoboldCPP.SearchModels.Response["models"] =
		$state([])
	let searching = $state(false)
	let searched = $state(false)
	let downloads: Record<
		string,
		Sockets.KoboldCPP.DownloadProgress.DownloadEntry
	> = $state({})

	let recommendedModels: Sockets.KoboldCPP.RecommendedModels.Response["models"] =
		$state([])
	let recommendedLoaded = $state(false)

	function searchModels(event: SubmitEvent) {
		event.preventDefault()
		if (!searchTerm.trim()) return
		searching = true
		searched = false
		socket.emit("koboldcpp:searchModels", { searchTerm: searchTerm.trim() })
	}

	function downloadModel(
		modelName: string,
		opt: {
			label: string
			filename: string
			downloadUrl: string
			sizeBytes?: number
		}
	) {
		socket.emit("koboldcpp:downloadModel", {
			modelName,
			filename: opt.filename,
			downloadUrl: opt.downloadUrl,
			sizeBytes: opt.sizeBytes
		})
	}

	function cancelDownload(filename: string) {
		socket.emit("koboldcpp:cancelDownload", { filename })
	}

	let downloadStatusText = $derived(
		Object.values(downloads)
			.filter((d) => !d.isDone)
			.map((d) => `${d.modelName || d.filename}: ${d.status}`)
			.join(". ")
	)

	// koboldCppSettingsCtx.settings arrives asynchronously (AccessibleShell's
	// own socket round-trip, kicked off after this page has already
	// mounted) — a one-time read in onMount would often run first and
	// capture empty strings permanently. Each field only ever auto-fills
	// once, so it doesn't overwrite whatever the admin is actively editing
	// afterward.
	let settingsFieldsInitialized = $state(false)
	$effect(() => {
		if (!settingsFieldsInitialized && koboldCppSettingsCtx.settings) {
			baseUrl =
				koboldCppSettingsCtx.settings.koboldCppManagerBaseUrl || ""
			modelsDir =
				koboldCppSettingsCtx.settings.koboldCppManagerModelsDir || ""
			managedMode =
				(koboldCppSettingsCtx.settings.koboldCppManagedMode as any) ||
				""
			settingsFieldsInitialized = true
		}
	})

	function handleListModels(msg: Sockets.KoboldCPP.ListModels.Response) {
		currentModel = msg.currentModel
		// Text models only. The listing now carries image models too (the scan
		// picks up `.safetensors`, and the curated SD models are `.gguf`), and
		// every action on this page — Load, Use for chat — treats
		// what it is given as a TEXT model. Offering an SD checkpoint here would
		// star a connection whose model cannot answer a chat, failing later with
		// an error naming the connection rather than the model.
		//
		// `isListedUnder` rather than `kind === "text"`, so an unverified file
		// stays visible here exactly as it does in the sidebar.
		availableModels = (msg.availableModels || []).filter((m) =>
			isListedUnder(m.kind, "text")
		)
		modelsDirSet = msg.modelsDirSet
		loaded = true
	}
	function handleSetBaseUrl() {
		savingField = ""
		status = "Base URL saved."
		announce(status)
	}
	function handleSetModelsDir() {
		savingField = ""
		status = "Models directory saved."
		announce(status)
		refresh()
	}
	function handleSetManagedMode() {
		status = "Managed mode saved."
		announce(status)
	}
	function handleSetManagedAdminPassword(msg: { error?: string }) {
		savingField = ""
		if (msg.error) {
			error = msg.error
			announce(error)
		} else {
			status = "Admin password saved."
			announce(status)
			adminPassword = ""
		}
	}
	function handleLoadModel() {
		status = "Model loaded."
		announce(status)
		refresh()
	}
	function handleConnectModel() {
		status = "Now using this model for chat."
		announce(status)
		// Re-requests `connections:list` so `inUseForChat` picks up the new
		// pair and the marker moves to this model.
		refresh()
	}
	function handleDeleteModel() {
		announce("Model deleted.")
		refresh()
	}
	function handleGetSubprocessStatus(
		msg: Sockets.KoboldCPP.GetSubprocessStatus.Response
	) {
		subprocessStatus = msg.status
	}
	function handleStartSubprocess() {
		refresh()
	}
	function handleStopSubprocess() {
		refresh()
	}
	function handleSearchModels(msg: Sockets.KoboldCPP.SearchModels.Response) {
		searching = false
		searched = true
		searchResults = msg.models || []
		announce(
			`${searchResults.length} model${searchResults.length === 1 ? "" : "s"} found.`
		)
	}
	function handleDownloadModel() {
		socket.emit("koboldcpp:getDownloadProgress", {})
	}
	function handleDownloadModelError(msg: { error?: string }) {
		error = msg.error || "Failed to start download."
		announce(error)
	}
	function handleGetDownloadProgress(msg: any) {
		downloads = msg.downloads || {}
	}
	function handleDownloadProgress(msg: any) {
		downloads = msg.downloads || {}
		if (Object.values(downloads).some((d) => d.isDone)) refresh()
	}
	function handleRecommendedModels(
		msg: Sockets.KoboldCPP.RecommendedModels.Response
	) {
		recommendedLoaded = true
		recommendedModels = msg.models || []
	}
	function handleRecommendedModelsError() {
		recommendedLoaded = true
		error = "Failed to load recommended models."
		announce(error)
	}

	// Every key is BARE — nothing in `koboldcpp:` carries an interest scope —
	// and every one is standing: this page is a long-lived form where each save,
	// search, download and subprocess control can be used again and again, and
	// `downloadProgress` is pushed for the life of a download.
	//
	// Declared ABOVE the mount that emits, because effects run in creation
	// order and `onMount` is an effect: the recommended-models and refresh
	// requests below would otherwise leave before the sync naming their keys.
	useInterest<"koboldcpp:listModels">(
		"koboldcpp:listModels",
		handleListModels
	)
	useInterest<"koboldcpp:setBaseUrl">(
		"koboldcpp:setBaseUrl",
		handleSetBaseUrl
	)
	useInterest<"koboldcpp:setModelsDir">(
		"koboldcpp:setModelsDir",
		handleSetModelsDir
	)
	useInterest<"koboldcpp:setManagedMode">(
		"koboldcpp:setManagedMode",
		handleSetManagedMode
	)
	useInterest<"koboldcpp:setManagedAdminPassword">(
		"koboldcpp:setManagedAdminPassword",
		handleSetManagedAdminPassword
	)
	useInterest<"koboldcpp:loadModel">("koboldcpp:loadModel", handleLoadModel)
	useInterest<"koboldcpp:connectModel">(
		"koboldcpp:connectModel",
		handleConnectModel
	)
	useInterest<"koboldcpp:deleteModel">(
		"koboldcpp:deleteModel",
		handleDeleteModel
	)
	useInterest<"koboldcpp:getSubprocessStatus">(
		"koboldcpp:getSubprocessStatus",
		handleGetSubprocessStatus
	)
	useInterest<"koboldcpp:startSubprocess">(
		"koboldcpp:startSubprocess",
		handleStartSubprocess
	)
	useInterest<"koboldcpp:stopSubprocess">(
		"koboldcpp:stopSubprocess",
		handleStopSubprocess
	)
	useInterest<"koboldcpp:searchModels">(
		"koboldcpp:searchModels",
		handleSearchModels
	)
	useInterest<"koboldcpp:downloadModel">(
		"koboldcpp:downloadModel",
		handleDownloadModel
	)
	useInterest<"koboldcpp:downloadModel:error">(
		"koboldcpp:downloadModel:error",
		handleDownloadModelError
	)
	useInterest<"koboldcpp:getDownloadProgress">(
		"koboldcpp:getDownloadProgress",
		handleGetDownloadProgress
	)
	useInterest<"koboldcpp:downloadProgress">(
		"koboldcpp:downloadProgress",
		handleDownloadProgress
	)
	useInterest<"koboldcpp:recommendedModels">(
		"koboldcpp:recommendedModels",
		handleRecommendedModels
	)
	useInterest<"koboldcpp:recommendedModels:error">(
		"koboldcpp:recommendedModels:error",
		handleRecommendedModelsError
	)
	// `connections:list` names the (endpoint, model) pair a capability
	// default points at; held here only to compute the "in use for chat"
	// marker below.
	useInterest<"connections:list">("connections:list", (msg) => {
		connectionsList = msg.connectionsList ?? []
	})

	onMount(() => {
		socket.emit("koboldcpp:recommendedModels", {})
		refresh()
	})
</script>

<svelte:head>
	<title>KoboldCPP Manager — Document View — Serene Pub</title>
</svelte:head>

<h1>KoboldCPP Manager</h1>

{#if !userCtx.user?.isAdmin}
	<p>Admin access required.</p>
{:else if !koboldCppSettingsCtx.settings?.koboldCppManagerEnabled}
	<p>
		The KoboldCPP Manager is turned off. Enable it from System Settings
		first.
	</p>
	<p><a href="/document-view/settings/system">Go to System Settings</a></p>
{:else}
	{#if status}
		<div class="a11y-status" role="status">
			<p>{status}</p>
		</div>
	{/if}
	{#if error}
		<div class="a11y-status a11y-status-error" role="alert">
			<p class="a11y-error-text">{error}</p>
		</div>
	{/if}

	<form onsubmit={saveBaseUrl}>
		<div class="a11y-field">
			<label for="a11y-kcpp-base-url">KoboldCPP Server URL</label>
			<input
				id="a11y-kcpp-base-url"
				type="text"
				bind:value={baseUrl}
				disabled={savingField === "baseUrl"}
			/>
		</div>
		<button
			type="submit"
			class="a11y-btn a11y-btn-small"
			disabled={savingField === "baseUrl"}
		>
			{savingField === "baseUrl" ? "Saving…" : "Save URL"}
		</button>
	</form>

	<form onsubmit={saveModelsDir}>
		<div class="a11y-field">
			<label for="a11y-kcpp-models-dir">Models Directory</label>
			<p class="a11y-hint">
				Folder on the server where .gguf model files are stored.
			</p>
			<input
				id="a11y-kcpp-models-dir"
				type="text"
				bind:value={modelsDir}
				disabled={savingField === "modelsDir"}
			/>
		</div>
		<button
			type="submit"
			class="a11y-btn a11y-btn-small"
			disabled={savingField === "modelsDir"}
		>
			{savingField === "modelsDir" ? "Saving…" : "Save Directory"}
		</button>
	</form>

	<div class="a11y-field">
		<label for="a11y-kcpp-managed-mode">Mode</label>
		<p class="a11y-hint">
			Managed: Serene Pub runs and controls a local KoboldCPP process for
			you. External: connect to a KoboldCPP instance you run and manage
			yourself.
		</p>
		<select
			id="a11y-kcpp-managed-mode"
			bind:value={managedMode}
			onchange={saveManagedMode}
		>
			<option value="">Not configured</option>
			<option value="managed">Managed</option>
			<option value="external">External</option>
		</select>
	</div>

	{#if managedMode === "managed"}
		<div class="a11y-status">
			<p>
				Subprocess status: {subprocessStatus?.status || "unknown"}
				{#if subprocessStatus?.isExternal}(an existing instance was
					found on this port, not started by this manager){/if}
			</p>
			<div class="a11y-list-item-actions">
				<button
					type="button"
					class="a11y-btn a11y-btn-small"
					onclick={startSubprocess}
					disabled={subprocessStatus?.status === "running"}
				>
					Start
				</button>
				<button
					type="button"
					class="a11y-btn a11y-btn-danger a11y-btn-small"
					onclick={stopSubprocess}
					disabled={subprocessStatus?.status !== "running"}
				>
					Stop
				</button>
			</div>
		</div>
	{/if}

	{#if managedMode === "external"}
		<form onsubmit={saveAdminPassword}>
			<div class="a11y-field">
				<label for="a11y-kcpp-admin-password">Admin API Password</label>
				<p class="a11y-hint">
					Required if your external KoboldCPP instance has the admin
					API password-protected.
					{#if koboldCppSettingsCtx.settings?.koboldCppManagedAdminPasswordSet}
						A password is currently saved.
					{/if}
				</p>
				<input
					id="a11y-kcpp-admin-password"
					type="password"
					autocomplete="off"
					bind:value={adminPassword}
					placeholder={koboldCppSettingsCtx.settings
						?.koboldCppManagedAdminPasswordSet
						? "••••••••"
						: ""}
					disabled={savingField === "adminPassword"}
				/>
			</div>
			<button
				type="submit"
				class="a11y-btn a11y-btn-small"
				disabled={savingField === "adminPassword"}
			>
				{savingField === "adminPassword" ? "Saving…" : "Save Password"}
			</button>
		</form>
	{/if}

	<h2>Recommended Models</h2>
	{#if !recommendedLoaded}
		<p>Loading…</p>
	{:else if recommendedModels.length === 0}
		<p>No recommendations available right now.</p>
	{:else}
		<ul class="a11y-list">
			{#each recommendedModels as m}
				<li class="a11y-list-item">
					<h3>{m.ollamaName ?? m.name}</h3>
					{#if m.description}<p>{m.description}</p>{/if}
					<p class="a11y-hint">
						{#if m.parameterSize}{m.parameterSize}{/if}
						{#if m.recommendedVram != null}· Recommended VRAM: {m.recommendedVram}
							GB{/if}
					</p>
					<div
						class="a11y-list-item-actions"
						role="group"
						aria-label="Download options for {m.ollamaName ??
							m.name}"
					>
						{#each m.pullOptions as opt}
							<button
								type="button"
								class="a11y-btn a11y-btn-small"
								onclick={() => downloadModel(m.name, opt)}
								disabled={!modelsDirSet}
							>
								Download {opt.label}
							</button>
						{/each}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<h2>Search for Models</h2>
	<form onsubmit={searchModels}>
		<div class="a11y-field">
			<label for="a11y-kcpp-search">Search Term</label>
			<input id="a11y-kcpp-search" type="text" bind:value={searchTerm} />
		</div>
		<button
			type="submit"
			class="a11y-btn a11y-btn-small"
			disabled={!searchTerm.trim() || searching}
		>
			{searching ? "Searching…" : "Search"}
		</button>
	</form>
	<div class="a11y-sr-only" role="status" aria-live="polite">
		{downloadStatusText}
	</div>
	{#if downloadStatusText}
		<div class="a11y-status">
			<p>{downloadStatusText}</p>
			{#each Object.values(downloads).filter((d) => !d.isDone) as d}
				<button
					type="button"
					class="a11y-btn a11y-btn-danger a11y-btn-small"
					onclick={() => cancelDownload(d.filename)}
				>
					Cancel {d.filename}
				</button>
			{/each}
		</div>
	{/if}
	{#if searched}
		{#if !modelsDirSet}
			<p>Set a models directory above before downloading.</p>
		{:else if searchResults.length === 0}
			<p>No GGUF models found for that search.</p>
		{:else}
			<ul class="a11y-list">
				{#each searchResults as m}
					<li class="a11y-list-item">
						<h3>{m.name}</h3>
						{#if m.description}<p>{m.description}</p>{/if}
						<div
							class="a11y-list-item-actions"
							role="group"
							aria-label="Download options for {m.name}"
						>
							{#each m.pullOptions as opt}
								<button
									type="button"
									class="a11y-btn a11y-btn-small"
									onclick={() => downloadModel(m.name, opt)}
									disabled={!modelsDirSet}
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

	<h2>Models</h2>
	{#if !modelsDirSet}
		<p>Set a models directory above to see available models.</p>
	{:else if !loaded}
		<p>Loading…</p>
	{:else if availableModels.length === 0}
		<p>No models found in the configured directory.</p>
	{:else}
		<ul class="a11y-list">
			{#each availableModels as m (m.name)}
				{@const modelName = m.modelName || m.name}
				{@const inUse = inUseForChat === modelName}
				<li class="a11y-list-item">
					<h3>{modelName}</h3>
					{#if m.name === currentModel}
						<p><strong>Currently loaded.</strong></p>
					{/if}
					<div class="a11y-list-item-actions">
						<button
							type="button"
							class="a11y-btn a11y-btn-small"
							onclick={() => loadModel(m.name)}
							disabled={m.name === currentModel}
						>
							Load
						</button>
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
							onclick={() => deleteModel(m.name)}
						>
							Delete
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<p class="a11y-hint">
		Managed-binary version controls aren't available in Document View yet —
		use the standard site for those.
	</p>
{/if}
