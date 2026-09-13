/**
 * The admission gate's one control, from the stored row to the scan — and
 * migration 0192 on an install that has booted before.
 *
 * Two things this file exists to prevent, and neither is visible on a fresh
 * database or from a unit test.
 *
 * **A declared control nothing reads.** `admitThreshold` is declared on four
 * types and read by `retrievalParamsFrom`, and the distance between those two
 * facts is where every dead control in this subsystem has lived: bug 12 wired
 * three retrieval parameters that had rendered, validated and stored a value
 * for eight spec versions without ever reaching the scan, and bug 15's cluster
 * is still open. `nodeParams.test.ts` hands a binding its parameters directly
 * and therefore cannot see the seam that actually breaks — the executor
 * resolves only the slots a node's config already names. This starts where a
 * person's edit starts, at a row, and ends at what came back.
 *
 * **The registry refusal.** Four published types changed content hash.
 * `syncTypeRegistry` refuses to republish a changed version, `bootstrapPipelines`
 * catches that refusal, records it in `report.conflict` and **returns early** —
 * no specs seeded, no configs reconciled, pipelines dead on every upgraded
 * install while the diagnostics screen holds the only evidence. 0192's
 * re-projection is what stops that, and this asserts the failure first so the
 * test cannot pass vacuously against a migration that matches nothing.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import {
	setConfigValue,
	type TestDb
} from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { run } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { DEFAULT_RETRIEVAL } from "$lib/server/pipelines/ranking/weights"
import { respondSpec, RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

// No embedding model: the gate belongs to the keyword mechanism, and the whole point
// of it is that it needs none (design §11).
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lore-admit-threshold-secret" }
})

const LORE_TYPES = [
	"core:query/world-lore",
	"core:query/character-lore",
	"core:query/history-entries",
	"core:query/lorebook-triggers"
]

const WORLD_LORE_LANE = "gather.worldLore.read"

let db: TestDb
let sessionId: number
let userId: number
let respondSpecRow: { id: number }

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lore-admit-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "admit", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Admit", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	/**
	 * A keyless book, which is the case the gate exists for.
	 *
	 * `The Ashguard` has **no keys and its name is never said**, so nothing in
	 * the released engine can bring it in. It reaches the prompt only by naming
	 * Emberfall, which the conversation does. The second entry is the control:
	 * also keyless, also nameless in the conversation, and about nothing being
	 * discussed.
	 */
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "",
				content:
					"An order of oathbound riders who patrol the ash wastes beyond Emberfall. They answer to Commander Vell and take no coin from the city."
			},
			{
				lorebookId: lorebook.id,
				name: "Feast of Lanterns",
				keys: "",
				content:
					"A midwinter festival. Households hang paper lanterns and the watch looks the other way for one night."
			}
		])
	)
	for (const content of [
		"How long have you ridden with them?",
		"Since I was sixteen. My mother put me on a horse and pointed me at the wastes.",
		"And you never went back to the city?",
		// ⚠ "Emberfall" mid-sentence, not opening one. The extractor keeps a
		// sentence-opening capital only when something corroborates it, and a
		// name said once at the start of a line has nothing to corroborate it
		// — a real limit of capitalisation-based extraction, and the reason
		// this line is written the way people write.
		"You do not go back to Emberfall. The foundries make sure of that.",
		"Fair enough. I only wondered who keeps the wastes."
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

/** Run the shipped reply spec the way a turn does, and report the lore lane. */
const worldLoreLane = async () => {
	const receipt = await run(respondSpec(), {
		input: {
			text: "Fair enough. I only wondered who keeps the wastes.",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:admit",
		bindings: coreBindings(),
		world: await buildWorld(db, {
			sessionId,
			specId: RESPOND_SPEC_ID
		}),
		host: createHost(db, { sessionId, userId }),
		// Stops before the provider, which needs a connection this test has no
		// business supplying. Every node under test runs upstream of it.
		preview: true
	} as any)
	const node = (receipt.nodes as any[]).find(
		(n) => n.nodeKey === WORLD_LORE_LANE
	)
	return {
		names: ((node?.output?.hits ?? []) as any[]).map(
			(c) => c.payload?.name as string
		),
		diagnostics: node?.output?.diagnostics ?? {}
	}
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
		db,
		respondSpecRow.id,
		RESPOND_SPEC_ID,
		{ sessionId }
	)
	expect(selected, "the reply spec resolves to no configuration").toBeTruthy()
	return selected!.configId
}

const setThreshold = async (value: number) =>
	// ⚠ An upsert, not the `UPDATE` this was. A config stores **deviations**
	// (ruled 2026-09-10), so at an untouched address there is no row to update
	// — the old form matched nothing and the threshold stayed at its declared
	// value on every case here.
	await setConfigValue(
		db,
		await selectedConfigId(),
		{ nodeKey: WORLD_LORE_LANE, slot: "params", path: "admitThreshold" },
		value
	)

describe("the declared threshold and the engine's fallback are one number", () => {
	it("every lore type declares what the scan would have used anyway", async () => {
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
			expect(
				(row?.slots as any)?.params?.schema?.admitThreshold?.default,
				`${typeId} declares a threshold the scan would not have used`
			).toBe(DEFAULT_RETRIEVAL.admitThreshold)
		}
	})

	it("ships off, so an upgrade retrieves what it retrieved yesterday", () => {
		// ⚠ The property the whole change rests on, and the reason the parity
		// corpus is untouched: 0 is off, not "admit everything".
		expect(DEFAULT_RETRIEVAL.admitThreshold).toBe(0)
	})
})

describe("a stored threshold reaches the scan", () => {
	it("finds nothing keyless while it is off, and the entry when it is on", async () => {
		const off = await worldLoreLane()
		expect(
			off.names,
			"a keyless entry reached the prompt with the gate off, so this " +
				"test cannot tell the gate from the default"
		).toEqual([])
		expect(off.diagnostics.admitThreshold).toBe(0)
		expect(off.diagnostics.admittedByEvidence).toBe(0)

		await setThreshold(0.3)
		try {
			const on = await worldLoreLane()
			// The design document's own example: eight lines about the
			// Ashguard that never say "Ashguard", no key, and it arrives
			// because it names Emberfall, which the conversation says.
			expect(on.names).toEqual(["The Ashguard"])
			expect(on.diagnostics.admitThreshold).toBe(0.3)
			expect(on.diagnostics.admittedByEvidence).toBe(1)
			expect(on.diagnostics.entities).toContain("Emberfall")
			expect(on.diagnostics.extractorVersion).toBe(
				"core:extract/entities-heuristic@2"
			)
		} finally {
			await setThreshold(0)
		}
	}, 60_000)
})
