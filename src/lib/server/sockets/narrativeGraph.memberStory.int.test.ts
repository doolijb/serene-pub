/**
 * A cast member's own dated story, across absorb, undo and delete.
 *
 * - **Absorb and undo.** Absorbing a member used to cascade-delete their cast
 *   amendments and presences and leave their attribute rows pointing at
 *   nothing — and undo put back a bare row. The absorb now snapshots all
 *   four into the merge log and undo restores them onto the recreated row.
 * - **Undo against a world that moved on.** A link the absorb deleted could
 *   name an entry deleted since; re-inserting it failed the whole undo.
 * - **Merge dedup.** Two versions of a link at different dates are two
 *   records, not a duplicate to collapse.
 * - **Delete asks about private lore** (owner ruling 4): the pre-check counts
 *   it, `privateLore: "delete"` removes it, `"keep"` leaves it unassigned.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	characterLoreValues,
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
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
		path.join(os.tmpdir(), "serene-pub-graph-member-story-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
const HP = "core:slot/hp@1"

let seq = 0
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `member-story-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Story Book ${seq}`, userId: user.id })
		.returning()
	let token = 0
	const member = async (name: string) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: lorebook.id,
					binding: `{{char:${++token}}}`,
					name
				})
				.returning()
		)[0]
	const place = async (name: string) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					worldLoreValues([
						{ lorebookId: lorebook.id, name, content: name, keys: "" }
					])
				)
				.returning()
		)[0]
	const history = async (year: number) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(historyValues([{ lorebookId: lorebook.id, year }]))
				.returning()
		)[0]
	return { user, lorebook, member, place, history }
}

async function latestLog(lorebookId: number) {
	const logs = await testDb
		.select()
		.from(schema.bindingMergeLogs)
		.where(eq(schema.bindingMergeLogs.lorebookId, lorebookId))
	return logs.at(-1)!
}

const memberAttributes = (ownerId: number) =>
	testDb
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.ownerKind, "cast_member"),
				eq(schema.attributeValues.ownerId, ownerId)
			)
		)

describe("absorb → undo keeps the absorbed member's dated story", () => {
	test("amendments, presences and attribute rows go with the absorb and come back with the undo", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		await testDb.insert(schema.castAmendments).values({
			lorebookBindingId: absorbed.id,
			lorebookId: b.lorebook.id,
			year: 20,
			fields: { name: "Old Kes" }
		})
		await testDb.insert(schema.castPresences).values({
			lorebookBindingId: absorbed.id,
			lorebookId: b.lorebook.id,
			personalPosition: 1,
			fromYear: 3
		})
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "cast_member",
			ownerId: absorbed.id,
			slotId: HP,
			value: { v: 7 },
			sessionId: null,
			updatedBy: "user"
		})

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(b.user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id },
			noopEmit
		)
		// Gone with the member — and nothing left pointing at a deleted row.
		expect(
			await testDb
				.select()
				.from(schema.castAmendments)
				.where(eq(schema.castAmendments.lorebookBindingId, absorbed.id))
		).toHaveLength(0)
		expect(await memberAttributes(absorbed.id)).toHaveLength(0)

		const log = await latestLog(b.lorebook.id)
		const undone = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(b.user.id),
			{ mergeLogId: log.id },
			noopEmit
		)
		const back = undone.restoredNode.id
		expect(undone.unrestoredStoryCount).toBe(0)

		const amendments = await testDb
			.select()
			.from(schema.castAmendments)
			.where(eq(schema.castAmendments.lorebookBindingId, back))
		expect(amendments.map((a) => [a.year, a.fields])).toEqual([
			[20, { name: "Old Kes" }]
		])
		const presences = await testDb
			.select()
			.from(schema.castPresences)
			.where(eq(schema.castPresences.lorebookBindingId, back))
		expect(presences.map((p) => [p.personalPosition, p.fromYear])).toEqual([
			[1, 3]
		])
		expect((await memberAttributes(back)).map((v) => v.value)).toEqual([
			{ v: 7 }
		])
	}, 60_000)

	test("undo still succeeds when an entry a deleted link named has gone since, and says so", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const b = await makeBook()
		const survivor = await b.member("Warden")
		const absorbed = await b.member("The warden")
		const shrine = await b.place("The Shrine")
		// Both keep the shrine — the absorb's rewrite makes them duplicates,
		// so one is deleted outright and snapshotted.
		await testDb.insert(schema.narrativeRelationships).values([
			{
				lorebookId: b.lorebook.id,
				fromNodeId: survivor.id,
				toEntryId: shrine.id,
				relationshipType: "keeps",
				description: "keeps the shrine at night"
			},
			{
				lorebookId: b.lorebook.id,
				fromNodeId: absorbed.id,
				toEntryId: shrine.id,
				relationshipType: "keeps",
				description: "keeps it"
			}
		])
		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(b.user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id },
			noopEmit
		)
		const log = await latestLog(b.lorebook.id)
		expect(log.deletedRelationships).toHaveLength(1)

		// The shrine goes; the snapshot still names it.
		await testDb
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, shrine.id))

		const undone = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(b.user.id),
			{ mergeLogId: log.id },
			noopEmit
		)
		expect(undone.restoredNode.name).toBe("The warden")
		expect(undone.unrestoredLinkCount).toBe(1)
	}, 60_000)

	test("two versions of a link at different dates are not collapsed by the absorb", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const b = await makeBook()
		const survivor = await b.member("Warden")
		const absorbed = await b.member("The warden")
		const shrine = await b.place("The Shrine")
		const y1 = await b.history(1)
		const y9 = await b.history(9)
		await testDb.insert(schema.narrativeRelationships).values([
			{
				lorebookId: b.lorebook.id,
				fromNodeId: survivor.id,
				toEntryId: shrine.id,
				relationshipType: "keeps",
				description: "keeps the shrine",
				historyEntryId: y1.id
			},
			{
				lorebookId: b.lorebook.id,
				fromNodeId: absorbed.id,
				toEntryId: shrine.id,
				relationshipType: "keeps",
				description: "keeps the ruin of the shrine",
				historyEntryId: y9.id
			}
		])

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(b.user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id },
			noopEmit
		)

		const rows = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, b.lorebook.id))
		expect(rows.map((r) => r.historyEntryId).sort()).toEqual(
			[y1.id, y9.id].sort()
		)
		expect(rows.every((r) => r.fromNodeId === survivor.id)).toBe(true)
	}, 60_000)
})

describe("narrativeGraph:deleteNode — their private lore (ruling 4)", () => {
	async function memberWithLore() {
		const b = await makeBook()
		const member = await b.member("Mira")
		const [shown, archived] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				characterLoreValues([
					{
						lorebookId: b.lorebook.id,
						lorebookBindingId: member.id,
						name: "Mira's secret",
						content: "She kept the key.",
						keys: ""
					},
					{
						lorebookId: b.lorebook.id,
						lorebookBindingId: member.id,
						name: "Mira's old secret",
						content: "She lost the key.",
						keys: ""
					}
				] as any)
			)
			.returning()
		await testDb
			.update(schema.lorebookEntries)
			.set({ archived: true })
			.where(eq(schema.lorebookEntries.id, archived.id))
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "cast_member",
			ownerId: member.id,
			slotId: HP,
			value: { v: 3 },
			sessionId: null,
			updatedBy: "user"
		})
		return { b, member, lore: [shown.id, archived.id] }
	}

	test("the pre-check counts it, archived apart", async () => {
		const { narrativeGraphCheckNodeMergeReferencesHandler } = await import(
			"./narrativeGraph"
		)
		const { b, member } = await memberWithLore()
		const res = await narrativeGraphCheckNodeMergeReferencesHandler.handler(
			fakeSocket(b.user.id),
			{ nodeId: member.id },
			noopEmit
		)
		expect(res.privateLoreCount).toBe(1)
		expect(res.archivedPrivateLoreCount).toBe(1)
	}, 60_000)

	test('"keep" leaves it in the book, unassigned', async () => {
		const { narrativeGraphDeleteNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { b, member, lore } = await memberWithLore()
		const res = await narrativeGraphDeleteNodeHandler.handler(
			fakeSocket(b.user.id),
			{ id: member.id, privateLore: "keep" },
			noopEmit
		)
		expect(res.deletedLoreCount).toBe(0)
		const rows = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(inArray(schema.lorebookEntries.id, lore))
		expect(rows).toHaveLength(2)
		expect(rows.every((r) => r.anchorBindingId === null)).toBe(true)
		expect(await memberAttributes(member.id)).toHaveLength(0)
	}, 60_000)

	test('"delete" removes every entry anchored to them, archived included', async () => {
		const { narrativeGraphDeleteNodeHandler } = await import(
			"./narrativeGraph"
		)
		const { b, member, lore } = await memberWithLore()
		const res = await narrativeGraphDeleteNodeHandler.handler(
			fakeSocket(b.user.id),
			{ id: member.id, privateLore: "delete" },
			noopEmit
		)
		expect(res.deletedLoreCount).toBe(2)
		expect(
			await testDb
				.select()
				.from(schema.lorebookEntries)
				.where(inArray(schema.lorebookEntries.id, lore))
		).toHaveLength(0)
	}, 60_000)
})

/**
 * Stat cleanup when a member goes (plan A6): their stat sheets go with their
 * stats, the absorb's saved copy keeps both, and an undo skips a stat whose
 * line has been deleted since instead of failing on it.
 */
