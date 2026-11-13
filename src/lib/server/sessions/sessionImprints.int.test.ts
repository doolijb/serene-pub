/**
 * Session imprints (ST3): filing, the one retraction rule on session rows,
 * restore, settle, a branch's read, and the pure conversion of an old record.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	annexImprintKey,
	fileSessionImprint,
	restoreSessionImprints,
	retractSessionImprints,
	seatBenchKey,
	sessionImprintsAfter,
	sessionImprintsFromOldRecord,
	settleSessionImprints,
	type SessionImprintKind
} from "./sessionImprints"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string
let userId: number
let n = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "session-imprints-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-session-imprints-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "session-imprints-owner")).id
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const asDb = () => db as unknown as Db

async function world() {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: `Imprints ${++n}` })
		.returning()
	const sessionId = session!.id
	const anchor = (messageId: number | null, runId: string | null = null) => ({
		sessionId,
		messageId,
		runId
	})
	const file = (
		messageId: number | null,
		kind: SessionImprintKind,
		key: string,
		before: unknown,
		after: unknown,
		annex?: Parameters<typeof fileSessionImprint>[5]
	) =>
		db.transaction((tx) =>
			fileSessionImprint(
				tx as unknown as Db,
				anchor(messageId),
				{ kind, key },
				before,
				after,
				annex
			)
		)
	const retract = (
		messageIds: number[],
		opts?: Parameters<typeof retractSessionImprints>[2]
	) =>
		db.transaction((tx) =>
			retractSessionImprints(
				tx as unknown as Db,
				{ sessionId, messageIds },
				opts
			)
		)
	const restore = (taken: Parameters<typeof restoreSessionImprints>[1]) =>
		db.transaction((tx) =>
			restoreSessionImprints(tx as unknown as Db, taken)
		)
	const rows = () =>
		db
			.select()
			.from(schema.sessionImprints)
			.where(eq(schema.sessionImprints.sessionId, sessionId))
			.orderBy(schema.sessionImprints.id)
	const row = async () =>
		(
			await db
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
		)[0]!
	const seat = async (kind: "character" | "player", isActive = true) => {
		const [s] =
			kind === "character"
				? await db
						.insert(schema.sessionCharacters)
						.values({ sessionId, isActive })
						.returning()
				: await db
						.insert(schema.sessionPersonas)
						.values({ sessionId, isActive })
						.returning()
		return s!
	}
	const active = async (kind: "character" | "player", id: number) => {
		const t =
			kind === "character"
				? schema.sessionCharacters
				: schema.sessionPersonas
		return (
			await db.select({ a: t.isActive }).from(t).where(eq(t.id, id))
		)[0]!.a
	}
	return { sessionId, file, retract, restore, rows, row, seat, active }
}

describe("filing", () => {
	it("files nothing without an anchor message, and nothing for a write that changed nothing", async () => {
		const w = await world()
		await w.file(null, "deck", "d", { a: 1 }, { a: 2 })
		await w.file(1, "deck", "d", { a: 1 }, { a: 1 })
		await w.file(1, "annex", "acme/k", 1, 1, {
			ownerVersion: "1",
			audienceBefore: ["a"],
			audienceAfter: ["a"]
		})
		expect(await w.rows()).toEqual([])
	})
	it("files an annex write whose value is the same but whose audience moved; wraps, NULL for absent", async () => {
		const w = await world()
		await w.file(1, "annex", "acme/k", 1, 1, {
			ownerVersion: "2.0",
			audienceBefore: null,
			audienceAfter: ["x"]
		})
		await w.file(1, "deck", "d", undefined, { cards: [1] })
		const [a, d] = await w.rows()
		expect(a).toMatchObject({
			ownerVersion: "2.0",
			audienceBefore: null,
			audienceAfter: ["x"],
			before: { v: 1 },
			after: { v: 1 },
			status: "standing"
		})
		expect(d).toMatchObject({
			before: null,
			after: { v: { cards: [1] } },
			ownerVersion: null
		})
	})
})

describe("each kind reverts", () => {
	it("seat-bench: the seat comes back through the one writer", async () => {
		const w = await world()
		const c = await w.seat("character", false)
		const p = await w.seat("player", true)
		await w.file(
			5,
			"seat-bench",
			seatBenchKey("character", c.id),
			false,
			true
		)
		await w.file(5, "seat-bench", seatBenchKey("player", p.id), true, false)
		const r = await w.retract([5])
		expect(await w.active("character", c.id)).toBe(true)
		expect(await w.active("player", p.id)).toBe(false)
		expect(r.changed).toBe(true)
		expect(r.seatChanges).toHaveLength(2)
		expect(r.taken.map((t) => t.act)).toEqual(["reverted", "reverted"])
		expect(await w.rows()).toEqual([])
	})
	it("seat-bench: a seat gone is dropped, never a throw", async () => {
		const w = await world()
		await w.file(
			5,
			"seat-bench",
			seatBenchKey("character", 999999),
			false,
			true
		)
		const r = await w.retract([5])
		expect(r.taken.map((t) => t.act)).toEqual(["dropped"])
		expect(r.changed).toBe(false)
	})
	it("ruleset-conversion: the session's version goes back (and to none)", async () => {
		const w = await world()
		await db
			.update(schema.sessions)
			.set({ rulesetVersion: "2" })
			.where(eq(schema.sessions.id, w.sessionId))
		await w.file(7, "ruleset-conversion", "core:ruleset/x", "1", "2")
		await w.retract([7])
		expect((await w.row()).rulesetVersion).toBe("1")
		await w.file(8, "ruleset-conversion", "core:ruleset/x", undefined, "1")
		await w.retract([8])
		expect((await w.row()).rulesetVersion).toBeNull()
	})
	it("deck: the key goes back, or is removed when it had none", async () => {
		const w = await world()
		await db
			.update(schema.sessions)
			.set({ rulesetDecks: { d: { n: 2 }, other: { n: 9 } } as never })
			.where(eq(schema.sessions.id, w.sessionId))
		await w.file(3, "deck", "d", { n: 1 }, { n: 2 })
		await w.retract([3])
		expect((await w.row()).rulesetDecks).toEqual({
			d: { n: 1 },
			other: { n: 9 }
		})
		await w.file(4, "deck", "d", undefined, { n: 1 })
		await w.retract([4])
		expect((await w.row()).rulesetDecks).toEqual({ other: { n: 9 } })
	})
	it("annex: value, audience and version; owners and documents left empty are removed; no updated_at moves", async () => {
		const w = await world()
		await db
			.update(schema.sessions)
			.set({
				annex: { acme: { k: 2, j: 1 }, solo: { z: 1 } } as never,
				annexAudiences: {
					acme: { k: ["me"] },
					solo: { z: ["me"] }
				} as never,
				annexVersions: { acme: 4 } as never
			})
			.where(eq(schema.sessions.id, w.sessionId))
		const stamp = (await w.row()).updatedAt
		await w.file(9, "annex", "acme/k", 1, 2, {
			ownerVersion: null,
			audienceBefore: null,
			audienceAfter: ["me"]
		})
		await w.file(9, "annex", "solo/z", undefined, 1, {
			ownerVersion: null,
			audienceBefore: null,
			audienceAfter: ["me"]
		})
		await w.retract([9])
		const s = await w.row()
		expect(s.annex).toEqual({ acme: { k: 1, j: 1 } })
		expect(s.annexAudiences).toEqual({})
		expect(s.annexVersions).toEqual({ acme: 5, solo: 1 })
		expect(s.updatedAt).toEqual(stamp)
	})
	it("annex: an owner id with a slash splits at the last one", async () => {
		const w = await world()
		await db
			.update(schema.sessions)
			.set({ annex: { "me/plug": { k: 2 } } as never })
			.where(eq(schema.sessions.id, w.sessionId))
		await w.file(9, "annex", annexImprintKey("me/plug", "k"), 1, 2)
		await w.retract([9])
		expect((await w.row()).annex).toEqual({ "me/plug": { k: 1 } })
	})
})

describe("the one rule on session rows", () => {
	it("splices when two writes of one key chain, drops when they do not", async () => {
		const w = await world()
		await db
			.update(schema.sessions)
			.set({ rulesetDecks: { d: 3 } as never })
			.where(eq(schema.sessions.id, w.sessionId))
		await w.file(1, "deck", "d", 1, 2)
		await w.file(2, "deck", "d", 2, 3)
		const r = await w.retract([1])
		expect(r.taken.map((t) => t.act)).toEqual(["spliced"])
		expect((await w.row()).rulesetDecks).toEqual({ d: 3 }) // the later turn's now
		const left = await w.rows()
		expect(left).toHaveLength(1)
		expect(left[0]!.before).toEqual({ v: 1 })
		// a person overwrote: the later row began somewhere else
		await w.file(3, "deck", "e", 10, 11)
		await w.file(4, "deck", "e", 50, 51)
		const r2 = await w.retract([3])
		expect(r2.taken.map((t) => t.act)).toEqual(["dropped"])
	})
	it("two turns drawing from one deck: the earlier taken leaves the deck where the later draw left it; taking the later lands before both", async () => {
		const w = await world()
		const s0 = { cards: [1, 2, 3, 4] }
		const s1 = { cards: [2, 3, 4] }
		const s2 = { cards: [3, 4] }
		await db
			.update(schema.sessions)
			.set({ rulesetDecks: { d: s2 } as never })
			.where(eq(schema.sessions.id, w.sessionId))
		await w.file(10, "deck", "d", s0, s1)
		await w.file(11, "deck", "d", s1, s2)
		await w.retract([10])
		expect((await w.row()).rulesetDecks).toEqual({ d: s2 })
		await w.retract([11])
		expect((await w.row()).rulesetDecks).toEqual({ d: s0 })
		expect(await w.rows()).toEqual([])
	})
	it("takes a message's rows newest first (one message, one key twice)", async () => {
		const w = await world()
		await db
			.update(schema.sessions)
			.set({ rulesetDecks: { d: 3 } as never })
			.where(eq(schema.sessions.id, w.sessionId))
		await w.file(1, "deck", "d", 1, 2)
		await w.file(1, "deck", "d", 2, 3)
		const r = await w.retract([1])
		expect(
			r.taken.map((t) => (t.imprint.after as { v: number }).v)
		).toEqual([3, 2])
		expect((await w.row()).rulesetDecks).toEqual({ d: 1 })
	})
	it("keep leaves a row as it is, above takes it in full", async () => {
		const w = await world()
		await db
			.update(schema.sessions)
			.set({ rulesetDecks: { a: 2, b: 2 } as never })
			.where(eq(schema.sessions.id, w.sessionId))
		await w.file(1, "deck", "a", 1, 2)
		await w.file(1, "deck", "b", 1, 2)
		const r = await w.retract([1], { keep: (x) => x.subjectKey === "a" })
		expect(r.taken).toHaveLength(1)
		expect((await w.row()).rulesetDecks).toEqual({ a: 2, b: 1 })
		expect(await w.rows()).toHaveLength(1)
		const [kept] = await w.rows()
		const r2 = await w.retract([1], {
			keep: () => true,
			above: kept!.id - 1
		})
		expect(r2.taken).toHaveLength(1)
		expect((await w.row()).rulesetDecks).toEqual({ a: 1, b: 1 })
	})
	it("only the session's standing rows of the named messages", async () => {
		const w = await world()
		const other = await world()
		await w.file(1, "deck", "a", 1, 2)
		await w.file(2, "deck", "b", 1, 2)
		await other.file(1, "deck", "a", 1, 2)
		expect((await w.retract([])).taken).toEqual([])
		expect((await w.retract([1])).taken).toHaveLength(1)
		expect(await w.rows()).toHaveLength(1)
		expect(await other.rows()).toHaveLength(1)
	})
})

describe("restore", () => {
	it("puts back every kind, ids and all, and the later row's before after a splice", async () => {
		const w = await world()
		const c = await w.seat("character", false)
		await db
			.update(schema.sessions)
			.set({
				rulesetVersion: "2",
				rulesetDecks: { d: 3 } as never,
				annex: { acme: { k: 2 } } as never,
				annexAudiences: { acme: { k: ["me"] } } as never
			})
			.where(eq(schema.sessions.id, w.sessionId))
		await w.file(
			1,
			"seat-bench",
			seatBenchKey("character", c.id),
			false,
			true
		)
		await db
			.update(schema.sessionCharacters)
			.set({ isActive: false })
			.where(eq(schema.sessionCharacters.id, c.id))
		await w.file(1, "ruleset-conversion", "r", "1", "2")
		await w.file(1, "deck", "d", 1, 2)
		await w.file(2, "deck", "d", 2, 3)
		await w.file(1, "annex", "acme/k", 1, 2, {
			ownerVersion: null,
			audienceBefore: null,
			audienceAfter: ["me"]
		})
		const before = await w.rows()
		const r = await w.retract([1])
		expect(r.taken.map((t) => t.act)).toEqual([
			"reverted",
			"spliced",
			"reverted",
			"reverted"
		])
		const back = await w.restore(r.taken)
		expect(back.changed).toBe(true)
		expect(back.seatChanges).toHaveLength(1)
		expect(await w.active("character", c.id)).toBe(false)
		const s = await w.row()
		expect(s.rulesetVersion).toBe("2")
		expect(s.rulesetDecks).toEqual({ d: 3 })
		expect(s.annex).toEqual({ acme: { k: 2 } })
		expect(s.annexAudiences).toEqual({ acme: { k: ["me"] } })
		expect(await w.rows()).toEqual(before)
	})
	it("leaves a seat a person set the other way, and a stored value that moved", async () => {
		const w = await world()
		const c = await w.seat("character", false)
		await w.file(
			1,
			"seat-bench",
			seatBenchKey("character", c.id),
			false,
			true
		)
		const r = await w.retract([1])
		expect(await w.active("character", c.id)).toBe(true)
		// a person benched it again: it no longer reads as the retraction left it
		await db
			.update(schema.sessionCharacters)
			.set({ isActive: false })
			.where(eq(schema.sessionCharacters.id, c.id))
		const back = await w.restore(r.taken)
		expect(back.changed).toBe(false)
		expect(await w.active("character", c.id)).toBe(false) // already the run's value; nothing moved
		// the person changed a deck since
		await db
			.update(schema.sessions)
			.set({ rulesetDecks: { d: 1 } as never })
			.where(eq(schema.sessions.id, w.sessionId))
		await w.file(2, "deck", "d", 1, 2)
		const r2 = await w.retract([2])
		await db
			.update(schema.sessions)
			.set({ rulesetDecks: { d: 77 } as never })
			.where(eq(schema.sessions.id, w.sessionId))
		await w.restore(r2.taken)
		expect((await w.row()).rulesetDecks).toEqual({ d: 77 })
		// nothing landed, so no row is filed again: a row whose `after` never
		// landed would revert over the person's value when its turn is taken later
		expect(await w.rows()).toEqual([])
		expect((await w.retract([1, 2])).taken).toEqual([])
		expect((await w.row()).rulesetDecks).toEqual({ d: 77 })
	})
	it("a seat a person set the other way is left", async () => {
		const w = await world()
		const c = await w.seat("character", true)
		await w.file(
			1,
			"seat-bench",
			seatBenchKey("character", c.id),
			false,
			true
		)
		// the run benched it; the person brought it back, so the retraction found it in play
		const r = await w.retract([1])
		expect(r.changed).toBe(false)
		const back = await w.restore(r.taken)
		// the retraction moved nothing, so the row was dropped, not taken: a person's
		// later bench or drag wins and Forward does not bench the seat again (owner 2026-11-10)
		expect(r.taken.map((t) => t.act)).toEqual(["dropped"])
		expect(back.changed).toBe(false)
		expect(await w.active("character", c.id)).toBe(true)
	})
	it("an annex row from an older owner version still lands its value", async () => {
		const w = await world()
		await db
			.update(schema.sessions)
			.set({ annex: { acme: { k: 1 } } as never })
			.where(eq(schema.sessions.id, w.sessionId))
		await w.file(1, "annex", "acme/k", 1, 2, {
			ownerVersion: "0.1.0",
			audienceBefore: null,
			audienceAfter: null
		})
		const r = await w.retract([1])
		await w.restore(r.taken)
		expect((await w.row()).annex).toEqual({ acme: { k: 2 } })
	})
})

describe("settle and a branch", () => {
	it("settle marks rows at or before the line, before gone; the rest stand", async () => {
		const w = await world()
		await w.file(5, "deck", "d", 1, 2, undefined)
		await w.file(6, "annex", "a/k", 1, 2, {
			ownerVersion: null,
			audienceBefore: ["x"],
			audienceAfter: null
		})
		await w.file(7, "deck", "d", 2, 3)
		await db.transaction((tx) =>
			settleSessionImprints(tx as unknown as Db, w.sessionId, 6)
		)
		const rows = await w.rows()
		expect(rows.map((r) => r.status)).toEqual([
			"settled",
			"settled",
			"standing"
		])
		expect(rows[0]).toMatchObject({ before: null, after: { v: 2 } })
		expect(rows[1]!.audienceBefore).toBeNull()
		expect(rows[2]!.before).toEqual({ v: 2 })
		expect((await w.retract([5, 6])).taken).toEqual([])
	})
	it("a bench the settle line has passed still reads as the seat's last bench", async () => {
		const { standingSeatBenches } = await import("./sessionImprints")
		const w = await world()
		const c = await w.seat("character", false)
		const key = seatBenchKey("character", c.id)
		await w.file(5, "seat-bench", key, false, true)
		await db.transaction((tx) =>
			settleSessionImprints(tx as unknown as Db, w.sessionId, 6)
		)
		expect((await w.rows()).map((r) => r.status)).toEqual(["settled"])
		expect((await standingSeatBenches(asDb(), w.sessionId)).get(key)).toBe(true)
	})
	it("sessionImprintsAfter: standing rows past the fork, newest first", async () => {
		const w = await world()
		await w.file(5, "deck", "d", 1, 2)
		await w.file(8, "deck", "d", 2, 3)
		await w.file(9, "deck", "e", 1, 2)
		const after = await sessionImprintsAfter(asDb(), w.sessionId, 5)
		expect(after.map((r) => r.messageId)).toEqual([9, 8])
	})
})

describe("sessionImprintsFromOldRecord (pure)", () => {
	const delta = (
		over: Record<string, unknown>,
		extra: Record<string, unknown> = {}
	) => ({
		row: {
			sessionId: 1,
			messageId: 4,
			owner: "acme",
			ownerVersion: "1.2.0",
			before: { document: { a: 1, same: 0 }, audiences: null },
			after: {
				document: { a: 2, b: 3, same: 0 },
				audiences: { b: ["me"] }
			},
			runId: "run-1",
			createdAt: "2026-11-01T00:00:00.000Z",
			...over
		},
		reverted: true,
		...extra
	})
	it("converts seat benches and conversions as reverted rows without ids", () => {
		const out = sessionImprintsFromOldRecord(
			{
				seatBenches: [
					{
						messageId: 3,
						kind: "player",
						seatId: 8,
						from: false,
						to: true
					},
					{
						messageId: 3,
						kind: "bad",
						seatId: 8,
						from: false,
						to: true
					}
				],
				conversions: [
					{ messageId: 3, rulesetId: "r", from: "1", to: "2" },
					{ messageId: "x" }
				]
			},
			42
		)
		expect(
			out.map((t) => [t.act, t.imprint.subjectKind, t.imprint.subjectKey])
		).toEqual([
			["reverted", "seat-bench", "player:8"],
			["reverted", "ruleset-conversion", "r"]
		])
		expect(out[0]!.imprint).toMatchObject({
			sessionId: 42,
			messageId: 3,
			before: { v: false },
			after: { v: true },
			status: "standing"
		})
		expect("id" in out[0]!.imprint).toBe(false)
		expect(out[0]!.imprint.createdAt).toBeInstanceOf(Date)
	})
	it("converts an annex delta to one row per key that changed in value or audience", () => {
		const out = sessionImprintsFromOldRecord(
			{ annexDeltas: [delta({})] },
			1
		)
		expect(out.map((t) => t.imprint.subjectKey)).toEqual([
			"acme/a",
			"acme/b"
		])
		expect(out[0]!.imprint).toMatchObject({
			before: { v: 1 },
			after: { v: 2 },
			ownerVersion: "1.2.0",
			runId: "run-1",
			audienceBefore: null,
			audienceAfter: null
		})
		expect(out[1]!.imprint).toMatchObject({
			before: null,
			after: { v: 3 },
			audienceAfter: ["me"]
		})
		expect(out.every((t) => t.act === "reverted")).toBe(true)
	})
	it("a delta that was not reverted is dropped; kept, the legacy owner, core's runtime keys and malformed entries are skipped", () => {
		const out = sessionImprintsFromOldRecord(
			{
				annexDeltas: [
					delta({}, { reverted: false }),
					delta({}, { kept: true }),
					delta({ owner: "core:revision-points" }),
					delta({
						owner: "core",
						before: {
							document: { turnOrder: 1, "retake-quietly": false },
							audiences: null
						},
						after: {
							document: { turnOrder: 2, "retake-quietly": true },
							audiences: null
						}
					}),
					{ row: 5 },
					null
				]
			},
			1
		)
		expect(out.map((t) => [t.act, t.imprint.subjectKey])).toEqual([
			["dropped", "acme/a"],
			["dropped", "acme/b"],
			["reverted", "core/retake-quietly"]
		])
	})
	it("an empty or unknown record converts to nothing", () => {
		expect(sessionImprintsFromOldRecord({}, 1)).toEqual([])
		expect(
			sessionImprintsFromOldRecord(
				{ annexDeltas: "x", seatBenches: 3 },
				1
			)
		).toEqual([])
	})
})
