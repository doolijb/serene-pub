/**
 * Loadouts (I12): resolution (slot → loadout → merged root → unfilled
 * fallback), cycle refusal, core seeding idempotence, the `connection_defaults`
 * one-shot, the default-claim path, and the world's projection.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	describeLoadoutChain,
	findLoadout,
	mergeLoadout,
	resolveLoadout
} from "$lib/server/loadouts"
import { seedCoreLoadouts, seedLoadoutDecls } from "$lib/server/loadouts/seed"
import { moveConnectionDefaultsToLoadouts } from "$lib/server/loadouts/fromConnectionDefaults"
import {
	capabilityDefault,
	setCapabilityDefault
} from "$lib/server/connections/capabilityDefaults"

let db: TestDb

const byId = async (seedKey: string) => (await findLoadout(db as any, seedKey))!

async function connectionWithModel(name: string) {
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
	// The sampling presets the core set names, by seed key.
	for (const seedKey of ["sampling-default", "sampling-extraction", "sampling-image-default"])
		await db
			.insert(schema.samplingConfigs)
			.values({ seedKey, name: seedKey, shape: seedKey.includes("image") ? "core:shape/image-gen@1" : "core:shape/text-gen@1" } as any)
			.onConflictDoNothing()
	await seedCoreLoadouts(db as any)
}, 60_000)

afterAll(async () => {
	await (db as any).$client?.close?.()
})

describe("seeding", () => {
	it("seeds core's set unfilled, by seed key, and a re-seed changes nothing a person set", async () => {
		const reply = await byId("core:loadout/reply@1")
		expect(reply).toMatchObject({ name: "Reply", owner: "core", connectionId: null })
		const extraction = await byId("core:loadout/extraction@1")
		const [extractionSampling] = await db
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-extraction"))
		expect(extraction.samplingConfigId).toBe(extractionSampling!.id)

		await db
			.update(schema.loadouts)
			.set({ samplingConfigId: null })
			.where(eq(schema.loadouts.id, extraction.id))
		const again = await seedCoreLoadouts(db as any)
		expect(again.inserted).toBe(0)
		// 13 since O12 (2026-10-21): + Transcription and Spoken reply.
		expect(again.refreshed).toBe(13)
		expect((await byId("core:loadout/extraction@1")).samplingConfigId).toBeNull()
		expect(
			(await db.select().from(schema.loadouts)).filter((r) => r.owner === "core")
		).toHaveLength(13)
		// 🚧 O12: both arrive unfilled, on their own transforms.
		expect(await byId("core:loadout/transcription@1")).toMatchObject({
			name: "Transcription",
			transform: "audio->text",
			connectionId: null
		})
		expect(await byId("core:loadout/spoken-reply@1")).toMatchObject({
			name: "Spoken reply",
			transform: "text->text+audio",
			connectionId: null
		})
	})

	it("a plugin's declaration arrives unfilled and unmerged; a foreign namespace is refused", async () => {
		const r = await seedLoadoutDecls(db as any, "acme.rp", [
			{
				id: "acme.rp:loadout/extract@1",
				name: "Extract",
				description: "Low temperature.",
				transform: "text->text",
				sampling: "sampling-extraction"
			},
			{
				id: "other.pkg:loadout/x@1",
				name: "X",
				description: "",
				transform: "text->text"
			}
		])
		expect(r.inserted).toBe(1)
		expect(r.refused).toHaveLength(1)
		const extract = await byId("acme.rp:loadout/extract@1")
		expect(extract).toMatchObject({ owner: "acme.rp", connectionId: null, mergedInto: null })
	})
})

describe("the default claim and the one-shot", () => {
	it("the first default set for a transform claims core's declared loadout", async () => {
		expect(await capabilityDefault(db as any, "text->text")).toBeUndefined()
		const { c, m } = await connectionWithModel("claim")
		await setCapabilityDefault(db as any, "text->text", {
			connectionId: c.id,
			connectionModelId: m.id
		})
		const reply = await byId("core:loadout/reply@1")
		expect(reply).toMatchObject({
			defaultForInput: "text",
			defaultForOutput: "text",
			connectionId: c.id,
			connectionModelId: m.id,
			// "No row" became "a row": all three halves stated, as the old insert did.
			samplingConfigId: null
		})
		expect(await capabilityDefault(db as any, "text->text")).toEqual({
			connectionId: c.id,
			connectionModelId: m.id,
			samplingConfigId: null
		})
	})

	it("moves connection_defaults rows into default loadouts verbatim, once", async () => {
		const { c, m } = await connectionWithModel("moved")
		await db.insert(schema.connectionDefaults).values([
			// Images: core's declared default.
			{ input: "text", output: "image", connectionId: c.id, connectionModelId: m.id },
			// Vision: no core loadout — a pub one named after the transform.
			{ input: "text,image", output: "text", connectionId: c.id, connectionModelId: m.id },
			// Already has a default (claimed above): kept, row dropped.
			{ input: "text", output: "text", connectionId: null }
		])
		const report = await moveConnectionDefaultsToLoadouts(db as any)
		expect(report).toEqual({ moved: 2, kept: 1, dropped: 0 })
		expect(await db.select().from(schema.connectionDefaults)).toEqual([])
		expect(await byId("core:loadout/images@1")).toMatchObject({
			defaultForOutput: "image",
			connectionId: c.id,
			connectionModelId: m.id,
			samplingConfigId: null
		})
		const vision = await db
			.select()
			.from(schema.loadouts)
			.where(eq(schema.loadouts.transform, "text+image->text"))
		expect(vision[0]).toMatchObject({ owner: "pub", name: "Vision", defaultForInput: "text,image" })
		// The reply default was not overwritten by the stale row.
		expect((await capabilityDefault(db as any, "text->text"))?.connectionId).not.toBeNull()
		// Run twice: nothing left to move.
		expect(await moveConnectionDefaultsToLoadouts(db as any)).toEqual({
			moved: 0,
			kept: 0,
			dropped: 0
		})
	})
})

describe("resolution", () => {
	it("an unfilled loadout falls back to its transform's default, whole", async () => {
		const extraction = await byId("core:loadout/extraction@1")
		const r = await resolveLoadout(db as any, extraction)
		const reply = await byId("core:loadout/reply@1")
		expect(r.fellBack).toBe(true)
		expect(r.effective?.id).toBe(reply.id)
		expect(describeLoadoutChain(r, "extract")).toBe(
			"extract → Extraction → Reply (unfilled fallback)"
		)
	})

	it("a merged child resolves to its parent's root; unmerge restores it", async () => {
		const extract = await byId("acme.rp:loadout/extract@1")
		const extraction = await byId("core:loadout/extraction@1")
		const { c, m } = await connectionWithModel("extraction")
		await db
			.update(schema.loadouts)
			.set({ connectionId: c.id, connectionModelId: m.id })
			.where(eq(schema.loadouts.id, extraction.id))
		expect(await mergeLoadout(db as any, extract.id, extraction.id)).toEqual({ ok: true })
		const r = await resolveLoadout(db as any, (await byId("acme.rp:loadout/extract@1"))!)
		expect(r.effective?.id).toBe(extraction.id)
		expect(r.fellBack).toBe(false)
		expect(describeLoadoutChain(r)).toBe("Extract → Extraction (merged)")

		await mergeLoadout(db as any, extract.id, null)
		const back = await resolveLoadout(db as any, (await byId("acme.rp:loadout/extract@1"))!)
		expect(back.hops.map((h) => h.via)).toEqual(["named", "unfilled-fallback"])
	})

	it("refuses a cycle, a self-merge and a merge across transforms", async () => {
		const extract = await byId("acme.rp:loadout/extract@1")
		const extraction = await byId("core:loadout/extraction@1")
		const images = await byId("core:loadout/images@1")
		await mergeLoadout(db as any, extract.id, extraction.id)
		const cycle = await mergeLoadout(db as any, extraction.id, extract.id)
		expect(cycle.ok).toBe(false)
		expect((cycle as { error: string }).error).toMatch(/loop/)
		expect((await mergeLoadout(db as any, extract.id, extract.id)).ok).toBe(false)
		const across = await mergeLoadout(db as any, images.id, extraction.id)
		expect((across as { error: string }).error).toMatch(/same kind of work/)
		await mergeLoadout(db as any, extract.id, null)
	})

	it("a pub id finds its row by owner and slug", async () => {
		const vision = await findLoadout(db as any, "pub:loadout/vision")
		expect(vision?.transform).toBe("text+image->text")
		expect(await findLoadout(db as any, { id: "core:loadout/reply@1" })).not.toBeNull()
		expect(await findLoadout(db as any, "core:loadout/nope@1")).toBeNull()
	})
})

describe("the world's projection (applyLoadoutLayer)", () => {
	it("puts the loadout's pair at `defaults`, under an explicit pick, and records the chain", async () => {
		const { applyLoadoutLayer } = await import("$lib/server/pipelines/config/world")
		const extraction = await byId("core:loadout/extraction@1")
		const overrides: any[] = [
			{ nodeKey: "synth", slot: "loadout", path: "", value: { id: "core:loadout/extraction@1" }, scopeKind: "config" },
			{ nodeKey: "synth", slot: "connection", path: "", value: { id: "999", modelId: null }, scopeKind: "defaults" },
			{ nodeKey: "naming", slot: "loadout", path: "", value: { id: "core:loadout/extraction@1" }, scopeKind: "config" },
			{ nodeKey: "naming", slot: "connection", path: "", value: { id: "42", modelId: "7" }, scopeKind: "config" },
			{ nodeKey: "gone", slot: "loadout", path: "", value: { id: "core:loadout/nope@1" }, scopeKind: "config" }
		]
		const chains = await applyLoadoutLayer(db as any, overrides)
		const at = (nodeKey: string, slot: string, scopeKind: string) =>
			overrides.filter((o) => o.nodeKey === nodeKey && o.slot === slot && o.scopeKind === scopeKind)
		// The instance default at `defaults` is replaced, not stacked.
		expect(at("synth", "connection", "defaults")).toEqual([
			expect.objectContaining({
				value: { id: String(extraction.connectionId), modelId: String(extraction.connectionModelId) }
			})
		])
		// An explicit pick stays where it is, above `defaults`, and wins.
		expect(at("naming", "connection", "config")[0].value).toEqual({ id: "42", modelId: "7" })
		expect(chains).toEqual({ synth: "Extraction", naming: "Extraction" })
		// A loadout id that names nothing projects nothing.
		expect(at("gone", "connection", "defaults")).toEqual([])
	})

	it("carries the loadout's workflow dials on the workflow slot (lane E2)", async () => {
		const { applyLoadoutLayer } = await import("$lib/server/pipelines/config/world")
		const extraction = await byId("core:loadout/extraction@1")
		const [wf] = await db
			.insert(schema.workflows)
			.values({ name: "Dials", document: "{}", variables: [] } as any)
			.returning()
		await db.insert(schema.loadouts).values({
			slug: "dialled",
			name: "Dialled",
			owner: "pub",
			transform: "text->image",
			connectionId: extraction.connectionId,
			connectionModelId: extraction.connectionModelId,
			workflowId: wf!.id,
			workflowValues: { steps: 30, lora_strength: 0.5 }
		} as any)
		const overrides: any[] = [
			{ nodeKey: "draw", slot: "loadout", path: "", value: { id: "pub:loadout/dialled" }, scopeKind: "config" }
		]
		await applyLoadoutLayer(db as any, overrides)
		const slot = overrides.find((o) => o.slot === "workflow")
		expect(slot?.value).toEqual({ id: wf!.id, values: { steps: 30, lora_strength: 0.5 } })
	})
})

