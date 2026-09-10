/**
 * `dist-assets/macos/run.sh` — the desktop forwarder, driven through the entry
 * point a Dock or Finder launch actually uses.
 *
 * The bundle's declared executable is
 * `Serene Pub.app/Contents/MacOS/serene-pub` (Info.plist's
 * CFBundleExecutable), and it used to exec the payload's bare `app/run.sh`
 * directly — so a double-click got none of the forwarder's startup watch, on
 * the one launch path that has no terminal to fall back on. It now execs the
 * forwarder's own copy at `Contents/Resources/run.sh`, which
 * scripts/bundle-dist.js puts there from `dist-assets/macos/run.sh` so there is
 * only ever one launcher text to keep true.
 *
 * Everything below is driven through a fake bundle — real copies of both of
 * those files, a fake `app/run.sh` that behaves like whichever failure is under
 * test, and fake `open`/`osascript` on PATH that record being called. Nothing
 * here opens a browser or raises a dialog.
 *
 * The child is spawned with pipes and from `/`, which is what makes
 * `[ -t 0 ]`/`[ -t 1 ]` false and leaves the script nothing but its own path to
 * find the payload with — the position LaunchServices puts it in.
 *
 * ⚠ Runs on Linux, against the real macOS script text. What it cannot check is
 * anything only a Mac does: that LaunchServices runs CFBundleExecutable at all,
 * that the real /usr/bin/open reaches the default browser, or that Gatekeeper
 * lets an unsigned bundle start.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { spawn } from "node:child_process"
import net from "node:net"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const projectRoot = fileURLToPath(new URL("..", import.meta.url))
const macosAssets = path.join(projectRoot, "dist-assets/macos")
const forwarderSource = path.join(macosAssets, "run.sh")
const bundleExecutableSource = path.join(
	macosAssets,
	"Serene Pub.app/Contents/MacOS/serene-pub"
)

/**
 * The scripts are POSIX sh and bash, and every macOS-only program they reach
 * for (`open`, `osascript`) is faked on PATH, so this runs unchanged on Linux.
 * Windows has neither shell.
 */
const onPosix = process.platform === "linux" || process.platform === "darwin"

const BUNDLE_NAME = "Serene Pub.app"

let root: string
/** The extracted release: run.sh at the top, "Serene Pub.app" beside it. */
let installRoot: string
let dataDir: string
let fakeBin: string
let port: number

/** A port nothing is on, taken and released so the forwarder can watch it. */
async function freePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = net.createServer()
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => {
			const address = server.address()
			if (typeof address === "string" || address === null) {
				reject(new Error("no port"))
				return
			}
			const found = address.port
			server.close(() => resolve(found))
		})
	})
}

/** A recorder on PATH, standing in for a macOS program. */
function writeFakeCommand(name: string) {
	const script = path.join(fakeBin, name)
	const record = path.join(root, `${name}.calls`)
	fs.writeFileSync(
		script,
		`#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(record)}\n`
	)
	fs.chmodSync(script, 0o755)
}

/** Where a fake command records its calls. */
function callsFile(name: string): string {
	return path.join(root, `${name}.calls`)
}

function callsTo(name: string): string[] {
	const record = callsFile(name)
	if (!fs.existsSync(record)) return []
	return fs.readFileSync(record, "utf-8").split("\n").filter(Boolean)
}

function copyExecutable(src: string, dest: string) {
	fs.copyFileSync(src, dest)
	fs.chmodSync(dest, 0o755)
}

/**
 * The bundle as scripts/bundle-dist.js assembles it: the stub at
 * Contents/MacOS/serene-pub, and the forwarder's own copy beside the payload at
 * Contents/Resources/run.sh. Returns the Resources directory, which is where
 * the payload goes.
 */
function writeBundle(intoDir: string): string {
	const contents = path.join(intoDir, BUNDLE_NAME, "Contents")
	const macOSDir = path.join(contents, "MacOS")
	const resources = path.join(contents, "Resources")
	fs.mkdirSync(macOSDir, { recursive: true })
	fs.mkdirSync(resources, { recursive: true })
	copyExecutable(bundleExecutableSource, path.join(macOSDir, "serene-pub"))
	copyExecutable(forwarderSource, path.join(resources, "run.sh"))
	return resources
}

