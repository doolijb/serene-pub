/**
 * The core layout reconciler seeds every layout a core genre declares by seed
 * key, writes only what changed, and prunes stale seeded rows — WITHOUT ever
 * touching a user's own preset, and without seeding anything for a plugin's
 * genre (that genre's layouts are its owner's). These pin, for
 * `session_layout_presets`, the same upgrade-safety invariants
 * `widgetStyles.int.test.ts` pins for `widget_styles`.
 *
 * The user-row test is the one that matters: a past bug appended a seeded row
 * at a hardcoded id and overwrote a user's own config on upgrade.
 *
 * Below the reconciler: the one live format end to end — storage, ownership,
 * save, list, share, re-capture and clone (ported from the retired
 * `layoutPresetsV2.int.test.ts`; the new-session layout's cases live in
 * `userLayoutDefaults.int.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	coreLayoutSeedKey,
	layoutPresetSeedKey
} from "$lib/shared/sessionLayout/presets"
import { genre, getGenre, layout } from "@serene-pub/sdk"
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
	(await import("./layoutPresets")).syncLayoutPresets(genreIds)

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

/** The layout a core genre declares first — what its default row must hold. */
const declaredDefault = async (genreId: string) => {
	await import("@serene-pub/core-catalog")
	return getGenre(genreId)!.layouts![0]!
}

describe("a core genre that ships an arrangement", () => {
	test("seeds the layout it declares, byte for byte, and its name — not the empty floor", async () => {
		await sync(["core:genre/adventure"])
		const [row] = await bySeedKey(layoutPresetSeedKey("core:genre/adventure"))
		const declared = await declaredDefault("core:genre/adventure")
		expect(row.name).toBe("Adventure")
		expect(row.authorUserId).toBeNull()
		// The ONE format: the row holds the genre's declared session layout.
		expect(JSON.stringify(row.layout)).toBe(JSON.stringify(declared.preset))
		const layout = row.layout as any
		// No Inventory: R79 removed that widget for now.
		expect(layout.zoneLayout.zones.right.widgets).toEqual([
			"scene-portraits",
			"stats"
		])
		expect(layout.widgetGrid.widgets.map((w: any) => w.id)).toEqual([
			"world-state",
			"messages"
		])
	}, 60_000)

	test("the core genres that declare a layout hold what each declares", async () => {
		const ids = ["core:genre/adventure", "core:genre/lair", "core:genre/chat"]
		await sync(ids)
		for (const genreId of ids) {
			const [row] = await bySeedKey(layoutPresetSeedKey(genreId))
			expect(row.layout, genreId).toEqual((await declaredDefault(genreId)).preset)
		}
	}, 60_000)

	test("Chat's places the Author's note, unpinned, in the right rail (2026-10-03)", async () => {
		await sync(["core:genre/chat"])
		const [row] = await bySeedKey(layoutPresetSeedKey("core:genre/chat"))
		const layout = row.layout as any
		expect(row.name).toBe("Chat")
		expect(layout.zoneLayout.zones.right).toMatchObject({
			pinned: false,
			widgets: ["authors-note"]
		})
		expect(layout.arrangedGrid.right.items).toEqual([
			expect.objectContaining({ id: "authors-note", pinned: false })
		])
		expect(layout.widgetGrid.widgets.map((w: any) => w.id)).toEqual(["messages"])
	}, 60_000)

	test("a core genre that declares none still gets the empty floor", async () => {
		await sync(["core:genre/guide"])
		const [row] = await bySeedKey(layoutPresetSeedKey("core:genre/guide"))
		expect(row.name).toBe("Default")
		expect(row.layout).toEqual({})
	}, 60_000)

	test("seeds EVERY layout a core genre declares, each under its own key", async () => {
		const twin = "core:genre/test-two-layouts"
		const floor = {
			widgetGrid: {
				version: 1 as const,
				cell: 44,
				widgets: [
					{
						id: "messages",
						zone: "middle" as const,
						order: 0,
						size: { w: "grow" as const, h: "grow" as const },
						anchor: { top: true, bottom: true, left: true, right: true }
					}
				]
			}
		}
		const wide = {
			...floor,
			zoneLayout: {
				version: 1 as const,
				zones: { right: { kind: "side" as const, widgets: ["stats"] } }
			}
		}
		genre(twin, {
			name: "Two layouts",
			family: "test",
			layouts: [
				layout({ slug: "default", name: "Plain", preset: floor }),
				layout({ slug: "wide", name: "Wide", description: "With stats", preset: wide })
			]
		})
		await sync([twin])
		const [def] = await bySeedKey(layoutPresetSeedKey(twin))
		const [other] = await bySeedKey(coreLayoutSeedKey(twin, "wide"))
		expect(coreLayoutSeedKey(twin, "wide")).toBe(`layout:${twin}:core/wide`)
		expect([def.slug, def.name, def.layout]).toEqual(["default", "Plain", floor])
		expect([other.slug, other.name, other.description, other.layout]).toEqual([
			"wide",
			"Wide",
			"With stats",
			wide
		])
		expect(other.origin).toBe("core")
	}, 60_000)
})

