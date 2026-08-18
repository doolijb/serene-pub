/**
 * Document compilation (04 §5a, F3, F6).
 *
 * The builder chain is an *authoring format only*. SP imports the document and
 * never the JS — there is no importer path that evaluates a builder chain.
 *
 * Edges are derived here, 1:1 with pipeline_edges rows: the linear chain carries a
 * default edge, and every $ref becomes an explicit one.
 */

import type { BuiltSpec, BuiltNode } from './builder.js'
import { collectDataRefs, isSlotRef, type SlotRef } from './refs.js'
import { getType } from './descriptors.js'
import { requiredConnections, type ConnectionRequirement } from './connections.js'
import { isStreaming } from './shapes.js'

export interface DocEdge {
	from: string
	fromPort: string
	to: string
	toPort: string
	shape?: string
	streaming?: boolean
	/** true when derived from chain order rather than an explicit $ref */
	implicit?: boolean
}

export interface DocNode {
	key: string
	kind: string
	typeId: string
	typeVersion: number
	config: Record<string, unknown>
	blockId?: string
	blockKind?: string
	blockChain?: string
	position: number
	/** Config references resolved at publish and stored explicitly (16 §5b-i). */
	resolvedRefs?: Record<string, string>
}

export interface SpecDocument {
	schemaVersion: 1
	id: string
	version: string
	mode?: unknown
	subscribes: string[]
	includes: Array<{ key: string; fragmentId: string }>
	/** Author-shipped presets. Execution-affecting, so they round-trip (F4). */
	presets: BuiltSpec['presets']
	nodes: DocNode[]
	edges: DocEdge[]
	blocks: BuiltSpec['blocks']
}

/** Nodes that participate in the top-level sequential spine (not inside a block). */
const spineOf = (nodes: BuiltNode[]) => nodes.filter((n) => !n.blockId)

export function compile(built: BuiltSpec): SpecDocument {
	const nodes: DocNode[] = built.nodes.map((n) => ({
		key: n.key,
		kind: n.kind,
		typeId: n.typeId,
		typeVersion: n.typeVersion,
		config: n.config,
		blockId: n.blockId,
		blockKind: n.blockKind,
		blockChain: n.blockChain,
		position: n.position,
	}))

	const edges: DocEdge[] = []

	// Explicit $ref edges.
	for (const n of built.nodes) {
		for (const { path, ref } of collectDataRefs(n.config)) {
			const upstream = built.nodes.find((x) => x.key === ref.node)
			const outShape = upstream ? getType(`${upstream.typeId}@${upstream.typeVersion}`)?.ports.out?.[ref.port] : undefined
			// Whether an edge streams is decided here, at publish — so it is readable
			// off the spec rather than discovered by running it (01 §11).
			edges.push({
				from: ref.node,
				fromPort: ref.port,
				to: n.key,
				toPort: path.join('.'),
				shape: outShape,
				streaming: outShape ? isStreaming(outShape) : undefined,
			})
		}
	}

	// Implicit chain edges along the spine.
	const spine = spineOf(built.nodes)
	for (let i = 1; i < spine.length; i++) {
		const prev = spine[i - 1]!
		const cur = spine[i]!
		const already = edges.some((e) => e.to === cur.key && e.from === prev.key)
		if (!already) edges.push({ from: prev.key, fromPort: 'main', to: cur.key, toPort: 'main', implicit: true })
	}

	// Resolve config references that were left to publish (16 §5b-i).
	for (const n of nodes) {
		const resolved: Record<string, string> = {}
		for (const [k, v] of Object.entries(n.config)) {
			if (!isSlotRef(v)) continue
			const ref = v as SlotRef
			if (ref.resolveDownstreamProvider) {
				const target = resolveDownstreamProvider(built, n.key)
				resolved[k] = target
			} else if (ref.ofNode) {
				if (!built.nodes.some((x) => x.key === ref.ofNode)) {
					throw new Error(`node '${n.key}' references config of unknown node '${ref.ofNode}'`)
				}
				resolved[k] = ref.ofNode
			}
		}
		if (Object.keys(resolved).length) n.resolvedRefs = resolved
	}

	return {
		schemaVersion: 1,
		id: built.id,
		version: built.meta.version,
		mode: built.meta.mode,
		subscribes: built.subscribes,
		includes: built.includes,
		presets: built.presets,
		nodes,
		edges,
		blocks: built.blocks,
	}
}

/**
 * Follow the spine forward from `fromKey` to the first Provider. Linearity is what
 * makes this well-defined (F25). Ambiguity or absence is a publish error that names
 * the candidates — the teaching-error pattern (15 §1.3).
 */
