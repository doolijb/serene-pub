import type { CompiledPrompt as PromptBuilderCompiledPrompt } from "./types"
import type { TokenCounters } from "../utils/TokenCounterManager"
import type { JsonSchemaNode } from "./jsonSchemaToGbnf"
import type {
	AdapterActions,
	TextGenResult,
	ToolCall,
	ToolDeclaration
} from "$lib/server/adapters/actions"
import { normalizeToolCall } from "./streamingToolCalls"
import {
	prepareAttachments,
	type AttachmentInput,
	type AttachmentPlan,
	type PreparedAttachment,
	type PrepareOptions
} from "$lib/server/adapters/attachments"
import { adapterIo } from "$lib/shared/connectionAdapters/manifest"
import type { AdapterIo } from "$lib/shared/connectionAdapters/io"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import { PromptBlockFormatter } from "$lib/shared/utils/PromptBlockFormatter"
import { promptFormatOf } from "$lib/shared/constants/PromptFormats"
import { getSupportedSamplers } from "$lib/shared/utils/samplerMappings"
import {
	completionTemplateOf,
	type CompletionTemplate
} from "$lib/shared/constants/completionTemplates"
import {
	wireModeFor,
	type WireMode
} from "$lib/shared/connectionAdapters/wireMode"
import { continueWireRefusal } from "$lib/shared/connectionAdapters/continueReply"
import type { ComposedStops } from "$lib/server/connections/stops"
import type { StreamingMode } from "$lib/server/connections/streaming"

export interface BasePromptSession extends SelectSession {
	sessionCharacters?: (SelectSessionCharacter & {
		character: SelectCharacter & { lorebook?: SelectLorebook }
	})[]
	sessionPersonas?: (SelectSessionPersona & {
		persona: SelectCharacter & { lorebook?: SelectLorebook }
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
		persona: SelectCharacter | null
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
					// characterId is a nullable FK (onDelete: "set null"), so the
					// populated relation can likewise be null, not just absent.
					character?: SelectCharacter | null
				})[]
		  })
		| null
}

/**
 * What shape the caller needs the response in.
 *
 * A contract for the RESPONSE, not a decoding preference — it must never be
 * implemented by reaching into the user's sampling config. Each adapter
 * translates it into whatever its service supports (a GBNF grammar, Ollama's
 * `format`, OpenAI's `response_format`, …) and ignores it when the service
 * supports nothing of the kind.
 */
export type ResponseFormat = "text" | "json"

/**
 * HOW this adapter will resume a partial reply — or that it will not.
 *
 * One entry point rather than a rule each adapter reimplements, because
 * "continue" is only a continuation when the model is handed the text so far
 * inside an OPEN assistant turn and writes the next characters of it. There are
 * exactly two ways to arrange that and one honest way to decline:
 *
 *   - `openBlock` — completion wire. The assembled prompt already ends with the
 *     seed block left open (`contextHandlebarsHelpers`,
 *     `includeClose: messageId !== -2`), and the adapter sends that string, so
 *     nothing further is required of it. Named anyway: "already correct" and
 *     "nobody checked" look identical from outside.
 *   - `prefill` — a chat protocol that takes a trailing assistant turn as one.
 *     Anthropic's Messages API is the only one this build speaks.
 *   - `none` — everything else, carrying the sentence saying why. An
 *     OpenAI-compatible endpoint in chat wire is the case that matters: a
 *     trailing `{role:"assistant"}` message goes to the chat template, and
 *     whether the model carries that turn on or opens a fresh one is the
 *     template's decision. Sending it anyway LOOKS like a continuation, produces
 *     a second beginning that `joinContinuation` glues onto the first, and
 *     reports nothing — which is exactly what naming this route removes.
 */
export type ContinuationRoute =
	| { kind: "openBlock" }
	| { kind: "prefill" }
	| { kind: "none"; reason: string }

/**
 * One exchange with a model service: what this adapter put on the wire, and
 * what came back.
 *
 * The receipt already carries the ASSEMBLED prompt and the stop record. What
 * neither can answer is what a given adapter rendered that into — prompt
 * format, role mapping, `options`, `format`/`response_format`, `stop`, `tools`
 * — and what the service replied before anything was parsed out of it. Both
 * are here, which is the difference between reading a run and running a proxy
 * in front of it.
 */
export interface WireExchange {
	request: {
		url: string
		/** The HTTP method, or the SDK call for a transport that is not HTTP. */
		method: string
		/** The body as the adapter built it, credentials replaced. */
		body: unknown
	}
	response: {
		status?: number
		/** The response text or the concatenated frames, up to the cap. */
		raw: string
		streamed: boolean
		/** How many frames a streamed response arrived in. */
		chunks?: number
		durationMs: number
		/** The cap took the rest of it. */
		truncated?: true
	}
	/** Every field this record replaced, by path. */
	redacted: string[]
}

/** What a raw response may hold before the rest is dropped. */
export const WIRE_RAW_LIMIT = 64 * 1024

/** What a credential is replaced with, wherever one is found. */
export const WIRE_REDACTED = "<redacted>"

/**
 * A field name that means a credential, anywhere in a body or a query string.
 *
 * Matched on the WHOLE name, so a sampler called `max_tokens` and KoboldCPP's
 * `genkey` — an id a later abort quotes back, not a secret — are untouched.
 */
const CREDENTIAL_KEY =
	/^(authorization|api[-_]?key|x[-_]api[-_]key|access[-_]?token|auth[-_]?token|token|secret|password|passwd|bearer|credential)s?$/i

/**
 * A value that is FILE BYTES rather than text — an attachment, base64'd into
 * the turn it belongs to.
 *
 * ⚠ **Bytes never enter a receipt.** That is `media.ts`'s rule and this record
 * is subject to it like everything else on a node output: a file travels as a
 * reference precisely so it is not copied into the receipt, the review payload
 * and every node in between. So an image in a body is replaced by a note of
 * its size.
 *
 * Told apart by ALPHABET, not by key name: four request formats spell the
 * field four ways (`data`, `images[]`, `image_url.url`, `b64_json`), and a
 * name list would be extended by whoever adds the fifth. Prose carries spaces
 * and punctuation, so a long run of base64 characters alone is not a prompt.
 */
const isEncodedBytes = (value: string): boolean =>
	value.length > 4096 &&
	(value.startsWith("data:") || /^[A-Za-z0-9+/]+={0,2}$/.test(value))

/** That note, in the units a reader thinks in. */
const elidedBytes = (value: string): string =>
	`<${Math.round(value.length / 1024)} KB of encoded bytes, not stored>`

