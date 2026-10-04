/**
 * The copy model (brief 3 of `PLAN-layout-one-format-2026-09-28`; owner L2,
 * L3 and the 2026-09-29 answers LA, LB, LC).
 *
 * A session's layout is its OWN row, per person (LA): the first open copies a
 * starting point in, `startFrom` re-copies one (a named layout, the genre
 * default layout, or `null` for scratch), and nothing is ever layered over a
 * preset at read time. Copying a layout in lets ITS widget settings and style
 * pins win for every widget instance it names while the session keeps the
 * others (LB). Start from scratch is the minimal working setup: an empty
 * arrangement, which the page draws as the conversation plus the genre's
 * declared panels, every widget at its defaults — this session's widget
 * settings and style pins are cleared (LC). "Save as new layout" packs the placed instances'
 * settings and pins into the new row and records it as where the session's
 * layout started from. The provenance is only ever a label: `startedFromUpdated`
 * says the source's layout moved after the copy.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"
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

const ADVENTURE = "core:genre/adventure"

function fakeSocket(userId: number) {
	return { user: { id: userId }, io: { to: () => ({ emit: () => {} }) } } as any
}
const noopEmit = () => {}
const handlers = () => import("./sessions")

let n = 0

async function scenario(genreId = ADVENTURE) {
	const k = n++
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `lc-owner-${k}`)
	const guest = await createTestUser(testDb, `lc-guest-${k}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, genreId })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id, isPlayer: true })
	return { owner, guest, session }
}

/** Seed a core genre's layouts exactly as boot does; the genre default row. */
async function seed(genreId = ADVENTURE) {
	const { syncLayoutPresets } = await import("$lib/server/db/layoutPresets")
	await syncLayoutPresets([genreId])
	const [row] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.seedKey, layoutPresetSeedKey(genreId)))
	return row
}

/** The arrangement half of a layout blob: what a session row holds. */
function arrangementOf(layout: Record<string, unknown>) {
	const out: Record<string, unknown> = {}
	for (const k of ["zoneLayout", "widgetGrid", "arrangedGrid"])
		if (layout[k] !== undefined) out[k] = layout[k]
	return out
}

async function get(userId: number, sessionId: number) {
	const { sessionsPanelLayoutGetHandler } = await handlers()
	return sessionsPanelLayoutGetHandler.handler(
		fakeSocket(userId),
		{ sessionId } as any,
		noopEmit
	)
}

async function startFrom(
	userId: number,
	sessionId: number,
	layoutPresetId: number | null
) {
	const { sessionsPanelLayoutStartFromHandler } = await handlers()
	return sessionsPanelLayoutStartFromHandler.handler(
		fakeSocket(userId),
		{ sessionId, layoutPresetId } as any,
		noopEmit
	)
}

async function set(userId: number, sessionId: number, params: Record<string, unknown>) {
	const { sessionsPanelLayoutSetHandler } = await handlers()
	return sessionsPanelLayoutSetHandler.handler(
		fakeSocket(userId),
		{ sessionId, ...params } as any,
		noopEmit
	)
}

/** A person's own named layout, saved straight to the table's module. */
async function namedLayout(
	userId: number,
	name: string,
	layout: Record<string, unknown>,
	genreId = ADVENTURE
) {
	const { saveUserLayoutPreset } = await import("$lib/server/db/layoutPresets")
	return saveUserLayoutPreset({ genreId, userId, name, layout })
}

const panelRows = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionPanelLayouts)
		.where(eq(schema.sessionPanelLayouts.sessionId, sessionId))

const rowOf = async (sessionId: number, userId: number) => {
	const [row] = await testDb
		.select()
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.sessionId, sessionId),
				eq(schema.sessionPanelLayouts.userId, userId)
			)
		)
	return row
}

/** A two-column arrangement that differs from Adventure's in every slot. */
const TWO_COLUMNS = {
	zoneLayout: {
		version: 1,
		zones: {
			left: { kind: "side", side: "left", pinned: true, widgets: ["stats"] },
			right: { kind: "side", side: "right", pinned: true, widgets: ["lore-entries"] }
		}
	},
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
	},
	arrangedGrid: {
		left: { cols: 1, rows: 12, items: [{ id: "stats", x: 0, y: 0, w: 1, h: 12 }] }
	}
}

