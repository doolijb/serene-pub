/**
 * The managed KoboldCPP listing's stale sweep forgets only rows it owns.
 *
 * It deletes complete `local_models` rows whose file it did not find in
 * KoboldCPP's model directories. ONNX embedding/NER rows and the matting row
 * share the table but live under `<data>/models/<modality>`, so the scan never
 * sees them — and must not read that absence as the file being gone.
 */
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("https", () => ({ get: () => ({ on: () => {} }) }))
vi.mock("http", () => ({ get: () => ({ on: () => {} }) }))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

let testDb: TestDb
let modelsDir: string

beforeAll(async () => {
	modelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-scan-dir-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 })
	await testDb.insert(schema.koboldCppSettings).values({
		id: 1,
		koboldCppManagerEnabled: true,
		koboldCppManagerModelsDir: modelsDir
	})
}, 60_000)

afterAll(async () => {
	vi.unstubAllGlobals()
	await fs.rm(modelsDir, { recursive: true, force: true })
})

beforeEach(async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: any) => {
			throw new Error(`unrouted fetch: ${String(url)}`)
		})
	)
	await testDb.delete(schema.localModels)
})

const row = (filename: string) =>
	testDb.query.localModels.findFirst({
		where: eq(schema.localModels.filename, filename)
	})

test("forgets a GGUF whose file is gone, keeps ONNX and matting rows", async () => {
	const { MATTING_MODEL_ID, MATTING_MODALITY } = await import(
		"$lib/server/localModels/matting"
	)
	await testDb.insert(schema.localModels).values([
		{
			filename: "deleted-outside-the-app.Q4_K_M.gguf",
			modelName: "deleted-outside-the-app",
			status: "complete",
			format: "gguf",
			kind: "text",
			kindSource: "detected",
			modality: "text-gen"
		},
		{
			filename: "Xenova/all-MiniLM-L6-v2",
			modelName: "Xenova/all-MiniLM-L6-v2",
			status: "complete",
			format: "onnx",
			kind: "unknown",
			kindSource: "declared",
			modality: "embeddings"
		},
		{
			filename: MATTING_MODEL_ID,
			modelName: MATTING_MODEL_ID,
			status: "complete",
			format: "onnx",
			kind: "unknown",
			kindSource: "declared",
			modality: MATTING_MODALITY
		}
	])

	const { buildKoboldCppListModels } = await import("./koboldcpp")
	await buildKoboldCppListModels()

	expect(await row("deleted-outside-the-app.Q4_K_M.gguf")).toBeUndefined()
	expect((await row("Xenova/all-MiniLM-L6-v2"))?.status).toBe("complete")
	expect((await row(MATTING_MODEL_ID))?.modality).toBe(MATTING_MODALITY)
}, 60_000)
