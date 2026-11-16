import type { Component } from "svelte"

/**
 * The per-icon loaders for every lucide icon: one lazy `import()` per file in
 * `@lucide/svelte`, keyed by export name. The ~1,800-entry table below is a
 * chunk of its own, so it must be reached **only** through a dynamic
 * `import("./lucideIconModules")` from `declaredIcon.svelte.ts` — a static
 * import would pull it into the entry. Owner ruling ★P15, 2026-11-13.
 *
 * Unknown names resolve to `null`, quietly: no warning, no console output.
 */
const modules = import.meta.glob([
	"/node_modules/@lucide/svelte/dist/icons/*.js",
	"!/node_modules/@lucide/svelte/dist/icons/index.js"
])

/** `arrow-down-0-1` → `ArrowDown01`: the barrel's own file-to-export rule. */
const exportNameOf = (file: string) =>
	file
		.split("-")
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join("")

type Loader = () => Promise<unknown>

let loaders: Map<string, Loader> | null = null

function loadersByName(): Map<string, Loader> {
	if (loaders) return loaders
	const built = new Map<string, Loader>()
	for (const [path, loader] of Object.entries(modules)) {
		const file = path.slice(path.lastIndexOf("/") + 1).replace(/\.js$/, "")
		built.set(exportNameOf(file), loader as Loader)
	}
	loaders = built
	return built
}

/**
 * The lucide icon of this export name, loaded on demand, or `null` when
 * there is none. The barrel's `LucideX` and `XIcon` forms are accepted too.
 */
export async function loadLucideIcon(
	exportName: string
): Promise<Component<any> | null> {
	const table = loadersByName()
	let loader = table.get(exportName)
	if (!loader && exportName.startsWith("Lucide"))
		loader = table.get(exportName.slice(6))
	if (!loader && exportName.endsWith("Icon"))
		loader = table.get(exportName.slice(0, -4))
	if (!loader) return null
	const mod = (await loader()) as { default?: Component<any> }
	return mod.default ?? null
}
