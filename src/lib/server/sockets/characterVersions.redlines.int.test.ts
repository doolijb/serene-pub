/**
 * A card version's and a cast version's Edit history through the real
 * handlers: who records (and who does not), the list as its asker reads it,
 * Restore through the version's own save, Clear, and what never travels.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, inArray } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import { _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { countRedlines, recordRedline } from "$lib/server/lorebooks/redlines"
import {
	insertCard,
	insertCastMember,
	writeCastVersion
} from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let n = 0
const GENRE = "test:genre/version-redlines-socket"
const R = schema.loreRedlines
const V = schema.characterVersions
const db = () => testDb as unknown as Db

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-version-redlines-socket-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketOf = (userId: number, isAdmin = false) =>
	({ user: { id: userId, isAdmin } }) as any

function recorder() {
	const sent: Array<{ event: string; data: any }> = []
	return {
		sent,
		emit: ((event: string, data: any) =>
			void sent.push({ event, data })) as any
	}
}

async function world() {
	_clearAttributeSlots()
	genreKeeping(GENRE, {
		name: { en: "Version redlines" },
		family: "test",
		slots: [],
		events: {}
	})
	const tag = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `vrs-${tag}`)
	const other = await createTestUser(testDb, `vrs-other-${tag}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${tag}` })
		.returning()
	const { card, version } = await insertCard(db(), {
		userId: user.id,
		name: `Card ${tag}`,
		description: "The card's description."
	})
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${tag}}}`,
		characterId: card.id,
		name: `Ada ${tag}`
	})
	return { user, other, book: book!, card, version, member, base: base!, tag }
}
type World = Awaited<ReturnType<typeof world>>

const rowsOf = (versionId: number) =>
	testDb
		.select()
		.from(R)
		.where(eq(R.characterVersionId, versionId))
		.orderBy(R.id)

const versionOf = async (id: number) =>
	(await testDb.select().from(V).where(eq(V.id, id)))[0]!

const png = (seed: number) => {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(seed)
	return PNG.sync.write(img)
}

async function pictureOf(w: World, seed: number) {
	const { createMedia } = await import("$lib/server/media")
	const made = await createMedia(db(), {
		userId: w.user.id,
		characterId: w.card.id,
		bytes: png(seed)
	})
	return made.file.id
}

const saveCardAs = async (
	userId: number,
	character: Record<string, unknown>,
	extra: Record<string, unknown> = {}
) => {
	const { charactersUpdate } = await import("./characters")
	return charactersUpdate.handler(
		socketOf(userId),
		{ character, ...extra } as any,
		recorder().emit
	)
}

const setAvatar = async (
	userId: number,
	characterId: number,
	mediaId: number
) => {
	const { charactersSetAvatar } = await import("./characters")
	return charactersSetAvatar.handler(
		socketOf(userId),
		{ characterId, mediaId } as any,
		recorder().emit
	)
}

const memberSave = async (
	userId: number,
	id: number,
	over: Record<string, unknown>
) => {
	const { updateLorebookBindingHandler } = await import("./lorebooks")
	return updateLorebookBindingHandler.handler(
		socketOf(userId),
		{ lorebookBinding: { id, ...over } } as any,
		recorder().emit
	)
}

const list = async (userId: number, characterVersionId: number) => {
	const { characterVersionRedlinesHandler } = await import("./redlines")
	const r = recorder()
	const res = await characterVersionRedlinesHandler.handler(
		socketOf(userId),
		{ characterVersionId },
		r.emit
	)
	return { res, r }
}

const restore = async (userId: number, redlineId: number) => {
	const { characterVersionRestoreRedlineHandler } = await import("./redlines")
	const r = recorder()
	const result = characterVersionRestoreRedlineHandler.handler(
		socketOf(userId),
		{ redlineId },
		r.emit
	)
	return { r, result }
}

const clear = async (userId: number, characterVersionId: number) => {
	const { characterVersionClearRedlinesHandler } = await import("./redlines")
	const r = recorder()
	const result = characterVersionClearRedlinesHandler.handler(
		socketOf(userId),
		{ characterVersionId },
		r.emit
	)
	return { r, result }
}

/** A row recorded straight, for the list's shapes. */
const plant = (
	versionId: number,
	userId: number,
	before: Record<string, unknown>,
	after: Record<string, unknown>
) =>
	recordRedline(db(), {
		characterVersionId: versionId,
		before,
		after,
		keys: Object.keys(after),
		cause: "save",
		by: { userId }
	})

