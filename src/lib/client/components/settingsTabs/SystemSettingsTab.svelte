<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
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
	let ollamaSettingsCtx: OllamaSettingsCtx = $state(
		getContext("ollamaSettingsCtx")
	)
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let disablingEmbeddings = $state(false)

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

	// State for enable accounts confirmation modal
	let showEnableAccountsModal = $state(false)
	let hasPassphrase = $state(false)
	let passphrase = $state("")
	let confirmPassphrase = $state("")
	let passphraseError = $state("")
	let isSettingPassphrase = $state(false)

	// State for the CharaVault integration — a single instance-wide
	// credential, admin-configured (not per-user), same shared-config
	// pattern as Connections/Ollama Manager/KoboldCPP Manager above.
	let charaVaultConnected = $state(false)
	let charaVaultConnectedEmail = $state<string | null>(null)
	let charaVaultEmailField = $state("")
	let charaVaultTokenField = $state("")
	let isConnectingCharaVault = $state(false)
	let isDisconnectingCharaVault = $state(false)

	// Initialize base URL fields when settings are available
	$effect(() => {
		if (ollamaSettingsCtx.settings?.ollamaManagerBaseUrl) {
			ollamaBaseUrlField = ollamaSettingsCtx.settings.ollamaManagerBaseUrl
		}
		if (koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl) {
			koboldCppBaseUrlField =
				koboldCppSettingsCtx.settings.koboldCppManagerBaseUrl
		}
	})

	// See the matching check in KoboldCppSettingsTab.svelte — this URL and the
	// Manager's own "Port" setting are supposed to stay in sync (this is what
	// everything actually talks to; the managed subprocess always listens on
	// the Port), but this field can be edited here independently of that one.
	let koboldCppPortMismatch = $derived.by(() => {
		if (koboldCppSettingsCtx.settings?.koboldCppManagedMode !== "managed")
			return false
		const managedPort = koboldCppSettingsCtx.settings?.koboldCppManagedPort
		const baseUrl = koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl
		if (!managedPort || !baseUrl) return false
		try {
			const urlPort = Number(new URL(baseUrl).port) || 80
			return urlPort !== managedPort
		} catch {
			return false
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

	// Enabling embeddings needs a model chosen (local vs API, which model) —
	// unlike the Ollama/KoboldCPP manager switches, there's no safe "just flip
	// it on" action, so the switch only ever turns things off here; turning it
	// on routes to the Connections sidebar's Embedding category setup flow
	// instead.
	function onEmbeddingsEnabledClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}
		if (event.checked) {
			panelsCtx.digest.connectionsView = "embedding"
			panelsCtx.openPanel({ key: "connections" })
			return
		}
		disablingEmbeddings = true
		socket?.emit("vectorization:disable", {})
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

	// ── Summarization functions ──────────────────────────────────────────────

	function handleSummarizationEnabledClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}
		socket?.emit("systemSettings:updateSummarizationEnabled", {
			enabled: event.checked
		})
	}

	// ── Context Debugging functions ──────────────────────────────────────────

	function handleContextDebuggingEnabledClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}
		socket?.emit("systemSettings:updateContextDebuggingEnabled", {
			enabled: event.checked
		})
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

	function connectCharaVault() {
		if (!userCtx.user?.isAdmin) return
		if (!charaVaultEmailField.trim() || !charaVaultTokenField.trim()) return
		isConnectingCharaVault = true
		socket?.emit("cardSources:charaVault:connect", {
			email: charaVaultEmailField.trim(),
			token: charaVaultTokenField.trim()
		})
	}

	function disconnectCharaVault() {
		if (!userCtx.user?.isAdmin) return
		isDisconnectingCharaVault = true
		socket?.emit("cardSources:charaVault:disconnect", {})
	}

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

		const handleEmbeddingsDisabled = (message: any) => {
			disablingEmbeddings = false
			if (message.success) {
				toaster.success({ title: "Embeddings disabled" })
			} else {
				toaster.error({ title: "Failed to disable embeddings" })
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

		// ────────────────────────────────────────────────────────────────────

		// "systemSettings:updateAccountsEnabled:error" isn't in the typed
		// SocketEventMap (only its success variant is), so this listener is
		// registered via the same `(socket as any).on(...)` cast used
		// elsewhere in the app for ad hoc error listeners (eg. +page.svelte's
		// "koboldcpp:connectModel:error"). Note: the "systemSettings:*Enabled"
		// switches are bound directly to `systemSettingsCtx.settings`, which
		// is only updated by the server on success, so on failure they
		// already revert to their prior (correct) state - this listener's
		// job is just to surface *why* it failed.
		const handleAccountsEnabledError = (message: { error?: string }) => {
			toaster.error({
				title: "Cannot enable user accounts",
				description: message.error
			})
		}

		const handleCharaVaultStatus = (
			message: Sockets.CardSources.CharaVaultStatus.Response
		) => {
			charaVaultConnected = message.connected
			charaVaultConnectedEmail = message.email
		}

		const handleCharaVaultConnect = (
			message: Sockets.CardSources.CharaVaultConnect.Response
		) => {
			isConnectingCharaVault = false
			if (message.success) {
				charaVaultEmailField = ""
				charaVaultTokenField = ""
				toaster.success({ title: "CharaVault account connected" })
				socket?.emit("cardSources:charaVault:status", {})
			}
		}

		const handleCharaVaultConnectError = (message: { error?: string }) => {
			isConnectingCharaVault = false
			toaster.error({
				title: "Failed to connect CharaVault account",
				description: message.error
			})
		}

		const handleCharaVaultDisconnect = (
			message: Sockets.CardSources.CharaVaultDisconnect.Response
		) => {
			isDisconnectingCharaVault = false
			if (message.success) {
				charaVaultConnected = false
				charaVaultConnectedEmail = null
				toaster.success({ title: "CharaVault account disconnected" })
			}
		}

		const handleCharaVaultDisconnectError = (message: {
			error?: string
		}) => {
			isDisconnectingCharaVault = false
			toaster.error({
				title: "Failed to disconnect CharaVault account",
				description: message.error
			})
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
		socket.on("vectorization:disable", handleEmbeddingsDisabled)
		socket.on("systemSettings:updateAccountsEnabled", handleAccountsEnabled)
		;(socket as any).on(
			"systemSettings:updateAccountsEnabled:error",
			handleAccountsEnabledError
		)
		socket.on("users:current:hasPassphrase", handleHasPassphrase)
		socket.on("users:current:setPassphrase", handleSetPassphrase)
		socket.on("cardSources:charaVault:status", handleCharaVaultStatus)
		socket.on("cardSources:charaVault:connect", handleCharaVaultConnect)
		;(socket as any).on(
			"cardSources:charaVault:connect:error",
			handleCharaVaultConnectError
		)
		socket.on(
			"cardSources:charaVault:disconnect",
			handleCharaVaultDisconnect
		)
		socket.on(
			"cardSources:charaVault:disconnect:error",
			handleCharaVaultDisconnectError
		)

		if (userCtx.user?.isAdmin) {
			socket.emit("cardSources:charaVault:status", {})
		}

		// Cleanup function to remove listeners
		return () => {
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
			socket.off("vectorization:disable", handleEmbeddingsDisabled)
			socket.off(
				"systemSettings:updateAccountsEnabled",
				handleAccountsEnabled
			)
			;(socket as any).off(
				"systemSettings:updateAccountsEnabled:error",
				handleAccountsEnabledError
			)
			socket.off("users:current:hasPassphrase", handleHasPassphrase)
			socket.off("users:current:setPassphrase", handleSetPassphrase)
			socket.off("cardSources:charaVault:status", handleCharaVaultStatus)
			socket.off(
				"cardSources:charaVault:connect",
				handleCharaVaultConnect
			)
			;(socket as any).off(
				"cardSources:charaVault:connect:error",
				handleCharaVaultConnectError
			)
			socket.off(
				"cardSources:charaVault:disconnect",
				handleCharaVaultDisconnect
			)
			socket.off(
				"cardSources:charaVault:disconnect:error",
				handleCharaVaultDisconnectError
			)
		}
	})
</script>

{#if !!systemSettingsCtx.settings && userCtx.user?.isAdmin}
	<div class="flex flex-col gap-6">
		{#if systemSettingsCtx.settings?.isAndroidWrapper}
			<div class="card preset-tonal space-y-4 p-4">
				<h3 class="text-lg font-semibold">Local Model Managers</h3>
				<p class="text-muted-foreground text-sm">
					Ollama Manager and KoboldCPP Manager aren't available in the
					Android app — they depend on locally-run binaries this build
					can't bundle. Connect to a remote Ollama or KoboldCPP
					instance from the Connections panel instead. Local
					embeddings aren't available either, for the same reason, but
					an external embeddings API works fine — set it up from the
					Embeddings panel.
				</p>
			</div>
		{:else}
			<!-- Ollama Manager Settings -->
			<div class="card preset-tonal space-y-4 p-4">
				<h3 class="text-lg font-semibold">Ollama Manager</h3>

				<div class="flex items-center gap-2">
					<Switch
						name="ollama-manager"
						checked={ollamaSettingsCtx.settings
							?.ollamaManagerEnabled}
						onCheckedChange={onOllamaManagerEnabledClick}
					>
						<Switch.Control
							class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
						>
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
						<Switch.Label class="font-semibold">
							Enable Ollama Manager
						</Switch.Label>
					</Switch>
				</div>

				{#if ollamaSettingsCtx.settings?.ollamaManagerEnabled}
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
			<div class="card preset-tonal space-y-4 p-4">
				<h3 class="text-lg font-semibold">KoboldCPP Manager</h3>

				<div class="flex items-center gap-2">
					<Switch
						name="koboldcpp-manager"
						checked={koboldCppSettingsCtx.settings
							?.koboldCppManagerEnabled}
						onCheckedChange={onKoboldCppManagerEnabledClick}
					>
						<Switch.Control
							class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
						>
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
						<Switch.Label class="font-semibold">
							Enable KoboldCPP Manager
						</Switch.Label>
					</Switch>
				</div>

				{#if koboldCppSettingsCtx.settings?.koboldCppManagerEnabled}
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
							{#if koboldCppPortMismatch}
								<div
									class="border-warning-500 bg-warning-500/10 mt-2 flex items-start gap-2 rounded-lg border p-3"
								>
									<Icons.AlertTriangle
										size={16}
										class="text-warning-700-300 mt-0.5 shrink-0"
									/>
									<p class="text-warning-700-300 text-sm">
										This doesn't match the managed
										subprocess's Port ({koboldCppSettingsCtx
											.settings?.koboldCppManagedPort}) in
										the KoboldCPP Manager panel's Settings
										tab. Everything talks to this URL, not
										that port — update one to match the
										other.
									</p>
								</div>
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

			<!-- Embeddings Settings -->
			<div class="card preset-tonal space-y-4 p-4">
				<h3 class="text-lg font-semibold">Embeddings</h3>

				<p class="text-muted-foreground text-sm">
					Powers retrieval-augmented context (RAG) for lore, history,
					and past messages. Turning this on opens the Embeddings
					panel to choose a local or API-based model — there's no
					in-place default to switch to.
				</p>

				<div class="flex items-center gap-2">
					<Switch
						name="embeddings-enabled"
						checked={systemSettingsCtx.settings
							?.vectorizationEnabled}
						disabled={disablingEmbeddings}
						onCheckedChange={onEmbeddingsEnabledClick}
					>
						<Switch.Control
							class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
						>
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
						<Switch.Label class="font-semibold">
							Enable Embeddings
						</Switch.Label>
					</Switch>
				</div>
			</div>
		{/if}

		<!-- Summarization Settings -->
		<div class="card preset-tonal space-y-4 p-4">
			<h3 class="text-lg font-semibold">Summarization</h3>

			<p class="text-muted-foreground text-sm">
				When enabled, you can select a range of chat messages and
				generate a Scene Summary from them (via an LLM), which feeds the
				Narrative Graph and can become a lorebook history entry. This is
				a manual, per-chat action — nothing runs automatically, and the
				original messages are never removed or replaced during prompt
				construction.
			</p>

			<div class="flex items-center gap-2">
				<Switch
					name="enable-summarization"
					checked={systemSettingsCtx.settings?.summarizationEnabled}
					onCheckedChange={handleSummarizationEnabledClick}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="font-semibold">
						{systemSettingsCtx.settings?.summarizationEnabled
							? "Summarization Enabled"
							: "Enable Summarization"}
					</Switch.Label>
				</Switch>
			</div>
		</div>

		<!-- Context Debugging -->
		<div class="card preset-tonal space-y-4 p-4">
			<h3 class="text-lg font-semibold">Context Debugging</h3>
			<p class="text-muted-foreground text-sm">
				When enabled, shows the prompt inspector tab in the chat UI,
				computes full RAG and infill diagnostics, and saves compiled
				prompt metadata alongside each generated message for later
				inspection.
			</p>
			<div class="flex items-center gap-2">
				<Switch
					name="enable-context-debugging"
					checked={systemSettingsCtx.settings
						?.contextDebuggingEnabled}
					onCheckedChange={handleContextDebuggingEnabledClick}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="font-semibold">
						{systemSettingsCtx.settings?.contextDebuggingEnabled
							? "Context Debugging Enabled"
							: "Enable Context Debugging"}
					</Switch.Label>
				</Switch>
			</div>
		</div>

		<!-- CharaVault Integration -->
		<div class="card preset-tonal space-y-4 p-4">
			<h3 class="text-lg font-semibold">Community Library: CharaVault</h3>
			<p class="text-muted-foreground text-sm">
				Connect one CharaVault account to enable browsing charavault.net
				from the Character Library. This account is shared instance-wide
				— it raises the search rate limit for every user on this Serene
				Pub instance, not just you. Create an App Password at
				charavault.net named "Serene Pub" and paste it below along with
				the account email.
			</p>

			{#if charaVaultConnected}
				<div class="flex items-center gap-2">
					<Icons.CheckCircle2 size={18} class="text-success-500" />
					<span class="text-sm">
						Connected{#if charaVaultConnectedEmail}
							as <span class="font-semibold">
								{charaVaultConnectedEmail}
							</span>{/if}
					</span>
					<button
						type="button"
						class="btn btn-sm preset-tonal-error ml-auto"
						onclick={disconnectCharaVault}
						disabled={isDisconnectingCharaVault}
					>
						{#if isDisconnectingCharaVault}
							<Icons.Loader2 size={16} class="animate-spin" />
						{:else}
							<Icons.Unlink size={16} />
						{/if}
						Disconnect
					</button>
				</div>
			{:else}
				<div class="flex flex-col gap-2 sm:flex-row">
					<input
						type="email"
						bind:value={charaVaultEmailField}
						placeholder="CharaVault account email"
						class="input flex-1"
						aria-label="CharaVault account email"
					/>
					<input
						type="password"
						bind:value={charaVaultTokenField}
						placeholder="App Password (cv_...)"
						class="input flex-1"
						aria-label="CharaVault App Password"
					/>
					<button
						type="button"
						class="btn preset-filled-primary-500 shrink-0"
						onclick={connectCharaVault}
						disabled={isConnectingCharaVault ||
							!charaVaultEmailField.trim() ||
							!charaVaultTokenField.trim()}
					>
						{#if isConnectingCharaVault}
							<Icons.Loader2 size={16} class="animate-spin" />
						{:else}
							<Icons.Link size={16} />
						{/if}
						Connect
					</button>
				</div>
			{/if}
		</div>

		<!-- Account Settings -->
		<div class="card preset-tonal space-y-4 p-4">
			<h3 class="text-lg font-semibold">Account Management</h3>

			<div class="flex items-center gap-2">
				<Switch
					name="enable-accounts"
					checked={systemSettingsCtx.settings?.isAccountsEnabled}
					onCheckedChange={handleEnableAccountsClick}
					disabled={systemSettingsCtx.settings?.isAccountsEnabled}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="font-semibold">
						Enable User Accounts
					</Switch.Label>
				</Switch>
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
<Dialog
	open={showEnableAccountsModal}
	onOpenChange={(e) => (showEnableAccountsModal = e.open)}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-w-lg space-y-6 p-6 shadow-xl"
			>
				<header class="flex items-center justify-between">
					<h2 class="text-xl font-bold">Enable User Accounts</h2>
					<button
						class="btn-ghost"
						aria-label="Close"
						onclick={cancelEnableAccounts}
					>
						<Icons.X class="h-5 w-5" />
					</button>
				</header>
				<article class="space-y-4">
					<div class="text-warning-500 flex items-center gap-2">
						<Icons.AlertTriangle class="h-5 w-5" />
						<span class="font-semibold">
							Warning: Permanent Change
						</span>
					</div>
					<p>
						Enabling user accounts will activate authentication and
						multi-user support. This change is <strong>
							permanent and cannot be reversed
						</strong>
						.
					</p>
					<p class="text-muted-foreground text-sm">
						After enabling accounts, you will need to create
						accounts for all new users.
					</p>

					{#if !hasPassphrase}
						<div
							class="bg-warning-500/10 border-warning-500/20 space-y-3 rounded-lg border p-4"
						>
							<div
								class="text-warning-500 flex items-center gap-2"
							>
								<Icons.Key class="h-4 w-4" />
								<span class="font-semibold">
									Passphrase Required
								</span>
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
									<ul
										class="ml-2 list-inside list-disc space-y-1"
									>
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
						class="btn preset-filled-surface-400-600"
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
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
