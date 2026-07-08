import * as https from "https"
import * as http from "http"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"

export interface BinaryVariant {
	name: string
	displayName: string
	platform: "linux" | "windows" | "macos" | "other"
	description: string
	downloadUrl: string
	sizeBytes: number
}

export interface BinaryDownloadState {
	assetName: string
	status: "starting" | "downloading" | "success" | "error" | "cancelled"
	downloaded: number
	total: number
	isDone: boolean
	error?: string
}

let currentDownload: (BinaryDownloadState & { abort?: () => void }) | null = null
let emitProgressFn: ((d: { download: BinaryDownloadState | null }) => void) | null = null

export function setEmitter(fn: (d: { download: BinaryDownloadState | null }) => void) {
	emitProgressFn = fn
}

function emitProgress() {
	if (!emitProgressFn) return
	if (!currentDownload) {
		emitProgressFn({ download: null })
		return
	}
	const { abort: _, ...rest } = currentDownload
	emitProgressFn({ download: rest })
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
	if (/^koboldcpp(\.exe)?$/i.test(name)) return "CPU + Vulkan + OpenCL — works on any hardware (recommended)"
	return "CPU"
}

function makeDisplayName(name: string): string {
	return name.replace(/\.exe$/i, "").replace(/_/g, " ")
}

export interface ReleaseVersion {
	tag: string
	publishedAt: string
	isLatest: boolean
}

export async function listVariants(tag?: string): Promise<{ variants: BinaryVariant[]; releaseTag: string }> {
	const url =
		tag && tag !== "latest"
			? `https://api.github.com/repos/LostRuins/koboldcpp/releases/tags/${encodeURIComponent(tag)}`
			: "https://api.github.com/repos/LostRuins/koboldcpp/releases/latest"

	const resp = await fetch(url, { headers: { Accept: "application/vnd.github.v3+json" } })
	if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`)

	const release = await resp.json()
	const releaseTag: string = release.tag_name ?? "unknown"
	const assets = (release.assets ?? []) as { name: string; browser_download_url: string; size: number }[]

	const variants = assets
		.filter((a) => {
			const lower = a.name.toLowerCase()
			if (!lower.startsWith("koboldcpp")) return false
			if (lower.endsWith(".sha256") || lower.endsWith(".sha1") || lower.endsWith(".md5")) return false
			if (lower.endsWith(".tar.gz") || lower.endsWith(".tar") || lower.endsWith(".7z")) return false
			return true
		})
		.map((a) => ({
			name: a.name,
			displayName: makeDisplayName(a.name),
			platform: detectPlatform(a.name),
			description: makeDescription(a.name),
			downloadUrl: a.browser_download_url,
			sizeBytes: a.size
		}))

	return { variants, releaseTag }
}

export async function listReleaseVersions(count = 10): Promise<ReleaseVersion[]> {
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
}): Promise<void> {
	const { assetName, downloadUrl, destDir } = opts

	await fsPromises.mkdir(destDir, { recursive: true })
	const destPath = path.join(destDir, assetName)

	currentDownload = { assetName, status: "starting", downloaded: 0, total: 0, isDone: false }
	emitProgress()

	try {
		await new Promise<void>((resolve, reject) => {
			function request(url: string, redirectsLeft: number) {
				const urlObj = new URL(url)
				const lib = urlObj.protocol === "https:" ? https : http

				const req = lib.get(url, (res) => {
					if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
						if (redirectsLeft <= 0) { reject(new Error("Too many redirects")); return }
						request(res.headers.location, redirectsLeft - 1)
						return
					}

					currentDownload!.total = parseInt(res.headers["content-length"] ?? "0", 10)
					currentDownload!.status = "downloading"
					emitProgress()

					const writer = fs.createWriteStream(destPath)

					res.on("data", (chunk: Buffer) => {
						currentDownload!.downloaded += chunk.length
						emitProgress()
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

		if (cancelled) {
			fsPromises.unlink(destPath).catch(() => {})
		}

		if (!cancelled) throw err
	}
}

export function cancelDownload() {
	if (currentDownload && !currentDownload.isDone && currentDownload.abort) {
		currentDownload.abort()
	}
}
