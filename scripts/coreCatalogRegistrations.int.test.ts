/**
 * A production build keeps core-catalog's registrations ahead of their readers.
 *
 * Core's entry types, attribute slots and stat shapes are declared in
 * `@serene-pub/core-catalog`, and declaring one REGISTERS it. The app's readers
 * (`entries/declarations.ts`, `pipelines/boot/bootstrap.ts`) reach them with a
 * bare `import "@serene-pub/core-catalog"` and then read the SDK's registries.
 * Under Vitest and `vite dev` that always works — every module is evaluated as
 * written. Under `vite build` it depends on the package's `sideEffects`: once
 * a release build marked the package entry pure, Rollup dropped the bare import,
 * the registering module landed in some other chunk, and the server booted with
 * "entry type 'core:entry/world-lore' is declared by no module in this build".
 *
 * So this builds the same shape for real — SSR, code-split, the catalog linked
 * the way the app links it — and runs the output: a reader chunk that only
 * bare-imports the catalog, and a sibling chunk that imports it by value (the
 * coincidence that used to hide the bug in the real app's graph).
 */
import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build, type Plugin } from "vite"
import { afterAll, describe, expect, test } from "vitest"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

const MODULES: Record<string, string> = {
	"virtual:entry": `
		export const readRegistries = () => import("virtual:reader").then((m) => m.snapshot)
		export const useByValue = () => import("virtual:by-value").then((m) => m.count)
	`,
	// The app's reader, exactly: a bare import, then the registries, at module scope.
	"virtual:reader": `
		import "@serene-pub/core-catalog"
		import { allEntryTypes, attributeSlots, statShapes } from "@serene-pub/sdk"
		export const snapshot = {
			entryTypes: allEntryTypes().map((d) => d.id).sort(),
			slots: attributeSlots().map((d) => d.id),
			statShapes: statShapes().map((d) => d.id)
		}
	`,
	"virtual:by-value": `
		import { CORE_ENTRY_TYPES, ADVENTURE_SLOTS, CORE_STAT_SHAPES } from "@serene-pub/core-catalog"
		export const count = CORE_ENTRY_TYPES.length + ADVENTURE_SLOTS.length + CORE_STAT_SHAPES.length
	`
}

function fixture(): Plugin {
	return {
		name: "core-catalog-registrations-fixture",
		resolveId: (id) => (id in MODULES ? "\0" + id : null),
		load: (id) => (id.startsWith("\0") && id.slice(1) in MODULES ? MODULES[id.slice(1)] : null)
	}
}

// Inside the repo's node_modules, so the chunks' external imports resolve the
// way the shipped server's do; removed afterwards.
const outDir = mkdtempSync(path.join(ROOT, "node_modules", ".core-catalog-build-"))
afterAll(() => rmSync(outDir, { recursive: true, force: true }))

describe("core-catalog registrations in a production build", () => {
	test("a bare import of the catalog registers core's declarations before its reader runs", async () => {
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
		const snapshot = await main.readRegistries()

		expect(snapshot.entryTypes).toEqual([
			"core:entry/character-lore@1",
			"core:entry/history@1",
			"core:entry/item@1",
			"core:entry/location@1",
			"core:entry/world-lore@1"
		])
		expect(snapshot.slots).toContain("core:slot/hp@1")
		expect(snapshot.statShapes).toContain("core:stat-shape/number@1")
		// The sibling chunk is real and loads; it is not what registered them.
		expect(await main.useByValue()).toBeGreaterThan(0)
	}, 120_000)
})
