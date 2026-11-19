/**
 * A reply's compiled prompt (`debugMeta`) is an administrator's who is in the
 * session, as its owner or as a guest. The session's owner who is not an
 * administrator is sent none (they keep scene text).
 *
 * Owner rulings — G5 (2026-11-16): "The session's owner and administrators
 * only." G6 (2026-11-16): "In another person's session an administrator is a
 * guest." D64 (2026-11-17): "we shouldn't allow non admins to see the full
 * diags anyway". DG1 (2026-11-17): "Regular users see the error and a basic
 * generic user friendly description of the problem".
 *
 * Every closed path is asserted on the serialised payload: nothing the
 * sentinels spell is in what a non-administrator is sent.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { withoutDebugMeta } from "$lib/server/messages/debugMeta"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "debug-meta-test-secret" }
})

// The reply road is not run here: regenerate and extend send the row, then
// start a run, and only the row they sent is under test.
vi.mock("$lib/server/utils/runReply", () => ({ runReply: async () => ({}) }))

const PROMPT = "<SENTINEL-PROMPT>"
const MESSAGE = "<SENTINEL-MESSAGE>"
// DG2: the token count rides in the prompt's own report, so it is read by
// the same decision; the sentinel is asserted absent with the prompt.
const COUNT = 7771
const DEBUG_META = {
	prompt: PROMPT,
	messages: [{ role: "system", content: MESSAGE }],
	meta: { tokenCounts: { total: COUNT, limit: 8882 } }
}
const noLeak = (reply: unknown) => {
	const text = JSON.stringify(reply)
	expect(text).not.toContain(PROMPT)
	expect(text).not.toContain(MESSAGE)
	expect(text).not.toContain(String(COUNT))
	expect(text).not.toContain("tokenCounts")
}

let testDb: TestDb
let dataDir: string
let owner: { id: number }
let guest: { id: number }
let adminGuest: { id: number }
let adminOutside: { id: number }
let sessionId: number
let rows: Array<typeof schema.sessionMessages.$inferSelect>
let replyId: number

const socketFor = (userId: number, isAdmin = false) =>
	({
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any
const asOwner = () => socketFor(owner.id)
const asGuest = () => socketFor(guest.id)
const asAdminGuest = () => socketFor(adminGuest.id, true)

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-debug-meta-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	// The edit test runs the `edit` built-in, which needs the pipelines.
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	owner = await createTestUser(testDb, "dm-owner")
	guest = await createTestUser(testDb, "dm-guest")
	adminGuest = await createTestUser(testDb, "dm-admin-guest")
	adminOutside = await createTestUser(testDb, "dm-admin-outside")
	await testDb
		.update(schema.users)
		.set({ isAdmin: true })
		.where(inArray(schema.users.id, [adminGuest.id, adminOutside.id]))
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true } as any)
		.returning()
	sessionId = session!.id
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId, userId: guest.id },
		{ sessionId, userId: adminGuest.id }
	] as any)
	rows = await testDb
		.insert(schema.sessionMessages)
		.values(
			Array.from({ length: 6 }, (_, i) => ({
				sessionId,
				userId: owner.id,
				role: i % 2 ? "assistant" : "user",
				content: `line ${i + 1}`,
				channel: "main",
				debugMeta: i === 3 ? DEBUG_META : null
			})) as any
		)
		.returning()
	replyId = rows[3]!.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const strippedOf = (row: any) => ({ ...row, debugMeta: null })
const byId = (list: any[]) =>
	Object.fromEntries(list.map((r) => [r.id, r])) as Record<number, any>

async function messagesPage(socket: any, extra: object = {}) {
	const { sessionsMessagesPageHandler } = await import("./sessions")
	return (await sessionsMessagesPageHandler.handler(
		socket,
		{ sessionId, ...extra } as any,
		() => {}
	)) as any
}
async function sessionsGet(socket: any, extra: object = {}) {
	const { sessionsGetHandler } = await import("./sessions")
	return (await sessionsGetHandler.handler(
		socket,
		{ id: sessionId, ...extra } as any,
		() => {}
	)) as any
}
async function messageById(socket: any) {
	const { sessionMessageHandler } = await import("./sessions")
	return (await sessionMessageHandler.handler(
		socket,
		{ id: replyId } as any,
		() => {}
	)) as any
}

describe("an owner who is not an administrator is not sent the prompt", () => {
	test("sessions:messagesPage", async () => {
		const res = await messagesPage(asOwner())
		noLeak(res)
		expect(res.rows).toHaveLength(6)
		expect(byId(res.rows)[replyId].debugMeta).toBeNull()
	})
	test("sessions:get, first page and a beforeId page", async () => {
		const first = await sessionsGet(asOwner())
		noLeak(first)
		expect(byId(first.messages)[replyId].debugMeta).toBeNull()
		const page = await sessionsGet(asOwner(), { beforeId: replyId + 1, limit: 5 })
		noLeak(page)
		expect(byId(page.messages)[replyId].debugMeta).toBeNull()
	})
	test("sessionMessage by id", async () => {
		const res = await messageById(asOwner())
		noLeak(res)
		expect(res.sessionMessage.content).toBe("line 4")
	})
})

describe("an administrator who owns the session reads the prompt", () => {
	let ownSessionId: number
	let ownReplyId: number
	let ownerAdmin: { id: number }
	beforeAll(async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		ownerAdmin = await createTestUser(testDb, "dm-owner-admin")
		await testDb
			.update(schema.users)
			.set({ isAdmin: true })
			.where(inArray(schema.users.id, [ownerAdmin.id]))
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: ownerAdmin.id, isGroup: true } as any)
			.returning()
		ownSessionId = session!.id
		const [row] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: ownSessionId,
				userId: ownerAdmin.id,
				role: "assistant",
				content: "own reply",
				channel: "main",
				debugMeta: DEBUG_META
			} as any)
			.returning()
		ownReplyId = row!.id
	})
	const asOwnerAdmin = () => socketFor(ownerAdmin.id, true)

	test("sessions:messagesPage, sessions:get and sessionMessage by id", async () => {
		const { sessionsMessagesPageHandler, sessionsGetHandler, sessionMessageHandler } =
			await import("./sessions")
		const page = (await sessionsMessagesPageHandler.handler(
			asOwnerAdmin(),
			{ sessionId: ownSessionId } as any,
			() => {}
		)) as any
		expect(byId(page.rows)[ownReplyId].debugMeta).toEqual(DEBUG_META)
		const got = (await sessionsGetHandler.handler(
			asOwnerAdmin(),
			{ id: ownSessionId } as any,
			() => {}
		)) as any
		expect(byId(got.messages)[ownReplyId].debugMeta).toEqual(DEBUG_META)
		const one = (await sessionMessageHandler.handler(
			asOwnerAdmin(),
			{ id: ownReplyId } as any,
			() => {}
		)) as any
		expect(one.sessionMessage.debugMeta).toEqual(DEBUG_META)
	})

	// Accounts off: the one person is signed in as the first administrator
	// (`sockets/auth.ts`), who owns the session and so keeps Prompt details.
	test("a push reaches the administrator owner with the prompt and scene text", async () => {
		const { broadcastToSessionUsers } = await import("./utils/broadcastHelpers")
		const emitted: any[] = []
		const rooms = new Map([[`user_${ownerAdmin.id}`, new Set(["t"])]])
		const io = {
			sockets: {
				adapter: { rooms },
				sockets: new Map([
					["t", { id: "t", interest: new Set(["sessionMessage"]), user: { id: ownerAdmin.id, isAdmin: true } }]
				])
			},
			to: (to: string) => ({ emit: (_e: string, payload: any) => emitted.push({ to, payload }) })
		}
		await broadcastToSessionUsers(io as any, ownSessionId, "sessionMessage", {
			sessionMessage: { id: ownReplyId, sessionId: ownSessionId, debugMeta: DEBUG_META }
		})
		expect(emitted[0].payload.sessionMessage.debugMeta).toEqual(DEBUG_META)
	})
})

describe("an administrator who is a guest reads the prompt (D64)", () => {
	test("sessions:messagesPage, sessions:get and sessionMessage by id", async () => {
		expect(byId((await messagesPage(asAdminGuest())).rows)[replyId].debugMeta).toEqual(
			DEBUG_META
		)
		const first = await sessionsGet(asAdminGuest())
		expect(byId(first.messages)[replyId].debugMeta).toEqual(DEBUG_META)
		expect(byId(first.session.sessionMessages)[replyId].debugMeta).toEqual(
			DEBUG_META
		)
		expect((await messageById(asAdminGuest())).sessionMessage.debugMeta).toEqual(
			DEBUG_META
		)
	})
})

describe("an administrator who is not in the session", () => {
	test("is refused: no rows, no prompt", async () => {
		const asOutside = () => socketFor(adminOutside.id, true)
		const page = await messagesPage(asOutside())
		noLeak(page)
		expect(page.rows ?? []).toHaveLength(0)
		noLeak(await sessionsGet(asOutside()))
		await expect(messageById(asOutside())).rejects.toThrow("Access denied.")
	})
})

describe.each([["a guest", asGuest]])("%s is not sent the prompt", (_who, asWho) => {
	test("sessions:messagesPage: each row is the owner's with debugMeta null", async () => {
		const mine = await messagesPage(asWho())
		const theirs = await messagesPage(asOwner())
		noLeak(mine)
		expect(mine.rows).toHaveLength(6)
		expect(mine.rows).toEqual(theirs.rows.map(strippedOf))
	})

	test("sessions:get, first page and a beforeId page", async () => {
		const first = await sessionsGet(asWho())
		noLeak(first)
		const ownersFirst = await sessionsGet(asOwner())
		expect(first.messages).toEqual(ownersFirst.messages.map(strippedOf))
		expect(first.session.sessionMessages).toEqual(
			ownersFirst.session.sessionMessages.map(strippedOf)
		)
		const params = { beforeId: replyId + 1, limit: 5 }
		const page = await sessionsGet(asWho(), params)
		noLeak(page)
		const ownersPage = await sessionsGet(asOwner(), params)
		expect(page.messages.length).toBeGreaterThan(0)
		expect(page.messages).toEqual(ownersPage.messages.map(strippedOf))
	})

	test("sessionMessage by id", async () => {
		const mine = await messageById(asWho())
		noLeak(mine)
		const theirs = await messageById(asOwner())
		expect(mine.sessionMessage).toEqual(strippedOf(theirs.sessionMessage))
	})
})

describe("sessionMessages:update: the editor's own reply", () => {
	/** A line the editor may change (their own, no persona) that carries a prompt. */
	async function lineOf(userId: number) {
		const [row] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				userId,
				role: "user",
				content: "mine",
				channel: "main",
				debugMeta: DEBUG_META
			} as any)
			.returning()
		return row!
	}
	/** The later tests count the session's six rows: take the extra line out again. */
	async function drop(id: number) {
		const { eq } = await import("drizzle-orm")
		await testDb.delete(schema.messages).where(eq(schema.messages.id, id))
		await testDb.delete(schema.sessionMessages).where(eq(schema.sessionMessages.id, id))
	}
	async function edit(socket: any, id: number) {
		const { sessionMessagesUpdateHandler } = await import("./sessions")
		return (await sessionMessagesUpdateHandler.handler(
			socket,
			{ id, content: "edited" } as any,
			() => {}
		)) as any
	}

	test("a guest who edits is sent the row with debugMeta null", async () => {
		const row = await lineOf(guest.id)
		try {
			const res = await edit(asGuest(), row.id)
			expect(res.error).toBeUndefined()
			noLeak(res)
			expect(res.sessionMessage.content).toBe("edited")
			expect(res.sessionMessage.debugMeta).toBeNull()
		} finally {
			await drop(row.id)
		}
	})

	test("an owner who is not an administrator who edits is sent debugMeta null", async () => {
		const row = await lineOf(owner.id)
		try {
			const res = await edit(asOwner(), row.id)
			expect(res.error).toBeUndefined()
			noLeak(res)
			expect(res.sessionMessage.content).toBe("edited")
			expect(res.sessionMessage.debugMeta).toBeNull()
		} finally {
			await drop(row.id)
		}
	})
})

