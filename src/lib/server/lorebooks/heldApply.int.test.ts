/**
 * 🚧 A held change is listed, applied (folded, recorded) and can be taken back
 * (Stage B thin slice). Held changes are made through the real outlet
 * (`update-lore-entry@1`); Apply, the conflict check and `takeBackApply` are
 * the server functions in `ownBook.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const UPDATE = {
	key: "change",
	definitionId: "core:outlet/update-lore-entry"
} as any
const asDb = () => db as unknown as Db

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-held-apply-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(clock?: { year: number; month: number; day: number }) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `heldapply-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [vault] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "The Vault",
			content: "Locked.",
			fields: { category: "Rooms" }
		})
		.returning()
	const session = await sessionOn(user.id, book!.id, clock)
	return { user, book: book!, vault: vault!, session, suffix }
}

async function sessionOn(
	userId: number,
	lorebookId: number,
	clock?: { year: number; month: number; day: number }
) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId,
			...(clock
				? {
						storyClockYear: clock.year,
						storyClockMonth: clock.month,
						storyClockDay: clock.day
					}
				: {})
		})
		.returning()
	// Its own book, made at birth as a session's is.
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
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

const messageIn = async (
	sessionId: number,
	role: "user" | "assistant" = "assistant"
) => {
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role, content: "…" })
		.returning()
	await db.insert(schema.messages).values({ id: legacy!.id, sessionId, role })
	return legacy!
}

/** A session's turn changes the entry through the real outlet; returns the turn's message. */
async function change(
	w: { user: { id: number }; session: { id: number } },
	entryId: number,
	data: Record<string, unknown>
) {
	const m = await messageIn(w.session.id)
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(asDb(), {
		sessionId: w.session.id,
		userId: w.user.id,
		runId: `run-${++n}`
	})
	await host.commit!({ entry: entryId, ...data }, UPDATE)
	return m
}

const stored = async (id: number) =>
	(
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!

const ownBookId = async (sessionId: number) =>
	(
		await (
			await import("$lib/server/lorebooks/ownBook")
		).ownBookFor(asDb(), sessionId)
	).id

const heldRows = async (sessionId: number) =>
	db
		.select()
		.from(schema.entryAmendments)
		.where(
			and(
				eq(
					schema.entryAmendments.lorebookId,
					await ownBookId(sessionId)
				),
				isNotNull(schema.entryAmendments.base)
			)
		)
		.orderBy(schema.entryAmendments.id)

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

async function sessionRead(
	sessionId: number,
	entryId: number
): Promise<Record<string, any>> {
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entryOverlaysFor, entryAt } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const row = await stored(entryId)
	const reading = (await sessionReadingOf(asDb(), sessionId))!
	const overlays = await entryOverlaysFor(asDb(), row.lorebookId, reading, [
		entryId
	])
	return entryAt(toEntryRow(row), overlays, reading) as any
}

/** The entry as the lorebook's own reading has it, at a moment. */
async function bookRead(
	entryId: number,
	moment: { year: number; month: number; day: number } | null = null
) {
	const { entryOverlaysFor, entryAt, MAIN_HEAD } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const row = await stored(entryId)
	const reading = { ...MAIN_HEAD, moment }
	const overlays = await entryOverlaysFor(asDb(), row.lorebookId, reading, [
		entryId
	])
	return entryAt(toEntryRow(row), overlays, reading) as any
}

const lore = () => import("$lib/server/lorebooks/ownBook")

