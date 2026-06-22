import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"
import type { InsertConnection } from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { connectionsList, connectionsSetUserActive } from "./connections"
import koboldCppAdapter from "$lib/server/connectionAdapters/KoboldCppAdapter"

// --- KOBOLDCPP MANAGER HANDLERS ---
// These handlers assume KoboldCPP is already running externally.
// They manage the connection, model hot-swap, version, and update checks.

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
			emitToUser("koboldcpp:setBaseUrl:error", {
				error: "Invalid URL protocol"
			})
			throw new Error("Invalid URL protocol")
		}

		await db
			.update(schema.systemSettings)
			.set({ koboldCppManagerBaseUrl: params.baseUrl })

		const res: Sockets.KoboldCpp.SetBaseUrl.Response = {
			success: "Base URL updated successfully"
		}
		emitToUser("koboldcpp:setBaseUrl", res)
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
			(await db.query.systemSettings.findFirst())!

		const response = await fetch(`${baseUrl}/api/extra/version`, {
			signal: AbortSignal.timeout(5000)
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = await response.json()
		const res: Sockets.KoboldCpp.Version.Response = {
			version: data.version || data.result || "unknown"
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
			(await db.query.systemSettings.findFirst())!

		// Get running version
		const versionResp = await fetch(`${baseUrl}/api/extra/version`, {
			signal: AbortSignal.timeout(5000)
		})

		if (!versionResp.ok) {
			throw new Error(`Cannot reach KoboldCPP at ${baseUrl}`)
		}

		const versionData = await versionResp.json()
		const currentVersion: string = versionData.version || versionData.result || ""

		// Get latest release from GitHub
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
		const { koboldCppManagerBaseUrl: baseUrl } =
			(await db.query.systemSettings.findFirst())!

		// Get currently loaded model
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
			// KoboldCPP may be offline — return empty gracefully
		}

		// Get available .kcpps config files
		let availableConfigs: string[] = []
		try {
			const configsResp = await fetch(`${baseUrl}/api/admin/list_options`, {
				signal: AbortSignal.timeout(5000)
			})
			if (configsResp.ok) {
				availableConfigs = await configsResp.json()
			}
		} catch {
			// Not a fatal error — KoboldCPP may not expose this endpoint in all builds
		}

		const res: Sockets.KoboldCpp.ListModels.Response = {
			currentModel,
			availableConfigs
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
		const { koboldCppManagerBaseUrl: baseUrl } =
			(await db.query.systemSettings.findFirst())!

		const response = await fetch(`${baseUrl}/api/admin/reload_config`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ filename: params.filename }),
			signal: AbortSignal.timeout(30000) // model loading can take time
		})

		if (!response.ok) {
			const text = await response.text()
			throw new Error(`Failed to load model: ${response.status} ${text}`)
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
		const { koboldCppManagerBaseUrl: baseUrl } =
			(await db.query.systemSettings.findFirst())!

		// Find or create a connection for this model name
		let existingConnection = await db.query.connections.findFirst({
			where: (c, { and, eq }) =>
				and(
					eq(c.type, "koboldcpp"),
					eq(c.model, params.modelName),
					eq(c.baseUrl, baseUrl)
				)
		})

		if (!existingConnection) {
			const connectionName = params.modelName
				.replace(/\.kcpps$/i, "")
				.split(/[\\/]/)
				.pop()!

			const data: InsertConnection = {
				...koboldCppAdapter.connectionDefaults,
				name: connectionName,
				model: params.modelName,
				baseUrl
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

		const res: Sockets.KoboldCpp.ConnectModel.Response = {
			success: "Model connected successfully"
		}
		emitToUser("koboldcpp:connectModel", res)
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
	register(socket, koboldCppSetBaseUrl, emitToUser)
	register(socket, koboldCppVersionHandler, emitToUser)
	register(socket, koboldCppIsUpdateAvailableHandler, emitToUser)
	register(socket, koboldCppListModelsHandler, emitToUser)
	register(socket, koboldCppLoadModelHandler, emitToUser)
	register(socket, koboldCppConnectModelHandler, emitToUser)
}
