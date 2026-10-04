/**
 * The L4 verbs on a **session layout preset** (brief 6a of
 * `PLAN-layout-one-format-2026-09-28`): share, clone ("Make a copy"),
 * re-capture ("Save changes to *Name*", `:update`) and the person's
 * **new-session layout** (`:setNewSessionLayout`), all on the live
 * `sessions:layoutPreset:*` family.
 *
 * The permission matrix is `db/layoutPermissions.ts`: a shipped row is
 * nobody's to change; a shared row is its author's and an admin's; a private
 * one is its author's alone and is answered as absent to anyone else; a guest
 * may keep and change their own rows but never share one. A guest is a guest
 * ON A SESSION (there is no account-level guest role), so `:share` names the
 * session it is reached through and a guest there is refused.
 *
 * Every answer carries the refreshed list for the row's genre, so the editor's
 * pane re-renders from one message.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
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

const ADVENTURE = "core:genre/adventure"
const CHAT = "core:genre/chat"
// On screen it is a **layout**, never a "preset" (NOMENCLATURE §9): the
// page shows these sentences verbatim.
const UNKNOWN = "That layout isn't available."
const NO_ACCESS = "No access to this session"

function fakeSocket(userId: number, isAdmin = false) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noopEmit = () => {}
const handlers = () => import("./sessions")

let n = 0

async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `l4-${label}-${n++}`)
}

async function sessionOf(userId: number, genreId = ADVENTURE) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: true, genreId })
		.returning()
	return session
}

/** An owner's session with a guest in it. */
async function scenario(genreId = ADVENTURE) {
	const owner = await user("owner")
	const guest = await user("guest")
	const session = await sessionOf(owner.id, genreId)
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id, isPlayer: true })
	return { owner, guest, session }
}

/** Seed a core genre's layouts as boot does; the genre default layout row. */
async function seed(genreId = ADVENTURE) {
	const { syncLayoutPresets } = await import("$lib/server/db/layoutPresets")
	await syncLayoutPresets([genreId])
	const [row] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.seedKey, layoutPresetSeedKey(genreId)))
	return row
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

async function shareDirect(presetId: number, userId: number) {
	const { shareLayoutPreset } = await import("$lib/server/db/layoutPresets")
	return shareLayoutPreset({ presetId, userId, visibility: "shared" })
}

const presetRow = async (id: number) => {
	const [row] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.id, id))
	return row
}

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

