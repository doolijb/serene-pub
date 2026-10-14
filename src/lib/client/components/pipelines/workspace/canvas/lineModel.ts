/**
 * The canvas's model: a spec document read as the line it runs along
 * (PLAN-pipeline-canvas-and-genre-authoring-2026-10-12 §3).
 *
 * Pure, and only ever fed a `SpecDocument` — never the `pipelines:detail`
 * topology, which has no node config and no edge ports. Everything the three
 * canvas surfaces draw comes from here: the minimap and the line read `rows`,
 * the drawer reads `portsOf`, the overlays read `diffOf` and `receiptIndex`.
 *
 * A row is a node, or a clause with its branches, each branch a list of rows
 * again — so a junction inside an each inside a gather is three containers
 * deep and nothing special. Order is `position`, the document's own counter.
 */
import type {
	BuiltClause,
	DocEdge,
	DocNode,
	JunctionPredicate,
	SpecDocument
} from "@serene-pub/sdk"

export type LineRow =
	| { kind: "node"; key: string; node: DocNode }
	| { kind: "clause"; key: string; clause: BuiltClause; branches: LineBranch[] }

export interface LineBranch {
	name: string
	rows: LineRow[]
	/** A junction branch's declared predicate; absent on gather/each/loop chains. */
	predicate?: JunctionPredicate
}

export interface LineModel {
	rows: LineRow[]
	nodeCount: number
	clauseCount: number
	/** Every node by key. */
	nodes: Map<string, DocNode>
	/** Every clause by id. */
	clauses: Map<string, BuiltClause>
	/** How many containers deep a key sits; 0 on the spine. */
	depthOf: Map<string, number>
	/** The clause ids that contain a key, outermost first. */
	pathOf: Map<string, string[]>
}

type Parent = { clauseId: string | null; chain: string | null }

const parentOf = (x: {
	clauseId?: string | null
	clauseChain?: string | null
}): Parent => ({
	clauseId: x.clauseId ?? null,
	chain: x.clauseChain ?? null
})

const sameParent = (a: Parent, b: Parent) =>
	a.clauseId === b.clauseId && a.chain === b.chain

/** The line a document runs along. */
export function lineOf(doc: SpecDocument): LineModel {
	const nodes = new Map<string, DocNode>()
	const clauses = new Map<string, BuiltClause>()
	const depthOf = new Map<string, number>()
	const pathOf = new Map<string, string[]>()
	for (const n of doc.nodes) nodes.set(n.key, n)
	for (const c of doc.clauses) clauses.set(c.id, c)

	type Item =
		| { kind: "node"; position: number; node: DocNode }
		| { kind: "clause"; position: number; clause: BuiltClause }

	const itemsIn = (parent: Parent): Item[] => {
		const out: Item[] = []
		for (const n of doc.nodes)
			if (sameParent(parentOf(n), parent))
				out.push({ kind: "node", position: n.position, node: n })
		for (const c of doc.clauses)
			if (sameParent(parentOf(c), parent))
				out.push({ kind: "clause", position: c.position, clause: c })
		// Position first; a tie (a clause and its first member share one
		// counter value in some documents) keeps the clause ahead of nodes,
		// then falls back to key order so the result is deterministic.
		out.sort(
			(a, b) =>
				a.position - b.position ||
				(a.kind === b.kind ? 0 : a.kind === "clause" ? -1 : 1) ||
				keyOf(a).localeCompare(keyOf(b))
		)
		return out
	}
	const keyOf = (i: Item) => (i.kind === "node" ? i.node.key : i.clause.id)

	const rowsIn = (parent: Parent, depth: number, path: string[]): LineRow[] =>
		itemsIn(parent).map((i): LineRow => {
			if (i.kind === "node") {
				depthOf.set(i.node.key, depth)
				pathOf.set(i.node.key, path)
				return { kind: "node", key: i.node.key, node: i.node }
			}
			const c = i.clause
			depthOf.set(c.id, depth)
			pathOf.set(c.id, path)
			const branches: LineBranch[] = c.chains.map((name) => ({
				name,
				predicate: c.branches?.[name],
				rows: rowsIn({ clauseId: c.id, chain: name }, depth + 1, [
					...path,
					c.id
				])
			}))
			return { kind: "clause", key: c.id, clause: c, branches }
		})

	const rows = rowsIn({ clauseId: null, chain: null }, 0, [])
	return {
		rows,
		nodeCount: doc.nodes.length,
		clauseCount: doc.clauses.length,
		nodes,
		clauses,
		depthOf,
		pathOf
	}
}

/** Every row in run order, flattened, clauses included. */
export function flatRows(rows: LineRow[]): LineRow[] {
	const out: LineRow[] = []
	const walk = (list: LineRow[]) => {
		for (const r of list) {
			out.push(r)
			if (r.kind === "clause") for (const b of r.branches) walk(b.rows)
		}
	}
	walk(rows)
	return out
}

/* ── ports ───────────────────────────────────────────────────────────── */

