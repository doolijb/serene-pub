// scripts/check-dist-size.js
// CI size guard (release.yml, right after bundle-dist.js runs): fails the
// build if a target's assembled dist/ directory has silently regrown past
// a committed threshold. This dependency profile (onnxruntime, multiple
// tokenizer packages, @huggingface/transformers) is exactly the kind where
// a routine version bump can reintroduce a fat platform binary or a new
// duplicated build variant — the failure mode without this check wouldn't
// be a broken build, just a release that's hundreds of MB bigger with
// nobody noticing. Usage: node scripts/check-dist-size.js <target-name>

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { dirSizeBytes, SIZE_THRESHOLD_MB } from "./prune-dist.js"

import pkg from "../package.json" with { type: "json" }

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const targetName = process.argv[2]
if (!targetName) {
	console.error("Usage: node check-dist-size.js <target-name>")
	process.exit(1)
}

const distDir = path.resolve(
	__dirname,
	"../dist",
	`serene-pub-${pkg.version}-${targetName}`
)
/** Largest immediate children of `dir`, biggest first — diagnostic only. */
function printLargest(dir, limit, label) {
	if (!fs.existsSync(dir)) return
	const rows = fs
		.readdirSync(dir, { withFileTypes: true })
		.map((e) => {
			const p = path.join(dir, e.name)
			// Files as well as directories live here — node_modules contains
			// .package-lock.json — and dirSizeBytes readdir()s unconditionally,
			// so handing it a file throws ENOTDIR. Mirrors dirSizeBytes's own
			// internal branch.
			const bytes = e.isDirectory()
				? dirSizeBytes(p)
				: fs.statSync(p).size
			return { name: e.name, mb: bytes / (1024 * 1024) }
		})
		.sort((a, b) => b.mb - a.mb)
		.slice(0, limit)
	console.error(`\nLargest entries in ${label}:`)
	for (const r of rows) {
		console.error(`  ${r.mb.toFixed(1).padStart(8)} MB  ${r.name}`)
	}
}

const sizeMb = dirSizeBytes(distDir) / (1024 * 1024)
const thresholdMb = SIZE_THRESHOLD_MB[targetName]

console.log(
	`${targetName}: ${sizeMb.toFixed(1)} MB (dist/${path.basename(distDir)})`
)

if (!thresholdMb) {
	console.warn(
		`No size threshold committed for target "${targetName}" in scripts/prune-dist.js — skipping the check.`
	)
	process.exit(0)
}

if (sizeMb > thresholdMb) {
	console.error(
		`ERROR: ${targetName} dist size ${sizeMb.toFixed(1)} MB exceeds the ${thresholdMb} MB threshold.\n` +
			`This usually means a dependency update reintroduced bundled platform binaries or build ` +
			`artifacts that scripts/prune-dist.js used to strip. If this growth is expected, update ` +
			`SIZE_THRESHOLD_MB in scripts/prune-dist.js deliberately rather than ignoring this failure.`
	)
	// Name the culprit rather than leaving the next person to bisect it by
	// hand. This failure is only actionable if you can see WHAT grew, and the
	// dist exists solely on the CI runner — so print the breakdown here, at
	// the one moment it is available.
	printLargest(path.join(distDir, "node_modules"), 15, "node_modules")
	printLargest(distDir, 10, "dist root")
	process.exit(1)
}
