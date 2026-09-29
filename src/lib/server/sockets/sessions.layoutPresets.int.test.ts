/**
 * The preset half of the per-user layout row (PLAN 25 redesign, 2026-08-30).
 *
 * Proven here: a seeded genre default is listed and resolved; a user preset
 * saves, lists, and re-applies; an absent key on `set` leaves its column alone
 * (the property that stops the surface manager's debounced blob save from
 * clobbering a preset choice); another user's preset can neither be listed nor
 * pinned; and — the one that guards everyone's existing layouts — the `layout`
 * blob a session already has is returned untouched by all of it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { layoutPresetSeedKey } from "$lib/shared/sessionLayout/presets"
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

afterAll(() => {})

const GENRE = "core:genre/chat"

function fakeSocket(userId: number) {
	return { user: { id: userId }, io: { to: () => ({ emit: () => {} }) } } as any
}
const noopEmit = () => {}

let n = 0

async function scenario() {
	const k = n++
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `lp-owner-${k}`)
	const guest = await createTestUser(testDb, `lp-guest-${k}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, genreId: GENRE })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id, isPlayer: true })
	return { owner, guest, session }
}

/** Seed the genre default exactly as boot does. */
async function seedDefault() {
	const { syncLayoutPresets } = await import("$lib/server/db/layoutPresets")
	await syncLayoutPresets([{ genreId: GENRE }])
	const [row] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(
			eq(schema.sessionLayoutPresets.seedKey, layoutPresetSeedKey(GENRE))
		)
	return row
}

const handlers = () => import("./sessions")

