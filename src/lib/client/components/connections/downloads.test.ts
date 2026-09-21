import { describe, expect, test } from "vitest"
import {
	aggregate,
	kcppBinaryItem,
	kcppItems,
	ollamaItems,
	onnxItems
} from "./downloads.svelte"

describe("the four feeds reconcile to one shape", () => {
	test("KoboldCPP model downloads", () => {
		expect(
			kcppItems({
				a: {
					filename: "qwen3-8b.gguf",
					modelName: "Qwen3 8B",
					status: "downloading",
					downloaded: 400,
					total: 1200,
					isDone: false
				},
				b: {
					filename: "old.gguf",
					status: "error",
					downloaded: 1,
					total: 2,
					isDone: true
				}
			})
		).toEqual([
			{
				id: "koboldcpp:qwen3-8b.gguf",
				source: "koboldcpp",
				destinationLabel: "KoboldCPP",
				name: "Qwen3 8B",
				downloadedBytes: 400,
				totalBytes: 1200,
				state: "in_flight"
			},
			{
				id: "koboldcpp:old.gguf",
				source: "koboldcpp",
				destinationLabel: "KoboldCPP",
				name: "old.gguf",
				downloadedBytes: 1,
				totalBytes: 2,
				state: "failed"
			}
		])
	})

	test("the KoboldCPP binary is one item, or none", () => {
		expect(kcppBinaryItem(null)).toBeNull()
		expect(
			kcppBinaryItem({
				assetName: "koboldcpp-linux-x64",
				status: "downloading",
				downloaded: 10,
				total: 100,
				isDone: false
			})
		).toMatchObject({
			id: "koboldcpp-binary",
			source: "koboldcpp-binary",
			name: "koboldcpp-linux-x64",
			state: "in_flight"
		})
	})

	test("an Ollama pull sums its blobs into one line", () => {
		expect(
			ollamaItems({
				undefined: { isDone: false },
				"llama3.1:8b": {
					modelName: "llama3.1:8b",
					isDone: false,
					files: {
						one: { total: 100, completed: 100 },
						two: { total: 300, completed: 50 }
					}
				}
			})
		).toEqual([
			{
				id: "ollama:llama3.1:8b",
				source: "ollama",
				destinationLabel: "Ollama",
				name: "llama3.1:8b",
				downloadedBytes: 150,
				totalBytes: 400,
				state: "in_flight"
			}
		])
	})

	test("the ONNX feed comes off the list rows, downloading and failed only", () => {
		expect(
			onnxItems([
				{
					id: 7,
					name: "Embeddings",
					models: [
						{
							id: 71,
							name: "bge-large",
							local: {
								state: "downloading",
								percent: 40,
								downloadedBytes: 40,
								totalBytes: 100
							}
						},
						{
							id: 72,
							name: "bge-small",
							local: { state: "on_disk" }
						},
						{
							id: 73,
							name: "broken",
							local: { state: "error", error: "404" }
						}
					]
				}
			]).map((i) => [i.id, i.state])
		).toEqual([
			["onnx:7:71", "in_flight"],
			["onnx:7:73", "failed"]
		])
	})
})

describe("aggregate — bytes, and a refusal to guess", () => {
	const item = (over: Record<string, unknown> = {}) => ({
		id: String(Math.random()),
		source: "onnx" as const,
		destinationLabel: "x",
		name: "y",
		state: "in_flight" as const,
		...over
	})

	test("adds the in-flight bytes into one percentage", () => {
		expect(
			aggregate([
				item({ downloadedBytes: 50, totalBytes: 100 }),
				item({ downloadedBytes: 100, totalBytes: 300 })
			])
		).toEqual({ inFlight: 2, percent: 37.5, finished: 0, failed: 0 })
	})

	test("one unknown total makes the whole bar null rather than wrong", () => {
		expect(
			aggregate([
				item({ downloadedBytes: 50, totalBytes: 100 }),
				item({ downloadedBytes: 10 })
			]).percent
		).toBeNull()
	})

	test("nothing in flight is no bar at all", () => {
		expect(aggregate([])).toEqual({
			inFlight: 0,
			percent: null,
			finished: 0,
			failed: 0
		})
	})

	test("counts what has finished and what failed", () => {
		expect(
			aggregate([
				item({ state: "done" }),
				item({ state: "failed" }),
				item({ state: "cancelling", downloadedBytes: 1, totalBytes: 2 })
			])
		).toEqual({ inFlight: 1, percent: 50, finished: 1, failed: 1 })
	})
})
