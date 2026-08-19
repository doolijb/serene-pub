/**
 * A minimal executor — enough to run a compiled document and produce a receipt.
 *
 * Not the real thing, but it enforces the laws the design says the executor owns:
 * discriminated results including halt, per-run seed, timeouts that bound execution
 * but never waiting, consumption budgets, per-kind injection, and core-emitted events.
 */

import type { SpecDocument, DocNode } from "./document.js"
import { getType, type Kind } from "./descriptors.js"
import { collectDataRefs, isSlotRef, type SlotRef } from "./refs.js"
import type { Receipt, NodeReceipt, Outcome } from "./receipt.js"
import {
	resolveConfig,
	type ConfigWorld,
	type ResolvedConfig
} from "./config.js"
import {
	hashPayload,
	isGated,
	resolvePosition,
	type Reviewer,
	type ReviewRecord
} from "./review.js"
import { isSecret } from "./settings.js"
import {
	previewTarget,
	roughTokens,
	type PreviewReport,
	type PreviewBlock
} from "./preview.js"
import { ITEM as ITEM_KEY } from "./scope.js"
import {
	isAllocatedContext,
	measureWire,
	type AllocatedContext,
	type WireMeasure
} from "./wire.js"

// ── Results ─────────────────────────────────────────────────────────────────

export type Result<T = unknown> =
	| { kind: "ok"; value: T }
	| { kind: "err"; reason: string }
	| { kind: "cancelled"; reason?: string }
	| { kind: "halt"; reason: string }

export const ok = <T>(value: T): Result<T> => ({ kind: "ok", value })
export const err = (reason: string): Result<never> => ({ kind: "err", reason })
export const halt = (reason: string): Result<never> => ({
	kind: "halt",
	reason
})
export const cancelled = (reason: string): Result<never> => ({
	kind: "cancelled",
	reason
})

// ── The union shape for async blocks and maps (13 §1) ───────────────────────

/**
 * One entry per branch, in **declaration order** — never completion order, which is
 * the same rule 11 §3 already applies to event dispatch, so the system has one
 * ordering rule rather than two.
 */
export interface BranchResult {
	branchKey: string
	index: number
	result: Result
}

/** What a block publishes. `main` aliases `branches` so `$ref(blockId)` works bare. */
export interface BranchResults {
	branches: BranchResult[]
	main: BranchResult[]
	/** The `ok` values in order — what a downstream fold actually wants. */
	values: unknown[]
	ok: boolean
}

/**
 * Values are scoped, not global.
 *
 * A single shared map cannot hold two iterations of a map at once, which is why the
 * earlier draft forced every map sequential. A scope chain fixes that and is also what
 * makes nested blocks correct: an iteration writes into its own scope and reads through
 * to its parent, so two iterations never see each other's intermediate values.
 */
class ValueScope {
	private own = new Map<string, unknown>()
	constructor(private parent?: ValueScope) {}
	get(k: string): any {
		return this.own.has(k) ? this.own.get(k) : this.parent?.get(k)
	}
	has(k: string): boolean {
		return this.own.has(k) || !!this.parent?.has(k)
	}
	set(k: string, v: unknown) {
		this.own.set(k, v)
	}
	child() {
		return new ValueScope(this)
	}
}

// ── The discriminated write result (13 §7j-b) ───────────────────────────────

export type WriteResult =
	| { status: "committed"; ids: Record<string, unknown> }
	| { status: "pending"; proposalId: string }

export const isCommitted = (
	w: WriteResult
): w is Extract<WriteResult, { status: "committed" }> =>
	w.status === "committed"

// ── Injection surfaces, per kind (F11) ──────────────────────────────────────

export interface TaskCtx {
	/** Only present when the descriptor declares randomness — keeps Tasks pure (F11). */
	random?: () => number
	signal: AbortSignal
	progress(message: string): void
	log(level: "info" | "warn", message: string): void
}
export interface QueryCtx extends TaskCtx {
	read(table: string, q?: unknown): unknown
	/** Deliberately absent: fetch. A Query may not reach the network (16 §1). */
}
export interface ProviderCtx extends TaskCtx {
	/** Material is injected here per call and never readable from config. */
	call(payload: unknown): Promise<unknown>
	connectionMetadata: Record<string, unknown>
	sampling: Record<string, unknown>
	reportUsage(tokens: number): void
	reportSampling(applied: Record<string, unknown>, ignored: string[]): void
}
export interface ConsumerCtx extends TaskCtx {
	commit(payload: unknown): Promise<Record<string, unknown>>
	emit(handle: string, payload: unknown): void
}

export type Hook = (input: any, ctx: any) => Result | Promise<Result>

export interface Bindings {
	[typeIdAtVersion: string]: Hook
}

// ── Deterministic RNG from the run seed (F11) ───────────────────────────────

export function seededRandom(seed: string): () => number {
	let h = 2166136261
	for (let i = 0; i < seed.length; i++)
		h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
	return () => {
		h = Math.imul(h ^ (h >>> 15), 2246822507)
		h = Math.imul(h ^ (h >>> 13), 3266489909)
		return ((h ^= h >>> 16) >>> 0) / 4294967296
	}
}

// ── Run options ─────────────────────────────────────────────────────────────

