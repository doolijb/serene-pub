/**
 * The in-app updater: download → verify → extract → mark ready → on the
 * admin's word, mark for apply and exit 75 (CONTRACT §C5, §C11).
 *
 * This side only ever prepares an update. The launcher does the swap, the
 * health check and any rollback, after this process has exited — a running
 * Node never replaces its own files.
 *
 * Every step happens only after the previous one succeeded, and the ready
 * marker is written last: a crash anywhere before it leaves nothing the
 * launcher would act on, and the next boot deletes the leftovers
 * (`cleanupStagingAtBoot`).
 *
 * **Gated before anything else.** Each public action first asks
 * `inAppUpdateGate`; a pre-release build, a container, Android, or a server
 * started without the launcher is refused before any network call or file
 * write. `state()` reports the refusal instead of throwing, so the Admin ›
 * Updates section can say why.
 *
 * One updater per process (`getUpdater`); `createUpdater` takes its
 * dependencies as parameters so tests drive it with a fake `fetch`, a temp
 * install root and a recorded exit.
 */
import fsp from "node:fs/promises"
import path from "node:path"
import {
	inAppUpdateGate,
	type InAppUpdateGate,
	type ReleaseTarget
} from "$lib/server/launcher/launcherEnv"
import {
	downloadVerifiedAsset,
	ReleaseDownloadError,
	type FetchLike
} from "$lib/server/net/githubReleaseDownload"
import {
	compareVersions,
	isPrereleaseVersion
} from "$lib/shared/utils/releaseChannel"
import { extractZip } from "./extract"
import {
	APPLY_MARKER,
	assetNameFor,
	DOWNLOAD_PART,
	EXTRACTING_SUFFIX,
	hasSwapJournal,
	READY_MARKER,
	readReadyMarker,
	TAG_RE,
	versionOfTag,
	writeJsonAtomic,
	type ApplyMarker,
	type ReadyMarker
} from "./markers"
import { verifyPayload } from "./payload"

export const RELEASES_PAGE_URL = "https://github.com/doolijb/serene-pub/releases"
const RELEASE_API = "https://api.github.com/repos/doolijb/serene-pub/releases/tags/"

/** The exit code that tells the launcher "apply the staged update" (§C4). */
export const APPLY_EXIT_CODE = 75

export class UpdaterRefusedError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "UpdaterRefusedError"
	}
}

export type UpdatePhase =
	| "idle"
	| "downloading"
	| "extracting"
	| "ready"
	| "applying"
	| "error"

export interface UpdatesState {
	currentVersion: string
	inApp: { allowed: boolean; reason: string | null; message: string | null }
	/** The newer release the update check found, if any. */
	latestTag: string | null
	phase: UpdatePhase
	/** The release being downloaded or staged. */
	tag: string | null
	received: number
	total: number | null
	error: string | null
	staged: { tag: string; version: string; stagedAt: string; size: number } | null
	releasesUrl: string
}

export interface UpdaterDeps {
	version: string
	env?: NodeJS.ProcessEnv
	platform?: NodeJS.Platform
	arch?: string
	exists?: (p: string) => boolean
	fetch?: FetchLike
	isAllowedHost?: (hostname: string) => boolean
	/** The tag the update check found newer, or null. */
	latestTag: () => string | null
	requestShutdown: (opts: { reason: string; exitCode: number }) => Promise<void> | void
	now?: () => Date
	/** How long `apply` waits before shutting down; tests pass 0. */
	applyDelayMs?: number
}

interface ReleaseAssets {
	zip: { name: string; url: string; size: number }
	sha256Url: string | null
}

