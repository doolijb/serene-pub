import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lorebooks-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

const minimalCharacterCard = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "Bound Character",
		description: "A bound character",
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
	}
}

async function makeCharacter(userId: number, overrides: Partial<{ name: string }> = {}) {
	const { createCharacterFromParsedData } = await import("./characters")
	return createCharacterFromParsedData(
		{ ...minimalCharacterCard.data, ...overrides },
		undefined,
		userId
	)
}

async function makePersona(userId: number, overrides: Partial<{ name: string }> = {}) {
	const { createPersonaFromParsedData } = await import("./personas")
	return createPersonaFromParsedData(
		{ name: "Bound Persona", description: "A bound persona", ...overrides },
		undefined,
		userId
	)
}

describe("lorebooks import/export (PGlite integration)", () => {
	test("export then re-import unchanged reports status unchanged", async () => {
		const { lorebooksCreateHandler, lorebookExportHandler, lorebookImportHandler } =
			await import("./lorebooks")
		const user = await makeUser("lb-unchanged-user")

		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: "My Lorebook" },
			noopEmit
		)
		await testDb.insert(schema.worldLoreEntries).values({
			lorebookId: lorebook.id,
			name: "Entry A",
			content: "Some lore",
			keys: "trigger"
		})

		const exported = await lorebookExportHandler.handler(
			fakeSocket(user.id),
			{ id: lorebook.id },
			noopEmit
		)
		const exportedData = JSON.parse(exported.blob.toString("utf-8"))

		const reimported = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: exportedData },
			noopEmit
		)

		expect(reimported.status).toBe("unchanged")
		expect(reimported.lorebook?.id).toBe(lorebook.id)

		const rows = await testDb.query.lorebooks.findMany({
			where: (l, { eq }) => eq(l.userId, user.id)
		})
		expect(rows).toHaveLength(1)
	})

	test("editing an entry then re-importing conflicts, then resolves via overwrite/createNew", async () => {
		const {
			lorebooksCreateHandler,
			lorebookExportHandler,
			lorebookImportHandler,
			lorebookImportResolveHandler
		} = await import("./lorebooks")
		const user = await makeUser("lb-conflict-user")

		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: "Conflict Book" },
			noopEmit
		)
		await testDb.insert(schema.worldLoreEntries).values({
			lorebookId: lorebook.id,
			name: "Entry A",
			content: "Original lore",
			keys: "trigger"
		})

		const exported = await lorebookExportHandler.handler(
			fakeSocket(user.id),
			{ id: lorebook.id },
			noopEmit
		)
		const exportedData = JSON.parse(exported.blob.toString("utf-8"))
		exportedData.entries[0].content = "Edited lore"

		const conflictRes = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: exportedData },
			noopEmit
		)
		expect(conflictRes.status).toBe("conflict")
		expect(conflictRes.conflict?.existingLorebook.id).toBe(lorebook.id)

		const overwritten = await lorebookImportResolveHandler.handler(
			fakeSocket(user.id),
			{
				lorebookData: exportedData,
				action: "overwrite",
				existingId: lorebook.id
			},
			noopEmit
		)
		expect(overwritten.lorebook.id).toBe(lorebook.id)
		expect((overwritten.lorebook as any).worldLoreEntries[0].content).toBe(
			"Edited lore"
		)

		const asNew = await lorebookImportResolveHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: exportedData, action: "createNew", existingId: -1 },
			noopEmit
		)
		expect(asNew.lorebook.id).not.toBe(lorebook.id)

		const rows = await testDb.query.lorebooks.findMany({
			where: (l, { eq }) => eq(l.userId, user.id)
		})
		expect(rows).toHaveLength(2)
	})

	test("export with bound characters/personas, delete everything, re-import restores characters/personas/bindings/entry-binding-scoping", async () => {
		const { lorebooksCreateHandler, lorebookExportHandler, lorebookImportHandler } =
			await import("./lorebooks")
		const user = await makeUser("lb-restore-user")

		const character = await makeCharacter(user.id, { name: "Restorable Char" })
		const persona = await makePersona(user.id, { name: "Restorable Persona" })

		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: "Bound Book" },
			noopEmit
		)
		const [charBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: lorebook.id, characterId: character.id, binding: "{{char:1}}" })
			.returning()
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			personaId: persona.id,
			binding: "{{persona:1}}"
		})
		await testDb.insert(schema.characterLoreEntries).values({
			lorebookId: lorebook.id,
			lorebookBindingId: charBinding.id,
			name: "Char Lore",
			content: "Lore scoped to the bound character",
			keys: "scoped"
		})

		const exported = await lorebookExportHandler.handler(
			fakeSocket(user.id),
			{ id: lorebook.id },
			noopEmit
		)
		const exportedData = JSON.parse(exported.blob.toString("utf-8"))
		expect(exportedData.extensions.serenepub.characters).toHaveLength(1)
		expect(exportedData.extensions.serenepub.personas).toHaveLength(1)

		// Delete everything — the lorebook (cascades bindings/entries) and the
		// bound character/persona rows themselves, so the importer must
		// recreate them from the embedded cards rather than just rewiring ids.
		await testDb.delete(schema.lorebooks).where(eq(schema.lorebooks.id, lorebook.id))
		await testDb.delete(schema.characters).where(eq(schema.characters.id, character.id))
		await testDb.delete(schema.personas).where(eq(schema.personas.id, persona.id))

		const imported = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: exportedData },
			noopEmit
		)
		expect(imported.status).toBe("created")
		const newLorebookId = imported.lorebook!.id

		const newCharacters = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, user.id)
		})
		expect(newCharacters).toHaveLength(1)
		expect(newCharacters[0].name).toBe("Restorable Char")

		const newPersonas = await testDb.query.personas.findMany({
			where: (p, { eq }) => eq(p.userId, user.id)
		})
		expect(newPersonas).toHaveLength(1)
		expect(newPersonas[0].name).toBe("Restorable Persona")

		const newBindings = await testDb.query.lorebookBindings.findMany({
			where: (b, { eq }) => eq(b.lorebookId, newLorebookId)
		})
		expect(newBindings).toHaveLength(2)
		const restoredCharBinding = newBindings.find((b) => b.characterId !== null)
		expect(restoredCharBinding?.characterId).toBe(newCharacters[0].id)

		const newCharEntries = await testDb.query.characterLoreEntries.findMany({
			where: (e, { eq }) => eq(e.lorebookId, newLorebookId)
		})
		expect(newCharEntries).toHaveLength(1)
		expect(newCharEntries[0].lorebookBindingId).toBe(restoredCharBinding!.id)
	})

	test("include flags toggled off omit characters/personas/narrativeGraph from export, bindings restore as empty slots", async () => {
		const { lorebooksCreateHandler, lorebookExportHandler, lorebookImportHandler } =
			await import("./lorebooks")
		const user = await makeUser("lb-flags-user")

		const character = await makeCharacter(user.id, { name: "Excluded Char" })
		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: "Flags Book" },
			noopEmit
		)
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId: character.id,
			binding: "{{char:1}}"
		})
		await testDb.insert(schema.narrativeNodes).values({
			lorebookId: lorebook.id,
			name: "Excluded Node"
		})

		const exported = await lorebookExportHandler.handler(
			fakeSocket(user.id),
			{
				id: lorebook.id,
				includeCharacters: false,
				includePersonas: false,
				includeNarrativeGraph: false
			},
			noopEmit
		)
		const exportedData = JSON.parse(exported.blob.toString("utf-8"))

		expect(exportedData.extensions.serenepub.characters).toHaveLength(0)
		expect(exportedData.extensions.serenepub.personas).toHaveLength(0)
		expect(exportedData.extensions.serenepub.narrativeGraph).toBeUndefined()
		// The binding itself still round-trips, just with no embedded card.
		expect(exportedData.extensions.serenepub.bindings).toHaveLength(1)
		expect(exportedData.extensions.serenepub.bindings[0].characterLocalId).toBeNull()

		await testDb.delete(schema.lorebooks).where(eq(schema.lorebooks.id, lorebook.id))

		const imported = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: exportedData },
			noopEmit
		)
		const newBindings = await testDb.query.lorebookBindings.findMany({
			where: (b, { eq }) => eq(b.lorebookId, imported.lorebook!.id)
		})
		expect(newBindings).toHaveLength(1)
		expect(newBindings[0].characterId).toBeNull()
		expect(newBindings[0].personaId).toBeNull()
	})

	test("imports a legacy-format lorebook (object-keyed entries, singular key/keysecondary) via the real handler", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("lb-legacy-user")

		const legacyPayload = {
			name: "Legacy Book",
			description: "",
			entries: {
				"0": {
					key: "trigger",
					keysecondary: "backup",
					content: "Some old-format lore",
					enabled: true
				}
			}
		}

		const res = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: legacyPayload },
			noopEmit
		)
		expect(res.status).toBe("created")

		const entries = await testDb.query.worldLoreEntries.findMany({
			where: (e, { eq }) => eq(e.lorebookId, res.lorebook!.id)
		})
		expect(entries).toHaveLength(1)
		expect(entries[0].keys).toBe("trigger")
		expect(entries[0].content).toBe("Some old-format lore")
	})

	test("rejects a lorebook import that exceeds the entry count cap, before any DB work", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("lb-oversized-user")

		const oversizedPayload = {
			name: "Huge Book",
			description: "",
			entries: Array.from({ length: 5001 }, () => ({
				keys: ["x"],
				content: "y",
				enabled: true
			}))
		}

		await expect(
			lorebookImportHandler.handler(
				fakeSocket(user.id),
				{ lorebookData: oversizedPayload },
				noopEmit
			)
		).rejects.toThrow(/too many entries/i)

		const rows = await testDb.query.lorebooks.findMany({
			where: (l, { eq }) => eq(l.userId, user.id)
		})
		expect(rows).toHaveLength(0)
	})

	test("narrative graph restoration drops a self-referencing node and a 3rd alias level, restoring the rest", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("lb-graph-user")

		const graphPayload = {
			name: "Graph Book",
			description: "",
			entries: [],
			extensions: {
				serenepub: {
					version: 1,
					characters: [],
					personas: [],
					bindings: [],
					narrativeGraph: {
						version: 1,
						nodes: [
							{
								localId: 1,
								name: "Grandchild",
								nodeState: "active",
								nodeVisibility: "normal",
								aliases: [],
								summary: null,
								bindingLocalId: null,
								parentLocalId: 2,
								historyEntryLocalId: null,
								sceneLocalId: null,
								characterUuids: []
							},
							{
								localId: 2,
								name: "Child",
								nodeState: "active",
								nodeVisibility: "normal",
								aliases: [],
								summary: null,
								bindingLocalId: null,
								parentLocalId: 3,
								historyEntryLocalId: null,
								sceneLocalId: null,
								characterUuids: []
							},
							{
								localId: 3,
								name: "Root",
								nodeState: "active",
								nodeVisibility: "normal",
								aliases: [],
								summary: null,
								bindingLocalId: null,
								parentLocalId: null,
								historyEntryLocalId: null,
								sceneLocalId: null,
								characterUuids: []
							},
							{
								localId: 4,
								name: "SelfRef",
								nodeState: "active",
								nodeVisibility: "normal",
								aliases: [],
								summary: null,
								bindingLocalId: null,
								parentLocalId: 4,
								historyEntryLocalId: null,
								sceneLocalId: null,
								characterUuids: []
							}
						],
						relationships: []
					}
				}
			}
		}

		const res = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: graphPayload },
			noopEmit
		)
		expect(res.status).toBe("created")

		const nodes = await testDb.query.narrativeNodes.findMany({
			where: (n, { eq }) => eq(n.lorebookId, res.lorebook!.id)
		})
		expect(nodes).toHaveLength(4)

		const byName = Object.fromEntries(nodes.map((n) => [n.name, n]))
		expect(byName["Grandchild"].parentNodeId).toBeNull() // 1->2 dropped: 2 already has a parent
		expect(byName["Child"].parentNodeId).toBe(byName["Root"].id) // 2->3 restored
		expect(byName["Root"].parentNodeId).toBeNull()
		expect(byName["SelfRef"].parentNodeId).toBeNull() // self-reference dropped
	})
})
