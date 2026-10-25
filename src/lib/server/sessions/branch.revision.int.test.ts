/**
 * 🚧 A revision puts the session back where it stood (DC walk 6, 2026-10-17):
 *
 *  1. **The annex follows the timeline.** A branch's annex, and an overwritten
 *     session's, is the document as it stood before the first line revised
 *     away — not what the revised-away turn wrote (`annexChanges.ts`).
 *  2. **A place in the session's notes is the branch's copy.** The notes are
 *     copied with new ids, so a copied stat naming a place (`{ entryId }`, a
 *     `session_location` owner) names the copy — else the branch shows
 *     "entry 1" and a door with no place.
 *  3. **The branch says what it is a branch of** (the `branch_of_*` columns).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { branchOfSession } from "$lib/shared/sessions/branchOf"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-branch-revision-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `branch-revision-${suffix}`)
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Crawl ${suffix}`, genreId: "core:genre/story" })
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const setProgress = async (progress: unknown) =>
		await db.execute(
			`update sessions set annex = jsonb_set(coalesce(annex, '{}'::jsonb), '{core}', '${JSON.stringify({
				progress
			})}'::jsonb, true) where id = ${session.id}` as any
		)
	// A write of `core`'s document anchored to a turn's message: the annex and its delta.
	const writeAt = async (messageId: number, progress: unknown) => {
		const { recordAnnexDelta } = await import("$lib/server/sessions/annexChanges")
		await db.transaction(async (tx) => {
			const [cur] = await tx
				.select({ annex: schema.sessions.annex })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, session.id))
			const held = (cur?.annex ?? {}) as Record<string, any>
			const next = { progress }
			await tx
				.update(schema.sessions)
				.set({ annex: { ...held, core: next } as any })
				.where(eq(schema.sessions.id, session.id))
			await recordAnnexDelta(tx as any, {
				sessionId: session.id,
				messageId,
				owner: "core",
				ownerVersion: null,
				before: { document: held.core ?? null, audiences: null },
				after: { document: next, audiences: null },
				runId: null
			})
		})
	}
	const line = async (role: "user" | "assistant", content: string, metadata: Record<string, unknown> = {}) =>
		await insertLegacy(db, { sessionId: session.id, role, content, metadata } as any)
	const annexOf = async (id: number) =>
		(
			await db
				.select({ annex: schema.sessions.annex })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, id))
		)[0]?.annex as Record<string, any>
	return { user, session, setProgress, writeAt, line, annexOf }
}

describe("a revision puts the annex back", () => {
	test("branch: the annex as it stood before the first line revised away", async () => {
		const w = await world()
		await w.setProgress({ lastTelling: { row: 0 }, leads: [] })
		await w.line("user", "I search the north arch.")
		const told = await w.line("assistant", "Stone grinds.")
		// The table row of that turn: no point of its own.
		await w.line("assistant", "⚄ The gate gains a door", { anchorMessageId: told.id })
		await w.writeAt(told.id, { lastTelling: { row: told.id }, leads: ["Try the door."] })
		const fork = await w.line("user", "I strike the eel again.")
		const revised = await w.line("assistant", "The eel bites.")
		await w.writeAt(revised.id, { lastTelling: { row: revised.id }, leads: ["Follow the stair down."] })

		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db, { sessionId: w.session.id, fromMessageId: fork.id })
		const annex = await w.annexOf(branch.id)
		expect(annex.core.progress).toEqual({ lastTelling: { row: told.id }, leads: ["Try the door."] })
		// The parent keeps its own future.
		expect((await w.annexOf(w.session.id)).core.progress.leads).toEqual(["Follow the stair down."])
		// …and the branch names its parent.
		expect(branchOfSession(branch)).toEqual({
			sessionId: w.session.id,
			name: w.session.name,
			messageId: fork.id
		})
	})

	test("overwrite: deleting the turn puts the annex back in place", async () => {
		const w = await world()
		await w.setProgress({ leads: [] })
		const first = await w.line("user", "I look around.")
		await w.writeAt(first.id, { leads: ["A lead from the first turn."] })
		const revised = await w.line("assistant", "The eel bites.")
		await w.writeAt(revised.id, { leads: ["A lead from the deleted turn."] })
		const { retractAnnexDeltasAnchoredTo } = await import("$lib/server/sessions/annexChanges")
		const taken = await db.transaction(async (tx) => retractAnnexDeltasAnchoredTo(tx as any, revised.id))
		expect(taken.map((t) => t.reverted)).toEqual([true])
		const annex = await w.annexOf(w.session.id)
		expect(annex.core.progress.leads).toEqual(["A lead from the first turn."])
	})

	test("a session with an empty annex (a Chat) takes no points", async () => {
		const w = await world()
		await w.line("user", "Hello.")
		expect(((await w.annexOf(w.session.id)) ?? {})["core:revision-points"]).toBeUndefined()
	})
})

describe("a branch's places are its notes' copies", () => {
	test("a location ref and a place owner name the copied entry", async () => {
		const w = await world()
		const [notes] = await db
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: "Notes", sessionId: w.session.id })
			.returning()
		const [gate] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: notes.id,
				typeId: "core:entry/location",
				typeVersion: 1,
				position: 0,
				title: "The Sunken Gate",
				content: "Wet stone."
			})
			.returning()
		const fork = await w.line("assistant", "Water laps at your boots.")
		const put = async (ownerKind: string, ownerId: number, slotId: string, v: unknown) =>
			await db.insert(schema.attributeValues).values({
				ownerKind,
				ownerId,
				slotId,
				value: { v },
				sessionId: w.session.id,
				validFromMessageId: fork.id,
				updatedBy: "user"
			})
		await put("session", w.session.id, "core:slot/location@1", { entryId: gate.id })
		await put("session_location", gate.id, "core:slot/crawl-exits@1", [{ name: "Iron Door" }])

		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db, { sessionId: w.session.id, fromMessageId: fork.id })
		const [copiedNotes] = await db
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.sessionId, branch.id))
		const [copiedGate] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, copiedNotes.id))
		expect(copiedGate.id).not.toBe(gate.id)
		const rows = await db
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, branch.id))
		expect((rows.find((r) => r.slotId === "core:slot/location@1")!.value as any).v).toEqual({
			entryId: copiedGate.id
		})
		const exits = rows.find((r) => r.slotId === "core:slot/crawl-exits@1")!
		expect(exits.ownerKind).toBe("session_location")
		expect(exits.ownerId).toBe(copiedGate.id)
		// The parent's rows are untouched.
		const parent = await db
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.sessionId, w.session.id),
					eq(schema.attributeValues.slotId, "core:slot/crawl-exits@1")
				)
			)
		expect(parent[0].ownerId).toBe(gate.id)
	})
})

describe("remapEntryRefs", () => {
	test("moves a mapped entry id anywhere in the value, leaves the rest", async () => {
		const { remapEntryRefs } = await import("$lib/server/sessions/branch")
		const map = new Map([[1, 6]])
		const value = { v: [{ entryId: 1, name: "a" }, { entryId: 9 }], other: { entryId: 1 } }
		expect(remapEntryRefs(value, map)).toEqual({
			v: [{ entryId: 6, name: "a" }, { entryId: 9 }],
			other: { entryId: 6 }
		})
		const untouched = { v: { entryId: 9 } }
		expect(remapEntryRefs(untouched, map)).toBe(untouched)
	})
})