export interface InPort {
	/** The config path the value lands on (`scope`, `params`, `items.0.text`). */
	port: string
	/** Where it comes from: `node.port`, or `slot · name` / `slot · name of node`. */
	from: string
	source: "edge" | "slot" | "literal"
	/** An implicit spine edge (`main` → `main`), drawn quieter. */
	implicit?: boolean
	/** The shape id the edge carries, when the document recorded one. */
	shape?: string
	/** A literal's value, for the drawer to preview. */
	literal?: unknown
}

export interface OutPort {
	port: string
	/** `node.port` for each consumer, in document order. */
	to: string[]
	shape?: string
}

export interface Ports {
	in: InPort[]
	out: OutPort[]
}

const isRef = (v: unknown): v is { __ref: string } =>
	!!v && typeof v === "object" && "__ref" in (v as object)

/** Walk a config object; call `onRef` for every `{__ref}` and `onLiteral` for every leaf. */
function walkConfig(
	value: unknown,
	path: string,
	onRef: (path: string, ref: Record<string, unknown>) => void,
	onLiteral: (path: string, v: unknown) => void
) {
	if (isRef(value)) {
		onRef(path, value as Record<string, unknown>)
		return
	}
	if (Array.isArray(value)) {
		value.forEach((v, i) =>
			walkConfig(v, path ? `${path}.${i}` : String(i), onRef, onLiteral)
		)
		return
	}
	if (value && typeof value === "object") {
		for (const [k, v] of Object.entries(value as Record<string, unknown>))
			walkConfig(v, path ? `${path}.${k}` : k, onRef, onLiteral)
		return
	}
	onLiteral(path, value)
}

/** What a node or clause receives, and what it sends on. */
export function portsOf(doc: SpecDocument, key: string): Ports {
	const inPorts: InPort[] = []
	const out = new Map<string, OutPort>()
	const node = doc.nodes.find((n) => n.key === key)
	const clause = doc.clauses.find((c) => c.id === key)

	for (const e of doc.edges) {
		if (e.to === key)
			inPorts.push({
				port: e.toPort,
				from: `${e.from}.${e.fromPort}`,
				source: "edge",
				implicit: e.implicit || undefined,
				shape: e.shape
			})
		if (e.from === key) {
			const o = out.get(e.fromPort) ?? {
				port: e.fromPort,
				to: [],
				shape: e.shape
			}
			o.to.push(`${e.to}.${e.toPort}`)
			out.set(e.fromPort, o)
		}
	}

	const seenEdgePorts = new Set(inPorts.map((p) => p.port))
	const config: unknown = node
		? node.config
		: clause
			? { over: clause.over, on: clause.on, repeatWhile: clause.repeatWhile }
			: {}
	walkConfig(
		config,
		"",
		(path, ref) => {
			if (ref.__ref === "slot") {
				const of = ref.ofNode
					? ` of ${String(ref.ofNode)}`
					: ref.ofEnvoy
						? ` of envoy ${String(ref.ofEnvoy)}`
						: ref.resolveDownstreamOracle
							? " of the next oracle"
							: ""
				inPorts.push({
					port: path,
					from: `slot · ${String(ref.slot)}${of}`,
					source: "slot"
				})
			} else if (ref.__ref === "data" && !seenEdgePorts.has(path)) {
				// A data ref the compiler did not turn into an edge (a clause's
				// own `over`/`on`/`repeatWhile` never becomes one).
				inPorts.push({
					port: path,
					from: `${String(ref.node)}.${String(ref.port)}`,
					source: "edge"
				})
			}
		},
		(path, v) => {
			if (v === undefined) return
			inPorts.push({ port: path, from: "literal", source: "literal", literal: v })
		}
	)

	// Edges first, then slots, then literals; each group in config order.
	const rank = { edge: 0, slot: 1, literal: 2 }
	inPorts.sort((a, b) => rank[a.source] - rank[b.source])
	return { in: inPorts, out: [...out.values()] }
}

/* ── diff ────────────────────────────────────────────────────────────── */

export type DiffMark = "added" | "removed" | "changed"

export interface DocDiff {
	/** By node key or clause id. */
	marks: Map<string, DiffMark>
	added: string[]
	removed: string[]
	changed: string[]
}

const stable = (v: unknown): string =>
	JSON.stringify(v, (_k, val) =>
		val && typeof val === "object" && !Array.isArray(val)
			? Object.fromEntries(
					Object.keys(val as object)
						.sort()
						.map((k) => [k, (val as Record<string, unknown>)[k]])
				)
			: val
	)

const nodeFingerprint = (n: DocNode) =>
	stable({
		kind: n.kind,
		definitionId: n.definitionId,
		definitionVersion: n.definitionVersion,
		config: n.config,
		clauseId: n.clauseId ?? null,
		clauseChain: n.clauseChain ?? null,
		// What the node says its keys mean (2026-10-13) is a change to the
		// node. Only when stated, so every other node fingerprints as before.
		...(n.renders ? { renders: n.renders } : {})
	})

