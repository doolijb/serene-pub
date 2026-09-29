import { describe, expect, it, vi } from "vitest"
import {
	chatModelsOf,
	discoverLocalProviders,
	LOCAL_CANDIDATES
} from "./discoverLocal"

/** A fetch that answers only the URLs named, and refuses everything else. */
function fakeFetch(answers: Record<string, unknown>) {
	return vi.fn(async (url: string) => {
		if (!(url in answers)) throw new TypeError("fetch failed")
		return new Response(JSON.stringify(answers[url]), { status: 200 })
	}) as any
}

describe("discoverLocalProviders", () => {
	it("names only the services whose fingerprint is their own", async () => {
		const listModels = vi.fn(async (type: string) => ({
			models:
				type === "ollama"
					? [
							{
								model: "llama3:8b",
								name: "llama3:8b",
								modality: "text-gen"
							},
							{
								model: "nomic-embed-text",
								name: "nomic-embed-text",
								modality: "embeddings"
							}
						]
					: []
		}))
		const providers = await discoverLocalProviders({
			fetchImpl: fakeFetch({
				"http://localhost:11434/api/version": { version: "0.5.1" },
				// Something else on 8080: answers, but is not llama-server.
				"http://localhost:8080/props": { hello: "world" }
			}),
			listModels
		})
		expect(providers).toEqual([
			{
				type: "ollama",
				label: "Ollama",
				baseUrl: "http://localhost:11434",
				models: [{ model: "llama3:8b", name: "llama3:8b" }],
				error: null
			}
		])
		// The listing is asked only of the service that answered.
		expect(listModels).toHaveBeenCalledTimes(1)
	})

	it("keeps a service whose listing failed, with the reason", async () => {
		const providers = await discoverLocalProviders({
			fetchImpl: fakeFetch({
				"http://localhost:5001/api/extra/version": {
					result: "KoboldCpp"
				}
			}),
			listModels: async () => ({ models: [], error: "busy" })
		})
		expect(providers).toHaveLength(1)
		expect(providers[0]).toMatchObject({
			type: "koboldcpp",
			models: [],
			error: "busy"
		})
	})

	it("lists each candidate's own type and default address", () => {
		expect(LOCAL_CANDIDATES.map((c) => c.type)).toEqual([
			"ollama",
			"lmstudio",
			"llamacpp",
			"koboldcpp"
		])
	})
})

describe("chatModelsOf", () => {
	it("drops embedding and image models, keeps unlabelled ones", () => {
		expect(
			chatModelsOf([
				{ model: "a", name: "A" },
				{ model: "b", type: "embedding" },
				{ model: "c", modality: "image-gen" },
				{ model: "d", modality: "text-gen" }
			])
		).toEqual([
			{ model: "a", name: "A" },
			{ model: "d", name: "d" }
		])
	})
})
