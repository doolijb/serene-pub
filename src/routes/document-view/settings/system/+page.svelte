<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	let ollamaSettingsCtx: OllamaSettingsCtx = getContext("ollamaSettingsCtx")
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = getContext(
		"koboldCppSettingsCtx"
	)

	let koboldCppBaseUrl = $state("")
	let status = $state("")
	let error = $state("")

	let charaVaultConnected = $state(false)
	let charaVaultEmail: string | null = $state(null)
	let charaVaultEmailField = $state("")
	let charaVaultTokenField = $state("")

	// User accounts: toggle-ON only from Document View (see toggleAccountsEnabled
	// below for why) — this tracks whether the admin still needs to set a
	// passphrase before they're allowed to turn accounts on at all, since
	// once accounts are required, an admin without one couldn't log back in.
	let hasPassphrase = $state(true)
	let newPassphrase = $state("")
	let enablingAccounts = $state(false)

	function toggleOllamaManager(enabled: boolean) {
		socket.emit("systemSettings:updateOllamaManagerEnabled", { enabled })
	}

	function toggleKoboldCppManager(enabled: boolean) {
		socket.emit("systemSettings:updateKoboldCppManagerEnabled", { enabled })
	}
	function saveKoboldCppBaseUrl(event: SubmitEvent) {
		event.preventDefault()
		socket.emit("koboldcpp:setBaseUrl", {
			baseUrl: koboldCppBaseUrl.trim()
		})
	}

	function toggleSummarization(enabled: boolean) {
		socket.emit("systemSettings:updateSummarizationEnabled", { enabled })
	}
	function toggleContextDebugging(enabled: boolean) {
		socket.emit("systemSettings:updateContextDebuggingEnabled", { enabled })
	}

	// Document View only ever offers turning accounts ON, never off — once
	// everyone (including the admin) needs to log in, that's a much bigger
	// change to walk back than to make, and doing it safely means checking
	// nobody else is mid-session; that's judgment better left to an admin on
	// the standard site, not a single checkbox here. Turning ON is safe to
	// self-serve as long as the admin has a passphrase to log back in with —
	// enforced below by requiring one before the button is even enabled.
	function requestEnableAccounts() {
		if (
			!confirm(
				'Turn on user accounts? Everyone, including you, will need to log in from now on. Your username is "' +
					(userCtx.user?.username ?? "") +
					'".'
			)
		)
			return
		error = ""
		enablingAccounts = true
		if (!hasPassphrase) {
			socket.emit("users:current:setPassphrase", {
				passphrase: newPassphrase
			})
		} else {
			socket.emit("systemSettings:updateAccountsEnabled", {
				enabled: true
			})
		}
	}

	function connectCharaVault(event: SubmitEvent) {
		event.preventDefault()
		if (!charaVaultEmailField.trim() || !charaVaultTokenField.trim()) return
		socket.emit("cardSources:charaVault:connect", {
			email: charaVaultEmailField.trim(),
			token: charaVaultTokenField.trim()
		})
	}
	function disconnectCharaVault() {
		if (!confirm("Disconnect CharaVault?")) return
		socket.emit("cardSources:charaVault:disconnect", {})
	}

	// Both settings objects arrive asynchronously (AccessibleShell's own
	// socket round-trip, kicked off after this page has already mounted) —
	// a one-time read in onMount would often run first and capture empty
	// strings permanently. Each field only ever auto-fills once, so it
	// doesn't overwrite whatever the admin is actively typing afterward.
	let koboldCppBaseUrlInitialized = $state(false)
	$effect(() => {
		if (!koboldCppBaseUrlInitialized && koboldCppSettingsCtx.settings) {
			koboldCppBaseUrl =
				koboldCppSettingsCtx.settings.koboldCppManagerBaseUrl || ""
			koboldCppBaseUrlInitialized = true
		}
	})

	function handleUpdateOllamaManagerEnabled() {
		status = "Ollama Manager setting saved."
		announce(status)
	}
	function handleUpdateKoboldCppManagerEnabled() {
		status = "KoboldCPP Manager setting saved."
		announce(status)
	}
	function handleKoboldcppSetBaseUrl() {
		status = "KoboldCPP base URL saved."
		announce(status)
	}
	function handleUpdateSummarizationEnabled() {
		status = "Summarization setting saved."
		announce(status)
	}
	function handleUpdateContextDebuggingEnabled() {
		status = "Context debugging setting saved."
		announce(status)
	}
	function handleUpdateAccountsEnabled(msg: { enabled?: boolean }) {
		enablingAccounts = false
		status = msg.enabled
			? "User accounts are now required."
			: "User accounts are now optional."
		announce(status)
	}
	function handleUpdateAccountsEnabledError(msg: { error?: string }) {
		enablingAccounts = false
		error = msg.error || "Failed to update accounts setting."
		announce(error)
	}
	function handleHasPassphrase(msg: { hasPassphrase: boolean }) {
		hasPassphrase = msg.hasPassphrase
	}
	function handleSetPassphrase(msg: { success?: boolean; message?: string }) {
		if (msg.success) {
			hasPassphrase = true
			newPassphrase = ""
			// Passphrase is set — proceed to actually turn accounts on.
			socket.emit("systemSettings:updateAccountsEnabled", {
				enabled: true
			})
		} else {
			enablingAccounts = false
			error = msg.message || "Failed to set passphrase."
			announce(error)
		}
	}
	function handleCharaVaultStatus(msg: {
		connected: boolean
		email: string | null
	}) {
		charaVaultConnected = msg.connected
		charaVaultEmail = msg.email
	}
	function handleCharaVaultConnect(msg: { success?: boolean }) {
		if (msg.success) {
			charaVaultEmailField = ""
			charaVaultTokenField = ""
			announce("Connected to CharaVault.")
			socket.emit("cardSources:charaVault:status", {})
		}
	}
	function handleCharaVaultConnectError(msg: { error?: string }) {
		error = msg.error || "Failed to connect to CharaVault."
		announce(error)
	}
	function handleCharaVaultDisconnect() {
		announce("Disconnected from CharaVault.")
		socket.emit("cardSources:charaVault:status", {})
	}

	onMount(() => {
		socket.on(
			"systemSettings:updateOllamaManagerEnabled",
			handleUpdateOllamaManagerEnabled
		)
		socket.on(
			"systemSettings:updateKoboldCppManagerEnabled",
			handleUpdateKoboldCppManagerEnabled
		)
		socket.on("koboldcpp:setBaseUrl", handleKoboldcppSetBaseUrl)
		socket.on(
			"systemSettings:updateSummarizationEnabled",
			handleUpdateSummarizationEnabled
		)
		socket.on(
			"systemSettings:updateContextDebuggingEnabled",
			handleUpdateContextDebuggingEnabled
		)
		socket.on(
			"systemSettings:updateAccountsEnabled",
			handleUpdateAccountsEnabled
		)
		socket.on(
			"systemSettings:updateAccountsEnabled:error",
			handleUpdateAccountsEnabledError
		)
		socket.on("users:current:hasPassphrase", handleHasPassphrase)
		socket.on("users:current:setPassphrase", handleSetPassphrase)
		socket.emit("users:current:hasPassphrase", {})
		socket.on("cardSources:charaVault:status", handleCharaVaultStatus)
		socket.on("cardSources:charaVault:connect", handleCharaVaultConnect)
		socket.on(
			"cardSources:charaVault:connect:error",
			handleCharaVaultConnectError
		)
		socket.on(
			"cardSources:charaVault:disconnect",
			handleCharaVaultDisconnect
		)
		socket.emit("cardSources:charaVault:status", {})

		return () => {
			socket.off(
				"systemSettings:updateOllamaManagerEnabled",
				handleUpdateOllamaManagerEnabled
			)
			socket.off(
				"systemSettings:updateKoboldCppManagerEnabled",
				handleUpdateKoboldCppManagerEnabled
			)
			socket.off("koboldcpp:setBaseUrl", handleKoboldcppSetBaseUrl)
			socket.off(
				"systemSettings:updateSummarizationEnabled",
				handleUpdateSummarizationEnabled
			)
			socket.off(
				"systemSettings:updateContextDebuggingEnabled",
				handleUpdateContextDebuggingEnabled
			)
			socket.off(
				"systemSettings:updateAccountsEnabled",
				handleUpdateAccountsEnabled
			)
			socket.off(
				"systemSettings:updateAccountsEnabled:error",
				handleUpdateAccountsEnabledError
			)
			socket.off("users:current:hasPassphrase", handleHasPassphrase)
			socket.off("users:current:setPassphrase", handleSetPassphrase)
			socket.off(
				"cardSources:charaVault:status",
				handleCharaVaultStatus
			)
			socket.off(
				"cardSources:charaVault:connect",
				handleCharaVaultConnect
			)
			socket.off(
				"cardSources:charaVault:connect:error",
				handleCharaVaultConnectError
			)
			socket.off(
				"cardSources:charaVault:disconnect",
				handleCharaVaultDisconnect
			)
		}
	})
