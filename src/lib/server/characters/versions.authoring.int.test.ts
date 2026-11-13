/**
 * 🚧 The author's cast-version functions against a real database: edit one
 * (`updateCastVersion`), remove one (`deleteCastVersion`), re-parent a
 * member's versions onto another card (`reparentCastVersions`), re-point the
 * history entry a fork copied (`repointVersionHistory`), and the label of an
 * in-place card save.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	deleteCastVersion,
	insertCard,
	insertCastMember,
	newCardVersion,
	repointVersionHistory,
	reparentCastVersions,
	reparentFromBookPresent,
	resolveFollows,
	restoreVersions,
	retireOrTakeVersions,
	updateCardVersion,
	updateCastVersion,
	writeCastVersion,
	type CastVersionChanges
} from "./versions"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { profileOf } from "$lib/shared/characters/profile"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-versions-authoring-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
const db = () => testDb as unknown as Db
const tx = <T>(fn: (t: Db) => Promise<T>) =>
	testDb.transaction((t) => fn(t as unknown as Db))

async function world(o: { card?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `va-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` })
		.returning()
	const [fork] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 })
		.returning()
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Card ${suffix}`,
		description: "The card's description.",
		personality: "Card personality."
	})
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: o.card === false ? null : card.id,
		name: `Ada ${suffix}`,
		description: o.card === false ? "Her own description." : null
	})
	return { user, book: book!, fork: fork!, card, member, base: base!, suffix }
}
type World = Awaited<ReturnType<typeof world>>

const author = (
	w: World,
	changes: CastVersionChanges,
	at: NonNullable<Parameters<typeof writeCastVersion>[1]["at"]>
) =>
	tx((t) =>
		writeCastVersion(t, {
			member: w.member.id,
			changes,
			writtenBy: "user:1",
			note: "by hand",
			at
		})
	).then((r) => r.version)

const main = (year: number, month?: number) => ({
	branchId: null,
	date: { year, month },
	personalPosition: null
})

const versionsOf = (memberId: number) =>
	testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))
		.orderBy(schema.characterVersions.id)

const rowOf = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, id))
	)[0]

/** A session of the book, a message of it, and a session-written cast version. */
async function sessionWrite(w: World, changes: CastVersionChanges) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: w.user.id,
			isGroup: false,
			name: `Run ${++n}`,
			genreId: "test:genre/versions-authoring",
			lorebookId: w.book.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 1
		})
		.returning()
	const [msg] = await testDb
		.insert(schema.messages)
		.values({
			sessionId: session!.id,
			role: "assistant",
			content: "…"
		} as any)
		.returning({ id: schema.messages.id })
	const { genreKeeping } = await import("$lib/server/utils/testGenre")
	genreKeeping("test:genre/versions-authoring", {
		name: { en: "Versions authoring" },
		family: "test",
		slots: [],
		events: {}
	})
	const out = await tx((t) =>
		writeCastVersion(t, {
			member: w.member.id,
			changes,
			writtenBy: `run:${session!.id}`,
			session: { id: session!.id }
		})
	)
	return { session: session!, messageId: msg!.id, version: out.version }
}

/** A branch session that reads `version` through its session cut. */
async function branchReading(
	w: World,
	parent: number,
	version: any,
	msg: number
) {
	const [branch] = await testDb
		.insert(schema.sessions)
		.values({
			userId: w.user.id,
			isGroup: false,
			name: `Branch ${++n}`,
			genreId: "test:genre/versions-authoring",
			lorebookId: w.book.id,
			branchAncestry: [{ sessionId: parent, mark: version.writeOrder }],
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 1
		})
		.returning()
	await testDb.insert(schema.sessionMessages).values({
		sessionId: branch!.id,
		role: "assistant",
		content: "copied",
		originSessionId: parent,
		originMessageId: msg
	} as any)
	return branch!
}

