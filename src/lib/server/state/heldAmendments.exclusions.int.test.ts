/**
 * 🚧 A held amendment is one session's own change (`base` set), never a line's.
 * Every reader that asks for amendments by entry id, or copies a book, leaves
 * it out: the pattern layers of an entry, the retraction of an entry a run
 * made, a book copy, the fork-history queries, and the lorebook's amendment
 * screen (edit and delete).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-held-exclusions-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
let n = 0

/** A user, a lorebook with one place, and a session on it with an own book. */
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	const user = await createTestUser(testDb, `held-exclusions-${suffix}`)
	await testDb
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` })
		.returning()
	const [place] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: "core:entry/location",
			typeVersion: 1,
			position: 0,
			title: "The Docks",
			content: "…"
		})
		.returning()
	const session = async () => {
		const [row] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, lorebookId: book!.id })
			.returning()
		const own = await insertOwnBook(db(), {
			sessionId: row!.id,
			userId: user.id,
			name: null,
			overlayOf: book!.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		return { id: row!.id, own: own.id }
	}
	const holder = await session()
	const held = async (entryId: number, extra: Record<string, unknown> = {}) =>
		(
			await testDb
				.insert(schema.entryAmendments)
				.values({
					lorebookId: holder.own,
					entryId,
					year: null,
					fields: { name: "Held name", keys: ["held"] },
					base: { name: { v: "The Docks" } },
					sourceMessageId: 5,
					...extra
				})
				.returning()
		)[0]!
	return { user, book: book!, place: place!, holder, session, held }
}

describe("a held amendment is never an amendment of the lorebook's line", () => {
	test("amendmentPatternLayers ignores a held row", async () => {
		const { amendmentPatternLayers } = await import(
			"$lib/server/utils/lorebookEntries"
		)
		const w = await world()
		const heldRow = await w.held(w.place.id)
		const [dated] = await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: w.book.id,
				entryId: w.place.id,
				year: 4,
				fields: { keys: ["dock"] }
			})
			.returning()
		const layers = await amendmentPatternLayers(db(), w.place.id)
		expect([...layers.keys()]).toEqual([dated!.id])
		expect(layers.has(heldRow.id)).toBe(false)
	})

	test("a made entry another session holds a change to is still taken back by its run's retraction", async () => {
		const w = await world()
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: w.holder.id, role: "assistant", content: "…" })
			.returning()
		await testDb
			.insert(schema.messages)
			.values({
				id: message!.id,
				sessionId: w.holder.id,
				role: "assistant"
			})
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const made: any = await (
			await createHost(db(), {
				sessionId: w.holder.id,
				userId: w.user.id,
				runId: "run-held"
			})
		).commit!(
			{
				name: "The Shaft",
				content: "Wet rock.",
				params: { entryType: "core:entry/location" }
			},
			{
				key: "file",
				definitionId: "core:outlet/create-lore-entry"
			} as any
		)
		// Another session holds a change to the entry the run made.
		const other = await w.session()
		const [heldRow] = await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: other.own,
				entryId: made.id,
				year: null,
				fields: { name: "The Held Shaft" },
				base: { name: { v: "The Shaft" } },
				sourceMessageId: 9
			})
			.returning()
		const { retractStateAnchoredTo } = await import(
			"$lib/server/state/write"
		)
		await retractStateAnchoredTo(db(), message!.id, "replaced")
		expect(
			await testDb
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, made.id))
		).toEqual([])
		// The entry's delete took its dependants with it, as it always did.
		expect(
			await testDb
				.select()
				.from(schema.entryAmendments)
				.where(eq(schema.entryAmendments.id, heldRow!.id))
		).toEqual([])
	})

	test("copying an own book carries no held row", async () => {
		const { copyLorebookTables } = await import(
			"$lib/server/lorebooks/tableRegistry"
		)
		const w = await world()
		await w.held(w.place.id)
		// And an artificial row whose entry IS in the book copied: still not carried.
		const [inside] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.holder.own,
				typeId: "core:entry/location",
				typeVersion: 1,
				position: 0,
				title: "Own place",
				content: "…"
			})
			.returning()
		await w.held(inside!.id)
		await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: w.holder.own,
				entryId: inside!.id,
				year: 3,
				fields: { name: "Dated" }
			})
		const [copy] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: "Copy" })
			.returning()
		await testDb.transaction(async (tx) => {
			await copyLorebookTables(
				tx as unknown as Db,
				w.holder.own,
				copy!.id
			)
		})
		const rows = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.lorebookId, copy!.id))
		expect(rows.map((r) => [r.year, r.base])).toEqual([[3, null]])
	})
})

describe("the fork-history queries ignore a held amendment", () => {
	/** A line that is deleted, a history entry on it, and two lines forked from it. */
	async function lines() {
		const w = await world()
		const line = async (
			name: string,
			from: number | null,
			forkYear: number | null
		) =>
			(
				await testDb
					.insert(schema.lorebookBranches)
					.values({
						lorebookId: w.book.id,
						name: `${name} ${n}`,
						forkedFromBranchId: from,
						forkYear
					})
					.returning()
			)[0]!
		const gone = await line("gone", null, 5)
		const first = await line("first", gone.id, 7)
		const [dating] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{
						lorebookId: w.book.id,
						content: "The founding.",
						year: 3,
						branchId: gone.id
					}
				])
			)
			.returning()
		const all = [gone, first].map((l) => ({
			id: l.id,
			forkedFromBranchId: l.forkedFromBranchId,
			forkYear: l.forkYear,
			forkMonth: l.forkMonth,
			forkDay: l.forkDay
		}))
		return { w, gone, first, dating: dating!, all }
	}
	const deleteLine = (x: Awaited<ReturnType<typeof lines>>) =>
		testDb.transaction(async (tx) => {
			const { keepHistoryForForks } = await import(
				"$lib/server/utils/forkHistory"
			)
			return keepHistoryForForks(
				tx as unknown as Db,
				x.w.book.id,
				x.gone.id,
				x.all
			)
		})

	test("pointedAt: a held row on the fork does not make the fork keep the deleted line's history entry; a dated amendment does", async () => {
		const held = await lines()
		await held.w.held(held.dating.id, { branchId: held.first.id })
		expect((await deleteLine(held)).moved.size).toBe(0)

		const dated = await lines()
		await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: dated.w.book.id,
				entryId: dated.dating.id,
				branchId: dated.first.id,
				year: 4,
				fields: { name: "Dated" }
			})
		expect((await deleteLine(dated)).moved.size).toBe(1)
	})

	test("pointOnto: a held row is not re-pointed at a fork's copy of the entry", async () => {
		const x = await lines()
		const second = (
			await testDb
				.insert(schema.lorebookBranches)
				.values({
					lorebookId: x.w.book.id,
					name: `second ${n}`,
					forkedFromBranchId: x.gone.id,
					forkYear: null
				})
				.returning()
		)[0]!
		const all = [
			...x.all,
			{
				id: second.id,
				forkedFromBranchId: x.gone.id,
				forkYear: null,
				forkMonth: null,
				forkDay: null
			}
		]
		// Both forks keep the entry by a dated amendment; the second gets a copy.
		for (const fork of [x.first, second])
			await testDb
				.insert(schema.entryAmendments)
				.values({
					lorebookId: x.w.book.id,
					entryId: x.dating.id,
					branchId: fork.id,
					year: 4,
					fields: { name: `On ${fork.id}` }
				})
		const heldRow = await x.w.held(x.dating.id, { branchId: second.id })
		await testDb.transaction(async (tx) => {
			const { keepHistoryForForks } = await import(
				"$lib/server/utils/forkHistory"
			)
			const kept = await keepHistoryForForks(
				tx as unknown as Db,
				x.w.book.id,
				x.gone.id,
				all
			)
			expect(kept.copied.length).toBe(1)
		})
		const [row] = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, heldRow.id))
		expect(row!.entryId).toBe(x.dating.id)
		const [dated] = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.branchId, second.id))
		expect(dated).toBeDefined()
	})

	test("linesUsing: a held row does not stop a history entry being re-dated past a fork's cut; a dated amendment does", async () => {
		const { assertRedateKeepsLines } = await import(
			"$lib/server/utils/forkHistory"
		)
		const redate = (x: Awaited<ReturnType<typeof lines>>) =>
			testDb.transaction(async (tx) =>
				assertRedateKeepsLines(tx as unknown as Db, x.dating.id, {
					year: 9,
					month: null,
					day: null
				})
			)
		const held = await lines()
		await held.w.held(held.dating.id, { branchId: held.first.id })
		await expect(redate(held)).resolves.toBeUndefined()

		const dated = await lines()
		await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: dated.w.book.id,
				entryId: dated.dating.id,
				branchId: dated.first.id,
				year: 4,
				fields: { name: "Dated" }
			})
		await expect(redate(dated)).rejects.toThrow(/cannot move past/)
	})
})

describe("the lorebook's amendment screen refuses a held row's id", () => {
	const asUser = (id: number) =>
		({
			user: { id, isAdmin: false },
			io: { to: () => ({ emit() {} }) }
		}) as any

	test("edit and delete answer as any id outside the book does", async () => {
		const { amendmentsUpdateHandler, amendmentsDeleteHandler } =
			await import("$lib/server/sockets/amendments")
		const w = await world()
		const heldRow = await w.held(w.place.id)
		await expect(
			amendmentsUpdateHandler.handler(
				asUser(w.user.id),
				{
					subject: "entry",
					lorebookId: w.holder.own,
					id: heldRow.id,
					year: 2
				} as any,
				() => {}
			)
		).rejects.toThrow("That amendment is not in this lorebook.")
		await expect(
			amendmentsDeleteHandler.handler(
				asUser(w.user.id),
				{
					subject: "entry",
					lorebookId: w.holder.own,
					id: heldRow.id
				} as any,
				() => {}
			)
		).rejects.toThrow("That amendment is not in this lorebook.")
		const [still] = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, heldRow.id))
		expect(still).toMatchObject({
			fields: { name: "Held name", keys: ["held"] },
			year: null
		})
	})
})
