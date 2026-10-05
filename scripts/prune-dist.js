// scripts/prune-dist.js
//
// Strips known-safe dead weight from an already-assembled dist/<target>/
// tree — called by bundle-dist.js right after it copies node_modules/build
// into the output directory, never against the developer's real
// node_modules or static/ in the working tree. Every rule here is either:
//   - platform-specific binary variants that aren't the target's own
//     (onnxruntime-node ships all five platforms as plain files, not via
//     npm optionalDependencies, so npm itself has no way to prune these),
//   - execution-provider libraries the app never requests (no GPU device
//     option is ever passed to the embedding pipeline), or
//   - build artifacts/duplicated formats confirmed unread by anything at
//     runtime (see the size-audit plan this script implements), or
//   - development-only files in every package — sourcemaps, TypeScript
//     declarations and sources, docs, test suites (rule 18) — never the
//     license texts and notices, which ship with the code.
//
// Nothing here changes behavior — only removes files nothing reads.

import fs from "fs"
import path from "path"

function rm(p) {
	if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

function rmMatching(dir, predicate) {
	if (!fs.existsSync(dir)) return
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name)
		if (entry.isDirectory()) rmMatching(p, predicate)
		else if (predicate(entry.name)) rm(p)
	}
}

/** Remove every directory called `name` under `dir` (not following symlinks). */
function rmDirsNamed(dir, name) {
	if (!fs.existsSync(dir)) return
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const p = path.join(dir, entry.name)
		if (entry.name === name) rm(p)
		else rmDirsNamed(p, name)
	}
}

/**
 * @param {string} outDir - the payload directory bundle-dist.js just assembled
 *   (already contains build/, node_modules/, drizzle/). That is the bundle's
 *   app/ directory — or, on macOS, Serene Pub.app/Contents/Resources/app — not
 *   the top of the extracted folder; see scripts/dist-layout.js. Every path
 *   below is relative to it, so the rules did not have to change when the
 *   payload moved.
 * @param {{name: string, platform: string, arch: string}} target - the same
 *   target object bundle-dist.js already resolved from its targets list.
 */
