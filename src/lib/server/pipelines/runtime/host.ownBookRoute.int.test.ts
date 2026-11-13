/**
 * 🚧 The own-book write route of a session that reads an attached lorebook
 * (Review or Off on your own lorebook, or a member's session on someone
 * else's): the rows still land in the session's own book, but a match, a bind,
 * a link's end, an Exits line, a history date and the prompt's current date
 * look at both books. Driven through the real outlets.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	LOCATION_TYPE_ID
} from "$lib/shared/entries/types"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

// Sessions that meet the rule "scenes end by themselves" (none, but the last case).
const scenesEnd = vi.hoisted(() => new Set<number>())
vi.mock("$lib/server/lorebooks/ownBook", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/lorebooks/ownBook")>()),
	scenesEndByThemselves: async (_db: unknown, sessionId: number) => scenesEnd.has(sessionId)
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

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
		path.join(os.tmpdir(), "serene-pub-vitest-own-book-route-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

type Kind = "review" | "member"

/**
 * One of the two situations. `review`: the session's owner owns the lorebook and
 * has the lore write mode on Review. `member`: another user's session on
 * someone else's lorebook, Full for that member.
 */
async function setup(
	kind: Kind,
	opts: { calendar?: unknown; ownMode?: "full" | "review" } = {}
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(db, `own-route-${suffix}`)
	const mode = opts.ownMode ?? (kind === "review" ? "review" : "full")
	const who =
		kind === "review"
			? owner
			: await createTestUser(db, `own-route-member-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: owner.id, loreWriteMode: opts.ownMode ?? "review" })
	if (kind === "member")
		await db
			.insert(schema.userSettings)
			.values({ userId: who.id, loreWriteMode: mode })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: owner.id,
			name: `World ${suffix}`,
			...(opts.calendar ? { storyCalendar: opts.calendar as any } : {})
		})
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: who.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id
		})
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db as unknown as Db, session!.id)
	const message = await messageIn(session!.id)
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = (runId = `run-${suffix}`) =>
		createHost(db as unknown as Db, {
			sessionId: session!.id,
			userId: who.id,
			runId
		})
	return {
		suffix,
		owner,
		user: who,
		book: book!,
		session: session!,
		own,
		message,
		host
	}
}

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

async function place(
	lorebookId: number,
	title: string,
	content = `${title}, as written.`
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content,
			fields: { category: "Rooms" }
		})
		.returning()
	return row!
}

async function day(
	lorebookId: number,
	date: { year: number; month?: number; day?: number }
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId, ...date } as any]))
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

const heldRows = (ownBookId: number) =>
	db
		.select()
		.from(schema.entryAmendments)
		.where(eq(schema.entryAmendments.lorebookId, ownBookId))
		.orderBy(schema.entryAmendments.id)

const entriesOf = (lorebookId: number, typeId: string) =>
	db
		.select()
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, typeId)
			)
		)
		.orderBy(schema.lorebookEntries.id)

const linksOf = (lorebookId: number) =>
	db
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, lorebookId))
		.orderBy(schema.narrativeRelationships.id)

const amendmentsAnywhere = (ids: number[]) =>
	db
		.select()
		.from(schema.entryAmendments)
		.where(inArray(schema.entryAmendments.lorebookId, ids))

const roomIn = (title: string, exits?: string) => ({
	name: title,
	content: exits ? `A room.\n\n${exits}` : "A room.",
	params: { entryType: LOCATION_TYPE_ID }
})

describe.each<Kind>(["review", "member"])("own-book route · %s", (kind) => {
	it("1 · match finds the lorebook's entry (held change), or the own book's copy first", async () => {
		const w = await setup(kind)
		const vault = await place(w.book.id, "The Vault")
		const before = await stored(vault.id)
		const out: any = await (
			await w.host()
		).commit!(
			{
				...roomIn("The Vault"),
				content: "Sealed.",
				match: { name: "The Vault" }
			},
			CREATE
		)
		expect(out).toMatchObject({
			id: vault.id,
			matched: true,
			lorebookId: w.book.id,
			route: "own-book"
		})
		expect(await heldRows(w.own.id)).toHaveLength(1)
		expect((await heldRows(w.own.id))[0]).toMatchObject({
			entryId: vault.id,
			lorebookId: w.own.id
		})
		expect(await entriesOf(w.own.id, LOCATION_TYPE_ID)).toHaveLength(0)
		expect(await stored(vault.id)).toEqual(before)

		const w2 = await setup(kind)
		const lore = await place(w2.book.id, "The Vault")
		const copy = await place(w2.own.id, "The Vault", "My copy.")
		const out2: any = await (
			await w2.host()
		).commit!(
			{
				...roomIn("The Vault"),
				content: "Sealed.",
				match: { name: "The Vault" }
			},
			CREATE
		)
		expect(out2).toMatchObject({
			id: copy.id,
			matched: true,
			lorebookId: w2.own.id
		})
		expect((await stored(copy.id)).content).toBe("Sealed.")
		expect(await heldRows(w2.own.id)).toEqual([])
		expect((await stored(lore.id)).content).toBe("The Vault, as written.")
		expect(await entriesOf(w2.own.id, LOCATION_TYPE_ID)).toHaveLength(1)
	})

	it("1b · match by entryId finds an entry of the lorebook too", async () => {
		const w = await setup(kind)
		const vault = await place(w.book.id, "The Vault")
		const out: any = await (
			await w.host()
		).commit!(
			{
				...roomIn("x"),
				content: "Sealed.",
				match: { entryId: vault.id }
			},
			CREATE
		)
		expect(out).toMatchObject({ id: vault.id, matched: true })
		expect(await heldRows(w.own.id)).toHaveLength(1)
	})

	it("2 · two answers refuse within one book, never across the two", async () => {
		const w = await setup(kind)
		const a = await place(w.book.id, "Gate")
		const b = await place(w.book.id, "Gate")
		await expect(
			(await w.host()).commit!(
				{ ...roomIn("Gate"), match: { name: "Gate" } },
				CREATE
			)
		).rejects.toThrow(
			new RegExp(
				`2 entries answer to 'Gate' — 'Gate' \\(entry ${a.id}\\), 'Gate' \\(entry ${b.id}\\)`
			)
		)
		const mine = await place(w.own.id, "Gate", "Mine.")
		const out: any = await (
			await w.host()
		).commit!(
			{ ...roomIn("Gate"), content: "Changed.", match: { name: "Gate" } },
			CREATE
		)
		expect(out).toMatchObject({
			id: mine.id,
			matched: true,
			lorebookId: w.own.id
		})
	})

	it("3 · bind files under a member of the lorebook's cast", async () => {
		const w = await setup(kind)
		const [card] = await db
			.insert(schema.characters)
			.values({
				userId: w.owner.id,
				name: "Ilse",
				description: "The card."
			})
			.returning()
		const [member] = await db
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: w.book.id,
				characterId: card!.id,
				binding: "{{char:Ilse}}",
				name: "Ilse"
			} as any)
			.returning()
		const out: any = await (
			await w.host()
		).commit!(
			{
				name: "Ilse's trait",
				content: "Brave.",
				params: { entryType: CHARACTER_LORE_TYPE_ID },
				bind: `character:${card!.id}`
			},
			CREATE
		)
		expect((await stored(out.id)).anchorBindingId).toBe(member!.id)
		expect((await stored(out.id)).lorebookId).toBe(w.own.id)
		const out2: any = await (
			await w.host()
		).commit!(
			{
				name: "Again",
				content: "Kind.",
				params: { entryType: CHARACTER_LORE_TYPE_ID },
				bind: `seated-member:${member!.id}`
			},
			CREATE
		)
		expect((await stored(out2.id)).anchorBindingId).toBe(member!.id)
		await expect(
			(await w.host()).commit!(
				{
					name: "Nobody",
					content: "?",
					params: { entryType: CHARACTER_LORE_TYPE_ID },
					bind: "character:99999999"
				},
				CREATE
			)
		).rejects.toThrow("is not in this book's cast")
	})

	it("4 · an Exits line reaches a room of the lorebook", async () => {
		const w = await setup(kind)
		const hall = await place(w.book.id, "The Lorebook Hall")
		const out: any = await (
			await w.host()
		).commit!(
			roomIn("The Cellar", "Exits: north → The Lorebook Hall"),
			CREATE
		)
		expect(out.lorebookId).toBe(w.own.id)
		const rows = await linksOf(w.own.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			fromEntryId: out.id,
			toEntryId: hall.id,
			branchId: null
		})
		// Own book first: a room of the same name in the notes wins.
		const w2 = await setup(kind)
		await place(w2.book.id, "The Lorebook Hall")
		const mine = await place(w2.own.id, "The Lorebook Hall")
		const out2: any = await (
			await w2.host()
		).commit!(
			roomIn("The Cellar", "Exits: north → The Lorebook Hall"),
			CREATE
		)
		expect((await linksOf(w2.own.id))[0]).toMatchObject({
			fromEntryId: out2.id,
			toEntryId: mine.id
		})
	})

	it("5 · link-lore-entries joins the two books, once", async () => {
		const w = await setup(kind)
		const hall = await place(w.book.id, "The Hall")
		const keep = await place(w.book.id, "The Keep")
		const mine = await place(w.own.id, "My Den")
		const out: any = await (
			await w.host()
		).commit!({ from: mine.id, to: "The Hall" }, LINK)
		expect(out).toMatchObject({
			fromEntryId: mine.id,
			lorebookId: w.own.id
		})
		const rows = await linksOf(w.own.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			fromEntryId: mine.id,
			toEntryId: hall.id,
			lorebookId: w.own.id,
			branchId: null
		})
		const byId: any = await (
			await w.host()
		).commit!({ from: "My Den", to: keep.id }, LINK)
		expect(byId.written).toBeUndefined()
		expect(await linksOf(w.own.id)).toHaveLength(2)
		expect(await linksOf(w.book.id)).toHaveLength(0)
		// Repeated: found, nothing more.
		const again: any = await (
			await w.host()
		).commit!({ from: mine.id, to: "The Hall" }, LINK)
		expect(again).toMatchObject({
			id: out.id,
			written: false,
			lorebookId: w.own.id
		})
		expect(await linksOf(w.own.id)).toHaveLength(2)
		// Two lorebook entries: one row in the own book.
		const both: any = await (
			await w.host()
		).commit!({ from: "The Keep", to: "The Hall" }, LINK)
		expect(both.lorebookId).toBe(w.own.id)
		expect((await linksOf(w.own.id)).at(-1)).toMatchObject({
			fromEntryId: keep.id,
			toEntryId: hall.id
		})
		expect(await linksOf(w.own.id)).toHaveLength(3)
	})

	it("5b · a link the lorebook already holds is not written again", async () => {
		const w = await setup(kind)
		const hall = await place(w.book.id, "The Hall")
		const keep = await place(w.book.id, "The Keep")
		const [held] = await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: w.book.id,
				fromEntryId: keep.id,
				toEntryId: hall.id,
				relationshipType: "leads to",
				title: "",
				description: ""
			} as any)
			.returning()
		const out: any = await (
			await w.host()
		).commit!({ from: keep.id, to: hall.id }, LINK)
		expect(out).toMatchObject({
			id: held!.id,
			lorebookId: w.book.id,
			written: false
		})
		expect(await linksOf(w.own.id)).toHaveLength(0)
		// From the Exits line too.
		const w2 = await setup(kind)
		await place(w2.book.id, "The Hall")
		const out2: any = await (
			await w2.host()
		).commit!(roomIn("The Cellar", "Exits: north → The Hall"), CREATE)
		expect(await linksOf(w2.own.id)).toHaveLength(1)
		expect(out2.id).toBeTypeOf("number")
	})

	it("5c · an own-book tie copy already says it: nothing is written twice, dated or not", async () => {
		const w = await setup(kind)
		const hall = await place(w.book.id, "The Hall")
		const keep = await place(w.book.id, "The Keep")
		// A history day the session reads dates the written link, so it is not
		// the tie copy's own undated twin in the unique index.
		await day(w.book.id, { year: 4 })
		const [copy] = await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: w.own.id,
				fromEntryId: keep.id,
				toEntryId: hall.id,
				relationshipType: "leads to",
				title: "",
				description: "",
				rulesRunId: "ruleset-run-1"
			} as any)
			.returning()
		const out: any = await (
			await w.host()
		).commit!({ from: keep.id, to: hall.id }, LINK)
		expect(out.written).toBe(false)
		expect(out.id).toBe(copy!.id)
		expect(await linksOf(w.own.id)).toHaveLength(1)
	})

	it("6 · an id in a third book is refused with its own sentence", async () => {
		const w = await setup(kind)
		const mine = await place(w.own.id, "My Den")
		const [third] = await db
			.insert(schema.lorebooks)
			.values({ userId: w.owner.id, name: `Third ${w.suffix}` })
			.returning()
		const far = await place(third!.id, "Far Room")
		await expect(
			(await w.host()).commit!({ from: mine.id, to: far.id }, LINK)
		).rejects.toThrow(
			`tie: entry ${far.id} is not in this session's lorebook or its notes, so there is nothing here to link it to.`
		)
		await expect(
			(await w.host()).commit!({ from: far.id, to: mine.id }, LINK)
		).rejects.toThrow(`is not in this session's lorebook or its notes`)
	})

	it("7 · a history write files onto the own book's day, never held on the lorebook's", async () => {
		const w = await setup(kind)
		const write = async (
			content: string,
			fields = { year: 3, month: 2, day: 4 }
		) =>
			(await w.host()).commit!(
				{
					name: "Day",
					content,
					params: { entryType: HISTORY_TYPE_ID },
					fields
				},
				CREATE
			) as Promise<any>
		const first = await write("A.")
		const second = await write("B.")
		expect(second.id).toBe(first.id)
		const days = await entriesOf(w.own.id, HISTORY_TYPE_ID)
		expect(days).toHaveLength(1)
		expect(days[0]!.content).toBe("A.\n\nB.")
		expect(second.notes?.[0]).toMatch(/filed onto .*'s entry/)

		// The lorebook holds that date: still the own book's day, no held change.
		const w2 = await setup(kind)
		const lorebookDay = await day(w2.book.id, { year: 3, month: 2, day: 4 })
		const out: any = await (
			await w2.host()
		).commit!(
			{
				name: "Day",
				content: "Mine.",
				params: { entryType: HISTORY_TYPE_ID },
				fields: { year: 3, month: 2, day: 4 }
			},
			CREATE
		)
		expect(out.lorebookId).toBe(w2.own.id)
		expect((await stored(out.id)).lorebookId).toBe(w2.own.id)
		expect(await amendmentsAnywhere([w2.own.id, w2.book.id])).toEqual([])
		expect((await stored(lorebookDay.id)).content).toBe("")
		expect(await entriesOf(w2.book.id, HISTORY_TYPE_ID)).toHaveLength(1)
	})

	it("7b · a date is checked against the lorebook's calendar", async () => {
		const thirteen = {
			months: Array.from({ length: 13 }, (_, i) => ({
				name: `M${i + 1}`,
				days: 28
			}))
		}
		const w = await setup(kind, { calendar: thirteen })
		const write = (fields: Record<string, number>) =>
			w.host().commit!(
				{
					name: "Day",
					content: "X.",
					params: { entryType: HISTORY_TYPE_ID },
					fields
				},
				CREATE
			) as Promise<any>
		const ok = await write({ year: 2, month: 13, day: 3 })
		expect((await stored(ok.id)).fields).toMatchObject({
			year: 2,
			month: 13,
			day: 3
		})
		await expect(write({ year: 2, month: 14, day: 1 })).rejects.toThrow(
			"does not fit this book's calendar"
		)
	})

	it("8 · a link is dated by the newest day of the two books; the default date follows the notes' newest day", async () => {
		const w = await setup(kind)
		const hall = await place(w.book.id, "The Hall")
		const keep = await place(w.book.id, "The Keep")
		const loreDay = await day(w.book.id, { year: 5 })
		const ownDay = await day(w.own.id, { year: 9 })
		const out: any = await (
			await w.host()
		).commit!({ from: keep.id, to: hall.id }, LINK)
		expect(
			(await linksOf(w.own.id)).find((r) => r.id === out.id)!
				.historyEntryId
		).toBe(ownDay.id)
		// The default history date, with no clock: the notes' day is the newest.
		const filed: any = await (
			await w.host()
		).commit!(
			{
				name: "Day",
				content: "Then.",
				params: { entryType: HISTORY_TYPE_ID }
			},
			CREATE
		)
		expect(filed.id).toBe(ownDay.id)
		expect(loreDay.id).not.toBe(ownDay.id)

		// The lorebook's day is newer, or the same date: the lorebook's day dates it.
		for (const [loreYear, ownYear] of [
			[12, 9],
			[9, 9]
		] as const) {
			const v = await setup(kind)
			const a = await place(v.book.id, "A")
			const b = await place(v.book.id, "B")
			const l = await day(v.book.id, { year: loreYear })
			await day(v.own.id, { year: ownYear })
			const r: any = await (
				await v.host()
			).commit!({ from: a.id, to: b.id }, LINK)
			expect(
				(await linksOf(v.own.id)).find((x) => x.id === r.id)!
					.historyEntryId
			).toBe(l.id)
		}
	})

	it("9 · the prompt's current date counts the notes' newest day", async () => {
		const w = await setup(kind)
		await day(w.book.id, { year: 5 })
		await day(w.own.id, { year: 9, month: 2 })
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const read: any = await createHost(db as unknown as Db, {
			sessionId: w.session.id
		}).read!("session_cast", { sessionId: w.session.id }, {
			key: "read",
			definitionId: "core:query/session-cast@1"
		} as any)
		expect(read.storyTime.now).toMatchObject({
			year: 9,
			month: 2,
			from: "history"
		})
	})

	it("10 · a press-started run (action family, no turn message)", async () => {
		const { withRunFamily } = await import("$lib/server/utils/llmQueue")
		const w = await setup(kind)
		const hall = await place(w.book.id, "The Hall")
		const keep = await place(w.book.id, "The Keep")
		const imprints = () =>
			db
				.select()
				.from(schema.loreImprints)
				.where(eq(schema.loreImprints.sessionId, w.session.id))
		const out: any = await withRunFamily("action", async () =>
			(await w.host("press-1")).commit!(
				{ from: keep.id, to: hall.id },
				LINK
			)
		)
		const rows = await imprints()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			subjectKind: "relationship",
			subjectId: out.id,
			lorebookId: w.own.id,
			messageId: w.message.id,
			runId: "press-1"
		})
		// A new own-book entry is anchored by its source message, and imprints nothing.
		const made: any = await withRunFamily("action", async () =>
			(await w.host("press-2")).commit!(roomIn("The Cellar"), CREATE)
		)
		expect((await stored(made.id)).sourceMessageId).toBe(w.message.id)
		expect(await imprints()).toHaveLength(1)
	})
})

