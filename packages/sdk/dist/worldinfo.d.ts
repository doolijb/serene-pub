/**
 * World Info parity — testing the claim in 13 §7i.
 *
 * The competitive assessment asserts that every SillyTavern World Info feature "maps into
 * the existing model as params or template logic, not as new mechanisms." That was an
 * untested claim about the most competitively important feature in the product, so this
 * module implements them and the tests check whether it held.
 *
 * Verdict, recorded honestly at the bottom of this file.
 */
export interface LoreEntry {
    id: string;
    title: string;
    content: string;
    keys: string[];
    /** Secondary filter with a logic operator, as ST has. */
    secondary?: {
        op: 'AND_ANY' | 'AND_ALL' | 'NOT_ANY' | 'NOT_ALL';
        keys: string[];
    };
    useRegex?: boolean;
    /** Always inserted, budget permitting — ST's "constant". */
    constant?: boolean;
    /** 0..1. ST rolls this unreproducibly; here it rolls against the run seed. */
    probability?: number;
    /** Competing entries share a label; the highest weight (or order) wins. */
    group?: string;
    groupWeight?: number;
    /** Larger order sits closer to the end of the context. */
    order?: number;
    /** Where it goes: a named position, or a depth into the chat history. */
    position?: 'before_char' | 'after_char' | 'author_note' | {
        atDepth: number;
    };
    /**
     * ⚠ **The one real parity gap** (13 §7i). Depth positioning is expressed in the
     * assembly template, not by a node or a shape — but the template has to have
     * something to compare against, and **SP lorebook entries carry no `depth` today.**
     *
     * This field is the whole fix: an entry-schema addition in the lorebook model, not
     * architecture. "Feature missing" and "architecture can't express it" are different
     * sizes of problem and only the first was ever true. See 16 §5e and use case 41.
     */
    depth?: number;
    /** May this entry activate others by mentioning their keys? */
    recursable?: boolean;
    preventRecursion?: boolean;
}
export interface ScanParams {
    scanDepth: number;
    caseSensitive: boolean;
    recursionDepth: number;
    useRegex: boolean;
}
/**
 * Activation, including bounded recursion.
 *
 * Recursion lives *inside* the Query hook's opaque interior (01 §12.3) and is bounded by a
 * declared param — so it needs no pipeline-level construct and cannot become an unbounded
 * loop. This is the part of the parity claim that held cleanly.
 */
export declare function activate(entries: LoreEntry[], scanText: string[], p: ScanParams): {
    entry: LoreEntry;
    depth: number;
}[];
/** Probability, rolled against the run seed — so it replays, which ST's cannot. */
export declare function rollProbability(hits: {
    entry: LoreEntry;
    depth: number;
}[], random: () => number): {
    kept: LoreEntry[];
    rolledOut: string[];
};
/**
 * Inclusion groups: competing entries share a label, and one wins by group weight, with
 * insertion order as the deterministic tiebreak.
 *
 * This is ranking, so it belongs in the rank Task (16 §5c) — no new mechanism.
 */
export declare function resolveGroups(entries: LoreEntry[], random: () => number): {
    kept: LoreEntry[];
    lost: string[];
};
export interface PositionedItem {
    id: string;
    rendered: string;
    order: number;
    position: LoreEntry['position'];
    weight: number;
    priority: 'always' | 'high' | 'normal' | 'low';
}
/**
 * Depth positioning **in a Task** — one of two valid places to do it.
 *
 * ⚠ RETRACTION. An earlier version of this file claimed depth positioning "didn't map" and
 * needed a shape change. That was wrong. **Depth is a context-template concern**, and the
 * assembly template expresses it directly:
 *
 * ```jinja
 * {% for m in messages %}{% set d = loop.revindex %}
 *   {% for l in lore %}{% if l.depth == d %}{{ l.rendered }}{% endif %}{% endfor %}
 *   {{ m.rendered }}
 * {% endfor %}
 * ```
 *
 * That is tested end to end in use case 41. Nothing about `context-candidates` changes —
 * it already carried `items[]`, which is all the loop needs. The only real requirement is
 * the obvious one: a Query that flattens its messages into a single opaque string forecloses
 * it, so history reaches the template as a list. That is guidance, not a schema change.
 *
 * This function remains as the Task-side alternative, for authors who would rather compute
 * placement than express it in a template.
 */
export declare function assembleWithPositions(history: PositionedItem[], lore: PositionedItem[], budget: number, costOf: (s: string) => number): {
    text: string;
    included: string[];
    dropped: string[];
};
/**
 * ── Verdict on 13 §7i's claim ──────────────────────────────────────────────
 *
 * **Seven of seven mapped with no new mechanism.**
 *
 *   · regex keys, logic operators, scan depth  → params on the trigger Query
 *   · recursion                                → bounded scan inside the Query's interior
 *   · constants                                → priority 'always', honoured before budget
 *   · probability                              → the run seed, and replayable unlike ST's
 *   · inclusion groups + group weight          → the rank Task, which already existed
 *   · insertion order                          → sort key, or template ordering
 *   · positional insertion at chat depth       → the assembly template, via a loop over
 *                                                messages with the depth captured by `set`
 *
 * The claim held. An earlier draft of this file reported a shape change was needed; that was
 * my error, corrected after Jody pointed out depth is a templating concern.
 *
 * ── The real parity gap is elsewhere ───────────────────────────────────────
 *
 * **SP's lorebook entries have no `depth` field today.** The pipeline can position by depth
 * the moment an entry carries one — so the work is an entry-schema addition in the lorebook
 * model, not anything in the pipeline architecture. Worth stating precisely, because
 * "positional insertion is missing" and "the architecture can't express it" are very
 * different problems and only the first one is true.
 */
//# sourceMappingURL=worldinfo.d.ts.map