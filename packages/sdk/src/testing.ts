/**
 * `@serene-pub/sdk/testing` — the harness a **plugin author** runs (03 §9, U11).
 *
 * Distinct from `src/conformance.ts`, which is what **SP Core** runs against its own
 * executor. Two different audiences and two different questions:
 *
 *   conformance.ts — "does this host obey the laws?"
 *   testing.ts     — "does my hook behave, and did my change alter what gets sent?"
 *
 * The second question is the one that keeps a plugin working across SP releases, and it
 * is answered by goldens: record a receipt now, compare later, and see the diff rather
 * than a pass/fail. **"It still runs" is not the assertion anyone needs** — a plugin that
 * runs and quietly changes the prompt is the failure mode that reaches users.
 */

import type { Receipt, NodeReceipt } from './receipt.js'
import type { SpecDocument } from './document.js'
import type { Bindings, Result, RunOptions } from './executor.js'
import { run } from './executor.js'
import type { Descriptor } from './descriptors.js'

// ── Goldens ─────────────────────────────────────────────────────────────────

export interface Golden {
	name: string
	specId: string
	specVersion: string
	seed: string
	outcome: Receipt['outcome']
	haltReason?: string
	/** Per node: what went in and what came out. Timings are excluded on purpose. */
	nodes: Array<{ nodeKey: string; kind: string; result: string; input?: unknown; output?: unknown }>
	emitted: Array<{ event: string; cause: string }>
	/** The payload a preview run would have sent, when there is one. */
	wire?: unknown
}

/**
 * Reduce a receipt to what a golden should hold.
 *
 * Timings, run ids and wall-clock are all excluded — a golden that fails because a run
 * took 3ms instead of 2ms is a golden nobody keeps. What is kept is every decision and
 * every payload, which is what actually changes when a plugin's behaviour changes.
 */
export function toGolden(name: string, r: Receipt): Golden {
	return {
		name,
		specId: r.specId,
		specVersion: r.specVersion,
		seed: r.seed,
		outcome: r.outcome,
		haltReason: r.haltReason,
		nodes: r.nodes.map((n) => ({
			nodeKey: n.nodeKey,
			kind: n.kind,
			result: n.result,
			input: n.input,
			output: n.output,
		})),
		emitted: r.emitted.map((e) => ({ event: e.event, cause: e.cause })),
		wire: r.preview?.context.rendered,
	}
}

export interface GoldenDiff {
	path: string
	before: unknown
	after: unknown
}

/** A structural diff, deepest-path-first, so the first line names the actual change. */
export function diffGolden(before: Golden, after: Golden): GoldenDiff[] {
	const out: GoldenDiff[] = []
	const walk = (a: unknown, b: unknown, path: string) => {
		if (JSON.stringify(a) === JSON.stringify(b)) return
		const both = a && b && typeof a === 'object' && typeof b === 'object'
		if (!both) return void out.push({ path, before: a, after: b })
		const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
		let pushed = false
		for (const k of keys) {
			const before = out.length
			walk((a as any)[k], (b as any)[k], path ? `${path}.${k}` : k)
			if (out.length > before) pushed = true
		}
		if (!pushed) out.push({ path, before: a, after: b })
	}
	walk(before, after, '')
	return out
}

export function renderDiff(d: GoldenDiff[]): string {
	if (!d.length) return 'identical'
	return d
		.map((x) => `  ${x.path}\n    before: ${JSON.stringify(x.before)}\n    after:  ${JSON.stringify(x.after)}`)
		.join('\n')
}

export class GoldenMismatch extends Error {
	constructor(
		readonly name: string,
		readonly diff: GoldenDiff[],
	) {
		super(`golden '${name}' changed:\n${renderDiff(diff)}`)
	}
}

/** Record if absent, compare if present. The whole workflow in one call. */
export function checkGolden(name: string, r: Receipt, stored?: Golden): { golden: Golden; recorded: boolean } {
	const golden = toGolden(name, r)
	if (!stored) return { golden, recorded: true }
	const diff = diffGolden(stored, golden)
	if (diff.length) throw new GoldenMismatch(name, diff)
	return { golden, recorded: false }
}

