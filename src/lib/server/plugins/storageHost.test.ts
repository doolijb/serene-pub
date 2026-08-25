import { describe, it, expect, beforeAll, afterAll } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"
import { STORAGE_HOST_SOURCE } from "./storageHost"

/** Evaluate the embedded source exactly as a worker would, and hand back the factory. */
function loadMakeStorageHost() {
	const req = createRequire(import.meta.url)
	const shim: { exports: any } = { exports: null }
	new Function(
		"require",
		"module",
		STORAGE_HOST_SOURCE + "\nmodule.exports = makeStorageHost;"
	)(req, shim)
	return shim.exports as (config: {
		storageDir: string
		quotaBytes: number
	}) => any
}

let dir: string
let store: any
beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-storage-host-"))
	store = loadMakeStorageHost()({ storageDir: dir, quotaBytes: 1000 })
})
afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true })
})

describe("storage host", () => {
	it("write → read round-trips, missing → null", () => {
		expect(store.read("a.json")).toBeNull()
		store.write("a.json", '{"x":1}')
		expect(store.read("a.json")).toBe('{"x":1}')
	})

	it("write is atomic and creates nested dirs", () => {
		store.write("nested/deep/b.txt", "hi")
		expect(store.read("nested/deep/b.txt")).toBe("hi")
		// no stray temp files left behind
		expect(store.list("nested/deep").every((n: string) => !n.includes(".tmp-"))).toBe(true)
	})

	it("list, exists, remove, size", () => {
		expect(store.exists("a.json")).toBe(true)
		expect(store.list().sort()).toContain("a.json")
		expect(store.size()).toBeGreaterThan(0)
		store.remove("a.json")
		expect(store.exists("a.json")).toBe(false)
	})

	it("jails traversal, absolute paths, and empty paths", () => {
		expect(() => store.read("../escape.txt")).toThrow(/escape/)
		expect(() => store.write("../../etc/passwd", "x")).toThrow(/escape/)
		expect(() => store.read(path.resolve(dir, "..", "x"))).toThrow(/escape/)
		expect(() => store.read("")).toThrow(/path is required/)
	})

	it("enforces the quota", () => {
		const big = "x".repeat(2000) // > 1000-byte quota
		expect(() => store.write("big.txt", big)).toThrow(/quota/)
		// a within-quota write still works
		store.write("ok.txt", "x".repeat(100))
		expect(store.read("ok.txt")).toHaveLength(100)
	})
})
