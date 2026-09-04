/**
 * Every pool arrives usable, and arrives with the wording it had.
 *
 * Two properties, and the second matters more than it looks:
 *
 *  1. **Complete.** Each pipeline's shipped config points every prompts-ref at
 *     a real, shipped row **in that step's own pool**. A step with no prompt
 *     runs its provider with no instructions, which reads as the model failing
 *     rather than as a missing selection — the worst possible first impression.
 *  2. **Faithful.** The prose is byte-identical to what `db/defaults.ts` ships.
 *     An upgrade that silently improved somebody's system prompt would be the
 *     most alarming thing this migration could do, and it would be invisible
 *     until their character started behaving differently.
 *
 * The canary below is what enforces (2) through the re-keying. It is a
 * **per-pool** comparison now, because a shipped row is no longer a bundle — but
 * it still asserts that **every legacy string appears exactly once**, and that
 * total is the whole value of it. Weakened to a spot check it would pass while
 * the split quietly dropped a field.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { CORE_SPECS } from "$lib/server/pipelines/specs"
import {
	GRAPH_BUILD_SPEC_ID,
	NARRATE_SPEC_ID,
	RESPOND_SPEC_ID,
	SUMMARIZE_CHARACTER_SPEC_ID,
	SUMMARIZE_HISTORY_SPEC_ID,
	SUMMARIZE_SCENE_SPEC_ID,
	SUMMARIZE_WORLD_SPEC_ID
} from "$lib/server/pipelines/specs"
import { seedPipelinePrompts } from "$lib/server/pipelines/boot/seedPrompts"

let db: TestDb
let dataDir: string

// `defaults.ts` reaches for `$lib/server/db` at module scope, so the real seeder
// only runs against a mocked db module — the same shape `defaults.seedKey`'s
// own suite uses. Seeding for real matters here: the whole point is that the
// prompts are copied from what core actually ships, not from a fixture.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "seed-prompts-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-seed-prompts-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb

	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const specOf = async (slug: string) => {
	const [row] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	return row
}

/** Every prompts-ref declaration a published spec makes, with its pool. */
const promptDeclsOf = async (slug: string) => {
	const spec = await specOf(slug)
	if (!spec?.activeVersionId) return []
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	return (await declarations(db as any, spec.activeVersionId)).filter(
		(d: any) => d.control === "prompts-ref"
	)
}

/** The rows in one pool. */
const poolRows = async (nodeTypeId: string, slot: string) =>
	await db
		.select()
		.from(schema.pipelinePrompts)
		.where(
			and(
				eq(schema.pipelinePrompts.nodeTypeId, nodeTypeId),
				eq(schema.pipelinePrompts.slot, slot)
			)
		)