describe("what a card editor save records", () => {
	test("one row as the person; a save that changes nothing records none", async () => {
		const w = await world()
		await saveCardAs(w.user.id, { id: w.card.id, description: "Changed." })
		const rows = await rowsOf(w.version.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ cause: "save", userId: w.user.id })
		expect(Object.keys(rows[0]!.changes)).toEqual(["description"])
		expect(rows[0]!.changes.description).toEqual({
			before: { v: "The card's description." },
			after: { v: "Changed." }
		})

		await saveCardAs(w.user.id, { id: w.card.id, description: "Changed." })
		expect(await rowsOf(w.version.id)).toHaveLength(1)
	})

	test("Save as new version gives the new version no rows and leaves the old one's", async () => {
		const w = await world()
		await saveCardAs(w.user.id, { id: w.card.id, description: "Changed." })
		const res: any = await saveCardAs(
			w.user.id,
			{ id: w.card.id, description: "A third thing." },
			{ saveAsNewVersion: {}, cardVersionId: w.version.id }
		)
		expect(res.cardVersionId).not.toBe(w.version.id)
		expect(await rowsOf(res.cardVersionId)).toHaveLength(0)
		expect(await rowsOf(w.version.id)).toHaveLength(1)
	})

	test("characters:setAvatar records a face row", async () => {
		const w = await world()
		const face = await pictureOf(w, 11)
		await setAvatar(w.user.id, w.card.id, face)
		const rows = await rowsOf(w.version.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.changes.faceMediaId).toEqual({
			before: { v: null },
			after: { v: face }
		})
	})

	test("an import records none", async () => {
		const w = await world()
		const { charactersImportCard } = await import("./characters")
		const file = Buffer.from(
			JSON.stringify({
				spec: "chara_card_v2",
				spec_version: "2.0",
				data: {
					name: "Imported",
					description: "From a file.",
					personality: "",
					scenario: "",
					first_mes: "Hello",
					mes_example: "",
					creator_notes: "",
					system_prompt: "",
					post_history_instructions: "",
					alternate_greetings: [],
					tags: [],
					creator: "",
					character_version: "",
					extensions: {}
				}
			})
		).toString("base64")
		const res = await charactersImportCard.handler(
			socketOf(w.user.id),
			{ file } as any,
			recorder().emit
		)
		expect(res.status).toBe("created")
		const versions = await testDb
			.select({ id: V.id })
			.from(V)
			.where(eq(V.cardId, res.character!.id))
		expect(versions.length).toBeGreaterThan(0)
		expect(
			await testDb
				.select()
				.from(R)
				.where(
					inArray(
						R.characterVersionId,
						versions.map((v) => v.id)
					)
				)
		).toHaveLength(0)
	})
})

