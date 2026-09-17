import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { DocsManifest } from "./docsIndex"

const MANIFEST_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../src/lib/generated/docs/manifest.json"
)

/**
 * What the documentation is allowed to add to a build.
 *
 * The **app profile** only — `src/lib/generated/docs` is what `npm run
 * docs:build` and the Vite plugin write, and it is the only docs-dist the app
 * imports. The site profile (`docs-site/`, guides + catalog + the TypeDoc API
 * reference) is serenepub.com's and ships in nothing, so it has no budget here
 * and deliberately gets none: the API reference is 2.4 MB of rendered HTML on
 * its own, which is exactly why it was split out of this build rather than
 * given a bigger ceiling.
 *
 * Assets ship inside `static/`, which is copied whole into every bundle and
 * every APK — 73 screenshots at their camera-original size is 12 MB, which is
 * why the compiler converts them and why the ceiling is declared rather than
 * discovered. The compiler enforces the asset budget itself (it throws), so the
 * assertion below is a second pair of eyes on output already on disk: an asset
 * dropped in by hand, or a budget quietly raised in the build script, still
 * fails here.
 *
 * The page budget has no compiler-side equivalent. Rendered HTML is the thing
 * that grows without anyone noticing, and each page is a chunk the app will
 * fetch, so 3 MB across the whole set is a generous ceiling — the guides and
 * the SDK catalog are 0.67 MB of it — that still notices a doubling.
 */
const PAGE_BUDGET_BYTES = 3 * 1024 * 1024

function readManifest(): DocsManifest | null {
	try {
		return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
	} catch {
		return null
	}
}

describe("docs-dist size", () => {
	const manifest = readManifest()

	if (!manifest) {
		it.skip("needs a compiled docs-dist — run `npm run docs:build`", () => {})
		return
	}

	it("keeps converted assets inside the declared budget", () => {
		const { bytes, budgetBytes, count } = manifest.assets
		expect(
			bytes,
			`${count} doc assets total ${(bytes / 1024 / 1024).toFixed(2)} MB, ` +
				`over the ${(budgetBytes / 1024 / 1024).toFixed(2)} MB budget`
		).toBeLessThanOrEqual(budgetBytes)
	})

	it("keeps rendered pages inside the page budget", () => {
		const pages = Object.values(manifest.pages)
		const total = pages.reduce((sum, p) => sum + p.bytes, 0)
		const biggest = [...pages]
			.sort((a, b) => b.bytes - a.bytes)
			.slice(0, 3)
			.map((p) => `${p.slug} (${(p.bytes / 1024).toFixed(0)} KB)`)
			.join(", ")
		expect(
			total,
			`${pages.length} rendered pages total ` +
				`${(total / 1024 / 1024).toFixed(2)} MB, over the ` +
				`${(PAGE_BUDGET_BYTES / 1024 / 1024).toFixed(2)} MB budget. ` +
				`Largest: ${biggest}`
		).toBeLessThanOrEqual(PAGE_BUDGET_BYTES)
	})
})