describe("sessions:panelLayout — presets", () => {
	test(
		"the seeded genre default is listed and is what an unpinned session resolves to",
		async () => {
			const def = await seedDefault()
			const { sessionsPanelLayoutGetHandler } = await handlers()
			const s = await scenario()
			const res = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(res.presets.map((p) => p.id)).toContain(def.id)
			const listed = res.presets.find((p) => p.id === def.id)!
			expect(listed.isDefault).toBe(true)
			expect(listed.name).toBe("Default")
			expect(res.layoutPresetId).toBeNull()
			// The shipped default is "no overrides" — so an untouched session
			// resolves to an empty base and renders exactly as it always did.
			expect(res.presetLayout).toEqual({})
			expect(res.layout).toEqual({})
			expect(res.layoutSettings).toEqual({})
		},
		60_000
	)

	test(
		"a user preset saves, is listed to its author, and re-applies",
		async () => {
			await seedDefault()
			const {
				sessionsLayoutPresetSaveHandler,
				sessionsPanelLayoutSetHandler,
				sessionsPanelLayoutGetHandler
			} = await handlers()
			const s = await scenario()
			const mine = { zoneLayout: { version: 1, zones: {} }, mine: true }

			const saved = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "  My Layout  ",
					layout: mine
				} as any,
				noopEmit
			)
			expect(saved.ok).toBe(true)
			expect(saved.preset!.name).toBe("My Layout")
			expect(saved.preset!.isDefault).toBe(false)
			expect(saved.presets.map((p) => p.id)).toContain(saved.preset!.id)

			// It is a DEFINITION — saving does not switch you onto it.
			const beforeApply = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(beforeApply.layoutPresetId).toBeNull()

			// Applying is a separate write, and then it resolves.
			const set = await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					layout: {},
					layoutPresetId: saved.preset!.id
				} as any,
				noopEmit
			)
			expect(set.ok).toBe(true)
			const got = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(got.layoutPresetId).toBe(saved.preset!.id)
			expect(got.presetLayout).toEqual(mine)
		},
		60_000
	)

	test(
		"a save row is author-owned and seed-key-less — outside the reconciler's reach forever",
		async () => {
			await seedDefault()
			const { sessionsLayoutPresetSaveHandler } = await handlers()
			const s = await scenario()
			const saved = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Reseed survivor",
					layout: { survivor: true }
				} as any,
				noopEmit
			)
			const [row] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(
					eq(schema.sessionLayoutPresets.id, saved.preset!.id)
				)
			expect(row.authorUserId).toBe(s.owner.id)
			expect(row.seedKey).toBeNull()

			// …and it survives a reseed byte for byte.
			const { syncLayoutPresets } = await import(
				"$lib/server/db/layoutPresets"
			)
			await syncLayoutPresets([{ genreId: GENRE }])
			const [after] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, saved.preset!.id))
			expect(after).toEqual(row)
		},
		60_000
	)

	test(
		"a blob-only set leaves layoutPresetId and layoutSettings alone",
		async () => {
			await seedDefault()
			const {
				sessionsLayoutPresetSaveHandler,
				sessionsPanelLayoutSetHandler,
				sessionsPanelLayoutGetHandler
			} = await handlers()
			const s = await scenario()
			const saved = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Sticky",
					layout: { sticky: true }
				} as any,
				noopEmit
			)
			await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					layout: {},
					layoutPresetId: saved.preset!.id,
					layoutSettings: { "scene-portraits": { bg: "x" } }
				} as any,
				noopEmit
			)
			// Exactly the shape the surface manager's debounced save posts.
			await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					layout: { active: [], tierSizeOverrides: {} }
				} as any,
				noopEmit
			)
			const got = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(got.layoutPresetId).toBe(saved.preset!.id)
			expect(got.layoutSettings).toEqual({
				"scene-portraits": { bg: "x" }
			})
			expect(got.layout).toEqual({ active: [], tierSizeOverrides: {} })
		},
		60_000
	)

	test(
		"an explicit null clears the selection back to the genre default",
		async () => {
			const def = await seedDefault()
			const {
				sessionsLayoutPresetSaveHandler,
				sessionsPanelLayoutSetHandler,
				sessionsPanelLayoutGetHandler
			} = await handlers()
			const s = await scenario()
			const saved = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Temp",
					layout: { temp: true }
				} as any,
				noopEmit
			)
			await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					layout: {},
					layoutPresetId: saved.preset!.id
				} as any,
				noopEmit
			)
			await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					layout: {},
					layoutPresetId: null
				} as any,
				noopEmit
			)
			const got = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(got.layoutPresetId).toBeNull()
			expect(got.presetLayout).toEqual(def.layout)
		},
		60_000
	)

	test(
		"another user's preset is neither listed nor pinnable",
		async () => {
			await seedDefault()
			const {
				sessionsLayoutPresetSaveHandler,
				sessionsPanelLayoutSetHandler,
				sessionsPanelLayoutGetHandler
			} = await handlers()
			const s = await scenario()
			const saved = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Owner only",
					layout: { secret: true }
				} as any,
				noopEmit
			)
			// The guest shares the session but not the preset.
			const guestGot = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.guest.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(guestGot.presets.map((p) => p.id)).not.toContain(
				saved.preset!.id
			)
			const set = await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.guest.id),
				{
					sessionId: s.session.id,
					layout: {},
					layoutPresetId: saved.preset!.id
				} as any,
				noopEmit
			)
			expect(set.ok).toBe(false)
			expect(set.error).toBe("Unknown layout preset")
			// And nothing was stored — not even the blob.
			const guestAfter = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.guest.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(guestAfter.layoutPresetId).toBeNull()
		},
		60_000
	)

	test(
		"a preset from another genre is refused",
		async () => {
			await seedDefault()
			const { syncLayoutPresets } = await import(
				"$lib/server/db/layoutPresets"
			)
			await syncLayoutPresets([{ genreId: "other:genre/thing" }])
			const [foreign] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(
					eq(
						schema.sessionLayoutPresets.seedKey,
						layoutPresetSeedKey("other:genre/thing")
					)
				)
			const { sessionsPanelLayoutSetHandler } = await handlers()
			const s = await scenario()
			const set = await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					layout: {},
					layoutPresetId: foreign.id
				} as any,
				noopEmit
			)
			expect(set.ok).toBe(false)
			expect(set.error).toBe("Unknown layout preset")
		},
		60_000
	)

	test(
		"a stranger can neither read presets nor save one",
		async () => {
			await seedDefault()
			const {
				sessionsLayoutPresetSaveHandler,
				sessionsPanelLayoutGetHandler
			} = await handlers()
			const s = await scenario()
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const stranger = await createTestUser(testDb, `lp-stranger-${n++}`)
			const got = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(stranger.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(got.presets).toEqual([])
			expect(got.presetLayout).toEqual({})
			const saved = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(stranger.id),
				{
					sessionId: s.session.id,
					name: "Nope",
					layout: {}
				} as any,
				noopEmit
			)
			expect(saved.ok).toBe(false)
			expect(saved.preset).toBeUndefined()
		},
		60_000
	)

	test(
		"a nameless save is refused",
		async () => {
			await seedDefault()
			const { sessionsLayoutPresetSaveHandler } = await handlers()
			const s = await scenario()
			for (const name of ["", "   ", undefined]) {
				const res = await sessionsLayoutPresetSaveHandler.handler(
					fakeSocket(s.owner.id),
					{ sessionId: s.session.id, name, layout: {} } as any,
					noopEmit
				)
				expect(res.ok).toBe(false)
				expect(res.error).toBe("A preset needs a name")
			}
		},
		60_000
	)

	test(
		"an existing session's layout blob is returned untouched by all of this",
		async () => {
			await seedDefault()
			const {
				sessionsPanelLayoutSetHandler,
				sessionsPanelLayoutGetHandler
			} = await handlers()
			const s = await scenario()
			// A layout saved before presets existed — the exact blob shape the
			// surface manager writes today.
			const legacy = {
				active: [
					{
						id: "scene-portraits",
						order: 0,
						collapsed: false,
						drawered: false,
						on: true
					}
				],
				tierSizeOverrides: { wide: [2, 1] },
				zoneLayout: { version: 1, zones: { right: { kind: "side" } } },
				arrangedGrid: { right: { cols: 4, rows: 8, items: [] } }
			}
			await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id, layout: legacy } as any,
				noopEmit
			)
			const got = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(got.layout).toEqual(legacy)
			// Nothing from the preset layer leaked into it.
			expect(got.presetLayout).toEqual({})
			expect(got.layoutPresetId).toBeNull()
		},
		60_000
	)
})