describe("what a cast version write records", () => {
	test("a member page save records one row as the person", async () => {
		const w = await world()
		await memberSave(w.user.id, w.member.id, {
			description: "Her own words.",
			retold: { description: true }
		})
		const rows = await rowsOf(w.base.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ cause: "save", userId: w.user.id })
		expect(rows[0]!.changes.description).toEqual({
			before: { v: { follow: true } },
			after: { v: "Her own words." }
		})
	})

	test("editing a dated cast change from the amendments list records one", async () => {
		const w = await world()
		const { amendmentsCreateHandler, amendmentsUpdateHandler } =
			await import("./amendments")
		await amendmentsCreateHandler.handler(
			socketOf(w.user.id),
			{
				lorebookId: w.book.id,
				castId: w.member.id,
				year: 5,
				fields: { summary: "Later." }
			} as any,
			recorder().emit
		)
		const [dated] = await testDb
			.select()
			.from(V)
			.where(eq(V.castMemberId, w.member.id))
			.orderBy(V.id)
			.then((rows) => rows.filter((r) => r.year === 5))
		expect(dated).toBeTruthy()
		expect(await rowsOf(dated!.id)).toHaveLength(0)
		await amendmentsUpdateHandler.handler(
			socketOf(w.user.id),
			{
				lorebookId: w.book.id,
				id: dated!.id,
				subject: "cast",
				fields: { summary: "Later still." }
			} as any,
			recorder().emit
		)
		const rows = await rowsOf(dated!.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ cause: "save", userId: w.user.id })
	})

	test("a routine's second write in one turn records routine, and the view holds no run id", async () => {
		const w = await world()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: `Run ${w.tag}`,
				genreId: GENRE,
				lorebookId: w.book.id
			})
			.returning()
		const [message] = await testDb
			.insert(schema.messages)
			.values({
				sessionId: session!.id,
				role: "assistant",
				content: "…"
			} as any)
			.returning({ id: schema.messages.id })
		const { writeCastMember } = await import(
			"$lib/server/pipelines/runtime/castMember"
		)
		const write = (changes: unknown) =>
			writeCastMember(db(), {
				sessionId: session!.id,
				member: w.member.id,
				changes,
				runId: "run-xyz-77",
				messageId: message!.id
			})
		const first = await write({ description: "A new description." })
		expect(await rowsOf(first.castVersionId)).toHaveLength(0)
		const second = await write({ personality: "Wry." })
		expect(second.coalesced).toBe(true)
		const rows = await rowsOf(second.castVersionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			cause: "routine",
			userId: null,
			sessionId: session!.id,
			runId: "run-xyz-77"
		})

		const { res } = await list(w.user.id, second.castVersionId)
		expect(res.redlines[0]!.cause).toBe("routine")
		expect(res.redlines[0]!.who).toMatch(/^A routine in Run/)
		expect(JSON.stringify(res)).not.toContain("run-xyz-77")
	})

	test("a write given no author (boot, providers) records nothing", async () => {
		const w = await world()
		await testDb.transaction((tx) =>
			writeCastVersion(tx as unknown as Db, {
				member: w.member.id,
				changes: { summary: "Provided." },
				writtenBy: "plugin:test",
				at: { branchId: null, date: null, personalPosition: null }
			})
		)
		expect(await rowsOf(w.base.id)).toHaveLength(0)
	})
})

