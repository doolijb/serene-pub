/**
 * 🚧 Apply records every item it moves, take-back refuses in a sentence and
 * writes nothing, a change the lorebook already agrees with is done, and Apply
 * settles (Stage B "Apply in full"). Held changes are made through the real
 * outlet (`update-lore-entry@1`); the rest is `ownBook.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	HISTORY_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
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
const lore = () => import("$lib/server/lorebooks/ownBook")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-apply-take-back-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

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

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `applytakeback-${suffix}`)
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
	const session = await sessionOn(user.id, book!.id)
	return { user, book: book!, vault: vault!, session, suffix }
}
type World = Awaited<ReturnType<typeof world>>

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

const notesOf = async (sessionId: number) =>
	(await (await lore()).ownBookFor(asDb(), sessionId)).id

const heldRows = async (sessionId: number) =>
	db
		.select()
		.from(schema.entryAmendments)
		.where(
			and(
				eq(schema.entryAmendments.lorebookId, await notesOf(sessionId)),
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

const settledLine = async (sessionId: number) =>
	(
		await db
			.select({ s: schema.sessions.settledMessageId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!.s

/** A new entry in the session's notes, written by a turn. */
async function note(
	w: World,
	title: string,
	over: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: await notesOf(w.session.id),
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `About ${title}.`,
			...over
		})
		.returning()
	return row!
}

/**
 * A session whose notes hold "Ashfall Keep" (filed under a parent, on a cast binding, linked to the vault,
 * with its own `extraJson`), applied: the batch, its entry, its parent, its link.
 */
async function appliedKeep() {
	const w = await world()
	const m1 = await messageIn(w.session.id)
	const notes = await notesOf(w.session.id)
	const [binding] = await db
		.insert(schema.lorebookBindings)
		.values({ lorebookId: notes, binding: "{{char:1}}", name: "Aria" })
		.returning()
	const parent = await note(w, "The Marches", { sourceMessageId: m1.id })
	const keep = await note(w, "Ashfall Keep", {
		sourceMessageId: m1.id,
		anchorEntryId: parent.id,
		anchorBindingId: binding!.id,
		extraJson: { remark: "kept" }
	})
	const [link] = await db
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId: notes,
			fromEntryId: keep.id,
			toEntryId: w.vault.id,
			relationshipType: "neutral"
		})
		.returning()
	const { applyOverlayItems } = await lore()
	const done = await applyOverlayItems(asDb(), {
		sessionId: w.session.id,
		userId: w.user.id
	})
	return {
		w,
		m1,
		notes,
		binding: binding!,
		parent,
		keep,
		link: link!,
		done,
		before: { parent, keep, link: link! }
	}
}

/** Everything a take-back could touch, as it stands. */
async function snapshot(sessionId: number, bookId: number) {
	const notes = await notesOf(sessionId)
	return {
		entries: await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, bookId))
			.orderBy(schema.lorebookEntries.id),
		notesEntries: await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, notes))
			.orderBy(schema.lorebookEntries.id),
		links: await db
			.select()
			.from(schema.narrativeRelationships)
			.orderBy(schema.narrativeRelationships.id),
		records: await applyRecords(sessionId),
		held: await db
			.select()
			.from(schema.entryAmendments)
			.orderBy(schema.entryAmendments.id)
	}
}

/** Take-back refuses with `sentence` and writes nothing. */
async function refuses(
	a: Awaited<ReturnType<typeof appliedKeep>>,
	sentence: string
) {
	const { takeBackApply } = await lore()
	const before = await snapshot(a.w.session.id, a.w.book.id)
	await expect(
		takeBackApply(asDb(), { batch: a.done.batch!, userId: a.w.user.id })
	).rejects.toThrow(sentence)
	expect(await snapshot(a.w.session.id, a.w.book.id)).toEqual(before)
}

