/**
 * A cast member's life under dated cards, deleted cards and guests (plan A25).
 *
 * - A **dated card** — a card a cast amendment draws a member with from a date
 *   — is that member's, on any line and at any date: seating it finds them,
 *   never a second member, and every reader that turns a seat into a member
 *   (sprites, stats, the graph context) finds the same one.
 * - A card can be one member's only: a dated change or a link naming a card
 *   another member already has is refused.
 * - A deleted card is gone from the book: it cannot be linked, it names
 *   nobody in the gazetteer, an export does not carry it and an import does
 *   not bind to it.
 * - A cast amendment sets only what a member has to say at a date.
 * - A guest's persona edit never renames the host's cast member.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-cast-lifecycle-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

let tag = 1
async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}
async function makeBook(userId: number, name: string) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return book
}
async function makeCard(
	userId: number,
	name: string,
	over: Record<string, unknown> = {}
) {
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: `${name}, described.`, ...over } as any)
		.returning()
	return card
}
async function makeMember(lorebookId: number, name: string, characterId?: number) {
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			name,
			binding: `{{char:${tag++}}}`,
			characterId: characterId ?? null
		})
		.returning()
	return member
}
async function amendCard(
	lorebookId: number,
	memberId: number,
	year: number,
	characterId: number,
	branchId: number | null = null
) {
	await testDb.insert(schema.castAmendments).values({
		lorebookBindingId: memberId,
		lorebookId,
		branchId,
		year,
		fields: { characterId }
	})
}
async function seat(userId: number, lorebookId: number, characterId: number) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId, position: 0 })
	return session
}

/** Verity: young card bound, the keeper's card from Y20 — on a fork only. */
async function verity(label: string) {
	const user = await makeUser(`cast-life-${label}`)
	const book = await makeBook(user.id, `Ashfall ${label}`)
	const young = await makeCard(user.id, "Verity")
	const keeper = await makeCard(user.id, "Keeper Verity")
	const member = await makeMember(book.id, "Verity", young.id)
	const [fork] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book.id, name: `later-${label}` })
		.returning()
	await amendCard(book.id, member.id, 20, keeper.id, fork.id)
	return { user, book, young, keeper, member, fork }
}

