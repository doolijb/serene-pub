/**
 * audio.cpp's spec over the shared supervisor (`$lib/server/managed/supervisor`),
 * mirroring `koboldcpp/subprocessManager.ts`.
 *
 * Everything service-neutral (spawn, process trees, the watchdog, health check,
 * idle auto-stop, Stop) lives in the supervisor. This file keeps what is
 * audio.cpp's: its settings row, its `server.json`, its arguments, its ping,
 * and the record of which config the live process was spawned with.
 *
 * The app db is imported at the edge (like subprocessManager) so the spec's
 * callbacks can read settings; every exported library function that takes a
 * `db` uses that one explicitly.
 */
import * as path from "node:path"
import * as fsPromises from "node:fs/promises"
import { resolveAudioModelsDir } from "./packages"
import * as fs from "fs/promises"
import { eq } from "drizzle-orm"
import { db as appDb } from "$lib/server/db"
import { audiocppSettings } from "$lib/server/db/schema"
import {
	createSupervisor,
	type SupervisorStatusEvent
} from "$lib/server/managed/supervisor"
import { pollUntilReady } from "$lib/server/koboldcpp/pollUntilReady"
import { audioCppBinaryPath, resolveAudioCppBinaryDir } from "./binary"
import {
	audioCppConfigPath,
	audioCppLogPath,
	hashServerConfig,
	writeAudioCppConfig
} from "./config"
import { ensureAudioCppSettings, type AudioCppSettingsRow } from "./settings"

const DISABLED_MESSAGE =
	"audio.cpp, run by Serene Pub, is switched off — switch it on in its Settings."
const NOT_INSTALLED_MESSAGE =
	"audio.cpp isn't installed yet — download it from its connection's setup screen."
export const NO_PACKAGE_ON_DISK_MESSAGE =
	"None of audio.cpp's enabled packages is on disk. Download one again, or enable another, on its Models tab."
export const NO_PACKAGE_MESSAGE =
	"audio.cpp has no model to serve yet. Enable a speech or transcription package on its Models tab first."

/** Config bookkeeping shared across HMR evaluations of this module. */
interface ConfigBag {
	/** Hash prepare() settled on for the spawn about to happen. */
	pendingHash: string | null
	/** Hash of the config the live process was spawned with. */
	spawnedHash: string | null
	/** Hash of the file as last seen on disk. */
	fileHash: string | null
}
const BAG_KEY = "__SERENE_PUB_AUDIOCPP_CONFIG__"
const bag: ConfigBag = ((globalThis as any)[BAG_KEY] ??= {
	pendingHash: null,
	spawnedHash: null,
	fileHash: null
} satisfies ConfigBag)

export function audioCppBaseUrl(settings: Pick<AudioCppSettingsRow, "port">) {
	return `http://127.0.0.1:${settings.port}`
}

const settings = () => ensureAudioCppSettings(appDb)

/** GET <baseUrl>/health is `{status:"ok"}`. */
async function pingAudioCpp(baseUrl: string, timeoutMs: number) {
	try {
		const res = await fetch(`${baseUrl}/health`, {
			signal: AbortSignal.timeout(timeoutMs)
		})
		if (!res.ok) return false
		const body = (await res.json()) as { status?: string }
		return body?.status === "ok"
	} catch {
		return false
	}
}

