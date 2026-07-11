import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { InsertConnection } from "$lib/server/db/schema"
import { eq, and } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { connectionsList, connectionsSetUserActive } from "./connections"
import { systemSettingsGet } from "./systemSettings"
import { getAppDataDir } from "$lib/server/db/drizzle.config"
import koboldCppManagedAdapter from "$lib/server/connectionAdapters/KoboldCppManagedAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import * as https from "https"
import * as http from "http"
import { randomUUID } from "crypto"
import * as subprocessManager from "$lib/server/koboldcpp/subprocessManager"
import * as binaryManager from "$lib/server/koboldcpp/binaryManager"
import { unloadModel } from "$lib/server/koboldcpp/modelManager"

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
	Sockets.KoboldCpp.SetBaseUrl.Params,
	Sockets.KoboldCpp.SetBaseUrl.Response
> = {
	event: "koboldcpp:setBaseUrl",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const url = new URL(params.baseUrl)
		if (!["http:", "https:"].includes(url.protocol)) {
			emitToUser("koboldcpp:setBaseUrl:error", { error: "Invalid URL protocol" })
			throw new Error("Invalid URL protocol")
		}

		await db
			.update(schema.koboldCppSettings)
			.set({ koboldCppManagerBaseUrl: params.baseUrl })
			.where(eq(schema.koboldCppSettings.id, 1))

		const res: Sockets.KoboldCpp.SetBaseUrl.Response = { success: true }
		emitToUser("koboldcpp:setBaseUrl", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetModelsDir: Handler<
	Sockets.KoboldCpp.SetModelsDir.Params,
	Sockets.KoboldCpp.SetModelsDir.Response
> = {
	event: "koboldcpp:setModelsDir",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		await db
			.update(schema.koboldCppSettings)
			.set({ koboldCppManagerModelsDir: params.dir || null })
			.where(eq(schema.koboldCppSettings.id, 1))
		const res: Sockets.KoboldCpp.SetModelsDir.Response = { success: true }
		emitToUser("koboldcpp:setModelsDir", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppVersionHandler: Handler<
	Sockets.KoboldCpp.Version.Params,
	Sockets.KoboldCpp.Version.Response
> = {
	event: "koboldcpp:version",
	handler: async (socket, params, emitToUser) => {
		const { koboldCppManagerBaseUrl: baseUrl } =
			(await db.query.koboldCppSettings.findFirst())!

		const response = await fetch(`${baseUrl}/api/extra/version`, {
			signal: AbortSignal.timeout(5000)
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = await response.json()
		const hostname = new URL(baseUrl).hostname
		const isLocal = ["localhost", "127.0.0.1", "::1"].includes(hostname)
		const res: Sockets.KoboldCpp.Version.Response = {
			version: data.version || "unknown",
			isLocal,
			capabilities: {
				txt2img: !!data.txt2img,
				vision: !!data.vision,
				tts: !!data.tts,
				transcribe: !!data.transcribe,
				embeddings: !!data.embeddings,
				multiplayer: !!data.multiplayer,
				websearch: !!data.websearch,
				adminEnabled: !!data.admin
			}
		}
		emitToUser("koboldcpp:version", res)
		return res
	}
}

export const koboldCppIsUpdateAvailableHandler: Handler<
	Sockets.KoboldCpp.IsUpdateAvailable.Params,
	Sockets.KoboldCpp.IsUpdateAvailable.Response
> = {
	event: "koboldcpp:isUpdateAvailable",
	handler: async (socket, params, emitToUser) => {
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

		const res: Sockets.KoboldCpp.IsUpdateAvailable.Response = {
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
	Sockets.KoboldCpp.ListModels.Params,
	Sockets.KoboldCpp.ListModels.Response
> = {
	event: "koboldcpp:listModels",
	handler: async (socket, params, emitToUser) => {
		const settings = (await db.query.koboldCppSettings.findFirst())!
		const { koboldCppManagerBaseUrl: baseUrl, koboldCppManagerModelsDir: modelsDir } = settings

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
			dbModels.filter((m) => m.status !== "complete").map((m) => m.filename)
		)

		// Scan modelsDir for .gguf files with sizes, skip incomplete downloads
		let availableModels: Sockets.KoboldCpp.ListModels.ModelFile[] = []
		if (modelsDir) {
			try {
				const entries = await fsPromises.readdir(modelsDir)
				const ggufFiles = entries.filter(
					(f) => f.toLowerCase().endsWith(".gguf") && !incompleteFilenames.has(f)
				)
				availableModels = await Promise.all(
					ggufFiles.map(async (name) => {
						let size = 0
						try {
							const stat = await fsPromises.stat(path.join(modelsDir, name))
							size = stat.size
						} catch {}
						const rec = dbByFilename.get(name)
						return {
							name,
							size,
							...(rec ? {
								modelName: rec.modelName,
								modelUrl: rec.modelUrl ?? undefined,
								description: rec.description ?? undefined,
								quantization: rec.quantization ?? undefined,
								sizeBytes: rec.sizeBytes ?? undefined
							} : {})
						}
					})
				)
			} catch {
				// Dir doesn't exist yet
			}
		}

		const res: Sockets.KoboldCpp.ListModels.Response = {
			currentModel,
			availableModels,
			modelsDirSet: !!modelsDir
		}
		emitToUser("koboldcpp:listModels", res)
		return res
	}
}

export const koboldCppLoadModelHandler: Handler<
	Sockets.KoboldCpp.LoadModel.Params,
	Sockets.KoboldCpp.LoadModel.Response
> = {
	event: "koboldcpp:loadModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const { koboldCppManagerBaseUrl: baseUrl, koboldCppManagedAdminPassword: adminPassword } =
			(await db.query.koboldCppSettings.findFirst())!

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
			throw new Error("reload_config rejected the request (success: false)")
		}

		const res: Sockets.KoboldCpp.LoadModel.Response = {
			success: `Model "${params.filename}" loaded successfully`
		}
		emitToUser("koboldcpp:loadModel", res)
		return res
	}
}

export const koboldCppConnectModelHandler: Handler<
	Sockets.KoboldCpp.ConnectModel.Params,
	Sockets.KoboldCpp.ConnectModel.Response
> = {
	event: "koboldcpp:connectModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = (await db.query.koboldCppSettings.findFirst())!
		if (!settings.koboldCppManagerEnabled) {
			throw new Error("KoboldCpp Manager is disabled")
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
				name: connectionName,
				model: params.modelName,
				baseUrl,
				extraJson: { ...koboldCppManagedAdapter.connectionDefaults.extraJson }
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

		const res: Sockets.KoboldCpp.ConnectModel.Response = {
			success: "Model set as default"
		}
		emitToUser("koboldcpp:connectModel", res)
		return res
	}
}

export const koboldCppPerfHandler: Handler<
	Sockets.KoboldCpp.Perf.Params,
	Sockets.KoboldCpp.Perf.Response
> = {
	event: "koboldcpp:perf",
	handler: async (socket, params, emitToUser) => {
		const { koboldCppManagerBaseUrl: baseUrl } =
			(await db.query.koboldCppSettings.findFirst())!

		const response = await fetch(`${baseUrl}/api/extra/perf`, {
			signal: AbortSignal.timeout(5000)
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = await response.json()
		const res: Sockets.KoboldCpp.Perf.Response = {
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

// --- RECOMMENDED MODELS (cached to avoid hammering HF on every open) ---

const RECOMMENDED_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
let recommendedCache: { models: Sockets.KoboldCpp.RecommendedModels.RecommendedModel[]; cachedAt: number } | null = null

const GGUF_QUANT_RE = /^(Q|IQ|BF|F)\d/i

async function fetchRecommendedYaml(): Promise<Array<{ name: string; pull: string; recommended_vram: number; details: { parameter_size: string; description: string } }>> {
	const resp = await fetch("https://raw.githubusercontent.com/doolijb/serene-pub-gguf-list/main/recommended.yaml")
	if (!resp.ok) throw new Error(`YAML fetch failed: ${resp.status}`)
	const text = await resp.text()

	const models: any[] = []
	let cur: any = null
	let inDetails = false
	for (const line of text.split("\n")) {
		const t = line.trim()
		if (t.startsWith("- name:")) {
			if (cur) models.push(cur)
			cur = { name: t.replace("- name:", "").trim(), pull: "", recommended_vram: 0, details: { parameter_size: "", description: "" } }
			inDetails = false
		} else if (cur) {
			if (t.startsWith("pull:")) cur.pull = t.replace("pull:", "").trim()
			else if (t.startsWith("recommended_vram:")) cur.recommended_vram = parseInt(t.replace("recommended_vram:", "").trim()) || 0
			else if (t === "details:") inDetails = true
			else if (inDetails) {
				if (t.startsWith("parameter_size:")) cur.details.parameter_size = t.replace("parameter_size:", "").trim().replace(/"/g, "")
				else if (t.startsWith("description:")) cur.details.description = t.replace("description:", "").trim().replace(/"/g, "")
			}
		}
	}
	if (cur) models.push(cur)
	return models
}

async function resolveHfModel(ollamaName: string): Promise<Sockets.KoboldCpp.SearchModels.ModelResult | null> {
	try {
		const resp = await fetch(
			`https://huggingface.co/api/models?search=${encodeURIComponent(ollamaName)}&filter=gguf&limit=5&sort=downloads&full=True&config=True`,
			{ signal: AbortSignal.timeout(10_000) }
		)
		if (!resp.ok) return null
		const data: any[] = await resp.json()

		for (const m of data) {
			if (m.private || m.gated === true || m.gated === "auto") continue
			const pullOptions: Sockets.KoboldCpp.SearchModels.PullOption[] = (m.siblings as any[])
				.filter((s: any) => s.rfilename.endsWith(".gguf"))
				.filter((s: any) => GGUF_QUANT_RE.test(s.rfilename.replace(".gguf", "").split("-").pop()?.toUpperCase() ?? ""))
				.map((s: any) => ({
					label: s.rfilename.replace(".gguf", "").split("-").pop() ?? s.rfilename,
					filename: s.rfilename,
					downloadUrl: `https://huggingface.co/${m.id}/resolve/main/${s.rfilename}`,
					sizeBytes: typeof s.size === "number" ? s.size : undefined
				}))
			if (pullOptions.length > 0) {
				return {
					name: m.id,
					description: m.description || m.pipeline_tag,
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

export const koboldCppRecommendedModelsHandler: Handler<
	Sockets.KoboldCpp.RecommendedModels.Params,
	Sockets.KoboldCpp.RecommendedModels.Response
> = {
	event: "koboldcpp:recommendedModels",
	handler: async (socket, params, emitToUser) => {
		if (recommendedCache && Date.now() - recommendedCache.cachedAt < RECOMMENDED_CACHE_TTL_MS) {
			const res = { models: recommendedCache.models }
			emitToUser("koboldcpp:recommendedModels", res)
			return res
		}

		const yamlModels = await fetchRecommendedYaml()

		const settled = await Promise.allSettled(
			yamlModels.map(async (ym) => {
				const hf = await resolveHfModel(ym.name)
				if (!hf) return null
				return {
					...hf,
					ollamaName: ym.name,
					recommendedVram: ym.recommended_vram || undefined,
					parameterSize: ym.details.parameter_size || undefined,
					description: hf.description || ym.details.description || undefined
				} satisfies Sockets.KoboldCpp.RecommendedModels.RecommendedModel
			})
		)

		const models = settled
			.filter((r): r is PromiseFulfilledResult<Sockets.KoboldCpp.RecommendedModels.RecommendedModel> =>
				r.status === "fulfilled" && r.value !== null
			)
			.map((r) => r.value)

		recommendedCache = { models, cachedAt: Date.now() }

		const res: Sockets.KoboldCpp.RecommendedModels.Response = { models }
		emitToUser("koboldcpp:recommendedModels", res)
		return res
	}
}

// --- DOWNLOAD STATE (module-level so downloads survive tab changes) ---

type DownloadEntry = Sockets.KoboldCpp.DownloadProgress.DownloadEntry & { abort?: () => void }
let activeDownloads: Record<string, DownloadEntry> = {}
let emitDownloadProgressFn: ((data: Sockets.KoboldCpp.DownloadProgress.Response) => void) | null = null

function emitDownloadProgress() {
	if (!emitDownloadProgressFn) return
	const downloads: Sockets.KoboldCpp.DownloadProgress.Response["downloads"] = {}
	for (const [key, entry] of Object.entries(activeDownloads)) {
		const { abort: _abort, ...rest } = entry
		downloads[key] = rest
	}
	emitDownloadProgressFn({ downloads })
}

export const koboldCppSearchModelsHandler: Handler<
	Sockets.KoboldCpp.SearchModels.Params,
	Sockets.KoboldCpp.SearchModels.Response
> = {
	event: "koboldcpp:searchModels",
	handler: async (socket, params, emitToUser) => {
		const { searchTerm } = params
		const response = await fetch(
			`https://huggingface.co/api/models?search=${encodeURIComponent(searchTerm)}&filter=gguf&limit=50&sort=trendingScore&full=True&config=True`
		)
		if (!response.ok) throw new Error(`Hugging Face API error: ${response.status}`)
		const data = await response.json()

		const models = (data as any[])
			.filter((m) => !m.private && m.gated !== true && m.gated !== "auto")
			.map((m) => {
				const ggufFiles = (m.siblings as any[]).filter((s: any) =>
					s.rfilename.endsWith(".gguf")
				)
				const pullOptions: Sockets.KoboldCpp.SearchModels.PullOption[] = ggufFiles
					.filter((s: any) => {
						const stem = s.rfilename.replace(".gguf", "").split("-").pop()?.toUpperCase() ?? ""
						return /^(Q|IQ|BF|F)\d/.test(stem)
					})
					.map((s: any) => ({
						label: s.rfilename.replace(".gguf", "").split("-").pop() ?? s.rfilename,
						filename: s.rfilename,
						downloadUrl: `https://huggingface.co/${m.id}/resolve/main/${s.rfilename}`,
						sizeBytes: typeof s.size === "number" ? s.size : undefined
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

		const res: Sockets.KoboldCpp.SearchModels.Response = { models }
		emitToUser("koboldcpp:searchModels", res)
		return res
	}
}

export const koboldCppDownloadModelHandler: Handler<
	Sockets.KoboldCpp.DownloadModel.Params,
	Sockets.KoboldCpp.DownloadModel.Response
> = {
	event: "koboldcpp:downloadModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = (await db.query.koboldCppSettings.findFirst())!
		const modelsDir = settings.koboldCppManagerModelsDir
		if (!modelsDir) throw new Error("Models directory not configured")

		await fsPromises.mkdir(modelsDir, { recursive: true })

		const { filename, downloadUrl, modelName, modelUrl, description, quantization, sizeBytes } = params
		const destPath = path.join(modelsDir, filename)

		if (activeDownloads[filename] && !activeDownloads[filename].isDone) {
			emitToUser("koboldcpp:downloadModel:error", { error: "Already downloading this file" })
			return { success: false }
		}

		// Upsert DB record before starting so the file is excluded from the available list immediately
		await db.insert(schema.koboldCppModels)
			.values({ filename, modelName, modelUrl, description, quantization, sizeBytes: sizeBytes ?? null, downloadUrl, status: "downloading" })
			.onConflictDoUpdate({ target: schema.koboldCppModels.filename, set: { modelName, modelUrl, description, quantization, sizeBytes: sizeBytes ?? null, downloadUrl, status: "downloading", errorMessage: null } })

		// Bind the emitter so progress events reach this user
		emitDownloadProgressFn = (data) => emitToUser("koboldcpp:downloadProgress", data)

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
			try {
				await new Promise<void>((resolve, reject) => {
					const urlObj = new URL(downloadUrl)
					const lib = urlObj.protocol === "https:" ? https : http
					const req = lib.get(downloadUrl, (res) => {
						if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
							// Follow redirect
							const redirectUrl = res.headers.location
							const rLib = redirectUrl.startsWith("https") ? https : http
							rLib.get(redirectUrl, (rRes) => {
								const total = parseInt(rRes.headers["content-length"] ?? "0", 10)
								activeDownloads[filename].total = total
								activeDownloads[filename].status = "downloading"
								const writer = fs.createWriteStream(destPath)
								rRes.on("data", (chunk: Buffer) => {
									activeDownloads[filename].downloaded += chunk.length
									emitDownloadProgress()
								})
								rRes.pipe(writer)
								writer.on("finish", resolve)
								writer.on("error", reject)
								rRes.on("error", reject)
							}).on("error", reject)
							return
						}
						const total = parseInt(res.headers["content-length"] ?? "0", 10)
						activeDownloads[filename].total = total
						activeDownloads[filename].status = "downloading"
						const writer = fs.createWriteStream(destPath)
						res.on("data", (chunk: Buffer) => {
							activeDownloads[filename].downloaded += chunk.length
							emitDownloadProgress()
						})
						res.pipe(writer)
						writer.on("finish", resolve)
						writer.on("error", reject)
						res.on("error", reject)
					})
					req.on("error", reject)
					activeDownloads[filename].abort = () => {
						req.destroy()
						reject(new Error("cancelled"))
					}
				})

				activeDownloads[filename].status = "success"
				activeDownloads[filename].isDone = true
				emitDownloadProgress()
				await db.update(schema.koboldCppModels)
					.set({ status: "complete" })
					.where(eq(schema.koboldCppModels.filename, filename))
			} catch (err: any) {
				const isCancelled = err.message === "cancelled"
				activeDownloads[filename].status = isCancelled ? "cancelled" : "error"
				activeDownloads[filename].isDone = true
				if (isCancelled) {
					// Clean up partial file and DB record
					fsPromises.unlink(destPath).catch(() => {})
					db.delete(schema.koboldCppModels)
						.where(eq(schema.koboldCppModels.filename, filename))
						.catch(() => {})
				} else {
					await db.update(schema.koboldCppModels)
						.set({ status: "error", errorMessage: err.message ?? "Unknown error" })
						.where(eq(schema.koboldCppModels.filename, filename))
				}
				emitDownloadProgress()
			}
		})()

		const res: Sockets.KoboldCpp.DownloadModel.Response = { success: true }
		emitToUser("koboldcpp:downloadModel", res)
		return res
	}
}

export const koboldCppCancelDownloadHandler: Handler<
	Sockets.KoboldCpp.CancelDownload.Params,
	Sockets.KoboldCpp.CancelDownload.Response
> = {
	event: "koboldcpp:cancelDownload",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const entry = activeDownloads[params.filename]
		if (entry && !entry.isDone && entry.abort) {
			entry.abort()
		}
		const res: Sockets.KoboldCpp.CancelDownload.Response = { success: true }
		emitToUser("koboldcpp:cancelDownload", res)
		return res
	}
}

export const koboldCppGetDownloadProgressHandler: Handler<
	Sockets.KoboldCpp.GetDownloadProgress.Params,
	Sockets.KoboldCpp.GetDownloadProgress.Response
> = {
	event: "koboldcpp:getDownloadProgress",
	handler: async (socket, params, emitToUser) => {
		// Re-bind emitter on reconnect
		emitDownloadProgressFn = (data) => emitToUser("koboldcpp:downloadProgress", data)
		const downloads: Sockets.KoboldCpp.GetDownloadProgress.Response["downloads"] = {}
		for (const [key, entry] of Object.entries(activeDownloads)) {
			const { abort: _abort, ...rest } = entry
			downloads[key] = rest
		}
		const res: Sockets.KoboldCpp.GetDownloadProgress.Response = { downloads }
		emitToUser("koboldcpp:getDownloadProgress", res)
		return res
	}
}

export const koboldCppClearDownloadHistoryHandler: Handler<
	Sockets.KoboldCpp.ClearDownloadHistory.Params,
	Sockets.KoboldCpp.ClearDownloadHistory.Response
> = {
	event: "koboldcpp:clearDownloadHistory",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		for (const key of Object.keys(activeDownloads)) {
			if (activeDownloads[key].isDone) delete activeDownloads[key]
		}
		const res: Sockets.KoboldCpp.ClearDownloadHistory.Response = { success: true }
		emitToUser("koboldcpp:clearDownloadHistory", res)
		return res
	}
}

// --- MANAGED MODE HANDLERS ---

export const koboldCppSetManagedMode: Handler<
	Sockets.KoboldCpp.SetManagedMode.Params,
	Sockets.KoboldCpp.SetManagedMode.Response
> = {
	event: "koboldcpp:setManagedMode",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = (await db.query.koboldCppSettings.findFirst())!

		let adminPassword = settings.koboldCppManagedAdminPassword
		if (params.mode === "managed" && !adminPassword) {
			adminPassword = randomUUID().replace(/-/g, "")
		}

		await db.update(schema.koboldCppSettings).set({
			koboldCppManagedMode: params.mode,
			...(adminPassword ? { koboldCppManagedAdminPassword: adminPassword } : {})
		})

		// Stop subprocess if switching away from managed
		if (params.mode !== "managed" && subprocessManager.isRunning()) {
			subprocessManager.stop().catch(() => {})
		}

		const res: Sockets.KoboldCpp.SetManagedMode.Response = { success: true }
		emitToUser("koboldcpp:setManagedMode", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetManagedPort: Handler<
	Sockets.KoboldCpp.SetManagedPort.Params,
	Sockets.KoboldCpp.SetManagedPort.Response
> = {
	event: "koboldcpp:setManagedPort",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const port = Math.max(1024, Math.min(65535, Math.floor(params.port)))
		await db.update(schema.koboldCppSettings).set({
			koboldCppManagedPort: port,
			koboldCppManagerBaseUrl: `http://localhost:${port}`
		})
		const res: Sockets.KoboldCpp.SetManagedPort.Response = { success: true }
		emitToUser("koboldcpp:setManagedPort", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetManagedBinaryDir: Handler<
	Sockets.KoboldCpp.SetManagedBinaryDir.Params,
	Sockets.KoboldCpp.SetManagedBinaryDir.Response
> = {
	event: "koboldcpp:setManagedBinaryDir",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		await db.update(schema.koboldCppSettings).set({ koboldCppManagedBinaryDir: params.dir || null })
		const res: Sockets.KoboldCpp.SetManagedBinaryDir.Response = { success: true }
		emitToUser("koboldcpp:setManagedBinaryDir", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetModelTtl: Handler<
	Sockets.KoboldCpp.SetModelTtl.Params,
	Sockets.KoboldCpp.SetModelTtl.Response
> = {
	event: "koboldcpp:setModelTtl",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const ttl = Math.max(0, Math.floor(params.ttlSecs))
		await db.update(schema.koboldCppSettings).set({ koboldCppManagedModelTtlSecs: ttl })
		const res: Sockets.KoboldCpp.SetModelTtl.Response = { success: true }
		emitToUser("koboldcpp:setModelTtl", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppSetSubprocessTimeout: Handler<
	Sockets.KoboldCpp.SetSubprocessTimeout.Params,
	Sockets.KoboldCpp.SetSubprocessTimeout.Response
> = {
	event: "koboldcpp:setSubprocessTimeout",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const secs = Math.max(0, Math.floor(params.timeoutSecs))
		await db.update(schema.koboldCppSettings).set({ koboldCppManagedSubprocessTimeoutSecs: secs })
		subprocessManager.setSubprocessTimeout(secs)
		const res: Sockets.KoboldCpp.SetSubprocessTimeout.Response = { success: true }
		emitToUser("koboldcpp:setSubprocessTimeout", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppListBinaryVariants: Handler<
	Sockets.KoboldCpp.ListBinaryVariants.Params,
	Sockets.KoboldCpp.ListBinaryVariants.Response
> = {
	event: "koboldcpp:listBinaryVariants",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")

		const { variants, releaseTag } = await binaryManager.listVariants(params.tag)
		const res: Sockets.KoboldCpp.ListBinaryVariants.Response = {
			variants,
			releaseTag,
			defaultDir: path.join(getAppDataDir(), "koboldcpp")
		}
		emitToUser("koboldcpp:listBinaryVariants", res)
		return res
	}
}

export const koboldCppListReleaseVersions: Handler<
	Sockets.KoboldCpp.ListReleaseVersions.Params,
	Sockets.KoboldCpp.ListReleaseVersions.Response
> = {
	event: "koboldcpp:listReleaseVersions",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")

		const versions = await binaryManager.listReleaseVersions(10)
		const res: Sockets.KoboldCpp.ListReleaseVersions.Response = { versions }
		emitToUser("koboldcpp:listReleaseVersions", res)
		return res
	}
}

export const koboldCppCheckManagedBinaryUpdate: Handler<
	Sockets.KoboldCpp.CheckManagedBinaryUpdate.Params,
	Sockets.KoboldCpp.CheckManagedBinaryUpdate.Response
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
			!!installedTag && !!latestTag ? compareVersions(latestTag, installedTag) > 0 : false

		const res: Sockets.KoboldCpp.CheckManagedBinaryUpdate.Response = {
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
	Sockets.KoboldCpp.DownloadBinary.Params,
	Sockets.KoboldCpp.DownloadBinary.Response
> = {
	event: "koboldcpp:downloadBinary",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")

		binaryManager.setEmitter((d) => emitToUser("koboldcpp:binaryDownloadProgress", d))

		// Persist the chosen variant + dir + version now so it can be resumed/referenced
		await db.update(schema.koboldCppSettings).set({
			koboldCppManagedBinaryVariant: params.assetName,
			koboldCppManagedBinaryDir: params.destDir,
			koboldCppManagedReleaseTag: params.releaseTag
		})

		// Run async so we can return immediately
		;(async () => {
			try {
				await binaryManager.downloadVariant({
					assetName: params.assetName,
					downloadUrl: params.downloadUrl,
					destDir: params.destDir
				})
				// Auto-start subprocess after successful download
				await subprocessManager.start()
				// Update baseUrl to match managed port
				const settings = (await db.query.koboldCppSettings.findFirst())!
				const port = settings.koboldCppManagedPort ?? 5001
				await db.update(schema.koboldCppSettings).set({
					koboldCppManagerBaseUrl: `http://localhost:${port}`
				})
				await systemSettingsGet.handler(socket, {}, emitToUser)
			} catch (err: any) {
				console.error("[KoboldCPP binary download]", err.message)
			}
		})()

		const res: Sockets.KoboldCpp.DownloadBinary.Response = { success: true }
		emitToUser("koboldcpp:downloadBinary", res)
		return res
	}
}

export const koboldCppGetBinaryDownloadProgress: Handler<
	Sockets.KoboldCpp.GetBinaryDownloadProgress.Params,
	Sockets.KoboldCpp.GetBinaryDownloadProgress.Response
> = {
	event: "koboldcpp:getBinaryDownloadProgress",
	handler: async (socket, params, emitToUser) => {
		binaryManager.setEmitter((d) => emitToUser("koboldcpp:binaryDownloadProgress", d))
		const res: Sockets.KoboldCpp.GetBinaryDownloadProgress.Response = {
			download: binaryManager.getDownloadState()
		}
		emitToUser("koboldcpp:getBinaryDownloadProgress", res)
		return res
	}
}

export const koboldCppCancelBinaryDownload: Handler<
	Sockets.KoboldCpp.CancelBinaryDownload.Params,
	Sockets.KoboldCpp.CancelBinaryDownload.Response
> = {
	event: "koboldcpp:cancelBinaryDownload",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		binaryManager.cancelDownload()
		const res: Sockets.KoboldCpp.CancelBinaryDownload.Response = { success: true }
		emitToUser("koboldcpp:cancelBinaryDownload", res)
		return res
	}
}

export const koboldCppStartSubprocess: Handler<
	Sockets.KoboldCpp.StartSubprocess.Params,
	Sockets.KoboldCpp.StartSubprocess.Response
> = {
	event: "koboldcpp:startSubprocess",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		subprocessManager.setEmitter((s) => emitToUser("koboldcpp:subprocessStatus", s))
		subprocessManager.start().catch((err) => {
			console.error("[KoboldCPP startSubprocess]", err.message)
		})
		const res: Sockets.KoboldCpp.StartSubprocess.Response = { success: true }
		emitToUser("koboldcpp:startSubprocess", res)
		return res
	}
}

export const koboldCppStopSubprocess: Handler<
	Sockets.KoboldCpp.StopSubprocess.Params,
	Sockets.KoboldCpp.StopSubprocess.Response
> = {
	event: "koboldcpp:stopSubprocess",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		await subprocessManager.stop()
		const res: Sockets.KoboldCpp.StopSubprocess.Response = { success: true }
		emitToUser("koboldcpp:stopSubprocess", res)
		return res
	}
}

export const koboldCppGetSubprocessStatus: Handler<
	Sockets.KoboldCpp.GetSubprocessStatus.Params,
	Sockets.KoboldCpp.GetSubprocessStatus.Response
> = {
	event: "koboldcpp:getSubprocessStatus",
	handler: async (socket, params, emitToUser) => {
		subprocessManager.setEmitter((s) => emitToUser("koboldcpp:subprocessStatus", s))
		const res: Sockets.KoboldCpp.GetSubprocessStatus.Response = {
			status: subprocessManager.getStatus()
		}
		emitToUser("koboldcpp:getSubprocessStatus", res)
		return res
	}
}

export const koboldCppUnloadModel: Handler<
	Sockets.KoboldCpp.UnloadModel.Params,
	Sockets.KoboldCpp.UnloadModel.Response
> = {
	event: "koboldcpp:unloadModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = (await db.query.koboldCppSettings.findFirst())!
		const baseUrl = settings.koboldCppManagerBaseUrl
		const adminPassword = settings.koboldCppManagedAdminPassword ?? ""
		const success = await unloadModel(baseUrl, adminPassword)
		const res: Sockets.KoboldCpp.UnloadModel.Response = { success }
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
		await db.update(schema.koboldCppSettings).set({ koboldCppManagerEnabled: params.enabled }).where(eq(schema.koboldCppSettings.id, 1))
		const res: Sockets.SystemSettings.UpdateKoboldCppManagerEnabled.Response = { success: true, enabled: params.enabled }
		emitToUser("systemSettings:updateKoboldCppManagerEnabled", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const koboldCppDeleteModelHandler: Handler<
	Sockets.KoboldCpp.DeleteModel.Params,
	Sockets.KoboldCpp.DeleteModel.Response
> = {
	event: "koboldcpp:deleteModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const { koboldCppManagerModelsDir: modelsDir } = (await db.query.koboldCppSettings.findFirst())!
		if (!modelsDir) throw new Error("Models directory not configured")

		const filePath = path.resolve(path.join(modelsDir, params.modelName))
		if (!filePath.startsWith(path.resolve(modelsDir))) throw new Error("Invalid path")

		await fsPromises.unlink(filePath)

		// Remove DB record and any connections pointing to this model
		await db.delete(schema.koboldCppModels).where(eq(schema.koboldCppModels.filename, params.modelName))
		await db.delete(schema.connections).where(
			and(
				eq(schema.connections.type, CONNECTION_TYPE.KOBOLDCPP_MANAGED),
				eq(schema.connections.model, params.modelName)
			)
		)
		await connectionsList.handler(socket, {}, emitToUser)

		const res: Sockets.KoboldCpp.DeleteModel.Response = { success: true }
		emitToUser("koboldcpp:deleteModel", res)
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
	register(socket, koboldCppPerfHandler, emitToUser)
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
}
