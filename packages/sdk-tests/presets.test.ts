/**
 * Use cases 64–70 — author-shipped presets and the template-engine registry.
 *
 * The problem: the scope chain's layer 5 is a *single* author default per slot. That is
 * enough for one opinion and no help at all for "here are three coherent ways to run
 * this," which is what a plugin shipping a chat pipeline actually needs.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { spec } from '@serene-pub/sdk'
import { compile, canonicalHash, importDocument, exportDocument } from '@serene-pub/sdk'
import { validate } from '@serene-pub/sdk'
import { slot } from '@serene-pub/sdk'
import {
	defineEngine,
	getEngine,
	renderWith,
	jinja,
	text,
	jinja2,
	plain,
	type TemplateValue,
} from '@serene-pub/sdk'
import * as C from '@serene-pub/contracts'
import { parseSpecId, decideImport, compareVersions } from '@serene-pub/sdk'
import { publish, findings, errorsFor } from './helpers.js'

const ASSEMBLY = `{% for b in blocks %}== {{ b.title }} ==
{{ b.rendered }}
{% endfor %}`

const withPresets = () =>
	spec('chariot.rp:chat@1', { version: '1.0.0' })
		.input('input', C.userMessage.v1())
		.query('lore', ($) => C.lorebookTriggers.v1({ text: $.input.text }))
		.task('prompt', ($) => C.assemble.v2({ candidates: $.lore.hits }))
		.provider('generate', ($) => C.generateText.v1({ context: $.prompt.context, connection: slot.connection() }))
		.preset('balanced', { label: 'Balanced', description: 'The default mix.', default: true }, (p) =>
			p.params('lore', { weight: 0.3, minInclude: 1 }),
		)
		.preset('lore-heavy', { label: 'Lore-heavy', description: 'Favours world detail over history.' }, (p) =>
			p
				.params('lore', { weight: 0.5, minInclude: 3 })
				.prompts('generate', { system: 'Stay in the world.' })
				.template('prompt', jinja(ASSEMBLY)),
		)
		.preset('fast', { label: 'Fast' }, (p) => p.params('lore', { weight: 0.1, minInclude: 0 }))

// ── 64 · An author ships named configurations ───────────────────────────────
describe('64 · author presets', () => {
	test('three presets, one default, addressed by node key', () => {
		const doc = compile(withPresets().build())
		assert.deepEqual(doc.presets.map((p) => p.slug), ['balanced', 'lore-heavy', 'fast'])
		assert.equal(doc.presets.filter((p) => p.default).length, 1)
		assert.deepEqual(doc.presets[1]!.values.map((v) => `${v.nodeKey}.${v.slot}`), [
			'lore.params',
			'generate.prompts',
			'prompt.template',
		])
	})

	test('values are flat override rows — the shape node_overrides already stores', () => {
		// This is why author presets need no schema change: `config_presets` and
		// `node_overrides` at scope_kind='preset' already exist (12 §3).
		const doc = compile(withPresets().build())
		for (const v of doc.presets.flatMap((p) => p.values)) {
			assert.deepEqual(Object.keys(v).sort(), ['nodeKey', 'slot', 'value'])
		}
	})

	test('a second default is refused, by name', () => {
		assert.throws(
			() =>
				spec('demo:twodefault@1', { version: '1.0.0' })
					.input('input', C.userMessage.v1())
					.query('lore', C.lorebookTriggers.v1({ text: 'x' }))
					.preset('a', { label: 'A', default: true }, (p) => p.params('lore', {}))
					.preset('b', { label: 'B', default: true }, (p) => p.params('lore', {})),
			/second default preset/,
		)
	})

	test('the slug is a database reference, so display text is refused', () => {
		assert.throws(
			() =>
				spec('demo:badslug@1', { version: '1.0.0' })
					.input('input', C.userMessage.v1())
					.preset('Lore Heavy!', { label: 'Lore-heavy' }, (p) => p),
			/not a valid preset slug/,
		)
	})

	test('renaming the label leaves the identity — and every selection — intact', () => {
		// The whole point of a PK-agnostic reference (13 §7g). An author improving their
		// copy must not silently reset what users have selected.
		const before = compile(withPresets().build()).presets.map((p) => p.slug)
		const renamed = spec('chariot.rp:chat@1', { version: '1.1.0' })
			.input('input', C.userMessage.v1())
			.query('lore', ($) => C.lorebookTriggers.v1({ text: $.input.text }))
			.preset('balanced', { label: 'Standard', default: true }, (p) => p.params('lore', { weight: 0.3 }))
			.preset('lore-heavy', { label: 'World-focused' }, (p) => p.params('lore', { weight: 0.5 }))
			.preset('fast', { label: 'Quick' }, (p) => p.params('lore', { weight: 0.1 }))
		assert.deepEqual(compile(renamed.build()).presets.map((p) => p.slug), before)
	})

	test('presets round-trip with the document (F3, F4)', () => {
		const doc = compile(withPresets().build())
		const back = importDocument(doc)
		assert.deepEqual(back.presets, doc.presets)
		assert.equal(canonicalHash(back), canonicalHash(doc))
	})
})

// ── 65 · What a preset may not do ───────────────────────────────────────────
describe('65 · the author/admin line', () => {
	test('an unknown node key is a publish error, not a dead override row', () => {
		const b = spec('demo:badnode@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.query('lore', C.lorebookTriggers.v1({ text: 'x' }))
			.preset('typo', { label: 'Typo' }, (p) => p.params('lorebook' as any, { weight: 1 }))
		const e = errorsFor(b, '12 §3a')
		assert.equal(e.length, 1)
		assert.match(e[0]!.message, /unknown node 'lorebook'/)
		assert.match(e[0]!.fix, /silently dead config/)
	})

	test('a slot the node never declared is an error too — same failure mode', () => {
		// `vectorSearch` declares only `params`, so a template on it would resolve to
		// nothing and the user would report the preset "not working" with no error
		// anywhere. Same class of mistake as a typo'd key, so same treatment.
		const b = spec('demo:badslot@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.query('vsearch', C.vectorSearch.v1({}))
			.preset('x', { label: 'X' }, (p) => p.template('vsearch', jinja('{{ a }}')))
		const e = errorsFor(b, '12 §3a')
		assert.equal(e.length, 1)
		assert.match(e[0]!.message, /which declares params/)
	})

	test('the node key itself is typed — a preset cannot address a node that is not there', () => {
		// Compile-time, not a finding: the preset builder is parameterised by the same
		// accumulated node map the scope uses (src/scope.ts).
		spec('demo:typedkeys@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.query('lore', C.lorebookTriggers.v1({ text: 'x' }))
			// @ts-expect-error — 'lorebook' was never declared
			.preset('x', { label: 'X' }, (p) => p.params('lorebook', {}))
	})

	test('there is no .connection() on a preset at all', () => {
		// The enforcement is the absence of the method, not a rule someone checks —
		// an author preset pinning compute would put a layer under the admin and break
		// the cascade the write matrix exists to guarantee (12 §4).
		const b = spec('demo:conn@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.provider('generate', C.generateText.v1({ connection: slot.connection() }))
		let hasConnection = false
		b.preset('x', { label: 'X' }, (p) => {
			hasConnection = typeof (p as any).connection === 'function'
			return p
		})
		assert.equal(hasConnection, false)
	})

	test('and if one is smuggled in as data, the validator names why', () => {
		const b = spec('demo:conn2@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.provider('generate', C.generateText.v1({ connection: slot.connection() }))
			.preset('x', { label: 'X' }, (p) => p)
		// The builder offers no way to write one. The rule still has to exist, because SP
		// imports documents it did not author (F6) — a hand-edited or third-party document
		// can carry anything, and "the SDK wouldn't emit this" is not a defence.
		const doc = compile(b.build())
		doc.presets[0]!.values.push({ nodeKey: 'generate', slot: 'connection', value: { $ref: 'c1' } })
		const e = validate(doc).filter((x) => x.law === '12 §4')
		assert.equal(e.length, 1)
		assert.match(e[0]!.fix, /admin cascade works because connection has no writable scope/)
	})
})

// ── 65a · Export carries the presets a user chose (12 §7) ───────────────────
describe('65a · selective export', () => {
	test('the user picks which presets travel; the rest are reported, not silently dropped', () => {
		const doc = compile(withPresets().build())
		const { doc: out, omitted } = exportDocument(doc, { presets: ['lore-heavy'] })
		assert.deepEqual(out.presets.map((p) => p.slug), ['lore-heavy'])
		assert.equal(omitted.length, 3, 'two presets, plus the lost default')
		assert.ok(omitted.some((o) => /default preset 'balanced'/.test(o.what)))
	})

	test('a filtered export is a *different document*, and that is correct', () => {
		// F3's identity law is that a given export round-trips, not that every export of
		// a spec hashes the same. Asserting the latter would forbid choosing.
		const doc = compile(withPresets().build())
		const { doc: out } = exportDocument(doc, { presets: ['fast'] })
		assert.notEqual(canonicalHash(out), canonicalHash(doc))
		assert.equal(canonicalHash(importDocument(out)), canonicalHash(out), 'import(export(x)) is still identity')
	})

	test('SDK compile ships everything — there is no instance to choose from', () => {
		const doc = compile(withPresets().build())
		assert.equal(exportDocument(doc).doc.presets.length, 3)
		assert.equal(exportDocument(doc, { presets: 'none' }).doc.presets.length, 0)
	})

	test('flattening inlines a binding; base keeps the reference (02 §6, never silent)', () => {
		const doc = compile(
			spec('demo:bindings@1', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.provider('generate', C.generateText.v1({ connection: slot.connection() }))
				.preset('creative', { label: 'Creative' }, (p) => p.sampling('generate', { $ref: 'sampling:creative' }))
				.build(),
		)
		const base = exportDocument(doc, { bindings: 'base' })
		assert.deepEqual(base.doc.presets[0]!.values[0]!.value, { $ref: 'sampling:creative' })

		const flat = exportDocument(doc, {
			bindings: 'flattened',
			resolve: (_slot, ref) => (ref === 'sampling:creative' ? { temperature: 1.1 } : undefined),
		})
		assert.deepEqual(flat.doc.presets[0]!.values[0]!.value, { temperature: 1.1 })
	})

	test('an unresolvable reference is dropped **and reported**', () => {
		const doc = compile(
			spec('demo:unresolved@1', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.provider('generate', C.generateText.v1({ connection: slot.connection() }))
				.preset('x', { label: 'X' }, (p) => p.sampling('generate', { $ref: 'sampling:gone' }))
				.build(),
		)
		const { doc: out, omitted } = exportDocument(doc, { bindings: 'flattened', resolve: () => undefined })
		assert.equal(out.presets[0]!.values.length, 0)
		assert.match(omitted[0]!.reason, /could not resolve 'sampling:gone'/)
	})

	test('connection bindings never leave, whichever mode was chosen', () => {
		const doc = compile(
			spec('demo:connexport@1', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.provider('generate', C.generateText.v1({ connection: slot.connection() }))
				.preset('x', { label: 'X' }, (p) => p)
				.build(),
		)
		// As if an admin had bound one at preset scope — the builder cannot write it (§3a),
		// but an instance's own preset rows can, and those are what an app export reads.
		doc.presets[0]!.values.push({ nodeKey: 'generate', slot: 'connection', value: { $ref: 'conn:local' } })
		for (const bindings of ['base', 'flattened'] as const) {
			const { doc: out, omitted } = exportDocument(doc, { bindings, resolve: () => ({ anything: true }) })
			assert.equal(out.presets[0]!.values.length, 0)
			assert.match(omitted[0]!.reason, /never leave an instance/)
		}
	})
})

// ── 66 · Templates carry their engine ───────────────────────────────────────
describe('66 · the template engine is a registry entry, not a hardcoded choice', () => {
	test('a template value is source **and** engine', () => {
		const v: TemplateValue = jinja(ASSEMBLY)
		assert.equal(v.engine, 'core:template/jinja2@1')
		assert.equal(v.source, ASSEMBLY)
	})

	test('a bare string is refused, and the fix shows the wrappers', () => {
		const b = spec('demo:barestring@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.task('prompt', C.assemble.v2({ candidates: [] }))
			.preset('x', { label: 'X' }, (p) => p.template('prompt', ASSEMBLY as any))
		const e = errorsFor(b, '12 §3a')
		assert.equal(e.length, 1)
		assert.match(e[0]!.fix, /jinja\(source\), text\(source\)/)
	})

	test('an extension registers its own compiler and it renders', () => {
		const mustache = defineEngine({
			id: 'chariot.mustache:engine@1',
			label: 'Mustache-ish',
			render: (src, scope) => src.replace(/\{(\w+)\}/g, (_, k) => String((scope as any)[k] ?? '')),
			extract: (src) => [...src.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!),
			check: () => [],
			costProfile: (src, count) => ({
				fixed: count(src.replace(/\{\w+\}/g, '')),
				perIteration: {},
				exact: true,
			}),
		})
		assert.equal(getEngine('chariot.mustache:engine@1'), mustache)
		assert.equal(renderWith({ engine: mustache.id, source: 'hi {name}' }, { name: 'Mira' }), 'hi Mira')
	})

	test('two slots in one spec may use different engines', () => {
		// Safe because source templates render *before* Assemble (16 §3b, enforced by
		// port shapes), so only text crosses into allocation — the budget never sees a
		// template and cannot be confused by a mixture.
		const b = spec('demo:mixed@1', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.query('lore', C.lorebookTriggers.v1({ text: 'x' }))
			.task('prompt', C.assemble.v2({ candidates: [] }))
			.preset('x', { label: 'X' }, (p) =>
				p.template('prompt', jinja(ASSEMBLY)).template('lore', text('a fixed preamble')),
			)
		assert.equal(findings(b).filter((x) => x.severity === 'error').length, 0)
	})

	test('an unregistered engine fails with a message that names the likely cause', () => {
		assert.throws(
			() => renderWith({ engine: 'nobody.ships:this@1', source: 'x' }, {}),
			/usually means the plugin is disabled/,
		)
	})
})

// ── 67 · The cost profile is what keeps the budget a ceiling ────────────────
describe('67 · cost profiles', () => {
	const count = (s: string) => Math.ceil(s.length / 4)

	test('jinja2 separates fixed literals from per-iteration literals', () => {
		const p = jinja2.costProfile(ASSEMBLY, count)
		assert.equal(p.exact, true)
		assert.ok(p.perIteration['blocks']! > 0, 'the `== … ==` scaffolding is charged per block')
		assert.equal(p.fixed, 0, 'this template has no literal text outside the loop')
	})

	test('the estimate scales with block count, which is what Assemble knows', () => {
		const p = jinja2.costProfile(ASSEMBLY, count)
		const forTen = p.fixed + p.perIteration['blocks']! * 10
		const forOne = p.fixed + p.perIteration['blocks']! * 1
        assert.ok(forTen > forOne)
	})

	test('plain text is trivially exact — the reference implementation', () => {
		assert.deepEqual(plain.costProfile('hello there', count), {
			fixed: 3,
			perIteration: {},
			exact: true,
		})
	})

	test('an engine that cannot analyse itself reports exact:false rather than lying', () => {
		// The pressure gradient: a sloppy engine costs its users context headroom,
		// because Assemble widens the margin, not correctness (16 §7).
		const opaque = defineEngine({
			id: 'demo.opaque:engine@1',
			label: 'Opaque',
			render: (s) => s,
			extract: () => [],
			check: () => [],
			costProfile: () => ({ fixed: 0, perIteration: {}, exact: false }),
		})
		assert.equal(opaque.costProfile('anything', count).exact, false)
	})
})

// ── 76 · Identity: owner + slug + version ───────────────────────────────────
describe('76 · spec identity and ownership', () => {
	test('the owner comes from the id, and presets inherit it', () => {
		const doc = compile(withPresets().build())
		assert.equal(doc.presets[0]!.owner, 'chariot.rp')
	})

	test('a preset pack declares its own owner — the case the field exists for', () => {
		// A plugin shipping presets for someone else's pipeline. Uninstalling the pack
		// must remove its presets and leave the pipeline alone, which is only decidable
		// if the preset says who it belongs to (12 §3b).
		const doc = compile(
			spec('chariot.rp:chat', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.query('lore', C.lorebookTriggers.v1({ text: 'x' }))
				.preset('grimdark', { label: 'Grimdark', owner: 'someone.else' }, (p) => p.params('lore', { weight: 0.9 }))
				.build(),
		)
		assert.equal(doc.presets[0]!.owner, 'someone.else')
		assert.notEqual(doc.presets[0]!.owner, 'chariot.rp')
	})

	test('the semver goes in meta, never in the id', () => {
		assert.throws(() => spec('Chariot RP:Chat', { version: '1.0.0' }), /not a valid spec id/)
		// A trailing @N is type-pin syntax; tolerated and ignored rather than mistaken
		// for a version, because a spec with two versions cannot be matched on upgrade.
		assert.deepEqual(parseSpecId('chariot.rp:chat@1'), { owner: 'chariot.rp', slug: 'chat' })
	})

	test('newer replaces, equal or older is ignored — the ruled import rule', () => {
		const at = (version: string) => ({ owner: 'chariot.rp', slug: 'chat', version })
		assert.equal(decideImport(at('1.2.0'), at('1.1.0')).action, 'replace')
		assert.equal(decideImport(at('1.1.0'), at('1.1.0')).action, 'ignore')
		assert.equal(decideImport(at('1.0.0'), at('1.1.0')).action, 'ignore')
		assert.equal(decideImport(at('1.0.0')).action, 'install')
	})

	test('a prerelease sorts below the release it leads to', () => {
		assert.equal(compareVersions('1.2.0-rc.1', '1.2.0'), -1)
		assert.equal(compareVersions('1.2.0', '1.2.0-rc.1'), 1)
	})

	test('"newer" is not a licence to overwrite somebody else’s row', () => {
		const d = decideImport(
			{ owner: 'attacker', slug: 'chat', version: '9.9.9' },
			{ owner: 'chariot.rp', slug: 'chat', version: '1.0.0' },
		)
		assert.equal(d.action, 'conflict')
		assert.match(d.reason, /Ownership is not transferred by importing/)
	})
})
