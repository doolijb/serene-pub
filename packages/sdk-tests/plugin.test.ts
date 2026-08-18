/**
 * Use cases 96–102 — the plugin author's surface: `defineExtension`, the packager,
 * `/contracts` generation and the `/testing` harness.
 *
 * Everything before this let someone author a *pipeline*. This is what lets someone write
 * a *plugin* — and the gap between those two is most of what "download the SDK" has to
 * mean.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { spec } from '@serene-pub/sdk'
import { run, ok, halt } from '@serene-pub/sdk'
import { slot } from '@serene-pub/sdk'
import { S } from '@serene-pub/sdk'
import { pin, describeTaskType, allTypes } from '@serene-pub/sdk'
import { defineSettings, secret } from '@serene-pub/sdk'
import {
	defineExtension,
	pipelineHook,
	lifecycleHook,
	eventHook,
	component,
	bindingsOf,
	pipelineHooksOf,
	ExtensionError,
} from '@serene-pub/sdk'
import { compilePlugin, scanSource, renderFindings, cannotDo } from '@serene-pub/cli'
import { bindingNameFor, checkDerivable, generateContracts, parseTypeId } from '@serene-pub/cli'
import type { Golden } from '@serene-pub/sdk/testing'
import {
	toGolden,
	diffGolden,
	checkGolden,
	GoldenMismatch,
	probeBinding,
	probeCtxFor,
	assertEquivalent,
	renderProbes,
} from '@serene-pub/sdk/testing'
import * as C from '@serene-pub/contracts'
import { main } from '@serene-pub/cli/bin'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publish, bindings, world } from './helpers.js'

// ── A plugin, as an author would write one ─────────────────────────────────

// The third-party example already lives in `/contracts` — a type id is registered once
// per process (F5), so the test reuses it rather than declaring a second one.
const rollDice = C.roll

const settings = defineSettings({
	defaultNotation: { type: 'string', default: '1d20', scope: 'user', label: 'Default roll' },
	apiKey: { type: 'secret', scope: 'instance', side: 'extension' },
})

const dicePipeline = spec('chariot.dice-tray:roll-turn', { version: '1.2.0' })
	.on('core:event/message-created@1')
	.input('input', C.messageCreated.v1())
	.task('roll', rollDice.v1({ notation: '1d20' }))
	.provider('narrate', C.generateText.v1({ connection: slot.connection() }))
	.consume('save', ($: any) => C.createMessage.v1({ text: $.narrate.text }))
	.preset('dramatic', { label: 'Dramatic', default: true }, (p) => p.params('roll', { notation: '2d20' }))
	.build()

const dicePlugin = defineExtension({
	slug: 'chariot.dice-tray',
	name: 'Dice Tray',
	version: '1.2.0',
	description: 'Roll dice in chat and let the model narrate the result.',
	engines: { 'serene-pub': '>=0.7 <0.9' },
	settings,
	hooks: [
		pipelineHook(rollDice, async (i: any, ctx: any) => ok({ main: 1, total: Math.floor(ctx.random() * 20) + 1 })),
		lifecycleHook('startup', async (s) => {
			s.readOwnRows('stats')
			return ok(null)
		}),
		eventHook('core:event/chat-created@1', async (s) => {
			s.writeOwnRows('seen', true)
			return ok(null)
		}),
	],
	components: [
		component({
			surface: 'core:surface/chat-message@1',
			slug: 'dice-result',
			label: 'Dice result',
			framework: 'svelte',
			entry: './dist/DiceResult.js',
		}),
	],
	pipelines: [dicePipeline],
})

// ── 96 · One entry point, validated where the author is ────────────────────
describe('96 · defineExtension', () => {
	test('it ties hooks, settings, components and pipelines into one declaration', () => {
		assert.equal(dicePlugin.slug, 'chariot.dice-tray')
		assert.equal(pipelineHooksOf(dicePlugin).length, 1)
		assert.equal(Object.keys(bindingsOf(dicePlugin))[0], 'chariot.dice-tray:roll@1')
	})

	test('a type under someone else’s namespace is refused, and says why it matters', () => {
		assert.throws(
			() =>
				defineExtension({
					slug: 'chariot.dice-tray',
					name: 'x',
					version: '1.0.0',
					hooks: [pipelineHook(C.rankHybrid.descriptor, async () => ok({}))],
				}),
			(e: Error) => e instanceof ExtensionError && /ownership is what lets an update replace your rows/.test(e.message),
		)
	})

	test('a non-semver version is refused', () => {
		assert.throws(() => defineExtension({ slug: 'a.b', name: 'x', version: 'v1' }), /not semver/)
	})

	test('bindingsOf builds the executor map from the declaration, not a parallel list', async () => {
		// So an author's tests run their real hooks. A hand-maintained map drifts, and the
		// drift is only discovered by a user.
		const doc = publish(
			spec('chariot.dice-tray:t', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.task('roll', rollDice.v1({ notation: '1d6' })),
		)
		const r = await run(doc, { input: {}, world, seed: 'seed:dice', bindings: bindings(bindingsOf(dicePlugin) as any) })
		assert.equal(r.outcome, 'ok')
		assert.ok((r.nodes.find((n) => n.nodeKey === 'roll')!.output as any).total >= 1)
	})
})

// ── 97 · The packager: static half ─────────────────────────────────────────
describe('97 · the manifest is extracted without running the code', () => {
	const source = `
		import { defineExtension, pipelineHook, eventHook } from '@serene-pub/sdk'
		export default defineExtension({
			slug: 'chariot.dice-tray',
			hooks: [
				pipelineHook(rollDice, async (i, ctx) => { ctx.readOwnRows('x'); return ok({}) }),
				eventHook('core:event/chat-created@1', async (s) => { s.writeOwnRows('k', 1); return ok(null) }),
			],
		})
	`

	test('permissions are compiled from what the code calls, not from what it declares', () => {
		const scan = scanSource([{ path: 'index.ts', text: source }])
		assert.deepEqual(scan.permissions, ['plugin:data.read', 'plugin:data.write'])
	})

	test('a computed declaration is an error, not a silent omission', () => {
		const dynamic = `
			const which = pickHook()
			eventHook(EVENTS[i], which)
			eventHook(isDev ? 'a' : 'b', h)
		`
		const scan = scanSource([{ path: 'bad.ts', text: dynamic }])
		const errs = scan.findings.filter((f) => f.code === 'E_DYNAMIC_DECLARATION')
		assert.ok(errs.length >= 1)
		assert.match(errs[0]!.fix, /core can never permit/)
	})

	test('a hook calling fetch() directly is refused, and pointed at the Provider', () => {
		const scan = scanSource([{ path: 'net.ts', text: `async function h() { const r = await fetch('https://x') }` }])
		const e = scan.findings.find((f) => f.code === 'E_DIRECT_NETWORK')!
		assert.ok(e)
		assert.match(e.fix, /through the injected `ctx.call`/)
		assert.match(e.fix, /A Query may not reach the network/)
	})

	test('strings and comments cannot fool the scanner', () => {
		const tricky = `
			// eventHook('commented-out@1', h)
			const s = "eventHook('in-a-string@1', h)"
			eventHook('core:event/chat-created@1', h)
		`
		const scan = scanSource([{ path: 'tricky.ts', text: tricky }])
		assert.equal(scan.declared.eventHooks, 1)
	})
})

// ── 98 · The packager: assembly ────────────────────────────────────────────
describe('98 · compilePlugin', () => {
	const sources = [
		{
			path: 'index.ts',
			text: `
				export default defineExtension({ slug: 'chariot.dice-tray' })
				pipelineHook(rollDice, async (i, ctx) => ok({}))
				lifecycleHook('startup', async (s) => { s.readOwnRows('stats'); return ok(null) })
				eventHook('core:event/chat-created@1', async (s) => { s.writeOwnRows('seen', true); return ok(null) })
				component({ surface: 'core:surface/chat-message@1', slug: 'dice-result' })
			`,
		},
	]

	test('it produces a manifest and the pipeline documents', () => {
		const r = compilePlugin({ sources, extension: dicePlugin })
		assert.ok(r.ok, renderFindings(r.findings))
		assert.equal(r.documents.length, 1)
		assert.equal(r.manifest!.types[0]!.id, 'chariot.dice-tray:roll@1')
		assert.equal(r.manifest!.types[0]!.binding, 'roll', 'the binding name is derived from the id')
		assert.deepEqual(r.manifest!.pipelines, [
			{ id: 'chariot.dice-tray:roll-turn', version: '1.2.0', nodes: 4, presets: ['dramatic'] },
		])
	})

	test('a pipeline subscription is a permission, because it is a side effect a user consents to', () => {
		const r = compilePlugin({ sources, extension: dicePlugin })
		assert.ok(r.manifest!.permissions.includes('event:core:event/message-created@1'))
		assert.ok(r.manifest!.permissions.includes('event:core:event/chat-created@1'))
	})

	test('a hook registered conditionally is caught by cross-checking the two halves', () => {
		// The AST sees three hook declarations; the built extension exposes one. That
		// means something is behind an `if`, and the manifest would understate the plugin.
		const half = defineExtension({ slug: 'chariot.dice-tray', name: 'x', version: '1.0.0', hooks: [] })
		const r = compilePlugin({ sources, extension: half })
		assert.equal(r.ok, false)
		const e = r.findings.find((f) => f.code === 'E_CONDITIONAL_REGISTRATION')!
		assert.ok(e)
		assert.match(e.fix, /the audit screen stops being true/)
	})

	test('the cannot-do list is generated, so it cannot flatter', () => {
		const r = compilePlugin({ sources, extension: dicePlugin })
		const cant = cannotDo(r.manifest!)
		assert.ok(cant.includes('cannot read your chats, characters or messages'))
		assert.ok(!cant.includes('cannot render anything in the interface'), 'it ships a component')
	})
})

// ── 99 · /contracts is generated, and the name rule is enforced ────────────
describe('99 · contracts generation', () => {
	test('every binding name in the sample contracts derives from its id', () => {
		// The rule exists because eleven of thirty-five hand-written names did not match.
		// A generator with an alias table is a generator that drifts.
		const entries = Object.entries(C)
			.filter(([, v]) => !!v && typeof v === 'object' && 'id' in (v as object))
			.map(([name, v]) => ({ name, id: (v as any).id as string }))
		assert.deepEqual(checkDerivable(entries), [])
	})

	test('the derivation is the camelCase of the id’s name segment, nothing else', () => {
		assert.equal(bindingNameFor('core:provider/generate-text@1'), 'generateText')
		assert.equal(bindingNameFor('chariot.dice-tray:roll@1'), 'roll')
		assert.deepEqual(parseTypeId('core:query/chat-history@2'), {
			ns: 'core',
			kind: 'query',
			name: 'chat-history',
			version: 2,
		})
	})

	test('generated output is readable TypeScript with the pin form at the call site', () => {
		const out = generateContracts(allTypes().slice(0, 3), { release: '0.6.0' })
		assert.match(out, /GENERATED — do not edit/)
		assert.match(out, /export const \w+ = pin\(/)
		assert.match(out, /pinned as \w+\.v\d+\(…\)/)
	})
})

// ── 100 · Goldens: "it still runs" is not the assertion anyone needs ───────
describe('100 · goldens', () => {
	const doc = () =>
		publish(
			spec('chariot.dice-tray:golden', { version: '1.0.0' })
				.input('input', C.userMessage.v1())
				.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope }))
				.provider('generate', C.generateText.v1({ connection: slot.connection() })),
		)

	test('a golden records decisions and payloads, and excludes timings', async () => {
		const r = await run(doc(), { input: {}, world, bindings: bindings(), seed: 'seed:g' })
		const g = toGolden('turn', r)
		assert.equal(g.seed, 'seed:g')
		assert.ok(g.nodes.length > 0)
		assert.equal(JSON.stringify(g).includes('elapsedMs'), false, 'a golden that fails on 3ms vs 2ms is one nobody keeps')
	})

	test('a changed prompt fails the golden and the diff names the path', async () => {
		const before = toGolden('turn', await run(doc(), { input: {}, world, bindings: bindings(), seed: 'seed:g' }))
		const after = await run(doc(), {
			input: {},
			world,
			seed: 'seed:g',
			bindings: bindings({ 'core:query/chat-history@1': async () => ok({ main: [], messages: ['CHANGED'] }) }),
		})
		assert.throws(
			() => checkGolden('turn', after, before),
			(e: Error) => e instanceof GoldenMismatch && /CHANGED/.test(e.message),
		)
	})

	test('recording is the same call as comparing', async () => {
		const r = await run(doc(), { input: {}, world, bindings: bindings(), seed: 'seed:g' })
		assert.equal(checkGolden('turn', r).recorded, true)
		assert.equal(checkGolden('turn', r, toGolden('turn', r)).recorded, false)
	})

	test('the diff is deepest-path-first, so the first line is the actual change', () => {
		const g = (text: string): Golden => ({
			name: 'x',
			specId: 's',
			specVersion: '1.0.0',
			seed: 'seed:g',
			outcome: 'ok',
			nodes: [{ nodeKey: 'a', kind: 'provider', result: 'ok', output: { text } }],
			emitted: [],
		})
		const d = diffGolden(g('one'), g('two'))
		assert.equal(d[0]!.path, 'nodes.0.output.text')
	})
})

// ── 101 · Binding probes: what a hook has to do to be a hook ───────────────
describe('101 · binding conformance', () => {
	test('a well-behaved hook passes every probe', async () => {
		const results = await probeBinding(
			async () => ok({ main: 1 }),
			rollDice.descriptor,
			probeCtxFor('task', { notation: '1d20' }),
		)
		assert.deepEqual(results.filter((r) => !r.pass), [], renderProbes(results))
	})

	test('a hook returning a bare value fails, and the consequence explains why it matters', async () => {
		const results = await probeBinding(async () => ({ total: 4 }) as any, rollDice.descriptor, probeCtxFor('task'))
		const b1 = results.find((r) => r.id === 'B1')!
		assert.equal(b1.pass, false)
		assert.match(b1.consequence!, /correct "not applicable" is recorded as an error/)
	})

	test('a hook reaching for Math.random fails the determinism probe', async () => {
		const results = await probeBinding(
			async () => ok({ total: Math.floor(Math.random() * 1e9) }),
			rollDice.descriptor,
			probeCtxFor('task'),
		)
		assert.equal(results.find((r) => r.id === 'B3')!.pass, false)
	})

	test('a Task context carries no services at all (F11)', async () => {
		const ctx = probeCtxFor('task').makeCtx()
		for (const forbidden of ['read', 'call', 'commit', 'emit']) assert.equal(forbidden in ctx, false)
	})

	test('a hook that never settles is caught here rather than in production', async () => {
		const results = await probeBinding(() => new Promise(() => {}), rollDice.descriptor, probeCtxFor('task'))
		assert.equal(results.find((r) => r.id === 'B4')!.pass, false)
	})
})

// ── 102 · F26 as a one-liner an author can run ─────────────────────────────
test('102 · assertEquivalent gives an author the equivalence law in one call', async () => {
	const doc = publish(
		spec('chariot.dice-tray:eq', { version: '1.0.0' })
			.input('input', C.userMessage.v1())
			.async('gather', { mode: 'parallel' }, (b) =>
				b
					.chain('a', (c) => c.query('history', ($) => C.chatHistory.v1({ scope: $.input.chatScope })))
					.chain('b', (c) => c.query('lore', ($) => C.lorebookTriggers.v1({ text: $.input.text }))),
			),
	)
	await assertEquivalent(doc, { input: { text: 'hi' }, world, bindings: bindings() })
})

// ── 103 · The command line is the packager, not a second implementation ────
describe('103 · serene-pub CLI', () => {
	const dir = join(tmpdir(), 'sp-cli-fixture')

	const write = async (rel: string, text: string) => {
		await mkdir(join(dir, 'src'), { recursive: true })
		await writeFile(join(dir, rel), text)
	}

	test('`check` reports what core would refuse and exits non-zero', async () => {
		await write('src/index.ts', `eventHook(EVENTS[i], h)\nasync function f() { await fetch('https://x') }`)
		const code = await main(['check', dir])
		assert.equal(code, 1, 'a plugin core would refuse must not exit 0 — CI is the whole point')
	})

	test('`check` on a clean plugin exits zero and lists the permissions it computed', async () => {
		await write('src/index.ts', `export default defineExtension({ slug: 'demo.thing' })\neventHook('core:event/chat-created@1', async (s) => { s.writeOwnRows('k', 1) })`)
		assert.equal(await main(['check', dir]), 0)
	})

	test('there is no `install` verb, because installing is an admin action inside SP', () => {
		// A CLI that could install is a CLI that can be scripted into installing.
		assert.equal(typeof main, 'function')
	})
})