/**
 * Copy a request body, replacing every credential with a placeholder and
 * naming what was replaced.
 *
 * A copy rather than a walk in place: the object handed here is the one about
 * to be sent, and a record that edited it would change the request it claims
 * to describe. A value that is not a plain object or array is kept as it is —
 * a `Buffer`, a `Date` and a class instance are values, not containers.
 */
function redactBody(
	value: unknown,
	path: string,
	redacted: string[],
	seen: WeakSet<object>
): unknown {
	if (typeof value === "string" && isEncodedBytes(value)) {
		redacted.push(path)
		return elidedBytes(value)
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) return "<cycle>"
		seen.add(value)
		return value.map((v, i) =>
			redactBody(v, `${path}[${i}]`, redacted, seen)
		)
	}
	if (
		!value ||
		typeof value !== "object" ||
		Object.getPrototypeOf(value) !== Object.prototype
	)
		return value
	if (seen.has(value)) return "<cycle>"
	seen.add(value)
	const out: Record<string, unknown> = {}
	for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
		const at = `${path}.${key}`
		if (CREDENTIAL_KEY.test(key)) {
			out[key] = WIRE_REDACTED
			redacted.push(at)
			continue
		}
		out[key] = redactBody(v, at, redacted, seen)
	}
	return out
}

/**
 * The URL with any credential in it replaced — a query parameter, or the
 * user:password some endpoints take in the authority.
 *
 * A URL this cannot parse is kept verbatim: a base URL somebody typed is not
 * always a URL, and a record that dropped it would lose the one fact a reader
 * opens this for.
 */
function redactUrl(url: string, redacted: string[]): string {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return url
	}
	if (parsed.username || parsed.password) {
		parsed.username = ""
		parsed.password = ""
		redacted.push("url.userinfo")
	}
	for (const [key] of [...parsed.searchParams]) {
		if (!CREDENTIAL_KEY.test(key)) continue
		parsed.searchParams.set(key, WIRE_REDACTED)
		redacted.push(`url.${key}`)
	}
	return parsed.toString()
}

/**
 * The record for one request, filled as the response is read.
 *
 * Exported so a test's stand-in adapter records the same shape the real ones
 * do rather than a literal of its own.
 */
export class WireRecorder {
	readonly exchange: WireExchange
	private readonly startedAt = Date.now()

	constructor(request: { url: string; method?: string; body: unknown }) {
		const redacted: string[] = []
		this.exchange = {
			request: {
				url: redactUrl(request.url, redacted),
				method: request.method ?? "POST",
				body: redactBody(request.body, "body", redacted, new WeakSet())
			},
			response: { raw: "", streamed: false, durationMs: 0 },
			redacted
		}
	}

	/** The status line, where the transport exposes one. */
	status(code: number): void {
		this.exchange.response.status = code
	}

	/** One streamed frame, as it is read. */
	frame(part: unknown): void {
		const response = this.exchange.response
		response.streamed = true
		response.chunks = (response.chunks ?? 0) + 1
		this.append(typeof part === "string" ? part : `${stringify(part)}\n`)
	}

	/** The whole response, in one piece. */
	received(body: unknown, status?: number): void {
		if (typeof status === "number") this.status(status)
		this.append(typeof body === "string" ? body : stringify(body))
	}

	private append(text: string): void {
		const response = this.exchange.response
		response.durationMs = Date.now() - this.startedAt
		const room = WIRE_RAW_LIMIT - response.raw.length
		if (room <= 0) {
			response.truncated = true
			return
		}
		if (text.length <= room) {
			response.raw += text
			return
		}
		response.raw += text.slice(0, room)
		response.truncated = true
	}
}

/** A frame as text, whatever it turned out to be. */
function stringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value)
	} catch {
		return String(value)
	}
}

