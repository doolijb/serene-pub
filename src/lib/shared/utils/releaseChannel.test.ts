/**
 * The channel rule in one sentence: you hear about your own channel and
 * everything more finished than it, never anything less finished.
 *
 * The worked example that drove this — someone on 0.5.0-beta must be told
 * about 0.6.0 and 0.6.0-beta, but never 0.6.0-rc-1 or 0.6.0-pr-1 — is asserted
 * directly below, because it is the case a naive "is it newer" check gets
 * wrong in the most annoying direction.
 */
import { describe, expect, test } from "vitest"
import {
	compareVersions,
	isParseableVersion,
	parseVersion,
	pickNotifiableRelease,
	releaseChannelRank,
	shouldNotifyAboutRelease
} from "./releaseChannel"

describe("parseVersion", () => {
	test("parses each release shape", () => {
		expect(parseVersion("0.5.0")).toMatchObject({
			major: 0,
			minor: 5,
			patch: 0,
			type: null,
			num: 0
		})
		expect(parseVersion("0.5.0-beta")).toMatchObject({
			type: "beta",
			num: 0
		})
		expect(parseVersion("0.5.0-rc-2")).toMatchObject({
			type: "rc",
			num: 2
		})
	})

	test("tolerates a leading v, so GitHub tag names work directly", () => {
		expect(parseVersion("v0.5.0-beta")).toMatchObject({
			minor: 5,
			type: "beta"
		})
	})

	test("unparseable input degrades to 0.0.0 rather than throwing", () => {
		expect(parseVersion("nightly")).toMatchObject({ major: 0, minor: 0 })
	})
})

describe("releaseChannelRank", () => {
	test("orders the way this project actually ships, not alphabetically", () => {
		// 0.5.0 went pr -> rc -> beta, so beta outranks rc here even though
		// semver would sort them the other way.
		expect(releaseChannelRank("pr")).toBeLessThan(releaseChannelRank("rc"))
		expect(releaseChannelRank("rc")).toBeLessThan(
			releaseChannelRank("alpha")
		)
		expect(releaseChannelRank("alpha")).toBeLessThan(
			releaseChannelRank("beta")
		)
		expect(releaseChannelRank("beta")).toBeLessThan(
			releaseChannelRank(null)
		)
	})

	test("an unknown suffix sorts below every known pre-release", () => {
		expect(releaseChannelRank("nightly")).toBe(0)
	})
})

describe("compareVersions", () => {
	test("base version wins over channel", () => {
		expect(compareVersions("0.4.2-pr-1", "0.4.1-alpha")).toBe(1)
	})

	test("orders the full ladder within one base version", () => {
		const order = [
			"0.5.0-pr-1",
			"0.5.0-pr-17",
			"0.5.0-rc-1",
			"0.5.0-rc-4",
			"0.5.0-alpha",
			"0.5.0-beta",
			"0.5.0"
		]
		for (let i = 0; i < order.length - 1; i++) {
			expect(
				compareVersions(order[i], order[i + 1]),
				`${order[i]} < ${order[i + 1]}`
			).toBe(-1)
		}
	})

	test("a stable release is newer than its own beta — the case the old check missed", () => {
		// The previous update check stripped the suffix and compared only
		// major.minor.patch, making these EQUAL and suppressing the most
		// important upgrade notice there is.
		expect(compareVersions("0.5.0", "0.5.0-beta")).toBe(1)
	})

	test("identical versions compare equal", () => {
		expect(compareVersions("0.5.0-beta", "0.5.0-beta")).toBe(0)
	})
})

