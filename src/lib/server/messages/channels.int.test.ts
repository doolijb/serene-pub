/**
 * Channel scoping (20 §7, R6): what a message read returns, and what a write
 * is allowed to land on.
 *
 * The claim under test is narrow and load-bearing: **no read produces a union
 * of channels unless it asked for one.** A prompt built from two conversations
 * at once is wrong in a way nothing downstream can detect — the model simply
 * answers a conversation that never happened — so the rule has to hold at the
 * host, which is the one place every pipeline read funnels through, rather
 * than at each binding that might remember it.
 *
 * The second claim is that the rule costs an existing session nothing: every
 * message ever written is on `main`, every genre that declares no lanes keeps
 * writing there, and an omitted channel resolves to `main`. So the scoped read
 * returns exactly what the unscoped read returned.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost, HostScopeError } from "$lib/server/pipelines/runtime/host"
import * as schema from "$lib/server/db/schema"
import { insertLegacy, listMessages } from "$lib/server/messages/store"
import {
	ALL_CHANNELS,
	DEFAULT_CHANNEL,
	channelRefusal,
	channelsOf,
	resolveChannel,
	sessionChannels
} from "$lib/server/messages/channels"

let db: TestDb
let userId: number
/** A session of the standard chat genre — one lane, like every session today. */
let chatSessionId: number
/** A session whose genre declares a second lane. */
let phoneSessionId: number

const PHONE_GENRE = "test:input/phone-mode@1"

const node = { key: "history", typeId: "core:query/session-history@1" } as any

const history = async (
	sessionId: number,
	query: Record<string, unknown> = {}
): Promise<any[]> =>
	(await createHost(db as any, { sessionId }).read!(
		"session_messages",
		{ sessionId, ...query },
		node
	)) as any[]

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "channel-scoping", isAdmin: false })
		.returning()
	userId = user.id

	// The transitional genre route: a live input type carrying a session
	// shape. Lighter than a whole create spec and read by the same function.
	await db.insert(schema.pipelineTypeRegistry).values({
		typeId: "test:input/phone-mode",
		version: 1,
		kind: "input",
		status: "live",
		sessionShape: { channels: ["phone"] } as any
	})

	const [chat] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	chatSessionId = chat.id

	const [phone] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, genreId: PHONE_GENRE })
		.returning()
	phoneSessionId = phone.id

	// Three on the chat log and three on the phone, interleaved, so a read
	// that took its limit before filtering comes back visibly short.
	for (let i = 1; i <= 3; i++) {
		await insertLegacy(db as any, {
			sessionId: phoneSessionId,
			userId,
			role: "user",
			content: `main ${i}`
		})
		await insertLegacy(db as any, {
			sessionId: phoneSessionId,
			userId,
			role: "assistant",
			channel: "phone",
			content: `phone ${i}`
		})
	}

	for (let i = 1; i <= 3; i++)
		await insertLegacy(db as any, {
			sessionId: chatSessionId,
			userId,
			role: "user",
			content: `chat ${i}`
		})
}, 60_000)

describe("resolving a channel", () => {
	it("treats absent, blank and non-string as the session's default lane", () => {
		expect(resolveChannel(undefined)).toBe(DEFAULT_CHANNEL)
		expect(resolveChannel("")).toBe(DEFAULT_CHANNEL)
		expect(resolveChannel("   ")).toBe(DEFAULT_CHANNEL)
		expect(resolveChannel(null)).toBe(DEFAULT_CHANNEL)
		expect(resolveChannel(42)).toBe(DEFAULT_CHANNEL)
		expect(resolveChannel(" phone ")).toBe("phone")
	})

	it("counts a genre's declared lanes, and its greeting lane, with main first", () => {
		expect(channelsOf(undefined)).toEqual([DEFAULT_CHANNEL])
		expect(channelsOf({} as any)).toEqual([DEFAULT_CHANNEL])
		expect(channelsOf({ channels: ["phone", "map"] } as any)).toEqual([
			"main",
			"phone",
			"map"
		])
		// A genre that redirects its greetings has named that lane by using it.
		expect(
			channelsOf({ greeting: { channel: "intro" } } as any)
		).toEqual(["main", "intro"])
		// Declared twice is still one lane.
		expect(
			channelsOf({
				channels: ["main", "phone"],
				greeting: { channel: "phone" }
			} as any)
		).toEqual(["main", "phone"])
	})

	it("reads a session's lanes off its genre", async () => {
		expect(await sessionChannels(db as any, chatSessionId)).toEqual([
			DEFAULT_CHANNEL
		])
		expect(await sessionChannels(db as any, phoneSessionId)).toEqual([
			"main",
			"phone"
		])
	}, 60_000)
})

