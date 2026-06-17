<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { z } from "zod"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	// Passphrase validation schema
	const passphraseSchema = z
		.string()
		.min(6, "Passphrase must be at least 6 characters long")
		.regex(/[a-z]/, "Passphrase must contain at least one lowercase letter")
		.regex(/[A-Z]/, "Passphrase must contain at least one uppercase letter")
		.regex(
			/[^a-zA-Z0-9]/,
			"Passphrase must contain at least one special character"
		)

	const socket = useTypedSocket()

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	// URL validation schema
	const urlSchema = z
		.string()
		.url()
		.refine((url) => {
			try {
				const parsed = new URL(url)
				return parsed.port !== "" || parsed.hostname === "localhost"
			} catch {
				return false
			}
		}, "URL must include a port (e.g., http://localhost:11434)")

	// State for ollama manager base URL
	let ollamaBaseUrlField = $state("")
	let ollamaBaseUrlError = $state("")
	let isSavingBaseUrl = $state(false)

	// State for koboldcpp manager
	let koboldCppBaseUrlField = $state("")
	let koboldCppBaseUrlError = $state("")
	let isSavingKoboldCppBaseUrl = $state(false)

	// Vectorization state
	type ModelDef = {
		id: string
		name: string
		description: string
		dimensions: number
		sizeLabel: string
		tier: "fast" | "balanced" | "best"
	}
	let availableModels = $state<ModelDef[]>([])
	let activeModelName = $state<string | null>(null)
	let vectorizationEnabled = $state(false)
	let modelReady = $state(false)
	let modelCached = $state(false)
	let modelLoadError = $state<string | null>(null)
	let showEnableVectorizationModal = $state(false)
	let selectedModelForEnable = $state<string>("")
	let isEnablingVectorization = $state(false)
	let isChangingModel = $state(false)
	let showChangeModelModal = $state(false)
	let selectedModelForChange = $state<string>("")
	let downloadProgress = $state<{
		status: "loading" | "downloading" | "ready" | "error"
		percent?: number
	} | null>(null)
	let queueStatus = $state<{
		status: "idle" | "running" | "paused"
		currentItem?: { type: string; label: string }
		queued: number
		completed: number
	}>({ status: "idle", queued: 0, completed: 0 })

	// State for enable accounts confirmation modal
	let showEnableAccountsModal = $state(false)
	let hasPassphrase = $state(false)
	let passphrase = $state("")
	let confirmPassphrase = $state("")
	let passphraseError = $state("")
	let isSettingPassphrase = $state(false)

	// Initialize base URL fields when system settings are available
	$effect(() => {
		if (systemSettingsCtx.settings?.ollamaManagerBaseUrl) {
			ollamaBaseUrlField = systemSettingsCtx.settings.ollamaManagerBaseUrl
		}
		if (systemSettingsCtx.settings?.koboldCppManagerBaseUrl) {
			koboldCppBaseUrlField = systemSettingsCtx.settings.koboldCppManagerBaseUrl
		}
	})

	async function onKoboldCppManagerEnabledClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}
		socket?.emit("systemSettings:updateKoboldCppManagerEnabled", {
			enabled: event.checked
		})
	}

	async function handleSaveKoboldCppBaseUrl() {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}

		const trimmedUrl = koboldCppBaseUrlField.trim()
		const result = urlSchema.safeParse(trimmedUrl)
		if (!result.success) {
			koboldCppBaseUrlError =
				result.error.errors[0]?.message || "Invalid URL format"
			return
		}

		koboldCppBaseUrlError = ""
		isSavingKoboldCppBaseUrl = true

		try {
			socket?.emit("koboldcpp:setBaseUrl", { baseUrl: trimmedUrl })
		} catch (error) {
			koboldCppBaseUrlError = "Failed to save URL"
			isSavingKoboldCppBaseUrl = false
		}
	}

	async function onOllamaManagerEnabledClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}

		socket?.emit("systemSettings:updateOllamaManagerEnabled", {
			enabled: event.checked
		})
	}

	async function handleSaveOllamaBaseUrl() {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}

		const trimmedUrl = ollamaBaseUrlField.trim()

		// Validate URL
		const result = urlSchema.safeParse(trimmedUrl)
		if (!result.success) {
			ollamaBaseUrlError =
				result.error.errors[0]?.message || "Invalid URL format"
			return
		}

		ollamaBaseUrlError = ""
		isSavingBaseUrl = true

		try {
			socket?.emit("systemSettings:updateOllamaManagerBaseUrl", {
				baseUrl: trimmedUrl
			})
		} catch (error) {
			ollamaBaseUrlError = "Failed to save URL"
			isSavingBaseUrl = false
		}
	}

	// ── Vectorization functions ──────────────────────────────────────────────

	function openEnableVectorizationModal() {
		selectedModelForEnable = availableModels[0]?.id ?? ""
		showEnableVectorizationModal = true
	}

	function cancelEnableVectorization() {
		showEnableVectorizationModal = false
		downloadProgress = null
	}

	async function confirmEnableVectorization(startNow: boolean) {
		if (!selectedModelForEnable) return
		isEnablingVectorization = true
		downloadProgress = null
		socket?.emit("vectorization:enable", {
			modelName: selectedModelForEnable,
			startNow
		})
	}

	function handleDisableVectorization() {
		socket?.emit("vectorization:disable", {})
	}

	function openChangeModelModal() {
		selectedModelForChange = activeModelName ?? availableModels[0]?.id ?? ""
		showChangeModelModal = true
	}

	function cancelChangeModel() {
		showChangeModelModal = false
		downloadProgress = null
	}

	async function confirmChangeModel() {
		if (!selectedModelForChange) return
		isChangingModel = true
		downloadProgress = null
		socket?.emit("vectorization:setModel", { modelName: selectedModelForChange })
	}

	// ── Account functions ────────────────────────────────────────────────────

	function handleEnableAccountsClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}

		if (event.checked) {
			// Check if user has a passphrase first
			socket?.emit("users:current:hasPassphrase", {})
		} else {
			// Allow disabling without confirmation (though it shouldn't be possible once enabled)
			socket?.emit("systemSettings:updateAccountsEnabled", {
				enabled: event.checked
			})
		}
	}

	function showEnableAccountsModalWithPassphraseCheck() {
		showEnableAccountsModal = true
		if (!hasPassphrase) {
			// Reset passphrase fields
			passphrase = ""
			confirmPassphrase = ""
			passphraseError = ""
		}
	}

	function validatePassphrase() {
		passphraseError = ""

		if (!passphrase) {
			passphraseError = "Passphrase is required"
			return false
		}

		if (passphrase !== confirmPassphrase) {
			passphraseError = "Passphrases do not match"
			return false
		}

		try {
			passphraseSchema.parse(passphrase)
			return true
		} catch (error) {
			if (error instanceof z.ZodError) {
				passphraseError = error.errors.map((e) => e.message).join(", ")
			}
			return false
		}
	}

	function handleSetPassphrase() {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}

		if (!validatePassphrase()) {
			return
		}

		isSettingPassphrase = true
		socket?.emit("users:current:setPassphrase", {
			passphrase: passphrase
		})
	}

	function confirmEnableAccounts() {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}

		if (!hasPassphrase && !validatePassphrase()) {
			return
		}

		if (!hasPassphrase) {
			// Set passphrase first
			handleSetPassphrase()
		} else {
			// User already has a passphrase, proceed with enabling accounts
			socket?.emit("systemSettings:updateAccountsEnabled", {
				enabled: true
			})
			showEnableAccountsModal = false
		}
	}

	function cancelEnableAccounts() {
		showEnableAccountsModal = false
		passphrase = ""
		confirmPassphrase = ""
		passphraseError = ""
		// The switch will remain in its previous state
	}

	// Fetch vectorization model list on mount
	$effect(() => {
		if (!socket) return
		socket.emit("vectorization:listModels", {})
	})

	// Listen for socket responses
	$effect(() => {
		if (!socket) return

		const handleKoboldCppManagerEnabled = (message: any) => {
			if (message.success) {
				toaster.success({
					title: `KoboldCPP Manager ${message.enabled ? "enabled" : "disabled"} successfully`
				})
			} else {
				toaster.error({
					title: "Failed to update KoboldCPP Manager setting"
				})
			}
		}

		const handleKoboldCppSetBaseUrl = (message: any) => {
			isSavingKoboldCppBaseUrl = false
			if (message.success) {
				toaster.success({ title: "KoboldCPP URL updated successfully" })
			} else {
				koboldCppBaseUrlError = "Failed to update URL"
				toaster.error({ title: "Failed to update KoboldCPP URL" })
			}
		}

		const handleOllamaManagerEnabled = (message: any) => {
			if (message.success) {
				toaster.success({
					title: `Ollama Manager ${message.enabled ? "enabled" : "disabled"} successfully`
				})
			} else {
				toaster.error({
					title: "Failed to update Ollama Manager setting"
				})
			}
		}

		const handleOllamaManagerBaseUrl = (message: any) => {
			isSavingBaseUrl = false
			if (message.success) {
				toaster.success({
					title: "Ollama URL updated successfully"
				})
			} else {
				ollamaBaseUrlError = "Failed to update URL"
				toaster.error({ title: "Failed to update Ollama URL" })
			}
		}

		const handleAccountsEnabled = (message: any) => {
			if (message.success) {
				toaster.success({
					title: "User accounts enabled successfully",
					description: "Authentication is now required for all users"
				})
			} else {
				toaster.error({ title: "Failed to enable user accounts" })
			}
		}

		// ── Vectorization listeners ──────────────────────────────────────────

		const handleListModels = (message: any) => {
			availableModels = message.models ?? []
			activeModelName = message.activeModelName ?? null
			vectorizationEnabled = message.vectorizationEnabled ?? false
			modelReady = message.modelReady ?? false
			modelCached = message.modelCached ?? false
			modelLoadError = message.loadError ?? null
			if (!selectedModelForEnable && availableModels.length > 0) {
				selectedModelForEnable = availableModels[0].id
			}
		}

		const handleVectorizationEnabled = (message: any) => {
			isEnablingVectorization = false
			downloadProgress = null
			if (message.success) {
				vectorizationEnabled = true
				showEnableVectorizationModal = false
				toaster.success({ title: "Vectorization enabled" })
				socket?.emit("vectorization:listModels", {})
			} else {
				toaster.error({ title: "Failed to enable vectorization" })
			}
		}

		const handleVectorizationDisabled = (message: any) => {
			if (message.success) {
				vectorizationEnabled = false
				activeModelName = null
				queueStatus = { status: "idle", queued: 0, completed: 0 }
				toaster.success({ title: "Vectorization disabled" })
				socket?.emit("vectorization:listModels", {})
			} else {
				toaster.error({ title: "Failed to disable vectorization" })
			}
		}

		const handleSetModel = (message: any) => {
			isChangingModel = false
			downloadProgress = null
			if (message.success) {
				activeModelName = message.modelName
				showChangeModelModal = false
				toaster.success({ title: `Model changed to ${message.modelName}` })
				socket?.emit("vectorization:listModels", {})
			} else {
				toaster.error({ title: "Failed to change model" })
			}
		}

		const handleModelDownloadProgress = (message: any) => {
			downloadProgress = { status: message.status, percent: message.percent }
			if (message.status === "error") {
				isEnablingVectorization = false
				isChangingModel = false
				toaster.error({ title: "Model download failed" })
			}
		}

		const handleVectorizationProgress = (message: any) => {
			queueStatus = {
				status: message.status,
				currentItem: message.currentItem,
				queued: message.queued,
				completed: message.completed
			}
		}

		const handleVectorizationEnableError = (message: any) => {
			isEnablingVectorization = false
			downloadProgress = null
			toaster.error({
				title: "Failed to enable vectorization",
				description: message.error
			})
		}

		const handleVectorizationSetModelError = (message: any) => {
			isChangingModel = false
			downloadProgress = null
			toaster.error({
				title: "Failed to change model",
				description: message.error
			})
		}

		socket.on("vectorization:listModels", handleListModels)
		socket.on("vectorization:enable", handleVectorizationEnabled)
		socket.on("vectorization:disable", handleVectorizationDisabled)
		socket.on("vectorization:setModel", handleSetModel)
		socket.on("vectorization:modelDownloadProgress", handleModelDownloadProgress)
		socket.on("vectorization:progress", handleVectorizationProgress)
		socket.on("vectorization:enable:error", handleVectorizationEnableError)
		socket.on("vectorization:setModel:error", handleVectorizationSetModelError)

		// ────────────────────────────────────────────────────────────────────

		const handleGenericError = (message: any) => {
			// Handle specific error events based on the event type
			if (message.error?.includes("passphrase")) {
				toaster.error({
					title: "Cannot enable user accounts",
					description: message.error
				})
			}
		}

		const handleHasPassphrase = (message: any) => {
			hasPassphrase = message.hasPassphrase
			if (hasPassphrase) {
				showEnableAccountsModalWithPassphraseCheck()
			} else {
				showEnableAccountsModalWithPassphraseCheck()
			}
		}

		const handleSetPassphrase = (message: any) => {
			isSettingPassphrase = false
			if (message.success) {
				hasPassphrase = true
				passphrase = ""
				confirmPassphrase = ""
				passphraseError = ""
				toaster.success({
					title: "Passphrase set successfully"
				})
				// Now enable accounts
				socket?.emit("systemSettings:updateAccountsEnabled", {
					enabled: true
				})
				showEnableAccountsModal = false
			} else {
				passphraseError = message.message || "Failed to set passphrase"
				toaster.error({
					title: "Failed to set passphrase",
					description: message.message
				})
			}
		}

		// Register event listeners
		socket.on(
			"systemSettings:updateKoboldCppManagerEnabled",
			handleKoboldCppManagerEnabled
		)
		socket.on("koboldcpp:setBaseUrl", handleKoboldCppSetBaseUrl)
		socket.on(
			"systemSettings:updateOllamaManagerEnabled",
			handleOllamaManagerEnabled
		)
		socket.on(
			"systemSettings:updateOllamaManagerBaseUrl",
			handleOllamaManagerBaseUrl
		)
		socket.on("systemSettings:updateAccountsEnabled", handleAccountsEnabled)
		socket.on("**:error", handleGenericError)
		socket.on("users:current:hasPassphrase", handleHasPassphrase)
		socket.on("users:current:setPassphrase", handleSetPassphrase)

		// Cleanup function to remove listeners
		return () => {
			socket.off("vectorization:listModels", handleListModels)
			socket.off("vectorization:enable", handleVectorizationEnabled)
			socket.off("vectorization:disable", handleVectorizationDisabled)
			socket.off("vectorization:setModel", handleSetModel)
			socket.off("vectorization:modelDownloadProgress", handleModelDownloadProgress)
			socket.off("vectorization:progress", handleVectorizationProgress)
			socket.off("vectorization:enable:error", handleVectorizationEnableError)
			socket.off("vectorization:setModel:error", handleVectorizationSetModelError)
			socket.off(
				"systemSettings:updateKoboldCppManagerEnabled",
				handleKoboldCppManagerEnabled
			)
			socket.off("koboldcpp:setBaseUrl", handleKoboldCppSetBaseUrl)
			socket.off(
				"systemSettings:updateOllamaManagerEnabled",
				handleOllamaManagerEnabled
			)
			socket.off(
				"systemSettings:updateOllamaManagerBaseUrl",
				handleOllamaManagerBaseUrl
			)
			socket.off(
				"systemSettings:updateAccountsEnabled",
				handleAccountsEnabled
			)
			socket.off("**:error", handleGenericError)
			socket.off("users:current:hasPassphrase", handleHasPassphrase)
			socket.off("users:current:setPassphrase", handleSetPassphrase)
		}
	})
