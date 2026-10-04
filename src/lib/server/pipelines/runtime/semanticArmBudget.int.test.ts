/**
 * Search by meaning spends the lore's budget on lore (plan A1).
 *
 * The vector index holds past messages, graph nodes, links and cast rows
 * beside the lorebook's entries. A message hit would land in the `messages`
 * band, where the conversation's band intent keeps a minimum of six: the
 * ranker reserves its tokens at score 0 before the lore shares are divided,
 * and `assemble` never renders a ranked message — the transcript is built
 * from the history read's lines. A graph node, a cast character or a persona
 * has no band at all (`excluded_unknown_source`), and a link hit has no lane
 * a relationship section renders; yet each took one of the search's
 * `maxEntries` places ahead of an entry it outscored. So the semantic
 * mechanism asks the index for lorebook entries only.
 *
 * Asserted on the ranker's receipt, band by band, over the SHIPPED reply
 * spec and the REAL candidate fetch: the database is the test one, so the
 * sources the arm asks for are the sources it gets.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { run } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { respondSpec } from "$lib/server/pipelines/specs/respond"
import {
	insertNarrativeNodeRow,
	insertSessionCharacterRow,
	seedEntryVectors,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const MODEL = "test-embed-model"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/** A toy embedding: one axis for "is this about the ashguard". */
const vectorFor = (text: string): number[] => [
	text.toLowerCase().includes("ashguard") ? 1 : 0,
	1
]

vi.mock("$lib/server/embedding", async (importOriginal) => ({
	// The real `cosineSimilarity`, which the candidate ranking scores with.
	...(await importOriginal<typeof import("$lib/server/embedding")>()),
	isModelReady: () => true,
	getLoadedModelId: () => MODEL,
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor)
}))

/** What the arm asked the eager index pass to cover, per turn. */
const promotions: Array<{ sources?: readonly string[] }> = []
vi.mock(
	"$lib/server/embedding/vectorizationQueue",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("$lib/server/embedding/vectorizationQueue")
			>()
		return {
			...actual,
			promoteScopedVectors: async (
				_context: unknown,
				_model: string,
				opts: { sources?: readonly string[] } = {}
			) => {
				promotions.push({ sources: opts.sources })
				return {
					requested: 0,
					processed: 0,
					remaining: 0,
					boundHit: false,
					reason: "nothing to index — the scope was already covered"
				}
			}
		}
	}
)

let db: TestDb
let sessionId: number
let userId: number
let loreId: number
let oldLineId: number

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const [user] = await db
		.insert(schema.users)
		.values({ username: "semantic-budget", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Budget", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	// Reachable by meaning alone: no key the conversation says.
	const [entry] = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: lorebook.id,
					name: "The Wastes",
					keys: "wastes",
					content: "the ash wastes the ashguard patrol"
				}
			])
		)
		.returning()
	loreId = entry!.id
	await seedEntryVectors(
		db,
		[loreId],
		vectorFor("the ash wastes the ashguard patrol"),
		MODEL
	)

	// An old line about the same thing, embedded under the loaded model and
	// far enough back that no recent-window exclusion covers it: a hit the
	// index would return if the arm asked it for messages.
	const [oldLine] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			role: "user",
			content: "the ashguard rode out at dawn",
			embedding: vectorFor("the ashguard rode out at dawn"),
			embeddingModel: MODEL
		} as any)
		.returning()
	oldLineId = oldLine!.id

	// A transcript longer than any recent window, unembedded, so the old
	// line above is the only message the index could return.
	await db.insert(schema.sessionMessages).values(
		Array.from({ length: 120 }, (_, i) => ({
			sessionId,
			role: i % 2 ? "assistant" : "user",
			content: i === 119 ? "tell me about the ashguard" : `line ${i}`
		})) as any
	)
})

/** One turn of the shipped reply spec with Search by meaning on. */
const turn = async (
	opts: { sessionId: number; maxEntries: number } = {
		sessionId: 0,
		maxEntries: 10
	}
) => {
	const sid = opts.sessionId || sessionId
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db, { sessionId: sid })
	for (const o of [
		{ nodeKey: "semantic.arm.queries", path: "searchByMeaning", value: "on" },
		{
			nodeKey: "semantic.arm.search",
			path: "maxEntries",
			value: opts.maxEntries
		}
	])
		world.overrides.push({
			nodeKey: o.nodeKey,
			slot: "params",
			path: o.path,
			value: o.value,
			scopeKind: "defaults"
		} as any)

	return (await run(respondSpec(), {
		world,
		input: {
			text: "tell me about the ashguard",
			sessionId: sid,
			characterId: null,
			sessionScope: { sessionId: sid, currentCharacterId: null }
		},
		seed: "seed:semantic-budget",
		bindings: coreBindings(),
		host: createHost(db, { sessionId: sid, userId }),
		preview: true
	} as any)) as any
}

