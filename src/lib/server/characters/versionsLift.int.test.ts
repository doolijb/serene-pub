/**
 * ⏳ The `character-versions` boot pass (`characters/versionsLift.ts`, plan
 * §32 §8, §33.4).
 *
 * Claims: a second run changes nothing and reads one query; ids that overlap
 * between cards and members still lift onto the right owner; after the lift
 * the real reader (`membersAsRead`) reads every member at every (line, moment,
 * appearance) as today's fold does (`castAsOf` over the appearance's
 * amendments, layered by `layerMemberAsRead`), for every shape an amendment
 * takes; 34-and-50-year-old appearances read apart; a branch chain with cuts,
 * and a branch amendment dated before a later main one (★CV-1), read as today;
 * mixed greetings become the member's own list and are noted; seats get the
 * card owner; one failing book rolls back alone and the pass throws at the
 * end; an attic upgrade, then the pass, leaves every card with v1 and every
 * member with a base.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	layerMemberAsRead,
	membersAsRead,
	type MemberAsRead,
	type MemberRowForReading
} from "$lib/server/cast/memberAsRead"
import { MAIN_HEAD } from "$lib/server/state/entriesOnReading"
import { mergeGreetings } from "$lib/shared/characters/profile"
import {
	amendmentsForAppearance,
	castAsOf
} from "$lib/shared/lorebooks/amendments"
import {
	amendmentsOnLine,
	lineOf,
	MAIN_LINE,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import { liftCharacterVersions, parseLiftNote } from "./versionsLift"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const failing = vi.hoisted(() => ({ bookId: -1 }))

vi.mock("$lib/server/characters/versions", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/characters/versions")>()
	return {
		...actual,
		// The real insert runs, then a chosen book throws: its writes must not survive.
		insertCharacterVersions: async (
			tx: Db,
			rows: Parameters<typeof actual.insertCharacterVersions>[1]
		) => {
			const inserted = await actual.insertCharacterVersions(tx, rows)
			if (rows.some((r) => r.lorebookId === failing.bookId))
				throw new Error("boom")
			return inserted
		}
	}
})

let testDb: TestDb
const asDb = () => testDb as unknown as Db
const lift = () => liftCharacterVersions(asDb())

beforeAll(async () => {
	testDb = await createTestDb()
}, 60_000)

const ZEROS = {
	cards: 0,
	members: 0,
	versions: 0,
	noted: 0,
	seats: 0,
	failed: 0
}

// ── Builders ──────────────────────────────────────────────────────────────

let n = 0
const uniq = (label: string) => `${label}-${++n}`

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("lift-user") })
		.returning()
	return row!
}
async function card(
	userId: number,
	name: string,
	extra: Partial<typeof schema.characters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: `${name} card.`, ...extra })
		.returning()
	return row!
}
async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book") })
		.returning()
	return row!
}
async function member(
	lorebookId: number,
	characterId: number | null,
	extra: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			binding: uniq("{{char:x}}"),
			characterId,
			name: "",
			...extra
		})
		.returning()
	return row!
}
async function amend(
	m: { id: number; lorebookId: number },
	at: {
		year: number
		month?: number | null
		day?: number | null
		branchId?: number | null
		personalPosition?: number | null
	},
	fields: Record<string, unknown>
) {
	const [row] = await testDb
		.insert(schema.castAmendments)
		.values({
			lorebookBindingId: m.id,
			lorebookId: m.lorebookId,
			year: at.year,
			month: at.month ?? null,
			day: at.day ?? null,
			branchId: at.branchId ?? null,
			personalPosition: at.personalPosition ?? null,
			fields
		})
		.returning()
	return row!
}
async function presence(
	m: { id: number; lorebookId: number },
	personalPosition: number
) {
	await testDb.insert(schema.castPresences).values({
		lorebookBindingId: m.id,
		lorebookId: m.lorebookId,
		personalPosition,
		fromYear: 0
	})
}
async function branch(
	lorebookId: number,
	extra: Partial<typeof schema.lorebookBranches.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId, name: uniq("line"), ...extra })
		.returning()
	return row!
}
async function file(userId: number) {
	const [row] = await testDb
		.insert(schema.files)
		.values({ userId, kind: "image", hash: uniq("lift-file") } as never)
		.returning()
	return row!
}
const versionsOf = (memberId: number) =>
	testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))
		.orderBy(schema.characterVersions.id)
const baseOf = async (memberId: number) =>
	(await versionsOf(memberId)).find(
		(v) => v.branchId == null && v.year == null
	)!
const cardV1 = async (cardId: number) =>
	(
		await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.cardId, cardId))
	)[0]!
const Y = (
	year: number,
	month: number | null = null,
	day: number | null = null
): StoryDate => ({ year, month, day })

/** Every table the pass writes, as comparable rows. */
const written = async () => ({
	versions: await testDb
		.select({
			id: schema.characterVersions.id,
			note: schema.characterVersions.note,
			writeOrder: schema.characterVersions.writeOrder
		})
		.from(schema.characterVersions)
		.orderBy(schema.characterVersions.id),
	seats: await testDb
		.select({
			id: schema.sessionCharacters.id,
			by: schema.sessionCharacters.seatedByUserId
		})
		.from(schema.sessionCharacters)
		.orderBy(schema.sessionCharacters.id)
})