export const audioCppSupervisor = createSupervisor({
	id: "audiocpp",
	label: "audio.cpp",
	pidFileName: ".audiocpp-subprocess.pid",

	async gate() {
		const s = await settings()
		if (!s.enabled) return DISABLED_MESSAGE
		// audio.cpp refuses an empty `models` array ("server config requires a
		// non-empty models array unless ui_management is enabled"), so a start
		// with nothing enabled would only ever land on Crashed (lane D walk,
		// 2026-10-29). Say it first instead.
		if ((s.enabledPackageIds ?? []).length === 0) return NO_PACKAGE_MESSAGE
		return null
	},

	async binaryPath() {
		return audioCppBinaryPath(await settings())
	},

	async port() {
		return (await settings()).port
	},

	async cwd() {
		return resolveAudioCppBinaryDir(await settings())
	},

	async prepare() {
		const written = await writeAudioCppConfig(appDb)
		// Enabled ids whose files are gone leave the config with no models,
		// which audio.cpp refuses at start; say so instead of crashing.
		if (written.modelCount === 0) throw new Error(NO_PACKAGE_ON_DISK_MESSAGE)
		bag.pendingHash = written.hash
		bag.fileHash = written.hash
	},

	onSpawn() {
		bag.spawnedHash = bag.pendingHash
		const hash = bag.pendingHash
		if (!hash) return
		void recordConfigHash(hash)
	},

	onProcessGone() {
		bag.spawnedHash = null
	},

	async idleTimeoutMs() {
		return (await settings()).subprocessTimeoutMinutes * 60_000
	},

	ping: pingAudioCpp,

	async env(): Promise<Record<string, string>> {
		const s = await settings()
		const out: Record<string, string> = {}
		// audio.cpp extracts model roots to `<tmp>/audiocpp-gguf/<hash>` and
		// never cleans them (lane V V-6): point every temp variable it may
		// read at a cache folder under the data dir, so it lives with the
		// models and the backup/cull rules, not in /tmp.
		const tmp = path.join(resolveAudioModelsDir(s), ".cache")
		await fsPromises.mkdir(tmp, { recursive: true }).catch(() => {})
		out.TMPDIR = tmp
		out.TMP = tmp
		out.TEMP = tmp
		if (process.platform === "linux") {
			// The shared libraries sit beside the binary.
			const dir = await resolveAudioCppBinaryDir(s)
			const existing = process.env.LD_LIBRARY_PATH
			out.LD_LIBRARY_PATH = existing ? `${dir}:${existing}` : dir
		}
		return out
	},

	async args() {
		const s = await settings()
		return [
			"--config",
			audioCppConfigPath(s),
			"--log",
			"--log-file",
			audioCppLogPath(s)
		]
	}
})

async function recordConfigHash(hash: string): Promise<void> {
	try {
		const s = await settings()
		await appDb
			.update(audiocppSettings)
			.set({ configHash: hash })
			.where(eq(audiocppSettings.id, s.id))
	} catch (err) {
		console.error("[audio.cpp] couldn't record the config hash:", err)
	}
}

export const checkForOrphanOnBoot = audioCppSupervisor.checkForOrphanOnBoot
export const registerEmitter = audioCppSupervisor.registerEmitter
export const unregisterEmitter = audioCppSupervisor.unregisterEmitter
export const getStatus = audioCppSupervisor.getStatus
export const pingActivity = audioCppSupervisor.pingActivity
export const startAudioCpp = audioCppSupervisor.start
export const stopAudioCpp = audioCppSupervisor.stop
export const restartAudioCpp = audioCppSupervisor.restart

/** Hash the live process was spawned with; before any spawn, the saved one. */
function spawnedHashOf(row: Pick<AudioCppSettingsRow, "configHash">) {
	return bag.spawnedHash ?? row.configHash
}

let ensuring: Promise<{ baseUrl: string }> | null = null

/**
 * Lane C's contract: audio.cpp is up, running the current `server.json`, and
 * answering `/health`. Starts it, or restarts it when the config changed since
 * it was spawned. Concurrent callers share one attempt.
 */
export function ensureAudioCppReady(opts?: {
	signal?: AbortSignal
}): Promise<{ baseUrl: string }> {
	const signal = opts?.signal
	signal?.throwIfAborted()
	if (!ensuring) {
		ensuring = ensureOnce().finally(() => {
			ensuring = null
		})
	}
	if (!signal) return ensuring
	return Promise.race([
		ensuring,
		new Promise<never>((_, reject) => {
			const abort = () => reject(signal.reason ?? new Error("Aborted"))
			if (signal.aborted) abort()
			else signal.addEventListener("abort", abort, { once: true })
		})
	])
}

