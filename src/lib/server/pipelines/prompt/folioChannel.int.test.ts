/**
 * Per-channel prompt roles (R-C, ruled 2026-09-17), end to end over real rows.
 *
 * `folioChannel.test.ts` pins the partition as a unit. What is asked here
 * is whether the **wiring** holds: the host is the one place a message and its
 * session are both in hand, so it reads the genre's channel declarations and
 * carries `channelRole` / `channelVoice` onto the rows; `processMessages` then
 * partitions on nothing but what is on the row.
 *
 * And the negative half, which is the one that protects every existing
 * install: a genre that declares only bare slugs gets **no such keys at all**,
 * so the assembled prompt is the same object it was before this shipped.
 */

import { describe, expect, it, beforeAll } from "vitest"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { resolveContextInput } from "$lib/server/pipelines/prompt/promptFields"
import {
	processMessages,
	FOLIO_MESSAGE_ID,
	SEED_MESSAGE_ID
} from "./messages"

let db: TestDb
/** A genre with a manuscript channel: a folio, with no voice. */
let roomSessionId: number
/** A genre that declares a second channel the old way — bare slugs. */
let plainSessionId: number
/** The room's one seated character, for the seed name a turn resolves. */
let verityId: number

const node = { key: "history", definitionId: "core:query/session-history@1" }

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "folio-channel-user")

	await db.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "chariot.room:inlet/writing",
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
				{ slug: "manuscript", role: "folio", voice: "none" },
				// An ordinary conversation the room's GM answers in — the
				// third voice, and the one that needs the TURN's channel
				// rather than the newest row's: `aside` has no rows at all in
				// this fixture and a turn on it still seeds under the narrator.
				{ slug: "aside", voice: "narrator" }
			]
		}
	} as any)

	await db.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "chariot.crawl:inlet/bare",
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Bare Slugs" } },
		ports: {},
		sessionShape: {
			composer: "text",
			voice: "character",
			channels: ["main", "map"]
		}
	} as any)

	const [room] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			genreId: "chariot.room:inlet/writing@1"
		})
		.returning()
	roomSessionId = room.id

	// Seated in the room, so the seed line has a cast member to resolve to —
	// which is what makes "the narrator, whoever is seated" a fact rather than
	// an empty session's only remaining answer.
	const [verity] = await db
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "A writer." })
		.returning()
	verityId = verity.id
	await db.insert(schema.sessionCharacters).values({
		sessionId: roomSessionId,
		characterId: verityId,
		isActive: true,
		visibility: "visible"
	} as any)

	const [plain] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			genreId: "chariot.crawl:inlet/bare@1"
		})
		.returning()
	plainSessionId = plain.id

	for (const [sessionId, rows] of [
		[
			roomSessionId,
			[
				["manuscript", "assistant", "The gate was old."],
				["main", "user", "Make it colder."],
				["manuscript", "assistant", "The gate was old, and cold."]
			]
		],
		[
			plainSessionId,
			[
				["map", "assistant", "A crossroads."],
				["main", "user", "Go north."]
			]
		]
	] as Array<[number, Array<[string, string, string]>]>)
		for (const [channel, role, content] of rows)
			await db
				.insert(schema.sessionMessages)
				.values({ sessionId, role, content, channel } as any)

	// Written after, so it is the newest row in the room — the turn's trigger.
	await db.insert(schema.sessionMessages).values({
		sessionId: roomSessionId,
		role: "assistant",
		content: "The gate was old, cold, and shut.",
		channel: "manuscript"
	} as any)
}, 60_000)

/** Every lane of every channel, in reading order — what a turn assembles from. */
const history = async (sessionId: number) =>
	(await createHost(db as any, { sessionId }).read!(
		"session_messages",
		{ channel: "*", limit: 100 },
		node as any
	)) as any[]

/**
 * The cast, read by a host that knows which channel the turn is on — the one
 * value the context builder and `processMessages` are both wired to, and where
 * the turn's channel arrives as a declared voice.
 */
const castFor = async (sessionId: number, channel?: string) =>
	(await createHost(db as any, { sessionId, channel }).read!(
		"session_cast",
		{ sessionId },
		node as any
	)) as any

/** The name the context builder puts on the seed line for a turn on `channel`. */
const seedNameOn = async (channel?: string) =>
	resolveContextInput({
		...(await castFor(roomSessionId, channel)),
		promptConfig: {},
		currentCharacterId: verityId,
		narratorName: "The Room"
	}).seedName