/** Lifts, and proves a second run changes nothing. */
async function liftTwice() {
	const first = await lift()
	const before = await written()
	expect(await lift()).toEqual(ZEROS)
	expect(await written()).toEqual(before)
	return first
}

// ── Today's read, and the reader ──────────────────────────────────────────

interface LineSpec {
	label: string
	branchId: number | null
	line: Line
}
async function linesOf(bookId: number): Promise<LineSpec[]> {
	const branches = await testDb
		.select()
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, bookId))
	return [
		{ label: "main", branchId: null, line: MAIN_LINE },
		...branches.map((b) => ({
			label: b.name,
			branchId: b.id,
			line: lineOf(b.id, branches)
		}))
	]
}

/** What the reads are compared on. */
function shape(
	read: MemberAsRead,
	nodeState: unknown,
	nodeVisibility: unknown
) {
	return {
		name: read.name,
		nickname: read.nickname,
		aliases: read.aliases,
		summary: read.summary,
		description: read.description,
		personality: read.personality,
		scenario: read.scenario,
		greetings: read.greetings,
		exampleDialogues: read.exampleDialogues,
		faceMediaId: read.faceMediaId,
		timbre: read.timbre,
		activeCardId: read.activeCardId,
		spriteSet: read.spriteSet,
		nodeState,
		nodeVisibility
	}
}

/** Today's read (the brief's oracle): the appearance's amendments folded over the stored row, layered over the card it draws. */
async function today(
	memberId: number,
	spec: LineSpec,
	moment: StoryDate | null,
	appearance: number | null
) {
	const [row] = await testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, memberId))
	const amendments = (
		await testDb
			.select()
			.from(schema.castAmendments)
			.where(eq(schema.castAmendments.lorebookBindingId, memberId))
	).map((a) => ({
		id: a.id,
		branchId: a.branchId ?? null,
		year: a.year,
		month: a.month ?? null,
		day: a.day ?? null,
		fields: (a.fields ?? {}) as Record<string, unknown>,
		personalPosition: a.personalPosition ?? null
	}))
	const folded = castAsOf(
		row as Record<string, unknown>,
		amendmentsForAppearance(
			amendmentsOnLine(amendments, spec.line, moment),
			appearance
		),
		{ line: spec.line, moment }
	)
	const cardId =
		typeof folded.characterId === "number" ? folded.characterId : null
	const [cardRow] = cardId
		? await testDb
				.select()
				.from(schema.characters)
				.where(eq(schema.characters.id, cardId))
		: []
	const read = layerMemberAsRead(
		{
			...folded,
			linkedCardId: row!.characterId
		} as unknown as MemberRowForReading,
		cardRow ?? null,
		{ member: [], card: [] },
		[]
	)
	return shape(
		{
			...read,
			greetings: mergeGreetings(
				read.firstMessage,
				read.alternateGreetings,
				read.groupOnlyGreetings
			)
		},
		folded.nodeState,
		folded.nodeVisibility
	)
}

