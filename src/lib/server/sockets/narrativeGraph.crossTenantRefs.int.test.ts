/**
 * Round-6 audit fix: narrativeGraphCreateNodeHandler and
 * narrativeGraphApplyProposalHandler inserted client-supplied
 * sceneId/historyEntryId (and, for applyProposal, relationship sceneId/
 * historyEntryId too) with no check they belonged to the target lorebook —
 * unlike updateNode/createRelationship/updateRelationship, which already
 * validate this exact pair of fields. applyProposal already had the
 * identical validation shape for seedTempIdMap values; this closes the gap
 * for sceneId/historyEntryId specifically.
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
		path.join(os.tmpdir(), "serene-pub-narrativegraph-crosstenant-int-test-")
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

describe("narrativeGraph:createNode — historyEntryId scoping (PGlite integration)", () => {
	test("rejects a historyEntryId from a foreign lorebook", async () => {
		const { narrativeGraphCreateNodeHandler } = await import(
			"./narrativeGraph"
		)
		const attacker = await makeUser("createnode-attacker")
		const victim = await makeUser("createnode-victim")

		const [attackerLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Attacker's Book", userId: attacker.id })
			.returning()
		const [victimLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Victim's Book", userId: victim.id })
			.returning()
		const [victimHistoryEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: victimLorebook.id })
			.returning()

		await expect(
			narrativeGraphCreateNodeHandler.handler(
				fakeSocket(attacker.id),
				{
					lorebookId: attackerLorebook.id,
					name: "Injected node",
					historyEntryId: victimHistoryEntry.id
				} as any,
				noopEmit
			)
		).rejects.toThrow()
	})

	test("accepts a historyEntryId from the same lorebook", async () => {
		const { narrativeGraphCreateNodeHandler } = await import(
			"./narrativeGraph"
		)
		const owner = await makeUser("createnode-owner")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Book", userId: owner.id })
			.returning()
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()

		const res = await narrativeGraphCreateNodeHandler.handler(
			fakeSocket(owner.id),
			{
				lorebookId: lorebook.id,
				name: "Legit node",
				historyEntryId: historyEntry.id
			} as any,
			noopEmit
		)

		expect(res.node.historyEntryId).toBe(historyEntry.id)
	})
})

describe("narrativeGraph:applyProposal — sceneId/historyEntryId scoping (PGlite integration)", () => {
	test("rejects a proposal node referencing a foreign lorebook's history entry", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const attacker = await makeUser("applyproposal-attacker")
		const victim = await makeUser("applyproposal-victim")

		const [attackerLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Attacker's Book", userId: attacker.id })
			.returning()
		const [victimLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Victim's Book", userId: victim.id })
			.returning()
		const [victimHistoryEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: victimLorebook.id })
			.returning()

		await expect(
			narrativeGraphApplyProposalHandler.handler(
				fakeSocket(attacker.id),
				{
					lorebookId: attackerLorebook.id,
					mode: "extend",
					proposal: {
						nodes: [
							{
								tempId: "t1",
								name: "Injected",
								nodeState: "active",
								summary: "",
								historyEntryId: victimHistoryEntry.id
							}
						],
						relationships: []
					}
				} as any,
				noopEmit
			)
		).rejects.toThrow()
	})

	test("rejects a proposal relationship referencing a foreign lorebook's scene", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const attacker = await makeUser("applyproposal-attacker-2")
		const victim = await makeUser("applyproposal-victim-2")

		const [attackerLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Attacker's Book 2", userId: attacker.id })
			.returning()
		const [victimLorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Victim's Book 2", userId: victim.id })
			.returning()
		const [victimHistoryEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: victimLorebook.id })
			.returning()
		const [victimScene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: victimLorebook.id,
				historyEntryId: victimHistoryEntry.id,
				name: "Victim scene"
			})
			.returning()

		await expect(
			narrativeGraphApplyProposalHandler.handler(
				fakeSocket(attacker.id),
				{
					lorebookId: attackerLorebook.id,
					mode: "extend",
					proposal: {
						nodes: [
							{
								tempId: "a",
								name: "A",
								nodeState: "active",
								summary: ""
							},
							{
								tempId: "b",
								name: "B",
								nodeState: "active",
								summary: ""
							}
						],
						relationships: [
							{
								fromTempId: "a",
								toTempId: "b",
								relationshipType: "ally",
								description: "",
								visibility: "acknowledged",
								status: "active",
								sceneId: victimScene.id
							}
						]
					}
				} as any,
				noopEmit
			)
		).rejects.toThrow()
	})

	test("accepts a proposal referencing scenes/history entries from the same lorebook", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const owner = await makeUser("applyproposal-owner")

		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owner's Book", userId: owner.id })
			.returning()
		const [historyEntry] = await testDb
			.insert(schema.historyEntries)
			.values({ lorebookId: lorebook.id })
			.returning()

		const res = await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(owner.id),
			{
				lorebookId: lorebook.id,
				mode: "extend",
				proposal: {
					nodes: [
						{
							tempId: "t1",
							name: "Legit node",
							nodeState: "active",
							summary: "",
							historyEntryId: historyEntry.id
						}
					],
					relationships: []
				}
			} as any,
			noopEmit
		)

		expect(res.nodes).toHaveLength(1)
		expect(res.nodes[0].historyEntryId).toBe(historyEntry.id)
	})
})
