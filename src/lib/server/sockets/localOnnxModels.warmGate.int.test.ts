/**
 * The boot warm of the recommended ONNX lists runs only when somebody asked
 * for a local ONNX model: one is on disk, or a loadout names a local ONNX row.
 * The two rows always exist, so their existence alone is not asking.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"

vi.mock("$lib/server/db", async (orig) => {
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

const list = vi.hoisted(() => ({
	recommendedEmbeddingModels: vi.fn(async () => []),
	recommendedNerModels: vi.fn(async () => [])
}))
vi.mock("$lib/server/localModels/onnxList", async (orig) => ({
	...((await orig()) as any),
	...list
}))

let testDb: any
beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db
}, 60_000)

let ner: { id: number }
beforeEach(async () => {
	list.recommendedEmbeddingModels.mockClear()
	list.recommendedNerModels.mockClear()
	await testDb.delete(schema.loadouts)
	await testDb.delete(schema.localModels)
	await testDb.delete(schema.connectionModels)
	await testDb.delete(schema.connections)
	await testDb.insert(schema.connections).values({
		name: "Local embeddings",
		type: "local-onnx",
		modality: "embeddings",
		extraJson: {}
	} as any)
	;[ner] = await testDb
		.insert(schema.connections)
		.values({
			name: "Local named entities",
			type: "local-onnx-ner",
			modality: "ner",
			extraJson: {}
		} as any)
		.returning()
}, 60_000)

async function boot() {
	const h = await import("./localOnnxModels")
	await h.reconcileOnnxDownloadsOnBoot()
	// The warm is `void`-ed.
	await new Promise((r) => setTimeout(r, 300))
}

describe("the boot warm gate", () => {
	it("does not fetch when the rows exist but nobody asked", async () => {
		await boot()
		expect(list.recommendedEmbeddingModels).not.toHaveBeenCalled()
		expect(list.recommendedNerModels).not.toHaveBeenCalled()
	}, 60_000)

	it("fetches when a complete onnx embeddings model is on disk", async () => {
		await testDb.insert(schema.localModels).values({
			filename: "Xenova/done",
			modelName: "Xenova/done",
			format: "onnx",
			modality: "embeddings",
			status: "complete"
		} as any)
		await boot()
		await vi.waitFor(() =>
			expect(list.recommendedEmbeddingModels).toHaveBeenCalled()
		)
		expect(list.recommendedNerModels).toHaveBeenCalled()
	}, 60_000)

	it("fetches when a loadout names the NER row", async () => {
		await testDb.insert(schema.loadouts).values({
			slug: "warm-gate-ner",
			name: "Warm gate NER",
			transform: "text->ner",
			connectionId: ner.id
		} as any)
		await boot()
		await vi.waitFor(() =>
			expect(list.recommendedNerModels).toHaveBeenCalled()
		)
	}, 60_000)
})
