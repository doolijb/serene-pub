/**
 * Sample core contracts — what /contracts would generate.
 *
 * Every entry is a descriptor plus a pinned constructor. Note that the LLM, TTS and
 * image-gen providers are structurally identical: `params` is declared per type, so
 * nothing anywhere switches on modality (17 §1).
 */
export declare const userMessage: import("@serene-pub/sdk").Pinned<{
    kind: "input";
    id: "core:input/user-message@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: import("@serene-pub/sdk").PortDecl | undefined;
        out?: {
            main: string;
            text: string;
            chatScope: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * A message that already exists — the trigger carries its id.
 *
 * `messageId` is `row-ids@1` rather than `json` because it *is* a row id, and typing it
 * as one is what makes `updateMessage` wireable at all: the id an update is allowed to
 * take is the id of a row that already exists, which is exactly what an event about an
 * existing message carries (13 §10b).
 */
export declare const messageCreated: import("@serene-pub/sdk").Pinned<{
    kind: "input";
    id: "core:input/message-created@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: import("@serene-pub/sdk").PortDecl | undefined;
        out?: {
            main: string;
            messageId: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const chatHistory: import("@serene-pub/sdk").Pinned<{
    kind: "query";
    id: "core:query/chat-history@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            scope: string;
            budget: string;
        } | undefined;
        out?: {
            main: string;
            messages: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const lorebookTriggers: import("@serene-pub/sdk").Pinned<{
    kind: "query";
    id: "core:query/lorebook-triggers@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            text: string;
            scope: string;
        } | undefined;
        out?: {
            main: string;
            hits: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Probability rolls come from the run seed, so they replay (13 §7i). */
export declare const lorebookProbabilistic: import("@serene-pub/sdk").Pinned<{
    kind: "query";
    id: "core:query/lorebook-probabilistic@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            text: string;
        } | undefined;
        out?: {
            main: string;
            hits: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const vectorSearch: import("@serene-pub/sdk").Pinned<{
    kind: "query";
    id: "core:query/vector-search@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            /** Several query vectors, one ranked list each. */
            vectors: string;
            scope: string;
        } | undefined;
        out?: {
            main: string;
            hits: string;
            /** One ranked list per query vector, in the order they were given. */
            lists: string;
            /**
             * `cos(i, j)` over `hits`, by index. What MMR needs, without any
             * embedding leaving the host.
             */
            similarity: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const personaCard: import("@serene-pub/sdk").Pinned<{
    kind: "query";
    id: "core:query/persona-card@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            characterId: string;
        } | undefined;
        out?: {
            main: string;
            card: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const messageText: import("@serene-pub/sdk").Pinned<{
    kind: "query";
    id: "core:query/message-text@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            messageId: string;
        } | undefined;
        out?: {
            main: string;
            plain: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Illegal by construction elsewhere; used to prove the purity probe. */
export declare const network: import("@serene-pub/sdk").Pinned<{
    kind: "query";
    id: "test:query/network@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: import("@serene-pub/sdk").PortDecl | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const contextBudget: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/context-budget@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: import("@serene-pub/sdk").PortDecl | undefined;
        out?: {
            main: string;
            available: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const mergeCandidates: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/merge-candidates@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            sources: string;
        } | undefined;
        out?: {
            main: string;
            candidates: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const rankHybrid: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/rank-hybrid@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            candidates: string;
            budget: string;
        } | undefined;
        out?: {
            main: string;
            candidates: string;
            /**
             * The per-candidate trail: score, included, reason, and the signal
             * breakdown behind it.
             *
             * A declared out-port rather than an implementation detail, because it is
             * what Assemble allocates from — and because a ranker swapped in by a
             * plugin has to produce it too, or the budget panel goes blank the moment
             * anyone changes rankers (16 §5c).
             */
            decisions: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const rankByRecency: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/rank-by-recency@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            candidates: string;
            budget: string;
        } | undefined;
        out?: {
            main: string;
            candidates: string;
            /**
             * The per-candidate trail: score, included, reason, and the signal
             * breakdown behind it.
             *
             * A declared out-port rather than an implementation detail, because it is
             * what Assemble allocates from — and because a ranker swapped in by a
             * plugin has to produce it too, or the budget panel goes blank the moment
             * anyone changes rankers (16 §5c).
             */
            decisions: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * The two retrieval query windows, as text.
 *
 * A Task because *how a message is written when it is a query* is a decision —
 * speaker attribution in brackets, emphasis stripped — and a different
 * embedding model might want a different shape. It is also where the two
 * windows are cut, which is the parameter a user with long posts will reach for
 * first.
 */
export declare const queryWindows: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/query-windows@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            messages: string;
            cast: string;
        } | undefined;
        out?: {
            main: string;
            current: string;
            recent: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * The semantic arm's ranking, as a Task.
 *
 * Nine stages the legacy engine runs inline: fuse the per-query lists, normalise
 * to the top, boost recency and author priority, cut on an adaptive threshold,
 * diversify with MMR, and cap each source. Every constant behind them is a
 * parameter here — one of them carries a `TODO: make configurable` in the
 * original.
 *
 * A Task rather than part of the vector Query because **it is policy**: which of
 * these stages run, and how hard, is exactly what an installation should be able
 * to replace. The Query retrieves and computes similarity; this decides.
 *
 * `similarity` is a port because MMR needs to compare candidates to each other
 * and a Task cannot ask the host for anything (F11). It is a matrix of cosines,
 * not the embeddings — derived, bounded, and not reversible into the vectors.
 */
export declare const rankSemantic: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/rank-semantic@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            /**
             * One entry per query window, each carrying its own per-message
             * ranked lists and its own similarity matrix. The whole stack
             * runs per window; the results are concatenated, not fused.
             */
            windows: string;
            messages: string;
        } | undefined;
        out?: {
            main: string;
            candidates: string;
            diagnostics: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * A plugin's ranker — same kind, same shape, so the swap list offers it (16 §5c).
 *
 * Named `rankRecall`, not `rankSemantic`: binding names derive from the id's
 * name segment and ignore the namespace, so this and `core:task/rank-semantic@1`
 * would both want to be `rankSemantic` and generation would emit one export
 * twice. `checkUnique` now catches that; the id changed here because a plugin
 * naming its ranker after its own product is the better name anyway.
 */
export declare const rankRecall: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "chariot.recall:rank-recall@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            candidates: string;
            budget: string;
        } | undefined;
        out?: {
            main: string;
            candidates: string;
            /**
             * The per-candidate trail: score, included, reason, and the signal
             * breakdown behind it.
             *
             * A declared out-port rather than an implementation detail, because it is
             * what Assemble allocates from — and because a ranker swapped in by a
             * plugin has to produce it too, or the budget panel goes blank the moment
             * anyone changes rankers (16 §5c).
             */
            decisions: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const renderEntries: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/render-entries@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            entries: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const assemble: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/assemble@2";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            candidates: string;
            budget: string;
            templateContext: string;
        } | undefined;
        out?: {
            main: string;
            context: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * Builds the object a context template renders against.
 *
 * A Task, not a Query, even though it reads the cast: what it *is* is the
 * resolution — which characters appear, which get named, which scenario wins —
 * and that is a decision anyone should be able to replace. The read reaches the
 * host like any other (F11 keeps the services out of the Task itself).
 *
 * Separate from Assemble on purpose. Assemble allocates a budget and renders;
 * this decides what there is to render. A plugin that wants different character
 * cards should not have to reimplement token allocation to get them.
 */
export declare const chatCast: import("@serene-pub/sdk").Pinned<{
    kind: "query";
    id: "core:query/chat-cast@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            scope: string;
        } | undefined;
        out?: {
            main: string;
            cast: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const buildTemplateContext: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/build-template-context@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            cast: string;
        } | undefined;
        out?: {
            main: string;
            templateContext: string;
            /**
             * The name on the trailing assistant line.
             *
             * Its own port rather than a field inside the context, because
             * nothing renders `{{seedName}}` — it is not a template variable.
             * It is what the message processor writes on the line the model
             * continues from, and in narrator mode it is the one name that
             * must *not* be the joined cast list: seeding "Alice and Cara:"
             * teaches the model to write joint dialogue instead of narrating.
             */
            seedName: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * Chat rows into the objects a template renders.
 *
 * A Task rather than part of the history Query, because naming a message —
 * which participant said it, under what name at the time — is a *decision*, and
 * decisions are the things a plugin should be able to replace. The Query returns
 * rows; this says who spoke.
 */
export declare const processMessages: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/process-messages@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            messages: string;
            cast: string;
            templateContext: string;
            seedName: string;
        } | undefined;
        out?: {
            main: string;
            messages: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Turns provider output back into candidate blocks — the map/reduce join. */
export declare const toCandidates: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/to-candidates@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            items: string;
        } | undefined;
        out?: {
            main: string;
            candidates: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** An author defaulting review ON for their own consumer — and unable to forbid it (F14). */
export declare const attachImage: import("@serene-pub/sdk").Pinned<{
    kind: "consumer";
    id: "core:consumer/attach-image@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            image: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const chunkText: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/chunk-text@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            text: string;
        } | undefined;
        out?: {
            main: string;
            items: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const roll: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "chariot.dice-tray:roll@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            notation: string;
        } | undefined;
        out?: {
            main: string;
            total: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const gate: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "test:task/gate@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            main: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const slow: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "test:task/slow@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            main: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const passthrough: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "test:task/passthrough@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            main: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const badToggleable: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "test:task/bad-toggleable@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            main: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const embedText: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: "core:provider/embed-text@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            text: string;
            /** Batched: one call, one vector each, in order. */
            texts: string;
        } | undefined;
        out?: {
            main: string;
            vector: string;
            vectors: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const generateText: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: "core:provider/generate-text@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            context: string;
        } | undefined;
        out?: {
            main: string;
            text: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const speak: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: "core:provider/speak@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            text: string;
        } | undefined;
        out?: {
            main: string;
            audio: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const renderImage: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: "chariot.comfy:render-image@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            context: string;
        } | undefined;
        out?: {
            main: string;
            image: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** An MCP tool. Effectful by default — annotations never decide gating (F31, 14 §4). */
export declare const mcpTool: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: "core:provider/mcp-tool@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            args: string;
        } | undefined;
        out?: {
            main: string;
            result: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Consumes a stream and may finish before it ends (01 §11). */
export declare const firstJson: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/first-json@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            main: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Same in-port, but no earlyExit declared — used to prove stream-abandoned. */
export declare const sloppyStream: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "test:task/sloppy-stream@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            main: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * Create a message.
 *
 * Split from the old `commitMessage`, which decided new-vs-update from whether an id
 * happened to be present (13 §10b). That was an implicit branch, and F25 exists because
 * implicit branches are unreadable: two specs that did different things looked identical,
 * and the receipt could not tell you which had happened. Two ids, two names, no inference.
 *
 * Gate-eligible, so it publishes the discriminated write result rather than raw ids
 * (13 §7j-b). Under async review this is a proposal a reviewer may still reject.
 */
export declare const createMessage: import("@serene-pub/sdk").Pinned<{
    kind: "consumer";
    id: "core:consumer/create-message@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            text: string;
        } | undefined;
        out?: {
            main: string;
            messageId: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * Update an existing message — a regenerate, a swipe, an edit.
 *
 * `target` takes `row-ids@1`, which means **a message created earlier in the same run
 * cannot be updated by a second node**, because `write-result@1` is not assignable to it.
 * That is the ruling, not an oversight: under async review the created row may never
 * exist, so a create → update pair in one spec is a dangling write waiting for a rejection.
 *
 * The case people reach for this with — write a placeholder, fill it as tokens arrive — is
 * streaming, and streaming is one node with a settled output (01 §11), not two nodes and a
 * hope. The case this *is* for is the one where the id comes from outside the run: the user
 * clicked a message, so the id is on the Input.
 */
export declare const updateMessage: import("@serene-pub/sdk").Pinned<{
    kind: "consumer";
    id: "core:consumer/update-message@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            target: string;
            text: string;
        } | undefined;
        out?: {
            main: string;
            messageId: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const attachAudio: import("@serene-pub/sdk").Pinned<{
    kind: "consumer";
    id: "core:consumer/attach-audio@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            audio: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const savePluginData: import("@serene-pub/sdk").Pinned<{
    kind: "consumer";
    id: "core:consumer/save-plugin-data@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            value: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const emitSocket: import("@serene-pub/sdk").Pinned<{
    kind: "consumer";
    id: "core:consumer/emit-socket@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            from: string;
        } | undefined;
        out?: {
            main: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const summarizeRequest: import("@serene-pub/sdk").Pinned<{
    kind: "input";
    id: "core:input/summarize-request@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: import("@serene-pub/sdk").PortDecl | undefined;
        out?: {
            main: string;
            scope: string;
            request: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** The messages a summary is drawn from, already scoped and ordered. */
export declare const summarizeSource: import("@serene-pub/sdk").Pinned<{
    kind: "query";
    id: "core:query/summarize-source@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            scope: string;
            request: string;
        } | undefined;
        out?: {
            main: string;
            messages: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * Cut the messages into batches a model can hold.
 *
 * A Task, not a Query: the cut is a *decision* — how many tokens per batch, and
 * therefore how much context each draft is written against — and it is the
 * first parameter a user with long posts reaches for.
 */
export declare const batchMessages: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "core:task/batch-messages@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            messages: string;
        } | undefined;
        out?: {
            main: string;
            batches: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Phase 1 — one batch, drafted without sight of any other. */
export declare const summarizeBatch: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: "core:provider/summarize-batch@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            batch: string;
        } | undefined;
        out?: {
            main: string;
            draft: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Phase 2 — the ordered drafts merged into one past-tense narrative. */
export declare const summarizeSynth: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: "core:provider/summarize-synth@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            drafts: string;
        } | undefined;
        out?: {
            main: string;
            content: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** What the entry gets called. Its own step because it has its own prompt. */
export declare const nameEntry: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: "core:provider/name-entry@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            content: string;
        } | undefined;
        out?: {
            main: string;
            name: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * Who was in the scene — scene summaries only.
 *
 * Present on one summarize pipeline and not the other three, which is exactly
 * why they are four specs rather than one spec with a flag. A flag would put the
 * difference in a condition somebody has to find; four specs put it in the shape.
 */
export declare const extractCast: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: "core:provider/extract-cast@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            content: string;
            messages: string;
        } | undefined;
        out?: {
            main: string;
            cast: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Write the finished entry. Gate-eligible, so it publishes a write result. */
export declare const createLoreEntry: import("@serene-pub/sdk").Pinned<{
    kind: "consumer";
    id: "core:consumer/create-lore-entry@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            name: string;
            content: string;
        } | undefined;
        out?: {
            main: string;
            entryId: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
export declare const graphScenes: import("@serene-pub/sdk").Pinned<{
    kind: "query";
    id: "core:query/graph-scenes@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            scope: string;
        } | undefined;
        out?: {
            main: string;
            scenes: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Which existing node a mentioned name refers to, or whether it is new. */
export declare const graphNodeResolution: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: string;
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            scenes: string;
        } | undefined;
        out?: {
            main: string;
            result: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Drop what is not worth graphing before the expensive steps run. */
export declare const graphPreFilter: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: string;
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            scenes: string;
        } | undefined;
        out?: {
            main: string;
            result: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Whose account of the scene this is. */
export declare const graphPerspective: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: string;
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            scenes: string;
        } | undefined;
        out?: {
            main: string;
            result: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** The two-sentence introduction written for a newly discovered character. */
export declare const graphNodeDescription: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: string;
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            scenes: string;
        } | undefined;
        out?: {
            main: string;
            result: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/** Did any present character reach a new lifecycle state this scene? */
export declare const graphStateDetection: import("@serene-pub/sdk").Pinned<{
    kind: "provider";
    id: string;
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            scenes: string;
        } | undefined;
        out?: {
            main: string;
            result: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
/**
 * The proposal, held for review.
 *
 * `effects: 'write'` and therefore gate-eligible, which is the mechanism behind
 * the rule that a graph build **stops at the review screen** and never applies
 * itself. Under `async` review the proposal is exactly that — a proposal — and
 * `write-result@1` is the shape that refuses to be mistaken for row ids.
 */
export declare const graphProposal: import("@serene-pub/sdk").Pinned<{
    kind: "consumer";
    id: "core:consumer/graph-proposal@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            proposal: string;
        } | undefined;
        out?: {
            main: string;
            proposalId: string;
        } | undefined;
    };
    effects?: "none" | "external" | "write" | "emit" | undefined;
    reviewDefault?: "off" | "async" | "sync" | undefined;
    shape?: import("@serene-pub/sdk").ShapeId | undefined;
    toggleable?: boolean | undefined;
    declaresRandomness?: boolean | undefined;
    earlyExit?: boolean | undefined;
    public?: boolean | undefined;
    timeoutMs?: number | undefined;
    timeoutKind?: "wall" | "idle" | undefined;
    causesEvent?: string | undefined;
    usage?: string | undefined;
}>;
//# sourceMappingURL=index.d.ts.map