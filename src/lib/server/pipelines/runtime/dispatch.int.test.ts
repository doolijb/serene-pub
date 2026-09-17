/**
 * Dispatch: the same adapters, reached with a prompt built elsewhere.
 *
 * The adapter is a fake, because what is under test is not whether KoboldCPP
 * answers — it is that the payload arrives unmodified, that streamed chunks
 * reach both the sink and the port, that an abort reaches the adapter's own
 * flag, and that **no connection material comes back**. The last one is the
 * reason this file exists at all: it is a property that can only be broken
 * silently, since a leak looks exactly like a working generation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

const SECRET_KEY = "sk-do-not-leak-9f8e7d"
const SECRET_URL = "http://192.168.1.50:5001"

const connection = {
	id: 1,
	type: "koboldcpp",
	name: "Local Kobold",
	baseUrl: SECRET_URL,
	apiKey: SECRET_KEY,
	model: "some-model-q4",
	promptFormat: "vicuna",
	tokenCounter: "estimate"
}

/** What the fake adapter saw, so a test can assert on it after the fact. */
let seen: {
	compiledPrompt?: unknown
	constructedWith?: any
	aborted?: boolean
	attachments?: unknown
	tools?: unknown
	streaming?: unknown
} = {}
/**
 * Whether the stand-in adapter has a vision path this run.
 *
 * A `let` because both answers are ordinary: one adapter sends attachments
 * today and six do not, and what dispatch does with the difference — refuse
 * rather than send a request that quietly lost its files — is the thing under
 * test.
 */
let adapterSendsAttachments = true
let adapterSendsTools = true
/**
 * What the stand-in recorded of its own send, if anything.
 *
 * A `let` because both answers are ordinary: an adapter records one exchange
 * per call it makes, and a fake that recorded none is what every other case in
 * this file is.
 */
let adapterExchanges: any[] = []
let mode:
	| "text"
	| "stream"
	| "empty"
	| "abort"
	| "inlineThinking"
	| "inlineThinkingStream"
	| "prefilledClose"
	| "nativeAndInline"
	| "streamWithThinkingContent"
	| "streamWithToolCall"
	| "toolCallNoStream" = "text"
let connectionForRun: any = connection

