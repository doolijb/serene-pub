/**
 * 🚧 **A link written on the own-book route belongs to its turn, end to end.**
 * Turn M, through the real `link-lore-entries` outlet, ties an own-book room to
 * a lorebook room. Back takes it with the turn, Forward puts it back (same id);
 * a branch cut after M copies it and a branch cut before M does not; Back of the
 * branch's copy of M takes the branch's copy and leaves the parent's link
 * standing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
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

const CREATE = {
	key: "file",
	definitionId: "core:outlet/create-lore-entry"
} as any
const LINK = {
	key: "tie",
	definitionId: "core:outlet/link-lore-entries"
} as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-branch-own-book-route-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

type Kind = "review" | "member"

async function world(kind: Kind) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const owner = await createTestUser(db, `branch-route-owner-${++n}`)
	const who =
		kind === "review"
			? owner
			: await createTestUser(db, `branch-route-member-${++n}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: owner.id, loreWriteMode: "review" })
	if (kind === "member")
		await db
			.insert(schema.userSettings)
			.values({ userId: who.id, loreWriteMode: "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: "Harbour" })
		.returning()
	const docks = (
		await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: book!.id,
				typeId: "core:entry/location",
				typeVersion: 1,
				position: ++n,
				title: "The Docks",
				content: "…"
			})
			.returning()
	)[0]!
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: who.id,
			isGroup: false,
			name: `S${++n}`,
			lorebookId: book!.id
		})
		.returning()
	const own = await ownBookFor(asDb(), session!.id)
	const line = async (role: "user" | "assistant") =>
		(
			await insertLegacy(asDb(), {
				sessionId: session!.id,
				role,
				content: "…",
				channel: "main",
				...(role === "user"
					? { userId: who.id }
					: { isNarratorResponse: true })
			} as any)
		).id
	const host = (runId: string) =>
		createHost(asDb(), {
			sessionId: session!.id,
			userId: who.id,
			runId
		})
	const m1 = await line("user")
	const hall = (await host("t1").commit!(
		{
			name: "The Hall",
			content: "A room.",
			params: { entryType: "core:entry/location" }
		},
		CREATE
	)) as any
	const m2 = await line("assistant")
	const mixed = (await host("t2").commit!(
		{ from: hall.id, to: docks.id },
		LINK
	)) as any
	const m3 = await line("user")
	return {
		session: session!,
		own,
		book: book!,
		docks,
		hall,
		mixed,
		m: [m1, m2, m3]
	}
}

const linksOf = (bookId: number) =>
	db
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, bookId))
		.orderBy(asc(schema.narrativeRelationships.id))
const ownBookOf = async (sessionId: number) =>
	(
		await db
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.sessionId, sessionId))
	)[0]!
const messagesOf = async (id: number) =>
	(
		await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, id))
			.orderBy(asc(schema.sessionMessages.id))
	).map((m) => m.id)
const imprintsOf = (sessionId: number) =>
	db
		.select()
		.from(schema.loreImprints)
		.where(eq(schema.loreImprints.sessionId, sessionId))
		.orderBy(asc(schema.loreImprints.id))

describe.each<Kind>(["review", "member"])(
	"a cross-book link follows its turn, end to end · %s",
	(kind) => {
		it("Back takes it with its turn, Forward restores it; a branch cut after M has its copy, one cut before M has none; Back of the copy leaves the parent's", async () => {
			const {
				retractStateAnchoredTo,
				reviveRetractedState,
				restoreRetractedState
			} = await import("$lib/server/state/write")
			const { branchSession } = await import("./branch")
			const w = await world(kind)
			const [m1, m2] = w.m
			const written = await linksOf(w.own.id)
			expect(
				written.map((l) => [l.id, l.fromEntryId, l.toEntryId])
			).toEqual([[w.mixed.id, w.hall.id, w.docks.id]])
			expect(
				(await imprintsOf(w.session.id)).filter(
					(i) => i.subjectKind === "relationship"
				)
			).toMatchObject([{ messageId: m2, subjectId: w.mixed.id }])

			// Back of M takes it; Forward (the record read back from JSON) puts it back, same id.
			const undone = await db.transaction(async (tx) =>
				retractStateAnchoredTo(tx as unknown as Db, m2!, "leaves", {
					leavingWith: [m2!]
				})
			)
			expect(await linksOf(w.own.id)).toEqual([])
			const record = reviveRetractedState(
				JSON.parse(JSON.stringify(undone.taken)),
				w.session.id
			)!
			expect(await restoreRetractedState(asDb(), record)).toBe(true)
			expect(await linksOf(w.own.id)).toEqual(written)

			// A branch cut before M has no link; one cut after M has its copy.
			const early = await branchSession(asDb(), {
				sessionId: w.session.id,
				fromMessageId: m1!
			})
			expect(await linksOf((await ownBookOf(early.id)).id)).toEqual([])
			const late = await branchSession(asDb(), {
				sessionId: w.session.id,
				fromMessageId: m2!
			})
			const lateBook = await ownBookOf(late.id)
			const lateMessages = await messagesOf(late.id)
			const lateHall = (
				await db
					.select()
					.from(schema.lorebookEntries)
					.where(eq(schema.lorebookEntries.lorebookId, lateBook.id))
			).find((e) => e.title === "The Hall")!
			const copy = await linksOf(lateBook.id)
			expect(copy.map((l) => [l.fromEntryId, l.toEntryId])).toEqual([
				[lateHall.id, w.docks.id]
			])
			expect(copy[0]!.id).not.toBe(w.mixed.id)
			expect(await imprintsOf(late.id)).toMatchObject([
				{
					messageId: lateMessages[1],
					subjectKind: "relationship",
					subjectId: copy[0]!.id
				}
			])

			// Back of the branch's copy of M takes the branch's link, never the parent's.
			const lateUndone = await db.transaction(async (tx) =>
				retractStateAnchoredTo(
					tx as unknown as Db,
					lateMessages[1]!,
					"leaves",
					{
						leavingWith: [lateMessages[1]!]
					}
				)
			)
			expect(lateUndone.changed).toBe(true)
			expect(await linksOf(lateBook.id)).toEqual([])
			expect(await linksOf(w.own.id)).toEqual(written)
			expect(
				(await imprintsOf(w.session.id)).filter(
					(i) => i.subjectKind === "relationship"
				)
			).toMatchObject([{ messageId: m2, subjectId: w.mixed.id }])
			// The branch's Forward puts its copy back.
			const lateRecord = reviveRetractedState(
				JSON.parse(JSON.stringify(lateUndone.taken)),
				late.id
			)!
			expect(await restoreRetractedState(asDb(), lateRecord)).toBe(true)
			expect(await linksOf(lateBook.id)).toEqual(copy)
		})
	}
)
