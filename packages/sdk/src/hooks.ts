/**
 * The three hook kinds and their injected surfaces (01 §9, F10, F32).
 *
 * "Hook" is never used bare — the three kinds have different rules, and the rules are
 * enforced by *what is in the object*, not by a document someone reads. A capability
 * that isn't on the surface cannot be called, which is why these are types rather than
 * a checklist.
 */

import type { Result } from './executor.js'

// ── Pipeline hook — the callable implementing a node type ───────────────────

/**
 * Data in, expected shape out; the executor is the only caller. Private = only the
 * owning extension's specs may pin it. Public = any spec may, which is how peer
 * composition happens — as a node on the spine, never a peer call mid-run (F10).
 *
 * Both are enumerated in the manifest. Listing private ones costs nothing and the
 * manifest is already the audit surface, since permissions are compiled from SDK
 * usage (13 §7c).
 */
export interface PipelineHookRules {
	kind: 'pipeline'
	typeId: string
	visibility: 'private' | 'public'
}

// ── Event hook — registered against a core event ────────────────────────────

export interface EventHookSurface {
	readEvent(): unknown
	readOwnRows(key?: string): unknown
	writeOwnRows(key: string, value: unknown): void
	log(level: 'info' | 'warn', message: string): void
	signal: AbortSignal
	/** Deliberately absent: callProvider (F32), trigger (F10). */
}

// ── Lifecycle hook — core-invoked at defined moments ────────────────────────

/**
 * Scoped core reads, plus read/write on the extension's own namespaced rows. Nothing
 * else (13 §7c).
 *
 * Two absences, and they are the same absence for the same reason. A lifecycle hook
 * may not call a Provider and may not trigger a pipeline, so **scheduled model work
 * subscribes to `core:event/schedule-tick@1` instead** — which gets it a receipt, a
 * budget and the review gate, and puts it on the consent screen. A lifecycle hook
 * doing that work would have had none of the four.
 */
export interface LifecycleHookSurface {
	readCore(table: string, q?: unknown): unknown
	readOwnRows(key?: string): unknown
	writeOwnRows(key: string, value: unknown): void
	log(level: 'info' | 'warn', message: string): void
	signal: AbortSignal
	/** Deliberately absent: callProvider (F32), trigger (F10), writeCore. */
}

export type LifecycleMoment =
	| 'load'
	| 'startup'
	| 'shutdown'
	| 'enable'
	| 'disable'
	| 'update'
	| 'sidecarSpawn'
	| 'scheduled'

export type EventHook = (surface: EventHookSurface) => Result | Promise<Result>
export type LifecycleHook = (surface: LifecycleHookSurface) => Result | Promise<Result>

// ── Conformance probes (03 §9) ──────────────────────────────────────────────

/** Capability names no hook surface may carry, whatever the kind. */
const FORBIDDEN_ON_ANY_HOOK = ['callProvider', 'call', 'provider', 'fetch', 'trigger', 'run', 'emit'] as const

/**
 * F32, checked rather than documented. The probe reads the surface an implementation
 * actually hands out — a regression that adds `callProvider` back fails here instead
 * of shipping.
 */
export function assertHookSurface(
	kind: 'event' | 'lifecycle',
	surface: object,
): { ok: true } | { ok: false; found: string[] } {
	const keys = new Set(Object.keys(surface))
	const found: string[] = FORBIDDEN_ON_ANY_HOOK.filter((k) => keys.has(k))
	// Only pipeline hooks reach Providers, and they do it by *being* a node the
	// executor invokes — never by holding a handle.
	if (kind === 'lifecycle' && keys.has('writeCore')) found.push('writeCore')
	return found.length ? { ok: false, found } : { ok: true }
}

/**
 * The scheduled-work path, stated as code so it is discoverable from the SDK rather
 * than only from 13 §7c.
 */
export const SCHEDULED_WORK_PATH = {
	instead: 'core:event/schedule-tick@1',
	because:
		'a hook calling a Provider would opt out of the receipt, the budget and the review gate, ' +
		'and would not appear on the consent screen a user reads (F32, 11 §4)',
} as const
