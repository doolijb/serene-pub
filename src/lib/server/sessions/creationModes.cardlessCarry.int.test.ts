/**
 * 🚧 A next chapter carries a card-less character seat's `nextChapter` stat by
 * its member (S4 tidy): to the new session's seat on the same member; a member
 * not seated there carries nothing.
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
		path.join(os.tmpdir(), "serene-pub-vitest-creation-cardless-carry-")
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
const GENRE = "test:genre/chapter-cardless-carry"
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
	return (await createTestUser(testDb, `chapter-cardless-carry-${++n}`))!
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "…" } as any)
		.returning()
	return row!
}

async function cardless(lorebookId: number, name: string) {
	const { insertCastMember } = await import("$lib/server/characters/versions")
	return (
		await insertCastMember(testDb, {
			lorebookId,
			binding: `{{char:c${++n}}}`,
			characterId: null,
			name,
			ownName: name
		} as any)
	).member!
}

async function session(userId: number, lorebookId?: number) {
	const [book] = lorebookId
		? []
		: await testDb
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
			lorebookId: lorebookId ?? book!.id
		})
		.returning()
	return { session: row!, bookId: lorebookId ?? book!.id }
}

const seat = async (sessionId: number, castMemberId: number, userId: number) =>
	(
		await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId,
				characterId: null,
				castMemberId,
				position: 0,
				seatedByUserId: userId
			} as any)
			.returning()
	)[0]!

const line = (sessionId: number, userId: number) =>
	insertLegacy(db(), {
		sessionId,
		role: "user",
		userId,
		content: "…",
		channel: "main"
	} as any)

async function carry(
	userId: number,
	bookId: number,
	memberId: number,
	intoMember: number | null
) {
	const from = await session(userId, bookId)
	const into = await session(userId, bookId)
	await seat(from.session.id, memberId, userId)
	if (intoMember != null) await seat(into.session.id, intoMember, userId)
	const fromLine = await line(from.session.id, userId)
	const intoLine = await line(into.session.id, userId)
	const { applyChangeSet } = await import("$lib/server/state/write")
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
				owner: { kind: "seated_member", id: memberId },
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
				eq(schema.attributeValues.ownerKind, "seated_member"),
				eq(schema.attributeValues.slotId, RENOWN)
			)
		)
}

describe("a next chapter carries a card-less seat's stat by its member", () => {
	test("the new session seats the same member: the value lands on that seat", async () => {
		const u = await user()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: `Shared ${++n}` })
			.returning()
		const m = await cardless(book!.id, "Ash")
		const rows = await carry(u.id, book!.id, m.id, m.id)
		expect(
			rows.map((r) => [r.ownerId, (r.value as any).v ?? r.value])
		).toEqual([[m.id, 40]])
	})

	test("a member not seated in the new session carries nothing", async () => {
		const u = await user()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: `Shared ${++n}` })
			.returning()
		const m = await cardless(book!.id, "Ash")
		const other = await cardless(book!.id, "Birch")
		const rows = await carry(u.id, book!.id, m.id, other.id)
		expect(rows).toEqual([])
	})
})
