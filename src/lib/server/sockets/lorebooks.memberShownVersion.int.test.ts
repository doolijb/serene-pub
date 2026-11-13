/**
 * 🚧 The member page shows and saves "the most recently active" version (owner
 * 2026-11-06): the cast version in force at the book's present on main. Every
 * member row carries it, Save writes it, the Changes rows carry each version
 * whole, `laterVersions` reaches the client on the emit, and a member keeps its
 * group-only greetings — over a real database.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCard,
	insertCastMember,
	newCardVersion,
	writeCastVersion
} from "$lib/server/characters/versions"
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
		path.join(os.tmpdir(), "serene-pub-vitest-member-shown-version-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const V = schema.characterVersions
let n = 0

type Emitted = { event: string; data: any }

/** An `emitToUser` that records what it is given, running a lazy payload. */
function capture() {
	const emitted: Emitted[] = []
	const emit = async (event: string, data: unknown) => {
		emitted.push({
			event,
			data: typeof data === "function" ? await data() : data
		})
	}
	return { emitted, emit }
}

async function world(
	opts: { carded?: boolean; clockYear?: number | null } = {}
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `shown-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			name: `Book ${n}`,
			userId: user.id,
			...(opts.clockYear != null
				? { storyClockYear: opts.clockYear }
				: {})
		})
		.returning()
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Verity ${n}`,
		description: "The card's description.",
		firstMessage: "The card says hello."
	})
	const carded = opts.carded === true
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${n}}}`,
		characterId: carded ? card.id : null,
		name: `Maren ${n}`,
		description: carded ? null : "Her own description.",
		firstMessage: carded ? null : "Her own hello."
	})
	const dated = (
		year: number,
		changes: Record<string, unknown>,
		by = `user:${user.id}`
	) =>
		writeCastVersion(db(), {
			member: member.id,
			changes: changes as any,
			writtenBy: by,
			at: {
				branchId: null,
				date: { year, month: null, day: null },
				personalPosition: null
			}
		})
	const update = async (
		fields: Record<string, unknown>,
		extra: Record<string, unknown> = {}
	) => {
		const { updateLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const cap = capture()
		const res = (await updateLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{ lorebookBinding: { id: member.id, ...fields }, ...extra } as any,
			cap.emit as any
		)) as Sockets.Lorebooks.UpdateBinding.Response
		return { res, ...cap }
	}
	return { user, book: book!, card, member, base: base!, dated, update }
}
type World = Awaited<ReturnType<typeof world>>

async function listed(w: World) {
	const { buildLorebookBindingList } = await import(
		"$lib/server/sockets/lorebooks"
	)
	const res = await buildLorebookBindingList(w.user.id, w.book.id)
	return {
		present: res.present,
		row: res.lorebookBindingList.find((m) => m.id === w.member.id)!
	}
}

async function changes(w: World) {
	const { buildAmendmentsList } = await import(
		"$lib/server/sockets/amendments"
	)
	return (await buildAmendmentsList(w.user.id, w.book.id)).cast
}

async function versionsOf(w: World) {
	return testDb.select().from(V).where(eq(V.castMemberId, w.member.id))
}

describe("the row is the version at the book's present", () => {
	test("link a card at a present: the carrier is shown, earlier Changes rows stay card-less", async () => {
		const w = await world({ clockYear: 20 })
		await w.dated(10, { description: "Her words at Y10." })
		const { res } = await w.update({ characterId: w.card.id })

		const { present, row } = await listed(w)
		expect(present).toEqual({ year: 20, month: null, day: null })
		const carrier = (await versionsOf(w)).find((v) => v.year === 20)!
		expect(carrier).toBeTruthy()
		expect(carrier.parentVersionId).not.toBeNull()
		expect(row.castVersionId).toBe(carrier.id)
		expect(row.characterId).toBe(w.card.id)
		expect(row.character?.id).toBe(w.card.id)
		// Retold flags are the carrier's follows.
		const { memberColumnsOfVersion } = await import(
			"$lib/server/lorebooks/retold"
		)
		expect(row.retold).toEqual(
			memberColumnsOfVersion(carrier, { carded: true }).retold
		)
		expect(row.cardVersion).toMatchObject({ number: 1 })
		expect(row.cardCurrentVersion?.number).toBe(1)
		expect(row.behindCard).toBe(false)
		expect(res.lorebookBinding.castVersionId).toBe(carrier.id)
		expect(res.lorebookBinding.characterId).toBe(w.card.id)

		const early = (await changes(w)).find((c) => c.year === 10)!
		expect(early.columns.characterId).toBeNull()
		expect(early.columns.description).toBe("Her words at Y10.")
		const atPresent = (await changes(w)).find((c) => c.year === 20)!
		expect(atPresent.columns.characterId).toBe(w.card.id)
	})

	test("unlink at a present: the row is card-less holding the card's words; earlier rows stay carded", async () => {
		const w = await world({ carded: true, clockYear: 20 })
		await w.dated(10, { nodeState: "missing" })
		await w.update({ characterId: null })

		const { row } = await listed(w)
		const carrier = (await versionsOf(w)).find((v) => v.year === 20)!
		expect(row.castVersionId).toBe(carrier.id)
		expect(row.characterId).toBeNull()
		expect(row.cardVersion).toBeNull()
		expect(row.behindCard).toBe(false)
		expect(row.description).toBe("The card's description.")
		expect(row.firstMessage).toBe("The card says hello.")
		expect(row.retold).toEqual({})

		const early = (await changes(w)).find((c) => c.year === 10)!
		expect(early.columns.characterId).toBe(w.card.id)
		const base = await listedBase(w)
		expect(base.characterId).toBe(w.card.id)
	})

	test("no present: the row is main's head pick; a base-only member's Save writes the base", async () => {
		const w = await world()
		const only = await listed(w)
		expect(only.present).toBeNull()
		expect(only.row.castVersionId).toBe(w.base.id)

		await w.update({ description: "Edited base." })
		const [base] = await testDb.select().from(V).where(eq(V.id, w.base.id))
		expect(base.description).toBe("Edited base.")
		expect((await versionsOf(w)).length).toBe(1)

		await w.dated(10, { description: "Dated words." })
		const head = (await listed(w)).row
		const dated = (await versionsOf(w)).find((v) => v.year === 10)!
		expect(head.castVersionId).toBe(dated.id)
		expect(head.description).toBe("Dated words.")
		expect(head.baseColumns?.description).toBe("Edited base.")
	})

	test("a newer card version: behindCard, and bindingsForCharacter says the same", async () => {
		const w = await world({ carded: true })
		await testDb.transaction(async (tx) => {
			const [cur] = await tx
				.select()
				.from(V)
				.where(and(eq(V.cardId, w.card.id), eq(V.number, 1)))
			await newCardVersion(tx as unknown as Db, w.card.id, {
				...profileOf(cur as any),
				description: "A newer card."
			})
		})
		const { row } = await listed(w)
		expect(row.cardVersion?.number).toBe(1)
		expect(row.cardCurrentVersion?.number).toBe(2)
		expect(row.behindCard).toBe(true)

		const { lorebookBindingsForCharacterHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const res = await (lorebookBindingsForCharacterHandler as any).handler(
			fakeSocket(w.user.id),
			{ characterId: w.card.id },
			async () => {}
		)
		const mine = res.members.find((m: any) => m.castId === w.member.id)
		expect(mine.cardVersion.number).toBe(1)
		expect(mine.cardCurrentVersion.number).toBe(2)
		expect(mine.behindCard).toBe(true)
	})
})

async function listedBase(w: World) {
	return (await listed(w)).row.baseColumns!
}

describe("Save writes the shown version", () => {
	test("a change at Y10 with a present at Y20: Y10 takes the words; only later versions count", async () => {
		const w = await world({ clockYear: 20 })
		await w.dated(5, { description: "Y5 words." })
		await w.dated(10, { description: "Y10 words." })
		await w.dated(30, { description: "Y30 words." })
		const { res, emitted } = await w.update({
			description: "Edited at Y10."
		})
		const all = await versionsOf(w)
		expect(all.find((v) => v.year === 10)!.description).toBe(
			"Edited at Y10."
		)
		expect(all.find((v) => v.year == null)!.description).toBe(
			"Her own description."
		)
		expect(all.find((v) => v.year === 5)!.description).toBe("Y5 words.")
		expect(res.laterVersions).toEqual({ changed: 0, kept: 1 })
		expect(res.lorebookBinding.description).toBe("Edited at Y10.")

		const list = emitted.find((e) => e.event === "amendments:list")!
		expect(list.data.lorebookId).toBe(w.book.id)
		expect(
			list.data.cast.find((c: any) => c.year === 10).columns.description
		).toBe("Edited at Y10.")
	})

	test("with changeLaterVersions the version after the shown one takes it", async () => {
		const w = await world({ clockYear: 20 })
		await w.dated(10, { nodeState: "missing" })
		await w.dated(30, { nodeState: "deceased" })
		const { res } = await w.update(
			{ description: "Everywhere." },
			{ changeLaterVersions: true }
		)
		expect(res.laterVersions).toEqual({ changed: 1, kept: 0 })
		const all = await versionsOf(w)
		expect(all.find((v) => v.year === 30)!.description).toBe("Everywhere.")
		expect(all.find((v) => v.year === 30)!.nodeState).toBe("deceased")
	})
})

describe("laterVersions is on the emit (B4)", () => {
	test("a cast amendment create with changeLaterVersions carries laterVersions on amendments:list", async () => {
		const w = await world()
		await w.dated(30, { nodeState: "deceased" })
		const { amendmentsCreateHandler } = await import(
			"$lib/server/sockets/amendments"
		)
		const emitted: Emitted[] = []
		const res = (await amendmentsCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				lorebookId: w.book.id,
				castId: w.member.id,
				year: 10,
				fields: { description: "From Y10." },
				changeLaterVersions: true
			} as any,
			((event: string, data: unknown) => {
				emitted.push({ event, data })
			}) as any
		)) as any
		expect(res.laterVersions).toEqual({ changed: 1, kept: 0 })
		const list = emitted.find((e) => e.event === "amendments:list")!
		expect(list.data.laterVersions).toEqual({ changed: 1, kept: 0 })
		expect(list.data.lorebookId).toBe(w.book.id)
	})
})

describe("group-only greetings (B5)", () => {
	test("kept on the version and the row, and a later edit of the opener keeps them", async () => {
		const w = await world()
		const first = await w.update({
			groupOnlyGreetings: ["Everyone, gather round."]
		})
		expect(first.res.lorebookBinding.groupOnlyGreetings).toEqual([
			"Everyone, gather round."
		])
		const stored = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, w.member.id))
		expect(stored[0]).not.toHaveProperty("groupOnlyGreetings")
		const [base] = await testDb.select().from(V).where(eq(V.id, w.base.id))
		expect((base.greetings as any[]).filter((g) => g.groupOnly)).toEqual([
			{ text: "Everyone, gather round.", groupOnly: true }
		])

		const second = await w.update({ firstMessage: "A new hello." })
		expect(second.res.lorebookBinding.firstMessage).toBe("A new hello.")
		expect(second.res.lorebookBinding.groupOnlyGreetings).toEqual([
			"Everyone, gather round."
		])
		const { row } = await listed(w)
		expect(row.groupOnlyGreetings).toEqual(["Everyone, gather round."])
		expect(row.baseColumns?.groupOnlyGreetings).toEqual([
			"Everyone, gather round."
		])
	})

	test("a list that is not text is refused", async () => {
		const w = await world()
		await expect(
			w.update({ groupOnlyGreetings: [1] as any })
		).rejects.toThrow()
	})
})
