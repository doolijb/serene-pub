/**
 * Use cases 52–58 — the typed chain scope.
 *
 * The question this answers: do we have to use `$ref` with strings? No. And the test
 * that matters most is 52, because the whole proposal is only acceptable if the
 * compiled document is *unchanged* — F6 says SP imports documents and never authoring
 * JS, so nicer authoring must be provably invisible downstream.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { spec } from '@serene-pub/sdk'
import { compile, canonicalHash } from '@serene-pub/sdk'
import { run, ok } from '@serene-pub/sdk'
import { $ref, slot } from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'
import { publish, bindings, world } from './helpers.js'

// ── 52 · The two forms compile to the same document ─────────────────────────
describe('52 · scope sugar is invisible downstream (F3, F6)', () => {
	const withStrings = () =>
		spec('demo:chat@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.query('history', C.chatHistory.v1({ scope: $ref('input', 'chatScope') }))
			.task('prompt', C.assemble.v2({ candidates: $ref('history', 'messages') }))
			.provider('generate', C.generateText.v1({ connection: slot.connection() }))
			.consume('save', C.createMessage.v1({ text: $ref('generate', 'text') }))

	const withScope = () =>
		spec('demo:chat@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope }))
			.task('prompt', ($) => C.assemble.v2({ candidates: $.history.messages }))
			.provider('generate', () => C.generateText.v1({ connection: slot.connection() }))
			.consume('save', ($) => C.createMessage.v1({ text: $.generate.text }))

	test('identical canonical hash — the rows are the same rows', () => {
		assert.equal(canonicalHash(compile(withStrings().build())), canonicalHash(compile(withScope().build())))
	})

	test('identical edges, ports and all', () => {
		const a = compile(withStrings().build()).edges
		const b = compile(withScope().build()).edges
		assert.deepEqual(b, a)
	})

	test('a scope ref serializes as a plain $ref — no proxy escapes into storage', () => {
		const doc = compile(withScope().build())
		const cfg = doc.nodes.find((n) => n.key === 'history')!.config
		assert.deepEqual(JSON.parse(JSON.stringify(cfg)), {
			scope: { __ref: 'data', node: 'input', port: 'chatScope' },
		})
	})

	test('and it still runs', async () => {
		const r = await run(publish(withScope()), { input: { text: 'hi' }, bindings: bindings(), world })
		assert.equal(r.outcome, 'ok')
		assert.deepEqual(
			r.nodes.map((n) => n.nodeKey),
			['input', 'history', 'prompt', 'generate', 'save'],
		)
	})
})

// ── 53 · The node accessor is itself a ref to `main` ────────────────────────
test('53 · `$.history` means main; `$.history.messages` refines the port', () => {
	const b = spec('demo:bare@1', { version: '1.0.0' })
		.input('input', C.userMessage.v1())
		.query('history', ($) => C.chatHistory.v1({ scope: $.input }))
		.task('prompt', ($) => C.assemble.v2({ candidates: $.history.messages }))
	const doc = compile(b.build())
	const bare = doc.edges.find((e) => e.to === 'history' && !e.implicit)!
	assert.equal(bare.fromPort, 'main', 'a bare accessor is the main port')
	const refined = doc.edges.find((e) => e.to === 'prompt' && !e.implicit)!
	assert.equal(refined.fromPort, 'messages')
})

// ── 54 · A forward reference cannot be written ──────────────────────────────
describe('54 · no back-edges, enforced at the call site (F9)', () => {
	test('referencing a node declared later throws, and lists what exists', () => {
		assert.throws(
			() =>
				spec('demo:forward@1', { version: '1.0.0' })
					.input('input', C.userMessage.v1())
					// `generate` is declared *below* — under the old string form this was a
					// publish-time finding; here the scope simply does not contain it.
					.query('history', ($: any) => C.chatHistory.v1({ scope: $.generate.text }))
					.provider('generate', () => C.generateText.v1({ connection: slot.connection() })),
			/is not a node declared before this point/,
		)
	})

	test('the message names the available nodes rather than only the missing one', () => {
		try {
			spec('demo:forward2@1', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.query('history', ($: any) => C.chatHistory.v1({ scope: $.nope.thing }))
			assert.fail('should have thrown')
		} catch (e) {
			assert.match((e as Error).message, /Available: input/)
			assert.match((e as Error).message, /no back-edges/)
		}
	})

	test('an empty scope says the Input comes first', () => {
		try {
			spec('demo:empty@1', { version: '1.0.0' }).input('input', C.userMessage.v1())
			// A ref inside the Input itself has nothing to point at.
			spec('demo:empty2@1', { version: '1.0.0' }).query('q', ($: any) => C.chatHistory.v1({ scope: $.x.y }))
			assert.fail('should have thrown')
		} catch (e) {
			assert.match((e as Error).message, /Input comes first/)
		}
	})
})

// ── 55 · Ports are flat, and refining twice says so ─────────────────────────
test('55 · `$.a.b.c` is refused with the reason, not a confusing ref', () => {
	assert.throws(
		() =>
			spec('demo:deep@1', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.query('history', ($: any) => C.chatHistory.v1({ scope: $.input.chatScope.deeper })),
		/ports are flat/,
	)
})

// ── 56 · Inside a block, siblings are named by their short key ──────────────
describe('56 · block chains', () => {
	const built = () =>
		spec('demo:blockscope@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.async('gather', { mode: 'parallel' }, (b) =>
				b
					.chain('history', (c) => c.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope })))
					.chain('semantic', (c) =>
						c
							.provider('embed', ($) => C.embedText.v1({ text: $.input.text, connection: slot.connection() }))
							// `$.embed` — the sibling, by its short key.
							.query('vsearch', ($: any) => C.vectorSearch.v1({ vector: $.embed.vector })),
					),
			)
			.task('merge', ($: any) =>
				C.mergeCandidates.v1({
					// From outside, the qualified path — which reads like the key it is.
					sources: [$.gather.semantic.vsearch.hits, $.gather.history.history.messages],
				}),
			)

	test('a sibling resolves to the fully qualified key', () => {
		const doc = compile(built().build())
		const e = doc.edges.find((x) => x.to === 'gather.semantic.vsearch' && !x.implicit)!
		assert.equal(e.from, 'gather.semantic.embed')
		assert.equal(e.fromPort, 'vector')
	})

	test('from the spine, the block path reads like the key', () => {
		const doc = compile(built().build())
		const froms = doc.edges.filter((x) => x.to === 'merge' && !x.implicit).map((x) => `${x.from}.${x.fromPort}`)
		assert.deepEqual(froms.sort(), [
			'gather.history.history.messages',
			'gather.semantic.vsearch.hits',
		])
	})

	test('it matches what the string form produced, edge for edge', () => {
		const strung = spec('demo:blockscope@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.async('gather', { mode: 'parallel' }, (b) =>
				b
					.chain('history', (c) => c.query('history', C.chatHistory.v1({ scope: $ref('input', 'chatScope') })))
					.chain('semantic', (c) =>
						c
							.provider('embed', C.embedText.v1({ text: $ref('input', 'text'), connection: slot.connection() }))
							.query('vsearch', C.vectorSearch.v1({ vector: $ref('gather.semantic.embed', 'vector') })),
					),
			)
			.task('merge', C.mergeCandidates.v1({
				sources: [$ref('gather.semantic.vsearch', 'hits'), $ref('gather.history.history', 'messages')],
			}))
		assert.equal(canonicalHash(compile(strung.build())), canonicalHash(compile(built().build())))
	})
})

// ── 57 · map: `over` takes the scope, and `$item` needs no block key ────────
describe('57 · map', () => {
	const built = () =>
		spec('demo:mapscope@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.task('chunks', ($) => C.chunkText.v1({ text: $.input.text }))
			.map('summarize', { over: ($) => $.chunks.items, max: 64 }, (m) =>
				m.provider('sum', ($: any) => C.generateText.v1({ text: $.$item, connection: slot.connection() })),
			)
			.task('collect', ($: any) => C.toCandidates.v1({ items: $.summarize.values }))

	test('`over` resolves through the scope', () => {
		const b = built().build()
		assert.deepEqual(b.blocks.find((x) => x.id === 'summarize')!.over, {
			__ref: 'data',
			node: 'chunks',
			port: 'items',
		})
	})

	test('`$.$item` addresses the current item without naming the block', () => {
		const doc = compile(built().build())
		const e = doc.edges.find((x) => x.to === 'summarize.item.sum' && x.toPort === 'text')!
		assert.equal(e.from, 'summarize.$item')
	})

	test('it runs, once per item', async () => {
		const r = await run(publish(built()), { input: { text: 'a|b|c' }, bindings: bindings(), world })
		assert.equal(r.outcome, 'ok')
		assert.equal(r.nodes.filter((n) => n.nodeKey === 'summarize.item.sum').length, 3)
	})
})

// ── 58 · Config references take a node accessor too ─────────────────────────
test('58 · slot.connectionOf($.generate) — a node is never named twice, two ways', () => {
	const b = spec('demo:slotref@1', { version: '1.0.0' })
		.input('input', C.userMessage.v1())
		.provider('generate', () => C.generateText.v1({ connection: slot.connection() }))
		.task('budget', ($: any) => C.contextBudget.v1({ connection: slot.connectionOf($.generate) }))
	const doc = compile(b.build())
	assert.equal(doc.nodes.find((n) => n.key === 'budget')!.resolvedRefs!['connection'], 'generate')

	// A config reference is still not a data edge (F35) — the sugar did not change that.
	assert.equal(
		doc.edges.some((e) => e.to === 'budget' && !e.implicit),
		false,
	)
})