/** Pinned to the real action, so a rename cannot pass here — fakeTextAdapter.ts. */
class FakeAdapter implements FakeTextAdapter {
	injected: any
	aborted = false
	promptBuilder: any = {}
	constructor(params: any) {
		seen.constructedWith = params
	}
	/** The queue's pre-send hook — a managed backend loads its model here. */
	async preflight() {}
	/** The composed stop list. Recorded so a test can assert what was handed over. */
	stops: any
	/** Filled while the stream runs, like the real adapters fill it. */
	streamedToolCall: any = null
	/** What this send put on the wire, the way the base class records it. */
	get exchanges() {
		return adapterExchanges
	}
	get lastExchange() {
		return adapterExchanges[adapterExchanges.length - 1]
	}
	withStops(s: any) {
		this.stops = s
		return this
	}
	/**
	 * The node's send shape, recorded so a test can assert what was handed
	 * over — and, just as load-bearing, what was NOT. `auto` must reach no
	 * adapter at all: it is the adapter's own answer, and a second way to
	 * spell it is a second place for the per-service default to disagree.
	 */
	withStreaming(mode: any) {
		seen.streaming = mode
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		seen.compiledPrompt = p
		return this
	}
	get consumesAttachments() {
		return adapterSendsAttachments
	}
	/**
	 * Whether the stand-in has tool code this run.
	 *
	 * A `let` for the same reason `adapterSendsAttachments` is one: three
	 * adapters send tools and four do not, and what dispatch does with the
	 * difference — refuse rather than send a request that quietly lost its
	 * declarations — is the thing under test.
	 */
	get consumesTools() {
		return adapterSendsTools
	}
	withTools(tools: any) {
		seen.tools = tools
		return this
	}
	withAttachments(inputs: any) {
		seen.attachments = inputs
		return this
	}
	abort() {
		this.aborted = true
		seen.aborted = true
	}
	async generateText() {
		if (mode === "empty")
			return {
				completionResult: "",
				compiledPrompt: this.injected,
				isAborted: false
			}
		if (mode === "abort")
			return {
				completionResult: "partial",
				compiledPrompt: this.injected,
				isAborted: true
			}
		if (mode === "stream")
			return {
				compiledPrompt: this.injected,
				isAborted: false,
				completionResult: async (
					onContent: (c: string) => void,
					onThinking?: (c: string) => void
				) => {
					onThinking?.("hmm")
					for (const chunk of ["Hel", "lo ", "there"]) {
						if (this.aborted) return
						onContent(chunk)
					}
				}
			}
		/**
		 * An adapter that learns of the tool call only while the stream is
		 * being drained (20 §9).
		 *
		 * `TextGenResult.toolCall` cannot carry it — the object was returned
		 * before the first delta arrived — so the value lands on the adapter,
		 * exactly like `stopHit`, and the dispatch reads it after the drain.
		 */
		/**
		 * The call off a NON-streaming answer — the shape a tool-loop node with
		 * `streaming: off` produces. The API answers in one piece, so the call
		 * rides the result object rather than landing on the adapter.
		 */
		if (mode === "toolCallNoStream")
			return {
				completionResult: "Let me look.",
				compiledPrompt: this.injected,
				isAborted: false,
				toolCall: {
					tool: "search_entries",
					args: { query: "ashguard" }
				}
			}
		if (mode === "streamWithToolCall")
			return {
				compiledPrompt: this.injected,
				isAborted: false,
				completionResult: async (onContent: (c: string) => void) => {
					for (const chunk of ["Let me ", "look."]) onContent(chunk)
					this.streamedToolCall = {
						tool: "search_entries",
						args: { query: "ashguard" }
					}
				}
			}
		// A model whose backend has no reasoning parser: the delimiters arrive
		// as ordinary text in the completion, with nothing on `thinkingContent`.
		if (mode === "inlineThinking")
			return {
				completionResult: "<think>weighing it up</think>Hello there",
				compiledPrompt: this.injected,
				isAborted: false
			}
		// The same, streamed — and with the markup split across chunks, which is
		// safe because the parse runs over the accumulated buffer.
		if (mode === "inlineThinkingStream")
			return {
				compiledPrompt: this.injected,
				isAborted: false,
				completionResult: async (
					onContent: (c: string) => void,
					_onThinking?: (c: string) => void
				) => {
					for (const chunk of [
						"<thi",
						"nk>weighing ",
						"it up</think>Hel",
						"lo there"
					]) {
						if (this.aborted) return
						onContent(chunk)
					}
				}
			}
		// An adapter that streams the text but hands its reasoning back on the
		// result object. `TextGenResult` says this cannot happen — the field is
		// documented as non-streaming only — so this is the contract-breaking
		// case, pinned so the fallback that catches it is not deleted as dead.
		if (mode === "streamWithThinkingContent")
			return {
				compiledPrompt: this.injected,
				isAborted: false,
				thinkingContent: "reasoned up front",
				completionResult: async (
					onContent: (c: string) => void,
					_onThinking?: (c: string) => void
				) => {
					for (const chunk of ["Hel", "lo ", "there"]) {
						if (this.aborted) return
						onContent(chunk)
					}
				}
			}
		// DeepSeek-R1's shape: the template emitted the opening tag, so only the
		// close is generated.
		if (mode === "prefilledClose")
			return {
				completionResult: "weighing it up</think>Hello there",
				compiledPrompt: this.injected,
				isAborted: false
			}
		// Native reasoning AND a stray inline block. The native trace must win
		// the `thinking` port; the markup must still leave the text.
		if (mode === "nativeAndInline")
			return {
				completionResult: "<think>stray</think>Hello there",
				compiledPrompt: this.injected,
				isAborted: false,
				thinkingContent: "the native trace"
			}
		return {
			completionResult: "Hello there",
			compiledPrompt: this.injected,
			isAborted: false,
			thinkingContent: "hmm"
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

/**
 * The media store: file rows by uuid, bytes by file id.
 *
 * Two rows with different provenance, because provenance is what the access
 * check reads — one belongs to this run's session, one to the user the run acts
 * as, and one to neither. A third uuid is deliberately absent, for the dangling
 * reference every media consumer has to have an answer for (28 §2).
 */
const OWNED_BY_SESSION = "11111111-1111-4111-8111-111111111111"
const OWNED_BY_USER = "22222222-2222-4222-8222-222222222222"
const SOMEONE_ELSES = "33333333-3333-4333-8333-333333333333"
const DELETED_SINCE = "44444444-4444-4444-8444-444444444444"

const mediaRows: Record<string, any> = {
	[OWNED_BY_SESSION]: {
		id: 11,
		uuid: OWNED_BY_SESSION,
		userId: 1,
		sessionId: 7,
		filename: "page.png",
		kind: "image"
	},
	[OWNED_BY_USER]: {
		id: 22,
		uuid: OWNED_BY_USER,
		userId: 1,
		sessionId: null,
		filename: null,
		kind: "image"
	},
	[SOMEONE_ELSES]: {
		id: 33,
		uuid: SOMEONE_ELSES,
		userId: 99,
		sessionId: 55,
		filename: "private.png",
		kind: "image"
	}
}
const mediaBytes: Record<number, any> = {
	11: { bytes: Buffer.from("the page"), mime: "image/png" },
	22: { bytes: Buffer.from("the photo"), mime: "image/jpeg" },
	33: { bytes: Buffer.from("not yours"), mime: "image/png" }
}

vi.mock("$lib/server/media", () => ({
	getMediaByUuid: async (_db: any, uuid: string) => mediaRows[uuid] ?? null,
	readMedia: async (_db: any, id: number) => mediaBytes[id] ?? null
}))
/**
 * What the resolver was ASKED for — the run's own resolution arrives as
 * `pipelineConfig` (R-8: dispatch consumes it and re-walks nothing).
 */
let resolveArgs: any = null
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real: any = await importOriginal()
	return {
		...real,
		resolveCapabilityTarget: async (_db: any, req: any) => {
			resolveArgs = {
				pipelineConnectionId: req.pipelineConfig?.connectionId ?? null,
				pipelineConnectionModelId:
					req.pipelineConfig?.connectionModelId ?? null,
				pipelineSamplingId: req.pipelineConfig?.samplingConfigId ?? null
			}
			return connectionForRun
				? {
						ok: true,
						capability: req.capability,
						connection: connectionForRun,
						sampling: { id: 1, temperature: 1 },
						connectionVia: "pipelineConfig",
						samplingVia: "pipelineConfig"
					}
				: {
						ok: false,
						problem: {
							kind: "unset",
							capability: req.capability,
							message:
								"no AI connection is configured, so there is nothing to send this prompt to."
						}
					}
		}
	}
})
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		sampling: { id: 1 },
		contextConfig: { id: 1, template: "{{instructions}}" },
		promptConfig: { id: 1, systemPrompt: "Be brief." }
	})
}))
let sessionRow = true