/** The zip and its checksum for one tag and target, from GitHub's release API. */
export async function lookupReleaseAssets(
	tag: string,
	target: ReleaseTarget,
	doFetch: FetchLike
): Promise<ReleaseAssets> {
	if (!TAG_RE.test(tag)) throw new UpdaterRefusedError(`"${tag}" is not a release this updater accepts.`)
	let res: Response
	try {
		res = await doFetch(RELEASE_API + encodeURIComponent(tag), {
			headers: { Accept: "application/vnd.github+json", "User-Agent": "serene-pub-updater" },
			signal: AbortSignal.timeout(15_000)
		})
	} catch (err) {
		throw new ReleaseDownloadError(
			`Could not reach GitHub to look up ${tag}: ${err instanceof Error ? err.message : String(err)}`,
			"http"
		)
	}
	if (!res.ok) throw new ReleaseDownloadError(`GitHub has no release ${tag} (HTTP ${res.status}).`, "http")
	const data = (await res.json()) as {
		draft?: boolean
		assets?: Array<{ name?: unknown; browser_download_url?: unknown; size?: unknown }>
	}
	if (data?.draft) throw new UpdaterRefusedError(`${tag} is not published yet.`)
	const name = assetNameFor(tag, target)
	const assets = Array.isArray(data?.assets) ? data.assets : []
	const zip = assets.find((a) => a?.name === name)
	if (!zip || typeof zip.browser_download_url !== "string")
		throw new UpdaterRefusedError(`${tag} has no download for this platform (${name}).`)
	const sha = assets.find((a) => a?.name === `${name}.sha256`)
	return {
		zip: {
			name,
			url: zip.browser_download_url,
			size: typeof zip.size === "number" ? zip.size : 0
		},
		sha256Url: typeof sha?.browser_download_url === "string" ? sha.browser_download_url : null
	}
}

function plainError(err: unknown): string {
	if (err instanceof Error && err.message) return err.message
	return "The update could not be prepared."
}

