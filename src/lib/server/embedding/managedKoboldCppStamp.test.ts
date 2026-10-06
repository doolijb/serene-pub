/**
 * What a host-backed backend stamps its vectors with is the identity the STAR
 * resolved to — not one rebuilt from the row.
 *
 * `activateApiEmbedding` used to rebuild `api::<baseUrl>::<model>` from the
 * connection it was handed. For every endpoint that is the target's own
 * identity, so nothing could tell. The managed KoboldCPP's is
 * `koboldcpp_managed::<model>` (`buildManagedKoboldCppModelId`), and a rebuild
 * would stamp vectors with one spelling while staleness compared another: every
 * vector stale the moment it was written, and the queue re-embedding forever.
 */

import { afterEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-crypto-secret-key",
	db: {}
}))

let target: any = null
vi.mock("./target", async (orig) => {
	const actual = (await orig()) as any
	return { ...actual, resolveEmbeddingTarget: async () => target }
})

vi.mock("$lib/server/utils/getEmbeddingAdapter", () => ({
	getEmbeddingAdapter: async () => ({
		Adapter: class {
			constructor(public connection: any) {}
			embedText = async () => ({
				vectors: [[0.1, 0.2]],
				model: "nomic-embed-text-v1.5.Q4_K_M",
				dimensions: 2
			})
		}
	})
}))

afterEach(async () => {
	const { unloadEmbeddingModel } = await import("./index")
	unloadEmbeddingModel()
	target = null
})

describe("the identity a host-backed backend stamps", () => {
	test("is the star's, so the managed KoboldCPP stamps its address-free identity", async () => {
		const { buildManagedKoboldCppModelId } = await import("./target")
		const modelId = buildManagedKoboldCppModelId(
			"nomic-embed-text-v1.5.Q4_K_M.gguf"
		)
		target = {
			connectionId: 3,
			connectionName: "KoboldCPP",
			type: "koboldcpp_managed",
			mode: "api",
			modelId,
			ttlMinutes: 5,
			apiModel: "nomic-embed-text-v1.5.Q4_K_M.gguf",
			connection: {
				id: 3,
				name: "KoboldCPP",
				type: "koboldcpp_managed",
				// Display only; it must not reach the stamp.
				baseUrl: "http://localhost:5001",
				model: "nomic-embed-text-v1.5.Q4_K_M.gguf",
				extraJson: {}
			}
		}
		const { loadConfiguredEmbeddingModel, getLoadedModelId, isModelReady } =
			await import("./index")
		await loadConfiguredEmbeddingModel()
		expect(isModelReady()).toBe(true)
		expect(getLoadedModelId()).toBe(
			"koboldcpp_managed::nomic-embed-text-v1.5.Q4_K_M"
		)
	})

	test("still builds the endpoint spelling for a caller that passes none", async () => {
		const { activateApiEmbedding, getLoadedModelId } = await import(
			"./index"
		)
		await activateApiEmbedding({
			id: 1,
			type: "openai-embeddings",
			baseUrl: "http://host/v1",
			model: "small",
			extraJson: {}
		} as any)
		expect(getLoadedModelId()).toBe("api::http://host/v1::small")
	})
})