describe("updateCastVersion", () => {
	test("edits an authored version's fields in place", async () => {
		const w = await world()
		const v = await author(w, { personality: "Wry." }, main(5))
		const out = await tx((t) =>
			updateCastVersion(t, v.id, {
				changes: { summary: "A mathematician.", description: "Own." }
			})
		)
		expect(out.id).toBe(v.id)
		expect(out).toMatchObject({
			summary: "A mathematician.",
			description: "Own.",
			personality: "Wry."
		})
		expect(out.follows).not.toContain("description")
		expect(await versionsOf(w.member.id)).toHaveLength(2)
	})

	test("moves it to another date and to a life point and a line", async () => {
		const w = await world()
		const v = await author(w, { personality: "Wry." }, main(5))
		const moved = await tx((t) =>
			updateCastVersion(t, v.id, {
				place: {
					branchId: null,
					date: { year: 7, month: 2 },
					personalPosition: 3
				}
			})
		)
		expect(moved).toMatchObject({
			id: v.id,
			year: 7,
			month: 2,
			day: null,
			personalPosition: 3,
			branchId: null
		})
		const onLine = await tx((t) =>
			updateCastVersion(t, v.id, {
				place: {
					branchId: w.fork.id,
					date: { year: 3 },
					personalPosition: null
				}
			})
		)
		expect(onLine).toMatchObject({ branchId: w.fork.id, year: 3 })
	})

	test("refuses the base move, an undated line place, a key clash, nothing to change", async () => {
		const w = await world()
		await expect(
			tx((t) => updateCastVersion(t, w.base.id, { place: main(5) }))
		).rejects.toThrow(/cannot be moved/)
		const v = await author(w, { personality: "Wry." }, main(5))
		await expect(
			tx((t) =>
				updateCastVersion(t, v.id, {
					place: {
						branchId: w.fork.id,
						date: null,
						personalPosition: null
					}
				})
			)
		).rejects.toThrow(/undated cast version can only be on main/)
		const other = await author(w, { personality: "Dry." }, main(6))
		await expect(
			tx((t) => updateCastVersion(t, other.id, { place: main(5) }))
		).rejects.toThrow(/already has a change of their own/)
		await expect(
			tx((t) => updateCastVersion(t, v.id, { place: main(5) }))
		).rejects.toThrow(/nothing to change/)
		await expect(
			tx((t) => updateCastVersion(t, v.id, { changes: {} }))
		).rejects.toThrow(/nothing to change/)
		await expect(
			tx((t) => updateCastVersion(t, 999_999, { changes: { name: "x" } }))
		).rejects.toThrow(/does not exist/)
		await expect(
			tx((t) =>
				updateCastVersion(t, w.base.parentVersionId!, {
					changes: { name: "x" }
				})
			)
		).rejects.toThrow(/card version/)
	})

	test("a session-written version no branch reads is edited in place and Back still takes it", async () => {
		const w = await world()
		const s = await sessionWrite(w, { summary: "Session wrote." })
		const out = await tx((t) =>
			updateCastVersion(t, s.version.id, {
				changes: { summary: "Author fixed." }
			})
		)
		expect(out.id).toBe(s.version.id)
		expect(out).toMatchObject({
			summary: "Author fixed.",
			sourceSessionId: s.session.id,
			sourceMessageId: s.version.sourceMessageId
		})
		const res = await tx((t) => retireOrTakeVersions(t, [out]))
		expect(res.taken.map((r) => r.id)).toEqual([s.version.id])
	})

	test("one a branch reads is retired and the edited copy inserted", async () => {
		const w = await world()
		const s = await sessionWrite(w, { summary: "Before." })
		const branch = await branchReading(
			w,
			s.session.id,
			s.version,
			s.version.sourceMessageId!
		)
		void s.messageId
		const out = await tx((t) =>
			updateCastVersion(t, s.version.id, {
				changes: { summary: "After." }
			})
		)
		expect(out.id).not.toBe(s.version.id)
		expect(out).toMatchObject({
			summary: "After.",
			sourceSessionId: s.session.id,
			sourceMessageId: s.version.sourceMessageId,
			validFromMessageId: s.version.validFromMessageId,
			writtenBy: s.version.writtenBy
		})
		expect(out.writeOrder).toBeGreaterThan(s.version.writeOrder)
		const old = await rowOf(s.version.id)
		expect(old!.retiredOrder).not.toBeNull()
		expect(old!.summary).toBe("Before.")
		const { castVersionsInForce } = await import(
			"$lib/server/cast/memberAsRead"
		)
		const readBy = async (sessionId: number) =>
			(await castVersionsInForce(db(), [w.member.id], { sessionId })).get(
				w.member.id
			)!.version
		expect((await readBy(branch.id)).id).toBe(s.version.id)
		expect((await readBy(s.session.id)).id).toBe(out.id)
	})
})

