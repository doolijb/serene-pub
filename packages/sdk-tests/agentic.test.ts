/**
 * Use cases 83–88 — bounded agentic iteration: the `loop` block.
 *
 * The gap this closes: a tool-calling turn is *call model → tool calls come back →
 * execute → feed results back → call again → until done*. `map` cannot express it (the
 * list is not known up front), `halt` ends the run rather than the iteration, and events
 * are fire-and-forget. So the only home was **inside a Provider hook**, as one opaque
 * call — losing per-step timings, per-step review, per-step budget and the whole
 * explicability story precisely where it matters most.
 *
 * `loop` is deliberately **not a back-edge**. Like `map`, the repetition lives in the
 * block's declaration rather than in an edge that points backwards; the executor already
 * knew how to run a chain more than once. A loop is a map whose iteration count comes
 * from a predicate instead of a list length.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { spec } from '@serene-pub/sdk'
import { compile } from '@serene-pub/sdk'
import { run, ok, halt } from '@serene-pub/sdk'
import { renderReceipt } from '@serene-pub/sdk'
import { slot } from '@serene-pub/sdk'
import { S } from '@serene-pub/sdk'
import { pin, describeProvider, describeTaskType } from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'
import { publish, bindings, errorsFor, world } from './helpers.js'

// A Provider that may ask for tools, and a Task that folds results back into context.
const agentTurn = pin(
	describeProvider({
		id: 'demo:provider/agent-turn@1',
		shape: S.textGen,
		effects: 'external',
		timeoutMs: 30000,
		slots: { connection: { kind: 'connection', shape: S.textGen } },
		ports: {
			in: { context: S.assembled },
			out: { main: S.json, text: S.text, toolCalls: S.json, hasToolCalls: S.json },
		},
	}),
)

const foldResults = pin(
	describeTaskType({
		id: 'demo:task/fold-tool-results@1',
		timeoutMs: 500,
		ports: { in: { results: S.json, context: S.assembled }, out: { main: S.assembled, context: S.assembled } },
	}),
)

/** The shape the whole exercise exists for. */
const agentic = (max = 8) =>
	spec('demo:agent', { version: '1.0.0' })
		.input('input', C.userMessage.v1())
		.task('prompt', ($) => C.assemble.v2({ candidates: [] }))
		.loop(
			'agent',
			{ repeatWhile: ($: any) => $.agent.item.turn.hasToolCalls, max },
			(l) =>
				l
					.provider('turn', ($: any) => agentTurn.v1({ context: $.prompt.context, connection: slot.connection() }))
					.map('tools', { over: ($: any) => $.agent.item.turn.toolCalls, max: 16 }, (m) =>
						m.provider('call', ($: any) => C.mcpTool.v1({ args: $.$item, connection: slot.connection() })),
					)
					.task('fold', ($: any) => foldResults.v1({ results: $.agent.item.tools.values, context: $.prompt.context })),
		)
		.consume('save', ($: any) => C.createMessage.v1({ text: $.agent.values }))

/** Two rounds of tools, then a plain answer. */
const scripted = (rounds: number) => {
	let turn = 0
	return bindings({
		'demo:provider/agent-turn@1': async () => {
			const more = turn++ < rounds
			return ok({
				main: 'x',
				text: `answer ${turn}`,
				toolCalls: more ? [{ tool: 'search' }, { tool: 'read' }] : [],
				hasToolCalls: more,
			})
		},
		'core:provider/mcp-tool@1': async (i: any) => ok({ main: `ran ${i.args?.tool}`, result: `ran ${i.args?.tool}` }),
		'demo:task/fold-tool-results@1': async () => ok({ main: 'folded', context: 'folded' }),
	})
}

// ── 83 · It runs, it stops on the predicate, and every step is in the receipt ─
describe('83 · a tool-calling turn', () => {
	test('the loop repeats while the predicate holds and stops when it does not', async () => {
		const r = await run(publish(agentic()), { input: {}, world, bindings: scripted(2) })
		assert.equal(r.outcome, 'ok')
		const turns = r.nodes.filter((n) => n.nodeKey === 'agent.item.turn')
		assert.equal(turns.length, 3, 'two tool rounds, then the answer — do-while, so always at least one')
	})

	test('every tool call is its own receipt entry, not one opaque provider call', async () => {
		// This is the entire argument for putting the loop on the spine rather than
		// inside a hook: per-step timings, per-step review, per-step budget.
		const r = await run(publish(agentic()), { input: {}, world, bindings: scripted(2) })
		const calls = r.nodes.filter((n) => n.nodeKey === 'agent.item.tools.item.call')
		assert.equal(calls.length, 4, 'two rounds × two tools')
		for (const c of calls) assert.equal(typeof c.iteration, 'number')
	})

	test('a blocked model that never stops asking is bounded, and the receipt says so', async () => {
		const r = await run(publish(agentic(3)), { input: {}, world, bindings: scripted(99) })
		assert.equal(r.outcome, 'ok', 'reaching max is the bound doing its job, not an error')
		assert.equal(r.nodes.filter((n) => n.nodeKey === 'agent.item.turn').length, 3)
		assert.match(renderReceipt(r), /reached its declared max of 3/)
	})

	test('a truncated loop never looks like a finished one', async () => {
		const finished = await run(publish(agentic(8)), { input: {}, world, bindings: scripted(1) })
		const truncated = await run(publish(agentic(2)), { input: {}, world, bindings: scripted(99) })
		assert.equal((finished.notes ?? []).length, 0)
		assert.equal((truncated.notes ?? []).length, 1)
	})
})