describe("a member's stats and stat sheets", () => {
	let sheetSeq = 0
	async function sheetFor(userId: number, bindingId: number) {
		const sheetId = `test:sheet/member-story-${++sheetSeq}@1`
		await testDb
			.insert(schema.attributeSheets)
			.values({ id: sheetId, userId, props: {} })
		await testDb.insert(schema.ownerSheets).values({
			ownerKind: "cast_member",
			ownerId: bindingId,
			sheetId,
			position: 0
		})
		return sheetId
	}
	const memberSheets = (ownerId: number) =>
		testDb
			.select()
			.from(schema.ownerSheets)
			.where(
				and(
					eq(schema.ownerSheets.ownerKind, "cast_member"),
					eq(schema.ownerSheets.ownerId, ownerId)
				)
			)

	test("an absorb takes the absorbed member's sheets, and the undo gives them back", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		const sheetId = await sheetFor(b.user.id, absorbed.id)

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(b.user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id },
			noopEmit
		)
		expect(await memberSheets(absorbed.id)).toHaveLength(0)

		const undone = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(b.user.id),
			{ mergeLogId: (await latestLog(b.lorebook.id)).id },
			noopEmit
		)
		expect(undone.unrestoredStoryCount).toBe(0)
		expect(
			(await memberSheets(undone.restoredNode.id)).map((s) => s.sheetId)
		).toEqual([sheetId])
	}, 60_000)

	test("a sheet deleted since the absorb is left out of the undo, and counted", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		const sheetId = await sheetFor(b.user.id, absorbed.id)
		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(b.user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id },
			noopEmit
		)
		await testDb
			.delete(schema.attributeSheets)
			.where(eq(schema.attributeSheets.id, sheetId))

		const undone = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(b.user.id),
			{ mergeLogId: (await latestLog(b.lorebook.id)).id },
			noopEmit
		)
		expect(undone.restoredNode.name).toBe("Kes")
		expect(undone.unrestoredStoryCount).toBe(1)
		expect(await memberSheets(undone.restoredNode.id)).toHaveLength(0)
	}, 60_000)

	test("a stat recorded on a line deleted since the absorb is left out of the undo, and counted", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		const [line] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: b.lorebook.id, name: "What if" })
			.returning()
		await testDb.insert(schema.attributeValues).values([
			{
				ownerKind: "cast_member",
				ownerId: absorbed.id,
				slotId: HP,
				value: { v: 7 },
				sessionId: null,
				updatedBy: "user"
			},
			{
				ownerKind: "cast_member",
				ownerId: absorbed.id,
				slotId: HP,
				value: { v: 2 },
				sessionId: null,
				branchId: line.id,
				updatedBy: "user"
			}
		])
		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(b.user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id },
			noopEmit
		)
		await testDb
			.delete(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, line.id))

		const undone = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(b.user.id),
			{ mergeLogId: (await latestLog(b.lorebook.id)).id },
			noopEmit
		)
		expect(undone.unrestoredStoryCount).toBe(1)
		expect(
			(await memberAttributes(undone.restoredNode.id)).map((v) => v.value)
		).toEqual([{ v: 7 }])
	}, 60_000)

	test("deleting a member deletes their sheets", async () => {
		const { narrativeGraphDeleteNodeHandler } = await import(
			"./narrativeGraph"
		)
		const b = await makeBook()
		const member = await b.member("Mira")
		const other = await b.member("Oren")
		await sheetFor(b.user.id, member.id)
		const kept = await sheetFor(b.user.id, other.id)

		await narrativeGraphDeleteNodeHandler.handler(
			fakeSocket(b.user.id),
			{ id: member.id, privateLore: "keep" },
			noopEmit
		)
		expect(await memberSheets(member.id)).toHaveLength(0)
		expect((await memberSheets(other.id)).map((s) => s.sheetId)).toEqual([
			kept
		])
	}, 60_000)
})

