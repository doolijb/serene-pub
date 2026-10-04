/**
 * One session's stats and states (an inventory is one), read once and shared.
 *
 * ## One read, one resolver
 *
 * A value's meaning depends on layers no client can see: one edit can move
 * several reads, and a derived slot changes with no row written at all. So
 * nothing here patches a value off a mutation reply — every write is followed
 * by a re-read, and `state:changed` (which carries no payload but the session)
 * is the signal to take it. The server owns the one resolution; this module is
 * a cache of its last answer.
 *
 * ## Module-scoped, because a session has one state
 *
 * Three widgets, a ledger line under every message and a review panel all want
 * the same answer. A store per component would be four subscriptions racing
 * over one event and four copies drifting apart; this is one subscription and
 * one copy. Switching sessions re-seeds it, because the answer is about a
 * session and not about the tab.
 *
 * ## Every listener is an interest, and `state:changed` names its session
 *
 * Nothing here touches the socket directly any more: the interest registry owns
 * the listeners, and the server skips a `state:*` query no open surface asked
 * for. The one key worth explaining is `state:changed`, declared with the open
 * session as its **interest scope** (`state:changed#42`). The server extracts
 * the same scope from the payload it broadcasts — one table, `SCOPED_EVENTS` in
 * the shared contract, read by both sides — so a write in a session this tab
 * does not have open is never sent here, and the two roster queries behind the
 * broadcast are not run for it either. The key is re-declared when the open
 * session changes, and released with the last one when there is none.
 *
 * `mine()` stays on every handler regardless: replies to this store's own
 * requests are not scoped, and a check that costs a comparison is worth keeping
 * in front of a cache that answers for one session.
 */
import { SvelteMap } from "svelte/reactivity"
import {
	declareInterest,
	requestWithInterest
} from "$lib/client/sockets/interest.svelte"
import { interestKey } from "$lib/shared/sockets/interest"
import { typedSocketOrNull } from "$lib/client/sockets/typedSocket"
import {
	groupLinesByOwner,
	ledgerLines,
	linesByMessage,
	type LedgerLine
} from "$lib/shared/state/ledgerLines"

type Resolved = Sockets.State.ResolvedState
type Descriptor = Sockets.State.SlotDescriptor
type OwnerRow = Sockets.State.StateOwnerRow
type Proposal = Sockets.State.ProposalRow

const EMPTY: Resolved = { world: {}, cast: {} }

/** Which session every answer below is about; null before one is opened. */
let openSessionId = $state<number | null>(null)
let state = $state<Resolved>(EMPTY)
let loaded = $state(false)
let lastError = $state<string | null>(null)
/**
 * Why the last READ failed (`state:get:error`) — beside `lastError`, which
 * every failure writes. What a widget is handed as `session_state.v1.error`:
 * a write's failure is that write's own (R77), never a line every widget shows.
 */
let readError = $state<string | null>(null)

/**
 * The writes this tab has sent and not yet heard back about, by the
 * `requestId` each was sent with.
 *
 * Matched by ID, never by order: the server's handlers are async and
 * unserialised, and a reply reaches every tab of the user (a refusal only
 * the tab that asked) — so the next one to arrive may be another write's, or
 * another tab's. The
 * server echoes the id on both (`state:set` and `state:set:error`), and a
 * reply settles the one write it names and nothing else. An `ownError` write
 * reports its refusal to its caller alone; any other keeps the store-wide
 * `lastError`.
 */
interface PendingSet {
	ownError: boolean
	resolve: () => void
	reject: (e: Error) => void
	timer: ReturnType<typeof setTimeout>
}
const pendingSets = new Map<string, PendingSet>()
/**
 * This tab's native writes that timed out in the session still open: a
 * refusal arriving after its caller was told "unanswered" is still said
 * store-wide, as a native write's refusal always was. (A widget's write owns
 * its error, R77 — its caller already heard, so its late refusal is dropped.)
 */
const lateNativeSets = new Set<string>()
/** How long a write may go unanswered before its caller is told so. */
const SET_TIMEOUT_MS = 15_000
/**
 * The stem of this store's write ids: random per tab, so another tab's id
 * — which reaches this tab too — never names a write of this one.
 */
const WRITE_ID_STEM = `set-${Math.random().toString(36).slice(2, 10)}-`
let writesSent = 0

/** Settle the write `requestId` names, if it is still waiting here. */
function settleSet(requestId: unknown, error?: string): PendingSet | undefined {
	if (typeof requestId !== "string") return undefined
	const entry = pendingSets.get(requestId)
	if (!entry) return undefined
	pendingSets.delete(requestId)
	clearTimeout(entry.timer)
	if (error === undefined) entry.resolve()
	else entry.reject(new Error(error))
	return entry
}

