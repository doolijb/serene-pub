/**
 * `pipelines:previewRetrieval` refuses before it runs anything.
 *
 * The handler compiles a real turn against a session so the composer can ask
 * "what would fire if I sent this?", which makes every gate in front of it
 * load-bearing (the retired `entries:testRetrieval` had the same gates): a turn is a real
 * run with a real embedding call behind it, and the precedent for running one
 * with only the caller's *session* in scope is `triggerGenerateMessage`, where
 * a guest could drive generations they had no business driving.
 *
 * Scoped deliberately to the refusals, and every one of them returns before
 * `runTurn` is reached — which is the property being asserted as much as the
 * sentence is. A test that got as far as the pipeline would need a published
 * spec, a connection and an embedding model to say nothing more about
 * permission than these do.
 *
 * A guest reaches the session and is turned back all the same: the preview
 * quotes the session's lorebook, which is its owner's, so only the owner or
 * an administrator may ask for one.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		getCryptoSecretKey: () => "preview-retrieval-int-secret"
	}
})

let ownerId: number
let guestId: number
let strangerId: number
/** The owner's session: has a lorebook, has no cast. */
let castlessSessionId: number
/** The owner's other session: no lorebook at all. */
let booklessSessionId: number

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	const [owner] = await testDb
		.insert(schema.users)
		.values({ username: "preview-retrieval-owner", isAdmin: true })
		.returning()
	ownerId = owner.id
	const [guest] = await testDb
		.insert(schema.users)
		.values({ username: "preview-retrieval-guest", isAdmin: false })
		.returning()
	guestId = guest.id
	const [stranger] = await testDb
		.insert(schema.users)
		.values({ username: "preview-retrieval-stranger", isAdmin: false })
		.returning()
	strangerId = stranger.id

	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Preview book", userId: ownerId })
		.returning()

	const [withBook] = await testDb
		.insert(schema.sessions)
		.values({
			name: "Preview session",
			isGroup: false,
			userId: ownerId,
			lorebookId: book.id
		} as any)
		.returning()
	castlessSessionId = withBook.id
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: castlessSessionId, userId: guestId })

	const [withoutBook] = await testDb
		.insert(schema.sessions)
		.values({
			name: "Bookless session",
			isGroup: false,
			userId: ownerId,
			lorebookId: null
		} as any)
		.returning()
	booklessSessionId = withoutBook.id
}, 120_000)

function fakeSocket(userId: number, isAdmin = false) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noop = () => {}

describe("pipelines:previewRetrieval — permission and preconditions", () => {
	it("refuses a conversation the asker cannot reach", async () => {
		const { pipelinesPreviewRetrieval } = await import("./pipelines")
		const events: any[] = []
		const res: any = await pipelinesPreviewRetrieval.handler(
			fakeSocket(strangerId),
			{ sessionId: castlessSessionId, content: "hello" } as any,
			(event, data) => events.push({ event, data })
		)
		// The same sentence a missing session gets: telling the two apart is
		// how a session id becomes worth guessing.
		expect(res.error).toBe("No such conversation.")
		expect(res.explanation).toBeUndefined()
		expect(events.map((e) => e.event)).toContain(
			"pipelines:previewRetrieval:error"
		)
	}, 60_000)

	it("refuses a guest: the preview quotes the owner's lorebook", async () => {
		const { pipelinesPreviewRetrieval } = await import("./pipelines")
		const res: any = await pipelinesPreviewRetrieval.handler(
			fakeSocket(guestId),
			{ sessionId: castlessSessionId, content: "hello" } as any,
			noop
		)
		expect(res.error).toBe("Only the conversation's owner can preview its lore.")
		expect(res.explanation).toBeUndefined()
	}, 60_000)

	it("refuses a conversation with no lorebook, with the reason", async () => {
		const { pipelinesPreviewRetrieval } = await import("./pipelines")
		const res: any = await pipelinesPreviewRetrieval.handler(
			fakeSocket(ownerId, true),
			{ sessionId: booklessSessionId, content: "hello" } as any,
			noop
		)
		// Not "nothing fires" — a question that cannot be asked, said in
		// words. An absence with no reason attached is the failure this whole
		// surface exists to remove.
		expect(res.error).toContain("no lorebook attached")
		expect(res.explanation).toBeUndefined()
	}, 60_000)

	it("refuses an oversized draft before it touches the database", async () => {
		const { pipelinesPreviewRetrieval } = await import("./pipelines")
		const { MAX_CHAT_MESSAGE_LENGTH } = await import(
			"$lib/shared/constants/MessageLimits"
		)
		const res: any = await pipelinesPreviewRetrieval.handler(
			fakeSocket(ownerId, true),
			{
				sessionId: castlessSessionId,
				content: "x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1)
			} as any,
			noop
		)
		expect(res.error).toContain("Message too long")
	}, 60_000)
})
