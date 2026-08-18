import { Marked, type Tokens } from "marked"

export interface DocSection {
	slug: string
	anchor: string
	title: string
	depth: number
	preview: string
}

export interface DocMeta {
	slug: string
	title: string
	description: string
	order: number
	sections: DocSection[]
	html: string
}

/**
 * Reading order for the docs index. Every file under /docs must appear here —
 * `order` below is `DOC_ORDER.indexOf(slug)`, so an unlisted doc gets -1 and
 * sorts ahead of "getting-started" instead of falling to the end. That is how
 * "android" and "troubleshooting" ended up as the first two cards a new user
 * saw. The docsIndex test asserts both directions of this mapping.
 */
export const DOC_ORDER: string[] = [
	"getting-started",
	"characters",
	"personas",
	"chats",
	"lorebooks",
	"connections",
	"context-configs",
	"prompt-configs",
	"summarization",
	"embeddings-and-rag",
	"tags",
	"users-and-accounts",
	"themes-and-settings",
	"document-view",
	"system-settings",
	"importing-from-sillytavern",
	"troubleshooting",
	"android",
	"hosting",
	"environment-variables"
]

const rawDocs = import.meta.glob("/docs/**/*.md", {
	query: "?raw",
	import: "default",
	eager: true
}) as Record<string, string>

function slugifyHeading(text: string): string {
	return text
		.toLowerCase()
		.replace(/[`*_~]/g, "")
		.replace(/[^a-z0-9\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-")
}

function stripInlineMarkdown(text: string): string {
	return text
		.replace(/`([^`]*)`/g, "$1")
		.replace(/[*_~]/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/#/g, "")
		.replace(/\s+/g, " ")
		.trim()
}

/**
 * Rewrites a relative markdown link between doc source files (eg.
 * "./characters.md#creator-wizard") into the in-app route it maps to (eg.
 * "/docs/characters#creator-wizard"). Anchor-only and external links pass
 * through unchanged.
 */
export function rewriteDocHref(href: string): string {
	const match = href.match(/^\.?\/?([a-z0-9-]+)\.md(#.*)?$/i)
	if (match) return `/docs/${match[1]}${match[2] ?? ""}`
	return href
}

function buildRenderer(docSlug: string, sectionsOut: DocSection[]) {
	const seen = new Map<string, number>()
	return {
		heading(this: any, { tokens, depth, text }: Tokens.Heading) {
			let id = slugifyHeading(text)
			const count = seen.get(id) ?? 0
			seen.set(id, count + 1)
			if (count > 0) id = `${id}-${count}`
			sectionsOut.push({
				slug: docSlug,
				anchor: id,
				title: text,
				depth,
				preview: ""
			})
			const inner = this.parser.parseInline(tokens)
			return `<h${depth} id="${id}">${inner}</h${depth}>\n`
		},
		link(this: any, { href, title, tokens }: Tokens.Link) {
			const text = this.parser.parseInline(tokens)
			const rewritten = rewriteDocHref(href)
			const titleAttr = title ? ` title="${title}"` : ""
			return `<a href="${rewritten}"${titleAttr}>${text}</a>`
		}
	}
}

function extractSectionPreviews(raw: string, sections: DocSection[]): void {
	const headingPattern = /^(#{1,6})\s+(.+)$/gm
	const matches = [...raw.matchAll(headingPattern)]

	for (let i = 0; i < matches.length; i++) {
		const start = matches[i].index! + matches[i][0].length
		const end = i + 1 < matches.length ? matches[i + 1].index! : raw.length
		const body = stripInlineMarkdown(raw.slice(start, end)).slice(0, 180)
		const section = sections[i]
		if (section) section.preview = body
	}
}

function buildDocMeta(path: string, raw: string): DocMeta {
	const slug = path.replace(/^\/docs\//, "").replace(/\.md$/, "")
	const sections: DocSection[] = []
	const marked = new Marked({ renderer: buildRenderer(slug, sections) })
	const html = marked.parse(raw, { async: false }) as string

	extractSectionPreviews(raw, sections)

	const h1Match = raw.match(/^#\s+(.+)$/m)
	const title = h1Match?.[1]?.trim() ?? slug

	const withoutH1 = h1Match
		? raw.slice(raw.indexOf(h1Match[0]) + h1Match[0].length)
		: raw
	const firstParaMatch = withoutH1.match(
		/^\s*\n+([^\n#][^\n]*(?:\n[^\n#][^\n]*)*)/m
	)
	const description = stripInlineMarkdown(firstParaMatch?.[1] ?? "").slice(
		0,
		200
	)

	return {
		slug,
		title,
		description,
		order: DOC_ORDER.indexOf(slug),
		sections,
		html
	}
}

export const docsIndex: DocMeta[] = Object.entries(rawDocs)
	.map(([path, raw]) => buildDocMeta(path, raw))
	.sort((a, b) => a.order - b.order)

export function getDoc(slug: string): DocMeta | undefined {
	return docsIndex.find((d) => d.slug === slug)
}

export function getAllSections(): DocSection[] {
	return docsIndex.flatMap((d) => d.sections)
}
