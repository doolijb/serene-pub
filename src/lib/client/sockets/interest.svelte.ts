/**
 * The interest registry — the ONE client module that holds every socket
 * subscriber, counted per **interest key**.
 *
 * **Interest** is a declared wish to receive one kind of event; an **interest
 * key** is `event` or `event#scope`. The registry owns exactly one raw socket
 * listener per EVENT NAME no matter how many views want it, tells the server
 * its full key list (**interest sync**), and hands each caller a release
 * function. The server keeps the mirror copy (its **interest set**) and its
 * reply helpers consult it — the **interest gate** — before running a query
 * for a **gated event** nobody is listening to.
 *
 * It is not a *lease* (that word means a model permission, NOMENCLATURE §10),
 * not a subscription and not a watch. Interest never expires from silence; it
 * ends when the last subscriber releases, or when the socket disconnects.
 *
 * ## Why a module and not only a context (plan ruling 7)
 *
 * One socket ⇒ one registry. Stores that live in `.svelte.ts` modules cannot
 * call `getContext`, and roughly a third of today's `socket.on` sites are in
 * exactly such stores, so the registry has to be reachable by a plain import.
 * The contexts set up by `AccessibleShell.svelte` and `/admin/+layout.svelte`
 * are thin wrappers over these same functions, so components can take the
 * registry as ambient state rather than as an import, and so the admin-only
 * half does not exist as a context outside the admin tree (ruling 6b).
 *
 * ## Scopes
 *
 * A key may name one **interest scope** — `sessionMessage#42`, the session a
 * view is actually looking at. Which field of a payload that scope comes from
 * is NOT decided here: `SCOPED_EVENTS` in the shared contract is the one table,
 * read by this fan-out and by the server's gate alike, so a scope this registry
 * matches on is the same scope the server looked for. A subscriber on the bare
 * key still receives every scope.
 *
 * ## Restricted interest
 *
 * A key under `RESTRICTED_INTEREST_PREFIXES` is admin-only, and this registry
 * answers one in THREE states, not two — because "user unknown" is not
 * "non-admin", and both shells declare their standing keys at component init,
 * which runs before `users:current` has arrived:
 *
 * - **known non-admin** — refused (ruling 6a): nothing listened for, nothing
 *   sent, and a no-op release.
 * - **known admin** — an ordinary declared key.
 * - **unknown** — no user yet, or logged out — **held restricted interest**:
 *   the subscriber is kept locally, but the key is left out of every interest
 *   sync, so an unidentified session never names a restricted key on the wire.
 *   `setInterestUser` is the answer it waits for: an admin turns every held key
 *   into an ordinary one (an eager sync carries them), a non-admin drops them
 *   exactly as the refusal above would have, warning once, and a change back to
 *   null re-holds instead of sending.
 */
import { dev } from "$app/environment"
import { getContext } from "svelte"
import {
	INTEREST_SYNC_EVENT,
	INTEREST_SYNC_INTERVAL_MS,
	interestKey,
	isRestrictedInterest,
	parseInterestKey,
	scopeOfPayload,
	type InterestKey
} from "$lib/shared/sockets/interest"
import { getSocket } from "./socketInstance"
import type { SocketEventMap } from "./typedSocket"

/** Every event name the typed socket knows. */
export type InterestEvent = keyof SocketEventMap & string

/** What a subscriber is handed. Erased inside the registry, typed at the edge. */
type InterestHandler = (data: any) => void

/** The identity the registry gates restricted interest on. */
export interface InterestUser {
	id: number
	isAdmin?: boolean
}

/**
 * Subscribers per interest key.
 *
 * A plain `Map`/`Set`, not `SvelteMap`/`SvelteSet`: nothing renders from this
 * structure — handlers render, from their own state — so reactivity here would
 * buy nothing and cost a re-render on every mount/unmount in the app.
 *
 * `Set` semantics mean the SAME function reference declared twice on one key
 * counts once, and the first release ends it. Two views wanting one key pass
 * two closures, which is what every real call site does.
 */
