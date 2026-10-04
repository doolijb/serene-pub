/**
 * Client-reachable code never imports the core-catalog package ROOT.
 *
 * The root is core's whole announcement — every genre, pipeline, prompt and
 * preset — and a client module importing it for one list (`CORE_WIDGETS`)
 * carried all of it into the browser bundle, ~300 kB. Client code takes the
 * narrow subpaths instead (`@serene-pub/core-catalog/core-widgets`,
 * `/conversation`, `/widgets`, …). Server modules and tests may import the root.
 */
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const SRC = fileURLToPath(new URL("../../..", import.meta.url))

/** Files a browser bundle can reach: everything under src/ but the server half and tests. */
function clientReachable(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const full = path.join(dir, e.name)
		if (e.isDirectory())
			return e.name === "server" || e.name === "node_modules"
				? []
				: clientReachable(full)
		if (!/\.(ts|svelte|js)$/.test(e.name)) return []
		if (/\.test\.|\.spec\.|\.d\.ts$/.test(e.name)) return []
		// SvelteKit server-only route modules.
		if (/^\+(server|page\.server|layout\.server)\.(ts|js)$/.test(e.name))
			return []
		if (/\.server\.(ts|js)$/.test(e.name)) return []
		return [full]
	})
}

describe("client bundle and the core-catalog root", () => {
	test("no client-reachable module imports @serene-pub/core-catalog by its root", () => {
		const offenders = clientReachable(SRC).filter((f) =>
			/from\s+["']@serene-pub\/core-catalog["']|import\s+["']@serene-pub\/core-catalog["']/.test(
				readFileSync(f, "utf8")
			)
		)
		expect(offenders.map((f) => path.relative(SRC, f))).toEqual([])
	})
})
