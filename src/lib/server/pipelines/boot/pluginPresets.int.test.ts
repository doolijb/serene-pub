/**
 * A package's `preset()` declarations, as rows.
 *
 * A package announces genres, pipelines, configs and presets (24 §10), and the
 * preset is the one a person actually picks — it is what binds each of a genre's
 * event slots to a pipeline. `syncDeclarations` projected the engines and the
 * event subscriptions and stopped there, so a package could ship a complete,
 * coverage-checked preset and an administrator would find nothing to enable.
 *
 * Two properties beyond "the row appears", and both are about who decides what:
 *
 *  · it arrives **disabled**, because which presets an instance offers is the
 *    instance owner's decision and a package installing one straight into
 *    everybody's picker would be making it for them;
 *  · disabling the plugin **marks** the row rather than deleting it, because a
 *    session names its preset and switching an extension off is a reversible,
 *    everyday act.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import { syncPluginPresets } from "$lib/server/pipelines/boot/registrySync"
import * as schema from "$lib/server/db/schema"

// So `sessionPresetsList` (imported below by its real module path) reads
// the same isolated database this file seeds, instead of the app's own.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

let db: TestDb
let pluginRowId: number

const SEED_KEY = "plugin:acme.dice:board-default"

const manifest = (overrides: Record<string, unknown> = {}) => ({
	presets: [
		{
			slug: "board-default",
			genre: "acme.dice:genre/board",
			label: "Dice Board",
			description: "The board, everything default.",
			bindings: {
				"session-created": { spec: "acme.dice:spec/create-board" },
				// A config slug, which is what a declaration carries and what
				// the column cannot hold — see `syncPluginPresets`.
				"message-respond": {
					spec: "acme.dice:spec/roll",
					config: "loud"
				}
			},
			actions: { include: ["acme.dice:spec/reroll"] },
			...overrides
		}
	]
})

const install = async (opts: {
	enabled: boolean
	manifest: Record<string, unknown>
}) => {
	const [row] = await db
		.insert(schema.plugins)
		.values({
			pluginId: "acme.dice",
			name: "Dice Tray",
			bundleSource: "//",
			bundleHash: "sha256:test",
			backends: ["quickjs"],
			backend: "quickjs",
			enabled: opts.enabled,
			manifest: opts.manifest
		})
		.onConflictDoUpdate({
			target: schema.plugins.pluginId,
			set: { enabled: opts.enabled, manifest: opts.manifest }
		})
		.returning()
	return row
}

const presetRow = async () =>
	(
		await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, SEED_KEY))
			.limit(1)
	)[0] as any

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const row = await install({ enabled: true, manifest: manifest() })
	pluginRowId = row.id
}, 60_000)

describe("plugin presets", () => {
	it("projects a declaration into a row an administrator can enable", async () => {
		const report = await syncPluginPresets(db)
		expect(report.projected).toEqual([SEED_KEY])

		const row = await presetRow()
		expect(row.name).toBe("Dice Board")
		expect(row.genreId).toBe("acme.dice:genre/board")
		expect(row.ownerPluginId).toBe(pluginRowId)
		expect(row.includedActions).toEqual(["acme.dice:spec/reroll"])
		expect(
			row.enabled,
			"a package must not decide what this instance offers"
		).toBe(false)
	})

	it("keeps a declared config slug out of the id column", async () => {
		// The column holds a `pipeline_configs.id`, which is an instance fact;
		// the declaration carries a slug in the package's own namespace. There
		// is nothing to resolve it against, so the binding lands without one and
		// the spec's shipped default applies.
		const row = await presetRow()
		expect(row.bindings["message-respond"]).toEqual({
			spec: "acme.dice:spec/roll"
		})
	})

	it("is idempotent, and never rewrites the administrator's switch", async () => {
		await db
			.update(schema.sessionPresets)
			.set({ enabled: true })
			.where(eq(schema.sessionPresets.seedKey, SEED_KEY))

		const again = await syncPluginPresets(db)
		expect(again.projected).toEqual([])
		expect((await presetRow()).enabled).toBe(true)
	})

	it("marks the row withdrawn when the plugin is disabled, and never deletes it", async () => {
		await install({ enabled: false, manifest: manifest() })
		const report = await syncPluginPresets(db)
		expect(report.withdrawn).toEqual([SEED_KEY])

		const row = await presetRow()
		expect(
			row,
			"a session names its preset — the row must survive"
		).toBeTruthy()
		expect(row.withdrawnAt).toBeTruthy()
		expect(
			row.enabled,
			"withdrawal is not a decision about whether it may be offered"
		).toBe(true)
	})

	it("restores it, with the administrator's decision intact", async () => {
		await install({ enabled: true, manifest: manifest() })
		const report = await syncPluginPresets(db)
		expect(report.restored).toEqual([SEED_KEY])

		const row = await presetRow()
		expect(row.withdrawnAt).toBeNull()
		expect(row.enabled).toBe(true)
	})

	it("honours a declaration that asks to be offered immediately", async () => {
		await db
			.delete(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, SEED_KEY))
		await install({
			enabled: true,
			manifest: manifest({ enabled: true })
		})
		await syncPluginPresets(db)
		expect((await presetRow()).enabled).toBe(true)
	})

	it("withdraws a preset the package stopped declaring", async () => {
		await install({ enabled: true, manifest: { presets: [] } })
		const report = await syncPluginPresets(db)
		expect(report.withdrawn).toEqual([SEED_KEY])
		expect((await presetRow()).withdrawnAt).toBeTruthy()
	})

	it("drops a withdrawn preset from the non-admin picker, and keeps it for an admin", async () => {
		// Self-contained rather than relying on the previous test's leftover
		// state: withdraw it here too, so this test passes regardless of run
		// order — `enabled` stays true, per the ruling that withdrawal is not
		// a decision about whether it may be offered.
		await install({ enabled: true, manifest: manifest() })
		await syncPluginPresets(db)
		await install({ enabled: true, manifest: { presets: [] } })
		await syncPluginPresets(db)
		const withdrawn = await presetRow()
		expect(withdrawn.withdrawnAt, "setup: must be withdrawn").toBeTruthy()
		expect(withdrawn.enabled, "setup: enabled survives withdrawal").toBe(
			true
		)

		const { sessionPresetsList } = await import(
			"$lib/server/sockets/sessionAdmin"
		)
		const socket = (isAdmin: boolean) =>
			({ user: { id: 1, isAdmin } }) as any
		const noopEmit = () => {}

		const nonAdmin: any = await sessionPresetsList.handler(
			socket(false),
			{},
			noopEmit
		)
		expect(
			nonAdmin.presets.some((p: any) => p.id === withdrawn.id),
			"a withdrawn preset must not be offered to a non-admin"
		).toBe(false)

		const admin: any = await sessionPresetsList.handler(
			socket(true),
			{},
			noopEmit
		)
		expect(
			admin.presets.some((p: any) => p.id === withdrawn.id),
			"the admin list still shows a withdrawn preset"
		).toBe(true)
	})
})
