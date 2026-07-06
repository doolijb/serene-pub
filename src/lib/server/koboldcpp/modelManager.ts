import * as path from "path"
import * as os from "os"
import * as fsPromises from "fs/promises"

export interface ManagedConfig {
	modelFile: string
	gpuLayers: number
	flashAttention: boolean
	batchSize: number
}

export const DEFAULT_MANAGED_CONFIG: ManagedConfig = {
	modelFile: "",
	gpuLayers: 0,
	flashAttention: false,
	batchSize: 512
}

// Per-connection TTL timers
const ttlTimers: Record<number, ReturnType<typeof setTimeout>> = {}

// Simple lock so concurrent requests don't double-load
let loadingPromise: Promise<void> | null = null

// Track the context size we last loaded, keyed by model basename
const loadedContextByModel: Record<string, number> = {}

async function getCurrentModelBasename(baseUrl: string): Promise<string | null> {
	try {
		const resp = await fetch(`${baseUrl}/api/v1/model`, { signal: AbortSignal.timeout(5000) })
		if (!resp.ok) return null
		const data = await resp.json()
		const result: string = data.result ?? ""
		return result ? path.basename(result) : null
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
	timeoutMs = 600_000
): Promise<void> {
	const deadline = Date.now() + timeoutMs
	const expected = path.basename(expectedFile)
	while (Date.now() < deadline) {
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
	adminPassword: string
	ttlSecs: number
	contextSize?: number
}): Promise<void> {
	const { connectionId, managedConfig, baseUrl, modelsDir, adminPassword, ttlSecs, contextSize } = opts

	if (loadingPromise) await loadingPromise

	const current = await getCurrentModelBasename(baseUrl)
	const expected = path.basename(managedConfig.modelFile)

	if (current === expected) {
		if (contextSize) {
			const knownContext = loadedContextByModel[expected] ?? null
			if (knownContext !== null && knownContext >= contextSize) {
				resetTtl(connectionId, baseUrl, adminPassword, ttlSecs)
				return
			}
			// No tracked state or context too small — fall through to reload
		} else {
			resetTtl(connectionId, baseUrl, adminPassword, ttlSecs)
			return
		}
	}

	loadingPromise = (async () => {
		const modelPath = modelsDir ? path.join(modelsDir, managedConfig.modelFile) : managedConfig.modelFile

		const configContent = {
			model: modelPath,
			gpulayers: managedConfig.gpuLayers,
			contextsize: contextSize ?? 4096,
			flashattention: managedConfig.flashAttention,
			blasbatchsize: managedConfig.batchSize
		}

		const tmpConfigPath = path.join(
			os.tmpdir(),
			`serene_${path.basename(managedConfig.modelFile, ".gguf")}.kcpps`
		)
		await fsPromises.writeFile(tmpConfigPath, JSON.stringify(configContent, null, 2))

		const resp = await fetch(`${baseUrl}/api/admin/reload_config`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ filename: tmpConfigPath, adminpassword: adminPassword }),
			signal: AbortSignal.timeout(600_000)
		})

		if (!resp.ok) {
			const text = await resp.text().catch(() => "")
			throw new Error(`reload_config failed: ${resp.status} ${text}`)
		}

		await waitForModelReady(baseUrl, managedConfig.modelFile)
	})()

	try {
		await loadingPromise
	} finally {
		loadingPromise = null
	}

	loadedContextByModel[path.basename(managedConfig.modelFile)] = contextSize ?? 4096
	resetTtl(connectionId, baseUrl, adminPassword, ttlSecs)
}

export async function unloadModel(baseUrl: string, adminPassword: string): Promise<boolean> {
	try {
		const resp = await fetch(`${baseUrl}/api/admin/unload_model`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ adminpassword: adminPassword }),
			signal: AbortSignal.timeout(10_000)
		})
		if (resp.ok) {
			for (const key of Object.keys(loadedContextByModel)) delete loadedContextByModel[key]
		}
		return resp.ok
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
