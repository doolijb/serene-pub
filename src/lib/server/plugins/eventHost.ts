/**
 * The event hook registry — the one place **many** extensions subscribe to one
 * core occurrence (01 §9c, 11 §2a/§3, F8/F30).
 *
 * Every other plugin seam in this subsystem resolves exactly one implementation
 * for one address: `hookTypes` binds a script type to a hook, `nodeTypes` binds
 * a node pin, `engines` binds a template engine, and in each the second claimant
 * is a conflict to refuse. An event is the opposite shape by nature — "a message
 * was written" is not owned by anybody, and three extensions watching it are
 * three correct answers rather than a collision. So this is a *registry*: one
 * event, N subscribers, dispatched together.
 *
 * ## The declaration
 *
 * `manifest.eventHooks`, an array — one entry per subscription, so a plugin may
 * subscribe more than one hook to an event (and one hook to more than one
 * event), which a keyed map could not express:
 *
 *     "eventHooks": [
 *       { "event": "core:event/message-created@1", "hook": "onMessage" },
 *       { "event": "core:event/session-created@1", "hook": "onSession",
 *         "timeoutMs": 500 }
 *     ]
 *
 * Read off the stored manifest, never guessed from a naming convention — the
 * same posture and the same reason as its three siblings: the manifest is the
 * one statement of what a plugin can do that core can read without executing it
 * (F6, 13 §10c). Note that this is the *app-runtime* manifest key, the family
 * `hookTypes`/`nodeTypes`/`engines` already belong to; the SDK packager's
 * compiled manifest spells hooks differently and reconciling the two is a
 * standing item, not something this module decides.
 *
 * ## One kind: notification
 *
 * Returns are ignored and subscribers are independent. That is what 11 §3 rules
 * for core's events ("fire-and-forget") and what 01 §9c promises ("a throwing
 * event hook is contained and reported; it never fails the originating action").
 *
 * There is deliberately **no second kind that threads a value** through the
 * subscribers. Value-threading contradicts fire-and-forget on its face: N
 * plugins transforming one value makes the outcome depend on the order they
 * happen to sort in, which is the collision this registry's whole shape exists
 * to avoid, and it hands any one subscriber a veto over what its siblings see.
 * Core already has two seams for a value that must be transformed — script
 * chains and pipeline node hooks — and both are places where an author asked for
 * a transform. An event is a past-tense occurrence: it says what happened, and
 * there is nothing in it to filter.
 *
 * ## Order
 *
 * Registration order is install order, which differs between two instances
 * running the same extensions — so nothing may depend on it. The order is
 * therefore **declaration order** (11 §3), with a stable tie-break across
 * plugins: plugin id ascending, then the plugin's own declaration order. Total,
 * stable, and independent of install order, so a fan-out that misbehaves
 * misbehaves the same way twice.
 *
 * There is deliberately **no `priority`**. A declared priority would manufacture
 * the ordering guarantee 11 §3 expressly declines to give, and it is a collision
 * surface in its own right — two plugins both claiming `-100` are back to a
 * tie-break neither asked for. Declaration order has no contest to have.
 *
 * The order is not semantic in any case: subscribers are started together and
 * nothing may depend on which finishes first, exactly as 11 §3 says
 * ("declaration order is dispatch order, never completion order"). It is still
 * fixed, because a bug that reproduces is worth more than one that does not.
 *
 * ## Failure isolation is the point
 *
 * One subscriber throwing, overrunning or being killed leaves every other
 * subscriber's result and its committed storage untouched, and the fan-out as a
 * whole still succeeds. Each subscriber is its own `callHook`, which is what
 * makes that true rather than merely intended: the manager loads a fresh row
 * snapshot per call and commits that call's diff alone, and the sandbox's file
 * transaction is per call too — so a killed subscriber commits nothing while its
 * sibling commits normally.
 *
 * A subscriber that halts (11 §3 — "halt is normal", the applicability check
 * most subscribers to a hot event do first) is a success rather than a failure,
 * for the same reason: declining is not failing, and an emitter that logged it
 * as one would bury the failures that matter.
 *
 * ## One budget for the fan-out
 *
 * See `EVENT_FANOUT_BUDGET_MS`. Five subscribers do not cost five deadlines.
 *
 * ## What this module does not do
 *
 * It does not emit. Only core emits (01 §8), from its own call sites, and there
 * is no core emit site yet — the registry is the half that had to exist first,
 * and it is inert until something calls `notify`. It also does not implement the
 * *per-user* consent layer of 11 §4: the admin-effective permission gate below
 * is enforced, the per-user opt-in is not, and that is the next thing this needs
 * rather than something it quietly covers.
 */

