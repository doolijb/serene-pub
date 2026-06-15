<script lang="ts">
	import Header from "./Header.svelte"
	import "../../../app.css"
	import * as Icons from "@lucide/svelte"
	import { fly } from "svelte/transition"
	import { onMount, setContext, onDestroy } from "svelte"
	import SamplingSidebar from "./sidebars/SamplingSidebar.svelte"
	import ConnectionsSidebar from "./sidebars/ConnectionsSidebar.svelte"
	import OllamaSidebar from "./sidebars/OllamaSidebar.svelte"
import KoboldCppSidebar from "./sidebars/KoboldCppSidebar.svelte"
	import ContextSidebar from "./sidebars/ContextSidebar.svelte"
	import LorebooksSidebar from "./sidebars/LorebooksSidebar.svelte"
	import PersonasSidebar from "./sidebars/PersonasSidebar.svelte"
	import CharactersSidebar from "./sidebars/CharactersSidebar.svelte"
	import ChatsSidebar from "./sidebars/ChatsSidebar.svelte"
	import PromptsSidebar from "./sidebars/PromptsSidebar.svelte"
	import TagsSidebar from "./sidebars/TagsSidebar.svelte"
	import UsersSidebar from "./sidebars/UsersSidebar.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import { KeyboardNavigationManager } from "$lib/client/utils/keyboardNavigation"
	import SettingsSidebar from "$lib/client/components/sidebars/SettingsSidebar.svelte"
	import ConnectionTimeoutModal from "$lib/client/components/ConnectionTimeoutModal.svelte"
	import type { Snippet } from "svelte"
	import { Theme } from "$lib/client/consts/Theme"
	import OllamaIcon from "./icons/OllamaIcon.svelte"
	import { page } from "$app/state"

	interface Props {
		children?: Snippet
	}

	let { children }: Props = $props()

	const socket = useTypedSocket()

	// Focus management refs
	let mainContentRef: HTMLElement
	let leftSidebarRef: HTMLElement
	let rightSidebarRef: HTMLElement
	let keyboardNavManager: KeyboardNavigationManager

	let userCtx: { user: SelectUser } = $state({} as { user: any })
	let panelsCtx: PanelsCtx = $state({
		leftPanel: null,
		rightPanel: null,
		mobilePanel: null,
		isMobileMenuOpen: false,
		openPanel,
		closePanel,
		onLeftPanelClose: undefined,
		onRightPanelClose: undefined,
		onMobilePanelClose: undefined,
		leftNav: {
			settings: { icon: Icons.Settings, title: "Settings" }
		},
		rightNav: {
			tags: { icon: Icons.Tag, title: "Tags" },
			personas: { icon: Icons.UserRound, title: "Personas" },
			characters: { icon: Icons.UsersRound, title: "Characters" },
			lorebooks: { icon: Icons.BookMarked, title: "Lorebooks+" },
			chats: { icon: Icons.MessageSquare, title: "Chats" }
		},
		digest: {},
		leftNavOrder: [
			"sampling",
			"connections",
			"ollama",
			"koboldcpp",
			"contexts",
			"prompts",
			"users",
			"settings"
		],
		rightNavOrder: ["tags", "personas", "characters", "lorebooks", "chats"],
		getOrderedEntries: (nav: Record<string, any>, order: string[]) => {
			// First, get entries that are in the order array
			const orderedEntries = order
				.filter((key) => key in nav)
				.map((key) => [key, nav[key]] as const)

			// Then, append any entries not in the order array
			const remainingEntries = Object.entries(nav).filter(
				([key]) => !order.includes(key)
			)

			return [...orderedEntries, ...remainingEntries]
		}
	})
	let systemSettingsCtx: SystemSettingsCtx = $state({ settings: undefined })
	let userSettingsCtx: UserSettingsCtx = $state({ settings: undefined })

	$effect(() => {
		console.log(
			"Layout systemSettingsCtx",
			$state.snapshot(systemSettingsCtx)
		)
	})

	// Derived state for authentication flow
	let isSettingsLoaded = $derived(!!systemSettingsCtx?.settings)
	let isAccountsEnabled = $derived(
		systemSettingsCtx?.settings?.isAccountsEnabled
	)
	let hasUser = $derived(!!userCtx.user)
	let shouldShowApp = $derived(isSettingsLoaded && hasUser)
	let isAdmin = $derived(!!userCtx.user?.isAdmin)

	// Update leftNav based on Ollama Manager setting
	$effect(() => {
		if (!isSettingsLoaded) return

		// Add Users sidebar if accounts are enabled
		if (isAccountsEnabled) {
			panelsCtx.leftNav.users = { icon: Icons.Users, title: "Users" }
		}

		// Add Ollama Manager if enabled
		if (systemSettingsCtx?.settings?.ollamaManagerEnabled && isAdmin) {
			panelsCtx.leftNav.ollama = {
				icon: OllamaIcon,
				title: "Ollama Manager"
			}
		}

		// Add KoboldCPP Manager if enabled
		if (systemSettingsCtx?.settings?.koboldCppManagerEnabled && isAdmin) {
			panelsCtx.leftNav.koboldcpp = {
				icon: Icons.Cpu,
				title: "KoboldCPP Manager"
			}
		}

		if (isAdmin) {
			panelsCtx.leftNav.sampling = {
				icon: Icons.SlidersHorizontal,
				title: "Sampling"
			}
			panelsCtx.leftNav.connections = {
				icon: Icons.Cable,
				title: "Connections"
			}
			panelsCtx.leftNav.contexts = {
				icon: Icons.BookOpenText,
				title: "Contexts"
			}
			panelsCtx.leftNav.prompts = {
				icon: Icons.MessageCircle,
				title: "Prompts"
			}
		}
	})

	function openPanel({
		key,
		toggle = true
	}: {
		key: string
		toggle?: boolean
	}): void {
		if (!isSettingsLoaded) return
		// Determine which nav the key belongs to
		const isLeft = Object.prototype.hasOwnProperty.call(
			panelsCtx.leftNav,
			key
		)
		const isRight = Object.prototype.hasOwnProperty.call(
			panelsCtx.rightNav,
			key
		)
		const isMobile = window.innerWidth < 768
		if (isMobile) {
			if (panelsCtx.mobilePanel === key) {
				if (toggle) {
					closePanel({ panel: "mobile" })
				}
				// else do nothing (leave open)
			} else if (panelsCtx.mobilePanel) {
				closePanel({ panel: "mobile" }).then((res) => {
					if (res) {
						panelsCtx.mobilePanel = key
						panelsCtx.leftPanel = null
						panelsCtx.rightPanel = null
					}
				})
			} else {
				panelsCtx.mobilePanel = key
				panelsCtx.leftPanel = null
				panelsCtx.rightPanel = null
			}
		} else if (isLeft) {
			if (panelsCtx.leftPanel === key) {
				if (toggle) {
					closePanel({ panel: "left" })
				}
				// else do nothing (leave open)
			} else if (panelsCtx.leftPanel) {
				closePanel({ panel: "left" }).then((res) => {
					if (res) {
						panelsCtx.leftPanel = key
					}
				})
			} else {
				panelsCtx.leftPanel = key
			}
		} else if (isRight) {
			if (panelsCtx.rightPanel === key) {
				if (toggle) {
					closePanel({ panel: "right" })
				}
				// else do nothing (leave open)
			} else if (panelsCtx.rightPanel) {
				closePanel({ panel: "right" }).then((res) => {
					if (res) {
						panelsCtx.rightPanel = key
					}
				})
			} else {
				panelsCtx.rightPanel = key
			}
		}
	}

	async function closePanel({
		panel
	}: {
		panel: "left" | "right" | "mobile"
	}): Promise<boolean> {
		if (!isSettingsLoaded) return Promise.resolve(false)
		let res: boolean = true // Default to allowing close
		if (panel === "mobile") {
			res = panelsCtx.onMobilePanelClose
				? ((await panelsCtx.onMobilePanelClose()) ?? true)
				: true
			panelsCtx.mobilePanel = res ? null : panelsCtx.mobilePanel
		} else if (panel === "left") {
			res = panelsCtx.onLeftPanelClose
				? ((await panelsCtx.onLeftPanelClose()) ?? true)
				: true
			panelsCtx.leftPanel = res ? null : panelsCtx.leftPanel
		} else if (panel === "right") {
			res = panelsCtx.onRightPanelClose
				? ((await panelsCtx.onRightPanelClose()) ?? true)
				: true
			panelsCtx.rightPanel = res ? null : panelsCtx.rightPanel
		}
		return res
	}

	function handleMobilePanelClick(key: string) {
		panelsCtx.openPanel({ key })
		panelsCtx.isMobileMenuOpen = false
	}

	$effect(() => {
		const mode =
			userSettingsCtx?.settings?.darkMode !== undefined
				? userSettingsCtx?.settings?.darkMode
					? "dark"
					: "light"
				: "dark"
		document.documentElement.setAttribute("data-mode", mode)
	})

	$effect(() => {
		const theme = userSettingsCtx.settings?.theme || Theme.HAMLINDIGO
		document.documentElement.setAttribute("data-theme", theme)
	})

	$effect(() => {
		if (isSettingsLoaded) {
			console.log("Settings loaded, getting current user")
			socket.emit("users:current", {})
		}
	})

	$effect(() => {
		if (hasUser) {
			socket.emit("userSettings:get", {})
		}
	})

	onMount(async () => {
		setContext("panelsCtx", panelsCtx as PanelsCtx)
		setContext("userCtx", userCtx)
		setContext("systemSettingsCtx", systemSettingsCtx)
		setContext("userSettingsCtx", userSettingsCtx)

		// Check system settings first before connecting to sockets
		try {
			const { checkSystemSettings, checkAuthentication } = await import(
				"$lib/client/utils/authFlow"
			)

			// Phase 1: Check if accounts are enabled
			const systemSettings = await checkSystemSettings()

			// If accounts are enabled, verify authentication
			if (systemSettings.isAccountsEnabled) {
				const isAuthenticated = await checkAuthentication()
				if (!isAuthenticated) {
					// User is not authenticated, redirect to login
					console.log(
						"Authentication required but user not authenticated"
					)
					toaster.error({
						title: "Authentication Required",
						description:
							"Please login to continue using the application."
					})
					// Note: Actual redirect to login page would be handled by the app's routing
					return
				}
			}

			// User is authenticated or accounts are disabled, proceed with socket connection
			initializeSocketConnection()
		} catch (error) {
			console.error("Failed to check authentication flow:", error)
			toaster.error({
				title: "Connection Error",
				description:
					"Failed to verify authentication. Please refresh the page."
			})
		}
	})

	function initializeSocketConnection() {
		socket.on("systemSettings:get", (message) => {
			console.log("Received systemSettings:get", message)
			systemSettingsCtx.settings = { ...message.systemSettings }
		})

		socket.on("users:current", (message) => {
			console.log("Received users:current", message)
			userCtx.user = message.user

			// Once we have a user, get user settings
			// This works for both enabled and disabled accounts
			if (message.user) {
				console.log("Emitting userSettings:get")
				socket.emit("userSettings:get", {})
			}
		})

		// Listen for user settings
		socket.on("userSettings:get", (message) => {
			console.log("Received userSettings:get", message)
			userSettingsCtx.settings = message.userSettings
		})

		// Capture all error events (both specific errors and general error events)
		socket.on("**:error", (message) => {
			toaster.error({
				title: message.error || "Error",
				description: message.description
			})
		})

		socket.on("error", (message) => {
			toaster.error({
				title: message.error,
				description: message.description
			})
		})

		socket.on("success", (message) => {
			toaster.success({
				title: message.title,
				description: message.description
			})
		})

		socket.emit("systemSettings:get", {})

		if (!isSettingsLoaded) return

		// Initialize keyboard navigation
		keyboardNavManager = new KeyboardNavigationManager({
			panelsCtx,
			onFocusMain: () => {
				if (mainContentRef) {
					KeyboardNavigationManager.focusFirstInteractive(
						mainContentRef
					)
					KeyboardNavigationManager.announceToScreenReader(
						"Main content focused"
					)
				}
			},
			onFocusLeftSidebar: () => {
				if (
					leftSidebarRef &&
					panelsCtx.leftNav &&
					panelsCtx.leftPanel
				) {
					KeyboardNavigationManager.focusFirstInteractive(
						leftSidebarRef
					)
					const panelName =
						panelsCtx.leftNav[panelsCtx.leftPanel]?.title ||
						panelsCtx.leftPanel
					KeyboardNavigationManager.announceToScreenReader(
						`${panelName} sidebar focused`
					)
				}
			},
			onFocusRightSidebar: () => {
				if (
					rightSidebarRef &&
					panelsCtx.rightNav &&
					panelsCtx.rightPanel
				) {
					KeyboardNavigationManager.focusFirstInteractive(
						rightSidebarRef
					)
					const panelName =
						panelsCtx.rightNav[panelsCtx.rightPanel]?.title ||
						panelsCtx.rightPanel
					KeyboardNavigationManager.announceToScreenReader(
						`${panelName} sidebar focused`
					)
				}
			}
		})
		keyboardNavManager.addGlobalListener()
	}

	// Effect to handle user authentication flow after system settings are loaded
	$effect(() => {
		if (!systemSettingsCtx) return

		console.log("Auth effect triggered", {
			hasSystemSettings: !!systemSettingsCtx.settings,
			isAccountsEnabled: systemSettingsCtx.settings?.isAccountsEnabled,
			hasUser: !!userCtx.user
		})

		// Only proceed if we have system settings
		if (!systemSettingsCtx.settings) return

		// If accounts are disabled, get user 1 automatically
		if (!systemSettingsCtx.settings.isAccountsEnabled && !userCtx.user) {
			console.log("Accounts disabled, emitting users:get")
			socket.emit("users:get", {})
		}
		// If accounts are enabled and we don't have a user, the login form will be shown
	})

	onDestroy(() => {
		keyboardNavManager?.removeGlobalListener()
		socket.off("users:get")
		socket.off("systemSettings:get")
		socket.off("userSettings:get")
		socket.off("**:error")
		socket.off("error")
		socket.off("success")
	})
