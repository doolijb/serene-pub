import {
	chatEntries,
	embeddingEntries,
	fetchRecommendedGguf
} from "$lib/server/connections/recommendedGguf"
import { db } from "$lib/server/db"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
// InsertConnection is declared globally in $lib/server/db/types.d.ts (ambient
// `export global {}` block, same pattern as the Sockets namespace) — no
// import needed/available for it.
import { user as loadUser } from "./users"
import { buildConnectionsList, connectionsSetDefault } from "./connections"
import { Ollama } from "ollama"
import ollamaAdapter from "$lib/server/connectionAdapters/OllamaAdapter"
import { OllamaModelSearchSource } from "$lib/shared/constants/OllamaModelSource"
import { emit } from "process"
import { isAndroidWrapper } from "$lib/server/utils"
import type { Handler } from "$lib/shared/events"
import { loginRateLimit } from "$lib/server/services/loginRateLimit"
import { resolveConnectionCapabilities } from "$lib/server/connections/resolve"
import {
	endpointIdsServingModel,
	ensureConnectionModel,
	forgetModelEverywhere
} from "$lib/server/connections/models"
import { withStarConsequences } from "$lib/server/connections/starConsequences"
import { syncManyConnectionModels } from "$lib/server/connections/modelSync"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	downloadHref,
	notifyDownloadSettled
} from "$lib/server/notifications/downloads"

// --- OLLAMA SPECIFIC FUNCTIONS ---

/**
 * The Ollama host a handler talks to.
 *
 * The connection named by `connectionId`: every Ollama connection is managed
 * against its OWN host (ruled 2026-09-24, plan B4). These handlers all read one
 * global `ollamaManagerBaseUrl` before, so a second Ollama connection showed
 * the first one's status, and "Change address" on it edited the global. Every
 * call here is plain HTTP to the host's API and every handler is admin-only —
 * the same gate as editing a connection — so no permission changes with it.
 *
 * ⏳ Transitional: a caller that names no connection (Document View's Ollama
 * page, the home page's model check) still gets the manager's saved address.
 */
async function ollamaHost(
	connectionId: number | null | undefined
): Promise<{ baseUrl: string; connectionId: number | null }> {
	if (connectionId != null) {
		const row = await db.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, connectionId),
			columns: { id: true, type: true, baseUrl: true }
		})
		if (!row || row.type !== CONNECTION_TYPE.OLLAMA)
			throw new Error("That is not an Ollama connection.")
		if (!row.baseUrl?.trim())
			throw new Error("That Ollama connection has no address.")
		return {
			baseUrl: row.baseUrl.replace(/\/+$/, ""),
			connectionId: row.id
		}
	}
	const { ollamaManagerBaseUrl } =
		(await db.query.ollamaSettings.findFirst())!
	return {
		baseUrl: (ollamaManagerBaseUrl ?? "").replace(/\/+$/, ""),
		connectionId: null
	}
}

/**
 * Forget one model on every Ollama connection that points at `baseUrl`,
 * deleting no connection. The host is compared without its trailing slash,
 * the one spelling difference an address typed twice usually has.
 */
async function forgetModelOnHost(baseUrl: string, model: string) {
	const rows = await db.query.connections.findMany({
		where: (c, { eq }) => eq(c.type, CONNECTION_TYPE.OLLAMA),
		columns: { id: true, baseUrl: true }
	})
	const ids = rows
		.filter((r) => (r.baseUrl ?? "").replace(/\/+$/, "") === baseUrl)
		.map((r) => r.id)
	if (!ids.length) return
	await db
		.delete(schema.connectionModels)
		.where(
			and(
				inArray(schema.connectionModels.connectionId, ids),
				eq(schema.connectionModels.model, model)
			)
		)
}

/**
 * The key one pull is tracked under. A connection's pulls are keyed by it, so
 * the same model pulled on two hosts is two downloads; a pull that names no
 * connection keeps the bare model name it always had.
 */
const pullKey = (connectionId: number | null, modelName: string) =>
	connectionId == null ? modelName : `${connectionId}:${modelName}`

let cancelingPulls: string[] = []

// Global download progress tracking
let downloadingQuants: {
	[key: string]: {
		modelName: string
		/** The connection whose host this pull runs on; null for the legacy path. */
		connectionId?: number | null
		status: string
		isDone: boolean // Indicates if it's "done" processing regardless of success or not
		files: { [key: string]: { total: number; completed: number } }
	}
} = {}

