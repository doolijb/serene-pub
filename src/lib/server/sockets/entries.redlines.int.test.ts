/**
 * An entry's Edit history through the real handlers: what a save records,
 * the list worded for its asker, Restore, count and clear, the admin pair.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let n = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-entries-redlines-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(async () => {
	;(await import("$lib/server/pipelines/runtime/runRegistry"))._reset()
})

const socketOf = (userId: number, isAdmin = false) =>
	({ user: { id: userId, isAdmin } }) as any

function recorder() {
	const sent: Array<{ event: string; data: any }> = []
	return {
		sent,
		emit: ((event: string, data: any) =>
			void sent.push({ event, data })) as any
	}
}

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `${++n}`
	const user = await createTestUser(testDb, `redline-${tag}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${tag}`, userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Session ${tag}`,
			lorebookId: book!.id
		})
		.returning()
	const entry = await add(book!.id, "Mira", "A baker.")
	return { user, book: book!, session: session!, entry, tag }
}

async function add(
	lorebookId: number,
	title: string,
	content: string,
	over: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content,
			keys: ["mira"],
			...over
		})
		.returning()
	return row!
}

const rowOf = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!
const redlinesOf = (entryId: number) =>
	testDb
		.select()
		.from(schema.loreRedlines)
		.where(eq(schema.loreRedlines.entryId, entryId))
		.orderBy(schema.loreRedlines.id)

const save = async (
	userId: number,
	entry: Record<string, unknown>,
	typeId: string = WORLD_LORE_TYPE_ID
) => {
	const { updateEntryHandler } = await import("./entries")
	return updateEntryHandler.handler(
		socketOf(userId),
		{ entry: { typeId, ...entry } as any },
		recorder().emit
	)
}

const list = async (userId: number, entryId: number) => {
	const { entryRedlinesHandler } = await import("./redlines")
	return entryRedlinesHandler.handler(
		socketOf(userId),
		{ entryId },
		recorder().emit
	)
}

const restore = async (userId: number, redlineId: number) => {
	const { entryRestoreRedlineHandler } = await import("./redlines")
	const r = recorder()
	const result = entryRestoreRedlineHandler.handler(
		socketOf(userId),
		{ redlineId },
		r.emit
	)
	return { r, result }
}

/** A routine's rewrite: the entry update and its row, as the host writes them. */
async function routineRewrite(
	w: Awaited<ReturnType<typeof world>>,
	content: string,
	sessionId: number | null
) {
	const { recordEntryRedline } = await import(
		"$lib/server/lorebooks/redlines"
	)
	const before = await rowOf(w.entry.id)
	const [after] = await testDb
		.update(schema.lorebookEntries)
		.set({ content })
		.where(eq(schema.lorebookEntries.id, w.entry.id))
		.returning()
	await recordEntryRedline(testDb as unknown as Db, {
		before,
		after: after!,
		named: ["content"],
		cause: sessionId == null ? "apply" : "routine",
		by:
			sessionId == null
				? ({ sessionId: w.session.id } as any)
				: {
						run: {
							sessionId,
							messageId: null,
							runId: `run-${++n}`,
							shownAs: "Remember things"
						}
					}
	})
}

describe("what a form save records", () => {
	test("a content change leaves one save row with before, after and the person", async () => {
		const w = await world()
		await save(w.user.id, { id: w.entry.id, content: "A widow." })
		const rows = await redlinesOf(w.entry.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			cause: "save",
			userId: w.user.id,
			amendmentId: null
		})
		expect(rows[0]!.changes).toEqual({
			content: { before: { v: "A baker." }, after: { v: "A widow." } }
		})
	})

	test("a save that changes nothing, a mark, and an archive leave none", async () => {
		const w = await world()
		await save(w.user.id, {
			id: w.entry.id,
			name: "Mira",
			content: "A baker.",
			keys: ["mira"]
		})
		await save(w.user.id, { id: w.entry.id, archived: true })
		const { entrySetMarksHandler } = await import("./entries")
		await entrySetMarksHandler.handler(
			socketOf(w.user.id),
			{
				id: w.entry.id,
				typeId: WORLD_LORE_TYPE_ID,
				enabled: false,
				constant: true
			} as any,
			recorder().emit
		)
		expect(await redlinesOf(w.entry.id)).toHaveLength(0)
	})
})