describe("a held change: listed, conflict-checked, applied, taken back", () => {
	it("lists it with labels, before and after; every item has a kind; the conflict is null while clean", async () => {
		const w = await world()
		const { overlayItemsOf, ownBookFor } = await lore()
		const notes = await ownBookFor(asDb(), w.session.id)
		const [made] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: notes.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "The Nook",
				content: "…"
			})
			.returning()
		const m = await change(w, w.vault.id, {
			name: "The Strongroom",
			content: "Sealed."
		})
		const items = await overlayItemsOf(asDb(), w.session.id)
		expect(items.map((i) => i.kind)).toEqual(["entry", "entry-change"])
		expect(items[0]).toMatchObject({
			kind: "entry",
			entryId: made!.id,
			title: "The Nook"
		})
		const [held] = await heldRows(w.session.id)
		expect(items[1]).toEqual({
			kind: "entry-change",
			amendmentId: held!.id,
			entryId: w.vault.id,
			typeId: LOCATION_TYPE_ID,
			title: "The Strongroom",
			sourceMessageId: m.id,
			changes: [
				{
					field: "name",
					label: "Name",
					before: "The Vault",
					after: "The Strongroom"
				},
				{
					field: "content",
					label: "Content",
					before: "Locked.",
					after: "Sealed."
				}
			],
			conflict: null
		})
	})

	it("two sessions hold different changes to one field; the first applies cleanly; the second is then a conflict and stays held", async () => {
		const w = await world()
		const other = await sessionOn(w.user.id, w.book.id)
		const m1 = await change(w, w.vault.id, { content: "Sealed." })
		await change({ user: w.user, session: other }, w.vault.id, {
			content: "Open."
		})
		expect((await sessionRead(w.session.id, w.vault.id)).content).toBe(
			"Sealed."
		)
		expect((await sessionRead(other.id, w.vault.id)).content).toBe("Open.")
		const { applyOverlayItems, overlayItemsOf } = await lore()
		const [held] = await heldRows(w.session.id)

		const done = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			amendmentIds: [held!.id]
		})
		expect(done).toMatchObject({
			lorebookId: w.book.id,
			applied: [],
			appliedChanges: [held!.id],
			stillHeld: []
		})
		expect(done.batch).toEqual(expect.any(String))
		expect((await stored(w.vault.id)).content).toBe("Sealed.")
		expect(await heldRows(w.session.id)).toEqual([])
		const records = await applyRecords(w.session.id)
		expect(records).toHaveLength(1)
		expect(records[0]).toMatchObject({
			origin: "apply",
			batch: done.batch,
			sessionId: w.session.id,
			messageId: m1.id,
			runId: null,
			lorebookId: w.book.id,
			subjectKind: "entry",
			subjectId: w.vault.id,
			field: "content",
			status: "standing",
			before: { v: "Locked." },
			after: { v: "Sealed." },
			cause: {
				by: { userId: w.user.id },
				sessionId: w.session.id,
				messageId: m1.id,
				amendmentId: held!.id,
				key: "content"
			}
		})
		// The other session's own change is kept, and is now a conflict.
		const conflict =
			"Content has changed in the lorebook since this session changed it."
		const [item] = await overlayItemsOf(asDb(), other.id)
		expect(item).toMatchObject({ kind: "entry-change", conflict })
		const [theirs] = await heldRows(other.id)
		const again = await applyOverlayItems(asDb(), {
			sessionId: other.id,
			userId: w.user.id
		})
		expect(again).toMatchObject({
			applied: [],
			appliedChanges: [],
			stillHeld: [{ amendmentId: theirs!.id, reason: conflict }],
			batch: null
		})
		expect(await heldRows(other.id)).toHaveLength(1)
		expect((await sessionRead(other.id, w.vault.id)).content).toBe("Open.")
		expect((await stored(w.vault.id)).content).toBe("Sealed.")
	})

	it("take-back restores the field and the held row (same id, same anchor); the other session then applies cleanly", async () => {
		const w = await world()
		const other = await sessionOn(w.user.id, w.book.id)
		const m1 = await change(w, w.vault.id, { content: "Sealed." })
		await change({ user: w.user, session: other }, w.vault.id, {
			content: "Open."
		})
		const { applyOverlayItems, takeBackApply, overlayItemsOf } =
			await lore()
		const [held] = await heldRows(w.session.id)
		const done = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		await takeBackApply(asDb(), { batch: done.batch!, userId: w.user.id })
		expect((await stored(w.vault.id)).content).toBe("Locked.")
		expect(await applyRecords(w.session.id)).toEqual([])
		const [back] = await heldRows(w.session.id)
		expect(back).toMatchObject({
			id: held!.id,
			entryId: w.vault.id,
			branchId: null,
			year: null,
			sourceMessageId: m1.id,
			fields: { content: "Sealed." },
			base: { content: { v: "Locked." } }
		})
		expect((await sessionRead(w.session.id, w.vault.id)).content).toBe(
			"Sealed."
		)
		expect((await overlayItemsOf(asDb(), other.id))[0]).toMatchObject({
			conflict: null
		})
		const second = await applyOverlayItems(asDb(), {
			sessionId: other.id,
			userId: w.user.id
		})
		expect(second.stillHeld).toEqual([])
		expect((await stored(w.vault.id)).content).toBe("Open.")
		// A batch taken back is gone.
		await expect(
			takeBackApply(asDb(), { batch: done.batch!, userId: w.user.id })
		).rejects.toThrow("Nothing to take back.")
	})

	it("take-back works after the settle line passed the anchor: the records keep before and stand", async () => {
		const w = await world()
		const m1 = await change(w, w.vault.id, { content: "Sealed." })
		const { applyOverlayItems, takeBackApply } = await lore()
		const done = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		const { settleThrough } = await import("$lib/server/sessions/settle")
		await db.transaction((tx) =>
			settleThrough(tx as any, w.session.id, m1.id, {})
		)
		const [record] = await applyRecords(w.session.id)
		expect(record).toMatchObject({
			status: "standing",
			before: { v: "Locked." }
		})
		await takeBackApply(asDb(), { batch: done.batch!, userId: w.user.id })
		expect((await stored(w.vault.id)).content).toBe("Locked.")
		expect(await heldRows(w.session.id)).toHaveLength(1)
	})

	it("take-back refuses, in a sentence and writing nothing, when the field changed in the lorebook since", async () => {
		const w = await world()
		await change(w, w.vault.id, { content: "Sealed." })
		const { applyOverlayItems, takeBackApply } = await lore()
		const done = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		await db
			.update(schema.lorebookEntries)
			.set({ content: "Rewritten." })
			.where(eq(schema.lorebookEntries.id, w.vault.id))
		// A person's edit marks a run's imprints kept; an Apply's record is left
		// whole (never a decision note, never dropped), so take-back stays all or nothing.
		const { markImprintsKept, keptImprintsByEntry } = await import(
			"$lib/server/lorebooks/imprints"
		)
		expect(
			await markImprintsKept(asDb(), {
				subjectKind: "entry",
				subjectId: w.vault.id,
				fields: ["content"]
			})
		).toBe(0)
		expect((await applyRecords(w.session.id))[0]).toMatchObject({ status: "standing" })
		expect((await keptImprintsByEntry(asDb(), w.book.id, [w.vault.id])).size).toBe(0)
		await expect(
			takeBackApply(asDb(), { batch: done.batch!, userId: w.user.id })
		).rejects.toThrow(
			"The Vault's content has changed in the lorebook since it was applied, so this can't be taken back."
		)
		expect((await stored(w.vault.id)).content).toBe("Rewritten.")
		expect(await applyRecords(w.session.id)).toHaveLength(1)
		expect(await heldRows(w.session.id)).toEqual([])
		// Only the lorebook's owner takes it back; a gone entry is a sentence too.
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(
			db,
			`heldapply-stranger-${w.suffix}`
		)
		await expect(
			takeBackApply(asDb(), { batch: done.batch!, userId: stranger.id })
		).rejects.toThrow("Only the lorebook's owner can apply changes to it.")
		await db
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, w.vault.id))
		await expect(
			takeBackApply(asDb(), { batch: done.batch!, userId: w.user.id })
		).rejects.toThrow(
			"The entry is no longer in the lorebook, so this can't be taken back."
		)
	})

	it("a dated held change applies as a moved amendment on the session's line; take-back moves it back", async () => {
		const w = await world({ year: 3, month: 2, day: 5 })
		const m1 = await change(w, w.vault.id, { content: "Sealed." })
		const [held] = await heldRows(w.session.id)
		expect(held).toMatchObject({ year: 3, month: 2, day: 5 })
		const before = await stored(w.vault.id)
		const { applyOverlayItems, takeBackApply } = await lore()
		const done = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(done.appliedChanges).toEqual([held!.id])
		// The base row is untouched; the amendment moved to the lorebook's line, ordinary now.
		expect(await stored(w.vault.id)).toEqual(before)
		const [moved] = await db
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, held!.id))
		expect(moved).toMatchObject({
			lorebookId: w.book.id,
			branchId: null,
			base: null,
			sourceMessageId: null,
			year: 3,
			month: 2,
			day: 5,
			fields: { content: "Sealed." }
		})
		expect(await heldRows(w.session.id)).toEqual([])
		expect(
			(await bookRead(w.vault.id, { year: 3, month: 1, day: 30 })).content
		).toBe("Locked.")
		expect(
			(await bookRead(w.vault.id, { year: 3, month: 2, day: 5 })).content
		).toBe("Sealed.")
		expect(
			(await bookRead(w.vault.id, { year: 4, month: 1, day: 1 })).content
		).toBe("Sealed.")
		const [record] = await applyRecords(w.session.id)
		expect(record).toMatchObject({
			messageId: m1.id,
			before: { v: "Locked." },
			after: { v: "Sealed." },
			cause: { amendmentId: held!.id, key: "content" }
		})

		await takeBackApply(asDb(), { batch: done.batch!, userId: w.user.id })
		const [back] = await db
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, held!.id))
		expect(back).toMatchObject({
			lorebookId: await ownBookId(w.session.id),
			branchId: null,
			base: { content: { v: "Locked." } },
			sourceMessageId: m1.id
		})
		expect(
			(await bookRead(w.vault.id, { year: 4, month: 1, day: 1 })).content
		).toBe("Locked.")
		expect(await applyRecords(w.session.id)).toEqual([])

		// A dated change edited in the lorebook since cannot be taken back.
		const again = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		await db
			.update(schema.entryAmendments)
			.set({ fields: { content: "Edited." } })
			.where(eq(schema.entryAmendments.id, held!.id))
		await expect(
			takeBackApply(asDb(), { batch: again.batch!, userId: w.user.id })
		).rejects.toThrow(
			"The dated change to The Vault was edited in the lorebook since it was applied, so this can't be taken back."
		)
	})

	it("an undated change whose key a dated line amendment decides is a conflict, with its own sentence", async () => {
		const w = await world()
		await db.insert(schema.entryAmendments).values({
			lorebookId: w.book.id,
			entryId: w.vault.id,
			year: 1,
			fields: { content: "Dated." },
			base: null
		})
		await change(w, w.vault.id, { content: "Sealed." })
		const [held] = await heldRows(w.session.id)
		expect(held).toMatchObject({
			year: null,
			base: { content: { v: "Dated." } }
		})
		const reason =
			"A dated change in the lorebook decides content here, so this change would not show."
		const { overlayItemsOf, applyOverlayItems } = await lore()
		expect((await overlayItemsOf(asDb(), w.session.id))[0]).toMatchObject({
			conflict: reason
		})
		const done = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(done.stillHeld).toEqual([{ amendmentId: held!.id, reason }])
		expect((await stored(w.vault.id)).content).toBe("Locked.")
		expect(await heldRows(w.session.id)).toHaveLength(1)
	})

	it("Back of the anchor's message after an Apply is refused as settled; the lorebook still reads the applied value", async () => {
		const w = await world()
		await messageIn(w.session.id, "user")
		await change(w, w.vault.id, { content: "Sealed." })
		const { applyOverlayItems } = await lore()
		const done = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		// Apply settles: the line stands at the applied change's anchor.
		expect(done.settled).toMatchObject({ moved: true })
		const { rewindTurn } = await import("$lib/server/sessions/rewind")
		const { SETTLED_SENTENCE } = await import("$lib/server/sessions/settle")
		expect(
			await rewindTurn(asDb(), {
				sessionId: w.session.id,
				userId: w.user.id
			})
		).toEqual({ ok: false, error: SETTLED_SENTENCE })
		expect((await stored(w.vault.id)).content).toBe("Sealed.")
		expect(await applyRecords(w.session.id)).toHaveLength(1)
		// The retraction itself never selects an apply record, by message or by run.
		const { retractImprints } = await import(
			"$lib/server/lorebooks/imprints"
		)
		const [record] = await applyRecords(w.session.id)
		await expect(
			retractImprints(asDb(), { messageIds: [record!.messageId!] })
		).rejects.toThrow(SETTLED_SENTENCE)
		expect(
			await retractImprints(asDb(), {
				sessionId: w.session.id,
				runIds: [`run-${n}`]
			})
		).toEqual([])
		expect((await stored(w.vault.id)).content).toBe("Sealed.")
		expect(await heldRows(w.session.id)).toEqual([])
	})

	it("a member's session on someone else's lorebook: the change is listed, and Apply refuses", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const member = await createTestUser(db, `heldapply-member-${w.suffix}`)
		const theirs = await sessionOn(member.id, w.book.id)
		await change({ user: member, session: theirs }, w.vault.id, {
			content: "Sealed."
		})
		const { overlayItemsOf, applyOverlayItems, APPLY_OVERLAY_REFUSALS } =
			await lore()
		expect(await overlayItemsOf(asDb(), theirs.id)).toHaveLength(1)
		await expect(
			applyOverlayItems(asDb(), {
				sessionId: theirs.id,
				userId: member.id
			})
		).rejects.toThrow("Only the lorebook's owner can apply changes to it.")
		expect(APPLY_OVERLAY_REFUSALS.notOwner).toBe(
			"Only the lorebook's owner can apply changes to it."
		)
		expect((await stored(w.vault.id)).content).toBe("Locked.")
		expect(await heldRows(theirs.id)).toHaveLength(1)
	})

	it("entryIds only applies new entries only; amendmentIds only applies held changes only; one batch per press, in anchor order", async () => {
		const w = await world()
		const { applyOverlayItems, ownBookFor } = await lore()
		const notes = await ownBookFor(asDb(), w.session.id)
		const [made] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: notes.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "The Nook",
				content: "…"
			})
			.returning()
		await change(w, w.vault.id, { content: "Sealed." })
		await change(w, w.vault.id, { fields: { category: "Vaults" } })
		const [first, second] = await heldRows(w.session.id)
		const entriesOnly = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			entryIds: [made!.id]
		})
		expect(entriesOnly).toMatchObject({
			applied: [made!.id],
			appliedChanges: [],
			stillHeld: []
		})
		// An applied new entry files its record, so the press has a batch.
		expect(entriesOnly.batch).toEqual(expect.any(String))
		expect(await heldRows(w.session.id)).toHaveLength(2)
		const changesOnly = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			amendmentIds: [second!.id, first!.id]
		})
		expect(changesOnly.applied).toEqual([])
		expect(changesOnly.appliedChanges).toEqual([first!.id, second!.id])
		const row = await stored(w.vault.id)
		expect(row.content).toBe("Sealed.")
		expect((row.fields as any).category).toBe("Vaults")
		const records = (await applyRecords(w.session.id)).filter((r) => r.field != null)
		expect(records.map((r) => [r.field, r.batch])).toEqual([
			["content", changesOnly.batch],
			["fields.category", changesOnly.batch]
		])
	})
})
