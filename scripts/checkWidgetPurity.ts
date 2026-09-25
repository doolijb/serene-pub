/**
 * C0's lint: the session widgets under `sessionMessages/` import nothing
 * from the client stores, the socket client or Skeleton (PLAN-sdk-1.0 §3.5).
 *
 * The same source is to build as a remote component and run in the page's
 * UI worker, where none of those exist: a widget reads from its context and
 * acts through its verbs, and draws behaviour with the host's `sp-*`
 * elements. A forbidden import is the one mistake that makes that silently
 * impossible, so it is caught here, in `npm test`, by name.
 *
 * Run alone: `npx tsx scripts/checkWidgetPurity.ts`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"

export const WIDGET_DIR = "src/lib/client/components/sessionMessages"

/** What a widget may not import, and why — by specifier prefix. */
export const FORBIDDEN: ReadonlyArray<{ prefix: string; why: string }> = [
	{ prefix: "$lib/client/stores", why: "a client store — read it from the widget's context" },
	{ prefix: "$lib/client/sockets", why: "the socket client — act through the widget's verbs" },
	{ prefix: "@skeletonlabs/skeleton-svelte", why: "Skeleton — place the host's sp-* element" }
]

const IMPORT = /\b(?:import|export)\b[^'"`]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g

function* files(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) yield* files(path)
		else if (/\.(svelte|ts)$/.test(name) && !/\.test\.(svelte\.)?ts$/.test(name)) yield path
	}
}

/** A relative specifier as the `$lib/…` path it resolves to, so `../../stores/x` is caught too. */
function asLib(root: string, from: string, spec: string): string {
	if (!spec.startsWith(".")) return spec
	const lib = resolve(root, "src/lib")
	const abs = resolve(from, "..", spec)
	return abs.startsWith(lib + sep) ? "$lib/" + relative(lib, abs).split(sep).join("/") : spec
}

export interface PurityFinding {
	file: string
	line: number
	specifier: string
	why: string
}

export function widgetPurityFindings(root = process.cwd()): PurityFinding[] {
	const out: PurityFinding[] = []
	for (const file of files(resolve(root, WIDGET_DIR))) {
		const text = readFileSync(file, "utf8")
		for (const m of text.matchAll(IMPORT)) {
			const spec = m[1] ?? m[2] ?? m[3]
			const lib = asLib(root, file, spec)
			const hit = FORBIDDEN.find((f) => lib === f.prefix || lib.startsWith(f.prefix + "/") || lib.startsWith(f.prefix + "."))
			if (!hit) continue
			out.push({
				file: relative(root, file),
				line: text.slice(0, m.index).split("\n").length,
				specifier: spec,
				why: hit.why
			})
		}
	}
	return out
}

/**
 * The same rule, followed through the modules a widget imports: which
 * modules OUTSIDE `sessionMessages/` a widget reaches that themselves reach a
 * forbidden import (a shared `Avatar` that draws with Skeleton, a card that
 * asks the socket). Direct purity is C0a's; these gateways are C0b's
 * worklist, held by a ratchet so the list only shrinks.
 */
export function widgetGateways(root = process.cwd()): string[] {
	const lib = resolve(root, "src/lib")
	const widgetDir = resolve(root, WIDGET_DIR)
	const reaches = new Map<string, boolean>()
	const resolveSpec = (from: string, spec: string): string | null => {
		const base = spec.startsWith("$lib/")
			? join(lib, spec.slice(5))
			: spec.startsWith(".")
				? resolve(from, "..", spec)
				: null
		if (!base) return null
		for (const c of [base, `${base}.ts`, `${base}.js`, join(base, "index.ts")])
			try {
				if (statSync(c).isFile()) return c
			} catch {
				/* next candidate */
			}
		return null
	}
	const importsOf = (file: string): string[] =>
		[...readFileSync(file, "utf8").matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3])
	const forbidden = (file: string, spec: string) => {
		const l = asLib(root, file, spec)
		return FORBIDDEN.some((f) => l === f.prefix || l.startsWith(f.prefix + "/") || l.startsWith(f.prefix + "."))
	}
	const reach = (file: string, seen: Set<string>): boolean => {
		const known = reaches.get(file)
		if (known !== undefined) return known
		if (seen.has(file)) return false
		seen.add(file)
		let hit = false
		for (const spec of importsOf(file)) {
			if (forbidden(file, spec)) hit = true
			const next = resolveSpec(file, spec)
			if (next && reach(next, seen)) hit = true
			if (hit) break
		}
		reaches.set(file, hit)
		return hit
	}
	const gateways = new Set<string>()
	for (const file of files(widgetDir))
		for (const spec of importsOf(file)) {
			const next = resolveSpec(file, spec)
			if (!next || next.startsWith(widgetDir + sep)) continue
			if (reach(next, new Set())) gateways.add(relative(root, next))
		}
	return [...gateways].sort()
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const found = widgetPurityFindings()
	for (const f of found) console.error(`${f.file}:${f.line} imports '${f.specifier}' — ${f.why}`)
	process.exit(found.length ? 1 : 0)
}
