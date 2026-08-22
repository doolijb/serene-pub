/**
 * Use case 108 — the type registry and install-time validation (13 §10c).
 *
 * The question this answers for SP Core: *can I decide whether a plugin is installable
 * without executing it?* F6 says core imports documents and never authoring JS, so the
 * answer has to be yes from data alone — the manifest and the documents beside it.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
	spec,
	slot,
	snapshotRegistry,
	checkInstall,
	installable,
	renderInstall,
	allTypes,
	pipelineHook,
	ok,
} from '@serene-pub/sdk'
import type { RegistryEntry, SpecDocument } from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'
import { publish } from './helpers.js'

const coreRegistry = (): RegistryEntry[] => snapshotRegistry(allTypes(), { release: '0.6.0' })

const doc = (): SpecDocument =>
	publish(
		spec('chariot.dice-tray:turn', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope }))
			.task('prompt', ($) => C.assemble.v2({ candidates: $.history.messages }))
			.provider('generate', ($) => C.generateText.v1({ context: $.prompt.context, connection: slot.connection() })),
	)

describe('108 · checkInstall decides from data alone', () => {
	test('a plugin built against this release installs', () => {
		const f = checkInstall({ declares: [], documents: [doc()], registry: coreRegistry() })
		assert.equal(installable(f), true, renderInstall(f))
	})

	test('a pin this instance does not have names the version it does have', () => {
		const registry = coreRegistry().filter((r) => !(r.id === 'core:task/assemble' && r.version === 2))
		registry.push({ ...snapshotRegistry([C.assemble.descriptor])[0]!, version: 3 })
		const f = checkInstall({ declares: [], documents: [doc()], registry })
		const e = f.find((x) => x.code === 'E_UNKNOWN_TYPE')!
		assert.ok(e)
		assert.match(e.fix, /this instance has core:task\/assemble@3/)
		// Re-pinning silently would be the tempting fix and the wrong one: a pin that
		// resolves differently on each instance is not a pin.
		assert.match(e.fix, /rebuilt against this release/)
	})

	test('shape drift is caught even though every id still resolves', () => {
		// The failure a version number alone misses: the plugin was built when
		// chat-history published something else, so nothing looks wrong until the value
		// reaches a node that cannot read it.
		const stale = doc()
		stale.edges = stale.edges.map((e) =>
			e.from === 'history' ? { ...e, shape: 'core:shape/text@1' } : e,
		)
		const f = checkInstall({ declares: [], documents: [stale], registry: coreRegistry() })
		const e = f.find((x) => x.code === 'E_SHAPE_DRIFT')!
		assert.ok(e, renderInstall(f))
		assert.match(e.message, /compiled against core:shape\/text@1/)
		assert.equal(installable(f), false)
	})

	test('a plugin cannot redeclare a type it does not own', () => {
		const f = checkInstall({
			declares: [{ id: 'core:task/assemble@2' }],
			documents: [],
			registry: coreRegistry(),
			owner: 'chariot.dice-tray',
		})
		const e = f.find((x) => x.code === 'E_REDECLARES_CORE')!
		assert.ok(e)
		assert.match(e.fix, /an update cannot tell which rows are its own/)
	})

	test("someone else's private type is refused, with who to ask", () => {
		const registry = coreRegistry().concat({
			id: 'other.plugin:secret-sauce',
			version: 1,
			kind: 'task',
			ports: { in: {}, out: { main: 'core:shape/json@1' } },
			slots: {},
			owner: 'other.plugin',
			public: false,
		})
		const d = doc()
		d.nodes.push({
			key: 'borrowed',
			kind: 'task',
			typeId: 'other.plugin:secret-sauce',
			typeVersion: 1,
			config: {},
			position: 9,
		})
		const f = checkInstall({ declares: [], documents: [d], registry, owner: 'chariot.dice-tray' })
		const e = f.find((x) => x.code === 'E_PRIVATE_TYPE')!
		assert.ok(e, renderInstall(f))
		assert.match(e.fix, /ask 'other.plugin'/)
	})

	test('a newer version is a warning, not a failure — that is what pinning is for', () => {
		const registry = coreRegistry().concat({
			...snapshotRegistry([C.assemble.descriptor])[0]!,
			version: 9,
		})
		const f = checkInstall({ declares: [], documents: [doc()], registry })
		const w = f.find((x) => x.code === 'W_NEWER_VERSION')!
		assert.ok(w)
		assert.equal(w.severity, 'warning')
		assert.equal(installable(f), true)
	})

	test('a declared type with no binding is refused before a user can add it to a pipeline', () => {
		const f = checkInstall({
			declares: [{ id: 'chariot.dice-tray:roll@1' }],
			documents: [],
			registry: coreRegistry(),
			bound: [],
			owner: 'chariot.dice-tray',
		})
		const e = f.find((x) => x.code === 'E_MISSING_BINDING')!
		assert.ok(e)
		assert.match(e.fix, /fails at run time/)
	})

	test('every finding names a fix — an admin did not write this plugin', () => {
		const f = checkInstall({
			declares: [{ id: 'core:task/assemble@2' }],
			documents: [doc()],
			registry: coreRegistry().filter((r) => r.id !== 'core:query/chat-history'),
			owner: 'x',
		})
		assert.ok(f.length > 0)
		for (const x of f) assert.ok(x.fix && x.fix.length > 20, `${x.code} has no usable fix`)
	})

	test('the snapshot is the row shape core stores, not the descriptor object', () => {
		const rows = snapshotRegistry([C.generateText.descriptor], { release: '0.6.0' })
		assert.deepEqual(rows[0]!.ports.out.text, 'core:shape/text-stream@1')
		assert.ok(Object.keys(rows[0]!.slots).includes('connection'))
		assert.equal(rows[0]!.version, 1)
		assert.equal(rows[0]!.release, '0.6.0')
		assert.equal(JSON.stringify(rows[0]).includes('function'), false, 'a row is data')
	})

	test('a row carries enough of a slot to render its form without the descriptor', () => {
		// The point of the column (12 §2, 05 §3): core generates the pipeline view
		// and the lens view from rows, so a plugin's parameters appear beside core's
		// with nothing authored twice — and without core executing the plugin to
		// find out what they are (F6). A list of slot names could not do that, which
		// is what this pins.
		const [row] = snapshotRegistry([C.generateText.descriptor], { release: '0.6.0' })
		assert.equal(row!.slots.prompts?.kind, 'prompts')
		assert.equal(row!.slots.prompts?.facet, 'prompts')
		assert.deepEqual(Object.keys(row!.slots.prompts?.fields ?? {}), ['system', 'postHistory'])
		assert.equal(row!.slots.params?.schema?.stopSequences?.type, 'string[]')
		assert.equal(row!.slots.connection?.shape, 'core:shape/text-gen@1')
	})

	test('a declaration is copied, so editing a row cannot edit the live type', () => {
		// A row is data on its way to a table and back. Handing out the descriptor's
		// own object would make an edit to a projection an edit to the running type,
		// which is the sort of aliasing that stays invisible until tests run in a
		// different order.
		const [row] = snapshotRegistry([C.generateText.descriptor], { release: '0.6.0' })
		assert.notEqual(row!.slots, C.generateText.descriptor.slots)
	})
})

describe('an extension hook never runs in the host process', () => {
	test('a manifest asking for the host process is refused at install', () => {
		// Refused from the *manifest*, before anything is loaded — which is the
		// only moment it can be refused, because by the time the code is running
		// it is already inside the host. An in-process hook cannot be timed out
		// or killed, so one runaway loop stops Serene Pub rather than one node
		// (13 §7h, F36).
		const findings = checkInstall({
			declares: [{ id: 'acme:task/thing@1', runtime: 'node' }],
			documents: [],
			registry: [],
			bound: ['acme:task/thing@1'],
			owner: 'acme',
		})
		const refusal = findings.find((f) => f.code === 'E_IN_PROCESS_HOOK')
		assert.ok(refusal, 'an in-process runtime was accepted')
		assert.equal(refusal!.severity, 'error')
		// The reader is an admin who did not write the plugin.
		assert.match(refusal!.fix, /rebuild/i)
	})

	test('its own process is accepted, and is what the SDK now emits', () => {
		const findings = checkInstall({
			declares: [{ id: 'acme:task/thing@1', runtime: 'process' }],
			documents: [],
			registry: [],
			bound: ['acme:task/thing@1'],
			owner: 'acme',
		})
		assert.equal(findings.filter((f) => f.code === 'E_IN_PROCESS_HOOK').length, 0)

		// `pipelineHook` no longer takes a runtime option at all — it is not a
		// default that can be overridden, it is the only possibility.
		const hook = pipelineHook(C.gate, () => ok({}), { visibility: 'private' })
		assert.equal(hook.runtime, 'process')
	})
})
