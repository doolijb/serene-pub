/**
 * Indexing lanes — **one set of queue primitives, instantiated per lane.**
 *
 * The background vectorization queue was one queue with the embedding model
 * welded into its loop. The ruling this file implements is that there is one
 * set of primitives and several independent *lanes* over them: an embedding
 * lane and an annotation/NER lane today, each with its own model, TTL,
 * autostart and force-start. Not one queue with a mode flag, and not two
 * divergent copies.
 *
 * ## The four lifecycle constraints, and where each one lives here
 *
 * These exist so the admin *Servers* pages can later decide which models may be
 * resident and in what sequence, without this file being rewritten for it.
 *
 *  1. **A lane never owns model lifecycle.** It *requests* a model through
 *     `LaneModelBroker` and never loads one itself. That interface is the seam
 *     the future arbiter sits behind. ⚠ The shape being removed is the old
 *     `runQueue`'s `if (!candidateModel) break` — a check that ran *before any
 *     picker*, which is what made a model-free feature require an embedding
 *     model. Here the broker's `peek()` answers `{ kind: "none" }` for a lane
 *     that needs nothing and the loop picks work exactly as it would with a
 *     model, so "no model configured for this lane" is a normal state rather
 *     than an early exit.
 *  2. **A lane declares which model it needs as data** — `LaneModelSpec` on the
 *     broker, reachable through `lane.declaration` without reading loop
 *     internals, so an admin surface can reason about the whole set.
 *  3. **Nothing assumes a model is immediately available.** `ModelLease` has a
 *     `pending` arm — *requested, not resident yet* — which is a normal answer
 *     and not a failure. The lane stops its current run and the next scan tick
 *     asks again; a promotion degrades with a reason.
 *  4. **TTL, autostart and force-start are per-lane values and explicit
 *     operations.** TTL is `spec.ttlMinutes` (the broker applies it when it
 *     asks for residency), autostart is a per-lane resolver consulted by the
 *     periodic scan, and force-start is `lane.start()` — called explicitly by
 *     an enqueue rather than happening as a side effect inside one.
 *
 * ## Promotion: preemption inside the queue, never a second path beside it
 *
 * When a query node scopes content and finds the index missing for part of it,
 * it hands those specific items to `promote()`. They go to the *front of this
 * queue* and the node resumes when its scope is covered. There is deliberately
 * no synchronous embed/annotate path beside the loop: fairness, per-item
 * failure backoff, truncation and model handling stay in one place, and a
 * promotion cannot start a model load the background pass would not.
 *
 * ⚠ **This is awaited from inside a request path**, which makes "never hangs" a
 * correctness requirement rather than a quality one. Four independent
 * guarantees settle every ticket:
 *
 *   - a wall-clock deadline timer, armed before the ticket is queued;
 *   - an item bound — a promotion processes at most `maxItems`;
 *   - the run loop's `finally`, which settles everything still outstanding;
 *   - an immediate settle when the lane cannot run at all (disabled, no model,
 *     model not resident yet), before anything is queued.
 *
 * Any one of them alone is enough. `settle()` is idempotent, so they may all
 * fire.
 *
 * ## The governing rule
 *
 * *An unavailable mechanism subtracts a signal. It never reroutes, disables a
 * path, or excludes a candidate.* A promotion that cannot complete — no model,
 * model never resident, bound exceeded — resolves to a report saying so. It
 * never rejects, never throws into the turn, and never blocks it. The caller
 * puts the report on the receipt and carries on with whatever is indexed.
 */

import { randomUUID } from "crypto"

// ---------------------------------------------------------------------------
// Model seam
// ---------------------------------------------------------------------------

/**
 * What a lane needs loaded before it can work — **declared as data**.
 *
 * `role` is what the lane's model WOULD be, not whether one is configured: the
 * annotation lane declares `"ner"` whether or not a `text->entities` connection
 * is starred, and its broker's `peek()` is what answers "none" while nothing is.
 * A role that flipped with a setting would make a lane's identity depend on one,
 * and an admin surface enumerating the lanes could not say what each is for.
 *
 * `role: null` remains a real answer for a lane that loads nothing at all — see
 * `modelFreeBroker` — which gets the same lifecycle machinery while having
 * nothing to load.
 */