const subscribers = new Map<InterestKey, Set<InterestHandler>>()

/**
 * One raw socket listener per EVENT NAME — never per key. `sessions:typing`
 * and `sessions:typing#42` share a listener; it fans the payload out to both.
 */
const rawListeners = new Map<string, (payload: any) => void>()

/**
 * The socket each raw listener is currently attached to — so a listener is
 * registered exactly once per socket, never twice, and a listener declared
 * while `getSocket()` was still null is attached the moment one exists.
 */
const attachedTo = new Map<string, unknown>()

/**
 * **Held restricted interest** — restricted keys declared while the user was
 * still unknown. Their subscribers are live and their raw listener is attached;
 * what holding costs is the WIRE: a held key is in no interest sync, so an
 * unidentified session never names one. `setInterestUser` empties this set, one
 * way or the other (see the header).
 */
const heldRestricted = new Set<InterestKey>()

let user: InterestUser | null = null
let syncQueued = false
let syncTimer: ReturnType<typeof setInterval> | null = null

/**
 * The admin flag the registry gates restricted interest on, set from
 * `Layout.svelte` and `AccessibleShell.svelte` where `userCtx.user` is assigned.
 *
 * It is also the answer **held restricted interest** is waiting for: an admin
 * declares every held key for real, a non-admin drops them as refused, and a
 * change to null (a logout, a user swap) re-holds the restricted keys that were
 * live — an unidentified session is neither an admin's nor a non-admin's.
 *
 * A demotion does not need to sweep already-declared restricted keys beyond
 * that: the server revokes the session and disconnects the socket (which clears
 * its interest set), and its sync handler drops restricted keys from a
 * non-admin socket regardless. This flag is the first of the three checks, not
 * the boundary — the handlers' own admin checks are (ruling 6).
 */
export function setInterestUser(next: InterestUser | null | undefined) {
	user = next ?? null
	if (!user) holdRestrictedInterest()
	else if (user.isAdmin) declareHeldRestricted()
	else dropHeldRestricted()
}

/** The user is unknown again: hold every restricted key rather than send it. */
function holdRestrictedInterest() {
	let held = false
	for (const key of subscribers.keys()) {
		if (!isRestrictedInterest(key) || heldRestricted.has(key)) continue
		heldRestricted.add(key)
		held = true
	}
	// The server still has these keys; the sync that omits them is what takes
	// them out of its set.
	if (held) scheduleSync()
}

/** The user is an admin: every held key becomes an ordinary declared key. */
function declareHeldRestricted() {
	if (heldRestricted.size === 0) return
	heldRestricted.clear()
	// Their listeners are attached and their subscribers are in place already —
	// holding was a wire rule, not a local one — so the eager sync is the whole
	// of what the server was missing.
	scheduleSync()
}

/** The user is not an admin: every held key is dropped, exactly as refused. */
function dropHeldRestricted() {
	if (heldRestricted.size === 0) return
	for (const key of heldRestricted) {
		subscribers.delete(key)
		const { event } = parseInterestKey(key)
		if (!eventHasSubscribers(event)) removeRawListener(event)
		warnRefusedRestricted(key)
	}
	heldRestricted.clear()
	if (subscribers.size === 0) stopSyncTimer()
	// No sync: a held key was never in the server's set, so nothing it knows
	// about has changed.
}

/** Hands a payload to every subscriber of one key, isolating their failures. */
function dispatch(key: InterestKey, payload: unknown) {
	const subs = subscribers.get(key)
	if (!subs || subs.size === 0) return
	// Copied because a handler may release itself (or a sibling) mid-dispatch.
	for (const handler of [...subs]) {
		try {
			handler(payload)
		} catch (err) {
			console.error(`[interest] handler for "${key}" threw:`, err)
		}
	}
}

