import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
	buildDocsIndex,
	docsIndex,
	docsManifest,
	getDocMeta,
	loadDocHtml,
	rewriteDocHref,
	type DocsManifest,
	type DocsPageMeta
} from "./docsIndex"

/**
 * A fixture rather than the real docs-dist.
 *
 * The compiled docs-dist is gitignored build output and `npm test` does not
 * compile it, so a suite that asserted against the real manifest would pass or
 * fail according to whether someone had run `npm run docs:build` — and the
 * checks it used to make (every slug in the order list resolves, every
 * cross-link points at a real anchor) now belong to the compiler, which throws
 * on a broken link instead of letting the app discover it. What is left to test
 * here is this module's own derivation, and that is fixture work.
 */
function page(slug: string, over: Partial<DocsPageMeta> = {}): DocsPageMeta {
	return {
		slug,
		title: slug,
		description: `about ${slug}`,
		source: "app",
		order: 0,
		headings: [],
		bytes: 100,
		...over
	}
}

const fixture: DocsManifest = {
	version: "0.6.0-test",
	generatedAt: "2026-09-16T00:00:00.000Z",
	linkBase: "/docs",
	sources: {
		app: { group: "Using Serene Pub" },
		sdk: {
			group: "SDK reference",
			banner: "Plugin modding is only available in 0.7 previews.",
			repo: { url: "https://example.invalid/sdk", commit: "abc1234" }
		}
	},
	nav: [
		{
			group: "Using Serene Pub",
			source: "app",
			pages: ["getting-started", "sessions"]
		},
		{
			group: "SDK reference",
			source: "sdk",
			pages: ["sdk/pipelines/core_spec_respond"]
		}
	],
	pages: {
		"getting-started": page("getting-started", {
			title: "Getting started",
			order: 0
		}),
		sessions: page("sessions", { title: "Sessions", order: 1 }),
		"sdk/pipelines/core_spec_respond": page(
			"sdk/pipelines/core_spec_respond",
			{ title: "core:spec/respond", source: "sdk", order: 0 }
		)
	},
	assets: { count: 3, bytes: 1024, budgetBytes: 6 * 1024 * 1024 }
}

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

describe("buildDocsIndex", () => {
	it("returns every page the nav lists, in nav order", () => {
		expect(buildDocsIndex(fixture).map((p) => p.slug)).toEqual([
			"getting-started",
			"sessions",
			"sdk/pipelines/core_spec_respond"
		])
	})

	it("follows the manifest's group order rather than each page's own order", () => {
		// Both groups number their pages from 0, so sorting by `order` alone
		// would interleave them. The nav is the reading order; `order` is only
		// a page's rank inside its own source.
		const index = buildDocsIndex(fixture)
		expect(index.map((p) => p.source)).toEqual(["app", "app", "sdk"])
	})

	it("skips a nav entry with no page behind it rather than emitting a hole", () => {
		const withGhost: DocsManifest = {
			...fixture,
			nav: [
				{
					group: "Using Serene Pub",
					source: "app",
					pages: ["getting-started", "never-compiled"]
				}
			]
		}
		expect(buildDocsIndex(withGhost).map((p) => p.slug)).toEqual([
			"getting-started"
		])
	})

	it("is empty for a docs-dist that was never compiled", () => {
		expect(buildDocsIndex({ ...fixture, nav: [], pages: {} })).toEqual([])
	})
})

/**
 * The wiring, as opposed to the derivation above.
 *
 * `import.meta.glob` is the fragile part of this module: it takes a literal
 * pattern resolved against the Vite root, so a moved output directory or a
 * mistyped path does not fail — it quietly matches nothing, and the app renders
 * an empty documentation index with no error anywhere. These cases only run
 * when a docs-dist is actually on disk, and when one is they insist the glob
 * found it, so "matched nothing" can never pass for "not compiled".
 */
describe("docs-dist wiring", () => {
	const distDir = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../../generated/docs"
	)
	const compiled = fs.existsSync(path.join(distDir, "manifest.json"))

	if (!compiled) {
		it.skip("needs a compiled docs-dist — run `npm run docs:build`", () => {})
		return
	}

	it("globs the manifest that is on disk", () => {
		expect(
			docsManifest.nav.length,
			"manifest.json exists but the glob in docsIndex.ts matched nothing — " +
				"the pattern and the compiler's `out` directory have drifted apart"
		).toBeGreaterThan(0)
		expect(Object.keys(docsManifest.pages).length).toBeGreaterThan(0)
	})

	it("lists every navigable page, including the prefixed reference pages", () => {
		const navSlugs = docsManifest.nav.flatMap((g) => g.pages)
		expect(docsIndex.map((p) => p.slug)).toEqual(navSlugs)
		// A slug with slashes in it is the case the route's rest parameter and
		// the accessibility route map both exist for.
		expect(navSlugs.some((slug) => slug.includes("/"))).toBe(true)
	})

	it("loads a page's HTML for every slug the manifest advertises", async () => {
		for (const slug of docsManifest.nav.flatMap((g) => g.pages)) {
			const html = await loadDocHtml(slug)
			expect(
				html,
				`manifest lists "${slug}" but no pages/${slug}.html was globbed`
			).toBeTruthy()
		}
	})

	it("returns null for a page that does not exist", async () => {
		expect(await loadDocHtml("no-such-page")).toBeNull()
	})

	it("does not mistake an Object.prototype key for a page", () => {
		// The slug comes straight off the URL: /docs/constructor would
		// otherwise resolve to a function, which is truthy, and the route would
		// render a "found" page with no title.
		expect(getDocMeta("constructor")).toBeUndefined()
		expect(getDocMeta("__proto__")).toBeUndefined()
	})
})
