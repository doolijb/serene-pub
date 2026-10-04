/**
 * Brief 6b of `PLAN-layout-one-format-2026-09-28`: what **Updated** means once
 * the editor can write back into a layout.
 *
 * - **Save changes to "*Name*"** from a session that reads **Updated** would
 *   silently overwrite what was saved into that layout from another session.
 *   The server refuses it unless the person has been asked
 *   (`overwriteUpdated`), and nothing moves on a refusal.
 * - **Updated is live.** When a layout's `layout_updated_at` moves — a save
 *   into it, or a reconcile (a plugin update, core's boot pass) — every
 *   session that started from it and now reads Updated is told, scoped to
 *   that session (`sessions:panelLayout:startedFromUpdated#<id>`), so the
 *   Updated line, chip and dot appear without a reload. The gate comes first:
 *   nobody watching means nothing is read or built.
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

afterAll(async () => {
	// The installed transport lives on globalThis: leave none behind.
	const { installStartedFromPush } = await import("$lib/server/sessions/startedFromPush")
	installStartedFromPush(null)
})

const ADVENTURE = "core:genre/adventure"
const EVENT = "sessions:panelLayout:startedFromUpdated"
const CHANGED_ELSEWHERE =
	"That layout has changed since this session copied it. Start again from it, or save over those changes."

type Sent = { to: string; event: string; payload: any }

/**
 * A Socket.IO server double: each socket is one tab, in its user's room,
 * holding the interest keys it declared.
 */
function fakeIo(tabs: Array<{ id: string; userId: number; interest: string[] }>) {
	const sent: Sent[] = []
	const sockets = new Map<string, any>()
	const rooms = new Map<string, Set<string>>()
	for (const t of tabs) {
		sockets.set(t.id, { id: t.id, user: { id: t.userId, isAdmin: false }, interest: new Set(t.interest) })
		const room = `user_${t.userId}`
		if (!rooms.has(room)) rooms.set(room, new Set())
		rooms.get(room)!.add(t.id)
	}
	const io = {
		to: (room: string) => ({
			emit: (event: string, payload: any) => sent.push({ to: room, event, payload })
		}),
		sockets: { sockets, adapter: { rooms } }
	}
	return { io, sent }
}

const quietIo = { to: () => ({ emit: () => {} }), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } }
function fakeSocket(userId: number, io: unknown = quietIo, isAdmin = false) {
	return { user: { id: userId, isAdmin }, io } as any
}
const noopEmit = () => {}
const handlers = () => import("./sessions")

