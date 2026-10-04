/**
 * The entity-vector mechanism, over the **shipped** reply pipeline.
 *
 * Retrieval plan phase 4. Two properties are asserted here and neither can be
 * asserted anywhere else, because both are properties of the *wiring* rather
 * than of any one function:
 *
 *  1. **The plan's second governing rule**, in all three states availability can
 *     take — never had an embedding model, has one, lost one mid-session. It is
 *     stated as an absolute because it has shipped broken twice in this project,
 *     in both directions, and the most recent one was found live: `eligibleFor`
 *     made a `rag` entry keyword-**ineligible** the moment a model loaded, so
 *     loading a model emptied lore out of every prompt — and three tests
 *     asserted that as correct.
 *  2. **A link ranks; it never admits.** The mechanism may only attach a signal to a
 *     candidate some other mechanism already produced, because a confident wrong
 *     link is worse than a miss: it would inject wrong lore at high confidence
 *     into a fixed budget, where it displaces right lore.
 *
 * ⚠ **The parity corpus cannot cover any of this**, and not only because
 * `pipelinePreview` runs `parityPipeline()`, which has no `names` block. The
 * corpus is blind to lore *ranking* entirely — measured: zeroing every lore
 * signal weight leaves all eleven gate fixtures byte-identical — so a green gate
 * says nothing about a signal that reorders lore. These run `respondSpec()`
 * itself, and every claim below is perturbed before it is banked: the mechanism is run
 * on and off over the same session and the two results compared.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { respondSpec } from "$lib/server/pipelines/specs/respond"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"

/** Flipped per case — the whole subject of the first half of this file. */
let modelReady = false

/**
 * A toy encoder: two orthogonal axes, addressed by the exact strings this
 * fixture uses.
 *
 * Orthogonal, so an unrelated pair scores exactly 0 and *"the mechanism did not link
 * this"* is an assertion rather than a threshold. Addressed by whole strings
 * rather than by shared tokens, and that is not fussiness — a token-based toy
 * would make the fixture agree with the *keyword* mechanism, and the one thing this
 * mechanism exists to do is find a reference that shares no token with its target.
 */
const AXIS: Record<string, number[]> = {
	// The description the scene uses, and the name it means.
	"the order rides": [1, 0],
	"the ashguard riders": [1, 0],
	// Same axis, and deliberately out of reach: no key admits it.
	"the silent company": [1, 0],
	// The other axis entirely.
	"the iron gate": [0, 1]
}
function vectorFor(text: string): number[] {
	return AXIS[text.toLowerCase().replace(/\s+/g, " ").trim()] ?? [0, 0]
}

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => modelReady,
	getLoadedModelId: () => (modelReady ? "test-embed-model" : null),
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor)
}))

/**
 * The semantic mechanism shares `embed-text` with this one and is off by default.
 * Stubbed so its own host read cannot reach a real `ragContext` — this file is
 * about the *other* vector space.
 */
vi.mock("$lib/server/embedding/ragContext", () => ({
	getSessionRagContext: async () => ({ lorebookId: 1 }),
	fetchScopedCandidates: async () => ({ candidates: [], truncated: [] }),
	rankScopedCandidates: () => []
}))

let db: TestDb
let sessionId: number
let userId: number
/** Keyed, and the one the description points at. */
let ridersId: number
/** Keyed, and describes something else entirely. */
let gateId: number
/** Links perfectly and **no key reaches it**. The admission test's subject. */
let unkeyedOrderId: number

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "entity-vectors", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Called by a description", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	/**
	 * ⚠ **Nothing on these rows can route them to a mechanism or away from one.**
	 *
	 * They are the entries a lorebook nobody has configured is made of, which is
	 * the population the historical failure emptied. Nothing could do that
	 * routing any more: `retrievalMode` was culled by migration 0203 and the
	 * per-entry `retrieval_strategy` column by 0204.
	 */
	const world = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: lorebook.id,
					name: "The Ashguard Riders",
					keys: "ashguard",
					content: "An order of oathbound riders."
				},
				{
					lorebookId: lorebook.id,
					name: "The Iron Gate",
					keys: "ashguard",
					content: "A gate of black iron."
				},
				// Reachable by no key in this conversation, and a *perfect*
				// match for the description. If a link could admit, this is the
				// entry that would arrive from nowhere.
				{
					lorebookId: lorebook.id,
					name: "The Silent Company",
					keys: "wastes",
					content: "They keep no rolls."
				}
			])
		)
		.returning()
	ridersId = world[0]!.id
	gateId = world[1]!.id
	unkeyedOrderId = world[2]!.id

	/**
	 * *"the ashguard"* is an authored name — `ashguard` is a distinctive token
	 * of the title — so the exact matcher claims it and the mention detector
	 * declines it. *"the order rides"* names nothing the world knows, shares no
	 * token with **The Ashguard Riders**, and is therefore the reference no
	 * other mechanism in the pipeline can see.
	 */
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "The ashguard is near. I hear the order rides at dawn."
	} as any)
}, 60_000)

