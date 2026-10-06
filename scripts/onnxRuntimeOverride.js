// scripts/onnxRuntimeOverride.js
//
// Puts an older onnxruntime-node, with its matching onnxruntime-common, into
// ONE target's bundle in place of the version @huggingface/transformers pins.
// "Override" in npm's sense (package.json `overrides`: force a dependency's
// version), not a config override. It is not done with npm `overrides`
// because those apply to every platform, and only one target needs the old
// runtime; the app has no lockfile to pin it in either.
//
// Why macos-x64: onnxruntime-node ships darwin/x64 binaries up to 1.23.2 and
// none from 1.24 on. Microsoft stopped building them, and conda-forge and
// Homebrew have no newer Intel build. transformers 4.2 pins 1.24.3 and 4.3
// pins 1.30.0, so a stock Intel bundle has no runtime, and the app's
// runtime probe turns local embeddings and named entities off. Owner ruling
// 2026-10-05: the Intel bundle carries 1.23.2.
//
// Verified 2026-10-05 on linux/x64, with 1.23.2's linux binary standing in
// for darwin/x64: transformers 4.2.0 and 4.3.0 on 1.23.2 give bit-identical
// embeddings (all-MiniLM-L6-v2 fp32 and q8, embeddinggemma-300m q8 with
// external data, bge-m3 q8) and identical bert-base-NER entities and scores
// to the stock 1.24.3. The JavaScript of both packages is the same from
// 1.23.2 to 1.24.3 apart from the version string and WebGPU type
// declarations.
//
// The cost is a frozen runtime on one platform: a later transformers release
// could rely on newer ORT behaviour. scripts/onnx-smoke.mjs, run against the
// built Intel bundle in CI, is what catches that.
//
// Runs on the payload's COPY of node_modules (bundle-dist.js, before
// pruneDist), never on the developer's tree. Everything is fetched and
// verified before anything in the payload changes.

import { execFileSync } from "child_process"
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"

/**
 * Per target: the onnxruntime version its bundle carries, and the npm
 * `dist.integrity` of each tarball, pinned here so a re-published or
 * tampered tarball fails the build instead of shipping. To move a pin, take
 * both strings from `npm view <name>@<version> dist.integrity`.
 */
export const ONNX_RUNTIME_OVERRIDES = {
	"macos-x64": {
		version: "1.23.2",
		integrity: {
			"onnxruntime-node":
				"sha512-OBTsG0W8ddBVOeVVVychpVBS87A9YV5sa2hJ6lc025T97Le+J4v++PwSC4XFs1C62SWyNdof0Mh4KvnZgtt4aw==",
			"onnxruntime-common":
				"sha512-5LFsC9Dukzp2WV6kNHYLNzp8sT6V02IubLCbzw2Xd6X5GOlr65gAX6xiJwyi2URJol/s71gaQLC5F2C25AAR2w=="
		}
	}
}

/**
 * Who loads the two packages, so who must resolve the replacements: the
 * transformers build imports both, onnxruntime-node requires the common one.
 * A copy nested under either would shadow the top-level replacement.
 */
const CONSUMERS = {
	"@huggingface/transformers": ["onnxruntime-node", "onnxruntime-common"],
	"onnxruntime-node": ["onnxruntime-common"]
}

/** npm's integrity format: `sha512-<base64>` of the tarball's bytes. */
export function integrityOf(file) {
	return (
		"sha512-" +
		crypto
			.createHash("sha512")
			.update(fs.readFileSync(file))
			.digest("base64")
	)
}

/**
 * Fetch `<name>@<version>` from the registry into `destDir` and return the
 * tarball's path. `npm pack` of a registry spec downloads the published
 * tarball as-is (npm's own cache answers a repeat), and runs nothing.
 */
export function npmPackTarball(name, version, destDir) {
	const out = execFileSync(
		"npm",
		[
			"pack",
			`${name}@${version}`,
			"--pack-destination",
			destDir,
			"--ignore-scripts",
			"--json"
		],
		{
			cwd: destDir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "inherit"],
			shell: process.platform === "win32"
		}
	)
	const [{ filename }] = JSON.parse(out)
	return path.join(destDir, filename)
}

