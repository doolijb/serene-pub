/**
 * `attach-audio` through the real run engine and host (speech build, lane D;
 * verified by lane V): replace semantics, the S6 record, swipe padding, and the
 * "nothing to attach" no-op. Real media rows and files (scratch data dir);
 * `broadcastToSessionUsers` is spied to count socket announcements.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { spec, compile, run } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

// DB setup and the first media write are slow under load.
vi.setConfig({ testTimeout: 60_000 })

const broadcast = vi.fn(async () => {})
vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (orig) => ({
	...((await orig()) as object),
	broadcastToSessionUsers: (...a: unknown[]) => (broadcast as any)(...a)
}))

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let n = 0

/** A tiny valid PCM WAV; `seed` makes the bytes (so the hash) distinct. */
function wav(seed: number): Buffer {
	const samples = 80
	const data = Buffer.alloc(samples * 2)
	for (let i = 0; i < samples; i++) data.writeInt16LE(((i * 37 + seed * 101) % 2000) - 1000, i * 2)
	const h = Buffer.alloc(44)
	h.write("RIFF", 0)
	h.writeUInt32LE(36 + data.length, 4)
	h.write("WAVEfmt ", 8)
	h.writeUInt32LE(16, 16)
	h.writeUInt16LE(1, 20)
	h.writeUInt16LE(1, 22)
	h.writeUInt32LE(8000, 24)
	h.writeUInt32LE(16000, 28)
	h.writeUInt16LE(2, 32)
	h.writeUInt16LE(16, 34)
	h.write("data", 36)
	h.writeUInt32LE(data.length, 40)
	return Buffer.concat([h, data])
}

async function audioFile(seed: number, spoken: boolean, bytes?: Buffer) {
	const { createMedia } = await import("$lib/server/media")
	const { file } = await createMedia(db, {
		userId,
		sessionId,
		bytes: bytes ?? wav(seed),
		allowMedia: true,
		filename: spoken ? "spoken-reply.wav" : "voice-note.wav",
		meta: spoken ? { spoken: true } : null
	})
	return file
}

async function message(metadata: Record<string, unknown> = {}) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	const row = await insertLegacy(db, {
		sessionId,
		role: "character",
		content: "Hello there.",
		metadata: metadata as any
	})
	return row.id
}

async function addPart(messageId: number, assetId: number) {
	const { appendParts } = await import("$lib/server/messages/store")
	await appendParts(db, messageId, [{ type: "core:audio", data: { assetId } }])
}

const SPOKEN_META = (template: string | null = "core:template/spoken-line-whole@1") => ({
	spokenAs: { voice: "v1", model: "m1", applied: ["voice"], ignored: [] },
	cueMap: { source: "concatenated", spans: [{ startMs: 0, endMs: 100 }] },
	inflection: { label: "joy" },
	template,
	at: "2026-10-28T12:00:00.000Z"
})

async function attach(
	target: number,
	file: { uuid: string } | null,
	opts: { replace?: boolean; meta?: object | null } = {}
) {
	const slug = `test.v3b:spec/attach-audio-${++n}`
	const doc = compile(
		spec(slug, { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.outlet("attach", ($) =>
				C.attachAudio.v1({
					target,
					audio: file ? ({ uuid: file.uuid, kind: "audio", mime: "audio/wav" } as any) : (null as any),
					...(opts.meta ? { meta: opts.meta as any } : {}),
					params: { replace: opts.replace === true }
				} as any)
			)
			.build()
	)
	const saved = await saveDocument(db, doc, { publish: true })
	const loaded = await loadDocument(db, saved.specVersionId)
	const receipt = await run(loaded, {
		input: { text: "x", sessionScope: { sessionId } },
		seed: `seed:${slug}`,
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId, io: {} as any }),
		reviewer: async () => ({ action: "approve", by: "test", at: 1 })
	})
	return receipt
}

const audioParts = async (messageId: number) =>
	(await db.select().from(schema.messageParts).where(eq(schema.messageParts.messageId, messageId))).filter(
		(p) => p.type === "core:audio"
	)
const fileExists = async (id: number) =>
	(await db.select().from(schema.files).where(eq(schema.files.id, id))).length === 1
const metaOf = async (id: number) =>
	(await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.id, id)))[0]!.metadata as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-attachaudio-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
	const [u] = await db.insert(schema.users).values({ username: "v3b-attach", isAdmin: false }).returning()
	userId = u.id
	const [s] = await db.insert(schema.sessions).values({ userId, isGroup: false }).returning()
	sessionId = s.id
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => broadcast.mockClear())

