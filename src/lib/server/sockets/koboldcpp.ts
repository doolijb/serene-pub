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
		await db
			.update(schema.koboldCppSettings)
			.set({ koboldCppManagerModelsDir: params.dir || null })
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
			return {
				version: "",
				isLocal: false,
				capabilities: {
					txt2img: false,
					vision: false,
					tts: false,
					transcribe: false,
					embeddings: false,
					multiplayer: false,
					websearch: false,
					adminEnabled: false
				}
			}
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = await response.json()
		const hostname = new URL(baseUrl).hostname
		const isLocal = ["localhost", "127.0.0.1", "::1"].includes(hostname)
		const res: Sockets.KoboldCPP.Version.Response = {
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
		const {
			koboldCppManagerBaseUrl: baseUrl,
			koboldCppManagerModelsDir: modelsDir
		} = settings

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

		// Scan modelsDir for .gguf files with sizes, skip incomplete downloads
		let availableModels: Sockets.KoboldCPP.ListModels.ModelFile[] = []
		if (modelsDir) {
			try {
				const entries = await fsPromises.readdir(modelsDir)
				const ggufFiles = entries.filter(
					(f) =>
						f.toLowerCase().endsWith(".gguf") &&
						!incompleteFilenames.has(f)
				)
				const ggufFileSet = new Set(ggufFiles)

				// Forget complete records for files removed outside the app —
				// the listing itself is always driven by the directory scan
				// above, so this only prevents koboldCppModels from
				// accumulating rows for files that no longer exist.
				const staleFilenames = dbModels
					.filter(
						(m) =>
							m.status === "complete" &&
							!ggufFileSet.has(m.filename)
					)
					.map((m) => m.filename)
				if (staleFilenames.length > 0) {
					await db
						.delete(schema.koboldCppModels)
						.where(
							inArray(
								schema.koboldCppModels.filename,
								staleFilenames
							)
						)
				}

				availableModels = await Promise.all(
					ggufFiles.map(async (name) => {
						let size = 0
						try {
							const stat = await fsPromises.stat(
								path.join(modelsDir, name)
							)
							size = stat.size
						} catch {}

						let rec = dbByFilename.get(name)
						if (!rec) {
							// Placed directly into the models folder rather than
							// downloaded through the UI — track it the same as a
							// completed download so it behaves consistently
							// everywhere else that reads this table.
							const [tracked] = await db
								.insert(schema.koboldCppModels)
								.values({
									filename: name,
									modelName: name.replace(/\.gguf$/i, ""),
									sizeBytes: size,
									status: "complete"
								})
								.onConflictDoUpdate({
									target: schema.koboldCppModels.filename,
									set: { filename: name }
								})
								.returning()
							rec = tracked
						}

						return {
							name,
							size,
							...(rec
								? {
										modelName: rec.modelName,
										modelUrl: rec.modelUrl ?? undefined,
										description:
											rec.description ?? undefined,
										quantization:
											rec.quantization ?? undefined,
										sizeBytes: rec.sizeBytes ?? undefined
									}
								: {})
						}
					})
				)
			} catch {
				// Dir doesn't exist yet
			}
		}

		const res: Sockets.KoboldCPP.ListModels.Response = {
			currentModel,
			availableModels,
			modelsDirSet: !!modelsDir
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
		const res: Sockets.KoboldCPP.GetLoadedConfig.Response = {
			config: signature
				? {
						model: signature.model,
						contextSize: signature.contextSize,
						gpuLayers: signature.gpuLayers,
						flashAttention: signature.flashAttention,
						batchSize: signature.batchSize,
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
let recommendedCache: {
	models: Sockets.KoboldCPP.RecommendedModels.RecommendedModel[]
	cachedAt: number
} | null = null

const GGUF_QUANT_RE = /^(Q|IQ|BF|F)\d/i

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

export const koboldCppRecommendedModelsHandler: Handler<
	Sockets.KoboldCPP.RecommendedModels.Params,
	Sockets.KoboldCPP.RecommendedModels.Response
> = {
	event: "koboldcpp:recommendedModels",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		if (
			recommendedCache &&
			Date.now() - recommendedCache.cachedAt < RECOMMENDED_CACHE_TTL_MS
		) {
			const res = { models: recommendedCache.models }
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

		recommendedCache = { models, cachedAt: Date.now() }

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
	if (
		now - (lastProgressEmitAt[filename] ?? 0) <
		PROGRESS_EMIT_THROTTLE_MS
	) {
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
		const response = await fetch(
			`https://huggingface.co/api/models?search=${encodeURIComponent(searchTerm)}&filter=gguf&limit=50&sort=trendingScore&full=True&config=True`
		)
		if (!response.ok)
			throw new Error(`Hugging Face API error: ${response.status}`)
		const data = await response.json()

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
						if (!isAllowedHuggingFaceHost(parsedRedirectUrl.hostname)) {
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
	const { resolvedUrl, total, destPath, filename, registerRequest, isAborted } =
		opts
	const chunkCount = Math.max(
		1,
		Math.ceil(total / PARALLEL_CHUNK_SIZE_BYTES)
	)
	const lib = resolvedUrl.startsWith("https") ? https : http
	const AgentCtor = resolvedUrl.startsWith("https")
		? https.Agent
		: http.Agent
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
		await Promise.all(
			Array.from({ length: workerCount }, () => worker())
		)
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
		const modelsDir = settings.koboldCppManagerModelsDir
		if (!modelsDir) throw new Error("Models directory not configured")

		await fsPromises.mkdir(modelsDir, { recursive: true })

		const {
			filename,
			downloadUrl,
			modelName,
			modelUrl,
			description,
			quantization,
			sizeBytes
		} = params
		const destPath = path.resolve(path.join(modelsDir, filename))
		const resolvedModelsDir = path.resolve(modelsDir)
		// filename is client-supplied — without containment, a path-traversal
		// or absolute-path filename could write outside modelsDir entirely.
		if (
			destPath !== resolvedModelsDir &&
			!destPath.startsWith(resolvedModelsDir + path.sep)
		) {
			throw new Error("Invalid filename")
		}

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
				status: "downloading"
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
					errorMessage: null
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
						const res = (resolved as Extract<
							ResolvedDownload,
							{ kind: "fallback" }
						>).initialResponse
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
				await db
					.update(schema.koboldCppModels)
					.set({ status: "complete" })
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
		const { variants } = await binaryManager.listVariants(
			params.releaseTag
		)
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
		const { koboldCppManagerModelsDir: modelsDir } =
			(await db.query.koboldCppSettings.findFirst())!
		if (!modelsDir) throw new Error("Models directory not configured")

		const filePath = path.resolve(path.join(modelsDir, params.modelName))
		const resolvedModelsDir = path.resolve(modelsDir)
		// Trailing separator matters here — without it, a sibling directory
		// like "models-evil" would pass a bare startsWith(modelsDir) check.
		if (
			filePath !== resolvedModelsDir &&
			!filePath.startsWith(resolvedModelsDir + path.sep)
		) {
			throw new Error("Invalid path")
		}

		await fsPromises.unlink(filePath)

		// Remove DB record and any connections pointing to this model
		await db
			.delete(schema.koboldCppModels)
			.where(eq(schema.koboldCppModels.filename, params.modelName))
		await db
			.delete(schema.connections)
			.where(
				and(
					eq(
						schema.connections.type,
						CONNECTION_TYPE.KOBOLDCPP_MANAGED
					),
					eq(schema.connections.model, params.modelName)
				)
			)
		await connectionsList.handler(socket, {}, emitToUser)

		const res: Sockets.KoboldCPP.DeleteModel.Response = { success: true }
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

	// Model-download/binary-download/subprocess-status telemetry, admin-only
	// (every handler in this module already self-checks isAdmin — this
	// registration function itself wasn't gated, which is what let the old
	// single-slot emitters get bound from a non-admin call in the first
	// place). Registered once per connection instead of re-bound from
	// individual handlers, so every connected admin keeps receiving updates
	// rather than the most recently (re)connected one silently taking over.
	if (socket.user?.isAdmin) {
		const userId: number = socket.user.id
		const downloadEmit = (data: Sockets.KoboldCPP.DownloadProgress.Response) =>
			emitToUser("koboldcpp:downloadProgress", data)
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
