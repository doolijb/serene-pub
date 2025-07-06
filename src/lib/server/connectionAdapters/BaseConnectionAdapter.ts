import { PromptBuilder } from "../utils/promptBuilder"
import type { TokenCounters } from "../utils/TokenCounterManager"

export interface BasePromptChat extends SelectChat {
		chatCharacters?: (SelectChatCharacter & {
			character: SelectCharacter & { lorebook?: SelectLorebook }
		})[]
		chatPersonas?: (SelectChatPersona & {
			persona: SelectPersona & { lorebook?: SelectLorebook }
		})[]
		chatMessages: SelectChatMessage[]
		lorebook: SelectLorebook & {
			lorebookBindings: (SelectLorebookBinding & {
				character?: SelectCharacter
				persona?: SelectPersona
			})[]
		}
	}

// Generic interface for constructor parameters
export interface BaseConnectionAdapterParams {
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	chat: BaseChat
	currentCharacterId: number
	tokenCounter: TokenCounters
	tokenLimit: number
	contextThresholdPercent: number
}

// Types for abstract functions
export type ListModelsFn = (connection: SelectConnection) => Promise<{ models: any[]; error?: string }>
export type TestConnectionFn = (connection: SelectConnection) => Promise<{ ok: boolean; error?: string }>

export abstract class BaseConnectionAdapter {

	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	chat: BaseChat
	currentCharacterId: number
	isAborting = false
	promptBuilder: PromptBuilder

	constructor({
		connection,
		sampling,
		contextConfig,
		promptConfig,
		chat,
		currentCharacterId,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent
	}: BaseConnectionAdapterParams) {
		this.connection = connection
		this.sampling = sampling
		this.contextConfig = contextConfig
		this.promptConfig = promptConfig
		this.chat = chat
		this.currentCharacterId = currentCharacterId
		this.promptBuilder = new PromptBuilder({
			connection: this.connection,
			sampling: this.sampling,
			contextConfig: this.contextConfig,
			promptConfig: this.promptConfig,
			chat: this.chat,
			currentCharacterId: this.currentCharacterId,
			tokenCounter,
			tokenLimit,
			contextThresholdPercent
		})
	}

	async compilePrompt(args: {}): Promise<CompiledPrompt> {
		this.promptBuilder.tokenLimit = await this.getContextTokenLimit()
		return await this.promptBuilder.compilePrompt(args)
	}

	abstract generate(): Promise<
		{
			completionResult: string | ((cb: (chunk: string) => void) => Promise<void>),
			compiledPrompt: CompiledPrompt,
			isAborted: boolean
		}
	>

	abort() {
		this.isAborting = true
	}

	async getContextTokenLimit(): Promise<number> {
		return this.sampling.contextTokensEnabled ? this.sampling.contextTokens || 4096 : 4096
	}
}

export interface AdapterExports {
	Adapter: new (args: BaseConnectionAdapterParams) => BaseConnectionAdapter,
	listModels: ListModelsFn
	testConnection: TestConnectionFn,
	connectionDefaults: Record<string, any>
	samplingKeyMap: Record<string, string>
}
