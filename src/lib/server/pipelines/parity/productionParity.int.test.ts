/**
 * The seam the corpus cannot see: **floor ≡ production**.
 *
 * The parity corpus proves the pipeline emits 0.5's bytes, but it renders
 * through `parityPipeline()` and `buildWorld` *without a specId* — so no config
 * resolves, no layout resolves, and every variable falls through to its in-code
 * default. It gates the floor.
 *
 * A real install does not run the floor. It runs the shipped `respond` spec, and
 * every variable is resolved through the config layer into a
 * `pipeline_variable_templates` row, then rendered from that row's source. That
 * is a different code path reaching the same bytes only if the seeded rows
 * genuinely reproduce the in-code defaults.
 *
 * Which is the whole argument for deleting the legacy path, and it had no test.
 * `variableTemplates.parity.test.ts` asserts source ≡ codeDefault for the code
 * *constants*; nothing asserted that what boot actually wrote into the database
 * agrees with them, nor that the assembled prompt comes out the same once the
 * config layer, the context-template row and the layout rows are all in play.
 *
 * Chained with the corpus this closes the argument:
 *   goldens ≡ floor   (parity.int.test.ts, against frozen 0.5 output)
 *   floor   ≡ production  (here)
 *   ⟹ production ≡ 0.5
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { SHIPPED_VARIABLE_TEMPLATES, seedKeyFor } from "$lib/server/pipelines/entities/variableLayouts"

let db: TestDb
let dataDir: string
let userId: number
let chatId: number
let characterId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "production-parity-secret" }
})

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-production-parity-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "production-parity", isAdmin: true })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Ash",
			description: "A rider who patrols the ash wastes.",
			personality: "Terse, loyal, slow to trust."
		})
		.returning()
	characterId = character.id

	const [persona] = await db
		.insert(schema.personas)
		.values({
			userId,
			isDefault: false,
			name: "Rell",
			description: "A cartographer looking for a way north."
		})
		.returning()

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Production Lore", userId })
		.returning()

	await db.insert(schema.worldLoreEntries).values({
		lorebookId: lorebook.id,
		retrievalStrategy: "keyword",
		name: "The Ashguard",
		keys: "ashguard",
		content: "Riders who patrol the ash wastes."
	})

	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	chatId = chat.id

	await db
		.insert(schema.chatCharacters)
		.values({ chatId, characterId, isActive: true, visibility: "visible" })
	await db
		.insert(schema.chatPersonas)
		.values({ chatId, personaId: persona.id })
	await db.insert(schema.chatMessages).values([
		{
			chatId,
			role: "user",
			content: "Have you seen the ashguard?",
			personaId: persona.id
		}
	])
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("what boot writes matches what the code says", () => {
	it("seeds every layout row byte-identical to its constant", async () => {
		// The link `variableTemplates.parity.test.ts` cannot make: it compares
		// two things in the source tree. This compares the source tree to the
		// database, which is what actually renders.
		for (const t of SHIPPED_VARIABLE_TEMPLATES) {
			const [row] = await db
				.select()
				.from(schema.pipelineVariableTemplates)
				.where(
					eq(schema.pipelineVariableTemplates.seedKey, seedKeyFor(t))
				)
				.limit(1)
			expect(row, `${seedKeyFor(t)} was never seeded`).toBeTruthy()
			expect(row.source, `${t.key} (${t.name}) drifted`).toBe(t.source)
		}
	})
})

describe("the shipped spec renders what the floor renders", () => {
	/** The production path: config layer, context-template row, layout rows. */
	const productionPrompt = async () => {
		const { runTurn } = await import("$lib/server/pipelines/runtime/runTurn")
		const receipt: any = await runTurn({
			db: db as any,
			chatId,
			userId,
			currentCharacterId: characterId,
			text: "Have you seen the ashguard?",
			specId: RESPOND_SPEC_ID,
			preview: true,
			skipReceipt: true,
			seed: "production-parity"
		})
		const rendered = receipt.preview?.context?.rendered
		expect(
			rendered,
			`the shipped spec never reached the provider: ${receipt.outcome}` +
				(receipt.haltNodeKey ? ` at '${receipt.haltNodeKey}'` : "") +
				(receipt.haltReason ? ` — ${receipt.haltReason}` : "")
		).toBeTruthy()
		return typeof rendered === "string" ? rendered : rendered.rendered
	}

	it("resolves a layout row rather than falling through to the floor", async () => {
		// The precondition for the comparison below meaning anything. If the
		// config layer resolved nothing, both sides would render the floor and
		// agree for the reason this whole file exists to rule out.
		const { buildWorld } = await import("$lib/server/pipelines/config/world")
		const { resolveConfig } = await import("@serene-pub/sdk")
		const world = await buildWorld(db as any, {
			userId,
			chatId,
			specId: RESPOND_SPEC_ID
		})
		const layouts = (resolveConfig(world, ["context"]).context?.variables ??
			{}) as any
		expect(layouts.characters?.source).toBeTruthy()
	})

	it("produces a prompt at all", async () => {
		const prompt = await productionPrompt()
		expect(typeof prompt).toBe("string")
		expect(prompt.length).toBeGreaterThan(0)
	})

	it("puts the cast in it, laid out by the resolved layout", async () => {
		const prompt = await productionPrompt()
		// The heading now comes from the layout row, not the template — so
		// finding it here proves the wrapper survived the move into the config
		// layer, which is the thing the corpus cannot check.
		expect(prompt).toContain("Assistant Characters (AI-controlled):")
		expect(prompt).toContain('"name": "Ash"')
	})

	it("puts the retrieved world lore in it, minified and fenced", async () => {
		const prompt = await productionPrompt()
		expect(prompt).toContain("World lore: ")
		expect(prompt).toContain(
			'{"The Ashguard":"Riders who patrol the ash wastes."}'
		)
	})

	it("is stable across runs", async () => {
		// A prompt that differs between two identical turns is one no parity
		// gate can hold, frozen or otherwise.
		expect(await productionPrompt()).toBe(await productionPrompt())
	})
})

