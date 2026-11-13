/**
 * 🚧 `sessions:create` and `sessions:update` seat card-less cast members by
 * `castMemberIds` (plan §34.2, S4): through the one seat writer, the seater
 * recorded, the listed members checked against the session's book before
 * anything is made, `is_group` counting them, and an update's diff touching
 * only card-less seats.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq, and, isNotNull, notExists } from "drizzle-orm"
import { sessionEvents } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { SEAT_REFUSALS } from "$lib/server/sessions/seats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

// Off by default, so every other test keeps the real seat writer. On, a seat
// by `castMemberId` is refused (and its session id recorded).
const refuseSeats = vi.hoisted(() => ({
	on: false,
	sessionIds: [] as number[]
}))

vi.mock("$lib/server/sessions/seats", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/sessions/seats")>()
	return {
		...actual,
		seatCast: async (
			...args: Parameters<typeof actual.seatCast>
		): ReturnType<typeof actual.seatCast> => {
			const input = args[1] as {
				sessionId: number
				castMemberId?: number
			}
			if (refuseSeats.on && input.castMemberId != null) {
				refuseSeats.sessionIds.push(input.sessionId)
				return {
					ok: false,
					refusal: "Test refusal: the seat writer said no."
				} as any
			}
			return actual.seatCast(...args)
		}
	}
})

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		...actual,
		db,
		getCryptoSecretKey: () => "card-less-seat-test-secret"
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-castmemberids-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const recorder = () => {
	const emitted: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => {
		emitted.push({
			event,
			data: typeof data === "function" ? undefined : data
		})
	}
	return { emitted, emit }
}

async function owner() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `card-less-owner-${++n}`)
}

async function ownBook(userId: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return book!
}

async function cardless(lorebookId: number, name: string) {
	const { member } = await insertCastMember(
		testDb as any,
		{
			lorebookId,
			characterId: null,
			binding: `{{char:${++n}}}`,
			name
		} as any
	)
	return member
}

async function make(userId: number, body: Record<string, unknown>) {
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const { emitted, emit } = recorder()
	const res = (await sessionsCreateHandler.handler(
		socket(userId),
		{
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			...body
		} as any,
		emit
	)) as any
	return { res, emitted }
}

async function update(userId: number, body: Record<string, unknown>) {
	const { sessionsUpdateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const { emit } = recorder()
	let error: unknown = null
	try {
		await sessionsUpdateHandler.handler(socket(userId), body as any, emit)
	} catch (e) {
		error = e
	}
	return { error }
}

const seats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.id))

const sessionRow = async (sessionId: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!

describe("sessions:create with castMemberIds", () => {
	test("the listed card-less members are seated: no card, the member, the creator as seater, a group", async () => {
		const u = await owner()
		const book = await ownBook(u.id)
		const a = await cardless(book.id, "Ada")
		const b = await cardless(book.id, "Bo")
		const { res } = await make(u.id, {
			session: { name: "S", lorebookId: book.id },
			castMemberIds: [a.id, b.id]
		})
		expect(res.error).toBeUndefined()
		const rows = await seats(res.session.id)
		expect(rows).toHaveLength(2)
		expect(rows.map((r) => r.castMemberId)).toEqual([a.id, b.id])
		for (const r of rows)
			expect(r).toMatchObject({
				characterId: null,
				envoySlug: null,
				seatedByUserId: u.id,
				removedAt: null
			})
		expect((await sessionRow(res.session.id)).isGroup).toBe(true)
	})

	test("a member of another book is refused in words and no session is made", async () => {
		const u = await owner()
		const book = await ownBook(u.id)
		const other = await ownBook(u.id)
		const stranger = await cardless(other.id, "Stranger")
		const before = (
			await testDb
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.userId, u.id))
		).length
		const { res } = await make(u.id, {
			session: { name: "S", lorebookId: book.id },
			castMemberIds: [stranger.id]
		})
		expect(res.error).toBe(SEAT_REFUSALS.outsideBooks("Stranger"))
		const after = (
			await testDb
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.userId, u.id))
		).length
		expect(after).toBe(before)
	})

	// A refused create takes back what it had committed: the own book (or kit
	// copy, which carries `session_id`) and a new world's copy.
	const strandedBooks = async (userId: number) =>
		(
			await testDb
				.select({ id: schema.lorebooks.id })
				.from(schema.lorebooks)
				.where(
					and(
						eq(schema.lorebooks.userId, userId),
						isNotNull(schema.lorebooks.sessionId),
						notExists(
							testDb
								.select({ id: schema.sessions.id })
								.from(schema.sessions)
								.where(eq(schema.sessions.id, schema.lorebooks.sessionId))
						)
					)
				)
		).length

	test("a refused create leaves no session row and no own book whose session is gone", async () => {
		const u = await owner()
		const book = await ownBook(u.id)
		const member = await cardless(book.id, "Ada")
		const sentence = "Test refusal: the seat writer said no."
		refuseSeats.on = true
		refuseSeats.sessionIds = []
		let res: any
		try {
			;({ res } = await make(u.id, {
				session: { name: "S", lorebookId: book.id },
				castMemberIds: [member.id]
			}))
		} finally {
			refuseSeats.on = false
		}
		expect(res.error).toBe(sentence)
		// The catch ran: the writer was reached inside the seats transaction, so
		// the session row existed and has been taken back.
		expect(refuseSeats.sessionIds).toHaveLength(1)
		const sessionId = refuseSeats.sessionIds[0]!
		expect(typeof sessionId).toBe("number")
		expect(
			await testDb
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
		).toHaveLength(0)
		expect(
			await testDb
				.select()
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.sessionId, sessionId))
		).toHaveLength(0)
		expect(await strandedBooks(u.id)).toBe(0)
	})

	// A starter-kit start has no refused-create test: it never has an attached
	// book (sessions.ts:1018), so its listed members are refused by the
	// pre-check before anything is written and the catch is unreachable.

	test("a card whose member is also listed by id is refused", async () => {
		const u = await owner()
		const [c] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: `Maren ${++n}`, description: "" })
			.returning()
		const book = await ownBook(u.id)
		const { member } = await insertCastMember(
			testDb as any,
			{
				lorebookId: book.id,
				characterId: c!.id,
				binding: `{{char:${++n}}}`,
				name: "Maren"
			} as any
		)
		const { res } = await make(u.id, {
			session: { name: "S", lorebookId: book.id },
			characterIds: [c!.id],
			castMemberIds: [member.id]
		})
		expect(res.error).toMatch(/already in this session/)
	})
})

describe("sessions:update with castMemberIds", () => {
	test("adds through the writer, removes only card-less seats, and leaves a carded one alone", async () => {
		const u = await owner()
		const [c] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: `Cora ${++n}`, description: "" })
			.returning()
		const book = await ownBook(u.id)
		const a = await cardless(book.id, "Ada")
		const b = await cardless(book.id, "Bo")
		const { res } = await make(u.id, {
			session: { name: "S", lorebookId: book.id },
			characterIds: [c!.id],
			castMemberIds: [a.id]
		})
		const sessionId = res.session.id as number
		const added = await update(u.id, {
			session: { id: sessionId },
			characterIds: [c!.id],
			castMemberIds: [a.id, b.id]
		})
		expect(added.error).toBeNull()
		let rows = await seats(sessionId)
		expect(rows.filter((r) => r.removedAt == null)).toHaveLength(3)
		expect(rows.find((r) => r.castMemberId === b.id)).toMatchObject({
			characterId: null,
			seatedByUserId: u.id
		})
		// Dropped once, the seat is benched: still on the roster, switched off.
		const benched = await update(u.id, {
			session: { id: sessionId },
			castMemberIds: [b.id]
		})
		expect(benched.error).toBeNull()
		rows = await seats(sessionId)
		expect(rows.find((r) => r.castMemberId === a.id)).toMatchObject({
			removedAt: null,
			isActive: false
		})
		// Dropped again (a benched seat with no lines), it is removed.
		const dropped = await update(u.id, {
			session: { id: sessionId },
			castMemberIds: [b.id]
		})
		expect(dropped.error).toBeNull()
		rows = await seats(sessionId)
		const adaRow = rows.find((r) => r.castMemberId === a.id)!
		expect(adaRow.removedAt).not.toBeNull()
		expect(adaRow.isActive).toBe(false)
		expect(adaRow.removedName).toBe("Ada")
		expect(rows.find((r) => r.characterId === c!.id)!.removedAt).toBeNull()
		expect(rows.find((r) => r.castMemberId === b.id)!.removedAt).toBeNull()
		// Listed again: the same row comes back.
		await update(u.id, {
			session: { id: sessionId },
			castMemberIds: [a.id, b.id]
		})
		rows = await seats(sessionId)
		expect(rows.filter((r) => r.castMemberId === a.id)).toHaveLength(1)
		expect(rows.find((r) => r.castMemberId === a.id)!.removedAt).toBeNull()
	})

	test("a card-less member added or removed with only castMemberIds announces member-added / member-removed", async () => {
		const u = await owner()
		const book = await ownBook(u.id)
		const a = await cardless(book.id, "Ada")
		const { res } = await make(u.id, {
			session: { name: "S", lorebookId: book.id }
		})
		const sessionId = res.session.id as number
		const ofEvent = async (event: string) => {
			await (
				await import("$lib/server/pipelines/runtime/sessionEvents")
			).settleSessionEvents()
			return (
				await testDb
					.select()
					.from(schema.sessionChanges)
					.where(eq(schema.sessionChanges.sessionId, sessionId))
					.orderBy(asc(schema.sessionChanges.id))
			).filter((c) => c.event === event)
		}
		const ref = `seated-member:${a.id}`
		expect(
			(
				await update(u.id, {
					session: { id: sessionId },
					castMemberIds: [a.id]
				})
			).error
		).toBeNull()
		const added = await ofEvent(sessionEvents.memberAdded)
		expect(added).toHaveLength(1)
		expect(added[0]!.payload).toMatchObject({ ref, change: "added" })
		// The first removal benches the seat (no member leaves); the second removes it.
		for (let pass = 0; pass < 2; pass++)
			expect(
				(
					await update(u.id, {
						session: { id: sessionId },
						castMemberIds: []
					})
				).error
			).toBeNull()
		const removed = await ofEvent(sessionEvents.memberRemoved)
		expect(removed).toHaveLength(1)
		expect(removed[0]!.payload).toMatchObject({ ref, change: "removed" })
	})

	test("a member outside the book throws its sentence", async () => {
		const u = await owner()
		const book = await ownBook(u.id)
		const other = await ownBook(u.id)
		const stranger = await cardless(other.id, "Stranger")
		const { res } = await make(u.id, {
			session: { name: "S", lorebookId: book.id }
		})
		const r = await update(u.id, {
			session: { id: res.session.id },
			castMemberIds: [stranger.id]
		})
		expect(String((r.error as Error)?.message)).toBe(
			SEAT_REFUSALS.outsideBooks("Stranger")
		)
	})
})
