/**
 * The relationship writers A21 left outside the guard (plan lorebooks
 * consolidation, A21 leftovers).
 *
 * - **An end must be on the link's line.** `createRelationship` and
 *   `updateRelationship` checked only that an end was in the book, so a link
 *   drawn on main could reach an entry written on a fork (a room main does
 *   not have), and one drawn on a fork could reach a sibling fork's. The same
 *   holds for the date a link is filed at (its history entry).
 * - **Capped words.** The canvas's two writers stored a relationship type,
 *   name, description, reason and status of any length or value; the graph
 *   build's apply already capped the same columns.
 * - **The cast merge and its undo** moved and re-inserted relationships
 *   without `assertRelationshipWrite`, so a merge could leave the kept member
 *   linked to one entry twice the same way (B1's one row per way).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	entryInsert,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/**
 * A fault the next guard call throws instead of judging — how a test makes
 * the guard fail the way a bug would. Null is the real guard.
 */
const guardFault = vi.hoisted(() => ({ next: null as Error | null }))
vi.mock("$lib/server/utils/relationshipGuards", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("$lib/server/utils/relationshipGuards")
		>()
	return {
		...real,
		assertRelationshipWrite: async (
			...args: Parameters<typeof real.assertRelationshipWrite>
		) => {
			const fault = guardFault.next
			if (fault) {
				guardFault.next = null
				throw fault
			}
			return real.assertRelationshipWrite(...args)
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-graph-rel-writes-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

let seq = 0
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `graph-rel-writes-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Writes ${seq}`, userId: user.id, nextBindingNumber: 50 })
		.returning()
	let tagN = 0
	const member = async (name: string) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: lorebook!.id,
					binding: `{{char:${++tagN}}}`,
					name
				})
				.returning()
		)[0]!
	let position = 0
	const place = async (name: string, branchId: number | null = null) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					...entryInsert({
						typeId: WORLD_LORE_TYPE_ID,
						lorebookId: lorebook!.id,
						name,
						content: name,
						position: position++
					}),
					branchId
				})
				.returning()
		)[0]!
	const dated = async (year: number, branchId: number | null = null) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					...entryInsert({
						typeId: HISTORY_TYPE_ID,
						lorebookId: lorebook!.id,
						content: `Year ${year}`,
						year,
						position: position++
					} as any),
					branchId
				})
				.returning()
		)[0]!
	const fork = async (name: string, forkedFromBranchId: number | null = null) =>
		(
			await testDb
				.insert(schema.lorebookBranches)
				.values({ lorebookId: lorebook!.id, name, forkedFromBranchId })
				.returning()
		)[0]!
	return { user, lorebook: lorebook!, member, place, dated, fork }
}
type Book = Awaited<ReturnType<typeof makeBook>>

const handlers = () => import("./narrativeGraph")

type End =
	| { kind: "cast"; bindingId: number }
	| { kind: "entry"; entryId: number }
const entryEnd = (entryId: number): End => ({ kind: "entry", entryId })
const castEnd = (bindingId: number): End => ({ kind: "cast", bindingId })

async function draw(
	b: Book,
	from: End,
	to: End,
	extra: Record<string, unknown> = {}
) {
	const { narrativeGraphCreateRelationshipHandler } = await handlers()
	return narrativeGraphCreateRelationshipHandler.handler(
		fakeSocket(b.user.id),
		{
			lorebookId: b.lorebook.id,
			from,
			to,
			relationshipType: "leads to",
			status: "active",
			...extra
		} as any,
		noopEmit
	)
}

async function edit(
	b: Book,
	relationship: Record<string, unknown>,
	branchId?: number | null
) {
	const { narrativeGraphUpdateRelationshipHandler } = await handlers()
	return narrativeGraphUpdateRelationshipHandler.handler(
		fakeSocket(b.user.id),
		{ relationship, ...(branchId !== undefined ? { branchId } : {}) } as any,
		noopEmit
	)
}

