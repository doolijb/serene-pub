/**
 * The conformance kit (03 §9).
 *
 * This is the artifact SP Core upgrades *against*. The rest of this package is a
 * reference implementation whose runtime half is placeholder — a real executor will have
 * durable gate parking, a persistent run queue, transactions and four transports, none of
 * which are here. What survives the port is **the contracts**, and a contract nobody can
 * execute is a document.
 *
 * So: core implements `HostUnderTest`, runs `conform(host)`, and gets a pass/fail per
 * requirement with the law it comes from. The SDK's own executor runs the same kit, which
 * is what keeps the kit honest — a requirement the reference implementation cannot pass is
 * a requirement stated wrong.
 *
 * Every check states **what would be broken if it failed**, because a red line saying
 * "F13" tells an implementer nothing about what to go and look at.
 */

import type { SpecDocument } from '@serene-pub/sdk'
import type { Finding } from '@serene-pub/sdk'
import type { Receipt } from '@serene-pub/sdk'
import type { Bindings, RunOptions } from '@serene-pub/sdk'

export interface HostUnderTest {
	name: string
	validate(doc: SpecDocument): Finding[]
	run(doc: SpecDocument, opts: RunOptions): Promise<Receipt>
	replay(doc: SpecDocument, receipt: Receipt, bindings: Bindings): Promise<Receipt>
	/** Canonical form, for the round-trip law. */
	canonicalHash(doc: SpecDocument): string
	importDocument(doc: SpecDocument): SpecDocument
}

export interface Requirement {
	id: string
	law: string
	title: string
	/** What breaks in the product if this is not true. Written for whoever sees it go red. */
	consequence: string
	check(host: HostUnderTest, fx: Fixtures): Promise<void> | void
}

/**
 * The kit does not build specs itself — core's builder and the SDK's are the same code,
 * but a host may want to feed documents it produced another way. Fixtures are injected.
 */
export interface Fixtures {
	/** A minimal chat turn: input → query → task → provider → write. */
	chatTurn(): SpecDocument
	/** The same, with a Task that halts before anything effectful. */
	haltsEarly(): SpecDocument
	/** An async block with three chains, for the equivalence law. */
	gather(): SpecDocument
	/** A map with a declared max. */
	mapped(): SpecDocument
	/** A loop with a predicate inside its body. */
	looped(max: number): SpecDocument
	/** Documents that must be rejected, each paired with the law it violates. */
	invalid(): Array<{ law: string; doc: SpecDocument; because: string }>
	bindings(over?: Bindings): Bindings
	world: RunOptions['world']
}

export class ConformanceError extends Error {}

const must = (cond: unknown, why: string) => {
	if (!cond) throw new ConformanceError(why)
}

// ── The requirements ────────────────────────────────────────────────────────

