import {
	capabilitiesFromFlags,
	flagsFrom
} from "$lib/server/koboldcpp/probeCapabilities"
import { TokenCounters } from "../utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import {
	BaseConnectionAdapter,
	type AdapterExports,
	type BasePromptSession
} from "./BaseConnectionAdapter"
import { JSON_OBJECT_GBNF } from "./jsonGrammar"
import { jsonSchemaToGbnf } from "./jsonSchemaToGbnf"
import { type CompiledPrompt } from "./types"
import type { TextGenResult } from "$lib/server/adapters/actions"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	isReasoningKey,
	koboldCppSamplingKeyMap,
	reasoningOf
} from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import {
	fetchCurrentModelStatus,
	fetchLoadedEmbeddingModel,
	fetchLoadedImageModel,
	KCPP_NO_TEXT_MODEL
} from "$lib/server/koboldcpp/kcppHttp"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import {
	createIdleWatchdog,
	LLM_IDLE_TIMEOUT_MS,
	LLM_NONSTREAMING_TIMEOUT_MS
} from "./idleTimeout"
import { modelServerFetch } from "./modelServerFetch"

/**
 * The connection's KoboldCPP request switches (`extraJson` key) and the request
 * field koboldcpp.py's `generate()` reads for each. Logprobs is not here: the
 * response's logprobs would have nowhere to go.
 */
const KOBOLDCPP_REQUEST_SWITCHES = [
	["trimStop", "trim_stop"],
	["renderSpecial", "render_special"],
	["bypassEos", "bypass_eos"],
	["grammarRetainState", "grammar_retain_state"],
	["replaceInstructPlaceholders", "replace_instruct_placeholders"]
] as const

// Plain/"dumb" KoboldCPP connection: the user runs and configures their own
// koboldcpp instance entirely themselves. No admin API is assumed, so there's
// no preflight — generateText() just sends the request. For a connection that
// works with KoboldCPP, run by Serene Pub (subprocess lifecycle, model
// swapping via the admin API), see KoboldCppManagedAdapter, which subclasses
// this and only adds a preflight() step.
/** What the model wrote, where the envelope counted it. */
function completionTokensFrom(usage: unknown): { tokensCompletion?: number } {
	const count = (usage as any)?.completion_tokens
	return typeof count === "number" && Number.isFinite(count)
		? { tokensCompletion: count }
		: {}
}

export class KoboldCppAdapter extends BaseConnectionAdapter {
	/**
	 * 🚧 Yes, on the chat wire (PLAN-composer-attachments §3.6): images ride each turn of
	 * `/v1/chat/completions` as OpenAI `image_url` parts; the model needs its
	 * vision projector (mmproj) loaded. KCPP-managed inherits this.
	 * A fact about the CODE, not a capability claim — see the base class.
	 * Constant, because the conformance pin reads it off the prototype; a
	 * completion-wire request with files is refused in `dispatch.ts` from the
	 * manifest's `sendsAttachments.completion`.
	 */
	override get consumesAttachments(): boolean {
		return true
	}

	private _tokenCounter?: TokenCounters
	private abortController?: AbortController
	// KoboldCPP does not treat a dropped client connection as a cancel signal —
	// it keeps computing the abandoned generation server-side (occupying its
	// one generation slot in managed/single-user mode, blocking everything
	// queued behind it) unless explicitly told to stop via genkey + the
	// /api/extra/abort endpoint. abortController.abort() alone only stops
	// *this app* from reading the response.
	private genKey?: string

	constructor({
		connection,
		sampling,
		systemPrompt,
		session,
		currentCharacterId,
		generatingMessageMetadata
	}: {
		connection: SelectConnection
		sampling: ResolvedSampling
		systemPrompt?: string
		session: BasePromptSession
		currentCharacterId: number | null
		generatingMessageMetadata?: any
	}) {
		super({
			connection,
			sampling,
			systemPrompt,
			session,
			currentCharacterId,
			tokenCounter: new TokenCounters(
				connection.tokenCounter || TokenCounterOptions.ESTIMATE
			),
			tokenLimit:
				typeof sampling.contextTokens === "number"
					? sampling.contextTokens
					: 2048,
			contextThresholdPercent: 0.9,
			generatingMessageMetadata
		})
	}

