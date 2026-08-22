/**
 * Shapes — versioned edge/payload contracts (01 §1, §3).
 *
 * A shape is the unit of compatibility. Two nodes connect if the upstream port's
 * shape is assignable to the downstream port's. Shapes are also connection kinds
 * and sampling-config kinds (F17), which is what makes the system modality-agnostic:
 * nothing anywhere switches on "is this an LLM".
 */
export type ShapeId = string;
export interface ShapeDef {
    id: ShapeId;
    /** Shapes this one may be assigned to. A stream is assignable to its settled form. */
    assignableTo?: ShapeId[];
    /** True if a downstream node may begin consuming before the value settles (F22). */
    streaming?: boolean;
}
export declare function defineShape(def: ShapeDef): ShapeId;
export declare function getShape(id: ShapeId): ShapeDef | undefined;
export declare function isStreaming(id: ShapeId): boolean;
/** The permissive sink: anything serializable may flow into a json port. */
export declare const JSON_SHAPE = "core:shape/json@1";
/** Assignability: identical, into json, or declared assignable (transitively). */
export declare function assignable(from: ShapeId, to: ShapeId, seen?: Set<string>): boolean;
/** Reset — test isolation only. */
export declare function _clearShapes(): void;
export declare const S: {
    readonly text: string;
    readonly textStream: string;
    readonly chatScope: string;
    readonly messages: string;
    readonly candidates: string;
    readonly renderedBlocks: string;
    readonly assembled: string;
    /**
     * What Assemble publishes after the allocation/formatting split (16 §7): ordered
     * **blocks** with role, source, token count and a `why` trail — not prose. The
     * Provider's `wire` slot turns it into whatever its connection actually wants.
     *
     * Assignable to `assembled-context@1` so existing specs keep connecting while core
     * migrates; the reverse is not assignable, because a rendered string has already
     * thrown away everything the panel and the budget need.
     */
    readonly allocated: string;
    /**
     * The object a context template renders against: characters, personas,
     * scenario, the prompt texts, the resolved names.
     *
     * Its own shape rather than `json@1` so that a plugin supplying an alternative
     * context builder has something to publish, and so a spec that wires the wrong
     * node into Assemble's context port fails at publish rather than rendering a
     * template full of blanks — which reads as a broken template, and sends the
     * user to the wrong screen.
     */
    /**
     * The chat's cast and prompt config, as rows — before any decision about who
     * is shown or named. The input to the context builder, kept distinct from the
     * built context so the two can be replaced independently.
     */
    readonly chatCast: string;
    readonly templateContext: string;
    readonly vector: string;
    readonly budget: string;
    readonly rowIds: string;
    /**
     * The output of an async block or a map (01 §1, 13 §1). An ordered list in
     * **declaration order**, one entry per branch — never a merged object, because
     * merging needs a field-collision policy and every such policy is wrong for
     * somebody. `async` and `map` produce the same shape, so one equivalence
     * harness covers both (F26).
     */
    readonly branchResults: string;
    /**
     * What a **gate-eligible** Consumer publishes (13 §7j-b). Discriminated, because
     * under `async` review the write is a proposal a reviewer may still reject — and
     * a proposal id in a shared id space is indistinguishable from a real row id
     * right up until the foreign key dangles.
     *
     * Deliberately **not** assignable to `row-ids@1`. That is the whole enforcement:
     * a downstream node that wants ids must declare this port shape and handle both
     * cases in its hook, or the existing port-mismatch error fires at publish. There
     * is no branch node to check `status` with (F25), so the obligation belongs to
     * the type, not to the spec.
     */
    readonly writeResult: string;
    /**
     * A request to summarize something into a lore entry.
     *
     * Its own shape rather than `json@1` because it is what the summarize
     * pipelines take as *input*, and 11 §2 matches an event's payload against a
     * pipeline's Input contract by shape. A request typed as bare json would make
     * every pipeline compatible with every event.
     */
    readonly summarizeRequest: string;
    /**
     * The ordered batch drafts phase 1 produces, before synthesis merges them.
     *
     * Ordered, and the order is load-bearing: the drafts are chronological
     * slices of a conversation and synthesis reads them as a sequence. A shape
     * that permitted reordering would turn a narrative into a pile of events.
     */
    readonly drafts: string;
    /** Scenes with their messages, as the graph builder walks them. */
    readonly graphScenes: string;
    /**
     * A proposed set of graph nodes and relationships, before a person approves it.
     *
     * Distinct from anything holding row ids, for the reason `write-result@1`
     * exists: a proposal is not yet a row, and a downstream node that treated it
     * as one would wire a foreign key to something a reviewer may still reject.
     */
    readonly graphProposal: string;
    readonly audio: string;
    readonly image: string;
    readonly json: string;
    readonly textGen: string;
    readonly embeddings: string;
    readonly tts: string;
    readonly imageGen: string;
};
//# sourceMappingURL=shapes.d.ts.map