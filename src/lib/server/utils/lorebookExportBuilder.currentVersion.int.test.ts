/**
 * A book export writes each embedded card as its **current version** (plan
 * §31, cv-fix item 12), not as the copy left on the `characters` row: the
 * content, the likeness and the label (`character_version`).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-export-current-version-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("buildLorebookExportData embeds a card as its current version", () => {
	test("a card with a v2 carries v2's description and label", async () => {
		const { buildLorebookExportData } = await import(
			"./lorebookExportBuilder"
		)
		const { insertCard, newCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, "export-current-version")
		const db = testDb as unknown as Db

		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Versions book", userId: owner.id })
			.returning()
		const { card, version } = await insertCard(db, {
			userId: owner.id,
			name: "Versioned",
			description: "The v1 description."
		})
		await newCardVersion(
			db,
			card.id,
			{
				name: "Versioned",
				description: "The v2 description."
			} as never,
			{ label: "2.0 (revised)" }
		)
		// The row's copy goes stale, as a path that skipped the copy would leave it.
		await testDb
			.update(schema.characters)
			.set({
				description: "The v1 description.",
				characterVersion: "1.0"
			})
			.where(eq(schema.characters.id, card.id))
		expect(version.description).toBe("The v1 description.")
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: book!.id,
			characterId: card.id,
			binding: "{{char:1}}",
			name: "Versioned"
		})

		const { specBookWithGraph } = await buildLorebookExportData(
			book!.id,
			owner.id
		)
		const exported = (specBookWithGraph as any).extensions.serenepub
			.characters[0].card
		expect(exported.data.description).toBe("The v2 description.")
		expect(exported.data.character_version).toBe("2.0 (revised)")
	})
})

describe("buildLorebookExportData carries a member as its base version", () => {
	test("own names, sprite set and state come from the base; a frozen column is ignored", async () => {
		const { buildLorebookExportData } = await import(
			"./lorebookExportBuilder"
		)
		const { insertCard, insertCastMember } = await import(
			"$lib/server/characters/versions"
		)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, "export-member-base")
		const db = testDb as unknown as Db
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Member base book", userId: owner.id })
			.returning()
		const { card } = await insertCard(db, {
			userId: owner.id,
			name: "Carded",
			description: "A card."
		})
		const { member } = await insertCastMember(db, {
			lorebookId: book!.id,
			characterId: card.id,
			binding: "{{char:1}}",
			name: "Carded",
			ownName: "Base Own",
			ownNickname: "Baz",
			spriteSet: "base-sprites",
			nodeState: "dead",
			nodeVisibility: "hidden"
		} as never)
		// The frozen columns hold something else; nothing reads them.
		await testDb
			.update(schema.lorebookBindings)
			.set({
				ownName: "Frozen",
				ownNickname: "Frz",
				spriteSet: "frozen-sprites",
				nodeState: "active",
				nodeVisibility: "normal"
			})
			.where(eq(schema.lorebookBindings.id, member.id))

		const { specBookWithGraph } = await buildLorebookExportData(
			book!.id,
			owner.id
		)
		const serene = (specBookWithGraph as any).extensions.serenepub
		const binding = serene.bindings[0]
		expect(binding.ownName).toBe("Base Own")
		expect(binding.ownNickname).toBe("Baz")
		expect(binding.spriteSet).toBe("base-sprites")
		const node = serene.narrativeGraph.nodes[0]
		expect(node.nodeState).toBe("dead")
		expect(node.nodeVisibility).toBe("hidden")
	})
})
