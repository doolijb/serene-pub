import { describe, expect, test, vi } from "vitest"
import {
	OPENROUTER_KEY_LEGACY_URL,
	OPENROUTER_KEY_URL,
	freeModelsFirst,
	isFreeModel,
	isOpenRouterConnection,
	openRouterKeyFactsOf,
	parseOpenRouterKeyResponse,
	readOpenRouterKey
} from "./openRouterKey"

const NOW = new Date("2026-10-30T12:00:00.000Z")
const reply = (status: number, body: unknown = {}) =>
	new Response(JSON.stringify(body), { status })

describe("parseOpenRouterKeyResponse", () => {
	test("free tier true, with the stated daily limit", () => {
		expect(
			parseOpenRouterKeyResponse(
				{
					data: {
						is_free_tier: true,
						free_model_daily_requests: { limit: 50 }
					}
				},
				NOW
			)
		).toEqual({
			freeTier: true,
			freeRequestsPerDay: 50,
			checkedAt: NOW.toISOString()
		})
	})
	test("free tier false, no limit", () => {
		expect(
			parseOpenRouterKeyResponse({ data: { is_free_tier: false } }, NOW)
		).toEqual({
			freeTier: false,
			checkedAt: NOW.toISOString()
		})
	})
	test("a non-positive or non-numeric limit is dropped", () => {
		for (const limit of [0, -5, "50", NaN])
			expect(
				parseOpenRouterKeyResponse(
					{
						data: {
							is_free_tier: true,
							free_model_daily_requests: { limit }
						}
					},
					NOW
				)?.freeRequestsPerDay
			).toBeUndefined()
	})
	test("missing or garbage is null", () => {
		for (const body of [
			null,
			undefined,
			"x",
			3,
			{},
			{ data: {} },
			{ data: { is_free_tier: "yes" } }
		])
			expect(parseOpenRouterKeyResponse(body, NOW)).toBeNull()
	})
})

describe("readOpenRouterKey", () => {
	test("sends the Bearer key to the exact URL", async () => {
		const f = vi.fn(async () =>
			reply(200, { data: { is_free_tier: true } })
		)
		const facts = await readOpenRouterKey("sk-or-1", {
			fetch: f as any,
			now: NOW
		})
		expect(facts?.freeTier).toBe(true)
		expect(f).toHaveBeenCalledTimes(1)
		const [url, init] = f.mock.calls[0] as any
		expect(url).toBe(OPENROUTER_KEY_URL)
		expect(init.headers.Authorization).toBe("Bearer sk-or-1")
		expect(init.signal).toBeInstanceOf(AbortSignal)
	})
	test("a 404 tries the legacy URL once", async () => {
		const f = vi
			.fn()
			.mockResolvedValueOnce(reply(404))
			.mockResolvedValueOnce(
				reply(200, { data: { is_free_tier: false } })
			)
		const facts = await readOpenRouterKey("k", { fetch: f as any })
		expect(facts?.freeTier).toBe(false)
		expect(f.mock.calls.map((c) => c[0])).toEqual([
			OPENROUTER_KEY_URL,
			OPENROUTER_KEY_LEGACY_URL
		])
	})
	test("a second 404 is null, no third call", async () => {
		const f = vi.fn(async () => reply(404))
		expect(await readOpenRouterKey("k", { fetch: f as any })).toBeNull()
		expect(f).toHaveBeenCalledTimes(2)
	})
	test("401, 500, bad JSON, throw and abort are all null", async () => {
		for (const f of [
			async () => reply(401),
			async () => reply(500),
			async () => new Response("not json", { status: 200 }),
			async () => {
				throw new Error("down")
			},
			async () => {
				throw new DOMException("aborted", "TimeoutError")
			}
		])
			expect(await readOpenRouterKey("k", { fetch: f as any })).toBeNull()
	})
})

describe("isOpenRouterConnection", () => {
	test("by preset or by host", () => {
		expect(isOpenRouterConnection({ preset: "openrouter" })).toBe(true)
		expect(
			isOpenRouterConnection({ baseUrl: "https://OpenRouter.ai/api/v1" })
		).toBe(true)
		expect(
			isOpenRouterConnection({
				preset: "openai",
				baseUrl: "https://api.openai.com/v1"
			})
		).toBe(false)
		expect(isOpenRouterConnection({ baseUrl: "not a url" })).toBe(false)
		expect(isOpenRouterConnection({})).toBe(false)
	})
})

describe("isFreeModel", () => {
	test("by suffix", () =>
		expect(isFreeModel({ model: "a/b:free" })).toBe(true))
	test("by zero price on both sides", () => {
		expect(
			isFreeModel({
				model: "openrouter/free",
				facts: { pricing: { inPerMTok: 0, outPerMTok: 0 } }
			})
		).toBe(true)
		expect(
			isFreeModel({
				model: "a/b",
				facts: { pricing: { inPerMTok: 0, outPerMTok: 1 } }
			})
		).toBe(false)
		expect(
			isFreeModel({ model: "a/b", facts: { pricing: { inPerMTok: 0 } } })
		).toBe(false)
		expect(isFreeModel({ model: "a/b", facts: null })).toBe(false)
	})
})

describe("freeModelsFirst", () => {
	test("stable partition", () => {
		const rows = ["p1", "f1", "p2", "f2", "p3"]
		expect(freeModelsFirst(rows, (r) => r.startsWith("f"))).toEqual([
			"f1",
			"f2",
			"p1",
			"p2",
			"p3"
		])
		expect(rows).toEqual(["p1", "f1", "p2", "f2", "p3"])
	})
})

describe("openRouterKeyFactsOf", () => {
	test("validates the stored shape", () => {
		const ok = { freeTier: true, freeRequestsPerDay: 50, checkedAt: "x" }
		expect(openRouterKeyFactsOf({ extraJson: { openrouter: ok } })).toEqual(
			ok
		)
		expect(
			openRouterKeyFactsOf({
				extraJson: { openrouter: { freeTier: "y", checkedAt: "x" } }
			})
		).toBeNull()
		expect(
			openRouterKeyFactsOf({
				extraJson: { openrouter: { freeTier: true } }
			})
		).toBeNull()
		expect(
			openRouterKeyFactsOf({ extraJson: { openrouter: 3 } })
		).toBeNull()
		expect(openRouterKeyFactsOf({ extraJson: null })).toBeNull()
		expect(openRouterKeyFactsOf(null)).toBeNull()
	})
})
