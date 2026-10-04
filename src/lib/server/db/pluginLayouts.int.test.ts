/**
 * `syncPluginLayouts` — the plugin half of `session_layout_presets`.
 *
 * The invariants that matter here are the ones a package could otherwise break
 * for everybody: it marks rather than deletes (a session names its layout
 * preset), it refuses a declared layout that does not validate — the retired
 * layout document (LayoutDoc v2) included — rather than projecting it, it
 * cannot claim the genre owner's slug on a genre it does not own, and it never
 * writes over a row another package owns. What it projects but draws
 * otherwise than written — a widget the instance does not know, one past its
 * `maxInstances` — it reports as a warning. And since brief 1 of
 * `PLAN-layout-one-format-2026-09-28`, the row holds the **session layout**
 * the manifest declares, written only when it changed.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import type { SessionLayoutV1 } from "@serene-pub/sdk"

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

/** A session layout, told apart by the widget it docks on the right. */
const layoutNaming = (widget: string): SessionLayoutV1 => ({
	zoneLayout: {
		version: 1,
		zones: { right: { kind: "side", side: "right", widgets: [widget] } }
	}
})

/** One widget in two zones — an error `validateSessionLayout` refuses. */
const TWO_ZONES = {
	zoneLayout: {
		version: 1,
		zones: {
			left: { kind: "side", side: "left", widgets: ["stats"] },
			right: { kind: "side", side: "right", widgets: ["stats"] }
		}
	}
}

/** The retired layout document, as a manifest built before brief 1 holds it. */
const LAYOUT_DOC_V2 = {
	layout: {
		version: 2,
		zones: {
			middle: {
				rows: ["grow"],
				cols: ["grow"],
				units: [
					{
						kind: "widget",
						key: "messages",
						widget: "messages",
						row: { start: 1, span: 1 },
						col: { start: 1, span: 1 }
					}
				]
			}
		}
	}
}

