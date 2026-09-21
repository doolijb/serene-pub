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
				"core:event/session-created@1": { spec: "acme.dice:spec/create-board" },
				// A config slug, which is what a declaration carries and what
				// the column cannot hold — see `syncPluginPresets`.
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
		expect(row.includedActions).toEqual(["acme.dice:spec/reroll#reroll"])
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
		expect(row.bindings["core:event/message-respond@1"]).toEqual({
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

	it("reads a bare binding key from a previous-SDK manifest as the event id, once, and says so", async () => {
		// A package built before R-4 keys its bindings by bare genre-event
		// name. Written verbatim, that key would undo migration 0134's fold
		// on every boot and the run's lookup by id would find nothing — a
		// preset binding nothing, silently (U3 review, W6). One release of
		// normalisation, then the bare key is refused at packaging only.
		// A bare key only ever meant a CORE event, so this is exercised
		// under a core genre — see the non-core case below.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			await install({
				enabled: true,
				manifest: manifest({
					genre: "core:genre/chat",
					bindings: {
						"session-created": { spec: "acme.dice:spec/create-board" },
						"message-respond": { spec: "acme.dice:spec/roll" }
					}
				})
			})
			const report = await syncPluginPresets(db)
			expect(report.normalisedBindingKeys).toEqual([SEED_KEY])
			expect(Object.keys((await presetRow()).bindings).sort()).toEqual([
				"core:event/message-respond@1",
				"core:event/session-created@1"
			])
			// Logged once per preset per sync, not once per key.
			expect(
				warn.mock.calls.filter(([m]) =>
					String(m).includes(`preset ${SEED_KEY} binds`)
				).length
			).toBe(1)
			// And an id-keyed manifest is written as it is, with nothing to say.
			await install({ enabled: true, manifest: manifest() })
			const clean = await syncPluginPresets(db)
			expect(clean.normalisedBindingKeys).toEqual([])
		} finally {
			warn.mockRestore()
		}
	})

	it("skips a bare binding key declared under a non-core genre, and says so", async () => {
		// The previous-SDK bare key only ever resolved to `core:event/<name>@1`
		// — a plugin's own genre owns no bare-named events, so normalising it
		// here would bind against an id nobody declared. `acme.dice:genre/board`
		// is not core, so the binding is dropped rather than guessed at.
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
			expect(report.normalisedBindingKeys).toEqual([])
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

	it("promotes a bare included key exactly one action declares, keeps the rest bare, and says so once — never refusing (W1)", async () => {
		// A manifest packaged by a previous SDK may include an action by bare
		// function key. Written verbatim it would put the pre-identity shape
		// back on every boot; refused, the preset would vanish. So it runs
		// the lenient normaliser: a key one action of the genre declares
		// becomes that identity, the rest stay bare and are reported.
		const { spec, compile } = await import("@serene-pub/sdk")
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
						taxonomy: { role: "action", genre: GENRE },
						contributes: {
							actions: [
								{
									key: fn,
									genre: GENRE,
									venue: { kind: "composer" },
									label: { en: fn },
									...(slash ? { slash } : {})
								}
							]
						}
					})
						.inlet("input", C.userMessage.v1(), {
							genre: GENRE,
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
				"acme.dice:spec/reroll#reroll",
				"cheat",
				"teleport"
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