describe("a plugin's genre", () => {
	test("gets no core row — its layouts are its owner's", async () => {
		await sync(["plugin.one:genre/plain"])
		expect(await bySeedKey(layoutPresetSeedKey("plugin.one:genre/plain"))).toHaveLength(0)
	}, 60_000)

	test("loses the empty core row an older reconciler seeded for it, wherever it is", async () => {
		const stale = "plugin.two:genre/old"
		await testDb.insert(schema.sessionLayoutPresets).values({
			seedKey: layoutPresetSeedKey(stale),
			genreId: stale,
			origin: "core",
			authorUserId: null,
			slug: "default",
			visibility: "shared",
			name: "Default",
			layout: {}
		})
		// Pruned even by a sync that does not name the genre.
		await sync(["core:genre/chat"])
		expect(await bySeedKey(layoutPresetSeedKey(stale))).toHaveLength(0)
	}, 60_000)
})

describe("writing only what changed", () => {
	test("a second sync writes nothing: updated_at and layout_updated_at stay where they were", async () => {
		await sync(["core:genre/adventure"])
		const [before] = await bySeedKey(layoutPresetSeedKey("core:genre/adventure"))
		await new Promise((r) => setTimeout(r, 15))
		await sync(["core:genre/adventure"])
		const [after] = await bySeedKey(layoutPresetSeedKey("core:genre/adventure"))
		expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
		expect(after.layoutUpdatedAt.getTime()).toBe(before.layoutUpdatedAt.getTime())
		expect(after).toEqual(before)
	}, 60_000)

	test("a changed layout moves layout_updated_at; a changed name or version alone does not", async () => {
		const genreId = "core:genre/lair"
		await sync([genreId])
		const [seeded] = await bySeedKey(layoutPresetSeedKey(genreId))
		const stamp = new Date("2020-01-01T00:00:00Z")

		// Only the name drifted: re-forced, and the layout's stamp stays.
		await testDb
			.update(schema.sessionLayoutPresets)
			.set({ name: "Drifted", layoutUpdatedAt: stamp })
			.where(eq(schema.sessionLayoutPresets.id, seeded.id))
		await (await import("./layoutPresets")).syncLayoutPresets([genreId], { version: "9.9.9" })
		const [renamed] = await bySeedKey(layoutPresetSeedKey(genreId))
		expect(renamed.name).toBe("Lair")
		expect(renamed.seededByVersion).toBe("9.9.9")
		expect(renamed.layoutUpdatedAt.getTime()).toBe(stamp.getTime())

		// The layout drifted: re-forced, and stamped.
		await testDb
			.update(schema.sessionLayoutPresets)
			.set({ layout: { stale: true } })
			.where(eq(schema.sessionLayoutPresets.id, seeded.id))
		await (await import("./layoutPresets")).syncLayoutPresets([genreId], { version: "9.9.9" })
		const [moved] = await bySeedKey(layoutPresetSeedKey(genreId))
		expect(moved.layout).toEqual((await declaredDefault(genreId)).preset)
		expect(moved.layoutUpdatedAt.getTime()).toBeGreaterThan(stamp.getTime())
	}, 60_000)
})

