/**
 * 🚧 A plugin's manifest `loadouts[]` seed when it is switched on, not only at
 * boot (DESIGN-image-generation §16 follow-up D3): enable → its rows appear,
 * unfilled and unmerged; enable again → no duplicates; switch it off → the rows
 * stay (a person may have filled them) and the Loadouts list marks them
 * `pluginOff`. Run with the sandbox flag OFF (the default): a loadout row is
 * data, so it seeds either way.
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

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sp-plugin-loadouts-int-"))
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb.insert(schema.plugins).values({
		pluginId: "acme.rp",
		name: "Acme RP",
		bundleSource: "",
		bundleHash: "0".repeat(64),
		enabled: false,
		manifest: {
			slug: "acme.rp",
			loadouts: [
				{
					id: "acme.rp:loadout/extract@1",
					name: "Extract",
					description: "Low temperature.",
					transform: "text->text"
				}
			]
		}
	} as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const admin = { user: { id: 1, isAdmin: true } } as any

async function rows() {
	return testDb
		.select()
		.from(schema.loadouts)
		.where(eq(schema.loadouts.seedKey, "acme.rp:loadout/extract@1"))
}

describe("a plugin's loadouts on enable", () => {
	test("enable seeds them once; disable keeps them, marked plugin off", async () => {
		const h = await import("./plugins")
		expect(await rows()).toHaveLength(0)

		await h.pluginsSetEnabled.handler(admin, { pluginId: "acme.rp", enabled: true }, () => {})
		const first = await rows()
		expect(first).toHaveLength(1)
		expect(first[0]).toMatchObject({
			owner: "acme.rp",
			connectionId: null,
			connectionModelId: null,
			mergedInto: null
		})

		await h.pluginsSetEnabled.handler(admin, { pluginId: "acme.rp", enabled: true }, () => {})
		expect(await rows()).toHaveLength(1)

		const { buildLoadoutsList } = await import("./loadouts")
		const on = (await buildLoadoutsList()).loadouts.find(
			(l) => l.loadoutId === "acme.rp:loadout/extract@1"
		)
		expect(on?.pluginOff).toBeUndefined()

		await h.pluginsSetEnabled.handler(admin, { pluginId: "acme.rp", enabled: false }, () => {})
		expect(await rows()).toHaveLength(1)
		const off = (await buildLoadoutsList()).loadouts.find(
			(l) => l.loadoutId === "acme.rp:loadout/extract@1"
		)
		expect(off?.pluginOff).toBe(true)
	})
})
