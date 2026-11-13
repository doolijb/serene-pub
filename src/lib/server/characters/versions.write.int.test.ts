/**
 * 🚧 `writeCastVersion` against a real database (plan §32 §4, §33.2): the
 * author's write, and a session's story write — its target (the member or the
 * session's overlay row), its line, its anchor, the in-place coalescing and
 * the retire mark.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { MAIN_HEAD } from "$lib/server/state/entriesOnReading"
import {
	insertCard,
	insertCastMember,
	insertCharacterVersions,
	writeCastVersion,
	type CastVersionChanges
} from "./versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// The state lock is spied on, not replaced: it still takes the lock.
vi.mock("$lib/server/state/write", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/state/write")>()
	return { ...actual, lockStateVersion: vi.fn(actual.lockStateVersion) }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-versions-write-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const GENRE = "test:genre/versions-write"
let n = 0
const db = () => testDb as unknown as Db

type Options = {
	/** The member has a card (default) or none. */
	card?: boolean
	/** Who owns the book: the session's owner (default) or someone else. */
	bookOwner?: "session" | "other"
	/** The session rides a line of the book and forks its own on first write. */
	flag?: boolean
	/** The session's clock; default Year 5, 1/1, 09:30. */
	clock?: {
		year: number
		month: number
		day: number
		hour: number
		minute: number
	}
}

async function world(o: Options = {}) {
	_clearAttributeSlots()
	genreKeeping(GENRE, {
		name: { en: "Versions write" },
		family: "test",
		slots: [],
		events: {}
	})
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `vw-${suffix}`)
	const other = await createTestUser(testDb, `vw-other-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: o.bookOwner === "other" ? other.id : user.id,
			name: `Book ${suffix}`
		})
		.returning()
	const [fork] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 })
		.returning()
	const hasCard = o.card !== false
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Card ${suffix}`,
		description: "The card's description."
	})
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: hasCard ? card.id : null,
		name: `Ada ${suffix}`,
		description: hasCard ? null : "Her own description."
	})
	const clock = o.clock ?? { year: 5, month: 1, day: 1, hour: 9, minute: 30 }
	const session = await newSession(user.id, {
		lorebookId: book!.id,
		lorebookBranchId: o.flag ? fork!.id : null,
		lineOnFirstWrite: o.flag ?? false,
		storyClockYear: clock.year,
		storyClockMonth: clock.month,
		storyClockDay: clock.day,
		storyClockHour: clock.hour,
		storyClockMinute: clock.minute
	})
	return {
		user,
		other,
		book: book!,
		fork: fork!,
		card,
		member,
		base: base!,
		session,
		suffix
	}
}
type World = Awaited<ReturnType<typeof world>>

async function newSession(
	userId: number,
	extra: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			genreId: GENRE,
			...extra
		})
		.returning()
	return row!
}

/** A live message of the session (the world's open anchor is the newest). */
async function message(sessionId: number): Promise<number> {
	const [row] = await testDb
		.insert(schema.messages)
		.values({ sessionId, role: "assistant", content: "…" } as any)
		.returning({ id: schema.messages.id })
	return row!.id
}

async function setOwnMode(userId: number, mode: "full" | "review" | "off") {
	await testDb
		.insert(schema.userSettings)
		.values({ userId, loreWriteMode: mode })
		.onConflictDoUpdate({
			target: schema.userSettings.userId,
			set: { loreWriteMode: mode }
		})
}

const storyWrite = (
	w: World,
	changes: CastVersionChanges,
	extra: {
		session?: Partial<
			NonNullable<Parameters<typeof writeCastVersion>[1]["session"]>
		>
		member?: number
		sessionId?: number
	} = {}
) =>
	testDb.transaction((tx) =>
		writeCastVersion(tx as unknown as Db, {
			member: extra.member ?? w.member.id,
			changes,
			writtenBy: `run:${w.session.id}`,
			session: { id: extra.sessionId ?? w.session.id, ...extra.session }
		})
	)

const authorWrite = (
	member: number,
	changes: CastVersionChanges,
	at: NonNullable<Parameters<typeof writeCastVersion>[1]["at"]>
) =>
	testDb.transaction((tx) =>
		writeCastVersion(tx as unknown as Db, {
			member,
			changes,
			writtenBy: "user:1",
			note: "by hand",
			at
		})
	)

