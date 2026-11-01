/**
 * The speech seeders on a fresh database (speech build, lane D + follow-up ★4;
 * verified by lane V): three spoken-line context templates, two inflection
 * variable layouts (all Jinja), one inflection-sentence content row, the
 * speak-direction prompt row, and idempotence. A sibling of `seedPrompts.int
 * .test.ts` (a pin file), not an edit of it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, like } from "drizzle-orm"
import { SPEAK_DIRECTION_SOURCE } from "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000 })

let db: TestDb
let dataDir: string

// `defaults.ts` reaches for `$lib/server/db` at module scope (see seedPrompts.int.test.ts).
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb(), getCryptoSecretKey: () => "seed-speech-test-secret" }
})

const JINJA = "core:template/jinja2@1"
const SENTENCE_KEY = "pipeline-variable-template:core:var/inflection-sentence@1:content"
const DIRECTION_KEY = "pipeline-prompt:core:oracle/speak:prompts:speak-direction"

const spokenContext = () =>
	db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(like(schema.pipelineContextTemplates.seedKey, "pipeline-context-template:core:spoken-line-%"))
const speechLayouts = async () => {
	const rows = await db.select().from(schema.pipelineVariableTemplates)
	return rows.filter((r) => /inflection-(sentence|tag)@1/.test(r.seedKey ?? ""))
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-seed-speech-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("speech seeders", () => {
	it("a fresh boot leaves 3 spoken-line context templates and 2 inflection layouts, all Jinja", async () => {
		const ctx = await spokenContext()
		expect(ctx).toHaveLength(3)
		expect(new Set(ctx.map((r) => r.engine))).toEqual(new Set([JINJA]))
		expect(ctx.every((r) => r.nodeDefinitionId === "core:oracle/speak")).toBe(true)
		const layouts = await speechLayouts()
		expect(layouts).toHaveLength(2)
		expect(new Set(layouts.map((r) => r.engine))).toEqual(new Set([JINJA]))
	})

	it("exactly one inflection-sentence content row (no automatic JSON row beside it)", async () => {
		const rows = (await db.select().from(schema.pipelineVariableTemplates)).filter(
			(r) => r.variableId === "core:var/inflection-sentence@1"
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.seedKey).toBe(SENTENCE_KEY)
	})

	it("running the seeders twice is idempotent: same rows, same content, nothing created or refreshed", async () => {
		const { seedContextTemplates } = await import("./seedContextTemplates")
		const { seedVariableTemplates } = await import("./seedVariableTemplates")
		const { seedPipelinePrompts } = await import("./seedPrompts")
		const before = {
			ctx: await db.select().from(schema.pipelineContextTemplates),
			vars: await db.select().from(schema.pipelineVariableTemplates),
			prompts: await db.select().from(schema.pipelinePrompts)
		}
		const c = await seedContextTemplates(db)
		const v = await seedVariableTemplates(db)
		const p = await seedPipelinePrompts(db)
		expect(c.created).toEqual([])
		expect(c.refreshed).toEqual([])
		expect(v.created).toEqual([])
		expect(v.refreshed).toEqual([])
		expect(p.flatMap((x) => [...x.created, ...x.refreshed])).toEqual([])
		const after = {
			ctx: await db.select().from(schema.pipelineContextTemplates),
			vars: await db.select().from(schema.pipelineVariableTemplates),
			prompts: await db.select().from(schema.pipelinePrompts)
		}
		expect(after.ctx.length).toBe(before.ctx.length)
		expect(after.vars.length).toBe(before.vars.length)
		expect(after.prompts.length).toBe(before.prompts.length)
		expect(await spokenContext()).toHaveLength(3)
		expect(await speechLayouts()).toHaveLength(2)
		// no duplicate content
		const keys = after.vars.map((r) => r.seedKey).filter(Boolean)
		expect(new Set(keys).size).toBe(keys.length)
		const sources = after.ctx.filter((r) => r.seedKey?.includes("spoken-line")).map((r) => r.source)
		expect(new Set(sources).size).toBe(3)
	})

	it("the speak-direction prompt row is seeded with fields.direction === SPEAK_DIRECTION_SOURCE", async () => {
		const rows = await db.select().from(schema.pipelinePrompts).where(eq(schema.pipelinePrompts.seedKey, DIRECTION_KEY))
		expect(rows).toHaveLength(1)
		const row = rows[0] as any
		expect(row.nodeDefinitionId).toMatch(/^core:oracle\/speak/)
		expect(row.slot).toBe("prompts")
		expect(row.fields.direction).toBe(SPEAK_DIRECTION_SOURCE)
		// the default for the six speaking specs
		expect((row.defaultForSpecs ?? []).length).toBe(6)
	})

	it("the app's DEFAULT_DIRECTION is the catalogue's SPEAK_DIRECTION_SOURCE", async () => {
		const { DEFAULT_DIRECTION } = await import("$lib/server/pipelines/speech/lineTemplate")
		expect(DEFAULT_DIRECTION).toBe(SPEAK_DIRECTION_SOURCE)
	})

	it("a drifted shipped speech row is refreshed back by the next seed (and only that row)", async () => {
		const { seedVariableTemplates } = await import("./seedVariableTemplates")
		await db
			.update(schema.pipelineVariableTemplates)
			.set({ source: "tampered" })
			.where(eq(schema.pipelineVariableTemplates.seedKey, SENTENCE_KEY))
		const v = await seedVariableTemplates(db)
		expect(v.refreshed).toEqual([SENTENCE_KEY])
		const [row] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.seedKey, SENTENCE_KEY))
		expect(row!.source).not.toBe("tampered")
	})
})
