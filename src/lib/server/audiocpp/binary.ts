/**
 * audio.cpp, run by Serene Pub — the binary: which build to offer, download it,
 * unpack it, say what is installed.
 *
 * Builds come from the `0xShug0/audio.cpp` GitHub releases. Asset grammar:
 * `audio-v<ver>-(bin|lib|cudart)-<os>-<arch>-<backend>[<detail>][-portable|-test|-colab].(tar.gz|zip)`.
 * Only `bin` assets are ever offered; `lib` archives are libraries, `-test` and
 * `-colab` builds are experimental. A `cudart` archive is the CUDA runtime that a
 * CUDA build needs beside it; it is fetched with the build, never offered alone.
 *
 * Releases publish no checksums today, so installs are recorded as unverified
 * (`binaryVerified: false`). When a release does publish a `.sha256` (or a
 * `SHA256SUMS` file) beside an asset, it is mandatory for that asset.
 *
 * This module never imports `process.ts`: the caller passes `beforeInstall` to
 * stop a running audio.cpp before its files are replaced.
 */
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web"
import { eq } from "drizzle-orm"
import { audiocppSettings } from "$lib/server/db/schema"
import { getAppDataDir } from "$lib/server/utils/appDataDir"
import {
	createProgressThrottle,
	createUserEmitters,
	type UserEmitterSlot,
	type UserEmitters
} from "$lib/server/managed/emitters"
import {
	fetchExpectedSha256,
	fetchFromRelease,
	parseSha256File,
	ReleaseDownloadError,
	type FetchLike
} from "$lib/server/net/githubReleaseDownload"
import { extractZip, safeEntryPath } from "$lib/server/updater/extract"
import { ensureAudioCppSettings } from "./settings"

type Backend = Sockets.AudioCpp.Backend
type BinaryVariant = Sockets.AudioCpp.BinaryVariant
type DownloadState = Sockets.AudioCpp.BinaryDownloadProgress.DownloadState

export const AUDIOCPP_RELEASE_REPO = "0xShug0/audio.cpp"
const API_BASE = `https://api.github.com/repos/${AUDIOCPP_RELEASE_REPO}`

// ─── Paths ──────────────────────────────────────────────────────────────

export function audioCppServerFileName(
	platform: NodeJS.Platform = process.platform
): string {
	return platform === "win32" ? "audiocpp_server.exe" : "audiocpp_server"
}

/** `settings.binaryDir` → `AUDIOCPP_BINARY_DIR` → `<appdata>/audiocpp`. */
export function resolveAudioCppBinaryDir(settings: {
	binaryDir?: string | null
}): string {
	return (
		settings.binaryDir ||
		process.env.AUDIOCPP_BINARY_DIR ||
		path.join(getAppDataDir(), "audiocpp")
	)
}

/** The server executable, or null when the file is absent. */
export async function audioCppBinaryPath(settings: {
	binaryDir?: string | null
}): Promise<string | null> {
	const p = path.join(resolveAudioCppBinaryDir(settings), audioCppServerFileName())
	try {
		const st = await fsp.stat(p)
		return st.isFile() ? p : null
	} catch {
		return null
	}
}

// ─── Asset names ────────────────────────────────────────────────────────

export interface ParsedAudioCppAsset {
	version: string
	kind: "bin" | "lib" | "cudart"
	/** Normalised: the release's "ubuntu" is "linux". */
	os: "linux" | "windows" | "macos"
	arch: "x64" | "arm64"
	backend: Backend
	/** What follows the backend word, e.g. "12.4" for cuda12.4; "" when none. */
	backendDetail: string
	portable: boolean
	/** A `-test` or `-colab` build. */
	experimental: boolean
	ext: "tar.gz" | "zip"
}

const ASSET_RE =
	/^audio-v(\d+(?:\.\d+)*)-(bin|lib|cudart)-(ubuntu|windows|macos)-(x64|arm64)-(cpu|vulkan|cuda|metal|rocm)(\d[\d.]*)?(?:-(portable|test|colab))?\.(tar\.gz|zip)$/