describe("a history read", () => {
	it("returns one lane, not a union, when no channel is named", async () => {
		const rows = await history(phoneSessionId)
		expect(
			rows.map((m) => m.content),
			"an unqualified read mixed two conversations into one prompt"
		).toEqual(["main 1", "main 2", "main 3"])
		expect(rows.every((m) => m.channel === DEFAULT_CHANNEL)).toBe(true)
	}, 60_000)

	it("returns the named lane when one is named", async () => {
		const rows = await history(phoneSessionId, { channel: "phone" })
		expect(rows.map((m) => m.content)).toEqual([
			"phone 1",
			"phone 2",
			"phone 3"
		])
	}, 60_000)

	it("spans every lane only when asked to by name", async () => {
		const rows = await history(phoneSessionId, { channel: ALL_CHANNELS })
		expect(rows.map((m) => m.content)).toEqual([
			"main 1",
			"phone 1",
			"main 2",
			"phone 2",
			"main 3",
			"phone 3"
		])
	}, 60_000)

	it("takes its limit from the lane, not from the session", async () => {
		// The bug this replaces: the limit ran first and the channel filter
		// ran over the window it returned, so "the last 2 on the phone" was
		// really "whichever of the last 2 messages in the session happened to
		// be on the phone" — one row here, and zero on a busier chat log.
		const rows = await history(phoneSessionId, {
			channel: "phone",
			limit: 2
		})
		expect(
			rows.map((m) => m.content),
			"the window was taken before the lane was, so a quiet lane in a " +
				"busy session reads as a lane with no history"
		).toEqual(["phone 2", "phone 3"])
	}, 60_000)

	it("is unchanged for a session that has only ever had one lane", async () => {
		const scoped = await history(chatSessionId)
		const everything = await history(chatSessionId, {
			channel: ALL_CHANNELS
		})
		expect(scoped.map((m) => m.content)).toEqual([
			"chat 1",
			"chat 2",
			"chat 3"
		])
		expect(scoped).toEqual(everything)
	}, 60_000)

	it("appends the draft to the composer's own lane and no other", async () => {
		const draftMessage = { content: "half-typed", personaId: null }
		const onMain = (await createHost(db as any, {
			sessionId: phoneSessionId,
			draftMessage
		}).read!(
			"session_messages",
			{ sessionId: phoneSessionId },
			node
		)) as any[]
		expect(onMain.at(-1)?.content).toBe("half-typed")

		const onPhone = (await createHost(db as any, {
			sessionId: phoneSessionId,
			draftMessage
		}).read!(
			"session_messages",
			{ sessionId: phoneSessionId, channel: "phone" },
			node
		)) as any[]
		expect(
			onPhone.map((m) => m.content),
			"what somebody is typing into the session's composer was read " +
				"into a different conversation's prompt"
		).not.toContain("half-typed")
	}, 60_000)
})

describe("a summary read", () => {
	const summaryNode = {
		key: "source",
		typeId: "core:query/summarize-source@1"
	} as any

	it("draws from one lane unless a person picked the messages", async () => {
		const scoped = (await createHost(db as any, {
			sessionId: phoneSessionId
		}).read!(
			"summarize_source",
			{ sessionId: phoneSessionId },
			summaryNode
		)) as any[]
		expect(scoped.map((m) => m.content)).toEqual([
			"main 1",
			"main 2",
			"main 3"
		])

		// An explicit id list is taken as given — the person picked those
		// rows, lane and all.
		const picked = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, phoneSessionId))
		const byId = (await createHost(db as any, {
			sessionId: phoneSessionId
		}).read!(
			"summarize_source",
			{ sessionId: phoneSessionId, messageIds: picked.map((r) => r.id) },
			summaryNode
		)) as any[]
		expect(byId.length).toBe(6)
	}, 60_000)
})

describe("the native list", () => {
	it("defaults to one lane rather than every lane", async () => {
		expect(
			(await listMessages(db as any, phoneSessionId)).map(
				(m) => m.channel
			)
		).toEqual(["main", "main", "main"])
		expect(
			(
				await listMessages(db as any, phoneSessionId, {
					channel: ALL_CHANNELS
				})
			).length
		).toBe(6)
	}, 60_000)
})

describe("writing a message to a channel", () => {
	const writeNode = {
		key: "reply",
		typeId: "core:consumer/create-message"
	} as any

	const write = async (sessionId: number, payload: Record<string, unknown>) =>
		await createHost(db as any, { sessionId, userId }).commit!(
			{ sessionId, ...payload },
			writeNode
		)

	it("lands on main when the pipeline says nothing about channels", async () => {
		const res: any = await write(chatSessionId, { text: "no lane named" })
		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, res.id))
		expect(row.channel).toBe(DEFAULT_CHANNEL)
	}, 60_000)

	it("lands on a lane the session's genre declares", async () => {
		const res: any = await write(phoneSessionId, {
			text: "typed on the phone",
			channel: "phone"
		})
		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, res.id))
		expect(row.channel).toBe("phone")
		// And the mirror agrees, because the legacy row is what it mirrors.
		const [mirrored] = await db
			.select({ channel: schema.messages.channel })
			.from(schema.messages)
			.where(eq(schema.messages.id, res.id))
		expect(mirrored.channel).toBe("phone")
	}, 60_000)

	it("refuses a lane the session does not have, rather than coercing it", async () => {
		// Coercing to `main` would put a message meant for a side channel into
		// the chat log; dropping it silently would lose it. Both are worse
		// than a sentence naming the lanes that exist.
		await expect(
			write(chatSessionId, { text: "nowhere to land", channel: "phone" })
		).rejects.toThrow(HostScopeError)
		await expect(
			write(chatSessionId, { text: "nowhere to land", channel: "phone" })
		).rejects.toThrow(/no channel 'phone'/)
	}, 60_000)

	it("refuses the union sentinel as a destination", async () => {
		expect(
			await channelRefusal(db as any, phoneSessionId, ALL_CHANNELS)
		).toMatch(/not a channel a message can be written to/)
	}, 60_000)
})