describe("the first open copies a starting point into the person's own row", () => {
	test(
		"with no new-session layout, the genre default layout is copied — arrangement, settings and provenance",
		async () => {
			const def = await seed()
			const s = await scenario()
			const res = await get(s.owner.id, s.session.id)
			const shipped = def.layout as Record<string, any>
			// The whole arrangement is the session's own now; no base rides beside it.
			expect(res.layout).toEqual(arrangementOf(shipped))
			expect("presetLayout" in res).toBe(false)
			expect("layoutPresetId" in res).toBe(false)
			// The layout's widget settings became this person's own values.
			expect(res.widgetSettings).toEqual(shipped.widgetSettings)
			expect(res.startedFromLayoutPresetId).toBe(def.id)
			expect(typeof res.layoutCopiedAt).toBe("string")
			expect(res.startedFromUpdated).toBe(false)

			const row = await rowOf(s.session.id, s.owner.id)
			expect(row.layout).toEqual(arrangementOf(shipped))
			expect(row.startedFromLayoutPresetId).toBe(def.id)
			expect(row.layoutCopiedAt).toBeInstanceOf(Date)
			// A second open reads the row; it copies nothing again.
			const again = await get(s.owner.id, s.session.id)
			expect(again.layoutCopiedAt).toBe(res.layoutCopiedAt)
		},
		60_000
	)

	test(
		"a person's new-session layout is what their first open copies",
		async () => {
			await seed()
			const s = await scenario()
			const mine = await namedLayout(s.owner.id, "Two columns", {
				...TWO_COLUMNS,
				widgetSettings: { stats: { density: "compact" } }
			})
			const { setUserLayoutDefault } = await import(
				"$lib/server/db/userLayoutDefaults"
			)
			await setUserLayoutDefault({
				userId: s.owner.id,
				genreId: ADVENTURE,
				presetId: mine.id
			})
			const res = await get(s.owner.id, s.session.id)
			expect(res.layout).toEqual(TWO_COLUMNS)
			expect(res.widgetSettings).toEqual({ stats: { density: "compact" } })
			expect(res.startedFromLayoutPresetId).toBe(mine.id)
			// It is the owner's alone: the guest still starts from the genre default.
			const guest = await get(s.guest.id, s.session.id)
			expect(guest.startedFromLayoutPresetId).not.toBe(mine.id)
		},
		60_000
	)

	test(
		"a new-session layout that has gone falls back to the genre default layout",
		async () => {
			const def = await seed()
			const s = await scenario()
			const mine = await namedLayout(s.owner.id, "Doomed default", TWO_COLUMNS)
			const { setUserLayoutDefault } = await import(
				"$lib/server/db/userLayoutDefaults"
			)
			await setUserLayoutDefault({
				userId: s.owner.id,
				genreId: ADVENTURE,
				presetId: mine.id
			})
			await testDb
				.delete(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.id, mine.id))
			const res = await get(s.owner.id, s.session.id)
			expect(res.startedFromLayoutPresetId).toBe(def.id)
			expect(res.layout).toEqual(arrangementOf(def.layout as Record<string, unknown>))
		},
		60_000
	)

	test(
		"two first opens at once make exactly one row",
		async () => {
			await seed()
			const s = await scenario()
			const [a, b] = await Promise.all([
				get(s.owner.id, s.session.id),
				get(s.owner.id, s.session.id)
			])
			expect(a.layout).toEqual(b.layout)
			expect(a.startedFromLayoutPresetId).toBe(b.startedFromLayoutPresetId)
			const rows = (await panelRows(s.session.id)).filter(
				(r) => r.userId === s.owner.id
			)
			expect(rows).toHaveLength(1)
		},
		60_000
	)

	test(
		"a stranger's open copies nothing and writes no row",
		async () => {
			await seed()
			const s = await scenario()
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const stranger = await createTestUser(testDb, `lc-stranger-${n++}`)
			const res = await get(stranger.id, s.session.id)
			expect(res.layout).toEqual({})
			expect(res.presets).toEqual([])
			expect(await rowOf(s.session.id, stranger.id)).toBeUndefined()
		},
		60_000
	)

	test(
		"a first open in a genre with no genre default layout copies an empty layout and clears nothing",
		async () => {
			// A plugin genre that declares no layout: nothing to copy, so the
			// first open writes `{}` with no provenance. It is not Start from
			// scratch: values the person already holds for the session stay.
			const s = await scenario("someplugin:genre/no-layouts")
			await testDb.insert(schema.widgetSettings).values({
				sessionId: s.session.id,
				userId: s.owner.id,
				widgetSlug: "messages",
				values: { composer: "minimal" }
			})
			const res = await get(s.owner.id, s.session.id)
			expect(res.layout).toEqual({})
			expect(res.startedFromLayoutPresetId).toBeNull()
			expect(res.widgetSettings).toEqual({ messages: { composer: "minimal" } })
		},
		60_000
	)
})

