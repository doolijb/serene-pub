/**
 * A cast tag names its member (plan A23(a)).
 *
 * An entry is annotated from its stored text, where a cast member can appear
 * only as `{{char:N}}` — the name is written in at the pipeline's read. Read
 * as text, the tag named nobody, so an entry about a member written that way
 * was never linked to them by the entity mechanism. The annotation lane now
 * reads a tag as the member it names, by number: `character:<id>` for a
 * member bound to a live card, nothing for a background member (the
 * vocabulary has nothing for them to resolve to either).
 *
 * The member's name is never read for it, so the stored-text hash stays the
 * whole of what can move the entry's own answer. What else can move it — the
 * member a tag names being bound to another card — is the vocabulary's to
 * notice, and these tests pin that it does.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import crypto from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let seq = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cast-tag-annotations-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `cast-tag-annotations-${seq++}`
	const user = await createTestUser(testDb, label)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: label })
		.returning()
	const card = async (name: string) =>
		(
			await testDb
				.insert(schema.characters)
				.values({ userId: user.id, name, description: "" })
				.returning()
		)[0]!
	const member = async (
		n: number,
		name: string,
		characterId: number | null
	) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: book!.id,
					binding: `{{char:${n}}}`,
					name,
					characterId
				})
				.returning()
		)[0]!
	const entry = async (name: string, content: string) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					worldLoreValues([{ lorebookId: book!.id, name, content }])
				)
				.returning()
		)[0]!
	return { user, book: book!, card, member, entry }
}

async function rowsFor(entryId: number) {
	return await testDb
		.select()
		.from(schema.entryAnnotations)
		.where(eq(schema.entryAnnotations.entryId, entryId))
}

describe("an entry that names a member by cast tag", () => {
	it("is annotated with the member's character", async () => {
		const { book, card, member, entry } = await makeBook()
		const vell = await card("Vellamy")
		await member(1, "Vellamy", vell.id)
		const gate = await entry("East gate", "{{char:1}} keeps the east gate.")

		const { annotateLorebook, entryAnnotationText } = await import(
			"./index"
		)
		await annotateLorebook(testDb as any, book.id)

		const rows = await rowsFor(gate.id)
		const tagged = rows.find((r) => r.entityKey === `character:${vell.id}`)
		expect(tagged, "a character:<id> row for the tag").toBeTruthy()
		expect(tagged!.characterId).toBe(vell.id)
		expect(tagged!.surface).toBe("{{char:1}}")
		// The span is over the stored text the lane read.
		const text = entryAnnotationText(gate)
		const [span] = tagged!.spans as Array<{ start: number; end: number }>
		expect(text.slice(span!.start, span!.end)).toBe("{{char:1}}")
	}, 60_000)

	it("is read back by the entity mechanism", async () => {
		const { book, card, member, entry } = await makeBook()
		const vell = await card("Vellamy")
		await member(1, "Vellamy", vell.id)
		const gate = await entry("East gate", "{{char:1}} keeps the east gate.")

		const { annotateLorebook, loadVocabulary, readEntryAnnotations } =
			await import("./index")
		await annotateLorebook(testDb as any, book.id)
		const index = await readEntryAnnotations(
			testDb as any,
			[gate.id],
			await loadVocabulary(testDb as any, book.id)
		)
		expect(index.get(gate.id)).toContain(`character:${vell.id}`)
	}, 60_000)

	it("counts the tag and the name as one member", async () => {
		const { book, card, member, entry } = await makeBook()
		const vell = await card("Vellamy")
		await member(1, "Vellamy", vell.id)
		const gate = await entry(
			"East gate",
			"{{char:1}} keeps the gate. Vellamy never sleeps."
		)
		const { annotateLorebook } = await import("./index")
		await annotateLorebook(testDb as any, book.id)
		const rows = (await rowsFor(gate.id)).filter(
			(r) => r.entityKey === `character:${vell.id}`
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.mentions).toBe(2)
	}, 60_000)

	it("is annotated the same way by the lane's own unit of work", async () => {
		const { book, card, member, entry } = await makeBook()
		const vell = await card("Vellamy")
		await member(1, "Vellamy", vell.id)
		const gate = await entry("East gate", "{{char:1}} keeps the east gate.")
		const { annotateEntry, loadVocabulary } = await import("./index")
		await annotateEntry(
			testDb as any,
			gate.id,
			await loadVocabulary(testDb as any, book.id)
		)
		expect((await rowsFor(gate.id)).map((r) => r.entityKey)).toContain(
			`character:${vell.id}`
		)
	}, 60_000)

	it("names nobody for a background member or a tag with no member", async () => {
		const { book, member, entry } = await makeBook()
		await member(2, "The ferryman", null)
		const quay = await entry("Quay", "{{char:2}} and {{char:9}} argue.")
		const { annotateLorebook } = await import("./index")
		await annotateLorebook(testDb as any, book.id)
		const keys = (await rowsFor(quay.id)).map((r) => r.entityKey)
		expect(keys.filter((k) => k.startsWith("character:"))).toEqual([])
	}, 60_000)
})

describe("the vocabulary notices what a tag names", () => {
	it("moves when a member who answers to no name of their own is bound to another card", async () => {
		// Two guards: the first claims "Guard", so the second answers to no
		// name of their own and only their tag says who they are.
		const { book, card, member, entry } = await makeBook()
		const first = await card("Guard")
		const second = await card("Guard")
		const third = await card("Watch")
		await member(1, "Guard", first.id)
		const tagged = await member(2, "Guard", second.id)
		const door = await entry("Door", "{{char:2}} watches the door.")

		const { annotateLorebook, loadVocabulary, readEntryAnnotations } =
			await import("./index")
		await annotateLorebook(testDb as any, book.id)
		const before = await loadVocabulary(testDb as any, book.id)
		expect(
			(await readEntryAnnotations(testDb as any, [door.id], before)).get(
				door.id
			)
		).toContain(`character:${second.id}`)

		await testDb
			.update(schema.lorebookBindings)
			.set({ characterId: third.id })
			.where(eq(schema.lorebookBindings.id, tagged.id))
		const after = await loadVocabulary(testDb as any, book.id)
		expect(after.hash).not.toBe(before.hash)
		// The old answer is refused, not read as the new one.
		expect(
			(await readEntryAnnotations(testDb as any, [door.id], after)).get(
				door.id
			)
		).toBeUndefined()

		await annotateLorebook(testDb as any, book.id)
		expect(
			(await readEntryAnnotations(testDb as any, [door.id], after)).get(
				door.id
			)
		).toContain(`character:${third.id}`)
	}, 60_000)

	it("keeps its hash in a book whose members each answer to a name", async () => {
		// Where every member owns a name, a member's card already moves the
		// hash through that name, so the tags add nothing to it and updating
		// re-annotates and re-embeds nothing in such a book.
		const { book, card, member, entry } = await makeBook()
		const vell = await card("Vellamy")
		const cade = await card("Cade")
		await member(1, "Vellamy", vell.id)
		await member(2, "Cade", cade.id)
		await entry("East gate", "{{char:1}} keeps the east gate.")

		const { loadVocabulary } = await import("./index")
		const vocabulary = await loadVocabulary(testDb as any, book.id)
		const namesOnly = crypto
			.createHash("sha256")
			.update(
				[...vocabulary.gazetteer.byName]
					.map(([name, ref]) => `${name}\0${ref.kind}:${ref.id}`)
					.sort()
					.join("\u0001")
			)
			.digest("hex")
			.slice(0, 16)
		expect(vocabulary.hash).toBe(namesOnly)
	}, 60_000)
})
