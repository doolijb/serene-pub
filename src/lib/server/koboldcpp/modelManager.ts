import * as path from "path"
import * as fsPromises from "fs/promises"

export interface ManagedConfig {
	modelFile: string
	gpuLayers: number
	flashAttention: boolean
	batchSize: number
}

export const DEFAULT_MANAGED_CONFIG: ManagedConfig = {
	modelFile: "",
	gpuLayers: -1, // -1 = koboldcpp autofit (offload as many layers as fit on GPU)
	flashAttention: false,
	batchSize: 512
}

// Per-connection TTL timers
const ttlTimers: Record<number, ReturnType<typeof setTimeout>> = {}

// Simple lock so concurrent requests don't double-load
let loadingPromise: Promise<void> | null = null

// Track the context size we last loaded, keyed by normalized model name
const loadedContextByModel: Record<string, number> = {}

// koboldcpp's /api/v1/model reports the loaded model without its file
// extension (e.g. "koboldcpp/MN-12B-Lyra-v4-Q4_K_M"), while managedConfig
// tracks the full filename (e.g. "MN-12B-Lyra-v4-Q4_K_M.gguf") — strip both
// down to a bare basename so "is the right model already loaded" comparisons
// actually match instead of always reporting a mismatch.
function normalizeModelName(name: string): string {
	return path.basename(name).replace(/\.gguf$/i, "")
}

async function getCurrentModelBasename(baseUrl: string): Promise<string | null> {
	try {
		const resp = await fetch(`${baseUrl}/api/v1/model`, { signal: AbortSignal.timeout(5000) })
		if (!resp.ok) return null
		const data = await resp.json()
		const result: string = data.result ?? ""
		return result ? normalizeModelName(result) : null
	} catch {
		return null
	}
}

async function getCurrentContextSize(baseUrl: string): Promise<number | null> {
	try {
		const resp = await fetch(`${baseUrl}/api/extra/true_max_context_length`, { signal: AbortSignal.timeout(3000) })
		if (!resp.ok) return null
		const data = await resp.json()
		return typeof data.value === "number" ? data.value : null
	} catch {
		return null
	}
}

async function waitForModelReady(
	baseUrl: string,
	expectedFile: string,
	signal?: AbortSignal,
	timeoutMs = 600_000
): Promise<void> {
	const deadline = Date.now() + timeoutMs
	const expected = normalizeModelName(expectedFile)
	while (Date.now() < deadline) {
		signal?.throwIfAborted()
		const current = await getCurrentModelBasename(baseUrl)
		if (current && current === expected) return
		await new Promise((r) => setTimeout(r, 2000))
	}
	throw new Error(`Model "${expectedFile}" did not finish loading within timeout`)
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
}): Promise<void> {
	const { connectionId, managedConfig, baseUrl, modelsDir, adminDir, adminPassword, ttlSecs, contextSize, signal } = opts

	// A previous caller's load may still be in flight. Wait for it, but don't
	// hang forever if that caller was cancelled and its own fetch is still
	// winding down — race our own cancellation against it too.
	if (loadingPromise) {
		if (signal) {
			await Promise.race([
				loadingPromise.catch(() => {}),
				new Promise<void>((_, reject) => {
					if (signal.aborted) reject(signal.reason)
					else signal.addEventListener("abort", () => reject(signal.reason), { once: true })
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
		if (contextSize) {
			// Prefer in-process tracking; fall back to querying the running instance
			const knownContext = loadedContextByModel[expected] ?? await getCurrentContextSize(baseUrl)
			if (knownContext !== null && knownContext >= contextSize) {
				loadedContextByModel[expected] = knownContext
				resetTtl(connectionId, baseUrl, adminPassword, ttlSecs)
				return
			}
			// Context too small (or unknown) — fall through to reload
		} else {
			resetTtl(connectionId, baseUrl, adminPassword, ttlSecs)
			return
		}
	}

	loadingPromise = (async () => {
		const modelPath = modelsDir ? path.join(modelsDir, managedConfig.modelFile) : managedConfig.modelFile

		// koboldcpp's admin reload_config only accepts .kcpps files that live inside
		// its --admindir (validated against a jailed allowlist), referenced by a path
		// relative to that directory — an absolute /tmp path is silently rejected.
		const configFilename = `serene_${path.basename(managedConfig.modelFile, ".gguf")}.kcpps`
		const configContent = {
			model: [modelPath],
			gpulayers: managedConfig.gpuLayers,
			contextsize: contextSize ?? 4096,
			flashattention: managedConfig.flashAttention,
			batchsize: managedConfig.batchSize
		}
		await fsPromises.writeFile(
			path.join(adminDir, configFilename),
			JSON.stringify(configContent, null, 2)
		)

		const timeoutSignal = AbortSignal.timeout(600_000)
		const resp = await fetch(`${baseUrl}/api/admin/reload_config`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${adminPassword}`
			},
			body: JSON.stringify({ filename: configFilename }),
			signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
		})

		if (!resp.ok) {
			const text = await resp.text().catch(() => "")
			throw new Error(`reload_config failed: ${resp.status} ${text}`)
		}
		const data = await resp.json().catch(() => ({}))
		if (!data.success) {
			throw new Error("reload_config rejected the request (success: false)")
		}

		await waitForModelReady(baseUrl, managedConfig.modelFile, signal)
	})()

	try {
		await loadingPromise
	} finally {
		loadingPromise = null
	}

	loadedContextByModel[normalizeModelName(managedConfig.modelFile)] = contextSize ?? 4096
	resetTtl(connectionId, baseUrl, adminPassword, ttlSecs)
}

export async function unloadModel(baseUrl: string, adminPassword: string): Promise<boolean> {
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
			for (const key of Object.keys(loadedContextByModel)) delete loadedContextByModel[key]
		}
		return !!data.success
	} catch {
		return false
	}
}

export function resetTtl(
	connectionId: number,
	baseUrl: string,
	adminPassword: string,
	ttlSecs: number
) {
	clearTtl(connectionId)
	if (ttlSecs <= 0) return
	ttlTimers[connectionId] = setTimeout(() => {
		delete ttlTimers[connectionId]
		unloadModel(baseUrl, adminPassword).catch(() => {})
	}, ttlSecs * 1000)
}

export function clearTtl(connectionId: number) {
	if (ttlTimers[connectionId]) {
		clearTimeout(ttlTimers[connectionId])
		delete ttlTimers[connectionId]
	}
}

export function clearAllTtls() {
	for (const id of Object.keys(ttlTimers)) {
		clearTimeout(ttlTimers[Number(id)])
		delete ttlTimers[Number(id)]
	}
}
