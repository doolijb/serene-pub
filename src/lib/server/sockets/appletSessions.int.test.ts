/**
 * 🚧 (M2c) The applet's session doors over a real (in-memory) DB: list ∩ the
 * package's own genres ∩ the person's own sessions; update through
 * `sessions:update` with the extension in the ledger cause; create / delete
 * `fromApplet` judged first, unchanged without it. A manifest that names a CORE
 * genre is clamped out by `ownGenres`.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let db: TestDb
let a: number
let b: number
let guest: number

const GENRE = "acme.games:genre/sim"
const OTHER = "acme.other:genre/sim"
const CORE = "core:genre/story"
const ledger: any[] = []

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// The plugin's genre declares one field; everything else is the real registry.
vi.mock("$lib/server/pipelines/entities/sessionGenres", async (importOriginal) => {
	const orig: any = await importOriginal()
	return {
		...orig,
		getSessionGenre: async (d: any, id: string) =>
			id === "acme.games:genre/sim"
				? { genreId: id, name: "Sim", shape: { fields: { difficulty: { type: "string", label: "Difficulty" } } } }
				: orig.getSessionGenre(d, id)
	}
})
vi.mock("$lib/server/pipelines/runtime/sessionEvents", async (importOriginal) => {
	const orig: any = await importOriginal()
	return {
		...orig,
		emitSessionEvent: async (d: any, opts: any) => {
			ledger.push(opts)
			return orig.emitSessionEvent(d, opts)
		}
	}
})

async function plugin(pluginId: string, permissions: unknown, enabled = true) {
	const { reviewMarks, declaredPermissions } = await import("$lib/server/plugins/permissions")
	const manifest = { permissions } as any
	await db.insert(schema.plugins).values({
		pluginId,
		name: pluginId,
		bundleSource: "// x",
		bundleHash: `h-${pluginId}`,
		enabled,
		manifest,
		adminDenied: reviewMarks(declaredPermissions(manifest))
	})
}

const session = async (userId: number, genreId: string, extra: Record<string, unknown> = {}) =>
	(await db.insert(schema.sessions).values({ userId, isGroup: false, genreId, ...extra } as any).returning())[0]

beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	db = (await import("$lib/server/db")).db as unknown as TestDb
	;[{ id: a }, { id: b }, { id: guest }] = await db
		.insert(schema.users)
		.values([{ username: "as-a" }, { username: "as-b" }, { username: "as-guest" }])
		.returning({ id: schema.users.id })
	const sessions = { genres: [GENRE] }
	await plugin("acme.games", { applet: { sessions, lorebooks: "read" } })
	await plugin("acme.nobooks", { applet: { sessions: { genres: ["acme.nobooks:genre/sim"] } } })
	await plugin("acme.core", { applet: { sessions: { genres: [CORE, OTHER] }, lorebooks: "read" } })
	await plugin("acme.nogrant", {})
	await plugin("acme.off", { applet: { sessions } }, false)
}, 120_000)

async function call(handlerName: "pluginsLibrarySessions" | "pluginsUpdateSession", userId: number, params: any) {
	const mod: any = await import("./appletSessions")
	const events: { event: string; data: any }[] = []
	const socket = { user: { id: userId, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } } as any
	try {
		const res = await mod[handlerName].handler(socket, params, (event: string, data: any) => events.push({ event, data }))
		return { res, events }
	} catch (e: any) {
		return { error: e as Error, events }
	}
}
const list = (u: number, p: any) => call("pluginsLibrarySessions", u, { pluginId: "acme.games", ...p })
const update = (u: number, p: any) => call("pluginsUpdateSession", u, { pluginId: "acme.games", ...p })

describe("appletApi:librarySessions", () => {
	test("own genre ∩ own sessions, newest first; others never", async () => {
		const mine1 = await session(a, GENRE, { name: "one" })
		await new Promise((r) => setTimeout(r, 5))
		const mine2 = await session(a, GENRE, { name: "two" })
		const theirs = await session(b, GENRE, { name: "theirs" })
		const foreign = await session(a, OTHER, { name: "foreign" })
		const core = await session(a, CORE, { name: "core" })
		const r = await list(a, { requestId: "q1" })
		const ids = (r.res as any).result.rows.map((x: any) => x.id)
		expect(ids).toEqual([mine2.id, mine1.id])
		expect(ids).not.toContain(theirs.id)
		expect(ids).not.toContain(foreign.id)
		expect(ids).not.toContain(core.id)
		expect((r.res as any)).toMatchObject({ pluginId: "acme.games", requestId: "q1" })
		expect((r.res as any).result.rows[0]).toMatchObject({ name: "two", genreId: GENRE })
		// a guest in someone else's session never sees it in a list
		await db.insert(schema.sessionGuests).values({ sessionId: theirs.id, userId: guest } as any)
		expect((await list(guest, {})).res).toMatchObject({ result: { rows: [] } })
		// paging
		const p1 = await list(a, { limit: 1 })
		const c = (p1.res as any).result
		expect(c.rows.map((x: any) => x.id)).toEqual([mine2.id])
		const p2 = await list(a, { limit: 1, cursor: c.nextCursor })
		expect((p2.res as any).result.rows.map((x: any) => x.id)).toEqual([mine1.id])
		expect((p2.res as any).result.nextCursor).toBeUndefined()
		expect((await list(a, { cursor: "garbage" })).error).toBeTruthy()
	})

	test("refused: a foreign or core genre, no grant, plugin off, signed out", async () => {
		expect((await list(a, { genre: OTHER })).error).toBeTruthy()
		expect((await list(a, { genre: CORE })).error).toBeTruthy()
		for (const pluginId of ["acme.nogrant", "acme.off", "acme.missing"]) {
			const r = await call("pluginsLibrarySessions", a, { pluginId })
			expect(r.error, pluginId).toBeTruthy()
			expect(r.events.some((e) => e.event === "appletApi:librarySessions:error")).toBe(true)
		}
	})

	test("a manifest naming a CORE genre is clamped out", async () => {
		const core = await session(a, CORE, { name: "core-mine" })
		const r = await call("pluginsLibrarySessions", a, { pluginId: "acme.core" })
		expect(r.error?.message).toMatch(/not been given leave/)
		const one = await call("pluginsLibrarySessions", a, { pluginId: "acme.core", sessionId: core.id })
		expect(one.error).toBeTruthy()
	})

	test("sessionId: one row when owned and own-genre, else refused", async () => {
		const mine = await session(a, GENRE, { name: "pick" })
		const theirs = await session(b, GENRE)
		const foreign = await session(a, OTHER)
		const ok = await list(a, { sessionId: mine.id })
		expect((ok.res as any).result.rows).toHaveLength(1)
		expect((ok.res as any).result.rows[0].id).toBe(mine.id)
		for (const id of [theirs.id, foreign.id, 999999]) {
			const r = await list(a, { sessionId: id })
			expect(r.error?.message, String(id)).toBe("That session is not one this extension can reach.")
		}
		// a guest of someone else's session is not its owner
		await db.insert(schema.sessionGuests).values({ sessionId: theirs.id, userId: a } as any).onConflictDoNothing()
		expect((await list(a, { sessionId: theirs.id })).error).toBeTruthy()
	})
})

describe("appletApi:updateSession", () => {
	test("name + a declared field + attach / detach a readable book; the ledger names the extension", async () => {
		const s = await session(a, GENRE, { name: "old" })
		const [book] = await db.insert(schema.lorebooks).values({ userId: a, name: "Atlas" } as any).returning()
		ledger.length = 0
		const r = await update(a, { sessionId: s.id, name: "new", fields: { difficulty: "hard" }, requestId: "u1" })
		expect(r.error?.message).toBeUndefined()
		expect((r.res as any)).toMatchObject({ pluginId: "acme.games", requestId: "u1", result: { id: s.id, name: "new", genreId: GENRE } })
		const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, s.id))
		expect(row.genreFields).toMatchObject({ difficulty: "hard" })
		const updated = ledger.find((l) => l.payload?.changed?.includes("name"))
		expect(updated.payload.cause).toEqual({ kind: "settings", userId: a, pluginId: "acme.games" })

		const attach = await update(a, { sessionId: s.id, lorebookId: book.id })
		expect(attach.error?.message).toBeUndefined()
		expect((await db.select().from(schema.sessions).where(eq(schema.sessions.id, s.id)))[0].lorebookId).toBe(book.id)
		const detach = await update(a, { sessionId: s.id, lorebookId: null })
		expect(detach.error?.message).toBeUndefined()
		expect((await db.select().from(schema.sessions).where(eq(schema.sessions.id, s.id)))[0].lorebookId).toBeNull()
	})

	test("refused: not owner, foreign genre, undeclared field, unreadable book, no lorebooks grant", async () => {
		const mine = await session(a, GENRE, { name: "keep" })
		const theirs = await session(b, GENRE, { name: "keep" })
		const foreign = await session(a, OTHER, { name: "keep" })
		const [theirBook] = await db.insert(schema.lorebooks).values({ userId: b, name: "Private" } as any).returning()
		expect((await update(a, { sessionId: theirs.id, name: "x" })).error).toBeTruthy()
		expect((await update(a, { sessionId: foreign.id, name: "x" })).error).toBeTruthy()
		expect((await update(a, { sessionId: mine.id, fields: { pipelineId: "x" } })).error?.message).toMatch(/not a field/)
		expect((await update(a, { sessionId: mine.id, lorebookId: theirBook.id })).error).toBeTruthy()
		const nobooks = await call("pluginsUpdateSession", a, { pluginId: "acme.nobooks", sessionId: mine.id, name: "x" })
		expect(nobooks.error).toBeTruthy() // its genre list does not include this session's genre
		const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, mine.id))
		expect(row.name).toBe("keep")
		expect((await call("pluginsUpdateSession", a, { pluginId: "acme.off", sessionId: mine.id, name: "x" })).error).toBeTruthy()
		expect((await call("pluginsUpdateSession", a, { pluginId: "acme.nogrant", sessionId: mine.id, name: "x" })).error).toBeTruthy()
		const [again] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, mine.id))
		expect(again.name).toBe("keep")
	})

	test("a plugin without the lorebooks grant cannot attach a book", async () => {
		await plugin("acme.nobooks2", { applet: { sessions: { genres: ["acme.nobooks2:genre/sim"] } } })
		const s = await session(a, "acme.nobooks2:genre/sim", { name: "x" })
		const [book] = await db.insert(schema.lorebooks).values({ userId: a, name: "Mine" } as any).returning()
		const r = await call("pluginsUpdateSession", a, { pluginId: "acme.nobooks2", sessionId: s.id, lorebookId: book.id })
		expect(r.error?.message).toMatch(/not been given the person's lorebooks/)
	})
})

describe("sessions:create / sessions:delete fromApplet", () => {
	const socketFor = (userId: number) => ({ user: { id: userId, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } }) as any

	test("create: refusals come before any row; without fromApplet nothing changed", async () => {
		const { appletCreateRefusal } = await import("./appletSessions")
		const base = { characterIds: [], personaIds: [], characterPositions: {} }
		const refuse = (session: any, extra: any = {}) =>
			appletCreateRefusal(db as any, a, { ...base, session, fromApplet: { pluginId: "acme.games" }, ...extra } as any)
		expect(await refuse({ genreId: OTHER })).toMatch(/not one of this extension's genres/)
		expect(await refuse({ genreId: CORE })).toMatch(/not one of this extension's genres/)
		expect(await refuse({ genreId: GENRE, genreFields: { pipelineId: "x" } })).toMatch(/not a field/)
		expect(await refuse({ genreId: GENRE }, { mode: "branch", from: 1 })).toMatch(/new session/)
		const [theirBook] = await db.insert(schema.lorebooks).values({ userId: b, name: "Nope" } as any).returning()
		expect(await refuse({ genreId: GENRE, lorebookId: theirBook.id })).toBeTruthy()
		expect(await refuse({ genreId: GENRE, genreFields: { difficulty: "easy" } })).toBeNull()
		const before = (await db.select().from(schema.sessions).where(eq(schema.sessions.userId, a))).length
		const { sessionsCreateHandler } = await import("./sessions")
		const events: any[] = []
		const res: any = await sessionsCreateHandler.handler(
			socketFor(a),
			{ ...base, session: { genreId: OTHER, name: "x" }, fromApplet: { pluginId: "acme.games" } } as any,
			(event: string, data: any) => events.push({ event, data })
		)
		expect(res.error).toMatch(/not one of this extension's genres/)
		expect(events.some((e) => e.event === "sessions:create:error")).toBe(true)
		expect((await db.select().from(schema.sessions).where(eq(schema.sessions.userId, a))).length).toBe(before)
		// without fromApplet the same draft is judged by today's path (an unknown genre is refused there, in its own words)
		const plain: any = await sessionsCreateHandler.handler(
			socketFor(a),
			{ ...base, session: { genreId: "nope:genre/none", name: "x" } } as any,
			() => {}
		)
		expect(plain.error).toMatch(/not a session mode this build registers/)
	})

	test("delete: wrong genre or someone else's refused; own-genre own session goes; plain delete unchanged", async () => {
		const { sessionsDeleteHandler } = await import("./sessions")
		const mine = await session(a, GENRE)
		const foreign = await session(a, OTHER)
		const theirs = await session(b, GENRE)
		const del = async (id: number, fromApplet?: { pluginId: string }) => {
			const events: any[] = []
			let res: any
			let error: any
			try {
				res = await sessionsDeleteHandler.handler(socketFor(a), { id, ...(fromApplet ? { fromApplet } : {}) } as any, (event: string, data: any) => events.push({ event, data }))
			} catch (e) {
				error = e
			}
			return { res, error, events }
		}
		const exists = async (id: number) => (await db.select().from(schema.sessions).where(eq(schema.sessions.id, id))).length === 1
		for (const id of [foreign.id, theirs.id]) {
			const r = await del(id, { pluginId: "acme.games" })
			expect(r.res?.error).toBe("That session is not one this extension can reach.")
			expect(await exists(id)).toBe(true)
		}
		const ok = await del(mine.id, { pluginId: "acme.games" })
		expect(ok.res).toMatchObject({ id: mine.id })
		expect(await exists(mine.id)).toBe(false)
		// today's path: the owner deletes a session of any genre; a non-owner is refused as before
		expect((await del(foreign.id)).res).toMatchObject({ id: foreign.id })
		expect((await del(theirs.id)).error).toBeTruthy()
		expect(await exists(theirs.id)).toBe(true)
	})
})
