import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { user as loadUser } from "./users"
import { connectionsList } from "./connections"
import { Ollama } from "ollama"
import ollamaAdapter from "$lib/server/connectionAdapters/OllamaAdapter"
import { OllamaModelSearchSource } from "$lib/shared/constants/OllamaModelSource"
import { emit } from "process"

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

// Function to get current download progress
export async function ollamaGetDownloadProgress(
	socket: any,
	message: {},
	emitToUser: (event: string, data: any) => void
) {
	// Send current download progress as complete state
	emitToUser("ollamaPullProgress", {
		downloadingQuants
	})
}

export async function ollamaSetBaseUrl(
	socket: any,
	message: Sockets.OllamaSetBaseUrl.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		// This would typically update the active Ollama connection's baseUrl
		// For now, we'll just validate the URL format
		const url = new URL(message.baseUrl)
		if (!["http:", "https:"].includes(url.protocol)) {
			emitToUser("error", {
				error: "Invalid URL protocol"
			})
			throw new Error("Invalid URL protocol")
		}

		await db.update(schema.systemSettings).set({
			ollamaManagerBaseUrl: message.baseUrl
		})

		const res: Sockets.OllamaSetBaseUrl.Response = {
			success: true
		}
		emitToUser("ollamaSetBaseUrl", res)
	} catch (error: any) {
		console.error("Ollama set base URL error:", error)
		const res = {
			error: "Failed to set base URL"
		}
		emitToUser("error", res)
	}
}

export async function ollamaModelsList(
	socket: any,
	message: Sockets.OllamaModelsList.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const { ollamaManagerBaseUrl: baseUrl } =
			(await db.query.systemSettings.findFirst())!
		const ollama = new Ollama({
			host: baseUrl
		})

		const result = await ollama.list()
		const res: Sockets.OllamaModelsList.Response = {
			models: result.models || []
		}
		emitToUser("ollamaModelsList", res)
	} catch (error: any) {
		console.error("Ollama models list error:", error)
		const res = {
			error: "Failed to list models"
		}
		emitToUser("error", res)
	}
}

export async function ollamaDeleteModel(
	socket: any,
	message: Sockets.OllamaDeleteModel.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const { ollamaManagerBaseUrl: baseUrl } =
			(await db.query.systemSettings.findFirst())!
		const ollama = new Ollama({
			host: baseUrl
		})

		await ollama.delete({ model: message.modelName })
		const res: Sockets.OllamaDeleteModel.Response = {
			success: true
		}
		emitToUser("ollamaDeleteModel", res)

		await db
			.delete(schema.connections)
			.where(
				and(
					eq(schema.connections.type, "ollama"),
					eq(schema.connections.model, message.modelName)
				)
			)
	} catch (error: any) {
		console.error("Ollama delete model error:", error)
		const res: Sockets.OllamaDeleteModel.Response = {
			success: false
		}
		emitToUser("error", { error: "Failed to delete model" })
	}
}

