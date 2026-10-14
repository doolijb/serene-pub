/**
 * The canvas editor's edits: pure operations over a spec document
 * (PLAN-pipeline-canvas-and-genre-authoring-2026-10-12 §4.3).
 *
 * Every function takes a `SpecDocument` and returns a new one; the input is
 * never mutated. None of them touch `edges` or `resolvedRefs` — the server
 * recompiles both from the configs on `pipelines:draft:put` — but every one
 * keeps the configs consistent: a renamed key is renamed in every ref that
 * named it, a removed key's refs are severed and reported. After any
 * structural change `position` is renumbered 0..n-1 in run order (the order
 * `lineOf` + `flatRows` read: spine by position, a clause before its members,
 * members by chain order then position).
 */
import type {
	BuiltClause,
	DataRef,
	DocNode,
	JunctionPredicate,
	SlotRef,
	SpecDocument
} from "@serene-pub/sdk"
import { flatRows, lineOf } from "./lineModel"

/** A branch of a clause: where a member sits. `null` = the spine. */
export interface Container {
	clauseId: string
	chain: string
}

/** A ref that lost its source: the node or clause holding it, and where. */
export interface Severed {
	key: string
	/** The config path (`items.0.text`), or `over` / `on` / `repeatWhile` on a clause. */
	path: string
}

export type ClauseKind = BuiltClause["kind"]

/* ── helpers ─────────────────────────────────────────────────────────── */

type Item = DocNode | BuiltClause

/** Documents are plain JSON (some built ones hold frozen or proxied objects structuredClone refuses). */
const json = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const clone = (doc: SpecDocument): SpecDocument => json(doc)

const keyOfItem = (i: Item): string => ("key" in i ? i.key : i.id)

const containerOfItem = (i: Item): Container | null =>
	i.clauseId ? { clauseId: i.clauseId, chain: i.clauseChain ?? "" } : null

const sameContainer = (a: Container | null, b: Container | null) =>
	(a?.clauseId ?? null) === (b?.clauseId ?? null) &&
	(a?.chain ?? null) === (b?.chain ?? null)

const isRef = (v: unknown): v is { __ref: string } =>
	!!v && typeof v === "object" && !Array.isArray(v) && "__ref" in (v as object)

const isDataRef = (v: unknown): v is DataRef =>
	isRef(v) && v.__ref === "data"

const isSlotRef = (v: unknown): v is SlotRef =>
	isRef(v) && v.__ref === "slot"

function takenKeys(doc: SpecDocument): Set<string> {
	const s = new Set<string>()
	for (const n of doc.nodes) s.add(n.key)
	for (const c of doc.clauses) s.add(c.id)
	return s
}

function findItem(doc: SpecDocument, key: string): Item | undefined {
	return doc.nodes.find((n) => n.key === key) ?? doc.clauses.find((c) => c.id === key)
}

function assertFreeKey(doc: SpecDocument, key: string) {
	if (!key) throw new Error("A step key cannot be empty.")
	if (key.includes(":")) throw new Error(`The key "${key}" cannot contain ':'.`)
	if (takenKeys(doc).has(key)) throw new Error(`The key "${key}" is already in use.`)
}

/** Items directly in a container, in run order. */
function siblingsIn(doc: SpecDocument, container: Container | null): Item[] {
	const items: Item[] = [
		...doc.clauses.filter((c) => sameContainer(containerOfItem(c), container)),
		...doc.nodes.filter((n) => sameContainer(containerOfItem(n), container))
	]
	// Same tie-break as lineOf: position, clause before node, then key.
	return items.sort(
		(a, b) =>
			a.position - b.position ||
			("id" in a === "id" in b ? 0 : "id" in a ? -1 : 1) ||
			keyOfItem(a).localeCompare(keyOfItem(b))
	)
}

/**
 * Renumber `position` 0..n-1 across nodes and clauses in run order. Mutates
 * the (already cloned) document it is given and returns it.
 */
