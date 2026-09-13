import Anthropic from "@anthropic-ai/sdk"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { TokenCounters } from "../utils/TokenCounterManager"
import {
	BaseConnectionAdapter,
	type AdapterExports,
	type BasePromptSession
} from "./BaseConnectionAdapter"
import type { CompiledPrompt } from "./types"
import type { TextGenResult } from "$lib/server/adapters/actions"
import type { PreparedAttachment } from "$lib/server/adapters/attachments"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	anthropicSamplingKeyMap,
	isReasoningKey,
	reasoningBudgetFor,
	reasoningOf
} from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import { ToolUseBlockAccumulator } from "./streamingToolCalls"

/**
 * The prompt-cache halves of an Anthropic `usage` block.
 *
 * ⚠ **`input_tokens` is not the prompt total here.** This is the one service
 * that reports the three parts of a prompt separately — what it read fresh, what
 * it read from the cache, and what it wrote to the cache — so the total is their
 * sum. Forwarding `input_tokens` under `tokensPrompt` would report a 4,000-token
 * prompt as 120 the moment caching started working, which is the reading exactly
 * backwards.
 *
 * Each field is checked rather than read: absent stays absent, so a model that
 * reports no reuse is never written down as having reused nothing (see
 * `TextGenResult.tokensCached`).
 */
function cacheUsageFrom(usage: unknown): {
	tokensPrompt?: number
	tokensCached?: number
	tokensCacheWrite?: number
	tokensCompletion?: number
} {
	const u: any = usage
	if (!u || typeof u !== "object") return {}
	const num = (v: unknown) =>
		typeof v === "number" && Number.isFinite(v) ? v : undefined
	const input = num(u.input_tokens)
	const read = num(u.cache_read_input_tokens)
	const write = num(u.cache_creation_input_tokens)
	const parts = [input, read, write].filter(
		(n) => n !== undefined
	) as number[]
	const output = num(u.output_tokens)
	return {
		...(parts.length
			? { tokensPrompt: parts.reduce((a, b) => a + b, 0) }
			: {}),
		...(read !== undefined ? { tokensCached: read } : {}),
		...(write !== undefined ? { tokensCacheWrite: write } : {}),
		...(output !== undefined ? { tokensCompletion: output } : {})
	}
}

