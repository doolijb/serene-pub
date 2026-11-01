/**
 * `/api/admin/plugins/package`, end to end through its three steps (start,
 * pieces, finish): who may upload, from where, how much, and that a good
 * package sent in pieces installs and leaves nothing behind in the data dir.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { zipSync } from "fflate"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

// The cap is read when pluginPackage loads, so it is set before anything imports.
vi.stubEnv("SP_PLUGIN_PACKAGE_MAX_MB", "1")

let db: TestDb
let dataDir: string
let priorFlag: string | undefined
let priorDataDir: string | undefined
let adminId: number
let otherAdminId: number

const auth = vi.hoisted(() => ({ user: null as any }))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "package-upload-test-secret" }
})
vi.mock("$lib/server/auth/authenticateRequest", () => ({
	authenticateRequest: vi.fn(async () => auth.user)
}))

const FIXTURE = path.resolve(
	process.cwd(),
	"src/lib/server/plugins/fixtures/unified-plugin"
)
const SLUG = "demo.unified"

/** Every file of a folder, as zip entries keyed by relative path. */
async function folderEntries(
	dir: string,
	rel = ""
): Promise<Record<string, Uint8Array>> {
	const out: Record<string, Uint8Array> = {}
	for (const e of await fs.readdir(path.join(dir, rel), {
		withFileTypes: true
	})) {
		const r = rel ? `${rel}/${e.name}` : e.name
		if (e.isDirectory()) Object.assign(out, await folderEntries(dir, r))
		else out[r] = new Uint8Array(await fs.readFile(path.join(dir, r)))
	}
	return out
}

beforeAll(async () => {
	priorFlag = process.env.SP_PLUGINS_ENABLED
	process.env.SP_PLUGINS_ENABLED = "1"
	priorDataDir = process.env.SERENE_PUB_DATA_DIR
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "laneP-upload-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
	const [admin] = await db
		.insert(schema.users)
		.values({ username: "package-upload-admin", isAdmin: true })
		.returning()
	adminId = admin.id
	const [other] = await db
		.insert(schema.users)
		.values({ username: "package-upload-admin-2", isAdmin: true })
		.returning()
	otherAdminId = other.id
}, 120_000)

