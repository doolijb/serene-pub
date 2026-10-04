import { describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			systemSettings: { findFirst: vi.fn(async () => null) }
		}
	}
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	batchEmbed: vi.fn(),
	embed: vi.fn(),
	getLoadedModelId: () => null
}))

const anthropicConstructorMock = vi.fn()
const messagesCreateMock = vi.fn()
// Hoisted like `create` above (it was a per-instance `vi.fn()`) so a test can
// hand the adapter a stream of its own to iterate.
const messagesStreamMock = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
	default: class {
		messages = {
			create: (...args: any[]) => messagesCreateMock(...args),
			stream: (...args: any[]) => messagesStreamMock(...args)
		}
		constructor(...args: any[]) {
			anthropicConstructorMock(...args)
		}
	}
}))

/**
 * The real enforcement engine, wrapped so a test can see what the adapter
 * DECLARED to it.
 *
 * Wrapped rather than replaced: every assertion below is about real negotiation,
 * real caps and the real refusal sentences. The only thing the wrapper adds is a
 * record of the options, which is where `transport` and `overheadBytes` live —
 * and those two are the whole of what this adapter knows and the engine cannot.
 */
const prepareCalls = vi.hoisted(
	() => [] as Array<{ inputs: unknown; opts: any }>
)
vi.mock("$lib/server/adapters/attachments", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/adapters/attachments")
		>()
	return {
		...actual,
		prepareAttachments: (io: any, inputs: any, opts: any = {}) => {
			prepareCalls.push({ inputs, opts })
			return actual.prepareAttachments(io, inputs, opts)
		}
	}
})

const { REDACTED_THINKING_NOTICE } = await import("./AnthropicAdapter")
const exportsDefault = (await import("./AnthropicAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "anthropic",
		baseUrl: "",
		model: "claude-sonnet-4-5",
		promptFormat: "openai",
		extraJson: { apiKey: "sk-ant-test", stream: false },
		...overrides
	}
}

function makeSession(): any {
	return {
		id: 1,
		userId: 1,
		sessionType: "session",
		metadata: { ragIgnored: true },
		sessionMessages: [],
		sessionCharacters: [],
		sessionPersonas: [],
		lorebook: {
			id: 1,
			lorebookBindings: [],
			worldLoreEntries: [],
			characterLoreEntries: [],
			historyEntries: []
		}
	}
}

function makeAdapter(
	connectionOverrides: Record<string, any> = {},
	// Already RESOLVED, the way an adapter receives it: a key being present is
	// the switch being on.
	sampling: Record<string, unknown> = {}
) {
	return new exportsDefault.Adapter({
		connection: makeConnection(connectionOverrides),
		// Empty is what "the context budget is switched off" resolves to now:
		sampling,
		systemPrompt: "Test system prompt.",
		session: makeSession(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.9
	}) as any
}

describe("AnthropicAdapter — base URL trailing-slash normalization", () => {
	test("getClient() (used by generateText()) omits baseURL when unset (SDK default)", async () => {
		anthropicConstructorMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "hi" }]
		})
		const adapter = makeAdapter({ baseUrl: "" })
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		await adapter.generateText()
		expect(anthropicConstructorMock).toHaveBeenCalledWith(
			expect.not.objectContaining({ baseURL: expect.anything() })
		)
	})

	test("generateText() normalizes a custom baseURL with a trailing slash", async () => {
		anthropicConstructorMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "hi" }]
		})
		const adapter = makeAdapter({
			baseUrl: "https://my-anthropic-proxy.example.com/"
		})
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		await adapter.generateText()
		expect(anthropicConstructorMock).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://my-anthropic-proxy.example.com"
			})
		)
	})
})

describe("AnthropicAdapter.mapSamplingConfig()", () => {
	test("maps the keys the resolved config contains; an absent key is not sent", () => {
		const adapter = makeAdapter()
		// `sampling` arrives resolved: topP is absent rather than disabled,
		// because absence is the only way "switched off" is expressed now.
		adapter.sampling = {
			temperature: 0.7
		}
		const result = adapter.mapSamplingConfig()
		expect(result.temperature).toBe(0.7)
		expect(result.top_p).toBeUndefined()
	})
})

describe("AnthropicAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})

	test("listModels() returns the known-Claude-models list without a network call", async () => {
		const result = await exportsDefault.listModels(makeConnection())
		expect(result.models.length).toBeGreaterThan(0)
		expect(result.models[0]).toHaveProperty("id")
	})
})

