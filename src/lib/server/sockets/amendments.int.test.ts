/**
 * Dated overlays, end to end: stored, listed, and resolved.
 *
 * The resolver itself is pure and tested in
 * `$lib/shared/lorebooks/amendments.test.ts`. What is asserted here is the part
 * a pure test cannot reach — that a row survives the round trip with its date
 * and branch intact, that the resolver applied to what came back says what the
 * unit test says, and that neither an entry id nor a character id is a
 * capability: both are gated on the book, every time.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import {
	castAsOf,
	entryAsOf,
	type Amendment
} from "$lib/shared/lorebooks/amendments"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-amendments-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeLorebook(userId: number, name: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

async function makeEntry(lorebookId: number, over: Record<string, any> = {}) {
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			title: "Verity",
			content: "A novice.",
			keys: ["verity"],
			position: Math.floor(Math.random() * 1_000_000),
			...over
		} as any)
		.returning()
	return entry
}

async function makeCharacter(userId: number, name: string) {
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "A novice." } as any)
		.returning()
	return character
}

/** A cast member: the person in THIS book, carded or not. */
async function makeCastMember(
	lorebookId: number,
	name: string,
	characterId?: number
) {
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			name,
			binding: `{{char:${characterId ?? 0}}}`,
			characterId: characterId ?? null
		} as any)
		.returning()
	return member
}

async function handlers() {
	return import("./amendments")
}

describe("the round trip", () => {
	test("an amendment keeps its date, branch and fields", async () => {
		const { amendmentsCreateHandler, amendmentsListHandler } =
			await handlers()
		const user = await makeUser("amend-round")
		const book = await makeLorebook(user.id, "Ashfall")
		const entry = await makeEntry(book.id)

		await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				entryId: entry.id,
				year: 2,
				month: 3,
				fields: { content: "Newly named Keeper." }
			},
			noopEmit
		)

		const list = await amendmentsListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id },
			noopEmit
		)
		expect(list.entries).toHaveLength(1)
		expect(list.entries[0]).toMatchObject({
			entryId: entry.id,
			branchId: null,
			year: 2,
			month: 3,
			day: null,
			fields: { content: "Newly named Keeper." }
		})
	})

	test("what came back resolves the way the unit test says", async () => {
		const { amendmentsCreateHandler, amendmentsListHandler } =
			await handlers()
		const user = await makeUser("amend-resolve")
		const book = await makeLorebook(user.id, "Ashfall")
		const entry = await makeEntry(book.id)

		for (const [year, content] of [
			[2, "at Y2"],
			[6, "at Y6"]
		] as const)
			await amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					entryId: entry.id,
					year,
					fields: { content }
				},
				noopEmit
			)

		const list = await amendmentsListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id },
			noopEmit
		)
		const overlays = list.entries as unknown as Amendment[]
		const base = { content: "A novice." }

		expect(entryAsOf(base, overlays, { moment: { year: 1 } }).content).toBe(
			"A novice."
		)
		expect(entryAsOf(base, overlays, { moment: { year: 4 } }).content).toBe(
			"at Y2"
		)
		// Now applies everything dated, however far ahead.
		expect(entryAsOf(base, overlays, {}).content).toBe("at Y6")
	})

	test("a cast amendment rides the same road", async () => {
		const { amendmentsCreateHandler, amendmentsListHandler } =
			await handlers()
		const user = await makeUser("amend-card")
		const book = await makeLorebook(user.id, "Ashfall")
		const member = await makeCastMember(book.id, "Verity")

		await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				castId: member.id,
				year: 5,
				fields: { summary: "Keeper of the marrow." }
			},
			noopEmit
		)

		const list = await amendmentsListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id },
			noopEmit
		)
		expect(list.entries).toHaveLength(0)
		expect(list.cast).toHaveLength(1)
		expect(list.cast[0]).toMatchObject({
			castId: member.id,
			lorebookId: book.id,
			year: 5
		})
	})

	test("the CARD a member is represented by is amendable", async () => {
		// Ruled 2026-09-23: different cards for different lifecycles, with no
		// mechanism of its own — `characterId` is just a column to overlay.
		const { amendmentsCreateHandler, amendmentsListHandler } =
			await handlers()
		const user = await makeUser("amend-card-swap")
		const book = await makeLorebook(user.id, "Ashfall")
		const young = await makeCharacter(user.id, "Verity, novice")
		const old = await makeCharacter(user.id, "Verity, keeper")
		const member = await makeCastMember(book.id, "Verity", young.id)

		await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				castId: member.id,
				year: 20,
				fields: { characterId: old.id }
			},
			noopEmit
		)
		const list = await amendmentsListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id },
			noopEmit
		)
		const overlays = list.cast as unknown as Amendment[]
		const base = { id: member.id, characterId: young.id }
		expect(
			castAsOf(base, overlays, { moment: { year: 19 } }).characterId
		).toBe(young.id)
		expect(
			castAsOf(base, overlays, { moment: { year: 20 } }).characterId
		).toBe(old.id)
	})
})

