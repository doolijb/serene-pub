/**
 * Use cases 59–63 — preview runs (debug mode in chat).
 *
 * The claim under test is narrow and is the whole point: **the preview's numbers are the
 * numbers that would have been sent.** Case 60 is the one that matters — it runs the same
 * spec twice, once as a preview and once for real, and asserts the counted payload is
 * identical. Any implementation with a separate "what we would send" estimator passes
 * every other test here and fails that one.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { spec } from '@serene-pub/sdk'
import { run, ok } from '@serene-pub/sdk'
import { renderReceipt } from '@serene-pub/sdk'
import { roughTokens } from '@serene-pub/sdk'
import { slot } from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'
import { publish, bindings, withEmbeddings } from './helpers.js'

const world = withEmbeddings()

/** The canonical retrieval shape: `embed` is a Provider, and it lives inside the block. */
const chat = () =>
	spec('demo:preview@1', { version: '1.0.0' })
		.input('input', C.userMessage.v1())
		.task('budget', C.contextBudget.v1({ connection: slot.downstreamProvider(), params: slot.params() }))
		.async('gather', { mode: 'parallel' }, (b) =>
			b
				.chain('history', (c) => c.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope })))
				.chain('semantic', (c) =>
					c
						.provider('embed', ($) => C.embedText.v1({ text: $.input.text, connection: slot.connection() }))
						.query('vsearch', ($) => C.vectorSearch.v1({ vector: $.gather.semantic.embed.vector })),
				),
		)
		.task('merge', ($) =>
			C.mergeCandidates.v1({ sources: [$.gather.history.history.messages, $.gather.semantic.vsearch.hits] }),
		)
		.task('prompt', ($) => C.assemble.v2({ candidates: $.merge.candidates, budget: $.budget.available }))
		.provider('generate', ($) => C.generateText.v1({ context: $.prompt.context, connection: slot.connection() }))
		.consume('save', ($) => C.createMessage.v1({ text: $.generate.text }))

const input = { text: 'where is my sister', chatScope: { chatId: 'c1' } }

// ── 59 · Where it stops ─────────────────────────────────────────────────────
describe('59 · the preview stops at the first Provider on the spine', () => {
	test('not at `embed`, which is the literally-first Provider', async () => {
		const r = await run(publish(chat()), { input, world, bindings: bindings(), preview: true })
		assert.equal(r.outcome, 'halt')
		assert.equal(r.preview!.atNode, 'generate')
		assert.equal(r.preview!.targetedBy, 'first-provider-on-spine')
		// Stopping at `embed` would have previewed a context that was never retrieved.
		assert.ok(r.nodes.some((n) => n.nodeKey === 'gather.semantic.embed' && n.result === 'ok'))
	})

	test('everything upstream really ran — a preview costs the retrieval it shows', async () => {
		const r = await run(publish(chat()), { input, world, bindings: bindings(), preview: true })
		for (const key of ['budget', 'gather.history.history', 'gather.semantic.vsearch', 'merge', 'prompt']) {
			assert.equal(r.nodes.find((n) => n.nodeKey === key)?.result, 'ok', `${key} should have run`)
		}
	})

	test('nothing downstream ran, and the Provider binding was never invoked', async () => {
		let called = 0
		const r = await run(publish(chat()), {
			input,
			world,
			preview: true,
			bindings: bindings({
				'core:provider/generate-text@1': async () => {
					called++
					return ok({ main: 'x', text: 'x' })
				},
			}),
		})
		assert.equal(called, 0, 'the whole point: nothing is sent')
		assert.equal(r.nodes.find((n) => n.nodeKey === 'save'), undefined)
		assert.equal(r.consumption.tokens, 0)
	})

	test('an explicit target overrides the rule', async () => {
		const r = await run(publish(chat()), {
			input,
			world,
			bindings: bindings(),
			preview: { atNode: 'gather.semantic.embed' },
		})
		assert.equal(r.preview!.atNode, 'gather.semantic.embed')
		assert.equal(r.preview!.targetedBy, 'explicit')
	})
})

// ── 60 · The measurement is the same measurement ────────────────────────────
test('60 · the previewed payload is byte-identical to the one actually sent', async () => {
	let sent: unknown
	const doc = publish(chat())

	const previewed = await run(doc, { input, world, bindings: bindings(), preview: true })
	await run(doc, {
		input,
		world,
		bindings: bindings({
			'core:provider/generate-text@1': async (i: any) => {
				sent = i.context
				return ok({ main: 'reply', text: 'reply' })
			},
		}),
	})

	assert.deepEqual(previewed.preview!.context.rendered, sent, 'same payload, not a parallel estimate')
	assert.equal(previewed.preview!.context.tokens, roughTokens(sent), 'same count')
})

// ── 61 · What the panel gets ────────────────────────────────────────────────
describe('61 · the report', () => {
	test('per-source stats, with included and dropped separated', async () => {
		const r = await run(publish(chat()), { input, world, bindings: bindings(), preview: true })
		const p = r.preview!
		assert.ok(p.blocks.length > 0, 'the allocation record is hoisted, not recomputed')
		assert.equal(p.totals.blocks, p.totals.included + p.totals.dropped)
		assert.ok(p.context.tokens > 0)
	})

	test('a dropped block says why', async () => {
		const r = await run(publish(chat()), { input, world, bindings: bindings(), preview: true })
		for (const b of r.preview!.blocks.filter((x) => !x.included)) {
			assert.ok(b.reason, 'a dropped block with no reason makes the panel not worth opening')
		}
	})

	test('budget and connection metadata are shown; material is not (F18)', async () => {
		const r = await run(publish(chat()), { input, world, bindings: bindings(), preview: true })
		const p = r.preview!
		assert.ok(p.connection?.kind, 'metadata is readable')
		const body = JSON.stringify(p)
		assert.equal(/api[_-]?key|secret|credential|bearer/i.test(body), false, 'no material reaches the preview')
	})

	test('it renders as a panel a human can read', async () => {
		const r = await run(publish(chat()), { input, world, bindings: bindings(), preview: true })
		const out = renderReceipt(r)
		assert.match(out, /preview · stopped before generate/)
		assert.match(out, /would send \d+ tokens/)
		if (process.env.SHOW_PREVIEW) console.log(out)
	})
})

// ── 62 · Over-budget is visible rather than silently truncated ──────────────
test('62 · a payload larger than the available budget is flagged, not hidden', async () => {
	const r = await run(publish(chat()), {
		input,
		world,
		preview: true,
		// A formatted payload far bigger than anything the estimator allowed for: the
		// case where declared overhead was wrong (16 §7). The panel says so rather than
		// letting it surface later as mysterious truncation.
		countTokens: (v) => (typeof v === 'object' && v !== null ? 999_999 : roughTokens(v)),
		bindings: bindings(),
	})
	const p = r.preview!
	assert.ok(p.totals.overBudgetBy && p.totals.overBudgetBy > 0)
	assert.match(renderReceipt(r), /⚠ OVER by/)
})

// ── 63 · A preview receipt is never compacted ───────────────────────────────
test('63 · the preview IS the payload, so compaction can never eat it', async () => {
	const r = await run(publish(chat()), {
		input,
		world,
		bindings: bindings(),
		preview: true,
		// Force the conditions compaction would fire under: an event trigger and a halt.
		triggerSource: 'event',
		compactHaltReceipts: undefined,
	})
	assert.equal(r.outcome, 'halt')
	assert.notEqual(r.compact, true)
	assert.ok(r.preview, 'the report survives')
	assert.ok(r.nodes.length > 0, 'and so do the node rows the panel reads')
})