describe("a member's pending changes", () => {
	/** A change to the member's stat, waiting in `sessionId`'s review, with `status`. */
	async function change(sessionId: number, bindingId: number, status = "pending") {
		const [row] = await testDb
			.insert(schema.stateProposals)
			.values({
				sessionId,
				kind: "value",
				payload: { owner: { kind: "cast_member", id: bindingId }, slotId: HP, value: 3 },
				status
			})
			.returning()
		return row!
	}
	const sessionOf = async (b: Awaited<ReturnType<typeof makeBook>>) =>
		(
			await testDb
				.insert(schema.sessions)
				.values({ userId: b.user.id, isGroup: false, lorebookId: b.lorebook.id })
				.returning()
		)[0]!
	const proposalsOf = (sessionId: number) =>
		testDb
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, sessionId))

	test("deleting a member drops the changes still waiting for them; decided ones stay on the record", async () => {
		const { narrativeGraphDeleteNodeHandler } = await import("./narrativeGraph")
		const b = await makeBook()
		const member = await b.member("Mira")
		const other = await b.member("Oren")
		const session = await sessionOf(b)
		await change(session.id, member.id)
		const decided = await change(session.id, member.id, "accepted")
		const othersChange = await change(session.id, other.id)

		await narrativeGraphDeleteNodeHandler.handler(
			fakeSocket(b.user.id),
			{ id: member.id, privateLore: "keep" },
			noopEmit
		)
		expect((await proposalsOf(session.id)).map((p) => p.id).sort((x, y) => x - y)).toEqual(
			[decided.id, othersChange.id].sort((x, y) => x - y)
		)
	}, 60_000)

	test("an absorb drops them, and the undo puts them back on the member it recreates", async () => {
		const { narrativeGraphMergeNodeHandler, narrativeGraphUndoMergeHandler } =
			await import("./narrativeGraph")
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		const session = await sessionOf(b)
		await change(session.id, absorbed.id)

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(b.user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id },
			noopEmit
		)
		expect(await proposalsOf(session.id)).toHaveLength(0)

		const undone = await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(b.user.id),
			{ mergeLogId: (await latestLog(b.lorebook.id)).id },
			noopEmit
		)
		expect(undone.unrestoredStoryCount).toBe(0)
		const back = await proposalsOf(session.id)
		expect(back.map((p) => ({ status: p.status, owner: (p.payload as any).owner }))).toEqual([
			{ status: "pending", owner: { kind: "cast_member", id: undone.restoredNode.id } }
		])
	}, 60_000)
})
