/**
 * The v2 half of `session_layout_presets` (session layout v2 §4.1–§4.4): the
 * two migrations, the origin-scoped core reconciler, and the resolution chain
 * at every one of its five tiers.
 *
 * The legacy invariants — a seeded row never touching a user's, the prune's
 * scope — are pinned next door in `layoutPresets.int.test.ts` and are NOT
 * restated here; what is new is that a row now says WHO brought it, and that a
 * document is resolved through a chain rather than read off one row.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { layoutPresetSeedKey } from "$lib/shared/sessionLayout/presets"
import { BUILT_IN_LAYOUT_DOC } from "$lib/shared/sessionLayout/document"
import type { TestDb } from "$lib/server/utils/testDb"
import type { LayoutDoc } from "@serene-pub/sdk"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(() => {})

const CHAT = "core:genre/chat"
const ADVENTURE = "core:genre/adventure"

let n = 0
/** A genre id nothing else in this file touches. */
const freshGenre = () => `test:genre/lane-${n++}`

const presets = () => import("./layoutPresets")

const rowFor = async (genreId: string) => {
	const [row] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(
			eq(schema.sessionLayoutPresets.seedKey, layoutPresetSeedKey(genreId))
		)
	return row
}

async function scenario(genreId: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `lv2-owner-${n++}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, genreId })
		.returning()
	return { owner, session }
}

/** A minimal valid v2 document naming one widget, distinguishable by its key. */
const docNaming = (key: string): LayoutDoc => ({
	version: 2,
	zones: {
		middle: {
			rows: ["grow"],
			cols: ["grow"],
			units: [
				{
					kind: "widget",
					key,
					widget: "messages",
					row: { start: 1, span: 1 },
					col: { start: 1, span: 1 }
				}
			]
		}
	}
})

/** The key of the one unit in a resolved document — which tier answered. */
const keyOf = (doc: LayoutDoc) => (doc.zones.middle.units[0] as any)?.key

describe("the two migrations", () => {
	test(
		"apply on a fresh database, with the columns and the table they add",
		async () => {
			const cols = await testDb.execute(
				sql`SELECT column_name FROM information_schema.columns
					WHERE table_name = 'session_layout_presets'`
			)
			const names = (cols.rows as Array<{ column_name: string }>).map(
				(r) => r.column_name
			)
			for (const c of [
				"origin",
				"plugin_id",
				"withdrawn_at",
				"slug",
				"description",
				"visibility",
				"document",
				"widget_settings",
				"widget_styles",
				"seeded_by_version"
			])
				expect(names).toContain(c)

			const panel = await testDb.execute(
				sql`SELECT column_name FROM information_schema.columns
					WHERE table_name = 'session_panel_layouts' AND column_name = 'document'`
			)
			expect(panel.rows.length).toBe(1)

			const table = await testDb.execute(
				sql`SELECT table_name FROM information_schema.tables
					WHERE table_name = 'user_layout_defaults'`
			)
			expect(table.rows.length).toBe(1)
		},
		60_000
	)

	test(
		"the origin triple and the visibility set are enforced, not advisory",
		async () => {
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
			const { createTestUser } = await import(
				"$lib/server/utils/testDb"
			)
			const u = await createTestUser(testDb, `lv2-check-${n++}`)
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
		},
		60_000
	)
})

describe("the core reconciler", () => {
	test(
		"writes origin, slug, visibility and a document — and keeps the legacy blob",
		async () => {
			const { CORE_LAYOUT_PRESETS } = await import(
				"@serene-pub/core-catalog"
			)
			const legacy = CORE_LAYOUT_PRESETS.find(
				(l) => l.genreId === ADVENTURE
			)!
			const { syncLayoutPresets } = await presets()
			await syncLayoutPresets([{ genreId: ADVENTURE }, legacy], {
				version: "9.9.9"
			})

			const row = await rowFor(ADVENTURE)
			expect(row.origin).toBe("core")
			expect(row.slug).toBe("default")
			expect(row.visibility).toBe("shared")
			expect(row.authorUserId).toBeNull()
			expect(row.pluginId).toBeNull()
			expect(row.seededByVersion).toBe("9.9.9")
			// The genre's shipped v2 document, found without the caller
			// passing it — and its pinned per-instance settings with it.
			const doc = row.document as LayoutDoc
			expect(doc.version).toBe(2)
			expect(
				(doc.zones.right?.units ?? []).map((u: any) => u.key)
			).toEqual(["scene-portraits", "stats", "inventory"])
			expect(row.widgetSettings).toEqual({
				"scene-portraits": { source: "scene", bars: true }
			})
			// ⏳ …and the legacy blob, untouched, for the pre-v2 renderer.
			expect((row.layout as any).zoneLayout.zones.right.widgets).toEqual([
				"scene-portraits",
				"stats",
				"inventory"
			])
		},
		60_000
	)

	test(
		"gives a genre that ships no document the built-in floor",
		async () => {
			const { syncLayoutPresets } = await presets()
			await syncLayoutPresets([{ genreId: CHAT }])
			const row = await rowFor(CHAT)
			expect(row.origin).toBe("core")
			expect(row.document).toEqual(BUILT_IN_LAYOUT_DOC)
			// The legacy blob stays "no overrides", which is what keeps the
			// preset system inert for everyone who never touches it.
			expect(row.layout).toEqual({})
		},
		60_000
	)

	test(
		"is idempotent: a second pass leaves one row, unchanged",
		async () => {
			const genreId = freshGenre()
			const { syncLayoutPresets } = await presets()
			await syncLayoutPresets([{ genreId }])
			const first = await rowFor(genreId)
			await syncLayoutPresets([{ genreId }])
			const second = await rowFor(genreId)
			expect(second.id).toBe(first.id)
			expect(second.origin).toBe("core")
			expect(second.document).toEqual(first.document)
			const all = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.genreId, genreId))
			expect(all.length).toBe(1)
		},
		60_000
	)
})

describe("a person's own rows", () => {
	test(
		"a save writes origin, a slug from the name, and private",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { saveUserLayoutPreset } = await presets()
			const saved = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "My Wide Table!",
				description: "  two columns  ",
				preset: { layout: docNaming("mine") }
			})
			expect(saved.origin).toBe("user")
			expect(saved.visibility).toBe("private")
			expect(saved.slug).toBe("my-wide-table")
			expect(saved.description).toBe("two columns")
			expect(keyOf(saved.document!)).toBe("mine")
			// ⏳ The legacy client reads `{}` as "no overrides" rather than
			// crashing on a document it cannot parse.
			expect(saved.layout).toEqual({})
		},
		60_000
	)

	test(
		"two saves of one name take distinct slugs",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { saveUserLayoutPreset } = await presets()
			const a = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Wide",
				preset: { layout: docNaming("a") }
			})
			const b = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Wide",
				preset: { layout: docNaming("b") }
			})
			expect(a.slug).toBe("wide")
			expect(b.slug).toBe("wide-2")
		},
		60_000
	)

	test(
		"a document that does not validate is refused with a sentence",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { importLayoutPreset, LAYOUT_DOC_REFUSED } = await presets()
			const outcome = await importLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Broken",
				// Two units on one cell: the overlap error.
				preset: {
					layout: {
						version: 2,
						zones: {
							middle: {
								rows: ["grow"],
								cols: ["grow"],
								units: [
									{
										kind: "widget",
										key: "a",
										widget: "messages",
										row: { start: 1, span: 1 },
										col: { start: 1, span: 1 }
									},
									{
										kind: "widget",
										key: "b",
										widget: "messages",
										row: { start: 1, span: 1 },
										col: { start: 1, span: 1 }
									}
								]
							}
						}
					} as unknown as LayoutDoc
				}
			})
			expect(outcome.ok).toBe(false)
			if (!outcome.ok)
				expect(outcome.error).toContain(LAYOUT_DOC_REFUSED)
		},
		60_000
	)

	test(
		"the legacy save path still writes a row the pre-v2 client reads",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { saveUserLayoutPreset } = await presets()
			const saved = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Legacy",
				layout: { zoneLayout: { version: 1, zones: {} } }
			})
			expect(saved.origin).toBe("user")
			expect(saved.document).toBeNull()
			expect(saved.isDefault).toBe(false)
			expect((saved.layout as any).zoneLayout).toBeTruthy()
		},
		60_000
	)
})

describe("listing", () => {
	test(
		"shows shipped rows, shared rows and the caller's own — never a stranger's private one",
		async () => {
			const genreId = freshGenre()
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const mine = await createTestUser(testDb, `lv2-mine-${n++}`)
			const theirs = await createTestUser(testDb, `lv2-theirs-${n++}`)
			const {
				syncLayoutPresets,
				saveUserLayoutPreset,
				shareLayoutPreset,
				listLayoutPresets
			} = await presets()
			await syncLayoutPresets([{ genreId }])

			const own = await saveUserLayoutPreset({
				genreId,
				userId: mine.id,
				name: "Mine",
				preset: { layout: docNaming("mine") }
			})
			const secret = await saveUserLayoutPreset({
				genreId,
				userId: theirs.id,
				name: "Secret",
				preset: { layout: docNaming("secret") }
			})
			const published = await saveUserLayoutPreset({
				genreId,
				userId: theirs.id,
				name: "Published",
				preset: { layout: docNaming("published") }
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
			// Shipped first, then the rest in creation order.
			expect(listed[0].origin).toBe("core")
			expect(listed[0].isDefault).toBe(true)
		},
		60_000
	)
})

describe("the resolution chain", () => {
	test(
		"answers at the built-in floor when the genre has no row at all",
		async () => {
			const s = await scenario(freshGenre())
			const { resolveLayoutFor } = await presets()
			const res = await resolveLayoutFor(s.session.id, s.owner.id)
			expect(res.tier).toBe("built-in")
			expect(res.presetId).toBeNull()
			expect(res.origin).toBeNull()
			expect(res.document).toEqual(BUILT_IN_LAYOUT_DOC)
		},
		60_000
	)

	test(
		"…then at the genre's own row, its preset id and origin reported",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { syncLayoutPresets, resolveLayoutFor } = await presets()
			await syncLayoutPresets([
				{ genreId, preset: { layout: docNaming("genre") } }
			])
			const res = await resolveLayoutFor(s.session.id, s.owner.id)
			expect(res.tier).toBe("genre")
			expect(res.origin).toBe("core")
			expect(keyOf(res.document)).toBe("genre")
			expect(res.presetId).toBe((await rowFor(genreId)).id)
		},
		60_000
	)

	test(
		"…then at the person's default for the genre",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { syncLayoutPresets, saveUserLayoutPreset, resolveLayoutFor } =
				await presets()
			const { setUserLayoutDefault } = await import(
				"./userLayoutDefaults"
			)
			await syncLayoutPresets([
				{ genreId, preset: { layout: docNaming("genre") } }
			])
			const own = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Preferred",
				preset: { layout: docNaming("preferred") }
			})
			await setUserLayoutDefault({
				userId: s.owner.id,
				genreId,
				presetId: own.id
			})
			const res = await resolveLayoutFor(s.session.id, s.owner.id)
			expect(res.tier).toBe("user-default")
			expect(res.origin).toBe("user")
			expect(keyOf(res.document)).toBe("preferred")
		},
		60_000
	)

	test(
		"…then at the preset this session is on",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { syncLayoutPresets, saveUserLayoutPreset, resolveLayoutFor } =
				await presets()
			await syncLayoutPresets([
				{ genreId, preset: { layout: docNaming("genre") } }
			])
			const applied = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Applied",
				preset: {
					layout: docNaming("applied"),
					widgetSettings: { messages: { composer: "minimal" } },
					widgetStyles: { messages: { id: 4, slug: "messages:stage" } }
				}
			})
			await testDb.insert(schema.sessionPanelLayouts).values({
				sessionId: s.session.id,
				userId: s.owner.id,
				layoutPresetId: applied.id
			})
			const res = await resolveLayoutFor(s.session.id, s.owner.id)
			expect(res.tier).toBe("preset")
			expect(keyOf(res.document)).toBe("applied")
			// The preset's pins come with it.
			expect(res.settings.messages).toEqual({ composer: "minimal" })
			expect(res.stylePins.messages).toEqual({
				id: 4,
				slug: "messages:stage"
			})
		},
		60_000
	)

	test(
		"…and at the session's own document, over everything",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { syncLayoutPresets, saveUserLayoutPreset, resolveLayoutFor } =
				await presets()
			await syncLayoutPresets([
				{ genreId, preset: { layout: docNaming("genre") } }
			])
			const applied = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Applied",
				preset: { layout: docNaming("applied") }
			})
			await testDb.insert(schema.sessionPanelLayouts).values({
				sessionId: s.session.id,
				userId: s.owner.id,
				layoutPresetId: applied.id,
				document: docNaming("ours"),
				layoutSettings: {
					widgetStyles: { messages: { id: 9, slug: "user:9" } }
				}
			})
			const res = await resolveLayoutFor(s.session.id, s.owner.id)
			expect(res.tier).toBe("session")
			expect(keyOf(res.document)).toBe("ours")
			// The preset it is still pinned to is reported — that is what
			// "Reset" puts the session back to.
			expect(res.presetId).toBe(applied.id)
			expect(res.stylePins.messages).toEqual({ id: 9, slug: "user:9" })
		},
		60_000
	)

	test(
		"a person's own widget settings sit over the preset's pins, per field",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { saveUserLayoutPreset, resolveLayoutFor } = await presets()
			const applied = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Pinned",
				preset: {
					layout: docNaming("pinned"),
					widgetSettings: {
						messages: { composer: "minimal", density: "cosy" }
					}
				}
			})
			await testDb.insert(schema.sessionPanelLayouts).values({
				sessionId: s.session.id,
				userId: s.owner.id,
				layoutPresetId: applied.id
			})
			await testDb.insert(schema.widgetSettings).values({
				sessionId: s.session.id,
				userId: s.owner.id,
				widgetSlug: "messages",
				values: { composer: "writer" }
			})
			const res = await resolveLayoutFor(s.session.id, s.owner.id)
			expect(res.settings.messages).toEqual({
				composer: "writer",
				density: "cosy"
			})
		},
		60_000
	)

	test(
		"a withdrawn row never answers, and the session falls through",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { syncLayoutPresets, resolveLayoutFor } = await presets()
			await syncLayoutPresets([
				{ genreId, preset: { layout: docNaming("genre") } }
			])
			const [withdrawn] = await testDb
				.insert(schema.sessionLayoutPresets)
				.values({
					seedKey: `layout:${genreId}:acme/x`,
					genreId,
					origin: "plugin",
					pluginId: "acme/x",
					slug: "cinematic",
					name: "Cinematic",
					visibility: "shared",
					document: docNaming("plugin"),
					withdrawnAt: new Date()
				})
				.returning()
			await testDb.insert(schema.sessionPanelLayouts).values({
				sessionId: s.session.id,
				userId: s.owner.id,
				layoutPresetId: withdrawn.id
			})
			const res = await resolveLayoutFor(s.session.id, s.owner.id)
			expect(res.tier).toBe("genre")
			expect(keyOf(res.document)).toBe("genre")
		},
		60_000
	)

	test(
		"a stranger's private preset never resolves, even pinned by id",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const stranger = await createTestUser(testDb, `lv2-str-${n++}`)
			const { syncLayoutPresets, saveUserLayoutPreset, resolveLayoutFor } =
				await presets()
			await syncLayoutPresets([
				{ genreId, preset: { layout: docNaming("genre") } }
			])
			const secret = await saveUserLayoutPreset({
				genreId,
				userId: stranger.id,
				name: "Secret",
				preset: { layout: docNaming("secret") }
			})
			await testDb.insert(schema.sessionPanelLayouts).values({
				sessionId: s.session.id,
				userId: s.owner.id,
				layoutPresetId: secret.id
			})
			const res = await resolveLayoutFor(s.session.id, s.owner.id)
			expect(res.tier).toBe("genre")
			expect(keyOf(res.document)).toBe("genre")
		},
		60_000
	)
})

describe("my default for a genre", () => {
	test(
		"refuses a preset the caller cannot see, and falls through when it is deleted",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const stranger = await createTestUser(testDb, `lv2-def-${n++}`)
			const {
				syncLayoutPresets,
				saveUserLayoutPreset,
				deleteUserLayoutPreset,
				resolveLayoutFor
			} = await presets()
			const { setUserLayoutDefault, getUserLayoutDefault } = await import(
				"./userLayoutDefaults"
			)
			await syncLayoutPresets([
				{ genreId, preset: { layout: docNaming("genre") } }
			])

			const secret = await saveUserLayoutPreset({
				genreId,
				userId: stranger.id,
				name: "Secret",
				preset: { layout: docNaming("secret") }
			})
			const refused = await setUserLayoutDefault({
				userId: s.owner.id,
				genreId,
				presetId: secret.id
			})
			expect(refused.ok).toBe(false)

			const own = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Preferred",
				preset: { layout: docNaming("preferred") }
			})
			await setUserLayoutDefault({
				userId: s.owner.id,
				genreId,
				presetId: own.id
			})
			expect(await getUserLayoutDefault(s.owner.id, genreId)).toBe(own.id)

			// Deleting the preset it names nulls the FK; the person falls
			// through to the genre's own layout rather than to nothing.
			await deleteUserLayoutPreset({
				presetId: own.id,
				userId: s.owner.id
			})
			expect(await getUserLayoutDefault(s.owner.id, genreId)).toBeNull()
			const res = await resolveLayoutFor(s.session.id, s.owner.id)
			expect(res.tier).toBe("genre")
		},
		60_000
	)

	test(
		"setting it twice keeps one row",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { saveUserLayoutPreset } = await presets()
			const { setUserLayoutDefault } = await import(
				"./userLayoutDefaults"
			)
			const a = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "A",
				preset: { layout: docNaming("a") }
			})
			const b = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "B",
				preset: { layout: docNaming("b") }
			})
			await setUserLayoutDefault({
				userId: s.owner.id,
				genreId,
				presetId: a.id
			})
			await setUserLayoutDefault({
				userId: s.owner.id,
				genreId,
				presetId: b.id
			})
			const rows = await testDb
				.select()
				.from(schema.userLayoutDefaults)
				.where(
					and(
						eq(schema.userLayoutDefaults.userId, s.owner.id),
						eq(schema.userLayoutDefaults.genreId, genreId)
					)
				)
			expect(rows.length).toBe(1)
			expect(rows[0].layoutPresetId).toBe(b.id)
		},
		60_000
	)
})

describe("export and import", () => {
	test(
		"round-trip: what comes out goes back in as a new private row",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { saveUserLayoutPreset, exportLayoutPreset, importLayoutPreset } =
				await presets()
			const original = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Travelling",
				description: "goes places",
				preset: {
					layout: docNaming("travelling"),
					widgetSettings: { messages: { composer: "writer" } },
					widgetStyles: { messages: { id: 3, slug: "messages:novel" } }
				}
			})

			const exported = await exportLayoutPreset({
				presetId: original.id,
				userId: s.owner.id
			})
			expect(exported.ok).toBe(true)
			if (!exported.ok) return

			// It survives the wire: JSON in, JSON out, byte for byte.
			const wire = JSON.parse(JSON.stringify(exported.preset))
			const imported = await importLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: exported.name,
				description: exported.description ?? undefined,
				preset: wire
			})
			expect(imported.ok).toBe(true)
			if (!imported.ok) return
			expect(imported.preset.id).not.toBe(original.id)
			expect(imported.preset.visibility).toBe("private")
			expect(imported.preset.document).toEqual(original.document)
			expect(imported.preset.slug).toBe("travelling-2")
		},
		60_000
	)

	test(
		"a row with no document says so rather than exporting an empty bundle",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { saveUserLayoutPreset, exportLayoutPreset } = await presets()
			const legacyOnly = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Legacy",
				layout: { zoneLayout: { version: 1, zones: {} } }
			})
			const outcome = await exportLayoutPreset({
				presetId: legacyOnly.id,
				userId: s.owner.id
			})
			expect(outcome.ok).toBe(false)
		},
		60_000
	)
})

describe("managing", () => {
	test(
		"update re-captures the document, the pins and the settings together",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { saveUserLayoutPreset, updateUserLayoutPreset } =
				await presets()
			const saved = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Before",
				preset: {
					layout: docNaming("before"),
					widgetSettings: { messages: { composer: "minimal" } }
				}
			})
			const outcome = await updateUserLayoutPreset({
				presetId: saved.id,
				userId: s.owner.id,
				name: "After",
				preset: { layout: docNaming("after") }
			})
			expect(outcome.ok).toBe(true)
			if (!outcome.ok) return
			expect(outcome.preset.name).toBe("After")
			expect(keyOf(outcome.preset.document!)).toBe("after")
			// A re-capture is one statement: the pins that came with the old
			// document do not outlive it.
			const [row] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, saved.id))
			expect(row.widgetSettings).toBeNull()
		},
		60_000
	)

	test(
		"a clone is a new private row of the caller's that keeps no reference back",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const other = await createTestUser(testDb, `lv2-clone-${n++}`)
			const { syncLayoutPresets, cloneLayoutPreset, updateUserLayoutPreset } =
				await presets()
			await syncLayoutPresets([
				{ genreId, preset: { layout: docNaming("genre") } }
			])
			const source = await rowFor(genreId)

			const cloned = await cloneLayoutPreset({
				presetId: source.id,
				userId: other.id
			})
			expect(cloned.ok).toBe(true)
			if (!cloned.ok) return
			expect(cloned.preset.origin).toBe("user")
			expect(cloned.preset.visibility).toBe("private")
			expect(cloned.preset.authorUserId).toBe(other.id)
			expect(keyOf(cloned.preset.document!)).toBe("genre")

			// Moving the copy does not move the original.
			await updateUserLayoutPreset({
				presetId: cloned.preset.id,
				userId: other.id,
				preset: { layout: docNaming("moved") }
			})
			const stillThere = await rowFor(genreId)
			expect(keyOf(stillThere.document as LayoutDoc)).toBe("genre")
		},
		60_000
	)

	test(
		"a shipped row is refused to everybody, admin included",
		async () => {
			const genreId = freshGenre()
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const admin = await createTestUser(testDb, `lv2-admin-${n++}`)
			const {
				syncLayoutPresets,
				updateUserLayoutPreset,
				deleteUserLayoutPreset,
				LAYOUT_PRESET_BUILT_IN_DELETE
			} = await presets()
			await syncLayoutPresets([{ genreId }])
			const row = await rowFor(genreId)

			const renamed = await updateUserLayoutPreset({
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
			if (!deleted.ok)
				expect(deleted.error).toBe(LAYOUT_PRESET_BUILT_IN_DELETE)
		},
		60_000
	)

	test(
		"a stranger's private row is refused as ABSENT, an admin's shared one by name",
		async () => {
			const genreId = freshGenre()
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const author = await createTestUser(testDb, `lv2-auth-${n++}`)
			const stranger = await createTestUser(testDb, `lv2-nosy-${n++}`)
			const admin = await createTestUser(testDb, `lv2-adm2-${n++}`)
			const {
				saveUserLayoutPreset,
				shareLayoutPreset,
				updateUserLayoutPreset,
				LAYOUT_PRESET_UNKNOWN
			} = await presets()

			const secret = await saveUserLayoutPreset({
				genreId,
				userId: author.id,
				name: "Secret",
				preset: { layout: docNaming("secret") }
			})
			const nosy = await updateUserLayoutPreset({
				presetId: secret.id,
				userId: stranger.id,
				name: "Taken"
			})
			expect(nosy.ok).toBe(false)
			if (!nosy.ok) expect(nosy.error).toBe(LAYOUT_PRESET_UNKNOWN)
			// The same sentence a missing id gets — the id space says nothing.
			const missing = await updateUserLayoutPreset({
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
			const told = await updateUserLayoutPreset({
				presetId: secret.id,
				userId: stranger.id,
				name: "Taken"
			})
			expect(told.ok).toBe(false)
			if (!told.ok) expect(told.error).toContain("owner or an admin")
			const byAdmin = await updateUserLayoutPreset({
				presetId: secret.id,
				userId: admin.id,
				isAdmin: true,
				name: "Tidied"
			})
			expect(byAdmin.ok).toBe(true)
		},
		60_000
	)

	test(
		"a guest may keep their own layout but not publish one",
		async () => {
			const genreId = freshGenre()
			const s = await scenario(genreId)
			const {
				saveUserLayoutPreset,
				shareLayoutPreset,
				LAYOUT_PRESET_GUEST_NO_SHARE
			} = await presets()
			const own = await saveUserLayoutPreset({
				genreId,
				userId: s.owner.id,
				name: "Guest's own",
				preset: { layout: docNaming("guest") }
			})
			const refused = await shareLayoutPreset({
				presetId: own.id,
				userId: s.owner.id,
				isGuest: true,
				visibility: "shared"
			})
			expect(refused.ok).toBe(false)
			if (!refused.ok)
				expect(refused.error).toBe(LAYOUT_PRESET_GUEST_NO_SHARE)
		},
		60_000
	)
})
