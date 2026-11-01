/**
 * Hugging Face download helpers, shared by every feature that fetches a model
 * from Hugging Face (KoboldCPP models, audio.cpp packages).
 *
 * Lifted verbatim from `sockets/koboldcpp.ts` (which re-exports them). The one
 * change: `downloadFileInParallelChunks` reports bytes through an `onBytes`
 * callback instead of writing into KoboldCPP's download table.
 */
import * as fsPromises from "fs/promises"
import * as https from "https"
import * as http from "http"

// Every legitimate model downloadUrl this app ever constructs points at
// huggingface.co (search/recommended-models flows below). Hugging Face's
// large-file storage (Xet) commonly redirects a real `.../resolve/main/...`
// download to a host under hf.co — eg. cas-bridge.xethub.hf.co — which is
// NOT a subdomain of huggingface.co, so both roots need covering. Suffix
// checks, not exact-subdomain matches — deeper subdomains under xethub.hf.co
// exist and a single-label wildcard would miss them.
export function isAllowedHuggingFaceHost(hostname: string): boolean {
	const h = hostname.toLowerCase()
	return (
		h === "huggingface.co" ||
		h.endsWith(".huggingface.co") ||
		h === "hf.co" ||
		h.endsWith(".hf.co")
	)
}

// A single sequential HTTP connection to Hugging Face's CDN is
// throughput-capped well below what the link can sustain in aggregate —
// the same reason HF's own hf_transfer tool and third-party aria2c-based
// downloaders exist. Splitting the file into byte-range chunks and pulling
// them concurrently (bounded worker pool below) gets meaningfully closer to
// real link speed. Chunk *size*, not chunk *count*, is fixed so a 70GB
// model doesn't degrade into a handful of multi-GB chunks that leave the
// pool under-saturated for most of the download.
const PARALLEL_CHUNK_SIZE_BYTES = 64 * 1024 * 1024 // 64MB
// Within the 4-16 range aria2c -x/hf_transfer commonly use — enough to beat
// a single connection, conservative enough not to look abusive to HF's CDN.
const MAX_PARALLEL_CHUNKS_PER_DOWNLOAD = 6

export type ResolvedDownload =
	| { kind: "ranged"; resolvedUrl: string; total: number }
	| {
			kind: "fallback"
			resolvedUrl: string
			total: number
			initialResponse: import("http").IncomingMessage
	  }

// Issues a 1-byte range probe against downloadUrl (following at most one
// redirect, same validation as the real download below) to cheaply learn
// (a) whether the eventual host supports range requests at all and (b) the
// true total size — read from content-range's "/TOTAL" suffix in the 206
// case, since content-length for a 1-byte range response is just "1".
// registerRequest is called with every ClientRequest issued here so the
// caller can track them for cancellation before this promise settles.
export function resolveHuggingFaceDownload(
	downloadUrl: string,
	registerRequest: (req: import("http").ClientRequest) => void
): Promise<ResolvedDownload> {
	return new Promise((resolve, reject) => {
		function probe(url: string, isRedirect: boolean) {
			const lib = url.startsWith("https") ? https : http
			const req = lib.get(
				url,
				{ headers: { Range: "bytes=0-0" } },
				(res) => {
					if (
						!isRedirect &&
						res.statusCode &&
						res.statusCode >= 300 &&
						res.statusCode < 400 &&
						res.headers.location
					) {
						const redirectUrl = res.headers.location
						let parsedRedirectUrl: URL
						try {
							parsedRedirectUrl = new URL(redirectUrl)
						} catch {
							res.resume()
							reject(new Error("Invalid redirect URL"))
							return
						}
						if (
							!isAllowedHuggingFaceHost(
								parsedRedirectUrl.hostname
							)
						) {
							res.resume()
							reject(
								new Error(
									"Redirect target is not a Hugging Face URL"
								)
							)
							return
						}
						res.resume()
						probe(redirectUrl, true)
						return
					}

					if (res.statusCode === 206) {
						const contentRange = res.headers["content-range"]
						const match =
							typeof contentRange === "string"
								? contentRange.match(/\/(\d+)\s*$/)
								: null
						const total = match ? parseInt(match[1], 10) : 0
						res.resume() // discard the 1-byte probe body
						resolve({ kind: "ranged", resolvedUrl: url, total })
						return
					}

					if (res.statusCode && res.statusCode < 300) {
						const total = parseInt(
							res.headers["content-length"] ?? "0",
							10
						)
						// This response IS the full body starting at byte 0 —
						// don't discard it, hand it to the fallback path.
						resolve({
							kind: "fallback",
							resolvedUrl: url,
							total,
							initialResponse: res
						})
						return
					}

					res.resume()
					reject(
						new Error(
							`Download request failed with status ${res.statusCode}`
						)
					)
				}
			)
			req.on("error", reject)
			registerRequest(req)
		}
		probe(downloadUrl, false)
	})
}

