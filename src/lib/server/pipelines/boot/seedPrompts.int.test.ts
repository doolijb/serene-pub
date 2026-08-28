/**
 * Every namespace arrives usable, and arrives with the wording it had.
 *
 * Two properties, and the second matters more than it looks:
 *
 *  1. **Complete.** Each pipeline has a shipped prompt and a shipped config, and
 *     the config points at the prompt. A namespace missing either runs its
 *     providers with no instructions, which reads as the model failing rather
 *     than as a missing selection — the worst possible first impression.
 *  2. **Faithful.** The prose is byte-identical to what `db/defaults.ts` ships.
 *     An upgrade that silently improved somebody's system prompt would be the
 *     most alarming thing this migration could do, and it would be invisible
 *     until their character started behaving differently.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
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

const specIdOf = async (slug: string) => {
	const [row] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	return row?.id as number | undefined
}

const promptsIn = async (slug: string) => {
	const id = await specIdOf(slug)
	return await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.specId, id!))
}

/**
 * A spec whose active version declares no prompts-ref slots ships no prompt
 * and its config selects none — create-chat (identity + shape, no LLM step
 * yet) is the first such spec. Derived from the declarations, not a list.
 */
const isPromptless = async (slug: string) => {
	const [row] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	if (!row?.activeVersionId) return false
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const decls = await declarations(db as any, row.activeVersionId)
	return !decls.some((d: any) => d.control === "prompts-ref")
}

describe("every namespace arrives usable", () => {
	it("ships a prompt for each pipeline that has a prompts slot", async () => {
		for (const entry of CORE_SPECS) {
			if (await isPromptless(entry.slug)) continue
			const prompts = await promptsIn(entry.slug)
			expect(
				prompts.length,
				`${entry.slug} shipped no prompts`
			).toBeGreaterThan(0)
			expect(prompts.every((p: any) => p.isImmutable)).toBe(true)
		}
	})

	it("ships a config for each, pointing at one of that namespace's prompts", async () => {
		for (const entry of CORE_SPECS) {
			if (await isPromptless(entry.slug)) continue
			const specId = await specIdOf(entry.slug)
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

			const refs = values.filter((v: any) => v.slot === "prompts")
			expect(
				refs.length,
				`${entry.slug} config selects no prompt`
			).toBeGreaterThan(0)

			const ids = new Set(
				(await promptsIn(entry.slug)).map((p: any) => p.id)
			)
			for (const ref of refs)
				expect(
					ids.has(ref.value),
					`${entry.slug} points at a prompt from another namespace`
				).toBe(true)
			expect(specId).toBeTruthy()
		}
	})

	it("keeps namespaces from sharing prompts", async () => {
		// The rule the picker depends on. A session reply's wording offered where a
		// summary is being written is the mistake the split exists to prevent.
		const respond = new Set(
			(await promptsIn(RESPOND_SPEC_ID)).map((p: any) => p.name)
		)
		const world = (await promptsIn(SUMMARIZE_WORLD_SPEC_ID)).map(
			(p: any) => p.name
		)
		for (const name of world) expect(respond.has(name)).toBe(false)
	})
})

