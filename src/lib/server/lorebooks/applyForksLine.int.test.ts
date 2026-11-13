/**
 * 🚧 An Apply forks the session's line: a branch session still riding its parent's line
 * (`line_on_first_write`) forks its own inside the Apply once something is to be applied, and a
 * branch applies by itself (`applyHeldAutomatically`) onto its own line. Nothing reaches the
 * original's line; an Apply with nothing to apply forks nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
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
const DAY = { year: 3, month: 2, day: 5 }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-apply-forks-line-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function sessionOn(
	userId: number,
	lorebookId: number,
	over: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId,
			storyClockYear: DAY.year,
			storyClockMonth: DAY.month,
			storyClockDay: DAY.day,
			...over
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

/** A lorebook, its owner on Full, an original session and a branch of it riding the original's line. */
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `applyforks-${suffix}`)
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
	const original = await sessionOn(user.id, book!.id)
	const branch = await sessionOn(user.id, book!.id, {
		branchOfSessionId: original.id,
		lineOnFirstWrite: true
	})
	return { user, book: book!, vault: vault!, original, branch }
}
type World = Awaited<ReturnType<typeof world>>

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

async function place(sessionId: number, title: string, messageId: number) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: await notesOf(sessionId),
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `About ${title}.`,
			sourceMessageId: messageId
		})
		.returning()
	return row!
}

/** A standalone link of the session's notes between two entries of the lorebook. */
async function link(sessionId: number, from: number, to: number) {
	const [row] = await db
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId: await notesOf(sessionId),
			fromEntryId: from,
			toEntryId: to,
			relationshipType: "leads to"
		})
		.returning()
	return row!
}

/** A dated held change to the vault, held in the session's notes. */
async function datedChange(
	sessionId: number,
	entryId: number,
	messageId: number
) {
	const [row] = await db
		.insert(schema.entryAmendments)
		.values({
			lorebookId: await notesOf(sessionId),
			entryId,
			year: DAY.year,
			month: DAY.month,
			day: DAY.day,
			fields: { content: "Sealed." },
			base: { content: { v: "Locked." } },
			sourceMessageId: messageId
		})
		.returning()
	return row!
}

const sessionRow = async (id: number) =>
	(
		await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!
const linesOf = (bookId: number) =>
	db
		.select()
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, bookId))
const entryRow = async (id: number) =>
	(
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!
const linkRow = async (id: number) =>
	(
		await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, id))
	)[0]!
const amendmentRow = async (id: number) =>
	(
		await db
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, id))
	)[0]!

/** The vault's content as the session's own reading has it at the story day. */
async function vaultRead(sessionId: number, vaultId: number) {
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entryOverlaysFor, entryAt } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const row = await entryRow(vaultId)
	const reading = (await sessionReadingOf(asDb(), sessionId))!
	const overlays = await entryOverlaysFor(asDb(), row.lorebookId, reading, [
		vaultId
	])
	return (entryAt(toEntryRow(row), overlays, reading) as any)
		.content as string
}

/** What a branch has to apply: a place, a link between it and the vault, and a dated held change. */
async function branchWork(w: World) {
	const m = await messageIn(w.branch.id)
	const keep = await place(w.branch.id, "Ashfall Keep", m.id)
	const [gate] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: w.book.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "The Gate",
			content: "Shut.",
			fields: { category: "Rooms" }
		})
		.returning()
	const lnk = await link(w.branch.id, w.vault.id, gate!.id)
	await db.insert(schema.loreImprints).values({
		sessionId: w.branch.id,
		messageId: m.id,
		runId: null,
		lorebookId: await notesOf(w.branch.id),
		subjectKind: "relationship",
		subjectId: lnk.id,
		field: null,
		before: null,
		after: null
	})
	const held = await datedChange(w.branch.id, w.vault.id, m.id)
	return { m, keep, lnk, held }
}

/** The one new line of the book, after the branch applied; checks the session moved onto it. */
async function theNewLine(w: World) {
	const lines = await linesOf(w.book.id)
	expect(lines).toHaveLength(1)
	const line = lines[0]!
	expect(line.name).toContain(w.branch.name)
	const row = await sessionRow(w.branch.id)
	expect(row.lorebookBranchId).toBe(line.id)
	expect(row.lineOnFirstWrite).toBe(false)
	return line.id
}