describe("entries:redlines", () => {
	test("says You for the asker's own row, newest first, with labels", async () => {
		const w = await world()
		await save(w.user.id, { id: w.entry.id, content: "A widow." })
		await save(w.user.id, { id: w.entry.id, keys: ["mira", "widow"] })
		const res = await list(w.user.id, w.entry.id)
		expect(res).toMatchObject({
			entryId: w.entry.id,
			lorebookId: w.book.id,
			canRestore: true,
			canClear: true
		})
		expect(res.redlines.map((r) => r.changes[0]!.label)).toEqual([
			"Keys",
			"Content"
		])
		expect(res.redlines[0]).toMatchObject({
			who: "You",
			mine: true,
			cause: "save",
			version: null
		})
	})

	test("names the session to a viewer who may open it, hides it from one who may not, and survives a delete", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const w = await world()
		const member = await createTestUser(testDb, `redline-member-${++n}`)
		// The book is the session's own notes, so its members may open it.
		await testDb
			.update(schema.lorebooks)
			.set({ sessionId: w.session.id })
			.where(eq(schema.lorebooks.id, w.book.id))
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: w.session.id, userId: member.id })
		const [elsewhere] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: "Elsewhere",
				lorebookId: w.book.id
			})
			.returning()
		await routineRewrite(w, "Rewritten here.", w.session.id)
		await routineRewrite(w, "Rewritten there.", elsewhere!.id)
		await routineRewrite(w, "Applied.", null)

		const mine = await list(w.user.id, w.entry.id)
		expect(mine.redlines.map((r) => r.who)).toEqual([
			`By itself, from Session ${w.tag}`,
			"Remember things in Elsewhere",
			`Remember things in Session ${w.tag}`
		])
		const theirs = await list(member.id, w.entry.id)
		expect(theirs).toMatchObject({ canRestore: false, canClear: false })
		expect(theirs.redlines.map((r) => r.who)).toEqual([
			`By itself, from Session ${w.tag}`,
			"Remember things in a session",
			`Remember things in Session ${w.tag}`
		])
		expect(JSON.stringify(theirs)).not.toContain("runId")

		await testDb
			.delete(schema.sessions)
			.where(eq(schema.sessions.id, elsewhere!.id))
		const after = await list(w.user.id, w.entry.id)
		expect(after.redlines.map((r) => r.who)[1]).toBe(
			"Remember things in a session that was deleted"
		)
	})
})

describe("entries:restoreRedline", () => {
	test("brings a routine's rewrite back, and the restore is itself listed", async () => {
		const w = await world()
		await routineRewrite(w, "Rewritten.", w.session.id)
		const [row] = await redlinesOf(w.entry.id)
		const { r, result } = await restore(w.user.id, row!.id)
		await expect(result).resolves.toEqual({
			redlineId: row!.id,
			entryId: w.entry.id,
			lorebookId: w.book.id
		})
		expect((await rowOf(w.entry.id)).content).toBe("A baker.")
		const res = await list(w.user.id, w.entry.id)
		expect(res.redlines[0]).toMatchObject({ cause: "restore", who: "You" })
		expect(r.sent.map((s) => s.event)).toEqual(
			expect.arrayContaining([
				"entries:update",
				"entries:restoreRedline",
				"entries:redlines"
			])
		)
	})

	test("is refused in words while a run earmarks the entry", async () => {
		const w = await world()
		await routineRewrite(w, "Rewritten.", w.session.id)
		const [row] = await redlinesOf(w.entry.id)
		const reg = await import("$lib/server/pipelines/runtime/runRegistry")
		reg.start({
			runId: `r-${++n}`,
			userId: w.user.id,
			sessionId: w.session.id,
			specId: "core:spec/test",
			kind: "routine"
		})
		reg.earmark(`r-${n}`, "entry", [w.entry.id])
		const { result } = await restore(w.user.id, row!.id)
		await expect(result).rejects.toThrow(/may update this entry/)
		expect((await rowOf(w.entry.id)).content).toBe("Rewritten.")
		reg.finish(`r-${n}`)
	})

	test("is refused for a key the entry type no longer declares, and for a row that is gone", async () => {
		const w = await world()
		const [row] = await testDb
			.insert(schema.loreRedlines)
			.values({
				entryId: w.entry.id,
				changes: { sparkle: { before: { v: "a" }, after: { v: "b" } } },
				cause: "save",
				userId: w.user.id
			})
			.returning()
		await expect(
			(await restore(w.user.id, row!.id)).result
		).rejects.toThrow("sparkle is no longer part of this kind of entry.")
		await expect(
			(await restore(w.user.id, row!.id + 999)).result
		).rejects.toThrow("That edit is no longer kept.")
	})

	test("restores a typed field through the same save", async () => {
		const w = await world()
		const place = await add(w.book.id, "Vault", "A place.", {
			typeId: LOCATION_TYPE_ID,
			fields: { category: "Rooms" }
		})
		await save(
			w.user.id,
			{ id: place.id, category: "Streets" },
			LOCATION_TYPE_ID
		)
		const [row] = await redlinesOf(place.id)
		expect(row!.changes.category).toEqual({
			before: { v: "Rooms" },
			after: { v: "Streets" }
		})
		await (
			await restore(w.user.id, row!.id)
		).result
		expect(((await rowOf(place.id)).fields as any).category).toBe("Rooms")
		expect((await list(w.user.id, place.id)).redlines[0]).toMatchObject({
			cause: "restore"
		})
	})

	test("a member who is not the book's owner cannot restore", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const w = await world()
		const member = await createTestUser(testDb, `redline-member-${++n}`)
		await testDb
			.update(schema.lorebooks)
			.set({ sessionId: w.session.id })
			.where(eq(schema.lorebooks.id, w.book.id))
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: w.session.id, userId: member.id })
		await routineRewrite(w, "Rewritten.", w.session.id)
		const [row] = await redlinesOf(w.entry.id)
		await expect(
			(await restore(member.id, row!.id)).result
		).rejects.toThrow("Entry not found or access denied.")
		expect((await rowOf(w.entry.id)).content).toBe("Rewritten.")
	})
})

