/**
 * The owner a `state:*` write names must belong to the session (plan B0,
 * places-graph 2026-09-29).
 *
 * The four durable owner kinds — `card`, `cast_member`, `lorebook`, `location`
 * — name rows by bare id, and nothing tied that id to the session doing the
 * writing: `assertSessionOwner` had no branch for them and `state:configure`
 * only asked it about the session-layer kinds. So a user in their OWN session
 * could file a template-layer value against another user's place, book, cast
 * member or card. The rule now: the session's own book; a live place of that
 * book on its line; a member of that book; a card the writer owns.
 *
 * And the WRITER is judged, not only the owner. A guest of the session passes
 * `scoped()`, so "the session's own book" alone let a guest file template
 * rows (session_id NULL) against the host's book, places and members — rows
 * every other session on that book then resolves. The book's three durable
 * kinds are the book owner's to write, exactly as a card is its owner's; an
 * accepted proposal is judged as the person who accepts it.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre, getAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-state-owner-scope-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const GRIT = "test:slot/grit@1"
const LOCATION = "core:entry/location"

function declareSlots() {
	_clearAttributeSlots()
	defineAttributeSlot(GRIT, {
		type: "integer",
		label: { en: "Grit" },
		descriptor: "How much is left in the tank.",
		appliesTo: ["cast", "world", "location"],
		config: { min: 0, max: 20 },
		default: 10
	})
}

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

let n = 0

/** A user's corner of the install: a card, a book with a place and a member. */
async function holdings(userId: number, label: string) {
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId, name: `${label} card`, description: "…" })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `${label} book` })
		.returning()
	const [place] = await testDb
		.insert(schema.lorebookEntries)
		.values({ lorebookId: book!.id, typeId: LOCATION, typeVersion: 1, position: 0, title: `${label} place`, content: "…" })
		.returning()
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: book!.id, name: `${label} member`, binding: `{{char:${card!.id}}}`, characterId: card!.id })
		.returning()
	return { card: card!, book: book!, place: place!, member: member! }
}

/**
 * The writer's session over their own book, a second book of theirs the
 * session is not about, and a stranger's whole corner.
 */
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `owner-scope-${suffix}`)
	const stranger = await createTestUser(testDb, `owner-scope-stranger-${suffix}`)
	const mine = await holdings(user.id, `Mine ${suffix}`)
	const spare = await holdings(user.id, `Spare ${suffix}`)
	const theirs = await holdings(stranger.id, `Theirs ${suffix}`)
	const GENRE = `test:genre/owner-scope-${suffix}`
	genre(GENRE, {
		name: { en: "Owner scope" },
		family: "test",
		slots: [getAttributeSlot(GRIT)!],
		events: {}
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, genreId: GENRE, lorebookId: mine.book.id })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({ sessionId: session!.id, characterId: mine.card.id })
	return { user, stranger, session: session!, mine, spare, theirs }
}

type Owner = { kind: "card" | "cast_member" | "lorebook" | "location"; id: number }

async function set(userId: number, sessionId: number, owner: Owner, value = 7) {
	const { stateSet } = await import("./state")
	const errors: string[] = []
	const emit = (event: string, data: any) => {
		if (event.endsWith(":error")) errors.push(data.error)
	}
	const outcome = await stateSet.handler(fakeSocket(userId), { sessionId, owner, slotId: GRIT, value }, emit).then(
		() => "written" as const,
		(e: Error) => e.message
	)
	return { outcome, errors }
}

async function configureOn(userId: number, sessionId: number, owner: Owner) {
	const { stateConfigure } = await import("./state")
	return stateConfigure.handler(fakeSocket(userId), { sessionId, owner, slotId: GRIT, config: { max: 40 } }, () => {}).then(
		() => "written" as const,
		(e: Error) => e.message
	)
}

async function decide(userId: number, proposalId: number) {
	const { stateDecide } = await import("./state")
	return stateDecide.handler(fakeSocket(userId), { proposalId, accept: true }, () => {}).then(
		() => "written" as const,
		(e: Error) => e.message
	)
}

/** A held change a run proposed against `owner` — nobody's hand on it yet. */
async function proposal(sessionId: number, owner: Owner) {
	const { proposeChange } = await import("$lib/server/state/write")
	return proposeChange(testDb as any, { sessionId, updatedBy: "model" }, { owner, slotId: GRIT, value: 3 } as any)
}

/** The stranger, seated as a guest of the writer's session. */
async function seatGuest(w: Awaited<ReturnType<typeof world>>) {
	await testDb.insert(schema.sessionGuests).values({ sessionId: w.session.id, userId: w.stranger.id } as any)
}

/** What an owner holds at the template layer: the rows the hole wrote. */
async function rowsOf(owner: Owner) {
	const values = await testDb
		.select({ id: schema.attributeValues.id })
		.from(schema.attributeValues)
		.where(and(eq(schema.attributeValues.ownerKind, owner.kind), eq(schema.attributeValues.ownerId, owner.id)))
	const configs = await testDb
		.select({ id: schema.attributeConfigs.id })
		.from(schema.attributeConfigs)
		.where(and(eq(schema.attributeConfigs.ownerKind, owner.kind), eq(schema.attributeConfigs.ownerId, owner.id)))
	return values.length + configs.length
}

