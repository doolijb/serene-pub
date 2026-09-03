import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
// InsertConnection is declared globally in $lib/server/db/types.d.ts (ambient
// `export global {}` block, same pattern as the Sockets namespace) — no
// import needed/available for it.
import { eq, and, inArray } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { connectionsList, connectionsSetUserActive } from "./connections"
import { systemSettingsGet } from "./systemSettings"
import { getAppDataDir } from "$lib/server/db/drizzle.config"
import koboldCppManagedAdapter from "$lib/server/connectionAdapters/KoboldCppManagedAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { flagsFrom, NO_FLAGS } from "$lib/server/koboldcpp/probeCapabilities"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import * as https from "https"
import * as http from "http"
import { randomUUID } from "crypto"
import * as subprocessManager from "$lib/server/koboldcpp/subprocessManager"
import * as binaryManager from "$lib/server/koboldcpp/binaryManager"
import { loginRateLimit } from "$lib/server/services/loginRateLimit"

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
import {
	unloadModel,
	getLoadedSignature
} from "$lib/server/koboldcpp/modelManager"
import {
	classifyModelFile,
	extensionAllowedForKind,
	isModelFilename,
	MODEL_EXTENSION_RE
} from "$lib/server/koboldcpp/modelKind"
import {
	modelsDirFor,
	modelsDirsToScan,
	resolveModelPath
} from "$lib/server/koboldcpp/modelsDir"
import { resolveConnectionCapabilities } from "$lib/server/connections/resolve"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { isAndroidWrapper } from "$lib/server/utils"

// --- KOBOLDCPP MANAGER HANDLERS ---

function compareVersions(v1: string, v2: string): number {
	const parts1 = v1.replace(/^v/, "").split(".").map(Number)
	const parts2 = v2.replace(/^v/, "").split(".").map(Number)
	const len = Math.max(parts1.length, parts2.length)
	for (let i = 0; i < len; i++) {
		const a = parts1[i] || 0
		const b = parts2[i] || 0
		if (a > b) return 1
		if (a < b) return -1
	}
	return 0
}

export const koboldCppSetBaseUrl: Handler<
	Sockets.KoboldCPP.SetBaseUrl.Params,
	Sockets.KoboldCPP.SetBaseUrl.Response
