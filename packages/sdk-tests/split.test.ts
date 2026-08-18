/**
 * Use cases 104–106 — the rulings taken on 13 §10.
 *
 * 104 · `commitMessage` split into `createMessage` / `updateMessage` (§10b)
 * 105 · a gate-eligible write publishes `write-result@1`, checked at registration
 * 106 · the legacy split migration: recovered where recoverable, reported where not
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
	spec,
	slot,
	describeConsumerTarget,
	S,
	splitCommitMessage,
	unmappedEntries,
	assertReportComplete,
	exportDocument,
	requiredConnections,
	unwiredConnections,
	renderRequirement,
} from '@serene-pub/sdk'
import type { SpecDocument } from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'
import { publish } from './helpers.js'

// ── 104 · Two names, no inference ──────────────────────────────────────────
describe('104 · createMessage and updateMessage are different types', () => {
	test('each declares the event it causes, so the receipt says which happened', () => {
		assert.equal(C.createMessage.descriptor.causesEvent, 'core:event/message-created@1')
		assert.equal(C.updateMessage.descriptor.causesEvent, 'core:event/message-updated@1')
		// The old type had one causesEvent for both behaviours, which is precisely the
		// information the receipt was missing.
		assert.notEqual(C.createMessage.id, C.updateMessage.id)
	})

	test('updateMessage takes an id from outside the run', () => {
		const doc = publish(
			spec('demo:edit', { version: '1.0.0' })
				.input('input', C.messageCreated.v1())
				.consume('save', ($) => C.updateMessage.v1({ target: $.input.messageId, text: 'edited' })),
		)
		assert.equal(doc.nodes.find((n) => n.key === 'save')!.typeId, 'core:consumer/update-message')
	})

	test('a message created in the same run cannot be updated by a second node', () => {
		// Not an oversight: under async review the created row is a proposal, and a
		// proposal a reviewer rejects is a row this update would have edited into
		// existence. write-result@1 is not assignable to row-ids@1, so it fails at
		// publish rather than at 2am.
		assert.throws(
			() =>
				publish(
					spec('demo:create-then-edit', { version: '1.0.0' })
						.input('input', C.userMessage.v1())
						.consume('first', ($) => C.createMessage.v1({ text: $.input.text }))
						.consume('second', ($) => C.updateMessage.v1({ target: $.first.messageId, text: $.input.text })),
				),
			/write-result|row-ids/,
		)
	})
})

// ── 105 · The rule is checked, not reviewed ────────────────────────────────
describe('105 · a gate-eligible write publishes write-result@1', () => {
	test('declaring row-ids on a write is refused at registration, with the failure named', () => {
		assert.throws(
			() =>
				describeConsumerTarget({
					id: 'demo:consumer/bad-write@1',
					effects: 'write',
					ports: { in: { text: S.text }, out: { main: S.rowIds } },
				}),
			(e: Error) => /dangles when the reviewer rejects/.test(e.message),
		)
	})

	test('every core write type obeys it — which three of them did not', () => {
		// This assertion is why the check exists. Hand-maintained, three core Consumers
		// published raw ids while declaring effects: 'write'.
		const offenders = [C.createMessage, C.updateMessage, C.attachImage, C.attachAudio, C.savePluginData]
			.map((t) => t.descriptor)
			.filter((d) => Object.values(d.ports.out ?? {}).some((s) => s === 'core:shape/row-ids@1'))
		assert.deepEqual(offenders, [])
	})

	test('a non-write may still publish row ids', () => {
		const ok = describeConsumerTarget({
			id: 'demo:consumer/emit-only@1',
			effects: 'emit',
			ports: { in: { from: S.json }, out: { main: S.rowIds } },
		})
		assert.equal(ok.effects, 'emit')
	})
})

// ── 106 · Migrating the legacy type ────────────────────────────────────────
describe('106 · splitCommitMessage recovers the decision or refuses to guess', () => {
	const legacy = (over: Partial<SpecDocument['nodes'][number]> = {}, edges: SpecDocument['edges'] = []): SpecDocument => ({
		schemaVersion: 1,
		id: 'legacy:chat-turn',
		version: '1.0.0',
		subscribes: [],
		includes: [],
		presets: [],
		blocks: [],
		nodes: [
			{ key: 'input', kind: 'input', typeId: 'core:input/user-message', typeVersion: 1, config: {}, position: 0 },
			{
				key: 'save',
				kind: 'consumer',
				typeId: 'core:consumer/commit-message',
				typeVersion: 1,
				config: {},
				position: 1,
				...over,
			},
		],
		edges,
	})

	test('nothing supplies an id → create', () => {
		const { document, report } = splitCommitMessage(legacy())
		assert.equal(document.nodes.find((n) => n.key === 'save')!.typeId, 'core:consumer/create-message')
		assert.equal(report.entries[0]!.outcome, 'migrated')
		assert.match(report.entries[0]!.reason!, /only ever created/)
	})

	test('an id wired from outside the run → update, and the port is renamed', () => {
		const { document, report } = splitCommitMessage(
			legacy({}, [{ from: 'input', fromPort: 'rowIds', to: 'save', toPort: 'messageId', shape: 'core:shape/row-ids@1' }]),
		)
		assert.equal(document.nodes.find((n) => n.key === 'save')!.typeId, 'core:consumer/update-message')
		assert.equal(document.edges[0]!.toPort, 'target')
		assert.equal(report.entries[0]!.outcome, 'migrated')
	})

	test('an id from a write in the same run is reported, never converted', () => {
		// Converting this would produce a spec that is wrong in a way nobody can see.
		const { document, report } = splitCommitMessage(
			legacy({}, [
				{ from: 'first', fromPort: 'messageId', to: 'save', toPort: 'messageId', shape: 'core:shape/write-result@1' },
			]),
		)
		assert.equal(document.nodes.find((n) => n.key === 'save')!.typeId, 'core:consumer/commit-message', 'left alone')
		assert.equal(unmappedEntries(report).length, 1)
		assert.match(report.entries[0]!.reason!, /may never exist/)
	})

	test('two id sources is ambiguous, so it is unmapped rather than decided', () => {
		const { report } = splitCommitMessage(
			legacy({ config: { messageId: 'row:7' } }, [
				{ from: 'input', fromPort: 'rowIds', to: 'save', toPort: 'messageId', shape: 'core:shape/row-ids@1' },
			]),
		)
		assert.equal(unmappedEntries(report).length, 1)
		assert.match(report.entries[0]!.reason!, /which one won was a runtime detail/)
	})

	test('every entry carries a reason — no silent drops', () => {
		assertReportComplete(splitCommitMessage(legacy()).report)
	})
})

// ── 107 · Connections an import must wire (13 §10a) ────────────────────────
describe('107 · requiredConnections is derived from types, not from stored rows', () => {
	const doc = () =>
		publish(
			spec('demo:needs-wiring', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope }))
				.provider('embed', ($) => C.embedText.v1({ text: $.input.text, connection: slot.connection() }))
				.task('prompt', ($) => C.assemble.v2({ candidates: $.history.messages }))
				.provider('generate', ($) => C.generateText.v1({ context: $.prompt.context, connection: slot.connection() })),
		)

	test('an export names every connection needed, including ones nobody configured', () => {
		// This is why the answer was not a second table: a table could only report what
		// the exporting instance had filled in, so an unconfigured export would claim to
		// need nothing and the importer would find out at the first run.
		const r = exportDocument(doc(), { presets: 'none' })
		assert.deepEqual(
			r.requires.map((x) => `${x.nodeKey}.${x.slot}`),
			['embed.connection', 'generate.connection'],
		)
	})

	test('each requirement carries the connection kind, so only compatible ones are offered', () => {
		const r = requiredConnections(doc())
		assert.equal(r.find((x) => x.nodeKey === 'embed')!.kind, 'core:shape/embeddings@1')
		assert.equal(r.find((x) => x.nodeKey === 'generate')!.kind, 'core:shape/text-gen@1')
		assert.match(renderRequirement(r[0]!), /needs a core:shape\/embeddings@1 connection/)
	})

	test('what is still unwired drives needs-configuration, not broken', () => {
		const missing = unwiredConnections(doc(), [{ nodeKey: 'embed', slot: 'connection' }])
		assert.deepEqual(missing.map((m) => m.nodeKey), ['generate'])
		// A spec nobody has configured is unfinished, not damaged — the difference decides
		// whether a user files a bug or opens settings.
		assert.equal(unwiredConnections(doc(), missing.concat({ nodeKey: 'embed', slot: 'connection', typeId: '', kind: '' })).length, 0)
	})
})
