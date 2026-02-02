import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { InsertConnection } from "$lib/server/db/schema"
import { user as loadUser } from "./users"
import { connectionsList } from "./connections"
import { Ollama } from "ollama"
import ollamaAdapter from "$lib/server/connectionAdapters/OllamaAdapter"
import { OllamaModelSearchSource } from "$lib/shared/constants/OllamaModelSource"
import { emit } from "process"
import type { Handler } from "$lib/shared/events"

// --- OLLAMA SPECIFIC FUNCTIONS ---

let cancelingPulls: string[] = []

// Global download progress tracking
let downloadingQuants: {
	[key: string]: {
		modelName: string
		status: string
		isDone: boolean // Indicates if it's "done" processing regardless of success or not
		files: { [key: string]: { total: number; completed: number } }
	}
} = {}

// Function to emit download progress to all connected clients
function emitDownloadProgress(emitToAll: (event: string, data: any) => void) {
	emitToAll("ollamaDownloadProgress", { downloadingQuants })
}

export const ollamaGetDownloadProgress: Handler<Sockets.Ollama.GetDownloadProgress.Params, Sockets.Ollama.GetDownloadProgress.Response> = {
	event: "ollama:getDownloadProgress",
	handler: async (socket, params, emitToUser) => {
		// Send current download progress as complete state
		const res: Sockets.Ollama.GetDownloadProgress.Response = {
			downloadingQuants
		}
		emitToUser("ollama:getDownloadProgress", res)
		return res
	}
}