import { eq } from "drizzle-orm"
import { plugins } from "$lib/server/db/schema"
import {
	declaredPermissions,
	effectivePermissions,
	type PluginManifest
} from "./permissions"
import type { SandboxManager } from "./SandboxManager"

/**
 * The wall-clock ceiling on **one whole fan-out**, however many subscribers it
 * has.
 *
 * The precedent is `HOOK_CANCEL_GRACE_MS`, which is per *run* and says why in as
 * many words: five hooks in flight share one budget so a cancel costs the grace
 * once rather than five times over. An event has exactly that shape. N
 * subscribers at their own deadline each would make an event cost N × timeout,
 * so subscribing to a hot event would be a way to slow the instance down in
 * proportion to how many extensions were installed — and the originating action,
 * which 01 §9c promises a hook can never fail, would wait for all of them.
 *
 * So the budget is spent once. The fan-out starts its subscribers together and
 * each gets what is left of it as a ceiling, so the sum can never exceed the
 * whole. A subscriber's own declared `timeoutMs` still applies underneath and is
 * usually the shorter of the two — the budget is a ceiling, never an extension,
 * the same relationship the cancellation grace has to a hook's deadline.
 *
 * Two seconds, matching the grace for the same reason: long enough that a
 * subscriber doing real bookkeeping finishes, short enough that a wedged one is
 * not holding a core write path for a noticeable slice of a minute.
 *
 * ⚠ It bounds what the *emitter waits for*, not what the sandbox is still doing.
 * A subscriber that has not returned when the budget expires is abandoned, not
 * stopped — its own `timeoutMs` and the manager's overrun backstop are what
 * actually end it, and its rows still commit if it returns.
 * Reported as `skipped` with a reason that says so, rather than silently counted
 * as a success.
 */
export const EVENT_FANOUT_BUDGET_MS = 2_000

/**
 * A subscriber's deadline when its manifest declares none.
 *
 * The same 250ms a chain link gets, because it is the same scale of work: an
 * event hook is for "maintaining the extension's own data when something
 * happens" (01 §9c), not for a job. It also leaves the shared budget room for
 * eight default subscribers before it is the binding constraint — so an author
 * who needs longer declares it and is thereby saying how much of a shared budget
 * they intend to spend.
 */
export const EVENT_HOOK_TIMEOUT_MS = 250

/**
 * The event-ref grammar, the same shape family as script types and template
 * engine ids: namespaced, one payload segment, pinned to a major.
 * `core:event/message-created@1` is the exemplar.
 *
 * Deliberately not restricted to the `core:` namespace even though core is the
 * only emitter today (11 §2). A subscription to an event nothing emits simply
 * never fires, which is inert by construction; a rule refusing it here would be
 * one to unwind on the day plugin-owned events are reopened — which 11 §2b calls
 * additive, and this would have made it a change.
 */
const EVENT_REF = /^([a-z0-9][a-z0-9.-]*):event\/([a-z0-9][a-z0-9-]*)@(\d+)$/

/** One subscription, as the registry holds it after validation and clamping. */
export interface EventSubscription {
	/** The sandbox address — `namespace/name`. */
	pluginId: string
	/** The event ref exactly as the manifest pinned it. */
	event: string
	/** The plugin's exported hook. */
	hookName: string
	/** This subscriber's own ceiling, clamped into (0, EVENT_FANOUT_BUDGET_MS]. */
	timeoutMs: number
	/**
	 * Where this sat in its plugin's `eventHooks` array — the last tie-break, so
	 * one plugin's subscriptions keep the order the author wrote them in
	 * (11 §3: declaration order is dispatch order).
	 */
	index: number
}

/**
 * What became of one subscriber.
 *
 *  - `ok`      it returned, or returned nothing — either way its return is
 *              dropped, which is what "notification" means
 *  - `halt`    it declined — `halt`/`cancelled`, which 11 §3 calls normal and
 *              success rather than failure
 *  - `error`   it threw, overran, was killed, could not be loaded, or returned
 *              `err`. Contained here, and costs its siblings nothing.
 *  - `skipped` it was not dispatched, or was dispatched and abandoned when the
 *              fan-out budget expired. `reason` says which.
 */
