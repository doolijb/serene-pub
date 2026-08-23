// See https://svelte.dev/docs/kit/types#app.d.ts

import type { Component } from "@lucide/svelte"
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
		}
		// interface PageState {}
		// interface Platform {}
	}

	interface OpenChangeDetails {
		open: boolean
	}

	interface PanelsCtx {
		leftPanel: string | null
		rightPanel: string | null
		mobilePanel: string | null
		isMobileMenuOpen: boolean
		/** Which side's sidebar (if any) is expanded to cover the whole
		 * viewport — set null to exit fullscreen from anywhere with context
		 * access, e.g. a sidebar button that navigates to a different page. */
		fullscreenPanel: "left" | "right" | null
		/**
		 * Let the centre column spend the space a closed sidebar is not using.
		 *
		 * Distinct from `fullscreenPanel`, which is a *sidebar* covering
		 * everything. This is the page content taking whatever the sidebars
		 * leave: both closed and it has the window; one open and it takes the
		 * other side's quarter; both open and it is exactly its normal half, so
		 * turning this on can never take space away from a panel you opened.
		 *
		 * Desktop only — the mobile layout is already one thing at a time.
		 */
		wideContent: boolean
		openPanel: (args: { key: string; toggle?: boolean }) => void
		closePanel: (args: {
			panel: "left" | "right" | "mobile"
		}) => Promise<boolean>
		onLeftPanelClose?: () => Promise<boolean>
		onRightPanelClose?: () => Promise<boolean>
		onMobilePanelClose?: () => Promise<boolean>
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
			personaId?: number
			/** Open the character sidebar straight to its detail/view screen, not the edit form */
			viewCharacterId?: number
			/** Open the persona sidebar straight to its detail/view screen, not the edit form */
			viewPersonaId?: number
			chatId?: number
			chatPersonaId?: number
			chatCharacterId?: number
			lorebookId?: number
			tutorial?: boolean
			/** Focus a specific history entry in the lorebook sidebar */
			historyEntryId?: number
			/** Which tab to open when focusing a history entry */
			historyEntryTab?: "content" | "scenes"
			/** Expand a specific scene within the scenes tab */
			sceneId?: number
			/** Navigate to a specific lorebook tab when digest.lorebookId is set */
			lorebookTab?: string
			/** Open the connections sidebar and select a specific connection */
			connectionId?: number
			/** Open the connections sidebar straight to a category, skipping the index screen */
			connectionsView?: "connections" | "embedding"
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
		> & { isAndroidWrapper?: boolean; localEmbeddingsSupported?: boolean }
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

	// Written by the open chat route (src/routes/chats/[id]/+page.svelte) so
	// globally-rendered sidebars (e.g. LorebooksSidebar) can tell whether a
	// chat is currently open, whether it already has a lorebook attached, and
	// whether the current user owns it (guests can't change it), without a
	// dedicated fetch of their own.
	interface OpenChatCtx {
		chatId: number | null
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
		/** Set by the activity sidebar to trigger HistoryEntryManager to open the review modal */
		reviewSceneId: number | null
		dismiss: (activityId: string) => void
		setReviewSceneId: (id: number | null) => void
	}

	interface ChatSummarizeState {
		activityId: string
		userId: number
		chatId: number
		chatLabel?: string
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

	interface ChatSummarizesCtx {
		activities: ChatSummarizeState[]
		/**
		 * Set by the activity sidebar so the chat page reopens the summarize
		 * modal for that run. Carries the chat too, because unlike the scene and
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
		/** Set by the activity sidebar to trigger HistoryEntryManager to open the compile modal */
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
			chatMessages?: {
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
		scenario: null | "character" | "chat"
	}

	interface FileAcceptDetails {
		files: File[]
	}
}

export {}