// ── Attachments ─────────────────────────────────────────────────────────────
//
// The first adapter with a vision path, so this is where the attachment
// machinery meets a real wire format. Five things earn a test, and each one is a
// failure that would look like the MODEL's fault from the outside:
//
//  1. **Order and interleaving.** The blocks come out in the order the list came
//     in, on the turn the files travel with, with the prose after them. A
//     reordering reads as the model misreading the pictures.
//  2. **The wire carries the NEGOTIATED format**, not what was handed in — and
//     an already-acceptable file is forwarded byte-for-byte rather than
//     re-encoded, because spending a generation of quality to satisfy a
//     preference order would be invisible in the payload.
//  3. **Base64 inflation is counted against BOTH limits.** Anthropic inlines
//     every file into JSON and publishes both numbers about that encoded body —
//     "10 MB (base64-encoded)" per image, 32MB per request — so the real
//     ceilings are 7.5MiB of image and about 24MiB of files. A 9MiB image and a
//     28MiB set of images are each refused HERE, with an explanation naming the
//     encoded size, rather than by the service with an error about a limit this
//     app said the request was inside of. Both boundaries are pinned from below
//     too, so an over-eager check cannot pass either.
//  4. **A refusal names the cap and cites it.** The engine's sentence, unedited,
//     rather than "request failed".
//  5. **Nothing is sent partially.** Every refusal above asserts the API was
//     never called: a request that quietly went out short of one attachment is
//     indistinguishable from a model ignoring it.
//
// ⚠ There is deliberately no "converted to a preferred format" case here, and
// it is not an omission. This entry accepts JPEG, PNG, GIF and WebP, and those
// are EXACTLY the four formats `$lib/server/media/convert` can route between —
// so for this adapter every convertible source is already acceptable and every
// unacceptable source (BMP, HEIC, AVIF, SVG, …) has no converter at all and is
// refused. Negotiation for Anthropic is therefore a passthrough or a refusal,
// both asserted below; the conversion arm of the engine is covered against a
// literal `AdapterIo` in `$lib/server/adapters/attachments.test.ts`, where it
// can be exercised without inventing a format table.

/** Distinct per file, so a reordering cannot pass, and never decoded: the
 *  passthrough arm classifies by MIME and does not look at the bytes. */
const fileBytes = (label: string) => Buffer.from(`bytes of ${label}`)

const MIB = 1024 * 1024

/** The API call the adapter made, or undefined if it never made one. */
const sentBody = () => messagesCreateMock.mock.calls[0]?.[0]

function send(
	attachments: any[],
	messages: any[] = [
		{ role: "system", content: "Be brief." },
		{ role: "user", content: "what is in these?" }
	]
) {
	messagesCreateMock.mockClear()
	prepareCalls.length = 0
	messagesCreateMock.mockResolvedValue({
		content: [{ type: "text", text: "ok" }]
	})
	const adapter = makeAdapter()
	adapter.withCompiledPrompt({
		prompt: undefined,
		messages,
		meta: {} as any
	} as any)
	adapter.withAttachments(attachments)
	return adapter.generateText()
}

