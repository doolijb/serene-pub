/**
 * 🚧 Apply by itself (owner 2026-11-12, "At scene close, unless a summary
 * waits"): `applyHeldAutomatically` applies what a closed scene covers, waits
 * for a summary that waits, and does nothing at all where the setting, the
 * owner or the line says no.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
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

const UPDATE = {
	key: "change",
	definitionId: "core:outlet/update-lore-entry"
} as any
const asDb = () => db as unknown as Db
const lore = () => import("$lib/server/lorebooks/ownBook")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-auto-apply-")
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

async function world(mode: "full" | "review" | "off" = "full") {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `autoapply-${suffix}`)
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
			fields: { category: "Rooms" }
		})
		.returning()
	const session = await sessionOn(user.id, book!.id)
	return { user, book: book!, vault: vault!, session, suffix }
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

/** A new entry in the session's notes, written at a message. */
async function note(
	sessionId: number,
	title: string,
	sourceMessageId: number | null
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: await notesOf(sessionId),
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `About ${title}.`,
			sourceMessageId
		})
		.returning()
	return row!
}

/** A scene of the session, as a close or the summary step leaves it. */
async function scene(
	w: World,
	over: Partial<typeof schema.scenes.$inferInsert> = {}
) {
	const [row] = await db
		.insert(schema.scenes)
		.values({
			sessionId: w.session.id,
			lorebookId: w.book.id,
			channel: "main",
			...over
		})
		.returning()
	return row!
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

const inNotes = async (sessionId: number) =>
	(
		await db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(
				eq(schema.lorebookEntries.lorebookId, await notesOf(sessionId))
			)
			.orderBy(schema.lorebookEntries.id)
	).map((r) => r.id)

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

/** Three notes at messages 1, 3 and 5 of the session. */
async function threeNotes(w: World) {
	const m = []
	for (let i = 0; i < 6; i++) m.push(await messageIn(w.session.id))
	const eA = await note(w.session.id, "Ashfall Keep", m[0]!.id)
	const eB = await note(w.session.id, "Brine Gate", m[2]!.id)
	const eC = await note(w.session.id, "Cinder Row", m[4]!.id)
	return { m, eA, eB, eC }
}

const auto = async (
	sessionId: number,
	automatic: "scene-close" | "scene-summary" | "close-out",
	sceneId?: number
) =>
	(await lore()).applyHeldAutomatically(asDb(), {
		sessionId,
		automatic,
		sceneId
	})

/** Nothing applied, nothing recorded, nothing held went anywhere. */
async function nothingMoved(w: World, notesBefore: number[]) {
	expect(await inNotes(w.session.id)).toEqual(notesBefore)
	expect(await applyRecords(w.session.id)).toEqual([])
}

describe("applyHeldAutomatically", () => {
	it("scene-close applies what the closed scene covers and leaves later items held; records carry the cause, never a person", async () => {
		const w = await world()
		const { m, eA, eB, eC } = await threeNotes(w)
		const s1 = await scene(w, {
			openedAtMessageId: m[0]!.id,
			closedAtMessageId: m[1]!.id
		})
		const done = await auto(w.session.id, "scene-close", s1.id)
		expect(done).toMatchObject({
			applied: [eA.id],
			appliedChanges: [],
			userId: w.user.id
		})
		expect(done!.batch).toEqual(expect.any(String))
		expect(await inNotes(w.session.id)).toEqual([eB.id, eC.id])
		const [record] = await applyRecords(w.session.id)
		expect(record).toMatchObject({
			origin: "apply",
			batch: done!.batch,
			subjectKind: "entry",
			subjectId: eA.id,
			cause: {
				automatic: "scene-close",
				sceneId: s1.id,
				sessionId: w.session.id
			}
		})
		expect((record!.cause as any).by).toBeUndefined()
		// Apply settles through what it applied; a held item behind it caps nothing here (m[0] < m[2]).
		expect(done!.settled).toMatchObject({
			moved: true,
			settledMessageId: m[0]!.id
		})
	})

	it("scene-close waits while that scene's summary runs or is in review; scene-summary applies once it is done", async () => {
		const w = await world()
		const { m, eA, eB } = await threeNotes(w)
		const s1 = await scene(w, {
			openedAtMessageId: m[0]!.id,
			closedAtMessageId: m[3]!.id,
			summaryStatus: "running"
		})
		const before = await inNotes(w.session.id)
		expect(await auto(w.session.id, "scene-close", s1.id)).toBeNull()
		await nothingMoved(w, before)
		await db
			.update(schema.scenes)
			.set({ summaryStatus: "review" })
			.where(eq(schema.scenes.id, s1.id))
		expect(await auto(w.session.id, "scene-close", s1.id)).toBeNull()
		await nothingMoved(w, before)
		await db
			.update(schema.scenes)
			.set({ summaryStatus: "done" })
			.where(eq(schema.scenes.id, s1.id))
		const done = await auto(w.session.id, "scene-summary", s1.id)
		expect(done!.applied).toEqual([eA.id, eB.id])
		const records = await applyRecords(w.session.id)
		expect(records.map((r) => (r.cause as any).automatic)).toEqual([
			"scene-summary",
			"scene-summary"
		])
	})

	it("a scene not closed yet, or not this session's, applies nothing", async () => {
		const w = await world()
		const { m } = await threeNotes(w)
		const open = await scene(w, { openedAtMessageId: m[0]!.id })
		const before = await inNotes(w.session.id)
		expect(await auto(w.session.id, "scene-close", open.id)).toBeNull()
		expect(await auto(w.session.id, "scene-close")).toBeNull()
		const other = await sessionOn(w.user.id, w.book.id)
		const theirs = await scene({ ...w, session: other } as World, {
			openedAtMessageId: 1,
			closedAtMessageId: 2
		})
		expect(await auto(w.session.id, "scene-close", theirs.id)).toBeNull()
		await nothingMoved(w, before)
	})

	it("a scene whose summary still runs elsewhere gates items from its start, on any channel", async () => {
		const w = await world()
		const { m, eA, eB, eC } = await threeNotes(w)
		const s1 = await scene(w, {
			openedAtMessageId: m[0]!.id,
			closedAtMessageId: m[4]!.id
		})
		await scene(w, {
			channel: "side",
			openedAtMessageId: m[2]!.id,
			closedAtMessageId: m[3]!.id,
			summaryStatus: "running"
		})
		const done = await auto(w.session.id, "scene-close", s1.id)
		expect(done!.applied).toEqual([eA.id])
		expect(await inNotes(w.session.id)).toEqual([eB.id, eC.id])
		// Items from the waiting start on stay held; close-out is held back the same way.
		expect(await auto(w.session.id, "close-out")).toBeNull()
	})

	it("nothing applies while a turn is taken back (an Apply would discard Forward); `before` leaves the closing stretch held", async () => {
		const w = await world()
		const { m, eA, eB, eC } = await threeNotes(w)
		// Only what was written before the third note's message applies.
		const first = await (await lore()).applyHeldAutomatically(asDb(), {
			sessionId: w.session.id,
			automatic: "close-out",
			before: m[4]!.id
		})
		expect(first).toMatchObject({ applied: [eA.id, eB.id] })
		// A rewound turn in the session: nothing automatic applies, and Forward stays.
		const [rewound] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId: w.session.id,
				role: "assistant",
				content: "…",
				rewindOrdinal: 1,
				isHidden: true
			} as never)
			.returning()
		expect(await auto(w.session.id, "close-out")).toBeNull()
		expect(
			await db
				.select({ id: schema.sessionMessages.id })
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, rewound!.id))
		).toHaveLength(1)
		await db
			.delete(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, rewound!.id))
		expect(await auto(w.session.id, "close-out")).toMatchObject({
			applied: [eC.id]
		})
	})

	it("close-out applies everything eligible and leaves a conflicted change held", async () => {
		const w = await world()
		const { eA, eB, eC } = await threeNotes(w)
		await change(w, w.vault.id, { content: "Sealed." })
		await change(w, w.vault.id, { fields: { category: "Vaults" } })
		const [content, category] = await heldRows(w.session.id)
		await db
			.update(schema.lorebookEntries)
			.set({ content: "Other." })
			.where(eq(schema.lorebookEntries.id, w.vault.id))
		const done = await auto(w.session.id, "close-out")
		expect(done).toMatchObject({
			applied: [eA.id, eB.id, eC.id],
			appliedChanges: [category!.id],
			// Offered, re-checked at accept time, and kept with its reason.
			stillHeld: [
				{
					amendmentId: content!.id,
					reason: "Content has changed in the lorebook since this session changed it."
				}
			]
		})
		expect((await heldRows(w.session.id)).map((h) => h.id)).toEqual([
			content!.id
		])
		const records = await applyRecords(w.session.id)
		expect(new Set(records.map((r) => (r.cause as any).automatic))).toEqual(
			new Set(["close-out"])
		)
		expect(records.every((r) => (r.cause as any).by === undefined)).toBe(
			true
		)
		// Never past the message before the oldest item still held.
		const held = content!.sourceMessageId!
		expect(done!.settled!.settledMessageId).toBeLessThan(held)
	})
})

