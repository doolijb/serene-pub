import { beforeEach, describe, expect, test, vi } from "vitest"

const m = vi.hoisted(() => ({
	fetchHfRepoCard: vi.fn(),
	hfRepoReadCached: vi.fn(() => false),
	isRateLimited: vi.fn(() => false),
	recordFailedAttempt: vi.fn()
}))
vi.mock("$lib/server/connections/hfGgufQuants", () => ({
	fetchHfRepoCard: m.fetchHfRepoCard,
	hfRepoReadCached: m.hfRepoReadCached
}))
vi.mock("$lib/server/services/loginRateLimit", () => ({
	loginRateLimit: {
		isRateLimited: m.isRateLimited,
		recordFailedAttempt: m.recordFailedAttempt
	}
}))

import { modelsHubCard } from "./modelHubCard"

const admin = { user: { id: 1, isAdmin: true } } as any
const member = { user: { id: 2, isAdmin: false } } as any
const run = async (socket: any, repo: any) => {
	const emit = vi.fn()
	const res: any = await modelsHubCard.handler(socket, { repo }, emit)
	expect(emit).toHaveBeenCalledWith("models:hubCard", res)
	return res
}

beforeEach(() => {
	vi.clearAllMocks()
	m.hfRepoReadCached.mockReturnValue(false)
	m.isRateLimited.mockReturnValue(false)
	m.fetchHfRepoCard.mockResolvedValue({ card: null, siblings: null })
})

describe("models:hubCard handler", () => {
	test("refuses a non-admin with no read", async () => {
		const res = await run(member, "a/b")
		expect(res.error).toMatch(/admin/i)
		expect(m.fetchHfRepoCard).not.toHaveBeenCalled()
		expect(m.recordFailedAttempt).not.toHaveBeenCalled()
	})

	test.each([
		"a",
		"../x/y",
		"a/b/c",
		"a/b?x=1",
		"a/b..c",
		"",
		"a/" + "b".repeat(200)
	])("refuses a bad repo id %s", async (repo) => {
		const res = await run(admin, repo)
		expect(res.error).toBe("That is not a Hugging Face repo id.")
		expect(m.fetchHfRepoCard).not.toHaveBeenCalled()
	})

	test("a cached read spends no limiter", async () => {
		m.hfRepoReadCached.mockReturnValue(true)
		m.fetchHfRepoCard.mockResolvedValue({
			card: { license: "mit" },
			siblings: []
		})
		await run(admin, "a/b")
		expect(m.isRateLimited).not.toHaveBeenCalled()
		expect(m.recordFailedAttempt).not.toHaveBeenCalled()
	})

	test("an uncached read checks then records its own key", async () => {
		m.fetchHfRepoCard.mockResolvedValue({ card: {}, siblings: [] })
		await run(admin, " a/b ")
		expect(m.isRateLimited).toHaveBeenCalledWith("models:hubCard")
		expect(m.recordFailedAttempt).toHaveBeenCalledWith("models:hubCard")
		expect(m.fetchHfRepoCard).toHaveBeenCalledWith("a/b")
	})

	test("rate limited gives an error and no read", async () => {
		m.isRateLimited.mockReturnValue(true)
		const res = await run(admin, "a/b")
		expect(res.error).toMatch(/Rate limited/)
		expect(m.fetchHfRepoCard).not.toHaveBeenCalled()
		expect(m.recordFailedAttempt).not.toHaveBeenCalled()
	})

	test("maps the card and only .gguf files", async () => {
		m.fetchHfRepoCard.mockResolvedValue({
			card: { license: "mit", downloads: 4 },
			siblings: [
				{ rfilename: "README.md", size: 1 },
				{ rfilename: "x-Q4_K_M.gguf", size: 9, lfs: {} },
				{ rfilename: "y-Q8_0.gguf" }
			]
		})
		const res = await run(admin, "a/b")
		expect(res).toEqual({
			repo: "a/b",
			card: { license: "mit", downloads: 4 },
			files: [
				{ rfilename: "x-Q4_K_M.gguf", size: 9 },
				{ rfilename: "y-Q8_0.gguf" }
			]
		})
	})

	test("omits the card when null", async () => {
		m.fetchHfRepoCard.mockResolvedValue({ card: null, siblings: [] })
		const res = await run(admin, "a/b")
		expect(res).toEqual({ repo: "a/b", files: [] })
	})

	test("both null gives the error sentence", async () => {
		const res = await run(admin, "a/b")
		expect(res).toEqual({
			repo: "a/b",
			error: "Hugging Face would not answer for that repo."
		})
	})

	test("a throw gives the error sentence", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		m.fetchHfRepoCard.mockRejectedValue(new Error("boom"))
		const res = await run(admin, "a/b")
		expect(res.error).toBe("Hugging Face would not answer for that repo.")
	})
})
