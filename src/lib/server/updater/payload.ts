/**
 * Prove an extracted release is a whole Serene Pub for this platform before
 * it may be marked ready (CONTRACT §C5 step 4). The launcher checks the same
 * files again before it swaps anything.
 */
import fs from "node:fs"
import path from "node:path"
import type { ReleaseTarget } from "$lib/server/launcher/launcherEnv"
import { launcherFileFor, payloadAppDir } from "./markers"

export class PayloadError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "PayloadError"
	}
}

/** The files every payload must carry, relative to `<payload>/`. */
export function requiredPayloadFiles(target: ReleaseTarget): string[] {
	const bundleRoot = "serene-pub"
	const app = payloadAppDir(bundleRoot, target)
	const node = target === "windows-x64" ? "node.exe" : "node"
	const files = [
		path.join(app, "build", "index.js"),
		path.join(app, node),
		path.join(app, "package.json")
	]
	const launcher = launcherFileFor(target)
	if (launcher) files.push(path.join(bundleRoot, launcher))
	else files.push(path.join(bundleRoot, "Serene Pub.app", "Contents", "MacOS", "serene-pub"))
	return files
}

/**
 * Throws a `PayloadError` naming what is missing or wrong. Returns the staged
 * app's version (which is also the launcher's — they ship together).
 */
export function verifyPayload(
	payloadDir: string,
	opts: { target: ReleaseTarget; version: string }
): string {
	for (const rel of requiredPayloadFiles(opts.target)) {
		if (!fs.existsSync(path.join(payloadDir, rel)))
			throw new PayloadError(`The update is missing ${rel.split(path.sep).join("/")}, so it was not used.`)
	}
	const pkgPath = path.join(
		payloadAppDir(path.join(payloadDir, "serene-pub"), opts.target),
		"package.json"
	)
	let version: unknown
	try {
		version = JSON.parse(fs.readFileSync(pkgPath, "utf8"))?.version
	} catch {
		throw new PayloadError("The update's package.json is not readable, so it was not used.")
	}
	if (version !== opts.version)
		throw new PayloadError(
			`The update says it is version ${String(version)}, not ${opts.version}, so it was not used.`
		)
	return opts.version
}
