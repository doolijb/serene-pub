/**
 * What startup puts in the pipeline tables, and what it does twice.
 *
 * Boot code is the code least likely to be exercised deliberately and most
 * likely to run on someone's machine at 2am after an upgrade. The properties
 * worth holding are all about the *second* run: the same build booting again
 * must change nothing, and a build whose types moved under a stored document
 * must refuse rather than reconcile.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	bootstrapPipelines,
	loadPublished,
	respondSpec,
	CHAT_RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
import { CORE_SPECS } from "$lib/server/pipelines/specs"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

describe("bootstrapping the pipeline tables", () => {
	it("registers the types and publishes core's spec on a fresh install", async () => {
		const report = await bootstrapPipelines(db)
		expect(report.types.inserted).toBeGreaterThan(0)
		expect(report.types.republished).toEqual([])
		// Every pipeline core ships, published once, each with nothing to
		// reconcile: the shipped default is created here and there are no tuned
		// configs yet to cull or back-fill.
		expect(report.specs.length).toBe(CORE_SPECS.length)
		for (const s of report.specs) {
			expect(s.action).toBe("published")
			expect(s.reconciled).toEqual([])
		}
		expect(report.specs.map((s) => s.id)).toContain(CHAT_RESPOND_SPEC_ID)
	}, 60_000)

	it("changes nothing on the next boot", async () => {
		// The property that matters most, because it runs on every restart. A
		// bootstrap that re-published would either orphan a run's history or
		// grow the table by one row per restart until somebody noticed.
		const before = await db.select().from(schema.pipelineSpecVersions)
		const report = await bootstrapPipelines(db)
		const after = await db.select().from(schema.pipelineSpecVersions)

		expect(report.types.inserted).toBe(0)
		expect(report.specs[0]!.action).toBe("present")
		expect(after).toHaveLength(before.length)
	})

	it("publishes a document that loads back and runs", async () => {
		// Round-tripping is the real assertion: a spec that saved but cannot be
		// loaded is a table full of rows nobody can execute.
		const doc = await loadPublished(db, CHAT_RESPOND_SPEC_ID)
		expect(doc).toBeTruthy()
		expect(doc!.nodes.map((n: any) => n.key)).toEqual(
			respondSpec().nodes.map((n: any) => n.key)
		)
	})

	it("binds every core genre to its own turn-order spec (R27, M2)", async () => {
		const { resolveSessionEventSpec } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const { TURN_ORDER_BY_GENRE } = await import("@serene-pub/core-catalog")
		// Chat, Adventure, Guide and the Lair.
		expect(TURN_ORDER_BY_GENRE.length).toBe(4)
		for (const { genre, spec, events } of TURN_ORDER_BY_GENRE)
			for (const event of events)
				expect(
					await resolveSessionEventSpec(db, genre.id, event),
					`${genre.id} on ${event}`
				).toBe(spec)
	})

	it("heals a present version whose nodes lost their expose mark (0155 arrived after the mark)", async () => {
		const [spec] = await db
			.select({ activeVersionId: schema.pipelineSpecs.activeVersionId })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/chat-turn-order"))
		const { and: andOp } = await import("drizzle-orm")
		const strategy = andOp(
			eq(schema.pipelineNodes.specVersionId, spec!.activeVersionId!),
			eq(schema.pipelineNodes.nodeKey, "decide.rules.strategy")
		)
		await db.update(schema.pipelineNodes).set({ expose: null }).where(strategy)
		await bootstrapPipelines(db)
		const [node] = await db
			.select({ expose: schema.pipelineNodes.expose })
			.from(schema.pipelineNodes)
			.where(strategy)
		expect(node!.expose?.swaps?.length).toBe(5)
	})

	it("finds nothing for a spec nobody published", async () => {
		expect(await loadPublished(db, "core:spec/nonexistent")).toBe(
			null
		)
	})

	it("republishes rather than stopping when the rows disagree with the build", async () => {
		// Every row carrying a hash that no longer matches the running code is
		// exactly what an upgrade with a changed declaration looks like — and it
		// used to end the boot: `TypeRegistryConflictError` was caught here,
		// `report.conflict` was set, and the function returned before publishing
		// a single spec. So a descriptor edit disabled pipelines on every
		// install that had booted the previous build.
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ contentHash: "tampered" })

		const report = await bootstrapPipelines(db)
		expect(report.types.republished.length).toBeGreaterThan(0)
		// The half that says the boot went on: the specs are still seeded.
		expect(report.specs.length).toBe(CORE_SPECS.length)
	})
})