describe("the catalog matches the legacy seeds — the drift canary (24 T6b)", () => {
	/**
	 * The catalog is the system of record now; the deprecated legacy tables
	 * still seed their copies from db/defaults.ts. Until legacy is deleted,
	 * the two must agree byte-for-byte — this is the old SOURCES mapping from
	 * the pre-T6b seeder, kept here as the transformation under test.
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
		{ specSlug: RESPOND_SPEC_ID, table: schema.promptConfigs, fields: chatFields },
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

	it("every legacy shipped row has a byte-identical catalog prompt", async () => {
		const { CORE_PROMPTS } = await import("@serene-pub/core-catalog")
		const byKey = new Map(CORE_PROMPTS.map((p) => [p.seedKey, p]))
		for (const source of LEGACY_SOURCES) {
			const rows = await db.select().from(source.table)
			for (const row of rows as any[]) {
				if (!row.seedKey) continue
				const seedKey = `pipeline-prompt:${source.specSlug}:${row.seedKey}`
				const catalog = byKey.get(seedKey)
				expect(catalog, `${seedKey} missing from CORE_PROMPTS`).toBeTruthy()
				expect(catalog!.name).toBe(row.name)
				expect(catalog!.fields).toEqual(source.fields(row))
			}
		}
	})
})

describe("the wording is the wording", () => {
	it("copies the reply prompts verbatim from what core seeds", async () => {
		const legacy = await db.select().from(schema.promptConfigs)
		const seeded = legacy.filter((c: any) => c.seedKey)
		expect(seeded.length).toBeGreaterThan(0)

		const prompts = await promptsIn(RESPOND_SPEC_ID)
		const byName = new Map(prompts.map((p: any) => [p.name, p]))

		for (const row of seeded as any[]) {
			const prompt = byName.get(row.name)
			expect(prompt, `no prompt for '${row.name}'`).toBeTruthy()
			expect(prompt.fields.systemPrompt).toBe(row.systemPrompt)
			expect(prompt.fields.postHistoryInstructions).toBe(
				row.postHistoryInstructions
			)
			// And *only* the declared names. The same two texts used to be
			// written a second time under `system` / `postHistory`, because
			// assembly and the provider each declared their own prompts slot
			// (13 §12 finding i). Spec 1.1.0 has them read the context node's
			// prompts by reference, so those names address nothing — and a key
			// nothing addresses is a box in the panel's editor that silently
			// does not work. `narratorName` was the third such key: declared on
			// the context-builder type both pipelines shared, always empty here
			// because `prompt_configs` has no column for it, and read only when
			// there is no speaking character — which on this pipeline is never.
			// The narrator has its own type now (migration 0114).
			expect(Object.keys(prompt.fields).sort()).toEqual([
				"postHistoryInstructions",
				"systemPrompt"
			])
		}
	})

	it("copies the graph build's five step prompts, each to its own field", async () => {
		const [legacy] = await db
			.select()
			.from(schema.graphBuildConfigs)
			.where(eq(schema.graphBuildConfigs.seedKey, "graph-build-default"))
		const prompts = await promptsIn(GRAPH_BUILD_SPEC_ID)
		const prompt: any = prompts.find((p: any) => p.name === legacy.name)

		expect(prompt.fields.nodeResolution).toBe(
			legacy.nodeResolutionSystemPrompt
		)
		expect(prompt.fields.preFilter).toBe(legacy.preFilterSystemPrompt)
		expect(prompt.fields.perspective).toBe(legacy.perspectiveSystemPrompt)
		expect(prompt.fields.nodeDescription).toBe(
			legacy.nodeDescriptionSystemPrompt
		)
		expect(prompt.fields.stateDetection).toBe(
			legacy.stateDetectionSystemPrompt
		)
	})

	it("gives the narrator its display name, which seeds the line it speaks on", async () => {
		const prompts = await promptsIn(NARRATE_SPEC_ID)
		expect(prompts.length).toBeGreaterThan(0)
		for (const p of prompts as any[])
			expect(p.fields.narratorName).toBeTruthy()
	})

	it("starts history summarization where scene summarization is", async () => {
		// Behaviour-preserving by construction: history entries run on the scene
		// config today, so the fourth namespace begins as a copy and diverges
		// only when someone changes it.
		const scene = (await promptsIn(SUMMARIZE_SCENE_SPEC_ID)) as any[]
		const history = (await promptsIn(SUMMARIZE_HISTORY_SPEC_ID)) as any[]
		expect(history.length).toBe(scene.length)
		for (const h of history) {
			const s = scene.find((x) => x.name === h.name)
			expect(s).toBeTruthy()
			expect(h.fields.batch).toBe(s.fields.batch)
			expect(h.fields.synth).toBe(s.fields.synth)
		}
		// …but they are their own rows, so editing one leaves the other alone.
		expect(history.map((h) => h.id)).not.toEqual(scene.map((s) => s.id))
	})
})

describe("re-seeding", () => {
	it("writes nothing the second time", async () => {
		const before = await db.select().from(schema.pipelinePrompts)
		const res = await seedPipelinePrompts(db as any)
		expect(res.every((r) => r.created.length === 0)).toBe(true)
		const after = await db.select().from(schema.pipelinePrompts)
		expect(after.length).toBe(before.length)
	})
})

/**
 * The migration itself, run as text against a planted row.
 *
 * Removing the aliases from `seedPrompts.ts` fixes nothing for anyone who has
 * already booted: seeding is insert-only by seed key, deliberately, so an
 * existing row keeps whatever it was created with. `0110` is what reaches those
 * rows, and it can only be tested by executing the SQL that actually ships —
 * a re-implementation here would be a test of a second copy.
 */
describe("0110 strips the dead alias keys", () => {
	const migration = async () => {
		const { readFileSync } = await import("node:fs")
		return readFileSync("drizzle/0110_drop_prompt_aliases.sql", "utf8")
	}

	it("removes them from a reply prompt and leaves the declared three", async () => {
		const specId = (await specIdOf(RESPOND_SPEC_ID))!
		const [planted] = await db
			.insert(schema.pipelinePrompts)
			.values({
				specId,
				name: "alias-carrier",
				fields: {
					systemPrompt: "keep me",
					postHistoryInstructions: "keep me too",
					narratorName: "Narrator",
					system: "dead",
					postHistory: "also dead"
				}
			})
			.returning()

		await db.execute(await migration())

		const [after] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, planted.id))
			.limit(1)

		expect(Object.keys(after.fields as any).sort()).toEqual([
			"narratorName",
			"postHistoryInstructions",
			"systemPrompt"
		])
		expect((after.fields as any).systemPrompt).toBe("keep me")
		expect((after.fields as any).postHistoryInstructions).toBe(
			"keep me too"
		)
	})

	it("leaves another namespace's own `system` field alone", async () => {
		// The summarize namespaces never had the aliases, and nothing stops a
		// future node from declaring a field genuinely called `system`. An
		// unscoped `- 'system'` would delete authored text with no way to tell
		// it had happened.
		const specId = (await specIdOf(SUMMARIZE_WORLD_SPEC_ID))!
		const [planted] = await db
			.insert(schema.pipelinePrompts)
			.values({
				specId,
				name: "not-an-alias",
				fields: { batch: "b", synth: "s", name: "n", system: "mine" }
			})
			.returning()

		await db.execute(await migration())

		const [after] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, planted.id))
			.limit(1)
		expect((after.fields as any).system).toBe("mine")
	})

	it("is a no-op run twice", async () => {
		// It ships as a numbered migration, but the reference check in
		// `deletePrompt` reads these rows and a half-applied state would be
		// invisible. Idempotence is what makes a re-run safe to reach for.
		const before = await db.select().from(schema.pipelinePrompts)
		await db.execute(await migration())
		const after = await db.select().from(schema.pipelinePrompts)
		expect(after.map((r: any) => r.fields)).toEqual(
			before.map((r: any) => r.fields)
		)
	})
})

