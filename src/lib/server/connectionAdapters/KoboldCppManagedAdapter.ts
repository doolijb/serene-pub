import { KoboldCppAdapter } from "./KoboldCppAdapter"
import {
	fetchCurrentModelName,
	pingKoboldCPP
} from "$lib/server/koboldcpp/kcppHttp"
import type { AdapterExports } from "./BaseConnectionAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { koboldCppSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { db } from "$lib/server/db"
import * as subprocessManager from "$lib/server/koboldcpp/subprocessManager"
import {
	ensureModelLoaded,
	DEFAULT_MANAGED_CONFIG,
	resetTtl,
	getLoadedSignature
} from "$lib/server/koboldcpp/modelManager"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"

// ensureModelLoaded() already waits out a normal, in-progress load — these
// retries exist only for the rarer case where the subprocess itself needs a
// fresh respawn (it genuinely crashed rather than just being slow). Each
// attempt here is a full "check/spawn/load" pass, not a quick recheck, so
// this stays a small, short list rather than a long one — the whole point
// of one user action (a summary, a message) failing outright shouldn't be
// "the respawn needed a 4th try" territory; a handful with light backoff
// covers a real crash-and-recover without turning a genuine, non-transient
// failure (bad config, disabled manager) into a long silent wait before the
// user sees anything.
const PREFLIGHT_RETRY_DELAYS_MS = [2000, 4000]

/**
 * A KoboldCPP connection that works with Serene Pub's built-in KoboldCPP
 * Manager: model loading/swapping via the admin API, optionally with a
 * subprocess Serene Pub itself spawns and owns. Everything about sending a
 * generation request (generate(), mapSamplingConfig(), etc.) is identical to
 * the plain KoboldCppAdapter — this subclass only adds the preflight step
 * that ensures the right model is loaded before generate() runs, and points
 * requests at the manager's configured address rather than anything stored
 * on the connection itself.
 */
class KoboldCppManagedAdapter extends KoboldCppAdapter {
	/**
	 * Overrides KoboldCppAdapter.generate() only to reset the managed
	 * subprocess's TTL unload timer once generation actually completes —
	 * resetTtl() otherwise only ever runs during preflight (before
	 * generation starts), so a response slower than ttlSecs (default 300s)
	 * could have its model unloaded mid-stream by this app's own timer.
	 *
	 * The reset is conditioned on a fresh liveness check, not unconditional:
	 * if the TTL timer is what killed the model mid-generation (the exact
	 * bug this fixes) or the subprocess crashed, the stream errors out, and
	 * blindly resetting here would re-arm an unload timer for a model
	 * that's already gone — masking the real state instead of letting the
	 * next preflight() reload cleanly. Success always resets; failure only
	 * resets when the model is confirmed still there.
	 */
	async generate() {
		const resetIfStillAlive = async () => {
			const settings = await db.query.koboldCppSettings.findFirst()
			if (!settings) return
			// Mirrors attemptPreflight's own isAlive construction — only trust
			// process liveness when we actually spawned/own the subprocess.
			const isAlive =
				settings.koboldCppManagedMode === "managed" &&
				!subprocessManager.isExternal()
					? subprocessManager.isRunning()
					: true
			if (!isAlive) return
			// getLoadedSignature() resets to null once this process believes
			// nothing is loaded (e.g. after a confirmed unload) — don't
			// re-arm a timer for a model already considered gone.
			if (!getLoadedSignature()) return
			resetTtl(
				this.connection.baseUrl!,
				settings.koboldCppManagedAdminPassword ?? "",
				settings.koboldCppManagedModelTtlSecs ?? 300
			)
		}

		let result: Awaited<ReturnType<KoboldCppAdapter["generate"]>>
		try {
			result = await super.generate()
		} catch (err) {
			// A non-streaming failure (or a setup error before the streaming
			// closure was even returned) throws here directly, per B1's fix —
			// still needs the same liveness-conditioned reset as the
			// streaming failure path below.
			await resetIfStillAlive()
			throw err
		}

		if (typeof result.completionResult === "function") {
			const originalStream = result.completionResult
			return {
				...result,
				completionResult: async (
					contentCb: (chunk: string) => void,
					thinkingCb?: (chunk: string) => void
				) => {
					try {
						await originalStream(contentCb, thinkingCb)
						await resetIfStillAlive()
					} catch (err) {
						await resetIfStillAlive()
						throw err
					}
				}
			}
		}

		// Non-streaming success: generation is already fully complete by the
		// time generate() returns.
		await resetIfStillAlive()
		return result
	}

