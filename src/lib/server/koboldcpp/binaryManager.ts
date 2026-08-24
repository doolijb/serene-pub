import * as https from "https"
import * as http from "http"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import * as crypto from "crypto"

export interface BinaryVariant {
	name: string
	displayName: string
	platform: "linux" | "windows" | "macos" | "other"
	description: string
	downloadUrl: string
	sizeBytes: number
	/** URL of this asset's published `.sha256` checksum file, if the release has one. */
	sha256Url?: string
}

export interface BinaryDownloadState {
	assetName: string
	status: "starting" | "downloading" | "success" | "error" | "cancelled"
	downloaded: number
	total: number
	isDone: boolean
	error?: string
}

let currentDownload: (BinaryDownloadState & { abort?: () => void }) | null =
	null
type ProgressEmitter = (d: { download: BinaryDownloadState | null }) => void
// Map<userId, {emit, connections}>, not a single nullable slot or a
// Set<ProgressEmitter> — the old single-slot design meant whichever admin
// socket most recently called setEmitter() became the sole recipient of
// binary-download progress, silently cutting off any other connected
// admin's UI. A Set<ProgressEmitter> fixes that but overcorrects:
// registration happens once per *connection*, and emitToUser already
// broadcasts to every open tab/connection for a user — so N tabs for the
// same admin would mean N entries in the Set, each independently
// re-broadcasting to all N sockets (N² transmissions per tick instead of
// N). Keying by userId with a connection refcount collapses that back to
// one broadcast per user regardless of tab count, and only unregisters
// once every one of their connections has disconnected.
const progressEmitters = new Map<
	number,
	{ emit: ProgressEmitter; connections: number }
>()

export function registerEmitter(userId: number, fn: ProgressEmitter) {
	const existing = progressEmitters.get(userId)
	if (existing) {
		existing.connections++
		return
	}
	progressEmitters.set(userId, { emit: fn, connections: 1 })
}

export function unregisterEmitter(userId: number) {
	const existing = progressEmitters.get(userId)
	if (!existing) return
	existing.connections--
	if (existing.connections <= 0) progressEmitters.delete(userId)
}

// Progress ticks arrive on every TCP chunk of a streaming download (up to
// hundreds of thousands of times for a multi-GB binary) — each broadcast
// is a synchronous JSON-serialize + Socket.IO emit, competing with the
// download's own network I/O on Node's single event loop. Throttling the
// broadcast (not the byte-counter update) is the single biggest win for
// actual download throughput. Single-flight download (one `currentDownload`
// slot at a time), so a single global timer is enough — no per-key map
// needed the way koboldcpp.ts's multi-download model download needs.
const PROGRESS_EMIT_THROTTLE_MS = 250
let lastProgressEmitAt = 0

function emitProgress() {
	const payload = currentDownload
		? { download: (({ abort: _, ...rest }) => rest)(currentDownload) }
		: { download: null }
	for (const { emit } of progressEmitters.values()) {
		try {
			emit(payload)
		} catch {}
	}
}

export function getDownloadState(): BinaryDownloadState | null {
	if (!currentDownload) return null
	const { abort: _, ...rest } = currentDownload
	return rest
}

function detectPlatform(name: string): BinaryVariant["platform"] {
	const lower = name.toLowerCase()
	if (lower.endsWith(".exe")) return "windows"
	if (lower.includes("mac") || lower.includes("osx")) return "macos"
	// Linux: starts with koboldcpp, no extension, not mac
	if (/^koboldcpp(?:_[a-z0-9]+)*$/i.test(name)) return "linux"
	return "other"
}

function makeDescription(name: string): string {
	const lower = name.toLowerCase().replace(/\.exe$/i, "")
	if (/cu121|cuda121|cuda12_1/i.test(lower)) return "NVIDIA CUDA 12.1"
	if (/cu118|cuda118|cuda11_8/i.test(lower)) return "NVIDIA CUDA 11.8"
	if (/cu12/i.test(lower)) return "NVIDIA CUDA 12.x"
	if (/cu11/i.test(lower)) return "NVIDIA CUDA 11.x"
	if (/rocm/i.test(lower)) return "AMD ROCm (GPU)"
	if (/vulkan/i.test(lower)) return "Vulkan (cross-GPU)"
	if (/opencl/i.test(lower)) return "OpenCL (GPU)"
	if (/metal/i.test(lower)) return "Metal (Apple GPU)"
	if (/mac|osx/i.test(lower)) return "Metal (Apple GPU)"
	// Base build: no suffix after koboldcpp
	if (/^koboldcpp(\.exe)?$/i.test(name))
		return "CPU + Vulkan + OpenCL — works on any hardware (recommended)"
	return "CPU"
}