async function installPlugin(
	pluginId: string,
	layouts: unknown[],
	enabled = true,
	/** The rest of its manifest: its `widgets`, say. */
	manifest: Record<string, unknown> = {}
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
			manifest: { ...manifest, layouts }
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
						...layoutNaming("cinematic"),
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
			// The session layout the manifest declares, verbatim — what a
			// session starting from this row draws.
			expect(row.layout).toEqual({
				...layoutNaming("cinematic"),
				widgetSettings: { messages: { composer: "writer" } }
			})
			expect(row.layoutUpdatedAt).toBeInstanceOf(Date)
			expect(row).not.toHaveProperty("document")
			expect(row).not.toHaveProperty("widgetSettings")
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
					preset: layoutNaming("tall")
				}
			])
			await sync()
			const key = `layout:core:genre/chat:${pluginId}/tall`
			const first = await rowByKey(key)
			await new Promise((r) => setTimeout(r, 15))

			await testDb
				.update(schema.plugins)
				.set({
					manifest: {
						layouts: [
							{
								genreId: "core:genre/chat",
								slug: "tall",
								name: "Taller",
								preset: layoutNaming("taller")
							}
						]
					}
				})
				.where(eq(schema.plugins.id, plugin.id))
			await sync()

			const second = await rowByKey(key)
			expect(second.id).toBe(first.id)
			expect(second.name).toBe("Taller")
			expect(second.layout).toEqual(layoutNaming("taller"))
			// The layout moved, so its stamp did.
			expect(second.layoutUpdatedAt.getTime()).toBeGreaterThan(
				first.layoutUpdatedAt.getTime()
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
					preset: layoutNaming("quiet")
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
					preset: layoutNaming("one")
				},
				{
					genreId: "core:genre/chat",
					slug: "two",
					name: "Two",
					preset: layoutNaming("two")
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
								preset: layoutNaming("one")
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
		"a layout that does not validate is reported and never written",
		async () => {
			const pluginId = "acme/broken"
			await installPlugin(pluginId, [
				{
					genreId: "core:genre/chat",
					slug: "broken",
					name: "Broken",
					preset: TWO_ZONES
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
		"the retired layout document is refused by name — no reader converts it",
		async () => {
			const pluginId = "acme/stale"
			await installPlugin(pluginId, [
				{
					genreId: "acme.stale:genre/board",
					slug: "default",
					name: "Board",
					preset: LAYOUT_DOC_V2
				}
			])
			const report = await sync()
			const key = `layout:acme.stale:genre/board:${pluginId}/default`
			const refused = report.refused.find((r) => r.key === key)
			expect(refused?.reason).toMatch(/retired layout document \(LayoutDoc v2/)
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
					preset: layoutNaming("greedy")
				},
				{
					// …and the same slug on a genre it DOES own, which is fine:
					// ownership is by grammar, `acme/greedy` → `acme.greedy:`.
					genreId: "acme.greedy:genre/caper",
					slug: "default",
					name: "Caper",
					preset: layoutNaming("caper")
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
				{ slug: "nogenre", name: "No genre", preset: layoutNaming("x") },
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
				layout: { first: true }
			})
			// A second package whose id + slug spell the same key.
			await installPlugin("acme", [
				{
					genreId: "core:genre/chat",
					slug: "first/shared-slug",
					name: "Second's",
					preset: layoutNaming("second")
				}
			])
			const report = await sync()
			// Declared, so the withdrawal pass leaves it alone — and skipped,
			// so its content is the first package's still.
			expect(report.withdrawn).not.toContain(key)
			const row = await rowByKey(key)
			expect(row.pluginId).toBe("acme/first")
			expect(row.withdrawnAt).toBeNull()
			expect(row.name).toBe("First's")
			expect(row.layout).toEqual({ first: true })
		},
		60_000
	)
})

describe("what it warns about", () => {
	test(
		"a layout that draws otherwise than written is projected and warned about, against every widget the pub knows",
		async () => {
			const pluginId = "acme.cards"
			await installPlugin(
				pluginId,
				[
					{
						genreId: "acme.cards:genre/solitaire",
						slug: "default",
						name: "Table",
						preset: {
							zoneLayout: {
								version: 1,
								zones: {
									right: {
										kind: "side",
										side: "right",
										// core's, its own twice (cap 1), and one nothing declares
										widgets: ["stats", "acme.cards:hand", "acme.cards:hand#spare", "ghost"]
									}
								}
							}
						}
					}
				],
				true,
				{ widgets: [{ id: "hand", title: "Hand", component: "hand", maxInstances: 1 }] }
			)
			const report = await sync()
			const key = `layout:acme.cards:genre/solitaire:${pluginId}/default`
			expect(report.projected).toContain(key)
			expect(await rowByKey(key)).toBeDefined()
			const mine = report.warnings.filter((w) => w.key === key)
			expect(mine.every((w) => w.pluginId === pluginId)).toBe(true)
			expect(mine.map((w) => w.warning)).toEqual([
				"'ghost' names a widget this pub does not know — it draws as a placeholder",
				"'acme.cards:hand' is placed 2 times, over its maxInstances (1) — readers draw the first 1"
			])

			const lines = await linesFor(report, pluginId)
			expect(lines).toHaveLength(2)
			expect(lines[0]).toBe(
				`layout ${key}: 'ghost' names a widget this pub does not know — it draws as a placeholder`
			)
		},
		60_000
	)

	test(
		"a disabled plugin's widgets are unknown to another package's layout",
		async () => {
			await installPlugin("acme.dormant", [], false, {
				widgets: [{ id: "dial", title: "Dial", component: "dial" }]
			})
			const pluginId = "acme.borrower"
			await installPlugin(pluginId, [
				{
					genreId: "core:genre/chat",
					slug: "borrowed",
					name: "Borrowed",
					preset: layoutNaming("acme.dormant:dial")
				}
			])
			const report = await sync()
			const key = `layout:core:genre/chat:${pluginId}/borrowed`
			expect(report.projected).toContain(key)
			expect(await linesFor(report, pluginId)).toEqual([
				`layout ${key}: 'acme.dormant:dial' names a widget this pub does not know — it draws as a placeholder`
			])
		},
		60_000
	)

	test(
		"a refusal carries its package, and the report lines name it",
		async () => {
			const pluginId = "acme.squatter"
			await installPlugin(pluginId, [
				{
					genreId: "core:genre/chat",
					slug: "default",
					name: "Squat",
					preset: layoutNaming("stats")
				}
			])
			const report = await sync()
			const key = `layout:core:genre/chat:${pluginId}/default`
			expect(report.refused.find((r) => r.key === key)?.pluginId).toBe(pluginId)
			expect(await linesFor(report, pluginId)).toEqual([
				expect.stringMatching(new RegExp(`^layout ${key} refused: 'default' is the genre owner's slug`))
			])
		},
		60_000
	)
})

/** The report lines for one package, as the install command prints them. */
const linesFor = async (
	report: Awaited<ReturnType<typeof sync>>,
	pluginId: string
): Promise<string[]> =>
	(await import("./pluginLayouts")).pluginLayoutReportLines(report, pluginId)

describe("writing only what changed", () => {
	test(
		"a sync that changes nothing writes nothing — updated_at and layout_updated_at stay",
		async () => {
			const pluginId = "acme/steady"
			await installPlugin(pluginId, [
				{
					genreId: "core:genre/chat",
					slug: "steady",
					name: "Steady",
					preset: layoutNaming("steady")
				}
			])
			await sync()
			const key = `layout:core:genre/chat:${pluginId}/steady`
			const before = await rowByKey(key)
			await new Promise((r) => setTimeout(r, 15))
			const report = await sync()
			expect(report.projected).toContain(key)
			const after = await rowByKey(key)
			expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
			expect(after.layoutUpdatedAt.getTime()).toBe(
				before.layoutUpdatedAt.getTime()
			)
			expect(after).toEqual(before)
		},
		60_000
	)

	test(
		"a rename re-forces the row but leaves layout_updated_at; disable and re-enable leave it too",
		async () => {
			const pluginId = "acme/renamed"
			const plugin = await installPlugin(pluginId, [
				{
					genreId: "core:genre/chat",
					slug: "same",
					name: "Before",
					preset: layoutNaming("same")
				}
			])
			await sync()
			const key = `layout:core:genre/chat:${pluginId}/same`
			const before = await rowByKey(key)
			await testDb
				.update(schema.plugins)
				.set({
					manifest: {
						layouts: [
							{
								genreId: "core:genre/chat",
								slug: "same",
								name: "After",
								preset: layoutNaming("same")
							}
						]
					}
				})
				.where(eq(schema.plugins.id, plugin.id))
			await sync()
			await testDb
				.update(schema.plugins)
				.set({ enabled: false })
				.where(eq(schema.plugins.id, plugin.id))
			await sync()
			await testDb
				.update(schema.plugins)
				.set({ enabled: true })
				.where(eq(schema.plugins.id, plugin.id))
			await sync()
			const after = await rowByKey(key)
			expect(after.name).toBe("After")
			expect(after.withdrawnAt).toBeNull()
			expect(after.layoutUpdatedAt.getTime()).toBe(
				before.layoutUpdatedAt.getTime()
			)
		},
		60_000
	)
})
