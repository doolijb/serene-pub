/**
 * `sessions:places` (PLAN-core-widgets W4): the Places widget's door. Anyone
 * in the session reads the places as the session reads its book — a place
 * switched Off, archived or renamed by its line's amendments read as the
 * session has it — with each category's tint dealt as the lens deals it, the
 * ways between them said from each end (never a secret one), and what else
 * the book links to a place (a keeper), never a character's own lore. A
 * stranger is refused in words, and the ask's token comes back either way.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	CHARACTER_LORE_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-session-places-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A socket whose replies are recorded. */
const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: false } }) as any

async function ask(userId: number, params: Record<string, unknown>) {
	const { sessionsPlaces } = await import("./sessionPlaces")
	const emits: Array<[string, any]> = []
	await sessionsPlaces.handler(
		fakeSocket(userId),
		params as any,
		(event: string, data: any) => emits.push([event, data])
	)
	return emits
}

async function fixture(tag: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `places-owner-${tag}`)
	const guest = await createTestUser(testDb, `places-guest-${tag}`)
	const stranger = await createTestUser(testDb, `places-stranger-${tag}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner!.id, name: `Keep ${tag}` })
		.returning()
	let position = 0
	const entry = async (
		title: string,
		extra: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId: LOCATION_TYPE_ID,
					typeVersion: 1,
					position: position++,
					title,
					content: `About ${title}.`,
					...extra
				})
				.returning()
		)[0]!.id
	const e = {
		guardroom: await entry("Guardroom", {
			fields: { category: "Upper floor" }
		}),
		hall: await entry("Drowned Hall", { fields: { category: "cellars" } }),
		crypt: await entry("Crypt", { fields: { category: "Cellars" } }),
		well: await entry("Well"),
		// Off: the book's map draws it (its category deals a tint); the session does not.
		attic: await entry("Attic", {
			enabled: false,
			fields: { category: "Attic" }
		}),
		vault: await entry("Vault", { fields: { category: "Cellars" } }),
		guild: await entry("The Iron Guild", { typeId: WORLD_LORE_TYPE_ID }),
		secret: await entry("Mira's fear", { typeId: CHARACTER_LORE_TYPE_ID })
	}
	// Archived and renamed, each by the line's amendment.
	await testDb.insert(schema.entryAmendments).values([
		{
			lorebookId: book!.id,
			entryId: e.vault,
			year: 5,
			fields: { archived: true }
		},
		{
			lorebookId: book!.id,
			entryId: e.guardroom,
			year: 5,
			fields: { name: "Watch Room" }
		}
	] as any)
	const [verity] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: book!.id, binding: "{{char:1}}", name: "Verity" })
		.returning()
	const rel = (values: Record<string, unknown>) =>
		testDb
			.insert(schema.narrativeRelationships)
			.values({ lorebookId: book!.id, ...values } as any)
			.returning()
	const [door] = await rel({
		fromEntryId: e.guardroom,
		toEntryId: e.hall,
		relationshipType: "leads north to",
		reverseRelationshipType: "leads south to",
		title: "the rusted iron door"
	})
	const [stair] = await rel({
		fromEntryId: e.hall,
		toEntryId: e.crypt,
		relationshipType: "leads down to"
	})
	// A secret way, a way to an Off room and one to an archived room: none is the session's.
	await rel({
		fromEntryId: e.hall,
		toEntryId: e.well,
		relationshipType: "leads to",
		visibility: "secret"
	})
	await rel({
		fromEntryId: e.hall,
		toEntryId: e.attic,
		relationshipType: "leads up to"
	})
	await rel({
		fromEntryId: e.hall,
		toEntryId: e.vault,
		relationshipType: "leads to"
	})
	// The keeper, a faction, and a character's own lore.
	await rel({
		fromNodeId: verity!.id,
		toEntryId: e.crypt,
		relationshipType: "keeps"
	})
	await rel({
		fromEntryId: e.guild,
		toEntryId: e.crypt,
		relationshipType: "owns"
	})
	await rel({
		fromEntryId: e.secret,
		toEntryId: e.crypt,
		relationshipType: "haunts"
	})

	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner!.id,
			isGroup: false,
			name: "Delve",
			lorebookId: book!.id
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest!.id } as any)
	const [bare] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner!.id, isGroup: false, name: "No book" } as any)
		.returning()
	return {
		owner: owner!,
		guest: guest!,
		stranger: stranger!,
		book: book!,
		session: session!,
		bare: bare!,
		e,
		door: door!,
		stair: stair!,
		verity: verity!
	}
}

describe("the Places widget's door", () => {
	test("the places the session sees, tinted as the lens deals them, the ways said from each end, what is linked", async () => {
		const f = await fixture("a")
		const [reply] = await ask(f.owner.id, {
			sessionId: f.session.id,
			request: "p1"
		})
		expect(reply![0]).toBe("sessions:places")
		expect(reply![1]).toMatchObject({
			sessionId: f.session.id,
			request: "p1"
		})
		const places = reply![1].places
		expect(places.lorebookId).toBe(f.book.id)
		expect(places.asOf).toBeNull()

		// Entry order; Off and archived left out; the amended name read.
		expect(
			places.places.map((p: any) => [p.id, p.name, p.category, p.tint])
		).toEqual([
			// The book's live categories, sorted: Attic (0), cellars (1), Upper floor (2) —
			// "cellars" as first written, the Crypt's "Cellars" the same category.
			[f.e.guardroom, "Watch Room", "Upper floor", 2],
			[f.e.hall, "Drowned Hall", "cellars", 1],
			[f.e.crypt, "Crypt", "Cellars", 1],
			[f.e.well, "Well", null, null]
		])

		expect(places.ways).toEqual([
			{
				id: f.door.id,
				from: f.e.guardroom,
				to: f.e.hall,
				bothWays: true,
				name: "the rusted iron door",
				fromSays: "The rusted iron door leads north to Drowned Hall.",
				toSays: "The rusted iron door leads south to Watch Room."
			},
			{
				id: f.stair.id,
				from: f.e.hall,
				to: f.e.crypt,
				bothWays: false,
				name: null,
				fromSays: "Leads down to Crypt.",
				toSays: null
			}
		])

		const crypt = places.places.find((p: any) => p.id === f.e.crypt)
		expect(crypt.linked).toEqual([
			{
				kind: "cast",
				id: f.verity.id,
				name: "Verity",
				says: "Verity keeps Crypt."
			},
			{
				kind: "entry",
				id: f.e.guild,
				name: "The Iron Guild",
				says: "The Iron Guild owns Crypt."
			}
		])
	})

	test("a guest reads them too; a stranger is refused in words; a session with no book has none", async () => {
		const f = await fixture("b")
		const [guest] = await ask(f.guest.id, { sessionId: f.session.id })
		expect(guest![0]).toBe("sessions:places")
		expect(guest![1].places.places).toHaveLength(4)

		const refused = await ask(f.stranger.id, {
			sessionId: f.session.id,
			request: "s"
		})
		expect(refused).toEqual([
			[
				"sessions:places:error",
				{
					sessionId: f.session.id,
					request: "s",
					error: "This session is not one you are in."
				}
			]
		])

		const [none] = await ask(f.owner.id, { sessionId: f.bare.id })
		expect(none![1].places).toEqual({
			lorebookId: null,
			asOf: null,
			places: [],
			ways: []
		})
	})

	test("at the session's story clock: a place archived later is still there before it", async () => {
		const f = await fixture("c")
		const { eq } = await import("drizzle-orm")
		// Before Year 5 the vault stands and the guardroom has its old name.
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 2 } as any)
			.where(eq(schema.sessions.id, f.session.id))
		const [reply] = await ask(f.owner.id, { sessionId: f.session.id })
		const places = reply![1].places
		expect(places.asOf).toEqual({ year: 2 })
		expect(places.places.map((p: any) => p.name)).toEqual([
			"Guardroom",
			"Drowned Hall",
			"Crypt",
			"Well",
			"Vault"
		])
		expect(places.ways.map((w: any) => w.to)).toContain(f.e.vault)
	})
})
