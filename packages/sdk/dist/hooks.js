/**
 * The three hook kinds and their injected surfaces (01 §9, F10, F32).
 *
 * "Hook" is never used bare — the three kinds have different rules, and the rules are
 * enforced by *what is in the object*, not by a document someone reads. A capability
 * that isn't on the surface cannot be called, which is why these are types rather than
 * a checklist.
 */
// ── Conformance probes (03 §9) ──────────────────────────────────────────────
/** Capability names no hook surface may carry, whatever the kind. */
const FORBIDDEN_ON_ANY_HOOK = ['callProvider', 'call', 'provider', 'fetch', 'trigger', 'run', 'emit'];
/**
 * F32, checked rather than documented. The probe reads the surface an implementation
 * actually hands out — a regression that adds `callProvider` back fails here instead
 * of shipping.
 */
export function assertHookSurface(kind, surface) {
    const keys = new Set(Object.keys(surface));
    const found = FORBIDDEN_ON_ANY_HOOK.filter((k) => keys.has(k));
    // Only pipeline hooks reach Providers, and they do it by *being* a node the
    // executor invokes — never by holding a handle.
    if (kind === 'lifecycle' && keys.has('writeCore'))
        found.push('writeCore');
    return found.length ? { ok: false, found } : { ok: true };
}
/**
 * The scheduled-work path, stated as code so it is discoverable from the SDK rather
 * than only from 13 §7c.
 */
export const SCHEDULED_WORK_PATH = {
    instead: 'core:event/schedule-tick@1',
    because: 'a hook calling a Provider would opt out of the receipt, the budget and the review gate, ' +
        'and would not appear on the consent screen a user reads (F32, 11 §4)',
};
//# sourceMappingURL=hooks.js.map