describe("rows are per person per session (LA)", () => {
	test(
		"each participant gets their own copy, and one's start-from never moves the other's",
		async () => {
			const def = await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			await get(s.guest.id, s.session.id)
			expect(await panelRows(s.session.id)).toHaveLength(2)

			const scratch = await startFrom(s.owner.id, s.session.id, null)
			expect(scratch.ok).toBe(true)
			const guest = await get(s.guest.id, s.session.id)
			expect(guest.layout).toEqual(arrangementOf(def.layout as Record<string, unknown>))
			expect(guest.startedFromLayoutPresetId).toBe(def.id)
			const owner = await get(s.owner.id, s.session.id)
			expect(owner.layout).toEqual({})
		},
		60_000
	)
})

describe("sessions:panelLayout:startFrom", () => {
	test(
		"LB: the incoming layout's settings and pins win for each instance it names; the session keeps the rest",
		async () => {
			await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			// This session's own values: two widgets set, two pins.
			await set(s.owner.id, s.session.id, {
				layout: TWO_COLUMNS,
				widgetSettings: {
					"scene-portraits": { bars: false, source: "pinned" },
					stats: { density: "compact" }
				},
				layoutSettings: {
					widgetStyles: {
						messages: { id: 7, slug: "mine" },
						stats: { id: 8, slug: "old" }
					}
				}
			})
			const incoming = await namedLayout(s.owner.id, "Incoming", {
				...TWO_COLUMNS,
				widgetSettings: { "scene-portraits": { source: "scene" } },
				widgetStyles: { stats: { slug: "ledger" } }
			})
			const res = await startFrom(s.owner.id, s.session.id, incoming.id)
			expect(res.ok).toBe(true)
			// Replaced WHOLE for the instance it names — `bars: false` does not survive.
			expect(res.widgetSettings["scene-portraits"]).toEqual({ source: "scene" })
			// …and kept for the instance it does not name.
			expect(res.widgetSettings.stats).toEqual({ density: "compact" })
			expect(res.layoutSettings.widgetStyles).toEqual({
				messages: { id: 7, slug: "mine" },
				stats: { slug: "ledger" }
			})
			expect(res.layout).toEqual(TWO_COLUMNS)
			expect(res.startedFromLayoutPresetId).toBe(incoming.id)
		},
		60_000
	)

	test(
		"Reset to genre default layout re-copies it, clearing this session's activations and sizes",
		async () => {
			const def = await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			await set(s.owner.id, s.session.id, {
				layout: {
					...TWO_COLUMNS,
					active: [{ id: "lore-entries", on: true }],
					tierSizeOverrides: { wide: [2, 1] }
				}
			})
			const res = await startFrom(s.owner.id, s.session.id, def.id)
			expect(res.ok).toBe(true)
			expect(res.layout).toEqual(arrangementOf(def.layout as Record<string, unknown>))
			expect(res.startedFromLayoutPresetId).toBe(def.id)
		},
		60_000
	)

	test(
		"Start from scratch (LC): an empty arrangement, no provenance, and every widget back at its defaults",
		async () => {
			await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			await get(s.guest.id, s.session.id)
			await set(s.owner.id, s.session.id, {
				layout: TWO_COLUMNS,
				widgetSettings: {
					// Drawn by the floor (the conversation, a genre panel)…
					messages: { composer: "minimal" },
					"scene-portraits": { bars: false },
					// …and not drawn by it at all.
					stats: { density: "compact" }
				},
				layoutSettings: {
					widgetStyles: {
						messages: { id: 2, slug: "quiet" },
						stats: { id: 3, slug: "ledger" }
					},
					// A key that is not a style pin rides through untouched.
					other: { kept: true }
				}
			})
			await set(s.guest.id, s.session.id, {
				layout: TWO_COLUMNS,
				widgetSettings: { stats: { density: "roomy" } },
				layoutSettings: { widgetStyles: { stats: { id: 9, slug: "guest" } } }
			})
			const [elsewhere] = await testDb
				.insert(schema.sessions)
				.values({ userId: s.owner.id, isGroup: false, genreId: ADVENTURE })
				.returning()
			await get(s.owner.id, elsewhere.id)
			await set(s.owner.id, elsewhere.id, {
				layout: TWO_COLUMNS,
				widgetSettings: { stats: { density: "compact" } }
			})
			const before = await rowOf(s.session.id, s.owner.id)
			const res = await startFrom(s.owner.id, s.session.id, null)
			expect(res.ok).toBe(true)
			// The page draws `{}` as the floor: the conversation in the middle and
			// the genre's declared panels — at THEIR DEFAULTS (owner LC), so this
			// session's widget settings and style pins go, every one of them.
			expect(res.layout).toEqual({})
			expect(res.startedFromLayoutPresetId).toBeNull()
			expect(res.startedFromUpdated).toBe(false)
			expect(res.widgetSettings).toEqual({})
			expect(res.layoutSettings).toEqual({ other: { kept: true } })
			const rows = await testDb
				.select()
				.from(schema.widgetSettings)
				.where(
					and(
						eq(schema.widgetSettings.sessionId, s.session.id),
						eq(schema.widgetSettings.userId, s.owner.id)
					)
				)
			expect(rows).toEqual([])
			const after = await rowOf(s.session.id, s.owner.id)
			expect(after.startedFromLayoutPresetId).toBeNull()
			expect(after.layoutCopiedAt!.getTime()).toBeGreaterThanOrEqual(
				before.layoutCopiedAt!.getTime()
			)
			// Per person and per session: the guest's and the owner's other
			// session's values are theirs, and untouched.
			const guest = await get(s.guest.id, s.session.id)
			expect(guest.widgetSettings.stats).toEqual({ density: "roomy" })
			expect(guest.layoutSettings.widgetStyles).toEqual({
				stats: { id: 9, slug: "guest" }
			})
			const other = await get(s.owner.id, elsewhere.id)
			expect(other.widgetSettings.stats).toEqual({ density: "compact" })
		},
		60_000
	)

	test(
		"a shared layout may be started from; a withdrawn, another genre's or a stranger's private one is refused and nothing moves",
		async () => {
			await seed()
			await seed("core:genre/chat")
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			const before = await rowOf(s.session.id, s.owner.id)
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const stranger = await createTestUser(testDb, `lc-author-${n++}`)
			const secret = await namedLayout(stranger.id, "Secret", TWO_COLUMNS)
			const published = await namedLayout(stranger.id, "Published", TWO_COLUMNS)
			const { shareLayoutPreset } = await import("$lib/server/db/layoutPresets")
			await shareLayoutPreset({
				presetId: published.id,
				userId: stranger.id,
				visibility: "shared"
			})
			const [foreign] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(
					eq(
						schema.sessionLayoutPresets.seedKey,
						layoutPresetSeedKey("core:genre/chat")
					)
				)
			const [withdrawn] = await testDb
				.insert(schema.sessionLayoutPresets)
				.values({
					seedKey: `layout:${ADVENTURE}:gone.plugin/wide`,
					genreId: ADVENTURE,
					origin: "plugin",
					pluginId: "gone.plugin",
					withdrawnAt: new Date(),
					slug: "wide",
					name: "Wide",
					visibility: "shared",
					layout: TWO_COLUMNS
				})
				.returning()
			for (const id of [secret.id, foreign.id, withdrawn.id, 999_999]) {
				const res = await startFrom(s.owner.id, s.session.id, id)
				expect(res.ok).toBe(false)
				expect(res.error).toBe("That layout isn't available.")
			}
			const unmoved = await rowOf(s.session.id, s.owner.id)
			expect(unmoved.layout).toEqual(before.layout)
			expect(unmoved.startedFromLayoutPresetId).toBe(
				before.startedFromLayoutPresetId
			)

			const ok = await startFrom(s.owner.id, s.session.id, published.id)
			expect(ok.ok).toBe(true)
			expect(ok.startedFromLayoutPresetId).toBe(published.id)
			expect(ok.layout).toEqual(TWO_COLUMNS)
		},
		60_000
	)

	test(
		"a stranger to the session cannot start it from anything",
		async () => {
			await seed()
			const s = await scenario()
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const stranger = await createTestUser(testDb, `lc-outsider-${n++}`)
			const res = await startFrom(stranger.id, s.session.id, null)
			expect(res.ok).toBe(false)
			expect(await rowOf(s.session.id, stranger.id)).toBeUndefined()
		},
		60_000
	)
})