</script>

{#if !!systemSettingsCtx.settings && userCtx.user?.isAdmin}
	<div class="flex flex-col gap-6">
		<!-- Ollama Manager Settings -->
		<div class="space-y-4">
			<h3 class="text-lg font-semibold">Ollama Manager</h3>

			<div class="flex items-center gap-2">
				<Switch
					name="ollama-manager"
					checked={systemSettingsCtx.settings?.ollamaManagerEnabled}
					onCheckedChange={onOllamaManagerEnabledClick}
				></Switch>
				<label for="ollama-manager" class="font-semibold">
					Enable Ollama Manager
				</label>
			</div>

			{#if systemSettingsCtx.settings?.ollamaManagerEnabled}
				<div class="ml-6 space-y-3">
					<div>
						<label
							class="text-foreground mb-1 block text-sm font-medium"
							for="ollamaBaseUrl"
						>
							Ollama Server URL
						</label>
						<input
							id="ollamaBaseUrl"
							type="text"
							bind:value={ollamaBaseUrlField}
							placeholder="http://localhost:11434"
							class="input w-full {ollamaBaseUrlError
								? 'border-error-500'
								: ''}"
						/>
						{#if ollamaBaseUrlError}
							<p class="text-error-500 mt-1 text-sm">
								{ollamaBaseUrlError}
							</p>
						{/if}
					</div>

					<button
						class="btn preset-filled-primary-500"
						onclick={handleSaveOllamaBaseUrl}
						disabled={isSavingBaseUrl}
					>
						{#if isSavingBaseUrl}
							<Icons.Loader2 class="h-4 w-4 animate-spin" />
							Saving...
						{:else}
							<Icons.Save class="h-4 w-4" />
							Save URL
						{/if}
					</button>
				</div>
			{/if}
		</div>

		<!-- KoboldCPP Manager Settings -->
		<div class="space-y-4">
			<h3 class="text-lg font-semibold">KoboldCPP Manager</h3>

			<div class="flex items-center gap-2">
				<Switch
					name="koboldcpp-manager"
					checked={systemSettingsCtx.settings?.koboldCppManagerEnabled}
					onCheckedChange={onKoboldCppManagerEnabledClick}
				></Switch>
				<label for="koboldcpp-manager" class="font-semibold">
					Enable KoboldCPP Manager
				</label>
			</div>

			{#if systemSettingsCtx.settings?.koboldCppManagerEnabled}
				<div class="ml-6 space-y-3">
					<div>
						<label
							class="text-foreground mb-1 block text-sm font-medium"
							for="koboldCppBaseUrl"
						>
							KoboldCPP Server URL
						</label>
						<input
							id="koboldCppBaseUrl"
							type="text"
							bind:value={koboldCppBaseUrlField}
							placeholder="http://localhost:5001"
							class="input w-full {koboldCppBaseUrlError
								? 'border-error-500'
								: ''}"
						/>
						{#if koboldCppBaseUrlError}
							<p class="text-error-500 mt-1 text-sm">
								{koboldCppBaseUrlError}
							</p>
						{/if}
					</div>

					<button
						class="btn preset-filled-primary-500"
						onclick={handleSaveKoboldCppBaseUrl}
						disabled={isSavingKoboldCppBaseUrl}
					>
						{#if isSavingKoboldCppBaseUrl}
							<Icons.Loader2 class="h-4 w-4 animate-spin" />
							Saving...
						{:else}
							<Icons.Save class="h-4 w-4" />
							Save URL
						{/if}
					</button>
				</div>
			{/if}
		</div>

		<!-- Vectorization Settings -->
		<div class="space-y-4">
			<h3 class="text-lg font-semibold">Vectorization</h3>

			<p class="text-muted-foreground text-sm">
				Enables semantic search and context retrieval using locally-run embedding
				models. When active, content is embedded in the background and used to
				improve lorebook retrieval and future causal graph features.
			</p>

			{#if !vectorizationEnabled}
				<button
					class="btn preset-filled-primary-500"
					onclick={openEnableVectorizationModal}
					disabled={availableModels.length === 0}
				>
					<Icons.Cpu class="h-4 w-4" />
					Enable Vectorization
				</button>
			{:else}
				<!-- Active state -->
				<div class="space-y-3">
					<!-- Model not in memory warning (server restart / load failure) -->
					{#if !modelReady}
						<div
							class="border-warning-500/30 bg-warning-500/10 flex items-start gap-3 rounded-lg border p-3"
						>
							<Icons.AlertTriangle class="text-warning-500 mt-0.5 h-4 w-4 shrink-0" />
							<div class="min-w-0 flex-1 space-y-2">
								{#if !modelCached}
									<p class="text-sm font-medium">Model files missing</p>
									<p class="text-muted-foreground text-xs">
										The embedding model is not in the local cache. Re-download it
										to resume vectorization.
									</p>
								{:else if modelLoadError}
									<p class="text-sm font-medium">Model failed to load</p>
									<p class="text-muted-foreground text-xs">{modelLoadError}</p>
								{:else}
									<p class="text-sm font-medium">Model not loaded</p>
									<p class="text-muted-foreground text-xs">
										The server restarted and the model needs to be reloaded before
										vectorization can run.
									</p>
								{/if}
								<button
									class="btn btn-sm preset-filled-warning-500"
									onclick={() =>
										activeModelName &&
										socket?.emit("vectorization:setModel", {
											modelName: activeModelName
										})}
									disabled={!activeModelName || isChangingModel}
								>
									{#if isChangingModel}
										<Icons.Loader2 class="h-3 w-3 animate-spin" />
										Loading…
									{:else}
										<Icons.Download class="h-3 w-3" />
										{modelCached ? "Reload Model" : "Re-download Model"}
									{/if}
								</button>
							</div>
						</div>
					{/if}

					<!-- Current model + queue status row -->
					<div class="bg-surface-200-800 flex items-center gap-3 rounded-lg p-3">
						<Icons.Cpu
							class="{modelReady ? 'text-primary-500' : 'text-muted-foreground'} h-5 w-5 shrink-0"
						/>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium">
								{availableModels.find((m) => m.id === activeModelName)?.name ??
									activeModelName ??
									"Unknown model"}
							</p>
							<p class="text-muted-foreground text-xs">
								{#if availableModels.find((m) => m.id === activeModelName)?.tier === "fast"}
									Fast ·
								{:else if availableModels.find((m) => m.id === activeModelName)?.tier === "balanced"}
									Balanced ·
								{:else if availableModels.find((m) => m.id === activeModelName)?.tier === "best"}
									Best ·
								{/if}
								{availableModels.find((m) => m.id === activeModelName)?.dimensions ?? "?"}d
								·
								{availableModels.find((m) => m.id === activeModelName)?.sizeLabel ?? ""}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							{#if !modelReady}
								<span
									class="bg-warning-500/20 text-warning-600 rounded-full px-2 py-0.5 text-xs font-medium"
								>
									Not loaded
								</span>
							{:else if queueStatus.status === "running"}
								<span
									class="bg-success-500/20 text-success-600 rounded-full px-2 py-0.5 text-xs font-medium"
								>
									Running
								</span>
							{:else if queueStatus.status === "paused"}
								<span
									class="bg-warning-500/20 text-warning-600 rounded-full px-2 py-0.5 text-xs font-medium"
								>
									Paused
								</span>
							{:else}
								<span
									class="bg-surface-300-600 text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium"
								>
									Idle
								</span>
							{/if}
						</div>
					</div>

					<!-- Queue progress -->
					{#if queueStatus.status !== "idle"}
						<div class="space-y-1">
							{#if queueStatus.currentItem}
								<p class="text-muted-foreground truncate text-xs">
									<Icons.Loader2
										class="mr-1 inline h-3 w-3 animate-spin"
									/>
									{queueStatus.currentItem.label}
								</p>
							{/if}
							<p class="text-muted-foreground text-xs">
								{queueStatus.completed} embedded
								{#if queueStatus.queued > 0}· {queueStatus.queued} remaining{/if}
							</p>
						</div>
					{/if}

					<!-- Controls -->
					<div class="flex flex-wrap gap-2">
						{#if queueStatus.status === "idle"}
							<button
								class="btn btn-sm preset-filled-success-500"
								onclick={() => socket?.emit("vectorization:startQueue", {})}
								disabled={!modelReady}
							>
								<Icons.Play class="h-3 w-3" />
								Start Queue
							</button>
						{:else}
							<button
								class="btn btn-sm preset-filled-warning-500"
								onclick={() => socket?.emit("vectorization:stopQueue", {})}
							>
								<Icons.Square class="h-3 w-3" />
								Stop Queue
							</button>
						{/if}

						<button
							class="btn btn-sm preset-tonal-surface"
							onclick={openChangeModelModal}
						>
							<Icons.RefreshCw class="h-3 w-3" />
							Change Model
						</button>

						<button
							class="btn btn-sm preset-tonal-error"
							onclick={handleDisableVectorization}
						>
							<Icons.PowerOff class="h-3 w-3" />
							Disable
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Account Settings -->
		<div class="space-y-4">
			<h3 class="text-lg font-semibold">Account Management</h3>

			<div class="flex items-center gap-2">
				<Switch
					name="enable-accounts"
					checked={systemSettingsCtx.settings?.isAccountsEnabled}
					onCheckedChange={handleEnableAccountsClick}
					disabled={systemSettingsCtx.settings?.isAccountsEnabled}
				></Switch>
				<label for="enable-accounts" class="font-semibold">
					Enable User Accounts
				</label>
			</div>

			{#if systemSettingsCtx.settings?.isAccountsEnabled}
				<p class="text-muted-foreground ml-6 text-sm">
					User accounts are enabled. This setting cannot be reversed.
				</p>
			{:else}
				<p class="text-muted-foreground ml-6 text-sm">
					Enable user authentication and multi-user support. This is a
					permanent change.
				</p>
			{/if}
		</div>
	</div>
{:else if !userCtx.user?.isAdmin}
	<div class="text-muted-foreground">
		Error: You do not have permission to view or modify system settings.
	</div>
{:else}
	<div class="text-muted-foreground">
		Error: No system settings available.
	</div>
{/if}

<!-- Enable Accounts Confirmation Modal -->
<Modal
	open={showEnableAccountsModal}
	onOpenChange={(e) => (showEnableAccountsModal = e.open)}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-lg"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex items-center justify-between">
			<h2 class="text-xl font-bold">Enable User Accounts</h2>
			<button class="btn-ghost" onclick={cancelEnableAccounts}>
				<Icons.X class="h-5 w-5" />
			</button>
		</header>
		<article class="space-y-4">
			<div class="text-warning-500 flex items-center gap-2">
				<Icons.AlertTriangle class="h-5 w-5" />
				<span class="font-semibold">Warning: Permanent Change</span>
			</div>
			<p>
				Enabling user accounts will activate authentication and
				multi-user support. This change is <strong>
					permanent and cannot be reversed
				</strong>
				.
			</p>
			<p class="text-muted-foreground text-sm">
				After enabling accounts, you will need to create accounts for
				all new users.
			</p>

			{#if !hasPassphrase}
				<div
					class="bg-warning-500/10 border-warning-500/20 space-y-3 rounded-lg border p-4"
				>
					<div class="text-warning-500 flex items-center gap-2">
						<Icons.Key class="h-4 w-4" />
						<span class="font-semibold">Passphrase Required</span>
					</div>
					<p class="text-sm">
						You need to set a passphrase for your account to
						continue.
					</p>

					<div class="space-y-3">
						<p class="text-sm">
							<label
								class="mb-1 block text-sm font-medium"
								for="username"
							>
								Username
							</label>
							<input
								id="username"
								value={userCtx.user!.username}
								class="input w-full"
								disabled
							/>
						</p>
						<div>
							<label
								class="mb-1 block text-sm font-medium"
								for="passphrase"
							>
								Passphrase
							</label>
							<input
								id="passphrase"
								type="password"
								bind:value={passphrase}
								placeholder="Enter your passphrase"
								class="input w-full {passphraseError
									? 'border-error-500'
									: ''}"
							/>
						</div>
						<div>
							<label
								class="mb-1 block text-sm font-medium"
								for="confirmPassphrase"
							>
								Confirm Passphrase
							</label>
							<input
								id="confirmPassphrase"
								type="password"
								bind:value={confirmPassphrase}
								placeholder="Confirm your passphrase"
								class="input w-full {passphraseError
									? 'border-error-500'
									: ''}"
							/>
						</div>
						{#if passphraseError}
							<p class="text-error-500 text-sm">
								{passphraseError}
							</p>
						{/if}
						<div class="text-muted-foreground text-xs">
							<p>Requirements:</p>
							<ul class="ml-2 list-inside list-disc space-y-1">
								<li>At least 6 characters long</li>
								<li>At least one lowercase letter</li>
								<li>At least one uppercase letter</li>
								<li>At least one special character</li>
							</ul>
						</div>
					</div>
				</div>
			{/if}
		</article>
		<footer class="flex justify-end gap-2">
			<button
				class="btn preset-tonal-surface"
				onclick={cancelEnableAccounts}
			>
				Cancel
			</button>
			<button
				class="btn preset-filled-warning-500"
				onclick={confirmEnableAccounts}
				disabled={isSettingPassphrase}
			>
				{#if isSettingPassphrase}
					<Icons.Loader2 class="h-4 w-4 animate-spin" />
					Setting up...
				{:else}
					<Icons.Shield class="h-4 w-4" />
					{hasPassphrase
						? "Enable Accounts"
						: "Set Passphrase & Enable"}
				{/if}
			</button>
		</footer>
	{/snippet}
</Modal>

<!-- Enable Vectorization Modal -->
<Modal
	open={showEnableVectorizationModal}
	onOpenChange={(e) => { if (!e.open) cancelEnableVectorization() }}
	contentBase="card bg-surface-100-900 p-6 space-y-5 shadow-xl max-w-lg w-full"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex items-center gap-3">
			<Icons.Cpu class="text-primary-500 h-5 w-5 shrink-0" />
			<h2 class="text-lg font-bold">Enable Vectorization</h2>
		</header>

		<p class="text-muted-foreground text-sm">
			Serene Pub will use this embedding model to index your content. The
			model runs locally on your machine. Larger models give better results
			but require more RAM and are slower to run.
		</p>

		<!-- Model list -->
		<div class="space-y-2">
			<p class="text-sm font-medium">Choose an embedding model</p>
			{#each availableModels as model}
				<label
					class="flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 transition-all
						{selectedModelForEnable === model.id
						? 'border-primary-500 bg-primary-500/5'
						: 'border-surface-300-600 hover:border-surface-400-500'}"
				>
					<input
						type="radio"
						name="vectorization-model"
						value={model.id}
						bind:group={selectedModelForEnable}
						class="mt-0.5"
					/>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-medium">{model.name}</span>
							{#if model.tier === "fast"}
								<span class="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-xs font-medium text-sky-600">Fast</span>
							{:else if model.tier === "balanced"}
								<span class="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-xs font-medium text-violet-600">Balanced</span>
							{:else}
								<span class="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600">Best</span>
							{/if}
							<span class="text-muted-foreground text-xs">{model.sizeLabel} · {model.dimensions}d</span>
						</div>
						<p class="text-muted-foreground mt-0.5 text-xs">{model.description}</p>
					</div>
				</label>
			{/each}
		</div>

		<!-- Download progress -->
		{#if downloadProgress}
			<div class="space-y-1">
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground capitalize">{downloadProgress.status}…</span>
					{#if downloadProgress.percent !== undefined}
						<span class="font-mono">{downloadProgress.percent}%</span>
					{/if}
				</div>
				{#if downloadProgress.percent !== undefined}
					<div class="bg-surface-300-600 h-1.5 w-full overflow-hidden rounded-full">
						<div
							class="bg-primary-500 h-full transition-all duration-300"
							style="width: {downloadProgress.percent}%"
						></div>
					</div>
				{:else}
					<div class="bg-surface-300-600 h-1.5 w-full overflow-hidden rounded-full">
						<div class="bg-primary-500 h-full w-1/3 animate-pulse rounded-full"></div>
					</div>
				{/if}
			</div>
		{/if}

		<footer class="flex flex-col gap-2">
			<div class="flex flex-wrap justify-end gap-2">
				<button
					class="btn preset-tonal-surface"
					onclick={cancelEnableVectorization}
					disabled={isEnablingVectorization}
				>
					Cancel
				</button>
				<button
					class="btn preset-tonal-primary"
					onclick={() => confirmEnableVectorization(false)}
					disabled={!selectedModelForEnable || isEnablingVectorization}
				>
					{#if isEnablingVectorization && !downloadProgress}
						<Icons.Loader2 class="h-4 w-4 animate-spin" />
					{:else}
						<Icons.Download class="h-4 w-4" />
					{/if}
					Enable, start later
				</button>
				<button
					class="btn preset-filled-primary-500"
					onclick={() => confirmEnableVectorization(true)}
					disabled={!selectedModelForEnable || isEnablingVectorization}
				>
					{#if isEnablingVectorization && !downloadProgress}
						<Icons.Loader2 class="h-4 w-4 animate-spin" />
					{:else}
						<Icons.Play class="h-4 w-4" />
					{/if}
					Enable &amp; Start Now
				</button>
			</div>
			<p class="text-muted-foreground text-right text-xs">
				Models are cached after the first download.
			</p>
		</footer>
	{/snippet}
</Modal>

<!-- Change Model Modal -->
<Modal
	open={showChangeModelModal}
	onOpenChange={(e) => { if (!e.open) cancelChangeModel() }}
	contentBase="card bg-surface-100-900 p-6 space-y-5 shadow-xl max-w-lg w-full"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex items-center gap-3">
			<Icons.RefreshCw class="text-primary-500 h-5 w-5 shrink-0" />
			<h2 class="text-lg font-bold">Change Embedding Model</h2>
		</header>

		<div class="text-warning-500 flex items-start gap-2 text-sm">
			<Icons.AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<p>
				Changing the model will stop the current vectorization queue. All
				existing embeddings will need to be regenerated with the new model.
			</p>
		</div>

		<!-- Model list -->
		<div class="space-y-2">
			{#each availableModels as model}
				<label
					class="flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 transition-all
						{selectedModelForChange === model.id
						? 'border-primary-500 bg-primary-500/5'
						: 'border-surface-300-600 hover:border-surface-400-500'}"
				>
					<input
						type="radio"
						name="change-model"
						value={model.id}
						bind:group={selectedModelForChange}
						class="mt-0.5"
					/>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-medium">{model.name}</span>
							{#if model.tier === "fast"}
								<span class="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-xs font-medium text-sky-600">Fast</span>
							{:else if model.tier === "balanced"}
								<span class="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-xs font-medium text-violet-600">Balanced</span>
							{:else}
								<span class="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600">Best</span>
							{/if}
							{#if model.id === activeModelName}
								<span class="bg-primary-500/20 text-primary-600 rounded-full px-1.5 py-0.5 text-xs">
									current
								</span>
							{/if}
							<span class="text-muted-foreground text-xs">{model.sizeLabel} · {model.dimensions}d</span>
						</div>
						<p class="text-muted-foreground mt-0.5 text-xs">{model.description}</p>
					</div>
				</label>
			{/each}
		</div>

		<!-- Download progress -->
		{#if downloadProgress}
			<div class="space-y-1">
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground capitalize">{downloadProgress.status}…</span>
					{#if downloadProgress.percent !== undefined}
						<span class="font-mono">{downloadProgress.percent}%</span>
					{/if}
				</div>
				{#if downloadProgress.percent !== undefined}
					<div class="bg-surface-300-600 h-1.5 w-full overflow-hidden rounded-full">
						<div
							class="bg-primary-500 h-full transition-all duration-300"
							style="width: {downloadProgress.percent}%"
						></div>
					</div>
				{:else}
					<div class="bg-surface-300-600 h-1.5 w-full overflow-hidden rounded-full">
						<div class="bg-primary-500 h-full w-1/3 animate-pulse rounded-full"></div>
					</div>
				{/if}
			</div>
		{/if}

		<footer class="flex justify-end gap-2">
			<button
				class="btn preset-tonal-surface"
				onclick={cancelChangeModel}
				disabled={isChangingModel}
			>
				Cancel
			</button>
			<button
				class="btn preset-filled-primary-500"
				onclick={confirmChangeModel}
				disabled={!selectedModelForChange || selectedModelForChange === activeModelName || isChangingModel}
			>
				{#if isChangingModel}
					<Icons.Loader2 class="h-4 w-4 animate-spin" />
					Loading…
				{:else}
					<Icons.RefreshCw class="h-4 w-4" />
					Switch Model
				{/if}
			</button>
		</footer>
	{/snippet}
</Modal>
