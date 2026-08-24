/**
 * Round-6 audit fix: buildLorebookExportData used to embed a bound
 * character's/persona's full card whenever includeCharacters/
 * includePersonas was on, with no check that the bound entity was owned by
 * the exporting user — only that binding it in the first place had been
 * allowed, which requires nothing more than being able to *view* it (e.g.
 * shared into a session you're a guest of), not owning it. That's a
 * data-extraction capability the app's own direct card-export path
 * (characters:exportCard/personas:exportCard) is deliberately owner-only
 * about. Now the export embeds a card only when the binding's
 * character/persona actually belongs to the exporting user — a non-owned
 * binding still appears in the bindings list (unbound-card, matching what
 * includeCharacters/includePersonas: false already produces), it just
 * doesn't leak the other user's full card content.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
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
		path.join(os.tmpdir(), "serene-pub-lorebook-export-scoping-int-test-")
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

describe("buildLorebookExportData — character/persona ownership scoping (PGlite integration)", () => {
	test("excludes another user's character card from the export, but keeps the binding", async () => {
		const { buildLorebookExportData } = await import(
			"./lorebookExportBuilder"
		)
		const owner = await makeUser("export-scope-owner")
		const victim = await makeUser("export-scope-victim")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Book", userId: owner.id })
			.returning()

		const [victimCharacter] = await testDb
			.insert(schema.characters)
			.values({
				userId: victim.id,
				name: "Victim's Character",
				description:
					"A private, sensitive system prompt-like description."
			})
			.returning()

		// Simulates the binding having been created via a legitimate
		// canViewCharacter path (shared into a session the owner is a guest of)
		// — this test only needs the end state: a binding in the owner's own
		// lorebook pointing at a character owned by someone else.
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId: victimCharacter.id,
			binding: "{{char:1}}",
			name: "Victim's Character"
		})

		const { specBookWithGraph } = await buildLorebookExportData(
			lorebook.id,
			owner.id
		)

		const serenepub = (specBookWithGraph as any).extensions.serenepub
		expect(serenepub.characters).toEqual([])
		expect(serenepub.bindings).toHaveLength(1)
		expect(serenepub.bindings[0].characterLocalId).toBeNull()
	})

	test("still includes the exporting user's own bound character card", async () => {
		const { buildLorebookExportData } = await import(
			"./lorebookExportBuilder"
		)
		const owner = await makeUser("export-scope-owner-2")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Book 2", userId: owner.id })
			.returning()

		const [ownCharacter] = await testDb
			.insert(schema.characters)
			.values({
				userId: owner.id,
				name: "My Own Character",
				description: "Owned by the exporter."
			})
			.returning()

		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId: ownCharacter.id,
			binding: "{{char:1}}",
			name: "My Own Character"
		})

		const { specBookWithGraph } = await buildLorebookExportData(
			lorebook.id,
			owner.id
		)

		const serenepub = (specBookWithGraph as any).extensions.serenepub
		expect(serenepub.characters).toHaveLength(1)
		expect(serenepub.bindings[0].characterLocalId).not.toBeNull()
	})
})

describe("buildLorebookExportData — narrativeGraph ownership scoping (Round-13 audit fix, PGlite integration)", () => {
	test("redacts a non-owned bound character's name/aliases/summary in the narrative graph node, even though the binding survives", async () => {
		const { buildLorebookExportData } = await import(
			"./lorebookExportBuilder"
		)
		const owner = await makeUser("export-graph-scope-owner")
		const victim = await makeUser("export-graph-scope-victim")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Graph Book", userId: owner.id })
			.returning()

		const [victimCharacter] = await testDb
			.insert(schema.characters)
			.values({
				userId: victim.id,
				name: "Victim's Real Name",
				description:
					"A private, sensitive system prompt-like description."
			})
			.returning()

		// characterBindingSync keeps name/aliases in sync with the bound
		// character regardless of who owns it — simulate that end state
		// directly rather than driving the real sync path.
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId: victimCharacter.id,
			binding: "{{char:1}}",
			name: "Victim's Real Name",
			aliases: ["Vicky"],
			absorbedAliases: ["Formerly Known As Vic"],
			summary: "A summary that reveals private details."
		})

		const { specBookWithGraph } = await buildLorebookExportData(
			lorebook.id,
			owner.id
		)

		const serenepub = (specBookWithGraph as any).extensions.serenepub
		expect(serenepub.narrativeGraph.nodes).toHaveLength(1)
		const node = serenepub.narrativeGraph.nodes[0]
		expect(node.name).toBe("")
		expect(node.aliases).toEqual([])
		// absorbedAliases is just as identity-revealing as aliases — must be
		// redacted alongside it, not left leaking the victim's absorbed names.
		expect(node.absorbedAliases).toEqual([])
		expect(node.summary).toBeNull()
		// Structural fields are untouched — only identity-revealing fields
		// are redacted.
		expect(node.bindingLocalId).not.toBeNull()
	})

	test("still carries the exporting user's own bound character's real name/aliases through the narrative graph node", async () => {
		const { buildLorebookExportData } = await import(
			"./lorebookExportBuilder"
		)
		const owner = await makeUser("export-graph-scope-owner-2")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Graph Book 2", userId: owner.id })
			.returning()

		const [ownCharacter] = await testDb
			.insert(schema.characters)
			.values({
				userId: owner.id,
				name: "My Own Real Name",
				description: "Owned by the exporter."
			})
			.returning()

		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			characterId: ownCharacter.id,
			binding: "{{char:1}}",
			name: "My Own Real Name",
			aliases: ["Mine"],
			summary: "My own summary."
		})

		const { specBookWithGraph } = await buildLorebookExportData(
			lorebook.id,
			owner.id
		)

		const serenepub = (specBookWithGraph as any).extensions.serenepub
		expect(serenepub.narrativeGraph.nodes).toHaveLength(1)
		const node = serenepub.narrativeGraph.nodes[0]
		expect(node.name).toBe("My Own Real Name")
		expect(node.aliases).toEqual(["Mine"])
		expect(node.summary).toBe("My own summary.")
	})

	test("unbound (background) narrative nodes are never redacted, since they have no owner to check", async () => {
		const { buildLorebookExportData } = await import(
			"./lorebookExportBuilder"
		)
		const owner = await makeUser("export-graph-scope-owner-3")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Graph Book 3", userId: owner.id })
			.returning()

		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			binding: "{{unbound:1}}",
			name: "Background Node",
			aliases: ["BG"],
			summary: "An unbound background node."
		})

		const { specBookWithGraph } = await buildLorebookExportData(
			lorebook.id,
			owner.id
		)

		const serenepub = (specBookWithGraph as any).extensions.serenepub
		expect(serenepub.narrativeGraph.nodes).toHaveLength(1)
		const node = serenepub.narrativeGraph.nodes[0]
		expect(node.name).toBe("Background Node")
		expect(node.aliases).toEqual(["BG"])
		expect(node.summary).toBe("An unbound background node.")
	})
})
