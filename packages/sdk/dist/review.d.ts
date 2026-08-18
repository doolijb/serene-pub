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
export type ReviewPosition = 'off' | 'async' | 'sync';
export interface ReviewRequest {
    nodeKey: string;
    typeId: string;
    payload: unknown;
    position: Extract<ReviewPosition, 'sync' | 'async'>;
}
export interface ReviewDecision {
    action: 'approve' | 'edit' | 'reject';
    /** Present only for 'edit'. The binding cannot tell this from an approval. */
    payload?: unknown;
    by: string;
    at: number;
}
export interface ReviewRecord {
    nodeKey: string;
    position: ReviewPosition;
    action: ReviewDecision['action'] | 'proposed';
    originalHash: string;
    editedHash?: string;
    by?: string;
    at?: number;
}
/** Resolver supplied by the host. `sync` parks on this promise; waiting is free (F13). */
export type Reviewer = (req: ReviewRequest) => Promise<ReviewDecision>;
/**
 * There is deliberately no `'never'` position and no descriptor field that could produce
 * one. An author picks a default; the user's setting wins over it. Forbidding review is
 * not a value this type can hold, which is the enforcement (F14).
 */
export declare const POSITIONS: readonly ReviewPosition[];
export declare function hashPayload(v: unknown): string;
/**
 * Resolve the effective position: user setting if present, else the author's default,
 * else off. An author can raise the floor and never lower it below what a user chose.
 */
export declare function resolvePosition(authorDefault: ReviewPosition | undefined, userSetting: unknown): ReviewPosition;
/** Which nodes the gate applies to — effects, not kind (01 §7, 14 §4a). */
export declare function isGated(effects: string | undefined): boolean;
//# sourceMappingURL=review.d.ts.map