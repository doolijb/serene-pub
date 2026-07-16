import { marked } from "marked"
import DOMPurify from "dompurify"

// Fix italic formatting to handle trailing spaces before closing asterisk
function fixItalicSpaces(text: string): string {
	// Replace patterns like "*text *" with "*text*" to fix italic parsing
	return text.replace(/\*([^*\n]+?)\s+\*/g, "*$1*")
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