describe("count and clear", () => {
	const OWNER_ONLY = "Only the lorebook's owner can clear its edit history."

	test("count and clear an entry, then a lorebook", async () => {
		const { entryRedlineCountHandler, entryClearRedlinesHandler } =
			await import("./redlines")
		const w = await world()
		const other = await add(w.book.id, "Odo", "A miller.")
		await save(w.user.id, { id: w.entry.id, content: "One." })
		await save(w.user.id, { id: w.entry.id, content: "Two." })
		await save(w.user.id, { id: other.id, content: "Three." })
		const count = (p: any) =>
			entryRedlineCountHandler.handler(
				socketOf(w.user.id),
				p,
				recorder().emit
			)
		await expect(count({ entryId: w.entry.id })).resolves.toEqual({
			lorebookId: w.book.id,
			entryId: w.entry.id,
			count: 2
		})
		await expect(count({ lorebookId: w.book.id })).resolves.toEqual({
			lorebookId: w.book.id,
			entryId: null,
			count: 3
		})
		const r = recorder()
		await expect(
			entryClearRedlinesHandler.handler(
				socketOf(w.user.id),
				{ entryId: w.entry.id },
				r.emit
			)
		).resolves.toEqual({
			lorebookId: w.book.id,
			entryId: w.entry.id,
			cleared: 2
		})
		expect(r.sent.map((s) => s.event)).toEqual([
			"entries:clearRedlines",
			"entries:redlines"
		])
		await expect(
			entryClearRedlinesHandler.handler(
				socketOf(w.user.id),
				{ lorebookId: w.book.id },
				recorder().emit
			)
		).resolves.toEqual({ lorebookId: w.book.id, entryId: null, cleared: 1 })
		expect(await redlinesOf(other.id)).toHaveLength(0)
	})

	test("a member who is not the owner cannot clear or count", async () => {
		const { entryRedlineCountHandler, entryClearRedlinesHandler } =
			await import("./redlines")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const w = await world()
		const member = await createTestUser(testDb, `redline-member-${++n}`)
		await testDb
			.update(schema.lorebooks)
			.set({ sessionId: w.session.id })
			.where(eq(schema.lorebooks.id, w.book.id))
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: w.session.id, userId: member.id })
		await save(w.user.id, { id: w.entry.id, content: "One." })
		for (const p of [{ entryId: w.entry.id }, { lorebookId: w.book.id }]) {
			await expect(
				entryClearRedlinesHandler.handler(
					socketOf(member.id),
					p,
					recorder().emit
				)
			).rejects.toThrow(OWNER_ONLY)
			await expect(
				entryRedlineCountHandler.handler(
					socketOf(member.id),
					p,
					recorder().emit
				)
			).rejects.toThrow(OWNER_ONLY)
		}
		expect(await redlinesOf(w.entry.id)).toHaveLength(1)
	})
})

describe("admin", () => {
	test("summary and clear are admin only", async () => {
		const { adminRedlineSummaryHandler, adminClearRedlinesHandler } =
			await import("./redlines")
		const w = await world()
		await save(w.user.id, { id: w.entry.id, content: "One." })
		await expect(
			adminRedlineSummaryHandler.handler(
				socketOf(w.user.id),
				{},
				recorder().emit
			)
		).rejects.toThrow("Unauthorized")
		await expect(
			adminClearRedlinesHandler.handler(
				socketOf(w.user.id),
				{},
				recorder().emit
			)
		).rejects.toThrow("Unauthorized")
		const summary = await adminRedlineSummaryHandler.handler(
			socketOf(w.user.id, true),
			{},
			recorder().emit
		)
		expect(summary.count).toBeGreaterThanOrEqual(1)
		expect(summary.bytes).toBeGreaterThan(0)
		const cleared = await adminClearRedlinesHandler.handler(
			socketOf(w.user.id, true),
			{},
			recorder().emit
		)
		expect(cleared.cleared).toBeGreaterThanOrEqual(1)
		expect(await redlinesOf(w.entry.id)).toHaveLength(0)
	})
})

describe("lorebooks:settleImprint", () => {
	test("Revert leaves one revert row as the person who pressed it", async () => {
		const { settleImprintHandler } = await import("./entries")
		const w = await world()
		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "A widow." })
			.where(eq(schema.lorebookEntries.id, w.entry.id))
		const [imprint] = await testDb
			.insert(schema.loreImprints)
			.values({
				sessionId: w.session.id,
				lorebookId: w.book.id,
				subjectKind: "entry",
				subjectId: w.entry.id,
				field: "content",
				before: { v: "A baker." },
				after: { v: "A widow." },
				status: "kept"
			})
			.returning()
		await settleImprintHandler.handler(
			socketOf(w.user.id),
			{ imprintId: imprint!.id, choice: "revert" } as any,
			recorder().emit
		)
		const rows = await redlinesOf(w.entry.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ cause: "revert", userId: w.user.id })
	})
})