afterAll(async () => {
	const { shutdownPlugins } = await import("$lib/server/plugins")
	await shutdownPlugins()
	if (priorFlag === undefined) delete process.env.SP_PLUGINS_ENABLED
	else process.env.SP_PLUGINS_ENABLED = priorFlag
	if (priorDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = priorDataDir
	vi.unstubAllEnvs()
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
	auth.user = { id: adminId, username: "package-upload-admin", isAdmin: true }
})

const ORIGIN = { origin: "http://localhost" }

async function call(
	method: "POST" | "PUT",
	query: string,
	body: Uint8Array | null,
	headers: Record<string, string> = ORIGIN
) {
	const { handlePackagePost, handlePackagePiece } = await import(
		"./packageUpload"
	)
	const url = new URL(`http://localhost/api/admin/plugins/package${query}`)
	const request = new Request(url, {
		method,
		body: body as any,
		headers
	})
	const event = {
		request,
		url,
		cookies: { get: () => undefined },
		getClientAddress: () => "127.0.0.1"
	} as any
	const res = await (method === "POST"
		? handlePackagePost(event)
		: handlePackagePiece(event))
	return { status: res.status, json: (await res.json()) as any }
}

const start = (headers: Record<string, string> = ORIGIN) =>
	call("POST", "", null, headers)
const piece = (id: string, offset: number, body: Uint8Array) =>
	call("PUT", `?upload=${id}&offset=${offset}`, body)
const finish = (id: string) => call("POST", `?upload=${id}`, null)

/** Start, send `bytes` in `size`-byte pieces, finish. */
async function uploadInPieces(bytes: Uint8Array, size: number) {
	const s = await start({
		...ORIGIN,
		"x-package-filename": encodeURIComponent("demo unified.zip")
	})
	expect(s.status).toBe(200)
	for (let at = 0; at < bytes.length; at += size) {
		const r = await piece(s.json.upload, at, bytes.slice(at, at + size))
		expect(r.json.error).toBeUndefined()
		expect(r.json.received).toBe(Math.min(at + size, bytes.length))
	}
	return { id: s.json.upload as string, done: await finish(s.json.upload) }
}

const goodZip = async () => zipSync(await folderEntries(FIXTURE))
const partsLeft = async () =>
	(await fs.readdir(path.join(dataDir, "plugin-uploads"))).filter((n) =>
		n.endsWith(".part")
	)

describe("package upload: start", () => {
	it("refuses a request that is not signed in (401)", async () => {
		auth.user = null
		const r = await start()
		expect(r.status).toBe(401)
		expect(r.json.error).toBe("Sign in to install a package.")
	})

	it("refuses a non-admin (403)", async () => {
		auth.user = { id: 99, username: "x", isAdmin: false }
		expect((await start()).status).toBe(403)
	})

	it("refuses a post with no Origin (403)", async () => {
		const r = await start({})
		expect(r.status).toBe(403)
		expect(r.json.error).toBe(
			"This upload must come from Serene Pub's own page."
		)
	})

	it("refuses with the plugin subsystem off (403)", async () => {
		process.env.SP_PLUGINS_ENABLED = "0"
		try {
			const r = await start()
			expect(r.status).toBe(403)
			expect(r.json.error).toMatch(/SP_PLUGINS_ENABLED/)
		} finally {
			process.env.SP_PLUGINS_ENABLED = "1"
		}
	})

	it("refuses a declared size over SP_PLUGIN_PACKAGE_MAX_MB (413)", async () => {
		const r = await start({
			...ORIGIN,
			"x-package-size": String(1.5 * 1024 * 1024)
		})
		expect(r.status).toBe(413)
		expect(r.json.error).toMatch(/SP_PLUGIN_PACKAGE_MAX_MB/)
	})

	it("answers an id and a piece size", async () => {
		const r = await start()
		expect(r.status).toBe(200)
		expect(typeof r.json.upload).toBe("string")
		expect(r.json.pieceBytes).toBeGreaterThanOrEqual(64 * 1024)
		expect(r.json.pieceBytes).toBeLessThanOrEqual(8 * 1024 * 1024)
	})
})

describe("package upload: pieces", () => {
	it("discards the upload when the total passes the cap (413, then 404)", async () => {
		const s = await start()
		const chunk = new Uint8Array(400 * 1024)
		expect((await piece(s.json.upload, 0, chunk)).status).toBe(200)
		expect((await piece(s.json.upload, chunk.length, chunk)).status).toBe(
			200
		)
		const over = await piece(s.json.upload, 2 * chunk.length, chunk)
		expect(over.status).toBe(413)
		expect(over.json.error).toMatch(/SP_PLUGIN_PACKAGE_MAX_MB/)
		const after = await piece(s.json.upload, 2 * chunk.length, chunk)
		expect(after.status).toBe(404)
		expect(await partsLeft()).not.toContain(`${s.json.upload}.part`)
	})

	it("refuses a wrong offset (409) and discards the upload", async () => {
		const s = await start()
		const r = await piece(s.json.upload, 5, new Uint8Array([1, 2, 3]))
		expect(r.status).toBe(409)
		expect(r.json.error).toBe(
			"The upload fell out of step. Choose the file again."
		)
		expect(
			(await piece(s.json.upload, 0, new Uint8Array([1]))).status
		).toBe(404)
	})

	it("answers 404 to a different admin user", async () => {
		const s = await start()
		auth.user = { id: otherAdminId, username: "x2", isAdmin: true }
		const r = await piece(s.json.upload, 0, new Uint8Array([1]))
		expect(r.status).toBe(404)
		expect(r.json.error).toBe(
			"That upload has expired. Choose the file again."
		)
	})

	it("answers 404 to an unknown id", async () => {
		expect((await piece("nope", 0, new Uint8Array([1]))).status).toBe(404)
	})
})

describe("package upload: finish", () => {
	it("installs a valid package sent in several pieces (200)", async () => {
		const { id, done } = await uploadInPieces(await goodZip(), 2000)
		expect(done.json.error).toBeUndefined()
		expect(done.status).toBe(200)
		expect(done.json.pluginId).toBe(SLUG)
		expect(Array.isArray(done.json.plugins)).toBe(true)
		expect(await partsLeft()).not.toContain(`${id}.part`)
		expect((await finish(id)).status).toBe(404)
	})

	it("refuses a file that is not a zip (400) and removes the part", async () => {
		const { id, done } = await uploadInPieces(
			new TextEncoder().encode("this is not a zip file, only some words"),
			16
		)
		expect(done.status).toBe(400)
		expect(done.json.error).toMatch(/not a readable zip/)
		expect(await partsLeft()).not.toContain(`${id}.part`)
	})
})
