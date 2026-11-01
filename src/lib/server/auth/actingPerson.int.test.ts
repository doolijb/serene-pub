/**
 * 🚧 (M2b) The acting-person resolver: who may do what, as a table.
 * The `install` cases need `plugins.enabled_by` (the supervisor's migration).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	actingPersonFor,
	personMay,
	type ActingPerson,
	type PersonOp,
	type PersonThing
} from "./actingPerson"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
const ids: Record<string, number> = {}
const people: Record<string, ActingPerson> = {}
const things: Record<string, PersonThing> = {}
const OPS: PersonOp[] = ["read", "write", "delete"]
const NAMES = ["owner", "guest", "stranger", "admin"] as const

beforeAll(async () => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	db = (await import("$lib/server/db")).db as unknown as TestDb
	for (const n of NAMES) ids[n] = (await createTestUser(db, `ap-${n}`)).id
	await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, ids.admin))
	for (const n of NAMES)
		people[n] = { userId: ids[n], isAdmin: n === "admin", via: "press" }

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: ids.owner, isGroup: true } as any)
		.returning()
	await db.insert(schema.sessionGuests).values({ sessionId: session.id, userId: ids.guest, isPlayer: true } as any)
	things.session = { kind: "session", id: session.id }
	things["session-annex"] = { kind: "session-annex", sessionId: session.id }

	const mkChar = async (name: string) =>
		(await db.insert(schema.characters).values({ userId: ids.owner, name, description: "d" } as any).returning())[0]
	const own = await mkChar("own")
	const shared = await mkChar("shared")
	const inSession = await mkChar("in-session")
	await db.insert(schema.characterShares).values({ characterId: shared.id, userId: ids.guest } as any)
	await db.insert(schema.sessionCharacters).values({ sessionId: session.id, characterId: inSession.id } as any)
	things["character own"] = { kind: "character", id: own.id }
	things["character shared"] = { kind: "character", id: shared.id }
	things["character in session"] = { kind: "character", id: inSession.id }

	const mkBook = async (name: string) =>
		(await db.insert(schema.lorebooks).values({ name, userId: ids.owner }).returning())[0]
	const book = await mkBook("own")
	const viewable = await mkBook("viewable")
	await db.insert(schema.lorebookShares).values({ lorebookId: viewable.id, userId: ids.guest } as any)
	things["lorebook own"] = { kind: "lorebook", id: book.id }
	things["lorebook viewable"] = { kind: "lorebook", id: viewable.id }
	things["lorebook-annex"] = { kind: "lorebook-annex", lorebookId: book.id }
	things["user-annex own"] = { kind: "user-annex", userId: ids.owner }
	things["user-annex other"] = { kind: "user-annex", userId: ids.stranger }
}, 60_000)

afterAll(() => vi.restoreAllMocks())

type Who = (typeof NAMES)[number]
/** Who may do each op, by thing (the existing helpers' rules). */
const MATRIX: Record<string, Record<PersonOp, Who[]>> = {
	session: { read: ["owner", "guest"], write: ["owner"], delete: ["owner"] },
	"session-annex": { read: ["owner", "guest"], write: ["owner", "guest"], delete: ["owner"] },
	"character own": { read: ["owner"], write: ["owner"], delete: ["owner"] },
	"character shared": { read: ["owner", "guest"], write: ["owner"], delete: ["owner"] },
	"character in session": { read: ["owner", "guest"], write: ["owner"], delete: ["owner"] },
	"lorebook own": { read: ["owner", "admin"], write: ["owner"], delete: ["owner"] },
	"lorebook viewable": { read: ["owner", "guest", "admin"], write: ["owner"], delete: ["owner"] },
	"lorebook-annex": { read: ["owner", "admin"], write: ["owner"], delete: ["owner"] },
	"user-annex own": { read: ["owner"], write: ["owner"], delete: ["owner"] },
	// the thing's userId is the stranger's: only the stranger
	"user-annex other": { read: ["stranger"], write: ["stranger"], delete: ["stranger"] }
}

describe("personMay matrix", () => {
	for (const [thing, byOp] of Object.entries(MATRIX))
		for (const op of OPS)
			for (const who of NAMES)
				it(`${who} ${op} ${thing}`, async () => {
					const answer = await personMay(db, people[who], op, things[thing])
					expect(answer.ok).toBe(byOp[op].includes(who))
					if (!answer.ok) expect(answer.reason).toMatch(/\.$/)
				}, 60_000)
})

describe("actingPersonFor", () => {
	it("press/send/view resolve the user, with isAdmin read from users", async () => {
		expect(await actingPersonFor(db, { via: "send", userId: ids.admin })).toEqual({
			userId: ids.admin,
			isAdmin: true,
			via: "send"
		})
		expect((await actingPersonFor(db, { via: "view", userId: ids.guest }))?.isAdmin).toBe(false)
	}, 60_000)

	it("routine runs as the session's owner", async () => {
		const t = things.session as { id: number }
		expect(await actingPersonFor(db, { via: "routine", sessionId: t.id })).toMatchObject({
			userId: ids.owner,
			via: "routine"
		})
		expect(await actingPersonFor(db, { via: "routine", sessionId: 999_999 })).toBeNull()
	}, 60_000)

	it("install runs as the enabling admin, only while still an admin", async () => {
		const [p] = await db
			.insert(schema.plugins)
			.values({ pluginId: "t/acting", name: "t", bundleSource: "", bundleHash: "x", enabledBy: ids.admin } as any)
			.returning()
		expect(await actingPersonFor(db, { via: "install", pluginId: "t/acting" })).toMatchObject({
			userId: ids.admin,
			isAdmin: true,
			via: "install"
		})
		expect(await actingPersonFor(db, { via: "install", pluginId: "t/never" })).toBeNull()
		await db.update(schema.users).set({ isAdmin: false }).where(eq(schema.users.id, ids.admin))
		expect(await actingPersonFor(db, { via: "install", pluginId: "t/acting" })).toBeNull()
		await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, ids.admin))
		await db.update(schema.plugins).set({ enabledBy: null }).where(eq(schema.plugins.id, p.id))
		expect(await actingPersonFor(db, { via: "install", pluginId: "t/acting" })).toBeNull()
	}, 60_000)

	it("a deleted user is nobody", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const gone = await createTestUser(db, "ap-gone")
		await db.update(schema.users).set({ isDeleted: true }).where(eq(schema.users.id, gone.id))
		expect(await actingPersonFor(db, { via: "press", userId: gone.id })).toBeNull()
		expect(await actingPersonFor(db, { via: "press", userId: 999_999 })).toBeNull()
	}, 60_000)
})