export interface LaneModelSpec {
	/** A name the residency manager understands, or `null` for none. */
	role: string | null
	/**
	 * Idle minutes before residency may be released. Per-lane, never a module
	 * constant — two lanes over two models want two answers, and an admin
	 * surface has to be able to set them apart.
	 */
	ttlMinutes: number
}

/** What the lane's work is keyed on, resolved without loading anything. */
export type LaneModelPeek =
	/** This lane needs no model. A normal state, not an error. */
	| { kind: "none" }
	/** The identity the model *would* load under. Nothing is loaded yet. */
	| { kind: "configured"; modelId: string }
	/** A model is needed and none is configured, or the config is broken. */
	| { kind: "unconfigured"; reason: string }

/** The answer to a residency request. `pending` is normal once sequencing exists. */
export type ModelLease =
	| { kind: "none"; modelId: null }
	| { kind: "resident"; modelId: string }
	| { kind: "pending"; modelId: null; reason: string }
	| { kind: "unavailable"; modelId: null; reason: string }

/**
 * The seam between a lane and whatever manages model residency.
 *
 * A lane calls this; it never imports a loader. Replacing this implementation
 * is how the admin *Servers* pages will later sequence loads across lanes
 * without touching the loop.
 */
export interface LaneModelBroker {
	/** Constraint 2 — readable without running anything. */
	readonly spec: LaneModelSpec
	/** Cheap identity, no load. The peek that has to happen before picking. */
	peek(): Promise<LaneModelPeek>
	/**
	 * Ask for residency. May answer `pending`; must not throw.
	 *
	 * `wait` is the difference between the two callers and the reason this is
	 * one method rather than two. The **background loop** waits — blocking a
	 * background pass on a cold load is what it is for. A **promotion** does
	 * not: it is inside a turn, and a first-ever model download is minutes, so
	 * it takes `pending` for an answer, degrades with a receipt line, and lets
	 * the load it just started serve the next turn. That is constraint 3 as a
	 * signature: *requested, not resident yet* is a normal state.
	 */
	request(opts?: { wait?: boolean }): Promise<ModelLease>
}

/**
 * The broker for a lane that needs nothing loaded.
 *
 * Constraint 3 arrived at from the other direction: a model-free lane is not a
 * special case in the loop, it is a broker that always answers "none".
 *
 * ⚠ No lane in the app holds one: the annotation lane's `nerBroker` answers
 * "none" only while nothing is starred. This stays as the reference
 * implementation of that answer and the shape a model-free lane takes, and
 * because the loop's handling of `none` is what any such broker relies on.
 */
export const modelFreeBroker = (ttlMinutes = 0): LaneModelBroker => ({
	spec: { role: null, ttlMinutes },
	peek: async () => ({ kind: "none" }),
	request: async () => ({ kind: "none", modelId: null as null })
})

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------

/** A stable identity for one unit of work — failure keys and promotion coverage. */
export interface LaneItemRef {
	source: string
	id: number
}

export const refKey = (ref: LaneItemRef): string => `${ref.source}:${ref.id}`

export interface LaneItem {
	ref: LaneItemRef
	/** What the progress UI shows. `type` doubles as the item-updated kind. */
	label: { type: string; label: string }
	/** Set for lorebook-scoped work so listeners can filter to one book. */
	lorebookId?: number
	/** The model identity this work is keyed on; `null` on a model-free lane. */
	modelId: string | null
	process: () => Promise<void>
}

/**
 * A priority group — a set of related content indexed together before the
 * queue moves on. Typically one per session: its messages, its lorebooks, its
 * cast.
 */
export interface PriorityGroup {
	groupId: string
	label: string
	ownerDisplayName: string
	sessionId?: number
	lorebookIds: number[]
	characterIds: number[]
	personaIds: number[]
}

