/**
 * A minimal template engine, enough to demonstrate variable awareness (16 §4).
 *
 * Supports `{{ a.b.c }}` and `{% for x in items %}…{% endfor %}`. Not Jinja — just
 * enough surface to answer the question the docs make a promise about: *can the editor
 * tell an author which variables exist, and flag one that doesn't?*
 *
 * ⚠ Writing this surfaced a correction to 16 §4 — see `templateScope`.
 */
export interface TemplateRef {
    /** The root identifier, e.g. `message` in `{{ message.author.name }}`. */
    root: string;
    path: string[];
    /** True when the reference is inside a loop and bound by it. */
    bound: boolean;
    dynamic: boolean;
}
/**
 * Extract top-level variable references. Loop-bound names are marked so they are not
 * reported as unknown, and anything computed is marked dynamic rather than verified —
 * an editor that promises correctness and lets a typo through is worse than one that
 * says what it checks (16 §4).
 */
export declare function extractRefs(src: string): TemplateRef[];
/** Render. Missing values become empty strings — templates never throw at run time. */
export declare function render(src: string, baseScope: Record<string, unknown>): string;
/**
 * ⚠ CORRECTION TO 16 §4.
 *
 * The docs say template variable awareness "falls out of typed ports with no new
 * mechanism." Building it shows that is only true for the **assembly** template, whose
 * scope really is its input ports.
 *
 * A **source** template renders one *item* out of a collection — one lorebook entry, one
 * message — and the item's shape lives *inside* the port's payload, not on the port. No
 * amount of port typing recovers it.
 *
 * So the template slot must **declare its own variable scope**. That is one extra field on
 * the descriptor, not a new mechanism, but the docs currently claim something that isn't
 * quite true and would have been discovered by the first plugin author who tried it.
 */
export type TemplateScope = Record<string, 'any' | string[]>;
export declare function templateScope(decl: {
    variables?: TemplateScope;
} | undefined): TemplateScope;
export interface TemplateFinding {
    severity: 'error' | 'warning';
    message: string;
    fix: string;
}
export declare function checkTemplate(src: string, scope: TemplateScope): TemplateFinding[];
//# sourceMappingURL=template.d.ts.map