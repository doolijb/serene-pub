import { KoboldCppAdapter } from "./KoboldCppAdapter"
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
import { visionProjectorOf } from "$lib/shared/connections/hostCapabilities"
import * as fsPromises from "fs/promises"
import { modelsDirFor, resolveModelPath } from "$lib/server/koboldcpp/modelsDir"
import {
	classifyModelFile,
	extensionAllowedForKind
} from "$lib/server/koboldcpp/modelKind"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/**
 * A KoboldCPP connection that works with Serene Pub's built-in KoboldCPP
 * the managed KoboldCPP: model loading/swapping via the admin API, optionally with a
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
					reasoningCb?: (chunk: string) => void
				) => {
					try {
						await originalStream(contentCb, reasoningCb)
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
		const mmproj = visionProjectorOf(this.connection.extraJson)
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
				contextSize: this.sampling?.contextTokens ?? 4096,
				// The model's vision projector, from the pair's merged
				// `extraJson` (the model row's half) — absent reads no images.
				...(mmproj ? { mmproj } : {})
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

/**
 * The text models this managed KoboldCPP can serve — what the sync persists as this
 * endpoint's rows, and therefore what decides `missing_since`.
 *
 * Read off the managed KoboldCPP's own text models directory, NOT off koboldcpp's
 * `/api/admin/list_options`. That endpoint lists the `--admindir` — the
 * BINARY directory, where the .kcpps files go — and since the models moved to
 * their own directory (`koboldCppManagerModelsDir`) it has answered `[]` for
 * every install: a successful, empty listing, which the sync then honoured by
 * marking the connection's one model missing. The resolver refused the run
 * as unlisted by its host before preflight ever ran, so the
 * process auto-started for the earlier stage and the model was never loaded.
 * Seen live 2026-09-19 on a file that was sitting in `models/llm` the whole
 * time, and that the Models tab listed as _In use for chat_.
 *
 * The directory is the same source the managed KoboldCPP's own listing scans, so the
 * two cannot disagree about what exists. `local_models` is consulted only for
 * what a scan cannot know: a file the classifier put in the image lane, and a
 * download still in flight — neither is a text model to offer. Nothing here
 * needs the process to be running, which is also right: a cold managed
 * instance is the normal state, not an unreachable host.
 *
 * An unreadable directory is an ERROR, never an empty list — the sync records
 * it on the endpoint and touches no row (see modelSync.ts's header). No
 * directory configured at all is the legacy shape, where koboldcpp resolved
 * bare filenames against its own working directory; there the admin listing
 * is still the only source and is asked as before.
 */
async function listTextModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const settings = await db.query.koboldCppSettings.findFirst()
		if (!settings)
			return {
				models: [],
				error: "KoboldCPP, run by Serene Pub, has no settings row yet."
			}

		const dir = modelsDirFor("text", settings)
		if (!dir) return listModelsFromAdminApi(settings, connection)

		let entries: string[]
		try {
			entries = await fsPromises.readdir(dir)
		} catch (e: any) {
			return {
				models: [],
				error: `The KoboldCPP models directory could not be read (${dir}): ${e?.message ?? String(e)}`
			}
		}

		const rows = await db.query.localModels.findMany()
		const imageLane = new Set(
			rows.filter((m) => m.kind === "image").map((m) => m.filename)
		)
		const incomplete = new Set(
			rows.filter((m) => m.status !== "complete").map((m) => m.filename)
		)
		const candidates = entries.filter(
			(name) =>
				extensionAllowedForKind(name, "text") &&
				!imageLane.has(name) &&
				!incomplete.has(name)
		)
		// A file the registry has never seen has no kind yet — the managed KoboldCPP's
		// own listing registers and classifies it, but this sync can run
		// first. Read its header here rather than call it text: an SD GGUF
		// dropped in this folder was listed under Text models with a Use
		// button until something else happened to classify it (walk
		// 2026-09-24, plan C5). Only unregistered files pay for the read.
		const registered = new Set(rows.map((m) => m.filename))
		const unregisteredImages = new Set<string>()
		for (const name of candidates) {
			if (registered.has(name)) continue
			const verdict = await classifyModelFile(path.join(dir, name))
			if (verdict.kind === "image") unregisteredImages.add(name)
		}
		const models = candidates
			.filter((name) => !unregisteredImages.has(name))
			.sort((a, b) => a.localeCompare(b))

		// The registry rows were already read above to filter the listing, and
		// they carry the only facts a file on disk can offer — what it was
		// downloaded as, how big it is, what the list said about it. Reading
		// them twice would be a second query; dropping them was a second
		// screen with nothing on it.
		const byFilename = new Map(rows.map((m) => [m.filename, m]))
		return {
			models: models.map((filename) => {
				const row = byFilename.get(filename)
				const facts = {
					...(row?.quantization
						? { quantization: row.quantization }
						: {}),
					...(row?.sizeBytes ? { sizeBytes: row.sizeBytes } : {}),
					...(row?.description
						? { description: row.description }
						: {}),
					source: "file" as const
				}
				return {
					model: filename,
					// The registry's own name where it has one — a filename is
					// an identifier, not a title.
					name: row?.modelName || filename,
					...(Object.keys(facts).length > 1 ? { facts } : {})
				}
			})
		}
	} catch (e: any) {
		return {
			models: [],
			error: e.message || "Failed to list KoboldCPP's models"
		}
	}
}

