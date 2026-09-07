/**
 * The entity-vector mechanism, on a corpus that can actually see it.
 *
 * ## The blind spot this closes
 *
 * `semanticCorpus.int.test.ts` closes design §10.1's second finding for the
 * *content* vector space. This is the same argument for the **second** one: the
 * mechanism that matches a description the scene used — *"the ember burning"* — to
 * what an entry is **called**.
 *
 * Neither existing corpus can observe it. The parity gate runs
 * `parityPipeline()`, which has no `names` block at all, and is blind to lore
 * ranking outright — zeroing every lore signal weight leaves all eleven gate
 * fixtures byte-identical. And `runtime/entityVectorArm.int.test.ts`, which
 * asserts the governing rule and the never-admits guarantee, uses an
 * **orthogonal lookup** embedding on purpose: it needs "linked" and "did not
 * link" to be exactly 1 and exactly 0 so that *presence* is an assertion rather
 * than a threshold. That is the right instrument for its question and the wrong
 * one for this one, because it cannot show an **ordering**.
 *
 * So this file supplies the missing half: a graded embedding over *names*, an
 * authored order deliberately opposite to the description order, and the
 * perturbation that proves the fixture is not blind — turning the mechanism on
 * **reverses** what reaches the model, and zeroing either control that governs
 * it puts the order back.
 *
 * ## What discriminates here is the **name**, not the body
 *
 * That is the whole difference from the semantic corpus one file over. There,
 * the entry's *content* is embedded and compared to the conversation. Here each
 * entry contributes one short vector per name it answers to, and the query is a
 * two- or three-word description. Short string against short string — which is
 * the comparison this space exists to make, and the one a whole-entry vector
 * cannot: a two-word mention against two hundred words drowns in the average.
 *
 * ⚠ **No description in the window shares a token with any title**, which is
 * not decoration — it is the mechanism's entire subject. A description that shared a
 * token would be claimed by the gazetteer and dropped before it ever reached
 * the linker, because exact and trigram matching own invented names and entity
 * vectors own descriptive references. A fixture that let one through would be
 * measuring the keyword mechanism and calling it this one.
 *
 * ## What is faked, and only what is faked
 *
 * The embedding model. Everything else is the real thing: real rows, the real
 * host, the real name index written to `lorebook_entry_vectors`, the real
 * bindings, the shipped `respond` document.
 *
 * ⚠ The run halts at `prompt` — this database has no context template selected
 * — so the assertions read the **ranker's** output, exactly as
 * `semanticCorpus.int.test.ts` and `respondLanes.int.test.ts` do. That is
 * upstream of the halt and is where "what reached the model, in what order" is
 * decided.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { respondSpec } from "$lib/server/pipelines/specs/respond"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { PRESETS } from "$lib/server/pipelines/measure/promptDiff"

/**
 * A toy embedding with three axes and **graded** membership.
 *
 * The same construction `semanticCorpus.int.test.ts` uses, and borrowed rather
 * than re-argued: counting occurrences and normalising to unit length gives
 * each text its own direction, so a dot product is a real number rather than
 * the coin flip a binary axis produces.
 *
 * The term lists are chosen so the three **titles** land in three different
 * places while sharing no token with anything the conversation says. Axis 0 is
 * "about light", axis 1 "about water", axis 2 "about stone".
 */
const AXES: ReadonlyArray<readonly string[]> = [
	["lamp", "wright", "ember", "torch", "glow"],
	["hold", "sluice", "tide", "current", "wash"],
	["stone", "fast", "cairn", "slab", "grit"]
]

function vectorFor(text: string): number[] {
	const lower = text.toLowerCase()
	const raw = AXES.map((terms) =>
		terms.reduce((sum, term) => sum + (lower.split(term).length - 1), 0)
	)
	const length = Math.hypot(...raw)
	// A text about none of the three gets the zero vector, whose cosine against
	// anything is 0 rather than an accidental 1 — the failure mode this whole
	// family of files is about, in miniature.
	return length === 0 ? [0, 0, 0] : raw.map((v) => v / length)
}

