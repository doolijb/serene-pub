/**
 * 🚧 A branch is the session as of the fork, links included: a session that
 * reads an attached lorebook keeps links in its own notes (an end may be a
 * lorebook entry or member). Each link is cut at the message of its made-row
 * imprint, copied with its ends kept or remapped, and filed as made for the
 * branch on its own copied turn. An entry filed under a lorebook member keeps
 * its binding. A ruleset tie's copy is not copied by this path.
 *
 * Run for the owner's own lorebook under Review and for a member's session on
 * someone else's lorebook.
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
let n = 0
const asDb = () => db as unknown as Db

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-branch-own-book-links-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(member: boolean) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	const owner = await createTestUser(db, `branch-links-owner-${++n}`)
	const user = member
		? await createTestUser(db, `branch-links-member-${++n}`)
		: owner
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "review" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: "Harbour" })
		.returning()
	const room = async (
		lorebookId: number,
		title: string,
		over: Record<string, unknown> = {}
	) =>
		(
			await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId,
					typeId: "core:entry/location",
					typeVersion: 1,
					position: ++n,
					title,
					content: "…",
					...over
				})
				.returning()
		)[0]!
	const docks = await room(book!.id, "The Docks")
	const quay = await room(book!.id, "The Quay")
	const [lorebookMember] = await db
		.insert(schema.lorebookBindings)
		.values({ lorebookId: book!.id, binding: "{{char:1}}", name: "Aria" })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `S${++n}`,
			lorebookId: book!.id
		})
		.returning()
	const sessionId = session!.id
	const own = await insertOwnBook(asDb(), {
		sessionId,
		userId: user.id,
		name: null,
		overlayOf: book!.id,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	const line = async (role: "user" | "assistant") =>
		(
			await insertLegacy(asDb(), {
				sessionId,
				role,
				content: "…",
				channel: "main",
				...(role === "user"
					? { userId: user.id }
					: { isNarratorResponse: true })
			} as any)
		).id
	const m1 = await line("user")
	const m2 = await line("assistant")
	const m3 = await line("user")
	const m4 = await line("assistant")
	const hall = await room(own.id, "The Hall", { sourceMessageId: m1 })
	const smuggler = await room(own.id, "The Smuggler", {
		sourceMessageId: m1,
		anchorBindingId: lorebookMember!.id
	})
	const link = async (
		from: number,
		to: number,
		imprintAt: number | null,
		over: Record<string, unknown> = {}
	) => {
		const [row] = await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: own.id,
				fromEntryId: from,
				toEntryId: to,
				relationshipType: "leads to",
				...over
			})
			.returning()
		if (imprintAt != null)
			await db.insert(schema.loreImprints).values({
				sessionId,
				messageId: imprintAt,
				lorebookId: own.id,
				subjectKind: "relationship",
				subjectId: row!.id,
				field: null,
				before: null,
				after: { v: { id: row!.id } }
			})
		return row!
	}
	// Own room ↔ lorebook room (m2); lorebook ↔ lorebook (m4); unanchored; a tie's copy.
	const mixed = await link(hall.id, docks.id, m2)
	const lorebookOnly = await link(docks.id, quay.id, m4)
	const loose = await link(quay.id, hall.id, null)
	const tie = await link(hall.id, quay.id, null, { rulesRunId: "tie-run" })
	return {
		session: session!,
		own,
		book: book!,
		docks,
		quay,
		hall,
		smuggler,
		lorebookMember: lorebookMember!,
		m: [m1, m2, m3, m4],
		mixed,
		lorebookOnly,
		loose,
		tie
	}
}

const messagesOf = async (id: number) =>
	(
		await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, id))
			.orderBy(asc(schema.sessionMessages.id))
	).map((m) => m.id)
const ownBookOf = async (sessionId: number) =>
	(
		await db
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.sessionId, sessionId))
	)[0]!
const linksOf = (bookId: number) =>
	db
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, bookId))
		.orderBy(asc(schema.narrativeRelationships.id))
const entriesOf = (bookId: number) =>
	db
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, bookId))
		.orderBy(asc(schema.lorebookEntries.id))
const imprintsOf = (sessionId: number) =>
	db
		.select()
		.from(schema.loreImprints)
		.where(eq(schema.loreImprints.sessionId, sessionId))
		.orderBy(asc(schema.loreImprints.id))

describe.each([
	["the owner's own lorebook under Review", false],
	["a member's session on someone else's lorebook", true]
])(
	"a branch carries the parent's own-book links as of the fork: %s",
	(_label, member) => {
		test("cut before a link's turn it stays behind; cut at or after it comes, ends right, owned by the branch's turn", async () => {
			const { branchSession } = await import("./branch")
			const w = await world(member)
			const [m1, m2, m3, m4] = w.m

			// Cut at m1: the imprinted links are after the fork; the unanchored one comes.
			const early = await branchSession(asDb(), {
				sessionId: w.session.id,
				fromMessageId: m1
			})
			const earlyBook = await ownBookOf(early.id)
			const earlyEntries = await entriesOf(earlyBook.id)
			const earlyHall = earlyEntries.find((e) => e.title === "The Hall")!
			const earlyLinks = await linksOf(earlyBook.id)
			expect(earlyLinks.map((l) => [l.fromEntryId, l.toEntryId])).toEqual(
				[[w.quay.id, earlyHall.id]]
			)
			expect(await imprintsOf(early.id)).toEqual([])

			// Cut at m2: the lorebook-room link comes, imprinted for the branch at its copy of m2.
			const mid = await branchSession(asDb(), {
				sessionId: w.session.id,
				fromMessageId: m2
			})
			const midMessages = await messagesOf(mid.id)
			const midBook = await ownBookOf(mid.id)
			const midHall = (await entriesOf(midBook.id)).find(
				(e) => e.title === "The Hall"
			)!
			const midLinks = await linksOf(midBook.id)
			expect(
				midLinks.map((l) => [
					l.fromEntryId,
					l.toEntryId,
					l.branchId,
					l.rulesRunId
				])
			).toEqual([
				[midHall.id, w.docks.id, null, null],
				[w.quay.id, midHall.id, null, null]
			])
			const midImprints = await imprintsOf(mid.id)
			expect(midImprints).toHaveLength(1)
			expect(midImprints[0]).toMatchObject({
				messageId: midMessages[1],
				lorebookId: midBook.id,
				subjectKind: "relationship",
				subjectId: midLinks[0]!.id,
				field: null,
				origin: "run",
				runId: null,
				status: "standing"
			})
			expect(midMessages[1]).not.toBe(m2)

			// Cut at m4: the lorebook-to-lorebook link comes as well; the tie's copy never does.
			const late = await branchSession(asDb(), {
				sessionId: w.session.id,
				fromMessageId: m4
			})
			const lateBook = await ownBookOf(late.id)
			const lateMessages = await messagesOf(late.id)
			const lateLinks = await linksOf(lateBook.id)
			expect(lateLinks.map((l) => [l.fromEntryId, l.toEntryId])).toEqual([
				[
					(await entriesOf(lateBook.id)).find(
						(e) => e.title === "The Hall"
					)!.id,
					w.docks.id
				],
				[w.docks.id, w.quay.id],
				[
					w.quay.id,
					(await entriesOf(lateBook.id)).find(
						(e) => e.title === "The Hall"
					)!.id
				]
			])
			expect(lateLinks.some((l) => l.rulesRunId != null)).toBe(false)
			expect((await imprintsOf(late.id)).map((i) => i.messageId)).toEqual(
				[lateMessages[1], lateMessages[3]]
			)
			expect(m3).toBeGreaterThan(m2)

			// The parent's rows are untouched.
			expect((await linksOf(w.own.id)).map((l) => l.id)).toEqual([
				w.mixed.id,
				w.lorebookOnly.id,
				w.loose.id,
				w.tie.id
			])
			expect(
				(await imprintsOf(w.session.id)).map((i) => i.messageId)
			).toEqual([m2, m4])
		})

		test("an entry filed under a lorebook member keeps its binding in the branch", async () => {
			const { branchSession } = await import("./branch")
			const w = await world(member)
			const branch = await branchSession(asDb(), {
				sessionId: w.session.id,
				fromMessageId: w.m[3]!
			})
			const copy = (
				await entriesOf((await ownBookOf(branch.id)).id)
			).find((e) => e.title === "The Smuggler")!
			expect(copy.anchorBindingId).toBe(w.lorebookMember.id)
		})
	}
)
