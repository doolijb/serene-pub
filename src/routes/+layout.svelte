<script lang="ts">
	import { browser } from "$app/environment"
	import { goto } from "$app/navigation"
	import Layout from "$lib/client/components/Layout.svelte"
	import { loadSocketsClient } from "$lib/client/sockets/loadSockets.client"
	import type { Snippet } from "svelte"
	import { page } from "$app/state"
	import * as Icons from "@lucide/svelte"
	import { Toast } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import LoginForm from "$lib/client/components/LoginForm.svelte"
	import SetupGate from "$lib/client/components/auth/SetupGate.svelte"
	import AccessibleShell from "$lib/client/accessibility/AccessibleShell.svelte"
	import AccessibleLoginForm from "$lib/client/accessibility/AccessibleLoginForm.svelte"
	import {
		accessibilityModeStore,
		pausedStore,
		isAccessibilityEnabled,
		isPaused,
		enableAccessibility,
		disableAccessibility,
		announce,
		mapToAccessibleRoute,
		mapToStandardRoute
	} from "$lib/client/accessibility/state.svelte"

	// Post-auth shell selection is derived from the URL itself — the same
	// source `children` comes from — rather than from accessibilityModeStore
	// directly. That flag flips synchronously the instant the shortcut fires,
	// while `children` only swaps to the new route's page once goto() finishes
	// (an async navigation). Deriving the shell from the flag meant there was
	// a window where the new shell had already mounted around the OLD page's
	// content (eg. AccessibleShell wrapping a standard library/session page) —
	// exactly the "accessible nav over top of the standard site" bug. Tying
	// shell choice to page.url.pathname instead means both the shell and its
	// children can only ever change together, in the same navigation.
	let showAccessibleShell = $derived(
		page.url.pathname === "/document-view" ||
			page.url.pathname.startsWith("/document-view/")
	)
	// The pre-auth login screen has no such route to key off (the whole app
	// renders LoginForm regardless of the requested URL until authenticated),
	// so it still goes by the flag directly.
	let showAccessibleLogin = $derived(
		accessibilityModeStore.enabled && !pausedStore.paused
	)

	interface Props {
		children?: Snippet
	}

	let { children }: Props = $props()

	let socketsInitialized = $state(false)
	let showLogin = $state(false)
	let showSetupGate = $state(false)

	/**
	 * Routes that must render for someone with no session at all.
	 *
	 * Invite redemption is the whole point of an invite — the recipient has no
	 * account yet, so gating it behind the login form makes the link useless.
	 * It talks to the server over plain HTTP and never touches the socket, so
	 * it needs none of the startup below.
	 */
	const PUBLIC_ROUTES = ["/invite"]
	const isPublicRoute = $derived(PUBLIC_ROUTES.includes(page.url.pathname))
	// Startup failure of the realtime connection. Without this the template's
	// `{#if socketsInitialized}{:else if showLogin}` chain had no third branch,
	// so any failure here rendered a completely blank page — see the catch in
	// initializeSocketsIfAllowed().
	let startupError = $state<string | null>(null)
	let retrying = $state(false)
	// Nothing at all renders until the socket connects, and loadSocketsClient
	// waits up to 10s before giving up — so a slow or cold-starting server
	// showed a blank page for that whole time with no sign it was working.
	// Delayed so a normal fast connect doesn't flash a spinner.
	let showStartupSpinner = $state(false)

	// Document View (accessible) mode — see src/lib/client/accessibility/.
	// This is the ONLY branch point touching the shared root layout; the
	// non-accessible path below is otherwise unchanged from before.
	// accessibilityModeStore is a shared singleton (not local state) so that
	// src/routes/document-view/+layout.ts can also flip it — e.g. someone
	// navigating straight to a /document-view/* URL without ever pressing
	// the shortcut first.

	// A true toggle in both directions: it turns the stored preference on from
	// the standard site and clears it from inside Document View.
	//
	// It used to pause() on the way out, which only writes sessionStorage — so
	// the shortcut appeared to work, then Document View came back on the next
	// restart, and the only real off-switch lived inside Document View's own
	// settings page. Someone who pressed the shortcut to escape landed on the
	// standard site with no control anywhere that could undo it.
	// "Browse Standard Site Temporarily" is still pause(), and is still the
	// right thing when you want to come back.
	//
	// Both directions announce: this is a keystroke away from a preference
	// screen-reader users depend on, so a mis-press must not be silent.
	function handleGlobalKeydown(event: KeyboardEvent) {
		if (
			event.ctrlKey &&
			event.shiftKey &&
			(event.key === "Y" || event.key === "y")
		) {
			event.preventDefault()
			if (showAccessibleShell || showAccessibleLogin) {
				disableAccessibility()
				announce("Document View turned off.")
				if (socketsInitialized)
					goto(mapToStandardRoute(page.url.pathname))
			} else {
				enableAccessibility()
				announce("Document View turned on.")
			}
		}
	}

	// Once authenticated, if Document View is enabled and we're not on a
	// /document-view route yet, forward there — the equivalent route if one
	// exists for the current path, else the Document View home. Skipped
	// while "Browse Standard Site" has paused the redirect for this tab.
	// Keys off accessibilityModeStore.enabled directly (not showAccessibleShell,
	// which only turns true once this navigation has already landed on an
	// /document-view/* URL) — this effect is what makes that first hop happen.
	$effect(() => {
		if (
			!socketsInitialized ||
			!accessibilityModeStore.enabled ||
			pausedStore.paused
		)
			return
		const target = mapToAccessibleRoute(page.url.pathname)
		if (target !== page.url.pathname) goto(target)
	})

	// Layout.svelte owns data-mode/data-theme on <html> (Skeleton's theme
	// variables are scoped by those attributes) but only while it's mounted.
	// Switching into Document View unmounts it, which would otherwise leave
	// the last-active Skeleton theme's attributes/CSS variables stuck on
	// <html> — strip them so nothing from the global theme bleeds behind
	// accessible.css's own `.a11y-root` palette. Switching back out (either
	// by disabling Document View or pausing it) remounts Layout, whose own
	// effects immediately restore both attributes.
	$effect(() => {
		if (!browser) return
		if (showAccessibleShell) {
			document.documentElement.removeAttribute("data-mode")
			document.documentElement.removeAttribute("data-theme")
		}
	})

	async function initializeSocketsIfAllowed() {
		if (!browser) return
		// A public route renders on its own; starting sockets or demanding a
		// session here would replace it with a login form.
		if (isPublicRoute) return
		const { checkSystemSettings, checkAuthentication } = await import(
			"$lib/client/utils/authFlow"
		)
		const systemSettings = await checkSystemSettings()
		if (systemSettings.isAccountsEnabled) {
			const isAuthenticated = await checkAuthentication()
			if (!isAuthenticated) {
				showLogin = true
				return
			}
		}
		const domain = page.url.hostname
		await loadSocketsClient({ domain })

		// Authenticated, but the account may still owe setup — a password to
		// choose, a second factor to enrol (27 §1). The socket is connected (it
		// has to be, since those steps run over it) but the server refuses
		// everything else, so the app shell must not render yet.
		if (await setupRequired()) {
			showSetupGate = true
			return
		}
		socketsInitialized = true
	}

	/**
	 * Ask the server whether this session still owes a code.
	 *
	 * Resolves false on anything unexpected. An instance with no 2FA enabled is
	 * the overwhelming majority, and blocking startup behind a prompt nobody
	 * can satisfy would be a far worse failure than the server simply refusing
	 * requests it was going to refuse anyway.
	 */
	async function setupRequired(): Promise<boolean> {
		const { useTypedSocket } = await import(
			"$lib/client/sockets/loadSockets.client"
		)
		const socket = useTypedSocket()
		return await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				socket.off("account:setupState", onState)
				socket.off("totp:status", onStatus)
				resolve(false)
			}, 5000)
			function done(v: boolean) {
				clearTimeout(timer)
				socket.off("account:setupState", onState)
				socket.off("totp:status", onStatus)
				resolve(v)
			}
			function onState(res: Sockets.Account.SetupState.Response) {
				if (res.pending.length) return done(true)
				// No outstanding setup, but an *enrolled* factor may still be
				// unverified for this session — a challenge rather than setup.
				socket.emit("totp:status", {})
			}
			function onStatus(res: Sockets.Totp.Status.Response) {
				done(res.verificationRequired)
			}
			socket.on("account:setupState", onState)
			socket.on("totp:status", onStatus)
			socket.emit("account:setupState", {})
		})
	}

	/**
	 * loadSocketsClient() rethrows on any failure — the socket connection
	 * unreachable, a connect_error (blocked port, CORS, TLS), or its own 10s
	 * connection timeout. This call had no catch and the template had no third
	 * branch, so every one of those produced a silently blank page plus an
	 * unhandled rejection. ConnectionTimeoutModal can't cover it either: that
	 * lives inside <Layout>, which only renders once socketsInitialized is
	 * true.
	 *
	 * The most likely cause in a real deployment is a reverse proxy or tunnel
	 * that forwards the app's port but not WebSocket upgrade headers — the
	 * realtime connection shares that one port now — so the message below
	 * names that explicitly rather than saying "something went wrong".
	 */
	async function startup() {
		startupError = null
		const spinnerTimer = setTimeout(() => (showStartupSpinner = true), 600)
		try {
			await initializeSocketsIfAllowed()
		} catch (error) {
			console.error("Startup failed:", error)
			// NEVER let this land on a falsy value. Socket.IO's connect_error
			// routinely carries an empty `message` (transport-level failures,
			// and middleware rejections that pass no reason), which made
			// startupError "" — falsy, so the template's `{:else if
			// startupError}` branch did not match either. With
			// socketsInitialized, showLogin and showStartupSpinner all false
			// as well, every branch failed and the page rendered completely
			// blank with nothing to act on: the exact silent-blank-page
			// failure the block comment above describes fixing, reintroduced
			// through the message rather than the missing branch.
			const reason =
				error instanceof Error ? error.message : String(error)
			startupError =
				reason?.trim() ||
				"The realtime connection failed to start and reported no reason. " +
					"This is usually the socket server (SOCKETS_PORT) not being reachable " +
					"through your reverse proxy or tunnel."
		} finally {
			clearTimeout(spinnerTimer)
			showStartupSpinner = false
		}
	}

	async function retryStartup() {
		if (retrying) return
		retrying = true
		try {
			await startup()
		} finally {
			retrying = false
		}
	}

	if (browser) {
		const persistedPreference = isAccessibilityEnabled()
		accessibilityModeStore.enabled = persistedPreference
		// Whether the preference is *stored*, as opposed to merely active for
		// this load — the two settings pages show different controls based on
		// it. Read here rather than in each consumer so there's one source of
		// truth, and set before the /document-view child layout's own init
		// runs (parent script bodies run first), which only flips `enabled`.
		accessibilityModeStore.persisted = persistedPreference
		pausedStore.paused = isPaused()
		startup()
	}
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<svelte:head>
	<title>Serene Pub</title>
	<meta name="description" content="Serene Pub" />
