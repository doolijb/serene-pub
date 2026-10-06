/**
 * The session catalogue's admin half (23 §9), proven at the handler seam:
 * admin gating on every mutation, the non-admin preset cut (enabled presets
 * of enabled types only), immutable-preset protections (availability flags
 * yes, content no, delete never), one-default-per-type, the settings upsert
 * behind sessionGenres:update, and sessions:create refusing hidden presets
 * while deriving genreId from a live one.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

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

function fakeSocket(userId: number, isAdmin: boolean) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noopEmit = () => {}

const admin = () => fakeSocket(1, true)
const user = () => fakeSocket(2, false)

let n = 0
async function makePreset(
	over: Partial<typeof schema.sessionPresets.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionPresets)
		.values({
			name: `Preset ${n++}`,
			genreId: "core:genre/chat",
			...over
		})
		.returning()
	return row
}

describe("admin gating", () => {
	test("every mutating handler refuses non-admins", async () => {
		const {
			sessionGenresList,
			sessionGenresUpdate,
			sessionPresetsCreate,
			sessionPresetsUpdate,
			sessionPresetsDelete,
			sessionsAdminList
		} = await import("./sessionAdmin")
		for (const h of [
			sessionGenresList,
			sessionGenresUpdate,
			sessionPresetsCreate,
			sessionPresetsUpdate,
			sessionPresetsDelete,
			sessionsAdminList
		]) {
			await expect(
				h.handler(user(), {} as any, noopEmit)
			).rejects.toThrow(/Unauthorized/)
		}
	}, 60_000)
})

describe("presets list — the picker's cut", () => {
	test("non-admin sees only enabled presets of enabled types; admin sees all", async () => {
		const { sessionPresetsList } = await import("./sessionAdmin")
		const live = await makePreset({ name: "Live" })
		const hidden = await makePreset({ name: "Hidden", enabled: false })
		const offType = await makePreset({
			name: "Off-type",
			genreId: "core:genre/disabled-type"
		})
		await testDb.insert(schema.sessionGenreSettings).values({
			genreId: "core:genre/disabled-type",
			enabled: false
		})

		const forUser = await sessionPresetsList.handler(user(), {}, noopEmit)
		const userIds = forUser.presets.map((p) => p.id)
		expect(userIds).toContain(live.id)
		expect(userIds).not.toContain(hidden.id)
		expect(userIds).not.toContain(offType.id)

		const forAdmin = await sessionPresetsList.handler(admin(), {}, noopEmit)
		const adminIds = forAdmin.presets.map((p) => p.id)
		for (const id of [live.id, hidden.id, offType.id])
			expect(adminIds).toContain(id)
	}, 60_000)

	// The create flow's step 3 pre-fills from `defaults` (schema 23 §9:
	// "Optional pre-fill for creation"). The blob is stored, so it has to
	// reach the picker — a column nothing puts on the wire cannot pre-fill
	// anything.
	test("the picker's cut carries each preset's creation pre-fill", async () => {
		const { sessionPresetsList } = await import("./sessionAdmin")
		const prefilled = await makePreset({
			name: "Pre-filled",
			defaults: {
				name: "A quiet evening",
				scenario: "The lamps are lit"
			}
		})
		const bare = await makePreset({ name: "No pre-fill" })

		const res = await sessionPresetsList.handler(user(), {}, noopEmit)
		expect(res.presets.find((p) => p.id === prefilled.id)!.defaults).toEqual(
			{ name: "A quiet evening", scenario: "The lamps are lit" }
		)
		expect(res.presets.find((p) => p.id === bare.id)!.defaults).toBeNull()
	}, 60_000)
})

describe("preset mutations", () => {
	test("create copies selections from fromPresetId", async () => {
		const { sessionPresetsCreate } = await import("./sessionAdmin")
		const source = await makePreset({
			primarySlug: "core:spec/chat-respond",
			configSelections: { "core:spec/chat-respond": 7 },
			includedActions: ["core:spec/chat-narrate"]
		})
		const res = await sessionPresetsCreate.handler(
			admin(),
			{
				name: "Copied",
				genreId: "core:genre/chat",
				fromPresetId: source.id
			},
			noopEmit
		)
		expect(res.preset?.primarySlug).toBe("core:spec/chat-respond")
		expect(res.preset?.configSelections).toEqual({
			"core:spec/chat-respond": 7
		})
		expect(res.preset?.includedActions).toEqual(["core:spec/chat-narrate"])
	}, 60_000)

	test("immutable presets accept availability flags only and refuse delete", async () => {
		const { sessionPresetsUpdate, sessionPresetsDelete } = await import(
			"./sessionAdmin"
		)
		const builtin = await makePreset({
			name: "Built-in",
			isImmutable: true,
			seedKey: `test-builtin-${n}`
		})
		const upd = await sessionPresetsUpdate.handler(
			admin(),
			{ id: builtin.id, name: "Renamed", enabled: false },
			noopEmit
		)
		expect(upd.preset?.name).toBe("Built-in") // content refused
		expect(upd.preset?.enabled).toBe(false) // availability accepted

		const del = await sessionPresetsDelete.handler(
			admin(),
			{ id: builtin.id },
			noopEmit
		)
		expect(del.ok).toBe(false)
		expect(del.error).toMatch(/duplicate/i)
	}, 60_000)

	test("one default per type: setting a default clears the previous", async () => {
		const { sessionPresetsUpdate } = await import("./sessionAdmin")
		const slug = "core:genre/one-default-test"
		const a = await makePreset({ genreId: slug, isDefault: true })
		const b = await makePreset({ genreId: slug })
		await sessionPresetsUpdate.handler(
			admin(),
			{ id: b.id, isDefault: true },
			noopEmit
		)
		const rows = await testDb
			.select()
			.from(schema.sessionPresets)
			.then((r: any[]) => r.filter((p) => p.genreId === slug))
		expect(rows.find((p: any) => p.id === a.id)?.isDefault).toBe(false)
		expect(rows.find((p: any) => p.id === b.id)?.isDefault).toBe(true)
	}, 60_000)
})

describe("type settings upsert", () => {
	test("update inserts on first touch, patches on the second", async () => {
		const { sessionGenresUpdate } = await import("./sessionAdmin")
		const slug = "core:genre/settings-upsert-test"
		await sessionGenresUpdate.handler(
			admin(),
			{ slug, enabled: false },
			noopEmit
		)
		let rows = (await testDb
			.select()
			.from(schema.sessionGenreSettings)) as any[]
		let row = rows.find((s) => s.genreId === slug)
		expect(row?.enabled).toBe(false)

		await sessionGenresUpdate.handler(
			admin(),
			{ slug, enabled: true },
			noopEmit
		)
		rows = (await testDb
			.select()
			.from(schema.sessionGenreSettings)) as any[]
		expect(rows.filter((s) => s.genreId === slug)).toHaveLength(1)
		row = rows.find((s) => s.genreId === slug)
		expect(row?.enabled).toBe(true)
	}, 60_000)
})

describe("sessions:create with a preset", () => {
	test("refuses disabled presets and hidden types; derives genreId from a live preset", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, "preset-creator")
		const { sessionsCreateHandler } = await import("./sessions")
		const sock = fakeSocket(owner.id, false)

		// A refusal is answered, never thrown: the sentence rides the ack
		// and the handler's own error push, so the start screen can show it
		// (the catch-all replaces a thrown message with a constant).
		const pushes: Array<{ event: string; data: any }> = []
		const emit = (event: string, data: unknown) => pushes.push({ event, data })

		const disabled = await makePreset({ enabled: false })
		const refusedPreset = await sessionsCreateHandler.handler(
			sock,
			{
				session: { name: "x", presetId: disabled.id } as any,
				characterIds: [],
				personaIds: [],
				characterPositions: {}
			},
			emit
		)
		expect(refusedPreset.error).toMatch(/preset is not available/)
		expect(refusedPreset.session).toBeUndefined()
		expect(pushes.pop()).toMatchObject({
			event: "sessions:create:error",
			data: { error: expect.stringMatching(/preset is not available/) }
		})

		const hiddenTypeSlug = "core:genre/hidden-type"
		const hiddenType = await makePreset({ genreId: hiddenTypeSlug })
		await testDb
			.insert(schema.sessionGenreSettings)
			.values({ genreId: hiddenTypeSlug, enabled: false })
			.onConflictDoNothing()
		const refusedType = await sessionsCreateHandler.handler(
			sock,
			{
				session: { name: "x", presetId: hiddenType.id } as any,
				characterIds: [],
				personaIds: [],
				characterPositions: {}
			},
			emit
		)
		expect(refusedType.error).toMatch(/type is not available/)
		expect(pushes.pop()).toMatchObject({
			event: "sessions:create:error",
			data: { error: expect.stringMatching(/type is not available/) }
		})

		// A live preset of the standard type: the server derives genreId from
		// the preset's genreId and records the presetId on the row.
		const live = await makePreset({ name: "Live create" })
		const res = await sessionsCreateHandler.handler(
			sock,
			{
				session: {
					name: "Born from preset",
					presetId: live.id,
					// A wrong client-supplied genreId must lose to the preset's.
					genreId: "core:spec/whatever"
				} as any,
				characterIds: [],
				personaIds: [],
				characterPositions: {}
			},
			noopEmit
		)
		expect(res.session!.genreId).toBe("core:genre/chat")
		expect((res.session as any).presetId).toBe(live.id)
	}, 60_000)

	// Withdrawn beside disabled (0119). `enabled` stays true — an
	// administrator's approval survives a withdrawal — so a check that reads
	// only that flag lets a preset whose plugin is gone start new sessions,
	// while the picker that offered it has already dropped it.
	test("refuses a withdrawn preset, in the same sentence", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, "preset-withdrawn-creator")
		const { sessionsCreateHandler } = await import("./sessions")
		const sock = fakeSocket(owner.id, false)

		const withdrawn = await makePreset({
			name: "Withdrawn create",
			withdrawnAt: new Date()
		})
		expect(withdrawn.enabled).toBe(true)
		const pushes: Array<{ event: string; data: any }> = []
		const res = await sessionsCreateHandler.handler(
			sock,
			{
				session: { name: "x", presetId: withdrawn.id } as any,
				characterIds: [],
				personaIds: [],
				characterPositions: {}
			},
			(event: string, data: unknown) => pushes.push({ event, data })
		)
		expect(res.error).toMatch(/preset is not available/)
		expect(pushes).toEqual([
			{
				event: "sessions:create:error",
				data: { error: expect.stringMatching(/preset is not available/) }
			}
		])
	}, 60_000)
})

describe("the genre hub's writes (B4, R66)", () => {
	const GENRE = "test:genre/hub"

	test("both refuse non-admins", async () => {
		const { sessionGenresSetPresetsEnabled, sessionGenresSetSwapEnabled } =
			await import("./sessionAdmin")
		for (const h of [sessionGenresSetPresetsEnabled, sessionGenresSetSwapEnabled])
			await expect(h.handler(user(), {} as any, noopEmit)).rejects.toThrow(/Unauthorized/)
	})

	test("disable all switches every live preset of the genre, and only that genre", async () => {
		const { sessionGenresSetPresetsEnabled } = await import("./sessionAdmin")
		const { eq } = await import("drizzle-orm")
		const a = await makePreset({ genreId: GENRE, enabled: true })
		const b = await makePreset({ genreId: GENRE, enabled: true })
		const gone = await makePreset({ genreId: GENRE, enabled: true, withdrawnAt: new Date() })
		const other = await makePreset({ genreId: "core:genre/chat", enabled: true })
		const res = await sessionGenresSetPresetsEnabled.handler(
			admin(),
			{ genreId: GENRE, enabled: false },
			noopEmit
		)
		expect(res).toMatchObject({ changed: 2, refused: [] })
		const enabledOf = async (id: number) =>
			(
				await testDb
					.select({ enabled: schema.sessionPresets.enabled })
					.from(schema.sessionPresets)
					.where(eq(schema.sessionPresets.id, id))
			)[0].enabled
		expect(await enabledOf(a.id)).toBe(false)
		expect(await enabledOf(b.id)).toBe(false)
		expect(await enabledOf(gone.id)).toBe(true)
		expect(await enabledOf(other.id)).toBe(true)
	})

	test("a swap switch writes disabled_swaps, and refuses a swap the plugin does not declare", async () => {
		const { sessionGenresSetSwapEnabled } = await import("./sessionAdmin")
		const { eq } = await import("drizzle-orm")
		const pluginId = "acme.swaps-hub"
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: "Swaps",
			version: "1.0.0",
			bundleSource: "// none",
			bundleHash: "hub-swaps",
			enabled: true,
			manifest: {
				swaps: [
					{
						spec: "core:spec/chat-turn-order",
						node: "strategy",
						definition: "acme.swaps-hub:task/dice@1"
					}
				]
			} as any
		})
		const swap = {
			pluginId,
			spec: "core:spec/chat-turn-order",
			node: "strategy",
			definition: "acme.swaps-hub:task/dice@1"
		}
		const off = await sessionGenresSetSwapEnabled.handler(
			admin(),
			{ ...swap, enabled: false },
			noopEmit
		)
		expect(off.ok).toBe(true)
		const read = async () =>
			(
				await testDb
					.select({ d: schema.plugins.disabledSwaps })
					.from(schema.plugins)
					.where(eq(schema.plugins.pluginId, pluginId))
			)[0].d
		expect(await read()).toEqual([
			"core:spec/chat-turn-order#strategy#acme.swaps-hub:task/dice@1"
		])
		await sessionGenresSetSwapEnabled.handler(admin(), { ...swap, enabled: true }, noopEmit)
		expect(await read()).toEqual([])
		const bogus = await sessionGenresSetSwapEnabled.handler(
			admin(),
			{ ...swap, definition: "acme.swaps-hub:task/other@1", enabled: false },
			noopEmit
		)
		expect(bogus.ok).toBe(false)
		expect(await read()).toEqual([])
	})
})
