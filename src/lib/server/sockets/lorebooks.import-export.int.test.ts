import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// Targeted failure injection for the "import restore is transactional" tests
// below — a world-lore entry whose `comment` carries this marker makes the
// mapper throw partway through insertLorebookEntries, which runs inside
// createLorebookFromParsedCard/overwriteLorebookFromParsedCard's
// transaction. Every other entry (no marker) maps normally, so this is a
// no-op for every other test in this file.
const MID_REBUILD_FAILURE_MARKER = "TRIGGER_MID_TRANSACTION_FAILURE"
vi.mock("$lib/server/utils/lorebookImportMapper", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/utils/lorebookImportMapper")
		>()
	return {
		...actual,
		mapLorebookEntryToWorldLoreEntry: (entry: any, position: number) => {
			if (entry?.comment === MID_REBUILD_FAILURE_MARKER) {
				throw new Error("Forced mid-rebuild failure for test")
			}
			return actual.mapLorebookEntryToWorldLoreEntry(entry, position)
		}
	}
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
	await releaseDataDir(dataDir)
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

async function makeCharacter(
	userId: number,
	overrides: Partial<{ name: string }> = {}
) {
	const { createCharacterFromParsedData } = await import("./characters")
	return createCharacterFromParsedData(
		{ ...minimalCharacterCard.data, ...overrides },
		undefined,
		userId
	)
}

async function makePersona(
	userId: number,
	overrides: Partial<{ name: string }> = {}
) {
	const { createPersonaFromParsedData } = await import("./personas")
	return createPersonaFromParsedData(
		{ name: "Bound Persona", description: "A bound persona", ...overrides },
		undefined,
		userId
	)
}

describe("lorebooks import/export (PGlite integration)", () => {
	test("export then re-import unchanged reports status unchanged", async () => {
		const {
			lorebooksCreateHandler,
			lorebookExportHandler,
			lorebookImportHandler
		} = await import("./lorebooks")
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

	test("two different users importing the same lorebook payload (shared uuid) both succeed and each keep that uuid", async () => {
		const {
			lorebooksCreateHandler,
			lorebookExportHandler,
			lorebookImportHandler
		} = await import("./lorebooks")
		const userA = await makeUser("lb-uuid-collision-user-a")
		const userB = await makeUser("lb-uuid-collision-user-b")

		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(userA.id),
			{ name: "Shared Book" },
			noopEmit
		)
		const exported = await lorebookExportHandler.handler(
			fakeSocket(userA.id),
			{ id: lorebook.id },
			noopEmit
		)
		const exportedData = JSON.parse(exported.blob.toString("utf-8"))
		const sharedUuid = exportedData.extensions.serenepub.uuid
		expect(sharedUuid).toBeTruthy()

		const resB = await lorebookImportHandler.handler(
			fakeSocket(userB.id),
			{ lorebookData: exportedData },
			noopEmit
		)
		expect(resB.status).toBe("created")
		expect((resB.lorebook as any).uuid).toBe(sharedUuid)
		expect(resB.lorebook!.id).not.toBe(lorebook.id)

		// User B re-importing an edited copy of that same shared file must
		// conflict against THEIR OWN row, not user A's.
		exportedData.entries = [
			{ keys: ["x"], content: "edited by B", enabled: true }
		]
		const conflictForB = await lorebookImportHandler.handler(
			fakeSocket(userB.id),
			{ lorebookData: exportedData },
			noopEmit
		)
		expect(conflictForB.status).toBe("conflict")
		expect(conflictForB.conflict?.existingLorebook.id).toBe(
			resB.lorebook!.id
		)
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
		const {
			lorebooksCreateHandler,
			lorebookExportHandler,
			lorebookImportHandler
		} = await import("./lorebooks")
		const user = await makeUser("lb-restore-user")

		const character = await makeCharacter(user.id, {
			name: "Restorable Char"
		})
		const persona = await makePersona(user.id, {
			name: "Restorable Persona"
		})

		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: "Bound Book" },
			noopEmit
		)
		const [charBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:1}}"
			})
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
		await testDb
			.delete(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebook.id))
		await testDb
			.delete(schema.characters)
			.where(eq(schema.characters.id, character.id))
		await testDb
			.delete(schema.personas)
			.where(eq(schema.personas.id, persona.id))

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
		const restoredCharBinding = newBindings.find(
			(b) => b.characterId !== null
		)
		expect(restoredCharBinding?.characterId).toBe(newCharacters[0].id)
		// Import must sync name/aliases from the entity immediately (same as
		// every other bound-insert path) — otherwise the binding's name stays
		// permanently NULL and every consumer displaying `name || binding`
		// falls through to the raw {{char:N}} token forever.
		expect(restoredCharBinding?.name).toBe("Restorable Char")
		const restoredPersonaBinding = newBindings.find(
			(b) => b.personaId !== null
		)
		expect(restoredPersonaBinding?.name).toBe("Restorable Persona")

		const newCharEntries = await testDb.query.characterLoreEntries.findMany(
			{
				where: (e, { eq }) => eq(e.lorebookId, newLorebookId)
			}
		)
		expect(newCharEntries).toHaveLength(1)
		expect(newCharEntries[0].lorebookBindingId).toBe(
			restoredCharBinding!.id
		)
	})

	test("include flags toggled off omit characters/personas/narrativeGraph from export, bindings restore as empty slots", async () => {
		const {
			lorebooksCreateHandler,
			lorebookExportHandler,
			lorebookImportHandler
		} = await import("./lorebooks")
		const user = await makeUser("lb-flags-user")

		const character = await makeCharacter(user.id, {
			name: "Excluded Char"
		})
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
		expect(
			exportedData.extensions.serenepub.bindings[0].characterLocalId
		).toBeNull()

		await testDb
			.delete(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebook.id))

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

	test("a background binding's name/aliases survive export then re-import", async () => {
		const {
			lorebooksCreateHandler,
			lorebookExportHandler,
			lorebookImportHandler
		} = await import("./lorebooks")
		const user = await makeUser("lb-background-name-user")

		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: "Background Book" },
			noopEmit
		)
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId: null,
			personaId: null,
			binding: "{{char:1}}",
			name: "Old Man Willow",
			aliases: ["Willow"]
		})

		const exported = await lorebookExportHandler.handler(
			fakeSocket(user.id),
			{ id: lorebook.id },
			noopEmit
		)
		const exportedData = JSON.parse(exported.blob.toString("utf-8"))

		await testDb
			.delete(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebook.id))

		const imported = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: exportedData },
			noopEmit
		)
		expect(imported.status).toBe("created")

		const newBindings = await testDb.query.lorebookBindings.findMany({
			where: (b, { eq }) => eq(b.lorebookId, imported.lorebook!.id)
		})
		expect(newBindings).toHaveLength(1)
		expect(newBindings[0].characterId).toBeNull()
		expect(newBindings[0].personaId).toBeNull()
		expect(newBindings[0].name).toBe("Old Man Willow")
		expect(newBindings[0].aliases).toEqual(["Willow"])
	})

	test("a character-linked binding exported with includeCharacters off still restores its name/aliases from the narrative graph node", async () => {
		const {
			lorebooksCreateHandler,
			lorebookExportHandler,
			lorebookImportHandler
		} = await import("./lorebooks")
		const user = await makeUser("lb-scoped-out-name-user")

		const character = await makeCharacter(user.id, {
			name: "Scoped Out Char"
		})
		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: "Scoped Out Book" },
			noopEmit
		)
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId: character.id,
			binding: "{{char:1}}",
			name: "Scoped Out Char",
			aliases: ["Scoped"]
		})

		const exported = await lorebookExportHandler.handler(
			fakeSocket(user.id),
			{
				id: lorebook.id,
				includeCharacters: false,
				includeNarrativeGraph: true
			},
			noopEmit
		)
		const exportedData = JSON.parse(exported.blob.toString("utf-8"))
		expect(exportedData.extensions.serenepub.characters).toHaveLength(0)
		expect(
			exportedData.extensions.serenepub.bindings[0].characterLocalId
		).toBeNull()
		expect(
			exportedData.extensions.serenepub.narrativeGraph.nodes
		).toHaveLength(1)
		expect(
			exportedData.extensions.serenepub.narrativeGraph.nodes[0].name
		).toBe("Scoped Out Char")

		await testDb
			.delete(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebook.id))

		const imported = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: exportedData },
			noopEmit
		)
		expect(imported.status).toBe("created")

		const newBindings = await testDb.query.lorebookBindings.findMany({
			where: (b, { eq }) => eq(b.lorebookId, imported.lorebook!.id)
		})
		expect(newBindings).toHaveLength(1)
		// No card was embedded, so no new character row was created — this
		// binding restores as background-shaped (characterId null), with its
		// name/aliases pulled from the graph node, the only surviving source.
		expect(newBindings[0].characterId).toBeNull()
		expect(newBindings[0].name).toBe("Scoped Out Char")
		expect(newBindings[0].aliases).toEqual(["Scoped"])
	})

	test("absorbedAliases survive export then re-import after a graph absorb", async () => {
		const {
			lorebooksCreateHandler,
			lorebookExportHandler,
			lorebookImportHandler
		} = await import("./lorebooks")
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("lb-absorbed-aliases-user")

		const character = await makeCharacter(user.id, {
			name: "Survivor Character"
		})
		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: "Absorb Book" },
			noopEmit
		)
		const [survivorBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:1}}",
				name: "Survivor Character"
			})
			.returning()
		const [absorbedBinding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:2}}",
				name: "Ghost NPC"
			})
			.returning()

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: absorbedBinding.id, parentNodeId: survivorBinding.id },
			noopEmit
		)
		const survivorBeforeExport =
			await testDb.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, survivorBinding.id)
			})
		expect(survivorBeforeExport?.absorbedAliases).toContain("Ghost NPC")

		const exported = await lorebookExportHandler.handler(
			fakeSocket(user.id),
			{ id: lorebook.id },
			noopEmit
		)
		const exportedData = JSON.parse(exported.blob.toString("utf-8"))
		const survivorNode =
			exportedData.extensions.serenepub.narrativeGraph.nodes.find(
				(n: any) => n.name === "Survivor Character"
			)
		expect(survivorNode.absorbedAliases).toContain("Ghost NPC")

		await testDb
			.delete(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebook.id))

		const imported = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookData: exportedData },
			noopEmit
		)
		expect(imported.status).toBe("created")

		const restoredBindings = await testDb.query.lorebookBindings.findMany({
			where: (b, { eq }) => eq(b.lorebookId, imported.lorebook!.id)
		})
		const restoredSurvivor = restoredBindings.find(
			(b) => b.name === "Survivor Character"
		)
		expect(restoredSurvivor?.absorbedAliases).toContain("Ghost NPC")
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

		const allBindings = await testDb.query.lorebookBindings.findMany({
			where: (n, { eq }) => eq(n.lorebookId, res.lorebook!.id)
		})
		// These 4 payload nodes are all unbound (bindingLocalId: null), so
		// they're the only lorebookBindings rows for this fresh lorebook —
		// filtering to unbound rows just documents that expectation.
		const nodes = allBindings.filter(
			(b) => b.characterId === null && b.personaId === null
		)
		expect(nodes).toHaveLength(4)

		const byName = Object.fromEntries(nodes.map((n) => [n.name, n]))
		expect(byName["Grandchild"].parentNodeId).toBeNull() // 1->2 dropped: 2 already has a parent
		expect(byName["Child"].parentNodeId).toBe(byName["Root"].id) // 2->3 restored
		expect(byName["Root"].parentNodeId).toBeNull()
		expect(byName["SelfRef"].parentNodeId).toBeNull() // self-reference dropped
	})

	// Round-10 audit fix (HIGH): createLorebookFromParsedCard/
	// overwriteLorebookFromParsedCard used to delete the lorebook's existing
	// content (on overwrite) and rebuild it as a long sequence of separate,
	// unwrapped statements — a failure partway through the rebuild left the
	// lorebook's old content already gone with only some/none of the new
	// content in its place. Now wrapped in a single db.transaction. These
	// tests force a genuine mid-rebuild failure (two serenepub.bindings
	// entries resolving to the same real characterId, which violates
	// lorebook_bindings_unique — (lorebookId, characterId, personaId) — on
	// the second insert inside restoreBoundEntities) and assert nothing was
	// partially committed.
	describe("import restore is transactional (Round-10 audit fix)", () => {
		test("overwrite: a mid-rebuild failure leaves the original content untouched", async () => {
			const {
				lorebooksCreateHandler,
				lorebookExportHandler,
				lorebookImportHandler,
				lorebookImportResolveHandler
			} = await import("./lorebooks")
			const user = await makeUser("lb-txn-overwrite-user")

			const character = await makeCharacter(user.id, {
				name: "Txn Character"
			})
			const { lorebook } = await lorebooksCreateHandler.handler(
				fakeSocket(user.id),
				{ name: "Txn Book" },
				noopEmit
			)
			await testDb.insert(schema.lorebookBindings).values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:1}}"
			})
			await testDb.insert(schema.worldLoreEntries).values({
				lorebookId: lorebook.id,
				name: "Original Entry",
				content: "Must survive a failed overwrite",
				keys: "trigger"
			})

			const exported = await lorebookExportHandler.handler(
				fakeSocket(user.id),
				{ id: lorebook.id },
				noopEmit
			)
			const exportedData = JSON.parse(exported.blob.toString("utf-8"))
			// Trigger the conflict path (same uuid), but poison the payload
			// with an extra entry carrying the mid-rebuild-failure marker
			// (see the mapLorebookEntryToWorldLoreEntry mock above) — throws
			// inside insertLorebookEntries, after the deletes have already
			// run in the same transaction.
			exportedData.entries[0].content = "Edited lore that should be lost"
			exportedData.entries.push({
				...exportedData.entries[0],
				name: MID_REBUILD_FAILURE_MARKER,
				comment: MID_REBUILD_FAILURE_MARKER
			})

			const conflictRes = await lorebookImportHandler.handler(
				fakeSocket(user.id),
				{ lorebookData: exportedData },
				noopEmit
			)
			expect(conflictRes.status).toBe("conflict")

			await expect(
				lorebookImportResolveHandler.handler(
					fakeSocket(user.id),
					{
						lorebookData: exportedData,
						action: "overwrite",
						existingId: lorebook.id
					},
					noopEmit
				)
			).rejects.toThrow()

			// The original content must still be intact — nothing partially
			// committed despite the failure happening mid-rebuild, after the
			// deletes had already run inside the same transaction.
			const survivingEntries =
				await testDb.query.worldLoreEntries.findMany({
					where: (e, { eq }) => eq(e.lorebookId, lorebook.id)
				})
			expect(survivingEntries).toHaveLength(1)
			expect(survivingEntries[0].content).toBe(
				"Must survive a failed overwrite"
			)
			const survivingBindings =
				await testDb.query.lorebookBindings.findMany({
					where: (b, { eq }) => eq(b.lorebookId, lorebook.id)
				})
			expect(survivingBindings).toHaveLength(1)
			expect(survivingBindings[0].characterId).toBe(character.id)
		})

		test("create: a mid-rebuild failure leaves no orphaned lorebook row", async () => {
			const {
				lorebooksCreateHandler,
				lorebookExportHandler,
				lorebookImportHandler
			} = await import("./lorebooks")
			const user = await makeUser("lb-txn-create-user")

			const character = await makeCharacter(user.id, {
				name: "Txn Create Character"
			})
			const { lorebook } = await lorebooksCreateHandler.handler(
				fakeSocket(user.id),
				{ name: "Txn Create Book" },
				noopEmit
			)
			await testDb.insert(schema.lorebookBindings).values({
				lorebookId: lorebook.id,
				characterId: character.id,
				binding: "{{char:1}}"
			})

			const exported = await lorebookExportHandler.handler(
				fakeSocket(user.id),
				{ id: lorebook.id },
				noopEmit
			)
			const exportedData = JSON.parse(exported.blob.toString("utf-8"))
			// Strip the uuid so this always takes the "create new" path (not
			// the conflict/overwrite path), and poison it the same way as
			// the overwrite test above.
			delete exportedData.extensions.serenepub.uuid
			exportedData.entries.push({
				keys: ["trigger"],
				content: "poison",
				comment: MID_REBUILD_FAILURE_MARKER,
				name: MID_REBUILD_FAILURE_MARKER,
				enabled: true
			})

			const rowsBefore = await testDb.query.lorebooks.findMany({
				where: (l, { eq }) => eq(l.userId, user.id)
			})

			await expect(
				lorebookImportHandler.handler(
					fakeSocket(user.id),
					{ lorebookData: exportedData },
					noopEmit
				)
			).rejects.toThrow()

			// No new, orphaned lorebook row left behind by the failed create.
			const rowsAfter = await testDb.query.lorebooks.findMany({
				where: (l, { eq }) => eq(l.userId, user.id)
			})
			expect(rowsAfter).toHaveLength(rowsBefore.length)
		})
	})
})