/** True while any key of this event still has a subscriber. */
function eventHasSubscribers(event: string): boolean {
	for (const key of subscribers.keys()) {
		if (parseInterestKey(key).event === event) return true
	}
	return false
}

function ensureRawListener(event: string) {
	if (rawListeners.has(event)) {
		attachRawListener(event)
		return
	}
	const listener = (payload: any) => {
		// The bare key first — it means every scope — then the one key this
		// payload is about, if the shared table says this event has a scope at
		// all. Both dispatches, one socket listener.
		dispatch(event, payload)
		const scope = scopeOfPayload(event, payload)
		if (scope !== null) dispatch(interestKey(event, scope), payload)
	}
	rawListeners.set(event, listener)
	attachRawListener(event)
}

/**
 * Attaches the event's listener to the live socket, at most once per socket.
 *
 * Socket.IO keeps a socket's listeners across a reconnect, so this must not
 * re-register on every connect — but it must register the ones declared while
 * the socket was still null. Remembering which socket each is attached to
 * covers both without an `off` that could race a live dispatch.
 */
function attachRawListener(event: string) {
	const listener = rawListeners.get(event)
	const socket = getSocket()
	if (!listener || !socket) return
	if (attachedTo.get(event) === socket) return
	socket.on(event, listener)
	attachedTo.set(event, socket)
}

function removeRawListener(event: string) {
	const listener = rawListeners.get(event)
	if (!listener) return
	rawListeners.delete(event)
	attachedTo.delete(event)
	// ⚠ Always with the handler. `off(event)` with no handler removes EVERY
	// listener for that event across the whole app.
	getSocket()?.off(event, listener)
}

/**
 * Every key with at least one subscriber — the whole of what the server stores.
 *
 * Held restricted interest is deliberately absent: it has a subscriber, but
 * until the user is known it is not something this session may name on the wire.
 */
function currentInterestKeys(): InterestKey[] {
	return [...subscribers.keys()].filter((key) => !heldRestricted.has(key))
}

/**
 * Sends the full key list now. Idempotent on the server (a set replace), so a
 * skipped send is never a lost one — the next eager, periodic or connect sync
 * carries the same truth.
 */
export function syncInterest(aheadOfRequest = false) {
	const socket = getSocket()
	if (!socket) return
	// Before the socket is connected, a periodic or microtask sync is skipped
	// (the connect resync carries the same truth). A sync flushed AHEAD OF A
	// REQUEST is not: socket.io buffers every emit made before connect and
	// sends the buffer in order, then fires `connect` — so a request emitted
	// from a page's `onMount` on a cold load would reach the server before
	// the connect resync, and the gate would drop its reply. Buffering the
	// sync too keeps it in front of the request. The connect resync that
	// follows is a harmless duplicate: the server replaces the set.
	if (!socket.connected && !aheadOfRequest) return
	syncQueued = false
	socket.emit(INTEREST_SYNC_EVENT, { keys: currentInterestKeys() })
}

/**
 * Coalesces the key changes of one tick into a single sync. A screen mounting
 * twenty widgets declares twenty keys and sends one packet.
 */
function scheduleSync() {
	if (syncQueued) return
	syncQueued = true
	queueMicrotask(() => {
		if (syncQueued) syncInterest()
	})
}

/**
 * Sends a pending eager sync NOW instead of on its microtask — ruling 3 as a
 * property of the transport rather than of each call site.
 *
 * Every typed `emit` calls this first, so a request can never overtake the
 * interest sync that declares the key its own reply needs, even when the view
 * declared that interest and asked for the data in the same flush.
 * `syncInterest` clears `syncQueued`, so the queued microtask finds nothing to
 * do and no second copy goes out.
 *
 * Idempotent and cheap: with nothing pending — the common case for a
 * fire-and-forget command — it is one boolean read and no packet.
 */
export function flushInterestSync() {
	if (!syncQueued) return
	syncInterest(true)
}

