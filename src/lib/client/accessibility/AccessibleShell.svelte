<script lang="ts">
	/**
	 * The Document View (accessible) shell — a self-contained layout that
	 * intentionally does NOT reuse Layout.svelte or panelsCtx (sidebar-
	 * specific, not needed here). It duplicates the minimal slice of
	 * Layout.svelte's own bootstrapping (auth-gated context setup + the
	 * handful of socket listeners that populate it) rather than importing/
	 * refactoring Layout.svelte, so that file stays completely untouched.
	 *
	 * Every page under src/routes/document-view/** is wrapped in this via
	 * src/routes/document-view/+layout.svelte.
	 */
	import { onMount, onDestroy, setContext, type Snippet } from "svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { appVersion } from "$lib/shared/constants/version"
	import "./accessible.css"
	import {
		isDarkMode,
		setDarkMode,
		getFontScaleIndex,
		setFontScaleIndex,
		FONT_SCALE_STEPS,
		pause,
		mapToStandardRoute,
		announce,
		announcerStore
	} from "./state.svelte"

	interface Props {
		children?: Snippet
	}
	let { children }: Props = $props()

	const socket = useTypedSocket()

	let userCtx: UserCtx = $state({ user: undefined })
	let systemSettingsCtx: SystemSettingsCtx = $state({ settings: undefined })
	let ollamaSettingsCtx: OllamaSettingsCtx = $state({ settings: undefined })
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = $state({
		settings: undefined
	})
	let userSettingsCtx: UserSettingsCtx = $state({ settings: undefined })

	setContext("userCtx", userCtx)
	setContext("systemSettingsCtx", systemSettingsCtx)
	setContext("ollamaSettingsCtx", ollamaSettingsCtx)
	setContext("koboldCppSettingsCtx", koboldCppSettingsCtx)
	setContext("userSettingsCtx", userSettingsCtx)

	let isSettingsLoaded = $derived(!!systemSettingsCtx.settings)
	let hasUser = $derived(!!userCtx.user)
	let isAdmin = $derived(!!userCtx.user?.isAdmin)
	let isAndroidWrapper = $derived(
		!!systemSettingsCtx.settings?.isAndroidWrapper
	)
	let isAccountsEnabled = $derived(
		!!systemSettingsCtx.settings?.isAccountsEnabled
	)

	$effect(() => {
		if (isSettingsLoaded) socket.emit("users:current", {})
	})
	$effect(() => {
		if (hasUser) socket.emit("userSettings:get", {})
	})

	function handleSystemSettingsGet(message: any) {
		systemSettingsCtx.settings = {
			...message.systemSettings,
			isAndroidWrapper: message.isAndroidWrapper,
			localEmbeddingsSupported: message.localEmbeddingsSupported
		}
		ollamaSettingsCtx.settings = { ...message.ollamaSettings }
		koboldCppSettingsCtx.settings = { ...message.koboldCppSettings }
	}
	function handleUsersCurrent(message: any) {
		userCtx.user = message.user
	}
	function handleUserSettingsGet(message: any) {
		userSettingsCtx.settings = message.userSettings
	}

	onMount(() => {
		socket.on("systemSettings:get", handleSystemSettingsGet)
		socket.on("users:current", handleUsersCurrent)
		socket.on("userSettings:get", handleUserSettingsGet)
		socket.emit("systemSettings:get", {})

		return () => {
			socket.off("systemSettings:get", handleSystemSettingsGet)
			socket.off("users:current", handleUsersCurrent)
			socket.off("userSettings:get", handleUserSettingsGet)
		}
	})

	// --- Document View's own dark mode / font size (independent of the main
	// app's theme system; never touches data-mode/data-theme on <html>) ---
	let darkMode = $state(true)
	let fontScaleIndex = $state(1)
	let rootEl: HTMLElement | undefined = $state()
	onMount(() => {
		darkMode = isDarkMode()
		fontScaleIndex = getFontScaleIndex()
	})

	// .a11y-root's own background (via min-height: 100vh) doesn't reliably
	// cover the full page in every case — scroll-bounce overscroll, mobile
	// browser chrome resizing the viewport, etc. — and underneath it <html>
	// still carries whatever background the main app's globally-bundled
	// Skeleton/Tailwind CSS set (present in the bundle regardless of which
	// shell is actually rendering). Left alone, that gap flashes the
	// standard theme's background through at the edges instead of
	// Document View's. Reading --a11y-bg back off the root element (rather
	// than duplicating the hex values from accessible.css here) keeps this
	// automatically in sync with the CSS regardless of mode. Cleared on
	// destroy so switching back to the standard site doesn't leave a stale
	// inline background behind for Layout.svelte's own theme system.
	$effect(() => {
		void darkMode
		if (typeof document === "undefined" || !rootEl) return
		requestAnimationFrame(() => {
			if (!rootEl) return
			const bg = getComputedStyle(rootEl)
				.getPropertyValue("--a11y-bg")
				.trim()
			if (!bg) return
			document.documentElement.style.backgroundColor = bg
			document.body.style.backgroundColor = bg
		})
	})
	onDestroy(() => {
		if (typeof document === "undefined") return
		document.documentElement.style.backgroundColor = ""
		document.body.style.backgroundColor = ""
	})
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

	function browseStandardSite() {
		pause()
		goto(mapToStandardRoute(page.url.pathname))
	}

	interface NavItem {
		href: string
		label: string
		show: boolean
	}
	let navItems = $derived.by((): NavItem[] => {
		const items: NavItem[] = [
			{ href: "/document-view", label: "Home", show: true },
			{ href: "/document-view/sessions", label: "Sessions", show: true },
			{
				href: "/document-view/characters",
				label: "Characters",
				show: true
			},
			{ href: "/document-view/personas", label: "Personas", show: true },
			{ href: "/document-view/docs", label: "Documentation", show: true },
			{
				href: "/document-view/connections",
				label: "Connections",
				show: isAdmin
			},
			{
				href: "/document-view/ollama",
				label: "Ollama Manager",
				show:
					isAdmin &&
					!isAndroidWrapper &&
					!!ollamaSettingsCtx.settings?.ollamaManagerEnabled
			},
			{
				href: "/document-view/koboldcpp",
				label: "KoboldCPP Manager",
				show:
					isAdmin &&
					!isAndroidWrapper &&
					!!koboldCppSettingsCtx.settings?.koboldCppManagerEnabled
			},
			{
				href: "/document-view/settings/system",
				label: "System Settings",
				show: isAdmin
			},
			{
				href: "/document-view/settings/users",
				label: "Users",
				show: isAdmin && isAccountsEnabled
			},
			{ href: "/document-view/settings", label: "Settings", show: true },
			{ href: "/document-view/help", label: "Help", show: true },
			{ href: "/document-view/about", label: "About", show: true }
		]
		return items.filter((i) => i.show)
	})

	function isCurrent(href: string): boolean {
		if (href === "/document-view")
			return page.url.pathname === "/document-view"
		return (
			page.url.pathname === href ||
			page.url.pathname.startsWith(href + "/")
		)
	}

	// SvelteKit doesn't move focus on its own for client-side route changes,
	// which leaves keyboard/screen-reader users stranded wherever they
	// clicked (often a now-stale nav link) — moving focus to <main> on every
	// navigation (skipping only the very first render, so it doesn't steal
	// focus from the browser chrome on initial load) mirrors what activating
	// the skip link would do, automatically, on every page change. The route
	// TITLE itself is deliberately not announced here — SvelteKit already
	// does that for free via its own #svelte-announcer live region; a second
	// one repeating the same text would just double-speak every navigation.
	let mainEl: HTMLElement | undefined = $state()
	let isFirstRouteRender = true
	$effect(() => {
		void page.url.pathname
		if (isFirstRouteRender) {
			isFirstRouteRender = false
			return
		}
		mainEl?.focus()
	})
