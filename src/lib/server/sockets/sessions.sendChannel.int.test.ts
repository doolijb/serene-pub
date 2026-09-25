/**
 * The composer's channel, end to end through the send handler (R-C, U2;
 * A7) and the reply it leads to.
 *
 * `ReplyRequest.channel` has existed since the channel levers landed and
 * the old send handler read three fields off the payload, stored the row
 * without a channel, and triggered a turn that named none. Under turn order
 * (§3, §4.6) the second leg is the store's own: the send writes the row on
 * the channel the author chose, the genre's recompute adapts a prepared
 * entry from that row — carrying its `channel` — and the fire (auto-advance
 * on a `next`/`round` session, or a press) asks the reply on it.
 *
 * Three facts, and all three matter here:
 *
 *  - the **row** is stored on the channel the author chose;
 *  - the **prepared entry** the recompute answers with carries that channel,
 *    so the reply lands on it and a genre may branch on it;
 *  - a channel the genre never declared is refused with a sentence rather
 *    than coerced to `main` — a message written to a lane nothing will
 *    render is data loss with every row still present.
 *
 * The fixture genre is a bare inlet with no catalog row, exactly as the old
 * harness was: it binds no recompute, so the send's own half — the row and
 * the refusal — runs the real handler, and the listener's half — a prepared
 * entry firing the reply on the entry's channel — is driven through the same
 * auto-advance listener a wired genre's `turn-order-changed` fires.
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
let verityId: number
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

	// Somebody to answer. The prepared entry the tests fire names this
	// character; the author's persona sits beside her, the two halves a
	// character/persona round-robin seats.
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId, name: "Verity", description: "A writer." })
		.returning()
	verityId = verity.id
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

/**
 * What a wired genre's recompute answers a send with (A7): a prepared entry
 * adapted from the row, carrying its channel. The fixture binds no recompute,
 * so the test writes the adaptation it stands for and fires it through the
 * same `turn-order-changed` listener a live send's recompute fires — which is
 * where the reply is asked for on the channel.
 */
async function firePrepared(
	characterId: number,
	channel?: string
): Promise<unknown> {
	const { onTurnOrderChanged } = await import("$lib/server/sessions/autoAdvance")
	const { EMPTY_TURN_ORDER } = await import("@serene-pub/sdk")
	const order: typeof EMPTY_TURN_ORDER = {
		...EMPTY_TURN_ORDER,
		order: [
			{
				ref: `character:${characterId}`,
				via: "strategy",
				...(channel ? { channel } : {})
			}
		]
	}
	return onTurnOrderChanged(testDb as never, {
		sessionId,
		userId,
		cause: { kind: "user", userId },
		turnOrder: order
	})
}

describe("a message sent on a declared channel", () => {
	test("is stored on it, and the prepared turn's reply is asked for on it", async () => {
		const res = await send({
			content: "The gate was old.",
			channel: "manuscript"
		})
		expect(res.error).toBeUndefined()
		expect(res.sessionMessage?.channel).toBe("manuscript")

		// The half that did not exist: the reply hears which channel the turn
		// is on (A7 §4.6) — the prepared entry's channel rides to `runReply`,
		// which is what a genre's junction branches over. Every fire, not just
		// the first: the channel must never have dropped off one of them.
		expect(
			await firePrepared(verityId, "manuscript")
		).toMatchObject({ fired: true })
		expect(asked.length).toBeGreaterThan(0)
		expect(asked.map((a: any) => a.channel)).toEqual(
			asked.map(() => "manuscript")
		)
		expect(asked[0]?.sessionId).toBe(sessionId)
	})

	test("a send that names no channel is `main`, exactly as it always was", async () => {
		const res = await send({ content: "Make it colder." })
		expect(res.sessionMessage?.channel).toBe("main")
		// The value is the same one `runReply` would have defaulted to, said
		// out loud on the prepared entry — so `main` travels, rather than
		// nothing, when the genre's recompute adopts the row into the order.
		expect(
			await firePrepared(verityId, "main")
		).toMatchObject({ fired: true })
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
		// The lane name is a string like any other channel, adopted onto the
		// prepared entry as the author wrote it — no second validation pass.
		await firePrepared(verityId, "manuscript:2")
		expect(asked[0]?.channel).toBe("manuscript:2")
	})
})