/**
 * Always loaded here.
 *
 * What happens when it is *not* — the plan's second governing rule, that an
 * unavailable mechanism subtracts a signal and never disables a path — is
 * `runtime/entityVectorArm.int.test.ts`'s subject in all three availability
 * states, and is not re-asserted. This file is about ordering, which needs the
 * mechanism running to have any.
 */
const MODEL_READY = true

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => MODEL_READY,
	getLoadedModelId: () => (MODEL_READY ? "test-graded-embed" : null),
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor)
}))

/**
 * The *content* vector mechanism ships off, so its host read is never reached — but
 * it shares `embed-text` with this one, and a stub costs nothing next to
 * leaving a real `ragContext` reachable from a file that is not about it.
 */
vi.mock("$lib/server/embedding/ragContext", () => ({
	getSessionRagContext: async () => ({ lorebookId: 1 }),
	fetchScopedCandidates: async () => ({ candidates: [], truncated: [] }),
	rankScopedCandidates: () => []
}))

let db: TestDb
let sessionId: number
let userId: number

/**
 * Three entries, authored in the **reverse** of the order their names put them
 * in.
 *
 * Every one of the keyword mechanism's signals is equal across the three *by
 * construction*, which is what leaves the description link as the only thing
 * that can separate them. The construction is `semanticCorpus.int.test.ts`'s,
 * because the tie it needs is the same tie:
 *
 *   · **the same single key**, which the window says, so `keyword` is 1 for all
 *     three and `proximity` is 0 for all three;
 *   · **one-token titles that appear in no message**, so `nameMatch` is 0 — and
 *     `tfidfSignal` scores `keys + name`, the author's index rather than the
 *     body, so an identical key plus a one-token absent title ties too;
 *   · **no cast, and nothing capitalised anywhere in the window**, so the
 *     entity profile is empty and `entityCooccurrence` is 0 for all three;
 *   · **the same key**, so all three were last referred to in the same message
 *     and `lastRefRecency` is equal.
 *
 * With the mechanism off they tie *exactly*, and `select` falls through to authored
 * position — the order written here.
 *
 * The names disagree, and disagree completely. The window describes *the ember
 * burning* and *the torch glow*, which are pure light; `Lampwright` is pure
 * light, `Lamphold` is half light and half water, and `Stonefast` is pure stone
 * and does not link at all. Both orders are asserted, which makes the mechanism's
 * effect a **reversal** rather than a rearrangement somebody has to squint at.
 */
const ENTRIES = [
	{
		name: "Stonefast",
		keys: "camp",
		content: "A keep above the pass, and the road that climbs to it."
	},
	{
		name: "Lamphold",
		keys: "camp",
		content: "A wharf town, half in the shallows, that trades after dark."
	},
	{
		name: "Lampwright",
		keys: "camp",
		content: "A guild that keeps the road lit from the pass to the gate."
	}
] as const

/** Set in `beforeAll`; the ids the assertions name. */
let stoneId: number
let mixedId: number
let lightId: number

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "entity-vector-corpus", isAdmin: false })
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

	// ⚠ Nothing on these rows can route them to a mechanism or away from one, and
	// that is now true of every row: the node's `retrievalMode` was culled by
	// migration 0203 and the per-entry `retrieval_strategy` column by 0204.
	// Every mechanism sees all of them — which is what this corpus measures.
	const rows = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues(
				ENTRIES.map((e) => ({ lorebookId: lorebook.id, ...e }))
			)
		)
		.returning()
	stoneId = rows[0]!.id
	mixedId = rows[1]!.id
	lightId = rows[2]!.id

	// ⚠ Lower case throughout, and no title anywhere in it. Both are
	// load-bearing and for two different reasons: a capitalised run would enter
	// the entity profile through the open tier and break the baseline tie
	// silently, and a title would be claimed by the gazetteer — which is
	// exactly what the mention detector refuses to hand the linker, so the
	// fixture would be measuring nothing.
	for (const content of [
		"we came down out of the pass before dark, all four of us",
		"the road was bad and the mule threw a shoe twice on the way",
		"so we made camp and waited for the morning to come round",
		"someone had left the ember burning by the door",
		"we should carry the torch glow to the gate"
	])
		await db.insert(schema.sessionMessages).values({
			sessionId,
			role: "user",
			content
		} as any)
}, 60_000)