export function renumber(doc: SpecDocument): SpecDocument {
	const order = flatRows(lineOf(doc).rows)
	const pos = new Map(order.map((r, i) => [r.key, i]))
	let next = order.length
	for (const n of doc.nodes) n.position = pos.get(n.key) ?? next++
	for (const c of doc.clauses) c.position = pos.get(c.id) ?? next++
	// Array order follows run order too: the SDK's compile draws the implicit
	// spine edges (`main` → `main`) between consecutive spine nodes by ARRAY
	// order, so a node appended at the end would read the last spine node
	// rather than the one before it (seen live 2026-10-12).
	doc.nodes.sort((a, b) => a.position - b.position)
	doc.clauses.sort((a, b) => a.position - b.position)
	return doc
}

/** Every clause id contained, at any depth, by `clauseId` (itself excluded). */
function descendantClauses(doc: SpecDocument, roots: Set<string>): Set<string> {
	const out = new Set<string>()
	let grew = true
	while (grew) {
		grew = false
		for (const c of doc.clauses)
			if (c.clauseId && (roots.has(c.clauseId) || out.has(c.clauseId)) && !out.has(c.id)) {
				out.add(c.id)
				grew = true
			}
	}
	return out
}

/**
 * Map every ref in a value. `fn` returns the replacement ref, `null` to drop
 * it, or the ref itself to keep it. A dropped object property is deleted; a
 * dropped array element is spliced out (a list of sources shrinks).
 */
function mapRefs(
	value: unknown,
	path: string,
	fn: (ref: Record<string, unknown>, path: string) => Record<string, unknown> | null
): { value: unknown; drop: boolean } {
	if (isRef(value)) {
		const r = fn(value as Record<string, unknown>, path)
		return r === null ? { value: undefined, drop: true } : { value: r, drop: false }
	}
	if (Array.isArray(value)) {
		const out: unknown[] = []
		value.forEach((v, i) => {
			const m = mapRefs(v, path ? `${path}.${i}` : String(i), fn)
			if (!m.drop) out.push(m.value)
		})
		return { value: out, drop: false }
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			const m = mapRefs(v, path ? `${path}.${k}` : k, fn)
			if (!m.drop) out[k] = m.value
		}
		return { value: out, drop: false }
	}
	return { value, drop: false }
}

const CLAUSE_REF_FIELDS = ["over", "on", "repeatWhile"] as const

/** Apply `fn` to every ref in every node config and clause ref field. Mutates `doc`. */
function mapAllRefs(
	doc: SpecDocument,
	fn: (
		ref: Record<string, unknown>,
		owner: string,
		path: string
	) => Record<string, unknown> | null
) {
	for (const n of doc.nodes)
		n.config = mapRefs(n.config, "", (r, p) => fn(r, n.key, p)).value as Record<
			string,
			unknown
		>
	for (const c of doc.clauses)
		for (const f of CLAUSE_REF_FIELDS) {
			if (c[f] === undefined) continue
			const m = mapRefs(c[f], f, (r, p) => fn(r, c.id, p))
			if (m.drop) delete c[f]
			else c[f] = m.value
		}
}

/** Drop the given keys' nodes and clauses, and sever every ref to them. Mutates `doc`. */
function dropKeys(doc: SpecDocument, gone: Set<string>): Severed[] {
	doc.nodes = doc.nodes.filter((n) => !gone.has(n.key))
	doc.clauses = doc.clauses.filter((c) => !gone.has(c.id))
	const severed: Severed[] = []
	mapAllRefs(doc, (ref, owner, path) => {
		if (ref.__ref === "data" && gone.has(String(ref.node))) {
			severed.push({ key: owner, path })
			return null
		}
		if (ref.__ref === "slot" && typeof ref.ofNode === "string" && gone.has(ref.ofNode)) {
			severed.push({ key: owner, path })
			const { ofNode: _gone, ...rest } = ref
			return rest
		}
		return ref
	})
	for (const p of doc.presets ?? [])
		p.values = p.values.filter((v) => !gone.has(v.nodeKey))
	return severed
}