describe("a dated card is its member's (A25)", () => {
	test("seating the dated card finds the member and never mints a second", async () => {
		const { book, keeper, member } = await verity("seat")
		const { resolveOrCreateBindingRow } = await import(
			"$lib/server/utils/characterBindingSync"
		)
		const found = await resolveOrCreateBindingRow(
			{ lorebookId: book.id, characterId: keeper.id },
			testDb as any
		)
		expect(found).toEqual({ id: member.id, created: false })
		const cast = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, book.id))
		expect(cast).toHaveLength(1)
	})

	test("the one cast resolver answers for the dated card, drawn as the line reads", async () => {
		const { book, keeper, young, member, fork } = await verity("resolver")
		const { cardMemberAt } = await import("./amendments")
		const { lineOfBook } = await import("$lib/server/state/reading")
		const line = await lineOfBook(testDb as any, book.id, fork.id)
		const later = await cardMemberAt(testDb as any, {
			lorebookId: book.id,
			characterId: keeper.id,
			at: { line, moment: { year: 25, month: null, day: null } }
		})
		expect(later?.member.id).toBe(member.id)
		expect(later?.member.characterId).toBe(keeper.id)
		// The same person on main, where no dated change reaches: her own card.
		const onMain = await cardMemberAt(testDb as any, {
			lorebookId: book.id,
			characterId: keeper.id,
			at: { line: MAIN_LINE, moment: null }
		})
		expect(onMain?.member.id).toBe(member.id)
		expect(onMain?.member.characterId).toBe(young.id)
	})

	test("a session seating the dated card reaches the member: its cast, its stats owner, its graph", async () => {
		const { user, book, keeper, member } = await verity("session")
		const session = await seat(user.id, book.id, keeper.id)

		const { sessionLinks } = await import("$lib/server/state/resolve")
		const links = await sessionLinks(testDb as any, session.id)
		expect(links.cast.map((c) => c.castMemberId)).toEqual([member.id])

		const { lorebookLinks, normalizeOwner } = await import(
			"$lib/server/state/lorebookState"
		)
		const book_ = await lorebookLinks(testDb as any, book.id)
		expect(
			normalizeOwner({ kind: "session_cast", id: keeper.id }, book_)
		).toEqual({ kind: "cast_member", id: member.id })

		// The speaker's member is found (an empty list), not missed (null).
		const { buildGraphRelationshipRows } = await import(
			"$lib/server/utils/graphContextFormatter"
		)
		const rows = await buildGraphRelationshipRows({
			sessionId: session.id,
			lorebookId: book.id,
			speakerCharacterId: keeper.id,
			db: testDb as any
		})
		expect(rows).toEqual([])
		// …where a card that is nobody's in the book finds nobody.
		const stranger = await makeCard(user.id, "Nobody here")
		expect(
			await buildGraphRelationshipRows({
				sessionId: session.id,
				lorebookId: book.id,
				speakerCharacterId: stranger.id,
				db: testDb as any
			})
		).toBeNull()
	})

	test("a dated change may not name a card another member already has", async () => {
		const { user, book } = await verity("taken")
		const otherCard = await makeCard(user.id, "Bram")
		await makeMember(book.id, "Bram", otherCard.id)
		const newcomer = await makeMember(book.id, "The stranger")
		const { amendmentsCreateHandler } = await import("./amendments")
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					castId: newcomer.id,
					year: 5,
					fields: { characterId: otherCard.id }
				},
				noopEmit
			)
		).rejects.toThrow(/Bram already has that card/)
	})

	test("two tabs giving one card to two members at once: one of them is refused", async () => {
		const user = await makeUser("cast-life-race")
		const book = await makeBook(user.id, "Ashfall race")
		const card = await makeCard(user.id, "Contested")
		const one = await makeMember(book.id, "One")
		const two = await makeMember(book.id, "Two")
		const three = await makeMember(book.id, "Three")
		const { amendmentsCreateHandler } = await import("./amendments")
		const { updateLorebookBindingHandler } = await import("./lorebooks")
		const results = await Promise.allSettled([
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{ lorebookId: book.id, castId: one.id, year: 5, fields: { characterId: card.id } },
				noopEmit
			),
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{ lorebookId: book.id, castId: two.id, year: 6, fields: { characterId: card.id } },
				noopEmit
			),
			updateLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{ lorebookBinding: { id: three.id, characterId: card.id } } as any,
				noopEmit
			)
		])
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
		const { castMemberCards } = await import("$lib/server/utils/castMemberCards")
		const { cardsOf } = await castMemberCards(testDb as any, book.id)
		const holders = [one.id, two.id, three.id].filter((id) =>
			(cardsOf.get(id) ?? []).includes(card.id)
		)
		expect(holders).toHaveLength(1)
	})

	test("the scene cast list names a seat holding the dated card as its member", async () => {
		const user = await makeUser("cast-life-scenecast")
		const book = await makeBook(user.id, "Ashfall scene cast")
		const young = await makeCard(user.id, "Verity")
		const keeper = await makeCard(user.id, "The Lamp Keeper")
		const member = await makeMember(book.id, "Verity", young.id)
		await amendCard(book.id, member.id, 20, keeper.id)
		const session = await seat(user.id, book.id, keeper.id)
		const { buildSceneCastList, resolveCharacterRefs } = await import(
			"$lib/server/utils/summarizer/availableSceneCast"
		)
		const cast = await buildSceneCastList(null, book.id, session.id, testDb as any)
		expect(cast.map((c) => c.id)).toEqual([member.id])
		// A model naming the seat's card is naming her: her member, not a
		// suggested newcomer.
		expect(
			resolveCharacterRefs([{ name: "The Lamp Keeper" } as any], cast)
		).toEqual({ ids: [member.id], suggestedNames: [] })
	})

	test("linking a card another member is drawn with from a date is refused", async () => {
		const { user, book, keeper } = await verity("link")
		const newcomer = await makeMember(book.id, "The stranger")
		const { updateLorebookBindingHandler } = await import("./lorebooks")
		await expect(
			updateLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{ lorebookBinding: { id: newcomer.id, characterId: keeper.id } } as any,
				noopEmit
			)
		).rejects.toThrow(/Verity already has that card/)
	})
})

