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
	import AccessibleShell from "$lib/client/accessibility/AccessibleShell.svelte"
	import AccessibleLoginForm from "$lib/client/accessibility/AccessibleLoginForm.svelte"
	import {
		accessibilityModeStore,
		pausedStore,
		isAccessibilityEnabled,
		isPaused,
		enableAccessibility,
		pause,
		mapToAccessibleRoute,
		mapToStandardRoute
	} from "$lib/client/accessibility/state.svelte"

	// Post-auth shell selection is derived from the URL itself — the same
	// source `children` comes from — rather than from accessibilityModeStore
	// directly. That flag flips synchronously the instant the shortcut fires,
	// while `children` only swaps to the new route's page once goto() finishes
	// (an async navigation). Deriving the shell from the flag meant there was
	// a window where the new shell had already mounted around the OLD page's
	// content (eg. AccessibleShell wrapping a standard library/chat page) —
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
	let showUpdateBar = $state(true)
	let showLogin = $state(false)

	// Document View (accessible) mode — see src/lib/client/accessibility/.
	// This is the ONLY branch point touching the shared root layout; the
	// non-accessible path below is otherwise unchanged from before.
	// accessibilityModeStore is a shared singleton (not local state) so that
	// src/routes/document-view/+layout.ts can also flip it — e.g. someone
	// navigating straight to a /document-view/* URL without ever pressing
	// the shortcut first.

	// A true toggle — "switch" (per how this shortcut's been described)
	// implies both directions, not just "turn Document View on". Pressing it
	// while already in Document View pauses back to the standard site (the
	// exact same action as its own "Browse Standard Site" button), so
	// there's always one obvious, memorized way back — that's also what
	// makes "Browse Standard Site Temporarily" actually temporary instead of
	// a one-way trip that only Settings can undo.
	function handleGlobalKeydown(event: KeyboardEvent) {
		if (
			event.ctrlKey &&
			event.shiftKey &&
			(event.key === "Y" || event.key === "y")
		) {
			event.preventDefault()
			if (showAccessibleShell || showAccessibleLogin) {
				pause()
				if (socketsInitialized)
					goto(mapToStandardRoute(page.url.pathname))
			} else {
				enableAccessibility()
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
		socketsInitialized = true
	}

	if (browser) {
		accessibilityModeStore.enabled = isAccessibilityEnabled()
		pausedStore.paused = isPaused()
		initializeSocketsIfAllowed()
	}
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<svelte:head>
	<title>Serene Pub</title>
	<meta name="description" content="Serene Pub" />
</svelte:head>

{#if socketsInitialized}
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
{:else if showLogin}
	{#if showAccessibleLogin}
		<AccessibleLoginForm />
	{:else}
		<LoginForm />
	{/if}
{/if}
{#if page.data?.isNewerReleaseAvailable && showUpdateBar}
	<div
		class="bg-surface-200-800 sticky right-0 bottom-0 left-0 z-100 p-4 text-center"
	>
		<span>
			A newer version of Serene Pub is available!&nbsp;
			<a
				href="https://github.com/doolijb/serene-pub/releases"
				target="_blank"
				rel="noopener"
				class="btn preset-filled-success-500"
			>
				<Icons.Download size={16} />
				Download here
			</a>
		</span>
		<button
			onclick={() => (showUpdateBar = false)}
			style="margin-left: 2rem; background: none; border: none; color: #fff; font-size: 1.5rem; cursor: pointer;"
		>
			<Icons.X size={16} />
		</button>
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