describe("state:set refuses a durable owner that is not the session's", () => {
	test("another user's place, and a place of a book the session is not about", async () => {
		declareSlots()
		const w = await world()
		for (const owner of [
			{ kind: "location" as const, id: w.theirs.place.id },
			{ kind: "location" as const, id: w.spare.place.id }
		]) {
			const { outcome, errors } = await set(w.user.id, w.session.id, owner)
			expect(outcome).toMatch(/not a location in this session's lorebook/)
			expect(errors).toHaveLength(1)
			expect(await rowsOf(owner)).toBe(0)
		}
	})

	test("another user's book, and another book of the writer's own", async () => {
		declareSlots()
		const w = await world()
		for (const owner of [
			{ kind: "lorebook" as const, id: w.theirs.book.id },
			{ kind: "lorebook" as const, id: w.spare.book.id }
		]) {
			const { outcome } = await set(w.user.id, w.session.id, owner)
			expect(outcome).toMatch(/not this session's lorebook/)
			expect(await rowsOf(owner)).toBe(0)
		}
	})

	test("a cast member of another book", async () => {
		declareSlots()
		const w = await world()
		for (const owner of [
			{ kind: "cast_member" as const, id: w.theirs.member.id },
			{ kind: "cast_member" as const, id: w.spare.member.id }
		]) {
			const { outcome } = await set(w.user.id, w.session.id, owner)
			expect(outcome).toMatch(/not a cast member of this session's lorebook/)
			expect(await rowsOf(owner)).toBe(0)
		}
	})

	test("a card the writer does not own", async () => {
		declareSlots()
		const w = await world()
		const owner = { kind: "card" as const, id: w.theirs.card.id }
		const { outcome } = await set(w.user.id, w.session.id, owner)
		expect(outcome).toMatch(/not a card of yours/)
		expect(await rowsOf(owner)).toBe(0)
	})

	test("an id that names nothing at all", async () => {
		declareSlots()
		const w = await world()
		for (const kind of ["card", "cast_member", "lorebook", "location"] as const) {
			const { outcome } = await set(w.user.id, w.session.id, { kind, id: 987_654_321 })
			expect(outcome).not.toBe("written")
		}
	})
})

describe("the session's own durable owners still write", () => {
	test("its book, its place, its member, and the writer's card", async () => {
		declareSlots()
		const w = await world()
		for (const owner of [
			{ kind: "lorebook" as const, id: w.mine.book.id },
			{ kind: "location" as const, id: w.mine.place.id },
			{ kind: "cast_member" as const, id: w.mine.member.id },
			{ kind: "card" as const, id: w.mine.card.id }
		]) {
			const { outcome, errors } = await set(w.user.id, w.session.id, owner)
			expect(errors).toEqual([])
			expect(outcome).toBe("written")
			expect(await rowsOf(owner)).toBe(1)
		}
	})
})

describe("state:configure is held to the same rule", () => {
	test("another user's book and place are refused; the session's own configure", async () => {
		declareSlots()
		const w = await world()
		for (const owner of [
			{ kind: "lorebook" as const, id: w.theirs.book.id },
			{ kind: "location" as const, id: w.theirs.place.id },
			{ kind: "card" as const, id: w.theirs.card.id }
		]) {
			expect(await configureOn(w.user.id, w.session.id, owner)).not.toBe("written")
			expect(await rowsOf(owner)).toBe(0)
		}
		expect(await configureOn(w.user.id, w.session.id, { kind: "lorebook", id: w.mine.book.id })).toBe("written")
	})

	test("a guest's card is theirs to configure, never the host's", async () => {
		declareSlots()
		const w = await world()
		const guest = await holdings(w.stranger.id, `Guest ${n}`)
		await testDb.insert(schema.sessionGuests).values({ sessionId: w.session.id, userId: w.stranger.id } as any)
		expect(await configureOn(w.stranger.id, w.session.id, { kind: "card", id: w.mine.card.id })).toMatch(
			/not a card of yours/
		)
		expect(await configureOn(w.stranger.id, w.session.id, { kind: "card", id: guest.card.id })).toBe("written")
	})
})

describe("a guest never writes the host's durable layers", () => {
	test("state:set and state:configure on the host's book, place and member are refused", async () => {
		declareSlots()
		const w = await world()
		await seatGuest(w)
		for (const owner of [
			{ kind: "lorebook" as const, id: w.mine.book.id },
			{ kind: "location" as const, id: w.mine.place.id },
			{ kind: "cast_member" as const, id: w.mine.member.id }
		]) {
			const { outcome, errors } = await set(w.stranger.id, w.session.id, owner)
			expect(outcome).toMatch(/not your lorebook/)
			expect(errors).toHaveLength(1)
			expect(await configureOn(w.stranger.id, w.session.id, owner)).toMatch(/not your lorebook/)
			expect(await rowsOf(owner)).toBe(0)
		}
	})

	test("the session's own layer is still the guest's to play", async () => {
		declareSlots()
		const w = await world()
		await seatGuest(w)
		for (const owner of [
			{ kind: "session_location", id: w.mine.place.id },
			{ kind: "session", id: w.session.id }
		] as const) {
			const { outcome, errors } = await set(w.stranger.id, w.session.id, owner as any)
			expect(errors).toEqual([])
			expect(outcome).toBe("written")
		}
	})

	test("an accepted proposal is judged as whoever accepts it", async () => {
		declareSlots()
		const w = await world()
		await seatGuest(w)
		const place = { kind: "location" as const, id: w.mine.place.id }
		const held = await proposal(w.session.id, place)
		expect(await decide(w.stranger.id, held)).toMatch(/not your lorebook/)
		expect(await rowsOf(place)).toBe(0)
		// Still pending, and the host's accept lands it.
		expect(await decide(w.user.id, held)).toBe("written")
		expect(await rowsOf(place)).toBe(1)
	})
})
