import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CURATED_ICONS } from "./curatedIcons"

const APP = process.cwd()
const SDK_CATALOG = join(APP, "../serene-pub-sdk/core-catalog")
const SCANNED = [
	join(SDK_CATALOG, "src"),
	join(SDK_CATALOG, "components"),
	join(APP, "src/lib/server/pipelines"),
	join(APP, "src/lib/client/sessionLayout"),
	join(APP, "src/lib/shared/widgets")
]

/** The files whose closed-set icon maps the curated set must hold (perf-F). */
const MAP_FILES = [
	"src/lib/client/shell/adminNavIcons.ts",
	"src/lib/client/admin/sections/history/Page.svelte",
	"src/lib/client/admin/sections/history/IdPage.svelte",
	"src/lib/client/admin/sections/defaults/Page.svelte",
	"src/lib/client/admin/sections/pipelines/SlugPage.svelte",
	"src/lib/client/admin/sections/overview/Page.svelte",
	"src/lib/client/components/shell/JumpOverlay.svelte",
	...[
		"DownloadsView",
		"JobsGrid",
		"ConnectionCard",
		"ManagedConnectionView",
		"ModelRow",
		"DefaultsLedger",
		"ConnectionRow",
		"OnnxEndpointView"
	].map((n) => `src/lib/client/components/connections/${n}.svelte`),
	"src/lib/client/components/connections/connectionTypeIcon.ts",
	"src/lib/client/components/loadouts/LoadoutsLedger.svelte",
	"src/lib/client/components/loadouts/LoadoutsGrid.svelte",
	"src/lib/client/components/sidebars/ConnectionsSidebar.svelte",
	"src/lib/client/components/sidebars/ConnectionServicePicker.svelte"
]

function* walk(dir: string): Generator<string> {
	if (!existsSync(dir)) return
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "dist") continue
		const p = join(dir, e.name)
		if (e.isDirectory()) yield* walk(p)
		else if (!/\.test\./.test(e.name)) yield p
	}
}

/** `book-open-text` → `BookOpenText`; an export name passes through. */
const exportNameOf = (name: string) =>
	name
		.split("-")
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join("")

function coreDeclared(): { names: Set<string>; files: number } {
	const names = new Set<string>()
	let files = 0
	for (const root of SCANNED)
		for (const file of walk(root)) {
			files++
			const text = readFileSync(file, "utf8")
			for (const m of text.matchAll(
				/["']?icon["']?\s*:\s*(["'])([A-Za-z0-9-]+)\1/g
			))
				names.add(exportNameOf(m[2]))
			for (const m of text.matchAll(
				/<sp-icon\b[^>]*?\sname="([A-Za-z0-9-]+)"/g
			))
				names.add(exportNameOf(m[1]))
		}
	return { names, files }
}

function mapFileImports(): Set<string> {
	const names = new Set<string>()
	for (const rel of MAP_FILES) {
		const text = readFileSync(join(APP, rel), "utf8")
		for (const block of text.matchAll(
			/import\s*\{([^}]*)\}\s*from\s*["']@lucide\/svelte["']/g
		))
			for (const part of block[1].split(",")) {
				const name = part.trim().split(/\s+as\s+/)[0]
				if (name) names.add(name)
			}
	}
	return names
}

describe("CURATED_ICONS", () => {
	const core = coreDeclared()
	const mapImports = mapFileImports()

	it("scans find enough, so a broken pattern cannot pass green", () => {
		expect(core.files).toBeGreaterThan(100)
		expect(core.names.size).toBeGreaterThan(50)
		expect(mapImports.size).toBeGreaterThan(40)
	})

	it("holds every icon name core declares", () => {
		const missing = [...core.names].filter(
			(n) => !Object.hasOwn(CURATED_ICONS, n)
		)
		expect(missing).toEqual([])
	})

	it("holds nothing that core does not declare and the map files do not import", () => {
		const unused = Object.keys(CURATED_ICONS).filter(
			(k) => !core.names.has(k) && !mapImports.has(k)
		)
		expect(unused).toEqual([])
	})

	it("holds components", () => {
		expect(Object.keys(CURATED_ICONS).length).toBeGreaterThan(50)
		for (const [name, icon] of Object.entries(CURATED_ICONS))
			expect(typeof icon, name).toBe("function")
	})
})