const versionsOf = (memberId: number) =>
	testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))
		.orderBy(schema.characterVersions.id)

async function asRead(memberId: number, sessionId?: number) {
	const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
	const out = await membersAsRead(
		db(),
		[memberId],
		sessionId != null ? { sessionId } : { reading: MAIN_HEAD }
	)
	return out.get(memberId)!
}

describe("the author's write", () => {
	test("a version at exactly that key is updated in place; a follow is cleared by a value", async () => {
		const w = await world()
		expect(w.base.follows).toContain("description")
		const out = await authorWrite(
			w.member.id,
			{ description: "Rewritten.", nodeState: "missing" },
			{ branchId: null, date: null, personalPosition: null }
		)
		expect(out.coalesced).toBe(true)
		expect(out.version.id).toBe(w.base.id)
		expect(out.version.description).toBe("Rewritten.")
		expect(out.version.follows).not.toContain("description")
		expect(out.version.nodeState).toBe("missing")
		expect(await versionsOf(w.member.id)).toHaveLength(1)
	})

	test("a later date copies the version in force, keeping its follows and parent; writing there again is in place", async () => {
		const w = await world()
		const first = await authorWrite(
			w.member.id,
			{ personality: "Wry." },
			{ branchId: null, date: { year: 5 }, personalPosition: null }
		)
		expect(first.coalesced).toBe(false)
		expect(first.version).toMatchObject({
			castMemberId: w.member.id,
			lorebookId: w.book.id,
			year: 5,
			month: null,
			branchId: null,
			sourceSessionId: null,
			parentVersionId: w.base.parentVersionId,
			personality: "Wry.",
			writtenBy: "user:1",
			note: "by hand"
		})
		expect(first.version.follows).toEqual(
			w.base.follows.filter((f) => f !== "personality")
		)
		// The base is untouched.
		const [base] = await versionsOf(w.member.id)
		expect(base!.personality).toBe(w.base.personality)
		expect(base!.follows).toEqual(w.base.follows)

		const second = await authorWrite(
			w.member.id,
			{ summary: "A mathematician." },
			{ branchId: null, date: { year: 5 }, personalPosition: null }
		)
		expect(second.coalesced).toBe(true)
		expect(second.version.id).toBe(first.version.id)
		expect(second.version.summary).toBe("A mathematician.")
		expect(await versionsOf(w.member.id)).toHaveLength(2)

		// A follow puts the field back to the card.
		const back = await authorWrite(
			w.member.id,
			{ personality: { follow: true } },
			{ branchId: null, date: { year: 5 }, personalPosition: null }
		)
		expect(back.version.follows).toContain("personality")
	})

	test("a write on a line is dated and stays off main", async () => {
		const w = await world()
		const before = (await asRead(w.member.id)).name
		const out = await authorWrite(
			w.member.id,
			{ name: "Ada the Younger" },
			{
				branchId: w.fork.id,
				date: { year: 6, month: 2 },
				personalPosition: 2
			}
		)
		expect(out.version).toMatchObject({
			branchId: w.fork.id,
			year: 6,
			month: 2,
			day: null,
			personalPosition: 2
		})
		expect((await asRead(w.member.id)).name).toBe(before)
	})

	test("an undated write on a line is refused in words", async () => {
		const w = await world()
		await expect(
			authorWrite(
				w.member.id,
				{ name: "x" },
				{ branchId: w.fork.id, date: null, personalPosition: null }
			)
		).rejects.toThrow(/undated cast version can only be on main/)
	})
})

