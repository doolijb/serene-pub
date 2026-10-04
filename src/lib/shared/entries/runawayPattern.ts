/**
 * A **runaway pattern**: a regex key whose time to match can grow without
 * bound on ordinary text (ReDoS, plan lorebooks-consolidation S3).
 *
 * `/(a+)+$/` against forty `a`s and a `!` does not take forty steps, it takes
 * about 2⁴⁰: the engine tries every way of dividing the run between the inner
 * and the outer repeat before it can say no. Regex keys run on the server's
 * main thread on every turn, so one such key in one book stalled every user of
 * the install and the lorebook lock's heartbeat with it.
 *
 * Two halves, and both are needed:
 *
 *   · **on write** (this file): the entry editor, an amendment and every
 *     import refuse a pattern this recognises, with a sentence saying why;
 *   · **on read** (`ranking/boundedPattern.ts`): rows written before the check
 *     existed, and the patterns this cannot recognise, run under a time bound
 *     and are skipped with a receipt note when they trip it.
 *
 * ⚠ **A heuristic, deliberately.** Deciding exactly which patterns backtrack
 * catastrophically is a real analysis (an NFA ambiguity check); this is the
 * safe-regex family's approximation — a length cap, a repeat nested inside a
 * repeat that the next round could also match, and a repeated choice whose
 * options can start the same way. It has false positives (`(?:a|ab)*` is in
 * fact safe) and false negatives: polynomial patterns pass — `\d+\d+\d+x`,
 * a chain of lazy `[\s\S]*?`, a backreference — because refusing every
 * `.*a.*b` would refuse half the regex keys people write. Those are the
 * read-side bound's, which is why it exists and is not optional. Shared
 * rather than server-only so the editor can say the same thing before a save
 * does.
 *
 * Patterns are read the way the matcher compiles them: no `u` flag (so `\p` is
 * a literal `p`), and case folded either way, the way V8 folds (`fold`) — a
 * sensitive entry is judged as strictly as an insensitive one, since the
 * stricter reading only ever refuses more. Judging has a fixed cost ceiling
 * (`JUDGE_WORK_LIMIT`); a pattern past it is refused as too intricate.
 */

/**
 * The longest pattern a regex key may be.
 *
 * Not itself the danger — length is not what makes a pattern slow — but it
 * bounds what compiling and judging one costs, and a key that long is not a
 * keyword anybody is maintaining by hand. Generous enough for a long
 * alternation of names, `\b(?:alice|bob|…)\b`.
 */
export const PATTERN_MAX_LENGTH = 1024

/** Which rule a runaway pattern broke. */
export type RunawayRule =
	| "tooLong"
	| "nestedRepeat"
	| "overlappingAlternatives"
	| "tooIntricate"
	| "unreadable"

export interface RunawayPattern {
	rule: RunawayRule
	/** Why, as the second half of a sentence: "…: <why>." */
	why: string
}

const WHY: Record<RunawayRule, string> = {
	tooLong: `it is longer than ${PATTERN_MAX_LENGTH.toLocaleString("en")} characters`,
	nestedRepeat:
		"it repeats a group that already repeats, like (a+)+, so a long message can take minutes to check",
	overlappingAlternatives:
		"it repeats a choice whose options can match the same text, like (a|ab)*, so a long message can take minutes to check",
	tooIntricate:
		"it has too many parts that could match the same text to check in reasonable time",
	unreadable: "it uses a regex feature the safety check cannot read"
}

/**
 * The refusal a writer throws, in one spelling everywhere a pattern is saved.
 *
 * Names the key because an entry has several and a sentence that does not say
 * which one sends somebody to read all of them.
 */
export const runawayRefusal = (key: string, found: RunawayPattern): string =>
	`The pattern “${key.length > 60 ? `${key.slice(0, 57)}…` : key}” can't be saved: ${found.why}. Rewrite it so each part can match in only one way.`

// ── The parse ───────────────────────────────────────────────────────────────

/** A `char` carries its case-folded form (`fold`), so comparing two is one `===`. */
type Atom =
	| { k: "char"; ch: string; folded: string }
	| { k: "set"; src: string }
	| { k: "any" }

