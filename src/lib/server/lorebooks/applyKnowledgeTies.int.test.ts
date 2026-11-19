/**
 * 🚧 A knowledge tie play wrote to the session's notes (`was_told`,
 * `has_been_there`) while the lorebook is not on Full is offered in Apply (ruled
 * D41: "Offer it in Apply"): listed as its own row kind, moved as the same row,
 * superseded by a hand tie (D39), taken back, capped on the settle line,
 * carried by an automatic Apply. Rows are inserted directly; the list, Apply and
 * `takeBackApply` are the server functions in `ownBook.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0
const asDb = () => db as unknown as Db
const lore = () => import("$lib/server/lorebooks/ownBook")
const knowledge = () => import("$lib/server/lorebooks/entryKnowledge")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-kn6-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const DAY = { year: 5, month: 2, day: 3 }
const OTHER_DAY = { year: 5, month: 2, day: 9 }

async function world(mode: "review" | "full" = "review") {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `kn6-${suffix}`)
	const member = await createTestUser(db, `kn6-m-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: mode })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const place = async (title: string) =>
		(
			await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId: LOCATION_TYPE_ID,
					typeVersion: 1,
					position: ++n,
					title,
					content: `${title}.`,
					fields: { category: "Rooms" }
				})
				.returning()
		)[0]!
	const vault = await place("The Vault")
	const tavern = await place("The Tavern")
	const [aria] = await db
		.insert(schema.lorebookBindings)
		.values({ lorebookId: book!.id, binding: "{{char:1}}", name: "Aria" })
		.returning()
	const [loreDay] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "The third of Frost",
			content: "Lore day.",
			fields: DAY
		})
		.returning()
	const session = await sessionOn(user.id, book!.id)
	const memberSession = await sessionOn(member.id, book!.id)
	return { user, member, book: book!, vault, tavern, aria: aria!, loreDay: loreDay!, session, memberSession }
}
type World = Awaited<ReturnType<typeof world>>

async function sessionOn(userId: number, lorebookId: number) {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: `Run ${++n}`, lorebookId })
		.returning()
	const { insertOwnBook } = await lore()
	await insertOwnBook(asDb(), {
		sessionId: session!.id,
		userId,
		name: null,
		overlayOf: lorebookId,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	return session!
}

const messageIn = async (sessionId: number) => {
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "…" })
		.returning()
	await db.insert(schema.messages).values({ id: legacy!.id, sessionId, role: "assistant" })
	return legacy!
}

const ownOf = async (sessionId: number) => (await (await lore()).ownBookFor(asDb(), sessionId)).id

async function ownDay(sessionId: number, date: typeof DAY, sourceMessageId: number | null) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: await ownOf(sessionId),
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: `Own day ${n}`,
			content: "Rang.",
			fields: date,
			sourceMessageId
		})
		.returning()
	return row!
}

async function ownEntry(sessionId: number, title: string, over: Partial<typeof schema.lorebookEntries.$inferInsert> = {}) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: await ownOf(sessionId),
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `About ${title}.`,
			fields: { category: "Rooms" },
			...over
		})
		.returning()
	return row!
}

type Kind = "was_told" | "has_been_there" | "knows" | "kept_from"

/** A knowledge tie in the session's notes (or `lorebookId`), imprinted with a message when given. */
async function tie(
	sessionId: number,
	w: World,
	over: {
		kind?: Kind
		memberId?: number
		entryId?: number
		messageId?: number | null
		lorebookId?: number
		status?: string
		historyEntryId?: number | null
	} = {}
) {
	const lorebookId = over.lorebookId ?? (await ownOf(sessionId))
	const kind = over.kind ?? "was_told"
	const [row] = await db
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			fromNodeId: over.memberId ?? w.aria.id,
			toEntryId: over.entryId ?? w.vault.id,
			relationshipType: kind,
			knowledgeKind: kind,
			status: over.status ?? "active",
			historyEntryId: over.historyEntryId ?? null
		})
		.returning()
	if (over.messageId != null)
		await db.insert(schema.loreImprints).values({
			sessionId,
			messageId: over.messageId,
			runId: null,
			lorebookId,
			subjectKind: "relationship",
			subjectId: row!.id,
			field: null,
			before: null,
			after: null
		})
	return row!
}

