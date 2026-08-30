import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import * as https from "https"
import * as http from "http"
import { execFile } from "child_process"
import { promisify } from "util"
import { getAppDataDir } from "$lib/server/utils"
import { isAllowedGithubReleaseHost } from "$lib/server/koboldcpp/binaryManager"

const execFileAsync = promisify(execFile)

/**
 * `cloudflared` acquisition (plan 26 §7).
 *
 * Same shape of problem as the KoboldCPP binary manager, so the parts that are
 * genuinely shared are imported rather than re-implemented — notably
 * `isAllowedGithubReleaseHost`, which is a security control (this downloads a
 * file that gets chmod +x and spawned) and must not drift between two copies.
 *
 * What is *not* shared: KoboldCPP's manager lets an admin pick a variant and a
 * release tag, because which build you want is a real user-facing choice there.
 * Here there is exactly one correct asset for the host platform and no reason
 * to offer a menu, so this resolves it and gets out of the way.
 */

const CLOUDFLARED_LATEST_BASE =
	"https://github.com/cloudflare/cloudflared/releases/latest/download"

export interface CloudflaredAsset {
	/** Release asset name, e.g. `cloudflared-linux-amd64`. */
	assetName: string
	/** Filename to store on disk (the extracted binary, not the archive). */
	binaryName: string
	/** macOS ships the binary inside a .tgz; every other platform is raw. */
	isArchive: boolean
}

/**
 * Cloudflare publishes one asset per platform/arch pair under a stable naming
 * scheme, so this is a lookup rather than a release-listing API call — one
 * fewer network dependency on the start path, and it works offline once the
 * binary is cached.
 */
export function resolveAsset(
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch
): CloudflaredAsset {
	const archName =
		arch === "x64"
			? "amd64"
			: arch === "arm64"
				? "arm64"
				: arch === "arm"
					? "arm"
					: arch === "ia32"
						? "386"
						: null
	if (!archName) {
		throw new Error(`No cloudflared build for architecture "${arch}".`)
	}

	if (platform === "win32") {
		if (archName !== "amd64" && archName !== "386") {
			throw new Error(
				`No cloudflared Windows build for architecture "${arch}".`
			)
		}
		return {
			assetName: `cloudflared-windows-${archName}.exe`,
			binaryName: "cloudflared.exe",
			isArchive: false
		}
	}

	if (platform === "darwin") {
		// The only platform Cloudflare ships as an archive rather than a bare
		// executable, which is why isArchive exists at all.
		return {
			assetName: `cloudflared-darwin-${archName}.tgz`,
			binaryName: "cloudflared",
			isArchive: true
		}
	}

	if (platform === "linux") {
		return {
			assetName: `cloudflared-linux-${archName}`,
			binaryName: "cloudflared",
			isArchive: false
		}
	}

	throw new Error(`No cloudflared build for platform "${platform}".`)
}

export function getBinaryDir(): string {
	return path.join(getAppDataDir(), "cloudflared")
}

export function getBinaryPath(
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch
): string {
	return path.join(getBinaryDir(), resolveAsset(platform, arch).binaryName)
}

async function exists(p: string): Promise<boolean> {
	try {
		await fsPromises.access(p, fs.constants.F_OK)
		return true
	} catch {
		return false
	}
}

function download(url: string, destPath: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		function request(current: string, redirectsLeft: number) {
			let urlObj: URL
			try {
				urlObj = new URL(current)
			} catch {
				reject(new Error("Invalid download URL"))
				return
			}
			// Re-validated on every hop, not just the first. A redirect is
			// attacker-influenceable in a way the initial URL isn't, and the
			// file at the end of it gets chmod +x and spawned.
			if (!isAllowedGithubReleaseHost(urlObj.hostname)) {
				reject(
					new Error(
						`Refusing to download cloudflared from disallowed host: ${urlObj.hostname}`
					)
				)
				return
			}
			const lib = urlObj.protocol === "https:" ? https : http
			const req = lib.get(current, (res) => {
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
					res.resume()
					request(res.headers.location, redirectsLeft - 1)
					return
				}
				if (!res.statusCode || res.statusCode >= 400) {
					res.resume()
					reject(
						new Error(
							`cloudflared download failed with HTTP ${res.statusCode}`
						)
					)
					return
				}
				const writer = fs.createWriteStream(destPath)
				res.pipe(writer)
				writer.on("finish", () => resolve())
				writer.on("error", reject)
				res.on("error", reject)
			})
			req.on("error", reject)
		}
		request(url, 5)
	})
}

/**
 * Resolve a usable `cloudflared`, downloading it once and caching it in the app
 * data directory. Returns the executable's path.
 *
 * `SERENE_PUB_CLOUDFLARED_PATH` short-circuits everything: an admin who already
 * has cloudflared installed (a package manager, a distro package, an air-gapped
 * host with no GitHub access) should not be made to re-download it, and this is
 * also the seam that makes the supervisor testable without a network.
 */
export async function ensureBinary(): Promise<string> {
	const override = process.env.SERENE_PUB_CLOUDFLARED_PATH?.trim()
	if (override) {
		if (!(await exists(override))) {
			throw new Error(
				`SERENE_PUB_CLOUDFLARED_PATH points at ${override}, which does not exist.`
			)
		}
		return override
	}

	const asset = resolveAsset()
	const binaryDir = getBinaryDir()
	const binaryPath = path.join(binaryDir, asset.binaryName)
	if (await exists(binaryPath)) return binaryPath

	await fsPromises.mkdir(binaryDir, { recursive: true })
	const downloadPath = path.join(binaryDir, asset.assetName)
	const url = `${CLOUDFLARED_LATEST_BASE}/${asset.assetName}`

	try {
		await download(url, downloadPath)

		if (asset.isArchive) {
			// macOS only, and macOS always has bsdtar on PATH. Extracting into
			// the same directory the archive landed in keeps cleanup trivial.
			await execFileAsync("tar", ["-xzf", downloadPath, "-C", binaryDir])
			await fsPromises.unlink(downloadPath).catch(() => {})
			if (!(await exists(binaryPath))) {
				throw new Error(
					"cloudflared archive did not contain the expected binary."
				)
			}
		} else if (downloadPath !== binaryPath) {
			await fsPromises.rename(downloadPath, binaryPath)
		}

		if (process.platform !== "win32") {
			await fsPromises.chmod(binaryPath, 0o755)
		}
		return binaryPath
	} catch (err) {
		// A partial file is indistinguishable from a good one on the next
		// start, and a truncated executable fails in far more confusing ways
		// than a missing one. Clear both possible names.
		await fsPromises.unlink(downloadPath).catch(() => {})
		await fsPromises.unlink(binaryPath).catch(() => {})
		throw err
	}
}