export type CompletedGroup = PriorityGroup & { completedAt: string }

/**
 * Where a lane's work comes from. The lane owns ordering, fairness, bounds and
 * the model; this owns what a unit of work *is*.
 */
export interface LaneWorkSource {
	/** One item from this group, or `null` when the group has nothing left. */
	fromGroup(
		group: PriorityGroup,
		modelId: string | null
	): Promise<LaneItem | null>
	/** One item from anywhere, in the lane's own order. */
	global(modelId: string | null): Promise<LaneItem | null>
	/**
	 * One specific item, or `null` when it needs no work.
	 *
	 * `context` is whatever the promoting caller passed — the annotation lane
	 * uses it to carry the lorebook vocabulary the node has already built, so a
	 * promotion of forty entries does not rebuild it forty times.
	 */
	specific(
		ref: LaneItemRef,
		modelId: string | null,
		context: unknown
	): Promise<LaneItem | null>
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

export interface PromotionRequest {
	/** The specific items the caller found missing, in the order it wants them. */
	refs: readonly LaneItemRef[]
	/** Hard ceiling on items processed. Defaults to the lane's own limit. */
	maxItems?: number
	/** Hard ceiling on wall-clock time. Defaults to the lane's own limit. */
	timeoutMs?: number
	/** Handed to `LaneWorkSource.specific` unchanged. */
	context?: unknown
}

export interface PromotionReport {
	/** Items the caller asked to have indexed before it read. */
	requested: number
	/** Items actually processed before the caller resumed. */
	processed: number
	/** Items never reached — the caller's scope is that much less covered. */
	remaining: number
	/**
	 * True when a bound ended this early: the item cap, the deadline, or the
	 * lane stopping. A slow turn has to be explicable, and so does a partial one.
	 */
	boundHit: boolean
	/** The same fact in words, for the receipt. */
	reason: string
}

interface Ticket {
	id: string
	requested: number
	pending: LaneItemRef[]
	processed: number
	maxItems: number
	context: unknown
	timer: ReturnType<typeof setTimeout> | null
	settled: boolean
	resolve: (report: PromotionReport) => void
	promise: Promise<PromotionReport>
}

// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

export type LaneStatus = "idle" | "running" | "paused"

export type LaneEmit = (event: string, data: any) => void

export interface LaneProgressEvent {
	status: LaneStatus
	currentItem?: { type: string; label: string }
	queued: number
	completed: number
	priorityQueue: PriorityGroup[]
	history: CompletedGroup[]
}

export interface LaneLimits {
	/** Groups kept in the completed-history ring. */
	historyMax?: number
	/** Items one promotion may process before it reports a bound was hit. */
	promotionMaxItems?: number
	/** Wall-clock ceiling on one promotion. */
	promotionTimeoutMs?: number
	/** How often the periodic scan re-triggers this lane. */
	scanIntervalMs?: number
	/** Failure backoff ceiling for one item. */
	backoffCapMs?: number
}

export interface LaneDefinition {
	/** Stable identity — log lines, and the key an admin surface lists it under. */
	key: string
	/** Human name for logs. */
	label: string
	model: LaneModelBroker
	work: LaneWorkSource
	/**
	 * Whether this lane indexes at all. Read fresh on every scan tick rather
	 * than captured, so switching it off takes effect without a restart.
	 */
	isEnabled: () => Promise<boolean>
	/**
	 * Whether the periodic scan may start this lane — constraint 4's autostart,
	 * a per-lane value rather than a hardcoded `true`.
	 */
	autostart: () => Promise<boolean>
	/** Socket event carrying `LaneProgressEvent`. Omitted lanes are silent. */
	progressEvent?: string
	/** Socket event fired after each item, with a lane-shaped payload. */
	itemEvent?: { name: string; payload: (item: LaneItem) => unknown }
	limits?: LaneLimits
}

const DEFAULTS = {
	historyMax: 20,
	/**
	 * The promotion item cap.
	 *
	 * This is synchronous work inside a turn: a lorebook with two hundred
	 * unembedded entries must not silently stall someone's first message. Small
	 * enough that the worst case is a noticeably-but-tolerably slower turn,
	 * large enough that an ordinary book converges in one or two of them — and
	 * whatever is left is still queued, so the background pass finishes it.
	 */
	promotionMaxItems: 25,
	/**
	 * The promotion deadline.
	 *
	 * Matched to the reply path's node budget. Past it the caller resumes with
	 * whatever landed and the rest keeps running in the background, because the
	 * work is queued rather than owned by the turn.
	 */
	promotionTimeoutMs: 5_000,
	scanIntervalMs: 15 * 60 * 1000,
	backoffCapMs: 30_000
} satisfies Required<LaneLimits>

export class IndexingLane {
	readonly key: string
	readonly label: string

