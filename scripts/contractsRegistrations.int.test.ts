/**
 * A production build keeps the contracts' node definitions registered.
 *
 * Every `describe*Definition` in `@serene-pub/contracts` registers the node
 * definition it describes, so importing the package is what fills the SDK's
 * definition registry. Under `vite build` that depends on the package's
 * `sideEffects`: declared `false`, a chunk that bare-imports the package and
 * then reads the registry has the import dropped and reads an empty registry —
 * the trap `coreCatalogRegistrations.int.test.ts` guards for core-catalog.
 *
 * Built for real, SSR and code-split, with the package linked the way the app
 * links it: a reader chunk that only bare-imports the contracts, and a sibling
 * chunk that imports one by value.
 */
import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build, type Plugin } from "vite"
import { afterAll, describe, expect, test } from "vitest"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

const MODULES: Record<string, string> = {
	"virtual:entry": `
		export const readRegistry = () => import("virtual:reader").then((m) => m.snapshot)
		export const useByValue = () => import("virtual:by-value").then((m) => m.id)
	`,
	"virtual:reader": `
		import "@serene-pub/contracts"
		import { allDefinitions } from "@serene-pub/sdk"
		export const snapshot = allDefinitions().map((d) => d.id).sort()
	`,
	"virtual:by-value": `
		import { assemble } from "@serene-pub/contracts"
		export const id = assemble.id
	`
}

function fixture(): Plugin {
	return {
		name: "contracts-registrations-fixture",
		resolveId: (id) => (id in MODULES ? "\0" + id : null),
		load: (id) =>
			id.startsWith("\0") && id.slice(1) in MODULES
				? MODULES[id.slice(1)]
				: null
	}
}

const outDir = mkdtempSync(
	path.join(ROOT, "node_modules", ".contracts-build-")
)
afterAll(() => rmSync(outDir, { recursive: true, force: true }))

describe("contracts registrations in a production build", () => {
	test("a bare import of the contracts registers their node definitions before the reader runs", async () => {
		await build({
			root: ROOT,
			configFile: false,
			envFile: false,
			logLevel: "silent",
			plugins: [fixture()],
			build: {
				ssr: true,
				outDir,
				emptyOutDir: true,
				minify: false,
				rollupOptions: { input: { main: "virtual:entry" } }
			}
		})

		const main = await import(pathToFileURL(path.join(outDir, "main.js")).href)
		const snapshot: string[] = await main.readRegistry()

		expect(snapshot).toContain("core:inlet/user-message@1")
		expect(snapshot).toContain("core:task/assemble@2")
		expect(snapshot.length).toBeGreaterThan(100)
		expect(await main.useByValue()).toBe("core:task/assemble@2")
	}, 120_000)
})
