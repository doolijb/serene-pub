/**
 * The page's UI workers (§3.5, R35, C2): one per OWNER — core, or one
 * plugin — started on that owner's first mount and terminated shortly after
 * its last one goes (the session page leaving takes them all). Every mount of
 * an owner shares its worker; each has its own id, receiver and port.
 *
 * A worker's ES module map keeps every module URL it ever imported, for its
 * life — and an authored component is a new URL on every save (C6, P5: the
 * artifact hash is in it). So a worker is RECYCLED once it has imported
 * {@link RECYCLE_AFTER} distinct modules and a mount asks for one more: it
 * leaves the owner's slot (the next acquire starts a fresh one) and is
 * terminated when the last mount still running on it is released — never
 * under a live mount. A release names the worker it took, so it is counted
 * against that worker, not against whichever the owner holds now.
 */
import bootUrl from "./uiWorker.ts?worker&url"
import {
	REDELIVERED_EVENTS,
	SP_HOST_ELEMENTS,
	hostKeyEvent,
	keyedInputTarget,
	redeliveredCopy,
	redeliveryTarget,
	type HostElementSpec
} from "@serene-pub/sdk"
import type { HostToWorker, WorkerToHost } from "@serene-pub/sdk"
import { vouchFor } from "$lib/client/components/hostElements/activation"

interface Held {
	worker: Worker
	mounts: number
	timer?: ReturnType<typeof setTimeout>
	/** Every distinct module URL a mount on this worker asked it to import. */
	entries: Set<string>
}

const workers = new Map<string, Held>()
/**
 * Recycled workers still running a mount, by worker — out of their owner's
 * slot, terminated when their last mount is released.
 */
const retired = new Map<Worker, Held>()

/**
 * How many distinct modules a worker imports before a mount asking for one
 * more gets a fresh worker (C6, P5): twenty saves of an authored component
 * while its session page stays open. Core's own modules and a plugin's few
 * never come near it.
 */
export const RECYCLE_AFTER = 20
const routes = new Map<string, (m: WorkerToHost) => void>()

/** How long an owner's worker outlives its last mount — a layout move remounts. */
const LINGER_MS = 2_000

/**
 * `bootUrl` as the path `/ui-worker` accepts (same-origin, starting `/`).
 * Dev hands `?worker&url` over as a root path, but a production build turns
 * it into an absolute URL (`new URL(…, import.meta.url).href`, SvelteKit's
 * relative asset paths) — which the route refuses with a 404, so no core or
 * plugin widget ever mounted in a built app.
 */
function bootPath(): string {
	const u = new URL(bootUrl, location.href)
	return u.origin === location.origin ? u.pathname + u.search : bootUrl
}

function start(owner: string): Worker {
	const worker = new Worker(
		`/ui-worker?boot=${encodeURIComponent(bootPath())}`,
		{
			type: "module",
			name: `sp-ui:${owner}`
		}
	)
	worker.onmessage = (e: MessageEvent<WorkerToHost>) => {
		const m = e.data
		if (m && typeof m === "object" && typeof m.mountId === "string")
			routes.get(m.mountId)?.(m)
	}
	worker.onerror = (e) => console.warn(`UI worker for ${owner}: ${e.message}`)
	return worker
}

/**
 * Take a reference on the owner's worker, starting it if needed. `entry` is
 * the module the mount will import: a worker that already imported
 * {@link RECYCLE_AFTER} others is recycled first (see the module note).
 */
export function acquireWorker(owner: string, entry?: string): Worker {
	let held = workers.get(owner)
	if (
		held &&
		entry !== undefined &&
		!held.entries.has(entry) &&
		held.entries.size >= RECYCLE_AFTER
	) {
		retire(owner, held)
		held = undefined
	}
	if (!held) {
		held = { worker: start(owner), mounts: 0, entries: new Set() }
		workers.set(owner, held)
	}
	if (held.timer) clearTimeout(held.timer)
	held.timer = undefined
	held.mounts++
	if (entry !== undefined) held.entries.add(entry)
	return held.worker
}

/** Out of the owner's slot; terminated now if nothing runs on it, else by its last release. */
function retire(owner: string, held: Held): void {
	if (workers.get(owner) === held) workers.delete(owner)
	if (held.timer) clearTimeout(held.timer)
	held.timer = undefined
	if (held.mounts > 0) retired.set(held.worker, held)
	else held.worker.terminate()
}

