/**
 * Preview runs — "show me what would be sent, and why" (debug mode in chat).
 *
 * A preview is **not a second estimator**. It is the ordinary run, stopping at the
 * pre-call substrate: input resolved, context assembled, payload formed, token count
 * taken — and then `halt` instead of `call`. That is the whole design constraint. Any
 * implementation that computes "what we would send" on a separate path drifts from what
 * actually gets sent, silently, and is most wrong exactly when someone is debugging
 * because something is off.
 *
 * Almost everything the panel shows is already in the receipt: Assemble records the
 * allocation it computed and the inputs it computed it from (16 §5a), and the Provider's
 * resolved input is recorded like any node's. The preview hoists those into one place so
 * a UI does not have to reassemble them from three node receipts, and adds the one thing
 * that only exists at the call site — the formed payload and its token count.
 */
import type { Receipt } from './receipt.js';
export interface PreviewBlock {
    id?: string;
    sourceKey?: string;
    tokens: number;
    included: boolean;
    weight?: number;
    priority?: string;
    /**
     * Why this block is here, or isn't. The panel is only worth opening if this is
     * populated, and it can only be populated if each stage leaves its trace on the
     * item — the trigger Query records which key matched, the rank Task records the
     * probability roll and the group it won or lost, Assemble records budget exhaustion.
     */
    reason?: string;
    /** The full trail, each stage's line in order (src/wire.ts `why`). */
    why?: string[];
    role?: string;
}
export interface PreviewReport {
    /** Where the run stopped, and why that node. */
    atNode: string;
    typeId: string;
    targetedBy: 'first-provider-on-spine' | 'explicit';
    /** Metadata only — material never leaves core (F18). */
    connection?: {
        id?: string;
        kind?: string;
        contextLength?: number;
        tokenizer?: string;
    };
    budget?: {
        maxContext?: number;
        reserved?: number;
        available?: number;
    };
    /** The payload as it would have gone out, and the count that would have applied. */
    context: {
        rendered: unknown;
        tokens: number;
    };
    /**
     * How blocks became that payload (16 §7). Present once a Provider declares a `wire`
     * slot — and it is what makes the scaffolding cost visible rather than a mystery
     * gap between "my blocks add up to 3,000" and "it said 3,180".
     */
    wire?: {
        format: string;
        blockTokens: number;
        overheadTokens: number;
    };
    blocks: PreviewBlock[];
    totals: {
        blocks: number;
        included: number;
        dropped: number;
        tokensIncluded: number;
        tokensDropped: number;
        /** Positive means the formed payload does not fit — the estimator was wrong. */
        overBudgetBy?: number;
    };
    /** Whatever the node feeding the context port produced — Assemble's allocation record. */
    allocation?: unknown;
}
/**
 * A stand-in tokenizer. The real one comes from connection metadata (`tokenizer`), is
 * loaded once per connection and reused — counting sixty blocks should be sixty cheap
 * calls against something already resident, not sixty model loads.
 */
export declare const roughTokens: (v: unknown) => number;
/** Choose where a preview stops. */
export declare function previewTarget(nodes: Array<{
    key: string;
    kind: string;
    blockId?: string;
    position: number;
}>, explicit?: string): {
    key: string;
    targetedBy: PreviewReport['targetedBy'];
} | undefined;
export declare function renderPreview(p: PreviewReport): string;
/** Convenience for a UI: the preview, if this receipt is one. */
export declare const previewOf: (r: Receipt) => PreviewReport | undefined;
//# sourceMappingURL=preview.d.ts.map