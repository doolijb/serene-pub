/**
 * Redaction for the admin **support report** — the ONE function every value
 * in a report passes through before it leaves the server.
 *
 * A support report is made to be pasted into a public issue or handed to an
 * AI assistant, so it must be safe to share by construction rather than by
 * the care of whoever gathered each field. Everything the gatherer collects
 * goes through `redactForSupport` once, as a whole, and the renderer only
 * formats what comes out.
 *
 * What it removes (and `REDACTION_SUMMARY` says the same to the reader):
 * - secrets: values under secret-shaped keys, `key=value` secrets in text,
 *   bearer tokens, well-known key prefixes (`sk-`, `ghp_`, `hf_`, …), JWTs and
 *   long opaque strings;
 * - credentials inside URLs and every URL's query string;
 * - email addresses;
 * - IP addresses and host names, except loopback and a short list of
 *   well-known public services (`PUBLIC_HOSTS`), which say where a plugin's
 *   source lives or which cloud API a connection calls;
 * - the instance's user names and display names (→ `user#<id>`) and this
 *   machine's name;
 * - paths under the home directory (→ `~`);
 * - a failed query's bound values (drizzle's `params:` line → `[params withheld]`):
 *   they are whatever the query wrote — message text, lore — and the report
 *   promises never to carry content. The query's SQL stays; it is the shape.
 *
 * Pure: nothing here reads the environment. The caller passes the home
 * directory, machine name and people in `RedactionContext`.
 */

import { withoutQueryParams } from "$lib/server/db/errors"

export interface RedactionContext {
	/** `os.homedir()`; replaced by `~` wherever it appears. */
	homeDir?: string | null
	/** `os.hostname()`; replaced by `[machine]`. */
	machineName?: string | null
	/** Every account's names, each replaced by `user#<id>`. */
	people?: Array<{ id: number; names: Array<string | null | undefined> }>
}

export const REDACTION_SUMMARY =
	"API keys, tokens, passwords and other secrets; credentials and query strings in URLs; " +
	"email addresses; IP addresses and host names other than localhost and well-known public " +
	"services; user names (shown as user#N) and this machine's name; paths under the home " +
	"directory (shown as ~). Message text, character and lore content are never included."

/** Kept as written: public services whose name helps and identifies nobody. */
export const PUBLIC_HOSTS: readonly string[] = [
	"github.com",
	"raw.githubusercontent.com",
	"gitlab.com",
	"codeberg.org",
	"bitbucket.org",
	"npmjs.com",
	"www.npmjs.com",
	"registry.npmjs.org",
	"huggingface.co",
	"api.openai.com",
	"api.anthropic.com",
	"openrouter.ai",
	"api.mistral.ai",
	"api.groq.com",
	"api.together.xyz",
	"api.deepseek.com",
	"generativelanguage.googleapis.com",
	"api.x.ai",
	"api.cohere.com",
	"api.fireworks.ai",
	"api.novelai.net",
	"serenepub.com",
	"www.serenepub.com",
	"docs.serenepub.com",
	// Package names that read as host names in the report's version table.
	"socket.io"
]

/** Names too generic to scrub from text without mangling it. */
const GENERIC_NAMES = new Set([
	"admin",
	"administrator",
	"user",
	"users",
	"root",
	"guest",
	"owner",
	"system",
	"test",
	"default",
	"local",
	"player",
	"narrator",
	"serene",
	"pub",
	"you",
	"me"
])

const REDACTED = "[redacted]"

/**
 * A key whose value is a secret whatever it looks like — judged by how the
 * key ENDS, so `accessToken` and `recovery_key_hash` go while `tokenCounter`
 * and `recentRecoveryActions` stay.
 */
const SECRET_KEY =
	/(pass(word|wd|phrase)?|secret|token|api[_-]?key|apikey|auth(orization)?|cookie|credentials?|private[_-]?key|recovery[_-]?key|key[_-]?hash|password[_-]?hash|totp|otp|emails?)$/i