/** What LaunchServices runs: Info.plist's CFBundleExecutable. */
function dockEntry(intoDir: string): string {
	return path.join(intoDir, BUNDLE_NAME, "Contents", "MacOS", "serene-pub")
}

/** The fake payload: `app/run.sh` plus the Node runtime the probe uses. */
function writeFakeApp(resources: string, body: string) {
	const appDir = path.join(resources, "app")
	fs.mkdirSync(appDir, { recursive: true })
	// The forwarder probes the port with the runtime that ships beside the app.
	fs.symlinkSync(process.execPath, path.join(appDir, "node"))
	const runScript = path.join(appDir, "run.sh")
	fs.writeFileSync(runScript, `#!/bin/sh\n${body}\n`)
	fs.chmodSync(runScript, 0o755)
}

/**
 * A fake server, as a CommonJS file rather than `node -e` so no assumption
 * about the default module system is baked into the test.
 */
function writeFakeServer(resources: string, name: string, source: string) {
	fs.writeFileSync(path.join(resources, "app", name), source)
}

/**
 * The startup deadline, for the cases where the app is EXPECTED to come up.
 *
 * Generous on purpose. The watch stops the moment it sees the server, so a
 * large deadline costs a passing run nothing — while a small one is a
 * wall-clock race the launcher wins by reporting "did not start" about an app
 * that was merely slow. Every probe is a fresh node process, and under a
 * parallel suite three of those do not fit in two seconds. The deadline is
 * only under test in the one case that asserts it fires.
 */
const GENEROUS_TIMEOUT = "15"

/** The two lines every fake payload that has to listen begins with. */
const EXEC_FAKE_SERVER = `DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/node" "$DIR/server.cjs"`

/** A null override deletes the variable rather than setting it to "null". */
function runEntry(entry: string, env: Record<string, string | null> = {}) {
	const childEnv: Record<string, string> = {
		...(process.env as Record<string, string>),
		PATH: `${fakeBin}:${process.env.PATH}`,
		// Contained on purpose: the forwarder's last-resort data directory is
		// "$HOME/Library/Application Support/SerenePub", and no test may create
		// that in the developer's real home.
		HOME: root,
		PORT: String(port),
		SERENE_PUB_DATA_DIR: dataDir,
		SERENE_PUB_NO_PAUSE: "1",
		SERENE_PUB_START_TIMEOUT: "2"
	}
	for (const [key, value] of Object.entries(env)) {
		if (value === null) delete childEnv[key]
		else childEnv[key] = value
	}
	return new Promise<{ code: number; stdout: string; stderr: string }>(
		(resolve) => {
			const child = spawn(entry, [], {
				// Finder launches with the working directory at "/": the
				// script has nothing but its own path to locate the payload.
				cwd: "/",
				// Pipes, not a pty — the branch a Dock launch takes, and the
				// only one where any of this matters.
				stdio: ["ignore", "pipe", "pipe"],
				env: childEnv
			})
			let stdout = ""
			let stderr = ""
			child.stdout.on("data", (c) => (stdout += c))
			child.stderr.on("data", (c) => (stderr += c))
			child.once("exit", (code) =>
				resolve({ code: code ?? -1, stdout, stderr })
			)
		}
	)
}

function errorLog(dir: string = dataDir): string | null {
	const file = path.join(dir, "serene-pub-last-error.log")
	return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null
}