describe("syncLayoutPresets", () => {
	test("seeds a default preset per core genre, keyed by layoutPresetSeedKey", async () => {
		await sync(["core:genre/guide", "plugin:genre/vn"])
		const rows = await seededRows()
		const keys = rows.map((r) => r.seedKey)
		expect(keys).toContain(layoutPresetSeedKey("core:genre/guide"))
		expect(keys).not.toContain(layoutPresetSeedKey("plugin:genre/vn"))
		const [guide] = await bySeedKey(layoutPresetSeedKey("core:genre/guide"))
		expect(guide.genreId).toBe("core:genre/guide")
		expect(guide.authorUserId).toBeNull()
		expect(guide.name).toBe("Default")
		// A genre that ships none gets "no overrides" — the empty layout
		// the page draws as the floor (the conversation alone).
		expect(guide.layout).toEqual({})
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
		await sync(["core:genre/dup-x", "core:genre/dup-x"])
		const rows = await bySeedKey(layoutPresetSeedKey("core:genre/dup-x"))
		expect(rows).toHaveLength(1)
	}, 60_000)

	test("re-forces an edited seeded row's content", async () => {
		await sync(["core:genre/guide"])
		await testDb
			.update(schema.sessionLayoutPresets)
			.set({ name: "tampered", layout: { hacked: true } })
			.where(
				eq(
					schema.sessionLayoutPresets.seedKey,
					layoutPresetSeedKey("core:genre/guide")
				)
			)
		await sync(["core:genre/guide"])
		const [r] = await bySeedKey(layoutPresetSeedKey("core:genre/guide"))
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
		await sync(["core:genre/other-thing"])

		const [after] = await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(eq(schema.sessionLayoutPresets.id, mine.id))
		expect(after).toEqual(mine)
	}, 60_000)

	test("prune is scoped to the synced genre ids — other genres' defaults survive", async () => {
		await sync(["core:genre/scoped-a", "core:genre/scoped-b"])
		// A later sync of ONLY a must not prune b's default.
		await sync(["core:genre/scoped-a"])
		const rows = await bySeedKey(layoutPresetSeedKey("core:genre/scoped-b"))
		expect(rows).toHaveLength(1)
	}, 60_000)

	test("prunes a stale seeded row whose key no longer matches its genre", async () => {
		await sync(["core:genre/stale-a"])
		// A row left behind by an older key scheme, still claiming that genre.
		await testDb.insert(schema.sessionLayoutPresets).values({
			seedKey: "layout-v0:core:genre/stale-a",
			genreId: "core:genre/stale-a",
			// Seeded rows are `origin: core` since the v2 migration (0141),
			// and the origin triple is a CHECK — a seed-keyed row cannot be
			// written as anything else.
			origin: "core",
			authorUserId: null,
			slug: "legacy-old",
			visibility: "shared",
			name: "Old Default",
			layout: {}
		})
		await sync(["core:genre/stale-a"])
		expect(await bySeedKey("layout-v0:core:genre/stale-a")).toHaveLength(0)
		expect(
			await bySeedKey(layoutPresetSeedKey("core:genre/stale-a"))
		).toHaveLength(1)
	}, 60_000)

	test("an empty genre list prunes no core genre's rows — not an unbounded delete", async () => {
		await sync(["core:genre/empty-a"])
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
				genreId: "core:genre/squat-x",
				authorUserId: user.id,
				name: "Squatter",
				layout: { squatter: true }
			})
			.returning()
		await sync(["core:genre/squat-x", "core:genre/squat-y", "core:genre/squat-z"])
		const [after] = await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(eq(schema.sessionLayoutPresets.id, squatter.id))
		expect(after).toEqual(squatter)
	}, 60_000)

	test("an authored row holding the shipped seed key cannot be written at all", async () => {
		// `seed_key` is globally unique, so this row used to be the one case
		// where a user row and the reconciler contended for the same key — and
		// the reconciler still skips one outright (`authorUserId !== null`),
		// for any that predate the constraint. Since the v2 migration (0141)
		// the shape itself is refused: the origin triple says a `user` row has
		// no seed key, so the contention has no way to arise in the first
		// place, and 0141's data step dropped the key from any that existed.
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "layout-preset-hybrid")
		await expect(
			testDb.insert(schema.sessionLayoutPresets).values({
				seedKey: layoutPresetSeedKey("core:genre/hybrid-x"),
				genreId: "core:genre/hybrid-x",
				origin: "user",
				authorUserId: user.id,
				slug: "mine",
				name: "Mine",
				layout: { mine: true }
			})
		).rejects.toThrow()
		// …and the genre still seeds normally afterwards.
		await expect(sync(["core:genre/hybrid-x"])).resolves.toBeUndefined()
		const seeded = await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(
				and(
					eq(schema.sessionLayoutPresets.genreId, "core:genre/hybrid-x"),
					isNull(schema.sessionLayoutPresets.authorUserId)
				)
			)
		expect(seeded).toHaveLength(1)
	}, 60_000)
})