describe("attach-audio", () => {
	it("attaches a spoken file as one core:audio part, announces the message, records S6 at metadata.spoken", async () => {
		const m = await message()
		const f = await audioFile(1, true)
		const meta = SPOKEN_META()
		const r = await attach(m, f, { meta })
		expect(r.outcome, r.haltReason).toBe("ok")
		expect(await audioParts(m)).toHaveLength(1)
		expect(broadcast).toHaveBeenCalled()
		const spoken = (await metaOf(m)).spoken
		expect(spoken).toMatchObject({
			spokenAs: meta.spokenAs,
			cueMap: meta.cueMap,
			inflection: meta.inflection,
			template: meta.template,
			at: meta.at
		})
	})

	it("no audio: written:false, no part, no socket event, no S6 record", async () => {
		const m = await message()
		const r = await attach(m, null, { replace: true, meta: SPOKEN_META() })
		expect(r.outcome, r.haltReason).toBe("ok")
		expect(await audioParts(m)).toHaveLength(0)
		expect(broadcast).not.toHaveBeenCalled()
		expect((await metaOf(m)).spoken).toBeUndefined()
	})

	it("replace: an earlier spoken file already gone from disk does not throw; exactly one core:audio part remains", async () => {
		const m = await message()
		const old = await audioFile(2, true)
		await addPart(m, old.id)
		const { deleteFile } = await import("$lib/server/media")
		await deleteFile(db, old.id) // clear-spoken / retention deletes files only (L5)
		expect(await fileExists(old.id)).toBe(false)
		expect(await audioParts(m)).toHaveLength(1) // dangling part
		const fresh = await audioFile(3, true)
		const r = await attach(m, fresh, { replace: true, meta: SPOKEN_META() })
		expect(r.outcome, r.haltReason).toBe("ok")
		const parts = await audioParts(m)
		expect(parts).toHaveLength(1)
		expect((parts[0]!.data as any).assetId).toBe(fresh.id)
	})

	it("replace keeps a person's own voice note and swaps (and deletes) the earlier spoken file", async () => {
		const m = await message()
		const note = await audioFile(4, false)
		const old = await audioFile(5, true)
		await addPart(m, note.id)
		await addPart(m, old.id)
		const fresh = await audioFile(6, true)
		const r = await attach(m, fresh, { replace: true })
		expect(r.outcome, r.haltReason).toBe("ok")
		const ids = (await audioParts(m)).map((p) => (p.data as any).assetId).sort()
		expect(ids).toEqual([note.id, fresh.id].sort())
		expect(await fileExists(note.id)).toBe(true)
		expect(await fileExists(old.id)).toBe(false)
		expect(await fileExists(fresh.id)).toBe(true)
	})

	it("without replace a second reading stacks beside the first", async () => {
		const m = await message()
		const a = await audioFile(7, true)
		const b = await audioFile(8, true)
		await attach(m, a)
		await attach(m, b)
		expect(await audioParts(m)).toHaveLength(2)
	})

	it("identical bytes dedupe to one files row; re-attaching it with replace keeps one part and the file", async () => {
		const m = await message()
		const bytes = wav(9)
		const a = await audioFile(9, true, bytes)
		const b = await audioFile(9, true, bytes)
		expect(b.id).toBe(a.id)
		const rows = await db.select().from(schema.files).where(eq(schema.files.id, a.id))
		expect(rows).toHaveLength(1)
		await attach(m, a, { replace: true })
		const r = await attach(m, b, { replace: true })
		expect(r.outcome, r.haltReason).toBe("ok")
		expect(await audioParts(m)).toHaveLength(1)
		expect(await fileExists(a.id)).toBe(true)
	})

	it("a deduped file still shown by another line survives a replace on this one", async () => {
		const m1 = await message()
		const m2 = await message()
		const shared = await audioFile(10, true)
		await addPart(m1, shared.id)
		await addPart(m2, shared.id)
		const fresh = await audioFile(11, true)
		await attach(m1, fresh, { replace: true })
		expect(await fileExists(shared.id)).toBe(true)
		expect(await audioParts(m2)).toHaveLength(1)
	})

	it("on a swipe index > 0 the S6 record is padded into metadata.swipes.spokenHistory[idx]", async () => {
		const m = await message({ swipes: { currentIdx: 2, history: ["a", "b", "c"] } })
		const f = await audioFile(12, true)
		const meta = SPOKEN_META()
		const r = await attach(m, f, { meta })
		expect(r.outcome, r.haltReason).toBe("ok")
		const md = await metaOf(m)
		expect(md.spoken).toMatchObject({ template: meta.template })
		expect(md.swipes.spokenHistory).toHaveLength(3)
		expect(md.swipes.spokenHistory[0]).toBeNull()
		expect(md.swipes.spokenHistory[1]).toBeNull()
		expect(md.swipes.spokenHistory[2]).toMatchObject({ at: meta.at })
		expect(md.swipes.history).toEqual(["a", "b", "c"])
	})

	it("replacing audio with none-meta clears the stale record it would contradict", async () => {
		const m = await message({ spoken: SPOKEN_META() })
		const old = await audioFile(13, true)
		await addPart(m, old.id)
		const fresh = await audioFile(14, true)
		await attach(m, fresh, { replace: true })
		expect((await metaOf(m)).spoken).toBeNull()
	})
})
