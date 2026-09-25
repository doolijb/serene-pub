/**
 * The page's UI workers (§3.5, R35, C2): one per OWNER — core, or one
 * plugin — started on that owner's first mount and terminated shortly after
 * its last one goes (the session page leaving takes them all). Every mount of
 * an owner shares its worker; each has its own id, receiver and port.
 */
import bootUrl from "./uiWorker.ts?worker&url"
import { SP_HOST_ELEMENTS, type HostElementSpec } from "@serene-pub/sdk"
import type { HostToWorker, WorkerToHost } from "@serene-pub/sdk"

interface Held {
	worker: Worker
	mounts: number
	timer?: ReturnType<typeof setTimeout>
}

const workers = new Map<string, Held>()
const routes = new Map<string, (m: WorkerToHost) => void>()

/** How long an owner's worker outlives its last mount — a layout move remounts. */
const LINGER_MS = 2_000

function start(owner: string): Worker {
	const worker = new Worker(`/ui-worker?boot=${encodeURIComponent(bootUrl)}`, {
		type: "module",
		name: `sp-ui:${owner}`
	})
	worker.onmessage = (e: MessageEvent<WorkerToHost>) => {
		const m = e.data
		if (m && typeof m === "object" && typeof m.mountId === "string") routes.get(m.mountId)?.(m)
	}
	worker.onerror = (e) => console.warn(`UI worker for ${owner}: ${e.message}`)
	return worker
}

/** Take a reference on the owner's worker, starting it if needed. */
export function acquireWorker(owner: string): Worker {
	let held = workers.get(owner)
	if (!held) {
		held = { worker: start(owner), mounts: 0 }
		workers.set(owner, held)
	}
	if (held.timer) clearTimeout(held.timer)
	held.timer = undefined
	held.mounts++
	return held.worker
}

/** Give a reference back; the last one lets the worker go after a moment. */
export function releaseWorker(owner: string): void {
	const held = workers.get(owner)
	if (!held) return
	held.mounts = Math.max(0, held.mounts - 1)
	if (held.mounts > 0) return
	held.timer = setTimeout(() => {
		if (held.mounts > 0) return
		held.worker.terminate()
		// Only THIS worker's entry: the page may have left and come back,
		// and the owner may already have a new one.
		if (workers.get(owner) === held) workers.delete(owner)
	}, LINGER_MS)
}

export function postToWorker(worker: Worker, m: HostToWorker, transfer: Transferable[] = []): void {
	worker.postMessage(m, transfer)
}

export function routeMount(mountId: string, handler: (m: WorkerToHost) => void): () => void {
	routes.set(mountId, handler)
	return () => routes.delete(mountId)
}

/** Every worker, now — the session page leaving. */
export function terminateAllWorkers(): void {
	for (const held of workers.values()) {
		if (held.timer) clearTimeout(held.timer)
		held.worker.terminate()
	}
	workers.clear()
}

/**
 * The event being dispatched right now, as the host saw it — so a remote
 * listener, which Remote DOM calls with `event.detail` only, can be answered
 * with the host's own summary and trusted-ness. Captured at `window` for
 * every event the vocabulary raises, portalled panels included.
 */
let current: Event | undefined
let listening = false
/** The event being dispatched, when it is of this type. */
export function currentEvent(type?: string): Event | undefined {
	return current && (type === undefined || current.type === type) ? current : undefined
}
export function listenForRemoteEvents(): void {
	if (listening) return
	listening = true
	const types = new Set<string>()
	for (const spec of Object.values(SP_HOST_ELEMENTS) as HostElementSpec[]) for (const e of spec.events) types.add(e)
	for (const type of types)
		window.addEventListener(
			type,
			(e) => {
				current = e
				// Cleared on the next TASK, not a microtask: for an event a
				// person caused, the browser runs a microtask checkpoint after
				// every listener, which would clear it before the target's.
				setTimeout(() => {
					if (current === e) current = undefined
				}, 0)
			},
			{ capture: true }
		)
}
