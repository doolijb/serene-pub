/**
 * Apply writes past neither rule of the lorebook's versions: one version per
 * entry, line and date; none dated before the entry's Beginning. A waiting
 * dated change that would break one waits, with its reason, by hand and by
 * itself. A history day that lands on a line which does not own its date waits
 * too (rule C), as a merged day does.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { formatDate } from "$lib/shared/lorebooks/storyDate"
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
const year = (y: number) => formatDate({ year: y, month: null, day: null })

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-held-apply-version-checks-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(
	mode: "full" | "review" = "review",
	vaultFields: Record<string, unknown> = {}
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `heldversion-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: mode })
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
			fields: { category: "Rooms", ...vaultFields }
		})
		.returning()
	const session = await sessionOn(user.id, book!.id)
	return { user, book: book!, vault: vault!, session }
}
type World = Awaited<ReturnType<typeof world>>

async function sessionOn(
	userId: number,
	lorebookId: number,
	lorebookBranchId: number | null = null
) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId,
			lorebookBranchId
		})
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

const notesOf = async (sessionId: number) =>
	(await (await lore()).ownBookFor(asDb(), sessionId)).id

/** A held dated change to the vault, in the session's notes. */
async function held(w: World, y: number, messageId: number | null = null) {
	const [row] = await db
		.insert(schema.entryAmendments)
		.values({
			lorebookId: await notesOf(w.session.id),
			entryId: w.vault.id,
			year: y,
			fields: { content: "Sealed." },
			base: { content: { v: "Locked." } },
			sourceMessageId: messageId
		})
		.returning()
	return row!
}

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
const lorebookRows = (w: World) =>
	db
		.select()
		.from(schema.entryAmendments)
		.where(eq(schema.entryAmendments.lorebookId, w.book.id))
		.orderBy(schema.entryAmendments.id)
const apply = async (w: World) =>
	(await lore()).applyOverlayItems(asDb(), {
		sessionId: w.session.id,
		userId: w.user.id
	})

const beginningSentence = (beginning: number, change: number) =>
	`This entry began at ${year(beginning)}, so a change can't be dated ${year(change)}, before it. Date the change at or after ${year(beginning)}.`

describe("a waiting dated change that would break a rule of versions waits, with its reason", () => {
	it("dated before the entry's Beginning: listed with the Beginning sentence, left held, nothing written", async () => {
		const w = await world("review", { year: 10 })
		const row = await held(w, 3)
		const reason = beginningSentence(10, 3)
		const [item] = await (await lore()).overlayItemsOf(asDb(), w.session.id)
		expect(item).toMatchObject({
			kind: "entry-change",
			amendmentId: row.id,
			conflict: reason
		})
		const done = await apply(w)
		expect(done.appliedChanges).toEqual([])
		expect(done.stillHeld).toEqual([{ amendmentId: row.id, reason }])
		expect(await lorebookRows(w)).toEqual([])
		expect(await heldRows(w.session.id)).toHaveLength(1)
	})

	it("the line already has a version at that date: that alone is no reason to wait (the older rules still judge it)", async () => {
		const w = await world()
		await db.insert(schema.entryAmendments).values({
			lorebookId: w.book.id,
			entryId: w.vault.id,
			branchId: null,
			year: 5,
			fields: { content: "Open." },
			base: null
		})
		const row = await held(w, 5)
		const [item] = (await (await lore()).overlayItemsOf(asDb(), w.session.id)) as any[]
		expect(item).toMatchObject({ kind: "entry-change", amendmentId: row.id })
		expect(String(item?.conflict ?? "")).not.toContain("already has a version")
		const done = await apply(w)
		for (const h of done.stillHeld as { reason: string }[])
			expect(h.reason).not.toContain("already has a version")
	})

	it("a free date still moves to the lorebook as before", async () => {
		const w = await world("review", { year: 2 })
		const m = await messageIn(w.session.id)
		const row = await held(w, 6, m.id)
		const [item] = await (await lore()).overlayItemsOf(asDb(), w.session.id)
		expect(item).toMatchObject({ conflict: null })
		const done = await apply(w)
		expect(done.appliedChanges).toEqual([row.id])
		expect(done.stillHeld).toEqual([])
		expect(await lorebookRows(w)).toMatchObject([
			{ id: row.id, year: 6, base: null, fields: { content: "Sealed." } }
		])
		expect(await heldRows(w.session.id)).toEqual([])
	})

	it("automatic Apply leaves the change before the Beginning waiting", async () => {
		const w = await world("full", { year: 10 })
		const m = await messageIn(w.session.id)
		const row = await held(w, 3, m.id)
		const free = await held(w, 11, m.id)
		const done = await (
			await lore()
		).applyHeldAutomatically(asDb(), {
			sessionId: w.session.id,
			automatic: "close-out"
		})
		// The free date moved, so the automatic path ran; the change before the Beginning waits.
		expect(done?.appliedChanges).toEqual([free.id])
		expect((await lorebookRows(w)).map((r) => r.id)).toEqual([free.id])
		const left = await heldRows(w.session.id)
		expect(left.map((r) => r.id)).toEqual([row.id])
	})
})

describe("a history day on a line that does not own its date waits (rule C)", () => {
	it("a day dated before the fork stays in the notes with the reason; a day after it moves onto the line", async () => {
		const w = await world()
		const [line] = await db
			.insert(schema.lorebookBranches)
			.values({ lorebookId: w.book.id, name: "fork-line", forkYear: 5 })
			.returning()
		const session = await sessionOn(w.user.id, w.book.id, line!.id)
		const ownDay = async (y: number) =>
			(
				await db
					.insert(schema.lorebookEntries)
					.values({
						lorebookId: await notesOf(session.id),
						typeId: HISTORY_TYPE_ID,
						typeVersion: 1,
						position: ++n,
						title: `Own day ${y}`,
						content: `Day ${y}.`,
						fields: { year: y }
					})
					.returning()
			)[0]!
		const before = await ownDay(3)
		const after = await ownDay(8)
		const done = await (
			await lore()
		).applyOverlayItems(asDb(), {
			sessionId: session.id,
			userId: w.user.id
		})
		expect(done.heldDays).toEqual([
			{
				notesEntryId: before.id,
				reason: `fork-line shares everything up to ${year(5)} with main. Change that day here as an amendment, or choose a later date.`
			}
		])
		const rows = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, before.id))
		expect(rows[0]!.lorebookId).toBe(await notesOf(session.id))
		const [moved] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, after.id))
		expect(moved).toMatchObject({
			lorebookId: w.book.id,
			branchId: line!.id
		})
	})
})