describe("applyHeldAutomatically folds a chain of changes in order", () => {
	it("a change waiting on an earlier change of this session applies with it, in one Apply", async () => {
		const w = await world()
		await change(w, w.vault.id, { content: "Sealed." })
		await change(w, w.vault.id, { content: "Open." })
		const [first, second] = await heldRows(w.session.id)
		const done = await auto(w.session.id, "close-out")
		expect(done).toMatchObject({
			appliedChanges: [first!.id, second!.id],
			stillHeld: []
		})
		expect(await heldRows(w.session.id)).toEqual([])
	})
})

describe("applyHeldAutomatically does nothing where it must not", () => {
	it("a member's session on the owner's lorebook", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const member = await createTestUser(db, `autoapply-member-${w.suffix}`)
		const theirs = await sessionOn(member.id, w.book.id)
		const m = await messageIn(theirs.id)
		await note(theirs.id, "Ashfall Keep", m.id)
		const before = await inNotes(theirs.id)
		expect(await auto(theirs.id, "close-out")).toBeNull()
		expect(await inNotes(theirs.id)).toEqual(before)
		expect(await applyRecords(theirs.id)).toEqual([])
	})

	it("a branch of the owner's session applies by itself, onto its own line", async () => {
		const w = await world()
		const branch = await sessionOn(w.user.id, w.book.id)
		await db
			.update(schema.sessions)
			.set({ branchOfSessionId: w.session.id, lineOnFirstWrite: true })
			.where(eq(schema.sessions.id, branch.id))
		const m = await messageIn(branch.id)
		const keep = await note(branch.id, "Ashfall Keep", m.id)
		const done = await auto(branch.id, "close-out")
		expect(done).toMatchObject({ applied: [keep.id], userId: w.user.id })
		expect(await inNotes(branch.id)).toEqual([])
		const [record] = await applyRecords(branch.id)
		expect(record).toMatchObject({
			subjectKind: "entry",
			subjectId: keep.id,
			cause: { automatic: "close-out", sessionId: branch.id }
		})
		const [line] = await db
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.lorebookId, w.book.id))
		expect(line).toBeDefined()
		const [moved] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, keep.id))
		expect(moved).toMatchObject({
			lorebookId: w.book.id,
			branchId: line!.id
		})
		const [row] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, branch.id))
		expect(row).toMatchObject({
			lorebookBranchId: line!.id,
			lineOnFirstWrite: false
		})
		const [original] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect(original!.lorebookBranchId).toBeNull()
	})

	it("a branch applies by itself only what it wrote: its copies of the original's waiting rows stay for a press", async () => {
		const w = await world()
		const branch = await sessionOn(w.user.id, w.book.id)
		await db
			.update(schema.sessions)
			.set({ branchOfSessionId: w.session.id, lineOnFirstWrite: true })
			.where(eq(schema.sessions.id, branch.id))
		// A line the branch copied from its original, and a room copied with it;
		// a room with no turn at all; and a room the branch wrote itself.
		const copiedLine = await messageIn(branch.id)
		await db
			.update(schema.sessionMessages)
			.set({ metadata: { copyOf: 1 } as never })
			.where(eq(schema.sessionMessages.id, copiedLine.id))
		const copy = await note(branch.id, "The Drowned Hall", copiedLine.id)
		const unanchored = await note(branch.id, "Nobody's Room", null)
		const own = await messageIn(branch.id)
		const mine = await note(branch.id, "Ashfall Keep", own.id)
		const done = await auto(branch.id, "close-out")
		expect(done).toMatchObject({ applied: [mine.id] })
		expect(await inNotes(branch.id)).toEqual([copy.id, unanchored.id])
		// The original, not a branch, still applies an unanchored row of its own.
		const loose = await note(w.session.id, "Loose End", null)
		expect(await auto(w.session.id, "close-out")).toMatchObject({
			applied: [loose.id]
		})
	})

	for (const mode of ["review", "off"] as const)
		it(`an owner whose setting is ${mode}`, async () => {
			const w = await world(mode)
			const { eA } = await threeNotes(w)
			const before = await inNotes(w.session.id)
			expect(before).toContain(eA.id)
			expect(await auto(w.session.id, "close-out")).toBeNull()
			await nothingMoved(w, before)
		})

	for (const mode of ["review", "off"] as const)
		it(`a lorebook whose own setting is ${mode} while the owner's is Full`, async () => {
			const w = await world("full")
			await db
				.update(schema.lorebooks)
				.set({ loreWriteMode: mode })
				.where(eq(schema.lorebooks.id, w.book.id))
			await threeNotes(w)
			const before = await inNotes(w.session.id)
			expect(await auto(w.session.id, "close-out")).toBeNull()
			await nothingMoved(w, before)
		})

	it("a session that does not exist", async () => {
		expect(await auto(999_999, "close-out")).toBeNull()
	})

	it("an error inside is a warning and null", async () => {
		const w = await world()
		await threeNotes(w)
		const before = await inNotes(w.session.id)
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const broken = new Proxy(db, {
			get: (target, prop, receiver) => {
				if (prop === "select") throw new Error("boom")
				return Reflect.get(target, prop, receiver)
			}
		}) as unknown as Db
		const { applyHeldAutomatically } = await lore()
		expect(
			await applyHeldAutomatically(broken, {
				sessionId: w.session.id,
				automatic: "close-out"
			})
		).toBeNull()
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("[apply]"),
			expect.any(Error)
		)
		warn.mockRestore()
		await nothingMoved(w, before)
	})
})

