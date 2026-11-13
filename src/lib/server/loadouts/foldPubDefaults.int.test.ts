/**
 * The fold of a one-shot-minted `pub` Vision default onto `core:loadout/vision@1`
 * (owner ruling 2026-11-11, "merge in"), and the 0.6 rule that a second boot
 * changes nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { seedCoreLoadouts } from "$lib/server/loadouts/seed"
import { foldPubDefaultsOntoCore } from "$lib/server/loadouts/foldPubDefaults"
import { capabilityDefault } from "$lib/server/connections/capabilityDefaults"

const VISION = "text+image->text"
let db: TestDb

const snapshot = async () =>
	(await db.select().from(schema.loadouts).orderBy(schema.loadouts.id)).map(
		({ updatedAt: _u, ...r }) => r
	)

async function pair(name: string) {
	const [c] = await db
		.insert(schema.connections)
		.values({ name, type: "openai", baseUrl: "http://x" } as any)
		.returning()
	const [m] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: c!.id, model: `${name}-model`, name: `${name} model` } as any)
		.returning()
	return { c: c!, m: m! }
}

beforeAll(async () => {
	db = await createTestDb()
	for (const seedKey of ["sampling-default", "sampling-reply", "sampling-extraction", "sampling-image-default"])
		await db
			.insert(schema.samplingConfigs)
			.values({ seedKey, name: seedKey, shape: "core:shape/text-gen@1" } as any)
			.onConflictDoNothing()
	await seedCoreLoadouts(db as any)
}, 60_000)

afterAll(async () => {
	await (db as any).$client?.close?.()
})

describe("foldPubDefaultsOntoCore", () => {
	it("moves a one-shot pub Vision default onto core's row, follows merges and voices, and is a no-op the second time", async () => {
		const p = await pair("seen")
		// What the 0.5 one-shot minted before core shipped Vision.
		const [pub] = await db
			.insert(schema.loadouts)
			.values({
				owner: "pub",
				slug: "vision",
				name: "Vision",
				description: null,
				transform: VISION,
				connectionId: p.c.id,
				connectionModelId: p.m.id,
				defaultForInput: "text,image",
				defaultForOutput: "text"
			} as any)
			.returning()
		// A pub loadout a person merged into it.
		const [child] = await db
			.insert(schema.loadouts)
			.values({ owner: "pub", slug: "captions", name: "Captions", transform: VISION, mergedInto: pub!.id } as any)
			.returning()
		const coreBefore = (await db.select().from(schema.loadouts).where(eq(schema.loadouts.seedKey, "core:loadout/vision@1")))[0]!
		expect(coreBefore.defaultForInput).toBeNull()

		const first = await foldPubDefaultsOntoCore(db as any)
		expect(first.folded).toEqual([VISION])

		const core = (await db.select().from(schema.loadouts).where(eq(schema.loadouts.seedKey, "core:loadout/vision@1")))[0]!
		expect(core).toMatchObject({
			connectionId: p.c.id,
			connectionModelId: p.m.id,
			defaultForInput: "text,image",
			defaultForOutput: "text",
			name: "Vision"
		})
		// Core's seeded sampling is kept only when the pub row had none to bring.
		expect(core.samplingConfigId).toBeNull()
		expect(await capabilityDefault(db as any, VISION)).toMatchObject({ connectionId: p.c.id })
		expect(await db.select().from(schema.loadouts).where(eq(schema.loadouts.id, pub!.id))).toEqual([])
		const movedChild = (await db.select().from(schema.loadouts).where(eq(schema.loadouts.id, child!.id)))[0]!
		expect(movedChild.mergedInto).toBe(core.id)
		// One tile named Vision.
		const visions = await db.select().from(schema.loadouts).where(eq(schema.loadouts.name, "Vision"))
		expect(visions).toHaveLength(1)

		// Second boot: nothing changes.
		const before = await snapshot()
		const second = await foldPubDefaultsOntoCore(db as any)
		expect(second.folded).toEqual([])
		expect(await snapshot()).toEqual(before)
	})

	it("leaves a pub default a person renamed or described alone", async () => {
		// Undo the claim so core's row is unclaimed again for this case.
		await db
			.update(schema.loadouts)
			.set({ defaultForInput: null, defaultForOutput: null })
			.where(eq(schema.loadouts.seedKey, "core:loadout/vision@1"))
		const [mine] = await db
			.insert(schema.loadouts)
			.values({
				owner: "pub",
				slug: "my-vision",
				name: "Vision",
				description: "My captioner",
				transform: VISION,
				defaultForInput: "text,image",
				defaultForOutput: "text"
			} as any)
			.returning()
		const r = await foldPubDefaultsOntoCore(db as any)
		expect(r.folded).toEqual([])
		expect((await db.select().from(schema.loadouts).where(eq(schema.loadouts.id, mine!.id)))[0]!.defaultForInput).toBe("text,image")
	})
})
