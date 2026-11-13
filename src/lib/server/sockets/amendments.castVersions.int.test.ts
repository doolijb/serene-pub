/**
 * Dated changes to a cast member are cast versions (plan §32 §3, §9; ★CV-20,
 * ★CV-13, ★CV-15): `amendments:create` / `update` / `delete` with a cast
 * subject write through the versions writer's author path, the cast half of
 * `amendments:list` lists versions (each as what changed from the one before),
 * `cardMemberAt` reads the version in force, and the frozen `cast_amendments`
 * is never written.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import {
	insertCard,
	insertCastMember,
	insertCharacterVersions,
	newCardVersion
} from "$lib/server/characters/versions"
import { profileOf } from "$lib/shared/characters/profile"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-amend-versions-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
let n = 0

async function handlers() {
	return import("./amendments")
}

/** A user, a book, a card and a carded (or card-less) member with its base version. */
async function world(o: { card?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `amv-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Ashfall ${suffix}`, userId: user.id })
		.returning()
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Verity ${suffix}`,
		description: "The card's description."
	})
	const carded = o.card !== false
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: carded ? card.id : null,
		name: `Verity ${suffix}`,
		description: carded ? null : "Her own description."
	})
	return { user, book: book!, card, member, base: base! }
}
type World = Awaited<ReturnType<typeof world>>

const create = async (
	w: World,
	over: Record<string, unknown> & { fields: Record<string, unknown> }
) => {
	const m = await handlers()
	return m.amendmentsCreateHandler.handler(
		fakeSocket(w.user.id),
		{ lorebookId: w.book.id, castId: w.member.id, ...over } as any,
		noopEmit
	)
}

const update = async (w: World, over: Record<string, unknown>) => {
	const m = await handlers()
	return m.amendmentsUpdateHandler.handler(
		fakeSocket(w.user.id),
		{ lorebookId: w.book.id, subject: "cast", ...over } as any,
		noopEmit
	)
}

const remove = async (w: World, id: number) => {
	const m = await handlers()
	return m.amendmentsDeleteHandler.handler(
		fakeSocket(w.user.id),
		{ lorebookId: w.book.id, subject: "cast", id },
		noopEmit
	)
}

const listOf = async (w: World) => {
	const m = await handlers()
	return m.amendmentsListHandler.handler(
		fakeSocket(w.user.id),
		{ lorebookId: w.book.id },
		noopEmit
	)
}

const versionsOf = (w: World) =>
	testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, w.member.id))
		.orderBy(schema.characterVersions.id)

const amendmentRows = (w: World) =>
	testDb
		.select()
		.from(schema.castAmendments)
		.where(eq(schema.castAmendments.lorebookId, w.book.id))

/** The member as the main line reads them at `year`, at a life point. */
async function readAt(
	w: World,
	year: number | null,
	appearance: number | null = null
) {
	const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
	return (await memberAsRead(db(), w.member.id, {
		reading: {
			branchId: null,
			moment: year == null ? null : { year, month: null, day: null },
			forkedAt: null,
			line: MAIN_LINE
		},
		appearance
	}))!
}

/** A version a session wrote at a date: a copy of the base with a source session. */
async function sessionVersion(
	w: World,
	year: number,
	own: Partial<typeof schema.characterVersions.$inferInsert> = {}
) {
	const [row] = await insertCharacterVersions(db(), [
		{
			castMemberId: w.member.id,
			lorebookId: w.book.id,
			parentVersionId: w.base.parentVersionId,
			follows: w.base.follows,
			nodeState: "active",
			nodeVisibility: "normal",
			year,
			sourceSessionId: 987654,
			writtenBy: "run:987654",
			...own
		} as any
	])
	return row!
}

describe("a dated change is a cast version", () => {
	test("the round trip: a version, read from its date on, listed as what changed", async () => {
		const w = await world()
		const res = await create(w, {
			year: 10,
			fields: {
				description: "A wry keeper.",
				retold: { description: true }
			}
		})
		const versions = await versionsOf(w)
		expect(versions).toHaveLength(2)
		const made = versions.find((v) => v.year === 10)!
		expect(made).toMatchObject({
			castMemberId: w.member.id,
			lorebookId: w.book.id,
			branchId: null,
			sourceSessionId: null,
			writtenBy: `user:${w.user.id}`,
			parentVersionId: w.base.parentVersionId
		})
		expect(made.follows).not.toContain("description")

		expect((await readAt(w, 12)).description).toBe("A wry keeper.")
		expect((await readAt(w, 5)).description).toBe("The card's description.")

		expect(res.cast).toHaveLength(1)
		expect(res.cast[0]).toMatchObject({
			id: made.id,
			castId: w.member.id,
			lorebookId: w.book.id,
			branchId: null,
			year: 10,
			month: null,
			day: null,
			historyEntryId: null,
			personalPosition: null
		})
		// Only what differs from the base, in the member form's column names.
		expect(res.cast[0].fields).toEqual({
			description: "A wry keeper.",
			retold: { description: true }
		})
		expect((await listOf(w)).cast).toEqual(res.cast)
		expect(await amendmentRows(w)).toHaveLength(0)
	})

	test("an update rewrites the same version; a later one lists only what differs from the one before", async () => {
		const w = await world()
		const first = await create(w, {
			year: 10,
			fields: {
				description: "A wry keeper.",
				retold: { description: true }
			}
		})
		const id = first.cast[0].id

		const edited = await update(w, {
			id,
			fields: {
				description: "A grim keeper.",
				retold: { description: true }
			}
		})
		expect(edited.cast).toHaveLength(1)
		expect(edited.cast[0].id).toBe(id)
		expect(edited.cast[0].fields).toEqual({
			description: "A grim keeper.",
			retold: { description: true }
		})
		expect(await versionsOf(w)).toHaveLength(2)
		expect((await readAt(w, 12)).description).toBe("A grim keeper.")

		const second = await create(w, {
			year: 20,
			fields: {
				personality: "Stern.",
				retold: { description: true, personality: true }
			}
		})
		expect(second.cast).toHaveLength(2)
		const y20 = second.cast.find((c) => c.year === 20)!
		expect(y20.fields).toEqual({
			personality: "Stern.",
			retold: { description: true, personality: true }
		})
		// The earlier one is unchanged by the later one.
		expect(second.cast.find((c) => c.year === 10)!.fields).toEqual(
			edited.cast[0].fields
		)
		const r20 = await readAt(w, 25)
		expect(r20.personality).toBe("Stern.")
		expect(r20.description).toBe("A grim keeper.")
		expect(await amendmentRows(w)).toHaveLength(0)
	})

	test("an update replaces the change's whole field set: a field left out goes back to the one before", async () => {
		const w = await world()
		const first = await create(w, {
			year: 10,
			fields: { summary: "Keeper.", spriteSet: "grim" }
		})
		expect(first.cast[0].fields).toEqual({
			summary: "Keeper.",
			spriteSet: "grim"
		})
		const edited = await update(w, {
			id: first.cast[0].id,
			fields: { summary: "Keeper of the marrow." }
		})
		expect(edited.cast[0].fields).toEqual({
			summary: "Keeper of the marrow."
		})
		const read = await readAt(w, 12)
		expect(read.summary).toBe("Keeper of the marrow.")
		expect(read.spriteSet).toBeNull()
	})

	test("a carded member's name is their own name; a card-less member's name is the name", async () => {
		const carded = await world()
		const a = await create(carded, {
			year: 10,
			fields: { name: "Verity the Keeper" }
		})
		expect(a.cast[0].fields).toEqual({ ownName: "Verity the Keeper" })

		const bare = await world({ card: false })
		const b = await create(bare, {
			year: 10,
			fields: { name: "Verity the Keeper" }
		})
		expect(b.cast[0].fields).toEqual({ name: "Verity the Keeper" })
	})

	test("a life point is carried: the version reads only from that point of their life", async () => {
		const w = await world()
		const res = await create(w, {
			year: 10,
			personalPosition: 40,
			fields: { summary: "Older." }
		})
		expect(res.cast[0]).toMatchObject({ year: 10, personalPosition: 40 })
		expect(
			(await versionsOf(w)).find((v) => v.year === 10)!.personalPosition
		).toBe(40)
		expect((await readAt(w, 12, 30)).summary).not.toBe("Older.")
		expect((await readAt(w, 12, 50)).summary).toBe("Older.")
		expect((await readAt(w, 12, null)).summary).toBe("Older.")
	})

	test("a change with no date part of its own lands on the same key: written again, it is the same version", async () => {
		const w = await world()
		const a = await create(w, { year: 10, fields: { summary: "One." } })
		const b = await create(w, { year: 10, fields: { summary: "Two." } })
		expect(b.cast).toHaveLength(1)
		expect(b.cast[0].id).toBe(a.cast[0].id)
		expect(b.cast[0].fields).toEqual({ summary: "Two." })
	})

	test("a change on a line is listed against what that line read before it", async () => {
		const w = await world()
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: w.book.id,
				name: "marrow-stays",
				forkYear: 8
			})
			.returning()
		await create(w, { year: 5, fields: { summary: "On main." } })
		const res = await create(w, {
			year: 12,
			branchId: fork.id,
			fields: { summary: "On the fork.", spriteSet: "grim" }
		})
		const onFork = res.cast.find((c) => c.branchId === fork.id)!
		expect(onFork.fields).toEqual({
			summary: "On the fork.",
			spriteSet: "grim"
		})
		// The fork reads main's Y5 summary as the one before it; main never sees the fork's.
		expect((await readAt(w, 20)).summary).toBe("On main.")
		expect(res.cast.find((c) => c.branchId === null)!.fields).toEqual({
			summary: "On main."
		})
	})

	test("a member that has no version yet is refused in words, and nothing is written", async () => {
		const w = await world()
		await testDb
			.delete(schema.characterVersions)
			.where(eq(schema.characterVersions.castMemberId, w.member.id))
		await expect(
			create(w, { year: 10, fields: { summary: "Keeper." } })
		).rejects.toThrow(
			/hasn't been moved onto character versions yet; restart the server so the upgrade lifts them\./
		)
		expect(await versionsOf(w)).toHaveLength(0)
	})
})

describe("change later versions (★CV-13)", () => {
	async function laterWorld() {
		const w = await world()
		await create(w, {
			year: 20,
			fields: { personality: "P20", retold: { personality: true } }
		})
		await create(w, {
			year: 30,
			fields: { personality: "P30", retold: { personality: true } }
		})
		return w
	}

	test("off: the later versions keep their own words", async () => {
		const w = await laterWorld()
		const res = await create(w, { year: 10, fields: { summary: "S10" } })
		expect(res.laterVersions).toEqual({ changed: 0, kept: 2 })
		expect((await readAt(w, 15)).summary).toBe("S10")
		// Y20 keeps what it said: it never said S10.
		expect((await readAt(w, 25)).summary).toBeNull()
		const y20 = (await versionsOf(w)).find((v) => v.year === 20)!
		expect(y20.summary).not.toBe("S10")
	})

	test("on: the same fields are written onto each later version, in place", async () => {
		const w = await laterWorld()
		const before = await versionsOf(w)
		const res = await create(w, {
			year: 10,
			fields: { summary: "S10" },
			changeLaterVersions: true
		})
		expect(res.laterVersions).toEqual({ changed: 2, kept: 0 })
		const after = await versionsOf(w)
		// The one new version is Y10's; the later two are the same rows.
		expect(after).toHaveLength(before.length + 1)
		for (const v of after.filter((x) => x.year === 20 || x.year === 30))
			expect(v.summary).toBe("S10")
		expect((await readAt(w, 35)).personality).toBe("P30")
	})

	test("a version a session wrote keeps its own words either way", async () => {
		const w = await laterWorld()
		const theirs = await sessionVersion(w, 40, { summary: "Theirs." })
		const res = await create(w, {
			year: 10,
			fields: { summary: "S10" },
			changeLaterVersions: true
		})
		expect(res.laterVersions).toEqual({ changed: 2, kept: 1 })
		const [still] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, theirs.id))
		expect(still.summary).toBe("Theirs.")
	})

	test("an update can change the later versions too", async () => {
		const w = await laterWorld()
		const first = await create(w, { year: 10, fields: { summary: "S10" } })
		const y10 = first.cast.find((c) => c.year === 10)!
		const res = await update(w, {
			id: y10.id,
			fields: { summary: "S10b" },
			changeLaterVersions: true
		})
		expect(res.laterVersions).toEqual({ changed: 2, kept: 0 })
		expect((await readAt(w, 35)).summary).toBe("S10b")
		const off = await update(w, {
			id: y10.id,
			fields: { summary: "S10c" }
		})
		expect(off.laterVersions).toEqual({ changed: 0, kept: 2 })
		expect((await readAt(w, 35)).summary).toBe("S10b")
	})
})

/** A second card of the same user. */
async function otherCard(w: World, description = "The other card's words.") {
	const { card } = await insertCard(db(), {
		userId: w.user.id,
		name: `Keeper ${++n}`,
		description
	})
	return card
}

describe("a dated card change", () => {
	test("a card-less member at D: earlier versions stay card-less, the change and later ones follow the new card", async () => {
		const w = await world({ card: false })
		const card = await otherCard(w)
		await create(w, { year: 30, fields: { summary: "Later." } })
		const res = await create(w, {
			year: 20,
			fields: { characterId: card.id }
		})
		expect(res.cast.map((c) => c.year).sort()).toEqual([20, 30])

		const early = await readAt(w, 10)
		expect(early.activeCardId).toBeNull()
		expect(early.description).toBe("Her own description.")

		const at20 = await readAt(w, 22)
		expect(at20.activeCardId).toBe(card.id)
		expect(at20.description).toBe("The other card's words.")

		const at30 = await readAt(w, 35)
		expect(at30.activeCardId).toBe(card.id)
		expect(at30.description).toBe("The other card's words.")
		expect(at30.summary).toBe("Later.")

		const [base] = (await versionsOf(w)).filter((v) => v.year == null)
		expect(base.parentVersionId).toBeNull()
		expect(base.description).toBe("Her own description.")
	})

	test("a card change alone with change-later on writes nothing more onto the later versions", async () => {
		const w = await world({ card: false })
		const card = await otherCard(w)
		await create(w, { year: 30, fields: { summary: "Later." } })
		const res = await create(w, {
			year: 20,
			fields: { characterId: card.id },
			changeLaterVersions: true
		})
		expect(res.laterVersions).toEqual({ changed: 0, kept: 1 })
		const at30 = await readAt(w, 35)
		expect(at30.activeCardId).toBe(card.id)
		expect(at30.summary).toBe("Later.")
	})

	test("a swap from card A to card B keeps each later version's own follows", async () => {
		const w = await world()
		const b = await otherCard(w)
		await create(w, {
			year: 30,
			fields: {
				description: "Her own words at 30.",
				retold: { description: true }
			}
		})
		await create(w, { year: 20, fields: { characterId: b.id } })

		expect((await readAt(w, 10)).activeCardId).toBe(w.card.id)
		const mid = await readAt(w, 22)
		expect(mid.activeCardId).toBe(b.id)
		expect(mid.description).toBe("The other card's words.")
		const late = await readAt(w, 35)
		expect(late.activeCardId).toBe(b.id)
		expect(late.description).toBe("Her own words at 30.")
	})

	test("characterId null at a date: drawn with no card from then on", async () => {
		const w = await world()
		await create(w, { year: 20, fields: { characterId: null } })
		expect((await readAt(w, 10)).activeCardId).toBe(w.card.id)
		const after = await readAt(w, 25)
		expect(after.activeCardId).toBeNull()
		expect(after.description).toBe("The card's description.")
	})

	test("a card another member already has is refused", async () => {
		const w = await world()
		const card = await otherCard(w)
		await insertCastMember(db(), {
			lorebookId: w.book.id,
			binding: "{{char:other}}",
			characterId: card.id,
			name: "Other"
		})
		await expect(
			create(w, { year: 20, fields: { characterId: card.id } })
		).rejects.toThrow("a card draws one cast member")
	})

	/** Card-less; 30 links C, 40 goes card-less, 50 retells the summary. */
	async function linkedThenUnlinked(w: World) {
		const c = await otherCard(w)
		await create(w, { year: 30, fields: { characterId: c.id } })
		await create(w, { year: 40, fields: { characterId: null } })
		await create(w, { year: 50, fields: { summary: "Last." } })
		return c
	}

	test("a new dated card change stops at the next card change", async () => {
		const w = await world({ card: false })
		const c = await linkedThenUnlinked(w)
		const d = await otherCard(w)
		await create(w, { year: 20, fields: { characterId: d.id } })

		expect((await readAt(w, 25)).activeCardId).toBe(d.id)
		expect((await readAt(w, 35)).activeCardId).toBe(c.id)
		expect((await readAt(w, 45)).activeCardId).toBeNull()
		const late = await readAt(w, 55)
		expect(late.activeCardId).toBeNull()
		expect(late.summary).toBe("Last.")
	})

	test("a new dated swap leaves a later change on another card alone", async () => {
		const w = await world()
		const b = await otherCard(w)
		const d = await otherCard(w)
		await create(w, { year: 40, fields: { characterId: b.id } })
		await create(w, { year: 20, fields: { characterId: d.id } })

		expect((await readAt(w, 10)).activeCardId).toBe(w.card.id)
		expect((await readAt(w, 25)).activeCardId).toBe(d.id)
		expect((await readAt(w, 45)).activeCardId).toBe(b.id)
	})

	test("the fields path is bounded too", async () => {
		const w = await world({ card: false })
		const d = await otherCard(w)
		const made = await create(w, {
			year: 20,
			fields: { summary: "Twenty." }
		})
		const id = made.cast.find((c) => c.year === 20)!.id
		const c = await linkedThenUnlinked(w)
		await update(w, { id, fields: { characterId: d.id } })

		expect((await readAt(w, 25)).activeCardId).toBe(d.id)
		expect((await readAt(w, 35)).activeCardId).toBe(c.id)
		expect((await readAt(w, 55)).activeCardId).toBeNull()
	})

	test("the fields path with a re-date is bounded too", async () => {
		const w = await world({ card: false })
		const d = await otherCard(w)
		const made = await create(w, {
			year: 20,
			fields: { summary: "Twenty." }
		})
		const id = made.cast.find((c) => c.year === 20)!.id
		const c = await linkedThenUnlinked(w)
		await update(w, { id, year: 15, fields: { characterId: d.id } })

		expect((await readAt(w, 17)).activeCardId).toBe(d.id)
		expect((await readAt(w, 35)).activeCardId).toBe(c.id)
		expect((await readAt(w, 55)).activeCardId).toBeNull()
	})
})

describe("moving a change to another date", () => {
	test("a year-only patch keeps month and day; the change reads from the new date", async () => {
		const w = await world()
		const made = await create(w, {
			year: 10,
			month: 3,
			day: 4,
			fields: { summary: "Keeper." }
		})
		const id = made.cast[0].id
		const res = await update(w, { id, year: 11 })
		expect(res.cast[0]).toMatchObject({ id, year: 11, month: 3, day: 4 })
		expect((await readAt(w, 10)).summary).not.toBe("Keeper.")
		expect((await readAt(w, 12)).summary).toBe("Keeper.")
	})

	test("clearing the month clears the day; a date and fields in one request", async () => {
		const w = await world()
		const made = await create(w, {
			year: 10,
			month: 3,
			day: 4,
			fields: { summary: "Keeper." }
		})
		const id = made.cast[0].id
		const res = await update(w, {
			id,
			month: null,
			fields: { summary: "Warden." }
		})
		expect(res.cast[0]).toMatchObject({
			id,
			year: 10,
			month: null,
			day: null
		})
		expect(res.cast[0].fields).toEqual({ summary: "Warden." })
	})

	test("a move onto another change's date is refused in words, nothing moves", async () => {
		const w = await world()
		await create(w, { year: 11, fields: { summary: "A." } })
		const made = await create(w, { year: 10, fields: { summary: "B." } })
		const id = made.cast.find((c) => c.year === 10)!.id
		await expect(update(w, { id, year: 11 })).rejects.toThrow(
			"already has a change of their own at that date"
		)
		const [row] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, id))
		expect(row.year).toBe(10)
	})

	test("moving a dated link later: the versions between go back; earlier: the versions between come onto the card", async () => {
		const w = await world({ card: false })
		const card = await otherCard(w)
		await create(w, { year: 25, fields: { summary: "Mid." } })
		const made = await create(w, {
			year: 20,
			fields: { characterId: card.id }
		})
		const id = made.cast.find((c) => c.year === 20)!.id
		expect((await readAt(w, 27)).activeCardId).toBe(card.id)

		await update(w, { id, year: 30 })
		const mid = await readAt(w, 27)
		expect(mid.activeCardId).toBeNull()
		expect(mid.description).toBe("Her own description.")
		expect((await readAt(w, 32)).activeCardId).toBe(card.id)

		await update(w, { id, year: 10 })
		expect((await readAt(w, 12)).activeCardId).toBe(card.id)
		expect((await readAt(w, 27)).activeCardId).toBe(card.id)
	})

	test("a re-date keeps its history entry", async () => {
		const w = await world()
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{
						lorebookId: w.book.id,
						content: "Ten",
						year: 10,
						branchId: null
					}
				])
			)
			.returning({ id: schema.lorebookEntries.id })
		const made = await create(w, {
			year: 10,
			historyEntryId: entry!.id,
			fields: { summary: "Keeper." }
		})
		const id = made.cast[0].id
		await update(w, { id, year: 11 })
		const row = (await versionsOf(w)).find((v) => v.id === id)!
		expect(row.year).toBe(11)
		expect(row.historyEntryId).toBe(entry!.id)
	})

	test("a date the book's calendar refuses is refused", async () => {
		const w = await world()
		const made = await create(w, { year: 10, fields: { summary: "A." } })
		await expect(
			update(w, { id: made.cast[0].id, year: 11, month: null, day: 5 })
		).rejects.toThrow()
		const [row] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, made.cast[0].id))
		expect(row.year).toBe(10)
	})

	test("its own date is no move", async () => {
		const w = await world()
		const made = await create(w, {
			year: 10,
			fields: { summary: "Keeper." }
		})
		const id = made.cast[0].id
		const same = await update(w, {
			id,
			year: 10,
			fields: { summary: "Still." }
		})
		expect(same.cast[0]).toMatchObject({ id, year: 10 })
		expect(same.cast[0].fields).toEqual({ summary: "Still." })
		await expect(update(w, { id, year: 10 })).rejects.toThrow(
			"Nothing to change."
		)
	})
})

describe("editing a change a session wrote", () => {
	test("is edited in place when no branch reads it", async () => {
		const w = await world()
		const theirs = await sessionVersion(w, 12, { summary: "Theirs." })
		const res = await update(w, {
			id: theirs.id,
			fields: { summary: "Mine." }
		})
		expect(res.cast.map((c) => c.id)).toEqual([theirs.id])
		const [row] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, theirs.id))
		expect(row.summary).toBe("Mine.")
		expect(row.sourceSessionId).toBe(987654)
		expect(row.retiredOrder).toBeNull()
	})

	test("a branch that reads it keeps the old words: the row is retired and a copy edited", async () => {
		const w = await world()
		const theirs = await sessionVersion(w, 12, { summary: "Theirs." })
		const [parentSession] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: "P",
				genreId: "test:genre/versions-authoring",
				lorebookId: w.book.id
			} as any)
			.returning()
		await testDb
			.update(schema.characterVersions)
			.set({ sourceSessionId: parentSession.id })
			.where(eq(schema.characterVersions.id, theirs.id))
		const [child] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: "Branch",
				genreId: "test:genre/versions-authoring",
				lorebookId: w.book.id,
				branchAncestry: [
					{ sessionId: parentSession.id, mark: theirs.writeOrder }
				],
				storyClockYear: 20
			} as any)
			.returning()
		await testDb.insert(schema.sessionMessages).values({
			sessionId: child!.id,
			role: "assistant",
			content: "copied",
			originSessionId: parentSession.id,
			originMessageId: 1
		} as any)

		const res = await update(w, {
			id: theirs.id,
			fields: { summary: "Mine." }
		})
		const [old] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, theirs.id))
		expect(old.retiredOrder).not.toBeNull()
		expect(old.summary).toBe("Theirs.")
		expect(res.cast).toHaveLength(1)
		expect(res.cast[0].id).not.toBe(theirs.id)
		expect(res.cast[0].fields).toEqual({ summary: "Mine." })
	})
})

describe("removing a change", () => {
	test("an authored change is deleted", async () => {
		const w = await world()
		const made = await create(w, {
			year: 10,
			fields: { summary: "Keeper." }
		})
		const res = await remove(w, made.cast[0].id)
		expect(res.cast).toHaveLength(0)
		expect(await versionsOf(w)).toHaveLength(1)
		expect((await readAt(w, 12)).summary).not.toBe("Keeper.")
	})

	test("removing a dated link puts the later versions back card-less, with their own words", async () => {
		const w = await world({ card: false })
		const card = await otherCard(w)
		await create(w, { year: 30, fields: { summary: "Later." } })
		const link = await create(w, {
			year: 20,
			fields: { characterId: card.id }
		})
		await remove(w, link.cast.find((c) => c.year === 20)!.id)
		const at = await readAt(w, 35)
		expect(at.activeCardId).toBeNull()
		expect(at.description).toBe("Her own description.")
		expect(at.summary).toBe("Later.")
		const row = (await versionsOf(w)).find((v) => v.year === 30)!
		expect(row.parentVersionId).toBeNull()
		expect(row.follows).toEqual([])
	})

	test("removing a dated swap puts the later versions back on the card before, at the exact version", async () => {
		const w = await world()
		const b = await otherCard(w)
		await create(w, { year: 30, fields: { summary: "Later." } })
		const swap = await create(w, {
			year: 20,
			fields: { characterId: b.id }
		})
		await testDb.transaction(async (tx) => {
			const [cur] = await tx
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.id, w.base.parentVersionId!))
			await newCardVersion(tx as unknown as Db, w.card.id, {
				...profileOf(cur as any),
				description: "A newer card."
			})
		})
		await remove(w, swap.cast.find((c) => c.year === 20)!.id)
		const row = (await versionsOf(w)).find((v) => v.year === 30)!
		const base = (await versionsOf(w)).find((v) => v.year == null)!
		expect(row.parentVersionId).toBe(base.parentVersionId)
		expect((await readAt(w, 35)).activeCardId).toBe(w.card.id)
	})

	test("a later card change is spared", async () => {
		const w = await world({ card: false })
		const c = await otherCard(w)
		const d = await otherCard(w, "D's words.")
		const link = await create(w, {
			year: 20,
			fields: { characterId: c.id }
		})
		await create(w, { year: 40, fields: { characterId: d.id } })
		await create(w, { year: 50, fields: { summary: "Last." } })
		await remove(w, link.cast.find((v) => v.year === 20)!.id)
		expect((await readAt(w, 25)).activeCardId).toBeNull()
		expect((await readAt(w, 45)).activeCardId).toBe(d.id)
		expect((await readAt(w, 55)).activeCardId).toBe(d.id)
	})

	test("the base is refused, called by id", async () => {
		const w = await world()
		await expect(remove(w, w.base.id)).rejects.toThrow()
		expect(await versionsOf(w)).toHaveLength(1)
	})
})

describe("delete and scope", () => {
	test("a change a session wrote is taken", async () => {
		const w = await world()
		const theirs = await sessionVersion(w, 12, { summary: "Theirs." })
		const res = await remove(w, theirs.id)
		expect(res.cast).toHaveLength(0)
		expect(
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.id, theirs.id))
		).toHaveLength(0)
		expect(await versionsOf(w)).toHaveLength(1)
	})

	test("the base, a retired row and another book's version are not in this lorebook", async () => {
		const w = await world()
		const elsewhere = await world()
		const gone = "That amendment is not in this lorebook."
		await expect(remove(w, w.base.id)).rejects.toThrow(gone)
		await expect(
			update(w, { id: w.base.id, fields: { summary: "x" } })
		).rejects.toThrow(gone)
		await expect(remove(w, elsewhere.base.id)).rejects.toThrow(gone)
		const theirs = await sessionVersion(w, 12, { summary: "Theirs." })
		await testDb
			.update(schema.characterVersions)
			.set({ retiredOrder: 1_000_000_000 })
			.where(eq(schema.characterVersions.id, theirs.id))
		expect((await listOf(w)).cast).toHaveLength(0)
		await expect(remove(w, theirs.id)).rejects.toThrow(gone)
		await expect(
			update(w, { id: theirs.id, fields: { summary: "x" } })
		).rejects.toThrow(gone)
	})

	test("a cast change never writes cast_amendments, and an existing one is not read", async () => {
		const w = await world()
		await testDb.insert(schema.castAmendments).values({
			lorebookBindingId: w.member.id,
			lorebookId: w.book.id,
			year: 3,
			fields: { summary: "Frozen." }
		} as any)
		expect((await listOf(w)).cast).toHaveLength(0)
		const made = await create(w, {
			year: 10,
			fields: { summary: "Keeper." }
		})
		await update(w, { id: made.cast[0].id, fields: { summary: "Keeper!" } })
		expect(await amendmentRows(w)).toHaveLength(1)
		expect((await amendmentRows(w))[0].fields).toEqual({
			summary: "Frozen."
		})
	})
})

describe("cardMemberAt reads versions", () => {
	test("the member and each appearance read the version in force at their life point", async () => {
		const { cardMemberAt } = await handlers()
		const w = await world()
		await create(w, { year: 10, fields: { spriteSet: "grim" } })
		await create(w, {
			year: 10,
			personalPosition: 40,
			fields: { spriteSet: "elder" }
		})
		for (const personalPosition of [30, 50])
			await testDb.insert(schema.castPresences).values({
				lorebookId: w.book.id,
				lorebookBindingId: w.member.id,
				branchId: null,
				personalPosition,
				fromYear: 1
			})

		const at = (year: number | null) => ({
			line: MAIN_LINE,
			moment: year == null ? null : { year, month: null, day: null }
		})
		const early = await cardMemberAt(db(), {
			lorebookId: w.book.id,
			characterId: w.card.id,
			at: at(5)
		})
		// Before the first change: the base, and its active card.
		expect(early?.member).toMatchObject({
			id: w.member.id,
			characterId: w.card.id,
			spriteSet: null
		})

		const late = await cardMemberAt(db(), {
			lorebookId: w.book.id,
			characterId: w.card.id,
			at: at(12)
		})
		expect(late?.member).toMatchObject({
			id: w.member.id,
			characterId: w.card.id,
			// No appearance: every life point, so the personal one wins.
			spriteSet: "elder"
		})
		const bySet = Object.fromEntries(
			late!.appearances.map((a) => [
				a.personalPosition,
				a.member.spriteSet
			])
		)
		expect(bySet).toEqual({ 30: "grim", 50: "elder" })
		for (const a of late!.appearances)
			expect(a.member).toMatchObject({
				id: w.member.id,
				characterId: w.card.id
			})
	})

	test("a member with no version at all answers as its row", async () => {
		const { cardMemberAt } = await handlers()
		const w = await world()
		await testDb
			.delete(schema.characterVersions)
			.where(
				and(
					eq(schema.characterVersions.castMemberId, w.member.id),
					isNull(schema.characterVersions.cardId)
				)
			)
		const read = await cardMemberAt(db(), {
			lorebookId: w.book.id,
			characterId: w.card.id
		})
		expect(read?.member).toMatchObject({
			id: w.member.id,
			characterId: w.card.id
		})
	})
})

describe("the version-only fields in a dated change (owner, 2026-11-10)", () => {
	test("post-history instructions, creator notes and likeness are dated with their flag", async () => {
		const w = await world()
		await create(w, {
			year: 10,
			fields: {
				retold: {
					postHistoryInstructions: true,
					creatorNotes: true,
					likeness: true
				},
				postHistoryInstructions: "From Y10 she never lies.",
				creatorNotes: { text: "Older now.", variants: {} },
				likeness: { prompt: "  grey at the temples  " }
			}
		})
		const later = await readAt(w, 12)
		expect(later.postHistoryInstructions).toBe("From Y10 she never lies.")
		expect(later.creatorNotes).toMatchObject({ text: "Older now." })
		// The member form's rule normalises the likeness (text trimmed).
		expect(later.likeness).toMatchObject({ prompt: "grey at the temples" })
		const earlier = await readAt(w, 5)
		expect(earlier.postHistoryInstructions ?? null).not.toBe(
			"From Y10 she never lies."
		)
	})

	test("a creator notes value of the wrong shape is refused in the member form's words", async () => {
		const w = await world()
		await expect(
			create(w, {
				year: 10,
				fields: {
					retold: { creatorNotes: true },
					creatorNotes: "just text"
				}
			})
		).rejects.toThrow("A cast member's creator notes are null")
	})
})
