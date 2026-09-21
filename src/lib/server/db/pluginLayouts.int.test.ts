/**
 * `syncPluginLayouts` — the plugin half of `session_layout_presets` (session
 * layout v2 §4.1).
 *
 * The invariants that matter here are the ones a package could otherwise break
 * for everybody: it marks rather than deletes (a session names its layout
 * preset), it refuses a document that does not validate rather than storing
 * one, it cannot claim the genre owner's slug on a genre it does not own, and
 * it never writes over a row another package owns.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
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

let n = 0

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

/** Two units on one cell — the overlap error `validateLayoutDoc` refuses. */
const OVERLAPPING = {
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

async function installPlugin(
	pluginId: string,
	layouts: unknown[],
	enabled = true
) {
	const [row] = await testDb
		.insert(schema.plugins)
		.values({
			pluginId,
			name: pluginId,
			version: "2.1.0",
			bundleSource: "// none",
			bundleHash: `hash-${n++}`,
			enabled,
			manifest: { layouts }
		})
		.returning()
	return row
}

const sync = async () => {
	const { syncPluginLayouts } = await import("./pluginLayouts")
	return syncPluginLayouts(testDb as any)
}

const rowByKey = async (seedKey: string) => {
	const [row] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.seedKey, seedKey))
	return row
}

describe("projecting a package's layouts", () => {
	test(
		"writes a shared plugin row, keyed by manifest id and slug",
		async () => {
			const pluginId = "acme/heist"
			await installPlugin(pluginId, [
				{
					genreId: "core:genre/adventure",
					slug: "cinematic",
					name: "Cinematic",
					description: "Wide and dark",
					preset: {
						layout: docNaming("cinematic"),
						widgetSettings: { messages: { composer: "writer" } }
					}
				}
			])
			const report = await sync()
			const key = `layout:core:genre/adventure:${pluginId}/cinematic`
			expect(report.projected).toContain(key)

			const row = await rowByKey(key)
			expect(row.origin).toBe("plugin")
			expect(row.pluginId).toBe(pluginId)
			expect(row.authorUserId).toBeNull()
			expect(row.slug).toBe("cinematic")
			expect(row.name).toBe("Cinematic")
			expect(row.description).toBe("Wide and dark")
			expect(row.visibility).toBe("shared")
			expect(row.withdrawnAt).toBeNull()
			expect(row.seededByVersion).toBe("2.1.0")
			expect((row.document as any).zones.middle.units[0].key).toBe(
				"cinematic"
			)
			expect(row.widgetSettings).toEqual({
				messages: { composer: "writer" }
			})
			// ⏳ "No overrides" for the pre-v2 renderer, which has never heard
			// of this row's document.
			expect(row.layout).toEqual({})
		},
		60_000
	)

	test(
		"is idempotent, and re-forces what the manifest says",
		async () => {
			const pluginId = "acme/again"
			const plugin = await installPlugin(pluginId, [
				{
					genreId: "core:genre/chat",
					slug: "tall",
					name: "Tall",
					preset: { layout: docNaming("tall") }
				}
			])
			await sync()
			const key = `layout:core:genre/chat:${pluginId}/tall`
			const first = await rowByKey(key)

			await testDb
				.update(schema.plugins)
				.set({
					manifest: {
						layouts: [
							{
								genreId: "core:genre/chat",
								slug: "tall",
								name: "Taller",
								preset: { layout: docNaming("taller") }
							}
						]
					}
				})
				.where(eq(schema.plugins.id, plugin.id))
			await sync()

			const second = await rowByKey(key)
			expect(second.id).toBe(first.id)
			expect(second.name).toBe("Taller")
			expect((second.document as any).zones.middle.units[0].key).toBe(
				"taller"
			)
		},
		60_000
	)
})

