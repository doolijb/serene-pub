/**
 * Move down the tree: entries move from their line to a line it was forked
 * from, for good. Only the entry's `branch_id` changes; the refusals are said
 * in words; the move is one transaction.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import {
	amendmentsOnLine,
	lineOf,
	rowsReadingOnLine
} from "$lib/shared/lorebooks/lineReading"
import { historyEntryDate } from "$lib/server/state/reading"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const broadcasts: { sessionId: number; event: string; data: any }[] = []
vi.mock(
	"$lib/server/sockets/utils/broadcastHelpers",
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		broadcastToSessionUsers: async (
			_io: any,
			sessionId: number,
			event: string,
			data: any
		) => {
			broadcasts.push({ sessionId, event, data })
		}
	})
)

let testDb: TestDb
let dataDir: string
let seq = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-amendments-move-down-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socketOf = (userId: number) =>
	({
		user: { id: userId },
		io: { sockets: { adapter: { rooms: { get: () => undefined } } } }
	}) as any

/** main <- A (Year 3) <- B (Year 5) <- D (Year 10); C forked from A at Year 2. */
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `move-down-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${seq}`, userId: user.id })
		.returning()
	const line = async (name: string, from: number | null, year: number) =>
		(
			await testDb
				.insert(schema.lorebookBranches)
				.values({
					lorebookId: book!.id,
					name,
					forkedFromBranchId: from,
					forkYear: year
				} as any)
				.returning()
		)[0]!.id
	const A = await line("A", null, 3)
	const B = await line("B", A, 5)
	const D = await line("D", B, 10)
	const C = await line("C", A, 2)
	let pos = 0
	const entry = async (
		title: string | null,
		branchId: number | null,
		extra: {
			typeId?: string
			fields?: Record<string, unknown>
			anchorEntryId?: number | null
		} = {}
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId: extra.typeId ?? WORLD_LORE_TYPE_ID,
					typeVersion: 1,
					title,
					content: "Text.",
					keys: [],
					position: ++pos,
					fields: extra.fields ?? {},
					branchId,
					anchorEntryId: extra.anchorEntryId ?? null
				} as any)
				.returning()
		)[0]!
	const m = await import("./amendments")
	const emit = vi.fn()
	const move = (
		entryIds: number[],
		branchId: number | null,
		asker = user.id
	) =>
		m.amendmentsMoveDownTheTreeHandler.handler(
			socketOf(asker),
			{ lorebookId: book!.id, entryIds, branchId } as any,
			emit
		)
	const refused = async (p: Promise<unknown>, sentence: string) => {
		await expect(p).rejects.toThrow(sentence)
		const errors = emit.mock.calls.filter(
			(c) => c[0] === "amendments:moveDownTheTree:error"
		)
		expect(errors.at(-1)![1].error).toBe(sentence)
	}
	const branchOf = async (id: number) =>
		(
			await testDb
				.select({ branchId: schema.lorebookEntries.branchId })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, id))
		)[0]!.branchId
	return {
		user,
		book: book!,
		A,
		B,
		C,
		D,
		entry,
		move,
		refused,
		branchOf,
		emit,
		m
	}
}

async function readsBy(bookId: number, lines: (number | null)[]) {
	const branches = await testDb
		.select()
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, bookId))
	const rows = await testDb
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, bookId))
	return new Map(
		lines.map((l) => [
			l,
			new Set(
				rowsReadingOnLine(rows, lineOf(l, branches), (r) =>
					historyEntryDate(r.fields)
				).map((r) => r.id)
			)
		])
	)
}

