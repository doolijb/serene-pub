/**
 * `jump:search` is a CROSS-ENTITY read, which is the shape a leak takes: one
 * handler answering for seven tables, each with its own owner rule, and a
 * mistake in any one of them is another user's rows on a stranger's screen.
 *
 * So the assertions here are mostly about what is NOT returned — the other
 * user's character, the admin-only groups, the wildcard that would have matched
 * everything, and the one-character query that must not reach the database at
 * all.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import type {
	JumpKind,
	JumpSearchParams,
	JumpSearchResponse
} from "$lib/shared/sockets/jump"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/** User A owns everything that matches; user B owns nothing that does. */
let alice: { id: number }
let bob: { id: number }
let admin: { id: number }
let aliceLorebook: { id: number }
let aliceEntry: { id: number }
let aliceSession: { id: number }
let aliceCharacter: { id: number }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-jump-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	const { createTestUser } = await import("$lib/server/utils/testDb")
	alice = await createTestUser(testDb, "jump-alice")
	bob = await createTestUser(testDb, "jump-bob")
	admin = await createTestUser(testDb, "jump-admin-alder")
	await testDb
		.update(schema.users)
		.set({ isAdmin: true })
		.where(eq(schema.users.id, admin.id))

	// ── Alice's world ────────────────────────────────────────────────────
	;[aliceCharacter] = await testDb
		.insert(schema.characters)
		.values({
			userId: alice.id,
			name: "Brother Alder",
			description: "A hedge-priest of the river shrine."
		})
		.returning()
	// A soft-deleted character that would otherwise match — characters:list
	// excludes it, so this must too.
	await testDb.insert(schema.characters).values({
		userId: alice.id,
		name: "Alder the Forgotten",
		description: "Deleted.",
		isDeleted: true
	})
	await testDb.insert(schema.characters).values({
		userId: alice.id,
		name: "Alder's apprentice",
		description: "Carries the bell.",
		isPersona: true
	})
	await testDb.insert(schema.tags).values({
		userId: alice.id,
		name: "alder-lore"
	})
	;[aliceLorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: alice.id, name: "Alder Valley" })
		.returning()
	;[aliceEntry] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: aliceLorebook.id,
					name: "Ashford and the bell",
					keys: "ashford, bell",
					content: "The bell of Ashford rings at dusk."
				}
			])
		)
		.returning()
	;[aliceSession] = await testDb
		.insert(schema.sessions)
		.values({
			userId: alice.id,
			name: "The Alder Vigil",
			isGroup: false,
			sessionType: SessionTypes.ROLEPLAY
		})
		.returning()

	// ── Bob's world: nothing that matches "alder" ────────────────────────
	await testDb.insert(schema.characters).values({
		userId: bob.id,
		name: "Someone Else",
		description: "Nothing to do with it."
	})
	await testDb
		.insert(schema.lorebooks)
		.values({ userId: bob.id, name: "Other Book" })

	// ── Instance-wide, admin-only ────────────────────────────────────────
	const [endpoint] = await testDb
		.insert(schema.connections)
		.values({ name: "alder-endpoint", type: "ollama" })
		.returning()
	await testDb.insert(schema.connectionModels).values({
		connectionId: endpoint.id,
		model: "llama3.1:8b",
		name: "Alderwood 8B"
	})
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let socketSeq = 0
function fakeSocket(userId: number, isAdmin = false) {
	return { id: `jump-socket-${++socketSeq}`, user: { id: userId, isAdmin } }
}

async function jump(
	socket: any,
	params: JumpSearchParams
): Promise<JumpSearchResponse> {
	const { jumpSearch } = await import("./jump")
	const emitted: { event: string; data: any }[] = []
	const res = await jumpSearch.handler(socket, params, (event, data) => {
		emitted.push({ event, data })
	})
	// The reply always leaves through emitToUser as well as being returned —
	// a client never reads a handler's resolved value.
	expect(emitted.map((e) => e.event)).toEqual(["jump:search"])
	expect(emitted[0].data).toEqual(res)
	return res!
}