describe("withoutDebugMeta", () => {
	const plain = { id: 1, debugMeta: null }
	const noKey = { id: 2 }
	const carrying = { id: 3, debugMeta: { prompt: "p" } }
	const stripped = { id: 3, debugMeta: null }

	test("the same reference back when there is nothing to strip", () => {
		for (const payload of [
			[plain, noKey],
			[],
			{ sessionMessage: plain },
			{ rows: [plain] },
			{ messages: [noKey] },
			{ session: { sessionMessages: [plain] } },
			{ unrelated: carrying },
			null,
			"text"
		])
			expect(withoutDebugMeta(payload)).toBe(payload)
	})

	test("an array of rows", () => {
		const rowsIn = [plain, carrying]
		const out = withoutDebugMeta(rowsIn)
		expect(out).toEqual([plain, stripped])
		expect(out[0]).toBe(plain)
		expect(rowsIn[1]!.debugMeta).toEqual({ prompt: "p" })
	})
	test("{ sessionMessage }", () => {
		expect(withoutDebugMeta({ sessionMessage: carrying, x: 1 })).toEqual({
			sessionMessage: stripped,
			x: 1
		})
	})
	test("{ rows }", () => {
		expect(withoutDebugMeta({ rows: [carrying], n: 1 })).toEqual({
			rows: [stripped],
			n: 1
		})
	})
	test("{ messages } and { session: { sessionMessages } } together", () => {
		expect(
			withoutDebugMeta({
				session: { id: 9, sessionMessages: [carrying] },
				messages: [carrying]
			})
		).toEqual({
			session: { id: 9, sessionMessages: [stripped] },
			messages: [stripped]
		})
	})
	test("anything else comes back unchanged", () => {
		const other = { debugMeta: { prompt: "p" } }
		expect(withoutDebugMeta(other)).toBe(other)
	})
})