describe("9 · Full", () => {
	it("a Full session reads its own book's newer history day in its current date", async () => {
		const w = await setup("review", { ownMode: "full" })
		await day(w.book.id, { year: 5 })
		await day(w.own.id, { year: 9 })
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const read: any = await createHost(db as unknown as Db, {
			sessionId: w.session.id
		}).read!("session_cast", { sessionId: w.session.id }, {
			key: "read",
			definitionId: "core:query/session-cast@1"
		} as any)
		expect(read.storyTime.now).toMatchObject({ year: 9, from: "history" })
	})

	it("the Full route's sentences and its links are unchanged (a session whose scenes do not end by themselves)", async () => {
		const w = await setup("review", { ownMode: "full" })
		const a = await place(w.book.id, "A")
		const [third] = await db
			.insert(schema.lorebooks)
			.values({ userId: w.owner.id, name: `Third ${w.suffix}` })
			.returning()
		const far = await place(third!.id, "Far Room")
		await expect(
			(await w.host()).commit!({ from: a.id, to: far.id }, LINK)
		).rejects.toThrow(
			`tie: entry ${far.id} is not in this session's lorebook, so there is nothing here to link it to. Both ends of a link live in one book.`
		)
		const b = await place(w.book.id, "B")
		await (
			await w.host()
		).commit!({ from: a.id, to: b.id }, LINK)
		expect(await linksOf(w.book.id)).toHaveLength(1)
		expect(await linksOf(w.own.id)).toHaveLength(0)
	})

	it("a session whose scenes end by themselves writes a cross-book link to the own book, and words an id in neither book as the own-book route does", async () => {
		const w = await setup("review", { ownMode: "full" })
		scenesEnd.add(w.session.id)
		const hall = await place(w.book.id, "The Hall")
		const mine = await place(w.own.id, "My Den")
		const [third] = await db
			.insert(schema.lorebooks)
			.values({ userId: w.owner.id, name: `Third ${w.suffix}` })
			.returning()
		const far = await place(third!.id, "Far Room")
		await expect(
			(await w.host()).commit!({ from: mine.id, to: far.id }, LINK)
		).rejects.toThrow(
			`tie: entry ${far.id} is not in this session's lorebook or its notes, so there is nothing here to link it to.`
		)
		const out: any = await (await w.host()).commit!({ from: mine.id, to: "The Hall" }, LINK)
		expect(out).toMatchObject({ fromEntryId: mine.id, lorebookId: w.own.id })
		// Two lorebook rooms: the row is the own book's, never the lorebook's.
		const keep = await place(w.book.id, "The Keep")
		const both: any = await (await w.host()).commit!({ from: keep.id, to: hall.id }, LINK)
		expect(both.lorebookId).toBe(w.own.id)
		expect(await linksOf(w.own.id)).toHaveLength(2)
		expect(await linksOf(w.book.id)).toHaveLength(0)
	})
})
