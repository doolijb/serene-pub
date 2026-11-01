/**
 * Package files on disk (M0 P1): a 60 MB package installs to
 * `<dataDir>/plugins/<id>/<version>/`, rows carry the disk columns, an upgrade
 * keeps the N-1 folder until the boot cull, uninstall removes every folder.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { and, eq } from "drizzle-orm"
import "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"

const FIXTURE = resolve(process.cwd(), "src/lib/server/plugins/fixtures/unified-plugin")
const PLUGIN = "demo.unified"

let db: TestDb
let dataDir: string
let pkgDir: string
let priorDataDir: string | undefined
const big = Buffer.alloc(60 * 1024 * 1024, 7)

const exists = (p: string) => stat(p).then(() => true, () => false)
const rowOf = async (path: string) => {
	const [r] = await db
		.select()
		.from(schema.pluginFiles)
		.where(and(eq(schema.pluginFiles.pluginId, PLUGIN), eq(schema.pluginFiles.path, path)))
	return r
}
const setVersion = async (version: string) => {
	const file = join(pkgDir, "dist/plugin/manifest.json")
	const m = JSON.parse(await readFile(file, "utf8"))
	m.version = version
	m.assets = {}
	await writeFile(file, JSON.stringify(m))
}

beforeAll(async () => {
	priorDataDir = process.env.SERENE_PUB_DATA_DIR
	dataDir = await mkdtemp(join(tmpdir(), "sp-pkgdisk-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	pkgDir = await mkdtemp(join(tmpdir(), "sp-pkgdisk-src-"))
	await cp(FIXTURE, pkgDir, { recursive: true })
	await mkdir(join(pkgDir, "assets"), { recursive: true })
	await mkdir(join(pkgDir, "lang"), { recursive: true })
	await writeFile(join(pkgDir, "assets/big.bin"), big)
	await writeFile(join(pkgDir, "assets/pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
	await writeFile(join(pkgDir, "lang/pt-br.json"), "{}")
	await setVersion("1.0.0")
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
}, 60_000)

afterAll(async () => {
	if (priorDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = priorDataDir
	await rm(dataDir, { recursive: true, force: true })
	await rm(pkgDir, { recursive: true, force: true })
}, 60_000)

describe("package files on disk", () => {
	it("installs a 60 MB package to disk", async () => {
		const { installPluginPackage } = await import("./install")
		const report = await installPluginPackage(db, pkgDir)
		expect(report.files.refused).toEqual([])

		const ui = await rowOf("ui/tally.html")
		expect(ui.storedAt).toBe("db")
		expect(ui.content).toBeTruthy()
		expect(ui.diskPath).toBeNull()
		expect(ui.kind).toBe("ui")

		const row = await rowOf("assets/big.bin")
		expect(row.storedAt).toBe("disk")
		expect(row.content).toBeNull()
		expect(row.diskPath).toBe(`plugins/${PLUGIN}/1.0.0/assets/big.bin`)
		expect(row.bytes).toBe(big.byteLength)
		expect(row.hash).toBe(createHash("sha256").update(big).digest("hex"))
		expect(row.kind).toBe("asset")
		expect(await exists(join(dataDir, row.diskPath!))).toBe(true)

		expect((await rowOf("lang/pt-br.json")).kind).toBe("asset")
	}, 60_000)

	it("an upgrade keeps the N-1 folder until the cull", async () => {
		const { installPluginPackage, cullPluginPackageDirs } = await import("./install")
		await setVersion("1.1.0")
		await installPluginPackage(db, pkgDir)
		const base = join(dataDir, "plugins", PLUGIN)
		expect(await exists(join(base, "1.0.0"))).toBe(true)
		expect(await exists(join(base, "1.1.0"))).toBe(true)
		const lines = await cullPluginPackageDirs(db)
		expect(lines).toHaveLength(1)
		expect(await exists(join(base, "1.0.0"))).toBe(false)
		expect(await exists(join(base, "1.1.0"))).toBe(true)
	}, 60_000)

	it("readPluginFileBytes reads db and disk rows alike", async () => {
		const { readPluginFileBytes } = await import("./frameHost")
		const ui = await rowOf("ui/tally.html")
		expect((await readPluginFileBytes(ui)).toString()).toBe(
			await readFile(join(pkgDir, "ui/tally.html"), "utf8")
		)
		const disk = await readPluginFileBytes(await rowOf("assets/big.bin"))
		expect(disk.byteLength).toBe(big.byteLength)
	}, 60_000)

	it("removePluginPackageDir removes every version", async () => {
		const { removePluginPackageDir } = await import("./install")
		await removePluginPackageDir(PLUGIN)
		expect(await exists(join(dataDir, "plugins", PLUGIN))).toBe(false)
	}, 60_000)
})

describe("a build that drops a spec (2026-10-31)", () => {
	it("retires what it no longer ships before anything is judged: no slash-name collision with its successor, the row kept and readable", async () => {
		const { spec, compile } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { documentFileName } = await import("./pluginPackage")
		const { installPluginPackage } = await import("./install")
		const { projectRegistrations } = await import("$lib/server/pipelines/registrations/project")
		const { assertInstallSlashNamesFree, loadDocument } = await import("$lib/server/pipelines/boot/store")
		const dir = await mkdtemp(join(tmpdir(), "sp-retire-src-"))
		await cp(FIXTURE, dir, { recursive: true })
		const manifestFile = join(dir, "dist/plugin/manifest.json")
		// One build: the fixture's specs plus `ids`, each contributing the action `tidy` (so `/demo.unified.tidy` in the fixture's genre).
		const build = async (version: string, ids: string[]) => {
			const m = JSON.parse(await readFile(manifestFile, "utf8"))
			m.version = version
			m.assets = {}
			m.pipelines = (m.pipelines as { id: string }[]).filter((p) => !p.id.includes("tidy"))
			for (const id of ids) {
				const doc = compile(
					(spec(id, {
						version: "1.0.0",
						taxonomy: { role: "action" },
						contributes: { actions: [{ key: "tidy", venue: { kind: "composer" }, label: { en: "Tidy" }, description: { en: "Tidy the table." } }] }
					} as any) as any)
						.inlet("input", C.userMessage.v1(), { suits: [] })
						.outlet("save", () => C.createMessage.v1({ text: "Tidied.", narration: true } as any))
						.build()
				)
				await writeFile(join(dir, "dist/plugin/pipelines", documentFileName(id)), JSON.stringify(doc))
				m.pipelines.push({ id, version: "1.0.0", nodes: doc.nodes.length, presets: [] })
			}
			await writeFile(manifestFile, JSON.stringify(m))
		}
		const A = "demo.unified:spec/tidy-a"
		const B = "demo.unified:spec/tidy-b"
		try {
			// Build 1 ships A; a boot projects its action into the genre.
			await build("2.0.0", [A])
			expect((await installPluginPackage(db, dir)).specs).toContain(A)
			await projectRegistrations(db as any)
			// Build 2 drops A and ships B, which takes the same action key; the next boot projects B's.
			await build("2.1.0", [B])
			const report = await installPluginPackage(db, dir)
			expect(report.retired).toEqual([A])
			expect(report.specs).toContain(B)
			await projectRegistrations(db as any)
			await expect(assertInstallSlashNamesFree(db as any)).resolves.toBeUndefined()
			// A's row stays, its active version retired, its document still read by id.
			const [a] = await db.select().from(schema.pipelineSpecs).where(eq(schema.pipelineSpecs.slug, A))
			expect(a?.activeVersionId).toBeTruthy()
			const [v] = await db.select().from(schema.pipelineSpecVersions).where(eq(schema.pipelineSpecVersions.id, a!.activeVersionId!))
			expect(v?.status).toBe("retired")
			expect((await loadDocument(db as any, a!.activeVersionId!)).id).toBe(A)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	}, 120_000)
})