/* ── the live format end to end (ported from the retired
 * `layoutPresetsV2.int.test.ts`, brief 2 of PLAN-layout-one-format) ──────── */

let n = 0
/** A genre id nothing else in this file touches. */
const freshGenre = () => `core:genre/test-live-${n++}`

const presets = () => import("./layoutPresets")

const rowById = async (id: number) => {
	const [row] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.id, id))
	return row
}

const user = async (label: string) => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `lp-${label}-${n++}`)
}

/** A small live-format layout, told apart by the widget it puts on the right. */
const layoutNaming = (widget: string) => ({
	zoneLayout: { version: 1, zones: { right: { kind: "side", widgets: [widget] } } },
	widgetSettings: { [widget]: { title: widget } }
})

const columnsOf = async (table: string) =>
	(
		(
			await testDb.execute(
				sql`SELECT column_name FROM information_schema.columns
					WHERE table_name = ${table}`
			)
		).rows as Array<{ column_name: string }>
	).map((r) => r.column_name)

describe("the storage", () => {
	test("holds one format: the v2 columns are gone, the copy model's are there", async () => {
		const presetCols = await columnsOf("session_layout_presets")
		for (const c of [
			"origin",
			"plugin_id",
			"withdrawn_at",
			"slug",
			"description",
			"visibility",
			"layout",
			"layout_updated_at",
			"seeded_by_version"
		])
			expect(presetCols).toContain(c)
		for (const c of ["document", "widget_settings", "widget_styles"])
			expect(presetCols).not.toContain(c)

		const panelCols = await columnsOf("session_panel_layouts")
		expect(panelCols).toContain("layout_preset_id")
		expect(panelCols).toContain("layout_copied_at")
		expect(panelCols).not.toContain("document")

		// The new-session layout's table stays (owner L4).
		expect(await columnsOf("user_layout_defaults")).toContain(
			"layout_preset_id"
		)
	}, 60_000)

	test("a new row's layout_updated_at is set; a session row's layout_copied_at starts null", async () => {
		const genreId = freshGenre()
		const owner = await user("stamp")
		const { saveUserLayoutPreset } = await presets()
		const saved = await saveUserLayoutPreset({
			genreId,
			userId: owner.id,
			name: "Stamped",
			layout: layoutNaming("stats")
		})
		expect((await rowById(saved.id)).layoutUpdatedAt).toBeInstanceOf(Date)

		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: true, genreId })
			.returning()
		const [panel] = await testDb
			.insert(schema.sessionPanelLayouts)
			.values({
				sessionId: session.id,
				userId: owner.id,
				startedFromLayoutPresetId: saved.id
			})
			.returning()
		expect(panel.startedFromLayoutPresetId).toBe(saved.id)
		expect(panel.layoutCopiedAt).toBeNull()
	}, 60_000)

	test("the origin triple and the visibility set are enforced, not advisory", async () => {
		// `user` with no author: refused by the triple CHECK.
		await expect(
			testDb.insert(schema.sessionLayoutPresets).values({
				genreId: freshGenre(),
				origin: "user",
				authorUserId: null,
				slug: "nope",
				name: "No author"
			})
		).rejects.toThrow()
		// A visibility nobody declared.
		const u = await user("check")
		await expect(
			testDb.insert(schema.sessionLayoutPresets).values({
				genreId: freshGenre(),
				origin: "user",
				authorUserId: u.id,
				slug: "nope-2",
				name: "Bad visibility",
				visibility: "public"
			})
		).rejects.toThrow()
	}, 60_000)
})

