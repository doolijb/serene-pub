#!/usr/bin/env node
/**
 * The class list an authored component is checked against (D5).
 *
 * The app's utility classes are generated at build time from the classes
 * its own code uses (Tailwind scans the source), so a class nothing in the
 * app uses is simply absent from the built CSS and does nothing in a
 * component. This reads every stylesheet the client build emitted, takes
 * each class selector out of it (unescaped: `.md\:flex` is `md:flex`), and
 * writes the sorted, de-duplicated list to `build/component-classes.json`.
 * The component compile service loads it and hands it to the compiler as
 * `knownClasses`; with no file (a dev server that was never built, Android)
 * classes are simply not checked.
 *
 * Run after `vite build` (scripts/customize-build.js calls it), or alone:
 * `node scripts/component-classes.js [buildDir]`.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** The file name, inside the build directory, the compile service reads. */
export const COMPONENT_CLASSES_FILE = "component-classes.json"

/**
 * A CSS identifier's escapes undone: `\:` is `:`, `\32 xl` is `2xl`.
 * @param {string} raw
 * @returns {string}
 */
function unescapeIdent(raw) {
	return raw.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([\s\S]))/g, (/** @type {string} */ _, /** @type {string | undefined} */ hex, /** @type {string} */ ch) =>
		hex ? String.fromCodePoint(parseInt(hex, 16)) : ch
	)
}

/**
 * Every class name a stylesheet's selectors name, sorted and unique.
 * Comments, strings and `url(…)` are skipped first, and only the text before
 * each `{` (a rule's prelude, past any declaration) is read, so a `0.5rem` or
 * a `font.woff2` is never mistaken for a class.
 * @param {string} css
 * @returns {string[]}
 */
export function cssClassNames(css) {
	const text = String(css)
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, " ")
		.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, '""')
	/** @type {Set<string>} */
	const names = new Set()
	const ident = /\.(-?(?:[_a-zA-Z\u00a0-\uffff]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[\s\S]))(?:[\w\u00a0-\uffff-]|\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[\s\S]))*)/g
	const parts = text.split("{")
	for (let i = 0; i < parts.length - 1; i++) {
		// What precedes this `{`: after the last `}` or `;`, the prelude.
		const chunk = parts[i]
		const prelude = chunk.slice(Math.max(chunk.lastIndexOf("}"), chunk.lastIndexOf(";")) + 1)
		if (/^\s*@/.test(prelude)) continue
		for (const m of prelude.matchAll(ident)) names.add(unescapeIdent(/** @type {string} */ (m[1])))
	}
	return [...names].sort()
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function cssFiles(dir) {
	if (!fs.existsSync(dir)) return []
	/** @type {string[]} */
	const out = []
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) out.push(...cssFiles(full))
		else if (entry.name.endsWith(".css")) out.push(full)
	}
	return out
}

/**
 * Write `<buildDir>/component-classes.json` from `<buildDir>/client`'s stylesheets.
 * @param {string} [buildDir]
 * @param {string} [outFile]
 * @returns {{ classes: number, stylesheets: number, outFile: string }}
 */
export function writeComponentClasses(buildDir = "build", outFile = path.join(buildDir, COMPONENT_CLASSES_FILE)) {
	const files = cssFiles(path.join(buildDir, "client")).sort()
	/** @type {Set<string>} */
	const names = new Set()
	for (const file of files) for (const name of cssClassNames(fs.readFileSync(file, "utf8"))) names.add(name)
	const list = [...names].sort()
	fs.writeFileSync(outFile, JSON.stringify(list) + "\n")
	return { classes: list.length, stylesheets: files.length, outFile }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const r = writeComponentClasses(process.argv[2] ?? "build", process.argv[3])
	console.log(`✅ Wrote ${r.outFile}: ${r.classes} classes from ${r.stylesheets} stylesheets`)
}
