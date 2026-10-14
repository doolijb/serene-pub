import { describe, expect, it } from "vitest"
import { applyFit, fitComfyWorkflow } from "./fit"
import { UI_FORMAT_REFUSAL } from "./graph"
import { SDXL_IPADAPTER_EXPORT } from "./fixtures/sdxlIpAdapter"
import { deriveComfySheet, renderWorkflow, defaultScope, mergeScope } from "./render"

const hole = (p: ReturnType<typeof fitComfyWorkflow>, at: string) =>
	p.holes.find((h) => `${h.nodeId}.${h.inputKey}` === at)

describe("fitComfyWorkflow — the walk", () => {
	const p = fitComfyWorkflow(SDXL_IPADAPTER_EXPORT)

	it("finds the prompt and negative through the main sampler", () => {
		expect(hole(p, "6.text")).toMatchObject({ variable: "prompt", suggested: true, standard: true })
		expect(hole(p, "7.text")).toMatchObject({ variable: "negative", suggested: true })
	})

	it("reads size and batch off the empty latent", () => {
		expect(hole(p, "5.width")).toMatchObject({ variable: "width", literal: 832 })
		expect(hole(p, "5.height")).toMatchObject({ variable: "height", literal: 1216 })
		expect(hole(p, "5.batch_size")).toMatchObject({ variable: "count", literal: 1 })
	})

	it("walks model back through IP-Adapter and LoRA to the checkpoint, promoted by default", () => {
		expect(hole(p, "4.ckpt_name")).toMatchObject({
			variable: "model",
			suggested: true,
			enumSource: "objectInfo:CheckpointLoaderSimple.ckpt_name"
		})
	})

	it("takes the main sampler's knobs and leaves the second pass promotable", () => {
		for (const [at, v] of [
			["3.seed", "seed"],
			["3.steps", "steps"],
			["3.cfg", "cfg"],
			["3.sampler_name", "sampler"],
			["3.scheduler", "scheduler"]
		])
			expect(hole(p, at)).toMatchObject({ variable: v, suggested: true })
		// One seed for every pass; the second pass's steps are its own.
		expect(hole(p, "22.seed")).toMatchObject({ variable: "seed", suggested: true })
		expect(hole(p, "22.steps")).toMatchObject({ suggested: false, standard: false })
		expect(hole(p, "22.steps")!.variable).not.toBe("steps")
	})

	it("decides the LoadImage is a reference by what reads it", () => {
		expect(hole(p, "12.image")).toMatchObject({ variable: "references.[0].filename", suggested: true })
	})

	it("offers the LoRA and IP-Adapter literals as promotable, unchosen", () => {
		expect(hole(p, "10.lora_name")).toMatchObject({ suggested: false, enumSource: "objectInfo:LoraLoader.lora_name" })
		expect(hole(p, "13.weight")).toMatchObject({ suggested: false, literal: 0.85 })
	})

	it("marks the SaveImage fed by the final decode, keeps the other as an extra, and skips the preview", () => {
		expect(p.outputs).toEqual(
			expect.arrayContaining([
				{ nodeId: "9", classType: "SaveImage", role: "output" },
				{ nodeId: "24", classType: "SaveImage", role: "extra" },
				{ nodeId: "20", classType: "PreviewImage", role: "preview" }
			])
		)
	})

	it("refuses the UI format by name", () => {
		const ui = fitComfyWorkflow({ nodes: [], links: [], version: 0.4 })
		expect(ui.holes).toEqual([])
		expect(ui.warnings).toEqual([UI_FORMAT_REFUSAL])
	})

	it("names missing nodes when the server's object_info is given", () => {
		const q = fitComfyWorkflow(SDXL_IPADAPTER_EXPORT, {
			classes: ["CheckpointLoaderSimple", "CLIPTextEncode", "KSampler", "EmptyLatentImage", "VAEDecode", "SaveImage", "PreviewImage", "LoadImage", "LatentUpscaleBy", "LoraLoader"],
			enums: { "LoraLoader.lora_name": ["pixel-art-xl.safetensors"] }
		})
		expect(q.warnings).toContain("Missing nodes: IPAdapter, IPAdapterUnifiedLoader")
	})

	it("recognises marker nodes as declared variables", () => {
		const q = fitComfyWorkflow({
			"1": { class_type: "SwarmInputFloat", inputs: { title: "Lora Strength", value: 0.6, min: 0, max: 2, step: 0.05 } },
			"2": { class_type: "ETN_Parameter", inputs: { name: "Prompt", type: "prompt (positive)", default: "a cat" } },
			"3": { class_type: "ComfyUIDeployExternalNumberInt", inputs: { input_id: "steps", default_value: 12, min_value: 1, max_value: 60 } }
		})
		expect(hole(q, "1.value")).toMatchObject({ variable: "lora_strength", min: 0, max: 2, step: 0.05, markerType: "number", label: "Lora Strength" })
		expect(hole(q, "2.default")).toMatchObject({ variable: "prompt", standard: true })
		expect(hole(q, "3.default_value")).toMatchObject({ variable: "steps", standard: true, markerType: "integer", min: 1, max: 60 })
	})
})

