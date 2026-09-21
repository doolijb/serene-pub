/**
 * Envoys, end to end (plans/29 R-18, R-21 (6); 09-B B10; ruled 2026-09-15,
 * built 2026-09-16 as U5g): the guide session — one envoy, no characters —
 * as a real turn through `runReply` against the SHIPPED `core:spec/guide-respond`
 * document the bootstrap publishes, with a fake adapter standing in for the
 * model. The same road `replyRoad.int.test.ts` pins for a character's turn.
 *
 * ## What is pinned
 *
 *  1. **Creating a guide session seats the mascot.** `sessions:create` with
 *     the guide genre writes one cast row with `envoy_slug = 'mascot'` and no
 *     `character_id` — the genre's `default: true` envoy, seated with no
 *     choice — and a preset's `defaults.envoys` pre-seats what it names.
 *  2. **The envoy is the speaker.** The inlet's `speaker` is
 *     `envoy:mascot`; the resolver pins `ai` for it on the receipt and
 *     `none` for a slug nothing declares; the turn strategies offer an
 *     `in-turn` envoy and never an `on-action` one.
 *  3. **The row.** An envoy's reply has no `character_id` and carries
 *     `metadata.speaker = 'envoy:mascot'` — its only identity — and the
 *     session view carries the envoy's name and image for the client to
 *     render it by.
 *  4. **Its instructions are configuration.** The genre's `prompts` reach the
 *     assembled prompt's system field by reference (`slot.prompts({ envoy })`
 *     → `envoy:mascot`), and a deviation written through the Pipelines
 *     panel — at the step the panel lists for the envoy — replaces them
 *     byte for byte on the next reply.
 *  5. **The trigger finds the envoy.** With no character due,
 *     `sessions:triggerGenerateMessage` picks the seated in-turn envoy, so a
 *     person's message in a guide session gets an answer. An explicit
 *     `speaker` is owner-only and must name a live in-turn seat; a session
 *     that can have nobody answer says so in a sentence.
 *  6. **Who may act** (U5g review, C1). An envoy's line is the session
 *     owner's — regenerate, edit and delete run for the owner and refuse a
 *     guest through the real handlers — and a user line with no persona is
 *     its author's, not another member's.
 *  7. **A branch keeps the seat** (C2): the copy has the mascot seated and
 *     answers its next message. And the guide session's shape facts count
 *     no characters (W2): a seat is not a library character.
 *  8. **A session-scope deviation** (S8) — a `pipeline_node_overrides` row
 *     at `envoy:mascot` — reaches the assembled prompt for that session.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async () => {}
}))
// The legacy configuration read dispatch still performs (a context template
// row it never uses on this road); mocked as `replyRoad.int.test.ts` mocks it.
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		contextConfig: { id: 1, template: "{{instructions}}" },
		promptConfig: { id: 1, systemPrompt: "Be brief." },
		narratorPromptConfig: null
	})
}))

/** Every compiled prompt the adapter was handed — the wire's side. */
const compiledPrompts: any[] = []
const CHUNKS = ["Open Settings, ", "then Connections."]

class FakeAdapter {
	aborted = false
	abort() {
		this.aborted = true
	}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt(p: any) {
		compiledPrompts.push(p)
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		return {
			compiledPrompt: { prompt: "p", messages: undefined, meta: {} as any },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				for (const c of CHUNKS) onContent(c)
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const GUIDE = "core:genre/guide"
let userId: number
let GUIDE_RESPOND: string
let MASCOT_PROMPT: string

const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as any
const events: Array<{ event: string; data: any }> = []
const emit = (event: string, data: any) => {
	events.push({ event, data })
}

/** A guide session through the real create handler, seated by the genre. */
async function createGuideSession(name: string, presetId?: number) {
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(userId),
		{
			session: { name, genreId: GUIDE, ...(presetId ? { presetId } : {}) },
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	return res.session.id as number
}

const seats = (sessionId: number) =>
	db
		.select({
			characterId: schema.sessionCharacters.characterId,
			envoySlug: schema.sessionCharacters.envoySlug,
			removedAt: schema.sessionCharacters.removedAt
		})
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))

const messagesOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(schema.sessionMessages.id)

async function ask(sessionId: number, text: string) {
	await db.insert(schema.sessionMessages).values({
		sessionId,
		userId,
		role: "user",
		content: text
	} as any)
}

/** The system text of a compiled prompt, wherever the wire put it. */
const systemTextOf = (compiled: any): string => {
	const messages = compiled?.messages as
		| Array<{ role: string; content: string }>
		| undefined
	if (Array.isArray(messages) && messages.length) {
		const system = messages.filter((m) => m.role === "system")
		return (system.length ? system : messages).map((m) => m.content).join("\n")
	}
	return String(compiled?.prompt ?? "")
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-envoy-road-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const catalog = await import("@serene-pub/core-catalog")
	GUIDE_RESPOND = catalog.GUIDE_RESPOND_SPEC_ID
	MASCOT_PROMPT = catalog.GUIDE_MASCOT_SYSTEM_PROMPT

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "envoy-road")).id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(db, textConn.id, "guide-7b"))!
		.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Default",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn.id,
		connectionModelId: modelId,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("the guide genre ships", () => {
	it("is listed with one envoy, characters max 0, and its preset is offered", async () => {
		const { listSessionGenres } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const guide = (await listSessionGenres(db)).find((g) => g.genreId === GUIDE)
		expect(guide).toBeDefined()
		expect(guide!.shape.characters).toEqual({ min: 0, max: 0 })
		expect(guide!.envoys?.map((e) => [e.key, e.default, e.speaks])).toEqual([
			["mascot", true, "in-turn"]
		])
		const [preset] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-guide-default"))
		expect(preset?.genreId).toBe(GUIDE)
		expect(preset?.enabled).toBe(true)
		expect((preset?.bindings as any)?.["core:event/message-respond@1"]?.spec).toBe(
			GUIDE_RESPOND
		)
	})
})