describe("sessions:panelLayout:set under the copy model", () => {
	test(
		"no longer accepts a preset id: provenance is written only by a copy or Save as new",
		async () => {
			const def = await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			const other = await namedLayout(s.owner.id, "Other", TWO_COLUMNS)
			const res = await set(s.owner.id, s.session.id, {
				layout: TWO_COLUMNS,
				layoutPresetId: other.id
			})
			expect(res.ok).toBe(true)
			const row = await rowOf(s.session.id, s.owner.id)
			expect(row.layout).toEqual(TWO_COLUMNS)
			expect(row.startedFromLayoutPresetId).toBe(def.id)
		},
		60_000
	)

	test(
		"a set that inserts (no open first) stamps the copy time with no provenance",
		async () => {
			await seed()
			const s = await scenario()
			await set(s.owner.id, s.session.id, { layout: TWO_COLUMNS })
			const row = await rowOf(s.session.id, s.owner.id)
			expect(row.startedFromLayoutPresetId).toBeNull()
			expect(row.layoutCopiedAt).toBeInstanceOf(Date)
		},
		60_000
	)
})

describe("Save as new layout", () => {
	test(
		"packs the PLACED instances' settings and pins, and the session now started from it",
		async () => {
			await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			await set(s.owner.id, s.session.id, {
				layout: TWO_COLUMNS,
				widgetSettings: {
					stats: { density: "compact" },
					// A removed copy's leftovers: never placed, never packed.
					"world-state#2": { title: "Old copy" }
				},
				layoutSettings: {
					widgetStyles: {
						messages: { id: 4, slug: "quiet" },
						"stats#3": { id: 5, slug: "leftover" }
					}
				}
			})
			const { sessionsLayoutPresetSaveHandler } = await handlers()
			const saved = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Packed",
					description: "stats on the left",
					layout: TWO_COLUMNS,
					// What the page draws; the leftover copies are not among it.
					drawnWidgetIds: ["stats", "lore-entries", "messages"]
				} as any,
				noopEmit
			)
			expect(saved.ok).toBe(true)
			const preset = saved.preset!
			expect(preset.mine).toBe(true)
			expect(preset.isGenreDefault).toBe(false)
			expect(preset.origin).toBe("user")
			expect(preset.description).toBe("stats on the left")
			expect(preset.layout).toEqual({
				...TWO_COLUMNS,
				widgetSettings: { stats: { density: "compact" } },
				widgetStyles: { messages: { id: 4, slug: "quiet" } }
			})
			// The session's layout now started from the row it just wrote.
			expect(saved.startedFromLayoutPresetId).toBe(preset.id)
			expect(typeof saved.layoutCopiedAt).toBe("string")
			const row = await rowOf(s.session.id, s.owner.id)
			expect(row.startedFromLayoutPresetId).toBe(preset.id)
			const got = await get(s.owner.id, s.session.id)
			expect(got.startedFromLayoutPresetId).toBe(preset.id)
			expect(got.startedFromUpdated).toBe(false)

			// Offered to every session of the genre, and copied — not referenced —
			// when another session starts from it.
			const other = await scenario()
			await get(other.owner.id, other.session.id)
			const theirs = await startFrom(other.owner.id, other.session.id, preset.id)
			// A different person cannot see a private row…
			expect(theirs.ok).toBe(false)
			const [second] = await testDb
				.insert(schema.sessions)
				.values({ userId: s.owner.id, isGroup: false, genreId: ADVENTURE })
				.returning()
			await get(s.owner.id, second.id)
			const copied = await startFrom(s.owner.id, second.id, preset.id)
			// …the author's other session can, and gets its own copy.
			expect(copied.ok).toBe(true)
			expect(copied.layout).toEqual(TWO_COLUMNS)
			expect(copied.widgetSettings.stats).toEqual({ density: "compact" })
			expect(copied.layoutSettings.widgetStyles).toMatchObject({
				messages: { id: 4, slug: "quiet" }
			})
		},
		60_000
	)
})