/**
 * The database, handed in rather than imported.
 *
 * `dispatch.ts` used to import the app's connection directly; the end-to-end
 * spine test caught it by running against a test database and watching dispatch
 * read from the other one. Passing it makes both tests possible.
 */
const fakeDb = {
	query: {
		sessions: {
			findFirst: async () =>
				sessionRow && {
					id: 7,
					sessionType: "session",
					sessionCharacters: [
						{ character: { id: 1, name: "Alice" } },
						{ character: null }
					],
					sessionPersonas: [{ persona: { id: 1, name: "Bob" } }],
					lorebook: null
				}
		}
	}
} as any

const { dispatchGeneration, DispatchError } = await import(
	"$lib/server/pipelines/runtime/dispatch"
)
const { createHost, HostScopeError } = await import(
	"$lib/server/pipelines/runtime/host"
)
const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")

const compiled = { prompt: "You are Alice.", meta: { built: "by a Task" } }

beforeEach(() => {
	seen = {}
	resolveArgs = null
	adapterExchanges = []
	mode = "text"
	sessionRow = true
	connectionForRun = connection
	adapterSendsAttachments = true
	adapterSendsTools = true
})

/**
 * The tools, handed over under the same two questions attachments are (20 §9).
 *
 * The property that can only break silently is the refusal: a model that was
 * never offered a tool and a model that declined one return the same empty
 * answer, so a request that quietly went out without its declarations reads as
 * the model choosing not to call one.
 */
describe("tools on the wire", () => {
	const TOOLS = [
		{ name: "search_entries", description: "Search.", parameters: {} }
	]

	it("hands them to an adapter that sends them", async () => {
		const r = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			tools: TOOLS
		})
		expect(seen.tools).toEqual(TOOLS)
		// Null rather than undefined on an adapter that returned no call: the
		// loop's predicate reads this port.
		expect(r.toolCall).toBeNull()
	})

	it("refuses rather than sending a request that lost its tools", async () => {
		adapterSendsTools = false
		await expect(
			dispatchGeneration({
				db: fakeDb,
				compiledPrompt: compiled,
				sessionId: 7,
				tools: TOOLS
			})
		).rejects.toThrow(/no code that sends them/)
		expect(seen.tools).toBeUndefined()
	})

	it("refuses a connection whose tools capability is switched off, by name", async () => {
		connectionForRun = {
			...connection,
			capabilities: { resolved: { "text->text": 2, tools: 0 } }
		}
		await expect(
			dispatchGeneration({
				db: fakeDb,
				compiledPrompt: compiled,
				sessionId: 7,
				tools: TOOLS
			})
		).rejects.toThrow(/gone out unseen/)
	})

	it("reads a streaming adapter's call, which lands after generateText returned", async () => {
		// The defect this closes: a connection with `extraJson.stream` surfaced
		// no call at all, so a tool loop's predicate never fired and the loop
		// ran to its ceiling. The value cannot ride the result object — that
		// was returned before the first delta — so it is read off the adapter
		// after the drain, the same seam `stopHit` uses.
		mode = "streamWithToolCall"
		const r = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			tools: TOOLS
		})
		expect(r.text).toBe("Let me look.")
		expect(r.toolCall).toEqual({
			tool: "search_entries",
			args: { query: "ashguard" }
		})
	})

	it("a tool node with streaming off still returns the call", async () => {
		// The other half of the streamed case above, and the reason `off` is
		// safe to offer on a tool loop at all: a non-streaming answer carries
		// the call on the result object, and the loop's predicate reads the
		// same port either way. Without this the cheapest way to run a loop
		// would also be the way it never fires.
		mode = "toolCallNoStream"
		const r = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			tools: TOOLS,
			streaming: "off"
		})
		expect(seen.streaming).toBe("off")
		expect(r.text).toBe("Let me look.")
		expect(r.toolCall).toEqual({
			tool: "search_entries",
			args: { query: "ashguard" }
		})
	})

	it("a request with no tools hands nothing over", async () => {
		// The overwhelming case, and it must stay byte-identical to what it was
		// before tools existed.
		await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7
		})
		expect(seen.tools).toBeUndefined()
	})
})