export function pruneDist(outDir, target) {
	const nm = path.join(outDir, "node_modules")

	// 1+2. onnxruntime-node ships every platform's native binary as plain
	// files under bin/napi-v6/<platform>/<arch>/ (not npm optionalDependencies
	// — npm can't prune these on its own). Keep only this target's own
	// platform/arch, then strip the GPU execution-provider libs from
	// whatever survives: embedding/index.ts never passes a `device` option
	// to the transformers pipeline (Node default is CPU), so CUDA/DirectML
	// are pure dead weight today. If GPU embedding is added later, it
	// should be an on-demand download (mirroring
	// src/lib/server/koboldcpp/binaryManager.ts's pattern), not re-bundled.
	// Every bin/napi-v*/ directory: the N-API level in the path moves between
	// onnxruntime-node releases, and a fresh CI install can resolve a newer one
	// than the dev tree's (a hard-coded napi-v6 let a whole other platform ship).
	const ortBin = path.join(nm, "onnxruntime-node/bin")
	const ortBinRoots = fs.existsSync(ortBin)
		? fs.readdirSync(ortBin).filter((d) => d.startsWith("napi-v")).map((d) => path.join(ortBin, d))
		: []
	for (const ortBinRoot of ortBinRoots) {
		for (const platformDir of fs.readdirSync(ortBinRoot)) {
			const platformPath = path.join(ortBinRoot, platformDir)
			if (!fs.lstatSync(platformPath).isDirectory()) continue
			if (platformDir !== target.platform) {
				rm(platformPath)
				continue
			}
			for (const archDir of fs.readdirSync(platformPath)) {
				if (archDir !== target.arch) {
					rm(path.join(platformPath, archDir))
				}
			}
		}
		rmMatching(
			ortBinRoot,
			(name) =>
				/onnxruntime_providers_(cuda|tensorrt|rocm|migraphx|openvino|dnnl|qnn|webgpu)/i.test(name) ||
				name === "DirectML.dll" ||
				name === "dxcompiler.dll" ||
				name === "dxil.dll"
		)
	}

	// 3. onnxruntime-web is only reachable via @huggingface/transformers'
	// browser export condition — the Node build always resolves
	// transformers.node.mjs, which uses onnxruntime-node instead. Confirmed
	// zero imports of onnxruntime-web anywhere in src/.
	//
	// Its own dependencies go with it when nothing else needs them: npm
	// hoists them to the top level, where they outlived the package —
	// protobufjs (+ @protobufjs/*, long), flatbuffers, guid-typescript and
	// platform, ~4 MB that only onnxruntime-web ever required.
	// onnxruntime-common stays (onnxruntime-node depends on it).
	removePackageAndOrphans(nm, "onnxruntime-web")

	// 3b. Packages that reach a production install only as OPTIONAL peers.
	// @serene-pub/cli names @serene-pub/docs, ui-preview, conformance and
	// happy-dom as optional peers; the app has docs/conformance as dev
	// dependencies, and npm keeps a dev package when a production package's
	// optional-peer edge points at it, so `npm install --omit=dev` ships the
	// docs compiler with elkjs, shiki and jimp (~25 MB). Nothing at runtime
	// imports them — the app uses only cli's sub-entries (component-compile),
	// never its root — so they and their orphans go, unless the app itself
	// lists one as a dependency.
	const appDeps = new Set(appDependencyNames() ?? [])
	for (const name of ["@serene-pub/docs", "@serene-pub/ui-preview", "@serene-pub/conformance", "happy-dom"]) {
		if (!appDeps.has(name)) removePackageAndOrphans(nm, name)
	}

	// 3c. node_modules/.bin (and any nested one): command shims and, for
	// esbuild, a copy of its ~10 MB binary. The server resolves packages by
	// import, never by running a .bin command.
	rmDirsNamed(nm, ".bin")

	// 4. @lenml/tokenizer-gemma is loaded via a dynamic ESM import
	// (TokenCounterManager.ts), which only ever resolves dist/main.mjs —
	// the CJS/IIFE builds and every .map file are unread duplicates.
	// Expressed as KEEP-what-is-needed rather than DELETE-a-list-of-names.
	//
	// The list form was the single most fragile rule here: ~106 MB of this
	// package's 116 MB dist rides on it, and it matched five exact filenames,
	// so any upstream rename or added build artifact silently no-ops it and
	// ships the weight. Directory-shaped rules elsewhere in this file fail
	// loudly by comparison; this one failed silently.
	//
	// Safe because the app reaches this package only through a dynamic
	// import() (TokenCounterManager.ts), which resolves the package's
	// "import" export condition — ./dist/main.mjs — and nothing else. The
	// .d.ts is kept as a cheap courtesy for anyone inspecting the bundle.
	const gemmaDist = path.join(nm, "@lenml/tokenizer-gemma/dist")
	if (fs.existsSync(gemmaDist)) {
		for (const f of fs.readdirSync(gemmaDist)) {
			if (f === "main.mjs" || f.endsWith(".d.ts")) continue
			rm(path.join(gemmaDist, f))
		}
	}

	// 5. gpt-tokenizer's package.json exports map resolves the dynamic
	// import("gpt-tokenizer/encoding/...") pattern this app uses
	// (TokenCounterManager.ts) through "./*": {"import": "./esm/*.js"} only
	// — dist/ (unpkg/CDN target), cjs/, and src/ are never touched. data/
	// holds the raw .tiktoken files (~7 MB) that the package's own codegen
	// turns into esm/bpeRanks/*.js; only its codegen and tests read them.
	const gptTok = path.join(nm, "gpt-tokenizer")
	for (const dir of ["dist", "cjs", "src", "data"]) {
		rm(path.join(gptTok, dir))
	}

	// 6. `intl` (an Intl polyfill) is no longer a dependency: it existed only
	// for the Android runtime's old intl=none Node 18, and every runtime now
	// has a real Intl. Removing it here only catches a stale copy left in a
	// node_modules that predates the dependency's removal; nothing imports it.
	rm(path.join(nm, "intl"))

	// 7. @img/sharp-libvips ships both glibc and musl variants for
	// linux-x64; every currently-built desktop target is glibc.
	rm(path.join(nm, "@img/sharp-libvips-linuxmusl-x64"))

	// 8. esbuild — the component compiler's bundler (C6 P3, in-app authoring).
	// Its native binary arrives as the optionalDependency
	// `@esbuild/<platform>-<arch>`, and npm installs only the host's; CI
	// builds each target on its own OS, so this normally finds exactly one.
	// Kept to the target's own anyway, so a node_modules prepared on another
	// machine can never ship a second platform's ~10 MB binary.
	for (const scope of esbuildScopes(nm)) {
		for (const name of fs.readdirSync(scope)) {
			if (name !== `${target.platform}-${target.arch}`) rm(path.join(scope, name))
		}
	}
	// 9. esbuild's install script (on Unix) replaces the tiny JS launcher at
	// esbuild/bin/esbuild with a COPY of the native binary, for CLI start-up
	// speed. The app only uses the JS API, which resolves the binary from
	// `@esbuild/<platform>-<arch>/bin/esbuild` (esbuild lib/main.js
	// generateBinPath), so the copy is a second 10 MB nothing reads. The
	// launcher is ~9 KB; anything over 1 MB is the copy.
	const esbuildBin = path.join(nm, "esbuild/bin/esbuild")
	if (fs.existsSync(esbuildBin) && fs.statSync(esbuildBin).size > 1024 * 1024) rm(esbuildBin)

	// 11. Server sourcemaps: adapter-node bundles build/server with its own
	// rollup pass, which hard-codes `sourcemap: true` in its output options,
	// and writes maps beside build/index.js, handler.js, env.js and shims.js
	// too. build/client emits none, and nothing reads them once shipped (the
	// server is never started with --enable-source-maps).
	rmMatching(path.join(outDir, "build"), (name) => name.endsWith(".map"))

	// 12. drizzle-kit's *_snapshot.json files are dev-time artifacts for
	// `drizzle-kit generate` — drizzle-orm's actual runtime migrator
	// (node_modules/drizzle-orm/migrator.js) only ever reads
	// meta/_journal.json and each migration's .sql file. Confirmed by
	// reading the migrator source directly, not inferred.
	const drizzleMeta = path.join(outDir, "drizzle/meta")
	if (fs.existsSync(drizzleMeta)) {
		for (const f of fs.readdirSync(drizzleMeta)) {
			if (f.endsWith("_snapshot.json")) rm(path.join(drizzleMeta, f))
		}
	}

	// 13. Pre-compressed .gz/.br assets exist for a real HTTP/reverse-proxy
	// deployment (Docker/hosted) — the desktop app serves itself over
	// loopback only, so these are dead weight here specifically. Mirrors
	// scripts/build-android.js's identical strip for the APK build.
	rmMatching(
		path.join(outDir, "build/client"),
		(name) => name.endsWith(".gz") || name.endsWith(".br")
	)

	// 14. llama3-tokenizer-js has no exports map: both `import` and
	// `require` resolve its `main` (bundle/llama3-tokenizer-with-baked-data.js,
	// the only file the tokenizer code paths import). The two CommonJS copies
	// of the same 3 MB baked bundle and the 3 MB src/ it is generated from
	// are never read. KEEP-what-is-needed, like rule 4.
	keepOnlyMain(path.join(nm, "llama3-tokenizer-js"))

	// 15. Type-only packages. Nothing imports `@types/*` at runtime — they
	// exist for the TypeScript checker — yet runtime packages (engine.io,
	// image-q, …) list them as dependencies, so a production install ships them.
	for (const scope of scopeDirs(nm, "@types")) rm(scope)

	// 16. @huggingface/transformers ships eight builds of itself in dist/;
	// Node resolves only its `exports.node` targets (the app reaches it by
	// dynamic import() — transformers.node.mjs; the .cjs twin is kept for
	// any require()). The web and minified builds are unread. KEEP-what-is-
	// needed: computed from the package's own exports map, so a renamed
	// build is kept rather than silently shipped or wrongly removed.
	const hf = path.join(nm, "@huggingface/transformers")
	if (fs.existsSync(path.join(hf, "package.json"))) {
		const exp = readJson(path.join(hf, "package.json")).exports
		const node = exp?.["."]?.node ?? exp?.node
		const keep = new Set()
		;(function walk(v) {
			if (typeof v === "string") keep.add(path.basename(v))
			else if (v && typeof v === "object") Object.values(v).forEach(walk)
		})(node)
		const dist = path.join(hf, "dist")
		const BUILD = /^transformers\.(.*\.)?(m|c)?js$/
		// Only when the node targets are really there — never empty the package.
		if ([...keep].some((f) => BUILD.test(f) && fs.existsSync(path.join(dist, f)))) {
			for (const f of fs.readdirSync(dist)) if (BUILD.test(f) && !keep.has(f)) rm(path.join(dist, f))
		}
	}

	// 17. PGlite's contrib/vector extension archives (dist/*.tar.gz, ~5 MB).
	// One is read only when its module (`@electric-sql/pglite/contrib/<name>`
	// or `/vector`) is imported and passed as `extensions` to new PGlite();
	// the app opens PGlite with none (db/index.ts via drizzle, and
	// db/recovery.ts), and core's own .tar.gz handling is dumpDataDir /
	// loadDataDir of user archives, not these files.
	rmMatching(path.join(nm, "@electric-sql/pglite/dist"), (name) => name.endsWith(".tar.gz"))

	// 18. Development-only files in every package: sourcemaps, TypeScript
	// declarations and sources, docs, test suites. See cleanPackage() for
	// each rule and what it deliberately leaves alone.
	for (const pkgDir of packageDirs(nm)) cleanPackage(pkgDir)
}

