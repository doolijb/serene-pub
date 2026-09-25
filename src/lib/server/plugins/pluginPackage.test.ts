/**
 * Reading a built plugin package (D-6), against the checked-in fixture and
 * against packages deliberately broken one way each.
 *
 * Pure: no database, no registry. What is pinned is that a structural mistake
 * is a **sentence naming it**, not a partial install — an install that read
 * half a package and wrote half a projection is the failure this reader exists
 * to make impossible.
 */
import { describe, expect, it } from "vitest"
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
	PluginPackageError,
	declaredSurfaceEntries,
	documentFileName,
	mimeForUiPath,
	readPluginPackage
} from "./pluginPackage"

const FIXTURE = resolve(
	process.cwd(),
	"src/lib/server/plugins/fixtures/unified-plugin"
)

/** The fixture copied to a scratch dir, with one mutation applied to it. */
async function broken(
	mutate: (dir: string) => Promise<void>
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "sp-pkg-"))
	await cp(FIXTURE, dir, { recursive: true })
	await mutate(dir)
	return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const findingsOf = async (dir: string): Promise<string[]> => {
	try {
		await readPluginPackage(dir)
		return []
	} catch (e) {
		return e instanceof PluginPackageError ? e.findings : [String(e)]
	}
}

describe("readPluginPackage", () => {
	it("reads the fixture: manifest verbatim, a document per pipeline, the ui tree", async () => {
		const pkg = await readPluginPackage(FIXTURE)
		expect(pkg.manifest.slug).toBe("demo.unified")
		expect(pkg.manifest.schemaVersion).toBe(1)
		expect(pkg.documents.map((d) => d.id)).toEqual([
			"demo.unified:spec/create-session",
			"demo.unified:spec/respond"
		])
		// The declared panel's entry, and the script and stylesheet it loads —
		// a surface stored without them renders blank.
		expect(pkg.files.map((f) => f.path).sort()).toEqual([
			"ui/tally.css",
			"ui/tally.html",
			"ui/tally.js"
		])
		expect(pkg.files.find((f) => f.path === "ui/tally.html")!.mime).toBe(
			"text/html; charset=utf-8"
		)
		// Verbatim: the halves this app does not interpret survive the read.
		expect(pkg.manifest.requires).toEqual(["core:spec/respond"])
		expect((pkg.manifest as any).permissions).toContain("storage:4194304")
	})

	it("refuses a folder that was never built", async () => {
		const dir = await mkdtemp(join(tmpdir(), "sp-pkg-"))
		try {
			expect((await findingsOf(dir))[0]).toMatch(/dist\/plugin\/manifest\.json/)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("refuses a slug outside the grammar, and a slashed one especially", async () => {
		for (const slug of ["Acme.Hello", "acme/hello", "acme..hello", ""]) {
			const { dir, cleanup } = await broken(async (d) => {
				const p = join(d, "dist/plugin/manifest.json")
				const m = JSON.parse(await (await import("node:fs/promises")).readFile(p, "utf8"))
				m.slug = slug
				await writeFile(p, JSON.stringify(m))
			})
			try {
				expect(
					(await findingsOf(dir)).some((f) => f.includes("manifest.slug"))
				).toBe(true)
			} finally {
				await cleanup()
			}
		}
	})

	it("refuses a schemaVersion this release does not read", async () => {
		const { dir, cleanup } = await broken(async (d) => {
			const p = join(d, "dist/plugin/manifest.json")
			const m = JSON.parse(await (await import("node:fs/promises")).readFile(p, "utf8"))
			m.schemaVersion = 2
			await writeFile(p, JSON.stringify(m))
		})
		try {
			expect(
				(await findingsOf(dir)).some((f) => f.includes("schemaVersion"))
			).toBe(true)
		} finally {
			await cleanup()
		}
	})

	it("refuses a pipeline the manifest names and the package does not ship", async () => {
		const { dir, cleanup } = await broken(async (d) => {
			await rm(
				join(
					d,
					"dist/plugin/pipelines",
					documentFileName("demo.unified:spec/respond")
				)
			)
		})
		try {
			const findings = await findingsOf(dir)
			expect(findings.some((f) => f.includes("demo.unified:spec/respond"))).toBe(
				true
			)
		} finally {
			await cleanup()
		}
	})

	it("refuses a document under somebody else's namespace", async () => {
		const { dir, cleanup } = await broken(async (d) => {
			const fs = await import("node:fs/promises")
			const p = join(d, "dist/plugin/manifest.json")
			const m = JSON.parse(await fs.readFile(p, "utf8"))
			m.pipelines = [{ id: "core:spec/respond", version: "1.0.0" }]
			m.genres = []
			await writeFile(p, JSON.stringify(m))
			await mkdir(join(d, "dist/plugin/pipelines"), { recursive: true })
			await writeFile(
				join(d, "dist/plugin/pipelines", documentFileName("core:spec/respond")),
				JSON.stringify({
					schemaVersion: 1,
					id: "core:spec/respond",
					version: "1.0.0",
					nodes: [],
					edges: [],
					clauses: [],
					includes: [],
					presets: []
				})
			)
		})
		try {
			expect(
				(await findingsOf(dir)).some((f) => f.includes("namespace 'core'"))
			).toBe(true)
		} finally {
			await cleanup()
		}
	})

	it("refuses a genre with no create pipeline — a genre IS its create spec", async () => {
		const { dir, cleanup } = await broken(async (d) => {
			const fs = await import("node:fs/promises")
			const p = join(d, "dist/plugin/manifest.json")
			const m = JSON.parse(await fs.readFile(p, "utf8"))
			m.pipelines = m.pipelines.filter(
				(x: { id: string }) => x.id !== "demo.unified:spec/create-session"
			)
			await writeFile(p, JSON.stringify(m))
		})
		try {
			expect(
				(await findingsOf(dir)).some((f) =>
					f.includes("ships 0 create pipelines")
				)
			).toBe(true)
		} finally {
			await cleanup()
		}
	})

	it("refuses a surface entry that escapes the package or does not exist", async () => {
		for (const entry of ["../../../etc/passwd", "ui/missing.html"]) {
			const { dir, cleanup } = await broken(async (d) => {
				const fs = await import("node:fs/promises")
				const p = join(d, "dist/plugin/manifest.json")
				const m = JSON.parse(await fs.readFile(p, "utf8"))
				m.surfaces.panels[0].entry = entry
				await writeFile(p, JSON.stringify(m))
			})
			try {
				expect(
					(await findingsOf(dir)).some((f) => f.includes(entry))
				).toBe(true)
			} finally {
				await cleanup()
			}
		}
	})
})

describe("built components (C3)", () => {
	it("stores a component's built module, and refuses one the package does not ship", async () => {
		const withComponent = (write: boolean) =>
			broken(async (d) => {
				const fs = await import("node:fs/promises")
				const p = join(d, "dist/plugin/manifest.json")
				const m = JSON.parse(await fs.readFile(p, "utf8"))
				m.components = [
					{ slug: "who", label: "Who", framework: "vanilla", entry: "dist/plugin/components/who.js", source: "src/who.ts" }
				]
				await writeFile(p, JSON.stringify(m))
				if (write) {
					await mkdir(join(d, "dist/plugin/components"), { recursive: true })
					await writeFile(join(d, "dist/plugin/components/who.js"), "export default () => {}\n")
				}
			})
		const shipped = await withComponent(true)
		try {
			const pkg = await readPluginPackage(shipped.dir)
			expect(pkg.files.map((f) => f.path)).toContain("dist/plugin/components/who.js")
		} finally {
			await shipped.cleanup()
		}
		const missing = await withComponent(false)
		try {
			expect((await findingsOf(missing.dir)).some((f) => f.includes("dist/plugin/components/who.js"))).toBe(true)
		} finally {
			await missing.cleanup()
		}
	})

	it("refuses a component entry that is its source, not the built module", async () => {
		const unbuilt = await broken(async (d) => {
			const fs = await import("node:fs/promises")
			const p = join(d, "dist/plugin/manifest.json")
			const m = JSON.parse(await fs.readFile(p, "utf8"))
			m.components = [{ slug: "who", label: "Who", framework: "svelte", entry: "src/Who.svelte" }]
			await writeFile(p, JSON.stringify(m))
			await mkdir(join(d, "src"), { recursive: true })
			await writeFile(join(d, "src/Who.svelte"), "<p>who</p>\n")
		})
		try {
			expect((await findingsOf(unbuilt.dir)).some((f) => f.includes("is not a built module"))).toBe(true)
		} finally {
			await unbuilt.cleanup()
		}
	})
})

describe("the reserved slug", () => {
	it("refuses a plugin that calls itself core", async () => {
		const fake = await broken(async (d) => {
			const fs = await import("node:fs/promises")
			const p = join(d, "dist/plugin/manifest.json")
			const m = JSON.parse(await fs.readFile(p, "utf8"))
			m.slug = "core"
			await writeFile(p, JSON.stringify(m))
		})
		try {
			expect((await findingsOf(fake.dir)).some((f) => f.includes("'core' is the app's own"))).toBe(true)
		} finally {
			await fake.cleanup()
		}
	})
})

describe("package helpers", () => {
	it("names a document file the way the packager does", () => {
		expect(documentFileName("demo.unified:spec/create-session")).toBe(
			"demo.unified_spec_create-session.json"
		)
	})

	it("reads every surface point, tolerantly", () => {
		expect(
			declaredSurfaceEntries({
				surfaces: {
					"session-view": { entry: "ui/view.html" },
					page: { entry: "ui/page.html" },
					panels: [{ id: "a", entry: "ui/a.html" }, null, { id: "b" }]
				}
			})
		).toEqual(["ui/view.html", "ui/page.html", "ui/a.html"])
		expect(declaredSurfaceEntries(null)).toEqual([])
		expect(declaredSurfaceEntries({ surfaces: "nope" })).toEqual([])
	})

	it("serves an unknown extension as bytes rather than guessing", () => {
		expect(mimeForUiPath("ui/a.js")).toMatch(/javascript/)
		expect(mimeForUiPath("ui/a.wasm")).toBe("application/octet-stream")
	})
})