/** One turn of the shipped reply spec, stopped before the provider. */
const turn = async (
	overrides: Array<{ nodeKey: string; path: string; value: unknown }> = []
) => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db as any, { sessionId })
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
			text: "we should carry the torch glow to the gate",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:entity-vector-corpus",
		bindings: coreBindings(),
		host: createHost(db as any, { sessionId, userId }),
		preview: true
	} as any)) as any
}

const node = (receipt: any, key: string) =>
	receipt.nodes.find((n: any) => n.nodeKey === key)

/** The ranker's own ordering — what reached the prompt, and in what order. */
const rankedIds = (receipt: any): number[] =>
	((node(receipt, "rank")?.output as any)?.candidates ?? [])
		.filter((c: any) => c.source === "worldLore")
		.map((c: any) => c.id as number)

const linkOf = (receipt: any): Record<number, number> =>
	Object.fromEntries(
		((node(receipt, "rank")?.output as any)?.candidates ?? [])
			.filter((c: any) => c.source === "worldLore")
			.map((c: any) => [
				c.id as number,
				(c.signals?.entityVector ?? 0) as number
			])
	)

/**
 * The mechanism is off by default; this is what turning it on looks like.
 *
 * **One control.** `maxLinks` is a ceiling that already ships non-zero and
 * `signalEntityVector` already ships at 0.2, so raising `maxMentions` is the
 * whole of switching the mechanism on — which is itself the thing being asserted in
 * the last case below.
 */
const MECHANISM_ON = [
	{ nodeKey: "names.arm.mentions", path: "maxMentions", value: 4 }
]

describe("the mechanism ships off, and off means invisible", () => {
	it("ranks by authored order when nothing has linked", async () => {
		const receipt = await turn()
		// The shipped `maxMentions` is 0, so nothing is read, nothing is
		// embedded, and every entry arrives with the keyword mechanism's signals
		// only. All three tie, so this is authored position.
		expect(rankedIds(receipt)).toEqual([stoneId, mixedId, lightId])
		expect(Object.values(linkOf(receipt)).every((v) => v === 0)).toBe(true)
	}, 60_000)
})

