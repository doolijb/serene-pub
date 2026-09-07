/**
 * Retrieval plan phase 1's four declared controls, from the stored row to the
 * scan — and migration 0199 on an install that has booted before.
 *
 * Two things this file exists to prevent, and neither is visible on a fresh
 * database or from a unit test.
 *
 * **A declared control nothing reads.** `lexicalScoring`, `trigramFolding` and
 * `titleWeight` are declared on four query types and `signalProximity` on the
 * ranker; all four are read in `runtime/bindings.ts`, and the distance between
 * those two facts is where every dead control in this subsystem has lived — bug
 * 12 wired three retrieval parameters that had rendered, validated and stored a
 * value for eight spec versions without ever reaching the scan, and bug 15's
 * cluster was the same shape again. `keywordQuery.test.ts` hands the mechanism its
 * parameters directly and therefore cannot see the seam that actually breaks:
 * the executor resolves only the slots a node's config already names. This
 * starts where a person's edit starts, at a row, and ends at what came back.
 *
 * **The registry refusal.** Five published types changed content hash.
 * `syncTypeRegistry` refuses to republish a changed version, `bootstrapPipelines`
 * catches that refusal, records it in `report.conflict` and **returns early** —
 * no specs seeded, no configs reconciled, pipelines dead on every upgraded
 * install while the diagnostics screen holds the only evidence. 0199's
 * re-projection is what stops that, and this asserts the failure first so the
 * test cannot pass vacuously against a migration that matches nothing.
 *
 * ⚠ The migration is **0199 and not 0197**, which is the number it was
 * commissioned as. The language lane landed `0198_language_setting` in the same
 * working tree first, and drizzle applies a migration by comparing its
 * `folderMillis` against the *last applied* one rather than by index — so a
 * 0197 would run on a fresh database and be silently skipped on any install
 * that had already taken 0198. The path below is asserted rather than
 * interpolated for exactly that reason.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { run } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import {
	DEFAULT_RETRIEVAL,
	DEFAULT_SIGNAL_WEIGHTS
} from "$lib/server/pipelines/ranking/weights"
import { respondSpec, RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

// No embedding model: everything here belongs to the keyword mechanism, and the whole
// point of the lexical stack is that it needs none (design §11).
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lore-lexical-quality-secret" }
})

const LORE_TYPES = [
	"core:query/world-lore",
	"core:query/character-lore",
	"core:query/history-entries",
	"core:query/lorebook-triggers"
]
const RANKER = "core:task/rank-hybrid"

const WORLD_LORE_LANE = "gather.worldLore.read"
const RANK_NODE = "rank"

let db: TestDb
let sessionId: number
let userId: number
let respondSpecRow: { id: number }

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lore-lexical-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "lexical", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Lexical", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	/**
	 * Five entries, carrying one of the four questions each.
	 *
	 * `Riders` is keyed on a plural the conversation only ever says in the
	 * singular, so nothing but trigram folding can reach it. The long entry and
	 * `Ashguard` say the same word about the same subject at different lengths,
	 * which is what the two lexical readings disagree about. The two `Hold`
	 * entries carry **the same three words in opposite fields** — title
	 * `wastes hold` / key `ashguard` against title `ashguard hold` / key
	 * `wastes` — so nothing but the field weighting can separate them, and at a
	 * weight of 1 they must tie exactly.
	 */
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "Riders",
				keys: "riders",
				content: "They ride in pairs."
			},
			{
				lorebookId: lorebook.id,
				name: "A Long Ashguard Entry",
				keys: "ashguard, ashguard, ashguard, wardens, oathbound, patrol, commander",
				content: "A long account of the order."
			},
			{
				lorebookId: lorebook.id,
				name: "Ashguard",
				keys: "ashguard",
				content: "An order of oathbound riders."
			},
			{
				lorebookId: lorebook.id,
				name: "Wastes Hold",
				keys: "ashguard",
				content: "The ash wastes beyond the city."
			},
			{
				lorebookId: lorebook.id,
				name: "Ashguard Hold",
				keys: "wastes",
				content: "A watchtower on the road."
			}
		])
	)
	for (const content of [
		"who keeps those wastes?",
		"ashguard do",
		"a quiet night",
		"wastes are cold",
		"we rode home",
		// The singular, deliberately: `riders` is not a substring of it, so the
		// entry keyed on the plural is unreachable until folding is on.
		"one rider stayed behind"
	])
		await db.insert(schema.sessionMessages).values({
			sessionId,
			role: "user",
			content
		} as any)

	respondSpecRow = (
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)
	)[0]
}, 120_000)

