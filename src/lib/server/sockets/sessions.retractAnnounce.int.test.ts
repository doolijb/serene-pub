/**
 * 🚧 Live scenes §15 G14: a swipe or a regenerate takes back what the reply it
 * replaces changed about the world (`retractStateAnchoredTo`) — and now says
 * so. `state:changed` goes to the session's users once the retraction has
 * committed, as an outlet's write announces, so every tab re-reads its state
 * and its ledger loses the old reply's lines then, not on the new reply's
 * turn. A reply that changed nothing announces nothing.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const runReplyMock = vi.fn(async (..._args: any[]) => ({ ok: true }))
vi.mock("$lib/server/utils/runReply", () => ({
	runReply: (...args: any[]) => runReplyMock(...args)
}))

/** Every `state:changed` broadcast, with how many of the reply's values stood when it went. */
const announced: Array<{ sessionId: number; valuesLeft: number }> = []
let watchedReply: number | null = null
vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/sockets/utils/broadcastHelpers")>()
	return {
		...real,
		broadcastToSessionUsers: vi.fn(async (_io: unknown, sessionId: number, event: string) => {
			if (event !== "state:changed") return
			const left =
				watchedReply === null
					? 0
					: (
							await testDb
								.select({ id: schema.attributeValues.id })
								.from(schema.attributeValues)
								.where(eq(schema.attributeValues.validFromMessageId, watchedReply))
						).length
			announced.push({ sessionId, valuesLeft: left })
		})
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-retract-announce-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	// The swipe is a built-in (`core:spec/builtin-swipe`): published, as boot does.
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
const fakeSocket = (userId: number) => ({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

/** A Chat session whose newest line is a reply — that changed the world's weather, unless `quiet`. */
async function replyThatChanged(opts: { quiet?: boolean } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const user = await createTestUser(testDb, `retract-announce-${++seq}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	const reply = await insertLegacy(testDb as any, {
		sessionId: session!.id,
		role: "assistant",
		isNarratorResponse: true,
		content: "The sky splits open."
	} as any)
	if (!opts.quiet)
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "session",
			ownerId: session!.id,
			slotId: "core:slot/weather@1",
			value: { v: "storm" },
			sessionId: session!.id,
			validFromMessageId: reply.id,
			updatedBy: "run:test"
		} as any)
	return { user, session: session!, reply }
}

describe("a swipe or a regenerate announces what it took back", () => {
	test("regenerate: state:changed to the session, after the reply's values are gone", async () => {
		const { sessionMessagesRegenerateHandler } = await import("./sessions")
		const w = await replyThatChanged()
		announced.length = 0
		watchedReply = w.reply.id
		const res = await sessionMessagesRegenerateHandler.handler(fakeSocket(w.user.id), { id: w.reply.id } as any, noopEmit)
		expect(res.error).toBeUndefined()
		expect(announced).toEqual([{ sessionId: w.session.id, valuesLeft: 0 }])
	})

	test("swipe: the same, for the alternative it starts", async () => {
		const { sessionMessagesSwipeRightHandler } = await import("./sessions")
		const w = await replyThatChanged()
		announced.length = 0
		watchedReply = w.reply.id
		const res = await sessionMessagesSwipeRightHandler.handler(fakeSocket(w.user.id), { id: w.reply.id } as any, noopEmit)
		expect(res.error).toBeUndefined()
		expect(announced).toEqual([{ sessionId: w.session.id, valuesLeft: 0 }])
	})

	test("a reply that changed nothing announces nothing", async () => {
		const { sessionMessagesRegenerateHandler } = await import("./sessions")
		const w = await replyThatChanged({ quiet: true })
		announced.length = 0
		watchedReply = w.reply.id
		const res = await sessionMessagesRegenerateHandler.handler(fakeSocket(w.user.id), { id: w.reply.id } as any, noopEmit)
		expect(res.error).toBeUndefined()
		expect(announced).toEqual([])
	})
})