describe("an amendment is a date", () => {
	test("a year that is not a number is refused", async () => {
		const { amendmentsCreateHandler } = await handlers()
		const user = await makeUser("amend-nodate")
		const book = await makeLorebook(user.id, "Ashfall")
		const entry = await makeEntry(book.id)
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					entryId: entry.id,
					year: undefined as any,
					fields: {}
				},
				noopEmit
			)
		).rejects.toThrow(/needs a year/i)
	})

	test("a day with no month is refused: the calendar narrows left to right", async () => {
		const { amendmentsCreateHandler } = await handlers()
		const user = await makeUser("amend-dayonly")
		const book = await makeLorebook(user.id, "Ashfall")
		const entry = await makeEntry(book.id)
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					entryId: entry.id,
					year: 2,
					day: 4,
					fields: {}
				},
				noopEmit
			)
		).rejects.toThrow(/day needs a month/i)
	})

	test("one subject, never both and never neither", async () => {
		const { amendmentsCreateHandler } = await handlers()
		const user = await makeUser("amend-subject")
		const book = await makeLorebook(user.id, "Ashfall")
		const entry = await makeEntry(book.id)
		const member = await makeCastMember(book.id, "Verity")

		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{ lorebookId: book.id, year: 2, fields: {} },
				noopEmit
			)
		).rejects.toThrow(/one entry or one cast member/i)

		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					entryId: entry.id,
					castId: member.id,
					year: 2,
					fields: {}
				},
				noopEmit
			)
		).rejects.toThrow(/one entry or one cast member/i)
	})
})

describe("neither id is a capability", () => {
	test("another user's book cannot be listed", async () => {
		const { amendmentsListHandler } = await handlers()
		const owner = await makeUser("amend-owner-a")
		const other = await makeUser("amend-other-a")
		const book = await makeLorebook(owner.id, "Ashfall")
		await expect(
			amendmentsListHandler.handler(
				fakeSocket(other.id),
				{ lorebookId: book.id },
				noopEmit
			)
		).rejects.toThrow(/permission/i)
	})

	test("an entry in ANOTHER book cannot be amended through this one", async () => {
		const { amendmentsCreateHandler } = await handlers()
		const user = await makeUser("amend-crossbook")
		const mine = await makeLorebook(user.id, "Ashfall")
		const theirs = await makeLorebook(user.id, "Other")
		const entryElsewhere = await makeEntry(theirs.id)
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: mine.id,
					entryId: entryElsewhere.id,
					year: 2,
					fields: {}
				},
				noopEmit
			)
		).rejects.toThrow(/not in this lorebook/i)
	})

	test("a cast member of ANOTHER book cannot be amended through this one", async () => {
		const { amendmentsCreateHandler } = await handlers()
		const user = await makeUser("amend-crosscast")
		const mine = await makeLorebook(user.id, "Ashfall")
		const theirs = await makeLorebook(user.id, "Other")
		const elsewhere = await makeCastMember(theirs.id, "Verity")
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: mine.id,
					castId: elsewhere.id,
					year: 2,
					fields: {}
				},
				noopEmit
			)
		).rejects.toThrow(/not in this lorebook/i)
	})

	test("a branch from another book is refused", async () => {
		const { amendmentsCreateHandler } = await handlers()
		const user = await makeUser("amend-crossbranch")
		const mine = await makeLorebook(user.id, "Ashfall")
		const other = await makeLorebook(user.id, "Other")
		const entry = await makeEntry(mine.id)
		const [branch] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: other.id, name: "marrow-stays" })
			.returning()
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: mine.id,
					entryId: entry.id,
					branchId: branch.id,
					year: 2,
					fields: {}
				},
				noopEmit
			)
		).rejects.toThrow(/not a line of this book/i)
	})
})

