/**
 * R67 (owner, 2026-09-24): a disabled plugin appears nowhere in the front end
 * outside the plugins page, and comes back whole when it is turned on. What
 * is pinned: the LISTINGS drop what it owns (its genre, its pipelines), and
 * the RUNTIME read (`listSessionGenres`, which existing sessions resolve
 * through) still has them.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import {
	listOfferedGenres,
	listSessionGenres
} from "$lib/server/pipelines/entities/sessionGenres"
import { listNamespaces } from "$lib/server/pipelines/config/panel/read"
import { disabledPlugins } from "$lib/server/plugins/disabledPlugins"

let db: TestDb
const GENRE = "core:genre/adventure"

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
}, 60_000)

describe("a disabled plugin in the listings (R67)", () => {
	// A plugin's own switch only means something with the subsystem on.
	let was: string | undefined
	beforeAll(() => {
		was = process.env.SP_PLUGINS_ENABLED
		process.env.SP_PLUGINS_ENABLED = "1"
	})
	afterAll(() => {
		if (was === undefined) delete process.env.SP_PLUGINS_ENABLED
		else process.env.SP_PLUGINS_ENABLED = was
	})
	it("hides its genre and pipelines from listings, never from resolution", async () => {
		const [plugin] = await db
			.insert(schema.plugins)
			.values({
				pluginId: "acme.off",
				name: "Off",
				version: "1.0.0",
				bundleSource: "// none",
				bundleHash: "r67",
				enabled: false,
				manifest: {} as any
			})
			.returning({ id: schema.plugins.id })
		// Stand the plugin in as the owner of adventure's pipelines.
		const owned = await db
			.select({ id: schema.pipelineSpecs.id, slug: schema.pipelineSpecs.slug })
			.from(schema.pipelineSpecs)
			.innerJoin(
				schema.pipelineSpecVersions,
				eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId)
			)
			.where(eq(schema.pipelineSpecVersions.inputGenre, GENRE))
		expect(owned.length).toBeGreaterThan(0)
		for (const s of owned)
			await db
				.update(schema.pipelineSpecs)
				.set({ sourcePluginId: plugin.id })
				.where(eq(schema.pipelineSpecs.id, s.id))

		expect((await listOfferedGenres(db)).some((g) => g.genreId === GENRE)).toBe(false)
		expect((await listSessionGenres(db)).some((g) => g.genreId === GENRE)).toBe(true)
		const listed = new Set((await listNamespaces(db)).map((n) => n.slug))
		for (const s of owned) expect(listed.has(s.slug)).toBe(false)

		// Turned back on: everything returns, nothing to reinstall.
		await db
			.update(schema.plugins)
			.set({ enabled: true })
			.where(eq(schema.plugins.id, plugin.id))
		expect((await listOfferedGenres(db)).some((g) => g.genreId === GENRE)).toBe(true)
		expect((await disabledPlugins(db)).ids.size).toBe(0)
	})

	it("a disabled plugin's non-create spec locked to a core genre does not hide that genre (R67 review)", async () => {
		const [plugin] = await db
			.insert(schema.plugins)
			.values({
				pluginId: "acme.reply",
				name: "Reply",
				version: "1.0.0",
				bundleSource: "// none",
				bundleHash: "r67-c",
				enabled: false,
				manifest: {} as any
			})
			.returning({ id: schema.plugins.id })
		const [respond] = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/respond"))
		await db
			.update(schema.pipelineSpecs)
			.set({ sourcePluginId: plugin.id })
			.where(eq(schema.pipelineSpecs.id, respond.id))
		try {
			expect((await listOfferedGenres(db)).some((g) => g.genreId === "core:genre/chat")).toBe(true)
		} finally {
			await db
				.update(schema.pipelineSpecs)
				.set({ sourcePluginId: null })
				.where(eq(schema.pipelineSpecs.id, respond.id))
		}
	})

	it("owns a namespaced id by its plugin slug", async () => {
		await db.insert(schema.plugins).values({
			pluginId: "acme.dark",
			name: "Dark",
			version: "1.0.0",
			bundleSource: "// none",
			bundleHash: "r67-b",
			enabled: false,
			manifest: {} as any
		})
		const off = await disabledPlugins(db)
		expect(off.ownsId("acme.dark:spec/x")).toBe(true)
		expect(off.ownsId("acme.darker:spec/x")).toBe(false)
		expect(off.ownsId("core:spec/respond")).toBe(false)
	})
})

describe("the subsystem switched off", () => {
	it("counts every plugin as switched off for listings, enabled or not", async () => {
		const [on] = await db
			.insert(schema.plugins)
			.values({
				pluginId: "acme.on",
				name: "On",
				version: "1.0.0",
				bundleSource: "// none",
				bundleHash: "r67-flag",
				enabled: true,
				manifest: {} as any
			})
			.returning({ id: schema.plugins.id })
		const was = process.env.SP_PLUGINS_ENABLED
		try {
			process.env.SP_PLUGINS_ENABLED = "1"
			const lit = await disabledPlugins(db)
			expect(lit.owns(on.id)).toBe(false)
			expect(lit.ownsId("acme.on:genre/x@1")).toBe(false)

			delete process.env.SP_PLUGINS_ENABLED
			const dark = await disabledPlugins(db)
			expect(dark.owns(on.id)).toBe(true)
			expect(dark.ownsId("acme.on:genre/x@1")).toBe(true)
			// Core is never a plugin's, flag or no flag.
			expect(dark.ownsId("core:genre/chat")).toBe(false)
		} finally {
			if (was === undefined) delete process.env.SP_PLUGINS_ENABLED
			else process.env.SP_PLUGINS_ENABLED = was
		}
	})
})
