/**
 * **A plugin retrieval source participates with no ranker edit** — the whole
 * point of 16 §5a ("Queries declare, the ranker resolves"; R-7 P5, built
 * 2026-09-16, plans/30 U3b), held as a conformance-style case.
 *
 * A definition core has never heard of — `test:query/deep-lore@1`, a plugin's
 * — declares its own `share`, `maxEntries` and `priority`, publishes them as a
 * band intent at the head of its candidates, and is concatenated into the
 * pool beside the shipped sources. `core:task/rank-hybrid@1` — whose
 * declaration names no `deep` band anywhere — resolves a `deep` band from the
 * intent, allocates it the share it asked for, ranks and includes its
 * candidates, and reports it on the receipt. Turning its share to zero
 * excludes them with the reason a switched-off source gets. Nothing in the
 * ranker's declaration, handler or tables was touched to make any of that so;
 * the test asserts that too, off the shipped descriptor.
 *
 * ## Why the shape is what it is
 *
 * The run is a reduced `respond`: the inlet, a gather of the conversation,
 * one lore lane and the plugin source, the budget, the concat, the ranker —
 * everything through the real executor, the real bindings and the real host
 * against a seeded session, stopped where the ranker's output is the
 * observable. A second copy of the whole reply document would prove nothing
 * more about the ranker and would tie this case to every node the reply
 * grows.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import {
	run,
	compile,
	spec,
	slot,
	ok,
	pin,
	describeQueryDefinition,
	bandIntent,
	splitCandidates,
	S,
	type Bindings
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"

/**
 * The plugin's definition. Its own band — `deep` — and its own intent, in the
 * same vocabulary the five core sources use, because that vocabulary is the
 * SDK's (`BandIntentFields`), not the ranker's.
 */
const deepLore = pin(
	describeQueryDefinition({
		id: "test:query/deep-lore@1",
		i18n: { name: { en: "Deep lore (a plugin's)" } },
		timeoutMs: 2000,
		optional: true,
		slots: {
			params: {
				kind: "parameters",
				facet: "weights",
				schema: {
					share: {
						type: "number",
						min: 0,
						default: 0.25,
						i18n: { en: "Share — deep lore" }
					},
					maxEntries: { type: "integer", min: 0, default: 2 },
					priority: {
						type: "enum",
						of: ["low", "normal", "high", "always"],
						default: "normal"
					}
				}
			}
		},
		ports: {
			in: { scope: S.sessionScope },
			out: { main: S.candidates }
		}
	})
)

/** What the plugin found: three entries, one of them over the ceiling. */
const DEEP = [
	{ id: "d1", name: "The Drowned Archive", tokens: 40, score: 0.9 },
	{ id: "d2", name: "Salt Vaults", tokens: 40, score: 0.8 },
	{ id: "d3", name: "The Bell Under the Bay", tokens: 40, score: 0.7 }
]

const pluginBinding: Bindings = {
	"test:query/deep-lore@1": async (input: any) => {
		const p = input?.params ?? {}
		const main = [
			bandIntent("deep", {
				share: p.share,
				maxEntries: p.maxEntries,
				priority: p.priority
			}),
			...DEEP.map((d, position) => ({
				id: d.id,
				source: "deep",
				tokens: d.tokens,
				signals: {},
				presetScore: d.score,
				position,
				payload: { id: d.id, name: d.name, content: d.name }
			}))
		]
		return ok({ main })
	}
}

