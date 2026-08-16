/**
 * Round-8 audit fix: getCardBytes(ref) interpolated a client-supplied
 * `file` directly into a fetch URL with no validation. isSafeGithubFileRef
 * is the primary (fast, clear-error) guard; fetchGithubCardBytes's
 * post-construction pathname-prefix check is the authoritative one, since
 * WHATWG URL normalization treats percent-encoded dot-segments (%2e%2e) as
 * equivalent to a literal ".." — a bare string comparison against ".."
 * doesn't catch that, but the resolved URL still collapses it into a real
 * traversal. Also adds a source-scoped rate limit, since this fetch path
 * previously had none at all (unlike CharaVault's).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	isSafeGithubFileRef,
	fetchGithubCardBytes,
	checkGithubFetchRateLimit,
	_resetGithubFetchRateLimitForTests
} from "./githubYamlCardSource"
import { CardSourceInvalidRefError } from "./types"

describe("isSafeGithubFileRef", () => {
	test("accepts nested relative paths within the repo", () => {
		expect(isSafeGithubFileRef("characters/foo.png")).toBe(true)
		expect(isSafeGithubFileRef("foo.png")).toBe(true)
		expect(isSafeGithubFileRef("a/b/c/foo.png")).toBe(true)
	})

	test("rejects traversal, absolute paths, and other-scheme URLs", () => {
		expect(isSafeGithubFileRef("../../etc/passwd")).toBe(false)
		expect(
			isSafeGithubFileRef("../../someowner/otherrepo/main/somefile")
		).toBe(false)
		expect(isSafeGithubFileRef("/etc/passwd")).toBe(false)
		expect(isSafeGithubFileRef("http://evil.com/x")).toBe(false)
	})

	test("rejects control characters and non-string/empty/oversized input", () => {
		expect(isSafeGithubFileRef("foo\x00bar")).toBe(false)
		expect(isSafeGithubFileRef(123)).toBe(false)
		expect(isSafeGithubFileRef(undefined)).toBe(false)
		expect(isSafeGithubFileRef("")).toBe(false)
		expect(isSafeGithubFileRef("a".repeat(513))).toBe(false)
	})
})

describe("fetchGithubCardBytes — authoritative post-construction check", () => {
	beforeEach(() => {
		_resetGithubFetchRateLimitForTests()
	})

	test("rejects a percent-encoded dot-segment that a naive string comparison would miss", async () => {
		// "%2e%2e" !== ".." as a raw string, so isSafeGithubFileRef's segment
		// check alone wouldn't necessarily catch this — the URL pathname
		// prefix check inside fetchGithubCardBytes is what actually rejects
		// it, since URL normalization still collapses it into a real ".."
		// once constructed.
		await expect(
			fetchGithubCardBytes("%2e%2e/%2e%2e/owner/repo/main/x")
		).rejects.toThrow(CardSourceInvalidRefError)
	})
})

describe("checkGithubFetchRateLimit", () => {
	beforeEach(() => {
		_resetGithubFetchRateLimitForTests()
	})
	afterEach(() => {
		_resetGithubFetchRateLimitForTests()
	})

	test("allows calls under the ceiling, rejects the one that exceeds it", () => {
		for (let i = 0; i < 60; i++) {
			expect(() => checkGithubFetchRateLimit()).not.toThrow()
		}
		expect(() => checkGithubFetchRateLimit()).toThrow(/rate limited/i)
	})
})
