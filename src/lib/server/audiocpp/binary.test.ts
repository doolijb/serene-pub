import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest"
import { audiocppSettings } from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import release from "./__fixtures__/release-v0.9.3.json"
import {
	assertTarballSafe,
	audioCppBinaryPath,
	audioCppServerFileName,
	binaryDownloadEmitters,
	getAudioCppBinaryDownloadState,
	getAudioCppInstallState,
	listAudioCppBinaryVariants,
	listAudioCppReleaseVersions,
	parseAudioCppAssetName,
	resolveAudioCppBinaryDir,
	startAudioCppBinaryDownload,
	variantsForPlatform
} from "./binary"
import { ensureAudioCppSettings } from "./settings"

const assets = release.assets
const names = (vs: { assetName: string }[]) => vs.map((v) => v.assetName)

let tmp: string
beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acpp-bin-test-"))
})
afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true })
})

describe("parseAudioCppAssetName", () => {
	test("parses every published name of v0.9.3", () => {
		const parsed = assets.map((a) => [a.name, parseAudioCppAssetName(a.name)] as const)
		const unparsed = parsed.filter(([, p]) => p === null).map(([n]) => n)
		expect(unparsed).toEqual(["audio-v0.9.3-server-config-examples.zip"])
		expect(parseAudioCppAssetName("audio-v0.9.3-bin-ubuntu-x64-cpu-portable.tar.gz")).toEqual({
			version: "0.9.3", kind: "bin", os: "linux", arch: "x64", backend: "cpu",
			backendDetail: "", portable: true, experimental: false, ext: "tar.gz"
		})
		expect(parseAudioCppAssetName("audio-v0.9.3-bin-windows-x64-cuda12.4.zip")).toMatchObject({
			os: "windows", backend: "cuda", backendDetail: "12.4", portable: false, ext: "zip"
		})
		expect(parseAudioCppAssetName("audio-v0.9.3-bin-ubuntu-x64-cuda12.8-colab.tar.gz")).toMatchObject({
			backend: "cuda", backendDetail: "12.8", experimental: true
		})
		expect(parseAudioCppAssetName("audio-v0.9.3-bin-ubuntu-x64-rocm10.0.0-test.tar.gz")).toMatchObject({
			backend: "rocm", backendDetail: "10.0.0", experimental: true
		})
		expect(parseAudioCppAssetName("audio-v0.9.3-bin-macos-arm64-metal.tar.gz")).toMatchObject({
			os: "macos", arch: "arm64", backend: "metal"
		})
		expect(parseAudioCppAssetName("audio-v0.9.3-cudart-windows-x64-cuda13.3.zip")).toMatchObject({
			kind: "cudart", backendDetail: "13.3"
		})
		expect(parseAudioCppAssetName("audio-v0.9.3-lib-ubuntu-x64-cpu.tar.gz")?.kind).toBe("lib")
		expect(parseAudioCppAssetName("nonsense.zip")).toBeNull()
	})
})

