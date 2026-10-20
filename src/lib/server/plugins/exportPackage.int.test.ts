/**
 * Export a genre as a content-only package, and install a package from an
 * upload (PLAN-pipeline-canvas-and-genre-authoring §7, P5).
 *
 * Round trip: the unified fixture is installed from its folder, its genre is
 * exported through `plugins:exportPackage`, the zip is read back, the plugin
 * is uninstalled, and the zip is installed through `plugins:installPackage` —
 * which must announce the same genre, pipelines, presets and configs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let db: TestDb
let adminId: number
let strangerId: number
let dataDir: string
let priorFlag: string | undefined
let priorDataDir: string | undefined

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "export-package-test-secret" }
})

const FIXTURE = path.resolve(
	process.cwd(),
	"src/lib/server/plugins/fixtures/unified-plugin"
)
const SLUG = "demo.unified"
const GENRE = "demo.unified:genre/tally"
const CREATE = "demo.unified:spec/create-session"
const RESPOND = "demo.unified:spec/respond"
const OFF_WORDS = /The plugin subsystem is off/

beforeAll(async () => {
	priorFlag = process.env.SP_PLUGINS_ENABLED
	process.env.SP_PLUGINS_ENABLED = "1"
	priorDataDir = process.env.SERENE_PUB_DATA_DIR
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-export-package-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
	const [admin] = await db
		.insert(schema.users)
		.values({ username: "export-package-admin", isAdmin: true })
		.returning()
	adminId = admin.id
	const [stranger] = await db
		.insert(schema.users)
		.values({ username: "export-package-stranger", isAdmin: false })
		.returning()
	strangerId = stranger.id
}, 120_000)

afterAll(async () => {
	const { shutdownPlugins } = await import("$lib/server/plugins")
	await shutdownPlugins()
	if (priorFlag === undefined) delete process.env.SP_PLUGINS_ENABLED
	else process.env.SP_PLUGINS_ENABLED = priorFlag
	if (priorDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = priorDataDir
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketFor = (userId: number, isAdmin: boolean) =>
	({ user: { id: userId, isAdmin }, io: { to: () => ({ emit: () => {} }) } }) as any

function collector() {
	const events: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => {
		if (typeof data === "function")
			return Promise.resolve(data()).then((d) => {
				events.push({ event, data: d })
			})
		events.push({ event, data })
	}
	return {
		emit: emit as any,
		events,
		last: (e: string) => events.filter((x) => x.event === e).at(-1)?.data
	}
}

const asAdmin = () => socketFor(adminId, true)

async function exportGenre(): Promise<{ zip: Uint8Array; res: any }> {
	const { pluginsExportPackage } = await import("$lib/server/sockets/pluginPackages")
	const c = collector()
	const res: any = await pluginsExportPackage.handler(
		asAdmin(),
		{ genreId: GENRE },
		c.emit
	)
	expect(c.last("plugins:exportPackage")).toBe(res)
	return { zip: new Uint8Array(res.blob), res }
}

let fixtureManifest: any
let exported: Record<string, Uint8Array>
let exportedManifest: any
let zip: Uint8Array

describe("export", () => {
	it("installs the fixture, then exports its genre as a package zip", async () => {
		fixtureManifest = JSON.parse(
			await fs.readFile(path.join(FIXTURE, "dist/plugin/manifest.json"), "utf8")
		)
		const { pluginsInstallLocal } = await import("$lib/server/sockets/plugins")
		const installed: any = await pluginsInstallLocal.handler(
			asAdmin(),
			{ dir: FIXTURE },
			collector().emit
		)
		expect(installed.pluginId).toBe(SLUG)

		const out = await exportGenre()
		zip = out.zip
		expect(out.res.filename).toBe(`${SLUG}-${fixtureManifest.version}.zip`)
		expect(Array.isArray(out.res.warnings)).toBe(true)
		exported = unzipSync(zip)
		exportedManifest = JSON.parse(strFromU8(exported["dist/plugin/manifest.json"]))
	})

	it("writes a manifest the package reader's layout expects", () => {
		expect(exportedManifest.schemaVersion).toBe(1)
		expect(exportedManifest.slug).toBe(SLUG)
		expect(exportedManifest.version).toBe(fixtureManifest.version)
		expect(exportedManifest.genres.map((g: any) => g.id)).toEqual([GENRE])
		expect(exportedManifest.genres[0].shape).toBeTruthy()
		const ids = exportedManifest.pipelines.map((p: any) => p.id)
		expect(ids).toContain(CREATE)
		expect(ids).toContain(RESPOND)
		// No code travels.
		expect(exported["dist/plugin/bundle.js"]).toBeUndefined()
		expect(exportedManifest.hooks).toBeUndefined()
	})

	it("ships one parsable document per manifest pipeline, and nothing else", () => {
		const ids = new Set(exportedManifest.pipelines.map((p: any) => p.id))
		const docs = Object.keys(exported).filter((k) =>
			k.startsWith("dist/plugin/pipelines/")
		)
		expect(docs.length).toBe(ids.size)
		for (const k of docs) {
			const doc = JSON.parse(strFromU8(exported[k]))
			expect(ids.has(doc.id)).toBe(true)
			expect(k).toBe(`dist/plugin/pipelines/${doc.id.replace(/[:/]/g, "_")}.json`)
		}
		const create = JSON.parse(
			strFromU8(exported["dist/plugin/pipelines/demo.unified_spec_create-session.json"])
		)
		expect(create.input).toMatchObject({
			genre: GENRE,
			event: "core:event/session-created@1"
		})
	})

	it("carries presets with config slugs, and configs with values", () => {
		const preset = exportedManifest.presets.find((p: any) => p.slug === "tally")
		expect(preset).toBeTruthy()
		expect(preset.genre).toBe(GENRE)
		expect(preset.bindings["core:event/message-respond@1"]).toMatchObject({
			spec: RESPOND,
			config: "tally-default"
		})
		const keys = exportedManifest.configs.map((c: any) => `${c.spec}#${c.slug}`)
		expect(keys).toContain(`${RESPOND}#tally-default`)
		expect(keys).toContain("core:spec/story-respond#tally-flavoured")
		const shipped = exportedManifest.configs.find((c: any) => c.slug === "tally-default")
		expect(shipped.values).toEqual({ tally: { params: { trim: true } } })
		expect(exportedManifest.requires).toContain("core:spec/story-respond")
		// Core's events the pipelines lock on and the presets bind travel as
		// requirements too, so an older pub refuses by name; no package event.
		expect(exportedManifest.requires).toContain("core:event/session-created@1")
		expect(exportedManifest.requires).toContain("core:event/message-respond@1")
		expect(
			exportedManifest.requires
				.filter((r: string) => r.includes(":event/"))
				.every((r: string) => r.startsWith("core:event/"))
		).toBe(true)
	})

	it("carries the frame component and ui files at the fixture's paths", async () => {
		for (const rel of [
			"dist/plugin/components/tally.js",
			"ui/tally.html",
			"ui/tally.css",
			"ui/tally.js"
		]) {
			expect(exported[rel], rel).toBeTruthy()
			const original = await fs.readFile(path.join(FIXTURE, rel))
			expect(Buffer.from(exported[rel]).equals(original), rel).toBe(true)
		}
		expect(exportedManifest.components.map((c: any) => c.entry)).toEqual([
			"dist/plugin/components/tally.js"
		])
	})
})

describe("install from an upload", () => {
	it("round-trips: uninstall, install the export, announce the same things", async () => {
		const { pluginsUninstall } = await import("$lib/server/sockets/plugins")
		await pluginsUninstall.handler(asAdmin(), { pluginId: SLUG }, collector().emit)
		const [gone] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CREATE))
		expect(gone).toBeUndefined()

		const { pluginsInstallPackage } = await import(
			"$lib/server/sockets/pluginPackages"
		)
		const c = collector()
		const res: any = await pluginsInstallPackage.handler(
			asAdmin(),
			{ filename: `${SLUG}.zip`, bytes: Buffer.from(zip).toString("base64") },
			c.emit
		)
		expect(c.last("plugins:installPackage")).toBe(res)
		expect(res.pluginId).toBe(SLUG)
		expect(res.specs.sort()).toEqual([CREATE, RESPOND].sort())
		expect(res.configs.sort()).toEqual(
			[
				`plugin:${SLUG}:${RESPOND}#tally-default`,
				`plugin:${SLUG}:core:spec/story-respond#tally-flavoured`
			].sort()
		)
		expect(res.files).toBe(4)
		// Nothing refused (the bundle-less warning is the only kind allowed).
		expect(
			res.warnings.filter((w: string) => !/ships no sandbox bundle/.test(w))
		).toEqual([])

		// The upload folder is gone.
		const uploads = path.join(dataDir, "plugin-uploads")
		const left = await fs.readdir(uploads).catch(() => [])
		expect(left).toEqual([])

		// And it announces what the fixture announced.
		const again = unzipSync((await exportGenre()).zip)
		const m = JSON.parse(strFromU8(again["dist/plugin/manifest.json"]))
		const announce = (x: any) => ({
			genres: x.genres.map((g: any) => g.id),
			pipelines: x.pipelines.map((p: any) => p.id).sort(),
			presets: x.presets.map((p: any) => `${p.genre}/${p.slug}`).sort(),
			configs: x.configs.map((c: any) => `${c.spec}#${c.slug}`).sort()
		})
		expect(announce(m)).toEqual(announce(fixtureManifest))
		expect(announce(m)).toEqual(announce(exportedManifest))
	})
})

/**
 * Unzip a source export into a folder and run `serene-pub build` on it the way
 * an author does — the CLI in its own process, into `dist/plugin/` over the
 * exported build, as `npm run package` would — and read back the manifest.
 */
