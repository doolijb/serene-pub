/**
 * "Rebuild Graph" used to delete every relationship in the lorebook and
 * re-insert ZERO, reporting success. The mechanism:
 *
 *   1. After the lorebookBindings/narrativeNodes merge, graphBuilder seeds
 *      `existing_<id>` tempIds for ALL nodes in BOTH modes — so every
 *      relationship in a replace-mode proposal has `existing_*` endpoints.
 *   2. The modal only sent `seedTempIdMap` in extend mode.
 *   3. applyProposal built its tempId→id map solely from that field, so in
 *      replace mode the map was empty...
 *   4. ...and `if (!fromId || !toId) continue` silently dropped every
 *      relationship — after the wholesale DELETE had already run, outside the
 *      transaction.
 *
 * Never caught because both existing replace-mode cases pass
 * `proposal: { nodes: [], relationships: [] }`, so the re-insert path was
 * never exercised.
 *
 * The fix: the server derives the mapping by parsing `existing_<id>` itself
 * (the id IS the payload), the DELETE moved inside the transaction, and the
 * silent `continue` became a throw. These tests pin all of it.
 */
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
		path.join(os.tmpdir(), "serene-pub-rebuildrels-int-test-")
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

/** A lorebook with two named, unbound bindings. */
async function makeLorebookWithTwoBindings(userId: number, label: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId })
		.returning()
	const [a] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			binding: "{{char:1}}",
			name: "Aria"
		})
		.returning()
	const [b] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			binding: "{{char:2}}",
			name: "Bram"
		})
		.returning()
	return { lorebook, a, b }
}

function rel(fromTempId: string, toTempId: string, type = "ally") {
	return {
		fromTempId,
		toTempId,
		relationshipType: type,
		description: "forged in the market",
		visibility: "acknowledged",
		status: "active"
	}
}

async function relsFor(lorebookId: number) {
	return testDb.query.narrativeRelationships.findMany({
		where: eq(schema.narrativeRelationships.lorebookId, lorebookId)
	})
}

describe("narrativeGraphApplyProposalHandler — rebuild re-inserts relationships", () => {
	test("replace mode re-inserts an existing_<id> relationship with NO client-supplied seedTempIdMap", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("rebuild-core")
		const { lorebook, a, b } = await makeLorebookWithTwoBindings(
			user.id,
			"Core"
		)
		// A pre-existing relationship the rebuild is meant to replace.
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: a.id,
			toNodeId: b.id,
			relationshipType: "rival",
			description: "old",
			visibility: "acknowledged",
			status: "active"
		})

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: {
					nodes: [],
					relationships: [rel(`existing_${a.id}`, `existing_${b.id}`)]
				},
				mode: "replace"
			} as any,
			noopEmit
		)

		const rows = await relsFor(lorebook.id)
		// Before the fix this was `[]` — wiped and nothing put back.
		expect(rows).toHaveLength(1)
		expect(rows[0].fromNodeId).toBe(a.id)
		expect(rows[0].toNodeId).toBe(b.id)
		expect(rows[0].relationshipType).toBe("ally")
		expect(rows[0].description).toBe("forged in the market")
	})

	test("an endpoint deleted mid-build aborts the apply and leaves existing relationships intact", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("rebuild-deleted-endpoint")
		const { lorebook, a, b } = await makeLorebookWithTwoBindings(
			user.id,
			"Deleted Endpoint"
		)
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: a.id,
			toNodeId: b.id,
			relationshipType: "rival",
			description: "survivor",
			visibility: "acknowledged",
			status: "active"
		})
		const goneId = b.id + 9999 // never existed

		await expect(
			narrativeGraphApplyProposalHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: lorebook.id,
					proposal: {
						nodes: [],
						relationships: [
							rel(`existing_${a.id}`, `existing_${goneId}`)
						]
					},
					mode: "replace"
				} as any,
				noopEmit
			)
		).rejects.toThrow(/no longer exist/)

		// The whole point of moving the DELETE inside the transaction: a
		// failed rebuild must not leave the graph emptied.
		const rows = await relsFor(lorebook.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].description).toBe("survivor")
	})

	test("a malformed tempId aborts the apply and changes nothing", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("rebuild-malformed")
		const { lorebook, a, b } = await makeLorebookWithTwoBindings(
			user.id,
			"Malformed"
		)
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: a.id,
			toNodeId: b.id,
			relationshipType: "rival",
			description: "survivor",
			visibility: "acknowledged",
			status: "active"
		})

		await expect(
			narrativeGraphApplyProposalHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: lorebook.id,
					proposal: {
						nodes: [],
						relationships: [rel("node_7", `existing_${b.id}`)]
					},
					mode: "replace"
				} as any,
				noopEmit
			)
		).rejects.toThrow(/unknown node/)

		expect(await relsFor(lorebook.id)).toHaveLength(1)
	})

	test("an existing_<id> endpoint from another user's lorebook is rejected", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const victim = await makeUser("rebuild-victim")
		const attacker = await makeUser("rebuild-attacker")
		const victimSide = await makeLorebookWithTwoBindings(
			victim.id,
			"Victim Book"
		)
		const attackerSide = await makeLorebookWithTwoBindings(
			attacker.id,
			"Attacker Book"
		)

		await expect(
			narrativeGraphApplyProposalHandler.handler(
				fakeSocket(attacker.id),
				{
					lorebookId: attackerSide.lorebook.id,
					proposal: {
						nodes: [],
						relationships: [
							rel(
								`existing_${attackerSide.a.id}`,
								`existing_${victimSide.a.id}`
							)
						]
					},
					mode: "replace"
				} as any,
				noopEmit
			)
		).rejects.toThrow(/Access denied/)

		expect(await relsFor(victimSide.lorebook.id)).toHaveLength(0)
		expect(await relsFor(attackerSide.lorebook.id)).toHaveLength(0)
	})

	test("a wrong-but-owned seedTempIdMap is ignored — the server derives the mapping", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("rebuild-forged-map")
		const { lorebook, a, b } = await makeLorebookWithTwoBindings(
			user.id,
			"Forged Map"
		)

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: {
					nodes: [],
					relationships: [rel(`existing_${a.id}`, `existing_${b.id}`)]
				},
				mode: "replace",
				// Both ids are owned by this user, so the OLD value-only check
				// passed this happily and attached the relationship to the
				// wrong character. The field is no longer read at all.
				seedTempIdMap: { [`existing_${a.id}`]: b.id }
			} as any,
			noopEmit
		)

		const rows = await relsFor(lorebook.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].fromNodeId).toBe(a.id)
	})

	test("extend mode still UPDATEs a matching relationship rather than duplicating it", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("rebuild-extend")
		const { lorebook, a, b } = await makeLorebookWithTwoBindings(
			user.id,
			"Extend"
		)
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: a.id,
			toNodeId: b.id,
			relationshipType: "ally",
			description: "stale",
			visibility: "acknowledged",
			status: "active"
		})

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: {
					nodes: [],
					relationships: [rel(`existing_${a.id}`, `existing_${b.id}`)]
				},
				mode: "extend"
			} as any,
			noopEmit
		)

		const rows = await relsFor(lorebook.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].description).toBe("forged in the market")
	})
})

