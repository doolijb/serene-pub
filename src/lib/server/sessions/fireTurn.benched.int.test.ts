/**
 * 🚧 In play = live and not benched (owner 2026-11-10): a persona whose only
 * seat is benched is no person's turn here, and a benched player seat or
 * character seat is not in the turn plan.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-benched-turns-"))
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

async function world(bench: { persona?: boolean; character?: boolean }) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(testDb, `benched-turns-${++n}`)
	const [persona] = await testDb
		.insert(schema.characters)
		.values({ userId: u.id, name: "Elara", description: "A persona." } as any)
		.returning()
	const [npc] = await testDb
		.insert(schema.characters)
		.values({ userId: u.id, name: "Verity", description: "A card." } as any)
		.returning()
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId: u.id, isGroup: false, name: `Run ${++n}` } as any)
		.returning()
	await testDb.insert(schema.sessionPersonas).values({
		sessionId: s!.id,
		personaId: persona!.id,
		userId: u.id,
		isActive: !bench.persona
	} as any)
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: s!.id,
		characterId: npc!.id,
		isActive: !bench.character
	} as any)
	return { persona: persona!, npc: npc!, s: s! }
}

const entry = (ref: string) => ({ ref, via: "pick" }) as import("@serene-pub/sdk").TurnEntryV1

describe("fireTurn — a benched persona is still a person's", () => {
	test("entryIsPersons is true for an in-play persona seat and stays true once it is benched (shown, never generated)", async () => {
		// ⏳ Card form: the entry's own persona-seat read (member form's
		// `player-seat:` ref is a person's by definition).
		memberFormSwitch.on = false
		const { entryIsPersons } = await import("$lib/server/sessions/fireTurn")
		const live = await world({})
		expect(await entryIsPersons(db(), live.s.id, entry(`character:${live.persona.id}`))).toBe(true)
		const benched = await world({ persona: true })
		expect(await entryIsPersons(db(), benched.s.id, entry(`character:${benched.persona.id}`))).toBe(true)
	})
})

describe("storedTurnPlan — a benched seat is not in the plan", () => {
	test("a benched player seat and a benched character seat are not named by a speaker fact", async () => {
		const { storedTurnPlan } = await import("$lib/server/sessions/turnPlan")
		memberFormSwitch.on = false
		const live = await world({})
		const plan = { plan: { speakers: [{ name: "Elara" }, { name: "Verity" }] } }
		const all = await storedTurnPlan(db(), live.s.id, plan)
		expect(all?.turns).toEqual([`character:${live.persona.id}`, `character:${live.npc.id}`])
		const benched = await world({ persona: true, character: true })
		const none = await storedTurnPlan(db(), benched.s.id, plan)
		expect(none?.turns).toEqual([])
	})
})
