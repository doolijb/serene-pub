/**
 * One session's stats, states and possessions, read once and shared.
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

const EMPTY: Resolved = { world: {}, cast: {}, possessions: {} }

/** Which session every answer below is about; null before one is opened. */
let openSessionId = $state<number | null>(null)
let state = $state<Resolved>(EMPTY)
let loaded = $state(false)
let lastError = $state<string | null>(null)

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

const SETTLED_EVENTS = [
	"state:set",
	"state:give",
	"state:take",
	"state:transfer",
	"state:configure",
	"state:decide"
] as const

const ERROR_EVENTS = [
	"state:get:error",
	"state:ledger:error",
	"state:proposals:error",
	"state:set:error",
	"state:give:error",
	"state:take:error",
	"state:transfer:error",
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
		)
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
	state = EMPTY
	loaded = false
	lastError = null
	slots.clear()
	owners.clear()
	proposals.clear()
	messageLines.clear()
	if (sessionId != null) refresh()
}

/** The bag a slot's value is filed under for this owner. */
function bagFor(ownerKey: string): Record<string, unknown> {
	if (ownerKey === "world") return state.world ?? {}
	return state.cast?.[ownerKey] ?? {}
}

/**
 * One owner's value for one slot.
 *
 * Read by the QUALIFIED key, which every value is filed under; the bare key is
 * the first claimant's and is a display name, not an address.
 */
function valueOf(ownerKey: string, slotId: string): unknown {
	const slot = slots.get(slotId)
	if (!slot) return undefined
	const bag = bagFor(ownerKey)
	return bag[slot.qualifiedKey]
}

/** The configuration in force for this owner's slot — a bar's bounds. */
function configOf(ownerKey: string, slotId: string): Record<string, unknown> {
	return owners.get(ownerKey)?.configs?.[slotId] ?? {}
}

/** The slots an owner may carry, in declaration order. */
function slotsFor(ownerKey: string): Descriptor[] {
	const owner = owners.get(ownerKey)
	if (!owner) return []
	return [...slots.values()].filter((s) => s.slotId in owner.configs)
}

/**
 * The live handle every widget, the ledger and the review panel share.
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
		get state() {
			return state
		},
		get slots() {
			return slots
		},
		get owners() {
			return owners
		},
		/** Every cast member, world excluded — the Stats widget's subjects. */
		get cast() {
			return [...owners.values()].filter((o) => o.kind === "session_cast")
		},
		get world() {
			return owners.get("world") ?? null
		},
		get proposals() {
			return [...proposals.values()]
		},
		valueOf,
		configOf,
		slotsFor,
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
		itemNameFor(entryId: number): string | undefined {
			for (const lines of Object.values(state.possessions ?? {}))
				for (const line of lines)
					if (line.entryId === entryId) return line.name
			return undefined
		},
		/** Does this owner have any value at all — is it in play? */
		hasAnyValue(ownerKey: string): boolean {
			return slotsFor(ownerKey).some(
				(s) => valueOf(ownerKey, s.slotId) !== undefined
			)
		},
		/** The ledger lines anchored to one message, owner by owner. */
		ledgerFor(messageId: number) {
			return groupLinesByOwner(messageLines.get(messageId) ?? [])
		},
		/** The held changes anchored to one message. */
		pendingFor(messageId: number): Proposal[] {
			return [...proposals.values()].filter(
				(p) => p.messageId === messageId && p.status === "pending"
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
		set(
			owner: Sockets.State.Owner,
			slotId: string,
			value: number | string | boolean | null
		) {
			if (openSessionId == null) return
			lastError = null
			requestWithInterest(
				"state:set",
				{ sessionId: openSessionId, owner, slotId, value },
				onSettled
			)
		},
		give(owner: Sockets.State.Owner, entryId: number, quantity = 1) {
			if (openSessionId == null) return
			lastError = null
			requestWithInterest(
				"state:give",
				{ sessionId: openSessionId, owner, entryId, quantity },
				onSettled
			)
		},
		take(owner: Sockets.State.Owner, entryId: number, quantity = 1) {
			if (openSessionId == null) return
			lastError = null
			requestWithInterest(
				"state:take",
				{ sessionId: openSessionId, owner, entryId, quantity },
				onSettled
			)
		},
		transfer(
			from: Sockets.State.Owner,
			to: Sockets.State.Owner,
			entryId: number,
			quantity = 1
		) {
			if (openSessionId == null) return
			lastError = null
			requestWithInterest(
				"state:transfer",
				{ sessionId: openSessionId, from, to, entryId, quantity },
				onSettled
			)
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
