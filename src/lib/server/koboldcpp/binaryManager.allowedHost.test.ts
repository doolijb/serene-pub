/**
 * Round-7 audit fix: downloadVariant() followed up to 5 redirects with no
 * hostname validation on either the initial downloadUrl or any hop — a
 * strictly worse-consequence target than the GGUF model download's
 * isAllowedHuggingFaceHost fix (this downloads the koboldcpp executable
 * itself, later chmod'd and spawned). Verified via web search: GitHub
 * historically redirects release-asset downloads to
 * objects.githubusercontent.com, but has been migrating to
 * release-assets.githubusercontent.com since mid-2025 — both must be
 * allowed since either can be live depending on when a release's assets
 * were uploaded.
 */
import { describe, expect, test } from "vitest"
import { isAllowedGithubReleaseHost } from "./binaryManager"

describe("isAllowedGithubReleaseHost", () => {
	test("accepts github.com and both known release-asset redirect hosts", () => {
		expect(isAllowedGithubReleaseHost("github.com")).toBe(true)
		expect(
			isAllowedGithubReleaseHost("objects.githubusercontent.com")
		).toBe(true)
		expect(
			isAllowedGithubReleaseHost("release-assets.githubusercontent.com")
		).toBe(true)
	})

	test("is case-insensitive", () => {
		expect(isAllowedGithubReleaseHost("GITHUB.COM")).toBe(true)
	})

	test("rejects lookalike and unrelated hosts", () => {
		expect(isAllowedGithubReleaseHost("github.com.evil.com")).toBe(false)
		expect(isAllowedGithubReleaseHost("notgithubusercontent.com")).toBe(
			false
		)
		expect(
			isAllowedGithubReleaseHost("evil.objects.githubusercontent.com")
		).toBe(false)
		expect(isAllowedGithubReleaseHost("169.254.169.254")).toBe(false)
		expect(isAllowedGithubReleaseHost("localhost")).toBe(false)
	})
})
