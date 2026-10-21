import { marked } from "marked"
import DOMPurify from "dompurify"
import { hostAttributeValueFinding } from "@serene-pub/sdk"

// Fix italic formatting to handle trailing spaces before closing asterisk.
// Replaces "*text *" with "*text*". The opening "*" must not follow a word
// character and the closing "*" must not precede one, so the closing "*" of
// one span is never paired with the opening "*" of the next (which would
// strip the space between them, e.g. "*a*, and *b*" -> "*a*, and*b*").
export function fixItalicSpaces(text: string): string {
	return text.replace(
		/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\s+\*(?![\w*])/gm,
		"$1*$2*"
	)
}

export function markQuotedText(md: string): string {
	return md
		.replaceAll("“", '"')
		.replaceAll("”", '"')
		.replaceAll(/"([^"\n]+)"/g, '[[QT]]"$1"[[/QT]]')
}

export function replaceQuotedTextMarkers(html: string): string {
	return html
		.replaceAll("[[QT]]", '<span class="quoted-text">')
		.replaceAll("[[/QT]]", "</span>")
}

export function renderMarkdownWithQuotedText(md: string): string {
	// Fix italic formatting with trailing spaces before processing
	const fixedMd = fixItalicSpaces(md)
	const markedMd = markQuotedText(fixedMd)
	let html = marked.parse(markedMd) as string
	// Sanitize BEFORE injecting our own trusted quoted-text markup — html at
	// this point may contain LLM-generated or character-card-sourced content
	// (susceptible to prompt injection / malicious cards), and marked does
	// not escape/sanitize raw HTML by default.
	html = DOMPurify.sanitize(html)
	html = replaceQuotedTextMarkers(html)
	return html
}

/**
 * The STRICT profile — the host-element rules for HTML that someone other
 * than the app wrote (C2 review H1): no `<style>` (it would restyle the whole
 * page), no forms or controls, no ids or names, links opened in a new tab
 * without an opener, and images only from the app's own media or a plugin's
 * own files. Shared by `sp-message-body` (a plugin component's text) and a
 * conversation message (another person's text, PLAN-private-messages §6.3).
 */
const STRICT = {
	FORBID_TAGS: [
		"style", "form", "input", "button", "textarea", "select", "option", "iframe", "frame",
		"object", "embed", "link", "meta", "base", "svg", "math", "template", "video", "audio", "source"
	],
	FORBID_ATTR: ["id", "name", "style", "target", "rel", "srcset", "formaction", "action"]
}

/** Hold already-rendered HTML to the STRICT profile. Browser only (DOM). */
export function strictSanitize(html: string): string {
	const frag = DOMPurify.sanitize(html, {
		...STRICT,
		RETURN_DOM_FRAGMENT: true
	}) as DocumentFragment
	// The profile again, by hand, over what DOMPurify returned. In a browser
	// this finds nothing (DOMPurify already removed it); it is here so the
	// profile does not rest on one library's configuration alone — and so it
	// holds under happy-dom, where DOMPurify is inert (the DOM tests).
	for (const el of Array.from(
		frag.querySelectorAll([...STRICT.FORBID_TAGS, "script"].join(","))
	))
		el.remove()
	for (const el of Array.from(frag.querySelectorAll("*")))
		for (const attr of Array.from(el.attributes))
			if (
				STRICT.FORBID_ATTR.includes(attr.name.toLowerCase()) ||
				attr.name.toLowerCase().startsWith("on")
			)
				el.removeAttribute(attr.name)
	for (const a of Array.from(frag.querySelectorAll("a"))) {
		const href = a.getAttribute("href") ?? ""
		if (hostAttributeValueFinding("a", "href", href)) a.removeAttribute("href")
		else if (!href.startsWith("#")) {
			a.setAttribute("target", "_blank")
			a.setAttribute("rel", "noopener noreferrer")
		}
	}
	for (const img of Array.from(frag.querySelectorAll("img")))
		if (hostAttributeValueFinding("img", "src", img.getAttribute("src") ?? ""))
			img.remove()
	const box = document.createElement("div")
	box.appendChild(frag)
	return box.innerHTML
}

/**
 * A person's markdown as HTML under the STRICT profile — plain markdown with
 * line breaks kept (a message is typed, not authored), no quoted-text
 * colouring (that is a story's dialogue, not a person's quote).
 */
export function renderStrictMarkdown(md: string): string {
	const html = marked.parse(md ?? "", { breaks: true, async: false }) as string
	return strictSanitize(html)
}