</script>

{#if shouldShowApp}
	<!-- Show normal app when accounts are disabled OR when accounts are enabled and user is authenticated -->
	<div
		class="bg-surface-100-900 relative h-full max-h-[100dvh] w-full justify-between"
		role="application"
		aria-label="Serene Pub Chat Application"
	>
		<div
			class="relative flex h-svh max-w-full min-w-full flex-1 flex-col overflow-hidden lg:flex-row lg:gap-2"
		>
			<!-- Left Sidebar -->
			<aside class="desktop-sidebar" aria-label="Left navigation panel">
				{#if panelsCtx.leftPanel}
					{@const title =
						panelsCtx.leftNav[panelsCtx.leftPanel]?.title ||
						panelsCtx.leftPanel}
					<div
						bind:this={leftSidebarRef}
						class="bg-surface-50-950 me-2 flex h-full w-full flex-col overflow-y-auto rounded-r-lg"
						in:fly={{ x: -100, duration: 200 }}
						out:fly={{ x: -100, duration: 200 }}
						role="region"
						aria-labelledby="left-panel-title"
						aria-label="{title} sidebar - {Object.keys(
							panelsCtx.leftNav
						).indexOf(panelsCtx.leftPanel) + 1} of {Object.keys(
							panelsCtx.leftNav
						).length}"
						tabindex="-1"
					>
						<div class="flex items-center justify-between p-4">
							<h2
								id="left-panel-title"
								class="text-foreground text-lg font-semibold capitalize"
							>
								{title}
							</h2>
							<button
								class="btn-ghost"
								onclick={() => closePanel({ panel: "left" })}
								aria-label="Close {title} panel"
								type="button"
							>
								<Icons.X
									class="text-foreground h-5 w-5"
									aria-hidden="true"
								/>
							</button>
						</div>
						<div class="flex-1 overflow-y-auto">
							{#if panelsCtx.leftPanel === "sampling"}
								<SamplingSidebar
									bind:onclose={panelsCtx.onLeftPanelClose}
								/>
							{:else if panelsCtx.leftPanel === "connections"}
								<ConnectionsSidebar
									bind:onclose={panelsCtx.onLeftPanelClose}
								/>
							{:else if panelsCtx.leftPanel === "users"}
								<UsersSidebar
									bind:onclose={panelsCtx.onLeftPanelClose}
								/>
							{:else if panelsCtx.leftPanel === "ollama"}
								<OllamaSidebar
									bind:onclose={panelsCtx.onLeftPanelClose}
								/>
							{:else if panelsCtx.leftPanel === "koboldcpp"}
								<KoboldCppSidebar
									bind:onclose={panelsCtx.onLeftPanelClose}
								/>
							{:else if panelsCtx.leftPanel === "contexts"}
								<ContextSidebar
									bind:onclose={panelsCtx.onLeftPanelClose}
								/>
							{:else if panelsCtx.leftPanel === "prompts"}
								<PromptsSidebar
									bind:onclose={panelsCtx.onLeftPanelClose}
								/>
							{:else if panelsCtx.leftPanel === "settings"}
								<SettingsSidebar
									bind:onclose={panelsCtx.onLeftPanelClose}
								/>
							{/if}
						</div>
					</div>
				{/if}
			</aside>
			<!-- Main Content -->
			<main
				bind:this={mainContentRef}
				class="flex h-full flex-col overflow-hidden"
				tabindex="-1"
			>
				<Header />
				<div class="flex-1 overflow-auto">
					{@render children?.()}
				</div>
			</main>
			<!-- Right Sidebar -->
			<aside
				class="desktop-sidebar pt-1"
				aria-label="Right navigation panel"
			>
				{#if panelsCtx.rightPanel}
					{@const title =
						panelsCtx.rightNav[panelsCtx.rightPanel]?.title ||
						panelsCtx.rightPanel}
					<div
						bind:this={rightSidebarRef}
						class="bg-surface-50-950 flex h-full w-full flex-col overflow-y-auto rounded-l-lg"
						in:fly={{ x: 100, duration: 200 }}
						out:fly={{ x: 100, duration: 200 }}
						role="region"
						aria-labelledby="right-panel-title"
						aria-label="{title} sidebar - {Object.keys(
							panelsCtx.rightNav
						).indexOf(panelsCtx.rightPanel) + 1} of {Object.keys(
							panelsCtx.rightNav
						).length}"
						tabindex="-1"
					>
						<div class="flex items-center justify-between p-4">
							<h2
								id="right-panel-title"
								class="text-foreground text-lg font-semibold capitalize"
							>
								{title}
							</h2>
							<button
								class="btn-ghost"
								onclick={() => closePanel({ panel: "right" })}
								aria-label="Close {title} panel"
								type="button"
							>
								<Icons.X
									class="text-foreground h-5 w-5"
									aria-hidden="true"
								/>
							</button>
						</div>
						<nav class="flex-1 overflow-y-auto">
							{#if panelsCtx.rightPanel === "personas"}
								<PersonasSidebar
									bind:onclose={panelsCtx.onRightPanelClose}
								/>
							{:else if panelsCtx.rightPanel === "characters"}
								<CharactersSidebar
									bind:onclose={panelsCtx.onRightPanelClose}
								/>
							{:else if panelsCtx.rightPanel === "chats"}
								<ChatsSidebar
									bind:onclose={panelsCtx.onRightPanelClose}
								/>
							{:else if panelsCtx.rightPanel === "lorebooks"}
								<LorebooksSidebar
									bind:onclose={panelsCtx.onRightPanelClose}
								/>
							{:else if panelsCtx.rightPanel === "tags"}
								<TagsSidebar
									bind:onclose={panelsCtx.onRightPanelClose}
								/>
							{/if}
						</nav>
					</div>
				{/if}
			</aside>
		</div>
		{#if panelsCtx.mobilePanel}
			{@const title =
				{ ...panelsCtx.leftNav, ...panelsCtx.rightNav }[
					panelsCtx.mobilePanel
				]?.title || panelsCtx.mobilePanel}
			<div
				class="bg-surface-100-900 fixed inset-0 z-[51] flex flex-col overflow-y-auto lg:hidden"
				role="dialog"
				aria-labelledby="mobile-panel-title"
				aria-modal="true"
			>
				<div
					class="border-border flex items-center justify-between border-b p-4"
				>
					<span
						class="text-foreground text-lg font-semibold capitalize"
					>
						{panelsCtx.mobilePanel}
					</span>
					<button
						class="btn-ghost"
						onclick={() => closePanel({ panel: "mobile" })}
					>
						<Icons.X class="text-foreground h-5 w-5" />
					</button>
				</div>
				<div class="flex-1 overflow-y-auto">
					{#if panelsCtx.mobilePanel === "sampling"}
						<SamplingSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "connections"}
						<ConnectionsSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "users"}
						<UsersSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "ollama"}
						<OllamaSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "koboldcpp"}
						<KoboldCppSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "contexts"}
						<ContextSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "lorebooks"}
						<LorebooksSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "personas"}
						<PersonasSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "characters"}
						<CharactersSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "chats"}
						<ChatsSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "prompts"}
						<PromptsSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "tags"}
						<TagsSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "settings"}
						<SettingsSidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{/if}
				</div>
			</div>
		{/if}
		<!-- Mobile menu -->
		{#if panelsCtx.isMobileMenuOpen}
			<!-- Backdrop -->
			<div class="fixed inset-0 z-[40] bg-black/40"></div>
			<div
				class="bg-surface-100-900/95 fixed inset-0 z-[40] flex flex-col overflow-y-auto px-2 lg:hidden"
			>
				<div
					class="border-border flex items-center justify-between border-b p-4"
				>
					<span
						class="text-foreground funnel-display text-xl font-bold tracking-tight whitespace-nowrap"
					>
						Serene Pub
					</span>
					<button
						type="button"
						onclick={(e) => {
							console.log("Click!")
							e.stopPropagation()
							panelsCtx.isMobileMenuOpen = false
						}}
					>
						<Icons.X class="text-foreground h-6 w-6" />
					</button>
				</div>
				<div class="flex flex-col gap-4 overflow-y-auto p-4 text-2xl">
					{#each panelsCtx.getOrderedEntries( { ...panelsCtx.leftNav, ...panelsCtx.rightNav }, [...panelsCtx.leftNavOrder, ...panelsCtx.rightNavOrder] ) as [key, item]}
						<button
							class="btn-ghost flex items-center gap-2"
							title={item.title}
							onclick={() => handleMobilePanelClick(key)}
						>
							<item.icon class="text-foreground h-5 w-5" />
							<span>{item.title}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}

<!-- Connection Timeout Modal -->
<ConnectionTimeoutModal />

<style lang="postcss">
	@reference "tailwindcss";

	/* w-[100%] lg:min-w-[50%] lg:w-[50%] */

	main {
		@apply relative m-0 lg:max-w-[50%] lg:basis-1/2;
	}

	/* w-[25%] max-w-[25%] */

	.desktop-sidebar {
		@apply hidden max-h-full min-h-full basis-1/4 overflow-x-hidden py-1 lg:block;
	}
</style>
