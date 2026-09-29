import { expect, test, vi, describe, beforeEach } from "vitest"
import type { TextGenResult } from "$lib/server/adapters/actions"

// BaseConnectionAdapter pulls in the full promptBuilder module graph
// (the 0.5 keyword and RAG paths and NarrativeGraphContext), which touches
// $lib/server/db and $lib/server/embedding at import time — mock both
// minimally before importing anything else, matching this repo's established
// test convention (see src/lib/server/auth/tokens/int.test.ts).
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

const { BaseConnectionAdapter } = await import("./BaseConnectionAdapter")

/**
 * Minimal concrete subclass — `generateText()` is abstract and irrelevant here;
 * compilePrompt()'s dispatch is what's under test.
 *
 * The return type is the real `TextGenResult` and not `any`, even though the
 * body only throws. A fake free to widen an action's return is the same defect
 * the named actions exist to remove: the derivation reads capabilities off
 * method presence, which says nothing about in and out unless the signature is
 * the action's rather than the class's. That a *test* adapter is the one
 * widening it makes no difference — it is still a class claiming to implement
 * the action.
 */
class TestAdapter extends BaseConnectionAdapter {
	async generateText(): Promise<TextGenResult> {
		throw new Error("not used in these tests")
	}
}

function makeSession(overrides: Record<string, any> = {}) {
	return {
		id: 1,
		userId: 1,
		sessionType: "session",
		metadata: { ragIgnored: true }, // skip the RAG dispatch branch entirely
		sessionMessages: [],
		sessionCharacters: [],
		sessionPersonas: [],
		lorebook: {
			id: 1,
			lorebookBindings: [],
			worldLoreEntries: [],
			characterLoreEntries: [],
			historyEntries: []
		},
		...overrides
	} as any
}

function makeAdapter(overrides: Record<string, any> = {}) {
	return new TestAdapter({
		connection: { id: 1, promptFormat: "vicuna", extraJson: {} } as any,
		// Empty is what "the context budget is switched off" resolves to now:
		sampling: {},
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "You are a helpful narrator." } as any,
		session: makeSession(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.8,
		...overrides
	})
}

describe("BaseConnectionAdapter.compilePrompt()", () => {
	/**
	 * What is left of it.
	 *
	 * The three describes this replaced covered mode dispatch, narrator
	 * compilation and graph-context injection — all behaviours of the legacy
	 * `PromptBuilder`, which is deleted. Every prompt is now built by the
	 * pipeline and handed over via `withCompiledPrompt`; narrator mode is its
	 * own spec, and the relationship summary is `core:query/graph-context@1`.
	 * Those tests were not ported because there is nothing left on this class
	 * for them to assert.
	 *
	 * Two behaviours survive here, and both matter more than what went:
	 * summarizer mode still assembles its own payload, and an adapter asked to
	 * compile without having been handed one must refuse rather than generate
	 * from nothing.
	 */
	test("summarizer mode assembles its own payload", async () => {
		const adapter = makeAdapter()
		;(adapter as any).isSummarizerMode = true
		const spy = vi
			.spyOn(adapter as any, "compileSummarizerPrompt")
			.mockResolvedValue({
				prompt: "x",
				messages: [],
				meta: {} as any
			})

		await adapter.compilePrompt({})
		expect(spy).toHaveBeenCalledTimes(1)
	})

	test("returns the injected payload untouched when there is one", async () => {
		const adapter = makeAdapter()
		const payload = {
			prompt: "from the pipeline",
			messages: [],
			meta: {} as any
		}
		adapter.withCompiledPrompt(payload as any)
		await expect(adapter.compilePrompt({})).resolves.toBe(payload)
	})

	test("refuses rather than generating from an empty prompt", async () => {
		// The failure this prevents is silent: an adapter that fell through to
		// a missing builder and returned nothing would send an empty string and
		// read as a model fault.
		const adapter = makeAdapter()
		await expect(adapter.compilePrompt({})).rejects.toThrow(
			/never handed one/
		)
	})
})

/**
 * The shared accessor every text-completion branch now reads through.
 *
 * `KoboldCppAdapter`, `OllamaAdapter`, `LMStudioAdapter` and `LlamaCppAdapter`
 * each wrote `compiledPrompt.prompt!` — an assertion that a payload built for a
 * chat endpoint does not satisfy. It could not be reached while the pipeline was
 * incapable of producing a role array (the connection's format never got to the
 * render, so every payload was one string); restoring that wire is what makes
 * the shape arrive.
 *
 * The adapter-level proof is in `KoboldCppAdapter.test.ts`, where the request
 * body is inspected. These are the branches themselves.
 */