describe("dispatching a prompt built elsewhere", () => {
	it("hands the adapter the payload verbatim and builds nothing", async () => {
		// The whole seam: `withCompiledPrompt` is what makes `compilePrompt()`
		// return this instead of constructing one. If the payload were reshaped
		// on the way through, parity between the two paths would be untestable.
		const r = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			userId: 1
		})
		expect(seen.compiledPrompt).toBe(compiled)
		expect(r.text).toBe("Hello there")
		expect(r.thinking).toBe("hmm")
	})

	it("drops cast rows whose character was deleted, as the legacy path does", async () => {
		// The FK is nullable with `onDelete: set null`, so a row can survive its
		// character. `BasePromptSession` requires the relation on the rows it lists.
		await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7
		})
		expect(seen.constructedWith.session.sessionCharacters).toHaveLength(1)
	})

	it("streams to the sink and still returns the whole text", async () => {
		mode = "stream"
		const chunks: string[] = []
		const thoughts: string[] = []
		const r = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			onChunk: (c) => chunks.push(c),
			onThinking: (c) => thoughts.push(c)
		})
		expect(chunks).toEqual(["Hel", "lo ", "there"])
		expect(thoughts).toEqual(["hmm"])
		// The port needs one value even though the user saw three.
		expect(r.text).toBe("Hello there")
	})

	it("delivers a non-streaming answer to the sink too", async () => {
		// Otherwise a connection that does not stream would show the user
		// nothing at all until the run finished, which reads as a hang.
		const chunks: string[] = []
		await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			onChunk: (c) => chunks.push(c)
		})
		expect(chunks).toEqual(["Hello there"])
	})

	it("an abort reaches the adapter, not just this function", async () => {
		// Returning early on the signal would leave the request running against
		// the provider — the user sees a stopped generation and the model keeps
		// being billed for it.
		mode = "stream"
		const controller = new AbortController()
		const chunks: string[] = []
		const done = dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			signal: controller.signal,
			onChunk: (c) => {
				chunks.push(c)
				controller.abort()
			}
		})
		await done
		expect(seen.aborted).toBe(true)
		expect(chunks.length).toBeLessThan(3)
	})

	it("refuses an empty payload rather than generating from nothing", async () => {
		await expect(
			dispatchGeneration({
				db: fakeDb,
				compiledPrompt: null,
				sessionId: 7
			})
		).rejects.toThrow(DispatchError)
	})

	it("says the session is gone rather than generating into nothing", async () => {
		// A run can outlive the session it was triggered in — the prompt was built
		// minutes ago and the user deleted the session while the model was queued.
		sessionRow = false
		await expect(
			dispatchGeneration({
				db: fakeDb,
				compiledPrompt: compiled,
				sessionId: 7
			})
		).rejects.toThrow(/no session 7/)
	})

	it("says so plainly when no connection is configured", async () => {
		connectionForRun = null
		await expect(
			dispatchGeneration({
				db: fakeDb,
				compiledPrompt: compiled,
				sessionId: 7
			})
		).rejects.toThrow(/no AI connection is configured/)
	})
})

/**
 * Attachments: references on a port, bytes at an adapter.
 *
 * The seam is here rather than in an adapter for three reasons the header of
 * `dispatch.ts` sets out — the media module needs the database, the run's
 * database is handed to THIS function, and a uuid a spec could name has to be
 * checked against the run before its bytes leave the instance. Each of those is
 * a property only testable at this level, so this is where they are asserted.
 */