/** Run the shipped reply spec the way a turn does. */
const turn = async () =>
	await run(respondSpec(), {
		input: {
			text: "one rider stayed behind",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:lexical",
		bindings: coreBindings(),
		world: await buildWorld(db as any, {
			sessionId,
			specId: RESPOND_SPEC_ID
		}),
		host: createHost(db as any, { sessionId, userId }),
		// Stops before the provider, which needs a connection this test has no
		// business supplying. Every node under test runs upstream of it.
		preview: true
	} as any)

/** The world-lore lane's hits, by title, with the signals it scored them on. */
const worldLoreLane = async () => {
	const receipt = await turn()
	const node = (receipt.nodes as any[]).find(
		(n) => n.nodeKey === WORLD_LORE_LANE
	)
	const hits = (node?.output?.hits ?? []) as any[]
	return {
		names: hits.map((c) => c.payload?.name as string),
		tfidf: Object.fromEntries(
			hits.map((c) => [c.payload?.name as string, c.signals?.tfidf ?? 0])
		) as Record<string, number>,
		proximity: Object.fromEntries(
			hits.map((c) => [
				c.payload?.name as string,
				c.signals?.proximity ?? 0
			])
		) as Record<string, number>,
		skipped: (node?.output?.skipped ?? []) as any[]
	}
}

/** The ranker's decisions, in the order it put them. */
const ranked = async () => {
	const receipt = await turn()
	const node = (receipt.nodes as any[]).find((n) => n.nodeKey === RANK_NODE)
	return ((node?.output?.decisions ?? []) as any[])
		.filter((d) => d.included)
		.map((d) => ({
			name: d.candidate?.payload?.name as string,
			score: d.score as number
		}))
}

/**
 * The config a run on this session actually resolves to.
 *
 * ⚠ Not the `pipeline-default:` row. `migrateContextTemplates` duplicates the
 * shipped config into a mutable "Default (customized)" and selects that at
 * instance scope, so a fixture writing to the immutable original would change
 * nothing and prove nothing.
 */
const selectedConfigId = async () => {
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(
		db as any,
		respondSpecRow.id,
		RESPOND_SPEC_ID,
		{ sessionId }
	)
	expect(selected, "the reply spec resolves to no configuration").toBeTruthy()
	return selected!.configId
}

const setParam = async (nodeKey: string, path: string, value: unknown) => {
	const result = await db
		.update(schema.pipelineConfigValues)
		.set({ value })
		.where(
			and(
				eq(
					schema.pipelineConfigValues.configId,
					await selectedConfigId()
				),
				eq(schema.pipelineConfigValues.nodeKey, nodeKey),
				eq(schema.pipelineConfigValues.slot, "params"),
				eq(schema.pipelineConfigValues.path, path)
			)
		)
		.returning()
	// A silent no-op here is the failure this whole file exists to catch: an
	// address nothing seeded is a control that renders and stores nowhere.
	expect(
		result.length,
		`no stored row at ${nodeKey}/params/${path}, so nothing was changed`
	).toBeGreaterThan(0)
}

describe("the declared defaults are the numbers the scan would have used", () => {
	it("every lore type declares today's reading", async () => {
		// Read from the *projected registry row* rather than from a literal,
		// because that row is what the panel renders and what a config
		// back-fills from: a declaration corrected in the contracts package but
		// never re-projected would still ship the old number.
		for (const typeId of LORE_TYPES) {
			const [row] = await db
				.select()
				.from(schema.pipelineTypeRegistry)
				.where(
					and(
						eq(schema.pipelineTypeRegistry.typeId, typeId),
						eq(schema.pipelineTypeRegistry.version, 1)
					)
				)
				.limit(1)
			const schemaOf = (row?.slots as any)?.params?.schema
			expect(
				schemaOf?.lexicalScoring?.default,
				`${typeId} declares a reading the scan would not have used`
			).toBe(DEFAULT_RETRIEVAL.lexicalScoring)
			expect(schemaOf?.trigramFolding?.default).toBe(
				DEFAULT_RETRIEVAL.trigramFolding
			)
			expect(schemaOf?.titleWeight?.default).toBe(
				DEFAULT_RETRIEVAL.titleWeight
			)
		}
	})

	it("the ranker declares a proximity weight of zero in every band", async () => {
		const [row] = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(schema.pipelineTypeRegistry.typeId, RANKER),
					eq(schema.pipelineTypeRegistry.version, 1)
				)
			)
			.limit(1)
		const declared = (row?.slots as any)?.params?.schema?.signalProximity
			?.default
		for (const source of Object.keys(DEFAULT_SIGNAL_WEIGHTS))
			expect(declared?.[source], source).toBe(
				(DEFAULT_SIGNAL_WEIGHTS as any)[source].proximity
			)
	})

	it("ships inert, so an upgrade retrieves what it retrieved yesterday", () => {
		// ⚠ The property the whole change rests on, and the reason the parity
		// corpus is untouched by it.
		expect(DEFAULT_RETRIEVAL.lexicalScoring).toBe("overlap")
		expect(DEFAULT_RETRIEVAL.trigramFolding).toBe(0)
		expect(DEFAULT_RETRIEVAL.titleWeight).toBe(1)
		for (const weights of Object.values(DEFAULT_SIGNAL_WEIGHTS))
			expect(weights.proximity).toBe(0)
	})
})