// ── Binding conformance ─────────────────────────────────────────────────────

export interface BindingProbe {
	id: string
	title: string
	consequence: string
	check(hook: (input: any, ctx: any) => any, d: Descriptor, ctx: ProbeCtx): Promise<void> | void
}

export interface ProbeCtx {
	sampleInput: unknown
	/** A context object shaped like the one the executor injects for this kind. */
	makeCtx(over?: Record<string, unknown>): any
}

const must = (cond: unknown, why: string) => {
	if (!cond) throw new Error(why)
}

const isResult = (v: unknown): v is Result =>
	!!v && typeof v === 'object' && ['ok', 'err', 'cancelled', 'halt'].includes((v as Result).kind)

/**
 * What a hook has to do to be a hook. Run these in your own tests — the executor assumes
 * all of it, and a hook that breaks one of them fails in a way that is hard to attribute.
 */
export const BINDING_PROBES: BindingProbe[] = [
	{
		id: 'B1',
		title: 'returns a discriminated result, never a bare value',
		consequence:
			'The executor cannot tell success from a halt, so a correct "not applicable" is recorded as an error and the run inspector stops being trustworthy.',
		async check(hook, _d, ctx) {
			const r = await hook(ctx.sampleInput, ctx.makeCtx())
			must(isResult(r), `returned ${typeof r}; expected ok(…) / err(…) / halt(…) / cancelled(…)`)
		},
	},
	{
		id: 'B2',
		title: 'a Task reaches for no services',
		consequence:
			'Purity is what makes replay exact (F11). A Task that reads the clock or the network produces a run nobody can reproduce, and the receipt becomes a story rather than a record.',
		async check(hook, d, ctx) {
			if (d.kind !== 'task') return
			const surface = ctx.makeCtx()
			must(!('read' in surface), 'a Task context must not carry `read`')
			must(!('call' in surface), 'a Task context must not carry `call`')
			must(!('commit' in surface), 'a Task context must not carry `commit`')
			await hook(ctx.sampleInput, surface)
		},
	},
	{
		id: 'B3',
		title: 'randomness comes only from the run seed',
		consequence:
			'A dice roll nobody can replay is a dice roll nobody can dispute — and the seeded version is the whole reason SP can explain a probability roll where the incumbent cannot.',
		async check(hook, d, ctx) {
			if (!d.declaresRandomness) return
			const a = await hook(ctx.sampleInput, ctx.makeCtx({ random: seeded('probe') }))
			const b = await hook(ctx.sampleInput, ctx.makeCtx({ random: seeded('probe') }))
			must(
				JSON.stringify(a) === JSON.stringify(b),
				'two invocations with the same seeded RNG produced different output — something is reaching for Math.random',
			)
		},
	},
	{
		id: 'B4',
		title: 'it settles rather than hanging',
		consequence:
			'`runtime: node` abandons rather than kills (13 §7h), so a hook that never settles keeps burning CPU after the executor has moved on and eventually marks your plugin unhealthy.',
		async check(hook, _d, ctx) {
			const settled = await Promise.race([
				Promise.resolve(hook(ctx.sampleInput, ctx.makeCtx())).then(() => true),
				new Promise((res) => setTimeout(() => res(false), 250)),
			])
			must(settled, 'did not settle within 250ms in a probe with no I/O')
		},
	},
	{
		id: 'B5',
		title: 'it honours the abort signal',
		consequence:
			'The signal is the only cooperative way an in-process hook can be stopped. Ignoring it means an admin killing a run watches it keep going.',
		async check(hook, _d, ctx) {
			const c = new AbortController()
			c.abort()
			const r = await hook(ctx.sampleInput, ctx.makeCtx({ signal: c.signal }))
			must(isResult(r), 'an aborted invocation still has to return a result, not throw')
		},
	},
]

function seeded(seed: string): () => number {
	let h = 2166136261
	for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
	return () => {
		h = Math.imul(h ^ (h >>> 15), 2246822507)
		h = Math.imul(h ^ (h >>> 13), 3266489909)
		return ((h ^= h >>> 16) >>> 0) / 4294967296
	}
}

const PROBE_TIMEOUT_MS = 1000