	private readonly def: LaneDefinition
	private readonly limits: Required<LaneLimits>

	private running = false
	private stopping = false
	private paused = false
	private completed = 0

	private groups: PriorityGroup[] = []
	private history: CompletedGroup[] = []
	private tickets: Ticket[] = []

	private readonly emitters = new Set<LaneEmit>()

	/**
	 * Per-item consecutive-failure counts for the backoff below. A persistently
	 * failing item never gets marked done, so the picker hands the same one back
	 * every iteration — without this that is a busy-loop at full speed against
	 * whatever is failing. Keyed by identity, not object reference, because the
	 * picker re-queries.
	 */
	private readonly failures = new Map<string, number>()

	/** Resolves the interruptible sleep, so a promotion never waits out a backoff. */
	private wake: (() => void) | null = null

	private scanTimer: ReturnType<typeof setInterval> | null = null

	/** Resolved when a run ends without immediately restarting. See `settled()`. */
	private idleWaiters: Array<() => void> = []

	constructor(def: LaneDefinition) {
		this.def = def
		this.key = def.key
		this.label = def.label
		this.limits = { ...DEFAULTS, ...(def.limits ?? {}) }
	}

	// -- Declaration -------------------------------------------------------

	/**
	 * What this lane is and what it needs, as data — constraint 2.
	 *
	 * The whole point is that an admin surface can enumerate the lanes and the
	 * models they want without reading the loop, so this returns the declared
	 * shape and nothing derived from a run in progress.
	 */
	get declaration(): {
		key: string
		label: string
		model: LaneModelSpec
	} {
		return { key: this.key, label: this.label, model: this.def.model.spec }
	}

	// -- Emitters ----------------------------------------------------------

	/**
	 * A Set, not a single slot: the single-slot design meant one admin's
	 * connection silently replaced another's, so only the most recently
	 * connected socket saw progress — including other users' content names.
	 */
	registerEmitter(fn: LaneEmit) {
		this.emitters.add(fn)
	}

	unregisterEmitter(fn: LaneEmit) {
		this.emitters.delete(fn)
	}

	// -- Control -----------------------------------------------------------

	isRunning() {
		return this.running
	}

	isPaused() {
		return this.paused
	}

	pause() {
		this.paused = true
		this.broadcast("paused")
	}

	resume() {
		this.paused = false
		this.wakeLoop()
		if (!this.running) void this.run()
		else this.broadcast("running")
	}

	stop() {
		this.stopping = true
		this.paused = false
		this.wakeLoop()
	}

	/**
	 * Resolves once this lane has no run in flight.
	 *
	 * **Tests await this; nothing else does.** A lane is background work by
	 * definition, so a production caller wanting a specific thing indexed asks
	 * for that thing through `promote()` rather than waiting for the whole
	 * queue to drain — which on a large install is not a bounded wait.
	 */
	settled(): Promise<void> {
		if (!this.running) return Promise.resolve()
		return new Promise<void>((resolve) => this.idleWaiters.push(resolve))
	}

	resetCompleted() {
		this.completed = 0
	}

	clearFailureTracking() {
		this.failures.clear()
	}