let n = 0
async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `sfu-${label}-${n++}`)
}
async function sessionOf(userId: number, genreId = ADVENTURE) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: true, genreId })
		.returning()
	return session
}
async function seed(genreId = ADVENTURE) {
	const { syncLayoutPresets } = await import("$lib/server/db/layoutPresets")
	await syncLayoutPresets([genreId])
	const [row] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.seedKey, layoutPresetSeedKey(genreId)))
	return row
}
async function namedLayout(userId: number, name: string, layout: Record<string, unknown>) {
	const { saveUserLayoutPreset } = await import("$lib/server/db/layoutPresets")
	return saveUserLayoutPreset({ genreId: ADVENTURE, userId, name, layout })
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
	return sessionsPanelLayoutGetHandler.handler(fakeSocket(userId), { sessionId } as any, noopEmit)
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
async function update(
	userId: number,
	sessionId: number,
	id: number,
	layout: Record<string, unknown>,
	extra: { overwriteUpdated?: boolean; io?: unknown } = {}
) {
	const { sessionsLayoutPresetUpdateHandler } = (await handlers()) as any
	return sessionsLayoutPresetUpdateHandler.handler(
		fakeSocket(userId, extra.io),
		{
			sessionId,
			id,
			layout,
			drawnWidgetIds: ["stats", "lore-entries", "messages"],
			...(extra.overwriteUpdated !== undefined
				? { overwriteUpdated: extra.overwriteUpdated }
				: {})
		},
		noopEmit
	) as Promise<Sockets.Sessions.PanelLayout.Update.Response>
}
async function share(userId: number, sessionId: number, id: number) {
	const { sessionsLayoutPresetShareHandler } = (await handlers()) as any
	return sessionsLayoutPresetShareHandler.handler(
		fakeSocket(userId),
		{ sessionId, id, visibility: "shared" },
		noopEmit
	) as Promise<Sockets.Sessions.PanelLayout.Share.Response>
}

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
const STATS_RIGHT = {
	...TWO_COLUMNS,
	zoneLayout: {
		version: 1,
		zones: {
			right: { kind: "side", side: "right", pinned: true, widgets: ["stats", "lore-entries"] }
		}
	}
}
const STATS_LEFT = {
	...TWO_COLUMNS,
	zoneLayout: {
		version: 1,
		zones: {
			left: { kind: "side", side: "left", pinned: true, widgets: ["stats", "lore-entries"] }
		}
	}
}

/** One person with two sessions that both started from their own layout. */
async function twoSessionsFromOwn() {
	await seed()
	const owner = await user("owner")
	const a = await sessionOf(owner.id)
	const b = await sessionOf(owner.id)
	await get(owner.id, a.id)
	await get(owner.id, b.id)
	const mine = await namedLayout(owner.id, "Harbour watch", TWO_COLUMNS)
	expect((await startFrom(owner.id, a.id, mine.id)).ok).toBe(true)
	expect((await startFrom(owner.id, b.id, mine.id)).ok).toBe(true)
	return { owner, a, b, mine }
}

// ── Save changes to, over an Updated layout ─────────────────────────────

describe("Save changes to a layout this session reads as Updated", () => {
	test(
		"is refused unless the person was asked, and nothing moves; asked, it saves over the other session's changes",
		async () => {
			const s = await twoSessionsFromOwn()
			// Session B saves its changes into the layout: A now reads Updated.
			await set(s.owner.id, s.b.id, { layout: STATS_RIGHT })
			expect((await update(s.owner.id, s.b.id, s.mine.id, STATS_RIGHT)).ok).toBe(true)
			expect((await get(s.owner.id, s.a.id)).startedFromUpdated).toBe(true)
			const saved = await presetRow(s.mine.id)
			const aBefore = await rowOf(s.a.id, s.owner.id)

			// From A, unasked: refused, the layout keeps B's changes, A's stamps stand.
			await set(s.owner.id, s.a.id, { layout: STATS_LEFT })
			const unasked = await update(s.owner.id, s.a.id, s.mine.id, STATS_LEFT)
			expect(unasked.ok).toBe(false)
			expect(unasked.error).toBe(CHANGED_ELSEWHERE)
			expect(unasked.presets).toEqual([])
			expect(await presetRow(s.mine.id)).toEqual(saved)
			const aAfter = await rowOf(s.a.id, s.owner.id)
			expect(aAfter.layoutCopiedAt).toEqual(aBefore.layoutCopiedAt)
			expect((await get(s.owner.id, s.a.id)).startedFromUpdated).toBe(true)

			// Asked and confirmed: A's layout replaces B's; now B reads Updated.
			const asked = await update(s.owner.id, s.a.id, s.mine.id, STATS_LEFT, {
				overwriteUpdated: true
			})
			expect(asked.ok).toBe(true)
			expect((await presetRow(s.mine.id)).layout).toEqual(STATS_LEFT)
			expect((await get(s.owner.id, s.a.id)).startedFromUpdated).toBe(false)
			expect((await get(s.owner.id, s.b.id)).startedFromUpdated).toBe(true)
		},
		60_000
	)

	test(
		"a session that is not Updated saves without being asked",
		async () => {
			const s = await twoSessionsFromOwn()
			await set(s.owner.id, s.a.id, { layout: STATS_RIGHT })
			const res = await update(s.owner.id, s.a.id, s.mine.id, STATS_RIGHT)
			expect(res.ok).toBe(true)
			expect((await presetRow(s.mine.id)).layout).toEqual(STATS_RIGHT)
		},
		60_000
	)
})

// ── the live push ─────────────────────────────────────────────────────────

describe("Updated is pushed to the sessions that started from a layout", () => {
	test(
		"Save changes to tells every other session that started from it, each person their own list, scoped to the session",
		async () => {
			const s = await twoSessionsFromOwn()
			// Someone else starts one of their sessions from it, once it is shared.
			expect((await share(s.owner.id, s.a.id, s.mine.id)).ok).toBe(true)
			const other = await user("other")
			const d = await sessionOf(other.id)
			await get(other.id, d.id)
			expect((await startFrom(other.id, d.id, s.mine.id)).ok).toBe(true)
			// A third session of the owner's that never started from it.
			const c = await sessionOf(s.owner.id)
			await get(s.owner.id, c.id)

			const { io, sent } = fakeIo([
				{ id: "owner-a", userId: s.owner.id, interest: [`${EVENT}#${s.a.id}`] },
				{ id: "owner-b", userId: s.owner.id, interest: [`${EVENT}#${s.b.id}`] },
				{ id: "owner-c", userId: s.owner.id, interest: [`${EVENT}#${c.id}`] },
				{ id: "other-d", userId: other.id, interest: [`${EVENT}#${d.id}`] }
			])
			await set(s.owner.id, s.a.id, { layout: STATS_RIGHT })
			const res = await update(s.owner.id, s.a.id, s.mine.id, STATS_RIGHT, { io })
			expect(res.ok).toBe(true)

			const pushes = sent.filter((x) => x.event === EVENT)
			expect(pushes.map((x) => x.to).sort()).toEqual(["other-d", "owner-b"])
			const toB = pushes.find((x) => x.to === "owner-b")!.payload
			expect(toB.sessionId).toBe(s.b.id)
			expect(toB.startedFromLayoutPresetId).toBe(s.mine.id)
			expect(toB.startedFromUpdated).toBe(true)
			expect(toB.presets.find((p: any) => p.id === s.mine.id).layout).toMatchObject(
				STATS_RIGHT
			)
			const toD = pushes.find((x) => x.to === "other-d")!.payload
			expect(toD.sessionId).toBe(d.id)
			expect(toD.startedFromUpdated).toBe(true)
			// Their own list: the layout is shared with them, not theirs.
			expect(toD.presets.find((p: any) => p.id === s.mine.id).mine).toBe(false)
			// Each session keeps its own layout: the push is a label only.
			expect((await get(s.owner.id, s.b.id)).layout).toEqual(TWO_COLUMNS)
		},
		60_000
	)

	test(
		"nothing is pushed when the layout did not move, or when nobody watches",
		async () => {
			const s = await twoSessionsFromOwn()
			const { __startedFromPushBuildsForTests } = await import(
				"$lib/server/sessions/startedFromPush"
			)
			const { io, sent } = fakeIo([
				{ id: "owner-b", userId: s.owner.id, interest: [`${EVENT}#${s.b.id}`] }
			])
			// Saved once (the first save may pack settings the row lacked)…
			await set(s.owner.id, s.a.id, { layout: TWO_COLUMNS })
			expect((await update(s.owner.id, s.a.id, s.mine.id, TWO_COLUMNS)).ok).toBe(true)
			// …then the same layout the row now holds: no move, no push.
			expect((await update(s.owner.id, s.a.id, s.mine.id, TWO_COLUMNS, { io })).ok).toBe(
				true
			)
			expect(sent.filter((x) => x.event === EVENT)).toEqual([])

			// It moves, but no socket anywhere watches the event: nothing is built.
			const nobody = fakeIo([
				{ id: "owner-b", userId: s.owner.id, interest: ["sessions:get#1"] }
			])
			const builds = __startedFromPushBuildsForTests()
			await set(s.owner.id, s.a.id, { layout: STATS_RIGHT })
			expect(
				(await update(s.owner.id, s.a.id, s.mine.id, STATS_RIGHT, { io: nobody.io })).ok
			).toBe(true)
			expect(nobody.sent).toEqual([])
			expect(__startedFromPushBuildsForTests()).toBe(builds)
		},
		60_000
	)

	test(
		"asked (after a refused save), it answers the same facts; a stranger gets the empty answer",
		async () => {
			const s = await twoSessionsFromOwn()
			await set(s.owner.id, s.b.id, { layout: STATS_RIGHT })
			expect((await update(s.owner.id, s.b.id, s.mine.id, STATS_RIGHT)).ok).toBe(true)
			const { sessionsPanelLayoutStartedFromUpdatedHandler } = (await handlers()) as any
			const asked = await sessionsPanelLayoutStartedFromUpdatedHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.a.id },
				noopEmit
			)
			expect(asked.sessionId).toBe(s.a.id)
			expect(asked.startedFromLayoutPresetId).toBe(s.mine.id)
			expect(asked.startedFromUpdated).toBe(true)
			expect(asked.presets.map((p: any) => p.id)).toContain(s.mine.id)
			const stranger = await user("stranger")
			const refused = await sessionsPanelLayoutStartedFromUpdatedHandler.handler(
				fakeSocket(stranger.id),
				{ sessionId: s.a.id },
				noopEmit
			)
			expect(refused).toEqual({
				sessionId: s.a.id,
				startedFromLayoutPresetId: null,
				layoutCopiedAt: null,
				startedFromUpdated: false,
				presets: []
			})
		},
		60_000
	)

	test(
		"a plugin update that moves its layout tells the sessions that started from it",
		async () => {
			await seed()
			const pluginId = `acme/push-${n++}`
			const manifest = (widget: string) => ({
				layouts: [
					{
						genreId: ADVENTURE,
						slug: "cinematic",
						name: "Cinematic",
						preset: {
							zoneLayout: {
								version: 1,
								zones: { right: { kind: "side", side: "right", widgets: [widget] } }
							}
						}
					}
				]
			})
			await testDb.insert(schema.plugins).values({
				pluginId,
				name: "Acme",
				version: "1.0.0",
				bundleSource: "// none",
				bundleHash: `hash-${n++}`,
				enabled: true,
				manifest: manifest("stats")
			})
			const { syncPluginLayouts } = await import("$lib/server/db/pluginLayouts")
			await syncPluginLayouts(testDb as any)
			const [row] = await testDb
				.select()
				.from(schema.sessionLayoutPresets)
				.where(
					eq(
						schema.sessionLayoutPresets.seedKey,
						`layout:${ADVENTURE}:${pluginId}/cinematic`
					)
				)
			const person = await user("player")
			const session = await sessionOf(person.id)
			await get(person.id, session.id)
			expect((await startFrom(person.id, session.id, row.id)).ok).toBe(true)

			const { io, sent } = fakeIo([
				{ id: "tab", userId: person.id, interest: [`${EVENT}#${session.id}`] }
			])
			const { afterLayoutReconcile } = await import("$lib/server/sessions/startedFromPush")
			// The package updates: its layout now docks lore on the right.
			await testDb
				.update(schema.plugins)
				.set({ manifest: manifest("lore-entries") })
				.where(eq(schema.plugins.pluginId, pluginId))
			await afterLayoutReconcile(() => syncPluginLayouts(testDb as any), io as any)
			const pushes = sent.filter((x) => x.event === EVENT)
			expect(pushes.map((x) => x.to)).toEqual(["tab"])
			expect(pushes[0].payload.sessionId).toBe(session.id)
			expect(pushes[0].payload.startedFromUpdated).toBe(true)

			// A reconcile that moves nothing says nothing.
			sent.length = 0
			await afterLayoutReconcile(() => syncPluginLayouts(testDb as any), io as any)
			expect(sent.filter((x) => x.event === EVENT)).toEqual([])
		},
		60_000
	)
})

