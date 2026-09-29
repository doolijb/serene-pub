/**
 * The component compile service, cache, serving route and boot task (C6, P3):
 * the SDK's in-app compiler run in a bounded worker with the app's own
 * toolchain; artifacts in the component cache, atomically written, healed
 * from source when missing; `/authored-ui/…` answering only its one shape
 * for an enabled, compiled row; the boot task recompiling what another
 * toolchain built; and a server with no compiler staying clean.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { readdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as store from "./store"
import * as cache from "./cache"
import * as compile from "./compile"
import { bootAuthoredComponents } from "./boot"
import { serveAuthoredArtifact } from "./serve"
import { authoredArtifactSrc } from "$lib/shared/widgets/authoredOwner"

let db: TestDb
let priorFlag: string | undefined
const D = () => db as never

beforeAll(async () => {
	db = await createTestDb()
	priorFlag = process.env.SP_PLUGINS_ENABLED
	process.env.SP_PLUGINS_ENABLED = "1"
}, 60_000)

afterAll(() => {
	if (priorFlag === undefined) delete process.env.SP_PLUGINS_ENABLED
	else process.env.SP_PLUGINS_ENABLED = priorFlag
})

afterEach(() => compile.__setComponentCompilerForTests(undefined))

let n = 0
function content(files: Record<string, string> = { "App.svelte": `<script>let n = $state(${n})</script><p>count {n}</p>` }, entry = "App.svelte") {
	return {
		slug: `svc-${n++}`,
		label: "Svc",
		framework: "svelte" as const,
		entry,
		files,
		widget: { title: "Svc" }
	}
}

async function created(files?: Record<string, string>, entry?: string) {
	const row = await store.createAuthoredComponent(D(), content(files, entry) as never)
	await store.setAuthoredComponentEnabled(D(), row.id, true)
	return row
}

/** Created, enabled and compiled through the service. */
async function compiled(files?: Record<string, string>) {
	const row = await created(files)
	const r = await compile.compileAndRecord(D(), row.id)
	expect(r.outcome.errors).toEqual([])
	return (await store.getAuthoredComponent(D(), row.id))!
}

