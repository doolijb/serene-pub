/**
 * 🚧 `entries:list` on a **pub ruleset's** list (lane T3, 2026-10-23; seen by
 * lane T2: "Unknown entry type 'pub:entry/hollow-hearts.bond'").
 *
 * A ruleset an administrator publishes registers its derived entry types
 * after the server has loaded — at publish, or at boot once the database is
 * ready (`registerPubRulesets`). The entries reader (`entries/declarations.ts`)
 * built its map of declared types once, at import, and so knew core's alone:
 * every published ruleset's list was refused as unknown. It now reads the
 * SDK's registry again on a miss, and a type its ruleset took away is no
 * longer declared.
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
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-entries-pub-ruleset-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

describe("entries:list — a published ruleset's list", () => {
	test("is listed once the ruleset is published, though the reader loaded before it; refused again once it is withdrawn", async () => {
		// The reader loads first, as at boot: it knows core's types only.
		const { isDeclaredEntryType, entryDeclarations } = await import("$lib/server/entries/declarations")
		const { entryListHandler } = await import("./entries")
		const { ROMANCE_ID } = await import("@serene-pub/core-catalog")
		const { createPubRuleset, deletePubRuleset, publishPubRuleset } = await import("$lib/server/rulesets/pubRulesets")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const [admin] = await testDb.insert(schema.users).values({ username: "pub-ruleset-admin", password: "x", isAdmin: true } as any).returning()
		const owner = await createTestUser(testDb, "pub-ruleset-reader")

		const { rulesetId } = await createPubRuleset(testDb as any, { ownerSlug: "hollow", name: "hearts", label: "Hollow Hearts", from: ROMANCE_ID, userId: admin!.id })
		expect(rulesetId).toBe("hollow:ruleset/hearts@1")
		const bond = "hollow:entry/hearts.bond"
		// A draft registers nothing.
		expect(isDeclaredEntryType(bond)).toBe(false)

		await publishPubRuleset(testDb as any, rulesetId, { userId: admin!.id })
		expect(isDeclaredEntryType(bond)).toBe(true)
		expect(entryDeclarations().map((d) => d.typeId)).toContain(bond)

		const [book] = await testDb.insert(schema.lorebooks).values({ name: "Hollow Hearts", userId: owner.id }).returning()
		const res = await entryListHandler.handler(fakeSocket(owner.id), { lorebookId: book!.id, typeId: bond } as any, noopEmit)
		expect((res as any).error).toBeUndefined()
		expect((res as any).entryList).toEqual([])

		// Withdrawn with its ruleset: no longer declared, and refused by name again.
		await deletePubRuleset(testDb as any, rulesetId)
		expect(isDeclaredEntryType(bond)).toBe(false)
		await expect(entryListHandler.handler(fakeSocket(owner.id), { lorebookId: book!.id, typeId: bond } as any, noopEmit)).rejects.toThrow(
			/Unknown entry type 'hollow:entry\/hearts\.bond'/
		)
	}, 60_000)
})
