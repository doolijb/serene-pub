/**
 * The one thing this file exists to prove: a pre-release build never asks
 * GitHub about versions.
 *
 * "No banner rendered" would be a weaker claim than the requirement — a
 * pre-release must not spend the request, appear in a proxy log, or burn
 * anyone's GitHub rate limit — so the assertion is on `fetch` itself never
 * having been called.
 *
 * updateCheck.ts keeps module-level state (the daily stamp, the in-flight
 * guard) with no reset export, so each test gets a fresh module via
 * vi.resetModules() + dynamic import — same approach as modelManager.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

let fetchMock: ReturnType<typeof vi.fn>

async function loadModule() {
	vi.resetModules()
	return await import("./updateCheck")
}

function releasesResponse(tags: string[]) {
	return {
		ok: true,
		status: 200,
		json: async () => tags.map((tag_name) => ({ tag_name, draft: false }))
	}
}

beforeEach(() => {
	fetchMock = vi.fn()
	vi.stubGlobal("fetch", fetchMock)
	// The check logs on every path; keep the suite output readable.
	vi.spyOn(console, "log").mockImplementation(() => {})
	vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe("maybeCheckForUpdates on a pre-release build", () => {
	test.each([
		["0.6.0-pr-1"],
		["0.6.0-rc.1"],
		["0.6.0-rc-1"],
		["0.6.0-dev"],
		["v0.6.0-pr-1"],
		// Unrecognised suffixes fail closed here too — see
		// isPrereleaseVersion(). `-beta` is deliberately absent: it is a
		// release, and asserted as one below.
		["0.6.0-alpha"],
		["0.6.0-wat"]
	])("%s never touches the network", async (version) => {
		const { maybeCheckForUpdates, getUpdateState } = await loadModule()

		expect(maybeCheckForUpdates(version)).toBeNull()

		expect(fetchMock).not.toHaveBeenCalled()
		// And nothing is published for a consumer to render, either.
		expect(getUpdateState()).toEqual({
			latestReleaseTag: undefined,
			isNewerReleaseAvailable: undefined
		})
	})

	test("stays quiet however many times it is called", async () => {
		// The trigger in hooks.server.ts fires on EVERY request, so "never"
		// has to survive repetition, not just the first call.
		const { maybeCheckForUpdates } = await loadModule()
		for (let i = 0; i < 25; i++) maybeCheckForUpdates("0.6.0-pr-1")
		expect(fetchMock).not.toHaveBeenCalled()
	})
})

describe("maybeCheckForUpdates on a release build", () => {
	test("does check, so the gate above is the pre-release suffix and nothing else", async () => {
		// The counterpart assertion: without it, a broken fetch stub or a
		// module that no-ops for some unrelated reason would make every test
		// above pass vacuously.
		const { maybeCheckForUpdates, getUpdateState } = await loadModule()
		fetchMock.mockResolvedValue(releasesResponse(["v0.7.0", "v0.5.0"]))

		await maybeCheckForUpdates("0.6.0")

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock.mock.calls[0][0]).toContain(
			"api.github.com/repos/doolijb/serene-pub/releases"
		)
		expect(getUpdateState()).toEqual({
			latestReleaseTag: "v0.7.0",
			isNewerReleaseAvailable: true
		})
	})

	test("a -beta build checks, because beta is a maturity label and not a pre-release", async () => {
		// The rule this pins: `0.6.0-beta` is a production build. If someone
		// re-applies the plain semver rule to isPrereleaseVersion(), betas go
		// silently un-notified again and this fails.
		const { maybeCheckForUpdates, getUpdateState } = await loadModule()
		fetchMock.mockResolvedValue(releasesResponse(["v0.7.0", "v0.5.0"]))

		await maybeCheckForUpdates("0.6.0-beta")

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(getUpdateState()).toEqual({
			latestReleaseTag: "v0.7.0",
			isNewerReleaseAvailable: true
		})
	})

	test("checks at most once a day", async () => {
		const { maybeCheckForUpdates } = await loadModule()
		fetchMock.mockResolvedValue(releasesResponse(["v0.5.0"]))

		await maybeCheckForUpdates("0.6.0")
		await maybeCheckForUpdates("0.6.0")

		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	test("a failed check still counts as a check, so an offline server doesn't retry per request", async () => {
		const { maybeCheckForUpdates, getUpdateState } = await loadModule()
		fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"))

		await maybeCheckForUpdates("0.6.0")
		await maybeCheckForUpdates("0.6.0")

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(getUpdateState().isNewerReleaseAvailable).toBeUndefined()
	})
})