/**
 * The periodic full sync — self-healing only (plan ruling 1). The server never
 * expires a set on silence, so this exists purely so a set that drifted (a
 * dropped packet, a server restart between reconnect hooks) repairs itself
 * within 30s. Started on the first declare, stopped when nothing is held.
 */
function ensureSyncTimer() {
	if (syncTimer !== null) return
	syncTimer = setInterval(() => {
		if (subscribers.size === 0) {
			stopSyncTimer()
			return
		}
		syncInterest()
	}, INTEREST_SYNC_INTERVAL_MS)
}

function stopSyncTimer() {
	if (syncTimer === null) return
	clearInterval(syncTimer)
	syncTimer = null
}

/**
 * Declares interest in one key and returns its release.
 *
 * The event is the type argument, because the key may carry a scope and so is
 * not itself a member of `SocketEventMap`:
 *
 * ```ts
 * const release = declareInterest<"sessions:typing">(
 *     interestKey("sessions:typing", sessionId),
 *     (data) => { … }
 * )
 * ```
 *
 * On 0→1 subscribers for the event it installs the one raw listener; on the
 * last release it removes it with the same reference. The release is
 * idempotent — calling it twice is a no-op, so an unmount path that also runs
 * on error cannot release somebody else's later interest.
 *
 * A restricted key declared by a KNOWN non-admin is refused: nothing is
 * listened for, nothing is sent, and the release is a no-op (ruling 6a). One
 * declared before the user is known is held instead — see the header — and is
 * declared for real or dropped once `setInterestUser` says which.
 */
export function declareInterest<K extends InterestEvent>(
	key: InterestKey,
	handler: (data: SocketEventMap[K]["response"]) => void
): () => void {
	return declareOrRefuse(key, handler) ?? noop
}

const noop = () => {}

/** The one refusal message: from the declare, and from a held key dropped later. */
function warnRefusedRestricted(key: InterestKey) {
	if (!dev) return
	console.warn(
		`[interest] refused restricted interest key "${key}": this user is not an admin`
	)
}

/**
 * The declare itself. Returns `null` — not a no-op release — when the key is
 * refused, so `requestWithInterest` can tell a refusal from a live declaration
 * without warning about it a second time. A HELD key returns a real release: it
 * is declared, just not yet sendable.
 */
function declareOrRefuse(
	key: InterestKey,
	handler: InterestHandler
): (() => void) | null {
	const restricted = isRestrictedInterest(key)
	if (restricted && user && !user.isAdmin) {
		warnRefusedRestricted(key)
		return null
	}

	const { event } = parseInterestKey(key)
	// "User unknown" is not "non-admin": both shells declare their standing keys
	// at init, before `users:current` lands, so a restricted one is HELD — kept
	// locally, kept off the wire — until `setInterestUser` answers.
	if (restricted && !user) heldRestricted.add(key)
	let subs = subscribers.get(key)
	if (!subs) {
		subs = new Set<InterestHandler>()
		subscribers.set(key, subs)
	}
	subs.add(handler)

	ensureRawListener(event)
	ensureSyncTimer()
	scheduleSync()

	let released = false
	return () => {
		if (released) return
		released = true
		const current = subscribers.get(key)
		if (current) {
			current.delete(handler)
			if (current.size === 0) {
				subscribers.delete(key)
				heldRestricted.delete(key)
			}
		}
		if (!eventHasSubscribers(event)) removeRawListener(event)
		if (subscribers.size === 0) stopSyncTimer()
		scheduleSync()
	}
}

/**
 * Asks for data: declare interest in the reply, THEN emit the request.
 *
 * The reply to `characters:list` is emitted as `characters:list` — this
 * codebase answers on the request's own event name — so one event name covers
 * both halves.
 *
 * The sync is flushed **synchronously** here rather than on the usual
 * microtask, which is the whole of ruling 3: the sync packet and the request
 * travel the same socket in that order, Socket.IO delivers them in order, and
 * the server's sync handler stores the set without awaiting, so the handler
 * that answers this request already sees the key. That is why no ack is
 * needed.
 *
 * The emit below is the raw socket, not the typed facade — which is the one
 * path that does not get `flushInterestSync` for free — so the flush is here.
 */