export function parseAudioCppAssetName(name: string): ParsedAudioCppAsset | null {
	const m = ASSET_RE.exec(name)
	if (!m) return null
	return {
		version: m[1],
		kind: m[2] as ParsedAudioCppAsset["kind"],
		os: m[3] === "ubuntu" ? "linux" : (m[3] as "windows" | "macos"),
		arch: m[4] as "x64" | "arm64",
		backend: m[5] as Backend,
		backendDetail: m[6] ?? "",
		portable: m[7] === "portable",
		experimental: m[7] === "test" || m[7] === "colab",
		ext: m[8] as "tar.gz" | "zip"
	}
}

export interface ReleaseAsset {
	name: string
	size: number
	browser_download_url: string
}

const OS_LABEL = { linux: "Linux", windows: "Windows", macos: "macOS" } as const

/** Offered order after the recommendation, as asset keys: backend+detail+portable. */
const OFFER_ORDER: Record<string, string[]> = {
	linux: ["cpu-portable", "vulkan-portable", "cpu", "vulkan"],
	windows: [
		"cpu-portable",
		"vulkan-portable",
		"cuda12.4",
		"cuda13.3",
		"cpu",
		"vulkan"
	],
	macos: ["metal"]
}

function variantKey(p: ParsedAudioCppAsset): string {
	return `${p.backend}${p.backendDetail}${p.portable ? "-portable" : ""}`
}

function describe(
	p: ParsedAudioCppAsset
): { label: string; reason: string } {
	if (p.backend === "metal")
		return {
			label: p.arch === "arm64" ? "Metal (Apple silicon)" : "Metal (Intel Mac)",
			reason:
				"Uses your Mac's GPU. Fast for every voice, including Qwen3-TTS and Kitten."
		}
	if (p.backend === "cuda")
		return {
			label: `NVIDIA CUDA ${p.backendDetail}`,
			reason:
				"Needs an NVIDIA card. Qwen3-TTS and Kitten want a GPU. Also downloads the CUDA runtime (about 600 MB) beside it."
		}
	if (p.backend === "rocm")
		return {
			label: `AMD ROCm ${p.backendDetail}`,
			reason: "Needs a supported AMD card. Qwen3-TTS and Kitten want a GPU."
		}
	if (p.backend === "vulkan")
		return {
			label: p.portable ? "Vulkan GPU (portable)" : "Vulkan GPU",
			reason: p.portable
				? "Works with most GPUs, and runs on more CPUs at some speed cost. Qwen3-TTS and Kitten want a GPU."
				: "Works with most GPUs. Qwen3-TTS and Kitten want a GPU."
		}
	return {
		label: p.portable ? "CPU (portable)" : "CPU",
		reason: p.portable
			? "Kokoro speaks fine on a CPU. Portable builds run on more CPUs, at some speed cost."
			: "Kokoro speaks fine on a CPU. Faster than the portable build on a recent CPU, but may not start on an older one."
	}
}

/**
 * The builds worth offering on this machine, recommended first. Pure.
 * Linux arm64, and any platform with nothing published, gives [].
 */
export function variantsForPlatform(
	assets: ReleaseAsset[],
	target: { platform: NodeJS.Platform; arch: string }
): BinaryVariant[] {
	const os =
		target.platform === "linux"
			? "linux"
			: target.platform === "win32"
				? "windows"
				: target.platform === "darwin"
					? "macos"
					: null
	if (!os || (target.arch !== "x64" && target.arch !== "arm64")) return []

	const parsed = assets
		.map((a) => ({ a, p: parseAudioCppAssetName(a.name) }))
		.filter(
			(x): x is { a: ReleaseAsset; p: ParsedAudioCppAsset } =>
				x.p !== null
		)
	const runtimes = parsed.filter((x) => x.p.kind === "cudart" && x.p.os === os && x.p.arch === target.arch)
	const builds = parsed.filter(
		(x) =>
			x.p.kind === "bin" &&
			!x.p.experimental &&
			x.p.os === os &&
			x.p.arch === target.arch
	)

	const order = OFFER_ORDER[os]
	const rank = (key: string) => {
		const i = order.indexOf(key)
		return i === -1 ? order.length : i
	}
	builds.sort(
		(x, y) =>
			rank(variantKey(x.p)) - rank(variantKey(y.p)) ||
			x.a.name.localeCompare(y.a.name)
	)

	return builds.map(({ a, p }, i) => {
		const { label, reason } = describe(p)
		const runtime =
			p.backend === "cuda"
				? runtimes.find(
						(r) => r.p.backend === "cuda" && r.p.backendDetail === p.backendDetail
					)
				: undefined
		const v: BinaryVariant = {
			name: `${OS_LABEL[os]} · ${label}`,
			assetName: a.name,
			sizeBytes: a.size,
			backend: p.backend,
			portable: p.portable,
			reason
		}
		if (runtime) v.needsRuntimeAsset = runtime.a.name
		if (i === 0) v.recommended = true
		return v
	})
}