describe("deleteCastVersion", () => {
	test("deletes an authored version, answering it as it was", async () => {
		const w = await world()
		const v = await author(w, { personality: "Wry." }, main(5))
		const out = await tx((t) => deleteCastVersion(t, v.id))
		expect(out.retired).toEqual([])
		expect(out.taken.map((r) => r.id)).toEqual([v.id])
		expect(await rowOf(v.id)).toBeUndefined()
		await tx((t) => restoreVersions(t, out.taken))
		expect((await rowOf(v.id))!.personality).toBe("Wry.")
	})

	test("refuses the base, a card version, an unknown id", async () => {
		const w = await world()
		await expect(
			tx((t) => deleteCastVersion(t, w.base.id))
		).rejects.toThrow(/cannot be removed/)
		await expect(
			tx((t) => deleteCastVersion(t, w.base.parentVersionId!))
		).rejects.toThrow(/card version/)
		await expect(tx((t) => deleteCastVersion(t, 999_999))).rejects.toThrow(
			/does not exist/
		)
	})

	test("a session-written one is taken, or retired when a branch reads it", async () => {
		const w = await world()
		const s = await sessionWrite(w, { summary: "One." })
		const taken = await tx((t) => deleteCastVersion(t, s.version.id))
		expect(taken.taken).toHaveLength(1)
		expect(await rowOf(s.version.id)).toBeUndefined()

		const w2 = await world()
		const s2 = await sessionWrite(w2, { summary: "Two." })
		await branchReading(
			w2,
			s2.session.id,
			s2.version,
			s2.version.sourceMessageId!
		)
		const kept = await tx((t) => deleteCastVersion(t, s2.version.id))
		expect(kept.retired.map((r) => r.id)).toEqual([s2.version.id])
		expect((await rowOf(s2.version.id))!.retiredOrder).not.toBeNull()
	})
})

