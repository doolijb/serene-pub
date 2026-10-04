/**
 * What the launcher told this process when it spawned it, and whether this
 * process may offer an in-app update at all (plan resilient-exploring-tome,
 * CONTRACT §C6 and §C11).
 *
 * The launcher passes everything through the environment; nothing here reads
 * a file. A server started by the bare entrypoint (`app/run.sh`) has none of
 * the `SERENE_PUB_*` launcher variables, which is exactly how the gate below
 * tells "started without the launcher" apart.
 *
 * Pure apart from the `exists` default: every input is a parameter so the
 * gating matrix is testable without touching the real environment.
 */
import fs from "node:fs"
import path from "node:path"
import { isPrereleaseVersion } from "$lib/shared/utils/releaseChannel"

/** The update channels the launcher can bake in (§C11). */
export type UpdateChannel =
	| "portable"
	| "installer"
	| "dmg"
	| "appimage"
	| "homebrew"
	| "prerelease"
	| "dev"

/** The release targets, as they appear in asset names (§C7, §C12). */
export type ReleaseTarget = "linux-x64" | "windows-x64" | "macos-x64" | "macos-arm64"

export const RELEASE_TARGETS: readonly ReleaseTarget[] = [
	"linux-x64",
	"windows-x64",
	"macos-x64",
	"macos-arm64"
]

/** Channels whose install can be updated by swapping the swap unit (§C11). */
export const IN_APP_UPDATE_CHANNELS: readonly string[] = [
	"portable",
	"installer",
	"dmg"
]

export interface LauncherEnv {
	/** `SERENE_PUB_LAUNCHER_VERSION`; null on a bare start. */
	launcherVersion: string | null
	/** `SERENE_PUB_UPDATE_CHANNEL`; null on a bare start. */
	channel: string | null
	/** `SERENE_PUB_TARGET`; null on a bare start. */
	target: string | null
	/** `SERENE_PUB_UPDATE_DIR`, absolute; null on a bare start. */
	updateDir: string | null
	/** `SERENE_PUB_INSTALL_ROOT`, absolute; set by the launcher and the bare entrypoint. */
	installRoot: string | null
}

function nonEmpty(value: string | undefined): string | null {
	const v = value?.trim()
	return v ? v : null
}

export function readLauncherEnv(
	env: NodeJS.ProcessEnv = process.env
): LauncherEnv {
	const updateDir = nonEmpty(env.SERENE_PUB_UPDATE_DIR)
	const installRoot = nonEmpty(env.SERENE_PUB_INSTALL_ROOT)
	return {
		launcherVersion: nonEmpty(env.SERENE_PUB_LAUNCHER_VERSION),
		channel: nonEmpty(env.SERENE_PUB_UPDATE_CHANNEL),
		target: nonEmpty(env.SERENE_PUB_TARGET),
		updateDir: updateDir ? path.resolve(updateDir) : null,
		installRoot: installRoot ? path.resolve(installRoot) : null
	}
}

/** `/.dockerenv` (Docker) or `/run/.containerenv` (Podman). */
export function isInContainer(
	exists: (p: string) => boolean = fs.existsSync
): boolean {
	return ["/.dockerenv", "/run/.containerenv"].some((f) => exists(f))
}

/** The `process.platform`/`process.arch` pair a target is built for. */
export function targetFor(
	platform: NodeJS.Platform,
	arch: string
): ReleaseTarget | null {
	if (arch !== "x64" && arch !== "arm64") return null
	if (platform === "linux" && arch === "x64") return "linux-x64"
	if (platform === "win32" && arch === "x64") return "windows-x64"
	if (platform === "darwin") return arch === "arm64" ? "macos-arm64" : "macos-x64"
	return null
}

/** Whether `child` is `parent` or somewhere beneath it. Both absolute. */
export function isInside(parent: string, child: string): boolean {
	const rel = path.relative(parent, child)
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/**
 * Why an in-app update is not offered. Each one maps to a sentence the Admin
 * › Updates section shows, so the admin learns what to do instead.
 */
export type InAppUpdateRefusal =
	| "prerelease"
	| "android"
	| "container"
	| "no-launcher"
	| "channel"
	| "target"
	| "staging"

export type InAppUpdateGate =
	| { allowed: true; env: LauncherEnv & { target: ReleaseTarget; channel: string; updateDir: string; installRoot: string; launcherVersion: string } }
	| { allowed: false; reason: InAppUpdateRefusal; message: string }

export const REFUSAL_MESSAGES: Record<InAppUpdateRefusal, string> = {
	prerelease:
		"This is a pre-release build. Pre-releases never update themselves — download the next build from the releases page.",
	android:
		"The Android app is updated through the app itself, not from here.",
	container:
		"Serene Pub is running in a container. Pull the new image and recreate the container to update.",
	"no-launcher":
		"Serene Pub was started without its launcher, so it cannot replace itself. Download the new version from the releases page, or start Serene Pub from its launcher.",
	channel:
		"This install is updated by the tool that installed it, not from here.",
	target:
		"This install's platform does not match the build it was started as, so an update cannot be chosen safely.",
	staging:
		"The launcher's update folder is not inside the install folder, so an update cannot be prepared safely."
}

function refuse(reason: InAppUpdateRefusal): InAppUpdateGate {
	return { allowed: false, reason, message: REFUSAL_MESSAGES[reason] }
}

/**
 * The §C11 predicate: an in-app update is offered iff every condition holds.
 * Order matters only for which reason is shown — the first failing one.
 */
export function inAppUpdateGate(opts: {
	version: string
	env?: NodeJS.ProcessEnv
	platform?: NodeJS.Platform
	arch?: string
	exists?: (p: string) => boolean
}): InAppUpdateGate {
	const envVars = opts.env ?? process.env
	if (isPrereleaseVersion(opts.version)) return refuse("prerelease")
	if (envVars.SERENE_PUB_PLATFORM === "android") return refuse("android")
	if (isInContainer(opts.exists)) return refuse("container")

	const env = readLauncherEnv(envVars)
	if (!env.launcherVersion || !env.updateDir || !env.target || !env.channel)
		return refuse("no-launcher")
	if (!IN_APP_UPDATE_CHANNELS.includes(env.channel)) return refuse("channel")

	const expected = targetFor(
		opts.platform ?? process.platform,
		opts.arch ?? process.arch
	)
	if (!expected || expected !== env.target) return refuse("target")

	// Staging must sit on the swap unit's filesystem, which the contract
	// guarantees by keeping it inside the install root (§C1).
	if (!env.installRoot || !isInside(env.installRoot, env.updateDir) || env.installRoot === env.updateDir)
		return refuse("staging")

	return {
		allowed: true,
		env: {
			...env,
			target: expected,
			channel: env.channel,
			updateDir: env.updateDir,
			installRoot: env.installRoot,
			launcherVersion: env.launcherVersion
		}
	}
}
