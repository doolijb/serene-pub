/**
 * **Every declared signal weight has a producer, and every producer's signal is
 * declared.** Both sides derived from the code; neither written down.
 *
 * ## The class of defect this closes
 *
 * An audit of the ranking surface found the same failure in both directions at
 * once, and neither direction had a test that *could* have seen it:
 *
 *   · `signalRecency` and `signalSceneAffinity` were declared on
 *     `core:task/rank-hybrid@1`, transposed by `signalsFrom`, multiplied in
 *     `score()`, persisted through the scope chain and rendered in a panel —
 *     and **no mechanism has ever written either signal**, so both weights
 *     multiplied a permanent zero at every value on every install.
 *   · `guaranteedMessages` was the mirror image: read by `keywordQuery`,
 *     load-bearing for two live signals, and declared nowhere, so the only
 *     value it could take was a constant.
 *   · `densitySignal` was a third shape — a helper with no caller, beside a
 *     weight with nothing to weigh.
 *
 * ⚠ **Why the existing suites could not catch any of it.** `signals.test.ts`
 * holds `keyof SignalWeights` against the declared `signal*` fields and their
 * defaults — a real guard, and structurally unable to ask whether *anything
 * produces the number*. `nodeParams.test.ts` hands `rank-hybrid` a candidate it
 * wrote itself, so it proves a weight multiplies a signal a *test* supplied.
 * `retrievalModeCull.int.test.ts` proves a control survives a config cull, which
 * a dead control does just as well as a live one. And the parity corpus is
 * blind to lore ranking entirely — measured: zeroing every lore signal weight
 * leaves every gate fixture byte-identical.
 *
 * ## How the two sides are derived
 *
 * **Declared** comes off the shipped contracts descriptor: every field of
 * `core:task/rank-hybrid@1`'s `params` schema named `signal<Something>`, mapped
 * back to the signal it transposes onto. Not a list — read from the package the
 * app itself loads, so a field added there arrives here without an edit.
 *
 * **Live** comes off a **turn**. One session, every retrieval mechanism the
 * shipped reply pipeline has, switched on and run through the real executor,
 * the real bindings and the real host; the candidates that reach `rank` are then
 * probed with the ranker's own `score()`, one weight at a time:
 *
 *     score(c, { …all zero, [w]: 1 }, c.priority) > 0
 *
 * A weight is **live** exactly when some candidate the pipeline can produce
 * makes that true. Nothing here knows *how* a weight is carried — `priorityBonus`
 * rides on `Candidate.priority` rather than on `signals` and needs no special
 * case, because the probe asks the question `score()` answers rather than
 * inspecting a field.
 *
 * ⚠ **The fixture is the one thing that is authored, so it is guarded too.** A
 * world that failed to make a mechanism fire would report that mechanism's
 * weight dead and this file would go green on a lie. So the arms are asserted to
 * have run and produced before anything is concluded from their silence, and
 * every candidate-bearing node in the retrieval half of the receipt must have
 * ended `ok`.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { respondSpec } from "$lib/server/pipelines/specs/respond"
import { narrateSpec } from "$lib/server/pipelines/specs/narrate"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import {
	DEFAULT_GROUPS,
	DEFAULT_SIGNAL_WEIGHTS,
	type SignalWeights,
	type RetrievalBand
} from "$lib/server/pipelines/ranking/weights"
import { score, type Candidate } from "$lib/server/pipelines/ranking/select"
import * as C from "@serene-pub/contracts"

/**
 * A toy encoder with two orthogonal axes, addressed by whole strings.
 *
 * Whole strings rather than shared tokens on purpose, exactly as
 * `entityVectorArm.int.test.ts` argues: a token-based toy would make the
 * embedder agree with the keyword mechanism, and the two arms that need it here
 * exist to find what keywords cannot.
 */
