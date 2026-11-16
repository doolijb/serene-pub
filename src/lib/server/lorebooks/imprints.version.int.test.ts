/**
 * An entry's dated version (`entry_amendments`, `base` NULL) in the per-turn
 * record (`lore_imprints`, subject kind `version`): the one retraction rule on
 * a version's `fields` — a made version is deleted while as made, a field
 * goes back while it holds what the turn wrote, a field the turn added is
 * removed (the key deleted, never null), and a version someone else changed
 * or stands on is kept.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-imprint-versions-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
let n = 0

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `imprint-versions-${suffix}`)
	const [book] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: book!.id })
		.returning()
	const message = async () => {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await testDb.insert(schema.messages).values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
		return legacy!
	}
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: `Place ${suffix}`,
			content: "As written.",
			fields: {}
		})
		.returning()
	const version = async (fields: Record<string, unknown>, day = 1) => {
		const [row] = await testDb
			.insert(schema.entryAmendments)
			.values({ lorebookId: book!.id, entryId: entry!.id, year: 1000, month: 1, day, fields })
			.returning()
		return row!
	}
	const anchor = (messageId: number, runId = `run-${suffix}`) => ({ sessionId: session!.id, messageId, runId })
	return { user, book: book!, session: session!, entry: entry!, message, version, anchor }
}

const versionRow = async (id: number) =>
	(await testDb.select().from(schema.entryAmendments).where(eq(schema.entryAmendments.id, id)))[0]
const fieldsOf = async (id: number) => (await versionRow(id))?.fields as Record<string, unknown> | undefined
const standing = async (sessionId: number) => {
	const { imprintsOf } = await import("./imprints")
	return imprintsOf(db(), sessionId)
}
/** What Forward does: the taken list through JSON and `reviveRetractedState`. */
const roundTrip = async (taken: unknown) => {
	const { reviveRetractedState } = await import("$lib/server/state/write")
	return reviveRetractedState({ messageId: 0, imprints: JSON.parse(JSON.stringify(taken)) })!.imprints
}

/** A turn changed one field of a version: the write and the record it files. */
async function wrote(
	w: Awaited<ReturnType<typeof world>>,
	messageId: number,
	versionId: number,
	field: string,
	after: unknown
) {
	const { imprintField } = await import("./imprints")
	const before = (await fieldsOf(versionId))?.[field]
	const next = { ...(await fieldsOf(versionId)) }
	if (after === undefined) delete next[field]
	else next[field] = after
	await testDb.update(schema.entryAmendments).set({ fields: next }).where(eq(schema.entryAmendments.id, versionId))
	await imprintField(db(), w.anchor(messageId), { lorebookId: w.book.id, subject: "version", subjectId: versionId, field }, before, after)
}