type Node =
	| { t: "seq"; items: Node[] }
	| { t: "alt"; branches: Node[] }
	| { t: "group"; body: Node; zeroWidth: boolean }
	| { t: "rep"; body: Node; min: number; max: number }
	| { t: "atom"; atom: Atom }
	| { t: "assert" }

/** Thrown for a pattern this parser does not follow (see `runawayPatternOf`). */
class Unparsed extends Error {}

const QUANTIFIER = /^\{(\d+)(,(\d*))?\}/
/**
 * An inline modifier group, `(?i:…)`, `(?-i:…)`, `(?s-i:…)` (ES2025, which V8
 * runs). Read as the group it is: a parser that stopped at one let
 * `(?i:)(a+)+$` through as "cannot tell", which is to say as safe.
 */
const MODIFIERS = /^\?([ims]*)(?:-([ims]*))?:/
const HEX2 = /^[0-9a-fA-F]{2}/
const HEX4 = /^[0-9a-fA-F]{4}/
const CONTROL_ESCAPES: Record<string, string> = {
	t: "\t",
	n: "\n",
	r: "\r",
	v: "\v",
	f: "\f"
}

const charNode = (ch: string): Node => ({
	t: "atom",
	atom: { k: "char", ch, folded: fold(ch) }
})

function parse(s: string): Node {
	let i = 0
	/** Under `(?s:…)`, `.` also takes a line break: a different set. */
	let dotAll = false

	const alt = (): Node => {
		const branches = [seq()]
		while (s[i] === "|") {
			i++
			branches.push(seq())
		}
		return branches.length === 1 ? branches[0]! : { t: "alt", branches }
	}

	const seq = (): Node => {
		const items: Node[] = []
		while (i < s.length && s[i] !== "|" && s[i] !== ")") items.push(quantified(atom()))
		return { t: "seq", items }
	}

	const quantified = (node: Node): Node => {
		let min: number
		let max: number
		const c = s[i]
		if (c === "*") [min, max, i] = [0, Infinity, i + 1]
		else if (c === "+") [min, max, i] = [1, Infinity, i + 1]
		else if (c === "?") [min, max, i] = [0, 1, i + 1]
		else if (c === "{") {
			const m = QUANTIFIER.exec(s.slice(i))
			if (!m) return node // a literal `{`, which the next atom reads
			min = Number(m[1])
			max = m[2] === undefined ? min : m[3] === "" ? Infinity : Number(m[3])
			i += m[0].length
		} else return node
		if (s[i] === "?") i++ // lazy is still a repeat
		return { t: "rep", body: node, min, max }
	}

	const escape = (): Node => {
		const n = s[i + 1]
		if (n === undefined) throw new Unparsed()
		i += 2
		if ("dDwWsS".includes(n)) return { t: "atom", atom: { k: "set", src: `\\${n}` } }
		if (n === "b" || n === "B") return { t: "assert" }
		if (n >= "1" && n <= "9") {
			while (s[i] !== undefined && s[i]! >= "0" && s[i]! <= "9") i++
			return { t: "atom", atom: { k: "any" } }
		}
		if (n === "k" && s[i] === "<" && s.indexOf(">", i) >= 0) {
			i = s.indexOf(">", i) + 1
			return { t: "atom", atom: { k: "any" } }
		}
		// An unclosed `\k<` is the letter k where the pattern names no group
		// (and invalid where it does, so never compiled): the fall-through.
		const char = (ch: string): Node => charNode(ch)
		if (n === "x" && HEX2.test(s.slice(i, i + 2))) {
			i += 2
			return char(String.fromCharCode(parseInt(s.slice(i - 2, i), 16)))
		}
		if (n === "u" && HEX4.test(s.slice(i, i + 4))) {
			i += 4
			return char(String.fromCharCode(parseInt(s.slice(i - 4, i), 16)))
		}
		if (n === "c" && /^[A-Za-z]/.test(s[i] ?? "")) {
			i++
			return char(String.fromCharCode(s.charCodeAt(i - 1) % 32))
		}
		if (n === "0") return char("\0")
		return char(CONTROL_ESCAPES[n] ?? n)
	}

	const atom = (): Node => {
		const c = s[i]!
		if (c === "(") {
			i++
			let zeroWidth = false
			if (s.startsWith("?:", i)) i += 2
			else if (s.startsWith("?=", i) || s.startsWith("?!", i)) [zeroWidth, i] = [true, i + 2]
			else if (s.startsWith("?<=", i) || s.startsWith("?<!", i)) [zeroWidth, i] = [true, i + 3]
			else if (s.startsWith("?<", i)) {
				const close = s.indexOf(">", i)
				if (close < 0) throw new Unparsed()
				i = close + 1
			} else if (s[i] === "?") {
				const m = MODIFIERS.exec(s.slice(i, i + 16))
				if (!m) throw new Unparsed()
				i += m[0].length
				const outer = dotAll
				if (m[1]!.includes("s")) dotAll = true
				else if (m[2]?.includes("s")) dotAll = false
				const body = alt()
				dotAll = outer
				if (s[i] !== ")") throw new Unparsed()
				i++
				return { t: "group", body, zeroWidth: false }
			}
			const body = alt()
			if (s[i] !== ")") throw new Unparsed()
			i++
			return { t: "group", body, zeroWidth }
		}
		if (c === "[") {
			let j = i + 1
			if (s[j] === "^") j++
			while (j < s.length && s[j] !== "]") j += s[j] === "\\" ? 2 : 1
			if (j >= s.length) throw new Unparsed()
			const src = s.slice(i, j + 1)
			i = j + 1
			return { t: "atom", atom: { k: "set", src } }
		}
		if (c === ".") {
			i++
			return { t: "atom", atom: { k: "set", src: dotAll ? "[\\s\\S]" : "." } }
		}
		if (c === "^" || c === "$") {
			i++
			return { t: "assert" }
		}
		if (c === "\\") return escape()
		if (c === "*" || c === "+" || c === "?") throw new Unparsed()
		i++
		return charNode(c)
	}

	const root = alt()
	if (i !== s.length) throw new Unparsed()
	return root
}

