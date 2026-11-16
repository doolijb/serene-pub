import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { hasDocPage } from "./docsPages"
import { docsManifest, getDocMeta } from "./docsIndex"

describe("hasDocPage", () => {
	it("is false for a page that does not exist", () => {
		expect(hasDocPage("no-such-page")).toBe(false)
	})

	it("does not mistake an Object.prototype key for a page", () => {
		expect(hasDocPage("constructor")).toBe(false)
		expect(hasDocPage("__proto__")).toBe(false)
	})
})

describe("hasDocPage against the compiled docs-dist", () => {
	const distDir = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../../generated/docs"
	)
	const compiled = fs.existsSync(path.join(distDir, "manifest.json"))

	if (!compiled) {
		it.skip("needs a compiled docs-dist — run `npm run docs:build`", () => {})
		return
	}

	const navSlugs = docsManifest.nav.flatMap((g) => g.pages)

	it("is true for a known slug", () => {
		expect(hasDocPage(navSlugs[0])).toBe(true)
	})

	it("agrees with getDocMeta for every nav slug", () => {
		for (const slug of navSlugs) {
			expect(hasDocPage(slug), slug).toBe(getDocMeta(slug) !== undefined)
		}
	})

	it("agrees with getDocMeta for every manifest page", () => {
		// The guard in `Layout.svelte` relies on the page files and the
		// manifest naming the same set; the compiler writes both in one pass.
		for (const slug of Object.keys(docsManifest.pages)) {
			expect(hasDocPage(slug), slug).toBe(true)
		}
	})
})
