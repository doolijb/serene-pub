/**
 * Per-instance widget settings ride the per-user layout round trip (PLAN 25).
 *
 * Pinned here: settings come back keyed by widget id; an absent key leaves the
 * stored rows alone (the property that stops the surface manager's debounced
 * blob save from clearing them); a widget whose deviations are empty gets no
 * row at all; and one user's settings are invisible to another.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
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

const GENRE = "core:genre/chat"

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noopEmit = () => {}

let n = 0

async function scenario() {
	const k = n++
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `ws-owner-${k}`)
	const guest = await createTestUser(testDb, `ws-guest-${k}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, genreId: GENRE })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id, isPlayer: true })
	return { owner, guest, session }
}

const handlers = () => import("./sessions")

const rows = (sessionId: number) =>
	testDb
		.select()
		.from(schema.widgetSettings)
		.where(eq(schema.widgetSettings.sessionId, sessionId))

describe("sessions:panelLayout — widget settings", () => {
	test("a fresh session has none", async () => {
		const s = await scenario()
		const { sessionsPanelLayoutGetHandler } = await handlers()
		const res = await sessionsPanelLayoutGetHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		expect(res.widgetSettings).toEqual({})
	})

	test("what is set comes back keyed by widget id", async () => {
		const s = await scenario()
		const { sessionsPanelLayoutSetHandler, sessionsPanelLayoutGetHandler } =
			await handlers()
		await sessionsPanelLayoutSetHandler.handler(
			fakeSocket(s.owner.id),
			{
				sessionId: s.session.id,
				layout: {},
				widgetSettings: { phone: { title: "Burner", lane: 3 } }
			} as any,
			noopEmit
		)
		const res = await sessionsPanelLayoutGetHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		expect(res.widgetSettings).toEqual({
			phone: { title: "Burner", lane: 3 }
		})
	})

	test("a widget with no deviations gets no row", async () => {
		const s = await scenario()
		const { sessionsPanelLayoutSetHandler } = await handlers()
		await sessionsPanelLayoutSetHandler.handler(
			fakeSocket(s.owner.id),
			{
				sessionId: s.session.id,
				layout: {},
				widgetSettings: { phone: {}, notes: { title: "Scratch" } }
			} as any,
			noopEmit
		)
		expect((await rows(s.session.id)).map((r) => r.widgetSlug)).toEqual([
			"notes"
		])
	})

	test("a blob-only set leaves the stored settings alone", async () => {
		const s = await scenario()
		const { sessionsPanelLayoutSetHandler, sessionsPanelLayoutGetHandler } =
			await handlers()
		const socket = fakeSocket(s.owner.id)
		await sessionsPanelLayoutSetHandler.handler(
			socket,
			{
				sessionId: s.session.id,
				layout: {},
				widgetSettings: { phone: { title: "Burner" } }
			} as any,
			noopEmit
		)
		await sessionsPanelLayoutSetHandler.handler(
			socket,
			{ sessionId: s.session.id, layout: { a: 1 } } as any,
			noopEmit
		)
		const res = await sessionsPanelLayoutGetHandler.handler(
			socket,
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		expect(res.widgetSettings).toEqual({ phone: { title: "Burner" } })
	})

	test("settings are per user, not per session", async () => {
		const s = await scenario()
		const { sessionsPanelLayoutSetHandler, sessionsPanelLayoutGetHandler } =
			await handlers()
		await sessionsPanelLayoutSetHandler.handler(
			fakeSocket(s.owner.id),
			{
				sessionId: s.session.id,
				layout: {},
				widgetSettings: { phone: { title: "Mine" } }
			} as any,
			noopEmit
		)
		const res = await sessionsPanelLayoutGetHandler.handler(
			fakeSocket(s.guest.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		expect(res.widgetSettings).toEqual({})
	})

	test("a settings payload that is not an object of objects is refused", async () => {
		const s = await scenario()
		const { sessionsPanelLayoutSetHandler } = await handlers()
		const res = await sessionsPanelLayoutSetHandler.handler(
			fakeSocket(s.owner.id),
			{
				sessionId: s.session.id,
				layout: {},
				widgetSettings: { phone: "not an object" }
			} as any,
			noopEmit
		)
		expect(res.ok).toBe(false)
		expect(res.error).toBe("Invalid widget settings")
	})
})
