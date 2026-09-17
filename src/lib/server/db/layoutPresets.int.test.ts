/**
 * The layout-preset reconciler seeds one default per genre by seed key and
 * prunes stale seeded rows — WITHOUT ever touching a user's own preset. These
 * pin, for `session_layout_presets`, the same upgrade-safety invariants
 * `widgetStyles.int.test.ts` pins for `widget_styles`.
 *
 * The user-row test is the one that matters: a past bug appended a seeded row
 * at a hardcoded id and overwrote a user's own config on upgrade.
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
		path.join(os.tmpdir(), "serene-pub-layoutpresets-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const sync = async (genreIds: string[]) =>
	(await import("./layoutPresets")).syncLayoutPresets(
		genreIds.map((genreId) => ({ genreId }))
	)

/** Every seeded (system) row — author NULL, seed key set. */
const seededRows = () =>
	testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(isNull(schema.sessionLayoutPresets.authorUserId))

const bySeedKey = (key: string) =>
	testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.seedKey, key))

describe("a genre that ships an arrangement", () => {
	test("seeds the layout and the name the genre declared, not the empty floor", async () => {
		const { CORE_LAYOUT_PRESETS } = await import("@serene-pub/core-catalog")
		const shipped = CORE_LAYOUT_PRESETS.find(
			(l) => l.genreId === "core:genre/adventure"
		)!
		const { syncLayoutPresets } = await import("./layoutPresets")
		// The bare id first and the furnished entry after it, exactly as
		// the boot task unions them.
		await syncLayoutPresets([{ genreId: shipped.genreId }, shipped])
		const [row] = await bySeedKey(layoutPresetSeedKey(shipped.genreId))
		expect(row.name).toBe("Adventure")
		expect(row.authorUserId).toBeNull()
		const layout = row.layout as any
		expect(layout.zoneLayout.zones.right.widgets).toEqual([
			"scene-portraits",
			"stats",
			"inventory"
		])
		expect(layout.widgetGrid.widgets.map((w: any) => w.id)).toEqual([
			"world-state",
			"messages"
		])
	}, 60_000)

	test("a genre that ships none still gets the empty floor", async () => {
		await sync(["plugin:genre/plain"])
		const [row] = await bySeedKey(layoutPresetSeedKey("plugin:genre/plain"))
		expect(row.name).toBe("Default")
		expect(row.layout).toEqual({})
	}, 60_000)
})