/** Rename keys per `map` everywhere they appear. Mutates `doc`. */
function rewriteKeys(doc: SpecDocument, map: Map<string, string>) {
	if (map.size === 0) return
	const taken = takenKeys(doc)
	for (const to of map.values()) {
		if (to.includes(":")) throw new Error(`The key "${to}" cannot contain ':'.`)
		if (taken.has(to) && !map.has(to))
			throw new Error(`The key "${to}" is already in use.`)
	}
	const re = (k: string | undefined) => (k !== undefined ? (map.get(k) ?? k) : k)
	for (const n of doc.nodes) {
		n.key = re(n.key)!
		if (n.clauseId) n.clauseId = re(n.clauseId)
	}
	for (const c of doc.clauses) {
		c.id = re(c.id)!
		if (c.clauseId) c.clauseId = re(c.clauseId)
	}
	mapAllRefs(doc, (ref) => {
		if (ref.__ref === "data" && map.has(String(ref.node)))
			return { ...ref, node: map.get(String(ref.node)) }
		if (ref.__ref === "slot" && typeof ref.ofNode === "string" && map.has(ref.ofNode))
			return { ...ref, ofNode: map.get(ref.ofNode) }
		return ref
	})
	for (const p of doc.presets ?? [])
		for (const v of p.values) v.nodeKey = re(v.nodeKey)!
}

/** Every key with the prefix moved to the new prefix. */
function prefixMap(doc: SpecDocument, fromPrefix: string, toPrefix: string) {
	const map = new Map<string, string>()
	for (const k of takenKeys(doc))
		if (k.startsWith(fromPrefix)) map.set(k, toPrefix + k.slice(fromPrefix.length))
	return map
}

/** Resolve where a new item goes and the position that lands it there. */
function placement(
	doc: SpecDocument,
	after: string | null,
	container: Container | null | undefined
): { container: Container | null; position: number } {
	let where: Container | null
	if (after !== null) {
		const a = findItem(doc, after)
		if (!a) throw new Error(`No step or clause "${after}".`)
		where = containerOfItem(a)
		if (container !== undefined && !sameContainer(container, where))
			throw new Error(`"${after}" is not in the container named.`)
	} else where = container ?? null
	if (where) {
		const c = doc.clauses.find((x) => x.id === where!.clauseId)
		if (!c) throw new Error(`No clause "${where.clauseId}".`)
		if (!c.chains.includes(where.chain))
			throw new Error(`The clause "${c.id}" has no branch "${where.chain}".`)
	}
	const sibs = siblingsIn(doc, where)
	// The document is renumbered first, so sibling positions are unique integers.
	if (after !== null) return { container: where, position: findItem(doc, after)!.position + 0.5 }
	return { container: where, position: sibs.length ? sibs[0].position - 0.5 : -0.5 }
}

/** Set (or, with `undefined`, delete) the value at a dotted path. Mutates `root`. */
function setAtPath(root: Record<string, unknown>, path: string, value: unknown) {
	const segs = path.split(".").filter((s) => s !== "")
	if (segs.length === 0) throw new Error("A config path cannot be empty.")
	let at: any = root
	for (let i = 0; i < segs.length - 1; i++) {
		const s = segs[i]
		const key = Array.isArray(at) ? Number(s) : s
		let next = at[key]
		if (next === undefined || next === null || typeof next !== "object" || isRef(next)) {
			if (value === undefined) return
			next = /^\d+$/.test(segs[i + 1]) ? [] : {}
			at[key] = next
		}
		at = next
	}
	const last = segs[segs.length - 1]
	if (Array.isArray(at)) {
		const idx = Number(last)
		if (value === undefined) {
			if (idx < at.length) at.splice(idx, 1)
		} else at[idx] = value
	} else if (value === undefined) delete at[last]
	else at[last] = value
}

