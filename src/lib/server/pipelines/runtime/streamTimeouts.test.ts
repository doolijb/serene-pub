/**
 * "Often during long and still processing/streaming replies, it will timeout
 * mid stream" (owner, 2026-10-03).
 *
 * The reply oracles declare `timeoutMs: 120000, timeoutKind: 'idle'`, and the
 * executor never read the kind: "idle" ran as a 120-second TOTAL over queue
 * wait, model load, prompt processing, reasoning and the body. And the
 * timeout never reached the request — the dispatch listened to the run's
 * signal only — so KoboldCPP went on generating into nothing.
 *
 * These run the real executor against the generating nodes' own declared
 * policy, with a host that holds the node's clock the way `host.ts` does
 * (`callTether`), and a stub stream on fake timers: minutes of model time in
 * milliseconds. The last block drives a real `KoboldCppAdapter` against a
 * stub KoboldCPP over HTTP to prove a node timeout closes the request and
 * tells the server to stop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as http from "node:http"
import {
	compile,
	describeOracleDefinition,
	ok,
	pin,
	run,
	S,
	spec,
	type CallHandles,
	type HostServices
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import { NODE_TIMEOUT_CEILING_MS, tether } from "./callTether"

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

/** The reply node's own clock, read off the contract — not a copy of it. */
const replyPolicy = {
	timeoutMs: C.generateText.descriptor.timeoutMs,
	timeoutKind: C.generateText.descriptor.timeoutKind
}

const reply = pin(
	describeOracleDefinition({
		id: "test:oracle/reply-clock@1",
		shape: S.textGen,
		effects: "external",
		...replyPolicy,
		ports: { in: {}, out: { main: S.text } }
	} as any)
)

const doc = compile(
	spec("test:spec/reply-clock", { version: "1.0.0" })
		.inlet("input", C.userMessage.v1())
		.oracle("reply", () => (reply as any).v1())
		.build()
)

const go = (host: HostServices, opts: { timeoutCeilingMs?: number } = {}) =>
	run(doc, {
		world: {
			overrides: [],
			samplingConfigs: [],
			connections: [],
			activeConnection: {}
		} as any,
		input: { text: "go on" },
		seed: "reply-clock",
		triggerSource: "ui",
		host,
		...opts,
		bindings: {
			"core:inlet/user-message@1": async (i: any) => ok(i),
			[reply.id]: async (_i: any, ctx: any) =>
				ok({ main: ((await ctx.call({})) as { text: string }).text })
		}
	}) as Promise<any>

const replyRow = (receipt: any) =>
	receipt.nodes.find((n: any) => n.nodeKey === "reply")

/** One beat of a stub stream: wait, then send. */
type Beat = { wait: number; body?: string; reasoning?: string }

/** What the stub "server" saw of its request. */
interface StubStream {
	closedEarly: boolean
	sent: number
}

/**
 * A stand-in for a model server's stream, on whatever timers are installed.
 * Abort closes it, as a fetch's signal would.
 */
function play(
	beats: Beat[],
	io: {
		onChunk(c: string): void
		onReasoning(c: string): void
		signal?: AbortSignal
	},
	seen: StubStream
): Promise<{ text: string }> {
	return new Promise((resolve, reject) => {
		let text = ""
		let i = 0
		let timer: ReturnType<typeof setTimeout> | undefined
		const close = () => {
			if (timer) clearTimeout(timer)
			seen.closedEarly = true
			reject(new DOMException("aborted", "AbortError"))
		}
		io.signal?.addEventListener("abort", close, { once: true })
		const next = () => {
			if (i >= beats.length) {
				io.signal?.removeEventListener("abort", close)
				return resolve({ text })
			}
			const beat = beats[i++]!
			timer = setTimeout(() => {
				seen.sent++
				if (beat.reasoning) io.onReasoning(beat.reasoning)
				if (beat.body) {
					text += beat.body
					io.onChunk(beat.body)
				}
				next()
			}, beat.wait)
		}
		next()
	})
}

/**
 * A host that holds the node's clock exactly as `host.ts` holds a reply's:
 * the request runs inside `hold`, every chunk pulses, and the request's
 * signal is the tethered one. `tethered: false` is the host as it was before
 * the fix — the run's signal only, nothing pulsed.
 */
function hostPlaying(
	beats: Beat[],
	seen: StubStream,
	tethered = true
): HostServices {
	return {
		async call(_p, _node, _run, handles: CallHandles) {
			const line = tether(tethered ? handles : undefined, undefined)
			return await line.hold(() =>
				play(
					beats,
					{
						onChunk: () => line.pulse(),
						onReasoning: () => line.pulse(),
						signal: line.signal
					},
					seen
				)
			)
		}
	}
}

const every = (n: number, wait: number, beat: Omit<Beat, "wait">): Beat[] =>
	Array.from({ length: n }, () => ({ wait, ...beat }))

