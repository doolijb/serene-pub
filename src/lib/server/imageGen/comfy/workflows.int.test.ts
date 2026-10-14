/**
 * The workflows entity on a real database: starters seed by key and stay
 * read-only, imports fit or refuse, and a check against a ComfyUI is recorded
 * on the connection so its row can say what is missing.
 */
import { beforeEach, describe, expect, it } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { seedWorkflows, STARTER_WORKFLOWS } from "./starters"
import {
	deleteWorkflow,
	duplicateWorkflow,
	exportWorkflow,
	importWorkflow,
	listWorkflows,
	STARTER_READ_ONLY,
	updateWorkflow
} from "./workflows"
import { UI_FORMAT_REFUSAL } from "./graph"
import { SDXL_IPADAPTER_EXPORT } from "./fixtures/sdxlIpAdapter"
import { asDocument, checkWorkflowOnConnection, comfyFactsOf, forgetWorkflow, recordComfyTest } from "./serverCheck"

let db: TestDb

beforeEach(async () => {
	db = await createTestDb()
}, 60_000)

const INFO = {
	classes: ["CheckpointLoaderSimple", "CLIPTextEncode", "KSampler", "EmptyLatentImage", "VAEDecode", "SaveImage"],
	enums: { "CheckpointLoaderSimple.ckpt_name": ["sd_xl_base_1.0.safetensors"] }
}

describe("workflows", () => {
	it("seeds the six starters by key, idempotently, and refuses to edit or delete them", async () => {
		await seedWorkflows(db as any)
		await seedWorkflows(db as any)
		const rows = await listWorkflows(db as any)
		expect(rows.filter((r) => r.isStarter).map((r) => r.seedKey).sort()).toEqual(
			STARTER_WORKFLOWS.map((s) => s.seedKey).sort()
		)
		const starter = rows.find((r) => r.isStarter)!
		await expect(updateWorkflow(db as any, starter.id, { name: "mine" })).rejects.toThrow(STARTER_READ_ONLY)
		await expect(deleteWorkflow(db as any, starter.id)).rejects.toThrow(STARTER_READ_ONLY)
		const copy = await duplicateWorkflow(db as any, starter.id)
		expect(copy.seedKey).toBeNull()
		const renamed = await updateWorkflow(db as any, copy.id, { name: "Mine" })
		expect(renamed.name).toBe("Mine")
	})

	it("imports a raw API export through the walk, and refuses the UI format by name", async () => {
		const { row, proposal } = await importWorkflow(db as any, JSON.stringify(SDXL_IPADAPTER_EXPORT), { name: "Knight" })
		expect(row.outputNode).toBe("9")
		expect(row.document).toContain('"text": "{{prompt}}"')
		expect(proposal?.holes.length).toBeGreaterThan(5)
		await expect(importWorkflow(db as any, JSON.stringify({ nodes: [], links: [] }))).rejects.toThrow(UI_FORMAT_REFUSAL)
		// Our own export round-trips; the plain-ComfyUI one is a filled graph.
		const file = await exportWorkflow(db as any, row.id)
		const back = await importWorkflow(db as any, file.content)
		expect(back.row.document).toBe(row.document)
		const plain = JSON.parse((await exportWorkflow(db as any, row.id, { withDefaults: true })).content)
		expect(plain["6"].inputs.text).toBe("a knight, smiling")
	})

	it("records a check on the connection, re-checks on test, and forgets a deleted workflow", async () => {
		const [conn] = await db
			.insert(schema.connections)
			.values({ name: "Comfy", type: CONNECTION_TYPE.COMFYUI, modality: "image-gen", baseUrl: "http://comfy:8188", extraJson: { comfy: { objectInfo: INFO } } } as any)
			.returning()
		const { row } = await importWorkflow(db as any, JSON.stringify(SDXL_IPADAPTER_EXPORT), { name: "Knight" })
		const result = await checkWorkflowOnConnection(db as any, conn as any, asDocument(row))
		expect(result.problem).toMatch(/^Missing nodes: IPAdapter, IPAdapterUnifiedLoader, LatentUpscaleBy, LoadImage, LoraLoader, PreviewImage/)
		let stored = await db.query.connections.findFirst({ where: (c, { eq }) => eq(c.id, conn!.id) })
		expect(comfyFactsOf(stored).problem).toBe(result.problem)

		// A test against a server that now has everything clears it.
		const everything = { classes: [...new Set(Object.values(SDXL_IPADAPTER_EXPORT).map((n) => n.class_type))], enums: {} }
		const extra: Record<string, unknown> = { comfy: { objectInfo: everything } }
		await recordComfyTest(db as any, conn!.id, extra)
		expect((extra.comfy as any).objectInfo).toBeUndefined()
		stored = await db.query.connections.findFirst({ where: (c, { eq }) => eq(c.id, conn!.id) })
		expect(comfyFactsOf(stored).problem).toBeNull()

		await forgetWorkflow(db as any, row.id)
		stored = await db.query.connections.findFirst({ where: (c, { eq }) => eq(c.id, conn!.id) })
		expect(comfyFactsOf(stored).checks).toEqual({})
	})
})
