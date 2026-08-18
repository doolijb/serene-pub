/**
 * Runtime merging of CSP_EXTRA_* sources into the Content-Security-Policy
 * header SvelteKit already produced.
 *
 * These variables were read only in svelte.config.js, i.e. at BUILD time. No
 * published artifact passes them at build: the Dockerfile doesn't, and the
 * release workflow doesn't — so every prebuilt Docker image and desktop zip
 * baked in empty values and a user's .env setting did nothing at all. The
 * variable appeared to exist and silently had no effect.
 *
 * Merging rather than replacing is not a stylistic choice. SvelteKit's
 * `csp: { mode: "auto" }` injects a nonce (SSR) or hash (prerender) for its
 * own inline hydration script, and only SvelteKit knows that value — a
 * hand-rolled replacement header drops it and breaks hydration silently (the
 * symptom is a dead UI, not a console error).
 */

/** Which env var contributes to which directive. */
const EXTRA_BY_DIRECTIVE: Record<string, string> = {
	"script-src": "CSP_EXTRA_SCRIPT_SRC",
	"style-src": "CSP_EXTRA_STYLE_SRC",
	"connect-src": "CSP_EXTRA_CONNECT_SRC"
}

/**
 * A source expression must be a single token. Anything containing a semicolon,
 * comma, whitespace or control character could inject an entire additional
 * directive — `CSP_EXTRA_SCRIPT_SRC="x; script-src 'unsafe-inline'"` would
 * otherwise rewrite the policy rather than extend it. This is env-controlled
 * header content, so the check is mandatory, not defensive politeness.
 *
 * Control characters are checked by code point rather than by a regex range so
 * no literal control bytes end up embedded in this source file, and so that
 * ordinary punctuation — hyphens in particular, which are everywhere in real
 * hostnames — is unambiguously left alone.
 */
function isSafeSource(source: string): boolean {
	if (!source) return false
	if (/[;,\s]/.test(source)) return false
	for (let i = 0; i < source.length; i++) {
		const code = source.charCodeAt(i)
		if (code < 0x20 || code === 0x7f) return false
	}
	return true
}

let cache: { raw: string; extras: Record<string, string[]> } | null = null
let hasWarnedAboutRejected = false
const warnedMissingDirectives = new Set<string>()

/** Parsed CSP_EXTRA_* values, cached against the exact env strings they came
 * from — the startup bootstrap and tests both mutate process.env. */
export function getCspExtras(): Record<string, string[]> {
	const raw = Object.values(EXTRA_BY_DIRECTIVE)
		.map((v) => `${v}=${process.env[v] ?? ""}`)
		.join(" ")
	if (cache?.raw === raw) return cache.extras

	const extras: Record<string, string[]> = {}
	const rejected: string[] = []
	for (const [directive, envVar] of Object.entries(EXTRA_BY_DIRECTIVE)) {
		const sources = (process.env[envVar] || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
		const safe = sources.filter((s) => {
			if (isSafeSource(s)) return true
			rejected.push(`${envVar}: ${s}`)
			return false
		})
		if (safe.length > 0) extras[directive] = safe
	}

	if (rejected.length > 0 && !hasWarnedAboutRejected) {
		hasWarnedAboutRejected = true
		console.warn(
			"[Security] Ignored malformed CSP_EXTRA_* source(s) — a source must " +
				"be a single token with no semicolons, commas or whitespace: " +
				rejected.join(" | ")
		)
	}

	cache = { raw, extras }
	return extras
}

/**
 * Append configured extra sources to an existing CSP header value.
 *
 * Directive names are matched case-insensitively but every existing token is
 * re-emitted byte-for-byte, so SvelteKit's nonce/hash survives untouched.
 * A directive that is not already present is skipped rather than created:
 * introducing e.g. `style-src` where only `default-src` existed would NARROW
 * the effective policy and break the page — the opposite of what the admin
 * asked for. Returns the input unchanged when nothing is configured.
 *
 * Safe only because SvelteKit does not emit `'strict-dynamic'`: under that
 * keyword, host source expressions in `script-src` are ignored outright, and
 * this merge would silently stop having any effect.
 */
export function mergeCspExtras(header: string): string {
	const extras = getCspExtras()
	const wanted = Object.keys(extras)
	if (wanted.length === 0) return header

	const directives = header
		.split(";")
		.map((d) => d.trim())
		.filter(Boolean)

	const present = new Set(
		directives.map((d) => d.split(/\s+/)[0].toLowerCase())
	)

	const merged = directives.map((directive) => {
		const tokens = directive.split(/\s+/)
		const name = tokens[0].toLowerCase()
		const additions = extras[name]
		if (!additions) return directive
		const existing = new Set(tokens.slice(1))
		const toAdd = additions.filter((s) => !existing.has(s))
		if (toAdd.length === 0) return directive
		return `${directive} ${toAdd.join(" ")}`
	})

	for (const name of wanted) {
		if (!present.has(name) && !warnedMissingDirectives.has(name)) {
			warnedMissingDirectives.add(name)
			console.warn(
				`[Security] ${EXTRA_BY_DIRECTIVE[name]} is set, but the ` +
					`Content-Security-Policy header has no "${name}" directive ` +
					"to extend, so it was ignored. Adding the directive here " +
					"would restrict what is currently allowed by a broader " +
					"fallback, not widen it."
			)
		}
	}

	return merged.join("; ")
}