/** The real reader at one reading. */
async function reader(
	memberId: number,
	spec: LineSpec,
	moment: StoryDate | null,
	appearance: number | null
) {
	const read = (
		await membersAsRead(asDb(), [memberId], {
			reading: {
				...MAIN_HEAD,
				branchId: spec.branchId,
				line: spec.line,
				moment
			},
			appearance
		})
	).get(memberId)!
	return shape(read, read.nodeState, read.nodeVisibility)
}

interface Grid {
	lines: LineSpec[]
	moments: (StoryDate | null)[]
	appearances?: (number | null)[]
}

/** Every (line, moment, appearance) at which the reader and today's fold disagree. */
async function mismatches(memberId: number, grid: Grid) {
	const out: unknown[] = []
	for (const spec of grid.lines)
		for (const moment of grid.moments)
			for (const appearance of grid.appearances ?? [null]) {
				const want = await today(memberId, spec, moment, appearance)
				const got = await reader(memberId, spec, moment, appearance)
				if (JSON.stringify(want) !== JSON.stringify(got))
					out.push({
						line: spec.label,
						moment,
						appearance,
						want,
						got
					})
			}
	return out
}

/** The moments 0..40, with a month inside some. */
const MOMENTS: (StoryDate | null)[] = [
	null,
	...[0, 3, 5, 8, 10, 12, 15, 16, 17, 20, 25, 30, 40].map((y) => Y(y)),
	Y(15, 3),
	Y(10, 6, 2)
]

/** The member has no version before the lift (the reader leaves such a member out; the oracle is checked against the lifted versions). */
async function oracleAgreesWithLegacy(memberId: number, _grid: Grid) {
	expect(await versionsOf(memberId)).toHaveLength(0)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("the pass", () => {
	test("a second boot changes nothing and reads one query", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, "Ada")
		const m = await member(b.id, c.id)
		await amend(m, { year: 5 }, { summary: "five" })
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, name: uniq("Run") })
			.returning()
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: session!.id, characterId: c.id })
		const first = await liftTwice()
		expect(first).toMatchObject({
			cards: 1,
			members: 1,
			versions: 1,
			noted: 0,
			seats: 1,
			failed: 0
		})

		const spies = (
			[
				"execute",
				"select",
				"insert",
				"update",
				"delete",
				"transaction"
			] as const
		).map((method) => vi.spyOn(testDb, method))
		try {
			expect(await lift()).toEqual(ZEROS)
			expect(spies[0]).toHaveBeenCalledTimes(1)
			for (const spy of spies.slice(1)) expect(spy).not.toHaveBeenCalled()
		} finally {
			for (const spy of spies) spy.mockRestore()
		}
	})

	test("a card and a member with the same id, and a member whose id is another card's, lift onto the right owner", async () => {
		const ids = await testDb.execute(
			sql`select greatest((select coalesce(max(id), 0) from characters), (select coalesce(max(id), 0) from lorebook_bindings)) + 1000 as n`
		)
		const N = Number(rawRows<{ n: unknown }>(ids)[0].n)
		const ua = await user()
		const ub = await user()
		const ba = await book(ua.id)
		const bb = await book(ub.id)
		const [cardN] = await testDb
			.insert(schema.characters)
			.values({ id: N, userId: ua.id, name: "Card N", description: "N." })
			.returning()
		const [cardN1] = await testDb
			.insert(schema.characters)
			.values({
				id: N + 1,
				userId: ub.id,
				name: "Card N+1",
				description: "N+1."
			})
			.returning()
		const same = await member(ba.id, cardN!.id, { id: N })
		const other = await member(bb.id, cardN!.id, { id: N + 1 })
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: ub.id, isGroup: false, name: uniq("Run") })
			.returning()
		await testDb.insert(schema.sessionCharacters).values([
			{ sessionId: session!.id, characterId: cardN!.id },
			{ sessionId: session!.id, characterId: cardN1!.id }
		])

		await liftTwice()
		expect(same.id).toBe(cardN!.id)
		expect((await cardV1(cardN!.id)).cardId).toBe(N)
		expect((await cardV1(cardN1!.id)).cardId).toBe(N + 1)
		expect((await baseOf(same.id)).parentVersionId).toBe(
			(await cardV1(cardN!.id)).id
		)
		expect((await baseOf(other.id)).parentVersionId).toBe(
			(await cardV1(cardN!.id)).id
		)
		expect((await baseOf(other.id)).lorebookId).toBe(bb.id)
		const seats = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, session!.id))
			.orderBy(schema.sessionCharacters.id)
		expect(seats.map((s) => s.seatedByUserId)).toEqual([ua.id, ub.id])
	})
})

