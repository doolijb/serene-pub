/**
 * The release rule every workflow shares (release.yml, docker.yml,
 * build-android.yml): a plain vX.Y.Z is a release, any suffix a pre-release.
 */
import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { classify, releaseBody } from "./release-meta.mjs"

describe("classify", () => {
	test("a plain version is a release that becomes Latest", () => {
		expect(classify("v0.6.0")).toMatchObject({
			version: "0.6.0",
			title: "0.6.0 Release",
			prerelease: "false",
			make_latest: "true",
			channel: "portable"
		})
	})

	test.each([
		"v0.6.0-pr-1",
		"v0.6.0-rc-2",
		"v0.6.0-beta",
		"v0.6.0-alpha",
		"v0.6.0-dev",
		"v0.6.0-rc.1",
		"garbage"
	])("%s is a pre-release that never becomes Latest", (tag) => {
		expect(classify(tag)).toMatchObject({
			prerelease: "true",
			make_latest: "false",
			channel: "prerelease"
		})
	})

	test("titles", () => {
		expect(classify("v0.6.0-pr-1").title).toBe("0.6.0 Pre-Release Build 1")
		// Tests are not required for a -pr-N build (owner 2026-10-05); release
		// candidates and plain releases still run them.
		expect(classify("v0.6.0-pr-1").run_tests).toBe("false")
		expect(classify("v0.6.0-rc-1").run_tests).toBe("true")
		expect(classify("v0.6.0").run_tests).toBe("true")
		expect(classify("v0.6.0-rc-2").title).toBe("0.6.0 Release Candidate 2")
		expect(classify("v0.6.0-alpha").title).toBe("0.6.0-alpha")
	})
})

describe("releaseBody", () => {
	test("points relative links at the tagged blob and leaves anchors and URLs alone", () => {
		const body = releaseBody("v0.6.0-pr-1", {
			server: "https://github.com",
			repo: "doolijb/serene-pub"
		})
		expect(body).not.toBeNull()
		expect(body).toContain(
			"](https://github.com/doolijb/serene-pub/blob/v0.6.0-pr-1/docs/genres.md)"
		)
		expect(body).not.toMatch(/\]\(\.\.\//)
		expect(body).toContain("](#known-issues-and-limits)")
		const source = readFileSync("docs/release-notes/0.6.0-pr-1.md", "utf8")
		expect(body!.split("\n").length).toBe(source.split("\n").length)
	})

	test("a version without notes has none (GitHub generates them)", () => {
		expect(releaseBody("v9.9.9")).toBeNull()
	})
})
