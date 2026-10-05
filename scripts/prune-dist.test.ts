/**
 * The desktop release prune (scripts/prune-dist.js) on a scratch payload:
 * what rules 3 and 14–18 remove — sourcemaps, TypeScript, docs, test suites,
 * type-only packages, unread builds — and, as importantly, what they leave:
 * license texts, runtime code that merely LOOKS like docs (yaml's dist/doc),
 * .ts entry points, and the packages the in-app component compiler bundles
 * from node_modules. Plus the runtime dependencies no static scan of build/
 * can see, so a dependency cleanup cannot demote them.
 */
import { afterEach, describe, expect, test } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pruneDist } from "./prune-dist.js"

const dirs: string[] = []
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A scratch payload: path → file contents (an object is written as JSON). */
function payload(files: Record<string, string | object>): (p: string) => boolean {
	const root = mkdtempSync(join(tmpdir(), "sp-prune16-"))
	dirs.push(root)
	for (const [p, body] of Object.entries(files)) {
		mkdirSync(dirname(join(root, p)), { recursive: true })
		writeFileSync(join(root, p), typeof body === "string" ? body : JSON.stringify(body))
	}
	pruneDist(root, { name: "linux-x64", platform: "linux", arch: "x64" })
	return (p) => existsSync(join(root, p))
}

const pj = (name: string, extra: object = {}) => ({ name, version: "1.0.0", license: "MIT", ...extra })

describe("rule 18: development-only files in every package", () => {
	test("sourcemaps, declarations, TS sources, docs and root test dirs go; license texts and runtime code stay", () => {
		const at = payload({
			"node_modules/lib/package.json": pj("lib", { main: "./dist/index.js" }),
			"node_modules/lib/dist/index.js": "x",
			"node_modules/lib/dist/index.js.map": "{}",
			"node_modules/lib/dist/index.d.ts": "x",
			"node_modules/lib/dist/index.d.cts": "x",
			"node_modules/lib/src/index.ts": "x",
			"node_modules/lib/README.md": "x",
			"node_modules/lib/CHANGELOG": "x",
			"node_modules/lib/docs/guide.md": "x",
			"node_modules/lib/test/index.test.js": "x",
			"node_modules/lib/.github/workflows/ci.yml": "x",
			"node_modules/lib/LICENSE": "x",
			"node_modules/lib/LICENSE.md": "x",
			"node_modules/lib/NOTICE.md": "x",
			"node_modules/lib/ThirdPartyNotices.txt": "x",
			"build/index.js": "x",
			"build/index.js.map": "{}"
		})
		for (const gone of [
			"dist/index.js.map",
			"dist/index.d.ts",
			"dist/index.d.cts",
			"src",
			"README.md",
			"CHANGELOG",
			"docs",
			"test",
			".github"
		])
			expect(at(`node_modules/lib/${gone}`), gone).toBe(false)
		for (const kept of ["package.json", "dist/index.js", "LICENSE", "LICENSE.md", "NOTICE.md", "ThirdPartyNotices.txt"])
			expect(at(`node_modules/lib/${kept}`), kept).toBe(true)
		expect(at("build/index.js")).toBe(true)
		expect(at("build/index.js.map")).toBe(false)
	})

	test("a docs-named directory below the package root is runtime code and stays (yaml's dist/doc)", () => {
		const at = payload({
			"node_modules/yaml/package.json": pj("yaml", { main: "./dist/index.js" }),
			"node_modules/yaml/dist/index.js": "x",
			"node_modules/yaml/dist/doc/Document.js": "x"
		})
		expect(at("node_modules/yaml/dist/doc/Document.js")).toBe(true)
	})

	test("a root directory an entry point reaches into stays, whatever its name", () => {
		const at = payload({
			"node_modules/odd/package.json": pj("odd", { exports: { ".": { import: "./docs/index.js" } } }),
			"node_modules/odd/docs/index.js": "x"
		})
		expect(at("node_modules/odd/docs/index.js")).toBe(true)
	})

	test("TypeScript sources stay when an entry point is one", () => {
		const at = payload({
			"node_modules/tsentry/package.json": pj("tsentry", { exports: { ".": { default: "./src/index.ts" } } }),
			"node_modules/tsentry/src/index.ts": "x",
			"node_modules/tsentry/src/index.d.ts": "x"
		})
		expect(at("node_modules/tsentry/src/index.ts")).toBe(true)
		expect(at("node_modules/tsentry/src/index.d.ts")).toBe(false)
	})

	test("svelte and @serene-pub/* (the in-app compiler's sources and the CLI's templates) lose only their sourcemaps", () => {
		const at = payload({
			"node_modules/@serene-pub/controls/package.json": pj("@serene-pub/controls", { exports: { ".": { default: "./src/index.ts" } } }),
			"node_modules/@serene-pub/controls/src/index.ts": "x",
			"node_modules/@serene-pub/controls/README.md": "x",
			"node_modules/@serene-pub/cli/package.json": pj("@serene-pub/cli", { main: "./dist/index.js" }),
			"node_modules/@serene-pub/cli/dist/index.js": "x",
			"node_modules/@serene-pub/cli/dist/index.js.map": "{}",
			"node_modules/@serene-pub/cli/dist/index.d.ts": "x",
			"node_modules/@serene-pub/cli/templates/plugin/base/test/plugin.test.ts": "x",
			"node_modules/svelte/package.json": pj("svelte"),
			"node_modules/svelte/types/index.d.ts": "x"
		})
		expect(at("node_modules/@serene-pub/controls/src/index.ts")).toBe(true)
		expect(at("node_modules/@serene-pub/controls/README.md")).toBe(true)
		expect(at("node_modules/@serene-pub/cli/dist/index.d.ts")).toBe(true)
		expect(at("node_modules/@serene-pub/cli/templates/plugin/base/test/plugin.test.ts")).toBe(true)
		expect(at("node_modules/svelte/types/index.d.ts")).toBe(true)
		expect(at("node_modules/@serene-pub/cli/dist/index.js.map")).toBe(false)
	})

	test("nested node_modules packages are cleaned as packages of their own", () => {
		const at = payload({
			"node_modules/outer/package.json": pj("outer"),
			"node_modules/outer/index.js": "x",
			"node_modules/outer/node_modules/inner/package.json": pj("inner"),
			"node_modules/outer/node_modules/inner/index.js": "x",
			"node_modules/outer/node_modules/inner/index.js.map": "{}",
			"node_modules/outer/node_modules/inner/test/a.js": "x"
		})
		expect(at("node_modules/outer/node_modules/inner/index.js")).toBe(true)
		expect(at("node_modules/outer/node_modules/inner/index.js.map")).toBe(false)
		expect(at("node_modules/outer/node_modules/inner/test")).toBe(false)
	})
})