describe("overlay rows", () => {
	test("an overlay row gets no base: it holds only a session's writes", async () => {
		const u = await user()
		const attached = await book(u.id)
		const own = await book(u.id)
		const c = await card(u.id, "Ada")
		const m = await member(attached.id, c.id)
		const overlay = await member(own.id, c.id, { overlayOf: m.id })

		const report = await liftTwice()
		expect(report).toMatchObject({ members: 1, failed: 0 })
		expect(await versionsOf(m.id)).toHaveLength(1)
		expect(await versionsOf(overlay.id)).toHaveLength(0)
	})
})

describe("every amendment shape reads as today's fold", () => {
	test("retold fields turned on and off, an own name and an own empty nickname", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, "Ada", {
			nickname: "Adie",
			description: "Card description.",
			personality: "Card personality.",
			scenario: "Card scenario.",
			firstMessage: "Card hello.",
			alternateGreetings: ["Card alt."],
			groupOnlyGreetings: ["Card group."],
			exampleDialogues: ["<START>\nA: hi"]
		})
		const m = await member(b.id, c.id, {
			ownName: "Ada R",
			ownNickname: "",
			retold: { description: true, exampleDialogues: true },
			description: "Retold description.",
			personality: "Hidden own personality.",
			exampleDialogues: "<START>\nA: mine"
		})
		await amend(
			m,
			{ year: 10 },
			{
				retold: {
					description: true,
					personality: true,
					scenario: true
				},
				personality: "Retold at 10.",
				scenario: "Scenario at 10."
			}
		)
		await amend(m, { year: 15, month: 3 }, { summary: "Mid-spring" })
		await amend(m, { year: 20 }, { retold: {} })
		await amend(
			m,
			{ year: 30 },
			{ retold: { description: true }, description: "Back at 30." }
		)
		const grid = { lines: await linesOf(b.id), moments: MOMENTS }
		await oracleAgreesWithLegacy(m.id, grid)

		const report = await liftTwice()
		expect(report).toMatchObject({ members: 1, noted: 0, failed: 0 })
		expect(await mismatches(m.id, grid)).toEqual([])
		const base = await baseOf(m.id)
		expect(base.follows).toContain("personality")
		expect(base.follows).toContain("scenario")
		expect(base.follows).not.toContain("description")
		expect(base.follows).not.toContain("name")
		expect(base.follows).not.toContain("nickname")
		expect(base.nickname).toBeNull()
		expect(base.name).toBe("Ada R")
		expect(base.note).toBeNull()
		expect(
			(await versionsOf(m.id)).every((v) => v.writtenBy === "lift")
		).toBe(true)
	})

	test("a face retold with and without a face id, and a member timbre", async () => {
		const u = await user()
		const b = await book(u.id)
		const [avatar, own, later] = [
			await file(u.id),
			await file(u.id),
			await file(u.id)
		]
		// A book holds a card once: one card for each member, alike.
		const faced = (name: string) =>
			card(u.id, name, {
				avatarMediaId: avatar.id,
				extensions: {
					serenepub: { timbre: { description: "A card voice" } }
				}
			})
		const withFace = await member(b.id, (await faced("Ada")).id, {
			retold: { face: true },
			faceMediaId: own.id,
			timbre: { description: "A member voice" }
		})
		const noFace = await member(b.id, (await faced("Bea")).id, {
			retold: { face: true }
		})
		const followed = await member(b.id, (await faced("Cy")).id, {
			faceMediaId: own.id
		})
		await amend(
			withFace,
			{ year: 10 },
			{ faceMediaId: later.id, retold: { face: true } }
		)
		await amend(withFace, { year: 20 }, { retold: {} })
		await amend(noFace, { year: 12 }, { faceMediaId: later.id })
		const lines = await linesOf(b.id)
		const grid = { lines, moments: [null, Y(5), Y(10), Y(15), Y(20)] }
		for (const m of [withFace, noFace, followed])
			await oracleAgreesWithLegacy(m.id, grid)

		await liftTwice()
		for (const m of [withFace, noFace, followed])
			expect(await mismatches(m.id, grid)).toEqual([])
		expect(
			(await reader(withFace.id, lines[0], null, null)).faceMediaId
		).toBe(avatar.id)
		expect(
			(await reader(withFace.id, lines[0], Y(10), null)).faceMediaId
		).toBe(later.id)
		expect((await baseOf(noFace.id)).follows).toContain("faceMediaId")
		expect((await baseOf(withFace.id)).faceMediaId).toBe(own.id)
	})

	test("a dated card: the version's parent is that card's v1", async () => {
		const u = await user()
		const b = await book(u.id)
		const young = await card(u.id, "Verity young", {
			description: "Young."
		})
		const old = await card(u.id, "Verity old", {
			description: "Old.",
			firstMessage: "Old hello."
		})
		const m = await member(b.id, young.id)
		await amend(m, { year: 15 }, { characterId: old.id })
		await amend(
			m,
			{ year: 25 },
			{ characterId: young.id, summary: "Young again" }
		)
		const grid = { lines: await linesOf(b.id), moments: MOMENTS }
		await oracleAgreesWithLegacy(m.id, grid)

		await liftTwice()
		expect(await mismatches(m.id, grid)).toEqual([])
		const versions = await versionsOf(m.id)
		const at15 = versions.find((v) => v.year === 15)!
		expect(at15.parentVersionId).toBe((await cardV1(old.id)).id)
		expect((await baseOf(m.id)).parentVersionId).toBe(
			(await cardV1(young.id)).id
		)
		expect(versions.find((v) => v.year === 25)!.parentVersionId).toBe(
			(await cardV1(young.id)).id
		)
		expect(at15.liftedFromAmendmentId).not.toBeNull()
		// The amendments are never changed or removed.
		expect(
			await testDb
				.select()
				.from(schema.castAmendments)
				.where(eq(schema.castAmendments.lorebookBindingId, m.id))
		).toHaveLength(2)
	})

	test("a deleted card makes the member card-less", async () => {
		const u = await user()
		const b = await book(u.id)
		const ghost = await card(u.id, "Ghost", { description: "Gone." })
		const gone = await card(u.id, "Gone", { description: "Gone too." })
		const m = await member(b.id, ghost.id, {
			name: "Ghost",
			description: "Own description.",
			firstMessage: "Own hello.",
			alternateGreetings: ["Own alt."]
		})
		await amend(
			m,
			{ year: 5 },
			{ characterId: gone.id, name: "Ghost at 5" }
		)
		await amend(m, { year: 9 }, { summary: "Nine" })
		await testDb
			.delete(schema.characters)
			.where(eq(schema.characters.id, gone.id))
		await testDb
			.delete(schema.characters)
			.where(eq(schema.characters.id, ghost.id))
		const grid = { lines: await linesOf(b.id), moments: MOMENTS }
		await oracleAgreesWithLegacy(m.id, grid)

		const report = await liftTwice()
		expect(report).toMatchObject({ members: 1, noted: 0 })
		expect(await mismatches(m.id, grid)).toEqual([])
		for (const v of await versionsOf(m.id)) {
			expect(v.parentVersionId).toBeNull()
			expect(v.follows).toEqual([])
		}
		expect((await baseOf(m.id)).name).toBe("Ghost")
		expect((await reader(m.id, grid.lines[0], Y(5), null)).name).toBe(
			"Ghost at 5"
		)
	})

	test("a node state set at a date, and a card-less member's own text", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(b.id, null, {
			name: "Narrator",
			description: "Voice.",
			firstMessage: "Hello.",
			alternateGreetings: ["Hi."],
			exampleDialogues: "<START>\nN: ok",
			spriteSet: "default"
		})
		await amend(m, { year: 10 }, { nodeState: "deceased" })
		await amend(
			m,
			{ year: 12 },
			{ nodeVisibility: "hidden", name: "Narrator II" }
		)
		await amend(
			m,
			{ year: 20 },
			{ nodeState: "active", spriteSet: "ghost" }
		)
		const grid = { lines: await linesOf(b.id), moments: MOMENTS }
		await oracleAgreesWithLegacy(m.id, grid)

		await liftTwice()
		expect(await mismatches(m.id, grid)).toEqual([])
		expect((await reader(m.id, grid.lines[0], Y(11), null)).nodeState).toBe(
			"deceased"
		)
		const at10 = (await versionsOf(m.id)).find((v) => v.year === 10)!
		expect(at10.nodeState).toBe("deceased")
		expect(at10.follows).toEqual([])
	})
})