describe("a genre that declares a folio channel", () => {
	it("carries the channel's role and voice onto the rows the host reads", async () => {
		const rows = await history(roomSessionId)
		const byChannel = (slug: string) =>
			rows.filter((r) => r.channel === slug)
		expect(byChannel("manuscript").length).toBe(3)
		for (const r of byChannel("manuscript")) {
			expect(r.channelRole).toBe("folio")
			expect(r.channelVoice).toBe("none")
		}
		for (const r of byChannel("main")) {
			expect(r.channelRole).toBe("conversation")
			expect(r.channelVoice).toBe("character")
		}
	})

	it("assembles the folio first, as one block, with no seed row", async () => {
		const out = processMessages({
			messages: await history(roomSessionId),
			cast: {},
			charName: "Verity",
			personaName: "Reader",
			seedName: "Verity"
		})
		expect(out.messages[0]).toMatchObject({
			id: FOLIO_MESSAGE_ID,
			name: "manuscript",
			message:
				"The gate was old.\n\n" +
				"The gate was old, and cold.\n\n" +
				"The gate was old, cold, and shut."
		})
		// The conversation follows it…
		expect(out.messages[1]!.message).toBe("Make it colder.")
		// …and the turn was triggered on the manuscript, whose voice is
		// `none`, so nothing announces a speaker at the end.
		expect(out.messages.some((m) => m.id === SEED_MESSAGE_ID)).toBe(false)
		expect(out.messages.length).toBe(2)
	})
})

describe("a genre that declares a narrating channel", () => {
	it("answers the TURN's channel, not the newest row's", async () => {
		// `aside` has no rows in this fixture at all, which is the point: the
		// voice a turn seeds under is a property of the channel it was
		// triggered on, and reading it off the newest message answers for
		// whichever channel happened to speak last.
		expect(await castFor(roomSessionId, "aside")).toMatchObject({
			turnChannelVoice: "narrator"
		})
		expect(await castFor(roomSessionId, "main")).toMatchObject({
			turnChannelVoice: "character"
		})
		expect(await castFor(roomSessionId, "manuscript")).toMatchObject({
			turnChannelVoice: "none"
		})
		// A lane is multiplicity, not a channel: `aside:3` is `aside`.
		expect(await castFor(roomSessionId, "aside:3")).toMatchObject({
			turnChannelVoice: "narrator"
		})
	})

	it("seeds under the narrator on `aside` and under the character on `main`", async () => {
		expect(await seedNameOn("aside")).toBe("The Room")
		expect(await seedNameOn("main")).toBe("Verity")
		// A trigger that names no channel is told nothing, rather than told
		// `main` — see the cast read. The answer is the same here and the
		// difference matters where it is not: `processMessages` still reads
		// the trigger row, which is how a writing room keeps its silent seed.
		expect(await castFor(roomSessionId)).not.toHaveProperty(
			"turnChannelVoice"
		)
		expect(await seedNameOn()).toBe("Verity")
	})

	it("writes that line even though the newest row is a folio's", async () => {
		const out = processMessages({
			messages: await history(roomSessionId),
			cast: {},
			charName: "Verity",
			personaName: "Reader",
			seedName: await seedNameOn("aside"),
			turnChannelVoice: (await castFor(roomSessionId, "aside"))
				.turnChannelVoice
		})
		// The same history the `none` test above assembles with no seed at
		// all. The difference is the turn's channel and nothing else.
		expect(out.messages.at(-1)).toMatchObject({
			id: SEED_MESSAGE_ID,
			name: "The Room"
		})
	})

	it("keeps the room's silent seed for a trigger that names nothing", async () => {
		// The same genre through the path a turn actually takes *today*: no
		// trigger names a channel, so the cast says nothing and the decision
		// falls back to the trigger row — a manuscript row, whose voice is
		// `none`. This is the assertion that fails if a defaulted `main` is
		// ever allowed to answer for a turn that named no channel.
		const out = processMessages({
			messages: await history(roomSessionId),
			cast: {},
			charName: "Verity",
			personaName: "Reader",
			seedName: await seedNameOn(),
			turnChannelVoice: (await castFor(roomSessionId)).turnChannelVoice
		})
		expect(out.messages.some((m) => m.id === SEED_MESSAGE_ID)).toBe(false)
	})
})

describe("a genre that declares only bare slugs", () => {
	it("gets no role or voice on its rows at all", async () => {
		for (const r of await history(plainSessionId)) {
			expect(r).not.toHaveProperty("channelRole")
			expect(r).not.toHaveProperty("channelVoice")
		}
	})

	it("gets no turn channel voice on its cast either, whatever the turn names", async () => {
		// The structural half of "byte-identical": the cast a pre-R-C session
		// reads is the object it was before the turn's channel existed, so
		// nothing the prompt is built from can have moved.
		for (const channel of [undefined, "main", "map", "map:2"])
			expect(
				await castFor(plainSessionId, channel)
			).not.toHaveProperty("turnChannelVoice")
	})

	it("assembles exactly as it always did — turns, then the seed", async () => {
		const out = processMessages({
			messages: await history(plainSessionId),
			cast: {},
			charName: "Verity",
			personaName: "Reader",
			seedName: "Verity"
		})
		expect(out.messages.map((m) => m.message)).toEqual([
			"A crossroads.",
			"Go north.",
			""
		])
		expect(out.messages.at(-1)!.id).toBe(SEED_MESSAGE_ID)
	})
})
