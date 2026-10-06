/**
 * The Intel macOS onnxruntime swap (scripts/onnxRuntimeOverride.js) on a
 * scratch payload, with locally built tarballs standing in for the registry:
 * what it replaces, which nested copies it removes, what makes it refuse
 * before touching anything, and that prune-dist keeps the binary it brought.
 */
import { execFileSync } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
	applyOnnxRuntimeOverride,
	integrityOf,
	ONNX_RUNTIME_OVERRIDES
} from "./onnxRuntimeOverride.js"
import { pruneDist } from "./prune-dist.js"

const dirs: string[] = []
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function scratch(): string {
	const d = mkdtempSync(join(tmpdir(), "sp-ort-override-"))
	dirs.push(d)
	return d
}
function writeTree(root: string, files: Record<string, string | object>) {
	for (const [p, body] of Object.entries(files)) {
		mkdirSync(dirname(join(root, p)), { recursive: true })
		writeFileSync(
			join(root, p),
			typeof body === "string" ? body : JSON.stringify(body)
		)
	}
}
const pj = (name: string, version: string, extra: object = {}) => ({
	name,
	version,
	license: "MIT",
	...extra
})
const version = (root: string, p: string) =>
	JSON.parse(readFileSync(join(root, p, "package.json"), "utf8")).version

const macosX64 = { name: "macos-x64", platform: "darwin", arch: "x64" }
const linuxX64 = { name: "linux-x64", platform: "linux", arch: "x64" }

/** An npm-shaped tarball (`package/…`) built from `files`. */
function tarball(
	dir: string,
	file: string,
	files: Record<string, string | object>
) {
	const src = join(dir, `${file}.src`)
	writeTree(join(src, "package"), files)
	const tgz = join(dir, file)
	execFileSync("tar", ["-czf", tgz, "-C", src, "package"])
	return tgz
}

/**
 * Stub registry: tarballs for onnxruntime-node and -common at `ver`, the node
 * one with a binary per `binaries` entry, and an override table pinning their
 * real integrity (or `integrityFor`'s, to force a mismatch).
 */
function registry(
	ver = "1.23.2",
	binaries = ["darwin/x64", "darwin/arm64", "linux/x64"],
	integrityFor: (name: string, actual: string) => string = (_, a) => a
) {
	const dir = scratch()
	const tgz: Record<string, string> = {
		"onnxruntime-node": tarball(dir, "node.tgz", {
			"package.json": pj("onnxruntime-node", ver, {
				dependencies: { "onnxruntime-common": ver }
			}),
			"dist/index.js": "module.exports = require('onnxruntime-common')",
			...Object.fromEntries(
				binaries.flatMap((b) => [
					[`bin/napi-v6/${b}/onnxruntime_binding.node`, "bin"],
					[`bin/napi-v6/${b}/libonnxruntime.${ver}.dylib`, "lib"]
				])
			)
		}),
		"onnxruntime-common": tarball(dir, "common.tgz", {
			"package.json": pj("onnxruntime-common", ver),
			"dist/cjs/index.js": "x"
		})
	}
	const fetched: string[] = []
	return {
		fetched,
		fetchTarball: (name: string, v: string) => {
			fetched.push(`${name}@${v}`)
			return tgz[name]
		},
		overrides: {
			"macos-x64": {
				version: ver,
				integrity: Object.fromEntries(
					Object.entries(tgz).map(([n, f]) => [
						n,
						integrityFor(n, integrityOf(f))
					])
				)
			}
		}
	}
}

/** A payload as npm lays out transformers 4.3: 1.30.0 runtime, nested copies. */
function payload(extra: Record<string, string | object> = {}) {
	const root = scratch()
	writeTree(root, {
		"node_modules/onnxruntime-node/package.json": pj(
			"onnxruntime-node",
			"1.30.0"
		),
		"node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node":
			"new",
		"node_modules/onnxruntime-node/node_modules/onnxruntime-common/package.json":
			pj("onnxruntime-common", "1.30.0"),
		"node_modules/onnxruntime-common/package.json": pj(
			"onnxruntime-common",
			"1.31.0-dev"
		),
		"node_modules/@huggingface/transformers/package.json": pj(
			"@huggingface/transformers",
			"4.3.0",
			{ dependencies: { "onnxruntime-node": "1.30.0" } }
		),
		"node_modules/@huggingface/transformers/node_modules/onnxruntime-common/package.json":
			pj("onnxruntime-common", "1.30.0"),
		...extra
	})
	return root
}

