/**
 * Every kind of retrievable entry has a lane in the shipped reply pipeline.
 *
 * ⚠ This exists because one did not. Spec 1.8.0 replaced the single
 * `lorebook-triggers@1` query with two nodes that each filter the shared scan
 * to their own `source` — and nothing filtered for `history`, so dated
 * summaries were read, scored, and dropped. From 1.8.0 until 1.10.0 the reply
 * pipeline could not put a history entry in a prompt.
 *
 * Nothing failed, and that is the shape of the defect worth remembering: the
 * ranker still declared a `history` band, `assemble` still asked for history
 * blocks, `variableLayouts` still shipped a layout for them, and all three got
 * nothing. Absence is the same as "no entry matched", which is a normal state.
 *
 * The parity corpus was green the whole time, because its harness rendered
 * through `lorebook-triggers@1` rather than through this document. It mirrors
 * the three lanes now, so it would catch a repeat — but a corpus fixture tells
 * you a prompt diverged, not which source has no producer. This asserts the
 * structural fact directly: what the host can tag, the spec must consume.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { respondSpec } from "$lib/server/pipelines/specs/respond"
import * as schema from "$lib/server/db/schema"

// No embedding model, so the keyword arm runs — which is the arm that tags
// candidates with a source in the first place.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

let db: TestDb
let sessionId: number
let userId: number

/**
 * Every source `toLoreEntry` can stamp on a candidate.
 *
 * Written out rather than derived from the ranker's bands: those include
 * `messages`, which comes from a different query, and `relationships`, which
 * bypasses the ranker entirely. This is specifically the set that arrives
 * through `lorebook_entries`, which is the set the lane split can drop.
 */
const RETRIEVABLE = ["worldLore", "characterLore", "history"] as const

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "lanes", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Lanes", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	// One of each, all keyed on the same word, so a lane that runs at all finds
	// its entry — and a lane that is missing is the only reason one is absent.
	await db.insert(schema.worldLoreEntries).values({
		lorebookId: lorebook.id,
		name: "The Ashguard",
		keys: "ashguard",
		content: "An order of oathbound riders."
	})
	// Bound, because unbound character lore is never visible to anybody —
	// `isCharacterLoreEntryVisible` returns false on a missing binding, which
	// is the "private self-knowledge" rule and not an accident. A binding with
	// neither a character nor a persona is a background one, visible in
	// narrator mode, which is the mode this run is in.
	const [binding] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			binding: "{{npc:1}}",
			name: "The Ashguard order"
		})
		.returning()
	await db.insert(schema.characterLoreEntries).values({
		lorebookId: lorebook.id,
		lorebookBindingId: binding.id,
		name: "Vell's oath",
		keys: "ashguard",
		content: "She swore it twice."
	})
	// No `name`: a history entry is identified by its date, not a title.
	await db.insert(schema.historyEntries).values({
		lorebookId: lorebook.id,
		keys: "ashguard",
		content: "The siege broke in the spring.",
		year: 412,
		month: 3
	})

	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "tell me about the ashguard"
	} as any)
}, 60_000)

const rankedSources = async (): Promise<string[]> => {
	const receipt = await run(respondSpec(), {
		input: {
			text: "tell me about the ashguard",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:lanes",
		bindings: coreBindings(),
		host: createHost(db as any, { sessionId, userId }),
		// Stops before `generate`, which needs a connection this test has no
		// business supplying — everything under test happens upstream of it.
		preview: true
	} as any)

	const rank = receipt.nodes.find((n: any) => n.nodeKey === "rank")
	expect(rank, "the reply pipeline has no ranking step").toBeTruthy()
	return ((rank!.output as any)?.candidates ?? []).map((c: any) => c.source)
}

describe("the reply pipeline consumes every source it can retrieve", () => {
	it("puts world lore, character lore and history in front of the ranker", async () => {
		const sources = new Set(await rankedSources())
		for (const source of RETRIEVABLE)
			expect(
				sources.has(source),
				`nothing in the pipeline produces "${source}" candidates — ` +
					`the ranker, the assembler and the layouts all still ask for them`
			).toBe(true)
	}, 30_000)
})