describe("the list", () => {
	test("the owner sees it; another user is refused with the echo", async () => {
		const w = await world()
		await saveCardAs(w.user.id, { id: w.card.id, description: "Changed." })
		const { res, r } = await list(w.user.id, w.version.id)
		expect(r.sent.map((s) => s.event)).toEqual([
			"characterVersions:redlines"
		])
		expect(res).toMatchObject({
			characterVersionId: w.version.id,
			cardId: w.card.id,
			lorebookId: null,
			canRestore: true,
			canClear: true
		})
		expect(res.redlines).toHaveLength(1)
		expect(res.redlines[0]).toMatchObject({
			who: "You",
			mine: true,
			cause: "save"
		})
		expect(res.redlines[0]!.changes[0]).toMatchObject({
			key: "description",
			label: "Description",
			before: "The card's description.",
			after: "Changed."
		})

		const { characterVersionRedlinesHandler } = await import("./redlines")
		const refused = recorder()
		await expect(
			characterVersionRedlinesHandler.handler(
				socketOf(w.other.id),
				{ characterVersionId: w.version.id },
				refused.emit
			)
		).rejects.toThrow("Character not found or access denied.")
		expect(refused.sent).toEqual([
			{
				event: "characterVersions:redlines:error",
				data: {
					characterVersionId: w.version.id,
					error: "Character not found or access denied."
				}
			}
		])
		await expect(list(w.other.id, w.base.id)).rejects.toThrow(
			"Character not found or access denied."
		)
	})

	test("follows, face, greetings and creator notes are shaped for the view", async () => {
		const w = await world()
		await plant(
			w.base.id,
			w.user.id,
			{
				summary: { follow: true },
				greetings: [{ text: "Hi" }],
				faceMediaId: null,
				creatorNotes: { text: "Old note", variants: {} }
			},
			{
				summary: "Own.",
				greetings: [
					{ text: "Hello" },
					{ text: "Hey", groupOnly: true }
				],
				faceMediaId: 99,
				creatorNotes: { text: "New note", variants: {} }
			}
		)
		await plant(
			w.base.id,
			w.user.id,
			{ summary: "Own." },
			{ summary: { follow: true } }
		)
		const { res } = await list(w.user.id, w.base.id)
		expect(res).toMatchObject({
			cardId: null,
			lorebookId: w.book.id,
			canRestore: true,
			canClear: true
		})
		const byKey = (i: number) =>
			Object.fromEntries(res.redlines[i]!.changes.map((c) => [c.key, c]))
		const first = byKey(1)
		expect(first.summary).toMatchObject({
			label: "Summary",
			before: null,
			after: "Own.",
			beforeFollows: true
		})
		expect(first.summary!.afterFollows).toBeUndefined()
		expect(first.greetings).toMatchObject({
			label: "Greetings",
			before: ["Hi"],
			after: ["Hello", "Hey"]
		})
		expect(first.faceMediaId).toMatchObject({
			label: "Face",
			before: null,
			after: null,
			noPreview: true
		})
		expect(first.creatorNotes).toMatchObject({
			label: "Creator notes",
			before: "Old note",
			after: "New note"
		})
		expect(byKey(0).summary).toMatchObject({
			before: "Own.",
			after: null,
			afterFollows: true
		})
	})
})