describe("seating", () => {
	it("creating a guide session seats the mascot, and only the mascot", async () => {
		const sessionId = await createGuideSession("seats")
		const rows = await seats(sessionId)
		expect(rows).toEqual([
			{ characterId: null, envoySlug: "mascot", removedAt: null }
		])
		// The client's cast payload keeps meaning "characters": the seat is
		// on the view, as an envoy, with its display text.
		const { sessionsViewHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const view: any = await sessionsViewHandler.handler(
			fakeSocket(userId),
			{ sessionId },
			emit
		)
		expect(view.envoys).toEqual([
			expect.objectContaining({
				slug: "mascot",
				origin: "genre",
				name: "Guide",
				speaks: "in-turn",
				default: true,
				seated: true
			})
		])
		expect(view.envoys[0].image).toMatch(/^data:image\/svg\+xml/)
		expect(typeof view.envoys[0].description).toBe("string")
	})

	it("a preset's defaults.envoys pre-seat; an undeclared slug is dropped; the toggle unseats and reseats", async () => {
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({
				name: "Guide with a stray seat",
				genreId: GUIDE,
				bindings: {},
				enabled: true,
				defaults: { envoys: ["mascot", "nobody"] }
			} as any)
			.returning()
		const sessionId = await createGuideSession("preset-seats", preset!.id)
		expect((await seats(sessionId)).map((r) => r.envoySlug)).toEqual(["mascot"])

		const { sessionsSetEnvoySeatHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const off: any = await sessionsSetEnvoySeatHandler.handler(
			fakeSocket(userId),
			{ sessionId, slug: "mascot", seated: false },
			emit
		)
		expect(off.error).toBeUndefined()
		expect((await seats(sessionId))[0]!.removedAt).not.toBeNull()
		const on: any = await sessionsSetEnvoySeatHandler.handler(
			fakeSocket(userId),
			{ sessionId, slug: "mascot", seated: true },
			emit
		)
		expect(on.error).toBeUndefined()
		expect((await seats(sessionId))[0]!.removedAt).toBeNull()
		// A slug the genre does not declare is refused with a sentence.
		const bad: any = await sessionsSetEnvoySeatHandler.handler(
			fakeSocket(userId),
			{ sessionId, slug: "nobody", seated: true },
			emit
		)
		expect(bad.error).toMatch(/not one this session's genre declares/)
	})
})

describe("the resolver and the strategies", () => {
	it("a declared envoy is the AI's, seated or not; an undeclared slug is nobody's", async () => {
		const sessionId = await createGuideSession("portrayals")
		const { resolvePortrayals, turnRefs } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const refs = await turnRefs(db, sessionId, "envoy:mascot")
		expect(refs).toContain("envoy:mascot")
		const portrayals = await resolvePortrayals(db, {
			sessionId,
			runOwnerUserId: userId,
			refs: ["envoy:mascot", "envoy:nobody", "envoy:acme.roller"],
			speaker: "envoy:mascot"
		})
		expect(portrayals["envoy:mascot"]).toEqual({ by: "ai" })
		expect(portrayals["envoy:nobody"]).toEqual({ by: "none" })
		expect(portrayals["envoy:acme.roller"]).toEqual({ by: "none" })
	})

	it("a turn strategy offers an in-turn envoy and never an on-action one", async () => {
		const { coreBindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const bindings = coreBindings() as any
		const cast = {
			sessionCharacters: [],
			sessionPersonas: [],
			envoys: [
				{ slug: "acme.roller", speaks: "on-action", position: 0, removedAt: null },
				{ slug: "mascot", speaks: "in-turn", position: 1, removedAt: null }
			]
		}
		const messages = [{ role: "user", content: "hi", metadata: {} }]
		// Random: every draw lands on the one in-turn envoy.
		for (const r of [0, 0.5, 0.999]) {
			const out = await bindings["core:task/turn-random@1"](
				{ cast, messages },
				{ random: () => r }
			)
			expect(out.value.speaker).toBe("envoy:mascot")
			expect(out.value.characterId).toBeNull()
		}
		// Round robin: no character due, so the in-turn envoy takes the turn.
		const rr = await bindings["core:task/turn-round-robin@1"](
			{ cast, messages },
			{}
		)
		expect(rr.value.speaker).toBe("envoy:mascot")
		expect(rr.value.main.via).toBe("strategy")
		// And nobody once the envoy has just replied.
		const answered = await bindings["core:task/turn-round-robin@1"](
			{
				cast,
				messages: [
					...messages,
					{ role: "assistant", content: "…", metadata: { speaker: "envoy:mascot" } }
				]
			},
			{}
		)
		expect(answered.value.speaker).toBeNull()
		// An explicit pick of the on-action envoy still wins — the trigger
		// decided, not the strategy (an action's outlet posting as its envoy).
		const picked = await bindings["core:task/turn-manual@1"](
			{ cast, messages, speaker: "envoy:acme.roller" },
			{}
		)
		expect(picked.value.speaker).toBe("envoy:acme.roller")
		expect(picked.value.main.via).toBe("pick")
	})
})

describe("a guide reply", () => {
	it("runs end to end as the envoy: speaker on the inlet, ai on the receipt, no character_id on the row, the genre's prompt on the wire", async () => {
		const sessionId = await createGuideSession("reply")
		await ask(sessionId, "how do I add a connection?")
		compiledPrompts.length = 0

		const { runReply } = await import("$lib/server/utils/runReply")
		const outcome = await runReply({
			socket: fakeSocket(userId),
			emitToUser: emit,
			sessionId,
			userId,
			turn: { kind: "respond", speaker: "envoy:mascot" }
		})
		expect(outcome.error, outcome.error).toBeUndefined()
		expect(outcome.ok).toBe(true)
		const receipt = outcome.receipt!
		expect(receipt.specId).toBe(GUIDE_RESPOND)
		expect(receipt.outcome).toBe("ok")

		// The inlet carried the reference and no bare id (R-18 (3)).
		const input = receipt.nodes.find((n) => n.nodeKey === "input")!
		expect((input.output as any).speaker).toBe("envoy:mascot")
		expect((input.output as any).characterId).toBeNull()
		// The strategy passed it through, and the context builder took it.
		const speaker = receipt.nodes.find((n) => n.nodeKey === "speaker")!
		expect((speaker.output as any).speaker).toBe("envoy:mascot")
		const context = receipt.nodes.find((n) => n.nodeKey === "context")!
		expect((context.output as any).seedName).toBe("Guide")
		// Pinned once at run start (R-21 (4)).
		expect(receipt.portrayals?.["envoy:mascot"]).toEqual({ by: "ai" })
		// The docs are the lore: the search ran, published its band intent
		// first, and — with the docs compiled — found the connections page
		// for a question about connections, in the `worldLore` band.
		const docs = receipt.nodes.find((n) => n.nodeKey === "gather.docs.read")!
		expect(docs.result).toBe("ok")
		const published = (docs.output as any).main as Array<Record<string, unknown>>
		expect(published[0]).toMatchObject({ band: "worldLore" })
		const hits = published.slice(1)
		if (hits.length) {
			expect(hits.every((h) => h.source === "worldLore")).toBe(true)
			expect(
				hits.some((h) => /connect/i.test(String((h.payload as any)?.name ?? "")))
			).toBe(true)
			// …and the ranker allocated them, so the wire carries one.
			const rank = receipt.nodes.find((n) => n.nodeKey === "rank")!
			expect(
				((rank.output as any).candidates as any[]).some(
					(c) => c?.source === "worldLore"
				)
			).toBe(true)
		}

		// The row: no character, the reference as its identity, the text.
		const rows = await messagesOf(sessionId)
		const row = rows[rows.length - 1]!
		expect(row.role).toBe("assistant")
		expect(row.characterId).toBeNull()
		expect(row.personaId).toBeNull()
		expect(row.isNarratorResponse).toBe(false)
		expect((row.metadata as any).speaker).toBe("envoy:mascot")
		expect((row.metadata as any).sideCharacter).toBeUndefined()
		expect(row.content).toBe(CHUNKS.join(""))
		expect(row.isGenerating).toBe(false)

		// The genre's instructions reached the system field, byte for byte.
		expect(compiledPrompts.length).toBe(1)
		expect(systemTextOf(compiledPrompts[0])).toContain(MASCOT_PROMPT)
	})

	it("a deviation written in the Pipelines panel at the envoy's step replaces the prompt on the next reply", async () => {
		const sessionId = await createGuideSession("deviation")
		await ask(sessionId, "what is a lorebook?")

		const { namespaceView, writeOption } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const secret = "envoy-road-secret"
		const viewer = { userId, isAdmin: true }
		const view = await namespaceView(db, secret, GUIDE_RESPOND, viewer)
		expect(view).not.toBeNull()
		// The panel lists the envoy by its name, in the trailing "Also
		// configured here" group rather than among the numbered steps — it is
		// not a step of anything that runs — with the genre's text as the
		// author default and nothing changed yet.
		expect(view!.steps.some((s) => s.kind === "envoy")).toBe(false)
		const step = view!.alsoConfigured.find((s) => s.label === "Envoy · Guide")!
		expect(step, "an Envoy step").toBeDefined()
		expect(step.kind).toBe("envoy")
		const option = step.options.find((o) => o.label === "System prompt")!
		expect(option).toBeDefined()
		expect(option.control).toBe("text")
		expect(option.decl?.["text@1"]?.multiline).toBe(true)
		expect(option.authorDefault).toBe(MASCOT_PROMPT)
		expect(option.value).toBe(MASCOT_PROMPT)
		expect(option.source).toBe("author")
		expect(option.changed).toBe(false)
		expect(option.writable).toBe(true)
		// The context step no longer offers a prompt picker of its own: the
		// envoy owns the text (the three-System-boxes rule).
		const contextStep = view!.steps.find((s) => s.label === "Build template context")
		expect(contextStep?.options.some((o) => o.control === "prompts-ref")).toBe(false)

		// The shipped configuration stays as written; the edit lands on a
		// copy the instance selects — the panel's own gesture, by hand.
		const { duplicateConfig, selectConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const copy = await duplicateConfig(db, view!.selectedConfig!.id, "Tuned guide")
		const [spec] = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, GUIDE_RESPOND))
		await selectConfig(db, spec!.id, "instance", 0, copy.id, userId)

		const TUNED = "You are a terse librarian. Answer in one sentence."
		await writeOption(db, secret, GUIDE_RESPOND, viewer, option.id, TUNED)
		const after = await namespaceView(db, secret, GUIDE_RESPOND, viewer)
		const tunedOption = after!.alsoConfigured
			.find((s) => s.label === "Envoy · Guide")!
			.options.find((o) => o.label === "System prompt")!
		expect(tunedOption.value).toBe(TUNED)
		expect(tunedOption.source).toBe("preset")
		expect(tunedOption.changed).toBe(true)
		// The row is where the config stores it: the envoy's address.
		const stored = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.nodeKey, "envoy:mascot"),
					eq(schema.pipelineConfigValues.slot, "prompts"),
					eq(schema.pipelineConfigValues.path, "systemPrompt")
				)
			)
		expect(stored.map((r) => r.value)).toEqual([TUNED])

		compiledPrompts.length = 0
		const { runReply } = await import("$lib/server/utils/runReply")
		const outcome = await runReply({
			socket: fakeSocket(userId),
			emitToUser: emit,
			sessionId,
			userId,
			turn: { kind: "respond", speaker: "envoy:mascot" }
		})
		expect(outcome.error, outcome.error).toBeUndefined()
		const system = systemTextOf(compiledPrompts[0])
		expect(system).toContain(TUNED)
		expect(system).not.toContain(MASCOT_PROMPT)

		// Back to the default is a delete, and the genre's text again.
		const { clearOption } = await import("$lib/server/pipelines/config/panel")
		await clearOption(db, secret, GUIDE_RESPOND, viewer, option.id)
		expect(
			(
				await db
					.select()
					.from(schema.pipelineConfigValues)
					.where(eq(schema.pipelineConfigValues.nodeKey, "envoy:mascot"))
			).length
		).toBe(0)
	})

	it("the trigger finds the seated envoy when no character is due, and a verb re-drives its row as its turn", async () => {
		const sessionId = await createGuideSession("trigger")
		await ask(sessionId, "where are my characters?")
		const { triggerGenerateMessageHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true },
			emit
		)
		expect(res?.error, res?.error).toBeUndefined()
		const rows = await messagesOf(sessionId)
		const row = rows[rows.length - 1]!
		expect(row.role).toBe("assistant")
		expect(row.characterId).toBeNull()
		expect((row.metadata as any).speaker).toBe("envoy:mascot")
		expect(row.content).toBe(CHUNKS.join(""))

		// Nobody is due once the envoy has answered: a second trigger writes
		// nothing rather than a second answer.
		await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true },
			emit
		)
		expect((await messagesOf(sessionId)).length).toBe(rows.length)

		// A regenerate reads the row's reference and re-drives the envoy's
		// turn — there is no character id for it to read.
		await db
			.update(schema.sessionMessages)
			.set({ content: "", isGenerating: true, generationStage: "queued" })
			.where(eq(schema.sessionMessages.id, row.id))
		const { runReply } = await import("$lib/server/utils/runReply")
		const again = await runReply({
			socket: fakeSocket(userId),
			emitToUser: emit,
			sessionId,
			userId,
			turn: { kind: "regenerate", messageId: row.id }
		})
		expect(again.error, again.error).toBeUndefined()
		const input = again.receipt!.nodes.find((n) => n.nodeKey === "input")!
		expect((input.output as any).speaker).toBe("envoy:mascot")
		const [redriven] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, row.id))
		expect(redriven!.characterId).toBeNull()
		expect((redriven!.metadata as any).speaker).toBe("envoy:mascot")
		expect(redriven!.content).toBe(CHUNKS.join(""))
		// Still one live seat, untouched by any of it.
		expect((await seats(sessionId)).filter((r) => r.removedAt === null).length).toBe(1)
	})
})

