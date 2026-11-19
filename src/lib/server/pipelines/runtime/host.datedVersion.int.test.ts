/**
 * Under Full on a lorebook the session's owner owns, a dated session's change
 * to an entry of the lorebook is written at once as a dated version at the
 * session's day, on its line (an `entry_amendments` row with `base` NULL); it
 * never overwrites the stored row and never waits in the notes. It waits
 * (held) when the change is dated before the entry's Beginning, when the
 * session already holds a change on the entry, on another line than the
 * session's, and under Review changes. The turn's undo is its per-turn record.
 * Driven through the real outlets.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
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

const UPDATE = {
	key: "change",
	definitionId: "core:outlet/update-lore-entry"
} as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-dated-version-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

type Clock = { year: number; month: number; day: number }
const DAY: Clock = { year: 10, month: 2, day: 5 }

async function sessionOn(
	userId: number,
	lorebookId: number,
	opts: { clock?: Clock; branchId?: number } = {}
) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId,
			...(opts.branchId ? { lorebookBranchId: opts.branchId } : {}),
			...(opts.clock
				? {
						storyClockYear: opts.clock.year,
						storyClockMonth: opts.clock.month,
						storyClockDay: opts.clock.day
					}
				: {})
		})
		.returning()
	return session!
}

/** A user, a lorebook of theirs (timeline on), and a session on it at `clock` (none: undated). */
async function world(
	opts: { mode?: "full" | "review"; clock?: Clock | null } = {}
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `dated-version-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: opts.mode ?? "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const session = await sessionOn(
		user.id,
		book!.id,
		opts.clock === null ? {} : { clock: opts.clock ?? DAY }
	)
	return { user, book: book!, session, suffix }
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

const hostFor = async (sessionId: number, userId: number, runId: string) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as unknown as Db, { sessionId, userId, runId } as any)
}
/** A turn: a new message and a new run id on the session. */
async function turn(sessionId: number, userId: number) {
	const message = await messageIn(sessionId)
	const host = await hostFor(sessionId, userId, `run-${++n}`)
	return { message, host }
}

const ownBookOf = async (sessionId: number) => {
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	return ownBookFor(db as unknown as Db, sessionId)
}

async function place(
	lorebookId: number,
	title: string,
	fields: Record<string, unknown> = { category: "Rooms" }
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `${title}, as written.`,
			fields
		})
		.returning()
	return row!
}

const stored = async (id: number) =>
	(
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!
const versionsOf = (lorebookId: number, entryId: number) =>
	db
		.select()
		.from(schema.entryAmendments)
		.where(
			and(
				eq(schema.entryAmendments.lorebookId, lorebookId),
				eq(schema.entryAmendments.entryId, entryId),
				isNull(schema.entryAmendments.base)
			)
		)
		.orderBy(schema.entryAmendments.id)
const heldRows = (ownBookId: number) =>
	db
		.select()
		.from(schema.entryAmendments)
		.where(
			and(
				eq(schema.entryAmendments.lorebookId, ownBookId),
				isNotNull(schema.entryAmendments.base)
			)
		)
		.orderBy(schema.entryAmendments.id)
const fieldsOf = async (id: number) =>
	(
		await db
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, id))
	)[0]?.fields
const imprintsOfVersion = (id: number) =>
	db
		.select()
		.from(schema.loreImprints)
		.where(
			and(
				eq(schema.loreImprints.subjectKind, "version"),
				eq(schema.loreImprints.subjectId, id)
			)
		)
const redlinesOf = (entryId: number) =>
	db
		.select()
		.from(schema.loreRedlines)
		.where(eq(schema.loreRedlines.entryId, entryId))
		.orderBy(schema.loreRedlines.id)

/** The text a session reads of an entry. */
async function contentRead(sessionId: number, entryId: number) {
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entryOverlaysFor, entryAt } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const row = await stored(entryId)
	const reading = (await sessionReadingOf(db as unknown as Db, sessionId))!
	const overlays = await entryOverlaysFor(
		db as unknown as Db,
		row.lorebookId,
		reading,
		[entryId]
	)
	return entryAt(toEntryRow(row), overlays, reading).content as
		| string
		| undefined
}

/** A person's version of an entry at a day, written the way the lorebook's own editor does. */
async function personsVersion(
	w: World,
	entryId: number,
	fields: Record<string, unknown>,
	date: Clock = DAY
) {
	const { writeEntryVersion } = await import(
		"$lib/server/lorebooks/entryVersions"
	)
	return db.transaction(async (tx) =>
		writeEntryVersion(tx as unknown as Db, {
			lorebookId: w.book.id,
			entryId,
			branchId: null,
			date: { year: date.year, month: date.month, day: date.day },
			fields
		})
	)
}

const undo = async () => import("$lib/server/state/write")

describe("a dated session's change is written as a dated version", () => {
	it("one version at the session's day, on its line, holding only the changed keys; the stored row is unchanged; nothing waits", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		const { host } = await turn(w.session.id, w.user.id)
		const out: any = await host.commit!(
			{
				entry: vault.id,
				name: "The Vault",
				content: "Sealed.",
				fields: { category: "Rooms" }
			},
			UPDATE
		)
		expect(out).toMatchObject({
			entryId: vault.id,
			route: "book",
			lorebookId: w.book.id
		})
		const versions = await versionsOf(w.book.id, vault.id)
		expect(versions).toHaveLength(1)
		expect(versions[0]).toMatchObject({
			base: null,
			branchId: null,
			year: DAY.year,
			month: DAY.month,
			day: DAY.day,
			fields: { content: "Sealed." }
		})
		expect(await stored(vault.id)).toMatchObject({
			title: "The Vault",
			content: "The Vault, as written."
		})
		expect(await heldRows((await ownBookOf(w.session.id)).id)).toEqual([])
	})

	it("the session reads it at once; a later session of the line reads it, an earlier one and a fork forked before it read the old text", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		const later = await sessionOn(w.user.id, w.book.id, {
			clock: { year: 10, month: 2, day: 9 }
		})
		const earlier = await sessionOn(w.user.id, w.book.id, {
			clock: { year: 10, month: 2, day: 1 }
		})
		const [fork] = await db
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: w.book.id,
				name: `Fork ${w.suffix}`,
				forkYear: 4
			})
			.returning()
		const onFork = await sessionOn(w.user.id, w.book.id, {
			clock: { year: 12, month: 1, day: 1 },
			branchId: fork!.id
		})
		const { host } = await turn(w.session.id, w.user.id)
		await host.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect(await contentRead(w.session.id, vault.id)).toBe("Sealed.")
		expect(await contentRead(later.id, vault.id)).toBe("Sealed.")
		expect(await contentRead(earlier.id, vault.id)).toBe(
			"The Vault, as written."
		)
		expect(await contentRead(onFork.id, vault.id)).toBe(
			"The Vault, as written."
		)
	})

	it("a second change that day updates the same row, by the same session next turn and by another session on the line", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		await (
			await turn(w.session.id, w.user.id)
		).host.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		await (
			await turn(w.session.id, w.user.id)
		).host.commit!(
			{ entry: vault.id, fields: { category: "Vaults" } },
			UPDATE
		)
		const [one] = await versionsOf(w.book.id, vault.id)
		expect(await versionsOf(w.book.id, vault.id)).toHaveLength(1)
		expect(one!.fields).toEqual({ content: "Sealed.", category: "Vaults" })
		const other = await sessionOn(w.user.id, w.book.id, { clock: DAY })
		await (
			await turn(other.id, w.user.id)
		).host.commit!({ entry: vault.id, content: "Unsealed." }, UPDATE)
		expect(await versionsOf(w.book.id, vault.id)).toHaveLength(1)
		expect(await fieldsOf(one!.id)).toEqual({
			content: "Unsealed.",
			category: "Vaults"
		})
	})
})

describe("the turn's undo takes the version back", () => {
	/** The entry, and a turn that changed it: `made` (no version before) or `changed` (a person's at that day). */
	async function turnOne(kind: "made" | "changed") {
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		const person =
			kind === "changed"
				? await personsVersion(w, vault.id, { content: "By hand." })
				: null
		const t = await turn(w.session.id, w.user.id)
		await t.host.commit!(
			{
				entry: vault.id,
				content: "Sealed.",
				fields: { category: "Vaults" }
			},
			UPDATE
		)
		const [row] = await versionsOf(w.book.id, vault.id)
		return { w, vault, person, row: row!, ...t }
	}

	it.each(["made", "changed"] as const)(
		"a swipe or a regenerate, for a version the turn %s",
		async (kind) => {
			const { retractStateAnchoredTo, restoreRetractedState } =
				await undo()
			const { row, message, vault, w } = await turnOne(kind)
			const swiped = await retractStateAnchoredTo(
				db as unknown as Db,
				message.id,
				"replaced"
			)
			expect(swiped.changed).toBe(true)
			if (kind === "made")
				expect(await versionsOf(w.book.id, vault.id)).toEqual([])
			else expect(await fieldsOf(row.id)).toEqual({ content: "By hand." })
			expect(
				await restoreRetractedState(db as unknown as Db, swiped.taken)
			).toBe(true)
			const [back] = await versionsOf(w.book.id, vault.id)
			expect(back!.id).toBe(row.id)
			expect(back!.fields).toEqual({
				content: "Sealed.",
				category: "Vaults"
			})
		}
	)

	it.each(["made", "changed"] as const)(
		"Back or a delete, and Forward, for a version the turn %s",
		async (kind) => {
			const {
				retractStateAnchoredTo,
				restoreRetractedState,
				reviveRetractedState
			} = await undo()
			const { row, message, vault, w } = await turnOne(kind)
			const undone = await db.transaction(async (tx) =>
				retractStateAnchoredTo(
					tx as unknown as Db,
					message.id,
					"leaves",
					{ leavingWith: [message.id] }
				)
			)
			expect(undone.changed).toBe(true)
			if (kind === "made")
				expect(await versionsOf(w.book.id, vault.id)).toEqual([])
			else {
				// A field the turn added is absent, not null.
				expect(await fieldsOf(row.id)).toEqual({ content: "By hand." })
				expect(Object.keys((await fieldsOf(row.id)) as object)).toEqual(
					["content"]
				)
			}
			const record = reviveRetractedState(
				JSON.parse(JSON.stringify(undone.taken)),
				w.session.id
			)!
			expect(
				await restoreRetractedState(db as unknown as Db, record)
			).toBe(true)
			const [back] = await versionsOf(w.book.id, vault.id)
			expect(back!.id).toBe(row.id)
			expect(back!.fields).toEqual({
				content: "Sealed.",
				category: "Vaults"
			})
		}
	)

	it("taking back the second turn restores the first turn's text, not the person's", async () => {
		const { retractStateAnchoredTo } = await undo()
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		const person = await personsVersion(w, vault.id, {
			content: "By hand."
		})
		await (
			await turn(w.session.id, w.user.id)
		).host.commit!({ entry: vault.id, content: "First." }, UPDATE)
		const second = await turn(w.session.id, w.user.id)
		await second.host.commit!(
			{ entry: vault.id, content: "Second." },
			UPDATE
		)
		await retractStateAnchoredTo(
			db as unknown as Db,
			second.message.id,
			"replaced"
		)
		expect(await fieldsOf(person.id)).toEqual({ content: "First." })
	})

	it("another session's later change to the version survives the take-back, as does a person's hand edit", async () => {
		const { retractStateAnchoredTo } = await undo()
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		const first = await turn(w.session.id, w.user.id)
		await first.host.commit!(
			{ entry: vault.id, content: "Sealed." },
			UPDATE
		)
		const [row] = await versionsOf(w.book.id, vault.id)
		const other = await sessionOn(w.user.id, w.book.id, { clock: DAY })
		await (
			await turn(other.id, w.user.id)
		).host.commit!({ entry: vault.id, content: "Theirs." }, UPDATE)
		await retractStateAnchoredTo(
			db as unknown as Db,
			first.message.id,
			"replaced"
		)
		expect(await fieldsOf(row!.id)).toEqual({ content: "Theirs." })
		expect(
			(await imprintsOfVersion(row!.id)).find(
				(i) => i.field === null && i.sessionId === w.session.id
			)
		).toMatchObject({
			status: "kept"
		})

		const w2 = await world()
		const hall = await place(w2.book.id, "The Hall")
		const t = await turn(w2.session.id, w2.user.id)
		await t.host.commit!({ entry: hall.id, content: "Sealed." }, UPDATE)
		const [row2] = await versionsOf(w2.book.id, hall.id)
		await db
			.update(schema.entryAmendments)
			.set({ fields: { content: "By hand." } })
			.where(eq(schema.entryAmendments.id, row2!.id))
		await retractStateAnchoredTo(
			db as unknown as Db,
			t.message.id,
			"replaced"
		)
		expect(await fieldsOf(row2!.id)).toEqual({ content: "By hand." })
	})

	it("settling past the turn: Back no longer takes the version, and its record is settled", async () => {
		const { retractStateAnchoredTo } = await undo()
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		const t = await turn(w.session.id, w.user.id)
		await t.host.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		const [row] = await versionsOf(w.book.id, vault.id)
		const { settleThrough } = await import("$lib/server/sessions/settle")
		await settleThrough(db as unknown as Db, w.session.id, t.message.id, {})
		await expect(
			db.transaction(async (tx) =>
				retractStateAnchoredTo(
					tx as unknown as Db,
					t.message.id,
					"leaves",
					{ leavingWith: [t.message.id] }
				)
			)
		).rejects.toThrow()
		expect(await fieldsOf(row!.id)).toEqual({ content: "Sealed." })
		expect((await imprintsOfVersion(row!.id)).map((i) => i.status)).toEqual(
			expect.arrayContaining(["settled"])
		)
	})
})

describe("the edit history", () => {
	it("files a routine row on the version with the run and the message; Back on a changed version takes its keys back", async () => {
		const { retractStateAnchoredTo } = await undo()
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		const person = await personsVersion(w, vault.id, {
			content: "By hand."
		})
		const t = await turn(w.session.id, w.user.id)
		await t.host.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		const rows = await redlinesOf(vault.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			cause: "routine",
			amendmentId: person.id,
			sessionId: w.session.id,
			messageId: t.message.id
		})
		expect(rows[0]!.runId).toBeTruthy()
		expect(Object.keys(rows[0]!.changes)).toEqual(["content"])
		await retractStateAnchoredTo(
			db as unknown as Db,
			t.message.id,
			"replaced"
		)
		expect(await redlinesOf(vault.id)).toEqual([])
	})
})

describe("dated by history: no clock, but dated history", () => {
	async function historyOnly() {
		const w = await world({ clock: null })
		for (const fields of [
			{ year: 3, month: 2, day: 9 },
			{ year: 7, month: 4, day: 1 }
		])
			await db.insert(schema.lorebookEntries).values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: null,
				content: "…",
				fields
			})
		const vault = await place(w.book.id, "The Vault")
		const t = await turn(w.session.id, w.user.id)
		await t.host.commit!(
			{ entry: vault.id, content: "Sealed." },
			UPDATE
		)
		return { w, vault, ...t }
	}

	it("a dated version at the newest history day; the stored row is untouched", async () => {
		const { w, vault } = await historyOnly()
		const versions = await versionsOf(w.book.id, vault.id)
		expect(versions).toHaveLength(1)
		expect(versions[0]).toMatchObject({
			base: null,
			year: 7,
			month: 4,
			day: 1,
			fields: { content: "Sealed." }
		})
		expect(await stored(vault.id)).toMatchObject({
			content: "The Vault, as written."
		})
	})

	it("Back on that turn removes the version", async () => {
		const { retractStateAnchoredTo } = await undo()
		const { w, vault, message } = await historyOnly()
		expect(await versionsOf(w.book.id, vault.id)).toHaveLength(1)
		const undone = await db.transaction(async (tx) =>
			retractStateAnchoredTo(tx as unknown as Db, message.id, "leaves", {
				leavingWith: [message.id]
			})
		)
		expect(undone.changed).toBe(true)
		expect(await versionsOf(w.book.id, vault.id)).toEqual([])
		expect((await stored(vault.id)).content).toBe("The Vault, as written.")
	})
})

describe("a change that waits", () => {
	it("an entry is not read before its Beginning, so a change at the Beginning's own day is written as a version", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault", {
			category: "Rooms",
			year: DAY.year,
			month: DAY.month,
			day: DAY.day
		})
		const { host } = await turn(w.session.id, w.user.id)
		const out: any = await host.commit!(
			{ entry: vault.id, content: "Sealed." },
			UPDATE
		)
		expect(out.route).toBe("book")
		expect(await versionsOf(w.book.id, vault.id)).toHaveLength(1)
		const early = await world()
		const later = await place(early.book.id, "The Hall", {
			category: "Rooms",
			year: 20
		})
		await expect(
			(await turn(early.session.id, early.user.id)).host.commit!(
				{ entry: later.id, content: "Sealed." },
				UPDATE
			)
		).rejects.toThrow(/is not in this session's lorebook/)
		expect(await versionsOf(early.book.id, later.id)).toEqual([])
		expect(await heldRows((await ownBookOf(early.session.id)).id)).toEqual(
			[]
		)
	})

	it("a session with no moment and no date at all in the lorebook (undatable) writes in place", async () => {
		const w = await world({ clock: null })
		const vault = await place(w.book.id, "The Vault")
		const { host } = await turn(w.session.id, w.user.id)
		await host.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect((await stored(vault.id)).content).toBe("Sealed.")
		expect(await versionsOf(w.book.id, vault.id)).toEqual([])
	})

	it("a session on a lorebook with no timeline (timeless) writes in place, even with a stale clock", async () => {
		const w = await world()
		await db
			.update(schema.lorebooks)
			.set({ timelineEnabled: false })
			.where(eq(schema.lorebooks.id, w.book.id))
		const vault = await place(w.book.id, "The Vault")
		const { host } = await turn(w.session.id, w.user.id)
		await host.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect((await stored(vault.id)).content).toBe("Sealed.")
		expect(await versionsOf(w.book.id, vault.id)).toEqual([])
	})

	it("a session that already holds a change on the entry holds a second one", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		const own = await ownBookOf(w.session.id)
		await db.insert(schema.entryAmendments).values({
			lorebookId: own.id,
			entryId: vault.id,
			branchId: null,
			year: DAY.year,
			month: DAY.month,
			day: DAY.day,
			fields: { content: "Waiting." },
			base: { content: { v: "The Vault, as written." } }
		})
		const { host } = await turn(w.session.id, w.user.id)
		await host.commit!(
			{ entry: vault.id, fields: { category: "Vaults" } },
			UPDATE
		)
		expect(await heldRows(own.id)).toHaveLength(2)
		expect(await versionsOf(w.book.id, vault.id)).toEqual([])
	})

	it("a session on a fork changing main's entry holds the change", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		const [fork] = await db
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: w.book.id,
				name: `Fork ${w.suffix}`,
				forkYear: 4
			})
			.returning()
		const onFork = await sessionOn(w.user.id, w.book.id, {
			clock: { year: 12, month: 1, day: 1 },
			branchId: fork!.id
		})
		const out: any = await (
			await turn(onFork.id, w.user.id)
		).host.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect(out.route).toBe("own-book")
		expect(await versionsOf(w.book.id, vault.id)).toEqual([])
		expect(await heldRows((await ownBookOf(onFork.id)).id)).toHaveLength(1)
	})

	it("under Review changes a dated session's change is held", async () => {
		const w = await world({ mode: "review" })
		const vault = await place(w.book.id, "The Vault")
		const out: any = await (
			await turn(w.session.id, w.user.id)
		).host.commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect(out.route).toBe("own-book")
		expect(await versionsOf(w.book.id, vault.id)).toEqual([])
		expect(await heldRows((await ownBookOf(w.session.id)).id)).toHaveLength(
			1
		)
	})

	it("a history entry's date keys on a dated session are refused with the sentence a held change gives", async () => {
		const w = await world()
		const [day] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: null,
				content: "A day.",
				fields: { year: 3, month: 1, day: 4 }
			})
			.returning()
		const { host } = await turn(w.session.id, w.user.id)
		await expect(
			host.commit!({ entry: day!.id, fields: { year: 5 } }, UPDATE)
		).rejects.toThrow(
			/keeps its date in the lorebook, and a session's change cannot move it — change it in the lorebook\./
		)
		expect(await versionsOf(w.book.id, day!.id)).toEqual([])
	})
})
