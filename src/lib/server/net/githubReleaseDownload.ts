/**
 * Download one GitHub release asset to disk, safely (CONTRACT §C12).
 *
 * The safe parts of `koboldcpp/binaryManager.ts`'s download, made reusable and
 * stricter:
 *
 * - **Allowlisted hosts on every hop.** Each URL, including every redirect
 *   target, must be one of GitHub's release hosts — checked before the request
 *   is made, so a redirect to anywhere else is refused, not followed.
 * - **At most five redirects.**
 * - **Streamed to disk**, hashed as it streams. A release zip is hundreds of
 *   megabytes; nothing here holds it in memory.
 * - **Mandatory checksum.** The `.sha256` beside the asset is fetched first. A
 *   missing, unreachable or malformed checksum refuses the download before a
 *   byte of the asset is fetched, and a mismatch deletes what was written.
 *
 * `fetch` and the host allowlist are injectable so tests run without a
 * network. Uses the platform `fetch` with `redirect: "manual"`, which hands
 * back the 3xx and its `Location` for this module to judge.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web"

/**
 * GitHub serves release assets through a redirect off github.com, to either of
 * two asset hosts depending on when the asset was uploaded. Exact matches: these
 * are fixed hosts, not a wildcard CDN.
 */
const GITHUB_RELEASE_HOSTS = new Set([
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com"
])

export function isAllowedGithubReleaseHost(hostname: string): boolean {
	return GITHUB_RELEASE_HOSTS.has(hostname.toLowerCase())
}

export const MAX_REDIRECTS = 5

export type FetchLike = (
	input: string,
	init?: RequestInit
) => Promise<Response>

export interface DownloadOptions {
	fetch?: FetchLike
	isAllowedHost?: (hostname: string) => boolean
	signal?: AbortSignal
}

export class ReleaseDownloadError extends Error {
	constructor(
		message: string,
		readonly code:
			| "host"
			| "redirects"
			| "http"
			| "checksum-missing"
			| "checksum-mismatch"
			| "cancelled"
			| "io"
	) {
		super(message)
		this.name = "ReleaseDownloadError"
	}
}

function assertAllowed(
	url: string,
	isAllowedHost: (hostname: string) => boolean
): URL {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new ReleaseDownloadError(`Not a valid download address: ${url}`, "host")
	}
	if (parsed.protocol !== "https:" || !isAllowedHost(parsed.hostname)) {
		throw new ReleaseDownloadError(
			`Refusing to download from ${parsed.protocol}//${parsed.hostname} — only GitHub's release servers are allowed.`,
			"host"
		)
	}
	return parsed
}

/**
 * GET `url`, following at most `MAX_REDIRECTS` redirects, each target checked
 * against the allowlist before it is requested. Returns the final 2xx response.
 */
export async function fetchFromRelease(
	url: string,
	opts: DownloadOptions = {}
): Promise<Response> {
	const doFetch = opts.fetch ?? ((u, i) => fetch(u, i))
	const isAllowedHost = opts.isAllowedHost ?? isAllowedGithubReleaseHost
	let current = url
	for (let hop = 0; ; hop++) {
		assertAllowed(current, isAllowedHost)
		let res: Response
		try {
			res = await doFetch(current, {
				redirect: "manual",
				signal: opts.signal,
				headers: { "User-Agent": "serene-pub-updater" }
			})
		} catch (err) {
			if (opts.signal?.aborted)
				throw new ReleaseDownloadError("The download was cancelled.", "cancelled")
			throw new ReleaseDownloadError(
				`Could not reach GitHub: ${err instanceof Error ? err.message : String(err)}`,
				"http"
			)
		}
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get("location")
			if (!location)
				throw new ReleaseDownloadError(`GitHub answered ${res.status} with nowhere to go.`, "http")
			if (hop >= MAX_REDIRECTS)
				throw new ReleaseDownloadError("Too many redirects.", "redirects")
			await res.body?.cancel().catch(() => {})
			current = new URL(location, current).toString()
			continue
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {})
			throw new ReleaseDownloadError(`GitHub answered ${res.status}.`, "http")
		}
		return res
	}
}