describe("the trigger's explicit speaker (U5g review, W1) and an answerless session (S7)", () => {
	let guestId: number
	beforeAll(async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		guestId = (await createTestUser(db, "envoy-road-trigger-guest")).id
	})

	/** The last error the trigger told the client, if any. */
	const lastTriggerError = () =>
		events
			.filter((e) => e.event === "sessions:triggerGenerateMessage:error")
			.at(-1)?.data?.error as string | undefined

	it("a guest naming the envoy is refused; the owner naming an unseated slug, a non-reference, or an on-action envoy is refused; the owner naming the seated in-turn envoy runs", async () => {
		const sessionId = await createGuideSession("explicit-speaker")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId })
		await ask(sessionId, "may I pick who answers?")
		const { triggerGenerateMessageHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const before = (await messagesOf(sessionId)).length

		// The guest: owner-only, like an explicit characterId.
		events.length = 0
		const guest: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(guestId),
			{ sessionId, once: true, speaker: "envoy:mascot" },
			emit
		)
		expect(guest.error).toMatch(/Only the session owner can trigger a specific envoy/)
		expect(lastTriggerError()).toBe(guest.error)
		expect((await messagesOf(sessionId)).length).toBe(before)

		// The owner naming something that is not an envoy reference.
		events.length = 0
		const notRef: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true, speaker: "character:1" },
			emit
		)
		expect(notRef.error).toMatch(/not an envoy reference/)
		expect(lastTriggerError()).toBe(notRef.error)

		// The owner naming a slug with no live seat.
		events.length = 0
		const unseated: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true, speaker: "envoy:nobody" },
			emit
		)
		expect(unseated.error).toMatch(/not an envoy seated in this session/)
		expect(lastTriggerError()).toBe(unseated.error)
		expect((await messagesOf(sessionId)).length).toBe(before)

		// The owner naming a seated on-action envoy: seated by hand here,
		// under a declaration a stand-in action publishes for the guide
		// genre (an action's envoy is only ever `on-action`).
		const [herald] = await db
			.insert(schema.pipelineSpecs)
			.values({ slug: "acme:spec/herald", name: "Herald" })
			.returning()
		const [heraldVersion] = await db
			.insert(schema.pipelineSpecVersions)
			.values({
				specId: herald!.id,
				semver: "1.0.0",
				schemaVersion: 1,
				canonicalHash: "herald-1",
				status: "published",
				publishedAt: new Date(),
				contributes: {
					actions: [
						{
							key: "announce",
							function: "announce",
							genre: GUIDE,
							venue: { kind: "composer" },
							label: { en: "Announce" },
							envoy: { key: "herald", name: { en: "Herald" }, speaks: "on-action" }
						}
					]
				}
			} as any)
			.returning()
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: heraldVersion!.id })
			.where(eq(schema.pipelineSpecs.id, herald!.id))
		const { invalidateDeclaredEnvoys } = await import(
			"$lib/server/pipelines/entities/envoys"
		)
		invalidateDeclaredEnvoys()
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId: null, envoySlug: "acme.herald", position: 1 })
		events.length = 0
		const onAction: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true, speaker: "envoy:acme.herald" },
			emit
		)
		expect(onAction.error).toMatch(/speaks only through its action/)
		expect(lastTriggerError()).toBe(onAction.error)
		expect((await messagesOf(sessionId)).length).toBe(before)

		// The owner naming the seated in-turn envoy: the run.
		events.length = 0
		const picked: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true, speaker: "envoy:mascot" },
			emit
		)
		expect(picked?.error, picked?.error).toBeUndefined()
		const rows = await messagesOf(sessionId)
		expect(rows.length).toBe(before + 1)
		expect((rows.at(-1)!.metadata as any).speaker).toBe("envoy:mascot")
		expect(rows.at(-1)!.content).toBe(CHUNKS.join(""))

		// Tidy: the stand-in action, so later genre reads see the shipped set.
		await db.delete(schema.pipelineSpecs).where(eq(schema.pipelineSpecs.id, herald!.id))
		invalidateDeclaredEnvoys()
	})

	it("an explicit characterId's refusals go through the same channel as an explicit speaker's, emitting the error event", async () => {
		const sessionId = await createGuideSession("explicit-character-id")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId })
		await ask(sessionId, "who's there?")
		const { triggerGenerateMessageHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const before = (await messagesOf(sessionId)).length

		// A guest: owner-only, like an explicit speaker.
		events.length = 0
		const guest: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(guestId),
			{ sessionId, once: true, characterId: 1 },
			emit
		)
		expect(guest.error).toMatch(
			/Only the session owner can trigger a specific character/
		)
		expect(lastTriggerError()).toBe(guest.error)
		expect((await messagesOf(sessionId)).length).toBe(before)

		// A stranger to the session at all: the access-check branch above it.
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const strangerId = (await createTestUser(db, "envoy-road-trigger-stranger")).id
		events.length = 0
		const stranger: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(strangerId),
			{ sessionId, once: true, characterId: 1 },
			emit
		)
		expect(stranger.error).toMatch(/Session not found/)
		expect(lastTriggerError()).toBe(stranger.error)
	})

	it("a guide session with its mascot unseated refuses the trigger with a sentence; seated, nobody due is silent", async () => {
		const sessionId = await createGuideSession("answerless")
		await ask(sessionId, "anyone there?")
		const { sessionsSetEnvoySeatHandler, triggerGenerateMessageHandler } =
			await import("$lib/server/sockets/sessions")
		await sessionsSetEnvoySeatHandler.handler(
			fakeSocket(userId),
			{ sessionId, slug: "mascot", seated: false },
			emit
		)
		events.length = 0
		const refused: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true },
			emit
		)
		expect(refused.error).toBe(
			"This session has no one to answer — seat an envoy in Session settings."
		)
		expect(lastTriggerError()).toBe(refused.error)
		expect((await messagesOf(sessionId)).length).toBe(1)

		// Seated again: the answer, then silence — nobody due is not a fault.
		await sessionsSetEnvoySeatHandler.handler(
			fakeSocket(userId),
			{ sessionId, slug: "mascot", seated: true },
			emit
		)
		events.length = 0
		const answered: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true },
			emit
		)
		expect(answered?.error, answered?.error).toBeUndefined()
		expect((await messagesOf(sessionId)).length).toBe(2)
		events.length = 0
		const quiet: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true },
			emit
		)
		expect(quiet?.error).toBeUndefined()
		expect(lastTriggerError()).toBeUndefined()
		expect((await messagesOf(sessionId)).length).toBe(2)
	})
})

