/**
 * 🚧 Media a model wrote, stored (O5): a spoken reply's WAV lands as a file of
 * kind `audio` with its provenance, comes back as a reference, and is shown
 * by a `core:audio` part; a heard voice note's words are cached on the file
 * and read back with the transcript's attachments (O9).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

/** A minimal PCM WAV: the header and a few silent samples. */
function wav(): Buffer {
	const data = Buffer.alloc(64)
	const b = Buffer.alloc(44)
	b.write("RIFF", 0, "ascii")
	b.writeUInt32LE(36 + data.length, 4)
	b.write("WAVE", 8, "ascii")
	b.write("fmt ", 12, "ascii")
	b.writeUInt32LE(16, 16)
	b.writeUInt16LE(1, 20)
	b.writeUInt16LE(1, 22)
	b.writeUInt32LE(16000, 24)
	b.writeUInt32LE(32000, 28)
	b.writeUInt16LE(2, 32)
	b.writeUInt16LE(16, 34)
	b.write("data", 36, "ascii")
	b.writeUInt32LE(data.length, 40)
	return Buffer.concat([b, data])
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-generated-media-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("a spoken reply's audio", () => {
	test("is stored as an audio file with its provenance, and shown by a core:audio part", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, "spoken-reply")
		const { storeGeneratedMedia } = await import("./generatedMedia")
		const [ref] = await storeGeneratedMedia(
			db as any,
			[{ kind: "audio", mime: "audio/wav", base64: wav().toString("base64"), meta: { backend: "openai" } }],
			{ userId: user.id, runId: 42, step: "generate" }
		)
		expect(ref).toMatchObject({ kind: "audio", mime: "audio/wav", filename: "spoken-reply.wav" })
		const [row] = await db.select().from(schema.files).where(eq(schema.files.uuid, ref!.uuid))
		expect(row!.kind).toBe("audio")
		expect(row!.meta).toMatchObject({ backend: "openai", runId: 42, step: "generate" })

		const { mediaPartFor } = await import("$lib/server/attachments/partData")
		const part = mediaPartFor(row as any)
		expect(part.type).toBe("core:audio")
		expect(part.data).toMatchObject({ assetId: row!.id, mime: "audio/wav", name: "spoken-reply.wav" })
	})

	test("nothing written is nothing stored", async () => {
		const { storeGeneratedMedia } = await import("./generatedMedia")
		expect(await storeGeneratedMedia(db as any, [], { userId: 1 })).toEqual([])
	})
})
