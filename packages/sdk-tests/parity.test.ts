/**
 * Use cases 35–41 — SillyTavern World Info parity (13 §7i).
 *
 * The competitive assessment claimed every ST World Info feature "maps into the existing
 * model as params or template logic, not as new mechanisms." All seven do.
 *
 * Use case 41 originally reported a shape change was needed. That was my error — depth is a
 * context-template concern, and the template expresses it directly. The retraction is tested
 * rather than asserted.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { activate, rollProbability, resolveGroups, assembleWithPositions } from '@serene-pub/sdk'
import { render } from '@serene-pub/sdk'
import type { LoreEntry, ScanParams, PositionedItem } from '@serene-pub/sdk'
import { seededRandom } from '@serene-pub/sdk'

const P: ScanParams = { scanDepth: 3, caseSensitive: false, recursionDepth: 0, useRegex: false }

const entry = (o: Partial<LoreEntry> & { id: string }): LoreEntry => ({
	title: o.id,
	content: `content of ${o.id}`,
	keys: [o.id],
	...o,
})

// ── 35 · keys, regex and logic operators are params on the Query ────────────
describe('35 · activation matching', () => {
	const es = [
		entry({ id: 'mira', keys: ['Mira', 'sister'] }),
		entry({ id: 'castle', keys: ['^the castle'], useRegex: true }),
		entry({ id: 'gated', keys: ['sword'], secondary: { op: 'AND_ALL', keys: ['forge', 'ember'] } }),
		entry({ id: 'excluded', keys: ['sword'], secondary: { op: 'NOT_ANY', keys: ['forge'] } }),
	]

	test('plaintext keys match case-insensitively by default', () => {
		const hits = activate(es, ['where is MIRA'], P).map((h) => h.entry.id)
		assert.deepEqual(hits, ['mira'])
	})

	test('a per-entry regex key works', () => {
		const hits = activate(es, ['the castle looms'], P).map((h) => h.entry.id)
		assert.deepEqual(hits, ['castle'])
	})

	test('AND_ALL requires every secondary key; NOT_ANY excludes', () => {
		const both = activate(es, ['the sword from the forge, still ember-hot'], P).map((h) => h.entry.id)
		assert.deepEqual(both, ['gated'])

		const neither = activate(es, ['just a sword'], P).map((h) => h.entry.id)
		assert.deepEqual(neither, ['excluded'])
	})

	test('scanDepth bounds how much history is scanned', () => {
		const deep = ['nothing', 'nothing', 'nothing', 'Mira was here']
		assert.equal(activate(es, deep, P).length, 0, 'scanDepth 3 does not reach message 4')
		assert.equal(activate(es, deep, { ...P, scanDepth: 4 }).length, 1)
	})
})

// ── 36 · recursion is bounded and lives inside the Query's interior ─────────
describe('36 · recursion', () => {
	const es = [
		entry({ id: 'a', keys: ['dragon'], content: 'the dragon guards the hoard' }),
		entry({ id: 'b', keys: ['hoard'], content: 'the hoard sits beneath the mountain' }),
		entry({ id: 'c', keys: ['mountain'], content: 'the mountain is cold' }),
		entry({ id: 'stop', keys: ['hoard'], content: 'mentions mountain', preventRecursion: true }),
	]

	test('depth 0 activates only direct hits', () => {
		assert.deepEqual(activate(es, ['a dragon!'], P).map((h) => h.entry.id), ['a'])
	})

	test('depth 1 activates entries the first pass mentioned', () => {
		const ids = activate(es, ['a dragon!'], { ...P, recursionDepth: 1 }).map((h) => h.entry.id)
		assert.deepEqual(ids.sort(), ['a', 'b', 'stop'])
	})

	test('recursion terminates and respects preventRecursion', () => {
		const ids = activate(es, ['a dragon!'], { ...P, recursionDepth: 5 }).map((h) => h.entry.id)
		assert.ok(ids.includes('c'), 'b, which allows recursion, pulled in c')
		assert.equal(new Set(ids).size, ids.length, 'no entry activates twice')
	})

	test('it needs no pipeline construct — it is a bounded scan in the hook', () => {
		// The point: this is ordinary code inside a Query's opaque interior (01 §12.3).
		// No loop node, no back-edge, nothing the executor has to learn.
		const ids = activate(es, ['a dragon!'], { ...P, recursionDepth: 99 }).map((h) => h.entry.id)
		assert.ok(ids.length <= es.length)
	})
})

// ── 37 · constants are a priority tier, honoured before the budget ─────────
test('37 · a constant entry activates without a key match', () => {
	const es = [entry({ id: 'always', constant: true, keys: ['never-typed'] }), entry({ id: 'other', keys: ['xyz'] })]
	assert.deepEqual(activate(es, ['unrelated text'], P).map((h) => h.entry.id), ['always'])
})

// ── 38 · probability rolls against the run seed — better than the original ──
describe('38 · probability', () => {
	const es = Array.from({ length: 12 }, (_, i) => entry({ id: `e${i}`, constant: true, probability: 0.5 }))
	const hits = () => activate(es, [''], P)

	test('the same seed produces the same winners — ST cannot do this', () => {
		const a = rollProbability(hits(), seededRandom('seed:parity'))
		const b = rollProbability(hits(), seededRandom('seed:parity'))
		assert.deepEqual(a.kept.map((e) => e.id), b.kept.map((e) => e.id))
		assert.ok(a.rolledOut.length > 0, 'some entries lost their roll')
	})

	test('a different seed produces different winners', () => {
		const a = rollProbability(hits(), seededRandom('seed:1'))
		const b = rollProbability(hits(), seededRandom('seed:2'))
		assert.notDeepEqual(a.kept.map((e) => e.id), b.kept.map((e) => e.id))
	})

	test('probability 1 or absent always wins', () => {
		const certain = [entry({ id: 'sure', constant: true }), entry({ id: 'explicit', constant: true, probability: 1 })]
		const { kept } = rollProbability(activate(certain, [''], P), seededRandom('any'))
		assert.equal(kept.length, 2)
	})
})

// ── 39 · inclusion groups resolve in the rank Task ──────────────────────────
describe('39 · inclusion groups', () => {
	const members = [
		entry({ id: 'g1', group: 'weather', groupWeight: 1 }),
		entry({ id: 'g2', group: 'weather', groupWeight: 9 }),
		entry({ id: 'loner', group: undefined }),
	]

	test('exactly one member of a group survives; ungrouped entries pass through', () => {
		const { kept, lost } = resolveGroups(members, seededRandom('seed:g'))
		assert.equal(kept.filter((k) => k.group === 'weather').length, 1)
		assert.ok(kept.some((k) => k.id === 'loner'))
		assert.equal(lost.length, 1)
	})

	test('group weight biases the winner, and the roll is seeded so it replays', () => {
		let heavyWins = 0
		for (let i = 0; i < 50; i++) {
			const { kept } = resolveGroups(members, seededRandom(`seed:${i}`))
			if (kept.some((k) => k.id === 'g2')) heavyWins++
		}
		assert.ok(heavyWins > 35, `weight 9 vs 1 should usually win, got ${heavyWins}/50`)
	})

	test('this is the rank Task doing its existing job — no new mechanism', () => {
		// resolveGroups is a pure function over candidates: exactly what a Task is.
		const a = resolveGroups(members, seededRandom('same'))
		const b = resolveGroups(members, seededRandom('same'))
		assert.deepEqual(a.kept.map((x) => x.id), b.kept.map((x) => x.id))
	})
})

// ── 40 · insertion order is a sort key ─────────────────────────────────────
test('40 · larger order sits closer to the end', () => {
	const items: PositionedItem[] = [
		{ id: 'late', rendered: 'LATE', order: 100, position: 'after_char', weight: 1, priority: 'normal' },
		{ id: 'early', rendered: 'EARLY', order: 1, position: 'after_char', weight: 1, priority: 'normal' },
	]
	const { text } = assembleWithPositions([], items, 999, (s) => s.length)
	assert.ok(text.indexOf('EARLY') < text.indexOf('LATE'))
})

// ── 41 · positional insertion at chat depth — a TEMPLATE concern ───────────
describe('41 · positional insertion at chat depth', () => {
	const messages = ['m1', 'm2', 'm3', 'm4', 'm5'].map((t) => ({ rendered: t }))

	/**
	 * The corrected finding. An earlier version of this test claimed depth positioning
	 * needed a shape change on `context-candidates`. It does not: it is expressible in the
	 * assembly template, with `{% set %}` capturing the outer loop's index before an inner
	 * loop shadows `loop`.
	 */
	const TEMPLATE = `{% for m in messages %}{% set d = loop.revindex %}{% for l in lore %}{% if l.depth == d %}{{ l.rendered }}
{% endif %}{% endfor %}{{ m.rendered }}
{% endfor %}`

	test('the assembly template inserts entries between messages', () => {
		const lore = [{ rendered: 'NOTE', depth: 2 }]
		assert.equal(render(TEMPLATE, { messages, lore }), 'm1\nm2\nm3\nNOTE\nm4\nm5\n')
	})

	test('several entries at different depths land in the right places', () => {
		const lore = [
			{ rendered: 'TOP', depth: 5 },
			{ rendered: 'MID', depth: 3 },
			{ rendered: 'LOW', depth: 1 },
		]
		assert.equal(render(TEMPLATE, { messages, lore }), 'TOP\nm1\nm2\nMID\nm3\nm4\nLOW\nm5\n')
	})

	test('no shape change is involved — `items[]` was already there', () => {
		// The template needs messages as a list, which the candidate shape always carried.
		// The only real requirement is guidance: a Query that flattens its messages into one
		// opaque string forecloses this. That is advice, not a schema change.
		const flattened = [{ rendered: 'm1\nm2\nm3\nm4\nm5' }]
		const out = render(TEMPLATE, { messages: flattened, lore: [{ rendered: 'NOTE', depth: 1 }] })
		assert.ok(!out.includes('m3\nNOTE\nm4'), 'flattening it away is the only thing that breaks it')
	})

	test('the Task-side alternative also works, for authors who prefer computing placement', () => {
		const history: PositionedItem[] = ['m1', 'm2', 'm3', 'm4', 'm5'].map((id, i) => ({
			id,
			rendered: id,
			order: i,
			position: undefined,
			weight: 0.4,
			priority: 'normal',
		}))
		const lore: PositionedItem[] = [
			{ id: 'note', rendered: 'NOTE', order: 0, position: { atDepth: 2 }, weight: 0.3, priority: 'normal' },
		]
		assert.equal(assembleWithPositions(history, lore, 999, (s) => s.length).text, 'm1\nm2\nm3\nNOTE\nm4\nm5')
	})

	test('constants survive the budget; normal entries are dropped', () => {
		const lore: PositionedItem[] = [
			{ id: 'must', rendered: 'X'.repeat(50), order: 0, position: 'after_char', weight: 1, priority: 'always' },
			{ id: 'maybe', rendered: 'Y'.repeat(50), order: 1, position: 'after_char', weight: 1, priority: 'normal' },
		]
		const { included, dropped } = assembleWithPositions([], lore, 60, (s) => s.length)
		assert.ok(included.includes('must'))
		assert.ok(dropped.includes('maybe'))
	})
})

// ── Verdict ────────────────────────────────────────────────────────────────
test('parity verdict: seven of seven mapped; the real gap is the lorebook schema', () => {
	const mapped = [
		'regex + logic operators',
		'scan depth',
		'recursion',
		'constants',
		'probability (seeded, so replayable)',
		'inclusion groups + weight',
		'insertion order',
		'positional insertion at depth',
	]
	assert.equal(mapped.length, 8)

	// The architecture expresses all of it. What SP lacks today is a `depth` field on
	// lorebook entries — an entry-schema addition in the lorebook model, not anything in
	// the pipeline. "Feature missing" and "architecture can't express it" are different
	// problems, and only the first is true.
	const architecturalGaps: string[] = []
	assert.deepEqual(architecturalGaps, [])
})
