/**
 * **The retrieval arms take a `speaker`** (plan C3, owner ruling R3,
 * 2026-10-02) — `core:query/vector-search@1`, `core:query/entity-search@1` and
 * `core:query/entity-link@1`, on `core:query/character-lore@1`'s terms.
 *
 * ## Why it exists
 *
 * Each arm is wired ONCE per gather, but a per-voice clause speaks as several
 * people. An arm wired inside that clause with no speaker answers to the run's
 * scope, so every voice would be offered the same pool — and the pool is
 * gated against one subject only. The port names the voice this iteration
 * speaks as, and the host's `lorebook_entries` gate decides for that voice.
 *
 * ## What is pinned here, for each arm
 *
 *  - **Unwired** (absent, `null`, `""`): the scope decides, exactly as before
 *    the port existed. The narrator's scope sees the NPC binding's lore and
 *    neither cast member's private lore. A character's scope sees that
 *    character's own lore. No scope sees BOTH cast members' private lore, so
 *    that is pinned as never happening, not as a baseline.
 *  - **`character:<id>`**: that character's own private lore, and nobody
 *    else's. A wired speaker wins over the scope's subject.
 *  - **Any other reference** (`user:1`, `envoy:narrator`, an id belonging to
 *    nobody): no private lore at all. World lore and history still come back.
 *    It must never read as `null`, which is the omniscient narrator.
 *
 * Each binding is invoked directly against a real host over a real test
 * database, on `vector.int.test.ts`'s terms: the arm's lore read IS the gate,
 * and the rows here are what that read returns. Embedding is stubbed with a
 * one-axis toy (every text is `[1, 0]`), so every row is as close as a row can
 * be and only the visibility gate can take one out.
 *
 * ⚠ **`entity-link` re-ranks a pool it is handed and admits nothing**, so
 * "present" there means *linked* (an `entityVector` signal and a
 * `links` row), not *returned*: a candidate it may not link still passes
 * through the republished pool unenriched. Removing it is the upstream lore
 * read's job, not this arm's.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { roughTokens } from "@serene-pub/sdk"
import { type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	characterLoreValues,
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"

/**
 * One database for the host AND for the queues it promotes through — the
 * annotation lane and the vectorization lane both reach `$lib/server/db`
 * directly, so the entity arm's index would otherwise be written somewhere
 * the host never reads.
 */
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "arms-speaker-secret" }
})

/** Every text is the same direction: closeness can exclude nobody. */
const vectorFor = (_text: string): number[] => [1, 0]

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => true,
	getLoadedModelId: () => "test-embed-model",
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor)
}))

/**
 * What the vector index holds, filled once the rows have ids. Every row of the
 * book, private lore included — the index carries no bindings, which is the
 * whole reason the arm must gate against the lore read.
 */
let poolRows: any[] = []