describe("AnthropicAdapter — attachments on the wire", () => {
	test("declares that it sends them, which is what dispatch asks before handing any over", () => {
		expect(makeAdapter().consumesAttachments).toBe(true)
	})

	test("a request with no attachments is byte-for-byte the request it always was", async () => {
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "ok" }]
		})
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		await adapter.generateText()
		// A plain string, not a one-element block array: the text path must not
		// change shape because a vision path now exists beside it.
		expect(sentBody().messages).toEqual([
			{ role: "user", content: "hello" }
		])
	})

	test("emits one block per file, in list order, before the turn's text", async () => {
		const one = fileBytes("one")
		const two = fileBytes("two")
		const pdf = Buffer.from("%PDF-1.7\n%%EOF\n")

		await send([
			{ bytes: one, mime: "image/png", filename: "one.png" },
			// `image/jpg` is an alias the format table resolves; the block must
			// carry the canonical spelling the API accepts.
			{ bytes: two, mime: "image/jpg", filename: "two.jpg" },
			{ bytes: pdf, mime: "application/pdf", filename: "three.pdf" }
		])

		const messages = sentBody().messages
		// The system message is still hoisted out, and the user turn is the one
		// carrying the files.
		expect(sentBody().system).toBe("Be brief.")
		expect(messages).toHaveLength(1)
		expect(messages[0].role).toBe("user")

		const content = messages[0].content
		expect(content.map((b: any) => b.type)).toEqual([
			"image",
			"image",
			"document",
			"text"
		])
		// Order, asserted on the BYTES rather than on the count: three blocks in
		// the wrong order have the same types and the same length.
		expect(content[0].source.data).toBe(one.toString("base64"))
		expect(content[1].source.data).toBe(two.toString("base64"))
		expect(content[2].source.data).toBe(pdf.toString("base64"))
		expect(content[3].text).toBe("what is in these?")
	})

	test("carries the negotiated media type and forwards acceptable bytes untouched", async () => {
		const jpeg = fileBytes("a jpeg")
		await send([{ bytes: jpeg, mime: "image/jpg" }])

		const block = sentBody().messages[0].content[0]
		expect(block.source).toEqual({
			type: "base64",
			// What the file IS, per the format table — not the alias it arrived as.
			media_type: "image/jpeg",
			data: jpeg.toString("base64")
		})
		// Byte-identical: an accepted format is never re-encoded toward the
		// preference order, which would cost quality for nothing.
		expect(Buffer.from(block.source.data, "base64").equals(jpeg)).toBe(true)
	})

	test("a turn with nothing to say sends the files and no empty text block", async () => {
		// The API rejects an empty text block, and "here is a picture" with no
		// question is a legitimate request.
		await send(
			[{ bytes: fileBytes("only"), mime: "image/png" }],
			[{ role: "user", content: "" }]
		)
		expect(sentBody().messages[0].content.map((b: any) => b.type)).toEqual([
			"image"
		])
	})

	test("declares base64 as its transport, and measures the rest of the request rather than guessing it", async () => {
		const attachment = [{ bytes: fileBytes("x"), mime: "image/png" }]
		await send(attachment, [{ role: "user", content: "short" }])
		const short = prepareCalls.at(-1)!.opts

		await send(attachment, [
			{ role: "user", content: "short" + "y".repeat(1000) }
		])
		const long = prepareCalls.at(-1)!.opts

		// The transport is a property of the wire format, so the adapter is what
		// states it; the engine cannot know that this API inlines base64.
		expect(short.transport).toBe("base64")
		// And the overhead is the request as it actually stands — a thousand more
		// characters of prompt is a thousand more bytes of overhead, which a
		// constant or a guess could not track.
		expect(long.overheadBytes - short.overheadBytes).toBe(1000)
		// Never the files themselves: the engine measures those, and counting
		// them twice would refuse requests that fit.
		expect(short.overheadBytes).toBeLessThan(2000)
	})

	test("refuses 28MB of images because base64 makes it a 39MB request", async () => {
		// The whole point of `transport` at the request level. Each of the four
		// files is inside the per-image limit even once encoded, and together
		// they are inside the 32MB request cap AS FILES — it is only the base64
		// the wire format inlines them as that breaks it.
		const each = 7 * MIB
		const raw = 4 * each
		expect(raw).toBeLessThan(32 * MIB)
		expect(4 * Math.ceil(raw / 3)).toBeGreaterThan(32 * MIB)
		const four = () =>
			Array.from({ length: 4 }, (_, i) => ({
				bytes: Buffer.alloc(each, i + 1),
				mime: "image/png"
			}))

		await expect(send(four())).rejects.toThrow(
			/inflated by base64.*33554432 \(Anthropic API docs: maximum 32MB total request size\)/s
		)
		// Both numbers are in the sentence: what the request weighs encoded, and
		// what the files themselves weigh — otherwise "28MB is over a 32MB limit"
		// reads as a bug in this app.
		await expect(send(four())).rejects.toThrow(
			new RegExp(`${raw} bytes as files`)
		)
		expect(messagesCreateMock).not.toHaveBeenCalled()
	})

	test("refuses a 9MB image, whose base64 is over the 10MB per-image limit", async () => {
		// ⚠ The docs give this limit as "10 MB (base64-encoded)", so it is not a
		// limit on the file: 9437184 bytes of PNG is 12582912 bytes of base64,
		// and the effective ceiling on the file is 7864320 (7.5MiB). Measuring
		// the file instead would send this and let Anthropic reject it.
		const big = Buffer.alloc(9 * MIB, 4)
		expect(4 * Math.ceil(big.length / 3)).toBeGreaterThan(10 * MIB)

		await expect(
			send([{ bytes: big, mime: "image/png", filename: "huge.png" }])
		).rejects.toThrow(
			/huge\.png \(attachment 1\) is 9437184 bytes — 12582912 bytes once base64-encoded, which is what this backend's limit is measured on — and this backend takes at most 10485760 \(Anthropic vision docs: maximum 10MB per image, measured base64-encoded\) bytes per image\./
		)
		expect(messagesCreateMock).not.toHaveBeenCalled()
	})

	test("sends a 7MB image, which encodes to just under the same limit", async () => {
		// The boundary from below, so the check above cannot pass by refusing
		// everything. 7340032 bytes encodes to 9786712 — inside 10485760, where
		// 7864320 bytes of file would sit exactly on it.
		const fits = Buffer.alloc(7 * MIB, 6)
		expect(4 * Math.ceil(fits.length / 3)).toBeLessThan(10 * MIB)
		await send([{ bytes: fits, mime: "image/png" }])
		expect(sentBody().messages[0].content[0].type).toBe("image")
	})

	test("refuses 101 images naming both numbers and where the limit came from", async () => {
		await expect(
			send(
				Array.from({ length: 101 }, (_, i) => ({
					bytes: fileBytes(`img${i}`),
					mime: "image/png"
				}))
			)
		).rejects.toThrow(
			/101 image files.*100 \(Anthropic vision docs: up to 100 images per API request on 200k-context models\)/s
		)
		// Not sliced to a hundred: a request that quietly lost one attachment is
		// indistinguishable from a model ignoring it.
		expect(messagesCreateMock).not.toHaveBeenCalled()
	})

	test("refuses a format the API will not take and this build cannot convert", async () => {
		await expect(
			send([
				{
					bytes: fileBytes("a bitmap"),
					mime: "image/bmp",
					filename: "scan.bmp"
				}
			])
		).rejects.toThrow(/scan\.bmp \(attachment 1\) cannot be sent/)
		expect(messagesCreateMock).not.toHaveBeenCalled()
	})

	test("refuses a kind the wire format has no block for, rather than sending it as something else", async () => {
		// This entry declares no limits for audio, and "no declared limit" means
		// the engine forwards it — a statement about counts and sizes, not a
		// promise that the API can express the file. The adapter is the last
		// honest place to say no.
		await expect(
			send([
				{
					bytes: fileBytes("a recording"),
					mime: "audio/wav",
					filename: "clip.wav"
				}
			])
		).rejects.toThrow(/clip\.wav \(attachment 1\).*images and PDFs/s)
		expect(messagesCreateMock).not.toHaveBeenCalled()
	})
})