async function merge(b: Book, absorbedId: number, survivorId: number) {
	const { narrativeGraphMergeNodeHandler } = await handlers()
	return narrativeGraphMergeNodeHandler.handler(
		fakeSocket(b.user.id),
		{ nodeId: absorbedId, parentNodeId: survivorId },
		noopEmit
	)
}

async function undoLastMerge(b: Book) {
	const { narrativeGraphUndoMergeHandler } = await handlers()
	const [log] = await testDb
		.select({ id: schema.bindingMergeLogs.id })
		.from(schema.bindingMergeLogs)
		.where(eq(schema.bindingMergeLogs.lorebookId, b.lorebook.id))
	return narrativeGraphUndoMergeHandler.handler(
		fakeSocket(b.user.id),
		{ mergeLogId: log!.id },
		noopEmit
	)
}

const rowsOf = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, lorebookId))
		.orderBy(schema.narrativeRelationships.id)

/** A relationship stored straight, past every writer — data as it may stand. */
async function stored(b: Book, values: Record<string, unknown>) {
	return (
		await testDb
			.insert(schema.narrativeRelationships)
			.values({ lorebookId: b.lorebook.id, ...values } as any)
			.returning()
	)[0]!
}

describe("an end must be on the link's line", () => {
	test("a link on main cannot reach a fork's own entry", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const fork = await b.fork("What if")
		const annex = await b.place("The Annex", fork.id)
		await expect(
			draw(b, entryEnd(hall.id), entryEnd(annex.id))
		).rejects.toThrow(
			"The second end of this link was written on another line of this lorebook, so this line does not have it."
		)
		expect(await rowsOf(b.lorebook.id)).toEqual([])
	})

	test("a link on a fork cannot reach a sibling fork's entry, and reaches its own, main's and a parent fork's", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const parent = await b.fork("Parent")
		const child = await b.fork("Child", parent.id)
		const sibling = await b.fork("Sibling")
		const attic = await b.place("The Attic", parent.id)
		const cellar = await b.place("The Cellar", child.id)
		const vault = await b.place("The Vault", sibling.id)
		const mary = await b.member("Mary")

		await expect(
			draw(b, entryEnd(vault.id), entryEnd(cellar.id), {
				branchId: child.id
			})
		).rejects.toThrow(/first end of this link was written on another line/)
		await expect(
			draw(b, castEnd(mary.id), entryEnd(vault.id), {
				branchId: child.id
			})
		).rejects.toThrow(/second end of this link was written on another line/)

		await draw(b, entryEnd(hall.id), entryEnd(cellar.id), {
			branchId: child.id
		})
		await draw(b, entryEnd(attic.id), entryEnd(cellar.id), {
			branchId: child.id
		})
		expect(await rowsOf(b.lorebook.id)).toHaveLength(2)
	})

	test("an update cannot move an end onto another line's entry", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		const fork = await b.fork("What if")
		const annex = await b.place("The Annex", fork.id)
		const { relationship } = await draw(
			b,
			entryEnd(hall.id),
			entryEnd(cellar.id)
		)
		await expect(
			edit(b, { id: relationship.id, to: entryEnd(annex.id) })
		).rejects.toThrow(/second end of this link was written on another line/)
		const [row] = await rowsOf(b.lorebook.id)
		expect(row!.toEntryId).toBe(cellar.id)
	})

	test("its date must be on the line too", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		const fork = await b.fork("What if")
		const forkYear = await b.dated(12, fork.id)
		const mainYear = await b.dated(3)
		await expect(
			draw(b, entryEnd(hall.id), entryEnd(cellar.id), {
				historyEntryId: forkYear.id
			})
		).rejects.toThrow(
			"That date was written on another line of this lorebook, so this line does not have it."
		)
		const { relationship } = await draw(
			b,
			entryEnd(hall.id),
			entryEnd(cellar.id),
			{ historyEntryId: mainYear.id }
		)
		await expect(
			edit(b, { id: relationship.id, historyEntryId: forkYear.id })
		).rejects.toThrow(/That date was written on another line/)
		// A fork reads main's dates.
		await draw(b, entryEnd(cellar.id), entryEnd(hall.id), {
			branchId: fork.id,
			historyEntryId: mainYear.id
		})
	})

	test("a fork does not have the dates of the line it left from after it forked (plan A8)", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: b.lorebook.id, name: "At Year 5", forkYear: 5 })
			.returning()
		const before = await b.dated(4)
		const after = await b.dated(6)
		await expect(
			draw(b, entryEnd(hall.id), entryEnd(cellar.id), {
				branchId: fork!.id,
				historyEntryId: after.id
			})
		).rejects.toThrow(/later than where this line forked/)
		const { relationship } = await draw(
			b,
			entryEnd(hall.id),
			entryEnd(cellar.id),
			{ branchId: fork!.id, historyEntryId: before.id }
		)
		await expect(
			edit(b, { id: relationship.id, historyEntryId: after.id })
		).rejects.toThrow(/later than where this line forked/)
	})

	test("its scene must be on the line too", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		const fork = await b.fork("What if")
		const year = await b.dated(3)
		const scene = async (name: string, branchId: number | null) =>
			(
				await testDb
					.insert(schema.scenes)
					.values({
						lorebookId: b.lorebook.id,
						historyEntryId: year.id,
						name,
						branchId
					})
					.returning()
			)[0]!
		const forkScene = await scene("On the fork", fork.id)
		const mainScene = await scene("On main", null)
		const { relationship } = await draw(
			b,
			entryEnd(hall.id),
			entryEnd(cellar.id)
		)
		await expect(
			edit(b, { id: relationship.id, sceneId: forkScene.id })
		).rejects.toThrow(
			"That scene was captured on another line of this lorebook, so this line does not have it."
		)
		expect((await rowsOf(b.lorebook.id))[0]!.sceneId).toBeNull()
		await edit(b, { id: relationship.id, sceneId: mainScene.id })
		expect((await rowsOf(b.lorebook.id))[0]!.sceneId).toBe(mainScene.id)
	})
})

