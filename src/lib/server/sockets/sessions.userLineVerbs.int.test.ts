/**
 * F1 (lair pass 2026-09-27, B1b): the door refuses retry, swipe and continue
 * on the author's own line, in every genre, whatever the client sends.
 *
 * In a persona-less genre (Lair, Guide) the author's line carries no
 * personaId, so the page offered it a swipe arrow and a Regenerate; pressing
 * either wrote the narrator's prose over the author's line as swipe 2/2. The
 * rule now lives on core's verbs (`item.role equals 'assistant'`,
 * `CORE_VERB_REASONS.ownLine`) and the handlers' door asks it — the row is
 * never touched.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "user-line-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const LAIR = "core:genre/lair"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-user-line-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noopEmit = () => {}

/** A Lair session: a narrator reply, then the author's line — newest, no persona. */
async function lairWithAuthorLast(tag: string, genreId: string = LAIR) {
	const schema = await import("$lib/server/db/schema")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, genreId })
		.returning()
	const [reply] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session!.id,
			role: "assistant",
			content: "The door creaks open.",
			userId: owner.id
		})
		.returning()
	const [mine] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session!.id,
			role: "user",
			content: "Brannoc walks into the guard room.",
			userId: owner.id
		})
		.returning()
	return { owner, session: session!, reply: reply!, mine: mine! }
}

async function rowOf(id: number) {
	const schema = await import("$lib/server/db/schema")
	const [row] = await testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, id))
	return row!
}

describe("F1 · the author's own line is edited, never regenerated", () => {
	test("sessionMessages:regenerate on a user line is refused and the row is unchanged", async () => {
		const { sessionMessagesRegenerateHandler } = await import("./sessions")
		const { owner, mine } = await lairWithAuthorLast("regen")
		const before = await rowOf(mine.id)
		const res = await sessionMessagesRegenerateHandler.handler(
			fakeSocket(owner.id),
			{ id: mine.id },
			noopEmit
		)
		expect(res.error).toMatch(/your own line is edited, not regenerated/i)
		expect(res.sessionMessage).toBeUndefined()
		expect(await rowOf(mine.id)).toEqual(before)
	})

	test("sessionMessages:swipeRight on a user line is refused and the row is unchanged", async () => {
		const { sessionMessagesSwipeRightHandler } = await import("./sessions")
		const { owner, mine } = await lairWithAuthorLast("swipe")
		const before = await rowOf(mine.id)
		const res = await sessionMessagesSwipeRightHandler.handler(
			fakeSocket(owner.id),
			{ id: mine.id },
			noopEmit
		)
		expect(res.error).toMatch(/your own line is edited, not regenerated/i)
		expect(await rowOf(mine.id)).toEqual(before)
		expect(before.metadata?.swipes).toBeUndefined()
	})

	test("sessionMessages:extend on a user line is refused and the row is unchanged", async () => {
		const { sessionMessagesExtendHandler } = await import("./sessions")
		// Chat, not the Lair: the Lair offers no prefill extend at all (B7,
		// D4), so its genre's refusal would answer first.
		const { owner, mine } = await lairWithAuthorLast("cont", "core:genre/chat")
		const before = await rowOf(mine.id)
		const res = await sessionMessagesExtendHandler.handler(
			fakeSocket(owner.id),
			{ id: mine.id },
			noopEmit
		)
		expect(res.error).toMatch(/your own line is edited, not regenerated/i)
		expect(await rowOf(mine.id)).toEqual(before)
	})

	test("the newest assistant line is still swipeable and regenerable at the door", async () => {
		const schema = await import("$lib/server/db/schema")
		const { verbRefusal } = await import("$lib/server/messages/verbs")
		const { owner, session } = await lairWithAuthorLast("reply")
		const [next] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "assistant",
				content: "A guard looks up.",
				userId: owner.id
			})
			.returning()
		const door = { messageId: next!.id, userId: owner.id }
		expect(await verbRefusal(testDb as any, session.id, "swipe", door)).toBeNull()
		expect(await verbRefusal(testDb as any, session.id, "retry", door)).toBeNull()
	})
})