describe("refusals", () => {
	test("empty changes, an unknown key, both or neither of session and at, an unknown member", async () => {
		const w = await world()
		await expect(storyWrite(w, {})).rejects.toThrow(/changes nothing/)
		await expect(storyWrite(w, { bogus: "x" } as any)).rejects.toThrow(
			/"bogus" is not a character profile field/
		)
		await expect(
			testDb.transaction((tx) =>
				writeCastVersion(tx as unknown as Db, {
					member: w.member.id,
					changes: { name: "x" },
					writtenBy: "user:1"
				})
			)
		).rejects.toThrow(/needs a session or a place/)
		await expect(
			testDb.transaction((tx) =>
				writeCastVersion(tx as unknown as Db, {
					member: w.member.id,
					changes: { name: "x" },
					writtenBy: "user:1",
					session: { id: w.session.id },
					at: { branchId: null, date: null, personalPosition: null }
				})
			)
		).rejects.toThrow(/not both/)
		await expect(
			authorWrite(
				987654321,
				{ name: "x" },
				{ branchId: null, date: null, personalPosition: null }
			)
		).rejects.toThrow(/Cast member 987654321 does not exist/)
	})

	test("a follow on a card-less member is refused, by either writer", async () => {
		const w = await world({ card: false })
		await message(w.session.id)
		await expect(
			storyWrite(w, { description: { follow: true } })
		).rejects.toThrow(
			new RegExp(
				`${w.member.name} has no card to follow, so description stays their own`
			)
		)
		await expect(
			authorWrite(
				w.member.id,
				{ description: { follow: true } },
				{ branchId: null, date: null, personalPosition: null }
			)
		).rejects.toThrow(/has no card to follow/)
		expect(await versionsOf(w.member.id)).toHaveLength(1)
	})

	test("a member whose amendments are not lifted is refused", async () => {
		const w = await world()
		const [raw] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: w.book.id,
				binding: `{{char:raw-${w.suffix}}}`,
				characterId: null,
				name: "Raw",
				description: "Raw."
			})
			.returning()
		await testDb.insert(schema.castAmendments).values({
			lorebookBindingId: raw!.id,
			lorebookId: w.book.id,
			year: 3,
			fields: { name: "Later" }
		} as any)
		await expect(
			authorWrite(
				raw!.id,
				{ summary: "s" },
				{ branchId: null, date: null, personalPosition: null }
			)
		).rejects.toThrow(
			/Raw hasn't been moved onto character versions yet; restart the server so the upgrade lifts them\./
		)
		expect(await versionsOf(raw!.id)).toHaveLength(0)
	})
})