vi.mock("$lib/server/embedding/ragContext", () => ({
	// An empty scope, so the eager index pass has nothing to promote: the
	// subject here is the gate, not the indexer.
	getSessionRagContext: async (sessionId: number) => ({
		sessionId,
		characterIds: [],
		personaIds: [],
		lorebookId: null,
		allLorebookIds: []
	}),
	fetchScopedCandidates: async (
		_context: unknown,
		opts: { sources?: readonly string[] } = {}
	) => ({
		candidates: poolRows.filter(
			(row) => !opts.sources || opts.sources.includes(row.source)
		),
		truncated: []
	}),
	rankScopedCandidates: (
		candidates: any[],
		query: number[],
		topK?: number
	) => {
		const dot = (a: number[], b: number[]) =>
			a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)
		return candidates
			.map((c) => ({ ...c, score: dot(c.embedding, query) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK ?? candidates.length)
	}
}))

let db: TestDb
let sessionId: number
let userId: number
/** The two cast members whose private lore must not meet. */
let verity: number
let brask: number

/** Entry id → a readable label, so assertions name the rows. */
const label = new Map<number, string>()
let worldId: number
let historyId: number
let verityLoreId: number
let braskLoreId: number
let npcLoreId: number

const bindings = coreBindings()

/**
 * A binding context over a fresh host — one per invocation, which is one run:
 * the host keeps the book it read for the run, and a test is not a run.
 */
const ctxFor = (definitionId: string) => {
	const host = createHost(db as any, { sessionId, userId })
	const node = { key: "arm", definitionId, definitionVersion: 1, kind: "query" }
	return {
		read: (table: string, q: unknown) =>
			host.read!(table, q as any, node as any),
		signal: new AbortController().signal,
		progress: () => {},
		log: () => {},
		status: () => {},
		countTokens: roughTokens
	}
}

/** Absent from the input altogether: the port is not wired. */
const UNWIRED = Symbol("unwired")
type Speaker = typeof UNWIRED | unknown

const speakerPart = (speaker: Speaker) =>
	speaker === UNWIRED ? {} : { speaker }

const labels = (ids: number[]) =>
	ids.map((id) => label.get(id) ?? `unknown:${id}`).sort()

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "arms-speaker", isAdmin: false })
		.returning()
	userId = user.id

	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "The well at Ashford", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: book.id })
		.returning()
	sessionId = session.id

	const [v] = await db
		.insert(schema.characters)
		.values({ userId, name: "Verity", description: "Lies for a living." })
		.returning()
	const [b] = await db
		.insert(schema.characters)
		.values({ userId, name: "Brask", description: "Carries the lamp." })
		.returning()
	verity = v.id
	brask = b.id

	// Two character bindings — each one's lore is that character's own — and
	// an NPC binding with no card, whose lore only the narrator may read.
	const [vBinding, bBinding, npcBinding] = await db
		.insert(schema.lorebookBindings)
		.values([
			{
				lorebookId: book.id,
				binding: "{{char:1}}",
				name: "Verity",
				characterId: verity
			},
			{
				lorebookId: book.id,
				binding: "{{char:2}}",
				name: "Brask",
				characterId: brask
			},
			{ lorebookId: book.id, binding: "{{char:3}}", name: "The Ashguard" }
		])
		.returning()

	// Every row names the old well, so every arm can reach every row and
	// only the gate decides what comes back.
	const [world] = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: book.id,
					name: "The Old Well",
					keys: "",
					content: "Everybody in the square can see the old well."
				}
			])
		)
		.returning()
	const [history] = await db
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{
					lorebookId: book.id,
					keys: "",
					content: "The old well was dug in the founding year.",
					year: 412
				}
			])
		)
		.returning()
	const [vLore, bLore, npcLore] = await db
		.insert(schema.lorebookEntries)
		.values(
			characterLoreValues([
				{
					lorebookId: book.id,
					name: "Verity's secret",
					keys: "",
					content: "Verity hid the key in the old well.",
					lorebookBindingId: vBinding.id
				},
				{
					lorebookId: book.id,
					name: "Brask's secret",
					keys: "",
					content: "Brask cannot swim, and the old well frightens him.",
					lorebookBindingId: bBinding.id
				},
				{
					lorebookId: book.id,
					name: "The Ashguard's orders",
					keys: "",
					content: "The Ashguard watch the old well at night.",
					lorebookBindingId: npcBinding.id
				}
			])
		)
		.returning()

	worldId = world.id
	historyId = history.id
	verityLoreId = vLore.id
	braskLoreId = bLore.id
	npcLoreId = npcLore.id
	label.set(worldId, "world")
	label.set(historyId, "history")
	label.set(verityLoreId, "verity")
	label.set(braskLoreId, "brask")
	label.set(npcLoreId, "npc")

	// The index's spelling: history is `historyEntry` there.
	poolRows = [
		{ source: "worldLore", row: world },
		{ source: "historyEntry", row: history },
		{ source: "characterLore", row: vLore },
		{ source: "characterLore", row: bLore },
		{ source: "characterLore", row: npcLore }
	].map(({ source, row }) => ({
		source,
		id: row.id,
		name: row.title ?? "",
		content: row.content,
		embedding: vectorFor(row.content),
		lorebookId: book.id
	}))

	// The window the entity arm reads its entities from.
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "Verity and Brask waited by the old well."
	} as any)
}, 60_000)

/** Every reference that is somebody, but no character row the cast has. */
const NOBODY = ["user:1", "envoy:narrator", `character:999999`]

// ---------------------------------------------------------------------------

describe("each arm declares the port it reads", () => {
	it(
		"vector-search, entity-search and entity-link all read `speaker`",
		async () => {
			for (const id of [
				"core:query/vector-search@1",
				"core:query/entity-search@1",
				"core:query/entity-link@1"
			])
				expect(
					(bindings[id] as any)?.requires?.ports,
					`${id} does not declare the speaker port it reads`
				).toContain("speaker")
		},
		60_000
	)
})

// ---------------------------------------------------------------------------