describe("shouldNotifyAboutRelease — the stated rule", () => {
	test("0.5.0-beta hears about 0.6.0 and 0.6.0-beta only", () => {
		expect(shouldNotifyAboutRelease("0.5.0-beta", "0.6.0")).toBe(true)
		expect(shouldNotifyAboutRelease("0.5.0-beta", "0.6.0-beta")).toBe(true)
		expect(shouldNotifyAboutRelease("0.5.0-beta", "0.6.0-rc-1")).toBe(false)
		expect(shouldNotifyAboutRelease("0.5.0-beta", "0.6.0-pr-1")).toBe(false)
	})

	test("a stable install only ever hears about stable releases", () => {
		expect(shouldNotifyAboutRelease("0.5.0", "0.6.0")).toBe(true)
		expect(shouldNotifyAboutRelease("0.5.0", "0.6.0-beta")).toBe(false)
		expect(shouldNotifyAboutRelease("0.5.0", "0.6.0-rc-1")).toBe(false)
	})

	test("an rc install hears about rc and everything more finished, but not pr", () => {
		expect(shouldNotifyAboutRelease("0.5.0-rc-1", "0.6.0-rc-1")).toBe(true)
		expect(shouldNotifyAboutRelease("0.5.0-rc-1", "0.6.0-beta")).toBe(true)
		expect(shouldNotifyAboutRelease("0.5.0-rc-1", "0.6.0")).toBe(true)
		expect(shouldNotifyAboutRelease("0.5.0-rc-1", "0.6.0-pr-1")).toBe(false)
	})

	test("a pr install hears about everything newer", () => {
		for (const c of ["0.6.0-pr-1", "0.6.0-rc-1", "0.6.0-beta", "0.6.0"]) {
			expect(shouldNotifyAboutRelease("0.5.0-pr-1", c), c).toBe(true)
		}
	})

	test("beta -> stable of the SAME base version notifies", () => {
		expect(shouldNotifyAboutRelease("0.5.0-beta", "0.5.0")).toBe(true)
	})

	test("never notifies about the current version or anything older", () => {
		expect(shouldNotifyAboutRelease("0.5.0-beta", "0.5.0-beta")).toBe(false)
		expect(shouldNotifyAboutRelease("0.5.0", "0.4.9")).toBe(false)
		expect(shouldNotifyAboutRelease("0.5.0", "0.5.0-beta")).toBe(false)
		// Newer base version but a lower channel is still suppressed.
		expect(shouldNotifyAboutRelease("0.5.0", "0.9.0-rc-1")).toBe(false)
	})

	test("GitHub tag names work verbatim", () => {
		expect(shouldNotifyAboutRelease("0.5.0-beta", "v0.6.0")).toBe(true)
	})
})

describe("pickNotifiableRelease", () => {
	const RELEASES = [
		"v0.6.0-pr-3",
		"v0.6.0-rc-1",
		"v0.6.0-beta",
		"v0.5.0",
		"v0.5.0-beta",
		"v0.4.1"
	]

	test("a beta install gets the newest beta-or-better, skipping rc/pr", () => {
		expect(pickNotifiableRelease("0.5.0-beta", RELEASES)).toBe(
			"v0.6.0-beta"
		)
	})

	test("a stable install skips the newer pre-releases entirely", () => {
		// 0.6.0-beta is newer than 0.5.0, but a stable install must not be
		// pointed at it; there is no newer stable, so nothing is offered.
		expect(pickNotifiableRelease("0.5.0", RELEASES)).toBeNull()
	})

	test("a pr install gets the newest thing overall", () => {
		expect(pickNotifiableRelease("0.5.0-pr-1", RELEASES)).toBe(
			"v0.6.0-beta"
		)
	})

	test("returns null when nothing is newer", () => {
		expect(pickNotifiableRelease("9.9.9", RELEASES)).toBeNull()
		expect(pickNotifiableRelease("0.5.0-beta", [])).toBeNull()
	})

	test("ignores entries it cannot parse rather than ranking them highest", () => {
		expect(pickNotifiableRelease("0.5.0-beta", ["nightly", "v0.6.0"])).toBe(
			"v0.6.0"
		)
	})
})

describe("isParseableVersion", () => {
	// Regression guard for a shipped brick. `0.5.3-beta-rc-1` (a COMPOUND
	// suffix — two type words plus a number) matches nothing in the version
	// pattern, so parseVersion() degraded it to {0,0,0} — the same value a
	// freshly created meta.json carries as its "nothing has run yet" sentinel.
	// The migration gate compared the two, found them equal, logged "No
	// migration needed, versions match" and skipped every migration, so every
	// fresh install came up with an empty database and never self-healed.
	// db/index.ts now runs migrations unconditionally AND uses this predicate
	// so an unreadable version can never again be mistaken for a match.
	test("rejects the compound suffix that skipped migrations on a fresh install", () => {
		expect(isParseableVersion("0.5.3-beta-rc-1")).toBe(false)
	})

	test("an unreadable version must not be confusable with the meta.json sentinel", () => {
		// Both parse to 0.0.0 — that collision is the bug. What distinguishes
		// them is parseability, which is exactly why the predicate exists.
		expect(parseVersion("0.5.3-beta-rc-1")).toEqual(parseVersion("0.0.0"))
		expect(compareVersions("0.0.0", "0.5.3-beta-rc-1")).toBe(0)
		expect(isParseableVersion("0.0.0")).toBe(true)
		expect(isParseableVersion("0.5.3-beta-rc-1")).toBe(false)
	})

	test("accepts every shape this project actually tags", () => {
		for (const v of [
			"0.5.3",
			"0.5.3-beta",
			"0.5.3-alpha",
			"0.5.3-dev",
			"0.5.3-rc-1",
			"0.5.3-pr-12",
			"v0.5.3-beta"
		]) {
			expect(isParseableVersion(v)).toBe(true)
		}
	})

	test("rejects other malformed shapes rather than silently zeroing them", () => {
		for (const v of ["", "nightly", "1.2", "1.2.3.4", "0.5.3-rc.1"]) {
			expect(isParseableVersion(v)).toBe(false)
		}
	})
})
