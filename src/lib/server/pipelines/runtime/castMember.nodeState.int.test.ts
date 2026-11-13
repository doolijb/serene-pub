/**
 * 🚧 A pipeline's `{ nodeState }` write to a cast member: dated at the
 * session's story time, tied to the turn, and taken by Back.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import { writeCastMember } from "./castMember"

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
		path.join(os.tmpdir(), "serene-pub-vitest-castmember-state-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const GENRE = "test:genre/cast-member-state"
let n = 0
const db = () => testDb as unknown as Db

async function world() {
	_clearAttributeSlots()
	genreKeeping(GENRE, {
		name: { en: "Cast member state" },
		family: "test",
		slots: [],
		events: {}
	})
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `cms-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` })
		.returning()
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Card ${suffix}`,
		description: "The card's description."
	})
	const { member } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: card.id,
		name: `Ada ${suffix}`
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId: GENRE,
			lorebookId: book!.id,
			storyClockYear: 5,
			storyClockMonth: 3,
			storyClockDay: 7,
			storyClockHour: 9,
			storyClockMinute: 30
		})
		.returning()
	return { user, member, session: session! }
}

async function line(
	sessionId: number,
	userId: number,
	role: "user" | "assistant"
): Promise<number> {
	const { insertLegacy } = await import("$lib/server/messages/store")
	const row = await insertLegacy(db(), {
		sessionId,
		role,
		userId: role === "user" ? userId : null,
		content: `${role} line ${++n}`
	} as any)
	return row.id
}

const stateRead = async (w: Awaited<ReturnType<typeof world>>) => {
	const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
	return (
		await membersAsRead(db(), [w.member.id], { sessionId: w.session.id })
	).get(w.member.id)!.nodeState
}

describe("nodeState from a pipeline", () => {
	test("dated at the story clock, tied to the turn, taken by Back", async () => {
		const w = await world()
		await line(w.session.id, w.user.id, "user")
		const anchor = await line(w.session.id, w.user.id, "assistant")
		expect(await stateRead(w)).toBe("active")

		const out = await writeCastMember(db(), {
			sessionId: w.session.id,
			member: w.member.id,
			changes: { nodeState: "deceased" },
			runId: w.session.id,
			messageId: anchor
		})
		const [row] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, out.castVersionId))
		expect(row!.nodeState).toBe("deceased")
		expect(row!.sourceMessageId).toBe(anchor)
		expect([row!.year, row!.month, row!.day]).toEqual([5, 3, 7])
		expect(await stateRead(w)).toBe("deceased")

		const { rewindTurn } = await import("$lib/server/sessions/rewind")
		const back = await rewindTurn(db(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(back).toMatchObject({ ok: true })
		const gone = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, out.castVersionId))
		expect(gone).toHaveLength(0)
		expect(await stateRead(w)).toBe("active")
	})
})
