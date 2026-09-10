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
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost, HostScopeError } from "$lib/server/pipelines/runtime/host"
import * as schema from "$lib/server/db/schema"
import { insertLegacy, listMessages } from "$lib/server/messages/store"
import {
	ALL_CHANNELS,
	DEFAULT_CHANNEL,
	channelPrefixWhere,
	channelRefusal,
	channelsOf,
	formatChannel,
	isSameChannel,
	nextLane,
	parseChannel,
	resolveChannel,
	sessionChannels
} from "$lib/server/messages/channels"

let db: TestDb
let userId: number
/** A session of the standard chat genre — one lane, like every session today. */
let chatSessionId: number
/** A session whose genre declares a second lane. */
let phoneSessionId: number
/** A session whose genre declares a channel that will carry several lanes. */
let textSessionId: number

const PHONE_GENRE = "test:input/phone-mode@1"
const TEXT_GENRE = "test:input/texting-mode@1"

const node = { key: "history", typeId: "core:query/session-history@1" } as any

const history = async (
	sessionId: number,
	query: Record<string, unknown> = {}
): Promise<any[]> =>
	(await createHost(db, { sessionId }).read!(
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

	await db.insert(schema.pipelineTypeRegistry).values({
		typeId: "test:input/texting-mode",
		version: 1,
		kind: "input",
		status: "live",
		sessionShape: { channels: ["text-messages"] } as any
	})

	const [phone] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, genreId: PHONE_GENRE })
		.returning()
	phoneSessionId = phone.id

	const [texting] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, genreId: TEXT_GENRE })
		.returning()
	textSessionId = texting.id

	// Three on the chat log and three on the phone, interleaved, so a read
	// that took its limit before filtering comes back visibly short.
	for (let i = 1; i <= 3; i++) {
		await insertLegacy(db, {
			sessionId: phoneSessionId,
			userId,
			role: "user",
			content: `main ${i}`
		})
		await insertLegacy(db, {
			sessionId: phoneSessionId,
			userId,
			role: "assistant",
			channel: "phone",
			content: `phone ${i}`
		})
	}

	for (let i = 1; i <= 3; i++)
		await insertLegacy(db, {
			sessionId: chatSessionId,
			userId,
			role: "user",
			content: `chat ${i}`
		})

	// Two lanes of one channel, interleaved with each other and with the
	// session's own log, so a read that spans lanes without ordering them
	// comes back as one conversation nobody had.
	for (const [channel, content] of [
		["text-messages", "sms 1"],
		["text-messages:2", "second 1"],
		["main", "log 1"],
		["text-messages", "sms 2"],
		["text-messages:2", "second 2"]
	] as const)
		await insertLegacy(db, {
			sessionId: textSessionId,
			userId,
			role: "user",
			channel,
			content
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
		expect(channelsOf({ greeting: { channel: "intro" } } as any)).toEqual([
			"main",
			"intro"
		])
		// Declared twice is still one lane.
		expect(
			channelsOf({
				channels: ["main", "phone"],
				greeting: { channel: "phone" }
			} as any)
		).toEqual(["main", "phone"])
	})

	it("reads a session's lanes off its genre", async () => {
		expect(await sessionChannels(db, chatSessionId)).toEqual([
			DEFAULT_CHANNEL
		])
		expect(await sessionChannels(db, phoneSessionId)).toEqual([
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
		const onMain = (await createHost(db, {
			sessionId: phoneSessionId,
			draftMessage
		}).read!(
			"session_messages",
			{ sessionId: phoneSessionId },
			node
		)) as any[]
		expect(onMain.at(-1)?.content).toBe("half-typed")

		const onPhone = (await createHost(db, {
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
		const scoped = (await createHost(db, {
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
		const byId = (await createHost(db, {
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
			(await listMessages(db, phoneSessionId)).map((m) => m.channel)
		).toEqual(["main", "main", "main"])
		expect(
			(
				await listMessages(db, phoneSessionId, {
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
		await createHost(db, { sessionId, userId }).commit!(
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
		expect(await channelRefusal(db, phoneSessionId, ALL_CHANNELS)).toMatch(
			/not a channel a message can be written to/
		)
	}, 60_000)
})

/**
 * Lanes (ruling 2026-09-09).
 *
 * A channel is a slug the genre declares; the lanes under it are runtime and
 * open-ended — a lane exists because a pipeline wrote to it. Lane 1 is written
 * as the bare slug, which is why every row that existed before this shipped is
 * already canonical and why there is no migration.
 *
 * The two claims here are the ones a genre's pipelines rest on: a **read of the
 * bare slug is the whole channel** (and a read of `slug:1` is its default lane
 * alone), and **allocating the next lane cannot hand two writers the same
 * number**.
 */
describe("lanes under a channel", () => {
	it("takes a channel apart and puts it back in canonical form", () => {
		// The semantics are the SDK's — a plugin has to parse `text-messages:3`
		// exactly as the host does — so this asserts the re-export is wired,
		// not the rules, which `sdk-tests/channels.test.ts` owns.
		expect(parseChannel("text-messages:3")).toEqual({
			slug: "text-messages",
			lane: 3,
			explicit: true
		})
		expect(parseChannel("text-messages")).toEqual({
			slug: "text-messages",
			lane: 1,
			explicit: false
		})
		expect(formatChannel({ slug: "text-messages", lane: 1 })).toBe(
			"text-messages"
		)
		expect(formatChannel({ slug: "text-messages", lane: 3 })).toBe(
			"text-messages:3"
		)
		expect(isSameChannel("main", "main:1")).toBe(true)
		expect(isSameChannel("main", "main:2")).toBe(false)
	})

	it("matches a channel's every lane without reaching a channel that merely starts the same way", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()
		// `text_messages` is not `text-messages`, and an unescaped LIKE
		// pattern would not know that: `_` is a single-character wildcard, so
		// `text_messages:%` would sweep up a neighbouring channel's lanes.
		for (const channel of [
			"text_messages",
			"text_messages:2",
			"textXmessages:2",
			"text_messagesX:2"
		])
			await insertLegacy(db, {
				sessionId: session.id,
				userId,
				role: "user",
				channel,
				content: channel
			})

		const rows = await db
			.select({ channel: schema.sessionMessages.channel })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, session.id),
					channelPrefixWhere(
						schema.sessionMessages.channel,
						"text_messages"
					)
				)
			)
			.orderBy(schema.sessionMessages.id)
		expect(
			rows.map((r) => r.channel),
			"the prefix predicate leaked into a channel whose slug only looks alike"
		).toEqual(["text_messages", "text_messages:2"])
	}, 60_000)

	it("allocates the next lane from what has been written, per channel and per session", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()

		// Nothing written yet: the first lane to allocate is 1, not 2.
		expect(await nextLane(db, session.id, "text-messages")).toBe(1)

		const write = async (channel: string) =>
			await insertLegacy(db, {
				sessionId: session.id,
				userId,
				role: "user",
				channel,
				content: channel
			})

		await write("text-messages")
		expect(await nextLane(db, session.id, "text-messages")).toBe(2)

		// Gaps count as taken — the number is order, and reusing a hole would
		// hand a new conversation an old one's identity.
		await write("text-messages:5")
		expect(await nextLane(db, session.id, "text-messages")).toBe(6)

		// Another channel's lanes are not this channel's.
		await write("map:9")
		expect(await nextLane(db, session.id, "text-messages")).toBe(6)
		expect(await nextLane(db, session.id, "map")).toBe(10)

		// And another session's lanes are not this session's.
		expect(await nextLane(db, chatSessionId, "text-messages")).toBe(1)
	}, 60_000)

	it("composes allocate-then-insert into one transaction, opening a fresh lane each time", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()

		/**
		 * The shape `nextLane` is contracted for: the allocation and the insert
		 * that claims it are one critical section, held by the session-scoped
		 * `pg_advisory_xact_lock` the helper takes.
		 *
		 * ⚠ **This asserts the contract, it does not detect the race.** PGlite
		 * is a single connection and serialises these transactions on its own,
		 * so this test passes with the advisory lock removed — verified, not
		 * assumed. What it does catch is the ordinary regression: an allocator
		 * that reads its maximum from the wrong rows, or a caller pattern that
		 * stops composing. The lock is there for the server build, where the
		 * pool is not one connection.
		 */
		const open = async () =>
			await db.transaction(async (tx) => {
				const lane = await nextLane(tx, session.id, "text-messages")
				await insertLegacy(tx, {
					sessionId: session.id,
					userId,
					role: "user",
					channel: formatChannel({ slug: "text-messages", lane }),
					content: `lane ${lane}`
				})
				return lane
			})

		const lanes = await Promise.all([open(), open(), open()])
		expect(
			lanes.slice().sort(),
			"an allocator was handed a lane another had already claimed, so one conversation was opened inside another"
		).toEqual([1, 2, 3])
	}, 60_000)
})

describe("reading a channel with more than one lane", () => {
	it("reads the whole channel from a bare slug, and one lane from `slug:n`", async () => {
		const laneNode = {
			key: "history",
			typeId: "core:query/session-history@1"
		} as any
		const read = async (channel?: string) =>
			(
				(await createHost(db, { sessionId: textSessionId }).read!(
					"session_messages",
					{ sessionId: textSessionId, channel },
					laneNode
				)) as any[]
			).map((m) => m.content)

		// Lane 1 in the column is the bare slug — no migration, by construction.
		const stored = await db
			.select({ channel: schema.sessionMessages.channel })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, textSessionId))
		expect(stored.some((r) => r.channel === "text-messages")).toBe(true)

		// Bare slug: every lane, ordered lane then time — a genre's five phone
		// conversations read as five conversations, not one interleaved
		// transcript.
		expect(
			await read("text-messages"),
			"a whole-channel read interleaved two private conversations"
		).toEqual(["sms 1", "sms 2", "second 1", "second 2"])

		// `slug:n` is one lane.
		expect(await read("text-messages:2")).toEqual(["second 1", "second 2"])
		// And `slug:1` is the default lane alone, which is the one case where
		// the bare slug and the numbered form differ.
		expect(await read("text-messages:1")).toEqual(["sms 1", "sms 2"])

		// An omitted channel is still `main`, so the genre's own log is
		// untouched by any of this.
		expect(await read()).toEqual(["log 1"])
	}, 60_000)

	it("refuses a lane of a channel the genre never declared", async () => {
		const writeNode = {
			key: "reply",
			typeId: "core:consumer/create-message"
		} as any
		// The slug is what a genre declares; the lane is not. So the refusal
		// has to fire on the slug and stay silent about the number.
		await expect(
			createHost(db, {
				sessionId: chatSessionId,
				userId
			}).commit!(
				{
					sessionId: chatSessionId,
					text: "nowhere to land",
					channel: "text-messages:2"
				},
				writeNode
			)
		).rejects.toThrow(/no channel 'text-messages'/)
	}, 60_000)

	it("stores a write in canonical form, whatever spelling reached it", async () => {
		const writeNode = {
			key: "reply",
			typeId: "core:consumer/create-message"
		} as any
		const write = async (channel: string) => {
			const res: any = await createHost(db, {
				sessionId: textSessionId,
				userId
			}).commit!(
				{ sessionId: textSessionId, text: "canonical", channel },
				writeNode
			)
			const [row] = await db
				.select({ channel: schema.sessionMessages.channel })
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, res.id))
			return row.channel
		}
		// Lane 1 spelled out is still stored bare — two spellings of one lane
		// in the column would be one conversation wearing two names.
		expect(await write("text-messages:1")).toBe("text-messages")
		expect(await write("  text-messages : 3 ")).toBe("text-messages:3")
		// An unreadable lane degrades to the default one rather than throwing.
		expect(await write("text-messages:0")).toBe("text-messages")
	}, 60_000)
})