async function buildFromSource(
	files: Record<string, Uint8Array>
): Promise<{ rebuilt: any; out: string }> {
	const dir = await fs.mkdtemp(path.join(dataDir, "source-"))
	for (const [rel, bytes] of Object.entries(files)) {
		await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
		await fs.writeFile(path.join(dir, rel), bytes)
	}
	await fs.symlink(path.resolve(process.cwd(), "node_modules"), path.join(dir, "node_modules"), "dir")
	const { execFile } = await import("node:child_process")
	const { promisify } = await import("node:util")
	const bin = path.resolve(process.cwd(), "node_modules/@serene-pub/cli/dist/bin.js")
	const out = path.join(dir, "dist/plugin")
	const run = await promisify(execFile)(process.execPath, [bin, "build", dir], {
		cwd: dir
	}).catch((e: any) => {
		throw new Error(`serene-pub build failed:\n${e.stdout}\n${e.stderr}`)
	})
	expect(run.stdout).toMatch(/wrote/)
	return { rebuilt: JSON.parse(await fs.readFile(path.join(out, "manifest.json"), "utf8")), out }
}

async function exportSource(): Promise<{ res: any; files: Record<string, Uint8Array> }> {
	const { pluginsExportPackage } = await import("$lib/server/sockets/pluginPackages")
	const res: any = await pluginsExportPackage.handler(
		asAdmin(),
		{ genreId: GENRE, scaffold: true },
		collector().emit
	)
	return { res, files: unzipSync(new Uint8Array(res.blob)) }
}