const AXIS: Record<string, number[]> = {
	// The entity-vector arm: a description, and the name it means.
	"the order rides": [1, 0],
	"the ashguard riders": [1, 0],
	// The semantic arm: the query window, and the entry it is about.
	"an order of oathbound riders who keep the long roads": [1, 0],
	"a gate of black iron, barred at dusk": [0, 1]
}
const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()
const vectorFor = (text: string): number[] => {
	const exact = AXIS[norm(text)]
	if (exact) return exact
	// Anything else leans on the first axis a little, so the semantic arm
	// produces a *graded* pool rather than a pool of zeroes — a cosine of 0
	// everywhere would make `semantic` look unproducible for a fixture reason.
	return [0.4, 0.2]
}
const dot = (a: number[], b: number[]) =>
	a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0)

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => true,
	getLoadedModelId: () => "test-signal-wiring",
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor)
}))

/** Filled in `beforeAll`, once the rows have ids. */
let poolRows: any[] = []

vi.mock("$lib/server/embedding/ragContext", () => ({
	getSessionRagContext: async () => ({ lorebookId: 1 }),
	fetchScopedCandidates: async () => ({ candidates: poolRows, truncated: [] }),
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
 * A world built so that **every** signal has something to say.
 *
 * One entry per question, and the questions are the signals:
 *
 *   · **Riders** — its key fires (`keyword`, and therefore `lastRefRecency`),
 *     its title occurs in the conversation (`nameMatch`), the conversation
 *     names it as an entity (`entityCooccurrence` through the open tier), the
 *     semantic arm rates it closest (`semantic`), and the description *"the
 *     order rides"* links to its name (`entityVector`).
 *   · **Gate** — two keys, both matched, four characters apart in one sentence
 *     (`proximity`, which needs two exact hits and is 0 across every parity
 *     fixture because they all carry one key each).
 *   · **Stub** — a fraction of the pool's average length (`density`), and
 *     carrying an author priority of 3 (`priorityBonus`).
 *
 * ⚠ Nothing here is asserted *from* this list. The list is what makes the
 * measurement possible; what is measured is which weights can move a score.
 */
const ENTRIES = [
	{
		name: "The Ashguard Riders",
		keys: "ashguard",
		content: "An order of oathbound riders who keep the long roads.",
		priority: 1
	},
	{
		name: "The Iron Gate",
		keys: "gate, warden",
		content: "A gate of black iron, barred at dusk.",
		priority: 1
	},
	{
		name: "Tollhouse",
		keys: "toll",
		content: "A hut.",
		priority: 3
	}
] as const

let ridersId: number
let gateId: number
let stubId: number

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "signal-wiring", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Every signal", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	const rows = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues(
				ENTRIES.map((e) => ({ lorebookId: lorebook.id, ...e }))
			)
		)
		.returning()
	ridersId = rows[0]!.id
	gateId = rows[1]!.id
	stubId = rows[2]!.id

	poolRows = rows.map((row: any) => ({
		source: "worldLore",
		id: row.id,
		name: row.name,
		content: row.content,
		embedding: vectorFor(row.content),
		lorebookId: lorebook.id
	}))

	/**
	 * The entity mechanism reads an index the background pass writes, so a
	 * fixture that never ran that pass would report the mechanism silent and
	 * conclude its signal is dead. Awaited here rather than enqueued: this is
	 * the whole-book pass a test can wait on, which is the reason it still
	 * exists beside the queue.
	 */
	const { annotateLorebook } = await import("$lib/server/annotations")
	await annotateLorebook(db, lorebook.id)

	for (const content of [
		// `The Ashguard Riders` capitalised mid-sentence: the entity profile's
		// open tier, which is what gives the world-lore overlap something to
		// intersect without this fixture needing a cast.
		"We rode past The Ashguard Riders at the toll before dark.",
		// `gate` and `warden` four characters apart — the two exact hits
		// `keywordMatch` needs before it reports any proximity at all.
		"The ashguard is near. The gate warden waved us through.",
		// A description that names nothing the world knows and shares no token
		// with its target: the reference only the entity-vector arm can see.
		"I hear the order rides at dawn."
	])
		await db.insert(schema.sessionMessages).values({
			sessionId,
			role: "user",
			content
		} as any)
}, 60_000)