	mapSamplingConfig(): Record<string, any> {
		const result: Record<string, any> = {}

		// Map the sampling parameters according to KoboldCPP API.
		// `sampling` arrives already resolved (resolveSampling.ts): a key being
		// present IS the switch being on, so the key map is the only filter left.
		for (const [key, value] of Object.entries(this.sampling)) {
			if (koboldCppSamplingKeyMap[key]) {
				// `enable_thinking` is not a sampler here: it lives inside a
				// nested `chat_template_kwargs` on one of the two routes. See
				// `enableThinkingFor`.
				if (isReasoningKey(key)) continue
				result[koboldCppSamplingKeyMap[key]] = value
			}
		}

		// Handle special mappings for KoboldCpp
		// Ensure we handle sampler_order if needed
		if (!result.sampler_order) {
			// Default sampler order for KoboldCPP - must be at least 6 items
			result.sampler_order = [6, 0, 1, 3, 4, 2, 5]
		}

		return result
	}

	/**
	 * Whether this request asks the chat template to think — `null` for "say
	 * nothing", which is the request this adapter has always sent.
	 *
	 * ⚠ **This read `extraJson.enableThinking` until the ruling of
	 * 2026-09-12.** Reasoning effort is a sampling parameter chosen per step,
	 * not a property of the compute: a connection-level tri-state gave the
	 * planner nobody reads and the prose the reader is waiting for the same
	 * answer, and there was no way to say otherwise short of a second
	 * connection to the same server. A stale `enableThinking` key left in
	 * `extraJson` is now read by nothing — harmless, since that column is jsonb
	 * and unread keys cost nothing, which is why no migration clears it.
	 *
	 * KoboldCPP has TWO states here and the vocabulary has four, so a level is
	 * honoured as "on" and the precision is recorded as ignored rather than
	 * quietly lost. `reasoningBudget` has no field at all on this service.
	 *
	 * Completion wire says nothing at all, and the branch below says why:
	 * `enable_thinking` is a session-template variable, and the raw completion
	 * endpoints never run the session-template pipeline.
	 */
	private enableThinkingFor(useChat: boolean): boolean | null {
		const { level, budget } = reasoningOf(this.sampling)
		if (!level) return null
		if (budget !== undefined) this.noteIgnoredSampler("reasoningBudget")
		if (!useChat) {
			this.noteIgnoredSampler("reasoning")
			return null
		}
		if (level === "off") return false
		// On, and only on: the word itself could not travel.
		this.noteIgnoredSampler("reasoning")
		return true
	}

	getTokenCounter() {
		if (!this._tokenCounter) {
			this._tokenCounter = new TokenCounters(
				this.connection.tokenCounter || TokenCounterOptions.ESTIMATE
			)
		}
		return this._tokenCounter
	}

	async getContextTokenLimit(): Promise<number> {
		const samplingLimit = await super.getContextTokenLimit()
		const baseUrl =
			normalizeBaseUrl(this.connection.baseUrl) || "http://localhost:5001"
		try {
			const res = await fetch(
				`${baseUrl}/api/extra/true_max_context_length`,
				{
					signal: AbortSignal.timeout(3000)
				}
			)
			if (res.ok) {
				const data = await res.json()
				const serverMax =
					typeof data.value === "number" ? data.value : null
				if (serverMax) return Math.min(samplingLimit, serverMax)
			}
		} catch {
			// KoboldCPP unreachable — fall through to sampling limit
		}
		return samplingLimit
	}

