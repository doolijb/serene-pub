/**
 * 🚧 What "Update rules" offers (M0 L4, lane U5b): a pinned session whose
 * ruleset has a higher published version and a chain that gets there is offered
 * {from, to, notes}; anything else is null.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
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
		path.join(os.tmpdir(), "serene-pub-vitest-upgrade-offer-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0

async function world(
	over: {
		pinned?: string | null
		published?: string | null
		upgrades?: unknown[]
	} = {}
) {
	const k = ++n
	const rulesetId = `acme.lab:ruleset/offer-${k}@1`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `offer-owner-${k}`)
	const published = over.published === undefined ? "2.0.0" : over.published
	const upgrades = over.upgrades ?? [
		{
			from: "1.0.0",
			to: "2.0.0",
			note: "Nerve is now called Resolve.",
			slots: {}
		}
	]
	await testDb.insert(schema.rulesets).values({
		rulesetId,
		ownerSlug: "acme.lab",
		label: `Offer ${k}`,
		draft: {},
		published: published
			? { id: rulesetId, version: published, upgrades }
			: null,
		publishedVersion: published
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${k}`,
			primaryRuleset: rulesetId,
			rulesetVersion: over.pinned === undefined ? "1.0.0" : over.pinned
		})
		.returning()
	return session!
}

const offer = async (sessionId: number) => {
	const { rulesetUpgradeOffer } = await import(
		"$lib/server/sessions/convertRuleset"
	)
	return rulesetUpgradeOffer(testDb as unknown as Db, sessionId)
}

describe("rulesetUpgradeOffer", () => {
	test(
		"pinned 1.0.0, published 2.0.0 with a noted chain: the offer carries the note",
		{ timeout: 60_000 },
		async () => {
			const s = await world()
			expect(await offer(s.id)).toEqual({
				from: "1.0.0",
				to: "2.0.0",
				notes: ["Nerve is now called Resolve."]
			})
		}
	)

	test("a step with no note adds none", { timeout: 60_000 }, async () => {
		const s = await world({
			upgrades: [{ from: "1.0.0", to: "2.0.0", slots: {} }]
		})
		expect(await offer(s.id)).toEqual({
			from: "1.0.0",
			to: "2.0.0",
			notes: []
		})
	})

	test("the same version: null", { timeout: 60_000 }, async () => {
		const s = await world({ pinned: "2.0.0" })
		expect(await offer(s.id)).toBeNull()
	})

	test("no chain: null", { timeout: 60_000 }, async () => {
		const s = await world({ upgrades: [] })
		expect(await offer(s.id)).toBeNull()
	})

	test(
		"not pinned, or nothing published: null",
		{ timeout: 60_000 },
		async () => {
			expect(await offer((await world({ pinned: null })).id)).toBeNull()
			expect(
				await offer((await world({ published: null })).id)
			).toBeNull()
		}
	)
})