async function get(userId: number, sessionId: number) {
	const { sessionsPanelLayoutGetHandler } = await handlers()
	return sessionsPanelLayoutGetHandler.handler(
		fakeSocket(userId),
		{ sessionId } as any,
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

async function startFrom(userId: number, sessionId: number, layoutPresetId: number | null) {
	const { sessionsPanelLayoutStartFromHandler } = await handlers()
	return sessionsPanelLayoutStartFromHandler.handler(
		fakeSocket(userId),
		{ sessionId, layoutPresetId } as any,
		noopEmit
	)
}

async function share(
	userId: number,
	sessionId: number | undefined,
	id: number,
	visibility: "shared" | "private",
	isAdmin = false
) {
	const { sessionsLayoutPresetShareHandler } = (await handlers()) as any
	return sessionsLayoutPresetShareHandler.handler(
		fakeSocket(userId, isAdmin),
		{ sessionId, id, visibility },
		noopEmit
	) as Promise<Sockets.Sessions.PanelLayout.Share.Response>
}

async function clone(userId: number, id: number, name?: string) {
	const { sessionsLayoutPresetCloneHandler } = (await handlers()) as any
	return sessionsLayoutPresetCloneHandler.handler(
		fakeSocket(userId),
		{ id, name },
		noopEmit
	) as Promise<Sockets.Sessions.PanelLayout.Clone.Response>
}

async function update(
	userId: number,
	sessionId: number,
	id: number,
	layout: Record<string, unknown>,
	drawnWidgetIds: string[] = [],
	isAdmin = false
) {
	const { sessionsLayoutPresetUpdateHandler } = (await handlers()) as any
	return sessionsLayoutPresetUpdateHandler.handler(
		fakeSocket(userId, isAdmin),
		{ sessionId, id, layout, drawnWidgetIds },
		noopEmit
	) as Promise<Sockets.Sessions.PanelLayout.Update.Response>
}

async function setNewSessionLayout(
	userId: number,
	genreId: string,
	layoutPresetId: number | null
) {
	const { sessionsLayoutPresetSetNewSessionLayoutHandler } = (await handlers()) as any
	return sessionsLayoutPresetSetNewSessionLayoutHandler.handler(
		fakeSocket(userId),
		{ genreId, layoutPresetId },
		noopEmit
	) as Promise<Sockets.Sessions.PanelLayout.SetNewSessionLayout.Response>
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
	}
}

/** The same, with the stats panel moved to the right. */
const STATS_RIGHT = {
	...TWO_COLUMNS,
	zoneLayout: {
		version: 1,
		zones: {
			right: {
				kind: "side",
				side: "right",
				pinned: true,
				widgets: ["stats", "lore-entries"]
			}
		}
	}
}

const LONG_AGO = new Date("2020-01-01T00:00:00.000Z")

// ── share ────────────────────────────────────────────────────────────────

describe("sessions:layoutPreset:share", () => {
	test(
		"the author shares their layout with everyone and takes it back; each answer lists the genre anew",
		async () => {
			await seed()
			const s = await scenario()
			const mine = await namedLayout(s.owner.id, "Wide table", TWO_COLUMNS)
			const other = await user("viewer")
			const theirs = await sessionOf(other.id)

			const shared = await share(s.owner.id, s.session.id, mine.id, "shared")
			expect(shared.ok).toBe(true)
			expect(shared.id).toBe(mine.id)
			expect(shared.genreId).toBe(ADVENTURE)
			expect(shared.preset!.visibility).toBe("shared")
			expect(shared.presets.find((p) => p.id === mine.id)!.visibility).toBe("shared")
			// Everyone on the server now sees it, under "shared with you".
			const seen = await get(other.id, theirs.id)
			const listed = seen.presets.find((p) => p.id === mine.id)!
			expect(listed.mine).toBe(false)
			expect(listed.visibility).toBe("shared")

			const back = await share(s.owner.id, s.session.id, mine.id, "private")
			expect(back.ok).toBe(true)
			expect(back.preset!.visibility).toBe("private")
			const unseen = await get(other.id, theirs.id)
			expect(unseen.presets.some((p) => p.id === mine.id)).toBe(false)
		},
		60_000
	)

	test(
		"a guest in the session may not share, not even their own layout",
		async () => {
			await seed()
			const s = await scenario()
			const own = await namedLayout(s.guest.id, "Guest's", TWO_COLUMNS)
			const res = await share(s.guest.id, s.session.id, own.id, "shared")
			expect(res.ok).toBe(false)
			expect(res.error).toBe(
				"You can use and save your own layouts, but not share one with the pub."
			)
			expect(res.presets).toEqual([])
			expect((await presetRow(own.id)).visibility).toBe("private")
		},
		60_000
	)

	test(
		"a stranger is answered as if a private layout did not exist; a shared one gets the owner-or-admin sentence",
		async () => {
			await seed()
			const s = await scenario()
			const secret = await namedLayout(s.owner.id, "Secret", TWO_COLUMNS)
			const open = await namedLayout(s.owner.id, "Open", TWO_COLUMNS)
			await shareDirect(open.id, s.owner.id)
			const stranger = await user("stranger")
			const theirs = await sessionOf(stranger.id)

			const hidden = await share(stranger.id, theirs.id, secret.id, "shared")
			expect(hidden.ok).toBe(false)
			expect(hidden.error).toBe(UNKNOWN)
			expect(hidden.genreId).toBeUndefined()

			const visible = await share(stranger.id, theirs.id, open.id, "private")
			expect(visible.ok).toBe(false)
			expect(visible.error).toBe("Only the owner or an admin can change a shared layout.")
			expect((await presetRow(open.id)).visibility).toBe("shared")
			expect((await presetRow(secret.id)).visibility).toBe("private")
		},
		60_000
	)

	test(
		"an admin may take someone's shared layout private, and still cannot see a private one",
		async () => {
			await seed()
			const s = await scenario()
			const open = await namedLayout(s.owner.id, "Open", TWO_COLUMNS)
			await shareDirect(open.id, s.owner.id)
			const secret = await namedLayout(s.owner.id, "Secret", TWO_COLUMNS)
			const admin = await user("admin")
			const adminSession = await sessionOf(admin.id)

			const res = await share(admin.id, adminSession.id, open.id, "private", true)
			expect(res.ok).toBe(true)
			expect((await presetRow(open.id)).visibility).toBe("private")

			const refused = await share(admin.id, adminSession.id, secret.id, "shared", true)
			expect(refused.ok).toBe(false)
			expect(refused.error).toBe(UNKNOWN)
		},
		60_000
	)

	test(
		"a built-in layout is refused; so is a share through a session the caller is not in, or none",
		async () => {
			const def = await seed()
			const s = await scenario()
			const builtIn = await share(s.owner.id, s.session.id, def.id, "private")
			expect(builtIn.ok).toBe(false)
			expect(builtIn.error).toBe("Built-in layouts are already shared with everyone.")

			const stranger = await user("outsider")
			const own = await namedLayout(stranger.id, "Outsider's", TWO_COLUMNS)
			const notIn = await share(stranger.id, s.session.id, own.id, "shared")
			expect(notIn.ok).toBe(false)
			expect(notIn.error).toBe(NO_ACCESS)
			const none = await share(stranger.id, undefined, own.id, "shared")
			expect(none.ok).toBe(false)
			expect(none.error).toBe(NO_ACCESS)
			expect((await presetRow(own.id)).visibility).toBe("private")
		},
		60_000
	)

	test(
		"⚠ a guest in someone else's session may still share through a session of their own, where they are its owner (advisory until accounts carry a guest role)",
		async () => {
			await seed()
			const s = await scenario()
			const own = await namedLayout(s.guest.id, "Guest's", TWO_COLUMNS)
			const refused = await share(s.guest.id, s.session.id, own.id, "shared")
			expect(refused.ok).toBe(false)
			// Anyone may make a session; in theirs, the guest is the owner.
			const theirs = await sessionOf(s.guest.id)
			const res = await share(s.guest.id, theirs.id, own.id, "shared")
			expect(res.ok).toBe(true)
			expect((await presetRow(own.id)).visibility).toBe("shared")
		},
		60_000
	)

	test(
		"the session named must be of the layout's genre; another genre's session answers as unknown",
		async () => {
			await seed()
			const author = await user("cross-genre")
			const own = await namedLayout(author.id, "Adventure one", TWO_COLUMNS)
			const chat = await sessionOf(author.id, CHAT)
			const res = await share(author.id, chat.id, own.id, "shared")
			expect(res.ok).toBe(false)
			expect(res.error).toBe(UNKNOWN)
			expect(res.presets).toEqual([])
			expect((await presetRow(own.id)).visibility).toBe("private")
		},
		60_000
	)

	test(
		"taking a layout private is not publishing: its author may from a session they are a guest in, and so may an admin who is",
		async () => {
			await seed()
			const s = await scenario()
			const own = await namedLayout(s.guest.id, "Guest's", TWO_COLUMNS)
			await shareDirect(own.id, s.guest.id)
			const back = await share(s.guest.id, s.session.id, own.id, "private")
			expect(back.ok).toBe(true)
			expect((await presetRow(own.id)).visibility).toBe("private")

			const admin = await user("guest-admin")
			await testDb
				.insert(schema.sessionGuests)
				.values({ sessionId: s.session.id, userId: admin.id, isPlayer: true })
			const open = await namedLayout(s.owner.id, "Open", TWO_COLUMNS)
			await shareDirect(open.id, s.owner.id)
			const unshared = await share(admin.id, s.session.id, open.id, "private", true)
			expect(unshared.ok).toBe(true)
			expect((await presetRow(open.id)).visibility).toBe("private")
			// Publishing from there is still a guest's publishing.
			const adminsOwn = await namedLayout(admin.id, "Admin's", TWO_COLUMNS)
			const publish = await share(admin.id, s.session.id, adminsOwn.id, "shared", true)
			expect(publish.ok).toBe(false)
			expect(publish.error).toBe(
				"You can use and save your own layouts, but not share one with the pub."
			)
		},
		60_000
	)

	test(
		"unsharing a layout someone uses for new sessions sends them to the genre default layout at their next first open",
		async () => {
			const def = await seed()
			const s = await scenario()
			const layout = await namedLayout(s.owner.id, "Everyone's", TWO_COLUMNS)
			await share(s.owner.id, s.session.id, layout.id, "shared")
			const friend = await user("friend")
			const chose = await setNewSessionLayout(friend.id, ADVENTURE, layout.id)
			expect(chose.ok).toBe(true)

			const first = await sessionOf(friend.id)
			const opened = await get(friend.id, first.id)
			expect(opened.startedFromLayoutPresetId).toBe(layout.id)
			expect(opened.layout).toEqual(TWO_COLUMNS)

			await share(s.owner.id, s.session.id, layout.id, "private")
			// The session they already have keeps its copy.
			const again = await get(friend.id, first.id)
			expect(again.layout).toEqual(TWO_COLUMNS)
			// A new one starts from the genre default layout.
			const next = await sessionOf(friend.id)
			const fresh = await get(friend.id, next.id)
			expect(fresh.startedFromLayoutPresetId).toBe(def.id)
		},
		60_000
	)
})

// ── clone ────────────────────────────────────────────────────────────────

describe("sessions:layoutPreset:clone", () => {
	test(
		"any layout the caller can see becomes a new private layout of theirs, named '(copy)' unless named",
		async () => {
			const def = await seed()
			const s = await scenario()
			const res = await clone(s.owner.id, def.id)
			expect(res.ok).toBe(true)
			expect(res.id).toBe(def.id)
			expect(res.genreId).toBe(ADVENTURE)
			const copy = res.preset!
			expect(copy.id).not.toBe(def.id)
			expect(copy.name).toBe(`${def.name} (copy)`)
			expect(copy.origin).toBe("user")
			expect(copy.mine).toBe(true)
			expect(copy.visibility).toBe("private")
			expect(copy.isGenreDefault).toBe(false)
			expect(copy.layout).toEqual(def.layout)
			expect(res.presets.some((p) => p.id === copy.id)).toBe(true)

			// Someone else's shared layout, under a name of the caller's.
			const author = await user("author")
			const theirs = await namedLayout(author.id, "Theirs", TWO_COLUMNS)
			await shareDirect(theirs.id, author.id)
			const kept = await clone(s.owner.id, theirs.id, "Now mine")
			expect(kept.ok).toBe(true)
			expect(kept.preset!.name).toBe("Now mine")
			expect(kept.preset!.mine).toBe(true)
			expect(kept.preset!.layout).toEqual(TWO_COLUMNS)
			const stored = await presetRow(kept.preset!.id)
			expect(stored.authorUserId).toBe(s.owner.id)
			expect(stored.seedKey).toBeNull()
		},
		60_000
	)

	test(
		"a guest may clone",
		async () => {
			const def = await seed()
			const s = await scenario()
			const res = await clone(s.guest.id, def.id)
			expect(res.ok).toBe(true)
			expect(res.preset!.mine).toBe(true)
		},
		60_000
	)

	test(
		"a blank name takes the '(copy)' default rather than being refused",
		async () => {
			const def = await seed()
			const person = await user("blank-name")
			for (const name of ["", "   "]) {
				const res = await clone(person.id, def.id, name)
				expect(res.ok, JSON.stringify(name)).toBe(true)
				expect(res.preset!.name).toBe(`${def.name} (copy)`)
			}
		},
		60_000
	)

	test(
		"a long name keeps its '(copy)': the name is shortened, never the suffix",
		async () => {
			const person = await user("long-name")
			const long = "L".repeat(80)
			for (const length of [73, 74, 80]) {
				const source = await namedLayout(person.id, long.slice(0, length), TWO_COLUMNS)
				const res = await clone(person.id, source.id)
				expect(res.ok, `a ${length}-character name`).toBe(true)
				expect(res.preset!.name.endsWith(" (copy)"), res.preset!.name).toBe(true)
				expect(res.preset!.name.length).toBeLessThanOrEqual(80)
				expect(res.preset!.name).not.toBe(source.name)
			}
		},
		60_000
	)

	test(
		"a stranger's private layout, a withdrawn one and a missing id are all unknown, and nothing is written",
		async () => {
			await seed()
			const s = await scenario()
			const secret = await namedLayout(s.owner.id, "Secret", TWO_COLUMNS)
			const [withdrawn] = await testDb
				.insert(schema.sessionLayoutPresets)
				.values({
					seedKey: `layout:${ADVENTURE}:gone.plugin/wide-${n++}`,
					genreId: ADVENTURE,
					origin: "plugin",
					pluginId: "gone.plugin",
					withdrawnAt: new Date(),
					slug: `wide-${n++}`,
					name: "Wide",
					visibility: "shared",
					layout: TWO_COLUMNS
				})
				.returning()
			const stranger = await user("cloner")
			for (const id of [secret.id, withdrawn.id, 999_999]) {
				const res = await clone(stranger.id, id)
				expect(res.ok).toBe(false)
				expect(res.error).toBe(UNKNOWN)
				expect(res.genreId).toBeUndefined()
				expect(res.presets).toEqual([])
			}
			const theirs = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.authorUserId, stranger.id))
			expect(theirs).toEqual([])
		},
		60_000
	)
})

