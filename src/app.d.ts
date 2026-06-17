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
		openPanel: (args: { key: string; toggle?: boolean }) => void
		closePanel: (args: {
			panel: "left" | "right" | "mobile"
		}) => Promise<boolean>
		onLeftPanelClose?: () => Promise<boolean>
		onRightPanelClose?: () => Promise<boolean>
		onMobilePanelClose?: () => Promise<boolean>
		leftNav: Record<
			string,
			{ icon: Component<Icons.IconProps, {}, "">; title: string }
		>
		rightNav: Record<
			string,
			{ icon: Component<Icons.IconProps, {}, "">; title: string }
		>
		digest: {
			characterId?: number
			personaId?: number
			chatId?: number
			chatPersonaId?: number
			chatCharacterId?: number
			lorebookId?: number
			tutorial?: boolean
		}
		leftNavOrder: string[]
		rightNavOrder: string[]
		getOrderedEntries: (
			nav: Record<string, any>,
			order: string[]
		) => Array<[string, any]>
	}

	interface UserCtx {
		user:
			| (SelectUser & {
					activeConnection: SelectConnection | null
					activeSamplingConfig: SelectSamplingConfig | null
					activeContextConfig: SelectContextConfig | null
					activePromptConfig: SelectPromptConfig | null
			  })
			| undefined
	}

	interface SystemSettingsCtx {
		settings?: Omit<SelectSystemSettings, "id">
	}

	interface UserSettingsCtx {
		settings?: Omit<SelectUserSettings, "id" | "userId">
	}

	interface VectorizationCtx {
		status: "idle" | "running" | "paused"
		currentItem?: { type: string; label: string }
		queued: number
		completed: number
		priorityQueue: Sockets.Vectorization.PriorityGroup[]
		history: Sockets.Vectorization.CompletedGroup[]
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
