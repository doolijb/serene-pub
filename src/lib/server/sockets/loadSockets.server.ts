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
	const host = `${getSocketsHttpMode()}://0.0.0.0:${getSocketsPort()}`

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
}