// ── What can come first, and whether two firsts can meet ────────────────────

/**
 * Characters every set is probed with to decide whether two sets meet.
 *
 * Probing and not reasoning about class syntax: `[^a-z]` against `\W` is a
 * question the engine already answers, so it is asked. ASCII whole (controls
 * too: `[\b]` is a backspace), plus letters, digits and spaces from outside it
 * so `\w` against `[^\x00-\x7f]` is not declared disjoint by a sample that
 * never left ASCII. Beside these, two sets are also probed with every
 * character either one NAMES (`namedIn`) — so `[λ]` against `[λμ]`, or
 * `[α-γ]` against `[β-δ]` (two ranges that overlap share an endpoint), is
 * never called disjoint for want of a sample.
 */
const PROBES: string[] = (() => {
	const out: string[] = []
	for (let c = 0x00; c <= 0x7f; c++) out.push(String.fromCharCode(c))
	out.push(..." ÉéßЖ中ア٣ ​µμσςſ")
	return out
})()

/** A set, compiled once: what it matches, and which probes it holds. */
interface SetProbe {
	/** Null when it does not compile: then it is assumed to meet everything. */
	re: RegExp | null
	/** One bit per `PROBES` character the set holds. */
	bits: Uint32Array
	/** The characters its source names — a range's endpoints among them. */
	named: string[]
}

const setProbes = new Map<string, SetProbe>()
function probeOf(src: string): SetProbe {
	let probe = setProbes.get(src)
	if (probe === undefined) {
		let re: RegExp | null
		try {
			re = new RegExp(`^(?:${src})$`, "i")
		} catch {
			re = null
		}
		const bits = new Uint32Array(Math.ceil(PROBES.length / 32))
		if (re) for (let k = 0; k < PROBES.length; k++) if (re.test(PROBES[k]!)) bits[k >> 5]! |= 1 << (k & 31)
		probe = { re, bits, named: namedIn(src) }
		if (setProbes.size > 2000) setProbes.clear()
		setProbes.set(src, probe)
	}
	return probe
}