</script>

<div
	class="a11y-root"
	data-a11y-mode={darkMode ? "dark" : "light"}
	style="--a11y-font-scale: {FONT_SCALE_STEPS[fontScaleIndex]}"
	bind:this={rootEl}
>
	<a href="#a11y-main-content" class="a11y-skip-link">Skip to main content</a>

	<div class="a11y-sr-only" role="status" aria-live="polite">
		{announcerStore.message}
	</div>

	<header class="a11y-header">
		<a href="/document-view" class="a11y-brand">
			Serene Pub — Document View (Accessible)
		</a>
		<div class="a11y-header-controls">
			<button
				type="button"
				class="a11y-btn a11y-btn-secondary a11y-btn-small"
				onclick={toggleDarkMode}
			>
				{darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
			</button>
			<button
				type="button"
				class="a11y-btn a11y-btn-secondary a11y-btn-small"
				onclick={() => changeFontScale(-1)}
				disabled={fontScaleIndex === 0}
				aria-label="Decrease text size"
			>
				A−
			</button>
			<span>{Math.round(FONT_SCALE_STEPS[fontScaleIndex] * 100)}%</span>
			<button
				type="button"
				class="a11y-btn a11y-btn-secondary a11y-btn-small"
				onclick={() => changeFontScale(1)}
				disabled={fontScaleIndex === FONT_SCALE_STEPS.length - 1}
				aria-label="Increase text size"
			>
				A+
			</button>
			<button
				type="button"
				class="a11y-btn a11y-btn-secondary a11y-btn-small"
				onclick={browseStandardSite}
			>
				Browse Standard Site
			</button>
		</div>
	</header>

	{#if hasUser}
		<nav class="a11y-nav" aria-label="Main">
			<ul>
				{#each navItems as item (item.href)}
					<li>
						<a
							href={item.href}
							aria-current={isCurrent(item.href)
								? "page"
								: undefined}
						>
							{item.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	<main
		id="a11y-main-content"
		class="a11y-main"
		tabindex="-1"
		bind:this={mainEl}
	>
		{@render children?.()}
	</main>

	<footer class="a11y-footer">
		<!-- The standard site marks a pre-release build with a faint,
		     click-through watermark in the corner (PrereleaseWatermark.svelte),
		     which is worth nothing here: it is aria-hidden by design, and low
		     opacity is the opposite of what this shell is for. The same fact,
		     as plain readable text, in the one region that renders on every
		     Document View page. -->
		{#if page.data?.isPrerelease}
			<p>
				Pre-release build {appVersion}. This is a preview, not a
				production release — expect unfinished features and changes
				between builds.
			</p>
		{/if}
		<p>
			Serene Pub is in beta. Document View is a simplified, high-contrast,
			keyboard- and screen-reader-friendly alternative to the standard
			interface.
		</p>
	</footer>
</div>