describe("a deleted card is gone from the book (A25)", () => {
	async function deletedCard(label: string) {
		const user = await makeUser(`cast-deleted-${label}`)
		const book = await makeBook(user.id, `Deleted ${label}`)
		const gone = await makeCard(user.id, `Gone ${label}`, {
			isDeleted: true,
			description: "Words from a deleted card."
		})
		return { user, book, gone }
	}

	test("it cannot be linked to a cast member", async () => {
		const { user, book, gone } = await deletedCard("link")
		const { verifyBindingTargetAccess, createLorebookBindingHandler } =
			await import("./lorebooks")
		expect(
			await verifyBindingTargetAccess({ characterId: gone.id }, user.id)
		).toBe(false)
		await expect(
			createLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{ lorebookBinding: { lorebookId: book.id, characterId: gone.id } } as any,
				noopEmit
			)
		).rejects.toThrow()
	})

	test("a session seating it gives it no member", async () => {
		const { user, book, gone } = await deletedCard("seat")
		const session = await seat(user.id, book.id, gone.id)
		const { runLorebookBindingCheck } = await import("./sessions")
		await runLorebookBindingCheck(fakeSocket(user.id), session.id, book.id, noopEmit, {
			askAboutOrphans: false
		})
		expect(
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, book.id))
		).toEqual([])
	})

	test("a scene's or a summary's sender guarantee gives it no member", async () => {
		const { book, gone } = await deletedCard("sender")
		const { resolveOrCreateBinding } = await import(
			"$lib/server/utils/characterBindingSync"
		)
		expect(
			await resolveOrCreateBinding(
				{ lorebookId: book.id, characterId: gone.id },
				testDb as any
			)
		).toBeNull()
		expect(
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, book.id))
		).toEqual([])
	})

	test("a member still linked to it is still found by its seat", async () => {
		const { book, gone } = await deletedCard("found")
		const member = await makeMember(book.id, gone.name, gone.id)
		const { resolveOrCreateBindingRow } = await import(
			"$lib/server/utils/characterBindingSync"
		)
		expect(
			await resolveOrCreateBindingRow(
				{ lorebookId: book.id, characterId: gone.id },
				testDb as any
			)
		).toEqual({ id: member.id, created: false })
	})

	test("unlinking it, then seating the session again, never mints a second member", async () => {
		const user = await makeUser("cast-deleted-unlink")
		const book = await makeBook(user.id, "Deleted unlink")
		const card = await makeCard(user.id, "Maren")
		const member = await makeMember(book.id, "Maren", card.id)
		const session = await seat(user.id, book.id, card.id)
		const { charactersDelete } = await import("./characters")
		await charactersDelete.handler(fakeSocket(user.id), { id: card.id } as any, noopEmit as any)
		const { updateLorebookBindingHandler } = await import("./lorebooks")
		await updateLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{ lorebookBinding: { id: member.id, characterId: null } } as any,
			noopEmit
		)
		const { runLorebookBindingCheck } = await import("./sessions")
		await runLorebookBindingCheck(fakeSocket(user.id), session.id, book.id, noopEmit, {
			askAboutOrphans: false
		})
		const rows = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, book.id))
		expect(rows.map((r) => ({ id: r.id, characterId: r.characterId }))).toEqual([
			{ id: member.id, characterId: null }
		])
	})

	test("a member still linked to it names nobody in the gazetteer", async () => {
		const { user, book, gone } = await deletedCard("gazetteer")
		const live = await makeCard(user.id, "Maren")
		await makeMember(book.id, gone.name, gone.id)
		await makeMember(book.id, "Maren", live.id)
		const { loadVocabulary } = await import("$lib/server/annotations")
		const vocabulary = await loadVocabulary(testDb as any, book.id)
		const refs = [...vocabulary.gazetteer.byName.values()]
		expect(refs.some((r) => r.kind === "character" && r.id === live.id)).toBe(true)
		expect(refs.some((r) => r.kind === "character" && r.id === gone.id)).toBe(false)
	})

	test("an export does not carry it; the member goes without a card", async () => {
		const { user, book, gone } = await deletedCard("export")
		await makeMember(book.id, gone.name, gone.id)
		const { buildLorebookExportData } = await import(
			"$lib/server/utils/lorebookExportBuilder"
		)
		const { specBookWithGraph } = await buildLorebookExportData(book.id, user.id)
		const serenepub = (specBookWithGraph as any).extensions.serenepub
		expect(serenepub.characters).toHaveLength(0)
		expect(serenepub.bindings).toHaveLength(1)
		expect(serenepub.bindings[0].characterLocalId).toBeNull()
	})

	test("an import never binds a member to the deleted card its file names", async () => {
		const user = await makeUser("cast-deleted-import")
		const { createCharacterFromParsedData } = await import("./characters")
		const card = await createCharacterFromParsedData(
			{
				name: "Returning",
				description: "A card that will be deleted.",
				personality: "",
				scenario: "",
				first_mes: "",
				mes_example: "",
				creator_notes: "",
				system_prompt: "",
				post_history_instructions: "",
				alternate_greetings: [],
				tags: [],
				creator: "",
				character_version: "",
				extensions: {}
			},
			undefined,
			user.id
		)
		const book = await makeBook(user.id, "Round trip")
		await makeMember(book.id, "Returning", card.id)
		const { buildLorebookExportData } = await import(
			"$lib/server/utils/lorebookExportBuilder"
		)
		const { specBookWithGraph } = await buildLorebookExportData(book.id, user.id)
		await testDb.delete(schema.lorebooks).where(eq(schema.lorebooks.id, book.id))
		await testDb
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(eq(schema.characters.id, card.id))

		const { lorebookImportHandler } = await import("./lorebooks")
		const imported = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookJson: JSON.stringify(specBookWithGraph) },
			noopEmit
		)
		expect(imported.status).toBe("created")
		const [member] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, imported.lorebook!.id))
		expect(member.characterId).not.toBeNull()
		expect(member.characterId).not.toBe(card.id)
		const bound = await testDb.query.characters.findFirst({
			where: (c, { eq: q }) => q(c.id, member.characterId!)
		})
		expect(bound?.isDeleted).toBe(false)
	})
})