describe("every pipeline arrives usable", () => {
	it("ships a prompt in every pool a pipeline's steps read from", async () => {
		for (const entry of CORE_SPECS) {
			for (const d of await promptDeclsOf(entry.slug)) {
				const rows = await poolRows(d.nodeTypeId!, d.slot)
				expect(
					rows.length,
					`${entry.slug} step ${d.nodeKey}.${d.slot} has an empty pool`
				).toBeGreaterThan(0)
				expect(
					rows.some((p: any) => p.isImmutable),
					`${entry.slug} step ${d.nodeKey}.${d.slot} has no shipped row`
				).toBe(true)
			}
		}
	})

	it("ships a config whose every prompts-ref points into that step's own pool", async () => {
		// The failure this replaces would be silent and total: under a bundle
		// model the shipped config pointed every step at ONE row, so three of
		// the summarizer's four steps would have been handed a prompt with none
		// of the fields they read.
		for (const entry of CORE_SPECS) {
			const decls = await promptDeclsOf(entry.slug)
			if (!decls.length) continue

			const [config] = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(
					eq(
						schema.pipelineConfigs.seedKey,
						`pipeline-default:${entry.slug}`
					)
				)
			expect(config, `${entry.slug} shipped no config`).toBeTruthy()

			const values = await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(eq(schema.pipelineConfigValues.configId, config.id))

			for (const d of decls) {
				const v = (values as any[]).find(
					(row) =>
						row.nodeKey === d.nodeKey &&
						row.slot === d.slot &&
						(row.path ?? "") === d.path
				)
				expect(
					v?.value,
					`${entry.slug} selects no prompt for ${d.nodeKey}.${d.slot}`
				).toBeTruthy()

				const [row] = await db
					.select()
					.from(schema.pipelinePrompts)
					.where(eq(schema.pipelinePrompts.id, v.value))
				expect(
					row,
					`${entry.slug} ${d.nodeKey}.${d.slot} points at nothing`
				).toBeTruthy()
				expect(
					`${row.nodeTypeId}#${row.slot}`,
					`${entry.slug} ${d.nodeKey}.${d.slot} points into another pool`
				).toBe(`${d.nodeTypeId}#${d.slot}`)
				expect(row.isImmutable).toBe(true)

				// And it fits: every field the step declares is written.
				for (const field of d.promptFields ?? [])
					expect(
						(row.fields as any)[field],
						`${entry.slug} ${d.nodeKey}.${d.slot} has no '${field}'`
					).toBeTypeOf("string")
			}
		}
	})

	it("keeps reply wording out of a summarizer's pool", async () => {
		// The rule the picker depends on — and it holds by CONSTRUCTION now
		// rather than by a column: the reply's context node and the world
		// summarizer's drafting node are different types, so the two pools
		// cannot overlap however many pipelines share them.
		const reply = await promptDeclsOf(RESPOND_SPEC_ID)
		const world = await promptDeclsOf(SUMMARIZE_WORLD_SPEC_ID)
		const replyPools = new Set(
			reply.map((d: any) => `${d.nodeTypeId}#${d.slot}`)
		)
		for (const d of world)
			expect(replyPools.has(`${d.nodeTypeId}#${d.slot}`)).toBe(false)

		const replyNames = new Set(
			(await poolRows(reply[0]!.nodeTypeId!, reply[0]!.slot)).map(
				(p: any) => p.name
			)
		)
		for (const d of world)
			for (const p of await poolRows(d.nodeTypeId!, d.slot))
				expect(replyNames.has(p.name)).toBe(false)
	})

	it("shares one pool between the two summarizers that share a step", async () => {
		// The other half of the same trade, and the reason the catalog dedupes:
		// scene and history summarization run the same nodes, so they read the
		// same rows rather than each carrying an identical copy.
		const scene = await promptDeclsOf(SUMMARIZE_SCENE_SPEC_ID)
		const history = await promptDeclsOf(SUMMARIZE_HISTORY_SPEC_ID)
		const historyPools = new Set(
			history.map((d: any) => `${d.nodeTypeId}#${d.slot}`)
		)
		const shared = scene.filter((d: any) =>
			historyPools.has(`${d.nodeTypeId}#${d.slot}`)
		)
		expect(
			shared.length,
			"scene and history no longer share any step"
		).toBeGreaterThan(0)
	})
})

