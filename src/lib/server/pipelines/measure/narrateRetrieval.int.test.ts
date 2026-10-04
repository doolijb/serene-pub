/**
 * Narration retrieves what the retrieval controls say it retrieves.
 *
 * ## The defect
 *
 * Until the narrator split (ruling 2026-09-07) `core:spec/narrate` wired the
 * keyword mechanism and the ranker and **nothing else**. Every other retrieval
 * control the panel renders for that pipeline — "find entries by meaning",
 * "find entries by name", the entity scan — resolved through the whole scope
 * chain into a value no node read, because there was no node. A user turned one
 * on and got no change at all, with nothing anywhere saying so.
 *
 * That is the same control-with-no-effect class the retrieval audit spent a day
 * removing, and it survived in the one pipeline the audit's evidence could not
 * see: **parity is structurally blind to lore ranking**, because
 * `pipelinePreview` renders `parityPipeline()` — a corpus-specific document with
 * no semantic block at all — so a green gate says nothing about which mechanisms
 * the shipped narration documents carry. The evidence has to be a measurement,
 * and this is it.
 *
 * ## What is measured
 *
 * One entry reachable only by *meaning*: keyed on a word this conversation never
 * says, so no keyword scan reaches it at any depth. Turning the semantic
 * mechanism on must bring it in; leaving it at its shipped default (off) must
 * not. Run against **both** narration specs, because the split doubled the
 * surface and half a fix is the failure mode this file exists to prevent.
 *
 * ⚠ The mechanisms ship **off**. That is deliberate — an upgraded install
 * retrieves exactly what it retrieved before — and it is also why "the control
 * does nothing" and "the control is not wired" look identical from outside. The
 * cases below are run in pairs for that reason: an assertion that only checked
 * the on state would pass against a spec where the mechanism was always on, and
 * one that only checked the off state would pass against today's defect.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { narrateSpec, narrateCharacterSpec } from "$lib/server/pipelines/specs/narrate"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"

/** A toy embedding, one readable axis — `semanticArm.int.test.ts`'s device. */
const vectorFor = (text: string): number[] => [
	text.toLowerCase().includes("ashguard") ? 1 : 0,
	1
]

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => true,
	getLoadedModelId: () => "test-embed-model",
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor)
}))

let poolRows: any[] = []
vi.mock("$lib/server/embedding/ragContext", () => ({
	getSessionRagContext: async () => ({ lorebookId: 1 }),
	fetchScopedCandidates: async () => ({ candidates: poolRows, truncated: [] }),
	rankScopedCandidates: (candidates: any[], query: number[], topK?: number) => {
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
/** The entry both mechanisms reach, and the one only meaning does. */
let keyedId: number
let meaningOnlyId: number

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "narrate-retrieval", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Narration retrieval", userId })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	const world = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: lorebook.id,
					name: "The Ashguard",
					keys: "ashguard",
					content: "An order of oathbound riders."
				},
				// ⚠ Keyed on a word this conversation never says. The keyword
				// scan cannot reach it at any scan depth or recursion depth, so
				// its presence is a statement about the *semantic* mechanism and
				// nothing else — which is what makes the pair of runs below a
				// measurement rather than a coincidence.
				{
					lorebookId: lorebook.id,
					name: "The Wastes",
					keys: "wastes",
					content: "the ash wastes the ashguard patrol"
				}
			])
		)
		.returning()
	keyedId = world[0]!.id
	meaningOnlyId = world[1]!.id
	poolRows = world.map((row: any) => ({
		source: "worldLore",
		id: row.id,
		name: row.name,
		content: row.content,
		embedding: vectorFor(row.content),
		lorebookId: lorebook.id
	}))

	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "tell me about the ashguard"
	} as any)

	/**
	 * ⚠ **A warm-up turn, discarded — and it is load-bearing, not tidiness.**
	 *
	 * `core:query/vector-search@1` declares a 3s timeout, and the host's first
	 * semantic read pays a cold dynamic import of the vectorization queue and
	 * the embedding runtime behind it. On a loaded machine that alone exceeds
	 * the budget, and the node comes back `err: timeout` — which presents as
	 * "the mechanism found nothing", i.e. **exactly the defect this file is
	 * measuring**. A file whose first assertion is the one that pays the import
	 * would report the bug it was written to detect, at random.
	 */
	await narrationTurn(narrateSpec, [
		{ nodeKey: "semantic.arm.queries", path: "searchByMeaning", value: "on" },
		{ nodeKey: "semantic.arm.search", path: "maxEntries", value: 10 }
	])
}, 120_000)

