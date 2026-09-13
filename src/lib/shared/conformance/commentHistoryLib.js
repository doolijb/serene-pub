import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * Plain JavaScript on purpose. `scripts/comments-ratchet.js` runs this with
 * bare `node`, outside any build step, and `commentHistory.test.ts` imports
 * the same file under vitest — one module, so the two never disagree about
 * what a "hit" is.
 */

/** @typedef {{ name: string, source: string }} Phrase */
/** @typedef {{ text: string, start: number }} Comment */
/** @typedef {{ phrase: string, line: number, text: string }} Offender */
/** @typedef {{ count: number, offenders: Offender[] }} FileReport */
/**
 * @typedef {{
 *   total: number,
 *   byFile: Record<string, number>,
 *   offendersByFile: Record<string, Offender[]>
 * }} Report
 */

/**
 * Phrases that tell a story instead of stating a rule. Each is a whole word
 * or fixed phrase, not a stem, so it only fires on the narrative sense.
 *
 * @type {Phrase[]}
 */
export const PHRASES = [
	{ name: "used to", source: "\\bused to\\b" },
	{ name: "until 0NNN", source: "\\buntil 0\\d{3}\\b" },
	{ name: "since 0NNN", source: "\\bsince 0\\d{3}\\b" },
	{ name: "was once", source: "\\bwas once\\b" },
	{ name: "previously", source: "\\bpreviously\\b" },
	{ name: "no longer", source: "\\bno longer\\b" },
	{ name: "the first version", source: "\\bthe first version\\b" },
	{
		name: "this file exists because",
		source: "\\bthis file exists because\\b"
	},
	{ name: "the whole reason", source: "\\bthe whole reason\\b" },
	{ name: "deliberately not", source: "\\bdeliberately not\\b" }
]

/**
 * A comment's text plus where it starts in the file, so a phrase match inside
 * it can be traced back to a line number.
 *
 * @param {string} code
 * @returns {Comment[]}
 */
function extractJsComments(code) {
	/** @type {Comment[]} */
	const comments = []
	const n = code.length

	// Raw text between backticks. `${…}` switches back to `scanCode` so a
	// comment or string written inside an interpolation is still found;
	// everything else between backticks is template text, not code, and is
	// never scanned for `//` or `/*`.
	/**
	 * @param {number} i
	 * @returns {number}
	 */
	function scanTemplateRaw(i) {
		while (i < n) {
			const c = code[i]
			if (c === "\\") {
				i += 2
				continue
			}
			if (c === "`") return i + 1
			if (c === "$" && code[i + 1] === "{") {
				i = scanCode(i + 2, true)
				continue
			}
			i++
		}
		return i
	}

	// `stopAtBraceClose` is set while scanning a `${…}` interpolation: it
	// tracks nested `{`/`}` so the scan stops at the brace that actually
	// closes the interpolation, not the first `}` a nested object literal
	// happens to contain.
	/**
	 * @param {number} i
	 * @param {boolean} stopAtBraceClose
	 * @returns {number}
	 */
	function scanCode(i, stopAtBraceClose) {
		let depth = 0
		while (i < n) {
			const c = code[i]
			const c2 = code[i + 1]
			if (c === "/" && c2 === "/") {
				let j = i + 2
				while (j < n && code[j] !== "\n") j++
				comments.push({ text: code.slice(i, j), start: i })
				i = j
				continue
			}
			if (c === "/" && c2 === "*") {
				let j = code.indexOf("*/", i + 2)
				j = j === -1 ? n : j + 2
				comments.push({ text: code.slice(i, j), start: i })
				i = j
				continue
			}
			if (c === '"' || c === "'") {
				const quote = c
				i++
				while (i < n && code[i] !== quote) {
					if (code[i] === "\\") i++
					i++
				}
				i++
				continue
			}
			if (c === "`") {
				i = scanTemplateRaw(i + 1)
				continue
			}
			if (stopAtBraceClose && c === "{") {
				depth++
				i++
				continue
			}
			if (stopAtBraceClose && c === "}") {
				if (depth === 0) return i + 1
				depth--
				i++
				continue
			}
			i++
		}
		return i
	}

	scanCode(0, false)
	return comments
}