describe("Restore", () => {
	test("a card row puts the old text back through the save and records restore", async () => {
		const w = await world()
		await saveCardAs(w.user.id, { id: w.card.id, description: "Changed." })
		const [row] = await rowsOf(w.version.id)
		const { r, result } = await restore(w.user.id, row!.id)
		expect(await result).toEqual({
			redlineId: row!.id,
			characterVersionId: w.version.id
		})
		expect((await versionOf(w.version.id)).description).toBe(
			"The card's description."
		)
		const rows = await rowsOf(w.version.id)
		expect(rows).toHaveLength(2)
		expect(rows[1]).toMatchObject({ cause: "restore", userId: w.user.id })
		expect(rows[1]!.changes.description).toEqual({
			before: { v: "Changed." },
			after: { v: "The card's description." }
		})
		const events = r.sent.map((s) => s.event)
		expect(events).toContain("characterVersions:restoreRedline")
		expect(events.at(-1)).toBe("characterVersions:redlines")
	})

	test("a face row; a key gone and a picture gone are refused with the sentence and the echo", async () => {
		const w = await world()
		const a = await pictureOf(w, 21)
		const b = await pictureOf(w, 22)
		await setAvatar(w.user.id, w.card.id, a)
		await setAvatar(w.user.id, w.card.id, b)
		const [first, second] = await rowsOf(w.version.id)

		const back = await restore(w.user.id, second!.id)
		await back.result
		expect((await versionOf(w.version.id)).faceMediaId).toBe(a)
		const rows = await rowsOf(w.version.id)
		expect(rows.at(-1)).toMatchObject({
			cause: "restore",
			userId: w.user.id
		})

		const none = await restore(w.user.id, first!.id)
		await none.result
		expect((await versionOf(w.version.id)).faceMediaId).toBeNull()

		await testDb.delete(schema.files).where(eq(schema.files.id, a))
		const gone = await restore(w.user.id, second!.id)
		await expect(gone.result).rejects.toThrow(
			"That picture is no longer kept."
		)
		expect(gone.r.sent.at(-1)).toEqual({
			event: "characterVersions:restoreRedline:error",
			data: {
				redlineId: second!.id,
				error: "That picture is no longer kept."
			}
		})

		const [odd] = await testDb
			.insert(R)
			.values({
				characterVersionId: w.version.id,
				cause: "save",
				userId: w.user.id,
				changes: {
					spriteSet: { before: { v: null }, after: { v: "x" } }
				}
			} as any)
			.returning()
		const missing = await restore(w.user.id, odd!.id)
		await expect(missing.result).rejects.toThrow(
			"spriteSet is no longer part of a character profile."
		)
		expect(missing.r.sent.at(-1)!.data).toMatchObject({
			redlineId: odd!.id
		})

		const nowhere = await restore(w.user.id, 987654321)
		await expect(nowhere.result).rejects.toThrow(
			"That edit is no longer kept."
		)
	})

	test("a cast row puts the follow back and records restore; a non-owner is refused", async () => {
		const w = await world()
		await memberSave(w.user.id, w.member.id, {
			description: "Her own words.",
			retold: { description: true }
		})
		const [row] = await rowsOf(w.base.id)

		const refused = await restore(w.other.id, row!.id)
		await expect(refused.result).rejects.toThrow(
			"Character not found or access denied."
		)

		const { r, result } = await restore(w.user.id, row!.id)
		expect(await result).toEqual({
			redlineId: row!.id,
			characterVersionId: w.base.id
		})
		const base = await versionOf(w.base.id)
		expect(base.follows).toContain("description")
		const rows = await rowsOf(w.base.id)
		expect(rows).toHaveLength(2)
		expect(rows[1]).toMatchObject({ cause: "restore", userId: w.user.id })
		expect(r.sent.map((s) => s.event)).toEqual(
			expect.arrayContaining([
				"characterVersions:restoreRedline",
				"characterVersions:redlines",
				"lorebooks:bindingList",
				"amendments:list"
			])
		)
	})

	test("a cast face row is refused when the picture is not one the member may wear, as the member page's save is", async () => {
		const w = await world()
		const [row] = await testDb
			.insert(schema.loreRedlines)
			.values({
				characterVersionId: w.base.id,
				changes: { faceMediaId: { before: { v: 987654 }, after: { v: null } } },
				cause: "save",
				userId: w.user.id
			} as any)
			.returning()
		const { result } = await restore(w.user.id, row!.id)
		await expect(result).rejects.toThrow(
			/That picture is not one this cast member can wear/
		)
		expect(await rowsOf(w.base.id)).toHaveLength(1)
	})
})

describe("Clear", () => {
	test("a card's owner clears a card version; a cast version only its lorebook's owner", async () => {
		const w = await world()
		await saveCardAs(w.user.id, { id: w.card.id, description: "Changed." })
		await memberSave(w.user.id, w.member.id, {
			description: "Own.",
			retold: { description: true }
		})

		const refused = await clear(w.other.id, w.version.id)
		await expect(refused.result).rejects.toThrow(
			"Character not found or access denied."
		)
		expect(refused.r.sent.at(-1)!.data).toMatchObject({
			characterVersionId: w.version.id
		})
		expect(await rowsOf(w.version.id)).toHaveLength(1)

		const cardClear = await clear(w.user.id, w.version.id)
		expect(await cardClear.result).toEqual({
			characterVersionId: w.version.id,
			cleared: 1
		})
		expect(await rowsOf(w.version.id)).toHaveLength(0)
		expect(cardClear.r.sent.at(-1)!.event).toBe(
			"characterVersions:redlines"
		)

		await expect(
			(await clear(w.other.id, w.base.id)).result
		).rejects.toThrow("Character not found or access denied.")
		const castClear = await clear(w.user.id, w.base.id)
		expect(await castClear.result).toEqual({
			characterVersionId: w.base.id,
			cleared: 1
		})
	})
})

