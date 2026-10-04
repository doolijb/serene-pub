/**
 * A narration's direction reaches the model (genre uplift C2, 2026-09-29).
 *
 * Chat's Narrate has always asked for one: the narrator modal's text field
 * (0.5.3's _Extra instructions_), and `/narrate <text>`. 0.5.3 appended it to
 * the prompt as _Additional focus for this response: …_, at the top and again
 * beside the seed. The pipeline stored it beside the row (`instructions` on
 * the placeholder, shown with the message) and nowhere else, so every
 * direction a person typed was shown back to them and never sent. Now the
 * narrate specs hand it to their context builder as `turnDirection`, and the
 * shipped rows render 0.5.3's words for it — nothing when it is blank.
 *
 * The same was true of a side character's instructions (the modal's other
 * half).
 *
 * Walks the real road — `sessions:fireNarratorResponse` → `runReply` — with a
 * faked model that records every prompt.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "narrate-direction-test-secret" }
})

/** Every prompt the model was sent, in order, serialised. */
const prompts: string[] = []
const PROSE = ["Thunder rolls in off the water. ", "The lamps along the quay gutter."]
/** A keeper's answer: nothing changed. */
const NOTHING = JSON.stringify({ values: [], inventory: [] })

class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	responseFormat: any
	responseSchema: any
	constructor(_p: any) {}
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		prompts.push(JSON.stringify(p ?? ""))
		return this
	}
	abort() {}
	async generateText() {
		const json =
			this.responseFormat === "json" ||
			JSON.stringify(this.injected ?? "").includes(
				JSON.stringify(JSON_INSTRUCTION).slice(1, 40)
			)
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (json) return onContent(NOTHING)
				for (const chunk of PROSE) onContent(chunk)
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))
vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: async () => ({
		// Sent as Text completion, so extend's continue gate lets the verb
		// through (a partial is only continued on a wire that can prefill).
		connection: {
			id: 1,
			type: "koboldcpp",
			promptFormat: "vicuna",
			capabilities: { overrides: { wire_chat: false } }
		},
		sampling: { id: 1 }
	})
}))
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real =
		await importOriginal<
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
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-narrate-direction-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** 0.5.3's words for a direction (`compilePrompt`'s `extraInstructions`). */
const FOCUS = "Additional focus for this response: "

let n = 0