/**
 * Every mechanism's own switch, raised — and nothing else touched.
 *
 * Each of these is the *one* control that decides whether its mechanism runs
 * (`admitThreshold`'s convention: a mechanism that changes what reaches the
 * model ships off). Raising all four is what makes "can this weight ever move a
 * score" a question about the code rather than about the shipped defaults.
 */
const EVERY_MECHANISM = [
	{ nodeKey: "gather.entities.read", path: "maxEntries", value: 20 },
	{ nodeKey: "semantic.arm.search", path: "maxEntries", value: 20 },
	{ nodeKey: "names.arm.mentions", path: "maxMentions", value: 4 }
]

const turn = async () => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db, { sessionId })
	for (const o of EVERY_MECHANISM)
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
		seed: "seed:signal-wiring",
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)) as any
}

const node = (receipt: any, key: string) =>
	receipt.nodes.find((n: any) => n.nodeKey === key)

const ranked = (receipt: any): Candidate[] =>
	((node(receipt, "rank")?.output as any)?.candidates ?? []) as Candidate[]

/** Every signal name in the app's own weight type, from the shipped map. */
const WEIGHTS = Object.keys(
	DEFAULT_SIGNAL_WEIGHTS.worldLore
) as (keyof SignalWeights)[]

const ZERO = Object.fromEntries(
	WEIGHTS.map((w) => [w, 0])
) as unknown as SignalWeights

/** `signalNameMatch` → `nameMatch`. The transposition `signalsFrom` performs. */
const signalOf = (field: string): string =>
	`${field.slice("signal".length, "signal".length + 1).toLowerCase()}${field.slice("signal".length + 1)}`

/** Retrieval nodes that ran out of their declared budget rather than failing. */
const timedOut = (r: any): string[] =>
	(r.nodes as any[])
		.filter(
			(n) =>
				n.result === "err" &&
				!n.recoveredAsEmpty &&
				/timeout/i.test(String(n.reason ?? ""))
		)
		.map((n) => n.nodeKey)

let receipt: any
beforeAll(async () => {
	/**
	 * ⚠ **Turns until nothing times out, and the first one is always thrown
	 * away.**
	 *
	 * `core:query/entity-search@1` declares a 2s timeout and does real work
	 * inside it: it promotes un-annotated entries to the front of the annotation
	 * lane and waits for its own scope to be covered. On a cold PGlite database
	 * the first turn spends that budget on module loads and first queries
	 * against fresh tables, and under a loaded suite even a warm one can.
	 *
	 * A node that ran out of *time* has not told us anything about wiring, and
	 * this file's whole conclusion is drawn from what the mechanisms produced —
	 * so inheriting a budget artefact would report a live mechanism silent and a
	 * live weight dead. Retried rather than given a longer budget because the
	 * budget is the type's own declaration and not this file's to move, and
	 * bounded rather than looped because a node that times out five times in a
	 * row is a real finding: the assertion below then fails, naming it.
	 */
	await turn()
	for (let attempt = 0; attempt < 5; attempt++) {
		receipt = await turn()
		if (!timedOut(receipt).length) break
	}
}, 120_000)