describe("a session's story write", () => {
	test("takes the state lock first, on the caller's transaction", async () => {
		const w = await world()
		await message(w.session.id)
		const { lockStateVersion } = await import("$lib/server/state/write")
		const spy = vi.mocked(lockStateVersion)
		spy.mockClear()
		const order: string[] = []
		spy.mockImplementationOnce(async (tx, sessionId) => {
			order.push("lock")
			const { sql } = await import("drizzle-orm")
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext('stateVersion'), ${sessionId})`
			)
		})
		await testDb.transaction(async (tx) => {
			const logged = new Proxy(tx, {
				get(target, key, receiver) {
					const value = Reflect.get(target, key, receiver)
					if (
						typeof value === "function" &&
						["select", "insert", "update", "execute"].includes(
							String(key)
						)
					)
						return (...args: unknown[]) => {
							if (!order.length) order.push(String(key))
							return value.apply(target, args)
						}
					return value
				}
			})
			await writeCastVersion(logged as unknown as Db, {
				member: w.member.id,
				changes: { summary: "s" },
				writtenBy: "run:1",
				session: { id: w.session.id }
			})
		})
		expect(spy).toHaveBeenCalledTimes(1)
		expect(spy.mock.calls[0]![1]).toBe(w.session.id)
		// Nothing was asked of the database before the lock.
		expect(order[0]).toBe("lock")
	})

	test("the first write of a branch session with the flag forks its line and lands on it, dated and anchored", async () => {
		const w = await world({ flag: true })
		const turn = await message(w.session.id)
		const out = await storyWrite(w, { summary: "Seen at dawn." })
		expect(out.coalesced).toBe(false)
		const after = (
			await testDb
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.id, w.session.id))
		)[0]!
		expect(after.lineOnFirstWrite).toBe(false)
		expect(after.lorebookBranchId).not.toBe(w.fork.id)
		const [line] = await testDb
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, after.lorebookBranchId!))
		expect(line).toMatchObject({
			forkedFromBranchId: w.fork.id,
			forkYear: 5,
			forkMonth: 1,
			forkDay: 1
		})
		expect(out.version).toMatchObject({
			castMemberId: w.member.id,
			lorebookId: w.book.id,
			branchId: after.lorebookBranchId,
			year: 5,
			month: 1,
			day: 1,
			atHour: 9,
			atMinute: 30,
			sourceSessionId: w.session.id,
			sourceMessageId: turn,
			validFromMessageId: turn,
			writtenBy: `run:${w.session.id}`,
			summary: "Seen at dawn.",
			follows: w.base.follows,
			parentVersionId: w.base.parentVersionId,
			personalPosition: null
		})
		// The session reads it; the book's main does not.
		expect((await asRead(w.member.id, w.session.id)).summary).toBe(
			"Seen at dawn."
		)
		expect((await asRead(w.member.id)).summary).toBeNull()
	})

	test("two writes in one turn coalesce in place; a new turn, a clock move and a time move each insert", async () => {
		const w = await world()
		await message(w.session.id)
		const first = await storyWrite(w, { summary: "One." })
		const second = await storyWrite(w, { personality: "Two." })
		expect(second.coalesced).toBe(true)
		expect(second.version.id).toBe(first.version.id)
		expect(second.version).toMatchObject({
			summary: "One.",
			personality: "Two."
		})
		expect(await versionsOf(w.member.id)).toHaveLength(2)

		// A new turn: a later message is the world's open anchor now.
		const later = await message(w.session.id)
		const third = await storyWrite(w, { summary: "Three." })
		expect(third.coalesced).toBe(false)
		expect(third.version.id).not.toBe(first.version.id)
		expect(third.version).toMatchObject({
			sourceMessageId: later,
			summary: "Three.",
			// A complete copy: the earlier turn's change is carried.
			personality: "Two."
		})
		expect(await versionsOf(w.member.id)).toHaveLength(3)

		// The clock moves a day: a new row at the new date.
		await testDb
			.update(schema.sessions)
			.set({ storyClockDay: 2 })
			.where(eq(schema.sessions.id, w.session.id))
		const fourth = await storyWrite(w, { summary: "Four." })
		expect(fourth.coalesced).toBe(false)
		expect(fourth.version).toMatchObject({ year: 5, month: 1, day: 2 })

		// Only the time of day moves: a new row too.
		await testDb
			.update(schema.sessions)
			.set({ storyClockMinute: 45 })
			.where(eq(schema.sessions.id, w.session.id))
		const fifth = await storyWrite(w, { summary: "Five." })
		expect(fifth.coalesced).toBe(false)
		expect(fifth.version).toMatchObject({ atHour: 9, atMinute: 45 })
		expect(await versionsOf(w.member.id)).toHaveLength(5)
	})

	test("an explicit open message anchors the write; a null message is refused and writes nothing", async () => {
		const w = await world({ flag: true })
		const turn = await message(w.session.id)
		const anchored = await storyWrite(
			w,
			{ summary: "A" },
			{ session: { messageId: turn } }
		)
		expect(anchored.version.sourceMessageId).toBe(turn)
		// The anchored write forked the line; a fresh riding world shows the refusal leaves nothing.
		const v = await world({ flag: true })
		const before = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
		const forks = await testDb.select().from(schema.lorebookBranches)
		await expect(
			storyWrite(v, { summary: "B" }, { session: { messageId: null } })
		).rejects.toThrow(/needs the turn it belongs to/)
		expect(await versionsOf(v.member.id)).toHaveLength(1)
		expect(
			await testDb
				.select({ id: schema.lorebookBindings.id })
				.from(schema.lorebookBindings)
		).toHaveLength(before.length)
		expect(
			await testDb.select().from(schema.lorebookBranches)
		).toHaveLength(forks.length)
		const [s] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, v.session.id))
		expect(s!.lineOnFirstWrite).toBe(true)
	})

	test("a story write with no open turn is refused and writes nothing", async () => {
		const w = await world({ bookOwner: "other" })
		const before = await testDb.select().from(schema.lorebookBindings)
		await expect(storyWrite(w, { summary: "x" })).rejects.toThrow(
			/needs the turn it belongs to/
		)
		expect(await versionsOf(w.member.id)).toHaveLength(1)
		expect(
			await testDb.select().from(schema.lorebookBindings)
		).toHaveLength(before.length)
	})

	test("a member holding no version is refused by both writers, in words, and nothing is written", async () => {
		const w = await world()
		const [raw] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: w.book.id,
				binding: `{{raw:${w.suffix}}}`,
				name: "Straggler"
			} as any)
			.returning()
		const turn = await message(w.session.id)
		const words =
			/Straggler hasn't been moved onto character versions yet; restart the server so the upgrade lifts them\./
		await expect(
			storyWrite(
				w,
				{ summary: "x" },
				{ member: raw!.id, session: { messageId: turn } }
			)
		).rejects.toThrow(words)
		await expect(
			authorWrite(
				raw!.id,
				{ summary: "y" },
				{ branchId: null, date: null, personalPosition: null }
			)
		).rejects.toThrow(words)
		expect(await versionsOf(raw!.id)).toHaveLength(0)
	})

	test("U+0000 is stripped from a cast version's profile before it is stored", async () => {
		const w = await world()
		const turn = await message(w.session.id)
		const { version } = await storyWrite(
			w,
			{
				description: "a\u0000b",
				extensions: { deep: { s: "c\u0000d", list: ["e\u0000f"] } }
			} as CastVersionChanges,
			{ session: { messageId: turn } }
		)
		expect(version.description).toBe("ab")
		expect(version.extensions).toEqual({ deep: { s: "cd", list: ["ef"] } })
		const [stored] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, version.id))
		expect(stored!.description).toBe("ab")
		// The same turn again coalesces in place; that set is stripped too.
		const again = await storyWrite(
			w,
			{ description: "x\u0000y" },
			{ session: { messageId: turn } }
		)
		expect(again.coalesced).toBe(true)
		expect(again.version.description).toBe("xy")
	})

	test("the copy keeps the life point of the version it copies", async () => {
		const w = await world()
		await message(w.session.id)
		const [lifePoint] = await insertCharacterVersions(db(), [
			{
				castMemberId: w.member.id,
				lorebookId: w.book.id,
				parentVersionId: w.base.parentVersionId,
				follows: w.base.follows,
				nodeState: "active",
				nodeVisibility: "normal",
				year: 1,
				personalPosition: 3,
				name: "Ada, second life",
				description: "",
				personality: "",
				scenario: ""
			}
		])
		const out = await storyWrite(w, { summary: "Back again." })
		expect(out.version.personalPosition).toBe(3)
		expect(out.version.name).toBe("Ada, second life")
		expect(out.version.id).not.toBe(lifePoint!.id)
	})

	test.each([
		["Review changes", "review", "session"],
		["Off", "off", "session"],
		["a book someone else owns", "full", "other"]
	] as const)(
		"%s: the write lands on the session's overlay row in its own book",
		async (_label, mode, owner) => {
			const w = await world({ bookOwner: owner })
			await setOwnMode(w.user.id, mode)
			await message(w.session.id)
			const out = await storyWrite(w, { summary: "Only here." })

			const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
			const own = (await ownBookOf(db(), w.session.id))!
			const [overlay] = await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.overlayOf, w.member.id))
			expect(overlay).toMatchObject({
				lorebookId: own.id,
				characterId: null,
				name: w.member.name
			})
			// No base for an overlay row: it holds the session's write alone.
			const overlayVersions = await versionsOf(overlay!.id)
			expect(overlayVersions).toHaveLength(1)
			expect(overlayVersions[0]).toMatchObject({
				id: out.version.id,
				lorebookId: own.id,
				branchId: null,
				year: 5,
				sourceSessionId: w.session.id,
				follows: w.base.follows,
				parentVersionId: w.base.parentVersionId
			})
			// The book's own version is untouched.
			expect(await versionsOf(w.member.id)).toHaveLength(1)

			// The session reads it; nobody else does.
			expect((await asRead(w.member.id, w.session.id)).summary).toBe(
				"Only here."
			)
			expect((await asRead(w.member.id)).summary).toBeNull()

			// A second write of the turn lands on the same row.
			const again = await storyWrite(w, { personality: "Quiet." })
			expect(again.coalesced).toBe(true)
			expect(again.version.id).toBe(out.version.id)
			expect(
				await testDb
					.select()
					.from(schema.lorebookBindings)
					.where(eq(schema.lorebookBindings.overlayOf, w.member.id))
			).toHaveLength(1)
		}
	)

	test("a person in the session's own book is written in place of an overlay", async () => {
		const w = await world()
		await message(w.session.id)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(db(), w.session.id)
		const { member: mine } = await insertCastMember(db(), {
			lorebookId: own.id,
			binding: "{{char:1}}",
			characterId: null,
			name: "Pip",
			description: "A page."
		})
		const out = await storyWrite(
			w,
			{ summary: "Carries the post." },
			{ member: mine.id }
		)
		expect(out.version).toMatchObject({
			castMemberId: mine.id,
			lorebookId: own.id,
			branchId: null,
			sourceSessionId: w.session.id
		})
		expect(
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.overlayOf, mine.id))
		).toHaveLength(0)
		expect((await asRead(mine.id, w.session.id)).summary).toBe(
			"Carries the post."
		)
	})

	test("an ancestor's own-book person is overlaid in the branch's own book", async () => {
		const w = await world()
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const parentOwn = await ownBookFor(db(), w.session.id)
		const { member: theirs } = await insertCastMember(db(), {
			lorebookId: parentOwn.id,
			binding: "{{char:1}}",
			characterId: null,
			name: "Pip",
			description: "A page."
		})
		const branch = await newSession(w.user.id, {
			lorebookId: w.book.id,
			branchAncestry: [{ sessionId: w.session.id, mark: 1_000_000 }],
			storyClockYear: 5
		})
		await message(branch.id)
		const out = await storyWrite(
			w,
			{ summary: "On the branch." },
			{ member: theirs.id, sessionId: branch.id }
		)
		const branchOwn = (await ownBookFor(db(), branch.id))!
		expect(branchOwn.id).not.toBe(parentOwn.id)
		const [overlay] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.overlayOf, theirs.id))
		expect(overlay).toMatchObject({
			lorebookId: branchOwn.id,
			characterId: null
		})
		expect(out.version).toMatchObject({
			castMemberId: overlay!.id,
			lorebookId: branchOwn.id,
			branchId: null
		})
		expect((await asRead(theirs.id, branch.id)).summary).toBe(
			"On the branch."
		)
		// The parent session still reads its own person as it was.
		expect((await asRead(theirs.id, w.session.id)).summary).toBeNull()
		expect(await versionsOf(theirs.id)).toHaveLength(1)
	})

	test("an in-place change of a row a branch reads retires it and inserts the new one", async () => {
		const w = await world()
		const turn = await message(w.session.id)
		const first = await storyWrite(w, { summary: "Before the fork." })

		// A branch forked from the session after that write: it copied the
		// turn's line, and reads the row through its session cut.
		const branch = await newSession(w.user.id, {
			lorebookId: w.book.id,
			branchAncestry: [
				{ sessionId: w.session.id, mark: first.version.writeOrder }
			],
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 1
		})
		await testDb.insert(schema.sessionMessages).values({
			sessionId: branch.id,
			role: "assistant",
			content: "copied",
			originSessionId: w.session.id,
			originMessageId: turn
		} as any)
		const { castVersionsInForce } = await import(
			"$lib/server/cast/memberAsRead"
		)
		const readBy = async (sessionId: number) =>
			(await castVersionsInForce(db(), [w.member.id], { sessionId })).get(
				w.member.id
			)!.version

		// The same turn writes again: the row the branch reads is retired.
		const second = await storyWrite(w, { personality: "Changed later." })
		expect(second.coalesced).toBe(false)
		expect(second.version.id).not.toBe(first.version.id)
		expect(second.version).toMatchObject({
			summary: "Before the fork.",
			personality: "Changed later.",
			sourceMessageId: turn
		})
		expect(second.version.writeOrder).toBeGreaterThan(
			first.version.writeOrder
		)
		const [retired] = (await versionsOf(w.member.id)).filter(
			(v) => v.id === first.version.id
		)
		expect(retired!.retiredOrder).not.toBeNull()
		expect(retired!.retiredOrder!).toBeGreaterThan(first.version.writeOrder)
		expect(retired!.personality).toBe(first.version.personality)

		// The branch still reads the row as it was; the session reads the new one.
		expect((await readBy(branch.id)).id).toBe(first.version.id)
		expect((await readBy(w.session.id)).id).toBe(second.version.id)

		// And a third write of the turn is in place again: nobody reads `second`.
		const third = await storyWrite(w, { scenario: "In the library." })
		expect(third.coalesced).toBe(true)
		expect(third.version.id).toBe(second.version.id)
	})
})