describe("a dated version in the per-turn record", () => {
	test("a version the turn made is deleted, and comes back whole on restore", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Dated." })
		const { imprintMade, retractImprints, restoreImprints } = await import("./imprints")
		await imprintMade(db(), w.anchor(m.id), { lorebookId: w.book.id, subject: "version", subjectId: v.id })
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		expect(taken.map((t) => t.act)).toEqual(["unmade"])
		expect(await versionRow(v.id)).toBeUndefined()
		expect(await restoreImprints(db(), await roundTrip(taken))).toBe(true)
		const back = await versionRow(v.id)
		expect(back?.id).toBe(v.id)
		expect(back?.fields).toEqual({ content: "Dated." })
		expect(back?.createdAt).toBeInstanceOf(Date)
		expect((await standing(w.session.id)).length).toBe(1)
	})

	test("a changed field goes back, and restore writes the turn's value again", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Old." })
		await wrote(w, m.id, v.id, "content", "New.")
		const { retractImprints, restoreImprints } = await import("./imprints")
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		expect(taken[0]!.act).toBe("reverted")
		expect(await fieldsOf(v.id)).toEqual({ content: "Old." })
		await restoreImprints(db(), await roundTrip(taken))
		expect(await fieldsOf(v.id)).toEqual({ content: "New." })
	})

	test("a field the turn added is removed: the key is gone, never null", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Old." })
		await wrote(w, m.id, v.id, "mood", "grim")
		const { retractImprints, restoreImprints } = await import("./imprints")
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		const after = await fieldsOf(v.id)
		expect(after).toEqual({ content: "Old." })
		expect(Object.prototype.hasOwnProperty.call(after, "mood")).toBe(false)
		await restoreImprints(db(), await roundTrip(taken))
		expect(await fieldsOf(v.id)).toEqual({ content: "Old.", mood: "grim" })
	})

	test("a person changed the field since: it stays, and the record is kept", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Old." })
		await wrote(w, m.id, v.id, "content", "New.")
		await testDb.update(schema.entryAmendments).set({ fields: { content: "Theirs." } }).where(eq(schema.entryAmendments.id, v.id))
		const { retractImprints, keptImprintsByEntry } = await import("./imprints")
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		expect(taken[0]!.act).toBe("kept")
		expect(await fieldsOf(v.id)).toEqual({ content: "Theirs." })
		const kept = await keptImprintsByEntry(db(), w.book.id, [w.entry.id])
		expect(kept.get(w.entry.id)).toEqual([
			expect.objectContaining({ field: "content", label: "Content", before: "Old.", after: "New." })
		])
	})

	test("another session's standing record on a version this turn made keeps the made record", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Dated." })
		const { imprintMade, retractImprints } = await import("./imprints")
		await imprintMade(db(), w.anchor(m.id), { lorebookId: w.book.id, subject: "version", subjectId: v.id })
		const other = await world()
		const om = await other.message()
		await testDb.update(schema.sessions).set({ lorebookId: w.book.id }).where(eq(schema.sessions.id, other.session.id))
		const { imprintField } = await import("./imprints")
		await imprintField(
			db(),
			other.anchor(om.id),
			{ lorebookId: w.book.id, subject: "version", subjectId: v.id, field: "content" },
			"Dated.",
			"Theirs."
		)
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		expect(taken.map((t) => t.act)).toEqual(["kept"])
		expect(await versionRow(v.id)).toBeDefined()
	})

	test("a person's edit-history row on the version holds it", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Dated." })
		const { imprintMade, retractImprints } = await import("./imprints")
		await imprintMade(db(), w.anchor(m.id), { lorebookId: w.book.id, subject: "version", subjectId: v.id })
		await testDb.insert(schema.loreRedlines).values({
			entryId: w.entry.id,
			amendmentId: v.id,
			changes: { content: { before: { v: "a" }, after: { v: "Dated." } } },
			cause: "save",
			userId: w.user.id
		})
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		expect(taken.map((t) => t.act)).toEqual(["kept"])
		expect(await versionRow(v.id)).toBeDefined()
	})

	test("markImprintsKept on a version leaves it to the person", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Old." })
		await wrote(w, m.id, v.id, "content", "New.")
		const { markImprintsKept, retractImprints } = await import("./imprints")
		expect(await markImprintsKept(db(), { subjectKind: "version", subjectId: v.id, fields: ["content"] })).toBe(1)
		expect(await retractImprints(db(), { messageIds: [m.id] })).toEqual([])
		expect(await fieldsOf(v.id)).toEqual({ content: "New." })
	})

	test("a routine edit-history row loses the key on revert and gets it back on restore", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Old." })
		await wrote(w, m.id, v.id, "content", "New.")
		const runId = `run-${n}`
		const [{ id: redlineId }] = (await testDb
			.insert(schema.loreRedlines)
			.values({
				entryId: w.entry.id,
				amendmentId: v.id,
				changes: { content: { before: { v: "Old." }, after: { v: "New." } } },
				cause: "routine",
				sessionId: w.session.id,
				messageId: m.id,
				runId: (await standing(w.session.id))[0]!.runId
			})
			.returning({ id: schema.loreRedlines.id })) as { id: number }[]
		void runId
		const { retractImprints, restoreImprints } = await import("./imprints")
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		const redlines = () => testDb.select().from(schema.loreRedlines).where(eq(schema.loreRedlines.id, redlineId))
		expect(await redlines()).toEqual([])
		await restoreImprints(db(), await roundTrip(taken))
		const [back] = await redlines()
		expect(back?.changes).toHaveProperty("content")
		expect(back?.amendmentId).toBe(v.id)
	})

	test("keptImprintsByEntry labels a made version null and a field by its words", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Dated." })
		const { imprintMade, markImprintsKept, keptImprintsByEntry } = await import("./imprints")
		await imprintMade(db(), w.anchor(m.id), { lorebookId: w.book.id, subject: "version", subjectId: v.id })
		await markImprintsKept(db(), { subjectKind: "version", subjectId: v.id, fields: ["content"] })
		const kept = await keptImprintsByEntry(db(), w.book.id, [w.entry.id])
		expect(kept.get(w.entry.id)).toEqual([expect.objectContaining({ field: null, label: null })])
	})

	test("Revert puts the field back, files a revert row on the version, and names the entry's type", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Old." })
		await wrote(w, m.id, v.id, "content", "New.")
		await testDb.update(schema.entryAmendments).set({ fields: { content: "Theirs." } }).where(eq(schema.entryAmendments.id, v.id))
		const { retractImprints, settleKeptImprint } = await import("./imprints")
		await retractImprints(db(), { messageIds: [m.id] })
		const [kept] = await standing(w.session.id)
		const settled = await settleKeptImprint(db(), kept!.id, "revert", { userId: w.user.id })
		expect(settled).toEqual(
			expect.objectContaining({ subject: "version", subjectId: v.id, lorebookId: w.book.id, typeId: LOCATION_TYPE_ID })
		)
		expect(await fieldsOf(v.id)).toEqual({ content: "Old." })
		const [row] = await testDb
			.select()
			.from(schema.loreRedlines)
			.where(and(eq(schema.loreRedlines.amendmentId, v.id), eq(schema.loreRedlines.cause, "revert")))
		expect(row?.userId).toBe(w.user.id)
		expect(row?.changes).toHaveProperty("content")
	})

	test("Revert of a field the turn added deletes the key", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Old." })
		await wrote(w, m.id, v.id, "mood", "grim")
		await testDb.update(schema.entryAmendments).set({ fields: { content: "Old.", mood: "grim!" } }).where(eq(schema.entryAmendments.id, v.id))
		const { retractImprints, settleKeptImprint } = await import("./imprints")
		await retractImprints(db(), { messageIds: [m.id] })
		const [kept] = await standing(w.session.id)
		await settleKeptImprint(db(), kept!.id, "revert", { userId: w.user.id })
		expect(await fieldsOf(v.id)).toEqual({ content: "Old." })
	})

	test("a session that no longer reads the book leaves the row and keeps the record", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Old." })
		await wrote(w, m.id, v.id, "content", "New.")
		await testDb.update(schema.sessions).set({ lorebookId: null }).where(eq(schema.sessions.id, w.session.id))
		const { retractImprints, restoreImprints } = await import("./imprints")
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		expect(taken.map((t) => t.act)).toEqual(["kept"])
		expect(await fieldsOf(v.id)).toEqual({ content: "New." })
		const record = async () =>
			(await testDb.select().from(schema.loreImprints).where(eq(schema.loreImprints.sessionId, w.session.id)))[0]
		expect((await record())!.status).toBe("kept")
		await restoreImprints(db(), await roundTrip(taken))
		expect((await record())!.status).toBe("standing")
		expect(await fieldsOf(v.id)).toEqual({ content: "New." })
	})

	test("a made version in a book the session no longer reads stays, and its record is kept", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Dated." })
		const { imprintMade, retractImprints } = await import("./imprints")
		await imprintMade(db(), w.anchor(m.id), { lorebookId: w.book.id, subject: "version", subjectId: v.id })
		await testDb.update(schema.sessions).set({ lorebookId: null }).where(eq(schema.sessions.id, w.session.id))
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		expect(taken.map((t) => t.act)).toEqual(["kept"])
		expect(await versionRow(v.id)).toBeDefined()
	})

	test("a made version's edit-history row goes with it and comes back on restore", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Dated." })
		const { imprintMade, retractImprints, restoreImprints } = await import("./imprints")
		const { recordRedline } = await import("./redlines")
		await imprintMade(db(), w.anchor(m.id), { lorebookId: w.book.id, subject: "version", subjectId: v.id })
		const rowId = await recordRedline(db(), {
			entryId: w.entry.id,
			amendmentId: v.id,
			before: {},
			after: { content: "Dated." },
			keys: ["content"],
			cause: "routine",
			by: { run: { sessionId: w.session.id, messageId: m.id, runId: w.anchor(m.id).runId, shownAs: null } }
		})
		expect(rowId).not.toBeNull()
		const redlines = () => testDb.select().from(schema.loreRedlines).where(eq(schema.loreRedlines.amendmentId, v.id))
		const [before] = await redlines()
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		expect(taken.map((t) => t.act)).toEqual(["unmade"])
		expect(await versionRow(v.id)).toBeUndefined()
		expect(await redlines()).toEqual([])
		expect(await restoreImprints(db(), await roundTrip(taken))).toBe(true)
		const after = await redlines()
		expect(after.length).toBe(1)
		expect(after[0]!.id).toBe(rowId)
		expect(after[0]!.changes).toEqual(before!.changes)
		const again = await retractImprints(db(), { messageIds: [m.id] })
		expect(again.map((t) => t.act)).toEqual(["unmade"])
		expect(await versionRow(v.id)).toBeUndefined()
		expect(await redlines()).toEqual([])
	})

	test("a taken version with no redlines key restores as before", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Dated." })
		const { imprintMade, retractImprints, restoreImprints } = await import("./imprints")
		await imprintMade(db(), w.anchor(m.id), { lorebookId: w.book.id, subject: "version", subjectId: v.id })
		const taken = await retractImprints(db(), { messageIds: [m.id] })
		expect("redlines" in taken[0]!).toBe(false)
		expect(await restoreImprints(db(), await roundTrip(taken))).toBe(true)
		expect(await versionRow(v.id)).toBeDefined()
	})

	test("a kept version record carries the version's date in words; an entry record has none", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Old." })
		const made = await w.version({ content: "Made." }, 2)
		await wrote(w, m.id, v.id, "content", "New.")
		const { imprintMade, retractImprints, keptImprintsByEntry, imprintField } = await import("./imprints")
		await imprintMade(db(), w.anchor(m.id), { lorebookId: w.book.id, subject: "version", subjectId: made.id })
		await testDb.update(schema.entryAmendments).set({ fields: { content: "Theirs." } }).where(eq(schema.entryAmendments.id, v.id))
		await testDb.update(schema.entryAmendments).set({ fields: { content: "Edited." } }).where(eq(schema.entryAmendments.id, made.id))
		await imprintField(db(), w.anchor(m.id), { lorebookId: w.book.id, subject: "entry", subjectId: w.entry.id, field: "title" }, "Place", "Town")
		await testDb.update(schema.lorebookEntries).set({ title: "Theirs" }).where(eq(schema.lorebookEntries.id, w.entry.id))
		await retractImprints(db(), { messageIds: [m.id] })
		const kept = (await keptImprintsByEntry(db(), w.book.id, [w.entry.id])).get(w.entry.id)!
		const { formatDate } = await import("$lib/shared/lorebooks/storyDate")
		const expected = (day: number) => formatDate({ year: 1000, month: 1, day }, null)
		const ofVersion = kept.filter((k) => k.field === "content")
		expect(ofVersion.length).toBe(1)
		expect(ofVersion[0]!.versionDate).toBe(expected(1))
		const madeRec = kept.find((k) => k.field === null)
		expect(madeRec!.versionDate).toBe(expected(2))
		const entryRec = kept.find((k) => k.field === "title")
		expect(entryRec).toBeDefined()
		expect(entryRec!.versionDate).toBeUndefined()
	})

	test("settling past the message settles the record, and a later retraction leaves it", async () => {
		const w = await world()
		const m = await w.message()
		const v = await w.version({ content: "Old." })
		await wrote(w, m.id, v.id, "content", "New.")
		const { settleThrough } = await import("$lib/server/sessions/settle")
		await settleThrough(db(), w.session.id, m.id, {})
		const [rec] = await standing(w.session.id)
		expect(rec!.status).toBe("settled")
		const { retractImprints } = await import("./imprints")
		const runId = rec!.runId!
		expect(await retractImprints(db(), { sessionId: w.session.id, runIds: [runId] })).toEqual([])
		expect(await fieldsOf(v.id)).toEqual({ content: "New." })
	})
})
