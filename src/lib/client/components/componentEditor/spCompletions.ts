/**
 * Completions for the host elements (C6, P6): the tags a component may draw,
 * each tag's attributes and events, and the named slots — generated from the
 * SDK's one table, `SP_HOST_ELEMENTS`, so the editor offers exactly what the
 * host's receiver accepts and never a second list kept in step by hand.
 *
 * Pure: it reads the text before the cursor and answers what to offer and
 * where the word being completed starts. `CodeEditor.svelte` wraps it as a
 * CodeMirror completion source; `spCompletions.test.ts` holds it to the table.
 *
 * In a `.svelte` file it completes markup: `<sp-` → tags, inside a tag →
 * attributes, `on<event>` handlers (Svelte 5's spelling) and `slot`, and
 * inside `slot="` → slot names. In a `.ts`/`.js` file (a vanilla component)
 * it completes the tag inside `createElement('…')`.
 */
import { GLOBAL_ATTRIBUTES, SP_HOST_ELEMENTS, type HostElementSpec } from "@serene-pub/sdk"

export interface HostCompletion {
	label: string
	type: "type" | "property" | "event" | "constant"
	detail?: string
	info?: string
}

export interface HostCompletionResult {
	/** Offset in the text where the word being completed starts. */
	from: number
	options: HostCompletion[]
}

const TABLE = SP_HOST_ELEMENTS as unknown as Record<string, HostElementSpec>

/** Every tag, sp elements first — they are what this list is for. */
export function hostElementTagOptions(): HostCompletion[] {
	const tags = Object.keys(TABLE)
	const sp = tags.filter((t) => t.startsWith("sp-"))
	const plain = tags.filter((t) => !t.startsWith("sp-"))
	return [...sp, ...plain].map((tag) => ({
		label: tag,
		type: "type",
		detail: tag.startsWith("sp-") ? "host element" : "element",
		info: TABLE[tag]!.doc
	}))
}

/**
 * What one tag accepts, as completions: its own attributes, the ones every
 * element takes, `slot`, and an `on<event>` handler per event it raises.
 * Null for a tag the host does not draw (a Svelte component, `<script>`).
 */
export function hostAttributeOptions(tag: string): HostCompletion[] | null {
	const spec = Object.hasOwn(TABLE, tag) ? TABLE[tag] : undefined
	if (!spec) return null
	const seen = new Set<string>()
	const out: HostCompletion[] = []
	const add = (c: HostCompletion) => {
		if (seen.has(c.label)) return
		seen.add(c.label)
		out.push(c)
	}
	for (const a of spec.attributes) add({ label: a, type: "property", detail: tag })
	for (const a of GLOBAL_ATTRIBUTES) add({ label: a, type: "property", detail: "every element" })
	add({ label: "slot", type: "property", detail: "fills a named slot" })
	for (const e of spec.events) add({ label: `on${e}`, type: "event", detail: `${tag} raises '${e}'` })
	return out
}

/** Every named slot any host element declares. */
export function hostSlotOptions(): HostCompletion[] {
	const out = new Map<string, string[]>()
	for (const [tag, spec] of Object.entries(TABLE))
		for (const s of spec.slots ?? []) out.set(s, [...(out.get(s) ?? []), tag])
	return [...out].map(([label, tags]) => ({ label, type: "constant", detail: tags.join(", ") }))
}

const LOOKBACK = 6000

/**
 * The open tag the cursor is inside, if any: its name and where it starts.
 * Walks forward from the last `<name` so a `>` inside a quoted value or a
 * `{…}` expression (an arrow function's `=>`) does not close it.
 */
function openTag(before: string): { tag: string; inQuote: string | null; inBrace: boolean; tail: string } | null {
	const start = Math.max(0, before.length - LOOKBACK)
	const window = before.slice(start)
	const re = /<([a-zA-Z][a-zA-Z0-9-]*)/g
	let last: RegExpExecArray | null = null
	for (let m = re.exec(window); m; m = re.exec(window)) last = m
	if (!last) return null
	const body = window.slice(last.index + last[0].length)
	if (body.length && !/^\s/.test(body)) return null // still typing the tag name
	let quote: string | null = null
	let depth = 0
	let quoteStart = 0
	for (let i = 0; i < body.length; i++) {
		const ch = body[i]!
		if (quote) {
			if (ch === quote) quote = null
			continue
		}
		if (depth > 0) {
			if (ch === "{") depth++
			else if (ch === "}") depth--
			continue
		}
		if (ch === '"' || ch === "'") {
			quote = ch
			quoteStart = i
		} else if (ch === "{") depth++
		else if (ch === ">") return null
	}
	return {
		tag: last[1]!.toLowerCase(),
		inQuote: quote,
		inBrace: depth > 0,
		tail: quote ? body.slice(0, quoteStart) : body
	}
}

/**
 * What to offer at the end of `before` (the file's text up to the cursor), or
 * null when the cursor is not somewhere a host element is being named.
 */
export function hostCompletions(before: string, language: "svelte" | "ts" | "js"): HostCompletionResult | null {
	// Inside a Svelte file's `<script>` the text is a module: `Array<` is a
	// generic there, not a tag.
	const inScript = language === "svelte" && before.lastIndexOf("<script") > before.lastIndexOf("</script")
	if (language !== "svelte" || inScript) {
		const m = /createElement\(\s*['"`]([a-z0-9-]*)$/.exec(before)
		if (!m) return null
		return { from: before.length - m[1]!.length, options: hostElementTagOptions() }
	}
	const tagName = /<([a-zA-Z][a-zA-Z0-9-]*)?$/.exec(before)
	if (tagName) {
		// `</` closes a tag and `<Name` is a Svelte component: neither is ours.
		const typed = tagName[1] ?? ""
		if (/^[A-Z]/.test(typed)) return null
		return { from: before.length - typed.length, options: hostElementTagOptions() }
	}
	const open = openTag(before)
	if (!open) return null
	if (open.inBrace) return null
	if (open.inQuote) {
		// `slot="…"` — the one attribute whose values this table knows.
		if (!/(?:^|\s)slot\s*=\s*$/.test(open.tail)) return null
		const typed = /([a-zA-Z0-9-]*)$/.exec(before)![1]!
		return { from: before.length - typed.length, options: hostSlotOptions() }
	}
	const attr = /(?:^|\s)([a-zA-Z][a-zA-Z0-9:-]*)?$/.exec(open.tail)
	if (!attr) return null
	const options = hostAttributeOptions(open.tag)
	if (!options) return null
	const typed = attr[1] ?? ""
	return { from: before.length - typed.length, options }
}
