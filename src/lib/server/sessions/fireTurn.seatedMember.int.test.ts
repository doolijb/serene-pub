/**
 * 🚧 A turn entry naming `seated-member:<memberId>` (plan §27 S2, lane
 * s27-S2-turns): judged and fired as the seat's card form, and refused —
 * never thrown — when nobody in the session is seated as that member.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
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
		path.join(os.tmpdir(), "serene-pub-vitest-s27turns-fire-")
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

async function fixture() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(testDb, `s27turns-fire-${++n}`)
	const [npc] = await testDb
		.insert(schema.characters)
		.values({ userId: u.id, name: "Verity", description: "A card." } as any)
		.returning()
	const [persona] = await testDb
		.insert(schema.characters)
		.values({
			userId: u.id,
			name: "Elara",
			description: "A persona."
		} as any)
		.returning()
	const [b] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: u.id, name: `Book ${++n}` } as any)
		.returning()
	const [npcMember] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: b!.id,
			characterId: npc!.id,
			binding: `{{char:${++n}}}`,
			name: "npc member"
		} as any)
		.returning()
	const [personaMember] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: b!.id,
			characterId: persona!.id,
			binding: `{{char:${++n}}}`,
			name: "persona member"
		} as any)
		.returning()
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: u.id,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId: b!.id
		} as any)
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: s!.id,
		characterId: npc!.id,
		castMemberId: npcMember!.id
	} as any)
	await testDb.insert(schema.sessionPersonas).values({
		sessionId: s!.id,
		personaId: persona!.id,
		castMemberId: personaMember!.id,
		userId: u.id
	} as any)
	return {
		u,
		npc: npc!,
		persona: persona!,
		npcMember: npcMember!,
		personaMember: personaMember!,
		session: s!
	}
}

const entry = (ref: string | null) =>
	({ ref, via: "pick" }) as import("@serene-pub/sdk").TurnEntryV1

describe("a seated-member entry is the seat's card form", () => {
	test("entryIsPersons judges a player seat's member as a person's turn, and a character seat's member as not", async () => {
		const { entryIsPersons } = await import("$lib/server/sessions/fireTurn")
		const f = await fixture()
		const personaRef = `seated-member:${f.personaMember.id}`
		const npcRef = `seated-member:${f.npcMember.id}`
		expect(
			await entryIsPersons(db(), f.session.id, entry(personaRef))
		).toBe(true)
		expect(await entryIsPersons(db(), f.session.id, entry(npcRef))).toBe(
			false
		)
		// The same answers as the card forms they translate to.
		expect(
			await entryIsPersons(
				db(),
				f.session.id,
				entry(`character:${f.persona.id}`)
			)
		).toBe(true)
		expect(
			await entryIsPersons(
				db(),
				f.session.id,
				entry(`character:${f.npc.id}`)
			)
		).toBe(false)
	})

	test("the translated ref is the card's (switch off)", async () => {
		memberFormSwitch.on = false
		const { storedSeatRef } = await import(
			"$lib/server/state/seatRefs"
		)
		const f = await fixture()
		expect(
			await storedSeatRef(
				db(),
				f.session.id,
				`seated-member:${f.npcMember.id}`
			)
		).toBe(`character:${f.npc.id}`)
		expect(
			await storedSeatRef(
				db(),
				f.session.id,
				`seated-member:${f.personaMember.id}`
			)
		).toBe(`character:${f.persona.id}`)
	})

	test("switch on: the translated ref is the member's, a player seat's is its seat; a card form in is translated to member form", async () => {
		memberFormSwitch.on = true
		const { storedSeatRef } = await import("$lib/server/state/seatRefs")
		const f = await fixture()
		const [personaSeat] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, f.session.id))
		expect(
			await storedSeatRef(
				db(),
				f.session.id,
				`seated-member:${f.npcMember.id}`
			)
		).toBe(`seated-member:${f.npcMember.id}`)
		expect(
			await storedSeatRef(
				db(),
				f.session.id,
				`seated-member:${f.personaMember.id}`
			)
		).toBe(`player-seat:${personaSeat!.id}`)
		expect(
			await storedSeatRef(db(), f.session.id, `character:${f.npc.id}`)
		).toBe(`seated-member:${f.npcMember.id}`)
	})

	test("fireTurnEntry shows a player seat's member as a person's turn, as its card form does", async () => {
		const { fireTurnEntry } = await import("$lib/server/sessions/fireTurn")
		const f = await fixture()
		const asMember = await fireTurnEntry(db(), {
			sessionId: f.session.id,
			userId: f.u.id,
			entry: entry(`seated-member:${f.personaMember.id}`),
			cause: { kind: "user", userId: f.u.id } as any
		})
		const asCard = await fireTurnEntry(db(), {
			sessionId: f.session.id,
			userId: f.u.id,
			entry: entry(`character:${f.persona.id}`),
			cause: { kind: "user", userId: f.u.id } as any
		})
		expect(asMember).toEqual({ fired: false, reason: "person" })
		expect(asMember).toEqual(asCard)
	})

	test("a seated-member nobody is seated as is refused, not thrown", async () => {
		const { fireTurnEntry, entryIsPersons } = await import(
			"$lib/server/sessions/fireTurn"
		)
		const f = await fixture()
		const stranger = `seated-member:${f.npcMember.id + 9999}`
		const out = await fireTurnEntry(db(), {
			sessionId: f.session.id,
			userId: f.u.id,
			entry: entry(stranger),
			cause: { kind: "user", userId: f.u.id } as any
		})
		expect(out.fired).toBe(false)
		expect(typeof out.reason).toBe("string")
		expect(await entryIsPersons(db(), f.session.id, entry(stranger))).toBe(
			false
		)
	})
})
