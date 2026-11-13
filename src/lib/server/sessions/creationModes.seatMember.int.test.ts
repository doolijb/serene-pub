/**
 * 🚧 A next chapter carries a character's attributes by the seat's member
 * (plan §27, S2): a `session_cast` value declared `nextChapter: true` goes to
 * the new session's seat that holds the same cast member, whatever card that
 * seat holds; where the member is not shared, the card match still carries
 * (the two sessions' own books hold different members), and a seat with
 * neither match carries nothing.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { memberFormOn } from "$lib/server/state/memberForm"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import { insertLegacy } from "$lib/server/messages/store"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-creation-seat-member-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const RENOWN = "test:slot/chapter-renown@1"
const renown = defineAttributeSlot(RENOWN, {
	type: "integer",
	label: { en: "Renown" },
	descriptor: "How well known they are.",
	appliesTo: ["cast"],
	config: { min: 0, max: 100 },
	default: 0,
	nextChapter: true
})
const GENRE = "test:genre/chapter-seat-member"
genreKeeping(GENRE, {
	name: { en: "Chapter seat member" },
	family: "test",
	slots: [renown],
	events: {}
})

let n = 0
const db = () => testDb as unknown as Db

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `chapter-seat-member-${++n}`))!
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "…" } as any)
		.returning()
	return row!
}

async function member(lorebookId: number, characterId: number) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			binding: `{{char:${++n}}}`,
			characterId,
			name: ""
		})
		.returning()
	return row!
}

/** A session over a fresh book. */
async function session(userId: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` })
		.returning()
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: true,
			name: `Run ${n}`,
			genreId: GENRE,
			lorebookId: book!.id
		})
		.returning()
	return { session: row!, book: book! }
}

const seat = async (
	sessionId: number,
	characterId: number,
	castMemberId: number
) =>
	(
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId, castMemberId, position: 0 })
			.returning()
	)[0]!

/** A line a card spoke: the anchor its state is written on. */
const speak = (sessionId: number, characterId: number) =>
	insertLegacy(db(), {
		sessionId,
		role: "assistant",
		characterId,
		content: "…",
		channel: "main"
	})

/** Renown 40 on the card, in the old session; then the next chapter's seeding. */
async function carryFrom(
	userId: number,
	from: Awaited<ReturnType<typeof session>>,
	cardId: number,
	into: Awaited<ReturnType<typeof session>>,
	intoCardId: number
) {
	const fromLine = await speak(from.session.id, cardId)
	const intoLine = await speak(into.session.id, intoCardId)
	const { applyChangeSet } = await import("$lib/server/state/write")
	// `applyChangeSet` stores the owner it is given (it is not a door), so the
	// fixture writes the old seat's own owner: its member when the switch is on.
	const [fromSeat] = await testDb
		.select()
		.from(schema.sessionCharacters)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, from.session.id),
				eq(schema.sessionCharacters.characterId, cardId)
			)
		)
	const fromOwner = memberFormOn()
		? { kind: "seated_member" as const, id: fromSeat!.castMemberId! }
		: { kind: "session_cast" as const, id: cardId }
	await applyChangeSet(
		db(),
		{
			sessionId: from.session.id,
			updatedBy: "user",
			userId,
			messageId: fromLine.id
		},
		[
			{
				owner: fromOwner,
				slotId: RENOWN,
				value: 40
			}
		],
		{ mode: "apply" }
	)
	const { seedNextChapter } = await import("./creationModes")
	await seedNextChapter(db(), {
		fromSessionId: from.session.id,
		sessionId: into.session.id,
		userId,
		anchorMessageId: intoLine.id
	})
	return testDb
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.sessionId, into.session.id),
				inArray(schema.attributeValues.ownerKind, [
					"session_cast",
					"seated_member"
				]),
				eq(schema.attributeValues.slotId, RENOWN)
			)
		)
}

describe("a next chapter carries a character's attributes by the seat's member", () => {
	test("the new seat holds the same member under another card: the value lands on that seat's card", async () => {
		const u = await user()
		const a = await card(u.id, "Aria")
		const b = await card(u.id, "Bram")
		const from = await session(u.id)
		const into = await session(u.id)
		const shared = await member(from.book.id, a.id)
		await seat(from.session.id, a.id, shared.id)
		const intoSeat = await seat(into.session.id, b.id, shared.id)

		const rows = await carryFrom(u.id, from, a.id, into, b.id)
		// Member form (switch on): the value lands on the into-seat's member.
		expect(
			rows.map((r) => [
				r.ownerKind,
				r.ownerId,
				(r.value as any).v ?? r.value
			])
		).toEqual([["seated_member", intoSeat.castMemberId, 40]])
	})

	test("different members, the same card: the card match still carries", async () => {
		const u = await user()
		const a = await card(u.id, "Aria")
		const from = await session(u.id)
		const into = await session(u.id)
		const oldMember = await member(from.book.id, a.id)
		const newMember = await member(into.book.id, a.id)
		await seat(from.session.id, a.id, oldMember.id)
		const intoSeat = await seat(into.session.id, a.id, newMember.id)

		const rows = await carryFrom(u.id, from, a.id, into, a.id)
		expect(
			rows.map((r) => [
				r.ownerKind,
				r.ownerId,
				(r.value as any).v ?? r.value
			])
		).toEqual([["seated_member", intoSeat.castMemberId, 40]])
	})

	test("different members and different cards: nothing carries", async () => {
		const u = await user()
		const a = await card(u.id, "Aria")
		const b = await card(u.id, "Bram")
		const from = await session(u.id)
		const into = await session(u.id)
		const oldMember = await member(from.book.id, a.id)
		const newMember = await member(into.book.id, b.id)
		await seat(from.session.id, a.id, oldMember.id)
		await seat(into.session.id, b.id, newMember.id)

		expect(await carryFrom(u.id, from, a.id, into, b.id)).toEqual([])
	})
})