/** Every write still waiting is abandoned — the session it was about has gone. */
function abandonPendingSets(why: string): void {
	const abandoned = [...pendingSets.values()]
	pendingSets.clear()
	lateNativeSets.clear()
	for (const entry of abandoned) {
		clearTimeout(entry.timer)
		entry.reject(new Error(why))
	}
}

/* SvelteMap, not a plain Map in `$state`: a plain Map's `set`/`delete` are
   invisible to the runtime, so a widget reading one would render the first
   answer and never the second. */
const slots = new SvelteMap<string, Descriptor>()
const owners = new SvelteMap<string, OwnerRow>()
const proposals = new SvelteMap<number, Proposal>()
const messageLines = new SvelteMap<number, LedgerLine[]>()

let started = false

function socketOrNull() {
	// SSR and the moment before the client socket connects both land here; the
	// next caller starts it, so nothing is lost by declining now.
	return typedSocketOrNull()
}

const mine = (sessionId: unknown): boolean =>
	openSessionId != null && sessionId === openSessionId

/* Named handlers, registered exactly once. */

function onGet(res: Sockets.State.Get.Response) {
	if (!mine(res?.sessionId)) return
	reading = false
	readError = null
	state = res.state ?? EMPTY
	slots.clear()
	for (const slot of res.slots ?? []) slots.set(slot.slotId, slot)
	owners.clear()
	for (const owner of res.owners ?? []) owners.set(owner.key, owner)
	loaded = true
}

function onProposals(res: Sockets.State.Proposals.Response) {
	if (!mine(res?.sessionId)) return
	proposals.clear()
	for (const row of res.proposals ?? []) proposals.set(row.id, row)
}

function onLedger(res: Sockets.State.Ledger.Response) {
	if (!mine(res?.sessionId)) return
	const byMessage = linesByMessage(
		ledgerLines(res.rows ?? [], res.baselines ?? [])
	)
	messageLines.clear()
	for (const [messageId, lines] of byMessage)
		messageLines.set(messageId, lines)
}

/**
 * A write landed somewhere in this session. Re-read rather than patch: what
 * moved is not in the payload, and it is not in the payload because one edit
 * can move several reads.
 */
function onChanged(res: Sockets.State.Changed.Response) {
	if (!mine(res?.sessionId)) return
	refresh()
}

/**
 * A mutation answers with the whole resolved state; the gate answers with that
 * and the remaining proposals.
 *
 * Taken for the immediacy, not for correctness: the same write also broadcasts
 * `state:changed` to everyone in the session — the writer included — and that
 * is what re-reads the ledger rows no mutation reply carries.
 */
function onSettled(res: {
	sessionId?: number
	state?: Resolved
	proposals?: Proposal[]
}) {
	if (!mine(res?.sessionId)) return
	if (res.state) state = res.state
	if (res.proposals) {
		proposals.clear()
		for (const row of res.proposals) proposals.set(row.id, row)
	}
}

function onError(res: Sockets.ErrorResponse) {
	lastError = res?.error ?? "That did not work."
}

/**
 * A read failed: said store-wide as before, and kept as the read's own.
 *
 * Only a failure of a read of THIS session: the refusal reaches the tab that
 * read, so one that names another session (a late one for the session this
 * tab just left) is not this one's to show. One that
 * names none — a failure the server could not put into words — is taken only
 * while this tab's own read is out.
 */
function onGetError(res: Sockets.State.Get.ErrorResponse) {
	if (typeof res?.sessionId === "number" ? !mine(res.sessionId) : !reading)
		return
	reading = false
	onError(res)
	readError = res?.error ?? "That did not work."
}

/** A write landed: the one write its `requestId` names is settled, if it is this tab's. */
function onSetReply(res: Sockets.State.Set.Response) {
	if (!settleSet(res?.requestId) && typeof res?.requestId === "string")
		lateNativeSets.delete(res.requestId)
}

/**
 * A write was refused. The write its `requestId` names hears it; the
 * store-wide `lastError` says it only when that write did not ask to own its
 * error.
 *
 * A refusal naming no write waiting here is another tab's, or one of this
 * tab's whose caller was already told (it timed out, or its session is gone):
 * its writer heard it, so it is not said again here — except a native write
 * that timed out in this session, whose refusal was always the store's to
 * show. One naming no id at all (a refusal the server could not tie to a
 * write) is said store-wide, as before.
 */
function onSetError(res: Sockets.State.Set.ErrorResponse) {
	const error = res?.error ?? "That did not work."
	const settled = settleSet(res?.requestId, error)
	if (settled) {
		if (!settled.ownError) lastError = error
		return
	}
	if (res?.requestId === undefined) lastError = error
	else if (lateNativeSets.delete(res.requestId)) lastError = error
}

const SETTLED_EVENTS = [
	"state:set",
	"state:configure",
	"state:decide"
] as const

