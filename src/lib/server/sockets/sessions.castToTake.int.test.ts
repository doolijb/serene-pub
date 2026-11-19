/**
 * 🚧 `sessions:castToTake` (owner ruling G4, 2026-11-16): the card-less cast
 * members a guest may take, read through one door because a guest cannot read
 * the attached lorebook's own list (`lorebooks:bindingList` refuses them). Id,
 * shown name and face only.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return {
		...testDbModule(await createTestDb()),
		getCryptoSecretKey: () => "cast-to-take-test-secret"
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

let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-casttotake-")
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

const user = async (label: string) => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `${label}-${++n}`)
}

const book = async (userId: number, extra: Record<string, unknown> = {}) =>
	(
		await testDb
			.insert(schema.lorebooks)
			.values({ userId, name: `Book ${++n}`, ...extra } as any)
			.returning()
	)[0]!

const member = async (
	lorebookId: number,
	name: string,
	characterId: number | null = null,
	description = ""
) =>
	(
		await insertCastMember(
			testDb as any,
			{
				lorebookId,
				characterId,
				binding: `{{char:${++n}}}`,
				name,
				description
			} as any
		)
	).member

async function ask(userId: number, sessionId: number) {
	const { sessionsCastToTakeHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const emitted: { event: string; data: any }[] = []
	const res = await sessionsCastToTakeHandler.handler(
		socket(userId),
		{ sessionId },
		(event: string, data: any) => emitted.push({ event, data })
	)
	return { res: res as any, emitted }
}

describe("sessions:castToTake", () => {
	test("a guest on a notes-only session sees the free card-less members, by name, and nothing more", async () => {
		const owner = await user("ct-owner")
		const guest = await user("ct-guest")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: true } as any)
			.returning()
		await testDb.insert(schema.sessionGuests).values({
			sessionId: session!.id,
			userId: guest.id,
			isPlayer: true
		})
		const notes = await book(owner.id, { sessionId: session!.id })
		await member(notes.id, "Zed", null, "SECRET-DESCRIPTION-ZED")
		await member(notes.id, "Ada", null, "SECRET-DESCRIPTION-ADA")
		const held = await member(notes.id, "Held")
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session!.id,
			castMemberId: held.id,
			position: 0,
			isActive: false
		})

		const { res, emitted } = await ask(guest.id, session!.id)
		expect(res.error).toBeUndefined()
		expect(res.sessionId).toBe(session!.id)
		expect(res.members.map((m: any) => m.name)).toEqual(["Ada", "Zed"])
		expect(Object.keys(res.members[0]).sort()).toEqual([
			"castMemberId",
			"faceMediaId",
			"name"
		])
		expect(JSON.stringify(res)).not.toContain("SECRET-DESCRIPTION")
		expect(emitted).toEqual([{ event: "sessions:castToTake", data: res }])
	})

	test("over an attached lorebook the guest cannot read: free card-less members of both books, never a carded one or one held, never another book's", async () => {
		const owner = await user("ct-owner")
		const guest = await user("ct-guest")
		const attached = await book(owner.id)
		const stranger = await book(owner.id)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: true,
				lorebookId: attached.id
			} as any)
			.returning()
		await testDb.insert(schema.sessionGuests).values({
			sessionId: session!.id,
			userId: guest.id,
			isPlayer: true
		})
		const notes = await book(owner.id, { sessionId: session!.id })

		// The guest is no owner or guest of the attached book itself: only this door shows them its cast.
		await member(attached.id, "Attached free", null, "SECRET-DESCRIPTION-A")
		await member(notes.id, "Notes free", null, "SECRET-DESCRIPTION-N")
		await member(stranger.id, "Elsewhere")
		const ownerCard = (
			await testDb
				.insert(schema.characters)
				.values({ userId: owner.id, name: "Carded", description: "" })
				.returning()
		)[0]!
		await member(attached.id, "Carded", ownerCard.id)
		const taken = await member(attached.id, "Taken")
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: session!.id,
			personaId: null,
			userId: owner.id,
			seatName: "Taken",
			castMemberId: taken.id,
			position: 0
		} as any)

		const { res } = await ask(guest.id, session!.id)
		expect(res.members.map((m: any) => m.name)).toEqual([
			"Attached free",
			"Notes free"
		])
		expect(JSON.stringify(res)).not.toContain("SECRET-DESCRIPTION")
		// The owner reads the same list.
		expect((await ask(owner.id, session!.id)).res.members).toEqual(
			res.members
		)
	})

	test("someone not in the session gets no members and an error that still carries the session id", async () => {
		const owner = await user("ct-owner")
		const outsider = await user("ct-outsider")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: true } as any)
			.returning()
		const notes = await book(owner.id, { sessionId: session!.id })
		await member(notes.id, "Ada")
		const { res, emitted } = await ask(outsider.id, session!.id)
		expect(res).toEqual({
			sessionId: session!.id,
			members: [],
			error: "no access to this session"
		})
		expect(emitted[0]!.data.sessionId).toBe(session!.id)
	})
})
