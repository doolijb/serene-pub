/**
 * A shipped row yields its name to a person's row (owner go 2026-10-13).
 *
 * Prompts, context templates and variable templates are unique by name in
 * their pool. A person may already hold a name the catalog ships: the seed
 * must boot anyway, with the shipped row as "‹name› (Built-in)", leave the
 * person's row alone, stay put on the next boot, and take its plain name
 * back once it is free. Each seeder is run through all three.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "shipped-names-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-shipped-names-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("prompts", () => {
	it("a person's row keeps the name; the shipped row yields, holds, then takes it back", async () => {
		const { CORE_PROMPTS } = await import("@serene-pub/core-catalog")
		const { seedPipelinePrompts } = await import(
			"$lib/server/pipelines/boot/seedPrompts"
		)
		const brief = CORE_PROMPTS.find((p) => p.name === "Roleplay - Brief")!
		const [shipped] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.seedKey, brief.seedKey))
		// As on a pub where the person wrote "Roleplay - Brief" before it shipped.
		await db
			.delete(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, shipped!.id))
		const [mine] = await db
			.insert(schema.pipelinePrompts)
			.values({
				nodeDefinitionId: shipped!.nodeDefinitionId,
				slot: shipped!.slot,
				name: "Roleplay - Brief",
				fields: { systemPrompt: "my own words" }
			})
			.returning()

		await seedPipelinePrompts(db)
		const named = async (name: string) =>
			db
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.name, name))
		const [built] = await named("Roleplay - Brief (Built-in)")
		expect(built?.seedKey).toBe(brief.seedKey)
		expect(built?.isImmutable).toBe(true)
		const [theirs] = await named("Roleplay - Brief")
		expect(theirs?.id).toBe(mine!.id)
		expect(theirs?.fields).toEqual({ systemPrompt: "my own words" })

		// Stable: the next boot leaves it where it is.
		const again = await seedPipelinePrompts(db)
		expect(again.some((r) => r.present.includes(brief.seedKey))).toBe(true)

		// Their row goes; the shipped row takes the plain name back.
		await db
			.delete(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, mine!.id))
		const back = await seedPipelinePrompts(db)
		expect(back.some((r) => r.refreshed.includes(brief.seedKey))).toBe(true)
		const [restored] = await named("Roleplay - Brief")
		expect(restored?.seedKey).toBe(brief.seedKey)
		expect(await named("Roleplay - Brief (Built-in)")).toHaveLength(0)
	}, 60_000)
})

describe("context templates", () => {
	it("a person's row keeps the name; the shipped row yields, holds, then takes it back", async () => {
		const { seedContextTemplates, LAIR_TRANSCRIPT_SEED_KEY } = await import(
			"$lib/server/pipelines/boot/seedContextTemplates"
		)
		const [shipped] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(
				eq(
					schema.pipelineContextTemplates.seedKey,
					LAIR_TRANSCRIPT_SEED_KEY
				)
			)
		const plain = shipped!.name
		await db
			.delete(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.id, shipped!.id))
		const [mine] = await db
			.insert(schema.pipelineContextTemplates)
			.values({
				nodeDefinitionId: shipped!.nodeDefinitionId,
				engine: shipped!.engine,
				name: plain,
				source: "my own layout"
			})
			.returning()

		const first = await seedContextTemplates(db)
		expect(first.created).toContain(LAIR_TRANSCRIPT_SEED_KEY)
		const bySeed = async () =>
			(
				await db
					.select()
					.from(schema.pipelineContextTemplates)
					.where(
						eq(
							schema.pipelineContextTemplates.seedKey,
							LAIR_TRANSCRIPT_SEED_KEY
						)
					)
			)[0]
		expect((await bySeed())?.name).toBe(`${plain} (Built-in)`)
		const [theirs] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.id, mine!.id))
		expect(theirs?.name).toBe(plain)
		expect(theirs?.source).toBe("my own layout")

		expect((await seedContextTemplates(db)).present).toContain(
			LAIR_TRANSCRIPT_SEED_KEY
		)

		await db
			.delete(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.id, mine!.id))
		expect((await seedContextTemplates(db)).refreshed).toContain(
			LAIR_TRANSCRIPT_SEED_KEY
		)
		expect((await bySeed())?.name).toBe(plain)
	}, 60_000)
})

describe("variable templates", () => {
	it("a person's row keeps the name; the shipped row yields, holds, then takes it back", async () => {
		const { seedVariableTemplates } = await import(
			"$lib/server/pipelines/boot/seedVariableTemplates"
		)
		const [shipped] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.isImmutable, true))
			.limit(1)
		const key = shipped!.seedKey!
		const plain = shipped!.name
		await db
			.delete(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, shipped!.id))
		const [mine] = await db
			.insert(schema.pipelineVariableTemplates)
			.values({
				variableId: shipped!.variableId,
				engine: shipped!.engine,
				name: plain,
				source: "my own layout"
			})
			.returning()

		const first = await seedVariableTemplates(db)
		expect(first.created).toContain(key)
		const bySeed = async () =>
			(
				await db
					.select()
					.from(schema.pipelineVariableTemplates)
					.where(eq(schema.pipelineVariableTemplates.seedKey, key))
			)[0]
		expect((await bySeed())?.name).toBe(`${plain} (Built-in)`)
		const [theirs] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, mine!.id))
		expect(theirs?.name).toBe(plain)
		expect(theirs?.source).toBe("my own layout")

		expect((await seedVariableTemplates(db)).present).toContain(key)

		await db
			.delete(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, mine!.id))
		expect((await seedVariableTemplates(db)).refreshed).toContain(key)
		expect((await bySeed())?.name).toBe(plain)
	}, 60_000)
})