describe("variantsForPlatform", () => {
	test("linux x64: portable CPU recommended, then offered order, no lib/test/colab", () => {
		const vs = variantsForPlatform(assets, { platform: "linux", arch: "x64" })
		expect(names(vs)).toEqual([
			"audio-v0.9.3-bin-ubuntu-x64-cpu-portable.tar.gz",
			"audio-v0.9.3-bin-ubuntu-x64-vulkan-portable.tar.gz",
			"audio-v0.9.3-bin-ubuntu-x64-cpu.tar.gz",
			"audio-v0.9.3-bin-ubuntu-x64-vulkan.tar.gz"
		])
		expect(vs.map((v) => !!v.recommended)).toEqual([true, false, false, false])
		expect(vs[0].name).toBe("Linux · CPU (portable)")
		for (const v of vs) {
			expect(v.reason).toBeTruthy()
			expect(v.needsRuntimeAsset).toBeUndefined()
		}
	})
	test("linux arm64 has nothing", () => {
		expect(variantsForPlatform(assets, { platform: "linux", arch: "arm64" })).toEqual([])
	})
	test("windows x64: CUDA builds pair with their cudart", () => {
		const vs = variantsForPlatform(assets, { platform: "win32", arch: "x64" })
		expect(names(vs)).toEqual([
			"audio-v0.9.3-bin-windows-x64-cpu-portable.zip",
			"audio-v0.9.3-bin-windows-x64-vulkan-portable.zip",
			"audio-v0.9.3-bin-windows-x64-cuda12.4.zip",
			"audio-v0.9.3-bin-windows-x64-cuda13.3.zip",
			"audio-v0.9.3-bin-windows-x64-cpu.zip",
			"audio-v0.9.3-bin-windows-x64-vulkan.zip"
		])
		expect(vs[0].recommended).toBe(true)
		expect(vs[2].needsRuntimeAsset).toBe("audio-v0.9.3-cudart-windows-x64-cuda12.4.zip")
		expect(vs[3].needsRuntimeAsset).toBe("audio-v0.9.3-cudart-windows-x64-cuda13.3.zip")
		expect(vs[2].reason).toMatch(/600 MB/)
		expect(vs[2].backend).toBe("cuda")
	})
	test("macOS gets Metal for its arch", () => {
		const arm = variantsForPlatform(assets, { platform: "darwin", arch: "arm64" })
		expect(names(arm)).toEqual(["audio-v0.9.3-bin-macos-arm64-metal.tar.gz"])
		expect(arm[0]).toMatchObject({ recommended: true, backend: "metal", name: "macOS · Metal (Apple silicon)" })
		expect(names(variantsForPlatform(assets, { platform: "darwin", arch: "x64" }))).toEqual([
			"audio-v0.9.3-bin-macos-x64-metal.tar.gz"
		])
	})
	test("an unpublished platform gives nothing", () => {
		expect(variantsForPlatform(assets, { platform: "freebsd", arch: "x64" })).toEqual([])
	})
})

function apiFetch(rel: unknown, seen: string[] = []) {
	return (async (url: string) => {
		seen.push(url)
		return new Response(JSON.stringify(rel), { status: 200 })
	}) as never
}

describe("GitHub listing with an injected fetch", () => {
	test("variants for a tag", async () => {
		const seen: string[] = []
		const r = await listAudioCppBinaryVariants(
			{ tag: "v0.9.3" },
			{ fetch: apiFetch(release, seen), platform: "linux", arch: "x64" }
		)
		expect(seen[0]).toBe("https://api.github.com/repos/0xShug0/audio.cpp/releases/tags/v0.9.3")
		expect(r.releaseTag).toBe("v0.9.3")
		expect(r.variants).toHaveLength(4)
	})
	test("variants for latest", async () => {
		const seen: string[] = []
		await listAudioCppBinaryVariants({}, { fetch: apiFetch(release, seen), platform: "darwin", arch: "arm64" })
		expect(seen[0]).toMatch(/\/releases\/latest$/)
	})
	test("release versions, newest first, one latest", async () => {
		const r = await listAudioCppReleaseVersions({
			fetch: apiFetch([
				{ tag_name: "v0.9.4-rc", published_at: "2026-10-28T00:00:00Z", prerelease: true },
				{ tag_name: "v0.9.3", published_at: "2026-10-26T00:00:00Z" },
				{ tag_name: "v0.9.2", published_at: "2026-10-01T00:00:00Z" }
			])
		})
		expect(r.versions.map((v) => [v.tag, v.isLatest])).toEqual([
			["v0.9.4-rc", false],
			["v0.9.3", true],
			["v0.9.2", false]
		])
	})
	test("a failing API is a sentence", async () => {
		await expect(
			listAudioCppReleaseVersions({ fetch: (async () => new Response("", { status: 403 })) as never })
		).rejects.toThrow(/GitHub answered 403/)
	})
})