// ─── GitHub API ─────────────────────────────────────────────────────────

export interface BinaryOptions {
	fetch?: FetchLike
	platform?: NodeJS.Platform
	arch?: string
}

interface ApiRelease {
	tag_name?: string
	published_at?: string
	draft?: boolean
	prerelease?: boolean
	assets?: ReleaseAsset[]
}

async function apiGet<T>(url: string, opts: BinaryOptions): Promise<T> {
	const doFetch = opts.fetch ?? ((u, i) => fetch(u, i))
	let res: Response
	try {
		res = await doFetch(url, {
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "serene-pub"
			}
		})
	} catch (err) {
		throw new Error(
			`Could not reach GitHub to list audio.cpp releases: ${err instanceof Error ? err.message : String(err)}`
		)
	}
	if (!res.ok)
		throw new Error(
			res.status === 404
				? "That audio.cpp release was not found on GitHub."
				: `GitHub answered ${res.status} when listing audio.cpp releases. Try again later.`
		)
	return (await res.json()) as T
}

export async function listAudioCppReleaseVersions(
	opts: BinaryOptions = {}
): Promise<Sockets.AudioCpp.ListReleaseVersions.Response> {
	const releases = await apiGet<ApiRelease[]>(`${API_BASE}/releases?per_page=30`, opts)
	const live = releases.filter((r) => !r.draft && r.tag_name)
	const latestIdx = live.findIndex((r) => !r.prerelease)
	return {
		versions: live.map((r, i) => ({
			tag: r.tag_name as string,
			publishedAt: r.published_at ?? "",
			isLatest: i === (latestIdx === -1 ? 0 : latestIdx)
		}))
	}
}

async function getRelease(tag: string | undefined, opts: BinaryOptions): Promise<ApiRelease> {
	const url =
		tag && tag !== "latest"
			? `${API_BASE}/releases/tags/${encodeURIComponent(tag)}`
			: `${API_BASE}/releases/latest`
	return apiGet<ApiRelease>(url, opts)
}

export async function listAudioCppBinaryVariants(
	params: { tag?: string } = {},
	opts: BinaryOptions = {}
): Promise<Sockets.AudioCpp.ListBinaryVariants.Response> {
	const release = await getRelease(params.tag, opts)
	return {
		variants: variantsForPlatform(release.assets ?? [], {
			platform: opts.platform ?? process.platform,
			arch: opts.arch ?? process.arch
		}),
		releaseTag: release.tag_name ?? params.tag ?? "unknown"
	}
}

// ─── Download state and emitters ────────────────────────────────────────

interface DownloadSlot {
	state: DownloadState | null
	abort: AbortController | null
}
const G = globalThis as unknown as {
	__serenePubAudioCppBinary?: DownloadSlot
	__serenePubAudioCppBinaryEmitters?: Map<number, UserEmitterSlot<Sockets.AudioCpp.BinaryDownloadProgress.Response>>
}
const slot: DownloadSlot = (G.__serenePubAudioCppBinary ??= {
	state: null,
	abort: null
})

export const binaryDownloadEmitters: UserEmitters<Sockets.AudioCpp.BinaryDownloadProgress.Response> =
	createUserEmitters(
		(G.__serenePubAudioCppBinaryEmitters ??= new Map())
	)
const throttle = createProgressThrottle()

function emitState(force = true) {
	if (!force && !throttle.ready()) return
	binaryDownloadEmitters.emit({
		download: slot.state ? { ...slot.state } : null
	})
}

export function getAudioCppBinaryDownloadState(): DownloadState | null {
	return slot.state ? { ...slot.state } : null
}

export function cancelAudioCppBinaryDownload(): void {
	if (slot.state && !slot.state.isDone) slot.abort?.abort()
}

// ─── Unpacking ──────────────────────────────────────────────────────────

