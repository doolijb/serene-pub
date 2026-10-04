/**
 * The session layout presets a session is offered, and the verbs a person
 * manages their own with (PLAN 25 redesign; the copy model of
 * `PLAN-layout-one-format-2026-09-28` brief 3).
 *
 * Proven here: the seeded genre default is listed as the genre default layout
 * and is what a first open copies; Save as new is listed to its author and is
 * what the session now started from; a blob-only set leaves the provenance and
 * the style pins alone (the property that stops the surface manager's
 * debounced save from clobbering them); another user's private preset can be
 * neither listed nor started from; and a layout a session already has is
 * returned untouched. The copy semantics themselves live in
 * `sessions.layoutCopy.int.test.ts`.
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

/**
 * A core genre whose genre default layout is the empty floor: the Guide.
 * (Chat's places the Author's note since 2026-10-03; these tests are about
 * the preset verbs, not what a genre ships.)
 */
const GENRE = "core:genre/guide"

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
	await syncLayoutPresets([GENRE])
	const [row] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(
			eq(schema.sessionLayoutPresets.seedKey, layoutPresetSeedKey(GENRE))
		)
	return row
}

const handlers = () => import("./sessions")

/**
 * An arrangement, as the editor sends one to Save as new — its grid read
 * through `loadChatLayout`, so every entry carries an anchor (a save is now
 * checked with `validateSessionLayout`, which requires one).
 */
const ARRANGED = {
	widgetGrid: {
		version: 1,
		cell: 44,
		widgets: [
			{
				id: "messages",
				zone: "middle",
				order: 0,
				size: { w: "grow", h: "grow" },
				anchor: { top: true, bottom: true, left: true, right: true }
			}
		]
	}
}