beforeEach(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-forwarder-macos-"))
	installRoot = path.join(root, "serene-pub")
	dataDir = path.join(root, "SerenePub")
	fakeBin = path.join(root, "bin")
	fs.mkdirSync(installRoot, { recursive: true })
	fs.mkdirSync(dataDir, { recursive: true })
	fs.mkdirSync(fakeBin, { recursive: true })

	// The terminal copy, at the top of the extracted folder.
	copyExecutable(forwarderSource, path.join(installRoot, "run.sh"))

	for (const name of ["open", "osascript"]) {
		writeFakeCommand(name)
	}

	port = await freePort()
})

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!onPosix)(
	"a Dock launch that comes up in recovery mode",
	() => {
		test("opens the recovery page in the browser", async () => {
			const resources = writeBundle(installRoot)
			writeFakeApp(resources, EXEC_FAKE_SERVER)
			// What the real app serves on /recovery when the database will not
			// open: 503, with the recovery page's own heading in the body.
			writeFakeServer(
				resources,
				"server.cjs",
				`const http = require("http")
const fs = require("fs")
const server = http.createServer((req, res) => {
	res.writeHead(503, { "content-type": "text/html; charset=utf-8" })
	res.end("<h1>Serene Pub could not open its database.</h1>")
})
server.listen(${port}, "127.0.0.1")
// Up until the launcher has actually opened the browser, then down so the
// run can end — a wait on the outcome rather than on a clock. Closing after
// the first request instead looked tidier and was wrong: a probe whose fetch
// aborts mid-answer (its own timeout is 2s, and a saturated machine reaches
// it) has to be able to ask again, and there was nothing left to ask.
const opened = ${JSON.stringify(callsFile("open"))}
const stop = () => {
	clearInterval(poll)
	server.close()
}
const poll = setInterval(() => {
	if (fs.existsSync(opened)) stop()
}, 200)
setTimeout(stop, 20000).unref()
`
			)

			const result = await runEntry(dockEntry(installRoot), {
				SERENE_PUB_START_TIMEOUT: GENEROUS_TIMEOUT
			})

			expect(result.code).toBe(0)
			expect(callsTo("open")).toEqual([
				`http://localhost:${port}/recovery`
			])
			// Up and explaining itself is not a failed start.
			expect(errorLog()).toBeNull()
			// A dialog would be a Finder consent prompt on top of a bad day, and
			// the browser is already showing the page that can fix it.
			expect(callsTo("osascript")).toEqual([])
		})
	}
)

describe.skipIf(!onPosix)("a Dock launch that dies", () => {
	test("leaves a log instead of nothing at all", async () => {
		const resources = writeBundle(installRoot)
		writeFakeApp(
			resources,
			`echo "Serene Pub - AI Chat Application"
echo "ERROR: Node.js runtime not found at /nope/node" >&2
exit 1`
		)

		const result = await runEntry(dockEntry(installRoot))

		// The exit code still travels, which the tee'd pipeline could easily
		// have eaten — a pipeline's own status belongs to tee.
		expect(result.code).toBe(1)
		expect(result.stdout).toContain("Serene Pub - AI Chat Application")

		const log = errorLog()
		expect(log).not.toBeNull()
		expect(log).toContain("Serene Pub did not start.")
		expect(log).toContain("the application exited with code 1")
		expect(log).toContain(dataDir)
		expect(log).toContain("docs/troubleshooting.md#database-wont-open")
		// The output the Dock threw away, kept.
		expect(log).toContain("ERROR: Node.js runtime not found")

		// A dead process is serving nothing, so nothing is opened — including
		// on a port some *other* instance might be answering on.
		expect(callsTo("open")).toEqual([])
		expect(callsTo("osascript")).toEqual([])
	})

	test("reports a start where nothing ever listens, at the deadline", async () => {
		const resources = writeBundle(installRoot)
		// Alive, silent, and outliving the deadline — the shape a Dock launch
		// used to show absolutely nothing for. It has to outlive it by a
		// margin rather than by a hair: the watch is killed when the app ends,
		// and reaching a 2s deadline costs two sleeps plus three probe
		// processes, which is most of six seconds on a loaded machine.
		writeFakeApp(resources, `sleep 12`)

		const result = await runEntry(dockEntry(installRoot))

		expect(result.code).toBe(0)
		expect(errorLog()).toContain(
			`nothing was listening on port ${port} after 2s`
		)
		expect(callsTo("open")).toEqual([])
	})
})

describe.skipIf(!onPosix)("a Dock launch that comes up healthy", () => {
	test("opens nothing and reports nothing", async () => {
		const resources = writeBundle(installRoot)
		writeFakeApp(resources, EXEC_FAKE_SERVER)
		// A healthy instance answers 404 on /recovery — those routes can move a
		// database with no credential, so on a working app they do not exist.
		writeFakeServer(
			resources,
			"server.cjs",
			`const http = require("http")
const server = http.createServer((req, res) => {
	res.writeHead(404, { "content-type": "text/plain" })
	res.end("Not Found\\n")
	server.close()
})
server.listen(${port}, "127.0.0.1")
setTimeout(() => server.close(), 20000).unref()
`
		)

		const result = await runEntry(dockEntry(installRoot), {
			SERENE_PUB_START_TIMEOUT: GENEROUS_TIMEOUT
		})

		expect(result.code).toBe(0)
		expect(callsTo("open")).toEqual([])
		expect(callsTo("osascript")).toEqual([])
		expect(errorLog()).toBeNull()
	})
})

