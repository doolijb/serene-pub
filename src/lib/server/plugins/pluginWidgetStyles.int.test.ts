/**
 * A plugin ships a widget style: its widget declaration's `presets` become
 * system rows a person can pick, owned by the plugin through the namespaced
 * widget id, kept while it is installed (enabled or not) and removed with it.
 * Core's boot sync, which speaks for every other system row, leaves them be.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(() => {})

let n = 0

const manifest = (pluginId: string, presets: unknown[]) => ({
	widgets: [
		{
			id: "tray",
			title: { en: "Dice tray" },
			component: "tray",
			presets
		},
		{ id: "plain", title: "Plain", component: "plain" }
	]
})

const FELT = { slug: "felt", title: { en: "Felt" }, css: ".die { color: green }", vars: { "--felt": "#2f5d3a" } }
const DEFAULT = { slug: "default", title: "Default", css: "" }

async function install(presets: unknown[], enabled = true) {
	const pluginId = `acme.dice-${n++}`
	await testDb.insert(schema.plugins).values({
		pluginId,
		name: "Dice",
		version: "2.1.0",
		bundleSource: "// x",
		bundleHash: "deadbeef",
		enabled,
		manifest: manifest(pluginId, presets)
	})
	return pluginId
}

const sync = async () =>
	(await import("./pluginWidgetStyles")).syncPluginWidgetStyles(testDb as never)

const rowsFor = (widgetSlug: string) =>
	testDb
		.select()
		.from(schema.widgetStyles)
		.where(eq(schema.widgetStyles.widgetSlug, widgetSlug))

describe("a plugin's widget presets", () => {
	test("are seeded as system rows under the plugin's widget id", async () => {
		const pluginId = await install([DEFAULT, FELT])
		expect(await sync()).toEqual([])
		const rows = await rowsFor(`${pluginId}:tray`)
		expect(rows.map((r) => r.slug).sort()).toEqual([
			`${pluginId}:tray:default`,
			`${pluginId}:tray:felt`
		])
		const felt = rows.find((r) => r.slug.endsWith(":felt"))!
		expect(felt).toMatchObject({
			source: "system",
			visibility: "system",
			ownerUserId: null,
			title: "Felt",
			css: ".die { color: green }",
			vars: { "--felt": "#2f5d3a" },
			seededByVersion: "2.1.0"
		})
		// Idempotent: a second pass writes no second row.
		await sync()
		expect(await rowsFor(`${pluginId}:tray`)).toHaveLength(2)
	})

	test("a preset that breaks a style's rules is refused by name; the rest seed", async () => {
		const pluginId = await install([
			FELT,
			{ slug: "remote", title: "Remote", css: "@import url(https://evil.example/x.css);" },
			{ slug: "Bad Slug", title: "Bad", css: "" }
		])
		const lines = await sync()
		expect(lines.some((l) => l.includes(pluginId) && l.includes("'remote'"))).toBe(true)
		expect(lines.some((l) => l.includes(pluginId) && l.includes("'Bad Slug'"))).toBe(true)
		expect((await rowsFor(`${pluginId}:tray`)).map((r) => r.slug)).toEqual([
			`${pluginId}:tray:felt`
		])
	})

	test("a preset the plugin stops shipping is removed; a person's own style is not", async () => {
		const pluginId = await install([DEFAULT, FELT])
		await sync()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const alice = await createTestUser(testDb, `alice-${n++}`)
		await testDb.insert(schema.widgetStyles).values({
			slug: `user:${alice.id}:${pluginId}:tray:mine`,
			widgetSlug: `${pluginId}:tray`,
			source: "user",
			ownerUserId: alice.id,
			visibility: "private",
			title: "Mine"
		})
		await testDb
			.update(schema.plugins)
			.set({ manifest: manifest(pluginId, [DEFAULT]) })
			.where(eq(schema.plugins.pluginId, pluginId))
		await sync()
		expect(
			(await rowsFor(`${pluginId}:tray`)).map((r) => [r.source, r.slug]).sort()
		).toEqual([
			["system", `${pluginId}:tray:default`],
			["user", `user:${alice.id}:${pluginId}:tray:mine`]
		])
	})

	test("a disabled plugin keeps its styles; an uninstalled one's system rows go", async () => {
		const pluginId = await install([FELT], false)
		await sync()
		expect(await rowsFor(`${pluginId}:tray`)).toHaveLength(1)

		await testDb.delete(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		await sync()
		expect(await rowsFor(`${pluginId}:tray`)).toHaveLength(0)
	})

	test("core's boot sync, which prunes every widget it does not declare, spares them", async () => {
		const pluginId = await install([FELT])
		await sync()
		const { syncWidgetStyles } = await import("$lib/server/db/widgetStyles")
		const { CORE_WIDGETS } = await import("$lib/shared/widgets/types")
		await syncWidgetStyles(CORE_WIDGETS, "9.9.9", { pruneUndeclared: true })
		expect(
			await testDb
				.select()
				.from(schema.widgetStyles)
				.where(
					and(
						eq(schema.widgetStyles.widgetSlug, `${pluginId}:tray`),
						eq(schema.widgetStyles.source, "system")
					)
				)
		).toHaveLength(1)
	})
})