/**
 * `redacted_thinking` — the reasoning block with nothing readable in it.
 *
 * Anthropic returns one when its safety systems flag part of the model's
 * internal reasoning: the block carries an encrypted `data` blob and no text.
 * The adapter matched only `type === "thinking"` / `"text"` (and
 * `thinking_delta` / `text_delta` while streaming), so a redacted block simply
 * vanished — the user enabled Extended Thinking, the model DID think, and the
 * panel stayed empty with nothing saying why.
 *
 * The choice made here: surface a short fixed NOTICE, never the `data` blob.
 * The blob is opaque ciphertext only Anthropic can read, can run to kilobytes,
 * and would be persisted into the message record for no one's benefit; an empty
 * panel, meanwhile, is indistinguishable from "thinking is broken", which is
 * exactly the report that started this work.
 *
 * ⚠ Shape confirmed against the installed SDK (@anthropic-ai/sdk 0.105.0):
 * `RawContentBlockDelta` is `TextDelta | InputJSONDelta | CitationsDelta |
 * ThinkingDelta | SignatureDelta` — there is NO redacted-thinking delta — while
 * `RawContentBlockStartEvent.content_block` does include `RedactedThinkingBlock`.
 * So a redacted block arrives whole, on `content_block_start`.
 */
describe("AnthropicAdapter — redacted_thinking", () => {
	const BLOB = "EqoBCkYIBBgCKkBmx4Onc0RedactedCiphertextNotForHumans=="

	function mockCompilePrompt(adapter: any) {
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
	}

	function eventStream(events: any[]) {
		return {
			async *[Symbol.asyncIterator]() {
				for (const event of events) yield event
			},
			controller: { abort: vi.fn() }
		}
	}

	test("non-streaming: a redacted block is reported, and its ciphertext is not", async () => {
		messagesCreateMock.mockResolvedValueOnce({
			content: [
				{ type: "redacted_thinking", data: BLOB },
				{ type: "text", text: "Hello there." }
			]
		})
		const adapter = makeAdapter()
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.completionResult).toBe("Hello there.")
		expect(result.reasoningContent).toBe(REDACTED_THINKING_NOTICE)
		expect(result.reasoningContent).not.toContain(BLOB)
	})

	test("non-streaming: a redacted block alongside a readable one keeps both, on their own lines", async () => {
		messagesCreateMock.mockResolvedValueOnce({
			content: [
				{ type: "thinking", thinking: "Pondering deeply." },
				{ type: "redacted_thinking", data: BLOB },
				{ type: "text", text: "Hello there." }
			]
		})
		const adapter = makeAdapter()
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.reasoningContent).toBe(
			`Pondering deeply.\n${REDACTED_THINKING_NOTICE}`
		)
	})

	test("non-streaming: reasoningContent stays undefined when nothing was thought", async () => {
		messagesCreateMock.mockResolvedValueOnce({
			content: [{ type: "text", text: "Hello there." }]
		})
		const adapter = makeAdapter()
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.reasoningContent).toBeUndefined()
	})

	test("streaming: a redacted block arrives on content_block_start and reaches reasoningCb", async () => {
		messagesStreamMock.mockReturnValueOnce(
			eventStream([
				{
					type: "content_block_start",
					index: 0,
					content_block: { type: "redacted_thinking", data: BLOB }
				},
				{
					type: "content_block_delta",
					index: 1,
					delta: { type: "text_delta", text: "Hello there." }
				}
			])
		)
		const adapter = makeAdapter({
			extraJson: { apiKey: "sk-ant-test", stream: true }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		let content = ""
		let reasoning = ""
		await (result.completionResult as any)(
			(chunk: string) => {
				content += chunk
			},
			(chunk: string) => {
				reasoning += chunk
			}
		)
		expect(reasoning).toBe(REDACTED_THINKING_NOTICE)
		expect(reasoning).not.toContain(BLOB)
		expect(content).toBe("Hello there.")
	})

	test("streaming: readable thinking then a redacted block — the notice does not glue onto the prose", async () => {
		messagesStreamMock.mockReturnValueOnce(
			eventStream([
				{
					type: "content_block_start",
					index: 0,
					content_block: { type: "thinking", thinking: "" }
				},
				{
					type: "content_block_delta",
					index: 0,
					delta: { type: "thinking_delta", thinking: "Pondering." }
				},
				{
					type: "content_block_start",
					index: 1,
					content_block: { type: "redacted_thinking", data: BLOB }
				},
				{
					type: "content_block_delta",
					index: 2,
					delta: { type: "text_delta", text: "Hello there." }
				}
			])
		)
		const adapter = makeAdapter({
			extraJson: { apiKey: "sk-ant-test", stream: true }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		let reasoning = ""
		await (result.completionResult as any)(
			() => {},
			(chunk: string) => {
				reasoning += chunk
			}
		)
		expect(reasoning).toBe(`Pondering.\n${REDACTED_THINKING_NOTICE}`)
	})

	test("streaming: an ordinary content_block_start does not emit a notice", async () => {
		messagesStreamMock.mockReturnValueOnce(
			eventStream([
				{
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" }
				},
				{
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Hello there." }
				}
			])
		)
		const adapter = makeAdapter({
			extraJson: { apiKey: "sk-ant-test", stream: true }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		let content = ""
		let reasoning = ""
		await (result.completionResult as any)(
			(chunk: string) => {
				content += chunk
			},
			(chunk: string) => {
				reasoning += chunk
			}
		)
		expect(reasoning).toBe("")
		expect(content).toBe("Hello there.")
	})
})

/**
 * Continuing a partial reply — the Messages API's own prefill, not a plea.
 *
 * `buildAnthropicMessages` used to append `{role:"user", content:"Please
 * continue."}` whenever the payload ended on an assistant turn. That is not a
 * continuation: the model reads a fresh instruction and starts a new reply,
 * which `joinContinuation` then glues onto the partial. The Messages API takes
 * a trailing assistant turn as a PREFILL — the model writes the next characters
 * of that turn — so the seed goes as-is.
 */
describe("AnthropicAdapter — continuing a reply", () => {
	/** Send a payload whose last turn is the assistant seed being continued. */
	async function continueWith(
		seed: string,
		connectionOverrides: Record<string, any> = {}
	) {
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: " and then it rained." }]
		})
		const adapter = makeAdapter(connectionOverrides)
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [
				{ role: "system", content: "Be brief." },
				{ role: "user", content: "What happened next?" },
				{ role: "assistant", content: seed }
			],
			meta: {} as any
		} as any)
		await adapter.generateText()
		return messagesCreateMock.mock.calls[0]?.[0]
	}

	test("the seed stays the LAST message, and no user turn is invented", async () => {
		const body = await continueWith("She opened the door")
		expect(body.messages.at(-1)).toEqual({
			role: "assistant",
			content: "She opened the door"
		})
		expect(JSON.stringify(body.messages)).not.toContain("Please continue")
	})

	test("trailing whitespace is stripped — the prefill validator rejects it", async () => {
		// Anthropic's own rule for a final `text` block on a prefilled turn.
		// Sending it back verbatim is a 400 on a request that looks fine here.
		const body = await continueWith("She opened the door  \n")
		expect(body.messages.at(-1).content).toBe("She opened the door")
	})

	test("an assistant turn in the MIDDLE is still followed by the user's", async () => {
		// Few-shot and ordinary history: only a TRAILING assistant turn is a
		// prefill, and merging or padding those would rewrite the conversation.
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "ok" }]
		})
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello" },
				{ role: "user", content: "again" }
			],
			meta: {} as any
		} as any)
		await adapter.generateText()
		const body = messagesCreateMock.mock.calls[0]?.[0]
		expect(body.messages.map((m: any) => m.role)).toEqual([
			"user",
			"assistant",
			"user"
		])
	})

	test("a seed that is only whitespace is dropped rather than sent empty", async () => {
		// The API refuses an empty text block, and an all-whitespace prefill is
		// one after the strip. Dropping the turn leaves a well-formed request
		// that generates from the user's turn, which is what an empty partial
		// means anyway.
		const body = await continueWith("   ")
		expect(body.messages.at(-1).role).toBe("user")
		expect(JSON.stringify(body.messages)).not.toContain("Please continue")
	})

	test("the adapter reports HOW it continues, and it is a real prefill", async () => {
		const adapter = makeAdapter() as any
		expect(adapter.continuationRoute.kind).toBe("prefill")
	})
})

