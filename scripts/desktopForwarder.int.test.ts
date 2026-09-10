/**
 * `dist-assets/linux/run.sh` — the desktop forwarder, run as a desktop menu
 * runs it.
 *
 * This file is shipped verbatim (bundle-dist.js copies it to the top of the
 * extracted release) and never compiled, typechecked or linted, so nothing else
 * in the repo would notice it breaking. What it now decides is not cosmetic
 * either: a menu entry launches with `Terminal=false`, so whatever this script
 * concludes is the *only* thing a person sees when a start goes wrong.
 *
 * Everything below is driven through a fake install — a real copy of the real
 * forwarder, a fake `app/run.sh` that behaves like whichever failure is under
 * test, and fake `xdg-open`/`zenity`/`notify-send` on PATH that record being
 * called. Nothing here opens a browser or raises a dialog.
 *
 * The child is spawned with pipes rather than a pty, which is what makes
 * `[ -t 0 ]`/`[ -t 1 ]` false and puts the script on exactly the branch a
 * desktop launch takes.
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
const forwarderSource = path.join(projectRoot, "dist-assets/linux/run.sh")

/** The forwarder is Linux-specific (xdg-open, XDG_DATA_HOME, zenity). */
const onLinux = process.platform === "linux"

let root: string
/** The extracted release: run.sh at the top, app/ underneath. */
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

/** A recorder on PATH, standing in for a desktop program. */
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