describe("rules 3 and 14–17: unread packages and builds", () => {
	test("onnxruntime-web's dependencies go with it unless something else still names them (rule 3)", () => {
		const at = payload({
			"node_modules/onnxruntime-web/package.json": pj("onnxruntime-web", {
				dependencies: { protobufjs: "^7", "onnxruntime-common": "1", flatbuffers: "^25" }
			}),
			"node_modules/protobufjs/package.json": pj("protobufjs", { dependencies: { long: "^5", "@protobufjs/float": "^1" } }),
			"node_modules/long/package.json": pj("long"),
			"node_modules/@protobufjs/float/package.json": pj("@protobufjs/float"),
			"node_modules/flatbuffers/package.json": pj("flatbuffers"),
			"node_modules/onnxruntime-common/package.json": pj("onnxruntime-common"),
			"node_modules/onnxruntime-node/package.json": pj("onnxruntime-node", { dependencies: { "onnxruntime-common": "1" } })
		})
		expect(at("node_modules/onnxruntime-web")).toBe(false)
		expect(at("node_modules/protobufjs")).toBe(false)
		expect(at("node_modules/long")).toBe(false)
		expect(at("node_modules/@protobufjs")).toBe(false)
		expect(at("node_modules/flatbuffers")).toBe(false)
		expect(at("node_modules/onnxruntime-common/package.json")).toBe(true)
	})

	test("gpt-tokenizer keeps esm/ only — data/ (raw .tiktoken files) goes too (rule 5)", () => {
		const at = payload({
			"node_modules/gpt-tokenizer/package.json": pj("gpt-tokenizer"),
			"node_modules/gpt-tokenizer/esm/encoding/o200k_base.js": "x",
			"node_modules/gpt-tokenizer/data/o200k_base.tiktoken": "x"
		})
		expect(at("node_modules/gpt-tokenizer/esm/encoding/o200k_base.js")).toBe(true)
		expect(at("node_modules/gpt-tokenizer/data")).toBe(false)
	})

	test("llama3-tokenizer-js keeps its main, package.json and license (rule 14)", () => {
		const at = payload({
			"node_modules/llama3-tokenizer-js/package.json": pj("llama3-tokenizer-js", { main: "bundle/llama3-tokenizer-with-baked-data.js" }),
			"node_modules/llama3-tokenizer-js/bundle/llama3-tokenizer-with-baked-data.js": "x",
			"node_modules/llama3-tokenizer-js/bundle/commonjs-llama3-tokenizer-with-baked-data.cjs": "x",
			"node_modules/llama3-tokenizer-js/src/data-converted.js": "x",
			"node_modules/llama3-tokenizer-js/LICENSE.md": "x"
		})
		expect(at("node_modules/llama3-tokenizer-js/bundle/llama3-tokenizer-with-baked-data.js")).toBe(true)
		expect(at("node_modules/llama3-tokenizer-js/LICENSE.md")).toBe(true)
		expect(at("node_modules/llama3-tokenizer-js/bundle/commonjs-llama3-tokenizer-with-baked-data.cjs")).toBe(false)
		expect(at("node_modules/llama3-tokenizer-js/src")).toBe(false)
	})

	test("@types packages go, top-level and nested (rule 15)", () => {
		const at = payload({
			"node_modules/@types/node/package.json": pj("@types/node"),
			"node_modules/image-q/package.json": pj("image-q"),
			"node_modules/image-q/node_modules/@types/node/package.json": pj("@types/node")
		})
		expect(at("node_modules/@types")).toBe(false)
		expect(at("node_modules/image-q/node_modules/@types")).toBe(false)
		expect(at("node_modules/image-q/package.json")).toBe(true)
	})

	test("@huggingface/transformers keeps exactly its exports.node builds (rule 16)", () => {
		const at = payload({
			"node_modules/@huggingface/transformers/package.json": pj("@huggingface/transformers", {
				main: "./dist/transformers.node.cjs",
				exports: {
					node: {
						import: { types: "./types/transformers.d.ts", default: "./dist/transformers.node.mjs" },
						require: { types: "./types/transformers.d.ts", default: "./dist/transformers.node.cjs" }
					},
					default: { types: "./types/transformers.d.ts", default: "./dist/transformers.web.js" }
				}
			}),
			"node_modules/@huggingface/transformers/dist/transformers.node.mjs": "x",
			"node_modules/@huggingface/transformers/dist/transformers.node.cjs": "x",
			"node_modules/@huggingface/transformers/dist/transformers.node.min.mjs": "x",
			"node_modules/@huggingface/transformers/dist/transformers.web.js": "x",
			"node_modules/@huggingface/transformers/dist/transformers.js": "x",
			"node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs": "x"
		})
		const d = "node_modules/@huggingface/transformers/dist"
		expect(at(`${d}/transformers.node.mjs`)).toBe(true)
		expect(at(`${d}/transformers.node.cjs`)).toBe(true)
		expect(at(`${d}/ort-wasm-simd-threaded.jsep.mjs`)).toBe(true)
		expect(at(`${d}/transformers.node.min.mjs`)).toBe(false)
		expect(at(`${d}/transformers.web.js`)).toBe(false)
		expect(at(`${d}/transformers.js`)).toBe(false)
	})

	test("PGlite's extension archives go; its runtime files stay (rule 17)", () => {
		const at = payload({
			"node_modules/@electric-sql/pglite/package.json": pj("@electric-sql/pglite"),
			"node_modules/@electric-sql/pglite/dist/index.js": "x",
			"node_modules/@electric-sql/pglite/dist/postgres.wasm": "x",
			"node_modules/@electric-sql/pglite/dist/postgres.data": "x",
			"node_modules/@electric-sql/pglite/dist/vector.tar.gz": "x",
			"node_modules/@electric-sql/pglite/dist/pgcrypto.tar.gz": "x"
		})
		const d = "node_modules/@electric-sql/pglite/dist"
		for (const f of ["index.js", "postgres.wasm", "postgres.data"]) expect(at(`${d}/${f}`), f).toBe(true)
		expect(at(`${d}/vector.tar.gz`)).toBe(false)
		expect(at(`${d}/pgcrypto.tar.gz`)).toBe(false)
	})
})