async function landedOnLine(
	w: World,
	work: Awaited<ReturnType<typeof branchWork>>,
	lineId: number
) {
	expect((await entryRow(work.keep.id)).branchId).toBe(lineId)
	expect((await entryRow(work.keep.id)).lorebookId).toBe(w.book.id)
	expect((await linkRow(work.lnk.id)).branchId).toBe(lineId)
	expect(await amendmentRow(work.held.id)).toMatchObject({
		lorebookId: w.book.id,
		branchId: lineId,
		base: null
	})
	// Nothing reaches the original's line.
	expect((await sessionRow(w.original.id)).lorebookBranchId).toBeNull()
	expect(await vaultRead(w.original.id, w.vault.id)).toBe("Locked.")
	expect(await vaultRead(w.branch.id, w.vault.id)).toBe("Sealed.")
}

describe("an Apply forks the session's line", () => {
	it("a pressed Apply forks the branch's line inside the Apply; what moved is on it", async () => {
		const w = await world()
		const work = await branchWork(w)
		expect(await linesOf(w.book.id)).toHaveLength(0)
		const { applyOverlayItems } = await lore()
		const done = await applyOverlayItems(asDb(), {
			sessionId: w.branch.id,
			userId: w.user.id
		})
		expect(done.applied).toContain(work.keep.id)
		expect(done.appliedLinks).toEqual([work.lnk.id])
		expect(done.appliedChanges).toEqual([work.held.id])
		await landedOnLine(w, work, await theNewLine(w))
	})

	for (const cause of ["scene-close", "close-out"] as const)
		it(`${cause} applies by itself onto the branch's own line`, async () => {
			const w = await world()
			const work = await branchWork(w)
			let sceneId: number | undefined
			if (cause === "scene-close") {
				const [scene] = await db
					.insert(schema.scenes)
					.values({
						sessionId: w.branch.id,
						lorebookId: w.book.id,
						channel: "main",
						openedAtMessageId: work.m.id,
						closedAtMessageId: work.m.id
					})
					.returning()
				sceneId = scene!.id
			}
			const { applyHeldAutomatically } = await lore()
			const done = await applyHeldAutomatically(asDb(), {
				sessionId: w.branch.id,
				automatic: cause,
				sceneId
			})
			expect(done).not.toBeNull()
			expect(done!.applied).toContain(work.keep.id)
			await landedOnLine(w, work, await theNewLine(w))
		})

	it("a line already forked by another writer is the line the Apply lands on; no second fork", async () => {
		const w = await world()
		const work = await branchWork(w)
		const { ensureSessionLine } = await import(
			"$lib/server/lorebooks/sessionLine"
		)
		const first = await ensureSessionLine(asDb(), w.branch.id)
		expect(first).not.toBeNull()
		const { applyOverlayItems } = await lore()
		await applyOverlayItems(asDb(), {
			sessionId: w.branch.id,
			userId: w.user.id
		})
		expect(await linesOf(w.book.id)).toHaveLength(1)
		expect(await theNewLine(w)).toBe(first)
		await landedOnLine(w, work, first!)
	})

	it("an Apply with nothing to apply forks nothing", async () => {
		const w = await world()
		const { applyOverlayItems } = await lore()
		const nothing = await applyOverlayItems(asDb(), {
			sessionId: w.branch.id,
			userId: w.user.id
		})
		expect(nothing.applied).toEqual([])
		// A held change the lorebook already agrees with is done: dropped, nothing else.
		const m = await messageIn(w.branch.id)
		const [agreed] = await db
			.insert(schema.entryAmendments)
			.values({
				lorebookId: await notesOf(w.branch.id),
				entryId: w.vault.id,
				year: null,
				fields: { content: "Locked." },
				base: { content: { v: "Open." } },
				sourceMessageId: m.id
			})
			.returning()
		const done = await applyOverlayItems(asDb(), {
			sessionId: w.branch.id,
			userId: w.user.id
		})
		expect(done.dropped).toEqual([agreed!.id])
		expect(await linesOf(w.book.id)).toHaveLength(0)
		const row = await sessionRow(w.branch.id)
		expect(row.lorebookBranchId).toBeNull()
		expect(row.lineOnFirstWrite).toBe(true)
		expect(
			await db
				.select()
				.from(schema.entryAmendments)
				.where(
					and(
						eq(schema.entryAmendments.entryId, w.vault.id),
						eq(schema.entryAmendments.id, agreed!.id)
					)
				)
		).toEqual([])
	})

	it("a branch of the owner's session under Full applies itself", async () => {
		const w = await world()
		const { overlayAccessOf } = await lore()
		expect(await overlayAccessOf(asDb(), w.branch.id, w.user.id)).toEqual({
			mayApply: true,
			appliesItself: true
		})
	})
})
