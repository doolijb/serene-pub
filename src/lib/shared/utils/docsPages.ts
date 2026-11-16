/**
 * Whether the docs-dist has a page, answered from the keys of the lazy page
 * glob. This module imports nothing, so the shell can ask "does this help page
 * exist?" without loading the docs manifest; the manifest stays in
 * `docsIndex.ts`.
 *
 * `Object.hasOwn` because the slug comes off a URL (`/docs/constructor`). A
 * glob that matches nothing (a fresh checkout, docs not built) is `{}`, so the
 * answer there is false.
 */

const DIST_DIR = "/src/lib/generated/docs"

// Lazy: only the keys are read; the loaders are never called.
const pageModules = import.meta.glob(
	"/src/lib/generated/docs/pages/**/*.html",
	{
		query: "?raw",
		import: "default"
	}
) as Record<string, () => Promise<string>>

export function hasDocPage(slug: string): boolean {
	return Object.hasOwn(pageModules, `${DIST_DIR}/pages/${slug}.html`)
}