describe("branches", () => {
	test("a branch amendment lists with its branch id and resolves on that line", async () => {
		const { amendmentsCreateHandler, amendmentsListHandler } =
			await handlers()
		const user = await makeUser("amend-branch")
		const book = await makeLorebook(user.id, "Ashfall")
		const entry = await makeEntry(book.id)
		const [branch] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book.id, name: "marrow-stays" })
			.returning()

		await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				entryId: entry.id,
				year: 3,
				fields: { content: "main" }
			},
			noopEmit
		)
		await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				entryId: entry.id,
				branchId: branch.id,
				year: 3,
				fields: { content: "on the branch" }
			},
			noopEmit
		)

		const list = await amendmentsListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id },
			noopEmit
		)
		const overlays = list.entries as unknown as Amendment[]
		expect(list.branches).toHaveLength(1)
		expect(
			entryAsOf({ content: "base" }, overlays, { branchId: null }).content
		).toBe("main")
		expect(
			entryAsOf({ content: "base" }, overlays, { branchId: branch.id })
				.content
		).toBe("on the branch")
	})

	test("`main` cannot be a branch row", async () => {
		const user = await makeUser("amend-mainrow")
		const book = await makeLorebook(user.id, "Ashfall")
		await expect(
			testDb
				.insert(schema.lorebookBranches)
				.values({ lorebookId: book.id, name: "Main" })
				.returning()
		).rejects.toThrow()
	})
})

describe("delete", () => {
	test("removing one leaves the rest and the entry alone", async () => {
		const {
			amendmentsCreateHandler,
			amendmentsListHandler,
			amendmentsDeleteHandler
		} = await handlers()
		const user = await makeUser("amend-delete")
		const book = await makeLorebook(user.id, "Ashfall")
		const entry = await makeEntry(book.id)

		for (const year of [2, 6])
			await amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					entryId: entry.id,
					year,
					fields: { content: `Y${year}` }
				},
				noopEmit
			)

		const before = await amendmentsListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id },
			noopEmit
		)
		const after = await amendmentsDeleteHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, id: before.entries[0].id, subject: "entry" },
			noopEmit
		)
		expect(after.entries).toHaveLength(1)

		const stillThere = await testDb.query.lorebookEntries.findFirst({
			where: (e: any, { eq }: any) => eq(e.id, entry.id)
		})
		expect(stillThere).toBeTruthy()
	})

	test("deleting the ENTRY takes its overlays with it", async () => {
		// The cascade that is the whole reason these are two tables rather than
		// one polymorphic one.
		const { amendmentsCreateHandler, amendmentsListHandler } =
			await handlers()
		const user = await makeUser("amend-cascade")
		const book = await makeLorebook(user.id, "Ashfall")
		const entry = await makeEntry(book.id)
		await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, entryId: entry.id, year: 2, fields: {} },
			noopEmit
		)

		const { eq } = await import("drizzle-orm")
		await testDb
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entry.id))

		const after = await amendmentsListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id },
			noopEmit
		)
		expect(after.entries).toHaveLength(0)
	})
})