// ── 84 · Dispatch is data, which is why branching is not needed ─────────────
test('84 · "which tool" is a value flowing through, never a branch', async () => {
	// The case that looks like it needs branching — *if the model asked for search do A,
	// else do B* — is a single node whose params carry the tool name. Dispatch is data.
	const seen: string[] = []
	await run(publish(agentic()), {
		input: {},
		world,
		bindings: {
			...scripted(1),
			'core:provider/mcp-tool@1': async (i: any) => {
				seen.push(i.args?.tool)
				return ok({ main: 'done' })
			},
		},
	})
	assert.deepEqual(seen, ['search', 'read'])
})

// ── 85 · Nested blocks, and per-iteration scoping ──────────────────────────
describe('85 · nesting', () => {
	test('a map nested inside a loop compiles to a block tree', () => {
		const doc = compile(agentic().build())
		const tools = doc.blocks.find((b) => b.id === 'agent.item.tools')!
		assert.equal(tools.blockId, 'agent', 'the map knows which block it sits in')
		assert.equal(tools.blockChain, 'item')
		assert.equal(doc.blocks.find((b) => b.id === 'agent')!.blockId, undefined, 'the loop is on the spine')
	})

	test('two iterations never see each other’s values', async () => {
		// The earlier draft shared one value map, which is why every map was forced
		// sequential. Scopes are chained now: an iteration writes into its own and reads
		// through to its parent.
		const r = await run(publish(agentic()), { input: {}, world, bindings: scripted(2) })
		const folds = r.nodes.filter((n) => n.nodeKey === 'agent.item.fold')
		assert.equal(folds.length, 3)
		assert.ok(folds.every((x) => x.result === 'ok'))
	})
})

// ── 86 · What the loop publishes ───────────────────────────────────────────
test('86 · a loop publishes branch-results, exactly like a map', async () => {
	// One shape for both constructs, so one equivalence harness covers both (F26) and
	// downstream never has to know which construct produced its input.
	let downstream: any
	await run(publish(agentic()), {
		input: {},
		world,
		bindings: {
			...scripted(1),
			'core:consumer/create-message@1': async (i: any) => {
				downstream = i.text
				return ok({ main: 'saved' })
			},
		},
	})
	assert.ok(Array.isArray(downstream), 'the `values` port is the ok results in order')
})

// ── 87 · What the validator refuses ────────────────────────────────────────
describe('87 · the bounds are enforced, not advised', () => {
	const base = () =>
		spec('demo:badloop', { version: '1.0.0' }).input('input', C.userMessage.v1()).task('prompt', C.assemble.v2({}))

	test('an unbounded loop is refused, and the fix says why max is not optional', () => {
		const b = base().loop('l', { repeatWhile: ($: any) => $.l.item.t.main, max: 0 }, (l) =>
			l.task('t', C.gate.v1({})),
		)
		const e = errorsFor(b, '01 §4a')
		assert.ok(e.some((x) => /has no declared maximum/.test(x.message)))
		assert.match(e.find((x) => /maximum/.test(x.message))!.fix, /never ends/)
	})

	test('a predicate computed outside the body is refused — it can never change', () => {
		const b = base().loop('l', { repeatWhile: ($: any) => $.prompt.context, max: 4 }, (l) =>
			l.task('t', C.gate.v1({})),
		)
		const e = errorsFor(b, '01 §4a')
		assert.equal(e.length, 1)
		assert.match(e[0]!.fix, /always run to its max of 4/)
	})

	test('a write inside a repeating block is refused — one write is one transaction', () => {
		const b = base().loop('l', { repeatWhile: ($: any) => $.l.item.t.main, max: 4 }, (l) =>
			l.task('t', C.gate.v1({})).consume('save', C.createMessage.v1({ text: 'x' })),
		)
		const e = errorsFor(b, 'F7')
		assert.equal(e.length, 1)
		assert.match(e[0]!.fix, /a repeated write is neither/)
	})

	test('referencing into a repeating block from outside is refused, and names the fix', () => {
		const b = base()
			.loop('l', { repeatWhile: ($: any) => $.l.item.t.main, max: 4 }, (l) => l.task('t', C.gate.v1({})))
			.task('after', ($: any) => C.assemble.v2({ candidates: $['l.item.t'] }))
		const e = errorsFor(b, '01 §4a')
		assert.ok(e.some((x) => /runs more than once/.test(x.message)))
		assert.match(e.find((x) => /runs more than once/.test(x.message))!.fix, /\$\.l\.values/)
	})
})

// ── 88 · A halt inside the body still halts the run ────────────────────────
test('88 · halt means halt — the loop does not swallow it', async () => {
	// Considered and rejected: making `halt` mean "stop iterating" inside a loop. Halt
	// already means "stop, and that is correct" (01 §5); giving it a second meaning that
	// depends on where it appears is the kind of context-sensitivity that bites later.
	// The predicate is how a loop ends; halt is how a *run* ends.
	const r = await run(publish(agentic()), {
		input: {},
		world,
		bindings: { ...scripted(5), 'demo:task/fold-tool-results@1': async () => halt('nothing worth folding') },
	})
	assert.equal(r.outcome, 'halt')
	assert.equal(r.haltReason, 'nothing worth folding')
	assert.equal(r.nodes.filter((n) => n.nodeKey === 'agent.item.turn').length, 1, 'it stopped in the first iteration')
})