describe("export with source", () => {
	it("unzips into a package `serene-pub build` rebuilds to the same declarations", async () => {
		const { res, files } = await exportSource()
		expect(res.filename).toBe(`${SLUG}-${fixtureManifest.version}-source.zip`)
		// The built package is all there, and the source beside it.
		for (const rel of Object.keys(exported)) expect(files[rel], rel).toBeTruthy()
		for (const rel of ["package.json", "tsconfig.json", "src/index.ts", "src/declarations.json", "README.md"])
			expect(files[rel], rel).toBeTruthy()
		// The fixture's own node is code a pub never stored: said, not faked.
		expect(res.warnings.join(" ")).toMatch(/write the handler for 'demo\.unified:task\/tally@1'/)
		expect(strFromU8(files["README.md"])).toMatch(/What is left for you to write/)

		const { rebuilt, out } = await buildFromSource(files)

		const declared = (x: any) => ({
			slug: x.slug,
			version: x.version,
			genres: x.genres,
			pipelines: x.pipelines.map((p: any) => p.id),
			presets: x.presets,
			configs: x.configs,
			prompts: x.prompts,
			events: x.events ?? [],
			nodeDefinitions: (x.nodeDefinitions ?? []).map((d: any) => d.id),
			components: (x.components ?? []).map((c: any) => [c.slug, c.entry])
		})
		expect(declared(rebuilt)).toEqual(declared(exportedManifest))
		// Both packagers name the core events the pipelines lock on, so an
		// older pub refuses either by name.
		expect(rebuilt.requires).toEqual(exportedManifest.requires)
		// The documents come back byte-identical in meaning.
		for (const id of rebuilt.pipelines.map((p: any) => p.id)) {
			const file = `${id.replace(/[:/]/g, "_")}.json`
			const again = JSON.parse(await fs.readFile(path.join(out, "pipelines", file), "utf8"))
			const first = JSON.parse(strFromU8(exported[`dist/plugin/pipelines/${file}`]))
			expect(again.hash ?? again, id).toEqual(first.hash ?? first)
		}
	}, 120_000)
})