describe("applyFit — holes into the document", () => {
	const p = fitComfyWorkflow(SDXL_IPADAPTER_EXPORT)
	const applied = applyFit(SDXL_IPADAPTER_EXPORT, p)

	it("writes numbers unquoted and strings quoted", () => {
		expect(applied.document).toContain('"seed": {{seed}}')
		expect(applied.document).toContain('"width": {{width}}')
		expect(applied.document).toContain('"text": "{{prompt}}"')
		expect(applied.document).toContain('"ckpt_name": "{{model}}"')
		expect(applied.document).toContain('"image": "{{references.[0].filename}}"')
		// Unchosen literals stay literal.
		expect(applied.document).toContain('"lora_name": "pixel-art-xl.safetensors"')
	})

	it("marks the output and gives it the tidy filename prefix", () => {
		expect(applied.outputNode).toBe("9")
		expect(applied.document).toContain('"filename_prefix": "serene/{{runId}}/{{key}}"')
	})

	it("declares every variable with the literal as its default", () => {
		const v = Object.fromEntries(applied.variables.map((x) => [x.name, x]))
		expect(v.seed).toMatchObject({ type: "integer", default: 123456 })
		expect(v.cfg).toMatchObject({ type: "number", default: 6.5 })
		expect(v.model).toMatchObject({ type: "enum", default: "juggernautXL_v9.safetensors", enumSource: "objectInfo:CheckpointLoaderSimple.ckpt_name" })
		expect(v.prompt).toMatchObject({ type: "string", default: "a knight, smiling" })
	})

	it("promotes a chosen LoRA with an enum source", () => {
		const chosen = [...p.holes.filter((h) => h.suggested), hole(p, "10.lora_name")!].map((h) => `${h.nodeId}.${h.inputKey}`)
		const a = applyFit(SDXL_IPADAPTER_EXPORT, p, chosen)
		const lora = a.variables.find((v) => v.enumSource === "objectInfo:LoraLoader.lora_name")!
		expect(lora).toMatchObject({ type: "enum", default: "pixel-art-xl.safetensors", group: "Workflow" })
		expect(a.document).toContain(`"lora_name": "{{${lora.name}}}"`)
	})

	it("renders back to a valid graph, escaping a prompt with quotes", async () => {
		const graph = await renderWorkflow(
			applied.document,
			mergeScope(defaultScope(applied.variables), {
				prompt: 'a "brave" knight & <dragon>',
				seed: 7,
				runId: "r1",
				key: "1"
			})
		)
		expect(graph["6"]!.inputs.text).toBe('a "brave" knight & <dragon>')
		expect(graph["3"]!.inputs.seed).toBe(7)
		expect(graph["9"]!.inputs.filename_prefix).toBe("serene/r1/1")
	})
})

describe("the drawing sheet, derived from the workflow", () => {
	it("honours exactly what the document reads", async () => {
		const p = fitComfyWorkflow(SDXL_IPADAPTER_EXPORT)
		const a = applyFit(SDXL_IPADAPTER_EXPORT, p)
		const sheet = await deriveComfySheet(a, 6)
		expect(sheet).toMatchObject({
			negative: true,
			seed: true,
			steps: true,
			cfg: true,
			sampler: true,
			clipSkip: false,
			size: { kind: "free" },
			references: { max: 1 },
			init: false,
			mask: false,
			transparent: "none",
			perCall: 6,
			outputs: { perRun: 1, keyed: true },
			payload: "template"
		})
	})

	it("bakes the size into an enum when width and height stay literal, and reads perRun off the batch", async () => {
		const p = fitComfyWorkflow(SDXL_IPADAPTER_EXPORT)
		const chosen = p.holes
			.filter((h) => h.suggested && !["width", "height", "count", "negative"].includes(h.variable))
			.map((h) => `${h.nodeId}.${h.inputKey}`)
		const graph = structuredClone(SDXL_IPADAPTER_EXPORT)
		graph["5"]!.inputs.batch_size = 4
		const a = applyFit(graph, fitComfyWorkflow(graph), chosen)
		const sheet = await deriveComfySheet(a)
		expect(sheet.size).toEqual({ kind: "enum", sizes: ["832x1216"] })
		expect(sheet.negative).toBe(false)
		expect(sheet.outputs.perRun).toBe(4)
		expect(sheet.perCall).toBe(8)
	})
})