describe("the files a request carries", () => {
	const send = (attachments: unknown[], userId: number | undefined = 1) =>
		dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			userId,
			attachments: attachments as any
		})

	it("resolves references to bytes and hands them over in order", async () => {
		// A ref object and a bare uuid string, because both spellings reach a
		// media port today (`mediaParts` accepts both).
		await send([{ uuid: OWNED_BY_SESSION }, OWNED_BY_USER])

		// Order is the contract, so it is asserted on the BYTES: two entries in
		// the wrong order have the same length and the same shape.
		expect(seen.attachments).toEqual([
			{
				bytes: Buffer.from("the page"),
				mime: "image/png",
				filename: "page.png"
			},
			// No `filename` key at all rather than an undefined one: the engine
			// prints it in refusals only when a person named the file.
			{ bytes: Buffer.from("the photo"), mime: "image/jpeg" }
		])
	})

	it("takes the mime from the variant that was read, not from the reference", async () => {
		// A `MediaRef`'s `mime` describes the DISPLAY variant and is a hint; the
		// bytes handed over are the original's, so the mime has to come back with
		// them or the format negotiation is negotiating about the wrong file.
		await send([{ uuid: OWNED_BY_USER, mime: "image/webp" }])
		expect((seen.attachments as any[])[0].mime).toBe("image/jpeg")
	})

	it("hands nothing over when the request carries nothing", async () => {
		await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			userId: 1
		})
		expect(seen.attachments).toBeUndefined()
	})

	it("refuses a file belonging to neither this session nor this user", async () => {
		// A uuid is unguessable, but "unguessable" is not an access rule — and
		// this file is about to leave the instance for a third-party API.
		await expect(send([SOMEONE_ELSES])).rejects.toThrow(
			/belongs to neither this session nor the user/
		)
	})

	it("refuses a reference that no longer resolves, rather than sending a request without it", async () => {
		// Deliberately unlike the host's `mediaParts`, which SKIPS a missing row:
		// there the images were already stored and failing would lose the whole
		// message, while here nothing has been sent and a request that quietly
		// went out short of a file is indistinguishable from a model ignoring it.
		await expect(send([DELETED_SINCE])).rejects.toThrow(/no longer has/)
		expect(seen.attachments).toBeUndefined()
	})

	it("refuses a value that is not a media reference at all", async () => {
		await expect(send([{ data: "AAAA" }])).rejects.toThrow(
			/carries no uuid/
		)
	})

	it("refuses when vision is switched off on the connection", async () => {
		// The user's own setting, in the words the connection screen used. Note
		// the default above is NOT this: a row nobody has determined yet is
		// judged permissively, so an untested connection still sends its files
		// rather than looking broken out of the box.
		connectionForRun = {
			...connection,
			capabilities: { overrides: { "text+image->text": false } }
		}
		await expect(send([{ uuid: OWNED_BY_SESSION }])).rejects.toThrow(
			/Enable it on the connection.*would have gone out unseen/s
		)
		expect(seen.attachments).toBeUndefined()
	})

	it("refuses when the bound adapter has no code that sends attachments", async () => {
		// The silent-drop guard, and the reason `consumesAttachments` exists:
		// several connection types declare vision in the manifest because their
		// API format has it, while their adapter class has no image code at all.
		adapterSendsAttachments = false
		const err: any = await send([{ uuid: OWNED_BY_SESSION }]).then(
			() => {
				throw new Error("expected a refusal")
			},
			(e) => e
		)
		expect(err.message).toMatch(
			/configured adapter has no code that sends them/
		)
		// ...and the sentence does not say WHICH adapter. The connection type
		// names the administrator's compute, this message reaches whoever sent
		// the files, and it travels through `Error.message` and
		// `Receipt.haltReason` where no projection can reach it. The type rides
		// on the error's `connection` field instead.
		expect(err.message).not.toMatch(/koboldcpp/i)
		expect(err.connection).toMatchObject({ type: "koboldcpp" })
		expect(seen.attachments).toBeUndefined()
	})
})