function group(res: JumpSearchResponse, kind: JumpKind) {
	return res.groups.find((g) => g.kind === kind)
}

function titles(res: JumpSearchResponse, kind: JumpKind): string[] {
	return (group(res, kind)?.hits ?? []).map((h) => h.title)
}

describe("jump:search — who may see what", () => {
	test("the owner finds their own character", async () => {
		const res = await jump(fakeSocket(alice.id), { query: "alder" })
		// Both of Alice's live characters match, in name order — one of them
		// is a persona, which is a character and therefore a character hit.
		expect(titles(res, "character")).toEqual([
			"Alder's apprentice",
			"Brother Alder"
		])
		const mine = group(res, "character")!.hits.find(
			(h) => h.id === aliceCharacter.id
		)
		expect(mine?.title).toBe("Brother Alder")
		// Not flagged, so no qualifier on the hit.
		expect((mine as any).hint).toBeUndefined()
	})

	test("a soft-deleted character is not a hit", async () => {
		const res = await jump(fakeSocket(alice.id), { query: "alder" })
		expect(titles(res, "character")).not.toContain("Alder the Forgotten")
	})

	test("another user finds none of it", async () => {
		const res = await jump(fakeSocket(bob.id), { query: "alder" })
		// Not "an empty character group" — no group at all, for any kind.
		expect(res.groups).toEqual([])
	})

	test("another user finds none of the entries in a book they do not own", async () => {
		// Its own assertion because "alder" does not reach Alice's entry at
		// all: a dropped `lorebooks.userId` clause in the entry query would
		// have survived the test above without this one.
		const mine = await jump(fakeSocket(alice.id), { query: "ashford bell" })
		expect(group(mine, "entry")!.hits).toHaveLength(1)

		const theirs = await jump(fakeSocket(bob.id), { query: "ashford bell" })
		expect(theirs.groups).toEqual([])
	})

	test("a guest sees the session they were invited to, and nothing else of its owner's", async () => {
		const [shared] = await testDb
			.insert(schema.sessions)
			.values({
				userId: alice.id,
				name: "The Borrowed Vigil",
				isGroup: true,
				sessionType: SessionTypes.ROLEPLAY
			})
			.returning()
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: shared.id, userId: bob.id })

		const res = await jump(fakeSocket(bob.id), { query: "borrowed" })
		expect(res.groups.map((g) => g.kind)).toEqual(["session"])
		expect(res.groups[0].hits.map((h) => h.id)).toEqual([shared.id])

		// ⚠ Being a guest of one session widens nothing else. Alice's
		// character, persona, lorebook, entry and tag stay hers.
		const stillNothing = await jump(fakeSocket(bob.id), { query: "alder" })
		expect(stillNothing.groups).toEqual([])
	})

	test("groups arrive in the declared order and never empty", async () => {
		const res = await jump(fakeSocket(alice.id), { query: "alder" })
		const order = res.groups.map((g) => g.kind)
		// ⚠ There is no "persona" kind: a persona is a character row, so
		// "Alder's apprentice" comes back inside the "character" group with
		// `hint: "persona"` on its hit rather than as a second group.
		expect(order).toEqual(["session", "character", "lorebook", "tag"])
		for (const g of res.groups) expect(g.hits.length).toBeGreaterThan(0)
		const characterHits = res.groups.find((g) => g.kind === "character")!
			.hits
		expect(
			characterHits.some((h: any) => h.hint === "persona")
		).toBe(true)
	})
})

