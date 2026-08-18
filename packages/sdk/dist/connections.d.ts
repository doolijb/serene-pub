/**
 * What an import has to wire before it can run — the ruling on 13 §10a.
 *
 * The question was whether connection bindings deserve their own table, so that an
 * export could state *structurally* that connections were excluded rather than relying
 * on the exporter to strip them.
 *
 * **Ruled: no table.** A second table implies a second lifecycle — its own ids, its own
 * ownership rules, its own migration — and there isn't one. A connection binding is a
 * config value at instance scope, which 12's five-layer chain already owns.
 *
 * The guarantee people wanted from the table is available without it, and stronger. A
 * table could only ever report the connections the exporting instance had *filled in*,
 * so a spec exported before anyone configured it would claim to need nothing and the
 * importer would find out at the first run. Slots are declared on the **type**, so
 * deriving the requirement from descriptors is complete by construction — independent of
 * what the exporter did, and independent of whether the exporter was even configured.
 */
import type { SpecDocument } from './document.js';
export interface ConnectionRequirement {
    nodeKey: string;
    slot: string;
    /** Which connection kind satisfies it — the produced shape (F17). */
    kind?: string;
    typeId: string;
}
/** Every connection this document needs, derived from its types. */
export declare function requiredConnections(doc: SpecDocument): ConnectionRequirement[];
/**
 * What is still unwired, given what the importing instance has bound so far.
 *
 * Feeds `needs-configuration` (12 §6), which is deliberately not `broken`. A spec nobody
 * has given a connection is not damaged, it is unfinished — and the difference decides
 * whether a user files a bug or opens settings.
 */
export declare function unwiredConnections(doc: SpecDocument, bound: ReadonlyArray<{
    nodeKey: string;
    slot: string;
}>): ConnectionRequirement[];
/**
 * The line an import screen shows. Names the kind, because F17 means only connections
 * producing that shape are eligible — offering the rest is offering a mistake.
 */
export declare const renderRequirement: (r: ConnectionRequirement) => string;
//# sourceMappingURL=connections.d.ts.map