describe("the fixture is capable of the measurement it is used for", () => {
	/**
	 * ⚠ Read this before believing anything below it. A silent arm reports its
	 * weight dead, and a file that concluded from silence would be the audit
	 * defect with a green tick beside it.
	 */
	it("ran every retrieval mechanism the shipped pipeline has", () => {
		const upToRank = receipt.nodes.slice(
			0,
			receipt.nodes.findIndex((n: any) => n.nodeKey === "rank") + 1
		)
		// `recoveredAsEmpty` is not a failure: an `optional` node whose feature
		// is off — the narrative graph on an install that never opened it —
		// resolves to an empty result on purpose, which is the governing rule
		// working rather than a fixture problem.
		expect(
			upToRank
				.filter(
					(n: any) => n.result !== "ok" && !n.recoveredAsEmpty
				)
				.map(
					(n: any) =>
						`${n.nodeKey}: ${n.result} (${n.reason ?? "no reason"})`
				)
		).toEqual([])

		// The three lore lanes, the entity mechanism, and the two vector arms —
		// each asserted to have produced, not merely to have run.
		const produced = (key: string, port = "main") =>
			((node(receipt, key)?.output as any)?.[port] ?? []).length
		expect(produced("gather.worldLore.read")).toBeGreaterThan(0)
		expect(produced("gather.entities.read")).toBeGreaterThan(0)
		expect(produced("semantic.arm.search", "hits")).toBeGreaterThan(0)
		expect(
			((node(receipt, "names.arm.link")?.output as any)?.links ?? [])
				.length,
			"the entity-vector arm linked nothing, so its weight cannot be measured"
		).toBeGreaterThan(0)

		expect(ranked(receipt).length).toBeGreaterThan(0)
	}, 60_000)
})

describe("every declared signal weight has a producer, and the reverse", () => {
	/**
	 * The measurement. A weight is **live** when some candidate the pipeline
	 * produced makes `score()` move for it and nothing else.
	 */
	const live = (): Set<string> => {
		const candidates = ranked(receipt)
		const out = new Set<string>()
		for (const w of WEIGHTS)
			for (const c of candidates)
				if (
					score(c.signals ?? {}, { ...ZERO, [w]: 1 }, c.priority ?? 1) >
					0
				) {
					out.add(w)
					break
				}
		return out
	}

	/** Every `signal*` field the shipped descriptor declares. */
	const declared = (): Set<string> => {
		const schema = (C.rankHybrid.descriptor.slots?.params?.schema ??
			{}) as Record<string, unknown>
		const fields = Object.keys(schema).filter((f) => f.startsWith("signal"))
		expect(
			fields.length,
			"the descriptor declares no signal weights at all — the read moved"
		).toBeGreaterThan(0)
		return new Set(fields.map(signalOf))
	}

	it("no declared weight is inert on every candidate a turn can produce", () => {
		const dead = [...declared()].filter((w) => !live().has(w)).sort()
		expect(
			dead,
			"declared on core:task/rank-hybrid@1, and no mechanism in the " +
				"shipped pipeline produces the signal it weighs. Wire a " +
				"producer or remove the declaration — a control that cannot " +
				"change a prompt is the defect this file exists to stop."
		).toEqual([])
	}, 60_000)

	it("no signal a mechanism produces is missing a declared weight", () => {
		const undeclared = [...live()]
			.filter((w) => !declared().has(w))
			.sort()
		expect(
			undeclared,
			"a wired mechanism produces this signal and `rank-hybrid` declares " +
				"no weight for it, so nobody can turn it up or down. Declare it " +
				"beside its peers."
		).toEqual([])

		// The third leg: the app's own weight type and the declaration are one
		// set. `signals.test.ts` pins the defaults; this pins membership from
		// the side that has just been measured.
		expect([...declared()].sort()).toEqual([...WEIGHTS].sort())
	}, 60_000)

	/**
	 * The reverse of the reverse: a producer inventing a signal name.
	 *
	 * `score()` reads named fields, so a mechanism writing `signals.novelty`
	 * would be a number computed on every turn, carried on every candidate,
	 * shown in no receipt and read by nothing — a fourth shape of the same
	 * defect, and the one the probe above cannot see, because a weight that
	 * does not exist cannot be probed.
	 */
	it("no candidate carries a signal the scorer has no name for", () => {
		const stray = new Set<string>()
		for (const c of ranked(receipt))
			for (const key of Object.keys(c.signals ?? {}))
				if (!(WEIGHTS as string[]).includes(key)) stray.add(key)
		expect([...stray].sort()).toEqual([])
	}, 60_000)
})