describe("sessions:panelLayout — presets", () => {
	test(
		"the seeded genre default is listed as the genre default layout, and the first open copies it",
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
			expect(listed.isGenreDefault).toBe(true)
			expect(listed.mine).toBe(false)
			expect(listed.name).toBe("Default")
			expect(res.startedFromLayoutPresetId).toBe(def.id)
			// The Guide's genre default is empty: the copy draws the floor, exactly
			// as an untouched session always did.
			expect(res.layout).toEqual({})
			expect(res.layoutSettings).toEqual({})
		},
		60_000
	)

	test(
		"Save as new is listed to its author and is what the session now started from",
		async () => {
			await seedDefault()
			const { sessionsLayoutPresetSaveHandler, sessionsPanelLayoutGetHandler } =
				await handlers()
			const s = await scenario()
			const saved = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "  My Layout  ",
					layout: ARRANGED
				} as any,
				noopEmit
			)
			expect(saved.ok).toBe(true)
			expect(saved.preset!.name).toBe("My Layout")
			expect(saved.preset!.mine).toBe(true)
			expect(saved.preset!.isGenreDefault).toBe(false)
			expect(saved.presets.map((p) => p.id)).toContain(saved.preset!.id)
			expect(saved.startedFromLayoutPresetId).toBe(saved.preset!.id)

			const got = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(got.startedFromLayoutPresetId).toBe(saved.preset!.id)
			expect(saved.preset!.layout).toEqual(ARRANGED)
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
					layout: ARRANGED
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
			await syncLayoutPresets([GENRE])
			const [after] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, saved.preset!.id))
			expect(after).toEqual(row)
		},
		60_000
	)

	test(
		"a blob-only set leaves the provenance and layoutSettings alone",
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
					layout: ARRANGED
				} as any,
				noopEmit
			)
			await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					layout: ARRANGED,
					layoutSettings: { widgetStyles: { messages: { id: 1, slug: "x" } } }
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
			expect(got.startedFromLayoutPresetId).toBe(saved.preset!.id)
			expect(got.layoutSettings).toEqual({
				widgetStyles: { messages: { id: 1, slug: "x" } }
			})
			expect(got.layout).toEqual({ active: [], tierSizeOverrides: {} })
		},
		60_000
	)

	test(
		"another user's private preset is neither listed nor startable",
		async () => {
			const def = await seedDefault()
			const {
				sessionsLayoutPresetSaveHandler,
				sessionsPanelLayoutStartFromHandler,
				sessionsPanelLayoutGetHandler
			} = await handlers()
			const s = await scenario()
			const saved = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Owner only",
					layout: ARRANGED
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
			const res = await sessionsPanelLayoutStartFromHandler.handler(
				fakeSocket(s.guest.id),
				{ sessionId: s.session.id, layoutPresetId: saved.preset!.id } as any,
				noopEmit
			)
			expect(res.ok).toBe(false)
			expect(res.error).toBe("That layout isn't available.")
			// And nothing moved: the guest is still on their first-open copy.
			expect(res.startedFromLayoutPresetId).toBe(def.id)
			expect(res.layout).toEqual({})
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
			await syncLayoutPresets(["core:genre/other-thing"])
			const [foreign] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(
					eq(
						schema.sessionLayoutPresets.seedKey,
						layoutPresetSeedKey("core:genre/other-thing")
					)
				)
			const { sessionsPanelLayoutStartFromHandler } = await handlers()
			const s = await scenario()
			const res = await sessionsPanelLayoutStartFromHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id, layoutPresetId: foreign.id } as any,
				noopEmit
			)
			expect(res.ok).toBe(false)
			expect(res.error).toBe("That layout isn't available.")
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
			expect(got.layout).toEqual({})
			expect(got.startedFromLayoutPresetId).toBeNull()
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
				expect(res.error).toBe("A layout needs a name.")
			}
		},
		60_000
	)

	test(
		"a layout a session already has is returned untouched — the first-open copy never runs over it",
		async () => {
			await seedDefault()
			const {
				sessionsPanelLayoutSetHandler,
				sessionsPanelLayoutGetHandler
			} = await handlers()
			const s = await scenario()
			// The exact blob shape the surface manager writes.
			const arranged = {
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
				{ sessionId: s.session.id, layout: arranged } as any,
				noopEmit
			)
			const got = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(got.layout).toEqual(arranged)
			expect(got.startedFromLayoutPresetId).toBeNull()
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
		layout: Record<string, unknown> = ARRANGED
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
			expect(row.layout).toEqual(ARRANGED)
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
			expect(foreign.error).toBe("That layout isn't available.")
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
				expect(res.error).toBe("A layout needs a name.")
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
		"deleting your own preset removes the row; a session that started from it keeps its layout",
		async () => {
			await seedDefault()
			const {
				sessionsLayoutPresetDeleteHandler,
				sessionsPanelLayoutGetHandler
			} = await handlers()
			const s = await scenario()
			// Save as new: the session now started from it.
			const mine = await savePreset(s.session.id, s.owner.id, "Doomed")
			const before = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(before.startedFromLayoutPresetId).toBe(mine.id)

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

			// The session's layout is its own copy: only the label went.
			const got = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(got.startedFromLayoutPresetId).toBeNull()
			expect(got.layout).toEqual(before.layout)
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
			expect(res.error).toBe("That layout isn't available.")
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
		"usage counts the sessions that started from a preset and the people using it for new sessions, and is the author's to ask",
		async () => {
			await seedDefault()
			const {
				sessionsLayoutPresetUsageHandler,
				sessionsPanelLayoutStartFromHandler
			} = await handlers()
			const s = await scenario()
			// Written straight to the table, so no session started from it yet.
			const { saveUserLayoutPreset } = await import(
				"$lib/server/db/layoutPresets"
			)
			const mine = await saveUserLayoutPreset({
				genreId: GENRE,
				userId: s.owner.id,
				name: "Counted",
				layout: ARRANGED
			})

			// Nobody on it yet.
			const before = await sessionsLayoutPresetUsageHandler.handler(
				fakeSocket(s.owner.id),
				{ id: mine.id } as any,
				noopEmit
			)
			expect(before.ok).toBe(true)
			expect(before.sessions).toBe(0)
			expect(before.newSessionLayoutUsers).toBe(0)

			// A second session of the same genre, same owner, both started
			// from it: the count is sessions, not saves.
			const [second] = await testDb
				.insert(schema.sessions)
				.values({
					userId: s.owner.id,
					isGroup: true,
					genreId: GENRE
				})
				.returning()
			for (const sessionId of [s.session.id, second.id]) {
				const res = await sessionsPanelLayoutStartFromHandler.handler(
					fakeSocket(s.owner.id),
					{ sessionId, layoutPresetId: mine.id } as any,
					noopEmit
				)
				expect(res.ok).toBe(true)
			}
			// …and one person uses it for their new sessions.
			const { setUserLayoutDefault } = await import(
				"$lib/server/db/userLayoutDefaults"
			)
			await setUserLayoutDefault({
				userId: s.owner.id,
				genreId: GENRE,
				presetId: mine.id
			})
			const after = await sessionsLayoutPresetUsageHandler.handler(
				fakeSocket(s.owner.id),
				{ id: mine.id } as any,
				noopEmit
			)
			expect(after.ok).toBe(true)
			expect(after.sessions).toBe(2)
			expect(after.newSessionLayoutUsers).toBe(1)

			// And it is not a peephole into someone else's shelf.
			const guestAsk = await sessionsLayoutPresetUsageHandler.handler(
				fakeSocket(s.guest.id),
				{ id: mine.id } as any,
				noopEmit
			)
			expect(guestAsk.ok).toBe(false)
			expect(guestAsk.error).toBe("That layout isn't available.")
			expect(guestAsk.sessions).toBe(0)
		},
		60_000
	)
})