describe("what never travels", () => {
	test("a card duplicate starts with no rows; an export carries none", async () => {
		const w = await world()
		await saveCardAs(w.user.id, {
			id: w.card.id,
			description: "A distinctive redline sentence."
		})
		expect(await rowsOf(w.version.id)).toHaveLength(1)

		const { charactersDuplicate, charactersExportCard } = await import(
			"./characters"
		)
		const copy = await charactersDuplicate.handler(
			socketOf(w.user.id),
			{ characterId: w.card.id } as any,
			recorder().emit
		)
		const copyVersions = await testDb
			.select({ id: V.id })
			.from(V)
			.where(eq(V.cardId, copy.character.id))
		expect(copyVersions.length).toBeGreaterThan(0)
		expect(
			await testDb
				.select()
				.from(R)
				.where(
					inArray(
						R.characterVersionId,
						copyVersions.map((v) => v.id)
					)
				)
		).toHaveLength(0)

		// The file is built from the version, never from `lore_redlines`: change
		// the card again and the old text is nowhere in it.
		await saveCardAs(w.user.id, { id: w.card.id, description: "Newest." })
		const exported = await charactersExportCard.handler(
			socketOf(w.user.id),
			{ id: w.card.id, format: "json" } as any,
			recorder().emit
		)
		const text = exported.blob.toString("utf-8")
		expect(text).not.toContain("A distinctive redline sentence.")
		expect(text.toLowerCase()).not.toContain("redline")
	})

	test("member to card and card to member copies start empty", async () => {
		const w = await world()
		await memberSave(w.user.id, w.member.id, {
			description: "Her own words.",
			retold: { description: true }
		})
		await saveCardAs(w.user.id, { id: w.card.id, description: "Changed." })
		expect(await rowsOf(w.base.id)).toHaveLength(1)

		const { cardFromMember } = await import(
			"$lib/server/characters/cardFromMember"
		)
		const made = await testDb.transaction((tx) =>
			cardFromMember(tx as unknown as Db, {
				castMemberId: w.member.id,
				userId: w.user.id
			})
		)
		const cardVersions = await testDb
			.select({ id: V.id })
			.from(V)
			.where(eq(V.cardId, made.card.id))
		expect(cardVersions.length).toBeGreaterThan(0)

		const { card: copyCard } = await insertCard(db(), {
			userId: w.user.id,
			name: `Copy card ${w.tag}`,
			description: "Another card."
		})
		const { member: seated, base } = await insertCastMember(db(), {
			lorebookId: w.book.id,
			binding: `{{char:copy-${w.tag}}}`,
			characterId: copyCard.id,
			name: `Copy ${w.tag}`
		})
		void seated
		const ids = [...cardVersions.map((v) => v.id), base!.id]
		expect(
			await testDb
				.select()
				.from(R)
				.where(inArray(R.characterVersionId, ids))
		).toHaveLength(0)
	})

	test("a lorebook duplicate and a timeless copy carry no cast-version rows; the count and the clear see them", async () => {
		const w = await world()
		await memberSave(w.user.id, w.member.id, {
			description: "Her own words.",
			retold: { description: true }
		})
		expect(await countRedlines(db(), { lorebookId: w.book.id })).toBe(1)

		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const copy = await lorebooksDuplicateHandler.handler(
			socketOf(w.user.id),
			{ lorebookId: w.book.id } as any,
			recorder().emit
		)
		const timeless = await lorebooksDuplicateHandler.handler(
			socketOf(w.user.id),
			{ lorebookId: w.book.id, timeless: { branchId: null } } as any,
			recorder().emit
		)
		for (const made of [copy, timeless]) {
			const id = (made as any).lorebook.id as number
			expect(id).not.toBe(w.book.id)
			expect(await countRedlines(db(), { lorebookId: id })).toBe(0)
		}
		expect(await countRedlines(db(), { lorebookId: w.book.id })).toBe(1)

		const { entryRedlineCountHandler, entryClearRedlinesHandler } =
			await import("./redlines")
		const counted = await entryRedlineCountHandler.handler(
			socketOf(w.user.id),
			{ lorebookId: w.book.id },
			recorder().emit
		)
		expect(counted.count).toBe(1)
		const cleared = await entryClearRedlinesHandler.handler(
			socketOf(w.user.id),
			{ lorebookId: w.book.id },
			recorder().emit
		)
		expect(cleared.cleared).toBe(1)
		expect(await rowsOf(w.base.id)).toHaveLength(0)
	})

	test("Share as a lorebook clears a cast version's rows", async () => {
		const w = await world()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: `Shared ${w.tag}`,
				genreId: GENRE
			})
			.returning()
		const { ownBookFor, shareAsLorebook } = await import(
			"$lib/server/lorebooks/ownBook"
		)
		const own = await ownBookFor(db(), session!.id)
		const { base } = await insertCastMember(db(), {
			lorebookId: own.id,
			binding: `{{char:own-${w.tag}}}`,
			name: `Own ${w.tag}`
		})
		await plant(base!.id, w.user.id, { summary: "a" }, { summary: "b" })
		expect(await rowsOf(base!.id)).toHaveLength(1)
		await shareAsLorebook(db(), {
			sessionId: session!.id,
			userId: w.user.id
		})
		expect(await rowsOf(base!.id)).toHaveLength(0)
	})

	test("an overwrite import of a lorebook leaves none", async () => {
		const w = await world()
		const { member, base } = await insertCastMember(db(), {
			lorebookId: w.book.id,
			binding: `{{char:solo-${w.tag}}}`,
			name: `Solo ${w.tag}`,
			summary: "Her own words."
		})
		void member
		await plant(base!.id, w.user.id, { summary: "a" }, { summary: "b" })
		expect(await rowsOf(base!.id)).toHaveLength(1)

		const { buildLorebookExportData } = await import(
			"$lib/server/utils/lorebookExportBuilder"
		)
		const { specBookWithGraph } = await buildLorebookExportData(
			w.book.id,
			w.user.id
		)
		const file = JSON.parse(JSON.stringify(specBookWithGraph))
		file.description = "Changed."
		const { lorebookImportHandler, lorebookImportResolveHandler } =
			await import("./lorebooks")
		const res = await lorebookImportHandler.handler(
			socketOf(w.user.id),
			{ lorebookJson: JSON.stringify(file) } as any,
			recorder().emit
		)
		expect(res.status).toBe("conflict")
		await lorebookImportResolveHandler.handler(
			socketOf(w.user.id),
			{
				heldImportId: res.conflict!.heldImportId,
				action: "overwrite",
				existingId: w.book.id
			} as any,
			recorder().emit
		)
		expect(await countRedlines(db(), { lorebookId: w.book.id })).toBe(0)
	})
})

