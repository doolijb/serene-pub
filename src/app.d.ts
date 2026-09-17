// See https://svelte.dev/docs/kit/types#app.d.ts

import type { Component } from "@lucide/svelte"
import type { LoreRoute } from "$lib/client/lorebooks/loreRoute"
import * as schema from "$lib/server/db/schema"
import type { Schema } from "inspector/promises"
import type { P } from "ollama/dist/shared/ollama.d792a03f.mjs"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions"
import { FileAcceptDetails } from "../node_modules/@zag-js/file-upload/dist/index.d"
import type { ListResponse } from "ollama"

// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			latestReleaseTag?: string
			isNewerReleaseAvailable?: boolean
		}
		interface PageData {
			latestReleaseTag?: string
			isNewerReleaseAvailable?: boolean
			/** True when the running build carries a semver pre-release
			 * suffix (0.6.0-pr-1, -rc.1, -beta, -dev). Set by the root
			 * layout's server load; drives the build watermark and
			 * suppresses every update notice. */
			isPrerelease?: boolean
		}
		// interface PageState {}
		// interface Platform {}
	}

	interface OpenChangeDetails {
		open: boolean
	}

	interface PanelsCtx {
		/**
		 * The view showing in the sidebar right now, or null when the sidebar
		 * is collapsed. A *view* is what a rail item opens. "Panel" names only
		 * a session widget (see docs/session-layout.md), so this sidebar
		 * concept is called a view instead.
		 */
		activeView: string | null
		/**
		 * Every view that still has a tab, in the order the tabs were opened.
		 *
		 * Each one stays MOUNTED — hidden with the `hidden` attribute, never
		 * unmounted — so its scroll position, filters and half-typed forms
		 * survive switching away and back. Only `closeView` (the header's close
		 * button) or eviction at the cap unmounts one.
		 */
		openViews: string[]
		/**
		 * The view grown to fill everything right of the rail, or null. It is
		 * the SAME mounted instance as the sidebar's — the container grows, the
		 * view is not rendered twice. Always either null or equal to
		 * `activeView`. Set null to come back to the sidebar from anywhere with
		 * context access, e.g. a view button that navigates to another page.
		 */
		fullPageView: string | null
		/**
		 * Open a view in the sidebar and make it active.
		 *
		 * `toggle` (default true) collapses the sidebar when the view asked for
		 * is the one already showing; pass false for a deep link, which should
		 * land on the view rather than toggling it shut. `fullPage` opens it
		 * across the whole content area.
		 */
		openView: (
			key: string,
			opts?: { toggle?: boolean; fullPage?: boolean }
		) => void
		/**
		 * Close a view's tab: its close gate is asked first, and returning
		 * false from that gate refuses the close. Resolves to whether it
		 * actually closed.
		 */
		closeView: (key: string) => Promise<boolean>
		/**
		 * Register the gate that decides whether a view may close — the
		 * per-view generalisation of the old `onLeftPanelClose`. A view with
		 * unsaved changes returns false (usually after showing its own confirm)
		 * and keeps its tab. Every open view can hold one at once, which is why
		 * it is keyed rather than one-per-side.
		 */
		registerViewCloseGate: (
			key: string,
			fn: (() => Promise<boolean> | undefined) | undefined
		) => void
		/**
		 * ⏳ Compatibility with the two-sidebar shell these replaced. Assigning
		 * null collapses the sidebar; assigning a key opens that view without
		 * toggling.
		 *
		 * Reading answers WHERE THE SIDEBAR IS, not which nav a view was
		 * registered under: there is one sidebar and it is on the left, so
		 * `leftPanel` is the active view whenever that sidebar is on screen at
		 * `lg` and not in full page, `rightPanel` is always null, and
		 * `mobilePanel` is the active view below `lg`. Keyed on nav membership
		 * instead, opening a `rightNav` view made `SessionLayout` reserve a
		 * right margin for a sidebar sitting on the left.
		 */
		leftPanel: string | null
		rightPanel: string | null
		mobilePanel: string | null
		/** The mobile "More" sheet — every rail item the bottom bar has no room for. */
		isMobileMenuOpen: boolean
		/**
		 * Let the page content spend the space a closed sidebar is not using.
		 *
		 * ⏳ A leftover of the two-sidebar shell, where a closed sidebar still
		 * held its quarter so the centre column would not move every time a
		 * panel opened. The single-sidebar shell always gives the page whatever
		 * the sidebar is not using, so nothing in the shell reads this any
		 * more — but `SessionLayout` still does, to decide whether its side
		 * zones get margins, so the flag and its localStorage key stay.
		 *
		 * Desktop only — the mobile layout is already one thing at a time.
		 */
		wideContent: boolean
		/**
		 * The rail's wide form: 208px, a label beside every icon and a name over
		 * each group, against the 64px strip of icons alone. The rail's own
		 * toggle writes it and it is persisted per browser under
		 * `serene-pub:railWide`, so a settings switch or a keyboard shortcut can
		 * drive the same flag.
		 *
		 * Desktop only — below `lg` the bottom bar is the rail and this is idle.
		 */
		railWide: boolean
		/** Flip `railWide`. Which view is open is untouched. */
		toggleRailWide: () => void
		/** ⏳ `openView(key, { toggle })` under its old name. */
		openPanel: (args: { key: string; toggle?: boolean }) => void
		/**
		 * ⏳ Close the active view if it belongs to the named side (and, for
		 * "mobile", if the window is below `lg`); resolves true when there was
		 * nothing of that side to close.
		 */
		closePanel: (args: {
			panel: "left" | "right" | "mobile"
		}) => Promise<boolean>
		leftNav: Record<
			string,
			| {
					icon: Component<Icons.IconProps, {}, "">
					title: string
					imgSrc?: undefined
			  }
			// KoboldCPP's nav entry uses an image mask instead of a lucide icon
			// component — see the `item.imgSrc` branch in Layout.svelte's mobile nav.
			| { icon?: undefined; imgSrc: string; title: string }
		>
		rightNav: Record<
			string,
			| {
					icon: Component<Icons.IconProps, {}, "">
					title: string
					imgSrc?: undefined
			  }
			| { icon?: undefined; imgSrc: string; title: string }
		>
		digest: {
			characterId?: number
			/** Open the character sidebar straight to its detail/view screen, not the edit form */
			viewCharacterId?: number
			sessionId?: number
			sessionPersonaId?: number
			sessionCharacterId?: number
			/**
			 * Open the Sessions view straight to the start-a-session screen,
			 * with whatever the caller already knows filled in. An empty object
			 * is the plain "start one" — the screen answers the rest itself.
			 */
			createSession?: {
				characterId?: number
				personaId?: number
				genreId?: string
				presetId?: number
			}
			tutorial?: boolean
			/** Where the lorebook workspace should open — one address for the
			 * book, the section, the entry and how it is presented. */
			lore?: LoreRoute
			/**
			 * Open the Help view on one documentation page, and at one heading
			 * inside it. The slug is the address — the docs are the one jump
			 * kind whose rows are not integer-keyed.
			 */
			help?: { slug: string; anchor?: string }
			/** Open the connections sidebar and select a specific connection */
			connectionId?: number
			/** Open the connections sidebar straight to one modality's section. */
			connectionsModality?: string
		}
		leftNavOrder: string[]
		rightNavOrder: string[]
		getOrderedEntries: (
			nav: Record<string, any>,
			order: string[]
		) => ReadonlyArray<readonly [string, any]>
	}

	interface UserCtx {
		user: SelectUser | undefined
	}

	interface SystemSettingsCtx {
		settings?: Omit<
			SelectSystemSettings,
			| "id"
			| "charaVaultEmail"
			| "charaVaultEncryptedToken"
			| "charaVaultTokenIv"
			| "charaVaultTokenAuthTag"
		> & {
			isAndroidWrapper?: boolean
			localEmbeddingsSupported?: boolean
			/**
			 * What an embedded row's `embedding_model` is compared against, or
			 * null when nothing is starred. Derived from the star, not a column
			 * — see `SystemSettings.Get.Response`.
			 */
			activeEmbeddingModel?: string | null
		}
		/**
		 * The instance default connection and sampling config, per capability
		 * (0175), lives in its own table rather than a column pair per
		 * modality, so it arrives beside `settings` rather than inside it. It
		 * is the only place a default comes from; `settings` carries none.
		 *
		 * ⚠ NOT optional, deliberately, and for the same reason as its twin on
		 * `SystemSettings.Get.Response`: an optional field forces every reader
		 * to handle `undefined`, and the handling that gets written is
		 * `?? settings.defaultConnectionId` — growing back the second spelling
		 * this change exists to remove. No defaults registered is `{}`.
		 */
		capabilityDefaults: Record<string, Sockets.CapabilityDefault>
	}

	interface OllamaSettingsCtx {
		settings?: Omit<SelectOllamaSettings, "id">
	}

	interface KoboldCppSettingsCtx {
		// koboldCppManagedAdminPassword is never sent to the client (server-only
		// secret) — see the `columns` filter in systemSettingsGet.
		// koboldCppManagedAdminPasswordSet indicates whether one is already
		// stored, without revealing it, for showing a bullet placeholder.
		settings?: Omit<
			SelectKoboldCppSettings,
			"id" | "koboldCppManagedAdminPassword"
		> & { koboldCppManagedAdminPasswordSet: boolean }
	}

	interface UserSettingsCtx {
		// "userSettings:get" only returns a hand-picked subset of columns (see
		// userSettingsGet in userSettings.ts), not the full row minus id/userId.
		settings?: Sockets.UserSettings.Get.Response["userSettings"]
	}

	interface VectorizationCtx {
		status: "idle" | "running" | "paused"
		currentItem?: { type: string; label: string }
		queued: number
		completed: number
		priorityQueue: Sockets.Vectorization.PriorityGroup[]
		history: Sockets.Vectorization.CompletedGroup[]
	}

	interface TaskQueueCtx {
		tasks: Sockets.TaskQueue.QueuedTask[]
	}

	// Written by the open session route (src/routes/sessions/[id]/+page.svelte) so
	// globally-rendered sidebars (e.g. LorebooksSidebar) can tell whether a
	// session is currently open, whether it already has a lorebook attached, and
	// whether the current user owns it (guests can't change it), without a
	// dedicated fetch of their own.
	interface OpenSessionCtx {
		sessionId: number | null
		/** What the session is called, for copy that names it. */
		sessionName: string | null
		lorebookId: number | null
		isOwner: boolean
	}

	interface GraphBuildState {
		activityId?: string
		userId?: number
		lorebookId: number
		lorebookLabel?: string
		mode: "replace" | "extend"
		status: "building" | "review" | "error"
		phase: string
		sceneIndex: number
		totalScenes: number
		nodesFound: number
		relsFound: number
		currentPair?: string
		currentSceneLabel?: string
		proposal?: Sockets.NarrativeGraph.GraphProposal
		sceneLabels?: string[]
		seedTempIdMap?: Record<string, number>
		seedNodeNames?: Record<string, string>
		/** Attribution for an empty/thin relationship set — see the modal. */
		relationshipDiagnostics?: Sockets.NarrativeGraph.RelationshipDiagnostics
		/** Proposed names screened out as World Lore subjects. */
		filteredWorldLoreNames?: string[]
		errorMessage?: string
		errorRaw?: string
		startedAt: string
		trace?: Sockets.NarrativeGraph.TraceEntry[]
	}

	interface GraphBuildsCtx {
		activeBuild: GraphBuildState | null
		/** Set by notification dropdown to trigger a GraphManager to reopen its build modal */
		reopenLorebookId: number | null
		startBuild: (params: {
			lorebookId: number
			mode: "replace" | "extend"
			lorebookLabel?: string
		}) => void
		clearBuild: () => void
	}

	interface SceneSummarizeState {
		activityId: string
		userId: number
		sceneId: number
		sceneName?: string
		lorebookId: number
		lorebookLabel?: string
		historyEntryId?: number
		status: "running" | "review" | "error"
		phase?: "drafting" | "synthesizing" | "naming" | "extracting"
		batch?: number
		totalBatches?: number
		errorMessage?: string
		pendingResult?: {
			content: string
			name?: string
			participantCharacters: number[]
			mentionedCharacters: number[]
			suggestedParticipantCharacters?: string[]
			suggestedMentionedCharacters?: string[]
			raw: string
		}
		startedAt: string
	}

	interface SceneSummarizesCtx {
		activities: SceneSummarizeState[]
		/** Set by the activity sidebar so the lorebook workspace opens the review modal */
		reviewSceneId: number | null
		dismiss: (activityId: string) => void
		setReviewSceneId: (id: number | null) => void
	}

	interface SessionSummarizeState {
		activityId: string
		userId: number
		sessionId: number
		sessionLabel?: string
		loreType: "world" | "character"
		lorebookId: number
		topic?: string
		status: "running" | "review" | "error"
		phase?: "drafting" | "synthesizing" | "naming" | "extracting"
		batch?: number
		totalBatches?: number
		errorMessage?: string
		pendingResult?: {
			content: string
			name?: string
			raw: string
			lorebookBindingId?: number | null
		}
		startedAt: string
	}

	interface SessionSummarizesCtx {
		activities: SessionSummarizeState[]
		/**
		 * Set by the activity sidebar so the session page reopens the summarize
		 * modal for that run. Carries the session too, because unlike the scene and
		 * compile flows this one lives on a route rather than a panel — the
		 * sidebar has to navigate before anything can reopen.
		 */
		reviewActivityId: string | null
		dismiss: (activityId: string) => void
		setReviewActivityId: (id: string | null) => void
	}

	interface CompileEntryState {
		activityId: string
		userId: number
		historyEntryId: number
		historyEntryDate: string
		lorebookId: number
		lorebookLabel: string
		status: "running" | "review" | "error"
		phase?: "drafting" | "synthesizing"
		batch?: number
		totalBatches?: number
		errorMessage?: string
		pendingResult?: { content: string }
		startedAt: string
	}

	interface CompileEntriesCtx {
		activities: CompileEntryState[]
		/** Set by the activity sidebar so the lorebook workspace opens the compile modal */
		reviewHistoryEntryId: number | null
		dismiss: (activityId: string) => void
		setReviewHistoryEntryId: (id: number | null) => void
	}

	export interface CharaImportMetadata {
		data: {
			alternate_greetings?: string[]
			avatar?: string
			character_version?: string
			creator?: string
			creator_notes?: string
			description: string
			extensions: Record<string, any>
			first_mes: string
			mes_example: string
			name: string
			personality: string
			post_history_instructions?: string
			scenario: string
			system_prompt?: string
			tags?: string[]
		}
		spec: string
		spec_version: string
	}

	export interface CompiledPrompt {
		content: string
		name: string
		model?: string
		temperature?: number
		top_p?: number
		max_tokens?: number
		frequency_penalty?: number
		presence_penalty?: number
		seed?: number
		stop?: string[]
		prompt_type?: string
		context_config?: string
		sampling_config?: string
		// Add other properties as needed
	}
	export interface CharaImportMetadata {
		data: {
			alternate_greetings?: string[]
			avatar?: string
			character_version?: string
			creator?: string
			creator_notes?: string
			description: string
			extensions: Record<string, any>
			first_mes: string
			mes_example: string
			name: string
			personality: string
			post_history_instructions?: string
			scenario: string
			system_prompt?: string
			tags?: string[]
		}
		spec: string
		spec_version: string
	}

	export interface CompiledPrompt {
		meta: {
			description?: string
			promptFormat: string
			templateName?: string | null
			timestamp?: string
			truncationReason?: string | null
			currentTurnCharacterId?: number | null
			tokenCounts?: {
				total: number
				limit: number
			}
			sessionMessages?: {
				included: number
				total: number
				includedIds: number[]
				excludedIds: number[]
			}
			sources?: any
		}
		prompt?: string | ChatCompletionMessageParam[]
		messages?: any[]
	}

	export interface ConnectionSummary {
		connections: SelectConnection[]
		models: {
			[baseUrl: string]: ListResponse["models"]
		}
	}

	export interface FileCharacter {
		character: SelectCharacter
		avatar?: Buffer
	}

	export interface ConnectionHealthDetails {
		status: "ok" | "unreachable" | "error"
		url: string
		pingTime?: number
		details?: string
	}

	export interface ServerInfoDetails {
		info: any
	}

	export interface SyncDetails {
		syncSource: Partial<SelectUser> | null
		scenario: null | "character" | "session"
	}

	interface FileAcceptDetails {
		files: File[]
	}
}

export {}
