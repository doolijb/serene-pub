<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { goto } from "$app/navigation"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { DISPLAY_NAME_MAX_LENGTH } from "$lib/shared/validation/displayName"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import {
		accessibilityModeStore,
		disableAccessibility,
		enableAccessibility,
		pause,
		isDarkMode,
		setDarkMode,
		getFontScaleIndex,
		setFontScaleIndex,
		FONT_SCALE_STEPS,
		mapToStandardRoute,
		announce
	} from "$lib/client/accessibility/state.svelte"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")

	let displayName = $state("")
	let displayNameSaving = $state(false)
	let displayNameStatus = $state("")

	let hasPassphrase = $state(true)
	let currentPassphrase = $state("")
	let newPassphrase = $state("")
	let passphraseSaving = $state(false)
	let passphraseStatus = $state("")
	let passphraseError = $state("")

	let loggingOut = $state(false)

	let darkMode = $state(true)
	let fontScaleIndex = $state(1)

	function saveDisplayName(event: SubmitEvent) {
		event.preventDefault()
		displayNameSaving = true
		displayNameStatus = ""
		socket.emit("users:current:updateDisplayName", {
			displayName: displayName.trim()
		})
	}

	function savePassphrase(event: SubmitEvent) {
		event.preventDefault()
		passphraseError = ""
		if (!newPassphrase.trim()) {
			passphraseError = "Enter a new passphrase."
			return
		}
		passphraseSaving = true
		if (hasPassphrase) {
			socket.emit("users:current:changePassphrase", {
				currentPassphrase,
				newPassphrase
			})
		} else {
			socket.emit("users:current:setPassphrase", {
				passphrase: newPassphrase
			})
		}
	}

	// Socket logout only clears in-memory socket auth state — the actual
	// session cookie is HTTP-only and can't be touched from a socket
	// handler, so it must be cleared via a separate request to /api/logout
	// (same two-step pattern the standard site's own logout button uses).
	// Without the fetch below, reloading after "logging out" silently
	// re-authenticates from the still-valid cookie.
	async function logout() {
		if (!confirm("Log out of Serene Pub?")) return
		loggingOut = true
		socket.emit("users:current:logout", {})
		try {
			const response = await fetch("/api/logout", {
				method: "POST",
				credentials: "include"
			})
			if (response.ok) {
				window.location.href = "/"
				return
			}
			announce("Logout failed. Please try again.")
		} catch {
			announce("Logout failed. Please try again.")
		}
		loggingOut = false
	}

	function browseStandardSite() {
		pause()
		goto(mapToStandardRoute(page.url.pathname))
	}

	// Only offered when the preference isn't stored yet — i.e. you arrived by
	// a link, bookmark or typed URL, which shows Document View for this visit
	// without changing what the browser opens next time. Without this control
	// there'd be no way at all to make that arrival stick.
	function alwaysUseDocumentView() {
		enableAccessibility()
		announce("Document View is now the default for this browser.")
	}

	function turnOffDocumentView() {
		if (
			!confirm(
				"Turn off Document View? You can turn it back on any time with Ctrl+Shift+Y."
			)
		)
			return
		disableAccessibility()
		goto(mapToStandardRoute(page.url.pathname))
	}

	function toggleDarkMode() {
		darkMode = !darkMode
		setDarkMode(darkMode)
		announce(darkMode ? "Dark mode on." : "Light mode on.")
	}
	function changeFontScale(delta: number) {
		fontScaleIndex = Math.max(
			0,
			Math.min(FONT_SCALE_STEPS.length - 1, fontScaleIndex + delta)
		)
		setFontScaleIndex(fontScaleIndex)
		announce(
			`Text size: ${Math.round(FONT_SCALE_STEPS[fontScaleIndex] * 100)}%.`
		)
	}

	// userCtx.user arrives asynchronously (AccessibleShell's own "users:current"
	// socket round-trip, which starts after this page has already mounted) —
	// a one-time read in onMount below would often run before it exists and
	// capture an empty display name permanently. The "initialized" guard
	// means this only ever auto-fills once, so it doesn't stomp on the user
	// actively editing the field afterward.
	let displayNameInitialized = $state(false)
	$effect(() => {
		if (!displayNameInitialized && userCtx.user) {
			displayName = userCtx.user.displayName || ""
			displayNameInitialized = true
		}
	})

	function handleUpdateDisplayName(msg: { success?: boolean }) {
		displayNameSaving = false
		displayNameStatus = msg.success
			? "Display name saved."
			: "Failed to save display name."
		announce(displayNameStatus)
	}
	function handleUpdateDisplayNameError(msg: { error?: string }) {
		displayNameSaving = false
		displayNameStatus = msg.error || "Failed to save display name."
		announce(displayNameStatus)
	}
	function handleHasPassphrase(msg: { hasPassphrase: boolean }) {
		hasPassphrase = msg.hasPassphrase
	}
	function handleChangePassphrase(msg: {
		success?: boolean
		message?: string
	}) {
		passphraseSaving = false
		if (msg.success) {
			passphraseStatus = msg.message || "Passphrase changed."
			announce(passphraseStatus)
			currentPassphrase = ""
			newPassphrase = ""
		} else {
			passphraseError = msg.message || "Failed to change passphrase."
			announce(passphraseError)
		}
	}
	function handleChangePassphraseError(msg: { error?: string }) {
		passphraseSaving = false
		passphraseError = msg.error || "Failed to change passphrase."
		announce(passphraseError)
	}
	function handleSetPassphrase(msg: { success?: boolean; message?: string }) {
		passphraseSaving = false
		if (msg.success) {
			passphraseStatus = msg.message || "Passphrase set."
			announce(passphraseStatus)
			newPassphrase = ""
			hasPassphrase = true
		} else {
			passphraseError = msg.message || "Failed to set passphrase."
			announce(passphraseError)
		}
	}

	/**
	 * This account's own answers, all BARE — `users:current:*` is already one
	 * user's, so there is nothing to scope it to — and all STANDING: each is
	 * the reply to a form on this page, submitted long after mount. The three
	 * `:error` halves are declared too, and never gated (plan ruling 2).
	 */
	useInterest<"users:current:updateDisplayName">(
		"users:current:updateDisplayName",
		handleUpdateDisplayName
	)
	useInterest<"users:current:updateDisplayName:error">(
		"users:current:updateDisplayName:error",
		handleUpdateDisplayNameError
	)
	useInterest<"users:current:changePassphrase">(
		"users:current:changePassphrase",
		handleChangePassphrase
	)
	useInterest<"users:current:changePassphrase:error">(
		"users:current:changePassphrase:error",
		handleChangePassphraseError
	)
	useInterest<"users:current:setPassphrase">(
		"users:current:setPassphrase",
		handleSetPassphrase
	)

	/**
	 * Whether this account has a passphrase at all — which of the two forms
	 * below renders. Asked for and listened for in one, and STANDING because
	 * the server re-emits it after a passphrase is set.
	 */
	$effect(() =>
		requestWithInterest(
			"users:current:hasPassphrase",
			{},
			handleHasPassphrase
		)
	)

	onMount(() => {
		darkMode = isDarkMode()
		fontScaleIndex = getFontScaleIndex()
	})