export type EventDeliveryOutcome = "ok" | "halt" | "error" | "skipped"

export interface EventDelivery {
	pluginId: string
	hookName: string
	outcome: EventDeliveryOutcome
	/** Why, for anything but a plain `ok`. */
	reason?: string
	durationMs: number
}

/**
 * The record of one emit.
 *
 * `deliveries` is in **dispatch order** — the declared order above, never
 * completion order (11 §3), so two runs of the same fan-out read identically
 * however the scheduler happened to interleave them.
 */
export interface EventFanout {
	event: string
	deliveries: EventDelivery[]
}

/** What an emitter may pin about the fan-out. Everything is optional. */
export interface EventEmitOptions {
	/**
	 * The pipeline run this occurrence belongs to, if any.
	 *
	 * Forwarded to every subscriber, and load-bearing: the grace policy groups
	 * in-flight hooks by run id and has nothing else to group them by, so a
	 * fan-out dispatched without one is a fan-out a cancelled run cannot reach.
	 */
	runId?: string
	/** Who the occurrence is attributed to, for the invocation log. */
	user?: string
	/**
	 * What `ctx.now()` answers inside every subscriber — one instant for the
	 * whole fan-out, so the subscribers to one occurrence agree about when it
	 * happened. Defaults to the wall clock at emit.
	 */
	nowMs?: number
	/** Ceiling on each subscriber's serialized return. */
	maxOutputBytes?: number
	/**
	 * The whole fan-out's ceiling. Defaults to `EVENT_FANOUT_BUDGET_MS`; an
	 * emitter on a tighter path may lower it. Never raised past the constant —
	 * a call site cannot buy an extension by asking for one.
	 */
	budgetMs?: number
	/**
	 * Stop dispatching. A fan-out already in flight is left to the grace policy
	 * (which is what `runId` reaches it by); this stops subscribers that have
	 * not been dispatched yet from starting at all.
	 */
	signal?: AbortSignal
}

/** One raw `eventHooks` entry, before validation. */
interface RawEventHookDecl {
	event?: unknown
	hook?: unknown
	timeoutMs?: unknown
}

/**
 * Read `eventHooks` off a stored manifest, tolerant of its json being anything.
 *
 * Returns the raw entries in declaration order; `subscriptionsOf` is what
 * validates them. Split so the tolerant read and the policy that rejects an
 * entry are separately testable, exactly as the map-shaped readers beside this
 * one are.
 */
export function eventHooksOf(manifest: unknown): RawEventHookDecl[] {
	const raw =
		manifest && typeof manifest === "object"
			? (manifest as any).eventHooks
			: undefined
	if (!Array.isArray(raw)) return []
	return raw.filter(
		(e): e is RawEventHookDecl =>
			!!e && typeof e === "object" && !Array.isArray(e)
	)
}

/** A declared timeout, clamped so a manifest cannot grant itself the instance. */
function normalizeTimeout(raw: unknown): number {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)
		return EVENT_HOOK_TIMEOUT_MS
	return Math.min(Math.floor(raw), EVENT_FANOUT_BUDGET_MS)
}

/**
 * The events an admin has left granted for this plugin, as a set of refs.
 *
 * Deny-by-default and admin-deniable, the same rule every other permission
 * follows (permissions.ts): a subscription whose `event:<ref>` permission the
 * manifest never declared, or an admin has denied, is not registered at all.
 * F30 says consent and permissions apply identically to hooks and pipelines, and
 * a deny an emitter routed around would be a deny that did nothing.
 */
function grantedEvents(
	manifest: unknown,
	adminDenied: string[] | null | undefined
): Set<string> {
	const effective = effectivePermissions(
		declaredPermissions((manifest ?? null) as PluginManifest | null),
		adminDenied
	)
	return new Set(
		effective
			.filter((p) => p.kind === "event")
			.map((p) => p.key.slice("event:".length))
	)
}

/**
 * Validate one plugin's declarations into subscriptions, reporting what it
 * refused rather than dropping it silently.
 *
 * Per-entry and warn-and-continue: one malformed subscription must not cost a
 * plugin its others, and must not cost another plugin anything at all.
 */