const clauseFingerprint = (c: BuiltClause) =>
	stable({
		kind: c.kind,
		mode: c.mode,
		over: c.over,
		max: c.max,
		repeatWhile: c.repeatWhile,
		on: c.on,
		branches: c.branches,
		chains: c.chains,
		clauseId: c.clauseId ?? null,
		clauseChain: c.clauseChain ?? null
	})

/** `next` against `base`: what a reader of `next` should see marked. */
export function diffOf(base: SpecDocument, next: SpecDocument): DocDiff {
	const marks = new Map<string, DiffMark>()
	const added: string[] = []
	const removed: string[] = []
	const changed: string[] = []
	const baseNodes = new Map(base.nodes.map((n) => [n.key, n]))
	const nextNodes = new Map(next.nodes.map((n) => [n.key, n]))
	for (const [k, n] of nextNodes) {
		const b = baseNodes.get(k)
		if (!b) {
			marks.set(k, "added")
			added.push(k)
		} else if (nodeFingerprint(b) !== nodeFingerprint(n)) {
			marks.set(k, "changed")
			changed.push(k)
		}
	}
	for (const k of baseNodes.keys())
		if (!nextNodes.has(k)) {
			marks.set(k, "removed")
			removed.push(k)
		}
	const baseClauses = new Map(base.clauses.map((c) => [c.id, c]))
	const nextClauses = new Map(next.clauses.map((c) => [c.id, c]))
	for (const [k, c] of nextClauses) {
		const b = baseClauses.get(k)
		if (!b) {
			marks.set(k, "added")
			added.push(k)
		} else if (clauseFingerprint(b) !== clauseFingerprint(c)) {
			marks.set(k, "changed")
			changed.push(k)
		}
	}
	for (const k of baseClauses.keys())
		if (!nextClauses.has(k)) {
			marks.set(k, "removed")
			removed.push(k)
		}
	return { marks, added, removed, changed }
}

/* ── receipt ─────────────────────────────────────────────────────────── */

export type RunStatus = "ok" | "halt" | "err" | "skip" | "dry"

export interface NodeRun {
	nodeKey: string
	/** The worst result across iterations: err > halt > skip > ok. */
	status: RunStatus
	/** `true` when any iteration's write was dry. */
	dry: boolean
	iterations: number
	elapsedMs: number
	tokens: number
	rows: Array<{
		seq: number
		iteration: number | null
		result: string
		reason: string | null
		elapsedMs: number
		tokens: number
		dry: boolean
	}>
}

const WORSE: Record<RunStatus, number> = { ok: 0, dry: 0, skip: 1, halt: 2, err: 3 }

const asStatus = (result: string): RunStatus => {
	if (result === "ok") return "ok"
	if (result === "halt" || result === "cancelled") return "halt"
	if (result === "skip" || result === "skipped") return "skip"
	return "err"
}

/** A receipt's nodes, folded by key: an `each` body is one entry with its iterations. */
export function receiptIndex(receipt: unknown): Map<string, NodeRun> {
	const index = new Map<string, NodeRun>()
	const raw = receipt as { nodes?: unknown } | null
	const nodes = Array.isArray(raw?.nodes) ? (raw!.nodes as any[]) : []
	for (const n of nodes) {
		const nodeKey = String(n?.nodeKey ?? "")
		if (!nodeKey) continue
		const result = String(n?.result ?? "")
		const status = asStatus(result)
		const tokens =
			Number(n?.tokens ?? 0) ||
			Number(n?.tokensIn ?? 0) + Number(n?.tokensOut ?? 0) ||
			0
		const row = {
			seq: Number(n?.seq ?? 0),
			iteration: typeof n?.iteration === "number" ? n.iteration : null,
			result,
			reason: n?.reason ? String(n.reason) : null,
			elapsedMs: Number(n?.elapsedMs ?? 0),
			tokens,
			dry: !!n?.dry
		}
		const have = index.get(nodeKey)
		if (!have) {
			index.set(nodeKey, {
				nodeKey,
				status: row.dry && status === "ok" ? "dry" : status,
				dry: row.dry,
				iterations: 1,
				elapsedMs: row.elapsedMs,
				tokens,
				rows: [row]
			})
			continue
		}
		have.iterations += 1
		have.elapsedMs += row.elapsedMs
		have.tokens += tokens
		have.dry = have.dry || row.dry
		if (WORSE[status] > WORSE[have.status]) have.status = status
		have.rows.push(row)
	}
	for (const v of index.values()) v.rows.sort((a, b) => a.seq - b.seq)
	return index
}

/** A clause's own status: the worst of its members', or nothing when none ran. */
export function clauseStatus(
	model: LineModel,
	index: Map<string, NodeRun>,
	clauseId: string
): RunStatus | null {
	let worst: RunStatus | null = null
	for (const [key, path] of model.pathOf)
		if (path.includes(clauseId) && model.nodes.has(key)) {
			const s = index.get(key)?.status
			if (!s) continue
			if (worst === null || WORSE[s] > WORSE[worst]) worst = s
		}
	return worst
}