/**
 * Native tool calling (20 §9). The Messages API differs from OpenAI's in more
 * than a wrapper — `input_schema`, and the call arrives as a content BLOCK
 * interleaved with the prose rather than beside it — so both halves are pinned.
 */
describe("AnthropicAdapter — tools on the wire", () => {
	const TOOLS = [
		{
			name: "get_entry",
			description: "Read one entry.",
			parameters: {
				type: "object",
				properties: { id: { type: "integer" } }
			}
		}
	]

	const primed = (overrides: Record<string, any> = {}) => {
		const adapter = makeAdapter(overrides)
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "who leads them?" }],
			meta: {} as any
		} as any)
		return adapter
	}

	test("sends the declarations under input_schema, not parameters", async () => {
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({ content: [] })
		const adapter = primed()
		adapter.withTools(TOOLS)
		await adapter.generateText()

		const [params] = messagesCreateMock.mock.calls.at(-1)!
		expect(params.tools).toEqual([
			{
				name: "get_entry",
				description: "Read one entry.",
				input_schema: TOOLS[0]!.parameters
			}
		])
	})

	test("a request with no tools carries no tools key", async () => {
		// Present-but-empty costs a tool-use system preamble the model then
		// reads on every turn.
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "hi" }]
		})
		await primed().generateText()
		const [params] = messagesCreateMock.mock.calls.at(-1)!
		expect("tools" in params).toBe(false)
	})

	test("reads a tool_use block, and keeps the prose either side of it", async () => {
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [
				{ type: "text", text: "Let me check. " },
				{ type: "tool_use", name: "get_entry", input: { id: 7 } },
				{ type: "text", text: "One moment." }
			]
		})
		const adapter = primed()
		adapter.withTools(TOOLS)
		const result = await adapter.generateText()

		expect(result.toolCall).toEqual({ tool: "get_entry", args: { id: 7 } })
		expect(result.completionResult).toBe("Let me check. One moment.")
	})

	test("no call is null — the loop's predicate reads it", async () => {
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "Captain Vell." }]
		})
		const adapter = primed()
		adapter.withTools(TOOLS)
		expect((await adapter.generateText()).toolCall).toBeNull()
	})
})

