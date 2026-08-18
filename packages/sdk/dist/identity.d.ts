/**
 * Spec identity: **owner + slug + version** (12 §3b, 02 §3).
 *
 * Two versioning schemes live in this system and conflating them causes real confusion,
 * so they are stated apart:
 *
 * - **Types pin at an integer version** — `core:query/chat-history@1`. A pin is exact;
 *   a spec references one version and never floats.
 * - **Specs upgrade at semver** — `1.2.0`. An import replaces the installed copy when it
 *   is newer and is ignored when it is not, which is the rule already ruled for imported
 *   pipelines.
 *
 * So a spec id carries **no `@N` suffix**. The version is not part of the identity; it is
 * what the identity is compared *at*.
 */
export interface SpecIdentity {
    /** Who ships it: a plugin slug, `core`, or absent for a hand-imported document. */
    owner?: string;
    /** Stable, PK-agnostic reference. Unique per owner. */
    slug: string;
    version: string;
}
/**
 * Parse `owner:slug` — `chariot.rp:chat`, `core:chat-turn`, or a bare `chat-turn` for a
 * document someone hand-wrote and imported.
 */
export declare function parseSpecId(id: string): {
    owner?: string;
    slug: string;
};
export declare function assertSpecId(id: string): void;
/** −1, 0, 1. A prerelease sorts below the release it leads to. */
export declare function compareVersions(a: string, b: string): number;
export type ImportDecision = {
    action: 'install';
    reason: string;
} | {
    action: 'replace';
    reason: string;
} | {
    action: 'ignore';
    reason: string;
} | {
    action: 'conflict';
    reason: string;
};
/**
 * The import rule, already ruled: **a newer version replaces the installed copy; an equal
 * or older one is ignored.** Ownership is checked first, because "newer" is not a licence
 * to overwrite somebody else's row — a plugin update must not silently take over a spec
 * an admin imported by hand, or one another plugin ships.
 */
export declare function decideImport(incoming: SpecIdentity, installed?: SpecIdentity): ImportDecision;
/** Display form for logs and diffs — never a storage key. */
export declare const qualify: (i: SpecIdentity) => string;
//# sourceMappingURL=identity.d.ts.map