export const ollamaSetBaseUrl: Handler<Sockets.Ollama.SetBaseUrl.Params, Sockets.Ollama.SetBaseUrl.Response> = {
	event: "ollama:setBaseUrl",
	handler: async (socket, params, emitToUser) => {
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

			await db.update(schema.systemSettings).set({
				ollamaManagerBaseUrl: params.baseUrl
			})

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

export const ollamaModelsList: Handler<Sockets.Ollama.ModelsList.Params, Sockets.Ollama.ModelsList.Response> = {
	event: "ollama:modelsList",
	handler: async (socket, params, emitToUser) => {
		try {
			const { ollamaManagerBaseUrl: baseUrl } =
				(await db.query.systemSettings.findFirst())!
			const ollama = new Ollama({
				host: baseUrl
			})

			const result = await ollama.list()
			const res: Sockets.Ollama.ModelsList.Response = {
				models: result.models || []
			}
			emitToUser("ollama:modelsList", res)
			return res
		} catch (error: any) {
			console.error("Ollama models list error:", error)
			emitToUser("ollama:modelsList:error", {
				error: "Failed to list models"
			})
			throw error
		}
	}
}

export const ollamaDeleteModelHandler: Handler<Sockets.Ollama.DeleteModel.Params, Sockets.Ollama.DeleteModel.Response> = {
	event: "ollama:deleteModel",
	handler: async (socket, params, emitToUser) => {
		try {
			const { ollamaManagerBaseUrl: baseUrl } =
				(await db.query.systemSettings.findFirst())!
			const ollama = new Ollama({
				host: baseUrl
			})

			await ollama.delete({ model: params.modelName })
			const res: Sockets.Ollama.DeleteModel.Response = {
				success: "Model deleted successfully"
			}
			emitToUser("ollama:deleteModel", res)

			await db
				.delete(schema.connections)
				.where(
					and(
						eq(schema.connections.type, "ollama"),
						eq(schema.connections.model, params.modelName)
					)
				)
			
			return res
		} catch (error: any) {
			console.error("Ollama delete model error:", error)
			emitToUser("ollama:deleteModel:error", { error: "Failed to delete model" })
			throw error
		}
	}
}

export const ollamaConnectModelHandler: Handler<Sockets.Ollama.ConnectModel.Params, Sockets.Ollama.ConnectModel.Response> = {
	event: "ollama:connectModel",
	handler: async (socket, params, emitToUser) => {
		const userId = 1

		try {
			let existingConnection = await db.query.connections.findFirst({
				where: (c, { eq }) =>
					and(eq(c.type, "ollama"), eq(c.model, params.modelName))
			})

			if (!existingConnection) {
				// Parse and create a shorter name for the connection
				const connectionName: string = params.modelName
					.split("/")
					.pop()! as string
				// Create a new connection if it doesn't exist
				const data = {
					...ollamaAdapter.connectionDefaults,
					name: connectionName,
					model: params.modelName
				}
				console.log("Creating connection", data)
				const [newConnection] = await db
					.insert(schema.connections)
					.values(data as InsertConnection)
					.returning()
				existingConnection = newConnection
			}

			await db
				.update(schema.users)
				.set({
					activeConnectionId: existingConnection.id
				})
				.where(eq(schema.users.id, userId))

			await loadUser(socket, {}, emitToUser)
			await connectionsList.handler(socket, {}, emitToUser)

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

export const ollamaListRunningModelsHandler: Handler<Sockets.Ollama.ListRunningModels.Params, Sockets.Ollama.ListRunningModels.Response> = {
	event: "ollama:listRunningModels",
	handler: async (socket, params, emitToUser) => {
		try {
			const { ollamaManagerBaseUrl: baseUrl } =
				(await db.query.systemSettings.findFirst())!
			const ollama = new Ollama({
				host: baseUrl
			})

			const result = await ollama.ps()
			const res: Sockets.Ollama.ListRunningModels.Response = {
				runningModels: result.models || []
			}
			emitToUser("ollama:listRunningModels", res)
			return res
		} catch (error: any) {
			console.error("Ollama list running models error:", error)
			emitToUser("ollama:listRunningModels:error", {
				error: "Failed to list running models"
			})
			throw error
		}
	}
}

export const ollamaPullModelHandler: Handler<Sockets.Ollama.PullModel.Params, Sockets.Ollama.PullModel.Response> = {
	event: "ollama:pullModel",
	handler: async (socket, params, emitToUser) => {
		try {
			// Remove from cancelingPulls if it exists
			if (cancelingPulls.includes(params.modelName)) {
				cancelingPulls = cancelingPulls.filter(
					(name) => name !== params.modelName
				)
			}

			// Initialize download tracking
			downloadingQuants[params.modelName] = {
				modelName: params.modelName,
				status: "starting",
				isDone: false,
				files: {}
			}

			const { ollamaManagerBaseUrl: baseUrl } =
				(await db.query.systemSettings.findFirst())!
			const ollama = new Ollama({
				host: baseUrl
			})

			// For streaming progress, we could implement progress callbacks
			const stream = await ollama.pull({
				model: params.modelName,
				stream: true
			})

			for await (const chunk of stream) {
				if (cancelingPulls.includes(params.modelName)) {
					cancelingPulls = cancelingPulls.filter(
						(name) => name !== params.modelName
					)
					stream.abort()

					// Update server state
					if (downloadingQuants[params.modelName]) {
						downloadingQuants[params.modelName].status = "cancelled"
						downloadingQuants[params.modelName].isDone = true
					}

					// Emit cancellation with full state
					emitToUser("ollamaPullProgress", {
						downloadingQuants
					})

					return {
						success: "Model download cancelled"
					}
				}
				// Emit progress updates and update server state
				if (chunk.status) {
					// Update server-side tracking
					if (downloadingQuants[params.modelName]) {
						let fileName: string | undefined

						if (
							chunk.status.includes("pulling ") &&
							!chunk.status.includes("pulling manifest")
						) {
							fileName = chunk.status.split("pulling ")[1]
						}

						downloadingQuants[params.modelName].status = chunk.status
						if (fileName) {
							downloadingQuants[params.modelName].files[fileName] = {
								total: chunk.total || 0,
								completed: chunk.completed || 0
							}
						}
					}

					// Emit the entire downloadingQuants object for full state sync
					emitToUser("ollamaPullProgress", {
						downloadingQuants
					})
				}
			}

			// Update status to success
			if (downloadingQuants[params.modelName]) {
				downloadingQuants[params.modelName].status = "success"
				downloadingQuants[params.modelName].isDone = true
			}

			// Emit final progress with full state
			emitToUser("ollamaPullProgress", {
				downloadingQuants
			})

			const res: Sockets.Ollama.PullModel.Response = {
				success: "Model downloaded successfully"
			}
			emitToUser("ollama:pullModel", res)
			return res
		} catch (error: any) {
			console.error("Ollama pull model error:", error)

			// Update server state for error
			if (downloadingQuants[params.modelName]) {
				downloadingQuants[params.modelName].status = "error"
				downloadingQuants[params.modelName].isDone = true
			}

			// Emit error progress with full state
			emitToUser("ollamaPullProgress", {
				downloadingQuants
			})

			emitToUser("ollama:pullModel:error", {
				error: "Failed to download model"
			})
			throw error
		}
	}
}

export const ollamaVersionHandler: Handler<Sockets.Ollama.Version.Params, Sockets.Ollama.Version.Response> = {
	event: "ollama:version",
	handler: async (socket, params, emitToUser) => {
		try {
			const { ollamaManagerBaseUrl: baseUrl } =
				(await db.query.systemSettings.findFirst())!
			const response = await fetch(`${baseUrl}/api/version`)

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			const result = await response.json()
			const res: Sockets.Ollama.Version.Response = {
				version: result.version
			}
			emitToUser("ollama:version", res)
			return res
		} catch (error: any) {
			console.error("Ollama version error:", error)
			emitToUser("ollama:version:error", {
				error: "Failed to connect to Ollama or get version"
			})
			throw error
		}
	}
}

export const ollamaIsUpdateAvailableHandler: Handler<Sockets.Ollama.IsUpdateAvailable.Params, Sockets.Ollama.IsUpdateAvailable.Response> = {
	event: "ollama:isUpdateAvailable",
	handler: async (socket, params, emitToUser) => {
		try {
			// Get current version using direct HTTP request
			const { ollamaManagerBaseUrl: baseUrl } =
				(await db.query.systemSettings.findFirst())!
			const versionResponse = await fetch(`${baseUrl}/api/version`)

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
				isUpdateAvailable: updateAvailable,
				currentVersion: currentVersion,
				latestVersion: latestVersion
			}
			emitToUser("ollama:isUpdateAvailable", res)
			return res
		} catch (error: any) {
			console.error("Ollama update check error:", error)
			emitToUser("ollama:isUpdateAvailable:error", {
				error: "Failed to check for updates"
			})
			throw error
		}
	}
}

export const ollamaSearchAvailableModelsHandler: Handler<Sockets.Ollama.SearchAvailableModels.Params, Sockets.Ollama.SearchAvailableModels.Response> = {
	event: "ollama:searchAvailableModels",
	handler: async (socket, params, emitToUser) => {
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

			if (source === OllamaModelSearchSource.OLLAMA_DB) {
				const response = await fetch(
					`https://ollamadb.dev/api/v1/models?limit=25&search=${encodeURIComponent(search)}`
				)

				if (!response.ok) {
					throw new Error(`OllamaDB API error: ${response.status}`)
				}

				const data = await response.json()

				// Transform ollamadb.dev response to our format
				models = (data.models || []).map((model: any) => ({
					name: model.model_identifier || model.model_name,
					description: model.description,
					size: model.size,
					url: model.url,
					downloads: model.pulls,
					updatedAtStr: model.last_updated_str
				}))
			} else if (source === OllamaModelSearchSource.HUGGING_FACE) {
				const response = await fetch(
					`https://huggingface.co/api/models?search=${encodeURIComponent(search)}&filter=gguf&limit=50&sort=trendingScore&full=True&config=True"`
				)

				if (!response.ok) {
					throw new Error(`Hugging Face API error: ${response.status}`)
				}

				const data = await response.json()

				const textTags = [
					"text-generation",
					"text-classification",
					"fill-mask",
					"question-answering",
					"summarization",
					"translation",
					"token-classification",
					"conversational",
					"image-text-to-text"
				]

				// Filter out private and gated models
				const filteredData = (data || []).filter((model: any) => {
					// Exclude private models
					if (model.private === true) {
						return false
					}

					// Exclude gated models (both boolean true and 'auto')
					if (model.gated !== false) {
						return false
					}

					// Exclude models that don't match the search or aren't text-based
					if (!textTags.includes(model.pipeline_tag)) {
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
							.filter(
								(sibling: { rfilename: string }) =>
									sibling.rfilename
										.split("-")
										.pop()
										?.startsWith("Q") &&
									sibling.rfilename.includes(".gguf")
							)
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
				models = models.filter((model) => model.pullOptions && model.pullOptions.length > 0)
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

export const ollamaClearDownloadHistoryHandler: Handler<Sockets.Ollama.ClearDownloadHistory.Params, Sockets.Ollama.ClearDownloadHistory.Response> = {
	event: "ollama:clearDownloadHistory",
	handler: async (socket, params, emitToUser) => {
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

export const ollamaCancelPullHandler: Handler<Sockets.Ollama.CancelPull.Params, Sockets.Ollama.CancelPull.Response> = {
	event: "ollama:cancelPull",
	handler: async (socket, params, emitToUser) => {
		try {
			// Add the model to the canceling pulls array
			if (!cancelingPulls.includes(params.modelName)) {
				cancelingPulls.push(params.modelName)
			}

			// If the model is currently downloading, update its status
			if (downloadingQuants[params.modelName]) {
				downloadingQuants[params.modelName].status = "cancelled"
				downloadingQuants[params.modelName].isDone = true
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

export const ollamaRecommendedModelsHandler: Handler<Sockets.Ollama.RecommendedModels.Params, Sockets.Ollama.RecommendedModels.Response> = {
	event: "ollama:recommendedModels",
	handler: async (socket, params, emitToUser) => {
		try {
			// Fetch the recommended models YAML from GitHub
			const response = await fetch(
				"https://raw.githubusercontent.com/doolijb/serene-pub-gguf-list/main/recommended.yaml"
			)

			if (!response.ok) {
				throw new Error(`GitHub API error: ${response.status}`)
			}

			const yamlText = await response.text()

			// Parse YAML - simple parsing for our specific structure
			const models: Array<{
				name: string
				pull: string
				size: number
				recommended_vram: number
				details: {
					parameter_size: string
					quantization_level: string
					modified_at: string
					description: string
				}
			}> = []
			const lines = yamlText.split("\n")
			let currentModel: any = null
			let inDetails = false

			for (const line of lines) {
				const trimmed = line.trim()

				if (trimmed.startsWith("- name:")) {
					if (currentModel) {
						models.push(currentModel)
					}
					currentModel = {
						name: trimmed.replace("- name:", "").trim(),
						pull: "",
						size: 0,
						recommended_vram: 0,
						details: {
							parameter_size: "",
							quantization_level: "",
							modified_at: "",
							description: ""
						}
					}
					inDetails = false
				} else if (currentModel) {
					if (trimmed.startsWith("pull:")) {
						currentModel.pull = trimmed.replace("pull:", "").trim()
					} else if (trimmed.startsWith("size:")) {
						currentModel.size = parseFloat(
							trimmed.replace("size:", "").trim()
						)
					} else if (trimmed.startsWith("recommended_vram:")) {
						currentModel.recommended_vram = parseInt(
							trimmed.replace("recommended_vram:", "").trim()
						)
					} else if (trimmed === "details:") {
						inDetails = true
					} else if (inDetails) {
						if (trimmed.startsWith("parameter_size:")) {
							currentModel.details.parameter_size = trimmed
								.replace("parameter_size:", "")
								.trim()
								.replace(/"/g, "")
						} else if (trimmed.startsWith("quantization_level:")) {
							currentModel.details.quantization_level = trimmed
								.replace("quantization_level:", "")
								.trim()
								.replace(/"/g, "")
						} else if (trimmed.startsWith("modified_at:")) {
							currentModel.details.modified_at = trimmed
								.replace("modified_at:", "")
								.trim()
								.replace(/"/g, "")
						} else if (trimmed.startsWith("description:")) {
							currentModel.details.description = trimmed
								.replace("description:", "")
								.trim()
								.replace(/"/g, "")
						}
					}
				}
			}

			// Add the last model if exists
			if (currentModel) {
				models.push(currentModel)
			}

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

// Legacy functions - keeping original implementations for now
export async function ollamaConnectModelLegacy(
	socket: any,
	message: any,
	emitToUser: (event: string, data: any) => void
) {
	// Redirect to new handler
	await ollamaConnectModelHandler.handler(socket, message, emitToUser)
}

export async function ollamaSearchAvailableModelsLegacy(
	socket: any,
	message: any,
	emitToUser: (event: string, data: any) => void
) {
	await ollamaSearchAvailableModelsHandler.handler(socket, message, emitToUser)
}

export async function ollamaDeleteModelLegacy(
	socket: any,
	message: any,
	emitToUser: (event: string, data: any) => void
) {
	await ollamaDeleteModelHandler.handler(socket, message, emitToUser)
}

export async function ollamaListRunningModelsLegacy(
	socket: any,
	message: any,
	emitToUser: (event: string, data: any) => void
) {
	await ollamaListRunningModelsHandler.handler(socket, message, emitToUser)
}

export async function ollamaPullModelLegacy(
	socket: any,
	message: any,
	emitToUser: (event: string, data: any) => void
) {
	await ollamaPullModelHandler.handler(socket, message, emitToUser)
}

export async function ollamaVersionLegacy(
	socket: any,
	message: any,
	emitToUser: (event: string, data: any) => void
) {
	await ollamaVersionHandler.handler(socket, message, emitToUser)
}

export async function ollamaIsUpdateAvailableLegacy(
	socket: any,
	message: any,
	emitToUser: (event: string, data: any) => void
) {
	await ollamaIsUpdateAvailableHandler.handler(socket, message, emitToUser)
}

export async function ollamaCancelPullLegacy(
	socket: any,
	message: any,
	emitToUser: (event: string, data: any) => void
) {
	await ollamaCancelPullHandler.handler(socket, message, emitToUser)
}

export async function ollamaClearDownloadHistoryLegacy(
	socket: any,
	message: any,
	emitToUser: (event: string, data: any) => void
) {
	await ollamaClearDownloadHistoryHandler.handler(socket, message, emitToUser)
}

export async function ollamaRecommendedModelsLegacy(
	socket: any,
	message: any,
	emitToUser: (event: string, data: any) => void
) {
	await ollamaRecommendedModelsHandler.handler(socket, message, emitToUser)
}

// Registration function for all ollama handlers
export function registerOllamaHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
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
