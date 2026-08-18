/**
 * Use cases 89–94 — allocation vs. wire formatting (16 §7).
 *
 * The finding this closes: `assembled-context@1` was one shape for every modality, which
 * forced it to mean "a rendered string." That is right for one family of connections and
 * wrong for the rest. The tell was `renderImage` declaring both `context: assembled` and
 * `prompts: {positive, negative}` — it already half-admitted it did not want prose.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { spec } from '@serene-pub/sdk'
import { run, ok } from '@serene-pub/sdk'
import { renderReceipt } from '@serene-pub/sdk'
import { roughTokens } from '@serene-pub/sdk'
import { slot } from '@serene-pub/sdk'
import { S } from '@serene-pub/sdk'
import { assignable } from '@serene-pub/sdk'
import { pin, describeProvider, describeTaskType } from '@serene-pub/sdk'
import {
	messages,
	chatml,
	alpaca,
	plainWire,
	fields,
	measureWire,
	defineWireFormat,
	formatWith,
	included,
	type AllocatedContext,
} from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'
import { publish, bindings, world } from './helpers.js'

const ctx = (): AllocatedContext => ({
	blocks: [
		{ sourceKey: 'persona', role: 'system', rendered: 'You are Mira.', tokens: 4, included: true, why: ['constant'] },
		{
			sourceKey: 'lore',
			role: 'system',
			rendered: 'The pass is snowed in.',
			tokens: 6,
			included: true,
			why: ["key 'pass' matched at depth 1", 'won its inclusion group over "weather-2"'],
		},
		{ sourceKey: 'history', role: 'user', rendered: 'where are we?', tokens: 4, included: true, why: ['recent'] },
		{
			sourceKey: 'lore',
			role: 'system',
			rendered: 'Long backstory nobody needs.',
			tokens: 40,
			included: false,
			why: ['probability 0.4, rolled out on seed:abc'],
		},
	],
	allocation: { budget: 100, used: 14, droppedTokens: 40, policy: 'lowest-weight' },
})

// ── 89 · One allocation, several wire formats ──────────────────────────────
describe('89 · the same blocks, four wires', () => {
	test('chat completion gets a role-tagged array', () => {
		assert.deepEqual(messages.format(ctx()), [
			{ role: 'system', content: 'You are Mira.' },
			{ role: 'system', content: 'The pass is snowed in.' },
			{ role: 'user', content: 'where are we?' },
		])
	})

	test('text completion gets one string with instruct sequences', () => {
		assert.match(String(chatml.format(ctx())), /<\|im_start\|>system/)
		assert.match(String(alpaca.format(ctx())), /### Instruction:/)
	})

	test('an image Provider gets prompt fields, not prose — the case that exposed this', () => {
		const f = fields.format(ctx()) as { positive: string; negative: string }
		assert.match(f.positive, /You are Mira/)
		assert.equal(typeof f.negative, 'string')
	})

	test('dropped blocks never reach any wire', () => {
		for (const w of [messages, chatml, alpaca, plainWire, fields]) {
			assert.equal(JSON.stringify(w.format(ctx())).includes('Long backstory'), false, w.id)
		}
	})

	test('an author swapping Ollama for OpenAI re-authors nothing', () => {
		// The whole reason formatting is a slot on the Provider rather than a node: the
		// pipeline does not mention a wire format at all.
		const a = messages.format(ctx())
		const b = chatml.format(ctx())
		assert.notDeepEqual(a, b)
		assert.equal(included(ctx()).length, 3, 'same allocation feeding both')
	})
})

// ── 90 · The scaffolding is counted, not guessed ───────────────────────────
describe('90 · overhead', () => {
	const count = roughTokens as (s: string) => number

	test('the measure separates block tokens from scaffolding', () => {
		const m = measureWire(messages.id, ctx(), count, 1000)
		assert.equal(m.blockTokens, 14)
		assert.ok(m.overheadTokens > 0, 'a messages array is not free')
		assert.equal(m.tokens, m.blockTokens + m.overheadTokens)
	})

	test('plain concatenation is the reference implementation of near-zero overhead', () => {
		const m = measureWire(plainWire.id, ctx(), count, 1000)
		assert.ok(m.overheadTokens < measureWire(chatml.id, ctx(), count, 1000).overheadTokens)
	})

	test('over budget is reported by the measure, not discovered by the vendor', () => {
		const m = measureWire(chatml.id, ctx(), count, 5)
		assert.ok(m.overBudgetBy && m.overBudgetBy > 0)
	})

	test('an unregistered format fails with the likely cause named', () => {
		assert.throws(() => formatWith('nobody.ships:this@1', ctx()), /the connection's plugin is disabled/)
	})

	test('an adapter can register its own wire format', () => {
		const custom = defineWireFormat({
			id: 'chariot.weird:wire@1',
			label: 'Weird',
			format: (c) => included(c).map((b) => b.rendered.toUpperCase()),
			overhead: () => 0,
		})
		assert.deepEqual(custom.format(ctx()), ['YOU ARE MIRA.', 'THE PASS IS SNOWED IN.', 'WHERE ARE WE?'])
	})
})

// ── 91 · End to end through the executor ───────────────────────────────────
describe('91 · the Provider formats at the pre-call substrate', () => {
	const allocate = pin(
		describeTaskType({
			id: 'demo:task/allocate@1',
			timeoutMs: 500,
			ports: { out: { main: S.allocated, context: S.allocated } },
		}),
	)
	const wired = pin(
		describeProvider({
			id: 'demo:provider/wired@1',
			shape: S.textGen,
			effects: 'external',
			timeoutMs: 5000,
			slots: {
				connection: { kind: 'connection', shape: S.textGen },
				wire: { kind: 'wire', format: 'core:wire/messages@1' },
			},
			ports: { in: { context: S.allocated }, out: { main: S.text, text: S.text } },
		}),
	)

	const s = () =>
		spec('demo:wire', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.task('alloc', allocate.v1({}))
			.provider('send', ($: any) => wired.v1({ context: $.alloc.context, connection: slot.connection() }))

	const binds = (over: any = {}) =>
		bindings({
			'demo:task/allocate@1': async () => ok({ main: ctx(), context: ctx() }),
			'demo:provider/wired@1': async () => ok({ main: 'ok', text: 'ok' }),
			'demo:provider/tiny@1': async () => ok({ main: 'ok' }),
			...over,
		})

	test('the binding receives the formatted payload, never the blocks', async () => {
		let seen: any
		await run(publish(s()), {
			input: {},
			world,
			bindings: binds({
				'demo:provider/wired@1': async (i: any) => {
					seen = i.context
					return ok({ main: 'ok', text: 'ok' })
				},
			}),
		})
		assert.ok(Array.isArray(seen), 'formatted to a messages array')
		assert.equal(seen[0].role, 'system')
	})

	test('the receipt says which format ran and what the scaffolding cost', async () => {
		const r = await run(publish(s()), { input: {}, world, bindings: binds() })
		assert.match(renderReceipt(r), /wire core:wire\/messages@1: \d+ block \+ \d+ scaffold/)
	})

	test('an over-budget payload is `err`, not a silent trim and not a retry', async () => {
		// A retry would re-invoke Assemble, which is a back-edge the graph cannot show
		// (F9, F25). Over budget means declared overhead is wrong, and that is loud.
		const tiny = pin(
			describeProvider({
				id: 'demo:provider/tiny@1',
				shape: S.textGen,
				effects: 'external',
				timeoutMs: 5000,
				slots: {
					connection: { kind: 'connection', shape: S.textGen },
					wire: { kind: 'wire', format: 'core:wire/chatml@1' },
				},
				ports: { in: { context: S.allocated, budget: S.budget }, out: { main: S.text } },
			}),
		)
		const doc = publish(
			spec('demo:overbudget', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.task('alloc', allocate.v1({}))
				.provider('send', ($: any) =>
					tiny.v1({ context: $.alloc.context, budget: { available: 3 }, connection: slot.connection() }),
				),
		)
		const r = await run(doc, { input: {}, world, bindings: binds() })
		assert.equal(r.outcome, 'err')
		assert.match(String(r.haltReason), /over by \d+/)
		assert.match(String(r.haltReason), /wire format 'core:wire\/chatml@1'/)
	})

	test('the preview shows the formatted payload and the trail behind every block', async () => {
		const r = await run(publish(s()), { input: {}, world, bindings: binds(), preview: true })
		const p = r.preview!
		assert.equal(p.wire!.format, 'core:wire/messages@1')
		assert.ok(p.wire!.overheadTokens > 0)
		assert.equal(p.totals.blocks, 4)
		assert.equal(p.totals.dropped, 1)
		const dropped = p.blocks.find((b) => !b.included)!
		assert.match(dropped.why!.join(' '), /rolled out on seed:abc/)
		const rendered = renderReceipt(r)
		assert.match(rendered, /rolled out on seed:abc/)
		assert.match(rendered, /won its inclusion group/)
		if (process.env.SHOW_WIRE) console.log(rendered)
	})
})

// ── 92 · Migration is not a flag day ───────────────────────────────────────
test('92 · allocated-context is assignable to assembled-context, but not the reverse', () => {
	// So a migrated Assemble connects to an unmigrated Provider while core ports node by
	// node. The reverse is refused because a rendered string has already discarded
	// everything the panel and the budget need.
	assert.equal(assignable(S.allocated, S.assembled), true)
	assert.equal(assignable(S.assembled, S.allocated), false)
})