export interface RunOptions {
	input: unknown
	bindings: Bindings
	world?: ConfigWorld
	seed?: string
	runId?: string
	triggerSource?: Receipt["triggerSource"]
	triggerRef?: string
	actorUserId?: string
	/** Instance ceiling — config may not exceed it (F36). */
	timeoutCeilingMs?: number
	/** Force every block sequential, as an admin may (01 §4). */
	forceSequential?: boolean
	budget?: { tokens?: number; nodeExecutions?: number }
	/** Which subscribers core would dispatch to, for the emitted record. */
	subscribers?: Record<string, number>
	/** Simulated wait — never counted against a timeout (01 §5). */
	now?: () => number
	/** Host-supplied review resolver. `sync` parks on it; waiting is free (F13). */
	reviewer?: Reviewer
	/**
	 * Time this run sat in the admin-visible queue before being dequeued (13 §3).
	 * Recorded, and deliberately **not** added to any elapsed figure: queue wait
	 * consumes no budget (F13) and trips no timeout (F36) — a run's clock starts
	 * when it is dequeued.
	 */
	queuedMs?: number
	/**
	 * Checked between nodes. Returning a value stops the run as `cancelled`, with the
	 * actor recorded — so "an admin stopped it" stays distinguishable from "it broke",
	 * which is why there are four result kinds rather than three (13 §3).
	 */
	cancelSignal?: () => { by: string; reason: string } | undefined
	/**
	 * Compact a receipt that halts before any effectful node: trigger, spec version,
	 * halt node/reason and elapsed, with no payloads and no node rows (13 §2).
	 *
	 * Defaults to on **for event-triggered runs only**. That is where the multiplier
	 * lives — a hot event × every subscribed pipeline × every message, where most
	 * subscribers halt immediately and that is success (01 §5). A run someone started
	 * by clicking happens once per click and keeps its full detail.
	 */
	compactHaltReceipts?: boolean
	/**
	 * Debug mode in chat: run normally, then **halt at the pre-call substrate** instead of
	 * invoking the Provider — after the input resolves and the payload is formed, so the
	 * numbers shown are the numbers that would have been sent (src/preview.ts).
	 *
	 * `true` stops at the first Provider **on the spine**; pass `atNode` to override. The
	 * preview costs whatever ran before it, including the embedding call inside the gather
	 * block — a preview that skipped retrieval would show a context nobody would get.
	 */
	preview?: boolean | { atNode?: string }
	/** From connection metadata in core; injectable so the count is the real one. */
	countTokens?: (v: unknown) => number
	/**
	 * The host's I/O, injected into the per-kind contexts (see `HostServices`).
	 *
	 * Absent, every service is the in-memory stand-in this draft has always used —
	 * which is what keeps the SDK's own suite hermetic. Present, a Query's `read`
	 * reaches a real database and a Consumer's `commit` writes a real row.
	 */
	host?: HostServices
}

/**
 * What only the host can do.
 *
 * The executor owns *sequencing*; it has never owned *I/O*, and the split is why the
 * same executor can run in an author's test with no database and in core against a
 * live one. Until this existed, core's only way to reach a database from a binding was
 * to close over a connection — which works, and quietly moves the effect outside the
 * substrate that the review gate, the budget and the receipt all sit in.
 *
 * So the shape here is deliberate: **a binding describes the effect and the host
 * performs it.** A Consumer returns what it wants written, and `commit` writes it. That
 * is already how a sidecar Consumer has to work (F19 — no DB channel across a process
 * boundary), and having in-process and out-of-process Consumers obey the same rule
 * means the review gate sees the same thing in both cases: a payload, before anything
 * happened.
 */
export interface HostServices {
	/** Scoped read for a Query. The node is passed so the host can enforce scope (F30). */
	read?(
		table: string,
		query: unknown,
		node: NodeRef
	): unknown | Promise<unknown>
	/** Perform a Consumer's described write and return the row identity. */
	commit?(payload: unknown, node: NodeRef): Promise<Record<string, unknown>>
	/** Dispatch a Provider call. Credentials are injected here and never readable (F18). */
	call?(payload: unknown, node: NodeRef): Promise<unknown>
	/** Core emits; a node only names the handle (F8). */
	emit?(handle: string, payload: unknown, node: NodeRef): void
	/**
	 * Connection **metadata** for a Provider — readable. Material is never returned
	 * here; it is applied inside `call` and never crosses into a binding (F18).
	 */
	connection?(node: NodeRef): {
		metadata?: Record<string, unknown>
		sampling?: Record<string, unknown>
	}
}

export interface NodeRef {
	key: string
	typeId: string
	typeVersion: number
	kind: string
}

const EMPTY_WORLD: ConfigWorld = {
	overrides: [],
	samplingConfigs: [],
	connections: [],
	activeConnection: {}
}

class BudgetExceeded extends Error {}