// ── update (Save changes to "Name") ───────────────────────────────────────

describe("sessions:layoutPreset:update", () => {
	/** An owner whose session started from their own saved layout. */
	async function startedFromOwn() {
		await seed()
		const s = await scenario()
		await get(s.owner.id, s.session.id)
		const mine = await namedLayout(s.owner.id, "Mine", TWO_COLUMNS)
		const started = await startFrom(s.owner.id, s.session.id, mine.id)
		expect(started.ok).toBe(true)
		return { ...s, mine }
	}

	test(
		"re-captures the session's layout into the row, packing the drawn instances' settings and pins; the session is not Updated",
		async () => {
			const s = await startedFromOwn()
			await testDb
				.update(schema.sessionLayoutPresets)
				.set({ layoutUpdatedAt: LONG_AGO })
				.where(eq(schema.sessionLayoutPresets.id, s.mine.id))
			await set(s.owner.id, s.session.id, {
				layout: STATS_RIGHT,
				widgetSettings: {
					stats: { density: "compact" },
					// Not drawn: never packed.
					"world-state#2": { title: "Old copy" }
				},
				layoutSettings: {
					widgetStyles: {
						messages: { id: 4, slug: "quiet" },
						"stats#3": { id: 5, slug: "leftover" }
					}
				}
			})
			const res = await update(s.owner.id, s.session.id, s.mine.id, STATS_RIGHT, [
				"stats",
				"lore-entries",
				"messages"
			])
			expect(res.ok).toBe(true)
			expect(res.id).toBe(s.mine.id)
			expect(res.genreId).toBe(ADVENTURE)
			expect(res.preset!.layout).toEqual({
				...STATS_RIGHT,
				widgetSettings: { stats: { density: "compact" } },
				widgetStyles: { messages: { id: 4, slug: "quiet" } }
			})
			const stored = await presetRow(s.mine.id)
			expect(stored.layoutUpdatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime())
			// The session started from what it just saved, at the same instant.
			expect(res.startedFromLayoutPresetId).toBe(s.mine.id)
			expect(res.layoutCopiedAt).toBe(stored.layoutUpdatedAt.toISOString())
			const row = await rowOf(s.session.id, s.owner.id)
			expect(row.startedFromLayoutPresetId).toBe(s.mine.id)
			expect(row.layoutCopiedAt!.getTime()).toBe(stored.layoutUpdatedAt.getTime())
			const got = await get(s.owner.id, s.session.id)
			expect(got.startedFromUpdated).toBe(false)
			expect(res.presets.find((p) => p.id === s.mine.id)!.layout).toEqual(
				res.preset!.layout
			)
		},
		60_000
	)

	test(
		"layout_updated_at moves only when the layout changes; the session's copy stamp moves either way",
		async () => {
			const s = await startedFromOwn()
			await set(s.owner.id, s.session.id, { layout: TWO_COLUMNS })
			const first = await update(s.owner.id, s.session.id, s.mine.id, TWO_COLUMNS, [
				"stats",
				"lore-entries",
				"messages"
			])
			expect(first.ok).toBe(true)
			// The same layout again, over a stamp from long ago: it stays.
			await testDb
				.update(schema.sessionLayoutPresets)
				.set({ layoutUpdatedAt: LONG_AGO })
				.where(eq(schema.sessionLayoutPresets.id, s.mine.id))
			await testDb
				.update(schema.sessionPanelLayouts)
				.set({ layoutCopiedAt: LONG_AGO })
				.where(
					and(
						eq(schema.sessionPanelLayouts.sessionId, s.session.id),
						eq(schema.sessionPanelLayouts.userId, s.owner.id)
					)
				)
			const same = await update(s.owner.id, s.session.id, s.mine.id, TWO_COLUMNS, [
				"stats",
				"lore-entries",
				"messages"
			])
			expect(same.ok).toBe(true)
			expect((await presetRow(s.mine.id)).layoutUpdatedAt.getTime()).toBe(
				LONG_AGO.getTime()
			)
			const row = await rowOf(s.session.id, s.owner.id)
			expect(row.layoutCopiedAt!.getTime()).toBeGreaterThan(LONG_AGO.getTime())
			expect((await get(s.owner.id, s.session.id)).startedFromUpdated).toBe(false)

			// A renamed row is not a changed layout either.
			const { renameUserLayoutPreset } = await import("$lib/server/db/layoutPresets")
			await renameUserLayoutPreset({
				presetId: s.mine.id,
				userId: s.owner.id,
				name: "Renamed"
			})
			expect((await presetRow(s.mine.id)).layoutUpdatedAt.getTime()).toBe(
				LONG_AGO.getTime()
			)
		},
		60_000
	)

	test(
		"another session that started from it keeps its own layout and only reads Updated",
		async () => {
			const s = await startedFromOwn()
			const second = await sessionOf(s.owner.id)
			await get(s.owner.id, second.id)
			const copied = await startFrom(s.owner.id, second.id, s.mine.id)
			expect(copied.layout).toEqual(TWO_COLUMNS)
			await testDb
				.update(schema.sessionPanelLayouts)
				.set({ layoutCopiedAt: LONG_AGO })
				.where(
					and(
						eq(schema.sessionPanelLayouts.sessionId, second.id),
						eq(schema.sessionPanelLayouts.userId, s.owner.id)
					)
				)
			await set(s.owner.id, s.session.id, { layout: STATS_RIGHT })
			const res = await update(s.owner.id, s.session.id, s.mine.id, STATS_RIGHT, [
				"stats",
				"lore-entries",
				"messages"
			])
			expect(res.ok).toBe(true)
			const other = await get(s.owner.id, second.id)
			expect(other.layout).toEqual(TWO_COLUMNS)
			expect(other.startedFromLayoutPresetId).toBe(s.mine.id)
			expect(other.startedFromUpdated).toBe(true)
		},
		60_000
	)

	test(
		"refused, with nothing moved: a built-in, a stranger's private layout, someone else's shared one, another genre's, and a session the caller is not in",
		async () => {
			const def = await seed()
			await seed(CHAT)
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			const author = await user("sharer")
			const secret = await namedLayout(author.id, "Secret", TWO_COLUMNS)
			const open = await namedLayout(author.id, "Open", TWO_COLUMNS)
			await shareDirect(open.id, author.id)
			const chatOwn = await namedLayout(s.owner.id, "Chat one", TWO_COLUMNS, CHAT)
			const own = await namedLayout(s.owner.id, "Own", TWO_COLUMNS)
			const before = await Promise.all(
				[def.id, secret.id, open.id, chatOwn.id, own.id].map(presetRow)
			)

			const cases: [number, number, string][] = [
				[s.session.id, def.id, "Built-in layouts can't be changed — save a copy instead."],
				[s.session.id, secret.id, UNKNOWN],
				[s.session.id, open.id, "Only the owner or an admin can change a shared layout."],
				[s.session.id, chatOwn.id, UNKNOWN]
			]
			for (const [sessionId, id, error] of cases) {
				const res = await update(s.owner.id, sessionId, id, STATS_RIGHT, ["stats"])
				expect(res.ok, `layout ${id}`).toBe(false)
				expect(res.error).toBe(error)
				expect(res.presets).toEqual([])
			}
			// The author's own row, through a session they are not in.
			const outsider = await update(author.id, s.session.id, open.id, STATS_RIGHT, [])
			expect(outsider.ok).toBe(false)
			expect(outsider.error).toBe(NO_ACCESS)

			const after = await Promise.all(
				[def.id, secret.id, open.id, chatOwn.id, own.id].map(presetRow)
			)
			expect(after).toEqual(before)
			expect((await rowOf(s.session.id, s.owner.id)).startedFromLayoutPresetId).toBe(
				def.id
			)
		},
		60_000
	)

	test(
		"an admin may re-capture someone's shared layout; a guest may re-capture their own, not the host's",
		async () => {
			await seed()
			const s = await scenario()
			const open = await namedLayout(s.owner.id, "Open", TWO_COLUMNS)
			await shareDirect(open.id, s.owner.id)
			const hostOwn = await namedLayout(s.owner.id, "Host's", TWO_COLUMNS)

			const admin = await user("admin")
			const adminSession = await sessionOf(admin.id)
			await get(admin.id, adminSession.id)
			const byAdmin = await update(admin.id, adminSession.id, open.id, STATS_RIGHT, [], true)
			expect(byAdmin.ok).toBe(true)
			expect((await presetRow(open.id)).layout).toEqual(STATS_RIGHT)
			// …and without the admin bit, the same ask is refused.
			const notAdmin = await update(admin.id, adminSession.id, open.id, TWO_COLUMNS, [])
			expect(notAdmin.ok).toBe(false)

			await get(s.guest.id, s.session.id)
			const guestOwn = await namedLayout(s.guest.id, "Guest's", TWO_COLUMNS)
			const byGuest = await update(s.guest.id, s.session.id, guestOwn.id, STATS_RIGHT, [])
			expect(byGuest.ok).toBe(true)
			expect((await presetRow(guestOwn.id)).layout).toEqual(STATS_RIGHT)
			const hosts = await update(s.guest.id, s.session.id, hostOwn.id, STATS_RIGHT, [])
			expect(hosts.ok).toBe(false)
			expect(hosts.error).toBe(UNKNOWN)
			expect((await presetRow(hostOwn.id)).layout).toEqual(TWO_COLUMNS)
		},
		60_000
	)
})

