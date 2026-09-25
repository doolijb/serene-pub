<script lang="ts">
	import Header from "./Header.svelte"
	import PanelHeader from "./panels/PanelHeader.svelte"
	import "../../../app.css"
	import * as Icons from "@lucide/svelte"
	import { fly, fade } from "svelte/transition"
	import { onMount, setContext, onDestroy, untrack, tick } from "svelte"
	import AdminSidebar from "./sidebars/AdminSidebar.svelte"
	import SamplingSidebar from "./sidebars/SamplingSidebar.svelte"
	import ConnectionsSidebar from "./sidebars/ConnectionsSidebar.svelte"
	import LegacySidebar from "./sidebars/LegacySidebar.svelte"
	import LorebooksSidebar from "./sidebars/LorebooksSidebar.svelte"
	import CharactersSidebar from "./sidebars/CharactersSidebar.svelte"
	import SessionsSidebar from "./sidebars/SessionsSidebar.svelte"
	import PipelinesSidebar from "./sidebars/PipelinesSidebar.svelte"
	import TagsSidebar from "./sidebars/TagsSidebar.svelte"
	import UsersSidebar from "./sidebars/UsersSidebar.svelte"
	import HelpSidebar from "./sidebars/HelpSidebar.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getSocket } from "$lib/client/sockets/socketInstance"
	import {
		INTEREST_CONTEXT,
		interestContextValue,
		setInterestUser,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import type { SocketEventMap } from "$lib/client/sockets/typedSocket"
	import {
		registerLanguageSocket,
		setLanguage
	} from "$lib/client/i18n/state.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { KeyboardNavigationManager } from "$lib/client/utils/keyboardNavigation"
	import SettingsSidebar from "$lib/client/components/sidebars/SettingsSidebar.svelte"
	import ActivitySidebar from "$lib/client/components/sidebars/ActivitySidebar.svelte"
	import ConnectionTimeoutModal from "$lib/client/components/ConnectionTimeoutModal.svelte"
	import PipelineReviewModal from "$lib/client/components/pipelines/PipelineReviewModal.svelte"
	import CapPauseDialog from "$lib/client/components/pipelines/CapPauseDialog.svelte"
	import RunInspectorModal from "$lib/client/components/pipelines/inspector/RunInspectorModal.svelte"
	import UpdateNoticeBar from "$lib/client/components/UpdateNoticeBar.svelte"
	import type { Snippet } from "svelte"
	import { Theme } from "$lib/client/consts/Theme"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import {
		createJumpCtx,
		isAdminPath,
		JUMP_CONTEXT
	} from "$lib/client/shell/jump.svelte"
	// While a session's DESKTOP layout editor is open its toolbar owns the top
	// band, so the session header and the Jump pill step out of it.
	import { layoutEditor } from "$lib/client/sessionLayout/layoutEditor.svelte"
	import JumpPill from "$lib/client/components/shell/JumpPill.svelte"
	import JumpOverlay from "$lib/client/components/shell/JumpOverlay.svelte"
	// The one `lg` answer. Anything that needs `window.innerWidth < 1024`
	// asks this instead of computing it locally, so the state and the
	// stylesheet cannot disagree about where mobile ends.
	import { desktop } from "$lib/client/utils/breakpoint.svelte"

	interface Props {
		children?: Snippet
	}

	let { children }: Props = $props()

	const socket = useTypedSocket()

	// Event names ending in ":error" that something elsewhere in the app
	// already declares interest in (some of which show their own toast, some
	// of which deliberately show nothing / handle the error inline). The
	// generic onAny catch-all below must skip these so we don't
	// double-toast (or override an intentional suppression) - see the
	// wildcard error handling note near `handleAnyEvent`.
	const HANDLED_ERROR_EVENTS = new Set<string>([
		// The folder dialog shows the server's refusal (a name this user
		// already has) INLINE under its name field, so a toast saying the same
		// thing would be the same correction twice, in two places.
		"characterFolders:create:error",
		"characterFolders:update:error",
		"characters:create:error",
		"characters:exportCard:error",
		"characters:list:error",
		"characters:update:error",
		// The lorebook Read-in line handles its own refusal (R55): the line
		// falls back to the decision, so a toast would be noise.
		"pipelines:runExplain:error",
		"characters:uploadGalleryImage:error",
		"sessions:list:error",
		"sessions:summarize:error",
		"connections:list:error",
		"connections:refreshModels:error",
		"connections:syncModels:error",
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
		// The pipeline panel shows every one of these itself, and the server
		// writes them for a person — "'Prose' is still in use, point that
		// setting somewhere else first". The catch-all was toasting them a
		// second time under a generated title ("Pipelines Delete Variable
		// Template failed"), so a refusal arrived twice: once explained, once
		// as jargon naming the socket event. Found by deleting a layout that
		// another pipeline was still using.
		"pipelines:setOption:error",
		"pipelines:clearOption:error",
		"pipelines:selectConfig:error",
		"pipelines:clonePrompt:error",
		"pipelines:updatePrompt:error",
		"pipelines:deletePrompt:error",
		"pipelines:createContextTemplate:error",
		"pipelines:cloneContextTemplate:error",
		"pipelines:updateContextTemplate:error",
		"pipelines:deleteContextTemplate:error",
		"pipelines:cloneVariableTemplate:error",
		"pipelines:updateVariableTemplate:error",
		"pipelines:deleteVariableTemplate:error",
		"promptConfigs:setUserActive:error",
		// The sampling sidebar puts both of these under the field that has to
		// change — the clone modal's name input, or the config's Name — because
		// a name is unique per modality now and "that one is taken" is answered
		// by typing a different one. A toast as well would say the same thing
		// twice, once next to the fix and once in a corner.
		"samplingConfigs:create:error",
		"samplingConfigs:update:error",
		"scenes:compile:error",
		"scenes:process:error",
		"systemSettings:updateAccountsEnabled:error",
		"tags:list:error",
		"users:current:changePassphrase:error",
		"users:current:logout:error",
		"users:current:updateDisplayName:error",
		"userSettings:uploadBackground:error",
		"vectorization:loadModel:error"
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
	// (see HANDLED_ERROR_EVENTS above), so an action that fails with neither a
	// toast nor a UI change still surfaces its error.
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
	/** The rail — the 64px strip of view buttons. Alt+[ lands on it. */
	let railRef = $state<HTMLElement | null>(null)
	/** The sidebar column, header included. Alt+] lands on it. */
	let sidebarRef = $state<HTMLElement | null>(null)
	let keyboardNavManager: KeyboardNavigationManager

	/**
	 * ── The shell's view state ────────────────────────────────────────────
	 *
	 * A rail item opens a *sidebar view*. Opening a second one does NOT close
	 * the first: every view that has been opened stays mounted and is hidden
	 * with the `hidden` attribute, so its scroll position, its filters and its
	 * half-typed forms are all still there when you come back to it. That is
	 * the whole point of the tab model, and it is why nothing here reaches for
	 * `{#if}` or `display: none` — both of those unmount or, in the second
	 * case, get beaten by a Tailwind display utility. Tailwind's preflight
	 * gives `[hidden]` a `display: none !important`, so the attribute wins over
	 * the `flex` the same element carries.
	 *
	 * `activeView` is the one on screen; `openViews` is every view that still
	 * has a tab. Collapsing (clicking the rail item that is already showing)
	 * clears `activeView` and KEEPS the tab — only the header's close button,
	 * or eviction at the cap, unmounts anything.
	 */
	const MAX_OPEN_VIEWS = 6
	/**
	 * Persisted per browser: which tabs were open and which one was showing.
	 * Only the tab list is persisted, not the state *inside* those views: a
	 * reload starts each one fresh, which is the honest promise to make
	 * without serialising every sidebar's private state.
	 */
	const SHELL_STATE_KEY = "serene-pub:shell"
	/** The rail's form, per browser. Narrow unless this key says otherwise. */
	const RAIL_WIDE_KEY = "serene-pub:railWide"

	let openViews = $state<string[]>([])
	let activeView = $state<string | null>(null)
	let fullPageView = $state<string | null>(null)
	/**
	 * Per-view close gates — the old `onLeftPanelClose`/`onRightPanelClose`
	 * pair generalised. A sidebar with unsaved work binds a function here and
	 * returning false from it refuses the close. Keyed by view, because with
	 * tabs every open view can be holding unsaved work at the same time.
	 */
	let viewCloseGates = $state<
		Record<string, (() => Promise<boolean> | undefined) | undefined>
	>({})
	/**
	 * Most recently active first, for eviction.
	 *
	 * Tracked in its own array rather than by reordering `openViews`: the
	 * `{#each}` that mounts the views is keyed on `openViews`, and reordering
	 * a keyed each MOVES the DOM nodes — which resets the scroll position
	 * this entire design exists to preserve. So `openViews` stays in the
	 * order tabs were opened and recency rides alongside. Not reactive:
	 * nothing renders from it.
	 */
	let viewRecency: string[] = []
	/** localStorage has been consulted. Until it has, do not write back to it. */
	let shellRestored = false

	/**
	 * The rail sits one step below `surface-950` so the sidebar beside it reads
	 * as lifted rather than continuous. A colour-mix rather than a darker
	 * token, because 950 is already the darkest step every theme defines — and
	 * it stays a theme colour, so this follows a theme change like everything
	 * else.
	 */
	/**
	 * The rail's ground. Defined in `app.css` as `--sp-rail-bg`, which pairs it
	 * across modes (ruled 2026-09-23 — the rail used to be dark under every
	 * theme, STYLE-GUIDE §1.1's one exception, and no longer is).
	 */
	const RAIL_BG = "var(--sp-rail-bg)"

	let userCtx: { user: SelectUser } = $state({} as { user: any })
	let panelsCtx: PanelsCtx = $state({
		/* ── the shell surface ─────────────────────────────────────────── */
		get activeView() {
			return activeView
		},
		get openViews() {
			return openViews
		},
		get fullPageView() {
			return fullPageView
		},
		set fullPageView(next: string | null) {
			if (next === null) {
				fullPageView = null
				return
			}
			void openView(next, { toggle: false, fullPage: true })
		},
		openView: (key, opts) => void openView(key, opts),
		closeView: (key) => closeView(key),
		registerViewCloseGate: (key, fn) => {
			viewCloseGates[key] = fn
		},

		/* ── ⏳ the two-sidebar surface, mapped onto the above ──────────── */
		// Accessors, not fields. Svelte's state proxy passes an accessor
		// property straight through to the getter/setter with the proxy as the
		// receiver, so `panelsCtx.leftPanel` stays reactive for the ~25 call
		// sites that read it and `panelsCtx.mobilePanel = null` still does what
		// it always did. Removing them instead would have meant touching every
		// one of those sites for no behaviour change.
		// ⚠ These two answer WHERE THE SIDEBAR PHYSICALLY IS, not which nav a
		// view was registered under. Their one reader is SessionLayout, which
		// spends them on margins — "is a sidebar covering my left/right
		// margin?" — and keying them on nav membership answered a question
		// nobody was asking: opening Characters (a `rightNav` key) made the
		// session reserve a RIGHT margin while the sidebar sat on the LEFT, so
		// the session lost the margin it still had and kept the one it did not.
		// There is one sidebar now and it is on the left, so `leftPanel` is the
		// active view whenever that sidebar is on screen and `rightPanel` is
		// null — a nav is a grouping in the rail, not a side of the window.
		get leftPanel() {
			// Full page is not a sidebar: it covers `<main>` entirely, so there
			// is no margin left to reserve. Below `lg` the sidebar is a
			// full-screen sheet and `mobilePanel` is the flag for that.
			return desktop.matches && fullPageView === null ? activeView : null
		},
		set leftPanel(next: string | null) {
			if (next === null) {
				if (activeView) collapseSidebar()
				return
			}
			void openView(next, { toggle: false })
		},
		get rightPanel() {
			return null
		},
		set rightPanel(next: string | null) {
			// Assigning null still means "close the sidebar I am in" — the
			// thing every historical caller meant by it — even though nothing
			// reads a right side any more.
			if (next === null) {
				if (activeView) collapseSidebar()
				return
			}
			void openView(next, { toggle: false })
		},
		get mobilePanel() {
			return !desktop.matches ? activeView : null
		},
		set mobilePanel(next: string | null) {
			if (next === null) {
				if (!desktop.matches) collapseSidebar()
				return
			}
			void openView(next, { toggle: false })
		},
		isMobileMenuOpen: false,
		// Persisted per browser: the rail's form is a lasting preference, not
		// a per-visit whim. Guarded for SSR; the write lives in an $effect
		// below (effects never run server-side). Desktop only — the bottom bar
		// is the rail below `lg`.
		railWide:
			typeof localStorage !== "undefined" &&
			localStorage.getItem(RAIL_WIDE_KEY) === "true",
		toggleRailWide: () => {
			panelsCtx.railWide = !panelsCtx.railWide
		},
		openPanel,
		closePanel,
		leftNav: {
			settings: { icon: Icons.Settings, title: "Settings" },
			// Everyone's, and conditional on nothing — so it is declared here
			// with Settings rather than in the effect below, which is where the
			// entries that come and go with a role or a setting live. The rail
			// draws it at the foot of Tune (see `railEntries`).
			help: { icon: Icons.BookOpen, title: "Help" }
		},
		rightNav: {
			activity: { icon: Icons.Bell, title: "Activity" },
			tags: { icon: Icons.Tag, title: "Tags" },
			characters: { icon: Icons.UsersRound, title: "Characters" },
			lorebooks: { icon: Icons.BookMarked, title: "Lorebooks+" },
			sessions: { icon: Icons.MessageSquare, title: "Sessions" }
		},
		digest: {},
		// The rail's order, so the mobile "More" sheet (which still goes
		// through getOrderedEntries) lists things in the same sequence the rail
		// does rather than in its own.
		leftNavOrder: [
			"connections",
			"sampling",
			"pipelines",
			"settings",
			"users",
			"legacy"
		],
		rightNavOrder: [
			"sessions",
			"characters",
			"lorebooks",
			"tags",
			"activity"
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
	// `capabilityDefaults` starts as `{}`, not undefined — the field is
	// deliberately non-optional (app.d.ts), because an optional one makes every
	// reader handle `undefined` and the handling that gets written is
	// `?? settings.defaultConnectionId`, which is the second spelling this
	// change exists to remove. `{}` says "nothing registered" without a branch.
	let systemSettingsCtx: SystemSettingsCtx = $state({
		settings: undefined,
		capabilityDefaults: {}
	})

	// Persist the rail's form (see railWide's init above).
	$effect(() => {
		try {
			localStorage.setItem(RAIL_WIDE_KEY, String(panelsCtx.railWide))
		} catch {}
	})
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
	let openSessionCtx: OpenSessionCtx = $state({
		sessionId: null,
		sessionName: null,
		cast: [],
		genreName: null,
		lorebookId: null,
		lorebookBranchId: null,
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
	let sessionSummarizesCtx: SessionSummarizesCtx = $state({
		activities: [],
		reviewActivityId: null,
		dismiss: (activityId: string) => {
			socket.emit("activity:dismiss", { id: activityId })
			sessionSummarizesCtx.activities =
				sessionSummarizesCtx.activities.filter(
					(a) => a.activityId !== activityId
				)
		},
		setReviewActivityId: (id: string | null) => {
			sessionSummarizesCtx.reviewActivityId = id
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
	/**
	 * 🚧 Whether `<main>`'s scroll column takes the interim reading width. See
	 * the comment on that element for why it exists and when it goes.
	 *
	 * Two exemptions, both because the route already owns its own width:
	 * `/sessions/*` (the surface grid spends the whole viewport) and `/admin*`
	 * (the admin shell's container queries measure the pane it is given).
	 */
	let constrainContentWidth = $derived.by(() => {
		const path = page.url.pathname
		return !path.startsWith("/sessions/") && !path.startsWith("/admin")
	})
	// The session currently on screen, when there is one. 05 §0a: configuring a
	// pipeline from the list writes at user scope, and configuring it from
	// inside a session you own writes at session scope — so the panel has to know
	// where it was opened from, and the route is the only place that fact lives.
	let sessionIdInView = $derived.by(() => {
		if (!page.url.pathname.startsWith("/sessions/")) return undefined
		const id = Number(page.params?.id)
		return Number.isFinite(id) ? id : undefined
	})

	// The rail's registry, kept in step with who is signed in and what this
	// instance has switched on.
	$effect(() => {
		if (!isSettingsLoaded) return

		// Add Users sidebar if accounts are enabled
		if (isAccountsEnabled && isAdmin) {
			panelsCtx.leftNav.users = { icon: Icons.Users, title: "Users" }
		} else {
			delete panelsCtx.leftNav.users
		}

		// Administration is a view like any other (S3) — a registry entry, so
		// `openPanel({ key: "admin" })`, the tab cap, the close button and the
		// restore-from-localStorage pass all treat it as what it is. The rail
		// still draws it at the FOOT rather than among the system views (see
		// `railEntries`), which is why it is excluded from that group's order
		// there instead of being left out of the registry here.
		if (isAdmin) {
			panelsCtx.leftNav.admin = {
				icon: Icons.ShieldCheck,
				title: "Admin"
			}
		} else {
			delete panelsCtx.leftNav.admin
		}

		// ⚠ No rail items for the managers. The Ollama Manager and the
		// KoboldCPP Manager were entries here until the 2026-09-17 concept
		// ruling (R2); each is now the connection VIEW of its connection, so
		// the one door is the Connections list and there is nothing to
		// register or delete as the flags move. The flags themselves stay —
		// the server reads them to decide whether it may spawn or reach a
		// process at all.

		if (isAdmin) {
			panelsCtx.leftNav.sampling = {
				icon: Icons.SlidersHorizontal,
				title: "Sampling"
			}
			panelsCtx.leftNav.connections = {
				icon: Icons.Cable,
				title: "Connections"
			}
			// One entry, not two. Context Configs and Prompt Configs are both
			// superseded — by `pipeline_context_templates` and
			// `pipeline_prompts` — and nothing in 0.6 builds a prompt from
			// either. Two live-looking entries in the navigation said the
			// opposite; one called Legacy says what they are, and holds both
			// as tabs.
			//
			// The one toggle that survives the changeover still hides it, for
			// when somebody is done referring back. It keeps its old column
			// name because the setting is the same setting: show me the old
			// configs.
			if (
				systemSettingsCtx.settings?.legacyPromptConfigsVisible !== false
			) {
				panelsCtx.leftNav.legacy = {
					icon: Icons.Archive,
					title: "Legacy configs"
				}
			} else {
				delete panelsCtx.leftNav.legacy
			}
			delete panelsCtx.leftNav.contexts
			delete panelsCtx.leftNav.prompts
		}

		// Outside the admin block, unlike every panel above it. 05 §0 is explicit
		// that the pipeline view is "what everyone gets out of the box" — it is
		// the surface where a normal user edits their own prompts, and the panels
		// above are admin screens it is meant to replace for them. Access is
		// enforced server-side per slot and per scope (12 §4), so the panel shows
		// each person exactly what they may write rather than being all-or-nothing
		// on a role.
		panelsCtx.leftNav.pipelines = {
			icon: Icons.Workflow,
			title: "Pipelines"
		}
	})

	/* ── views: the tab model behind the rail ──────────────────────────── */

	function navHas(side: "left" | "right", key: string | null): boolean {
		if (!key) return false
		const nav = side === "left" ? panelsCtx.leftNav : panelsCtx.rightNav
		return Object.prototype.hasOwnProperty.call(nav, key)
	}

	function isKnownView(key: string): boolean {
		return navHas("left", key) || navHas("right", key)
	}

	function titleOf(key: string): string {
		return (
			panelsCtx.rightNav[key]?.title ??
			panelsCtx.leftNav[key]?.title ??
			key
		)
	}

	function touchRecency(key: string) {
		viewRecency = [key, ...viewRecency.filter((k) => k !== key)]
	}

	/** Hide the sidebar without closing anything: the tabs, and their state, stay. */
	function collapseSidebar() {
		activeView = null
		// Full page is a way of showing the ACTIVE view, so it cannot outlive
		// one. Leaving it set would hide `<main>` behind a sidebar that is not
		// on screen — a blank window with no way back.
		fullPageView = null
	}

	/* ── the session layout editor takes the window ────────────────────────
	 * Ruled 2026-09-17: opening the DESKTOP layout editor closes the sidebar,
	 * and closing the editor puts it back.
	 *
	 * The editor is not a panel inside `<main>` — its toolbar owns the header's
	 * band and its canvas is laid out across the whole viewport, nav rail
	 * included. A sidebar left on screen therefore sits ON TOP of the editor's
	 * Add tray and its whole Left zone, with the rail it would be closed from
	 * covered by the editor's own scrim.
	 *
	 * This file owns the sidebar's state, so the reaction lives here and the
	 * store is the only thing that crosses — exactly as the header and the Jump
	 * pill already react to `layoutEditor.open`. SessionLayout never reaches in.
	 *
	 * Collapsing keeps the tab and everything in it (see `collapseSidebar`), so
	 * putting it back is only making it active again — and only if the user has
	 * not put something else on screen while the editor was up: they asked for
	 * that, and this did not.
	 */
	let stowedForEditor: {
		view: string | null
		fullPage: string | null
	} | null = null
	$effect(() => {
		const open = layoutEditor.open
		// Everything below is read AND written here; only `open` may retrigger.
		untrack(() => {
			if (open) {
				if (stowedForEditor) return
				stowedForEditor = { view: activeView, fullPage: fullPageView }
				if (activeView !== null) collapseSidebar()
				return
			}
			const stowed = stowedForEditor
			if (!stowed) return
			stowedForEditor = null
			if (activeView !== null) return
			if (!stowed.view || !openViews.includes(stowed.view)) return
			activeView = stowed.view
			touchRecency(stowed.view)
			fullPageView = stowed.fullPage
		})
	})

	/**
	 * Open a view in the sidebar and make it active.
	 *
	 * `toggle` (default true) is what makes the rail item a toggle: clicking
	 * the one already showing collapses the sidebar. A deep link passes false,
	 * because "take me to this character" must land on the view rather than
	 * toggle it shut when it happens to be the one already open.
	 */
	async function openView(
		key: string,
		opts: { toggle?: boolean; fullPage?: boolean } = {}
	): Promise<void> {
		if (!isSettingsLoaded || !isKnownView(key)) return

		if (activeView === key) {
			if (opts.fullPage) fullPageView = key
			else if (opts.toggle ?? true) collapseSidebar()
			return
		}

		if (!openViews.includes(key)) {
			await evictForRoom()
			// Re-check: `evictForRoom` awaits a close gate, so another open may
			// have landed while we were asking.
			if (!openViews.includes(key)) openViews = [...openViews, key]
		}
		activeView = key
		touchRecency(key)
		// Full page shows whichever view is active, so switching views while it
		// is on moves it along rather than stranding the flag on a view other
		// than the one being looked at.
		if (opts.fullPage || fullPageView !== null) fullPageView = key
	}

	/**
	 * Six tabs. Opening a seventh retires the least recently active one that
	 * will actually go — a view whose close gate refuses (unsaved work) keeps
	 * its tab and we try the next one back. If every candidate refuses, the new
	 * view opens anyway: the cap is a tidiness rule, not a reason to refuse
	 * something somebody just asked for.
	 */
	async function evictForRoom(): Promise<void> {
		while (openViews.length >= MAX_OPEN_VIEWS) {
			const leastRecentFirst = openViews
				.filter((key) => key !== activeView)
				.map((key) => {
					const rank = viewRecency.indexOf(key)
					return {
						key,
						rank: rank === -1 ? Number.MAX_SAFE_INTEGER : rank
					}
				})
				.sort((a, b) => b.rank - a.rank)

			let freed = false
			for (const candidate of leastRecentFirst) {
				if (await closeView(candidate.key)) {
					freed = true
					break
				}
			}
			if (!freed) return
		}
	}

	/**
	 * Close a tab: ask the view's gate first — that is how a sidebar with
	 * unsaved changes refuses — and only then unmount it.
	 */
	async function closeView(key: string): Promise<boolean> {
		const gate = viewCloseGates[key]
		const allowed = gate ? ((await gate()) ?? true) : true
		if (!allowed) return false

		openViews = openViews.filter((k) => k !== key)
		viewRecency = viewRecency.filter((k) => k !== key)
		delete viewCloseGates[key]
		if (activeView === key) activeView = null
		if (fullPageView === key) fullPageView = null
		return true
	}

	/** ⏳ `openView` under the name ~25 call sites already use. */
	function openPanel({
		key,
		toggle = true
	}: {
		key: string
		toggle?: boolean
	}): void {
		void openView(key, { toggle })
	}

	/**
	 * ⏳ Close the active view if it belongs to the side named, resolving true
	 * when there was nothing of that side to close. The callers are all of the
	 * shape "close the sidebar I am in, then navigate", so a side that is not
	 * showing is a success, not a refusal.
	 */
	async function closePanel({
		panel
	}: {
		panel: "left" | "right" | "mobile"
	}): Promise<boolean> {
		if (!isSettingsLoaded) return false
		const key = activeView
		if (!key) return true
		if (panel === "mobile" && desktop.matches) return true
		if (panel === "left" && !navHas("left", key)) return true
		if (panel === "right" && !navHas("right", key)) return true
		return closeView(key)
	}

	/**
	 * ⤵ Entering the administration area opens the Admin view.
	 *
	 * An EDGE, not a level: the flag flips on the first `/admin*` pathname
	 * after a non-admin one (a direct load counts, since the flag starts
	 * false) and resets on the way out. Written as a level — "while inside
	 * admin, keep it open" — it would reopen on every section click and
	 * argue with anyone who closed it, which is the one thing a person
	 * inside a section list is most likely to do.
	 *
	 * Not `$state`, deliberately: nothing renders from it, and making it
	 * reactive would feed the effect its own write.
	 */
	let enteredAdminArea = false
	$effect(() => {
		const inAdmin = isAdminPath(page.url.pathname)
		// Read reactively, so a direct load that lands before the user (and
		// therefore before the registry entry) arrives opens the view as soon
		// as both do, rather than having missed its one edge.
		//
		// ⚠ Desktop only. Below `lg` the sidebar is not a companion column
		// beside the page — it is a full-screen sheet ON TOP of it, so this
		// edge turned a deep link to /admin/settings into a section list
		// covering the settings the link was for. On a phone the deep link
		// lands on the page and the rail is one tap away.
		const canOpen =
			shouldShowApp && !!panelsCtx.leftNav.admin && desktop.matches
		untrack(() => {
			if (!inAdmin) {
				enteredAdminArea = false
				return
			}
			if (enteredAdminArea || !canOpen) return
			enteredAdminArea = true
			// Not full page: the section list is a companion to the page it
			// opens, and covering that page with it would be the opposite of
			// the point. `toggle: false` because this is a deep link — it must
			// land on the view, never toggle it shut.
			if (!openViews.includes("admin")) {
				void openView("admin", { toggle: false })
			}
		})
	})

	/* ── the rail ──────────────────────────────────────────────────────── */

	/**
	 * A rail entry is one button in the strip. `kind` says what pressing it
	 * does; `group` decides where the dividers and the spacer fall, so the
	 * groups stay a property of the data rather than three hand-placed
	 * `{#each}` blocks that have to be kept in sync with the registry.
	 */
	interface RailEntry {
		kind: "home" | "view" | "user" | "more"
		key: string
		title: string
		icon?: any
		imgSrc?: string
		group: "home" | "content" | "system" | "foot"
		/**
		 * A REST colour, and only that. Admin is the one item tinted apart
		 * from its neighbours, and the tint has to stop the moment the item is
		 * the one on screen: the active treatment is the shared one (a tonal
		 * surface and the inset primary bar), so a second accent there would
		 * make Admin look like a different kind of selection than every other
		 * view. Hence a tone rather than a `kind` — pressing it does exactly
		 * what pressing any other view does.
		 */
		tone?: "tertiary"
	}

	/** Activity lives at the foot of the rail, not among the content views. */
	const CONTENT_ORDER = ["sessions", "characters", "lorebooks", "tags"]
	const SYSTEM_ORDER = ["connections", "sampling", "pipelines", "settings"]
	/** The four the mobile bottom bar shows by name; the rest live under More. */
	const BOTTOM_BAR_VIEWS = ["sessions", "characters", "lorebooks"]

	/**
	 * The registry stays the source of truth for which views exist — the order
	 * arrays only say where the ones we have opinions about go, and anything
	 * registered later (a manager switched on, Users when accounts are enabled)
	 * appends rather than disappearing.
	 */
	function navOrdered(
		nav: PanelsCtx["leftNav"] | PanelsCtx["rightNav"],
		order: string[],
		exclude: string[] = []
	) {
		const keys = [
			...order.filter((key) => key in nav && !exclude.includes(key)),
			...Object.keys(nav).filter(
				(key) => !order.includes(key) && !exclude.includes(key)
			)
		]
		return keys.map((key) => ({ key, ...nav[key] }))
	}

	/**
	 * The rail's wide form. `panelsCtx.railWide` holds the flag; this is the
	 * spelling the rail's markup reads.
	 */
	let railWide = $derived(panelsCtx.railWide)

	/**
	 * What the wide rail calls its groups. The narrow rail rules a line between
	 * them instead, so `home` and `foot` name nothing in either form.
	 */
	const GROUP_NAMES: Partial<Record<RailEntry["group"], string>> = {
		content: "Play",
		system: "Tune"
	}

	/**
	 * A rail item's colour while it is neither active nor hovered. The wide
	 * rail's rows sit one step lighter than the narrow rail's icons: a 14px
	 * label needs contrast a 20px glyph carries on its own.
	 *
	 * ⚠ Paired, like everything else. The rail's ground was dark under every
	 * mode until 2026-09-23 and these stops were deliberately unpaired against
	 * it; the rail follows the mode now (`--sp-rail-bg`), so anything that sits
	 * on it has to as well or light mode paints pale text on a pale bar.
	 */
	function railRestClass(entry: RailEntry): string {
		if (entry.tone === "tertiary")
			return "text-tertiary-700 dark:text-tertiary-400 hover:bg-surface-200-800 hover:text-surface-950-50"
		return railWide
			? "text-surface-800-200 hover:bg-surface-200-800 hover:text-surface-950-50"
			: "text-surface-600-400 hover:bg-surface-200-800 hover:text-surface-950-50"
	}

	let userLabel = $derived(
		userCtx.user?.displayName || userCtx.user?.username || "Account"
	)
	let userInitial = $derived(userLabel.trim().charAt(0).toUpperCase() || "?")

	let railEntries = $derived.by<RailEntry[]>(() => {
		const entries: RailEntry[] = [
			{
				kind: "home",
				key: "home",
				title: "Home",
				icon: Icons.House,
				group: "home"
			}
		]
		for (const item of navOrdered(panelsCtx.rightNav, CONTENT_ORDER, [
			"activity"
		])) {
			entries.push({ ...item, kind: "view", group: "content" })
		}
		// Admin is registered in `leftNav` but drawn at the foot beside
		// Activity, so it is excluded here rather than falling into the
		// system group's "anything registered later appends" tail.
		for (const item of navOrdered(panelsCtx.leftNav, SYSTEM_ORDER, [
			"admin",
			"help"
		])) {
			entries.push({ ...item, kind: "view", group: "system" })
		}
		// Help is the foot of Tune — so it is excluded from the loop above and
		// pushed here rather than left to that loop's "anything registered
		// later appends" tail, which would land it above Legacy.
		const help = panelsCtx.leftNav.help
		if (help) {
			entries.push({
				...help,
				key: "help",
				kind: "view",
				group: "system"
			})
		}
		const activity = panelsCtx.rightNav.activity
		if (activity) {
			entries.push({
				...activity,
				key: "activity",
				kind: "view",
				group: "foot"
			})
		}
		const admin = panelsCtx.leftNav.admin
		if (admin) {
			entries.push({
				...admin,
				key: "admin",
				kind: "view",
				group: "foot",
				tone: "tertiary"
			})
		}
		entries.push({
			kind: "user",
			key: "user",
			title: userLabel,
			group: "foot"
		})
		return entries
	})

	/** Home, three views, More. Icons come from the registry so they cannot drift. */
	let bottomBarEntries = $derived.by<RailEntry[]>(() => [
		{
			kind: "home",
			key: "home",
			title: "Home",
			icon: Icons.House,
			group: "home"
		},
		...BOTTOM_BAR_VIEWS.filter((key) => key in panelsCtx.rightNav).map(
			(key) =>
				({
					...panelsCtx.rightNav[key],
					key,
					kind: "view",
					group: "content"
				}) as RailEntry
		),
		{
			kind: "more",
			key: "more",
			title: "More",
			icon: Icons.Menu,
			group: "foot"
		}
	])

	/** Everything the bottom bar has no room for, in rail order. */
	let moreMenuEntries = $derived(
		railEntries.filter(
			(entry) =>
				entry.kind !== "user" &&
				entry.key !== "home" &&
				!BOTTOM_BAR_VIEWS.includes(entry.key)
		)
	)

	function isRailActive(entry: RailEntry): boolean {
		if (entry.kind === "home") return page.url.pathname === "/"
		if (entry.kind === "user") return false
		return activeView === entry.key
	}

	function handleRailActivate(entry: RailEntry) {
		switch (entry.kind) {
			case "home":
				goto("/")
				break
			case "user":
				// There is no user menu yet (phase S1 does not build one), so
				// the avatar goes where everything about you lives.
				void openView("settings", { toggle: false })
				break
			default:
				void openView(entry.key)
		}
	}

	/* ── roving focus down the rail ────────────────────────────────────── */

	let railFocusIndex = $state(0)

	function railButtons(): HTMLButtonElement[] {
		return railRef
			? Array.from(
					railRef.querySelectorAll<HTMLButtonElement>(
						"[data-rail-item]"
					)
				)
			: []
	}

	function focusRailItem(index: number) {
		const buttons = railButtons()
		if (!buttons.length) return
		const next = Math.max(0, Math.min(index, buttons.length - 1))
		railFocusIndex = next
		buttons[next]?.focus()
	}

	/**
	 * Flip the rail's form, and keep the toggle focused across the flip. The
	 * button is a rail item of its own in the narrow rail and the account row's
	 * right end in the wide one, so flipping builds a new element where the old
	 * one stood: focus follows it here rather than falling to the body.
	 */
	async function handleRailWideToggle() {
		panelsCtx.toggleRailWide()
		await tick()
		// The one rail item carrying `aria-expanded` is this toggle.
		railRef
			?.querySelector<HTMLButtonElement>(
				"[data-rail-item][aria-expanded]"
			)
			?.focus()
	}

	function handleRailKeydown(event: KeyboardEvent) {
		const buttons = railButtons()
		if (!buttons.length) return
		const current = buttons.indexOf(
			document.activeElement as HTMLButtonElement
		)
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				focusRailItem((current + 1) % buttons.length)
				break
			case "ArrowUp":
				event.preventDefault()
				focusRailItem((current - 1 + buttons.length) % buttons.length)
				break
			case "Home":
				event.preventDefault()
				focusRailItem(0)
				break
			case "End":
				event.preventDefault()
				focusRailItem(buttons.length - 1)
				break
		}
	}

	// The roving cursor has to stay inside the list: an admin flag arriving, or
	// a manager being switched off, changes how many buttons there are.
	// `untrack` around the write so this depends on the COUNT only — reading
	// the cursor it also assigns would make the effect its own trigger.
	$effect(() => {
		// One more than the registry has entries: the navigation-titles toggle
		// is a rail item of its own, sharing the account row's end of the order.
		const count = railEntries.length + 1
		untrack(() => {
			if (railFocusIndex >= count) railFocusIndex = 0
		})
	})

	/* ── mobile ────────────────────────────────────────────────────────── */

	// Full page is a desktop shape — below `lg` the view already fills the
	// screen. Crossing the breakpoint with it set would leave `<main>` hidden
	// behind a sheet, and closing the sheet would show a blank window.
	$effect(() => {
		if (!desktop.matches && fullPageView !== null) fullPageView = null
	})

	// Body scroll lock for the More sheet (moved here from Header.svelte along
	// with the sheet itself).
	$effect(() => {
		if (panelsCtx.isMobileMenuOpen) {
			document.body.style.overflow = "hidden"
		} else {
			document.body.style.overflow = ""
		}
	})

	// Escape closes the More sheet, from wherever focus happens to be — a sheet
	// covering the screen should not need you to have tabbed into it first.
	// (Window-level, as it was in Header.svelte, which owned this sheet before
	// the bottom bar did.)
	function handleMoreMenuKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" && panelsCtx.isMobileMenuOpen) {
			panelsCtx.isMobileMenuOpen = false
		}
	}

	// Escape INSIDE the mobile view sheet collapses it — bound to the sheet
	// rather than the window on purpose. On desktop the shell ignores Escape
	// entirely: dialogs own that key, and a shell-level handler would close the
	// sidebar out from under whichever one is open. Modals portal to <body>, so
	// their Escape never reaches this.
	function handleSheetKeydown(event: KeyboardEvent) {
		if (event.key !== "Escape") return
		if (desktop.matches || !activeView) return
		collapseSidebar()
	}

	function handleMoreMenuClick(entry: RailEntry) {
		panelsCtx.isMobileMenuOpen = false
		void openView(entry.key, { toggle: false })
	}

	function handleBottomBarClick(entry: RailEntry) {
		if (entry.key === "more") {
			panelsCtx.isMobileMenuOpen = !panelsCtx.isMobileMenuOpen
			return
		}
		handleRailActivate(entry)
	}

	/* ── what the activity badge counts ────────────────────────────────── */
	// Lifted verbatim from Header.svelte, whose icon groups the rail replaces.
	let reviewCount = $derived(
		(graphBuildsCtx?.activeBuild?.status === "review" ||
		graphBuildsCtx?.activeBuild?.status === "error"
			? 1
			: 0) +
			(sceneSummarizesCtx?.activities?.filter(
				(a) => a.status === "review"
			).length ?? 0) +
			(compileEntriesCtx?.activities?.filter((a) => a.status === "review")
				.length ?? 0)
	)
	let activityBadgeCount = $derived(
		reviewCount + (taskQueueCtx?.tasks?.length ?? 0)
	)

	/* ── persistence ───────────────────────────────────────────────────── */

	// Restore once the shell is actually up rather than on mount: the nav
	// registry above is filled in by an effect, and a key that isn't
	// registered (accounts turned off, a manager disabled, admin revoked)
	// must not come back as a tab that opens nothing.
	$effect(() => {
		if (!shouldShowApp || shellRestored) return
		shellRestored = true
		try {
			const raw = localStorage.getItem(SHELL_STATE_KEY)
			if (!raw) return
			const saved = JSON.parse(raw) as {
				openViews?: unknown
				activeView?: unknown
			}
			const keys = Array.isArray(saved.openViews)
				? saved.openViews
						.filter(
							(key): key is string =>
								typeof key === "string" &&
								isKnownView(key) &&
								// ⚠ Never RESTORED, only ever opened by hand.
								// The legacy view subscribes to 34 socket
								// families the moment it mounts, and it is
								// deprecated — so one visit to it would
								// otherwise cost every later session that
								// traffic forever, for a screen nobody asked
								// to see again. Opening it still works; it
								// just does not come back on its own.
								key !== "legacy"
						)
						.slice(0, MAX_OPEN_VIEWS)
				: []
			openViews = keys
			// Oldest last: nothing has been "active" yet this session, so the
			// order they were opened in is the only recency we have.
			viewRecency = [...keys].reverse()
			activeView =
				typeof saved.activeView === "string" &&
				keys.includes(saved.activeView)
					? saved.activeView
					: null
		} catch {}
	})

	$effect(() => {
		const snapshot = JSON.stringify({ openViews, activeView })
		if (!shellRestored) return
		try {
			localStorage.setItem(SHELL_STATE_KEY, snapshot)
		} catch {}
	})

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
		const theme = userSettingsCtx.settings?.theme || Theme.LAMPLIGHT
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

	// The four handlers below are declared through the interest registry, which
	// counts subscribers per key and releases only this shell's — so the theme
	// manager and the theme editor can want the same events at the same time.
	// The hazard that replaces is a bare `socket.off("customThemes:list")`,
	// which removes EVERY listener for that event across the whole app.
	function handleCustomThemesList(msg: Sockets.CustomThemes.List.Response) {
		const allMeta = [...msg.myThemes, ...msg.instanceThemes]
		const customNames = new Set(allMeta.map((t) => t.name))
		const builtinNames = new Set(Theme.options.map(([v]) => v))

		// Pre-populate cssKey map so data-theme updates before getCss response arrives
		allMeta.forEach((t) => {
			if (t.cssKey) customThemeCssKeys[t.name] = t.cssKey
		})

		// Fall back to lamplight where the active theme names a custom theme
		// that has since been deleted
		const currentTheme = userSettingsCtx.settings?.theme
		if (
			currentTheme &&
			!builtinNames.has(currentTheme) &&
			!customNames.has(currentTheme)
		) {
			socket.emit("userSettings:updateTheme", {
				theme: Theme.LAMPLIGHT
			})
		}

		// Fetch CSS for current themes
		allMeta.forEach((t) =>
			socket.emit("customThemes:getCss", { name: t.name })
		)
	}

	function handleCustomThemesGetCss(
		msg: Sockets.CustomThemes.GetCss.Response
	) {
		customThemeCssKeys[msg.name] = msg.cssKey
		// Filename (element ID) = cssKey — fresh element per cssKey, never stale
		injectCustomThemeCss(
			msg.name,
			msg.cssKey,
			`[data-theme='${msg.cssKey}'] {\n${msg.css}\n}`
		)
	}

	function handleCustomThemesDelete() {
		socket.emit("customThemes:list", {})
	}

	function handleCustomThemesSave(msg: Sockets.CustomThemes.Save.Response) {
		// Update cssKey immediately so data-theme snaps to new selector before CSS arrives
		customThemeCssKeys[msg.theme.name] = msg.theme.cssKey
		socket.emit("customThemes:getCss", { name: msg.theme.name })
	}

	/**
	 * The theme pushes, as standing interest at init scope.
	 *
	 * Standing because all four are cascade targets: saving or deleting a theme
	 * in the editor answers through the list, and `getCss` arrives once per
	 * theme after each list. Bare keys — these are instance-wide singletons
	 * with nothing to scope on.
	 */
	useInterest<"customThemes:list">(
		"customThemes:list",
		handleCustomThemesList
	)
	useInterest<"customThemes:getCss">(
		"customThemes:getCss",
		handleCustomThemesGetCss
	)
	useInterest<"customThemes:delete">(
		"customThemes:delete",
		handleCustomThemesDelete
	)
	useInterest<"customThemes:save">(
		"customThemes:save",
		handleCustomThemesSave
	)

	onMount(() => {
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

	// Init scope, and outside the onMount block below on purpose. A context
	// set from inside an effect only reaches children that initialise after it
	// — which every child here happens to do, being behind `{#if
	// shouldShowApp}` — and the interest registry should not depend on that
	// accident. The value is module functions, so there is nothing to wait for.
	setContext(INTEREST_CONTEXT, interestContextValue())

	/**
	 * **Jump** — the shell owns the overlay; the views own their search boxes.
	 *
	 * Set at init scope, not from the `onMount` below, for the same reason the
	 * interest registry is: every sidebar view calls `registerScope` during its
	 * own initialisation, and a context set from inside a lifecycle callback
	 * only reaches children that happen to initialise afterwards.
	 *
	 * The two things it cannot work out for itself come in as getters, so the
	 * scope follows the shell without the controller importing any of it.
	 */
	const jumpCtx = createJumpCtx({
		getActiveView: () => activeView,
		getPathname: () => page.url.pathname
	})
	setContext(JUMP_CONTEXT, jumpCtx)

	/**
	 * Ctrl/Cmd K, app-wide.
	 *
	 * NOT in `routes/+layout.svelte`'s `handleGlobalKeydown`, which is where
	 * the app's other global chord lives: that file is this one's PARENT, and
	 * context flows down — it cannot read `jumpCtx` any more than it can read
	 * `userCtx` (which is why UpdateNoticeBar is mounted here too).
	 */
	function handleJumpHotkey(event: KeyboardEvent) {
		if (!(event.ctrlKey || event.metaKey) || event.altKey) return
		if (event.key !== "k" && event.key !== "K") return
		if (!shouldShowApp) return
		// Another modal has the screen.
		//
		// ⚠ Two things the selector alone gets wrong. A CLOSED Skeleton dialog
		// still leaves its content element in the DOM carrying both attributes
		// and only `hidden` to say so — two of them are mounted globally by
		// this file, so an unfiltered query is never empty and the shortcut
		// never fired at all. And the mobile sidebar sheet carries the same two
		// attributes while being the shell rather than a modal, so it is
		// excluded by identity.
		const blocking = Array.from(
			document.querySelectorAll('[role="dialog"][aria-modal="true"]')
		).filter((el) => el !== sidebarRef && el.getClientRects().length > 0)
		if (blocking.length) return
		event.preventDefault()
		jumpCtx.open()
	}

	onMount(async () => {
		setContext("panelsCtx", panelsCtx as PanelsCtx)
		setContext("userCtx", userCtx)
		setContext("systemSettingsCtx", systemSettingsCtx)
		setContext("ollamaSettingsCtx", ollamaSettingsCtx)
		setContext("koboldCppSettingsCtx", koboldCppSettingsCtx)
		setContext("userSettingsCtx", userSettingsCtx)
		setContext("vectorizationCtx", vectorizationCtx)
		setContext("taskQueueCtx", taskQueueCtx)
		setContext("openSessionCtx", openSessionCtx)
		setContext("graphBuildsCtx", graphBuildsCtx)
		setContext("sceneSummarizesCtx", sceneSummarizesCtx)
		setContext("sessionSummarizesCtx", sessionSummarizesCtx)
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

	// The handlers below are declared through the interest registry, which owns
	// one raw socket listener per event and removes it with the same reference.
	// That is what makes it safe for this shell and Document View's
	// AccessibleShell to want `users:current` at the same time: the registry
	// counts subscribers per key, so neither shell's teardown can silence the
	// other's. The hazard it replaces is a bare `socket.off("users:current")`,
	// which removes EVERY listener for that event across the whole app.
	function handleSystemSettingsGet(
		message: SocketEventMap["systemSettings:get"]["response"]
	) {
		systemSettingsCtx.settings = {
			...message.systemSettings,
			isAndroidWrapper: message.isAndroidWrapper,
			localEmbeddingsSupported: message.localEmbeddingsSupported,
			// Not a column: derived from the `text->embedding` star, and folded
			// in here beside the other two derivations so every screen that used
			// to read `settings.embeddingModelName` keeps reading one object.
			activeEmbeddingModel: message.activeEmbeddingModel
		}
		systemSettingsCtx.capabilityDefaults = message.capabilityDefaults
		ollamaSettingsCtx.settings = { ...message.ollamaSettings }
		koboldCppSettingsCtx.settings = { ...message.koboldCppSettings }
	}

	function handleUsersCurrent(
		message: SocketEventMap["users:current"]["response"]
	) {
		userCtx.user = message.user
		// The registry gates restricted interest on this flag (plan ruling
		// 6a). The only assignment site in this shell: a logout revokes the
		// session server-side and the socket's `io server disconnect` reloads
		// the page, so there is no in-place clear path to mirror here.
		setInterestUser(message.user ?? null)

		// userSettings:get is requested by the `hasUser` $effect above;
		// only the admin-only taskQueue fetch needs to happen here.
		if (message.user?.isAdmin) {
			socket.emit("taskQueue:get", {})
		}
	}

	function handleUserSettingsGet(
		message: SocketEventMap["userSettings:get"]["response"]
	) {
		userSettingsCtx.settings = message.userSettings
		// The *resolved* language, not the stored choice — the stored one
		// may be null meaning "follow the instance default", and the
		// renderer needs a language rather than an intent (R5).
		setLanguage(message.userSettings.effectiveLanguage)
	}

	function handleError(message: SocketEventMap["error"]["response"]) {
		toaster.error({
			title: message.error,
			description: message.description
		})
	}

	function handleSuccess(message: SocketEventMap["success"]["response"]) {
		toaster.success({
			title: message.title,
			description: message.description
		})
	}

	function handleVectorizationProgress(
		message: SocketEventMap["vectorization:progress"]["response"]
	) {
		vectorizationCtx.status = message.status
		vectorizationCtx.currentItem = message.currentItem
		vectorizationCtx.queued = message.queued
		vectorizationCtx.completed = message.completed
		vectorizationCtx.priorityQueue = message.priorityQueue ?? []
		vectorizationCtx.history = message.history ?? []
	}

	function handleTaskQueueUpdate(
		message: SocketEventMap["taskQueue:update"]["response"]
	) {
		taskQueueCtx.tasks = message.tasks ?? []
	}

	function handleActivityUpdate(
		data: SocketEventMap["activity:update"]["response"]
	) {
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
				relationshipDiagnostics: latestGraph.relationshipDiagnostics,
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

		// Session-side world/character lore summarize activities
		const sessionSummarizeActivities = activities.filter(
			(a: any) => a.kind === "session_summarize"
		)
		sessionSummarizesCtx.activities = sessionSummarizeActivities.map(
			(a: any) => ({
				activityId: a.id,
				userId: a.userId,
				sessionId: a.sessionId,
				sessionLabel: a.sessionLabel,
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
	}

	function handleNarrativeGraphBuildLog(
		entry: SocketEventMap["narrativeGraph:buildLog"]["response"]
	) {
		if (!graphBuildsCtx.activeBuild) return
		graphBuildsCtx.activeBuild.trace = [
			...(graphBuildsCtx.activeBuild.trace ?? []),
			entry
		]
	}

	/**
	 * The seven standing keys this shell holds for as long as it exists.
	 *
	 * All bare: singletons (`systemSettings:get`, `users:current`,
	 * `userSettings:get`) and the four global pushes that feed the contexts
	 * every screen reads — there is no id here to scope on, and this shell
	 * wants every scope regardless.
	 *
	 * Declared at init scope rather than from `initializeSocketConnection()`,
	 * which runs inside the auth-gated `onMount` below: interest is a rune-
	 * scoped declaration and belongs with the component, not with the branch of
	 * an async function. The request emits stay where they were — asking for
	 * data is exactly the thing that should wait for the auth check.
	 */
	useInterest<"systemSettings:get">(
		"systemSettings:get",
		handleSystemSettingsGet
	)
	useInterest<"users:current">("users:current", handleUsersCurrent)
	useInterest<"userSettings:get">("userSettings:get", handleUserSettingsGet)
	useInterest<"vectorization:progress">(
		"vectorization:progress",
		handleVectorizationProgress
	)
	useInterest<"taskQueue:update">("taskQueue:update", handleTaskQueueUpdate)
	useInterest<"activity:update">("activity:update", handleActivityUpdate)
	useInterest<"narrativeGraph:buildLog">(
		"narrativeGraph:buildLog",
		handleNarrativeGraphBuildLog
	)

	let unregisterLanguageSocket: (() => void) | undefined

	/**
	 * The raw socket the global toasts listen on, held so onDestroy takes the
	 * listeners off the same socket they went onto — `getSocket()` may have
	 * been replaced by then.
	 */
	let rawSocket: ReturnType<typeof getSocket> = null

	function initializeSocketConnection() {
		// registerLanguageSocket hands back the teardown for its own listener;
		// blanket-offing "language:catalog" here would also take out Document
		// View's AccessibleShell listener.
		unregisterLanguageSocket = registerLanguageSocket()

		// The three global toasts are the one listening this app does outside
		// the interest registry, so they read the raw socket directly. A
		// catch-all names no event and can therefore declare no interest key,
		// and `error`/`success` are ungated by design (plan ruling 2) — the
		// generic fallback has to reach a client that declared nothing.
		// Named handlers, `off`ed by reference in onDestroy: a bare
		// `off(event)` would remove every listener for that event app-wide.
		rawSocket = getSocket()

		// Capture all otherwise-unhandled "*:error" events (see handleAnyEvent
		// / HANDLED_ERROR_EVENTS above for why this uses onAny rather than a
		// literal "**:error" listener, which never fires).
		rawSocket?.onAny(handleAnyEvent)

		rawSocket?.on("error", handleError)

		rawSocket?.on("success", handleSuccess)

		socket.emit("activity:get", {})
		socket.emit("systemSettings:get", {})

		// No `if (!isSettingsLoaded) return` here any more. There was one, and
		// because the line above is what ASKS for the settings, it was always
		// false at this point — so the keyboard manager below was never
		// constructed and Alt+[ / Alt+] / Alt+/ had done nothing for as long as
		// the guard existed. Nothing in the manager needs system settings; it
		// reads `panelsCtx`, which is live.

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
			// Alt+[ — the rail. It lands on the roving item rather than always
			// the first, so the shortcut returns you where you were.
			onFocusRail: () => {
				focusRailItem(railFocusIndex)
				KeyboardNavigationManager.announceToScreenReader(
					"Navigation rail focused"
				)
			},
			// Alt+] — the sidebar. The manager has already announced the
			// collapsed case, so there is a view here by the time we run.
			onFocusSidebar: () => {
				if (!sidebarRef || !activeView) return
				KeyboardNavigationManager.focusFirstInteractive(sidebarRef)
				KeyboardNavigationManager.announceToScreenReader(
					`${titleOf(activeView)} view focused`
				)
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
		unregisterLanguageSocket?.()
		unregisterLanguageSocket = undefined
		rawSocket?.offAny(handleAnyEvent)
		rawSocket?.off("error", handleError)
		rawSocket?.off("success", handleSuccess)
		rawSocket = null
	})
</script>

<svelte:window
	onkeydown={(event) => {
		handleMoreMenuKeydown(event)
		handleJumpHotkey(event)
	}}
/>

{#if shouldShowApp}
	<!-- Show normal app when accounts are disabled OR when accounts are enabled and user is authenticated -->
	<div
		class="bg-surface-100-900 relative h-full max-h-[100dvh] w-full"
		role="application"
		aria-label="Serene Pub Session Application"
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
		<!-- Character scene portraits belong to the session surface grid, as a
		     panel (plan 21), rather than painting as fixed viewport overlays
		     here. The `sceneImages` store is the set path (the avatar gallery
		     writes it) and `ScenePortraitsPanel` is their display. -->
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
			class="relative z-10 flex h-svh max-w-full min-w-full flex-1 flex-col overflow-clip lg:flex-row"
		>
			<!-- ══ the rail ══════════════════════════════════════════════
			     One strip, full height, every view in the app on it. Desktop
			     only: below `lg` the bottom bar at the end of this file is what
			     you get instead. -->
			<nav
				bind:this={railRef}
				class="border-surface-900 hidden shrink-0 flex-col overflow-y-auto border-r py-3 transition-[width] duration-150 lg:flex {railWide
					? 'w-52 items-stretch gap-0.5 px-2.5'
					: 'w-16 items-center gap-1'}"
				style="background: {RAIL_BG};"
				aria-label="Primary navigation"
			>
				<!-- Not a link: Home is a rail item of its own two rows down,
				     and a second route to the same place inside a roving-
				     tabindex group is one more stop for no destination.

				     The wordmark says the name in the wide rail, so the logo
				     is decorative there and its alt text steps aside rather
				     than being read twice. -->
				<div
					class="flex shrink-0 items-center {railWide
						? 'mb-3.5 gap-2.5 px-1.5'
						: 'mb-2 justify-center'}"
				>
					<img
						src="/logo.png"
						alt={railWide ? "" : "Serene Pub"}
						class="block h-10 w-auto shrink-0"
					/>
					{#if railWide}
						<span
							class="text-foreground truncate [font-family:var(--typo-heading--font-family)] text-[17px] font-semibold"
						>
							Serene Pub
						</span>
					{/if}
				</div>

				{#each railEntries as entry, i (entry.key)}
					{#if i > 0 && entry.group !== railEntries[i - 1].group}
						{#if entry.group === "foot"}
							<div class="flex-1" aria-hidden="true"></div>
						{:else if railWide && GROUP_NAMES[entry.group]}
							<!-- The wide rail names its groups where the narrow one
							     rules a line between them. -->
							<div
								class="text-surface-500 shrink-0 px-3 pt-3.5 pb-1 text-[11px]"
							>
								{GROUP_NAMES[entry.group]}
							</div>
						{:else}
							<div
								class="bg-surface-300-700 my-2 h-px w-7 shrink-0"
								aria-hidden="true"
							></div>
						{/if}
					{/if}

					{@const isActive = isRailActive(entry)}
					{@const isOpenTab =
						entry.kind === "view" &&
						!isActive &&
						openViews.includes(entry.key)}

					{#if entry.kind === "user"}
						<!-- The account row, and with it the one rail item that
						     opens no view: the navigation-titles toggle rides the
						     row's right end in the wide rail and sits directly above
						     the avatar in the narrow one, so the two swap places in
						     the roving order. -->
						{@const userSlot = railWide ? i : i + 1}
						{@const toggleSlot = railWide ? i + 1 : i}
						<div
							class={railWide
								? "mt-1.5 flex w-full shrink-0 items-center gap-1"
								: "contents"}
						>
							{#if !railWide}
								{@render railWideToggle(toggleSlot)}
							{/if}
							<!-- Named "Account: <who>" rather than just the name:
							     the Admin shield sits directly above it, and an
							     account called "admin" read as a second one. -->
							<button
								type="button"
								data-rail-item
								tabindex={userSlot === railFocusIndex ? 0 : -1}
								title={railWide
									? undefined
									: `Account: ${entry.title}`}
								aria-label="Account: {entry.title}"
								class="focus-visible:outline-primary-500 flex shrink-0 items-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 {railWide
									? 'hover:bg-surface-200-800 h-11 min-w-0 flex-1 gap-3 rounded-[10px] px-2'
									: 'mt-1.5 size-8 justify-center rounded-full hover:brightness-125'}"
								onfocus={() => (railFocusIndex = userSlot)}
								onkeydown={handleRailKeydown}
								onclick={() => handleRailActivate(entry)}
							>
								<span
									class="bg-surface-300-700 text-surface-950-50 flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
								>
									{userInitial}
								</span>
								{#if railWide}
									<span
										class="text-surface-800-200 min-w-0 flex-1 truncate text-left text-sm"
									>
										{entry.title}
									</span>
								{/if}
							</button>
							{#if railWide}
								{@render railWideToggle(toggleSlot)}
							{/if}
						</div>
					{:else}
						<!-- `e.detail > 1` is the second click of a double
						     click. Without it a double click ran "collapse"
						     (the toggle on the item already showing) between
						     the two, so full page opened out of a flicker. -->
						<button
							type="button"
							data-rail-item
							tabindex={i === railFocusIndex ? 0 : -1}
							title={railWide
								? undefined
								: entry.key === "activity" &&
									  activityBadgeCount > 0
									? `${entry.title} (${activityBadgeCount})`
									: entry.title}
							aria-label={entry.key === "activity" &&
							activityBadgeCount > 0
								? `${entry.title}, ${activityBadgeCount} waiting`
								: entry.title}
							aria-current={isActive ? "true" : undefined}
							class="focus-visible:outline-primary-500 relative flex shrink-0 items-center rounded-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 {railWide
								? 'h-10 w-full gap-3 px-3'
								: 'size-11 justify-center'} {isActive
								? 'bg-surface-200-800 text-primary-500'
								: railRestClass(entry)}"
							style={isActive
								? "box-shadow: inset 3px 0 0 var(--color-primary-500);"
								: undefined}
							onfocus={() => (railFocusIndex = i)}
							onkeydown={handleRailKeydown}
							onclick={(e) => {
								if (e.detail > 1) return
								handleRailActivate(entry)
							}}
							ondblclick={() => {
								if (entry.kind !== "view") return
								void openView(entry.key, {
									toggle: false,
									fullPage: true
								})
							}}
						>
							{#if entry.imgSrc}
								<span
									class="block size-5 shrink-0"
									style="background-color: currentColor; mask: url({entry.imgSrc}) no-repeat center / contain; -webkit-mask: url({entry.imgSrc}) no-repeat center / contain;"
									aria-hidden="true"
								></span>
							{:else if entry.icon}
								<entry.icon
									class="size-5 shrink-0"
									aria-hidden="true"
								/>
							{/if}

							{#if railWide}
								<span
									class="min-w-0 flex-1 truncate text-left text-sm"
								>
									{entry.title}
								</span>
							{/if}

							{#if isOpenTab}
								<!-- This view has a tab but is not the one on
								     screen. -->
								<span
									class="bg-primary-500 size-1.5 rounded-full {railWide
										? 'shrink-0'
										: 'absolute right-[7px] bottom-[7px]'}"
									aria-hidden="true"
								></span>
							{/if}
							{#if entry.key === "activity" && activityBadgeCount > 0}
								<span
									class="bg-warning-500 absolute size-2 rounded-full {railWide
										? 'top-[7px] left-[27px]'
										: 'top-[9px] right-[9px]'}"
									style="box-shadow: 0 0 0 2px {RAIL_BG};"
									aria-hidden="true"
								></span>
							{/if}
						</button>
					{/if}
				{/each}
			</nav>

			<!-- The navigation-titles toggle: one button with two homes — a
			     32px button at the end of the account row in the wide rail, a
			     44px rail item above the avatar in the narrow one. `slot` is
			     its place in the rail's roving order, which is the account
			     row's other half in both forms. It keeps its `title` in both,
			     the icon being the whole control: there is no visible label
			     here for a tooltip to repeat. -->
			{#snippet railWideToggle(slot: number)}
				<button
					type="button"
					data-rail-item
					tabindex={slot === railFocusIndex ? 0 : -1}
					title={railWide
						? "Hide navigation titles"
						: "Show navigation titles"}
					aria-label={railWide
						? "Hide navigation titles"
						: "Show navigation titles"}
					aria-expanded={railWide}
					class="text-surface-600-400 hover:bg-surface-200-800 hover:text-surface-950-50 focus-visible:outline-primary-500 flex shrink-0 items-center justify-center rounded-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 {railWide
						? 'size-8'
						: 'size-11'}"
					onfocus={() => (railFocusIndex = slot)}
					onkeydown={handleRailKeydown}
					onclick={handleRailWideToggle}
				>
					{#if railWide}
						<Icons.PanelLeftClose
							class="size-[18px]"
							aria-hidden="true"
						/>
					{:else}
						<Icons.PanelLeftOpen
							class="size-5"
							aria-hidden="true"
						/>
					{/if}
				</button>
			{/snippet}

			<!-- ══ the sidebar ═══════════════════════════════════════════
			     ONE column, and one mounted copy of each open view. It is the
			     400px sidebar at `lg`, the full content area when a view is in
			     full page, and a full-screen sheet below `lg` — the same
			     element and the same instances in all three, because rendering
			     a view twice would give it two of every socket listener and two
			     scroll positions.

			     `hidden` when nothing is active: on desktop that leaves the
			     column no width at all (the old shell kept a closed sidebar's
			     quarter), and every open view stays mounted underneath.

			     z-45 on mobile, deliberately BELOW the z-50 Skeleton's modals
			     portal to. This was z-51 once — one above the modal layer — so
			     any modal opened from inside a mobile panel (the "Create New AI
			     Connection" dialog, for instance) mounted correctly on <body>
			     and then rendered completely behind the panel it was launched
			     from. It has to stay above the More sheet and its backdrop
			     (z-40), hence 45 rather than something lower. -->
			<div
				bind:this={sidebarRef}
				class="bg-surface-50-950 border-surface-200-800 fixed inset-0 z-[45] flex flex-col overflow-hidden lg:static lg:border-r {fullPageView
					? 'lg:min-w-0 lg:flex-1'
					: 'lg:w-100 lg:flex-none'}"
				hidden={activeView === null}
				role={desktop.matches ? "region" : "dialog"}
				aria-modal={desktop.matches ? undefined : "true"}
				aria-label={activeView
					? `${titleOf(activeView)} view`
					: "Sidebar"}
				tabindex="-1"
				onkeydown={handleSheetKeydown}
			>
				<!-- Mobile chrome: the panel header this shell has always used
				     for a full-screen view. No expand button — the sheet is
				     already the whole screen. -->
				<div class="border-surface-900 shrink-0 border-b lg:hidden">
					<PanelHeader
						title={activeView ? titleOf(activeView) : ""}
						closeLabel="Close {activeView
							? titleOf(activeView)
							: ''}"
						onClose={() => {
							if (activeView) void closeView(activeView)
						}}
					/>
				</div>

				<!-- Desktop chrome.

				     In full page this row runs to the right edge of the window.
				     The Jump pill is not rendered while a view is full page
				     (ruled 2026-09-17: the pill sits under sidebars; Ctrl K is
				     the way in while one covers its corner), so the row keeps
				     its own padding and reserves nothing. -->
				<div
					class="border-surface-900 hidden h-14 shrink-0 items-center gap-1.5 border-b pr-2.5 pl-4 lg:flex"
				>
					<h2
						class="text-foreground min-w-0 flex-1 truncate [font-family:var(--typo-heading--font-family)] text-base font-semibold"
					>
						{activeView ? titleOf(activeView) : ""}
					</h2>
					<button
						type="button"
						class="text-surface-600-400 hover:bg-surface-200-800 hover:text-surface-950-50 focus-visible:outline-primary-500 flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 {fullPageView
							? 'px-2.5'
							: 'w-8'}"
						title={fullPageView
							? "Back to sidebar"
							: "Open full page"}
						aria-label={fullPageView
							? "Back to sidebar"
							: "Open full page"}
						onclick={() => {
							if (!activeView) return
							if (fullPageView) fullPageView = null
							else fullPageView = activeView
						}}
					>
						{#if fullPageView}
							<Icons.Minimize2
								class="size-[18px]"
								aria-hidden="true"
							/>
							<span class="text-[13px]">Back to sidebar</span>
						{:else}
							<Icons.Maximize2
								class="size-[18px]"
								aria-hidden="true"
							/>
						{/if}
					</button>
					<button
						type="button"
						class="text-surface-600-400 hover:bg-surface-200-800 hover:text-surface-950-50 focus-visible:outline-primary-500 flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
						title="Close"
						aria-label="Close {activeView
							? titleOf(activeView)
							: ''}"
						onclick={() => {
							if (activeView) void closeView(activeView)
						}}
					>
						<Icons.X class="size-[18px]" aria-hidden="true" />
					</button>
				</div>

				<!-- Every open view, mounted. Keyed on the view so reordering
				     never remounts one.

				     ══ the view container ═════════════════════════════════
				     `@container/view` is the one thing a view may rely on: a
				     named CSS container (`container-type: inline-size;
				     container-name: view`) whose width IS the width the view
				     was handed — 400px in the dock, everything right of the
				     rail in full page, the screen below `lg`. It is this
				     element and not an inner box on purpose: as a stretched
				     child of the sidebar's column flex it is exactly the
				     sidebar's width, where a wrapper inside the view would
				     shrink-wrap its own content and measure itself.

				     A view asks for room like this — copy the spelling:

				         <div class="@min-[900px]/view:grid-cols-[320px_1fr]">

				     900px is DESK_MIN_PX ($lib/client/shell/viewMode.svelte),
				     the app's one desk/compact floor; it has no Tailwind
				     container step of its own, so it is spelled as the
				     arbitrary `@min-[…]/view:`. Tailwind's named steps work
				     too (`@lg/view:` → 32rem, `@4xl/view:` → 56rem) and both
				     compile to a plain `@container view (width >= …)` rule.
				     When only the SHAPE of the markup can answer — different
				     components, a pane that must not be mounted at all —
				     `ViewModeTracker` from the same module measures this
				     element for you.

				     ⚠ A container is also a containing block for `position:
				     fixed` descendants (container-type implies layout
				     containment). A view that draws a full-screen overlay
				     with `fixed inset-0` now fills THIS box, not the viewport.
				     Overlays that must cover the window belong in a portal /
				     Skeleton modal, not in the view's own tree. -->
				{#each openViews as key (key)}
					<div
						class="@container/view flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
						hidden={key !== activeView}
						data-sidebar-view={key}
					>
						{@render sidebarView(key)}
					</div>
				{/each}
			</div>

			<!-- ══ the page ══════════════════════════════════════════════
			     Hidden, never unmounted, while a view is in full page: the
			     session underneath keeps its scroll, its stream and its
			     composer draft. -->
			<main
				bind:this={mainContentRef}
				class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
				hidden={fullPageView !== null}
				tabindex="-1"
			>
				<!-- Header carries only session concerns now (the Layout
				     button and the mobile panels button — see Header.svelte's
				     own comment), so every other page renders it here only to
				     waste 48px on a bar with just the title. Session pages
				     alone get it.

				     And not even those while the desktop layout editor is
				     open: the editor's toolbar takes this band, so the header
				     steps out rather than being covered by it. -->
				{#if page.url.pathname.startsWith("/sessions/") && !layoutEditor.open}
					<Header />
				{/if}
				<!-- 🚧 Interim reading width. Before the single-sidebar shell
				     this column sat between two quarter-width sidebars, so
				     every page was drawn for roughly 700–900px; `<main>` now
				     spans everything right of the rail, and the home wizard was
				     stretching to 1376px. One rule, applied here rather than
				     page by page, until the pages are redesigned for the space
				     they actually have.

				     `max-w` on the SCROLL container itself, not a wrapper
				     inside it: a block wrapper with auto height would break
				     every `h-full` page beneath it, and `display: contents`
				     would buy the same thing with a rule easier to misread.
				     Sessions and Admin manage their own width (the session
				     surface grid spends the whole viewport; the admin shell
				     switches on ITS container's width), so they are exempt.
				     One rule, one question: the two-sidebar shell's full-width
				     toggle was the other answer to it and was retired with the
				     margin slot (2026-09-17), so there is nothing left to
				     reconcile this with. -->
				<div
					class="flex-1 overflow-auto {constrainContentWidth
						? 'mx-auto w-full max-w-[1120px]'
						: ''}"
				>
					{@render children?.()}
				</div>
			</main>

			<!-- ══ the mobile bottom bar ═════════════════════════════════
			     Four destinations and More, replacing the hamburger. -->
			<nav
				class="bg-surface-50-950 border-surface-200-800 flex shrink-0 items-center justify-around border-t px-1 pt-2 pb-3 lg:hidden"
				aria-label="Primary navigation"
			>
				{#each bottomBarEntries as entry (entry.key)}
					{@const isActive =
						entry.key === "more"
							? panelsCtx.isMobileMenuOpen
							: isRailActive(entry)}
					<button
						type="button"
						class="flex h-12 w-16 flex-col items-center justify-center gap-[3px] rounded-lg transition-colors {isActive
							? 'text-primary-500'
							: 'text-surface-600-400'}"
						aria-label={entry.title}
						aria-current={isActive && entry.key !== "more"
							? "true"
							: undefined}
						aria-expanded={entry.key === "more"
							? panelsCtx.isMobileMenuOpen
							: undefined}
						onclick={() => handleBottomBarClick(entry)}
					>
						{#if entry.imgSrc}
							<span
								class="block size-5"
								style="background-color: currentColor; mask: url({entry.imgSrc}) no-repeat center / contain; -webkit-mask: url({entry.imgSrc}) no-repeat center / contain;"
								aria-hidden="true"
							></span>
						{:else if entry.icon}
							<entry.icon class="size-5" aria-hidden="true" />
						{/if}
						<span class="text-[11px] leading-none">
							{entry.title}
						</span>
					</button>
				{/each}
			</nav>
		</div>

		<!-- ══ Jump ══════════════════════════════════════════════════════
		     A sibling of the z-10 shell, never inside `<main>`: the pill is
		     pinned to the VIEWPORT's top-right corner, and a fixed element
		     inside a column that clips its overflow is one `transform` on an
		     ancestor away from being positioned against that column instead.

		     Both live behind `{#if shouldShowApp}`, which is the same thing as
		     "there is a `panelsCtx`" — the overlay resolves a hit through it,
		     so there is nothing for Jump to do before a user is known, and
		     Document View has its own shell and never renders this file.

		     The pill leaves while the session layout editor's toolbar owns the
		     top band, and while a sidebar view is full page: the pill sits
		     UNDER sidebars (ruled 2026-09-17), and a full-page view is a
		     sidebar view given the whole window, so the corner is its. Below
		     `lg` an open view is a sheet inside the shell's own stacking
		     context, where z-45 over z-44 decides nothing — so the pill is
		     unrendered there too, exactly as for full page, rather than
		     merely stacked under. Ctrl-K opens the overlay in every one of
		     those states. -->
		{#if !layoutEditor.open && fullPageView === null && (desktop.matches || activeView === null)}
			<JumpPill {jumpCtx} />
		{/if}
		{#if jumpCtx.isOpen}
			<JumpOverlay {jumpCtx} />
		{/if}

		<!-- ══ the More sheet ════════════════════════════════════════════
		     Everything the bottom bar has no room for. Same markup the
		     hamburger's menu used, same 44px rows. -->
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
					<!-- Matches the bar button that opened it: square 44px
					     target, and it had no accessible name at all before. -->
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
					{#each moreMenuEntries as entry (entry.key)}
						<button
							class="btn hover:preset-filled-surface-200-800 text-foreground flex min-h-11 w-full items-center justify-start gap-3 rounded-lg px-3 text-base [&>svg]:size-5"
							title={entry.title}
							onclick={() => handleMoreMenuClick(entry)}
						>
							{#if entry.imgSrc}
								<span
									class="block size-5 shrink-0"
									style="background-color: currentColor; mask: url({entry.imgSrc}) no-repeat center / contain; -webkit-mask: url({entry.imgSrc}) no-repeat center / contain;"
									aria-hidden="true"
								></span>
							{:else if entry.icon}
								<entry.icon aria-hidden="true" />
							{/if}
							<span>{entry.title}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- The views themselves. One `{#if}` chain, rendered once per open tab, so
	     each sidebar keeps the props it has always taken. -->
	{#snippet sidebarView(key: string)}
		{#if key === "admin"}
			<!-- No `bind:onclose`: the section list holds no unsaved work, so
			     there is no gate for it to register. -->
			<AdminSidebar />
		{:else if key === "sampling"}
			<SamplingSidebar bind:onclose={viewCloseGates[key]} />
		{:else if key === "connections"}
			<ConnectionsSidebar bind:onclose={viewCloseGates[key]} />
		{:else if key === "users"}
			<UsersSidebar bind:onclose={viewCloseGates[key]} />
		{:else if key === "legacy"}
			<LegacySidebar bind:onclose={viewCloseGates[key]} />
		{:else if key === "pipelines"}
			<PipelinesSidebar
				bind:onclose={viewCloseGates[key]}
				sessionId={sessionIdInView}
			/>
		{:else if key === "help"}
			<!-- No `bind:onclose`: the documentation holds no unsaved work, so
			     there is no gate for it to register. -->
			<HelpSidebar />
		{:else if key === "settings"}
			<SettingsSidebar bind:onclose={viewCloseGates[key]} />
		{:else if key === "activity"}
			<ActivitySidebar bind:onclose={viewCloseGates[key]} />
		{:else if key === "characters"}
			<CharactersSidebar bind:onclose={viewCloseGates[key]} />
		{:else if key === "sessions"}
			<SessionsSidebar
				bind:onclose={viewCloseGates[key]}
				sessionId={sessionIdInView}
			/>
		{:else if key === "lorebooks"}
			<LorebooksSidebar bind:onclose={viewCloseGates[key]} />
		{:else if key === "tags"}
			<TagsSidebar bind:onclose={viewCloseGates[key]} />
		{/if}
	{/snippet}
{/if}

<!-- Connection Timeout Modal -->
<ConnectionTimeoutModal />

<!-- The review gate (01 §7): a run parked at a gated node, waiting on you.
     Mounted globally because a review can park from any trigger — a session
     reply, a summarize, an event — and the card has to reach the person
     whichever screen they are on. -->
<PipelineReviewModal />
<CapPauseDialog />

<!-- The run inspector (handover §4.8): what a run did, anchored to whatever
     produced it. Mounted globally for the same reason as the card above — a
     message's menu and a finished progress card both open it, and neither
     screen should own a copy. -->
<RunInspectorModal />

<!-- Update notice. Rendered here rather than in +layout.svelte because that
     file is the parent of this one and so cannot read userCtx (context flows
     down), and because a notice only an admin can act on has no business
     appearing over the login screen. -->
<UpdateNoticeBar isAdmin={!!userCtx.user?.isAdmin} />

<style lang="postcss">
	@reference "tailwindcss";

	main {
		@apply relative m-0;
	}
</style>