export async function ollamaConnectModel(
	socket: any,
	message: Sockets.OllamaConnectModel.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1

	try {
		let existingConnection = await db.query.connections.findFirst({
			where: (c, { eq }) =>
				and(eq(c.type, "ollama"), eq(c.model, message.modelName))
		})

		if (!existingConnection) {
			// Parse and create a shorter name for the connection
			const connectionName: string = message.modelName
				.split("/")
				.pop()! as string
			// Create a new connection if it doesn't exist
			const data = {
				...ollamaAdapter.connectionDefaults,
				name: connectionName,
				model: message.modelName
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
		await connectionsList(socket, {}, emitToUser)

		const res: Sockets.OllamaConnectModel.Response = {
			success: true
		}
		emitToUser("ollamaConnectModel", res)
	} catch (error: any) {
		console.error("Ollama connect model error:", error)
		const res = {
			error: "Failed to connect to model"
		}
		emitToUser("error", res)
	}
}

export async function ollamaListRunningModels(
	socket: any,
	message: Sockets.OllamaListRunningModels.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const { ollamaManagerBaseUrl: baseUrl } =
			(await db.query.systemSettings.findFirst())!
		const ollama = new Ollama({
			host: baseUrl
		})

		const result = await ollama.ps()
		const res: Sockets.OllamaListRunningModels.Response = {
			models: result.models || []
		}
		emitToUser("ollamaListRunningModels", res)
	} catch (error: any) {
		console.error("Ollama list running models error:", error)
		const res = {
			error: "Failed to list running models"
		}
		emitToUser("error", res)
	}
}

export async function ollamaPullModel(
	socket: any,
	message: Sockets.OllamaPullModel.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		// Remove from cancelingPulls if it exists
		if (cancelingPulls.includes(message.modelName)) {
			cancelingPulls = cancelingPulls.filter(
				(name) => name !== message.modelName
			)
		}

		// Initialize download tracking
		downloadingQuants[message.modelName] = {
			modelName: message.modelName,
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
			model: message.modelName,
			stream: true
		})

		for await (const chunk of stream) {
			if (cancelingPulls.includes(message.modelName)) {
				cancelingPulls = cancelingPulls.filter(
					(name) => name !== message.modelName
				)
				stream.abort()

				// Update server state
				if (downloadingQuants[message.modelName]) {
					downloadingQuants[message.modelName].status = "cancelled"
					downloadingQuants[message.modelName].isDone = true
				}

				// Emit cancellation with full state
				emitToUser("ollamaPullProgress", {
					downloadingQuants
				})

				return
			}
			// Emit progress updates and update server state
			if (chunk.status) {
				// Update server-side tracking
				if (downloadingQuants[message.modelName]) {
					let fileName: string | undefined

					if (
						chunk.status.includes("pulling ") &&
						!chunk.status.includes("pulling manifest")
					) {
						fileName = chunk.status.split("pulling ")[1]
					}

					downloadingQuants[message.modelName].status = chunk.status
					if (fileName) {
						downloadingQuants[message.modelName].files[fileName] = {
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
		if (downloadingQuants[message.modelName]) {
			downloadingQuants[message.modelName].status = "success"
			downloadingQuants[message.modelName].isDone = true
		}

		// Emit final progress with full state
		emitToUser("ollamaPullProgress", {
			downloadingQuants
		})

		const res: Sockets.OllamaPullModel.Response = {
			success: true
		}
		emitToUser("ollamaPullModel", res)

		const successRes: Sockets.Success.Response = {
			title: "Ollama Manager",
			description: `Model ${message.modelName} downloaded successfully!`
		}
	} catch (error: any) {
		console.error("Ollama pull model error:", error)

		// Update server state for error
		if (downloadingQuants[message.modelName]) {
			downloadingQuants[message.modelName].status = "error"
			downloadingQuants[message.modelName].isDone = true
		}

		// Emit error progress with full state
		emitToUser("ollamaPullProgress", {
			downloadingQuants
		})

		const res: Sockets.OllamaPullModel.Response = {
			success: false,
			error: "Failed to download model"
		}
		emitToUser("ollamaPullModel", res)

		const errorRes: Sockets.Error.Response = {
			error: "Ollama Manager",
			description: "Failed to download model"
		}
		emitToUser("error", errorRes)
	}
}

export async function ollamaVersion(
	socket: any,
	message: Sockets.OllamaVersion.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const { ollamaManagerBaseUrl: baseUrl } =
			(await db.query.systemSettings.findFirst())!
		// const ollama = new Ollama({
		// 	host: baseUrl
		// })
		const response = await fetch(`${baseUrl}/api/version`)

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const result = await response.json()
		const res: Sockets.OllamaVersion.Response = {
			version: result.version
		}
		emitToUser("ollamaVersion", res)
	} catch (error: any) {
		console.error("Ollama version error:", error)
		const res = {
			error: "Failed to connect to Ollama or get version"
		}
		emitToUser("error", res)
	}
}

export async function ollamaIsUpdateAvailable(
	socket: any,
	message: Sockets.OllamaIsUpdateAvailable.Call,
	emitToUser: (event: string, data: any) => void
) {
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

		const res: Sockets.OllamaIsUpdateAvailable.Response = {
			updateAvailable,
			currentVersion: currentVersion,
			latestVersion: latestVersion
		}
		emitToUser("ollamaIsUpdateAvailable", res)
	} catch (error: any) {
		console.error("Ollama update check error:", error)
		const res = {
			error: "Failed to check for updates"
		}
		emitToUser("error", res)
	}
}

export async function ollamaSearchAvailableModels(
	socket: any,
	message: Sockets.OllamaSearchAvailableModels.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const { search, source } = message
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
		}> = []

		if (source === OllamaModelSearchSource.OLLAMA_DB) {
			const response = await fetch(
				`https://ollamadb.dev/api/v1/models?limit=25&search=${encodeURIComponent(search)}`
			)

			if (!response.ok) {
				throw new Error(`OllamaDB API error: ${response.status}`)
			}

			const data = await response.json()

			// console.log("OllamaDB response:", data)

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

			console.log("Hugging Face response:", data)

			const textTags = [
				"text-generation",
				"text-classification",
				"fill-mask",
				"question-answering",
				"summarization",
				"translation",
				"token-classification",
				"conversational",
				"image-text-to-text",
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
			models = models.filter((model) => model.pullOptions.length > 0)
		}

		const res: Sockets.OllamaSearchAvailableModels.Response = {
			models
		}
		emitToUser("ollamaSearchAvailableModels", res)
	} catch (error: any) {
		console.error("Ollama search available models error:", error)
		const res: Sockets.OllamaSearchAvailableModels.Response = {
			models: [],
			error: "Failed to search available models"
		}
		emitToUser("ollamaSearchAvailableModels", res)
	}
}

export async function ollamaClearDownloadHistory(
	socket: any,
	message: Sockets.OllamaClearDownloadHistory.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		// Clear the download progress tracking
		Object.keys(downloadingQuants).forEach((modelName) => {
			if (downloadingQuants[modelName].isDone) {
				delete downloadingQuants[modelName]
			}
		})
		cancelingPulls = []

		const res: Sockets.OllamaClearDownloadHistory.Response = {
			success: true
		}
		emitToUser("ollamaClearDownloadHistory", res)
	} catch (error: any) {
		console.error("Ollama clear download history error:", error)
		const res: Sockets.Error.Response = {
			error: "Failed to clear download history"
		}
		emitToUser("error", res)
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

export async function ollamaCancelPull(
	socket: any,
	message: { modelName: string },
	emitToUser: (event: string, data: any) => void
) {
	try {
		// Add the model to the canceling pulls array
		if (!cancelingPulls.includes(message.modelName)) {
			cancelingPulls.push(message.modelName)
		}

		// If the model is currently downloading, update its status
		if (downloadingQuants[message.modelName]) {
			downloadingQuants[message.modelName].status = "cancelled"
			downloadingQuants[message.modelName].isDone = true
		}

		const res = {
			success: true,
			modelName: message.modelName
		}
		emitToUser("ollamaCancelPull", res)
	} catch (error: any) {
		console.error("Ollama cancel pull error:", error)
		const res = {
			success: false,
			error: "Failed to cancel model download"
		}
		emitToUser("ollamaCancelPull", res)
	}
}