describe("an applied new entry is recorded and can be taken back", () => {
	it("files a record for the entry and for its link; batch is non-null with entries only", async () => {
		const a = await appliedKeep()
		expect(a.done.applied).toEqual([a.parent.id, a.keep.id])
		expect(a.done.appliedChanges).toEqual([])
		expect(a.done.batch).toEqual(expect.any(String))
		const records = await applyRecords(a.w.session.id)
		expect(
			records.map((r) => [r.subjectKind, r.subjectId, r.field])
		).toEqual([
			["entry", a.parent.id, null],
			["entry", a.keep.id, null],
			["relationship", a.link.id, null]
		])
		expect(records[1]).toMatchObject({
			origin: "apply",
			batch: a.done.batch,
			sessionId: a.w.session.id,
			messageId: a.m1.id,
			runId: null,
			lorebookId: a.w.book.id,
			before: null,
			after: null,
			status: "standing",
			cause: {
				by: { userId: a.w.user.id },
				sessionId: a.w.session.id,
				messageId: a.m1.id,
				moved: {
					lorebookId: a.notes,
					branchId: null,
					position: a.keep.position,
					anchorBindingId: a.binding.id,
					anchorEntryId: a.parent.id
				}
			}
		})
		expect(records[2]!.cause).toMatchObject({
			by: { userId: a.w.user.id },
			moved: { lorebookId: a.notes, branchId: null }
		})
		const moved = await stored(a.keep.id)
		expect(moved.lorebookId).toBe(a.w.book.id)
		expect((moved.extraJson as any).appliedFrom).toMatchObject({
			sessionId: a.w.session.id
		})
	})

	it("take-back moves the entries and the link back as they were and lists them again", async () => {
		const a = await appliedKeep()
		const { takeBackApply, overlayItemsOf } = await lore()
		await takeBackApply(asDb(), {
			batch: a.done.batch!,
			userId: a.w.user.id,
			sessionId: a.w.session.id
		})
		for (const was of [a.parent, a.keep]) {
			const now = await stored(was.id)
			expect(now).toMatchObject({
				lorebookId: a.notes,
				branchId: was.branchId,
				position: was.position,
				anchorBindingId: was.anchorBindingId,
				anchorEntryId: was.anchorEntryId
			})
		}
		expect((await stored(a.keep.id)).extraJson).toEqual({ remark: "kept" })
		const [link] = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, a.link.id))
		expect(link).toMatchObject({ lorebookId: a.notes, branchId: null })
		expect(await applyRecords(a.w.session.id)).toEqual([])
		const items = await overlayItemsOf(asDb(), a.w.session.id)
		expect(items.map((i) => (i as any).entryId)).toEqual([
			a.parent.id,
			a.keep.id
		])
	})

	it("a batch of another session is nothing to take back", async () => {
		const a = await appliedKeep()
		const other = await sessionOn(a.w.user.id, a.w.book.id)
		const { takeBackApply } = await lore()
		await expect(
			takeBackApply(asDb(), {
				batch: a.done.batch!,
				userId: a.w.user.id,
				sessionId: other.id
			})
		).rejects.toThrow("Nothing to take back.")
		expect((await stored(a.keep.id)).lorebookId).toBe(a.w.book.id)
	})
})