describe("a plugin genre's own layout (layout plan brief 1)", () => {
	/**
	 * The gap brief 1 closes: a plugin that owns its genre and ships its
	 * `default` layout used to draw nothing of it — its row stored `{}`, and
	 * the genre-default lookup matched only core's key, under which core had
	 * seeded an empty row for every plugin genre. Now the row holds the
	 * session layout the manifest declares, core seeds nothing for the genre
	 * (and prunes what it once did), and the genre default layout is the
	 * owner's row — so a session starts from the plugin's layout.
	 */
	const PLUGIN_ID = "acme/board"
	const PLUGIN_GENRE = "acme.board:genre/board"
	const BOARD_LAYOUT = {
		widgetGrid: {
			version: 1,
			cell: 44,
			widgets: [
				{
					id: "acme.board:board",
					zone: "middle",
					order: 0,
					size: { w: "grow", h: "grow" },
					anchor: { top: true, bottom: true, left: true, right: true }
				}
			]
		},
		widgetSettings: { "acme.board:board": { zoom: "fit" } }
	}

	test(
		"is what a session of that genre starts from, not an empty core row",
		async () => {
			// What an older reconciler left behind: an empty `origin: core`
			// default under the genre's core key.
			await testDb.insert(schema.sessionLayoutPresets).values({
				seedKey: layoutPresetSeedKey(PLUGIN_GENRE),
				genreId: PLUGIN_GENRE,
				origin: "core",
				authorUserId: null,
				slug: "default",
				visibility: "shared",
				name: "Default",
				layout: {}
			})
			await testDb.insert(schema.plugins).values({
				pluginId: PLUGIN_ID,
				name: "Board",
				version: "1.0.0",
				bundleSource: "// none",
				bundleHash: "hash-board",
				enabled: true,
				manifest: {
					layouts: [
						{
							genreId: PLUGIN_GENRE,
							slug: "default",
							name: "Board",
							preset: BOARD_LAYOUT
						}
					]
				}
			})
			// Boot's two reconcilers, in boot's order.
			const { syncPluginLayouts } = await import("$lib/server/db/pluginLayouts")
			await syncPluginLayouts(testDb as never)
			const { syncLayoutPresets } = await import("$lib/server/db/layoutPresets")
			await syncLayoutPresets([GENRE, PLUGIN_GENRE])

			const { createTestUser } = await import("$lib/server/utils/testDb")
			const owner = await createTestUser(testDb, `lp-board-${n++}`)
			const [session] = await testDb
				.insert(schema.sessions)
				.values({ userId: owner.id, isGroup: false, genreId: PLUGIN_GENRE })
				.returning()
			const { sessionsPanelLayoutGetHandler } = await handlers()
			const res = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(owner.id),
				{ sessionId: session.id } as any,
				noopEmit
			)
			// Listed once, as the plugin's; core's empty row is gone.
			expect(res.presets.map((p) => [p.name, p.layout])).toEqual([
				["Board", BOARD_LAYOUT]
			])
			// …and it is what the first open copied: the arrangement into the
			// session's row, the rest into its own homes.
			expect(res.startedFromLayoutPresetId).toBe(res.presets[0].id)
			expect(res.presets[0].isGenreDefault).toBe(true)
			expect(res.layout).toEqual({ widgetGrid: BOARD_LAYOUT.widgetGrid })
			const coreRows = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.genreId, PLUGIN_GENRE))
			expect(coreRows.map((r) => r.origin)).toEqual(["plugin"])
		},
		60_000
	)
})