function makeDisplayName(name: string): string {
	return name.replace(/\.exe$/i, "").replace(/_/g, " ")
}

// GitHub serves release assets via a redirect off github.com — historically
// to objects.githubusercontent.com, migrating to
// release-assets.githubusercontent.com since mid-2025. Both are live
// depending on when a given release's assets were uploaded, so both must be
// allowed. Exact-match (not suffix-match): these are fixed, known single
// hosts, not a wildcard-subdomain CDN.
const ALLOWED_GITHUB_RELEASE_HOSTS = new Set([
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com"
])

export function isAllowedGithubReleaseHost(hostname: string): boolean {
	return ALLOWED_GITHUB_RELEASE_HOSTS.has(hostname.toLowerCase())
}

export interface ReleaseVersion {
	tag: string
	publishedAt: string
	isLatest: boolean
}

export async function listVariants(
	tag?: string
): Promise<{ variants: BinaryVariant[]; releaseTag: string }> {
	const url =
		tag && tag !== "latest"
			? `https://api.github.com/repos/LostRuins/koboldcpp/releases/tags/${encodeURIComponent(tag)}`
			: "https://api.github.com/repos/LostRuins/koboldcpp/releases/latest"

	const resp = await fetch(url, {
		headers: { Accept: "application/vnd.github.v3+json" }
	})
	if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`)

	const release = await resp.json()
	const releaseTag: string = release.tag_name ?? "unknown"
	const assets = (release.assets ?? []) as {
		name: string
		browser_download_url: string
		size: number
	}[]

	const variants = assets
		.filter((a) => {
			const lower = a.name.toLowerCase()
			if (!lower.startsWith("koboldcpp")) return false
			if (
				lower.endsWith(".sha256") ||
				lower.endsWith(".sha1") ||
				lower.endsWith(".md5")
			)
				return false
			if (
				lower.endsWith(".tar.gz") ||
				lower.endsWith(".tar") ||
				lower.endsWith(".7z")
			)
				return false
			return true
		})
		.map((a) => ({
			name: a.name,
			displayName: makeDisplayName(a.name),
			platform: detectPlatform(a.name),
			description: makeDescription(a.name),
			downloadUrl: a.browser_download_url,
			sizeBytes: a.size,
			sha256Url: assets.find((s) => s.name === `${a.name}.sha256`)
				?.browser_download_url
		}))

	return { variants, releaseTag }
}

export async function listReleaseVersions(
	count = 10
): Promise<ReleaseVersion[]> {
	const [listResp, latestResp] = await Promise.all([
		fetch(
			`https://api.github.com/repos/LostRuins/koboldcpp/releases?per_page=${count}`,
			{ headers: { Accept: "application/vnd.github.v3+json" } }
		),
		fetch(
			"https://api.github.com/repos/LostRuins/koboldcpp/releases/latest",
			{ headers: { Accept: "application/vnd.github.v3+json" } }
		)
	])

	if (!listResp.ok) throw new Error(`GitHub API returned ${listResp.status}`)

	const releases = await listResp.json()
	const latestTag = latestResp.ok ? (await latestResp.json()).tag_name : null

	return (releases as any[]).map((r) => ({
		tag: r.tag_name as string,
		publishedAt: r.published_at as string,
		isLatest: r.tag_name === latestTag
	}))
}

