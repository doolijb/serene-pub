/**
 * `/contracts` generation (04 §2, §4b).
 *
 * Every SP release publishes frozen, generated type declarations. This is the generator:
 * descriptors in, a TypeScript module out. In core the input is `type_registry` rows; here
 * it is the in-memory registry, which is the same data.
 *
 * **The binding name is derived, never chosen.** It is the camelCase of the id's name
 * segment, and nothing else. That rule exists because the alternative was discovered by
 * writing it out: eleven of thirty-five hand-written names did not match their ids —
 * `generateText` for `text-gen`, `speak` for `tts`, `savePluginData` for `plugin-data`.
 * A generator with a hand-maintained alias table is a generator that drifts, and the drift
 * lands on plugin authors who imported a name that no longer exists.
 *
 * So the naming convention is enforced here rather than documented:
 *
 * - **Shapes are nouns** — what a thing *is*. They double as connection kinds (F17), so
 *   they read as categories: `text-gen`, `embeddings`, `row-ids`, `allocated-context`.
 * - **Task / Provider / Consumer types are verb phrases** — they *do* something:
 *   `generate-text`, `embed-text`, `render-image`, `create-message`, `assemble`.
 * - **Query types name their source** — a Query is chosen by what it returns, which is
 *   what a user tuning "how much should lore matter" is looking at: `chat-history`,
 *   `persona-card`, `lorebook-triggers`.
 *
 * Renaming `core:provider/text-gen@1` to `core:provider/generate-text@1` also removed a
 * collision worth naming: it was the same string as `core:shape/text-gen@1`, the operation
 * and the category spelled identically in different namespaces.
 */
import type { Descriptor } from '@serene-pub/sdk';
/** `'core:query/chat-history@2'` → `{ ns: 'core', kind: 'query', name: 'chat-history', version: 2 }` */
export declare function parseTypeId(id: string): {
    ns: string;
    kind?: string;
    name: string;
    version: number;
};
export declare const camel: (s: string) => string;
/** The one and only rule. */
export declare const bindingNameFor: (id: string) => string;
export interface DerivationProblem {
    id: string;
    given: string;
    expected: string;
}
/**
 * Check a hand-written contracts module against the rule. Run in CI: the moment a name
 * stops being derivable, generation would need an alias table, and that is the failure.
 */
export declare function checkDerivable(entries: Array<{
    name: string;
    id: string;
}>): DerivationProblem[];
export interface GenerateOptions {
    /** Written into the banner so a stale file is obvious in a diff. */
    release?: string;
    /** Import specifier for the SDK itself. */
    sdk?: string;
}
/**
 * Emit a contracts module. Descriptors are emitted as data plus a `pin()` call, so the
 * generated file is readable and diffable rather than a blob — a plugin author reading
 * `/contracts` to find out what ports a node has should be able to.
 */
export declare function generateContracts(types: Descriptor[], opts?: GenerateOptions): string;
/**
 * The manifest's view of a type: what an admin's audit screen and the install-time
 * permission check read, without loading any code (10 §10.2).
 */
export interface TypeSummary {
    id: string;
    binding: string;
    kind: string;
    version: number;
    ports: {
        in: string[];
        out: string[];
    };
    slots: string[];
    effects?: string;
    causesEvent?: string;
    public?: boolean;
    declaresRandomness?: boolean;
    timeoutMs?: number;
}
export declare const summarizeType: (d: Descriptor) => TypeSummary;
//# sourceMappingURL=codegen.d.ts.map