export function subscriptionsOf(row: {
	pluginId: string
	manifest?: unknown
	adminDenied?: string[] | null
}): { subscriptions: EventSubscription[]; problems: string[] } {
	const subscriptions: EventSubscription[] = []
	const problems: string[] = []
	const granted = grantedEvents(row.manifest, row.adminDenied)
	const seen = new Set<string>()

	eventHooksOf(row.manifest).forEach((decl, index) => {
		const event = typeof decl.event === "string" ? decl.event : ""
		const hookName = typeof decl.hook === "string" ? decl.hook : ""
		const at = `'${row.pluginId}' eventHooks[${index}]`
		if (!EVENT_REF.test(event)) {
			problems.push(
				`${at}: '${event}' is not an event reference. The grammar is ` +
					`'<namespace>:event/<name>@<major>' — 'core:event/message-created@1'.`
			)
			return
		}
		if (!hookName) {
			problems.push(
				`${at}: no 'hook' — the entry names the event but not the ` +
					`exported function that answers it, and core will not guess one.`
			)
			return
		}
		if (!granted.has(event)) {
			problems.push(
				`${at}: '${event}' is not a granted event permission. A ` +
					`subscription is a declared permission an admin can deny ` +
					`(11 §5), so the manifest must request 'event:${event}' and ` +
					`the admin must have left it granted.`
			)
			return
		}
		const dupe = `${event}\0${hookName}`
		if (seen.has(dupe)) {
			problems.push(
				`${at}: '${hookName}' is already subscribed to '${event}'. ` +
					`Registering it twice would run it twice per occurrence; the ` +
					`first declaration stands.`
			)
			return
		}
		seen.add(dupe)

		subscriptions.push({
			pluginId: row.pluginId,
			event,
			hookName,
			timeoutMs: normalizeTimeout(decl.timeoutMs),
			index
		})
	})

	return { subscriptions, problems }
}

/**
 * The dispatch order, as a total and stable comparator: **declaration order**,
 * tie-broken across plugins by plugin id.
 *
 * Within a plugin `index` is exactly the order the author wrote its `eventHooks`
 * in, which is what 11 §3 rules. Across plugins there is no author to defer to —
 * two extensions did not write one list — so the tie-break is the plugin id, the
 * one thing about a pair of subscriptions that is fixed and knowable without
 * consulting install order.
 *
 * Plugin ids are compared by code unit rather than `localeCompare`, because a
 * locale-dependent order is not the same order on two machines — which is the
 * whole property this exists to provide.
 */
export function compareSubscriptions(
	a: EventSubscription,
	b: EventSubscription
): number {
	if (a.pluginId !== b.pluginId) return a.pluginId < b.pluginId ? -1 : 1
	return a.index - b.index
}

/** A subscriber's return, as the fan-out reads it. */
interface Verdict {
	outcome: EventDeliveryOutcome
	reason?: string
}

const RESULT_KINDS = new Set(["ok", "err", "halt", "cancelled"])

/**
 * Read a hook's return — for the *outcome* only. The value is dropped, which is
 * what fire-and-forget means (11 §3).
 *
 * The SDK types an event hook as returning a `Result`, and an author following
 * the types returns `ok(v)` / `halt(reason)`. JavaScript being what it is, a
 * hook may also return a bare value or nothing at all; both are an ordinary
 * success, and the difference between them is not one an emitter can act on.
 *
 * The `Result` shape is only unwrapped when `kind` is one of the four the SDK
 * defines — so a returned object that happens to carry a `kind` field is not
 * mistaken for a verdict about itself, and a hook is never reported as having
 * halted because its bookkeeping row had a `kind` column.
 */
function verdictOf(value: unknown): Verdict {
	if (value === undefined) return { outcome: "ok" }
	if (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		typeof (value as any).kind === "string" &&
		RESULT_KINDS.has((value as any).kind)
	) {
		const r = value as { kind: string; reason?: string }
		if (r.kind === "ok") return { outcome: "ok" }
		if (r.kind === "err")
			return {
				outcome: "error",
				reason: r.reason ?? "the hook returned err"
			}
		// halt and cancelled: the subscriber declined, which 11 §3 calls
		// success rather than failure.
		return {
			outcome: "halt",
			reason: r.reason ?? `the hook returned ${r.kind}`
		}
	}
	return { outcome: "ok" }
}

