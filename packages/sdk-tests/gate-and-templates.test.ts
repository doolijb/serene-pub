/**
 * Use cases 25–34 — the review gate and template variable awareness.
 *
 * These were built last because the docs said they were the two places design and
 * implementation were most likely to disagree. Two disagreements were found; both are
 * recorded in the README and in the assertions below.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { spec } from '@serene-pub/sdk'
import { run, ok } from '@serene-pub/sdk'
import { renderReceipt } from '@serene-pub/sdk'
import { hashPayload, resolvePosition, isGated, POSITIONS } from '@serene-pub/sdk'
import type { Reviewer } from '@serene-pub/sdk'
import { extractRefs, render, checkTemplate } from '@serene-pub/sdk'
import { slot } from '@serene-pub/sdk'
import { pin, describeConsumerTarget } from '@serene-pub/sdk'
import { S } from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'
import { publish, bindings, world, fakeClock, findings } from './helpers.js'

const approver: Reviewer = async () => ({ action: 'approve', by: 'jody', at: 1 })
const rejecter: Reviewer = async () => ({ action: 'reject', by: 'jody', at: 1 })
const editor = (payload: unknown): Reviewer => async () => ({ action: 'edit', payload, by: 'jody', at: 1 })

const gated = () =>
	spec('demo:gate@1', { version: '1.0.0' })
		.input('input', C.userMessage.v1())
		.provider('generate', C.generateText.v1({ connection: slot.connection() }))
		.consume('save', $ => C.createMessage.v1({ text: $.generate.text }))

const reviewOff = { ...world, overrides: [{ nodeKey: 'save', slot: 'settings', path: 'review', value: 'off', scopeKind: 'user' as const }] }
const reviewSync = { ...world, overrides: [{ nodeKey: 'save', slot: 'settings', path: 'review', value: 'sync', scopeKind: 'user' as const }] }
const reviewAsync = { ...world, overrides: [{ nodeKey: 'save', slot: 'settings', path: 'review', value: 'async', scopeKind: 'user' as const }] }

// ── 25 · off commits straight through ───────────────────────────────────────
test('25 · review off invokes the binding directly', async () => {
	let invoked = 0
	const r = await run(publish(gated()), {
		input: {},
		world: reviewOff,
		bindings: bindings({
			'core:consumer/create-message@1': async (_i, ctx: any) => {
				invoked++
				return ok({ main: (await ctx.commit({})).id })
			},
		}),
	})
	assert.equal(r.outcome, 'ok')
	assert.equal(invoked, 1)
})

// ── 26 · sync parks; the binding is provably not invoked before approval ────
describe('26 · sync parks before the binding runs', () => {
	test('the binding is not invoked until the reviewer resolves', async () => {
		const order: string[] = []
		const r = await run(publish(gated()), {
			input: {},
			world: reviewSync,
			reviewer: async (req) => {
				order.push(`review:${req.nodeKey}`)
				return { action: 'approve', by: 'jody', at: 1 }
			},
			bindings: bindings({
				'core:consumer/create-message@1': async (_i, ctx: any) => {
					order.push('binding')
					return ok({ main: (await ctx.commit({})).id })
				},
			}),
		})
		assert.equal(r.outcome, 'ok')
		assert.deepEqual(order, ['review:save', 'binding'], 'review must precede the binding')
	})

	test('a rejection halts the run — it is not an error', async () => {
		const r = await run(publish(gated()), {
			input: {},
			world: reviewSync,
			reviewer: rejecter,
			bindings: bindings(),
		})
		assert.equal(r.outcome, 'halt')
		assert.match(r.haltReason ?? r.nodes.at(-1)!.reason!, /rejected at review/)
	})

	test('parking is free — a week at the gate trips no timeout (F13, F36)', async () => {
		const clock = fakeClock()
		const r = await run(publish(gated()), {
			input: {},
			world: reviewSync,
			now: clock.now,
			reviewer: async () => {
				clock.advance(1000 * 60 * 60 * 24 * 7)
				return { action: 'approve', by: 'jody', at: 1 }
			},
			bindings: bindings(),
		})
		assert.equal(r.outcome, 'ok')
		assert.equal(r.nodes.find((n) => n.nodeKey === 'save')!.timedOut, undefined)
	})
})

// ── 27 · the binding cannot tell an edit from an approval (F14) ─────────────
test('27 · an edited payload is indistinguishable to the binding', async () => {
	const seen: unknown[] = []
	const capture = bindings({
		'core:consumer/create-message@1': async (i: any, ctx: any) => {
			seen.push({ ...i })
			return ok({ main: (await ctx.commit({})).id })
		},
	})

	await run(publish(gated()), { input: {}, world: reviewSync, reviewer: approver, bindings: capture })
	await run(publish(gated()), {
		input: {},
		world: reviewSync,
		reviewer: editor({ text: 'a human rewrote this' }),
		bindings: capture,
	})

	const [approved, edited] = seen as any[]
	assert.equal(approved.text, 'the reply text')
	assert.equal(edited.text, 'a human rewrote this')
	// No marker distinguishes them — same keys, no provenance flag reaches the binding.
	assert.deepEqual(Object.keys(approved).sort(), Object.keys(edited).sort())
	for (const k of Object.keys(edited)) assert.ok(!/review|approved|edited|gate/i.test(k))
})

// ── 28 · authors may default review on; forbidding is inexpressible ─────────
describe('28 · author defaults, user overrides', () => {
	test("an author's sync default applies with no user setting", async () => {
		const doc = publish(
			spec('demo:authordefault@1', { version: '1.0.0' })
				.input('input', C.messageCreated.v1())
				.provider('render', C.renderImage.v1({ connection: slot.connection() }))
				.consume('attach', $ => C.attachImage.v1({ image: $.render.image })),
		)
		let reviewed = false
		await run(doc, {
			input: {},
			world,
			reviewer: async () => {
				reviewed = true
				return { action: 'approve', by: 'jody', at: 1 }
			},
			bindings: bindings(),
		})
		assert.ok(reviewed, 'attachImage declares reviewDefault: sync')
	})

	test('the user can turn it off — the author cannot prevent that', () => {
		assert.equal(resolvePosition('sync', 'off'), 'off')
		assert.equal(resolvePosition('sync', undefined), 'sync')
	})

	test('there is no position that forbids review (F14)', () => {
		assert.deepEqual([...POSITIONS], ['off', 'async', 'sync'])
		assert.ok(!(POSITIONS as readonly string[]).includes('never'))
	})

	test('the gate keys on effects, not on kind — an effectful Provider gates too', () => {
		assert.equal(isGated('write'), true)
		assert.equal(isGated('external'), true) // an MCP tool that sends mail (14 §4a)
		assert.equal(isGated('emit'), false)
		assert.equal(isGated('none'), false)
	})
})

// ── 29 · decisions enter the receipt (F15) ──────────────────────────────────
test('29 · the receipt records the decision, both hashes and who', async () => {
	const r = await run(publish(gated()), {
		input: {},
		world: reviewSync,
		reviewer: editor({ text: 'edited' }),
		bindings: bindings(),
	})
	const rec = r.reviews!.find((x) => x.nodeKey === 'save')!
	assert.equal(rec.position, 'sync')
	assert.equal(rec.action, 'edit')
	assert.equal(rec.by, 'jody')
	assert.notEqual(rec.originalHash, rec.editedHash)
	assert.equal(rec.editedHash, hashPayload({ text: 'edited' }))
	assert.match(renderReceipt(r), /review save: sync → edit \(edited/)
})

// ── 30 · async proposes and does not block — and one real finding ───────────
describe('30 · async review', () => {
	test('the run continues without invoking the binding', async () => {
		let invoked = 0
		const r = await run(publish(gated()), {
			input: {},
			world: reviewAsync,
			reviewer: approver,
			bindings: bindings({
				'core:consumer/create-message@1': async () => {
					invoked++
					return ok({ main: 'x' })
				},
			}),
		})
		assert.equal(r.outcome, 'ok', 'the run does not block')
		assert.equal(invoked, 0, 'the write lands pending; the binding has not run')
		assert.equal(r.reviews!.find((x) => x.nodeKey === 'save')!.action, 'proposed')
	})

	/**
	 * RULED (13 §7j-b) — the finding this test opened is now closed. A gate-eligible
	 * write publishes a **discriminated** result, so `pending` and `committed` are the
	 * same shape and a downstream node cannot mistake one for the other.
	 *
	 * The rejected alternative was a shared id space. Under it a proposal id is
	 * indistinguishable from a row id right up until the reviewer rejects it and the
	 * foreign key dangles — a failure that surfaces long after the run it came from.
	 */
	const downstreamSpec = () =>
		spec('demo:asyncdownstream@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.provider('generate', C.generateText.v1({ connection: slot.connection() }))
			.consume('save', $ => C.createMessage.v1({ text: $.generate.text }))
			.consume('done', $ => C.emitSocket.v1({ handle: 'chat:complete', from: $.save.messageId }))

	const sawFrom = async (world: any) => {
		let seen: any
		await run(publish(downstreamSpec()), {
			input: {},
			world,
			reviewer: approver,
			bindings: bindings({
				'core:consumer/emit-socket@1': async (i: any) => {
					seen = i.from
					return ok({ main: 'emitted' })
				},
			}),
		})
		return seen
	}

	test('under async review downstream receives status:pending, never a bare id', async () => {
		const seen = await sawFrom(reviewAsync)
		assert.equal(seen.status, 'pending')
		assert.match(String(seen.proposalId), /^proposal:/)
		assert.equal(seen.ids, undefined, 'there are no ids yet — that is the point')
	})

	test('with the gate off the same port carries status:committed and the ids', async () => {
		const seen = await sawFrom(undefined)
		assert.equal(seen.status, 'committed')
		assert.ok(seen.ids, 'committed carries ids; pending does not')
	})

	test('the two cases are one shape, so a hook that handles both cannot be surprised', async () => {
		const pending = await sawFrom(reviewAsync)
		const committed = await sawFrom(undefined)
		// A hook discriminates on one field it is guaranteed to have. There is no branch
		// node to do this in the spec (F25), which is why the obligation is the type's.
		for (const w of [pending, committed]) {
			assert.ok(w.status === 'pending' || w.status === 'committed')
		}
	})

	test('a downstream port typed row-ids@1 is a publish error that names the fix', () => {
		const badConsumer = pin(
			describeConsumerTarget({
				id: 'demo:consumer/wants-raw-ids@1',
				effects: 'emit',
				timeoutMs: 1000,
				ports: { in: { from: S.rowIds }, out: { main: S.json } },
			}),
		)
		const findingList = findings(
			spec('demo:rawids@1', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.provider('generate', C.generateText.v1({ connection: slot.connection() }))
				.consume('save', $ => C.createMessage.v1({ text: $.generate.text }))
				.consume('done', $ => badConsumer.v1({ from: $.save.messageId })),
		)
		const e = findingList.find((x) => x.law === '13 §7j-b')
		assert.ok(e, 'the write-result mismatch is caught at publish, not at runtime')
		assert.match(e!.fix, /write-result@1/)
		assert.match(e!.fix, /dangles/, 'the fix says why, not just what')
	})
})