/**
 * Parse sha256sum output (`<64 hex>  <name>`). When the line names a file it
 * must be `expectedName`; a checksum for some other file is no checksum.
 */
export function parseSha256File(text: string, expectedName?: string): string | null {
	const line = text.replace(/^﻿/, "").trim().split(/\r?\n/)[0] ?? ""
	const match = /^([0-9a-fA-F]{64})(?:\s+\*?(.+))?$/.exec(line.trim())
	if (!match) return null
	const name = match[2]?.trim()
	if (expectedName && name && name !== expectedName) return null
	return match[1].toLowerCase()
}

/** The published checksum, or a refusal. Never optional. */
export async function fetchExpectedSha256(
	sha256Url: string | null | undefined,
	assetName: string,
	opts: DownloadOptions = {}
): Promise<string> {
	if (!sha256Url)
		throw new ReleaseDownloadError(
			`The release has no checksum for ${assetName}, so it cannot be verified. Nothing was downloaded.`,
			"checksum-missing"
		)
	let text: string
	try {
		const res = await fetchFromRelease(sha256Url, opts)
		text = await res.text()
	} catch (err) {
		if (err instanceof ReleaseDownloadError && (err.code === "host" || err.code === "cancelled")) throw err
		throw new ReleaseDownloadError(
			`The checksum for ${assetName} could not be fetched, so the download was refused.`,
			"checksum-missing"
		)
	}
	const hex = parseSha256File(text, assetName)
	if (!hex)
		throw new ReleaseDownloadError(
			`The checksum file for ${assetName} is not readable, so the download was refused.`,
			"checksum-missing"
		)
	return hex
}

export interface DownloadProgress {
	received: number
	total: number | null
}

/**
 * Fetch the checksum, then stream the asset to `destPath` while hashing it.
 * Resolves only when the bytes on disk match the published checksum; on any
 * failure the partial file is removed.
 */
export async function downloadVerifiedAsset(opts: {
	url: string
	sha256Url: string | null | undefined
	assetName: string
	destPath: string
	onProgress?: (p: DownloadProgress) => void
} & DownloadOptions): Promise<{ sha256: string; size: number }> {
	const expected = await fetchExpectedSha256(opts.sha256Url, opts.assetName, opts)

	const hash = crypto.createHash("sha256")
	let received = 0
	try {
		const res = await fetchFromRelease(opts.url, opts)
		if (!res.body)
			throw new ReleaseDownloadError("GitHub sent an empty download.", "http")
		const lengthHeader = Number(res.headers.get("content-length"))
		const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null
		opts.onProgress?.({ received: 0, total })

		const source = Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>)
		const meter = new Transform({
			transform(chunk: Buffer, _enc, done) {
				hash.update(chunk)
				received += chunk.length
				opts.onProgress?.({ received, total })
				done(null, chunk)
			}
		})
		await pipeline(
			source,
			meter,
			fs.createWriteStream(opts.destPath, { mode: 0o644 }),
			{ signal: opts.signal }
		)
	} catch (err) {
		await fsp.rm(opts.destPath, { force: true }).catch(() => {})
		if (opts.signal?.aborted)
			throw new ReleaseDownloadError("The download was cancelled.", "cancelled")
		if (err instanceof ReleaseDownloadError) throw err
		throw new ReleaseDownloadError(
			`The download stopped: ${err instanceof Error ? err.message : String(err)}`,
			"io"
		)
	}

	const actual = hash.digest("hex")
	if (actual !== expected) {
		await fsp.rm(opts.destPath, { force: true }).catch(() => {})
		throw new ReleaseDownloadError(
			`${opts.assetName} did not match its published checksum, so it was deleted. Try again later.`,
			"checksum-mismatch"
		)
	}
	return { sha256: actual, size: received }
}
