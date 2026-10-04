/**
 * Update staging: its names, its markers and its boot cleanup (CONTRACT §C1,
 * §C5).
 *
 * Update staging is the launcher's folder inside the install root
 * (`SERENE_PUB_UPDATE_DIR`). This server writes `download.part`,
 * `<tag>.extracting/`, `<tag>/`, the ready marker (`READY.json`) and the apply
 * marker (`APPLY`). The launcher writes the swap journal (`SWAP.json`),
 * `previous/` and `failed/` — this side never touches those.
 *
 * Always "update staging", never bare "staging": the SillyTavern import has
 * a staging directory of its own (NOMENCLATURE §16).
 */
import fs from "node:fs"
import path from "node:path"
import type { ReleaseTarget } from "$lib/server/launcher/launcherEnv"

/** A release tag both sides accept; anything else is refused (§C5). */
export const TAG_RE = /^v?\d+\.\d+\.\d+(-[a-z0-9]+(-\d+)?)?$/

export const DOWNLOAD_PART = "download.part"
export const READY_MARKER = "READY.json"
export const APPLY_MARKER = "APPLY"
export const SWAP_JOURNAL = "SWAP.json"
export const EXTRACTING_SUFFIX = ".extracting"

export interface ReadyMarker {
	schema: 1
	tag: string
	version: string
	fromVersion: string
	target: string
	channel: string
	launcherVersion: string
	payload: string
	asset: { name: string; url: string; size: number; sha256: string }
	stagedAt: string
}

export interface ApplyMarker {
	schema: 1
	tag: string
	requestedAt: string
	requestedBy: number | null
}

/** `v0.6.1` → `0.6.1`. */
export function versionOfTag(tag: string): string {
	return tag.replace(/^v/, "")
}

/** `serene-pub-<tag>-<target>.zip` (§C12). */
export function assetNameFor(tag: string, target: ReleaseTarget): string {
	return `serene-pub-${tag}-${target}.zip`
}

/** The launcher executable at the root of an extracted zip; null on macOS. */
export function launcherFileFor(target: ReleaseTarget): string | null {
	if (target === "windows-x64") return "Serene Pub.exe"
	if (target === "linux-x64") return "serene-pub"
	return null
}

/** The `app/` folder inside the extracted `serene-pub/`, per target (§C1). */
export function payloadAppDir(bundleRoot: string, target: ReleaseTarget): string {
	if (target === "macos-x64" || target === "macos-arm64")
		return path.join(bundleRoot, "Serene Pub.app", "Contents", "Resources", "app")
	return path.join(bundleRoot, "app")
}

/** JSON, written to a temp file and renamed into place. */
export function writeJsonAtomic(file: string, value: unknown): void {
	const tmp = `${file}.${process.pid}.tmp`
	const fd = fs.openSync(tmp, "w", 0o644)
	try {
		fs.writeFileSync(fd, JSON.stringify(value, null, "\t") + "\n")
		fs.fsyncSync(fd)
	} finally {
		fs.closeSync(fd)
	}
	fs.renameSync(tmp, file)
}

export function readJsonFile<T>(file: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T
	} catch {
		return null
	}
}

/** The ready marker, when it is present and well-formed. */
export function readReadyMarker(stagingDir: string): ReadyMarker | null {
	const ready = readJsonFile<ReadyMarker>(path.join(stagingDir, READY_MARKER))
	if (!ready || ready.schema !== 1 || typeof ready.tag !== "string") return null
	if (!TAG_RE.test(ready.tag)) return null
	return ready
}

export function hasSwapJournal(stagingDir: string): boolean {
	return fs.existsSync(path.join(stagingDir, SWAP_JOURNAL))
}

/**
 * What a boot leaves behind: a half-downloaded zip and any half-extracted
 * folder are deleted. A ready marker without an apply marker is kept — the
 * Admin › Updates section offers Apply or Discard for it. The swap journal,
 * `previous/` and `failed/` belong to the launcher and are never touched.
 */
export function cleanupStagingAtBoot(stagingDir: string): string[] {
	const removed: string[] = []
	let names: string[]
	try {
		names = fs.readdirSync(stagingDir)
	} catch {
		return removed
	}
	for (const name of names) {
		if (name === DOWNLOAD_PART || name.endsWith(EXTRACTING_SUFFIX)) {
			fs.rmSync(path.join(stagingDir, name), { recursive: true, force: true })
			removed.push(name)
		}
	}
	return removed
}
