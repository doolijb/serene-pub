// scripts/licenseExpression.js
//
// The SPDX license-expression evaluator used by bundle-dist.js's license
// gate, split out so it can be imported without also running bundle-dist.js's
// CLI section (which reads process.argv and calls process.exit). Side-effect
// free: importing this module only defines the exports below.

// Whitelist for packages with UNKNOWN license but known to be MIT
export const LICENSE_WHITELIST = [
	{ name: "json-bignum", version: "0.0.3" },
	{ name: "xmlhttprequest-ssl", version: "2.1.2" },
	{ name: "@img/sharp-libvips-linux-x64", version: "1.2.4" },
	{ name: "@img/sharp-libvips-linuxmusl-x64", version: "1.2.4" },
	{ name: "@img/sharp-libvips-darwin-arm64", version: "1.2.4" },
	{ name: "@img/sharp-libvips-darwin-x64", version: "1.2.4" },
	{ name: "@img/sharp-darwin-arm64", version: "0.34.5" },
	{ name: "@img/sharp-darwin-x64", version: "0.34.5" },
	{ name: "@img/sharp-linux-x64", version: "0.34.5" },
	{ name: "@img/sharp-linux-arm64", version: "0.34.5" },
	{ name: "@img/sharp-win32-x64", version: "0.34.5" },
	{ name: "@img/sharp-win32-arm64", version: "0.34.5" },
	{ name: "json-schema", version: "0.4.0" },
	{ name: "type-fest", version: "0.13.1" }
]

export function isWhitelisted(name, version) {
	return LICENSE_WHITELIST.some(
		(pkg) => pkg.name === name && pkg.version === version
	)
}

// Acceptable licenses for redistribution with AGPL app
export const ACCEPTABLE_LICENSES = [
	// SIL Open Font License — the standard permissive licence for fonts, and
	// what @fontsource/* ships under. Not needed by CI, which runs
	// `npm install --production` before bundling so dev dependencies are gone
	// by the time the check below scans node_modules. It matters when running
	// `npm run dist` locally with dev dependencies installed, where
	// @fontsource/fira-mono (a devDependency) is otherwise reported as an
	// unacceptable licence and aborts the bundle.
	"ofl-1.1",
	"mit",
	"isc",
	"bsd-2-clause",
	"bsd-3-clause",
	"0bsd",
	"wtfpl",
	"apache-2.0",
	"afl-2.1",
	"afl-2.1 or bsd-3-clause",
	"agpl-3.0",
	"agpl-3.0-only",
	"agpl-3.0-or-later",
	"lgpl-3.0",
	"lgpl-3.0-only",
	"lgpl-3.0-or-later",
	// elkjs is dual-licensed "EPL-2.0 OR GPL-3.0-or-later". We deliberately
	// elect the GPL-3.0-or-later side of that grant (not EPL-2.0): AGPL-3.0
	// §13 provides for compatibility with the GNU GPL, making GPL-3.0-or-later
	// the sound choice of the two for this AGPL-3.0-licensed application.
	"gpl-3.0-or-later",
	"blueoak-1.0.0",
	"bsd",
	"bsd-2-clause or mit or apache-2.0",
	"bsd-2-clause or mit",
	"bsd-3-clause or mit",
	"bsd-2-clause or mit or apache-2.0",
	"apache-2.0 or mit",
	"apache-2.0 or bsd-3-clause",
	"apache-2.0 or mit or bsd-3-clause",
	"apache-2.0 or mit or bsd-2-clause",
	"mit or wtfpl",
	"mit or bsd-2-clause",
	"mit or bsd-3-clause",
	"mit or apache-2.0",
	"mit or isc",
	"isc or mit",
	"0bsd or mit",
	"bsd-2-clause or mit or apache-2.0",
	"bsd-3-clause or mit or apache-2.0",
	"bsd-3-clause or mit or apache-2.0",
	"bsd-2-clause or mit or apache-2.0",
	"bsd-3-clause or mit or apache-2.0",
	"bsd-2-clause or mit",
	"bsd-3-clause or mit",
	"bsd-2-clause or apache-2.0",
	"bsd-3-clause or apache-2.0",
	"bsd-2-clause or bsd-3-clause",
	"bsd-3-clause or bsd-2-clause",
	"public domain",
	"unlicense",
	"cc0-1.0",
	"cc0",
	"0bsd",
	"bsd-2-clause-freebsd",
	"bsd-3-clause-clear",
	"bsd-3-clause-new",
	"bsd-3-clause-revised",
	"bsd-3-clause-simplified",
	"bsd-3-clause-modified",
	"bsd-3-clause",
	"bsd-2-clause",
	"bsd",
	"wtfpl",
	"isc",
	"mit",
	"apache-2.0",
	"agpl-3.0",
	"agpl-3.0-only",
	"agpl-3.0-or-later",
	"bsd-2-clause or mit or apache-2.0",
	"bsd-3-clause or mit or apache-2.0",
	"bsd-2-clause or mit",
	"bsd-3-clause or mit",
	"bsd-2-clause or apache-2.0",
	"bsd-3-clause or apache-2.0",
	"bsd-2-clause or bsd-3-clause",
	"bsd-3-clause or bsd-2-clause",
	"public domain",
	"unlicense",
	"cc0-1.0",
	"cc0",
	"0bsd",
	"bsd-2-clause-freebsd",
	"bsd-3-clause-clear",
	"bsd-3-clause-new",
	"bsd-3-clause-revised",
	"bsd-3-clause-simplified",
	"bsd-3-clause-modified",
	"bsd-3-clause",
	"bsd-2-clause",
	"bsd",
	"python-2.0",
	"lgpl-3.0",
	"lgpl-3.0-only",
	"lgpl-3.0-or-later",
	"lgpl-3.0 or later",
	"apache-2.0 and lgpl-3.0-or-later",
	"apache-2.0 and lgpl-3.0",
	"apache-2.0 or lgpl-3.0-or-later",
	"mpl-2.0"
]