> = {
	event: "koboldcpp:setBaseUrl",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const url = new URL(params.baseUrl)
		if (!["http:", "https:"].includes(url.protocol)) {
			emitToUser("koboldcpp:setBaseUrl:error", {
				error: "Invalid URL protocol"
			})
			throw new Error("Invalid URL protocol")
		}

		await db
			.update(schema.koboldCppSettings)
			.set({ koboldCppManagerBaseUrl: params.baseUrl })
			.where(eq(schema.koboldCppSettings.id, 1))

		const res: Sockets.KoboldCPP.SetBaseUrl.Response = { success: true }
		emitToUser("koboldcpp:setBaseUrl", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetModelsDir: Handler<
	Sockets.KoboldCPP.SetModelsDir.Params,
	Sockets.KoboldCPP.SetModelsDir.Response
> = {
	event: "koboldcpp:setModelsDir",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		// Two columns, and `kind` says which — a caller that guessed would
		// repoint the OTHER directory, which reads to a user as every model they
		// own vanishing at once.
		//
		// Clearing means different things on either side, which is why both
		// write NULL rather than one refusing: NULL on the image column is the
		// upgrade contract ("use the text directory"), NULL on the text one is
		// genuinely nothing configured.
		await db
			.update(schema.koboldCppSettings)
			.set(
				params.kind === "image"
					? { koboldCppImageModelsDir: params.dir || null }
					: { koboldCppManagerModelsDir: params.dir || null }
			)
			.where(eq(schema.koboldCppSettings.id, 1))
		const res: Sockets.KoboldCPP.SetModelsDir.Response = { success: true }
		emitToUser("koboldcpp:setModelsDir", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppVersionHandler: Handler<
	Sockets.KoboldCPP.Version.Params,
	Sockets.KoboldCPP.Version.Response
> = {
	event: "koboldcpp:version",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const { koboldCppManagerBaseUrl } =
			(await db.query.koboldCppSettings.findFirst())!
		const baseUrl = params.baseUrl || koboldCppManagerBaseUrl

		// Not reachable is an expected, routine state (nothing started yet,
		// no managed/external instance configured, or it's mid-restart) —
		// same reasoning as koboldCppPerfHandler below. Emitting a clean
		// :error and returning here (rather than throwing) also keeps this
		// out of the generic handler wrapper's console.error, which fires
		// unconditionally on every throw regardless of message quality —
		// this is routine client-facing state, not a server-side fault
		// worth logging.
		let response: Response
		try {
			response = await fetch(`${baseUrl}/api/extra/version`, {
				signal: AbortSignal.timeout(5000)
			})
		} catch {
			emitToUser("koboldcpp:version:error", {
				error: "KoboldCPP is not reachable"
			})
			return { version: "", isLocal: false, capabilities: NO_FLAGS }
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = await response.json()
		const hostname = new URL(baseUrl).hostname
		const isLocal = ["localhost", "127.0.0.1", "::1"].includes(hostname)
		// The same mapping the connection's capability probe uses. These flags
		// are rendered as badges on the settings tab and stored on the
		// connection row; two readings of one endpoint is how the badge and the
		// picker end up disagreeing about whether the server can draw.
		const res: Sockets.KoboldCPP.Version.Response = {
			version: data.version || "unknown",
			isLocal,
			capabilities: flagsFrom(data)
		}
		emitToUser("koboldcpp:version", res)
		return res
	}
}

export const koboldCppIsUpdateAvailableHandler: Handler<
	Sockets.KoboldCPP.IsUpdateAvailable.Params,
	Sockets.KoboldCPP.IsUpdateAvailable.Response
> = {
	event: "koboldcpp:isUpdateAvailable",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const { koboldCppManagerBaseUrl: baseUrl } =
			(await db.query.koboldCppSettings.findFirst())!

		const versionResp = await fetch(`${baseUrl}/api/extra/version`, {
			signal: AbortSignal.timeout(5000)
		})

		if (!versionResp.ok) {
			throw new Error(`Cannot reach KoboldCPP at ${baseUrl}`)
		}

		const versionData = await versionResp.json()
		const currentVersion: string = versionData.version || ""

		const githubResp = await fetch(
			"https://api.github.com/repos/LostRuins/koboldcpp/releases/latest",
			{ headers: { Accept: "application/vnd.github.v3+json" } }
		)

		if (!githubResp.ok) {
			throw new Error(`GitHub API error: ${githubResp.status}`)
		}

		const release = await githubResp.json()
		const latestVersion: string = release.tag_name || ""
		const releaseUrl: string = release.html_url || ""

		const isUpdateAvailable =
			currentVersion && latestVersion
				? compareVersions(latestVersion, currentVersion) > 0
				: false

		const res: Sockets.KoboldCPP.IsUpdateAvailable.Response = {
			isUpdateAvailable,
			currentVersion,
			latestVersion,
			releaseUrl
		}
		emitToUser("koboldcpp:isUpdateAvailable", res)
		return res
	}
}

export const koboldCppListModelsHandler: Handler<
	Sockets.KoboldCPP.ListModels.Params,
	Sockets.KoboldCPP.ListModels.Response
> = {
	event: "koboldcpp:listModels",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = (await db.query.koboldCppSettings.findFirst())!
		const { koboldCppManagerBaseUrl: baseUrl } = settings

		let currentModel: string | null = null
		try {
			const modelResp = await fetch(`${baseUrl}/api/v1/model`, {
				signal: AbortSignal.timeout(5000)
			})
			if (modelResp.ok) {
				const data = await modelResp.json()
				currentModel = data.result || null
			}
		} catch {
			// KoboldCPP offline — return empty gracefully
		}

		// Load DB records; exclude anything still downloading (or errored)
		const dbModels = await db.query.koboldCppModels.findMany()
		const dbByFilename = new Map(dbModels.map((m) => [m.filename, m]))
		const incompleteFilenames = new Set(
			dbModels
				.filter((m) => m.status !== "complete")
				.map((m) => m.filename)
		)

		// Scan every models directory for loadable model files, skipping
		// incomplete downloads. BOTH extensions — an image model may be either,
		// and the stale sweep below deletes the row of anything the scan doesn't
		// see, so a .gguf-only scan would silently forget every downloaded
		// .safetensors while the file sat on disk.
		//
		// The union across directories is built IN FULL before that sweep, and
		// that ordering is the whole reason this is one loop rather than a
		// scan-and-sweep per directory: sweeping after the text directory would
		// delete the row of every model living in the image one — silently, on
		// the first listing after a second directory is set, and looking exactly
		// like the models vanished.
		const scanDirs = modelsDirsToScan(settings)
		const discovered = new Map<
			string,
			{ dir: string; dirKind: Sockets.KoboldCPP.ModelKindFilter }
		>()
		// Nothing configured is not the same answer as an empty directory, so
		// the sweep is off until at least one directory has actually answered.
		let scannedEverything = scanDirs.length > 0
		for (const { kind: dirKind, dir } of scanDirs) {
			let entries: string[]
			try {
				entries = await fsPromises.readdir(dir)
			} catch {
				// Doesn't exist yet, or could not be read. Either way this
				// listing does not know what is in there, and a sweep run on a
				// partial answer deletes rows for models that are fine.
				scannedEverything = false
				continue
			}
			for (const name of entries) {
				if (!isModelFilename(name)) continue
				if (incompleteFilenames.has(name)) continue
				// `filename` is UNIQUE, so the same basename in both directories
				// is ONE row, described by whichever directory the scan saw
				// last. Bounded to metadata: each connection still loads the
				// copy in its own kind's directory, because resolveModelPath
				// tries that one first.
				discovered.set(name, { dir, dirKind })
			}
		}

		// Forget complete records for files removed outside the app — the
		// listing itself is always driven by the directory scan above, so this
		// only prevents koboldCppModels from accumulating rows for files that no
		// longer exist. Which is also why skipping it is cheap and running it on
		// an incomplete scan is not: a row nobody sees, against every model the
		// user owns disappearing from the Manager.
		if (scannedEverything) {
			const staleFilenames = dbModels
				.filter(
					(m) =>
						m.status === "complete" && !discovered.has(m.filename)
				)
				.map((m) => m.filename)
			if (staleFilenames.length > 0) {
				await db
					.delete(schema.koboldCppModels)
					.where(
						inArray(schema.koboldCppModels.filename, staleFilenames)
					)
			}
		}

		const availableModels: Sockets.KoboldCPP.ListModels.ModelFile[] =
			await Promise.all(
				[...discovered.entries()].map(async ([name, found]) => {
					const filePath = path.join(found.dir, name)
					let size = 0
					try {
						const stat = await fsPromises.stat(filePath)
						size = stat.size
					} catch {}

					let rec = dbByFilename.get(name)
					if (!rec) {
						// Placed directly into a models folder rather than
						// downloaded through the UI — track it the same as a
						// completed download so it behaves consistently
						// everywhere else that reads this table.
						//
						// The folder it was found in is good evidence of what it
						// is, and it is recorded as exactly that: "declared", a
						// claim the header sniff below can promote or overrule.
						// Not "assumed", which would be thrown away — the
						// unknown-verdict branch below rewrites an assumed kind
						// to "unknown", so a new-architecture image model in the
						// image folder would sit Unverified forever.
						const [tracked] = await db
							.insert(schema.koboldCppModels)
							.values({
								filename: name,
								modelName: name.replace(MODEL_EXTENSION_RE, ""),
								sizeBytes: size,
								status: "complete",
								kind: found.dirKind,
								kindSource: "declared"
							})
							.onConflictDoUpdate({
								target: schema.koboldCppModels.filename,
								set: { filename: name }
							})
							.returning()
						rec = tracked
					}

					// Straight passthrough of two NOT NULL columns, so a tracked
					// row always has an answer here. The fallback covers only
					// the unreachable case where the insert above returned no
					// row, and says "unknown" rather than "text": a record we
					// could not read back is not evidence that the file is a
					// text model.
					let kind: Sockets.KoboldCPP.ModelKind =
						rec?.kind ?? "unknown"
					let kindSource: Sockets.KoboldCPP.ModelKindSource =
						rec?.kindSource ?? "assumed"
					let kindReason: string | undefined

					// Sniff when the row has never been measured ("assumed" —
					// which is also every row the migration backfilled), when
					// something only CLAIMED what this is (the download tab, or
					// the folder above), when the last measurement failed, or
					// when the bytes changed under a row that WAS measured.
					// Never when a human has said what this is.
					//
					// "declared" is not optional in that list: without it the
					// folder's claim is never revisited, and an LLM dropped into
					// the image folder is offered as an image model forever.
					const sizeChanged =
						rec?.sizeBytes != null && rec.sizeBytes !== size
					if (
						kindSource !== "user" &&
						(kindSource === "assumed" ||
							kindSource === "declared" ||
							kind === "unknown" ||
							sizeChanged)
					) {
						const verdict = await classifyModelFile(filePath)
						kindReason = verdict.reason
						if (verdict.kind !== "unknown") {
							// A measurement of the file we actually hold
							// outranks anything guessed about it — including the
							// folder it was sitting in.
							kind = verdict.kind
							kindSource = "detected"
							await db
								.update(schema.koboldCppModels)
								.set({ kind, kindSource })
								.where(
									eq(schema.koboldCppModels.filename, name)
								)
						} else if (
							kindSource === "assumed" &&
							kind !== "unknown"
						) {
							// Looked, couldn't tell. Say so rather than keep
							// asserting the backfill's "text" — an unreadable
							// file offered as a working text model fails at load
							// time with nothing on screen. kindSource stays
							// "assumed" so a file that was mid-copy resolves
							// itself on the next listing; "detected" would be a
							// lie about a read that produced no answer.
							//
							// "declared" deliberately does NOT land here: an
							// indefinite read is not a reason to throw away the
							// only evidence there is, which is where the file
							// was put.
							kind = "unknown"
							await db
								.update(schema.koboldCppModels)
								.set({ kind })
								.where(
									eq(schema.koboldCppModels.filename, name)
								)
						}
					}

					return {
						kind,
						kindSource,
						kindReason,
						// Where it actually is, which is evidence and not a
						// verdict: a row whose kind disagrees with this is
						// either a user override or a legacy flat install.
						dirKind: found.dirKind,
						name,
						size,
						...(rec
							? {
									modelName: rec.modelName,
									modelUrl: rec.modelUrl ?? undefined,
									description: rec.description ?? undefined,
									quantization: rec.quantization ?? undefined,
									sizeBytes: rec.sizeBytes ?? undefined
								}
							: {})
					}
				})
			)

		const res: Sockets.KoboldCPP.ListModels.Response = {
			currentModel,
			availableModels,
			modelsDirSet: !!settings.koboldCppManagerModelsDir
		}
		emitToUser("koboldcpp:listModels", res)
		return res
	}
}

export const koboldCppLoadModelHandler: Handler<
	Sockets.KoboldCPP.LoadModel.Params,
	Sockets.KoboldCPP.LoadModel.Response
> = {
	event: "koboldcpp:loadModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const {
			koboldCppManagerBaseUrl: baseUrl,
			koboldCppManagedAdminPassword: adminPassword
		} = (await db.query.koboldCppSettings.findFirst())!

		const response = await fetch(`${baseUrl}/api/admin/reload_config`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${adminPassword ?? ""}`
			},
			body: JSON.stringify({ filename: params.filename }),
			signal: AbortSignal.timeout(30000)
		})

		if (!response.ok) {
			const text = await response.text()
			throw new Error(`Failed to load model: ${response.status} ${text}`)
		}
		const data = await response.json().catch(() => ({}))
		if (!data.success) {
			throw new Error(
				"reload_config rejected the request (success: false)"
			)
		}

		const res: Sockets.KoboldCPP.LoadModel.Response = {
			success: `Model "${params.filename}" loaded successfully`
		}
		emitToUser("koboldcpp:loadModel", res)
		return res
	}
}

export const koboldCppConnectModelHandler: Handler<
	Sockets.KoboldCPP.ConnectModel.Params,
	Sockets.KoboldCPP.ConnectModel.Response
> = {
	event: "koboldcpp:connectModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = (await db.query.koboldCppSettings.findFirst())!
		if (!settings.koboldCppManagerEnabled) {
			throw new Error("KoboldCPP Manager is disabled")
		}
		const { koboldCppManagerBaseUrl: baseUrl } = settings

		// Activating a model always targets a Managed-type connection — a
		// dumb/unmanaged connection never has model-swap behavior applied to it.
		let existingConnection = await db.query.connections.findFirst({
			where: (c, { and, eq }) =>
				and(
					eq(c.type, CONNECTION_TYPE.KOBOLDCPP_MANAGED),
					eq(c.model, params.modelName)
				)
		})

		if (!existingConnection) {
			const connectionName = params.modelName
				.replace(/\.gguf$/i, "")
				.replace(/\.kcpps$/i, "")
				.split(/[\\/]/)
				.pop()!

			const data: InsertConnection = {
				...koboldCppManagedAdapter.connectionDefaults,
				// connectionDefaults is typed as Record<string, any> on the
				// AdapterExports interface (adapters have differently-shaped
				// defaults), so the spread above doesn't statically guarantee
				// `type` even though it's present at runtime — set it
				// explicitly so this satisfies InsertConnection.
				type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
				name: connectionName,
				model: params.modelName,
				baseUrl,
				extraJson: {
					...koboldCppManagedAdapter.connectionDefaults.extraJson
				}
			}

			// A raw insert bypasses everything `connections:create` does to a new
			// row, including this — and the omission fails INVISIBLY. An empty
			// `capabilities` reads as "not determined yet", so capabilityGuard
			// falls through to its modality test and the connection keeps
			// working by accident, right up until some unrelated edit resolves
			// the row properly and the picker changes under the user.
			data.capabilities = {
				resolved: resolveConnectionCapabilities(data)
			}

			const [newConnection] = await db
				.insert(schema.connections)
				.values(data)
				.returning()
			existingConnection = newConnection
		}

		await connectionsSetUserActive.handler(
			socket,
			{ id: existingConnection.id },
			emitToUser
		)
		await connectionsList.handler(socket, {}, emitToUser)

		// Model loading is deferred to generation time (see KoboldCppManagedAdapter.preflight) —
		// setting a connection as default should not eagerly load/swap the koboldcpp model.

		const res: Sockets.KoboldCPP.ConnectModel.Response = {
			success: "Model set as default"
		}
		emitToUser("koboldcpp:connectModel", res)
		return res
	}
}

/**
 * The image counterpart of connectModel: one image model, one connection.
 *
 * A separate handler rather than a `kind` param on that one, because the two
 * agree on almost nothing. Different type, different validation, and a different
 * writer for "make this the default" — the text side stars through
 * `connections:setUserActive`, which also claims
 * `system_settings.default_connection_id`, a slot an image connection has no
 * business holding.
 *
 * Nothing is loaded here. Which model koboldcpp is holding is the model
 * manager's decision at render time, exactly as the text side defers its load to
 * generation time.
 */
export const koboldCppConnectImageModelHandler: Handler<
	Sockets.KoboldCPP.ConnectImageModel.Params,
	Sockets.KoboldCPP.ConnectImageModel.Response
> = {
	event: "koboldcpp:connectImageModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = (await db.query.koboldCppSettings.findFirst())!

		const fail = (error: string) => {
			emitToUser("koboldcpp:connectImageModel:error", { error })
			return { error }
		}

		if (!settings.koboldCppManagerEnabled) {
			return fail("KoboldCPP Manager is disabled")
		}

		const rec = await db.query.koboldCppModels.findFirst({
			where: eq(schema.koboldCppModels.filename, params.filename)
		})
		if (!rec || rec.status !== "complete") {
			return fail("That model isn't installed")
		}
		// A model the classifier or the user has called text cannot be loaded as
		// `sdmodel` — koboldcpp exit_with_error's on it. It no longer takes chat
		// down with it (a text plan carries no image model), but it does mean
		// every render fails on a connection that looks configured. "unknown" is
		// allowed through: overriding an unverified file is exactly how it stops
		// being unverified.
		if (rec.kind === "text") {
			return fail(
				"That's a text model. Mark it as an image model first if you're sure."
			)
		}
		// Both directories, because a legacy flat install has its image models
		// in the LLM folder and nothing ever moves them.
		try {
			await resolveModelPath("image", params.filename, settings, {
				mustExist: true
			})
		} catch {
			return fail("That model file is no longer on disk")
		}

		let connection = await db.query.connections.findFirst({
			where: (c, { and, eq }) =>
				and(
					eq(c.type, CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE),
					eq(c.model, params.filename)
				)
		})

		if (!connection) {
			const connectionName = params.filename.replace(
				MODEL_EXTENSION_RE,
				""
			)

			const data: InsertConnection = {
				...CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE],
				type: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
				// Explicit rather than inherited from the defaults spread: the
				// picker filters on this column, and a row that landed as
				// "text-gen" would be invisible everywhere it matters while
				// looking perfectly fine in the Connections list.
				modality: "image-gen",
				name: connectionName,
				model: params.filename,
				// Display only. The Manager's own settings are what
				// dispatchImage and the thin adapter resolve a managed row's
				// base URL from — this column is not authoritative for it.
				baseUrl: settings.koboldCppManagerBaseUrl,
				extraJson: {
					...CONNECTION_DEFAULTS[
						CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
					].extraJson
				}
			}
			// Same reason as connectModel's: a raw insert skips what
			// `connections:create` would have done, and a row with an empty
			// `capabilities` reads as undetermined rather than as broken.
			data.capabilities = {
				resolved: resolveConnectionCapabilities(data)
			}

			const [newConnection] = await db
				.insert(schema.connections)
				.values(data)
				.returning()
			connection = newConnection
		}

		// The capability-keyed table only — `system_settings` has one default
		// connection and it is the TEXT one.
		await setCapabilityDefault(db, "text->image", {
			connectionId: connection.id
		})

		await connectionsList.handler(socket, {}, emitToUser)
		// capabilityDefaults rides on systemSettings:get, which is where the
		// sidebars read "which connection draws" from.
		await systemSettingsGet.handler(socket, {}, emitToUser)

		const res: Sockets.KoboldCPP.ConnectImageModel.Response = {
			success: "Image model set as default"
		}
		emitToUser("koboldcpp:connectImageModel", res)
		return res
	}
}

export const koboldCppPerfHandler: Handler<
	Sockets.KoboldCPP.Perf.Params,
	Sockets.KoboldCPP.Perf.Response
> = {
	event: "koboldcpp:perf",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const { koboldCppManagerBaseUrl: baseUrl } =
			(await db.query.koboldCppSettings.findFirst())!

		let response: Response
		try {
			response = await fetch(`${baseUrl}/api/extra/perf`, {
				signal: AbortSignal.timeout(5000)
			})
		} catch {
			// Not reachable is an expected, routine state (nothing started
			// yet, no managed/external instance configured, or it's
			// mid-restart) — emit a clean :error and return here instead of
			// throwing. Throwing a "clean" message still made it into the
			// generic handler wrapper's console.error on every check (that
			// wrapper logs unconditionally on any throw, regardless of
			// message quality) — this is routine client-facing state, not a
			// server-side fault worth logging.
			emitToUser("koboldcpp:perf:error", {
				error: "KoboldCPP is not reachable"
			})
			return {
				lastProcess: 0,
				lastEval: 0,
				lastTokenCount: 0,
				queue: 0,
				idle: false,
				uptime: 0,
				avgGenSpeed: 0,
				avgPromptSpeed: 0,
				totalGens: 0
			}
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = await response.json()
		const res: Sockets.KoboldCPP.Perf.Response = {
			lastProcess: data.last_process ?? 0,
			lastEval: data.last_eval ?? 0,
			lastTokenCount: data.last_token_count ?? 0,
			queue: data.queue ?? 0,
			idle: data.idle === 1 || data.idle === true,
			uptime: data.uptime ?? 0,
			avgGenSpeed: data.avg_gen_speed ?? 0,
			avgPromptSpeed: data.avg_prompt_speed ?? 0,
			totalGens: data.total_gens ?? 0
		}
		emitToUser("koboldcpp:perf", res)
		return res
	}
}

export const koboldCppGetLoadedConfigHandler: Handler<
	Sockets.KoboldCPP.GetLoadedConfig.Params,
	Sockets.KoboldCPP.GetLoadedConfig.Response
> = {
	event: "koboldcpp:getLoadedConfig",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const signature = getLoadedSignature()
		// What the RUNNING process holds, per kind — not what any connection
		// names. The two differ for as long as a load takes, and the Models tab
		// needs both to tell "loaded right now" from "loads on the next
		// request". Passed through as the loader's own map rather than
		// flattened: how many models are resident is that module's decision, and
		// a client reading both keys keeps working when it changes.
		const res: Sockets.KoboldCPP.GetLoadedConfig.Response = {
			config: signature
				? {
						resident: signature.resident,
						rawConfigJson: signature.rawConfigJson
					}
				: null
		}
		emitToUser("koboldcpp:getLoadedConfig", res)
		return res
	}
}

// --- RECOMMENDED MODELS (cached to avoid hammering HF on every open) ---

const RECOMMENDED_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
// Keyed by kind, not a single slot. The two lists come from entirely different
// sources (a curated YAML of text models vs. the maintainer's image repo), so
// one slot would serve the text list straight back out for an hour after the
// user switched the toggle to Image — a bug that looks exactly like the image
// catalog being empty, and self-heals just slowly enough to be unreportable.
const recommendedCache = new Map<
	Sockets.KoboldCPP.ModelKindFilter,
	{
		models: Sockets.KoboldCPP.RecommendedModels.RecommendedModel[]
		cachedAt: number
	}
>()

const GGUF_QUANT_RE = /^(Q|IQ|BF|F)\d/i

/**
 * The maintainer's own curated image models. There is no image equivalent of
 * the text YAML catalog, and this repo carries no `pipeline_tag` (its tags are
 * just `["gguf","region:us"]`), so it does NOT surface in the image search
 * below — fetching it by id is the only way to reach it.
 *
 * `?blobs=true` is not optional: the plain endpoint returns siblings with no
 * `size`, and choosing between a 680MB and a 6.3GB model with no sizes on
 * screen is not choosing.
 */
const IMGMODEL_REPO_ID = "koboldcpp/imgmodel"
const IMGMODEL_API_URL = `https://huggingface.co/api/models/${IMGMODEL_REPO_ID}?blobs=true`
/**
 * The repo's own README caveat, carried onto every card so the scope line reads
 * as a boundary rather than as a broken download. The subdirectory bundles
 * (SeFi-Image-5B-Turbo/, flux2klein4b/, z-image/) are multi-file Flux/SD3-class
 * models with separate VAE/Clip/T5 parts; each models directory is flat and an
 * image load passes exactly one `sdmodel`, so the root-only rule excludes them.
 */
const IMGMODEL_CAVEAT =
	"From koboldcpp/imgmodel, the maintainer's curated single-file image models. SD1.5 and SDXL need only the model itself; SD3 and Flux additionally need separate Clip and T5-XXL files, which this list does not cover."

async function fetchRecommendedYaml(): Promise<
	Array<{
		name: string
		pull: string
		recommended_vram: number
		details: { parameter_size: string; description: string }
	}>
> {
	const resp = await fetch(
		"https://raw.githubusercontent.com/doolijb/serene-pub-gguf-list/main/recommended.yaml"
	)
	if (!resp.ok) throw new Error(`YAML fetch failed: ${resp.status}`)
	const text = await resp.text()

	const models: any[] = []
	let cur: any = null
	let inDetails = false
	for (const line of text.split("\n")) {
		const t = line.trim()
		if (t.startsWith("- name:")) {
			if (cur) models.push(cur)
			cur = {
				name: t.replace("- name:", "").trim(),
				pull: "",
				recommended_vram: 0,
				details: { parameter_size: "", description: "" }
			}
			inDetails = false
		} else if (cur) {
			if (t.startsWith("pull:")) cur.pull = t.replace("pull:", "").trim()
			else if (t.startsWith("recommended_vram:"))
				cur.recommended_vram =
					parseInt(t.replace("recommended_vram:", "").trim()) || 0
			else if (t === "details:") inDetails = true
			else if (inDetails) {
				if (t.startsWith("parameter_size:"))
					cur.details.parameter_size = t
						.replace("parameter_size:", "")
						.trim()
						.replace(/"/g, "")
				else if (t.startsWith("description:"))
					cur.details.description = t
						.replace("description:", "")
						.trim()
						.replace(/"/g, "")
			}
		}
	}
	if (cur) models.push(cur)
	return models
}

async function resolveHfModel(
	ollamaName: string
): Promise<Sockets.KoboldCPP.SearchModels.ModelResult | null> {
	try {
		const resp = await fetch(
			`https://huggingface.co/api/models?search=${encodeURIComponent(ollamaName)}&filter=gguf&limit=5&sort=downloads&full=True&config=True`,
			{ signal: AbortSignal.timeout(10_000) }
		)
		if (!resp.ok) return null
		const data: any[] = await resp.json()

		for (const m of data) {
			if (m.private || m.gated === true || m.gated === "auto") continue
			const pullOptions: Sockets.KoboldCPP.SearchModels.PullOption[] = (
				m.siblings as any[]
			)
				.filter((s: any) => s.rfilename.endsWith(".gguf"))
				.filter((s: any) =>
					GGUF_QUANT_RE.test(
						s.rfilename
							.replace(".gguf", "")
							.split("-")
							.pop()
							?.toUpperCase() ?? ""
					)
				)
				.map((s: any) => ({
					label:
						s.rfilename.replace(".gguf", "").split("-").pop() ??
						s.rfilename,
					filename: s.rfilename,
					downloadUrl: `https://huggingface.co/${m.id}/resolve/main/${s.rfilename}`,
					sizeBytes: typeof s.size === "number" ? s.size : undefined
				}))
			if (pullOptions.length > 0) {
				return {
					name: m.id,
					// NOT `|| m.pipeline_tag`. The HF *search* endpoint returns no
					// `description` field at all, so that fallback always produced a bare
					// tag string ("text-generation", "image-text-to-text"). Being truthy,
					// it then won the `hf.description || ym.details.description` race in
					// koboldCppRecommendedModelsHandler below, suppressing the curated
					// description from recommended.yaml for every model whose repo
					// carries a pipeline tag — 10 of 13 entries at the time of writing.
					description: m.description,
					downloads: m.downloads,
					likes: m.likes,
					trendingScore: m.trendingScore,
					url: `https://huggingface.co/${m.id}`,
					pullOptions
				}
			}
		}
		return null
	} catch {
		return null
	}
}

/**
 * Every ROOT-LEVEL model file in a repo, as pull options labelled by their bare
 * filename.
 *
 * Deliberately NOT the quant filter the text path uses. `GGUF_QUANT_RE` tests
 * the last hyphen-separated segment, and image models are not named that way:
 * `imgmodel_xl_q4_0` yields "i", `sd_xl_turbo_1.0.q8_0` yields "s",
 * `sdxs-512-tinySDdistilled_Q8_0` yields "t". Every one fails the regex, and
 * the `pullOptions.length > 0` filter downstream would then drop the
 * maintainer's own repo out of its own results — an empty list, no error.
 *
 * Root level only, which is one rule doing three jobs: a models directory is
 * flat (a `clip/foo.safetensors` rfilename passes the download handler's
 * containment check and then ENOENTs in createWriteStream), it excludes
 * accessory VAE/Clip/T5 parts without a fragile denylist, and it draws the "for
 * now" line exactly where a connection naming one model draws it.
 */
function imagePullOptions(
	repoId: string,
	siblings: any[]
): Sockets.KoboldCPP.SearchModels.PullOption[] {
	return (siblings ?? [])
		.filter(
			(s: any) =>
				typeof s?.rfilename === "string" &&
				!s.rfilename.includes("/") &&
				isModelFilename(s.rfilename)
		)
		.map((s: any) => ({
			label: s.rfilename,
			filename: s.rfilename,
			downloadUrl: `https://huggingface.co/${repoId}/resolve/main/${s.rfilename}`,
			sizeBytes: typeof s.size === "number" ? s.size : undefined
		}))
}

/**
 * The koboldcpp/imgmodel catalog, one card per file.
 *
 * Per FILE, not per repo — unlike the text path, where a repo's siblings really
 * are quants of one model, these are six different models (an SDXL finetune, a
 * photoreal SD1.5, a 512px distill...). Collapsing them into one card's
 * dropdown would present unrelated models as if they were interchangeable
 * quantisations of each other.
 */
async function fetchRecommendedImageModels(): Promise<
	Sockets.KoboldCPP.RecommendedModels.RecommendedModel[]
> {
	const resp = await fetch(IMGMODEL_API_URL, {
		signal: AbortSignal.timeout(10_000)
	})
	if (!resp.ok) throw new Error(`Hugging Face API error: ${resp.status}`)
	const data = await resp.json()

	return imagePullOptions(IMGMODEL_REPO_ID, data?.siblings ?? []).map(
		(option) => ({
			name: option.filename.replace(MODEL_EXTENSION_RE, ""),
			// `ollamaName` is required by RecommendedModel and means "the
			// catalog's own name for this entry" — for a repo of loose files
			// that is the filename, there being no ollama-style name to give.
			ollamaName: option.filename.replace(MODEL_EXTENSION_RE, ""),
			description: IMGMODEL_CAVEAT,
			url: `https://huggingface.co/${IMGMODEL_REPO_ID}`,
			pullOptions: [option],
			sdcpp: true
		})
	)
}

export const koboldCppRecommendedModelsHandler: Handler<
	Sockets.KoboldCPP.RecommendedModels.Params,
	Sockets.KoboldCPP.RecommendedModels.Response
> = {
	event: "koboldcpp:recommendedModels",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const kind = params.kind ?? "text"
		const cached = recommendedCache.get(kind)
		if (cached && Date.now() - cached.cachedAt < RECOMMENDED_CACHE_TTL_MS) {
			const res = { models: cached.models }
			emitToUser("koboldcpp:recommendedModels", res)
			return res
		}

		if (kind === "image") {
			// The text path's own failure handling is per-model
			// (Promise.allSettled); this one is a single fetch, so the
			// equivalent is a caught failure landing on the empty state rather
			// than a thrown handler. A failure is not cached — an HF blip
			// should not cost the user an hour of empty Recommended.
			let models: Sockets.KoboldCPP.RecommendedModels.RecommendedModel[] =
				[]
			let failed = false
			try {
				models = await fetchRecommendedImageModels()
				recommendedCache.set(kind, { models, cachedAt: Date.now() })
			} catch (err: any) {
				console.error(
					"[KoboldCPP recommendedModels image]",
					err.message
				)
				failed = true
			}
			// `failed` rather than an empty success, because the two mean
			// opposite things to the person reading the tab. An empty catalog
			// says "KoboldCPP ships no image models" and sends them to Hugging
			// Face; a failed fetch means HF is unreachable, so that advice
			// cannot work either — same host, same outage. Reported on the
			// success response rather than as `:error` so the empty-vs-failed
			// distinction survives without a second listener that would also
			// have to be torn down by name.
			const res: Sockets.KoboldCPP.RecommendedModels.Response = {
				models,
				failed
			}
			emitToUser("koboldcpp:recommendedModels", res)
			return res
		}

		const yamlModels = await fetchRecommendedYaml()

		const settled = await Promise.allSettled(
			yamlModels.map(
				async (
					ym
				): Promise<Sockets.KoboldCPP.RecommendedModels.RecommendedModel | null> => {
					const hf = await resolveHfModel(ym.name)
					if (!hf) return null
					return {
						...hf,
						ollamaName: ym.name,
						recommendedVram: ym.recommended_vram || undefined,
						parameterSize: ym.details.parameter_size || undefined,
						description:
							hf.description ||
							ym.details.description ||
							undefined
					}
				}
			)
		)

		const models = settled
			.filter(
				(
					r
				): r is PromiseFulfilledResult<Sockets.KoboldCPP.RecommendedModels.RecommendedModel> =>
					r.status === "fulfilled" && r.value !== null
			)
			.map((r) => r.value)

		recommendedCache.set(kind, { models, cachedAt: Date.now() })

		const res: Sockets.KoboldCPP.RecommendedModels.Response = { models }
		emitToUser("koboldcpp:recommendedModels", res)
		return res
	}
}

// --- DOWNLOAD STATE (module-level so downloads survive tab changes) ---

type DownloadEntry = Sockets.KoboldCPP.DownloadProgress.DownloadEntry & {
	abort?: () => void
}
let activeDownloads: Record<string, DownloadEntry> = {}
// koboldCppDownloadModelHandler already guards re-downloading the same
// filename, but nothing capped the number of distinct concurrent downloads
// — an admin session could launch many simultaneous multi-GB downloads with
// no bandwidth/disk cap, unlike binaryManager's own single-flight guard.
// This caps distinct *files* downloading at once — unrelated to
// MAX_PARALLEL_CHUNKS_PER_DOWNLOAD below, which caps concurrent connections
// *within* a single file's download.
const MAX_CONCURRENT_MODEL_DOWNLOADS = 3

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
// Map<userId, {emit, connections}>, not a single nullable slot or a
// Set<EmitFn> — the old single-slot design meant whichever admin most
// recently called koboldCppDownloadModelHandler/
// koboldCppGetDownloadProgressHandler became the sole recipient of model
// download progress, silently cutting off any other connected admin. A
// Set<EmitFn> fixes that but overcorrects: registerKoboldCppHandlers runs
// once per *connection*, and emitToUser already broadcasts to every open
// tab/connection for a user (io.to("user_"+userId).emit(...)) — so N tabs
// for the same admin would mean N entries in the Set, each independently
// re-broadcasting to all N sockets (N² transmissions per tick instead of
// N). Keying by userId with a connection refcount collapses that back to
// one broadcast per user regardless of how many tabs they have open, and
// only unregisters once every one of their connections has disconnected.
const downloadProgressEmitters = new Map<
	number,
	{
		emit: (data: Sockets.KoboldCPP.DownloadProgress.Response) => void
		connections: number
	}
>()

function registerDownloadProgressEmitter(
	userId: number,
	fn: (data: Sockets.KoboldCPP.DownloadProgress.Response) => void
) {
	const existing = downloadProgressEmitters.get(userId)
	if (existing) {
		existing.connections++
		return
	}
	downloadProgressEmitters.set(userId, { emit: fn, connections: 1 })
}

function unregisterDownloadProgressEmitter(userId: number) {
	const existing = downloadProgressEmitters.get(userId)
	if (!existing) return
	existing.connections--
	if (existing.connections <= 0) downloadProgressEmitters.delete(userId)
}

// Progress ticks arrive on every TCP chunk of a streaming download (up to
// hundreds of thousands of times for a multi-GB file) — each broadcast is
// a synchronous JSON-serialize + Socket.IO emit, competing with the
// download's own network I/O on Node's single event loop. Throttling the
// broadcast (not the byte-counter update, which stays real-time for the
// pull-based koboldCppGetDownloadProgressHandler) is the single biggest
// win for actual download throughput.
const PROGRESS_EMIT_THROTTLE_MS = 250
const lastProgressEmitAt: Record<string, number> = {}

function emitDownloadProgress() {
	const downloads: Sockets.KoboldCPP.DownloadProgress.Response["downloads"] =
		{}
	for (const [key, entry] of Object.entries(activeDownloads)) {
		const { abort: _abort, ...rest } = entry
		downloads[key] = rest
	}
	for (const { emit } of downloadProgressEmitters.values()) {
		try {
			emit({ downloads })
		} catch {}
	}
}

// Gates emitDownloadProgress() itself, not the underlying byte counter —
// call sites that update activeDownloads[filename] on every chunk should
// still call this on every chunk; the throttle lives here so state
// transitions (start/success/error, called via emitDownloadProgress()
// directly) are never accidentally throttled away.
function maybeEmitDownloadProgress(filename: string) {
	const now = Date.now()
	if (now - (lastProgressEmitAt[filename] ?? 0) < PROGRESS_EMIT_THROTTLE_MS) {
		return
	}
	lastProgressEmitAt[filename] = now
	emitDownloadProgress()
}

export const koboldCppSearchModelsHandler: Handler<
	Sockets.KoboldCPP.SearchModels.Params,
	Sockets.KoboldCPP.SearchModels.Response
> = {
	event: "koboldcpp:searchModels",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		// Instance-wide budget — hits Hugging Face on every call with no
		// throttling otherwise, unlike the recommended-models handler's own
		// TTL cache for the same external host.
		if (loginRateLimit.isRateLimited("koboldcpp:searchModels")) {
			throw new Error("Rate limited. Please wait a moment and try again.")
		}
		loginRateLimit.recordFailedAttempt("koboldcpp:searchModels")
		const { searchTerm } = params
		const kind = params.kind ?? "text"
		// The HF API ANDs repeated `filter` params — verified empirically, and
		// undocumented, so if that ever changes image search degrades to a
		// text-ish result set rather than erroring. `&filter=gguf` alone is
		// actively wrong here: it returns Pushpendra817/SDXL-Captioner-GGUF,
		// whose pipeline_tag is image-text-to-text (a vision-language model,
		// not an image generator), plus untagged repos with no pipeline_tag.
		const response = await fetch(
			kind === "image"
				? `https://huggingface.co/api/models?search=${encodeURIComponent(searchTerm)}&filter=gguf&filter=text-to-image&limit=50&sort=trendingScore&full=True&config=True`
				: `https://huggingface.co/api/models?search=${encodeURIComponent(searchTerm)}&filter=gguf&limit=50&sort=trendingScore&full=True&config=True`
		)
		if (!response.ok)
			throw new Error(`Hugging Face API error: ${response.status}`)
		const data = await response.json()

		if (kind === "image") {
			const models = (data as any[])
				.filter(
					(m) => !m.private && m.gated !== true && m.gated !== "auto"
				)
				// A vision-language model reads pictures, it does not draw
				// them. `&filter=text-to-image` mostly keeps these out, but
				// SDXL-Captioner-GGUF still arrives on a `sdxl` search.
				.filter((m) => m.pipeline_tag !== "image-text-to-text")
				.map((m) => ({
					name: m.id,
					description: m.description || m.pipeline_tag,
					downloads: m.downloads,
					likes: m.likes,
					trendingScore: m.trendingScore,
					url: `https://huggingface.co/${m.id}`,
					pullOptions: imagePullOptions(m.id, m.siblings ?? []),
					// The exact GGUF flavour koboldcpp requires (ComfyUI-format
					// GGUF is a container it refuses). Badged and sorted first,
					// never FILTERED on: hum-ma/SDXL-models-GGUF is tagged
					// `diffusers`, ships working SDXL, and is a top-3 result.
					sdcpp: (m.tags as any[])?.includes("stable-diffusion.cpp")
				}))
				.filter((m) => m.pullOptions.length > 0)
				.sort((a, b) => Number(!!b.sdcpp) - Number(!!a.sdcpp))

			const res: Sockets.KoboldCPP.SearchModels.Response = { models }
			emitToUser("koboldcpp:searchModels", res)
			return res
		}

		const models = (data as any[])
			.filter((m) => !m.private && m.gated !== true && m.gated !== "auto")
			.map((m) => {
				const ggufFiles = (m.siblings as any[]).filter((s: any) =>
					s.rfilename.endsWith(".gguf")
				)
				const pullOptions: Sockets.KoboldCPP.SearchModels.PullOption[] =
					ggufFiles
						.filter((s: any) => {
							const stem =
								s.rfilename
									.replace(".gguf", "")
									.split("-")
									.pop()
									?.toUpperCase() ?? ""
							return /^(Q|IQ|BF|F)\d/.test(stem)
						})
						.map((s: any) => ({
							label:
								s.rfilename
									.replace(".gguf", "")
									.split("-")
									.pop() ?? s.rfilename,
							filename: s.rfilename,
							downloadUrl: `https://huggingface.co/${m.id}/resolve/main/${s.rfilename}`,
							sizeBytes:
								typeof s.size === "number" ? s.size : undefined
						}))
				return {
					name: m.id,
					description: m.description || m.pipeline_tag,
					downloads: m.downloads,
					likes: m.likes,
					trendingScore: m.trendingScore,
					url: `https://huggingface.co/${m.id}`,
					pullOptions
				}
			})
			.filter((m) => m.pullOptions.length > 0)

		const res: Sockets.KoboldCPP.SearchModels.Response = { models }
		emitToUser("koboldcpp:searchModels", res)
		return res
	}
}

// --- PARALLEL CHUNKED DOWNLOAD HELPERS ---

type ResolvedDownload =
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
function resolveHuggingFaceDownload(
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
async function downloadFileInParallelChunks(opts: {
	resolvedUrl: string
	total: number
	destPath: string
	filename: string
	registerRequest: (req: import("http").ClientRequest) => void
	isAborted: () => boolean
}): Promise<void> {
	const {
		resolvedUrl,
		total,
		destPath,
		filename,
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
								activeDownloads[filename].downloaded +=
									buf.length
								maybeEmitDownloadProgress(filename)
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

export const koboldCppDownloadModelHandler: Handler<
	Sockets.KoboldCPP.DownloadModel.Params,
	Sockets.KoboldCPP.DownloadModel.Response
> = {
	event: "koboldcpp:downloadModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = (await db.query.koboldCppSettings.findFirst())!

		const {
			filename,
			downloadUrl,
			modelName,
			modelUrl,
			description,
			quantization,
			sizeBytes
		} = params
		// Which tab the user was in. Stored as "declared" — a guess about a
		// file — and re-checked against the finished bytes below. It also picks
		// the DIRECTORY, and that half has no fallback: a download lands in the
		// folder for its kind or it does not happen.
		const kind = params.kind ?? "text"
		const modelsDir = modelsDirFor(kind, settings)
		if (!modelsDir) throw new Error("Models directory not configured")

		// Root level only, checked BEFORE the containment check below because
		// containment would pass it: `clip/foo.safetensors` resolves inside
		// modelsDir quite legitimately, and then ENOENTs in createWriteStream
		// because the mkdir below creates modelsDir, not a subtree under it.
		// Both separators, not path.sep — a Windows-shaped name is still a
		// subdirectory reference to a Hugging Face repo listing.
		if (filename.includes("/") || filename.includes("\\")) {
			throw new Error(
				"Only files at the root of a repository can be downloaded"
			)
		}
		// A .safetensors can only ever be an image model, so one arriving from
		// the text tab is a download that could never have loaded.
		if (!extensionAllowedForKind(filename, kind)) {
			throw new Error(
				kind === "text"
					? "KoboldCPP loads text models from .gguf only"
					: "Image models must be .gguf or .safetensors"
			)
		}

		// filename is client-supplied — without the bare-name and containment
		// checks inside this, a path-traversal or absolute-path filename could
		// write outside the directory entirely. `mustExist: false` is the write
		// form: this kind's directory only, never the other one's.
		const destPath = await resolveModelPath(kind, filename, settings, {
			mustExist: false
		})

		// downloadUrl is client-supplied — without this, an admin session (or
		// forged socket emission) could point the server at an arbitrary
		// internal address, streaming the response into a file later fed to
		// the native koboldcpp/GGUF loader. Every legitimate downloadUrl this
		// app ever constructs is huggingface.co — see isAllowedHuggingFaceHost.
		let parsedDownloadUrl: URL
		try {
			parsedDownloadUrl = new URL(downloadUrl)
		} catch {
			throw new Error("Invalid download URL")
		}
		if (!isAllowedHuggingFaceHost(parsedDownloadUrl.hostname)) {
			throw new Error("Download URL must be a Hugging Face URL")
		}

		if (activeDownloads[filename] && !activeDownloads[filename].isDone) {
			emitToUser("koboldcpp:downloadModel:error", {
				error: "Already downloading this file"
			})
			return { success: false }
		}

		const activeCount = Object.values(activeDownloads).filter(
			(d) => !d.isDone
		).length
		if (activeCount >= MAX_CONCURRENT_MODEL_DOWNLOADS) {
			emitToUser("koboldcpp:downloadModel:error", {
				error: `Too many downloads already in progress (max ${MAX_CONCURRENT_MODEL_DOWNLOADS}).`
			})
			return { success: false }
		}

		// Last, so a rejected request never leaves an empty models folder behind
		// — and per KIND, since the image directory may not exist yet on an
		// install that has only ever downloaded LLMs.
		await fsPromises.mkdir(modelsDir, { recursive: true })

		// Upsert DB record before starting so the file is excluded from the available list immediately
		await db
			.insert(schema.koboldCppModels)
			.values({
				filename,
				modelName,
				modelUrl,
				description,
				quantization,
				sizeBytes: sizeBytes ?? null,
				downloadUrl,
				status: "downloading",
				kind,
				kindSource: "declared"
			})
			.onConflictDoUpdate({
				target: schema.koboldCppModels.filename,
				set: {
					modelName,
					modelUrl,
					description,
					quantization,
					sizeBytes: sizeBytes ?? null,
					downloadUrl,
					status: "downloading",
					errorMessage: null,
					kind,
					kindSource: "declared"
				}
			})

		activeDownloads[filename] = {
			filename,
			modelName,
			status: "starting",
			downloaded: 0,
			total: 0,
			isDone: false
		}
		emitDownloadProgress()

		// Run download asynchronously so we can return immediately
		;(async () => {
			// Declared outside the inner try so the catch block below can
			// also destroy any still-open connections on ANY terminal
			// failure — not just a user-initiated cancel. A chunk request
			// erroring out (eg. a transient 500) must not leave its sibling
			// in-flight chunk requests dangling.
			let aborted = false
			const inFlightRequests = new Set<import("http").ClientRequest>()
			try {
				let cancelReject: ((err: Error) => void) | null = null
				activeDownloads[filename].abort = () => {
					aborted = true
					for (const req of inFlightRequests) req.destroy()
					cancelReject?.(new Error("cancelled"))
				}
				const registerRequest = (req: import("http").ClientRequest) => {
					inFlightRequests.add(req)
					// .on, not .once — each request object is only ever
					// registered once, so they behave identically here, but
					// .on works against minimal test doubles that only
					// implement the base emitter method.
					req.on("close", () => inFlightRequests.delete(req))
				}

				let resolved: ResolvedDownload
				try {
					resolved = await resolveHuggingFaceDownload(
						downloadUrl,
						registerRequest
					)
				} catch (err) {
					// A destroy()'d probe request surfaces as a raw
					// socket/ECONNRESET-style error, not "cancelled" — but if
					// abort() is what caused it, normalize the message so the
					// catch block below picks the cancelled-cleanup branch
					// instead of the error branch.
					if (aborted) throw new Error("cancelled")
					throw err
				}
				if (aborted) throw new Error("cancelled")

				activeDownloads[filename].total = resolved.total
				activeDownloads[filename].status = "downloading"

				if (resolved.kind === "ranged" && resolved.total > 0) {
					await new Promise<void>((resolve, reject) => {
						cancelReject = reject
						downloadFileInParallelChunks({
							resolvedUrl: resolved.resolvedUrl,
							total: resolved.total,
							destPath,
							filename,
							registerRequest,
							isAborted: () => aborted
						}).then(resolve, reject)
					})
				} else {
					// Range unsupported, or size unknown — fall back to the
					// original single-stream path, fed by the resolve step's
					// own in-flight response (no second request needed).
					await new Promise<void>((resolve, reject) => {
						cancelReject = reject
						// The underlying request was already registered for
						// abort-tracking inside resolveHuggingFaceDownload's
						// probe() — no need to register it again here.
						const res = (
							resolved as Extract<
								ResolvedDownload,
								{ kind: "fallback" }
							>
						).initialResponse
						const writer = fs.createWriteStream(destPath)
						res.on("data", (chunk: Buffer) => {
							activeDownloads[filename].downloaded += chunk.length
							maybeEmitDownloadProgress(filename)
						})
						res.pipe(writer)
						writer.on("finish", resolve)
						writer.on("error", reject)
						res.on("error", reject)
					})
				}

				activeDownloads[filename].status = "success"
				activeDownloads[filename].isDone = true
				emitDownloadProgress()
				// Now that the bytes are here, look at them. A declaration is a
				// guess about a file; this is a measurement of the file we hold,
				// so a confident disagreement wins — the tab you were in is not
				// evidence about what a repo actually published.
				const verdict = await classifyModelFile(destPath)
				const corrected =
					verdict.kind !== "unknown" && verdict.kind !== kind
				await db
					.update(schema.koboldCppModels)
					.set({
						status: "complete",
						...(corrected
							? {
									kind: verdict.kind,
									kindSource: "detected" as const
								}
							: {})
					})
					.where(eq(schema.koboldCppModels.filename, filename))
			} catch (err: any) {
				// Whatever ended the download — cancel or a genuine chunk
				// error — any request still marked in-flight at this point
				// is orphaned; destroy it rather than leave it dangling.
				for (const req of inFlightRequests) req.destroy()
				const isCancelled = err.message === "cancelled"
				activeDownloads[filename].status = isCancelled
					? "cancelled"
					: "error"
				activeDownloads[filename].isDone = true
				if (isCancelled) {
					// Clean up partial file and DB record
					fsPromises.unlink(destPath).catch(() => {})
					db.delete(schema.koboldCppModels)
						.where(eq(schema.koboldCppModels.filename, filename))
						.catch(() => {})
				} else {
					await db
						.update(schema.koboldCppModels)
						.set({
							status: "error",
							errorMessage: err.message ?? "Unknown error"
						})
						.where(eq(schema.koboldCppModels.filename, filename))
				}
				emitDownloadProgress()
			}
		})()

		const res: Sockets.KoboldCPP.DownloadModel.Response = { success: true }
		emitToUser("koboldcpp:downloadModel", res)
		return res
	}
}

export const koboldCppCancelDownloadHandler: Handler<
	Sockets.KoboldCPP.CancelDownload.Params,
	Sockets.KoboldCPP.CancelDownload.Response
> = {
	event: "koboldcpp:cancelDownload",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const entry = activeDownloads[params.filename]
		if (entry && !entry.isDone && entry.abort) {
			entry.abort()
		}
		const res: Sockets.KoboldCPP.CancelDownload.Response = { success: true }
		emitToUser("koboldcpp:cancelDownload", res)
		return res
	}
}

export const koboldCppGetDownloadProgressHandler: Handler<
	Sockets.KoboldCPP.GetDownloadProgress.Params,
	Sockets.KoboldCPP.GetDownloadProgress.Response
> = {
	event: "koboldcpp:getDownloadProgress",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const downloads: Sockets.KoboldCPP.GetDownloadProgress.Response["downloads"] =
			{}
		for (const [key, entry] of Object.entries(activeDownloads)) {
			const { abort: _abort, ...rest } = entry
			downloads[key] = rest
		}
		const res: Sockets.KoboldCPP.GetDownloadProgress.Response = {
			downloads
		}
		emitToUser("koboldcpp:getDownloadProgress", res)
		return res
	}
}

export const koboldCppClearDownloadHistoryHandler: Handler<
	Sockets.KoboldCPP.ClearDownloadHistory.Params,
	Sockets.KoboldCPP.ClearDownloadHistory.Response
> = {
	event: "koboldcpp:clearDownloadHistory",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		for (const key of Object.keys(activeDownloads)) {
			if (activeDownloads[key].isDone) {
				delete activeDownloads[key]
				delete lastProgressEmitAt[key]
			}
		}
		const res: Sockets.KoboldCPP.ClearDownloadHistory.Response = {
			success: true
		}
		emitToUser("koboldcpp:clearDownloadHistory", res)
		return res
	}
}

// --- MANAGED MODE HANDLERS ---

export const koboldCppSetManagedMode: Handler<
	Sockets.KoboldCPP.SetManagedMode.Params,
	Sockets.KoboldCPP.SetManagedMode.Response
> = {
	event: "koboldcpp:setManagedMode",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		if (params.mode === "managed" && isAndroidWrapper()) {
			throw new Error(
				"Managed KoboldCPP mode is not available in the Android app"
			)
		}
		const settings = (await db.query.koboldCppSettings.findFirst())!

		let adminPassword = settings.koboldCppManagedAdminPassword
		if (params.mode === "managed" && !adminPassword) {
			adminPassword = randomUUID().replace(/-/g, "")
		}

		await db
			.update(schema.koboldCppSettings)
			.set({
				koboldCppManagedMode: params.mode,
				...(adminPassword
					? { koboldCppManagedAdminPassword: adminPassword }
					: {})
			})
			.where(eq(schema.koboldCppSettings.id, 1))

		// Stop subprocess if switching away from managed
		if (params.mode !== "managed" && subprocessManager.isRunning()) {
			subprocessManager.stop().catch(() => {})
		}

		const res: Sockets.KoboldCPP.SetManagedMode.Response = { success: true }
		emitToUser("koboldcpp:setManagedMode", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetManagedPort: Handler<
	Sockets.KoboldCPP.SetManagedPort.Params,
	Sockets.KoboldCPP.SetManagedPort.Response
> = {
	event: "koboldcpp:setManagedPort",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const port = Math.max(1024, Math.min(65535, Math.floor(params.port)))
		await db
			.update(schema.koboldCppSettings)
			.set({
				koboldCppManagedPort: port,
				koboldCppManagerBaseUrl: `http://localhost:${port}`
			})
			.where(eq(schema.koboldCppSettings.id, 1))
		const res: Sockets.KoboldCPP.SetManagedPort.Response = { success: true }
		emitToUser("koboldcpp:setManagedPort", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetManagedBinaryDir: Handler<
	Sockets.KoboldCPP.SetManagedBinaryDir.Params,
	Sockets.KoboldCPP.SetManagedBinaryDir.Response
> = {
	event: "koboldcpp:setManagedBinaryDir",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		await db
			.update(schema.koboldCppSettings)
			.set({ koboldCppManagedBinaryDir: params.dir || null })
			.where(eq(schema.koboldCppSettings.id, 1))
		const res: Sockets.KoboldCPP.SetManagedBinaryDir.Response = {
			success: true
		}
		emitToUser("koboldcpp:setManagedBinaryDir", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetManagedAdminPassword: Handler<
	Sockets.KoboldCPP.SetManagedAdminPassword.Params,
	Sockets.KoboldCPP.SetManagedAdminPassword.Response
> = {
	event: "koboldcpp:setManagedAdminPassword",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		await db
			.update(schema.koboldCppSettings)
			.set({
				koboldCppManagedAdminPassword: params.password.trim() || null
			})
			.where(eq(schema.koboldCppSettings.id, 1))
		const res: Sockets.KoboldCPP.SetManagedAdminPassword.Response = {
			success: true
		}
		emitToUser("koboldcpp:setManagedAdminPassword", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetModelTtl: Handler<
	Sockets.KoboldCPP.SetModelTtl.Params,
	Sockets.KoboldCPP.SetModelTtl.Response
> = {
	event: "koboldcpp:setModelTtl",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const ttl = Math.max(0, Math.floor(params.ttlSecs))
		await db
			.update(schema.koboldCppSettings)
			.set({ koboldCppManagedModelTtlSecs: ttl })
			.where(eq(schema.koboldCppSettings.id, 1))
		const res: Sockets.KoboldCPP.SetModelTtl.Response = { success: true }
		emitToUser("koboldcpp:setModelTtl", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetSubprocessTimeout: Handler<
	Sockets.KoboldCPP.SetSubprocessTimeout.Params,
	Sockets.KoboldCPP.SetSubprocessTimeout.Response
> = {
	event: "koboldcpp:setSubprocessTimeout",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const secs = Math.max(0, Math.floor(params.timeoutSecs))
		await db
			.update(schema.koboldCppSettings)
			.set({ koboldCppManagedSubprocessTimeoutSecs: secs })
			.where(eq(schema.koboldCppSettings.id, 1))
		subprocessManager.setSubprocessTimeout(secs)
		const res: Sockets.KoboldCPP.SetSubprocessTimeout.Response = {
			success: true
		}
		emitToUser("koboldcpp:setSubprocessTimeout", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppListBinaryVariants: Handler<
	Sockets.KoboldCPP.ListBinaryVariants.Params,
	Sockets.KoboldCPP.ListBinaryVariants.Response
> = {
	event: "koboldcpp:listBinaryVariants",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")

		const { variants, releaseTag } = await binaryManager.listVariants(
			params.tag
		)
		const res: Sockets.KoboldCPP.ListBinaryVariants.Response = {
			variants,
			releaseTag,
			// Respect KOBOLDCPP_BINARY_DIR when set, so a fresh in-app download lands
			// in the same directory a Docker deployment was configured to expect.
			defaultDir:
				process.env.KOBOLDCPP_BINARY_DIR ||
				path.join(getAppDataDir(), "koboldcpp")
		}
		emitToUser("koboldcpp:listBinaryVariants", res)
		return res
	}
}

export const koboldCppListReleaseVersions: Handler<
	Sockets.KoboldCPP.ListReleaseVersions.Params,
	Sockets.KoboldCPP.ListReleaseVersions.Response
> = {
	event: "koboldcpp:listReleaseVersions",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")

		const versions = await binaryManager.listReleaseVersions(10)
		const res: Sockets.KoboldCPP.ListReleaseVersions.Response = { versions }
		emitToUser("koboldcpp:listReleaseVersions", res)
		return res
	}
}

export const koboldCppCheckManagedBinaryUpdate: Handler<
	Sockets.KoboldCPP.CheckManagedBinaryUpdate.Params,
	Sockets.KoboldCPP.CheckManagedBinaryUpdate.Response
> = {
	event: "koboldcpp:checkManagedBinaryUpdate",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")

		const settings = (await db.query.koboldCppSettings.findFirst())!
		const installedTag = settings.koboldCppManagedReleaseTag ?? null

		const ghResp = await fetch(
			"https://api.github.com/repos/LostRuins/koboldcpp/releases/latest",
			{ headers: { Accept: "application/vnd.github.v3+json" } }
		)
		if (!ghResp.ok) throw new Error(`GitHub API error: ${ghResp.status}`)
		const release = await ghResp.json()
		const latestTag: string = release.tag_name ?? ""
		const releaseUrl: string = release.html_url ?? ""

		const isUpdateAvailable =
			!!installedTag && !!latestTag
				? compareVersions(latestTag, installedTag) > 0
				: false

		const res: Sockets.KoboldCPP.CheckManagedBinaryUpdate.Response = {
			isUpdateAvailable,
			installedTag,
			latestTag,
			releaseUrl
		}
		emitToUser("koboldcpp:checkManagedBinaryUpdate", res)
		return res
	}
}

export const koboldCppDownloadBinary: Handler<
	Sockets.KoboldCPP.DownloadBinary.Params,
	Sockets.KoboldCPP.DownloadBinary.Response
> = {
	event: "koboldcpp:downloadBinary",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")

		// releaseTag flows into listVariants()'s GitHub API URL path below —
		// a value shaped like a legitimate tag but crafted otherwise could
		// retarget which release gets fetched, undermining the revalidation
		// this handler relies on.
		if (params.releaseTag && !/^[\w.-]+$/.test(params.releaseTag)) {
			throw new Error("Invalid release tag.")
		}

		// Never trust the client-supplied assetName/downloadUrl pairing
		// directly — without revalidating against the real GitHub release
		// list, an admin's session (or a forged socket emission) could point
		// the server at an arbitrary URL, which it would then download,
		// chmod +x, and (via the auto-start below) execute.
		const { variants } = await binaryManager.listVariants(params.releaseTag)
		const variant = variants.find((v) => v.name === params.assetName)
		if (!variant) {
			throw new Error(
				"That binary isn't part of the current release list."
			)
		}

		// Run async so we can return immediately
		;(async () => {
			try {
				await binaryManager.downloadVariant({
					assetName: variant.name,
					downloadUrl: variant.downloadUrl,
					destDir: params.destDir,
					sha256Url: variant.sha256Url
				})
				// Only record the binary as installed once the file is actually
				// on disk — persisting this before a successful download meant a
				// failed download (eg. a permissions error creating destDir)
				// still left settings claiming a binary was configured at a path
				// where nothing existed, so the next auto-start attempt would
				// fail with a confusing "Binary not found" and no download to retry.
				await db
					.update(schema.koboldCppSettings)
					.set({
						koboldCppManagedBinaryVariant: params.assetName,
						koboldCppManagedBinaryDir: params.destDir,
						koboldCppManagedReleaseTag: params.releaseTag
					})
					.where(eq(schema.koboldCppSettings.id, 1))
				// Auto-start subprocess after successful download
				await subprocessManager.start()
				// Update baseUrl to match managed port
				const settings = (await db.query.koboldCppSettings.findFirst())!
				const port = settings.koboldCppManagedPort ?? 5001
				await db
					.update(schema.koboldCppSettings)
					.set({
						koboldCppManagerBaseUrl: `http://localhost:${port}`
					})
					.where(eq(schema.koboldCppSettings.id, 1))
				await systemSettingsGet.handler(socket, {}, emitToUser)
			} catch (err: any) {
				console.error("[KoboldCPP binary download]", err.message)
			}
		})()

		const res: Sockets.KoboldCPP.DownloadBinary.Response = { success: true }
		emitToUser("koboldcpp:downloadBinary", res)
		return res
	}
}

export const koboldCppGetBinaryDownloadProgress: Handler<
	Sockets.KoboldCPP.GetBinaryDownloadProgress.Params,
	Sockets.KoboldCPP.GetBinaryDownloadProgress.Response
> = {
	event: "koboldcpp:getBinaryDownloadProgress",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res: Sockets.KoboldCPP.GetBinaryDownloadProgress.Response = {
			download: binaryManager.getDownloadState()
		}
		emitToUser("koboldcpp:getBinaryDownloadProgress", res)
		return res
	}
}

export const koboldCppCancelBinaryDownload: Handler<
	Sockets.KoboldCPP.CancelBinaryDownload.Params,
	Sockets.KoboldCPP.CancelBinaryDownload.Response
> = {
	event: "koboldcpp:cancelBinaryDownload",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		binaryManager.cancelDownload()
		const res: Sockets.KoboldCPP.CancelBinaryDownload.Response = {
			success: true
		}
		emitToUser("koboldcpp:cancelBinaryDownload", res)
		return res
	}
}

export const koboldCppStartSubprocess: Handler<
	Sockets.KoboldCPP.StartSubprocess.Params,
	Sockets.KoboldCPP.StartSubprocess.Response
> = {
	event: "koboldcpp:startSubprocess",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		subprocessManager.start().catch((err) => {
			console.error("[KoboldCPP startSubprocess]", err.message)
		})
		const res: Sockets.KoboldCPP.StartSubprocess.Response = {
			success: true
		}
		emitToUser("koboldcpp:startSubprocess", res)
		return res
	}
}

export const koboldCppStopSubprocess: Handler<
	Sockets.KoboldCPP.StopSubprocess.Params,
	Sockets.KoboldCPP.StopSubprocess.Response
> = {
	event: "koboldcpp:stopSubprocess",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			await subprocessManager.stop()
			const res: Sockets.KoboldCPP.StopSubprocess.Response = {
				success: true
			}
			emitToUser("koboldcpp:stopSubprocess", res)
			return res
		} catch (err: any) {
			// e.g. an adopted process we can't verify we own — surface the
			// reason instead of a bare "failed" with no explanation.
			const res: Sockets.KoboldCPP.StopSubprocess.Response = {
				success: false,
				error: err.message
			}
			emitToUser("koboldcpp:stopSubprocess", res)
			return res
		}
	}
}

export const koboldCppGetSubprocessStatus: Handler<
	Sockets.KoboldCPP.GetSubprocessStatus.Params,
	Sockets.KoboldCPP.GetSubprocessStatus.Response
> = {
	event: "koboldcpp:getSubprocessStatus",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res: Sockets.KoboldCPP.GetSubprocessStatus.Response = {
			status: subprocessManager.getStatus()
		}
		emitToUser("koboldcpp:getSubprocessStatus", res)
		return res
	}
}

export const koboldCppUnloadModel: Handler<
	Sockets.KoboldCPP.UnloadModel.Params,
	Sockets.KoboldCPP.UnloadModel.Response
> = {
	event: "koboldcpp:unloadModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = (await db.query.koboldCppSettings.findFirst())!
		const baseUrl = settings.koboldCppManagerBaseUrl
		const adminPassword = settings.koboldCppManagedAdminPassword ?? ""
		const success = await unloadModel(baseUrl, adminPassword)
		const res: Sockets.KoboldCPP.UnloadModel.Response = { success }
		emitToUser("koboldcpp:unloadModel", res)
		return res
	}
}

export const koboldCppUpdateManagerEnabled: Handler<
	Sockets.SystemSettings.UpdateKoboldCppManagerEnabled.Params,
	Sockets.SystemSettings.UpdateKoboldCppManagerEnabled.Response
> = {
	event: "systemSettings:updateKoboldCppManagerEnabled",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		if (params.enabled && isAndroidWrapper()) {
			throw new Error(
				"KoboldCPP Manager is not available in the Android app"
			)
		}
		await db
			.update(schema.koboldCppSettings)
			.set({ koboldCppManagerEnabled: params.enabled })
			.where(eq(schema.koboldCppSettings.id, 1))
		const res: Sockets.SystemSettings.UpdateKoboldCppManagerEnabled.Response =
			{ success: true, enabled: params.enabled }
		emitToUser("systemSettings:updateKoboldCppManagerEnabled", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppDeleteModelHandler: Handler<
	Sockets.KoboldCPP.DeleteModel.Params,
	Sockets.KoboldCPP.DeleteModel.Response
> = {
	event: "koboldcpp:deleteModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = (await db.query.koboldCppSettings.findFirst())!

		// The row's own kind picks which directory to look in FIRST; the resolve
		// then tries the other one, so a model still sitting in a legacy flat
		// install's single folder is deletable wherever it is. A row that says
		// "unknown" starts at the text directory — the order only decides which
		// stat runs first.
		const rec = await db.query.koboldCppModels.findFirst({
			where: eq(schema.koboldCppModels.filename, params.modelName)
		})
		const filePath = await resolveModelPath(
			rec?.kind === "image" ? "image" : "text",
			params.modelName,
			settings,
			{ mustExist: true }
		)

		await fsPromises.unlink(filePath)

		// Remove DB record and any connections pointing to this model — of
		// EITHER managed kind, since a connection names exactly one model and
		// both types name one by bare filename. Missing the image type would
		// leave a connection whose model file is gone, which fails at render
		// time with nothing on the Connections screen to explain it.
		//
		// connection_defaults.connection_id is ON DELETE SET NULL, so a deleted
		// image connection that held `text->image` releases the slot rather than
		// stranding it.
		await db
			.delete(schema.koboldCppModels)
			.where(eq(schema.koboldCppModels.filename, params.modelName))
		await db
			.delete(schema.connections)
			.where(
				and(
					inArray(schema.connections.type, [
						CONNECTION_TYPE.KOBOLDCPP_MANAGED,
						CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
					]),
					eq(schema.connections.model, params.modelName)
				)
			)

		await connectionsList.handler(socket, {}, emitToUser)
		// The text->image default may have just been released by the cascade
		// above, and capabilityDefaults rides on systemSettings:get.
		await systemSettingsGet.handler(socket, {}, emitToUser)

		const res: Sockets.KoboldCPP.DeleteModel.Response = { success: true }
		emitToUser("koboldcpp:deleteModel", res)
		return res
	}
}

/**
 * The user's answer for a file the classifier could not read.
 *
 * `kind_source: "user"` is the top of the trust order, so nothing automatic
 * ever overwrites it — including the re-sniff the next directory scan runs
 * against every row that was only measured, guessed at, or claimed by the folder
 * it turned up in.
 */
export const koboldCppSetModelKindHandler: Handler<
	Sockets.KoboldCPP.SetModelKind.Params,
	Sockets.KoboldCPP.SetModelKind.Response
> = {
	event: "koboldcpp:setModelKind",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		if (params.kind !== "text" && params.kind !== "image") {
			throw new Error("Invalid model kind")
		}
		const rec = await db.query.koboldCppModels.findFirst({
			where: eq(schema.koboldCppModels.filename, params.filename)
		})
		if (!rec) throw new Error("That model isn't installed")

		await db
			.update(schema.koboldCppModels)
			.set({ kind: params.kind, kindSource: "user" })
			.where(eq(schema.koboldCppModels.filename, params.filename))

		// No self-heal of an image connection that names this file. Calling it a
		// text model does not make koboldcpp's next TEXT load fail — the two
		// kinds never share a .kcpps — so an image connection left pointing at
		// it costs exactly the renders it was asked for, which is the user's own
		// override to undo. Deleting a connection out from under someone for
		// changing a label would be the surprising half.

		const res: Sockets.KoboldCPP.SetModelKind.Response = { success: true }
		emitToUser("koboldcpp:setModelKind", res)
		await koboldCppListModelsHandler.handler(socket, {}, emitToUser)
		return res
	}
}

export function registerKoboldCppHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, koboldCppUpdateManagerEnabled, emitToUser)
	register(socket, koboldCppSetBaseUrl, emitToUser)
	register(socket, koboldCppSetModelsDir, emitToUser)
	register(socket, koboldCppVersionHandler, emitToUser)
	register(socket, koboldCppIsUpdateAvailableHandler, emitToUser)
	register(socket, koboldCppListModelsHandler, emitToUser)
	register(socket, koboldCppLoadModelHandler, emitToUser)
	register(socket, koboldCppConnectModelHandler, emitToUser)
	register(socket, koboldCppConnectImageModelHandler, emitToUser)
	register(socket, koboldCppPerfHandler, emitToUser)
	register(socket, koboldCppGetLoadedConfigHandler, emitToUser)
	register(socket, koboldCppSearchModelsHandler, emitToUser)
	register(socket, koboldCppRecommendedModelsHandler, emitToUser)
	register(socket, koboldCppDownloadModelHandler, emitToUser)
	register(socket, koboldCppCancelDownloadHandler, emitToUser)
	register(socket, koboldCppGetDownloadProgressHandler, emitToUser)
	register(socket, koboldCppClearDownloadHistoryHandler, emitToUser)
	// Managed mode
	register(socket, koboldCppSetManagedMode, emitToUser)
	register(socket, koboldCppSetManagedPort, emitToUser)
	register(socket, koboldCppSetManagedBinaryDir, emitToUser)
	register(socket, koboldCppSetManagedAdminPassword, emitToUser)
	register(socket, koboldCppSetModelTtl, emitToUser)
	register(socket, koboldCppSetSubprocessTimeout, emitToUser)
	register(socket, koboldCppListBinaryVariants, emitToUser)
	register(socket, koboldCppListReleaseVersions, emitToUser)
	register(socket, koboldCppCheckManagedBinaryUpdate, emitToUser)
	register(socket, koboldCppDownloadBinary, emitToUser)
	register(socket, koboldCppGetBinaryDownloadProgress, emitToUser)
	register(socket, koboldCppCancelBinaryDownload, emitToUser)
	register(socket, koboldCppStartSubprocess, emitToUser)
	register(socket, koboldCppStopSubprocess, emitToUser)
	register(socket, koboldCppGetSubprocessStatus, emitToUser)
	register(socket, koboldCppUnloadModel, emitToUser)
	register(socket, koboldCppDeleteModelHandler, emitToUser)
	register(socket, koboldCppSetModelKindHandler, emitToUser)

	// Model-download/binary-download/subprocess-status telemetry, admin-only
	// (every handler in this module already self-checks isAdmin — this
	// registration function itself wasn't gated, which is what let the old
	// single-slot emitters get bound from a non-admin call in the first
	// place). Registered once per connection instead of re-bound from
	// individual handlers, so every connected admin keeps receiving updates
	// rather than the most recently (re)connected one silently taking over.
	if (socket.user?.isAdmin) {
		const userId: number = socket.user.id
		const downloadEmit = (
			data: Sockets.KoboldCPP.DownloadProgress.Response
		) => emitToUser("koboldcpp:downloadProgress", data)
		const binaryEmit = (d: any) =>
			emitToUser("koboldcpp:binaryDownloadProgress", d)
		const statusEmit = (s: any) =>
			emitToUser("koboldcpp:subprocessStatus", s)

		registerDownloadProgressEmitter(userId, downloadEmit)
		binaryManager.registerEmitter(userId, binaryEmit)
		subprocessManager.registerEmitter(userId, statusEmit)

		socket.on("disconnect", () => {
			unregisterDownloadProgressEmitter(userId)
			binaryManager.unregisterEmitter(userId)
			subprocessManager.unregisterEmitter(userId)
		})
	}
}