describe("BaseConnectionAdapter.promptTextFor()", () => {
	const messages = [
		{ role: "system", content: "Stay in character." },
		{ role: "user", content: "Bob: Hello." }
	]

	test("returns a prompt string untouched", () => {
		const adapter = makeAdapter() as any
		expect(
			adapter.promptTextFor({ prompt: "### System:\nx\n", messages })
		).toBe("### System:\nx\n")
	})

	test("an empty prompt string is still the payload's answer, not a rebuild", () => {
		// `""` is what a template that rendered nothing produces, and it is a
		// string: rebuilding from `messages` there would invent a prompt the
		// render did not make. Only an ABSENT prompt falls through.
		const adapter = makeAdapter() as any
		expect(adapter.promptTextFor({ prompt: "", messages })).toBe("")
	})

	test("rebuilds from messages in the connection's own format", () => {
		const adapter = makeAdapter({
			connection: { id: 1, promptFormat: "chatml", extraJson: {} } as any
		}) as any
		const out = adapter.promptTextFor({ messages })
		expect(out).toContain("<|im_start|>system")
		expect(out).toContain("<|im_start|>user")
		expect(out).toContain("Bob: Hello.")
	})

	test("a cleared format rebuilds as Vicuna, not ChatML", () => {
		// The `||` trap, at the third of the three sites that answer it.
		const adapter = makeAdapter({
			connection: { id: 1, promptFormat: "", extraJson: {} } as any
		}) as any
		const out = adapter.promptTextFor({ messages })
		expect(out).toContain("### System:")
		expect(out).not.toContain("<|im_start|>")
	})

	test("opens a turn for the model when the payload does not already seed one", () => {
		const adapter = makeAdapter() as any
		expect(
			adapter.promptTextFor({ messages }).endsWith("### Assistant:\n")
		).toBe(true)
	})

	test("does not open a second turn when the last message is the seed", () => {
		const adapter = makeAdapter() as any
		const out = adapter.promptTextFor({
			messages: [...messages, { role: "assistant", content: "Alice:" }]
		})
		expect(out.match(/### Assistant:/g)?.length).toBe(1)
	})

	test("refuses rather than sending an empty string when there is neither shape", () => {
		const adapter = makeAdapter() as any
		expect(() => adapter.promptTextFor({ messages: [] })).toThrow(
			/neither a prompt string nor any messages/
		)
	})
})

describe("BaseConnectionAdapter's attachment limits", () => {
	/**
	 * The seam, at the class rather than in the engine.
	 *
	 * The engine's own rules are exercised in
	 * `$lib/server/adapters/attachments.test.ts` against literal declarations.
	 * What is asserted here is only the wiring: that the class resolves the
	 * limits from the connection's TYPE through the static manifest, and that a
	 * type nobody declared anything for does not thereby refuse everything.
	 *
	 * Deliberately no real image bytes. PNG is in Anthropic's accepted list, so
	 * every file below is FORWARDED rather than converted — which keeps this file
	 * free of the codec stack and puts the conversion cases where the fixtures
	 * are.
	 */
	const stub = (n: number) => ({
		bytes: Buffer.alloc(n, 3),
		mime: "image/png"
	})

	const forType = (type: string) =>
		makeAdapter({
			connection: {
				id: 1,
				type,
				promptFormat: "vicuna",
				extraJson: {}
			} as any
		})

	test("the limits come from the connection's type", async () => {
		const adapter = forType("anthropic") as any
		expect(adapter.io?.in?.image?.maxFiles?.max).toBe(100)
		expect(adapter.io?.maxRequestBytes?.max).toBe(32 * 1024 * 1024)
	})

	test("a request over the declared count is refused, not trimmed", async () => {
		const adapter = forType("anthropic") as any
		const plan = await adapter.prepareAttachments(
			Array.from({ length: 101 }, () => stub(8))
		)
		expect(plan.ok).toBe(false)
		expect(plan.code).toBe("too-many-files")
		// The published number, and the receipt for it, both in the message the
		// user would see.
		expect(plan.reason).toContain("100")
		expect(plan.reason).toContain("Anthropic")
	})

	test("a request at the declared count goes through untouched", async () => {
		const adapter = forType("anthropic") as any
		const plan = await adapter.prepareAttachments(
			Array.from({ length: 100 }, () => stub(8))
		)
		expect(plan.ok).toBe(true)
		expect(plan.files.length).toBe(100)
		expect(plan.files.some((f: any) => f.converted)).toBe(false)
	})

	test("⚠ a type that declares nothing blocks nothing", async () => {
		// The failure this guards is the one the whole limits design is arranged
		// around: an unknown limit read as zero would refuse every attachment on
		// eight of the nine connection types, and the message would sound like it
		// came from the service.
		const adapter = forType("openai") as any
		expect(adapter.io).toBeUndefined()
		const plan = await adapter.prepareAttachments(
			Array.from({ length: 300 }, () => stub(1024))
		)
		expect(plan.ok).toBe(true)
		expect(plan.files.length).toBe(300)
	})
})

describe("the exchange an adapter records", () => {
	/**
	 * What the inspector reads instead of a proxy: the request as the adapter
	 * rendered it and the response as it arrived, with credentials replaced and
	 * a cap on how much of a reply is kept.
	 */
	test("a credential in the body is replaced and named", async () => {
		const { WireRecorder, WIRE_REDACTED } = await import(
			"./BaseConnectionAdapter"
		)
		const wire = new WireRecorder({
			url: "http://localhost:5001/api/v1/generate",
			body: {
				prompt: "hi",
				api_key: "sk-do-not-keep",
				nested: { authorization: "Bearer sk-do-not-keep" },
				max_length: 100
			}
		})
		wire.received({ results: [{ text: "ok" }] }, 200)
		const body = wire.exchange.request.body as any
		expect(body.api_key).toBe(WIRE_REDACTED)
		expect(body.nested.authorization).toBe(WIRE_REDACTED)
		expect(body.prompt).toBe("hi")
		expect(body.max_length).toBe(100)
		expect(wire.exchange.redacted).toEqual([
			"body.api_key",
			"body.nested.authorization"
		])
		expect(JSON.stringify(wire.exchange)).not.toContain("sk-do-not-keep")
		expect(wire.exchange.response.status).toBe(200)
		expect(wire.exchange.response.streamed).toBe(false)
	})

	test("a key in the URL is replaced too, and the rest of the URL kept", async () => {
		const { WireRecorder, WIRE_REDACTED } = await import(
			"./BaseConnectionAdapter"
		)
		const wire = new WireRecorder({
			url: "https://api.example.com/v1/chat?api_key=sk-do-not-keep&model=x",
			body: {}
		})
		expect(wire.exchange.request.url).toContain(
			`api_key=${encodeURIComponent(WIRE_REDACTED)}`
		)
		expect(wire.exchange.request.url).toContain("model=x")
		expect(wire.exchange.redacted).toEqual(["url.api_key"])
	})

	test("an attachment's bytes are noted, never copied", async () => {
		const { WireRecorder } = await import("./BaseConnectionAdapter")
		const bytes = "QUJDRA".repeat(2000)
		const prose = "The archive is closed, but the door was open. ".repeat(
			500
		)
		const wire = new WireRecorder({
			url: "https://api.anthropic.com/v1/messages",
			body: {
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: prose },
							{
								type: "image",
								source: { media_type: "image/png", data: bytes }
							}
						]
					}
				]
			}
		})
		const content = (wire.exchange.request.body as any).messages[0].content
		// The prompt is the whole point of the record and is kept whole,
		// however long it is.
		expect(content[0].text).toBe(prose)
		expect(content[1].source.data).toMatch(/KB of encoded bytes/)
		expect(wire.exchange.redacted).toEqual([
			"body.messages[0].content[1].source.data"
		])
	})

	test("a response past the cap keeps the first 64 KB and says so", async () => {
		const { WireRecorder, WIRE_RAW_LIMIT } = await import(
			"./BaseConnectionAdapter"
		)
		const wire = new WireRecorder({ url: "http://x/api/chat", body: {} })
		for (let i = 0; i < 100; i++) wire.frame("y".repeat(1024))
		expect(wire.exchange.response.raw.length).toBe(WIRE_RAW_LIMIT)
		expect(wire.exchange.response.truncated).toBe(true)
		expect(wire.exchange.response.streamed).toBe(true)
		expect(wire.exchange.response.chunks).toBe(100)
	})
})