const row = async (id: number) =>
	(await db.select().from(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.id, id)))[0]
const applyRecords = (sessionId: number) =>
	db
		.select()
		.from(schema.loreImprints)
		.where(and(eq(schema.loreImprints.sessionId, sessionId), eq(schema.loreImprints.origin, "apply")))
		.orderBy(schema.loreImprints.id)
const items = async (w: World, sessionId = w.session.id) => (await lore()).overlayItemsOf(asDb(), sessionId)
const tieItems = async (w: World, sessionId = w.session.id) =>
	(await items(w, sessionId)).filter((i) => i.kind === "knowledge-tie")
const apply = async (w: World, more: Record<string, unknown> = {}, userId = w.user.id, sessionId = w.session.id) =>
	(await lore()).applyOverlayItems(asDb(), { sessionId, userId, ...more })

describe("the list", () => {
	it("1 · a held was_told / has_been_there tie is its own row kind with its sentence, never a link", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const told = await tie(w.session.id, w, { kind: "was_told", messageId: m.id })
		const been = await tie(w.session.id, w, { kind: "has_been_there", entryId: w.tavern.id })
		const all = await items(w)
		expect(all.filter((i) => i.kind === "link")).toEqual([])
		expect(all.filter((i) => i.kind === "knowledge-tie")).toEqual([
			expect.objectContaining({
				tieId: told.id,
				entryId: w.vault.id,
				typeId: LOCATION_TYPE_ID,
				title: "Aria was told about The Vault",
				sourceMessageId: m.id
			}),
			expect.objectContaining({ tieId: been.id, title: "Aria has been to The Tavern", sourceMessageId: null })
		])
	})

	it("10 · a hand tie in the notes is never listed and Apply-all never moves it", async () => {
		const w = await world()
		const hand = await tie(w.session.id, w, { kind: "knows" })
		expect(await tieItems(w)).toEqual([])
		const done = await apply(w)
		expect(done.appliedTies).toEqual([])
		expect((await row(hand.id))!.lorebookId).toBe(await ownOf(w.session.id))
	})

	it("11 · a tie on an entry born in the notes rides with that entry, play kind or hand, and is not a tie row", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const born = await ownEntry(w.session.id, "Cellar", { sourceMessageId: m.id })
		const play = await tie(w.session.id, w, { kind: "was_told", entryId: born.id })
		const hand = await tie(w.session.id, w, { kind: "knows", entryId: born.id })
		expect(await tieItems(w)).toEqual([])
		const done = await apply(w, { entryIds: [born.id] })
		expect(done.appliedTies).toEqual([])
		expect((await row(play.id))!.lorebookId).toBe(w.book.id)
		expect((await row(hand.id))!.lorebookId).toBe(w.book.id)
	})
})