// ── node_modules cleaning (rules 3, 14 and 18) ───────────────────────────

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"))

/** Every package directory under `nm`, nested node_modules included. */
function packageDirs(nm) {
	const out = []
	;(function walk(dir) {
		if (!fs.existsSync(dir)) return
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue
			const p = path.join(dir, entry.name)
			const pkgs = entry.name.startsWith("@")
				? fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(p, e.name))
				: [p]
			for (const pkgDir of pkgs) {
				if (!fs.existsSync(path.join(pkgDir, "package.json"))) continue
				out.push(pkgDir)
				walk(path.join(pkgDir, "node_modules"))
			}
		}
	})(nm)
	return out
}

/** Every `<scope>` directory: the top level's and any a package nests. */
function scopeDirs(nm, scope) {
	const out = []
	const top = path.join(nm, scope)
	if (fs.existsSync(top)) out.push(top)
	for (const pkgDir of packageDirs(nm)) {
		const nested = path.join(pkgDir, "node_modules", scope)
		if (fs.existsSync(nested)) out.push(nested)
	}
	return out
}

const depNames = (pkg) => [
	...Object.keys(pkg.dependencies ?? {}),
	...Object.keys(pkg.optionalDependencies ?? {}),
	...Object.keys(pkg.peerDependencies ?? {})
]

