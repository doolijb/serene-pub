import { describe, expect, it } from "vitest"
import { imageSamplingSchema, S } from "@serene-pub/sdk"
import type { WorkflowVariable } from "./types"
import { workflowDialDefaults, workflowDialsSchema } from "./workflowShape"
import { samplingShapeForCapability } from "$lib/shared/capabilities/samplingShape"
import { sheetSentence } from "./sheetSentence"

const VARS: WorkflowVariable[] = [
	{ name: "prompt", type: "string", default: "a picture" },
	{ name: "negative", type: "string", default: "" },
	{ name: "seed", type: "integer", default: 0 },
	{ name: "steps", type: "integer", default: 30 },
	{ name: "count", type: "integer", default: 1 },
	{ name: "sampler", type: "enum", default: "euler", enumSource: "objectInfo:KSampler.sampler_name" },
	{ name: "model", type: "enum", default: "sdxl.safetensors", enumSource: "objectInfo:CheckpointLoaderSimple.ckpt_name" },
	{ name: "references.[0].filename", type: "string", default: "ref.png" },
	{ name: "lora_strength", type: "number", default: 0.8, min: 0, max: 2, step: 0.05, group: "LoRA" },
	{ name: "lora_name", type: "enum", default: "detail.safetensors", enumSource: "objectInfo:LoraLoader.lora_name" },
	{ name: "upscale_note", type: "string", default: "4x" },
	{ name: "hires", type: "boolean", default: true }
]

const ENUMS = {
	"KSampler.sampler_name": ["euler", "dpmpp_2m"],
	"LoraLoader.lora_name": ["style.safetensors"]
}

describe("workflowDialsSchema", () => {
	const schema = workflowDialsSchema(VARS, ENUMS)

	it("is exactly the workflow's dials — nothing the step or the pair feeds", () => {
		expect(Object.keys(schema).sort()).toEqual(
			["batch", "hires", "lora_name", "lora_strength", "sampler", "seed", "steps", "upscale_note"].sort()
		)
	})

	it("reuses the image schema's field for a standard dial", () => {
		expect(schema.steps).toEqual(imageSamplingSchema.steps)
		// `count` is the image schema's `batch`.
		expect(schema.batch).toEqual(imageSamplingSchema.batch)
	})

	it("types a promoted dial from its declaration, the literal as default", () => {
		expect(schema.lora_strength).toMatchObject({
			type: "number",
			default: 0.8,
			min: 0,
			max: 2,
			step: 0.05,
			group: "LoRA",
			label: "Lora strength"
		})
		expect(schema.hires).toMatchObject({ type: "boolean", default: true })
		expect(schema.upscale_note).toMatchObject({ type: "string", default: "4x" })
	})

	it("fills an enum from the server's list, keeping a baked name it lacks", () => {
		expect(schema.lora_name).toMatchObject({
			type: "enum",
			of: ["detail.safetensors", "style.safetensors"]
		})
		expect(schema.sampler).toMatchObject({ type: "enum", of: ["euler", "dpmpp_2m"] })
		// No server read yet: free text, never a list nobody has seen.
		expect(workflowDialsSchema(VARS).lora_name).toMatchObject({ type: "string" })
	})

})

describe("workflowDialDefaults — the base dial values a render starts from", () => {
	it("is every dial's own default, by variable name, and nothing the step feeds", () => {
		expect(workflowDialDefaults(VARS)).toEqual({
			seed: 0,
			steps: 30,
			count: 1,
			sampler: "euler",
			lora_strength: 0.8,
			lora_name: "detail.safetensors",
			upscale_note: "4x",
			hires: true
		})
		expect(workflowDialDefaults(null)).toEqual({})
	})
})

describe("a ComfyUI pair's sampling vocabulary (ruling 13 reversed 2026-10-12)", () => {
	it("is the image one, like any image pair — workflows have no shape of their own", () => {
		expect(samplingShapeForCapability("text->image")).toBe(S.imageGen)
	})
})

describe("sheetSentence", () => {
	it("says the plan's sentence for a prompt/negative/seed/size/1-reference workflow", () => {
		expect(
			sheetSentence({
				negative: true,
				seed: true,
				steps: false,
				cfg: false,
				sampler: false,
				clipSkip: false,
				size: { kind: "free", step: 8, min: 64, max: 4096 },
				references: { max: 1 },
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
			})
		).toBe(
			"This workflow takes a prompt, a negative, a seed, a size and 1 reference image. It makes 1 picture per run. No transparent output: the cut-out step will run for sprites."
		)
	})
})
