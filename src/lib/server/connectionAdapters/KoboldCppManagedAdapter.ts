import { KoboldCppAdapter } from "./KoboldCppAdapter"
import { fetchCurrentModelName, pingKoboldCpp } from "$lib/server/koboldcpp/kcppHttp"
import type { AdapterExports } from "./BaseConnectionAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { koboldCppSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { db } from "$lib/server/db"
import * as subprocessManager from "$lib/server/koboldcpp/subprocessManager"
import { ensureModelLoaded, DEFAULT_MANAGED_CONFIG } from "$lib/server/koboldcpp/modelManager"

const PREFLIGHT_RETRY_DELAY_MS = 2000

/**
 * A KoboldCpp connection that works with Serene Pub's built-in KoboldCPP
 * Manager: model loading/swapping via the admin API, optionally with a
 * subprocess Serene Pub itself spawns and owns. Everything about sending a
 * generation request (generate(), mapSamplingConfig(), etc.) is identical to
 * the plain KoboldCppAdapter — this subclass only adds the preflight step
 * that ensures the right model is loaded before generate() runs, and points
 * requests at the manager's configured address rather than anything stored
 * on the connection itself.
 */
class KoboldCppManagedAdapter extends KoboldCppAdapter {
	async preflight(signal?: AbortSignal): Promise<void> {
		const settings = await db.query.koboldCppSettings.findFirst()
		if (!settings?.koboldCppManagerEnabled) {
			throw new Error(
				"KoboldCpp Manager is disabled. Enable it in Settings to use this connection."
			)
		}
		if (!this.connection.model) {
			throw new Error("No model selected for this connection.")
		}
		const adminDir = settings.koboldCppManagedBinaryDir
		if (!adminDir) {
			throw new Error(
				"KoboldCpp Manager needs an Admin Directory configured — set one in Settings."
			)
		}

		// This connection type doesn't store/use its own base URL — always
		// talk to whatever address the manager is configured for. Mutating
		// the in-memory connection here means generate()/getContextTokenLimit()
		// (inherited unchanged from KoboldCppAdapter) automatically pick this up.
		this.connection = { ...this.connection, baseUrl: settings.koboldCppManagerBaseUrl }

		try {
			await this.attemptPreflight(settings, adminDir, signal, 1)
		} catch (err: any) {
			if (signal?.aborted) throw err
			console.warn(
				`[KoboldCPP] preflight: attempt 1 failed (${err?.message || err}) — retrying once...`
			)
			await new Promise((r) => setTimeout(r, PREFLIGHT_RETRY_DELAY_MS))
			await this.attemptPreflight(settings, adminDir, signal, 2)
		}
	}