/** Write a value into a node's config, or a clause's over/on/repeatWhile. */
function writeAt(doc: SpecDocument, key: string, path: string, value: unknown): SpecDocument {
	const out = clone(doc)
	const node = out.nodes.find((n) => n.key === key)
	if (node) {
		node.config = node.config ?? {}
		setAtPath(node.config, path, value)
		return renumber(out)
	}
	const clause = out.clauses.find((c) => c.id === key)
	if (!clause) throw new Error(`No step or clause "${key}".`)
	const [field] = path.split(".")
	if (!(CLAUSE_REF_FIELDS as readonly string[]).includes(field))
		throw new Error(`A clause takes only over, on or repeatWhile, not "${field}".`)
	setAtPath(clause as unknown as Record<string, unknown>, path, value)
	return renumber(out)
}

/* ── nodes ───────────────────────────────────────────────────────────── */

export interface InsertNodeSpec {
	/** The sibling it goes after; `null` = first in the container. */
	after: string | null
	/** Defaults to `after`'s container, or the spine. */
	container?: Container | null
	key: string
	definitionId: string
	definitionVersion: number
	kind: string
	config?: Record<string, unknown>
}

export function insertNode(doc: SpecDocument, spec: InsertNodeSpec): SpecDocument {
	const out = renumber(clone(doc))
	assertFreeKey(out, spec.key)
	const { container, position } = placement(out, spec.after, spec.container)
	const node: DocNode = {
		key: spec.key,
		kind: spec.kind,
		definitionId: spec.definitionId,
		definitionVersion: spec.definitionVersion,
		config: json(spec.config ?? {}),
		position
	}
	if (container) {
		const c = out.clauses.find((x) => x.id === container.clauseId)!
		node.clauseId = container.clauseId
		node.clauseKind = c.kind
		node.clauseChain = container.chain
	}
	out.nodes.push(node)
	return renumber(out)
}

export function removeNode(
	doc: SpecDocument,
	key: string
): { doc: SpecDocument; severed: Severed[] } {
	if (!doc.nodes.some((n) => n.key === key)) throw new Error(`No step "${key}".`)
	const out = clone(doc)
	const severed = dropKeys(out, new Set([key]))
	return { doc: renumber(out), severed }
}

/** Swap a node or clause with its neighbour in the same container; a no-op at the ends. */
export function moveNode(doc: SpecDocument, key: string, dir: "up" | "down"): SpecDocument {
	const out = renumber(clone(doc))
	const item = findItem(out, key)
	if (!item) throw new Error(`No step or clause "${key}".`)
	const sibs = siblingsIn(out, containerOfItem(item))
	const i = sibs.indexOf(item)
	const j = dir === "up" ? i - 1 : i + 1
	if (j < 0 || j >= sibs.length) return out
	const other = sibs[j]
	const p = item.position
	item.position = other.position
	other.position = p
	return renumber(out)
}

/**
 * Rename a node or a clause. A clause's members and nested clauses move with
 * it (`${from}.` → `${to}.`), and every ref, clause id and preset address that
 * named any of them follows.
 */
export function renameKey(doc: SpecDocument, from: string, to: string): SpecDocument {
	if (from === to) return clone(doc)
	const item = findItem(doc, from)
	if (!item) throw new Error(`No step or clause "${from}".`)
	assertFreeKey(doc, to)
	const out = clone(doc)
	const map = new Map<string, string>([[from, to]])
	if ("id" in item) for (const [k, v] of prefixMap(out, `${from}.`, `${to}.`)) map.set(k, v)
	rewriteKeys(out, map)
	return renumber(out)
}

/** Merge into the inlet lock; a field passed as `undefined` is cleared. */
export function setInput(
	doc: SpecDocument,
	patch: { genre?: string; event?: string; events?: string[] }
): SpecDocument {
	const out = clone(doc)
	const input: Record<string, unknown> = { ...(out.input ?? {}) }
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) delete input[k]
		else input[k] = json(v)
	}
	out.input = input as SpecDocument["input"]
	return renumber(out)
}

