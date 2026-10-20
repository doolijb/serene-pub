/**
 * `loadouts:*` over a real database (I12): admin-only, the list's words, a
 * pair change's sampling swap, merge refusal, default moves, Make it, Fill for
 * me's proposal, delete.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	stopVectorization: () => {},
	startVectorizationQueue: async () => {},
	clearVectorizationFailureTracking: () => {},
	clearInlineEmbedCooldown: () => {}
}))

const socketFor = (isAdmin = true) =>
	({ user: { id: 1, isAdmin }, server: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

async function pair(
	name: string,
	resolved: Record<string, unknown>,
	type: string = CONNECTION_TYPE.OPENAI
) {
	const [c] = await testDb
		.insert(schema.connections)
		.values({ name, type, capabilities: { resolved } } as any)
		.returning()
	const [m] = await testDb
		.insert(schema.connectionModels)
		.values({ connectionId: c!.id, model: `${name}-m`, name: `${name} model` } as any)
		.returning()
	return { c: c!, m: m! }
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-loadouts-int-test-"))
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	await testDb.insert(schema.users).values({ id: 1, username: "loadouts-admin", isAdmin: true } as any).onConflictDoNothing()
	for (const [seedKey, shape] of [
		["sampling-default", "core:shape/text-gen@1"],
		["sampling-extraction", "core:shape/text-gen@1"],
		["sampling-image-default", "core:shape/image-gen@1"]
	])
		await testDb.insert(schema.samplingConfigs).values({ seedKey, name: seedKey, shape } as any)
	const { seedCoreLoadouts } = await import("$lib/server/loadouts/seed")
	await seedCoreLoadouts(testDb as any)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const S = () => import("./loadouts")

describe("loadouts sockets", () => {
	test("a member is refused", async () => {
		const { loadoutsList } = await S()
		await expect(loadoutsList.handler(socketFor(false), {}, noopEmit)).rejects.toThrow(/admin/)
	}, 60_000)

	test("the list says unfilled loadouts fall back to the default", async () => {
		const { loadoutsList } = await S()
		const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
		const { c, m } = await pair("chat", { "text->text": 2 })
		await setCapabilityDefault(testDb as any, "text->text", {
			connectionId: c.id,
			connectionModelId: m.id
		})
		const res = await loadoutsList.handler(socketFor(), {}, noopEmit)
		expect(res.canReply).toBe(true)
		const extraction = res.loadouts.find((l) => l.loadoutId === "core:loadout/extraction@1")!
		expect(extraction).toMatchObject({
			filled: false,
			fallbackName: "Reply",
			consequence: "Unfilled — falls back to Reply"
		})
		const reply = res.loadouts.find((l) => l.loadoutId === "core:loadout/reply@1")!
		expect(reply).toMatchObject({ defaultFor: "text->text", modelName: "chat model" })
		expect(res.transforms.find((t) => t.id === "text->text")?.defaultLoadoutId).toBe(reply.id)
	}, 60_000)

	test("a pair change swaps a sampling config the new pair cannot speak, and says so", async () => {
		const { loadoutsCreate, loadoutsUpdate } = await S()
		const { c, m } = await pair("drawer", { "text->image": 1 }, CONNECTION_TYPE.A1111)
		const created = await loadoutsCreate.handler(
			socketFor(),
			{ name: "Posters", transform: "text->image" },
			noopEmit
		)
		// A text config left on an image loadout by hand.
		const [text] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-default"))
		await testDb
			.update(schema.loadouts)
			.set({ samplingConfigId: text!.id })
			.where(eq(schema.loadouts.id, created.loadout.id))
		const res = await loadoutsUpdate.handler(
			socketFor(),
			{ id: created.loadout.id, connectionId: c.id, connectionModelId: m.id },
			noopEmit
		)
		expect(res.notice).toMatch(/does not fit this model, so sampling is now/)
		expect(res.loadout.samplingName).toBe("sampling-image-default")
		expect(res.loadout.filled).toBe(true)
	}, 60_000)

	test("merge refuses a loop; setDefault moves the flag; Make it fills from the fleet; delete keeps shipped rows", async () => {
		const { loadoutsList, loadoutsMerge, loadoutsSetDefault, loadoutsMakeIt, loadoutsDelete, loadoutsCreate } = await S()
		const list = await loadoutsList.handler(socketFor(), {}, noopEmit)
		const extraction = list.loadouts.find((l) => l.loadoutId === "core:loadout/extraction@1")!
		const scene = list.loadouts.find((l) => l.loadoutId === "core:loadout/scene-prompt@1")!
		await loadoutsMerge.handler(socketFor(), { id: scene.id, parentId: extraction.id }, noopEmit)
		await expect(
			loadoutsMerge.handler(socketFor(), { id: extraction.id, parentId: scene.id }, noopEmit)
		).rejects.toThrow(/loop/)

		const mine = await loadoutsCreate.handler(socketFor(), { name: "Mine", transform: "text->text" }, noopEmit)
		const moved = await loadoutsSetDefault.handler(socketFor(), { id: mine.loadout.id }, noopEmit)
		expect(moved.loadout.defaultFor).toBe("text->text")
		const after = await loadoutsList.handler(socketFor(), {}, noopEmit)
		expect(after.loadouts.find((l) => l.loadoutId === "core:loadout/reply@1")?.defaultFor).toBeNull()

		const { c } = await pair("schema", { "text->text": 2, json_schema: 2 })
		const graded = await loadoutsList.handler(socketFor(), {}, noopEmit)
		expect(graded.connectionGrades?.[c.id]?.json_schema).toBe(2)
		// Fill for me proposes the same pick, says why, and writes nothing.
		const { loadoutsProposeFill } = await S()
		const before = await loadoutsList.handler(socketFor(), {}, noopEmit)
		const proposed = await loadoutsProposeFill.handler(socketFor(), { id: extraction.id }, noopEmit)
		expect(proposed.connectionId).toBe(c.id)
		expect(proposed.explanation).toMatch(/^Filled with schema model on schema\. It has a schema door, what Extraction is best with/)
		expect(proposed.samplingConfigId).not.toBeNull()
		const still = await loadoutsList.handler(socketFor(), {}, noopEmit)
		expect(still.loadouts.find((l) => l.id === extraction.id)?.connectionId).toBe(
			before.loadouts.find((l) => l.id === extraction.id)?.connectionId
		)
		// A loadout not yet created proposes by transform.
		const fresh = await loadoutsProposeFill.handler(socketFor(), { transform: "text->text" }, noopEmit)
		expect(fresh.id).toBeNull()
		expect(fresh.connectionId).toBeTypeOf("number")
		await expect(
			loadoutsProposeFill.handler(socketFor(false), { id: extraction.id }, noopEmit)
		).rejects.toThrow(/admin/)

		const made = await loadoutsMakeIt.handler(socketFor(), { id: extraction.id }, noopEmit)
		expect(made.loadout.connectionId).toBe(c.id)
		expect(made.explanation).toMatch(/now runs on schema model on schema/)

		await expect(
			loadoutsDelete.handler(socketFor(), { id: extraction.id }, noopEmit)
		).rejects.toThrow(/cannot be deleted/)
		await expect(
			loadoutsDelete.handler(socketFor(), { id: mine.loadout.id }, noopEmit)
		).rejects.toThrow(/is the default/)
	}, 60_000)
})
