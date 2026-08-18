/**
 * Use cases 72–75 — migrating existing workflows into pipelines (08 §5, U25).
 *
 * The whole file exists for use case 73. A migration that runs cleanly and quietly
 * changes what the model receives is worse than one that crashes: the symptom is "the
 * bot feels different since the update," which arrives weeks later and cannot be
 * falsified. So the acceptance criterion is byte-identical output, checked against the
 * **preview payload** rather than a second renderer written for the occasion.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { spec } from '@serene-pub/sdk'
import { run, ok } from '@serene-pub/sdk'
import { slot } from '@serene-pub/sdk'
import { roughTokens } from '@serene-pub/sdk'
import {
	migratedSlug,
	checkParity,
	parityGate,
	renderParity,
	assertReportComplete,
	unmappedEntries,
	summarize,
	MigrationError,
	type MigrationReport,
} from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'
import { publish, bindings, world } from './helpers.js'

/** Stands in for SP's existing prompt builder — the thing being replaced. */
const legacyEngine = (systemPrompt: string, history: string[]) =>
	`${systemPrompt}\n\n${history.join('\n')}`

const migrated = () =>
	spec('core:spec/chat-turn@1', { version: '1.0.0' })
		.input('input', C.userMessage.v1())
		.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope }))
		.task('prompt', ($) => C.assemble.v2({ candidates: $.history.messages }))
		.provider('generate', ($) => C.generateText.v1({ context: $.prompt.context, connection: slot.connection() }))

/** Renders exactly what the legacy engine renders — that is the point of the exercise. */
const parityBindings = (systemPrompt: string, history: string[]) =>
	bindings({
		'core:query/chat-history@1': async () => ok({ main: history, messages: history }),
		'core:task/assemble@2': async (i: any) => {
			const out = legacyEngine(systemPrompt, i.candidates ?? [])
			return ok({ main: out, context: out })
		},
	})

const previewOf = async (systemPrompt: string, history: string[]) =>
	run(publish(migrated()), {
		input: { text: 'hi', chatScope: { chatId: 'c1' } },
		world,
		preview: true,
		bindings: parityBindings(systemPrompt, history),
	})

// ── 72 · Migrated rows keep a derived identity, so the job can be re-run ────
describe('72 · idempotent identity', () => {
	test('a slug is derived from the source row, never generated', () => {
		assert.equal(migratedSlug('prompt_configs', 42), 'migrated-prompt-configs-42')
		assert.equal(migratedSlug('prompt_configs', 42), migratedSlug('prompt_configs', 42))
	})

	test('messy source ids still produce a valid slug', () => {
		assert.match(migratedSlug('prompt_configs', 'My Setup (v2)!'), /^[a-z0-9]+(-[a-z0-9]+)*$/)
	})

	test('re-running matches instead of duplicating — which is what makes a fix safe', () => {
		// A migration nobody dares re-run is a migration nobody dares fix. The slug is
		// the sync key that makes the second attempt an update (12 §3b).
		const first = migratedSlug('prompt_configs', 7)
		const afterBugfix = migratedSlug('prompt_configs', 7)
		assert.equal(first, afterBugfix)
	})
})