	/**
	 * **Force-start — the explicit operation of constraint 4.**
	 *
	 * Enqueueing content does not start a lane as a side effect; a caller that
	 * wants the lane running says so. Idempotent: a call while it is already
	 * running wakes the loop instead of starting a second one.
	 */
	start(): void {
		this.stopping = false
		if (this.running) {
			this.wakeLoop()
			return
		}
		void this.run()
	}

	// -- Groups ------------------------------------------------------------

	snapshotGroups(): PriorityGroup[] {
		return [...this.groups]
	}

	snapshotHistory(): CompletedGroup[] {
		return [...this.history]
	}

	/**
	 * Put a group at the front, dropping any the caller says it replaces.
	 *
	 * Does **not** start the lane — see `start()`. The caller decides, because
	 * "content changed" and "index it now" are two statements and only one of
	 * them is this method's.
	 */
	enqueueGroup(
		group: Omit<PriorityGroup, "groupId"> & { groupId?: string },
		replaces: (existing: PriorityGroup) => boolean = () => false
	): PriorityGroup {
		const full: PriorityGroup = { groupId: randomUUID(), ...group }
		this.groups = [full, ...this.groups.filter((g) => !replaces(g))]
		return full
	}

	moveGroup(groupId: string, direction: "up" | "down"): void {
		const idx = this.groups.findIndex((g) => g.groupId === groupId)
		if (idx === -1) return
		if (direction === "up" && idx > 0) {
			;[this.groups[idx - 1], this.groups[idx]] = [
				this.groups[idx]!,
				this.groups[idx - 1]!
			]
		} else if (direction === "down" && idx < this.groups.length - 1) {
			;[this.groups[idx], this.groups[idx + 1]] = [
				this.groups[idx + 1]!,
				this.groups[idx]!
			]
		}
	}

	removeGroup(groupId: string): void {
		this.groups = this.groups.filter((g) => g.groupId !== groupId)
	}

	// -- Promotion ---------------------------------------------------------

	/**
	 * Index these specific items now, ahead of everything queued, and tell the
	 * caller what happened.
	 *
	 * **Never rejects and never hangs.** Every exit degrades to a report: a
	 * disabled lane, an unconfigured model, a model that is requested but not
	 * yet resident, a bound that binds, or the lane being stopped underneath it.
	 * The caller's contract is to put `reason` on the receipt and carry on with
	 * whatever is indexed — the governing rule's "subtracts a signal", as a
	 * call site.
	 */
	async promote(req: PromotionRequest): Promise<PromotionReport> {
		const requested = req.refs.length
		const maxItems = Math.max(
			0,
			req.maxItems ?? this.limits.promotionMaxItems
		)
		const timeoutMs = Math.max(
			0,
			req.timeoutMs ?? this.limits.promotionTimeoutMs
		)

		const nothing = (
			reason: string,
			boundHit = false
		): PromotionReport => ({
			requested,
			processed: 0,
			remaining: requested,
			boundHit,
			reason
		})

		if (requested === 0)
			return nothing("nothing to index — the scope was already covered")
		if (maxItems === 0 || timeoutMs === 0)
			return nothing("off — eager indexing is bounded to nothing", true)

		let enabled = false
		try {
			enabled = await this.def.isEnabled()
		} catch (err) {
			console.error(`[${this.key}] enabled check failed:`, err)
		}
		if (!enabled)
			return nothing(`off — the ${this.label} lane is switched off`)

		/**
		 * The model is requested here and not inside the loop, so a promotion
		 * that can never complete is answered before anything is queued rather
		 * than by a timeout the caller has to wait out. `pending` — requested,
		 * not resident yet — is a normal answer and degrades exactly like the
		 * others: this turn gets a smaller index and says so.
		 */
		const lease = await this.requestModel(false)
		if (lease.kind === "pending" || lease.kind === "unavailable")
			return nothing(lease.reason)

		const ticket: Ticket = {
			id: randomUUID(),
			requested,
			pending: [...req.refs],
			processed: 0,
			maxItems,
			context: req.context,
			timer: null,
			settled: false,
			resolve: () => {},
			promise: undefined as unknown as Promise<PromotionReport>
		}
		ticket.promise = new Promise<PromotionReport>((resolve) => {
			ticket.resolve = resolve
		})
		/**
		 * Armed before the ticket is visible to the loop, so there is no window
		 * in which a queued ticket has no deadline. `.unref()` for the reason
		 * every other timer here has one: a lane must not hold the process open.
		 */
		ticket.timer = setTimeout(() => {
			this.settle(
				ticket,
				`bounded — ${timeoutMs}ms elapsed before the scope was covered`,
				true
			)
		}, timeoutMs)
		if (typeof ticket.timer.unref === "function") ticket.timer.unref()

		this.tickets.push(ticket)
		this.start()
		return ticket.promise
	}