describe("life points", () => {
	test("34 and 50 read apart at one world moment, each appearance and the session read as today", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, "Ada")
		const m = await member(b.id, c.id)
		await presence(m, 34)
		await presence(m, 50)
		await amend(m, { year: 10 }, { summary: "world 10" })
		await amend(
			m,
			{ year: 12, personalPosition: 34 },
			{ summary: "at 34", aliases: ["Addie"] }
		)
		await amend(
			m,
			{ year: 8, personalPosition: 50 },
			{
				summary: "at 50",
				retold: { description: true },
				description: "Fifty."
			}
		)
		await amend(m, { year: 20 }, { aliases: ["Ada W"] })
		await amend(
			m,
			{ year: 25, personalPosition: 34 },
			{ nodeState: "missing" }
		)
		const grid = {
			lines: await linesOf(b.id),
			moments: [
				null,
				...[5, 8, 9, 10, 11, 12, 15, 20, 24, 25, 30].map((y) => Y(y))
			],
			appearances: [null, 20, 33, 34, 35, 49, 50, 60]
		}
		await oracleAgreesWithLegacy(m.id, grid)

		const report = await liftTwice()
		expect(report).toMatchObject({ members: 1, noted: 0 })
		expect(await mismatches(m.id, grid)).toEqual([])
		// They really do read apart.
		const main = grid.lines[0]
		expect((await reader(m.id, main, Y(15), 34)).summary).toBe("at 34")
		expect((await reader(m.id, main, Y(15), 50)).summary).toBe("at 34")
		expect((await reader(m.id, main, Y(9), 50)).summary).toBe("at 50")
		expect((await reader(m.id, main, Y(9), 34)).summary).toBeNull()
		const positions = (await versionsOf(m.id)).map(
			(v) => v.personalPosition
		)
		expect(positions).toContain(34)
		expect(positions).toContain(50)
	})
})

