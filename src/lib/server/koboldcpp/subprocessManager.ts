/**
 * KoboldCPP's spec over the shared supervisor (`$lib/server/managed/supervisor`).
 *
 * Everything service-neutral — spawn, process trees, reaping of a process
 * left by a previous session, health check, idle auto-stop, Stop, the HMR-safe
 * shared state — lives in the supervisor. This file keeps only what is
 * KoboldCPP's: its settings row, its admin password, its arguments, its ping,
 * and dropping which model it held when its process goes.
 *
 * The shared state keeps its historic `globalThis` key so a live process stays
 * tracked across the HMR that shipped the extraction.
 */
import * as path from "path"
import { randomUUID } from "crypto"
import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	createSupervisor,
	type SupervisorStatus,
	type SupervisorStatusEvent
} from "$lib/server/managed/supervisor"
import { pingKoboldCPP } from "./kcppHttp"
import { forgetResidency } from "./modelManager"
import { managedBaseUrl } from "./managedEndpoint"
import {
	createUserEmitters,
	type UserEmitterSlot
} from "$lib/server/managed/emitters"

export type SubprocessStatus = SupervisorStatus
export type SubprocessStatusEvent = SupervisorStatusEvent

/** The admin password `prepare` settled on for the spawn about to happen. */
let launchPassword = ""

async function settings() {
	return db.query.koboldCppSettings.findFirst()
}

/** The last co-load decision's sentence; null until one is made or after the process goes. */
let coLoadReason: string | null = null

const supervisor = createSupervisor({
	id: "koboldcpp",
	label: "KoboldCPP",
	globalKey: "__SERENE_PUB_KCPP_SUBPROCESS__",
	pidFileName: ".managed-subprocess.pid",

	async gate() {
		const s = await settings()
		return !s?.koboldCppManagerEnabled || s?.koboldCppManagedMode !== "managed"
			? "Managed mode is not enabled"
			: null
	},

	async binaryPath() {
		const s = await settings()
		const dir = s?.koboldCppManagedBinaryDir
		const variant = s?.koboldCppManagedBinaryVariant
		return dir && variant ? path.join(dir, variant) : null
	},

	async port() {
		return (await settings())?.koboldCppManagedPort ?? 5001
	},

	async prepare() {
		const s = await settings()
		let password = s?.koboldCppManagedAdminPassword
		if (!password) {
			// Mirrors koboldCppSetManagedMode's generation — a missing password
			// here (e.g. cleared while already in managed mode) must not silently
			// fall back to a shared, predictable literal on the next spawn.
			password = randomUUID().replace(/-/g, "")
			await db
				.update(schema.koboldCppSettings)
				.set({ koboldCppManagedAdminPassword: password })
				.where(eq(schema.koboldCppSettings.id, 1))
		}
		launchPassword = password
		// The address is made from the port. A row edited before that rule (or by
		// any path that skipped it) is repaired here, as the process gets its port.
		const wanted = managedBaseUrl(s?.koboldCppManagedPort)
		if (s?.koboldCppManagerBaseUrl !== wanted) {
			await db
				.update(schema.koboldCppSettings)
				.set({ koboldCppManagerBaseUrl: wanted })
				.where(eq(schema.koboldCppSettings.id, 1))
		}
	},

	async idleTimeoutMs() {
		const s = await settings()
		return (s?.koboldCppManagedSubprocessTimeoutSecs ?? 1800) * 1000
	},

	ping: (baseUrl, timeoutMs) => pingKoboldCPP(baseUrl, timeoutMs),

	onProcessGone: () => {
		forgetResidency()
		coLoadReason = null
	},

	async args() {
		const s = await settings()
		const binaryDir = s?.koboldCppManagedBinaryDir as string
		const port = s?.koboldCppManagedPort ?? 5001
		// --admindir must be explicit: koboldcpp's admin reload/list-options endpoints jail
		// requests to this directory, and ensureModelLoaded() writes its .kcpps files here.
		// --host is bound to loopback only: the app always reaches this subprocess via
		// localhost (see pingKoboldCPP calls), and koboldcpp's own generation/completion
		// endpoints (e.g. /lcpp/) aren't gated by --adminpassword, so binding 0.0.0.0 would
		// expose an unauthenticated inference API to the whole LAN on non-Docker deployments.
		return [
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--admin",
			"--adminpassword",
			launchPassword,
			"--admindir",
			binaryDir,
			"--nomodel",
			// Without this, koboldcpp renders /v1/chat/completions through its
			// own generic built-in formatter instead of the loaded model's real
			// chat template — which it already auto-extracts from the GGUF on
			// every model load (handle.get_chat_template(), unconditional, no
			// extra config needed) but silently never uses without this flag.
			// Scoped to the chat-completions endpoint only (koboldcpp's own
			// docs: "Other endpoints are unaffected. Tool calls are done
			// without jinja."), so this only matters for connections with "Use
			// Chat Mode" on — which is this app's own default. Model-specific
			// template behavior (eg. Gemma 4's <|think|> enable_thinking
			// token) is otherwise completely inert regardless of what this app
			// sends in the request body.
			"--jinja"
			// NO --sdmodel here, deliberately. The process is spawned with --nomodel
			// and every model — text or image — arrives through the admin
			// reload_config path in modelManager.ts, which rebuilds the whole arg set
			// from its .kcpps file. A spawn-time --sdmodel would be wiped by the first
			// load and would only ever have applied to a window in which nothing can
			// generate anyway.
		]
	}
})

export const checkForOrphanOnBoot = supervisor.checkForOrphanOnBoot

type CoLoadStatusEvent = SubprocessStatusEvent & {
	coLoadReason: string | null
}

// Survives Vite SSR HMR like the supervisor's own registry does.
const COLOAD_EMITTERS_KEY = "__SERENE_PUB_KCPP_COLOAD_EMITTERS__"
const coLoadEmitters = createUserEmitters<CoLoadStatusEvent>(
	((globalThis as any)[COLOAD_EMITTERS_KEY] ??= new Map<
		number,
		UserEmitterSlot<CoLoadStatusEvent>
	>())
)

export function getStatus(): CoLoadStatusEvent {
	return { ...supervisor.getStatus(), coLoadReason }
}

/** Every supervisor push carries the co-load sentence; so does the local one. */
export function registerEmitter(
	userId: number,
	fn: (s: CoLoadStatusEvent) => void
): void {
	supervisor.registerEmitter(userId, (s) => fn({ ...s, coLoadReason }))
	coLoadEmitters.register(userId, fn)
}

export function unregisterEmitter(userId: number): void {
	supervisor.unregisterEmitter(userId)
	coLoadEmitters.unregister(userId)
}

/** Remember why the last load kept or dropped the other model, and push it. */
export function noteCoLoadReason(reason: string): void {
	coLoadReason = reason
	coLoadEmitters.emit(getStatus())
}
export const isRunning = supervisor.isRunning
export const pingActivity = supervisor.pingActivity
export const suspendHealthCheck = supervisor.suspendHealthCheck
export const resumeHealthCheck = supervisor.resumeHealthCheck
export const start = supervisor.start
export const stop = supervisor.stop

export function setSubprocessTimeout(secs: number) {
	supervisor.setIdleTimeoutSecs(secs)
}