/** The app's own dependencies: what build/ imports, named by no package.json in the payload. */
function appDependencyNames() {
	try {
		return Object.keys(readJson(new URL("../package.json", import.meta.url)).dependencies ?? {})
	} catch {
		return null
	}
}

/**
 * Remove top-level package `name`, then each of its dependencies (and
 * theirs, transitively) that nothing left in the tree — and not the app
 * itself — still names in dependencies / optionalDependencies /
 * peerDependencies. Conservative by construction: one mention anywhere keeps
 * a package; without the app's package.json, nothing beyond `name` goes.
 */
function removePackageAndOrphans(nm, name) {
	const pj = path.join(nm, name, "package.json")
	let candidates = fs.existsSync(pj) ? depNames(readJson(pj)) : []
	rm(path.join(nm, name))
	const app = appDependencyNames()
	if (!app) return
	while (candidates.length) {
		const named = new Set(app)
		for (const pkgDir of packageDirs(nm)) for (const n of depNames(readJson(path.join(pkgDir, "package.json")))) named.add(n)
		const next = []
		for (const c of new Set(candidates)) {
			const dir = path.join(nm, c)
			if (named.has(c) || !fs.existsSync(path.join(dir, "package.json"))) continue
			next.push(...depNames(readJson(path.join(dir, "package.json"))))
			rm(dir)
			const scope = path.dirname(dir)
			if (scope !== nm && fs.existsSync(scope) && fs.readdirSync(scope).length === 0) rm(scope)
		}
		candidates = next
	}
}