// ── 73 · Parity is byte-identical output, measured on the preview ──────────
describe('73 · parity against the legacy engine', () => {
	const SYSTEM = 'You are Mira, a cartographer.'
	const HISTORY = ['user: where are we?', 'assistant: three days east of the pass.']

	test('a faithful migration is byte-identical', async () => {
		const r = checkParity('chat/basic', legacyEngine(SYSTEM, HISTORY), await previewOf(SYSTEM, HISTORY), roughTokens)
		assert.equal(r.identical, true, renderParity(r))
		assert.equal(r.tokensLegacy, r.tokensPipeline)
	})

	test('a drifted migration is caught, and the report points at the character', async () => {
		const drifted = legacyEngine(SYSTEM + ' Always answer in verse.', HISTORY)
		const r = checkParity('chat/drift', drifted, await previewOf(SYSTEM, HISTORY), roughTokens)
		assert.equal(r.identical, false)
		assert.ok(r.firstDifferenceAt! > 0)
		// A diff of two multi-kilobyte prompts is unreadable; an excerpt at the seam is not.
		assert.match(renderParity(r), /diverges at character/)
		assert.match(r.legacyExcerpt!, /verse/)
	})

	test('comparing against anything but a preview is refused', async () => {
		const notAPreview = await run(publish(migrated()), {
			input: {},
			world,
			bindings: parityBindings(SYSTEM, HISTORY),
		})
		await assert.rejects(
			async () => checkParity('x', 'anything', notAPreview),
			(e: Error) => e instanceof MigrationError && /reimplementation/.test(e.message),
		)
	})
})

// ── 74 · The gate on dropping the old path ─────────────────────────────────
describe('74 · the parity gate', () => {
	const green = (n: number) => Array.from({ length: n }, (_, i) => ({ fixture: `f${i}`, identical: true }))

	test('all green over a real corpus passes', () => {
		assert.deepEqual(parityGate(green(20), 10), { pass: true })
	})

	test('an empty corpus fails — "no failures" and "nothing checked" are not the same', () => {
		const g = parityGate([], 1)
		assert.equal(g.pass, false)
		assert.match(g.reason!, /An unchecked corpus is not a green one/)
	})

	test('a corpus below the required size fails even with zero divergences', () => {
		assert.equal(parityGate(green(3), 10).pass, false)
	})

	test('one divergence fails the whole gate, and names the first fixture', () => {
		const results = [...green(5), { fixture: 'chat/edge-case', identical: false }]
		const g = parityGate(results, 1)
		assert.equal(g.pass, false)
		assert.match(g.reason!, /chat\/edge-case/)
	})
})

// ── 75 · Nothing is dropped silently ───────────────────────────────────────
describe('75 · the migration report', () => {
	const report: MigrationReport = {
		unit: 'U25a',
		entries: [
			{
				source: { table: 'prompt_configs', id: 1, label: 'My chat setup' },
				outcome: 'migrated',
				target: { slug: migratedSlug('prompt_configs', 1), scopeKind: 'user', nodeKey: 'prompt', slot: 'prompts' },
			},
			{
				source: { table: 'prompt_configs', id: 2, label: 'Old experiment' },
				outcome: 'unmapped',
				reason: "field 'impersonationPrompt' has no slot on core:spec/chat-turn@1; kept in spec_diagnostics",
			},
		],
		parity: [{ fixture: 'chat/basic', identical: true }],
	}

	test('every non-migrated row states why, and stays visible', () => {
		assert.doesNotThrow(() => assertReportComplete(report))
		const left = unmappedEntries(report)
		assert.equal(left.length, 1)
		assert.match(left[0]!.reason!, /spec_diagnostics/)
	})

	test('a silent drop is a bug in the migration, not in the data', () => {
		const bad: MigrationReport = {
			...report,
			entries: [...report.entries, { source: { table: 'prompt_configs', id: 3 }, outcome: 'skipped' }],
		}
		assert.throws(() => assertReportComplete(bad), /gave no reason/)
	})

	test('the summary separates parity checked from parity passed', () => {
		// A summary that only reported failures would show 0 for an unrun corpus and
		// read as success — the same trap the gate closes.
		assert.deepEqual(summarize(report), {
			migrated: 1,
			unmapped: 1,
			skipped: 0,
			parityChecked: 1,
			parityFailed: 0,
		})
	})

	test('a migrated value records the scope it landed at', () => {
		// The commonest way to lose a customisation is to migrate it to the wrong layer:
		// a user's prompt written at instance scope now applies to everyone, and written
		// at chat scope applies to one chat. Recording it makes that reviewable (12 §2).
		assert.equal(report.entries[0]!.target!.scopeKind, 'user')
	})
})