	private settle(ticket: Ticket, reason: string, boundHit: boolean) {
		if (ticket.settled) return
		ticket.settled = true
		if (ticket.timer) clearTimeout(ticket.timer)
		ticket.timer = null
		this.tickets = this.tickets.filter((t) => t !== ticket)
		ticket.resolve({
			requested: ticket.requested,
			processed: ticket.processed,
			remaining: Math.max(0, ticket.requested - ticket.processed),
			boundHit,
			reason
		})
	}

	private settleAll(reason: string, boundHit: boolean) {
		for (const ticket of [...this.tickets])
			this.settle(ticket, reason, boundHit)
	}

	/**
	 * The next promoted item, draining tickets that have nothing left to do.
	 *
	 * ⚠ On return `null`, **every ticket has been settled** — a ref that the
	 * work source says needs no work is dropped from the ticket's cursor, so one
	 * pass either finds an item or empties every cursor. That property is what
	 * stops the run loop's restart-on-pending-tickets from spinning.
	 */
	private async nextPromoted(
		modelId: string | null
	): Promise<LaneItem | null> {
		while (this.tickets.length) {
			const ticket = this.tickets[0]!
			if (ticket.processed >= ticket.maxItems) {
				this.settle(
					ticket,
					`bounded — ${ticket.maxItems} items indexed before the scope was covered`,
					true
				)
				continue
			}
			const ref = ticket.pending.shift()
			if (ref === undefined) {
				this.settle(ticket, "the scope was covered", false)
				continue
			}
			let item: LaneItem | null = null
			try {
				item = await this.def.work.specific(
					ref,
					modelId,
					ticket.context
				)
			} catch (err) {
				console.error(
					`[${this.key}] promoted pick failed for ${refKey(ref)}:`,
					err
				)
			}
			if (!item) continue // already indexed, or gone — not work
			ticket.processed++
			return item
		}
		return null
	}

	// -- The loop ----------------------------------------------------------

	/**
	 * Exported only so tests can exercise ordering directly; the loop is the
	 * real caller. `modelIdOverride` lets a caller check for pending work
	 * against a model that is not resident yet — the peek.
	 */
	async pickNext(modelId: string | null): Promise<LaneItem | null> {
		/**
		 * Round-robin across groups — one item from the front, then rotate it to
		 * the back, rather than draining a group before any other gets a single
		 * item. Without it one large group (a freshly bulk-imported lorebook,
		 * say) starves every other user's until it finishes.
		 */
		const groupCount = this.groups.length
		for (let i = 0; i < groupCount; i++) {
			const group = this.groups[0]!
			const item = await this.def.work.fromGroup(group, modelId)
			if (item) {
				this.groups.push(this.groups.shift()!)
				return item
			}
			this.groups.shift()
			this.history.unshift({
				...group,
				completedAt: new Date().toISOString()
			})
			if (this.history.length > this.limits.historyMax) this.history.pop()
			this.broadcast("running")
		}
		return this.def.work.global(modelId)
	}