/**
 * One turn of the **shipped** reply spec, stopped before the provider.
 *
 * `overrides` reach the nodes through the `params` slots the document already
 * wires, at `defaults` scope — the same route `semanticArm.int.test.ts` uses.
 */
const turn = async (
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

	return (await run(respondSpec(), {
		world,
		input: {
			text: "I hear the order rides at dawn.",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:entity-vectors",
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)) as any
}

/** The mechanism's one switch, raised. Nothing else is touched. */
const MECHANISM_ON = [
	{ nodeKey: "names.arm.mentions", path: "maxMentions", value: 4 }
]
/**
 * The same switch at 0. Off is no longer the shipped default — retrieval is
 * on by default (R5, lorebooks A23(b), 2026-10-02: `maxMentions` ships at
 * 8) — so the "off" cases below set it, and nothing else.
 */
const MECHANISM_OFF = [
	{ nodeKey: "names.arm.mentions", path: "maxMentions", value: 0 }
]

const node = (receipt: any, key: string) =>
	receipt.nodes.find((n: any) => n.nodeKey === key)

const ranked = (receipt: any): any[] =>
	(node(receipt, "rank")?.output as any)?.candidates ?? []

const rankedKeys = (receipt: any): string[] =>
	ranked(receipt).map((c: any) => `${c.source}:${c.id}`)

const candidate = (receipt: any, id: number) =>
	ranked(receipt).find((c: any) => c.id === id)

/** Every node that ended in `err` and was not absorbed as an empty result. */
const failed = (receipt: any): string[] =>
	receipt.nodes
		.filter((n: any) => n.result === "err" && !n.recoveredAsEmpty)
		.map((n: any) => `${n.nodeKey}: ${n.reason ?? "err"}`)

/**
 * How far the turn got, as the two facts that matter.
 *
 * ⚠ Not `receipt.preview`: this database has no context template selected, so
 * `prompt` halts on every run in this file for a reason unrelated to
 * embeddings. What the governing rule claims is narrower and checkable —
 * nothing in the retrieval path failed, and nothing in it stopped the run.
 */
const retrievalOutcome = (receipt: any) => {
	const upTo = receipt.nodes.slice(
		0,
		receipt.nodes.findIndex((n: any) => n.nodeKey === "rank") + 1
	)
	return {
		failed: failed(receipt),
		haltedInRetrieval: upTo
			.filter((n: any) => n.result === "halt")
			.map((n: any) => n.nodeKey),
		reachedRank: upTo.some((n: any) => n.nodeKey === "rank")
	}
}

const CLEAN = { failed: [], haltedInRetrieval: [], reachedRank: true }

describe("0 switches the mechanism off, and off costs nothing", () => {
	it("ships on: the shipped spec reads descriptions at its declared default", async () => {
		modelReady = true
		const receipt = await turn()
		expect(retrievalOutcome(receipt)).toEqual(CLEAN)
		const mentions = node(receipt, "names.arm.mentions")
		expect(mentions!.result).toBe("ok")
		expect((mentions!.output as any)?.texts ?? []).not.toEqual([])
	}, 30_000)

	it("reads nothing and embeds nothing at 0", async () => {
		modelReady = true
		const receipt = await turn(MECHANISM_OFF)
		expect(retrievalOutcome(receipt)).toEqual(CLEAN)

		const mentions = node(receipt, "names.arm.mentions")
		expect(
			mentions,
			"the mechanism is not in the shipped spec"
		).toBeTruthy()
		expect(mentions!.result).toBe("ok")
		expect((mentions!.output as any)?.texts ?? []).toEqual([])

		// ⚠ The cost claim, and the reason the switch is on the *first* node
		// rather than the last: with no texts the Provider makes no model call.
		const embed = node(receipt, "names.arm.embed")
		expect(embed!.result).toBe("ok")
		expect((embed!.output as any)?.vectors ?? []).toEqual([])

		const link = node(receipt, "names.arm.link")
		expect(link!.result).toBe("ok")
		expect((link!.output as any)?.main ?? []).toEqual([])
	}, 30_000)

	it("leaves the ranker exactly the candidates it had", async () => {
		// The `loreLinked` concatenation's fallback source, asserted rather than
		// assumed: an empty mechanism must not cost a candidate.
		modelReady = true
		const off = await turn(MECHANISM_OFF)
		expect(rankedKeys(off).length).toBeGreaterThan(0)
		for (const c of ranked(off))
			expect(c.signals?.entityVector).toBeUndefined()
	}, 30_000)
})

describe("no embedding model — the mechanism subtracts a signal and nothing else", () => {
	it("completes the turn with the mechanism switched on", async () => {
		modelReady = false
		const receipt = await turn(MECHANISM_ON)

		// A halt is the defect. `preview: true` stops the run at the provider on
		// purpose, so reaching the preview *is* completing the turn.
		expect(retrievalOutcome(receipt)).toEqual(CLEAN)

		// The detector still ran — it needs no model — so the honest report is
		// "found the descriptions, could not embed them".
		const mentions = node(receipt, "names.arm.mentions")
		expect((mentions!.output as any)?.texts ?? []).toContain(
			"the order rides"
		)

		// `embed-text` throws with no model loaded, which is the right answer to
		// a caller and the wrong thing to let end a turn. `auto` reads it as an
		// absence and the node is `optional` besides.
		const embed = node(receipt, "names.arm.embed")
		expect(embed!.result).toBe("ok")
		expect((embed!.output as any)?.vectors ?? []).toEqual([])

		const link = node(receipt, "names.arm.link")
		expect(link!.result).toBe("ok")
		expect((link!.output as any)?.main ?? []).toEqual([])
		expect((link!.output as any)?.diagnostics?.entityLink).toBeTruthy()

		// Every other mechanism behaved: the lore lanes still reached the ranker.
		expect(rankedKeys(receipt)).toContain(`worldLore:${ridersId}`)
		expect(rankedKeys(receipt)).toContain(`worldLore:${gateId}`)
	}, 30_000)

	it("gives the ranker the same candidates it gives with the mechanism off", async () => {
		modelReady = false
		const withMechanism = new Set(rankedKeys(await turn(MECHANISM_ON)))
		const without = new Set(rankedKeys(await turn(MECHANISM_OFF)))
		expect([...withMechanism].sort()).toEqual([...without].sort())
	}, 30_000)
})

describe("a model appears — matches are only added", () => {
	it("keeps every candidate, and links the description to the name", async () => {
		modelReady = false
		const before = new Set(rankedKeys(await turn(MECHANISM_ON)))
		expect(before.size).toBeGreaterThan(0)

		modelReady = true
		const receipt = await turn(MECHANISM_ON)
		expect(retrievalOutcome(receipt)).toEqual(CLEAN)

		// ⚠ A set relation, not a list: the claim is *nothing disappears*, and a
		// list would also fail on something appearing.
		for (const key of before)
			expect(rankedKeys(receipt), `${key} was lost`).toContain(key)

		// The link itself — the thing no other mechanism in the pipeline can do.
		expect(candidate(receipt, ridersId)?.signals?.entityVector).toBeCloseTo(
			1,
			5
		)
	}, 30_000)

	it("does not link a description to an entry it does not describe", async () => {
		modelReady = true
		const receipt = await turn(MECHANISM_ON)
		expect(
			candidate(receipt, gateId)?.signals?.entityVector
		).toBeUndefined()
	}, 30_000)

	it("⚠ never admits an entry no other mechanism found", async () => {
		// The whole safety argument. "The Silent Company" is a *perfect* match for
		// the description and no key in this conversation reaches it, so if a
		// link could admit it would be here — arriving from nowhere, at high
		// confidence, displacing something that earned its place.
		modelReady = true
		const receipt = await turn(MECHANISM_ON)
		expect(rankedKeys(receipt)).not.toContain(`worldLore:${unkeyedOrderId}`)

		// And the mechanism never even asked about it: the pool is the candidate list.
		const link = node(receipt, "names.arm.link")
		expect(
			((link!.output as any)?.links ?? []).map((l: any) => l.id)
		).not.toContain(unkeyedOrderId)
	}, 30_000)

	it("does not outrank an exact name match", async () => {
		// Exact and trigram matching own invented names; entity vectors own
		// descriptive references. `signalNameMatch` is 0.25 and
		// `signalEntityVector` is 0.2, so a link at full similarity still counts
		// for less than a title that literally occurred.
		const { DEFAULT_SIGNAL_WEIGHTS } = await import(
			"$lib/server/pipelines/ranking/weights"
		)
		expect(DEFAULT_SIGNAL_WEIGHTS.worldLore.entityVector).toBeLessThan(
			DEFAULT_SIGNAL_WEIGHTS.worldLore.nameMatch
		)
	})
})

describe("a model lost mid-session — it degrades identically", () => {
	it("loses the signal and keeps every candidate", async () => {
		modelReady = true
		const withModel = await turn(MECHANISM_ON)
		expect(
			candidate(withModel, ridersId)?.signals?.entityVector
		).toBeCloseTo(1, 5)

		modelReady = false
		const lost = await turn(MECHANISM_ON)
		expect(retrievalOutcome(lost)).toEqual(CLEAN)
		expect(candidate(lost, ridersId)?.signals?.entityVector).toBeUndefined()
		for (const key of rankedKeys(withModel))
			expect(rankedKeys(lost), `${key} was lost`).toContain(key)
	}, 30_000)
})

describe("one switch, and a receipt somebody can read", () => {
	it("raising the cap alone changes the score", async () => {
		// The precedent this follows and the trap it avoids: a feature whose cap
		// and whose weight both ship at zero is one where raising the cap
		// appears to do nothing. `maxMentions` is the only control touched here.
		modelReady = true
		const off = await turn(MECHANISM_OFF)
		const on = await turn(MECHANISM_ON)
		const scoreOf = (r: any, id: number) =>
			((node(r, "rank")?.output as any)?.decisions ?? []).find(
				(d: any) => d.candidate?.id === id
			)?.score
		expect(scoreOf(on, ridersId)).toBeGreaterThan(scoreOf(off, ridersId))
	}, 30_000)

	it("says which description reached which name", async () => {
		// A keyword hit explains itself; a vector link does not — the entry
		// simply appears higher. So the link is text on the receipt, and a wrong
		// one is visible and correctable rather than lore arriving for no
		// reason.
		modelReady = true
		const receipt = await turn(MECHANISM_ON)
		const link = node(receipt, "names.arm.link")
		expect((link!.output as any)?.diagnostics?.matched).toContain(
			"matched “the order rides” → The Ashguard Riders"
		)
		expect(candidate(receipt, ridersId)?.payload?.entityLinks).toContain(
			"matched “the order rides” → The Ashguard Riders"
		)
	}, 30_000)
})

describe("the index invalidates on its own terms", () => {
	it("re-embeds a renamed entry and not an edited body", async () => {
		modelReady = true
		const { ensureEntityVectors } = await import(
			"$lib/server/embedding/entityVectors"
		)
		const args = {
			lorebookId: (
				await db
					.select({ lorebookId: schema.sessions.lorebookId })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, sessionId))
			)[0]!.lorebookId,
			entryIds: [ridersId],
			gazetteerHash: "vocab-1",
			modelId: "test-embed-model",
			batchEmbed: async (texts: string[]) => texts.map(vectorFor)
		}

		// First pass indexes it.
		expect((await ensureEntityVectors(db, args)).written).toBe(1)
		// Second pass finds it fresh and writes nothing.
		expect((await ensureEntityVectors(db, args)).written).toBe(0)

		// ⚠ **Rewriting the body does not re-embed the names.** This is the
		// property the whole separate space exists for, and it cannot be
		// asserted anywhere the two spaces share a staleness signal.
		await db
			.update(schema.lorebookEntries)
			.set({ content: "They ride the passes in winter." })
			.where(eq(schema.lorebookEntries.id, ridersId))
		expect((await ensureEntityVectors(db, args)).written).toBe(0)

		// Renaming does.
		await db
			.update(schema.lorebookEntries)
			.set({ title: "The Ashguard" })
			.where(eq(schema.lorebookEntries.id, ridersId))
		expect((await ensureEntityVectors(db, args)).written).toBe(1)

		// ⚠ And so does the **vocabulary** moving under unchanged text — the
		// third identity, which has no analogue in the content-vector case.
		expect(
			(
				await ensureEntityVectors(db, {
					...args,
					gazetteerHash: "vocab-2"
				})
			).written
		).toBe(1)
	}, 60_000)
})
