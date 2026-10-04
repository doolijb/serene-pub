/**
 * The §C11 gating matrix: an in-app update is offered only when every
 * condition holds, and the first failing one is the reason shown.
 */
import path from "node:path"
import { describe, expect, test } from "vitest"
import { inAppUpdateGate, isInside, readLauncherEnv, targetFor } from "./launcherEnv"

const ROOT = path.resolve("/opt/serene-pub")
const LAUNCHED = {
	SERENE_PUB_LAUNCHER_VERSION: "0.6.1",
	SERENE_PUB_UPDATE_CHANNEL: "portable",
	SERENE_PUB_TARGET: "linux-x64",
	SERENE_PUB_UPDATE_DIR: path.join(ROOT, "staging"),
	SERENE_PUB_INSTALL_ROOT: ROOT
}
const noContainer = () => false

function gate(over: { version?: string; env?: Record<string, string | undefined>; platform?: NodeJS.Platform; arch?: string; exists?: (p: string) => boolean } = {}) {
	return inAppUpdateGate({
		version: over.version ?? "0.6.1",
		env: (over.env ?? LAUNCHED) as NodeJS.ProcessEnv,
		platform: over.platform ?? "linux",
		arch: over.arch ?? "x64",
		exists: over.exists ?? noContainer
	})
}

describe("inAppUpdateGate", () => {
	test("allowed when launched on a portable channel for this platform", () => {
		const g = gate()
		expect(g.allowed).toBe(true)
		if (g.allowed) {
			expect(g.env.target).toBe("linux-x64")
			expect(g.env.updateDir).toBe(path.join(ROOT, "staging"))
		}
	})

	test.each([["installer"], ["dmg"]])("channel %s is allowed", (channel) => {
		expect(gate({ env: { ...LAUNCHED, SERENE_PUB_UPDATE_CHANNEL: channel } }).allowed).toBe(true)
	})

	test.each([
		["0.6.0-beta-2"],
		["0.6.0-rc-1"],
		["0.6.0-pr-1"],
		["0.6.0-dev"],
		["garbage-"]
	])("pre-release %s is refused first", (version) => {
		expect(gate({ version })).toMatchObject({ allowed: false, reason: "prerelease" })
	})

	test("0.6.0-beta is a release, not a pre-release", () => {
		expect(gate({ version: "0.6.0-beta" }).allowed).toBe(true)
	})

	test("Android is refused", () => {
		expect(gate({ env: { ...LAUNCHED, SERENE_PUB_PLATFORM: "android" } })).toMatchObject({ reason: "android" })
	})

	test("a container is refused", () => {
		expect(gate({ exists: (p) => p === "/.dockerenv" })).toMatchObject({ reason: "container" })
		expect(gate({ exists: (p) => p === "/run/.containerenv" })).toMatchObject({ reason: "container" })
	})

	test.each([
		["SERENE_PUB_LAUNCHER_VERSION"],
		["SERENE_PUB_UPDATE_DIR"],
		["SERENE_PUB_TARGET"],
		["SERENE_PUB_UPDATE_CHANNEL"]
	])("missing %s means started without the launcher", (key) => {
		expect(gate({ env: { ...LAUNCHED, [key]: undefined } })).toMatchObject({ reason: "no-launcher" })
	})

	test("a bare start is refused", () => {
		expect(gate({ env: { SERENE_PUB_INSTALL_ROOT: ROOT } })).toMatchObject({ reason: "no-launcher" })
	})

	test.each([["appimage"], ["homebrew"], ["prerelease"], ["dev"], ["bogus"]])(
		"channel %s is refused",
		(channel) => {
			expect(gate({ env: { ...LAUNCHED, SERENE_PUB_UPDATE_CHANNEL: channel } })).toMatchObject({
				reason: "channel"
			})
		}
	)

	test("a target that is not this platform is refused", () => {
		expect(gate({ env: { ...LAUNCHED, SERENE_PUB_TARGET: "windows-x64" } })).toMatchObject({ reason: "target" })
		expect(gate({ arch: "arm64" })).toMatchObject({ reason: "target" })
	})

	test("update staging outside the install root is refused", () => {
		expect(gate({ env: { ...LAUNCHED, SERENE_PUB_UPDATE_DIR: "/tmp/elsewhere" } })).toMatchObject({
			reason: "staging"
		})
		expect(gate({ env: { ...LAUNCHED, SERENE_PUB_UPDATE_DIR: ROOT } })).toMatchObject({ reason: "staging" })
		expect(gate({ env: { ...LAUNCHED, SERENE_PUB_INSTALL_ROOT: undefined } })).toMatchObject({
			reason: "staging"
		})
	})

	test("every refusal carries a sentence", () => {
		const g = gate({ version: "0.6.0-rc-1" })
		expect(g.allowed).toBe(false)
		if (!g.allowed) expect(g.message.length).toBeGreaterThan(20)
	})
})

describe("helpers", () => {
	test("targetFor", () => {
		expect(targetFor("linux", "x64")).toBe("linux-x64")
		expect(targetFor("win32", "x64")).toBe("windows-x64")
		expect(targetFor("darwin", "arm64")).toBe("macos-arm64")
		expect(targetFor("darwin", "x64")).toBe("macos-x64")
		expect(targetFor("linux", "arm64")).toBeNull()
		expect(targetFor("freebsd", "x64")).toBeNull()
	})
	test("isInside", () => {
		expect(isInside("/a", "/a/b")).toBe(true)
		expect(isInside("/a", "/a")).toBe(true)
		expect(isInside("/a", "/ab")).toBe(false)
		expect(isInside("/a", "/a/../b")).toBe(false)
	})
	test("readLauncherEnv trims and resolves", () => {
		const env = readLauncherEnv({ SERENE_PUB_TARGET: "  linux-x64 ", SERENE_PUB_UPDATE_DIR: "rel" })
		expect(env.target).toBe("linux-x64")
		expect(path.isAbsolute(env.updateDir!)).toBe(true)
		expect(env.launcherVersion).toBeNull()
	})
})