async function ensureOnce(): Promise<{ baseUrl: string }> {
	const s = await settings()
	if (!s.enabled) throw new Error(DISABLED_MESSAGE)
	if (!(await audioCppBinaryPath(s))) throw new Error(NOT_INSTALLED_MESSAGE)
	const written = await writeAudioCppConfig(appDb)
	bag.fileHash = written.hash
	const st = audioCppSupervisor.getStatus()
	if (
		st.status === "running" &&
		spawnedHashOf(s) !== written.hash
	) {
		await audioCppSupervisor.restart()
	} else {
		await audioCppSupervisor.start()
	}
	const baseUrl = audioCppBaseUrl(s)
	await pollUntilReady(
		async () => ((await pingAudioCpp(baseUrl, 2000)) ? "ready" : "refused"),
		{
			intervalMs: 250,
			hardTimeoutMs: 2 * 60_000,
			isAlive: () => audioCppSupervisor.getStatus().status !== "crashed",
			label: "audio.cpp"
		}
	)
	audioCppSupervisor.pingActivity()
	return { baseUrl }
}

/**
 * Rewrite `server.json`; restart only when the process is running (and ours)
 * and was spawned with a different config.
 */
export async function applyAudioCppConfig(
	db: Db
): Promise<{ restarted: boolean }> {
	const s = await ensureAudioCppSettings(db)
	const written = await writeAudioCppConfig(db)
	bag.fileHash = written.hash
	const st = audioCppSupervisor.getStatus()
	if (st.status !== "running") return { restarted: false }
	// Nothing left to serve (the last package removed or disabled): a restart
	// would only hit the no-package gate after the file is gone (lane MV
	// finding V4, 2026-10-29). Stop instead; the next enable starts it again.
	if (written.modelCount === 0) {
		await audioCppSupervisor.stop()
		return { restarted: false }
	}
	if (spawnedHashOf(s) !== written.hash) {
		await audioCppSupervisor.restart()
		return { restarted: true }
	}
	return { restarted: false }
}

export interface StatusExtras {
	version?: string
	backend?: Sockets.AudioCpp.Backend
	loaded?: { id: string; device?: string }[]
	configApplied?: boolean
}

/** Sync view for pushes: no probing; `configApplied` from the bookkeeping. */
export function statusViewFromEvent(
	event: SupervisorStatusEvent,
	s: Pick<AudioCppSettingsRow, "port">,
	extras?: StatusExtras
): Sockets.AudioCpp.StatusView {
	const view: Sockets.AudioCpp.StatusView = {
		status: event.status,
		pid: event.pid,
		startedAt: event.startedAt,
		restartCount: event.restartCount,
		port: s.port,
		baseUrl: audioCppBaseUrl(s),
		loaded: extras?.loaded ?? [],
		configApplied:
			extras?.configApplied ??
			(event.status === "running" &&
				bag.spawnedHash != null &&
				bag.spawnedHash === bag.fileHash),
		lastError: event.lastError
	}
	if (extras?.version) view.version = extras.version
	if (extras?.backend) view.backend = extras.backend
	return view
}

async function getJson(url: string): Promise<any | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
		return res.ok ? await res.json() : null
	} catch {
		return null
	}
}

export async function getAudioCppStatusView(
	db: Db,
	opts?: { probe?: boolean }
): Promise<Sockets.AudioCpp.StatusView> {
	const s = await ensureAudioCppSettings(db)
	const event = audioCppSupervisor.getStatus()
	const extras: StatusExtras = {}
	try {
		const text = await fs.readFile(audioCppConfigPath(s), "utf8")
		bag.fileHash = hashServerConfig(text)
	} catch {}
	extras.configApplied =
		event.status === "running" &&
		spawnedHashOf(s) != null &&
		spawnedHashOf(s) === bag.fileHash
	if (opts?.probe && event.status === "running") {
		const base = audioCppBaseUrl(s)
		const [health, models] = await Promise.all([
			getJson(`${base}/health`),
			getJson(`${base}/v1/models`)
		])
		if (typeof health?.version === "string") extras.version = health.version
		if (typeof health?.backend === "string")
			extras.backend = health.backend as Sockets.AudioCpp.Backend
		const data: any[] = Array.isArray(models?.data) ? models.data : []
		extras.loaded = data
			.filter((m) => m?.loaded === true || m?.status === "loaded")
			.map((m) => ({
				id: String(m.id),
				...(typeof m.device === "string" ? { device: m.device } : {})
			}))
	}
	return statusViewFromEvent(event, s, extras)
}