describe("who may act (U5g review, C1)", () => {
	let guestId: number
	beforeAll(async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		guestId = (await createTestUser(db, "envoy-road-guest")).id
	})

	const rowOf = async (id: number) =>
		(
			await db
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, id))
		)[0]!

	it("an envoy's reply is the session owner's: regenerate, edit and delete run for the owner and refuse a guest, through the real handlers", async () => {
		const sessionId = await createGuideSession("acting")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId })
		await ask(sessionId, "whose line is yours?")
		const {
			triggerGenerateMessageHandler,
			sessionMessagesRegenerateHandler,
			sessionMessagesUpdateHandler,
			sessionMessagesDeleteHandler
		} = await import("$lib/server/sockets/sessions")
		const res: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true },
			emit
		)
		expect(res?.error, res?.error).toBeUndefined()
		const row = (await messagesOf(sessionId)).at(-1)!
		expect((row.metadata as any).speaker).toBe("envoy:mascot")
		expect(row.characterId).toBeNull()

		// The rule, asked directly.
		const { canActOnMessage } = await import("$lib/server/messages/permissions")
		expect(await canActOnMessage(db, row.id, userId)).toBe(true)
		expect(await canActOnMessage(db, row.id, guestId)).toBe(false)

		// The guest, through every verb handler: refused, and the row untouched.
		const guestRegen: any = await sessionMessagesRegenerateHandler.handler(
			fakeSocket(guestId),
			{ id: row.id },
			emit
		)
		expect(guestRegen.error).toMatch(/permission to regenerate/)
		const guestEdit: any = await sessionMessagesUpdateHandler.handler(
			fakeSocket(guestId),
			{ id: row.id, content: "hijacked" },
			emit
		)
		expect(guestEdit.error).toMatch(/permission to edit/)
		const guestDelete: any = await sessionMessagesDeleteHandler.handler(
			fakeSocket(guestId),
			{ id: row.id },
			emit
		)
		expect(guestDelete.error).toMatch(/Access denied/)
		expect((await rowOf(row.id)).content).toBe(CHUNKS.join(""))

		// The owner: the edit lands, the regenerate re-drives the envoy's
		// turn, the delete removes the row.
		const edited: any = await sessionMessagesUpdateHandler.handler(
			fakeSocket(userId),
			{ id: row.id, content: "Open Settings." },
			emit
		)
		expect(edited.error, edited.error).toBeUndefined()
		expect((await rowOf(row.id)).content).toBe("Open Settings.")
		const regen: any = await sessionMessagesRegenerateHandler.handler(
			fakeSocket(userId),
			{ id: row.id },
			emit
		)
		expect(regen.error, regen.error).toBeUndefined()
		const redriven = await rowOf(row.id)
		expect(redriven.content).toBe(CHUNKS.join(""))
		expect((redriven.metadata as any).speaker).toBe("envoy:mascot")
		expect(redriven.characterId).toBeNull()
		const deleted: any = await sessionMessagesDeleteHandler.handler(
			fakeSocket(userId),
			{ id: row.id },
			emit
		)
		expect(deleted.error, deleted.error).toBeUndefined()
		expect((await messagesOf(sessionId)).some((m) => m.id === row.id)).toBe(false)
	})

	it("a user line with no persona is its author's — editable by them and by nobody else, the owner included", async () => {
		const sessionId = await createGuideSession("own-line")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId })
		const [line] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId, userId: guestId, role: "user", content: "my words" } as any)
			.returning()
		const { canActOnMessage } = await import("$lib/server/messages/permissions")
		expect(await canActOnMessage(db, line!.id, guestId)).toBe(true)
		expect(await canActOnMessage(db, line!.id, userId)).toBe(false)

		const { sessionMessagesUpdateHandler, sessionMessagesDeleteHandler } =
			await import("$lib/server/sockets/sessions")
		const byOwner: any = await sessionMessagesUpdateHandler.handler(
			fakeSocket(userId),
			{ id: line!.id, content: "not yours" },
			emit
		)
		expect(byOwner.error).toMatch(/permission to edit/)
		expect((await rowOf(line!.id)).content).toBe("my words")
		const byAuthor: any = await sessionMessagesUpdateHandler.handler(
			fakeSocket(guestId),
			{ id: line!.id, content: "my words, edited" },
			emit
		)
		expect(byAuthor.error, byAuthor.error).toBeUndefined()
		expect((await rowOf(line!.id)).content).toBe("my words, edited")
		// The owner's own persona-less line is the owner's, by the same rule.
		const [own] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId, userId, role: "user", content: "mine" } as any)
			.returning()
		expect(await canActOnMessage(db, own!.id, userId)).toBe(true)
		expect(await canActOnMessage(db, own!.id, guestId)).toBe(false)
		const ownDelete: any = await sessionMessagesDeleteHandler.handler(
			fakeSocket(userId),
			{ id: own!.id },
			emit
		)
		expect(ownDelete.error, ownDelete.error).toBeUndefined()
	})
	it("an orphaned row — an AI reply whose character was deleted globally, or a line whose author is gone — is the session owner's to delete, never a guest's", async () => {
		const sessionId = await createGuideSession("orphan")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId })
		const { canActOnMessage } = await import("$lib/server/messages/permissions")
		const { sessionMessagesDeleteHandler } = await import("$lib/server/sockets/sessions")

		// The reply of a character that no longer exists: `character_id`
		// nulled by `onDelete: set null`, no speaker reference, not narration.
		// This is the row that renders as "Unknown", and before this rule
		// nobody at all could delete it.
		const [orphanReply] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId, role: "assistant", content: "…", characterId: null } as any)
			.returning()
		expect(await canActOnMessage(db, orphanReply!.id, guestId)).toBe(false)
		expect(await canActOnMessage(db, orphanReply!.id, userId)).toBe(true)
		const deleted: any = await sessionMessagesDeleteHandler.handler(
			fakeSocket(userId),
			{ id: orphanReply!.id },
			emit
		)
		expect(deleted.error, deleted.error).toBeUndefined()
		expect((await messagesOf(sessionId)).some((m) => m.id === orphanReply!.id)).toBe(false)

		// A person's line whose author account is gone (`user_id` nulled).
		const [orphanLine] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId, role: "user", content: "…", userId: null } as any)
			.returning()
		expect(await canActOnMessage(db, orphanLine!.id, guestId)).toBe(false)
		expect(await canActOnMessage(db, orphanLine!.id, userId)).toBe(true)
	})
})