describe("what is offered is what can be dropped", () => {
	it("13 · a tie from a session-only member is neither listed nor carried when its entry is applied", async () => {
		const w = await world()
		const [only] = await db
			.insert(schema.lorebookBindings)
			.values({ lorebookId: await ownOf(w.session.id), binding: "{{char:9}}", name: "Pim" })
			.returning()
		const t = await tie(w.session.id, w, { memberId: only!.id })
		expect(await tieItems(w)).toEqual([])
		await apply(w, { entryIds: [w.vault.id] })
		const done = await apply(w)
		expect(done.appliedTies).toEqual([])
		expect((await row(t.id))!.lorebookId).toBe(await ownOf(w.session.id))
	})

	it("14 · a ruleset run's tie row and a session-only member's tie are not deleted as superseded", async () => {
		const w = await world()
		const notes = await ownOf(w.session.id)
		const [only] = await db
			.insert(schema.lorebookBindings)
			.values({ lorebookId: notes, binding: "{{char:8}}", name: "Pim" })
			.returning()
		// A hand tie stands in the lorebook for both pairs.
		for (const memberId of [only!.id, w.aria.id])
			await db.insert(schema.narrativeRelationships).values({
				lorebookId: w.book.id,
				fromNodeId: memberId,
				toEntryId: w.vault.id,
				relationshipType: "knows",
				knowledgeKind: "knows",
				status: "active"
			})
		const sessionOnly = await tie(w.session.id, w, { memberId: only!.id })
		const ruleset = await tie(w.session.id, w)
		await db
			.update(schema.narrativeRelationships)
			.set({ rulesRunId: "run-1" })
			.where(eq(schema.narrativeRelationships.id, ruleset.id))
		const { dropSupersededKnowledgeTies } = await knowledge()
		const gone = await dropSupersededKnowledgeTies(asDb(), { userId: w.user.id, notesId: notes, lorebookId: w.book.id })
		expect(gone).toEqual([])
		expect(await row(sessionOnly.id)).toBeDefined()
		expect(await row(ruleset.id)).toBeDefined()
	})

	it("15 · the SQL of handTieInBook and isHandTie agree on kind, dating and branch", async () => {
		const w = await world()
		const { handTieInBook, isHandTie } = await knowledge()
		const [branch] = await db
			.insert(schema.lorebookBranches)
			.values({ lorebookId: w.book.id, name: `B${++n}`, forkYear: 1 } as never)
			.returning()
		const cases: Array<{ kind: Kind; dated: boolean; branched: boolean }> = []
		for (const kind of ["knows", "kept_from", "was_told", "has_been_there"] as Kind[])
			for (const dated of [false, true])
				for (const branched of [false, true]) cases.push({ kind, dated, branched })
		for (const c of cases) {
			const entry = (
				await db
					.insert(schema.lorebookEntries)
					.values({
						lorebookId: w.book.id,
						typeId: LOCATION_TYPE_ID,
						typeVersion: 1,
						position: ++n,
						title: `E${n}`,
						content: ".",
						fields: { category: "Rooms" }
					})
					.returning()
			)[0]!
			const [r] = await db
				.insert(schema.narrativeRelationships)
				.values({
					lorebookId: w.book.id,
					fromNodeId: w.aria.id,
					toEntryId: entry.id,
					relationshipType: c.kind,
					knowledgeKind: c.kind,
					status: "active",
					historyEntryId: c.dated ? w.loreDay.id : null,
					branchId: c.branched ? branch!.id : null
				})
				.returning()
			const sql = (await handTieInBook(asDb(), { lorebookId: w.book.id, castMemberId: w.aria.id, entryId: entry.id })) != null
			expect(sql, JSON.stringify(c)).toBe(
				isHandTie({ kind: r!.knowledgeKind, historyEntryId: r!.historyEntryId, branchId: r!.branchId })
			)
		}
	})
})