/**
 * One narration turn, stopped before the provider.
 *
 * `overrides` reach the nodes through the `params` slots the documents wire, at
 * `defaults` scope — the same route `semanticArm.int.test.ts` and the RAG
 * harness use. ⚠ That is not incidental: a run whose override reached nothing
 * would look exactly like a mechanism that found nothing, so the pair of runs
 * measures the slot's wiring as much as the mechanism's.
 */
const narrationTurn = async (
	spec: () => any,
	overrides: Array<{ nodeKey: string; path: string; value: unknown }> = []
) => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db, { sessionId })
	for (const o of overrides)
		world.overrides.push({
			nodeKey: o.nodeKey,
			slot: "params",
			path: o.path,
			value: o.value,
			scopeKind: "defaults"
		} as any)

	return (await run(spec(), {
		world,
		input: {
			text: "tell me about the ashguard",
			sessionId,
			characterId: null,
			// A world narrator speaks as nobody; the side-character spec is
			// handed a free-form name so the two runs differ only in document.
			speaker: null,
			sideCharacter: {
				name: "The innkeeper",
				characterId: null,
				known: false,
				character: null
			},
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:narrate-retrieval",
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)) as any
}

const node = (receipt: any, key: string) =>
	receipt.nodes.find((n: any) => n.nodeKey === key)

/**
 * `source:id`, not the entry's title.
 *
 * A candidate the vector mechanism produced carries no `name` — the host's
 * `toCandidate` builds it from the index row, which has the content and the id
 * and not the title — so an assertion on names would silently never match a
 * semantic hit and would read as the mechanism being off.
 */
const rankedKeys = (receipt: any): string[] =>
	((node(receipt, "rank")?.output as any)?.candidates ?? []).map(
		(c: any) => `${c.source}:${c.id}`
	)

const SPECS: Array<[string, () => any]> = [
	["core:spec/narrate", narrateSpec],
	["core:spec/narrate-character", narrateCharacterSpec]
]

describe.each(SPECS)("%s — the semantic control moves retrieval", (_, spec) => {
	it("retrieves nothing extra while the mechanism is at its shipped default", async () => {
		const keys = rankedKeys(await narrationTurn(spec))
		expect(
			keys,
			"the keyword scan did not run, so this fixture measures nothing"
		).toContain(`worldLore:${keyedId}`)
		// Not searched on the shipped setting here — `query-windows.
		// searchByMeaning` is Automatic (the switch, on the chain's first node
		// since 2026-09-29), which searches only when an embedding model is
		// set up, and this world stars none — so an install without one
		// retrieves exactly what it retrieved before.
		expect(keys).not.toContain(`worldLore:${meaningOnlyId}`)
	}, 60_000)

	it("brings in an entry only meaning can reach once it is turned on", async () => {
		const receipt = await narrationTurn(spec, [
			{ nodeKey: "semantic.arm.queries", path: "searchByMeaning", value: "on" },
			{ nodeKey: "semantic.arm.search", path: "maxEntries", value: 10 }
		])
		// The mechanism must have RUN, not merely produced nothing — a timed
		// out or unbound node is indistinguishable from a mechanism that is
		// switched off, and that ambiguity is what this file exists to remove.
		const search = node(receipt, "semantic.arm.search")
		expect(search, "the semantic mechanism is not in this document").toBeTruthy()
		expect(search!.result, `search: ${search!.reason ?? ""}`).toBe("ok")

		const keys = rankedKeys(receipt)
		expect(
			keys,
			"turning the semantic mechanism on changed nothing the narrator retrieves — " +
				"either the mechanism is not in this document or its `params` " +
				"slot is not wired, and from outside those look identical"
		).toContain(`worldLore:${meaningOnlyId}`)
		// Additive, never a rerouting: what the keys found is still there.
		expect(keys).toContain(`worldLore:${keyedId}`)
	}, 60_000)
})

describe.each(SPECS)("%s — every mechanism is present", (_, spec) => {
	it("carries all five, and ranks the linked pool", async () => {
		const receipt = await narrationTurn(spec)
		for (const key of [
			"lore",
			"entities",
			"semantic.arm.queries",
			"semantic.arm.embed",
			"semantic.arm.search",
			"pool",
			"names.arm.mentions",
			"names.arm.embed",
			"names.arm.link",
			"poolLinked",
			"rank"
		])
			expect(node(receipt, key), `${key} is not in this document`).toBeTruthy()

		// ⚠ `rank` reads the concatenation, not one lane. Wiring it to a subset
		// drops the rest silently — the prompt simply has no lore from that
		// mechanism in it, and nothing anywhere says so.
		const ranked = node(receipt, "rank")!
		expect((ranked.output as any).decisions.length).toBeGreaterThan(0)
	}, 60_000)
})

describe("the retrieval controls are all wired, not just the ones with a test", () => {
	/**
	 * The structural half, and the reason it is here rather than left to the
	 * measurement above.
	 *
	 * `resolveInput` resolves only the slots a node's config already names, so a
	 * node that declares parameters and does not wire `params` hands them over
	 * as `undefined` — while the panel renders them, validates them and stores
	 * them. That regression has shipped **three times** in this repo (respond
	 * 1.16.0, narrate 1.10.0, and the lore lanes again in 1.8.0), each time
	 * caught by a person rather than a test, because nothing about an unread
	 * parameter fails.
	 *
	 * A measurement can only cover the parameters somebody wrote a fixture for.
	 * This covers every one of them, on both narration documents, by comparing
	 * the document against the type declarations it pins.
	 */
	it.each(SPECS)("%s wires `params` wherever the reply pipeline does", async (slug, spec) => {
		/**
		 * ⚠ **Measured against `respond`, not against the type declarations.**
		 *
		 * A few node types declare a `params` slot that no shipped spec wires —
		 * `session-history`'s channel, `generate-text`'s — because the value
		 * comes from elsewhere on those paths, and flagging them would make
		 * this a test of an unrelated open question. The instruction the
		 * narration specs were built to is "wire retrieval the way `respond`
		 * does", so `respond` is the reference: for every node **type** the
		 * reply pipeline names `params` on, a narration document holding a node
		 * of that type must name it too.
		 *
		 * Self-updating by construction — a future lane added to `respond` with
		 * its slot wired makes this demand the same of narration, which is the
		 * half that keeps getting forgotten.
		 */
		const { respondSpec } = await import(
			"$lib/server/pipelines/specs/respond"
		)
		const reference = new Set<string>(
			(respondSpec().nodes ?? [])
				.filter((n: any) => (n.config ?? {}).params)
				.map((n: any) => String(n.definitionId))
		)
		expect(reference.size, "the reference set is empty").toBeGreaterThan(3)

		const missing = (spec().nodes ?? [])
			.filter(
				(n: any) =>
					reference.has(String(n.definitionId)) && !(n.config ?? {}).params
			)
			.map((n: any) => `${n.key} (${n.definitionId})`)

		expect(
			missing,
			`${slug} declares retrieval parameters on nodes that never read ` +
				`them: ${missing.join(", ")}`
		).toEqual([])
	}, 60_000)
})
