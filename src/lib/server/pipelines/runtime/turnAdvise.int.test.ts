/**
 * The optional model path (PLAN-turn-order R41, M4): chat's turn-order spec
 * branches on the genre field `turnMode`. `rules` (the default) runs the
 * strategy; `model` runs `core:oracle/turn-advise@1`, whose answer is held
 * to the candidates not yet heard from this round and falls back to round
 * robin — noted, never a halt — when it names nobody seatable.
 *
 * The turn-order run is driven by `emitSessionEvent` with an `edit` cause, so
 * auto-advance fires nothing and the advise call is the only model call.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { readTurnOrder, sessionEvents } from "@serene-pub/sdk"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
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
	// annexViews pushes per-user views through this; a stub keeps that push quiet.
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** What the next model call answers — the advise oracle reads it as its JSON. */
let answer = ""
class FakeAdapter {
	constructor(_p: any) {}
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt() {
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		return {
			compiledPrompt: { prompt: "p", messages: undefined, meta: {} as any },
			isAborted: false,
			completionResult: answer
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
let alice: number
let bram: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-turn-advise-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "turn-advise")).id
	const [a] = await db.insert(schema.characters).values({ userId, name: "Alice", description: "A guide." }).returning()
	const [b] = await db.insert(schema.characters).values({ userId, name: "Bram", description: "A smith." }).returning()
	alice = a.id
	bram = b.id
	const [conn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const model = (await ensureConnectionModel(db, conn.id, "default-7b"))!
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Default",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.5 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", {
		connectionId: conn.id,
		connectionModelId: model.id,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const chatPresetId = async () =>
	(
		await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-chat-default"))
			.limit(1)
	)[0]?.id ?? null

/** A chat session with Alice and Bram seated, one person's line, and a reply from `spoke` if given. */
async function makeSession(turnMode?: "rules" | "model", spoke?: number) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: true,
			name: "advise",
			presetId: await chatPresetId(),
			genreFields: turnMode ? { turnMode } : {}
		})
		.returning()
	for (const [i, characterId] of [alice, bram].entries())
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId: session.id, characterId, isActive: true, position: i })
	await db
		.insert(schema.sessionMessages)
		.values({ sessionId: session.id, userId, role: "user", content: "Who knows the way?", metadata: {} } as any)
	if (spoke)
		await db.insert(schema.sessionMessages).values({
			sessionId: session.id,
			userId,
			role: "assistant",
			characterId: spoke,
			content: "I do.",
			metadata: {}
		} as any)
	return session.id
}

async function recompute(sessionId: number) {
	const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
	await emitSessionEvent(db as any, {
		sessionId,
		userId,
		event: sessionEvents.messageEdited,
		payload: { sessionId, cause: { kind: "edit", userId } },
		wait: true
	})
	const [row] = await db
		.select({ metadata: schema.sessions.metadata })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	const [run] = await db
		.select()
		.from(schema.pipelineRuns)
		.where(
			and(
				eq(schema.pipelineRuns.sessionId, sessionId),
				eq(schema.pipelineRuns.specSlug, "core:spec/chat-turn-order")
			)
		)
		.orderBy(desc(schema.pipelineRuns.id))
		.limit(1)
	const receipt = (run as any)?.receipt
	return {
		turnOrder: readTurnOrder(row!.metadata),
		ran: (receipt?.nodes ?? []).map((n: any) => n.nodeKey) as string[],
		notes: (receipt?.nodes ?? []).flatMap((n: any) => n.notes ?? []) as string[],
		/** The stored receipt's row for one node — its `swap` and `configLayers` (F2). */
		row: (key: string) => (receipt?.nodes ?? []).find((n: any) => n.nodeKey === key)
	}
}

