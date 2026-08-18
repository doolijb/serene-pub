<script lang="ts">
	import Header from "./Header.svelte"
	import PanelHeader from "./panels/PanelHeader.svelte"
	import "../../../app.css"
	import * as Icons from "@lucide/svelte"
	import { fly, fade } from "svelte/transition"
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
	import ActivitySidebar from "$lib/client/components/sidebars/ActivitySidebar.svelte"
	import ConnectionTimeoutModal from "$lib/client/components/ConnectionTimeoutModal.svelte"
	import UpdateNoticeBar from "$lib/client/components/UpdateNoticeBar.svelte"
	import type { Snippet } from "svelte"
	import { Theme } from "$lib/client/consts/Theme"
	import OllamaIcon from "./icons/OllamaIcon.svelte"
	import { page } from "$app/state"
	import { sceneImages } from "$lib/client/stores/sceneImages"

	interface Props {
		children?: Snippet
	}

	let { children }: Props = $props()

	const socket = useTypedSocket()

	// Event names ending in ":error" that already have their own explicit
	// socket.on(...) listener elsewhere in the app (some of which show their
	// own toast, some of which deliberately show nothing / handle the error
	// inline). The generic onAny catch-all below must skip these so we don't
	// double-toast (or override an intentional suppression) - see the
	// wildcard error handling note near `handleAnyEvent`.
	const HANDLED_ERROR_EVENTS = new Set<string>([
		"characters:create:error",
		"characters:exportCard:error",
		"characters:list:error",
		"characters:update:error",
		"characters:uploadGalleryImage:error",
		"chats:list:error",
		"chats:summarize:error",
		"connections:list:error",
		"connections:refreshModels:error",
		"customThemes:delete:error",
		"customThemes:list:error",
		"customThemes:save:error",
		"customThemes:setInstanceTheme:error",
		"koboldcpp:checkManagedBinaryUpdate:error",
		"koboldcpp:connectModel:error",
		"koboldcpp:deleteModel:error",
		"koboldcpp:downloadModel:error",
		"koboldcpp:isUpdateAvailable:error",
		"koboldcpp:listBinaryVariants:error",
		"koboldcpp:listReleaseVersions:error",
		"koboldcpp:perf:error",
		"koboldcpp:recommendedModels:error",
		"koboldcpp:searchModels:error",
		"koboldcpp:setManagedMode:error",
		"koboldcpp:startSubprocess:error",
		"koboldcpp:version:error",
		"lorebooks:list:error",
		"narratorPromptConfigs:setUserActive:error",
		"ollama:pullModel:error",
		"personas:create:error",
		"personas:list:error",
		"personas:update:error",
		"personas:uploadGalleryImage:error",
		"promptConfigs:setUserActive:error",
		"scenes:compile:error",
		"scenes:process:error",
		"systemSettings:updateAccountsEnabled:error",
		"tags:list:error",
		"users:current:changePassphrase:error",
		"users:current:logout:error",
		"users:current:updateDisplayName:error",
		"userSettings:uploadBackground:error",
		"vectorization:setModel:error"
	])

	// Turns "characters:update:error" into "Characters update failed", etc.
	// Used only as a fallback title when no specific listener has already
	// produced a nicer one for a given event.
	function humanizeErrorEvent(event: string): string {
		const base = event.replace(/:error$/, "")
		const words = base
			.split(":")
			.flatMap((segment) =>
				segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ")
			)
			.filter(Boolean)
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		return `${words.join(" ")} failed`
	}

	// Generic catch-all error handler. Socket.IO has no glob/wildcard event
	// matching (a literal event named "**:error" would never fire), so this
	// uses the real `onAny` API to inspect every event and toast on any
	// "*:error" event that isn't already handled by a more specific listener
	// (see HANDLED_ERROR_EVENTS above). This ensures actions that previously
	// failed silently (no toast, no UI change) now always surface an error.
	function handleAnyEvent(event: string, payload: any) {
		if (event === "error" || !event.endsWith(":error")) return
		if (HANDLED_ERROR_EVENTS.has(event)) return
		const description =
			typeof payload?.error === "string"
				? payload.error
				: typeof payload?.description === "string"
					? payload.description
					: undefined
		toaster.error({
			title: humanizeErrorEvent(event),
			description
		})
	}

	// Focus management refs
	let mainContentRef = $state<HTMLElement | null>(null)
	let leftSidebarRef = $state<HTMLElement | null>(null)
	let rightSidebarRef = $state<HTMLElement | null>(null)
	let keyboardNavManager: KeyboardNavigationManager

	let userCtx: { user: SelectUser } = $state({} as { user: any })
	let panelsCtx: PanelsCtx = $state({
		leftPanel: null,
		rightPanel: null,
		mobilePanel: null,
		isMobileMenuOpen: false,
		// Only one side can be fullscreen at a time — expanding to cover the
		// whole viewport while another panel also claims it doesn't make
		// sense. Desktop-only: the mobile single-panel overlay already fills
		// the screen, and the toggle button lives inside the
		// `.desktop-sidebar` asides (`hidden ... lg:block`), so it's never
		// rendered on mobile in the first place — no separate mobile check
		// needed here. Lives on panelsCtx (not a local Layout.svelte
		// variable) so any sidebar can reset it via context — e.g. a button
		// that navigates to a different page, where staying fullscreen
		// would cover up the page it just navigated to.
		fullscreenPanel: null,
		openPanel,
		closePanel,
		onLeftPanelClose: undefined,
		onRightPanelClose: undefined,
		onMobilePanelClose: undefined,
		leftNav: {
			settings: { icon: Icons.Settings, title: "Settings" }
		},
		rightNav: {
			activity: { icon: Icons.Bell, title: "Activity" },
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
		rightNavOrder: [
			"activity",
			"tags",
			"personas",
			"characters",
			"lorebooks",
			"chats"
		],
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
	let ollamaSettingsCtx: OllamaSettingsCtx = $state({ settings: undefined })
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = $state({
		settings: undefined
	})
	let userSettingsCtx: UserSettingsCtx = $state({ settings: undefined })
	let customThemeCssKeys = $state<Record<string, string>>({})
	let vectorizationCtx: VectorizationCtx = $state({
		status: "idle",
		currentItem: undefined,
		queued: 0,
		completed: 0,
		priorityQueue: [],
		history: []
	})
	let taskQueueCtx: TaskQueueCtx = $state({ tasks: [] })
	let openChatCtx: OpenChatCtx = $state({
		chatId: null,
		lorebookId: null,
		isOwner: false
	})
	let graphBuildsCtx: GraphBuildsCtx = $state({
		activeBuild: null,
		reopenLorebookId: null,
		startBuild: (params) => {
			graphBuildsCtx.activeBuild = {
				lorebookId: params.lorebookId,
				lorebookLabel: params.lorebookLabel,
				mode: params.mode,
				status: "building",
				phase: "loading",
				sceneIndex: 0,
				totalScenes: 0,
				nodesFound: 0,
				relsFound: 0,
				startedAt: new Date().toISOString()
			}
		},
		clearBuild: () => {
			const id = graphBuildsCtx.activeBuild?.activityId
			if (id) socket.emit("activity:dismiss", { id })
			graphBuildsCtx.activeBuild = null
			graphBuildsCtx.reopenLorebookId = null
		}
	})
	let sceneSummarizesCtx: SceneSummarizesCtx = $state({
		activities: [],
		reviewSceneId: null,
		dismiss: (activityId: string) => {
			socket.emit("activity:dismiss", { id: activityId })
			sceneSummarizesCtx.activities =
				sceneSummarizesCtx.activities.filter(
					(a) => a.activityId !== activityId
				)
		},
		setReviewSceneId: (id: number | null) => {
			sceneSummarizesCtx.reviewSceneId = id
		}
	})
	let chatSummarizesCtx: ChatSummarizesCtx = $state({
		activities: [],
		reviewActivityId: null,
		dismiss: (activityId: string) => {
			socket.emit("activity:dismiss", { id: activityId })
			chatSummarizesCtx.activities = chatSummarizesCtx.activities.filter(
				(a) => a.activityId !== activityId
			)
		},
		setReviewActivityId: (id: string | null) => {
			chatSummarizesCtx.reviewActivityId = id
		}
	})
	let compileEntriesCtx: CompileEntriesCtx = $state({
		activities: [],
		reviewHistoryEntryId: null,
		dismiss: (activityId: string) => {
			socket.emit("activity:dismiss", { id: activityId })
			compileEntriesCtx.activities = compileEntriesCtx.activities.filter(
				(a) => a.activityId !== activityId
			)
		},
		setReviewHistoryEntryId: (id: number | null) => {
			compileEntriesCtx.reviewHistoryEntryId = id
		}
	})

	$effect(() => {})

	// Derived state for authentication flow
	let isSettingsLoaded = $derived(!!systemSettingsCtx?.settings)
	let isAccountsEnabled = $derived(
		systemSettingsCtx?.settings?.isAccountsEnabled
	)
	let hasUser = $derived(!!userCtx.user)
	let shouldShowApp = $derived(isSettingsLoaded && hasUser)
	let isAdmin = $derived(!!userCtx.user?.isAdmin)
	// Managed local model runners need a binary we don't/can't bundle for
	// Android — Ollama Manager and KoboldCPP Manager are hidden in this wrapper
	// regardless of their underlying DB flags. Embeddings/Vectorization isn't:
	// local ONNX models can't load under Bionic, but external-API embeddings
	// work fine, so its nav entry stays visible and the sidebar itself gates
	// the local-model option (VectorizationSetupScreen).
	let isAndroidWrapper = $derived(
		!!systemSettingsCtx?.settings?.isAndroidWrapper
	)

	// Update leftNav based on Ollama Manager setting
	$effect(() => {
		if (!isSettingsLoaded) return

		// Add Users sidebar if accounts are enabled
		if (isAccountsEnabled && isAdmin) {
			panelsCtx.leftNav.users = { icon: Icons.Users, title: "Users" }
		} else {
			delete panelsCtx.leftNav.users
		}

		// Add/remove Ollama Manager based on setting
		if (
			ollamaSettingsCtx?.settings?.ollamaManagerEnabled &&
			isAdmin &&
			!isAndroidWrapper
		) {
			panelsCtx.leftNav.ollama = {
				icon: OllamaIcon,
				title: "Ollama Manager"
			}
		} else {
			delete panelsCtx.leftNav.ollama
		}

		// Add/remove KoboldCPP Manager based on setting
		if (
			koboldCppSettingsCtx?.settings?.koboldCppManagerEnabled &&
			isAdmin &&
			!isAndroidWrapper
		) {
			panelsCtx.leftNav.koboldcpp = {
				imgSrc: "/koboldcpp/koboldcpp-icon.svg",
				title: "KoboldCPP Manager"
			}
		} else {
			delete panelsCtx.leftNav.koboldcpp
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
				title: "Prompt Configs"
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
		// Must match the `lg` breakpoint the desktop sidebars (`hidden ...
		// lg:block`) and header hamburger (`lg:hidden`) actually switch at —
		// using `md` (768) here left a dead zone from 768-1023px where this
		// sets desktop panel state but the sidebars are still display:none
		// until 1024px, so nothing visibly opened.
		const isMobile = window.innerWidth < 1024
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
			if (res && panelsCtx.fullscreenPanel === "left")
				panelsCtx.fullscreenPanel = null
		} else if (panel === "right") {
			res = panelsCtx.onRightPanelClose
				? ((await panelsCtx.onRightPanelClose()) ?? true)
				: true
			panelsCtx.rightPanel = res ? null : panelsCtx.rightPanel
			if (res && panelsCtx.fullscreenPanel === "right")
				panelsCtx.fullscreenPanel = null
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
		// Custom themes: data-theme = cssKey so it matches the injected stylesheet selector
		// Built-in themes: cssKey not in map, falls back to the theme name itself
		const dataTheme = customThemeCssKeys[theme] || theme
		document.documentElement.setAttribute("data-theme", dataTheme)
	})

	// Remove all style elements for a given theme name, then inject a fresh one keyed by cssKey.
	// Using cssKey in the element ID ensures browsers always parse a new stylesheet on update.
	function injectCustomThemeCss(name: string, cssKey: string, css: string) {
		document
			.querySelectorAll(`style[data-custom-theme="${name}"]`)
			.forEach((el) => el.remove())
		const el = document.createElement("style")
		el.id = `custom-theme-${cssKey}`
		el.dataset.customTheme = name
		el.textContent = css
		document.head.appendChild(el)
	}

	function removeCustomThemeCss(name: string) {
		document
			.querySelectorAll(`style[data-custom-theme="${name}"]`)
			.forEach((el) => el.remove())
	}

	onMount(() => {
		socket.on(
			"customThemes:list",
			(msg: Sockets.CustomThemes.List.Response) => {
				const allMeta = [...msg.myThemes, ...msg.instanceThemes]
				const customNames = new Set(allMeta.map((t) => t.name))
				const builtinNames = new Set(Theme.options.map(([v]) => v))

				// Pre-populate cssKey map so data-theme updates before getCss response arrives
				allMeta.forEach((t) => {
					if (t.cssKey) customThemeCssKeys[t.name] = t.cssKey
				})

				// Fall back to hamlindigo if the active theme is a custom theme that no longer exists
				const currentTheme = userSettingsCtx.settings?.theme
				if (
					currentTheme &&
					!builtinNames.has(currentTheme) &&
					!customNames.has(currentTheme)
				) {
					socket.emit("userSettings:updateTheme", {
						theme: Theme.HAMLINDIGO
					})
				}

				// Fetch CSS for current themes
				allMeta.forEach((t) =>
					socket.emit("customThemes:getCss", { name: t.name })
				)
			}
		)
		socket.on(
			"customThemes:getCss",
			(msg: Sockets.CustomThemes.GetCss.Response) => {
				customThemeCssKeys[msg.name] = msg.cssKey
				// Filename (element ID) = cssKey — fresh element per cssKey, never stale
				injectCustomThemeCss(
					msg.name,
					msg.cssKey,
					`[data-theme='${msg.cssKey}'] {\n${msg.css}\n}`
				)
			}
		)
		socket.on("customThemes:delete", () => {
			socket.emit("customThemes:list", {})
		})
		socket.on(
			"customThemes:save",
			(msg: Sockets.CustomThemes.Save.Response) => {
				// Update cssKey immediately so data-theme snaps to new selector before CSS arrives
				customThemeCssKeys[msg.theme.name] = msg.theme.cssKey
				socket.emit("customThemes:getCss", { name: msg.theme.name })
			}
		)
		socket.emit("customThemes:list", {})
	})

	$effect(() => {
		if (isSettingsLoaded) {
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
		setContext("ollamaSettingsCtx", ollamaSettingsCtx)
		setContext("koboldCppSettingsCtx", koboldCppSettingsCtx)
		setContext("userSettingsCtx", userSettingsCtx)
		setContext("vectorizationCtx", vectorizationCtx)
		setContext("taskQueueCtx", taskQueueCtx)
		setContext("openChatCtx", openChatCtx)
		setContext("graphBuildsCtx", graphBuildsCtx)
		setContext("sceneSummarizesCtx", sceneSummarizesCtx)
		setContext("chatSummarizesCtx", chatSummarizesCtx)
		setContext("compileEntriesCtx", compileEntriesCtx)

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
			systemSettingsCtx.settings = {
				...message.systemSettings,
				isAndroidWrapper: message.isAndroidWrapper,
				localEmbeddingsSupported: message.localEmbeddingsSupported
			}
			ollamaSettingsCtx.settings = { ...message.ollamaSettings }
			koboldCppSettingsCtx.settings = { ...message.koboldCppSettings }
		})

		socket.on("users:current", (message) => {
			userCtx.user = message.user

			// userSettings:get is requested by the `hasUser` $effect above;
			// only the admin-only taskQueue fetch needs to happen here.
			if (message.user?.isAdmin) {
				socket.emit("taskQueue:get", {})
			}
		})

		// Listen for user settings
		socket.on("userSettings:get", (message) => {
			userSettingsCtx.settings = message.userSettings
		})

		// Capture all otherwise-unhandled "*:error" events (see handleAnyEvent
		// / HANDLED_ERROR_EVENTS above for why this uses onAny rather than a
		// literal "**:error" listener, which never fires).
		socket.onAny(handleAnyEvent)

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

		socket.on("vectorization:progress", (message) => {
			vectorizationCtx.status = message.status
			vectorizationCtx.currentItem = message.currentItem
			vectorizationCtx.queued = message.queued
			vectorizationCtx.completed = message.completed
			vectorizationCtx.priorityQueue = message.priorityQueue ?? []
			vectorizationCtx.history = message.history ?? []
		})

		socket.on("taskQueue:update", (message) => {
			taskQueueCtx.tasks = message.tasks ?? []
		})

		socket.on("activity:update", (data) => {
			const activities = data.activities ?? []
			const graphActivities = activities.filter(
				(a: any) => a.kind === "graph_build"
			)
			const sceneActivities = activities.filter(
				(a: any) => a.kind === "scene_summarize"
			)

			// Graph build: take the most recent one
			const latestGraph = [...graphActivities].sort(
				(a: any, b: any) =>
					new Date(b.startedAt).getTime() -
					new Date(a.startedAt).getTime()
			)[0] as any
			if (!latestGraph) {
				graphBuildsCtx.activeBuild = null
			} else {
				const prevTrace =
					graphBuildsCtx.activeBuild?.activityId === latestGraph.id
						? graphBuildsCtx.activeBuild?.trace
						: undefined
				graphBuildsCtx.activeBuild = {
					activityId: latestGraph.id,
					userId: latestGraph.userId,
					lorebookId: latestGraph.lorebookId,
					lorebookLabel: latestGraph.lorebookLabel,
					mode: latestGraph.mode,
					status: latestGraph.status,
					phase: latestGraph.phase,
					sceneIndex: latestGraph.sceneIndex,
					totalScenes: latestGraph.totalScenes,
					nodesFound: latestGraph.nodesFound,
					relsFound: latestGraph.relsFound,
					currentPair: latestGraph.currentPair,
					currentSceneLabel: latestGraph.currentSceneLabel,
					proposal: latestGraph.proposal,
					sceneLabels: latestGraph.sceneLabels,
					seedTempIdMap: latestGraph.seedTempIdMap,
					seedNodeNames: latestGraph.seedNodeNames,
					relationshipDiagnostics:
						latestGraph.relationshipDiagnostics,
					filteredWorldLoreNames: latestGraph.filteredWorldLoreNames,
					errorMessage: latestGraph.errorMessage,
					errorRaw: latestGraph.errorRaw,
					startedAt: latestGraph.startedAt,
					trace: prevTrace
				}
			}

			// Scene summarizations: keep all
			sceneSummarizesCtx.activities = sceneActivities.map((a: any) => ({
				activityId: a.id,
				userId: a.userId,
				sceneId: a.sceneId,
				sceneName: a.sceneName,
				lorebookId: a.lorebookId,
				lorebookLabel: a.lorebookLabel,
				historyEntryId: a.historyEntryId,
				status: a.status,
				phase: a.phase,
				batch: a.batch,
				totalBatches: a.totalBatches,
				errorMessage: a.errorMessage,
				pendingResult: a.pendingResult,
				startedAt: a.startedAt
			}))

			// Chat-side world/character lore summarize activities
			const chatSummarizeActivities = activities.filter(
				(a: any) => a.kind === "chat_summarize"
			)
			chatSummarizesCtx.activities = chatSummarizeActivities.map(
				(a: any) => ({
					activityId: a.id,
					userId: a.userId,
					chatId: a.chatId,
					chatLabel: a.chatLabel,
					loreType: a.loreType,
					lorebookId: a.lorebookId,
					topic: a.topic,
					status: a.status,
					phase: a.phase,
					batch: a.batch,
					totalBatches: a.totalBatches,
					errorMessage: a.errorMessage,
					pendingResult: a.pendingResult,
					startedAt: a.startedAt
				})
			)

			// History entry compile activities
			const compileActivities = activities.filter(
				(a: any) => a.kind === "compile_history_entry"
			)
			compileEntriesCtx.activities = compileActivities.map((a: any) => ({
				activityId: a.id,
				userId: a.userId,
				historyEntryId: a.historyEntryId,
				historyEntryDate: a.historyEntryDate,
				lorebookId: a.lorebookId,
				lorebookLabel: a.lorebookLabel,
				status: a.status,
				phase: a.phase,
				batch: a.batch,
				totalBatches: a.totalBatches,
				errorMessage: a.errorMessage,
				pendingResult: a.pendingResult,
				startedAt: a.startedAt
			}))
		})

		socket.on("narrativeGraph:buildLog", (entry) => {
			if (!graphBuildsCtx.activeBuild) return
			graphBuildsCtx.activeBuild.trace = [
				...(graphBuildsCtx.activeBuild.trace ?? []),
				entry
			]
		})

		socket.emit("activity:get", {})
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

		// Only proceed if we have system settings
		if (!systemSettingsCtx.settings) return

		// If accounts are disabled, get user 1 automatically
		if (!systemSettingsCtx.settings.isAccountsEnabled && !userCtx.user) {
			socket.emit("users:get", {})
		}
		// If accounts are enabled and we don't have a user, the login form will be shown
	})

	onDestroy(() => {
		keyboardNavManager?.removeGlobalListener()
		socket.off("users:get")
		socket.off("systemSettings:get")
		socket.off("userSettings:get")
		socket.offAny(handleAnyEvent)
		socket.off("error")
		socket.off("success")
		socket.off("vectorization:progress")
		socket.off("activity:update")
		socket.off("narrativeGraph:buildLog")
		socket.off("customThemes:list")
		socket.off("customThemes:getCss")
		socket.off("customThemes:save")
		socket.off("customThemes:delete")
	})
</script>

{#if shouldShowApp}
	<!-- Show normal app when accounts are disabled OR when accounts are enabled and user is authenticated -->
	<div
		class="bg-surface-100-900 relative h-full max-h-[100dvh] w-full justify-between"
		role="application"
		aria-label="Serene Pub Chat Application"
	>
		<!-- Background image layer -->
		{#if userSettingsCtx.settings?.backgroundImagePath}
			{@const bgOpacity =
				(userSettingsCtx.settings.backgroundOpacity ?? 75) / 100}
			<div
				class="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
				style="background-image: url({userSettingsCtx.settings
					.backgroundImagePath}); opacity: {bgOpacity};"
				aria-hidden="true"
			></div>
		{/if}
		<!-- Character scene image overlays — fixed at z-[2] so sidebars (z-10) always paint on top -->
		{#if $sceneImages.left}
			<div
				class="pointer-events-none fixed bottom-0 left-0 z-[2] hidden w-1/4 lg:block"
				style="height: 80svh;"
				aria-hidden="true"
			>
				<img
					src={$sceneImages.left}
					alt=""
					class="h-full w-full object-contain object-bottom drop-shadow-xl"
				/>
			</div>
		{/if}
		{#if $sceneImages.right}
			<div
				class="pointer-events-none fixed right-0 bottom-0 z-[2] hidden w-1/4 lg:block"
				style="height: 80svh;"
				aria-hidden="true"
			>
				<img
					src={$sceneImages.right}
					alt=""
					class="h-full w-full object-contain object-bottom drop-shadow-xl"
				/>
			</div>
		{/if}
		<!--
			overflow-CLIP, not overflow-hidden. Both clip identically, but
			`hidden` still establishes a scroll container: the browser can
			scroll it programmatically even though the user cannot. Focusing a
			control low in a side panel (any switch under the lorebook entry's
			Advanced Settings, for instance) therefore made the browser
			scrollIntoView this shell, shifting the ENTIRE app up by however
			much its content overflowed and leaving dead space at the bottom —
			with no way to scroll back, because the overflow is hidden. That is
			the "layout collapse" reported when toggling Pinned; it was never
			specific to Pinned, or to lorebooks.

			`clip` establishes no scroll container at all, so there is nothing
			for focus to scroll. Fixing the underlying overflow would be the
			other half, but this makes the shell structurally unable to move
			regardless of what a panel's content does.
		-->
		<div
			class="relative z-10 flex h-svh max-w-full min-w-full flex-1 flex-col overflow-clip lg:flex-row lg:gap-2"
		>
			<!-- Left Sidebar -->
			<aside class="desktop-sidebar" aria-label="Left navigation panel">
				{#if panelsCtx.leftPanel}
					{@const title =
						panelsCtx.leftNav[panelsCtx.leftPanel]?.title ||
						panelsCtx.leftPanel}
					<div
						bind:this={leftSidebarRef}
						class="bg-surface-50-950 flex h-full w-full flex-col overflow-x-hidden overflow-y-auto {panelsCtx.fullscreenPanel ===
						'left'
							? 'fixed inset-0 z-[500] rounded-none'
							: 'me-2 rounded-r-lg'}"
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
						<PanelHeader
							{title}
							titleId="left-panel-title"
							closeLabel="Close {title} panel"
							isFullscreen={panelsCtx.fullscreenPanel === "left"}
							onClose={() => closePanel({ panel: "left" })}
							onToggleFullscreen={() =>
								(panelsCtx.fullscreenPanel =
									panelsCtx.fullscreenPanel === "left"
										? null
										: "left")}
						/>
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
						class="bg-surface-50-950 flex h-full w-full flex-col overflow-x-hidden overflow-y-auto {panelsCtx.fullscreenPanel ===
						'right'
							? 'fixed inset-0 z-[500] rounded-none'
							: 'rounded-l-lg'}"
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
						<PanelHeader
							{title}
							titleId="right-panel-title"
							closeLabel="Close {title} panel"
							isFullscreen={panelsCtx.fullscreenPanel === "right"}
							onClose={() => closePanel({ panel: "right" })}
							onToggleFullscreen={() =>
								(panelsCtx.fullscreenPanel =
									panelsCtx.fullscreenPanel === "right"
										? null
										: "right")}
						/>
						<nav class="flex-1 overflow-y-auto">
							{#if panelsCtx.rightPanel === "activity"}
								<ActivitySidebar
									bind:onclose={panelsCtx.onRightPanelClose}
								/>
							{:else if panelsCtx.rightPanel === "personas"}
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
			<!--
				z-45, deliberately BELOW the z-50 that Skeleton's modals portal
				to. This was z-51 — one above the modal layer — so any modal
				opened from inside a mobile panel (the "Create New AI
				Connection" dialog, for instance) mounted correctly on <body>
				and then rendered completely behind the panel it was launched
				from. It has to stay above the mobile menu and its backdrop
				(z-40), hence 45 rather than something lower.
			-->
			<div
				class="bg-surface-100-900 fixed inset-0 z-[45] flex flex-col overflow-y-auto lg:hidden"
				role="dialog"
				aria-labelledby="mobile-panel-title"
				aria-modal="true"
				transition:fly={{ x: 40, duration: 200 }}
			>
				<!-- No onToggleFullscreen: the mobile branch is already a
				     full-screen dialog, so there is nothing to expand into. -->
				<div class="border-border border-b">
					<PanelHeader
						{title}
						titleId="mobile-panel-title"
						closeLabel="Close {title} panel"
						onClose={() => closePanel({ panel: "mobile" })}
					/>
				</div>
				<div class="flex-1 overflow-y-auto">
					{#if panelsCtx.mobilePanel === "activity"}
						<ActivitySidebar
							bind:onclose={panelsCtx.onMobilePanelClose}
						/>
					{:else if panelsCtx.mobilePanel === "sampling"}
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
			<div
				class="fixed inset-0 z-[40] bg-black/40"
				onclick={() => (panelsCtx.isMobileMenuOpen = false)}
				role="presentation"
				transition:fade={{ duration: 150 }}
			></div>
			<div
				class="bg-surface-100-900/95 fixed inset-0 z-[40] flex flex-col overflow-y-auto px-2 lg:hidden"
				transition:fly={{ x: -40, duration: 200 }}
			>
				<div
					class="border-border flex items-center justify-between border-b p-4"
				>
					<span
						class="text-foreground funnel-display text-xl font-bold tracking-tight whitespace-nowrap"
					>
						Serene Pub
					</span>
					<!-- Matches the hamburger that opened it: square 44px target,
					     and it had no accessible name at all before. -->
					<button
						type="button"
						class="btn hover:preset-tonal-surface text-foreground flex size-11 items-center justify-center p-0 [&>svg]:size-6"
						aria-label="Close navigation menu"
						onclick={(e) => {
							e.stopPropagation()
							panelsCtx.isMobileMenuOpen = false
						}}
					>
						<Icons.X aria-hidden="true" />
					</button>
				</div>
				<!-- Density: rows carry their own padding instead of the list
				     putting a gap between them. `gap-4 text-2xl` spent 16px
				     between every pair and still left a 36px row with
				     `padding: 0`, so the hit area was only the text line — under
				     the 44px/48dp guideline while costing the most space.
				     Folding that spacing into the rows buys a real 44px target
				     AND takes the list from 697px to ~570px, which is what lets
				     all 13 items fit a 667px phone without scrolling. Text drops
				     25.6px -> 16px so it stops dwarfing the 20px icons.
				     `[&>svg]:size-5` rather than `h-5 w-5` on the icon itself:
				     `btn` sizes child svg from --btn-size, and that rule would
				     otherwise win and shrink them. -->
				<div class="flex flex-col overflow-y-auto p-2">
					{#each panelsCtx.getOrderedEntries( { ...panelsCtx.rightNav, ...panelsCtx.leftNav }, [...panelsCtx.rightNavOrder, ...panelsCtx.leftNavOrder] ) as [key, item]}
						<button
							class="btn hover:preset-filled-surface-200-800 text-foreground flex min-h-11 w-full items-center justify-start gap-3 rounded-lg px-3 text-base [&>svg]:size-5"
							title={item.title}
							onclick={() => handleMobilePanelClick(key)}
						>
							{#if item.imgSrc}
								<span
									class="block size-5 shrink-0"
									style="background-color: currentColor; mask: url({item.imgSrc}) no-repeat center / contain; -webkit-mask: url({item.imgSrc}) no-repeat center / contain;"
									aria-hidden="true"
								></span>
							{:else}
								<item.icon aria-hidden="true" />
							{/if}
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

<!-- Update notice. Rendered here rather than in +layout.svelte because that
     file is the parent of this one and so cannot read userCtx (context flows
     down), and because a notice only an admin can act on has no business
     appearing over the login screen. -->
<UpdateNoticeBar isAdmin={!!userCtx.user?.isAdmin} />

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
