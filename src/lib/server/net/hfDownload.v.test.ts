// Lane V (W3) — gaps in hfDownload.test.ts: a non-206 chunk, and abort mid-download.
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import * as http from "http"
import * as fs from "fs"
import * as path from "path"
import type { AddressInfo } from "net"
import { downloadFileInParallelChunks } from "./hfDownload"

const SCRATCH =
	"/tmp/claude-1000/-home-jody-github-serene-pub/564efcec-663a-419e-8efc-7e445249445f/scratchpad/vacpp/w3"
const TOTAL = 8 * 64 * 1024 * 1024 // 8 chunks, 6 workers: two would start later if not aborted (file is sparse)

let server: http.Server
let base: string
let tmp: string
let requests = 0

beforeAll(async () => {
	tmp = fs.mkdtempSync(path.join(SCRATCH, "hfv-"))
	server = http.createServer((req, res) => {
		requests++
		if (req.url === "/boom") {
			res.writeHead(500)
			res.end()
			return
		}
		const m = req.headers.range?.match(/bytes=(\d+)-(\d+)/)
		const s = Number(m?.[1] ?? 0)
		const e = Math.min(Number(m?.[2] ?? TOTAL - 1), TOTAL - 1)
		res.writeHead(206, {
			"content-range": `bytes ${s}-${e}/${TOTAL}`,
			"content-length": e - s + 1
		})
		// Send a little, then stall: the download can only end by being aborted.
		res.write(Buffer.alloc(1024, 1))
	})
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
	server.closeAllConnections()
	await new Promise((r) => server.close(r))
	fs.rmSync(tmp, { recursive: true, force: true })
})

describe("downloadFileInParallelChunks failure paths", () => {
	test("a non-206 chunk answer rejects with its status", async () => {
		await expect(
			downloadFileInParallelChunks({
				resolvedUrl: `${base}/boom`,
				total: 1000,
				destPath: path.join(tmp, "boom.bin"),
				onBytes: () => {},
				registerRequest: () => {},
				isAborted: () => false
			})
		).rejects.toThrow(/Chunk request failed with status 500/)
	})

	test("aborting mid-download (flag + destroying registered requests) rejects and starts no further chunks", async () => {
		const reqs: http.ClientRequest[] = []
		let aborted = false
		let got = 0
		const run = downloadFileInParallelChunks({
			resolvedUrl: `${base}/slow`,
			total: TOTAL,
			destPath: path.join(tmp, "slow.bin"),
			onBytes: (n) => {
				got += n
				if (!aborted) {
					aborted = true
					for (const r of reqs) r.destroy(new Error("aborted"))
				}
			},
			registerRequest: (r) => {
				reqs.push(r)
				if (aborted) r.destroy(new Error("aborted"))
			},
			isAborted: () => aborted
		})
		await expect(run).rejects.toThrow()
		expect(got).toBeGreaterThan(0)
		expect(got).toBeLessThan(TOTAL)
		const issued = reqs.length
		await new Promise((r) => setTimeout(r, 200))
		expect(reqs.length).toBe(issued) // nothing started after the abort
		expect(issued).toBeLessThan(8) // the 7th and 8th chunks were never asked for
	}, 30_000)
})