export function createUpdater(deps: UpdaterDeps) {
	let phase: UpdatePhase = "idle"
	let tag: string | null = null
	let received = 0
	let total: number | null = null
	let error: string | null = null
	let abort: AbortController | null = null
	let job: Promise<void> | null = null
	const listeners = new Set<() => void>()
	const now = deps.now ?? (() => new Date())

	function changed() {
		for (const l of listeners) {
			try {
				l()
			} catch (err) {
				console.warn("[updater] listener failed:", err)
			}
		}
	}

	function gate(): InAppUpdateGate {
		return inAppUpdateGate({
			version: deps.version,
			env: deps.env,
			platform: deps.platform,
			arch: deps.arch,
			exists: deps.exists
		})
	}

	/** The gate's environment, or a refusal — before any network or disk work. */
	function allowed() {
		const g = gate()
		if (!g.allowed) throw new UpdaterRefusedError(g.message)
		return g.env
	}

	function state(): UpdatesState {
		const g = gate()
		const latest = isPrereleaseVersion(deps.version) ? null : deps.latestTag()
		let staged: UpdatesState["staged"] = null
		if (g.allowed) {
			const ready = readReadyMarker(g.env.updateDir)
			if (ready)
				staged = {
					tag: ready.tag,
					version: ready.version,
					stagedAt: ready.stagedAt,
					size: ready.asset?.size ?? 0
				}
		}
		return {
			currentVersion: deps.version,
			inApp: g.allowed
				? { allowed: true, reason: null, message: null }
				: { allowed: false, reason: g.reason, message: g.message },
			latestTag: latest,
			phase: phase === "idle" && staged ? "ready" : phase,
			tag: tag ?? staged?.tag ?? null,
			received,
			total,
			error,
			staged,
			releasesUrl: RELEASES_PAGE_URL
		}
	}

	function reset(next: UpdatePhase, message: string | null = null) {
		phase = next
		error = message
		if (next !== "downloading" && next !== "extracting") abort = null
		changed()
	}

	async function removeLeftovers(stagingDir: string, forTag: string) {
		await fsp.rm(path.join(stagingDir, DOWNLOAD_PART), { force: true })
		await fsp.rm(path.join(stagingDir, forTag + EXTRACTING_SUFFIX), { recursive: true, force: true })
	}

	/**
	 * Start preparing the newer release. Resolves once the work has begun
	 * (refusals throw here); the work itself reports through `onChange`.
	 */
	async function download(): Promise<{ started: Promise<void> }> {
		const env = allowed()
		if (job) throw new UpdaterRefusedError("An update is already being prepared.")
		const wanted = deps.latestTag()
		if (!wanted || !TAG_RE.test(wanted))
			throw new UpdaterRefusedError("There is no newer release to download.")
		if (isPrereleaseVersion(wanted))
			throw new UpdaterRefusedError(`${wanted} is a pre-release, and pre-releases are never installed from here.`)
		if (compareVersions(versionOfTag(wanted), deps.version) <= 0)
			throw new UpdaterRefusedError(`${wanted} is not newer than this version.`)

		const stagingDir = env.updateDir
		await fsp.mkdir(stagingDir, { recursive: true })
		if (hasSwapJournal(stagingDir))
			throw new UpdaterRefusedError(
				"The launcher has not finished the last update. Restart Serene Pub from its launcher, then try again."
			)
		if (readReadyMarker(stagingDir))
			throw new UpdaterRefusedError("An update is already downloaded. Apply it or discard it first.")

		const controller = new AbortController()
		abort = controller
		tag = wanted
		received = 0
		total = null
		error = null
		phase = "downloading"
		changed()

		const run = prepare(env, stagingDir, wanted, controller.signal)
		job = run.finally(() => {
			job = null
		})
		return { started: job }
	}

	async function prepare(
		env: ReturnType<typeof allowed>,
		stagingDir: string,
		wanted: string,
		signal: AbortSignal
	): Promise<void> {
		const doFetch = deps.fetch ?? ((u, i) => fetch(u, i))
		const version = versionOfTag(wanted)
		const partPath = path.join(stagingDir, DOWNLOAD_PART)
		const extracting = path.join(stagingDir, wanted + EXTRACTING_SUFFIX)
		const payloadDir = path.join(stagingDir, wanted)
		let lastEmit = 0
		try {
			await removeLeftovers(stagingDir, wanted)
			// A payload folder with no ready marker beside it is a crash between
			// the rename and the marker; it is not trusted.
			await fsp.rm(payloadDir, { recursive: true, force: true })

			const assets = await lookupReleaseAssets(wanted, env.target, doFetch)
			total = assets.zip.size || null
			const verified = await downloadVerifiedAsset({
				url: assets.zip.url,
				sha256Url: assets.sha256Url,
				assetName: assets.zip.name,
				destPath: partPath,
				fetch: doFetch,
				isAllowedHost: deps.isAllowedHost,
				signal,
				onProgress: (p) => {
					received = p.received
					if (p.total) total = p.total
					const t = Date.now()
					if (t - lastEmit >= 250) {
						lastEmit = t
						changed()
					}
				}
			})
			if (signal.aborted) throw new ReleaseDownloadError("The download was cancelled.", "cancelled")

			phase = "extracting"
			changed()
			await extractZip(partPath, extracting)
			if (signal.aborted) throw new ReleaseDownloadError("The download was cancelled.", "cancelled")
			const launcherVersion = verifyPayload(extracting, { target: env.target, version })

			await fsp.rename(extracting, payloadDir)
			await fsp.rm(partPath, { force: true })

			// The commit point — last, after every check above passed.
			const ready: ReadyMarker = {
				schema: 1,
				tag: wanted,
				version,
				fromVersion: deps.version,
				target: env.target,
				channel: env.channel,
				launcherVersion,
				payload: wanted,
				asset: {
					name: assets.zip.name,
					url: assets.zip.url,
					size: verified.size,
					sha256: verified.sha256
				},
				stagedAt: now().toISOString()
			}
			writeJsonAtomic(path.join(stagingDir, READY_MARKER), ready)
			console.log(`[updater] ${wanted} is downloaded, verified and ready to apply.`)
			reset("idle")
		} catch (err) {
			await removeLeftovers(stagingDir, wanted).catch(() => {})
			await fsp.rm(payloadDir, { recursive: true, force: true }).catch(() => {})
			const cancelled = err instanceof ReleaseDownloadError && err.code === "cancelled"
			if (cancelled) {
				console.log(`[updater] Download of ${wanted} cancelled.`)
				tag = null
				received = 0
				total = null
				reset("idle")
			} else {
				console.warn(`[updater] Could not prepare ${wanted}:`, err)
				reset("error", plainError(err))
			}
		}
	}

	function cancel(): void {
		allowed()
		abort?.abort()
	}

	/** Remove a prepared update. Never touches the launcher's own files. */
	async function discard(): Promise<void> {
		const env = allowed()
		if (job) throw new UpdaterRefusedError("Cancel the download first.")
		if (phase === "applying") throw new UpdaterRefusedError("The update is already being applied.")
		const stagingDir = env.updateDir
		if (hasSwapJournal(stagingDir))
			throw new UpdaterRefusedError("The launcher is in the middle of an update; nothing was discarded.")
		const ready = readReadyMarker(stagingDir)
		await fsp.rm(path.join(stagingDir, APPLY_MARKER), { force: true })
		await fsp.rm(path.join(stagingDir, READY_MARKER), { force: true })
		if (ready && ready.payload && /^[^/\\]+$/.test(ready.payload) && ready.payload !== "previous" && ready.payload !== "failed")
			await fsp.rm(path.join(stagingDir, ready.payload), { recursive: true, force: true })
		if (ready) await removeLeftovers(stagingDir, ready.tag)
		tag = null
		received = 0
		total = null
		reset("idle")
	}

	/**
	 * Record the admin's consent and exit 75 for the launcher to swap. The
	 * apply marker is written only for a ready marker that matches this
	 * install; resolves once it is written, and the shutdown follows.
	 */
	async function apply(requestedBy: number | null): Promise<void> {
		const env = allowed()
		if (job) throw new UpdaterRefusedError("The update is still downloading.")
		const stagingDir = env.updateDir
		if (hasSwapJournal(stagingDir))
			throw new UpdaterRefusedError("The launcher has not finished the last update.")
		const ready = readReadyMarker(stagingDir)
		if (!ready) throw new UpdaterRefusedError("There is no downloaded update to apply.")
		if (ready.target !== env.target || ready.channel !== env.channel)
			throw new UpdaterRefusedError("The downloaded update is for a different kind of install. Discard it and download again.")
		if (isPrereleaseVersion(ready.version))
			throw new UpdaterRefusedError("The downloaded update is a pre-release and cannot be applied.")
		try {
			verifyPayload(path.join(stagingDir, ready.payload), {
				target: env.target,
				version: ready.version
			})
		} catch (err) {
			throw new UpdaterRefusedError(`${plainError(err)} Discard it and download again.`)
		}

		const marker: ApplyMarker = {
			schema: 1,
			tag: ready.tag,
			requestedAt: now().toISOString(),
			requestedBy
		}
		writeJsonAtomic(path.join(stagingDir, APPLY_MARKER), marker)
		tag = ready.tag
		reset("applying")
		console.log(`[updater] Restarting to update to ${ready.tag} (requested by ${requestedBy ?? "unknown"}).`)
		// A moment's grace so the admin's "Restarting to update" reply leaves
		// before the sockets close.
		setTimeout(() => {
			void Promise.resolve(
				deps.requestShutdown({ reason: "update", exitCode: APPLY_EXIT_CODE })
			).catch((err) => console.error("[updater] Shutdown for the update failed:", err))
		}, deps.applyDelayMs ?? 250)
	}

	function onChange(listener: () => void): () => void {
		listeners.add(listener)
		return () => listeners.delete(listener)
	}

	return { state, download, cancel, discard, apply, onChange }
}

export type Updater = ReturnType<typeof createUpdater>

let instance: Updater | null = null

/** The process's updater, wired to the real update check and shutdown. */
export async function getUpdater(): Promise<Updater> {
	if (instance) return instance
	const [{ appVersion }, { getUpdateState }] = await Promise.all([
		import("$lib/shared/constants/version"),
		import("$lib/server/updates/updateCheck")
	])
	instance = createUpdater({
		version: String(appVersion),
		latestTag: () => {
			const s = getUpdateState()
			return s.isNewerReleaseAvailable ? (s.latestReleaseTag ?? null) : null
		},
		requestShutdown: async (opts) => {
			const { requestShutdown } = await import("$lib/server/services")
			await requestShutdown(opts)
		}
	})
	return instance
}

