import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("$lib/server/db", async (orig) => ({ ...(await orig<any>()) }))
vi.mock("$lib/server/connections/recommendedGguf", async (orig) => ({
	...(await orig<any>()),
	fetchRecommendedGguf: async () => [
		row("unsloth/Q", "hf.co/unsloth/Q-GGUF:Q4_K_M", []),
		row("down", "hf.co/no/answer:Q4_K_M", []),
		row("nomic-embed-text", "nomic-embed-text", ["embedding"])
	]
}))

function row(name: string, pull: string, tags: string[]) {
	return {
		name,
		pull,
		size: 1,
		recommended_vram: 1,
		tags,
		details: {
			parameter_size: "",
			quantization_level: "",
			modified_at: "",
			description: ""
		}
	}
}

import { ollamaRecommendedModelsHandler } from "./ollama"
import { clearHfSiblingsCache } from "$lib/server/connections/hfGgufQuants"

describe("ollama:recommendedModels quants", () => {
	beforeEach(() => {
		clearHfSiblingsCache()
		vi.stubGlobal("fetch", async (url: string) =>
			url.includes("unsloth/Q-GGUF")
				? {
						ok: true,
						json: async () => ({
							siblings: [
								{ rfilename: "Q-Q4_K_M.gguf", size: 3 },
								{ rfilename: "Q-Q8_0.gguf", size: 6 }
							]
						})
					}
				: { ok: false }
		)
	})
	afterEach(() => vi.unstubAllGlobals())
	const call = (kind?: "chat" | "embedding") =>
		ollamaRecommendedModelsHandler.handler(
			{ user: { isAdmin: true } } as any,
			{ kind } as any,
			() => {}
		) as Promise<any>

	it("lists quants for hf.co rows with the yaml one recommended", async () => {
		const { recommendedModels } = await call()
		const q = recommendedModels[0]
		expect(q.quants.map((x: any) => x.tag)).toEqual([
			"hf.co/unsloth/Q-GGUF:Q4_K_M",
			"hf.co/unsloth/Q-GGUF:Q8_0"
		])
		expect(q.quants.map((x: any) => x.recommended)).toEqual([true, false])
		expect(recommendedModels[1].quants).toEqual([])
		expect(recommendedModels[1].quantsNote).toMatch(/Hugging Face did not/)
	})
	it("explains a plain library name", async () => {
		const { recommendedModels } = await call("embedding")
		expect(recommendedModels[0].quants).toEqual([])
		expect(recommendedModels[0].quantsNote).toMatch(/library lists no quants/)
	})
})
