import { describe, expect, test } from "vitest"
import { uploadPackage } from "./packageUploadClient"

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" }
	})

describe("uploadPackage", () => {
	test("starts, sends pieces in order with progress, then finishes", async () => {
		const calls: Array<{
			method: string
			url: string
			headers: any
			size: number | null
		}> = []
		const reply = {
			pluginId: "acme.lab",
			specs: [],
			configs: [],
			genres: [],
			files: 0,
			warnings: [],
			plugins: []
		}
		const fetchImpl = (async (url: string, init: RequestInit) => {
			const body = init.body as Blob | undefined
			calls.push({
				method: init.method!,
				url,
				headers: init.headers,
				size: body ? body.size : null
			})
			if (init.method === "POST" && !url.includes("?"))
				return json(200, { upload: "u1", pieceBytes: 4 })
			if (init.method === "PUT") return json(200, { received: 0 })
			return json(200, reply)
		}) as unknown as typeof fetch
		const progress: Array<[number, number]> = []
		const res = await uploadPackage(
			new File([new Uint8Array(10)], "a b.zip"),
			{
				fetchImpl,
				onProgress: (s, t) => progress.push([s, t])
			}
		)
		expect(res.pluginId).toBe("acme.lab")
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			"POST /api/admin/plugins/package",
			"PUT /api/admin/plugins/package?upload=u1&offset=0",
			"PUT /api/admin/plugins/package?upload=u1&offset=4",
			"PUT /api/admin/plugins/package?upload=u1&offset=8",
			"POST /api/admin/plugins/package?upload=u1"
		])
		expect(calls[0].headers["x-package-filename"]).toBe("a%20b.zip")
		expect(calls[0].headers["x-package-size"]).toBe("10")
		expect(calls.slice(1, 4).map((c) => c.size)).toEqual([4, 4, 2])
		expect(progress).toEqual([
			[4, 10],
			[8, 10],
			[10, 10]
		])
	})

	test("an error mid-way stops and throws the server's sentence", async () => {
		let puts = 0
		const fetchImpl = (async (_url: string, init: RequestInit) => {
			if (init.method === "POST")
				return json(200, { upload: "u1", pieceBytes: 4 })
			puts++
			return puts === 1
				? json(200, { received: 4 })
				: json(413, { error: "That package is too big." })
		}) as unknown as typeof fetch
		await expect(
			uploadPackage(new File([new Uint8Array(12)], "x.zip"), {
				fetchImpl
			})
		).rejects.toThrow("That package is too big.")
		expect(puts).toBe(2)
	})

	test("a non-JSON refusal and a dropped connection read in plain words", async () => {
		const html = (async () =>
			new Response("<html>", { status: 502 })) as unknown as typeof fetch
		await expect(
			uploadPackage(new File([new Uint8Array(1)], "x.zip"), {
				fetchImpl: html
			})
		).rejects.toThrow("The package could not be uploaded (HTTP 502).")
		const down = (async () => {
			throw new TypeError("fetch failed")
		}) as unknown as typeof fetch
		await expect(
			uploadPackage(new File([new Uint8Array(1)], "x.zip"), {
				fetchImpl: down
			})
		).rejects.toThrow(
			"The package could not be uploaded: the connection dropped."
		)
	})
})