// ── setNewSessionLayout ───────────────────────────────────────────────────

describe("sessions:layoutPreset:setNewSessionLayout", () => {
	test(
		"the chosen layout is what the next first open copies, and the list marks it; null brings the genre default back",
		async () => {
			const def = await seed()
			const person = await user("chooser")
			const preferred = await namedLayout(person.id, "Preferred", {
				...TWO_COLUMNS,
				widgetSettings: { stats: { density: "compact" } }
			})
			const res = await setNewSessionLayout(person.id, ADVENTURE, preferred.id)
			expect(res.ok).toBe(true)
			expect(res.genreId).toBe(ADVENTURE)
			expect(res.layoutPresetId).toBe(preferred.id)
			expect(res.presets.find((p) => p.id === preferred.id)!.isNewSessionLayout).toBe(true)
			expect(res.presets.find((p) => p.id === def.id)!.isNewSessionLayout).toBe(false)

			const first = await sessionOf(person.id)
			const opened = await get(person.id, first.id)
			expect(opened.startedFromLayoutPresetId).toBe(preferred.id)
			expect(opened.layout).toEqual(TWO_COLUMNS)
			expect(opened.widgetSettings.stats).toEqual({ density: "compact" })

			const cleared = await setNewSessionLayout(person.id, ADVENTURE, null)
			expect(cleared.ok).toBe(true)
			expect(cleared.layoutPresetId).toBeNull()
			expect(cleared.presets.some((p) => p.isNewSessionLayout)).toBe(false)
			const next = await sessionOf(person.id)
			expect((await get(person.id, next.id)).startedFromLayoutPresetId).toBe(def.id)
			// Only a first open reads it: the session already opened kept its copy.
			expect((await get(person.id, first.id)).startedFromLayoutPresetId).toBe(
				preferred.id
			)
		},
		60_000
	)

	test(
		"refused: another genre's layout, a stranger's private one, a withdrawn one; someone's shared one may be chosen",
		async () => {
			await seed()
			await seed(CHAT)
			const person = await user("picky")
			const chatOwn = await namedLayout(person.id, "Chat one", TWO_COLUMNS, CHAT)
			const author = await user("maker")
			const secret = await namedLayout(author.id, "Secret", TWO_COLUMNS)
			const open = await namedLayout(author.id, "Open", TWO_COLUMNS)
			await shareDirect(open.id, author.id)
			const [withdrawn] = await testDb
				.insert(schema.sessionLayoutPresets)
				.values({
					seedKey: `layout:${ADVENTURE}:gone.plugin/tall-${n++}`,
					genreId: ADVENTURE,
					origin: "plugin",
					pluginId: "gone.plugin",
					withdrawnAt: new Date(),
					slug: `tall-${n++}`,
					name: "Tall",
					visibility: "shared",
					layout: TWO_COLUMNS
				})
				.returning()
			for (const id of [chatOwn.id, secret.id, withdrawn.id, 999_999]) {
				const res = await setNewSessionLayout(person.id, ADVENTURE, id)
				expect(res.ok, `layout ${id}`).toBe(false)
				expect(res.error).toBe(UNKNOWN)
			}
			const rows = await testDb
				.select()
				.from(schema.userLayoutDefaults)
				.where(eq(schema.userLayoutDefaults.userId, person.id))
			expect(rows).toEqual([])

			const ok = await setNewSessionLayout(person.id, ADVENTURE, open.id)
			expect(ok.ok).toBe(true)
			const first = await sessionOf(person.id)
			expect((await get(person.id, first.id)).startedFromLayoutPresetId).toBe(open.id)
		},
		60_000
	)

	test(
		"a deleted new-session layout falls back to the genre default layout",
		async () => {
			const def = await seed()
			const person = await user("deleter")
			const mine = await namedLayout(person.id, "Short-lived", TWO_COLUMNS)
			await setNewSessionLayout(person.id, ADVENTURE, mine.id)
			const { sessionsLayoutPresetDeleteHandler } = await handlers()
			const del = await sessionsLayoutPresetDeleteHandler.handler(
				fakeSocket(person.id),
				{ id: mine.id } as any,
				noopEmit
			)
			expect(del.ok).toBe(true)
			const first = await sessionOf(person.id)
			expect((await get(person.id, first.id)).startedFromLayoutPresetId).toBe(def.id)
		},
		60_000
	)

	test(
		"a new-session layout is its chooser's, for its genre: another person's first open and the chooser's first open of another genre copy their genre default layout",
		async () => {
			const def = await seed()
			const chatDef = await seed(CHAT)
			const chooser = await user("chooser-only")
			const open = await namedLayout(chooser.id, "Chooser's", TWO_COLUMNS)
			// Shared, so the other person can see it — and still not get it.
			await shareDirect(open.id, chooser.id)
			expect((await setNewSessionLayout(chooser.id, ADVENTURE, open.id)).ok).toBe(true)

			const other = await user("bystander")
			const theirs = await sessionOf(other.id)
			const opened = await get(other.id, theirs.id)
			expect(opened.startedFromLayoutPresetId).toBe(def.id)
			expect(opened.presets.find((p) => p.id === open.id)!.isNewSessionLayout).toBe(false)

			const chat = await sessionOf(chooser.id, CHAT)
			const chatOpened = await get(chooser.id, chat.id)
			expect(chatOpened.startedFromLayoutPresetId).toBe(chatDef.id)
			expect(chatOpened.layout).toEqual(chatDef.layout)
		},
		60_000
	)

	test(
		"choosing the genre default layout is the same as clearing: no row pins it",
		async () => {
			const def = await seed()
			const person = await user("back-to-default")
			const mine = await namedLayout(person.id, "Mine first", TWO_COLUMNS)
			expect((await setNewSessionLayout(person.id, ADVENTURE, mine.id)).ok).toBe(true)
			const res = await setNewSessionLayout(person.id, ADVENTURE, def.id)
			expect(res.ok).toBe(true)
			// Answered as the clear it is, so the page says "the genre default layout".
			expect(res.layoutPresetId).toBeNull()
			expect(res.presets.some((p) => p.isNewSessionLayout)).toBe(false)
			const rows = await testDb
				.select()
				.from(schema.userLayoutDefaults)
				.where(eq(schema.userLayoutDefaults.userId, person.id))
			expect(rows).toEqual([])
			const first = await sessionOf(person.id)
			expect((await get(person.id, first.id)).startedFromLayoutPresetId).toBe(def.id)
		},
		60_000
	)

	test(
		"a request naming no genre is refused in the genre's own word",
		async () => {
			const person = await user("no-genre")
			const res = await setNewSessionLayout(person.id, "", null)
			expect(res.ok).toBe(false)
			expect(res.error).toBe("That genre is unknown.")
		},
		60_000
	)

	test(
		"clearing leaves no row behind, even for a genre nothing ships",
		async () => {
			const person = await user("clearer")
			const res = await setNewSessionLayout(person.id, "nobody:genre/none", null)
			expect(res.ok).toBe(true)
			expect(res.presets).toEqual([])
			const rows = await testDb
				.select()
				.from(schema.userLayoutDefaults)
				.where(eq(schema.userLayoutDefaults.userId, person.id))
			expect(rows).toEqual([])
		},
		60_000
	)
})

