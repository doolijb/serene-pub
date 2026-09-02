import type { CompiledPrompt as PromptBuilderCompiledPrompt } from "./types"
import type { TokenCounters } from "../utils/TokenCounterManager"
import type { JsonSchemaNode } from "./jsonSchemaToGbnf"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import { PromptBlockFormatter } from "$lib/shared/utils/PromptBlockFormatter"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"

export interface BasePromptSession extends SelectSession {
	sessionCharacters?: (SelectSessionCharacter & {
		character: SelectCharacter & { lorebook?: SelectLorebook }
	})[]
	sessionPersonas?: (SelectSessionPersona & {
		persona: SelectPersona & { lorebook?: SelectLorebook }
	})[]
	// Removed (soft-deleted) participants, deliberately kept OUT of
	// sessionCharacters/sessionPersonas above so every "who's active in this session"
	// consumer (visible-character-name lists, turn order, lorebook binding
	// checks, etc.) doesn't have to re-filter — see getPromptSessionFromDb.
	// Historical-message-speaker resolution is the one legitimate exception
	// that needs removed rows too (a past message from a since-removed
	// participant must still show who said it), so that lookup is supplied
	// here instead, kept separate rather than merged back into the main
	// lists so no other consumer can accidentally pick a removed row up.
	removedSessionCharacters?: (SelectSessionCharacter & {
		character: SelectCharacter | null
	})[]
	removedSessionPersonas?: (SelectSessionPersona & {
		persona: SelectPersona | null
	})[]
	sessionMessages: SelectSessionMessage[]
	// A session's lorebookId is nullable, and the relational query result mirrors
	// that (null when unset) — every consumer already guards for this (see
	// hasLorebookEntries() and the `session.lorebook && ...` checks in
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
	sampling: ResolvedSampling
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	session: BasePromptSession
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
	sampling: ResolvedSampling
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	session: BasePromptSession
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
	 * The default is what keeps session safe: anything that does not explicitly opt
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
	/**
	 * Token configuration, owned by the adapter.
	 *
	 * These three arrived as constructor params and were forwarded straight
	 * into `PromptBuilder`, which then became the only place to read them back
	 * — so an adapter asking "what is my context limit" had to go through the
	 * legacy prompt compiler to find out. Holding them here is what lets that
	 * compiler be deleted: the adapter keeps its own configuration, and the
	 * builder is handed a copy for as long as it still exists.
	 *
	 * Assigned in *this* constructor from the destructured params, deliberately.
	 * KoboldCpp, LlamaCpp and LMStudio do not accept these from their callers —
	 * they construct their own and pass them to `super({...})` — so the
	 * `super()` boundary is the one place every subclass agrees on. Anywhere
	 * else and three adapters would silently get different values than the
	 * builder does. (LMStudio passes `tokenLimit: 0` and sets it later from the
	 * API, which is why the sequencing below is preserved exactly.)
	 */
	tokenCounter: TokenCounters
	tokenLimit: number
	contextThresholdPercent: number