export async function run(
	doc: SpecDocument,
	opts: RunOptions
): Promise<Receipt> {
	const world = opts.world ?? EMPTY_WORLD
	const seed = opts.seed ?? "seed:0"
	const rng = seededRandom(seed)
	const now = opts.now ?? (() => Date.now())
	const config: ResolvedConfig = resolveConfig(
		world,
		doc.nodes.map((n) => n.key)
	)

	const receipt: Receipt = {
		runId: opts.runId ?? "run:test",
		specId: doc.id,
		specVersion: doc.version,
		schemaVersion: 1,
		seed,
		triggerSource: opts.triggerSource ?? "input",
		triggerRef: opts.triggerRef,
		actorUserId: opts.actorUserId,
		depth: 0,
		queuedMs: opts.queuedMs,
		startedAt: now(),
		endedAt: 0,
		outcome: "ok",
		nodes: [],
		emitted: [],
		consumption: { tokens: 0, nodeExecutions: 0 }
	}

	/** Set the moment any node with declared effects is invoked — gates compaction. */
	let effectfulNodeRan = false

	const previewAt = opts.preview
		? previewTarget(
				doc.nodes,
				typeof opts.preview === "object"
					? opts.preview.atNode
					: undefined
			)
		: undefined
	const countTokens = opts.countTokens ?? roughTokens

	/**
	 * Hoist what the panel needs into one place. Almost all of it is already recorded —
	 * Assemble's allocation record and the Provider's resolved input. The only figure
	 * that exists nowhere else is the count of the formed payload.
	 */
	const buildPreview = (
		node: DocNode,
		input: Record<string, unknown>,
		typeId: string,
		targetedBy: PreviewReport["targetedBy"],
		wire?: WireMeasure,
		wireCtx?: AllocatedContext
	): PreviewReport => {
		const ctxValue = (input as any).context ?? (input as any).main ?? input
		const conn = (input as any).connection
		const budgetNode = doc.nodes.find(
			(n) => n.typeId === "core:task/context-budget"
		)
		const budgetValue = budgetNode ? values.get(budgetNode.key) : undefined

		// Prefer the allocated blocks, which carry the trail. Fall back to sniffing an
		// allocation array only for specs core has not migrated yet.
		const allocatedSource =
			wireCtx ??
			(Object.values(input).find(isAllocatedContext) as
				| AllocatedContext
				| undefined)
		const legacyAlloc =
			(ctxValue as any)?.alloc ?? (ctxValue as any)?.allocation
		const allocation = allocatedSource?.allocation ?? legacyAlloc

		const blocks: PreviewBlock[] = allocatedSource
			? allocatedSource.blocks.map((b) => ({
					id: b.id,
					sourceKey: b.sourceKey,
					role: b.role,
					weight: b.weight,
					priority: b.priority,
					included: b.included,
					tokens: b.tokens,
					why: b.why,
					reason: b.why?.[b.why.length - 1]
				}))
			: (Array.isArray(legacyAlloc) ? legacyAlloc : []).map((a: any) => ({
					sourceKey: a.sourceKey,
					weight: a.weight,
					priority: a.priority,
					included: (a.included ?? 0) > 0,
					tokens: countTokens(a.rendered ?? a.text ?? ""),
					reason:
						a.reason ??
						(a.available !== undefined &&
						a.included !== undefined &&
						a.available > a.included
							? `${a.available - a.included} of ${a.available} dropped — budget`
							: undefined)
				}))

		const tokens = wire?.tokens ?? countTokens(ctxValue)
		const available =
			(budgetValue as any)?.available ??
			(ctxValue as any)?.budget ??
			allocatedSource?.allocation.budget
		return {
			atNode: node.key,
			typeId,
			targetedBy,
			connection: conn
				? {
						id: conn.id,
						kind: conn.kind,
						contextLength: conn.metadata?.contextLength,
						tokenizer: conn.metadata?.tokenizer
					}
				: undefined,
			budget: {
				maxContext:
					(budgetValue as any)?.maxContext ??
					conn?.metadata?.contextLength,
				reserved: (budgetValue as any)?.reserved,
				available
			},
			context: {
				rendered: redact(wire ? wire.payload : ctxValue),
				tokens
			},
			wire: wire
				? {
						format: wire.format,
						blockTokens: wire.blockTokens,
						overheadTokens: wire.overheadTokens
					}
				: undefined,
			blocks,
			totals: {
				blocks: blocks.length,
				included: blocks.filter((b) => b.included).length,
				dropped: blocks.filter((b) => !b.included).length,
				tokensIncluded: blocks
					.filter((b) => b.included)
					.reduce((n, b) => n + b.tokens, 0),
				tokensDropped: blocks
					.filter((b) => !b.included)
					.reduce((n, b) => n + b.tokens, 0),
				overBudgetBy:
					wire?.overBudgetBy ??
					(typeof available === "number" && tokens > available
						? tokens - available
						: undefined)
			},
			allocation
		}
	}

	const values = new ValueScope()
	values.set(doc.nodes[0]?.key ?? "input", opts.input)
	const reviews: ReviewRecord[] = []

	let seq = 0
	const budget = {
		tokens: opts.budget?.tokens ?? Infinity,
		nodes: opts.budget?.nodeExecutions ?? Infinity
	}

	const spendTokens = (n: number) => {
		receipt.consumption.tokens += n
		if (receipt.consumption.tokens > budget.tokens)
			throw new BudgetExceeded("token budget exceeded")
	}

	// Blocks are executed as units when their first member is reached.
	const emittedBlocks = new Set<string>()
	const ordered = doc.nodes.slice().sort((a, b) => a.position - b.position)

	const resolveInput = (node: DocNode, scope: ValueScope) => {
		const cfg: Record<string, unknown> = { ...node.config }
		for (const { path, ref } of collectDataRefs(node.config)) {
			setPath(cfg, path, readPort(scope.get(ref.node), ref.port))
		}
		for (const [k, v] of Object.entries(cfg)) {
			if (isSlotRef(v)) cfg[k] = resolveSlot(node, v as SlotRef)
		}
		return cfg
	}

	const resolveSlot = (node: DocNode, ref: SlotRef) => {
		const targetKey =
			node.resolvedRefs?.[
				Object.keys(node.config).find((k) => node.config[k] === ref) ??
					""
			] ??
			ref.ofNode ??
			node.key
		const slotName = ref.slot
		if (slotName === "connection") {
			const d = getType(`${node.typeId}@${node.typeVersion}`)
			const targetNode =
				doc.nodes.find((n) => n.key === targetKey) ?? node
			const td = getType(`${targetNode.typeId}@${targetNode.typeVersion}`)
			const kind = td?.shape ?? d?.shape
			const chosenId =
				(config[targetKey]?.["connection"]?.["$ref"] as
					| string
					| undefined) ??
				(kind ? world.activeConnection[kind] : undefined)
			const conn = world.connections.find((c) => c.id === chosenId)
			// metadata only — material is injected by the executor at call time (01 §10)
			return conn
				? { id: conn.id, kind: conn.kind, metadata: conn.metadata }
				: null
		}
		if (slotName === "sampling") {
			const refId = config[targetKey]?.["sampling"]?.["$ref"] as
				| string
				| undefined
			const base = world.samplingConfigs.find((s) => s.id === refId)
			const overrides = { ...(config[node.key]?.["sampling"] ?? {}) }
			delete (overrides as any)["$ref"]
			return { ...(base?.values ?? {}), ...overrides }
		}
		if (slotName === "params") {
			// A declared default is a promise the type makes; without this it was
			// decoration. Nothing applied `default:` from a parameters schema, so
			// a spec that did not override `budget` got `undefined` — which reads
			// downstream as a budget of zero, excludes every block, and renders a
			// context with its lore silently missing.
			const d = getType(`${node.typeId}@${node.typeVersion}`)
			const schema = (d?.slots as any)?.[slotName]?.schema as
				| Record<string, { default?: unknown }>
				| undefined
			const defaults: Record<string, unknown> = {}
			for (const [k, v] of Object.entries(schema ?? {}))
				if (v?.default !== undefined) defaults[k] = v.default
			return { ...defaults, ...(config[node.key]?.[slotName] ?? {}) }
		}
		return config[node.key]?.[slotName] ?? {}
	}

	const invoke = async (
		node: DocNode,
		scope: ValueScope,
		blockMode?: "sequential" | "parallel",
		iteration?: number
	): Promise<Result> => {
		const d = getType(`${node.typeId}@${node.typeVersion}`)
		if (!d) return err(`unknown type ${node.typeId}@${node.typeVersion}`)
		const hook = opts.bindings[`${node.typeId}@${node.typeVersion}`]
		const started = now()
		const nr: NodeReceipt = {
			nodeKey: node.key,
			seq: seq++,
			kind: node.kind,
			typeId: `${node.typeId}@${node.typeVersion}`,
			result: "ok",
			startedAt: started,
			endedAt: started,
			elapsedMs: 0,
			blockMode,
			iteration,
			resolvedRefs: node.resolvedRefs,
			notes: []
		}

		receipt.consumption.nodeExecutions++
		if (receipt.consumption.nodeExecutions > budget.nodes)
			throw new BudgetExceeded("node execution budget exceeded")

		if (node.kind === "input") {
			scope.set(node.key, opts.input)
			nr.output = opts.input
			nr.endedAt = now()
			receipt.nodes.push(nr)
			return ok(opts.input)
		}
		if (!hook)
			return err(
				`no binding registered for ${node.typeId}@${node.typeVersion}`
			)

		let input = resolveInput(node, scope)

		// ── The review gate (01 §7) ───────────────────────────────────────────
		// Substrate placement: after the input resolves, before the binding is invoked.
		// Keys on declared effects, not on kind, so an effectful Provider gates too.
		if (isGated(d.effects)) {
			const position = resolvePosition(
				d.reviewDefault,
				config[node.key]?.["settings"]?.["review"]
			)
			if (position !== "off") {
				const originalHash = hashPayload(input)
				if (!opts.reviewer) {
					nr.endedAt = now()
					nr.result = "err"
					nr.reason = `review is '${position}' but no reviewer is available`
					receipt.nodes.push(nr)
					return err(nr.reason)
				}
				const decision = await opts.reviewer({
					nodeKey: node.key,
					typeId: nr.typeId,
					payload: input,
					position
				})
				const rec: ReviewRecord = {
					nodeKey: node.key,
					position,
					action: position === "async" ? "proposed" : decision.action,
					originalHash,
					by: decision.by,
					at: decision.at
				}
				if (decision.action === "reject") {
					reviews.push(rec)
					nr.endedAt = now()
					nr.result = "halt"
					nr.reason = "rejected at review"
					receipt.nodes.push(nr)
					return halt("rejected at review")
				}
				if (decision.action === "edit") {
					// The binding receives the edited payload and cannot tell (F14).
					input = decision.payload as Record<string, unknown>
					rec.editedHash = hashPayload(input)
				}
				reviews.push(rec)
				// `async` proposes and does not block: the write lands pending.
				// Published as the discriminated form (13 §7j-b) — a proposal id must not
				// be mistakable for a committed row id, because a reviewer may still
				// reject it and the foreign key would dangle only later.
				if (position === "async") {
					const pending: WriteResult = {
						status: "pending",
						proposalId: `proposal:${node.key}`
					}
					const published = publishWriteResult(pending, d.ports.out)
					scope.set(node.key, published)
					nr.endedAt = now()
					nr.elapsedMs = nr.endedAt - nr.startedAt
					nr.result = "ok"
					nr.output = pending
					nr.notes!.push(
						"review: async — proposed, binding not invoked"
					)
					receipt.nodes.push(nr)
					return ok(published)
				}
			} else {
				reviews.push({
					nodeKey: node.key,
					position,
					action: "approve",
					originalHash: hashPayload(input)
				})
			}
		}

		// ── Wire formatting, at the pre-call substrate (16 §7) ────────────────
		// Allocation happened upstream in Assemble; this is where blocks become the
		// payload the connection actually wants. Once, here — never inside the
		// allocation loop, and never a second time for the preview.
		let wire: WireMeasure | undefined
		// Kept because formatting replaces the port value — the panel still needs the blocks.
		let wireCtx: AllocatedContext | undefined
		if (d.slots) {
			const wireSlot = Object.entries(d.slots).find(
				([, sd]) => sd.kind === "wire"
			)
			if (wireSlot) {
				const [slotName, decl] = wireSlot
				const chosen =
					(config[node.key]?.["wire"] as unknown as
						| string
						| undefined) ??
					((input as any)[slotName] as string | undefined) ??
					decl.format
				const port = Object.entries(input).find(([, v]) =>
					isAllocatedContext(v)
				)
				if (chosen && port) {
					const portName = port[0]
					const ctx = port[1] as AllocatedContext
					wireCtx = ctx
					const available =
						(input as any).budget?.available ??
						ctx.allocation.budget
					try {
						wire = measureWire(
							chosen,
							ctx,
							(t) => countTokens(t),
							available
						)
						input = { ...input, [portName]: wire.payload }
						nr.notes!.push(
							`wire ${wire.format}: ${wire.blockTokens} block + ${wire.overheadTokens} scaffold = ${wire.tokens} tokens` +
								(wire.overBudgetBy
									? `  ⚠ OVER by ${wire.overBudgetBy}`
									: "")
						)
					} catch (e) {
						nr.endedAt = now()
						nr.result = "err"
						nr.reason = (e as Error).message
						receipt.nodes.push(nr)
						return err(nr.reason)
					}
					// An over-budget payload is `err`, not a silent trim and not a retry:
					// a retry would re-invoke Assemble, which is a back-edge the graph
					// cannot show (F9, F25). It means declared overhead is wrong, and
					// that should be loud (16 §7).
					if (wire.overBudgetBy) {
						nr.endedAt = now()
						nr.result = "err"
						nr.reason =
							`formatted payload is ${wire.tokens} tokens against ${available} available — ` +
							`over by ${wire.overBudgetBy}. The estimate came from wire format '${wire.format}'`
						receipt.nodes.push(nr)
						return err(nr.reason)
					}
				}
			}
		}

		// ── The preview halt (debug mode) ─────────────────────────────────────
		// Same substrate point as the review gate, and deliberately *before* it: there
		// is nothing to review when nothing will be sent. The payload is formed and
		// counted here, so the panel shows the real figure rather than a parallel
		// estimate that drifts from what actually goes out.
		if (previewAt && node.key === previewAt.key) {
			receipt.preview = buildPreview(
				node,
				input,
				nr.typeId,
				previewAt.targetedBy,
				wire,
				wireCtx
			)
			nr.input = redact(input)
			nr.endedAt = now()
			nr.elapsedMs = nr.endedAt - nr.startedAt
			nr.result = "halt"
			nr.reason = `preview: stopped before ${node.key}, nothing sent`
			receipt.nodes.push(nr)
			return halt(nr.reason)
		}

		nr.input = redact(input)

		// Gates receipt compaction (13 §2): once anything effectful has been invoked,
		// the run is worth recording in full whatever happens next.
		if (d.effects && d.effects !== "none") effectfulNodeRan = true

		const timeoutMs = Math.min(
			d.timeoutMs ?? Infinity,
			opts.timeoutCeilingMs ?? Infinity
		)
		nr.timeoutMsApplied = Number.isFinite(timeoutMs) ? timeoutMs : undefined

		const controller = new AbortController()
		const base: TaskCtx = {
			signal: controller.signal,
			progress: () => {}, // ephemeral, never recorded (F34)
			log: (lvl, m) => nr.notes!.push(`${lvl}: ${m}`)
		}
		if (d.declaresRandomness) base.random = rng

		const nodeRef: NodeRef = {
			key: node.key,
			typeId: node.typeId,
			typeVersion: node.typeVersion,
			kind: node.kind
		}
		const host = opts.host

		let ctx: any = base
		if (node.kind === "query")
			ctx = {
				...base,
				read: (table: string, q?: unknown) =>
					host?.read ? host.read(table, q, nodeRef) : []
			} satisfies QueryCtx
		if (node.kind === "provider") {
			const conn = host?.connection?.(nodeRef)
			ctx = {
				...base,
				connectionMetadata:
					conn?.metadata ?? (input as any).connection?.metadata ?? {},
				sampling: conn?.sampling ?? (input as any).sampling ?? {},
				call: async (p: unknown) => {
					// Recorded before dispatch, so a Provider that throws still leaves the
					// request in the receipt — the failing call is the one worth reading.
					nr.request = p
					return host?.call ? await host.call(p, nodeRef) : p
				},
				reportUsage: (t: number) => {
					nr.tokens = (nr.tokens ?? 0) + t
					spendTokens(t)
				},
				reportSampling: (applied, ignored) => {
					nr.samplingApplied = applied
					nr.samplingIgnored = ignored
				}
			} satisfies ProviderCtx
		}
		if (node.kind === "consumer") {
			ctx = {
				...base,
				commit: async (p: unknown) =>
					host?.commit
						? await host.commit(p, nodeRef)
						: { id: `row:${node.key}`, ...(p as object) },
				emit: (handle: string, payload?: unknown) => {
					nr.notes!.push(`emit → ${handle}`)
					host?.emit?.(handle, payload, nodeRef)
				}
			} satisfies ConsumerCtx
		}

		let res: Result
		try {
			res = await withTimeout(
				Promise.resolve(hook(input, ctx)),
				timeoutMs,
				controller,
				now
			)
		} catch (e) {
			if (e instanceof BudgetExceeded) throw e
			if ((e as Error).message === "__timeout__") {
				nr.timedOut = true
				res = err(`timeout after ${timeoutMs}ms`)
			} else {
				res = err((e as Error).message)
			}
		}

		nr.endedAt = now()
		nr.elapsedMs = nr.endedAt - nr.startedAt
		nr.result = res.kind
		if (res.kind === "ok") {
			// A gate-eligible Consumer publishes the discriminated write result, so the
			// committed and pending cases are the same shape and a downstream type has
			// to handle both (13 §7j-b). There is no branch node to check `status` with
			// (F25), so the obligation belongs to the port shape, not to the spec.
			let published = res.value
			if (
				node.kind === "consumer" &&
				isGated(d.effects) &&
				!isWriteResult(published)
			) {
				const committed: WriteResult = {
					status: "committed",
					ids: (published ?? {}) as Record<string, unknown>
				}
				published = publishWriteResult(committed, d.ports.out)
			}
			scope.set(node.key, published)
			res = ok(published)
			nr.output = redact(published)
		} else if (
			res.kind === "halt" ||
			res.kind === "err" ||
			res.kind === "cancelled"
		) {
			nr.reason = (res as any).reason
		}

		// Core emits, not the node (01 §8 / F8).
		if (
			res.kind === "ok" &&
			node.kind === "consumer" &&
			d.effects === "write" &&
			d.causesEvent
		) {
			receipt.emitted.push({
				event: d.causesEvent,
				cause: node.key,
				subscribers: opts.subscribers?.[d.causesEvent] ?? 0
			})
		}

		receipt.nodes.push(nr)
		return res
	}

	/** Admin kill (13 §3) — `cancelled`, not `err`, with the actor recorded. */
	const checkCancel = (): boolean => {
		const c = opts.cancelSignal?.()
		if (!c) return false
		receipt.outcome = "cancelled"
		receipt.cancelledBy = c.by
		receipt.haltReason = c.reason
		return true
	}

	// ── Level execution ──────────────────────────────────────────────────────
	// A "level" is the spine, or one chain of one block. Nodes and nested blocks are
	// interleaved by declaration position, so the structure the author wrote is the
	// structure that runs — blocks nest exactly as nodes do.

	type Level = { blockId?: string; chain?: string }

	const itemsAt = (level: Level) => {
		const nodes = ordered
			.filter(
				(n) =>
					n.blockId === level.blockId && n.blockChain === level.chain
			)
			.map((node) => ({
				sort: node.position,
				run: node,
				isBlock: false as const
			}))
		const blocks = doc.blocks
			.filter(
				(b) =>
					b.blockId === level.blockId && b.blockChain === level.chain
			)
			.map((block) => ({
				sort: block.position,
				run: block,
				isBlock: true as const
			}))
		return [...nodes, ...blocks].sort((a, b) => a.sort - b.sort)
	}

	const runLevel = async (
		level: Level,
		scope: ValueScope,
		blockMode?: "sequential" | "parallel",
		iteration?: number
	): Promise<Result> => {
		let last: Result = ok(null)
		for (const item of itemsAt(level)) {
			if (checkCancel()) return cancelled("cancelled")
			last = item.isBlock
				? await runBlock(
						item.run as SpecDocument["blocks"][number],
						scope
					)
				: await invoke(item.run as DocNode, scope, blockMode, iteration)
			if (last.kind !== "ok") return last
		}
		return last
	}

	const truthy = (v: unknown) => !!v && !(Array.isArray(v) && v.length === 0)

	const runBlock = async (
		block: SpecDocument["blocks"][number],
		scope: ValueScope
	): Promise<Result> => {
		const mode = opts.forceSequential ? "sequential" : block.mode
		const collected: BranchResult[] = []

		const publish = () => {
			const union: BranchResults = {
				branches: collected,
				get main() {
					return this.branches
				},
				get values() {
					return this.branches
						.filter((b) => b.result.kind === "ok")
						.map(
							(b) =>
								(b.result as Extract<Result, { kind: "ok" }>)
									.value
						)
				},
				ok: collected.every((b) => b.result.kind === "ok")
			}
			scope.set(block.id, union)
		}

		if (block.kind === "async") {
			// Chains share the scope: a sibling is addressable by its qualified key, and
			// keys are unique, so there is nothing to collide.
			const run = (chain: string) =>
				runLevel({ blockId: block.id, chain }, scope, mode)
			const results =
				mode === "parallel"
					? await Promise.all(block.chains.map(run))
					: await sequential(block.chains, run)
			block.chains.forEach((chain, i) =>
				collected.push({
					branchKey: chain,
					index: i,
					result: results[i]!
				})
			)
			publish()
			return (
				collected.find((b) => b.result.kind !== "ok")?.result ??
				ok(null)
			)
		}

		if (block.kind === "map") {
			const items = resolveMapItems(block.over, scope)
			if (block.max !== undefined && items.length > block.max) {
				return err(
					`map '${block.id}' received ${items.length} items but declares max ${block.max}`
				)
			}
			// Each iteration gets its own scope, so genuinely parallel maps are correct
			// rather than merely equivalent-if-you-squint.
			const run = async (item: unknown, i: number): Promise<Result> => {
				const child = scope.child()
				child.set(`${block.id}.${ITEM_KEY}`, item)
				return runLevel(
					{ blockId: block.id, chain: "item" },
					child,
					mode,
					i
				)
			}
			const results =
				mode === "parallel"
					? await Promise.all(items.map(run))
					: await sequential(
							items.map((item, i) => ({ item, i })),
							({ item, i }) => run(item, i)
						)
			items.forEach((_, i) =>
				collected.push({
					branchKey: `${block.id}[${i}]`,
					index: i,
					result: results[i]!
				})
			)
			publish()
			return (
				collected.find((b) => b.result.kind !== "ok")?.result ??
				ok(null)
			)
		}

		// ── loop (01 §4a) ────────────────────────────────────────────────────
		// Do-while: run the body, then re-read the declared predicate. A tool loop
		// always wants one generate before it can know whether to stop.
		const max = block.max ?? 0
		for (let i = 0; i < max; i++) {
			if (checkCancel()) return cancelled("cancelled")
			const child = scope.child()
			const r = await runLevel(
				{ blockId: block.id, chain: "item" },
				child,
				"sequential",
				i
			)
			collected.push({
				branchKey: `${block.id}[${i}]`,
				index: i,
				result: r
			})
			if (r.kind !== "ok") {
				publish()
				return r
			}
			const again = block.repeatWhile
				? resolvePredicate(block.repeatWhile, child)
				: false
			if (!truthy(again)) {
				publish()
				return ok(null)
			}
		}
		publish()
		// Reaching `max` is not an error — it is the bound doing its job, and the
		// receipt says so rather than leaving a truncated loop looking successful.
		receipt.notes = [
			...(receipt.notes ?? []),
			`loop '${block.id}' reached its declared max of ${max}`
		]
		return ok(null)
	}

	try {
		const outcome = await runLevel(
			{ blockId: undefined, chain: undefined },
			values
		)
		if (outcome.kind === "halt") {
			receipt.outcome = "halt"
			receipt.haltReason = outcome.reason
			receipt.haltNodeKey ??= receipt.nodes.find(
				(n) => n.result === "halt"
			)?.nodeKey
		} else if (outcome.kind !== "ok") {
			receipt.outcome = outcome.kind
			if (outcome.kind === "err") {
				receipt.haltReason ??= outcome.reason
				receipt.haltNodeKey ??= receipt.nodes.find(
					(n) => n.result === "err"
				)?.nodeKey
			}
		}
	} catch (e) {
		if (e instanceof BudgetExceeded) {
			receipt.outcome = "err"
			receipt.haltReason = e.message
		} else throw e
	}

	receipt.endedAt = now()
	receipt.reviews = reviews
	// Receipts sort by execution order for rendering.
	receipt.nodes.sort((a, b) => a.seq - b.seq)

	// ── Compact receipt (13 §2) ───────────────────────────────────────────────
	// The per-message multiplier is a hot event × every subscribed pipeline, where
	// most subscribers halt on the first node and that is success (01 §5). Those
	// runs keep their attribution and lose their payloads.
	// A preview is never compacted — the preview *is* the payload. Worth noting that the
	// trigger-source rule already gets this right on its own (a preview is `ui`), but
	// relying on that would be an accident rather than a decision.
	const compactDefault = receipt.triggerSource === "event" && !receipt.preview
	if (
		(opts.compactHaltReceipts ?? compactDefault) &&
		receipt.outcome === "halt" &&
		!effectfulNodeRan
	) {
		receipt.compact = true
		receipt.compactedNodeCount = receipt.nodes.length
		receipt.nodes = []
		receipt.reviews = []
	}

	return receipt
}