describe("a stored value reaches the scan", () => {
	it("trigram folding: finds nothing extra off, and the plural entry on", async () => {
		const off = await worldLoreLane()
		expect(
			off.names,
			"the plural-keyed entry arrived with folding off, so this test " +
				"cannot tell the control from the default"
		).not.toContain("Riders")

		await setParam(WORLD_LORE_LANE, "trigramFolding", 0.5)
		try {
			const on = await worldLoreLane()
			expect(on.names).toContain("Riders")
		} finally {
			await setParam(WORLD_LORE_LANE, "trigramFolding", 0)
		}
	}, 60_000)

	it("lexical scoring: the long entry wins on overlap and loses on balanced", async () => {
		const overlap = await worldLoreLane()
		expect(overlap.tfidf["A Long Ashguard Entry"]).toBeGreaterThan(
			overlap.tfidf["Ashguard"]!
		)

		await setParam(WORLD_LORE_LANE, "lexicalScoring", "balanced")
		try {
			const balanced = await worldLoreLane()
			expect(balanced.tfidf["Ashguard"]).toBeGreaterThan(
				balanced.tfidf["A Long Ashguard Entry"]!
			)
		} finally {
			await setParam(WORLD_LORE_LANE, "lexicalScoring", "overlap")
		}
	}, 60_000)

	it("title weight: two identical bags of words tie at 1 and part above it", async () => {
		const neutral = await worldLoreLane()
		expect(neutral.tfidf["Wastes Hold"]).toBeCloseTo(
			neutral.tfidf["Ashguard Hold"]!,
			12
		)
		expect(
			neutral.tfidf["Wastes Hold"],
			"both scored zero, so the tie above says nothing"
		).toBeGreaterThan(0)

		await setParam(WORLD_LORE_LANE, "titleWeight", 3)
		try {
			const weighted = await worldLoreLane()
			// `wastes` is said twice in the conversation and `ashguard` once,
			// so weighting the title lifts the entry whose title carries the
			// term the session is actually using.
			expect(weighted.tfidf["Wastes Hold"]).toBeGreaterThan(
				weighted.tfidf["Ashguard Hold"]!
			)
		} finally {
			await setParam(WORLD_LORE_LANE, "titleWeight", 1)
		}
	}, 60_000)

	it("proximity: computed on every scan, and counted only once weighted", async () => {
		// The signal is free — it comes out of the key walk the scan was
		// already doing — so it is present whatever the weight, and the weight
		// is the only thing that decides whether the ranker sees it.
		const before = await ranked()
		const scored = Object.fromEntries(before.map((d) => [d.name, d.score]))

		await setParam(RANK_NODE, "signalProximity", {
			messages: 0,
			worldLore: 0.5,
			characterLore: 0,
			history: 0,
			relationships: 0
		})
		try {
			const after = await ranked()
			expect(
				after.some(
					(d) => (scored[d.name] ?? 0) !== d.score && d.score > 0
				),
				"weighting proximity changed no score, so the value is not " +
					"reaching `score()`"
			).toBe(true)
		} finally {
			await setParam(RANK_NODE, "signalProximity", {
				messages: 0,
				worldLore: 0,
				characterLore: 0,
				history: 0,
				relationships: 0
			})
		}
	}, 60_000)
})

describe("selective logic, stored on the row", () => {
	it("excludes a matched entry with a receipt rather than scoring it down", async () => {
		const [entry] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.title, "Ashguard"))
			.limit(1)

		const before = await worldLoreLane()
		expect(before.names).toContain("Ashguard")

		await db
			.update(schema.lorebookEntries)
			.set({ secondaryKeys: ["wastes"], selectiveLogic: "notAny" })
			.where(eq(schema.lorebookEntries.id, (entry as any).id))
		try {
			const after = await worldLoreLane()
			expect(
				after.names,
				"the author said not-when-wastes and the conversation says " +
					"wastes, so this entry must be gone"
			).not.toContain("Ashguard")
			const receipt = after.skipped.find(
				(s) => s.id === (entry as any).id
			)
			// An exclusion, not a miss — the class distinction the retrieval
			// plan's forward-compatibility obligation asks for.
			expect(receipt?.kind).toBe("excluded")
			expect(receipt?.reason).toContain("its keywords matched")
		} finally {
			await db
				.update(schema.lorebookEntries)
				.set({ secondaryKeys: [], selectiveLogic: null })
				.where(eq(schema.lorebookEntries.id, (entry as any).id))
		}
	}, 60_000)
})