/* ── clauses ─────────────────────────────────────────────────────────── */

export interface AddClauseSpec {
	after: string | null
	container?: Container | null
	id: string
	kind: ClauseKind
	mode?: "sequential" | "parallel"
	/** Required for `each` and `loop`. */
	max?: number
	/** Ignored for `each`/`loop`, which always have one chain, `item`. */
	chains: string[]
	/** Junction only; each chain without one gets `{}`. */
	branches?: Record<string, JunctionPredicate>
}

export function addClause(doc: SpecDocument, spec: AddClauseSpec): SpecDocument {
	const out = renumber(clone(doc))
	assertFreeKey(out, spec.id)
	const repeats = spec.kind === "each" || spec.kind === "loop"
	if (repeats && !(typeof spec.max === "number" && spec.max > 0))
		throw new Error(`An ${spec.kind} needs a max.`)
	const chains = repeats ? ["item"] : [...spec.chains]
	if (chains.length === 0) throw new Error("A clause needs at least one branch.")
	if (new Set(chains).size !== chains.length) throw new Error("Branch names must differ.")
	const { container, position } = placement(out, spec.after, spec.container)
	const clause: BuiltClause = {
		id: spec.id,
		kind: spec.kind,
		mode: spec.mode ?? (spec.kind === "loop" ? "sequential" : "parallel"),
		chains,
		position
	}
	if (repeats) clause.max = spec.max
	if (spec.kind === "junction")
		clause.branches = Object.fromEntries(
			chains.map((c) => [c, json(spec.branches?.[c] ?? {})])
		)
	if (container) {
		clause.clauseId = container.clauseId
		clause.clauseChain = container.chain
	}
	out.clauses.push(clause)
	return renumber(out)
}

export function removeClause(
	doc: SpecDocument,
	id: string
): { doc: SpecDocument; severed: Severed[] } {
	if (!doc.clauses.some((c) => c.id === id)) throw new Error(`No clause "${id}".`)
	const out = clone(doc)
	const clauses = new Set([id, ...descendantClauses(out, new Set([id]))])
	const gone = new Set<string>(clauses)
	for (const n of out.nodes) if (n.clauseId && clauses.has(n.clauseId)) gone.add(n.key)
	const severed = dropKeys(out, gone)
	return { doc: renumber(out), severed }
}

export function addBranch(
	doc: SpecDocument,
	clauseId: string,
	name: string,
	predicate?: JunctionPredicate
): SpecDocument {
	const out = clone(doc)
	const c = out.clauses.find((x) => x.id === clauseId)
	if (!c) throw new Error(`No clause "${clauseId}".`)
	if (c.kind === "each" || c.kind === "loop")
		throw new Error(`An ${c.kind} has one branch only.`)
	if (!name || name.includes(".") || name.includes(":"))
		throw new Error(`"${name}" is not a branch name.`)
	if (c.chains.includes(name)) throw new Error(`The branch "${name}" already exists.`)
	c.chains = [...c.chains, name]
	if (c.kind === "junction")
		c.branches = { ...(c.branches ?? {}), [name]: json(predicate ?? {}) }
	return renumber(out)
}

