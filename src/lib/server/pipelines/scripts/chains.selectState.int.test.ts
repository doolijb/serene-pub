/**
 * 🚧 A `select` script is handed the session's **state** (PLAN-sheet §17,
 * audit A8): the Dungeon Crawler's round script reads each seat's fate off
 * the state rows (`ctx.state`) rather than an annex copy. The host reads it
 * only when a link declares `state`, and only at a turn-order `select`
 * point; a link elsewhere is never handed it.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { makeScriptApplier, siteExtrasOf } from "./chains"

const SELECT = "core:script:turn/select@1"
let db: TestDb

const selectSite = {
	nodeKey: "order",
	slot: "scripts",
	phase: "before",
	port: "select",
	accepts: [SELECT],
	extras: ["session"],
	origin: "binding"
} as any

beforeAll(async () => {
	db = await createTestDb()
	// Only the script types' registry rows: the applier reads a link's type
	// off them. (The whole bootstrap seeds every core spec, which this
	// does not need.)
	await import("@serene-pub/core-catalog")
	const { allDefinitions, allScriptKinds } = await import("@serene-pub/sdk")
	const { syncDefinitionRegistry } = await import("$lib/server/pipelines/boot/registrySync")
	await syncDefinitionRegistry(db, [...allDefinitions(), ...allScriptKinds()], { release: "test", complete: true } as any)
}, 120_000)

describe("siteExtrasOf", () => {
	it("adds `state` at a select point only", () => {
		expect(siteExtrasOf(selectSite)).toEqual(["session", "state"])
		expect(siteExtrasOf({ accepts: ["core:script:text/transform@1"], extras: ["session"] })).toEqual(["session"])
	})
})

describe("the state reaches a select link that declares it", () => {
	it("reads it lazily, at the application, and not for a link that does not declare it", async () => {
		const [row] = await db
			.insert(schema.pipelineScripts)
			.values({
				typeId: SELECT,
				name: "who is out",
				enabled: true,
				source: `var out = ctx.state && ctx.state.cast && ctx.state.cast.byId && ctx.state.cast.byId.ann;
return { order: selection.order, note: out ? out.fate : "no state" };`,
				varsIn: ["selection", "state"],
				varsOut: ["selection"]
			})
			.returning()
		let reads = 0
		const apply = makeScriptApplier(db, {
			seed: "seed",
			nowMs: 1_000_000,
			lazyExtras: {
				state: async () => {
					reads++
					return { cast: { byId: { ann: { fate: "taken-out" } } }, world: {}, slots: [], version: 3 }
				}
			}
		})
		const r = await apply(selectSite, [row!.id], { order: [] })
		expect(r.applications[0], `the link did not run: ${(r.applications[0] as any)?.reason}`).toMatchObject({ result: "ok" })
		expect((r.value as any).note).toBe("taken-out")
		expect(reads).toBe(1)

		const [blind] = await db
			.insert(schema.pipelineScripts)
			.values({
				typeId: SELECT,
				name: "reads no state",
				enabled: true,
				source: `return { order: selection.order, note: ctx.state === undefined ? "none" : "some" };`,
				varsIn: ["selection"],
				varsOut: ["selection"]
			})
			.returning()
		const r2 = await apply(selectSite, [blind!.id], { order: [] })
		expect((r2.value as any).note).toBe("none")
		expect(reads).toBe(1)
	}, 60_000)
})
