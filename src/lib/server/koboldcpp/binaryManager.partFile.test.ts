/**
 * The first "Download & Start" that never started (owner report 2026-10-05):
 * downloadVariant() wrote straight to the final path and resolved on the write
 * stream's "finish" — which fires while the fd is still open — and the socket
 * handler's auto-start exec'ed that path at once. Exec'ing a file open for
 * writing is ETXTBSY on Linux, thrown synchronously by spawn, and the status
 * was left at "starting" for good.
 *
 * Fixed by downloading to `<asset>.part` and renaming it into place only after
 * the stream has CLOSED (and the checksum and chmod are done). These tests pin
 * that order against a real file stream in a real temp directory, with only the
 * network faked.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import { execFileSync } from "child_process"
import * as fsSync from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"

/** What the fake response does once the download pipes it into its file. */
const net = vi.hoisted(() => ({
	statusCode: 200,
	body: [] as Buffer[],
	/** Fail the response after this many chunks, instead of ending it. */
	failAfter: null as number | null,
	/** Called on the destination stream's "finish" and "close", in order. */
	onDestEvent: null as ((event: "finish" | "close", dest: any) => void) | null
}))

function makeFakeHttpsModule() {
	return {
		get(_url: string, cb: (res: any) => void) {
			const handlers: Record<string, Array<(arg: any) => void>> = {}
			const res: any = {
				statusCode: net.statusCode,
				headers: {
					"content-length": String(
						net.body.reduce((n, b) => n + b.length, 0)
					)
				},
				on(event: string, handler: any) {
					;(handlers[event] ??= []).push(handler)
					return res
				},
				resume() {},
				pipe(dest: any) {
					dest.on("finish", () => net.onDestEvent?.("finish", dest))
					dest.on("close", () => net.onDestEvent?.("close", dest))
					// Asynchronous, like a socket: the file is opened and the
					// chunks written on later ticks, not inside the callback.
					setImmediate(() => {
						net.body.forEach((chunk, i) => {
							if (net.failAfter !== null && i >= net.failAfter)
								return
							for (const h of handlers.data ?? []) h(chunk)
							dest.write(chunk)
						})
						if (net.failAfter !== null) {
							for (const h of handlers.error ?? [])
								h(new Error("socket hang up"))
							return
						}
						dest.end()
					})
					return dest
				}
			}
			const req: any = { on: () => req, destroy: () => {} }
			cb(res)
			return req
		}
	}
}

vi.mock("https", () => makeFakeHttpsModule())
vi.mock("http", () => makeFakeHttpsModule())

let root: string
let destDir: string
let n = 0

beforeAll(async () => {
	root = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-binarymgr-part-")
	)
})

afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
	destDir = path.join(root, `case-${++n}`)
	net.statusCode = 200
	net.body = [Buffer.from("#!/bin/sh\n"), Buffer.from("echo started\n")]
	net.failAfter = null
	net.onDestEvent = null
})

async function download(assetName = "koboldcpp-linux-x64-nocuda") {
	const { downloadVariant } = await import("./binaryManager")
	await downloadVariant({
		assetName,
		downloadUrl: `https://github.com/LostRuins/koboldcpp/releases/download/v1/${assetName}`,
		destDir
	})
	return path.join(destDir, assetName)
}

describe("binaryManager.downloadVariant — the .part file", () => {
	test("the final path does not exist until the stream has closed; the .part is renamed into it", async () => {
		const asset = "koboldcpp-linux-x64-nocuda"
		const finalPath = path.join(destDir, asset)
		const seen: string[] = []
		let dest: any
		net.onDestEvent = (event, d) => {
			dest = d
			seen.push(
				`${event}: final=${fsSync.existsSync(finalPath)} part=${fsSync.existsSync(`${finalPath}.part`)}`
			)
		}

		await download(asset)

		expect(seen).toEqual([
			"finish: final=false part=true",
			"close: final=false part=true"
		])
		expect(dest.path).toBe(`${finalPath}.part`)
		expect(dest.closed).toBe(true)
		expect(fsSync.existsSync(`${finalPath}.part`)).toBe(false)
		expect(await fs.readFile(finalPath, "utf8")).toBe(
			"#!/bin/sh\necho started\n"
		)
	})

	test.skipIf(process.platform === "win32")(
		"what lands at the final path is executable the moment the download resolves",
		async () => {
			// The auto-start does exactly this, with no pause in between.
			const finalPath = await download()
			expect(execFileSync(finalPath, { encoding: "utf8" })).toBe(
				"started\n"
			)
		}
	)

	test("an older copy at the final path is replaced whole, never truncated in place", async () => {
		const asset = "koboldcpp-linux-x64"
		const finalPath = path.join(destDir, asset)
		await fs.mkdir(destDir, { recursive: true })
		await fs.writeFile(finalPath, "old build")
		const atFinish: string[] = []
		net.onDestEvent = (event) => {
			if (event === "finish")
				atFinish.push(fsSync.readFileSync(finalPath, "utf8"))
		}

		await download(asset)

		expect(atFinish).toEqual(["old build"])
		expect(await fs.readFile(finalPath, "utf8")).toBe(
			"#!/bin/sh\necho started\n"
		)
	})

	test("a failed download deletes the .part and leaves the older copy untouched", async () => {
		const asset = "koboldcpp-linux-x64"
		const finalPath = path.join(destDir, asset)
		await fs.mkdir(destDir, { recursive: true })
		await fs.writeFile(finalPath, "old build")
		net.failAfter = 1

		await expect(download(asset)).rejects.toThrow("socket hang up")

		expect(fsSync.existsSync(`${finalPath}.part`)).toBe(false)
		expect(await fs.readFile(finalPath, "utf8")).toBe("old build")
	})

	test("an error status is a failed download, not a saved error page", async () => {
		net.statusCode = 404
		const finalPath = path.join(destDir, "koboldcpp-linux-x64")

		await expect(download("koboldcpp-linux-x64")).rejects.toThrow(
			"Download failed: HTTP 404"
		)

		expect(fsSync.existsSync(finalPath)).toBe(false)
		expect(fsSync.existsSync(`${finalPath}.part`)).toBe(false)
	})
})
