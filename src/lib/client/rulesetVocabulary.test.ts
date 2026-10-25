/**
 * 🚧 The rulesets vocabulary in the interface (NOMENCLATURE §28, "The
 * vocabulary test"): **the client never shows an SDK noun** of the rulesets
 * programme. Players read the plain words §28 lists — _Rules_, _How strict_,
 * a list by its own label, _the ‹name› library_, _Starter lorebook_, _Dice_ — and
 * this file holds every `.svelte` file under `src/lib/client` to them.
 *
 * 1. **Files**: every `src/lib/client/**\/*.svelte`, read as text, minus the
 *    places §28 excepts (`EXCLUDED`, each with its reason).
 * 2. **What a person reads**: the markup with `<script>`, `<style>` and HTML
 *    comments taken out — the text between tags with every `{…}` expression
 *    (Svelte blocks included) removed, and the literal parts of the
 *    `title`, `aria-label`, `placeholder`, `alt`, `label` and `description`
 *    attributes. String literals inside `<script>` are out of scope for this
 *    first version.
 * 3. **Words**, whole-word, any case, plurals included: a **banned** word
 *    fails wherever it shows; a **watched** word is common English, so each
 *    hit must match an `ALLOWLIST` entry (with its reason) and a new one
 *    fails until it is reviewed. An id (`core:ruleset/vis-itineris@1`, the
 *    identifier grammar of §2) is no word and is skipped. ⏳ `REPORTED`
 *    holds the banned hits the first run found in files the ruleset editor
 *    programme did not touch, until their copy is fixed.
 * 4. **Message**: one line per hit, naming the plain word §28 gives.
 * 5. **Proof**: fixtures prove the extractor and the matcher before the real
 *    files run, so a green run is never an extractor that read nothing; an
 *    allowlist or reported entry that no longer matches fails, so neither
 *    list outlives what it excuses.
 *
 * Admin › Rulesets is excluded for its own word only: a last test holds it to
 * every other word of both lists (§28's admin row).
 */
import { describe, expect, test } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const CLIENT = fileURLToPath(new URL(".", import.meta.url))

/** Paths under `src/lib/client` this test does not read, each with §28's reason. */
const EXCLUDED: readonly { prefix: string; reason: string }[] = [
	{
		prefix: "components/pipelines/",
		reason: "the Pipelines view and the run inspector show a pipeline's internals (node ids, ports) to administrators"
	},
	{
		prefix: "admin/sections/pipelines/",
		reason: "Admin › Pipelines shows spec internals to administrators, as the Pipelines view does"
	},
	{
		prefix: "admin/sections/rulesets/",
		reason:
			"Admin › Rulesets is §28's admin exception: administrators see Rulesets there and are shown its ids; the last test still holds it to every other word"
	}
]

/** §28's plain word for each SDK noun — what the failure message tells the author to say instead. */
const BANNED: Readonly<Record<string, string>> = {
	ruleset: "Rules (a field label), or the ruleset's own name (Vis Itineris)",
	rigour: "How strict: Words only · Rules · The rules decide",
	repertoire: "the list's own label (Items, Spells, Conditions…)",
	compendium: "the ‹name› library (Vis Itineris library)",
	primer: "Starter lorebook",
	bestow: "what it does, in words (Add a line for the model, Add to a number)",
	"render depth": "Detail: One line · Short · Full",
	phantom: "nothing; the Lorebooks view's section Session notes, and the verb Share as a lorebook",
	"table channel": "Dice"
}

/**
 * Common English, so a hit is reviewed rather than refused. `mechanic` is
 * listed singular so `mechanics` (§28's word) is its plural.
 */
const WATCHED: Readonly<Record<string, string>> = {
	piece: "the thing's own name (Longsword), or the list label's singular (Add an item)",
	bridge: "nothing; an effect reads as its origin in the explain line (+1 from Affection)",
	parked: "the sentence under the heading where the kept data shows, never a badge",
	mechanic: "the rules, in sentences"
}

/**
 * Reviewed hits of a watched word: `text` is a part of the string shown in
 * `file` (a path under `src/lib/client`), and `reason` says why it is plain
 * English there and not the SDK noun.
 */