describe("the catalog matches the legacy seeds — the drift canary (24 T6b)", () => {
	/**
	 * The catalog is the system of record now; the deprecated legacy tables
	 * still seed their copies from db/defaults.ts. Until legacy is deleted, the
	 * two must agree byte-for-byte.
	 *
	 * ## Why this is per-FIELD rather than per-row
	 *
	 * It used to compare one legacy row against one catalog row, because a
	 * catalog row *was* the bundle. Split across pools, a legacy scene config's
	 * four texts live in four different rows — so the comparison is now "every
	 * string this legacy row carries appears, byte-identical, in exactly one
	 * catalog row, in the pool whose node declares that field name".
	 *
	 * **Exactly one, and every one.** Both halves are load-bearing and neither
	 * is a spot check: "every one" catches a field the split dropped, "exactly
	 * one" catches a field the split copied into two pools, where editing it in
	 * the panel would fix half the pipeline.
	 */
	const str = (v: unknown): string => (typeof v === "string" ? v : "")
	const chatFields = (row: any) => ({
		systemPrompt: str(row.systemPrompt),
		postHistoryInstructions: str(row.postHistoryInstructions)
	})
	const narratorFields = (row: any) => ({
		...chatFields(row),
		narratorName: str(row.narratorName) || "Narrator"
	})
	const summarizeFields = (row: any) => ({
		batch: str(row.batchSystemPrompt),
		synth: str(row.synthSystemPrompt),
		name: str(row.nameSystemPrompt)
	})
	const LEGACY_SOURCES: Array<{
		specSlug: string
		table: any
		fields: (row: any) => Record<string, string>
	}> = [
		{
			specSlug: RESPOND_SPEC_ID,
			table: schema.promptConfigs,
			fields: chatFields
		},
		{
			specSlug: NARRATE_SPEC_ID,
			table: schema.narratorPromptConfigs,
			fields: narratorFields
		},
		{
			specSlug: SUMMARIZE_WORLD_SPEC_ID,
			table: schema.worldSummarizeConfigs,
			fields: summarizeFields
		},
		{
			specSlug: SUMMARIZE_CHARACTER_SPEC_ID,
			table: schema.characterSummarizeConfigs,
			fields: summarizeFields
		},
		{
			specSlug: SUMMARIZE_SCENE_SPEC_ID,
			table: schema.sceneSummarizeConfigs,
			fields: (r: any) => ({
				...summarizeFields(r),
				characterExtraction: str(r.characterExtractionSystemPrompt)
			})
		},
		{
			specSlug: SUMMARIZE_HISTORY_SPEC_ID,
			table: schema.sceneSummarizeConfigs,
			fields: summarizeFields
		}
	]

	it("places every legacy field in exactly one catalog row, byte-identical", async () => {
		const { CORE_PROMPTS } = await import("@serene-pub/core-catalog")

		let compared = 0
		for (const source of LEGACY_SOURCES) {
			// The pools this pipeline's steps actually read, and which field
			// each one declares — the split's own answer, read back from the
			// declarations rather than restated here.
			const decls = await promptDeclsOf(source.specSlug)
			const poolForField = new Map<string, string>()
			for (const d of decls)
				for (const field of (d as any).promptFields ?? [])
					poolForField.set(field, `${d.nodeTypeId}#${d.slot}`)

			const rows = await db.select().from(source.table)
			for (const row of rows as any[]) {
				if (!row.seedKey) continue
				const authored = source.fields(row)

				for (const [field, text] of Object.entries(authored)) {
					const pool = poolForField.get(field)
					expect(
						pool,
						`${source.specSlug} declares no step reading '${field}'`
					).toBeTruthy()

					// Every catalog row in that pool carrying this exact text.
					const matches = CORE_PROMPTS.filter(
						(p) =>
							`${p.nodeType}#${p.slot}` === pool &&
							p.fields[field] === text
					)
					expect(
						matches.length,
						`'${row.name}'.${field} for ${source.specSlug} appears in ` +
							`${matches.length} catalog rows of ${pool}, not 1`
					).toBe(1)
					// The name travelled too — a shipped prompt renamed on the
					// way through the split would be as alarming as a reworded
					// one, and just as invisible.
					expect(matches[0]!.name).toBe(row.name)
					compared++
				}
			}
		}
		// The canary is worthless if the loop found nothing to compare.
		expect(compared).toBeGreaterThan(20)
	})

	it("seeds every catalog row, and nothing twice", async () => {
		const { CORE_PROMPTS } = await import("@serene-pub/core-catalog")
		// Duplicate identity in the catalog would make the seed non-idempotent
		// by construction rather than by a bug in the seeder, so it is asserted
		// on the catalog itself as well as on the rows it produced.
		const keys = CORE_PROMPTS.map((p) => p.seedKey)
		expect(new Set(keys).size).toBe(keys.length)
		const names = CORE_PROMPTS.map(
			(p) => `${p.nodeType}#${p.slot}#${p.name}`
		)
		expect(new Set(names).size).toBe(names.length)

		for (const p of CORE_PROMPTS) {
			const [row] = await db
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.seedKey, p.seedKey))
			expect(row, `${p.seedKey} was not seeded`).toBeTruthy()
			expect(row.nodeTypeId).toBe(p.nodeType)
			expect(row.slot).toBe(p.slot)
			expect(row.name).toBe(p.name)
			expect(row.fields).toEqual(p.fields)
			expect(row.isImmutable).toBe(true)
		}
	})
})

