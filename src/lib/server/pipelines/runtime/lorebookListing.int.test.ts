/**
 * The **listing** read — `core:query/lorebook-entries@1`'s half of the host.
 *
 * ## Why there is a second posture on one case
 *
 * Every entries-shaped definition core ships — `lorebook-triggers@1`,
 * `world-lore@1`, `character-lore@1`, `history-entries@1` — runs one keyword
 * scan and admits an entry on a key, on `admitThreshold`, or because it said
 * `constant`. That is the whole door. On a **create** run there is no
 * conversation to scan, so the window is empty and only always-on entries come
 * through — and a genre that wants to *see the book* (pick a secret, ask
 * whether a room exists, list the suspects) had no door at all (plans/genres
 * §10 G13/G14, §11 L4).
 *
 * So `host.ts`'s `lorebook_entries` case grew five optional narrowings —
 * `entryTypes`, `name`, `limit`, `enabled`, `archived` — rather than a second case.
 * One case means one row shape: the listing publishes exactly the fields the
 * four definitions above put on each candidate's `payload`, because both come
 * out of the same `toLoreEntry`. A second case would be a second projection to
 * keep in step, which is the drift this file's neighbours keep finding.
 *
 * ## What is pinned here
 *
 * 1. **The narrowings are narrowings.** Omitted, the SQL is the one retrieval
 *    has always run: the whole book, no `LIMIT`, disabled and archived rows
 *    included. That last part is not an oversight — the scan reports a disabled
 *    entry on `skipped` with a reason, which is how a person is told why their
 *    lore did not come in.
 * 2. **The listing's own posture.** `enabled: true` / `archived: false` is what
 *    the binding asks for, because a switched-off room must not exist and a
 *    shelved suspect must not be picked.
 * 3. **The scope refusal is a refusal.** A run reading another session's
 *    lorebook gets `assertScoped`'s sentence, never an empty list — an empty
 *    list reads as "quiet session" and sends the week to retrieval.
 *
 * ⚠ Written against the **host read** rather than through a run, deliberately.
 * The binding is three lines of plumbing over this; the rules are all here, and
 * a test that went through the executor would prove the same things a great
 * deal more slowly. `lorebookEntries.test.ts` in the SDK repo covers the
 * declaration and a spec wiring `$.entries.main`.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	worldLoreValues,
	characterLoreValues,
	historyValues
} from "$lib/server/pipelines/testing/fixtures"
import { createHost, HostScopeError } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import {
	WORLD_LORE_TYPE_ID,
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID
} from "$lib/shared/entries/types"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lorebook-listing-secret" }
})

let db: TestDb
let userId: number
/** The session under test, and the book it is attached to. */
let sessionId: number
let lorebookId: number
/** A session of the same user with no lorebook at all. */
let bookless: number
/** Another session, with its own book — the one nothing may reach. */
let otherSessionId: number

/** What a query node looks like to `assertScoped`. */
const node = {
	key: "entries",
	definitionId: "core:query/lorebook-entries@1",
	definitionVersion: 1,
	kind: "query"
}

/**
 * One read of the entries table, as a node in a run scoped to `scopeSession`
 * would make it. `read` is optional on `HostServices` — a host that has none is
 * a packaging error, not a state a test should paper over with `!`.
 */
const readEntries = (
	scopeSession: number,
	query: Record<string, unknown>
): Promise<any[]> => {
	const host = createHost(db as any, { sessionId: scopeSession })
	if (!host.read) throw new Error("this host answers no reads")
	return host.read("lorebook_entries", query, node as any) as Promise<any[]>
}

/** What the binding asks for: the live book, narrator-shaped. */
const listing = (sessionScope: number, query: Record<string, unknown> = {}) =>
	readEntries(sessionScope, {
		sessionId: sessionScope,
		currentCharacterId: null,
		enabled: true,
		archived: false,
		...query
	})