	/** One full "make sure the server is up and the right model is loaded"
	 * pass. Always re-verifies actual liveness with a real ping rather than
	 * trusting subprocessManager's in-memory isRunning() flag, which can go
	 * stale (a health-check false-positive, or the process having exited/been
	 * restarted outside this app's tracking) — so every generation gets a
	 * fresh check, not just the first one after a cold start. */
	private async attemptPreflight(
		settings: NonNullable<Awaited<ReturnType<typeof db.query.koboldCppSettings.findFirst>>>,
		adminDir: string,
		signal: AbortSignal | undefined,
		attemptNum: number
	): Promise<void> {
		const baseUrl = settings.koboldCppManagerBaseUrl
		const alreadyResponding = await pingKoboldCpp(baseUrl, 3000)

		// Only spawn a subprocess in "managed" mode — in "external" mode the
		// user's own koboldcpp instance is expected to already be running
		// with the admin API enabled.
		if (!alreadyResponding && settings.koboldCppManagedMode !== "managed") {
			// Nothing is listening and we're not allowed to spawn anything —
			// left uncaught, this surfaces as a bare "fetch failed"/ECONNREFUSED
			// from ensureModelLoaded() below, which reads like an app bug rather
			// than a config/timing issue (e.g. Manager was switched to
			// "External" or disabled from the settings screen — possibly
			// mid-generation — while nothing external was actually running).
			throw new Error(
				`KoboldCpp is not reachable at ${baseUrl} and the Manager is in "${settings.koboldCppManagedMode ?? "unset"}" mode, so it can't be auto-started. Either start KoboldCpp externally, or switch the Manager to "Managed" mode in Settings.`
			)
		}
		if (settings.koboldCppManagedMode === "managed" && !alreadyResponding) {
			console.log(
				`[KoboldCPP] preflight attempt ${attemptNum}: subprocess not responding, starting...`
			)
			try {
				await subprocessManager.start()
			} catch (err: any) {
				console.error(
					`[KoboldCPP] preflight attempt ${attemptNum}: subprocess start FAILED:`,
					err
				)
				throw new Error(
					`KoboldCpp managed subprocess failed to start: ${err?.message || err}`
				)
			}
			console.log(`[KoboldCPP] preflight attempt ${attemptNum}: subprocess started`)
		}

		const managedConfig = {
			...DEFAULT_MANAGED_CONFIG,
			...(this.connection.extraJson?.managedConfig ?? {}),
			modelFile: this.connection.model
		}
		const contextSize = this.sampling.contextTokens ?? 4096
		console.log(
			`[KoboldCPP] preflight attempt ${attemptNum}: connection`,
			this.connection.id,
			"model",
			managedConfig.modelFile,
			"contextSize",
			contextSize
		)

		// A model load can leave koboldcpp unresponsive to other requests for
		// minutes on a large GGUF/slow disk — well beyond the health check's
		// own failure-tolerance window. Suspend it for the duration so a slow
		// load can never be mistaken for a crash and have its process torn
		// down while this exact request is still waiting on it.
		subprocessManager.suspendHealthCheck()
		try {
			await ensureModelLoaded({
				connectionId: this.connection.id,
				managedConfig,
				baseUrl,
				modelsDir: settings.koboldCppManagerModelsDir ?? null,
				adminDir,
				adminPassword: settings.koboldCppManagedAdminPassword ?? "",
				ttlSecs: settings.koboldCppManagedModelTtlSecs ?? 300,
				contextSize,
				signal
			})
			console.log(
				`[KoboldCPP] preflight attempt ${attemptNum}: ensureModelLoaded completed OK`
			)
			subprocessManager.pingActivity()
		} catch (err: any) {
			console.error(
				`[KoboldCPP] preflight attempt ${attemptNum}: ensureModelLoaded FAILED:`,
				err
			)
			throw new Error(`KoboldCpp model load failed: ${err?.message || err}`)
		} finally {
			subprocessManager.resumeHealthCheck()
		}
	}
}

// Test connection — resolves the manager's configured address first, same as
// listModels() below, rather than reading connection.baseUrl directly (this
// connection type never stores/uses its own base URL).
async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	try {
		const settings = await db.query.koboldCppSettings.findFirst()
		const baseUrl = settings?.koboldCppManagerBaseUrl || connection.baseUrl || "http://localhost:5001"
		const response = await fetch(`${baseUrl}/api/extra/version`, {
			method: "GET",
			headers: { "Content-Type": "application/json" },
			signal: AbortSignal.timeout(5000)
		})

		if (!response.ok) {
			return {
				ok: false,
				error: `Server returned ${response.status} ${response.statusText}`
			}
		}

		const data = await response.json()
		if (!data.version) {
			return { ok: false, error: "Invalid response from KoboldCpp server" }
		}

		return { ok: true }
	} catch (e: any) {
		return {
			ok: false,
			error: e.message || "Failed to connect to KoboldCpp server"
		}
	}
}

// List models function — always attempts the admin API (this connection type
// requires it to function at all, unlike the dumb type which never assumes
// it's present).
async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const settings = await db.query.koboldCppSettings.findFirst()
		const baseUrl = settings?.koboldCppManagerBaseUrl || connection.baseUrl || "http://localhost:5001"

		const currentModel = (await fetchCurrentModelName(baseUrl)) || "No model loaded"

		let availableModels: string[] = []
		try {
			const availableModelsResponse = await fetch(`${baseUrl}/api/admin/list_options`, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${settings?.koboldCppManagedAdminPassword ?? ""}`
				},
				signal: AbortSignal.timeout(5000)
			})
			if (availableModelsResponse.ok) {
				availableModels = await availableModelsResponse.json()
			}
		} catch {
			// Admin API unreachable — still return the current model below.
		}

		const models = [
			{
				id: "[current]",
				name: `Currently Loaded: ${currentModel}`,
				object: "model",
				isCurrent: true
			},
			...availableModels.map((filename) => ({
				id: filename,
				name: filename,
				object: "model",
				isCurrent: false
			}))
		]

		return { models }
	} catch (e: any) {
		return {
			models: [],
			error: e.message || "Failed to fetch models from KoboldCpp"
		}
	}
}

const exports: AdapterExports = {
	Adapter: KoboldCppManagedAdapter,
	testConnection,
	listModels,
	connectionDefaults: CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP_MANAGED],
	samplingKeyMap: koboldCppSamplingKeyMap
}

export default exports
