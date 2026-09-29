/**
 * The UI worker never loads Vite's HMR client in dev
 * (`scripts/viteClientOutOfUiWorker.js`).
 *
 * The worker's CSP is `connect-src 'none'`, and `/@vite/client` opens a
 * websocket the moment it is evaluated, so its presence anywhere in the
 * worker's module graph is a CSP violation on every session page. These run a
 * real Vite dev server (middleware mode, no socket, no watcher) with only the
 * plugin the app's own `vite.config.ts` registers, and transform what the
 * worker actually requests.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer, type Plugin, type ViteDevServer } from "vite"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { importsViteClient, withoutViteClientHelper } from "./viteClientOutOfUiWorker.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
/** What the page's `?worker&url` import hands `/ui-worker` in dev. */
const WORKER_ENTRY = "/src/lib/client/components/host/uiWorker.ts?worker_file&type=module"
const PLUGIN_NAME = "serene-pub-ui-worker-without-vite-client"

/** The plugin exactly as the app registers it, with the app's entry path. */
async function registeredPlugin(): Promise<Plugin> {
	const { default: config } = await import("../vite.config")
	const plugins = (await Promise.all((config.plugins ?? []) as unknown[])).flat(Infinity)
	const plugin = plugins.find((p) => (p as Plugin | null)?.name === PLUGIN_NAME)
	if (!plugin) throw new Error(`vite.config.ts does not register ${PLUGIN_NAME}`)
	return plugin as Plugin
}

async function devServer(plugins: Plugin[], cacheDir: string): Promise<ViteDevServer> {
	return createServer({
		root: ROOT,
		configFile: false,
		envFile: false,
		logLevel: "silent",
		cacheDir,
		appType: "custom",
		server: { middlewareMode: true, ws: false, watch: null, preTransformRequests: false },
		optimizeDeps: { noDiscovery: true, include: [] },
		worker: { format: "es" },
		plugins
	})
}

/** Every static import's URL in served code (enough for Vite's own output). */
function staticImports(code: string): string[] {
	const re = /(?:^|[;\n}])\s*import\s*(?:[^'"()]*?from\s*)?["']([^"']+)["']/g
	return [...code.matchAll(re)].map((m) => m[1])
}

describe("withoutViteClientHelper", () => {
	const HELPER = 'import { injectQuery as __vite__injectQuery } from "/@vite/client";'

	test("removes the helper import and defines the helper inline", () => {
		const code = `${HELPER}import "/env.mjs"\n;\nconst f = (e) => import(__vite__injectQuery(e, 'import'));\n`
		const out = withoutViteClientHelper(code)!
		expect(importsViteClient(out)).toBe(false)
		expect(out).toContain("function __vite__injectQuery(url, queryToInject)")
		// Every column after the import keeps its place: the source map from
		// earlier transforms stays exact.
		expect(out.indexOf('import "/env.mjs"')).toBe(code.indexOf('import "/env.mjs"'))
		expect(out.split("\n").slice(0, 3)).toEqual(
			[" ".repeat(HELPER.length) + 'import "/env.mjs"', ";", code.split("\n")[2]]
		)
	})

	test("the inline helper behaves as Vite's injectQuery", () => {
		const out = withoutViteClientHelper(HELPER)!
		const injectQuery = new Function(`${out}\nreturn __vite__injectQuery`)() as (
			u: string,
			q: string
		) => string
		expect(injectQuery("/core-ui/messages", "import")).toBe("/core-ui/messages?import")
		expect(injectQuery("/plugin-ui/a.b/x.js?v=2#h", "import")).toBe(
			"/plugin-ui/a.b/x.js?import&v=2#h"
		)
		expect(injectQuery("https://elsewhere.test/x.js", "import")).toBe("https://elsewhere.test/x.js")
	})

	test("leaves code without the helper import alone", () => {
		expect(withoutViteClientHelper('import "/env.mjs";\n')).toBeNull()
		// An HMR context is not the helper; the plugin warns rather than
		// strip something the module would then miss.
		const hot = 'import { createHotContext as __vite__createHotContext } from "/@vite/client";'
		expect(withoutViteClientHelper(hot)).toBeNull()
		expect(importsViteClient(hot)).toBe(true)
	})
})

describe("the UI worker's dev module graph", () => {
	let dir: string
	let plain: ViteDevServer
	let fixed: ViteDevServer

	beforeAll(async () => {
		dir = mkdtempSync(path.join(tmpdir(), "serene-pub-vite-client-"))
		plain = await devServer([], path.join(dir, "plain"))
		fixed = await devServer([await registeredPlugin()], path.join(dir, "fixed"))
	})

	afterAll(async () => {
		await Promise.all([plain?.close(), fixed?.close()])
		if (dir) rmSync(dir, { recursive: true, force: true })
	})

	test("without the plugin, Vite pulls its client into the worker entry (the defect)", async () => {
		// If this ever fails, Vite stopped injecting the client into a module
		// worker's entry and the plugin can go.
		const r = await plain.transformRequest(WORKER_ENTRY)
		expect(importsViteClient(r!.code)).toBe(true)
	})

	test("with the plugin, the worker entry keeps its dynamic import but not the client", async () => {
		const r = await fixed.transformRequest(WORKER_ENTRY)
		const code = r!.code
		expect(importsViteClient(code)).toBe(false)
		expect(code).toContain("__vite__injectQuery(entry, 'import')")
		expect(code).toContain("function __vite__injectQuery(url, queryToInject)")
	})

	test("no module the worker loads imports /@vite/client", async () => {
		const seen = new Set<string>()
		const offenders: string[] = []
		const queue = [WORKER_ENTRY]
		while (queue.length) {
			const url = queue.shift()!
			if (seen.has(url)) continue
			seen.add(url)
			const r = await fixed.transformRequest(url)
			if (!r) continue
			if (importsViteClient(r.code)) offenders.push(url)
			for (const dep of staticImports(r.code))
				if (dep.startsWith("/") && dep !== "/@vite/client") queue.push(dep)
		}
		expect(seen.size).toBeGreaterThan(2)
		expect(offenders).toEqual([])
	})

	test("only the worker entry is touched; the same file as a page module keeps the client", async () => {
		// The page still hot-reloads: nothing but the worker's own entry id
		// loses its client import.
		const r = await fixed.transformRequest("/src/lib/client/components/host/uiWorker.ts")
		expect(importsViteClient(r!.code)).toBe(true)
		expect(r!.code).not.toContain("function __vite__injectQuery")
	})
})