/* `state:get:error` and `state:set:error` have handlers of their own below. */
const ERROR_EVENTS = [
	"state:ledger:error",
	"state:proposals:error",
	"state:configure:error",
	"state:decide:error"
] as const

/** What `stopSessionState` releases — one per declared interest key. */
let releases: Array<() => void> = []

/**
 * The scoped `state:changed` interest, held on its own because it is the one
 * key here that moves: it names a session, and this store is pointed at a
 * different one over the life of the tab.
 */
let changedRelease: (() => void) | null = null

function start(): void {
	if (started) return
	const socket = socketOrNull()
	if (!socket) return
	started = true
	releases = [
		declareInterest<"state:get">("state:get", onGet),
		declareInterest<"state:ledger">("state:ledger", onLedger),
		declareInterest<"state:proposals">("state:proposals", onProposals),
		...SETTLED_EVENTS.map((e) =>
			declareInterest<"state:set">(e, onSettled)
		),
		...ERROR_EVENTS.map((e) =>
			declareInterest<"state:get:error">(e, onError)
		),
		declareInterest<"state:get:error">("state:get:error", onGetError),
		declareInterest<"state:set">("state:set", onSetReply),
		declareInterest<"state:set:error">("state:set:error", onSetError)
	]
	declareChanged()
}

/**
 * Declare `state:changed` for the session that is open, releasing the key held
 * for the last one.
 *
 * Called from `start` and from every `openSessionState`, so the declared scope
 * and `openSessionId` are never out of step — and nothing is declared before a
 * session is open, because there is no session for a change to be about yet.
 */
function declareChanged(): void {
	changedRelease?.()
	changedRelease = null
	if (!started || openSessionId == null) return
	changedRelease = declareInterest<"state:changed">(
		interestKey("state:changed", openSessionId),
		onChanged
	)
}

/**
 * Drop the interest. Nothing calls this today — the cache lives as long as the
 * tab, which is the point — but each release is kept so a teardown is possible
 * at all, and so it removes THIS store's listeners and nobody else's.
 */
export function stopSessionState(): void {
	if (!started) return
	for (const release of releases) release()
	releases = []
	changedRelease?.()
	changedRelease = null
	started = false
}

/**
 * Which session a read has actually gone out for, and the retry that gets one
 * out when the socket was not there yet.
 *
 * Not the same question as which session is open: a widget can mount a beat
 * before the socket exists, and a store that recorded the session but never
 * asked would leave every panel empty with nothing to say why. One timer, not
 * one per caller, and it stops as soon as a read goes out.
 */
let askedFor: number | null = null
let retry: ReturnType<typeof setTimeout> | null = null
/**
 * Is a read of the open session out and unanswered? What lets a read failure
 * that names no session (`onGetError`) be taken as this tab's own. Plain: read
 * by a handler, never rendered.
 */
let reading = false

/** Ask for everything this session's surfaces read. */
function refresh(): void {
	if (openSessionId == null) return
	start()
	const socket = started ? socketOrNull() : null
	if (!socket) {
		if (retry == null)
			retry = setTimeout(() => {
				retry = null
				refresh()
			}, 100)
		return
	}
	askedFor = openSessionId
	reading = true
	// Each reply is its request's own event, so these add no second subscriber
	// (the handlers are the same references `start` declared) — what they add
	// is the interest sync ahead of the request, which is what makes a gated
	// reply reachable at all.
	requestWithInterest("state:get", { sessionId: openSessionId }, onGet)
	requestWithInterest(
		"state:proposals",
		{ sessionId: openSessionId },
		onProposals
	)
	requestWithInterest("state:ledger", { sessionId: openSessionId }, onLedger)
}

/**
 * Point the store at a session, and read it if it is a different one.
 *
 * Call it from an `$effect`, not from a `$derived`: it writes state, and a
 * derived that writes state is a Svelte error rather than a style opinion.
 * Idempotent, so every widget on the page calling it costs one read in total.
 */
export function openSessionState(sessionId: number | null): void {
	start()
	if (sessionId === openSessionId) return
	openSessionId = sessionId
	// Ahead of the reads below: `refresh` flushes an interest sync before it
	// sends its requests, and that sync should already name the new scope
	// (plan ruling 3).
	declareChanged()
	askedFor = null
	reading = false
	abandonPendingSets("the session changed before that write was answered")
	state = EMPTY
	loaded = false
	lastError = null
	readError = null
	slots.clear()
	owners.clear()
	proposals.clear()
	messageLines.clear()
	if (sessionId != null) refresh()
}

/**
 * The live handle the page's `session_state` projection (what core's state
 * widgets read, R21), the ledger and the review panel share.
 *
 * A getter object rather than a snapshot, so a `$derived` in the caller re-runs
 * when an answer lands. Reading is free of side effects; `openSessionState` is
 * what points the store at a session.
 */