export function renameBranch(
	doc: SpecDocument,
	clauseId: string,
	from: string,
	to: string
): SpecDocument {
	const out = clone(doc)
	const c = out.clauses.find((x) => x.id === clauseId)
	if (!c) throw new Error(`No clause "${clauseId}".`)
	if (!c.chains.includes(from)) throw new Error(`The clause "${clauseId}" has no branch "${from}".`)
	if (from === to) return out
	if (!to || to.includes(".") || to.includes(":"))
		throw new Error(`"${to}" is not a branch name.`)
	if (c.chains.includes(to)) throw new Error(`The branch "${to}" already exists.`)
	c.chains = c.chains.map((x) => (x === from ? to : x))
	if (c.branches)
		c.branches = Object.fromEntries(
			Object.entries(c.branches).map(([k, v]) => [k === from ? to : k, v])
		)
	for (const n of out.nodes)
		if (n.clauseId === clauseId && n.clauseChain === from) n.clauseChain = to
	for (const x of out.clauses)
		if (x.clauseId === clauseId && x.clauseChain === from) x.clauseChain = to
	rewriteKeys(out, prefixMap(out, `${clauseId}.${from}.`, `${clauseId}.${to}.`))
	return renumber(out)
}

export function removeBranch(
	doc: SpecDocument,
	clauseId: string,
	name: string
): { doc: SpecDocument; severed: Severed[] } {
	const out = clone(doc)
	const c = out.clauses.find((x) => x.id === clauseId)
	if (!c) throw new Error(`No clause "${clauseId}".`)
	if (!c.chains.includes(name)) throw new Error(`The clause "${clauseId}" has no branch "${name}".`)
	if (c.chains.length === 1) throw new Error("A clause keeps at least one branch.")
	c.chains = c.chains.filter((x) => x !== name)
	if (c.branches) {
		const { [name]: _gone, ...rest } = c.branches
		c.branches = rest
	}
	const direct = new Set(
		out.clauses.filter((x) => x.clauseId === clauseId && x.clauseChain === name).map((x) => x.id)
	)
	const clauses = new Set([...direct, ...descendantClauses(out, direct)])
	const gone = new Set<string>(clauses)
	for (const n of out.nodes)
		if (
			(n.clauseId === clauseId && n.clauseChain === name) ||
			(n.clauseId && clauses.has(n.clauseId))
		)
			gone.add(n.key)
	const severed = dropKeys(out, gone)
	return { doc: renumber(out), severed }
}

/* ── config ──────────────────────────────────────────────────────────── */

/** Wire a config path to a node's output port, or unwire it with `null`. */
export function wire(
	doc: SpecDocument,
	key: string,
	path: string,
	source: { node: string; port: string } | null
): SpecDocument {
	const ref: DataRef | undefined = source
		? { __ref: "data", node: source.node, port: source.port }
		: undefined
	return writeAt(doc, key, path, ref)
}

/** Set a literal at a config path; `undefined` deletes it. */
export function setLiteral(
	doc: SpecDocument,
	key: string,
	path: string,
	value: unknown
): SpecDocument {
	if (isRef(value)) throw new Error("A literal cannot be a ref; use wire or setSlotRef.")
	return writeAt(doc, key, path, value === undefined ? undefined : json(value))
}

/** Point a config path at a slot, or clear it with `null`. */
export function setSlotRef(
	doc: SpecDocument,
	key: string,
	path: string,
	slotRef: Omit<SlotRef, "__ref"> | SlotRef | null
): SpecDocument {
	return writeAt(
		doc,
		key,
		path,
		slotRef ? { ...json(slotRef), __ref: "slot" } : undefined
	)
}

/* ── reading ─────────────────────────────────────────────────────────── */

/**
 * The node and clause keys that run before `key` and are visible from where
 * it sits — the wire picker's candidates, in run order. Visible: everything
 * earlier on the spine (with the members of earlier clauses), the enclosing
 * clauses themselves (an each's `item`), and in each enclosing branch the
 * earlier siblings with their members. A sibling branch is never visible:
 * chains in a gather run concurrently.
 */
