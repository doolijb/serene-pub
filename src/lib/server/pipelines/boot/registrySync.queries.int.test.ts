/**
 * How many statements a registry sync issues. "Fewer times, not less work":
 * an unchanged boot reads its two tables once each and writes nothing.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { drizzle } from "drizzle-orm/pglite"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { syncDefinitionRegistry } from "$lib/server/pipelines/boot/registrySync"
import { allDefinitions, allScriptKinds, S } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"

let db: TestDb
let queries: string[] = []
let counted: any

beforeAll(async () => {
	db = await createTestDb({ skipEntryTypes: true })
	counted = drizzle((db as any).$client, {
		schema,
		logger: { logQuery: (q: string) => void queries.push(q) }
	})
}, 60_000)

const WRITE = /^\s*(insert|update|delete)\b/i
const writes = (qs: string[]) => qs.filter((q) => WRITE.test(q))
const reads = (qs: string[]) => qs.filter((q) => !WRITE.test(q))

async function run() {
	queries = []
	const r = await syncDefinitionRegistry(
		counted,
		[...allDefinitions(), ...allScriptKinds()],
		{ release: "0.6.0", complete: true }
	)
	return { r, qs: queries.slice() }
}

const task = (id: string, extra: Record<string, unknown> = {}) =>
	({
		kind: "task",
		id,
		timeoutMs: 5000,
		ports: { in: { main: S.textStream }, out: { main: S.json } },
		...extra
	}) as any

const rowsOf = (slug: string) =>
	db
		.select()
		.from(schema.pipelineDefinitionRegistry)
		.where(
			and(
				eq(schema.pipelineDefinitionRegistry.definitionId, slug),
				eq(schema.pipelineDefinitionRegistry.version, 1)
			)
		)

describe("syncDefinitionRegistry statement count", () => {
	it("an unchanged sync reads each table once and writes nothing", async () => {
		const first = await run()
		const second = await run()
		expect(first.r.inserted.length).toBeGreaterThan(20)
		// New rows go in as one multi-row insert per chunk of 100, for each of the
		// two tables, not one statement per row.
		const chunks = Math.ceil(first.r.inserted.length / 100)
		for (const table of [
			"pipeline_definition_registry",
			"pipeline_definition_declarations"
		])
			expect(
				writes(first.qs).filter((q) =>
					new RegExp(`insert into "${table}"`, "i").test(q)
				).length
			).toBeLessThanOrEqual(chunks)
		expect(second.r.inserted).toEqual([])
		expect(second.r.updated).toEqual([])
		expect(second.r.republished).toEqual([])
		expect(writes(second.qs)).toEqual([])
		// registry + archive in the loop, plus the reverse-diff's own read
		expect(reads(second.qs).length).toBeLessThanOrEqual(3)
	}, 60_000)

	it("keeps its maps truthful within one pass: an insert, a pointer move and duplicate pins", async () => {
		const fresh = "test:task/queries-fresh@1"
		const moving = "test:task/queries-moving@1"
		await syncDefinitionRegistry(counted, [task(moving)], {
			release: "0.6.0"
		})

		// `fresh` is new and listed twice; `moving` changes its content and is
		// listed twice. The duplicates must meet the row their twin just wrote
		// (update path), never the unique index.
		const r = await syncDefinitionRegistry(
			counted,
			[
				task(fresh),
				task(fresh),
				task(moving, {
					ports: {
						in: { main: S.textStream },
						out: { main: S.json, more: S.json }
					}
				}),
				task(moving, {
					ports: {
						in: { main: S.textStream },
						out: { main: S.json, more: S.json }
					}
				})
			],
			{ release: "0.6.0" }
		)
		expect(r.inserted).toEqual([fresh])
		expect(r.republished).toEqual([moving])
		expect(r.unchanged).toEqual([fresh, moving])

		expect(await rowsOf("test:task/queries-fresh")).toHaveLength(1)
		const [m] = await rowsOf("test:task/queries-moving")
		expect(Object.keys((m.ports as any).out)).toContain("more")
		const archived = await db
			.select()
			.from(schema.pipelineDefinitionDeclarations)
			.where(
				eq(
					schema.pipelineDefinitionDeclarations.definitionId,
					"test:task/queries-moving"
				)
			)
		// the declaration moved off, and the one moved onto
		expect(archived).toHaveLength(2)
		expect(new Set(archived.map((a) => a.contentHash)).size).toBe(2)
	}, 60_000)
})
