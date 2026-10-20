/**
 * The **web tools** (ruled 2026-10-19): `fetch_url` reads one public page as
 * text and `web_search` asks a search engine for a handful of results. Offered
 * ONLY to the assistant genres — the Guide and Chat — and only when the
 * session's `tools` field names `web`; never to a story, a lair or a crawl
 * (`webToolsAllowed`). Both are reads in the tool-loop sense: they change
 * nothing in the session and file no proposal.
 *
 * Every address is resolved and refused when any of its addresses is private
 * (loopback, RFC 1918, link-local — `isPrivateAddress`), on every redirect hop,
 * so a model cannot be talked into reading the host's own network. Bodies are
 * capped, HTML is reduced to readable text, and an error is a result the model
 * reads, never a throw out of the loop (`ToolError`).
 */
import dns from "node:dns/promises"
import { ToolError, strArg, intArg, type CoreTool, type ToolContext } from "./index"
import { isPrivateAddress } from "$lib/server/net/ipRange"

export const WEB_TOOL_NAMES: ReadonlySet<string> = new Set(["fetch_url", "web_search"])

const MAX_BODY = 1_500_000
const MAX_TEXT = 20_000
const TIMEOUT_MS = 15_000
const MAX_HOPS = 3
const UA = "SerenePub/0.6 (+https://github.com/doolijb/serene-pub)"

/** Refuse anything but a public http(s) host. */
async function assertPublic(url: URL): Promise<void> {
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new ToolError(`Only http and https addresses can be read (got ${url.protocol.replace(":", "")}).`)
	const host = url.hostname.replace(/^\[|\]$/g, "")
	if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local"))
		throw new ToolError("That address points at this machine or its own network, which the web tools never read.")
	if (isPrivateAddress(host)) throw new ToolError("That address is on a private network, which the web tools never read.")
	let addresses: { address: string }[]
	try {
		addresses = await dns.lookup(host, { all: true })
	} catch {
		throw new ToolError(`The name ${host} could not be resolved.`)
	}
	if (!addresses.length) throw new ToolError(`The name ${host} resolves to nothing.`)
	for (const a of addresses)
		if (isPrivateAddress(a.address))
			throw new ToolError("That address resolves to a private network, which the web tools never read.")
}

async function readCapped(res: Response): Promise<string> {
	const reader = res.body?.getReader()
	if (!reader) return await res.text()
	const chunks: Uint8Array[] = []
	let total = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		if (value) {
			chunks.push(value)
			total += value.byteLength
			if (total > MAX_BODY) {
				await reader.cancel().catch(() => {})
				break
			}
		}
	}
	const buf = new Uint8Array(total)
	let at = 0
	for (const c of chunks) {
		buf.set(c, at)
		at += c.byteLength
	}
	return new TextDecoder("utf-8", { fatal: false }).decode(buf)
}

const decodeEntities = (s: string) =>
	s
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))

/** HTML → readable text: drop script/style/nav chrome, keep headings and paragraphs as lines. */
export function htmlToText(html: string): { title: string; text: string } {
	const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim()
	let s = html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<head[^>]*>[\s\S]*?<\/head>/i, " ")
		.replace(/<(script|style|noscript|svg|canvas|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
		.replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
	s = decodeEntities(s)
		.split("\n")
		.map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim())
		.filter((l) => l.length)
		.join("\n")
	return { title, text: s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "\n…" : s }
}

/** GET with manual redirects, each hop re-checked. */
async function fetchPublic(raw: string, signal?: AbortSignal): Promise<{ url: string; res: Response }> {
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		throw new ToolError(`"${raw}" is not an address.`)
	}
	for (let hop = 0; hop <= MAX_HOPS; hop++) {
		await assertPublic(url)
		const ctl = new AbortController()
		const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
		const onAbort = () => ctl.abort()
		signal?.addEventListener("abort", onAbort, { once: true })
		let res: Response
		try {
			res = await fetch(url, {
				redirect: "manual",
				signal: ctl.signal,
				headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" }
			})
		} catch (err) {
			throw new ToolError(`Could not reach ${url.hostname}: ${err instanceof Error ? err.message : String(err)}`)
		} finally {
			clearTimeout(timer)
			signal?.removeEventListener("abort", onAbort)
		}
		if (res.status >= 300 && res.status < 400) {
			const to = res.headers.get("location")
			if (!to) throw new ToolError(`${url.hostname} redirected without saying where.`)
			url = new URL(to, url)
			continue
		}
		return { url: url.toString(), res }
	}
	throw new ToolError("Too many redirects.")
}