const namesOf = (rows: any[]) => rows.map((r) => r.name).sort()

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lorebook-listing-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "listing", isAdmin: false })
		.returning()
	userId = user.id

	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "The book under test", userId })
		.returning()
	lorebookId = book.id

	const [otherBook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Somebody else's book", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	sessionId = session.id

	const [none] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	bookless = none.id

	const [other] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: otherBook.id })
		.returning()
	otherSessionId = other.id

	// ⚠ A character-lore binding is what decides who may see the entry, in
	// the listing exactly as in retrieval. This one names no character, which
	// makes it an NPC binding — the Narrator's alone, and so visible on the
	// narrator-shaped read the listing is.
	//
	// An entry bound to NOTHING is the narrator's too since W3 (2026-09-17):
	// a private entry nobody was bound to is the world's knowledge, not a
	// secret. `speakerLore.int.test.ts` pins that, and the per-speaker
	// subject the same read now takes.
	const [binding] = await db
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding: "{{char:1}}", name: "Verity" })
		.returning()

	await db.insert(schema.lorebookEntries).values([
		...worldLoreValues([
			{
				lorebookId,
				// Deliberately padded and mixed-case: the `name` filter trims
				// and folds, and a stored title people typed does neither.
				name: "  The Cellar  ",
				keys: "",
				content: "Damp, and colder than the street."
			},
			{
				lorebookId,
				name: "The Guildhall",
				keys: "",
				content: "Four storeys of pewterers."
			},
			// Switched off, and shelved: neither may be listed, and both are
			// still in the book for the scan to report on.
			{
				lorebookId,
				name: "The Old Mill",
				keys: "",
				content: "Burned down.",
				enabled: false
			},
			{
				lorebookId,
				name: "The Drowned Quarter",
				keys: "",
				content: "Cut from the setting.",
				archived: true
			}
		]),
		...characterLoreValues([
			{
				lorebookId,
				name: "Verity",
				keys: "",
				content: "Lies for a living.",
				lorebookBindingId: binding.id
			}
		]),
		...historyValues([
			{ lorebookId, keys: "", content: "The flood.", year: 1043 }
		]),
		...worldLoreValues([
			{
				lorebookId: otherBook.id,
				name: "The Cellar",
				keys: "",
				content: "A different cellar entirely."
			}
		])
	])
}, 60_000)

