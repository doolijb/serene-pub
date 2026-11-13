/**
 * 🚧 ST3, plan §1.9 F1 (Rule 3): a branch is the session as of the fork. The
 * parent's session imprints after the fork are folded backwards onto
 * `ruleset_decks`, `ruleset_version`, the seat bench flags and the annex; the
 * story lane's turn tally is replayed over the branch's own history; the
 * imprint rows up to the fork come across under the copied messages, their seat
 * keys moved to the branch's seats.
 *
 * The test files the rows with `fileSessionImprint` and sets the values as the
 * writers would (the writers are worker-4's and are tested in their own files).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-branch-as-of-fork-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const asDb = () => db as unknown as Db
let n = 0

describe("a branch is the session as of the fork (F1)", () => {
	test("a branch cut before a draw, a bench, a conversion and an annex write sees none of them; its copied rows anchor to its own messages", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { insertLegacy } = await import("$lib/server/messages/store")
		const { fileSessionImprint, seatBenchKey } = await import(
			"$lib/server/sessions/sessionImprints"
		)
		const { branchSession } = await import("./branch")
		const suffix = ++n
		const user = await createTestUser(db, `as-of-fork-${suffix}`)
		const [lorebook] = await db
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: `Fork book ${suffix}` })
			.returning()
		const [card] = await db
			.insert(schema.characters)
			.values({ userId: user.id, name: "Mara", description: "A miller." })
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: `Fork ${suffix}`,
				lorebookId: lorebook!.id
			})
			.returning()
		const sessionId = session!.id
		const [seat] = await db
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId: card!.id, isActive: true })
			.returning()
		const line = async (role: "user" | "assistant", content: string) =>
			(
				await insertLegacy(asDb(), {
					sessionId,
					role,
					content,
					channel: "main",
					...(role === "user"
						? { userId: user.id }
						: { isNarratorResponse: true })
				} as any)
			).id
		const m1 = await line("user", "We walk to the mill.")
		const m2 = await line("assistant", "The mill looms.") // the fork
		const m3 = await line("user", "We go in.")
		const m4 = await line("assistant", "The wheel groans.")

		const file = (
			messageId: number,
			kind: "seat-bench" | "ruleset-conversion" | "deck" | "annex",
			key: string,
			before: unknown,
			after: unknown
		) =>
			db.transaction(async (tx) =>
				fileSessionImprint(
					tx as any,
					{ sessionId, messageId, runId: null },
					{ kind, key },
					before,
					after,
					kind === "annex"
						? {
								ownerVersion: null,
								audienceBefore: null,
								audienceAfter: null
							}
						: undefined
				)
			)
		const seatKey = seatBenchKey("character", seat!.id)

		// Up to the fork: a bench that brought the seat back (m1), a conversion and
		// an annex write (m2); a deck already in play.
		await file(m1, "seat-bench", seatKey, true, false)
		await file(m2, "ruleset-conversion", "core:ruleset/test", "0.9.0", "1.0.0")
		await file(m2, "annex", "acme/plan", undefined, "v1")
		await file(m2, "deck", "draw-pile", undefined, { cards: [1, 2, 3] })
		// After the fork: a draw, a bench, a conversion, an annex write.
		await file(m3, "deck", "draw-pile", { cards: [1, 2, 3] }, { cards: [3] })
		await file(m3, "deck", "side-pile", undefined, { cards: [9] })
		await file(m3, "seat-bench", seatKey, false, true)
		await file(m4, "ruleset-conversion", "core:ruleset/test", "1.0.0", "2.0.0")
		await file(m4, "annex", "acme/plan", "v1", "v2")
		// The values, as the writers left them.
		await db
			.update(schema.sessions)
			.set({
				rulesetVersion: "2.0.0",
				rulesetDecks: {
					"draw-pile": { cards: [3] },
					"side-pile": { cards: [9] }
				} as never,
				annex: { acme: { plan: "v2" } } as never,
				turnOrder: { v: 1, marker: "as it stands" } as never,
				laneReads: { main: { [`user:${user.id}`]: m4 } } as never,
				turnTally: {
					v: 1,
					lanes: {
						main: {
							turn: 4,
							lastMessageId: m4,
							lastSpeaker: "narrator",
							turnsBy: {},
							spoke: [],
							persons: []
						},
						side: {
							turn: 7,
							lastMessageId: m4,
							lastSpeaker: "narrator",
							turnsBy: {},
							spoke: [],
							persons: []
						}
					}
				} as never
			})
			.where(eq(schema.sessions.id, sessionId))
		await db
			.update(schema.sessionCharacters)
			.set({ isActive: false })
			.where(eq(schema.sessionCharacters.id, seat!.id))

		const branch = await branchSession(asDb(), {
			sessionId,
			fromMessageId: m2
		})

		// The values as at the fork.
		expect(branch.rulesetVersion).toBe("1.0.0")
		expect(branch.rulesetDecks).toEqual({
			"draw-pile": { cards: [1, 2, 3] }
		})
		expect(branch.annex).toEqual({ acme: { plan: "v1" } })
		const [branchSeat] = await db
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, branch.id))
		expect(branchSeat!.isActive).toBe(true)
		// Bookkeeping copies as it stands; the story lane's tally is replayed, the other lane stands.
		expect(branch.turnOrder).toEqual({ v: 1, marker: "as it stands" })
		expect(branch.laneReads).toEqual({ main: { [`user:${user.id}`]: m4 } })
		const tally = branch.turnTally as any
		expect(tally.lanes.main.turn).toBe(2)
		expect(tally.lanes.main.lastMessageId).not.toBe(m4)
		expect(tally.lanes.side.turn).toBe(7)

		// The parent is untouched.
		const [parent] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
		expect(parent!.rulesetVersion).toBe("2.0.0")
		expect(parent!.annex).toEqual({ acme: { plan: "v2" } })

		// The copied rows: up to the fork only, under the branch's messages, the seat key moved.
		const branchMessages = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, branch.id))
			.orderBy(asc(schema.sessionMessages.id))
		const [b1, b2] = branchMessages.map((m) => m.id)
		expect(branchMessages).toHaveLength(2)
		const rows = await db
			.select()
			.from(schema.sessionImprints)
			.where(eq(schema.sessionImprints.sessionId, branch.id))
			.orderBy(asc(schema.sessionImprints.id))
		expect(
			rows.map((r) => [r.messageId, r.subjectKind, r.subjectKey])
		).toEqual([
			[b1, "seat-bench", seatBenchKey("character", branchSeat!.id)],
			[b2, "ruleset-conversion", "core:ruleset/test"],
			[b2, "annex", "acme/plan"],
			[b2, "deck", "draw-pile"]
		])
		expect(branchSeat!.id).not.toBe(seat!.id)
		expect(rows.every((r) => r.status === "standing")).toBe(true)

		// And Back on the branch takes the rows it inherited, as it would its own.
		const { retractSessionImprints } = await import(
			"$lib/server/sessions/sessionImprints"
		)
		await db.transaction(async (tx) =>
			retractSessionImprints(tx as any, {
				sessionId: branch.id,
				messageIds: [b2!]
			})
		)
		const [after] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, branch.id))
		expect(after!.rulesetVersion).toBe("0.9.0")
		expect(after!.annex).toEqual({})
		expect(after!.rulesetDecks).toEqual({})
	})
})
