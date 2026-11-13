/**
 * ★S4-1 (2026-11-08): a provided book's plugin-stamped carrier cards are hidden
 * from every library, picker and search (`genuineProvidedMarkSql`), while the
 * book's members stay linked to them and still read their words.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
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

const db = () => testDb as unknown as Db
const TAG = "Zephyrine"
const CARRIER = `${TAG} Carrier`
const PLAIN = `${TAG} Plain`
const REIMPORT = `${TAG} Reimport`

let admin: number
let other: number
let carrierId: number
let plainId: number
let reimportId: number
let memberId: number
let folderId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-hidden-carrier-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1, isAccountsEnabled: true })
		.onConflictDoUpdate({
			target: schema.systemSettings.id,
			set: { isAccountsEnabled: true, messagingEnabled: true }
		})

	const mkUser = async (name: string, isAdmin: boolean) =>
		(
			await testDb
				.insert(schema.users)
				.values({ username: name, isAdmin })
				.returning()
		)[0]!.id
	admin = await mkUser("hidden-carrier-admin", true)
	other = await mkUser("hidden-carrier-other", false)

	const [folder] = await testDb
		.insert(schema.characterFolders)
		.values({ userId: admin, name: "Shelf" })
		.returning()
	folderId = folder!.id

	const card = async (name: string) =>
		(
			await insertCard(db(), {
				userId: admin,
				name,
				description: `${name} of the vale.`,
				folderId
			})
		).card
	const carrier = await card(CARRIER)
	const plain = await card(PLAIN)
	const reimport = await card(REIMPORT)
	carrierId = carrier.id
	plainId = plain.id
	reimportId = reimport.id

	const mark = (uuid: string) => ({
		serenepub: {
			provided: { plugin: "acme", slug: "vale", version: "1.0.0", uuid }
		}
	})
	await testDb
		.update(schema.characters)
		.set({ extensions: mark(carrier.uuid) })
		.where(eq(schema.characters.id, carrierId))
	await testDb
		.update(schema.characters)
		.set({ extensions: mark("00000000-0000-4000-8000-000000000000") })
		.where(eq(schema.characters.id, reimportId))

	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: admin, name: "Provided vale" })
		.returning()
	await testDb
		.update(schema.lorebooks)
		.set({
			extraJson: {
				provided: {
					plugin: "acme",
					slug: "vale",
					version: "1.0.0",
					sha256: "x",
					uuid: book!.uuid,
					entries: {}
				}
			}
		})
		.where(eq(schema.lorebooks.id, book!.id))
	const { member } = await insertCastMember(db(), {
		lorebookId: book!.id,
		characterId: carrierId,
		binding: "{{char:hidden-carrier}}",
		name: CARRIER
	})
	memberId = member.id

	for (const id of [carrierId, plainId, reimportId])
		await testDb
			.insert(schema.characterShares)
			.values({ characterId: id, userId: other })
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const seesPlain = (names: (string | undefined)[]) => {
	expect(names).toContain(PLAIN)
	expect(names).toContain(REIMPORT)
	expect(names).not.toContain(CARRIER)
}

describe("hidden carrier cards (★S4-1)", () => {
	test("characters:list leaves the carrier out, for the owner and for a share", async () => {
		const { buildCharactersList } = await import(
			"$lib/server/sockets/characters"
		)
		const mine = (await buildCharactersList(admin)).characterList
		seesPlain(mine.map((c) => c.name))
		const shared = (await buildCharactersList(other)).characterList
		seesPlain(shared.map((c) => c.name))
		expect(shared.every((c) => c.isSharedWithMe)).toBe(true)
	})

	test("jump search leaves it out", async () => {
		const { jumpSearch } = await import("$lib/server/sockets/jump")
		const res = await jumpSearch.handler(
			{
				id: "hidden-carrier-socket",
				user: { id: admin, isAdmin: true }
			} as any,
			{ query: TAG },
			() => {}
		)
		const hits =
			res!.groups
				.find((g) => g.kind === "character")
				?.hits.map((h) => h.title) ?? []
		seesPlain(hits)
	})

	test("folder counts match the list", async () => {
		const { characterFoldersList } = await import(
			"$lib/server/sockets/characterFolders"
		)
		const listed = await characterFoldersList.handler(
			{ id: "s", user: { id: admin, isAdmin: true } } as any,
			{},
			() => {}
		)
		const f = listed.folders.find((x: any) => x.id === folderId)
		expect(f?.characterCount).toBe(2)
	})

	test("the applet library leaves it out", async () => {
		const { runLibraryCharacters } = await import(
			"$lib/server/sockets/appletLibrary"
		)
		const out = await runLibraryCharacters(
			{
				pluginId: "acme",
				person: { userId: admin, isAdmin: true, via: "press" },
				grant: {} as any,
				ownGenres: []
			} as any,
			{ limit: 50 } as any
		)
		seesPlain(out.rows.map((r) => r.name))
	})

	test("the attach picker and the person's list leave it out", async () => {
		const store = await import("$lib/server/conversations/store")
		const picked = await store.attachable(db(), admin, {
			kind: "character",
			q: TAG
		} as any)
		const ids = picked.candidates.map((c) => c.subjectId)
		expect(ids).toContain(plainId)
		expect(ids).toContain(reimportId)
		expect(ids).not.toContain(carrierId)

		const p = await store.person(db(), other, { userId: admin })
		const seen = p.characters.map((c) => c.id)
		expect(seen).toContain(plainId)
		expect(seen).toContain(reimportId)
		expect(seen).not.toContain(carrierId)
	})

	test("the Characters view page still leaves it out", async () => {
		const { characterRowsPage } = await import(
			"$lib/server/cast/characterRows"
		)
		const page = await characterRowsPage(db(), admin, {
			filters: { q: TAG } as any
		})
		const names = page.rows.map((r: any) => r.name)
		expect(names).not.toContain(CARRIER)
	})

	test("the provided book's member stays linked and reads its words", async () => {
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		const read = (await membersAsRead(db(), [memberId])).get(memberId)
		expect(read?.name).toBe(CARRIER)
		expect(read?.description).toBeTruthy()
		const [row] = await testDb
			.select({ characterId: schema.lorebookBindings.characterId })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, memberId))
		expect(row!.characterId).toBe(carrierId)
	})
})