describe("presets as rows", () => {
	it("reads an in-app preset row back, its config id mapped to a slug", async () => {
		const [cfg] = await db
			.select({ id: schema.pipelineConfigs.id })
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					`plugin:${SLUG}:${RESPOND}#tally-default`
				)
			)
		expect(cfg).toBeTruthy()
		await db.insert(schema.sessionPresets).values({
			name: "House Rules!",
			genreId: GENRE,
			bindings: {
				"core:event/session-created@1": { spec: CREATE },
				"core:event/message-respond@1": { spec: RESPOND, config: cfg.id }
			},
			includedActions: [],
			enabled: false
		})
		const m = JSON.parse(
			strFromU8(unzipSync((await exportGenre()).zip)["dist/plugin/manifest.json"])
		)
		const house = m.presets.find((p: any) => p.slug === "house-rules")
		expect(house).toMatchObject({
			genre: GENRE,
			label: "House Rules!",
			enabled: false,
			actions: { include: [] },
			bindings: {
				"core:event/message-respond@1": { spec: RESPOND, config: "tally-default" }
			}
		})
		// The manifest's own preset still travels beside it.
		expect(m.presets.map((p: any) => p.slug)).toContain("tally")
		// And the source export rebuilds the row's preset as the pub exported it.
		const { rebuilt } = await buildFromSource((await exportSource()).files)
		expect(rebuilt.presets).toEqual(m.presets)
		expect(rebuilt.configs).toEqual(m.configs)
	}, 120_000)
})