/**
 * More than one of a widget (brief 7b, and its review's missing case): a
 * PLACED copy — `stats#2`, and a second Messages on a channel — carries its
 * own id, settings and style pin through Save as new and a Start from in
 * another session, verbatim (plan M.3.3: an instance id is data, never
 * renamed). A copy removed earlier (`stats#3`) is not packed.
 */
describe("Save as new layout — placed copies of a widget", () => {
	const COPIES = {
		zoneLayout: {
			version: 1,
			zones: {
				left: { kind: "side", side: "left", pinned: true, widgets: ["stats", "stats#2"] },
				right: { kind: "side", side: "right", pinned: true, widgets: ["messages#2"] }
			}
		},
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

	test(
		"a placed `#n` copy's settings and pin survive Save as new and Start from, under the same ids",
		async () => {
			await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			await set(s.owner.id, s.session.id, {
				layout: COPIES,
				widgetSettings: {
					stats: { title: "Party" },
					"stats#2": { title: "Foes", compact: true },
					"messages#2": { channel: "sanctum", composer: "minimal" },
					// A copy removed before the save: never placed, never packed.
					"stats#3": { title: "Gone" }
				},
				layoutSettings: {
					widgetStyles: {
						"stats#2": { id: 9, slug: "ledger" },
						"messages#2": { id: 4, slug: "quiet" }
					}
				}
			})
			const { sessionsLayoutPresetSaveHandler } = await handlers()
			const saved = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Two parties",
					layout: COPIES,
					drawnWidgetIds: ["messages", "stats", "stats#2", "messages#2"]
				} as any,
				noopEmit
			)
			expect(saved.ok).toBe(true)
			expect(saved.preset!.layout).toEqual({
				...COPIES,
				widgetSettings: {
					stats: { title: "Party" },
					"stats#2": { title: "Foes", compact: true },
					"messages#2": { channel: "sanctum", composer: "minimal" }
				},
				widgetStyles: {
					"stats#2": { id: 9, slug: "ledger" },
					"messages#2": { id: 4, slug: "quiet" }
				}
			})

			// The author's other session starts from it: the same ids, each
			// with its own values.
			const [second] = await testDb
				.insert(schema.sessions)
				.values({ userId: s.owner.id, isGroup: false, genreId: ADVENTURE })
				.returning()
			await get(s.owner.id, second.id)
			const copied = await startFrom(s.owner.id, second.id, saved.preset!.id)
			expect(copied.ok).toBe(true)
			expect(copied.layout).toEqual(COPIES)
			expect(copied.widgetSettings).toMatchObject({
				stats: { title: "Party" },
				"stats#2": { title: "Foes", compact: true },
				"messages#2": { channel: "sanctum", composer: "minimal" }
			})
			expect(copied.widgetSettings["stats#3"]).toBeUndefined()
			expect(copied.layoutSettings.widgetStyles).toMatchObject({
				"stats#2": { id: 9, slug: "ledger" },
				"messages#2": { id: 4, slug: "quiet" }
			})
			// …and it is stored so: a fresh read of that session agrees.
			const again = await get(s.owner.id, second.id)
			expect(again.layout).toEqual(COPIES)
			expect(again.widgetSettings["stats#2"]).toEqual({ title: "Foes", compact: true })
		},
		60_000
	)
})