/**
 * One `<tag ...>…</tag>` block's inner text and where it starts.
 *
 * @param {string} code
 * @param {string} tagName
 * @returns {Comment[]}
 */
function extractBlocks(code, tagName) {
	/** @type {Comment[]} */
	const blocks = []
	const openRe = new RegExp(`<${tagName}\\b[^>]*>`, "gi")
	let m
	while ((m = openRe.exec(code))) {
		const contentStart = m.index + m[0].length
		const closeIdx = code.indexOf(`</${tagName}>`, contentStart)
		const contentEnd = closeIdx === -1 ? code.length : closeIdx
		blocks.push({
			text: code.slice(contentStart, contentEnd),
			start: contentStart
		})
		if (closeIdx === -1) break
		openRe.lastIndex = closeIdx + tagName.length + 3
	}
	return blocks
}

/**
 * A `.svelte` file's comments: `<!-- -->` anywhere, plus `//` and `/* *\/`
 * inside its `<script>` and `<style>` blocks. Markup text is never scanned
 * for `//` or `/* *\/` — an apostrophe in prose reads as an unterminated
 * string to a JS-shaped scanner, so only script/style content (which is
 * actually JS/CSS) goes through `extractJsComments`.
 *
 * @param {string} code
 * @returns {Comment[]}
 */
function extractSvelteComments(code) {
	/** @type {Comment[]} */
	const comments = []
	const htmlRe = /<!--[\s\S]*?-->/g
	let m
	while ((m = htmlRe.exec(code)))
		comments.push({ text: m[0], start: m.index })
	for (const tag of ["script", "style"])
		for (const block of extractBlocks(code, tag))
			for (const c of extractJsComments(block.text))
				comments.push({ text: c.text, start: c.start + block.start })
	return comments
}

/**
 * Every phrase-list hit in one file: where it is, and the source line it's on.
 *
 * @param {string} absPath
 * @returns {FileReport}
 */
export function fileReport(absPath) {
	const code = readFileSync(absPath, "utf8")
	const comments = absPath.endsWith(".svelte")
		? extractSvelteComments(code)
		: extractJsComments(code)
	const lines = code.split("\n")
	/** @type {Offender[]} */
	const offenders = []
	for (const comment of comments) {
		for (const phrase of PHRASES) {
			const re = new RegExp(phrase.source, "gi")
			let m
			while ((m = re.exec(comment.text))) {
				const absIndex = comment.start + m.index
				const line =
					1 + (code.slice(0, absIndex).match(/\n/g) ?? []).length
				offenders.push({
					phrase: phrase.name,
					line,
					text: lines[line - 1].trim()
				})
			}
		}
	}
	return { count: offenders.length, offenders }
}

/** @param {string} name */
const isExcluded = (name) => /\.test\.ts$/.test(name)

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function walkSrc(dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules") walkSrc(p, out)
		} else if (
			/\.(?:ts|svelte)$/.test(entry.name) &&
			!isExcluded(entry.name)
		) {
			out.push(p)
		}
	}
	return out
}

/**
 * Every file under `src/` with at least one phrase-list hit, keyed by its
 * path relative to `rootDir`.
 *
 * @param {string} rootDir
 * @returns {Report}
 */
export function computeReport(rootDir) {
	const srcDir = join(rootDir, "src")
	/** @type {Record<string, number>} */
	const byFile = {}
	/** @type {Record<string, Offender[]>} */
	const offendersByFile = {}
	let total = 0
	for (const abs of walkSrc(srcDir)) {
		const { count, offenders } = fileReport(abs)
		if (count === 0) continue
		const rel = relative(rootDir, abs)
		byFile[rel] = count
		offendersByFile[rel] = offenders
		total += count
	}
	return { total, byFile, offendersByFile }
}
