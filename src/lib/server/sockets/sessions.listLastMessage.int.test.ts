/**
 * `sessions:list` carries the session's last visible line.
 *
 * The home dashboard's "pick up where you left off" cards quote a session
 * without opening it, and the list is the only read that runs for all of them
 * at once — so the projection has to answer three things per session and get
 * them right for a list, not for one row: WHICH message is last, WHO said it,
 * and whether anything is owed to the person reading.
 *
 * What is pinned here is the projection's exclusions, because every one of them
 * is a line that would otherwise render: an in-flight generation (a blank
 * placeholder row), a hidden message, and a session composer draft — which is a
 * `sessions.drafts` entry rather than a message at all, and so must never reach
 * the card even though it is the newest thing the user typed.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-sessions-last-message-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

const noopEmit = () => {}

async function makeSession(userId: number, name: string) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name })
		.returning()
	return session
}

async function listFor(userId: number) {
	const { sessionsListHandler } = await import("./sessions")
	return sessionsListHandler.handler(fakeSocket(userId), {}, noopEmit)
}

describe("sessions:list — lastMessage projection (PGlite integration)", () => {
	test("projects the newest visible line, its speaker and whose turn it is", async () => {
		const owner = await makeUser("lastmsg-owner")
		const [persona] = await testDb
			.insert(schema.characters)
			.values({
				userId: owner.id,
				name: "Jody",
				description: "",
				isPersona: true,
				isDefaultPersona: true
			})
			.returning()
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Wren", description: "" })
			.returning()

		const withMessages = await makeSession(owner.id, "The Lantern Road")
		const empty = await makeSession(owner.id, "Nothing yet")

		// Oldest first, so "the newest" is a real choice rather than the
		// only row. The character speaks last, which is the "Your turn"
		// case the dashboard counts.
		await testDb.insert(schema.sessionMessages).values([
			{
				sessionId: withMessages.id,
				userId: owner.id,
				personaId: persona.id,
				role: "user",
				content: "Are we taking the right-hand road?"
			},
			{
				sessionId: withMessages.id,
				characterId: character.id,
				role: "assistant",
				content:
					"*a bell rings once*   Somewhere down the **right-hand** road, faint enough to doubt."
			}
		])

		const res = await listFor(owner.id)
		const rows = res!.sessionList
		const busy = rows.find((s) => s.id === withMessages.id)!
		const quiet = rows.find((s) => s.id === empty.id)!

		expect(busy.lastMessage).toBeDefined()
		// Markdown stripped, whitespace collapsed — the card renders this
		// as plain text.
		expect(busy.lastMessage!.excerpt).toBe(
			"a bell rings once Somewhere down the right-hand road, faint enough to doubt."
		)
		expect(busy.lastMessage!.speakerName).toBe("Wren")
		expect(busy.lastMessage!.isUser).toBe(false)
		expect(Number.isFinite(Date.parse(busy.lastMessage!.createdAt))).toBe(
			true
		)
		expect(busy.messageCount).toBe(2)

		expect(quiet.lastMessage).toBeUndefined()
		expect(quiet.messageCount).toBe(0)
	}, 60_000)

	test("a persona's line reads as the user's own", async () => {
		const owner = await makeUser("lastmsg-user-turn")
		const [persona] = await testDb
			.insert(schema.characters)
			.values({
				userId: owner.id,
				name: "Mara",
				description: "",
				isPersona: true,
				isDefaultPersona: true
			})
			.returning()
		const session = await makeSession(owner.id, "Coffee with Mara")

		await testDb.insert(schema.sessionMessages).values({
			sessionId: session.id,
			userId: owner.id,
			personaId: persona.id,
			role: "user",
			content: "You still haven't told me why you moved back."
		})

		const res = await listFor(owner.id)
		const row = res!.sessionList.find((s) => s.id === session.id)!
		expect(row.lastMessage!.isUser).toBe(true)
		expect(row.lastMessage!.speakerName).toBe("Mara")
	}, 60_000)

	test("a composer draft, an in-flight generation and a hidden message are all skipped", async () => {
		const owner = await makeUser("lastmsg-exclusions")
		const [character] = await testDb
			.insert(schema.characters)
			.values({
				userId: owner.id,
				name: "Brother Alder",
				description: ""
			})
			.returning()
		const session = await makeSession(owner.id, "The Chapel")

		await testDb.insert(schema.sessionMessages).values([
			{
				sessionId: session.id,
				characterId: character.id,
				role: "assistant",
				content: "The candles have not been lit since Tuesday."
			},
			{
				sessionId: session.id,
				characterId: character.id,
				role: "assistant",
				content: "Hidden by the owner.",
				isHidden: true
			},
			{
				// The placeholder a generation writes before any token
				// arrives: blank, and flagged.
				sessionId: session.id,
				characterId: character.id,
				role: "assistant",
				content: "",
				isGenerating: true
			},
			{
				// Blank on its own merits — nothing flags this one, so
				// only the emptiness test keeps it out of the card.
				sessionId: session.id,
				characterId: character.id,
				role: "assistant",
				content: "\n \t "
			}
		])
		// The newest thing in the session, and not a message: it must not
		// reach the card.
		await testDb
			.update(schema.sessions)
			.set({ drafts: { [String(owner.id)]: "a draft nobody sent" } })
			.where(eq(schema.sessions.id, session.id))

		const res = await listFor(owner.id)
		const row = res!.sessionList.find((s) => s.id === session.id)!
		expect(row.lastMessage!.excerpt).toBe(
			"The candles have not been lit since Tuesday."
		)
		// The count is every row, the same notion sessions:adminList
		// reports — only the QUOTED line is filtered.
		expect(row.messageCount).toBe(4)
	}, 60_000)

	test("a long line is cut to 160 characters", async () => {
		const owner = await makeUser("lastmsg-truncation")
		const session = await makeSession(owner.id, "The Long Road")
		await testDb.insert(schema.sessionMessages).values({
			sessionId: session.id,
			role: "assistant",
			content: `${"word ".repeat(80)}end`
		})

		const res = await listFor(owner.id)
		const row = res!.sessionList.find((s) => s.id === session.id)!
		expect(row.lastMessage!.excerpt).toHaveLength(160)
		expect(row.lastMessage!.excerpt.endsWith("…")).toBe(true)
	}, 60_000)
})