// Generic interface for constructor parameters
export interface BaseConnectionAdapterParams {
	/**
	 * The row with its completion template dereferenced, where a resolver
	 * loaded it (`AdapterConnection`) — a plain `SelectConnection` is still
	 * accepted, and resolves against the built-ins exactly as the renderer
	 * does for the same input.
	 */
	connection: AdapterConnection
	sampling: ResolvedSampling
	/** The system prompt summarizer mode sends; read by nothing else. */
	systemPrompt?: string
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

export abstract class BaseConnectionAdapter implements AdapterActions {
	connection: AdapterConnection
	sampling: ResolvedSampling
	systemPrompt?: string
	session: BasePromptSession
	currentCharacterId: number | null
	isAborting = false
	isSummarizerMode = false
	isNarratorResponseMode = false
	generatingMessageMetadata: any = {}
	// Set directly by the caller (not a constructor param — it's
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
	 * are answered by different services at different fidelities, and every
	 * adapter already branches on the first. An adapter whose service cannot
	 * take a schema ignores this and falls back to plain JSON mode — the same
	 * graceful-degradation rule responseFormat already follows, so adding a
	 * schema can never make a working service worse.
	 *
	 * Services split three ways: the llama.cpp family compiles it to GBNF via
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
		systemPrompt,
		session,
		currentCharacterId,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent,
		generatingMessageMetadata = {}
	}: BaseConnectionAdapterParams) {
		this.connection = connection
		this.sampling = sampling
		this.systemPrompt = systemPrompt
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
	 * reaches exactly the same `generateText()`.
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
	 *
	 * ⚠ **`args` is empty and must stay empty.** It used to carry
	 * `useChatFormat`, set by six one-line `compilePrompt` overrides from each
	 * adapter's own `extraJson` flag — and the pipeline never reached any of
	 * them, because `withCompiledPrompt` returns above before the argument is
	 * read. That is the defect wire mode replaced: a per-call answer to a
	 * question the connection has to answer once, for the render and the send
	 * together. Anything put back here would be invisible on the path that
	 * matters, exactly as that flag was.
	 */
	async compilePrompt(args: {}): Promise<PromptBuilderCompiledPrompt> {
		if (this.injectedPrompt) return this.injectedPrompt

		this.tokenLimit = await this.getContextTokenLimit()

		if (this.isSummarizerMode) {
			return await this.compileSummarizerPrompt()
		}

		throw new Error(
			"this adapter was asked to compile a prompt but was never handed one. " +
				"Every prompt is built by the pipeline and passed in through " +
				"withCompiledPrompt(); an adapter reaching this line means the " +
				"caller skipped that step."
		)
	}

	// ── Actions ─────────────────────────────────────────────────────────────
	//
	// The named, individually-typed things an adapter can be asked to do. Every
	// signature comes from `AdapterActions` and none is written twice, because
	// what a backend accepts in and returns out is DERIVED from which of these a
	// class implements (`$lib/shared/connectionAdapters/actions`) — an inference
	// that is only sound while a method's name pins its in and out kinds.
	//
	// This replaced one `abstract generate()`: a single generically-named method
	// whose contract was whatever the subclass made of it, sitting beside a
	// hand-written manifest that was free to disagree with it. The identifier
	// `generate` now names nothing in either adapter family, and a shim
	// delegating to `generateText` must never be added — a surviving `generate`
	// is precisely the one-name-two-contracts state this removed.

	/**
	 * Write a reply. `text->text`, and the one action a text adapter must have.
	 *
	 * ⚠ Its inputs still arrive through the CONSTRUCTOR (session, sampling,
	 * systemPrompt, the injected prompt) rather than as a parameter, so this
	 * satisfies "expected in, expected out" formally — the signature is fixed by
	 * the action, which is what the derivation needs — but not literally the way
	 * `generateImage(req, opts)` does. Collapsing the ten-param constructor into
	 * a request object is the real fix and is deliberately a separate change: it
	 * touches every subclass's construction, five per-generation fields, eight
	 * integration-test fakes and some forty test sites, and doing it inside a
	 * rename would swamp the rename.
	 */
	abstract generateText(): Promise<TextGenResult>

	/**
	 * The other five actions, DECLARED and never defined.
	 *
	 * Declaring them here is what fixes their signatures: a subclass that grows
	 * one must match the type, so no adapter can repurpose `embedText` to return
	 * something else. Their absence from a concrete class is a STATEMENT — the
	 * capability panel renders no row, the picker never offers the connection for
	 * a slot that needs it, and a bind is refused with a sentence naming the
	 * capability.
	 *
	 * ⚠ `declare` is load-bearing, twice over.
	 *
	 * It emits nothing. `useDefineForClassFields` is unset with `target:"esnext"`
	 * in `.svelte-kit/tsconfig.json`, so it DEFAULTS TO TRUE — a plain optional
	 * property here would emit a class field initialized to `undefined`, an OWN
	 * property SHADOWING every subclass's prototype method. Every action would
	 * read as unimplemented at runtime while type-checking perfectly clean, and
	 * the conformance test would go green on a lie.
	 *
	 * And there must never be a BODY, not even a throwing `NotImplemented` stub.
	 * A stub puts the method on every prototype, makes `"embedText" in adapter`
	 * useless, and forces a `Ctor.prototype.x !== Base.prototype.x` comparison
	 * TypeScript cannot see. With no base bodies the inherited-versus-overridden
	 * question does not arise at all.
	 */
	// The optional actions are merged in as an INTERFACE below the class, not
	// declared here as properties — see the note on that declaration.

	// ── Lifecycle (not actions) ─────────────────────────────────────────────
	//
	// `abort` and `preflight` are how a run is managed, not what it produces, so
	// they derive no capability and belong to neither `AdapterActions` nor the
	// manifest's key space.

	abort() {
		this.isAborting = true
	}

	/**
	 * Optional hook run by the LLM queue before generateText() is invoked, e.g.
	 * koboldcpp's managed-mode subprocess start + model load. No-op by default.
	 */
	async preflight(_signal?: AbortSignal): Promise<void> {}

	// ── Attachments (not an action either) ──────────────────────────────────
	//
	// Format negotiation and limit enforcement, in the ONE place every text
	// adapter funnels through — which is the whole reason it is here rather than
	// in each of the seven. `attachments` is a list because interleaving is
	// ordered, so seven copies of this would be seven chances for one of them to
	// regroup the list and hand a model the pictures in the wrong order.
	//
	// Not an action, and it derives no capability: whether images may flow at all
	// is `text+image->text` in the manifest's `supports`, resolved through the
	// four layers. This is what happens to files that are already permitted.

	/**
	 * What this connection's TYPE declares about files: how many, how big, in
	 * what formats.
	 *
	 * Read from the static manifest rather than from the instance, because these
	 * are properties of the wire format. `undefined` means nothing is declared,
	 * which every reader downstream treats as "no known limit".
	 */
	protected get io(): AdapterIo | undefined {
		return adapterIo(this.connection?.type ?? "")
	}

	/**
	 * The files travelling with this request, in the order they were handed over.
	 *
	 * Set by the substrate before dispatch — `dispatch.ts` resolves the run's
	 * `attachments` port from media REFERENCES into these bytes and hands them
	 * here, the same way `withCompiledPrompt` hands over a payload built
	 * elsewhere. An adapter never resolves a reference itself: see the note on
	 * `prepareAttachments` below for why the database must stay out of this
	 * import graph, and `dispatch.ts` for the access check that comes with
	 * turning a uuid into bytes.
	 *
	 * Empty is the overwhelming case and means exactly nothing to do.
	 */
	private suppliedAttachments: readonly AttachmentInput[] = []

	/** Hand over the files this request carries. Returns the adapter so a
	 *  dispatch site reads as one expression, like `withCompiledPrompt`. */
	withAttachments(inputs: readonly AttachmentInput[]): this {
		this.suppliedAttachments = inputs
		return this
	}

	/** What was handed over, in order. */
	protected get attachments(): readonly AttachmentInput[] {
		return this.suppliedAttachments
	}

	/**
	 * 🚧 The files each MESSAGE carries (PLAN-composer-attachments §3.5), by
	 * index into the compiled prompt's `messages` — a history line's image on
	 * that line's own turn, where the request-level list above all lands on
	 * the last user turn. `dispatch.ts` lifts them off the messages (so no
	 * adapter ever puts an `attachments` key on a wire) and hands them here.
	 */
	private suppliedMessageAttachments: readonly (readonly AttachmentInput[])[] =
		[]

	/** Hand over the per-message files, indexed like `compiledPrompt.messages`. */
	withMessageAttachments(
		perMessage: readonly (readonly AttachmentInput[])[]
	): this {
		this.suppliedMessageAttachments = perMessage
		return this
	}

	/** Whether this request carries any file, request-level or per message. */
	protected get carriesAttachments(): boolean {
		return (
			this.suppliedAttachments.length > 0 ||
			this.suppliedMessageAttachments.some((list) => list?.length)
		)
	}

	/**
	 * Every file this request carries, prepared ONCE over the flattened,
	 * ordered list — so counts and request bytes are checked for the whole
	 * request (`prepareAttachments`) — and split back by message, aligned with
	 * `messages`.
	 *
	 * Two placement rules, the same for every sender:
	 *
	 *  - the request-level files go on the LAST user turn (what a vision step
	 *    is asked about), after that turn's own;
	 *  - a file travels on a USER turn. Chat APIs take images on user turns
	 *    only (OpenAI and Anthropic reject them on an assistant turn), so a
	 *    file on a character's or a system line moves to the next user turn,
	 *    else the previous one. A request with files and no user turn at all
	 *    is refused, never sent without them.
	 *
	 * A refusal from the engine leaves as a throw carrying its sentence.
	 */
	protected async filesByMessage(
		messages: readonly { role?: unknown }[],
		opts?: PrepareOptions
	): Promise<PreparedAttachment[][]> {
		const out = messages.map(() => [] as PreparedAttachment[])
		if (!this.carriesAttachments) return out
		const isUser = (i: number) => messages[i]?.role === "user"
		const userTurnFor = (i: number): number => {
			if (i >= 0 && i < messages.length && isUser(i)) return i
			for (let j = Math.max(0, i + 1); j < messages.length; j++)
				if (isUser(j)) return j
			for (let j = Math.min(i, messages.length) - 1; j >= 0; j--)
				if (isUser(j)) return j
			return -1
		}
		const owners: number[] = []
		const inputs: AttachmentInput[] = []
		messages.forEach((_m, i) => {
			for (const file of this.suppliedMessageAttachments[i] ?? []) {
				owners.push(i)
				inputs.push(file)
			}
		})
		const lastUser = userTurnFor(messages.length)
		for (const file of this.suppliedAttachments) {
			owners.push(lastUser)
			inputs.push(file)
		}
		if (owners.some((i) => userTurnFor(i) < 0))
			throw new Error(
				"this request carries files but no user turn to put them on, and chat APIs take files only on " +
					"a user turn. It is not sent without them."
			)
		const plan = await this.prepareAttachments(inputs, opts)
		if (!plan.ok) throw new Error(plan.reason)
		plan.files.forEach((file, k) => out[userTurnFor(owners[k])]!.push(file))
		return out
	}

	/**
	 * 🚧 The chat messages with their files as OpenAI content parts
	 * (PLAN-composer-attachments §3.6) — the shape OpenAI's
	 * `/chat/completions`, KoboldCPP's and llama-server's
	 * `/v1/chat/completions` all take: a turn with files becomes
	 * `content: [{type:"image_url", image_url:{url:"data:…;base64,…"}}…, {type:"text", text}]`,
	 * files first, the text part omitted when the turn has none. A turn with no
	 * files is the SAME object. Measured against `requestWithoutFiles` — the
	 * request as it stands before the files go in, base64 on the wire.
	 *
	 * Images only: none of these declare a document format, so the reading
	 * rule never places a PDF on them, and one that arrives anyway is refused
	 * naming the file rather than sent as something it is not.
	 */
	protected async openAIChatMessagesWithFiles<
		M extends { role?: unknown; content?: unknown }
	>(messages: readonly M[], requestWithoutFiles: unknown): Promise<M[]> {
		const files = await this.filesByMessage(messages, {
			transport: "base64",
			overheadBytes: Buffer.byteLength(JSON.stringify(requestWithoutFiles))
		})
		let n = 0
		return messages.map((msg, i) => {
			const own = files[i] ?? []
			if (!own.length) return msg
			const parts = own.map((file) => {
				n++
				if (file.kind !== "image")
					throw new Error(
						`${file.filename ?? `attachment ${n}`} is ${file.mime}, and this connection type sends only ` +
							`images alongside a prompt. It is not sent rather than sent as something it is not.`
					)
				return {
					type: "image_url" as const,
					image_url: {
						url: `data:${file.mime};base64,${file.bytes.toString("base64")}`
					}
				}
			})
			const text = typeof msg.content === "string" ? msg.content : ""
			return {
				...msg,
				content: [...parts, ...(text ? [{ type: "text" as const, text }] : [])]
			}
		})
	}

	// ── Stop sequences (not an action either) ───────────────────────────────

	/**
	 * The stop sequences this request will send, already composed and already
	 * filtered by the wire rule.
	 *
	 * ⚠ **An adapter never builds these.** Four of them used to carry the same
	 * `StopStrings.get` + `Handlebars.compile` block and a fifth a ternary of its
	 * own, and the five disagreed about the one thing that matters — whether a
	 * completion template's delimiters belong on a chat request. They do not, and
	 * Ollama sent them anyway. The composition is `connections/stops.ts` now
	 * (ruling 2026-09-10), called at each of the FOUR places this app constructs
	 * a text adapter — `pipelines/runtime/dispatch.ts`,
	 * `utils/summarizer/index.ts`, `utils/graphBuilder.ts` and
	 * `pipelines/runtime/dispatchStep.ts` — and an adapter's whole remaining job
	 * is to put `this.stops` in whatever its service calls the field.
	 *
	 * ⚠ A site that forgets `withStops` sends NO stop sequences, and nothing
	 * errors: the model simply runs on. `connections/stopsWiring.test.ts` reads
	 * the tree and fails on a construction site that never hands one over, which
	 * is the guard that makes this arrangement safe to have.
	 *
	 * Set through a `withX` seam rather than a constructor param, deliberately:
	 * every subclass declares its own inline destructured param list, so a field
	 * added to `BaseConnectionAdapterParams` reaches none of them and TypeScript
	 * says nothing — the same hazard `responseFormat` documents above, avoided
	 * the same way.
	 */
	private suppliedStops?: ComposedStops

	/**
	 * Hand over the composed list. Returns the adapter so a construction site
	 * reads as one expression, like `withCompiledPrompt` and `withAttachments`.
	 */
	withStops(stops: ComposedStops): this {
		this.suppliedStops = stops
		return this
	}

	/**
	 * What goes on the wire, as the flat list every service's field wants.
	 *
	 * Empty when nothing was handed over, and that is the honest answer rather
	 * than a fallback composition: a caller that skipped `withStops` has a wiring
	 * bug, and an adapter quietly composing its own list is exactly what put a
	 * chat request's native stop tokens at risk for a release.
	 */
	protected get stops(): string[] {
		return (this.suppliedStops?.sent ?? []).map((s) => s.value)
	}

	/** The tagged list, kinds and all — for a caller recording the receipt. */
	get composedStops(): ComposedStops | undefined {
		return this.suppliedStops
	}

	// ── Streaming (not an action either) ────────────────────────────────────

	/**
	 * The node's own answer to whether this request streams — `auto | off`, off
	 * the provider node's `params` slot.
	 *
	 * `auto` by default, and `auto` means **this adapter decides as it always
	 * did**: the connection's `extraJson.stream`, whose default differs per
	 * service. So an adapter consults `streamingOn()` rather than reading the
	 * flag directly, and a caller that hands nothing over gets the wire it got
	 * before the parameter existed.
	 *
	 * Set through a `withX` seam for the reason `withStops` is — every subclass
	 * declares its own inline destructured parameter list, so a field added to
	 * `BaseConnectionAdapterParams` reaches none of them and TypeScript says
	 * nothing.
	 */
	private streamingMode: StreamingMode = "auto"

	/**
	 * Hand over the node's mode. Returns the adapter so a construction site
	 * reads as one expression, like `withStops` and `withCompiledPrompt`.
	 *
	 * ⚠ Called by a dispatch only for `off`. `auto` IS this adapter's own
	 * answer, so a second way to spell "leave it alone" would be a second place
	 * for the two to disagree.
	 */
	withStreaming(mode: StreamingMode): this {
		this.streamingMode = mode
		return this
	}

	/**
	 * Does this request stream, given what the CONNECTION says?
	 *
	 * The one expression each adapter's `const stream = …` line calls, so the
	 * per-service default stays in the adapter that owns it and the override
	 * cannot be applied six different ways. `off` wins; `auto` returns the
	 * connection's answer untouched, never widening it to true.
	 */
	protected streamingOn(fromConnection: boolean): boolean {
		return this.streamingMode === "off" ? false : fromConnection
	}

	/**
	 * Which stop sequence the service says it actually matched, when it says.
	 *
	 * Set by the adapter after a generation, read by the dispatch afterwards —
	 * a property rather than a field on `TextGenResult` because a streaming
	 * adapter only learns this while the caller is draining the stream, which is
	 * after `generateText()` has already returned.
	 *
	 * Only llama.cpp reports the WORD (`stopping_word`). Ollama and KoboldCPP
	 * report a reason (`done_reason`, `finish_reason`) and LM Studio a stop-reason
	 * enum — none of which names the sequence — so this stays undefined there
	 * rather than being filled with something that is not a stop sequence.
	 */
	stopHit?: string

	/**
	 * Set by `generateText()` when this request asked a chat TEMPLATE to open a
	 * reasoning block and the service returns that block's text inline on the
	 * content channel — so the model's first token may already be reasoning,
	 * with only the close ever generated. Read once by the dispatch, after
	 * `generateText()` returned and before the stream is drained, as
	 * {@link reasoningOpening}.
	 *
	 * False everywhere a service separates the trace itself (Ollama's
	 * `message.thinking`, llama.cpp's parser, Anthropic's blocks): there the
	 * content channel is the body from its first token.
	 */
	protected reasoningRequestedInline = false

	/** See {@link reasoningRequestedInline}; `splitReasoningStream`'s opening. */
	get reasoningOpening(): "requested" | undefined {
		return this.reasoningRequestedInline ? "requested" : undefined
	}

	/**
	 * What the service said ended the generation, in the service's own word:
	 * `done_reason`, `finish_reason`, a stop-reason enum.
	 *
	 * A property rather than a field on `TextGenResult`, for the reason
	 * `stopHit` is one — a stream reports it on its last frame, long after
	 * `generateText()` returned. It is the answer to "was that the whole reply
	 * or did it hit the length cap", and it names the SERVICE's category rather
	 * than a stop sequence, so the two never stand in for each other.
	 *
	 * Undefined on a service that says nothing, which is a different finding
	 * from a reply that ran to a natural stop.
	 */
	finishReason?: string

	// ── What this request could not carry ───────────────────────────────────

	/**
	 * Samplers the config switched ON that this request left out, by their
	 * vocabulary name.
	 *
	 * ⚠ **Per REQUEST, and that is why the key maps are not enough.** The
	 * config panel's "not sent to this backend" note reads
	 * `getSupportedSamplers`, which answers a question about a connection TYPE
	 * — a fact a form can know before anything is sent. These are the ones only
	 * the send knows: a reasoning level a model does not take in words, a
	 * reasoning budget on a service that counts in words, temperature on an
	 * Anthropic request that turned thinking on. Every one of them is a control
	 * a person set and a request that does not carry it, which is the failure
	 * this whole area exists to stop being silent.
	 *
	 * Reaches the receipt through `ctx.reportSampling` — the same channel image
	 * renders already report `applied`/`ignored` on — so `samplingIgnored` says
	 * it beside the exchange that proves it.
	 */
	private readonly samplersIgnored = new Set<string>()

	/** Say that this request left a switched-on sampler out. Idempotent. */
	protected noteIgnoredSampler(...keys: readonly string[]): void {
		for (const key of keys) this.samplersIgnored.add(key)
	}

	/** What was left out, in the order it was noted. */
	get ignoredSamplers(): string[] {
		return [...this.samplersIgnored]
	}

	/**
	 * What this request carried and what it could not — the pair
	 * `OracleCtx.reportSampling` takes.
	 *
	 * `applied` is read through the key map rather than accumulated at each
	 * assignment: the map IS this app's answer to "which of the vocabulary's
	 * names does this backend honour", and a second, hand-maintained answer
	 * would be the one that drifts.
	 */
	get samplingReport(): {
		applied: Record<string, unknown>
		ignored: string[]
	} {
		const supported = getSupportedSamplers(this.connection.type)
		const applied: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(this.sampling))
			if (supported.has(key) && !this.samplersIgnored.has(key))
				applied[key] = value
		return { applied, ignored: this.ignoredSamplers }
	}

	// ── The wire (not an action either) ─────────────────────────────────────

	/**
	 * Every exchange this adapter has made, in the order it made them.
	 *
	 * One per call an adapter sends, so a class that makes two reaches its
	 * caller as two — `dispatch.ts` publishes them as `wire.calls[]` rather
	 * than keeping the last and dropping the rest.
	 */
	private readonly wireCalls: WireExchange[] = []

	/** What this adapter put on the wire, in order. */
	get exchanges(): readonly WireExchange[] {
		return this.wireCalls
	}

	/**
	 * The most recent exchange: the request as this class rendered it, and the
	 * response as it arrived.
	 *
	 * ⚠ **Connection material by construction.** A request cannot be described
	 * without naming where it went, so this carries the base URL, the model id
	 * and the body. It rides to a receipt under the key `wire`, which
	 * `withoutConnectionIdentity` removes at every egress for anyone who is not
	 * an administrator — the same arrangement the node output's `connection`
	 * key has. Nothing here is a declared out-port.
	 *
	 * Headers are never stored: an `Authorization` header is where most of
	 * these services carry their credential, and a record that could hold one
	 * is a record that will.
	 */
	get lastExchange(): WireExchange | undefined {
		return this.wireCalls[this.wireCalls.length - 1]
	}

	/**
	 * Open a record for the request about to go out, and keep it filled as the
	 * response is read.
	 *
	 * The one helper every adapter calls, so six classes differ only in where
	 * the call goes: the redaction, the cap and the timing are decided here and
	 * cannot be six different answers.
	 */
	protected beginExchange(request: {
		url: string
		method?: string
		body: unknown
	}): WireRecorder {
		const recorder = new WireRecorder(request)
		this.wireCalls.push(recorder.exchange)
		return recorder
	}

	/**
	 * Does THIS CLASS have code that puts attachments on the wire?
	 *
	 * ⚠ Not a capability claim, and it must never be read as one. Whether a
	 * connection may send images is `text+image->text` in the manifest, resolved
	 * through the four layers, and it is deliberately per-MODEL rather than
	 * per-class (see `HOSTED_BY` in `$lib/shared/connectionAdapters/actions`: the
	 * class is the same whichever model is loaded). This answers the narrower,
	 * purely mechanical question a DISPATCH has to ask before handing files over
	 * — is there anything in here that would send them?
	 *
	 * The two genuinely differ today: several entries declare vision in
	 * `supports` because their API format has it, while their adapter class has
	 * no image code at all. Handing those files anyway would drop them
	 * silently, and a reply about pictures the model never saw is
	 * indistinguishable from a model ignoring them — the failure this whole area
	 * is arranged to prevent. So `dispatch.ts` refuses on a false here rather
	 * than sending a request that has quietly lost its attachments.
	 */
	get consumesAttachments(): boolean {
		return false
	}

	// ── Tools (20 §9) ───────────────────────────────────────────────────────

	/**
	 * The tool declarations this request offers the model, already normalized
	 * by `advertise-tools` to `{ name, description, parameters }`.
	 *
	 * Set through a `withX` seam for the same reason `withStops` is — a field
	 * added to `BaseConnectionAdapterParams` reaches none of the subclasses'
	 * inline destructured parameter lists, and TypeScript says nothing.
	 *
	 * Empty is the overwhelming case and means the request carries no tools at
	 * all, which is what every pipeline that is not a tool loop sends.
	 */
	private suppliedTools: readonly ToolDeclaration[] = []

	/** Hand over what this request offers. Returns the adapter, like its siblings. */
	withTools(tools: readonly ToolDeclaration[]): this {
		this.suppliedTools = tools
		return this
	}

	/** What was handed over, in the order it will be advertised. */
	protected get tools(): readonly ToolDeclaration[] {
		return this.suppliedTools
	}

	/**
	 * Does THIS CLASS have code that puts tools on the wire?
	 *
	 * The exact twin of `consumesAttachments`, and it carries the same warning:
	 * **not a capability claim**. Whether a connection may use tools is `tools`
	 * in the manifest, resolved through the four layers and gradeable as
	 * `emulated` — which is the prompt door, a thing this app supplies over a
	 * backend that never heard of tools, and needs no adapter code at all.
	 * This answers the narrower mechanical question a dispatch must ask before
	 * handing declarations over: is there anything in here that would send
	 * them?
	 *
	 * `dispatch.ts` refuses on a false rather than sending a request that has
	 * quietly lost its tools, because a model that was never offered one and a
	 * model that declined one return the same empty answer.
	 */
	get consumesTools(): boolean {
		return false
	}

	/**
	 * Normalize whatever a service called its tool call into the one shape the
	 * pipeline speaks — `{ tool, args }`, the same `parse-tool-call` publishes.
	 *
	 * Here rather than three times over because the three services differ only
	 * in where the name and the arguments sit, and one of them (OpenAI) sends
	 * the arguments as a JSON **string**. An adapter that forgot to parse that
	 * would hand a tool its own arguments as one long string parameter, which
	 * looks like a model mistake.
	 */
	protected toolCallFrom(name: unknown, args: unknown): ToolCall | null {
		return normalizeToolCall(name, args)
	}

	/**
	 * The tool call a STREAMING request produced, once the stream has been
	 * drained.
	 *
	 * Set by the adapter while the caller runs the stream, read by the dispatch
	 * afterwards — a property rather than a field on `TextGenResult` for exactly
	 * the reason `stopHit` above is one: the result object was returned before
	 * the first delta arrived, so it cannot carry a fact that does not exist
	 * yet. Without it a connection with `extraJson.stream` surfaced no call, a
	 * tool loop's predicate never fired, and the loop ran to its ceiling.
	 *
	 * `null` after a stream that called nothing, and `undefined` on an adapter
	 * with no streaming tool code at all — the same distinction
	 * `TextGenResult.toolCall` draws, so `?? null` at the read site is correct
	 * for both.
	 */
	streamedToolCall?: ToolCall | null

	/**
	 * Token accounting a STREAMING request reported, once the stream has been
	 * drained — the twin of `streamedToolCall`, for the same reason.
	 *
	 * Absent on every stream that reported nothing, which is most of them: the
	 * OpenAI envelope carries `usage` on a stream only when the request asked
	 * for it (`stream_options.include_usage`, which this app does not send), so
	 * this fills from a proxy that volunteers it and from Anthropic, whose
	 * `message_start` carries both cache halves unasked.
	 */
	streamedUsage?: {
		tokensPrompt?: number
		tokensCached?: number
		tokensCacheWrite?: number
		tokensCompletion?: number
		/** The reasoning half of the completion count — see `TextGenResult`. */
		tokensReasoning?: number
	}

	/**
	 * Merge one chunk's worth of accounting in, keeping what was already said.
	 *
	 * ⚠ Merged rather than assigned: the two halves arrive on DIFFERENT events
	 * on Anthropic — the read count on `message_start`, the write count possibly
	 * later — and an assignment would drop whichever came first.
	 */
	protected recordStreamedUsage(usage: {
		tokensPrompt?: number
		tokensCached?: number
		tokensCacheWrite?: number
		tokensCompletion?: number
		tokensReasoning?: number
	}): void {
		const given = Object.entries(usage).filter(([, v]) => v !== undefined)
		if (!given.length) return
		this.streamedUsage = {
			...(this.streamedUsage ?? {}),
			...Object.fromEntries(given)
		}
	}

	/**
	 * Negotiate formats and enforce limits for a set of attachments, in order.
	 *
	 * ⚠ Takes BYTES, not `MediaRef`s. Loading a ref needs the media module, which
	 * needs the database, and dragging that into every adapter's import graph to
	 * read four numbers is exactly the shape the lazy-adapter architecture exists
	 * to avoid. The caller has already fetched the bytes it wants to send.
	 *
	 * ⚠ Conversion runs BEFORE the byte checks, and that ordering is the point —
	 * see the header of `$lib/server/adapters/attachments`. A refusal comes back
	 * as a VALUE, so an adapter cannot forget to look at it.
	 */
	protected async prepareAttachments(
		inputs: readonly AttachmentInput[],
		opts?: PrepareOptions
	): Promise<AttachmentPlan> {
		return prepareAttachments(this.io, inputs, opts)
	}

	/**
	 * The completion template this connection renders in and stops on.
	 *
	 * ## One resolution, read by both halves
	 *
	 * A format's delimiters and its stop strings are the same fact, and the
	 * failure mode when they disagree has no error attached to it: the prompt
	 * goes out wrapped in one set of markers, the model is told to stop on
	 * another, and it simply never stops. That reads as a bad model. So the
	 * markers `buildTextPromptFromMessages` wraps a block in and the stop
	 * strings every adapter sends both come from THIS expression — not from two
	 * spellings that have to be kept in step. (`OllamaAdapter` alone used to
	 * carry two of them, `|| "chatml"` and `|| "vicuna"`, in one file.)
	 *
	 * ## Why a row and not a key
	 *
	 * `completionTemplateOf` resolves a bare key against the BUILT-INS, so a
	 * key is only ever enough for the eight shipped formats: a template an admin
	 * authored named none of them and resolved to the default, which is the
	 * whole defect this accessor exists to close. The row is dereferenced from
	 * `completion_templates` where the connection is LOADED
	 * (`withCompletionTemplate`) and arrives here on `this.connection` — no
	 * database enters an adapter and nothing here becomes async.
	 *
	 * ## The absent case
	 *
	 * A connection that never went through a resolver — a unit test's literal,
	 * `connections:test` on unsaved form state — carries no template, and this
	 * falls back to `completionTemplateOf(promptFormatOf(key))`. That is the
	 * SAME expression `renderers.ts` falls back to for the same input, which is
	 * what makes a render/stop disagreement unreachable rather than unlikely:
	 * all three absent states (never set, cleared to `""`, and a key whose row
	 * is gone) answer with the default on both sides.
	 */
	/**
	 * Which METHOD this connection wants to be called by: `chat` (role-tagged
	 * messages) or `completion` (one flat prompt string).
	 *
	 * ## What this replaced, and why it must never go back
	 *
	 * Every adapter used to answer this from a flag of its own —
	 * `extraJson.useChat` on KoboldCPP, Ollama and LM Studio,
	 * `extraJson.prerenderPrompt` on OpenAI, an unconditional `true` on Anthropic
	 * — and read it inside `compilePrompt(args)`. The pipeline hands its payload
	 * over through `withCompiledPrompt`, which returns before `compilePrompt`
	 * ever looks at its argument, so on a pipeline run the flag was never set and
	 * the adapter branched on a default that disagreed with the payload it had.
	 * Anthropic sent the literal word "Hello" off its empty-messages floor;
	 * KoboldCPP posted `/v1/chat/completions` with no `messages` key at all.
	 *
	 * It is a connection CAPABILITY now, resolved through the same four layers as
	 * every other one — adapter declaration, preset, probe, hand-set override,
	 * with the override winning. The provider node stays blind: it asks for
	 * `text->text` and the connection answers how it wants to be called.
	 *
	 * ## Synchronous, and no database
	 *
	 * The same shape as `completionTemplate` above and for the same reasons. The
	 * resolution happens in `withWireMode()` where the connection is LOADED
	 * (`connections/capabilityTarget.ts`, `pipelines/config/stepConfig.ts`) and
	 * arrives here on `this.connection` — no adapter gains a `db`, no
	 * construction site gains a parameter, and nothing here becomes async.
	 *
	 * ## The absent case
	 *
	 * A connection that never went through a resolver — a unit test's literal,
	 * `connections:test` on unsaved form state — carries no mode, and
	 * `wireModeFor` answers from the row's own cached set and then from what its
	 * TYPE declares. That fallback is exact rather than approximate, which is the
	 * one way this differs from `completionTemplate`: the delimiters genuinely
	 * live in a table an adapter cannot read, while everything wire mode is
	 * resolved from is already on the row.
	 */
	protected get wireMode(): WireMode {
		return (
			this.connection?.wireMode ??
			wireModeFor(
				this.connection?.type,
				(this.connection?.capabilities as { resolved?: any } | null)
					?.resolved
			)
		)
	}

	/** Role-tagged messages go on the wire, rather than one flat prompt string. */
	protected get isChatWire(): boolean {
		return this.wireMode === "chat"
	}

	/**
	 * How this adapter continues a partial reply — resolved once, here.
	 *
	 * ## Derived from data, not overridden per class
	 *
	 * The obvious shape for "Anthropic can prefill and the others cannot" is a
	 * hook each adapter overrides, and it is the wrong one: the same fact is
	 * needed by the capability panel and by the verb that refuses the button, and
	 * neither may load an adapter module (`@lmstudio/sdk` cannot be PARSED on
	 * Android). So the fact lives in the static manifest — `continuesIn`, per
	 * type — and this reads it, which is the same arrangement `wireMode` uses and
	 * for the same reason. A subclass that needed to differ would override this
	 * getter, and the conformance test would then be the thing that noticed.
	 *
	 * ## What it does NOT answer
	 *
	 * Whether this connection MAY be continued. That is the `continue_reply`
	 * capability, resolved through the four layers, and it is asked once —
	 * server-side, before the turn starts, by `extendVerbRefusal`. Asking it
	 * again here would mean reading `capabilities.resolved`, which is a CACHE an
	 * older build wrote and which an adapter has no way to refresh; the two
	 * readings would then disagree exactly on upgrading installs.
	 */
	protected get continuationRoute(): ContinuationRoute {
		const reason = continueWireRefusal(this.connection?.type, this.wireMode)
		if (reason) return { kind: "none", reason }
		return this.isChatWire ? { kind: "prefill" } : { kind: "openBlock" }
	}

	protected get completionTemplate(): CompletionTemplate {
		return completionTemplateOf(
			this.connection?.completionTemplate ??
				promptFormatOf(this.connection?.promptFormat)
		)
	}

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
	 * any connection not in chat-completion mode (e.g. KoboldCPP's default)
	 * silently generated from an empty prompt — the exact bug Narrator
	 * response had until it was fixed by delegating into the shared
	 * context-block pipeline instead; summarizer mode intentionally stays
	 * minimal (no lore/character context), so it needs this narrower fix
	 * rather than that same delegation.
	 */
	private buildTextPromptFromMessages(messages: any[]): string {
		// The resolved ROW, and the SAME one the stop strings come from — see
		// `completionTemplate`. This read the key alone, which resolves against
		// the built-ins: an admin authored delimiters, the summarizer wrapped
		// its blocks in the DEFAULT's markers instead, and the stop strings
		// (also from the key) agreed with each other and with nothing the model
		// was actually sent.
		const format = this.completionTemplate
		const blocks = messages.map((msg) =>
			PromptBlockFormatter.makeBlock({
				format,
				role: msg.role === "system" ? "system" : msg.role,
				content: msg.content
			})
		)
		// The continuation seed — an open assistant block for the model to
		// write into — UNLESS the last message already is one.
		//
		// The summarizer's array always ends on a user turn, so this is the
		// unconditional push it has always been for that caller. What changed is
		// that a pipeline-built payload can now arrive here (`promptTextFor`
		// below), and an assembled session prompt already ends with the seed
		// turn: pushing a second opener would tell the model to start a reply
		// twice.
		const last = messages[messages.length - 1]
		if (last?.role !== "assistant")
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
	 * The text-completion prompt for a payload, whatever shape it arrived in.
	 *
	 * A compiled prompt carries `prompt` **or** `messages`, and which one
	 * depends on the connection's own format: split-chat renders a role
	 * array, everything else renders one string. An adapter's text-completion
	 * branch reads `prompt` — and read it as `compiledPrompt.prompt!`, so a
	 * payload built for a chat endpoint sent the backend `undefined`, which
	 * generates from nothing and reads as a model fault.
	 *
	 * That was unreachable while the pipeline could not produce a role array at
	 * all: the connection's format never reached the render, so every payload
	 * was a flat string. Restoring that wire (assemble's `connection` slot) is
	 * what makes this method necessary, and the shape it has to survive is a
	 * connection whose format is `split_chat` bound to an adapter branch that
	 * wants text — a contradictory configuration that is nonetheless reachable,
	 * because the format and the endpoint mode are two independent fields.
	 *
	 * Rebuilt through `buildTextPromptFromMessages`, which is the same
	 * construction the summarizer has always used for exactly this: role blocks
	 * in the connection's own format. Faithful rather than guessed — nothing
	 * here invents a wrapper the connection did not ask for.
	 */
	protected promptTextFor(compiled: PromptBuilderCompiledPrompt): string {
		if (typeof compiled.prompt === "string") return compiled.prompt
		const messages = Array.isArray(compiled.messages)
			? (compiled.messages as any[])
			: []
		if (messages.length) return this.buildTextPromptFromMessages(messages)
		// Neither shape. `toCompiledPrompt` already refuses this on the way in,
		// so reaching it means a caller built a payload by hand — named rather
		// than sent as an empty string, which is the failure this whole seam
		// exists to stop being silent.
		throw new Error(
			"this adapter was handed a compiled prompt carrying neither a prompt " +
				"string nor any messages, so there is nothing to send. A payload is " +
				"built by the pipeline and passed in through withCompiledPrompt()."
		)
	}

	/**
	 * Compile summarizer prompt — passes `systemPrompt` directly to the LLM
	 * with no roleplay or assistant framing. Used for lore summarization.
	 */
	protected async compileSummarizerPrompt(): Promise<PromptBuilderCompiledPrompt> {
		const messages: any[] = [
			{
				role: "system",
				content: this.systemPrompt ?? ""
			}
		]

		for (const msg of this.session.sessionMessages) {
			if (msg.isHidden) continue
			messages.push({
				role: msg.role === "assistant" ? "assistant" : "user",
				content: msg.content
			})
		}

		/**
		 * The connection's own wire mode, not a caller's argument.
		 *
		 * This read `args.useChatFormat`, which each adapter set from a local
		 * `extraJson` flag in its own `compilePrompt` override — six overrides
		 * whose entire body was that one line, and which the pipeline path never
		 * reached at all. The accessor is the same fact resolved once, so a
		 * summarize step and a session turn on one connection can no longer
		 * disagree about which shape that connection takes.
		 */
		const chatWire = this.isChatWire
		const promptString = chatWire
			? undefined
			: this.buildTextPromptFromMessages(messages)

		const totalTokens = await this.tokenCounter.countTokens(
			chatWire ? JSON.stringify(messages) : promptString!
		)

		return {
			prompt: promptString,
			messages,
			meta: {
				promptFormat: chatWire ? "chat" : "text",
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
	 * this adapter) as "no single perspective" rather
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
 * What a concrete text-adapter module default-exports.
 *
 * ## `capabilities` is gone, and must not come back
 *
 * There used to be a `capabilities?: ConnectionCapabilities` field here, holding
 * a single `toolUse: "native" | "emulated" | "probed" | "none"`. It had no
 * consumer anywhere outside this directory: every adapter dutifully set it and
 * nothing ever read it. Its job was taken by
 * `$lib/shared/connectionAdapters/manifest`, which declares `tools` as a GRADE
 * on its own three-band scale — plus the separate unproven flag that old
 * `"probed"` member was conflating — alongside every other capability, and
 * which, unlike this field, is reachable from the client and from the picker
 * without loading an adapter module.
 *
 * Reintroducing a capability declaration on the module export would recreate the
 * exact problem the manifest exists to solve: a declaration that lives inside a
 * module `@lmstudio/sdk` makes unloadable on Android, and that the capability
 * panel therefore cannot read. What a module says about itself is now said by
 * WHICH ACTIONS IT IMPLEMENTS; the grades are the manifest's to state.
 */
/**
 * The optional actions, merged onto the class as an INTERFACE.
 *
 * ⚠ Not `declare x?: AdapterActions["x"]` on the class body, which is what this
 * replaced. That form declares a PROPERTY, and TypeScript then refuses to let a
 * subclass implement it as a method:
 *
 *     Class 'BaseConnectionAdapter' defines instance member property
 *     'embedText', but extended class 'OllamaAdapter' defines it as instance
 *     member function. (TS2425)
 *
 * Nothing implemented one yet, so the surface compiled while being impossible to
 * fulfil — the first adapter to add embeddings or audio would have hit it, which
 * is precisely what these declarations exist to invite.
 *
 * Interface/class declaration merging adds the members to the class TYPE without
 * emitting fields, so a subclass may implement any of them as an ordinary method
 * and `"embedText" in adapter` still answers honestly. `generateText` is omitted
 * because the class declares it `abstract` — every text adapter must have it, so
 * it is not optional and must not be re-declared here.
 */
export interface BaseConnectionAdapter
	extends Partial<Omit<AdapterActions, "generateText">> {}

export interface AdapterExports {
	Adapter: new (args: BaseConnectionAdapterParams) => BaseConnectionAdapter
	listModels: ListModelsFn
	testConnection: TestConnectionFn
	connectionDefaults: Record<string, any>
	samplingKeyMap: Record<string, string>
}