const LOOPBACK_HOSTS = new Set([
	"localhost",
	"127.0.0.1",
	"0.0.0.0",
	"::1",
	"[::1]",
	"::",
	"[::]",
	"host.docker.internal"
])

function isKeptHost(host: string): boolean {
	const h = host.toLowerCase()
	if (LOOPBACK_HOSTS.has(h) || h.endsWith(".localhost")) return true
	if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true
	return PUBLIC_HOSTS.includes(h)
}

function ipv4Class(ip: string): "loopback" | "private" | "public" {
	const [a, b] = ip.split(".").map(Number)
	if (a === 127 || ip === "0.0.0.0") return "loopback"
	if (
		a === 10 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254) ||
		(a === 100 && b >= 64 && b <= 127)
	)
		return "private"
	return "public"
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`)]+/gi
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)"
// Not after `Name/`: `Chrome/147.0.0.0` is a product version, not an address.
const IPV4_RE = new RegExp(`(?<![\\d.])(?<![A-Za-z]\\/)${OCTET}(?:\\.${OCTET}){3}(?![\\d.])`, "g")
// Requires a `::` or a hex letter, so `12:34:56` (a clock) is never an address.
const IPV6_RE =
	/(?<![\w:])(?=[0-9a-f:]*(?:::|[a-f]))(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const HOSTNAME_RE =
	/(?<![\w@/.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|app|ai|co|me|xyz|info|cloud|site|online|tech|local|lan|home|internal|arpa|us|uk|de|fr|nl|ca|au|jp|eu|sh|run|page|link)(?![\w-])/gi
const KEY_VALUE_RE =
	/\b(api[_-]?key|apikey|x-api-key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd|authorization|cookie|session[_-]?id|recovery[_-]?key)(["']?\s*[:=]\s*["']?)([^\s"',;&})\]]+)/gi
const BEARER_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g
const KNOWN_KEY_RE =
	/\b(?:sk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|hf_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,})/g
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g
// Long, mixed letters-and-digits, no path separators: keys and cookies, not prose.
const OPAQUE_RE = /(?<![\w/-])(?=[A-Za-z0-9_+-]*\d)(?=[A-Za-z0-9_+-]*[A-Za-z])[A-Za-z0-9_+-]{40,}={0,2}(?![\w/])/g
const HOME_PATH_RE =
	/(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\|[A-Za-z]:\/Users\/)[^/\\\s"'`]+/g

