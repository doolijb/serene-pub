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
//     runtime (see the size-audit plan this script implements).
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

/**
 * @param {string} outDir - the dist/<target>/ directory bundle-dist.js just
 *   assembled (already contains build/, static/, node_modules/, drizzle/).
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
	const ortBinRoot = path.join(nm, "onnxruntime-node/bin/napi-v6")
	if (fs.existsSync(ortBinRoot)) {
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
				name === "libonnxruntime_providers_cuda.so" ||
				name === "DirectML.dll" ||
				name === "dxcompiler.dll" ||
				name === "dxil.dll"
		)
	}

	// 3. onnxruntime-web is only reachable via @huggingface/transformers'
	// browser export condition — the Node build always resolves
	// transformers.node.mjs, which uses onnxruntime-node instead. Confirmed
	// zero imports of onnxruntime-web anywhere in src/.
	rm(path.join(nm, "onnxruntime-web"))

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
	// — dist/ (unpkg/CDN target), cjs/, and src/ are never touched.
	const gptTok = path.join(nm, "gpt-tokenizer")
	for (const dir of ["dist", "cjs", "src"]) {
		rm(path.join(gptTok, dir))
	}

	// 6. intl's locale-data is only read by
	// scripts/android-intl-polyfill.cjs, a workaround for nodejs-mobile's
	// intl=none build. Every desktop target runs on full Node with complete
	// ICU built in — this package is never imported outside that polyfill.
	rm(path.join(nm, "intl"))

	// 7. @img/sharp-libvips ships both glibc and musl variants for
	// linux-x64; every currently-built desktop target is glibc.
	rm(path.join(nm, "@img/sharp-libvips-linuxmusl-x64"))

	// 11. SSR sourcemaps: build/client emits none, so this is purely a
	// vite build --ssr asymmetry with no benefit once shipped.
	rmMatching(path.join(outDir, "build/server"), (name) =>
		name.endsWith(".map")
	)

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

// Per-target uncompressed size ceiling for the CI guard (release.yml) —
// set a comfortable margin above the measured post-prune size, not a tight
// tripwire; the point is catching a dependency bump silently reintroducing
// hundreds of MB, not policing byte-level drift. Re-measure and adjust
// after any deliberate, expected size change (e.g. a new bundled feature).
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
export const SIZE_THRESHOLD_MB = {
	"linux-x64": 350,
	"macos-x64": 360,
	"macos-arm64": 360,
	"windows-x64": 360
}
