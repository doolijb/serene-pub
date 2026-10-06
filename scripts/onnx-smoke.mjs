#!/usr/bin/env node
// scripts/onnx-smoke.mjs — does a built bundle's local ONNX runtime actually run?
//
//   node scripts/onnx-smoke.mjs <payload-dir> [--target <name>] [--model <repo>] [--dtype <dtype>]
//
// <payload-dir> is the bundle's app payload, the directory holding
// node_modules/ (scripts/dist-layout.js appDir). It imports THAT payload's
// @huggingface/transformers through the same "node"/"import" entry the
// server loads, downloads one small embedding model from huggingface.co into
// a temp directory, embeds one sentence, prints the dimensions, and exits
// non-zero when anything fails. --target <name> also requires the runtime to
// be the version scripts/onnxRuntimeOverride.js pins for that target, so a
// bundle that silently kept the stock runtime fails here too.
//
// Intended CI step (release.yml, macos-x64 job, after "Bundle for …"), run
// with the bundle's own Node so the runtime is exercised as it ships:
//
//   VERSION=$(node -p "require('./package.json').version")
//   PAYLOAD="dist/serene-pub-$VERSION-macos-x64/serene-pub/Serene Pub.app/Contents/Resources/app"
//   "$PAYLOAD/node" scripts/onnx-smoke.mjs "$PAYLOAD" --target macos-x64
//
// On Windows/Linux the payload is dist/serene-pub-<version>-<target>/serene-pub/app.
// Exit codes: 0 ran, 1 failed, 2 usage. Needs network; writes nothing into
// the payload.

import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { ONNX_RUNTIME_OVERRIDES } from "./onnxRuntimeOverride.js"

const USAGE =
	"Usage: node scripts/onnx-smoke.mjs <payload-dir> [--target <name>] [--model <repo>] [--dtype <dtype>]"

function parseArgs(argv) {
	const opts = { model: "Xenova/all-MiniLM-L6-v2", dtype: "q8" }
	const positional = []
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === "--target" || arg === "--model" || arg === "--dtype") {
			const value = argv[++i]
			if (!value) return null
			opts[arg.slice(2)] = value
		} else if (arg.startsWith("--")) return null
		else positional.push(arg)
	}
	if (positional.length !== 1) return null
	return { ...opts, payload: path.resolve(positional[0]) }
}

async function main() {
	const opts = parseArgs(process.argv.slice(2))
	if (!opts) {
		console.error(USAGE)
		return 2
	}
	const nm = path.join(opts.payload, "node_modules")
	const tfDir = path.join(nm, "@huggingface/transformers")
	const tfPkgPath = path.join(tfDir, "package.json")
	if (!fs.existsSync(tfPkgPath)) {
		console.error(`onnx-smoke: no @huggingface/transformers in ${nm}`)
		return 1
	}
	const tfPkg = JSON.parse(fs.readFileSync(tfPkgPath, "utf8"))
	// The export the server build resolves: condition "node", then "import".
	const nodeImport = tfPkg.exports?.node?.import
	const entry =
		typeof nodeImport === "string" ? nodeImport : nodeImport?.default
	if (typeof entry !== "string") {
		console.error(
			`onnx-smoke: ${tfPkgPath} has no exports.node.import entry`
		)
		return 1
	}
	// The runtime must come from the payload, not from wherever this script
	// happens to be run (a checkout's own node_modules would mask a broken
	// bundle).
	const ortEntry = createRequire(tfPkgPath).resolve("onnxruntime-node")
	if (!ortEntry.startsWith(nm + path.sep)) {
		console.error(
			`onnx-smoke: transformers resolves onnxruntime-node outside the payload: ${ortEntry}`
		)
		return 1
	}
	const expectedOrt = opts.target
		? ONNX_RUNTIME_OVERRIDES[opts.target]?.version
		: undefined

	const cacheDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "serene-pub-onnx-smoke-")
	)
	try {
		const { env, pipeline } = await import(
			pathToFileURL(path.join(tfDir, entry)).href
		)
		const versions = env.backends?.onnx?.versions ?? {}
		console.log(
			`transformers ${env.version}, onnxruntime-node ${versions.node}, ` +
				`onnxruntime-common ${versions.common}, ${process.platform}/${process.arch}, Node ${process.version}`
		)
		if (
			expectedOrt &&
			(versions.node !== expectedOrt || versions.common !== expectedOrt)
		) {
			console.error(
				`onnx-smoke: ${opts.target} should carry onnxruntime ${expectedOrt} (scripts/onnxRuntimeOverride.js)`
			)
			return 1
		}

		env.cacheDir = cacheDir
		env.allowLocalModels = false
		const extractor = await pipeline("feature-extraction", opts.model, {
			dtype: opts.dtype
		})
		const out = await extractor(["Serene Pub smoke test."], {
			pooling: "mean",
			normalize: true
		})
		await extractor.dispose?.()
		const [rows, dims] = out.dims
		const data = Array.from(out.data)
		const norm = Math.hypot(...data)
		if (
			rows !== 1 ||
			!(dims > 0) ||
			data.length !== dims ||
			!data.every(Number.isFinite) ||
			Math.abs(norm - 1) > 1e-3
		) {
			console.error(
				`onnx-smoke: unexpected embedding: dims [${out.dims}], length ${data.length}, norm ${norm}`
			)
			return 1
		}
		console.log(
			`feature-extraction ${opts.model} (${opts.dtype}): dims [${out.dims}], norm ${norm.toFixed(4)}`
		)
		return 0
	} catch (err) {
		console.error("onnx-smoke: failed:", err)
		return 1
	} finally {
		fs.rmSync(cacheDir, { recursive: true, force: true })
	}
}

process.exitCode = await main()
