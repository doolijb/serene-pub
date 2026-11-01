/**
 * Serving a plugin's assets and served storage (M0 P2): immutable assets
 * with ETag = sha256 and ranges, `/plugin-data` only under granted globs and
 * never a listing, and the frame's autoplay policy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	framePermissionsPolicy,
	parseAssetSrc,
	parseByteRange,
	pluginAssetResponse,
	pluginDataResponse,
	servedPathAllowed
} from "./frameHost"
import { declaredPermissions, reviewMarks } from "./permissions"

const ID = "acme.serve"
const manifest = {
	schemaVersion: 1,
	slug: ID,
	version: "1.0.0",
	permissions: ["storage", "storage-serve:worlds/**", "media:autoplay", "storage-per-user"]
}
const marks = reviewMarks(declaredPermissions(manifest as any))

let db: TestDb
let dataDir: string
let prior: string | undefined
let priorFlag: string | undefined
const png = Buffer.from("0123456789abcdef")
const req = (headers: Record<string, string> = {}) => new Request("http://x/", { headers })

beforeAll(async () => {
	prior = process.env.SERENE_PUB_DATA_DIR
	priorFlag = process.env.SP_PLUGINS_ENABLED
	dataDir = await mkdtemp(join(tmpdir(), "sp-serve-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	process.env.SP_PLUGINS_ENABLED = "1"
	db = await createTestDb()
	await db.insert(schema.plugins).values({
		pluginId: ID,
		name: "Serve",
		version: "1.0.0",
		bundleSource: "",
		bundleHash: "h",
		manifest: manifest as any,
		enabled: true,
		adminDenied: marks
	} as any)
	const hash = createHash("sha256").update(png).digest("hex")
	await db.insert(schema.pluginFiles).values([
		{ pluginId: ID, path: "assets/a.png", mime: "image/png", content: png.toString("base64"), hash, bytes: png.length, kind: "asset" },
		{ pluginId: ID, path: "ui/index.html", mime: "text/html", content: Buffer.from("<p>").toString("base64"), hash: "u", bytes: 3, kind: "ui" }
	])
	const root = join(dataDir, "extensions_data", ID)
	await mkdir(join(root, "worlds/a"), { recursive: true })
	await mkdir(join(root, "secrets"), { recursive: true })
	await writeFile(join(root, "worlds/a/world.json"), '{"ok":true}')
	await writeFile(join(root, "secrets/x.json"), "{}")
}, 60_000)

afterAll(async () => {
	if (prior === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = prior
	if (priorFlag === undefined) delete process.env.SP_PLUGINS_ENABLED
	else process.env.SP_PLUGINS_ENABLED = priorFlag
	await rm(dataDir, { recursive: true, force: true })
}, 60_000)

describe("/plugin-assets", () => {
	it("serves an asset immutable with the sha256 ETag", async () => {
		const res = await pluginAssetResponse(db, `${ID}/1.0.0/assets/a.png`, req())
		expect(res.status).toBe(200)
		expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
		expect(res.headers.get("etag")).toBe(`"${createHash("sha256").update(png).digest("hex")}"`)
		expect(res.headers.get("x-content-type-options")).toBe("nosniff")
		expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true)
	}, 60_000)

	it("answers 304 on a matching If-None-Match", async () => {
		const etag = (await pluginAssetResponse(db, `${ID}/1.0.0/assets/a.png`, req())).headers.get("etag")!
		const res = await pluginAssetResponse(db, `${ID}/1.0.0/assets/a.png`, req({ "if-none-match": etag }))
		expect(res.status).toBe(304)
	}, 60_000)

	it("answers 206 for a Range", async () => {
		const res = await pluginAssetResponse(db, `${ID}/1.0.0/assets/a.png`, req({ range: "bytes=0-9" }))
		expect(res.status).toBe(206)
		expect(res.headers.get("content-range")).toBe("bytes 0-9/16")
		expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("0123456789")
	}, 60_000)

	it("an asset under another version is 404", async () => {
		const res = await pluginAssetResponse(db, `${ID}/0.9.0/assets/a.png`, req())
		expect(res.status).toBe(404)
	}, 60_000)

	it("a ui row is a 404 here", async () => {
		const res = await pluginAssetResponse(db, `${ID}/1.0.0/ui/index.html`, req())
		expect(res.status).toBe(404)
	}, 60_000)
})

describe("the two doors answer a frame's opaque origin (CORS)", () => {
	const asset = `${ID}/1.0.0/assets/a.png`
	const data = `${ID}/worlds/a/world.json`
	const door = [
		["asset", (r: Request) => pluginAssetResponse(db, asset, r)],
		["data", (r: Request) => pluginDataResponse(db, data, r)]
	] as const

	for (const [name, call] of door) {
		it(`${name}: ACAO null on Origin: null, with Vary, never credentials`, async () => {
			const res = await call(req({ origin: "null" }))
			expect(res.status).toBe(200)
			expect(res.headers.get("access-control-allow-origin")).toBe("null")
			expect(res.headers.get("vary")).toBe("Origin")
			expect(res.headers.get("access-control-allow-credentials")).toBeNull()
		}, 60_000)

		it(`${name}: no ACAO for another origin or none`, async () => {
			for (const origin of ["http://evil.example", "https://localhost:5174"]) {
				const res = await call(req({ origin }))
				expect(res.headers.get("access-control-allow-origin")).toBeNull()
			}
			expect((await call(req())).headers.get("access-control-allow-origin")).toBeNull()
		}, 60_000)

		it(`${name}: a 304 carries it too`, async () => {
			const etag = (await call(req())).headers.get("etag")!
			const res = await call(req({ origin: "null", "if-none-match": etag }))
			expect(res.status).toBe(304)
			expect(res.headers.get("access-control-allow-origin")).toBe("null")
		}, 60_000)
	}

	it("a 404 carries it too, on both doors, so a frame can read not-found (M2b)", async () => {
		const misses = [
			pluginAssetResponse(db, `${ID}/1.0.0/assets/missing.png`, req({ origin: "null" })),
			pluginAssetResponse(db, `${ID}/9.9.9/assets/a.png`, req({ origin: "null" })),
			pluginDataResponse(db, `${ID}/worlds/a/missing.json`, req({ origin: "null" })),
			pluginDataResponse(db, `${ID}/outside/globs.json`, req({ origin: "null" }))
		]
		for (const res of await Promise.all(misses)) {
			expect(res.status).toBe(404)
			expect(res.headers.get("access-control-allow-origin")).toBe("null")
			expect(res.headers.get("vary")).toBe("Origin")
		}
		const other = await pluginDataResponse(db, `${ID}/worlds/a/missing.json`, req({ origin: "http://evil.example" }))
		expect(other.status).toBe(404)
		expect(other.headers.get("access-control-allow-origin")).toBeNull()
	}, 60_000)

	it("a 206 carries it too", async () => {
		const res = await pluginAssetResponse(db, asset, req({ origin: "null", range: "bytes=0-9" }))
		expect(res.status).toBe(206)
		expect(res.headers.get("access-control-allow-origin")).toBe("null")
	}, 60_000)

	it("the routes export GET alone: POST/PUT/OPTIONS are 405, so no preflight can succeed", async () => {
		for (const route of [
			await import("../../../routes/plugin-assets/[...rest]/+server"),
			await import("../../../routes/plugin-data/[...rest]/+server")
		]) {
			const methods = Object.keys(route).filter((k) => /^[A-Z]+$/.test(k))
			expect(methods).toEqual(["GET"])
		}
	}, 60_000)
})

describe("/plugin-data", () => {
	it("serves a file under a granted glob", async () => {
		const res = await pluginDataResponse(db, `${ID}/worlds/a/world.json`, req())
		expect(res.status).toBe(200)
		expect(res.headers.get("cache-control")).toBe("private, no-cache")
		expect(await res.text()).toBe('{"ok":true}')
	}, 60_000)

	it("404s outside the globs, on a directory, and on traversal", async () => {
		expect((await pluginDataResponse(db, `${ID}/secrets/x.json`, req())).status).toBe(404)
		expect((await pluginDataResponse(db, `${ID}/worlds`, req())).status).toBe(404)
		expect((await pluginDataResponse(db, `${ID}/worlds/a`, req())).status).toBe(404)
		expect((await pluginDataResponse(db, `${ID}/worlds/../secrets/x.json`, req())).status).toBe(404)
	}, 60_000)
})

describe("/plugin-data/<id>/me/ (a person's own files, M2b)", () => {
	const mineDir = () => join(dataDir, "extensions_user_data", ID, "7", "worlds")
	beforeAll(async () => {
		await mkdir(mineDir(), { recursive: true })
		await writeFile(join(mineDir(), "mine.json"), '{"mine":true}')
		await mkdir(join(dataDir, "extensions_user_data", ID, "8", "worlds"), { recursive: true })
		await writeFile(join(dataDir, "extensions_user_data", ID, "8", "worlds", "theirs.json"), "{}")
		// A pub file that sits at a `me/` path must never be served by the pub door.
		await mkdir(join(dataDir, "extensions_data", ID, "me/worlds"), { recursive: true })
		await writeFile(join(dataDir, "extensions_data", ID, "me/worlds/pub.json"), "{}")
	})
	const me = (path: string, user: number | null, headers: Record<string, string> = {}) =>
		pluginDataResponse(db, `${ID}/me/${path}`, req(headers), user)

	it("serves the signed-in person's own file, private and uncached", async () => {
		const res = await me("worlds/mine.json", 7)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('{"mine":true}')
		expect(res.headers.get("cache-control")).toBe("private, no-store")
	})
	it("404s for another person's file, for nobody, and outside the globs", async () => {
		expect((await me("worlds/theirs.json", 7)).status).toBe(404)
		expect((await me("worlds/mine.json", 8)).status).toBe(404)
		expect((await me("worlds/mine.json", null)).status).toBe(404)
		expect((await me("elsewhere/x.json", 7)).status).toBe(404)
		expect((await me("worlds/../../8/worlds/theirs.json", 7)).status).toBe(404)
		expect((await me("worlds", 7)).status).toBe(404)
	})
	it("never carries a CORS header, even on Origin: null, on a hit or a miss", async () => {
		for (const res of [
			await me("worlds/mine.json", 7, { origin: "null" }),
			await me("worlds/theirs.json", 7, { origin: "null" }),
			await me("worlds/mine.json", null, { origin: "null" })
		]) {
			expect(res.headers.get("access-control-allow-origin")).toBeNull()
			expect(res.headers.get("access-control-allow-credentials")).toBeNull()
		}
	})
	it("the pub door never serves under me/, and 404s the pub file there", async () => {
		expect((await pluginDataResponse(db, `${ID}/me/worlds/pub.json`, req(), null)).status).toBe(404)
		expect((await pluginDataResponse(db, `${ID}/me/worlds/pub.json`, req(), 7)).status).toBe(404)
	})
})

describe("framePermissionsPolicy", () => {
	it("is null when media:autoplay is granted", () => {
		expect(framePermissionsPolicy(manifest, marks)).toBeNull()
	})
	it("is autoplay=() when media:autoplay is denied", () => {
		expect(framePermissionsPolicy(manifest, [...marks, "media:autoplay"])).toBe("autoplay=()")
	})
})

describe("servedPathAllowed", () => {
	it.each([
		[["worlds/**"], "worlds/a/world.json", true],
		[["worlds/**"], "secrets/x.json", false],
		[["worlds/*.json"], "worlds/a/world.json", false],
		[[], "worlds/a.json", false],
		[["**"], "../x", false]
	])("%j %s -> %s", (globs, path, want) => {
		expect(servedPathAllowed(globs as string[], path as string)).toBe(want)
	})
})

describe("parseByteRange", () => {
	it.each([
		[null, 10, null],
		["bytes=0-3", 10, { start: 0, end: 3 }],
		["bytes=4-", 10, { start: 4, end: 9 }],
		["bytes=-3", 10, { start: 7, end: 9 }],
		["bytes=2-99", 10, { start: 2, end: 9 }],
		["bytes=10-", 10, "unsatisfiable"],
		["bytes=0-1,3-4", 10, null],
		["items=0-1", 10, null],
		["bytes=5-2", 10, null]
	])("%s over %i", (header, size, want) => {
		expect(parseByteRange(header as string | null, size as number)).toEqual(want)
	})
})

describe("parseAssetSrc", () => {
	it.each([
		["acme.x/1.0.0/assets/a.png", { pluginId: "acme.x", version: "1.0.0", path: "assets/a.png" }],
		["acme.x/1.0.0-pr.1+b2/lang/pt.json", { pluginId: "acme.x", version: "1.0.0-pr.1+b2", path: "lang/pt.json" }],
		["Bad_Slug/1.0.0/a.png", undefined],
		["acme.x/1.0_0/a.png", undefined],
		["acme.x/1.0.0/../a.png", undefined],
		["acme.x/1.0.0", undefined],
		[undefined, undefined]
	])("%s", (rest, want) => {
		expect(parseAssetSrc(rest as string | undefined)).toEqual(want)
	})
})