/**
 * The per-source half of the same guard (R-7 P5, 2026-09-16 — plans/30 U3b):
 * **declared intent ≡ live intent ≡ the ranker's fallback**, all three read off
 * the shipped code and a real turn.
 *
 * Each of the five retrieval definitions declares its band's `share`,
 * `maxEntries` and `priority` (the conversation its `minEntries` too) and
 * publishes them as a band intent; the ranker resolves its band table from
 * the intents that reach it and falls back to `DEFAULT_GROUPS` for a core
 * band nothing spoke for. Three sets that must be one set:
 *
 *   · **declared** — the definitions' own `default`s;
 *   · **live** — the table the ranker actually resolved on this turn
 *     (`rank.output.diagnostics.bands`), with every one of the five bands
 *     reached by an intent (`declared` on the receipt);
 *   · **fallback** — `DEFAULT_GROUPS`, which the migration's `shipped` table
 *     and the handler-side defaults also spell.
 *
 * A source whose params a spec forgot to wire, a default moved on one side
 * and not the other, or a band intent lost between a source and the ranker
 * each show here as two of the three disagreeing.
 */
describe("every source's declared intent is what reaches the ranker", () => {
	const SOURCES = {
		messages: C.sessionHistory,
		worldLore: C.worldLore,
		characterLore: C.characterLore,
		history: C.historyEntries,
		relationships: C.relationshipSearch
	} as const
	const declared = (def: { descriptor: any }, field: string) =>
		def.descriptor.slots?.params?.schema?.[field]?.default

	it("every one of the five bands reaches the ranker as an intent — none runs on the fallback", () => {
		const rank = node(receipt, "rank")
		expect(rank?.result).toBe("ok")
		expect([...rank.output.diagnostics.declared].sort()).toEqual(
			Object.keys(SOURCES).sort()
		)
		expect(rank.output.diagnostics.defaulted).toEqual([])
	}, 60_000)

	it("the live band table is the declared one, member for member", () => {
		const live = node(receipt, "rank").output.diagnostics.bands
		for (const [band, def] of Object.entries(SOURCES)) {
			expect(live.share[band], `${band} share`).toBe(declared(def, "share"))
			expect(live.maxEntries[band], `${band} maxEntries`).toBe(
				declared(def, "maxEntries")
			)
			expect(live.priority[band], `${band} priority`).toBe(
				declared(def, "priority")
			)
		}
		expect(live.minEntries.messages).toBe(declared(C.sessionHistory, "minEntries"))
		// R6: no lore floor is declared, so none is live.
		for (const band of ["worldLore", "characterLore", "history", "relationships"])
			expect(live.minEntries[band]).toBe(0)
	}, 60_000)

	it("the ranker's fallback table is the same set again", () => {
		for (const [band, def] of Object.entries(SOURCES)) {
			expect(DEFAULT_GROUPS.share[band as RetrievalBand]).toBe(declared(def, "share"))
			expect(DEFAULT_GROUPS.maxEntries[band as RetrievalBand]).toBe(
				declared(def, "maxEntries")
			)
			expect(DEFAULT_GROUPS.priority[band as RetrievalBand]).toBe(
				declared(def, "priority")
			)
		}
		expect(DEFAULT_GROUPS.minEntries.messages).toBe(
			declared(C.sessionHistory, "minEntries")
		)
	})

	it("the ranker declares none of it — the maps are gone", () => {
		const schema = (C.rankHybrid.descriptor.slots?.params?.schema ??
			{}) as Record<string, unknown>
		for (const gone of ["share", "maxEntries", "minEntries"])
			expect(gone in schema, `${gone} is declared on the ranker again`).toBe(false)
		// What stays is cross-source: mechanisms, signals, normalisation, precedence.
		expect(
			Object.keys(schema).filter((k) => !k.startsWith("signal")).sort()
		).toEqual(["mechanismWeights", "scoreLedAllocation", "shareNormalisation"])
	})
})

