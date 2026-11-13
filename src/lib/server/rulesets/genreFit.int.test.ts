/**
 * 🚧 (s22-V, ★§22-3) Ruleset fit per genre on the Rulesets and Lorebooks
 * lists: a ruleset row says how each offered genre that declares `uses` (or
 * `only`) rates it; a lorebook row says the same for its own ruleset, and
 * nothing for a book on Freeform (the session chooses the rules).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "genre-fit-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const FREEFORM = "core:ruleset/freeform@1"
const VIS_ITINERIS = "core:ruleset/vis-itineris@1"
const SPEAKING = [
	"core:genre/story",
	"core:genre/lair",
	"core:genre/dungeon-crawler"
]
const SILENT = ["core:genre/chat", "core:genre/guide"]

let adminId: number

const adminSocket = (uid: number) =>
	({
		user: { id: uid, isAdmin: true },
		io: {
			sockets: {
				adapter: { rooms: { get: () => undefined } },
				sockets: { get: () => undefined, values: () => [].values() }
			},
			to: () => ({ emit: () => {} })
		}
	}) as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-genre-fit-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	adminId = (await createTestUser(db, "genre-fit-admin")).id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function rulesetRows() {
	const { rulesetsList } = await import("$lib/server/sockets/rulesets")
	const res: any = await rulesetsList.handler(
		adminSocket(adminId),
		{} as any,
		() => {}
	)
	return res.rulesets as Array<{
		rulesetId: string
		rulesetFitByGenre?: Array<{ genreId: string; rating: string }>
	}>
}

describe("ruleset fit per genre", () => {
	it("a ruleset row carries an entry per speaking genre and none for Chat or Guide", async () => {
		const rows = await rulesetRows()
		for (const id of [FREEFORM, VIS_ITINERIS]) {
			const ids = (
				rows.find((r) => r.rulesetId === id)?.rulesetFitByGenre ?? []
			).map((f) => f.genreId)
			for (const g of SPEAKING) expect(ids, `${id} → ${g}`).toContain(g)
			for (const g of SILENT) expect(ids, `${id} → ${g}`).not.toContain(g)
		}
	})

	it("a lorebook row repeats its ruleset's entries, and a Freeform book has none", async () => {
		const [vis] = await db
			.insert(schema.lorebooks)
			.values({
				userId: adminId,
				name: "Fit on Vis Itineris",
				primaryRuleset: VIS_ITINERIS
			} as any)
			.returning()
		const [free] = await db
			.insert(schema.lorebooks)
			.values({
				userId: adminId,
				name: "Fit on Freeform",
				primaryRuleset: FREEFORM
			} as any)
			.returning()
		const { buildLorebooksList } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const { lorebookList } = await buildLorebooksList(adminId, "books")
		const visRow = lorebookList.find((b) => b.id === vis!.id)
		const freeRow = lorebookList.find((b) => b.id === free!.id)
		expect(visRow).toBeDefined()
		expect(freeRow).toBeDefined()
		const expected = (await rulesetRows()).find(
			(r) => r.rulesetId === VIS_ITINERIS
		)?.rulesetFitByGenre
		expect(expected?.length).toBeGreaterThan(0)
		expect(visRow!.rulesetFitByGenre).toEqual(expected)
		expect(freeRow!.rulesetFitByGenre).toBeUndefined()
	})
})
