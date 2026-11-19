/**
 * `lorebook_bindings.created_by`: the person who made a cast member. A guest
 * naming their seat, an owner adding one by hand, a shared-card copy and a
 * person's Apply of a graph build record that person; a run's mint records
 * nobody.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-created-by-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const db = () => testDb as unknown as Db
const mkUser = async () => {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: `created-by-user-${++n}` })
		.returning()
	return u!
}
const mkSession = async (ownerId: number) => {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: true, name: `Run ${++n}` })
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	return { session: s!, own: await ownBookFor(db(), s!.id) }
}
const memberNamed = async (lorebookId: number, name: string) =>
	(
		await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	).find((m) => m.name === name)

describe("who made a cast member", () => {
	test("a guest naming their own seat is the maker", async () => {
		const owner = await mkUser()
		const guest = await mkUser()
		const { session, own } = await mkSession(owner.id)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: guest.id, isPlayer: true })
		const { writeSeatName } = await import("$lib/server/sessions/seatName")
		await writeSeatName(db(), {
			sessionId: session.id,
			userId: guest.id,
			isOwner: false,
			name: "Guest Hero",
			createdBy: guest.id
		})
		expect((await memberNamed(own.id, "Guest Hero"))?.createdBy).toBe(guest.id)
	})

	test("a run naming a seat records no maker", async () => {
		const owner = await mkUser()
		const guest = await mkUser()
		const { session, own } = await mkSession(owner.id)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: guest.id, isPlayer: true })
		const { writeSeatName } = await import("$lib/server/sessions/seatName")
		await writeSeatName(db(), {
			sessionId: session.id,
			userId: guest.id,
			isOwner: false,
			name: "Run Hero"
		})
		expect((await memberNamed(own.id, "Run Hero"))?.createdBy).toBeNull()
	})

	test("the owner adding a member by hand is the maker", async () => {
		const owner = await mkUser()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Hand Book", userId: owner.id })
			.returning()
		const { createLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		await createLorebookBindingHandler.handler(
			{ user: { id: owner.id } } as any,
			{
				lorebookBinding: {
					lorebookId: book!.id,
					name: "By Hand",
					// A client-sent maker is never believed.
					createdBy: null
				} as any
			},
			() => {}
		)
		expect((await memberNamed(book!.id, "By Hand"))?.createdBy).toBe(owner.id)
	})

	test("a shared-card copy is the copier's", async () => {
		const owner = await mkUser()
		const copier = await mkUser()
		const { insertCard } = await import("$lib/server/characters/versions")
		const { card } = await insertCard(testDb, {
			userId: owner.id,
			name: "Shared Sam",
			description: "A person."
		})
		await testDb
			.insert(schema.characterShares)
			.values({ characterId: card.id, userId: copier.id })
		const { session } = await mkSession(copier.id)
		const { copySharedCard } = await import("$lib/server/cast/sharedCardCopy")
		const copied = await copySharedCard(db(), {
			sessionId: session.id,
			cardId: card.id,
			userId: copier.id
		})
		const [member] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, copied.castMemberId))
		expect(member!.createdBy).toBe(copier.id)
	})

	test("the owner seating a guest by name is the maker; the guest is only its person", async () => {
		const owner = await mkUser()
		const guest = await mkUser()
		const { session, own } = await mkSession(owner.id)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: guest.id, isPlayer: true })
		const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		await sessionsUpdateHandler.handler(
			{
				id: `s-${owner.id}`,
				user: { id: owner.id, isAdmin: false },
				io: { to: () => ({ emit: () => {} }) }
			} as any,
			{
				session: { id: session.id },
				playerSeatsFor: [{ seatName: "Handed Hero", toUserId: guest.id }]
			} as any,
			() => {}
		)
		expect((await memberNamed(own.id, "Handed Hero"))?.createdBy).toBe(owner.id)
		const [seat] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, session.id))
		expect(seat!.userId).toBe(guest.id)
	})

	test("a run's mint, with no person, is nobody's", async () => {
		const owner = await mkUser()
		const { own } = await mkSession(owner.id)
		const { insertBackgroundBinding } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const member = await insertBackgroundBinding(db(), own.id, {
			name: "Run Minted"
		})
		expect(member.createdBy).toBeNull()
	})
})
