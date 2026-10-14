import { describe, expect, it } from "vitest"
import { chunkSeries, keyOfNodeId, mergeKeyedRenders, prefixGraph } from "./merge"
import { STARTER_WORKFLOWS } from "./starters"
import { defaultScope, mergeScope, renderWorkflow } from "./render"

const sdxl = STARTER_WORKFLOWS.find((s) => s.seedKey === "workflow-comfyui-sdxl-ipadapter-sprite")!

const renderFor = (key: string, prompt: string, seed: number) =>
	renderWorkflow(
		sdxl.document,
		mergeScope(defaultScope(sdxl.variables), {
			prompt,
			key,
			seed,
			runId: "run",
			references: [{ filename: "serene-abc.png" }]
		})
	)

describe("the series merge", () => {
	it("prefixes ids and rewrites links alike", () => {
		const g = prefixGraph({ "1": { class_type: "A", inputs: {} }, "2": { class_type: "B", inputs: { x: ["1", 0], n: 3 } } }, "joy")
		expect(Object.keys(g)).toEqual(["joy:1", "joy:2"])
		expect(g["joy:2"]!.inputs).toEqual({ x: ["joy:1", 0], n: 3 })
	})

	it("merges three items into one prompt: loader and reference once, outputs keyed", async () => {
		const renders = [
			{ key: "joy", graph: await renderFor("joy", "smiling", 1) },
			{ key: "anger", graph: await renderFor("anger", "scowling", 2) },
			{ key: "sad", graph: await renderFor("sad", "crying", 3) }
		]
		const { prompt, outputs } = mergeKeyedRenders(renders, sdxl.outputNode)
		const byClass = (c: string) => Object.entries(prompt).filter(([, n]) => n.class_type === c)
		// Shared by content: one checkpoint, one IP-Adapter loader, one reference, one negative.
		expect(byClass("CheckpointLoaderSimple")).toHaveLength(1)
		expect(byClass("IPAdapterUnifiedLoader")).toHaveLength(1)
		expect(byClass("LoadImage")).toHaveLength(1)
		expect(byClass("IPAdapter")).toHaveLength(1)
		expect(byClass("EmptyLatentImage")).toHaveLength(1)
		// Per item: its own prompt, sampler, decode and output.
		expect(byClass("KSampler")).toHaveLength(3)
		expect(byClass("SaveImage")).toHaveLength(3)
		expect(byClass("CLIPTextEncode")).toHaveLength(4)
		expect(outputs).toEqual({ joy: `joy:${sdxl.outputNode}`, anger: `anger:${sdxl.outputNode}`, sad: `sad:${sdxl.outputNode}` })
		for (const [key, id] of Object.entries(outputs)) {
			expect(keyOfNodeId(id)).toBe(key)
			expect(prompt[id]!.inputs.filename_prefix).toBe(`serene/run/${key}`)
		}
		// Every link resolves to a node in the merged prompt.
		for (const node of Object.values(prompt))
			for (const v of Object.values(node.inputs))
				if (Array.isArray(v) && typeof v[0] === "string") expect(prompt[v[0]]).toBeDefined()
		// The anger sampler reads the shared (deduped) model chain, not a copy.
		const angerSampler = Object.entries(prompt).find(([id, n]) => id.startsWith("anger:") && n.class_type === "KSampler")![1]
		expect((angerSampler.inputs.model as [string, number])[0]).toMatch(/^joy:/)
	})

	it("chunks at seriesMax", () => {
		expect(chunkSeries([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
	})
})
