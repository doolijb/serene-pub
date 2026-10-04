/**
 * The in-app updater end to end against a fake GitHub: inert where it must be
 * (pre-release, container, no launcher) — before any network call — and,
 * where allowed, download → verify → extract → ready marker last → apply
 * marker and exit 75.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createUpdater, UpdaterRefusedError, APPLY_EXIT_CODE, type UpdaterDeps } from "./index"
import { cleanupStagingAtBoot, READY_MARKER, APPLY_MARKER, DOWNLOAD_PART } from "./markers"
import { buildZip, MODE_EXEC } from "./testing/zipWriter"

const TAG = "v0.6.2"
const ASSET = `serene-pub-${TAG}-linux-x64.zip`
const API = `https://api.github.com/repos/doolijb/serene-pub/releases/tags/${TAG}`
const ZIP_URL = `https://github.com/doolijb/serene-pub/releases/download/${TAG}/${ASSET}`
const SHA_URL = `${ZIP_URL}.sha256`

let tmp: string
let root: string
let staging: string

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp-updater-"))
	root = path.join(tmp, "serene-pub")
	staging = path.join(root, "staging")
	fs.mkdirSync(root, { recursive: true })
})
afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true })
})

function payloadZip(over: { version?: string; withoutNode?: boolean } = {}): Buffer {
	return buildZip([
		{ name: "serene-pub/" },
		{ name: "serene-pub/serene-pub", data: "launcher", mode: MODE_EXEC },
		{ name: "serene-pub/app/" },
		...(over.withoutNode ? [] : [{ name: "serene-pub/app/node", data: "node", mode: MODE_EXEC }]),
		{ name: "serene-pub/app/build/index.js", data: "export {}" },
		{
			name: "serene-pub/app/package.json",
			data: JSON.stringify({ version: over.version ?? "0.6.2" })
		}
	])
}

function github(zip: Buffer, sha: string | null = crypto.createHash("sha256").update(zip).digest("hex")) {
	return vi.fn(async (url: string) => {
		if (url === API)
			return Response.json({
				draft: false,
				assets: [
					{ name: ASSET, browser_download_url: ZIP_URL, size: zip.length },
					...(sha === null ? [] : [{ name: `${ASSET}.sha256`, browser_download_url: SHA_URL }])
				]
			})
		if (url === SHA_URL && sha !== null) return new Response(`${sha}  ${ASSET}\n`)
		if (url === ZIP_URL) return new Response(new Uint8Array(zip))
		return new Response("nope", { status: 404 })
	})
}

function launchedEnv(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
	return {
		SERENE_PUB_LAUNCHER_VERSION: "0.6.1",
		SERENE_PUB_UPDATE_CHANNEL: "portable",
		SERENE_PUB_TARGET: "linux-x64",
		SERENE_PUB_UPDATE_DIR: staging,
		SERENE_PUB_INSTALL_ROOT: root,
		...over
	} as NodeJS.ProcessEnv
}

function updater(over: Partial<UpdaterDeps> = {}) {
	const requestShutdown = vi.fn(async (_o: { reason: string; exitCode: number }) => {})
	const deps: UpdaterDeps = {
		version: "0.6.1",
		env: launchedEnv(),
		platform: "linux",
		arch: "x64",
		exists: () => false,
		fetch: github(payloadZip()),
		latestTag: () => TAG,
		requestShutdown,
		applyDelayMs: 0,
		now: () => new Date("2026-10-01T12:00:00.000Z"),
		...over
	}
	return { u: createUpdater(deps), deps, requestShutdown }
}

async function downloadAndWait(u: ReturnType<typeof createUpdater>) {
	const { started } = await u.download()
	await started
}

const quiet = () => {
	vi.spyOn(console, "log").mockImplementation(() => {})
	vi.spyOn(console, "warn").mockImplementation(() => {})
}
afterEach(() => vi.restoreAllMocks())

describe("inert where in-app updates are not allowed", () => {
	test.each([
		["a pre-release", { version: "0.6.1-rc-1" }],
		["a container", { exists: (p: string) => p === "/.dockerenv" }],
		["Android", { env: launchedEnv({ SERENE_PUB_PLATFORM: "android" }) }],
		["a bare start", { env: { SERENE_PUB_INSTALL_ROOT: root } as NodeJS.ProcessEnv }]
	])("%s: every action throws before any network call or file write", async (_label, over) => {
		const f = vi.fn()
		const { u, requestShutdown } = updater({ ...(over as Partial<UpdaterDeps>), fetch: f })
		await expect(u.download()).rejects.toBeInstanceOf(UpdaterRefusedError)
		await expect(u.apply(1)).rejects.toBeInstanceOf(UpdaterRefusedError)
		await expect(u.discard()).rejects.toBeInstanceOf(UpdaterRefusedError)
		expect(() => u.cancel()).toThrow(UpdaterRefusedError)
		expect(f).not.toHaveBeenCalled()
		expect(requestShutdown).not.toHaveBeenCalled()
		expect(fs.existsSync(staging)).toBe(false)
		const s = u.state()
		expect(s.inApp.allowed).toBe(false)
		expect(s.staged).toBeNull()
	})

	test("a pre-release reports no newer release at all", () => {
		const latestTag = vi.fn(() => TAG)
		const { u } = updater({ version: "0.6.1-rc-1", latestTag })
		expect(u.state()).toMatchObject({ latestTag: null, inApp: { reason: "prerelease" } })
		expect(latestTag).not.toHaveBeenCalled()
	})
})

describe("download → verify → extract → ready", () => {
	test("stages the release and writes the ready marker", async () => {
		quiet()
		const { u } = updater()
		await downloadAndWait(u)
		const ready = JSON.parse(fs.readFileSync(path.join(staging, READY_MARKER), "utf8"))
		const zip = payloadZip()
		expect(ready).toEqual({
			schema: 1,
			tag: TAG,
			version: "0.6.2",
			fromVersion: "0.6.1",
			target: "linux-x64",
			channel: "portable",
			launcherVersion: "0.6.2",
			payload: TAG,
			asset: {
				name: ASSET,
				url: ZIP_URL,
				size: zip.length,
				sha256: crypto.createHash("sha256").update(zip).digest("hex")
			},
			stagedAt: "2026-10-01T12:00:00.000Z"
		})
		expect(fs.readdirSync(staging).sort()).toEqual([READY_MARKER, TAG].sort())
		if (process.platform !== "win32")
			expect(fs.statSync(path.join(staging, TAG, "serene-pub/app/node")).mode & 0o777).toBe(0o755)
		expect(u.state()).toMatchObject({ phase: "ready", staged: { tag: TAG } })
	})

	test("a checksum mismatch refuses before anything is extracted", async () => {
		quiet()
		const { u } = updater({ fetch: github(payloadZip(), "0".repeat(64)) })
		await downloadAndWait(u)
		expect(u.state()).toMatchObject({ phase: "error", staged: null })
		expect(u.state().error).toMatch(/did not match its published checksum/)
		expect(fs.readdirSync(staging)).toEqual([])
	})

	test("a release without a checksum is refused before the zip is fetched", async () => {
		quiet()
		const f = github(payloadZip(), null)
		const { u } = updater({ fetch: f })
		await downloadAndWait(u)
		expect(u.state().phase).toBe("error")
		expect(f.mock.calls.map((c) => c[0])).toEqual([API])
		expect(fs.readdirSync(staging)).toEqual([])
	})

	test("an asset on a disallowed host is refused", async () => {
		quiet()
		const f = vi.fn(async (url: string) =>
			url === API
				? Response.json({
						assets: [
							{ name: ASSET, browser_download_url: "https://evil.example/x.zip", size: 1 },
							{ name: `${ASSET}.sha256`, browser_download_url: "https://evil.example/x.sha256" }
						]
					})
				: new Response("should not be asked", { status: 500 })
		)
		const { u } = updater({ fetch: f })
		await downloadAndWait(u)
		expect(u.state().phase).toBe("error")
		expect(f.mock.calls.map((c) => c[0])).toEqual([API])
	})

	test("a payload that fails verification leaves no ready marker and no folders", async () => {
		quiet()
		for (const zip of [payloadZip({ withoutNode: true }), payloadZip({ version: "0.6.3" })]) {
			const { u } = updater({ fetch: github(zip) })
			await downloadAndWait(u)
			expect(u.state().phase).toBe("error")
			expect(fs.readdirSync(staging)).toEqual([])
		}
	})

	test("refuses while the launcher's swap journal exists, and when something is already staged", async () => {
		quiet()
		fs.mkdirSync(staging, { recursive: true })
		fs.writeFileSync(path.join(staging, "SWAP.json"), "{}")
		const f = vi.fn()
		const { u } = updater({ fetch: f })
		await expect(u.download()).rejects.toThrow(/launcher has not finished/)
		expect(f).not.toHaveBeenCalled()
		fs.rmSync(path.join(staging, "SWAP.json"))

		const second = updater()
		await downloadAndWait(second.u)
		await expect(second.u.download()).rejects.toThrow(/already downloaded/)
	})

	test("refuses a tag that is not newer, a pre-release tag, or none", async () => {
		await expect(updater({ latestTag: () => "v0.6.1" }).u.download()).rejects.toThrow(/not newer/)
		await expect(updater({ latestTag: () => "v0.6.2-rc-1" }).u.download()).rejects.toThrow(/pre-release/)
		await expect(updater({ latestTag: () => null }).u.download()).rejects.toThrow(/no newer release/)
		await expect(updater({ latestTag: () => "v0.6.2; rm -rf" }).u.download()).rejects.toThrow(/no newer release/)
	})

	test("the ready marker is the last thing written", async () => {
		quiet()
		// Observe the staging folder at the moment the marker appears.
		const seen: string[][] = []
		const realRename = fs.renameSync
		vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
			if (String(to).endsWith(READY_MARKER)) seen.push(fs.readdirSync(staging).filter((n) => !n.endsWith(".tmp")).sort())
			return realRename(from, to)
		})
		const { u } = updater()
		await downloadAndWait(u)
		expect(seen).toEqual([[TAG]])
	})
})

describe("apply", () => {
	test("writes the apply marker, then shuts down with exit code 75", async () => {
		quiet()
		const { u, requestShutdown } = updater()
		await downloadAndWait(u)
		await u.apply(7)
		const marker = JSON.parse(fs.readFileSync(path.join(staging, APPLY_MARKER), "utf8"))
		expect(marker).toEqual({
			schema: 1,
			tag: TAG,
			requestedAt: "2026-10-01T12:00:00.000Z",
			requestedBy: 7
		})
		expect(u.state().phase).toBe("applying")
		await vi.waitFor(() =>
			expect(requestShutdown).toHaveBeenCalledWith({ reason: "update", exitCode: APPLY_EXIT_CODE })
		)
		expect(APPLY_EXIT_CODE).toBe(75)
	})

	test("refuses with nothing staged", async () => {
		const { u, requestShutdown } = updater()
		await expect(u.apply(1)).rejects.toThrow(/no downloaded update/)
		expect(requestShutdown).not.toHaveBeenCalled()
	})

	test("refuses a ready marker for another target or channel", async () => {
		quiet()
		const { u } = updater()
		await downloadAndWait(u)
		const file = path.join(staging, READY_MARKER)
		const ready = JSON.parse(fs.readFileSync(file, "utf8"))
		fs.writeFileSync(file, JSON.stringify({ ...ready, target: "windows-x64" }))
		const { u: again, requestShutdown } = updater()
		await expect(again.apply(1)).rejects.toThrow(/different kind of install/)
		fs.writeFileSync(file, JSON.stringify({ ...ready, channel: "installer" }))
		await expect(again.apply(1)).rejects.toThrow(/different kind of install/)
		expect(fs.existsSync(path.join(staging, APPLY_MARKER))).toBe(false)
		expect(requestShutdown).not.toHaveBeenCalled()
	})

	test("refuses when the staged payload has gone missing", async () => {
		quiet()
		const { u, requestShutdown } = updater()
		await downloadAndWait(u)
		fs.rmSync(path.join(staging, TAG, "serene-pub/app/node"))
		await expect(u.apply(1)).rejects.toThrow(/missing/)
		expect(fs.existsSync(path.join(staging, APPLY_MARKER))).toBe(false)
		expect(requestShutdown).not.toHaveBeenCalled()
	})
})

describe("discard and boot cleanup leave the launcher's files alone", () => {
	function launcherFiles() {
		fs.mkdirSync(path.join(staging, "previous", "app"), { recursive: true })
		fs.mkdirSync(path.join(staging, "failed", "app"), { recursive: true })
	}

	test("discard removes the staged update only", async () => {
		quiet()
		const { u } = updater()
		await downloadAndWait(u)
		launcherFiles()
		await u.discard()
		expect(fs.readdirSync(staging).sort()).toEqual(["failed", "previous"])
		expect(u.state()).toMatchObject({ phase: "idle", staged: null })
	})

	test("boot cleanup deletes a partial download and extraction, nothing else", () => {
		fs.mkdirSync(path.join(staging, `${TAG}.extracting`, "serene-pub"), { recursive: true })
		fs.writeFileSync(path.join(staging, DOWNLOAD_PART), "half")
		fs.writeFileSync(path.join(staging, READY_MARKER), "{}")
		fs.writeFileSync(path.join(staging, "SWAP.json"), "{}")
		launcherFiles()
		const removed = cleanupStagingAtBoot(staging).sort()
		expect(removed).toEqual([`${TAG}.extracting`, DOWNLOAD_PART].sort())
		expect(fs.readdirSync(staging).sort()).toEqual(["READY.json", "SWAP.json", "failed", "previous"])
	})

	test("boot cleanup of a missing folder is a no-op", () => {
		expect(cleanupStagingAtBoot(path.join(tmp, "nope"))).toEqual([])
	})
})

describe("cancel", () => {
	test("stops a download and leaves nothing behind", async () => {
		quiet()
		const zip = payloadZip()
		const sha = crypto.createHash("sha256").update(zip).digest("hex")
		let pull!: ReadableStreamDefaultController<Uint8Array>
		const f = vi.fn(async (url: string, init?: RequestInit) => {
			if (url === API)
				return Response.json({
					assets: [
						{ name: ASSET, browser_download_url: ZIP_URL, size: zip.length },
						{ name: `${ASSET}.sha256`, browser_download_url: SHA_URL }
					]
				})
			if (url === SHA_URL) return new Response(`${sha}  ${ASSET}\n`)
			const body = new ReadableStream<Uint8Array>({
				start(c) {
					pull = c
					c.enqueue(zip.subarray(0, 10))
				}
			})
			init?.signal?.addEventListener("abort", () => pull.error(new Error("aborted")))
			return new Response(body)
		})
		const { u } = updater({ fetch: f })
		const { started } = await u.download()
		await vi.waitFor(() => expect(u.state().received).toBeGreaterThan(0))
		u.cancel()
		await started
		expect(u.state()).toMatchObject({ phase: "idle", error: null })
		expect(fs.readdirSync(staging)).toEqual([])
	})
})
