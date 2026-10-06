import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { declarations } from "$lib/server/pipelines/config/panel/declarations"
import { CHAT_NARRATE_SPEC_ID } from "$lib/server/pipelines/specs"

// The db module is mocked so `defaults.sync()` and `bootstrapPipelines` run
// against the test database, in the order `db/index.ts` guarantees at boot.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lorebook-trigger-controls-secret" }
})

/** The narrator's lore node, the one core node of this type. */
const LORE = "lore"
/** The four addresses that stop being declared. */
const CULLED = ["caseSensitive", "weight", "minInclude", "useRegex"]

let db: TestDb
let narrateSpecRow: { id: number; activeVersionId: number }

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lorebook-trigger-controls-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	narrateSpecRow = (
		await db
			.select({
				id: schema.pipelineSpecs.id,
				activeVersionId: schema.pipelineSpecs.activeVersionId
			})
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_NARRATE_SPEC_ID))
			.limit(1)
	)[0] as any
}, 120_000)

describe("the narrator's lore node after the change", () => {
	it("declares a ceiling the engine reads, spelled the way it reads it", async () => {
		// The one-letter bug, as an assertion. `retrievalParamsFrom` looks for
		// `maxRecursionDepth`; this node declared `recursionDepth`, so the
		// number it stored was handed to nothing and the narrator scanned on
		// `DEFAULT_RETRIEVAL` whatever anybody typed.
		const decls = await declarations(db, narrateSpecRow.activeVersionId)
		const paths = decls
			.filter((d) => d.nodeKey === LORE && d.slot === "params")
			.map((d) => d.path)
			.sort()

		expect(paths).toContain("maxRecursionDepth")
		expect(
			paths,
			"the old spelling is still declared, so the panel is offering a " +
				"ceiling nothing reads"
		).not.toContain("recursionDepth")
	})

	it("declares none of the four controls nothing read", async () => {
		const decls = await declarations(db, narrateSpecRow.activeVersionId)
		const paths = new Set(
			decls
				.filter((d) => d.nodeKey === LORE && d.slot === "params")
				.map((d) => d.path)
		)
		for (const dead of CULLED)
			expect(
				paths.has(dead),
				`\`${dead}\` is still declared on a node that never reads it`
			).toBe(false)

		// And what is left is exactly the live set — asserted whole rather than
		// per key, so a control arriving without a reader fails here. It has
		// already done that once: 0199's three lexical-quality additions landed
		// on this list before their reader did, which is the whole reason the
		// assertion is whole rather than per key. Every name below is read by
		// `retrievalParamsFrom`, and `loreLexicalQuality.int.test.ts` is what
		// proves each one changes what a run retrieves.
		expect([...paths].sort()).toEqual([
			"admitThreshold",
			// The three bands' intents (R-7 P5; U3b review W1), namespaced
			// because one node declares three: `bandIntentFrom` reads each
			// trio into one band intent the handler publishes, and
			// `signalWiring.int.test.ts`'s narrate case proves a stored value
			// reaches the ranker declared rather than defaulted.
			"characterLoreMaxEntries",
			"characterLorePriority",
			"characterLoreShare",
			// Added by 0099, and it is the same argument arriving from the
			// other side: this one was READ before it was declared — the
			// narrator's lore runs through `keywordQuery` too, where
			// `guaranteedMessages` set two live signals' windows while holding
			// a constant no panel could reach. `runtime/loreScanDepth.int.test.ts`
			// is what proves a stored value reaches this lane.
			"guaranteedMessages",
			"historyMaxEntries",
			"historyPriority",
			"historyShare",
			"lexicalScoring",
			"maxRecursionDepth",
			"scanDepth",
			"titleWeight",
			"trigramFolding",
			"worldLoreMaxEntries",
			"worldLorePriority",
			"worldLoreShare"
		])
	})
})