/**
 * The same guard for a pipeline that scans through ONE node (U3b review W1).
 *
 * `narrate` has no lane per lore band: `lore` is `core:query/lorebook-triggers@1`
 * and produces all three through one port. Before the review it declared no
 * intent at all, so the narrator's three lore bands reached the ranker
 * DEFAULTED — the same numbers, but nothing on that node could move them and
 * a tuned share on its ranker had nowhere to migrate to. It declares one
 * intent per band now (`worldLoreShare` …) and publishes three; this holds
 * that they arrive declared, at the declared numbers, and that moving one
 * moves the live table.
 */
describe("a one-node scan's three lore bands reach the ranker declared, not defaulted", () => {
	const narrateTurn = async (loreParams: Record<string, unknown> = {}) => {
		const { buildWorld } = await import("$lib/server/pipelines/config/world")
		const world = await buildWorld(db, { sessionId })
		for (const [path, value] of Object.entries(loreParams))
			world.overrides.push({
				nodeKey: "lore",
				slot: "params",
				path,
				value,
				scopeKind: "session"
			} as any)
		return (await run(narrateSpec(), {
			world,
			input: {
				text: "I hear the order rides at dawn.",
				sessionId,
				characterId: null,
				sessionScope: { sessionId, currentCharacterId: null }
			},
			seed: "seed:signal-wiring-narrate",
			bindings: coreBindings(),
			host: createHost(db, { sessionId, userId }),
			preview: true
		} as any)) as any
	}
	const scan = () =>
		C.lorebookTriggers.descriptor.slots?.params?.schema as Record<string, any>

	it("narrate's turn declares the conversation and all three lore bands; only the graph, which it has no source for, runs on the fallback", async () => {
		const receipt = await narrateTurn()
		const rank = node(receipt, "rank")
		expect(rank?.result).toBe("ok")
		expect([...rank.output.diagnostics.declared].sort()).toEqual([
			"characterLore",
			"history",
			"messages",
			"worldLore"
		])
		expect(rank.output.diagnostics.defaulted).toEqual(["relationships"])
		// The three intents rode at the head of the scan's own port.
		const { splitCandidates } = await import("@serene-pub/sdk")
		expect(
			splitCandidates(node(receipt, "lore").output.main).intents.map((i) => i.band)
		).toEqual(["worldLore", "characterLore", "history"])
	}, 60_000)

	it("the live table is the scan node's declaration, band for band — the lanes' numbers", async () => {
		const live = node(await narrateTurn(), "rank").output.diagnostics.bands
		for (const band of ["worldLore", "characterLore", "history"]) {
			expect(live.share[band], `${band} share`).toBe(scan()[`${band}Share`].default)
			expect(live.maxEntries[band], `${band} maxEntries`).toBe(
				scan()[`${band}MaxEntries`].default
			)
			expect(live.priority[band], `${band} priority`).toBe(
				scan()[`${band}Priority`].default
			)
			expect(live.minEntries[band], `${band} floor (R6)`).toBe(0)
		}
	}, 60_000)

	it("a share tuned on the scan node moves the live table", async () => {
		const live = node(
			await narrateTurn({ worldLoreShare: 0.4, historyMaxEntries: 3 }),
			"rank"
		).output.diagnostics.bands
		expect(live.share.worldLore).toBe(0.4)
		expect(live.maxEntries.history).toBe(3)
		// The bands not touched keep their declaration.
		expect(live.share.characterLore).toBe(scan().characterLoreShare.default)
	}, 60_000)
})