	async preflight(signal?: AbortSignal): Promise<void> {
		const settings = await db.query.koboldCppSettings.findFirst()
		if (!settings?.koboldCppManagerEnabled) {
			throw new Error(
				"KoboldCPP Manager is disabled. Enable it in Settings to use this connection."
			)
		}
		if (!this.connection.model) {
			throw new Error("No model selected for this connection.")
		}
		const adminDir = settings.koboldCppManagedBinaryDir
		if (!adminDir) {
			throw new Error(
				"KoboldCPP Manager needs an Admin Directory configured — set one in Settings."
			)
		}

		// This connection type doesn't store/use its own base URL — always
		// talk to whatever address the manager is configured for. Mutating
		// the in-memory connection here means generate()/getContextTokenLimit()
		// (inherited unchanged from KoboldCppAdapter) automatically pick this up.
		this.connection = {
			...this.connection,
			baseUrl: settings.koboldCppManagerBaseUrl
		}

		const totalAttempts = PREFLIGHT_RETRY_DELAYS_MS.length + 1
		for (let attemptNum = 1; ; attemptNum++) {
			try {
				await this.attemptPreflight(
					settings,
					adminDir,
					signal,
					attemptNum
				)
				return
			} catch (err: any) {
				if (signal?.aborted) throw err
				const delayMs = PREFLIGHT_RETRY_DELAYS_MS[attemptNum - 1]
				if (delayMs === undefined) throw err
				console.warn(
					`[KoboldCPP] preflight: attempt ${attemptNum}/${totalAttempts} failed (${err?.message || err}) — retrying in ${delayMs}ms...`
				)
				await new Promise((r) => setTimeout(r, delayMs))
			}
		}
	}

	/** One full "make sure the server is up and the right model is loaded"
	 * pass. Always re-verifies actual liveness with a real ping rather than
	 * trusting subprocessManager's in-memory isRunning() flag, which can go
	 * stale (a health-check false-positive, or the process having exited/been
	 * restarted outside this app's tracking) — so every generation gets a
	 * fresh check, not just the first one after a cold start. */
	private async attemptPreflight(
		settings: NonNullable<
			Awaited<ReturnType<typeof db.query.koboldCppSettings.findFirst>>
		>,
		adminDir: string,
		signal: AbortSignal | undefined,
		attemptNum: number
	): Promise<void> {
		const baseUrl = settings.koboldCppManagerBaseUrl
		const alreadyResponding = await pingKoboldCPP(baseUrl, 3000)

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
				`KoboldCPP is not reachable at ${baseUrl} and the Manager is in "${settings.koboldCppManagedMode ?? "unset"}" mode, so it can't be auto-started. Either start KoboldCPP externally, or switch the Manager to "Managed" mode in Settings.`
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
					`KoboldCPP managed subprocess failed to start: ${err?.message || err}`
				)
			}
			console.log(
				`[KoboldCPP] preflight attempt ${attemptNum}: subprocess started`
			)
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
				signal,
				// Only trust process liveness as the wait signal when we
				// actually spawned/own this subprocess — an adopted external
				// instance has no such guarantee, so ensureModelLoaded falls
				// back to its fixed-timeout tolerance for that case instead.
				isAlive:
					settings.koboldCppManagedMode === "managed" &&
					!subprocessManager.isExternal()
						? () => subprocessManager.isRunning()
						: undefined
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
			// An externally-owned instance almost certainly has a different
			// --adminpassword and --admindir than this Manager is configured
			// with, so the admin API call above (reload_config) is expected to
			// be rejected — surface that explanation instead of the raw,
			// undiagnosable "rejected the request" error.
			if (settings.koboldCppManagedMode === "external") {
				throw new Error(
					`KoboldCPP at ${baseUrl} rejected the model-load request: ${err?.message || err}. Make sure it was started with --admin --adminpassword <matching the one configured here> --admindir <matching the one configured here>.`
				)
			}
			if (subprocessManager.isExternal()) {
				throw new Error(
					`KoboldCPP is running on this port but wasn't started by this Manager, so its admin password/directory don't match — model loading was rejected: ${err?.message || err}. Stop the external instance and let the Manager start its own, or point this Manager at a different port.`
				)
			}
			throw new Error(
				`KoboldCPP model load failed: ${err?.message || err}`
			)
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
		const baseUrl =
			normalizeBaseUrl(settings?.koboldCppManagerBaseUrl) ||
			normalizeBaseUrl(connection.baseUrl) ||
			"http://localhost:5001"
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
			return {
				ok: false,
				error: "Invalid response from KoboldCPP server"
			}
		}

		return { ok: true }
	} catch (e: any) {
		return {
			ok: false,
			error: e.message || "Failed to connect to KoboldCPP server"
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
		const baseUrl =
			normalizeBaseUrl(settings?.koboldCppManagerBaseUrl) ||
			normalizeBaseUrl(connection.baseUrl) ||
			"http://localhost:5001"

		const currentModel =
			(await fetchCurrentModelName(baseUrl)) || "No model loaded"

		let availableModels: string[] = []
		try {
			const availableModelsResponse = await fetch(
				`${baseUrl}/api/admin/list_options`,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${settings?.koboldCppManagedAdminPassword ?? ""}`
					},
					signal: AbortSignal.timeout(5000)
				}
			)
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
	samplingKeyMap: koboldCppSamplingKeyMap,
	// 20 §9: SP formats and grammar-constrains via jsonSchemaToGbnf.
	capabilities: { toolUse: "emulated" }
}

export default exports