function redactUrl(url: string): string {
	let out = url
	// Trailing punctuation belongs to the sentence, not the URL.
	const trail = /[.,;:!?]+$/.exec(out)?.[0] ?? ""
	if (trail) out = out.slice(0, -trail.length)
	const m = /^([a-z][a-z0-9+.-]*:\/\/)(?:([^@/?#]*)@)?(\[[^\]]*\]|[^/:?#]*)(.*)$/i.exec(out)
	if (!m) return url
	const [, scheme, creds, host, rest0] = m
	// A file URL has no host to hide; its path was already folded to `~`.
	if (/^file:/i.test(scheme)) return url
	let rest = rest0
	const q = rest.search(/[?#]/)
	if (q !== -1) rest = rest.slice(0, q) + (rest[q] === "?" ? "?[redacted]" : "")
	const keptHost = isKeptHost(host)
	return (
		scheme +
		(creds !== undefined ? "[redacted]@" : "") +
		(keptHost ? host : "[host]") +
		// A non-public host's path can name a tenant or a user; its port cannot.
		(keptHost ? rest : (/^:\d+/.exec(rest)?.[0] ?? "") + (rest.replace(/^:\d+/, "") ? "/…" : "")) +
		trail
	)
}

function redactPlainText(text: string, ctx: RedactionContext, people: PeopleMatcher | null): string {
	let s = text
	s = s.replace(EMAIL_RE, "[email]")
	s = s.replace(BEARER_RE, (_m, kind) => `${kind} ${REDACTED}`)
	s = s.replace(KNOWN_KEY_RE, REDACTED)
	s = s.replace(JWT_RE, REDACTED)
	s = s.replace(KEY_VALUE_RE, (_m, k, sep) => `${k}${sep}${REDACTED}`)
	s = s.replace(IPV4_RE, (ip) => {
		const c = ipv4Class(ip)
		return c === "loopback" ? ip : `[ip:${c}]`
	})
	s = s.replace(IPV6_RE, (ip) => (ip === "::1" || ip === "::" ? ip : "[ip:v6]"))
	s = s.replace(HOSTNAME_RE, (h) => (isKeptHost(h) ? h : "[host]"))
	s = s.replace(OPAQUE_RE, REDACTED)
	if (ctx.machineName && ctx.machineName.length >= 3 && !GENERIC_NAMES.has(ctx.machineName.toLowerCase()))
		s = s.replace(new RegExp(`\\b${escapeRe(ctx.machineName)}\\b`, "gi"), "[machine]")
	if (people) s = s.replace(people.re, (m) => people.alias.get(m.toLowerCase()) ?? m)
	return s
}

interface PeopleMatcher {
	re: RegExp
	/** Lower-cased name → `user#<id>`. */
	alias: Map<string, string>
}

function peopleMatcher(ctx: RedactionContext): PeopleMatcher | null {
	const peopleAlias = new Map<string, string>()
	for (const p of ctx.people ?? []) {
		for (const raw of p.names) {
			const name = raw?.trim()
			if (!name || name.length < 3 || GENERIC_NAMES.has(name.toLowerCase())) continue
			if (!peopleAlias.has(name.toLowerCase())) peopleAlias.set(name.toLowerCase(), `user#${p.id}`)
		}
	}
	if (!peopleAlias.size) return null
	// Longest first, so "Jody Smith" wins over "Jody".
	const names = [...peopleAlias.keys()].sort((a, b) => b.length - a.length).map(escapeRe)
	return {
		re: new RegExp(`(?<![\\w#])(?:${names.join("|")})(?![\\w])`, "gi"),
		alias: peopleAlias
	}
}

function redactString(text: string, ctx: RedactionContext, people: PeopleMatcher | null): string {
	let s = withoutQueryParams(text)
	if (ctx.homeDir && ctx.homeDir.length > 1) {
		s = s.split(ctx.homeDir).join("~")
		const alt = ctx.homeDir.includes("\\") ? ctx.homeDir.replace(/\\/g, "/") : null
		if (alt) s = s.split(alt).join("~")
	}
	s = s.replace(HOME_PATH_RE, "~")
	// URLs are judged whole; the text around them goes through the rest.
	let out = ""
	let last = 0
	for (const m of s.matchAll(URL_RE)) {
		out += redactPlainText(s.slice(last, m.index), ctx, people)
		out += redactUrl(m[0])
		last = m.index! + m[0].length
	}
	out += redactPlainText(s.slice(last), ctx, people)
	return out
}

function walk(value: unknown, ctx: RedactionContext, people: PeopleMatcher | null, key?: string): unknown {
	if (value == null || typeof value === "boolean" || typeof value === "number") return value
	if (key && SECRET_KEY.test(key)) return REDACTED
	if (typeof value === "string") return redactString(value, ctx, people)
	if (Array.isArray(value)) return value.map((v) => walk(v, ctx, people))
	if (value instanceof Date) return value.toISOString()
	if (typeof value === "object") {
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value as Record<string, unknown>))
			out[k] = walk(v, ctx, people, k)
		return out
	}
	return String(value)
}

/**
 * Redact a string or any JSON-shaped value, deeply.
 *
 * Numbers, booleans and null pass untouched, even under a secret-shaped key
 * (`tokensSpent: 512`, `requireTwoFactor: true` say nothing secret); a
 * string, object or array under such a key becomes `[redacted]` whole.
 */
export function redactForSupport<T>(value: T, ctx: RedactionContext = {}): T {
	const people = peopleMatcher(ctx)
	return walk(value, ctx, people) as T
}