describe("applyOnnxRuntimeOverride", () => {
	test("pins macos-x64 to 1.23.2 with npm integrity strings, and nothing else", () => {
		expect(Object.keys(ONNX_RUNTIME_OVERRIDES)).toEqual(["macos-x64"])
		const { version, integrity } = ONNX_RUNTIME_OVERRIDES["macos-x64"]
		expect(version).toBe("1.23.2")
		expect(Object.keys(integrity).sort()).toEqual([
			"onnxruntime-common",
			"onnxruntime-node"
		])
		for (const value of Object.values(integrity))
			expect(value).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/)
	})

	test("a target with no entry is left alone and fetches nothing", () => {
		const reg = registry()
		const root = payload()
		const result = applyOnnxRuntimeOverride(root, linuxX64, {
			...reg,
			log: () => {}
		})
		expect(result).toBeNull()
		expect(reg.fetched).toEqual([])
		expect(version(root, "node_modules/onnxruntime-node")).toBe("1.30.0")
	})

	test("replaces both packages and removes the copies nested under consumers", () => {
		const reg = registry()
		const root = payload()
		const result = applyOnnxRuntimeOverride(root, macosX64, {
			...reg,
			log: () => {}
		})
		expect(result).toEqual({
			version: "1.23.2",
			packages: ["onnxruntime-node", "onnxruntime-common"]
		})
		expect(reg.fetched).toEqual([
			"onnxruntime-node@1.23.2",
			"onnxruntime-common@1.23.2"
		])
		const nm = join(root, "node_modules")
		expect(version(nm, "onnxruntime-node")).toBe("1.23.2")
		expect(version(nm, "onnxruntime-common")).toBe("1.23.2")
		expect(
			existsSync(
				join(
					nm,
					"onnxruntime-node/bin/napi-v6/darwin/x64/onnxruntime_binding.node"
				)
			)
		).toBe(true)
		// The old package's own nested copy went with it; the consumer's too.
		expect(existsSync(join(nm, "onnxruntime-node/node_modules"))).toBe(
			false
		)
		expect(
			existsSync(
				join(
					nm,
					"@huggingface/transformers/node_modules/onnxruntime-common"
				)
			)
		).toBe(false)
	})

	test("refuses on an integrity mismatch, before touching the payload", () => {
		const reg = registry("1.23.2", undefined, (name, actual) =>
			name === "onnxruntime-common"
				? "sha512-" + "A".repeat(86) + "=="
				: actual
		)
		const root = payload()
		expect(() =>
			applyOnnxRuntimeOverride(root, macosX64, { ...reg, log: () => {} })
		).toThrow(/integrity mismatch for onnxruntime-common@1\.23\.2/)
		expect(version(root, "node_modules/onnxruntime-node")).toBe("1.30.0")
		expect(version(root, "node_modules/onnxruntime-common")).toBe(
			"1.31.0-dev"
		)
	})

	test("refuses a runtime with no binary for the target, before touching the payload", () => {
		const reg = registry("1.23.2", ["darwin/arm64", "linux/x64"])
		const root = payload()
		expect(() =>
			applyOnnxRuntimeOverride(root, macosX64, { ...reg, log: () => {} })
		).toThrow(/no darwin\/x64 binary/)
		expect(version(root, "node_modules/onnxruntime-node")).toBe("1.30.0")
	})

	test("refuses a tarball that is not the version it was asked for", () => {
		const reg = registry("1.22.0")
		reg.overrides["macos-x64"].version = "1.23.2"
		const root = payload()
		expect(() =>
			applyOnnxRuntimeOverride(root, macosX64, { ...reg, log: () => {} })
		).toThrow(
			/holds onnxruntime-node@1\.22\.0, expected onnxruntime-node@1\.23\.2/
		)
		expect(version(root, "node_modules/onnxruntime-node")).toBe("1.30.0")
	})

	test("fails loudly when a copy it does not know about still shadows the replacement", () => {
		const reg = registry()
		// Nested one level deeper than the consumer's own node_modules: under
		// the @huggingface scope, where Node looks before the top level.
		const root = payload({
			"node_modules/@huggingface/node_modules/onnxruntime-common/package.json":
				pj("onnxruntime-common", "1.30.0")
		})
		expect(() =>
			applyOnnxRuntimeOverride(root, macosX64, { ...reg, log: () => {} })
		).toThrow(
			/@huggingface\/transformers resolves onnxruntime-common@1\.30\.0/
		)
	})

	test("a payload without onnxruntime-node is an error, not a silent skip", () => {
		const reg = registry()
		const root = scratch()
		writeTree(root, { "node_modules/x/package.json": pj("x", "1.0.0") })
		expect(() =>
			applyOnnxRuntimeOverride(root, macosX64, { ...reg, log: () => {} })
		).toThrow(/no node_modules\/onnxruntime-node/)
	})

	test("prune-dist keeps the darwin/x64 binary it brought and drops the rest", () => {
		const reg = registry()
		const root = payload()
		applyOnnxRuntimeOverride(root, macosX64, { ...reg, log: () => {} })
		pruneDist(root, macosX64)
		const bin = join(root, "node_modules/onnxruntime-node/bin/napi-v6")
		expect(
			existsSync(join(bin, "darwin/x64/onnxruntime_binding.node"))
		).toBe(true)
		expect(
			existsSync(join(bin, "darwin/x64/libonnxruntime.1.23.2.dylib"))
		).toBe(true)
		expect(existsSync(join(bin, "darwin/arm64"))).toBe(false)
		expect(existsSync(join(bin, "linux"))).toBe(false)
	})
})