/** A package with no `exports`: keep package.json, its `main`, and its notices. */
function keepOnlyMain(pkgDir) {
	const pj = path.join(pkgDir, "package.json")
	if (!fs.existsSync(pj)) return
	const pkg = readJson(pj)
	if (pkg.exports || typeof pkg.main !== "string") return
	const main = path.normalize(pkg.main)
	if (!fs.existsSync(path.join(pkgDir, main))) return
	;(function walk(dir) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, entry.name)
			const rel = path.relative(pkgDir, p)
			if (entry.isDirectory()) {
				if (main.startsWith(rel + path.sep)) walk(p)
				else rm(p)
			} else if (rel !== main && rel !== "package.json" && !NOTICE_FILE.test(entry.name)) rm(p)
		}
	})(pkgDir)
}

/** License texts and notices — the license obligations ship with the code, always. */
const NOTICE_FILE = /^(licen[cs]e|notice|copying|copyright|authors|patents|third[-_ ]?party)/i
const DOC_FILE = /^(readme|changelog|changes|history|contributing|code_of_conduct|security|upgrading|migrating)(\.(md|markdown|txt|rst))?$/i
const MARKDOWN = /\.(md|markdown)$/i
const DECLARATION = /\.d\.(ts|mts|cts)$/
const TS_SOURCE = /\.(ts|mts|cts|tsx)$/
const JUNK_FILE = /^(\.npmignore|\.eslintrc(\..+)?|\.eslintignore|\.prettierrc(\..+)?|\.prettierignore|\.editorconfig|\.travis\.yml|\.gitattributes|\.babelrc|\.nycrc(\..+)?|\.jshintrc|\.DS_Store)$|\.tsbuildinfo$/
/** Package-root directories that are a package's own tests, docs or CI. */
const ROOT_DEV_DIRS = new Set(["test", "tests", "__tests__", "example", "examples", "benchmark", "benchmarks", "coverage", ".github", "docs", "doc", "man"])

/**
 * Packages left whole apart from sourcemaps. The in-app component compiler
 * (components/compile.ts) bundles authored components against svelte and the
 * @serene-pub packages FROM node_modules — controls and component-client
 * export .ts/.svelte sources, and the CLI scaffolds from templates/ — so
 * nothing else is touched in them.
 */
const keepWhole = (name) => name === "svelte" || name.startsWith("@serene-pub/")

/** Paths a Node `import`/`require` of the package can reach (types excluded). */
function entryTargets(pkg) {
	const out = []
	const RUNTIME_CONDITIONS = new Set(["node", "import", "require", "default", "module", "svelte"])
	/** exports: subpaths and the conditions Node (or the compiler's svelte) resolves. */
	const walkExports = (v) => {
		if (typeof v === "string") out.push(v)
		else if (Array.isArray(v)) v.forEach(walkExports)
		else if (v && typeof v === "object")
			for (const [k, x] of Object.entries(v)) if (k.startsWith(".") || RUNTIME_CONDITIONS.has(k)) walkExports(x)
	}
	/** main/module/svelte are a path; bin/browser a path or a map whose values are paths. */
	for (const field of ["main", "module", "svelte", "bin", "browser"]) {
		const v = pkg[field]
		if (typeof v === "string") out.push(v)
		else if (v && typeof v === "object") for (const x of Object.values(v)) if (typeof x === "string") out.push(x)
	}
	walkExports(pkg.exports)
	return out.map((t) => path.normalize(t.replace(/\*.*$/, "")))
}

