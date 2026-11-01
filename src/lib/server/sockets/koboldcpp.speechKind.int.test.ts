/**
 * koboldcpp:downloadModel with kind "speech" is ACCEPTED: the row lands in the
 * text folder as kind "text" (declared); "speech" is a request only, never
 * stored. https/http are mocked so the background download never settles and
 * never touches the network.
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
	modelsDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-koboldcpp-speechkind-"))
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb.insert(schema.koboldCppSettings).values({ id: 1, koboldCppManagerModelsDir: modelsDir })
}, 60_000)

afterAll(async () => {
	await fs.rm(modelsDir, { recursive: true, force: true })
})

describe("koboldcpp:downloadModel speech kind", () => {
	test("kind speech is accepted: text dir, row kind text, declared", async () => {
		const { koboldCppDownloadModelHandler } = (await import("./koboldcpp")) as any
		const [admin] = await testDb
			.insert(schema.users)
			.values({ username: "koboldcpp-speechkind-admin", isAdmin: true })
			.returning()
		const socket = { user: { id: admin.id, isAdmin: true } } as any
		const filename = "Kokoro_no_espeak_Q4.gguf"
		const result = await koboldCppDownloadModelHandler.handler(
			socket,
			{
				filename,
				modelName: "Kokoro",
				downloadUrl: `https://huggingface.co/koboldcpp/tts/resolve/main/${filename}`,
				kind: "speech"
			} as any,
			() => {}
		)
		expect(result).toEqual({ success: true })
		const rows = await testDb
			.select()
			.from(schema.localModels)
			.where(eq(schema.localModels.filename, filename))
		expect(rows.length).toBe(1)
		expect(rows[0].kind).toBe("text")
		expect(rows[0].kindSource).toBe("declared")
		expect(rows[0].status).toBe("downloading")
		// Lands in the configured text dir: no image/ subfolder was created.
		expect(await fs.readdir(modelsDir)).not.toContain("image")
	}, 60_000)
})