describe("jump:search — query semantics", () => {
	test("two words match across the row (AND of ORs), and an entry carries its book", async () => {
		const res = await jump(fakeSocket(alice.id), { query: "ashford bell" })
		const hits = group(res, "entry")!.hits
		expect(hits).toHaveLength(1)
		expect(hits[0].id).toBe(aliceEntry.id)
		expect(hits[0].title).toBe("Ashford and the bell")
		expect(hits[0].parentId).toBe(aliceLorebook.id)
		expect(hits[0].subtitle).toBe("Alder Valley")
	})

	test("a word that matches nothing takes the whole row out", async () => {
		const res = await jump(fakeSocket(alice.id), {
			query: "ashford dragon"
		})
		expect(group(res, "entry")).toBeUndefined()
	})

	test("a keyword-only match still finds the entry", async () => {
		const res = await jump(fakeSocket(alice.id), { query: "ashford" })
		expect(group(res, "entry")!.hits[0].id).toBe(aliceEntry.id)
	})

	test("the session's cast is searched, not just its name", async () => {
		const { insertSessionCharacterRow } = await import(
			"$lib/server/pipelines/testing/fixtures"
		)
		await insertSessionCharacterRow(
			testDb,
			aliceSession.id,
			aliceCharacter.id
		)
		// A second session with a DIFFERENT cast, so a cast subquery that
		// forgot to correlate on `session_id` would return both and fail here
		// rather than quietly matching every session on the instance.
		const [other] = await testDb
			.insert(schema.sessions)
			.values({
				userId: alice.id,
				name: "Elsewhere",
				isGroup: false,
				sessionType: SessionTypes.ROLEPLAY
			})
			.returning()
		const [bystander] = await testDb
			.insert(schema.characters)
			.values({
				userId: alice.id,
				name: "Sister Wren",
				description: "Unrelated."
			})
			.returning()
		await insertSessionCharacterRow(testDb, other.id, bystander.id)

		const res = await jump(fakeSocket(alice.id), { query: "brother" })
		expect(group(res, "session")!.hits.map((h) => h.id)).toEqual([
			aliceSession.id
		])
	})

	test("ILIKE wildcards are the user's characters, not the pattern's", async () => {
		// Below the minimum on their own, so also asserted at two characters —
		// where the escaping is the only thing standing between "%" and every
		// row in the instance.
		for (const query of ["%", "_", "%%", "__", "%a%", "_a_"]) {
			const res = await jump(fakeSocket(alice.id), { query })
			expect(res.groups, `query ${JSON.stringify(query)}`).toEqual([])
		}
	})

	test("a backslash is a character too", async () => {
		const res = await jump(fakeSocket(alice.id), { query: "\\%" })
		expect(res.groups).toEqual([])
	})

	test("matching is case-insensitive", async () => {
		const res = await jump(fakeSocket(alice.id), { query: "BROTHER aLdEr" })
		expect(titles(res, "character")).toEqual(["Brother Alder"])
	})

	test("a one-character query answers with no groups and touches no table", async () => {
		const dbModule = await import("$lib/server/db")
		const select = vi.spyOn(dbModule.db as any, "select")
		const guestRead = vi.spyOn(
			(dbModule.db as any).query.sessionGuests,
			"findMany"
		)
		try {
			const res = await jump(fakeSocket(alice.id), { query: "a" })
			expect(res).toEqual({ query: "a", groups: [] })
			expect(select).not.toHaveBeenCalled()
			expect(guestRead).not.toHaveBeenCalled()

			// ⚠ The proof that the two spies above are watching anything at
			// all. Without this, a spy that failed to attach would make the
			// assertions pass for the wrong reason — and "the gate works" is
			// the one thing this test exists to say.
			await jump(fakeSocket(alice.id), { query: "al" })
			expect(select).toHaveBeenCalled()
			expect(guestRead).toHaveBeenCalled()
		} finally {
			select.mockRestore()
			guestRead.mockRestore()
		}
	})

	test("whitespace is trimmed before the length gate and echoed trimmed", async () => {
		const res = await jump(fakeSocket(alice.id), { query: "   a   " })
		expect(res).toEqual({ query: "a", groups: [] })
	})

	test("junk params answer with an empty reply rather than throwing", async () => {
		// Whatever the socket sent. Each of these would have reached a
		// `.trim()`, a `.filter()` or `.limit()` on a non-number if the
		// handler took its params on trust.
		for (const params of [
			{},
			{ query: null },
			{ query: 42 },
			{ query: { evil: true } },
			{ query: "alder", kinds: "connection" },
			{ query: "alder", kinds: [null, 7] }
		] as any[]) {
			const res = await jump(fakeSocket(alice.id), params)
			expect(res.groups, JSON.stringify(params)).toEqual([])
			expect(typeof res.query).toBe("string")
		}

		// A bad `limit` falls back to the default rather than reaching the
		// query, so this one still answers with real hits.
		for (const limit of ["40", null, NaN, -3, Infinity] as any[]) {
			const res = await jump(fakeSocket(alice.id), {
				query: "alder",
				limit
			})
			expect(res.groups.length, String(limit)).toBeGreaterThan(0)
			for (const g of res.groups)
				expect(g.hits.length).toBeLessThanOrEqual(8)
		}
	})
})