/**
 * Rule 18 for one package (its nested node_modules are packages of their own):
 *   - `*.map` sourcemaps, everywhere: nothing reads them at runtime;
 *   - unless keepWhole(): TypeScript declarations; TypeScript sources, unless
 *     an entry point is one (Node refuses to type-strip under node_modules,
 *     so a .ts beside its compiled .js is never loaded); markdown and
 *     readme/changelog files other than license texts and notices; editor and
 *     CI dotfiles; and the package-root test/docs/example directories no
 *     entry point reaches into (root only: yaml's runtime lives in dist/doc/).
 * Directories this empties are removed; other empty directories stay.
 */
function cleanPackage(pkgDir) {
	let pkg
	try {
		pkg = readJson(path.join(pkgDir, "package.json"))
	} catch {
		return
	}
	const whole = keepWhole(pkg.name ?? "")
	const entries = entryTargets(pkg)
	const tsEntry = entries.some((t) => TS_SOURCE.test(t) && !DECLARATION.test(t))
	const reached = new Set(entries.map((t) => t.split(path.sep)[0]))
	const removable = (name) =>
		name.endsWith(".map") ||
		(!whole &&
			(DECLARATION.test(name) ||
				(!tsEntry && TS_SOURCE.test(name)) ||
				(!NOTICE_FILE.test(name) && (MARKDOWN.test(name) || DOC_FILE.test(name))) ||
				JUNK_FILE.test(name)))
	;(function walk(dir, atRoot) {
		let removed = false
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				if (atRoot && entry.name === "node_modules") continue
				if (atRoot && !whole && ROOT_DEV_DIRS.has(entry.name) && !reached.has(entry.name)) {
					rm(p)
					removed = true
					continue
				}
				if (walk(p, false) && fs.readdirSync(p).length === 0) {
					fs.rmdirSync(p)
					removed = true
				}
			} else if (removable(entry.name)) {
				rm(p)
				removed = true
			}
		}
		return removed
	})(pkgDir, true)
}