describe("what dispatch refuses to hand back", () => {
	it("returns the completion and no connection material", async () => {
		// The security property, stated as a test because it can only ever fail
		// silently: a leak looks exactly like a working generation. A Provider
		// that could read the connection is a plugin that exfiltrates an API key
		// while its spec reads as an innocent node.
		const r = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7
		})
		const serialised = JSON.stringify(r)
		expect(serialised).not.toContain(SECRET_KEY)
		expect(serialised).not.toContain(SECRET_URL)
		expect(serialised).not.toContain("some-model-q4")
		// The type is deliberately kept: enough to answer "which provider
		// answered", nothing anyone could replay.
		expect(r.via).toBe("koboldcpp")
	})

	/**
	 * The one thing that does come back, and the rule that makes it safe.
	 *
	 * A request cannot be described without naming where it went, so the
	 * exchange an adapter recorded is connection material by construction. It
	 * rides under `wire`, which `withoutConnectionIdentity` removes at every
	 * egress — the same arrangement `connection` on the node output already
	 * has, and the reason neither is a declared out-port.
	 */
	it("hands back the exchange the adapter recorded, and the egress removes it", async () => {
		adapterExchanges = [
			{
				request: {
					url: `${SECRET_URL}/api/v1/generate`,
					method: "POST",
					body: { prompt: "You are Alice.", model: "some-model-q4" }
				},
				response: {
					raw: '{"results":[{"text":"Hello there"}]}',
					streamed: false,
					durationMs: 12
				},
				redacted: []
			}
		]
		const r: any = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7
		})
		expect(r.wire?.request?.url).toBe(`${SECRET_URL}/api/v1/generate`)
		expect(r.wire?.response?.raw).toContain("Hello there")
		const { withoutConnectionIdentity } = await import(
			"$lib/server/connections/visibility"
		)
		const seenByAnyoneElse = withoutConnectionIdentity(r)
		expect(seenByAnyoneElse).not.toHaveProperty("wire")
		expect(JSON.stringify(seenByAnyoneElse)).not.toContain(SECRET_URL)
		// The rest of the receipt is untouched by that removal.
		expect(seenByAnyoneElse.text).toBe("Hello there")
		expect(seenByAnyoneElse.stops).toBeTruthy()
	})

	it("lists every call when one node made more than one", async () => {
		const call = (n: number) => ({
			request: {
				url: `${SECRET_URL}/api/v1/generate`,
				method: "POST",
				body: { n }
			},
			response: { raw: `${n}`, streamed: false, durationMs: 1 },
			redacted: []
		})
		adapterExchanges = [call(1), call(2)]
		const r: any = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7
		})
		expect(r.wire.calls).toHaveLength(2)
		expect(r.wire.calls[1].request.body).toEqual({ n: 2 })
	})

	it("keeps the connection out of the binding's result too", async () => {
		const bindings = coreBindings()
		const host = createHost(fakeDb, { sessionId: 7, userId: 1 })
		const r: any = await bindings["core:oracle/generate-text@1"]!(
			{ context: compiled },
			{
				call: (payload: unknown) =>
					host.call!(
						payload,
						{
							key: "generate",
							definitionId: "core:oracle/generate-text",
							definitionVersion: 1,
							kind: "oracle"
						},
						{ dry: false }
					),
				signal: new AbortController().signal,
				progress: () => {},
				log: () => {}
			} as any
		)
		expect(r.kind).toBe("ok")
		expect(JSON.stringify(r.value)).not.toContain(SECRET_KEY)
		expect(r.value.text).toBe("Hello there")
	})

	it("publishes the exchange on the node's own output", async () => {
		adapterExchanges = [
			{
				request: {
					url: `${SECRET_URL}/api/v1/generate`,
					method: "POST",
					body: { prompt: "You are Alice." }
				},
				response: {
					raw: "Hello there",
					streamed: false,
					durationMs: 3
				},
				redacted: []
			}
		]
		const bindings = coreBindings()
		const host = createHost(fakeDb, { sessionId: 7, userId: 1 })
		const r: any = await bindings["core:oracle/generate-text@1"]!(
			{ context: compiled },
			{
				call: (payload: unknown) =>
					host.call!(
						payload,
						{
							key: "generate",
							definitionId: "core:oracle/generate-text",
							definitionVersion: 1,
							kind: "oracle"
						},
						{ dry: false }
					),
				signal: new AbortController().signal,
				progress: () => {},
				log: () => {}
			} as any
		)
		// On the OUTPUT, beside `stops` and under the same key the projection
		// removes — a receipt reader's question, not a downstream port's.
		expect(r.value.wire.request.body).toEqual({ prompt: "You are Alice." })
		expect(r.value.stops).toBeTruthy()
	})
})

/**
 * The pipeline path used to do no inline parsing at all: the only parser lived
 * in `generateResponse` and was module-private, so `text` came back with the
 * delimiters intact and every consumer of this function — lore entries, scenes,
 * summaries, session events, contributed functions — wrote raw markup into a
 * durable record. Reasoning already had a home on the result; nothing did the
 * moving.
 */
