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
import { anthropicSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"

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
				result[anthropicSamplingKeyMap[key]] = value
			}
		}
		return result
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

		// Anthropic requires the last message to be from user
		// If it's assistant, add a placeholder user message
		if (
			messages.length > 0 &&
			messages[messages.length - 1].role === "assistant"
		) {
			messages.push({ role: "user", content: "Please continue." })
		}

		// Must have at least one user message
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
		const stream = this.connection.extraJson?.stream ?? true
		const useThinking = this.connection.extraJson?.thinking ?? false
		const thinkingBudget = this.connection.extraJson?.thinkingBudget ?? 8000

		const compiledPrompt: CompiledPrompt = await this.compilePrompt({
			useSessionFormat: true
		})

		const { system, messages } = this.buildAnthropicMessages(compiledPrompt)

		const samplingConfig = this.mapSamplingConfig()
		const maxTokens: number =
			samplingConfig.max_tokens || this.sampling.responseTokens || 1024

		// Extended thinking: requires betas header and disables temperature/top_p/top_k
		const thinkingParam: Anthropic.ThinkingConfigParam | undefined =
			useThinking
				? { type: "enabled", budget_tokens: thinkingBudget }
				: undefined

		// When thinking is enabled, sampling params are restricted
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
							{
								...baseParams,
								...(thinkingParam
									? {
											betas: [
												"interleaved-thinking-2025-05-14"
											]
										}
									: {})
							} as any,
							{ signal: this.abortController?.signal }
						)

						for await (const event of streamResp) {
							if (this.isAborting) {
								streamResp.controller.abort()
								return
							}

							if (event.type === "content_block_delta") {
								const delta = event.delta as any
								if (
									delta.type === "thinking_delta" &&
									delta.thinking
								) {
									thinkingCb?.(delta.thinking)
								} else if (
									delta.type === "text_delta" &&
									delta.text
								) {
									contentCb(delta.text)
								}
							}
						}
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
					{
						...baseParams,
						...(thinkingParam
							? { betas: ["interleaved-thinking-2025-05-14"] }
							: {})
					} as any,
					{ signal: this.abortController?.signal }
				)

				let content = ""
				let thinking = ""

				for (const block of response.content) {
					if ((block as any).type === "thinking") {
						thinking += (block as any).thinking || ""
					} else if (block.type === "text") {
						content += block.text
					}
				}

				return {
					completionResult: content,
					compiledPrompt,
					isAborted: this.isAborting,
					thinkingContent: thinking || undefined
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
