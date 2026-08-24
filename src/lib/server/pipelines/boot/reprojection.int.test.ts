/**
 * A re-projection migration, checked against a database that actually needs it.
 *
 * These migrations (0099, 0106, 0116) delete registry rows so the next boot
 * re-projects them. Nothing had ever tested one, and the way they fail is
 * silent: a fresh test database has no rows to delete, so `DELETE FROM
 * pipeline_type_registry WHERE type_id = '<typo>'` matches nothing, raises
 * nothing, and passes — while on a real instance the stale row survives,
 * `syncTypeRegistry` raises `TypeRegistryConflictError`, `bootstrapPipelines`
 * returns early, and pipelines quietly stop working.
 *
 * So this regresses the row first. If the migration named the wrong type id,
 * the conflict is still there afterwards and this goes red.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync } from "node:fs"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	syncTypeRegistry,
	TypeRegistryConflictError
} from "$lib/server/pipelines/boot/registrySync"
import { allTypes } from "@serene-pub/sdk"
import "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"

let db: TestDb

/** Every re-projection this branch added, and the pins each one claims. */
const CASES = [
	// `0116_graph_context_json_ports.sql` was here. Its type no longer exists —
	// `core:query/graph-context@1` split into the two relationship queries in
	// `0124` — so the case cannot assert that its pin resolves to a real type,
	// and a case that cannot fail is worse than none. `0124` covers the delete.
	{
		migration: "drizzle/0124_relationships_split.sql",
		pins: [{ typeId: "core:task/build-template-context", version: 1 }]
	},
	{
		migration: "drizzle/0118_drop_dead_template_slots.sql",
		pins: [
			{ typeId: "core:query/session-history", version: 1 },
			{ typeId: "core:query/lorebook-triggers", version: 1 },
			{ typeId: "core:provider/generate-text", version: 1 },
			{ typeId: "core:task/render-entries", version: 1 }
		]
	},
	{
		migration: "drizzle/0117_ranking_shares_reprojection.sql",
		pins: [
			{ typeId: "core:task/rank-hybrid", version: 1 },
			{ typeId: "core:task/rank-by-recency", version: 1 },
			{ typeId: "core:task/context-budget", version: 1 },
			{ typeId: "core:task/assemble", version: 2 }
		]
	},
	{
		// Eighteen, because `quick` lands inside `slots` and every type with a
		// prompts, connection or sampling slot carries one now. A list this
		// long is exactly where a typo hides: on a fresh database the registry
		// is empty when migrations run, so a `type_id` that matches nothing
		// deletes nothing and passes.
		migration: "drizzle/0119_quick_settings_reprojection.sql",
		pins: [
			{ typeId: "chariot.comfy:render-image", version: 1 },
			{ typeId: "core:provider/embed-text", version: 1 },
			{ typeId: "core:provider/extract-cast", version: 1 },
			{ typeId: "core:provider/generate-text", version: 1 },
			{ typeId: "core:provider/graph-node-description", version: 1 },
			{ typeId: "core:provider/graph-node-resolution", version: 1 },
			{ typeId: "core:provider/graph-perspective", version: 1 },
			{ typeId: "core:provider/graph-pre-filter", version: 1 },
			{ typeId: "core:provider/graph-state-detection", version: 1 },
			{ typeId: "core:provider/mcp-tool", version: 1 },
			{ typeId: "core:provider/name-entry", version: 1 },
			{ typeId: "core:provider/speak", version: 1 },
			{ typeId: "core:provider/summarize-batch", version: 1 },
			{ typeId: "core:provider/summarize-synth", version: 1 },
			{ typeId: "core:task/assemble", version: 2 },
			{ typeId: "core:task/build-narrator-context", version: 1 },
			{ typeId: "core:task/build-template-context", version: 1 },
			{ typeId: "core:task/context-budget", version: 1 }
		]
	},
	{
		migration: "drizzle/0121_lore_optional_reprojection.sql",
		pins: [
			{ typeId: "core:query/world-lore", version: 1 },
			{ typeId: "core:query/character-lore", version: 1 }
		]
	},
	{
		migration: "drizzle/0122_retrieval_mode_and_ranking_floors.sql",
		pins: [
			{ typeId: "core:input/user-message", version: 1 },
			{ typeId: "core:query/world-lore", version: 1 },
			{ typeId: "core:query/character-lore", version: 1 },
			{ typeId: "core:query/vector-search", version: 1 },
			{ typeId: "core:query/session-history", version: 1 },
			{ typeId: "core:task/rank-hybrid", version: 1 },
			{ typeId: "core:task/rank-by-recency", version: 1 }
		]
	}
] as const

const rowFor = async (PIN: { typeId: string; version: number }) => {
	const [row] = await db
		.select()
		.from(schema.pipelineTypeRegistry)
		.where(
			and(
				eq(schema.pipelineTypeRegistry.typeId, PIN.typeId),
				eq(schema.pipelineTypeRegistry.version, PIN.version)
			)
		)
	return row
}

beforeAll(async () => {
	db = await createTestDb()
	await syncTypeRegistry(db as any, allTypes(), { release: "0.6.0" })
}, 60_000)

for (const { migration, pins } of CASES)
	describe(`${migration.split("/")[1]} re-projects what it names`, () => {
		it("the rows exist to begin with, so the rest is not vacuous", async () => {
			for (const pin of pins)
				expect(
					await rowFor(pin),
					`${pin.typeId}@${pin.version}`
				).toBeTruthy()
		})

		it("a stale row conflicts, which is the failure this migration exists for", async () => {
			// What an instance that booted the previous build looks like: the
			// rows are snapshots of declarations that no longer exist.
			for (const pin of pins)
				await db
					.update(schema.pipelineTypeRegistry)
					.set({ contentHash: "stale-from-the-previous-build" })
					.where(
						and(
							eq(schema.pipelineTypeRegistry.typeId, pin.typeId),
							eq(schema.pipelineTypeRegistry.version, pin.version)
						)
					)

			await expect(
				syncTypeRegistry(db as any, allTypes(), { release: "0.6.0" })
			).rejects.toBeInstanceOf(TypeRegistryConflictError)
		})

		it("running it clears those rows, and the next sync re-projects them", async () => {
			// Split on drizzle's own breakpoint marker, because `execute`
			// takes one statement — a multi-statement migration handed over
			// whole fails with "cannot insert multiple commands into a
			// prepared statement", which is a harness limitation reading as a
			// migration defect.
			for (const stmt of readFileSync(migration, "utf8")
				.split("--> statement-breakpoint")
				.map((x) => x.trim())
				.filter(Boolean))
				await db.execute(stmt)
			for (const pin of pins)
				expect(
					await rowFor(pin),
					`the migration did not match ${pin.typeId}@${pin.version}`
				).toBeFalsy()

			const r = await syncTypeRegistry(db as any, allTypes(), {
				release: "0.6.0"
			})
			for (const pin of pins) {
				expect(r.inserted).toContain(`${pin.typeId}@${pin.version}`)
				const row = await rowFor(pin)
				expect(row).toBeTruthy()
				expect(row!.contentHash).not.toBe(
					"stale-from-the-previous-build"
				)
			}
		})

		it("is idempotent afterwards, which is what boot depends on", async () => {
			const again = await syncTypeRegistry(db as any, allTypes(), {
				release: "0.6.0"
			})
			expect(again.inserted).toEqual([])
			expect(again.unchanged.length).toBeGreaterThan(20)
		})
	})
