/**
 * The story-clock stamp on a stat value (lane sense-age2, owner ruling
 * 2026-11-11: "tracking stat time relative to the session").
 *
 * A value a session writes carries the session's story clock at that moment; a
 * value no session wrote carries none. `valueStampsOf` answers the stamp and
 * `created_at` of the exact row `valueOf` reads from. Every path that copies a
 * whole row (a branch, retract then restore, Back then Forward) keeps it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-value-stamp-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const MANA = "core:slot/mana@1"
const GENRE = "test:genre/value-stamp"

function declareSlots() {
	_clearAttributeSlots()
	const declared = [
		defineAttributeSlot(HP, {
			type: "integer",
			descriptor: "How much punishment they can still take.",
			appliesTo: ["cast"],
			config: { min: 0, max: 20 },
			default: 20
		}),
		defineAttributeSlot(MANA, {
			type: "integer",
			descriptor: "How much power they can still spend.",
			appliesTo: ["cast"],
			config: { min: 0, max: 20 }
		})
	]
	genreKeeping(GENRE, {
		name: { en: "Stamp" },
		family: "test",
		slots: declared,
		events: {}
	})
}

const d = () => db as unknown as Db
let n = 0

async function world(
	clock: {
		year: number
		month?: number
		day?: number
		hour?: number
		minute?: number
	} | null
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `value-stamp-${suffix}`)
	const [verity] = await db
		.insert(schema.characters)
		.values({ userId: user.id, name: `Verity ${suffix}`, description: "…" })
		.returning()
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId: GENRE,
			lorebookId: lorebook.id,
			storyClockYear: clock?.year ?? null,
			storyClockMonth: clock?.month ?? null,
			storyClockDay: clock?.day ?? null,
			storyClockHour: clock?.hour ?? null,
			storyClockMinute: clock?.minute ?? null
		})
		.returning()
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: verity.id })
	const message = async (
		speakerId?: number,
		role: "assistant" | "user" = "assistant"
	) => {
		const [legacy] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role,
				characterId: role === "assistant" ? (speakerId ?? null) : null,
				userId: role === "user" ? user.id : null,
				content: "…"
			})
			.returning()
		await db.insert(schema.messages).values({
			id: legacy.id,
			sessionId: session.id,
			characterId: role === "assistant" ? (speakerId ?? null) : null,
			role
		})
		return legacy
	}
	const owner = { kind: "session_cast" as const, id: verity.id }
	const ctx = (messageId?: number) => ({
		sessionId: session.id,
		updatedBy: "user" as const,
		userId: user.id,
		...(messageId !== undefined ? { messageId, ownAnchor: true } : {})
	})
	return { user, verity, lorebook, session, message, owner, ctx }
}

const columnsOf = (r: typeof schema.attributeValues.$inferSelect) => [
	r.storyClockYear,
	r.storyClockMonth,
	r.storyClockDay,
	r.storyClockHour,
	r.storyClockMinute
]

const rowsOf = async (sessionId: number) =>
	await db
		.select()
		.from(schema.attributeValues)
		.where(eq(schema.attributeValues.sessionId, sessionId))
		.orderBy(asc(schema.attributeValues.id))

describe("setValue stamps the session's story clock", () => {
	test("a session with a clock stamps all five; a session with none stamps none", async () => {
		declareSlots()
		const { setValue } = await import("./write")
		const withClock = await world({
			year: 1204,
			month: 3,
			day: 5,
			hour: 9,
			minute: 30
		})
		await setValue(d(), withClock.ctx(), {
			owner: withClock.owner,
			slotId: HP,
			value: 12
		})
		expect(columnsOf((await rowsOf(withClock.session.id))[0]!)).toEqual([
			1204, 3, 5, 9, 30
		])

		const none = await world(null)
		await setValue(d(), none.ctx(), {
			owner: none.owner,
			slotId: HP,
			value: 12
		})
		expect(columnsOf((await rowsOf(none.session.id))[0]!)).toEqual([
			null,
			null,
			null,
			null,
			null
		])
	})
})

describe("valueStampsOf", () => {
	test("answers the in-force row's stamp and writtenAt; null for a default; a later write at a moved clock answers the newer stamp", async () => {
		declareSlots()
		const { setValue } = await import("./write")
		const { valueStampsOf } = await import("./resolve")
		const w = await world({ year: 1204, month: 3, day: 5 })
		await setValue(d(), w.ctx(), { owner: w.owner, slotId: HP, value: 12 })
		const [first] = await rowsOf(w.session.id)

		const one = await valueStampsOf(d(), w.session.id, w.owner, [HP, MANA])
		expect(one.get(HP)).toEqual({
			clock: { year: 1204, month: 3, day: 5, hour: null, minute: null },
			writtenAt: first!.createdAt
		})
		// Never written: HP's default and MANA's absence are not rows.
		expect(one.get(MANA)).toBeNull()

		await db
			.update(schema.sessions)
			.set({ storyClockYear: 1204, storyClockMonth: 4, storyClockDay: 1 })
			.where(eq(schema.sessions.id, w.session.id))
		await setValue(d(), w.ctx(), { owner: w.owner, slotId: HP, value: 7 })
		const rows = await rowsOf(w.session.id)
		const two = await valueStampsOf(d(), w.session.id, w.owner, [HP])
		expect(two.get(HP)).toEqual({
			clock: { year: 1204, month: 4, day: 1, hour: null, minute: null },
			writtenAt: rows[1]!.createdAt
		})
		const { valueOf } = await import("./resolve")
		expect(
			await valueOf(d(), {
				sessionId: w.session.id,
				owner: w.owner,
				slotId: HP
			})
		).toBe(7)

		// A slot with no row at all, and no default, reads no stamp.
		const fresh = await world({ year: 1, month: 1, day: 1 })
		expect(
			(await valueStampsOf(d(), fresh.session.id, fresh.owner, [HP])).get(
				HP
			)
		).toBeNull()
	})
})

describe("a write no session made carries no stamp", () => {
	test("a card editor's value reads null on the five columns", async () => {
		declareSlots()
		const { applyCardChanges } = await import("./cardState")
		const w = await world({ year: 1204, month: 3, day: 5 })
		await applyCardChanges(d(), {
			characterId: w.verity.id,
			userId: w.user.id,
			changes: [{ slotId: HP, value: 9 }]
		})
		const rows = await db
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.ownerKind, "card"))
		const mine = rows.filter((r) => r.ownerId === w.verity.id)
		expect(mine).toHaveLength(1)
		expect(columnsOf(mine[0]!)).toEqual([null, null, null, null, null])
	})
})

describe("copies keep the stamp", () => {
	test("a branch keeps a copied value's stamp and createdAt", async () => {
		declareSlots()
		const { setValue } = await import("./write")
		const w = await world({
			year: 1204,
			month: 3,
			day: 5,
			hour: 9,
			minute: 30
		})
		const first = await w.message(w.verity.id)
		const fork = await w.message(w.verity.id)
		await setValue(d(), w.ctx(first.id), {
			owner: w.owner,
			slotId: HP,
			value: 12
		})
		const [source] = await rowsOf(w.session.id)
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db, {
			sessionId: w.session.id,
			fromMessageId: fork.id,
			title: "Another bell"
		})
		const [copy] = await rowsOf(branch.id)
		expect(copy).toBeTruthy()
		expect(copy!.id).not.toBe(source!.id)
		expect(columnsOf(copy!)).toEqual([1204, 3, 5, 9, 30])
		expect(copy!.createdAt).toEqual(source!.createdAt)
	})

	test("an as-of read at a copied later message returns the copied value, as in the source", async () => {
		declareSlots()
		const { setValue, valueOf } = await Promise.all([
			import("./write"),
			import("./resolve")
		]).then(([a, b]) => ({ setValue: a.setValue, valueOf: b.valueOf }))
		const w = await world({ year: 1204, month: 3, day: 5 })
		const m1 = await w.message(w.verity.id)
		await setValue(d(), w.ctx(m1.id), {
			owner: w.owner,
			slotId: HP,
			value: 12
		})
		// m2 is created after the write.
		await new Promise((r) => setTimeout(r, 20))
		const m2 = await w.message(w.verity.id)
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db, {
			sessionId: w.session.id,
			fromMessageId: m2.id,
			title: "Later fork"
		})
		const [copiedMessage] = await db
			.select()
			.from(schema.messages)
			.where(eq(schema.messages.sessionId, branch.id))
			.orderBy(desc(schema.messages.id))
		expect(copiedMessage).toBeTruthy()
		const inSource = await valueOf(d(), {
			sessionId: w.session.id,
			owner: w.owner,
			slotId: HP,
			asOfMessageId: m2.id
		})
		const inBranch = await valueOf(d(), {
			sessionId: branch.id,
			owner: w.owner,
			slotId: HP,
			asOfMessageId: copiedMessage!.id
		})
		expect(inSource).toBe(12)
		expect(inBranch).toBe(inSource)
	})

	test("retract then restore puts the row back with the same stamp", async () => {
		declareSlots()
		const { setValue, retractStateAnchoredTo, restoreRetractedState } =
			await import("./write")
		const w = await world({
			year: 1204,
			month: 3,
			day: 5,
			hour: 9,
			minute: 30
		})
		const m = await w.message(w.verity.id)
		await setValue(d(), w.ctx(m.id), {
			owner: w.owner,
			slotId: HP,
			value: 12
		})
		const [before] = await rowsOf(w.session.id)
		// The clock moves on; the restored row keeps the clock it was written at.
		await db
			.update(schema.sessions)
			.set({ storyClockDay: 9 })
			.where(eq(schema.sessions.id, w.session.id))
		const undone = await retractStateAnchoredTo(d(), m.id, "replaced")
		expect(await rowsOf(w.session.id)).toHaveLength(0)
		await restoreRetractedState(d(), undone.taken)
		const [after] = await rowsOf(w.session.id)
		expect(columnsOf(after!)).toEqual([1204, 3, 5, 9, 30])
		expect(after!.createdAt).toEqual(before!.createdAt)
	})

	test("Back then Forward puts the row back with the same stamp", async () => {
		declareSlots()
		const { setValue } = await import("./write")
		const { rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		const w = await world({
			year: 1204,
			month: 3,
			day: 5,
			hour: 9,
			minute: 30
		})
		await w.message(undefined, "user")
		const m = await w.message(w.verity.id)
		await setValue(d(), w.ctx(m.id), {
			owner: w.owner,
			slotId: HP,
			value: 12
		})
		const [before] = await rowsOf(w.session.id)
		const back = await rewindTurn(d(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(back).toMatchObject({ ok: true })
		expect(await rowsOf(w.session.id)).toHaveLength(0)
		const forward = await forwardTurn(d(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(forward).toMatchObject({ ok: true })
		const [after] = await rowsOf(w.session.id)
		expect(columnsOf(after!)).toEqual([1204, 3, 5, 9, 30])
		expect(after!.createdAt).toEqual(before!.createdAt)
	})
})