/** A session of `genreId` (Chat when absent) with a cast, a persona and the owner's line waiting. */
async function session(genreId?: string) {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `narrate-${++n}`
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Session ${tag}`,
			...(genreId ? { genreId } : {})
		})
		.returning()
	for (const name of ["Brannoc", "Vell"]) {
		const [c] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name, description: `${name}, a sailor.` })
			.returning()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: row!.id,
			characterId: c!.id,
			isActive: true
		})
	}
	const [rook] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Rook", description: "Rook", isPersona: true })
		.returning()
	await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: row!.id, personaId: rook!.id })
	await insertLegacy(testDb as unknown as Db, {
		sessionId: row!.id,
		role: "user",
		content: "We reach the harbour at dusk.",
		personaId: rook!.id,
		userId: owner.id
	})
	return { owner, session: row! }
}

type World = Awaited<ReturnType<typeof session>>

/** One press of the narrator modal's Narrate button, as the page sends it. */
async function narrate(
	w: World,
	params: {
		instructions?: string
		speaker?: { characterId: number | null; name: string | null }
	}
) {
	const { fireNarratorResponseHandler } = await import("./sessions")
	const emitted: Array<{ event: string; payload: any }> = []
	const socket = {
		user: { id: w.owner.id, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	} as any
	prompts.length = 0
	const result = await fireNarratorResponseHandler.handler(
		socket,
		{ sessionId: w.session.id, ...params },
		(event: string, payload: any) => emitted.push({ event, payload })
	)
	return { result, emitted, sent: [...prompts] }
}

/** The rows the press wrote — everything but the seeded user line. */
async function written(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	const rows = await testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
	return rows.filter((r: any) => r.role !== "user")
}

/** How many times `needle` occurs in `hay`. */
const count = (hay: string, needle: string) => hay.split(needle).length - 1

describe("Chat's Narrate: the direction reaches the model", () => {
	test("a press with text reaches the prompt, at the top and beside the seed, as 0.5.3 sent it", async () => {
		const w = await session()
		const direction = "The storm breaks over the harbour."
		const { result, emitted, sent } = await narrate(w, { instructions: direction })
		expect(result, JSON.stringify(result)).toMatchObject({ success: true })
		expect(sent).toHaveLength(1)
		// Twice: the system prompt's copy and the post-history copy — the
		// reinforcement 0.5.3 placed near the seed so a long history cannot
		// bury it.
		expect(count(sent[0]!, `${FOCUS}${direction}`)).toBe(2)
		expect(sent[0]).not.toContain("{{")

		// Still stored beside the row and shown with it, as before.
		const rows = await written(w.session.id)
		expect(rows).toHaveLength(1)
		expect((rows[0] as any).metadata?.narratorInstructions).toBe(direction)
		expect((rows[0] as any).content).toBe(PROSE.join(""))

		// The page is told the run landed, so a `/narrate <text>` draft can
		// be spent (S2's rule: the draft stays until the action has run).
		expect(emitted).toContainEqual({
			event: "sessions:fireNarratorResponse",
			payload: { sessionId: w.session.id, success: true }
		})
	})

	test("an empty press is the ifEmpty behaviour: the narrator decides, and the prompt carries no direction", async () => {
		const w = await session()
		const { result, sent } = await narrate(w, {})
		expect(result, JSON.stringify(result)).toMatchObject({ success: true })
		expect(sent).toHaveLength(1)
		expect(sent[0]).not.toContain(FOCUS.trim())
		expect(sent[0]).not.toContain("{{")
		// A blank one is no direction either — trimmed away at the door.
		const blank = await narrate(await session(), { instructions: "   " })
		expect(blank.sent[0]).not.toContain(FOCUS.trim())
		const rows = await written(w.session.id)
		expect(rows).toHaveLength(1)
		expect((rows[0] as any).metadata?.narratorInstructions).toBeUndefined()
	})

	test("an undirected narration's prompt is the directed one without the two lines — the row renders nothing else", async () => {
		const direction = "Somebody lights a lantern on the far pier."
		// The rendered text only: `meta` carries a timestamp.
		const text = (sent: string) => JSON.parse(sent).prompt as string
		const directed = text((await narrate(await session(), { instructions: direction })).sent[0]!)
		const plain = text((await narrate(await session(), {})).sent[0]!)
		expect(count(directed, `\n\n${FOCUS}${direction}`)).toBe(2)
		expect(directed.split(`\n\n${FOCUS}${direction}`).join("")).toBe(plain)
	})

	test("a side character's instructions reach its prompt too — the modal's other half", async () => {
		const w = await session()
		const direction = "Ask after the missing ferryman."
		const { result, sent } = await narrate(w, {
			instructions: direction,
			speaker: { characterId: null, name: "The innkeeper" }
		})
		expect(result, JSON.stringify(result)).toMatchObject({ success: true })
		expect(sent).toHaveLength(1)
		// In the system prompt. The row's post-history copy renders wherever
		// its reminder does, and a side character (no legacy table of its
		// own) takes the reply config's post-history token trigger, which
		// suppresses the reminder on a one-line session, directed or not.
		const text: string = JSON.parse(sent[0]!).prompt
		const system = text.slice(0, text.indexOf("Assistant Characters"))
		expect(system).toContain(`\n\n${FOCUS}${direction}\n`)
		expect(count(text, `${FOCUS}${direction}`)).toBeGreaterThanOrEqual(1)
		const bare = await narrate(await session(), {
			speaker: { characterId: null, name: "The innkeeper" }
		})
		expect(bare.sent[0]).not.toContain(FOCUS.trim())
	})
})

/**
 * A press refused before its run tells the page (C2 follow-up, 2026-09-29).
 * `/narrate <text>` made a refusal easy to reach — a long draft is over the
 * cap in one keystroke — and the handler's `{ error }` return goes nowhere
 * (`register` discards it), so the draft just sat there with nothing said.
 * Each refusal now pushes the outcome (so the page settles the press and
 * keeps its draft) and the sentence on the ungated `:error`, for the toast.
 */
describe("a narration refused before its run tells the page", () => {
	async function press(
		w: World,
		params: { instructions?: string },
		as: { id: number } = w.owner
	) {
		const { fireNarratorResponseHandler } = await import("./sessions")
		const emitted: Array<{ event: string; payload: any }> = []
		const socket = {
			user: { id: as.id, isAdmin: false },
			io: { to: () => ({ emit: () => {} }) }
		} as any
		prompts.length = 0
		const result = await fireNarratorResponseHandler.handler(
			socket,
			{ sessionId: w.session.id, ...params },
			(event: string, payload: any) => emitted.push({ event, payload })
		)
		return { result, emitted, sent: [...prompts] }
	}

	/** The two pushes a refusal makes, and no run. */
	function expectRefused(
		out: Awaited<ReturnType<typeof press>>,
		sessionId: number,
		sentence: RegExp
	) {
		expect(out.sent).toHaveLength(0)
		expect(out.result).toMatchObject({ error: expect.stringMatching(sentence) })
		expect(out.emitted).toEqual([
			{
				event: "sessions:fireNarratorResponse",
				payload: { sessionId, success: false }
			},
			{
				event: "sessions:fireNarratorResponse:error",
				payload: { sessionId, error: out.result.error }
			}
		])
	}

	test("over the 300-character cap", async () => {
		const w = await session()
		const out = await press(w, { instructions: "x".repeat(301) })
		expectRefused(out, w.session.id, /too long \(max 300 characters\)/)
		expect(await written(w.session.id)).toHaveLength(0)
	})

	test("while a response is already generating", async () => {
		const w = await session()
		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(testDb as unknown as Db, {
			sessionId: w.session.id,
			role: "assistant",
			content: "",
			isGenerating: true,
			isNarratorResponse: true
		} as any)
		const out = await press(w, { instructions: "The storm breaks." })
		expectRefused(out, w.session.id, /already generating/)
	})

	test("pressed by somebody who is not the owner", async () => {
		const w = await session()
		const schema = await import("$lib/server/db/schema")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(testDb, `narrate-guest-${w.session.id}`)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: w.session.id, userId: guest.id })
		const out = await press(w, { instructions: "The storm breaks." }, guest)
		expectRefused(out, w.session.id, /Only the session owner/)
	})

	test("a press that runs answers once, and says nothing on :error", async () => {
		// The landed path: one outcome push per press, as before.
		const w = await session()
		const { emitted } = await press(w, { instructions: "The storm breaks." })
		expect(
			emitted.filter((e) => e.event === "sessions:fireNarratorResponse")
		).toEqual([
			{
				event: "sessions:fireNarratorResponse",
				payload: { sessionId: w.session.id, success: true }
			}
		])
		expect(
			emitted.some((e) => e.event === "sessions:fireNarratorResponse:error")
		).toBe(false)
	})
})

/**
 * A retry of a directed line re-sends its direction (C2 follow-up,
 * 2026-09-29). Regenerate, swipe and extend re-drive the narrate specs on
 * the row the press wrote, and that row still shows the note beside it
 * (`metadata.narratorInstructions`). A retry's `input.text` was empty, so
 * the line was re-rolled with no direction while the note stayed in view —
 * the shown-but-never-sent defect again. 0.5.3 re-read the note off the
 * message's metadata on every retry (`generateResponse.ts`
 * `generatingMessageMetadata` → `extraInstructions`).
 */
describe("a retry of a directed line re-sends its direction", () => {
	type Verb = "regenerate" | "swipe" | "extend"
	/** One press of the row's ⋮ verb, as the page sends it. */
	async function retry(w: World, verb: Verb, id: number) {
		const sessions = await import("./sessions")
		const handler =
			verb === "regenerate"
				? sessions.sessionMessagesRegenerateHandler
				: verb === "swipe"
					? sessions.sessionMessagesSwipeRightHandler
					: sessions.sessionMessagesExtendHandler
		const socket = {
			user: { id: w.owner.id, isAdmin: false },
			io: { to: () => ({ emit: () => {} }) }
		} as any
		prompts.length = 0
		const result = await (handler.handler as any)(socket, { id }, () => {})
		return { result, sent: [...prompts] }
	}

	for (const verb of ["regenerate", "swipe", "extend"] as const) {
		test(`${verb}: the narrator's retry carries the row's direction, as the fresh press did`, async () => {
			const w = await session()
			const direction = "A bell rings out from the drowned chapel."
			const first = await narrate(w, { instructions: direction })
			expect(first.result, JSON.stringify(first.result)).toMatchObject({ success: true })
			const [row] = await written(w.session.id)
			expect((row as any).metadata?.narratorInstructions).toBe(direction)

			const { result, sent } = await retry(w, verb, row!.id)
			expect(result, JSON.stringify(result)).not.toHaveProperty("error")
			expect(sent).toHaveLength(1)
			expect(count(sent[0]!, `${FOCUS}${direction}`)).toBe(2)
			expect(sent[0]).not.toContain("{{")

			// Still the one row, still showing the note it was re-sent with.
			const after = await written(w.session.id)
			expect(after).toHaveLength(1)
			expect((after[0] as any).metadata?.narratorInstructions).toBe(direction)
		})
	}

	test("regenerate: a side character's retry carries its instructions too", async () => {
		const w = await session()
		const direction = "Ask after the missing ferryman."
		const first = await narrate(w, {
			instructions: direction,
			speaker: { characterId: null, name: "The innkeeper" }
		})
		expect(first.result, JSON.stringify(first.result)).toMatchObject({ success: true })
		const [row] = await written(w.session.id)
		const { result, sent } = await retry(w, "regenerate", row!.id)
		expect(result, JSON.stringify(result)).not.toHaveProperty("error")
		expect(sent).toHaveLength(1)
		const text: string = JSON.parse(sent[0]!).prompt
		const system = text.slice(0, text.indexOf("Assistant Characters"))
		expect(system).toContain(`\n\n${FOCUS}${direction}\n`)
	})

	test("regenerate: an undirected line's retry stays undirected", async () => {
		const w = await session()
		await narrate(w, {})
		const [row] = await written(w.session.id)
		const { result, sent } = await retry(w, "regenerate", row!.id)
		expect(result, JSON.stringify(result)).not.toHaveProperty("error")
		expect(sent).toHaveLength(1)
		expect(sent[0]).not.toContain(FOCUS.trim())
	})
})