const ALLOWLIST: readonly { file: string; text: string; reason: string }[] = [
	{
		file: "components/characterForms/SplitStrokesDialog.svelte",
		text: "Each piece becomes a stroke",
		reason: "a piece of a card's text, cut into strokes: plain English, nothing a list of the rules holds"
	}
]

/**
 * ⏳ Banned words this test found on its first run (2026-10-22) in files the
 * ruleset editor programme did not touch: reported to the owner, not fixed
 * here (the P3 brief). Each entry must still match a hit — fix the copy and
 * delete the entry; a new hit anywhere still fails.
 */
const REPORTED: readonly { file: string; text: string; reason: string }[] = [
	{
		file: "components/sessionForms/RulesFitAuditDialog.svelte",
		text: "any ruleset fits",
		reason: "reported 2026-10-22: say the rules (_any rules fit_)"
	},
	{
		file: "components/sessionForms/RulesFitAuditDialog.svelte",
		text: "Also in the ruleset, unused here",
		reason: "reported 2026-10-22: _Also in ‹name›, unused here_"
	},
	{
		file: "components/sessionForms/RulesFitAuditDialog.svelte",
		text: "every ruleset fits as it is",
		reason: "reported 2026-10-22: _any rules fit as they are_"
	}
]

/* ── the extractor ───────────────────────────────────────────────── */

interface Shown {
	/** 1-based line of the string's first character. */
	line: number
	text: string
}

/** The attributes whose literal values a person reads. */
const SHOWN_ATTRIBUTES = new Set(["title", "aria-label", "placeholder", "alt", "label", "description"])

/** Blank a span, keeping its newlines so line numbers hold. */
const blank = (s: string) => s.replace(/[^\n]/g, " ")

/** The index just past a quoted JS string or template starting at `i`. */
function skipString(s: string, i: number): number {
	const q = s[i]!
	let j = i + 1
	while (j < s.length) {
		const c = s[j]!
		if (c === "\\") j += 2
		else if (c === q) return j + 1
		else if (q === "`" && c === "$" && s[j + 1] === "{") j = skipExpression(s, j + 1)
		else j++
	}
	return j
}

/** The index just past the `{…}` expression whose `{` is at `i` (strings inside are skipped). */
function skipExpression(s: string, i: number): number {
	let depth = 0
	let j = i
	while (j < s.length) {
		const c = s[j]!
		if (c === '"' || c === "'" || c === "`") {
			j = skipString(s, j)
			continue
		}
		if (c === "{") depth++
		else if (c === "}" && --depth === 0) return j + 1
		j++
	}
	return j
}