describe("branch chains", () => {
	test("main, a fork at a date, a fork of that fork, and a branch amendment dated before a later main one", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, "Ada")
		const m = await member(b.id, c.id)
		const B = await branch(b.id, { forkYear: 10 })
		const C = await branch(b.id, { forkedFromBranchId: B.id, forkYear: 15 })
		// Forked at "now": cuts nothing, so ★CV-1 shows.
		const B2 = await branch(b.id)
		await amend(m, { year: 5 }, { summary: "m5" })
		await amend(m, { year: 12 }, { summary: "m12" })
		await amend(
			m,
			{ year: 20 },
			{ summary: "m20", aliases: ["Main alias"] }
		)
		await amend(m, { year: 8, branchId: B.id }, { summary: "b8" })
		await amend(m, { year: 16, branchId: B.id }, { aliases: ["B alias"] })
		await amend(m, { year: 17, branchId: C.id }, { summary: "c17" })
		await amend(m, { year: 3, branchId: B2.id }, { summary: "b2-3" })
		const grid = { lines: await linesOf(b.id), moments: MOMENTS }
		await oracleAgreesWithLegacy(m.id, grid)

		const report = await liftTwice()
		// Every difference is something a version on the line can say: nothing is noted.
		expect(report).toMatchObject({ members: 1, noted: 0, failed: 0 })
		expect(await mismatches(m.id, grid)).toEqual([])

		const versions = await versionsOf(m.id)
		expect(
			versions.filter((v) => v.branchId === B2.id).map((v) => v.year)
		).toEqual([3, 5, 12, 20])
		// Main's own versions: one per main breakpoint, the base apart.
		expect(
			versions
				.filter((v) => v.branchId == null && v.year != null)
				.map((v) => v.year)
		).toEqual([5, 12, 20])
		expect(report.versions).toBe(versions.length - 1)
		expect((await baseOf(m.id)).note).toBeNull()
		// Write order matches the order the lift wrote them in.
		const orders = versions.map((v) => v.writeOrder)
		expect(orders).toEqual([...orders].sort((a, b2) => a - b2))
		// A branch lifts after the line it forks from.
		const firstOn = (id: number) =>
			versions.find((v) => v.branchId === id)!.id
		expect(firstOn(B.id)).toBeLessThan(firstOn(C.id))
	})
})

