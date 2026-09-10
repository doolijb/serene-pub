import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { declarations } from "$lib/server/pipelines/config/panel/declarations"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

// The db module is mocked so `defaults.sync()` and `bootstrapPipelines` run
// against the test database, in the order `db/index.ts` guarantees at boot.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "retrieval-mode-cull-secret" }
})

/** The three lore gather branches share a declaration and therefore a hash. */
const LORE_TYPES = [
	"core:query/world-lore",
	"core:query/character-lore",
	"core:query/history-entries"
]
const VECTOR_TYPE = "core:query/vector-search"
const CULLED_TYPES = [...LORE_TYPES, VECTOR_TYPE]

/** The address that goes, on every one of them. */
const CULLED = "retrievalMode"

/**
 * What each declaration keeps, whole — a control arriving unread fails here.
 *
 * ⚠ **This list says a control is DECLARED; it cannot say a control is READ**,
 * and the difference is what an audit later found. `minScore` sat on the vector
 * list below for as long as this file has existed, surviving the cull with a
 * test watching it survive, while no line of engine code anywhere consumed it —
 * and `topK` sat beside it being read off an in-port name the node does not
 * declare. A whole-set assertion catches a control *appearing*; nothing here can
 * catch one that does nothing. `runtime/signalWiring.int.test.ts` is the guard
 * that can, for the ranker's weights, and it works by executing a turn rather
 * than by reading a declaration.
 */
const LORE_PARAMS = [
	"admitThreshold",
	// Declared by migration 0099. The mirror-image defect: engine-read since
	// the scan was written and declared nowhere, so the only value it could
	// hold was a constant. See its note in the contracts package.
	"guaranteedMessages",
	"lexicalScoring",
	"maxRecursionDepth",
	"scanDepth",
	"titleWeight",
	"trigramFolding"
]
/**
 * ⚠ `minScore` was here and is gone (0099), replaced by `similarityFalloff`.
 *
 * Not a rename. A minimum similarity removes a row from the pool, where no
 * other mechanism can find it either; the replacement shapes the semantic
 * signal's contribution and leaves the row where it was, at every setting.
 */
const VECTOR_PARAMS = ["maxEntries", "similarityFalloff", "topK"]

let db: TestDb
let respondSpecRow: { id: number; activeVersionId: number }
/** `nodeKey → typeId`, for the four types, read off the published version. */
let nodesByType = new Map<string, string[]>()

const declaredParams = async (typeId: string) => {
	const decls = await declarations(db, respondSpecRow.activeVersionId)
	const keys = new Set(nodesByType.get(typeId) ?? [])
	return [
		...new Set(
			decls
				.filter((d) => keys.has(d.nodeKey) && d.slot === "params")
				.map((d) => d.path)
		)
	].sort()
}

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-retrieval-mode-cull-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	respondSpecRow = (
		await db
			.select({
				id: schema.pipelineSpecs.id,
				activeVersionId: schema.pipelineSpecs.activeVersionId
			})
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)
	)[0] as any

	// Read from the published version rather than written down here: the node
	// keys are the spec's business and a rename there should not quietly narrow
	// what this file sweeps.
	const nodes = await db
		.select({
			nodeKey: schema.pipelineNodes.nodeKey,
			typeId: schema.pipelineNodes.typeId
		})
		.from(schema.pipelineNodes)
		.where(
			eq(
				schema.pipelineNodes.specVersionId,
				respondSpecRow.activeVersionId
			)
		)
	nodesByType = new Map(
		CULLED_TYPES.map((t) => [
			t,
			(nodes as any[]).filter((n) => n.typeId === t).map((n) => n.nodeKey)
		])
	)
	for (const t of CULLED_TYPES)
		expect(
			nodesByType.get(t)?.length,
			`the reply pipeline has no \`${t}\` node, so this file is sweeping nothing`
		).toBeGreaterThan(0)
}, 120_000)

describe("the four retrieval query types after the cull", () => {
	it("declares no retrieval mode on any mechanism", async () => {
		for (const typeId of CULLED_TYPES) {
			const paths = await declaredParams(typeId)
			expect(
				paths.includes(CULLED),
				`\`${CULLED}\` is still declared on ${typeId}, so the panel is ` +
					`still offering a way to switch a mechanism off in bulk`
			).toBe(false)
		}
	})

	it("keeps exactly the controls that are read, and no more", async () => {
		// Asserted whole rather than per key, on 0195's reason: a control has
		// already arrived on one of these lists ahead of its reader once, and
		// only a whole-set assertion notices that.
		for (const typeId of LORE_TYPES)
			expect(await declaredParams(typeId)).toEqual(LORE_PARAMS)
		expect(await declaredParams(VECTOR_TYPE)).toEqual(VECTOR_PARAMS)
	})
})
