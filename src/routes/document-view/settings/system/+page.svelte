<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { embeddingsStarred } from "$lib/shared/constants/embeddings"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import { canRunLocalRuntimes } from "$lib/client/components/connections/addMenuItems"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	let ollamaSettingsCtx: OllamaSettingsCtx = getContext("ollamaSettingsCtx")
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = getContext(
		"koboldCppSettingsCtx"
	)

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

	// The managers are turned ON from their own pages, which add the
	// connection in the same press (less-confusing J1); this page only says
	// where they are, and keeps the way to turn one off.
	function turnOffOllamaManager() {
		socket.emit("systemSettings:updateOllamaManagerEnabled", {
			enabled: false
		})
	}

	function turnOffKoboldCppManager() {
		socket.emit("systemSettings:updateKoboldCppManagerEnabled", {
			enabled: false
		})
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

	function handleUpdateOllamaManagerEnabled(
		msg: Sockets.SystemSettings.UpdateOllamaManagerEnabled.Response
	) {
		status = msg.enabled
			? "Ollama, managed, is on."
			: "Ollama, managed, is off."
		announce(status)
	}
	function handleUpdateKoboldCppManagerEnabled(
		msg: Sockets.SystemSettings.UpdateKoboldCppManagerEnabled.Response
	) {
		status = msg.enabled
			? "KoboldCPP, run by Serene Pub, is on."
			: "KoboldCPP, run by Serene Pub, is off."
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

	/**
	 * The CharaVault card source, all BARE: none of these events is in
	 * `SCOPED_EVENTS`, and there is one CharaVault account per instance to
	 * scope to anyway. `cardSources:charaVault:status` is a STANDING key
	 * rather than a one-shot — the connect and disconnect handlers ask for it
	 * again — and its `:connect:error` half is never gated (plan ruling 2).
	 *
	 * Declared ahead of `onMount` so the keys are held before it sends the
	 * first status request (effects run in declaration order, and the typed
	 * `emit` flushes the interest sync ahead of itself — plan ruling 3).
	 */
	useInterest<"cardSources:charaVault:status">(
		"cardSources:charaVault:status",
		handleCharaVaultStatus
	)
	useInterest<"cardSources:charaVault:connect">(
		"cardSources:charaVault:connect",
		handleCharaVaultConnect
	)
	useInterest<"cardSources:charaVault:connect:error">(
		"cardSources:charaVault:connect:error",
		handleCharaVaultConnectError
	)
	useInterest<"cardSources:charaVault:disconnect">(
		"cardSources:charaVault:disconnect",
		handleCharaVaultDisconnect
	)

	/**
	 * The four instance switches' answers and the account's passphrase
	 * replies, all BARE — an instance setting has nothing to scope it to, and
	 * `users:current:*` is already one user's. All STANDING: every one of them
	 * lands when somebody flips a switch or submits a form on this page, not
	 * in reply to anything asked at mount. The `:error` half is never gated
	 * (plan ruling 2).
	 */
	useInterest<"systemSettings:updateOllamaManagerEnabled">(
		"systemSettings:updateOllamaManagerEnabled",
		handleUpdateOllamaManagerEnabled
	)
	useInterest<"systemSettings:updateKoboldCppManagerEnabled">(
		"systemSettings:updateKoboldCppManagerEnabled",
		handleUpdateKoboldCppManagerEnabled
	)
	useInterest<"systemSettings:updateContextDebuggingEnabled">(
		"systemSettings:updateContextDebuggingEnabled",
		handleUpdateContextDebuggingEnabled
	)
	useInterest<"systemSettings:updateAccountsEnabled">(
		"systemSettings:updateAccountsEnabled",
		handleUpdateAccountsEnabled
	)
	useInterest<"systemSettings:updateAccountsEnabled:error">(
		"systemSettings:updateAccountsEnabled:error",
		handleUpdateAccountsEnabledError
	)
	useInterest<"users:current:setPassphrase">(
		"users:current:setPassphrase",
		handleSetPassphrase
	)

	/**
	 * Whether this admin has a passphrase yet — the thing that decides whether
	 * accounts may be turned on at all. Asked for and listened for in one, and
	 * STANDING because setting one re-emits it.
	 */
	$effect(() =>
		requestWithInterest(
			"users:current:hasPassphrase",
			{},
			handleHasPassphrase
		)
	)

	onMount(() => {
		// The four `cardSources:charaVault:*` listeners are interests,
		// declared above; this is the request their keys are waiting for.
		// Every listener on this page is released by the registry as its
		// effects are destroyed, so there is nothing to tear down here.
		socket.emit("cardSources:charaVault:status", {})
	})
</script>

<svelte:head>
	<title>Pub settings — Document View — Serene Pub</title>
</svelte:head>

<h1>Pub settings</h1>

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

	{#if canRunLocalRuntimes(systemSettingsCtx.settings)}
		<h2>Ollama, managed</h2>
		<p class="a11y-hint">
			Lets Serene Pub browse, download, and connect to models running in
			Ollama. It is turned on, and its server URL set, on its own page.
		</p>
		<p>
			{ollamaSettingsCtx.settings?.ollamaManagerEnabled ? "On" : "Off"}.
			<a href="/document-view/ollama">Open Ollama, managed</a>
		</p>
		{#if ollamaSettingsCtx.settings?.ollamaManagerEnabled}
			<button
				type="button"
				class="a11y-btn a11y-btn-secondary a11y-btn-small"
				onclick={turnOffOllamaManager}
			>
				Turn off Ollama, managed
			</button>
		{/if}

		<h2>KoboldCPP, run by Serene Pub</h2>
		<p class="a11y-hint">
			Lets Serene Pub download and run KoboldCPP and its models on this
			computer. It is turned on, and its server URL set, on its own page.
		</p>
		<p>
			{koboldCppSettingsCtx.settings?.koboldCppManagerEnabled ? "On" : "Off"}.
			<a href="/document-view/koboldcpp">Open KoboldCPP, run by Serene Pub</a>
		</p>
		{#if koboldCppSettingsCtx.settings?.koboldCppManagerEnabled}
			<button
				type="button"
				class="a11y-btn a11y-btn-secondary a11y-btn-small"
				onclick={turnOffKoboldCppManager}
			>
				Turn off KoboldCPP, run by Serene Pub
			</button>
		{/if}
	{/if}

	<h2>Context debugging</h2>
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
		<label for="a11y-sys-context-debugging">Enable context debugging</label>
	</div>

	<h2>Embeddings</h2>
	<p class="a11y-hint">
		Powers Search by meaning, which finds lorebook entries by what they
		mean, not only by their words. Status:
		{embeddingsStarred(systemSettingsCtx.capabilityDefaults)
			? "In use"
			: "Not in use"}. To choose the model, open
		<a href="/document-view/connections">Connections</a>
		and press "Use … for embeddings" beside it.
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

	<h2>User accounts</h2>
	{#if systemSettingsCtx.settings?.isAccountsEnabled}
		<p class="a11y-hint">
			User accounts are required — everyone must log in with a username
			and passphrase.
		</p>
		<p>
			<strong>Accounts are enabled.</strong>
			This is permanent: accounts can't be turned off again.
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
					Set a passphrase
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
			{enablingAccounts ? "Enabling…" : "Enable user accounts"}
		</button>
	{/if}
{/if}