describe("reasoning never reaches the port as markup", () => {
	const dispatch = () =>
		dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			userId: 1
		})

	it("lifts an inline block out of a non-streamed completion", async () => {
		mode = "inlineThinking"
		const r = await dispatch()
		expect(r.text).toBe("Hello there")
		expect(r.thinking).toBe("weighing it up")
	})

	it("lifts an inline block out of a streamed completion", async () => {
		mode = "inlineThinkingStream"
		const r = await dispatch()
		expect(r.text).toBe("Hello there")
		expect(r.thinking).toBe("weighing it up")
	})

	it("handles a prefilled opening tag (only the close is generated)", async () => {
		mode = "prefilledClose"
		const r = await dispatch()
		expect(r.text).toBe("Hello there")
		expect(r.thinking).toBe("weighing it up")
	})

	it("native reasoning leads the trace, and the text is still cleaned", async () => {
		// The native trace leads; the stray inline block is kept behind it
		// rather than deleted, so nothing the parser judged is ever lost.
		mode = "nativeAndInline"
		const r = await dispatch()
		expect(r.text).toBe("Hello there")
		expect(r.thinking).toBe("the native trace\n\nstray")
	})

	it("forwards the raw stream to the sink, unfiltered", async () => {
		// Deliberate: a sink is a live view of what the model is emitting, and
		// the caller re-parses the accumulated buffer anyway. Filtering deltas
		// would mean parsing across chunk boundaries.
		mode = "inlineThinkingStream"
		const chunks: string[] = []
		await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			onChunk: (c) => chunks.push(c)
		})
		expect(chunks.join("")).toContain("<think>")
	})

	it("leaves a completion with no delimiters exactly as it was", async () => {
		mode = "text"
		const r = await dispatch()
		expect(r.text).toBe("Hello there")
		expect(r.thinking).toBe("hmm")
	})

	it("does not drop thinkingContent from an adapter that also streams", async () => {
		// The asymmetry the streaming branch used to have: it read reasoning
		// only from the callback while the non-streaming branch read the field,
		// so an adapter populating both lost the half it streamed. Contractually
		// impossible (`TextGenResult.thinkingContent` is non-streaming only) —
		// which is exactly why nothing would have noticed.
		mode = "streamWithThinkingContent"
		const r = await dispatch()
		expect(r.text).toBe("Hello there")
		expect(r.thinking).toBe("reasoned up front")
	})
})

describe("the generate-text binding", () => {
	const bindings = coreBindings()

	// `context` is the node's declared in-port; the binding reads no alias for
	// it (R-12 swept `input.compiledPrompt` and `input.main`).
	const runWith = (scope: any, input: any = { context: compiled }) => {
		const host = createHost(fakeDb, scope)
		return bindings["core:oracle/generate-text@1"]!(input, {
			call: (payload: unknown) =>
				host.call!(
					payload,
					{
						key: "generate",
						definitionId: "core:oracle/generate-text",
						definitionVersion: 1,
						kind: "oracle"
					},
					{ dry: false }
				),
			signal: new AbortController().signal,
			progress: () => {},
			log: () => {}
		} as any) as any
	}

	it("takes the assemble node's `context` output without a shim in between", async () => {
		// What `$.prompt.context` carries: the allocation and the render, one
		// object. Forwarded whole as the call's `compiledPrompt`.
		const r = await runWith({ sessionId: 7 }, { context: compiled })
		expect(r.kind).toBe("ok")
		expect(seen.compiledPrompt).toBe(compiled)
	})

	it("forwards its own connection and sampling slots as tier 2", async () => {
		// The middle tier of `capability default → pipeline config → session
		// override`. Its absence was invisible: the panel showed Connection and
		// Sampling pickers on the reply step, they stored fine, and nothing ever
		// read them — the run resolved from the instance default every time. The
		// `generate-image` sibling forwarded them all along, which is what made
		// the gap look like a difference in kind rather than an omission.
		await runWith(
			{ sessionId: 7 },
			{
				context: compiled,
				connection: { id: 42 },
				sampling: { id: 99 }
			}
		)
		expect(resolveArgs?.pipelineConnectionId).toBe(42)
		expect(resolveArgs?.pipelineSamplingId).toBe(99)
	})

	it("sends null for a slot nobody set, rather than inventing one", async () => {
		// A node with no connection chosen must fall through to the capability
		// default — not to a guess, and not to whatever the last run used.
		await runWith({ sessionId: 7 })
		expect(resolveArgs?.pipelineConnectionId).toBeNull()
		expect(resolveArgs?.pipelineSamplingId).toBeNull()
	})

	it("forwards its `attachments` in-port so the files reach the adapter", async () => {
		// The port existed before anything read it. Without this line the
		// references would be dropped at the host and a spec that wired a page
		// into a vision step would generate about nothing, silently.
		const r = await runWith(
			{ sessionId: 7, userId: 1 },
			{
				context: compiled,
				attachments: [{ uuid: OWNED_BY_SESSION }]
			}
		)
		expect(r.kind).toBe("ok")
		expect((seen.attachments as any[])[0].bytes).toEqual(
			Buffer.from("the page")
		)
		// Bytes never travel the graph: what came back is the completion, not
		// the file that went out.
		expect(JSON.stringify(r.value)).not.toContain("the page")
	})

	it("halts on an empty completion rather than erroring", async () => {
		// A stop sequence at position zero is a thing that happens. Calling it
		// an error sends whoever reads the receipt hunting for a bug.
		mode = "empty"
		const r = await runWith({ sessionId: 7 })
		expect(r.kind).toBe("halt")
		expect(r.reason).toMatch(/returned nothing/)
	})

	it("halts on an abort, and names it as one", async () => {
		mode = "abort"
		const r = await runWith({ sessionId: 7 })
		expect(r.kind).toBe("halt")
		expect(r.reason).toMatch(/aborted/)
	})

	it("refuses to generate in a run with no session scope", async () => {
		await expect(runWith({ userId: 1 })).rejects.toThrow(HostScopeError)
	})

	/**
	 * The send shape, from the node's `params` slot to the adapter.
	 *
	 * This is the FULL-RUN road — binding, host, dispatch — and the one a
	 * multi-stage spec takes. The reply road reads the same parameter off the
	 * receipt instead, because it halts before any binding runs; both have to
	 * work or the control is live on one kind of pipeline and dead on the
	 * other.
	 */
	it("carries `off` from the node's params slot to the adapter", async () => {
		await runWith(
			{ sessionId: 7 },
			{ context: compiled, params: { streaming: "off" } }
		)
		expect(seen.streaming).toBe("off")
	})

	it("hands nothing over at `auto`, which is the adapter's own answer", async () => {
		// Not `withStreaming('auto')`. The adapter's default IS auto, and a
		// caller restating it would be a second resolution of the per-service
		// default this seam exists to keep in one place.
		await runWith(
			{ sessionId: 7 },
			{ context: compiled, params: { streaming: "auto" } }
		)
		expect(seen.streaming).toBeUndefined()
	})

	it("hands nothing over when the node has no params at all", async () => {
		await runWith({ sessionId: 7 })
		expect(seen.streaming).toBeUndefined()
	})

	it("forwards the run's stream sink without putting it in the payload", async () => {
		// A socket handle is not a value; it must not land in the receipt.
		mode = "stream"
		const chunks: string[] = []
		const r = await runWith({
			sessionId: 7,
			sink: { onChunk: (c: string) => chunks.push(c) }
		})
		expect(chunks).toEqual(["Hel", "lo ", "there"])
		expect(JSON.stringify(r.value)).not.toContain("onChunk")
	})
})

