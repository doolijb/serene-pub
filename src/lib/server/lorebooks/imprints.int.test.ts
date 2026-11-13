/**
 * 🚧 **What a message changed goes with it — on the lorebook** (RF fix 4,
 * 2026-10-23): lore imprints and the one retraction rule.
 *
 * Claims, each on the real writers (`core:outlet/update-lore-entry@1`,
 * `create-lore-entry@1` with its links) and the real retraction roads
 * (`retractStateAnchoredTo` for a swipe, the message store's delete):
 *
 *  1. a field a run wrote on a real book goes back with its message while it
 *     is still as the run left it, and a failed replacement puts it back;
 *  2. changed since, it stays — the imprint is kept, the entry's list row
 *     says so, and Revert (or Keep) settles it, for whoever may edit the book;
 *  3. a room and its way out a run filed are removed with its message and
 *     come back on restore; one someone has linked to since stays;
 *  4. the session's own notes always revert, an edit since or not;
 *  5. two messages wrote one field: taking back the older splices the
 *     chain, and the newer then lands where both began;
 *  6. a delete takes back what a swipe does, and a kept note outlives it;
 *  7. a retake takes back what the turn's runs wrote, wherever anchored;
 *  8. a person's press writes as the person: nothing is imprinted.
 *
 * (sense-b4) Pins the direct-writer rule: the kept/revert rule is tested through
 * sessions whose scenes do not end by themselves (their pipeline writes land in
 * the real book); for a session whose scenes do, the same run's new entry and
 * link are in its own book and carry an own-book imprint. The predicate is
 * switched per session below.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

const scenesEnd = vi.hoisted(() => new Set<number>())
vi.mock("$lib/server/lorebooks/ownBook", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/lorebooks/ownBook")>()),
	scenesEndByThemselves: async (_db: unknown, sessionId: number) => scenesEnd.has(sessionId)
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-imprints-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
const UPDATE = { key: "change", definitionId: "core:outlet/update-lore-entry" } as any
const CREATE = { key: "file", definitionId: "core:outlet/create-lore-entry" } as any

let n = 0

/** A user, their book, a session reading it at `mode`, and a way to post messages. */
async function world(opts: { mode?: "full" | "review"; ends?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `imprints-${suffix}`)
	await testDb.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: opts.mode ?? "full" })
	const [book] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: book!.id })
		.returning()
	if (opts.ends) scenesEnd.add(session!.id)
	const message = async () => {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await testDb.insert(schema.messages).values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
		return legacy!
	}
	const host = async (runId: string) => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		return createHost(db(), { sessionId: session!.id, userId: user.id, runId })
	}
	return { user, book: book!, session: session!, message, host }
}

/** A place a person wrote, with a category. */
async function place(lorebookId: number, title: string, category: string) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `${title}, as written.`,
			fields: { category }
		})
		.returning()
	return row!
}

const entry = async (id: number) =>
	(await testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]
const categoryOf = async (id: number) => ((await entry(id))?.fields as Record<string, unknown> | undefined)?.category
const imprints = async (sessionId: number) => {
	const { imprintsOf } = await import("./imprints")
	return imprintsOf(db(), sessionId)
}
/**
 * A run's write onto a real book's entry, as the write-through made it: the
 * update and the lore imprints it files. A session's change to an attached
 * lorebook's entry is held now (`host.heldEntryChange.int.test.ts`), so the
 * imprint rule — retract, keep, splice, restore, settle — is tested on the
 * writer itself, through `imprintChanges`.
 */
const wroteOnBook = async (
	w: { session: { id: number } },
	messageId: number,
	runId: string,
	entryId: number,
	patch: { content?: string; category?: string }
) => {
	const { imprintChanges, entryFieldAddress } = await import("./imprints")
	const was = (await entry(entryId))!
	const [wrote] = await testDb
		.update(schema.lorebookEntries)
		.set({
			...(patch.content !== undefined ? { content: patch.content } : {}),
			...(patch.category !== undefined
				? { fields: { ...(was.fields as Record<string, unknown>), category: patch.category } }
				: {}),
			updatedAt: new Date()
		})
		.where(eq(schema.lorebookEntries.id, entryId))
		.returning()
	await imprintChanges(
		db(),
		{ sessionId: w.session.id, messageId, runId },
		{ lorebookId: was.lorebookId, subject: "entry", subjectId: entryId },
		was as Record<string, unknown>,
		wrote as Record<string, unknown>,
		[
			...(patch.content !== undefined ? ["content"] : []),
			...(patch.category !== undefined ? [entryFieldAddress("category")] : [])
		]
	)
}
const swipe = async (messageId: number) => {
	const { retractStateAnchoredTo } = await import("$lib/server/state/write")
	return retractStateAnchoredTo(db(), messageId, "replaced")
}

