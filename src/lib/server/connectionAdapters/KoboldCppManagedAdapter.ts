import { KoboldCppAdapter } from "./KoboldCppAdapter"
import { fetchCurrentModelName } from "$lib/server/koboldcpp/kcppHttp"
import type { AdapterExports } from "./BaseConnectionAdapter"
import type { TextGenResult } from "$lib/server/adapters/actions"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { koboldCppSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { db } from "$lib/server/db"
import * as subprocessManager from "$lib/server/koboldcpp/subprocessManager"
import {
	DEFAULT_MANAGED_CONFIG,
	resetTtl,
	getLoadedSignature
} from "$lib/server/koboldcpp/modelManager"
import { ensureManagedReady } from "$lib/server/koboldcpp/managedPreflight"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"

/**
 * A KoboldCPP connection that works with Serene Pub's built-in KoboldCPP
 * Manager: model loading/swapping via the admin API, optionally with a
 * subprocess Serene Pub itself spawns and owns. Everything about sending a
 * generation request (generateText(), mapSamplingConfig(), etc.) is identical to
 * the plain KoboldCppAdapter — this subclass only adds the preflight step
 * that ensures the right model is loaded before generateText() runs, and points
 * requests at the manager's configured address rather than anything stored
 * on the connection itself.
 *
 * ⚠ The override below is a REAL implementation of the `text->text` action, not
 * a shim: this type generates text, and `actionsOf()` walks the prototype chain
 * precisely so an inherited-and-wrapped implementation counts the same as one
 * written out here. Deleting the override would not change what this type can
 * do — it would only lose the TTL reset.
 */
class KoboldCppManagedAdapter extends KoboldCppAdapter {
	/**
	 * Overrides KoboldCppAdapter.generateText() only to reset the managed
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
	async generateText(): Promise<TextGenResult> {
		const resetIfStillAlive = async () => {
			const settings = await db.query.koboldCppSettings.findFirst()
			if (!settings) return
			// Mirrors managedPreflight.attemptLoad's own isAlive construction —
			// only trust process liveness when we actually spawned/own the
			// subprocess.
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

		let result: TextGenResult
		try {
			result = await super.generateText()
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
		// time generateText() returns.
		await resetIfStillAlive()
		return result
	}

	/**
	 * The text half of a managed connection: this row's GGUF, with the knobs its
	 * `managedConfig` carries, loaded before generation starts.
	 *
	 * The work itself lives in `managedPreflight.ts` because the image
	 * connection type needs exactly the same thing without a generation to hang
	 * it off — one process, one admin API, one loader.
	 */
	async preflight(signal?: AbortSignal): Promise<void> {
		const managedConfig = {
			...DEFAULT_MANAGED_CONFIG,
			...(this.connection.extraJson?.managedConfig ?? {})
		}
		const { baseUrl } = await ensureManagedReady(
			{
				kind: "text",
				// Empty rather than null: ensureManagedReady refuses a blank
				// filename with the "No model selected" message this connection
				// form's own validation echoes.
				file: this.connection.model ?? "",
				gpuLayers: managedConfig.gpuLayers,
				flashAttention: managedConfig.flashAttention,
				batchSize: managedConfig.batchSize,
				// The resolved value (resolveSampling.ts), so a config that never
				// switched context tokens on loads the model at the same 4096 the
				// adapter's own getContextTokenLimit() falls back to.
				contextSize: this.sampling?.contextTokens ?? 4096
			},
			{ connectionId: this.connection.id, signal }
		)

		// This connection type doesn't store/use its own base URL — always talk
		// to whatever address the manager is configured for. Mutating the
		// in-memory connection here means generateText()/getContextTokenLimit()
		// (inherited unchanged from KoboldCppAdapter) automatically pick this up.
		this.connection = { ...this.connection, baseUrl }
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
	samplingKeyMap: koboldCppSamplingKeyMap
}

export default exports