export function upstreamOf(doc: SpecDocument, key: string): string[] {
	const target = findItem(doc, key)
	if (!target) throw new Error(`No step or clause "${key}".`)
	const model = lineOf(doc)
	const visible = new Set<string>()
	// Walk outward: at each level, earlier siblings and everything inside them.
	let at: Item = target
	for (;;) {
		const where = containerOfItem(at)
		for (const s of siblingsIn(doc, where)) {
			if (s === at) break
			visible.add(keyOfItem(s))
			if ("id" in s)
				for (const [k, path] of model.pathOf) if (path.includes(s.id)) visible.add(k)
		}
		if (!where) break
		visible.add(where.clauseId)
		const parent = doc.clauses.find((c) => c.id === where.clauseId)
		if (!parent) break
		at = parent
	}
	return flatRows(model.rows)
		.map((r) => r.key)
		.filter((k) => visible.has(k))
}

/** `base`, or `base2`, `base3`… — the first key not in use. */
export function nextKey(doc: SpecDocument, base: string): string {
	const taken = takenKeys(doc)
	if (!taken.has(base)) return base
	for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`
}

/* ── composite steps (P3) ────────────────────────────────────────────── */

/**
 * A composite step: a run of sibling steps lifted out of a document with
 * everything inside them, keys made relative to where they sat. The
 * document's own word for the stored thing is a fragment (the SDK's
 * `fragment()` + `.include`); a person saves and inserts a **composite step**.
 */
export interface CompositeDoc {
	nodes: DocNode[]
	clauses: BuiltClause[]
	/** Refs that reach outside the composite: what an insertion will have to re-wire. */
	reads: Array<{ key: string; path: string; node: string; port?: string }>
}

const stripPrefix = (k: string, prefix: string) => (prefix && k.startsWith(prefix) ? k.slice(prefix.length) : k)

/**
 * Lift the siblings from `from` to `to` (inclusive, in run order, same
 * container) with every member of any clause among them. Keys lose the
 * container's own prefix; refs between members stay, refs to the outside are
 * kept as they are and listed in `reads`.
 */
export function extractComposite(doc: SpecDocument, range: { from: string; to: string }): CompositeDoc {
	const src = renumber(clone(doc))
	const a = findItem(src, range.from)
	const b = findItem(src, range.to)
	if (!a || !b) throw new Error(`No step or clause "${!a ? range.from : range.to}".`)
	const container = containerOfItem(a)
	if (!sameContainer(container, containerOfItem(b)))
		throw new Error(`"${range.from}" and "${range.to}" are not in the same container.`)
	const sibs = siblingsIn(src, container)
	const i = sibs.indexOf(a)
	const j = sibs.indexOf(b)
	const [lo, hi] = i <= j ? [i, j] : [j, i]
	const heads = sibs.slice(lo, hi + 1)
	const headKeys = new Set(heads.map((it) => ("id" in it ? it.id : it.key)))
	const clauseRoots = new Set([...headKeys].filter((k) => src.clauses.some((c) => c.id === k)))
	const inner = descendantClauses(src, clauseRoots)
	const clauseIds = new Set([...clauseRoots, ...inner])
	const taken = new Set<string>()
	const nodes = src.nodes.filter((n) => headKeys.has(n.key) || (n.clauseId && clauseIds.has(n.clauseId)))
	const clauses = src.clauses.filter((c) => clauseIds.has(c.id))
	for (const n of nodes) taken.add(n.key)
	for (const c of clauses) taken.add(c.id)
	const prefix = container ? `${container.clauseId}.${container.chain}.` : ""
	const reads: CompositeDoc["reads"] = []
	const sub: SpecDocument = { ...src, nodes: json(nodes), clauses: json(clauses), edges: [], presets: [], includes: [] }
	for (const n of sub.nodes) {
		const m = mapRefs(n.config, "", (ref, path) => {
			const target =
				ref.__ref === "data" ? (ref.node as string) : ref.__ref === "slot" ? (ref.ofNode as string | undefined) : undefined
			if (target && !taken.has(target))
				reads.push({ key: n.key, path, node: target, port: ref.__ref === "data" ? (ref.port as string) : undefined })
			return ref
		})
		n.config = (m.value ?? {}) as Record<string, unknown>
		if (headKeys.has(n.key)) {
			delete n.clauseId
			delete n.clauseChain
			delete (n as { clauseKind?: string }).clauseKind
		}
	}
	for (const c of sub.clauses) {
		for (const field of ["over", "on", "repeatWhile"] as const) {
			const ref = (c as unknown as Record<string, unknown>)[field]
			if (isRef(ref) && (ref as unknown as { __ref: string }).__ref === "data") {
				const data = ref as unknown as { node: string; port: string }
				if (!taken.has(data.node)) reads.push({ key: c.id, path: field, node: data.node, port: data.port })
			}
		}
		if (headKeys.has(c.id)) {
			delete c.clauseId
			delete c.clauseChain
		}
	}
	// Keys relative to the container: strip its prefix everywhere inside.
	if (prefix) {
		const map = new Map<string, string>()
		for (const k of taken) if (k.startsWith(prefix)) map.set(k, k.slice(prefix.length))
		rewriteKeys(sub, map)
		for (const r of reads) r.key = stripPrefix(r.key, prefix)
	}
	return { nodes: sub.nodes, clauses: sub.clauses, reads }
}

export interface InsertCompositeSpec {
	after: string | null
	container?: Container | null
	/** The key the composite lands under: every member becomes `${key}.${member}`. */
	key: string
	composite: CompositeDoc
	/** Recorded in `includes[]` for provenance; the library row's id. */
	fragmentId?: string
}

/** Inline a composite under `key`: members prefixed, their refs to each other rewritten, outside refs kept. */
export function insertComposite(doc: SpecDocument, spec: InsertCompositeSpec): SpecDocument {
	const out = renumber(clone(doc))
	const { container, position } = placement(out, spec.after, spec.container)
	const base = (container ? `${container.clauseId}.${container.chain}.` : "") + spec.key
	assertFreeKey(out, base)
	const sub: SpecDocument = { ...out, nodes: json(spec.composite.nodes), clauses: json(spec.composite.clauses), edges: [], presets: [], includes: [] }
	const map = new Map<string, string>()
	for (const n of sub.nodes) map.set(n.key, `${base}.${n.key}`)
	for (const c of sub.clauses) map.set(c.id, `${base}.${c.id}`)
	for (const k of map.values()) assertFreeKey(out, k)
	rewriteKeys(sub, map)
	const heads = [...sub.nodes.filter((n) => !n.clauseId), ...sub.clauses.filter((c) => !c.clauseId)].sort((x, y) => x.position - y.position)
	let step = 0
	// `position` already sits half a step past the anchor; keep every head inside that half.
	const eps = 0.5 / (heads.length + 2)
	const headPos = new Map<string, number>()
	for (const h of heads) headPos.set("id" in h ? h.id : h.key, position + eps * ++step)
	for (const n of sub.nodes) {
		if (!n.clauseId) {
			n.position = headPos.get(n.key)!
			if (container) {
				const c = out.clauses.find((x) => x.id === container.clauseId)!
				n.clauseId = container.clauseId
				n.clauseKind = c.kind
				n.clauseChain = container.chain
			}
		} else n.position = (headPos.get(topOf(n.clauseId, sub)) ?? position) + eps * 0.5
		out.nodes.push(n)
	}
	for (const c of sub.clauses) {
		if (!c.clauseId) {
			c.position = headPos.get(c.id)!
			if (container) {
				c.clauseId = container.clauseId
				c.clauseChain = container.chain
			}
		} else c.position = (headPos.get(topOf(c.clauseId, sub)) ?? position) + eps * 0.25
		out.clauses.push(c)
	}
	out.includes = [...(out.includes ?? []), { key: base, fragmentId: spec.fragmentId ?? base }]
	return renumber(out)
}

/** The outermost clause id a nested member sits under, within the composite. */
function topOf(clauseId: string, sub: SpecDocument): string {
	let id = clauseId
	for (;;) {
		const c = sub.clauses.find((x) => x.id === id)
		if (!c || !c.clauseId) return id
		id = c.clauseId
	}
}