export const fetchUrl: CoreTool = {
	name: "fetch_url",
	description:
		"Read one public web page as plain text: the title and the readable text, trimmed to a few thousand words. Use it to read a page a search found, or an address the person gave you.",
	parameters: {
		type: "object",
		properties: { url: { type: "string", description: "The full address, starting with http:// or https://." } },
		required: ["url"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const raw = strArg(args, "url", "href", "link")
		if (!raw) throw new ToolError("fetch_url needs a url to read.")
		const { url, res } = await fetchPublic(raw, ctx.signal)
		if (!res.ok) throw new ToolError(`${new URL(url).hostname} answered ${res.status}.`)
		const type = (res.headers.get("content-type") ?? "").toLowerCase()
		const body = await readCapped(res)
		if (type.includes("html") || /^\s*<!doctype html|^\s*<html/i.test(body)) {
			const { title, text } = htmlToText(body)
			return { url, title, text }
		}
		if (type.startsWith("text/") || type.includes("json") || type.includes("xml"))
			return { url, title: "", text: body.length > MAX_TEXT ? body.slice(0, MAX_TEXT) + "\n…" : body }
		throw new ToolError(`That page is ${type || "not text"}; only text pages can be read.`)
	}
}

/** DuckDuckGo's HTML endpoint: no key, plain markup, results wrapped as `/l/?uddg=`. */
function parseDuckResults(html: string, limit: number): { title: string; url: string; snippet: string }[] {
	const out: { title: string; url: string; snippet: string }[] = []
	const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/g
	let m: RegExpExecArray | null
	while ((m = re.exec(html)) && out.length < limit) {
		let href = decodeEntities(m[1]!)
		const u = /[?&]uddg=([^&]+)/.exec(href)
		if (u) href = decodeURIComponent(u[1]!)
		if (href.startsWith("//")) href = "https:" + href
		const title = decodeEntities(m[2]!.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
		const snippet = decodeEntities((m[3] ?? m[4] ?? "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
		if (title && /^https?:/.test(href)) out.push({ title, url: href, snippet })
	}
	return out
}

export const webSearch: CoreTool = {
	name: "web_search",
	description:
		"Search the web for a phrase and get a few results, each with a title, address and one-line snippet. Follow up with fetch_url to read a result.",
	parameters: {
		type: "object",
		properties: {
			query: { type: "string", description: "What to search for." },
			limit: { type: "integer", description: "How many results at most. Defaults to 5." }
		},
		required: ["query"],
		additionalProperties: false
	},
	async run(args, ctx) {
		const query = strArg(args, "query", "q", "text")
		if (!query) throw new ToolError("web_search needs a query.")
		const limit = intArg(args, "limit", 5, 10)
		const { res } = await fetchPublic(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, ctx.signal)
		if (!res.ok) throw new ToolError(`The search engine answered ${res.status}.`)
		const results = parseDuckResults(await readCapped(res), limit)
		return { query, found: results.length, results }
	}
}

export const WEB_TOOLS: CoreTool[] = [webSearch, fetchUrl]

/**
 * May this session call the web tools? Only an assistant genre (family
 * `assistant`: the Guide, Chat) whose `tools` setting names `web`. Unknown
 * session ⇒ no.
 */
export async function webToolsAllowed(db: Db, sessionId: number | undefined): Promise<boolean> {
	if (sessionId === undefined) return false
	try {
		const { getSessionGenre, genreFieldsFor, STANDARD_GENRE_ID } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { eq } = await import("drizzle-orm")
		const schema = await import("$lib/server/db/schema")
		const [row] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!row) return false
		const genre = await getSessionGenre(db, row.genreId ?? STANDARD_GENRE_ID)
		if ((genre as any)?.family !== "assistant") return false
		const fields = await genreFieldsFor(db, sessionId)
		const tools = fields.tools
		return Array.isArray(tools) && tools.includes("web")
	} catch {
		return false
	}
}

/** The declarations minus the web tools when the session may not call them. */
export async function withoutForbiddenWebTools<T extends { name: string }>(
	db: Db,
	sessionId: number | undefined,
	declared: T[]
): Promise<T[]> {
	if (!declared.some((d) => WEB_TOOL_NAMES.has(d.name))) return declared
	return (await webToolsAllowed(db, sessionId)) ? declared : declared.filter((d) => !WEB_TOOL_NAMES.has(d.name))
}

export type { ToolContext }