describe("greetings", () => {
	test("each half retold alone becomes the member's own list, noted and counted", async () => {
		const u = await user()
		const b = await book(u.id)
		const shape3 = {
			firstMessage: "Card hello.",
			alternateGreetings: ["Card alt 1.", "Card alt 2."],
			groupOnlyGreetings: ["Card group."]
		}
		const opener = await member(
			b.id,
			(await card(u.id, "Opener", shape3)).id,
			{
				retold: { firstMessage: true },
				firstMessage: "Own hello."
			}
		)
		const alternates = await member(
			b.id,
			(await card(u.id, "Alternates", shape3)).id,
			{
				retold: { alternateGreetings: true },
				alternateGreetings: ["Own alt."]
			}
		)
		const grid = { lines: await linesOf(b.id), moments: [null, Y(5)] }
		await oracleAgreesWithLegacy(opener.id, grid)
		await oracleAgreesWithLegacy(alternates.id, grid)

		const report = await liftTwice()
		expect(report).toMatchObject({ members: 2, versions: 0, noted: 2 })
		expect(await mismatches(opener.id, grid)).toEqual([])
		expect(await mismatches(alternates.id, grid)).toEqual([])
		const base = await baseOf(opener.id)
		expect(base.follows).not.toContain("greetings")
		expect(base.greetings).toEqual([
			{ text: "Own hello." },
			{ text: "Card alt 1." },
			{ text: "Card alt 2." }
		])
		expect((await baseOf(alternates.id)).greetings).toEqual([
			{ text: "Card hello." },
			{ text: "Own alt." }
		])
		for (const m of [opener, alternates]) {
			const note = parseLiftNote((await baseOf(m.id)).note)
			expect(note).toEqual({
				v: 1,
				differences: [],
				mixedGreetings: true
			})
		}
	})

	test("a card with no opener cannot say which of its greetings was the opener: lifted anyway, with the difference noted", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(
			b.id,
			(
				await card(u.id, "No opener", {
					firstMessage: "",
					alternateGreetings: ["x", "y"]
				})
			).id,
			{ retold: { firstMessage: true }, firstMessage: "Own hello." }
		)
		const report = await liftTwice()
		expect(report).toMatchObject({ members: 1, noted: 1 })
		const note = parseLiftNote((await baseOf(m.id)).note)
		expect(note?.mixedGreetings).toBe(true)
		expect(note?.differences).toHaveLength(1)
		expect(note?.differences[0]).toMatchObject({
			branchId: null,
			line: "main",
			at: { kind: "before-first-change" },
			appearance: null
		})
		expect(note?.differences[0].fields).toContain("greetings")
	})
})

