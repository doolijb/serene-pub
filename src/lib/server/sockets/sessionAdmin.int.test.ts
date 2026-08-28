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
})

describe("preset mutations", () => {
	test("create copies selections from fromPresetId", async () => {
		const { sessionPresetsCreate } = await import("./sessionAdmin")
		const source = await makePreset({
			primarySlug: "core:spec/respond",
			configSelections: { "core:spec/respond": 7 },
			includedActions: ["core:spec/narrate"]
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
		expect(res.preset?.primarySlug).toBe("core:spec/respond")
		expect(res.preset?.configSelections).toEqual({
			"core:spec/respond": 7
		})
		expect(res.preset?.includedActions).toEqual(["core:spec/narrate"])
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
			{ slug, defaultPresetId: null, enabled: true },
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

		const disabled = await makePreset({ enabled: false })
		await expect(
			sessionsCreateHandler.handler(
				sock,
				{
					session: { name: "x", presetId: disabled.id } as any,
					characterIds: [],
					personaIds: [],
					characterPositions: {}
				},
				noopEmit
			)
		).rejects.toThrow(/preset is not available/)

		const hiddenTypeSlug = "core:genre/hidden-type"
		const hiddenType = await makePreset({ genreId: hiddenTypeSlug })
		await testDb
			.insert(schema.sessionGenreSettings)
			.values({ genreId: hiddenTypeSlug, enabled: false })
			.onConflictDoNothing()
		await expect(
			sessionsCreateHandler.handler(
				sock,
				{
					session: { name: "x", presetId: hiddenType.id } as any,
					characterIds: [],
					personaIds: [],
					characterPositions: {}
				},
				noopEmit
			)
		).rejects.toThrow(/type is not available/)

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
		expect(res.session.genreId).toBe("core:genre/chat")
		expect((res.session as any).presetId).toBe(live.id)
	}, 60_000)
})
