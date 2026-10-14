import { describe, expect, it } from "vitest"
import { checkGraphAgainst, modelNamesOf, summariseObjectInfo, workflowProblem } from "./objectInfo"
import { checkWorkflow } from "./serverCheck"
import { STARTER_WORKFLOWS } from "./starters"

const RAW = {
	CheckpointLoaderSimple: { input: { required: { ckpt_name: [["sd_xl_base_1.0.safetensors", "other.safetensors"], {}] } } },
	UNETLoader: { input: { required: { unet_name: ["COMBO", { options: ["flux1-dev.safetensors"] }], weight_dtype: [["default"]] } } },
	KSampler: {
		input: {
			required: {
				seed: ["INT", {}],
				sampler_name: [["euler", "dpmpp_2m"]],
				scheduler: [["normal", "karras"]]
			}
		}
	},
	CLIPTextEncode: { input: { required: { text: ["STRING", {}] } } },
	EmptyLatentImage: { input: { required: {} } },
	VAEDecode: { input: { required: {} } },
	SaveImage: { input: { required: {} } },
	LoadImage: { input: { required: { image: [["a.png", "b.png"]] } } }
}

describe("object_info", () => {
	const info = summariseObjectInfo(RAW)

	it("summarises classes and enums, both spellings, never the upload list", () => {
		expect(info.classes).toContain("KSampler")
		expect(info.enums["CheckpointLoaderSimple.ckpt_name"]).toEqual(["sd_xl_base_1.0.safetensors", "other.safetensors"])
		expect(info.enums["UNETLoader.unet_name"]).toEqual(["flux1-dev.safetensors"])
		expect(info.enums["LoadImage.image"]).toBeUndefined()
	})

	it("lists the checkpoints and UNETs as the connection's models", () => {
		expect(modelNamesOf(info)).toEqual(["sd_xl_base_1.0.safetensors", "other.safetensors", "flux1-dev.safetensors"])
	})

	it("names missing nodes and missing literals in the ruled copy", () => {
		const check = checkGraphAgainst(
			{
				"1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sdxl_base.safetensors" } },
				"2": { class_type: "IPAdapterApply", inputs: {} },
				"3": { class_type: "LayerDiffuseApply", inputs: {} },
				"4": { class_type: "KSampler", inputs: { sampler_name: "euler", scheduler: "karras" } }
			},
			info
		)
		expect(check.missingNodes).toEqual(["IPAdapterApply", "LayerDiffuseApply"])
		expect(workflowProblem(check)).toBe(
			"Missing nodes: IPAdapterApply, LayerDiffuseApply · This workflow names sdxl_base.safetensors; your ComfyUI doesn't have it."
		)
	})

	it("skips holes the host fills (the pair's checkpoint)", async () => {
		const sdxl = STARTER_WORKFLOWS.find((s) => s.seedKey === "workflow-comfyui-sdxl-txt2img")!
		const ok = await checkWorkflow(sdxl, info)
		expect(ok.problem).toBeNull()
		const sd15 = STARTER_WORKFLOWS.find((s) => s.seedKey === "workflow-comfyui-flux-gguf-txt2img")!
		const miss = await checkWorkflow(sd15, info)
		expect(miss.problem).toMatch(/^Missing nodes: .*UnetLoaderGGUF/)
		// The baked VAE/CLIP names are literals, so they are checked — but only
		// against enums the server lists; these classes are missing outright.
		expect(miss.check.missingNames).toEqual([])
	})
})