</svelte:head>

{#if isPublicRoute}
	{@render children?.()}
{:else if socketsInitialized}
	{#if showAccessibleShell}
		<AccessibleShell>
			{#key page.route}
				{@render children?.()}
			{/key}
		</AccessibleShell>
	{:else}
		<Layout>
			{#key page.route}
				{@render children?.()}
			{/key}
		</Layout>
	{/if}
{:else if showSetupGate}
	<SetupGate
		onDone={() => {
			// Reload rather than flipping a flag: any other tab still holds a
			// socket whose pending state was decided at handshake, and a fresh
			// page load is what re-resolves it everywhere.
			window.location.reload()
		}}
	/>
{:else if showLogin}
	{#if showAccessibleLogin}
		<AccessibleLoginForm />
	{:else}
		<LoginForm />
	{/if}
{:else if showStartupSpinner}
	<div
		class="flex min-h-screen items-center justify-center p-6"
		style="background:#1a1a22;color:#e8e8ef;"
		aria-live="polite"
	>
		<p class="text-sm opacity-70">Connecting to Serene Pub…</p>
	</div>
{:else if startupError}
	<!-- Deliberately plain markup with inline colors: this renders before the
	     app shell exists, and on a theme-load failure it still has to be
	     readable. -->
	<div
		class="flex min-h-screen items-center justify-center p-6"
		style="background:#1a1a22;color:#e8e8ef;"
		role="alert"
	>
		<div class="w-full max-w-lg space-y-4 text-center">
			<h1 class="text-2xl font-bold">Can't reach Serene Pub</h1>
			<p class="text-sm opacity-90">
				The page loaded, but the realtime connection Serene Pub needs
				for sessions and live updates could not be established.
			</p>
			<p class="text-sm opacity-90">
				Serene Pub runs a second server for realtime updates, separate
				from the web server. If you're behind a reverse proxy, tunnel,
				or Docker port mapping, check that it forwards that server too —
				this is the most common cause.
			</p>
			<p class="font-mono text-xs opacity-70">{startupError}</p>
			<div class="flex flex-wrap items-center justify-center gap-3 pt-2">
				<button
					type="button"
					class="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
					style="background:#4f46e5;color:#fff;"
					onclick={retryStartup}
					disabled={retrying}
				>
					{retrying ? "Retrying…" : "Retry"}
				</button>
				<a
					class="rounded-lg px-4 py-2 text-sm font-medium underline"
					href="https://github.com/doolijb/serene-pub/blob/main/docs/hosting.md"
					target="_blank"
					rel="noopener noreferrer"
				>
					Hosting &amp; proxy setup
				</a>
			</div>
		</div>
	</div>
{/if}

<Toast.Group {toaster}>
	{#snippet children(toast)}
		<Toast
			{toast}
			class="card flex items-start gap-3 p-4 shadow-xl {toast.type ===
			'error'
				? 'preset-filled-error-500'
				: toast.type === 'success'
					? 'preset-filled-success-500'
					: toast.type === 'warning'
						? 'preset-filled-warning-500'
						: 'preset-filled-surface-500'}"
		>
			<Toast.Message class="flex-1 space-y-1">
				{#if toast.title}
					<Toast.Title class="font-semibold">
						{toast.title}
					</Toast.Title>
				{/if}
				{#if toast.description}
					<Toast.Description class="text-sm opacity-80">
						{toast.description}
					</Toast.Description>
				{/if}
			</Toast.Message>
			{#if toast.closable}
				<Toast.CloseTrigger class="btn btn-sm">
					<Icons.X size={16} />
				</Toast.CloseTrigger>
			{/if}
		</Toast>
	{/snippet}
</Toast.Group>