describe("runtime dependencies a static scan of build/ cannot see", () => {
	const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> }
	// - ses, quickjs-emscripten: required inside eval'd worker sources (plugins/, pipelines/scripts/);
	// - @electric-sql/pglite: opened by drizzle-orm/pglite (a peer) and resolved by path in db/recovery.ts;
	// - the @serene-pub packages: the in-app component compiler bundles authored components
	//   against them FROM node_modules (COMPONENT_IMPORTS), and the support report reads their versions.
	test.each([
		"ses",
		"quickjs-emscripten",
		"@electric-sql/pglite",
		"@serene-pub/component-client",
		"@serene-pub/controls",
		"@serene-pub/core-catalog",
		"@serene-pub/sdk"
	])("%s stays a production dependency", (name) => {
		expect(pkg.dependencies[name]).toBeTruthy()
	})
})

describe("rules 1, 3b, 3c: what a fresh CI install adds", () => {
	test("onnxruntime-node keeps only the target platform/arch under any napi-v* level, minus GPU providers", () => {
		const at = payload({
			"node_modules/onnxruntime-node/package.json": pj("onnxruntime-node", { main: "./dist/index.js" }),
			"node_modules/onnxruntime-node/dist/index.js": "x",
			"node_modules/onnxruntime-node/bin/napi-v3/linux/x64/onnxruntime_binding.node": "x",
			"node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime_providers_cuda.so": "x",
			"node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime_providers_tensorrt.so": "x",
			"node_modules/onnxruntime-node/bin/napi-v3/linux/arm64/onnxruntime_binding.node": "x",
			"node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node": "x",
			"node_modules/onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime_binding.node": "x"
		})
		const ort = "node_modules/onnxruntime-node/bin/napi-v3"
		expect(at(`${ort}/linux/x64/onnxruntime_binding.node`)).toBe(true)
		for (const gone of [
			`${ort}/linux/x64/libonnxruntime_providers_cuda.so`,
			`${ort}/linux/x64/libonnxruntime_providers_tensorrt.so`,
			`${ort}/linux/arm64`,
			`${ort}/darwin`,
			`${ort}/win32`
		])
			expect(at(gone), gone).toBe(false)
	})

	test("the docs compiler a production install drags in as cli's optional peer goes, with its orphans", () => {
		const at = payload({
			"node_modules/@serene-pub/cli/package.json": pj("@serene-pub/cli", {
				main: "./dist/index.js",
				peerDependencies: { "@serene-pub/docs": "*" },
				peerDependenciesMeta: { "@serene-pub/docs": { optional: true } }
			}),
			"node_modules/@serene-pub/cli/dist/index.js": "x",
			"node_modules/@serene-pub/docs/package.json": pj("@serene-pub/docs", {
				main: "./dist/index.js",
				dependencies: { elkjs: "*", shiki: "*" }
			}),
			"node_modules/@serene-pub/docs/dist/index.js": "x",
			"node_modules/elkjs/package.json": pj("elkjs", { main: "./lib/main.js" }),
			"node_modules/elkjs/lib/main.js": "x",
			"node_modules/shiki/package.json": pj("shiki", { main: "./dist/index.mjs" }),
			"node_modules/shiki/dist/index.mjs": "x"
		})
		expect(at("node_modules/@serene-pub/cli/dist/index.js")).toBe(true)
		for (const gone of ["node_modules/@serene-pub/docs", "node_modules/elkjs", "node_modules/shiki"])
			expect(at(gone), gone).toBe(false)
	})

	test("node_modules/.bin goes, nested ones too", () => {
		const at = payload({
			"node_modules/.bin/esbuild": "x",
			"node_modules/lib/package.json": pj("lib", { main: "./index.js" }),
			"node_modules/lib/index.js": "x",
			"node_modules/lib/node_modules/.bin/tool": "x"
		})
		expect(at("node_modules/.bin")).toBe(false)
		expect(at("node_modules/lib/node_modules/.bin")).toBe(false)
		expect(at("node_modules/lib/index.js")).toBe(true)
	})
})