describe("paths", () => {
	const savedEnv = process.env.AUDIOCPP_BINARY_DIR
	afterEach(() => {
		if (savedEnv === undefined) delete process.env.AUDIOCPP_BINARY_DIR
		else process.env.AUDIOCPP_BINARY_DIR = savedEnv
	})
	test("binary dir: setting, then env, then app data", () => {
		process.env.AUDIOCPP_BINARY_DIR = "/env/dir"
		expect(resolveAudioCppBinaryDir({ binaryDir: "/set/dir" })).toBe("/set/dir")
		expect(resolveAudioCppBinaryDir({ binaryDir: null })).toBe("/env/dir")
		delete process.env.AUDIOCPP_BINARY_DIR
		expect(resolveAudioCppBinaryDir({})).toMatch(/audiocpp$/)
	})
	test("file name and absent binary", async () => {
		expect(audioCppServerFileName("win32")).toBe("audiocpp_server.exe")
		expect(audioCppServerFileName("linux")).toBe("audiocpp_server")
		expect(await audioCppBinaryPath({ binaryDir: tmp })).toBeNull()
	})
})

function makeTarball(dir: string, populate: (src: string) => void, extra: string[] = [], cwdSub?: string) {
	const src = path.join(dir, "src")
	fs.mkdirSync(path.join(src, "sub"), { recursive: true })
	populate(src)
	const out = path.join(dir, "a.tar.gz")
	execFileSync("tar", ["-czP" + "f", out, ...extra], { cwd: cwdSub ?? src })
	return out
}

describe("tarball safety", () => {
	const fakeServer = (src: string) => {
		fs.writeFileSync(path.join(src, "audiocpp_server"), "#!/bin/sh\necho 'audiocpp_server v0.9.3'\n", { mode: 0o755 })
		fs.symlinkSync("audiocpp_server", path.join(src, "sub", "rel-link"))
	}
	test("a flat tarball with a relative link passes and unpacks", async () => {
		const tgz = makeTarball(tmp, fakeServer, ["."])
		await assertTarballSafe(tgz)
		const dest = path.join(tmp, "out")
		fs.mkdirSync(dest)
		execFileSync("tar", ["-xzf", tgz, "-C", dest, "--no-same-owner"])
		expect(fs.existsSync(path.join(dest, "audiocpp_server"))).toBe(true)
	})
	test("a ../ member is refused", async () => {
		const tgz = makeTarball(tmp, (src) => {
			fakeServer(src)
			fs.writeFileSync(path.join(tmp, "evil"), "x")
		}, ["../evil"])
		await expect(assertTarballSafe(tgz)).rejects.toThrow(/outside its folder/)
	})
	test("a link to an absolute path is refused", async () => {
		const tgz = makeTarball(tmp, (src) => {
			fakeServer(src)
			fs.symlinkSync("/etc/passwd", path.join(src, "abs-link"))
		}, ["."])
		await expect(assertTarballSafe(tgz)).rejects.toThrow(/points outside/)
	})
	test("a link that climbs out is refused", async () => {
		const tgz = makeTarball(tmp, (src) => {
			fakeServer(src)
			fs.symlinkSync("../../x", path.join(src, "sub", "up-link"))
		}, ["."])
		await expect(assertTarballSafe(tgz)).rejects.toThrow(/points outside/)
	})
})