export const ollamaGetDownloadProgress: Handler<
	Sockets.Ollama.GetDownloadProgress.Params,
	Sockets.Ollama.GetDownloadProgress.Response
> = {
	event: "ollama:getDownloadProgress",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		// Send current download progress as complete state
		const res: Sockets.Ollama.GetDownloadProgress.Response = {
			downloadingQuants
		}
		emitToUser("ollama:getDownloadProgress", res)
		return res
	}
}

export const ollamaSetBaseUrl: Handler<
	Sockets.Ollama.SetBaseUrl.Params,
	Sockets.Ollama.SetBaseUrl.Response
> = {
	event: "ollama:setBaseUrl",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			// This would typically update the active Ollama connection's baseUrl
			// For now, we'll just validate the URL format
			const url = new URL(params.baseUrl)
			if (!["http:", "https:"].includes(url.protocol)) {
				emitToUser("ollama:setBaseUrl:error", {
					error: "Invalid URL protocol"
				})
				throw new Error("Invalid URL protocol")
			}

			await db
				.update(schema.ollamaSettings)
				.set({
					ollamaManagerBaseUrl: params.baseUrl
				})
				.where(eq(schema.ollamaSettings.id, 1))

			const res: Sockets.Ollama.SetBaseUrl.Response = {
				success: "Base URL updated successfully"
			}
			emitToUser("ollama:setBaseUrl", res)
			return res
		} catch (error: any) {
			console.error("Ollama set base URL error:", error)
			emitToUser("ollama:setBaseUrl:error", {
				error: "Failed to set base URL"
			})
			throw error
		}
	}
}

export const ollamaModelsList: Handler<
	Sockets.Ollama.ModelsList.Params,
	Sockets.Ollama.ModelsList.Response
> = {
	event: "ollama:modelsList",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			const host = await ollamaHost(params?.connectionId)
			const ollama = new Ollama({ host: host.baseUrl })

			const result = await ollama.list()
			const res: Sockets.Ollama.ModelsList.Response = {
				connectionId: host.connectionId,
				models: result.models || []
			}
			emitToUser("ollama:modelsList", res)
			return res
		} catch (error: any) {
			console.error("Ollama models list error:", error)
			emitToUser("ollama:modelsList:error", {
				connectionId: params?.connectionId ?? null,
				error: "Failed to list models"
			})
			throw error
		}
	}
}

export const ollamaDeleteModelHandler: Handler<
	Sockets.Ollama.DeleteModel.Params,
	Sockets.Ollama.DeleteModel.Response
> = {
	event: "ollama:deleteModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			const host = await ollamaHost(params.connectionId)
			const ollama = new Ollama({ host: host.baseUrl })

			await ollama.delete({ model: params.modelName })
			const res: Sockets.Ollama.DeleteModel.Response = {
				success: "Model deleted successfully"
			}
			emitToUser("ollama:deleteModel", res)

			if (host.connectionId != null) {
				// The model is gone from THIS host only: forget its rows on the
				// Ollama connections that point at it, and delete no connection.
				// `forgetModelEverywhere` below also deletes an endpoint it
				// empties — right for the one-model rows `connectModel` once
				// made, and the way a managed connection would vanish the
				// moment its last model was deleted.
				// A starred model forgotten here releases its star by cascade,
				// with the consequence every door runs.
				await withStarConsequences(db, () =>
					forgetModelOnHost(host.baseUrl, params.modelName)
				)
				await emitToUser("connections:list", () =>
					buildConnectionsList()
				)
				return res
			}

			// The MODEL, and the endpoint only if that empties it (0114). This
			// was `DELETE FROM connections WHERE model = $1` — correct while an
			// endpoint named exactly one model, and after the split a way to
			// delete an Ollama endpoint serving four other models because one of
			// them was pulled. For the one-model rows `connectModel` creates the
			// outcome is identical, cascade release of `connection_defaults`
			// included.
			await withStarConsequences(db, () =>
				forgetModelEverywhere(db, params.modelName, ["ollama"])
			)

			return res
		} catch (error: any) {
			console.error("Ollama delete model error:", error)
			emitToUser("ollama:deleteModel:error", {
				error: "Failed to delete model"
			})
			throw error
		}
	}
}

export const ollamaConnectModelHandler: Handler<
	Sockets.Ollama.ConnectModel.Params,
	Sockets.Ollama.ConnectModel.Response
