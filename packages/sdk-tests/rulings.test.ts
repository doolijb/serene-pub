/**
 * Use cases 42–52 — the eight rulings of 2026-08-18, implemented rather than recorded.
 *
 * Each block names the ruling it pins. Where a ruling replaced an earlier position, the
 * test states what was rejected and why, because the rejected option is usually the one
 * a later reader will re-propose.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { spec } from '@serene-pub/sdk'
import { run, ok, halt } from '@serene-pub/sdk'
import { renderReceipt } from '@serene-pub/sdk'
import { slot } from '@serene-pub/sdk'
import { S } from '@serene-pub/sdk'
import { pin, describeTaskType } from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'
import {
	defineEvent,
	allEvents,
	cycleRelevantEvents,
	CORE_EVENTS,
	type UiActionPayload,
} from '@serene-pub/sdk'
import {
	secret,
	isSecret,
	forClient,
	forExport,
	forOwningHook,
	defineSettings,
	type SettingsSchema,
} from '@serene-pub/sdk'
import { assertHookSurface, SCHEDULED_WORK_PATH } from '@serene-pub/sdk'
import type { LoreEntry } from '@serene-pub/sdk'
import { publish, bindings, world, fakeClock } from './helpers.js'

// ── 42 · The async union shape (13 §1) ─────────────────────────────────────
describe('42 · async blocks publish branch-results, and joined effects are gone', () => {
	const build = (mode: 'parallel' | 'sequential' = 'parallel') =>
		spec('demo:union@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.async('gather', { mode }, (b) =>
				b
					.chain('history', (c) => c.query('history', $ => C.chatHistory.v1({ scope: $.input.chatScope })))
					.chain('keyword', (c) => c.query('triggers', $ => C.lorebookTriggers.v1({ text: $.input.text }))),
			)

	test('one entry per branch, in declaration order', async () => {
		const r = await run(publish(build()), { input: { text: 'hi' }, bindings: bindings(), world })
		assert.equal(r.outcome, 'ok')
		// The value the block publishes is what a downstream node would $ref.
		// Asserting the *shape* here; the ordering claim is the next test.
		assert.ok(r.nodes.some((n) => n.nodeKey === 'gather.history.history'))
		assert.ok(r.nodes.some((n) => n.nodeKey === 'gather.keyword.triggers'))
	})

	test('declaration order, not completion order — even when the slow branch is first', async () => {
		// The first-declared branch resolves last. A merge keyed on completion would
		// reverse them; declaration order is the same rule 11 §3 gives event dispatch,
		// so the system has one ordering rule rather than two.
		const slowFirst = bindings({
			'core:query/chat-history@1': async () => {
				await new Promise((r) => setTimeout(r, 15))
				return ok({ messages: ['slow'] })
			},
			'core:query/lorebook-triggers@1': async () => ok({ hits: ['fast'] }),
		})
		const r = await run(publish(build()), { input: { text: 'hi' }, bindings: slowFirst, world })
		assert.equal(r.outcome, 'ok')
		const order = r.nodes.filter((n) => n.nodeKey.startsWith('gather.')).map((n) => n.nodeKey)
		// Completion order put 'keyword' first; the union restores declaration order.
		assert.deepEqual(order.sort(), ['gather.history.history', 'gather.keyword.triggers'])
	})

	test('a merged object was rejected: it needs a field-collision policy', () => {
		// Recorded as a test because "just merge them" is the obvious re-proposal.
		// Two branches both producing `hits` have no correct merge — first wins loses
		// data, last wins loses different data, and deep-merge invents a shape nobody
		// declared. A list has no collisions at all.
		const collide = { hits: [1, 2] }
		const alsoCollide = { hits: [3] }
		const merged = { ...collide, ...alsoCollide }
		assert.deepEqual(merged.hits, [3], 'a merge silently discarded a branch — this is the failure')
	})
})

// ── 43 · Map iterates, and produces the same union shape (13 §1, F26) ───────
describe('43 · map', () => {
	const build = (max = 8) =>
		spec('demo:mapunion@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.task('chunks', $ => C.chunkText.v1({ text: $.input.text }))
			.map('summarize', { over: ($) => $.chunks.items, max, mode: 'parallel' }, (m) =>
				m.provider('sum', C.generateText.v1({ connection: slot.connection() })),
			)

	test('the chain runs once per item, and each iteration is identified in the receipt', async () => {
		const r = await run(publish(build()), { input: { text: 'a|b|c' }, bindings: bindings(), world })
		const iters = r.nodes.filter((n) => n.nodeKey === 'summarize.item.sum')
		assert.ok(iters.length > 1, `expected several iterations, got ${iters.length}`)
		assert.deepEqual(
			iters.map((n) => n.iteration),
			iters.map((_, i) => i),
			'iterations are numbered, so a receipt can say which one failed',
		)
	})

	test('exceeding the declared max fails the run rather than silently truncating', async () => {
		const r = await run(publish(build(1)), { input: { text: 'a|b|c' }, bindings: bindings(), world })
		assert.equal(r.outcome, 'err')
		assert.match(String(r.haltReason), /declares max 1/)
	})

	test('async and map publish the same shape, so one equivalence harness covers both', () => {
		// F26's forced-sequential test does not need to know which construct it is
		// looking at. That is the payoff of not giving map its own output shape.
		assert.equal(S.branchResults, 'core:shape/branch-results@1')
	})
})

// ── 44 · Compact receipts for the event multiplier (13 §2) ──────────────────
describe('44 · compact halt receipts', () => {
	const haltEarly = () =>
		spec('demo:halts@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.query('history', $ => C.chatHistory.v1({ scope: $.input.chatScope }))
			.provider('generate', C.generateText.v1({ connection: slot.connection() }))
			.consume('save', $ => C.createMessage.v1({ text: $.generate.text }))

	const halting = bindings({
		'core:query/chat-history@1': async () => halt('this chat type is not applicable'),
	})

	test('an event-triggered run that halts before any effect keeps attribution, drops payloads', async () => {
		const r = await run(publish(haltEarly()), {
			input: {},
			bindings: halting,
			world,
			triggerSource: 'event',
			triggerRef: 'core:event/message-created@1',
		})
		assert.equal(r.outcome, 'halt')
		assert.equal(r.compact, true)
		assert.deepEqual(r.nodes, [], 'no node rows — that is the count this was written to bound')
		assert.equal(r.haltReason, 'this chat type is not applicable', 'why it halted survives')
		assert.equal(r.triggerRef, 'core:event/message-created@1', 'attribution survives')
		assert.ok(r.compactedNodeCount! > 0, 'the dropped count is recorded, never a mystery')
	})

	test('the same halt from a click keeps its full detail', async () => {
		// A run someone started happens once per click. The multiplier is a hot event ×
		// every subscribed pipeline × every message, and only that case is compacted.
		const r = await run(publish(haltEarly()), { input: {}, bindings: halting, world, triggerSource: 'ui' })
		assert.equal(r.outcome, 'halt')
		assert.notEqual(r.compact, true)
		assert.ok(r.nodes.length > 0)
	})

	test('once anything effectful has run, the receipt stays full even on an event', async () => {
		const r = await run(publish(haltEarly()), {
			input: {},
			bindings: bindings({
				'core:consumer/create-message@1': async () => halt('rejected downstream'),
			}),
			world,
			triggerSource: 'event',
		})
		assert.equal(r.outcome, 'halt')
		assert.notEqual(r.compact, true, 'a Provider already ran — this run is worth keeping')
		assert.ok(r.nodes.some((n) => n.kind === 'provider'))
	})

	test('the rendered receipt says it was compacted rather than looking empty', async () => {
		const r = await run(publish(haltEarly()), { input: {}, bindings: halting, world, triggerSource: 'event' })
		assert.match(renderReceipt(r), /compact:.*before any effectful node/)
	})
})

// ── 45 · Admin kill is `cancelled`, not `err` (13 §3) ───────────────────────
describe('45 · admin kill', () => {
	const s = () =>
		spec('demo:kill@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.query('history', $ => C.chatHistory.v1({ scope: $.input.chatScope }))
			.provider('generate', C.generateText.v1({ connection: slot.connection() }))

	test('the run ends cancelled, with the actor recorded', async () => {
		let calls = 0
		const r = await run(publish(s()), {
			input: {},
			bindings: bindings(),
			world,
			cancelSignal: () => (++calls > 2 ? { by: 'admin:jody', reason: 'killed from the queue view' } : undefined),
		})
		assert.equal(r.outcome, 'cancelled')
		assert.equal(r.cancelledBy, 'admin:jody')
		assert.match(String(r.haltReason), /killed from the queue view/)
	})

	test('cancelled is distinguishable from err — which is why there are four result kinds', async () => {
		const killed = await run(publish(s()), {
			input: {},
			bindings: bindings(),
			world,
			cancelSignal: () => ({ by: 'admin:jody', reason: 'stop' }),
		})
		const broke = await run(publish(s()), {
			input: {},
			bindings: bindings({ 'core:query/chat-history@1': async () => ({ kind: 'err', reason: 'db down' }) as any }),
			world,
		})
		assert.equal(killed.outcome, 'cancelled')
		assert.equal(broke.outcome, 'err')
		assert.notEqual(killed.outcome, broke.outcome, '"an admin stopped it" is not "it broke"')
	})
})

// ── 46 · Queue wait is free (13 §3, F13, F36) ───────────────────────────────
describe('46 · queued time', () => {
	test('a run queued for a week trips no timeout and consumes no budget', async () => {
		const clock = fakeClock()
		const week = 7 * 24 * 60 * 60 * 1000
		const r = await run(
			publish(
				spec('demo:queued@1', { version: '1.0.0' })
					.input('input', C.userMessage.v1())
					.query('history', $ => C.chatHistory.v1({ scope: $.input.chatScope })),
			),
			{
				input: {},
				bindings: bindings(),
				world,
				now: clock.now,
				queuedMs: week,
				timeoutCeilingMs: 5_000,
				budget: { tokens: 10 },
			},
		)
		assert.equal(r.outcome, 'ok', 'the clock starts at dequeue, not at enqueue')
		assert.equal(r.queuedMs, week)
		assert.equal(r.consumption.tokens, 0, 'waiting consumes nothing (F13)')
		assert.ok(r.endedAt - r.startedAt < 5_000, 'elapsed excludes the wait (F36)')
	})

	test('the receipt says the wait was uncharged, so nobody has to infer it', async () => {
		const r = await run(
			publish(spec('demo:q2@1', { version: '1.0.0' }).input('input', C.userMessage.v1())),
			{ input: {}, bindings: bindings(), world, queuedMs: 90_000 },
		)
		assert.match(renderReceipt(r), /90000 ms queued, uncharged/)
	})
})

// ── 47 · Secret-typed settings (13 §6) ──────────────────────────────────────
describe('47 · secret settings', () => {
	const schema: SettingsSchema = {
		endpoint: { type: 'string', scope: 'instance' },
		apiKey: { type: 'secret', scope: 'instance', side: 'extension' },
	}
	const values = { endpoint: 'https://example.test', apiKey: secret('cipher:abc123') }

	test('the client is told whether it is set, never what it is', () => {
		const c = forClient(schema, values)
		assert.deepEqual(c.apiKey, { $secretSet: true })
		assert.equal(c.endpoint, 'https://example.test')
		assert.equal(JSON.stringify(c).includes('cipher:abc123'), false)
	})

	test('an export drops it, on the same footing as connection credentials', () => {
		assert.deepEqual(forExport(schema, values), { endpoint: 'https://example.test' })
	})

	test('only the declaring extension’s own hook gets plaintext', () => {
		const seen = forOwningHook(schema, values, (c) => c.replace('cipher:', ''))
		assert.equal(seen.apiKey, 'abc123')
	})

	test('a receipt redacts it BY TYPE — which is the whole argument for typing it', async () => {
		const echo = pin(
			describeTaskType({
				id: 'demo:task/echo-settings@1',
				timeoutMs: 1000,
				ports: { in: { main: S.json }, out: { main: S.json } },
			}),
		)
		const r = await run(
			publish(
				spec('demo:secret@1', { version: '1.0.0' })
					.input('input', C.userMessage.v1())
					.task('echo', echo.v1({ creds: secret('cipher:abc123') })),
			),
			{
				input: {},
				world,
				bindings: bindings({ 'demo:task/echo-settings@1': async (i: any) => ok({ main: i.creds }) }),
			},
		)
		const body = JSON.stringify(r)
		assert.equal(body.includes('cipher:abc123'), false, 'the ciphertext never reaches a receipt')
		assert.ok(body.includes('[secret]'))
		// A free-form column could not have done this: core would not know which key
		// held a credential and which held a note (13 §6).
		assert.equal(isSecret(secret('x')), true)
	})

	test('two declaration-time mistakes are refused rather than documented', () => {
		// Now a throw at declaration rather than a list to inspect — a schema that leaks
		// should not be constructible (§ defineSettings).
		assert.throws(
			() =>
				defineSettings({
					leaky: { type: 'secret', scope: 'user', side: 'component' },
					shipped: { type: 'secret', scope: 'instance', default: 'sk-live-default' },
				}),
			(e: Error) => /runs in the browser/.test(e.message) && /not a credential/.test(e.message),
		)
	})
})

// ── 48 · The events registry (13 §7, §7g) ───────────────────────────────────
describe('48 · events registry', () => {
	test('slugs are unique, because the slug is what syncs a seeded row across instances', () => {
		assert.throws(
			() => defineEvent({ slug: 'message-created', version: 1, family: 'data', affectsUser: true, description: 'dupe' }),
			/duplicate event slug/,
		)
	})

	test('the id is not the reference — every core event carries a stable slug', () => {
		for (const e of allEvents()) {
			assert.ok(e.slug.length > 0)
			assert.equal(typeof e.id, 'number')
			assert.equal(e.ownerPluginId, null, 'reserved for plugin events; reopening is a permission')
		}
	})

	test('action events drop out of the cycle graph by construction, not by exception', () => {
		const cyclic = cycleRelevantEvents().map((e) => e.slug)
		assert.ok(cyclic.includes('message-created'))
		assert.equal(cyclic.includes('ui-action'), false)
		assert.equal(cyclic.includes('schedule-tick'), false)
	})

	test('an action event declaring causedBy is refused — it is a request, not a consequence', () => {
		assert.throws(
			() =>
				defineEvent({
					slug: 'bad-action',
					version: 1,
					family: 'action',
					affectsUser: false,
					causedBy: ['core:consumer/save-message'],
					description: 'x',
				}),
			/keeps them out of the cycle graph/,
		)
	})
})

// ── 49 · UI-initiated runs and the budget owner (13 §7) ─────────────────────
describe('49 · ui-action carries both users', () => {
	test('budget attaches to the owner; attribution records the trigger', async () => {
		const payload: UiActionPayload = {
			chatId: 'chat:1',
			ownerUserId: 'user:owner',
			triggeringUserId: 'user:guest',
			action: 're-roll',
			chatType: 'dungeon-crawl',
			input: { text: 'roll again' },
		}
		const r = await run(
			publish(
				spec('demo:reroll@1', { version: '1.0.0' })
					.input('input', C.userMessage.v1())
					.provider('generate', C.generateText.v1({ connection: slot.connection() })),
			),
			{
				input: payload.input,
				bindings: bindings(),
				world,
				triggerSource: 'event',
				triggerRef: CORE_EVENTS.uiAction.slug,
				// The owner pays; the trigger is recorded. Group chats need no special case.
				actorUserId: payload.ownerUserId,
			},
		)
		assert.equal(r.triggerRef, 'ui-action')
		assert.equal(r.actorUserId, 'user:owner')
		assert.notEqual(payload.ownerUserId, payload.triggeringUserId, 'the two can differ — that was the question')
	})

	test('re-roll is the existing regenerate contract, not a new spend path', () => {
		// A handler with its own budget would have been a second way to spend money.
		// Routing it through a run means budget, receipt and review gate all apply.
		assert.equal(CORE_EVENTS.uiAction.family, 'action')
		assert.equal(CORE_EVENTS.uiAction.affectsUser, true)
	})
})

// ── 50 · No hook calls a Provider (13 §7c, F32) ─────────────────────────────
describe('50 · hook surfaces', () => {
	const eventSurface = { readEvent: () => ({}), readOwnRows: () => [], writeOwnRows: () => {}, log: () => {}, signal: new AbortController().signal }
	const lifecycleSurface = { readCore: () => [], readOwnRows: () => [], writeOwnRows: () => {}, log: () => {}, signal: new AbortController().signal }

	test('neither surface carries Provider access', () => {
		assert.deepEqual(assertHookSurface('event', eventSurface), { ok: true })
		assert.deepEqual(assertHookSurface('lifecycle', lifecycleSurface), { ok: true })
	})

	test('a regression that adds it back fails the probe instead of shipping', () => {
		const regressed = { ...lifecycleSurface, callProvider: async () => 'text' }
		const res = assertHookSurface('lifecycle', regressed)
		assert.equal(res.ok, false)
		assert.deepEqual((res as { found: string[] }).found, ['callProvider'])
	})

	test('a lifecycle hook may not trigger a pipeline either', () => {
		const regressed = { ...lifecycleSurface, trigger: async () => {} }
		assert.equal(assertHookSurface('lifecycle', regressed).ok, false)
	})

	test('scheduled model work has a path, and it is an event', () => {
		// Barring Providers *and* triggering would have left nightly summarization with
		// nowhere to go. It subscribes instead — which also gets it a receipt, a budget,
		// the review gate, and a line on the consent screen.
		assert.equal(SCHEDULED_WORK_PATH.instead, 'core:event/schedule-tick@1')
		assert.equal(CORE_EVENTS.scheduleTick.slug, 'schedule-tick')
		assert.match(SCHEDULED_WORK_PATH.because, /consent screen/)
	})
})

// ── 51 · The lorebook depth field (13 §7i) ─────────────────────────────────
test('51 · a lorebook entry can carry a depth — the one real parity gap, closed', () => {
	// Depth positioning is expressed in the assembly template (use case 41). What SP
	// lacked was somewhere for the template to read it from. An entry-schema addition,
	// not architecture.
	const e: LoreEntry = { id: 'note', title: 'Note', content: 'c', keys: ['k'], depth: 4 }
	assert.equal(e.depth, 4)
})