describe("core:query/vector-search@1", () => {
	const search = async (
		speaker: Speaker,
		currentCharacterId: number | null = null
	) => {
		const r: any = await bindings["core:query/vector-search@1"]!(
			{
				vectors: [[1, 0]],
				scope: { sessionId, currentCharacterId },
				params: { maxEntries: 50 },
				...speakerPart(speaker)
			},
			ctxFor("core:query/vector-search") as any
		)
		expect(r.kind).toBe("ok")
		return {
			hits: labels((r.value.hits as any[]).map((h) => h.id)),
			withheld: labels(
				(r.value.skipped as any[])
					.filter((s) => /not visible to the current speaker/.test(s.reason))
					.map((s) => s.id)
			)
		}
	}

	it(
		"unwired, the narrator's scope decides as before — the NPC's lore, neither cast member's",
		async () => {
			const r = await search(UNWIRED, null)
			expect(r.hits).toEqual(["history", "npc", "world"])
			expect(r.withheld).toEqual(["brask", "verity"])
		},
		60_000
	)

	it(
		"unwired, a character's scope decides as before — that character's own lore",
		async () => {
			const r = await search(UNWIRED, verity)
			expect(r.hits).toEqual(["history", "verity", "world"])
			expect(r.withheld).toEqual(["brask", "npc"])
		},
		60_000
	)

	it(
		"a null or empty speaker is unwired, not a speaker named nobody",
		async () => {
			const baseline = await search(UNWIRED, verity)
			for (const speaker of [null, ""])
				expect(await search(speaker, verity)).toEqual(baseline)
		},
		60_000
	)

	it(
		"character:<A> reads A's private lore and not B's, with world lore and history",
		async () => {
			const r = await search(`character:${verity}`)
			expect(r.hits).toEqual(["history", "verity", "world"])
			expect(r.hits).not.toContain("brask")
			expect(r.withheld).toContain("brask")
			// Naming a character takes the narrator's view away with it.
			expect(r.hits).not.toContain("npc")
		},
		60_000
	)

	it(
		"a wired speaker wins over the scope's subject",
		async () => {
			const r = await search(`character:${brask}`, verity)
			expect(r.hits).toEqual(["brask", "history", "world"])
			expect(r.withheld).toEqual(["npc", "verity"])
		},
		60_000
	)

	it(
		"any other reference reads no private lore — never the narrator's omniscience",
		async () => {
			for (const speaker of NOBODY) {
				const r = await search(speaker, null)
				expect(r.hits, speaker).toEqual(["history", "world"])
				expect(r.withheld, speaker).toEqual(["brask", "npc", "verity"])
			}
		},
		60_000
	)
})

// ---------------------------------------------------------------------------

describe("core:query/entity-search@1", () => {
	const search = async (
		speaker: Speaker,
		currentCharacterId: number | null = null
	) => {
		const r: any = await bindings["core:query/entity-search@1"]!(
			{
				scope: { sessionId, currentCharacterId },
				// The transcript half off: this file is about lore visibility,
				// and the message pass is background work it has no use for.
				params: { maxEntries: 10, maxMessages: 0 },
				...speakerPart(speaker)
			},
			ctxFor("core:query/entity-search") as any
		)
		expect(r.kind).toBe("ok")
		return labels((r.value.hits as any[]).map((h) => h.id))
	}

	it(
		"finds every row the gate lets through — the fixture's own control",
		async () => {
			// Without this, "B's lore is absent" could be an entity that never
			// matched rather than a gate that held.
			const r = await search(UNWIRED, null)
			expect(r).toEqual(["history", "npc", "world"])
		},
		60_000
	)

	it(
		"unwired, a character's scope decides as before — that character's own lore",
		async () => {
			expect(await search(UNWIRED, verity)).toEqual([
				"history",
				"verity",
				"world"
			])
			expect(await search(UNWIRED, brask)).toEqual([
				"brask",
				"history",
				"world"
			])
		},
		60_000
	)

	it(
		"a null or empty speaker is unwired, not a speaker named nobody",
		async () => {
			for (const speaker of [null, ""])
				expect(await search(speaker, verity)).toEqual([
					"history",
					"verity",
					"world"
				])
		},
		60_000
	)

	it(
		"character:<A> reads A's private lore and not B's, with world lore and history",
		async () => {
			const one = await search(`character:${verity}`)
			const two = await search(`character:${brask}`)
			expect(one).toEqual(["history", "verity", "world"])
			expect(two).toEqual(["brask", "history", "world"])
		},
		60_000
	)

	it(
		"a wired speaker wins over the scope's subject",
		async () => {
			expect(await search(`character:${brask}`, verity)).toEqual([
				"brask",
				"history",
				"world"
			])
		},
		60_000
	)

	it(
		"any other reference reads no private lore — never the narrator's omniscience",
		async () => {
			for (const speaker of NOBODY)
				expect(await search(speaker, null), speaker).toEqual([
					"history",
					"world"
				])
		},
		60_000
	)
})