const artifactFile = (id: string, hash: string) => join(cache.componentCacheDir(), `authored.${id}`, `${hash}.js`)
const rest = (src: string) => src.replace(/^\/authored-ui\//, "")

/** A compiler module that never answers (a runaway compile), as a data: URL the worker imports. */
const SLOW_COMPILER =
	"data:text/javascript," +
	encodeURIComponent(
		"export function toolchainFingerprint(){return 'slow'}\n" +
			"export async function compileComponentSource(){for(;;){}}"
	)
/** One whose compile allocates without end (a heap-exhausting one). */
const GREEDY_COMPILER =
	"data:text/javascript," +
	encodeURIComponent(
		"export function toolchainFingerprint(){return 'greedy'}\n" +
			"export async function compileComponentSource(){const a=[];for(;;){a.push(new Array(1e5).fill(Math.random()))}}"
	)
function withCompiler(compileUrl: string) {
	const real = compile.componentCompilerAvailability()
	if (!real.available) throw new Error("the real toolchain must be available for this test")
	compile.__setComponentCompilerForTests({
		available: true,
		toolchain: { ...real.toolchain, urls: { ...real.toolchain.urls, compile: compileUrl } }
	})
}

describe("the toolchain", () => {
	test("this server has one: the SDK's compiler, native esbuild and Svelte's compiler, resolved from the app root", async () => {
		const a = compile.componentCompilerAvailability()
		expect(a.available).toBe(true)
		if (!a.available) return
		expect(a.toolchain.resolveFrom).toBe(resolve(process.cwd()))
		expect(a.toolchain.urls.compile).toMatch(/\/cli\/dist\/componentCompile\.js$/)
		expect(a.toolchain.urls.esbuild).toMatch(/\/node_modules\/esbuild\//)
		expect(a.toolchain.urls.svelte).toMatch(/\/node_modules\/svelte\/.*compiler/)
		const fp = await compile.currentToolchainFingerprint()
		const esbuildVersion = JSON.parse(readFileSync("node_modules/esbuild/package.json", "utf8")).version
		expect(fp).toContain(`esbuild@${esbuildVersion}`)
		expect(fp).toMatch(/^compiler@\d+ .*svelte-compiler@5\./)
	})

	test("a compile gives the module, its SHA-256 and the toolchain fingerprint — deterministically", async () => {
		const input = { files: { "A.svelte": "<p>hello</p>" }, entry: "A.svelte", framework: "svelte" as const }
		const a = await compile.previewCompile(input.files, input.entry, input.framework)
		const b = await compile.previewCompile(input.files, input.entry, input.framework)
		expect(a.errors).toEqual([])
		expect(a.hash).toMatch(/^[a-f0-9]{64}$/)
		expect(b.hash).toBe(a.hash)
		expect(a.fingerprint).toBe(await compile.currentToolchainFingerprint())
	})

	test("an author's mistake comes back located, and a disallowed import names the list — nothing thrown", async () => {
		const bad = await compile.previewCompile(
			{ "A.svelte": "<script>import './B.svelte'</script><p>a</p>", "B.svelte": "<p>{</p>" },
			"A.svelte",
			"svelte"
		)
		expect(bad.code).toBe("")
		expect(bad.errors[0]!.file).toBe("B.svelte")
		expect(bad.errors[0]!.line).toBe(1)
		for (const spec of ["node:fs", "lodash", "svelte/../../package.json"]) {
			const leak = await compile.previewCompile({ "A.js": `import x from '${spec}'; export default x` }, "A.js", "vanilla")
			expect(leak.code).toBe("")
			expect(leak.errors.map((e) => e.text).join(" ")).toMatch(/'svelte', 'svelte\/\*', .*'@serene-pub\/controls'/)
		}
	})

	test("a core component's source.json (a clone as it starts) compiles through the service", async () => {
		const doc = JSON.parse(
			readFileSync("node_modules/@serene-pub/core-catalog/dist/components/stats.source.json", "utf8")
		) as { files: Record<string, string>; entry: string; framework: "svelte" }
		const r = await compile.previewCompile(doc.files, doc.entry, doc.framework)
		expect(r.errors).toEqual([])
		expect(r.code.length).toBeGreaterThan(1000)
	})
})

describe("bounds", () => {
	test("a runaway compile is stopped at the time limit, and the server compiles on afterwards", async () => {
		withCompiler(SLOW_COMPILER)
		const t = Date.now()
		const r = await compile.compileComponent(
			{ files: { "A.svelte": "<p/>" }, entry: "A.svelte", framework: "svelte" },
			{ timeoutMs: 1_000 }
		)
		expect(Date.now() - t).toBeLessThan(8_000)
		expect(r.code).toBe("")
		expect(r.errors).toEqual([{ file: "A.svelte", line: 0, column: 0, text: "the compile took longer than 1 s and was stopped" }])
		compile.__setComponentCompilerForTests(undefined)
		const ok = await compile.previewCompile({ "A.svelte": "<p>after</p>" }, "A.svelte", "svelte")
		expect(ok.errors).toEqual([])
	})

	test("a compile that exhausts its heap cap is stopped, not the server", async () => {
		withCompiler(GREEDY_COMPILER)
		const r = await compile.compileComponent(
			{ files: { "A.svelte": "<p/>" }, entry: "A.svelte", framework: "svelte" },
			{ heapMb: 32, timeoutMs: 30_000 }
		)
		expect(r.errors[0]!.text).toMatch(/ran out of memory \(32 MB\) and was stopped/)
	})

	test("a runaway compile of a saved component lands as its last_error, and it is not served", async () => {
		const row = await created()
		withCompiler(SLOW_COMPILER)
		const r = await compile.compileAndRecord(D(), row.id, { timeoutMs: 500 })
		expect(r.recorded).toBe(true)
		const after = (await store.getAuthoredComponent(D(), row.id))!
		expect(after.lastError).toMatch(/took longer than 0\.5 s and was stopped/)
		expect(after.artifactHash).toBeNull()
	})
})

describe("compileAndRecord", () => {
	test("puts the artifact in the cache and records its hash and the fingerprint on the row", async () => {
		const row = await compiled()
		expect(row.artifactHash).toMatch(/^[a-f0-9]{64}$/)
		expect(row.fingerprint).toBe(await compile.currentToolchainFingerprint())
		expect(row.lastError).toBeNull()
		expect(existsSync(artifactFile(row.id, row.artifactHash!))).toBe(true)
		expect(await cache.readArtifact(row.id, row.artifactHash!)).toContain("count")
		// Atomic: no temp file is left beside it.
		expect((await readdir(join(cache.componentCacheDir(), `authored.${row.id}`))).filter((f) => f.endsWith(".tmp"))).toEqual([])
	})

	test("a compile error lands as last_error, file:line first, and no artifact", async () => {
		const row = await created({ "App.svelte": "<p>{</p>" })
		const r = await compile.compileAndRecord(D(), row.id)
		expect(r.outcome.errors.length).toBeGreaterThan(0)
		const after = (await store.getAuthoredComponent(D(), row.id))!
		expect(after.artifactHash).toBeNull()
		expect(after.lastError).toMatch(/^App\.svelte:1:\d+ /)
	})

	test("single-flight: a burst of three is two compiles, and the last is of the last source", async () => {
		const row = await created()
		const before = compile.componentCompileRuns()
		const [a, b, c] = await Promise.all([
			compile.compileAndRecord(D(), row.id),
			compile.compileAndRecord(D(), row.id),
			compile.compileAndRecord(D(), row.id)
		])
		expect(compile.componentCompileRuns() - before).toBe(2)
		expect(b).toBe(c)
		expect(a.outcome.hash).toBe(b.outcome.hash)
	})

	test("a compile of source that changed meanwhile does not land", async () => {
		const row = await created()
		const pending = compile.compileAndRecord(D(), row.id)
		await store.updateAuthoredComponent(D(), row.id, row.updatedAt, { files: { "App.svelte": "<p>newer</p>" } })
		const r = await pending
		expect(r.recorded).toBe(false)
		expect((await store.getAuthoredComponent(D(), row.id))!.artifactHash).toBeNull()
	})
})

describe("the cache", () => {
	test("refuses to file bytes under a hash they are not, and reads damaged bytes as missing", async () => {
		const id = "abcdefghij"
		await expect(cache.writeArtifact(id, "a".repeat(64), "code")).rejects.toThrow(/does not hash/)
		const code = "export default 1"
		const { createHash } = await import("node:crypto")
		const hash = createHash("sha256").update(code).digest("hex")
		await cache.writeArtifact(id, hash, code)
		expect(await cache.readArtifact(id, hash)).toBe(code)
		await writeFile(artifactFile(id, hash), "export default 2")
		expect(await cache.readArtifact(id, hash)).toBeNull()
		expect(await cache.readArtifact(id, "../../x")).toBeNull()
	})
})

describe("the boot task", () => {
	test("a row built by another toolchain is recompiled; a current one is not touched", async () => {
		const stale = await compiled()
		const current = await compiled()
		await db.update(schema.authoredComponents).set({ fingerprint: "compiler@0 esbuild@0.0.0" }).where(eq(schema.authoredComponents.id, stale.id))
		const r = await bootAuthoredComponents(D())
		expect(r.recompiled).toContain(stale.id)
		expect(r.recompiled).not.toContain(current.id)
		const after = (await store.getAuthoredComponent(D(), stale.id))!
		expect(after.fingerprint).toBe(await compile.currentToolchainFingerprint())
		expect(after.artifactHash).toBe(stale.artifactHash)
	})

	test("a deleted cache heals: every artifact is rebuilt from source, same hash", async () => {
		const row = await compiled()
		await rm(cache.componentCacheDir(), { recursive: true, force: true })
		const r = await bootAuthoredComponents(D())
		expect(r.recompiled).toContain(row.id)
		expect(await cache.readArtifact(row.id, row.artifactHash!)).not.toBeNull()
	})

	test("a failure lands in last_error and is reported; the row is then not offered", async () => {
		const row = await created({ "App.svelte": "<p>{</p>" })
		const r = await bootAuthoredComponents(D())
		expect(r.failed.map((f) => f.id)).toContain(row.id)
		expect((await store.getAuthoredComponent(D(), row.id))!.lastError).toBeTruthy()
		const { offeredAuthoredWidgetIds } = await import("./offer")
		expect([...(await offeredAuthoredWidgetIds(D()))].some((w) => w.includes(row.id))).toBe(false)
	})

	test("the cache is tidied to what rows name: a deleted component's artifacts go", async () => {
		const row = await compiled()
		await store.deleteAuthoredComponent(D(), row.id, row.updatedAt)
		await bootAuthoredComponents(D())
		expect(existsSync(join(cache.componentCacheDir(), `authored.${row.id}`))).toBe(false)
	})
})

describe("/authored-ui/", () => {
	test("serves an enabled, compiled row's artifact: JS, immutable, nosniff", async () => {
		const row = await compiled()
		const res = await serveAuthoredArtifact(D(), rest(authoredArtifactSrc(row.id, row.artifactHash!)))
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
		expect(res.headers.get("cache-control")).toContain("immutable")
		expect(res.headers.get("x-content-type-options")).toBe("nosniff")
		expect(await res.text()).toBe(await cache.readArtifact(row.id, row.artifactHash!))
	})

	test("a missing artifact is rebuilt from source and served", async () => {
		const row = await compiled()
		await rm(artifactFile(row.id, row.artifactHash!))
		const res = await serveAuthoredArtifact(D(), rest(authoredArtifactSrc(row.id, row.artifactHash!)))
		expect(res.status).toBe(200)
		expect(existsSync(artifactFile(row.id, row.artifactHash!))).toBe(true)
	})

	test("404 for every other shape — traversal, encodings, backslashes, source paths, another row's hash", async () => {
		const a = await compiled()
		const b = await compiled({ "App.svelte": "<p>other</p>" })
		const own = `authored.${a.id}/${a.artifactHash}.js`
		const cases = [
			`authored.${a.id}/../authored.${b.id}/${b.artifactHash}.js`,
			`authored.${a.id}/%2e%2e/${a.artifactHash}.js`,
			`authored.${a.id}/%2E%2E%2F${a.artifactHash}.js`,
			`authored.${a.id}\\${a.artifactHash}.js`,
			`authored.${a.id}/..\\${a.artifactHash}.js`,
			`authored.${a.id}/App.svelte`,
			`authored.${a.id}/source.json`,
			`authored.${a.id}/${b.artifactHash}.js`,
			`authored.${a.id}/${a.artifactHash!.toUpperCase()}.js`,
			`authored.${a.id}/${a.artifactHash}`,
			`authored.${a.id}/${a.artifactHash}.js/x`,
			`authored.${a.id}/x/${a.artifactHash}.js`,
			`${a.id}/${a.artifactHash}.js`,
			`core/${a.artifactHash}.js`,
			`authored.${a.id}/.${a.artifactHash}.tmp`,
			""
		]
		for (const c of cases) expect([c, (await serveAuthoredArtifact(D(), c)).status]).toEqual([c, 404])
		expect((await serveAuthoredArtifact(D(), own)).status).toBe(200)
	})

	test("a superseded artifact is a 404, even while its file is still in the cache", async () => {
		const row = await compiled()
		const old = row.artifactHash!
		const moved = await store.updateAuthoredComponent(D(), row.id, row.updatedAt, { files: { "App.svelte": "<p>moved on</p>" } })
		await compile.compileAndRecord(D(), moved.id)
		const now = (await store.getAuthoredComponent(D(), row.id))!
		expect(now.artifactHash).not.toBe(old)
		expect(existsSync(artifactFile(row.id, old))).toBe(true)
		expect((await serveAuthoredArtifact(D(), `authored.${row.id}/${old}.js`)).status).toBe(404)
		expect((await serveAuthoredArtifact(D(), `authored.${row.id}/${now.artifactHash}.js`)).status).toBe(200)
	})

	test("404 for a disabled, an uncompiled or a failed row, and with the subsystem off", async () => {
		const disabled = await compiled()
		await store.setAuthoredComponentEnabled(D(), disabled.id, false)
		expect((await serveAuthoredArtifact(D(), `authored.${disabled.id}/${disabled.artifactHash}.js`)).status).toBe(404)

		const failed = await compiled()
		await db.update(schema.authoredComponents).set({ lastError: "x" }).where(eq(schema.authoredComponents.id, failed.id))
		expect((await serveAuthoredArtifact(D(), `authored.${failed.id}/${failed.artifactHash}.js`)).status).toBe(404)

		const on = await compiled()
		const path = `authored.${on.id}/${on.artifactHash}.js`
		process.env.SP_PLUGINS_ENABLED = "0"
		try {
			expect((await serveAuthoredArtifact(D(), path)).status).toBe(404)
		} finally {
			process.env.SP_PLUGINS_ENABLED = "1"
		}
		expect((await serveAuthoredArtifact(D(), path)).status).toBe(200)
	})
})

describe("no compiler (Android)", () => {
	test("Android is detected as having none, with a reason", () => {
		const prior = process.env.SERENE_PUB_PLATFORM
		process.env.SERENE_PUB_PLATFORM = "android"
		try {
			compile.__setComponentCompilerForTests(undefined)
			const a = compile.componentCompilerAvailability()
			expect(a.available).toBe(false)
			if (!a.available) expect(a.reason).toMatch(/Android/)
		} finally {
			if (prior === undefined) delete process.env.SERENE_PUB_PLATFORM
			else process.env.SERENE_PUB_PLATFORM = prior
			compile.__setComponentCompilerForTests(undefined)
		}
	})

	test("compiles refuse cleanly, boot leaves rows as they are, and the route answers without throwing", async () => {
		const row = await compiled()
		await db.update(schema.authoredComponents).set({ fingerprint: "other-toolchain" }).where(eq(schema.authoredComponents.id, row.id))
		await rm(artifactFile(row.id, row.artifactHash!))
		compile.__setComponentCompilerForTests({ available: false, reason: "no compiler here" })

		await expect(compile.compileAndRecord(D(), row.id)).rejects.toBeInstanceOf(compile.ComponentCompilerUnavailable)
		await expect(compile.previewCompile({ "A.svelte": "<p/>" }, "A.svelte", "svelte")).rejects.toThrow(/no compiler here/)
		const r = await bootAuthoredComponents(D())
		expect(r).toEqual({ skipped: "no compiler here", recompiled: [], failed: [], pruned: 0 })
		const after = (await store.getAuthoredComponent(D(), row.id))!
		expect([after.fingerprint, after.artifactHash, after.lastError]).toEqual(["other-toolchain", row.artifactHash, null])
		expect((await serveAuthoredArtifact(D(), `authored.${row.id}/${row.artifactHash}.js`)).status).toBe(404)
	})
})
