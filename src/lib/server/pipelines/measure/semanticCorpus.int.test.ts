/**
 * The semantic mechanism, on a corpus that can actually see it.
 *
 * ## The blind spot this closes
 *
 * Design §10.1, finding 2, measured rather than reasoned: **the RAG parity
 * corpus cannot see vector ordering at all.** Its toy embedding is binary — a
 * text either contains "ashguard" or it does not — so every candidate in every
 * RAG fixture arrives with a raw cosine of exactly **1**. `scoreOf` ties on all
 * of them, `select`'s sort is stable, and the semantic mechanism's stages therefore
 * survive on *array order* rather than on score. "RAG parity stayed green" is
 * not evidence about any semantic-mechanism change, and `runtime/semanticArm.int.test.ts`
 * — which asserts the governing rule that a mechanism may only add matches —
 * uses a one-axis binary embedding for the same reason and inherits the same
 * limit, correctly, because ordering is not its subject.
 *
 * So this file supplies the one thing neither of those has: **an embedding that
 * discriminates.** Three entries, three genuinely different cosines, and an
 * authored order deliberately opposite to the semantic one, so that turning the
 * mechanism on *reverses* what reaches the model and turning its mechanism strength
 * to zero puts it back.
 *
 * ## Why it runs the shipped spec rather than `select` directly
 *
 * The unit corpus (`rankingCorpus.test.ts`) drives `keywordQuery` →
 * `normaliseTfidf` → `select`, which is the whole of the keyword path. The
 * semantic mechanism is not reachable that way: the cosine is produced by a host read,
 * carried by `core:query/vector-search@1` as a **signal** rather than a
 * `presetScore`, merged into an existing candidate by
 * `core:task/concat-candidates@1`, and only then scored. Half of what is being
 * asserted here lives in that wiring, so a fixture that handed `select` a
 * `semantic` signal directly would be asserting that a weighted sum is a
 * weighted sum.
 *
 * ## What is faked, and only what is faked
 *
 * The embedding model and the vector index. Everything else is the real thing:
 * real rows, the real host, the real bindings, the shipped `respond` document.
 *
 * ⚠ The run halts at `prompt` — this database has no context template selected
 * — so the assertions read the **ranker's** output, exactly as
 * `respondLanes.int.test.ts` and `semanticArm.int.test.ts` do. That is upstream
 * of the halt and is where "what reached the model, in what order" is decided.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { respondSpec } from "$lib/server/pipelines/specs/respond"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"

/**
 * A toy embedding with three axes and **graded** membership.
 *
 * The whole point of the file is in the word *graded*. A binary axis makes
 * every text that mentions the subject identical, which is how the RAG corpus
 * ends up with a pool of cosines all equal to 1; counting occurrences and
 * normalising to unit length instead gives each text its own direction, so a
 * dot product is a real number between texts rather than a coin flip.
 *
 * Deterministic, dependency-free and readable by eye: axis 0 is "about light",
 * axis 1 is "about water", axis 2 is "about stone".
 */
const AXES: ReadonlyArray<readonly string[]> = [
	["lantern", "lamp", "light", "burning", "flame"],
	["water", "tide", "river", "flood"],
	["stone", "wall", "ruin", "mason"]
]

function vectorFor(text: string): number[] {
	const lower = text.toLowerCase()
	const raw = AXES.map((terms) =>
		terms.reduce((sum, term) => sum + (lower.split(term).length - 1), 0)
	)
	const length = Math.hypot(...raw)
	// A text about none of the three axes gets the zero vector, whose cosine
	// against anything is 0 rather than an accidental 1 — the failure mode this
	// whole file is about, in miniature.
	return length === 0 ? [0, 0, 0] : raw.map((v) => v / length)
}

const dot = (a: number[], b: number[]) =>
	a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)

/**
 * Always loaded here.
 *
 * What happens when it is *not* — the plan's second governing rule, that an
 * unavailable mechanism subtracts a signal and never disables a path — is
 * `runtime/semanticArm.int.test.ts`'s whole subject and is not re-asserted.
 * This file is about ordering, which needs the mechanism running to have any.
 */
const MODEL_READY = true

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => MODEL_READY,
	getLoadedModelId: () => (MODEL_READY ? "test-graded-embed" : null),
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor)
}))

/** Filled in `beforeAll` once the rows have ids. */
let poolRows: any[] = []

