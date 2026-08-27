import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { makeScriptApplier } from "./chains"

/**
 * The cast scope (migration 0146), through the applier.
 *
 * `core:script:cast/transform@1` is the paste-rung half of replaceable cast
 * extraction: scripts over what `core:provider/extract-cast@1` publishes on
 * its `cast` port — rename, merge, drop, add — attached at the node's
 * `castScripts` hook (phase `after`). This pins the two laws the new content
 * scope adds to the fold:
 *
 *  - a cast transform's return folds like any object transform, and
 *  - the shape gate holds: `cast` demands an object, so a script returning an
 *    array is an error application and **the value is kept** (S2 — a typo'd
 *    script must never cost the extraction its cast).
 */

let db: TestDb

const TYPE = "core:script:cast/transform"

async function castScriptRow(name: string, source: string): Promise<number> {
	const [row] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId: `${TYPE}@1`,
			name,
			enabled: true,
			source,
			varsIn: ["cast"],
			varsOut: ["cast"]
		})
		.returning()
	return row.id
}

const site = {
	nodeKey: "extract",
	slot: "castScripts",
	phase: "after",
	port: "cast",
	accepts: [`${TYPE}@1`],
	extras: [],
	origin: "substrate"
} as any

const cast = () => ({
	participants: [{ name: "Commander Vell" }, { name: "V ell" }],
	mentioned: [{ name: "The Ashguard" }]
})

beforeAll(async () => {
	db = await createTestDb()
	// The registry row boot sync projects from the SDK catalog — inserted
	// directly because this test targets the applier, not the projection
	// (`registrySync.int.test.ts` owns that half).
	await db.insert(schema.pipelineTypeRegistry).values({
		typeId: TYPE,
		version: 1,
		kind: "script",
		transport: "node",
		status: "live",
		ports: { in: { cast: {} }, out: { cast: {} } },
		semantics: "transform"
	})
}, 60_000)

describe("a cast transform folds through the chain", () => {
	it("rewrites the cast object and records the application", async () => {
		const id = await castScriptRow(
			"merge the duplicate",
			// Merge the mis-tokenized duplicate the model produced.
			`return {
				...cast,
				participants: cast.participants.filter(
					(p) => p.name !== "V ell"
				)
			}`
		)
		const apply = makeScriptApplier(db, {
			seed: "seed",
			nowMs: 1_000_000
		})
		const r = await apply(site, [id], cast())
		expect((r.value as any).participants).toEqual([
			{ name: "Commander Vell" }
		])
		// Untouched half passes through — the transform folded, not replaced.
		expect((r.value as any).mentioned).toEqual([{ name: "The Ashguard" }])
		expect(r.applications).toMatchObject([
			{ scriptId: id, result: "ok", changed: true }
		])
	})

	it("a non-object return is refused and the cast is kept", async () => {
		const id = await castScriptRow(
			"returns the wrong shape",
			`return cast.participants`
		)
		const apply = makeScriptApplier(db, {
			seed: "seed",
			nowMs: 1_000_000
		})
		const before = cast()
		const r = await apply(site, [id], before)
		expect(r.value).toEqual(before)
		expect(r.applications[0]).toMatchObject({ result: "err" })
		expect((r.applications[0] as any).reason).toMatch(
			/an object was expected/
		)
	})
})