export function resolveDownstreamProvider(built: BuiltSpec, fromKey: string): string {
	const ordered = built.nodes.slice().sort((a, b) => a.position - b.position)
	const start = ordered.findIndex((n) => n.key === fromKey)
	const after = ordered.slice(start + 1).filter((n) => n.kind === 'provider')
	// Providers inside a block are per-chain; only spine providers are unambiguous targets.
	const spineProviders = after.filter((n) => !n.blockId)
	if (spineProviders.length === 0) {
		const candidates = after.map((n) => n.key)
		throw new Error(
			`slot.downstreamProvider() on '${fromKey}' found no Provider downstream on the spine. ` +
				(candidates.length
					? `Providers exist inside blocks (${candidates.join(', ')}) — name one explicitly with slot.providerRef('…').`
					: `Add a Provider, or use slot.providerRef('…').`),
		)
	}
	return spineProviders[0]!.key
}

/** Canonical form — stable key order, for hashing and round-trip identity (F3). */
export function canonical(doc: SpecDocument): string {
	const sortObj = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(sortObj)
		if (v && typeof v === 'object') {
			return Object.fromEntries(
				Object.entries(v as Record<string, unknown>)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([k, val]) => [k, sortObj(val)]),
			)
		}
		return v
	}
	return JSON.stringify(sortObj(doc))
}

/** Cheap deterministic content hash — stands in for the real canonical_hash (02 §3). */
export function canonicalHash(doc: SpecDocument): string {
	const s = canonical(doc)
	let h1 = 0xdeadbeef
	let h2 = 0x41c6ce57
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		h1 = Math.imul(h1 ^ c, 2654435761)
		h2 = Math.imul(h2 ^ c, 1597334677)
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/** Import: document → the same in-memory form. `import(export(x))` is identity (F3). */
export function importDocument(doc: SpecDocument): SpecDocument {
	return JSON.parse(JSON.stringify(doc)) as SpecDocument
}

export interface ExportOptions {
	/**
	 * Which presets travel. The app lets a user choose; SDK compile has no instance to
	 * choose from, so it ships everything the author wrote.
	 */
	presets?: 'all' | 'none' | string[]
	/**
	 * How preset bindings travel — the same explicit fork pipeline export already offers
	 * (02 §6), never decided silently.
	 *
	 * - `base` keeps `$ref` references by slug. Portable only where the target is itself a
	 *   seeded, slugged row; a reference to something a user made locally resolves to
	 *   nothing on the far side.
	 * - `flattened` inlines the values. Always portable, and it forks the config — the
	 *   importing instance can no longer swap the named thing in one place.
	 */
	bindings?: 'base' | 'flattened'
	/** Resolve a `$ref` when flattening. Absent values are dropped and reported. */
	resolve?: (slot: string, ref: string) => unknown
}

export interface ExportResult {
	doc: SpecDocument
	/** What did not travel, and why — so an export is never quietly lossy. */
	omitted: Array<{ what: string; reason: string }>
	/**
	 * Every connection the importing instance must wire, derived from the types rather
	 * than from what this instance happened to have configured (13 §10a). Complete even
	 * when the exporter never set one up.
	 */
	requires: ConnectionRequirement[]
}

/**
 * Export a document, with the presets a user selected (12 §7).
 *
 * **A filtered export is a different document, not a lossy copy of the same one**, so its
 * canonical hash legitimately differs from the source's. F3's identity law is about a
 * given export round-tripping — `import(export(x)) === export(x)` — and that still holds
 * exactly.
 */
export function exportDocument(doc: SpecDocument, opts: ExportOptions = {}): ExportResult {
	const omitted: ExportResult['omitted'] = []
	const want = opts.presets ?? 'all'
	const keep = (p: SpecDocument['presets'][number]) =>
		want === 'all' ? true : want === 'none' ? false : want.includes(p.slug)

	const presets: SpecDocument['presets'] = []
	for (const p of doc.presets ?? []) {
		if (!keep(p)) {
			omitted.push({ what: `preset '${p.slug}'`, reason: 'not selected for export' })
			continue
		}
		const values: typeof p.values = []
		for (const v of p.values) {
			// Connection details never leave, whatever else was chosen (12 §7).
			if (v.slot === 'connection') {
				omitted.push({
					what: `${p.slug} → ${v.nodeKey}.connection`,
					reason: 'connection details never leave an instance',
				})
				continue
			}
			if (opts.bindings === 'flattened' && isRef(v.value)) {
				const resolved = opts.resolve?.(v.slot, (v.value as any).$ref)
				if (resolved === undefined) {
					omitted.push({
						what: `${p.slug} → ${v.nodeKey}.${v.slot}`,
						reason: `could not resolve '${(v.value as any).$ref}' to flatten`,
					})
					continue
				}
				values.push({ ...v, value: resolved })
				continue
			}
			values.push(v)
		}
		presets.push({ ...p, values })
	}

	// A preset with a default that did not travel would import as a spec with no default.
	if (presets.length && !presets.some((p) => p.default)) {
		const lost = (doc.presets ?? []).find((p) => p.default)
		if (lost) omitted.push({ what: `default preset '${lost.slug}'`, reason: 'not selected; the import has no shipped default' })
	}

	return { doc: { ...doc, presets }, omitted, requires: requiredConnections(doc) }
}

const isRef = (v: unknown): v is { $ref: string } =>
	!!v && typeof v === 'object' && typeof (v as any).$ref === 'string'