> = {
	event: "ollama:connectModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			if (params.connectionId != null) {
				// Use, from a connection's own model list: the model goes on
				// THAT connection, never on a new one-model endpoint made from
				// the adapter's defaults (which pointed at localhost whatever
				// host the list came from).
				const host = await ollamaHost(params.connectionId)
				const modelRow = await ensureConnectionModel(
					db,
					host.connectionId!,
					params.modelName
				)
				if (!modelRow) throw new Error("No model named.")
				await connectionsSetDefault.handler(
					socket,
					{
						capability: "text->text",
						id: host.connectionId!,
						modelId: modelRow.id
					},
					emitToUser
				)
				await emitToUser("connections:list", () =>
					buildConnectionsList()
				)
				const res: Sockets.Ollama.ConnectModel.Response = {
					success: "Model connected successfully"
				}
				emitToUser("ollama:connectModel", res)
				return res
			}
			// Which endpoint already SERVES this model — asked of
			// `connection_models` and not of the endpoint's mirror column
			// (0114). An Ollama host can carry several models now, so the old
			// `WHERE connections.model = $1` would answer "no connection for
			// this one" while sitting right beside it in the same endpoint's
			// list, and create a duplicate every time.
			const serving = await endpointIdsServingModel(
				db,
				params.modelName,
				["ollama"]
			)
			let existingConnection = serving.length
				? await db.query.connections.findFirst({
						where: (c, { eq }) => eq(c.id, serving[0])
					})
				: undefined

			if (!existingConnection) {
				// Parse and create a shorter name for the connection
				const connectionName: string = params.modelName
					.split("/")
					.pop()! as string
				// Create a new connection if it doesn't exist
				const data: any = {
					...ollamaAdapter.connectionDefaults,
					name: connectionName
				}
				// A raw insert bypasses everything `connections:create` does to a
				// new row, including this — and the omission fails INVISIBLY. An
				// empty `capabilities` reads as "not determined yet", so the guard
				// falls through to its modality test and the connection works by
				// accident until some unrelated edit resolves the row properly and
				// the picker changes under the user. `koboldcpp:connectModel` does
				// the same insert and already sets this; the two had drifted.
				data.capabilities = {
					resolved: resolveConnectionCapabilities(data)
				}
				console.log("Creating connection", data)
				const [newConnection] = await db
					.insert(schema.connections)
					.values(data as InsertConnection)
					.returning()
				// The other half of the row this insert bypasses. A raw insert
				// skips everything `connections:create` does, and that includes
				// the model row — without which the new endpoint resolves to no
				// model at all and the very next send fails with a sentence
				// about a connection that looks perfectly configured.
				// `ensureConnectionModel` ensures the ROW, never a default:
				// connections have none.
				await ensureConnectionModel(
					db,
					newConnection.id,
					params.modelName
				)
				existingConnection = newConnection
			}

			// The model row this flow is for — found, never guessed: the flow
			// just ensured it above, or a previous run did.
			const [modelRow] = await db
				.select()
				.from(schema.connectionModels)
				.where(
					and(
						eq(
							schema.connectionModels.connectionId,
							existingConnection.id
						),
						eq(schema.connectionModels.model, params.modelName)
					)
				)
				.limit(1)
			if (!modelRow) {
				const res = { error: "That model is not on this connection." }
				emitToUser("ollama:connectModel:error", res)
				throw new Error(res.error)
			}

			// Explicitly `text->text`, with the model named outright: "Connect
			// model" is somebody choosing, which is what makes it legitimate
			// under the no-implicit-pickup ruling — unlike the auto-star deleted
			// from `connections:create`, which chose on nobody's behalf. The
			// capability is named rather than derived, because a connection is
			// not one thing.
			await connectionsSetDefault.handler(
				socket,
				{
					capability: "text->text",
					id: existingConnection.id,
					modelId: modelRow.id
				},
				emitToUser
			)
			await emitToUser("connections:list", () => buildConnectionsList())

			const res: Sockets.Ollama.ConnectModel.Response = {
				success: "Model connected successfully"
			}
			emitToUser("ollama:connectModel", res)
			return res
		} catch (error: any) {
			console.error("Ollama connect model error:", error)
			emitToUser("ollama:connectModel:error", {
				error: "Failed to connect to model"
			})
			throw error
		}
	}
}