describe("M4 · the optional model path", () => {
	it("rules by default: the strategy runs, the model is never asked", async () => {
		answer = '{"order": ["character:999"]}'
		const out = await recompute(await makeSession())
		expect(out.ran).toContain("decide.rules.strategy")
		expect(out.ran).not.toContain("decide.model.advise")
		expect(out.turnOrder.order.map((e) => e.ref)).toEqual([`character:${alice}`, `character:${bram}`])
		expect(out.turnOrder.order.every((e) => e.via === "strategy")).toBe(true)
		expect(out.turnOrder.strategy).toBe("core:task/turn-round-robin@1")
		// The stored receipt says the pin ran — `null`, not merely absent.
		expect(out.row("decide.rules.strategy").swap).toBeNull()
	})

	it("the order names the strategy that ran — a pub-scope swap included (A7r)", async () => {
		const { setNodeRebind } = await import("$lib/server/pipelines/entities/bindings")
		const set = await setNodeRebind(db as any, {
			scope: { kind: "pub", id: 0 },
			specSlug: "core:spec/chat-turn-order",
			nodeKey: "decide.rules.strategy",
			definitionId: "core:task/turn-random@1",
			userId
		})
		expect(set.error).toBeUndefined()
		try {
			answer = '{"order": []}'
			const out = await recompute(await makeSession())
			expect(out.turnOrder.strategy).toBe("core:task/turn-random@1")
			// …and its receipt row names the pin it replaced and whose swap it was.
			const row = out.row("decide.rules.strategy")
			expect(row.definitionId).toBe("core:task/turn-random@1")
			expect(row.swap).toEqual({ pin: "core:task/turn-round-robin@1", by: "pub" })
		} finally {
			await setNodeRebind(db as any, {
				scope: { kind: "pub", id: 0 },
				specSlug: "core:spec/chat-turn-order",
				nodeKey: "decide.rules.strategy",
				definitionId: null,
				userId
			})
		}
	})

	it("turnMode model: the model's order stands, via model, and the receipt names the oracle", async () => {
		answer = `{"order": ["character:${bram}", "character:${alice}"]}`
		const out = await recompute(await makeSession("model"))
		expect(out.ran).toContain("decide.model.advise")
		expect(out.ran).not.toContain("decide.rules.strategy")
		expect(out.turnOrder.order).toEqual([
			{ ref: `character:${bram}`, via: "model" },
			{ ref: `character:${alice}`, via: "model" }
		])
		expect(out.turnOrder.strategy, JSON.stringify(out.notes)).toBe("core:oracle/turn-advise@1")
		// Its stored receipt row says which layer answered each value (F2):
		// the prompt from the selected config, the review switch from the
		// node definition's own default.
		const layers = out.row("decide.model.advise").configLayers
		expect(layers?.prompts?.turnAdvice).toBe("config")
		expect(layers?.settings?.review).toBe("author")
	})

	it("a reference the pool did not admit is dropped, with a note", async () => {
		answer = `{"order": ["character:999", "character:${bram}"]}`
		const out = await recompute(await makeSession("model"))
		expect(out.turnOrder.order).toEqual([{ ref: `character:${bram}`, via: "model" }])
		expect(out.notes.some((n) => n.includes("dropped character:999"))).toBe(true)
	})

	it("an unreadable answer falls back to round robin, noted — never a halt", async () => {
		answer = "I would say Bram, probably."
		const out = await recompute(await makeSession("model"))
		expect(out.turnOrder.order.map((e) => e.via)).toEqual(["strategy", "strategy"])
		expect(out.notes.some((n) => n.includes("round robin stands"))).toBe(true)
	})

	it("the model orders the round, it does not extend it: who has spoken is not asked about", async () => {
		// Bram has replied since the person spoke; the model names him anyway.
		answer = `{"order": ["character:${bram}"]}`
		const out = await recompute(await makeSession("model", bram))
		// Bram is not a candidate this round, so the answer names nobody
		// seatable and round robin stands — Alice, the one still due.
		expect(out.turnOrder.order).toEqual([{ ref: `character:${alice}`, via: "strategy" }])
	})

	it("with auto-advance on, one send under the model path fires one reply", async () => {
		const sessionId = await makeSession("model")
		await db
			.update(schema.sessions)
			.set({ genreFields: { turnMode: "model", autoAdvance: "next" } })
			.where(eq(schema.sessions.id, sessionId))
		// The model orders Bram first; the reply the fire runs reads the same
		// fake answer as its text, which is fine — what is counted is rows.
		answer = `{"order": ["character:${bram}"]}`
		const before = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		const { sessionMessagesSendPersonaMessageHandler } = await import("$lib/server/sockets/sessions")
		await sessionMessagesSendPersonaMessageHandler.handler(
			{ user: { id: userId, isAdmin: true }, io: {} } as any,
			{ sessionId, personaId: null, content: "Bram, what do you think?" } as any,
			() => {}
		)
		const { settleSessionEvents } = await import("$lib/server/pipelines/runtime/sessionEvents")
		await settleSessionEvents()
		const after = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		const added = after.filter((m) => !before.some((b) => b.id === m.id))
		expect(added.filter((m) => m.role === "user").length).toBe(1)
		const replies = added.filter((m) => m.role === "assistant")
		expect(replies.length).toBe(1)
		expect(replies[0]!.characterId).toBe(bram)
	})

	it("a plugin's model strategy cannot stand in for decide.model.advise: plugins never touch a connection (R53)", async () => {
		const ports = {
			in: { candidates: "core:shape/turn-candidates@1", messages: "core:shape/messages@1" },
			out: { main: "core:shape/turn-entries@1", order: "core:shape/turn-entries@1" }
		}
		const slots = {
			connection: { kind: "connection", shape: "core:shape/text-gen@1" },
			sampling: { kind: "sampling", shape: "core:shape/text-gen@1" },
			prompts: { kind: "prompts", fields: { turnAdvice: { type: "text" } } }
		}
		const manifest = {
			slug: "acme",
			nodeDefinitions: [
				{ id: "acme:oracle/turn-natural@1", declaration: { id: "acme:oracle/turn-natural@1", kind: "oracle", ports, slots } }
			],
			swaps: [{ spec: "core:spec/chat-turn-order", node: "decide.model.advise", definition: "acme:oracle/turn-natural@1" }]
		}
		const { swapContributionProblems } = await import("$lib/server/plugins/swaps")
		const problems = await swapContributionProblems(db as any, manifest)
		expect(problems).toHaveLength(1)
		expect(problems[0]).toMatch(/uses a connection.*R53/)
		// …and a row that reached the registry some other way is not offered either.

		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: "acme:oracle/turn-natural",
			version: 1,
			kind: "oracle",
			ports,
			slots,
			i18n: { name: { en: "Natural" } }
		} as any)
		await db.insert(schema.plugins).values({
			pluginId: "acme",
			name: "Acme",
			bundleSource: "// x",
			bundleHash: "deadbeef",
			enabled: true,
			manifest
		})
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/chat-turn-order"))
		const { listSessionNodeSwaps } = await import("$lib/server/pipelines/entities/bindings")
		const offered = await listSessionNodeSwaps(db as any, {
			spec: "core:spec/chat-turn-order",
			nodeKey: "decide.model.advise",
			specVersionId: spec!.activeVersionId!
		})
		expect(offered.map((o) => o.definitionId)).toEqual(["core:oracle/turn-advise@1"])
	})
})