const setHas = (src: string, ch: string): boolean => {
	const { re } = probeOf(src)
	// A set this cannot compile is assumed to meet everything: the cautious
	// answer, and a pattern holding one will not compile either.
	return re === null ? true : re.test(ch)
}

/**
 * The characters a set's source spells out, escapes decoded — `[μ-ω]`
 * names μ and ω, `[\b]` names a backspace. Class escapes (`\d`, `\w`, `\s`)
 * name nothing: the probes cover them.
 */
function namedIn(src: string): string[] {
	const out: string[] = []
	for (let k = 0; k < src.length; k++) {
		const c = src[k]!
		if (c !== "\\") {
			if (c !== "[" && c !== "]" && c !== "^" && c !== "-") out.push(c)
			continue
		}
		const n = src[k + 1]
		if (n === undefined) break
		k++
		if ("dDwWsS".includes(n)) continue
		if (n === "b") out.push("\b")
		else if (n === "x" && HEX2.test(src.slice(k + 1, k + 3))) {
			out.push(String.fromCharCode(parseInt(src.slice(k + 1, k + 3), 16)))
			k += 2
		} else if (n === "u" && HEX4.test(src.slice(k + 1, k + 5))) {
			out.push(String.fromCharCode(parseInt(src.slice(k + 1, k + 5), 16)))
			k += 4
		} else if (n === "c" && /^[A-Za-z]/.test(src[k + 1] ?? "")) {
			out.push(String.fromCharCode(src.charCodeAt(k + 1) % 32))
			k++
		} else if (n === "0") out.push("\0")
		else out.push(CONTROL_ESCAPES[n] ?? n)
	}
	return out
}

/**
 * A character as V8 compares it under `i` without `u` — the spec's
 * Canonicalize: by UPPER case, one unit to one unit, and never a non-ASCII
 * letter onto an ASCII one. Lower case is the wrong question: `µ` (micro) and
 * `μ` (mu), or `σ` and `ς`, lower to themselves and upper to one letter, so
 * the engine treats each pair as the same character.
 */
function fold(ch: string): string {
	const up = ch.toUpperCase()
	if (up.length !== 1) return ch
	if (ch.charCodeAt(0) >= 128 && up.charCodeAt(0) < 128) return ch
	return up
}

/**
 * How much judging one pattern may cost, in comparisons, before it is refused
 * as too intricate to judge (`tooIntricate`). Counted rather than timed, so
 * the verdict is the same on every machine and every run.
 *
 * Judging is quadratic in the pattern — every pair of options of a repeated
 * choice, every repeat against what may follow it — and runs on the main
 * thread on a save, on every key of an import, and on a turn for a pattern
 * the memo has not seen. An ordinary key costs tens; a 300-name alternation
 * under a repeat, some tens of thousands.
 */
const JUDGE_WORK_LIMIT = 400_000
let work = 0
class TooIntricate extends Error {}
const spend = (n = 1) => {
	work += n
	if (work > JUDGE_WORK_LIMIT) throw new TooIntricate()
}

function atomsMeet(a: Atom, b: Atom): boolean {
	spend()
	if (a.k === "any" || b.k === "any") return true
	if (a.k === "char" && b.k === "char") return a.folded === b.folded
	if (a.k === "char") return setHas((b as { src: string }).src, a.ch)
	if (b.k === "char") return setHas(a.src, b.ch)
	const x = probeOf(a.src)
	const y = probeOf(b.src)
	if (x.re === null || y.re === null) return true
	for (let w = 0; w < x.bits.length; w++) if (x.bits[w]! & y.bits[w]!) return true
	spend(x.named.length + y.named.length)
	for (const ch of x.named) if (x.re.test(ch) && y.re.test(ch)) return true
	for (const ch of y.named) if (y.re.test(ch) && x.re.test(ch)) return true
	return false
}

const meet = (a: readonly Atom[], b: readonly Atom[]): boolean =>
	a.some((x) => b.some((y) => atomsMeet(x, y)))