/**
 * The same call, off a STREAMING request (20 §9).
 *
 * A tool call arrives here as a content BLOCK opened by `content_block_start`,
 * filled by `input_json_delta` fragments and closed by `content_block_stop` —
 * three events where the non-streaming branch has one object. A connection with
 * `extraJson.stream` surfaced none of it, so a tool loop's predicate never fired
 * and the loop ran to its ceiling.
 */
describe("AnthropicAdapter — tool calls off the stream", () => {
	const TOOLS = [
		{
			name: "get_entry",
			description: "Read one entry.",
			parameters: {
				type: "object",
				properties: { id: { type: "integer" } }
			}
		}
	]

	function eventStream(events: any[]) {
		return {
			async *[Symbol.asyncIterator]() {
				for (const event of events) yield event
			},
			controller: { abort: vi.fn() }
		}
	}

	const streamingAdapter = () => {
		const adapter = makeAdapter({
			extraJson: { apiKey: "sk-ant-test", stream: true }
		})
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "who leads them?" }],
			meta: {} as any
		} as any)
		adapter.withTools(TOOLS)
		return adapter
	}

	const drain = async (result: any) => {
		let content = ""
		await result.completionResult((chunk: string) => {
			content += chunk
		})
		return content
	}

	test("partial_json fragments become the call, and the prose either side survives", async () => {
		messagesStreamMock.mockReturnValueOnce(
			eventStream([
				{
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Let me check. " }
				},
				{
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "tool_use",
						id: "toolu_1",
						name: "get_entry",
						input: {}
					}
				},
				{
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: '{"id"' }
				},
				{
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: ": 7}" }
				},
				{ type: "content_block_stop", index: 1 },
				{
					type: "content_block_delta",
					index: 2,
					delta: { type: "text_delta", text: "One moment." }
				}
			])
		)
		const adapter = streamingAdapter()
		const result = await adapter.generateText()
		expect(await drain(result)).toBe("Let me check. One moment.")
		expect(adapter.streamedToolCall).toEqual({
			tool: "get_entry",
			args: { id: 7 }
		})
	})

	test("a block that carried no fragments at all still calls the tool", async () => {
		// A zero-argument tool sends `input: {}` and no delta whatsoever, so an
		// accumulator that waited for JSON would lose the turn entirely.
		messagesStreamMock.mockReturnValueOnce(
			eventStream([
				{
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "toolu_2",
						name: "get_entry",
						input: {}
					}
				},
				{ type: "content_block_stop", index: 0 }
			])
		)
		const adapter = streamingAdapter()
		await drain(await adapter.generateText())
		expect(adapter.streamedToolCall).toEqual({
			tool: "get_entry",
			args: {}
		})
	})

	test("the first block only, even when the model opens two", async () => {
		messagesStreamMock.mockReturnValueOnce(
			eventStream([
				{
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						name: "get_entry",
						input: {}
					}
				},
				{
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "input_json_delta",
						partial_json: '{"id":7}'
					}
				},
				{ type: "content_block_stop", index: 0 },
				{
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "tool_use",
						name: "get_entry",
						input: {}
					}
				},
				{
					type: "content_block_delta",
					index: 1,
					delta: {
						type: "input_json_delta",
						partial_json: '{"id":9}'
					}
				},
				{ type: "content_block_stop", index: 1 }
			])
		)
		const adapter = streamingAdapter()
		await drain(await adapter.generateText())
		expect(adapter.streamedToolCall).toEqual({
			tool: "get_entry",
			args: { id: 7 }
		})
	})

	test("a stream that called nothing leaves it null, not undefined", async () => {
		messagesStreamMock.mockReturnValueOnce(
			eventStream([
				{
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Captain Vell." }
				}
			])
		)
		const adapter = streamingAdapter()
		await drain(await adapter.generateText())
		expect(adapter.streamedToolCall).toBeNull()
	})
})