/**
 * The timer is *not* unref'd and *is* cleared. A probe that awaits a hook which never
 * settles has to lose to a timer the event loop is still holding — otherwise the loop
 * drains, the await never resolves, and the author sees their test runner give up
 * instead of seeing "your hook never returned".
 */
function bounded<T>(p: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout>
	return Promise.race([
		p,
		new Promise<never>((_, rej) => {
			timer = setTimeout(
				() => rej(new Error(`probe did not settle within ${PROBE_TIMEOUT_MS}ms — the hook never returned`)),
				PROBE_TIMEOUT_MS,
			)
		}),
	]).finally(() => clearTimeout(timer))
}

export interface ProbeResult {
	id: string
	title: string
	pass: boolean
	error?: string
	consequence?: string
}

export async function probeBinding(
	hook: (input: any, ctx: any) => any,
	descriptor: Descriptor,
	ctx: ProbeCtx,
): Promise<ProbeResult[]> {
	const out: ProbeResult[] = []
	for (const p of BINDING_PROBES) {
		try {
			// Every probe is bounded. A probe that awaits a hook which never settles would
			// otherwise hang the author's whole test run — turning "your hook has a bug"
			// into "the SDK's harness is broken", which is the wrong lesson to teach.
			await bounded(Promise.resolve(p.check(hook, descriptor, ctx)))
			out.push({ id: p.id, title: p.title, pass: true })
		} catch (e) {
			out.push({ id: p.id, title: p.title, pass: false, error: (e as Error).message, consequence: p.consequence })
		}
	}
	return out
}

/** A context shaped like the executor's, per kind — so a probe tests the real surface. */
export const probeCtxFor = (kind: Descriptor['kind'], sampleInput: unknown = {}): ProbeCtx => ({
	sampleInput,
	makeCtx: (over = {}) => {
		const base: Record<string, unknown> = {
			signal: new AbortController().signal,
			progress: () => {},
			log: () => {},
		}
		if (kind === 'query') base.read = () => []
		if (kind === 'provider') {
			base.call = async (p: unknown) => p
			base.connectionMetadata = {}
			base.sampling = {}
			base.reportUsage = () => {}
			base.reportSampling = () => {}
		}
		if (kind === 'consumer') {
			base.commit = async (p: any) => ({ id: 'row:probe', ...p })
			base.emit = () => {}
		}
		return { ...base, ...over }
	},
})

// ── Equivalence ─────────────────────────────────────────────────────────────

/**
 * F26 as a one-liner an author can run: parallel and forced-sequential must produce the
 * same result. If your hook has a hidden ordering dependency, this is where it shows up
 * — not in a user's chat at 2am under load.
 */
export async function assertEquivalent(doc: SpecDocument, opts: RunOptions): Promise<void> {
	const norm = (r: Receipt) =>
		r.nodes
			.map((n: NodeReceipt) => `${n.nodeKey}:${n.result}:${JSON.stringify(n.output)}`)
			.sort()
			.join('\n')
	const par = await run(doc, opts)
	const seq = await run(doc, { ...opts, forceSequential: true })
	if (norm(par) !== norm(seq)) {
		throw new Error(
			'forced-sequential execution produced a different result (F26). Something in this spec ' +
				'depends on completion order — usually a hook mutating shared state rather than returning it.',
		)
	}
}

/** Run the same spec twice on one seed and assert nothing moved (F11). */
export async function assertDeterministic(doc: SpecDocument, opts: RunOptions & { seed: string }): Promise<void> {
	const a = await run(doc, opts)
	const b = await run(doc, opts)
	const diff = diffGolden(toGolden('a', a), toGolden('b', b))
	if (diff.length) throw new GoldenMismatch('determinism', diff)
}

export function renderProbes(results: ProbeResult[]): string {
	const lines = results.map((r) => `  ${r.pass ? '✓' : '✗'} ${r.id} ${r.title}`)
	for (const r of results.filter((x) => !x.pass)) {
		lines.push('', `✗ ${r.id} — ${r.error}`, `   what this breaks: ${r.consequence}`)
	}
	return lines.join('\n')
}

export type { Bindings }