describe("install state and download flow", () => {
	let db: TestDb
	beforeAll(async () => {
		db = await createTestDb()
	}, 60_000)
	afterAll(async () => {
		await (db as unknown as { $client: { close(): Promise<void> } }).$client.close().catch(() => {})
	})

	test("not installed, then installed with a version", async () => {
		await db.delete(audiocppSettings)
		const row = await ensureAudioCppSettings(db as never)
		expect(await getAudioCppInstallState(db as never)).toMatchObject({ installed: false, binaryPath: null })
		const dir = path.join(tmp, "bin")
		fs.mkdirSync(dir)
		fs.writeFileSync(path.join(dir, "audiocpp_server"), "#!/bin/sh\necho\necho 'audiocpp_server v0.9.3'\n", { mode: 0o755 })
		await db.update(audiocppSettings).set({ binaryDir: dir, backend: "cpu", releaseTag: "v0.9.3", binaryVariant: "x", binaryVerified: false })
		const s = await getAudioCppInstallState(db as never)
		expect(s).toMatchObject({
			installed: true,
			binaryPath: path.join(dir, "audiocpp_server"),
			version: "audiocpp_server v0.9.3",
			backend: "cpu",
			releaseTag: "v0.9.3",
			variant: "x",
			verified: false
		})
		expect(row.id).toBeGreaterThan(0)
	}, 60_000)

	test("download unpacks, replaces, records the row; bad asset refused", async () => {
		await db.delete(audiocppSettings)
		await ensureAudioCppSettings(db as never)
		const dir = path.join(tmp, "dl")
		fs.mkdirSync(dir)
		fs.writeFileSync(path.join(dir, "server.json"), "{}")
		fs.writeFileSync(path.join(dir, "old-file"), "old")
		await db.update(audiocppSettings).set({ binaryDir: dir })

		const tgz = makeTarball(tmp, (src) => {
			fs.writeFileSync(path.join(src, "audiocpp_server"), "#!/bin/sh\necho 'audiocpp_server v0.9.3'\n", { mode: 0o644 })
			fs.writeFileSync(path.join(src, "sub", "x.json"), "{}")
		}, ["."])
		const bytes = fs.readFileSync(tgz)
		const name = "audio-v0.9.3-bin-ubuntu-x64-cpu-portable.tar.gz"
		const rel = {
			tag_name: "v0.9.3",
			assets: [{ name, size: bytes.length, browser_download_url: `https://github.com/0xShug0/audio.cpp/releases/download/v0.9.3/${name}` }]
		}
		const fakeFetch = (async (url: string) =>
			url.startsWith("https://api.github.com")
				? new Response(JSON.stringify(rel))
				: new Response(bytes)) as never
		const opts = { fetch: fakeFetch, platform: "linux" as const, arch: "x64" }

		await expect(
			startAudioCppBinaryDownload(db as never, { assetName: "audio-v0.9.3-bin-ubuntu-x64-vulkan.tar.gz", releaseTag: "v0.9.3" }, opts)
		).rejects.toThrow(/not an audio.cpp build offered/)
		expect(getAudioCppBinaryDownloadState()).toBeNull()

		const pushed: (string | undefined)[] = []
		binaryDownloadEmitters.register(1, (p) => pushed.push(p.download?.status))
		let stopped = 0
		await startAudioCppBinaryDownload(
			db as never,
			{ assetName: name, releaseTag: "v0.9.3", beforeInstall: () => void stopped++ },
			opts
		)
		for (let i = 0; i < 200 && !getAudioCppBinaryDownloadState()?.isDone; i++)
			await new Promise((r) => setTimeout(r, 50))
		binaryDownloadEmitters.unregister(1)

		expect(getAudioCppBinaryDownloadState()).toMatchObject({ status: "success", isDone: true, verified: false })
		expect(pushed[0]).toBe("starting")
		expect(pushed).toContain("unpacking")
		expect(pushed.at(-1)).toBe("success")
		expect(stopped).toBe(1)
		expect(fs.statSync(path.join(dir, "audiocpp_server")).mode & 0o111).not.toBe(0)
		expect(fs.existsSync(path.join(dir, "sub", "x.json"))).toBe(true)
		expect(fs.existsSync(path.join(dir, "server.json"))).toBe(true)
		expect(fs.readdirSync(path.join(dir, ".downloads"))).toEqual([])
		expect(fs.readdirSync(dir).filter((f) => f.startsWith(".staging"))).toEqual([])
		const [row] = await db.select().from(audiocppSettings)
		expect(row).toMatchObject({
			binaryDir: dir, binaryVariant: name, releaseTag: "v0.9.3", backend: "cpu", binaryVerified: false
		})
	}, 60_000)
})