describe("Apply", () => {
	it("2 · moves the same row onto the session's line; the judge sees one tie; a second session on the same lorebook and the same line now knows the entry", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const held = await tie(w.session.id, w, { messageId: m.id })
		const { knowledgeTiesOfPair } = await knowledge()
		const pair = { castMemberId: w.aria.id, entryId: w.vault.id }
		expect(await knowledgeTiesOfPair(asDb(), { sessionId: w.memberSession.id, ...pair })).toEqual([])
		const done = await apply(w, { tieIds: [held.id] })
		expect(done.appliedTies).toEqual([held.id])
		expect(done.batch).toEqual(expect.any(String))
		const moved = (await row(held.id))!
		expect(moved).toMatchObject({ lorebookId: w.book.id, branchId: null, historyEntryId: null })
		const records = await applyRecords(w.session.id)
		expect(records).toHaveLength(1)
		expect(records[0]).toMatchObject({
			subjectKind: "relationship",
			subjectId: held.id,
			messageId: m.id,
			cause: {
				knowledgeTie: true,
				title: "Aria was told about The Vault",
				moved: { lorebookId: await ownOf(w.session.id), branchId: null, historyEntryId: null }
			}
		})
		expect(await tieItems(w)).toEqual([])
		expect(await knowledgeTiesOfPair(asDb(), { sessionId: w.session.id, ...pair })).toEqual([
			expect.objectContaining({ id: held.id, inNotes: false, lorebookId: w.book.id })
		])
		expect(await knowledgeTiesOfPair(asDb(), { sessionId: w.memberSession.id, ...pair })).toEqual([
			expect.objectContaining({ id: held.id, branchId: null })
		])
		const batches = await (await lore()).appliedBatchesOf(asDb(), w.session.id)
		expect(batches[0]!.items).toEqual([
			expect.objectContaining({ kind: "knowledge-tie", tieId: held.id, entryId: w.vault.id, title: "Aria was told about The Vault" })
		])
		expect(batches[0]!.count).toBe(1)
	})

	it("3 · a dated tie lands on the lorebook's day of that date, or undated without one", async () => {
		const w = await world()
		const withDay = await ownDay(w.session.id, DAY, null)
		const noDay = await ownDay(w.session.id, OTHER_DAY, null)
		const a = await tie(w.session.id, w, { historyEntryId: withDay.id })
		const b = await tie(w.session.id, w, { kind: "has_been_there", historyEntryId: noDay.id })
		const done = await apply(w, { tieIds: [a.id, b.id] })
		expect(done.appliedTies).toEqual([a.id, b.id])
		expect((await row(a.id))!.historyEntryId).toBe(w.loreDay.id)
		expect((await row(b.id))!.historyEntryId).toBeNull()
	})

	it("4 · a hand tie in the lorebook supersedes it: not listed, deleted by any Apply, never caps the settle", async () => {
		const w = await world()
		const mTie = await messageIn(w.session.id)
		const mEntry = await messageIn(w.session.id)
		const held = await tie(w.session.id, w, { messageId: mTie.id })
		await (await knowledge()).setHandKnowledgeTie(asDb(), {
			userId: w.user.id,
			lorebookId: w.book.id,
			castMemberId: w.aria.id,
			entryId: w.vault.id,
			hand: "kept_from"
		})
		expect(await tieItems(w)).toEqual([])
		const fresh = await ownEntry(w.session.id, "Cellar", { sourceMessageId: mEntry.id })
		const done = await apply(w, { entryIds: [fresh.id] })
		expect(done.supersededTies).toEqual([held.id])
		expect(await row(held.id)).toBeUndefined()
		expect(done.settled).toMatchObject({ moved: true, settledMessageId: mEntry.id })
		// Any Apply, even one naming nothing, deletes it.
		const second = await tie(w.session.id, w, { messageId: null })
		const again = await apply(w, { tieIds: [] })
		expect(again.supersededTies).toEqual([second.id])
		expect(await row(second.id)).toBeUndefined()
	})

	it("5 · a live twin in the lorebook: the held copy is deleted (droppedTies); a resolved twin does not count", async () => {
		const w = await world()
		await tie(w.session.id, w, { lorebookId: w.book.id })
		const held = await tie(w.session.id, w)
		const done = await apply(w)
		expect(done.droppedTies).toEqual([held.id])
		expect(done.appliedTies).toEqual([])
		expect(await row(held.id)).toBeUndefined()

		const v = await world()
		await tie(v.session.id, v, { lorebookId: v.book.id, status: "resolved" })
		const kept = await tie(v.session.id, v)
		const moved = await apply(v)
		expect(moved.appliedTies).toEqual([kept.id])
		expect((await row(kept.id))!.lorebookId).toBe(v.book.id)
	})

	it("12 · on someone else's lorebook nobody applies: the session's owner may not write it, the lorebook's owner is not the session's owner", async () => {
		const w = await world()
		await tie(w.memberSession.id, w)
		await expect(apply(w, {}, w.member.id, w.memberSession.id)).rejects.toThrow(
			"Only the lorebook's owner can apply changes to it."
		)
		await expect(apply(w, {}, w.user.id, w.memberSession.id)).rejects.toThrow(
			"Only the session's owner can apply its changes or take them back."
		)
		expect((await tieItems(w, w.memberSession.id)).length).toBe(1)
	})
})