	async generateText(): Promise<TextGenResult> {
		const baseUrl =
			normalizeBaseUrl(this.connection.baseUrl) || "http://localhost:5001"
		// Default true — matches CONNECTION_DEFAULTS[KOBOLDCPP].extraJson.stream
		// (connectionDefaults.ts). Still an `extraJson` flag, and correctly so:
		// whether to stream is a preference about this connection, not a claim
		// about what the backend can express. Wire mode below was the one flag in
		// here that WAS such a claim, which is why it left.
		const stream = this.streamingOn(
			this.connection.extraJson?.stream ?? true
		)
		const useMemory = this.connection.extraJson?.useMemory ?? false
		/**
		 * Which of KoboldCPP's two endpoints this request goes to.
		 *
		 * This read `extraJson.useChat ?? true`, and that flag is gone. It was
		 * an adapter-local answer to a question the RENDER also had to answer, and
		 * on the pipeline path the two could not see each other: the render always
		 * produced one flat string while this defaulted to the chat endpoint, so
		 * `compiledPrompt.messages` was `undefined`, `JSON.stringify` dropped the
		 * key, and KoboldCPP was posted a `/v1/chat/completions` body with no
		 * messages in it at all.
		 *
		 * The connection answers it now — resolved once from its capability
		 * layers, read here and by `config/world.ts` when the prompt was built.
		 * A person who wants the other endpoint switches the capability, and that
		 * hand-set value outranks every later test.
		 */
		const useChat = this.isChatWire
		// A fresh key per generation — lets abort() tell KoboldCPP exactly which
		// in-flight generation to actually stop computing.
		this.genKey = crypto.randomUUID()
		// null = Auto (omit from request), true/false = explicit override
		const enableThinking: boolean | null =
			this.enableThinkingFor(useChat)
		/**
		 * The template was asked to reason, and koboldcpp hands its text back
		 * INLINE on the content channel whenever its own think-tag scan does
		 * not lift it (`encapsulate_thinking` only sees a block the model
		 * opened). Qwen3's Thinking models and Qwen 3.5 open the block in the
		 * template itself, so the model writes `reasoning…</think>reply` with
		 * no opener — and until the close lands the buffer alone cannot say the
		 * first token was reasoning. This is the fact that lets the live split
		 * route it from that first token (`splitReasoningStream`).
		 */
		this.reasoningRequestedInline = useChat && enableThinking === true

		// The stop sequences this request will send — composed by
		// `connections/stops.ts` and handed over at construction, never built
		// here (ruling 2026-09-10). On the chat wire the list arrives holding
		// the author's own sequences alone: a completion template's delimiters
		// have nothing to bite on there, and sending them overrides the model's
		// native stop tokens.
		const stop_sequence = this.stops

		// Compile prompt using PromptBuilder
		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		// Map sampling config
		const samplingParams = this.mapSamplingConfig()

		// Response-shape contract, translated to KoboldCPP's native mechanism.
		// KoboldCPP accepts a GBNF `grammar` on BOTH the OpenAI-compat session
		// endpoint and the raw completion endpoints, so this applies either way.
		// Empty object when the caller wants plain text, so unconstrained
		// generation — every session message — sends no grammar key at all.
		// A responseSchema narrows this from "any JSON object" to the exact
		// shape the caller needs; without one it stays object-level.
		const formatParams =
			this.responseFormat === "json"
				? {
						grammar: this.responseSchema
							? jsonSchemaToGbnf(this.responseSchema)
							: JSON_OBJECT_GBNF
					}
				: {}

		// The connection form's request switches. KoboldCPP's `generate()` reads
		// each from the request on every endpoint, the OpenAI-compatible one
		// included, so both bodies carry them. A switch never set is left out
		// and KoboldCPP's own default applies.
		const extra = this.connection.extraJson ?? {}
		const switchParams: Record<string, boolean> = {}
		for (const [key, field] of KOBOLDCPP_REQUEST_SWITCHES) {
			if (typeof extra[key] === "boolean") switchParams[field] = extra[key]
		}

		// Prepare the request body according to KoboldCPP API
		let requestBody: Record<string, any>

		if (useChat) {
			// Use OpenAI-style chat completion format. genkey is a KoboldCPP
			// extension the OpenAI-compat endpoint may or may not honor — harmless
			// to include either way, and abort() below still works via the plain
			// fetch abort for this mode regardless.
			// ⚠ The messages, CHECKED. `compiledPrompt.messages!` asserted an
			// array that a completion-shaped payload does not carry, and
			// `JSON.stringify` drops an `undefined` value outright — so the
			// request went out with no `messages` key and KoboldCPP was asked to
			// continue a conversation it had never been shown. A refusal here
			// names the disagreement; a silent request does not.
			//
			// It refuses rather than falling back to `promptTextFor`: rebuilding
			// a flat prompt would decide the wire mode locally, which is the
			// defect rather than the recovery.
			if (!Array.isArray(compiledPrompt.messages))
				throw new Error(
					"this KoboldCPP connection is chat wire mode, but the prompt it was " +
						"handed carries no messages. The render and the send are reading " +
						"different wire modes — check that the assemble node's connection " +
						"slot is wired to the sending Provider (slot.connectionOf)."
				)
			requestBody = {
				model: this.connection.model || "koboldcpp",
				messages: compiledPrompt.messages,
				max_tokens:
					samplingParams.max_length ||
					samplingParams.n_predict ||
					100,
				stream,
				// The chat leg sent NO stop sequences at all until the ruling of
				// 2026-09-10, which meant an author's own list was discarded on
				// this wire — a control that stored a value nothing read. What
				// arrives here has already had the template's delimiters and the
				// transcript's speaker labels removed by the composer, so only
				// the author's own sequences can reach the OpenAI-compatible
				// `stop` field. Omitted entirely when there are none, rather than
				// sent as an empty array.
				...(stop_sequence.length ? { stop: stop_sequence } : {}),
				genkey: this.genKey,
				...samplingParams,
				// Bugfix: koboldcpp never reads a top-level "enable_thinking"
				// from a request — grepped its source, every occurrence of
				// that key is in the Tkinter GUI's own launch-config code,
				// building the --jinja_kwargs CLI argument for someone
				// running the GUI directly. The actual per-request path
				// (chatcompletions handler, ~L4348-4354) only reads a nested
				// chat_template_kwargs object and merges it over the
				// server's cached/launch-time jinja kwargs — a top-level
				// field here was silently ignored, so no enable_thinking
				// value ever reached the model's chat template no matter
				// what this app sent.
				...(enableThinking !== null
					? {
							chat_template_kwargs: {
								enable_thinking: enableThinking
							}
						}
					: {}),
				...switchParams,
				...formatParams
			}
			// 🚧 The files, each on its own turn (PLAN-composer-attachments
			// §3.6), measured against the body as it stands without them.
			if (this.carriesAttachments)
				requestBody.messages = await this.openAIChatMessagesWithFiles(
					requestBody.messages,
					requestBody
				)
		} else {
			// Use text completion format. enable_thinking is deliberately
			// omitted here — it's a session-template (Jinja) variable, only
			// meaningful to the OpenAI-chat-completions code path a model's
			// template can reference; the raw completion endpoints don't run
			// the session-template pipeline at all, so including it here was a
			// silent no-op regardless of the reasoning setting.
			requestBody = {
				// `promptTextFor`, not `compiledPrompt.prompt`: a payload built
				// for a chat endpoint carries `messages` and no prompt string,
				// so reading the field directly puts `undefined` on the wire.
				prompt: this.promptTextFor(compiledPrompt),
				max_length:
					samplingParams.max_length ||
					samplingParams.n_predict ||
					100,
				max_context_length: await this.getContextTokenLimit(),
				stop_sequence,
				genkey: this.genKey,
				...samplingParams,
				...switchParams,
				...formatParams
			}

			// Add memory if enabled (only for text completion)
			if (useMemory && this.connection.extraJson?.memory) {
				requestBody.memory = this.connection.extraJson.memory
			}
		}

		// Handle streaming vs non-streaming
		if (stream) {
			return {
				completionResult: async (
					contentCb: (chunk: string) => void,
					reasoningCb?: (chunk: string) => void
				) => {
					const abortController = new AbortController()
					this.abortController = abortController
					let content = ""
					let idleTimedOut = false
					const idle = createIdleWatchdog(LLM_IDLE_TIMEOUT_MS, () => {
						idleTimedOut = true
						abortController.abort()
						// Dropping the connection does not stop KoboldCPP: a
						// stalled generation would hold its slot and queue the
						// next request behind it, exactly as an abandoned one
						// would (see `abort`).
						this.tellKoboldToStop()
					})

					try {
						const endpoint = useChat
							? `${baseUrl}/v1/chat/completions`
							: `${baseUrl}/api/extra/generate/stream`

						// The record the inspector reads instead of a proxy:
						// the request as this adapter built it, filled in below
						// as the frames arrive.
						const wire = this.beginExchange({
							url: endpoint,
							body: requestBody
						})

						// `modelServerFetch`: undici's own five-minute body
						// timeout would otherwise end a long prompt-processing
						// silence before the idle watchdog above could judge it.
						const response = await modelServerFetch(endpoint, {
							method: "POST",
							headers: {
								"Content-Type": "application/json"
							},
							body: JSON.stringify(requestBody),
							signal: this.abortController.signal
						})
						wire.status(response.status)

						if (!response.ok) {
							throw new Error(
								`KoboldCPP API error: ${response.status} ${response.statusText}`
							)
						}

						const reader = response.body?.getReader()
						if (!reader) {
							throw new Error("No response body")
						}

						const decoder = new TextDecoder()
						let buffer = ""

						while (true) {
							if (this.isAborting) {
								this.abortController.abort()
								break
							}

							const { done, value } = await reader.read()
							idle.poke()
							if (done) break

							const text = decoder.decode(value, { stream: true })
							wire.frame(text)
							buffer += text
							const lines = buffer.split("\n")
							buffer = lines.pop() || ""

							for (const line of lines) {
								if (line.startsWith("data: ")) {
									// Parsing alone is wrapped narrowly so a
									// malformed SSE line is ignored — but a
									// recognized-and-rejected response (below)
									// must still propagate to the outer catch,
									// not be swallowed here as "just a parse
									// error".
									let data: any
									try {
										data = JSON.parse(line.slice(6))
									} catch (e) {
										continue
									}
									if (useChat) {
										// OpenAI chat format
										// A 200 stream doesn't guarantee a real
										// completion — eg. no model loaded comes
										// back as a single chunk with an empty
										// delta and finish_reason "error", then
										// [DONE]. Left unchecked, that silently
										// produces an empty-but-"successful" reply.
										if (
											data.choices?.[0]?.finish_reason ===
											"error"
										) {
											throw new Error(
												"KoboldCPP rejected the request (finish_reason: error) — is a model loaded?"
											)
										}
										// Native reasoning — koboldcpp scans the
										// model's raw output for known think-tag
										// pairs and lifts whatever's inside into
										// reasoning_content (stripped out of
										// content), gated by its own
										// encapsulate_thinking genparam (default
										// true, never overridden by this app).
										// Only actually appears when the loaded
										// model emits thinking output at all.
										//
										// Both OpenAI-compatible spellings, first
										// match wins (see `reasoningTextFrom` in
										// OpenAIChatAdapter for why reading both is
										// not summing them): `reasoning_content` is
										// what koboldcpp has always sent, `reasoning`
										// is the spelling vLLM and OpenRouter moved
										// to and a newer build may follow.
										const reasoning =
											data.choices?.[0]?.delta
												?.reasoning_content ||
											data.choices?.[0]?.delta?.reasoning
										if (
											typeof reasoning === "string" &&
											reasoning
										) {
											reasoningCb?.(reasoning)
										}
										if (data.choices?.[0]?.delta?.content) {
											const chunk =
												data.choices[0].delta.content
											content += chunk
											contentCb(chunk)
										}
									} else {
										// KoboldCPP text format.
										//
										// Same as the non-streaming branch
										// below: reasoning is not absent, it is
										// INLINE in the token stream. Koboldcpp's
										// `encapsulate_thinking` (default on)
										// does hold back a partial tag prefix
										// across SSE boundaries here, so a
										// `<think>` is never split between two
										// events — which is a help to the shared
										// parser, not a channel for this adapter.
										if (data.token) {
											content += data.token
											contentCb(data.token)
										}
									}
								}
							}
						}
					} catch (e: any) {
						if (idleTimedOut) {
							throw new Error(
								`KoboldCPP connection idle — no response for ${LLM_IDLE_TIMEOUT_MS / 60_000} minutes.`
							)
						}
						if (e.name !== "AbortError") {
							throw e
						}
					} finally {
						idle.clear()
					}
				},
				compiledPrompt,
				isAborted: this.isAborting
			}
		} else {
			// Non-streaming request
			this.abortController = new AbortController()

			try {
				const endpoint = useChat
					? `${baseUrl}/v1/chat/completions`
					: `${baseUrl}/api/v1/generate`

				// The same record the streaming branch opens, for the same
				// reason — see the note there.
				const wire = this.beginExchange({
					url: endpoint,
					body: requestBody
				})

				// No intermediate chunks to reset an idle timer against for a
				// non-streaming response — this is a genuine, documented
				// exception to the idle-based design used elsewhere in this
				// file: a flat bound, sized generously to cover a full slow
				// generation end-to-end.
				// `modelServerFetch`: undici's own five-minute headers timeout
				// would otherwise end every reply longer than that, well inside
				// this bound.
				const response = await modelServerFetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify(requestBody),
					signal: AbortSignal.any([
						this.abortController.signal,
						AbortSignal.timeout(LLM_NONSTREAMING_TIMEOUT_MS)
					])
				})

				if (this.isAborting) {
					return {
						completionResult: "",
						compiledPrompt,
						isAborted: true
					}
				}

				if (!response.ok) {
					const error = await response.text()
					// A refusal is a response, and the one a reader most wants
					// to see.
					wire.received(error, response.status)
					throw new Error(
						`KoboldCPP API error: ${response.status} ${error}`
					)
				}

				const data = await response.json()
				wire.received(data, response.status)

				// A 200 response doesn't guarantee a real completion — eg. no
				// model loaded (--nomodel, or nothing loaded yet) comes back as
				// HTTP 200 with an empty message and finish_reason "error".
				// Silently accepting that as a successful-but-empty reply leaves
				// the user staring at a blank message with no explanation.
				if (
					useChat &&
					data.choices?.[0]?.finish_reason === "error"
				) {
					throw new Error(
						"KoboldCPP rejected the request (finish_reason: error) — is a model loaded?"
					)
				}

				let content: string
				let reasoningContent: string | undefined
				if (useChat) {
					// OpenAI chat format response
					content = data.choices?.[0]?.message?.content || ""
					// See the streaming branch's identical read above for why
					// this is only ever populated in chat mode.
					reasoningContent =
						data.choices?.[0]?.message?.reasoning_content ||
						data.choices?.[0]?.message?.reasoning ||
						undefined
				} else {
					// KoboldCPP text format response.
					//
					// ⚠ No `reasoningContent` here, and that is NOT "completion
					// mode cannot reason". `/api/v1/generate` is koboldcpp's
					// native API (api_format 2), whose reply is this one text
					// field — its serializer emits a fixed key set with no
					// reasoning member, and the extraction that builds
					// `reasoning_content` is gated on the chat-completions
					// formats. The think tags are not stripped either: they
					// come back INLINE in `results[0].text`, exactly as the
					// model wrote them, for the shared inline-tag parser to
					// take. There is no field here for an adapter to read.
					content = data.results?.[0]?.text || ""
				}

				return {
					completionResult: content,
					compiledPrompt,
					isAborted: false,
					reasoningContent,
					// Only the OpenAI-compatible route carries a `usage` block;
					// the native one answers with the text alone, so absent
					// stays absent there (see `TextGenResult.tokensCompletion`).
					...completionTokensFrom(data?.usage)
				}
			} catch (e: any) {
				if (e.name === "AbortError") {
					return {
						completionResult: "",
						compiledPrompt,
						isAborted: true
					}
				}
				throw e
			}
		}
	}

	abort() {
		super.abort()
		if (this.abortController) {
			this.abortController.abort()
		}
		this.tellKoboldToStop()
	}

	/**
	 * Tell KoboldCPP itself to stop — without this it keeps computing the
	 * abandoned generation after we drop the connection, which in managed
	 * mode (a single generation slot) blocks every subsequent request until
	 * the zombie generation finishes on its own.
	 */
	private tellKoboldToStop() {
		if (this.genKey) {
			const baseUrl =
				normalizeBaseUrl(this.connection.baseUrl) ||
				"http://localhost:5001"
			fetch(`${baseUrl}/api/extra/abort`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ genkey: this.genKey }),
				signal: AbortSignal.timeout(5000)
			}).catch((err) => {
				console.warn(
					"[KoboldCppAdapter] Failed to send abort to KoboldCPP:",
					err
				)
			})
		}
	}
}

