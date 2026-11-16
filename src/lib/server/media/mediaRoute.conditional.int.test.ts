// /media/{uuid}: a matching If-None-Match answers 304 before any file is
// opened or read; Range streams a slice; a plain GET is the whole file.
import fsp from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

const authenticateRequestMock = vi.fn()
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("$lib/server/auth/authenticateRequest", () => ({
	authenticateRequest: authenticateRequestMock
}))

function wav(seconds = 1): Buffer {
	const rate = 24000
	const data = Buffer.alloc(rate * 2 * seconds)
	const h = Buffer.alloc(44)
	h.write("RIFF", 0)
	h.writeUInt32LE(36 + data.length, 4)
	h.write("WAVE", 8)
	h.write("fmt ", 12)
	h.writeUInt32LE(16, 16)
	h.writeUInt16LE(1, 20)
	h.writeUInt16LE(1, 22)
	h.writeUInt32LE(rate, 24)
	h.writeUInt32LE(rate * 2, 28)
	h.writeUInt16LE(2, 32)
	h.writeUInt16LE(16, 34)
	h.write("data", 36)
	h.writeUInt32LE(data.length, 40)
	// Distinct bytes so a slice is checkable.
	for (let i = 0; i < data.length; i++) data[i] = i % 251
	return Buffer.concat([h, data])
}
const WAV = wav(1)
let uuid = ""
let GET: (e: unknown) => Promise<Response>

beforeAll(async () => {
	const { db } = await import("$lib/server/db")
	const { storeGeneratedMedia } = await import(
		"$lib/server/media/generatedMedia"
	)
	const [ref] = await storeGeneratedMedia(
		db as never,
		[
			{
				kind: "audio",
				mime: "audio/wav",
				base64: WAV.toString("base64"),
				durationMs: 1000,
				meta: { spoken: true }
			} as never
		],
		{ userId: 1, runId: "x", step: "speak" }
	)
	uuid = ref!.uuid
	authenticateRequestMock.mockResolvedValue({ id: 1, isAdmin: true })
	;({ GET } = (await import("../../../routes/media/[id]/+server")) as never)
}, 60_000)

afterAll(() => authenticateRequestMock.mockReset())

const event = (path: string, headers: Record<string, string> = {}) => {
	const url = new URL(`http://localhost${path}`)
	return {
		params: { id: url.pathname.split("/")[2] },
		url,
		request: new Request(url, { headers }),
		locals: {},
		cookies: { get: () => undefined }
	}
}

describe("/media conditional and ranged answers", () => {
	test("a full GET answers 200 with the stored bytes and today's headers", async () => {
		const res = await GET(event(`/media/${uuid}?r=0`))
		expect(res.status).toBe(200)
		const body = Buffer.from(await res.arrayBuffer())
		expect(body.equals(WAV)).toBe(true)
		expect(res.headers.get("content-length")).toBe(String(WAV.length))
		expect(res.headers.get("content-type")).toBe("audio/wav")
		expect(res.headers.get("accept-ranges")).toBe("bytes")
		expect(res.headers.get("cache-control")).toBe(
			"private, max-age=31536000, immutable"
		)
		expect(res.headers.get("x-content-type-options")).toBe("nosniff")
		expect(res.headers.get("vary")).toBe("Accept")
		expect(res.headers.get("content-disposition")).toMatch(
			/^inline; filename=/
		)
		expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/)
	})

	test("a matching If-None-Match answers 304 without opening or reading a file", async () => {
		const etag = (await GET(event(`/media/${uuid}?r=0`))).headers.get(
			"etag"
		)!
		const readFile = vi.spyOn(fsp, "readFile")
		const open = vi.spyOn(fsp, "open")
		try {
			const res = await GET(
				event(`/media/${uuid}?r=0`, { "if-none-match": etag })
			)
			expect(res.status).toBe(304)
			expect(res.headers.get("etag")).toBe(etag)
			expect(res.headers.get("vary")).toBe("Accept")
			expect(res.headers.get("cache-control")).toBe(
				"private, max-age=31536000, immutable"
			)
			expect(res.headers.get("x-content-type-options")).toBe("nosniff")
			expect(readFile).not.toHaveBeenCalled()
			expect(open).not.toHaveBeenCalled()
		} finally {
			readFile.mockRestore()
			open.mockRestore()
		}
	})

	test("a non-matching If-None-Match still serves the body", async () => {
		const res = await GET(
			event(`/media/${uuid}?r=0`, { "if-none-match": '"nope"' })
		)
		expect(res.status).toBe(200)
	})

	test("Range: bytes=0-9 answers 206 with the first ten bytes", async () => {
		const res = await GET(
			event(`/media/${uuid}?r=0`, { range: "bytes=0-9" })
		)
		expect(res.status).toBe(206)
		expect(res.headers.get("content-range")).toBe(`bytes 0-9/${WAV.length}`)
		expect(res.headers.get("content-length")).toBe("10")
		const body = Buffer.from(await res.arrayBuffer())
		expect(body.equals(WAV.subarray(0, 10))).toBe(true)
	})

	test("a suffix range answers the tail", async () => {
		const res = await GET(
			event(`/media/${uuid}?r=0`, { range: "bytes=-20" })
		)
		expect(res.status).toBe(206)
		const body = Buffer.from(await res.arrayBuffer())
		expect(body.equals(WAV.subarray(WAV.length - 20))).toBe(true)
	})

	test("an unsatisfiable range answers 416 with Content-Range */size", async () => {
		const res = await GET(
			event(`/media/${uuid}?r=0`, { range: `bytes=${WAV.length + 5}-` })
		)
		expect(res.status).toBe(416)
		expect(res.headers.get("content-range")).toBe(`bytes */${WAV.length}`)
	})
})