describe("branches", () => {
	async function branchHandlers() {
		const m = await import("./amendments")
		return m
	}

	test("a fork is a row; main never is", async () => {
		const { amendmentsForkHandler } = await branchHandlers()
		const user = await makeUser("branch-fork")
		const book = await makeLorebook(user.id, "Ashfall")

		const after = await amendmentsForkHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				name: "marrow-stays",
				forkYear: 3,
				forkMonth: 11,
				forkDay: 12
			},
			noopEmit
		)
		expect(after.branches).toHaveLength(1)
		expect(after.branches[0]).toMatchObject({
			name: "marrow-stays",
			forkedFromBranchId: null,
			forkYear: 3,
			forkMonth: 11,
			forkDay: 12
		})
	})

	test("`main` is refused as a name, in words", async () => {
		const { amendmentsForkHandler } = await branchHandlers()
		const user = await makeUser("branch-main")
		const book = await makeLorebook(user.id, "Ashfall")
		await expect(
			amendmentsForkHandler.handler(
				fakeSocket(user.id),
				{ lorebookId: book.id, name: "Main" },
				noopEmit
			)
		).rejects.toThrow(/main is the line/)
	})

	test("two lines of one book cannot share a name", async () => {
		const { amendmentsForkHandler } = await branchHandlers()
		const user = await makeUser("branch-dupe")
		const book = await makeLorebook(user.id, "Ashfall")
		const params = { lorebookId: book.id, name: "marrow-stays" }
		await amendmentsForkHandler.handler(
			fakeSocket(user.id),
			params,
			noopEmit
		)
		await expect(
			amendmentsForkHandler.handler(fakeSocket(user.id), params, noopEmit)
		).rejects.toThrow(/already has a line/)
	})

	test("another user's book cannot be forked", async () => {
		const { amendmentsForkHandler } = await branchHandlers()
		const owner = await makeUser("branch-owner")
		const other = await makeUser("branch-other")
		const book = await makeLorebook(owner.id, "Ashfall")
		await expect(
			amendmentsForkHandler.handler(
				fakeSocket(other.id),
				{ lorebookId: book.id, name: "stolen" },
				noopEmit
			)
		).rejects.toThrow(/permission/)
	})

	test("an amendment can be filed on a line, and main does not read it", async () => {
		const { amendmentsForkHandler, amendmentsCreateHandler } =
			await branchHandlers()
		const user = await makeUser("branch-amend")
		const book = await makeLorebook(user.id, "Ashfall")
		const entry = await makeEntry(book.id, { content: "base" })
		const forked = await amendmentsForkHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, name: "marrow-stays" },
			noopEmit
		)
		const branchId = forked.branches[0].id

		const after = await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				entryId: entry.id,
				branchId,
				year: 4,
				fields: { content: "on the fork" }
			},
			noopEmit
		)
		const overlays = after.entries as unknown as Amendment[]
		expect(
			entryAsOf({ content: "base" }, overlays, { branchId }).content
		).toBe("on the fork")
		expect(
			entryAsOf({ content: "base" }, overlays, { branchId: null }).content
		).toBe("base")
	})

	test("deleting a line takes its amendments and its own entries, and leaves the shared ones", async () => {
		const {
			amendmentsForkHandler,
			amendmentsCreateHandler,
			amendmentsDeleteBranchHandler
		} = await branchHandlers()
		const user = await makeUser("branch-delete")
		const book = await makeLorebook(user.id, "Ashfall")
		const shared = await makeEntry(book.id, { content: "shared" })
		const forked = await amendmentsForkHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, name: "marrow-stays" },
			noopEmit
		)
		const branchId = forked.branches[0].id
		const onBranch = await makeEntry(book.id, {
			content: "written on the fork",
			branchId
		})
		await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				entryId: shared.id,
				branchId,
				year: 4,
				fields: { content: "x" }
			},
			noopEmit
		)

		const after = await amendmentsDeleteBranchHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, id: branchId },
			noopEmit
		)
		expect(after.branches).toHaveLength(0)
		expect(after.entries).toHaveLength(0)

		const { eq } = await import("drizzle-orm")
		const sharedStill = await testDb.query.lorebookEntries.findFirst({
			where: (e: any, { eq: q }: any) => q(e.id, shared.id)
		})
		expect(sharedStill).toBeTruthy()
		const branchEntryGone = await testDb.query.lorebookEntries.findFirst({
			where: (e: any, { eq: q }: any) => q(e.id, onBranch.id)
		})
		expect(branchEntryGone).toBeFalsy()
		void eq
	})

	test("a session played on a deleted line falls back to main", async () => {
		const { amendmentsForkHandler, amendmentsDeleteBranchHandler } =
			await branchHandlers()
		const user = await makeUser("branch-session")
		const book = await makeLorebook(user.id, "Ashfall")
		const forked = await amendmentsForkHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, name: "marrow-stays" },
			noopEmit
		)
		const branchId = forked.branches[0].id
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				name: "A run on the fork",
				isGroup: false,
				lorebookId: book.id,
				lorebookBranchId: branchId
			})
			.returning()

		await amendmentsDeleteBranchHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, id: branchId },
			noopEmit
		)

		const after = await testDb.query.sessions.findFirst({
			where: (s: any, { eq }: any) => eq(s.id, session.id)
		})
		// The session survives; it is simply no longer on a line.
		expect(after).toBeTruthy()
		expect(after!.lorebookBranchId).toBeNull()
	})

	test("renaming refuses a name the book already uses", async () => {
		const { amendmentsForkHandler, amendmentsRenameBranchHandler } =
			await branchHandlers()
		const user = await makeUser("branch-rename")
		const book = await makeLorebook(user.id, "Ashfall")
		await amendmentsForkHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, name: "one" },
			noopEmit
		)
		const two = await amendmentsForkHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, name: "two" },
			noopEmit
		)
		const id = two.branches.find((b) => b.name === "two")!.id
		await expect(
			amendmentsRenameBranchHandler.handler(
				fakeSocket(user.id),
				{ lorebookId: book.id, id, name: "one" },
				noopEmit
			)
		).rejects.toThrow(/already has a line/)

		const ok = await amendmentsRenameBranchHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, id, name: "three" },
			noopEmit
		)
		expect(ok.branches.map((b) => b.name).sort()).toEqual(["one", "three"])
	})

	test("a branch of another book is not a line of this one", async () => {
		const { amendmentsForkHandler, amendmentsCreateHandler } =
			await branchHandlers()
		const user = await makeUser("branch-cross")
		const mine = await makeLorebook(user.id, "Ashfall")
		const other = await makeLorebook(user.id, "Elsewhere")
		const entry = await makeEntry(mine.id)
		const forked = await amendmentsForkHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: other.id, name: "elsewhere-line" },
			noopEmit
		)
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: mine.id,
					entryId: entry.id,
					branchId: forked.branches[0].id,
					year: 2,
					fields: {}
				},
				noopEmit
			)
		).rejects.toThrow(/not a line of this book/)
	})
})
