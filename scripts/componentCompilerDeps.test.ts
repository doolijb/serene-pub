/**
 * The component compiler ships (C6 P3): the production dependency set — what
 * `npm prune --production` / `npm install --omit=dev` keeps — holds the
 * compiler, esbuild on the SDK CLI's major, and Svelte (its compiler). And
 * the release prunes keep exactly that on desktop/Docker, one platform's
 * esbuild binary, and strip the compiler from Android, where there is none.
 */
import { afterEach, describe, expect, test } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pruneAndroidAssets, pruneDist } from "./prune-dist.js"

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
	dependencies: Record<string, string>
	devDependencies: Record<string, string>
}

describe("the production dependency set", () => {
	test.each(["svelte", "esbuild", "@serene-pub/cli"])("%s is a runtime dependency, not a dev one", (name) => {
		expect(pkg.dependencies[name]).toBeTruthy()
		expect(pkg.devDependencies[name]).toBeUndefined()
	})

	test("@serene-pub/cli is linked like the other SDK packages", () => {
		expect(pkg.dependencies["@serene-pub/cli"]).toBe("file:../serene-pub-sdk/cli")
	})

	test("esbuild is on the major the SDK CLI builds with", () => {
		const sdkEsbuild = JSON.parse(readFileSync("../serene-pub-sdk/node_modules/esbuild/package.json", "utf8")).version as string
		const minor = sdkEsbuild.split(".").slice(0, 2).join(".")
		// 0.x: the minor is esbuild's breaking-change line.
		expect(pkg.dependencies.esbuild).toBe(`^${minor}.0`)
		const installed = JSON.parse(readFileSync("node_modules/esbuild/package.json", "utf8")).version as string
		expect(installed.split(".").slice(0, 2).join(".")).toBe(minor)
	})
})

const dirs: string[] = []
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A scratch payload with the given files (path → bytes). */
function payload(files: Record<string, number>): string {
	const root = mkdtempSync(join(tmpdir(), "sp-prune-"))
	dirs.push(root)
	for (const [p, size] of Object.entries(files)) {
		mkdirSync(dirname(join(root, p)), { recursive: true })
		writeFileSync(join(root, p), Buffer.alloc(size))
	}
	return root
}

const COMPILER_TREE = {
	"node_modules/esbuild/package.json": 10,
	"node_modules/esbuild/lib/main.js": 10,
	"node_modules/esbuild/bin/esbuild": 2 * 1024 * 1024,
	"node_modules/@esbuild/linux-x64/bin/esbuild": 100,
	"node_modules/@esbuild/darwin-arm64/bin/esbuild": 100,
	"node_modules/@esbuild/win32-x64/esbuild.exe": 100,
	"node_modules/somepkg/node_modules/@esbuild/darwin-arm64/bin/esbuild": 100,
	"node_modules/svelte/package.json": 10,
	"node_modules/svelte/compiler/index.js": 10,
	"node_modules/svelte/src/compiler/index.js": 10,
	"node_modules/svelte/src/internal/server/index.js": 10,
	"node_modules/@serene-pub/cli/dist/componentCompile.js": 10,
	"node_modules/@serene-pub/cli/dist/componentSource.js": 10,
	"build/index.js": 10
}

describe("the release prunes", () => {
	test("desktop/Docker keep the compiler and exactly the target's own esbuild binary", () => {
		const root = payload(COMPILER_TREE)
		pruneDist(root, { name: "linux-x64", platform: "linux", arch: "x64" })
		const at = (p: string) => existsSync(join(root, p))
		expect(at("node_modules/@esbuild/linux-x64/bin/esbuild")).toBe(true)
		expect(at("node_modules/@esbuild/darwin-arm64")).toBe(false)
		expect(at("node_modules/@esbuild/win32-x64")).toBe(false)
		expect(at("node_modules/somepkg/node_modules/@esbuild/darwin-arm64")).toBe(false)
		// The install script's copy of the binary is dropped; the JS API needs only @esbuild/<platform>.
		expect(at("node_modules/esbuild/bin/esbuild")).toBe(false)
		expect(at("node_modules/esbuild/lib/main.js")).toBe(true)
		expect(at("node_modules/svelte/src/compiler/index.js")).toBe(true)
		expect(at("node_modules/@serene-pub/cli/dist/componentCompile.js")).toBe(true)
	})

	test("the tiny esbuild launcher (no binary copy) is kept", () => {
		const root = payload({ ...COMPILER_TREE, "node_modules/esbuild/bin/esbuild": 9_000 })
		pruneDist(root, { name: "windows-x64", platform: "win32", arch: "x64" })
		expect(existsSync(join(root, "node_modules/esbuild/bin/esbuild"))).toBe(true)
		expect(existsSync(join(root, "node_modules/@esbuild/win32-x64/esbuild.exe"))).toBe(true)
		expect(existsSync(join(root, "node_modules/@esbuild/linux-x64"))).toBe(false)
	})

	test("Android has no compiler: esbuild, every binary, Svelte's compiler and the compile module go; Svelte's runtime and component-source stay", () => {
		const root = payload(COMPILER_TREE)
		pruneAndroidAssets(root)
		const at = (p: string) => existsSync(join(root, p))
		expect(at("node_modules/esbuild")).toBe(false)
		expect(at("node_modules/@esbuild")).toBe(false)
		expect(at("node_modules/somepkg/node_modules/@esbuild")).toBe(false)
		expect(at("node_modules/svelte/compiler")).toBe(false)
		expect(at("node_modules/svelte/src/compiler")).toBe(false)
		expect(at("node_modules/@serene-pub/cli/dist/componentCompile.js")).toBe(false)
		expect(at("node_modules/svelte/src/internal/server/index.js")).toBe(true)
		expect(at("node_modules/@serene-pub/cli/dist/componentSource.js")).toBe(true)
		expect(at("build/index.js")).toBe(true)
	})
})