/**
 * `narratorName` leaves the reply namespace, and only the reply namespace.
 *
 * It was declared on the context-builder type both pipelines shared, so every
 * reply prompt carried it — empty, because `prompt_configs` has no such column —
 * and the panel renders one box per key in the row. It is read only when there
 * is no speaking character, which on the reply pipeline never happens.
 *
 * The scoping is the whole risk. The narrator's rows carry the same key and
 * there it is load-bearing: it names the seed line the model continues from, so
 * an unscoped `- 'narratorName'` would leave narrations seeded with a blank
 * speaker. Testing that requires a row in each namespace, which is why both are
 * planted here.
 *
 * Executed as the SQL that actually ships — a re-implementation would be a test
 * of a second copy.
 */
describe("0114 strips narratorName from the reply namespace", () => {
	const migration = async () => {
		const { readFileSync } = await import("node:fs")
		return readFileSync(
			"drizzle/0114_narrator_context_type.sql",
			"utf8"
		).split("--> statement-breakpoint")[1]!
	}

	const plant = async (slug: string, name: string) => {
		const specId = (await specIdOf(slug))!
		const [row] = await db
			.insert(schema.pipelinePrompts)
			.values({
				specId,
				name,
				fields: {
					systemPrompt: "keep me",
					postHistoryInstructions: "keep me too",
					narratorName: "The GM"
				}
			})
			.returning()
		return row
	}

	const fieldsOf = async (id: number) => {
		const [row] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, id))
			.limit(1)
		return row.fields as Record<string, unknown>
	}

	it("removes it from a reply prompt and keeps the other two", async () => {
		const planted = await plant(RESPOND_SPEC_ID, "carries-narrator-name")
		await db.execute(await migration())
		const after = await fieldsOf(planted.id)
		expect(Object.keys(after).sort()).toEqual([
			"postHistoryInstructions",
			"systemPrompt"
		])
		expect(after.systemPrompt).toBe("keep me")
		expect(after.postHistoryInstructions).toBe("keep me too")
	})

	it("leaves the narrator's own name alone", async () => {
		const planted = await plant(NARRATE_SPEC_ID, "narrator-keeps-its-name")
		await db.execute(await migration())
		const after = await fieldsOf(planted.id)
		expect(
			after.narratorName,
			"the narrator lost the name it seeds its line with"
		).toBe("The GM")
	})
})
