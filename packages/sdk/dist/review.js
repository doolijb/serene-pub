/**
 * The review gate (01 §7).
 *
 * The gate lives in the executor substrate, below the type layer, and keys on
 * **declared effects rather than kind** — so an effectful Provider (an MCP tool that
 * sends mail) gates exactly like a Consumer.
 *
 * The properties that matter are all negative, and each has a test:
 *   · the gated party never implements the gate
 *   · plugin code cannot decline it, detect it, or tell an approved payload from an edited one
 *   · an author may default it **on** for their own node; forbidding it is not expressible
 */
/**
 * There is deliberately no `'never'` position and no descriptor field that could produce
 * one. An author picks a default; the user's setting wins over it. Forbidding review is
 * not a value this type can hold, which is the enforcement (F14).
 */
export const POSITIONS = ['off', 'async', 'sync'];
export function hashPayload(v) {
    const s = JSON.stringify(v ?? null);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++)
        h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16);
}
/**
 * Resolve the effective position: user setting if present, else the author's default,
 * else off. An author can raise the floor and never lower it below what a user chose.
 */
export function resolvePosition(authorDefault, userSetting) {
    if (typeof userSetting === 'string' && POSITIONS.includes(userSetting)) {
        return userSetting;
    }
    return authorDefault ?? 'off';
}
/** Which nodes the gate applies to — effects, not kind (01 §7, 14 §4a). */
export function isGated(effects) {
    return effects === 'write' || effects === 'external';
}
//# sourceMappingURL=review.js.map