export const ollamaListRunningModelsHandler: Handler<
	Sockets.Ollama.ListRunningModels.Params,
	Sockets.Ollama.ListRunningModels.Response
> = {
	event: "ollama:listRunningModels",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			const host = await ollamaHost(params?.connectionId)
			const ollama = new Ollama({ host: host.baseUrl })

			const result = await ollama.ps()
			const res: Sockets.Ollama.ListRunningModels.Response = {
				connectionId: host.connectionId,
				runningModels: result.models || []
			}
			emitToUser("ollama:listRunningModels", res)
			return res
		} catch (error: any) {
			console.error("Ollama list running models error:", error)
			emitToUser("ollama:listRunningModels:error", {
				connectionId: params?.connectionId ?? null,
				error: "Failed to list running models"
			})
			throw error
		}
	}
}

/**
 * The pull, and the progress pushes that narrate it.
 *
 * Those pushes are `ollama:pullProgress` and not the bare `ollamaPullProgress`
 * they were spelled as for want of ever going through `register`. The prefix is
 * load-bearing now: `ollama:` is restricted interest, so it is what tells both
 * interest registries that a non-admin may not hold this key — and this event
 * was always exactly as admin-only as the handler that sends it.
 */
export const ollamaPullModelHandler: Handler<
	Sockets.Ollama.PullModel.Params,
	Sockets.Ollama.PullModel.Response
> = {
	event: "ollama:pullModel",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const host = await ollamaHost(params.connectionId)
		const key = pullKey(host.connectionId, params.modelName)
		// Only the admin who started the pull is told how it settled. `pulled`
		// separates a failed pull from a failure in the bookkeeping after it.
		const settled = {
			userId: socket.user!.id,
			source: "ollama" as const,
			key,
			model: params.modelName,
			href: downloadHref(host.connectionId)
		}
		let pulled = false
		try {
			// Remove from cancelingPulls if it exists
			if (cancelingPulls.includes(key)) {
				cancelingPulls = cancelingPulls.filter((name) => name !== key)
			}

			// Initialize download tracking
			downloadingQuants[key] = {
				modelName: params.modelName,
				connectionId: host.connectionId,
				status: "starting",
				isDone: false,
				files: {}
			}

			const ollama = new Ollama({ host: host.baseUrl })

			// For streaming progress, we could implement progress callbacks
			const stream = await ollama.pull({
				model: params.modelName,
				stream: true
			})

			for await (const chunk of stream) {
				if (cancelingPulls.includes(key)) {
					cancelingPulls = cancelingPulls.filter(
						(name) => name !== key
					)
					stream.abort()

					// Update server state
					if (downloadingQuants[key]) {
						downloadingQuants[key].status = "cancelled"
						downloadingQuants[key].isDone = true
					}

					// Emit cancellation with full state
					emitToUser("ollama:pullProgress", {
						downloadingQuants
					})

					return {
						success: "Model download cancelled"
					}
				}
				// Emit progress updates and update server state
				if (chunk.status) {
					// Update server-side tracking
					if (downloadingQuants[key]) {
						let fileName: string | undefined

						if (
							chunk.status.includes("pulling ") &&
							!chunk.status.includes("pulling manifest")
						) {
							fileName = chunk.status.split("pulling ")[1]
						}

						downloadingQuants[key].status = chunk.status
						if (fileName) {
							downloadingQuants[key].files[fileName] = {
								total: chunk.total || 0,
								completed: chunk.completed || 0
							}
						}
					}

					// Emit the entire downloadingQuants object for full state sync
					emitToUser("ollama:pullProgress", {
						downloadingQuants
					})
				}
			}

			// Update status to success
			if (downloadingQuants[key]) {
				downloadingQuants[key].status = "success"
				downloadingQuants[key].isDone = true
			}
			pulled = true
			await notifyDownloadSettled(settled)

			// Emit final progress with full state
			emitToUser("ollama:pullProgress", {
				downloadingQuants
			})

			// The pulled model is now something every Ollama endpoint can
			// serve, so their rows follow at once rather than on the next
			// sidebar open. Forced: the whole point is that the listing
			// changed a second ago. Local, so it is cheap.
			await syncManyConnectionModels(db, {
				types: [
					CONNECTION_TYPE.OLLAMA,
					CONNECTION_TYPE.OLLAMA_EMBEDDINGS
				],
				force: true
			})
			await emitToUser("connections:list", () => buildConnectionsList())

			const res: Sockets.Ollama.PullModel.Response = {
				success: "Model downloaded successfully"
			}
			emitToUser("ollama:pullModel", res)
			return res
		} catch (error: any) {
			console.error("Ollama pull model error:", error)

			// Update server state for error
			if (downloadingQuants[key]) {
				downloadingQuants[key].status = "error"
				downloadingQuants[key].isDone = true
			}

			// Emit error progress with full state
			emitToUser("ollama:pullProgress", {
				downloadingQuants
			})

			emitToUser("ollama:pullModel:error", {
				error: "Failed to download model"
			})
			if (!pulled)
				await notifyDownloadSettled({
					...settled,
					error: error ?? new Error("Unknown error")
				})
			throw error
		}
	}
}