describe("reparentCastVersions", () => {
	async function twoCards(w: World) {
		const { card: other } = await insertCard(db(), {
			userId: w.user.id,
			name: "Other",
			description: "Other description.",
			personality: "Other personality."
		})
		return other
	}

	test("links a card-less member: every version onto the card's current version, the given fields follow", async () => {
		const w = await world({ card: false })
		await author(w, { personality: "Later own." }, main(5))
		const n1 = await tx((t) =>
			reparentCastVersions(t, w.member.id, {
				cardId: w.card.id,
				follows: ["description", "extensions"]
			})
		)
		expect(n1).toBe(2)
		const cardV = await tx((t) =>
			newCardVersion(t, w.card.id, {
				...profileOf(w.base as any),
				description: "v2"
			})
		)
		void cardV
		const rows = await versionsOf(w.member.id)
		const current = (
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.cardId, w.card.id))
		).find((r) => r.number === 1)!
		for (const r of rows) {
			expect(r.parentVersionId).toBe(current.id)
			expect(r.follows).toEqual(["description", "extensions"])
			expect(r.description).toBeNull()
		}
		expect(rows[1]!.personality).toBe("Later own.")
	})

	test("a dated change on main: before D unchanged, at and after D re-parented; a branch line's versions are untouched", async () => {
		const w = await world()
		const early = await author(w, { personality: "Early." }, main(3))
		const at = await author(w, { personality: "At." }, main(5))
		const late = await author(w, { personality: "Late." }, main(8))
		const onFork = await author(
			w,
			{ personality: "Fork." },
			{ branchId: w.fork.id, date: { year: 9 }, personalPosition: null }
		)
		const other = await twoCards(w)
		const changed = await tx((t) =>
			reparentCastVersions(t, w.member.id, {
				cardId: other.id,
				from: { branchId: null, date: { year: 5 } }
			})
		)
		const otherV = (
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.cardId, other.id))
		)[0]!
		const p = async (id: number) => (await rowOf(id))!.parentVersionId
		expect(await p(w.base.id)).toBe(w.base.parentVersionId)
		expect(await p(early.id)).toBe(early.parentVersionId)
		expect(await p(at.id)).toBe(otherV.id)
		expect(await p(late.id)).toBe(otherV.id)
		// The fork left main at year 4, before D: its own version is untouched.
		expect(await p(onFork.id)).toBe(onFork.parentVersionId)
		expect(changed).toBe(2)
	})

	test("from a point on a branch line leaves main untouched", async () => {
		const w = await world()
		const mainLate = await author(w, { personality: "Main late." }, main(8))
		const f1 = await author(
			w,
			{ personality: "F1." },
			{ branchId: w.fork.id, date: { year: 6 }, personalPosition: null }
		)
		const f2 = await author(
			w,
			{ personality: "F2." },
			{ branchId: w.fork.id, date: { year: 2 }, personalPosition: null }
		)
		const other = await twoCards(w)
		const changed = await tx((t) =>
			reparentCastVersions(t, w.member.id, {
				cardId: other.id,
				from: { branchId: w.fork.id, date: { year: 5 } }
			})
		)
		expect(changed).toBe(1)
		expect((await rowOf(mainLate.id))!.parentVersionId).toBe(
			mainLate.parentVersionId
		)
		expect((await rowOf(f2.id))!.parentVersionId).toBe(f2.parentVersionId)
		expect((await rowOf(f1.id))!.parentVersionId).not.toBe(
			f1.parentVersionId
		)
	})

	test("a swap with follows absent keeps each version's follows; a field that stops following keeps the old card's words", async () => {
		const w = await world()
		const v = await author(w, { personality: "Wry." }, main(5))
		const other = await twoCards(w)
		await tx((t) =>
			reparentCastVersions(t, w.member.id, { cardId: other.id })
		)
		const after = await rowOf(v.id)
		expect(after!.follows).toEqual(v.follows)
		expect(after!.parentVersionId).not.toBe(v.parentVersionId)

		// Description follows the card; now it stops following: it keeps the
		// words of the card it was following (the Other card's).
		const stop = await tx((t) =>
			reparentCastVersions(t, w.member.id, {
				cardId: other.id,
				follows: ["name"]
			})
		)
		expect(stop).toBe(2)
		const again = await rowOf(v.id)
		expect(again!.follows).toEqual(["name"])
		expect(again!.description).toBe("Other description.")
		expect(again!.name).toBeNull()
		// A second run changes nothing.
		expect(
			await tx((t) =>
				reparentCastVersions(t, w.member.id, {
					cardId: other.id,
					follows: ["name"]
				})
			)
		).toBe(0)
	})

	test("keepCardWords: unlinking from a date keeps the old card's words; without it a card-less reference's words come back", async () => {
		const run = async (keepCardWords: boolean) => {
			const w = await world({ card: false })
			const at = await author(w, { personality: "At." }, main(5))
			await tx((t) =>
				reparentCastVersions(t, w.member.id, {
					cardId: w.card.id,
					follows: ["description"],
					from: { branchId: null, date: { year: 5 } }
				})
			)
			expect((await rowOf(at.id))!.follows).toEqual(["description"])
			await tx((t) =>
				reparentCastVersions(t, w.member.id, {
					cardId: null,
					from: { branchId: null, date: { year: 5 } },
					keepCardWords: keepCardWords || undefined
				})
			)
			const moved = (await rowOf(at.id))!
			expect(moved.parentVersionId).toBeNull()
			expect(moved.follows).toEqual([])
			return moved.description
		}
		expect(await run(true)).toBe("The card's description.")
		expect(await run(false)).toBe("Her own description.")
	})

	test("cardId null equals resolveFollows detach", async () => {
		const a = await world()
		const b = await world()
		for (const w of [a, b])
			await author(w, { personality: "Wry." }, main(5))
		await tx((t) => reparentCastVersions(t, a.member.id, { cardId: null }))
		await tx((t) =>
			resolveFollows(t, { castMemberId: b.member.id }, { detach: true })
		)
		const strip = (rows: Awaited<ReturnType<typeof versionsOf>>) =>
			rows.map((r) => ({
				...profileOf(r),
				follows: r.follows,
				parent: r.parentVersionId
			}))
		const ra = strip(await versionsOf(a.member.id))
		const rb = strip(await versionsOf(b.member.id))
		expect(ra).toHaveLength(rb.length)
		for (let i = 0; i < ra.length; i++) {
			expect(ra[i]!.follows).toEqual([])
			expect(ra[i]!.parent).toBeNull()
			expect({ ...ra[i], name: "", parent: 0 }).toEqual({
				...rb[i],
				name: "",
				parent: 0
			})
			expect(ra[i]!.description).toBe("The card's description.")
		}
	})

	test("refuses an unknown card, and follows with no card", async () => {
		const w = await world()
		await expect(
			tx((t) => reparentCastVersions(t, w.member.id, { cardId: 999_999 }))
		).rejects.toThrow(/does not exist/)
		await expect(
			tx((t) =>
				reparentCastVersions(t, w.member.id, {
					cardId: null,
					follows: ["name"]
				})
			)
		).rejects.toThrow(/no card to read/)
	})

	const cardVersionsOf = async (cardId: number) =>
		(
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.cardId, cardId))
		).sort((a, b) => a.number! - b.number!)

	test("a later version's own description survives a link", async () => {
		const w = await world({ card: false })
		const later = await author(
			w,
			{ description: "Her own at five." },
			main(5)
		)
		await tx((t) =>
			reparentCastVersions(t, w.member.id, {
				cardId: w.card.id,
				follows: ["description", "personality"]
			})
		)
		const base = await rowOf(w.base.id)
		expect(base!.follows).toEqual(["description", "personality"])
		const five = await rowOf(later.id)
		expect(five!.follows).toEqual(["personality"])
		expect(five!.description).toBe("Her own at five.")
	})

	test("the same through from: each later version keeps its own words", async () => {
		const w = await world({ card: false })
		const v3 = await author(w, { description: "At three." }, main(3))
		const v5 = await author(w, { summary: "Five." }, main(5))
		const v8 = await author(w, { description: "At eight." }, main(8))
		await tx((t) =>
			reparentCastVersions(t, w.member.id, {
				cardId: w.card.id,
				follows: ["description"],
				from: { branchId: null, date: { year: 5 } }
			})
		)
		for (const v of [w.base, v3])
			expect((await rowOf(v.id))!.parentVersionId).toBeNull()
		expect((await rowOf(v3.id))!.description).toBe("At three.")
		const five = await rowOf(v5.id)
		expect(five!.parentVersionId).not.toBeNull()
		expect(five!.follows).toEqual(["description"])
		const eight = await rowOf(v8.id)
		expect(eight!.follows).toEqual([])
		expect(eight!.description).toBe("At eight.")
		expect(eight!.parentVersionId).toBe(five!.parentVersionId)
	})

	test("the retire step: a row a branch reads is retired and the re-parented copy inserted; a retired row is never touched", async () => {
		const w = await world()
		const s = await sessionWrite(w, { summary: "Before." })
		await branchReading(
			w,
			s.session.id,
			s.version,
			s.version.sourceMessageId!
		)
		const other = await twoCards(w)
		const changed = await tx((t) =>
			reparentCastVersions(t, w.member.id, {
				cardId: other.id,
				from: { branchId: null, date: { year: 5 } }
			})
		)
		const old = await rowOf(s.version.id)
		expect(old!.retiredOrder).not.toBeNull()
		expect(old!.parentVersionId).toBe(s.version.parentVersionId)
		const copies = (await versionsOf(w.member.id)).filter(
			(r) => r.sourceSessionId === s.session.id && r.id !== s.version.id
		)
		expect(copies).toHaveLength(1)
		const otherV = (await cardVersionsOf(other.id))[0]!
		expect(copies[0]).toMatchObject({
			parentVersionId: otherV.id,
			year: s.version.year,
			historyEntryId: s.version.historyEntryId,
			summary: "Before."
		})
		expect(changed).toBe(1)
		const third = await twoCards(w)
		expect(
			await tx((t) =>
				reparentCastVersions(t, w.member.id, {
					cardId: third.id,
					from: { branchId: null, date: { year: 5 } }
				})
			)
		).toBe(1)
		const oldAgain = await rowOf(s.version.id)
		expect(oldAgain).toEqual(old)
	})

	test("onCard, until and cardVersionId: an undo lands on the exact card version and spares the later change", async () => {
		for (const bumped of [false, true]) {
			const w = await world()
			const v10 = await author(w, { personality: "Ten." }, main(10))
			const v20 = await author(w, { personality: "Twenty." }, main(20))
			const other = await twoCards(w)
			await tx((t) =>
				reparentCastVersions(t, w.member.id, {
					cardId: other.id,
					from: { branchId: null, date: { year: 10 } }
				})
			)
			const [a1] = await cardVersionsOf(w.card.id)
			if (bumped)
				await tx((t) =>
					newCardVersion(t, w.card.id, {
						...profileOf(w.base as any),
						description: "v2"
					})
				)
			const [b1] = await cardVersionsOf(other.id)
			expect(
				await tx((t) =>
					reparentCastVersions(t, w.member.id, {
						cardId: w.card.id,
						cardVersionId: a1!.id,
						from: { branchId: null, date: { year: 10 } },
						onCard: other.id,
						until: { year: 20 }
					})
				)
			).toBe(1)
			expect((await rowOf(v10.id))!.parentVersionId).toBe(a1!.id)
			expect((await rowOf(v20.id))!.parentVersionId).toBe(b1!.id)
			if (bumped)
				expect(
					(await cardVersionsOf(w.card.id)).length
				).toBeGreaterThan(1)
		}
		const w = await world()
		const other = await twoCards(w)
		await tx((t) =>
			reparentCastVersions(t, w.member.id, { cardId: other.id })
		)
		const [otherV] = await cardVersionsOf(other.id)
		await expect(
			tx((t) =>
				reparentCastVersions(t, w.member.id, {
					cardId: w.card.id,
					cardVersionId: otherV!.id
				})
			)
		).rejects.toThrow(/is not a version of card/)
		await expect(
			tx((t) =>
				reparentCastVersions(t, w.member.id, {
					cardId: null,
					cardVersionId: otherV!.id
				})
			)
		).rejects.toThrow(/cannot be used to make/)
	})

	test("going card-less restores the reference's words", async () => {
		const w = await world({ card: false })
		const v30 = await author(w, { summary: "Thirty." }, main(30))
		await tx((t) =>
			reparentCastVersions(t, w.member.id, {
				cardId: w.card.id,
				follows: ["description"],
				from: { branchId: null, date: { year: 20 } }
			})
		)
		const linked = await rowOf(v30.id)
		expect(linked!.follows).toEqual(["description"])
		expect(linked!.description).toBeNull()
		await tx((t) =>
			reparentCastVersions(t, w.member.id, {
				cardId: null,
				from: { branchId: null, date: { year: 20 } },
				onCard: w.card.id
			})
		)
		const back = await rowOf(v30.id)
		expect(back!.parentVersionId).toBeNull()
		expect(back!.follows).toEqual([])
		expect(back!.description).toBe("Her own description.")
	})
})