</script>

<svelte:head>
	<title>System Settings — Document View — Serene Pub</title>
</svelte:head>

<h1>System Settings</h1>

{#if !userCtx.user?.isAdmin}
	<p>Admin access required.</p>
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

	<h2>Ollama Manager</h2>
	<p class="a11y-hint">
		Lets Serene Pub browse, download, and connect to models running in
		Ollama.
	</p>
	<div class="a11y-checkbox-field">
		<input
			id="a11y-sys-ollama-enabled"
			type="checkbox"
			checked={ollamaSettingsCtx.settings?.ollamaManagerEnabled}
			onchange={(e) => toggleOllamaManager(e.currentTarget.checked)}
		/>
		<label for="a11y-sys-ollama-enabled">Enable Ollama Manager</label>
	</div>
	<p class="a11y-hint">
		Base URL is only configured from the Ollama Manager panel
		(Connections), not here.
	</p>

	<h2>KoboldCPP Manager</h2>
	<p class="a11y-hint">
		Lets Serene Pub browse, download, and connect to models running in
		KoboldCPP.
	</p>
	<div class="a11y-checkbox-field">
		<input
			id="a11y-sys-kcpp-enabled"
			type="checkbox"
			checked={koboldCppSettingsCtx.settings?.koboldCppManagerEnabled}
			onchange={(e) => toggleKoboldCppManager(e.currentTarget.checked)}
		/>
		<label for="a11y-sys-kcpp-enabled">Enable KoboldCPP Manager</label>
	</div>
	<form onsubmit={saveKoboldCppBaseUrl}>
		<div class="a11y-field">
			<label for="a11y-sys-kcpp-url">KoboldCPP Server URL</label>
			<input
				id="a11y-sys-kcpp-url"
				type="text"
				bind:value={koboldCppBaseUrl}
			/>
		</div>
		<button type="submit" class="a11y-btn a11y-btn-small">Save URL</button>
	</form>

	<h2>Summarization</h2>
	<p class="a11y-hint">
		Lets you select a range of chat messages and generate a Scene Summary
		from them — a manual, per-chat action.
	</p>
	<div class="a11y-checkbox-field">
		<input
			id="a11y-sys-summarization"
			type="checkbox"
			checked={systemSettingsCtx.settings?.summarizationEnabled}
			onchange={(e) => toggleSummarization(e.currentTarget.checked)}
		/>
		<label for="a11y-sys-summarization">Enable Summarization</label>
	</div>

	<h2>Context Debugging</h2>
	<p class="a11y-hint">
		Shows extra technical detail about what's sent to the AI model, for
		troubleshooting.
	</p>
	<div class="a11y-checkbox-field">
		<input
			id="a11y-sys-context-debugging"
			type="checkbox"
			checked={systemSettingsCtx.settings?.contextDebuggingEnabled}
			onchange={(e) => toggleContextDebugging(e.currentTarget.checked)}
		/>
		<label for="a11y-sys-context-debugging">Enable Context Debugging</label>
	</div>

	<h2>Embeddings</h2>
	<p class="a11y-hint">
		Powers retrieval-augmented context (RAG) for lore, history, and past
		messages. Status:
		{systemSettingsCtx.settings?.vectorizationEnabled
			? "Enabled"
			: "Disabled"}. Setting up embeddings requires choosing a model and
		isn't available in Document View yet — use the standard site.
	</p>

	<h2>CharaVault</h2>
	<p class="a11y-hint">
		An external character card library you can browse and import from.
	</p>
	{#if charaVaultConnected}
		<p>
			Connected{#if charaVaultEmail}
				as {charaVaultEmail}{/if}.
		</p>
		<button
			type="button"
			class="a11y-btn a11y-btn-danger a11y-btn-small"
			onclick={disconnectCharaVault}
		>
			Disconnect
		</button>
	{:else}
		<form onsubmit={connectCharaVault}>
			<div class="a11y-field">
				<label for="a11y-sys-charavault-email">CharaVault Email</label>
				<input
					id="a11y-sys-charavault-email"
					type="email"
					bind:value={charaVaultEmailField}
				/>
			</div>
			<div class="a11y-field">
				<label for="a11y-sys-charavault-token">CharaVault Token</label>
				<input
					id="a11y-sys-charavault-token"
					type="password"
					autocomplete="off"
					bind:value={charaVaultTokenField}
				/>
			</div>
			<button
				type="submit"
				class="a11y-btn a11y-btn-small"
				disabled={!charaVaultEmailField.trim() ||
					!charaVaultTokenField.trim()}
			>
				Connect
			</button>
		</form>
	{/if}

	<h2>User Accounts</h2>
	{#if systemSettingsCtx.settings?.isAccountsEnabled}
		<p class="a11y-hint">
			User accounts are required — everyone must log in with a username
			and passphrase.
		</p>
		<p>
			<strong>Accounts are enabled.</strong>
			This can't be turned off from Document View — use the standard site's
			System Settings if you need to disable it.
		</p>
	{:else}
		<p class="a11y-hint">
			Once turned on, everyone (including you) will need to log in. Your
			username is
			<strong>{userCtx.user?.username}</strong>
			— make a note of it now, since you'll need it to log back in.
		</p>
		{#if !hasPassphrase}
			<div class="a11y-field">
				<label for="a11y-sys-accounts-passphrase">
					Set a Passphrase
				</label>
				<p class="a11y-hint">
					Required before accounts can be turned on — this is what
					you'll log in with.
				</p>
				<input
					id="a11y-sys-accounts-passphrase"
					type="password"
					autocomplete="new-password"
					bind:value={newPassphrase}
					disabled={enablingAccounts}
				/>
			</div>
		{/if}
		<button
			type="button"
			class="a11y-btn a11y-btn-small"
			onclick={requestEnableAccounts}
			disabled={enablingAccounts ||
				(!hasPassphrase && !newPassphrase.trim())}
		>
			{enablingAccounts ? "Enabling…" : "Enable User Accounts"}
		</button>
	{/if}
{/if}