/**
 * Managing the presets you saved (the rename/delete half of the Presets tab).
 *
 * The two properties worth proving are ownership and consequence: a preset is
 * managed by its AUTHOR only — admins deliberately included in "not the author"
 * — and a foreign id is refused with the very sentence a missing id gets, so
 * the id space cannot be walked to learn what other people have saved. Deleting
 * is allowed to strand nothing: the FK's `ON DELETE SET NULL` drops every
 * session that was on it back to the genre default, which is why the response
 * counts them first.
 */
describe("sessions:layoutPreset — rename, delete, usage", () => {
	/** Save a preset as `userId` in `sessionId`, returning the wire row. */
	async function savePreset(
		sessionId: number,
		userId: number,
		name: string,
		layout: Record<string, unknown> = { saved: true }
	) {
		const { sessionsLayoutPresetSaveHandler } = await handlers()
		const res = await sessionsLayoutPresetSaveHandler.handler(
			fakeSocket(userId),
			{ sessionId, name, layout } as any,
			noopEmit
		)
		return res.preset!
	}

	test(
		"an author renames their own preset, and the response carries the refreshed list",
		async () => {
			await seedDefault()
			const { sessionsLayoutPresetRenameHandler } = await handlers()
			const s = await scenario()
			const mine = await savePreset(s.session.id, s.owner.id, "Before")

			const res = await sessionsLayoutPresetRenameHandler.handler(
				fakeSocket(s.owner.id),
				{ id: mine.id, name: "  After  " } as any,
				noopEmit
			)
			expect(res.ok).toBe(true)
			expect(res.error).toBeUndefined()
			expect(res.preset!.name).toBe("After")
			expect(res.preset!.id).toBe(mine.id)
			// The list rides the response, exactly as `save` already does it —
			// the tab never re-fetches to see its own edit.
			expect(res.presets.find((p) => p.id === mine.id)!.name).toBe(
				"After"
			)
			const [row] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, mine.id))
			expect(row.name).toBe("After")
			// Renaming is a name change and nothing else.
			expect(row.layout).toEqual({ saved: true })
			expect(row.authorUserId).toBe(s.owner.id)
			expect(row.seedKey).toBeNull()
		},
		60_000
	)

	test(
		"renaming someone else's preset is refused with the sentence a missing id gets",
		async () => {
			await seedDefault()
			const { sessionsLayoutPresetRenameHandler } = await handlers()
			const s = await scenario()
			const theirs = await savePreset(
				s.session.id,
				s.owner.id,
				"Owner's"
			)

			// The guest shares the session — that is access to the SESSION, not
			// to another person's saved layouts.
			const foreign = await sessionsLayoutPresetRenameHandler.handler(
				fakeSocket(s.guest.id),
				{ id: theirs.id, name: "Mine now" } as any,
				noopEmit
			)
			const missing = await sessionsLayoutPresetRenameHandler.handler(
				fakeSocket(s.guest.id),
				{ id: 987654321, name: "Mine now" } as any,
				noopEmit
			)
			expect(foreign.ok).toBe(false)
			expect(missing.ok).toBe(false)
			// Identical, deliberately: "yours doesn't exist" and "that one is
			// somebody else's" must be indistinguishable.
			expect(foreign.error).toBe("Unknown layout preset")
			expect(missing.error).toBe(foreign.error)
			expect(foreign.preset).toBeUndefined()
			expect(foreign.presets).toEqual([])

			const [row] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, theirs.id))
			expect(row.name).toBe("Owner's")
		},
		60_000
	)

	test(
		"a built-in preset cannot be renamed",
		async () => {
			const def = await seedDefault()
			const { sessionsLayoutPresetRenameHandler } = await handlers()
			const s = await scenario()
			const res = await sessionsLayoutPresetRenameHandler.handler(
				fakeSocket(s.owner.id),
				{ id: def.id, name: "My Default" } as any,
				noopEmit
			)
			expect(res.ok).toBe(false)
			expect(res.error).toBe(
				"Built-in layouts can't be renamed — save a copy instead."
			)
			const [row] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, def.id))
			expect(row.name).toBe("Default")
			expect(row.seedKey).toBe(layoutPresetSeedKey(GENRE))
		},
		60_000
	)

	test(
		"a nameless rename is refused",
		async () => {
			await seedDefault()
			const { sessionsLayoutPresetRenameHandler } = await handlers()
			const s = await scenario()
			const mine = await savePreset(s.session.id, s.owner.id, "Keep me")
			for (const name of ["", "   ", undefined]) {
				const res = await sessionsLayoutPresetRenameHandler.handler(
					fakeSocket(s.owner.id),
					{ id: mine.id, name } as any,
					noopEmit
				)
				expect(res.ok).toBe(false)
				expect(res.error).toBe("A preset needs a name")
			}
			const [row] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, mine.id))
			expect(row.name).toBe("Keep me")
		},
		60_000
	)

	test(
		"deleting your own preset removes the row and drops the sessions on it back to the default",
		async () => {
			await seedDefault()
			const {
				sessionsLayoutPresetDeleteHandler,
				sessionsPanelLayoutSetHandler,
				sessionsPanelLayoutGetHandler
			} = await handlers()
			const s = await scenario()
			const mine = await savePreset(s.session.id, s.owner.id, "Doomed", {
				doomed: true
			})
			await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					layout: {},
					layoutPresetId: mine.id
				} as any,
				noopEmit
			)

			const res = await sessionsLayoutPresetDeleteHandler.handler(
				fakeSocket(s.owner.id),
				{ id: mine.id } as any,
				noopEmit
			)
			expect(res.ok).toBe(true)
			expect(res.id).toBe(mine.id)
			// Counted BEFORE the delete — after it, the FK has already nulled
			// the evidence.
			expect(res.affectedSessions).toBe(1)
			expect(res.presets.map((p) => p.id)).not.toContain(mine.id)

			const rows = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, mine.id))
			expect(rows).toEqual([])

			// The session that was on it is intact and back on the genre
			// default — `ON DELETE SET NULL` doing exactly what it promises.
			const [layoutRow] = await testDb
				.select()
				.from(schema.sessionPanelLayouts)
				.where(
					eq(schema.sessionPanelLayouts.sessionId, s.session.id)
				)
			expect(layoutRow.startedFromLayoutPresetId).toBeNull()
			const got = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(got.layoutPresetId).toBeNull()
			expect(got.presetLayout).toEqual({})
		},
		60_000
	)

	test(
		"deleting someone else's preset is refused, and it survives",
		async () => {
			await seedDefault()
			const { sessionsLayoutPresetDeleteHandler } = await handlers()
			const s = await scenario()
			const theirs = await savePreset(s.session.id, s.owner.id, "Safe")
			const res = await sessionsLayoutPresetDeleteHandler.handler(
				fakeSocket(s.guest.id),
				{ id: theirs.id } as any,
				noopEmit
			)
			expect(res.ok).toBe(false)
			expect(res.error).toBe("Unknown layout preset")
			expect(res.affectedSessions).toBe(0)
			const rows = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, theirs.id))
			expect(rows.length).toBe(1)
		},
		60_000
	)

	test(
		"a built-in preset cannot be deleted",
		async () => {
			const def = await seedDefault()
			const { sessionsLayoutPresetDeleteHandler } = await handlers()
			const s = await scenario()
			const res = await sessionsLayoutPresetDeleteHandler.handler(
				fakeSocket(s.owner.id),
				{ id: def.id } as any,
				noopEmit
			)
			expect(res.ok).toBe(false)
			expect(res.error).toBe("Built-in layouts can't be deleted.")
			const rows = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, def.id))
			expect(rows.length).toBe(1)
		},
		60_000
	)

	test(
		"usage counts the sessions on a preset, and is the author's to ask",
		async () => {
			await seedDefault()
			const {
				sessionsLayoutPresetUsageHandler,
				sessionsPanelLayoutSetHandler
			} = await handlers()
			const s = await scenario()
			const mine = await savePreset(s.session.id, s.owner.id, "Counted")

			// Nobody on it yet.
			const before = await sessionsLayoutPresetUsageHandler.handler(
				fakeSocket(s.owner.id),
				{ id: mine.id } as any,
				noopEmit
			)
			expect(before.ok).toBe(true)
			expect(before.sessions).toBe(0)

			// A second session of the same genre, same owner, on the same
			// preset: the count is sessions, not saves.
			const [second] = await testDb
				.insert(schema.sessions)
				.values({
					userId: s.owner.id,
					isGroup: true,
					genreId: GENRE
				})
				.returning()
			for (const sessionId of [s.session.id, second.id]) {
				await sessionsPanelLayoutSetHandler.handler(
					fakeSocket(s.owner.id),
					{
						sessionId,
						layout: {},
						layoutPresetId: mine.id
					} as any,
					noopEmit
				)
			}
			const after = await sessionsLayoutPresetUsageHandler.handler(
				fakeSocket(s.owner.id),
				{ id: mine.id } as any,
				noopEmit
			)
			expect(after.ok).toBe(true)
			expect(after.sessions).toBe(2)

			// And it is not a peephole into someone else's shelf.
			const guestAsk = await sessionsLayoutPresetUsageHandler.handler(
				fakeSocket(s.guest.id),
				{ id: mine.id } as any,
				noopEmit
			)
			expect(guestAsk.ok).toBe(false)
			expect(guestAsk.error).toBe("Unknown layout preset")
			expect(guestAsk.sessions).toBe(0)
		},
		60_000
	)
})