describe("a link's scene is a date on its line", () => {
	test("a fork does not have a scene the line it left captured after the fork (plan A8)", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: b.lorebook.id, name: "At Year 5", forkYear: 5 })
			.returning()
		const scene = async (name: string, year: number) =>
			(
				await testDb
					.insert(schema.scenes)
					.values({
						lorebookId: b.lorebook.id,
						historyEntryId: (await b.dated(year)).id,
						name,
						branchId: null
					})
					.returning()
			)[0]!
		const before = await scene("Before the fork", 4)
		const after = await scene("After the fork", 6)
		const { relationship } = await draw(b, entryEnd(hall.id), entryEnd(cellar.id), {
			branchId: fork!.id
		})
		await expect(
			edit(b, { id: relationship.id, sceneId: after.id }, fork!.id)
		).rejects.toThrow(
			"That scene is later than where this line forked, so this line does not have it."
		)
		expect((await rowsOf(b.lorebook.id))[0]!.sceneId).toBeNull()
		await edit(b, { id: relationship.id, sceneId: before.id }, fork!.id)
		expect((await rowsOf(b.lorebook.id))[0]!.sceneId).toBe(before.id)
	})
})

describe("a relationship's visibility is one it can have", () => {
	test("create and update refuse a visibility outside the list", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		await expect(
			draw(b, entryEnd(hall.id), entryEnd(cellar.id), {
				visibility: "everyone-and-their-dog"
			})
		).rejects.toThrow(
			'"everyone-and-their-dog" is not a visibility a relationship can have. Choose secret, acknowledged or public.'
		)
		expect(await rowsOf(b.lorebook.id)).toEqual([])

		const { relationship } = await draw(
			b,
			entryEnd(hall.id),
			entryEnd(cellar.id),
			{ visibility: "secret" }
		)
		await expect(
			edit(b, { id: relationship.id, visibility: "everyone" })
		).rejects.toThrow(/"everyone" is not a visibility/)
		expect((await rowsOf(b.lorebook.id))[0]!.visibility).toBe("secret")
	})
})

