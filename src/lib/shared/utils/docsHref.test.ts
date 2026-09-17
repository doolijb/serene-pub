import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { docsHref } from "./docsHref"
import type { DocsManifest } from "./docsIndex"

const appRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../.."
)
const MANIFEST_PATH = path.join(appRoot, "src/lib/generated/docs/manifest.json")

function readManifest(): DocsManifest | null {
	try {
		return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
	} catch {
		return null
	}
}

/**
 * Every literal `docsHref("slug")` / `docsHref("slug", "anchor")` in the source
 * tree, found by reading the files rather than by importing them.
 *
 * Static on purpose. The alternative — a registry the function writes to when
 * it is called — only ever sees the call sites some test happened to execute,
 * which is the minority of them and exactly the ones least likely to rot. Text
 * that is in the tree is in the tree.
 */
function docsHrefCalls(): { file: string; slug: string; anchor?: string }[] {
	const selfName = path.basename(fileURLToPath(import.meta.url))
	const srcDir = path.join(appRoot, "src")
	const pattern =
		/\bdocsHref\(\s*["']([^"'\n]+)["']\s*(?:,\s*["']([^"'\n]+)["']\s*)?\)/g

	const calls: { file: string; slug: string; anchor?: string }[] = []
	for (const rel of fs.readdirSync(srcDir, { recursive: true }) as string[]) {
		if (!/\.(ts|svelte)$/.test(rel)) continue
		// vite and vitest drop a .svelte-kit cache next to whatever they
		// resolved from, so several live under src/lib/client/ — generated
		// files, none of them anyone's source (see .gitignore).
		const parts = rel.split(path.sep)
		if (parts.some((p) => p === ".svelte-kit" || p === "node_modules")) {
			continue
		}
		// The definition has no literal arguments and cannot match; this file
		// is skipped because its own regex source would.
		if (path.basename(rel) === selfName) continue
		const text = fs.readFileSync(path.join(srcDir, rel), "utf8")
		if (!text.includes("docsHref(")) continue
		for (const m of text.matchAll(pattern)) {
			calls.push({ file: `src/${rel}`, slug: m[1], anchor: m[2] })
		}
	}
	return calls
}

describe("docsHref", () => {
	it("builds a page href", () => {
		expect(docsHref("hosting")).toBe("/docs/hosting")
	})

	it("builds an anchored href", () => {
		expect(docsHref("troubleshooting", "database-wont-open")).toBe(
			"/docs/troubleshooting#database-wont-open"
		)
	})

	it("omits the fragment for an empty anchor", () => {
		expect(docsHref("hosting", "")).toBe("/docs/hosting")
	})
})

/**
 * The drift guard: a link into the documentation that no longer resolves.
 *
 * A renamed guide or a reworded heading breaks every `docsHref` aimed at it,
 * and nothing about editing a markdown file makes that visible — the link keeps
 * compiling and keeps rendering, and simply lands on a 404 or at the top of the
 * wrong page. This test is the thing that notices.
 */
describe("docsHref call sites resolve against the compiled docs", () => {
	const manifest = readManifest()

	if (!manifest) {
		it.skip("needs a compiled docs-dist — run `npm run docs:build`", () => {})
		return
	}

	const calls = docsHrefCalls()

	it("finds the call sites to check", () => {
		// A regex that silently stops matching turns this whole describe into
		// a no-op that still reports green, which is worse than no guard.
		expect(
			calls.length,
			"no literal docsHref(...) calls were found in src/ — either they " +
				"were all removed, or the scanner's pattern stopped matching"
		).toBeGreaterThan(0)
	})

	it("points every call at a page that exists", () => {
		for (const call of calls) {
			expect(
				Object.hasOwn(manifest.pages, call.slug),
				`${call.file} links to "${call.slug}", which is not a page in ` +
					`the compiled docs`
			).toBe(true)
		}
	})

	it("points every anchored call at a heading that exists", () => {
		for (const call of calls) {
			if (!call.anchor) continue
			const meta = manifest.pages[call.slug]
			if (!meta) continue
			expect(
				meta.headings.some((h) => h.id === call.anchor),
				`${call.file} links to "${call.slug}#${call.anchor}", but that ` +
					`page has no such heading (has: ${meta.headings
						.map((h) => h.id)
						.join(", ")})`
			).toBe(true)
		}
	})
})