/** Every `@esbuild` scope directory: the top level's and any a package nests. */
function esbuildScopes(nm) {
	const out = []
	const top = path.join(nm, "@esbuild")
	if (fs.existsSync(top)) out.push(top)
	if (!fs.existsSync(nm)) return out
	for (const entry of fs.readdirSync(nm, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const parents = entry.name.startsWith("@")
			? fs.readdirSync(path.join(nm, entry.name)).map((n) => path.join(nm, entry.name, n))
			: [path.join(nm, entry.name)]
		for (const p of parents) {
			const nested = path.join(p, "node_modules/@esbuild")
			if (fs.existsSync(nested)) out.push(nested)
		}
	}
	return out
}

/**
 * The Android profile. Same intent as pruneDist above — remove only files
 * nothing reads — but the Android target differs enough that sharing one rule
 * set would be wrong: it can drop the entire local-embedding stack (and the
 * component compiler), which desktop obviously cannot.
 *
 * This was previously not applied at all: scripts/build-android.js copied
 * node_modules verbatim, so an APK shipped ~1GB of assets — over half of it
 * onnxruntime native binaries for linux/x64, win32/x64, win32/arm64,
 * darwin/arm64 and linux/arm64, none of which can execute on Android.
 *
 * @param {string} assetsDir - android/app/src/main/assets/serene-pub, already
 *   populated with build/, node_modules/ and drizzle/.
 */
export function pruneAndroidAssets(assetsDir) {
	const nm = path.join(assetsDir, "node_modules")

	// 1. The entire local-embedding stack. Not merely wrong-architecture:
	// src/lib/server/embedding/index.ts's getLocalEmbeddingUnsupportedReason()
	// returns early for the Android wrapper because Bionic cannot dlopen the
	// glibc-linked onnxruntime binary — "a genuine architectural
	// impossibility", in its own words. So this code path is unreachable on
	// Android by construction.
	//
	// Safe to remove outright because every runtime reference is a dynamic
	// `await import("@huggingface/transformers")` (three call sites, all in
	// embedding/index.ts); the only static references are `import type`, which
	// erase at compile time. probeLocalEmbeddingSupport() already wraps its
	// import in a try/catch that turns ANY failure into the same "not
	// available on this system" verdict, so a missing module produces exactly
	// the outcome a failed native load produced before.
	//
	// sharp and @img/* are transitive dependencies of @huggingface/transformers
	// only — nothing in src/ imports sharp — so they go with it.
	rm(path.join(nm, "@huggingface/transformers"))
	rm(path.join(nm, "onnxruntime-node"))
	rm(path.join(nm, "onnxruntime-web"))
	rm(path.join(nm, "onnxruntime-common"))
	rm(path.join(nm, "sharp"))
	// The whole @img scope, not its contents one by one — every package under
	// it is a sharp libvips native build, and removing only the children left
	// an empty scope directory behind.
	rm(path.join(nm, "@img"))

	// 2. Tokenizers: identical reasoning to the desktop rules 4 and 5 above —
	// both are reached only through dynamic import() resolving the package's
	// "import" export condition, so the CJS/IIFE/CDN builds are unread.
	const gemmaDist = path.join(nm, "@lenml/tokenizer-gemma/dist")
	if (fs.existsSync(gemmaDist)) {
		for (const f of fs.readdirSync(gemmaDist)) {
			if (f === "main.mjs" || f.endsWith(".d.ts")) continue
			rm(path.join(gemmaDist, f))
		}
	}
	const gptTok = path.join(nm, "gpt-tokenizer")
	for (const dir of ["dist", "cjs", "src"]) rm(path.join(gptTok, dir))

	// 2b. The component compiler (C6 P3). There is NO compiler on Android
	// (owner ruling 2026-09-25: the then-embedded nodejs-mobile 18 could not
	// start esbuild's Go service, and authoring on a phone is impractical; no
	// esbuild binary for Android is shipped either way). The server already
	// reports "no compiler" there (components/compile.ts checks
	// SERENE_PUB_PLATFORM first), so these are files nothing can load:
	//   - esbuild and every @esbuild/* native binary (desktop-only builds);
	//   - Svelte's COMPILER — the runtime (svelte/src/internal, …) stays,
	//     because the server bundle imports it; nothing in the runtime imports
	//     the compiler;
	//   - the CLI's in-memory compiler module. `component-source` (the pure
	//     path/limit/hash helpers the component store imports) stays.
	rm(path.join(nm, "esbuild"))
	for (const scope of esbuildScopes(nm)) rm(scope)
	rm(path.join(nm, "svelte/compiler"))
	rm(path.join(nm, "svelte/src/compiler"))
	rmMatching(path.join(nm, "@serene-pub/cli/dist"), (name) =>
		/^componentCompile\.(js|d\.ts)(\.map)?$/.test(name)
	)

	// 3. A stale `intl` polyfill copy — same reasoning as desktop rule 6. The
	// embedded Node 24 (small-icu) has a real Intl; nothing loads the polyfill.
	rm(path.join(nm, "intl"))

	// 4. Source maps anywhere under node_modules. Nothing on a phone reads
	// them, and they are pure text — among the largest single categories in
	// the unpruned APK.
	rmMatching(nm, (name) => name.endsWith(".map"))

	// 5. Same drizzle-kit snapshot and SSR sourcemap rules as desktop; the
	// runtime migrator reads only meta/_journal.json and the .sql files.
	rmMatching(path.join(assetsDir, "build/server"), (name) =>
		name.endsWith(".map")
	)
	const drizzleMeta = path.join(assetsDir, "drizzle/meta")
	if (fs.existsSync(drizzleMeta)) {
		for (const f of fs.readdirSync(drizzleMeta)) {
			if (f.endsWith("_snapshot.json")) rm(path.join(drizzleMeta, f))
		}
	}

	// 6. TypeScript declarations and package docs. Never read at runtime by
	// Node; they exist for editors and for people reading the source.
	rmMatching(
		nm,
		(name) =>
			name.endsWith(".d.ts") ||
			name.endsWith(".d.mts") ||
			name.endsWith(".d.cts") ||
			/^(readme|changelog|license|licence|history|contributing|authors|notice)(\.[a-z]+)?$/i.test(
				name
			)
	)
}

/** Recursively sums file sizes under `dir` — used for the CI size guard and
 * for measuring savings locally. Returns 0 for a directory that doesn't
 * exist rather than throwing (a target that was never built yet). */
export function dirSizeBytes(dir) {
	if (!fs.existsSync(dir)) return 0
	let total = 0
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name)
		total += entry.isDirectory() ? dirSizeBytes(p) : fs.statSync(p).size
	}
	return total
}

