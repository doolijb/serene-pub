/**
 * 🚧 A member's words live on its character versions: the member page
 * (`lorebooks:updateBinding`) writes the member's **base** version, the
 * member's inserts make a base, and the lists project the base back into the
 * form's column names — over a real database.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCastMember,
	insertCharacterVersions,
	writeCastVersion
} from "$lib/server/characters/versions"
import { memberAsRead } from "$lib/server/cast/memberAsRead"
import {
	CHARACTER_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"

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
		path.join(os.tmpdir(), "serene-pub-vitest-cast-versions-member-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
let n = 0
let tag = 1

async function world(opts: { carded?: boolean } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { syncLorebookBindingsForCharacter } = await import(
		"$lib/server/utils/characterBindingSync"
	)
	const user = await createTestUser(testDb, `cast-versions-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${n}`, userId: user.id })
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: "Verity Hale",
			nickname: "Vee",
			description: "The card's description.",
			firstMessage: "The card says hello.",
			alternateGreetings: ["The card's other hello."]
		} as any)
		.returning()
	const carded = opts.carded !== false
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book.id,
		binding: `{{char:${tag++}}}`,
		characterId: carded ? card.id : null,
		...(carded ? {} : { name: "The innkeeper" })
	})
	if (carded)
		await syncLorebookBindingsForCharacter(card.id, testDb as any, {
			lorebookId: book.id
		})
	const update = async (
		fields: Record<string, unknown>,
		extra: Record<string, unknown> = {}
	) => {
		const { updateLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		return (await updateLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{ lorebookBinding: { id: member.id, ...fields }, ...extra } as any,
			noopEmit
		)) as Sockets.Lorebooks.UpdateBinding.Response & {
			laterVersions: { changed: number; kept: number }
		}
	}
	return { user, book, card, member, base: base!, update }
}

const V = schema.characterVersions

async function baseOf(memberId: number) {
	const [row] = await testDb
		.select()
		.from(V)
		.where(
			and(
				eq(V.castMemberId, memberId),
				isNull(V.cardId),
				isNull(V.branchId),
				isNull(V.year),
				isNull(V.personalPosition),
				isNull(V.sourceSessionId)
			)
		)
	return row
}

async function storedRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, id))
	return row
}

async function listed(userId: number, lorebookId: number, memberId: number) {
	const { buildLorebookBindingList } = await import(
		"$lib/server/sockets/lorebooks"
	)
	const res = await buildLorebookBindingList(userId, lorebookId)
	return res.lorebookBindingList.find((m) => m.id === memberId)!
}

describe("the member page writes the base version", () => {
	test("retelling a field: the base holds it, the read and the list show it, the frozen columns do not move", async () => {
		const w = await world()
		const res = await w.update({
			retold: { description: true },
			description: "Her own"
		})

		const base = await baseOf(w.member.id)
		expect(base.description).toBe("Her own")
		expect(base.follows).not.toContain("description")
		expect(base.follows).toContain("personality")

		const stored = await storedRow(w.member.id)
		expect(stored.description).toBeNull()
		expect(stored.retold).toEqual({})

		const read = await memberAsRead(db(), w.member.id)
		expect(read!.description).toBe("Her own")
		expect(read!.follows).not.toContain("description")

		const row = await listed(w.user.id, w.book.id, w.member.id)
		expect(row.description).toBe("Her own")
		expect(row.retold).toEqual({ description: true })
		expect(res.lorebookBinding.description).toBe("Her own")
		expect(res.lorebookBinding.retold).toEqual({ description: true })
		expect(res.laterVersions).toEqual({ changed: 0, kept: 0 })
	})

	test("turning the field back off follows the card again; the member's words are kept", async () => {
		const w = await world()
		await w.update({
			retold: { description: true },
			description: "Her own"
		})
		const res = await w.update({
			retold: {},
			description: "Her own"
		})

		const base = await baseOf(w.member.id)
		expect(base.follows).toContain("description")
		expect(base.description).toBe("Her own")
		const read = await memberAsRead(db(), w.member.id)
		expect(read!.description).toBe("The card's description.")
		expect(res.lorebookBinding.retold).toEqual({})
		expect(res.lorebookBinding.description).toBe("Her own")
	})

	test("a save that touches nothing writes no version", async () => {
		const w = await world()
		const count = async () =>
			(
				await testDb
					.select({ id: V.id })
					.from(V)
					.where(eq(V.castMemberId, w.member.id))
			).length
		const before = await count()
		const first = await listed(w.user.id, w.book.id, w.member.id)
		const res = await w.update({
			retold: first.retold,
			description: first.description,
			ownName: first.ownName,
			ownNickname: first.ownNickname,
			faceMediaId: first.faceMediaId,
			aliases: first.aliases
		})
		expect(await count()).toBe(before)
		expect(res.laterVersions).toEqual({ changed: 0, kept: 0 })
	})

	test("an own name is the base's name and the binding's name is synced; clearing it follows the card", async () => {
		const w = await world()
		const res = await w.update({ ownName: "Maren", ownNickname: "" })
		const base = await baseOf(w.member.id)
		expect(base.name).toBe("Maren")
		expect(base.follows).not.toContain("name")
		expect(base.follows).not.toContain("nickname")
		expect(base.nickname).toBeNull()
		expect(res.lorebookBinding.name).toBe("Maren")
		expect(res.lorebookBinding.ownName).toBe("Maren")
		expect(res.lorebookBinding.ownNickname).toBe("")
		expect((await storedRow(w.member.id)).ownName).toBeNull()
		expect((await memberAsRead(db(), w.member.id))!.shownName).toBe("Maren")

		const back = await w.update({ ownName: null, ownNickname: null })
		expect((await baseOf(w.member.id)).follows).toEqual(
			expect.arrayContaining(["name", "nickname"])
		)
		expect(back.lorebookBinding.name).toBe("Vee")
		expect(back.lorebookBinding.ownName).toBeNull()
	})

	test("unlinking makes every followed field the member's own: the read keeps the card's words", async () => {
		const w = await world()
		const res = await w.update({ characterId: null })
		const base = await baseOf(w.member.id)
		expect(base.follows).toEqual([])
		expect(base.parentVersionId).toBeNull()
		expect(base.description).toBe("The card's description.")
		expect((await storedRow(w.member.id)).characterId).toBeNull()
		expect(res.lorebookBinding.characterId).toBeNull()

		const read = await memberAsRead(db(), w.member.id)
		expect(read!.description).toBe("The card's description.")
		expect(read!.cardless).toBe(true)
		expect(read!.greetings.map((g) => g.text)).toEqual([
			"The card says hello.",
			"The card's other hello."
		])
	})

	test("linking a card-less member re-parents every version onto the card's current card version", async () => {
		const w = await world({ carded: false })
		expect((await baseOf(w.member.id)).parentVersionId).toBeNull()
		await writeCastVersion(db(), {
			member: w.member.id,
			changes: { nodeState: "missing" },
			writtenBy: `user:${w.user.id}`,
			at: {
				branchId: null,
				date: { year: 200, month: 3, day: 4 },
				personalPosition: null
			}
		})
		const res = await w.update({ characterId: w.card.id })
		expect((await storedRow(w.member.id)).characterId).toBe(w.card.id)
		expect(res.lorebookBinding.characterId).toBe(w.card.id)
		const { ensureCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const v1 = (await ensureCardVersion(db(), w.card.id))!
		const base = await baseOf(w.member.id)
		expect(base.parentVersionId).toBe(v1.id)
		expect(base.follows).toContain("description")
		expect(base.follows).toContain("greetings")
		const [later] = await testDb
			.select()
			.from(V)
			.where(and(eq(V.castMemberId, w.member.id), eq(V.year, 200)))
		expect(later.parentVersionId).toBe(v1.id)
		expect(later.follows).toContain("description")
		expect(later.nodeState).toBe("missing")
		const read = await memberAsRead(db(), w.member.id)
		expect(read!.cardless).toBe(false)
		expect(read!.activeCardId).toBe(w.card.id)
		expect(read!.description).toBe("The card's description.")
	})

	const dated = (year: number) => ({
		branchId: null,
		date: { year, month: null, day: null },
		personalPosition: null
	})

	test("a member-page link at the book's present leaves an earlier dated version alone; a later version keeps its own words", async () => {
		const w = await world({ carded: false })
		await testDb
			.update(schema.lorebooks)
			.set({ storyClockYear: 100 })
			.where(eq(schema.lorebooks.id, w.book.id))
		const at = async (year: number, description: string) =>
			(
				await writeCastVersion(db(), {
					member: w.member.id,
					changes: { description },
					writtenBy: `user:${w.user.id}`,
					at: dated(year)
				})
			).version
		const fifty = await at(50, "At fifty.")
		const late = await at(150, "At one-fifty.")
		await w.update({ characterId: w.card.id })

		const { ensureCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const v1 = (await ensureCardVersion(db(), w.card.id))!
		expect((await baseOf(w.member.id)).parentVersionId).toBeNull()
		const [fiftyNow] = await testDb
			.select()
			.from(V)
			.where(eq(V.id, fifty!.id))
		expect(fiftyNow.parentVersionId).toBeNull()
		expect(fiftyNow.description).toBe("At fifty.")
		const [carrier] = await testDb
			.select()
			.from(V)
			.where(and(eq(V.castMemberId, w.member.id), eq(V.year, 100)))
		expect(carrier.parentVersionId).toBe(v1.id)
		expect(carrier.follows).toContain("description")
		const [lateNow] = await testDb
			.select()
			.from(V)
			.where(eq(V.id, late!.id))
		expect(lateNow.parentVersionId).toBe(v1.id)
		expect(lateNow.description).toBe("At one-fifty.")
		expect(lateNow.follows).not.toContain("description")
		expect((await storedRow(w.member.id)).characterId).toBe(w.card.id)
	})

	test("an unlink at the book's present: earlier versions stay on the card; the present and later ones become card-less keeping the card's words", async () => {
		const w = await world()
		await testDb
			.update(schema.lorebooks)
			.set({ storyClockYear: 100 })
			.where(eq(schema.lorebooks.id, w.book.id))
		const at = async (year: number, changes: Record<string, string>) =>
			(
				await writeCastVersion(db(), {
					member: w.member.id,
					changes,
					writtenBy: `user:${w.user.id}`,
					at: dated(year)
				})
			).version
		const fifty = await at(50, { nodeState: "active" } as any)
		const late = await at(150, { summary: "At one-fifty." })
		const { ensureCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const v1 = (await ensureCardVersion(db(), w.card.id))!
		const res = await w.update({ characterId: null })

		expect((await baseOf(w.member.id)).parentVersionId).toBe(v1.id)
		const [fiftyNow] = await testDb
			.select()
			.from(V)
			.where(eq(V.id, fifty!.id))
		expect(fiftyNow.parentVersionId).toBe(v1.id)
		const [carrier] = await testDb
			.select()
			.from(V)
			.where(and(eq(V.castMemberId, w.member.id), eq(V.year, 100)))
		expect(carrier.parentVersionId).toBeNull()
		expect(carrier.follows).toEqual([])
		expect(carrier.description).toBe("The card's description.")
		const [lateNow] = await testDb
			.select()
			.from(V)
			.where(eq(V.id, late!.id))
		expect(lateNow.parentVersionId).toBeNull()
		expect(lateNow.summary).toBe("At one-fifty.")
		expect(lateNow.description).toBe("The card's description.")
		expect((await storedRow(w.member.id)).characterId).toBeNull()
		expect(res.lorebookBinding.characterId).toBeNull()

		const read = await memberAsRead(db(), w.member.id)
		expect(read!.cardless).toBe(true)
		expect(read!.description).toBe("The card's description.")
	})

	test("a link then an unlink at the same present keeps the card's words", async () => {
		const w = await world({ carded: false })
		await testDb
			.update(schema.lorebooks)
			.set({ storyClockYear: 100 })
			.where(eq(schema.lorebooks.id, w.book.id))
		await w.update({ description: "The innkeeper's words." })
		await w.update({ characterId: w.card.id })
		await w.update({ characterId: null })

		const [carrier] = await testDb
			.select()
			.from(V)
			.where(and(eq(V.castMemberId, w.member.id), eq(V.year, 100)))
		expect(carrier.parentVersionId).toBeNull()
		expect(carrier.description).toBe("The card's description.")
	})

	test("a swap at the book's present", async () => {
		const w = await world()
		await testDb
			.update(schema.lorebooks)
			.set({ storyClockYear: 100 })
			.where(eq(schema.lorebooks.id, w.book.id))
		const { version: fifty } = await writeCastVersion(db(), {
			member: w.member.id,
			changes: { summary: "At fifty." },
			writtenBy: `user:${w.user.id}`,
			at: dated(50)
		})
		const { version: late } = await writeCastVersion(db(), {
			member: w.member.id,
			changes: { summary: "Later." },
			writtenBy: `user:${w.user.id}`,
			at: dated(150)
		})
		const [other] = await testDb
			.insert(schema.characters)
			.values({
				userId: w.user.id,
				name: "Other Person",
				description: "The other card's description."
			} as any)
			.returning()
		await w.update({ characterId: other.id })

		const { ensureCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const first = (await ensureCardVersion(db(), w.card.id))!
		const second = (await ensureCardVersion(db(), other.id))!
		expect((await baseOf(w.member.id)).parentVersionId).toBe(first.id)
		const [fiftyNow] = await testDb
			.select()
			.from(V)
			.where(eq(V.id, fifty!.id))
		expect(fiftyNow.parentVersionId).toBe(first.id)
		const [carrier] = await testDb
			.select()
			.from(V)
			.where(and(eq(V.castMemberId, w.member.id), eq(V.year, 100)))
		expect(carrier.parentVersionId).toBe(second.id)
		const [lateNow] = await testDb
			.select()
			.from(V)
			.where(eq(V.id, late!.id))
		expect(lateNow.parentVersionId).toBe(second.id)
	})

	test("linking with a retold field: the base holds the form's words, the rest follows", async () => {
		const w = await world({ carded: false })
		await w.update({
			characterId: w.card.id,
			retold: { description: true },
			description: "Her own"
		})
		const base = await baseOf(w.member.id)
		expect(base.follows).not.toContain("description")
		expect(base.description).toBe("Her own")
		expect(base.follows).toContain("personality")
		const read = await memberAsRead(db(), w.member.id)
		expect(read!.description).toBe("Her own")
		expect(read!.cardless).toBe(false)
	})

	test("swapping the card: followed fields read the new card, own fields stay", async () => {
		const w = await world()
		await w.update({
			retold: { description: true },
			description: "Her own"
		})
		const [other] = await testDb
			.insert(schema.characters)
			.values({
				userId: w.user.id,
				name: "Other Person",
				description: "The other card's description.",
				personality: "Other personality",
				firstMessage: "Other hello."
			} as any)
			.returning()
		await w.update({ characterId: other.id })
		const { ensureCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const v1 = (await ensureCardVersion(db(), other.id))!
		const base = await baseOf(w.member.id)
		expect(base.parentVersionId).toBe(v1.id)
		expect(base.follows).not.toContain("description")
		expect(base.follows).toContain("personality")
		const read = await memberAsRead(db(), w.member.id)
		expect(read!.activeCardId).toBe(other.id)
		expect(read!.description).toBe("Her own")
		expect(read!.personality).toBe("Other personality")
	})
})

describe("the member's inserts make a base", () => {
	test("insertBackgroundBinding", async () => {
		const w = await world()
		const { insertBackgroundBinding } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const member = await testDb.transaction((tx) =>
			insertBackgroundBinding(
				tx as any,
				w.book.id,
				{ name: "Stable boy", summary: "Feeds the horses." },
				{ writtenBy: `user:${w.user.id}` }
			)
		)
		const base = await baseOf(member.id)
		expect(base).toMatchObject({
			name: "Stable boy",
			summary: "Feeds the horses.",
			parentVersionId: null,
			writtenBy: `user:${w.user.id}`
		})
	})

	test("syncLorebookBindings", async () => {
		const w = await world()
		await testDb.insert(schema.lorebookEntries).values(
			entryInsert({
				lorebookId: w.book.id,
				position: 1,
				typeId: CHARACTER_LORE_TYPE_ID,
				name: "A scene",
				content: "{{char:40}} waves."
			} as any)
		)
		const { syncLorebookBindings } = await import(
			"$lib/server/sockets/lorebooks"
		)
		await syncLorebookBindings({ lorebookId: w.book.id })
		const [minted] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, w.book.id),
					eq(schema.lorebookBindings.binding, "{{char:40}}")
				)
			)
		expect(minted).toBeTruthy()
		expect((await baseOf(minted.id))?.castMemberId).toBe(minted.id)
	})

	test("a new member's aliases reach its base through the name sync", async () => {
		const w = await world()
		// The card's real name is an alias of a member named by its nickname.
		expect((await storedRow(w.member.id)).aliases).toContain("Verity Hale")
		expect((await baseOf(w.member.id)).aliases).toContain("Verity Hale")
		expect((await memberAsRead(db(), w.member.id))!.aliases).toContain(
			"Verity Hale"
		)
	})
})

describe("changing the later versions too (★CV-13)", () => {
	async function withLaterVersions() {
		const w = await world()
		// The member page shows and saves "the most recently active" version
		// (owner 2026-11-06): a clock before both dated versions keeps the
		// base the one shown, so they are the later ones.
		await testDb
			.update(schema.lorebooks)
			.set({ storyClockYear: 100 })
			.where(eq(schema.lorebooks.id, w.book.id))
		// A dated version an author wrote, and one a story wrote.
		await writeCastVersion(db(), {
			member: w.member.id,
			changes: { nodeState: "missing" },
			writtenBy: `user:${w.user.id}`,
			at: {
				branchId: null,
				date: { year: 200, month: 3, day: 4 },
				personalPosition: null
			}
		})
		const base = await baseOf(w.member.id)
		await insertCharacterVersions(db(), [
			{
				castMemberId: w.member.id,
				lorebookId: w.book.id,
				parentVersionId: base.parentVersionId,
				follows: base.follows,
				year: 300,
				month: 1,
				day: 1,
				sourceSessionId: 987654,
				writtenBy: "run:1",
				nodeState: "deceased",
				nodeVisibility: "normal",
				name: base.name,
				aliases: base.aliases
			}
		])
		const dated = async (year: number) =>
			(
				await testDb
					.select()
					.from(V)
					.where(
						and(eq(V.castMemberId, w.member.id), eq(V.year, year))
					)
					.orderBy(asc(V.id))
			)[0]
		return { w, dated }
	}

	test("off: every later version keeps its own words", async () => {
		const { w, dated } = await withLaterVersions()
		const res = await w.update({
			retold: { description: true },
			description: "Her own"
		})
		expect(res.laterVersions).toEqual({ changed: 0, kept: 2 })
		expect((await dated(200)).follows).toContain("description")
		expect((await dated(300)).follows).toContain("description")
	})

	test("on: an author's later version takes the edit; a story-written one keeps its words", async () => {
		const { w, dated } = await withLaterVersions()
		const res = await w.update(
			{ retold: { description: true }, description: "Her own" },
			{ changeLaterVersions: true }
		)
		expect(res.laterVersions).toEqual({ changed: 1, kept: 1 })
		const authored = await dated(200)
		expect(authored.description).toBe("Her own")
		expect(authored.follows).not.toContain("description")
		// Its own change stays.
		expect(authored.nodeState).toBe("missing")
		const story = await dated(300)
		expect(story.follows).toContain("description")
		expect(story.nodeState).toBe("deceased")
		// Nothing new was added: the later version was updated in place.
		const all = await testDb
			.select({ id: V.id })
			.from(V)
			.where(eq(V.castMemberId, w.member.id))
		expect(all).toHaveLength(3)
	})
})