// ── 30a · ⚠ FINDING: gate-eligible is not the same as gated ────────────────
describe('30a · an unclassified external tool is gate-eligible but ungated', () => {
	/**
	 * 14 §4 says every MCP tool is "effectful by default" and the admin classifies it.
	 * `effects: 'external'` delivers the first half — the node is gate-*eligible*. But the
	 * review *position* is a separate setting, and with no author default and no admin
	 * setting it resolves to 'off'.
	 *
	 * So a freshly-snapshotted MCP tool that sends mail runs unreviewed until someone
	 * classifies it. "Effectful by default" and "reviewed by default" are different
	 * claims, and the design currently only makes the first.
	 */
	const mcp = () =>
		spec('demo:mcp-gate@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.provider('tool', C.mcpTool.v1({ args: { to: 'someone@example.com' }, connection: slot.connection() }))

	test('it is eligible', () => {
		assert.equal(isGated(C.mcpTool.v1().descriptor.effects), true)
	})

	test('but with no classification it runs unreviewed', async () => {
		let called = 0
		const r = await run(publish(mcp()), {
			input: {},
			world,
			bindings: bindings({
				'core:provider/mcp-tool@1': async (_i, ctx: any) => {
					called++
					ctx.reportUsage(1)
					return ok({ main: {}, result: {} })
				},
			}),
		})
		assert.equal(r.outcome, 'ok')
		assert.equal(called, 1, 'no reviewer was consulted')
		assert.equal(r.reviews!.find((x) => x.nodeKey === 'tool')!.position, 'off')
	})

	test('the fix is one descriptor field on the snapshot, not new machinery', async () => {
		const r = await run(publish(mcp()), {
			input: {},
			bindings: bindings(),
			reviewer: async () => ({ action: 'approve', by: 'admin', at: 1 }),
			world: {
				...world,
				// what an MCP snapshot should write until an admin marks the tool read-only
				overrides: [{ nodeKey: 'tool', slot: 'settings', path: 'review', value: 'sync', scopeKind: 'instance' as const }],
			},
		})
		assert.equal(r.reviews!.find((x) => x.nodeKey === 'tool')!.position, 'sync')
	})
})

// ── 31 · templates render ───────────────────────────────────────────────────
test('31 · a source template renders one item, an assembly template renders blocks', () => {
	const source = '### {{ entry.title }}\n{{ entry.content }}'
	assert.equal(
		render(source, { entry: { title: 'Mira', content: 'an elf' } }),
		'### Mira\nan elf',
	)

	const assembly = '{{ prompts.system }}\n{% for b in blocks %}[{{ b.sourceKey }}]{% endfor %}'
	assert.equal(
		render(assembly, { prompts: { system: 'be terse' }, blocks: [{ sourceKey: 'lore' }, { sourceKey: 'history' }] }),
		'be terse\n[lore][history]',
	)
})

// ── 32 · an unknown variable is caught, and the error lists what exists ─────
describe('32 · variable awareness', () => {
	const scope = { entry: ['title', 'content', 'keys'] as string[] }

	test('a valid reference passes', () => {
		assert.deepEqual(checkTemplate('{{ entry.title }}', scope), [])
	})

	test('an unknown root names the available variables', () => {
		const f = checkTemplate('{{ character.name }}', scope)
		assert.equal(f.length, 1)
		assert.equal(f[0]!.severity, 'error')
		assert.match(f[0]!.message, /'character' is not available/)
		assert.match(f[0]!.fix, /available here: entry/)
	})

	test('an unknown field names the fields that exist', () => {
		const f = checkTemplate('{{ entry.nope }}', scope)
		assert.equal(f.length, 1)
		assert.match(f[0]!.fix, /title, content, keys/)
	})

	test('loop-bound names are not reported as unknown', () => {
		assert.deepEqual(checkTemplate('{% for e in entry %}{{ e.title }}{% endfor %}', scope), [])
	})

	test('dynamic access warns rather than blocking — verification is scoped honestly', () => {
		const f = checkTemplate('{{ entry[key] }}', scope)
		assert.equal(f.length, 1)
		assert.equal(f[0]!.severity, 'warning')
		assert.match(f[0]!.fix, /top-level references only/)
	})
})

// ── 33 · refs are extracted from both expressions and loops ─────────────────
test('33 · extraction finds loop sources and expressions', () => {
	const refs = extractRefs('{% for b in blocks.items %}{{ b.text }}{{ budget.remaining }}{% endfor %}')
	assert.deepEqual(
		refs.map((r) => `${r.root}${r.bound ? '(bound)' : ''}`).sort(),
		['b(bound)', 'blocks', 'budget'],
	)
})

// ── 34 · the correction: scope comes from the slot, not the port ────────────
test('34 · template scope is declared on the slot — typed ports alone cannot supply it', () => {
	const trigger = C.lorebookTriggers.v1().descriptor
	const asm = C.assemble.v2().descriptor

	// A source template's scope is the *item*, which lives inside the port payload.
	assert.deepEqual(trigger.slots!['template']!.variables, { entry: ['title', 'content', 'keys'] })
	assert.equal(trigger.ports.out!['hits'], 'core:shape/context-candidates@1')

	// An assembly template's scope does correspond to its inputs — so 16 §4 is half right.
	assert.ok(asm.slots!['template']!.variables!['blocks'])
	assert.ok(asm.slots!['template']!.variables!['budget'])

	// The point: knowing the port shape tells you nothing about `entry.title`.
	const f = checkTemplate('{{ entry.title }}', {})
	assert.equal(f[0]!.severity, 'error')
})