/**
 * Connection test function — reused as-is by KoboldCppManagedAdapter.
 *
 * Reports `extra.capabilities` because this endpoint already carries them and
 * this call already fetches it. Without that, KoboldCPP's `text->image` would
 * sit at the manifest's `{unproven: true, until: "none"}` forever: nothing else
 * probes a text-typed connection, so the one backend that writes replies and
 * draws pictures from the same process could never be shown to do the second.
 */
export async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string; extra?: Record<string, unknown> }> {
	try {
		const baseUrl =
			normalizeBaseUrl(connection.baseUrl) || "http://localhost:5001"
		const response = await fetch(`${baseUrl}/api/extra/version`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json"
			},
			signal: AbortSignal.timeout(5000)
		})

		if (!response.ok) {
			return {
				ok: false,
				error: `Server returned ${response.status} ${response.statusText}`
			}
		}

		const data = await response.json()
		if (!data.version) {
			return {
				ok: false,
				error: "Invalid response from KoboldCPP server"
			}
		}

		// What this instance can do RIGHT NOW — which models are loaded, not
		// which software is running. Mapped from the payload already in hand.
		const flags = flagsFrom(data)
		return {
			ok: true,
			extra: {
				version: data.version,
				koboldCppFlags: flags,
				capabilities: capabilitiesFromFlags(flags)
			}
		}
	} catch (e: any) {
		return {
			ok: false,
			error: e.message || "Failed to connect to KoboldCPP server"
		}
	}
}