/** A tag's attributes from `i` (just past its name) to its `>`: the shown ones' literal parts, and the index after `>`. */
function readTag(s: string, i: number, out: { at: number; text: string }[]): number {
	let j = i
	while (j < s.length) {
		const c = s[j]!
		if (c === ">") return j + 1
		if (c === "{") {
			j = skipExpression(s, j)
			continue
		}
		if (/[^\s/=]/.test(c)) {
			const name = /^[^\s=>/{]+/.exec(s.slice(j))![0]
			j += name.length
			while (/\s/.test(s[j] ?? "")) j++
			if (s[j] !== "=") continue
			j++
			while (/\s/.test(s[j] ?? "")) j++
			const q = s[j]
			if (q === '"' || q === "'") {
				const end = s.indexOf(q, j + 1) === -1 ? s.length : findQuoteEnd(s, j + 1, q)
				if (SHOWN_ATTRIBUTES.has(name.toLowerCase())) {
					// The literal parts: `{…}` inside the quotes is an expression.
					let k = j + 1
					let start = k
					while (k < end) {
						if (s[k] === "{") {
							out.push({ at: start, text: s.slice(start, k) })
							k = skipExpression(s, k)
							start = k
						} else k++
					}
					out.push({ at: start, text: s.slice(start, end) })
				}
				j = end + 1
			} else if (q === "{") j = skipExpression(s, j)
			else while (j < s.length && !/[\s>]/.test(s[j]!)) j++
			continue
		}
		j++
	}
	return j
}

/** The closing quote of a quoted attribute value, stepping over `{…}` inside it. */
function findQuoteEnd(s: string, i: number, q: string): number {
	let j = i
	while (j < s.length && s[j] !== q) j = s[j] === "{" ? skipExpression(s, j) : j + 1
	return j
}

/** Every string a person reads in one Svelte file, with its line. */
function shownStrings(source: string): Shown[] {
	const s = source
		.replace(/<script\b[\s\S]*?<\/script>/gi, blank)
		.replace(/<style\b[\s\S]*?<\/style>/gi, blank)
		.replace(/<!--[\s\S]*?-->/g, blank)
	const found: { at: number; text: string }[] = []
	let run = ""
	let runAt = -1
	const flush = () => {
		if (runAt >= 0) found.push({ at: runAt, text: run })
		run = ""
		runAt = -1
	}
	let i = 0
	while (i < s.length) {
		const c = s[i]!
		if (c === "{") {
			// An expression or a block is no text: a space keeps its neighbours apart.
			i = skipExpression(s, i)
			if (runAt >= 0) run += " "
			continue
		}
		if (c === "<" && /[A-Za-z/!]/.test(s[i + 1] ?? "")) {
			flush()
			const name = /^<\/?[^\s/>]*/.exec(s.slice(i))![0]
			i = readTag(s, i + name.length, found)
			continue
		}
		if (runAt < 0) runAt = i
		run += c
		i++
	}
	flush()
	const lineAt = (at: number) => s.slice(0, at).split("\n").length
	return found
		.map(({ at, text }) => {
			const lead = text.length - text.trimStart().length
			return { line: lineAt(at + lead), text: text.replace(/\s+/g, " ").trim() }
		})
		.filter((x) => x.text.length > 0)
}

/* ── the matcher ─────────────────────────────────────────────────── */

/** An id of §2's grammar: `<namespace>:<kind>/<name>` with an optional `@<major>`. */
const ID = /[a-z0-9][a-z0-9._-]*:[a-z][a-z-]*\/[a-z0-9][a-z0-9._/-]*(?:@\d+)?/gi

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** A word whole, any case, singular or plural (a space in it matches any run of spaces). */
const wordPattern = (word: string) =>
	new RegExp(`(?<![\\w])${escapeRegExp(word).replace(/ /g, "\\s+")}(?:s|es)?(?![\\w])`, "i")

const BANNED_PATTERNS = Object.keys(BANNED).map((w) => [w, wordPattern(w)] as const)
const WATCHED_PATTERNS = Object.keys(WATCHED).map((w) => [w, wordPattern(w)] as const)

interface Hit {
	file: string
	line: number
	word: string
	text: string
	kind: "banned" | "watched"
}

/** Every word of §28's two lists that one file shows. */
function hitsIn(file: string, source: string): Hit[] {
	const hits: Hit[] = []
	for (const shown of shownStrings(source)) {
		const words = shown.text.replace(ID, " ")
		for (const [word, re] of BANNED_PATTERNS)
			if (re.test(words)) hits.push({ file, line: shown.line, word, text: shown.text, kind: "banned" })
		for (const [word, re] of WATCHED_PATTERNS)
			if (re.test(words)) hits.push({ file, line: shown.line, word, text: shown.text, kind: "watched" })
	}
	return hits
}

type Entry = { file: string; text: string }
const covers = (e: Entry, h: Hit) => e.file === h.file && h.text.includes(e.text)

/** The hits that fail: a banned word not reported, a watched word not reviewed. */
const failing = (hits: readonly Hit[], allowlist: readonly Entry[] = ALLOWLIST, reported: readonly Entry[] = REPORTED) =>
	hits.filter((h) => !(h.kind === "watched" ? allowlist : reported).some((e) => covers(e, h)))

const hitMessage = (h: Hit): string =>
	`${h.file}:${h.line} shows "${h.word}" — the interface says ${(h.kind === "banned" ? BANNED : WATCHED)[h.word]} (NOMENCLATURE §28)` +
	(h.kind === "watched" ? "; if it is plain English here, add it to ALLOWLIST with the reason" : "")

/* ── the files ───────────────────────────────────────────────────── */

const allClientFiles = () => (readdirSync(CLIENT, { recursive: true }) as string[]).map((p) => p.split("\\").join("/"))

function clientSvelteFiles(): string[] {
	return allClientFiles()
		.filter((p) => p.endsWith(".svelte"))
		.filter((p) => !EXCLUDED.some((x) => p.startsWith(x.prefix)))
		.sort()
}

describe("the rulesets vocabulary in the interface (NOMENCLATURE §28)", () => {
	test("proof: the extractor reads text and shown attributes, and leaves code, comments and expressions", () => {
		const fixture = [
			`<script lang="ts">const ruleset = "the ruleset"</script>`,
			`<!-- a ruleset in a comment -->`,
			`<h2 class="ruleset-title" data-ruleset={id}>Pick the rules</h2>`,
			`<p title="Your {kind} kit">Voice at {rigourLabel(r)} and {#if a > b}more{/if}</p>`,
			`<Button onclick={() => (open = x > 1)} aria-label="Close" />`,
			`<style>.ruleset { color: red }</style>`
		].join("\n")
		const shown = shownStrings(fixture)
		expect(shown.map((s) => s.text)).toEqual(["Pick the rules", "Your", "kit", "Voice at and more", "Close"])
		expect(shown[0]!.line).toBe(3)
		expect(shown[3]!.line).toBe(4)
	})

	test("proof: a banned word fails, a watched word not reviewed fails, a reviewed one and an id pass", () => {
		const file = "fixture/Fixture.svelte"
		const source = [
			`<p>Pick a ruleset for this session</p>`,
			`<p>Add a piece of armour</p>`,
			`<p>A piece of advice</p>`,
			`<code>core:ruleset/vis-itineris@1</code>`
		].join("\n")
		const hits = failing(hitsIn(file, source), [{ file, text: "A piece of advice" }], [])
		expect(hits.map((h) => [h.kind, h.word, h.line])).toEqual([
			["banned", "ruleset", 1],
			["watched", "piece", 2]
		])
		expect(hitMessage(hits[0]!)).toBe(`${file}:1 shows "ruleset" — the interface says ${BANNED.ruleset} (NOMENCLATURE §28)`)
		// A reported banned hit is let through; any other is not.
		expect(failing(hitsIn(file, source), [{ file, text: "piece" }], [{ file, text: "Pick a ruleset" }])).toEqual([])
		// Plurals, any case, and a two-word noun across a line break.
		expect(hitsIn(file, `<p>Rulesets</p><p>render\n depths</p><p>Mechanics</p>`).map((h) => h.word)).toEqual([
			"ruleset",
			"render depth",
			"mechanic"
		])
	})

	test("every exclusion, allowlist entry and reported hit still names something there", () => {
		const all = allClientFiles()
		for (const x of EXCLUDED) expect(all.some((p) => p.startsWith(x.prefix)) ? x.prefix : `missing: ${x.prefix}`).toBe(x.prefix)
		for (const e of [...ALLOWLIST, ...REPORTED]) {
			const hits = all.includes(e.file) ? hitsIn(e.file, readFileSync(join(CLIENT, e.file), "utf8")) : []
			expect(hits.some((h) => covers(e, h)) ? e.text : `no longer shown in ${e.file}: "${e.text}" — delete the entry`).toBe(
				e.text
			)
		}
	})

	test("no client file shows an SDK noun of the rulesets", () => {
		const files = clientSvelteFiles()
		expect(files.length).toBeGreaterThan(100)
		const hits = files.flatMap((f) => hitsIn(f, readFileSync(join(CLIENT, f), "utf8")))
		expect(failing(hits).map(hitMessage)).toEqual([])
	})

	test("Admin › Rulesets shows its own noun and no other (§28's admin row)", () => {
		// The exception is the word *ruleset*; repertoire, compendium, rigour and
		// the rest appear there only as ids, as everywhere else.
		const files = allClientFiles().filter((p) => p.startsWith("admin/sections/rulesets/") && p.endsWith(".svelte"))
		expect(files.length).toBeGreaterThan(5)
		const hits = files
			.flatMap((f) => hitsIn(f, readFileSync(join(CLIENT, f), "utf8")))
			.filter((h) => h.word !== "ruleset")
		expect(failing(hits).map(hitMessage)).toEqual([])
	})
})