vi.mock("$lib/server/embedding/ragContext", () => ({
	getSessionRagContext: async () => ({ lorebookId: 1 }),
	fetchScopedCandidates: async () => ({
		candidates: poolRows,
		truncated: []
	}),
	rankScopedCandidates: (
		candidates: any[],
		query: number[],
		topK?: number
	) =>
		candidates
			.map((c) => ({ ...c, score: dot(c.embedding, query) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK ?? candidates.length)
}))

let db: TestDb
let sessionId: number
let userId: number

/**
 * Three entries, authored in the **reverse** of the order meaning puts them in.
 *
 * Every one of the keyword mechanism's signals is equal across the three *by
 * construction*, which is what makes the semantic mechanism the only thing that can
 * separate them:
 *
 *   · **the same single key**, which matches, so `keyword` is 1 for all three
 *     and `proximity` is 0 for all three;
 *   · **one-token titles that appear in no message**, so `nameMatch` is 0 and
 *     the titles contribute nothing to `tfidf` — leaving the shared key as the
 *     entire scored document, identical three times over;
 *   · **no cast and no capitalised run mid-sentence anywhere in the window**,
 *     so the entity profile is empty and `entityCooccurrence` is 0 for all
 *     three;
 *   · **the same key**, so all three were last referenced in the same message
 *     and `lastRefRecency` is equal too.
 *
 * With the mechanism off they therefore tie *exactly*, and `select` falls through to
 * authored position — the order they are written in here.
 *
 * Meaning disagrees, and disagrees completely: the last two messages are about
 * a lantern burning over the water, so the light entry is closest, the water
 * entry next, and the stone entry — which keeps one lamp at its gate, so its
 * cosine is small rather than zero — last. Both orders are asserted, which is
 * what makes the mechanism's effect a *reversal* rather than a rearrangement somebody
 * has to squint at.
 */
const ENTRIES = [
	{
		name: "Stonefast",
		keys: "lantern",
		content:
			"A ruin of stone, wall on wall, mason work, and one lamp left burning at the gate."
	},
	{
		name: "Sluicehold",
		keys: "lantern",
		content:
			"Iron doors that let the tide through, water on water, and the river past the flood."
	},
	{
		name: "Lampwright",
		keys: "lantern",
		content:
			"They keep the lamp and the flame, light on light, and every lantern burning."
	}
] as const

/** Set in `beforeAll`; the ids the assertions name. */
let stoneId: number
let waterId: number
let lightId: number

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "semantic-corpus", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Graded", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	// ⚠ Nothing on these rows can route them to a mechanism or away from one, so
	// both mechanisms see all three. That is now true of every row anywhere: the
	// node's `retrievalMode` was culled by migration 0203 and the per-entry
	// `retrieval_strategy` column by 0204.
	const rows = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues(
				ENTRIES.map((e) => ({ lorebookId: lorebook.id, ...e }))
			)
		)
		.returning()
	stoneId = rows[0]!.id
	waterId = rows[1]!.id
	lightId = rows[2]!.id

	poolRows = rows.map((row: any) => ({
		source: "worldLore",
		id: row.id,
		name: row.name,
		content: row.content,
		embedding: vectorFor(row.content),
		lorebookId: lorebook.id
	}))

	// ⚠ Lower case throughout except where a sentence starts, and no name from
	// the lorebook anywhere in it. Both are load-bearing: a capitalised run
	// mid-sentence would enter the entity profile through the open tier and a
	// title would enter it through the gazetteer, and either one would give the
	// three entries different `entityCooccurrence` scores — which would break
	// the tie this fixture's baseline is made of, silently, and leave the
	// reversal below looking like the mechanism's work when it was not.
	//
	// The query window is the last two messages (`currentWindow: 2`), which is
	// where the light and the water are.
	for (const content of [
		"we came down out of the pass before dark, all four of us",
		"the road was bad and the mule threw a shoe twice on the way",
		"so we made camp and waited for the morning to come round",
		"the lantern is burning out over the water",
		"we should light it again before the tide turns"
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
			text: "we should light it again before the tide turns",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:graded",
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId }),
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

const semanticOf = (receipt: any): Record<number, number> =>
	Object.fromEntries(
		((node(receipt, "rank")?.output as any)?.candidates ?? [])
			.filter((c: any) => c.source === "worldLore")
			.map((c: any) => [c.id as number, (c.signals?.semantic ?? 0) as number])
	)

/** The mechanism is off by default; this is what turning it on looks like. */
const MECHANISM_ON = [
	{ nodeKey: "semantic.arm.search", path: "maxEntries", value: 20 }
]

describe("the mechanism ships off, and off means invisible", () => {
	it("ranks by authored order when nothing has a cosine", async () => {
		const receipt = await turn()
		// The shipped cap is 0, so the mechanism returns nothing and every entry
		// arrives with the keyword mechanism's signals only. All three tie, so this
		// is authored position — the order they were written in.
		expect(rankedIds(receipt)).toEqual([stoneId, waterId, lightId])

		const semantic = semanticOf(receipt)
		expect(Object.values(semantic).every((v) => v === 0)).toBe(true)
	}, 60_000)
})

describe("the corpus can see the semantic mechanism at all", () => {
	/**
	 * ⚠ **This is the assertion design §10.1's second finding asks for.** The
	 * RAG corpus's toy embedding hands every candidate a cosine of exactly 1;
	 * this one has to hand them three different numbers or nothing downstream
	 * of it can be observed, however the weights are set.
	 */
	it("delivers three different cosines rather than three ties", async () => {
		const receipt = await turn(MECHANISM_ON)
		const semantic = semanticOf(receipt)

		expect(new Set(Object.values(semantic)).size).toBe(3)
		expect(semantic[lightId]).toBeGreaterThan(semantic[waterId]!)
		expect(semantic[waterId]).toBeGreaterThan(semantic[stoneId]!)
		// Cosines, not flags. A pool of 1s is exactly the failure being closed.
		expect(semantic[lightId]).toBeLessThan(1)
		expect(semantic[stoneId]).toBeGreaterThan(0)
	}, 60_000)

	it("reverses what reaches the prompt when the mechanism is turned on", async () => {
		const off = rankedIds(await turn())
		const on = rankedIds(await turn(MECHANISM_ON))

		expect(off).toEqual([stoneId, waterId, lightId])
		expect(on).toEqual([lightId, waterId, stoneId])

		// The governing rule, on the way past: adding a mechanism may only add
		// matches. Same three entries, different order.
		expect([...on].sort()).toEqual([...off].sort())
	}, 60_000)

	/**
	 * The mechanism strength, which all eleven parity fixtures are blind to at
	 * every value — including this one, which no keyword fixture can reach
	 * because no keyword fixture produces a `semantic` signal to scale.
	 */
	it("returns to the mechanism-off order when the semantic strength is zero", async () => {
		const off = rankedIds(await turn())
		const zeroed = await turn([
			...MECHANISM_ON,
			{
				nodeKey: "rank",
				path: "mechanismWeights",
				value: { keyword: 1, semantic: 0, name: 1 }
			}
		])

		// The mechanism still ran and the cosines still arrived — this is the
		// strength doing its job, not the mechanism being switched off, and the two
		// are different things that would look identical from the order alone.
		const semantic = semanticOf(zeroed)
		expect(new Set(Object.values(semantic)).size).toBe(3)
		expect(rankedIds(zeroed)).toEqual(off)
	}, 60_000)

	it("narrowing topK subtracts the signal and keeps the candidate", async () => {
		/**
		 * ⚠ **`topK` reached nothing at all until this fixture had a reason to
		 * exist.** The binding read `input?.topK` — an in-port name
		 * `core:query/vector-search@1` does not declare — and fell through to a
		 * literal `?? 40`, so the declared control resolved through the whole
		 * scope chain and was handed to no one. Proven the way it was found: set
		 * it to 1 and watch what the host returns.
		 *
		 * The second half is the governing rule, and it is why this is the
		 * *right* control to narrow: cutting the vector arm to a single hit
		 * leaves all three entries in the prompt, because the keyword scan found
		 * them and a mechanism that looked at fewer rows subtracts a signal
		 * rather than removing a candidate. A `minScore` floor is what could not
		 * have said that.
		 */
		const wide = await turn(MECHANISM_ON)
		const narrow = await turn([
			...MECHANISM_ON,
			{ nodeKey: "semantic.arm.search", path: "topK", value: 1 }
		])

		const semWide = semanticOf(wide)
		const semNarrow = semanticOf(narrow)

		// Two query vectors, so a top-1 list each. The stone entry is strictly
		// last against **both** windows — 0.33 and 0.26 — so it is the one that
		// can never survive a top-1 cut, whatever the two leaders do about their
		// tie on the second window.
		expect(Object.values(semWide).every((v) => v > 0)).toBe(true)
		expect(semNarrow[stoneId]).toBe(0)
		// The closest keeps exactly the cosine it had: a narrower list is fewer
		// rows, not a different measurement of the rows that survive.
		expect(semNarrow[lightId]).toBeCloseTo(semWide[lightId]!, 10)

		// And nothing left the pool. Same three entries, keyword-found, ranked
		// on what is left of their evidence.
		expect([...rankedIds(narrow)].sort()).toEqual(
			[...rankedIds(wide)].sort()
		)
	}, 60_000)

	it("moves the prompt when the semantic signal weight moves", async () => {
		const on = rankedIds(await turn(MECHANISM_ON))
		const zeroed = await turn([
			...MECHANISM_ON,
			{
				nodeKey: "rank",
				path: "signalSemantic",
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

/**
 * The attenuation curve, measured rather than argued.
 *
 * ## What it replaced, and why a number could not stay
 *
 * `core:query/vector-search@1` declared `minScore: 0.35` — *"ignore matches
 * whose similarity falls below this"* — and nothing anywhere read it. It could
 * not simply be wired: a floor takes a row **out of the pool**, and a row out of
 * the pool can no longer be found by keyword, by name or by proximity either, so
 * one mechanism's opinion would disable four others. The governing rule is that
 * a weak mechanism *subtracts a signal* and never removes a candidate.
 *
 * And a threshold is not portable. Cosine distributions are not comparable
 * across embedding models — one puts unrelated text near 0.1 and another near
 * 0.7 — so `0.35` means "almost everything" on the first and "almost nothing" on
 * the second, and an install that changes model silently changes what its
 * lorebook retrieves.
 *
 * What replaced it is a **shape**: `semantic = cos ** similarityFalloff`, fixed
 * at 0 and 1, strictly monotonic, defaulting to **1** — the raw cosine, which is
 * what every install has actually been running while the floor sat unread.
 *
 * ## What this file can and cannot say
 *
 * It measures the curve's *behaviour* on a graded embedder: that it preserves
 * the arm's own order at every setting, that no candidate ever leaves the pool,
 * and how much a vague match is allowed to weigh against a keyword that
 * actually fired. It cannot say where a real model's noise floor sits — that is
 * a property of the model, which is the whole reason the control is a shape and
 * not a number.
 */
describe("the similarity curve", () => {
	const falloff = (value: number) => [
		...MECHANISM_ON,
		{ nodeKey: "semantic.arm.search", path: "similarityFalloff", value }
	]

	/**
	 * The three cosines this corpus produces, before any shaping.
	 *
	 * Maxima over the **two** query windows `queryWindows` emits at
	 * `currentWindow: 2` — one vector per message, not one per window — which is
	 * why the middle entry sits higher than a single blended query would put it.
	 */
	const RAW = { light: 0.8944, water: 0.7071, stone: 0.3322 }

	it("ships at 1, which is the raw cosine and today's behaviour", async () => {
		const semantic = semanticOf(await turn(MECHANISM_ON))
		expect(semantic[lightId]).toBeCloseTo(RAW.light, 4)
		expect(semantic[waterId]).toBeCloseTo(RAW.water, 4)
		expect(semantic[stoneId]).toBeCloseTo(RAW.stone, 4)

		// Handing the default explicitly must be the same run.
		const explicit = semanticOf(await turn(falloff(1)))
		expect(explicit).toEqual(semantic)
	}, 60_000)

	/**
	 * The measurement, and the table this control is chosen on.
	 *
	 * | falloff | closest | middle | weakest | closest ÷ weakest |
	 * |---|---|---|---|---|
	 * | 1 | 0.894 | 0.707 | 0.332 | 2.7 : 1 |
	 * | 2 | 0.800 | 0.500 | 0.110 | 7.3 : 1 |
	 * | 3 | 0.716 | 0.354 | 0.037 | 19.5 : 1 |
	 * | 4 | 0.640 | 0.250 | 0.012 | 52.6 : 1 |
	 *
	 * Two things are true down every column and they are the argument for a
	 * shape over a threshold: the **order never changes** (a power curve is
	 * strictly monotonic, so this mechanism can never reorder or silence its own
	 * hits), and the **weakest is never zero** (fixed at 0 and 1, so the row
	 * stays in the pool for every other mechanism to find).
	 */
	it("sharpens the separation monotonically and drops nobody", async () => {
		const measured: Array<[number, number, number, number]> = []
		for (const g of [1, 2, 3, 4]) {
			const receipt = await turn(falloff(g))
			const semantic = semanticOf(receipt)

			// Order preserved, at every setting: the curve shapes how much the
			// signal weighs, never which hit is the better one.
			expect(semantic[lightId]).toBeGreaterThan(semantic[waterId]!)
			expect(semantic[waterId]).toBeGreaterThan(semantic[stoneId]!)
			// Nobody leaves. This is the sentence `minScore` could not say.
			expect(semantic[stoneId]).toBeGreaterThan(0)
			expect([...rankedIds(receipt)].sort()).toEqual(
				[stoneId, waterId, lightId].sort()
			)

			measured.push([
				g,
				semantic[lightId]!,
				semantic[waterId]!,
				semantic[stoneId]!
			])
		}

		expect(
			measured.map(([g, l, w, s]) => [
				g,
				Number(l.toFixed(3)),
				Number(w.toFixed(3)),
				Number(s.toFixed(3))
			])
		).toEqual([
			[1, 0.894, 0.707, 0.332],
			[2, 0.8, 0.5, 0.11],
			[3, 0.716, 0.354, 0.037],
			[4, 0.64, 0.25, 0.012]
		])

		// Separation strictly increases, and the top is never thrown away with
		// the bottom: at 3 the weakest has lost 89% of its contribution and the
		// closest has kept 80% of its own.
		const spread = measured.map(([, l, , s]) => l / s)
		expect(spread).toEqual([...spread].sort((a, b) => a - b))
		expect(spread.map((r) => Number(r.toFixed(1)))).toEqual([
			2.7, 7.3, 19.5, 52.6
		])
	}, 60_000)

	/**
	 * The decision-relevant number: **how much is a vague match allowed to weigh
	 * against a keyword the author actually wrote?**
	 *
	 * `signalSemantic` is 0.3 and `signalKeyword` is 0.35 on world lore, sized
	 * so that *keys guarantee and meaning only adds*. Read off the engine's own
	 * scores rather than multiplied out here — the difference between a run and
	 * the same run with the semantic weight zeroed is exactly this mechanism's
	 * contribution.
	 *
	 * | falloff | weakest hit's contribution | as a share of one keyword hit |
	 * |---|---|---|
	 * | 1 | 0.100 | 28% |
	 * | 2 | 0.033 | 9% |
	 * | 3 | 0.011 | 3% |
	 * | 4 | 0.004 | 1% |
	 *
	 * At the shipped 1, an entry the conversation is *not* about — a ruin that
	 * happens to keep one lamp at its gate — collects a quarter of an authored
	 * keyword's worth of score for turning up in the vector arm at all. That is
	 * the number a reader is deciding about when they move this control, and it
	 * is a property of their model rather than of this app, which is why the
	 * default leaves it exactly where it has always been.
	 */
	it("measures what a weak match weighs against an authored keyword", async () => {
		const KEYWORD_HIT = 0.35
		const zeroed = [
			{
				nodeKey: "rank",
				path: "signalSemantic",
				value: {
					messages: 0,
					worldLore: 0,
					characterLore: 0,
					history: 0,
					relationships: 0
				}
			}
		]
		const scoreOf = (receipt: any, id: number): number =>
			((node(receipt, "rank")?.output as any)?.decisions ?? []).find(
				(d: any) => d.candidate.id === id
			)?.score ?? 0

		const withoutSemantic = scoreOf(
			await turn([...MECHANISM_ON, ...zeroed]),
			stoneId
		)

		const shares: number[] = []
		for (const g of [1, 2, 3, 4]) {
			const contribution =
				scoreOf(await turn(falloff(g)), stoneId) - withoutSemantic
			expect(contribution).toBeGreaterThan(0)
			shares.push(contribution / KEYWORD_HIT)
		}

		expect(shares.map((r) => Math.round(r * 100))).toEqual([28, 9, 3, 1])
	}, 60_000)

	/**
	 * The one direction the control may not go.
	 *
	 * An exponent below 1 is concave: it *amplifies* the noise floor every
	 * embedder has, so a candidate the model thinks nothing of scores as though
	 * it did. There is no install for which that is the intent, so the binding
	 * clamps rather than trusting the stored value — which is a row of JSON,
	 * hand-editable, and read on the path to the model.
	 */
	it("clamps below 1 rather than amplifying a weak match", async () => {
		const raw = semanticOf(await turn(MECHANISM_ON))
		const concave = semanticOf(await turn(falloff(0.25)))
		expect(concave).toEqual(raw)
	}, 60_000)
})