	private async requestModel(wait: boolean): Promise<ModelLease> {
		try {
			return await this.def.model.request({ wait })
		} catch (err) {
			console.error(`[${this.key}] model request failed:`, err)
			return {
				kind: "unavailable",
				modelId: null,
				reason:
					err instanceof Error
						? `the model could not be made available: ${err.message}`
						: "the model could not be made available"
			}
		}
	}

	private async run(): Promise<void> {
		// Synchronous up to here on purpose: `running` has to be set before the
		// first await or two concurrent start() calls both pass the guard.
		if (this.running) return
		this.running = true
		this.broadcast("running")
		const completedAtStart = this.completed

		try {
			while (!this.stopping) {
				/**
				 * The peek, and the anti-pattern this replaces.
				 *
				 * The old loop asked for a model *before* any picker ran and
				 * broke out when there was none, which is what made a model-free
				 * lane impossible. Here `{ kind: "none" }` is an ordinary answer
				 * and picking proceeds with a `null` identity.
				 */
				const peek = await this.def.model.peek().catch((err) => {
					console.error(`[${this.key}] model peek failed:`, err)
					return {
						kind: "unconfigured" as const,
						reason: "the model configuration could not be read"
					}
				})
				if (peek.kind === "unconfigured") {
					this.settleAll(peek.reason, false)
					break
				}
				const peekedModel =
					peek.kind === "configured" ? peek.modelId : null

				// Promotions come first — this is what "front of the queue" is.
				let item = await this.nextPromoted(peekedModel)
				const promoted = item !== null

				if (!item) {
					if (this.paused) {
						await this.sleep(500)
						continue
					}
					item = await this.pickNext(peekedModel)
				}

				if (!item) {
					// A ticket can land between the pick and here; the finally
					// below restarts the loop rather than settling it as missed.
					if (this.tickets.length) continue
					break
				}

				/**
				 * Residency is requested only now, with real work in hand — so an
				 * instance with nothing to index never pays a load cost, on this
				 * loop or on the periodic tick. `pending` means the manager took
				 * the request and the model is not up yet: the run ends and the
				 * next tick asks again, which is a normal state, not a failure.
				 */
				if (item.modelId !== null) {
					const lease = await this.requestModel(true)
					if (lease.kind !== "resident") {
						const reason =
							lease.kind === "none"
								? "the lane asked for a model it does not declare"
								: lease.reason
						console.warn(`[${this.key}] paused: ${reason}`)
						this.settleAll(reason, false)
						break
					}
					if (lease.modelId !== item.modelId) {
						// The configured identity moved between the peek and the
						// lease. Re-pick against what is actually resident rather
						// than writing a vector under the wrong model's name.
						continue
					}
				}

				this.broadcast("running", item.label)
				await this.processOne(item, promoted)
			}
		} catch (err) {
			/**
			 * ⚠ One iteration's failure must not reject `run()`.
			 *
			 * The loop is started with `void this.run()` from several places, so
			 * an escaping rejection is an *unhandled* one — and the likeliest
			 * source is a database going away underneath a background sweep,
			 * which is an ordinary shutdown rather than a fault. Ending the run
			 * is the right response either way: the periodic scan restarts it,
			 * and so does the next promotion. Everything outstanding is settled
			 * by the `finally` below, so nothing awaiting this is left hanging.
			 */
			console.error(`[${this.key}] indexing run ended on an error:`, err)
		} finally {
			this.running = false
			/**
			 * A ticket can land in the window between the last pick and here, so
			 * a run that ends with tickets outstanding starts another rather than
			 * reporting them as missed.
			 *
			 * ⚠ **Gated on the run having done something**, and that guard is
			 * load-bearing rather than defensive. Every `break` above settles
			 * outstanding tickets before it leaves, so this restart normally only
			 * fires for the race it is for — but a future `break` that forgets to
			 * settle would otherwise re-enter immediately, find the same reason to
			 * leave, and spin at full CPU for ever. A run that indexed nothing
			 * cannot have made the situation any different, so its tickets are
			 * settled instead: the callers degrade with a reason, which is the
			 * failure mode this codebase is allowed to have.
			 */
			const restart =
				!this.stopping &&
				this.tickets.length > 0 &&
				this.completed > completedAtStart
			this.stopping = false
			this.broadcast("idle")
			if (restart) void this.run()
			else {
				this.settleAll(
					"the indexing lane stopped before the scope was covered",
					true
				)
				const waiters = this.idleWaiters
				this.idleWaiters = []
				for (const resolve of waiters) resolve()
			}
		}
	}