describe("seats", () => {
	test("a character seat gets the card owner; an envoy seat, a seat with its card gone and a seated seat are left", async () => {
		const owner = await user()
		const other = await user()
		const c = await card(owner.id, "Held")
		const heldByOther = await card(owner.id, "Held by another")
		const gone = await card(owner.id, "Gone")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: other.id, isGroup: false, name: uniq("Run") })
			.returning()
		const sessionId = session!.id
		const [mine, envoy, departed, seated] = await testDb
			.insert(schema.sessionCharacters)
			.values([
				{ sessionId, characterId: c.id },
				{ sessionId, envoySlug: "mascot" },
				{ sessionId, characterId: gone.id, removedName: "Gone" },
				{
					sessionId,
					characterId: heldByOther.id,
					seatedByUserId: other.id
				}
			])
			.returning()
		await testDb
			.delete(schema.characters)
			.where(eq(schema.characters.id, gone.id))

		const report = await liftTwice()
		expect(report.seats).toBe(1)
		const seats = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId))
			.orderBy(schema.sessionCharacters.id)
		const by = Object.fromEntries(
			seats.map((s) => [s.id, s.seatedByUserId])
		)
		expect(by[mine!.id]).toBe(owner.id)
		expect(by[envoy!.id]).toBeNull()
		expect(by[departed!.id]).toBeNull()
		expect(by[seated!.id]).toBe(other.id)
	})
})

describe("failure", () => {
	test("one book failing rolls back alone and the pass throws at the end naming the count", async () => {
		const u = await user()
		const bad = await book(u.id)
		const good = await book(u.id)
		const c = await card(u.id, "Ada")
		const inBad = await member(bad.id, c.id)
		await amend(inBad, { year: 5 }, { summary: "five" })
		const inGood = await member(good.id, c.id)
		failing.bookId = bad.id
		const errors = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			await expect(lift()).rejects.toThrow(/1 unit\(s\)/)
			expect(
				errors.mock.calls.some((call) =>
					String(call[0]).includes(`book ${bad.id} `)
				)
			).toBe(true)
		} finally {
			errors.mockRestore()
			failing.bookId = -1
		}
		expect(await versionsOf(inBad.id)).toHaveLength(0)
		expect(await versionsOf(inGood.id)).toHaveLength(1)
		// The rest of the pass ran: the card has v1.
		expect((await cardV1(c.id)).number).toBe(1)

		// The next boot lifts what failed.
		const again = await liftTwice()
		expect(again).toMatchObject({ members: 1, versions: 1, failed: 0 })
		expect(await versionsOf(inBad.id)).toHaveLength(2)
	})
})

describe("an attic upgrade, then the pass", () => {
	test("every card has v1, every member a base, every held seat its seater", async () => {
		const { placeFixture, bootFixture, runUpgradeTasks } = await import(
			"$lib/server/attic/testFixture"
		)
		placeFixture("tiny", { meta: "meta.dev.json" })
		const upgraded = await bootFixture()
		await runUpgradeTasks(upgraded)

		const report = await liftCharacterVersions(upgraded)
		expect(report.failed).toBe(0)
		expect(report.cards).toBeGreaterThan(0)
		expect(report.members).toBeGreaterThan(0)
		const count = async (query: string) =>
			Number(
				rawRows<{ n: unknown }>(
					await upgraded.execute(sql.raw(query))
				)[0].n
			)
		expect(
			await count(
				`select count(*) as n from characters c where not exists (select 1 from character_versions v where v.card_id = c.id)`
			)
		).toBe(0)
		expect(
			await count(
				`select count(*) as n from lorebook_bindings b where b.overlay_of is null and not exists (select 1 from character_versions v where v.cast_member_id = b.id)`
			)
		).toBe(0)
		expect(
			await count(
				`select count(*) as n from session_characters sc join characters c on c.id = sc.character_id where sc.seated_by_user_id is null`
			)
		).toBe(0)
		expect(report.cards).toBe(
			await count(`select count(*) as n from characters`)
		)
		expect(await liftCharacterVersions(upgraded)).toEqual(ZEROS)
	}, 300_000)
})

afterAll(() => {
	failing.bookId = -1
})
