/**
 * The per-user surface-grid layout row (plan 21 §10). Proven here: get returns
 * an empty blob before anything is saved, set persists it verbatim (one row per
 * user+session, upsert), a second user's layout is independent, and both are
 * gated by session access like every other session read/write.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
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

afterAll(() => {})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId }, io: { to: () => ({ emit: () => {} }) } } as any
}
const noopEmit = () => {}

let n = 0

async function scenario() {
	const k = n++
	const owner = await makeUser(`pl-owner-${k}`)
	const guest = await makeUser(`pl-guest-${k}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id, isPlayer: true })
	return { owner, guest, session }
}

describe("sessions:panelLayout", () => {
	test("get is empty before any save", async () => {
		const { sessionsPanelLayoutGetHandler } = await import("./sessions")
		const s = await scenario()
		const res = await sessionsPanelLayoutGetHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		expect(res.layout).toEqual({})
	})

	test("set persists verbatim and get reads it back", async () => {
		const { sessionsPanelLayoutGetHandler, sessionsPanelLayoutSetHandler } =
			await import("./sessions")
		const s = await scenario()
		const blob = {
			active: [{ id: "sample-map", on: true, drawered: false, order: 1 }],
			tierSizeOverrides: { wide: [2, 1, 1, 1] }
		}
		const set = await sessionsPanelLayoutSetHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id, layout: blob } as any,
			noopEmit
		)
		expect(set.ok).toBe(true)

		const got = await sessionsPanelLayoutGetHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		expect(got.layout).toEqual(blob)
	})

	test("set upserts — a second save overwrites the same row", async () => {
		const { sessionsPanelLayoutGetHandler, sessionsPanelLayoutSetHandler } =
			await import("./sessions")
		const s = await scenario()
		for (const order of [1, 2, 3])
			await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					layout: { active: [{ id: "x", order }] }
				} as any,
				noopEmit
			)
		const got = await sessionsPanelLayoutGetHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		expect(got.layout).toEqual({ active: [{ id: "x", order: 3 }] })
		const rows = await testDb
			.select()
			.from(schema.sessionPanelLayouts)
		expect(
			rows.filter(
				(r) => r.sessionId === s.session.id && r.userId === s.owner.id
			)
		).toHaveLength(1)
	})

	test("each participant has an independent layout", async () => {
		const { sessionsPanelLayoutGetHandler, sessionsPanelLayoutSetHandler } =
			await import("./sessions")
		const s = await scenario()
		await sessionsPanelLayoutSetHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id, layout: { active: [{ id: "owner" }] } } as any,
			noopEmit
		)
		await sessionsPanelLayoutSetHandler.handler(
			fakeSocket(s.guest.id),
			{ sessionId: s.session.id, layout: { active: [{ id: "guest" }] } } as any,
			noopEmit
		)
		const ownerGot = await sessionsPanelLayoutGetHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		const guestGot = await sessionsPanelLayoutGetHandler.handler(
			fakeSocket(s.guest.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		expect(ownerGot.layout).toEqual({ active: [{ id: "owner" }] })
		expect(guestGot.layout).toEqual({ active: [{ id: "guest" }] })
	})

	test(
		"set refuses a layout the app cannot draw and writes nothing — not even the keys sent with it",
		async () => {
			const { sessionsPanelLayoutGetHandler, sessionsPanelLayoutSetHandler } =
				await import("./sessions")
			const { LAYOUT_PRESET_CANT_SAVE } = await import(
				"$lib/server/db/layoutPresets"
			)
			const s = await scenario()
			const good = {
				panels: {
					version: 1,
					left: [],
					middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] },
					right: [{ key: "p2", tabs: ["stats"], pinned: false }]
				}
			}
			const pins = { widgetStyles: { stats: { id: 1, slug: "mine" } } }
			const first = await sessionsPanelLayoutSetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id, layout: good, layoutSettings: pins } as any,
				noopEmit
			)
			expect(first.ok).toBe(true)
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
			const bad = [
				// One instance in two panels.
				{
					panels: {
						...good.panels,
						right: [{ key: "p2", tabs: ["messages"] }]
					}
				},
				// A middle panel never pins; a primary needs a tab.
				{
					panels: {
						...good.panels,
						middle: { above: [], primary: { key: "p1", tabs: [], pinned: false }, below: [] }
					}
				},
				// An old slot of the wrong shape.
				{ zoneLayout: { version: 2 } }
			]
			try {
				for (const layout of bad) {
					const res = await sessionsPanelLayoutSetHandler.handler(
						fakeSocket(s.owner.id),
						{ sessionId: s.session.id, layout, layoutSettings: {} } as any,
						noopEmit
					)
					expect(res.ok).toBe(false)
					expect(res.error).toBe(LAYOUT_PRESET_CANT_SAVE)
				}
			} finally {
				warn.mockRestore()
			}
			const got = await sessionsPanelLayoutGetHandler.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id } as any,
				noopEmit
			)
			expect(got.layout).toEqual(good)
			expect(got.layoutSettings).toEqual(pins)
		},
		60_000
	)

	test("a stranger is refused both get and set", async () => {
		const { sessionsPanelLayoutGetHandler, sessionsPanelLayoutSetHandler } =
			await import("./sessions")
		const s = await scenario()
		const stranger = await makeUser(`pl-stranger-${n}`)
		const got = await sessionsPanelLayoutGetHandler.handler(
			fakeSocket(stranger.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		expect(got.layout).toEqual({})
		const set = await sessionsPanelLayoutSetHandler.handler(
			fakeSocket(stranger.id),
			{ sessionId: s.session.id, layout: { active: [] } } as any,
			noopEmit
		)
		expect(set.ok).toBe(false)
		expect(set.error).toBeTruthy()
	})
})
