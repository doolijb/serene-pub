/**
 * 🚧 Every starter copies its people card-less (S4, plan §34.2; owner
 * 2026-11-05): from a primer, from an admin's kit and from a provided primer
 * row, the asker gains no `characters` row; each copy member keeps the card's
 * words, sprites, gallery and face as its own, owned by the asker; the copy's
 * annotation keys follow the cards to the members; the kit itself is untouched.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq, inArray } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		...actual,
		db,
		getCryptoSecretKey: () => "starter-cardless-test-secret"
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const VIS_PRIMER = "core:primer/vis-itineris@1"
const quiet = (() => {}) as any
const db = () => testDb as unknown as Db
const socket = (userId: number, isAdmin = false) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin, username: `u${userId}` },
		emit: vi.fn(),
		io: {
			sockets: {
				adapter: { rooms: { get: () => undefined } },
				sockets: { get: () => undefined, values: () => [].values() }
			},
			to: () => ({ emit: () => {} }),
			in: () => ({ fetchSockets: async () => [] })
		}
	}) as any

let adminId: number
let kitOwner: number
let asker: number
let n = 0

const png = (seed: number) => {
	const p = new PNG({ width: 1, height: 1 })
	p.data[0] = seed
	p.data[1] = 255
	p.data[2] = 255
	p.data[3] = 255
	return PNG.sync.write(p)
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-starter-cardless-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	adminId = (await testDb.query.users.findFirst({
		where: (u, { eq }) => eq(u.isAdmin, true),
		orderBy: (u, { asc }) => [asc(u.id)]
	}))!.id
	kitOwner = (await createTestUser(testDb, "cardless-kit-owner")).id
	asker = (await createTestUser(testDb, "cardless-asker")).id
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const cardsOf = async (userId: number) =>
	(
		await testDb
			.select({ id: schema.characters.id })
			.from(schema.characters)
			.where(eq(schema.characters.userId, userId))
	).length

const membersOf = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
		.orderBy(asc(schema.lorebookBindings.id))

/** Every version of every member: no follows, no parent; the member has no card. */
async function expectCardless(lorebookId: number) {
	const members = await membersOf(lorebookId)
	expect(members.length).toBeGreaterThan(0)
	for (const m of members) {
		expect(m.characterId).toBeNull()
		const versions = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.castMemberId, m.id))
		expect(versions.length).toBeGreaterThan(0)
		for (const v of versions) {
			expect(v.follows).toEqual([])
			expect(v.parentVersionId).toBeNull()
		}
	}
	return members
}

/** An admin kit: a book with Ivo (a card with a sprite, a gallery picture and a face), Mara, and a card-less Ola; annotations on its entry. (A book binds a card once, so no card is shared by two members.) */
async function adminKit() {
	const {
		insertCard,
		insertCastMember,
		ensureCardVersion,
		updateCardVersion
	} = await import("$lib/server/characters/versions")
	const { createMedia } = await import("$lib/server/media")
	const { addSprite } = await import("$lib/server/sprites")
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: kitOwner,
			name: `Cardless kit ${++n}`,
			kind: "starter_kit",
			primaryRuleset: "core:ruleset/freeform@1"
		})
		.returning()
	const { card: ivo } = await insertCard(db(), {
		userId: kitOwner,
		name: "Ivo",
		description: "A ferryman."
	})
	const face = await createMedia(testDb as any, {
		userId: kitOwner,
		characterId: ivo.id,
		bytes: png(11)
	})
	const current = (await ensureCardVersion(db(), ivo.id))!
	await updateCardVersion(db(), current.id, { faceMediaId: face.file.id })
	await createMedia(testDb as any, {
		userId: kitOwner,
		characterId: ivo.id,
		bytes: png(12)
	})
	await addSprite(db(), {
		characterId: ivo.id,
		userId: kitOwner,
		label: "happy",
		bytes: png(13),
		source: "upload"
	} as any)
	const { card: mara } = await insertCard(db(), {
		userId: kitOwner,
		name: "Mara",
		description: "A net-mender."
	})
	const mk = (characterId: number | null, name: string) =>
		insertCastMember(db(), {
			lorebookId: book.id,
			characterId,
			binding: `{{char:${++n}}}`,
			name,
			...(characterId == null
				? { description: `${name}, own words.` }
				: {})
		}).then((r) => r.member)
	const mIvo = await mk(ivo.id, "Ivo")
	const mMara = await mk(mara.id, "Mara")
	const mOla = await mk(null, "Ola")
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book.id,
			typeId: "core:entry/world-lore",
			typeVersion: 1,
			position: 0,
			title: "The ferry",
			content: "Ivo, Mara and Ola at the ferry."
		})
		.returning()
	// A member of another book, whose key the copy cannot map.
	const [other] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: kitOwner, name: `Elsewhere ${++n}` })
		.returning()
	const stray = await insertCastMember(db(), {
		lorebookId: other.id,
		characterId: null,
		binding: `{{char:${++n}}}`,
		name: "Stray"
	}).then((r) => r.member)
	const keys = [
		[`character:${ivo.id}`, ivo.id],
		[`character:${mara.id}`, mara.id],
		[`cast_member:${mOla.id}`, null],
		[`cast_member:${stray.id}`, null]
	] as const
	await testDb.insert(schema.entryAnnotations).values(
		keys.map(([entityKey, characterId]) => ({
			entryId: entry.id,
			entityKey,
			surface: entityKey,
			normalized: entityKey,
			tier: "gazetteer",
			characterId,
			extractorVersion: "t",
			sourceHash: "s",
			gazetteerHash: "g"
		}))
	)
	return { book, ivo, mara, mIvo, mMara, mOla, stray, entry }
}