describe("the core reconciler's ownership fields", () => {
	test("writes origin, slug, visibility and provenance beside the shipped layout", async () => {
		const genreId = "core:genre/adventure"
		const shipped = await declaredDefault(genreId)
		const { syncLayoutPresets } = await presets()
		await syncLayoutPresets([genreId], { version: "9.9.9" })
		const [row] = await bySeedKey(layoutPresetSeedKey(genreId))
		expect(row.origin).toBe("core")
		expect(row.slug).toBe("default")
		expect(row.visibility).toBe("shared")
		expect(row.authorUserId).toBeNull()
		expect(row.pluginId).toBeNull()
		expect(row.seededByVersion).toBe("9.9.9")
		// The shipped session layout, verbatim — the only thing a row stores.
		expect(row.layout).toEqual(shipped.preset)
	}, 60_000)

	test("names a core genre's row after its declared layout", async () => {
		await sync(["core:genre/adventure"])
		const [row] = await bySeedKey(layoutPresetSeedKey("core:genre/adventure"))
		expect(row.name).toBe("Adventure")
	}, 60_000)
})

describe("a person's own rows", () => {
	test("a save writes origin, a slug from the name, private, and the layout verbatim", async () => {
		const genreId = freshGenre()
		const owner = await user("save")
		const { saveUserLayoutPreset } = await presets()
		const layout = layoutNaming("world-state")
		const saved = await saveUserLayoutPreset({
			genreId,
			userId: owner.id,
			name: "My Wide Table!",
			description: "  two columns  ",
			layout
		})
		// The wire is the live shape: a person's row is theirs to manage.
		expect(saved.isGenreDefault).toBe(false)
		expect(saved.mine).toBe(true)
		expect(saved.origin).toBe("user")
		expect(saved.layout).toEqual(layout)

		const row = await rowById(saved.id)
		expect(row.origin).toBe("user")
		expect(row.visibility).toBe("private")
		expect(row.slug).toBe("my-wide-table")
		expect(row.description).toBe("two columns")
		expect(row.authorUserId).toBe(owner.id)
		expect(row.seedKey).toBeNull()
	}, 60_000)

	test("two saves of one name take distinct slugs", async () => {
		const genreId = freshGenre()
		const owner = await user("slugs")
		const { saveUserLayoutPreset } = await presets()
		const a = await saveUserLayoutPreset({
			genreId,
			userId: owner.id,
			name: "Wide",
			layout: layoutNaming("a")
		})
		const b = await saveUserLayoutPreset({
			genreId,
			userId: owner.id,
			name: "Wide",
			layout: layoutNaming("b")
		})
		expect((await rowById(a.id)).slug).toBe("wide")
		expect((await rowById(b.id)).slug).toBe("wide-2")
	}, 60_000)
})

describe("listing", () => {
	test("shows shipped rows, shared rows and the caller's own — never a stranger's private one", async () => {
		const genreId = freshGenre()
		const mine = await user("mine")
		const theirs = await user("theirs")
		const {
			syncLayoutPresets,
			saveUserLayoutPreset,
			shareLayoutPreset,
			listLayoutPresets
		} = await presets()
		await syncLayoutPresets([genreId])

		const own = await saveUserLayoutPreset({
			genreId,
			userId: mine.id,
			name: "Mine",
			layout: layoutNaming("mine")
		})
		const secret = await saveUserLayoutPreset({
			genreId,
			userId: theirs.id,
			name: "Secret",
			layout: layoutNaming("secret")
		})
		const published = await saveUserLayoutPreset({
			genreId,
			userId: theirs.id,
			name: "Published",
			layout: layoutNaming("published")
		})
		await shareLayoutPreset({
			presetId: published.id,
			userId: theirs.id,
			visibility: "shared"
		})

		const listed = await listLayoutPresets(genreId, mine.id)
		const ids = listed.map((p) => p.id)
		expect(ids).toContain(own.id)
		expect(ids).toContain(published.id)
		expect(ids).not.toContain(secret.id)
		// The genre default layout first, then the rest by group.
		expect(listed[0].isGenreDefault).toBe(true)
		expect((await rowById(listed[0].id)).origin).toBe("core")
		// The published row carries its layout to whoever may see it.
		expect(listed.find((p) => p.id === published.id)!.layout).toEqual(
			layoutNaming("published")
		)
	}, 60_000)
})

