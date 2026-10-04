/**
 * `pipelines:previewRetrieval` for an administrator who is not the session's
 * owner (lorebooks plan Phase D, permissions minors).
 *
 * The gate lets an administrator through, but the entry read behind the
 * explanation (`retrievalEntriesFor`) is owner-scoped unless told it is an
 * administrator reading (R55). Without `asAdmin` it read nothing, so every
 * row's live facts came back empty and `entriesRead` was false. The turn is
 * stubbed: what is asserted is the read, not the run.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "preview-retrieval-admin-secret" }
})

/** A preview whose one decision names an entry the book no longer has. */
vi.mock("$lib/server/pipelines/runtime/runTurn", () => ({
	runTurn: async () => ({
		preview: { messages: [] },
		nodes: [
			{
				nodeKey: "rank",
				seq: 1,
				output: {
					decisions: [
						{
							candidate: {
								id: 987654,
								source: "worldLore",
								tokens: 10,
								signals: { keyword: 1 },
								priority: 1,
								payload: {
									name: "Gone",
									content: "…",
									fingerprint: "recorded-hash"
								}
							},
							score: 1,
							reason: "filled_scored",
							included: true,
							why: "scored"
						}
					],
					groups: {}
				}
			}
		]
	})
}))

let ownerId: number
let adminGuestId: number
let sessionId: number

beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const [owner] = await testDb
		.insert(schema.users)
		.values({ username: "preview-admin-owner", isAdmin: false })
		.returning()
	ownerId = owner.id
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username: "preview-admin-guest", isAdmin: true })
		.returning()
	adminGuestId = admin.id
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Owner's book", userId: ownerId })
		.returning()
	await testDb.insert(schema.lorebookEntries).values({
		lorebookId: book.id,
		typeId: WORLD_LORE_TYPE_ID,
		typeVersion: 1,
		position: 1,
		title: "Still here",
		content: "…"
	})
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Verity", description: "…" })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			name: "Preview session",
			isGroup: false,
			userId: ownerId,
			lorebookId: book.id
		} as any)
		.returning()
	sessionId = session.id
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId: character.id, isActive: true } as any)
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId, userId: adminGuestId })
}, 120_000)

describe("pipelines:previewRetrieval — an administrator who is not the owner", () => {
	it("reads the owner's book, so a vanished entry is said to be gone", async () => {
		const { pipelinesPreviewRetrieval } = await import("./pipelines")
		const res: any = await pipelinesPreviewRetrieval.handler(
			{
				user: { id: adminGuestId, isAdmin: true },
				io: { to: () => ({ emit: () => {} }) }
			} as any,
			{ sessionId } as any,
			() => {}
		)
		expect(res.error).toBeUndefined()
		const row = res.explanation.rows.find(
			(r: any) => r.provenance !== undefined
		)
		// "deleted" is only claimed when the book WAS read.
		expect(row?.provenance).toBe("deleted")
	})
})
