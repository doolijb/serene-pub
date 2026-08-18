/**
 * Use cases 77–81 — the plugin settings schema.
 *
 * 12 §6 promises "the same schema strategy as node config and review steps — one renderer,
 * three uses." These tests hold that promise to four: the form, validation, the manifest
 * entry, and typed access from the author's own code.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
	defineSettings,
	secret,
	isSecret,
	checkSchema,
	checkValues,
	reconcile,
	configState,
	isVisible,
	SettingsError,
	type SettingsValues,
} from '@serene-pub/sdk'

const S = defineSettings({
	endpoint: {
		type: 'string',
		label: 'API endpoint',
		required: true,
		scope: 'instance',
		side: 'extension',
		group: 'Connection',
	},
	apiKey: { type: 'secret', label: 'API key', required: true, scope: 'instance', side: 'extension', group: 'Connection' },
	mode: { type: 'enum', of: ['simple', 'advanced'] as const, default: 'simple', group: 'Behaviour' },
	retries: { type: 'integer', default: 2, min: 0, max: 10, group: 'Behaviour', showIf: { field: 'mode', equals: 'advanced' } },
	showBadge: { type: 'boolean', default: true, scope: 'user', side: 'component', group: 'Display' },
})

const configured = { endpoint: 'https://example.test', apiKey: secret('cipher:abc'), mode: 'simple', retries: 2, showBadge: true }

// ── 77 · One declaration, four uses ─────────────────────────────────────────
describe('77 · the schema drives the form, validation, the manifest and the types', () => {
	test('the form layout groups in declaration order', () => {
		assert.deepEqual(
			S.layout().map((g) => g.group),
			['Connection', 'Behaviour', 'Display'],
		)
		assert.deepEqual(S.layout()[0]!.fields.map((f) => f.key), ['endpoint', 'apiKey'])
	})

	test('conditional fields are one level, not a rules engine', () => {
		const decl = S.schema.retries
		assert.equal(isVisible(decl, { mode: 'simple' }), false)
		assert.equal(isVisible(decl, { mode: 'advanced' }), true)
		assert.equal(isVisible(S.schema.endpoint, {}), true, 'a field with no showIf is always shown')
	})

	test('defaults come from the declaration, and required fields have none', () => {
		assert.deepEqual(S.defaults(), { mode: 'simple', retries: 2, showBadge: true })
	})

	test('the value type is inferred, so the author’s own code is checked', () => {
		// Compile-time: `mode` narrows to the enum, `apiKey` is a SecretValue.
		const v: SettingsValues<typeof S.schema> = {
			endpoint: 'https://example.test',
			apiKey: secret('cipher:abc'),
			mode: 'advanced',
		}
		assert.equal(v.mode, 'advanced')
		// @ts-expect-error — 'aggressive' is not one of the declared options
		const bad: SettingsValues<typeof S.schema> = { endpoint: 'x', apiKey: secret('y'), mode: 'aggressive' }
		void bad
	})
})

// ── 78 · Values are validated, and every error says what to do ──────────────
describe('78 · value validation', () => {
	test('type, range and enum membership are checked', () => {
		const f = checkValues(S.schema, { ...configured, retries: 99, mode: 'turbo' })
		assert.equal(f.length, 2)
		assert.ok(f.some((x) => x.field === 'retries' && /above the maximum 10/.test(x.message)))
		assert.ok(f.some((x) => x.field === 'mode' && /not one of simple, advanced/.test(x.message)))
		for (const x of f) assert.ok(x.fix, 'every finding names what to do instead (15 §1.3)')
	})

	test('a secret set as a plain string is refused', () => {
		const f = checkValues(S.schema, { ...configured, apiKey: 'sk-live-oops' })
		assert.match(f[0]!.message, /is not a secret value/)
		assert.match(f[0]!.fix, /never set as plain strings/)
	})

	test('a fully configured plugin has nothing to report', () => {
		assert.deepEqual(checkValues(S.schema, configured), [])
	})
})

// ── 79 · A schema that would leak cannot be constructed ─────────────────────
describe('79 · declaration-time refusals', () => {
	test('a component-side secret throws, because a component runs in the browser', () => {
		assert.throws(
			() => defineSettings({ k: { type: 'secret', side: 'component' } }),
			(e: Error) => e instanceof SettingsError && /runs in the browser/.test(e.message),
		)
	})

	test('a shipped default credential is not a credential', () => {
		assert.throws(() => defineSettings({ k: { type: 'secret', default: 'sk-live' } }), /not a credential/)
	})

	test('an enum with no options is a dead form field', () => {
		assert.throws(() => defineSettings({ k: { type: 'enum' } }), /enum with no options/)
	})

	test('a showIf naming a field that does not exist is refused, and lists what does', () => {
		assert.throws(
			() => defineSettings({ a: { type: 'string' }, b: { type: 'string', showIf: { field: 'c', equals: 1 } } }),
			/name a field this schema declares \(a, b\)/,
		)
	})

	test('required plus a default is a warning, not an error — it can just never be unset', () => {
		const f = checkSchema({ k: { type: 'string', required: true, default: 'x' } })
		assert.equal(f[0]!.severity, 'warning')
	})
})

// ── 80 · What an update does to values that already exist ──────────────────
describe('80 · reconcile on update', () => {
	test('a removed field is orphaned, never deleted', () => {
		// Same rule 12 §5 applies to an orphaned slot after a node swap: unmigrated
		// values land in diagnostics rather than disappearing, so a downgrade can
		// still get them back.
		const r = reconcile(S.schema, { ...configured, legacyTimeout: 30 })
		assert.deepEqual(r.orphaned, [
			{ field: 'legacyTimeout', value: 30, reason: 'the updated schema no longer declares this field' },
		])
		assert.equal(r.values.endpoint, 'https://example.test')
	})

	test('an orphaned secret is reported without its value', () => {
		const r = reconcile(S.schema, { ...configured, oldKey: secret('cipher:old') })
		assert.equal(r.orphaned[0]!.value, '[secret]')
	})

	test('a newly added field takes its default', () => {
		const r = reconcile(S.schema, { endpoint: 'x', apiKey: secret('y') })
		assert.equal(r.values.retries, 2)
	})

	test('reconcile reports what is now invalid rather than silently coercing', () => {
		const r = reconcile(S.schema, { endpoint: 'x', apiKey: secret('y'), retries: 'two' })
		assert.ok(r.findings.some((x) => x.field === 'retries'))
	})
})

// ── 81 · Unconfigured is not broken ────────────────────────────────────────
describe('81 · needs-configuration', () => {
	test('a required field with no value blocks activation and names itself', () => {
		const s = configState(S.schema, { mode: 'simple' })
		assert.equal(s.state, 'needs-configuration')
		assert.deepEqual((s as any).missing, ['endpoint', 'apiKey'])
		assert.match((s as any).message, /waiting on endpoint, apiKey/)
	})

	test('"needs configuration" is a distinct state from "broken"', () => {
		// One means file a bug against the author; the other means type an API key. A
		// plugin that silently does nothing is the worst of both.
		assert.equal(configState(S.schema, configured).state, 'ready')
		assert.notEqual(configState(S.schema, {}).state, 'broken' as never)
	})
})

// ── 82 · The three audiences, and what each is allowed to see ──────────────
describe('82 · audiences', () => {
	test('the client learns whether a secret is set, never what it is', () => {
		const c = S.forClient(configured)
		assert.deepEqual(c.apiKey, { $secretSet: true })
		assert.equal(JSON.stringify(c).includes('cipher:abc'), false)
	})

	test('an export drops secrets entirely', () => {
		assert.equal('apiKey' in S.forExport(configured), false)
		assert.equal(S.forExport(configured).endpoint, 'https://example.test')
	})

	test('a component receives only component-side fields', () => {
		assert.deepEqual(S.forComponent(configured), { showBadge: true })
	})

	test('only the declaring extension’s own hook sees plaintext', () => {
		const seen = S.forOwningHook(configured, (c) => c.replace('cipher:', ''))
		assert.equal(seen.apiKey, 'abc')
		assert.equal(isSecret(seen.apiKey), false, 'decrypted, not still wrapped')
	})
})
