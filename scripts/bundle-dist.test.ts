/**
 * placeDarwinForwarder is the darwin branch of bundle-dist.js's main(),
 * pulled into its own export (see bundle-dist.js) so this can call it
 * directly instead of spawning the whole build — license check, full
 * node_modules/build copy, pruning — just to reach one
 * `if (target.platform === "darwin")`.
 *
 * The fixture below is a minimal fake of the two things the real script has
 * already assembled by the time that branch runs: dist-assets/macos/run.sh
 * (the forwarder text) and the .app skeleton with its CFBundleExecutable stub
 * already copied in by the platform-loop above the darwin branch.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { placeDarwinForwarder } from "./bundle-dist.js"
import { appDir, bundleRootDir, MACOS_APP_BUNDLE_NAME } from "./dist-layout.js"

let tempRoot: string
let platformDir: string
let sourceRunSh: string
let bundleRoot: string
let payloadDir: string
let bundleExecutable: string

beforeEach(() => {
	tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sp-bundle-dist-"))

	platformDir = path.join(tempRoot, "dist-assets/macos")
	fs.mkdirSync(platformDir, { recursive: true })
	sourceRunSh = path.join(platformDir, "run.sh")
	fs.writeFileSync(sourceRunSh, "#!/bin/sh\necho fake forwarder\n")
	// Not executable to start — placeDarwinForwarder is what is supposed to
	// make the placed copy 755, not whatever mode the source happened to have.
	fs.chmodSync(sourceRunSh, 0o644)

	const stageDir = path.join(tempRoot, "dist", "serene-pub-0.0.0-macos-x64")
	bundleRoot = bundleRootDir(stageDir)
	payloadDir = appDir(stageDir, "macos-x64")
	// bundle-dist.js's main() creates payloadDir before the platform-loop
	// runs, and the darwin branch relies on it (its parent is Contents/Resources).
	fs.mkdirSync(payloadDir, { recursive: true })

	// The CFBundleExecutable stub, as the platform-loop above the darwin
	// branch would already have copied it in — left not-executable, the way a
	// checkout that lost the bit (the exact case the comment beside the real
	// chmodSync call names) would leave it.
	bundleExecutable = path.join(
		bundleRoot,
		MACOS_APP_BUNDLE_NAME,
		"Contents",
		"MacOS",
		"serene-pub"
	)
	fs.mkdirSync(path.dirname(bundleExecutable), { recursive: true })
	fs.writeFileSync(bundleExecutable, "#!/bin/sh\nexec ./run.sh\n")
	fs.chmodSync(bundleExecutable, 0o644)
})

afterEach(() => {
	fs.rmSync(tempRoot, { recursive: true, force: true })
})

function placedRunSh(): string {
	return path.join(
		bundleRoot,
		MACOS_APP_BUNDLE_NAME,
		"Contents",
		"Resources",
		"run.sh"
	)
}

describe("placeDarwinForwarder", () => {
	test("copies the forwarder beside the payload as 755, and makes the CFBundleExecutable stub executable", () => {
		placeDarwinForwarder({ platformDir, bundleRoot, payloadDir })

		const dest = placedRunSh()
		expect(fs.existsSync(dest)).toBe(true)
		expect(fs.statSync(dest).mode & 0o777).toBe(0o755)
		expect(fs.readFileSync(dest)).toEqual(fs.readFileSync(sourceRunSh))

		expect(fs.statSync(bundleExecutable).mode & 0o777).toBe(0o755)
	})
})
