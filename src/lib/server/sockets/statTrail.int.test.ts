/**
 * `sessions:statTrail` (PLAN-core-widgets §3.10, F2): the Stats widget's
 * door to a stat's **stat trail**. Anyone in the session reads the changes
 * the session made to one owner's slot, oldest first — each with its
 * message, what it read before (the book's last recorded value for the
 * first, when the session reads a book that holds the owner) and who wrote
 * it (`user` · `model` for a turn's run · `pipeline` for anything else). A
 * session with no book reads its own rows alone. `limit` keeps the newest.
 * A stranger is refused in words, and the ask's token comes back either way.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	genre,
	_clearAttributeSlots
} from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-stat-trail-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	declareSlots()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const WEATHER = "core:slot/weather@1"
const GENRE = "test:genre/stat-trail-widget"

function declareSlots() {
	_clearAttributeSlots()
	const hp = defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 100 },
		default: 20
	})
	const weather = defineAttributeSlot(WEATHER, {
		type: "enum",
		descriptor: "What the sky is doing.",
		appliesTo: ["world"],
		config: { of: ["clear", "storm"] }
	})
	genreKeeping(GENRE, {
		name: { en: "Stat trail widget" },
		family: "test",
		slots: [hp, weather],
		customAttributes: "allow",
		events: {}
	})
}

let n = 0

async function fixture(opts: { book: boolean }) {
	const tag = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `stat-trail-owner-${tag}`)
	const guest = await createTestUser(testDb, `stat-trail-guest-${tag}`)
	const stranger = await createTestUser(testDb, `stat-trail-stranger-${tag}`)
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: `Verity ${tag}`, description: "…" })
		.returning()
	let lorebookId: number | null = null
	let bindingId: number | null = null
	if (opts.book) {
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: owner.id, name: `World ${tag}` })
			.returning()
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book.id,
				characterId: verity.id,
				binding: `{{char:${verity.id}}}`,
				name: verity.name
			})
			.returning()
		lorebookId = book.id
		bindingId = binding.id
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			name: `Run ${tag}`,
			genreId: GENRE,
			lorebookId
		})
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: verity.id })
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id })
	return { owner, guest, stranger, verity, session, lorebookId, bindingId }
}

async function message(sessionId: number, characterId: number) {
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", characterId, content: "…" })
		.returning()
	await testDb
		.insert(schema.messages)
		.values({ id: legacy.id, sessionId, characterId, role: "assistant" })
	return legacy.id
}

const played = (
	sessionId: number,
	ownerKind: "session" | "session_cast" | "session_location",
	ownerId: number,
	slotId: string,
	v: unknown,
	messageId: number,
	updatedBy: string
) =>
	testDb.insert(schema.attributeValues).values({
		ownerKind,
		ownerId,
		slotId,
		value: { v },
		sessionId,
		validFromMessageId: messageId,
		updatedBy
	})

async function ask(userId: number, params: Record<string, unknown>) {
	const { sessionsStatTrail } = await import("./statTrail")
	const emits: Array<[string, any]> = []
	await sessionsStatTrail.handler(
		{ user: { id: userId, isAdmin: false } } as any,
		params as any,
		(event: string, data: any) => emits.push([event, data])
	)
	return emits
}

const changesOf = (emits: Array<[string, any]>) =>
	emits
		.find(([event]) => event === "sessions:statTrail")?.[1]
		.trail.changes.map((c: any) => [c.messageId, c.from, c.to, c.by])

describe("sessions:statTrail — one stat's changes in a session", () => {
	test("each change with its message, what it read before and who wrote it; the book's value first", async () => {
		const f = await fixture({ book: true })
		// The book's own value for the cast member: what the session inherited.
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "cast_member",
			ownerId: f.bindingId!,
			slotId: HP,
			value: { v: 20 },
			sessionId: null,
			updatedBy: "user"
		})
		const m1 = await message(f.session.id, f.verity.id)
		const m2 = await message(f.session.id, f.verity.id)
		const m3 = await message(f.session.id, f.verity.id)
		await played(
			f.session.id,
			"session_cast",
			f.verity.id,
			HP,
			18,
			m1,
			"run:abc"
		)
		await played(
			f.session.id,
			"session_cast",
			f.verity.id,
			HP,
			12,
			m2,
			"user"
		)
		await played(
			f.session.id,
			"session_cast",
			f.verity.id,
			HP,
			7,
			m3,
			"script:tick"
		)

		const owner = { kind: "session_cast", id: f.verity.id }
		const emits = await ask(f.owner.id, {
			sessionId: f.session.id,
			request: "t-1",
			owner,
			slotId: "hp"
		})
		expect(changesOf(emits)).toEqual([
			[m1, 20, 18, "model"],
			[m2, 18, 12, "user"],
			[m3, 12, 7, "pipeline"]
		])
		const reply = emits[0]![1]
		expect(reply).toMatchObject({ sessionId: f.session.id, request: "t-1" })
		expect(typeof reply.trail.changes[0].at).toBe("number")
		expect(reply.trail.changes[0].at).toBeGreaterThan(0)

		// A guest reads it too; `limit` keeps the newest, each still with what it replaced.
		const limited = await ask(f.guest.id, {
			sessionId: f.session.id,
			owner,
			slotId: HP,
			limit: 2
		})
		expect(changesOf(limited)).toEqual([
			[m2, 18, 12, "user"],
			[m3, 12, 7, "pipeline"]
		])
	})

	test("a session with no book reads its own rows alone; an untracked slot or another session's owner has none", async () => {
		const f = await fixture({ book: false })
		const m1 = await message(f.session.id, f.verity.id)
		const m2 = await message(f.session.id, f.verity.id)
		await played(
			f.session.id,
			"session",
			f.session.id,
			WEATHER,
			"clear",
			m1,
			"run:r1"
		)
		await played(
			f.session.id,
			"session",
			f.session.id,
			WEATHER,
			"storm",
			m2,
			"run:r2"
		)
		expect(
			changesOf(
				await ask(f.owner.id, {
					sessionId: f.session.id,
					owner: { kind: "session", id: f.session.id },
					slotId: "weather"
				})
			)
		).toEqual([
			[m1, null, "clear", "model"],
			[m2, "clear", "storm", "model"]
		])
		expect(
			changesOf(
				await ask(f.owner.id, {
					sessionId: f.session.id,
					owner: { kind: "session", id: f.session.id },
					slotId: "test:slot/nothing@1"
				})
			)
		).toEqual([])
		expect(
			changesOf(
				await ask(f.owner.id, {
					sessionId: f.session.id,
					owner: { kind: "session", id: f.session.id + 1000 },
					slotId: "weather"
				})
			)
		).toEqual([])
	})

	test("a stranger, or an owner that is not one, is refused in words with the token back", async () => {
		const f = await fixture({ book: false })
		const owner = { kind: "session_cast", id: f.verity.id }
		const strange = await ask(f.stranger.id, {
			sessionId: f.session.id,
			request: "t-2",
			owner,
			slotId: "hp"
		})
		expect(strange).toEqual([
			[
				"sessions:statTrail:error",
				{
					sessionId: f.session.id,
					request: "t-2",
					error: "This session is not one you are in."
				}
			]
		])
		const bad = await ask(f.owner.id, {
			sessionId: f.session.id,
			owner: { kind: "cast_member", id: 1 },
			slotId: "hp"
		})
		expect(bad[0]![0]).toBe("sessions:statTrail:error")
		expect(bad[0]![1].error).toBe("Name the stat's owner in this session.")
	})
})