describe("the move", () => {
	test("a perpetual entry moves one line down, or to main", async () => {
		const w = await world()
		const onB = await w.entry("Perpetual B", w.B)
		const onD = await w.entry("Perpetual D", w.D)
		const res = await w.move([onB.id], w.A)
		expect(res).toEqual({
			lorebookId: w.book.id,
			branchId: w.A,
			entryIds: [onB.id]
		})
		expect(await w.branchOf(onB.id)).toBe(w.A)
		expect(
			w.emit.mock.calls.some((c) => c[0] === "amendments:moveDownTheTree")
		).toBe(true)
		await w.move([onD.id], null)
		expect(await w.branchOf(onD.id)).toBeNull()
	})

	test("a Beginning moves as far down as its date reaches", async () => {
		const w = await world()
		const e = await w.entry("Gate", w.D, { fields: { year: 7 } })
		await w.refused(
			w.move([e.id], w.A),
			"Gate began at Year 7; B left A at Year 5."
		)
		expect(await w.branchOf(e.id)).toBe(w.D)
		await w.move([e.id], w.B)
		expect(await w.branchOf(e.id)).toBe(w.B)
	})

	test("a child moves only with its parent and everything filed under it", async () => {
		const w = await world()
		const parent = await w.entry("Parent", w.B)
		const kid = await w.entry("Kid", w.B, { anchorEntryId: parent.id })
		const sibling = await w.entry("Sibling", w.B, {
			anchorEntryId: parent.id
		})
		await w.refused(
			w.move([kid.id], w.A),
			"Kid is filed under Parent: move Parent with it."
		)
		await w.refused(
			w.move([kid.id, parent.id], w.A),
			"Sibling is filed under Parent: move it with Parent."
		)
		await w.move([kid.id, parent.id, sibling.id], w.A)
		for (const e of [parent, kid, sibling])
			expect(await w.branchOf(e.id)).toBe(w.A)
	})

	test("its dated changes and links stay on the line they were written on", async () => {
		const w = await world()
		const e = await w.entry("Verity", w.B)
		const other = await w.entry("Other", w.B)
		const [amendment] = await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: w.book.id,
				entryId: e.id,
				branchId: w.B,
				year: 6,
				fields: { content: "Later." }
			} as any)
			.returning()
		const [link] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: w.book.id,
				fromEntryId: e.id,
				toEntryId: other.id,
				branchId: w.B,
				relationshipType: "road",
				title: "the road"
			} as any)
			.returning()
		await w.move([e.id], w.A)
		const [amendmentAfter] = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, amendment!.id))
		const [linkAfter] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, link!.id))
		expect(amendmentAfter!.branchId).toBe(w.B)
		expect(linkAfter!.branchId).toBe(w.B)
		const branches = await testDb
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.lorebookId, w.book.id))
		const stored = await testDb.select().from(schema.entryAmendments)
		const mine = stored.filter((a) => a.id === amendment!.id)
		expect(
			amendmentsOnLine(mine as any, lineOf(w.B, branches))
		).toHaveLength(1)
		expect(
			amendmentsOnLine(mine as any, lineOf(w.A, branches))
		).toHaveLength(0)
		const redlines = await testDb
			.select()
			.from(schema.loreRedlines)
			.where(eq(schema.loreRedlines.entryId, e.id))
		expect(redlines).toHaveLength(0)
	})

	test("every line reads as before except for the moved entry", async () => {
		const w = await world()
		const e = await w.entry("Verity", w.B)
		await w.entry("Stays", w.B)
		await w.entry("Main", null)
		await w.entry("Dated", w.D, { fields: { year: 8 } })
		const all = [null, w.A, w.B, w.C, w.D]
		const before = await readsBy(w.book.id, all)
		await w.move([e.id], w.A)
		const after = await readsBy(w.book.id, all)
		for (const l of all) {
			const added = [...after.get(l)!].filter(
				(id) => !before.get(l)!.has(id)
			)
			const lost = [...before.get(l)!].filter(
				(id) => !after.get(l)!.has(id)
			)
			expect(lost, `lost on ${l}`).toEqual([])
			expect(added, `added on ${l}`).toEqual(
				l === w.A || l === w.C ? [e.id] : []
			)
		}
	})

	test("a second boot changes nothing", async () => {
		const w = await world()
		const e = await w.entry("Verity", w.B)
		const [amendment] = await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: w.book.id,
				entryId: e.id,
				branchId: w.B,
				year: 6,
				fields: { content: "Later." }
			} as any)
			.returning()
		await w.move([e.id], w.A)
		const { runMigrationsWithUpgrades } = await import(
			"$lib/server/db/dataUpgrades"
		)
		await runMigrationsWithUpgrades(testDb as any, {
			migrationsFolder: path.resolve(process.cwd(), "drizzle")
		})
		expect(await w.branchOf(e.id)).toBe(w.A)
		const [amendmentAfter] = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, amendment!.id))
		expect(amendmentAfter!.branchId).toBe(w.B)
	})
})