// ── admins on shared layouts, across the manage verbs ──────────────────────

describe("an admin manages a shared layout, never a private one", () => {
	test(
		"rename, usage and delete answer an admin for someone's shared layout, and as unknown for a private one",
		async () => {
			await seed()
			const author = await user("published")
			const open = await namedLayout(author.id, "Open", TWO_COLUMNS)
			await shareDirect(open.id, author.id)
			const secret = await namedLayout(author.id, "Secret", TWO_COLUMNS)
			const admin = await user("moderator")
			const h = await handlers()
			const as = fakeSocket(admin.id, true)

			const renamed = await h.sessionsLayoutPresetRenameHandler.handler(
				as,
				{ id: open.id, name: "Moderated" } as any,
				noopEmit
			)
			expect(renamed.ok).toBe(true)
			const usage = await h.sessionsLayoutPresetUsageHandler.handler(
				as,
				{ id: open.id } as any,
				noopEmit
			)
			expect(usage.ok).toBe(true)
			for (const ask of [
				h.sessionsLayoutPresetRenameHandler.handler(as, { id: secret.id, name: "X" } as any, noopEmit),
				h.sessionsLayoutPresetUsageHandler.handler(as, { id: secret.id } as any, noopEmit),
				h.sessionsLayoutPresetDeleteHandler.handler(as, { id: secret.id } as any, noopEmit)
			]) {
				const res = await ask
				expect(res.ok).toBe(false)
				expect(res.error).toBe(UNKNOWN)
			}
			const deleted = await h.sessionsLayoutPresetDeleteHandler.handler(
				as,
				{ id: open.id } as any,
				noopEmit
			)
			expect(deleted.ok).toBe(true)
			expect(await presetRow(open.id)).toBeUndefined()
			expect((await presetRow(secret.id)).name).toBe("Secret")
		},
		60_000
	)
})