describe("the corpus can see the entity-vector mechanism at all", () => {
	/**
	 * ⚠ **The assertion that makes this fixture worth having.** A pool of
	 * identical similarities is the failure design §10.1 records against the
	 * RAG corpus; the sibling `entityVectorArm.int.test.ts` deliberately has
	 * exactly that shape because presence is its subject. This one has to hand
	 * back *different* numbers or nothing downstream of it can be observed,
	 * however the weights are set.
	 */
	it("grades the links rather than flagging them", async () => {
		const links = linkOf(await turn(MECHANISM_ON))

		// Pure light beats half-light, and pure stone does not link at all —
		// three distinct outcomes from one description.
		expect(links[lightId]).toBeGreaterThan(links[mixedId]!)
		expect(links[mixedId]).toBeGreaterThan(0)
		expect(links[stoneId]).toBe(0)
	}, 60_000)

	it("reverses what reaches the prompt when the mechanism is turned on", async () => {
		const off = rankedIds(await turn())
		const on = rankedIds(await turn(MECHANISM_ON))

		expect(off).toEqual([stoneId, mixedId, lightId])
		expect(on).toEqual([lightId, mixedId, stoneId])

		// The governing rule, on the way past: adding a mechanism may only add
		// matches. Same three entries, different order.
		expect([...on].sort()).toEqual([...off].sort())
	}, 60_000)

	/**
	 * The mechanism strength, which every parity fixture is blind to at every
	 * value — and which no keyword fixture can reach for this signal, because
	 * no keyword fixture produces an `entityVector` to scale.
	 */
	it("returns to the mechanism-off order when the name strength is zero", async () => {
		const off = rankedIds(await turn())
		const zeroed = await turn([
			...MECHANISM_ON,
			{
				nodeKey: "rank",
				path: "mechanismWeights",
				value: { keyword: 1, semantic: 1, name: 0 }
			}
		])

		// The mechanism still ran and the links still arrived — this is the strength
		// doing its job, not the mechanism being switched off, and the two would look
		// identical from the order alone.
		expect(linkOf(zeroed)[lightId]).toBeGreaterThan(0)
		expect(rankedIds(zeroed)).toEqual(off)
	}, 60_000)

	it("moves the prompt when the entity-vector signal weight moves", async () => {
		const on = rankedIds(await turn(MECHANISM_ON))
		const zeroed = await turn([
			...MECHANISM_ON,
			{
				nodeKey: "rank",
				path: "signalEntityVector",
				value: {
					messages: 0,
					worldLore: 0,
					characterLore: 0,
					history: 0,
					relationships: 0
				}
			}
		])

		expect(rankedIds(zeroed)).not.toEqual(on)
	}, 60_000)
})

describe("the A/B preset points at the address that works", () => {
	/**
	 * ⚠ **A preset that merely exists is a dead knob**, and this codebase has
	 * shipped controls that rendered, validated, saved, resolved through every
	 * scope layer and were read by nothing. `promptDiff.int.test.ts` asserts
	 * that a preset named `descriptions` exists and is non-empty, which a
	 * typo'd node key would satisfy while quietly diffing a prompt against
	 * itself forever.
	 *
	 * So the preset is pinned to the override this file has just *proved*
	 * reverses the ranking. The behaviour proof is the cases above; this is the
	 * line that stops the operator-facing flag drifting off it.
	 */
	it("drives the same override this file proved reverses the order", () => {
		expect(PRESETS.descriptions!.overrides).toEqual(MECHANISM_ON)
	})
})

describe("what the mechanism is forbidden to do, on a corpus that would show it", () => {
	/**
	 * ⚠ A link **ranks**; it never admits. Asserted here as well as in
	 * `entityVectorArm.int.test.ts` because this is the fixture where an
	 * admission would be *visible as an ordering change* rather than only as a
	 * set difference — and because the constraint is the one that makes a
	 * confident wrong link cost a position instead of a block of wrong lore.
	 */
	it("brings in no entry the keyword mechanism did not already find", async () => {
		const off = new Set(rankedIds(await turn()))
		const on = rankedIds(await turn(MECHANISM_ON))
		for (const id of on) expect(off.has(id)).toBe(true)
	}, 60_000)

	/**
	 * The other half of the safety rule: the description the window uses must
	 * share no token with any title, or the gazetteer claims it and the exact
	 * matcher — which resolves to a row rather than guessing — owns it.
	 *
	 * Asserted on the detector's own diagnostics rather than by reasoning about
	 * the fixture's strings, so that editing a title into the window later
	 * fails here instead of quietly turning this file into a keyword test.
	 */
	it("linked on descriptions, not on names the window said", async () => {
		const receipt = await turn(MECHANISM_ON)
		const mentions = node(receipt, "names.arm.mentions")
		const texts: string[] = (mentions!.output as any)?.texts ?? []

		expect(texts).toContain("the ember burning")
		for (const entry of ENTRIES)
			for (const text of texts)
				expect(text.toLowerCase()).not.toContain(
					entry.name.toLowerCase()
				)
	}, 60_000)
})
