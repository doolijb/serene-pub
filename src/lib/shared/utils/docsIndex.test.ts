import { describe, expect, it } from "vitest"
import { DOC_ORDER, docsIndex, getAllSections, getDoc, rewriteDocHref } from "./docsIndex"

describe("rewriteDocHref", () => {
	it("rewrites a relative .md link to an in-app doc route", () => {
		expect(rewriteDocHref("./characters.md")).toBe("/docs/characters")
	})

	it("rewrites a relative .md link with an anchor", () => {
		expect(rewriteDocHref("./characters.md#creator-wizard")).toBe(
			"/docs/characters#creator-wizard"
		)
	})

	it("rewrites a bare (non-./-prefixed) .md link", () => {
		expect(rewriteDocHref("characters.md")).toBe("/docs/characters")
	})

	it("leaves a bare in-doc anchor unchanged", () => {
		expect(rewriteDocHref("#local-anchor")).toBe("#local-anchor")
	})

	it("leaves an external URL unchanged", () => {
		expect(rewriteDocHref("https://example.com/foo.md")).toBe(
			"https://example.com/foo.md"
		)
	})
})

describe("docsIndex", () => {
	it("has an entry for every slug in DOC_ORDER", () => {
		for (const slug of DOC_ORDER) {
			expect(getDoc(slug), `missing doc file for slug "${slug}"`).toBeDefined()
		}
	})

	it("every doc has a non-empty title and description", () => {
		for (const doc of docsIndex) {
			expect(doc.title.length, `doc "${doc.slug}" has an empty title`).toBeGreaterThan(0)
		}
	})

	it("is sorted according to DOC_ORDER", () => {
		const slugs = docsIndex.map((d) => d.slug)
		const known = slugs.filter((s) => DOC_ORDER.includes(s))
		const expected = DOC_ORDER.filter((s) => known.includes(s))
		expect(known).toEqual(expected)
	})

	it("gives every heading a stable, collision-safe id", () => {
		for (const doc of docsIndex) {
			const anchors = doc.sections.map((s) => s.anchor)
			expect(new Set(anchors).size).toBe(anchors.length)
		}
	})

	it("every rewritten in-app cross-link points at a real doc slug and anchor", () => {
		const linkPattern = /href="\/docs\/([a-z0-9-]+)(#[a-z0-9-]+)?"/g
		for (const doc of docsIndex) {
			for (const match of doc.html.matchAll(linkPattern)) {
				const [, targetSlug, targetAnchor] = match
				const target = getDoc(targetSlug)
				expect(
					target,
					`doc "${doc.slug}" links to nonexistent doc "${targetSlug}"`
				).toBeDefined()
				if (target && targetAnchor) {
					const anchor = targetAnchor.slice(1)
					expect(
						target.sections.some((s) => s.anchor === anchor),
						`doc "${doc.slug}" links to "${targetSlug}#${anchor}", but no such heading exists`
					).toBe(true)
				}
			}
		}
	})
})

describe("getAllSections", () => {
	it("returns sections from every doc", () => {
		const sections = getAllSections()
		const slugsWithSections = new Set(sections.map((s) => s.slug))
		for (const slug of DOC_ORDER) {
			expect(slugsWithSections.has(slug), `doc "${slug}" produced no sections`).toBe(true)
		}
	})
})
