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

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
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
				"core:event/session-created@1": { spec: "acme.dice:spec/create-board" },
				// A config slug of that spec — resolved to the row install wrote,
				// and none was written here. See `syncPluginPresets`.
				"core:event/message-respond@1": {
					spec: "acme.dice:spec/roll",
					config: "loud"
				}
			},
			// By identity (W-A) — what `preset()` packages now.
			actions: { include: ["acme.dice:spec/reroll#reroll"] },
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

// Listings treat every plugin as switched off while the subsystem is off.
const flagWas = process.env.SP_PLUGINS_ENABLED
afterAll(() => {
	if (flagWas === undefined) delete process.env.SP_PLUGINS_ENABLED
	else process.env.SP_PLUGINS_ENABLED = flagWas
})
beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
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
		expect(row.includedActions).toEqual(["acme.dice:spec/reroll#reroll"])
		expect(
			row.enabled,
			"a package must not decide what this instance offers"
		).toBe(false)
	})

	it("keeps a config slug that resolves to no installed row out of the id column, and says so", async () => {
		// The column holds a `pipeline_configs.id`, an instance fact; the
		// declaration carries a slug of the binding's spec. Nothing installed
		// 'loud' here, so the binding lands without one and the spec's shipped
		// default applies — never a guessed row. The resolving case is
		// `plugins/installConfigs.int.test.ts`.
		const row = await presetRow()
		expect(row.bindings["core:event/message-respond@1"]).toEqual({
			spec: "acme.dice:spec/roll"
		})
		const again = await syncPluginPresets(db)
		expect(again.unresolvedConfigs).toEqual([
			`${SEED_KEY} core:event/message-respond@1`
		])
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

	it("resolves a locale-map label and description to en, as the catalogue's seed does (R-20, U5i)", async () => {
		await install({
			enabled: true,
			manifest: manifest({
				label: { en: "Quick", fr: "Rapide" },
				description: { en: "Fast turns.", fr: "Tours rapides." }
			})
		})
		await syncPluginPresets(db)
		const row = await presetRow()
		expect(row.name).toBe("Quick")
		expect(row.description).toBe("Fast turns.")
		// And back to the bare spelling, which is the same value.
		await install({ enabled: true, manifest: manifest() })
		await syncPluginPresets(db)
		expect((await presetRow()).name).toBe("Dice Board")
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

	it("skips a binding keyed by anything but an event id, and says so once", async () => {
		// `announce.build()` refuses a bare key at packaging; one that reaches
		// the sync anyway is dropped and reported, never written.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			await install({
				enabled: true,
				manifest: manifest({
					bindings: {
						"session-created": { spec: "acme.dice:spec/create-board" }
					}
				})
			})
			const report = await syncPluginPresets(db)
			expect(report.skippedBindingKeys).toEqual([SEED_KEY])
			expect((await presetRow()).bindings).toEqual({})
			expect(
				warn.mock.calls.filter(([m]) =>
					String(m).includes(`preset ${SEED_KEY} binds`)
				).length
			).toBe(1)
		} finally {
			warn.mockRestore()
			// Restore an id-keyed manifest so later tests in this file resume
			// from the same fixture the rest of the suite assumes.
			await install({ enabled: true, manifest: manifest() })
			await syncPluginPresets(db)
		}
	})

	it("drops an included entry that is not an identity, keeps the identities, and says so once", async () => {
		// `preset()` refuses a bare key at packaging; one that reaches the
		// sync anyway is dropped and reported, never written.
		const { spec, compile, use } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const GENRE = "acme.dice:genre/board"
		// A second declarer of one key takes its own slash name (V2: one
		// name means one action); the bare key it shares is still two-declared.
		const publish = async (id: string, fn: string, slash?: string) =>
			saveDocument(
				db as any,
				compile(
					spec(id, {
						version: "1.0.0",
						taxonomy: { role: "action"},
						contributes: {
							actions: [
								{
									key: fn,
									venue: { kind: "composer" },
									label: { en: fn },
									description: { en: "A test action." },
									...(slash ? { slash } : {})
								}
							]
						}
					})
						.inlet("input", C.userMessage.v1(), {
							genre: use(GENRE),
							event: "core:event/session-action@1"
						})
						.outlet("save", ($) => C.createMessage.v1({ text: $.input.text }))
						.build()
				),
				{ publish: true }
			)
		// `reroll`: one declarer. `cheat`: two. `teleport`: none.
		await publish("acme.dice:spec/reroll", "reroll")
		await publish("acme.dice:spec/cheat", "cheat")
		await publish("acme.dice:spec/cheat-too", "cheat", "acme.dice.cheat-too")

		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			await install({
				enabled: true,
				manifest: manifest({
					actions: { include: ["reroll", "cheat", "teleport", "acme.dice:spec/reroll#reroll"] }
				})
			})
			const report = await syncPluginPresets(db)
			expect(report.bareIncludedKeys).toEqual([SEED_KEY])
			expect((await presetRow()).includedActions).toEqual([
				"acme.dice:spec/reroll#reroll"
			])
			// Logged once per preset per sync, not once per key.
			expect(
				warn.mock.calls.filter(([m]) =>
					String(m).includes(`preset ${SEED_KEY} includes`)
				).length
			).toBe(1)
			// And an identity-keyed manifest is written as it is, with nothing to say.
			await install({ enabled: true, manifest: manifest() })
			const clean = await syncPluginPresets(db)
			expect(clean.bareIncludedKeys).toEqual([])
			expect((await presetRow()).includedActions).toEqual([
				"acme.dice:spec/reroll#reroll"
			])
		} finally {
			warn.mockRestore()
		}
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

/**
 * Whose binding it is (the plugin-config posture, `plugins/install.ts`).
 *
 * The shipped row is immutable — selectable and copyable, never edited in
 * place — so a sync re-forcing it is how an update ships a new binding. A row
 * under the seed key that is NOT immutable has been made somebody's: neither a
 * re-sync nor an update writes its content again. Before this, every sync
 * rewrote `bindings`, and an administrator's rebinding was reset at the next
 * boot.
 */
describe("plugin presets: a person's choice survives, a shipped change reaches the untouched", () => {
	const respondTo = (spec: string) =>
		manifest({
			bindings: {
				"core:event/session-created@1": { spec: "acme.dice:spec/create-board" },
				"core:event/message-respond@1": { spec }
			}
		})

	it("lands the shipped row immutable and ships an update's changed binding into it", async () => {
		await install({ enabled: true, manifest: respondTo("acme.dice:spec/roll") })
		await syncPluginPresets(db)
		expect((await presetRow()).isImmutable).toBe(true)

		await install({ enabled: true, manifest: respondTo("acme.dice:spec/roll-v2") })
		await syncPluginPresets(db)
		const row = await presetRow()
		expect(row.isImmutable).toBe(true)
		expect(row.bindings["core:event/message-respond@1"]).toEqual({
			spec: "acme.dice:spec/roll-v2"
		})
	})

	it("adopts a mutable row still equal to what ships — untouched, so updates reach it", async () => {
		// A row projected before shipped presets were immutable: nobody
		// changed it, and a sync proves so by finding it equal.
		await db
			.update(schema.sessionPresets)
			.set({ isImmutable: false })
			.where(eq(schema.sessionPresets.seedKey, SEED_KEY))
		const report = await syncPluginPresets(db)
		expect(report.kept).toEqual([])
		expect((await presetRow()).isImmutable).toBe(true)

		await install({ enabled: true, manifest: respondTo("acme.dice:spec/roll-v3") })
		await syncPluginPresets(db)
		expect((await presetRow()).bindings["core:event/message-respond@1"]).toEqual({
			spec: "acme.dice:spec/roll-v3"
		})
	})

	it("keeps an administrator's rebinding across a re-sync and a plugin update", async () => {
		const mine = {
			"core:event/session-created@1": { spec: "acme.dice:spec/create-board" },
			"core:event/message-respond@1": { spec: "admin:spec/my-roll", config: 4242 }
		}
		await db
			.update(schema.sessionPresets)
			.set({ isImmutable: false, bindings: mine, name: "My board" })
			.where(eq(schema.sessionPresets.seedKey, SEED_KEY))

		const resync = await syncPluginPresets(db)
		expect(resync.kept).toEqual([SEED_KEY])
		expect((await presetRow()).bindings).toEqual(mine)

		await install({ enabled: true, manifest: respondTo("acme.dice:spec/roll-v4") })
		await syncPluginPresets(db)
		const row = await presetRow()
		expect(row.bindings, "an update must not reset a person's binding").toEqual(mine)
		expect(row.name).toBe("My board")
		expect(row.isImmutable).toBe(false)
	})

	it("still withdraws and restores a row that is somebody's", async () => {
		await install({ enabled: false, manifest: respondTo("acme.dice:spec/roll-v4") })
		expect((await syncPluginPresets(db)).withdrawn).toEqual([SEED_KEY])
		await install({ enabled: true, manifest: respondTo("acme.dice:spec/roll-v5") })
		const report = await syncPluginPresets(db)
		expect(report.restored).toEqual([SEED_KEY])
		const row = await presetRow()
		expect(row.withdrawnAt).toBeNull()
		expect(row.bindings["core:event/message-respond@1"].spec).toBe(
			"admin:spec/my-roll"
		)
	})
})