export const ollamaVersionHandler: Handler<
	Sockets.Ollama.Version.Params,
	Sockets.Ollama.Version.Response
> = {
	event: "ollama:version",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			// `baseUrl` tests an address as typed, before it is saved — the same
			// admin-only reach `connections:test` already has, so naming a
			// connection does not replace it.
			const host = params?.baseUrl
				? {
						baseUrl: params.baseUrl.replace(/\/+$/, ""),
						connectionId: params.connectionId ?? null
					}
				: await ollamaHost(params?.connectionId)
			const response = await fetch(`${host.baseUrl}/api/version`)

			if (!response.ok) {
				throw new Error(
					`HTTP ${response.status}: ${response.statusText}`
				)
			}

			const result = await response.json()
			const res: Sockets.Ollama.Version.Response = {
				connectionId: host.connectionId,
				version: result.version
			}
			emitToUser("ollama:version", res)
			return res
		} catch (error: any) {
			console.error("Ollama version error:", error)
			emitToUser("ollama:version:error", {
				connectionId: params?.connectionId ?? null,
				error: "Failed to connect to Ollama or get version"
			})
			throw error
		}
	}
}

export const ollamaIsUpdateAvailableHandler: Handler<
	Sockets.Ollama.IsUpdateAvailable.Params,
	Sockets.Ollama.IsUpdateAvailable.Response
> = {
	event: "ollama:isUpdateAvailable",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			// Get current version using direct HTTP request
			const host = await ollamaHost(params?.connectionId)
			const versionResponse = await fetch(`${host.baseUrl}/api/version`)

			if (!versionResponse.ok) {
				throw new Error(
					`HTTP ${versionResponse.status}: ${versionResponse.statusText}`
				)
			}

			const versionResult = await versionResponse.json()
			const currentVersion = versionResult.version

			// Fetch the latest version from Ollama's GitHub releases API
			const githubResponse = await fetch(
				"https://api.github.com/repos/ollama/ollama/releases/latest"
			)

			if (!githubResponse.ok) {
				throw new Error(`GitHub API error: ${githubResponse.status}`)
			}

			const latestRelease = await githubResponse.json()
			const latestVersion = latestRelease.tag_name

			// Compare versions (remove 'v' prefix if present)
			const currentVersionClean = currentVersion.replace(/^v/, "")
			const latestVersionClean = latestVersion.replace(/^v/, "")

			// Simple version comparison (works for semantic versioning)
			const updateAvailable =
				compareVersions(latestVersionClean, currentVersionClean) > 0

			const res: Sockets.Ollama.IsUpdateAvailable.Response = {
				connectionId: host.connectionId,
				isUpdateAvailable: updateAvailable,
				currentVersion: currentVersion,
				latestVersion: latestVersion
			}
			emitToUser("ollama:isUpdateAvailable", res)
			return res
		} catch (error: any) {
			console.error("Ollama update check error:", error)
			emitToUser("ollama:isUpdateAvailable:error", {
				connectionId: params?.connectionId ?? null,
				error: "Failed to check for updates"
			})
			throw error
		}
	}
}

export const ollamaSearchAvailableModelsHandler: Handler<
	Sockets.Ollama.SearchAvailableModels.Params,
	Sockets.Ollama.SearchAvailableModels.Response
