/**
 * The plan's **second governing rule**, over the shipped reply pipeline.
 *
 * > An unavailable mechanism subtracts a signal. It never reroutes, disables a
 * > path, or excludes a candidate. Adding a model may only add matches;
 * > removing one may only lose them.
 *
 * It is stated as an absolute because it has been broken in both directions in
 * this project, and each direction looks like an unrelated bug from the outside:
 *
 *   · **Adding a model removed lore.** `rag` is the default retrieval strategy
 *     for an entry that has not decided — and was the default `retrievalMode`
 *     of the lore nodes besides, until migration 0203 culled that — so it is
 *     what nearly every entry in every lorebook is, and `eligibleFor` made a
 *     `rag` entry keyword-**ineligible** the moment an embedding model loaded,
 *     deferring it to a vector mechanism that no shipped spec wired. Loading a model
 *     emptied lore out of every prompt.
 *   · **Removing a model ended the turn.** `core:oracle/embed-text@1` throws
 *     when the host has no model loaded, which is the right answer to give a
 *     caller and the wrong thing to let end somebody's reply. Wiring the mechanism
 *     into `respond` 1.19.0 put that throw on the shipped path.
 *
 * Both are the same defect — retrieval **routing** instead of **contributing** —
 * and this file asserts the property rather than either symptom. The three cases
 * are the ones availability can take: never had a model, has one, and lost one
 * mid-session.
 *
 * ⚠ **The parity corpus cannot cover this.** `pipelinePreview` runs
 * `parityPipeline()`, a corpus-specific document that has no semantic block at
 * all, so a green gate says nothing about the mechanism's presence in the shipped
 * spec. These run `respondSpec()` itself.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { respondSpec } from "$lib/server/pipelines/specs/respond"
import * as schema from "$lib/server/db/schema"
import {
	characterLoreValues,
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"

/** Flipped per case — the whole subject of this file is what this decides. */
let modelReady = false

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => modelReady,
	getLoadedModelId: () => (modelReady ? "test-embed-model" : null),
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor)
}))

/** A toy embedding: one axis, so "is this about the ashguard" is readable. */
function vectorFor(text: string): number[] {
	return [text.toLowerCase().includes("ashguard") ? 1 : 0, 1]
}

/**
 * What the index would return, filled in `beforeAll` once the rows have ids.
 *
 * The entry keyed `wastes` is deliberately **not** reachable by any key in this
 * session's conversation — it is what the semantic mechanism can add and the keyword
 * mechanism cannot, which is what makes "only adds" a measurable claim rather than a
 * tautology.
 */
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
/** The entry both mechanisms reach, and the one only meaning does. */
let keyedId: number
let meaningOnlyId: number

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "semantic-arm", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Governing rule", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	/**
	 * ⚠ **Nothing in this seed can route an entry to a mechanism or away from one,
	 * and that is the point.**
	 *
	 * These are the entries a lorebook nobody has configured is made of — the
	 * population the historical failure emptied when an embedding model was
	 * loaded. There is no longer anything that *could* do the routing: the lore
	 * nodes' `retrievalMode` was culled by migration 0203, and the per-entry
	 * `retrieval_strategy` column by 0204. This file is what proves the rule
	 * end to end over the shipped spec, across all three availability states,
	 * and it holds the rule alone now that the unit tests over the gate are
	 * gone with the gate.
	 */
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
				// Reachable only by meaning: no key in this conversation says
				// "wastes", so the keyword scan cannot reach it at any depth.
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

	const [binding] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			binding: "{{npc:1}}",
			name: "The Ashguard order"
		})
		.returning()
	await db.insert(schema.lorebookEntries).values(
		characterLoreValues([
			{
				lorebookId: lorebook.id,
				lorebookBindingId: binding.id,
				name: "Vell's oath",
				keys: "ashguard",
				content: "She swore it twice."
			}
		])
	)
	await db.insert(schema.lorebookEntries).values(
		historyValues([
			{
				lorebookId: lorebook.id,
				keys: "ashguard",
				content: "The siege broke in the spring.",
				year: 412,
				month: 3
			}
		])
	)

	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "tell me about the ashguard"
	} as any)
}, 60_000)