</script>

<svelte:head>
	<title>Settings — Document View — Serene Pub</title>
</svelte:head>

<h1>Settings</h1>

<h2>Profile</h2>
<form onsubmit={saveDisplayName}>
	<div class="a11y-field">
		<label for="a11y-settings-display-name">Display name</label>
		<input
			id="a11y-settings-display-name"
			type="text"
			maxlength={DISPLAY_NAME_MAX_LENGTH}
			aria-describedby="a11y-settings-display-name-help"
			bind:value={displayName}
			disabled={displayNameSaving}
		/>
		<p id="a11y-settings-display-name-help">
			What the app and the characters call you. Leave it empty to go by
			your username.
		</p>
	</div>
	<button
		type="submit"
		class="a11y-btn a11y-btn-small"
		disabled={displayNameSaving}
	>
		{displayNameSaving ? "Saving…" : "Save display name"}
	</button>
	{#if displayNameStatus}
		<p role="status">{displayNameStatus}</p>
	{/if}
</form>

<h2>{hasPassphrase ? "Change passphrase" : "Set a passphrase"}</h2>
<form onsubmit={savePassphrase}>
	{#if passphraseError}
		<div class="a11y-status a11y-status-error" role="alert">
			<p class="a11y-error-text">{passphraseError}</p>
		</div>
	{/if}
	{#if hasPassphrase}
		<div class="a11y-field">
			<label for="a11y-settings-current-passphrase">
				Current passphrase
			</label>
			<input
				id="a11y-settings-current-passphrase"
				type="password"
				autocomplete="current-password"
				required
				bind:value={currentPassphrase}
				disabled={passphraseSaving}
			/>
		</div>
	{/if}
	<div class="a11y-field">
		<label for="a11y-settings-new-passphrase">New passphrase</label>
		<input
			id="a11y-settings-new-passphrase"
			type="password"
			autocomplete="new-password"
			required
			bind:value={newPassphrase}
			disabled={passphraseSaving}
		/>
	</div>
	<button
		type="submit"
		class="a11y-btn a11y-btn-small"
		disabled={passphraseSaving}
	>
		{passphraseSaving
			? "Saving…"
			: hasPassphrase
				? "Change passphrase"
				: "Set passphrase"}
	</button>
	{#if passphraseStatus}
		<p role="status">{passphraseStatus}</p>
	{/if}
</form>

<h2>Display</h2>
<p class="a11y-hint">These also appear in the header on every page.</p>
<div class="a11y-list-item-actions">
	<button
		type="button"
		class="a11y-btn a11y-btn-small"
		onclick={toggleDarkMode}
	>
		{darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
	</button>
	<button
		type="button"
		class="a11y-btn a11y-btn-small"
		onclick={() => changeFontScale(-1)}
		disabled={fontScaleIndex === 0}
	>
		Decrease text size
	</button>
	<span>{Math.round(FONT_SCALE_STEPS[fontScaleIndex] * 100)}%</span>
	<button
		type="button"
		class="a11y-btn a11y-btn-small"
		onclick={() => changeFontScale(1)}
		disabled={fontScaleIndex === FONT_SCALE_STEPS.length - 1}
	>
		Increase text size
	</button>
</div>

<h2>Document View</h2>
{#if !accessibilityModeStore.persisted}
	<p>
		You're viewing this page in Document View for this visit only. This
		browser will open the standard site next time unless you choose to
		always use Document View.
	</p>
{/if}
<div class="a11y-list-item-actions">
	{#if !accessibilityModeStore.persisted}
		<button type="button" class="a11y-btn" onclick={alwaysUseDocumentView}>
			Always Use Document View
		</button>
	{/if}
	<button
		type="button"
		class="a11y-btn a11y-btn-secondary"
		onclick={browseStandardSite}
	>
		Browse standard site temporarily
	</button>
	{#if accessibilityModeStore.persisted}
		<button
			type="button"
			class="a11y-btn a11y-btn-danger"
			onclick={turnOffDocumentView}
		>
			Turn Off Document View
		</button>
	{/if}
</div>

<h2>Account</h2>
<button
	type="button"
	class="a11y-btn a11y-btn-danger"
	onclick={logout}
	disabled={loggingOut}
>
	{loggingOut ? "Logging out…" : "Log out"}
</button>