/**
 * Every out port a gate-eligible Consumer declares as `write-result@1` resolves to the
 * *same* discriminated value. A port named `messageId` therefore hands downstream the
 * result, not an id — which is the point: there may not be an id yet (13 §7j-b).
 */
function publishWriteResult(
	w: WriteResult,
	out?: Record<string, string>
): Record<string, unknown> {
	const published: Record<string, unknown> = { ...w, main: w }
	for (const [port, shape] of Object.entries(out ?? {})) {
		if (shape === "core:shape/write-result@1") published[port] = w
	}
	return published
}

const isWriteResult = (v: unknown): v is WriteResult =>
	!!v &&
	typeof v === "object" &&
	"status" in (v as object) &&
	((v as WriteResult).status === "committed" ||
		(v as WriteResult).status === "pending")

/**
 * A loop's `repeatWhile` is a **port reference**, resolved in the iteration's own scope.
 * Not an expression: a reference keeps the construct renderable ("repeats while
 * generate.hasToolCalls, max 8") and keeps a second expression language out of the design.
 */
function resolvePredicate(
	ref: unknown,
	scope: { get(k: string): any }
): unknown {
	if (!ref || typeof ref !== "object" || (ref as any).__ref !== "data")
		return ref
	const r = ref as { node: string; port: string }
	return readPort(scope.get(r.node), r.port)
}