describe("a branch keeps the seat (U5g review, C2); the shape facts count no characters (W2)", () => {
	it("branching a guide session seats the mascot in the copy, and the copy answers its next message through the real trigger", async () => {
		const sessionId = await createGuideSession("to-branch")
		await ask(sessionId, "what happens on a branch?")
		const { triggerGenerateMessageHandler, sessionsBranchHandler } =
			await import("$lib/server/sockets/sessions")
		await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId, once: true },
			emit
		)
		const fork = (await messagesOf(sessionId)).at(-1)!
		const branched: any = await sessionsBranchHandler.handler(
			fakeSocket(userId),
			{ sessionId, messageId: fork.id, title: "the branch" },
			emit
		)
		expect(branched.error, branched.error).toBeUndefined()
		const branchId = branched.session.id as number
		expect(branchId).not.toBe(sessionId)
		expect(await seats(branchId)).toEqual([
			{ characterId: null, envoySlug: "mascot", removedAt: null }
		])
		// The copy's history, each row keeping its reference.
		const copied = await messagesOf(branchId)
		expect(copied.length).toBe(2)
		expect((copied[1]!.metadata as any).speaker).toBe("envoy:mascot")

		await ask(branchId, "and now?")
		const res: any = await triggerGenerateMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId: branchId, once: true },
			emit
		)
		expect(res?.error, res?.error).toBeUndefined()
		const rows = await messagesOf(branchId)
		expect(rows.length).toBe(4)
		expect((rows.at(-1)!.metadata as any).speaker).toBe("envoy:mascot")
		expect(rows.at(-1)!.content).toBe(CHUNKS.join(""))
		// A departed seat is not copied: unseat in the source, branch again.
		const { sessionsSetEnvoySeatHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsSetEnvoySeatHandler.handler(
			fakeSocket(userId),
			{ sessionId, slug: "mascot", seated: false },
			emit
		)
		const bare: any = await sessionsBranchHandler.handler(
			fakeSocket(userId),
			{ sessionId, messageId: fork.id, title: "the bare branch" },
			emit
		)
		expect(bare.error, bare.error).toBeUndefined()
		expect(await seats(bare.session.id)).toEqual([])
	})

	it("a guide session's shape facts report zero characters with the mascot seated", async () => {
		const sessionId = await createGuideSession("facts")
		expect((await seats(sessionId)).length).toBe(1)
		const { sessionShapeFacts, shapeViolations, getSessionGenre } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const facts = await sessionShapeFacts(db, sessionId)
		expect(facts.characters).toBe(0)
		// And so the genre's own bound — characters max 0 — is satisfied.
		const guide = await getSessionGenre(db, GUIDE)
		expect(shapeViolations(guide!.shape, facts)).toEqual([])
	})
})