describe("take-back refuses in a sentence and writes nothing", () => {
	it("the entry is gone", async () => {
		const a = await appliedKeep()
		await db
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, a.keep.id))
		await refuses(
			a,
			"The entry is no longer in the lorebook, so this can't be taken back."
		)
	})

	it("a batch holding a place refuses whole", async () => {
		const w = await world()
		const m1 = await messageIn(w.session.id)
		const plain = await note(w, "Ashfall Keep", { sourceMessageId: m1.id })
		const nook = await note(w, "The Nook", {
			typeId: LOCATION_TYPE_ID,
			sourceMessageId: m1.id
		})
		const { applyOverlayItems } = await lore()
		const done = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(done.applied).toEqual([plain.id, nook.id])
		await refuses(
			{ w, done } as any,
			"The Nook is a place, and a place applied to the lorebook can't be taken back yet."
		)
		expect((await stored(plain.id)).lorebookId).toBe(w.book.id)
	})

	it("something else in the lorebook links to it", async () => {
		const a = await appliedKeep()
		await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: a.w.book.id,
				fromEntryId: a.w.vault.id,
				toEntryId: a.keep.id,
				relationshipType: "neutral"
			})
		await refuses(
			a,
			"Something else in the lorebook now links to Ashfall Keep, so this can't be taken back."
		)
	})

	it("an amendment of the lorebook is on it", async () => {
		const a = await appliedKeep()
		await db
			.insert(schema.entryAmendments)
			.values({
				lorebookId: a.w.book.id,
				entryId: a.keep.id,
				year: 1,
				fields: { content: "Dated." },
				base: null
			})
		await refuses(
			a,
			"Ashfall Keep has a change of its own in the lorebook now, so this can't be taken back."
		)
	})

	it("a held change of a session is on it", async () => {
		const a = await appliedKeep()
		await db.insert(schema.entryAmendments).values({
			lorebookId: await notesOf(a.w.session.id),
			entryId: a.keep.id,
			year: null,
			fields: { content: "Held." },
			base: { content: { v: "x" } }
		})
		await refuses(
			a,
			"Ashfall Keep has a change of its own in the lorebook now, so this can't be taken back."
		)
	})

	it("a history entry written since names it", async () => {
		const a = await appliedKeep()
		await db.insert(schema.lorebookEntries).values({
			lorebookId: a.w.book.id,
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: null,
			content: "The riders reached ashfall keep at dusk.",
			fields: {}
		})
		await refuses(
			a,
			"A history day now names Ashfall Keep, so this can't be taken back."
		)
	})

	it("a history entry's annotation resolves to it", async () => {
		const a = await appliedKeep()
		const [day] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: a.w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: null,
				content: "A quiet day.",
				fields: {}
			})
			.returning()
		await db.insert(schema.entryAnnotations).values({
			entryId: day!.id,
			entityKey: `open:ashfall`,
			tier: "gazetteer",
			refEntryId: a.keep.id,
			extractorVersion: "t",
			sourceHash: "h",
			gazetteerHash: "g"
		})
		await refuses(
			a,
			"A history day now names Ashfall Keep, so this can't be taken back."
		)
	})

	it("the lorebook's owner edited it since", async () => {
		const a = await appliedKeep()
		await db
			.update(schema.lorebookEntries)
			.set({ content: "Rewritten." })
			.where(eq(schema.lorebookEntries.id, a.keep.id))
		await refuses(
			a,
			"Ashfall Keep was edited in the lorebook since it was applied, so this can't be taken back."
		)
	})

	it("another session's message annotation resolves to it", async () => {
		const a = await appliedKeep()
		const other = await sessionOn(a.w.user.id, a.w.book.id)
		const theirs = await messageIn(other.id)
		await db.insert(schema.messageAnnotations).values({
			messageId: theirs.id,
			entityKey: "open:ashfall",
			tier: "gazetteer",
			refEntryId: a.keep.id,
			extractorVersion: "t",
			sourceHash: "h",
			gazetteerHash: "g"
		})
		await refuses(
			a,
			"Another session's story names Ashfall Keep, so this can't be taken back."
		)
	})

	it("another session's note annotation resolves to it", async () => {
		const a = await appliedKeep()
		const other = await sessionOn(a.w.user.id, a.w.book.id)
		const theirs = await note(
			{ ...a.w, session: other } as World,
			"Their note"
		)
		await db.insert(schema.entryAnnotations).values({
			entryId: theirs.id,
			entityKey: "open:ashfall",
			tier: "gazetteer",
			refEntryId: a.keep.id,
			extractorVersion: "t",
			sourceHash: "h",
			gazetteerHash: "g"
		})
		await refuses(
			a,
			"Another session's story names Ashfall Keep, so this can't be taken back."
		)
	})

	it("another session keeps values on it", async () => {
		const a = await appliedKeep()
		const other = await sessionOn(a.w.user.id, a.w.book.id)
		await db.insert(schema.attributeValues).values({
			ownerKind: "session_location",
			ownerId: a.keep.id,
			slotId: "core:slot/hp@1",
			value: { v: 3 },
			sessionId: other.id
		})
		await refuses(
			a,
			"Another session keeps values on Ashfall Keep, so this can't be taken back."
		)
	})

	it("an entry in the lorebook is filed under it", async () => {
		const a = await appliedKeep()
		await db.insert(schema.lorebookEntries).values({
			lorebookId: a.w.book.id,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "Gatehouse",
			content: "…",
			anchorEntryId: a.keep.id
		})
		await refuses(
			a,
			"An entry in the lorebook is filed under Ashfall Keep now, so this can't be taken back."
		)
	})

	it("its turn is gone", async () => {
		const a = await appliedKeep()
		await db
			.delete(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, a.m1.id))
		await refuses(
			a,
			"The turn that changed The Marches is no longer in the session, so this can't be taken back."
		)
	})
})

