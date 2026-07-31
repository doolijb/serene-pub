import * as path from "path"
import * as fsPromises from "fs/promises"
import { fetchCurrentModelName, fetchModelStatusForPoll } from "./kcppHttp"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { pollUntilReady } from "./pollUntilReady"

export interface ManagedConfig {
	modelFile: string
	gpuLayers: number
	flashAttention: boolean
	batchSize: number
}

// Sourced from the shared connection defaults (the same object the edit
// form and connections:create/get backfilling use) rather than a separate
// local copy, so a launch config and the form displaying it can never drift.
const SHARED_MANAGED_DEFAULTS =
	CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP_MANAGED].extraJson
		.managedConfig!

export const DEFAULT_MANAGED_CONFIG: ManagedConfig = {
	modelFile: "",
	gpuLayers: SHARED_MANAGED_DEFAULTS.gpuLayers, // -1 = koboldcpp autofit (offload as many layers as fit on GPU)
	flashAttention: SHARED_MANAGED_DEFAULTS.flashAttention,
	batchSize: SHARED_MANAGED_DEFAULTS.batchSize
}

// TTL timers, keyed by baseUrl (the koboldcpp instance), not connectionId.
// There's only ever one loaded model per instance — the resource this timer
// guards is shared, not per-connection. Two managed connections pointed at
// the same instance (e.g. a "Chat" connection and a separate "Summarizer"
// connection) used to each get their own independent timer keyed by their
// own connectionId: whichever fired first would unload the model out from
// under the other connection's active or imminent generation, regardless of
// that connection's own idle state. Keying by baseUrl means any activity on
// the shared instance resets the one timer that actually governs it.
const ttlTimers: Record<string, ReturnType<typeof setTimeout>> = {}

// Simple lock so concurrent requests don't double-load
let loadingPromise: Promise<void> | null = null

// What's actually resident right now, as far as this process knows. There's
// only ever one loaded model per koboldcpp instance, so this tracks a single
// signature rather than a per-model dict — a per-model cache would let a
// stale entry for a *different*, no-longer-loaded model look validly cached.
interface LoadedSignature {
	model: string // normalized basename
	contextSize: number
	gpuLayers: number
	flashAttention: boolean
	batchSize: number
	// The exact .kcpps file content sent to koboldcpp's admin API — kept
	// verbatim (not re-derived from the fields above) so what's shown to the
	// user is guaranteed to match what was actually sent, including any
	// fields added here in the future that the summary fields don't surface.
	rawConfigJson: string
}
let loadedSignature: LoadedSignature | null = null

/**
 * What this process last loaded via ensureModelLoaded(), if anything — the
 * only source of truth for gpuLayers/flashAttention/batchSize/contextSize,
 * since koboldcpp doesn't expose them for querying. Resets to null on server
 * restart even if koboldcpp itself is still running with a model loaded.
 */
export function getLoadedSignature(): LoadedSignature | null {
	return loadedSignature
}

// koboldcpp's /api/v1/model reports the loaded model without its file
// extension (e.g. "koboldcpp/MN-12B-Lyra-v4-Q4_K_M"), while managedConfig
// tracks the full filename (e.g. "MN-12B-Lyra-v4-Q4_K_M.gguf") — strip both
// down to a bare basename so "is the right model already loaded" comparisons
// actually match instead of always reporting a mismatch.
function normalizeModelName(name: string): string {
	return path.basename(name).replace(/\.gguf$/i, "")
}

async function getCurrentModelBasename(
	baseUrl: string
): Promise<string | null> {
	const result = await fetchCurrentModelName(baseUrl)
	return result ? normalizeModelName(result) : null
}