describe("jump:search — the admin-only kinds", () => {
	test("a non-admin gets no connection or user group, even when one matches", async () => {
		const res = await jump(fakeSocket(alice.id), { query: "alder" })
		// "alder-endpoint" and the admin account "jump-admin-alder" both match.
		expect(group(res, "connection")).toBeUndefined()
		expect(group(res, "user")).toBeUndefined()
	})

	test("asking for an admin kind by name does not conjure the group", async () => {
		const res = await jump(fakeSocket(alice.id), {
			query: "alder",
			kinds: ["connection", "user"]
		})
		expect(res.groups).toEqual([])
	})

	test("an admin gets both", async () => {
		const res = await jump(fakeSocket(admin.id, true), { query: "alder" })
		expect(titles(res, "connection")).toEqual(["alder-endpoint"])
		expect(titles(res, "user")).toEqual(["jump-admin-alder"])
	})

	test("a connection is found by its model's name as well as its own", async () => {
		const res = await jump(fakeSocket(admin.id, true), {
			query: "alderwood"
		})
		const hits = group(res, "connection")!.hits
		expect(hits).toHaveLength(1)
		expect(hits[0].title).toBe("alder-endpoint")
	})

	test("a connection is found by the identifier the adapter sends", async () => {
		const res = await jump(fakeSocket(admin.id, true), {
			query: "llama3.1"
		})
		expect(titles(res, "connection")).toEqual(["alder-endpoint"])
	})
})

describe("jump:search — caps and kind filtering", () => {
	test("kinds narrows the reply to exactly those kinds", async () => {
		const res = await jump(fakeSocket(alice.id), {
			query: "alder",
			kinds: ["lorebook"]
		})
		expect(res.groups.map((g) => g.kind)).toEqual(["lorebook"])
	})

	test("an unknown kind is dropped rather than answered", async () => {
		const res = await jump(fakeSocket(alice.id), {
			query: "alder",
			kinds: ["lorebook", "wormhole" as JumpKind]
		})
		expect(res.groups.map((g) => g.kind)).toEqual(["lorebook"])
	})

	test("an explicitly empty kinds list asks for nothing", async () => {
		const res = await jump(fakeSocket(alice.id), {
			query: "alder",
			kinds: []
		})
		expect(res.groups).toEqual([])
	})

	test("limit caps each group", async () => {
		const res = await jump(fakeSocket(alice.id), {
			query: "alder",
			limit: 1
		})
		for (const g of res.groups) expect(g.hits).toHaveLength(1)
	})

	test("the reply never exceeds the total cap", async () => {
		const res = await jump(fakeSocket(alice.id), { query: "alder" })
		const total = res.groups.reduce((n, g) => n + g.hits.length, 0)
		expect(total).toBeLessThanOrEqual(40)
	})
})

describe("jump:search — supersession", () => {
	test("only the newest query from a socket reaches the client", async () => {
		const { jumpSearch } = await import("./jump")
		const socket = fakeSocket(alice.id)
		const emitted: { event: string; data: any }[] = []
		const emit = (event: string, data: any) =>
			void emitted.push({ event, data })

		// Both fired before either is awaited, which is what a person typing
		// does; the second supersedes the first on the same socket.
		const first = jumpSearch.handler(socket, { query: "al" }, emit)
		const second = jumpSearch.handler(socket, { query: "alder" }, emit)
		await Promise.all([first, second])

		expect(await first).toBeUndefined()
		expect(emitted.map((e) => e.data.query)).toEqual(["alder"])
		expect(emitted.some((e) => e.event === "jump:search:error")).toBe(false)
	})
})