describe("a copy's cast is card-less", () => {
	test("from a primer: the asker gains no card, the members hold the primer's words", async () => {
		const { lorebooksCreateHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const before = await cardsOf(asker)
		const made: any = await lorebooksCreateHandler.handler(
			socket(asker),
			{ name: "Primer start", starterKit: { primerId: VIS_PRIMER } },
			quiet
		)
		expect(made.error).toBeUndefined()
		expect(await cardsOf(asker)).toBe(before)
		const members = await expectCardless(made.lorebook.id)
		const { getPrimer } = await import("@serene-pub/sdk")
		const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
		for (const m of members) {
			const decl = getPrimer(VIS_PRIMER)!.content.cast.find(
				(c) => c.name === m.name
			)!
			const read = await memberAsRead(db(), m.id)
			expect(read).toMatchObject({
				name: decl.name,
				description: decl.description
			})
		}
	})

	test("from another admin's kit: no card, the words, sprites, gallery and face are the asker's own, the annotations follow, the kit is unchanged", async () => {
		const { lorebooksCreateHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
		const kit = await adminKit()
		const kitMembersBefore = await membersOf(kit.book.id)
		const kitCardsBefore = await cardsOf(kitOwner)
		const kitAnnotationsBefore = await testDb
			.select()
			.from(schema.entryAnnotations)
			.where(eq(schema.entryAnnotations.entryId, kit.entry.id))
		const before = await cardsOf(asker)

		const made: any = await lorebooksCreateHandler.handler(
			socket(asker),
			{ name: "From the kit", starterKit: { lorebookId: kit.book.id } },
			quiet
		)
		expect(made.error).toBeUndefined()
		expect(await cardsOf(asker)).toBe(before)
		const members = await expectCardless(made.lorebook.id)
		expect(members).toHaveLength(3)
		const byName = (name: string) => members.find((m) => m.name === name)!

		// The words read as the card's.
		expect(await memberAsRead(db(), byName("Ivo").id)).toMatchObject({
			name: "Ivo",
			description: "A ferryman."
		})
		expect(await memberAsRead(db(), byName("Mara").id)).toMatchObject({
			description: "A net-mender."
		})
		expect(await memberAsRead(db(), byName("Ola").id)).toMatchObject({
			description: "Ola, own words."
		})

		// Sprites, gallery and face are on the member, in files the asker owns.
		const ivo = byName("Ivo")
		const sets = await testDb
			.select()
			.from(schema.spriteSets)
			.where(eq(schema.spriteSets.castMemberId, ivo.id))
		expect(sets.length).toBeGreaterThan(0)
		const sprites = await testDb
			.select()
			.from(schema.sprites)
			.where(
				inArray(
					schema.sprites.spriteSetId,
					sets.map((s) => s.id)
				)
			)
		expect(sprites.map((s) => s.label)).toContain("happy")
		const gallery = await testDb
			.select({ fileId: schema.castMemberFiles.fileId })
			.from(schema.castMemberFiles)
			.where(eq(schema.castMemberFiles.castMemberId, ivo.id))
		// The face file and the gallery picture (the sprite is not a gallery picture).
		expect(gallery).toHaveLength(2)
		const [base] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.castMemberId, ivo.id))
			.orderBy(asc(schema.characterVersions.id))
		expect(base.faceMediaId).not.toBeNull()
		const fileIds = [
			...sprites.map((s) => s.fileId!),
			...gallery.map((g) => g.fileId),
			base.faceMediaId!
		]
		const files = await testDb
			.select()
			.from(schema.files)
			.where(inArray(schema.files.id, fileIds))
		expect(files).toHaveLength(new Set(fileIds).size)
		expect(files.every((f) => f.userId === asker)).toBe(true)

		// Annotations: a card names its member; a member key is remapped to the copy's member, an unmapped one dropped.
		const entries = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, made.lorebook.id))
		expect(entries).toHaveLength(1)
		const keys = (
			await testDb
				.select()
				.from(schema.entryAnnotations)
				.where(eq(schema.entryAnnotations.entryId, entries[0].id))
		).sort((a, b) => a.entityKey.localeCompare(b.entityKey))
		expect(keys.map((k) => k.entityKey).sort()).toEqual(
			[
				`cast_member:${ivo.id}`,
				`cast_member:${byName("Mara").id}`,
				`cast_member:${byName("Ola").id}`
			].sort()
		)
		expect(
			keys.find((k) => k.entityKey === `cast_member:${ivo.id}`)!
				.characterId
		).toBeNull()

		// The kit row is as it was: members still linked to their cards.
		expect(await membersOf(kit.book.id)).toEqual(kitMembersBefore)
		expect(await cardsOf(kitOwner)).toBe(kitCardsBefore)
		expect(
			await testDb
				.select()
				.from(schema.entryAnnotations)
				.where(eq(schema.entryAnnotations.entryId, kit.entry.id))
		).toEqual(kitAnnotationsBefore)
		expect(kitMembersBefore.map((m) => m.characterId)).toEqual([
			kit.ivo.id,
			kit.mara.id,
			null
		])
	})

	test("the asker's own cards are made card-less too (a kit of their own)", async () => {
		const { lorebooksCreateHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const { insertCard, insertCastMember } = await import(
			"$lib/server/characters/versions"
		)
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: asker, name: "Own kit", kind: "starter_kit" })
			.returning()
		const { card } = await insertCard(db(), {
			userId: asker,
			name: "Own",
			description: "Mine."
		})
		await insertCastMember(db(), {
			lorebookId: book.id,
			characterId: card.id,
			binding: "{{char:1}}",
			name: "Own"
		})
		const before = await cardsOf(asker)
		const made: any = await lorebooksCreateHandler.handler(
			socket(asker),
			{ name: "Own copy", starterKit: { lorebookId: book.id } },
			quiet
		)
		expect(made.error).toBeUndefined()
		expect(await cardsOf(asker)).toBe(before)
		await expectCardless(made.lorebook.id)
	})

	test("from a provided primer row: the row is untouched, the copy card-less", async () => {
		const { syncProvidedPrimers } = await import(
			"$lib/server/plugins/providedPrimers"
		)
		await syncProvidedPrimers(db(), { version: "1.0.0" })
		const { primerRowOf } = await import("./starterKits")
		const row = (await primerRowOf(db(), VIS_PRIMER))!
		expect(row).toBeTruthy()
		const rowMembers = await membersOf(row.row.id)
		const { lorebooksCreateHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const before = await cardsOf(asker)
		const made: any = await lorebooksCreateHandler.handler(
			socket(asker),
			{ name: "From the row", starterKit: { lorebookId: row.row.id } },
			quiet
		)
		expect(made.error).toBeUndefined()
		expect(await cardsOf(asker)).toBe(before)
		await expectCardless(made.lorebook.id)
		expect(await membersOf(row.row.id)).toEqual(rowMembers)
	})

	test("a session from a kit: the notes' members are card-less, and seat by castMemberIds with no card", async () => {
		const { sessionsCreateHandler, sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const kit = await adminKit()
		const before = await cardsOf(asker)
		const res: any = await sessionsCreateHandler.handler(
			socket(asker),
			{
				session: { name: "Kit run", genreId: "core:genre/story" },
				characterIds: [],
				personaIds: [],
				characterPositions: {},
				starterKit: { lorebookId: kit.book.id }
			} as any,
			quiet
		)
		expect(res?.error, res?.error).toBeUndefined()
		expect(await cardsOf(asker)).toBe(before)
		const { ownBookOf } = await import("./ownBook")
		const notes = (await ownBookOf(db(), res.session.id))!
		const members = await expectCardless(notes.id)
		await sessionsUpdateHandler.handler(
			socket(asker),
			{
				session: { id: res.session.id },
				characterIds: [],
				castMemberIds: members.map((m) => m.id)
			} as any,
			quiet
		)
		const seats = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, res.session.id))
		expect(seats.map((s) => s.castMemberId).sort()).toEqual(
			members.map((m) => m.id).sort()
		)
		expect(seats.every((s) => s.characterId === null)).toBe(true)
		expect(await cardsOf(asker)).toBe(before)
	})
})

describe("remapEntityKey", () => {
	test("an entry or cast member key follows its map; a key the map lacks is dropped; the rest is kept", async () => {
		const { remapEntityKey } = await import("./tableRegistry")
		const maps = {
			entries: new Map([[1, 10]]),
			bindings: new Map([[5, 50]])
		}
		expect(remapEntityKey("entry:1", maps)).toBe("entry:10")
		expect(remapEntityKey("entry:2", maps)).toBeNull()
		expect(remapEntityKey("cast_member:5", maps)).toBe("cast_member:50")
		expect(remapEntityKey("cast_member:6", maps)).toBeNull()
		expect(remapEntityKey("character:5", maps)).toBe("character:5")
		expect(remapEntityKey("open:the riders", maps)).toBe("open:the riders")
	})
})
