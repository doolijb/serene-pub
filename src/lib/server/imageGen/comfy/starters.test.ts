import { describe, expect, it } from "vitest"
import { STARTER_SOURCES, STARTER_WORKFLOWS } from "./starters"
import { fitComfyWorkflow } from "./fit"
import { deriveComfySheet, readsOf, sampleRender } from "./render"

describe("the starter workflows", () => {
	it("are six, by seed key", () => {
		expect(STARTER_WORKFLOWS.map((s) => s.seedKey)).toEqual([
			"workflow-comfyui-sd15-txt2img",
			"workflow-comfyui-sdxl-txt2img",
			"workflow-comfyui-flux-gguf-txt2img",
			"workflow-comfyui-flux-kontext-reference",
			"workflow-comfyui-sdxl-ipadapter-sprite",
			"workflow-comfyui-sdxl-layerdiffuse-cutout"
		])
	})

	for (const s of STARTER_SOURCES)
		it(`${s.name}: its source fits with no warnings and a marked output`, () => {
			const p = fitComfyWorkflow(s.graph)
			expect(p.warnings).toEqual([])
			expect(p.outputs.filter((o) => o.role === "output")).toHaveLength(1)
		})

	for (const s of STARTER_WORKFLOWS)
		it(`${s.name}: renders with its defaults, reads prompt and model, and the mark exists`, async () => {
			const { graph } = await sampleRender(s)
			expect(graph[s.outputNode!]?.class_type).toBe("SaveImage")
			const reads = readsOf(s.document)
			expect(reads.has("prompt")).toBe(true)
			expect(reads.has("model")).toBe(true)
			expect(reads.has("seed")).toBe(true)
		})

	it("say honestly what they take", async () => {
		const sheet = async (k: string) => deriveComfySheet(STARTER_WORKFLOWS.find((s) => s.seedKey === k)!)
		expect((await sheet("workflow-comfyui-flux-gguf-txt2img")).negative).toBe(false)
		expect((await sheet("workflow-comfyui-flux-gguf-txt2img")).cfg).toBe(false)
		expect((await sheet("workflow-comfyui-flux-kontext-reference")).references).toEqual({ max: 1 })
		expect((await sheet("workflow-comfyui-sdxl-ipadapter-sprite")).references).toEqual({ max: 1 })
		expect((await sheet("workflow-comfyui-sdxl-layerdiffuse-cutout")).transparent).toBe("native")
		expect((await sheet("workflow-comfyui-sdxl-txt2img")).transparent).toBe("none")
	})

	it("the sprite keeps its plain background phrase after the prompt", () => {
		const s = STARTER_WORKFLOWS.find((x) => x.seedKey === "workflow-comfyui-sdxl-ipadapter-sprite")!
		expect(s.document).toContain('"{{prompt}}, full body, standing, centered, plain flat green background"')
	})

	it("the cut-out saves the alpha decode only when transparency is asked for", async () => {
		const s = STARTER_WORKFLOWS.find((x) => x.seedKey === "workflow-comfyui-sdxl-layerdiffuse-cutout")!
		const { renderWorkflow, defaultScope, mergeScope } = await import("./render")
		const on = await renderWorkflow(s.document, mergeScope(defaultScope(s.variables), { transparent: true, runId: "r", key: "1" }))
		const off = await renderWorkflow(s.document, mergeScope(defaultScope(s.variables), { transparent: false, runId: "r", key: "1" }))
		expect(on[s.outputNode!]!.inputs.images).toEqual(["8", 0])
		expect(off[s.outputNode!]!.inputs.images).toEqual(["7", 0])
	})
})
