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
	RESPOND_SPEC_ID
} from "./bootstrap"
import * as schema from "$lib/server/db/schema"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

describe("bootstrapping the pipeline tables", () => {
	it("registers the types and publishes core's spec on a fresh install", async () => {
		const report = await bootstrapPipelines(db as any)
		expect(report.conflict).toBeUndefined()
		expect(report.types.inserted).toBeGreaterThan(0)
		expect(report.specs).toEqual([
			{ id: RESPOND_SPEC_ID, version: "1.0.0", action: "published" }
		])
	})

	it("changes nothing on the next boot", async () => {
		// The property that matters most, because it runs on every restart. A
		// bootstrap that re-published would either orphan a run's history or
		// grow the table by one row per restart until somebody noticed.
		const before = await db.select().from(schema.pipelineSpecVersions)
		const report = await bootstrapPipelines(db as any)
		const after = await db.select().from(schema.pipelineSpecVersions)

		expect(report.types.inserted).toBe(0)
		expect(report.specs[0]!.action).toBe("present")
		expect(after).toHaveLength(before.length)
	})

	it("publishes a document that loads back and runs", async () => {
		// Round-tripping is the real assertion: a spec that saved but cannot be
		// loaded is a table full of rows nobody can execute.
		const doc = await loadPublished(db as any, RESPOND_SPEC_ID)
		expect(doc).toBeTruthy()
		expect(doc!.nodes.map((n: any) => n.key)).toEqual(
			respondSpec().nodes.map((n: any) => n.key)
		)
	})

	it("finds nothing for a spec nobody published", async () => {
		expect(await loadPublished(db as any, "core:spec/nonexistent")).toBe(
			null
		)
	})

	it("reports a registry conflict instead of taking the instance down", async () => {
		// A type-hash conflict means *pipelines* cannot run safely. It does not
		// mean the chat app cannot start, and refusing to boot over a subsystem
		// nobody has opted into would be the wrong trade — so it travels in the
		// report where a diagnostics screen can show it.
		// Every row: a hash that no longer matches the running code is exactly
		// what an upgrade with a changed port list looks like.
		await db
			.update(schema.pipelineTypeRegistry)
			.set({ contentHash: "tampered" })

		const report = await bootstrapPipelines(db as any)
		expect(report.conflict).toMatch(/./)
		expect(report.specs).toEqual([])
	})
})