describe("withdrawal", () => {
	test(
		"disabling marks, re-enabling restores — the row is never deleted",
		async () => {
			const pluginId = "acme/switch"
			const plugin = await installPlugin(pluginId, [
				{
					genreId: "core:genre/chat",
					slug: "quiet",
					name: "Quiet",
					preset: { layout: docNaming("quiet") }
				}
			])
			await sync()
			const key = `layout:core:genre/chat:${pluginId}/quiet`
			const live = await rowByKey(key)
			expect(live.withdrawnAt).toBeNull()

			await testDb
				.update(schema.plugins)
				.set({ enabled: false })
				.where(eq(schema.plugins.id, plugin.id))
			const off = await sync()
			expect(off.withdrawn).toContain(key)
			const marked = await rowByKey(key)
			expect(marked.id).toBe(live.id)
			expect(marked.withdrawnAt).not.toBeNull()

			await testDb
				.update(schema.plugins)
				.set({ enabled: true })
				.where(eq(schema.plugins.id, plugin.id))
			const on = await sync()
			expect(on.restored).toContain(key)
			const back = await rowByKey(key)
			expect(back.id).toBe(live.id)
			expect(back.withdrawnAt).toBeNull()
		},
		60_000
	)

	test(
		"a layout dropped from a still-enabled manifest is withdrawn too",
		async () => {
			const pluginId = "acme/shrink"
			const plugin = await installPlugin(pluginId, [
				{
					genreId: "core:genre/chat",
					slug: "one",
					name: "One",
					preset: { layout: docNaming("one") }
				},
				{
					genreId: "core:genre/chat",
					slug: "two",
					name: "Two",
					preset: { layout: docNaming("two") }
				}
			])
			await sync()
			await testDb
				.update(schema.plugins)
				.set({
					manifest: {
						layouts: [
							{
								genreId: "core:genre/chat",
								slug: "one",
								name: "One",
								preset: { layout: docNaming("one") }
							}
						]
					}
				})
				.where(eq(schema.plugins.id, plugin.id))
			const report = await sync()
			expect(report.withdrawn).toContain(
				`layout:core:genre/chat:${pluginId}/two`
			)
			expect(
				(await rowByKey(`layout:core:genre/chat:${pluginId}/one`))
					.withdrawnAt
			).toBeNull()
		},
		60_000
	)
})

describe("what it refuses", () => {
	test(
		"a document that does not validate is reported and never written",
		async () => {
			const pluginId = "acme/broken"
			await installPlugin(pluginId, [
				{
					genreId: "core:genre/chat",
					slug: "broken",
					name: "Broken",
					preset: { layout: OVERLAPPING }
				}
			])
			const report = await sync()
			const key = `layout:core:genre/chat:${pluginId}/broken`
			expect(report.refused.map((r) => r.key)).toContain(key)
			expect(report.projected).not.toContain(key)
			expect(await rowByKey(key)).toBeUndefined()
		},
		60_000
	)

	test(
		"the genre owner's slug on somebody else's genre",
		async () => {
			const pluginId = "acme/greedy"
			await installPlugin(pluginId, [
				{
					genreId: "core:genre/chat",
					slug: "default",
					name: "Mine now",
					preset: { layout: docNaming("greedy") }
				},
				{
					// …and the same slug on a genre it DOES own, which is fine:
					// ownership is by grammar, `acme/greedy` → `acme.greedy:`.
					genreId: "acme.greedy:genre/caper",
					slug: "default",
					name: "Caper",
					preset: { layout: docNaming("caper") }
				}
			])
			const report = await sync()
			const stolen = `layout:core:genre/chat:${pluginId}/default`
			const own = `layout:acme.greedy:genre/caper:${pluginId}/default`
			expect(report.refused.map((r) => r.key)).toContain(stolen)
			expect(await rowByKey(stolen)).toBeUndefined()
			expect(report.projected).toContain(own)
			expect((await rowByKey(own)).slug).toBe("default")
		},
		60_000
	)

	test(
		"a declaration missing a genre, a slug, a name or a preset makes no row",
		async () => {
			const pluginId = "acme/sloppy"
			await installPlugin(pluginId, [
				{ slug: "nogenre", name: "No genre", preset: { layout: docNaming("x") } },
				{ genreId: "core:genre/chat", name: "No slug", preset: {} },
				{ genreId: "core:genre/chat", slug: "noname", preset: {} },
				{ genreId: "core:genre/chat", slug: "nopreset", name: "No preset" },
				"not an object"
			])
			const report = await sync()
			expect(
				report.projected.filter((k) => k.includes(pluginId))
			).toEqual([])
			expect(
				await rowByKey(`layout:core:genre/chat:${pluginId}/noname`)
			).toBeUndefined()
		},
		60_000
	)

	test(
		"a row another package owns is left alone",
		async () => {
			// Two manifests claiming one seed key can only happen by hand, but
			// taking one over would silently replace somebody's layout.
			const key = "layout:core:genre/chat:acme/first/shared-slug"
			await testDb.insert(schema.sessionLayoutPresets).values({
				seedKey: key,
				genreId: "core:genre/chat",
				origin: "plugin",
				pluginId: "acme/first",
				slug: "shared-slug",
				name: "First's",
				visibility: "shared",
				document: docNaming("first")
			})
			// A second package whose id + slug spell the same key.
			await installPlugin("acme", [
				{
					genreId: "core:genre/chat",
					slug: "first/shared-slug",
					name: "Second's",
					preset: { layout: docNaming("second") }
				}
			])
			const report = await sync()
			// Declared, so the withdrawal pass leaves it alone — and skipped,
			// so its content is the first package's still.
			expect(report.withdrawn).not.toContain(key)
			const row = await rowByKey(key)
			expect(row.pluginId).toBe("acme/first")
			expect(row.withdrawnAt).toBeNull()
			expect((row.document as any).zones.middle.units[0].key).toBe(
				"first"
			)
		},
		60_000
	)
})