// ---------------------------------------------------------------------------

describe("core:query/entity-link@1", () => {
	/**
	 * The pool the arm is handed: every row of the book, private lore of both
	 * cast members included — the shape a pool shared across a repeating
	 * clause can have, which is what the port guards.
	 */
	const pool = () =>
		[
			{ id: worldId, source: "worldLore" },
			{ id: historyId, source: "history" },
			{ id: verityLoreId, source: "characterLore" },
			{ id: braskLoreId, source: "characterLore" },
			{ id: npcLoreId, source: "characterLore" }
		].map((c) => ({
			...c,
			tokens: 8,
			signals: {},
			priority: 1,
			payload: { id: c.id, name: label.get(c.id) }
		}))

	const link = async (
		speaker: Speaker,
		currentCharacterId: number | null = null
	) => {
		const r: any = await bindings["core:query/entity-link@1"]!(
			{
				scope: { sessionId, currentCharacterId },
				candidates: pool(),
				mentions: [{ text: "the one by the water", position: 0 }],
				vectors: [[1, 0]],
				params: { maxLinks: 10 },
				...speakerPart(speaker)
			},
			ctxFor("core:query/entity-link") as any
		)
		expect(r.kind).toBe("ok")
		const enriched = (r.value.candidates as any[]).filter(
			(c) => c?.signals?.entityVector !== undefined
		)
		return {
			links: labels((r.value.links as any[]).map((l) => l.id)),
			enriched: labels(enriched.map((c) => c.id)),
			/** Every candidate that came back out, enriched or not. */
			passed: labels((r.value.candidates as any[]).map((c) => c.id))
		}
	}

	it(
		"unwired, links everything in the pool it can name — no second gate, as before",
		async () => {
			// History is dated, not titled, and has no binding: no name, so no
			// link, whoever is speaking. It is still passed through.
			const r = await link(UNWIRED, null)
			expect(r.links).toEqual(["brask", "npc", "verity", "world"])
			expect(r.enriched).toEqual(r.links)
			expect(r.passed).toEqual(["brask", "history", "npc", "verity", "world"])
			// The scope does not filter an unwired link either.
			expect((await link(UNWIRED, verity)).links).toEqual([
				"brask",
				"npc",
				"verity",
				"world"
			])
		},
		60_000
	)

	it(
		"character:<A> links A's private lore and never B's, with world lore",
		async () => {
			const r = await link(`character:${verity}`)
			expect(r.links).toEqual(["verity", "world"])
			expect(r.enriched).toEqual(["verity", "world"])
			// Reordering only: B's row and the narrator's are handed back as
			// they arrived, carrying no link that would rank them higher.
			expect(r.passed).toEqual(["brask", "history", "npc", "verity", "world"])

			expect((await link(`character:${brask}`)).links).toEqual([
				"brask",
				"world"
			])
		},
		60_000
	)

	it(
		"a wired speaker wins over the scope's subject",
		async () => {
			expect((await link(`character:${brask}`, verity)).links).toEqual([
				"brask",
				"world"
			])
		},
		60_000
	)

	it(
		"any other reference links no private lore — never the narrator's omniscience",
		async () => {
			for (const speaker of NOBODY) {
				const r = await link(speaker, null)
				expect(r.links, speaker).toEqual(["world"])
				expect(r.enriched, speaker).toEqual(["world"])
			}
		},
		60_000
	)

	it(
		"a null or empty speaker is unwired: no second gate, whatever the scope",
		async () => {
			// `character-lore`'s semantics, as on vector-search and
			// entity-search (fixed 2026-10-02: the binding tested only
			// `speaker === undefined`, so `null`/`""` ran the lore read and the
			// scope's subject decided).
			for (const speaker of [null, ""]) {
				for (const scope of [verity, null])
					expect((await link(speaker, scope)).links, String(speaker)).toEqual([
						"brask",
						"npc",
						"verity",
						"world"
					])
			}
		},
		60_000
	)
})