async function waitForModelReady(
	baseUrl: string,
	expectedFile: string,
	signal?: AbortSignal,
	isAlive?: () => boolean
): Promise<void> {
	const expected = normalizeModelName(expectedFile)
	await pollUntilReady(
		async () => {
			const { modelName, refused } = await fetchModelStatusForPoll(baseUrl)
			const current = modelName ? normalizeModelName(modelName) : null
			if (current && current === expected) return "ready"
			return refused ? "refused" : "not-ready"
		},
		{
			signal,
			isAlive,
			// With a real liveness check (managed mode, we hold the process
			// handle), there's no need to guess how long a huge model can
			// take on slow hardware — wait as long as it's actually alive.
			// Without one (an external instance we merely ping), fall back
			// to a fixed, conservative ceiling since we have no better signal.
			hardTimeoutMs: isAlive ? 30 * 60_000 : 600_000,
			label: `model "${expectedFile}"`,
			onTick: (elapsed) =>
				console.log(
					`[KoboldCPP] still waiting for "${expectedFile}" to finish loading… (${Math.round(elapsed / 1000)}s)`
				)
		}
	)
}

export async function ensureModelLoaded(opts: {
	connectionId: number
	managedConfig: ManagedConfig
	baseUrl: string
	modelsDir: string | null
	adminDir: string
	adminPassword: string
	ttlSecs: number
	contextSize?: number
	signal?: AbortSignal
	/** Ground-truth "is the koboldcpp process we spawned still alive"
	 * check — only available when the caller owns the subprocess (managed
	 * mode). When given, waits described below are gated on this rather
	 * than a fixed timeout, so a huge model on slow hardware isn't cut off
	 * just because it's slower than whatever number was guessed here. */
	isAlive?: () => boolean
}): Promise<void> {
	const {
		connectionId,
		managedConfig,
		baseUrl,
		modelsDir,
		adminDir,
		adminPassword,
		ttlSecs,
		contextSize,
		signal,
		isAlive
	} = opts

	// A previous caller's load may still be in flight. Wait for it, but don't
	// hang forever if that caller was cancelled and its own fetch is still
	// winding down — race our own cancellation against it too.
	if (loadingPromise) {
		if (signal) {
			await Promise.race([
				loadingPromise.catch(() => {}),
				new Promise<void>((_, reject) => {
					if (signal.aborted) reject(signal.reason)
					else
						signal.addEventListener(
							"abort",
							() => reject(signal.reason),
							{ once: true }
						)
				})
			])
			signal.throwIfAborted()
		} else {
			await loadingPromise.catch(() => {})
		}
	}

	const current = await getCurrentModelBasename(baseUrl)
	const expected = normalizeModelName(managedConfig.modelFile)

	if (current === expected) {
		// gpuLayers/flashAttention/batchSize aren't queryable from koboldcpp at
		// all — they can only be trusted from what THIS process itself last
		// loaded. With no in-process record (e.g. right after a server
		// restart) we can't verify them, so always reload once to be safe;
		// loadedSignature then tracks it going forward.
		const known =
			loadedSignature?.model === expected ? loadedSignature : null
		const configMatches =
			known !== null &&
			known.gpuLayers === managedConfig.gpuLayers &&
			known.flashAttention === managedConfig.flashAttention &&
			known.batchSize === managedConfig.batchSize

		if (configMatches) {
			if (contextSize) {
				if (known!.contextSize >= contextSize) {
					resetTtl(baseUrl, adminPassword, ttlSecs)
					return
				}
				// Loaded context too small — fall through to reload
			} else {
				resetTtl(baseUrl, adminPassword, ttlSecs)
				return
			}
		}
	}

	const modelPath = modelsDir
		? path.join(modelsDir, managedConfig.modelFile)
		: managedConfig.modelFile
	// koboldcpp's admin reload_config only accepts .kcpps files that live inside
	// its --admindir (validated against a jailed allowlist), referenced by a path
	// relative to that directory — an absolute /tmp path is silently rejected.
	const configFilename = `serene_${path.basename(managedConfig.modelFile, ".gguf")}.kcpps`
	const configContent = {
		model: [modelPath],
		gpulayers: managedConfig.gpuLayers,
		contextsize: contextSize ?? 4096,
		flashattention: managedConfig.flashAttention,
		batchsize: managedConfig.batchSize,
		// Must be set HERE, not just as a base spawn arg (subprocessManager.ts)
		// — koboldcpp's own admin reload_config handler resets every non-
		// protected arg to its argparse default before reapplying whatever
		// keys this .kcpps file contains (confirmed by reading koboldcpp.py's
		// reload path: the final branch always runs
		// reload_from_new_args(defaultargs) first). "jinja" isn't in
		// koboldcpp's protected-args list, so a spawn-time-only --jinja flag
		// is silently wiped the moment the first model loads through this
		// file. See subprocessManager.ts's --jinja comment for what this
		// actually enables.
		jinja: true
	}
	const configJson = JSON.stringify(configContent, null, 2)

	loadingPromise = (async () => {
		await fsPromises.writeFile(
			path.join(adminDir, configFilename),
			configJson
		)

		// koboldcpp's admin API can briefly stop accepting connections while
		// swapping models internally (a prior load winding down, or its own
		// reload machinery restarting the listener) — a request landing in
		// that exact window gets a raw ECONNREFUSED with no HTTP response at
		// all. Retry through that exact same way waitForModelReady() below
		// tolerates it: trust isAlive when we have it, otherwise a bounded
		// consecutive-refusal count.
		let data: any
		await pollUntilReady(
			async () => {
				const timeoutSignal = AbortSignal.timeout(600_000)
				let resp: Response
				try {
					resp = await fetch(`${baseUrl}/api/admin/reload_config`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${adminPassword}`
						},
						body: JSON.stringify({ filename: configFilename }),
						signal: signal
							? AbortSignal.any([signal, timeoutSignal])
							: timeoutSignal
					})
				} catch (err) {
					const cause = (err as { cause?: { code?: string } })?.cause
					if (cause?.code === "ECONNREFUSED") return "refused"
					throw err
				}
				if (!resp.ok) {
					const text = await resp.text().catch(() => "")
					throw new Error(`reload_config failed: ${resp.status} ${text}`)
				}
				data = await resp.json().catch(() => ({}))
				return "ready"
			},
			{
				signal,
				isAlive,
				hardTimeoutMs: isAlive ? 30 * 60_000 : 60_000,
				label: "reload_config request"
			}
		)
		if (!data.success) {
			throw new Error(
				"reload_config rejected the request (success: false)"
			)
		}

		await waitForModelReady(baseUrl, managedConfig.modelFile, signal, isAlive)
	})()

	try {
		await loadingPromise
	} finally {
		loadingPromise = null
	}

	loadedSignature = {
		model: normalizeModelName(managedConfig.modelFile),
		contextSize: contextSize ?? 4096,
		gpuLayers: managedConfig.gpuLayers,
		flashAttention: managedConfig.flashAttention,
		batchSize: managedConfig.batchSize,
		rawConfigJson: configJson
	}
	resetTtl(baseUrl, adminPassword, ttlSecs)
}

export async function unloadModel(
	baseUrl: string,
	adminPassword: string
): Promise<boolean> {
	try {
		// There is no dedicated unload endpoint — koboldcpp's admin API treats the
		// literal filename "unload_model" as a special reload_config target.
		const resp = await fetch(`${baseUrl}/api/admin/reload_config`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${adminPassword}`
			},
			body: JSON.stringify({ filename: "unload_model" }),
			signal: AbortSignal.timeout(10_000)
		})
		if (!resp.ok) return false
		const data = await resp.json().catch(() => ({}))
		if (data.success) {
			loadedSignature = null
		}
		return !!data.success
	} catch {
		return false
	}
}

export function resetTtl(
	baseUrl: string,
	adminPassword: string,
	ttlSecs: number
) {
	clearTtl(baseUrl)
	if (ttlSecs <= 0) return
	ttlTimers[baseUrl] = setTimeout(() => {
		delete ttlTimers[baseUrl]
		unloadModel(baseUrl, adminPassword).catch(() => {})
	}, ttlSecs * 1000)
}

export function clearTtl(baseUrl: string) {
	if (ttlTimers[baseUrl]) {
		clearTimeout(ttlTimers[baseUrl])
		delete ttlTimers[baseUrl]
	}
}

export function clearAllTtls() {
	for (const url of Object.keys(ttlTimers)) {
		clearTimeout(ttlTimers[url])
		delete ttlTimers[url]
	}
}
