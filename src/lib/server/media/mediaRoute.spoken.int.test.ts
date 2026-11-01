// A spoken WAV through GET /media/{id}: the whole file, under the Accept
// headers browsers send for media, and its duration stored (lead, 2026-10-29,
// after the owner's "empty, 0 seconds" report — which was the CSP, not this).
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

const authenticateRequestMock = vi.fn()
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("$lib/server/auth/authenticateRequest", () => ({ authenticateRequest: authenticateRequestMock }))

/** One second of 24 kHz mono 16-bit silence with a proper RIFF header. */
function wav(seconds = 1): Buffer {
	const rate = 24000
	const data = Buffer.alloc(rate * 2 * seconds)
	const h = Buffer.alloc(44)
	h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8)
	h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
	h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
	h.write("data", 36); h.writeUInt32LE(data.length, 40)
	return Buffer.concat([h, data])
}
const WAV = wav(2)
let fileId = 0
let uuid = ""
let GET: (e: unknown) => Promise<Response>

beforeAll(async () => {
	const { db } = await import("$lib/server/db")
	const { storeGeneratedMedia } = await import("$lib/server/media/generatedMedia")
	const [ref] = await storeGeneratedMedia(
		db as never,
		[{ kind: "audio", mime: "audio/wav", base64: WAV.toString("base64"), durationMs: 2000, meta: { spoken: true } } as never],
		{ userId: 1, runId: "x", step: "speak" }
	)
	uuid = ref!.uuid
	const { getMediaByUuid } = await import("$lib/server/media")
	fileId = (await getMediaByUuid(db as never, uuid))!.id
	authenticateRequestMock.mockResolvedValue({ id: 1, isAdmin: true })
	;({ GET } = (await import("../../../routes/media/[id]/+server")) as never)
}, 60_000)

afterAll(() => authenticateRequestMock.mockReset())

const event = (path: string, headers: Record<string, string> = {}) => {
	const url = new URL(`http://localhost${path}`)
	return { params: { id: url.pathname.split("/")[2] }, url, request: new Request(url, { headers }), locals: {}, cookies: { get: () => undefined } }
}

describe("a spoken wav through /media", () => {
	test("by id redirects to the uuid form", async () => {
		const res = await GET(event(`/media/${fileId}`, { accept: "*/*" }))
		expect(res.status).toBe(302)
		expect(res.headers.get("location")).toContain(`/media/${uuid}`)
	})
	test("by uuid serves the whole wav under Chrome's, Firefox's and no Accept, Range or not", async () => {
		for (const h of ([
			{ accept: "*/*", range: "bytes=0-" },
			{ accept: "audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,application/ogg;q=0.7,video/*;q=0.6,*/*;q=0.5" },
			{}
		] as Record<string, string>[])) {
			const res = await GET(event(`/media/${uuid}?r=0`, h))
			expect(res.status).toBe(200)
			expect(res.headers.get("content-type")).toBe("audio/wav")
			const body = Buffer.from(await res.arrayBuffer())
			expect(body.length).toBe(WAV.length)
			expect(body.subarray(0, 4).toString()).toBe("RIFF")
		}
	})
	test("the speak step's duration is stored on the file", async () => {
		const { db } = await import("$lib/server/db")
		const { getMediaByUuid } = await import("$lib/server/media")
		expect((await getMediaByUuid(db as never, uuid))!.durationMs).toBe(2000)
	})
})
