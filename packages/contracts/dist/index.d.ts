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
            vector: string;
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
/** A plugin's ranker — same kind, same shape, so the swap list offers it (16 §5c). */
export declare const rankSemantic: import("@serene-pub/sdk").Pinned<{
    kind: "task";
    id: "chariot.recall:rank-semantic@1";
    i18n?: {
        name?: import("@serene-pub/sdk").I18n;
        description?: import("@serene-pub/sdk").I18n;
    } | undefined;
    slots?: Record<string, import("@serene-pub/sdk").SlotDecl> | undefined;
    ports: {
        in?: {
            candidates: string;
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
        } | undefined;
        out?: {
            main: string;
            vector: string;
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
//# sourceMappingURL=index.d.ts.map