describe("the wording is the wording", () => {
	it("copies the graph build's five step prompts, each into its own pool", async () => {
		// The clearest case of the split: one legacy row's five texts belong to
		// five different node types. Under the bundle model all five steps
		// shared one row and the panel put five editors on each of them.
		const [legacy] = await db
			.select()
			.from(schema.graphBuildConfigs)
			.where(eq(schema.graphBuildConfigs.seedKey, "graph-build-default"))

		const decls = await promptDeclsOf(GRAPH_BUILD_SPEC_ID)
		const pools = new Set(decls.map((d: any) => `${d.nodeTypeId}#${d.slot}`))
		expect(pools.size).toBeGreaterThan(1)

		const expected: Record<string, string> = {
			nodeResolution: legacy.nodeResolutionSystemPrompt,
			preFilter: legacy.preFilterSystemPrompt,
			perspective: legacy.perspectiveSystemPrompt,
			nodeDescription: legacy.nodeDescriptionSystemPrompt,
			stateDetection: legacy.stateDetectionSystemPrompt
		}

		for (const d of decls) {
			const rows = await poolRows(d.nodeTypeId!, d.slot)
			const row: any = rows.find((r: any) => r.name === legacy.name)
			expect(row, `${d.nodeKey} has no '${legacy.name}'`).toBeTruthy()
			for (const field of (d as any).promptFields ?? [])
				expect(row.fields[field]).toBe(expected[field])
			// And nothing belonging to another step.
			expect(Object.keys(row.fields).sort()).toEqual(
				[...((d as any).promptFields ?? [])].sort()
			)
		}
	})

	it("gives the narrator its display name, which seeds the line it speaks on", async () => {
		for (const d of await promptDeclsOf(NARRATE_SPEC_ID))
			if ((d as any).promptFields?.includes("narratorName"))
				for (const p of await poolRows(d.nodeTypeId!, d.slot))
					expect(p.fields.narratorName).toBeTruthy()
	})

	it("starts history summarization on the same rows scene summarization uses", async () => {
		// Behaviour-preserving, and now by identity rather than by copy: the two
		// pipelines run the same nodes, and their shipped text was byte-identical,
		// so the catalog ships ONE row that both configs point at. Two identical
		// rows with disambiguated names would have been the bundle habit
		// surviving the refactor.
		const sceneSpec = await specOf(SUMMARIZE_SCENE_SPEC_ID)
		const historySpec = await specOf(SUMMARIZE_HISTORY_SPEC_ID)

		const valuesFor = async (spec: any) => {
			const [config] = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(
					eq(
						schema.pipelineConfigs.seedKey,
						`pipeline-default:${spec.slug}`
					)
				)
			const rows = await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(eq(schema.pipelineConfigValues.configId, config.id))
			return (rows as any[]).filter((r) => r.slot === "prompts")
		}

		const scene = await valuesFor(sceneSpec)
		const history = await valuesFor(historySpec)
		const sceneByNode = new Map(scene.map((v) => [v.nodeKey, v.value]))
		let shared = 0
		for (const v of history)
			if (sceneByNode.has(v.nodeKey)) {
				expect(
					v.value,
					`${v.nodeKey} starts on a different row in the two summarizers`
				).toBe(sceneByNode.get(v.nodeKey))
				shared++
			}
		expect(shared).toBeGreaterThan(0)
	})

	it("gives each summarizer its own starting row where the text differs", async () => {
		// The counterpart, and what `default_for_specs` is a LIST for: world,
		// character and scene drafting prompts all live in ONE pool, and
		// "lowest id in the pool" would hand summarize-character the world
		// summarizer's wording on a screen showing the right name.
		const starts = new Map<string, number>()
		for (const slug of [
			SUMMARIZE_WORLD_SPEC_ID,
			SUMMARIZE_CHARACTER_SPEC_ID,
			SUMMARIZE_SCENE_SPEC_ID
		]) {
			const spec = await specOf(slug)
			const [config] = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(
					eq(
						schema.pipelineConfigs.seedKey,
						`pipeline-default:${slug}`
					)
				)
			const decls = await promptDeclsOf(slug)
			const batch = decls.find((d: any) =>
				(d.promptFields ?? []).includes("batch")
			)!
			const rows = await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(eq(schema.pipelineConfigValues.configId, config.id))
			const v = (rows as any[]).find(
				(r) => r.nodeKey === batch.nodeKey && r.slot === batch.slot
			)
			expect(spec).toBeTruthy()
			starts.set(slug, v.value)
		}
		expect(new Set(starts.values()).size).toBe(3)
	})
})