	constructor({
		connection,
		sampling,
		contextConfig,
		promptConfig,
		session,
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
		this.session = session
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
		this.isSummarizerMode = session.sessionType === SessionTypes.SUMMARIZE
		this.generatingMessageMetadata = generatingMessageMetadata
		this.tokenCounter = tokenCounter
		this.tokenLimit = tokenLimit
		this.contextThresholdPercent = contextThresholdPercent
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

	/**
	 * The payload this adapter will send.
	 *
	 * There is no longer anything to compile here. The pipeline builds every
	 * prompt and hands it over through `withCompiledPrompt`, so this returns
	 * what it was given — and refuses when it was given nothing, rather than
	 * silently generating from an empty string.
	 *
	 * The legacy fallthrough this replaced ran `PromptBuilder`, which is
	 * deleted. Summarizer mode still assembles its own payload below because it
	 * is a different shape, not a different prompt path.
	 */
	async compilePrompt(args: {}): Promise<PromptBuilderCompiledPrompt> {
		if (this.injectedPrompt) return this.injectedPrompt

		this.tokenLimit = await this.getContextTokenLimit()

		if (this.isSummarizerMode) {
			return await this.compileSummarizerPrompt(args)
		}

		throw new Error(
			"this adapter was asked to compile a prompt but was never handed one. " +
				"Every prompt is built by the pipeline and passed in through " +
				"withCompiledPrompt(); an adapter reaching this line means the " +
				"caller skipped that step."
		)
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
		// No `contextTokensEnabled` test: `sampling` arrives already resolved
		// (resolveSampling.ts), so a key being present IS the switch being on.
		// A config with it off simply has no `contextTokens` here, and 4096 is
		// what "the user did not say" has always meant.
		const limit = this.sampling.contextTokens
		return typeof limit === "number" && limit > 0 ? limit : 4096
	}

	/**
	 * Build a text-completion prompt string from a session-format messages
	 * array, for compileSummarizerPrompt() whose primary representation is
	 * `messages` but which — like the default character-perspective path —
	 * still needs to produce a real `prompt` on any text-completion
	 * connection. Without this, `prompt` was always left undefined here, so
	 * any connection not in session-completion mode (e.g. KoboldCPP's default)
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

		for (const msg of this.session.sessionMessages) {
			if (msg.isHidden) continue
			messages.push({
				role: msg.role === "assistant" ? "assistant" : "user",
				content: msg.content
			})
		}

		const useSessionFormat = !!args?.useSessionFormat
		const promptString = useSessionFormat
			? undefined
			: this.buildTextPromptFromMessages(messages)

		const totalTokens = await this.tokenCounter.countTokens(
			useSessionFormat ? JSON.stringify(messages) : promptString!
		)

		return {
			prompt: promptString,
			messages,
			meta: {
				promptFormat: useSessionFormat ? "session" : "text",
				templateName: "summarizer",
				timestamp: new Date().toISOString(),
				truncationReason: null,
				currentTurnCharacterId: null,
				tokenCounts: {
					total: totalTokens,
					limit: await this.getContextTokenLimit()
				},
				sessionMessages: {
					included: this.session.sessionMessages.filter(
						(m: SelectSessionMessage) => !m.isHidden
					).length,
					total: this.session.sessionMessages.length,
					includedIds: this.session.sessionMessages
						.filter((m: SelectSessionMessage) => !m.isHidden)
						.map((m: SelectSessionMessage) => m.id),
					excludedIds: this.session.sessionMessages
						.filter((m: SelectSessionMessage) => m.isHidden)
						.map((m: SelectSessionMessage) => m.id)
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
}

/**
 * What an endpoint can do beyond "complete text" (20 §9) — resolved per
 * adapter, refined per model where the backend can be asked.
 *
 *  - `native`: the API speaks tool calls itself.
 *  - `emulated`: SP formats the advertisement into the prompt and
 *    grammar-constrains/parses the reply (`jsonSchemaToGbnf` lineage) — tool
 *    calling *provided by SP* to models that never heard of it.
 *  - `probed`: per-model; ask the backend at health-check time and cache on
 *    the connection. Until a probe answers, treat as `emulated` — the tier
 *    that works everywhere.
 *  - `none`: and it says so, at bind time, as `needs-capability` — never as a
 *    garbage parse presented as a reply.
 */
export interface ConnectionCapabilities {
	toolUse: "native" | "emulated" | "probed" | "none"
}

export interface AdapterExports {
	Adapter: new (args: BaseConnectionAdapterParams) => BaseConnectionAdapter
	listModels: ListModelsFn
	testConnection: TestConnectionFn
	connectionDefaults: Record<string, any>
	samplingKeyMap: Record<string, string>
	/** Absent means `{ toolUse: 'emulated' }` — the everywhere tier. */
	capabilities?: ConnectionCapabilities
}