// ── shipped layouts, an admin asking ─────────────────────────────────────

describe("a shipped layout is nobody's to change, an admin's included", () => {
	test(
		"an admin's save changes to, share, rename and delete of core's and a plugin's layout are refused by name, and nothing moves",
		async () => {
			const def = await seed()
			const [plugin] = await testDb
				.insert(schema.sessionLayoutPresets)
				.values({
					seedKey: `layout:${ADVENTURE}:some.plugin/wide-${n++}`,
					genreId: ADVENTURE,
					origin: "plugin",
					pluginId: "some.plugin",
					slug: `wide-${n++}`,
					name: "Wide",
					visibility: "shared",
					layout: TWO_COLUMNS
				})
				.returning()
			const admin = await user("root")
			const session = await sessionOf(admin.id)
			await get(admin.id, session.id)
			const h = await handlers()
			const as = fakeSocket(admin.id, true)
			for (const shipped of [def, plugin]) {
				const before = await presetRow(shipped.id)
				const updated = await update(admin.id, session.id, shipped.id, STATS_RIGHT, ["stats"], true)
				expect(updated.ok).toBe(false)
				expect(updated.error).toBe("Built-in layouts can't be changed — save a copy instead.")
				for (const visibility of ["private", "shared"] as const) {
					const shared = await share(admin.id, session.id, shipped.id, visibility, true)
					expect(shared.ok).toBe(false)
					expect(shared.error).toBe("Built-in layouts are already shared with everyone.")
				}
				const renamed = await h.sessionsLayoutPresetRenameHandler.handler(
					as,
					{ id: shipped.id, name: "The admin's" } as any,
					noopEmit
				)
				expect(renamed.ok).toBe(false)
				expect(renamed.error).toBe("Built-in layouts can't be renamed — save a copy instead.")
				const deleted = await h.sessionsLayoutPresetDeleteHandler.handler(
					as,
					{ id: shipped.id } as any,
					noopEmit
				)
				expect(deleted.ok).toBe(false)
				expect(deleted.error).toBe("Built-in layouts can't be deleted.")
				expect(await presetRow(shipped.id)).toEqual(before)
			}
		},
		60_000
	)
})