/**
 * Give a reference back; the last one lets the worker go after a moment.
 * `worker` is the one the mount took: a recycled worker's mounts are counted
 * against it, never against the owner's fresh one.
 */
export function releaseWorker(owner: string, worker?: Worker): void {
	const old = worker ? retired.get(worker) : undefined
	if (old) {
		old.mounts = Math.max(0, old.mounts - 1)
		if (old.mounts > 0) return
		retired.delete(worker!)
		old.worker.terminate()
		return
	}
	const held = workers.get(owner)
	if (!held) return
	// A worker neither held nor retired is one already gone (the page left).
	if (worker && held.worker !== worker) return
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

export function postToWorker(
	worker: Worker,
	m: HostToWorker,
	transfer: Transferable[] = []
): void {
	worker.postMessage(m, transfer)
}

export function routeMount(
	mountId: string,
	handler: (m: WorkerToHost) => void
): () => void {
	routes.set(mountId, handler)
	return () => routes.delete(mountId)
}

/** Every worker, now — the session page leaving. */
export function terminateAllWorkers(): void {
	for (const held of [...workers.values(), ...retired.values()]) {
		if (held.timer) clearTimeout(held.timer)
		held.worker.terminate()
	}
	workers.clear()
	retired.clear()
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
	return current && (type === undefined || current.type === type)
		? current
		: undefined
}
/**
 * The receiver forwards an event only from the node that listens for it —
 * and only the vocabulary's listeners exist (a button hears `click`; the
 * `span` label inside it does not, nor the `svg` an icon draws for itself).
 * A click on a button's label or icon was lost. So a click that starts on a
 * node that does not take it is re-delivered, unbubbling, to the nearest node
 * the component placed that does (the SDK's `redeliveryTarget`, shared with
 * the component harness); the worker bubbles it from there as a document
 * would. Only inside a remote's territory — its box, or a panel one of its
 * elements portaled out (`data-sp-owner` on both) — never the page's own markup.
 * The copy is not a `MouseEvent` (`redeliveredCopy`): a synthetic click runs
 * a link's activation, and the person's own click then runs it again. The
 * person's own event stays `current`, so `fnFor` and the gate read it.
 */
const RETARGETED = new WeakSet<Event>()
const isRetargeted = (e: Event) => RETARGETED.has(e)
function retarget(e: Event) {
	if (isRetargeted(e)) return
	const origin = e.target as Node | null
	const originEl =
		origin &&
		(origin.nodeType === 1 ? (origin as Element) : origin.parentElement)
	const territory = originEl?.closest("[data-sp-owner]")
	if (!origin || !territory) return
	const to = redeliveryTarget(origin, e.type, territory)
	if (!to) return
	const copy = redeliveredCopy(e)
	RETARGETED.add(copy)
	to.dispatchEvent(copy)
	if (copy.defaultPrevented) e.preventDefault()
}

/**
 * A plain `input` a remote placed with `keys` (R80): a press its `keys` names
 * is the widget's — kept from the field and raised on it as `key`, which the
 * receiver forwards like any event the input takes. Read by the SDK's one
 * reading (`keyedInputTarget`, shared with the component harness and, through
 * `hostKeysMatch`, with `sp-composer-field`); every other key stays the
 * field's, so a number field still steps on its arrows. Inside a remote's
 * territory only — a panel one of its elements portaled out included. A
 * trusted press is a person's, so the box's gate counts it as one.
 */
function raiseKey(e: KeyboardEvent) {
	const origin = e.target as Element | null
	const territory =
		origin?.nodeType === 1 ? origin.closest("[data-sp-owner]") : null
	if (!territory) return
	const to = keyedInputTarget(e, territory)
	if (!to) return
	e.preventDefault()
	if (e.isTrusted) vouchFor(to)
	to.dispatchEvent(hostKeyEvent(e))
}

export function listenForRemoteEvents(): void {
	if (listening) return
	listening = true
	const types = new Set<string>()
	for (const spec of Object.values(SP_HOST_ELEMENTS) as HostElementSpec[])
		for (const e of spec.events) types.add(e)
	for (const type of types)
		window.addEventListener(
			type,
			(e) => {
				// A re-delivered copy (`retarget`) is not the person's event: the
				// original stays current, so the gate still reads who pressed.
				if (isRetargeted(e)) return
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
	// Every type above is recorded; only these are re-delivered.
	for (const type of REDELIVERED_EVENTS)
		document.addEventListener(type, retarget, { capture: true })
	window.addEventListener("keydown", raiseKey, { capture: true })
}
