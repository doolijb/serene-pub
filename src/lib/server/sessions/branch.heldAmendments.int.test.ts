/**
 * 🚧 A branch copies its parent's held amendments as of the fork ("one cut at
 * the fork message"): a session that reads an attached lorebook holds changes
 * to the lorebook's entries in its own book; its branch carries those anchored
 * at or before the fork message, moved onto the branch's copied turn, into the
 * branch's own book. The parent's rows are never touched.
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
		path.join(os.tmpdir(), "serene-pub-vitest-branch-held-amendments-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const asDb = () => db as unknown as Db

describe("a branch copies the parent's held amendments as of the fork", () => {
	test("cut before the turn that held the change it does not see it; cut at or after, it does, anchored on its own copied turn", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { insertLegacy } = await import("$lib/server/messages/store")
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		const { branchSession } = await import("./branch")
		const user = await createTestUser(db, "branch-held-amendments")
		const [lorebook] = await db
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "Harbour" })
			.returning()
		const [docks, quay] = await db
			.insert(schema.lorebookEntries)
			.values(
				["The Docks", "The Quay"].map((title, i) => ({
					lorebookId: lorebook!.id,
					typeId: "core:entry/location",
					typeVersion: 1,
					position: i,
					title,
					content: "…"
				}))
			)
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: "Held",
				lorebookId: lorebook!.id
			})
			.returning()
		const sessionId = session!.id
		const parentBook = await insertOwnBook(asDb(), {
			sessionId,
			userId: user.id,
			name: null,
			overlayOf: lorebook!.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
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
		const m1 = await line("user", "We reach the docks.")
		const m2 = await line("assistant", "The docks burn.")
		const m3 = await line("user", "We cross to the quay.")
		const m4 = await line("assistant", "The quay floods.")

		// m2's turn held a change to the Docks; m4's turn one to the Quay; one has no anchor.
		const [early, late, loose] = await db
			.insert(schema.entryAmendments)
			.values([
				{
					lorebookId: parentBook.id,
					entryId: docks!.id,
					year: null,
					fields: { name: "The Burned Docks" },
					base: { name: { v: "The Docks" } },
					sourceMessageId: m2
				},
				{
					lorebookId: parentBook.id,
					entryId: quay!.id,
					year: null,
					fields: { name: "The Flooded Quay" },
					base: { name: { v: "The Quay" } },
					sourceMessageId: m4
				},
				{
					lorebookId: parentBook.id,
					entryId: quay!.id,
					year: null,
					fields: { content: "Unanchored." },
					base: { content: { v: "…" } },
					sourceMessageId: null
				}
			])
			.returning()

		const heldOf = async (bookId: number) =>
			db
				.select()
				.from(schema.entryAmendments)
				.where(eq(schema.entryAmendments.lorebookId, bookId))
				.orderBy(asc(schema.entryAmendments.id))
		const messagesOf = async (id: number) =>
			(
				await db
					.select({ id: schema.sessionMessages.id })
					.from(schema.sessionMessages)
					.where(eq(schema.sessionMessages.sessionId, id))
					.orderBy(asc(schema.sessionMessages.id))
			).map((m) => m.id)
		const ownBookOf = async (id: number) =>
			(
				await db
					.select({ id: schema.lorebooks.id })
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.sessionId, id))
			)[0]!.id

		// Cut at m1: before the turn that held the change. Only the unanchored one comes.
		const before = await branchSession(asDb(), {
			sessionId,
			fromMessageId: m1
		})
		const beforeRows = await heldOf(await ownBookOf(before.id))
		expect(beforeRows.map((r) => r.fields)).toEqual([
			{ content: "Unanchored." }
		])
		expect(beforeRows[0]).toMatchObject({
			entryId: quay!.id,
			branchId: null,
			sourceMessageId: null
		})

		// Cut at m2: the turn itself. Its change comes, moved onto the branch's copied turn.
		const at = await branchSession(asDb(), { sessionId, fromMessageId: m2 })
		const [, atM2] = await messagesOf(at.id)
		const atRows = await heldOf(await ownBookOf(at.id))
		expect(atRows.map((r) => r.fields)).toEqual([
			{ name: "The Burned Docks" },
			{ content: "Unanchored." }
		])
		expect(atRows[0]).toMatchObject({
			entryId: docks!.id,
			branchId: null,
			year: null,
			base: { name: { v: "The Docks" } },
			sourceMessageId: atM2
		})
		expect(atM2).not.toBe(m2)

		// Cut after both: all three, the later one on the last copied turn.
		const after = await branchSession(asDb(), {
			sessionId,
			fromMessageId: m4
		})
		const afterMessages = await messagesOf(after.id)
		const afterRows = await heldOf(await ownBookOf(after.id))
		expect(afterRows.map((r) => r.sourceMessageId)).toEqual([
			afterMessages[1],
			afterMessages[3],
			null
		])
		expect(m3).toBeGreaterThan(m2)

		// The parent's rows are untouched, and the branch's are rows of its own.
		const parentRows = await heldOf(parentBook.id)
		expect(parentRows.map((r) => [r.id, r.sourceMessageId])).toEqual([
			[early!.id, m2],
			[late!.id, m4],
			[loose!.id, null]
		])
		expect(
			new Set([...beforeRows, ...atRows, ...afterRows].map((r) => r.id))
				.size
		).toBe(6)
	})

	test("after the original applies, a branch cut before the change and one cut after both read the lorebook's value; the one cut after holds its copy, now done and dropped", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { insertLegacy } = await import("$lib/server/messages/store")
		const { insertOwnBook, overlayItemsOf, applyOverlayItems } =
			await import("$lib/server/lorebooks/ownBook")
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const { entryOverlaysFor, entryAt } = await import(
			"$lib/server/state/entriesOnReading"
		)
		const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
		const { branchSession } = await import("./branch")
		const user = await createTestUser(db, "branch-held-apply")
		const [lorebook] = await db
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "Harbour" })
			.returning()
		const [docks] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: lorebook!.id,
				typeId: "core:entry/location",
				typeVersion: 1,
				position: 0,
				title: "The Docks",
				content: "…"
			})
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: "Held apply",
				lorebookId: lorebook!.id
			})
			.returning()
		const sessionId = session!.id
		const parentBook = await insertOwnBook(asDb(), {
			sessionId,
			userId: user.id,
			name: null,
			overlayOf: lorebook!.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
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
		const m1 = await line("user", "We reach the docks.")
		const m2 = await line("assistant", "The docks burn.")
		await db.insert(schema.entryAmendments).values({
			lorebookId: parentBook.id,
			entryId: docks!.id,
			year: null,
			fields: { name: "The Burned Docks" },
			base: { name: { v: "The Docks" } },
			sourceMessageId: m2
		})
		const before = await branchSession(asDb(), {
			sessionId,
			fromMessageId: m1
		})
		const after = await branchSession(asDb(), {
			sessionId,
			fromMessageId: m2
		})

		// The original applies: the lorebook's row changes.
		const done = await applyOverlayItems(asDb(), {
			sessionId,
			userId: user.id
		})
		expect(done.appliedChanges).toHaveLength(1)
		const [row] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, docks!.id))
		expect(row!.title).toBe("The Burned Docks")

		const nameBy = async (id: number) => {
			const reading = (await sessionReadingOf(asDb(), id))!
			const overlays = await entryOverlaysFor(
				asDb(),
				lorebook!.id,
				reading,
				[docks!.id]
			)
			return (entryAt(toEntryRow(row!), overlays, reading) as any).name
		}
		expect(await nameBy(before.id)).toBe("The Burned Docks")
		expect(await nameBy(after.id)).toBe("The Burned Docks")
		expect(await overlayItemsOf(asDb(), before.id)).toEqual([])
		// The copy's change is what the lorebook now holds: done, not a conflict — not listed,
		// and the branch's next Apply drops it.
		expect(await overlayItemsOf(asDb(), after.id)).toEqual([])
		const dropping = await applyOverlayItems(asDb(), {
			sessionId: after.id,
			userId: user.id
		})
		expect(dropping).toMatchObject({
			applied: [],
			appliedChanges: [],
			stillHeld: [],
			batch: null,
			settled: null
		})
		expect(dropping.dropped).toHaveLength(1)
	})
})