describe("a relationship's words are capped", () => {
	test("create refuses an over-long type, way back, name, description or reason, and an unknown status", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		const ends = [entryEnd(hall.id), entryEnd(cellar.id)] as const
		await expect(
			draw(b, ...ends, { relationshipType: "x".repeat(101) })
		).rejects.toThrow(
			"A relationship's wording can be at most 100 characters each way."
		)
		await expect(
			draw(b, ...ends, { reverseRelationshipType: "x".repeat(101) })
		).rejects.toThrow(/at most 100 characters each way/)
		await expect(
			draw(b, ...ends, { name: "x".repeat(201) })
		).rejects.toThrow("A relationship's name can be at most 200 characters.")
		await expect(
			draw(b, ...ends, { description: "x".repeat(2001) })
		).rejects.toThrow(
			"A relationship's description can be at most 2000 characters."
		)
		await expect(draw(b, ...ends, { status: "ended" })).rejects.toThrow(
			'"ended" is not a status a relationship can have. Choose active, resolved, broken or evolved.'
		)
		expect(await rowsOf(b.lorebook.id)).toEqual([])

		// At the ceiling is fine.
		await draw(b, ...ends, {
			relationshipType: "x".repeat(100),
			name: "n".repeat(200),
			description: "d".repeat(2000)
		})
		expect(await rowsOf(b.lorebook.id)).toHaveLength(1)
	})

	test("update refuses the same, and only judges what it changes", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		const { relationship } = await draw(
			b,
			entryEnd(hall.id),
			entryEnd(cellar.id)
		)
		await expect(
			edit(b, { id: relationship.id, relationshipType: "x".repeat(101) })
		).rejects.toThrow(/at most 100 characters each way/)
		await expect(
			edit(b, { id: relationship.id, name: "x".repeat(201) })
		).rejects.toThrow(/name can be at most 200/)
		await expect(
			edit(b, { id: relationship.id, reason: "x".repeat(2001) })
		).rejects.toThrow("The reason can be at most 2000 characters.")
		await expect(
			edit(b, { id: relationship.id, status: "vanished" })
		).rejects.toThrow(/"vanished" is not a status/)

		// A row stored before the caps, resent whole with one field changed,
		// saves: what it does not change is not judged again.
		const old = await stored(b, {
			fromEntryId: cellar.id,
			toEntryId: hall.id,
			relationshipType: "climbs to",
			status: "ended",
			description: "x".repeat(3000)
		})
		const { relationship: saved } = await edit(b, {
			id: old.id,
			status: "ended",
			description: "x".repeat(3000),
			name: "The stair"
		})
		expect(saved.name).toBe("The stair")
	})
})