/**
 * The prompt cache, recorded (ruled "later, non-disruptive").
 *
 * Anthropic is the one service here that reports both halves — what was READ
 * from the cache and what was WRITTEN to it — and the one whose `input_tokens`
 * EXCLUDES both, so the prompt total is the sum of the three rather than the
 * field of that name.
 */
describe("AnthropicAdapter — prompt cache accounting", () => {
	const primed = () => {
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		return adapter
	}

	test("reads both cache counts, and totals the prompt across all three fields", async () => {
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "hi" }],
			usage: {
				input_tokens: 120,
				output_tokens: 8,
				cache_read_input_tokens: 3000,
				cache_creation_input_tokens: 500
			}
		})
		const result = await primed().generateText()
		expect(result.tokensCached).toBe(3000)
		expect(result.tokensCacheWrite).toBe(500)
		expect(result.tokensPrompt).toBe(3620)
	})

	test("streaming: message_start carries the same accounting, unasked", async () => {
		// This is the one service that reports the input side of a stream
		// without being asked for it — the OpenAI envelope carries `usage` on a
		// stream only when the request opted in, which this app does not do.
		messagesStreamMock.mockReturnValueOnce({
			async *[Symbol.asyncIterator]() {
				yield {
					type: "message_start",
					message: {
						usage: {
							input_tokens: 120,
							cache_read_input_tokens: 3000,
							cache_creation_input_tokens: 500
						}
					}
				}
				yield {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "hi" }
				}
			},
			controller: { abort: vi.fn() }
		})
		const adapter = makeAdapter({
			extraJson: { apiKey: "sk-ant-test", stream: true }
		})
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		const result = await adapter.generateText()
		await result.completionResult(() => {})
		// Read after the drain, like the tool call beside it.
		expect(adapter.streamedUsage).toEqual({
			tokensPrompt: 3620,
			tokensCached: 3000,
			tokensCacheWrite: 500
		})
	})

	test("usage without either cache field reports the prompt and nothing else", async () => {
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "hi" }],
			usage: { input_tokens: 120, output_tokens: 8 }
		})
		const result = await primed().generateText()
		expect(result.tokensPrompt).toBe(120)
		expect(result.tokensCached).toBeUndefined()
		expect(result.tokensCacheWrite).toBeUndefined()
	})
})

/**
 * The node's `streaming` parameter, at the one line that reads it.
 *
 * This adapter's own default is `?? true`, so `auto` has to resolve to the
 * connection's answer rather than to a constant in either direction: an
 * Anthropic connection nobody has configured streams, and one with the flag
 * cleared does not. Read off `completionResult`, because that is the fact the
 * dispatch branches on.
 */
describe("AnthropicAdapter — the node's streaming parameter", () => {
	const sendWith = async (
		extraJson: Record<string, unknown>,
		mode?: "auto" | "off"
	) => {
		messagesCreateMock.mockReset()
		// Only the non-streaming branch reaches this: a streaming request
		// returns a closure and calls the SDK when somebody drains it.
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "ok" }]
		})
		const adapter = makeAdapter({
			extraJson: { apiKey: "sk-ant-test", ...extraJson }
		})
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "who leads them?" }],
			meta: {} as any
		} as any)
		if (mode) adapter.withStreaming(mode)
		const result = await adapter.generateText()
		return typeof result.completionResult === "function"
			? "streamed"
			: "one request"
	}

	test("auto answers whatever the connection says, both ways", async () => {
		expect(await sendWith({ stream: true }, "auto")).toBe("streamed")
		expect(await sendWith({ stream: false }, "auto")).toBe("one request")
	})

	test("a node that hands nothing over is the same as auto", async () => {
		// The unset case is the one that matters here: `?? true` means an
		// untouched Anthropic connection streams, and it has to keep doing so.
		expect(await sendWith({})).toBe("streamed")
		expect(await sendWith({ stream: false })).toBe("one request")
	})

	test("off sends one request even on a streaming connection", async () => {
		expect(await sendWith({ stream: true }, "off")).toBe("one request")
	})
})

/**
 * Reasoning, as a SAMPLING parameter (ruling 2026-09-12).
 *
 * This used to be `extraJson.thinking` and `extraJson.thinkingBudget` on the
 * CONNECTION, which gave every step sharing an Anthropic row the same answer.
 * The two halves of the vocabulary land on one field here, and the Messages API
 * refuses temperature/top_p/top_k beside an enabled one — which is why those
 * three are RECORDED rather than quietly left out.
 */