describe("a run's write on a real book", () => {
	test("goes back with its message while it is as the run left it; a failed replacement puts it back", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault", "Rooms")
		const m = await w.message()
		await wroteOnBook(w, m.id, "run-a", vault.id, { content: "Sealed.", category: "Vaults" })
		expect(await categoryOf(vault.id)).toBe("Vaults")
		const filed = await imprints(w.session.id)
		expect(filed.map((i) => [i.field, i.messageId, i.runId, i.status]).sort()).toEqual([
			["content", m.id, "run-a", "standing"],
			["fields.category", m.id, "run-a", "standing"]
		])

		const taken = await swipe(m.id)
		expect(taken.changed).toBe(true)
		expect(await categoryOf(vault.id)).toBe("Rooms")
		expect((await entry(vault.id))!.content).toBe("The Vault, as written.")
		expect(await imprints(w.session.id)).toEqual([])

		const { restoreRetractedState } = await import("$lib/server/state/write")
		expect(await restoreRetractedState(db(), taken.taken)).toBe(true)
		expect(await categoryOf(vault.id)).toBe("Vaults")
		expect((await entry(vault.id))!.content).toBe("Sealed.")
		expect((await imprints(w.session.id)).map((i) => i.status)).toEqual(["standing", "standing"])
	})

	test("changed since, it stays and says so; Revert puts back what it held, Keep keeps it — for whoever may edit the book", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault", "Rooms")
		const m = await w.message()
		await wroteOnBook(w, m.id, "run-b", vault.id, { content: "Sealed.", category: "Vaults" })
		// Someone retitles the category after the reply.
		await testDb
			.update(schema.lorebookEntries)
			.set({ fields: { category: "Treasury" } })
			.where(eq(schema.lorebookEntries.id, vault.id))

		await swipe(m.id)
		// The content was as the run left it: back. The category was not: it stays.
		expect((await entry(vault.id))!.content).toBe("The Vault, as written.")
		expect(await categoryOf(vault.id)).toBe("Treasury")
		const [kept] = await imprints(w.session.id)
		expect(kept).toMatchObject({ field: "fields.category", status: "kept" })

		// The list row says so.
		const { listEntryRows } = await import("$lib/server/sockets/entries")
		const row = (await listEntryRows(w.book.id, LOCATION_TYPE_ID)).find((r) => r.id === vault.id)!
		expect(row.keptImprints).toEqual([
			expect.objectContaining({ id: kept!.id, field: "fields.category", before: "Rooms", after: "Vaults" })
		])
		// Swiping the replacement again leaves the kept note alone.
		await swipe(m.id)
		expect((await imprints(w.session.id)).map((i) => i.status)).toEqual(["kept"])

		const { settleImprintHandler } = await import("$lib/server/sockets/entries")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, `imprints-stranger-${n}`)
		const asUser = (id: number) => ({ user: { id, isAdmin: false } }) as any
		await expect(
			settleImprintHandler.handler(asUser(stranger.id), { imprintId: kept!.id, choice: "revert" }, () => {})
		).rejects.toThrow(/may edit this lorebook/)
		expect(await categoryOf(vault.id)).toBe("Treasury")
		const res: any = await settleImprintHandler.handler(asUser(w.user.id), { imprintId: kept!.id, choice: "revert" }, () => {})
		expect(res).toMatchObject({ imprintId: kept!.id, lorebookId: w.book.id, choice: "revert" })
		expect(await categoryOf(vault.id)).toBe("Rooms")
		expect(await imprints(w.session.id)).toEqual([])

		// Keep: the field stays as it is now, and the note goes.
		const m2 = await w.message()
		await wroteOnBook(w, m2.id, "run-c", vault.id, { category: "Vaults" })
		await testDb.update(schema.lorebookEntries).set({ fields: { category: "Hoard" } }).where(eq(schema.lorebookEntries.id, vault.id))
		await swipe(m2.id)
		const [keptAgain] = await imprints(w.session.id)
		await settleImprintHandler.handler(asUser(w.user.id), { imprintId: keptAgain!.id, choice: "keep" }, () => {})
		expect(await categoryOf(vault.id)).toBe("Hoard")
		expect(await imprints(w.session.id)).toEqual([])
		await expect(
			settleImprintHandler.handler(asUser(w.user.id), { imprintId: keptAgain!.id, choice: "keep" }, () => {})
		).rejects.toThrow(/no longer waiting/)
	})

	test("(scenes do not end by themselves) a room and its way out a run filed go with its message and come back on restore; one someone linked to since stays", async () => {
		const w = await world()
		const hall = await place(w.book.id, "The Hall", "Rooms")
		const m = await w.message()
		const out: any = await (await w.host("run-d")).commit!(
			{ name: "The Shaft", content: "Wet rock.", params: { entryType: LOCATION_TYPE_ID }, links: [{ to: hall.id, linkType: "leads up to" }] },
			CREATE
		)
		const shaftId = out.id as number
		const [linkId] = out.linkIds as number[]
		expect((await imprints(w.session.id)).map((i) => [i.subjectKind, i.field])).toEqual([
			["relationship", null],
			["entry", null]
		])

		const taken = await swipe(m.id)
		expect(await entry(shaftId)).toBeUndefined()
		const R = schema.narrativeRelationships
		expect(await testDb.select().from(R).where(eq(R.id, linkId!))).toEqual([])
		const { restoreRetractedState } = await import("$lib/server/state/write")
		await restoreRetractedState(db(), taken.taken)
		expect((await entry(shaftId))?.title).toBe("The Shaft")
		expect((await testDb.select().from(R).where(eq(R.id, linkId!)))[0]).toMatchObject({ fromEntryId: shaftId, toEntryId: hall.id })

		// Someone draws a way from the hall to a second room the run filed.
		const m2 = await w.message()
		const second: any = await (await w.host("run-e")).commit!(
			{ name: "The Well", content: "Deep.", params: { entryType: LOCATION_TYPE_ID } },
			CREATE
		)
		await testDb.insert(R).values({ lorebookId: w.book.id, fromEntryId: hall.id, toEntryId: second.id, relationshipType: "leads down to" })
		await swipe(m2.id)
		expect((await entry(second.id))?.title).toBe("The Well")
		const { keptImprintsByEntry } = await import("./imprints")
		expect((await keptImprintsByEntry(db(), w.book.id, [second.id])).get(second.id)).toEqual([
			expect.objectContaining({ field: null, label: null })
		])
	})
})