describe("Save as new layout — what the page draws beyond the arrangement", () => {
	async function saveAs(
		userId: number,
		sessionId: number,
		layout: Record<string, unknown>,
		drawnWidgetIds: unknown
	) {
		const { sessionsLayoutPresetSaveHandler } = await handlers()
		return sessionsLayoutPresetSaveHandler.handler(
			fakeSocket(userId),
			{ sessionId, name: `Drawn ${n++}`, layout, drawnWidgetIds } as any,
			noopEmit
		)
	}

	test(
		"after Start from scratch, the floor's panels travel with their settings and pins",
		async () => {
			await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			await startFrom(s.owner.id, s.session.id, null)
			await set(s.owner.id, s.session.id, {
				layout: {},
				widgetSettings: {
					"scene-portraits": { source: "scene", bars: false },
					messages: { lineWidth: "comfortable" }
				},
				layoutSettings: {
					widgetStyles: { "scene-portraits": { id: 9, slug: "framed" } }
				}
			})
			// An empty layout: the page draws the conversation and Adventure's
			// default panels, none of which the arrangement names.
			const saved = await saveAs(s.owner.id, s.session.id, {}, [
				"messages",
				"scene-portraits",
				"stats"
			])
			expect(saved.ok).toBe(true)
			expect(saved.preset!.layout).toEqual({
				widgetSettings: {
					"scene-portraits": { source: "scene", bars: false },
					messages: { lineWidth: "comfortable" }
				},
				widgetStyles: { "scene-portraits": { id: 9, slug: "framed" } }
			})
		},
		60_000
	)

	test(
		"packs only what the page draws: a conversation it does not draw stays behind (a genre that omits it)",
		async () => {
			await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			await set(s.owner.id, s.session.id, {
				layout: {},
				widgetSettings: {
					messages: { lineWidth: "comfortable" },
					stats: { density: "compact" }
				}
			})
			// The page draws no conversation here (as for a genre that omits
			// it), so its settings stay behind even though the layout is empty.
			const saved = await saveAs(s.owner.id, s.session.id, {}, ["stats"])
			expect(saved.preset!.layout).toEqual({
				widgetSettings: { stats: { density: "compact" } }
			})
		},
		60_000
	)

	test(
		"drops an id that is not a widget instance id, and a missing list packs the arrangement's own",
		async () => {
			await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			await set(s.owner.id, s.session.id, {
				layout: TWO_COLUMNS,
				widgetSettings: {
					stats: { density: "compact" },
					"world-state": { title: "Kept home" }
				}
			})
			const odd = await saveAs(s.owner.id, s.session.id, TWO_COLUMNS, [
				"world state!",
				42,
				null
			])
			expect(odd.preset!.layout.widgetSettings).toEqual({
				stats: { density: "compact" }
			})
			const none = await saveAs(s.owner.id, s.session.id, TWO_COLUMNS, undefined)
			expect(none.ok).toBe(true)
			expect(none.preset!.layout.widgetSettings).toEqual({
				stats: { density: "compact" }
			})
		},
		60_000
	)
})