describe("the listing read", () => {
	it(
		"lists the session's whole book, and no other book's",
		async () => {
			const rows = await listing(sessionId)

			// The two live world-lore entries, the character entry, the history
			// entry. Not the disabled one, not the archived one, and — the
			// assertion this test is really for — not the entry of the same
			// name in the other session's book.
			// `"  The Cellar  "` verbatim: the read hands back the stored
			// title. Only the `name` **filter** trims and folds, which is the
			// pair the next test turns on.
			expect(namesOf(rows)).toEqual(
				["  The Cellar  ", "The Guildhall", "Verity", null].sort()
			)
			expect(rows).toHaveLength(4)
			for (const row of rows) expect(row.enabled).toBe(true)
		},
		60_000
	)

	it(
		"publishes the retrieval row shape, so a task written against one reads the other",
		async () => {
			const [row] = (await listing(sessionId, {
				name: "the cellar"
			})) as any[]

			// `toLoreEntry`'s fields — what the four retrieval definitions put
			// on each candidate's `payload`. Named rather than snapshotted so a
			// field going missing says which one.
			expect(row).toMatchObject({
				source: "worldLore",
				name: "  The Cellar  ",
				content: "Damp, and colder than the street.",
				// The stored list, one element per key — never joined and
				// re-split on the way to the matcher (finding #146).
				keys: [],
				constant: false,
				enabled: true
			})
			expect(typeof row.id).toBe("number")
			expect(typeof row.fingerprint).toBe("string")
			expect(row).toHaveProperty("hasEmbedding")
			expect(row).toHaveProperty("bindingCharacterId")
			expect(row).toHaveProperty("priority")
			expect(row).toHaveProperty("position")
		},
		60_000
	)

	it(
		"filters by entry type, and an id no type declares matches nothing",
		async () => {
			expect(
				namesOf(await listing(sessionId, { entryTypes: [WORLD_LORE_TYPE_ID] }))
			).toEqual(["  The Cellar  ", "The Guildhall"].sort())

			expect(
				namesOf(
					await listing(sessionId, {
						entryTypes: [CHARACTER_LORE_TYPE_ID, HISTORY_TYPE_ID]
					})
				)
			).toEqual([null, "Verity"].sort())

			expect(
				await listing(sessionId, {
					entryTypes: ["core:entry/no-such-thing"]
				})
			).toEqual([])

			// An empty list is "every type", not "no type" — the declared
			// default is *all of them*, and a spec that wires an unset control
			// must not get an empty book.
			expect(await listing(sessionId, { entryTypes: [] })).toHaveLength(4)
		},
		60_000
	)

	it(
		"matches a name exactly, ignoring case and surrounding space",
		async () => {
			for (const asked of ["The Cellar", "the cellar", "  THE CELLAR "]) {
				const rows = await listing(sessionId, { name: asked })
				expect(rows).toHaveLength(1)
				// Matched on the trimmed, folded title; handed back as stored.
				expect(rows[0].name).toBe("  The Cellar  ")
			}

			// Exact, never a prefix: "does a room called X exist" has to be
			// answerable with no, and a substring match would answer a
			// different question.
			expect(await listing(sessionId, { name: "Cellar" })).toEqual([])
			expect(await listing(sessionId, { name: "The Cell" })).toEqual([])

			// A name nobody used is the *no* this node exists to be able to give.
			expect(await listing(sessionId, { name: "The Observatory" })).toEqual(
				[]
			)

			// A shelved or switched-off entry does not answer for one either.
			expect(await listing(sessionId, { name: "The Old Mill" })).toEqual([])
			expect(
				await listing(sessionId, { name: "The Drowned Quarter" })
			).toEqual([])
		},
		60_000
	)

	it(
		"caps the rows read",
		async () => {
			expect(await listing(sessionId, { limit: 2 })).toHaveLength(2)
			expect(await listing(sessionId, { limit: 500 })).toHaveLength(4)
		},
		60_000
	)

	it(
		"refuses another session's lorebook with a sentence, never an empty list",
		async () => {
			// The posture the whole seam turns on. An empty list here would read
			// as a quiet session and send somebody to retrieval for a week.
			await expect(
				readEntries(sessionId, {
					sessionId: otherSessionId,
					enabled: true,
					archived: false
				})
			).rejects.toThrow(HostScopeError)

			await expect(
				readEntries(sessionId, { sessionId: otherSessionId })
			).rejects.toThrow(
				/asked for session \d+, but this run is scoped to \d+\. A pipeline may only read the session it was started in\./
			)
		},
		60_000
	)

	it(
		"lists nothing when the session has no lorebook attached",
		async () => {
			// Empty, not a refusal: a session without a book is an ordinary
			// session, and the pipeline is entitled to read it.
			expect(await listing(bookless)).toEqual([])
		},
		60_000
	)

	it(
		"leaves the retrieval read exactly as it was",
		async () => {
			// The control. `loreFor` and `lorebook-triggers@1` pass these two
			// keys and nothing else; if a narrowing ever stops being optional,
			// this is what says so — the disabled and archived rows are back,
			// and there is no cap.
			const scan = await readEntries(sessionId, {
				sessionId,
				currentCharacterId: null
			})

			expect(scan).toHaveLength(6)
			expect(namesOf(scan)).toEqual(
				[
					"  The Cellar  ",
					"The Guildhall",
					"The Old Mill",
					"The Drowned Quarter",
					"Verity",
					null
				].sort()
			)
			expect(scan.some((r) => r.enabled === false)).toBe(true)
		},
		60_000
	)
})

