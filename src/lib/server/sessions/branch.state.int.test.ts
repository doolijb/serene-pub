/**
 * Branching a session takes its state with it (R10).
 *
 * ⚠ **It took none of it before today.** A forked adventure arrived with every
 * bar back at its declaration default and an empty ledger — the copy had the
 * conversation and none of what the conversation had made true.
 *
 * Three claims:
 *
 *  1. **Anchors are remapped.** Every attribute row is filed against a message
 *     id, and an id from the source session means nothing in the branch.
 *  2. **The fork is a horizon.** A change made after the fork message belongs
 *     to a future the branch never had, and stays behind.
 *  3. **Pending proposals stay with the person who was asked.** Two sessions
 *     each holding one undecided line is two chances to answer one question.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	genre,
	_clearAttributeSlots
} from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-branch-state-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const WEATHER = "core:slot/weather@1"
const GENRE = "test:genre/branch"

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
		defineAttributeSlot(WEATHER, {
			type: "enum",
			descriptor: "What the sky is doing.",
			appliesTo: ["world"],
			config: { of: ["clear", "storm"] }
		})
	]
	genre(GENRE, {
		name: { en: "Branch" },
		family: "test",
		slots: declared,
		events: {}
	})
}

let n = 0

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `branch-state-${suffix}`)
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
			genreId: GENRE
		})
		.returning()
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: verity.id })
	await db
		// The real shape: the lorebook is the session row's own binding.
		.update(schema.sessions)
		.set({ lorebookId: lorebook.id })
		.where(eq(schema.sessions.id, session.id))
	const [key] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: lorebook.id,
			typeId: "core:entry/world-lore",
			typeVersion: 1,
			position: 0,
			title: "A rusty key",
			content: "Green with age."
		})
		.returning()

	const message = async (speakerId?: number) => {
		const [legacy] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "assistant",
				characterId: speakerId ?? null,
				content: "…"
			})
			.returning()
		await db.insert(schema.messages).values({
			id: legacy.id,
			sessionId: session.id,
			characterId: speakerId ?? null,
			role: "assistant"
		})
		return legacy
	}
	return { user, verity, lorebook, session, key, message }
}

const put = async (
	sessionId: number,
	ownerKind: string,
	ownerId: number,
	slotId: string,
	v: unknown,
	messageId: number | null
) =>
	await db.insert(schema.attributeValues).values({
		ownerKind,
		ownerId,
		slotId,
		value: { v },
		sessionId,
		validFromMessageId: messageId,
		updatedBy: "user"
	})

describe("branching carries the state", () => {
	test("anchors are remapped and the fork is a horizon", async () => {
		declareSlots()
		const w = await world()
		const first = await w.message(w.verity.id)
		const fork = await w.message(w.verity.id)
		const after = await w.message(w.verity.id)

		await put(w.session.id, "session_cast", w.verity.id, HP, 18, first.id)
		await put(w.session.id, "session_cast", w.verity.id, HP, 14, fork.id)
		// A future the branch never had.
		await put(w.session.id, "session_cast", w.verity.id, HP, 3, after.id)
		// "From the beginning" always comes across.
		await put(w.session.id, "session", w.session.id, WEATHER, "storm", null)
		// What she carries is an inventory value (phase 3b), copied like any.
		await put(w.session.id, "session_cast", w.verity.id, "core:slot/inventory@1", [{ entryId: w.key.id }], fork.id)

		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db, {
			sessionId: w.session.id,
			fromMessageId: fork.id,
			title: "A different bell"
		})

		const copied = await db
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, branch.id))
			.orderBy(asc(schema.attributeValues.id))
		// Two of the three: the one after the fork stayed behind.
		expect(
			copied.filter((r) => r.slotId === HP).map((r) => (r.value as any).v)
		).toEqual([18, 14])
		expect(copied.find((r) => r.slotId === WEATHER)).toBeTruthy()
		expect(
			copied.find((r) => r.slotId === WEATHER)!.validFromMessageId
		).toBeNull()

		// The anchors are the BRANCH's messages, not the source's.
		const branchMessages = await db
			.select({ id: schema.messages.id })
			.from(schema.messages)
			.where(eq(schema.messages.sessionId, branch.id))
			.orderBy(asc(schema.messages.id))
		const branchIds = new Set(branchMessages.map((m) => m.id))
		for (const row of copied.filter((r) => r.validFromMessageId !== null))
			expect(branchIds.has(row.validFromMessageId!)).toBe(true)
		expect(branchIds.has(fork.id)).toBe(false)

		// …and the branch resolves to what the fork left, not to the default.
		const { valueOf } = await import("$lib/server/state/resolve")
		expect(
			await valueOf(db, {
				sessionId: branch.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP
			})
		).toBe(14)
		// The source is untouched — it still knows about its own future.
		expect(
			await valueOf(db, {
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP
			})
		).toBe(3)

		const carried = copied.filter((r) => r.slotId === "core:slot/inventory@1")
		expect(carried.map((r) => (r.value as any).v)).toEqual([[{ entryId: w.key.id }]])
		expect(branchIds.has(carried[0].validFromMessageId!)).toBe(true)
	})

	test("what the session tracks comes with it, re-keyed to the branch", async () => {
		declareSlots()
		const w = await world()
		await w.message(w.verity.id)
		const { declareSheet, setOwnerSheets } = await import(
			"$lib/server/state/declarations"
		)
		const sheetId = `branch${n}:sheet/vitals@1`
		await declareSheet(db, w.user.id, sheetId, {
			label: { en: "Vitals" },
			slots: [{ id: HP }]
		})
		await setOwnerSheets(
			db,
			{ kind: "session", id: w.session.id },
			[sheetId],
			w.session.id
		)
		await setOwnerSheets(
			db,
			{ kind: "session_cast", id: w.verity.id },
			[sheetId],
			w.session.id
		)

		const messages = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, w.session.id))
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db, {
			sessionId: w.session.id,
			fromMessageId: messages[0].id
		})

		const rows = await db
			.select()
			.from(schema.ownerSheets)
			.where(eq(schema.ownerSheets.sessionId, branch.id))
		expect(rows.map((r) => r.ownerKind).sort()).toEqual([
			"session",
			"session_cast"
		])
		// The session owner's ID moves; a cast member's is a character id and
		// does not.
		expect(
			rows.find((r) => r.ownerKind === "session")!.ownerId
		).toBe(branch.id)
		expect(
			rows.find((r) => r.ownerKind === "session_cast")!.ownerId
		).toBe(w.verity.id)
	})

	test("a pending proposal belongs to the session it was asked in", async () => {
		declareSlots()
		const w = await world()
		const fork = await w.message(w.verity.id)
		await db.insert(schema.stateProposals).values({
			sessionId: w.session.id,
			messageId: fork.id,
			kind: "value",
			payload: {
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 5
			},
			status: "pending",
			proposedBy: "run:abc"
		})

		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db, {
			sessionId: w.session.id,
			fromMessageId: fork.id
		})
		expect(
			await db
				.select()
				.from(schema.stateProposals)
				.where(
					and(
						eq(schema.stateProposals.sessionId, branch.id),
						eq(schema.stateProposals.status, "pending")
					)
				)
		).toHaveLength(0)
	})
})
