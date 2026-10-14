/**
 * 🚧 *Draw a test* with a workflow (DESIGN-image-generation §4.8 step 5):
 * `images:generate` and `images:drawingSheet` take a `workflowId`. A
 * template-payload connection (ComfyUI) refuses a test that names none, draws
 * with the named one (no registered model needed — the checkpoint is a hole),
 * and draws at the workflow's own dials — its variables' defaults — unless an
 * image sampling config is named (§7.1, as reversed 2026-10-12: workflows
 * have no sampling configs); the sheet asked of a workflow is the
 * workflow's, echoed with its id.
 *
 * Everything below the handler is stubbed: the point is what the handler
 * hands the adapter.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { S } from "@serene-pub/sdk"

const PNG_1x1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

const comfy = {
	id: 5,
	type: "comfyui",
	name: "My ComfyUI",
	modality: "image-gen",
	baseUrl: "http://127.0.0.1:8188",
	extraJson: {}
}

const WORKFLOW = {
	id: 42,
	name: "LoRA portrait",
	dialect: "comfyui",
	document: "{}",
	variables: [
		{ name: "steps", type: "integer", default: 30 },
		{ name: "lora_strength", type: "number", default: 0.8 }
	],
	outputNode: "9"
}

const IMAGE_CONFIG = {
	id: 300,
	name: "Fast",
	seedKey: null,
	shape: S.imageGen,
	values: { steps: 12 },
	enabled: ["steps"]
}

const TEMPLATE_SHEET = {
	negative: true,
	seed: true,
	steps: true,
	cfg: false,
	sampler: false,
	clipSkip: false,
	size: { kind: "free", step: 8, min: 64, max: 4096 },
	references: null,
	init: false,
	mask: false,
	transparent: "none",
	perCall: 8,
	outputs: { perRun: 1, keyed: true },
	progress: true,
	preview: true,
	cancel: true,
	video: false,
	payload: "template"
}

let calls: Array<{ req: any; opts: any }> = []

class CaptureAdapter {
	constructor(public connection: any) {}
	async generateImage(req: any, opts: any) {
		calls.push({ req, opts })
		return {
			media: [{ kind: "image", mime: "image/png", base64: PNG_1x1 }],
			isAborted: false,
			applied: [],
			ignored: []
		}
	}
}

vi.mock("$lib/server/utils/getImageAdapter", () => ({
	getImageAdapter: async () => ({
		Adapter: CaptureAdapter,
		sheet: TEMPLATE_SHEET,
		sheetForWorkflow: async (_c: unknown, w: { id: number }) => ({
			...TEMPLATE_SHEET,
			negative: w.id === 42
		})
	})
}))

vi.mock("$lib/server/imageGen/comfy/workflows", () => ({
	getWorkflowDocument: async (_db: unknown, id: number) => (id === 42 ? WORKFLOW : null)
}))

vi.mock("$lib/server/media", () => ({
	createMedia: async (_db: any, input: any) => ({
		file: {
			id: 1,
			uuid: "u",
			rev: 1,
			kind: "image",
			displayMime: "image/png",
			width: 1,
			height: 1,
			filename: input.filename
		},
		original: { mime: "image/png" }
	}),
	mediaUrl: (uuid: string, rev: number) => `/media/${uuid}?r=${rev}`
}))

vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			connections: { findFirst: async () => comfy },
			samplingConfigs: { findFirst: async () => IMAGE_CONFIG }
		},
		select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) })
	}
}))

vi.mock("$lib/server/pipelines/runtime/capabilityGuard", () => ({
	capabilityRefusal: () => null
}))

// No `text->image` registration names this endpoint: a ComfyUI test needs none.
vi.mock("$lib/server/connections/capabilityDefaults", () => ({
	capabilityDefault: async () => null
}))

vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: string) => v
}))

const ADMIN = { user: { id: 1, isAdmin: true } } as any

beforeEach(() => {
	calls = []
})

describe("images:generate with a workflow", () => {
	it("refuses a ComfyUI test that names no workflow", async () => {
		const { imagesGenerate } = await import("./images")
		const res = await imagesGenerate.handler(ADMIN, { connectionId: 5, prompt: "a fox" }, () => {})
		expect(res.ok).toBe(false)
		expect(res.error).toBe("Choose a workflow to draw the test with.")
		expect(calls).toHaveLength(0)
	})

	it("draws with the named workflow at its variables' defaults, no config needed", async () => {
		const { imagesGenerate } = await import("./images")
		const res = await imagesGenerate.handler(
			ADMIN,
			{ connectionId: 5, prompt: "a fox", workflowId: 42 },
			() => {}
		)
		expect(res.ok).toBe(true)
		expect(calls).toHaveLength(1)
		expect(calls[0]!.opts.workflow).toEqual(WORKFLOW)
		// No sampling config: the request sets no knob, and the workflow's own
		// defaults ride along as its dial values.
		expect(calls[0]!.req.steps).toBeUndefined()
		expect(calls[0]!.req.workflowValues).toEqual({ steps: 30, lora_strength: 0.8 })
	})

	it("lets a named image config set the knobs the workflow reads", async () => {
		const { imagesGenerate } = await import("./images")
		const res = await imagesGenerate.handler(
			ADMIN,
			{ connectionId: 5, prompt: "a fox", workflowId: 42, samplingConfigId: 300 },
			() => {}
		)
		expect(res.ok).toBe(true)
		// The request's own field wins over the default in the adapter.
		expect(calls[0]!.req.steps).toBe(12)
		expect(calls[0]!.req.workflowValues).toEqual({ steps: 30, lora_strength: 0.8 })
	})

	it("refuses a workflow that no longer exists", async () => {
		const { imagesGenerate } = await import("./images")
		const res = await imagesGenerate.handler(
			ADMIN,
			{ connectionId: 5, prompt: "a fox", workflowId: 7 },
			() => {}
		)
		expect(res.ok).toBe(false)
		expect(res.error).toBe("That workflow no longer exists.")
	})
})

describe("images:drawingSheet with a workflow", () => {
	it("answers the workflow's sheet on that connection, echoing its id", async () => {
		const { imagesDrawingSheet } = await import("./images")
		const emitted: any[] = []
		const res = await imagesDrawingSheet.handler(
			ADMIN,
			{ connectionId: 5, workflowId: 42 },
			(_e, d) => emitted.push(d)
		)
		expect(res.workflowId).toBe(42)
		expect(res.sheet?.payload).toBe("template")
		expect(res.sheet?.negative).toBe(true)
		expect(res.drops).toEqual(expect.arrayContaining(["cfg", "sampler"]))
		expect(emitted[0]).toEqual(res)
	})
})
