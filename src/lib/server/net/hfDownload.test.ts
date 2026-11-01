/**
 * The Hugging Face download helpers, lifted out of sockets/koboldcpp.ts.
 * The host allowlist cases moved here; sockets/koboldcpp.allowedHost.test.ts
 * stays as the re-export test. The transfer tests run against a local HTTP
 * server (no redirect is involved, so the allowlist is never consulted).
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import * as http from "http"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { AddressInfo } from "net"
import {
	downloadFileInParallelChunks,
	isAllowedHuggingFaceHost,
	resolveHuggingFaceDownload
} from "./hfDownload"

describe("isAllowedHuggingFaceHost", () => {
	test("accepts huggingface.co, hf.co and their subdomains", () => {
		for (const h of [
			"huggingface.co",
			"cdn-lfs.huggingface.co",
			"HUGGINGFACE.CO",
			"hf.co",
			"cas-bridge.xethub.hf.co"
		])
			expect(isAllowedHuggingFaceHost(h)).toBe(true)
	})
	test("rejects look-alikes and internal addresses", () => {
		for (const h of [
			"huggingface.co.evil.com",
			"nothuggingface.co",
			"evilhf.co",
			"169.254.169.254",
			"localhost"
		])
			expect(isAllowedHuggingFaceHost(h)).toBe(false)
	})
})

const payload = Buffer.alloc(300_000)
for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) % 251

let server: http.Server
let base: string
let tmp: string

beforeAll(async () => {
	tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hfdl-"))
	server = http.createServer((req, res) => {
		const range = req.headers.range
		if (req.url === "/noranges") {
			res.writeHead(200, { "content-length": payload.length })
			res.end(payload)
			return
		}
		if (req.url === "/missing") {
			res.writeHead(404)
			res.end()
			return
		}
		const m = range?.match(/bytes=(\d+)-(\d+)/)
		if (!m) {
			res.writeHead(200, { "content-length": payload.length })
			res.end(payload)
			return
		}
		const s = Number(m[1])
		const e = Math.min(Number(m[2]), payload.length - 1)
		res.writeHead(206, {
			"content-range": `bytes ${s}-${e}/${payload.length}`,
			"content-length": e - s + 1
		})
		res.end(payload.subarray(s, e + 1))
	})
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
	await new Promise((r) => server.close(r))
	await fs.promises.rm(tmp, { recursive: true, force: true })
})

describe("resolveHuggingFaceDownload / downloadFileInParallelChunks", () => {
	test("a range-capable host resolves to ranged with the true total", async () => {
		const r = await resolveHuggingFaceDownload(`${base}/file`, () => {})
		expect(r.kind).toBe("ranged")
		expect(r.total).toBe(payload.length)
	})

	test("a host ignoring Range resolves to fallback", async () => {
		const r = await resolveHuggingFaceDownload(`${base}/noranges`, () => {})
		expect(r.kind).toBe("fallback")
		expect(r.total).toBe(payload.length)
		if (r.kind === "fallback") r.initialResponse.resume()
	})

	test("an error status rejects", async () => {
		await expect(
			resolveHuggingFaceDownload(`${base}/missing`, () => {})
		).rejects.toThrow(/404/)
	})

	test("chunks are written at their offsets and bytes are reported", async () => {
		const dest = path.join(tmp, "out.bin")
		let seen = 0
		await downloadFileInParallelChunks({
			resolvedUrl: `${base}/file`,
			total: payload.length,
			destPath: dest,
			onBytes: (n) => (seen += n),
			registerRequest: () => {},
			isAborted: () => false
		})
		expect(seen).toBe(payload.length)
		expect(fs.readFileSync(dest).equals(payload)).toBe(true)
	})
})
