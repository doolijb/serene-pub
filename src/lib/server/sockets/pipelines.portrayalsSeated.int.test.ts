/**
 * 🚧 The receipt's portrayal lines name a `seated-member:<memberId>` key
 * through its seat (plan §27 S3, lane s27-S3C, worker w1): a receipt run in
 * S3 may key a portrayal by the ref it asked about; an old receipt keeps its
 * `character:` keys and reads as before.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "portrayals-seated-secret" }
})

let adminId: number

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const admin = await createTestUser(testDb, "portrayals-seated-admin")
	await testDb
		.update(schema.users)
		.set({ isAdmin: true } as any)
		.where((await import("drizzle-orm")).eq(schema.users.id, admin.id))
	adminId = admin.id
}, 120_000)

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: true },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

describe("pipelines:run — portrayals keyed by a seated member", () => {
	it("names a seated-member key as its seat's card (the member's own name), a card-less player seat by its seat name, and an unseated member by its reference", async () => {
		const { pipelinesRun } = await import("./pipelines")
		const [card] = await testDb
			.insert(schema.characters)
			.values({
				userId: adminId,
				name: "Verity",
				description: "A card."
			} as any)
			.returning()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: adminId, name: "Book" } as any)
			.returning()
		const bind = async (
			characterId: number | null,
			ownName: string | null
		) =>
			(
				await insertCastMember(testDb, {
					lorebookId: book!.id,
					characterId,
					binding: `{{char:${Math.random()}}}`,
					name: "member",
					ownName
				} as any)
			).member
		const m = await bind(card!.id, "Maren")
		const pm = await bind(null, null)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: adminId,
				isGroup: false,
				name: "Seated",
				lorebookId: book!.id
			} as any)
			.returning()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session!.id,
			characterId: card!.id,
			castMemberId: m.id
		} as any)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: session!.id,
			personaId: null,
			userId: adminId,
			seatName: "Wren",
			castMemberId: pm.id
		} as any)
		const unseated = `seated-member:${m.id + 9999}`
		await testDb.insert(schema.pipelineRuns).values({
			runId: "run-seated-portrayals",
			specSlug: "core:spec/story-respond",
			specVersion: "1.0.0",
			userId: adminId,
			sessionId: session!.id,
			outcome: "ok",
			triggerSource: "event",
			seed: "s",
			startedAt: new Date(0),
			endedAt: new Date(1000),
			elapsedMs: 1000,
			tokensSpent: 0,
			receipt: {
				runId: "run-seated-portrayals",
				outcome: "ok",
				nodes: [],
				portrayals: {
					[`seated-member:${m.id}`]: { by: "ai" },
					[`seated-member:${pm.id}`]: { by: "ai" },
					[unseated]: { by: "ai" },
					// An old receipt keeps its card key.
					[`character:${card!.id}`]: { by: "ai" }
				}
			}
		} as any)
		const res: any = await pipelinesRun.handler(
			fakeSocket(adminId),
			{ runId: "run-seated-portrayals" } as any,
			() => {}
		)
		expect(res.error).toBeUndefined()
		expect(res.run.portrayals).toEqual([
			{ ref: `seated-member:${m.id}`, name: "Maren", by: "ai" },
			{ ref: `seated-member:${pm.id}`, name: "Wren", by: "ai" },
			{ ref: unseated, name: unseated, by: "ai" },
			{ ref: `character:${card!.id}`, name: "Maren", by: "ai" }
		])
	})
})