describe("a run's write for a session whose scenes end by themselves", () => {
	test("its new room and link are in the own book, with own-book imprints, not real-book ones", async () => {
		const w = await world({ ends: true })
		const hall = await place(w.book.id, "The Hall", "Rooms")
		await w.message()
		const { ownBookFor } = await import("./ownBook")
		const own = await ownBookFor(db(), w.session.id)
		const out: any = await (await w.host("run-own")).commit!(
			{ name: "The Shaft", content: "Wet rock.", params: { entryType: LOCATION_TYPE_ID }, links: [{ to: hall.id, linkType: "leads up to" }] },
			CREATE
		)
		expect(out).toMatchObject({ route: "own-book", lorebookId: own.id })
		expect((await entry(out.id))!.lorebookId).toBe(own.id)
		const R = schema.narrativeRelationships
		expect(await testDb.select().from(R).where(eq(R.lorebookId, w.book.id))).toEqual([])
		expect((await testDb.select().from(R).where(eq(R.lorebookId, own.id)))[0]).toMatchObject({ fromEntryId: out.id, toEntryId: hall.id })
		const filed = await imprints(w.session.id)
		expect(filed.length).toBeGreaterThan(0)
		expect(filed.every((i) => i.lorebookId === own.id)).toBe(true)
	})
})