export function sessionState() {
	start()
	if (openSessionId != null && askedFor !== openSessionId) refresh()
	return {
		get sessionId() {
			return openSessionId
		},
		get loaded() {
			return loaded
		},
		get error() {
			return lastError
		},
		/** Why the last read failed, or null — never a write's refusal (R77). */
		get readError() {
			return readError
		},
		get state() {
			return state
		},
		get slots() {
			return slots
		},
		get owners() {
			return owners
		},
		get proposals() {
			return [...proposals.values()]
		},
		/* ── naming a payload ───────────────────────────────────────────
		 * A proposal names its owner by kind and id and its item by entry id,
		 * because that is what a write needs. These turn one back into what a
		 * person reads, and each returns undefined rather than a placeholder
		 * when this session cannot name it. */
		ownerLabelFor(owner: { kind: string; id: number }): string | undefined {
			return [...owners.values()].find(
				(o) => o.kind === owner.kind && o.id === owner.id
			)?.label
		},
		slotLabelFor(slotId: string): string | undefined {
			return slots.get(slotId)?.label
		},
		/** An item's title, from any list the session resolved that references it (phase 3b: the inventory stat). */
		itemNameFor(entryId: number): string | undefined {
			for (const bag of [state.world, ...Object.values(state.cast ?? {})])
				for (const value of Object.values(bag ?? {}))
					if (Array.isArray(value))
						for (const item of value)
							if (
								item &&
								typeof item === "object" &&
								(item as { entryId?: unknown }).entryId === entryId &&
								typeof (item as { name?: unknown }).name === "string"
							)
								return (item as { name: string }).name
			return undefined
		},
		/** The ledger lines anchored to one message, owner by owner. */
		ledgerFor(messageId: number) {
			return groupLinesByOwner(messageLines.get(messageId) ?? [])
		},
		/**
		 * The held changes anchored to one message — and the superseded ones
		 * (U5f), which the list draws collapsed under the same message.
		 */
		pendingFor(messageId: number): Proposal[] {
			return [...proposals.values()].filter(
				(p) =>
					p.messageId === messageId &&
					(p.status === "pending" || p.status === "superseded")
			)
		},
		get pending(): Proposal[] {
			return [...proposals.values()].filter((p) => p.status === "pending")
		},
		clearError() {
			lastError = null
		},
		refresh,
		/* ── writes ──────────────────────────────────────────────────────
		 * Every one of these is the USER's, and a user's edit is authoritative:
		 * it applies immediately and answers with the whole resolved state. The
		 * gate below is for the model's proposals, which is the writer with no
		 * authority of its own. */
		/**
		 * Set one owner's value. Resolves once written, rejects with the
		 * server's sentence when refused — and a write that goes unanswered is
		 * rejected too, so a caller is never left waiting.
		 *
		 * `ownError`: the refusal is the caller's alone (a widget's request,
		 * R77) — the store-wide `error` is neither cleared nor written.
		 * Without it the write behaves as it always has: the store's `error`
		 * says why, and the returned promise may be ignored.
		 */
		set(
			owner: Sockets.State.Owner,
			slotId: string,
			/** A list is written whole, its items in order. */
			value: Sockets.State.Set.Params["value"],
			opts: { ownError?: boolean } = {}
		): Promise<void> {
			const ownError = !!opts.ownError
			if (openSessionId == null)
				return ownError
					? Promise.reject(new Error("no session's state is open"))
					: Promise.resolve()
			if (!ownError) lastError = null
			const requestId = `${WRITE_ID_STEM}${++writesSent}`
			const written = new Promise<void>((resolve, reject) => {
				pendingSets.set(requestId, {
					ownError,
					resolve,
					reject,
					timer: setTimeout(() => {
						// Told now, and forgotten: its reply, if one still
						// comes, names an id nothing waits on — it settles no
						// other write (a native one's refusal is still said).
						if (!pendingSets.delete(requestId)) return
						if (!ownError) lateNativeSets.add(requestId)
						reject(new Error("that write went unanswered"))
					}, SET_TIMEOUT_MS)
				})
			})
			// A caller that does not await (the page's own edits) must not
			// raise an unhandled rejection; one that does still hears it.
			written.catch(() => {})
			requestWithInterest(
				"state:set",
				{ sessionId: openSessionId, owner, slotId, value, requestId },
				onSetReply
			)
			return written
		},
		/** Accept or reject one held change. Nothing applies until this. */
		decide(proposalId: number, accept: boolean) {
			lastError = null
			requestWithInterest(
				"state:decide",
				{ proposalId, accept },
				onSettled
			)
		}
	}
}

export type SessionStateHandle = ReturnType<typeof sessionState>
