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

const sync = async (decls: WidgetDecl[], version = "1.0.0") =>
	(await import("./widgetStyles")).syncWidgetStyles(decls, version)

const widget = (id: string, presets: WidgetDecl["presets"]): WidgetDecl => ({
	id,
	title: id,
	surface: { kind: "native", component: id },
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
			widget("composer", [{ slug: "default", title: "Default", css: "" }])
		])
		// A later sync of ONLY messages must not prune composer's system rows.
		await sync([
			widget("messages", [{ slug: "default", title: "Default", css: "" }])
		])
		const composer = await systemRows("composer")
		expect(composer.map((r) => r.slug)).toContain(
			systemStyleSlug("composer", "default")
		)
	})
})

describe("the shipped message + composer packs", () => {
	/** What `withCorePresets` is expected to put in front of the reconciler. */
	const coreDecls = () =>
		withCorePresets([
			widget("messages", [{ slug: "default", title: "Default", css: "" }]),
			widget("composer", [{ slug: "default", title: "Default", css: "" }]),
			widget("scene-portraits", [
				{ slug: "default", title: "Default", css: "" }
			])
		])

	test("seeds eight pack rows under the expected slugs", async () => {
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
		expect((await systemRows("composer")).map((r) => r.slug).sort()).toEqual(
			[
				systemStyleSlug("composer", "default"),
				systemStyleSlug("composer", "minimal"),
				systemStyleSlug("composer", "writer")
			].sort()
		)
	})

	test("the `default` slot holds Clean / Classic, with Clean's real CSS", async () => {
		// The slot an unpinned widget resolves to has to hold what a session
		// looked like before the packs became styles.
		await sync(coreDecls())
		const messages = new Map(
			(await systemRows("messages")).map((r) => [r.slug, r])
		)
		const clean = messages.get(systemStyleSlug("messages", "default"))!
		expect(clean.title).toBe("Clean")
		expect(clean.css).toContain("--sp-clean-card")
		const composer = new Map(
			(await systemRows("composer")).map((r) => [r.slug, r])
		)
		expect(
			composer.get(systemStyleSlug("composer", "default"))!.title
		).toBe("Classic")
	})

	test("pack rows are system rows and carry the seeding version", async () => {
		await sync(coreDecls(), "9.9.9")
		for (const r of [
			...(await systemRows("messages")),
			...(await systemRows("composer"))
		]) {
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