describe("narrativeGraphApplyProposalHandler — discovered nodes and updates", () => {
	test("a discovered new_N node is INSERTed once and its relationship resolves to it", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("rebuild-discovery")
		const { lorebook, a } = await makeLorebookWithTwoBindings(
			user.id,
			"Discovery"
		)
		const before = await testDb.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebook.id)
		})

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: {
					nodes: [
						{
							tempId: "new_1",
							name: "Cassia",
							nodeState: "active",
							summary: "a merchant"
						}
					],
					relationships: [rel(`existing_${a.id}`, "new_1")]
				},
				mode: "replace"
			} as any,
			noopEmit
		)

		const after = await testDb.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebook.id)
		})
		expect(after).toHaveLength(before.length + 1)
		const cassia = after.find((n) => n.name === "Cassia")!
		expect(cassia).toBeDefined()

		const rows = await relsFor(lorebook.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].fromNodeId).toBe(a.id)
		expect(rows[0].toNodeId).toBe(cassia.id)
	})

	test("an existing_ tempId in proposal.nodes is refused — it would duplicate the binding", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("rebuild-seed-insert-guard")
		const { lorebook, a } = await makeLorebookWithTwoBindings(
			user.id,
			"Seed Insert Guard"
		)
		const before = await testDb.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebook.id)
		})

		await expect(
			narrativeGraphApplyProposalHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: lorebook.id,
					proposal: {
						nodes: [
							{
								tempId: `existing_${a.id}`,
								name: "Aria",
								nodeState: "active",
								summary: "dupe"
							}
						],
						relationships: []
					},
					mode: "replace"
				} as any,
				noopEmit
			)
		).rejects.toThrow(/must not be inserted/)

		const after = await testDb.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebook.id)
		})
		expect(after).toHaveLength(before.length)
	})

	test("updatedNodes fills a blank summary and applies a state change, without inserting a row", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("rebuild-updates")
		const { lorebook, a } = await makeLorebookWithTwoBindings(
			user.id,
			"Updates"
		)
		const before = await testDb.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebook.id)
		})

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: {
					nodes: [],
					relationships: [],
					updatedNodes: [
						{
							tempId: `existing_${a.id}`,
							name: "Aria",
							nodeState: "deceased",
							previousNodeState: "active",
							summary: "a fallen scout",
							previousSummary: null
						}
					]
				},
				mode: "replace"
			} as any,
			noopEmit
		)

		const after = await testDb.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebook.id)
		})
		expect(after).toHaveLength(before.length) // UPDATE, never INSERT
		const aria = after.find((n) => n.id === a.id)!
		expect(aria.nodeState).toBe("deceased")
		expect(aria.summary).toBe("a fallen scout")
		// Identity fields stay owned by entity sync.
		expect(aria.name).toBe("Aria")
		expect(aria.binding).toBe("{{char:1}}")
	})

	test("updatedNodes never overwrites a non-empty summary, but still applies the state change", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("rebuild-no-clobber")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "No Clobber", userId: user.id })
			.returning()
		const [hand] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: "{{char:1}}",
				name: "Aria",
				summary: "user wrote this"
			})
			.returning()

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: {
					nodes: [],
					relationships: [],
					updatedNodes: [
						{
							tempId: `existing_${hand.id}`,
							name: "Aria",
							nodeState: "missing",
							previousNodeState: "active",
							summary: "model rewrote this",
							previousSummary: ""
						}
					]
				},
				mode: "replace"
			} as any,
			noopEmit
		)

		const row = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, hand.id)
		})
		// summary is user-writable via lorebooks:updateBinding and the column
		// can't distinguish a hand edit from a prior build's output, so it is
		// never overwritten — enforced in the WHERE, not by reading first.
		expect(row!.summary).toBe("user wrote this")
		expect(row!.nodeState).toBe("missing")
	})
})