/**
 * One turn of the **shipped** reply spec, stopped before the provider.
 *
 * `overrides` reach the nodes through the `params` slots the document already
 * wires, at `defaults` scope — the same route `harness.rag.int.test.ts` uses to
 * turn the mechanism on for the corpus that measures it.
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
			text: "tell me about the ashguard",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:governing-rule",
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)) as any
}

const node = (receipt: any, key: string) =>
	receipt.nodes.find((n: any) => n.nodeKey === key)

const rankedKeys = (receipt: any): string[] =>
	((node(receipt, "rank")?.output as any)?.candidates ?? []).map(
		(c: any) => `${c.source}:${c.id}`
	)

/** Every node that ended in `err` and was not absorbed as an empty result. */
const failed = (receipt: any): string[] =>
	receipt.nodes
		.filter((n: any) => n.result === "err" && !n.recoveredAsEmpty)
		.map((n: any) => `${n.nodeKey}: ${n.reason ?? "err"}`)

/**
 * How far the turn got, as the two facts that matter here.
 *
 * ⚠ **Not `receipt.preview`.** This database has no context template selected,
 * so `prompt` halts with *"assemble has no template"* on every run in this file
 * — an environment limit, unrelated to embeddings, and the same reason
 * `respondLanes.int.test.ts` reads the ranker's output rather than the preview.
 * Asserting on the preview would make every case here fail for a reason that is
 * not the subject.
 *
 * What the governing rule actually claims is narrower and checkable: **nothing
 * in the retrieval path failed, and nothing in it stopped the run.** So this
 * reports the unrecovered failures and whether anything halted at or before the
 * ranker — a halt at `prompt`, downstream of everything under test, is not one.
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

describe("no embedding model — the mechanism subtracts a signal and nothing else", () => {
	it("completes the turn, with the mechanism reporting why it is empty", async () => {
		modelReady = false
		const receipt = await turn()

		// A halt is the defect. `preview: true` stops the run at the provider on
		// purpose, so reaching the preview *is* completing the turn.
		expect(retrievalOutcome(receipt)).toEqual(CLEAN)

		// The mechanism ran, and said what it found — the honest surface the coordinator
		// asked for, rather than an exception.
		const search = node(receipt, "semantic.arm.search")
		expect(
			search,
			"the semantic mechanism is not in the shipped spec"
		).toBeTruthy()
		expect(search!.result).toBe("ok")
		expect((search!.output as any)?.main ?? []).toEqual([])
		expect(
			(search!.output as any)?.diagnostics?.vectorSearch
		).toBeTruthy()

		// And the embed node did not fail either: `auto` reads an unavailable
		// model as an absence, and the node is `optional` besides, so neither
		// route can end a turn.
		const embed = node(receipt, "semantic.arm.embed")
		expect(embed!.result).toBe("ok")
		expect((embed!.output as any)?.vectors ?? []).toEqual([])

		// Every other mechanism behaved: all three lore lanes reached the ranker.
		const sources = new Set(
			rankedKeys(receipt).map((k) => k.split(":")[0])
		)
		for (const s of ["worldLore", "characterLore", "history"])
			expect(sources.has(s), `${s} did not reach the ranker`).toBe(true)
	}, 30_000)
})

describe("a model appears — matches are only added", () => {
	/**
	 * ⚠ **The direction that shipped broken**, asserted as a set relation rather
	 * than as a list, because the claim is *nothing disappears* and a list would
	 * also fail on something appearing.
	 */
	it("keeps every candidate the keyword mechanism found, with the mechanism off", async () => {
		modelReady = false
		const without = new Set(rankedKeys(await turn()))
		expect(without.size).toBeGreaterThan(0)

		modelReady = true
		const withModel = rankedKeys(await turn())

		for (const key of without)
			expect(
				withModel.includes(key),
				`loading an embedding model removed ${key} from the prompt — ` +
					`the mechanism may add matches and may never take one away`
			).toBe(true)
	}, 30_000)

	it("keeps them with the mechanism on, and adds what only meaning could reach", async () => {
		modelReady = false
		const without = new Set(rankedKeys(await turn()))

		modelReady = true
		const on = rankedKeys(
			await turn([
				{
					nodeKey: "semantic.arm.queries",
					path: "searchByMeaning",
					value: "on"
				},
				{
					nodeKey: "semantic.arm.search",
					path: "maxEntries",
					value: 10
				}
			])
		)

		for (const key of without)
			expect(
				on.includes(key),
				`turning the semantic mechanism on removed ${key} from the prompt`
			).toBe(true)

		// Keyed `wastes`, which the conversation never says. It is reachable by
		// meaning and by nothing else in this session, so its arrival is the mechanism
		// working rather than the keyword scan widening.
		expect(on).toContain(`worldLore:${meaningOnlyId}`)
		expect(without.has(`worldLore:${meaningOnlyId}`)).toBe(false)
	}, 30_000)

	it("adds a signal to an entry both mechanisms found, rather than replacing its score", async () => {
		modelReady = true
		const receipt = await turn([
			{ nodeKey: "semantic.arm.queries", path: "searchByMeaning", value: "on" },
			{ nodeKey: "semantic.arm.search", path: "maxEntries", value: 10 }
		])
		const candidates: any[] =
			(node(receipt, "rank")?.output as any)?.candidates ?? []
		const both = candidates.find(
			(c) => `${c.source}:${c.id}` === `worldLore:${keyedId}`
		)
		expect(both, "the entry both mechanisms reach is missing").toBeTruthy()

		// The keyword mechanism's signals survive — `concat-candidates` keeps the first
		// occurrence of a `source:id` — and the semantic one is merged in beside
		// them. A `presetScore` here would mean the mechanism had replaced the whole
		// weighted sum instead of contributing to it.
		expect(both.signals.keyword).toBeGreaterThan(0)
		expect(both.signals.semantic).toBeGreaterThan(0)
		expect(both.presetScore).toBeUndefined()
	}, 30_000)
})