describe("the refusals", () => {
	test("not the owner, a session's notes, a starter kit", async () => {
		const w = await world()
		const e = await w.entry("Verity", w.B)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, `move-down-x-${++seq}`)
		await w.refused(w.move([e.id], w.A, stranger.id), "Lorebook not found.")

		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.user.id, isGroup: false, name: "S" } as any)
			.returning()
		const [notes] = await testDb
			.insert(schema.lorebooks)
			.values({
				name: "Notes",
				userId: w.user.id,
				sessionId: session!.id
			} as any)
			.returning()
		const { NOTES_REFUSAL } = await import(
			"$lib/server/lorebooks/moveDownTheTree"
		)
		await expect(
			w.m.amendmentsMoveDownTheTreeHandler.handler(
				socketOf(w.user.id),
				{
					lorebookId: notes!.id,
					entryIds: [e.id],
					branchId: null
				} as any,
				w.emit
			)
		).rejects.toThrow(NOTES_REFUSAL)

		const uuid = "00000000-0000-4000-8000-000000000777"
		await testDb.insert(schema.plugins).values({
			pluginId: "acme/move-down-kit",
			name: "Acme Kit",
			version: "0.1.0",
			bundleSource: "",
			bundleHash: "x",
			enabled: false,
			manifest: {},
			adminDenied: []
		} as any)
		const [kit] = await testDb
			.insert(schema.lorebooks)
			.values({
				name: "Kit",
				userId: w.user.id,
				kind: "starter_kit",
				uuid,
				extraJson: {
					provided: {
						plugin: "acme/move-down-kit",
						slug: "acme/move-down-kit:slug",
						version: "1.0.0",
						sha256: "x",
						uuid,
						entries: {}
					}
				}
			} as any)
			.returning()
		const { primerRowEditProblem } = await import(
			"$lib/server/plugins/providedMarks"
		)
		const sentence = (await primerRowEditProblem(testDb as any, kit!.id))!
		expect(sentence).toBeTruthy()
		await expect(
			w.m.amendmentsMoveDownTheTreeHandler.handler(
				socketOf(w.user.id),
				{
					lorebookId: kit!.id,
					entryIds: [e.id],
					branchId: null
				} as any,
				w.emit
			)
		).rejects.toThrow(sentence)
	})

	test("a History entry, and a line that is not below", async () => {
		const w = await world()
		const history = await w.entry(null, w.B, {
			typeId: HISTORY_TYPE_ID,
			fields: { year: 4 }
		})
		const { moveDownSentence } = await import(
			"$lib/shared/lorebooks/moveDownTheTree"
		)
		await w.refused(
			w.move([history.id], w.A),
			moveDownSentence(
				{
					kind: "history",
					row: {
						id: history.id,
						name: "Untitled",
						isHistory: true,
						branchId: w.B,
						anchorEntryId: null,
						date: { year: 4, month: null, day: null }
					}
				},
				{ lineName: () => "", date: () => "", timeline: true }
			)
		)
		const e = await w.entry("Verity", w.B)
		await w.refused(
			w.move([e.id], w.C),
			"C is not a line B was forked from. An entry moves only down the tree, toward main."
		)
		await w.refused(
			w.move([], w.A),
			"Choose the entries to move and the line to move them to."
		)
		expect(await w.branchOf(e.id)).toBe(w.B)
	})

	test("a standing record of a session's turn refuses until it settles", async () => {
		const w = await world()
		const e = await w.entry("Verity", w.B)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: "S",
				lorebookId: w.book.id
			} as any)
			.returning()
		const [imprint] = await testDb
			.insert(schema.loreImprints)
			.values({
				sessionId: session!.id,
				lorebookId: w.book.id,
				subjectKind: "entry",
				subjectId: e.id,
				field: "title",
				status: "standing"
			} as any)
			.returning()
		const { standingImprintRefusal } = await import(
			"$lib/server/lorebooks/moveDownTheTree"
		)
		await w.refused(w.move([e.id], w.A), standingImprintRefusal("Verity"))
		expect(await w.branchOf(e.id)).toBe(w.B)
		await testDb
			.update(schema.loreImprints)
			.set({ status: "settled" })
			.where(eq(schema.loreImprints.id, imprint!.id))
		await w.move([e.id], w.A)
		expect(await w.branchOf(e.id)).toBe(w.A)
	})

	test("a kept record of a session having made the entry refuses; a kept record of one field does not", async () => {
		const w = await world()
		const made = await w.entry("Made", w.B)
		const edited = await w.entry("Edited", w.B)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.user.id, isGroup: false, name: "S", lorebookId: w.book.id } as any)
			.returning()
		await testDb.insert(schema.loreImprints).values([
			{ sessionId: session!.id, lorebookId: w.book.id, subjectKind: "entry", subjectId: made.id, field: null, status: "kept" },
			{ sessionId: session!.id, lorebookId: w.book.id, subjectKind: "entry", subjectId: edited.id, field: "content", status: "kept" }
		] as any)
		const { standingImprintRefusal } = await import(
			"$lib/server/lorebooks/moveDownTheTree"
		)
		await w.refused(w.move([made.id], w.A), standingImprintRefusal("Made"))
		expect(await w.branchOf(made.id)).toBe(w.B)
		await w.move([edited.id], w.A)
		expect(await w.branchOf(edited.id)).toBe(w.A)
	})
})

describe("the sessions it tells", () => {
	test("sessionsOnLines names the sessions on those lines only", async () => {
		const w = await world()
		const sessionOn = async (branchId: number | null) =>
			(
				await testDb
					.insert(schema.sessions)
					.values({
						userId: w.user.id,
						isGroup: false,
						name: "S",
						lorebookId: w.book.id,
						lorebookBranchId: branchId
					} as any)
					.returning()
			)[0]!.id
		const onA = await sessionOn(w.A)
		const onMain = await sessionOn(null)
		await sessionOn(w.B)
		const { sessionsOnLines } = await import(
			"$lib/server/lorebooks/moveDownTheTree"
		)
		expect(
			await sessionsOnLines(testDb as any, w.book.id, [null, w.A])
		).toEqual([onA, onMain].sort((a, b) => a - b))
		expect(await sessionsOnLines(testDb as any, w.book.id, [])).toEqual([])
	})

	test("a move tells the sessions on the lines that start reading the entry", async () => {
		const w = await world()
		const e = await w.entry("Verity", w.B)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: "S",
				lorebookId: w.book.id,
				lorebookBranchId: w.C
			} as any)
			.returning()
		broadcasts.length = 0
		await w.move([e.id], w.A)
		expect(broadcasts).toContainEqual({
			sessionId: session!.id,
			event: "state:changed",
			data: { sessionId: session!.id }
		})
	})
})
