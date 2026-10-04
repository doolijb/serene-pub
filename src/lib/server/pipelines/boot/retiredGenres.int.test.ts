/**
 * The boot culls what core shipped for a genre that left core.
 *
 * Core seeds what its catalog declares and never culls what it stopped
 * declaring, and a genre is listed from its published create spec — so an
 * install that booted a build which shipped Whodunit or the Writing Room keeps
 * both in the picker, with their prompts, preset and layout rows, until
 * something deletes them. `cullRetiredCoreGenres` is that something, on every
 * boot. This puts such rows back on a booted database the way an older build
 * left them, boots again, and checks that they are gone and that what a person
 * wrote is not.
 */

import { describe, it, expect } from "vitest"
import { eq, inArray } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/contracts"
import "@serene-pub/core-catalog"

const WHODUNIT = "core:genre/whodunit"
const WRITING_ROOM = "core:genre/writing-room"
const CREATE = "core:event/session-created@1"

const bootstrap = async (db: TestDb) => {
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	return await bootstrapPipelines(db)
}

const genreIds = async (db: TestDb) => {
	const { listSessionGenres } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	return (await listSessionGenres(db as any)).map((g) => g.genreId)
}

/** A create spec as an older build published it: the genre on the version row. */
async function staleCreateSpec(db: TestDb, slug: string, genreId: string, name: string) {
	const [spec] = await db
		.insert(schema.pipelineSpecs)
		.values({ slug, name })
		.returning()
	const [version] = await db
		.insert(schema.pipelineSpecVersions)
		.values({
			specId: spec!.id,
			semver: "1.0.0",
			status: "published",
			canonicalHash: `stale-${slug}`,
			inputGenre: genreId,
			inputEvent: CREATE,
			genre: { name: { en: name }, shape: { characters: { min: 0 } } }
		} as any)
		.returning()
	await db
		.update(schema.pipelineSpecs)
		.set({ activeVersionId: version!.id })
		.where(eq(schema.pipelineSpecs.id, spec!.id))
	return spec!.id
}

/** What an older build left behind, plus one row a person wrote. */
async function stageLeftovers(db: TestDb) {
	const whodunitCreate = await staleCreateSpec(db, "core:spec/whodunit-create", WHODUNIT, "Whodunit")
	await staleCreateSpec(db, "core:spec/writing-room-create", WRITING_ROOM, "Writing Room")
	await db.insert(schema.pipelineConfigs).values({
		specId: whodunitCreate,
		seedKey: "pipeline-default:core:spec/whodunit-create",
		name: "Whodunit",
		isImmutable: true,
		isDefault: true
	})
	await db.insert(schema.pipelinePrompts).values({
		nodeDefinitionId: "core:task/build-planner-context",
		slot: "prompts",
		seedKey: "pipeline-prompt:core:task/build-planner-context:prompts:whodunit-judge",
		name: "Whodunit judge",
		isImmutable: true,
		fields: { systemPrompt: "The case is over." }
	})
	await db.insert(schema.sessionPresets).values({
		seedKey: "core-writing-room-default",
		name: "Writing Room",
		genreId: WRITING_ROOM,
		isImmutable: true
	})
	await db.insert(schema.sessionLayoutPresets).values({
		seedKey: `layout:${WHODUNIT}:core/default`,
		genreId: WHODUNIT,
		origin: "core",
		authorUserId: null,
		slug: "default",
		visibility: "shared",
		name: "Whodunit",
		layout: {}
	})
	await db.insert(schema.sessionGenreSettings).values({ genreId: WHODUNIT, enabled: false })
	// What a person wrote — never core's to delete.
	await db.insert(schema.sessionPresets).values({
		name: "My mystery",
		genreId: WHODUNIT,
		isImmutable: false
	})
}

describe("the boot · retired core genres", () => {
	it(
		"culls the rows core shipped for a retired genre, and keeps what a person wrote",
		async () => {
			const db = await createTestDb()
			await bootstrap(db)
			await stageLeftovers(db)
			expect(await genreIds(db)).toEqual(expect.arrayContaining([WHODUNIT, WRITING_ROOM]))

			await bootstrap(db)

			const genres = await genreIds(db)
			expect(genres).not.toContain(WHODUNIT)
			expect(genres).not.toContain(WRITING_ROOM)
			for (const kept of ["core:genre/chat", "core:genre/adventure", "core:genre/guide", "core:genre/lair"])
				expect(genres).toContain(kept)
			expect(
				await db
					.select()
					.from(schema.pipelineSpecs)
					.where(
						inArray(schema.pipelineSpecs.slug, [
							"core:spec/whodunit-create",
							"core:spec/writing-room-create"
						])
					)
			).toEqual([])
			expect(
				await db
					.select()
					.from(schema.pipelinePrompts)
					.where(
						eq(
							schema.pipelinePrompts.seedKey,
							"pipeline-prompt:core:task/build-planner-context:prompts:whodunit-judge"
						)
					)
			).toEqual([])
			const presets = await db
				.select()
				.from(schema.sessionPresets)
				.where(inArray(schema.sessionPresets.genreId, [WHODUNIT, WRITING_ROOM]))
			expect(presets.map((p) => p.name)).toEqual(["My mystery"])
			expect(
				await db
					.select()
					.from(schema.sessionLayoutPresets)
					.where(inArray(schema.sessionLayoutPresets.genreId, [WHODUNIT, WRITING_ROOM]))
			).toEqual([])
			expect(
				await db
					.select()
					.from(schema.sessionGenreSettings)
					.where(eq(schema.sessionGenreSettings.genreId, WHODUNIT))
			).toEqual([])

			// And the boot after that finds nothing to cull and seeds none of it back.
			await bootstrap(db)
			const after = await genreIds(db)
			expect(after).not.toContain(WHODUNIT)
			expect(after).not.toContain(WRITING_ROOM)
		},
		240_000
	)
})

describe("the boot · retired core specs", () => {
	it(
		"Echo (owner note 35): a core:spec/echo row an older build left is deleted, a person's spec is not",
		async () => {
			const { cullRetiredCoreSpecs } = await import(
				"$lib/server/pipelines/boot/retiredGenres"
			)
			const db = await createTestDb()
			const [echo] = await db
				.insert(schema.pipelineSpecs)
				.values({ slug: "core:spec/echo", name: "Echo" })
				.returning()
			await db.insert(schema.pipelineConfigs).values({
				specId: echo!.id,
				seedKey: "pipeline-default:core:spec/echo",
				name: "Review on",
				isImmutable: true,
				isDefault: true
			})
			await db
				.insert(schema.pipelineSpecs)
				.values({ slug: "user:spec/echo", name: "My echo" })
			expect(await cullRetiredCoreSpecs(db)).toBe(1)
			const left = await db.select({ slug: schema.pipelineSpecs.slug }).from(schema.pipelineSpecs)
			expect(left.map((r) => r.slug)).toContain("user:spec/echo")
			expect(left.map((r) => r.slug)).not.toContain("core:spec/echo")
			expect(
				await db
					.select()
					.from(schema.pipelineConfigs)
					.where(eq(schema.pipelineConfigs.seedKey, "pipeline-default:core:spec/echo"))
			).toEqual([])
			// Nothing left to cull on the next boot.
			expect(await cullRetiredCoreSpecs(db)).toBe(0)
		},
		60_000
	)
})