describe("a model that goes away mid-session", () => {
	it("degrades exactly like never having had one", async () => {
		// Service down, model unloaded, container restarted: the turn after is a
		// turn like any other. Asserted as *the same candidate set*, so a
		// difference between "lost it" and "never had it" fails here.
		modelReady = true
		const on = await turn([
			{ nodeKey: "semantic.arm.queries", path: "searchByMeaning", value: "on" },
			{ nodeKey: "semantic.arm.search", path: "maxEntries", value: 10 }
		])
		expect(retrievalOutcome(on)).toEqual(CLEAN)

		modelReady = false
		const lost = await turn([
			{ nodeKey: "semantic.arm.queries", path: "searchByMeaning", value: "on" },
			{ nodeKey: "semantic.arm.search", path: "maxEntries", value: 10 }
		])
		expect(retrievalOutcome(lost)).toEqual(CLEAN)

		modelReady = false
		const never = await turn([
			{ nodeKey: "semantic.arm.queries", path: "searchByMeaning", value: "on" },
			{ nodeKey: "semantic.arm.search", path: "maxEntries", value: 10 }
		])
		expect(rankedKeys(lost)).toEqual(rankedKeys(never))
	}, 30_000)

	it("cannot end a turn even when the mechanism was asked for explicitly", async () => {
		/**
		 * `enabled: 'on'` is the setting that says *"I configured this, tell me
		 * when it breaks"*, and it does — the failure is recorded rather than
		 * swallowed. What it must not do is cost a reply, and that guarantee is
		 * structural: `core:oracle/embed-text@1` is `optional`, so the executor
		 * turns the error into an empty `ok` and marks it `recoveredAsEmpty`.
		 *
		 * This is the case a `try` in the binding would not have covered, which
		 * is why the flag is on the declaration.
		 */
		modelReady = false
		const receipt = await turn([
			{ nodeKey: "semantic.arm.queries", path: "searchByMeaning", value: "on" },
			{ nodeKey: "semantic.arm.embed", path: "enabled", value: "on" }
		])

		expect(
			retrievalOutcome(receipt),
			"an explicit `on` ended the turn"
		).toEqual(CLEAN)
		const embed = node(receipt, "semantic.arm.embed")
		expect(embed!.recoveredAsEmpty).toBe(true)
		expect(embed!.reason).toMatch(/no embedding model is loaded/)
		// Recorded, and nothing else lost: the prompt is what it would have been.
		modelReady = false
		expect(rankedKeys(receipt)).toEqual(rankedKeys(await turn()))
	}, 30_000)
})