/**
 * The image models this managed KoboldCPP can serve on the same endpoint.
 *
 * One process holds one model at a time, text or image, and the model manager
 * swaps between them on demand — so the managed KoboldCPP is ONE endpoint that chats and
 * draws, and its listing carries both halves, each entry saying which it is
 * (`modality`). `capabilityRefusal` reads that per model, which is what keeps a
 * text GGUF out of the image picker and an SD checkpoint out of the chat one.
 *
 * `kind: "image"` and complete, from `local_models` — what the managed KoboldCPP's own
 * listing maintains. Plus any model a person already set up as an image model
 * on this endpoint whose file is still in the image directory, whatever its
 * kind says: `unknown` is deliberately selectable in the managed KoboldCPP (overriding an
 * unverified file is how it stops being unverified), and dropping it here would
 * mark that deliberate choice missing on the next sync.
 */
async function listImageModels(
	connection: SelectConnection,
	textIds: ReadonlySet<string>
): Promise<any[]> {
	const settings = await db.query.koboldCppSettings.findFirst()
	const rows = await db.query.localModels.findMany()
	const listed = new Set(
		rows
			.filter((m) => m.kind === "image" && m.status === "complete")
			.map((m) => m.filename)
	)
	if (settings && connection.id != null) {
		const own = await db
			.select({ model: schema.connectionModels.model })
			.from(schema.connectionModels)
			.where(
				and(
					eq(schema.connectionModels.connectionId, connection.id),
					eq(schema.connectionModels.modality, "image-gen")
				)
			)
		for (const { model } of own) {
			if (listed.has(model)) continue
			const onDisk = await resolveModelPath("image", model, settings, {
				mustExist: true
			}).catch(() => null)
			if (onDisk) listed.add(model)
		}
	}
	const byFilename = new Map(rows.map((m) => [m.filename, m]))
	return [...listed]
		.filter((filename) => !textIds.has(filename))
		.sort((a, b) => a.localeCompare(b))
		.map((filename) => {
			const row = byFilename.get(filename)
			const facts = {
				...(row?.quantization ? { quantization: row.quantization } : {}),
				...(row?.sizeBytes ? { sizeBytes: row.sizeBytes } : {}),
				...(row?.description ? { description: row.description } : {}),
				source: "file" as const
			}
			return {
				model: filename,
				name: row?.modelName || filename,
				modality: "image-gen",
				...(Object.keys(facts).length > 1 ? { facts } : {})
			}
		})
}

/**
 * Everything this managed KoboldCPP can serve — text models, then image models — each
 * entry carrying its `modality`. A text listing that FAILS fails the whole
 * listing, so the sync touches no row (modelSync.ts's header): half a listing
 * would mark every text model missing.
 */
async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	const text = await listTextModels(connection)
	if (text.error) return text
	const textModels = text.models.map((m) =>
		typeof m === "string"
			? { model: m, name: m, modality: "text-gen" }
			: { ...m, modality: "text-gen" }
	)
	try {
		const images = await listImageModels(
			connection,
			new Set(textModels.map((m) => m.model as string))
		)
		return { models: [...textModels, ...images] }
	} catch (e: any) {
		return {
			models: [],
			error: `KoboldCPP's image models could not be listed: ${e?.message ?? String(e)}`
		}
	}
}

// The legacy listing, for an install with no models directory configured:
// koboldcpp's admin API, which lists its --admindir. An unreachable admin API
// is an ERROR here, so the sync records it on the endpoint and touches no row;
// no `[current]` sentinel is prepended, because it would become a row no host
// lists.
async function listModelsFromAdminApi(
	settings: NonNullable<
		Awaited<ReturnType<typeof db.query.koboldCppSettings.findFirst>>
	>,
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	const baseUrl =
		normalizeBaseUrl(settings.koboldCppManagerBaseUrl) ||
		normalizeBaseUrl(connection.baseUrl) ||
		"http://localhost:5001"
	let availableModels: string[]
	try {
		const availableModelsResponse = await fetch(
			`${baseUrl}/api/admin/list_options`,
			{
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${settings.koboldCppManagedAdminPassword ?? ""}`
				},
				signal: AbortSignal.timeout(5000)
			}
		)
		if (!availableModelsResponse.ok)
			return {
				models: [],
				error: `KoboldCPP's admin API answered HTTP ${availableModelsResponse.status}. Is the manager running with an admin password?`
			}
		const body = await availableModelsResponse.json()
		availableModels = Array.isArray(body)
			? body.filter((f): f is string => typeof f === "string")
			: []
	} catch (e: any) {
		return {
			models: [],
			error: `KoboldCPP's admin API could not be reached: ${e?.message ?? String(e)}`
		}
	}
	return {
		models: availableModels.map((filename) => ({
			model: filename,
			name: filename
		}))
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