describe("a cast amendment sets only what a member says at a date (A25)", () => {
	test("columns that are not the member's to date are dropped", async () => {
		const user = await makeUser("cast-allow-drop")
		const book = await makeBook(user.id, "Allowlist")
		const member = await makeMember(book.id, "Maren")
		const { amendmentsCreateHandler } = await import("./amendments")
		const res = await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				castId: member.id,
				year: 3,
				fields: {
					name: "Maren the Elder",
					aliases: ["the elder"],
					summary: "Older now.",
					nodeState: "missing",
					nodeVisibility: "legendary",
					spriteSet: "winter",
					binding: "{{char:999}}",
					parentNodeId: member.id,
					embedding: [0.1, 0.2],
					embeddingModel: "m",
					sceneId: 1,
					historyEntryId: 1,
					absorbedAliases: ["someone else"],
					lorebookId: 12345
				}
			},
			noopEmit
		)
		const stored = res.cast.find((a) => a.castId === member.id)!
		expect(stored.fields).toEqual({
			name: "Maren the Elder",
			aliases: ["the elder"],
			summary: "Older now.",
			nodeState: "missing",
			nodeVisibility: "legendary",
			spriteSet: "winter"
		})
	})

	test("a state or a visibility a member cannot have is refused", async () => {
		const user = await makeUser("cast-allow-refuse")
		const book = await makeBook(user.id, "Allowlist refusals")
		const member = await makeMember(book.id, "Maren")
		const { amendmentsCreateHandler } = await import("./amendments")
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{ lorebookId: book.id, castId: member.id, year: 3, fields: { nodeState: "exploded" } },
				noopEmit
			)
		).rejects.toThrow(/not a state a cast member can be in/)
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{ lorebookId: book.id, castId: member.id, year: 3, fields: { nodeVisibility: "everyone" } },
				noopEmit
			)
		).rejects.toThrow(/not a visibility a cast member can have/)
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{ lorebookId: book.id, castId: member.id, year: 3, fields: { aliases: "the elder" } },
				noopEmit
			)
		).rejects.toThrow(/other names are a list/)
	})

	test("a state, a visibility or a card given as anything but itself is refused", async () => {
		const user = await makeUser("cast-allow-shapes")
		const book = await makeBook(user.id, "Allowlist shapes")
		const member = await makeMember(book.id, "Maren")
		const { amendmentsCreateHandler } = await import("./amendments")
		const create = (fields: Record<string, unknown>) =>
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{ lorebookId: book.id, castId: member.id, year: 3, fields },
				noopEmit
			)
		await expect(create({ nodeState: ["deceased"] })).rejects.toThrow(
			/not a state a cast member can be in/
		)
		await expect(create({ nodeVisibility: ["hidden"] })).rejects.toThrow(
			/not a visibility a cast member can have/
		)
		for (const characterId of [0, false, "", -4, 2.5, "abc", [3]])
			await expect(create({ characterId })).rejects.toThrow(
				/not one this cast member can be drawn with/
			)
		expect(
			await testDb
				.select()
				.from(schema.castAmendments)
				.where(eq(schema.castAmendments.lorebookBindingId, member.id))
		).toEqual([])
	})

	test("a change that sets nothing a member can have at a date is refused", async () => {
		const user = await makeUser("cast-allow-empty")
		const book = await makeBook(user.id, "Allowlist empty")
		const member = await makeMember(book.id, "Maren")
		const { amendmentsCreateHandler, amendmentsUpdateHandler } = await import(
			"./amendments"
		)
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					castId: member.id,
					year: 4,
					fields: { binding: "{{char:9}}", parentNodeId: 1 }
				},
				noopEmit
			)
		).rejects.toThrow(/sets nothing/)
		const res = await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, castId: member.id, year: 4, fields: { name: "Maren the Elder" } },
			noopEmit
		)
		const stored = res.cast.find((a) => a.castId === member.id)!
		await expect(
			amendmentsUpdateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					subject: "cast",
					id: stored.id,
					fields: { sceneId: 2 }
				} as any,
				noopEmit
			)
		).rejects.toThrow(/sets nothing/)
		const [row] = await testDb
			.select({ fields: schema.castAmendments.fields })
			.from(schema.castAmendments)
			.where(eq(schema.castAmendments.id, stored.id))
		expect(row.fields).toEqual({ name: "Maren the Elder" })
	})
})