describe("refusals", () => {
	it("refuses a non-admin, on both events", async () => {
		const m = await import("$lib/server/sockets/pluginPackages")
		for (const [h, params] of [
			[m.pluginsExportPackage, { genreId: GENRE }],
			[m.pluginsInstallPackage, { filename: "x.zip", bytes: "" }]
		] as const) {
			const c = collector()
			await expect(
				(h.handler as any)(socketFor(strangerId, false), params, c.emit)
			).rejects.toThrow(/admin/i)
			expect(c.last(`${h.event}:error`)?.error).toMatch(/admin/i)
		}
	})

	it("refuses with the flag unset, in installLocal's own words", async () => {
		const m = await import("$lib/server/sockets/pluginPackages")
		const { pluginsInstallLocal } = await import("$lib/server/sockets/plugins")
		delete process.env.SP_PLUGINS_ENABLED
		try {
			const local = collector()
			let localWords = ""
			await pluginsInstallLocal
				.handler(asAdmin(), { dir: FIXTURE }, local.emit)
				.catch((e: Error) => (localWords = e.message))
			expect(localWords).toMatch(OFF_WORDS)
			for (const [h, params] of [
				[m.pluginsExportPackage, { genreId: GENRE }],
				[m.pluginsInstallPackage, { filename: "x.zip", bytes: "" }]
			] as const) {
				const c = collector()
				await expect(
					(h.handler as any)(asAdmin(), params, c.emit)
				).rejects.toThrow(localWords)
				expect(c.last(`${h.event}:error`)?.error).toBe(localWords)
			}
		} finally {
			process.env.SP_PLUGINS_ENABLED = "1"
		}
	})

	it("refuses to install over an owner name in-app pipelines already use", async () => {
		// A spec row with no source plugin under the package's own owner name
		// is in-app work; installing the package would take those rows over
		// and an uninstall would delete them (the P5 same-pub edge).
		const inApp = `${SLUG}:spec/made-here`
		await db.insert(schema.pipelineSpecs).values({ slug: inApp, name: "Made here" })
		try {
			const { pluginsInstallPackage } = await import("$lib/server/sockets/pluginPackages")
			const c = collector()
			await expect(
				pluginsInstallPackage.handler(
					asAdmin(),
					{ filename: `${SLUG}.zip`, bytes: Buffer.from(zip).toString("base64") },
					c.emit
				)
			).rejects.toThrow(/is the owner name of a pipeline made on this pub \('demo\.unified:spec\/made-here'\)/)
			expect(c.last("plugins:installPackage:error")?.error).toMatch(/A package cannot install over in-app work/)
			const [still] = await db
				.select({ slug: schema.pipelineSpecs.slug })
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, inApp))
			expect(still?.slug).toBe(inApp)
		} finally {
			await db.delete(schema.pipelineSpecs).where(eq(schema.pipelineSpecs.slug, inApp))
		}
	})

	it("refuses a package requiring a core event this build does not have", async () => {
		const files = unzipSync(zip)
		const m = JSON.parse(strFromU8(files["dist/plugin/manifest.json"]))
		m.requires = [...m.requires, "core:event/time-travel@1"]
		files["dist/plugin/manifest.json"] = strToU8(JSON.stringify(m))
		const { pluginsInstallPackage } = await import("$lib/server/sockets/pluginPackages")
		const c = collector()
		await expect(
			pluginsInstallPackage.handler(
				asAdmin(),
				{ filename: `${SLUG}.zip`, bytes: Buffer.from(zipSync(files)).toString("base64") },
				c.emit
			)
		).rejects.toThrow(
			"'core:event/time-travel@1' is an event this version of Serene Pub does not have; the package needs a newer Serene Pub."
		)
		// The events this build does have are not named.
		expect(c.last("plugins:installPackage:error")?.error).not.toMatch(/message-respond/)
	})

	it("refuses a zip naming a file outside its folder", async () => {
		const { pluginsInstallPackage } = await import(
			"$lib/server/sockets/pluginPackages"
		)
		const evil = zipSync({
			"dist/plugin/manifest.json": strToU8("{}"),
			"../escape.txt": strToU8("out")
		})
		const c = collector()
		await expect(
			pluginsInstallPackage.handler(
				asAdmin(),
				{ filename: "evil.zip", bytes: Buffer.from(evil).toString("base64") },
				c.emit
			)
		).rejects.toThrow(/outside its own folder/)
		expect(c.last("plugins:installPackage:error")?.error).toMatch(
			/outside its own folder/
		)
		await expect(fs.stat(path.join(dataDir, "escape.txt"))).rejects.toThrow()
	})

	it("refuses to export a core genre", async () => {
		const { pluginsExportPackage } = await import(
			"$lib/server/sockets/pluginPackages"
		)
		const c = collector()
		await expect(
			pluginsExportPackage.handler(asAdmin(), { genreId: "core:genre/story" }, c.emit)
		).rejects.toThrow(/cannot be packaged/)
	})

	it("refuses a slug that does not match the genre's owner", async () => {
		const { exportGenrePackage } = await import("./exportPackage")
		await expect(
			exportGenrePackage(db as any, {
				genreId: GENRE,
				slug: "acme.lab",
				version: "1.0.0",
				name: "X"
			})
		).rejects.toThrow(/exports as 'demo.unified'/)
	})
})
