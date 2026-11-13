/**
 * A cast member's save reaches the open sessions reading it, without a
 * refresh: `sessions:refresh` carries the member's shown name in
 * `castNames`, keyed by the seated card.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { insertCastMember } from "$lib/server/characters/versions"
import { interestKey } from "$lib/shared/sockets/interest"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-member-push-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const noop = () => {}
let tag = 1

/** An io whose members each hold one socket wanting `sessions:refresh` for `sessionIds`; emits captured per user. */
function capturingIo(userIds: number[], sessionIds: number[]) {
	const sockets = new Map<string, any>()
	const rooms = new Map<string, Set<string>>()
	const sent: { userId: number; event: string; data: any }[] = []
	for (const userId of userIds) {
		const id = `s${userId}`
		sockets.set(id, {
			id,
			user: { id: userId },
			interest: new Set(
				sessionIds.map((s) => interestKey("sessions:refresh", s))
			)
		})
		rooms.set(`user_${userId}`, new Set([id]))
	}
	return {
		sent,
		sockets: { adapter: { rooms }, sockets },
		to: (id: string) => ({
			emit: (event: string, data: any) => {
				sent.push({ userId: Number(id.slice(1)), event, data })
			}
		})
	} as any
}

async function setup() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const suffix = Math.random().toString(36).slice(2, 7)
	const owner = await createTestUser(db, `owner-${suffix}`)
	const guest = await createTestUser(db, `guest-${suffix}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: `Book ${suffix}`, userId: owner.id })
		.returning()
	const [otherBook] = await db
		.insert(schema.lorebooks)
		.values({ name: `Other ${suffix}`, userId: owner.id })
		.returning()
	const [card] = await db
		.insert(schema.characters)
		.values({
			userId: owner.id,
			name: "Verity",
			description: "Verity, described."
		} as any)
		.returning()
	const { member } = await insertCastMember(db, {
		lorebookId: book.id,
		name: "Verity",
		binding: `{{char:${tag++}}}`,
		characterId: card.id
	})
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, lorebookId: book.id })
		.returning()
	await db
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id })
	await db
		.insert(schema.sessionCharacters)
		.values({
			sessionId: session.id,
			characterId: card.id,
			castMemberId: member.id,
			position: 0
		})
	const [elsewhere] = await db
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, lorebookId: otherBook.id })
		.returning()
	return { owner, guest, book, card, member, session, elsewhere }
}

const refreshes = (io: any, userId: number) =>
	io.sent.filter(
		(s: any) => s.userId === userId && s.event === "sessions:refresh"
	)

describe("a cast member save reaches the sessions reading it", () => {
	it("lorebooks:updateBinding pushes one sessions:refresh with the new name, to the guest too, and none to another book's session", async () => {
		const { owner, guest, member, session, elsewhere, card } = await setup()
		const io = capturingIo([owner.id, guest.id], [session.id, elsewhere.id])
		const { updateLorebookBindingHandler } = await import("./lorebooks")
		await updateLorebookBindingHandler.handler(
			{ user: { id: owner.id }, io } as any,
			{ lorebookBinding: { id: member.id, ownName: "Renamed" } } as any,
			noop
		)
		for (const userId of [owner.id, guest.id]) {
			const got = refreshes(io, userId)
			expect(got.length).toBe(1)
			expect(got[0].data.session.id).toBe(session.id)
			expect(got[0].data.session.castNames[card.id].ownName).toBe(
				"Renamed"
			)
		}
		expect(
			io.sent.some((s: any) => s.data?.session?.id === elsewhere.id)
		).toBe(false)
	})

	it("a cast amendments:create pushes the session too", async () => {
		const { owner, member, book, session } = await setup()
		const io = capturingIo([owner.id], [session.id])
		const { amendmentsCreateHandler } = await import("./amendments")
		await amendmentsCreateHandler.handler(
			{ user: { id: owner.id }, io } as any,
			{
				lorebookId: book.id,
				castId: member.id,
				year: 5,
				fields: { summary: "Later, she kept the lamp." }
			} as any,
			noop
		)
		const got = refreshes(io, owner.id)
		expect(got.length).toBe(1)
		expect(got[0].data.session.id).toBe(session.id)
	})

	it("amendments:place pushes the session too", async () => {
		const { owner, member, book, session } = await setup()
		const io = capturingIo([owner.id], [session.id])
		const { amendmentsPlaceHandler } = await import("./amendments")
		await amendmentsPlaceHandler.handler(
			{ user: { id: owner.id }, io } as any,
			{ lorebookId: book.id, castId: member.id, personalPosition: 0, fromYear: 1 } as any,
			noop
		)
		const got = refreshes(io, owner.id)
		expect(got.length).toBe(1)
		expect(got[0].data.session.id).toBe(session.id)
		expect(got[0].data.session.castNames).toBeDefined()
	})

	it("amendments:unplace pushes the session of the member whose placement went", async () => {
		const { owner, member, book, session } = await setup()
		const [placed] = await db
			.insert(schema.castPresences)
			.values({
				lorebookBindingId: member.id,
				lorebookId: book.id,
				branchId: null,
				personalPosition: 0,
				fromYear: 1
			} as any)
			.returning()
		const io = capturingIo([owner.id], [session.id])
		const { amendmentsUnplaceHandler } = await import("./amendments")
		await amendmentsUnplaceHandler.handler(
			{ user: { id: owner.id }, io } as any,
			{ lorebookId: book.id, id: placed.id } as any,
			noop
		)
		const got = refreshes(io, owner.id)
		expect(got.length).toBe(1)
		expect(got[0].data.session.id).toBe(session.id)
	})

	it("amendments:deleteBranch pushes each session it moved", async () => {
		const { owner, member, card, book } = await setup()
		const [line] = await db
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book.id, name: "Gone line" } as any)
			.returning()
		const [moved] = await db
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, lorebookId: book.id, lorebookBranchId: line.id })
			.returning()
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId: moved.id, characterId: card.id, castMemberId: member.id, position: 0 })
		const io = capturingIo([owner.id], [moved.id])
		const { amendmentsDeleteBranchHandler } = await import("./amendments")
		await amendmentsDeleteBranchHandler.handler(
			{ user: { id: owner.id }, io } as any,
			{ lorebookId: book.id, id: line.id } as any,
			noop
		)
		const got = refreshes(io, owner.id)
		expect(got.length).toBe(1)
		expect(got[0].data.session.id).toBe(moved.id)
		expect(got[0].data.session.castNames).toBeDefined()
	})
})
