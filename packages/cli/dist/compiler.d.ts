/**
 * The packager (04 §5a, U24b).
 *
 * Two halves, and the split is a law rather than a convenience:
 *
 * **Static.** Hooks, components, settings and permissions are extracted by walking the
 * TypeScript AST — *without executing the author's code*. "Hooks are never discovered at
 * runtime" (13/§30), so a registration built by a loop or a variable is a **lint error,
 * never a silent omission**. The manifest has to be a complete statement of what a plugin
 * can do, or the permission model is a guess and the audit screen is fiction.
 *
 * **Evaluated.** Pipelines are compiled by building the spec value and projecting it to a
 * document. That is allowed: F6 says *SP* never evaluates a builder chain — "no importer
 * path evaluates a builder chain" — not that the author's own build tool doesn't. SP
 * imports the document. This is where the document comes from.
 *
 * The line matters because it decides what an attacker can do. A malicious plugin can run
 * whatever it likes on the author's machine at build time; it cannot make SP run anything
 * at install time, because install reads documents and a manifest, both of which are data.
 */
import type { Extension } from '@serene-pub/sdk';
import type { SpecDocument } from '@serene-pub/sdk';
import { type TypeSummary } from './codegen.js';
export interface CompileFinding {
    severity: 'error' | 'warning';
    file: string;
    line: number;
    code: string;
    message: string;
    /** Required on every error — a prohibition without an alternative is a bug (15 §1.3). */
    fix: string;
}
export interface Manifest {
    schemaVersion: 1;
    slug: string;
    name: string;
    version: string;
    description?: string;
    engines?: Record<string, string>;
    /** Node types this plugin registers, summarized for the audit screen (10 §10.2). */
    types: TypeSummary[];
    hooks: {
        pipeline: Array<{
            typeId: string;
            visibility: 'private' | 'public';
            runtime: 'node' | 'process';
        }>;
        lifecycle: Array<{
            moment: string;
            cadence?: string;
        }>;
        event: Array<{
            event: string;
        }>;
    };
    components: Array<{
        surface: string;
        slug: string;
        framework: string;
        entry: string;
    }>;
    settings?: Record<string, unknown>;
    /** Pipelines shipped, by identity — the documents travel beside the manifest. */
    pipelines: Array<{
        id: string;
        version: string;
        nodes: number;
        presets: string[];
    }>;
    /**
     * **Compiled from usage, never declared.** An author cannot over-request, and cannot
     * under-declare either — the audit screen shows what the code can actually reach.
     */
    permissions: string[];
    peerTypes: string[];
}
export interface CompileResult {
    manifest?: Manifest;
    documents: SpecDocument[];
    findings: CompileFinding[];
    ok: boolean;
}
export interface StaticScan {
    findings: CompileFinding[];
    permissions: string[];
    /** Declaration call sites found, for cross-checking against the evaluated module. */
    declared: {
        extensions: number;
        pipelineHooks: number;
        lifecycleHooks: number;
        eventHooks: number;
        components: number;
    };
}
/**
 * Walk source text. **Never evaluates.**
 *
 * ⚠ This is a lexical scanner, not a parser. It is dependency-free and version-stable,
 * which is right for a draft, and it will miss things a real AST would catch — an
 * identifier named `component` used for something else, for one. **Core should swap in a
 * proper parser**; the interface is the part that matters, and the findings it produces
 * are the contract.
 */
export declare function scanSource(files: Array<{
    path: string;
    text: string;
}>): StaticScan;
export interface CompileInput {
    /** Source files, for the static half. */
    sources: Array<{
        path: string;
        text: string;
    }>;
    /** The evaluated extension, for the pipeline half. */
    extension?: Extension;
}
/**
 * Produce the manifest and the pipeline documents.
 *
 * Cross-checks the two halves against each other: if the AST found three hooks and the
 * evaluated module exposes two, something is being registered conditionally, and the
 * manifest would understate what the plugin can do.
 */
export declare function compilePlugin(input: CompileInput): CompileResult;
export declare function renderFindings(findings: CompileFinding[]): string;
/**
 * The install-time counterpart to "permissions are compiled from usage": what a plugin
 * says it *cannot* do. Generated, so it cannot flatter (U32).
 */
export declare function cannotDo(m: Manifest): string[];
//# sourceMappingURL=compiler.d.ts.map