export async function downloadVariant(opts: {
	assetName: string
	downloadUrl: string
	destDir: string
	/** Published checksum URL, if the release has one — verified after download. */
	sha256Url?: string
}): Promise<void> {
	const { assetName, downloadUrl, destDir, sha256Url } = opts

	if (currentDownload && !currentDownload.isDone) {
		throw new Error("A binary download is already in progress.")
	}

	// Defense in depth: callers are expected to have already revalidated
	// assetName against the real GitHub release list (real asset names never
	// contain path separators), but this is cheap insurance against a
	// crafted name escaping destDir via path.join below.
	if (assetName.includes("/") || assetName.includes("\\")) {
		throw new Error("Invalid asset name.")
	}

	const destPath = path.join(destDir, assetName)

	currentDownload = {
		assetName,
		status: "starting",
		downloaded: 0,
		total: 0,
		isDone: false
	}
	emitProgress()

	try {
		// Deliberately inside the try: a mkdir failure (eg. a permissions
		// problem on a mounted volume) is just as much a download failure as
		// a network error, and must reach the client the same way — via
		// emitProgress()'s "error" status below, not silently swallowed by
		// whatever bare console.error() the caller wraps this in.
		await fsPromises.mkdir(destDir, { recursive: true })

		await new Promise<void>((resolve, reject) => {
			function request(url: string, redirectsLeft: number) {
				const urlObj = new URL(url)
				if (!isAllowedGithubReleaseHost(urlObj.hostname)) {
					reject(
						new Error(
							`Refusing to download from disallowed host: ${urlObj.hostname}`
						)
					)
					return
				}
				const lib = urlObj.protocol === "https:" ? https : http

				const req = lib.get(url, (res) => {
					if (
						res.statusCode &&
						res.statusCode >= 300 &&
						res.statusCode < 400 &&
						res.headers.location
					) {
						if (redirectsLeft <= 0) {
							reject(new Error("Too many redirects"))
							return
						}
						request(res.headers.location, redirectsLeft - 1)
						return
					}

					currentDownload!.total = parseInt(
						res.headers["content-length"] ?? "0",
						10
					)
					currentDownload!.status = "downloading"
					emitProgress()

					const writer = fs.createWriteStream(destPath)

					res.on("data", (chunk: Buffer) => {
						currentDownload!.downloaded += chunk.length
						const now = Date.now()
						if (
							now - lastProgressEmitAt >=
							PROGRESS_EMIT_THROTTLE_MS
						) {
							lastProgressEmitAt = now
							emitProgress()
						}
					})
					res.pipe(writer)
					writer.on("finish", resolve)
					writer.on("error", reject)
					res.on("error", reject)
				})

				req.on("error", reject)

				currentDownload!.abort = () => {
					req.destroy()
					reject(new Error("cancelled"))
				}
			}

			request(downloadUrl, 5)
		})

		// Best-effort: not every release publishes a .sha256 asset, so a
		// missing one just skips verification rather than failing the
		// download outright.
		if (sha256Url) {
			const checksumResp = await fetch(sha256Url)
			if (checksumResp.ok) {
				const checksumText = await checksumResp.text()
				// Typical sha256sum format is "<hex>  <filename>" — take just
				// the leading hex token.
				const expectedHex = checksumText
					.trim()
					.split(/\s+/)[0]
					?.toLowerCase()
				const fileBuffer = await fsPromises.readFile(destPath)
				const actualHex = crypto
					.createHash("sha256")
					.update(fileBuffer)
					.digest("hex")
				if (expectedHex && expectedHex !== actualHex) {
					throw new Error(
						"Downloaded binary failed checksum verification."
					)
				}
			}
		}

		// Make executable on Unix
		if (process.platform !== "win32") {
			await fsPromises.chmod(destPath, 0o755)
		}

		currentDownload!.status = "success"
		currentDownload!.isDone = true
		emitProgress()
	} catch (err: any) {
		const cancelled = err.message === "cancelled"
		currentDownload!.status = cancelled ? "cancelled" : "error"
		currentDownload!.error = cancelled ? undefined : err.message
		currentDownload!.isDone = true
		emitProgress()

		// Clean up the partial file regardless of why the download stopped —
		// a genuine error leaves the same half-written file behind as a
		// cancellation does.
		fsPromises.unlink(destPath).catch(() => {})

		if (!cancelled) throw err
	}
}

export function cancelDownload() {
	if (currentDownload && !currentDownload.isDone && currentDownload.abort) {
		currentDownload.abort()
	}
}
