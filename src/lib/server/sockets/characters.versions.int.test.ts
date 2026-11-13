/**
 * Card versions through the character sockets (lane cv-writers, w1): the
 * editor writes the version it was given (in place, an older one, or a new
 * one), `characters:get` shows a chosen version, a card file is compared with
 * the card's current version and added as a version or saved as a new card,
 * export writes the current version, and every place that makes a card makes
 * its v1.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import encode from "png-chunks-encode"
import extract from "png-chunks-extract"
import text from "png-chunk-text"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

// Strokes are paused (`strokesFlag.ts`): off here, as shipped; the strokes
// block below turns them on for its own tests.
const strokesFlag = vi.hoisted(() => ({ on: false }))
vi.mock("$lib/shared/characters/strokesFlag", () => ({
	get STROKES_ENABLED() {
		return strokesFlag.on
	}
}))

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cv-writers-w1-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `cv-w1-${++n}`)
}
const socketOf = (userId: number) =>
	({ user: { id: userId, isAdmin: false } }) as any
const noopEmit = () => {}

function pngBytes(fill = 255, width = 1): Buffer {
	const png = new PNG({ width, height: 1 })
	png.data.fill(fill)
	return PNG.sync.write(png)
}

async function create(
	userId: number,
	character: Record<string, unknown>,
	avatarFile?: Buffer
) {
	const { charactersCreate } = await import("./characters")
	const res = await charactersCreate.handler(
		socketOf(userId),
		{ character: { description: "", ...character }, avatarFile } as any,
		noopEmit
	)
	return res.character
}

async function update(userId: number, params: Record<string, unknown>) {
	const { charactersUpdate } = await import("./characters")
	return charactersUpdate.handler(socketOf(userId), params as any, noopEmit)
}

async function get(userId: number, id: number, cardVersionId?: number) {
	const { charactersGet } = await import("./characters")
	return charactersGet.handler(
		socketOf(userId),
		{ id, cardVersionId } as any,
		noopEmit
	)
}

async function versionsOf(cardId: number) {
	return testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.cardId, cardId))
		.orderBy(asc(schema.characterVersions.number))
}

async function rowOf(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.characters)
		.where(eq(schema.characters.id, id))
	return row!
}

describe("the editor saves a card version", () => {
	test("in place: the current version changes, no version is added, the copies follow, the row's content stays", async () => {
		const u = await user()
		const { updateCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const c = await create(u.id, {
			name: "Aria",
			description: "first",
			personality: "row personality"
		})
		const [v1] = await versionsOf(c.id)
		expect(v1).toMatchObject({ number: 1, label: "1.0", name: "Aria" })
		// The version, not the row, is where the card is read from.
		await updateCardVersion(testDb, v1.id, {
			personality: "version personality"
		})
		const shown = await get(u.id, c.id)
		expect(shown.character?.personality).toBe("version personality")

		const res = await update(u.id, {
			character: {
				id: c.id,
				name: "Aria II",
				description: "second",
				isFavorite: true
			}
		})
		const versions = await versionsOf(c.id)
		expect(versions).toHaveLength(1)
		expect(versions[0]).toMatchObject({
			name: "Aria II",
			description: "second",
			personality: "version personality"
		})
		const row = await rowOf(c.id)
		// The ⏳ copies follow the current version; the other content columns are frozen.
		expect(row).toMatchObject({
			name: "Aria II",
			description: "second",
			isFavorite: true
		})
		expect(row.personality).toBe("row personality")
		expect(res.cardVersionId).toBe(v1.id)
		expect(res.currentCardVersionId).toBe(v1.id)
		expect(res.cardVersions.map((v: any) => v.number)).toEqual([1])
		expect(res.character.personality).toBe("version personality")
		expect(res.staying).toBeUndefined()
	})

	test("an older version: it changes, the current version and the copies do not", async () => {
		const u = await user()
		const c = await create(u.id, { name: "Bram", description: "one" })
		const [v1] = await versionsOf(c.id)
		const saved = await update(u.id, {
			character: { id: c.id, description: "two" },
			saveAsNewVersion: {}
		})
		const v2Id = saved.cardVersionId
		expect(v2Id).not.toBe(v1.id)

		const res = await update(u.id, {
			character: { id: c.id, description: "one, corrected" },
			cardVersionId: v1.id
		})
		const [old, current] = await versionsOf(c.id)
		expect(old.description).toBe("one, corrected")
		expect(current.description).toBe("two")
		expect((await rowOf(c.id)).description).toBe("two")
		expect(res.cardVersionId).toBe(v1.id)
		expect(res.currentCardVersionId).toBe(v2Id)
		// The reply's card is the current one, whichever version was written.
		expect(res.character.description).toBe("two")
		expect(res.staying).toBeUndefined()
	})

	test("an in-place save of an older version renames that version, not the current one", async () => {
		const u = await user()
		const c = await create(u.id, { name: "Bram", description: "one" })
		const [v1] = await versionsOf(c.id)
		await update(u.id, {
			character: { id: c.id, description: "two" },
			saveAsNewVersion: { label: "2.0" }
		})
		const res = await update(u.id, {
			character: {
				id: c.id,
				description: "one, corrected",
				characterVersion: "1.1"
			},
			cardVersionId: v1.id
		})
		const [old, current] = await versionsOf(c.id)
		expect(old.label).toBe("1.1")
		expect(old.description).toBe("one, corrected")
		expect(current.label).toBe("2.0")
		expect(res.cardVersionId).toBe(v1.id)
		// The library's row keeps the current version's label.
		expect((await rowOf(c.id)).characterVersion).not.toBe("1.1")
	})

	test("an older version's face stays its own when the current version changes its face", async () => {
		const u = await user()
		const c = await create(u.id, { name: "Cato" }, pngBytes())
		const [v1] = await versionsOf(c.id)
		expect(v1.faceMediaId).not.toBeNull()
		expect((await rowOf(c.id)).avatarMediaId).toBe(v1.faceMediaId)
		await update(u.id, { character: { id: c.id }, saveAsNewVersion: {} })
		const other = pngBytes(10, 2)
		const res = await update(u.id, {
			character: { id: c.id },
			cardVersionId: v1.id,
			avatarFile: other
		})
		const [old, current] = await versionsOf(c.id)
		expect(old.faceMediaId).not.toBe(v1.faceMediaId)
		expect(current.faceMediaId).toBe(v1.faceMediaId)
		// The row's copy belongs to the current version.
		expect((await rowOf(c.id)).avatarMediaId).toBe(current.faceMediaId)
		expect(res.cardVersionId).toBe(v1.id)
	})

	test("a version that is not this card's is refused", async () => {
		const u = await user()
		const a = await create(u.id, { name: "Dara" })
		const b = await create(u.id, { name: "Edda" })
		const [bv] = await versionsOf(b.id)
		await expect(
			update(u.id, {
				character: { id: a.id, name: "Changed" },
				cardVersionId: bv.id
			})
		).rejects.toThrow("That version isn't one of this character's.")
		expect((await versionsOf(a.id))[0].name).toBe("Dara")
	})

	test("Save as new version: number + 1, the suggested label, an explicit one, and the members that stay", async () => {
		const u = await user()
		const other = await user()
		const { insertCastMember } = await import(
			"$lib/server/characters/versions"
		)
		const c = await create(u.id, { name: "Fenn", description: "one" })
		const [v1] = await versionsOf(c.id)
		let tokens = 0
		const bookOf = async (userId: number) =>
			(
				await testDb
					.insert(schema.lorebooks)
					.values({ name: "Book", userId })
					.returning()
			)[0].id
		const bookA = await bookOf(u.id)
		const bookB = await bookOf(u.id)
		const foreign = await bookOf(other.id)
		const member = async (lorebookId: number, name: string) =>
			(
				await insertCastMember(testDb, {
					lorebookId,
					binding: `{{char:${++tokens}}}`,
					characterId: c.id,
					name
				})
			).member
		const m1 = await member(bookA, "Fenn in A")
		const m2 = await member(bookB, "Fenn in B")
		await member(foreign, "Fenn elsewhere")

		const res = await update(u.id, {
			character: { id: c.id, description: "two" },
			saveAsNewVersion: {}
		})
		const versions = await versionsOf(c.id)
		expect(versions.map((v) => [v.number, v.label])).toEqual([
			[1, "1.0"],
			[2, "1.1"]
		])
		expect(versions[0].description).toBe("one")
		expect(versions[1].description).toBe("two")
		expect(res.cardVersionId).toBe(versions[1].id)
		expect(res.currentCardVersionId).toBe(versions[1].id)
		expect(res.cardVersions).toEqual(
			versions.map((v) => ({
				id: v.id,
				number: v.number,
				label: v.label
			}))
		)
		expect(res.staying).toEqual([
			{
				castMemberId: m1.id,
				lorebookId: bookA,
				name: "Fenn",
				cardVersionId: v1.id,
				label: "1.0"
			},
			{
				castMemberId: m2.id,
				lorebookId: bookB,
				name: "Fenn",
				cardVersionId: v1.id,
				label: "1.0"
			}
		])
		expect((await rowOf(c.id)).description).toBe("two")

		const explicit = await update(u.id, {
			character: { id: c.id, description: "three" },
			saveAsNewVersion: { label: "Rework" }
		})
		const [, , v3] = await versionsOf(c.id)
		expect(v3).toMatchObject({
			number: 3,
			label: "Rework",
			description: "three"
		})
		expect(explicit.cardVersionId).toBe(v3.id)
		// Still on v1.0 (no member was moved): same two members, newest parent each.
		expect(explicit.staying?.map((s: any) => s.castMemberId)).toEqual([
			m1.id,
			m2.id
		])
	})
})

describe("extensions on a version", () => {
	test("the likeness is merged into the version's; foreign keys survive; a sent plugin mark is dropped and the stored one kept", async () => {
		const u = await user()
		const mark = { plugin: "p", slug: "s", version: "1", uuid: "u" }
		const [card] = await testDb
			.insert(schema.characters)
			.values({
				userId: u.id,
				name: "Quin",
				description: "",
				extensions: {
					foreign: { keep: true },
					serenepub: { provided: mark }
				}
			})
			.returning()
		await update(u.id, {
			character: {
				id: card.id,
				extensions: {
					foreign: { keep: true },
					serenepub: { provided: { plugin: "forged" } }
				}
			},
			likeness: { prompt: "red braid" }
		})
		const [v1] = await versionsOf(card.id)
		expect(v1.likeness).toEqual({ prompt: "red braid" })
		expect(v1.extensions).toEqual({
			foreign: { keep: true },
			serenepub: { provided: mark }
		})
	})
})

describe("strokes follow the version that is written", () => {
	const always = { mode: "always" } as const
	const strokes = [
		{
			kind: "description",
			slug: "body",
			text: "A tall woman.",
			when: always
		},
		{ kind: "description", label: "Eyes", text: "grey", when: always },
		{ kind: "personality", label: "Mood", text: "wry", when: always }
	]

	test("on: prose sent without strokes is recompiled from the version's strokes; empty strokes return it to prose", async () => {
		strokesFlag.on = true
		try {
			const u = await user()
			const c = await create(u.id, {
				name: "Opal",
				description: "",
				strokes
			})
			const [v1] = await versionsOf(c.id)
			expect(v1.strokes).toEqual(strokes)
			expect(v1.description).toBe("A tall woman.\n\nEyes: grey")
			await update(u.id, {
				character: { id: c.id, description: "hand edit over the cache" }
			})
			const [after] = await versionsOf(c.id)
			expect(after.description).toBe("A tall woman.\n\nEyes: grey")
			expect(after.strokes).toEqual(strokes)
			await update(u.id, { character: { id: c.id, strokes: [] } })
			const [cleared] = await versionsOf(c.id)
			expect(cleared.strokes).toEqual([])
			expect(cleared.description).toBe("A tall woman.\n\nEyes: grey")
			expect(cleared.personality).toBe("Mood: wry")
		} finally {
			strokesFlag.on = false
		}
	})

	test("off: a save that writes prose clears the version's strokes", async () => {
		const u = await user()
		const [card] = await testDb
			.insert(schema.characters)
			.values({
				userId: u.id,
				name: "Pia",
				description: "A tall woman.",
				personality: "Mood: wry",
				strokes: strokes as any
			})
			.returning()
		await update(u.id, {
			character: { id: card.id, description: "hand edit wins" }
		})
		const [v1] = await versionsOf(card.id)
		expect(v1).toMatchObject({
			description: "hand edit wins",
			personality: "Mood: wry",
			strokes: []
		})
	})
})

describe("characters:get", () => {
	test("shows the current version by default and a chosen one by its id; lists the versions in order", async () => {
		const u = await user()
		const c = await create(u.id, { name: "Gale", description: "one" })
		const [v1] = await versionsOf(c.id)
		await update(u.id, {
			character: { id: c.id, description: "two" },
			saveAsNewVersion: { label: "2.0" }
		})
		const [, v2] = await versionsOf(c.id)

		const current = await get(u.id, c.id)
		expect(current.character?.description).toBe("two")
		expect(current.character?.characterVersion).toBe("2.0")
		expect(current.cardVersionId).toBe(v2.id)
		expect(current.currentCardVersionId).toBe(v2.id)
		expect(current.cardVersions).toEqual([
			{ id: v1.id, number: 1, label: "1.0" },
			{ id: v2.id, number: 2, label: "2.0" }
		])

		const older = await get(u.id, c.id, v1.id)
		expect(older.character?.description).toBe("one")
		expect(older.character?.characterVersion).toBe("1.0")
		expect(older.cardVersionId).toBe(v1.id)
		expect(older.currentCardVersionId).toBe(v2.id)

		// Another card's version is no version of this one: the current is shown.
		const b = await create(u.id, { name: "Hale", description: "elsewhere" })
		const [bv] = await versionsOf(b.id)
		const stray = await get(u.id, c.id, bv.id)
		expect(stray.cardVersionId).toBe(v2.id)
		expect(stray.character?.description).toBe("two")
	})

	test("the list shows the current version's summary and notes", async () => {
		const u = await user()
		const { updateCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const { buildCharactersList } = await import("./characters")
		const c = await create(u.id, {
			name: "Ivo",
			summary: "row summary",
			creatorNotes: "row notes"
		})
		const [v1] = await versionsOf(c.id)
		await updateCardVersion(testDb, v1.id, {
			summary: "version summary",
			creatorNotes: { text: "version notes", variants: {} }
		})
		const list = await buildCharactersList(u.id)
		const row = list.characterList.find((r) => r.id === c.id)
		expect(row?.summary).toBe("version summary")
		expect(row?.creatorNotes).toBe("version notes")
	})
})

const uuidFor = () => {
	const hex = (++n).toString(16).padStart(12, "0")
	return `7d3f4c52-1d4e-4c0a-9a47-${hex}`
}

function cardFile(over: Record<string, unknown>, uuid: string): string {
	return Buffer.from(
		JSON.stringify({
			spec: "chara_card_v3",
			spec_version: "3.0",
			data: {
				name: "Mira",
				description: "first",
				personality: "calm",
				scenario: "",
				first_mes: "Hi.",
				mes_example: "",
				creator_notes: "",
				system_prompt: "",
				post_history_instructions: "",
				alternate_greetings: [],
				tags: ["a", "b"],
				creator: "me",
				character_version: "1.0",
				// As Serene Pub's own export writes them.
				extensions: {
					depth_prompt: { prompt: "", depth: 4, role: "system" },
					serenepub: { uuid }
				},
				...over
			}
		})
	).toString("base64")
}

describe("importing a card file that is already here", () => {
	test("the same file twice is unchanged; a changed file is a conflict that names the current version", async () => {
		const u = await user()
		const uuid = uuidFor()
		const { charactersImportCard } = await import("./characters")
		const first = await charactersImportCard.handler(
			socketOf(u.id),
			{ file: cardFile({}, uuid) },
			noopEmit
		)
		expect(first.status).toBe("created")
		const again = await charactersImportCard.handler(
			socketOf(u.id),
			{ file: cardFile({}, uuid) },
			noopEmit
		)
		expect(again.status).toBe("unchanged")
		expect(again.character?.id).toBe(first.character!.id)

		const [v1] = await versionsOf(first.character!.id)
		const changed = await charactersImportCard.handler(
			socketOf(u.id),
			{
				file: cardFile(
					{ description: "second", character_version: "2.0" },
					uuid
				)
			},
			noopEmit
		)
		expect(changed.status).toBe("conflict")
		expect(changed.conflict?.currentVersion).toEqual({
			id: v1.id,
			number: 1,
			label: "1.0"
		})
		expect(changed.conflict?.suggestedLabel).toBe("2.0")
		expect(changed.conflict?.existingCharacter.id).toBe(first.character!.id)

		// A file with no (or the same) label is offered the bumped current one.
		const bare = await charactersImportCard.handler(
			socketOf(u.id),
			{
				file: cardFile(
					{ description: "second", character_version: "" },
					uuid
				)
			},
			noopEmit
		)
		expect(bare.conflict?.suggestedLabel).toBe("1.1")
		// A changed tag or creator is a difference too.
		const tagged = await charactersImportCard.handler(
			socketOf(u.id),
			{ file: cardFile({ tags: ["a"] }, uuid) },
			noopEmit
		)
		expect(tagged.status).toBe("conflict")
	})

	test("a card's own export, imported back, is unchanged (and again after a new version)", async () => {
		const u = await user()
		const { charactersExportCard, charactersImportCard } = await import(
			"./characters"
		)
		const c = await create(u.id, {
			name: "Nell",
			nickname: "N",
			aliases: ["Nellie"],
			summary: "A short line.",
			description: "Described.",
			personality: "Wry.",
			scenario: "A road.",
			firstMessage: "Hello.",
			alternateGreetings: ["Hi.", "Hey."],
			groupOnlyGreetings: ["Hello all."],
			exampleDialogues: ["a", "b"],
			postHistoryInstructions: "Stay.",
			creatorNotes: "Notes.",
			creator: "me",
			tags: ["x", "y"]
		})
		const exportJson = async () =>
			(
				await charactersExportCard.handler(
					socketOf(u.id),
					{ id: c.id, format: "json" },
					noopEmit
				)
			).blob.toString("base64")
		const back = await charactersImportCard.handler(
			socketOf(u.id),
			{ file: await exportJson() },
			noopEmit
		)
		expect(back.status).toBe("unchanged")
		await update(u.id, {
			character: { id: c.id, personality: "Wry, and kind." },
			saveAsNewVersion: {}
		})
		const again = await charactersImportCard.handler(
			socketOf(u.id),
			{ file: await exportJson() },
			noopEmit
		)
		expect(again.status).toBe("unchanged")
	})

	test("Add as a new version: the file's label, v1 untouched; the file is then unchanged", async () => {
		const u = await user()
		const uuid = uuidFor()
		const { charactersImportCard, charactersImportResolve } = await import(
			"./characters"
		)
		const first = await charactersImportCard.handler(
			socketOf(u.id),
			{ file: cardFile({}, uuid) },
			noopEmit
		)
		const id = first.character!.id
		const file = cardFile(
			{ description: "second", character_version: "2.0", creator: "you" },
			uuid
		)
		const conflict = await charactersImportCard.handler(
			socketOf(u.id),
			{ file },
			noopEmit
		)
		const res = await charactersImportResolve.handler(
			socketOf(u.id),
			{
				action: "addVersion",
				heldImportId: conflict.conflict!.heldImportId,
				existingId: id
			} as any,
			noopEmit
		)
		const [v1, v2] = await versionsOf(id)
		expect(v1).toMatchObject({
			number: 1,
			label: "1.0",
			description: "first"
		})
		expect(v2).toMatchObject({
			number: 2,
			label: "2.0",
			description: "second"
		})
		expect(res.cardVersionId).toBe(v2.id)
		expect(res.character.description).toBe("second")
		expect(await rowOf(id)).toMatchObject({
			name: "Mira",
			description: "second",
			creator: "you"
		})

		const settled = await charactersImportCard.handler(
			socketOf(u.id),
			{ file },
			noopEmit
		)
		expect(settled.status).toBe("unchanged")
	})

	test("the old Overwrite is read as Add as a new version, with the suggested label or the one sent", async () => {
		const u = await user()
		const uuid = uuidFor()
		const { charactersImportCard, charactersImportResolve } = await import(
			"./characters"
		)
		const first = await charactersImportCard.handler(
			socketOf(u.id),
			{ file: cardFile({}, uuid) },
			noopEmit
		)
		const id = first.character!.id
		const resolve = async (
			over: Record<string, unknown>,
			extra: Record<string, unknown> = {}
		) => {
			const conflict = await charactersImportCard.handler(
				socketOf(u.id),
				{ file: cardFile(over, uuid) },
				noopEmit
			)
			expect(conflict.status).toBe("conflict")
			return charactersImportResolve.handler(
				socketOf(u.id),
				{
					heldImportId: conflict.conflict!.heldImportId,
					existingId: id,
					...extra
				} as any,
				noopEmit
			)
		}
		await resolve(
			{ description: "second", character_version: "" },
			{ action: "overwrite" }
		)
		await resolve(
			{ description: "third", character_version: "" },
			{ action: "overwrite", label: "Mine" }
		)
		const versions = await versionsOf(id)
		expect(versions.map((v) => [v.number, v.label, v.description])).toEqual(
			[
				[1, "1.0", "first"],
				[2, "1.1", "second"],
				[3, "Mine", "third"]
			]
		)
	})

	test("Save as a new card: a new card with its own v1; the existing card is untouched", async () => {
		const u = await user()
		const uuid = uuidFor()
		const { charactersImportCard, charactersImportResolve } = await import(
			"./characters"
		)
		const first = await charactersImportCard.handler(
			socketOf(u.id),
			{ file: cardFile({}, uuid) },
			noopEmit
		)
		const conflict = await charactersImportCard.handler(
			socketOf(u.id),
			{
				file: cardFile(
					{ description: "second", character_version: "2.0" },
					uuid
				)
			},
			noopEmit
		)
		const res = await charactersImportResolve.handler(
			socketOf(u.id),
			{
				action: "createNew",
				heldImportId: conflict.conflict!.heldImportId,
				existingId: first.character!.id
			} as any,
			noopEmit
		)
		expect(res.character.id).not.toBe(first.character!.id)
		const made = await versionsOf(res.character.id)
		expect(made).toHaveLength(1)
		expect(made[0]).toMatchObject({
			number: 1,
			label: "2.0",
			description: "second",
			name: "Mira"
		})
		expect(await versionsOf(first.character!.id)).toHaveLength(1)
	})

	test("a card made from a file has its creator notes' language on v1", async () => {
		const u = await user()
		const { charactersImportCard } = await import("./characters")
		const res = await charactersImportCard.handler(
			socketOf(u.id),
			{
				file: cardFile(
					{
						creator_notes: "Hello",
						creator_notes_multilingual: { en: "Hello", fr: "Salut" }
					},
					uuidFor()
				)
			},
			noopEmit
		)
		const [v1] = await versionsOf(res.character!.id)
		expect(v1.creatorNotes).toEqual({
			text: "Hello",
			lang: "en",
			variants: { fr: "Salut" }
		})
	})
})

describe("export", () => {
	test("writes the current version, after a Save as new version", async () => {
		const u = await user()
		const { charactersExportCard } = await import("./characters")
		const c = await create(u.id, { name: "Jory", description: "old text" })
		await update(u.id, {
			character: {
				id: c.id,
				name: "Jory the Second",
				description: "new text"
			},
			saveAsNewVersion: {}
		})
		const out = await charactersExportCard.handler(
			socketOf(u.id),
			{ id: c.id, format: "json" },
			noopEmit
		)
		const card = JSON.parse(Buffer.from(out.blob).toString("utf-8"))
		expect(card.data.name).toBe("Jory the Second")
		expect(card.data.description).toBe("new text")
	})
})

describe("every place that makes a card makes its v1", () => {
	test("characters:create, with a face", async () => {
		const u = await user()
		const c = await create(
			u.id,
			{ name: "Kell", description: "made", characterVersion: "0.9" },
			pngBytes()
		)
		const versions = await versionsOf(c.id)
		expect(versions).toHaveLength(1)
		expect(versions[0]).toMatchObject({
			number: 1,
			label: "0.9",
			name: "Kell",
			description: "made"
		})
		const row = await rowOf(c.id)
		expect(row.avatarMediaId).not.toBeNull()
		expect(versions[0].faceMediaId).toBe(row.avatarMediaId)
	})

	test("characters:duplicate: v1 is the original's CURRENT content, with its own face", async () => {
		const u = await user()
		const { charactersDuplicate } = await import("./characters")
		const c = await create(
			u.id,
			{ name: "Lund", description: "one", personality: "p1" },
			pngBytes()
		)
		await update(u.id, {
			character: { id: c.id, description: "two", personality: "p2" },
			saveAsNewVersion: { label: "2.0" }
		})
		const res = (await charactersDuplicate.handler(
			socketOf(u.id),
			{ characterId: c.id },
			noopEmit
		)) as any
		expect(res.character.id).not.toBe(c.id)
		const versions = await versionsOf(res.character.id)
		expect(versions).toHaveLength(1)
		expect(versions[0]).toMatchObject({
			number: 1,
			label: "2.0",
			name: "Lund",
			description: "two",
			personality: "p2"
		})
		expect(versions[0].faceMediaId).not.toBeNull()
		expect(versions[0].faceMediaId).toBe(
			(await rowOf(res.character.id)).avatarMediaId
		)
	})

	test("characters:setAvatar sets the current version's face", async () => {
		const u = await user()
		const { charactersSetAvatar } = await import("./characters")
		const c = await create(u.id, { name: "Moss" })
		await update(u.id, { character: { id: c.id }, saveAsNewVersion: {} })
		const { createMedia } = await import("$lib/server/media")
		const { file } = await createMedia(testDb, {
			userId: u.id,
			characterId: c.id,
			bytes: pngBytes(30, 3)
		})
		await charactersSetAvatar.handler(
			socketOf(u.id),
			{ characterId: c.id, mediaId: file.id },
			noopEmit
		)
		const [v1, v2] = await versionsOf(c.id)
		expect(v2.faceMediaId).toBe(file.id)
		expect(v1.faceMediaId).toBeNull()
		expect((await rowOf(c.id)).avatarMediaId).toBe(file.id)
	})
})

// ── SillyTavern folder import: a character and a persona each get a v1 ───────

function cardPng(name: string): Buffer {
	const chunks = extract(pngBytes())
	const card = {
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name,
			description: `${name}.`,
			personality: "",
			scenario: "",
			first_mes: "Hello.",
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
	}
	chunks.splice(
		chunks.findIndex((c) => c.name === "IEND"),
		0,
		text.encode(
			"chara",
			Buffer.from(JSON.stringify(card)).toString("base64")
		)
	)
	return Buffer.from(encode(chunks))
}

const ROOT = "data/default-user"

async function importTree(
	userId: number,
	files: Record<string, string | Buffer>
) {
	const {
		importStartSillyTavernSession,
		importStageSillyTavernFiles,
		importScanSillyTavern,
		importExecuteSillyTavern
	} = await import("./import")
	const socket = { user: { id: userId, isAdmin: true } } as any
	const { importSessionId } = await importStartSillyTavernSession.handler(
		socket,
		{},
		noopEmit
	)
	const manifest: Array<{ relativePath: string; length: number }> = []
	const chunks: Buffer[] = []
	for (const [rel, contents] of Object.entries(files)) {
		const buf = Buffer.from(contents)
		manifest.push({ relativePath: `${ROOT}/${rel}`, length: buf.length })
		chunks.push(buf)
	}
	const staged = await importStageSillyTavernFiles.handler(
		socket,
		{
			importSessionId: importSessionId!,
			manifest,
			blob: Buffer.concat(chunks)
		},
		noopEmit
	)
	expect(staged.success).toBe(true)
	const scan = await importScanSillyTavern.handler(
		socket,
		{ importSessionId: importSessionId!, deferredSessionPaths: [] },
		noopEmit
	)
	expect(scan.success).toBe(true)
	return importExecuteSillyTavern.handler(
		socket,
		{ importSessionId: importSessionId!, selectedData: scan.data! },
		noopEmit
	)
}

describe("the SillyTavern folder import", () => {
	test("a character and a persona each get a v1, with their faces", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"settings.json": JSON.stringify({
				power_user: {
					personas: { "user-default.png": "Jody" },
					persona_descriptions: {
						"user-default.png": {
							description: "The one asking.",
							position: 0
						}
					}
				}
			}),
			"User Avatars/user-default.png": pngBytes(),
			"characters/Aria.png": cardPng("Aria")
		})
		expect(result.errors ?? []).toEqual([])
		for (const [name, description] of [
			["Aria", "Aria."],
			["Jody", "The one asking."]
		]) {
			const [row] = await testDb
				.select()
				.from(schema.characters)
				.where(eq(schema.characters.name, name))
			const versions = await versionsOf(row.id)
			expect(versions).toHaveLength(1)
			expect(versions[0]).toMatchObject({ number: 1, name, description })
			expect(row.avatarMediaId).not.toBeNull()
			expect(versions[0].faceMediaId).toBe(row.avatarMediaId)
		}
	})
})