// ── other people's lists (brief 6b review) ────────────────────────────────

describe("what other people see of a shared layout follows it live", () => {
	async function shareAs(
		userId: number,
		sessionId: number,
		id: number,
		visibility: "shared" | "private",
		io: unknown,
		isAdmin = false
	) {
		const { sessionsLayoutPresetShareHandler } = (await handlers()) as any
		return sessionsLayoutPresetShareHandler.handler(
			fakeSocket(userId, io, isAdmin),
			{ sessionId, id, visibility },
			noopEmit
		) as Promise<Sockets.Sessions.PanelLayout.Share.Response>
	}
	async function renameAs(userId: number, id: number, name: string, io: unknown) {
		const { sessionsLayoutPresetRenameHandler } = await handlers()
		return sessionsLayoutPresetRenameHandler.handler(
			fakeSocket(userId, io),
			{ id, name } as any,
			noopEmit
		)
	}
	async function deleteAs(userId: number, id: number, io: unknown) {
		const { sessionsLayoutPresetDeleteHandler } = await handlers()
		return sessionsLayoutPresetDeleteHandler.handler(
			fakeSocket(userId, io),
			{ id } as any,
			noopEmit
		)
	}

	/** Wren makes a layout; Ash has an Adventure session and a Chat one open. */
	async function twoPeople() {
		await seed()
		const wren = await user("wren")
		const ash = await user("ash")
		const w = await sessionOf(wren.id)
		const a = await sessionOf(ash.id)
		const chat = await sessionOf(ash.id, "core:genre/chat")
		await get(wren.id, w.id)
		await get(ash.id, a.id)
		const layout = await namedLayout(wren.id, "Harbour watch", TWO_COLUMNS)
		const { io, sent } = fakeIo([
			{ id: "wren-w", userId: wren.id, interest: [`${EVENT}#${w.id}`] },
			{ id: "ash-a", userId: ash.id, interest: [`${EVENT}#${a.id}`] },
			{ id: "ash-chat", userId: ash.id, interest: [`${EVENT}#${chat.id}`] }
		])
		const pushes = () => {
			const out = sent.filter((x) => x.event === EVENT)
			sent.length = 0
			return out
		}
		return { wren, ash, w, a, layout, io, pushes }
	}

	test(
		"sharing, renaming and stopping sharing reach every other person with a session of the genre open — not the author, not another genre",
		async () => {
			const s = await twoPeople()
			expect((await shareAs(s.wren.id, s.w.id, s.layout.id, "shared", s.io)).ok).toBe(true)
			let pushes = s.pushes()
			expect(pushes.map((x) => x.to)).toEqual(["ash-a"])
			const card = pushes[0].payload.presets.find((p: any) => p.id === s.layout.id)
			expect(card).toMatchObject({ name: "Harbour watch", mine: false, visibility: "shared" })
			expect(pushes[0].payload.sessionId).toBe(s.a.id)

			// Ash starts from it; Wren renames it: Ash's card and line follow.
			expect((await startFrom(s.ash.id, s.a.id, s.layout.id)).ok).toBe(true)
			expect((await renameAs(s.wren.id, s.layout.id, "Harbour lights", s.io)).ok).toBe(true)
			pushes = s.pushes()
			expect(pushes.map((x) => x.to)).toEqual(["ash-a"])
			expect(pushes[0].payload.presets.find((p: any) => p.id === s.layout.id).name).toBe(
				"Harbour lights"
			)
			expect(pushes[0].payload.startedFromLayoutPresetId).toBe(s.layout.id)

			// Stop sharing: the card leaves Ash's list; Ash's session keeps its copy.
			expect((await shareAs(s.wren.id, s.w.id, s.layout.id, "private", s.io)).ok).toBe(true)
			pushes = s.pushes()
			expect(pushes.map((x) => x.to)).toEqual(["ash-a"])
			expect(pushes[0].payload.presets.some((p: any) => p.id === s.layout.id)).toBe(false)
			expect((await get(s.ash.id, s.a.id)).layout).toEqual(TWO_COLUMNS)

			// A private layout renamed is nobody else's business: no push.
			expect((await renameAs(s.wren.id, s.layout.id, "Harbour dark", s.io)).ok).toBe(true)
			expect(s.pushes()).toEqual([])
		},
		60_000
	)

	test(
		"deleting a shared layout takes its card and the started-from line away from the people who had it",
		async () => {
			const s = await twoPeople()
			expect((await shareAs(s.wren.id, s.w.id, s.layout.id, "shared", s.io)).ok).toBe(true)
			expect((await startFrom(s.ash.id, s.a.id, s.layout.id)).ok).toBe(true)
			s.pushes()
			expect((await deleteAs(s.wren.id, s.layout.id, s.io)).ok).toBe(true)
			const pushes = s.pushes()
			expect(pushes.map((x) => x.to)).toEqual(["ash-a"])
			expect(pushes[0].payload.presets.some((p: any) => p.id === s.layout.id)).toBe(false)
			expect(pushes[0].payload.startedFromLayoutPresetId).toBeNull()
			expect(pushes[0].payload.startedFromUpdated).toBe(false)
		},
		60_000
	)

	test(
		"an admin who stops sharing someone's layout: the author hears it, the admin's own answer covers the admin",
		async () => {
			const s = await twoPeople()
			expect((await shareAs(s.wren.id, s.w.id, s.layout.id, "shared", s.io)).ok).toBe(true)
			s.pushes()
			const admin = await user("admin")
			const own = await sessionOf(admin.id)
			await get(admin.id, own.id)
			const res = await shareAs(admin.id, own.id, s.layout.id, "private", s.io, true)
			expect(res.ok).toBe(true)
			const pushes = s.pushes()
			expect(pushes.map((x) => x.to).sort()).toEqual(["ash-a", "wren-w"])
			const toWren = pushes.find((x) => x.to === "wren-w")!.payload
			expect(toWren.presets.find((p: any) => p.id === s.layout.id)).toMatchObject({
				mine: true,
				visibility: "private"
			})
		},
		60_000
	)

	test(
		"nobody watching: nothing is read or built",
		async () => {
			const s = await twoPeople()
			const { __startedFromPushBuildsForTests } = await import(
				"$lib/server/sessions/startedFromPush"
			)
			const nobody = fakeIo([
				{ id: "ash-a", userId: s.ash.id, interest: [`sessions:get#${s.a.id}`] }
			])
			const builds = __startedFromPushBuildsForTests()
			expect((await shareAs(s.wren.id, s.w.id, s.layout.id, "shared", nobody.io)).ok).toBe(
				true
			)
			expect(nobody.sent).toEqual([])
			expect(__startedFromPushBuildsForTests()).toBe(builds)
		},
		60_000
	)
})