describe("syncLayoutPresets", () => {
	test("seeds a default preset per genre, keyed by layoutPresetSeedKey", async () => {
		await sync(["core:genre/chat", "plugin:genre/vn"])
		const rows = await seededRows()
		const keys = rows.map((r) => r.seedKey)
		expect(keys).toContain(layoutPresetSeedKey("core:genre/chat"))
		expect(keys).toContain(layoutPresetSeedKey("plugin:genre/vn"))
		const [chat] = await bySeedKey(layoutPresetSeedKey("core:genre/chat"))
		expect(chat.genreId).toBe("core:genre/chat")
		expect(chat.authorUserId).toBeNull()
		expect(chat.name).toBe("Default")
		// The shipped default is "no overrides" — that empty layout is what
		// keeps every existing session rendering exactly as it does today.
		expect(chat.layout).toEqual({})
	}, 60_000)

	test("is idempotent — a second sync neither duplicates nor renumbers", async () => {
		await sync(["core:genre/chat"])
		const [before] = await bySeedKey(layoutPresetSeedKey("core:genre/chat"))
		await sync(["core:genre/chat"])
		const rows = await bySeedKey(layoutPresetSeedKey("core:genre/chat"))
		expect(rows).toHaveLength(1)
		expect(rows[0].id).toBe(before.id)
	}, 60_000)

	test("de-duplicates a repeated genre id (the unique seed key would collide)", async () => {
		await sync(["dup:genre/x", "dup:genre/x"])
		const rows = await bySeedKey(layoutPresetSeedKey("dup:genre/x"))
		expect(rows).toHaveLength(1)
	}, 60_000)

	test("re-forces an edited seeded row's content", async () => {
		await sync(["core:genre/chat"])
		await testDb
			.update(schema.sessionLayoutPresets)
			.set({ name: "tampered", layout: { hacked: true } })
			.where(
				eq(
					schema.sessionLayoutPresets.seedKey,
					layoutPresetSeedKey("core:genre/chat")
				)
			)
		await sync(["core:genre/chat"])
		const [r] = await bySeedKey(layoutPresetSeedKey("core:genre/chat"))
		expect(r.name).toBe("Default")
		expect(r.layout).toEqual({})
	}, 60_000)

	test("does NOT touch a user's own preset, even on a sync that ships its genre", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "layout-preset-owner")
		await sync(["core:genre/chat"])
		const [mine] = await testDb
			.insert(schema.sessionLayoutPresets)
			.values({
				seedKey: null,
				genreId: "core:genre/chat",
				authorUserId: user.id,
				name: "My Layout",
				layout: { zoneLayout: { version: 1, mine: true } }
			})
			.returning()

		// Both a re-sync of that same genre and a sync that drops it must
		// spare the user's row.
		await sync(["core:genre/chat"])
		await sync(["other:genre/thing"])

		const [after] = await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(eq(schema.sessionLayoutPresets.id, mine.id))
		expect(after).toEqual(mine)
	}, 60_000)

	test("prune is scoped to the synced genre ids — other genres' defaults survive", async () => {
		await sync(["scoped:genre/a", "scoped:genre/b"])
		// A later sync of ONLY a must not prune b's default.
		await sync(["scoped:genre/a"])
		const rows = await bySeedKey(layoutPresetSeedKey("scoped:genre/b"))
		expect(rows).toHaveLength(1)
	}, 60_000)

	test("prunes a stale seeded row whose key no longer matches its genre", async () => {
		await sync(["stale:genre/a"])
		// A row left behind by an older key scheme, still claiming that genre.
		await testDb.insert(schema.sessionLayoutPresets).values({
			seedKey: "layout-v0:stale:genre/a",
			genreId: "stale:genre/a",
			authorUserId: null,
			name: "Old Default",
			layout: {}
		})
		await sync(["stale:genre/a"])
		expect(await bySeedKey("layout-v0:stale:genre/a")).toHaveLength(0)
		expect(
			await bySeedKey(layoutPresetSeedKey("stale:genre/a"))
		).toHaveLength(1)
	}, 60_000)

	test("an empty genre list is a no-op, not an unbounded delete", async () => {
		await sync(["empty:genre/a"])
		const before = await seededRows()
		expect(before.length).toBeGreaterThan(0)
		await sync([])
		const after = await seededRows()
		expect(after.map((r) => r.id).sort()).toEqual(
			before.map((r) => r.id).sort()
		)
	}, 60_000)

	test("never assigns an explicit id — seeded rows come from the sequence", async () => {
		// A row already sitting at a low id must not be clobbered by a seed
		// that hardcodes one (the bug this rule exists for).
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "layout-preset-squatter")
		const [squatter] = await testDb
			.insert(schema.sessionLayoutPresets)
			.values({
				seedKey: null,
				genreId: "squat:genre/x",
				authorUserId: user.id,
				name: "Squatter",
				layout: { squatter: true }
			})
			.returning()
		await sync(["squat:genre/x", "squat:genre/y", "squat:genre/z"])
		const [after] = await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(eq(schema.sessionLayoutPresets.id, squatter.id))
		expect(after).toEqual(squatter)
	}, 60_000)

	test("an authored row holding the shipped seed key is left alone, not re-forced or collided with", async () => {
		// `seed_key` is globally unique, so this row is the one case where a
		// user row and the reconciler contend for the same key. It must be
		// skipped outright: not re-forced (its content survives), and not
		// inserted over (no unique violation aborting the boot seed).
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "layout-preset-hybrid")
		const [hybrid] = await testDb
			.insert(schema.sessionLayoutPresets)
			.values({
				seedKey: layoutPresetSeedKey("hybrid:genre/x"),
				genreId: "hybrid:genre/x",
				authorUserId: user.id,
				name: "Mine",
				layout: { mine: true }
			})
			.returning()
		await expect(sync(["hybrid:genre/x"])).resolves.toBeUndefined()
		const [after] = await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(eq(schema.sessionLayoutPresets.id, hybrid.id))
		expect(after).toEqual(hybrid)
		// No shadow seeded row was created either.
		const seeded = await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(
				and(
					eq(schema.sessionLayoutPresets.genreId, "hybrid:genre/x"),
					isNull(schema.sessionLayoutPresets.authorUserId)
				)
			)
		expect(seeded).toHaveLength(0)
	}, 60_000)
})