describe("the rows are the session's, whichever book is attached", () => {
	it(
		"follows the session to its lorebook rather than taking one it was handed",
		async () => {
			// There is no `lorebookId` on the read, on purpose: a spec that could
			// name a book could name one belonging to another user's session.
			// The only way to change which book is read is to change the session's.
			const before = await listing(sessionId)
			await db
				.update(schema.sessions)
				.set({ lorebookId: null })
				.where(eq(schema.sessions.id, sessionId))
			const after = await listing(sessionId)
			await db
				.update(schema.sessions)
				.set({ lorebookId })
				.where(eq(schema.sessions.id, sessionId))

			expect(before).toHaveLength(4)
			expect(after).toEqual([])
			expect(await listing(sessionId)).toHaveLength(4)
		},
		60_000
	)
})

/**
 * The binding over that read — three lines of plumbing, and every one of them
 * is a decision the read cannot make for itself.
 */
describe("core:query/lorebook-entries@1's binding", () => {
	/** What the handler asked the host for, and what it published. */
	const askedFor: Record<string, unknown>[] = []
	const listFor = async (params: Record<string, unknown> = {}) => {
		const ctx = {
			read: async (table: string, query: Record<string, unknown>) => {
				askedFor.push(query)
				return await readEntries(sessionId, query)
			}
		}
		const result: any = await coreBindings()[
			"core:query/lorebook-entries@1"
		]!({ scope: { sessionId, currentCharacterId: null }, params }, ctx as any)
		return result
	}

	it(
		"publishes the same list on both ports, and asks for the live book",
		async () => {
			const { value } = await listFor()

			expect(value.main).toHaveLength(4)
			// Same array, not two reads: a spec wiring `main` and one wiring
			// `entries` must not be able to see different books.
			expect(value.entries).toBe(value.main)

			const [asked] = askedFor.slice(-1)
			expect(asked).toMatchObject({
				sessionId,
				currentCharacterId: null,
				enabled: true,
				archived: false
			})
		},
		60_000
	)

	it(
		"applies the declared default and the declared ceiling at the read",
		async () => {
			const limitOf = async (limit?: unknown) => {
				await listFor(limit === undefined ? {} : { limit })
				return (askedFor.slice(-1)[0] as any).limit
			}

			expect(await limitOf()).toBe(500)
			expect(await limitOf(3)).toBe(3)
			// Past the declared max, and a document may legitimately contain it.
			expect(await limitOf(999_999)).toBe(2000)
			// No "0 is off" convention on this node, so 0 is one row.
			expect(await limitOf(0)).toBe(1)
			expect(await limitOf(-4)).toBe(1)
			// Not a number at all — a hand-written document, a null in a stored
			// config. The default, never a `LIMIT NaN`.
			expect(await limitOf(null)).toBe(500)
			expect(await limitOf("lots")).toBe(500)
			expect(await limitOf(7.9)).toBe(7)
		},
		60_000
	)

	it(
		"passes the type and name filters through untouched",
		async () => {
			const { value } = await listFor({
				entryTypes: [WORLD_LORE_TYPE_ID],
				name: "the cellar"
			})

			expect(value.main).toHaveLength(1)
			expect(value.main[0].name).toBe("  The Cellar  ")
			expect(askedFor.slice(-1)[0]).toMatchObject({
				entryTypes: [WORLD_LORE_TYPE_ID],
				name: "the cellar"
			})
		},
		60_000
	)

	it(
		"asks for every type and every name when the spec sets neither",
		async () => {
			// The declared defaults are *absent*, and absent has to mean "all"
			// at the read — an empty list and an empty string are what an unset
			// control resolves to, and neither may narrow anything.
			await listFor()
			expect(askedFor.slice(-1)[0]).toMatchObject({
				entryTypes: [],
				name: ""
			})
			expect((await listFor()).value.main).toHaveLength(4)
		},
		60_000
	)
})
