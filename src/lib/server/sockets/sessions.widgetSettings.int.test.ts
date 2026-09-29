/**
 * Per-instance widget settings ride the per-user layout round trip (PLAN 25).
 *
 * Pinned here: settings come back keyed by widget id; an absent key leaves the
 * stored rows alone (the property that stops the surface manager's debounced
 * blob save from clearing them); a widget whose deviations are empty gets no
 * row at all; and one user's settings are invisible to another.
 *
 * And, since the seating gate (2026-09-17), the key half: a key becomes a
 * `widget_slug` verbatim, so it is held to the widgets THIS session can seat —
 * core's, its genre's, an enabled plugin's. Anything else is dropped with a
 * warning rather than refused, because a stale layout naming a disabled
 * plugin's widget must not cost the user the edit they were making.
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
				widgetSettings: {
					messages: { composer: "minimal", order: "newest-first" }
				}
			} as any,
			noopEmit
		)
		const res = await sessionsPanelLayoutGetHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noopEmit
		)
		expect(res.widgetSettings).toEqual({
			messages: { composer: "minimal", order: "newest-first" }
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
				widgetSettings: { messages: {}, stats: { compact: true } }
			} as any,
			noopEmit
		)
		expect((await rows(s.session.id)).map((r) => r.widgetSlug)).toEqual([
			"stats"
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
				widgetSettings: { messages: { composer: "minimal" } }
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
		expect(res.widgetSettings).toEqual({
			messages: { composer: "minimal" }
		})
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
				widgetSettings: { messages: { composer: "writer" } }
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
				widgetSettings: { messages: "not an object" }
			} as any,
			noopEmit
		)
		expect(res.ok).toBe(false)
		expect(res.error).toBe("Invalid widget settings")
	})
})

/**
 * A session whose GENRE declares a widget, beside an enabled plugin that
 * declares one and a disabled plugin that declares another — the three
 * declarers of `seatableWidgetIds`, and the one that is not.
 */
async function gateScenario() {
	const k = n++
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `wg-owner-${k}`)

	const livePlugin = `acme.live-${k}`
	const deadPlugin = `acme.dead-${k}`
	for (const [pluginId, enabled, panelId] of [
		[livePlugin, true, "dice"],
		[deadPlugin, false, "ghost"]
	] as const)
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: pluginId,
			bundleSource: "// x",
			bundleHash: `hash-${pluginId}`,
			enabled,
			manifest: {
				surfaces: {
					panels: [
						{
							id: panelId,
							entry: `ui/${panelId}.html`,
							title: panelId
						}
					]
				}
			}
		})

	// A genre that declares one widget of its own, read back through the same
	// `getSessionGenre` the session view resolves it with.
	const definitionId = `core:inlet/gated-${k}`
	await testDb.insert(schema.pipelineDefinitionRegistry).values({
		definitionId,
		version: 1,
		kind: "inlet",
		status: "live",
		sessionShape: {
			panels: [
				{
					id: "casefile",
					title: "Case file",
					role: "secondary",
					component: "scene-portraits"
				}
			]
		}
	})

	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			genreId: `${definitionId}@1`
		})
		.returning()

	return {
		owner,
		session,
		live: `${livePlugin}:dice`,
		dead: `${deadPlugin}:ghost`
	}
}

/** Save `widgetSettings`, returning what `console.warn` said while it ran. */
async function save(
	s: Awaited<ReturnType<typeof gateScenario>>,
	widgetSettings: Record<string, Record<string, unknown>>
) {
	const { sessionsPanelLayoutSetHandler } = await handlers()
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
	try {
		const res = await sessionsPanelLayoutSetHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id, layout: {}, widgetSettings } as any,
			noopEmit
		)
		return {
			res,
			warnings: warn.mock.calls.map((c) => String(c[0]))
		}
	} finally {
		warn.mockRestore()
	}
}

const storedSlugs = async (sessionId: number) =>
	(await rows(sessionId)).map((r) => r.widgetSlug).sort()

describe("sessions:panelLayout — the widget seating gate", () => {
	test("a core widget's id is accepted", async () => {
		const s = await gateScenario()
		const { warnings } = await save(s, { messages: { composer: "writer" } })
		expect(warnings).toEqual([])
		expect(await storedSlugs(s.session.id)).toEqual(["messages"])
	})

	test("a widget the session's genre declares is accepted", async () => {
		const s = await gateScenario()
		const { warnings } = await save(s, { casefile: { open: true } })
		expect(warnings).toEqual([])
		expect(await storedSlugs(s.session.id)).toEqual(["casefile"])
	})

	test("an enabled plugin's namespaced id is accepted", async () => {
		const s = await gateScenario()
		const { warnings } = await save(s, { [s.live]: { faces: 20 } })
		expect(warnings).toEqual([])
		expect(await storedSlugs(s.session.id)).toEqual([s.live])
	})

	test("a disabled plugin's id is dropped, with a warning", async () => {
		const s = await gateScenario()
		const { res, warnings } = await save(s, { [s.dead]: { spooky: true } })
		// Dropped, never refused: the save itself succeeds.
		expect(res.ok).toBe(true)
		expect(res.error).toBeUndefined()
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain(s.dead)
		expect(warnings[0]).toContain(String(s.session.id))
		expect(await storedSlugs(s.session.id)).toEqual([])
	})

	test("an id nothing declares is dropped", async () => {
		const s = await gateScenario()
		const { res, warnings } = await save(s, { foo: { anything: 1 } })
		expect(res.ok).toBe(true)
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain("foo")
		expect(await storedSlugs(s.session.id)).toEqual([])
	})

	/**
	 * The exemption (ruled 2026-09-17). A disable deletes nothing, so neither
	 * may the gate: the row below is the one a save made while the plugin was
	 * still enabled, and the layout that echoes it back must write it again
	 * rather than lose it.
	 */
	test("a disabled plugin's key with a stored row survives", async () => {
		const s = await gateScenario()
		await testDb.insert(schema.widgetSettings).values({
			sessionId: s.session.id,
			userId: s.owner.id,
			widgetSlug: s.dead,
			values: { spooky: true }
		})
		const { warnings } = await save(s, { [s.dead]: { spooky: true } })
		expect(warnings).toEqual([])
		const [row] = await rows(s.session.id)
		expect(row.widgetSlug).toBe(s.dead)
		expect(row.values).toEqual({ spooky: true })
	})

	/**
	 * And the other side of it: the exemption is about a key that is PRESENT
	 * and unseatable. A key the client leaves OUT is still the user clearing
	 * that widget's settings, and the sweep still takes it.
	 */
	test("a key the client omits is still swept", async () => {
		const s = await gateScenario()
		await save(s, {
			messages: { composer: "minimal" },
			stats: { compact: true }
		})
		expect(await storedSlugs(s.session.id)).toEqual(["messages", "stats"])
		const { warnings } = await save(s, { messages: { composer: "minimal" } })
		expect(warnings).toEqual([])
		expect(await storedSlugs(s.session.id)).toEqual(["messages"])
	})

	test("the accepted keys still land beside a dropped one", async () => {
		const s = await gateScenario()
		const { warnings } = await save(s, {
			messages: { composer: "minimal" },
			casefile: { open: true },
			[s.live]: { faces: 6 },
			[s.dead]: { spooky: true },
			foo: { anything: 1 }
		})
		expect(warnings).toHaveLength(2)
		expect(await storedSlugs(s.session.id)).toEqual(
			["messages", "casefile", s.live].sort()
		)
	})
})