describe("the cast merge goes through the guard", () => {
	test("a link the kept member already has, worded in another case, is folded rather than doubled", async () => {
		const b = await makeBook()
		const vell = await b.member("Vell")
		const v = await b.member("V.")
		const shrine = await b.place("The Shrine")
		await draw(b, castEnd(vell.id), entryEnd(shrine.id), {
			relationshipType: "keeper of"
		})
		await draw(b, castEnd(v.id), entryEnd(shrine.id), {
			relationshipType: "Keeper of",
			description: "Since the flood."
		})

		await merge(b, v.id, vell.id)

		const rows = await rowsOf(b.lorebook.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.fromNodeId).toBe(vell.id)
		expect(rows[0]!.description).toBe("Since the flood.")

		// And the undo puts both back.
		const res = await undoLastMerge(b)
		expect(res.unrestoredLinkCount).toBe(0)
		const back = await rowsOf(b.lorebook.id)
		expect(back.map((r) => r.fromNodeId).sort()).toEqual(
			[vell.id, res.restoredNode.id].sort()
		)
	})

	test("two links the absorbed member holds twice fold into one", async () => {
		const b = await makeBook()
		const vell = await b.member("Vell")
		const v = await b.member("V.")
		const shrine = await b.place("The Shrine")
		// Twins stored before one row per way was a rule.
		await stored(b, {
			fromNodeId: v.id,
			toEntryId: shrine.id,
			relationshipType: "keeper of"
		})
		await stored(b, {
			fromNodeId: v.id,
			toEntryId: shrine.id,
			relationshipType: "keeper of",
			description: "Longer."
		})

		await merge(b, v.id, vell.id)

		const rows = await rowsOf(b.lorebook.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.fromNodeId).toBe(vell.id)
		expect(rows[0]!.description).toBe("Longer.")
	})

	test("a merge that would link the kept member to an entry twice in part is refused in words", async () => {
		const b = await makeBook()
		const vell = await b.member("Vell")
		const v = await b.member("V.")
		const shrine = await b.place("The Shrine")
		// The same words read from the same end, one of them two-way: not the
		// same link, and not one a merge may fold.
		await draw(b, castEnd(vell.id), entryEnd(shrine.id), {
			relationshipType: "keeper of"
		})
		await draw(b, castEnd(v.id), entryEnd(shrine.id), {
			relationshipType: "keeper of",
			reverseRelationshipType: "kept by"
		})

		await expect(merge(b, v.id, vell.id)).rejects.toThrow(
			'Vell would be linked to "The Shrine" twice the same way. Change or delete one of those links, then merge again.'
		)
		const members = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, b.lorebook.id))
		expect(members).toHaveLength(2)
		expect(await rowsOf(b.lorebook.id)).toHaveLength(2)
	})

	test("a link and its mirror — the same link drawn from the far end — fold into one", async () => {
		const b = await makeBook()
		const vell = await b.member("Vell")
		const v = await b.member("V.")
		const shrine = await b.place("The Shrine")
		await draw(b, castEnd(vell.id), entryEnd(shrine.id), {
			relationshipType: "keeper of",
			reverseRelationshipType: "kept by"
		})
		await draw(b, entryEnd(shrine.id), castEnd(v.id), {
			relationshipType: "Kept by",
			reverseRelationshipType: "keeper of",
			description: "Since the flood."
		})

		await merge(b, v.id, vell.id)

		// The more complete one stands, drawn as it was.
		const rows = await rowsOf(b.lorebook.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.fromEntryId).toBe(shrine.id)
		expect(rows[0]!.toNodeId).toBe(vell.id)
		expect(rows[0]!.description).toBe("Since the flood.")

		const res = await undoLastMerge(b)
		expect(res.unrestoredLinkCount).toBe(0)
		expect(await rowsOf(b.lorebook.id)).toHaveLength(2)
	})

	test("twins that stand differently are not folded: an entry link asks the person, a cast tie keeps both", async () => {
		const b = await makeBook()
		const vell = await b.member("Vell")
		const v = await b.member("V.")
		const maren = await b.member("Maren")
		const shrine = await b.place("The Shrine")
		// A cast tie in each status: two versions, and a merge keeps both.
		await draw(b, castEnd(vell.id), castEnd(maren.id), {
			relationshipType: "ally"
		})
		await draw(b, castEnd(v.id), castEnd(maren.id), {
			relationshipType: "Ally",
			status: "broken",
			description: "Until the siege."
		})
		// The same words to one entry, one of them secret.
		await draw(b, castEnd(vell.id), entryEnd(shrine.id), {
			relationshipType: "keeper of"
		})
		await draw(b, castEnd(v.id), entryEnd(shrine.id), {
			relationshipType: "keeper of",
			visibility: "secret",
			description: "Nobody knows."
		})

		await expect(merge(b, v.id, vell.id)).rejects.toThrow(
			'Vell would be linked to "The Shrine" twice the same way. Change or delete one of those links, then merge again.'
		)
		expect(await rowsOf(b.lorebook.id)).toHaveLength(4)

		// With the entry link settled, the ties both stay, each as it stood.
		const [secret] = (await rowsOf(b.lorebook.id)).filter(
			(r) => r.visibility === "secret"
		)
		await testDb
			.delete(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, secret!.id))
		await merge(b, v.id, vell.id)
		const ties = (await rowsOf(b.lorebook.id)).filter(
			(r) => r.toNodeId === maren.id
		)
		expect(ties.map((r) => [r.fromNodeId, r.status]).sort()).toEqual(
			[
				[vell.id, "active"],
				[vell.id, "broken"]
			].sort()
		)
	})
})

