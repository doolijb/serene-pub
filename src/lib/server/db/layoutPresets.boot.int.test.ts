/**
 * The boot seed wiring, at boot fidelity.
 *
 * The `layout-presets` startup task seeds from `listSessionGenres()`, which
 * reads PUBLISHED create specs — rows `bootstrapPipelines` writes, in an
 * earlier startup task. Everything else about presets is unit-testable, but
 * that ordering is not: get it wrong and the seed silently produces nothing
 * except the unioned standard floor, with no error and no failing test
 * anywhere. This is not hypothetical — the first version of the task lived
 * beside the other seeds in `db/index.ts`, which runs BEFORE pipelines
 * bootstrap, and this file is what caught it.
 *
 * It composes the same calls the task makes rather than importing
 * `$lib/server/startup`, because importing that module starts `appReady` at
 * module scope — recovery, plugins, shutdown handlers and all.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { layoutPresetSeedKey } from "$lib/shared/sessionLayout/presets"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-layoutpresets-boot-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** The startup sequence, down to the `layout-presets` task. */
async function bootSeed() {
	const { sync } = await import("./defaults")
	await sync()
	// …the `pipelines` startup task: this is what publishes the create specs
	// a genre id is read off.
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	const dbForBoot = (await import("$lib/server/db")).db
	await bootstrapPipelines(dbForBoot as any)
	// …then the `layout-presets` task itself.
	const { syncLayoutPresets } = await import("./layoutPresets")
	const { listSessionGenres, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const dbModule = await import("$lib/server/db")
	const genres = await listSessionGenres(dbModule.db)
	await syncLayoutPresets([
		{ genreId: STANDARD_GENRE_ID },
		...genres.map((g) => ({ genreId: g.genreId }))
	])
	return genres
}

const seededFor = (genreId: string) =>
	testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(
			and(
				eq(
					schema.sessionLayoutPresets.seedKey,
					layoutPresetSeedKey(genreId)
				),
				isNull(schema.sessionLayoutPresets.authorUserId)
			)
		)

describe("boot seeds a default layout preset per genre", () => {
	// ⚠ ORDER-SENSITIVE, deliberately. These tests share one database, so only
	// the FIRST pass runs against a pristine one — and a pristine database is
	// the only place the seed-after-publish ordering is observable. Run the
	// ordering assertion later and a previous pass's published specs mask a
	// seed that ran too early. Keep this test first.
	test(
		"one boot pass on a fresh database seeds every genre it publishes",
		async () => {
			const genres = await bootSeed()
			// Empty here means the genre list was read before the specs were
			// published: the seed would be vacuous, covering only the floor.
			expect(
				genres.length,
				"no genres visible at seed time — the seed ran before the specs were published"
			).toBeGreaterThan(0)
			for (const g of genres) {
				const rows = await seededFor(g.genreId)
				expect(
					rows,
					`no default preset seeded for ${g.genreId}`
				).toHaveLength(1)
			}
			// …and the standard floor, unioned in regardless.
			const std = await seededFor("core:genre/chat")
			expect(std).toHaveLength(1)
			expect(std[0].name).toBe("Default")
			expect(std[0].layout).toEqual({})
		},
		60_000
	)

	test(
		"a second boot changes nothing — same rows, same ids",
		async () => {
			await bootSeed()
			const before = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
			await bootSeed()
			const after = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
			expect(after.map((r) => r.id).sort()).toEqual(
				before.map((r) => r.id).sort()
			)
			expect(after).toHaveLength(before.length)
		},
		60_000
	)
})