describe("AnthropicAdapter — reasoning on the wire", () => {
	async function requestFor(
		sampling: Record<string, unknown>,
		connectionOverrides: Record<string, any> = {}
	) {
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({
			content: [{ type: "text", text: "ok" }]
		})
		const adapter = makeAdapter(
			{
				extraJson: { apiKey: "sk-test", stream: false },
				...connectionOverrides
			},
			sampling
		)
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		await adapter.generateText()
		return { req: messagesCreateMock.mock.calls[0][0], adapter }
	}

	test("a config that never enabled it sends no thinking block and no beta", async () => {
		// Today's bytes, including for a row whose `extraJson` still carries the
		// old connection-level keys: they are read by nothing now.
		const { req, adapter } = await requestFor(
			{ temperature: 0.6 },
			{ extraJson: { apiKey: "sk-test", stream: false, thinking: true } }
		)
		expect(req).not.toHaveProperty("thinking")
		expect(req).not.toHaveProperty("betas")
		expect(req.temperature).toBe(0.6)
		expect(adapter.ignoredSamplers).toEqual([])
	})

	test("off says so out loud, and is still an ordinary request", async () => {
		const { req, adapter } = await requestFor({
			reasoning: "off",
			temperature: 0.6
		})
		expect(req.thinking).toEqual({ type: "disabled" })
		// `disabled` is not extended thinking, so the beta header and the
		// sampler restriction both stay off.
		expect(req).not.toHaveProperty("betas")
		expect(req.temperature).toBe(0.6)
		expect(adapter.ignoredSamplers).toEqual([])
	})

	test("a level becomes a budget from the shared table", async () => {
		const budgets = { low: 2048, medium: 8000, high: 32000 } as const
		for (const [level, budget] of Object.entries(budgets)) {
			const { req } = await requestFor({ reasoning: level })
			expect(req.thinking).toEqual({
				type: "enabled",
				budget_tokens: budget
			})
			expect(req.betas).toEqual(["interleaved-thinking-2025-05-14"])
		}
	})

	test("a budget set outright beats the level's table entry", async () => {
		const { req } = await requestFor({
			reasoning: "medium",
			reasoningBudget: 12345
		})
		expect(req.thinking).toEqual({
			type: "enabled",
			budget_tokens: 12345
		})
	})

	test("the three samplers thinking forbids are dropped AND recorded", async () => {
		// The service refuses the request outright if they are present, so
		// dropping them is not a preference. Without the record the only
		// evidence is an absence in the body, and "I set temperature and
		// nothing changed" has no answer anywhere on the screen.
		const { req, adapter } = await requestFor({
			reasoning: "high",
			temperature: 0.6,
			topP: 0.9,
			topK: 40
		})
		expect(req).not.toHaveProperty("temperature")
		expect(req).not.toHaveProperty("top_p")
		expect(req).not.toHaveProperty("top_k")
		expect(adapter.ignoredSamplers).toEqual(["temperature", "topP", "topK"])
	})
})

// ── Attachments per message (PLAN-composer-attachments §3.6) ────────────────
describe("AnthropicAdapter — attachments per message", () => {
	const run = async (messages: any[], perMessage: any[][], attachments: any[] = []) => {
		messagesCreateMock.mockClear()
		messagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "ok" }] })
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({ prompt: undefined, messages, meta: {} as any } as any)
		adapter.withMessageAttachments(perMessage)
		if (attachments.length) adapter.withAttachments(attachments)
		await adapter.generateText()
		return sentBody().messages
	}

	test("each history turn carries its own files; request-level ones go on the last user turn", async () => {
		const sent = await run(
			[
				{ role: "system", content: "Be brief." },
				{ role: "user", content: "Ash: look" },
				{ role: "assistant", content: "Mara: nice" },
				{ role: "user", content: "Ash: and now?" },
				{ role: "assistant", content: "Mara:" }
			],
			[[], [{ bytes: fileBytes("cat"), mime: "image/png", filename: "cat.png" }], [], [], []],
			[{ bytes: fileBytes("frame"), mime: "image/png" }]
		)
		expect(sent[0].content.map((b: any) => b.type)).toEqual(["image", "text"])
		expect(sent[0].content[0].source.data).toBe(fileBytes("cat").toString("base64"))
		expect(sent[0].content[1]).toEqual({ type: "text", text: "Ash: look" })
		// The assistant turn is untouched text; the second user turn gets the frame.
		expect(sent[1]).toEqual({ role: "assistant", content: "Mara: nice" })
		expect(sent[2].content.map((b: any) => b.type)).toEqual(["image", "text"])
		expect(sent[2].content[0].source.data).toBe(fileBytes("frame").toString("base64"))
		// The prefill stays a plain string.
		expect(sent[3]).toEqual({ role: "assistant", content: "Mara:" })
	})

	test("a file on an assistant line travels with the next user turn", async () => {
		const sent = await run(
			[
				{ role: "user", content: "Ash: draw it" },
				{ role: "assistant", content: "Mara: here" },
				{ role: "user", content: "Ash: thanks" }
			],
			[[], [{ bytes: fileBytes("art"), mime: "image/png" }], []]
		)
		expect(sent[0]).toEqual({ role: "user", content: "Ash: draw it" })
		expect(sent[1]).toEqual({ role: "assistant", content: "Mara: here" })
		expect(sent[2].content.map((b: any) => b.type)).toEqual(["image", "text"])
	})
})