describe("the undo goes through the guard", () => {
	test("a deleted link that would come back as a twin of one drawn since is left out and counted", async () => {
		const b = await makeBook()
		const vell = await b.member("Vell")
		const v = await b.member("V.")
		const shrine = await b.place("The Shrine")
		// The merge deletes the kept member's shorter twin.
		await draw(b, castEnd(vell.id), entryEnd(shrine.id), {
			relationshipType: "keeper of"
		})
		await draw(b, castEnd(v.id), entryEnd(shrine.id), {
			relationshipType: "keeper of",
			description: "Since the flood."
		})
		await merge(b, v.id, vell.id)
		const [moved] = await rowsOf(b.lorebook.id)
		// Since the merge the moved link was reworded, and a link was drawn
		// from the shrine back to Vell whose way back says what the deleted
		// twin said: the mirror of the row the undo would bring back.
		await edit(b, { id: moved!.id, relationshipType: "guards" })
		await draw(b, entryEnd(shrine.id), castEnd(vell.id), {
			relationshipType: "shelters",
			reverseRelationshipType: "keeper of"
		})

		const res = await undoLastMerge(b)

		expect(res.unrestoredLinkCount).toBe(1)
		expect(res.unrestoredMovedLinkCount).toBe(0)
		const rows = await rowsOf(b.lorebook.id)
		expect(
			rows.filter(
				(r) =>
					r.fromNodeId === vell.id &&
					r.toEntryId === shrine.id &&
					r.relationshipType === "keeper of"
			)
		).toEqual([])
	})

	test("a moved link the guard refuses to move back stays with the kept member, and is counted as such", async () => {
		const b = await makeBook()
		const vell = await b.member("Vell")
		const v = await b.member("V.")
		const shrine = await b.place("The Shrine")
		const hall = await b.place("The Hall")
		await draw(b, castEnd(v.id), entryEnd(shrine.id), {
			relationshipType: "guards"
		})
		const { relationship: second } = await draw(
			b,
			castEnd(v.id),
			entryEnd(hall.id),
			{ relationshipType: "guards" }
		)
		await merge(b, v.id, vell.id)
		// Since the merge the second link came to say part of what the first
		// says — stored straight, past the writers, as data may stand.
		await testDb
			.update(schema.narrativeRelationships)
			.set({ toEntryId: shrine.id, reverseRelationshipType: "guarded by" })
			.where(eq(schema.narrativeRelationships.id, second.id))

		const res = await undoLastMerge(b)

		expect(res.unrestoredLinkCount).toBe(1)
		expect(res.unrestoredMovedLinkCount).toBe(1)
		// One of the two went back; the other is still the kept member's.
		const ends = (await rowsOf(b.lorebook.id)).map((r) => r.fromNodeId)
		expect(ends.sort()).toEqual([vell.id, res.restoredNode.id].sort())
	})

	test("a guard that fails the way a bug does fails the undo, never counted as a refusal", async () => {
		const b = await makeBook()
		const vell = await b.member("Vell")
		const v = await b.member("V.")
		const shrine = await b.place("The Shrine")
		await draw(b, castEnd(v.id), entryEnd(shrine.id), {
			relationshipType: "guards"
		})
		await merge(b, v.id, vell.id)

		guardFault.next = new TypeError(
			"Cannot read properties of undefined (reading 'id')"
		)
		await expect(undoLastMerge(b)).rejects.toThrow(TypeError)
		guardFault.next = null

		// Nothing of it happened: the merge still stands, and can be undone.
		const [row] = await rowsOf(b.lorebook.id)
		expect(row!.fromNodeId).toBe(vell.id)
		const res = await undoLastMerge(b)
		expect(res.unrestoredLinkCount).toBe(0)
	})
})