describe("a push to the session's members", () => {
	/** An `io` double: three connected tabs, each declaring interest in both events. */
	const fakeIo = () => {
		const emitted: Array<{ to: string; event: string; payload: any }> = []
		const tabs: Record<string, number> = {
			ownerTab: owner.id,
			guestTab: guest.id,
			adminTab: adminGuest.id
		}
		const sockets = new Map<string, any>()
		const rooms = new Map<string, Set<string>>()
		for (const [id, userId] of Object.entries(tabs)) {
			sockets.set(id, {
				id,
				interest: new Set(["sessionMessage", "sessions:refresh"]),
				user: { id: userId, isAdmin: userId === adminGuest.id }
			})
			rooms.set(`user_${userId}`, new Set([id]))
		}
		const io = {
			sockets: { adapter: { rooms }, sockets },
			to: (to: string) => ({
				emit: (event: string, payload: any) =>
					emitted.push({ to, event, payload })
			})
		}
		const sentTo = (id: string, event: string) =>
			emitted.find((e) => e.to === id && e.event === event)?.payload
		return { io: io as any, emitted, sentTo }
	}

	test("a sessionMessage push: the administrator guest gets the prompt; the owner and the guest a null", async () => {
		const { broadcastToSessionUsers } = await import(
			"./utils/broadcastHelpers"
		)
		const { io, sentTo } = fakeIo()
		const row = { ...rows[3]!, debugMeta: DEBUG_META }
		await broadcastToSessionUsers(io, sessionId, "sessionMessage", {
			sessionMessage: row
		})
		const ownerGot = sentTo("ownerTab", "sessionMessage")
		noLeak(ownerGot)
		expect(ownerGot.sessionMessage).toEqual(strippedOf(row))
		expect(sentTo("adminTab", "sessionMessage").sessionMessage.debugMeta).toEqual(
			DEBUG_META
		)
		const got = sentTo("guestTab", "sessionMessage")
		noLeak(got)
		expect(got.sessionMessage).toEqual(strippedOf(row))
	})

	test("a streamed chunk carrying no prompt is sent as it is, by reference", async () => {
		const { broadcastToSessionUsers } = await import(
			"./utils/broadcastHelpers"
		)
		const { io, emitted } = fakeIo()
		const chunk = { sessionMessage: { ...rows[0]!, debugMeta: null } }
		await broadcastToSessionUsers(io, sessionId, "sessionMessage", chunk)
		expect(emitted).toHaveLength(3)
		for (const e of emitted) expect(e.payload).toBe(chunk)
	})

	test("statements per push: scene text alone costs one query over an unshaped push, a prompt at most three", async () => {
		const { broadcastToSessionUsers } = await import(
			"./utils/broadcastHelpers"
		)
		const client = (testDb as any).$client
		const counting = async (fn: () => Promise<unknown>) => {
			const orig = client.query
			let n = 0
			client.query = function (...a: any[]) {
				n++
				return orig.apply(this, a)
			}
			try {
				await fn()
			} finally {
				client.query = orig
			}
			return n
		}
		const send = (payload: unknown) => async () =>
			broadcastToSessionUsers(fakeIo().io, sessionId, "sessionMessage", payload)
		await send({ sessionMessage: { ...rows[0]!, debugMeta: null } })()
		const unshaped = await counting(
			send({ sessionMessage: { ...rows[0]!, debugMeta: null } })
		)
		const sceneOnly = await counting(
			send({ sceneList: [{ id: 1, summary: "S", notes: "N" }] })
		)
		const withPrompt = await counting(
			send({ sessionMessage: { ...rows[3]!, debugMeta: DEBUG_META } })
		)
		expect(sceneOnly - unshaped).toBe(1)
		expect(withPrompt - unshaped).toBeLessThanOrEqual(3)
	})

	test("a sessions:refresh push (pushSessionToParticipants): the administrator guest with the prompt, the owner and the guest without", async () => {
		await testDb
			.update(schema.sessionMessages)
			.set({ debugMeta: DEBUG_META })
			.where((await import("drizzle-orm")).eq(schema.sessionMessages.id, replyId))
		const { pushSessionToParticipants } = await import("./sessions.shared")
		const { io, sentTo } = fakeIo()
		await pushSessionToParticipants(io, sessionId, owner.id)
		const ownerGot = sentTo("ownerTab", "sessions:refresh")
		noLeak(ownerGot)
		expect(byId(ownerGot.session.sessionMessages)[replyId].debugMeta).toBeNull()
		expect(
			byId(sentTo("adminTab", "sessions:refresh").session.sessionMessages)[replyId]
				.debugMeta
		).toEqual(DEBUG_META)
		const got = sentTo("guestTab", "sessions:refresh")
		noLeak(got)
		expect(got.session.sessionMessages).toHaveLength(6)
		expect(got.session.sessionMessages).toEqual(
			ownerGot.session.sessionMessages.map(strippedOf)
		)
		expect(ownerGot.session.sessionMessages).toEqual(got.session.sessionMessages)
	})
})

