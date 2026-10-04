#!/usr/bin/env node
// Build the Serene Pub launcher and window helper for one release target.
//
//   node launcher/build.mjs --target <linux-x64|windows-x64|macos-x64|macos-arm64> \
//     --version <package.json version> --channel <portable|prerelease|…> \
//     --commit <sha> --out dist/launcher/<target> [--no-window]
//
// Produces exactly (contract §C7):
//   linux-x64    serene-pub (CGO_ENABLED=0, static)      serene-pub-window (cgo, WebKitGTK 4.1)
//   windows-x64  Serene Pub.exe (CGO_ENABLED=0,          serene-pub-window.exe (cgo/MinGW,
//                -H=windowsgui, icon + version resource)  -H=windowsgui)
//   macos-*      serene-pub (cgo, Cocoa)                  serene-pub-window (cgo, WebKit)
// all with -trimpath -ldflags "-s -w -X main.version/channel/target/commit".
//
// --no-window skips the helper (local boxes without the webview toolchain);
// release CI must never pass it. Packaging (Info.plist, LSUIElement,
// codesign, placement) is Lane C's, in scripts/bundle-dist.js.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))

const TARGETS = {
	"linux-x64": { goos: "linux", goarch: "amd64", launcher: "serene-pub", helper: "serene-pub-window", launcherCgo: false },
	"windows-x64": { goos: "windows", goarch: "amd64", launcher: "Serene Pub.exe", helper: "serene-pub-window.exe", launcherCgo: false },
	"macos-x64": { goos: "darwin", goarch: "amd64", launcher: "serene-pub", helper: "serene-pub-window", launcherCgo: true },
	"macos-arm64": { goos: "darwin", goarch: "arm64", launcher: "serene-pub", helper: "serene-pub-window", launcherCgo: true }
}
const CHANNELS = ["portable", "installer", "dmg", "appimage", "homebrew", "prerelease", "dev"]

function fail(msg) {
	console.error(`launcher/build.mjs: ${msg}`)
	process.exit(1)
}

function parseArgs(argv) {
	const out = { window: true }
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === "--no-window") {
			out.window = false
			continue
		}
		const m = /^--(target|version|channel|commit|out)(?:=(.*))?$/.exec(a)
		if (!m) fail(`unknown argument ${a}`)
		out[m[1]] = m[2] ?? argv[++i]
		if (out[m[1]] === undefined) fail(`--${m[1]} needs a value`)
	}
	return out
}

const args = parseArgs(process.argv.slice(2))
const t = TARGETS[args.target]
if (!t) fail(`--target must be one of ${Object.keys(TARGETS).join(", ")}`)
if (!args.version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(args.version)) fail("--version must be the package.json version")
if (!CHANNELS.includes(args.channel ?? "")) fail(`--channel must be one of ${CHANNELS.join(", ")}`)
if (!args.out) fail("--out is required")
const commit = args.commit ?? ""
const outDir = path.resolve(process.cwd(), args.out)
fs.mkdirSync(outDir, { recursive: true })

const hostGoos = { linux: "linux", win32: "windows", darwin: "darwin" }[process.platform]

function go(goArgs, env, cwd = here) {
	console.log(`$ go ${goArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`)
	const r = spawnSync("go", goArgs, { cwd, env: { ...process.env, ...env }, stdio: "inherit" })
	if (r.error) fail(`could not run go: ${r.error.message}`)
	if (r.status !== 0) fail(`go ${goArgs[0]} failed (exit ${r.status})`)
}

const ldX = [
	`-X main.version=${args.version}`,
	`-X main.channel=${args.channel}`,
	`-X main.target=${args.target}`,
	`-X main.commit=${commit}`
].join(" ")
const baseEnv = { GOOS: t.goos, GOARCH: t.goarch }

// ---- launcher ---------------------------------------------------------------
const syso = path.join(here, "cmd", "serene-pub", `resource_windows_${t.goarch}.syso`)
try {
	if (t.goos === "windows") {
		const [maj, min, pat] = args.version.split(/[.-]/).map((n) => parseInt(n, 10))
		go(
			[
				"tool", "goversioninfo", "-64",
				"-icon", path.join(here, "assets", "icon.ico"),
				"-o", syso,
				"-ver-major", String(maj), "-ver-minor", String(min), "-ver-patch", String(pat), "-ver-build", "0",
				"-product-ver-major", String(maj), "-product-ver-minor", String(min), "-product-ver-patch", String(pat), "-product-ver-build", "0",
				"-file-version", args.version, "-product-version", args.version,
				path.join(here, "cmd", "serene-pub", "versioninfo.json")
			],
			{} // host tool: no GOOS/GOARCH
		)
	}
	const ldflags = `-s -w ${ldX}${t.goos === "windows" ? " -H=windowsgui" : ""}`
	go(["build", "-trimpath", "-ldflags", ldflags, "-o", path.join(outDir, t.launcher), "./cmd/serene-pub"], {
		...baseEnv,
		CGO_ENABLED: t.launcherCgo ? "1" : "0"
	})
} finally {
	fs.rmSync(syso, { force: true })
}

// ---- window helper ----------------------------------------------------------
if (!args.window) {
	console.warn(`launcher/build.mjs: --no-window: ${t.helper} NOT built (release builds must include it)`)
} else {
	if (hostGoos !== t.goos) fail(`the window helper needs cgo and must be built on ${t.goos} (host is ${hostGoos}); pass --no-window to skip it`)
	const env = { ...baseEnv, CGO_ENABLED: "1" }
	if (t.goos === "linux") {
		env.PKG_CONFIG_PATH = [path.join(here, "pkgconfig"), process.env.PKG_CONFIG_PATH].filter(Boolean).join(path.delimiter)
		const probe = spawnSync("pkg-config", ["--exists", "gtk+-3.0", "webkit2gtk-4.0"], { env: { ...process.env, ...env } })
		if (probe.status !== 0) {
			fail("gtk+-3.0 / webkit2gtk-4.1 dev files not found — `sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev`, or pass --no-window")
		}
	}
	const ldflags = `-s -w ${ldX}${t.goos === "windows" ? " -H=windowsgui" : ""}`
	go(["build", "-trimpath", "-tags", "window", "-ldflags", ldflags, "-o", path.join(outDir, t.helper), "./cmd/serene-pub-window"], env)
}

for (const f of [t.launcher, t.helper]) {
	const p = path.join(outDir, f)
	if (fs.existsSync(p)) console.log(`  ${path.relative(process.cwd(), p)}  ${(fs.statSync(p).size / 1048576).toFixed(1)} MB`)
}