describe("a session-scope deviation (U5g review, S8)", () => {
	it("a pipeline_node_overrides row at envoy:mascot reaches that session's assembled prompt and no other's", async () => {
		const sessionId = await createGuideSession("session-deviation")
		const otherId = await createGuideSession("session-deviation-other")
		await ask(sessionId, "who are you now?")
		await ask(otherId, "and you?")
		const [spec] = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, GUIDE_RESPOND))
		const MINE = "You are this session's own guide. One sentence."
		await db.insert(schema.pipelineNodeOverrides).values({
			specId: spec!.id,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "envoy:mascot",
			slot: "prompts",
			path: "systemPrompt",
			value: MINE,
			updatedBy: userId
		} as any)

		const { runReply } = await import("$lib/server/utils/runReply")
		compiledPrompts.length = 0
		const mine = await runReply({
			socket: fakeSocket(userId),
			emitToUser: emit,
			sessionId,
			userId,
			turn: { kind: "respond", speaker: "envoy:mascot" }
		})
		expect(mine.error, mine.error).toBeUndefined()
		const system = systemTextOf(compiledPrompts[0])
		expect(system).toContain(MINE)
		expect(system).not.toContain(MASCOT_PROMPT)

		// The other session still hears the genre's text.
		compiledPrompts.length = 0
		const theirs = await runReply({
			socket: fakeSocket(userId),
			emitToUser: emit,
			sessionId: otherId,
			userId,
			turn: { kind: "respond", speaker: "envoy:mascot" }
		})
		expect(theirs.error, theirs.error).toBeUndefined()
		const otherSystem = systemTextOf(compiledPrompts[0])
		expect(otherSystem).toContain(MASCOT_PROMPT)
		expect(otherSystem).not.toContain(MINE)
	})
})