describe("Take back", () => {
	it("6 · a taken-back Apply returns the tie to the notes with its dating, listed again; refused when the moved tie is gone", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const day = await ownDay(w.session.id, OTHER_DAY, null)
		const held = await tie(w.session.id, w, { messageId: m.id, historyEntryId: day.id })
		const own = await ownOf(w.session.id)
		const done = await apply(w, { tieIds: [held.id] })
		expect((await row(held.id))!.lorebookId).toBe(w.book.id)
		await (await lore()).takeBackApply(asDb(), { batch: done.batch!, userId: w.user.id, sessionId: w.session.id })
		expect(await row(held.id)).toMatchObject({ lorebookId: own, branchId: null, historyEntryId: day.id })
		expect(await applyRecords(w.session.id)).toEqual([])
		expect((await tieItems(w)).map((i) => (i as { tieId: number }).tieId)).toEqual([held.id])

		const v = await world()
		const gone = await tie(v.session.id, v)
		const second = await apply(v)
		await db.delete(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.id, gone.id))
		await expect(
			(await lore()).takeBackApply(asDb(), { batch: second.batch!, userId: v.user.id })
		).rejects.toThrow(
			'The knowledge tie "Aria was told about The Vault" is no longer in the lorebook, so this can\'t be taken back.'
		)
	})

	it("7 · Back before Apply removes the held tie; after Apply, Back of that message leaves it in the lorebook", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const held = await tie(w.session.id, w, { messageId: m.id })
		const { retractImprints } = await import("$lib/server/lorebooks/imprints")
		await retractImprints(asDb(), { messageIds: [m.id] })
		expect(await row(held.id)).toBeUndefined()

		const v = await world()
		const m2 = await messageIn(v.session.id)
		const kept = await tie(v.session.id, v, { messageId: m2.id })
		await apply(v)
		const { SETTLED_SENTENCE } = await import("$lib/server/sessions/settle")
		await expect(retractImprints(asDb(), { messageIds: [m2.id] })).rejects.toThrow(SETTLED_SENTENCE)
		expect((await row(kept.id))!.lorebookId).toBe(v.book.id)

		// Not settled (an earlier item still waits): Back of the tie's turn runs, and the applied tie stays the lorebook's.
		const u = await world()
		const mEarly = await messageIn(u.session.id)
		const mTie = await messageIn(u.session.id)
		await ownEntry(u.session.id, "Cellar", { sourceMessageId: mEarly.id })
		const applied = await tie(u.session.id, u, { messageId: mTie.id })
		const done = await apply(u, { tieIds: [applied.id] })
		expect(done.appliedTies).toEqual([applied.id])
		expect(done.settled?.settledMessageId ?? null).not.toBe(mTie.id)
		await retractImprints(asDb(), { messageIds: [mTie.id] })
		expect((await row(applied.id))!.lorebookId).toBe(u.book.id)
	})
})

describe("settle line", () => {
	it("8 · a tie still held stops Apply's settle before its anchor", async () => {
		const w = await world()
		const mTie = await messageIn(w.session.id)
		const mEntry = await messageIn(w.session.id)
		await tie(w.session.id, w, { messageId: mTie.id })
		const fresh = await ownEntry(w.session.id, "Cellar", { sourceMessageId: mEntry.id })
		const done = await apply(w, { entryIds: [fresh.id] })
		expect(done.settled).toMatchObject({ moved: true, settledMessageId: mTie.id - 1 })
	})
})

describe("automatic Apply", () => {
	it("9 · a scene close under Full on the owner's book carries a tie written earlier to the notes", async () => {
		const w = await world("full")
		const m0 = await messageIn(w.session.id)
		const m1 = await messageIn(w.session.id)
		const held = await tie(w.session.id, w, { messageId: m0.id })
		const [scene] = await db
			.insert(schema.scenes)
			.values({
				sessionId: w.session.id,
				lorebookId: w.book.id,
				channel: "main",
				openedAtMessageId: m0.id,
				closedAtMessageId: m1.id
			})
			.returning()
		const done = await (await lore()).applyHeldAutomatically(asDb(), {
			sessionId: w.session.id,
			automatic: "scene-close",
			sceneId: scene!.id
		})
		expect(done!.appliedTies).toEqual([held.id])
		expect((await row(held.id))!.lorebookId).toBe(w.book.id)
		const [record] = await applyRecords(w.session.id)
		expect(record).toMatchObject({
			subjectId: held.id,
			cause: { automatic: "scene-close", sceneId: scene!.id, knowledgeTie: true }
		})
		expect((record!.cause as { by?: unknown }).by).toBeUndefined()
	})
})
