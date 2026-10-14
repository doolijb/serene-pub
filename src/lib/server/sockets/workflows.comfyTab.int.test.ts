/**
 * 🚧 The Workflows tab's server half on a real database
 * (DESIGN-image-generation §4.12, §7.1):
 *
 *  - a workflow writes no sampling config — its dials are its variables
 *    (ruling 13 reversed 2026-10-12), and the boot cleanup removes the
 *    per-workflow configs the reversed ruling seeded;
 *  - `workflows:onServer` reads the chips from the connection's cached
 *    `extra_json.comfy` — nothing recorded, nothing fetched.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { S } from "@serene-pub/sdk"
import { validityChip } from "$lib/client/components/connections/comfy/workflowsTab"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

let db: TestDb
const ADMIN = { user: { id: 1, isAdmin: true } } as any

const INFO = {
	classes: [
		"CheckpointLoaderSimple",
		"CLIPTextEncode",
		"KSampler",
		"EmptyLatentImage",
		"VAEDecode",
		"SaveImage"
	],
	enums: {
		"CheckpointLoaderSimple.ckpt_name": ["sd_xl_base_1.0.safetensors"],
		"LoraLoader.lora_name": ["detail.safetensors"]
	}
}

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.execute(
		`SELECT setval(pg_get_serial_sequence('sampling_configs', 'id'), 100)`
	)
}, 60_000)

const countConfigs = async () => (await db.query.samplingConfigs.findMany()).length

describe("workflows have no sampling configs (ruling 13 reversed 2026-10-12)", () => {
	it("a workflow's create, edit, duplicate and delete write no sampling config", async () => {
		const { createWorkflow, updateWorkflow, duplicateWorkflow, deleteWorkflow } =
			await import("$lib/server/imageGen/comfy/workflows")
		const before = await countConfigs()
		const row = await createWorkflow(db as any, {
			name: "LoRA portrait",
			document: JSON.stringify({
				"3": {
					class_type: "KSampler",
					inputs: { seed: "{{seed}}", steps: "{{steps}}", model: ["4", 0] }
				},
				"4": { class_type: "LoraLoader", inputs: { strength_model: "{{lora_strength}}" } },
				"9": { class_type: "SaveImage", inputs: { filename_prefix: "x", images: ["3", 0] } }
			}, null, 2).replace(/"\{\{(\w+)\}\}"/g, "{{$1}}"),
			variables: [
				{ name: "seed", type: "integer", default: 0 },
				{ name: "steps", type: "integer", default: 28 },
				{ name: "lora_strength", type: "number", default: 0.8, group: "LoRA" }
			],
			outputNode: "9"
		})
		await updateWorkflow(db as any, row.id, { name: "LoRA portrait 2" })
		const copy = await duplicateWorkflow(db as any, row.id)
		expect(await countConfigs()).toBe(before)
		// The dials live on the workflow, with their defaults.
		expect(copy.variables).toEqual(row.variables)
		await deleteWorkflow(db as any, copy.id)
		await deleteWorkflow(db as any, row.id)
		expect(await countConfigs()).toBe(before)
	})

	it("a fresh boot with the six starters adds none, and the cleanup removes the old ones", async () => {
		const { seedWorkflows } = await import("$lib/server/imageGen/comfy/starters")
		const { removeWorkflowSamplingConfigs } = await import(
			"$lib/server/pipelines/boot/workflowSamplingCleanup"
		)
		const before = await countConfigs()
		await seedWorkflows(db as any)
		await removeWorkflowSamplingConfigs(db as any)
		const starters = await db.query.workflows.findMany({
			where: (w, { isNotNull }) => isNotNull(w.seedKey)
		})
		expect(starters.length).toBe(6)
		expect(await countConfigs()).toBe(before)

		// A row the reversed ruling seeded, and a person's copy in a workflow
		// shape: both go; an ordinary image config stays.
		await db.insert(schema.samplingConfigs).values([
			{
				seedKey: "workflow:x:default",
				name: "Default",
				shape: "core:shape/workflow-9999@1",
				values: { steps: 30 },
				enabled: ["steps"]
			},
			{
				name: "My tuned copy",
				shape: "core:shape/workflow-9998@1",
				values: {},
				enabled: []
			},
			{ name: "Plain image E3", shape: S.imageGen, values: {}, enabled: [] }
		])
		expect(await removeWorkflowSamplingConfigs(db as any)).toBe(2)
		expect(await removeWorkflowSamplingConfigs(db as any)).toBe(0)
		const left = await db.query.samplingConfigs.findMany()
		expect(left.some((c) => c.seedKey === "workflow:x:default")).toBe(false)
		expect(left.some((c) => (c.shape ?? "").startsWith("core:shape/workflow-"))).toBe(false)
		expect(left.some((c) => c.name === "Plain image E3")).toBe(true)
	})
})

describe("workflows:onServer — the tab's validity chips", () => {
	it("reads this server's cached object_info, says ready or names what is missing", async () => {
		const [conn] = await db
			.insert(schema.connections)
			.values({
				name: "Comfy",
				type: CONNECTION_TYPE.COMFYUI,
				modality: "image-gen",
				baseUrl: "http://comfy:8188",
				extraJson: { comfy: { objectInfo: INFO, checkedAt: "2026-10-12T00:00:00Z" } }
			} as any)
			.returning()
		const { workflowsOnServer } = await import("./workflows")
		const res = await workflowsOnServer.handler(
			ADMIN,
			{ connectionId: conn!.id },
			() => {}
		)
		expect(res!.checked).toBe(true)

		const byName = new Map(
			(await db.query.workflows.findMany()).map((w) => [w.name, w.id])
		)
		const sdxl = validityChip(byName.get("SDXL text-to-image")!, res)
		expect(sdxl).toMatchObject({ tone: "ready", label: "ready" })
		const sprite = validityChip(
			byName.get("SDXL + IP-Adapter sprite (plain background)")!,
			res
		)
		expect(sprite.tone).toBe("missing")
		expect(sprite.label).toMatch(/^Missing nodes: /)

		// Looking records nothing on the connection.
		const stored = await db.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, conn!.id)
		})
		expect((stored!.extraJson as any).comfy.checks).toBeUndefined()

		// A server nobody has tested says so, never "ready".
		const [blank] = await db
			.insert(schema.connections)
			.values({ name: "Comfy 2", type: CONNECTION_TYPE.COMFYUI, modality: "image-gen", extraJson: {} } as any)
			.returning()
		const none = await workflowsOnServer.handler(ADMIN, { connectionId: blank!.id }, () => {})
		expect(none!.checked).toBe(false)
		expect(validityChip(byName.get("SDXL text-to-image")!, none).tone).toBe("unchecked")
	})
})
