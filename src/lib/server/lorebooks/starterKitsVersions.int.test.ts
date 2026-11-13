/**
 * Starter lorebooks on card and cast versions (plan §32, lane cv-writers w3):
 * a primer's cast gets a v1 and a base each; a copy of another person's kit
 * makes each card from the original's CURRENT version, and the copied members
 * read the same text as before the copy.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq, isNull } from "drizzle-orm"
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
		getCryptoSecretKey: () => "starter-kits-versions-test-secret"
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const quiet = (() => {}) as any
const db = () => testDb as unknown as Db

const socket = (userId: number, isAdmin = false) =>
	({
		user: { id: userId, isAdmin, username: `u${userId}` },
		io: {
			sockets: {
				adapter: { rooms: { get: () => undefined } },
				sockets: { get: () => undefined, values: () => [].values() }
			},
			to: () => ({ emit: () => {} }),
			in: () => ({ fetchSockets: async () => [] })
		}
	}) as any

let admin: number
let member: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-starter-kits-versions-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	admin = (await createTestUser(testDb, "kv-admin")).id
	member = (await createTestUser(testDb, "kv-member")).id
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const pngBytes = (seed: number) => {
	const png = new PNG({ width: 1, height: 1 })
	png.data[0] = seed
	png.data[1] = 255
	png.data[2] = 255
	png.data[3] = 255
	return PNG.sync.write(png)
}

async function cardVersionsOf(cardId: number) {
	return testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.cardId, cardId))
		.orderBy(asc(schema.characterVersions.number))
}

async function baseOf(memberId: number) {
	const V = schema.characterVersions
	const [base] = await testDb
		.select()
		.from(V)
		.where(
			and(
				eq(V.castMemberId, memberId),
				isNull(V.branchId),
				isNull(V.year),
				isNull(V.personalPosition),
				isNull(V.sourceSessionId)
			)
		)
		.orderBy(asc(V.id))
	return base
}

describe("writePrimerInto", () => {
	test("each cast member gets a base of its own words and no card version", async () => {
		const { getPrimer } = await import("@serene-pub/sdk")
		const { writePrimerInto } = await import("./starterKits")
		const primer = getPrimer("core:primer/vis-itineris@1")!
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: member, name: "Versioned kit target" })
			.returning()
		await testDb.transaction((tx) =>
			writePrimerInto(tx as unknown as Db, {
				lorebookId: book.id,
				userId: member,
				primer
			})
		)
		const members = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, book.id))
		expect(members.length).toBe(primer.content.cast.length)
		for (const m of members) {
			expect(m.characterId).toBeNull()
			const base = await baseOf(m.id)
			const decl = primer.content.cast.find((c) => c.name === m.name)!
			expect(base).toBeTruthy()
			expect(base.parentVersionId).toBeNull()
			expect(base.follows).toEqual([])
			expect(base.name).toBe(decl.name)
			expect(base.description).toBe(decl.description)
		}
	})
})

describe("a copy of another person's kit", () => {
	test("the copy's members are card-less and read what the source members read; the face is the asker's own file", async () => {
		const {
			insertCard,
			insertCastMember,
			newCardVersion,
			ensureCardVersion
		} = await import("$lib/server/characters/versions")
		const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
		const { profileOf } = await import("$lib/shared/characters/profile")
		const { createMedia } = await import("$lib/server/media")
		const { starterKitsSaveFromBookHandler } = await import(
			"$lib/server/sockets/starterKits"
		)
		const { lorebooksCreateHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)

		// The admin's book: Ivo, a card with two versions (the second is current)
		// and a face; one member that follows the card, one that retells its description.
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({
				userId: admin,
				name: "Ferry book",
				primaryRuleset: "core:ruleset/freeform@1"
			})
			.returning()
		const { card } = await insertCard(db(), {
			userId: admin,
			name: "Ivo",
			description: "A ferryman v1.",
			personality: "gruff",
			characterVersion: "1.0"
		})
		const v2 = await newCardVersion(
			db(),
			card.id,
			{
				...profileOf((await ensureCardVersion(db(), card.id))!),
				description: "A ferryman, older.",
				personality: "gruff, kind",
				summary: "Crosses at dusk."
			},
			{ label: "2.0" }
		)
		const original = await createMedia(testDb as any, {
			userId: admin,
			characterId: card.id,
			bytes: pngBytes(7)
		})
		const { updateCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		await updateCardVersion(db(), v2.id, { faceMediaId: original.file.id })

		const { member: follower } = await insertCastMember(db(), {
			lorebookId: book.id,
			characterId: card.id,
			binding: "{{char:1}}",
			name: "Ivo"
		})
		const { card: mara } = await insertCard(db(), {
			userId: admin,
			name: "Mara",
			description: "A net-mender.",
			personality: "wry"
		})
		const { member: retelling } = await insertCastMember(db(), {
			lorebookId: book.id,
			characterId: mara.id,
			binding: "{{char:2}}",
			name: "Mara",
			description: "Mara as the harbour tells it.",
			retold: { description: true }
		})
		const sourceReads = new Map<
			number,
			Awaited<ReturnType<typeof memberAsRead>>
		>()
		for (const m of [follower, retelling])
			sourceReads.set(m.id, await memberAsRead(db(), m.id))
		expect(sourceReads.get(follower.id)!.description).toBe(
			"A ferryman, older."
		)
		expect(sourceReads.get(retelling.id)!.description).toBe(
			"Mara as the harbour tells it."
		)

		const saved: any = await starterKitsSaveFromBookHandler.handler(
			socket(admin, true),
			{ lorebookId: book.id, name: "Ferry kit v" },
			quiet
		)
		const kitId = Number(saved.kit.id.slice("book:".length))
		const made: any = await lorebooksCreateHandler.handler(
			socket(member),
			{
				name: "From the versioned kit",
				starterKit: { lorebookId: kitId }
			},
			quiet
		)
		const copied = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, made.lorebook.id))
			.orderBy(asc(schema.lorebookBindings.id))
		expect(copied.length).toBe(2)
		expect(copied.every((m) => m.characterId === null)).toBe(true)
		expect(
			(
				await testDb
					.select()
					.from(schema.characters)
					.where(eq(schema.characters.userId, member))
			).length
		).toBe(0)

		// The copied members read what the source members read.
		const [copiedFollower, copiedRetelling] = copied
		const reads = [
			await memberAsRead(db(), copiedFollower.id),
			await memberAsRead(db(), copiedRetelling.id)
		]
		for (const [source, copiedRead] of [
			[follower.id, reads[0]],
			[retelling.id, reads[1]]
		] as const) {
			const was = sourceReads.get(source)!
			expect(copiedRead).toMatchObject({
				name: was.name,
				description: was.description,
				personality: was.personality,
				summary: was.summary,
				firstMessage: was.firstMessage
			})
		}
		// Nothing reads through the original any more.
		const copiedBase = await baseOf(copiedFollower.id)
		expect(copiedBase.follows).toEqual([])
		expect(copiedBase.parentVersionId).toBeNull()
		expect(copiedBase.description).toBe("A ferryman, older.")
		for (const m of copied) {
			const mine = await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.castMemberId, m.id))
			for (const row of mine) {
				expect(row.follows).toEqual([])
				expect(row.parentVersionId).toBeNull()
			}
			expect((await memberAsRead(db(), m.id))!.activeCardId).toBeNull()
		}
		// The face is a file of the asker's, not the admin's.
		expect(copiedBase.faceMediaId).not.toBeNull()
		expect(copiedBase.faceMediaId).not.toBe(original.file.id)
		const [face] = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, copiedBase.faceMediaId!))
		expect(face.userId).toBe(member)

		// The original is untouched.
		const [still] = await cardVersionsOf(card.id).then((vs) => vs.slice(-1))
		expect(still.id).toBe(v2.id)
		expect((await baseOf(follower.id)).follows).toContain("description")
	})
})
