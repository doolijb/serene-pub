/**
 * What a plugin hook's `ctx` carries, by the kind of hook it is (plans/29
 * R-3, 2026-09-17).
 *
 * Both sandboxes built one ctx — `{ random, now, log, storage, fetch, signal }`
 * — for every hook regardless of what invoked it, so a Task hook could reach
 * the network and a chain-link script could read its extension's rows: the
 * purity F11 promises of a task, and the parity in-app scripts already have
 * (`pipelines/scripts/host.ts` hands them `{ random, log, ...extras }`), held
 * for core's own handlers and not for a plugin's. The table below is the
 * host-side law; the SDK's `assertHookSurface` is the probe the boot runs over
 * the event and lifecycle rows of it.
 *
 * One table, read by three things that must agree: each sandbox's `invoke`
 * derives the grants it posts with the job, the boot check reads the keys
 * per kind, and the install-time conformance probe invokes a task hook under
 * the task row. A sandbox that built its ctx from its own copy of this would
 * be the drift the boot check exists to catch.
 */

/**
 * The kinds of hook the host dispatches. The four node kinds a plugin may
 * implement, a chain link (a script kind's hook, `hookDispatch.ts`), an event
 * listener and a lifecycle callback. NOMENCLATURE §9 keeps *surface* for a UI
 * extension point, so this is the hook *ctx* kind.
 */
export type HookCtxKind =
	| "task"
	| "query"
	| "oracle"
	| "outlet"
	| "chain-link"
	| "event"
	| "lifecycle"

export const HOOK_CTX_KINDS: readonly HookCtxKind[] = [
	"task",
	"query",
	"oracle",
	"outlet",
	"chain-link",
	"event",
	"lifecycle"
]

/** Which of the two permission-gated members a kind's ctx carries. */
export interface HookCtxGrants {
	/** The extension's own namespaced rows and files (`ctx.storage`). */
	storage: boolean
	/** Host-scoped network access (`ctx.fetch`). */
	fetch: boolean
}

/**
 * The table.
 *
 *  - **task**, **chain-link** — neither. A task is pure (F11) and a chain
 *    link is a script: the in-app script host hands one `{ random, log }` and
 *    a plugin's link gets the same.
 *  - **query**, **outlet**, **event**, **lifecycle** — storage. F32: an
 *    extension's own rows plus scoped core reads; no network.
 *  - **oracle** — storage and fetch. The one kind that calls out, which is
 *    what `effects: 'external'` names.
 */
const GRANTS: Record<HookCtxKind, HookCtxGrants> = {
	task: { storage: false, fetch: false },
	"chain-link": { storage: false, fetch: false },
	query: { storage: true, fetch: false },
	outlet: { storage: true, fetch: false },
	event: { storage: true, fetch: false },
	lifecycle: { storage: true, fetch: false },
	oracle: { storage: true, fetch: true }
}

export function isHookCtxKind(v: unknown): v is HookCtxKind {
	// Own keys only: `"constructor" in GRANTS` is true through the prototype,
	// and a kind read off a manifest or a registry row must not pass by it.
	return typeof v === "string" && Object.hasOwn(GRANTS, v)
}

/**
 * The grants for a kind. A missing or unknown kind is a programming error at
 * the call site — the six dispatchers each name theirs — so it throws rather
 * than defaulting: a default in either direction is a grant nobody decided.
 */
export function hookCtxGrants(kind: unknown): HookCtxGrants {
	if (!isHookCtxKind(kind))
		throw new Error(
			`a plugin hook was dispatched without a hook ctx kind (got ${JSON.stringify(kind)}); ` +
				`every call names one of ${HOOK_CTX_KINDS.join(" · ")} (plans/29 R-3)`
		)
	return GRANTS[kind]
}

/** The members every kind's ctx carries, before the grants. */
const BASE_KEYS = ["random", "now", "log", "signal"] as const

/**
 * The keys a hook of this kind finds on `ctx`, in the order the sandboxes
 * define them — what the boot hands `assertHookSurface`, and what the sandbox
 * tests compare `Object.keys(ctx)` against.
 */
export function hookCtxKeysFor(kind: HookCtxKind): string[] {
	const g = hookCtxGrants(kind)
	return [
		...BASE_KEYS.slice(0, 3),
		...(g.storage ? ["storage"] : []),
		...(g.fetch ? ["fetch"] : []),
		BASE_KEYS[3]
	]
}