describe("reparentFromBookPresent", () => {
	const run = (w: World, follows?: ("description" | "personality")[]) =>
		tx((t) =>
			reparentFromBookPresent(t, w.member.id, {
				cardId: w.card.id,
				follows,
				writtenBy: "user:1"
			})
		)

	test("no clock and no dated history entry: every version, present null", async () => {
		const w = await world({ card: false })
		await author(w, { description: "At fifty." }, main(50))
		const out = await run(w, ["description"])
		expect(out).toEqual({ present: null, changed: 2 })
		for (const r of await versionsOf(w.member.id))
			expect(r.parentVersionId).not.toBeNull()
	})

	test("a clock at year 100: earlier versions keep their words, a carrier at the present follows, later ones keep their own", async () => {
		const w = await world({ card: false })
		const v50 = await author(w, { description: "At fifty." }, main(50))
		const v150 = await author(
			w,
			{ description: "At one-fifty." },
			main(150)
		)
		await testDb
			.update(schema.lorebooks)
			.set({ storyClockYear: 100 })
			.where(eq(schema.lorebooks.id, w.book.id))
		const out = await run(w, ["description"])
		expect(out.present).toMatchObject({ year: 100 })
		expect((await rowOf(w.base.id))!.parentVersionId).toBeNull()
		expect((await rowOf(v50.id))!.parentVersionId).toBeNull()
		const carrier = (await versionsOf(w.member.id)).find(
			(r) => r.year === 100 && r.branchId == null
		)!
		const current = (
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.cardId, w.card.id))
		)[0]!
		expect(carrier.parentVersionId).toBe(current.id)
		expect(carrier.follows).toEqual(["description"])
		const last = await rowOf(v150.id)
		expect(last!.parentVersionId).toBe(current.id)
		expect(last!.description).toBe("At one-fifty.")
		expect(last!.follows).toEqual([])
		expect(out.changed).toBe(2)
	})

	test("no clock, one history entry at year 80: the carrier lands there with that entry", async () => {
		const w = await world({ card: false })
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{
						lorebookId: w.book.id,
						content: "Eighty",
						year: 80,
						branchId: null
					}
				])
			)
			.returning({ id: schema.lorebookEntries.id })
		const out = await run(w, ["description"])
		expect(out.present).toMatchObject({ year: 80 })
		const carrier = (await versionsOf(w.member.id)).find(
			(r) => r.year === 80
		)!
		expect(carrier.historyEntryId).toBe(entry!.id)
		expect(carrier.parentVersionId).not.toBeNull()
	})
})