describe("Admin › Data counts and clears all three kinds together", () => {
	test("an entry row, a card row and a cast row", async () => {
		const w = await world()
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				position: 1,
				title: "Place",
				content: "A place.",
				keys: ["place"]
			} as any)
			.returning()
		await recordRedline(db(), {
			entryId: entry!.id,
			before: { content: "a" },
			after: { content: "b" },
			keys: ["content"],
			cause: "save",
			by: { userId: w.user.id }
		})
		await saveCardAs(w.user.id, { id: w.card.id, description: "Changed." })
		await memberSave(w.user.id, w.member.id, {
			description: "Own.",
			retold: { description: true }
		})

		const { adminRedlineSummaryHandler, adminClearRedlinesHandler } =
			await import("./redlines")
		const total = (await testDb.select().from(R)).length
		expect(total).toBeGreaterThanOrEqual(3)
		const summary = await adminRedlineSummaryHandler.handler(
			socketOf(w.user.id, true),
			undefined as any,
			recorder().emit
		)
		expect(summary.count).toBe(total)
		const cleared = await adminClearRedlinesHandler.handler(
			socketOf(w.user.id, true),
			undefined as any,
			recorder().emit
		)
		expect(cleared.cleared).toBe(total)
		expect(await testDb.select().from(R)).toHaveLength(0)
	})
})