describe.skipIf(!onPosix)("the same script, from the extracted folder", () => {
	test("still finds the payload inside the bundle beside it", async () => {
		const resources = writeBundle(installRoot)
		writeFakeApp(resources, `exit 1`)

		// The terminal path: serene-pub/run.sh, which has to reach the payload
		// through the .app. One text serves both placements, so this is the
		// regression guard on the other half of it.
		const result = await runEntry(path.join(installRoot, "run.sh"))

		expect(result.code).toBe(1)
		expect(errorLog()).toContain("the application exited with code 1")
	})

	test("agrees with the Dock launch about where the install root is", async () => {
		const resources = writeBundle(installRoot)
		writeFakeApp(resources, `exit 1`)
		// The one setting that can only live at the top of the extracted
		// folder, since the other .env lives inside the directory it names.
		fs.writeFileSync(
			path.join(installRoot, ".env"),
			"SERENE_PUB_DATA_DIR=./mydata\n"
		)

		const result = await runEntry(dockEntry(installRoot), {
			SERENE_PUB_DATA_DIR: null
		})

		expect(result.code).toBe(1)
		// Relative to the extracted folder, not to the working directory and
		// not to anywhere inside the bundle an update replaces.
		expect(errorLog(path.join(installRoot, "mydata"))).toContain(
			"the application exited with code 1"
		)
	})
})

describe.skipIf(!onPosix)("the handover from CFBundleExecutable", () => {
	test("does not need the launcher's executable bit", async () => {
		const resources = writeBundle(installRoot)
		writeFakeApp(resources, `exit 1`)
		// An extractor that drops permissions, or a copy made by something
		// that does. The stub reaching for the bare entrypoint here would be
		// the worst outcome available: a Dock launch that starts, looks fine,
		// and has quietly lost the startup watch this whole file is about.
		fs.chmodSync(path.join(resources, "run.sh"), 0o644)

		const result = await runEntry(dockEntry(installRoot))

		expect(result.code).toBe(1)
		expect(errorLog()).toContain("the application exited with code 1")
	})

	test("falls back to the bare entrypoint when there is no launcher", async () => {
		const resources = writeBundle(installRoot)
		writeFakeApp(resources, `echo started; exit 3`)
		// A bundle assembled by hand, or by a build from before the launcher
		// was placed inside it. Starting the server without a startup watch
		// beats not starting at all.
		fs.rmSync(path.join(resources, "run.sh"))

		const result = await runEntry(dockEntry(installRoot))

		expect(result.code).toBe(3)
		expect(result.stdout).toContain("started")
		// Nothing watched, so there is nothing to report — which is exactly
		// the old behaviour, and why it is only ever the fallback.
		expect(errorLog()).toBeNull()
	})
})

describe.skipIf(!onPosix)("a bundle on its own in /Applications", () => {
	test("still runs, and claims no install root outside itself", async () => {
		// Dragged out of the extracted folder: no sibling run.sh, and a
		// directory full of other people's applications around it.
		const applications = path.join(root, "Applications")
		fs.mkdirSync(applications, { recursive: true })
		const resources = writeBundle(applications)
		writeFakeApp(resources, `exit 1`)
		// A stray .env belonging to something else entirely. Treating the
		// folder a .app happens to sit in as an install root would read it.
		fs.writeFileSync(
			path.join(applications, ".env"),
			"SERENE_PUB_DATA_DIR=./stray\n"
		)

		const result = await runEntry(dockEntry(applications), {
			SERENE_PUB_DATA_DIR: null
		})

		expect(result.code).toBe(1)
		expect(errorLog(path.join(applications, "stray"))).toBeNull()
		// The platform default, which is what the app itself will use too.
		expect(
			errorLog(path.join(root, "Library/Application Support/SerenePub"))
		).toContain("the application exited with code 1")
	})
})
