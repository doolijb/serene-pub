/**
 * Turns before background work, end to end (owner go-ahead 2026-10-03).
 *
 * The failure this pins: since retrieval went on by default (R5) every turn
 * queues its session on the annotation lane, and on a big pub that lane's
 * PGlite work ran as one microtask chain for ~90 s. Nothing else on the server
 * got the thread — the next turn's 2 s lore reads expired behind it and its
 * lore was recovered as empty, without a word.
 *
 * So: queue a heavy annotation job (a long transcript over a big book), let it
 * get going, run a turn, and require that
 *   · the job was still running when the turn began — the lane yields between
 *     items, or this test's own polling timer could not have fired;
 *   · the turn's lore reads finished inside their clocks, and the lore is in
 *     the prompt;
 *   · the lane did no background work while the turn held (one item in flight
 *     when it started is allowed);
 *   · the job resumed afterwards.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { sql } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"

let db: TestDb
let userId: number
let sessionId: number
let lorebookId: number
let characterId: number

const ENTRIES = 150
const MESSAGES = 600

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "turn-hold-int-secret" }
})

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	isModelLoading: () => false,
	getLoadedModelId: () => null,
	getConfiguredModelId: async () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

// No entity model is starred, so the lane runs its lexical tiers only.
vi.mock("$lib/server/ner", () => ({
	loadNerModel: async () => {
		throw new Error("nothing here stars an entity model")
	},
	unloadNerModel: () => {},
	setNerTtlMinutes: () => {},
	getLoadedNerModelId: () => null,
	isNerModelReady: () => false,
	isNerModelLoading: () => false,
	extractNerSpans: async () => {
		throw new Error("nothing here stars an entity model")
	}
}))

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

const annotatedMessages = async (): Promise<number> => {
	const res: any = await db.execute(
		sql`SELECT count(DISTINCT message_id)::int AS n FROM message_annotations`
	)
	return Number((res.rows ?? res)[0].n)
}

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "turn-hold-user", isAdmin: true })
		.returning()
	userId = user.id

	// The preview halts before the model call, but a pair must resolve.
	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Preview Only",
			type: "ollama",
			baseUrl: "http://localhost:11434",
			promptFormat: "vicuna",
			tokenCounter: "estimate"
		})
		.returning()
	const [model] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: connection.id, model: "irrelevant", name: "irrelevant" })
		.returning()
	const [sampling] = await db.select().from(schema.samplingConfigs).limit(1)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: connection.id,
		connectionModelId: model.id,
		samplingConfigId: sampling?.id ?? null
	})

	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Ash", description: "A rider of the ash wastes." })
		.returning()
	characterId = character.id

	// A big book: every title is a gazetteer name, so each pick builds a
	// large vocabulary — the per-item cost that made the sweep long.
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Big Book", userId })
		.returning()
	lorebookId = lorebook.id
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId,
				name: "The Ashguard",
				keys: "ashguard",
				content: "Riders who patrol the ash wastes."
			},
			...Array.from({ length: ENTRIES }, (_, i) => ({
				lorebookId,
				name: `Waystation ${i}`,
				keys: "",
				content: `A stop on the old road, past Waystation ${(i + 1) % ENTRIES}.`
			}))
		])
	)

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	sessionId = session.id
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, isActive: true })

	// A long transcript, hidden from the prompt (so the turn stays an ordinary
	// one) but not from the annotation lane, which indexes every message.
	const contents = Array.from(
		{ length: MESSAGES },
		(_, i) =>
			`We rode from Waystation ${i % ENTRIES} to Waystation ${(i * 7) % ENTRIES} and met the ashguard.`
	)
	for (let at = 0; at < contents.length; at += 200) {
		const rows = await db
			.insert(schema.sessionMessages)
			.values(
				contents.slice(at, at + 200).map((content) => ({
					sessionId,
					role: "assistant",
					content,
					isHidden: true
				}))
			)
			.returning({ id: schema.sessionMessages.id })
		await db
			.insert(schema.messages)
			.values(rows.map((r) => ({ id: r.id, sessionId, role: "assistant" })))
	}
	const [ask] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "user", content: "Have you seen the ashguard?" })
		.returning()
	await db.insert(schema.messages).values({ id: ask.id, sessionId, role: "user" })
}, 180_000)

afterAll(async () => {
	const { annotationLane } = await import("$lib/server/annotations/queue")
	annotationLane.stop()
	await annotationLane.settled()
	const { resetTurnHoldsForTests } = await import("./turnHold")
	resetTurnHoldsForTests()
})

describe("a turn beats a heavy annotation job", () => {
	test(
		"the turn's lore reads finish inside their clocks, the job pauses for it and resumes after",
		async () => {
			const { annotationLane, enqueueSessionAnnotation } = await import(
				"$lib/server/annotations/queue"
			)
			const { setTurnHoldGraceForTests } = await import("./turnHold")
			setTurnHoldGraceForTests(200)
			// Loaded before the job starts, so nothing but the turn itself
			// stands between measuring the lane and the hold opening.
			const { runTurn } = await import(
				"$lib/server/pipelines/runtime/runTurn"
			)

			enqueueSessionAnnotation(sessionId, lorebookId, "Big session")
			// This poll is a timer: it can only fire because the lane goes
			// round the event loop between items.
			const startedAt = Date.now()
			while ((await annotatedMessages()) < 5) {
				if (Date.now() - startedAt > 30_000)
					throw new Error("the annotation lane never got going")
				await delay(20)
			}
			const atTurnStart = await annotatedMessages()
			expect(annotationLane.isRunning()).toBe(true)
			expect(atTurnStart).toBeLessThan(MESSAGES)

			const receipt: any = await runTurn({
				db,
				sessionId,
				userId,
				currentCharacterId: characterId,
				text: "",
				preview: true,
				skipReceipt: true
			} as any)
			const atTurnEnd = await annotatedMessages()

			const late = (receipt.nodes ?? []).filter((n: any) => n.timedOut)
			expect(
				late.map((n: any) => `${n.nodeKey}: ${n.reason}`),
				"no step may run out of time"
			).toEqual([])
			const lore = (receipt.nodes ?? []).filter((n: any) =>
				String(n.definitionId ?? "").includes("lore")
			)
			expect(lore.length, "the spec reads lore").toBeGreaterThan(0)
			for (const n of lore)
				if (typeof n.timeoutMsApplied === "number")
					expect(n.elapsedMs, n.nodeKey).toBeLessThan(n.timeoutMsApplied)
			const prompt = JSON.stringify(receipt.preview?.context?.rendered ?? null)
			expect(prompt).toContain("Riders who patrol the ash wastes.")

			// One background item may have been in flight when the turn began.
			expect(atTurnEnd - atTurnStart).toBeLessThanOrEqual(1)

			// And the job resumes once the grace has passed.
			const resumedBy = Date.now() + 30_000
			while ((await annotatedMessages()) <= atTurnEnd + 2) {
				if (Date.now() > resumedBy)
					throw new Error("the annotation job never resumed after the turn")
				await delay(20)
			}
			expect(await annotatedMessages()).toBeGreaterThan(atTurnEnd)
		},
		120_000
	)
})