const node = (receipt: any, key: string) =>
	receipt.nodes.find((n: any) => n.nodeKey === key)

describe("Search by meaning and the lore budget", () => {
	it("searches the lorebook, and reserves nothing for messages it cannot render", async () => {
		promotions.length = 0
		const receipt = await turn()

		const search = node(receipt, "semantic.arm.search")
		expect(search?.result, search?.reason).toBe("ok")
		const found: string[] = ((search?.output as any)?.main ?? []).map(
			(c: any) => `${c.source}:${c.id}`
		)
		// Not vacuous: the search ran, and found the entry only meaning reaches.
		expect(found).toContain(`worldLore:${loreId}`)
		// …and never the old line, which no shipped prompt places.
		expect(found).not.toContain(`message:${oldLineId}`)

		const rank = node(receipt, "rank")?.output as any
		expect(rank, "the ranker did not run").toBeTruthy()
		expect(
			rank.groups?.messages?.used ?? 0,
			"the messages band reserved tokens for a ranked message nothing renders"
		).toBe(0)
		const spentOnMessages = (rank.decisions ?? []).filter(
			(d: any) => d.included && d.candidate?.source === "messages"
		)
		expect(spentOnMessages).toEqual([])
		expect(
			(rank.candidates ?? []).map((c: any) => `${c.source}:${c.id}`)
		).toContain(`worldLore:${loreId}`)
	})

	it("searches the lorebook's entries and nothing else, spelled as the index spells them", async () => {
		// The binding cannot import the index's list (it would load the
		// database with the bindings), so the spelling is held here: a source
		// renamed in the index and not in the search fails this.
		const { RAG_INDEX_SOURCES } = await import(
			"$lib/server/embedding/ragContext"
		)
		const { SEMANTIC_SEARCH_SOURCES } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		expect([...SEMANTIC_SEARCH_SOURCES].sort()).toEqual([
			"characterLore",
			"historyEntry",
			"worldLore"
		])
		for (const source of SEMANTIC_SEARCH_SOURCES)
			expect(RAG_INDEX_SOURCES as readonly string[]).toContain(source)
	})

	it("asks the eager index pass for the sources it searches, and nothing else", async () => {
		promotions.length = 0
		await turn()
		expect(promotions.length).toBe(1)
		expect(
			promotions[0]!.sources,
			"the pass was left to cover every source"
		).toBeDefined()
		expect([...promotions[0]!.sources!].sort()).toEqual([
			"characterLore",
			"historyEntry",
			"worldLore"
		])
	})

	/**
	 * The review's probe, pinned: a cast character and a graph node that
	 * match the scene better than any entry took the search's places first,
	 * and the ranker then dropped both (`excluded_unknown_source`), so the
	 * turn brought in fewer entries than `maxEntries` said and the one it
	 * cut was lore.
	 */
	it("gives every place under maxEntries to a lorebook entry", async () => {
		const [lorebook] = await db
			.insert(schema.lorebooks)
			.values({ name: "Slots", userId })
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, lorebookId: lorebook.id })
			.returning()

		// Two entries, each a little off the question's direction…
		const entries = await db
			.insert(schema.lorebookEntries)
			.values(
				worldLoreValues(
					["north", "south"].map((side) => ({
						lorebookId: lorebook.id,
						name: `The ${side} wastes`,
						keys: `zz-${side}`,
						content: `the ${side} wastes the ashguard patrol`
					}))
				)
			)
			.returning()
		await seedEntryVectors(
			db,
			entries.map((e: any) => e.id),
			[1, 0.5],
			MODEL
		)

		// …and a cast member and a graph node exactly on it.
		const [captain] = await db
			.insert(schema.characters)
			.values({
				userId,
				name: "Vel",
				description: "the ashguard captain",
				embedding: vectorFor("the ashguard captain"),
				embeddingModel: MODEL
			} as any)
			.returning()
		await insertSessionCharacterRow(db, session.id, captain!.id)
		const graphNode = await insertNarrativeNodeRow(db, lorebook.id, {
			name: "The Ashguard",
			embedding: vectorFor("the ashguard"),
			embeddingModel: MODEL
		} as any)

		await db.insert(schema.sessionMessages).values({
			sessionId: session.id,
			role: "user",
			content: "tell me about the ashguard"
		} as any)

		const receipt = await turn({
			sessionId: session.id,
			maxEntries: entries.length
		})
		const search = node(receipt, "semantic.arm.search")
		expect(search?.result, search?.reason).toBe("ok")
		const found: string[] = ((search?.output as any)?.main ?? []).map(
			(c: any) => `${c.source}:${c.id}`
		)
		expect(found).not.toContain(`character:${captain!.id}`)
		expect(found).not.toContain(`narrativeNode:${graphNode!.id}`)
		expect(found.sort()).toEqual(
			entries.map((e: any) => `worldLore:${e.id}`).sort()
		)
	})
})
