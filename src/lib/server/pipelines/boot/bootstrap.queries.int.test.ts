/**
 * How many statements a second `bootstrapPipelines` issues, and the order its
 * document reads happen in. "Fewer times, not less work": the registry index
 * is read once per loop, each published version's document is loaded once
 * (one shared document map), each variable's layout offers are read once, and
 * no document of a version is read before pass 1 of the seed heals it.
 */
import { describe, it, expect, beforeAll, vi } from "vitest"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, isNotNull } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import * as schema from "$lib/server/db/schema"

const loaded = vi.hoisted(() => [] as { versionId: number; doc: any }[])

vi.mock("$lib/server/pipelines/boot/store", async (importOriginal) => {
	const m =
		await importOriginal<
			typeof import("$lib/server/pipelines/boot/store")
		>()
	return {
		...m,
		loadDocument: vi.fn(async (...a: Parameters<typeof m.loadDocument>) => {
			const doc = await m.loadDocument(...a)
			loaded.push({ versionId: a[1], doc })
			return doc
		})
	}
})

let db: TestDb
let queries: { q: string; params: unknown[] }[] = []
let counted: any

beforeAll(async () => {
	db = await createTestDb()
	counted = drizzle((db as any).$client, {
		schema,
		logger: {
			logQuery: (q: string, params: unknown[]) =>
				void queries.push({ q, params })
		}
	})
	await bootstrapPipelines(db)
}, 120_000)

describe("bootstrapPipelines statement count", () => {
	it("reads the registry index and the layout offers once, not per row", async () => {
		queries = []
		loaded.length = 0
		await bootstrapPipelines(counted)
		const all = queries.slice()
		const qs = all.map((x) => x.q)

		// Selects of the whole registry table (no where clause).
		const registryFull = qs.filter(
			(q) =>
				/from "pipeline_definition_registry"/.test(q) &&
				!/ where /.test(q)
		).length
		// Measured 4: `syncDefinitionRegistry`, `reconcilePublishedConfigs`,
		// `registryByPin` in the scan, `reconcilePromptFields`; the margin is
		// for one more one-off reader, never for a per-spec one.
		expect(registryFull).toBeLessThanOrEqual(6)

		// Node selects keyed by `spec_version_id`: 466 for 79 published specs.
		// Per spec: `declarationsAndVariableKeys` twice (reconcile and scan),
		// `chainNodesFor`, the pass-1 `healNodeExpose` and
		// `reconcilePlacedNodes` (5 each, 395), plus one per document load
		// (66), which accounts for 461 of the 466.
		const nodeReads = qs.filter((q) =>
			/from "pipeline_nodes" where .*"spec_version_id"/.test(q)
		).length
		const published = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(isNotNull(schema.pipelineSpecs.activeVersionId))
		expect(published.length).toBeGreaterThan(0)
		expect(nodeReads).toBeLessThanOrEqual(6.5 * published.length)

		// Document loads: `loadDocument` selects `pipeline_edges` once per
		// call. 66 loads on a second boot, one per distinct version id (the
		// mock record agrees), under the 79 published slugs because only
		// slugs a step reads are loaded. The shared document map serves every
		// later step.
		const edgeReads = qs.filter((q) =>
			/from "pipeline_edges"/.test(q)
		).length
		expect(edgeReads).toBeLessThanOrEqual(published.length)
		expect(edgeReads).toBe(loaded.length)
		expect(new Set(loaded.map((l) => l.versionId)).size).toBe(loaded.length)

		// `pipeline_scripts` selects by `seed_key`: measured 69 for 79 specs —
		// one prefetch in `seedCoreScripts`, then at most one `scriptIdFor`
		// (`refDefaults`, `config/named.ts`) per published spec.
		const scriptReads = qs.filter((q) =>
			/from "pipeline_scripts" where .*"seed_key"/.test(q)
		).length
		expect(scriptReads).toBeLessThanOrEqual(published.length + 1)

		// The per-row `layoutByReference` shape: variable id and reference both
		// in the where clause. The scan hands the offers down instead.
		const layoutPerRow = qs.filter((q) =>
			/from "pipeline_variable_templates" where .*"variable_id" = \$\d+ and .*"reference" = /.test(
				q
			)
		).length
		expect(layoutPerRow).toBe(0)

		// One read per variable (`where "variable_id" = $1 order by ...`): 19
		// selects over 19 distinct variable ids. The scan reads each
		// variable's offers once and hands them down.
		const perVariable = all.filter(({ q }) =>
			/from "pipeline_variable_templates" where "pipeline_variable_templates"\."variable_id" = \$\d+ order by/.test(
				q
			)
		)
		expect(perVariable.length).toBeGreaterThan(0)
		expect(perVariable.length).toBe(
			new Set(perVariable.map(({ params }) => params[0])).size
		)
	}, 120_000)

	it("never reuses a document read before pass 1 healed its version [C16]", async () => {
		// Pass 1 of `seedCoreSpecs` heals present versions in place
		// (`seed.ts` `healNodeExpose` writes `pipeline_nodes.expose`;
		// `healClauseChains` writes `pipeline_clauses.parent_clause_chain`).
		// One document map is created empty in `bootstrapPipelines` right
		// before `seedCoreSpecs`, first filled in pass 4
		// (`reconcilePublishedConfigs`, "4 — configs" in `seed.ts`) after pass 1 has healed present
		// versions in place, and handed on to the refit, the preset reconcile
		// and the scan. This test fails if any document of a healed version is
		// read before the heal.
		const rows = await db
			.select({
				id: schema.pipelineNodes.id,
				nodeKey: schema.pipelineNodes.nodeKey,
				versionId: schema.pipelineNodes.specVersionId,
				expose: schema.pipelineNodes.expose
			})
			.from(schema.pipelineNodes)
			.innerJoin(
				schema.pipelineSpecs,
				eq(
					schema.pipelineSpecs.activeVersionId,
					schema.pipelineNodes.specVersionId
				)
			)
			.where(isNotNull(schema.pipelineNodes.expose))
		expect(rows.length).toBeGreaterThan(0)

		// Boot-loaded versions first: a probe boot records which are read.
		loaded.length = 0
		await bootstrapPipelines(db)
		const seen = new Set(loaded.map((l) => l.versionId))
		const target = rows.find((r) => seen.has(r.versionId))
		expect(target).toBeDefined()
		const original = target!.expose

		await db
			.update(schema.pipelineNodes)
			.set({ expose: null })
			.where(eq(schema.pipelineNodes.id, target!.id))

		loaded.length = 0
		await bootstrapPipelines(db)

		const ofVersion = loaded.filter(
			(l) => l.versionId === target!.versionId
		)
		expect(ofVersion.length).toBeGreaterThan(0)
		for (const { doc } of ofVersion) {
			const node = doc.nodes.find((n: any) => n.key === target!.nodeKey)
			expect(node?.expose).toEqual(original)
		}

		const [after] = await db
			.select({ expose: schema.pipelineNodes.expose })
			.from(schema.pipelineNodes)
			.where(and(eq(schema.pipelineNodes.id, target!.id)))
		expect(after.expose).toEqual(original)
	}, 120_000)
})