describe("the Updated flag", () => {
	test(
		"is set when the source's layout moved after the copy, and a re-copy clears it",
		async () => {
			const def = await seed()
			const s = await scenario()
			const first = await get(s.owner.id, s.session.id)
			expect(first.startedFromUpdated).toBe(false)
			const listed = first.presets.find((p) => p.id === def.id)!
			expect(listed.isGenreDefault).toBe(true)
			expect(typeof listed.layoutUpdatedAt).toBe("string")

			const row = await rowOf(s.session.id, s.owner.id)
			await testDb
				.update(schema.sessionLayoutPresets)
				.set({ layoutUpdatedAt: new Date(row.layoutCopiedAt!.getTime() + 60_000) })
				.where(eq(schema.sessionLayoutPresets.id, def.id))
			const later = await get(s.owner.id, s.session.id)
			expect(later.startedFromUpdated).toBe(true)
			// Nothing moved: the flag is a label, never a redraw.
			expect(later.layout).toEqual(first.layout)

			// Stamp the copy after the source's change, as a re-copy does.
			await testDb
				.update(schema.sessionPanelLayouts)
				.set({ layoutCopiedAt: new Date(row.layoutCopiedAt!.getTime() + 120_000) })
				.where(eq(schema.sessionPanelLayouts.id, row.id))
			const recopied = await get(s.owner.id, s.session.id)
			expect(recopied.startedFromUpdated).toBe(false)
		},
		60_000
	)
})

