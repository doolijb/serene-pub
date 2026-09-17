/**
 * The tool loop, end to end (20 §9, 01 §4a).
 *
 * The shipped reference spec, run against a seeded database with a fake model
 * that asks for a tool twice and then answers. Everything except the model is
 * the real code: the published document, the executor's loop block, the host's
 * tool dispatch, the core tool registry, and `create-message` writing the reply.
 *
 * What it is here to catch is the class of failure a unit test cannot see. A
 * loop whose carry does not reach the next prompt still runs, still returns
 * `ok`, and still writes a message — it just asks the same question six times
 * and answers from nothing. So the assertions are about what the model was
 * ACTUALLY SENT on each pass, not only about the run's outcome.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { TOOL_LOOP_TEMPLATE, toolLoopSpec } from "$lib/server/pipelines/specs"
import { CORE_PROMPTS } from "@serene-pub/core-catalog"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

/** Every prompt the model was sent, in order — one per iteration. */
let prompts: any[] = []
/** What the scripted model says next, shifted one per call. */
let script: string[] = []
/**
 * Whether the fake answers the way a `stream: true` connection does.
 *
 * A `let` because both answers are ordinary — the streaming branch is what a
 * connection with `extraJson.stream` takes, and it is the branch where a tool
 * call used to vanish.
 */
let streaming = false

class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	constructor(_params: any) {}
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		prompts.push(p)
		return this
	}
	abort() {}
	async generateText() {
		const text = script.shift() ?? "(the script ran out)"
		if (!streaming)
			return {
				completionResult: text,
				compiledPrompt: this.injected,
				isAborted: false
			}
		// Split mid-word on purpose: the fence the parser reads back straddles
		// chunk boundaries, which is safe only because the dispatch accumulates
		// before anything parses.
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				for (let i = 0; i < text.length; i += 7)
					onContent(text.slice(i, i + 7))
			}
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))
vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: async () => ({
		connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
		sampling: { id: 1 }
	})
}))
// The reply dispatch consumes the run's own resolution now (R-8) and asks the
// resolver only to load the pair — so the stand-in connection is supplied
// where dispatch actually reads it. The real resolver answers first: a test
// that registers a capability default of its own gets that connection (and
// its stop guards), and only an instance with nothing registered falls back
// to the stand-in.
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real = await importOriginal<
		typeof import("$lib/server/connections/capabilityTarget")
	>()
	return {
		...real,
		resolveCapabilityTarget: async (
			db: Db,
			req: Parameters<typeof real.resolveCapabilityTarget>[1]
		) => {
			const target = await real.resolveCapabilityTarget(db, req)
			if (target.ok) return target
			return {
				ok: true,
				capability: req.capability,
				connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
				sampling: { id: 1 },
				connectionVia: "pipelineConfig",
				samplingVia: "pipelineConfig"
			}
		}
	}
})
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		sampling: { id: 1 },
		contextConfig: { id: 1 },
		promptConfig: { id: 1, systemPrompt: "Stay in character." }
	})
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let sessionId: number
let userId: number

const callFor = (tool: string, args: Record<string, unknown>) =>
	"```tool_call\n" + JSON.stringify({ tool, args }) + "\n```"

/** The pool's shipped row — the prose `tools.item.prompt` renders. */
const TOOL_LOOP_PROMPT = CORE_PROMPTS.find(
	(p) =>
		p.seedKey ===
		"pipeline-prompt:core:task/assemble:prompts:tool-loop-default"
)!.fields

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "tool-loop-test", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Tool Loop Lore", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "ashguard",
				content: "Riders who patrol the ash wastes under Captain Vell."
			}
		])
	)

	await db.insert(schema.sessionMessages).values([
		{
			sessionId,
			role: "user",
			content: "Who leads the ashguard these days?"
		}
	])

	await db.insert(schema.systemSettings).values({ id: 1 })
}, 60_000)

const execute = async () => {
	prompts = []
	const saved = await saveDocument(db, toolLoopSpec(), { publish: true })
	const doc = await loadDocument(db, saved.specVersionId)
	const world = await buildWorld(db, { sessionId })
	/**
	 * The spec's own preset and its shipped prompt, layered in by hand.
	 *
	 * On an install these values arrive through `ensureDefaultConfig`, which
	 * `seedCoreSpecs` runs and this test does not — it publishes one document
	 * and builds a world around it. So they are layered at `defaults`, under
	 * anything a fixture might override, the same shape (and for the same
	 * reason) as `spine.int.test.ts`: a source and its engine together, never
	 * one alone.
	 *
	 * The `prompts` row goes on for the same reason the template does: the
	 * template renders `system` and `postHistory` from that slot, so a run
	 * without it sends a prompt no install sends.
	 *
	 * Read from the catalog rather than retyped, so this exercises the template
	 * and the prompt the pipeline actually ships.
	 */
	world.overrides.push(
		{
			nodeKey: "tools.item.prompt",
			slot: "template",
			path: "source",
			value: TOOL_LOOP_TEMPLATE,
			scopeKind: "defaults"
		} as any,
		{
			nodeKey: "tools.item.prompt",
			slot: "template",
			path: "engine",
			value: CORE_TEMPLATE_ENGINE,
			scopeKind: "defaults"
		} as any,
		{
			nodeKey: "tools.item.prompt",
			slot: "prompts",
			path: "system",
			value: TOOL_LOOP_PROMPT.system,
			scopeKind: "defaults"
		} as any,
		{
			nodeKey: "tools.item.prompt",
			slot: "prompts",
			path: "postHistory",
			value: TOOL_LOOP_PROMPT.postHistory,
			scopeKind: "defaults"
		} as any,
		{
			nodeKey: "answer",
			slot: "params",
			path: "path",
			value: "answer",
			scopeKind: "defaults"
		} as any
	)
	return await run(doc, {
		world,
		input: {
			text: "Who leads the ashguard these days?",
			sessionScope: { sessionId },
			sessionId
		},
		seed: "seed:tool-loop",
		triggerSource: "ui",
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId })
	})
}

