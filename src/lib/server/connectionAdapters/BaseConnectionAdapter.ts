import {
	PromptBuilder,
	type CompiledPrompt as PromptBuilderCompiledPrompt
} from "../utils/promptBuilder"
import type { TokenCounters } from "../utils/TokenCounterManager"
import type { JsonSchemaNode } from "./jsonSchemaToGbnf"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import { PromptBlockFormatter } from "$lib/shared/utils/PromptBlockFormatter"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"

export interface BasePromptChat extends SelectChat {
	chatCharacters?: (SelectChatCharacter & {
		character: SelectCharacter & { lorebook?: SelectLorebook }
	})[]
	chatPersonas?: (SelectChatPersona & {
		persona: SelectPersona & { lorebook?: SelectLorebook }
	})[]
	// Removed (soft-deleted) participants, deliberately kept OUT of
	// chatCharacters/chatPersonas above so every "who's active in this chat"
	// consumer (visible-character-name lists, turn order, lorebook binding
	// checks, etc.) doesn't have to re-filter — see getPromptChatFromDb.
	// Historical-message-speaker resolution is the one legitimate exception
	// that needs removed rows too (a past message from a since-removed
	// participant must still show who said it), so that lookup is supplied
	// here instead, kept separate rather than merged back into the main
	// lists so no other consumer can accidentally pick a removed row up.
	removedChatCharacters?: (SelectChatCharacter & {
		character: SelectCharacter | null
	})[]
	removedChatPersonas?: (SelectChatPersona & {
		persona: SelectPersona | null
	})[]
	chatMessages: SelectChatMessage[]
	// A chat's lorebookId is nullable, and the relational query result mirrors
	// that (null when unset) — every consumer already guards for this (see
	// hasLorebookEntries() and the `chat.lorebook && ...` checks in
	// LorebookBindingUtils.ts), so this stays optional rather than falsely
	// promising it's always populated.
	lorebook?:
		| (SelectLorebook & {
				lorebookBindings: (SelectLorebookBinding & {
					// characterId/personaId are nullable FKs (onDelete: "set null"),
					// so the populated relation can likewise be null, not just absent.
					character?: SelectCharacter | null
					persona?: SelectPersona | null
				})[]
		  })
		| null
}

/**
 * What shape the caller needs the response in.
 *
 * A contract for the RESPONSE, not a decoding preference — it must never be
 * implemented by reaching into the user's sampling config. Each adapter
 * translates it into whatever its provider supports (a GBNF grammar, Ollama's
 * `format`, OpenAI's `response_format`, …) and ignores it when the provider
 * supports nothing of the kind.
 */
export type ResponseFormat = "text" | "json"

// Generic interface for constructor parameters
export interface BaseConnectionAdapterParams {
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	chat: BasePromptChat
	currentCharacterId: number | null
	tokenCounter: TokenCounters
	tokenLimit: number
	contextThresholdPercent: number
	generatingMessageMetadata?: any // Metadata of the message being generated/regenerated
}

// Types for abstract functions
export type ListModelsFn = (
	connection: SelectConnection
) => Promise<{ models: any[]; error?: string }>
export type TestConnectionFn = (
	connection: SelectConnection
) => Promise<{ ok: boolean; error?: string }>

