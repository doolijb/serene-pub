/**
 * The widget-style reconciler seeds system rows by slug and prunes dropped
 * presets — WITHOUT ever touching a user's own style. These pin the same
 * upgrade-safety invariants defaults.seedKey.int.test.ts pins for the config
 * seeds, applied to `widget_styles`.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { systemStyleSlug, type WidgetDecl } from "$lib/shared/widgets/types"
import { withCorePresets } from "$lib/shared/widgets/corePresets"
import type { TestDb } from "$lib/server/utils/testDb"
import type { SyncWidgetStylesOptions } from "./widgetStyles"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-widgetstyles-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const sync = async (
	decls: WidgetDecl[],
	version = "1.0.0",
	options?: SyncWidgetStylesOptions
) =>
	(await import("./widgetStyles")).syncWidgetStyles(decls, version, options)

const widget = (id: string, presets: WidgetDecl["presets"]): WidgetDecl => ({
	id,
	title: id,
	component: id,
	presets
})

const systemRows = (widgetSlug: string) =>
	testDb
		.select()
		.from(schema.widgetStyles)
		.where(
			and(
				eq(schema.widgetStyles.widgetSlug, widgetSlug),
				eq(schema.widgetStyles.source, "system")
			)
		)

describe("syncWidgetStyles", () => {
	test("seeds shipped presets as system rows keyed by systemStyleSlug", async () => {
		await sync([
			widget("messages", [
				{ slug: "default", title: "Default", css: "" },
				{ slug: "compact", title: "Compact", css: ".m{gap:0}" }
			])
		])
		const rows = await systemRows("messages")
		const bySlug = new Map(rows.map((r) => [r.slug, r]))
		expect(bySlug.get(systemStyleSlug("messages", "default"))?.title).toBe(
			"Default"
		)
		expect(bySlug.get(systemStyleSlug("messages", "compact"))?.css).toBe(
			".m{gap:0}"
		)
		for (const r of rows) {
			expect(r.source).toBe("system")
			expect(r.ownerUserId).toBeNull()
			expect(r.visibility).toBe("system")
		}
	})

	test("is idempotent — a second sync neither duplicates nor renumbers", async () => {
		const decl = [
			widget("messages", [{ slug: "default", title: "Default", css: "" }])
		]
		await sync(decl)
		const [before] = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(
				eq(
					schema.widgetStyles.slug,
					systemStyleSlug("messages", "default")
				)
			)
		await sync(decl)
		const rows = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(
				eq(
					schema.widgetStyles.slug,
					systemStyleSlug("messages", "default")
				)
			)
		expect(rows).toHaveLength(1)
		expect(rows[0].id).toBe(before.id)
	})

	test("re-forces an edited system row's content", async () => {
		await sync([
			widget("messages", [{ slug: "default", title: "Default", css: "" }])
		])
		await testDb
			.update(schema.widgetStyles)
			.set({ title: "tampered", css: "hacked" })
			.where(
				eq(
					schema.widgetStyles.slug,
					systemStyleSlug("messages", "default")
				)
			)
		await sync([
			widget("messages", [{ slug: "default", title: "Default", css: "" }])
		])
		const [r] = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(
				eq(
					schema.widgetStyles.slug,
					systemStyleSlug("messages", "default")
				)
			)
		expect(r.title).toBe("Default")
		expect(r.css).toBe("")
	})

	test("prunes a system preset that is no longer shipped", async () => {
		await sync([
			widget("messages", [
				{ slug: "default", title: "Default", css: "" },
				{ slug: "compact", title: "Compact", css: "" }
			])
		])
		expect((await systemRows("messages")).map((r) => r.slug)).toContain(
			systemStyleSlug("messages", "compact")
		)
		// Next release drops "compact".
		await sync([
			widget("messages", [{ slug: "default", title: "Default", css: "" }])
		])
		const slugs = (await systemRows("messages")).map((r) => r.slug)
		expect(slugs).toContain(systemStyleSlug("messages", "default"))
		expect(slugs).not.toContain(systemStyleSlug("messages", "compact"))
	})

	test("does NOT touch a user's own style, even on prune", async () => {
		await sync([
			widget("messages", [{ slug: "default", title: "Default", css: "" }])
		])
		const [mine] = await testDb
			.insert(schema.widgetStyles)
			.values({
				slug: "user-my-messages-skin",
				widgetSlug: "messages",
				source: "user",
				ownerUserId: null, // no users seeded in this bare test db
				visibility: "private",
				title: "My Skin",
				css: ".mine{color:red}"
			})
			.returning()

		// A sync that ships nothing for this widget must still spare the user row.
		await sync([widget("messages", [])])

		const [after] = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(eq(schema.widgetStyles.id, mine.id))
		expect(after).toEqual(mine)
	})

	test("prune is scoped to the synced widget ids — other widgets' system rows survive", async () => {
		await sync([
			widget("messages", [{ slug: "default", title: "Default", css: "" }]),
			widget("retired", [{ slug: "default", title: "Default", css: "" }])
		])
		// A later sync of ONLY messages must not prune the other widget's rows:
		// a plugin syncing its own widgets speaks for its own ids alone.
		await sync([
			widget("messages", [{ slug: "default", title: "Default", css: "" }])
		])
		expect((await systemRows("retired")).map((r) => r.slug)).toContain(
			systemStyleSlug("retired", "default")
		)
	})

	test("pruneUndeclared takes a widget that is no longer declared at all", async () => {
		// The per-preset prune above can only reach ids still in the decls, so
		// a widget core stops shipping leaves its skins in the picker for good.
		// Core boot is the one caller that can say "these are all of them".
		await sync([
			widget("messages", [{ slug: "default", title: "Default", css: "" }]),
			widget("retired", [
				{ slug: "default", title: "Default", css: "" },
				{ slug: "minimal", title: "Minimal", css: ".c{}" }
			])
		])
		expect((await systemRows("retired")).length).toBe(2)

		await sync(
			[
				widget("messages", [
					{ slug: "default", title: "Default", css: "" }
				])
			],
			"1.0.0",
			{ pruneUndeclared: true }
		)
		expect(await systemRows("retired")).toEqual([])
		expect((await systemRows("messages")).map((r) => r.slug)).toContain(
			systemStyleSlug("messages", "default")
		)
	}, 60_000)

	test("pruneUndeclared still spares a user's own style for that widget", async () => {
		await sync([
			widget("messages", [{ slug: "default", title: "Default", css: "" }]),
			widget("retired", [{ slug: "default", title: "Default", css: "" }])
		])
		const [mine] = await testDb
			.insert(schema.widgetStyles)
			.values({
				slug: "user:1:retired:keepme",
				widgetSlug: "retired",
				source: "user",
				ownerUserId: null,
				visibility: "private",
				title: "My Skin",
				css: ".mine{color:red}"
			})
			.returning()

		await sync(
			[
				widget("messages", [
					{ slug: "default", title: "Default", css: "" }
				])
			],
			"1.0.0",
			{ pruneUndeclared: true }
		)

		const [after] = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(eq(schema.widgetStyles.id, mine.id))
		expect(after).toEqual(mine)
		expect(await systemRows("retired")).toEqual([])
	}, 60_000)

	test("pruneUndeclared with nothing declared writes nothing at all", async () => {
		// An empty decl set is not "nothing is declared" — read that way the
		// delete carries no widget predicate and takes the whole table.
		await sync([
			widget("messages", [{ slug: "default", title: "Default", css: "" }])
		])
		await sync([], "1.0.0", { pruneUndeclared: true })
		expect((await systemRows("messages")).map((r) => r.slug)).toContain(
			systemStyleSlug("messages", "default")
		)
	}, 60_000)
})

describe("the shipped message packs", () => {
	/** What `withCorePresets` is expected to put in front of the reconciler. */
	const coreDecls = () =>
		withCorePresets([
			widget("messages", [{ slug: "default", title: "Default", css: "" }]),
			widget("scene-portraits", [
				{ slug: "default", title: "Default", css: "" }
			])
		])

	test("seeds five pack rows under the expected slugs", async () => {
		await sync(coreDecls())
		expect((await systemRows("messages")).map((r) => r.slug).sort()).toEqual(
			[
				systemStyleSlug("messages", "bubbles"),
				systemStyleSlug("messages", "cameo"),
				systemStyleSlug("messages", "compact"),
				systemStyleSlug("messages", "default"),
				systemStyleSlug("messages", "novel")
			].sort()
		)
	})

	test("the `default` slot holds Stage, with its real CSS", async () => {
		// The slot an unpinned widget resolves to has to hold the house look,
		// so a fresh layout reads as the stage rather than as bare markup.
		await sync(coreDecls())
		const messages = new Map(
			(await systemRows("messages")).map((r) => [r.slug, r])
		)
		const stage = messages.get(systemStyleSlug("messages", "default"))!
		expect(stage.title).toBe("Stage")
		expect(stage.css).toContain("--sp-stage-card")
	})

	test("the composer look is a setting, so it seeds no style rows", async () => {
		await sync(coreDecls(), "1.0.0", { pruneUndeclared: true })
		expect(await systemRows("composer")).toEqual([])
	}, 60_000)

	test("pack rows are system rows and carry the seeding version", async () => {
		await sync(coreDecls(), "9.9.9")
		for (const r of await systemRows("messages")) {
			expect(r.source).toBe("system")
			expect(r.visibility).toBe("system")
			expect(r.ownerUserId).toBeNull()
			expect(r.seededByVersion).toBe("9.9.9")
		}
	})

	test("a pack row is refreshed and pruned like any other system row", async () => {
		await sync(coreDecls())
		const [before] = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(
				eq(
					schema.widgetStyles.slug,
					systemStyleSlug("messages", "bubbles")
				)
			)
		await testDb
			.update(schema.widgetStyles)
			.set({ title: "tampered", css: "hacked" })
			.where(eq(schema.widgetStyles.id, before.id))

		// Re-seeding restores it in place — same id, shipped content back.
		await sync(coreDecls())
		const [after] = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(eq(schema.widgetStyles.id, before.id))
		expect(after.title).toBe("Bubbles")
		expect(after.css).toBe(before.css)

		// And a release that drops the pack takes its row with it.
		await sync([
			widget("messages", [{ slug: "default", title: "Clean", css: "" }])
		])
		expect((await systemRows("messages")).map((r) => r.slug)).not.toContain(
			systemStyleSlug("messages", "bubbles")
		)
	})

	test("a user's own messages style survives a pack reseed", async () => {
		await sync(coreDecls())
		const [mine] = await testDb
			.insert(schema.widgetStyles)
			.values({
				slug: "user:1:messages:packsafe",
				widgetSlug: "messages",
				source: "user",
				ownerUserId: null,
				visibility: "private",
				title: "My Bubbles",
				css: ".sp-msg{color:red}"
			})
			.returning()
		await sync(coreDecls())
		const [after] = await testDb
			.select()
			.from(schema.widgetStyles)
			.where(eq(schema.widgetStyles.id, mine.id))
		expect(after).toEqual(mine)
	})
})