describe("repointVersionHistory", () => {
	test("moves cast versions dated by the entry on the group's lines; others stay", async () => {
		const w = await world()
		const [fork2] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: w.book.id, name: "Fork two", forkYear: 4 })
			.returning()
		const entry = async () =>
			(
				await testDb
					.insert(schema.lorebookEntries)
					.values(
						historyValues([
							{
								lorebookId: w.book.id,
								content: `E${++n}`,
								year: 3,
								branchId: null
							}
						])
					)
					.returning({ id: schema.lorebookEntries.id })
			)[0]!.id
		const from = await entry()
		const to = await entry()
		const onGroup = await author(
			w,
			{ personality: "A." },
			{
				branchId: w.fork.id,
				date: { year: 6 },
				historyEntryId: from,
				personalPosition: null
			}
		)
		const elsewhere = await author(
			w,
			{ personality: "B." },
			{
				branchId: fork2!.id,
				date: { year: 6 },
				historyEntryId: from,
				personalPosition: null
			}
		)
		const onMain = await author(
			w,
			{ personality: "C." },
			{
				...main(7),
				historyEntryId: from
			}
		)
		const moved = await tx((t) =>
			repointVersionHistory(t, from, to, [w.fork.id])
		)
		expect(moved).toBe(1)
		expect((await rowOf(onGroup.id))!.historyEntryId).toBe(to)
		expect((await rowOf(elsewhere.id))!.historyEntryId).toBe(from)
		expect((await rowOf(onMain.id))!.historyEntryId).toBe(from)
		expect(await tx((t) => repointVersionHistory(t, from, to, []))).toBe(0)
	})
})

describe("updateCardVersion label", () => {
	test("a label alone is a save; with changes it is written too; the card's character_version is not", async () => {
		const w = await world()
		const v1 = (
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.cardId, w.card.id))
		)[0]!
		const [before] = await testDb
			.select({ cv: schema.characters.characterVersion })
			.from(schema.characters)
			.where(eq(schema.characters.id, w.card.id))
		const a = await tx((t) =>
			updateCardVersion(t, v1.id, {}, { label: "Final" })
		)
		expect(a.label).toBe("Final")
		const b = await tx((t) =>
			updateCardVersion(t, v1.id, { summary: "S" }, { label: null })
		)
		expect(b).toMatchObject({ label: null, summary: "S" })
		const c = await tx((t) => updateCardVersion(t, v1.id, { summary: "T" }))
		expect(c.label).toBeNull()
		const [after] = await testDb
			.select({ cv: schema.characters.characterVersion })
			.from(schema.characters)
			.where(eq(schema.characters.id, w.card.id))
		expect(after!.cv).toBe(before!.cv)
	})
})