describe("share", () => {
	test("publishes one of the author's rows and takes it back", async () => {
		const genreId = freshGenre()
		const author = await user("sharer")
		const other = await user("viewer")
		const { saveUserLayoutPreset, shareLayoutPreset, listLayoutPresets } =
			await presets()
		const own = await saveUserLayoutPreset({
			genreId,
			userId: author.id,
			name: "Shared then not",
			layout: layoutNaming("x")
		})

		const shared = await shareLayoutPreset({
			presetId: own.id,
			userId: author.id,
			visibility: "shared"
		})
		expect(shared.ok).toBe(true)
		expect((await rowById(own.id)).visibility).toBe("shared")
		expect(
			(await listLayoutPresets(genreId, other.id)).map((p) => p.id)
		).toContain(own.id)

		const unshared = await shareLayoutPreset({
			presetId: own.id,
			userId: author.id,
			visibility: "private"
		})
		expect(unshared.ok).toBe(true)
		expect((await rowById(own.id)).visibility).toBe("private")
		expect(
			(await listLayoutPresets(genreId, other.id)).map((p) => p.id)
		).not.toContain(own.id)
	}, 60_000)

	test("refuses a visibility nobody declared, and a shipped row", async () => {
		const genreId = freshGenre()
		const author = await user("bad-vis")
		const {
			syncLayoutPresets,
			saveUserLayoutPreset,
			shareLayoutPreset,
			LAYOUT_PRESET_BUILT_IN_SHARE
		} = await presets()
		const own = await saveUserLayoutPreset({
			genreId,
			userId: author.id,
			name: "Mine",
			layout: {}
		})
		const odd = await shareLayoutPreset({
			presetId: own.id,
			userId: author.id,
			visibility: "public" as any
		})
		expect(odd.ok).toBe(false)

		await syncLayoutPresets([genreId])
		const [shipped] = await bySeedKey(layoutPresetSeedKey(genreId))
		const builtIn = await shareLayoutPreset({
			presetId: shipped.id,
			userId: author.id,
			isAdmin: true,
			visibility: "private"
		})
		expect(builtIn.ok).toBe(false)
		if (!builtIn.ok) expect(builtIn.error).toBe(LAYOUT_PRESET_BUILT_IN_SHARE)
	}, 60_000)

	test("a guest may keep their own layout but not publish one", async () => {
		const genreId = freshGenre()
		const guest = await user("guest")
		const {
			saveUserLayoutPreset,
			shareLayoutPreset,
			LAYOUT_PRESET_GUEST_NO_SHARE
		} = await presets()
		const own = await saveUserLayoutPreset({
			genreId,
			userId: guest.id,
			name: "Guest's own",
			layout: layoutNaming("guest")
		})
		const refused = await shareLayoutPreset({
			presetId: own.id,
			userId: guest.id,
			isGuest: true,
			visibility: "shared"
		})
		expect(refused.ok).toBe(false)
		if (!refused.ok) expect(refused.error).toBe(LAYOUT_PRESET_GUEST_NO_SHARE)
		expect((await rowById(own.id)).visibility).toBe("private")
	}, 60_000)
})