/**
 * Read a port off an upstream value.
 *
 * `main` means **the whole value** when the producer declared no distinct `main` — which
 * is exactly the case for a map or loop item, where the "producer" is a raw list element
 * that never had ports at all. Without this, `$.$item` on a plain object silently
 * resolves to undefined, which is the least debuggable failure available.
 */
function readPort(upstream: unknown, port: string): unknown {
	if (!upstream || typeof upstream !== "object") return upstream
	if (port === "main" && !(port in (upstream as object))) return upstream
	return (upstream as any)[port]
}

/** `over` is either a literal list or a data ref into an upstream value. */
function resolveMapItems(
	over: unknown,
	values: { get(k: string): any }
): unknown[] {
	if (Array.isArray(over)) return over
	if (over && typeof over === "object" && (over as any).__ref === "data") {
		const r = over as { node: string; port: string }
		const v = readPort(values.get(r.node), r.port)
		return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]
	}
	return []
}

async function sequential<T, R>(
	items: T[],
	fn: (t: T) => Promise<R>
): Promise<R[]> {
	const out: R[] = []
	for (const i of items) out.push(await fn(i))
	return out
}

function withTimeout<T>(
	p: Promise<T>,
	ms: number,
	controller: AbortController,
	now: () => number
): Promise<T> {
	if (!Number.isFinite(ms)) return p
	return new Promise<T>((resolve, reject) => {
		const t = setTimeout(() => {
			controller.abort()
			reject(new Error("__timeout__"))
		}, ms)
		p.then(
			(v) => {
				clearTimeout(t)
				resolve(v)
			},
			(e) => {
				clearTimeout(t)
				reject(e)
			}
		)
	})
}