describe("a guest's persona edit stays in the guest's books (A25)", () => {
	test("the host's member keeps the name it was given; the guest's own book follows", async () => {
		const host = await makeUser("cast-guest-host")
		const guest = await makeUser("cast-guest-guest")
		const persona = await makeCard(guest.id, "Wren", { isPersona: true })
		const hostBook = await makeBook(host.id, "Host's book")
		const guestBook = await makeBook(guest.id, "Guest's book")
		const { resolveOrCreateBindingRow, syncLorebookBindingsForCharacter } =
			await import("$lib/server/utils/characterBindingSync")
		const inHost = (await resolveOrCreateBindingRow(
			{ lorebookId: hostBook.id, characterId: persona.id },
			testDb as any
		))!
		const inGuest = (await resolveOrCreateBindingRow(
			{ lorebookId: guestBook.id, characterId: persona.id },
			testDb as any
		))!
		const nameOf = async (id: number) =>
			(
				await testDb.query.lorebookBindings.findFirst({
					where: (b, { eq: q }) => q(b.id, id)
				})
			)?.name
		// Minted with the card's name, in either book.
		expect(await nameOf(inHost.id)).toBe("Wren")
		expect(await nameOf(inGuest.id)).toBe("Wren")

		await testDb
			.update(schema.characters)
			.set({ name: "Wrenna" })
			.where(eq(schema.characters.id, persona.id))
		await syncLorebookBindingsForCharacter(persona.id, testDb as any)

		expect(await nameOf(inHost.id)).toBe("Wren")
		expect(await nameOf(inGuest.id)).toBe("Wrenna")

		// The host editing that member (its summary here) does not pull the
		// guest's new name in either; only linking a card names a member.
		const { updateLorebookBindingHandler } = await import("./lorebooks")
		await updateLorebookBindingHandler.handler(
			fakeSocket(host.id),
			{ lorebookBinding: { id: inHost.id, summary: "Met at the inn." } } as any,
			noopEmit
		)
		expect(await nameOf(inHost.id)).toBe("Wren")
	})

	test("the owner's own card still names its member when the member is edited", async () => {
		const owner = await makeUser("cast-owner-edit")
		const card = await makeCard(owner.id, "Maren")
		const book = await makeBook(owner.id, "Owner's book")
		const member = await makeMember(book.id, "Maren", card.id)
		await testDb
			.update(schema.characters)
			.set({ name: "Maren Ashe" })
			.where(eq(schema.characters.id, card.id))
		const { updateLorebookBindingHandler } = await import("./lorebooks")
		const res = await updateLorebookBindingHandler.handler(
			fakeSocket(owner.id),
			{ lorebookBinding: { id: member.id, summary: "The smith." } } as any,
			noopEmit
		)
		expect(res.lorebookBinding.name).toBe("Maren Ashe")
	})
})