describe("rename", () => {
	// Re-capturing a layout is **Save changes to** (`saveChangesToLayout`,
	// packed from a session); its tests are the socket's, in
	// `sockets/sessions.layoutPresetVerbs.int.test.ts`.
	test("a rename leaves the layout exactly as it was", async () => {
		const genreId = freshGenre()
		const owner = await user("rename-only")
		const { saveUserLayoutPreset, renameUserLayoutPreset } = await presets()
		const layout = layoutNaming("kept")
		const saved = await saveUserLayoutPreset({
			genreId,
			userId: owner.id,
			name: "Old name",
			layout
		})
		const stamped = (await rowById(saved.id)).layoutUpdatedAt
		const outcome = await renameUserLayoutPreset({
			presetId: saved.id,
			userId: owner.id,
			name: "New name"
		})
		expect(outcome.ok).toBe(true)
		const row = await rowById(saved.id)
		expect(row.name).toBe("New name")
		expect(row.layout).toEqual(layout)
		// A rename is not a layout change: nobody's copy is marked Updated.
		expect(row.layoutUpdatedAt.getTime()).toBe(stamped.getTime())
	}, 60_000)
})

describe("clone", () => {
	test("is a new private row of the caller's that keeps no reference back", async () => {
		const other = await user("cloner")
		const { syncLayoutPresets, cloneLayoutPreset } = await presets()
		// A core genre's shipped layout: Adventure's.
		const shippedGenre = "core:genre/adventure"
		const shippedLayout = (await declaredDefault(shippedGenre)).preset
		await syncLayoutPresets([shippedGenre])
		const [source] = await bySeedKey(layoutPresetSeedKey(shippedGenre))

		const cloned = await cloneLayoutPreset({
			presetId: source.id,
			userId: other.id
		})
		expect(cloned.ok).toBe(true)
		if (!cloned.ok) return
		expect(cloned.preset.name).toBe("Adventure (copy)")
		expect(cloned.preset.isGenreDefault).toBe(false)
		expect(cloned.preset.mine).toBe(true)
		expect(cloned.preset.layout).toEqual(shippedLayout)
		const row = await rowById(cloned.preset.id)
		expect(row.origin).toBe("user")
		expect(row.visibility).toBe("private")
		expect(row.authorUserId).toBe(other.id)
		expect(row.seedKey).toBeNull()

		// Moving the copy does not move the original.
		await testDb
			.update(schema.sessionLayoutPresets)
			.set({ layout: layoutNaming("moved") })
			.where(eq(schema.sessionLayoutPresets.id, cloned.preset.id))
		expect((await rowById(source.id)).layout).toEqual(shippedLayout)
	}, 60_000)

	test("copies the description, and takes a name when given one", async () => {
		const genreId = freshGenre()
		const author = await user("desc")
		const { saveUserLayoutPreset, cloneLayoutPreset } = await presets()
		const saved = await saveUserLayoutPreset({
			genreId,
			userId: author.id,
			name: "Original",
			description: "goes places",
			layout: layoutNaming("travelling")
		})
		const cloned = await cloneLayoutPreset({
			presetId: saved.id,
			userId: author.id,
			name: "Travelling"
		})
		expect(cloned.ok).toBe(true)
		if (!cloned.ok) return
		expect(cloned.preset.id).not.toBe(saved.id)
		expect(cloned.preset.name).toBe("Travelling")
		expect((await rowById(cloned.preset.id)).description).toBe("goes places")
	}, 60_000)

	test("a stranger's private row cannot be cloned; a shared one can", async () => {
		const genreId = freshGenre()
		const author = await user("clone-author")
		const stranger = await user("clone-stranger")
		const {
			saveUserLayoutPreset,
			shareLayoutPreset,
			cloneLayoutPreset,
			LAYOUT_PRESET_UNKNOWN
		} = await presets()
		const secret = await saveUserLayoutPreset({
			genreId,
			userId: author.id,
			name: "Secret",
			layout: layoutNaming("secret")
		})
		const refused = await cloneLayoutPreset({
			presetId: secret.id,
			userId: stranger.id
		})
		expect(refused.ok).toBe(false)
		if (!refused.ok) expect(refused.error).toBe(LAYOUT_PRESET_UNKNOWN)

		await shareLayoutPreset({
			presetId: secret.id,
			userId: author.id,
			visibility: "shared"
		})
		const allowed = await cloneLayoutPreset({
			presetId: secret.id,
			userId: stranger.id
		})
		expect(allowed.ok).toBe(true)
	}, 60_000)
})