// Downloads [resolvedUrl] as concurrent byte-range chunks into a
// pre-allocated file, using a bounded worker pool. Each chunk is written at
// its exact offset via a shared FileHandle's positional write (POSIX
// pwrite), which is safe for concurrent non-overlapping writers on one fd —
// unlike multiple concurrent fs.createWriteStream instances against the
// same path, which aren't designed for that.
export async function downloadFileInParallelChunks(opts: {
	resolvedUrl: string
	total: number
	destPath: string
	/** Called with each received chunk's byte length. */
	onBytes: (bytes: number) => void
	registerRequest: (req: import("http").ClientRequest) => void
	isAborted: () => boolean
}): Promise<void> {
	const {
		resolvedUrl,
		total,
		destPath,
		onBytes,
		registerRequest,
		isAborted
	} = opts
	const chunkCount = Math.max(1, Math.ceil(total / PARALLEL_CHUNK_SIZE_BYTES))
	const lib = resolvedUrl.startsWith("https") ? https : http
	const AgentCtor = resolvedUrl.startsWith("https") ? https.Agent : http.Agent
	const agent = new AgentCtor({
		keepAlive: true,
		maxSockets: MAX_PARALLEL_CHUNKS_PER_DOWNLOAD
	})

	const fileHandle = await fsPromises.open(destPath, "w")
	try {
		await fileHandle.truncate(total)

		let nextChunkIndex = 0
		function downloadChunk(idx: number): Promise<void> {
			const start = idx * PARALLEL_CHUNK_SIZE_BYTES
			const end = Math.min(start + PARALLEL_CHUNK_SIZE_BYTES, total) - 1
			return new Promise((resolve, reject) => {
				const req = lib.get(
					resolvedUrl,
					{ headers: { Range: `bytes=${start}-${end}` }, agent },
					async (res) => {
						if (res.statusCode !== 206) {
							res.resume()
							reject(
								new Error(
									`Chunk request failed with status ${res.statusCode}`
								)
							)
							return
						}
						try {
							let position = start
							for await (const buf of res as AsyncIterable<Buffer>) {
								await fileHandle.write(
									buf,
									0,
									buf.length,
									position
								)
								position += buf.length
								onBytes(buf.length)
							}
							resolve()
						} catch (err) {
							reject(err)
						}
					}
				)
				req.on("error", reject)
				registerRequest(req)
			})
		}

		async function worker(): Promise<void> {
			while (!isAborted() && nextChunkIndex < chunkCount) {
				const idx = nextChunkIndex++
				await downloadChunk(idx)
			}
		}

		const workerCount = Math.min(
			MAX_PARALLEL_CHUNKS_PER_DOWNLOAD,
			chunkCount
		)
		await Promise.all(Array.from({ length: workerCount }, () => worker()))
	} finally {
		await fileHandle.close().catch(() => {})
		agent.destroy()
	}
}