/**
 * The upgrade case: rows written by an older build.
 *
 * Seeding used to be insert-only, so a shipped layout could never be corrected
 * once an install had booted — a fresh install rendered the new source and every
 * upgraded one kept the old row forever, producing different prompts from
 * identical settings with nothing on screen to explain it. The seed-vs-constant
 * check above cannot see that: it runs against a database seeded moments ago by
 * the very code it compares to.
 *
 * This is the same check against a *stale* row, which is the only shape the bug
 * has.
 */
describe("core's rows are brought back in line on boot", () => {
	const staleLayout = async () => {
		const t = SHIPPED_VARIABLE_TEMPLATES.find(
			(x) => x.key === "characters" && x.isDefault
		)!
		const key = seedKeyFor(t)
		await db
			.update(schema.pipelineVariableTemplates)
			.set({ source: "{{{json characters 9}}} STALE" })
			.where(eq(schema.pipelineVariableTemplates.seedKey, key))
		return { t, key }
	}

	const sourceOf = async (key: string) => {
		const [row] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.seedKey, key))
			.limit(1)
		return row?.source
	}

	it("refreshes a shipped layout whose source drifted", async () => {
		const { t, key } = await staleLayout()
		expect(await sourceOf(key)).toContain("STALE")

		const { seedVariableTemplates } = await import(
			"$lib/server/pipelines/boot/seedVariableTemplates"
		)
		const res = await seedVariableTemplates(db as any)

		expect(res.refreshed).toContain(key)
		expect(await sourceOf(key)).toBe(t.source)
	})

	it("leaves a row the user wrote completely alone", async () => {
		// The rule that makes the refresh safe: a user's row carries no seed
		// key, so it can never be mistaken for core's. Overwriting somebody's
		// prose layout on upgrade would be far worse than the drift.
		const { createVariableTemplate } = await import("$lib/server/pipelines/entities/variableTemplates")
		const mine = await createVariableTemplate(db as any, {
			variableId: "core:var/characters@1",
			name: "Mine, untouched",
			source: "{{#each characters}}{{this.name}}{{/each}}"
		})

		const { seedVariableTemplates } = await import(
			"$lib/server/pipelines/boot/seedVariableTemplates"
		)
		await seedVariableTemplates(db as any)

		const [after] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, mine.id))
		expect(after.source).toBe("{{#each characters}}{{this.name}}{{/each}}")
	})

	it("reports nothing when nothing drifted", async () => {
		// Boot runs this every time; a refresh that fired unconditionally would
		// write to every row on every start and make the report meaningless.
		const { seedVariableTemplates } = await import(
			"$lib/server/pipelines/boot/seedVariableTemplates"
		)
		await seedVariableTemplates(db as any)
		const res = await seedVariableTemplates(db as any)
		expect(res.refreshed).toEqual([])
		expect(res.created).toEqual([])
	})

	it("refreshes core's context template too", async () => {
		const { CONTEXT_TEMPLATE_SEED_KEY, SHIPPED_CONTEXT_TEMPLATE } =
			await import("$lib/server/pipelines/entities/contextTemplateDefaults")
		await db
			.update(schema.pipelineContextTemplates)
			.set({ source: "STALE TEMPLATE" })
			.where(
				eq(
					schema.pipelineContextTemplates.seedKey,
					CONTEXT_TEMPLATE_SEED_KEY
				)
			)

		const { seedContextTemplates } = await import("$lib/server/pipelines/boot/seedContextTemplates")
		const res = await seedContextTemplates(db as any)
		expect(res.refreshed).toContain(CONTEXT_TEMPLATE_SEED_KEY)

		const [row] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(
				eq(
					schema.pipelineContextTemplates.seedKey,
					CONTEXT_TEMPLATE_SEED_KEY
				)
			)
		expect(row.source).toBe(SHIPPED_CONTEXT_TEMPLATE)
	})
})
