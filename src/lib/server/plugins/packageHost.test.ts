import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	PACKAGE_HOST_SOURCE,
	packageAssetsOfRow,
	safeAssetsDir,
	sandboxConfigKey
} from "./packageHost"

type Reply = { kind: "ok"; value: string } | { kind: "err"; reason: string }
type Host = { read: (p: unknown) => Reply }

function makeHost(config: unknown): Host {
	const shim: { exports: unknown } = { exports: null }
	new Function(
		"require",
		"module",
		PACKAGE_HOST_SOURCE + "\nmodule.exports = makePackageHost;"
	)(createRequire(import.meta.url), shim)
	return (shim.exports as (c: unknown) => Host)(config)
}

describe("packageHost — ctx.package.read's jail (M2a)", () => {
	let root: string
	let outside: string
	let host: Host
	const refused = (p: string) =>
		`package: '${p}' is not one of this package's assets`

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "pkg-host-"))
		outside = mkdtempSync(join(tmpdir(), "pkg-outside-"))
		mkdirSync(join(root, "assets", "worlds"), { recursive: true })
		mkdirSync(join(root, "lang"), { recursive: true })
		mkdirSync(join(root, "ui"), { recursive: true })
		writeFileSync(join(root, "assets", "worlds", "a.json"), Buffer.from([0, 1, 2, 250, 255]))
		writeFileSync(join(root, "lang", "x.json"), "{}")
		writeFileSync(join(root, "ui", "index.html"), "<p>")
		writeFileSync(join(outside, "secret.txt"), "secret")
		symlinkSync(join(outside, "secret.txt"), join(root, "assets", "link.txt"))
		symlinkSync(outside, join(root, "assets", "linkdir"))
		host = makeHost({ packageAssets: { root, dir: "assets" } })
	})
	afterAll(() => {
		rmSync(root, { recursive: true, force: true })
		rmSync(outside, { recursive: true, force: true })
	})

	it("reads a file inside the assets folder, bytes equal", () => {
		const r = host.read("assets/worlds/a.json")
		expect(r.kind).toBe("ok")
		if (r.kind === "ok")
			expect([...Buffer.from(r.value, "base64")]).toEqual([0, 1, 2, 250, 255])
	})

	it("refuses ../, an absolute path, and lang/ and ui/, which sit outside the folder", () => {
		for (const p of [
			"assets/../lang/x.json",
			"../secret.txt",
			join(root, "assets", "worlds", "a.json"),
			"/etc/passwd",
			"lang/x.json",
			"ui/index.html",
			"assets/..\\lang/x.json"
		])
			expect(host.read(p), p).toEqual({ kind: "err", reason: refused(p) })
	})

	it("refuses a symlink that leaves the folder, to a file or to a directory", () => {
		for (const p of ["assets/link.txt", "assets/linkdir/secret.txt"])
			expect(host.read(p), p).toEqual({ kind: "err", reason: refused(p) })
	})

	it("answers err for a missing file, a directory, an empty path and a non-string", () => {
		for (const p of ["assets/nope.json", "assets/worlds", "", undefined, 7])
			expect(host.read(p).kind, String(p)).toBe("err")
	})

	it("says a plugin with no assets block ships none", () => {
		const bare = makeHost({})
		expect(bare.read("assets/a.json")).toEqual({
			kind: "err",
			reason:
				"package: this plugin ships no assets — declare assets: { dir } in its manifest"
		})
	})

	it("is read-only: the handle has a read and nothing else", () => {
		expect(Object.keys(host)).toEqual(["read"])
	})
})

describe("packageHost — what the manifest declares", () => {
	it("takes a safe dir (default assets) and refuses ui, dist, lang, .., absolute", () => {
		expect(safeAssetsDir({ assets: { dir: "media" } })).toBe("media")
		expect(safeAssetsDir({ assets: {} })).toBe("assets")
		expect(safeAssetsDir({})).toBeUndefined()
		for (const dir of ["ui", "dist/x", "lang", "../up", "/abs", "a/../b", ""])
			expect(safeAssetsDir({ assets: { dir } }), dir).toBeUndefined()
	})

	it("derives the descriptor field from a row, and the version changes the reload key", () => {
		expect(packageAssetsOfRow({ assets: { dir: "assets" } }, "1.0.0")).toEqual({
			version: "1.0.0",
			dir: "assets"
		})
		expect(packageAssetsOfRow({}, "1.0.0")).toBeUndefined()
		const a = { packageAssets: { root: "/d/plugins/p/1.0.0", dir: "assets" } }
		const b = { packageAssets: { root: "/d/plugins/p/1.1.0", dir: "assets" } }
		expect(sandboxConfigKey(a)).not.toBe(sandboxConfigKey(b))
	})
})