export function isAcceptableLicense(license, name, version) {
	if (!license) return false
	// Handle license objects and arrays from package.json
	if (typeof license === "object") {
		if (Array.isArray(license)) {
			license = license
				.map((l) => (typeof l === "string" ? l : l.type || ""))
				.join(" or ")
		} else {
			license = license.type || license.license || ""
		}
	}
	// Special case: whitelist
	if (isWhitelisted(name, version)) return true
	// npm SPDX dual/multi-license expressions are sometimes wrapped in a
	// single pair of outer parens, e.g. "(MPL-2.0 OR Apache-2.0)" — unwrap
	// that first so the blanket parenthetical-notes removal below (meant for
	// trailing annotations like "MIT (see LICENSE)") doesn't delete the
	// entire license expression and leave nothing to check.
	let cleaned = String(license).trim()
	if (/^\(.*\)$/.test(cleaned)) {
		cleaned = cleaned.slice(1, -1)
	}
	// Anything still parenthesised here is either a trailing note ("MIT (see
	// LICENSE)") or a grouped sub-expression ("MIT AND (GPL-2.0 OR EPL-2.0)").
	// This evaluator deliberately does NOT implement grouping, and the
	// note-stripper below would delete a group along with its operator, leaving
	// whichever token happened to survive to be judged on its own. So a
	// parenthetical that contains a license operator is treated as unparseable
	// and rejected outright: on a license gate, failing closed costs a release
	// that someone notices immediately, while failing open ships a violation
	// that nobody notices at all.
	if (/\([^)]*(?:\s(?:or|and)\s|\|\||&&|,|\/)[^)]*\)/i.test(cleaned)) {
		return false
	}
	// Normalize some common noise and lowercase
	cleaned = cleaned
		.replace(/\s*\(.*?\)\s*/g, "") // remove remaining parenthesized notes
		.replace(/\s*license:\s*/i, "")
		.replace(/\s*the\s*/i, "")
		.toLowerCase()
	// Evaluate the expression with SPDX semantics, where AND binds tighter than
	// OR: "A AND B OR C" means "(A AND B) OR C". So split the top level on OR
	// first, then split each alternative on AND.
	//
	//   OR  — acceptable if ANY alternative is acceptable. Electing one side is
	//         the entire point of a dual grant (elkjs ships as "EPL-2.0 OR
	//         GPL-3.0-or-later"; this project elects GPL-3.0-or-later).
	//   AND — acceptable only if EVERY conjunct is acceptable. Both licenses'
	//         obligations apply simultaneously, so one unacceptable term poisons
	//         the whole expression.
	//
	// These must not be collapsed into a single `.some()` over a flattened list:
	// that would wave "MIT AND GPL-2.0" through on the strength of MIT alone.
	//
	// The word separators (or/and) require surrounding whitespace so they
	// only match as standalone words, not as substrings of a license id like
	// "gpl-3.0-or-later" (where "or" is flanked by hyphens, not whitespace).
	// The symbolic separators (||, &&, ,, /) have no such ambiguity and keep
	// matching with only optional whitespace around them.
	const alternatives = cleaned
		.split(/\s+or\s+|\s*(?:\|\||,|\/)\s*/i)
		.filter((s) => s.trim())
	return alternatives.some((alternative) => {
		const conjuncts = alternative
			.split(/\s+and\s+|\s*&&\s*/i)
			.map((l) => l.trim())
			.filter(Boolean)
		return (
			conjuncts.length > 0 &&
			conjuncts.every((l) => ACCEPTABLE_LICENSES.includes(l))
		)
	})
}
