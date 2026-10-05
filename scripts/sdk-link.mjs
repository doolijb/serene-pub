#!/usr/bin/env node
// scripts/sdk-link.mjs — develop the app against a local SDK checkout.
//
//   npm run sdk:link      node_modules/@serene-pub/<pkg> → symlinks to ../serene-pub-sdk/<pkg>
//   npm run sdk:unlink    removes those symlinks; the next `npm install` puts
//                         the published copies back
//
// package.json pins every @serene-pub/* package to the exact version published
// on npm, which is what CI, Docker and every release install. Linking swaps the
// installed copies in node_modules for symlinks to the sibling checkout, the
// same links the old `file:` dependencies made, without touching package.json.
// Linked packages resolve to their `main`/`exports`, i.e. the SDK's built
// `dist/`: run `npm run sdk:build` after an SDK change, as before.
//
// npm counts a link as installed while the checkout's version matches the pin,
// so a plain `npm install` keeps it; once the versions differ, `npm install`
// replaces it with the published copy. Unlink first to go back on purpose.
// Set SERENE_PUB_SDK_DIR to link a checkout somewhere else.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sdkRoot = path.resolve(
	appRoot,
	process.env.SERENE_PUB_SDK_DIR || "../serene-pub-sdk"
)
const scopeDir = path.join(appRoot, "node_modules", "@serene-pub")
const unlink = process.argv.includes("--unlink")

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"))
const pkg = readJson(path.join(appRoot, "package.json"))

/** Every @serene-pub/* package the app declares, with the version it pins. */
const declared = []
for (const field of ["dependencies", "devDependencies"])
	for (const [name, spec] of Object.entries(pkg[field] ?? {}))
		if (name.startsWith("@serene-pub/"))
			declared.push({
				name,
				dir: name.slice("@serene-pub/".length),
				spec
			})

/** Where node_modules/@serene-pub/<dir> points, or null when it is not a link. */
function linkTarget(dir) {
	try {
		const p = path.join(scopeDir, dir)
		if (!fs.lstatSync(p).isSymbolicLink()) return null
		return path.resolve(path.dirname(p), fs.readlinkSync(p))
	} catch {
		return null
	}
}

/** Remove a symlink or (Windows) junction itself, never what it points at. */
function removeLink(p) {
	try {
		fs.unlinkSync(p)
	} catch (err) {
		if (process.platform !== "win32") throw err
		fs.rmdirSync(p) // a directory junction
	}
}

if (unlink) {
	const linked = declared.filter((d) => linkTarget(d.dir))
	if (!linked.length) {
		console.log(
			"sdk:unlink: no @serene-pub package is linked; node_modules already holds installed copies."
		)
	} else {
		// Only the links go; the checkout they point at is never touched.
		for (const d of linked) {
			console.log(`  ${d.name}  unlinked (was → ${linkTarget(d.dir)})`)
			removeLink(path.join(scopeDir, d.dir))
		}
	}
	console.log(
		"Run `npm install` to install the published copies package.json pins (it needs the npm registry)."
	)
	process.exit(0)
}

if (!fs.existsSync(path.join(sdkRoot, "package.json"))) {
	console.error(
		`sdk:link: no SDK checkout at ${sdkRoot}. Clone it beside this repo, or set SERENE_PUB_SDK_DIR.`
	)
	process.exit(1)
}
if (!fs.existsSync(path.join(appRoot, "node_modules"))) {
	console.error(
		"sdk:link: node_modules is missing. Run `npm install` first, then link."
	)
	process.exit(1)
}

fs.mkdirSync(scopeDir, { recursive: true })
const mismatched = []
let failed = false
for (const d of declared) {
	const source = path.join(sdkRoot, d.dir)
	const sourcePkg = path.join(source, "package.json")
	if (!fs.existsSync(sourcePkg) || readJson(sourcePkg).name !== d.name) {
		console.error(`sdk:link: ${d.name} is not at ${source}`)
		failed = true
		continue
	}
	const sdkVersion = readJson(sourcePkg).version
	if (sdkVersion !== d.spec)
		mismatched.push(
			`${d.name}: package.json pins ${d.spec}, the checkout is ${sdkVersion}`
		)

	const dest = path.join(scopeDir, d.dir)
	if (linkTarget(d.dir) === source) {
		console.log(`  ${d.name}  already linked`)
		continue
	}
	fs.rmSync(dest, { recursive: true, force: true })
	// Relative, like the links npm made for `file:` dependencies; Windows gets a
	// junction (no admin rights or developer mode needed), which must be absolute.
	if (process.platform === "win32") fs.symlinkSync(source, dest, "junction")
	else fs.symlinkSync(path.relative(scopeDir, source), dest, "dir")
	console.log(`  ${d.name}  → ${path.relative(appRoot, source)}`)
}

// A copy nested under another package would be a second SDK beside the link.
const nested = []
for (const entry of fs.existsSync(scopeDir) ? fs.readdirSync(scopeDir) : []) {
	const inner = path.join(scopeDir, entry, "node_modules", "@serene-pub")
	if (!linkTarget(entry) && fs.existsSync(inner))
		nested.push(
			`node_modules/@serene-pub/${entry}/node_modules/@serene-pub`
		)
}

if (mismatched.length) {
	console.warn(
		"\nsdk:link: WARNING: the SDK checkout's version differs from what package.json pins:"
	)
	for (const m of mismatched) console.warn(`  ${m}`)
	console.warn(
		"CI and releases install the pinned version, not your checkout. Bump the pins when the SDK is published."
	)
}
if (nested.length) {
	console.warn(
		"\nsdk:link: WARNING: installed packages still carry their own SDK copies:"
	)
	for (const n of nested) console.warn(`  ${n}`)
}
if (failed) process.exit(1)
console.log(
	"\nLinked. The app now runs the SDK's built dist/: `npm run sdk:build` after SDK changes" +
		" (stop the dev server first). `npm run sdk:unlink`, then `npm install`, goes back to the published copies."
)