describe("the session's own notes", () => {
	test("always revert, an edit since or not", async () => {
		const w = await world({ mode: "review" })
		const m1 = await w.message()
		const filed: any = await (await w.host("run-f")).commit!(
			{ name: "A gull", content: "It watches.", params: { entryType: LOCATION_TYPE_ID } },
			CREATE
		)
		expect(filed.route).toBe("own-book")
		const m2 = await w.message()
		await (await w.host("run-g")).commit!({ entry: filed.id, content: "It steals a fish.", fields: { category: "Birds" } }, UPDATE)
		await testDb.update(schema.lorebookEntries).set({ content: "Edited by hand." }).where(eq(schema.lorebookEntries.id, filed.id))

		await swipe(m2.id)
		const note = await entry(filed.id)
		expect(note!.content).toBe("It watches.")
		expect((note!.fields as Record<string, unknown>).category).toBeUndefined()
		await swipe(m1.id)
		expect(await entry(filed.id)).toBeUndefined()
		expect(await imprints(w.session.id)).toEqual([])
	})
})

describe("two messages wrote one field", () => {
	test("taking back the older splices the chain; the newer then lands where both began", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault", "Rooms")
		const m1 = await w.message()
		await wroteOnBook(w, m1.id, "run-h", vault.id, { category: "Vaults" })
		const m2 = await w.message()
		await wroteOnBook(w, m2.id, "run-i", vault.id, { category: "Treasury" })

		await swipe(m1.id)
		expect(await categoryOf(vault.id)).toBe("Treasury")
		const [left] = await imprints(w.session.id)
		expect(left).toMatchObject({ messageId: m2.id, before: { v: "Rooms" }, after: { v: "Treasury" } })
		await swipe(m2.id)
		expect(await categoryOf(vault.id)).toBe("Rooms")
	})
})

describe("a delete", () => {
	test("takes back what a swipe does; a kept note outlives the message", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault", "Rooms")
		const m1 = await w.message()
		await wroteOnBook(w, m1.id, "run-j", vault.id, { category: "Vaults" })
		const { deleteLegacy } = await import("$lib/server/messages/store")
		await testDb.transaction(async (tx) => deleteLegacy(tx as unknown as Db, m1.id))
		expect(await categoryOf(vault.id)).toBe("Rooms")
		expect(await imprints(w.session.id)).toEqual([])

		const m2 = await w.message()
		await wroteOnBook(w, m2.id, "run-k", vault.id, { category: "Vaults" })
		await testDb.update(schema.lorebookEntries).set({ fields: { category: "Hoard" } }).where(eq(schema.lorebookEntries.id, vault.id))
		await testDb.transaction(async (tx) => deleteLegacy(tx as unknown as Db, m2.id))
		expect(await categoryOf(vault.id)).toBe("Hoard")
		expect((await imprints(w.session.id)).map((i) => [i.messageId, i.status])).toEqual([[m2.id, "kept"]])
	})
})

describe("a retake", () => {
	test("takes back what the turn's runs wrote on the lorebook, wherever it is anchored", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault", "Rooms")
		const first = await w.message()
		await wroteOnBook(w, first.id, "run-m", vault.id, { category: "Vaults" })
		const later = await w.message()
		const { takeRunWritesElsewhere } = await import("$lib/server/sessions/rewind")
		await testDb.transaction(async (tx) =>
			takeRunWritesElsewhere(tx as unknown as Db, {
				sessionId: w.session.id,
				runs: [{ runId: -1, runUuid: "run-m" }],
				unitIds: [later.id]
			})
		)
		expect(await categoryOf(vault.id)).toBe("Rooms")
		expect(await imprints(w.session.id)).toEqual([])
	})
})

describe("a person's press", () => {
	test("writes as the person: nothing is imprinted, and a swipe leaves it", async () => {
		const w = await world()
		const m = await w.message()
		const { withRunFamily } = await import("$lib/server/utils/llmQueue")
		const host = await w.host("run-l")
		// A session's change to an attached entry is held and imprints nothing; a
		// person's filing is the write that lands in the real book.
		const vault = await place(w.book.id, "The Vault", "Rooms")
		await withRunFamily("action", () => host.commit!({ entry: vault.id, fields: { category: "Vaults" } }, UPDATE))
		const filed: any = await withRunFamily("action", () =>
			host.commit!({ name: "The Cellar", content: "Cold.", params: { entryType: LOCATION_TYPE_ID } }, CREATE)
		)
		expect(await imprints(w.session.id)).toEqual([])
		await swipe(m.id)
		expect((await entry(filed.id))?.title).toBe("The Cellar")
	})
})
