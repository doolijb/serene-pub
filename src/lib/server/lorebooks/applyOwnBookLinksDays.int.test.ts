/**
 * 🚧 The notes' links and history paragraphs: a link between the lorebook's own
 * entries and members is listed, applied and taken back on its own; a history
 * day of a date the lorebook holds is a paragraph on the lorebook's day
 * (merged, everything it dated pointed at the lorebook's day, taken back with
 * the own day's id). Own-book rows are inserted directly; Apply, the list and
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-apply-links-days-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const DAY = { year: 5, month: 2, day: 3 }
const OTHER_DAY = { year: 5, month: 2, day: 9 }

/**
 * The lorebook's owner reads it under Review (own-book route) with a session
 * of their own; `member` is a second person's session on the same lorebook.
 */
async function world(mode: "review" | "full" = "review") {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `applylinks-${suffix}`)
	const member = await createTestUser(db, `applylinks-m-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: mode })
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
	const gate = await place("The Gate")
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
	return {
		user,
		member,
		book: book!,
		vault,
		gate,
		aria: aria!,
		loreDay: loreDay!,
		session,
		memberSession,
		suffix
	}
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
	await db
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId, role: "assistant" })
	return legacy!
}

const ownOf = async (sessionId: number) =>
	(await (await lore()).ownBookFor(asDb(), sessionId)).id

/** An own-book history day. */
async function ownDay(
	sessionId: number,
	date: { year: number; month: number; day: number },
	content: string,
	sourceMessageId: number | null
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: await ownOf(sessionId),
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: `Own day ${n}`,
			content,
			fields: date,
			sourceMessageId
		})
		.returning()
	return row!
}

async function ownEntry(
	sessionId: number,
	title: string,
	over: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
) {
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

/** A link of the session's notes; with a message, its made-row imprint. */
async function ownLink(
	sessionId: number,
	ends: {
		fromEntryId?: number
		fromNodeId?: number
		toEntryId?: number
		toNodeId?: number
	},
	over: Partial<typeof schema.narrativeRelationships.$inferInsert> = {},
	messageId: number | null = null
) {
	const lorebookId = await ownOf(sessionId)
	const [row] = await db
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			fromEntryId: ends.fromEntryId ?? null,
			fromNodeId: ends.fromNodeId ?? null,
			toEntryId: ends.toEntryId ?? null,
			toNodeId: ends.toNodeId ?? null,
			relationshipType: "leads to",
			...over
		})
		.returning()
	if (messageId != null)
		await db.insert(schema.loreImprints).values({
			sessionId,
			messageId,
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

const linkRow = async (id: number) =>
	(
		await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, id))
	)[0]
const entryRow = async (id: number) =>
	(
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]
const applyRecords = (sessionId: number) =>
	db
		.select()
		.from(schema.loreImprints)
		.where(
			and(
				eq(schema.loreImprints.sessionId, sessionId),
				eq(schema.loreImprints.origin, "apply")
			)
		)
		.orderBy(schema.loreImprints.id)

const apply = async (
	w: World,
	more: Record<string, unknown> = {},
	userId = w.user.id
) =>
	(await lore()).applyOverlayItems(asDb(), {
		sessionId: w.session.id,
		userId,
		...more
	})

const items = async (w: World, sessionId = w.session.id) =>
	(await lore()).overlayItemsOf(asDb(), sessionId)

describe("the list", () => {
	it("lists a lorebook-lorebook link and a lorebook-entry-lorebook-member link; not ties, not links with an end in the notes", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const plain = await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{},
			m.id
		)
		const toMember = await ownLink(
			w.session.id,
			{ fromEntryId: w.gate.id, toNodeId: w.aria.id },
			{ relationshipType: "guarded by" }
		)
		await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{ relationshipType: "tied", rulesRunId: "run-1" }
		)
		const inNotes = await ownEntry(w.session.id, "Cellar")
		await ownLink(w.session.id, {
			fromEntryId: inNotes.id,
			toEntryId: w.gate.id
		})
		const ownMember = (
			await db
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: await ownOf(w.session.id),
					binding: "{{char:1}}",
					name: "Notes-only"
				})
				.returning()
		)[0]!
		await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toNodeId: ownMember.id },
			{ relationshipType: "owned by" }
		)

		const links = (await items(w)).filter((i) => i.kind === "link") as any[]
		expect(links.map((l) => l.linkId)).toEqual([plain.id, toMember.id])
		expect(links[0]).toEqual({
			kind: "link",
			linkId: plain.id,
			entryId: w.vault.id,
			typeId: LOCATION_TYPE_ID,
			title: "The Vault leads to The Gate",
			sourceMessageId: m.id
		})
		expect(links[1]).toMatchObject({
			entryId: w.gate.id,
			title: "The Gate guarded by Aria",
			sourceMessageId: null
		})
		// A member's session lists the same.
		expect(
			(await items(w, w.memberSession.id)).filter(
				(i) => i.kind === "link"
			)
		).toEqual([])
	})

	it("a day of a date the lorebook holds is an entry change with notesEntryId; another date is an entry", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const held = await ownDay(w.session.id, DAY, "The bell rang.", m.id)
		const fresh = await ownDay(w.session.id, OTHER_DAY, "Quiet.", m.id)
		const listed = await items(w)
		const change = listed.find((i) => i.kind === "entry-change") as any
		expect(change).toMatchObject({
			kind: "entry-change",
			entryId: w.loreDay.id,
			notesEntryId: held.id,
			typeId: HISTORY_TYPE_ID,
			title: "The third of Frost",
			sourceMessageId: m.id,
			conflict: null
		})
		expect(change.amendmentId).toBeUndefined()
		expect(change.changes).toEqual([
			{
				field: "content",
				label: expect.any(String),
				before: "Lore day.",
				after: "Lore day.\n\nThe bell rang."
			}
		])
		expect(
			listed.filter((i) => i.kind === "entry").map((i: any) => i.entryId)
		).toEqual([fresh.id])
		expect(listed.some((i: any) => i.entryId === held.id)).toBe(false)
	})
})

describe("Apply: a merged day", () => {
	it("appends the paragraph, repoints everything the day dated, files one record, deletes the own day", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const own = await ownDay(w.session.id, DAY, "The bell rang.", m.id)
		const link = await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{ historyEntryId: own.id },
			m.id
		)
		const [amendment] = await db
			.insert(schema.entryAmendments)
			.values({
				lorebookId: await ownOf(w.session.id),
				entryId: w.vault.id,
				branchId: null,
				year: DAY.year,
				month: DAY.month,
				day: DAY.day,
				fields: { content: "Open." },
				base: null,
				historyEntryId: own.id
			})
			.returning()
		const [value] = await db
			.insert(schema.attributeValues)
			.values({
				ownerKind: "location",
				ownerId: w.vault.id,
				slotId: "core:slot/hp@1",
				value: { v: 3 },
				sessionId: w.session.id,
				historyEntryId: own.id
			})
			.returning()
		const [scene] = await db
			.insert(schema.scenes)
			.values({
				sessionId: w.session.id,
				lorebookId: await ownOf(w.session.id),
				historyEntryId: own.id,
				name: "The bell"
			})
			.returning()

		const done = await apply(w)
		expect(done.mergedDays).toEqual([own.id])
		expect(done.appliedLinks).toEqual([link.id])
		expect(done.batch).not.toBeNull()
		expect((await entryRow(w.loreDay.id))!.content).toBe(
			"Lore day.\n\nThe bell rang."
		)
		expect(await entryRow(own.id)).toBeUndefined()
		// Never a second entry for the date.
		const days = await db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID))
		expect(days.some((d) => d.id === own.id)).toBe(false)
		expect((await linkRow(link.id))!).toMatchObject({
			lorebookId: w.book.id,
			historyEntryId: w.loreDay.id
		})
		const [a2] = await db
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, amendment!.id))
		expect(a2!.historyEntryId).toBe(w.loreDay.id)
		const [v2] = await db
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, value!.id))
		expect(v2!.historyEntryId).toBe(w.loreDay.id)
		const [s2] = await db
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, scene!.id))
		expect(s2!.historyEntryId).toBe(w.loreDay.id)

		const merged = (await applyRecords(w.session.id)).find(
			(r) => r.field != null
		)!
		expect(merged).toMatchObject({
			subjectKind: "entry",
			subjectId: w.loreDay.id,
			field: "content",
			messageId: m.id,
			batch: done.batch
		})
		const cause = merged.cause as any
		expect(cause.by).toEqual({ userId: w.user.id })
		expect(cause.sessionId).toBe(w.session.id)
		expect(cause.merged.notesEntry.id).toBe(own.id)
		expect(cause.merged.repointed).toMatchObject({
			narrative_relationships: [link.id],
			entry_amendments: [amendment!.id],
			attribute_values: [value!.id],
			scenes: [scene!.id]
		})
	})

	it("a day the lorebook does not hold moves as a new entry", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const fresh = await ownDay(w.session.id, OTHER_DAY, "Quiet.", m.id)
		const done = await apply(w)
		expect(done.applied).toEqual([fresh.id])
		expect(done.mergedDays).toEqual([])
		expect((await entryRow(fresh.id))!.lorebookId).toBe(w.book.id)
	})

	it("is the lorebook owner's alone", async () => {
		const w = await world()
		const m = await messageIn(w.memberSession.id)
		await ownDay(w.memberSession.id, DAY, "Theirs.", m.id)
		await expect(
			(await lore()).applyOverlayItems(asDb(), {
				sessionId: w.memberSession.id,
				userId: w.member.id
			})
		).rejects.toThrow("Only the lorebook's owner can apply changes to it.")
		const done = await (
			await lore()
		).applyOverlayItems(asDb(), {
			sessionId: w.memberSession.id,
			userId: w.user.id
		})
		expect(done.mergedDays).toHaveLength(1)
		expect((await entryRow(w.loreDay.id))!.content).toBe(
			"Lore day.\n\nTheirs."
		)
	})

	it("keeps the day held when the repoint would make a link say the same thing twice", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const own = await ownDay(w.session.id, DAY, "The bell rang.", m.id)
		const ends = { fromEntryId: w.vault.id, toEntryId: w.gate.id }
		await ownLink(w.session.id, ends, { historyEntryId: own.id })
		await ownLink(w.session.id, ends, { historyEntryId: w.loreDay.id })
		const done = await apply(w, { entryIds: [own.id] })
		expect(done.mergedDays).toEqual([])
		expect(done.heldDays).toEqual([
			{ notesEntryId: own.id, reason: expect.stringContaining("twice") }
		])
		expect(await entryRow(own.id)).toBeDefined()
		expect((await entryRow(w.loreDay.id))!.content).toBe("Lore day.")
	})

	it("keeps the day held when an entry of the notes is filed under it: deleting the day would take the entry too", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const own = await ownDay(w.session.id, DAY, "The bell rang.", m.id)
		const child = await ownEntry(w.session.id, "Bell Tower", {
			anchorEntryId: own.id
		})
		// Apply all: the child is selected too, and must neither vanish nor move without its day.
		const done = await apply(w)
		expect(done.mergedDays).toEqual([])
		expect(done.heldDays).toEqual([
			{
				notesEntryId: own.id,
				reason: expect.stringContaining("are filed under")
			}
		])
		expect(await entryRow(own.id)).toBeDefined()
		expect(await entryRow(child.id)).toBeDefined()
		expect((await entryRow(w.loreDay.id))!.content).toBe("Lore day.")
	})
})

describe("Apply: links", () => {
	it("moves a standalone link to the lorebook's line with a record; a tie row never moves", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const link = await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{},
			m.id
		)
		const tie = await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{ relationshipType: "tied", rulesRunId: "run-1" }
		)
		const own = await ownOf(w.session.id)
		const done = await apply(w)
		expect(done.appliedLinks).toEqual([link.id])
		expect(await linkRow(link.id)).toMatchObject({
			lorebookId: w.book.id,
			branchId: null
		})
		expect((await linkRow(tie.id))!.lorebookId).toBe(own)
		const [record] = await applyRecords(w.session.id)
		expect(record).toMatchObject({
			subjectKind: "relationship",
			subjectId: link.id,
			field: null,
			origin: "apply",
			messageId: m.id,
			batch: done.batch
		})
		expect((record!.cause as any).moved).toEqual({
			lorebookId: own,
			branchId: null,
			historyEntryId: null
		})
		expect((record!.cause as any).sessionId).toBe(w.session.id)
	})

	it("a riding link with a lorebook-member end moves with its entry; an entry filed under a lorebook member keeps its binding", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const keep = await ownEntry(w.session.id, "Cellar", {
			sourceMessageId: m.id,
			anchorBindingId: w.aria.id
		})
		const riding = await ownLink(w.session.id, {
			fromEntryId: keep.id,
			toNodeId: w.aria.id
		})
		const ownMember = (
			await db
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: await ownOf(w.session.id),
					binding: "{{char:1}}",
					name: "Notes-only"
				})
				.returning()
		)[0]!
		const staying = await ownLink(w.session.id, {
			fromEntryId: keep.id,
			toNodeId: ownMember.id
		})
		const own = await ownOf(w.session.id)
		const done = await apply(w)
		expect(done.applied).toEqual([keep.id])
		expect(done.appliedLinks).toEqual([])
		expect((await linkRow(riding.id))!.lorebookId).toBe(w.book.id)
		// An own-book member end stays in the notes.
		expect((await linkRow(staying.id))!.lorebookId).toBe(own)
		expect((await entryRow(keep.id))!.anchorBindingId).toBe(w.aria.id)
	})

	it("an entry filed under an own-book member loses the binding, as before", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const ownMember = (
			await db
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: await ownOf(w.session.id),
					binding: "{{char:1}}",
					name: "Notes-only"
				})
				.returning()
		)[0]!
		const keep = await ownEntry(w.session.id, "Cellar", {
			sourceMessageId: m.id,
			anchorBindingId: ownMember.id
		})
		await apply(w)
		expect((await entryRow(keep.id))!.anchorBindingId).toBeNull()
	})

	it("deletes a link the lorebook already says, and files nothing for it", async () => {
		const w = await world()
		const ends = { fromEntryId: w.vault.id, toEntryId: w.gate.id }
		const [said] = await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: w.book.id,
				...ends,
				relationshipType: "leads to"
			})
			.returning()
		const twin = await ownLink(w.session.id, ends)
		const done = await apply(w)
		expect(done.droppedLinks).toEqual([twin.id])
		expect(done.appliedLinks).toEqual([])
		expect(await linkRow(twin.id)).toBeUndefined()
		expect(await linkRow(said!.id)).toBeDefined()
		expect(await applyRecords(w.session.id)).toEqual([])
		expect(done.batch).toBeNull()
	})

	it("re-dates a moving link dated by a day that stays in the notes", async () => {
		const w = await world()
		const stays = await ownDay(w.session.id, DAY, "Stays.", null)
		const stays2 = await ownDay(w.session.id, OTHER_DAY, "Stays too.", null)
		const toLore = await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{ historyEntryId: stays.id }
		)
		const toNone = await ownLink(
			w.session.id,
			{ fromEntryId: w.gate.id, toEntryId: w.vault.id },
			{ historyEntryId: stays2.id }
		)
		const done = await apply(w, { linkIds: [toLore.id, toNone.id] })
		expect(done.appliedLinks).toEqual([toLore.id, toNone.id])
		expect((await linkRow(toLore.id))!.historyEntryId).toBe(w.loreDay.id)
		expect((await linkRow(toNone.id))!.historyEntryId).toBeNull()
		const records = await applyRecords(w.session.id)
		expect(
			records.map((r) => (r.cause as any).moved.historyEntryId)
		).toEqual([stays.id, stays2.id])
		expect(await entryRow(stays.id)).toBeDefined()
	})
})

describe("selection", () => {
	it("linkIds alone moves only those links; entryIds alone moves entries and paragraphs, not links", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const l1 = await ownLink(w.session.id, {
			fromEntryId: w.vault.id,
			toEntryId: w.gate.id
		})
		const l2 = await ownLink(
			w.session.id,
			{ fromEntryId: w.gate.id, toEntryId: w.vault.id },
			{ relationshipType: "opens on" }
		)
		const paragraph = await ownDay(w.session.id, DAY, "Rang.", m.id)
		const fresh = await ownEntry(w.session.id, "Cellar", {
			sourceMessageId: m.id
		})
		const own = await ownOf(w.session.id)

		const first = await apply(w, { linkIds: [l1.id] })
		expect(first.appliedLinks).toEqual([l1.id])
		expect(first.applied).toEqual([])
		expect(first.mergedDays).toEqual([])
		expect((await linkRow(l2.id))!.lorebookId).toBe(own)

		const second = await apply(w, { entryIds: [paragraph.id, fresh.id] })
		expect(second.mergedDays).toEqual([paragraph.id])
		expect(second.applied).toEqual([fresh.id])
		expect(second.appliedLinks).toEqual([])
		expect((await linkRow(l2.id))!.lorebookId).toBe(own)

		const rest = await apply(w)
		expect(rest.appliedLinks).toEqual([l2.id])
	})

	it("an automatic Apply includes links and paragraphs in range", async () => {
		const w = await world("full")
		const m1 = await messageIn(w.session.id)
		const m2 = await messageIn(w.session.id)
		const early = await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{},
			m1.id
		)
		const late = await ownLink(
			w.session.id,
			{ fromEntryId: w.gate.id, toEntryId: w.vault.id },
			{ relationshipType: "opens on" },
			m2.id
		)
		const paragraph = await ownDay(w.session.id, DAY, "Rang.", m1.id)
		const done = await (
			await lore()
		).applyHeldAutomatically(asDb(), {
			sessionId: w.session.id,
			automatic: "close-out",
			before: m2.id
		})
		expect(done).not.toBeNull()
		expect(done!.appliedLinks).toEqual([early.id])
		expect(done!.mergedDays).toEqual([paragraph.id])
		expect((await linkRow(late.id))!.lorebookId).not.toBe(w.book.id)
		const records = await applyRecords(w.session.id)
		expect(
			records.every((r) => (r.cause as any).automatic === "close-out")
		).toBe(true)
	})
})

describe("settle line", () => {
	it("a link still held stops the settle before its anchor", async () => {
		const w = await world()
		const mLink = await messageIn(w.session.id)
		const mEntry = await messageIn(w.session.id)
		await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{},
			mLink.id
		)
		const fresh = await ownEntry(w.session.id, "Cellar", {
			sourceMessageId: mEntry.id
		})
		const done = await apply(w, { entryIds: [fresh.id] })
		expect(done.settled).toMatchObject({
			moved: true,
			settledMessageId: mLink.id - 1
		})
	})

	it("applied links and merged days settle through their anchors", async () => {
		const w = await world()
		const m1 = await messageIn(w.session.id)
		const m2 = await messageIn(w.session.id)
		await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{},
			m1.id
		)
		await ownDay(w.session.id, DAY, "Rang.", m2.id)
		const done = await apply(w)
		expect(done.settled).toMatchObject({
			moved: true,
			settledMessageId: m2.id
		})
	})
})

describe("Take back", () => {
	it("a moved link returns to the notes with its dating", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const stays = await ownDay(w.session.id, DAY, "Stays.", null)
		const link = await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{ historyEntryId: stays.id },
			m.id
		)
		const own = await ownOf(w.session.id)
		const done = await apply(w, { linkIds: [link.id] })
		expect((await linkRow(link.id))!.lorebookId).toBe(w.book.id)
		await (
			await lore()
		).takeBackApply(asDb(), {
			batch: done.batch!,
			userId: w.user.id,
			sessionId: w.session.id
		})
		expect(await linkRow(link.id)).toMatchObject({
			lorebookId: own,
			branchId: null,
			historyEntryId: stays.id
		})
		expect(await applyRecords(w.session.id)).toEqual([])
	})

	it("refuses when the moved link is gone", async () => {
		const w = await world()
		const link = await ownLink(w.session.id, {
			fromEntryId: w.vault.id,
			toEntryId: w.gate.id
		})
		const done = await apply(w)
		await db
			.delete(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, link.id))
		await expect(
			(await lore()).takeBackApply(asDb(), {
				batch: done.batch!,
				userId: w.user.id
			})
		).rejects.toThrow(
			"The link The Vault leads to The Gate is no longer in the lorebook, so this can't be taken back."
		)
	})

	async function merged() {
		const w = await world()
		const m = await messageIn(w.session.id)
		const own = await ownDay(w.session.id, DAY, "The bell rang.", m.id)
		const link = await ownLink(
			w.session.id,
			{ fromEntryId: w.vault.id, toEntryId: w.gate.id },
			{ historyEntryId: own.id },
			m.id
		)
		const [scene] = await db
			.insert(schema.scenes)
			.values({
				sessionId: w.session.id,
				lorebookId: await ownOf(w.session.id),
				historyEntryId: own.id,
				name: "The bell"
			})
			.returning()
		const done = await apply(w)
		return { w, m, own, link, scene: scene!, done }
	}

	it("a merged day returns while the paragraph is last: own day with its id, repoints undone, paragraph off", async () => {
		const { w, own, link, scene, done } = await merged()
		await (
			await lore()
		).takeBackApply(asDb(), {
			batch: done.batch!,
			userId: w.user.id,
			sessionId: w.session.id
		})
		const back = (await entryRow(own.id))!
		expect(back).toMatchObject({
			id: own.id,
			lorebookId: own.lorebookId,
			content: "The bell rang.",
			title: own.title,
			sourceMessageId: own.sourceMessageId,
			fields: DAY
		})
		expect((await entryRow(w.loreDay.id))!.content).toBe("Lore day.")
		expect(await linkRow(link.id)).toMatchObject({
			lorebookId: own.lorebookId,
			historyEntryId: own.id
		})
		const [s2] = await db
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, scene.id))
		expect(s2!.historyEntryId).toBe(own.id)
		expect(await applyRecords(w.session.id)).toEqual([])
		// Listed again as the paragraph it was.
		expect(
			(await items(w)).some(
				(i: any) =>
					i.kind === "entry-change" && i.notesEntryId === own.id
			)
		).toBe(true)
	})

	it("a merged day refuses once something was appended after the paragraph", async () => {
		const { w, done } = await merged()
		await db
			.update(schema.lorebookEntries)
			.set({ content: "Lore day.\n\nThe bell rang.\n\nAnd then more." })
			.where(eq(schema.lorebookEntries.id, w.loreDay.id))
		await expect(
			(await lore()).takeBackApply(asDb(), {
				batch: done.batch!,
				userId: w.user.id
			})
		).rejects.toThrow(
			"Something was written after this session's paragraph on The third of Frost, so this can't be taken back."
		)
		// All or nothing: the link stayed where Apply put it.
		expect((await applyRecords(w.session.id)).length).toBeGreaterThan(0)
	})

	it("the applied list reads a merged day as an entry change and a standalone link as a link; riding links do not count", async () => {
		const { w, done, link } = await merged()
		const keep = await ownEntry(w.session.id, "Cellar")
		await ownLink(w.session.id, {
			fromEntryId: keep.id,
			toNodeId: w.aria.id
		})
		const second = await apply(w)
		const batches = await (
			await lore()
		).appliedBatchesOf(asDb(), w.session.id)
		const first = batches.find((b) => b.batch === done.batch)!
		expect(first.count).toBe(2)
		expect(first.items).toContainEqual({
			kind: "link",
			linkId: link.id,
			entryId: w.vault.id,
			title: "The Vault leads to The Gate"
		})
		const change = first.items.find((i) => i.kind === "entry-change")!
		expect(change).toMatchObject({
			entryId: w.loreDay.id,
			title: "The third of Frost"
		})
		expect(change.changes).toEqual([
			{
				field: "content",
				label: expect.any(String),
				before: "Lore day.",
				after: "Lore day.\n\nThe bell rang."
			}
		])
		const rode = batches.find((b) => b.batch === second.batch)!
		expect(rode.count).toBe(1)
		expect(rode.items.map((i) => i.kind)).toEqual(["entry"])
	})
})