export abstract class BaseConnectionAdapter {
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	chat: BasePromptChat
	currentCharacterId: number | null
	isAborting = false
	isSummarizerMode = false
	isNarratorResponseMode = false
	generatingMessageMetadata: any = {}
	// Set directly by generateResponse.ts (not a constructor param — it's
	// computed after the adapter is constructed, from an async
	// buildGraphContext() call). Merged into extraInstructions by
	// compilePrompt() below for the regular (non-summarizer/non-narrator)
	// character-perspective path — narrator's equivalent
	// per-trigger note already flows through compileNarratorResponsePrompt's
	// own extraInstructions.
	graphContextInstructions?: string
	/**
	 * Response-shape contract for this generation. Assigned after construction
	 * (`adapter.responseFormat = "json"`), like graphContextInstructions above.
	 *
	 * Deliberately NOT a constructor param. Every subclass declares its own
	 * inline destructured param type rather than using
	 * BaseConnectionAdapterParams, so a field added to that interface never
	 * reaches them and TypeScript does not complain — `tokenCounter`,
	 * `tokenLimit` and `contextThresholdPercent` are dropped by KoboldCppAdapter
	 * and LlamaCppAdapter today for exactly this reason. See the note on
	 * isNarratorResponseMode below; this is the same hazard, avoided the same
	 * way.
	 *
	 * The default is what keeps chat safe: anything that does not explicitly opt
	 * in generates unconstrained. A constraint leaking into roleplay would be a
	 * far worse regression than the extraction failures it exists to fix.
	 */
	responseFormat: ResponseFormat = "text"
	/**
	 * Optional shape contract, consulted ONLY when responseFormat is "json".
	 *
	 * Kept as a separate property rather than widening ResponseFormat into a
	 * union carrying a payload: "is this constrained at all" and "what shape"
	 * are answered by different providers at different fidelities, and every
	 * adapter already branches on the first. An adapter whose provider cannot
	 * take a schema ignores this and falls back to plain JSON mode — the same
	 * graceful-degradation rule responseFormat already follows, so adding a
	 * schema can never make a working provider worse.
	 *
	 * Providers split three ways: the llama.cpp family compiles it to GBNF via
	 * jsonSchemaToGbnf, Ollama/OpenAI/LM Studio take JSON Schema natively, and
	 * anything else ignores it.
	 */
	responseSchema?: JsonSchemaNode
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
		contextThresholdPercent,
		generatingMessageMetadata = {}
	}: BaseConnectionAdapterParams) {
		this.connection = connection
		this.sampling = sampling
		this.contextConfig = contextConfig
		this.promptConfig = promptConfig
		this.chat = chat
		this.currentCharacterId = currentCharacterId
		// Deliberately derived from generatingMessageMetadata rather than its
		// own constructor param: every adapter subclass (KoboldCPP, Ollama,
		// LMStudio, OpenAI, Anthropic, LlamaCpp) has its own constructor with
		// an explicit destructured field list and forwards generatingMessageMetadata
		// faithfully, but a plain boolean param added here would silently need
		// updating in all six of those subclasses too — easy to miss (this
		// exact bug happened once already). Piggybacking on a field that's
		// already reliably threaded through avoids that whole class of bug.
		this.isNarratorResponseMode =
			!!generatingMessageMetadata?.isNarratorResponse
		this.isSummarizerMode = chat.chatType === ChatTypes.SUMMARIZE
		this.generatingMessageMetadata = generatingMessageMetadata
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

	/**
	 * A prompt built elsewhere, to be sent as-is.
	 *
	 * Today an adapter builds its own prompt and sends it in one call, which
	 * means there is no moment between "the payload exists" and "the payload was
	 * sent" — and that moment is the entire debug preview (16 §7). The pipeline
	 * separates the two: a Task allocates, a Provider dispatches.
	 *
	 * This is the seam between those worlds, deliberately placed at the one
	 * point all seven adapters funnel through rather than edited into each of
	 * them. When it is set, `compilePrompt()` returns it instead of building —
	 * so the legacy path is unchanged by construction, and the pipeline path
	 * reaches exactly the same `generate()`.
	 */
	private injectedPrompt?: PromptBuilderCompiledPrompt

	/**
	 * Dispatch-only mode: send this payload, build nothing.
	 *
	 * Returns the adapter so a Provider binding reads as one expression. The
	 * payload is the *same shape* the adapter would have produced itself, which
	 * is what makes parity checkable rather than asserted — a pipeline run and a
	 * legacy run differ only in who built the prompt.
	 */
	withCompiledPrompt(prompt: PromptBuilderCompiledPrompt): this {
		this.injectedPrompt = prompt
		return this
	}

	/** Whether this adapter is being used as a Provider rather than end to end. */
	get isDispatchOnly(): boolean {
		return this.injectedPrompt !== undefined
	}

	async compilePrompt(args: {}): Promise<PromptBuilderCompiledPrompt> {
		// Before any mode branching: a caller that supplied a payload is asking
		// for dispatch, and summarizer/narrator mode are decisions that were
		// already made upstream when that payload was built.
		if (this.injectedPrompt) return this.injectedPrompt

		this.promptBuilder.tokenLimit = await this.getContextTokenLimit()

		if (this.isSummarizerMode) {
			return await this.compileSummarizerPrompt(args)
		}

		if (this.isNarratorResponseMode) {
			return await this.compileNarratorResponsePrompt(args)
		}

		// The always-on, speaker-centric narrative-graph relationship summary
		// (see graphContextFormatter.ts's buildGraphContext, called from
		// generateResponse.ts) — mirrors how narratorInstructions flows into
		// compileNarratorResponsePrompt's own extraInstructions just above.
		// Its own template block, NOT extraInstructions.
		//
		// extraInstructions is prose the model is asked to act on, and the
		// prompt builder splices it into `instructions` AND both post-history
		// fields — so routing relationship data through it duplicated the
		// payload three times per message and left a fenced JSON blob sitting
		// at the generation point, which models answered by closing with a
		// stray ```. Relationships are data; they belong in a data block.
		return await this.promptBuilder.compilePrompt({
			...args,
			speakerRelationships: this.graphContextInstructions
		})
	}

	abstract generate(): Promise<{
		completionResult:
			| string
			| ((
					contentCb: (chunk: string) => void,
					thinkingCb?: (chunk: string) => void
			  ) => Promise<void>)
		compiledPrompt: PromptBuilderCompiledPrompt
		isAborted: boolean
		/** Native thinking/reasoning content returned by the model, if any. Only populated for non-streaming responses. Streaming adapters deliver thinking via thinkingCb. */
		thinkingContent?: string
	}>

	abort() {
		this.isAborting = true
	}

	/**
	 * Optional hook run by the LLM queue before generate() is invoked, e.g.
	 * koboldcpp's managed-mode subprocess start + model load. No-op by default.
	 */
	async preflight(_signal?: AbortSignal): Promise<void> {}

	async getContextTokenLimit(): Promise<number> {
		return this.sampling.contextTokensEnabled
			? this.sampling.contextTokens || 4096
			: 4096
	}

	/**
	 * Build a text-completion prompt string from a chat-format messages
	 * array, for compileSummarizerPrompt() whose primary representation is
	 * `messages` but which — like the default character-perspective path —
	 * still needs to produce a real `prompt` on any text-completion
	 * connection. Without this, `prompt` was always left undefined here, so
	 * any connection not in chat-completion mode (e.g. KoboldCPP's default)
	 * silently generated from an empty prompt — the exact bug Narrator
	 * response had until it was fixed by delegating into the shared
	 * context-block pipeline instead; summarizer mode intentionally stays
	 * minimal (no lore/character context), so it needs this narrower fix
	 * rather than that same delegation.
	 */
	private buildTextPromptFromMessages(messages: any[]): string {
		const format = this.connection?.promptFormat || PromptFormats.VICUNA
		const blocks = messages.map((msg) =>
			PromptBlockFormatter.makeBlock({
				format,
				role: msg.role === "system" ? "system" : msg.role,
				content: msg.content
			})
		)
		blocks.push(
			PromptBlockFormatter.makeBlock({
				format,
				role: "assistant",
				content: "",
				includeClose: false
			})
		)
		return blocks.join("")
	}

	/**
	 * Compile summarizer prompt — passes promptConfig.systemPrompt directly to the LLM
	 * with no roleplay or assistant framing. Used for lore summarization.
	 */
	protected async compileSummarizerPrompt(
		args: any = {}
	): Promise<PromptBuilderCompiledPrompt> {
		const messages: any[] = [
			{
				role: "system",
				content: this.promptConfig.systemPrompt
			}
		]

		for (const msg of this.chat.chatMessages) {
			if (msg.isHidden) continue
			messages.push({
				role: msg.role === "assistant" ? "assistant" : "user",
				content: msg.content
			})
		}

		const useChatFormat = !!args?.useChatFormat
		const promptString = useChatFormat
			? undefined
			: this.buildTextPromptFromMessages(messages)

		const totalTokens = await this.promptBuilder.tokenCounter.countTokens(
			useChatFormat ? JSON.stringify(messages) : promptString!
		)

		return {
			prompt: promptString,
			messages,
			meta: {
				promptFormat: useChatFormat ? "chat" : "text",
				templateName: "summarizer",
				timestamp: new Date().toISOString(),
				truncationReason: null,
				currentTurnCharacterId: null,
				tokenCounts: {
					total: totalTokens,
					limit: await this.getContextTokenLimit()
				},
				chatMessages: {
					included: this.chat.chatMessages.filter(
						(m: SelectChatMessage) => !m.isHidden
					).length,
					total: this.chat.chatMessages.length,
					includedIds: this.chat.chatMessages
						.filter((m: SelectChatMessage) => !m.isHidden)
						.map((m: SelectChatMessage) => m.id),
					excludedIds: this.chat.chatMessages
						.filter((m: SelectChatMessage) => m.isHidden)
						.map((m: SelectChatMessage) => m.id)
				},
				sources: {
					characters: [],
					personas: [],
					scenario: null
				}
			}
		}
	}

	/**
	 * Compile a Narrator response prompt — a manually-triggered narration/
	 * environment response with no character perspective of its own.
	 * PromptBuilder.compilePrompt() treats a null currentCharacterId (set for
	 * this adapter in generateResponse.ts) as "no single perspective" rather
	 * than throwing, so this reuses the exact same context-block pipeline a
	 * character's own turn gets — lore/history matching (RAG or keyword),
	 * full character/persona context, per-format rendering — with
	 * {{char}}/{{user}} resolving to the joined cast lists instead of one
	 * name. The optional per-trigger focus note is layered on as
	 * extraInstructions rather than hand-appended here, so it's interpolated
	 * and included in both the system block the context pipeline builds and
	 * — combined with the config's own postHistoryInstructions, if set — the
	 * reinforcement block right before the generation point (see
	 * PromptBuilder.compilePrompt's handling of extraInstructions).
	 */
	protected async compileNarratorResponsePrompt(
		args: any = {}
	): Promise<PromptBuilderCompiledPrompt> {
		const narratorInstructions: string | undefined =
			this.generatingMessageMetadata?.narratorInstructions
		return await this.promptBuilder.compilePrompt({
			...args,
			extraInstructions: narratorInstructions
		})
	}
}

export interface AdapterExports {
	Adapter: new (args: BaseConnectionAdapterParams) => BaseConnectionAdapter
	listModels: ListModelsFn
	testConnection: TestConnectionFn
	connectionDefaults: Record<string, any>
	samplingKeyMap: Record<string, string>
}
