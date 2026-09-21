/**
 * The composer's channel, end to end through the send handler (R-C, U2).
 *
 * `ReplyRequest.channel` has existed since the channel levers landed and
 * **nothing ever passed one**: the send handler read three fields off the
 * payload, stored the row without a channel, and triggered a turn that named
 * none. So a genre with a second channel had a composer that could only ever
 * write to `main`, and a junction on `$.input.channel` could only ever see
 * `main`. The Writing Room is the first customer, and this is the wiring it
 * needed.
 *
 * Two facts, and both matter:
 *
 *  - the **row** is stored on the channel the author chose, so the message is
 *    where they put it;
 *  - the **turn** it triggers is asked for on that same channel, so the reply
 *    lands there and a genre may branch on it.
 *
 * And the refusal, which is the third: a channel the genre never declared is
 * refused with a sentence rather than coerced to `main` — a message written to
 * a lane nothing will ever render is data loss with every row still present.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/** Every reply the trigger asks for, as it was asked for. */
const asked: any[] = []
vi.mock("../utils/runReply", () => ({
	runReply: async (args: any) => {
		asked.push(args)
		return { ok: true }
	}
}))

/**
 * A genre with a manuscript, declared the way the Writing Room declares one.
 *
 * A fixture rather than the shipped genre on purpose: the catalog reaches this
 * process through its **build**, and this lane may not run one — so a test
 * naming `core:genre/writing-room` would be a test of whether somebody had
 * rebuilt a package. What is under test here is the handler.
 */
const GENRE_ID = "chariot.room:inlet/writing"
let userId: number
let sessionId: number
let personaId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-send-channel-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, "send-channel-user")
	userId = user.id

	await testDb.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: GENRE_ID,
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Writing Room" } },
		ports: {},
		sessionShape: {
			composer: "text",
			voice: "character",
			channels: [
				"main",
				{ slug: "manuscript", role: "folio", voice: "none" }
			]
		}
	} as any)

	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			genreId: `${GENRE_ID}@1`
		})
		.returning()
	sessionId = session.id

	// Somebody for the trigger to hand the turn to. Round-robin needs BOTH
	// sides seated — a character to answer and a persona to answer — so
	// without the pair nothing is ever due and `runReply` is never reached.
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId, name: "Verity", description: "A writer." })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: verity.id,
		isActive: true,
		visibility: "visible"
	} as any)
	const [author] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name: "The author",
			description: "",
			isPersona: true,
			aliases: []
		})
		.returning()
	personaId = author.id
	await testDb.insert(schema.sessionPersonas).values({
		sessionId,
		personaId: author.id,
		isActive: true
	} as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
	asked.length = 0
})

const fakeSocket = () =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

const send = async (params: Record<string, unknown>) => {
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	return sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(),
		{ sessionId, personaId, ...params } as any,
		noopEmit
	)
}

describe("a message sent on a declared channel", () => {
	test("is stored on it, and the reply is asked for on it", async () => {
		const res = await send({
			content: "The gate was old.",
			channel: "manuscript"
		})
		expect(res.error).toBeUndefined()
		expect(res.sessionMessage?.channel).toBe("manuscript")

		// The half that did not exist: `runReply` hears which channel the turn
		// is on, which is what a genre's junction branches over.
		//
		// Every call, not just the first: the trigger round-robins while
		// somebody is due, and a stand-in that always succeeds keeps it going
		// — so what is asserted is that the channel never drops off one of
		// them, which is what a loop would be free to do.
		expect(asked.length).toBeGreaterThan(0)
		expect(asked.map((a: any) => a.channel)).toEqual(
			asked.map(() => "manuscript")
		)
		expect(asked[0]?.sessionId).toBe(sessionId)
	})

	test("a send that names no channel is `main`, exactly as it always was", async () => {
		const res = await send({ content: "Make it colder." })
		expect(res.sessionMessage?.channel).toBe("main")
		// `main` travels too, rather than nothing: the value is the same one
		// `runReply` would have defaulted to, said out loud.
		expect(asked[0]?.channel).toBe("main")
	})
})

describe("a channel the genre never declared", () => {
	test("is refused with a sentence, and nothing is written", async () => {
		const before = await testDb.select().from(schema.sessionMessages)
		const res = await send({ content: "nowhere", channel: "map" })
		expect(res.sessionMessage).toBeUndefined()
		expect(res.error).toMatch(/no channel 'map'/)
		// Refused, not coerced: no row anywhere, on `main` or otherwise.
		const after = await testDb.select().from(schema.sessionMessages)
		expect(after.length).toBe(before.length)
		expect(asked.length).toBe(0)
	})

	test("a lane under a declared channel is fine — lanes are runtime", async () => {
		const res = await send({ content: "a second lane", channel: "manuscript:2" })
		expect(res.error).toBeUndefined()
		expect(res.sessionMessage?.channel).toBe("manuscript:2")
		expect(asked[0]?.channel).toBe("manuscript:2")
	})
})