/**
 * The registry itself: what is subscribed to what, and how a fan-out runs.
 *
 * A class rather than module state so a test can hold an isolated one — a
 * registry whose whole contract is about N concurrent subscribers is one whose
 * tests must not share a table. The process-wide instance is `pluginEvents()`.
 *
 * The manager is a parameter of every dispatch rather than a field, so the
 * registry holds no reference to a sandbox that may since have been disposed,
 * and so this module does not have to import the subsystem entry point that
 * imports it.
 */
export class PluginEventRegistry {
	/** event ref → its subscribers, already in dispatch order. */
	private readonly byEvent = new Map<string, EventSubscription[]>()

	/**
	 * Replace the whole table.
	 *
	 * Whole rather than per-plugin, for the reason `syncPluginEngines` gives:
	 * the desired state is a projection of the `plugins` table, so reconciling
	 * toward it makes boot, enable, disable and uninstall the same one-line call
	 * with no ordering to get wrong.
	 */
	replace(subscriptions: EventSubscription[]): void {
		this.byEvent.clear()
		for (const s of [...subscriptions].sort(compareSubscriptions)) {
			const list = this.byEvent.get(s.event)
			if (list) list.push(s)
			else this.byEvent.set(s.event, [s])
		}
	}

	/** Who answers this event, in dispatch order. Empty when nobody does. */
	subscribers(event: string): readonly EventSubscription[] {
		return this.byEvent.get(event) ?? []
	}

	/** Every event with at least one subscriber (admin views, tests). */
	events(): string[] {
		return [...this.byEvent.keys()].sort()
	}

	clear(): void {
		this.byEvent.clear()
	}

	/**
	 * Tell every subscriber that something happened. Returns are ignored.
	 *
	 * Subscribers are started **together**, in dispatch order, and are
	 * independent: one throwing, overrunning or being killed changes nothing
	 * about any other, and the fan-out as a whole always resolves. Nothing may
	 * depend on which finishes first (11 §3).
	 *
	 * Never rejects. An event hook may not fail the action that caused it
	 * (01 §9c), and an emitter that had to wrap this in a try would eventually
	 * be one that forgot.
	 */
	async notify(
		manager: SandboxManager,
		event: string,
		payload: unknown,
		opts: EventEmitOptions = {}
	): Promise<EventFanout> {
		const subs = this.subscribers(event)
		if (!subs.length) return { event, deliveries: [] }
		if (opts.signal?.aborted)
			return { event, deliveries: subs.map((s) => skipped(s, CANCELLED)) }

		// Started together, so the fan-out costs one budget rather than N — and
		// then raced against that budget, because a subscriber can still be
		// queued behind a sequential plugin or the ready-gate, where its own
		// deadline has not started running yet. The emitter stops waiting; see
		// the ⚠ on EVENT_FANOUT_BUDGET_MS for what that does and does not stop.
		const budget = makeBudget(opts)
		const pending = subs.map((s) =>
			this.deliver(manager, s, event, payload, budget, opts)
		)
		let expiry: ReturnType<typeof setTimeout> | undefined
		const expired = new Promise<null>((resolve) => {
			expiry = setTimeout(() => resolve(null), budget.remaining())
			// Never a reason to hold the process open: every branch of the race
			// below resolves on its own, and this one is only the loser's clock.
			expiry.unref?.()
		})
		try {
			return {
				event,
				deliveries: await Promise.all(
					pending.map(async (p, i) => {
						const settled = await Promise.race([p, expired])
						return settled ?? skipped(subs[i]!, ABANDONED)
					})
				)
			}
		} finally {
			if (expiry) clearTimeout(expiry)
		}
	}

