/**
 * Use case 95 — the conformance kit, run against the reference implementation.
 *
 * The kit exists for SP Core to run against *its* executor. Running it here is what keeps
 * it honest: a requirement the reference implementation cannot pass is a requirement
 * stated wrong, and it would otherwise be discovered by whoever is porting, months later,
 * with no way to tell whether the kit or their code is at fault.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { spec } from '@serene-pub/sdk'
import { compile, canonicalHash, importDocument } from '@serene-pub/sdk'
import { validate } from '@serene-pub/sdk'
import { run, replay, ok, halt } from '@serene-pub/sdk'
import { slot } from '@serene-pub/sdk'
import { conform, renderConformance, REQUIREMENTS, type HostUnderTest, type Fixtures } from '@serene-pub/conformance'
import * as C from '@serene-pub/contracts'
import { bindings, world } from './helpers.js'

const sdk: HostUnderTest = {
	name: '@serene-pub/sdk reference executor',
	validate,
	run,
	replay,
	canonicalHash,
	importDocument,
}

const fixtures: Fixtures = {
	world,
	// The kit's fixtures decide their own behaviour: `gate` halts (so the halt and
	// compaction requirements have something to observe) and the loop step stays truthy
	// (so the ceiling requirement actually reaches the ceiling).
	bindings: (over = {}) =>
		bindings({
			'test:task/gate@1': async () => halt('this chat type is not applicable'),
			'test:task/passthrough@1': async () => ok({ main: true }),
			...over,
		}),

	chatTurn: () =>
		compile(
			spec('conformance:chat-turn', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope }))
				.task('prompt', ($) => C.assemble.v2({ candidates: $.history.messages }))
				.provider('generate', ($) => C.generateText.v1({ context: $.prompt.context, connection: slot.connection() }))
				.consume('save', ($) => C.createMessage.v1({ text: $.generate.text }))
				.build(),
		),

	haltsEarly: () =>
		compile(
			spec('conformance:halts', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.task('gate', ($) => C.gate.v1({ main: $.input.main }))
				.provider('generate', C.generateText.v1({ connection: slot.connection() }))
				.consume('save', ($) => C.createMessage.v1({ text: $.generate.text }))
				.build(),
		),

	gather: () =>
		compile(
			spec('conformance:gather', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.async('gather', { mode: 'parallel' }, (b) =>
					b
						.chain('history', (c) => c.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope })))
						.chain('keyword', (c) => c.query('triggers', ($) => C.lorebookTriggers.v1({ text: $.input.text })))
						.chain('persona', (c) => c.query('card', ($) => C.personaCard.v1({ characterId: $.input.main }))),
				)
				.build(),
		),

	mapped: () =>
		compile(
			spec('conformance:mapped', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.task('chunks', ($) => C.chunkText.v1({ text: $.input.text }))
				.map('summarize', { over: ($) => $.chunks.items, max: 8 }, (m) =>
					m.provider('sum', C.generateText.v1({ connection: slot.connection() })),
				)
				.build(),
		),

	looped: (max: number) =>
		compile(
			spec('conformance:looped', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.loop('again', { repeatWhile: ($: any) => $.again.item.step.main, max }, (l) =>
					l.task('step', C.passthrough.v1({})),
				)
				.build(),
		),

	invalid: () => [
		{
			law: '01 §2',
			because: 'no Input at all',
			doc: {
				...compile(spec('conformance:noinput', { version: '1.0.0' }).build()),
				nodes: [],
			},
		},
		{
			law: 'F7',
			because: 'two write-class consumers',
			doc: compile(
				spec('conformance:twowrites', { version: '1.0.0' })
					.input('input', C.userMessage.v1())
					.consume('a', C.createMessage.v1({ text: 'x' }))
					.consume('b', C.createMessage.v1({ text: 'y' }))
					.build(),
			),
		},
		{
			law: '01 §4',
			because: 'an unbounded map',
			doc: compile(
				spec('conformance:unbounded', { version: '1.0.0' })
					.input('input', C.userMessage.v1())
					.task('chunks', ($) => C.chunkText.v1({ text: $.input.text }))
					.map('m', { over: ($) => $.chunks.items, max: 0 }, (m) => m.task('t', C.gate.v1({})))
					.build(),
			),
		},
		{
			law: '01 §4a',
			because: 'a loop predicate computed outside its body',
			doc: compile(
				spec('conformance:badloop', { version: '1.0.0' })
					.input('input', C.userMessage.v1())
					.task('outside', C.gate.v1({}))
					.loop('l', { repeatWhile: ($: any) => $.outside.main, max: 4 }, (l) => l.task('t', C.passthrough.v1({})))
					.build(),
			),
		},
		{
			law: 'F8',
			because: 'a node declaring emits',
			doc: (() => {
				const d = compile(
					spec('conformance:emits', { version: '1.0.0' })
						.input('input', C.userMessage.v1())
						.task('t', C.gate.v1({}))
						.build(),
				)
				d.nodes[1]!.config = { ...d.nodes[1]!.config, emits: 'core:event/anything@1' }
				return d
			})(),
		},
	],
}

test('95 · the reference implementation passes its own conformance kit', async () => {
	const results = await conform(sdk, fixtures)
	const failed = results.filter((r) => !r.pass)
	assert.deepEqual(failed, [], renderConformance(results))
	assert.equal(results.length, REQUIREMENTS.length)
	if (process.env.SHOW_CONFORMANCE) console.log(renderConformance(results))
})

test('95a · every requirement says what breaks, not just which law', async () => {
	// A red line reading "F13" tells an implementer nothing about where to look. The
	// consequence is the part that makes a failure actionable at 2am during a port.
	for (const r of REQUIREMENTS) {
		assert.ok(r.consequence.length > 40, `${r.id} has no usable consequence`)
		assert.ok(r.law.length > 0)
	}
})

test('95b · a host that gets a law wrong fails the kit, loudly', async () => {
	// Proves the kit has teeth. A host whose halt is an error passes nothing that
	// depends on halt being success.
	const brokenHalt: HostUnderTest = {
		...sdk,
		run: async (doc, opts) => {
			const r = await run(doc, opts)
			return r.outcome === 'halt' ? { ...r, outcome: 'err' } : r
		},
	}
	const results = await conform(brokenHalt, fixtures)
	const c3 = results.find((r) => r.id === 'C3')!
	assert.equal(c3.pass, false)
	assert.match(c3.consequence!, /counted as an error/)
})