/** A reduced `respond`: gather → budget → concat → rank, and stop. */
const testSpec = () =>
	compile(
		spec("test:spec/plugin-source", { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.gather("gather", { mode: "parallel" }, (b) =>
				b
					.chain("history", (c) =>
						c.query("read", ($) =>
							C.sessionHistory.v1({
								scope: $.input.sessionScope,
								params: slot.params()
							})
						)
					)
					.chain("worldLore", (c) =>
						c.query("read", ($) =>
							C.worldLore.v1({
								scope: $.input.sessionScope,
								params: slot.params()
							})
						)
					)
					.chain("deep", (c) =>
						c.query("read", ($) =>
							deepLore.v1({
								scope: $.input.sessionScope,
								params: slot.params()
							})
						)
					)
			)
			.task("contextBudget", ($) =>
				C.contextBudget.v1({ params: slot.params() })
			)
			.task("lore", ($) =>
				C.concatCandidates.v1({
					sources: [
						$.gather.history.read.band,
						$.gather.worldLore.read.main,
						$.gather.deep.read.main
					] as any
				})
			)
			.task("rank", ($) =>
				C.rankHybrid.v1({
					candidates: $.lore.candidates,
					budget: $.contextBudget.available,
					params: slot.params()
				})
			)
			.build()
	)

let db: TestDb
let sessionId: number
let userId: number

beforeAll(async () => {
	db = await createTestDb()
	const [user] = await db
		.insert(schema.users)
		.values({ username: "plugin-source", isAdmin: false })
		.returning()
	userId = user.id
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Shallow", userId })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard Riders",
				keys: "ashguard",
				content: "An order of oathbound riders who keep the long roads.",
				priority: 1
			}
		])
	)
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "Have you seen the ashguard near the bay?"
	} as any)
}, 60_000)

/** One run, with the plugin's params overridden as a session would. */
const turn = async (deepParams: Record<string, unknown> = {}) => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db, { sessionId })
	for (const [path, value] of Object.entries(deepParams))
		world.overrides.push({
			nodeKey: "gather.deep.read",
			slot: "params",
			path,
			value,
			scopeKind: "session"
		} as any)
	return (await run(testSpec(), {
		world,
		input: {
			text: "Have you seen the ashguard near the bay?",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:plugin-source",
		bindings: { ...coreBindings(), ...pluginBinding },
		host: createHost(db, { sessionId, userId })
	} as any)) as any
}

const node = (receipt: any, key: string) =>
	receipt.nodes.find((n: any) => n.nodeKey === key)