// Per-target uncompressed size ceiling for the CI guard (release.yml). Measured
// over the whole staging directory, so it covers the app/ payload plus the docs
// and the launcher beside it. Set a comfortable margin above the measured
// post-prune size, not a tight tripwire; the point is catching a dependency bump
// silently reintroducing hundreds of MB, not policing byte-level drift.
// Re-measure and adjust after any deliberate, expected size change (e.g. a new
// bundled feature).
//
// Raised for the desktop targets in 0.5.0-rc-3 after a MEASURED breakdown, not
// a wave-through. macos-arm64 came in at 308.8 MB against the old 220 ceiling,
// and the guard's diagnostic output showed where it went:
//
//     174.4 MB  node_modules   <- clean; no reintroduced platform binaries
//     115.4 MB  node           <- the bundled Node runtime
//      18.8 MB  build
//
// The driver is the bundled runtime, not dependency bloat: release.yml pins and
// ships Node v24.18.0, whose binary is substantially larger than the Node 20
// one these ceilings were originally measured against. node_modules itself was
// verified healthy — onnxruntime-node at 34.6 MB is a single platform, and a
// local simulation of pruneDist reduced a real tree 1317 MB -> 533 MB, so every
// rule here is still matching.
//
// macos-x64 and windows-x64 are raised to match: they bundle the same runtime,
// so their old 220 ceilings would fail for the identical reason. Their exact
// post-prune sizes have NOT been measured — if one of them lands far below
// this, tighten it rather than leaving slack that hides a real regression.
//
// Raised again by 20 MB for every target in 0.6 (2026-10-01), deliberately,
// for the Go launcher and the window helper that replaced the shell shims
// (scripts/dist-layout.js). Measured on a probe build of the launcher's shape
// (fyne.io/systray + net/http + os/exec, `-trimpath -ldflags "-s -w"`):
// 7.4 MB linux-x64 static, 6.0 MB windows-x64. The window helper (webview_go,
// cgo) was NOT measured — the dev box lacks the WebKitGTK headers — and is
// budgeted at up to ~8 MB (Windows statically links libstdc++), plus ~1.2 MB
// for macOS's favicon.icns. Once the first CI run prints real sizes, tighten
// these to that plus the usual margin.
export const SIZE_THRESHOLD_MB = {
	"linux-x64": 370,
	"macos-x64": 380,
	"macos-arm64": 380,
	"windows-x64": 380
}

// Uncompressed ceiling for the Android assets tree, checked by
// scripts/build-android.js right after pruning. There was no guard here at
// all, which is how a ~1GB assets bundle (671MB packed APK) shipped without
// anything tripping.
//
// Measured, not guessed: simulating this prune over a production-only
// dependency tree (npm ls --omit=dev) plus the app build gave 185.2 MB, from
// 1517 MB unpruned. The remainder is mostly the app's own build/ (~50 MB) and
// legitimately-needed packages — @lenml/tokenizer-gemma, date-fns, pglite,
// lucide. (`intl`, a ~23 MB polyfill counted in that measurement, has since
// been dropped: the Node 24 runtime has a real Intl.)
//
// 260 leaves margin for ordinary dependency growth; the point is catching a
// bump that silently reintroduces the embedding stack, not policing drift. If
// a real CI build lands far under this, tighten it rather than leaving slack
// that hides a regression.
export const ANDROID_ASSETS_THRESHOLD_MB = 260