/**
 * Both asked of the same subtree once per sequence position and once per
 * enclosing repeat, so each is kept on the node: without it a deep pattern
 * pays for its whole depth at every level.
 */
const nullables = new WeakMap<Node, boolean>()
const firsts = new WeakMap<Node, Atom[]>()

function nullable(n: Node): boolean {
	let known = nullables.get(n)
	if (known === undefined) nullables.set(n, (known = nullableOf(n)))
	return known
}

function firstOf(n: Node): Atom[] {
	let known = firsts.get(n)
	if (known === undefined) {
		known = firstOfNode(n)
		spend(known.length)
		firsts.set(n, known)
	}
	return known
}

function nullableOf(n: Node): boolean {
	switch (n.t) {
		case "seq":
			return n.items.every(nullable)
		case "alt":
			return n.branches.some(nullable)
		case "group":
			return n.zeroWidth || nullable(n.body)
		case "rep":
			return n.min === 0 || nullable(n.body)
		case "atom":
			return n.atom.k === "any" // a backreference may match nothing
		case "assert":
			return true
	}
}

function firstOfNode(n: Node): Atom[] {
	switch (n.t) {
		case "seq":
			return firstOfItems(n.items, 0)
		case "alt":
			return n.branches.flatMap(firstOf)
		case "group":
			return n.zeroWidth ? [] : firstOf(n.body)
		case "rep":
			return firstOf(n.body)
		case "atom":
			return [n.atom]
		case "assert":
			return []
	}
}

function firstOfItems(items: readonly Node[], from: number): Atom[] {
	const out: Atom[] = []
	for (let k = from; k < items.length; k++) {
		out.push(...firstOf(items[k]!))
		spend()
		if (!nullable(items[k]!)) break
	}
	return out
}

/**
 * Whether everything from `from` on can match nothing — answered from a table
 * built once per sequence, since a sequence asks it at every position and a
 * 1,024-letter literal asking afresh each time was half a million steps.
 */
const suffixes = new WeakMap<readonly Node[], boolean[]>()
function nullableFrom(items: readonly Node[], from: number): boolean {
	let table = suffixes.get(items)
	if (!table) {
		table = new Array<boolean>(items.length + 1)
		table[items.length] = true
		for (let k = items.length - 1; k >= 0; k--) table[k] = table[k + 1]! && nullable(items[k]!)
		spend(items.length)
		suffixes.set(items, table)
	}
	return table[from]!
}

/** A branch as the items it is a sequence of. */
const itemsOf = (n: Node): Node[] => (n.t === "seq" ? n.items : [n])

/**
 * Can two options of one choice match the same text?
 *
 * Walked in step while both sides are single atoms, so `(?:cat|car)` and
 * `(?:a\d|a\s)` part at the character that tells them apart rather than being
 * called overlapping for sharing a first letter. Past the atoms — a group, a
 * repeat, or one side ending — it falls back to whether what remains can start
 * the same way, and an option that has run out (`a` against `ab`) is taken to
 * overlap: the cautious reading.
 */
function optionsOverlap(a: Node, b: Node): boolean {
	const xs = itemsOf(a)
	const ys = itemsOf(b)
	let k = 0
	while (k < xs.length && k < ys.length) {
		const x = xs[k]!
		const y = ys[k]!
		spend()
		if (x.t === "assert" && y.t === "assert") {
			k++
			continue
		}
		if (x.t !== "atom" || y.t !== "atom") break
		if (!atomsMeet(x.atom, y.atom)) return false
		k++
	}
	if (nullableFrom(xs, k) || nullableFrom(ys, k)) return true
	return meet(firstOfItems(xs, k), firstOfItems(ys, k))
}

/**
 * How many ways a bounded repeat nested in bounded repeats may divide one run
 * before it is judged as if it were unbounded.
 *
 * A repeat that can take `b` different counts, run up to `r` times by the
 * repeats around it, can divide a run in up to bʳ ways, and a match that fails
 * tries every one: `(\d{1,3}){3}` is 27 and fine, `(?:a{1,16}){1,16}` is 16¹⁶.
 * ⚠ Not the product of the counts: that is 256 for both, and cannot tell them
 * apart.
 */