// ── a layout the app cannot draw ─────────────────────────────────────────

describe("a layout people save is checked before it is kept or shared", () => {
	/** Every slot the wrong shape (the reviewer's probe). */
	const MALFORMED = {
		zoneLayout: { version: 1, zones: { left: "nope" } },
		widgetGrid: { widgets: "x" },
		arrangedGrid: 42
	}
	const CANT_SAVE = "This layout can't be saved: part of it isn't in a shape the app can draw."
	const CANT_SHARE = "This layout can't be shared: part of it isn't in a shape the app can draw."

	test(
		"Save as new layout refuses it and writes nothing",
		async () => {
			const def = await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			const { sessionsLayoutPresetSaveHandler } = await handlers()
			const res = await sessionsLayoutPresetSaveHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id, name: "Trap", layout: MALFORMED, drawnWidgetIds: [] } as any,
				noopEmit
			)
			expect(res.ok).toBe(false)
			expect(res.error).toBe(CANT_SAVE)
			expect(res.preset).toBeUndefined()
			const theirs = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(eq(schema.sessionLayoutPresets.authorUserId, s.owner.id))
			expect(theirs).toEqual([])
			expect((await rowOf(s.session.id, s.owner.id)).startedFromLayoutPresetId).toBe(def.id)
		},
		60_000
	)

	test(
		"Save changes to refuses it and the layout keeps what it had",
		async () => {
			await seed()
			const s = await scenario()
			await get(s.owner.id, s.session.id)
			const mine = await namedLayout(s.owner.id, "Mine", TWO_COLUMNS)
			for (const layout of [MALFORMED, { widgetGrid: "zzz" }]) {
				const res = await update(s.owner.id, s.session.id, mine.id, layout, [])
				expect(res.ok).toBe(false)
				expect(res.error).toBe(CANT_SAVE)
			}
			expect((await presetRow(mine.id)).layout).toEqual(TWO_COLUMNS)
		},
		60_000
	)

	test(
		"a stored layout that the app cannot draw is not shared; a sound one is",
		async () => {
			await seed()
			const s = await scenario()
			const old = await namedLayout(s.owner.id, "Saved before the check", MALFORMED)
			const res = await share(s.owner.id, s.session.id, old.id, "shared")
			expect(res.ok).toBe(false)
			expect(res.error).toBe(CANT_SHARE)
			expect((await presetRow(old.id)).visibility).toBe("private")
			// Taking one private is never refused for its shape.
			await testDb
				.update(schema.sessionLayoutPresets)
				.set({ visibility: "shared" })
				.where(eq(schema.sessionLayoutPresets.id, old.id))
			const back = await share(s.owner.id, s.session.id, old.id, "private")
			expect(back.ok).toBe(true)
		},
		60_000
	)
})

describe("the sentences a person reads say layout, never preset", () => {
	test("every refusal the layout verbs send is worded for the screen", async () => {
		// The page toasts these verbatim (share, clone, Save changes to, the
		// new-session layout, rename, delete), so the rule for on-screen words
		// holds for them too (NOMENCLATURE §9: "never 'preset' on screen").
		const mod = (await import("$lib/server/db/layoutPresets")) as Record<string, unknown>
		const sentences = Object.entries(mod).filter(
			([k, v]) => k.startsWith("LAYOUT_PRESET_") && typeof v === "string"
		)
		expect(sentences.map(([k]) => k)).toContain("LAYOUT_PRESET_UNKNOWN")
		for (const [key, sentence] of sentences)
			expect(sentence as string, key).not.toMatch(/preset/i)
		expect(mod.LAYOUT_PRESET_UNKNOWN).toBe(UNKNOWN)
		expect(mod.LAYOUT_PRESET_NEEDS_NAME).toBe("A layout needs a name.")
	})
})