describe("a held change the lorebook already agrees with is done", () => {
	it("is not listed, written nothing by a list read, and an Apply drops it; a partly agreeing one applies its other keys", async () => {
		const w = await world()
		const { overlayItemsOf, applyOverlayItems } = await lore()
		await change(w, w.vault.id, { content: "Sealed." })
		const [held] = await heldRows(w.session.id)
		await db
			.update(schema.lorebookEntries)
			.set({ content: "Sealed." })
			.where(eq(schema.lorebookEntries.id, w.vault.id))
		expect(await overlayItemsOf(asDb(), w.session.id)).toEqual([])
		expect(await heldRows(w.session.id)).toHaveLength(1)
		const done = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(done).toMatchObject({
			applied: [],
			appliedChanges: [],
			stillHeld: [],
			batch: null,
			dropped: [held!.id],
			settled: null
		})
		expect(await heldRows(w.session.id)).toEqual([])
		expect(await applyRecords(w.session.id)).toEqual([])

		const m = await change(w, w.vault.id, {
			content: "Open.",
			name: "The Strongroom"
		})
		const [two] = await heldRows(w.session.id)
		await db
			.update(schema.lorebookEntries)
			.set({ content: "Open." })
			.where(eq(schema.lorebookEntries.id, w.vault.id))
		const [item] = await overlayItemsOf(asDb(), w.session.id)
		expect(item).toMatchObject({ amendmentId: two!.id, conflict: null })
		expect((item as any).changes.map((c: any) => c.field)).toEqual(["name"])
		const partly = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(partly.appliedChanges).toEqual([two!.id])
		expect((await stored(w.vault.id)).title).toBe("The Strongroom")
		const records = await applyRecords(w.session.id)
		expect(records.map((r) => [r.field, r.messageId])).toEqual([
			["title", m.id]
		])
	})

	it("a branch's held copy of a change its original applied is dropped, not a conflict", async () => {
		const w = await world()
		const { insertLegacy } = await import("$lib/server/messages/store")
		const { overlayItemsOf, applyOverlayItems, ownBookFor } = await lore()
		const { branchSession } = await import("$lib/server/sessions/branch")
		const line = async (role: "user" | "assistant", content: string) =>
			(
				await insertLegacy(asDb(), {
					sessionId: w.session.id,
					role,
					content,
					channel: "main",
					...(role === "user"
						? { userId: w.user.id }
						: { isNarratorResponse: true })
				} as any)
			).id
		await line("user", "We reach the vault.")
		const m2 = await line("assistant", "The vault is sealed.")
		await db.insert(schema.entryAmendments).values({
			lorebookId: (await ownBookFor(asDb(), w.session.id)).id,
			entryId: w.vault.id,
			year: null,
			fields: { content: "Sealed." },
			base: { content: { v: "Locked." } },
			sourceMessageId: m2
		})
		const branch = await branchSession(asDb(), {
			sessionId: w.session.id,
			fromMessageId: m2
		})
		expect(await overlayItemsOf(asDb(), branch.id)).toHaveLength(1)
		await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(await overlayItemsOf(asDb(), branch.id)).toEqual([])
		const dropped = await applyOverlayItems(asDb(), {
			sessionId: branch.id,
			userId: w.user.id
		})
		expect(dropped.dropped).toHaveLength(1)
		expect(dropped.stillHeld).toEqual([])
		expect(await heldRows(branch.id)).toEqual([])
	})

	it("a later change waiting on an earlier one says so; Apply all folds both, in order", async () => {
		const w = await world()
		const { overlayItemsOf, applyOverlayItems } = await lore()
		await change(w, w.vault.id, { content: "Sealed." })
		await change(w, w.vault.id, { content: "Open." })
		const [first, second] = await heldRows(w.session.id)
		const items = await overlayItemsOf(asDb(), w.session.id)
		expect(items.map((i) => (i as any).conflict)).toEqual([
			null,
			"An earlier change from this session to content is still waiting; apply it first."
		])
		const only = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			amendmentIds: [second!.id]
		})
		expect(only.stillHeld).toEqual([
			{
				amendmentId: second!.id,
				reason: "An earlier change from this session to content is still waiting; apply it first."
			}
		])
		expect(only.batch).toBeNull()
		const all = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(all.appliedChanges).toEqual([first!.id, second!.id])
		expect(all.stillHeld).toEqual([])
		expect((await stored(w.vault.id)).content).toBe("Open.")
	})
})