function run(
	cmd: string,
	args: string[],
	opts: { signal?: AbortSignal; timeout?: number } = {}
): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			cmd,
			args,
			{ maxBuffer: 64 * 1024 * 1024, signal: opts.signal, timeout: opts.timeout },
			(err, stdout) => (err ? reject(err) : resolve(String(stdout)))
		)
	})
}

class UnsafeArchive extends Error {}

/** Refuse a tarball with names or links that leave the folder. */
export async function assertTarballSafe(
	archive: string,
	signal?: AbortSignal
): Promise<void> {
	const names = (await run("tar", ["-tzf", archive], { signal })).split("\n").filter(Boolean)
	for (const n of names) {
		if (n === "./" || n === ".") continue
		try {
			safeEntryPath(n)
		} catch {
			throw new UnsafeArchive(
				`The audio.cpp download contains a file that would land outside its folder (${n}), so it was not installed.`
			)
		}
	}
	const verbose = (await run("tar", ["-tzvf", archive], { signal })).split("\n").filter(Boolean)
	for (const line of verbose) {
		const type = line[0]
		if (type === "-" || type === "d") {
			if (line.includes(" link to ")) throw new UnsafeArchive("The audio.cpp download contains a hard link, so it was not installed.")
			continue
		}
		if (type !== "l")
			throw new UnsafeArchive("The audio.cpp download contains a special file, so it was not installed.")
		const arrow = line.lastIndexOf(" -> ")
		if (arrow === -1) throw new UnsafeArchive("The audio.cpp download contains a link that could not be read, so it was not installed.")
		const target = line.slice(arrow + 4).trim()
		const head = line.slice(0, arrow)
		// Member name: the verbose line ends with it; match it against the plain list.
		const owner = names
			.filter((n) => head.endsWith(n.replace(/\/$/, "")))
			.sort((a, b) => b.length - a.length)[0]
		const base = owner ? path.posix.dirname(owner.replace(/^\.\//, "")) : "."
		const resolved = path.posix.normalize(path.posix.join(base, target))
		if (target.startsWith("/") || /^[a-zA-Z]:/.test(target) || resolved === ".." || resolved.startsWith("../"))
			throw new UnsafeArchive(
				`The audio.cpp download contains a link that points outside its folder (${target}), so it was not installed.`
			)
	}
}

async function unpack(archive: string, ext: "tar.gz" | "zip", into: string, signal: AbortSignal) {
	await fsp.mkdir(into, { recursive: true })
	if (ext === "zip") {
		await extractZip(archive, into)
		return
	}
	await assertTarballSafe(archive, signal)
	await run("tar", ["-xzf", archive, "-C", into, "--no-same-owner"], { signal })
}

const EXECUTABLES = ["audiocpp_server", "audiocpp_cli", "audiocpp_gguf"]

/** Move each top-level entry of `from` into `dest`, replacing the old one. */
async function moveInto(from: string, dest: string) {
	for (const entry of await fsp.readdir(from)) {
		const target = path.join(dest, entry)
		await fsp.rm(target, { recursive: true, force: true })
		await fsp.rename(path.join(from, entry), target)
	}
}

// ─── Download ───────────────────────────────────────────────────────────

async function checksumFor(
	assets: ReleaseAsset[],
	assetName: string,
	fetchImpl: FetchLike | undefined,
	signal: AbortSignal
): Promise<string | null> {
	const own = assets.find((a) => a.name === `${assetName}.sha256`)
	if (own)
		return fetchExpectedSha256(own.browser_download_url, assetName, { fetch: fetchImpl, signal })
	const sums = assets.find((a) => /^sha256sums(\.txt)?$/i.test(a.name))
	if (!sums) return null
	let text: string
	try {
		text = await (await fetchFromRelease(sums.browser_download_url, { fetch: fetchImpl, signal })).text()
	} catch (err) {
		if (err instanceof ReleaseDownloadError && err.code === "cancelled") throw err
		throw new ReleaseDownloadError(
			`The checksum list for ${assetName} could not be fetched, so the download was refused.`,
			"checksum-missing"
		)
	}
	for (const line of text.split(/\r?\n/)) {
		if (!line.includes(assetName)) continue
		const hex = parseSha256File(line, assetName)
		if (hex) return hex
	}
	throw new ReleaseDownloadError(
		`The release's checksum list has no entry for ${assetName}, so the download was refused.`,
		"checksum-missing"
	)
}

async function fetchArchive(opts: {
	asset: ReleaseAsset
	assets: ReleaseAsset[]
	dest: string
	phase: "binary" | "runtime"
	fetch?: FetchLike
	signal: AbortSignal
}): Promise<{ verified: boolean }> {
	const expected = await checksumFor(opts.assets, opts.asset.name, opts.fetch, opts.signal)
	const part = `${opts.dest}.part`
	const hash = crypto.createHash("sha256")
	const state = slot.state as DownloadState
	state.phase = opts.phase
	state.status = "downloading"
	state.downloaded = 0
	state.total = opts.asset.size ?? 0
	emitState()
	try {
		const res = await fetchFromRelease(opts.asset.browser_download_url, {
			fetch: opts.fetch,
			signal: opts.signal
		})
		if (!res.body) throw new ReleaseDownloadError("GitHub sent an empty download.", "http")
		const len = Number(res.headers.get("content-length"))
		if (Number.isFinite(len) && len > 0) state.total = len
		emitState()
		const meter = new Transform({
			transform(chunk: Buffer, _enc, done) {
				hash.update(chunk)
				state.downloaded += chunk.length
				emitState(false)
				done(null, chunk)
			}
		})
		await pipeline(
			Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>),
			meter,
			fs.createWriteStream(part, { mode: 0o644 }),
			{ signal: opts.signal }
		)
	} catch (err) {
		await fsp.rm(part, { force: true }).catch(() => {})
		if (opts.signal.aborted) throw new ReleaseDownloadError("The download was cancelled.", "cancelled")
		if (err instanceof ReleaseDownloadError) throw err
		throw new ReleaseDownloadError(
			`The download stopped: ${err instanceof Error ? err.message : String(err)}`,
			"io"
		)
	}
	if (expected && hash.digest("hex") !== expected) {
		await fsp.rm(part, { force: true }).catch(() => {})
		throw new ReleaseDownloadError(
			`${opts.asset.name} did not match its published checksum, so it was deleted. Try again later.`,
			"checksum-mismatch"
		)
	}
	await fsp.rename(part, opts.dest)
	return { verified: expected !== null }
}

export interface StartBinaryDownloadParams {
	assetName: string
	releaseTag: string
	/** Called just before files are replaced: stop a running audio.cpp here. */
	beforeInstall?: () => Promise<void> | void
}

/**
 * Validate and start installing one build. Resolves once the download has
 * started; the rest runs in the background and reports through
 * `binaryDownloadEmitters`. Throws on an asset this machine is not offered, or
 * when a download is already running.
 */
export async function startAudioCppBinaryDownload(
	db: Db,
	params: StartBinaryDownloadParams,
	opts: BinaryOptions = {}
): Promise<void> {
	if (slot.state && !slot.state.isDone)
		throw new Error("An audio.cpp download is already running. Wait for it to finish or cancel it.")
	// Claim the slot before the first await, so two quick calls cannot both pass.
	const abort = new AbortController()
	const state: DownloadState = {
		assetName: params.assetName,
		status: "starting",
		phase: "binary",
		downloaded: 0,
		total: 0,
		isDone: false
	}
	slot.state = state
	slot.abort = abort

	let release: ApiRelease
	let variant: BinaryVariant | undefined
	let settingsDir: string
	try {
		release = await getRelease(params.releaseTag, opts)
		const assets = release.assets ?? []
		variant = variantsForPlatform(assets, {
			platform: opts.platform ?? process.platform,
			arch: opts.arch ?? process.arch
		}).find((v) => v.assetName === params.assetName)
		if (!variant)
			throw new Error(
				`${params.assetName} is not an audio.cpp build offered for this computer in ${params.releaseTag}. Pick one from the list.`
			)
		settingsDir = resolveAudioCppBinaryDir(await ensureAudioCppSettings(db))
	} catch (err) {
		slot.state = null
		slot.abort = null
		throw err
	}
	emitState()
	void install(db, params, release, variant, settingsDir, abort, opts)
}

async function install(
	db: Db,
	params: StartBinaryDownloadParams,
	release: ApiRelease,
	variant: BinaryVariant,
	binaryDir: string,
	abort: AbortController,
	opts: BinaryOptions
): Promise<void> {
	const state = slot.state as DownloadState
	const assets = release.assets ?? []
	const downloads = path.join(binaryDir, ".downloads")
	const staging = path.join(binaryDir, `.staging-${Date.now()}`)
	const archives: { path: string; ext: "tar.gz" | "zip" }[] = []
	try {
		await fsp.mkdir(downloads, { recursive: true })
		const wanted = [
			{ name: variant.assetName, phase: "binary" as const },
			...(variant.needsRuntimeAsset
				? [{ name: variant.needsRuntimeAsset, phase: "runtime" as const }]
				: [])
		]
		let verified = true
		for (const w of wanted) {
			const asset = assets.find((a) => a.name === w.name)
			if (!asset)
				throw new Error(`${w.name} is missing from release ${params.releaseTag}.`)
			const parsed = parseAudioCppAssetName(w.name)
			const dest = path.join(downloads, w.name)
			const r = await fetchArchive({
				asset,
				assets,
				dest,
				phase: w.phase,
				fetch: opts.fetch,
				signal: abort.signal
			})
			verified = verified && r.verified
			archives.push({ path: dest, ext: parsed?.ext ?? "tar.gz" })
		}

		state.status = "unpacking"
		state.phase = "binary"
		state.verified = verified
		emitState()
		if (abort.signal.aborted) throw new ReleaseDownloadError("The download was cancelled.", "cancelled")
		for (const a of archives) await unpack(a.path, a.ext, staging, abort.signal)

		// Archives are flat; tolerate one wrapping folder.
		let source = staging
		const exe = audioCppServerFileName()
		if (!fs.existsSync(path.join(source, exe))) {
			const kids = await fsp.readdir(staging)
			if (kids.length === 1 && fs.existsSync(path.join(staging, kids[0], exe)))
				source = path.join(staging, kids[0])
			else
				throw new Error(`The audio.cpp download did not contain ${exe}, so nothing was installed.`)
		}
		if (process.platform !== "win32")
			for (const f of EXECUTABLES)
				await fsp.chmod(path.join(source, f), 0o755).catch(() => {})

		if (abort.signal.aborted) throw new ReleaseDownloadError("The download was cancelled.", "cancelled")
		await params.beforeInstall?.()
		await moveInto(source, binaryDir)

		const row = await ensureAudioCppSettings(db)
		await db
			.update(audiocppSettings)
			.set({
				binaryDir,
				binaryVariant: variant.assetName,
				releaseTag: params.releaseTag,
				backend: variant.backend,
				binaryVerified: verified,
				updatedAt: new Date()
			})
			.where(eq(audiocppSettings.id, row.id))

		state.status = "success"
		state.isDone = true
		emitState()
	} catch (err) {
		const cancelled =
			abort.signal.aborted ||
			(err instanceof ReleaseDownloadError && err.code === "cancelled")
		state.status = cancelled ? "cancelled" : "error"
		state.error = cancelled
			? undefined
			: err instanceof UnsafeArchive || err instanceof ReleaseDownloadError
				? err.message
				: err instanceof Error
					? err.message
					: String(err)
		state.isDone = true
		emitState()
	} finally {
		await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
		for (const a of archives) await fsp.rm(a.path, { force: true }).catch(() => {})
		await fsp.rm(path.join(downloads, `${params.assetName}.part`), { force: true }).catch(() => {})
		if (variant.needsRuntimeAsset)
			await fsp.rm(path.join(downloads, `${variant.needsRuntimeAsset}.part`), { force: true }).catch(() => {})
		slot.abort = null
		throttle.forget()
	}
}

// ─── Install state ──────────────────────────────────────────────────────

async function readVersion(binary: string): Promise<string | undefined> {
	try {
		const out = await run(binary, ["--version"], { timeout: 5000 })
		return out.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
	} catch {
		return undefined
	}
}

export async function getAudioCppInstallState(
	db: Db
): Promise<Sockets.AudioCpp.InstallState.Response> {
	const settings = await ensureAudioCppSettings(db)
	const binaryPath = await audioCppBinaryPath(settings)
	if (!binaryPath) return { installed: false, binaryPath: null }
	const version = await readVersion(binaryPath)
	return {
		installed: true,
		binaryPath,
		...(version ? { version } : {}),
		...(settings.backend ? { backend: settings.backend } : {}),
		releaseTag: settings.releaseTag,
		variant: settings.binaryVariant,
		...(settings.binaryVerified !== null ? { verified: settings.binaryVerified } : {})
	}
}