function setPath(obj: any, path: string[], value: unknown) {
	let cur = obj
	for (let i = 0; i < path.length - 1; i++) {
		const k = path[i]!
		cur[k] = Array.isArray(cur[k]) ? [...cur[k]] : { ...(cur[k] ?? {}) }
		cur = cur[k]
	}
	cur[path[path.length - 1]!] = value
}

/** Vectors, material and secrets never enter a receipt (16 §1a, 01 §10, 13 §6). */
function redact(v: unknown): unknown {
	if (
		Array.isArray(v) &&
		v.length > 8 &&
		v.every((x) => typeof x === "number")
	) {
		return { $vector: true, dims: v.length }
	}
	if (Array.isArray(v)) return v.map(redact)
	// A secret-typed setting is redacted **by its type**, which is the entire reason
	// the field is typed rather than free-form: core can identify it without knowing
	// what the plugin called it (13 §6).
	if (isSecret(v)) return "[secret]"
	if (v && typeof v === "object") {
		const out: Record<string, unknown> = {}
		for (const [k, val] of Object.entries(v)) {
			if (k === "material" || k === "credentials") {
				out[k] = "[redacted]"
				continue
			}
			out[k] = redact(val)
		}
		return out
	}
	return v
}

/** replay(receipt) — deterministic, never re-infers (F16). */
export async function replay(
	doc: SpecDocument,
	receipt: Receipt,
	bindings: Bindings
): Promise<Receipt> {
	const recorded = new Map(receipt.nodes.map((n) => [n.nodeKey, n.output]))
	const replayBindings: Bindings = { ...bindings }
	for (const n of receipt.nodes) {
		if (n.kind !== "provider") continue
		replayBindings[n.typeId] = async () => ok(recorded.get(n.nodeKey))
	}
	return run(doc, {
		input: receipt.nodes[0]?.output,
		bindings: replayBindings,
		seed: receipt.seed,
		runId: receipt.runId + ":replay"
	})
}
