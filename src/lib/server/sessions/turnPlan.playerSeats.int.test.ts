/**
 * 🚧 A turn plan names a player seat by its member (owner ruling 2026-11-05,
 * ★pT-1: "Everything in session is cast -> active card"): a speaker fact
 * matches the seat name first, then the member's name or nickname as read; a
 * seat name stays an answer beside them.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, insertCastMember, newCardVersion } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-turnplanseats-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const switchWas = memberFormSwitch.on
afterEach(() => {
	memberFormSwitch.on = switchWas
})

const db = () => testDb as unknown as Db
let n = 0

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(testDb, `turnplanseats-${++n}`)
	const [pia] = await testDb
		.insert(schema.characters)
		.values({ userId: u.id, name: "Pia", description: "The card." })
		.returning()
	const [b] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: u.id, name: `Book ${n}` } as any)
		.returning()
	const pm = (
		await insertCastMember(testDb, {
			lorebookId: b.id,
			characterId: pia.id,
			binding: `{{char:${n}}}`,
			name: "Pia",
			ownName: "Pia of the Book"
		} as any)
	).member
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: u.id,
			isGroup: false,
			name: `Run ${n}`,
			lorebookId: b.id
		} as any)
		.returning()
	const [seat] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId: s.id,
			personaId: pia.id,
			userId: u.id,
			castMemberId: pm.id
		} as any)
		.returning()
	return { pia, s, seat }
}

describe("storedTurnPlan — a player seat answers to its member", () => {
	test.each([false, true])("a speaker fact naming the member's own name is the player seat's turn, and a wait (member form %s)", async (on) => {
		memberFormSwitch.on = on
		const { storedTurnPlan } = await import("$lib/server/sessions/turnPlan")
		const { pia, s, seat } = await world()
		// ⏳ Card form while the flip is off; the player seat's `player-seat:<id>` once it is on.
		const ref = on ? `player-seat:${seat.id}` : `character:${pia.id}`
		const out = await storedTurnPlan(db(), s.id, {
			plan: { speakers: [{ name: "Pia of the Book" }] }
		})
		expect(out?.turns).toEqual([ref])
		expect(out?.waits).toEqual([ref])
		// The card's own name is the member's no longer.
		const byCard = await storedTurnPlan(db(), s.id, {
			plan: { speakers: [{ name: "Pia" }] }
		})
		expect(byCard?.turns).toEqual([])
	})

	test.each([false, true])("a seat name still answers, beside the member's name (member form %s)", async (on) => {
		memberFormSwitch.on = on
		const { storedTurnPlan } = await import("$lib/server/sessions/turnPlan")
		const { pia, s, seat } = await world()
		await testDb
			.update(schema.sessionPersonas)
			.set({ seatName: "Mistress Pia" })
			.where(eq(schema.sessionPersonas.id, seat.id))
		const ref = on ? `player-seat:${seat.id}` : `character:${pia.id}`
		for (const name of ["Mistress Pia", "Pia of the Book"]) {
			const out = await storedTurnPlan(db(), s.id, {
				plan: { speakers: [{ name }] }
			})
			expect(out?.turns).toEqual([ref])
		}
	})

	test("a character seat with no member is named by its card's current version, not the copy", async () => {
		const { storedTurnPlan } = await import("$lib/server/sessions/turnPlan")
		const { profileOf } = await import("$lib/shared/characters/profile")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const u = await createTestUser(testDb, `turnplanseats-${++n}`)
		const { card, version } = await insertCard(testDb, {
			userId: u.id,
			name: "Tam",
			description: ""
		})
		await newCardVersion(testDb, card.id, { ...profileOf(version), name: "Tam Vale" })
		// A stale copy: the ⏳ column no reader trusts.
		await testDb
			.update(schema.characters)
			.set({ name: "Stale Tam" })
			.where(eq(schema.characters.id, card.id))
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, name: `Run ${n}` } as any)
			.returning()
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: card.id } as any)
		const now = await storedTurnPlan(db(), s.id, {
			plan: { speakers: [{ name: "Tam Vale" }] }
		})
		expect(now?.turns).toEqual([`character:${card.id}`])
		const stale = await storedTurnPlan(db(), s.id, {
			plan: { speakers: [{ name: "Stale Tam" }] }
		})
		expect(stale?.turns).toEqual([])
	})
})