describe("re-seeding", () => {
	it("writes nothing the second time", async () => {
		const before = await db.select().from(schema.pipelinePrompts)
		const res = await seedPipelinePrompts(db as any)
		expect(res.every((r) => r.created.length === 0)).toBe(true)
		expect(res.every((r) => r.refreshed.length === 0)).toBe(true)
		const after = await db.select().from(schema.pipelinePrompts)
		expect(after.length).toBe(before.length)
	})

	it("leaves a row a user wrote entirely alone", async () => {
		// The rule that makes refresh-if-different safe: `seedKey` is NULL for
		// everything a person made, so nothing here ever reads it. Without this
		// the correction pass would be a licence to overwrite somebody's work.
		const { createPrompt } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		const decl = (await promptDeclsOf(RESPOND_SPEC_ID))[0]!
		const mine = await createPrompt(db as any, {
			nodeTypeId: decl.nodeTypeId!,
			slot: decl.slot,
			name: "Mine, untouched",
			fields: { systemPrompt: "my words" }
		})
		await seedPipelinePrompts(db as any)
		const [after] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, mine.id))
		expect(after.name).toBe("Mine, untouched")
		expect(after.fields).toEqual({ systemPrompt: "my words" })
	})

	it("corrects a shipped row that has drifted, rather than leaving it", async () => {
		// Insert-only meant core's own row could never be fixed once an install
		// had booted: a fresh install and an upgraded one then shipped different
		// prose from identical settings, with nothing on any screen to say so.
		const { CORE_PROMPTS } = await import("@serene-pub/core-catalog")
		const target = CORE_PROMPTS[0]!
		await db
			.update(schema.pipelinePrompts)
			.set({ fields: { ...target.fields, systemPrompt: "drifted" } })
			.where(eq(schema.pipelinePrompts.seedKey, target.seedKey))

		const res = await seedPipelinePrompts(db as any)
		expect(res.flatMap((r) => r.refreshed)).toContain(target.seedKey)

		const [row] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.seedKey, target.seedKey))
		expect(row.fields).toEqual(target.fields)

		// …and having corrected it, it is quiet again.
		const again = await seedPipelinePrompts(db as any)
		expect(again.every((r) => r.refreshed.length === 0)).toBe(true)
	})
})

/**
 * The 0110 and 0114 blocks are gone, and their absence is a decision.
 *
 * Both executed a shipped migration's SQL against a planted `pipeline_prompts`
 * row: 0110 stripped the dead `system` / `postHistory` aliases, 0114 stripped
 * `narratorName` from the reply namespace. Migration 0180 **drops and recreates
 * the table**, so on every install those two now run against rows that are
 * about to cease existing — there is no state either can reach and nothing left
 * for a test to observe. Kept, they would have needed rewriting to plant rows
 * in the new shape, which would have made them assert that a migration still
 * edits a table nobody has by the time boot finishes: a green test for a
 * property that is no longer true.
 *
 * What they were protecting is protected elsewhere and better. A prompt row
 * carrying a key the slot does not declare is now the *normal* case rather than
 * a migration's job, and `reconcilePromptFields` handles it on every boot —
 * archiving the text instead of deleting it, which is what those migrations
 * should have done. `reconcilePromptFields.int.test.ts` covers the scoping both
 * of them got right: the narrator keeps the name it seeds its line with.
 */