/**
 * The debug panel's retrieval trail.
 *
 * This replaced `meta.rag`, which reported the legacy infill engine's internal
 * phase counters — a guaranteed window, a RAG pass, a fill pass. The pipeline
 * runs none of those phases, so porting the numbers would have meant inventing
 * them. What it does have is a decision per block, which answers the question
 * the panel existed for ("why isn't my lore showing up") directly rather than
 * by inference from an aggregate.
 */
describe("toCompiledPrompt's retrieval trail", () => {
	const allocation = {
		rendered: "PROMPT",
		totalTokens: 30,
		budget: { total: 100, used: 30, remaining: 70 },
		groups: { worldLore: { allocated: 50, used: 20, entries: 2 } },
		blocks: [
			{
				id: 7,
				source: "worldLore",
				name: "The Ashguard",
				content: "Riders who patrol the ash wastes.",
				tokens: 20,
				included: true,
				why: ["matched 'ashguard'", "score 0.812", "fits the budget"]
			},
			{
				id: 8,
				source: "worldLore",
				name: "The Long Winter",
				content: "Nine years without a thaw.",
				tokens: 40,
				included: false,
				why: ["matched 'winter'", "score 0.401", "over budget"]
			}
		]
	}

	const meta = async () => {
		const { toCompiledPrompt } = await import(
			"$lib/server/pipelines/runtime/dispatch"
		)
		return toCompiledPrompt(allocation, { promptFormat: "vicuna" }).meta
	}

	it("reports every candidate, kept or not", async () => {
		const blocks = (await meta()).retrieval.blocks
		expect(blocks.map((b: any) => [b.name, b.included])).toEqual([
			["The Ashguard", true],
			["The Long Winter", false]
		])
	})

	it("carries the reasoning, which is the whole point", async () => {
		// An excluded entry with no stated reason is exactly the state the
		// panel exists to prevent.
		const dropped = (await meta()).retrieval.blocks.find(
			(b: any) => !b.included
		)
		expect(dropped.why).toContain("over budget")
	})

	it("carries the budget the decisions were made against", async () => {
		expect((await meta()).retrieval.budget).toEqual({
			total: 100,
			used: 30,
			remaining: 70
		})
	})

	it("does not ship block content to the client", async () => {
		// It is already in the prompt this same object carries; a second copy
		// of every lore entry has no reader and a real cost on a big lorebook.
		for (const b of (await meta()).retrieval.blocks)
			expect(b).not.toHaveProperty("content")
	})

	it("degrades to an empty trail rather than throwing", async () => {
		// A plugin's assembler may produce a payload with no block record at
		// all. The panel renders nothing; it must not break the send.
		const { toCompiledPrompt } = await import(
			"$lib/server/pipelines/runtime/dispatch"
		)
		const bare = toCompiledPrompt(
			{ rendered: "x" },
			{ promptFormat: "vicuna" }
		)
		expect(bare.meta.retrieval).toEqual({ budget: null, blocks: [] })
	})
})