describe("the list a session is offered", () => {
	test(
		"orders the genre default layout, core's others, plugins, yours, then shared with you — with every field the editor reads",
		async () => {
			await seed()
			const s = await scenario()
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const author = await createTestUser(testDb, `lc-sharer-${n++}`)
			await testDb
				.update(schema.users)
				.set({ displayName: "Sharer" })
				.where(eq(schema.users.id, author.id))
			const shared = await namedLayout(author.id, "From a friend", TWO_COLUMNS)
			const { shareLayoutPreset } = await import("$lib/server/db/layoutPresets")
			await shareLayoutPreset({
				presetId: shared.id,
				userId: author.id,
				visibility: "shared"
			})
			const mine = await namedLayout(s.owner.id, "Mine", TWO_COLUMNS)
			const { setUserLayoutDefault } = await import(
				"$lib/server/db/userLayoutDefaults"
			)
			await setUserLayoutDefault({
				userId: s.owner.id,
				genreId: ADVENTURE,
				presetId: mine.id
			})
			const res = await get(s.owner.id, s.session.id)
			const kinds = res.presets.map((p) =>
				p.isGenreDefault
					? "genre-default"
					: p.origin === "user"
						? p.mine
							? "yours"
							: "shared"
						: p.origin
			)
			const firstYours = kinds.indexOf("yours")
			const firstShared = kinds.indexOf("shared")
			expect(kinds[0]).toBe("genre-default")
			expect(firstYours).toBeGreaterThan(0)
			expect(firstShared).toBeGreaterThan(firstYours)
			const own = res.presets.find((p) => p.id === mine.id)!
			expect(own.isNewSessionLayout).toBe(true)
			expect(own.visibility).toBe("private")
			const theirs = res.presets.find((p) => p.id === shared.id)!
			expect(theirs.mine).toBe(false)
			expect(theirs.authorName).toBe("Sharer")
			expect(theirs.isNewSessionLayout).toBe(false)
			const def = res.presets[0]
			expect(def.origin).toBe("core")
			expect(def.slug).toBe("default")
			expect(def.pluginId).toBeNull()
			expect(def.pluginName).toBeNull()
			expect(def.mine).toBe(false)
		},
		60_000
	)
})

describe("a plugin genre's own layout", () => {
	const PLUGIN_ID = "acme/copyboard"
	const PLUGIN_GENRE = "acme.copyboard:genre/board"
	const BOARD_LAYOUT = {
		widgetGrid: {
			version: 1,
			cell: 44,
			widgets: [
				{
					id: "acme.copyboard:board",
					zone: "middle",
					order: 0,
					size: { w: "grow", h: "grow" },
					anchor: { top: true, bottom: true, left: true, right: true }
				}
			]
		}
	}

	test(
		"is what a session of that genre copies on first open",
		async () => {
			await testDb.insert(schema.plugins).values({
				pluginId: PLUGIN_ID,
				name: "Copy Board",
				version: "1.0.0",
				bundleSource: "// none",
				bundleHash: "hash-copyboard",
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
			const { syncPluginLayouts } = await import("$lib/server/db/pluginLayouts")
			await syncPluginLayouts(testDb as never)
			const s = await scenario(PLUGIN_GENRE)
			const res = await get(s.owner.id, s.session.id)
			expect(res.layout).toEqual(BOARD_LAYOUT)
			const listed = res.presets.find((p) => p.id === res.startedFromLayoutPresetId)!
			expect(listed.isGenreDefault).toBe(true)
			expect(listed.origin).toBe("plugin")
			expect(listed.pluginId).toBe(PLUGIN_ID)
			expect(listed.pluginName).toBe("Copy Board")
		},
		60_000
	)
})