> = {
	event: "ollama:searchAvailableModels",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		// Instance-wide budget — the Hugging Face branch below hits that
		// host on every call with no throttling otherwise, unlike the
		// recommended-models handler's own TTL cache for the same concern.
		if (loginRateLimit.isRateLimited("ollama:searchAvailableModels")) {
			throw new Error("Rate limited. Please wait a moment and try again.")
		}
		loginRateLimit.recordFailedAttempt("ollama:searchAvailableModels")
		try {
			const { searchTerm: search, source } = params
			let models: Array<{
				name: string
				description?: string
				size?: string
				tags?: string[]
				popular?: boolean
				url?: string
				downloads?: number
				updatedAtStr?: string
				createdAt?: Date
				likes?: number
				trendingScore?: number
				pullOptions?: { label: string; pull: string }[]
			}> = []

			if (source === OllamaModelSearchSource.HUGGING_FACE) {
				// An embeddings search narrows to embedding models by the Hub's own
				// pipeline tag, on top of `filter=gguf` — so "nomic" finds the
				// embedding GGUFs and not every chat model with that word in it.
				// Chat (the default) sends exactly the query it always did.
				const pipeline =
					params.kind === "embedding"
						? "&pipeline_tag=feature-extraction"
						: ""
				const response = await fetch(
					`https://huggingface.co/api/models?search=${encodeURIComponent(search)}&filter=gguf${pipeline}&limit=50&sort=trendingScore&full=True&config=True`
				)

				if (!response.ok) {
					throw new Error(
						`Hugging Face API error: ${response.status}`
					)
				}

				const data = await response.json()

				// Filter out private and gated models
				const filteredData = (data || []).filter((model: any) => {
					// Exclude private models
					if (model.private === true) {
						return false
					}

					// Exclude explicitly gated models (boolean true or 'auto')
					if (model.gated === true || model.gated === "auto") {
						return false
					}

					return true
				})

				// Transform Hugging Face response to our format
				models = filteredData.map((model: any) => {
					const ggufSiblings = model.siblings.filter(
						(sibling: { rfilename: string }) =>
							sibling.rfilename.endsWith(".gguf")
					)
					const pullOptions: { label: string; pull: string }[] =
						ggufSiblings
							.filter((sibling: { rfilename: string }) => {
								const stem =
									sibling.rfilename
										.replace(".gguf", "")
										.split("-")
										.pop()
										?.toUpperCase() ?? ""
								return /^(Q|IQ|BF|F)\d/.test(stem)
							})
							.map((sibling: { rfilename: string }) => {
								const quant = sibling.rfilename
									.replace(".gguf", "")
									.split("-")
									.pop()
								let pull = `hf.co/${model.id}:${quant}`
								return { label: quant, pull }
							})
					return {
						name: model.id || model.modelId,
						description: model.description || model.pipeline_tag,
						size: undefined, // Hugging Face doesn't provide size in search
						tags: model.tags || [],
						popular: model.likes > 100 || false,
						url: `https://hf.co/${model.id || model.modelId}`,
						createdAt: model.createdAt,
						downloads: model.downloads,
						likes: model.likes,
						trendingScore: model.trendingScore,
						pullOptions: pullOptions
					}
				})

				// Filter out models that don't have pull options
				models = models.filter(
					(model) => model.pullOptions && model.pullOptions.length > 0
				)
			}

			const res: Sockets.Ollama.SearchAvailableModels.Response = {
				models
			}
			emitToUser("ollama:searchAvailableModels", res)
			return res
		} catch (error: any) {
			console.error("Ollama search available models error:", error)
			emitToUser("ollama:searchAvailableModels:error", {
				error: "Failed to search available models"
			})
			throw error
		}
	}
}

export const ollamaClearDownloadHistoryHandler: Handler<
	Sockets.Ollama.ClearDownloadHistory.Params,
	Sockets.Ollama.ClearDownloadHistory.Response
> = {
	event: "ollama:clearDownloadHistory",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			// Clear the download progress tracking
			Object.keys(downloadingQuants).forEach((modelName) => {
				if (downloadingQuants[modelName].isDone) {
					delete downloadingQuants[modelName]
				}
			})
			cancelingPulls = []

			const res: Sockets.Ollama.ClearDownloadHistory.Response = {
				success: "Download history cleared successfully"
			}
			emitToUser("ollama:clearDownloadHistory", res)
			return res
		} catch (error: any) {
			console.error("Ollama clear download history error:", error)
			emitToUser("ollama:clearDownloadHistory:error", {
				error: "Failed to clear download history"
			})
			throw error
		}
	}
}