	private async processOne(item: LaneItem, promoted: boolean): Promise<void> {
		const key = refKey(item.ref)
		try {
			await item.process()
			this.completed++
			this.failures.delete(key)
			const event = this.def.itemEvent
			if (event) {
				const payload = event.payload(item)
				for (const emit of this.emitters) {
					try {
						emit(event.name, payload)
					} catch {}
				}
			}
		} catch (err) {
			console.error(
				`[${this.key}] failed to index item:`,
				item.label.label,
				err
			)
			const failures = (this.failures.get(key) ?? 0) + 1
			this.failures.set(key, failures)
			/**
			 * Exponential backoff, capped. The item is not marked done, so the
			 * picker hands it straight back next iteration; this stops that from
			 * being an instant uncapped retry against whatever is failing.
			 *
			 * A *promoted* item skips the wait: the caller is holding a turn
			 * open, and its own deadline is the right bound there. The item is
			 * still counted as processed by the ticket, so a permanently broken
			 * one cannot re-enter the promotion either.
			 */
			if (!promoted)
				await this.sleep(
					Math.min(2000 * failures, this.limits.backoffCapMs)
				)
		}
	}

	/**
	 * Interruptible sleep — a promotion arriving mid-backoff wakes it rather
	 * than waiting out up to 30 seconds it did not cause.
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.wake = null
				resolve()
			}, ms)
			if (typeof timer.unref === "function") timer.unref()
			this.wake = () => {
				clearTimeout(timer)
				this.wake = null
				resolve()
			}
		})
	}

	private wakeLoop() {
		this.wake?.()
	}

	// -- Progress ----------------------------------------------------------

	private broadcast(status: LaneStatus, currentItem?: LaneItem["label"]) {
		const event = this.def.progressEvent
		if (!event) return
		const payload: LaneProgressEvent = {
			status,
			currentItem,
			queued: this.groups.length,
			completed: this.completed,
			priorityQueue: this.snapshotGroups(),
			history: this.snapshotHistory()
		}
		for (const emit of this.emitters) {
			try {
				emit(event, payload)
			} catch {}
		}
	}

	// -- Autostart ---------------------------------------------------------

	/**
	 * Start this lane periodically if its own settings allow it — constraint 4's
	 * autostart as a per-lane value rather than an implicit boot side effect.
	 *
	 * The first tick runs immediately: that *is* the boot-time trigger, not a
	 * separate code path. Idempotent, mirroring `start()`'s own guard.
	 */
	startPeriodicScan(): void {
		if (this.scanTimer) return
		const tick = async () => {
			try {
				if (!(await this.def.isEnabled())) return
				if (!(await this.def.autostart())) return
				this.start()
			} catch (err) {
				console.error(`[${this.key}] periodic scan tick failed:`, err)
			}
		}
		void tick()
		this.scanTimer = setInterval(tick, this.limits.scanIntervalMs)
		if (typeof this.scanTimer.unref === "function") this.scanTimer.unref()
	}

	/** Tests only — a lane's scan timer otherwise lives as long as the process. */
	stopPeriodicScan(): void {
		if (this.scanTimer) clearInterval(this.scanTimer)
		this.scanTimer = null
	}
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, IndexingLane>()

/** Register a lane so an admin surface can enumerate the set — constraint 2. */
export function registerLane(lane: IndexingLane): IndexingLane {
	registry.set(lane.key, lane)
	return lane
}

export function listLanes(): IndexingLane[] {
	return [...registry.values()]
}

export function getLane(key: string): IndexingLane | undefined {
	return registry.get(key)
}