/** Extract an npm tarball into `destDir`; returns its `package/` directory. */
function extractTarball(tgz, destDir) {
	fs.mkdirSync(destDir, { recursive: true })
	execFileSync("tar", ["-xzf", tgz, "-C", destDir], { stdio: "inherit" })
	return path.join(destDir, "package")
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"))

/**
 * Where Node would find `name` when the package at `nm/<fromPkg>` imports
 * it: `<dir>/node_modules/<name>` for that directory and each parent, up to
 * the payload, skipping directories that are themselves `node_modules` —
 * Node's own lookup order. Null when nothing in the payload provides it.
 */
function resolveInPayload(nm, fromPkg, name) {
	const payloadDir = path.dirname(nm)
	for (let dir = path.join(nm, fromPkg); ; dir = path.dirname(dir)) {
		if (path.basename(dir) !== "node_modules") {
			const candidate = path.join(dir, "node_modules", name)
			if (fs.existsSync(path.join(candidate, "package.json")))
				return candidate
		}
		if (dir === payloadDir || path.dirname(dir) === dir) return null
	}
}

/**
 * Replace onnxruntime-node and onnxruntime-common in `payloadDir`'s
 * node_modules with the versions ONNX_RUNTIME_OVERRIDES pins for
 * `target`. A target with no entry is left alone (returns null).
 *
 * Throws, before touching the payload, when a tarball's integrity does not
 * match its pin, when a tarball is not the package and version it claims,
 * or when the onnxruntime-node tarball has no binary for the target. Throws
 * after the swap when a consumer still resolves a different copy.
 *
 * @param {string} payloadDir the payload bundle-dist.js just assembled
 * @param {{name: string, platform: string, arch: string}} target - the
 *   target object bundle-dist.js resolved, as pruneDist takes it
 * @param {object} [options]
 * @param {(name: string, version: string, destDir: string) => string} [options.fetchTarball]
 *   returns a tarball's path; npm pack by default, a stub in tests
 * @param {Record<string, {version: string, integrity: Record<string, string>}>} [options.overrides]
 * @param {(msg: string) => void} [options.log]
 * @returns {{version: string, packages: string[]} | null}
 */
export function applyOnnxRuntimeOverride(payloadDir, target, options = {}) {
	const {
		fetchTarball = npmPackTarball,
		overrides = ONNX_RUNTIME_OVERRIDES,
		log = console.log
	} = options
	const override = overrides[target.name]
	if (!override) return null
	const { version, integrity } = override
	const nm = path.join(payloadDir, "node_modules")
	if (!fs.existsSync(path.join(nm, "onnxruntime-node", "package.json"))) {
		throw new Error(
			`${target.name}: the payload has no node_modules/onnxruntime-node to replace with ${version}`
		)
	}

	log(`Replacing onnxruntime with ${version} for ${target.name}...`)
	const work = fs.mkdtempSync(
		path.join(os.tmpdir(), "serene-pub-ort-override-")
	)
	try {
		// 1. Fetch, verify and extract every package before changing anything.
		const extracted = {}
		for (const [name, pinned] of Object.entries(integrity)) {
			const tgz = fetchTarball(name, version, work)
			const actual = integrityOf(tgz)
			if (actual !== pinned) {
				throw new Error(
					`integrity mismatch for ${name}@${version}\n  pinned ${pinned}\n  actual ${actual}\n` +
						`Refusing to bundle it. If the pin is deliberately moving, update ONNX_RUNTIME_OVERRIDES.`
				)
			}
			const pkgDir = extractTarball(
				tgz,
				path.join(work, name.replace(/\//g, "+"))
			)
			const pkg = readJson(path.join(pkgDir, "package.json"))
			if (pkg.name !== name || pkg.version !== version) {
				throw new Error(
					`${tgz} holds ${pkg.name}@${pkg.version}, expected ${name}@${version}`
				)
			}
			extracted[name] = pkgDir
		}
		// The reason for the whole exercise: the binary prune-dist.js keeps.
		const { platform, arch } = target
		const binDir = path.join(extracted["onnxruntime-node"] ?? "", "bin")
		const hasBinary =
			!!extracted["onnxruntime-node"] &&
			fs.existsSync(binDir) &&
			fs
				.readdirSync(binDir)
				.filter((d) => d.startsWith("napi-v"))
				.some((d) =>
					fs.existsSync(
						path.join(
							binDir,
							d,
							platform,
							arch,
							"onnxruntime_binding.node"
						)
					)
				)
		if (!hasBinary) {
			throw new Error(
				`onnxruntime-node@${version} has no ${platform}/${arch} binary under bin/napi-v*/`
			)
		}

		// 2. Swap. A whole-directory replace, so the old package's own nested
		// node_modules goes with it; copies nested under a consumer go too,
		// leaving the top-level replacement as the only one it can resolve.
		for (const [name, pkgDir] of Object.entries(extracted)) {
			const dest = path.join(nm, name)
			fs.rmSync(dest, { recursive: true, force: true })
			fs.cpSync(pkgDir, dest, { recursive: true })
			for (const consumer of Object.keys(CONSUMERS)) {
				fs.rmSync(path.join(nm, consumer, "node_modules", name), {
					recursive: true,
					force: true
				})
			}
		}

		// 3. Every consumer present must now resolve the pinned version: two
		// onnxruntime-common copies mean two Tensor classes, and a nested
		// onnxruntime-node would load its own (absent) binary.
		for (const [consumer, deps] of Object.entries(CONSUMERS)) {
			if (!fs.existsSync(path.join(nm, consumer, "package.json")))
				continue
			for (const dep of deps) {
				const resolved = resolveInPayload(nm, consumer, dep)
				const got = resolved
					? readJson(path.join(resolved, "package.json")).version
					: null
				if (got !== version) {
					throw new Error(
						`${consumer} resolves ${dep}@${got ?? "(none)"}${resolved ? ` at ${resolved}` : ""}, expected ${version}`
					)
				}
			}
		}
	} finally {
		fs.rmSync(work, { recursive: true, force: true })
	}
	log(`  onnxruntime-node and onnxruntime-common are now ${version}`)
	return { version, packages: Object.keys(integrity) }
}