/** The fake payload: `app/run.sh` plus the Node runtime the probe uses. */
function writeFakeApp(body: string) {
	const appDir = path.join(installRoot, "app")
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
function writeFakeServer(name: string, source: string) {
	const file = path.join(installRoot, "app", name)
	fs.writeFileSync(file, source)
	return file
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

function runForwarder(env: Record<string, string> = {}) {
	return new Promise<{ code: number; stdout: string; stderr: string }>(
		(resolve) => {
			const child = spawn(path.join(installRoot, "run.sh"), [], {
				cwd: installRoot,
				// Pipes, not a pty: this is the branch a Terminal=false desktop
				// entry takes, and the only one where any of this matters.
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					PATH: `${fakeBin}:${process.env.PATH}`,
					// A session exists, so xdg-open/zenity are considered at all.
					DISPLAY: ":99",
					WAYLAND_DISPLAY: "",
					PORT: String(port),
					SERENE_PUB_DATA_DIR: dataDir,
					SERENE_PUB_NO_PAUSE: "1",
					SERENE_PUB_START_TIMEOUT: "2",
					...env
				}
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

function errorLog(): string | null {
	const file = path.join(dataDir, "serene-pub-last-error.log")
	return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null
}

beforeEach(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-forwarder-"))
	installRoot = path.join(root, "serene-pub")
	dataDir = path.join(root, "SerenePub")
	fakeBin = path.join(root, "bin")
	fs.mkdirSync(installRoot, { recursive: true })
	fs.mkdirSync(dataDir, { recursive: true })
	fs.mkdirSync(fakeBin, { recursive: true })

	const forwarder = path.join(installRoot, "run.sh")
	fs.copyFileSync(forwarderSource, forwarder)
	fs.chmodSync(forwarder, 0o755)

	for (const name of ["xdg-open", "zenity", "notify-send"]) {
		writeFakeCommand(name)
	}

	port = await freePort()
})

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!onLinux)("a start that dies", () => {
	test("leaves a log and a dialog instead of nothing at all", async () => {
		writeFakeApp(
			`echo "Serene Pub - AI Chat Application"
echo "ERROR: Node.js runtime not found at /nope/node" >&2
exit 1`
		)

		const result = await runForwarder()

		// The exit code still travels, which the tee'd pipeline could easily
		// have eaten — a pipeline's own status belongs to tee.
		expect(result.code).toBe(1)
		// And the output still reaches whoever was listening.
		expect(result.stdout).toContain("Serene Pub - AI Chat Application")
		expect(result.stdout).toContain("ERROR: Node.js runtime not found")

		const log = errorLog()
		expect(log).not.toBeNull()
		expect(log).toContain("Serene Pub did not start.")
		expect(log).toContain("the application exited with code 1")
		expect(log).toContain(dataDir)
		expect(log).toContain("docs/troubleshooting.md#database-wont-open")
		// The output the desktop threw away, kept.
		expect(log).toContain("ERROR: Node.js runtime not found")

		// A dead process is serving nothing, so nothing is opened — including
		// on a port some *other* instance might be answering on.
		expect(callsTo("xdg-open")).toEqual([])
		expect(callsTo("zenity").length).toBe(1)
		expect(callsTo("zenity")[0]).toContain("serene-pub-last-error.log")
	})

	test("still leaves the log with the startup watch switched off", async () => {
		writeFakeApp(`exit 1`)

		// SERENE_PUB_START_TIMEOUT=0 is the escape hatch for anyone who does
		// not want a launcher probing a port or opening browsers. It must turn
		// off the watch and nothing else — the failure report is not part of it.
		const result = await runForwarder({ SERENE_PUB_START_TIMEOUT: "0" })

		expect(result.code).toBe(1)
		// Nothing probed, so nothing could have been opened.
		expect(callsTo("xdg-open")).toEqual([])
		expect(errorLog()).toContain("the application exited with code 1")
	})
})

describe.skipIf(!onLinux)("a start that comes up in recovery mode", () => {
	test("opens the recovery page in the browser", async () => {
		writeFakeApp(
			`DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/node" "$DIR/server.cjs"`
		)
		// What the real app serves on /recovery when the database will not
		// open: 503, with the recovery page's own heading in the body.
		writeFakeServer(
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
const opened = ${JSON.stringify(callsFile("xdg-open"))}
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

		const result = await runForwarder({
			SERENE_PUB_START_TIMEOUT: GENEROUS_TIMEOUT
		})

		expect(result.code).toBe(0)
		const opened = callsTo("xdg-open")
		expect(opened).toEqual([`http://localhost:${port}/recovery`])
		// Up and explaining itself is not a failed start.
		expect(errorLog()).toBeNull()
		expect(callsTo("zenity")).toEqual([])
		expect(callsTo("notify-send")).toEqual([])
	})
})

describe.skipIf(!onLinux)("a start that comes up healthy", () => {
	test("opens nothing and reports nothing", async () => {
		writeFakeApp(
			`DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/node" "$DIR/server.cjs"`
		)
		// A healthy instance answers 404 on /recovery — those routes can move a
		// database with no credential, so on a working app they do not exist.
		writeFakeServer(
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

		const result = await runForwarder({
			SERENE_PUB_START_TIMEOUT: GENEROUS_TIMEOUT
		})

		expect(result.code).toBe(0)
		expect(callsTo("xdg-open")).toEqual([])
		expect(callsTo("zenity")).toEqual([])
		expect(errorLog()).toBeNull()
	})
})

describe.skipIf(!onLinux)("a start where nothing ever listens", () => {
	test("reports it at the deadline, without waiting for the app to end", async () => {
		// Alive, silent, and outliving the deadline — the shape a launcher used
		// to show absolutely nothing for.
		writeFakeApp(`sleep 6`)

		const result = await runForwarder()

		expect(result.code).toBe(0)
		const log = errorLog()
		expect(log).not.toBeNull()
		expect(log).toContain(`nothing was listening on port ${port} after 2s`)
		expect(callsTo("zenity").length).toBe(1)
		expect(callsTo("xdg-open")).toEqual([])
	})

	test("does not cry wolf while a long migration holds the port open", async () => {
		writeFakeApp(
			`DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/node" "$DIR/server.cjs"`
		)
		// Listening from the first moment and answering nothing, which is
		// exactly what an upgrade running migrations looks like: hooks.server.ts
		// awaits `appReady` before it answers anything at all.
		writeFakeServer(
			"server.cjs",
			`const http = require("http")
const server = http.createServer(() => {})
server.listen(${port}, "127.0.0.1")
setTimeout(() => process.exit(0), 9000)
`
		)

		// A shorter deadline than the other cases, because every probe against
		// a listener that never answers costs the script's own 2s request
		// timeout — three of those plus the deadline is most of this test's
		// wall clock, and none of it is what is being asserted.
		const result = await runForwarder({ SERENE_PUB_START_TIMEOUT: "1" })

		expect(result.code).toBe(0)
		// "Still waiting", not "did not start". A false alarm here would fire on
		// every upgrade whose migrations take longer than the deadline.
		expect(result.stderr).toContain("taking longer than 1s")
		expect(errorLog()).toBeNull()
		expect(callsTo("zenity")).toEqual([])
		expect(callsTo("xdg-open")).toEqual([])
	})
})
