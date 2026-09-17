<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { z } from "zod"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import LanguagePicker from "$lib/client/components/inputs/LanguagePicker.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"

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

	interface Props {
		hasUnsavedChanges?: boolean
	}

	let { hasUnsavedChanges = $bindable(false) }: Props = $props()

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

	// Initialize base URL field when settings are available
	$effect(() => {
		if (koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl) {
			koboldCppBaseUrlField =
				koboldCppSettingsCtx.settings.koboldCppManagerBaseUrl
		}
	})

	// ── Unsaved changes ────────────────────────────────────────────
	// koboldCppBaseUrlField re-syncs from context above whenever a save
	// succeeds, so it self-resolves back to false without an explicit
	// post-save reset. The CharaVault fields are write-only credentials
	// (no "original" value to diff against) that already reset to "" on a
	// successful connect (see the charaVault:connect success handler
	// below) — so "non-empty" is what "dirty" means for those two.
	$effect(() => {
		hasUnsavedChanges =
			koboldCppBaseUrlField.trim() !==
				(koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl ??
					"") ||
			// Re-syncs from context on save, same as the KoboldCPP URL above,
			// so it self-resolves back to false without a post-save reset.
			autoTranslateEndpointField.trim() !==
				(systemSettingsCtx.settings?.autoTranslateEndpoint ?? "") ||
			charaVaultEmailField.trim() !== "" ||
			charaVaultTokenField.trim() !== ""
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

	function handleScriptsEnabledClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}
		socket?.emit("systemSettings:updateScriptsEnabled", {
			enabled: event.checked
		})
	}

	// ── Backups (ruled 2026-09-10) ───────────────────────────────────────────

	function handleBackupDailyClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}
		socket?.emit("systemSettings:updateBackupSettings", {
			backupDaily: event.checked
		})
	}

	function handleBackupIncludeUserFilesClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}
		socket?.emit("systemSettings:updateBackupSettings", {
			backupIncludeUserFiles: event.checked
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

	// ── Language (R5) ────────────────────────────────────────────────────────

	function requireAdmin(): boolean {
		if (userCtx.user?.isAdmin) return true
		toaster.error({
			title: "Access denied",
			description: "Admin privileges required"
		})
		return false
	}

	function handleDefaultLanguageChange(language: string) {
		if (!language || !requireAdmin()) return
		socket?.emit("systemSettings:updateDefaultLanguage", { language })
	}

	// Buffered rather than emitted per keystroke: the endpoint is a URL being
	// typed, and half of one is not a setting. `hasUnsavedChanges` above tracks
	// it so navigating away mid-edit warns, exactly as the KoboldCPP URL does.
	let autoTranslateEndpointField = $state("")
	$effect(() => {
		autoTranslateEndpointField =
			systemSettingsCtx.settings?.autoTranslateEndpoint ?? ""
	})

	function saveAutoTranslate(next: {
		enabled?: boolean
		engine?: "google" | "libre"
		endpoint?: string | null
	}) {
		if (!requireAdmin()) return
		const settings = systemSettingsCtx.settings
		socket?.emit("systemSettings:updateAutoTranslate", {
			enabled: next.enabled ?? settings?.autoTranslateEnabled ?? false,
			engine:
				next.engine ??
				((settings?.autoTranslateEngine ?? "google") as
					| "google"
					| "libre"),
			endpoint:
				next.endpoint !== undefined
					? next.endpoint
					: autoTranslateEndpointField.trim() || null
		})
	}

	// ── Legacy configs visibility ────────────────────────────────────────────

	function handleLegacyConfigsVisibleClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({
				title: "Access denied",
				description: "Admin privileges required"
			})
			return
		}
		socket?.emit("systemSettings:updateLegacyConfigsVisible", {
			visible: event.checked
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

		// The "systemSettings:*Enabled" switches are bound directly to
		// `systemSettingsCtx.settings`, which the server only updates on
		// success, so on failure they already revert to their prior (correct)
		// state - this handler's job is just to surface *why* it failed. It is
		// declared through the interest registry below, like every other
		// listener here; `:error` events are typed members of SocketEventMap
		// and are never gated (plan ruling 2).
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

		// The KoboldCPP URL save's own reply. BARE like the rest — the family
		// has no interest scope — and standing, because the field can be saved
		// again without this tab remounting. `koboldcpp:` is RESTRICTED
		// interest, so the registry itself refuses the key for a known
		// non-admin and holds it while the user is still unknown.
		const koboldCppReleases = [
			declareInterest<"koboldcpp:setBaseUrl">(
				"koboldcpp:setBaseUrl",
				handleKoboldCppSetBaseUrl
			)
		]

		// The three instance-setting write replies and the two passphrase
		// ones, on the interest registry. All BARE — none is in
		// `SCOPED_EVENTS`; each is about this instance or this account, with
		// nothing to narrow to — and all standing, because every one of these
		// toggles can be pressed again while the tab stays open.
		//
		// The ordinary app-wide registry, not `adminInterest`: that context
		// exists only under `/admin`, and this tab is in the Settings sidebar.
		// Neither `systemSettings:` nor `users:` is a restricted prefix, so the
		// admin boundary here is the one the server's own handlers hold.
		const settingReleases = [
			declareInterest<"systemSettings:updateKoboldCppManagerEnabled">(
				"systemSettings:updateKoboldCppManagerEnabled",
				handleKoboldCppManagerEnabled
			),
			declareInterest<"systemSettings:updateOllamaManagerEnabled">(
				"systemSettings:updateOllamaManagerEnabled",
				handleOllamaManagerEnabled
			),
			declareInterest<"systemSettings:updateAccountsEnabled">(
				"systemSettings:updateAccountsEnabled",
				handleAccountsEnabled
			),
			declareInterest<"systemSettings:updateAccountsEnabled:error">(
				"systemSettings:updateAccountsEnabled:error",
				handleAccountsEnabledError
			),
			declareInterest<"users:current:hasPassphrase">(
				"users:current:hasPassphrase",
				handleHasPassphrase
			),
			declareInterest<"users:current:setPassphrase">(
				"users:current:setPassphrase",
				handleSetPassphrase
			)
		]

		// The CharaVault card source, on the interest registry. All five keys
		// are BARE: one account is connected at a time, so none of these
		// replies is about a particular row and none has an interest scope to
		// narrow to. Standing, because `status` is re-sent after a connect or
		// a disconnect.
		const cardSourceReleases = [
			declareInterest<"cardSources:charaVault:status">(
				"cardSources:charaVault:status",
				handleCharaVaultStatus
			),
			declareInterest<"cardSources:charaVault:connect">(
				"cardSources:charaVault:connect",
				handleCharaVaultConnect
			),
			declareInterest<"cardSources:charaVault:connect:error">(
				"cardSources:charaVault:connect:error",
				handleCharaVaultConnectError
			),
			declareInterest<"cardSources:charaVault:disconnect">(
				"cardSources:charaVault:disconnect",
				handleCharaVaultDisconnect
			),
			declareInterest<"cardSources:charaVault:disconnect:error">(
				"cardSources:charaVault:disconnect:error",
				handleCharaVaultDisconnectError
			)
		]

		if (userCtx.user?.isAdmin) {
			socket.emit("cardSources:charaVault:status", {})
		}

		// Cleanup function to release this tab's interest
		return () => {
			hasUnsavedChanges = false
			for (const release of koboldCppReleases) release()
			for (const release of settingReleases) release()
			for (const release of cardSourceReleases) release()
		}
	})
</script>

{#if !!systemSettingsCtx.settings && userCtx.user?.isAdmin}
	<div class="flex flex-col gap-6">
		{#if systemSettingsCtx.settings?.isAndroidWrapper}
			<div class="card preset-filled-surface-100-900 space-y-4 p-4">
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
			<div class="card preset-filled-surface-100-900 space-y-4 p-4">
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
					<!-- Base URL is only configured from the Ollama Manager
					     panel (Connections), not here — this settings tab
					     used to duplicate that field with a save action that
					     had no server handler wired up. -->
				</div>
			</div>

			<!-- KoboldCPP Manager Settings -->
			<div class="card preset-filled-surface-100-900 space-y-4 p-4">
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

			<!-- Embeddings -->
			<div class="card preset-filled-surface-100-900 space-y-4 p-4">
				<h3 class="text-lg font-semibold">Embeddings</h3>

				<p class="text-muted-foreground text-sm">
					Powers retrieval-augmented context (RAG) for lore, history,
					and past messages.
				</p>

				<!-- ⚠ There is no Enable switch here any more, and there must
				     not be one. An embedding endpoint is a CONNECTION, and
				     embeddings are on when one is starred for it: a switch
				     beside that would be a second place the same fact is
				     stored, which is exactly what
				     `system_settings.vectorization_enabled` was. It also could
				     never turn anything ON by itself, because "on" needs a
				     model chosen, so it only ever read as a way to switch off
				     something configured elsewhere. -->
				<p class="text-muted-foreground text-sm">
					Choose an embedding connection in the Connections panel. The
					one marked "in use" is the one that runs; leaving none in
					use turns retrieval back to keyword search.
				</p>

				<button
					type="button"
					class="btn preset-filled-primary-500"
					onclick={() => {
						panelsCtx.digest.connectionsModality = "embeddings"
						panelsCtx.openPanel({ key: "connections" })
					}}
				>
					<Icons.Zap class="h-4 w-4" />
					Open embedding connections
				</button>
			</div>
		{/if}

		<!-- Scripts (the fourth paradigm's kill switch, 18 §10) -->
		<div class="card preset-filled-surface-100-900 space-y-4 p-4">
			<h3 class="text-lg font-semibold">Scripts</h3>

			<p class="text-muted-foreground text-sm">
				User-authored scripts that transform pipeline runs — slop
				filters, stop guards, reminders at a depth. Off is a recovery
				lever, not a purge: every chain and attachment stays in place
				and simply does nothing until this is switched back on.
			</p>

			<div class="flex items-center gap-2">
				<Switch
					name="scripts-enabled"
					checked={systemSettingsCtx.settings?.scriptsEnabled ?? true}
					onCheckedChange={handleScriptsEnabledClick}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="font-semibold">
						Enable Scripts
					</Switch.Label>
				</Switch>
			</div>
		</div>

		<!--
			Backups (ruled 2026-09-10). The list of backups, Back up now and
			Delete are in Settings → Data; what belongs here is the pair of
			instance-wide policies an admin sets once.
		-->
		<div class="card preset-filled-surface-100-900 space-y-4 p-4">
			<h3 class="text-lg font-semibold">Backups</h3>

			<div class="flex items-center gap-2">
				<Switch
					name="backup-daily"
					checked={systemSettingsCtx.settings?.backupDaily ?? true}
					onCheckedChange={handleBackupDailyClick}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="font-semibold">
						Back up daily
					</Switch.Label>
				</Switch>
			</div>
			<p class="text-muted-foreground text-sm">
				Takes a copy of the database once a day, on top of the one
				always taken before a version upgrade. Backups are never deleted
				on their own — see Settings → Data to remove one.
			</p>

			<div class="flex items-center gap-2">
				<Switch
					name="backup-include-user-files"
					checked={systemSettingsCtx.settings
						?.backupIncludeUserFiles ?? false}
					onCheckedChange={handleBackupIncludeUserFilesClick}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="font-semibold">
						Include user files
					</Switch.Label>
				</Switch>
			</div>
			<p class="text-muted-foreground text-sm">
				Archives media and avatars beside each backup, so a restored
				database still has the images it points at — this makes backups
				much larger, which is why it is off by default.
			</p>
		</div>

		<!-- Context Debugging -->
		<div class="card preset-filled-surface-100-900 space-y-4 p-4">
			<h3 class="text-lg font-semibold">Context Debugging</h3>
			<p class="text-muted-foreground text-sm">
				When enabled, shows the prompt inspector tab in the session UI,
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

		<!-- Language -->
		<div class="card preset-filled-surface-100-900 space-y-4 p-4">
			<h3 class="text-lg font-semibold">Language</h3>
			<p class="text-muted-foreground text-sm">
				The language this instance is drawn in. Every user who has not
				chosen one of their own follows this, so changing it moves them
				— and only them; anyone with their own choice keeps it.
			</p>
			<LanguagePicker
				label="Default language"
				value={systemSettingsCtx.settings?.defaultLanguage ?? "en"}
				describedBy="default-language-note"
				onValueChange={handleDefaultLanguageChange}
			/>
			<p id="default-language-note" class="text-muted-foreground text-sm">
				The language also decides which retrieval features apply:
				stemming is used for the languages a stemmer exists for, and
				trigram matching — which works for every language — for the
				rest. See the Languages documentation page.
			</p>

			<hr class="border-surface-300-700" />

			<h4 class="font-semibold">Automatic translation</h4>
			<p class="text-muted-foreground text-sm">
				Serene Pub ships no translated text. With this on, interface
				strings it has no translation for are sent to the service below,
				translated once, and cached forever. Only this app's own
				interface strings are sent — never sessions, characters,
				personas or lore. Off, anything untranslated stays in English.
			</p>
			<div class="flex items-center gap-2">
				<Switch
					name="enable-auto-translate"
					checked={systemSettingsCtx.settings?.autoTranslateEnabled ??
						false}
					onCheckedChange={(e) =>
						saveAutoTranslate({ enabled: e.checked })}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="font-semibold">
						{systemSettingsCtx.settings?.autoTranslateEnabled
							? "Automatic Translation Enabled"
							: "Enable Automatic Translation"}
					</Switch.Label>
				</Switch>
			</div>
			{#if systemSettingsCtx.settings?.autoTranslateEnabled}
				<Select
					label="Translation service"
					options={[
						{
							value: "google",
							label: "Google Translate (no account needed)"
						},
						{
							value: "libre",
							label: "LibreTranslate (self-hostable)"
						}
					]}
					value={systemSettingsCtx.settings?.autoTranslateEngine ??
						"google"}
					onValueChange={(v) =>
						saveAutoTranslate({ engine: v as "google" | "libre" })}
				/>
				{#if systemSettingsCtx.settings?.autoTranslateEngine === "libre"}
					<label class="label">
						<span class="label-text font-semibold">
							LibreTranslate URL
						</span>
						<input
							class="input"
							type="url"
							placeholder="https://translate.example.org/translate"
							bind:value={autoTranslateEndpointField}
						/>
					</label>
					<p class="text-muted-foreground text-sm">
						Point this at your own LibreTranslate and nothing leaves
						your network. Leave it empty to use the public instance.
					</p>
					<button
						class="btn preset-filled-primary-500 w-fit"
						onclick={() => saveAutoTranslate({})}
					>
						Save URL
					</button>
				{/if}
			{/if}
		</div>

		<!-- Legacy Configs -->
		<div class="card preset-filled-surface-100-900 space-y-4 p-4">
			<h3 class="text-lg font-semibold">Legacy Configs</h3>
			<p class="text-muted-foreground text-sm">
				Show the Legacy panel holding the 0.5 archives — the old Context
				Configs and Prompt Configs, kept readable. Nothing in 0.6 builds
				a prompt from them; hide the panel when you are done referring
				back. The rows themselves stay either way.
			</p>
			<div class="flex items-center gap-2">
				<Switch
					name="show-legacy-configs"
					checked={systemSettingsCtx.settings
						?.legacyPromptConfigsVisible !== false}
					onCheckedChange={handleLegacyConfigsVisibleClick}
				>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
					<Switch.Label class="font-semibold">
						{systemSettingsCtx.settings
							?.legacyPromptConfigsVisible !== false
							? "Legacy Configs Shown"
							: "Show Legacy Configs"}
					</Switch.Label>
				</Switch>
			</div>
		</div>

		<!-- CharaVault Integration -->
		<div class="card preset-filled-surface-100-900 space-y-4 p-4">
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

		<!-- Account Settings. Hidden on Android, which is single-user by
		     design — the server refuses the change regardless. -->
		{#if !systemSettingsCtx.settings?.isAndroidWrapper}
			<div class="card preset-filled-surface-100-900 space-y-4 p-4">
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
						User accounts are enabled. This setting cannot be
						reversed.
					</p>
				{:else}
					<p class="text-muted-foreground ml-6 text-sm">
						Enable user authentication and multi-user support. This
						is a permanent change.
					</p>
				{/if}
			</div>
		{/if}
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