describe("a change back to what the lorebook holds", () => {
	it("is the session's last word, not a done row: it waits on the earlier change, and Apply all ends where the story did", async () => {
		const w = await world()
		const { overlayItemsOf, applyOverlayItems } = await lore()
		const before = (await stored(w.vault.id)).content
		await change(w, w.vault.id, { content: "Sealed." })
		await change(w, w.vault.id, { content: before })
		const [first, second] = await heldRows(w.session.id)
		// Listed, not hidden as done.
		const items = await overlayItemsOf(asDb(), w.session.id)
		expect(items.map((i) => (i as any).amendmentId)).toEqual([
			first!.id,
			second!.id
		])
		// An unrelated Apply of the first alone does not drop the second.
		await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			amendmentIds: [first!.id]
		})
		expect((await stored(w.vault.id)).content).toBe("Sealed.")
		expect((await heldRows(w.session.id)).map((h) => h.id)).toEqual([
			second!.id
		])
		const rest = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(rest.appliedChanges).toEqual([second!.id])
		expect((await stored(w.vault.id)).content).toBe(before)
	})
})

describe("Apply settles", () => {
	it("moves the line through the newest applied anchor, never past the message before the oldest still held; Back below it refuses", async () => {
		const w = await world()
		const { applyOverlayItems, takeBackApply } = await lore()
		const mA = await change(w, w.vault.id, { content: "Sealed." })
		const mB = await change(w, w.vault.id, {
			fields: { category: "Vaults" }
		})
		const mC = await change(w, w.vault.id, { name: "The Strongroom" })
		const [a, b, c] = await heldRows(w.session.id)
		expect(await settledLine(w.session.id)).toBeNull()
		const first = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			amendmentIds: [a!.id, c!.id]
		})
		expect(first.appliedChanges).toEqual([a!.id, c!.id])
		// Newest applied is C's, but B is still held: the line stops at the message before B.
		expect(first.settled).toMatchObject({
			moved: true,
			settledMessageId: mB.id - 1
		})
		expect(await settledLine(w.session.id)).toBe(mB.id - 1)
		const { assertRetractable, SETTLED_SENTENCE } = await import(
			"$lib/server/sessions/settle"
		)
		await expect(assertRetractable(asDb(), mA.id)).rejects.toThrow(
			SETTLED_SENTENCE
		)
		await expect(assertRetractable(asDb(), mC.id)).resolves.toBeUndefined()

		// Taking the batch back leaves the line where it is.
		await takeBackApply(asDb(), { batch: first.batch!, userId: w.user.id })
		expect(await settledLine(w.session.id)).toBe(mB.id - 1)
		expect(await heldRows(w.session.id)).toHaveLength(3)

		// Nothing held after this one: through its own anchor.
		const all = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(all.appliedChanges).toEqual([a!.id, b!.id, c!.id])
		expect(all.settled).toMatchObject({
			moved: true,
			settledMessageId: mC.id
		})
		expect(await settledLine(w.session.id)).toBe(mC.id)
	})
})