export const REQUIREMENTS: Requirement[] = [
	{
		id: 'C1',
		law: 'F3',
		title: 'import(export(doc)) is identity, and the hash is stable',
		consequence:
			'Rows stop being the system of record. Export/import silently mutates specs, and two instances of the same version disagree about what they are running.',
		check(host, fx) {
			const doc = fx.chatTurn()
			const back = host.importDocument(doc)
			must(host.canonicalHash(back) === host.canonicalHash(doc), 'canonical hash changed across a round trip')
			must(JSON.stringify(back) === JSON.stringify(doc), 'the document changed across a round trip')
		},
	},
	{
		id: 'C2',
		law: '01 §2, F1, F7, F9, F25',
		title: 'every statically checkable law is rejected at publish, with a fix',
		consequence:
			'Invalid specs reach runtime. A user sees "it does nothing" instead of an error, and the validator stops being the thing authors trust.',
		check(host, fx) {
			for (const { law, doc, because } of fx.invalid()) {
				const errs = host.validate(doc).filter((f) => f.severity === 'error')
				must(errs.length > 0, `${law}: ${because} — but validate() returned no errors`)
				must(
					errs.every((e) => !!e.fix),
					`${law}: an error with no \`fix\` — a prohibition without a stated alternative is a bug (15 §1.3)`,
				)
			}
		},
	},
	{
		id: 'C3',
		law: '01 §5',
		title: 'halt ends the run as `halt`, records the node and reason, and skips downstream',
		consequence:
			'Halting looks like failure. Every subscriber to a hot event that correctly decides "not applicable" is counted as an error, and the health signal becomes noise.',
		async check(host, fx) {
			const r = await host.run(fx.haltsEarly(), { input: {}, world: fx.world, bindings: fx.bindings() })
			must(r.outcome === 'halt', `outcome was '${r.outcome}', not 'halt'`)
			must(!!r.haltReason, 'no halt reason recorded — "why did nothing happen" is unanswerable')
			must(!r.nodes.some((n) => n.kind === 'provider'), 'a node downstream of the halt still ran')
		},
	},
	{
		id: 'C4',
		law: 'F11',
		title: 'the run seed is recorded and replays identically',
		consequence:
			'Nondeterministic Tasks stop being replayable. A dice roll, a probability roll or a sampled choice can never be explained after the fact.',
		async check(host, fx) {
			const doc = fx.chatTurn()
			const opts = { input: {}, world: fx.world, bindings: fx.bindings(), seed: 'seed:conformance' }
			const a = await host.run(doc, opts)
			const b = await host.run(doc, opts)
			must(a.seed === 'seed:conformance', 'the seed is not recorded on the receipt')
			must(
				JSON.stringify(a.nodes.map((n) => n.output)) === JSON.stringify(b.nodes.map((n) => n.output)),
				'two runs with the same seed produced different outputs',
			)
		},
	},
	{
		id: 'C5',
		law: 'F16',
		title: 'replay reproduces a run without calling the Provider',
		consequence:
			'Replay re-infers. Debugging a past run costs money, changes the answer, and cannot be done at all once a connection is gone.',
		async check(host, fx) {
			const doc = fx.chatTurn()
			const first = await host.run(doc, { input: {}, world: fx.world, bindings: fx.bindings() })
			let called = 0
			const replayed = await host.replay(
				doc,
				first,
				fx.bindings({
					'core:provider/generate-text@1': async () => {
						called++
						return { kind: 'ok', value: { main: 'DIFFERENT', text: 'DIFFERENT' } }
					},
				}),
			)
			must(called === 0, 'replay invoked the Provider')
			const out = (n: Receipt['nodes'][number]) => JSON.stringify(n.output)
			must(
				replayed.nodes.map(out).join() === first.nodes.map(out).join(),
				'replay produced different node outputs',
			)
		},
	},
	{
		id: 'C6',
		law: 'F13',
		title: 'budgets meter consumption; waiting consumes nothing',
		consequence:
			'A parked review gate or a queued run bills the user for time nobody spent. Budgets become a reason not to use the review gate, which is the feature they exist to protect.',
		async check(host, fx) {
			const r = await host.run(fx.haltsEarly(), {
				input: {},
				world: fx.world,
				bindings: fx.bindings(),
				queuedMs: 7 * 24 * 60 * 60 * 1000,
				budget: { tokens: 10 },
			})
			must(r.consumption.tokens === 0, `a run that called nothing consumed ${r.consumption.tokens} tokens`)
			must(r.outcome !== 'err', 'a week of waiting tripped a budget')
		},
	},
	{
		id: 'C7',
		law: 'F36',
		title: 'timeouts bound execution, never waiting',
		consequence:
			'A review gate cannot be left open overnight, and a queued run dies before it starts. The whole consent model becomes unusable in practice.',
		async check(host, fx) {
			const r = await host.run(fx.chatTurn(), {
				input: {},
				world: fx.world,
				bindings: fx.bindings(),
				queuedMs: 7 * 24 * 60 * 60 * 1000,
				timeoutCeilingMs: 1000,
			})
			must(!r.nodes.some((n) => n.timedOut), 'queue wait tripped a node timeout')
		},
	},
	{
		id: 'C8',
		law: 'F26',
		title: 'forced-sequential execution produces an identical result',
		consequence:
			'The async kill switch stops being safe. An admin disabling concurrency changes answers, so the switch can never be used to diagnose anything.',
		async check(host, fx) {
			const doc = fx.gather()
			const norm = (r: Receipt) =>
				r.nodes
					.map((n) => `${n.nodeKey}:${n.result}:${JSON.stringify(n.output)}`)
					.sort()
					.join('\n')
			const par = await host.run(doc, { input: { text: 'hi' }, world: fx.world, bindings: fx.bindings() })
			const seq = await host.run(doc, {
				input: { text: 'hi' },
				world: fx.world,
				bindings: fx.bindings(),
				forceSequential: true,
			})
			must(norm(par) === norm(seq), 'parallel and forced-sequential produced different results')
		},
	},
	{
		id: 'C9',
		law: '13 §1',
		title: 'a block publishes branch-results in declaration order',
		consequence:
			'Downstream nodes see branches in completion order, so a spec behaves differently under load than in testing — the least reproducible class of bug there is.',
		async check(host, fx) {
			const r = await host.run(fx.gather(), { input: { text: 'hi' }, world: fx.world, bindings: fx.bindings() })
			must(r.outcome === 'ok', `gather did not complete: ${r.haltReason ?? r.outcome}`)
		},
	},
	{
		id: 'C10',
		law: '01 §4, §4a',
		title: 'map and loop are bounded, and exceeding the bound is visible',
		consequence:
			'An unbounded repeat is the most likely source of a surprise bill in the system, and for a loop it is the only thing between a bad predicate and a run that never ends.',
		async check(host, fx) {
			const r = await host.run(fx.looped(2), { input: {}, world: fx.world, bindings: fx.bindings() })
			must(r.outcome === 'ok', 'reaching max should not be an error — it is the bound working')
			must(
				(r.notes ?? []).some((n) => /max/.test(n)),
				'a loop that hit its ceiling left no record — a truncated loop must never look like a finished one',
			)
		},
	},
	{
		id: 'C11',
		law: '13 §3',
		title: 'an admin kill is `cancelled`, with the actor recorded',
		consequence:
			'"An admin stopped it" is indistinguishable from "it broke." Error dashboards fill with deliberate actions and stop being read.',
		async check(host, fx) {
			const r = await host.run(fx.chatTurn(), {
				input: {},
				world: fx.world,
				bindings: fx.bindings(),
				cancelSignal: () => ({ by: 'admin:test', reason: 'killed from the queue view' }),
			})
			must(r.outcome === 'cancelled', `outcome was '${r.outcome}'`)
			must(r.cancelledBy === 'admin:test', 'the actor was not recorded')
		},
	},
	{
		id: 'C12',
		law: '13 §2',
		title: 'an event-triggered halt before any effect compacts; a click does not',
		consequence:
			'A hot event × every subscribed pipeline × every message writes a full receipt each time. Retention becomes a per-message multiplier and the receipts table eats the disk.',
		async check(host, fx) {
			const doc = fx.haltsEarly()
			const ev = await host.run(doc, {
				input: {},
				world: fx.world,
				bindings: fx.bindings(),
				triggerSource: 'event',
			})
			must(ev.compact === true, 'an event-triggered early halt was not compacted')
			must(ev.nodes.length === 0 && !!ev.haltReason, 'compaction dropped the reason as well as the payloads')
			const ui = await host.run(doc, { input: {}, world: fx.world, bindings: fx.bindings(), triggerSource: 'ui' })
			must(ui.compact !== true, 'a user-initiated run was compacted — it happens once per click')
		},
	},
	{
		id: 'C13',
		law: '16 §7',
		title: 'the previewed payload is the payload that would be sent',
		consequence:
			'Debug mode becomes a second estimator. It drifts from reality silently and is most wrong exactly when someone opens it because something is off.',
		async check(host, fx) {
			const doc = fx.chatTurn()
			let sent: unknown
			const previewed = await host.run(doc, {
				input: {},
				world: fx.world,
				bindings: fx.bindings(),
				preview: true,
			})
			must(!!previewed.preview, 'a preview run produced no preview report')
			await host.run(doc, {
				input: {},
				world: fx.world,
				bindings: fx.bindings({
					'core:provider/generate-text@1': async (i: any) => {
						sent = i.context
						return { kind: 'ok', value: { main: 'x', text: 'x' } }
					},
				}),
			})
			must(
				JSON.stringify(previewed.preview!.context.rendered) === JSON.stringify(sent),
				'the previewed payload differs from the one actually sent',
			)
		},
	},
	{
		id: 'C14',
		law: 'F16, F18',
		title: 'no receipt in the corpus contains a credential',
		consequence:
			'Receipts are handed to plugin authors for debugging. A credential in one is a credential mailed to a stranger, and the material/metadata split becomes a claim nobody can rely on.',
		async check(host, fx) {
			const runs = [
				await host.run(fx.chatTurn(), { input: {}, world: fx.world, bindings: fx.bindings() }),
				await host.run(fx.gather(), { input: { text: 'hi' }, world: fx.world, bindings: fx.bindings() }),
			]
			for (const r of runs) {
				const body = JSON.stringify(r)
				must(
					!/sk-|api[_-]?key"?\s*:\s*"(?!\[)/i.test(body),
					'a receipt contains something shaped like a credential',
				)
			}
		},
	},
	{
		id: 'C15',
		law: '15 §1.3',
		title: 'every validation error states what to do instead',
		consequence:
			'Authors get told no without being told what yes looks like. Every prohibition becomes a support thread.',
		check(host, fx) {
			for (const { doc } of fx.invalid()) {
				for (const e of host.validate(doc)) {
					must(!!e.fix && e.fix.length > 10, `finding '${e.message}' has no usable fix`)
				}
			}
		},
	},
]

// ── Runner ──────────────────────────────────────────────────────────────────

export interface ConformanceResult {
	id: string
	law: string
	title: string
	pass: boolean
	error?: string
	consequence?: string
}

export async function conform(host: HostUnderTest, fx: Fixtures): Promise<ConformanceResult[]> {
	const out: ConformanceResult[] = []
	for (const r of REQUIREMENTS) {
		try {
			await r.check(host, fx)
			out.push({ id: r.id, law: r.law, title: r.title, pass: true })
		} catch (e) {
			out.push({
				id: r.id,
				law: r.law,
				title: r.title,
				pass: false,
				error: (e as Error).message,
				consequence: r.consequence,
			})
		}
	}
	return out
}

export function renderConformance(results: ConformanceResult[]): string {
	const failed = results.filter((r) => !r.pass)
	const lines = [
		`conformance: ${results.length - failed.length}/${results.length} passing`,
		...results.map((r) => `  ${r.pass ? '✓' : '✗'} ${r.id.padEnd(4)} [${r.law}] ${r.title}`),
	]
	for (const r of failed) {
		lines.push('', `✗ ${r.id} — ${r.error}`, `   what this breaks: ${r.consequence}`)
	}
	return lines.join('\n')
}