export const ollamaCancelPullHandler: Handler<
	Sockets.Ollama.CancelPull.Params,
	Sockets.Ollama.CancelPull.Response
> = {
	event: "ollama:cancelPull",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			const key = pullKey(params.connectionId ?? null, params.modelName)
			// Add the model to the canceling pulls array
			if (!cancelingPulls.includes(key)) {
				cancelingPulls.push(key)
			}

			// If the model is currently downloading, update its status
			if (downloadingQuants[key]) {
				downloadingQuants[key].status = "cancelled"
				downloadingQuants[key].isDone = true
			}

			const res: Sockets.Ollama.CancelPull.Response = {
				success: "Model download cancelled successfully"
			}
			emitToUser("ollama:cancelPull", res)
			return res
		} catch (error: any) {
			console.error("Ollama cancel pull error:", error)
			emitToUser("ollama:cancelPull:error", {
				error: "Failed to cancel model download"
			})
			throw error
		}
	}
}

export const ollamaRecommendedModelsHandler: Handler<
	Sockets.Ollama.RecommendedModels.Params,
	Sockets.Ollama.RecommendedModels.Response
> = {
	event: "ollama:recommendedModels",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			// The shared reader of `recommended.yaml` (see recommendedGguf.ts),
			// narrowed to what was asked for. `kind` defaults to chat, which is
			// every caller that predates embeddings — so nothing that sent `{}`
			// is suddenly handed an embedding model.
			const all = await fetchRecommendedGguf()
			const models =
				params?.kind === "embedding"
					? embeddingEntries(all)
					: chatEntries(all)

			const res: Sockets.Ollama.RecommendedModels.Response = {
				recommendedModels: models
			}
			emitToUser("ollama:recommendedModels", res)
			return res
		} catch (error: any) {
			console.error("Ollama recommended models error:", error)
			emitToUser("ollama:recommendedModels:error", {
				error: "Failed to fetch recommended models"
			})
			throw error
		}
	}
}

// Helper function to compare semantic versions
function compareVersions(version1: string, version2: string): number {
	const v1parts = version1.split(".").map(Number)
	const v2parts = version2.split(".").map(Number)

	const maxLength = Math.max(v1parts.length, v2parts.length)

	for (let i = 0; i < maxLength; i++) {
		const v1part = v1parts[i] || 0
		const v2part = v2parts[i] || 0

		if (v1part > v2part) return 1
		if (v1part < v2part) return -1
	}

	return 0
}

import { buildSystemSettingsGet } from "./systemSettings"

export const ollamaUpdateManagerEnabled: Handler<
	Sockets.SystemSettings.UpdateOllamaManagerEnabled.Params,
	Sockets.SystemSettings.UpdateOllamaManagerEnabled.Response
> = {
	event: "systemSettings:updateOllamaManagerEnabled",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		if (params.enabled && isAndroidWrapper()) {
			throw new Error(
				"Ollama, managed, is not available in the Android app"
			)
		}
		await db
			.update(schema.ollamaSettings)
			.set({ ollamaManagerEnabled: params.enabled })
			.where(eq(schema.ollamaSettings.id, 1))
		const res: Sockets.SystemSettings.UpdateOllamaManagerEnabled.Response =
			{ success: true, enabled: params.enabled }
		emitToUser("systemSettings:updateOllamaManagerEnabled", res)
		await emitToUser("systemSettings:get", () => buildSystemSettingsGet())
		return res
	}
}

// Registration function for all ollama handlers
export function registerOllamaHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, ollamaUpdateManagerEnabled, emitToUser)
	register(socket, ollamaSetBaseUrl, emitToUser)
	register(socket, ollamaModelsList, emitToUser)
	register(socket, ollamaGetDownloadProgress, emitToUser)
	register(socket, ollamaDeleteModelHandler, emitToUser)
	register(socket, ollamaConnectModelHandler, emitToUser)
	register(socket, ollamaListRunningModelsHandler, emitToUser)
	register(socket, ollamaVersionHandler, emitToUser)
	register(socket, ollamaIsUpdateAvailableHandler, emitToUser)
	register(socket, ollamaPullModelHandler, emitToUser)
	register(socket, ollamaSearchAvailableModelsHandler, emitToUser)
	register(socket, ollamaClearDownloadHistoryHandler, emitToUser)
	register(socket, ollamaRecommendedModelsHandler, emitToUser)
	register(socket, ollamaCancelPullHandler, emitToUser)
}