const BOUNDED_WAYS = 4096

function judge(n: Node, follow: readonly Atom[], above: readonly number[]): RunawayRule | null {
	switch (n.t) {
		case "seq":
			for (let k = 0; k < n.items.length; k++) {
				const after = firstOfItems(n.items, k + 1)
				const next = nullableFrom(n.items, k + 1) ? [...after, ...follow] : after
				spend(next.length)
				const found = judge(n.items[k]!, next, above)
				if (found) return found
			}
			return null
		case "alt":
			if (above.length > 0)
				for (let a = 0; a < n.branches.length; a++)
					for (let b = a + 1; b < n.branches.length; b++)
						if (optionsOverlap(n.branches[a]!, n.branches[b]!))
							return "overlappingAlternatives"
			for (const branch of n.branches) {
				const found = judge(branch, follow, above)
				if (found) return found
			}
			return null
		case "group":
			// A lookaround is atomic in JavaScript and matches on its own, so
			// nothing after it follows what is inside it.
			return judge(n.body, n.zeroWidth ? [] : follow, above)
		case "rep": {
			const repeats = n.max > 1
			if (repeats && above.length > 0) {
				const rounds = above.reduce((p, m) => p * m, 1)
				const bounded =
					Number.isFinite(n.max) &&
					Number.isFinite(rounds) &&
					rounds * Math.log2(n.max - n.min + 1) <= Math.log2(BOUNDED_WAYS)
				// The next round of the outer repeat — or whatever follows this
				// one — could take what this one takes: the run can be divided
				// between them in exponentially many ways.
				if (!bounded && meet(firstOf(n.body), follow)) return "nestedRepeat"
			}
			const inner = repeats ? [...firstOf(n.body), ...follow] : follow
			return judge(n.body, inner, repeats ? [...above, n.max] : above)
		}
		default:
			return null
	}
}

const verdicts = new Map<string, RunawayPattern | null>()

const compiles = (pattern: string): boolean => {
	try {
		new RegExp(pattern)
		return true
	} catch {
		return false
	}
}

/**
 * Whether a regex key is a runaway pattern, and why; null when it is not one
 * that this recognises. Memoised — the read side asks on every turn.
 *
 * An invalid pattern is not called runaway: it never compiles, and falls back
 * to substring. A valid one this cannot parse IS (`unreadable`) — there are
 * none left that a fuzz of the grammar finds, and "cannot tell" read as
 * "safe" is how the inline-modifier group got through.
 */
export function runawayPatternOf(pattern: string): RunawayPattern | null {
	const known = verdicts.get(pattern)
	if (known !== undefined) return known
	let found: RunawayPattern | null = null
	if (pattern.length > PATTERN_MAX_LENGTH) found = { rule: "tooLong", why: WHY.tooLong }
	else {
		work = 0
		try {
			const rule = judge(parse(pattern), [], [])
			if (rule) found = { rule, why: WHY[rule] }
		} catch (e) {
			if (e instanceof TooIntricate) found = { rule: "tooIntricate", why: WHY.tooIntricate }
			else if (!(e instanceof Unparsed)) throw e
			// One this cannot read is safe only if the engine cannot either:
			// an invalid pattern never compiles, and falls back to substring.
			// A valid one it cannot read is not called safe — `(?i:)(a+)+$`
			// was, while the parser stopped at every `(?`.
			else if (compiles(pattern)) found = { rule: "unreadable", why: WHY.unreadable }
		}
	}
	if (verdicts.size > 5000) verdicts.clear()
	verdicts.set(pattern, found)
	return found
}

/**
 * The effective match mode of an entry as the matcher reads it: `matchMode`
 * when it is one of the three, else the legacy `useRegex` boolean.
 *
 * The same precedence as `modeOf` in `ranking/signals.ts`, spelled here so a
 * writer asks the question the reader will.
 */
export const readsAsRegex = (entry: {
	matchMode?: string | null
	useRegex?: boolean | null
}): boolean =>
	entry.matchMode === "regex" ||
	(entry.matchMode !== "substring" && entry.matchMode !== "word" && !!entry.useRegex)
