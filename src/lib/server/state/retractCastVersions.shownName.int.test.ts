/**
 * 🚧 The stored member name follows Back and Forward (S4 tidy): a story-written
 * rename on Main is written back to `lorebook_bindings.name` and taken back
 * with Back; Forward puts it again. A second identical call writes nothing.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, max } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import {
	insertCard,
	insertCastMember,
	writeBackShownName,
	writeCastVersion,
	type CastVersionChanges
} from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cv-shown-name-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const GENRE = "test:genre/cv-shown-name"
let n = 0
const db = () => testDb as unknown as Db

async function world() {
	_clearAttributeSlots()
	genreKeeping(GENRE, {
		name: { en: "Retract cast versions" },
		family: "test",
		slots: [],
		events: {}
	})
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `cvt-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` })
		.returning()
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Card ${suffix}`,
		description: "The card's description."
	})
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: card.id,
		name: `Ada ${suffix}`
	})
	const session = await newSession(user.id, {
		lorebookId: book!.id,
		storyClockYear: 5,
		storyClockMonth: 1,
		storyClockDay: 1,
		storyClockHour: 9,
		storyClockMinute: 30
	})
	return { user, book: book!, member, base: base!, session }
}
type World = Awaited<ReturnType<typeof world>>

async function newSession(
	userId: number,
	extra: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			genreId: GENRE,
			...extra
		})
		.returning()
	return row!
}

/** A live line of the session, written through the message store (both worlds). */
async function line(
	sessionId: number,
	userId: number,
	role: "user" | "assistant",
	origin?: { sessionId: number; messageId: number }
): Promise<number> {
	const { insertLegacy } = await import("$lib/server/messages/store")
	const row = await insertLegacy(db(), {
		sessionId,
		role,
		userId: role === "user" ? userId : null,
		content: `${role} line ${++n}`,
		...(origin
			? {
					originSessionId: origin.sessionId,
					originMessageId: origin.messageId
				}
			: {})
	} as any)
	return row.id
}

/** A parent session holding a person's line and a reply; the reply `anchor` is the newest. */

const nameOf = async (id: number) =>
	(
		await testDb
			.select({ name: schema.lorebookBindings.name })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, id))
	)[0]!.name

describe("the stored name over Back and Forward", () => {
	test("Back puts the base name back, Forward the renamed one; a repeat writes nothing", async () => {
		const w = await world()
		await line(w.session.id, w.user.id, "user")
		await line(w.session.id, w.user.id, "assistant")
		// The member follows its card's name: that is what it reads without the rename.
		const baseName = (
			await testDb
				.select({ name: schema.characters.name })
				.from(schema.characters)
				.where(eq(schema.characters.id, w.member.characterId!))
		)[0]!.name
		await testDb.transaction((tx) =>
			writeCastVersion(tx as unknown as Db, {
				member: w.member.id,
				changes: { name: "Ada Renamed" },
				writtenBy: `run:${w.session.id}`,
				session: { id: w.session.id }
			})
		)
		expect(await nameOf(w.member.id)).toBe("Ada Renamed")

		const { rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		expect(
			await rewindTurn(db(), {
				sessionId: w.session.id,
				userId: w.user.id
			})
		).toMatchObject({ ok: true })
		expect(await nameOf(w.member.id)).toBe(baseName)

		expect(
			await forwardTurn(db(), {
				sessionId: w.session.id,
				userId: w.user.id
			})
		).toMatchObject({ ok: true })
		expect(await nameOf(w.member.id)).toBe("Ada Renamed")

		const before = (
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, w.member.id))
		)[0]
		await testDb.transaction((tx) =>
			writeBackShownName(tx as unknown as Db, w.member.id)
		)
		const after = (
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, w.member.id))
		)[0]
		expect(after).toEqual(before)
	})
})