describe("a plugin retrieval source, ranked with no ranker edit", () => {
	/**
	 * Half of "no ranker edit" is provable here — the declaration names no
	 * `deep` and carries none of the three maps. The other half — that the
	 * ranker's declaration did not MOVE to admit the plugin — is the hash pin
	 * for `core:task/rank-hybrid@1` in `boot/registryHashes.test.ts`: a
	 * declaration that changed to make this pass would move that pin, and
	 * the pin's "(was …)" ledger records the one time it did (R-7 P5, when
	 * the maps left), which is what this case rests on.
	 */
	it("the ranker's declaration knows nothing of the band", () => {
		const params = (C.rankHybrid.descriptor.slots?.params?.schema ??
			{}) as Record<string, unknown>
		for (const gone of ["share", "maxEntries", "minEntries"])
			expect(gone in params, `${gone} is back on the ranker`).toBe(false)
		expect(JSON.stringify(C.rankHybrid.descriptor)).not.toMatch(/deep/)
	})

	it("resolves the plugin's band from its intent, allocates its share and includes its entries", async () => {
		const receipt = await turn()
		expect(receipt.outcome).toBe("ok")
		const rank = node(receipt, "rank")
		expect(rank?.result).toBe("ok")

		// The pool the ranker was handed carried the plugin's intent — through
		// the concat, ahead of the items — and the ranker read it.
		const pool = node(receipt, "lore")?.output?.candidates ?? []
		expect(
			splitCandidates(pool).intents.map((i) => i.band).sort()
		).toEqual(["deep", "messages", "worldLore"])
		expect(rank.output.diagnostics.declared).toContain("deep")
		expect(rank.output.diagnostics.bands.share.deep).toBe(0.25)
		expect(rank.output.diagnostics.bands.maxEntries.deep).toBe(2)

		// A `deep` band on the receipt, with a slice of the window.
		const groups = rank.output.groups
		expect(groups.deep).toBeTruthy()
		expect(groups.deep.allocated).toBeGreaterThan(0)
		expect(groups.deep.cap).toBe(2)

		// Its entries were ranked and the ceiling it declared was honoured:
		// two in by score, the third out as over the cap.
		const decisions: any[] = rank.output.decisions
		const deep = decisions.filter((d) => d.candidate.source === "deep")
		expect(deep.map((d) => [d.candidate.id, d.included, d.reason])).toEqual([
			["d1", true, "filled_scored"],
			["d2", true, "filled_scored"],
			["d3", false, "excluded_budget"]
		])
		expect(deep[2].why).toMatch(/maximum of 2 entries/)

		// The core bands are untouched by the newcomer's presence: the
		// conversation's slice is still the one its own source declared.
		expect(rank.output.diagnostics.bands.share.messages).toBe(0.5)
		expect(rank.output.diagnostics.bands.share.worldLore).toBe(0.1667)
	}, 60_000)

	it("a zero share switches the plugin's source off, with the source's own reason", async () => {
		const receipt = await turn({ share: 0 })
		const rank = node(receipt, "rank")
		const deep = (rank.output.decisions as any[]).filter(
			(d) => d.candidate.source === "deep"
		)
		expect(deep.length).toBe(3)
		for (const d of deep) {
			expect(d.included).toBe(false)
			expect(d.reason).toBe("excluded_group_disabled")
		}
		expect(rank.output.groups.deep.allocated).toBe(0)
	}, 60_000)

	it("`always` keeps every entry the window can hold, ahead of the scored fill — up to the band's cap", async () => {
		const receipt = await turn({ priority: "always", maxEntries: 1 })
		const rank = node(receipt, "rank")
		const deep = (rank.output.decisions as any[]).filter(
			(d) => d.candidate.source === "deep"
		)
		// Ahead of the fill AND against the cap (U3b review S1): a band on
		// `always` is taken the way a pin is, but `maxEntries` says on its
		// own label that it applies "whatever its share", and a priority is
		// not a way round it. One reserved in score order; the other two out
		// with the cap's reason, not re-offered to the scored pass.
		expect(deep.map((d) => [d.candidate.id, d.reason])).toEqual([
			["d1", "reserved_priority"],
			["d2", "excluded_budget"],
			["d3", "excluded_budget"]
		])
		expect(deep[1].why).toMatch(/always be included, but already has its maximum of 1/)
		expect(rank.output.groups.deep.entries).toBe(1)
	}, 60_000)

	it("`always` with no cap keeps every entry the window can hold", async () => {
		const receipt = await turn({ priority: "always", maxEntries: 5 })
		const rank = node(receipt, "rank")
		const deep = (rank.output.decisions as any[]).filter(
			(d) => d.candidate.source === "deep"
		)
		expect(deep.map((d) => [d.candidate.id, d.reason])).toEqual([
			["d1", "reserved_priority"],
			["d2", "reserved_priority"],
			["d3", "reserved_priority"]
		])
	}, 60_000)

	it("a band nothing declared and nothing defaults is excluded loudly, not defaulted silently", async () => {
		// The other half of the law: a candidate with a band and NO intent
		// anywhere — a plugin that forgot to publish one — has no share to
		// compete in and says so on the receipt, rather than borrowing a
		// number from a table on the ranker.
		const forgetful: Bindings = {
			"test:query/deep-lore@1": async () =>
				ok({
					main: [
						{
							id: "x1",
							source: "forgotten",
							tokens: 10,
							signals: {},
							presetScore: 1
						}
					]
				})
		}
		const { buildWorld } = await import("$lib/server/pipelines/config/world")
		const receipt: any = await run(testSpec(), {
			world: await buildWorld(db, { sessionId }),
			input: {
				text: "again",
				sessionId,
				characterId: null,
				sessionScope: { sessionId, currentCharacterId: null }
			},
			seed: "seed:plugin-source-forgot",
			bindings: { ...coreBindings(), ...forgetful },
			host: createHost(db, { sessionId, userId })
		} as any)
		const d = (node(receipt, "rank").output.decisions as any[]).find(
			(x) => x.candidate.id === "x1"
		)
		expect(d.reason).toBe("excluded_unknown_source")
		expect(node(receipt, "rank").output.groups.forgotten).toBeUndefined()
	}, 60_000)
})