describe("the paths that reach a person through a handler", () => {
	const who = [
		["a guest", asGuest, () => guest.id]
	] as const

	/** A card the person owns, seated in the session by them. */
	async function seatFor(userId: number) {
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId, name: `card of ${userId}`, description: "d" } as any)
			.returning()
		const [seat] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId,
				characterId: card!.id,
				isActive: true,
				seatedByUserId: userId
			} as any)
			.returning()
		return { card: card!, seat: seat! }
	}
	/** A reply of the seated card, carrying a prompt and two swipes, the first showing. */
	async function replyOf(cardId: number, ownerOfRow: number) {
		const [row] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				userId: ownerOfRow,
				role: "assistant",
				characterId: cardId,
				content: "alpha",
				channel: "main",
				debugMeta: DEBUG_META,
				metadata: {
					swipes: {
						currentIdx: 0,
						history: ["alpha", "beta"],
						reasoningHistory: [null, null]
					}
				}
			} as any)
			.returning()
		return row!
	}
	/** The later tests count the session's six rows and its seats: take the fixture back out. */
	async function drop(ids: { rowId?: number; seatId: number; cardId: number }) {
		const { eq } = await import("drizzle-orm")
		if (ids.rowId != null) {
			await testDb.delete(schema.messages).where(eq(schema.messages.id, ids.rowId))
			await testDb
				.delete(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, ids.rowId))
		}
		await testDb
			.delete(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.id, ids.seatId))
		await testDb.delete(schema.characters).where(eq(schema.characters.id, ids.cardId))
	}
	/** An `emitToUser` double: what the handler sent, thunks called and awaited. */
	const capture = () => {
		const sent: Array<{ event: string; data: Promise<any> }> = []
		const emit = (event: string, data: any) => {
			sent.push({
				event,
				data: Promise.resolve(typeof data === "function" ? data() : data)
			})
		}
		const payload = async (event: string) => {
			const hit = sent.find((e) => e.event === event)
			expect(hit, `no ${event} was sent`).toBeDefined()
			return await hit!.data
		}
		return { emit, payload }
	}

	/** A seat the person owns, switched off by them: the handler resends the session to the caller. */
	async function benchRefresh(socket: any, userId: number) {
		const { sessionsSetCastSeatEnabledHandler } = await import("./sessions")
		const { card, seat } = await seatFor(userId)
		try {
			const { emit, payload } = capture()
			const res = await sessionsSetCastSeatEnabledHandler.handler(
				socket,
				{ sessionId, characterId: card.id, enabled: false } as any,
				emit as any
			)
			expect((res as any).error).toBeUndefined()
			return await payload("sessions:refresh")
		} finally {
			await drop({ seatId: seat.id, cardId: card.id })
		}
	}

	describe("the caller-only sessions:refresh resend (sessions:setCastSeatEnabled)", () => {
		test("an owner who is not an administrator who benches a seat is resent debugMeta null", async () => {
			const got = await benchRefresh(asOwner(), owner.id)
			noLeak(got)
			expect(byId(got.session.sessionMessages)[replyId].debugMeta).toBeNull()
		})

		test.each(who)("%s is resent the row with debugMeta null", async (_w, asWho, idOf) => {
			const ownersGot = await benchRefresh(asOwner(), owner.id)
			const got = await benchRefresh(asWho(), idOf())
			noLeak(got)
			expect(got.session.sessionMessages).toHaveLength(6)
			expect(got.session.sessionMessages).toEqual(
				ownersGot.session.sessionMessages.map(strippedOf)
			)
		})
	})

	describe("sessionMessages:swipeRight: navigating to the next alternative", () => {
		async function swipe(socket: any, id: number) {
			const { sessionMessagesSwipeRightHandler } = await import("./sessions")
			const { emit, payload } = capture()
			const res = (await sessionMessagesSwipeRightHandler.handler(
				socket,
				{ id } as any,
				emit as any
			)) as any
			expect(res.error).toBeUndefined()
			return { res, sent: await payload("sessionMessages:swipeRight") }
		}

		test("an owner who is not an administrator who swipes a guest's seated line is sent debugMeta null", async () => {
			const { card, seat } = await seatFor(guest.id)
			const row = await replyOf(card.id, guest.id)
			try {
				const { sent } = await swipe(asOwner(), row.id)
				noLeak(sent)
				expect(sent.sessionMessage.content).toBe("beta")
				expect(sent.sessionMessage.debugMeta).toBeNull()
			} finally {
				await drop({ rowId: row.id, seatId: seat.id, cardId: card.id })
			}
		})

		test.each(who)("%s who swipes their own seated line is sent debugMeta null", async (_w, asWho, idOf) => {
			const { card, seat } = await seatFor(idOf())
			const row = await replyOf(card.id, idOf())
			try {
				const { res, sent } = await swipe(asWho(), row.id)
				noLeak(res)
				noLeak(sent)
				expect(sent.sessionMessage.content).toBe("beta")
				expect(sent.sessionMessage.debugMeta).toBeNull()
			} finally {
				await drop({ rowId: row.id, seatId: seat.id, cardId: card.id })
			}
		})
	})

	describe("sessionMessages:swipeLeft: navigating to the previous alternative", () => {
		async function onSecondSwipe(rowId: number) {
			const { eq } = await import("drizzle-orm")
			await testDb
				.update(schema.sessionMessages)
				.set({
					metadata: {
						swipes: {
							currentIdx: 1,
							history: ["alpha", "beta"],
							reasoningHistory: [null, null]
						}
					}
				} as any)
				.where(eq(schema.sessionMessages.id, rowId))
		}
		async function swipeLeft(socket: any, id: number) {
			const { sessionMessagesSwipeLeftHandler } = await import("./sessions")
			const { emit, payload } = capture()
			const res = (await sessionMessagesSwipeLeftHandler.handler(
				socket,
				{ id } as any,
				emit as any
			)) as any
			expect(res.error).toBeUndefined()
			return { res, sent: await payload("sessionMessages:swipeLeft") }
		}

		test("an owner who is not an administrator who swipes a guest's seated line is sent debugMeta null", async () => {
			const { card, seat } = await seatFor(guest.id)
			const row = await replyOf(card.id, guest.id)
			try {
				await onSecondSwipe(row.id)
				const { res, sent } = await swipeLeft(asOwner(), row.id)
				noLeak(sent)
				noLeak(res)
				expect(sent.sessionMessage.content).toBe("alpha")
				expect(sent.sessionMessage.debugMeta).toBeNull()
				expect(res.sessionMessage.debugMeta).toBeNull()
			} finally {
				await drop({ rowId: row.id, seatId: seat.id, cardId: card.id })
			}
		})

		test.each(who)("%s who swipes their own seated line is sent debugMeta null", async (_w, asWho, idOf) => {
			const { card, seat } = await seatFor(idOf())
			const row = await replyOf(card.id, idOf())
			try {
				await onSecondSwipe(row.id)
				const { res, sent } = await swipeLeft(asWho(), row.id)
				noLeak(res)
				noLeak(sent)
				expect(sent.sessionMessage.content).toBe("alpha")
				expect(sent.sessionMessage.debugMeta).toBeNull()
			} finally {
				await drop({ rowId: row.id, seatId: seat.id, cardId: card.id })
			}
		})
	})

	describe("sessionMessages:setSprite: the reply to a person's pick", () => {
		async function setSprite(socket: any, id: number) {
			const { sessionMessagesSetSprite } = await import("./sprites")
			const { emit, payload } = capture()
			const res = (await sessionMessagesSetSprite.handler(
				socket,
				{ id, sprite: null } as any,
				emit as any
			)) as any
			expect(res.error).toBeUndefined()
			return { res, sent: await payload("sessionMessages:setSprite") }
		}

		test("an owner who is not an administrator who changes a guest's seated line is sent debugMeta null", async () => {
			const { card, seat } = await seatFor(guest.id)
			const row = await replyOf(card.id, guest.id)
			try {
				const { res, sent } = await setSprite(asOwner(), row.id)
				noLeak(sent)
				noLeak(res)
				expect(sent.sessionMessage.debugMeta).toBeNull()
				expect(res.sessionMessage.debugMeta).toBeNull()
			} finally {
				await drop({ rowId: row.id, seatId: seat.id, cardId: card.id })
			}
		})

		test.each(who)("%s who changes their own seated line is sent debugMeta null", async (_w, asWho, idOf) => {
			const { card, seat } = await seatFor(idOf())
			const row = await replyOf(card.id, idOf())
			try {
				const { res, sent } = await setSprite(asWho(), row.id)
				noLeak(res)
				noLeak(sent)
				expect(sent.sessionMessage.debugMeta).toBeNull()
			} finally {
				await drop({ rowId: row.id, seatId: seat.id, cardId: card.id })
			}
		})
	})

	describe("the reply sent before the run starts", () => {
		test.each([
			["regenerate", "sessionMessagesRegenerateHandler"],
			["extend", "sessionMessagesExtendHandler"]
		] as const)("sessionMessages:%s", async (verb, handlerName) => {
			const handlers = await import("./sessions")
			const handler = (handlers as any)[handlerName]
			const event = `sessionMessages:${verb}`
			for (const [asWho, userId] of [
				[asOwner, owner.id],
				[asGuest, guest.id],
				[asAdminGuest, adminGuest.id]
			] as const) {
				const { card, seat } = await seatFor(userId)
				const row = await replyOf(card.id, userId)
				try {
					const { emit, payload } = capture()
					const res = await handler.handler(asWho(), { id: row.id }, emit)
					expect(res.error).toBeUndefined()
					const sent = await payload(event)
					if (userId === adminGuest.id)
						expect(sent.sessionMessage.debugMeta).toEqual(DEBUG_META)
					else {
						noLeak(sent)
						noLeak(res)
						expect(sent.sessionMessage.debugMeta).toBeNull()
					}
				} finally {
					await drop({ rowId: row.id, seatId: seat.id, cardId: card.id })
				}
			}
		})
	})
})