export function requestWithInterest<K extends InterestEvent>(
	event: K,
	params: SocketEventMap[K]["params"],
	handler: (data: SocketEventMap[K]["response"]) => void
): () => void {
	const release = declareOrRefuse(event, handler)
	// Refused restricted interest sends nothing at all — not the sync, and not
	// the request whose reply this user could not receive anyway (ruling 6a).
	if (!release) return noop
	flushInterestSync()
	getSocket()?.emit(event, params)
	return release
}

/**
 * Component form: declares on mount, releases on destroy.
 *
 * ⚠ Must be called during component initialisation, like any other rune —
 * `$effect` outside an initialisation scope throws. In a `.svelte.ts` store,
 * call `declareInterest` directly and keep the release yourself.
 *
 * ⚠ The KEY IS READ ONCE. `key` is an ordinary argument, evaluated by the
 * caller before this effect exists, so nothing inside re-reads it: a view whose
 * scope changes (`sessionMessage#41` → `#42`) keeps the first key and goes
 * silent on the new session. For a key that moves, declare it in your own
 * effect with the id as a dependency, which releases the old key as it takes
 * the new one:
 *
 * ```svelte
 * $effect(() => declareInterest<"sessionMessage">(
 *     interestKey("sessionMessage", sessionId), handler
 * ))
 * ```
 *
 * Left as it is rather than made reactive: a getter argument would be the third
 * calling convention for one function, and the effect above is the whole of the
 * alternative.
 */
export function useInterest<K extends InterestEvent>(
	key: InterestKey,
	handler: (data: SocketEventMap[K]["response"]) => void
): void {
	$effect(() => declareInterest<K>(key, handler))
}

/**
 * Full sync on every connect and reconnect, from `loadSockets.client.ts`.
 *
 * A reconnect gives the server a socket with an empty interest set, so this is
 * not an optimisation — without it every gated event would go dark for views
 * that were already open. It also attaches any raw listener declared while the
 * socket was still null.
 */
export function resyncOnConnect() {
	for (const event of rawListeners.keys()) attachRawListener(event)
	syncInterest()
}

/** The three functions the contexts expose. Identical in both of them. */
export interface InterestContext {
	declareInterest: typeof declareInterest
	requestWithInterest: typeof requestWithInterest
	useInterest: typeof useInterest
}

/** Set by `AccessibleShell.svelte` — available app-wide. */
export const INTEREST_CONTEXT = "interest"

/**
 * Set by `/admin/+layout.svelte` ONLY, so it does not exist outside the admin
 * tree (ruling 6b). Same three functions; the difference is where it is
 * reachable from.
 */
export const ADMIN_INTEREST_CONTEXT = "adminInterest"

export function interestContextValue(): InterestContext {
	return { declareInterest, requestWithInterest, useInterest }
}

/** Typed `getContext` for the app-wide interest context. Call during init. */
export function getInterestContext(): InterestContext {
	return getContext<InterestContext>(INTEREST_CONTEXT)
}

/**
 * Typed `getContext` for the admin-only interest context. Call during init,
 * from inside `/admin/**` — it is undefined anywhere else.
 */
export function getAdminInterestContext(): InterestContext {
	return getContext<InterestContext>(ADMIN_INTEREST_CONTEXT)
}

/** Test seam: forget every subscriber, listener, held key, timer and the user. */
export function _resetInterestForTests() {
	for (const event of [...rawListeners.keys()]) removeRawListener(event)
	subscribers.clear()
	heldRestricted.clear()
	rawListeners.clear()
	attachedTo.clear()
	stopSyncTimer()
	syncQueued = false
	user = null
}
