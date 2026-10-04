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
	await syncLayoutPresets([STANDARD_GENRE_ID, ...genres.map((g) => g.genreId)])
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

describe("boot seeds every core genre's layouts", () => {
	// ⚠ ORDER-SENSITIVE, deliberately. These tests share one database, so only
	// the FIRST pass runs against a pristine one — and a pristine database is
	// the only place the seed-after-publish ordering is observable. Run the
	// ordering assertion later and a previous pass's published specs mask a
	// seed that ran too early. Keep this test first.
	test(
		"one boot pass on a fresh database seeds every core genre it publishes",
		async () => {
			const genres = await bootSeed()
			// Empty here means the genre list was read before the specs were
			// published: the seed would be vacuous, covering only the floor.
			expect(
				genres.length,
				"no genres visible at seed time — the seed ran before the specs were published"
			).toBeGreaterThan(0)
			const { getGenre } = await import("@serene-pub/sdk")
			for (const g of genres) {
				const rows = await seededFor(g.genreId)
				// A plugin's genre is its owner's to lay out; core seeds only its own.
				if (!g.genreId.startsWith("core:")) {
					expect(rows, `core seeded ${g.genreId}`).toHaveLength(0)
					continue
				}
				expect(
					rows,
					`no default preset seeded for ${g.genreId}`
				).toHaveLength(1)
				// …holding exactly the layout the genre declares, or the floor.
				expect(rows[0].layout, g.genreId).toEqual(
					getGenre(g.genreId)?.layouts?.[0]?.preset ?? {}
				)
			}
			// …and the standard genre, unioned in regardless — Chat, whose
			// default places the Author's note (2026-10-03).
			const std = await seededFor("core:genre/chat")
			expect(std).toHaveLength(1)
			expect(std[0].name).toBe("Chat")
			expect(std[0].layout).toEqual(getGenre("core:genre/chat")?.layouts?.[0]?.preset)
		},
		60_000
	)

	test(
		"a second boot writes nothing — same rows, same ids, no timestamp moved",
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
			// Nothing re-forced: `updated_at` and `layout_updated_at` are the
			// first boot's, so no shipped layout reads as Updated.
			const byId = new Map(before.map((r) => [r.id, r]))
			for (const r of after) expect(r).toEqual(byId.get(r.id))
		},
		60_000
	)
})