describe("managing", () => {
	test("a shipped row is refused to everybody, admin included", async () => {
		const genreId = freshGenre()
		const admin = await user("admin")
		const {
			syncLayoutPresets,
			renameUserLayoutPreset,
			deleteUserLayoutPreset,
			LAYOUT_PRESET_BUILT_IN_DELETE
		} = await presets()
		await syncLayoutPresets([genreId])
		const [row] = await bySeedKey(layoutPresetSeedKey(genreId))

		const renamed = await renameUserLayoutPreset({
			presetId: row.id,
			userId: admin.id,
			isAdmin: true,
			name: "Mine now"
		})
		expect(renamed.ok).toBe(false)
		const deleted = await deleteUserLayoutPreset({
			presetId: row.id,
			userId: admin.id,
			isAdmin: true
		})
		expect(deleted.ok).toBe(false)
		if (!deleted.ok) expect(deleted.error).toBe(LAYOUT_PRESET_BUILT_IN_DELETE)
	}, 60_000)

	test("a stranger's private row is refused as ABSENT, a shared one by name", async () => {
		const genreId = freshGenre()
		const author = await user("auth")
		const stranger = await user("nosy")
		const admin = await user("adm2")
		const {
			saveUserLayoutPreset,
			shareLayoutPreset,
			renameUserLayoutPreset,
			LAYOUT_PRESET_UNKNOWN
		} = await presets()

		const secret = await saveUserLayoutPreset({
			genreId,
			userId: author.id,
			name: "Secret",
			layout: layoutNaming("secret")
		})
		const nosy = await renameUserLayoutPreset({
			presetId: secret.id,
			userId: stranger.id,
			name: "Taken"
		})
		expect(nosy.ok).toBe(false)
		if (!nosy.ok) expect(nosy.error).toBe(LAYOUT_PRESET_UNKNOWN)
		// The same sentence a missing id gets — the id space says nothing.
		const missing = await renameUserLayoutPreset({
			presetId: 9_999_999,
			userId: stranger.id,
			name: "Taken"
		})
		expect(missing.ok).toBe(false)
		if (!missing.ok) expect(missing.error).toBe(LAYOUT_PRESET_UNKNOWN)

		await shareLayoutPreset({
			presetId: secret.id,
			userId: author.id,
			visibility: "shared"
		})
		// Now visible: a stranger is told why, an admin may act.
		const told = await renameUserLayoutPreset({
			presetId: secret.id,
			userId: stranger.id,
			name: "Taken"
		})
		expect(told.ok).toBe(false)
		if (!told.ok) expect(told.error).toContain("owner or an admin")
		const byAdmin = await renameUserLayoutPreset({
			presetId: secret.id,
			userId: admin.id,
			isAdmin: true,
			name: "Tidied"
		})
		expect(byAdmin.ok).toBe(true)
	}, 60_000)

	test("an admin's approved write lands only while the row is still shared", async () => {
		const genreId = freshGenre()
		const author = await user("racer")
		const admin = await user("racing-admin")
		const { saveUserLayoutPreset, shareLayoutPreset, manageWrite } = await presets()
		const saved = await saveUserLayoutPreset({
			genreId,
			userId: author.id,
			name: "Racy",
			layout: layoutNaming("racy")
		})
		await shareLayoutPreset({ presetId: saved.id, userId: author.id, visibility: "shared" })
		// What the admin's gate read and approved…
		const approved = await rowById(saved.id)
		// …and the author taking it private before the admin's write lands.
		await testDb
			.update(schema.sessionLayoutPresets)
			.set({ visibility: "private" })
			.where(eq(schema.sessionLayoutPresets.id, saved.id))
		const byAdmin = await testDb
			.update(schema.sessionLayoutPresets)
			.set({ name: "Moderated" })
			.where(manageWrite(saved.id, approved, admin.id))
			.returning()
		expect(byAdmin).toEqual([])
		// The author's own write needs no visibility at all.
		const byAuthor = await testDb
			.update(schema.sessionLayoutPresets)
			.set({ name: "Still mine" })
			.where(manageWrite(saved.id, approved, author.id))
			.returning()
		expect(byAuthor).toHaveLength(1)
		expect((await rowById(saved.id)).name).toBe("Still mine")
	}, 60_000)
})