	/** One subscriber. Never throws; every failure becomes a delivery. */
	private async deliver(
		manager: SandboxManager,
		s: EventSubscription,
		event: string,
		payload: unknown,
		budget: Budget,
		opts: EventEmitOptions
	): Promise<EventDelivery> {
		const startedAt = Date.now()
		const left = budget.remaining()
		// The budget is already spent — this subscriber is late to a fan-out
		// that is over, and giving it its own would be the per-hook budget by
		// another name (the rule `hookGrace` states for a late call).
		if (left <= 0) return skipped(s, EXHAUSTED)

		try {
			const r = await manager.callHook(
				s.pluginId,
				s.hookName,
				// The envelope, not the bare payload: one exported hook may be
				// subscribed to several events, and a payload that is not an
				// object has to travel too. The same shape the chain and node
				// seams use for the same reasons.
				{ event, payload },
				{
					// The budget is a ceiling, never an extension: whichever of
					// the subscriber's own deadline and what is left of the
					// fan-out's is shorter.
					timeoutMs: Math.min(s.timeoutMs, left),
					// One label per (emit instant, subscriber): distinct between
					// the subscribers of one occurrence, and replayable given
					// the pinned clock the emitter recorded.
					seedLabel: `event:${event}:${budget.nowMs}:${s.pluginId}:${s.hookName}`,
					nowMs: budget.nowMs,
					maxOutputBytes: opts.maxOutputBytes,
					// Without this a cancelled run cannot reach the fan-out at
					// all — the grace policy has nothing else to group by.
					runId: opts.runId,
					user: opts.user,
					lifecycle: false
				}
			)
			const durationMs = Date.now() - startedAt
			if (!r.ok)
				return {
					...at(s),
					outcome: "error",
					reason: r.reason,
					durationMs
				}
			const v = verdictOf(r.value)
			return {
				...at(s),
				outcome: v.outcome,
				reason: v.reason,
				durationMs
			}
		} catch (e) {
			// `callHook` answers a hook-level fault with a typed failure and
			// only rejects on a host bug — which must still not reach an
			// emitter, because a core write path is not the place to learn
			// about one.
			return {
				...at(s),
				outcome: "error",
				reason:
					`the event fan-out could not run this subscriber: ` +
					String((e as Error)?.message || e),
				durationMs: Date.now() - startedAt
			}
		}
	}
}

/** The one clock a fan-out is measured against. */
interface Budget {
	/** The instant the whole fan-out is pinned to — `ctx.now()` for everybody. */
	nowMs: number
	/** Milliseconds left of the fan-out's single budget; may go negative. */
	remaining(): number
}

function makeBudget(opts: EventEmitOptions): Budget {
	// A call site may lower the budget; it can never raise it past the constant,
	// so an emitter cannot buy an extension by asking for one.
	const ms = Math.max(
		1,
		Math.min(
			opts.budgetMs ?? EVENT_FANOUT_BUDGET_MS,
			EVENT_FANOUT_BUDGET_MS
		)
	)
	const startedAt = Date.now()
	return {
		nowMs: opts.nowMs ?? startedAt,
		remaining: () => startedAt + ms - Date.now()
	}
}

/** Who a delivery is about — the half of it that is the same either way. */
const at = (s: EventSubscription) => ({
	pluginId: s.pluginId,
	hookName: s.hookName
})

const CANCELLED = "the run was cancelled before this subscriber was dispatched"
const EXHAUSTED =
	"the fan-out budget was spent before this subscriber was dispatched"
const ABANDONED =
	"the fan-out budget expired while this subscriber was still running; " +
	"it was abandoned, not stopped"

function skipped(s: EventSubscription, reason: string): EventDelivery {
	return { ...at(s), outcome: "skipped", reason, durationMs: 0 }
}

/** The process-wide registry. */
let registry = new PluginEventRegistry()

export function pluginEvents(): PluginEventRegistry {
	return registry
}

/**
 * Reconcile the registry with what enabled plugins declare.
 *
 * Global rather than per-plugin, and per-entry warn-and-continue, for the same
 * reasons `syncPluginEngines` is both: the desired state is a projection of one
 * table, and one plugin's bad declaration must not cost another's subscription.
 */
export async function syncPluginEventHooks(db: Db): Promise<void> {
	const rows: Array<{
		pluginId: string
		manifest: unknown
		adminDenied: string[] | null
	}> = await db
		.select({
			pluginId: plugins.pluginId,
			manifest: plugins.manifest,
			adminDenied: plugins.adminDenied
		})
		.from(plugins)
		.where(eq(plugins.enabled, true))

	const all: EventSubscription[] = []
	for (const row of rows) {
		const { subscriptions, problems } = subscriptionsOf(row)
		for (const p of problems)
			console.warn(`[plugins] event subscription skipped: ${p}`)
		all.push(...subscriptions)
	}
	registry.replace(all)
}

/** Test-only: forget every subscription. */
export function _resetEventHost(): void {
	registry = new PluginEventRegistry()
}
