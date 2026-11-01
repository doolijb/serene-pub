/**
 * koboldcpp:downloadModel refuses a speech GGUF filed as text, before any byte
 * is fetched: no file, no local_models row, no download entry. https/http are
 * mocked so a (wrongly) started download would be visible and never touch the network.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("https", () => ({ get: () => ({ on: () => {} }) }))
vi.mock("http", () => ({ get: () => ({ on: () => {} }) }))
vi.mock("$lib/server/audio/audioList", async () => {
	const real = await vi.importActual<typeof import("$lib/server/audio/audioList")>(
		"$lib/server/audio/audioList"
	)
	const audio = (await import("$lib/server/audio/snapshot/audio.yaml?raw")).default
	const fam = (await import("$lib/server/audio/snapshot/audio-families.yaml?raw")).default
	return {
		...real,
		getAudioLists: async () => ({
			entries: real.parseAudioYaml(audio),
			families: real.parseAudioFamiliesYaml(fam),
			source: "snapshot"
		})
	}
})
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

let testDb: TestDb
let modelsDir: string

beforeAll(async () => {
	modelsDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-koboldcpp-speechrefusal-"))
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb.insert(schema.koboldCppSettings).values({ id: 1, koboldCppManagerModelsDir: modelsDir })
}, 60_000)

afterAll(async () => {
	await fs.rm(modelsDir, { recursive: true, force: true })
})

describe("koboldcpp:downloadModel speech refusal", () => {
	test("a speech GGUF declared text is refused and leaves nothing behind", async () => {
		const { koboldCppDownloadModelHandler, activeDownloads } = (await import("./koboldcpp")) as any
		const [admin] = await testDb
			.insert(schema.users)
			.values({ username: "koboldcpp-speechrefusal-admin", isAdmin: true })
			.returning()
		const socket = { user: { id: admin.id, isAdmin: true } } as any
		const filename = "Kokoro_no_espeak_Q4.gguf"
		const emit = vi.fn()
		await expect(
			koboldCppDownloadModelHandler.handler(
				socket,
				{
					filename,
					modelName: "Kokoro",
					downloadUrl: `https://huggingface.co/koboldcpp/tts/resolve/main/${filename}`,
					kind: "text"
				} as any,
				emit
			)
		).rejects.toThrow("That is a speech model; get it under Speech.")
		// The sentence goes out as the event's own :error, so register() does not
		// replace it with its generic one (MV V1).
		expect(emit).toHaveBeenCalledWith("koboldcpp:downloadModel:error", {
			error: "That is a speech model; get it under Speech."
		})

		expect(await fs.readdir(modelsDir)).toEqual([])
		const rows = await testDb
			.select()
			.from(schema.localModels)
			.where(eq(schema.localModels.filename, filename))
		expect(rows).toEqual([])
		if (activeDownloads) expect(activeDownloads[filename]).toBeUndefined()
	}, 60_000)
})
