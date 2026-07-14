import dotenv from "dotenv"
import os from "os"
import * as skio from "sveltekit-io"
import { connectSockets } from "$lib/server/sockets/index"
import { authMiddleware } from "$lib/server/sockets/auth"

dotenv.config()

export function getSocketsHttpMode() {
	const SOCKETS_HTTP_MODE = process.env.SOCKETS_HTTP_MODE
	if (!SOCKETS_HTTP_MODE) return "http"
	const normalized = SOCKETS_HTTP_MODE.trim().toLowerCase()
	if (normalized === "https" || normalized === "http") return normalized
	return "http"
}

export function getSocketsPort() {
	return process.env.SOCKETS_PORT || "3001"
}

export function getPublicSocketsEndpoint(url?: URL) {
	const configured = process.env.PUBLIC_SOCKETS_ENDPOINT?.trim()
	if (configured) return configured
	const protocol =
		getSocketsHttpMode() ||
		(url ? url.protocol.replace(":", "") : "http")
	const hostname = url?.hostname || "localhost"
	return `${protocol}://${hostname}:${getSocketsPort()}`
}

export async function loadSocketsServer() {
	// Mirrors @sveltejs/adapter-node's own HOST env var (default 0.0.0.0) so a
	// single HOST=127.0.0.1 locks down both the main app server and this socket
	// server together — previously this was hardcoded to 0.0.0.0 with no way to
	// restrict it at all, even for deployments (like the Android wrapper) that
	// only ever need loopback access.
	const bindHost = process.env.HOST || "0.0.0.0"
	const host = `${getSocketsHttpMode()}://${bindHost}:${getSocketsPort()}`

	const io = await skio.setup(host, {
		cors: { origin: "*", credentials: false },
		maxHttpBufferSize: 1e8
	})

	// Add authentication middleware
	if ("use" in io && typeof io.use === "function") {
		io.use(authMiddleware as any)
	}

	if (typeof (io as any).to !== "function") {
		;(io as any).to = () => ({ emit: () => {} })
	}

	connectSockets(io as any)
	if (process.env.NODE_ENV !== "production") {
		console.log("Socket server ready at", host)
	}

	// Auto-load embedding model on startup if vectorization was previously enabled
	autoLoadEmbeddingModel()
}

async function autoLoadEmbeddingModel() {
	try {
		const { db } = await import("$lib/server/db")
		const { schema } = await import("$lib/server/db")
		const { eq } = await import("drizzle-orm")
		const settings = await db.query.systemSettings.findFirst({
			where: eq(schema.systemSettings.id, 1),
			columns: { vectorizationEnabled: true, embeddingModelName: true }
		})

		if (!settings?.vectorizationEnabled || !settings.embeddingModelName) return

		const { setEmbeddingTtlMinutes } = await import("$lib/server/embedding/index")

		const vecConfig = await db.query.vectorizationConfigs.findFirst({
			where: eq(schema.vectorizationConfigs.id, 1),
			columns: {
				embeddingModelTtlMinutes: true,
				mode: true,
				apiBaseUrl: true,
				apiKey: true,
				apiModel: true
			}
		})
		// Load TTL config before loading the model so the timer starts correctly
		if (vecConfig) setEmbeddingTtlMinutes(vecConfig.embeddingModelTtlMinutes)

		if (vecConfig?.mode === "api") {
			if (!vecConfig.apiBaseUrl || !vecConfig.apiModel) {
				throw new Error("API vectorization is enabled but not fully configured")
			}
			console.log(
				`[embedding] Auto-activating API backend on startup: ${vecConfig.apiBaseUrl}`
			)
			const { activateApiEmbedding } = await import("$lib/server/embedding/index")
			await activateApiEmbedding({
				baseUrl: vecConfig.apiBaseUrl,
				apiKey: vecConfig.apiKey,
				model: vecConfig.apiModel
			})
		} else {
			console.log(
				`[embedding] Auto-loading model on startup: ${settings.embeddingModelName}`
			)
			const { loadEmbeddingModel } = await import("$lib/server/embedding/index")
			await loadEmbeddingModel(settings.embeddingModelName)
		}
		console.log("[embedding] Model ready.")
	} catch (err) {
		console.error(
			"[embedding] Failed to auto-load embedding backend on startup — vectorization will be unavailable until reconfigured:",
			err
		)
	}
}