describe("the two list reads", () => {
	it("overlayAccessOf says who may apply and whether the lorebook applies itself", async () => {
		const w = await world()
		const { overlayAccessOf } = await lore()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const member = await createTestUser(db, `autoapply-reader-${w.suffix}`)
		expect(await overlayAccessOf(asDb(), w.session.id, w.user.id)).toEqual({
			mayApply: true,
			appliesItself: true
		})
		expect(await overlayAccessOf(asDb(), w.session.id, member.id)).toEqual({
			mayApply: false,
			appliesItself: true
		})
		await db
			.update(schema.lorebooks)
			.set({ loreWriteMode: "review" })
			.where(eq(schema.lorebooks.id, w.book.id))
		expect(await overlayAccessOf(asDb(), w.session.id, w.user.id)).toEqual({
			mayApply: true,
			appliesItself: false
		})
	})

	it("appliedBatchesOf lists a press and an automatic Apply, newest first, with who and what", async () => {
		const w = await world()
		const { m, eA, eB, eC } = await threeNotes(w)
		const { applyOverlayItems, appliedBatchesOf } = await lore()
		await db
			.update(schema.users)
			.set({ displayName: "Jo" })
			.where(eq(schema.users.id, w.user.id))
		const pressed = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			entryIds: [eA.id]
		})
		const turn = await change(w, w.vault.id, { content: "Sealed." })
		const s1 = await scene(w, {
			openedAtMessageId: m[0]!.id,
			closedAtMessageId: turn.id
		})
		const automatic = await auto(w.session.id, "scene-close", s1.id)
		const batches = await appliedBatchesOf(asDb(), w.session.id)
		expect(batches.map((b) => b.batch)).toEqual([
			automatic!.batch,
			pressed.batch
		])
		expect(batches[0]).toMatchObject({
			by: null,
			automatic: "scene-close",
			sceneId: s1.id,
			count: 3,
			items: [
				{ kind: "entry", entryId: eB.id, title: "Brine Gate" },
				{ kind: "entry", entryId: eC.id, title: "Cinder Row" },
				{
					kind: "entry-change",
					entryId: w.vault.id,
					title: "The Vault",
					changes: [
						{
							field: "content",
							label: "Content",
							before: "Locked.",
							after: "Sealed."
						}
					]
				}
			]
		})
		expect(batches[1]).toMatchObject({
			by: { userId: w.user.id, name: "Jo" },
			automatic: null,
			sceneId: null,
			count: 1,
			items: [{ kind: "entry", entryId: eA.id, title: "Ashfall Keep" }]
		})
		expect(batches[1]!.at).toEqual(
			expect.stringMatching(/^\d{4}-\d\d-\d\dT/)
		)
	})
})