// Known Claude models for listModels
const ANTHROPIC_MODELS = [
	{ id: "claude-opus-4-6", name: "Claude Opus 4.6" },
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
	{ id: "claude-opus-4-5", name: "Claude Opus 4.5" },
	{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
	{ id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
	{ id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet" },
	{ id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
	{ id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
	{ id: "claude-3-opus-20240229", name: "Claude 3 Opus" }
]

// ── Attachments on the wire ─────────────────────────────────────────────────
//
// The Messages API carries a file as a CONTENT BLOCK inside a message, beside
// the text, with the bytes inlined as base64 — not as a separate field and not
// as a URL this app could serve. So sending a file is an edit to one message's
// content, which is why the assembly below rewrites a message rather than adding
// a request parameter.
//
// ⚠ Order. `attachments` is a list because "these three, in this order" is the
// thing a list expresses, and the blocks are emitted in exactly that order. A
// reordering here does not read as a plumbing fault: it reads as the MODEL
// misreading the pictures, which is the most expensive failure available in this
// area. Nothing below groups, filters or sorts.

/**
 * The image mimes a base64 `source` may declare, from the SDK's own union.
 *
 * A runtime set beside the compile-time type, because by the time a negotiated
 * mime arrives here it is a `string`. The manifest's `accepts` for this entry is
 * exactly these four, so `prepareAttachments` cannot hand back a fifth today —
 * and if that list ever grows a format the wire format does not take, this is
 * where it is caught, naming the file, rather than at the service naming a
 * base64 blob.
 */
const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp"
] satisfies Anthropic.Base64ImageSource["media_type"][])

const isImageMediaType = (
	mime: string
): mime is Anthropic.Base64ImageSource["media_type"] =>
	IMAGE_MEDIA_TYPES.has(mime)

/** How a file is named in a refusal — the same shape the engine's refusals use,
 *  so a user reads one vocabulary whichever half declined. */
const nameOf = (file: PreparedAttachment, index: number): string =>
	file.filename
		? `${file.filename} (attachment ${index + 1})`
		: `attachment ${index + 1}`

/**
 * One prepared file as the block that carries it.
 *
 * Two kinds and no more, because two is what the Messages API takes: an `image`
 * block and a `document` block of PDF. Both are declared in this entry's `io`,
 * so both are negotiated and capped before they reach here.
 *
 * Anything else THROWS rather than being skipped. A kind this entry declares no
 * limits for is forwarded by the engine — "absent means no known limit" is a
 * statement about counts and sizes, not a promise that the wire format can
 * express the file — so this is the last honest place to say no, and dropping it
 * instead would send a request whose text refers to a file that never left.
 */
function contentBlockFor(
	file: PreparedAttachment,
	index: number
): Anthropic.ContentBlockParam {
	// The NEGOTIATED bytes: what the format check and both byte caps were
	// applied to, never the source's.
	const data = file.bytes.toString("base64")

	if (file.kind === "image") {
		if (!isImageMediaType(file.mime))
			throw new Error(
				`${nameOf(file, index)} is ${file.mime}, which the Anthropic Messages API does not take as an image. ` +
					`It accepts JPEG, PNG, GIF and WebP.`
			)
		return {
			type: "image",
			source: { type: "base64", media_type: file.mime, data }
		}
	}

	if (file.mime === "application/pdf")
		return {
			type: "document",
			source: { type: "base64", media_type: "application/pdf", data },
			// The one field a filename can usefully reach on the wire; it is
			// display metadata everywhere else and would otherwise be dropped.
			...(file.filename ? { title: file.filename } : {})
		}

	throw new Error(
		`${nameOf(file, index)} is ${file.mime}, a ${file.kind} file, and the Anthropic Messages API carries only ` +
			`images and PDFs alongside a prompt. It is not sent rather than sent as something it is not.`
	)
}

/**
 * The messages, with the files on the turn they travel with.
 *
 * That turn is the LAST USER message — the current one, which is what the files
 * were attached to and what the reply is about. `buildAnthropicMessages`
 * guarantees one exists and that it is last; the search is by role anyway so
 * this cannot silently attach to an assistant turn if that ever changes.
 *
 * Blocks come BEFORE the text, which is Anthropic's own documented ordering
 * advice for a question about an image, and the text block is omitted entirely
 * when the turn has nothing to say — the API rejects an empty text block, and a
 * bare "here are some files" turn is a legitimate request.
 *
 * A new array rather than a mutation, so the object whose size was measured for
 * the request cap is not the object that changed underneath it.
 */
function withAttachmentBlocks(
	messages: readonly Anthropic.MessageParam[],
	blocks: readonly Anthropic.ContentBlockParam[]
): Anthropic.MessageParam[] {
	const target = messages.reduce(
		(found, msg, index) => (msg.role === "user" ? index : found),
		-1
	)
	if (target < 0) return [...messages, { role: "user", content: [...blocks] }]

	const existing = messages[target]!.content
	const text = Array.isArray(existing)
		? existing
		: typeof existing === "string" && existing.length
			? [{ type: "text" as const, text: existing }]
			: []

	return messages.map((msg, index) =>
		index === target ? { role: "user", content: [...blocks, ...text] } : msg
	)
}

/**
 * What a `redacted_thinking` block surfaces as.
 *
 * Anthropic returns one of these when its safety systems flag part of the
 * model's internal reasoning: the block carries an encrypted `data` blob and no
 * readable text at all. Three things could be done with it, and this is the
 * choice:
 *
 *   - Drop it (what this adapter did). Wrong, quietly: with Extended Thinking
 *     switched on and the model demonstrably thinking, the panel comes back
 *     empty and reads as a broken feature rather than as a redaction.
 *   - Surface the `data` blob. Worse: opaque ciphertext only Anthropic can
 *     read, kilobytes of it, persisted into the message record as if it were
 *     the model's prose.
 *   - Surface a short fixed notice, and never the blob. Honest about what
 *     happened, impossible to mistake for the model's own words, and the same
 *     length however large the redacted reasoning was.
 *
 * ⚠ Exported for the test that pins it. It is not a template and takes no
 * interpolation — a redaction is Anthropic's act, and the sentence names them.
 */
export const REDACTED_THINKING_NOTICE =
	"[Part of this model's reasoning was encrypted by Anthropic's safety systems and cannot be shown.]"

class AnthropicAdapter extends BaseConnectionAdapter {
	private _client?: Anthropic
	private abortController?: AbortController

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
		generatingMessageMetadata
	}: {
		connection: SelectConnection
		sampling: ResolvedSampling
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
		session: BasePromptSession
		currentCharacterId: number | null
		tokenCounter?: TokenCounters
		tokenLimit?: number
		contextThresholdPercent?: number
		generatingMessageMetadata?: any
	}) {
		super({
			connection,
			sampling,
			contextConfig,
			promptConfig,
			session,
			currentCharacterId,
			tokenCounter:
				tokenCounter ||
				new TokenCounters(
					connection.tokenCounter ||
						TokenCounterOptions.ANTHROPIC_CLAUDE
				),
			tokenLimit:
				tokenLimit ||
				(typeof sampling.contextTokens === "number"
					? sampling.contextTokens
					: 8192),
			contextThresholdPercent: contextThresholdPercent || 0.9,
			generatingMessageMetadata
		})
	}

	getClient(): Anthropic {
		if (!this._client) {
			const apiKey =
				decryptApiKeyField(this.connection.extraJson?.apiKey) || ""
			const baseURL =
				normalizeBaseUrl(this.connection.baseUrl) || undefined
			this._client = new Anthropic({
				apiKey,
				...(baseURL ? { baseURL } : {})
			})
		}
		return this._client
	}

	mapSamplingConfig(): Record<string, any> {
		const result: Record<string, any> = {}
		// `sampling` arrives already resolved (resolveSampling.ts): a key being
		// present IS the switch being on, so the key map is the only filter left.
		for (const [key, value] of Object.entries(this.sampling)) {
			if (anthropicSamplingKeyMap[key]) {
				// Both reasoning keys land on `thinking`, which is an object
				// rather than a value — built by `thinkingParam` below.
				if (isReasoningKey(key)) continue
				result[anthropicSamplingKeyMap[key]] = value
			}
		}
		return result
	}

	/**
	 * `thinking`, as the Messages API takes it — or nothing at all.
	 *
	 * ⚠ **This read `extraJson.thinking` and `extraJson.thinkingBudget` until
	 * the ruling of 2026-09-12.** Reasoning effort is a sampling parameter
	 * chosen per stage, not a property of the compute: with the toggle on the
	 * connection, every stage sharing one Anthropic row thought exactly as hard
	 * as every other, and the only way to split them was a second connection
	 * carrying the same key. Stale `thinking`/`thinkingBudget` keys left in an
	 * existing row's `extraJson` are read by nothing now — `extraJson` is jsonb
	 * and an unread key costs nothing, which is why no migration clears them.
	 *
	 * Nothing at all when the sampler is switched off, which keeps a request
	 * byte-identical to the one this adapter has always sent for a connection
	 * that never turned thinking on.
	 *
	 * `budget_tokens` comes from the config's own `reasoningBudget` when it set
	 * one, and from the shared level table otherwise — a number somebody typed
	 * is a choice; the table is only the translation of a word.
	 */
	private thinkingParam(): Anthropic.ThinkingConfigParam | undefined {
		const { level, budget } = reasoningOf(this.sampling)
		if (!level) return undefined
		if (level === "off") return { type: "disabled" }
		return {
			type: "enabled",
			budget_tokens: reasoningBudgetFor(level, budget)
		}
	}

	/**
	 * Convert compiled prompt messages to Anthropic format.
	 * Anthropic requires: system as a separate top-level param, and
	 * messages must strictly alternate user/assistant (no consecutive same-role).
	 */
	private buildAnthropicMessages(compiledPrompt: CompiledPrompt): {
		system: string
		messages: Anthropic.MessageParam[]
	} {
		const rawMessages: { role: string; content: string }[] =
			compiledPrompt.messages || []

		let system = ""
		const messages: Anthropic.MessageParam[] = []

		for (const msg of rawMessages) {
			if (msg.role === "system") {
				system = system ? system + "\n\n" + msg.content : msg.content
				continue
			}

			const role: "user" | "assistant" =
				msg.role === "assistant" ? "assistant" : "user"

			// Merge consecutive same-role messages (Anthropic requirement)
			if (
				messages.length > 0 &&
				messages[messages.length - 1].role === role
			) {
				const last = messages[messages.length - 1]
				if (typeof last.content === "string") {
					last.content = last.content + "\n\n" + msg.content
				}
			} else {
				messages.push({ role, content: msg.content })
			}
		}

		/**
		 * A trailing assistant turn is a PREFILL here, and is left alone.
		 *
		 * ⚠ `messages.push({role:"user", content:"Please continue."})` stood
		 * here, on the belief that "Anthropic requires the last message to be
		 * from user". It does not: the Messages API explicitly accepts a final
		 * assistant turn and continues writing THAT turn — which is the whole
		 * mechanism behind the Continue button. The extra user turn asked the
		 * model, in words, to carry on, so it opened a NEW reply; `joinContinuation`
		 * then glued that second beginning onto the partial and the seam read as
		 * the model repeating itself. Nothing errored, because nothing was wrong
		 * with the request.
		 *
		 * `continuationRoute` is where this adapter says it prefills, and it says
		 * so from the manifest (`continuesIn: ["chat"]`) rather than from a flag
		 * here — the panel and the verb read the same declaration, so a button
		 * that is live is a button the send path honours.
		 *
		 * Two pieces of hygiene the API's own prefill rules require, both silent
		 * failures otherwise:
		 *
		 *   - **No trailing whitespace** on the final text block. The prefill
		 *     validator rejects it, and the partial arrives here ending in
		 *     whatever the model stopped on — frequently a newline or a space.
		 *     A 400 on a request that looks fine in the log.
		 *   - **No empty text block.** A partial that is only whitespace strips
		 *     to nothing, and an empty block is refused; dropping the turn
		 *     entirely leaves a well-formed request that generates from the
		 *     user's turn, which is what an empty partial means anyway.
		 *
		 * ⚠ Only a TRAILING assistant turn. One in the middle is history or a
		 * few-shot example and is untouched — this runs after the merge loop
		 * above, so `last` is the merged turn rather than one of its halves.
		 */
		const last = messages[messages.length - 1]
		if (last?.role === "assistant" && typeof last.content === "string") {
			const seed = last.content.replace(/\s+$/, "")
			if (seed) last.content = seed
			else messages.pop()
		}

		// Must have at least one user message.
		//
		// ⚠ **This floor is the loudest half of a defect that had no error
		// attached to it.** The Messages API refuses an empty array, so something
		// has to go in it — and for the whole of 0.6 what went in was this: the
		// pipeline built a flat completion prompt, `compiledPrompt.messages` was
		// `undefined`, the loop above produced nothing, and every generation on
		// every Anthropic connection went out as the literal word "Hello" with an
		// empty system prompt. The user's lore, persona and history, replaced by a
		// five-letter greeting, with a perfectly good reply coming back.
		//
		// So it stays — an empty array is still a request the service rejects —
		// but it is no longer reachable by that route: this adapter is chat wire
		// mode by declaration, the render therefore produces messages, and the
		// guard below refuses a payload that carries none instead of quietly
		// papering over it. What remains for this line is a genuinely empty
		// session, which is a request worth sending.
		if (messages.length === 0) {
			messages.push({ role: "user", content: "Hello" })
		}

		return { system, messages }
	}

	/**
	 * Yes: this class puts attachments on the wire. See the base class — this is
	 * a fact about the CODE, not a capability claim about a model.
	 */
	override get consumesAttachments(): boolean {
		return true
	}

	/**
	 * The Messages API takes `tools` and answers with `tool_use` content
	 * blocks, both of which this class handles — which is all this property
	 * claims. See `consumesTools` on the base class.
	 */
	override get consumesTools(): boolean {
		return true
	}

	/**
	 * The request's files, negotiated, capped and encoded — or a throw carrying
	 * the engine's own sentence.
	 *
	 * ⚠ `transport: "base64"`, and it is the point of doing this here. Anthropic
	 * inlines every file into the JSON body, and BOTH its published byte limits
	 * are about that encoded body — the vision docs say "10 MB (base64-encoded)"
	 * per image in as many words, and the 32MB request limit is an HTTP body that
	 * is base64 throughout. So the real ceilings are 7.5MiB per image and about
	 * 24MiB of files per request. Nothing but the adapter knows the wire format,
	 * which is why the engine takes the transport from the caller rather than
	 * assuming one; without it a 9MB image and a 30MB request would both pass
	 * their checks here and be refused by the service, and the app would have
	 * told the user it was fine.
	 *
	 * `overheadBytes` is the rest of the request measured exactly, by serialising
	 * the request as it stands before the files go in. The per-block scaffolding
	 * (`{"type":"image","source":{…}}`, some 80 bytes each) is deliberately left
	 * out: an unstated overhead under-counts, which lets a borderline request
	 * reach the service, and a guessed one refuses requests that fit.
	 *
	 * A refusal arrives as a VALUE from the engine and leaves here as a throw,
	 * carrying that value's sentence unchanged — which names the cap and cites
	 * where the number came from, so "too many images" is never all a user gets.
	 */
	private async attachmentBlocks(
		requestWithoutFiles: unknown
	): Promise<Anthropic.ContentBlockParam[]> {
		if (!this.attachments.length) return []

		const plan = await this.prepareAttachments(this.attachments, {
			transport: "base64",
			overheadBytes: Buffer.byteLength(
				JSON.stringify(requestWithoutFiles)
			)
		})
		if (!plan.ok) throw new Error(plan.reason)

		return plan.files.map((file, index) => contentBlockFor(file, index))
	}

	async generateText(): Promise<TextGenResult> {
		const model = this.connection.model || "claude-sonnet-4-5"
		const stream = this.streamingOn(
			this.connection.extraJson?.stream ?? true
		)

		// No `useSessionFormat` argument, and its removal is the fix rather than a
		// tidy-up. It was read inside `compilePrompt(args)` — which the pipeline
		// never reaches, because `withCompiledPrompt` returns the injected payload
		// before the argument is looked at. So the flag was set on the legacy path
		// and meaningless on the pipeline one, and this adapter was handed a
		// payload built for text completion with no messages in it. What decides
		// the shape now is the connection's WIRE MODE, resolved once and read by
		// the render as well as by this send. The native Messages API declares
		// only `wire_chat`, so it is always chat here — and the assertion below is
		// what makes that a checked fact rather than a comment.
		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		/**
		 * A payload that carries no messages at all cannot be sent as a
		 * conversation, and saying so is worth more than any recovery.
		 *
		 * ⚠ Deliberately NOT a fallback to `promptTextFor`. Rebuilding a flat
		 * string here and posting it as one user turn would work, would look like
		 * robustness, and would restore exactly the failure this change removes:
		 * a wire mode decided locally by an adapter, disagreeing with the one the
		 * prompt was rendered for, with nothing reporting the difference. The
		 * connection says chat; if what arrived is not chat-shaped, the wiring is
		 * wrong and the sentence names where.
		 *
		 * `prompt` alone is the shape this refuses — a payload with neither is
		 * already refused on the way in by `toCompiledPrompt`.
		 */
		if (!Array.isArray(compiledPrompt.messages) && compiledPrompt.prompt)
			throw new Error(
				"this Anthropic connection is chat wire mode, but the prompt it was " +
					"handed is one flat completion string with no messages in it. The " +
					"render and the send are reading different wire modes — check that " +
					"the assemble node's connection slot is wired to the sending " +
					"Provider (slot.connectionOf), so both see the same connection."
			)

		const { system, messages } = this.buildAnthropicMessages(compiledPrompt)

		const samplingConfig = this.mapSamplingConfig()
		const maxTokens: number =
			samplingConfig.max_tokens || this.sampling.responseTokens || 1024

		// Extended thinking: requires betas header and disables temperature/top_p/top_k
		const thinkingParam = this.thinkingParam()
		const useThinking = thinkingParam?.type === "enabled"

		// When thinking is enabled, sampling params are restricted — the
		// service refuses the request outright if they are present, so this is
		// not a preference.
		//
		// ⚠ Each one is RECORDED as ignored on the way out. A temperature a
		// person set, on a request that could not carry it, is exactly the
		// silent gap `ignoredSamplers` exists to close: without it the only
		// evidence is an absence in the request body, and "I set temperature
		// and nothing changed" has no answer anywhere on the screen.
		if (useThinking)
			for (const key of ["temperature", "topP", "topK"] as const)
				if (this.sampling[key] !== undefined)
					this.noteIgnoredSampler(key)

		const allowedSampling = useThinking
			? {} // temperature/top_p/top_k not allowed with extended thinking
			: {
					...(samplingConfig.temperature !== undefined
						? { temperature: samplingConfig.temperature }
						: {}),
					...(samplingConfig.top_p !== undefined
						? { top_p: samplingConfig.top_p }
						: {}),
					...(samplingConfig.top_k !== undefined
						? { top_k: samplingConfig.top_k }
						: {})
				}

		const textOnlyParams = {
			model,
			max_tokens: maxTokens,
			messages,
			// This adapter sent NO stop sequences at all until the ruling of
			// 2026-09-10. Anthropic is a chat wire and always has been, so the
			// composer hands over the author's own `explicit` list and nothing
			// else — the Messages API takes exactly that as `stop_sequences`.
			// Omitted when empty rather than sent as `[]`.
			...(this.stops.length ? { stop_sequences: this.stops } : {}),
			/**
			 * The tools, in the field the Messages API calls them (20 §9).
			 *
			 * `input_schema`, not `parameters` — the one place this format
			 * differs from OpenAI's in more than a wrapper. Omitted when empty
			 * rather than sent as `[]`, like `stop_sequences` above: a request
			 * that declares no tools and one that declares none *available* are
			 * different requests, and the second costs a tool-use system
			 * preamble the model then reads on every turn.
			 */
			...(this.tools.length
				? {
						tools: this.tools.map((t) => ({
							name: t.name,
							description: t.description,
							input_schema: t.parameters
						}))
					}
				: {}),
			...(system ? { system } : {}),
			...(thinkingParam ? { thinking: thinkingParam } : {}),
			...allowedSampling
		}

		// The files, if any were handed over. Measured against the request as it
		// stands without them, then spliced into the turn they belong to — both
		// paths below send `baseParams`, so streaming and non-streaming carry
		// the same blocks by construction rather than by two edits agreeing.
		const attachmentContent = await this.attachmentBlocks(textOnlyParams)
		const baseParams = attachmentContent.length
			? {
					...textOnlyParams,
					messages: withAttachmentBlocks(messages, attachmentContent)
				}
			: textOnlyParams

		// The request as it goes out, named once because both branches send it
		// and the record below describes it.
		const sentParams = {
			...baseParams,
			// The beta header rides an ENABLED thinking block only: `disabled`
			// is an ordinary request that happens to say so out loud.
			...(useThinking
				? { betas: ["interleaved-thinking-2025-05-14"] }
				: {})
		}

		// The record the inspector reads instead of a proxy: this format's own
		// rendering of the request, filled in below as the response is read.
		// Headers stay out of it — the key travels in one.
		const wire = this.beginExchange({
			url: `${normalizeBaseUrl(this.connection.baseUrl) || "https://api.anthropic.com"}/v1/messages`,
			body: sentParams
		})

		const client = this.getClient()
		// A fresh controller per generation — abort() below fires this, and the
		// signal is threaded into the actual SDK call so cancelling a
		// non-streaming request actually stops the in-flight HTTP call
		// instead of just flipping a flag nothing checks until the response
		// (and its real spend) has already come back.
		this.abortController = new AbortController()

		if (stream) {
			return {
				completionResult: async (
					contentCb: (chunk: string) => void,
					thinkingCb?: (chunk: string) => void
				) => {
					try {
						if (this.isAborting) return

						const streamResp = await client.messages.stream(
							sentParams as any,
							{ signal: this.abortController?.signal }
						)

						// Separates the notice from any reasoning already
						// emitted, so it doesn't glue onto the end of a
						// sentence the model actually wrote.
						let thoughtSomething = false
						/**
						 * The call, assembled from its content block (20 §9).
						 *
						 * Declared for every streaming request rather than only
						 * a tool-carrying one, so `streamedToolCall` below is
						 * `null` ("nothing was called") rather than `undefined`
						 * ("this adapter did not look") on both.
						 */
						const calls = new ToolUseBlockAccumulator()

						for await (const event of streamResp) {
							wire.frame(event)
							if (this.isAborting) {
								streamResp.controller.abort()
								return
							}

							/**
							 * The input accounting, which this service sends
							 * unasked — both cache halves included.
							 *
							 * ⚠ `message_start` ONLY. `message_delta` carries a
							 * usage block too, and which of the four fields are
							 * on it varies by API version: one naming
							 * `input_tokens` without the cache halves beside it
							 * would re-sum the prompt from a third of its parts
							 * and report it shrinking as caching improved.
							 */
							if (event.type === "message_start")
								this.recordStreamedUsage(
									cacheUsageFrom(
										(event as any).message?.usage
									)
								)
							calls.push(event)

							// ⚠ A redacted block has NO delta — checked against
							// the installed SDK: `RawContentBlockDelta` is
							// TextDelta | InputJSONDelta | CitationsDelta |
							// ThinkingDelta | SignatureDelta, with no redacted
							// member, while `RawContentBlockStartEvent`'s
							// content_block union does include
							// RedactedThinkingBlock. It arrives whole, here, and
							// the delta loop below would never see it.
							if (
								event.type === "content_block_start" &&
								(event.content_block as any)?.type ===
									"redacted_thinking"
							) {
								thinkingCb?.(
									(thoughtSomething ? "\n" : "") +
										REDACTED_THINKING_NOTICE
								)
								thoughtSomething = true
								continue
							}

							if (event.type === "content_block_delta") {
								const delta = event.delta as any
								if (
									delta.type === "thinking_delta" &&
									delta.thinking
								) {
									thinkingCb?.(delta.thinking)
									thoughtSomething = true
								} else if (
									delta.type === "text_delta" &&
									delta.text
								) {
									contentCb(delta.text)
								}
							}
						}
						this.streamedToolCall = calls.first()
					} catch (e: any) {
						// An intentional abort throws too (the SDK rejects the
						// aborted request) — don't surface that as an error,
						// the caller already knows this was cancelled.
						if (this.isAborting) return
						throw e
					}
				},
				compiledPrompt,
				isAborted: this.isAborting
			}
		} else {
			try {
				if (this.isAborting) {
					return {
						completionResult: "",
						compiledPrompt,
						isAborted: true
					}
				}

				const response = await client.messages.create(
					sentParams as any,
					{ signal: this.abortController?.signal }
				)
				wire.received(response)

				let content = ""
				let thinking = ""
				let toolCall: ReturnType<AnthropicAdapter["toolCallFrom"]> =
					null

				for (const block of response.content) {
					if ((block as any).type === "thinking") {
						thinking += (block as any).thinking || ""
					} else if ((block as any).type === "redacted_thinking") {
						// See REDACTED_THINKING_NOTICE: the notice, never the
						// block's encrypted `data`.
						thinking +=
							(thinking ? "\n" : "") + REDACTED_THINKING_NOTICE
					} else if (block.type === "text") {
						content += block.text
					} else if (
						(block as any).type === "tool_use" &&
						!toolCall
					) {
						// A content BLOCK on this format, interleaved with the
						// prose rather than beside it — which is why the prose
						// above keeps accumulating past it. The first call only,
						// see `TextGenResult.toolCall`.
						toolCall = this.toolCallFrom(
							(block as any).name,
							(block as any).input
						)
					}
				}

				return {
					completionResult: content,
					compiledPrompt,
					isAborted: this.isAborting,
					thinkingContent: thinking || undefined,
					toolCall,
					// Recorded, never acted on: see `TextGenResult.tokensCached`.
					...cacheUsageFrom((response as any).usage)
				}
			} catch (e: any) {
				if (this.isAborting) {
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
		this.isAborting = true
		this.abortController?.abort()
	}
}

async function listModels(
	_connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	// Anthropic doesn't have a list models endpoint; return known models
	return { models: ANTHROPIC_MODELS }
}

async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	try {
		const apiKey = decryptApiKeyField(connection.extraJson?.apiKey) || ""
		if (!apiKey) {
			return { ok: false, error: "API key is required" }
		}
		const client = new Anthropic({ apiKey })
		// Cheapest possible call to verify the key works
		await client.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 1,
			messages: [{ role: "user", content: "hi" }]
		})
		return { ok: true }
	} catch (e: any) {
		return { ok: false, error: e.message || String(e) }
	}
}

const exports: AdapterExports = {
	Adapter: AnthropicAdapter,
	listModels,
	testConnection,
	connectionDefaults: CONNECTION_DEFAULTS[CONNECTION_TYPE.ANTHROPIC],
	samplingKeyMap: anthropicSamplingKeyMap
}

export default exports