// List models function — a dumb connection never assumes an admin API is
// present, so this only ever reports the currently LOADED models, each with its
// modality: the text model (`/api/v1/model`), the image model
// (`/sdapi/v1/sd-models`) and the embedding model (named by a one-word
// `/v1/embeddings` probe). Only modalities whose loaded model koboldcpp NAMES
// are listed (owner ruling 2026-09-26) — a default must say which model it
// uses, and stored vectors must say which model made them. See KoboldCppManagedAdapter's listModels for the admin-API version.
//
// The answer is the model's REAL name, or an empty list when nothing is
// loaded, or an ERROR when the process could not be asked. Never a `[current]`
// sentinel with a "Currently Loaded: …" label: that is fine for a dropdown and
// wrong for a sync, because the sentinel becomes a row no host lists. Nor may
// "could not ask" collapse into "nothing loaded", which would mark the real row
// missing every time the worker is busy. `determined` is the flag that keeps
// those two apart — see `fetchCurrentModelStatus`.
async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const baseUrl =
			normalizeBaseUrl(connection.baseUrl) || "http://localhost:5001"
		const status = await fetchCurrentModelStatus(baseUrl)
		if (!status.determined)
			return {
				models: [],
				error: "KoboldCPP did not answer — it may be loading a model or mid-generation."
			}
		if (status.refused)
			return {
				models: [],
				error: "Nothing is listening at this address."
			}
		const image = await fetchLoadedImageModel(baseUrl)
		// Half a listing would mark the other half's row missing.
		if (!image.determined)
			return {
				models: [],
				error: "KoboldCPP did not say which image model it has loaded — it may be mid-swap."
			}
		const embedding = await fetchLoadedEmbeddingModel(baseUrl)
		if (!embedding.determined)
			return {
				models: [],
				error: "KoboldCPP did not say which embedding model it has loaded — it may be busy."
			}
		const models: { model: string; name: string; modality: string }[] = []
		// An image-only instance answers "inactive" here, which is not a model.
		if (status.modelName && status.modelName !== KCPP_NO_TEXT_MODEL)
			models.push({
				model: status.modelName,
				name: status.modelName,
				modality: "text-gen"
			})
		if (image.name)
			models.push({ model: image.name, name: image.name, modality: "image-gen" })
		if (embedding.name)
			models.push({
				model: embedding.name,
				name: embedding.name,
				modality: "embeddings"
			})
		return { models }
	} catch (e: any) {
		return {
			models: [],
			error: e.message || "Failed to fetch models from KoboldCpp"
		}
	}
}

const exports: AdapterExports = {
	Adapter: KoboldCppAdapter,
	testConnection,
	listModels,
	connectionDefaults: CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP],
	samplingKeyMap: koboldCppSamplingKeyMap
}

export default exports