/** What the model was sent on pass `i`, as one string. */
const promptText = (i: number): string => {
	const p = prompts[i]
	if (!p) return ""
	if (typeof p.prompt === "string") return p.prompt
	return (p.messages ?? [])
		.map((m: any) => String(m?.content ?? ""))
		.join("\n")
}

describe("a tool-calling turn", () => {
	it("asks, is answered, asks again, then replies", async () => {
		script = [
			"Let me look that up.\n" +
				callFor("search_entries", { query: "ashguard" }),
			"One more.\n" + callFor("grep_transcript", { text: "ashguard" }),
			"Captain Vell leads them."
		]

		const receipt = await execute()
		expect({
			outcome: receipt.outcome,
			stoppedAt: (receipt as any).haltNodeKey,
			because: (receipt as any).haltReason
		}).toEqual({ outcome: "ok", stoppedAt: undefined, because: undefined })

		// Do-while: two tool rounds, then the answer.
		const generates = receipt.nodes.filter(
			(n: any) => n.nodeKey === "tools.item.generate"
		)
		expect(generates.map((g: any) => g.iteration)).toEqual([0, 1, 2])

		// The loop stopped because the model stopped asking, not because it ran
		// out of turns — the two are indistinguishable without this.
		expect((receipt as any).loops).toEqual([
			{ clauseId: "tools", iterations: 3, stopped: "predicate" }
		])

		const rows = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		expect(rows.map((r) => r.content)).toContain("Captain Vell leads them.")
	}, 60_000)

	it("the carry reaches the next prompt", async () => {
		// The assertion the whole construct exists for. Without the carry the
		// second prompt is byte-identical to the first and the model is asking
		// into a void — a failure that still returns `ok` and still writes a
		// message.
		script = [
			callFor("search_entries", { query: "ashguard" }),
			"Captain Vell leads them."
		]
		await execute()

		expect(prompts).toHaveLength(2)
		expect(promptText(0)).not.toContain("tool_result")
		expect(promptText(1)).toContain("tool_result")
		// Not just that a result arrived — that it is THIS tool's answer.
		expect(promptText(1)).toContain("Ashguard")
	}, 60_000)

	it("advertises what it will accept, by name and with its arguments", async () => {
		script = ["Nothing to look up."]
		await execute()

		// The shipped row's prose, reaching the model through the template's
		// `system` variable — the whole of what moving it out of the template
		// changed, and silent if the name and the slot ever stop agreeing.
		expect(promptText(0)).toContain(TOOL_LOOP_PROMPT.system)
		expect(promptText(0)).toContain(TOOL_LOOP_PROMPT.postHistory)

		expect(promptText(0)).toContain("search_entries")
		expect(promptText(0)).toContain("grep_transcript")
		// The convention the parser mirrors. Escaped, it is an advertisement no
		// model can follow and no parse can read back.
		expect(promptText(0)).toContain("```tool_call")
	}, 60_000)

	it("a name nobody offered never reaches a tool", async () => {
		// The outer half of the refusal: `parse-tool-call` is given the same
		// list the model was, so an invented name reads as prose and the loop
		// exits on its predicate. `run-tool` refuses by name as well — see
		// toolTasks.test.ts — because a spec may wire a call from elsewhere.
		script = [callFor("definitely_not_a_tool", {})]
		const receipt = await execute()

		expect((receipt as any).loops).toEqual([
			{ clauseId: "tools", iterations: 1, stopped: "predicate" }
		])
		const tool = receipt.nodes.find(
			(n: any) => n.nodeKey === "tools.item.tool"
		)
		expect((tool as any)?.output?.main ?? null).toBeNull()
	}, 60_000)

	it("a tool that fails answers the model instead of ending the run", async () => {
		script = [
			callFor("get_entry", { id: 999999 }),
			"That entry does not exist."
		]
		const receipt = await execute()

		expect(receipt.outcome).toBe("ok")
		const tool = receipt.nodes.find(
			(n: any) => n.nodeKey === "tools.item.tool"
		)
		expect((tool as any)?.result).toBe("ok")
		expect(promptText(1)).toContain("there is no entry 999999")
	}, 60_000)

	it("a streaming connection reaches the same end, on its predicate", async () => {
		// The regression this guards: a connection with `extraJson.stream` took
		// a branch that surfaced no tool call, so the predicate never fired and
		// every loop ran to its ceiling — six requests to answer one question,
		// reported as `ok`.
		streaming = true
		try {
			script = [
				callFor("search_entries", { query: "ashguard" }),
				"Captain Vell leads them."
			]
			const receipt = await execute()

			expect(receipt.outcome).toBe("ok")
			expect((receipt as any).loops).toEqual([
				{ clauseId: "tools", iterations: 2, stopped: "predicate" }
			])
			expect(promptText(1)).toContain("tool_result")
		} finally {
			streaming = false
		}
	}, 60_000)

	it("a model that never stops asking is bounded, and the receipt says so", async () => {
		// Seven scripted calls against a ceiling of six.
		script = Array.from({ length: 7 }, () =>
			callFor("search_entries", { query: "ashguard" })
		)
		const receipt = await execute()

		expect(receipt.outcome).toBe("ok")
		expect((receipt as any).loops).toEqual([
			{ clauseId: "tools", iterations: 6, stopped: "ceiling" }
		])
		expect(prompts).toHaveLength(6)
	}, 60_000)
})