describe("a long reply against the reply node's own clock (fake timers)", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it("the reply node is idle-timed at two minutes — the clock these tests are about", () => {
		expect(replyPolicy).toEqual({ timeoutMs: 120_000, timeoutKind: "idle" })
	})

	it("a 150-second steady body completes", async () => {
		const seen: StubStream = { closedEarly: false, sent: 0 }
		const receipt = go(hostPlaying(every(150, 1_000, { body: "x" }), seen))
		await vi.advanceTimersByTimeAsync(151_000)
		const r = await receipt
		expect(r.outcome).toBe("ok")
		expect(replyRow(r).timedOut).toBeUndefined()
		expect(replyRow(r).output).toEqual({ main: "x".repeat(150) })
		expect(seen.closedEarly).toBe(false)
	})

	it("60 seconds of silence, then 60 seconds of reasoning, then the body, completes", async () => {
		const seen: StubStream = { closedEarly: false, sent: 0 }
		const beats: Beat[] = [
			{ wait: 60_000 }, // prompt processing: nothing on the wire
			...every(60, 1_000, { reasoning: "…" }),
			...every(10, 1_000, { body: "y" })
		]
		const receipt = go(hostPlaying(beats, seen))
		await vi.advanceTimersByTimeAsync(131_000)
		const r = await receipt
		expect(r.outcome).toBe("ok")
		expect(replyRow(r).output).toEqual({ main: "y".repeat(10) })
	})

	it("control — the host as it was: the same 150-second body times out at 120 s and the stream runs on", async () => {
		const seen: StubStream = { closedEarly: false, sent: 0 }
		const receipt = go(
			hostPlaying(every(150, 1_000, { body: "x" }), seen, false)
		)
		await vi.advanceTimersByTimeAsync(121_000)
		const r = await receipt
		expect(r.outcome).toBe("err")
		expect(replyRow(r).timedOut).toBe(true)
		expect(replyRow(r).reason).toMatch(/timeout after 120000ms/)
		// The zombie: nothing told the request the node was gone.
		expect(seen.closedEarly).toBe(false)
		await vi.advanceTimersByTimeAsync(30_000)
		expect(seen.sent).toBe(150)
	})

	it("a request that never ends is still ended by the pub's ceiling — and closed", async () => {
		const seen: StubStream = { closedEarly: false, sent: 0 }
		// A model server that accepted the request and went silent forever.
		const receipt = go(
			hostPlaying([{ wait: 10 * NODE_TIMEOUT_CEILING_MS }], seen),
			{ timeoutCeilingMs: NODE_TIMEOUT_CEILING_MS }
		)
		await vi.advanceTimersByTimeAsync(NODE_TIMEOUT_CEILING_MS + 1_000)
		const r = await receipt
		expect(r.outcome).toBe("err")
		expect(replyRow(r).timedOut).toBe(true)
		expect(replyRow(r).reason).toMatch(/the pub's ceiling/)
		expect(seen.closedEarly).toBe(true)
	})
})

describe("a node timeout reaches KoboldCPP (real HTTP stub)", () => {
	let server: http.Server | undefined
	afterEach(async () => {
		await new Promise<void>((resolve) =>
			server ? server.close(() => resolve()) : resolve()
		)
		server = undefined
	})

	it("closes the generation request and posts /api/extra/abort with its genkey", async () => {
		const { KoboldCppAdapter } = await import(
			"$lib/server/connectionAdapters/KoboldCppAdapter"
		)
		let generationStarted = false
		let generationClosed = false
		let abortBody: any
		let gotAbort!: () => void
		const abortSeen = new Promise<void>((r) => (gotAbort = r))
		server = http.createServer((req, res) => {
			if (req.url === "/api/extra/abort") {
				let body = ""
				req.on("data", (c) => (body += c))
				req.on("end", () => {
					abortBody = JSON.parse(body || "{}")
					res.writeHead(200, { "Content-Type": "application/json" })
					res.end('{"success":true}')
					gotAbort()
				})
				return
			}
			if (req.url === "/api/extra/true_max_context_length") {
				res.writeHead(200, { "Content-Type": "application/json" })
				res.end('{"value":8192}')
				return
			}
			// The generation, on whichever wire the adapter chose: headers at
			// once, one token, then a silence that outlasts the node's clock.
			const frame =
				req.url === "/api/extra/generate/stream"
					? 'event: message\ndata: {"token":"Once"}\n\n'
					: req.url === "/v1/chat/completions"
						? 'data: {"choices":[{"delta":{"content":"Once"}}]}\n\n'
						: undefined
			if (!frame) {
				res.writeHead(404).end()
				return
			}
			generationStarted = true
			res.writeHead(200, { "Content-Type": "text/event-stream" })
			res.write(frame)
			res.on("close", () => (generationClosed = true))
		})
		const port = await new Promise<number>((resolve) =>
			server!.listen(0, "127.0.0.1", () =>
				resolve((server!.address() as any).port)
			)
		)
		const adapter = new KoboldCppAdapter({
			connection: {
				id: 1,
				type: "koboldcpp",
				baseUrl: `http://127.0.0.1:${port}`,
				model: "koboldcpp",
				promptFormat: "vicuna",
				extraJson: {}
			} as any,
			sampling: {},
			systemPrompt: "",
			session: {
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
			} as any,
			currentCharacterId: null
		})
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)

		const host: HostServices = {
			async call(_p, _node, _run, handles) {
				const line = tether(handles, undefined)
				// What `dispatchGeneration` does with the signal it is handed
				// (`onAbort` there; dispatch.int.test.ts › "an abort reaches
				// the adapter").
				line.signal?.addEventListener("abort", () => adapter.abort(), {
					once: true
				})
				return await line.hold(async () => {
					const result = await adapter.generateText()
					let text = ""
					await (result.completionResult as any)((c: string) => {
						line.pulse()
						text += c
					})
					return { text }
				})
			}
		}

		// A ceiling of 300 ms stands in for the node's clock running out.
		const r = await go(host, { timeoutCeilingMs: 300 })
		expect(replyRow(r).reason).toMatch(/timeout after 300ms/)
		expect(replyRow(r).timedOut).toBe(true)
		expect(generationStarted).toBe(true)
		await abortSeen
		expect(abortBody.genkey).toMatch(/\S/)
		await vi.waitFor(() => expect(generationClosed).toBe(true))
	}, 10_000)
})
